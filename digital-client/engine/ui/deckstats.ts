/* What a deck list actually IS, arithmetically: the curve, the unit/spell
 * split, and — the one that is specific to Algomancy — the affinity you have
 * to reach, and by when, to cast the things you paid for.
 *
 * Pure and DOM-free on purpose (like ui/pace.ts and ui/cardtext.ts): the sums
 * a deckbuilder makes decisions on are exactly the kind of thing that gets
 * quietly wrong and is never noticed, so they are testable without a browser.
 * See engine/test/188-deck-stats.test.ts.
 *
 * THE AFFINITY TABLE IS THE POINT. A curve is a curve in any game; Algomancy's
 * real deckbuilding constraint is that a cost like [3][r][r] wants THREE mana
 * AND two fire resources at once, and resources arrive one per turn. So the
 * useful question is not "what does my deck need" but "what do I need to have
 * OPENED by the time I can afford this" — which is a per-mana-value table, and
 * a cumulative one beside it, not a single number.
 *
 * Two counting conventions worth stating because both could go either way:
 *
 *  - A HYBRID counts a half to each of its elements in the `elements` share
 *    (matching how the server weighs a played card in Profile.cardElements),
 *    but its PIPS are counted whole to whichever element the pip names. A
 *    "fire/water" card asking [r][b] needs one of each — nothing about that is
 *    a half.
 *  - A {spellUnit} is its own bucket rather than being counted in both, so the
 *    three buckets sum to the deck size. Fourteen cards in the pool are one,
 *    and a split that does not add up is worse than a third bar.
 */
import { affinityPips, getCard, type Printed } from '../src/cards/dsl.ts';
import { ALL_ELEMENTS, checkDeck } from '../src/apply.ts';

/** the engine's own element list — a new element must never need an edit here */
export const ELEMENTS: readonly string[] = ALL_ELEMENTS;

/** the printed facts a deckbuilder reasons about, for one card */
export interface CardFacts {
  name: string;
  /** printed mana cost; 0 for an X card, which is what `isX` is for */
  mana: number;
  isX: boolean;
  /** affinity pips demanded, by element ("rr" → { fire: 2 }) */
  pips: Record<string, number>;
  kind: Printed['kind'];
  timing: Printed['timing'];
  factions: string[];
  power: number;
  toughness: number;
  text: string;
  type: string;
}

/** Printed facts for a card, or null when the engine does not script it. */
export function cardFacts(name: string): CardFacts | null {
  let c: Printed;
  try { c = getCard(name); } catch { return null; }
  return {
    name,
    mana: c.mana === 'X' ? 0 : c.mana,
    isX: c.mana === 'X',
    pips: affinityPips(c.cost),
    kind: c.kind,
    timing: c.timing,
    factions: c.factions ?? [],
    power: c.power,
    toughness: c.toughness,
    text: c.text,
    type: c.type,
  };
}

const zero = (): Record<string, number> => Object.fromEntries(ELEMENTS.map(e => [e, 0]));

/** one mana value's row of the affinity table */
export interface AffinityRow {
  mana: number;
  /** cards printed at exactly this mana value */
  count: number;
  /** the most affinity of each element any ONE card here asks for */
  need: Record<string, number>;
  /** …and across everything at this mana value or below: what has to be open
   * by the time you can afford this row */
  cumulative: Record<string, number>;
  /**
   * The elements whose cumulative requirement went UP at this row — i.e. this
   * is the first mana value that needs that much of it.
   *
   * Derived here rather than in the page because the obvious test at the call
   * site is wrong in a way that looks right: "does a card at this row need as
   * much as the running total" is TRUE for every row that merely restates a
   * requirement set lower down, so a column reading 2,2,3,3,3 highlighted
   * three of its five rows instead of two.
   */
  first: string[];
}

export interface DeckAnalysis {
  total: number;
  units: number;
  spells: number;
  /** cards that are a spell AND a unit — their own bucket, see the header */
  spellUnits: number;
  /** cards playable during battle (printed {Battle}), and with haste */
  battle: number;
  haste: number;
  /** mana value → how many, lowest first. Dense: a gap in the curve is a row
   * of zeroes, because an empty 3-drop slot is information. */
  curve: { mana: number; units: number; spells: number; spellUnits: number; total: number }[];
  /** X-cost cards, which have no place on a curve and get counted apart */
  xCards: number;
  /** average printed mana of everything that is not an X card */
  avgMana: number;
  /** share of the deck by element, hybrids split half and half */
  elements: Record<string, number>;
  /** every pip the deck asks for, added up — the "how greedy is this" number */
  pips: Record<string, number>;
  /** the ceiling: the most affinity of each element any single card demands.
   * Reaching all of these is enough to cast everything in the deck. */
  maxAffinity: Record<string, number>;
  /** resources of a named element you must eventually open — the sum of the
   * ceiling above, i.e. the floor on your board to cast the whole deck */
  affinityFloor: number;
  rows: AffinityRow[];
  /** the cards that set the ceiling, hardest first — what to cut if the
   * requirement is the problem */
  demanding: { name: string; mana: number; pips: Record<string, number>; weight: number }[];
  /** distinct cards and their counts, in deck order of first appearance */
  copies: { name: string; n: number; facts: CardFacts | null }[];
  /** cards this build does not script (the deck is unplayable while any exist) */
  unknown: string[];
  /** deck-rule problems (30 minimum, max 2 copies); empty means playable */
  problems: string[];
  legal: boolean;
}

/** How demanding one card's cost is: total pips, with a tie broken toward the
 * card that concentrates them in one element (2 fire is harder to reach than
 * 1 fire + 1 water on the same turn). */
const demandWeight = (pips: Record<string, number>): number => {
  const values = Object.values(pips);
  const total = values.reduce((a, b) => a + b, 0);
  return total * 10 + Math.max(0, ...values, 0);
};

/**
 * Everything the deck page shows about a list, in one pass.
 *
 * `cards` is the raw list including duplicates — the same shape the server
 * stores and the engine shuffles — so nothing here has to be told how many
 * copies of anything there are.
 */
export function analyzeDeck(cards: readonly string[]): DeckAnalysis {
  const facts: CardFacts[] = [];
  const unknown: string[] = [];
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const name of cards) {
    if (!counts.has(name)) order.push(name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
    const f = cardFacts(name);
    if (f) facts.push(f);
    else if (!unknown.includes(name)) unknown.push(name);
  }

  const elements = zero();
  const pips = zero();
  const maxAffinity = zero();
  let units = 0, spells = 0, spellUnits = 0, battle = 0, haste = 0, xCards = 0, manaSum = 0, manaCount = 0;
  /** mana value → the running row, built sparse then filled dense below */
  const byMana = new Map<number, { units: number; spells: number; spellUnits: number; need: Record<string, number> }>();

  for (const f of facts) {
    if (f.kind === 'spellUnit') spellUnits++;
    else if (f.kind === 'spell' || f.kind === 'spellToken') spells++;
    else units++;
    if (f.timing === 'battle') battle++;
    if (f.timing === 'haste') haste++;

    // a hybrid is half of each element it belongs to; a card with no faction
    // (there are none in the deck pool today) simply contributes nothing
    const share = f.factions.length ? 1 / f.factions.length : 0;
    for (const el of f.factions) elements[el] = (elements[el] ?? 0) + share;

    for (const [el, n] of Object.entries(f.pips)) {
      pips[el] = (pips[el] ?? 0) + n;
      maxAffinity[el] = Math.max(maxAffinity[el] ?? 0, n);
    }

    if (f.isX) { xCards++; continue; }   // an X card sits on no rung of the curve
    manaSum += f.mana;
    manaCount++;
    const row = byMana.get(f.mana) ?? { units: 0, spells: 0, spellUnits: 0, need: zero() };
    if (f.kind === 'spellUnit') row.spellUnits++;
    else if (f.kind === 'spell' || f.kind === 'spellToken') row.spells++;
    else row.units++;
    for (const [el, n] of Object.entries(f.pips)) row.need[el] = Math.max(row.need[el] ?? 0, n);
    byMana.set(f.mana, row);
  }

  // dense from 0 (or the cheapest card) to the most expensive: an empty rung
  // is a fact about the deck, so it gets a row rather than being skipped
  const manaValues = [...byMana.keys()].sort((a, b) => a - b);
  const top = manaValues.length ? manaValues[manaValues.length - 1]! : -1;
  const curve: DeckAnalysis['curve'] = [];
  const rows: AffinityRow[] = [];
  const running = zero();
  // Start at the CHEAPEST card, not at 0. An interior gap is information ("no
  // three-drops"); a leading empty row on every deck that happens to have no
  // free spells is not, and reads as a drawing bug.
  const bottom = manaValues.length ? manaValues[0]! : 0;
  for (let m = bottom; m <= top; m++) {
    const row = byMana.get(m) ?? { units: 0, spells: 0, spellUnits: 0, need: zero() };
    const count = row.units + row.spells + row.spellUnits;
    curve.push({ mana: m, units: row.units, spells: row.spells, spellUnits: row.spellUnits, total: count });
    const first: string[] = [];
    for (const el of ELEMENTS) {
      const was = running[el] ?? 0;
      const now = Math.max(was, row.need[el] ?? 0);
      if (now > was) first.push(el);
      running[el] = now;
    }
    rows.push({ mana: m, count, need: { ...row.need }, cumulative: { ...running }, first });
  }

  const demanding = facts
    .map(f => ({ name: f.name, mana: f.mana, pips: f.pips, weight: demandWeight(f.pips) }))
    .filter(d => d.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
    // one entry per distinct card: three copies of the greedy card is one
    // thing to know, not three
    .filter((d, i, all) => all.findIndex(x => x.name === d.name) === i);

  const check = checkDeck([...cards]);
  const problems = check.ok ? [] : [check.error];

  return {
    total: cards.length,
    units, spells, spellUnits, battle, haste,
    curve, xCards,
    avgMana: manaCount ? manaSum / manaCount : 0,
    elements, pips, maxAffinity,
    affinityFloor: ELEMENTS.reduce((n, el) => n + (maxAffinity[el] ?? 0), 0),
    rows, demanding,
    copies: order.map(name => ({ name, n: counts.get(name) ?? 0, facts: cardFacts(name) })),
    unknown, problems, legal: problems.length === 0 && unknown.length === 0,
  };
}

/** The elements a deck is actually built out of, biggest share first — what
 * the deck row shows as its identity. A share below `floor` of the deck is a
 * splash worth naming but not a colour of the deck; below a card's worth of
 * weight it is noise and is dropped. */
export function deckElements(a: DeckAnalysis, floor = 0.5): { el: string; share: number; cards: number }[] {
  const total = ELEMENTS.reduce((n, el) => n + (a.elements[el] ?? 0), 0);
  if (!total) return [];
  return ELEMENTS
    .map(el => ({ el, share: (a.elements[el] ?? 0) / total, cards: a.elements[el] ?? 0 }))
    .filter(x => x.cards >= floor)
    .sort((x, y) => y.share - x.share);
}

/**
 * A deck as plain text, in the grammar server/decks.ts's importDeckText parses
 * back: one "<n> <card>" line per distinct card, cheapest first, with `//`
 * comment lines for the name, the source link and the maybeboard divider.
 *
 * THE ROUND TRIP IS THE POINT. This is what you paste to somebody else, into
 * algomancer.cc, or straight back into this client — so it has to be the same
 * grammar the paste box accepts and not a prettier one that only reads well.
 * engine/test/188 asserts the round trip against the real importer rather than
 * against a second copy of the format.
 */
export function deckListText(
  name: string, cards: readonly string[], maybe: readonly string[] = [], url?: string,
): string {
  const lines = (list: readonly string[]): string[] => analyzeDeck(list).copies
    .sort((x, y) => (x.facts?.mana ?? 99) - (y.facts?.mana ?? 99) || x.name.localeCompare(y.name))
    .map(c => `${c.n} ${c.name}`);
  const side = lines(maybe);
  return [
    `// ${name} — ${cards.length} cards`,
    ...(url ? [`// ${url}`] : []),
    ...lines(cards),
    ...(side.length ? ['', '// maybeboard', ...side] : []),
  ].join('\n');
}
