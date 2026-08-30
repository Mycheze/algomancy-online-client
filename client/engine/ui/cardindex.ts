/* ONE ROW PER CARD, and the reason there is exactly one of these.
 *
 * Before this file the client had two answers to "what is a fire spell": the
 * deck drawer's three-control filter (ui/decks.ts) and nothing else, because
 * nothing else could ask. Adding a card browser meant either a second filter
 * that would drift from the first, or one index both read. This is the index.
 *
 * WHAT IT JOINS. Three sources, and they answer three different questions that
 * are easy to confuse:
 *
 *   catalogue.json  every name the ORACLE FILE knows (534). A name being here
 *                   means the card exists in print.
 *   the registry    every name the ENGINE has printed data for (`scripted`,
 *                   492) plus the two synthetics that exist in no data file.
 *                   A name being here means the client can draw it.
 *   DECK_LIST       every name that is DECK-LEGAL (`playable`, 483). A name
 *                   being here means you can put it in a deck.
 *
 * A help card is in the first and none of the others. A Fireball token is in
 * the first two. Getting those confused is how a browser ends up offering you
 * a Cardback as a two-of, so every row says which of the three it is and the
 * browser's default filter is `class:card`, said out loud in the UI.
 *
 * PURE AND DOM-FREE, like ui/deckstats.ts and ui/cardtext.ts: the whole point
 * is that ui/cardsearch.ts can be tested with node --test and no browser.
 */
import catalogueJson from '../src/cards/catalogue.json' with { type: 'json' };
import { affinityPips, allCardNames, getCard, isGraftable, type Printed } from '../src/cards/dsl.ts';
import { DECK_LIST, createsOf, transformsInto } from '../src/cards/registry.ts';
/* IMPORTED FOR ITS SIDE EFFECT, and this is not optional.
 *
 * `src/apply.ts` registers a THIRD synthetic — 'Alluring Attribute', an
 * internal carrier for the {Alluring} trigger that is never in anyone's deck
 * or hand. So `allCardNames()` answers 494 or 495 depending on whether apply.ts
 * happens to have been imported yet, and the index quietly had a different
 * number of rows in a test than in the browser (main.ts imports apply.ts; the
 * first draft of test/210 did not). An index whose contents depend on who
 * imported what is not an index. Importing it here pins the answer at 495
 * everywhere, and `classOf` below files it as a marker so it never shows up
 * as a card you could play. */
import '../src/apply.ts';

/** The browse-only half of a catalogue row — see scripts/extract-printed.mjs. */
export interface CatalogueEntry extends Printed {
  class: CardClass;
  supertype: string;
  subtypes: string[];
  augment: boolean;
  complexity: string;
  deck: string;
  numCopies: number;
  side: string;
  backside: string;
  hasArt: boolean;
  scripted: boolean;
  provisional: boolean;
  rulings?: unknown[];
}

export type CardClass = 'card' | 'token' | 'resource' | 'marker' | 'help' | 'exclusive';

const CATALOGUE = catalogueJson as unknown as Record<string, CatalogueEntry>;

/**
 * Everything a filter can ask about one card, flattened and pre-lowercased.
 *
 * The lowercased twins are not premature optimisation: a live query bar runs
 * the whole predicate on every keystroke over 536 rows, and `toLowerCase()` in
 * the inner loop is the one thing here that would actually show up.
 */
export interface CardRow {
  name: string;
  nameLc: string;
  text: string;
  textLc: string;
  type: string;
  typeLc: string;
  supertype: string;
  subtypes: string[];
  subtypesLc: string[];
  /** an [Augment] prefix on the type line */
  augment: boolean;

  /** element identity, e.g. ['fire','wood'] */
  factions: string[];
  /** printed affinity pips as a string, e.g. "rr" */
  cost: string;
  /** …and by element: { fire: 2 } */
  pips: Record<string, number>;
  pipCount: number;

  /** printed mana value; 0 for an X card, which is what `isX` is for */
  mana: number;
  isX: boolean;
  power: number;
  toughness: number;

  kind: Printed['kind'];
  timing: Printed['timing'];
  attrs: string[];
  attrsLc: string[];
  augmentAttrs: string[];
  augmentAttrsLc: string[];

  virus: boolean;
  burst: boolean;
  unstable: boolean;
  ambush: boolean;
  prophecy: boolean;
  discardMe: boolean;
  gainDebt: boolean;

  cls: CardClass;
  complexity: string;
  complexityLc: string;
  /** the printed deck a card ships in — the nearest thing this game has to a
   * set: "Fire", "Hybrid", "Light & Dark (Light/Wood)", "Kickstarter Exclusive" */
  set: string;
  setLc: string;
  numCopies: number;

  hasArt: boolean;
  /** the engine has printed data for this name */
  scripted: boolean;
  /** …and it is deck-legal (DECK_LIST) */
  playable: boolean;
  provisional: boolean;
  rulings: number;
  image: string;

  /** attributes plus the mechanics a card carries, lowercased — what `kw:` asks */
  keywords: string[];
  /** tokens this card can create, and the face it transforms into */
  creates: string[];
  transforms: string | null;
  graftable: boolean;
  /** no printed rules text at all */
  vanilla: boolean;
}

const lc = (s: string): string => s.toLowerCase();

/** Mechanics that are not attributes but that people search for as keywords. */
function mechanicsOf(e: CatalogueEntry, graftable: boolean): string[] {
  const out: string[] = [];
  if (e.virus) out.push('virus');
  if (e.burst) out.push('burst');
  if (e.unstable) out.push('unstable');
  if (e.ambush) out.push('ambush');
  if (e.prophecy) out.push('prophecy');
  if (e.discardMe) out.push('discard me');
  if (e.gainDebt !== undefined) out.push('debt');
  if (e.augment || /\[Augment\]/i.test(e.text)) out.push('augment');
  if (graftable || /\[Switch1?\]/i.test(e.text)) out.push('graft');
  return out;
}

/** A registry name the oracle file does not carry (the two synthetics), turned
 * into a catalogue-shaped entry so the rest of this file has one code path. */
function fromRegistry(name: string): CatalogueEntry | null {
  let c: Printed;
  try { c = getCard(name); } catch { return null; }
  const bare = c.type.replace(/\{[^}]*\}|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  const tail = ['Spell Unit', 'Spell Token', 'Unit', 'Spell', 'Resource', 'Card', 'Token']
    .find(s => bare === s || bare.endsWith(' ' + s)) ?? '';
  const rest = tail ? bare.slice(0, bare.length - tail.length).trim() : bare;
  return {
    ...c,
    // No printed supertype means it is not a printed object: 'Alluring
    // Attribute' types itself "Attribute" and exists only to carry a trigger.
    // That is a marker, the same class as the oracle file's Trigger 1-3 — and
    // filing it by what it lacks is what keeps the next engine-internal
    // registration out of the browser's card list without an edit here.
    class: !tail ? 'marker' : /\bToken\b/.test(c.type) ? 'token' : 'card',
    supertype: tail,
    subtypes: rest ? rest.split(' ') : [],
    augment: /\[Augment\]/i.test(c.type),
    complexity: '',
    deck: '',
    numCopies: 1,
    side: 'Front',
    backside: '',
    // the registry's own `image`, which is '' for a card that has no scan
    hasArt: !!c.image,
    scripted: true,
    provisional: false,
  };
}

function toRow(e: CatalogueEntry, playable: boolean): CardRow {
  const graftable = e.scripted && safe(() => isGraftable(e.name), false);
  const attrs = e.attrs ?? [];
  const augmentAttrs = e.augmentAttrs ?? [];
  const keywords = [...attrs.map(lc), ...augmentAttrs.map(lc), ...mechanicsOf(e, graftable)];
  return {
    name: e.name,
    nameLc: lc(e.name),
    text: e.text ?? '',
    textLc: lc(e.text ?? ''),
    type: e.type,
    typeLc: lc(e.type),
    supertype: e.supertype,
    subtypes: e.subtypes,
    subtypesLc: e.subtypes.map(lc),
    augment: e.augment,

    factions: e.factions ?? [],
    cost: e.cost ?? '',
    pips: affinityPips(e.cost ?? ''),
    pipCount: (e.cost ?? '').length,

    mana: e.mana === 'X' ? 0 : e.mana,
    isX: e.mana === 'X',
    power: e.power,
    toughness: e.toughness,

    kind: e.kind,
    timing: e.timing,
    attrs,
    attrsLc: attrs.map(lc),
    augmentAttrs,
    augmentAttrsLc: augmentAttrs.map(lc),

    virus: !!e.virus,
    burst: !!e.burst,
    unstable: !!e.unstable,
    ambush: !!e.ambush,
    prophecy: !!e.prophecy,
    discardMe: !!e.discardMe,
    gainDebt: e.gainDebt !== undefined,

    cls: e.class,
    complexity: e.complexity,
    complexityLc: lc(e.complexity),
    set: e.deck,
    setLc: lc(e.deck),
    numCopies: e.numCopies,

    hasArt: e.hasArt,
    scripted: e.scripted,
    playable,
    provisional: e.provisional,
    rulings: e.rulings?.length ?? 0,
    image: e.image,

    keywords: [...new Set(keywords)],
    creates: e.scripted ? safe(() => createsOf(e.name), [] as string[]) : [],
    transforms: e.scripted ? safe(() => transformsInto(e.name), undefined) ?? null : null,
    graftable,
    vanilla: !(e.text ?? '').trim(),
  };
}

/** The registry throws on names it does not know; a browse row must not. */
function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

let ROWS: CardRow[] | null = null;
let BY_NAME: Map<string, CardRow> | null = null;

/**
 * Every card, built once.
 *
 * Order is the oracle file's, then the registry-only synthetics — stable, so
 * an unsorted result list is at least reproducible. Everything the browser
 * shows goes through a sort anyway.
 */
export function allRows(): CardRow[] {
  if (ROWS) return ROWS;
  const legal = new Set(DECK_LIST);
  const rows: CardRow[] = [];
  const seen = new Set<string>();
  for (const e of Object.values(CATALOGUE)) {
    rows.push(toRow(e, legal.has(e.name)));
    seen.add(e.name);
  }
  // the two `registerSynthetic` cards exist in no data file at all — see the
  // comment on registerSynthetic in src/cards/registry.ts for why they cannot
  for (const name of allCardNames()) {
    if (seen.has(name)) continue;
    const e = fromRegistry(name);
    if (e) rows.push(toRow(e, legal.has(name)));
  }
  ROWS = rows;
  BY_NAME = new Map(rows.map(r => [r.name, r]));
  return rows;
}

export function rowFor(name: string): CardRow | null {
  allRows();
  return BY_NAME!.get(name) ?? null;
}

/* NO resetIndex(). One was written here "for tests" and never called: the pool
 * cannot change at runtime, so a cache invalidator is machinery describing a
 * problem this file does not have. 147-comment-conformance rejected it, which
 * is the whole point of that test. */

/** Distinct values of a facet, with counts, for the facet rail to render.
 * Derived from the rows so a new subtype or a new set needs no edit here. */
export function facetValues(pick: (r: CardRow) => string[], rows = allRows()): { value: string; count: number }[] {
  const n = new Map<string, number>();
  for (const r of rows) for (const v of pick(r)) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
