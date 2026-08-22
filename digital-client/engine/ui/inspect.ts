/* DOM-free view logic, so it can be unit-tested without a browser.
 *
 * Everything here answers a question the UI asks about game state and card
 * data — "what is this stack item actually going to do?", "will clicking this
 * ability cost me something I can't get back?" — and none of it touches the
 * document. main.ts renders the answers; test/50-ui-inspect.test.ts checks
 * them.
 */
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import type { E } from '../src/engine.ts';
import { specForSlot } from '../src/cards/dsl.ts';
import type { ActivatedAbility } from '../src/cards/dsl.ts';
import { createsOf, DECK_LIST } from '../src/cards/registry.ts';
import { matcherFor } from './glossary.ts';
import { clean, entityTextBox, switchClause } from './cardtext.ts';
import type {
  Action, CardName, Entity, EntityId, EffectPart, GameState, Seat, StackItem,
} from '../src/types.ts';

// clean/switchClause live in ui/cardtext.ts now — one implementation, so the
// stack rows and the text box can never disagree about how a soft-hyphenated
// scan line reads. Re-exported for the tests that reach them through here.
export { switchClause };

/**
 * The rules text of ONE part of a stack item, and the card it came from.
 *
 * Playtest ask: a triggered or grafted ability on the stack used to preview
 * the whole card, which for a graft stack is a wall of text that says nothing
 * about what is about to happen. A part maps back to exactly one authored
 * clause through its effect key (dsl.ts):
 *   spell:<Card>        the card itself is the effect — its printed text
 *   ability:<Card>#<i>  abilities[i]
 *   augment:<Card>#<i>  augmentText[i] (text-box [Augment] text)
 *   graft:<Card>        the card's [Switch]-marked clause
 * Returns null for a key that names nothing renderable, so callers can fall
 * back to the item label rather than print an empty row.
 */
export function partText(effectKey: string): { source: CardName; text: string; graft?: boolean } | null {
  const ci = effectKey.indexOf(':');
  if (ci < 0) return null;
  const tag = effectKey.slice(0, ci), rest = effectKey.slice(ci + 1);
  try {
    if (tag === 'spell') {
      const t = clean(getCard(rest).text);
      return t ? { source: rest, text: t } : null;
    }
    if (tag === 'graft') {
      const t = switchClause(rest);
      return t ? { source: rest, text: t, graft: true } : null;
    }
    const [name, idxStr] = rest.split('#');
    const i = Number(idxStr);
    if (!name || !Number.isInteger(i)) return null;
    const c = getCard(name);
    const ab = tag === 'ability' ? c.abilities?.[i] : tag === 'augment' ? c.augmentText?.[i] : undefined;
    if (!ab?.label) return null;
    return { source: name, text: ab.label };
  } catch { return null; }
}

/** one attributed clause of a stack item, with the X that clause itself paid */
export interface StackAbilityRow {
  source: CardName;
  text: string;
  graft?: boolean;
  /** index into item.parts — what ties the row to the clause that paid for it */
  part: number;
  /** R64: the variable cast cost THIS clause paid, defining its own X. A
   * grafted rider's X is not its carrier's (types.ts EffectPart.costPaid.x),
   * so it is attributed to the row rather than to the item. */
  x?: number;
  /** what that payment actually consumed, in words ("erased 10 cards") */
  receipt?: string;
}

/** every live part of a stack item, in resolution order, as attributed text.
 * Spent parts (a bounded graft already used this turn, a declined cost) are
 * dropped — they will do nothing, so showing them would mislead. */
export function stackAbilityRows(item: StackItem): StackAbilityRow[] {
  const out: StackAbilityRow[] = [];
  item.parts.forEach((p, i) => {
    if (p.spent) return;
    const t = partText(p.effectKey);
    if (!t) return;
    const x = p.costPaid?.x;
    const receipt = costReceipt(p.costPaid);
    out.push({ ...t, part: i, ...(x !== undefined ? { x } : {}), ...(receipt ? { receipt } : {}) });
  });
  return out;
}

/** the ActivatedAbility an activateAbility action refers to, resolving its
 * `via` (own abilities / own [Augment] text / an augment mod's donated text) */
export function abilityOf(
  state: GameState, unit: Entity, a: Extract<Action, { type: 'activateAbility' }>,
): ActivatedAbility | undefined {
  try {
    const list = a.via === undefined
      ? getCard(unit.card).abilities
      : getCard(a.via === 'augment' ? unit.card : state.entities[a.via.mod]?.card ?? '').augmentText;
    const ab = list?.[a.abilityIndex];
    return ab && ab.type === 'activated' ? ab : undefined;
  } catch { return undefined; }
}

/**
 * Should activating this ask "are you sure?" before it fires?
 *
 * Playtest report: "Sacrifice me:" abilities are very easy to fire by accident
 * during battle — you meant to pick the unit as a blocker — and there is no
 * taking it back. Two things make one safe to fire on a single click:
 *  - the cost is only mana, so nothing permanent is spent; or
 *  - the engine will stop and ask for a TARGET, which is both a moment to
 *    notice and (since R57) strictly before anything is paid.
 *
 * The target test is "will a decision actually appear", not "does the card
 * print the word target". An ability whose targets have no legal candidates
 * skips the decision entirely and pays the cost anyway — precisely the trap
 * that "up to one target" with nothing to aim at sets.
 */
export function activationNeedsConfirm(
  e: E, unit: Entity, a: Extract<Action, { type: 'activateAbility' }>,
): boolean {
  const ab = abilityOf(e.s, unit, a);
  if (!ab) return false;
  const c = ab.cost;
  const irreversible = !!(c.sacrificeSelf || c.life || c.discard
    || c.sacrificeOther || c.discardOrSacrifice || c.debt);
  if (!irreversible) return false;
  const spec = ab.effect.targets;
  if (!spec) return true;                       // nothing will stop to ask
  try {
    return e.targetCandidates(
      specForSlot(spec, 0), e.actionRegion(unit.controller), undefined, unit.controller,
    ).length === 0;
  } catch { return true; }
}

/**
 * The cards `seat` could release from their cache RIGHT NOW, by name.
 *
 * Playtest ask: a reminder before ending deployment, because the cache is a
 * zone nobody has muscle memory for and a prophecy you already paid for is
 * easy to walk past. "Playable now" is narrower than "permitted" — a fulfilled
 * prophecy still has to clear normal timing (R42) — and the legal-action list
 * is the only thing that knows both, so this reads from there rather than
 * re-deriving it. Deduped and index-ordered: one entry may be offered by
 * several actions.
 */
export function playableCachedNames(cache: { card: CardName }[], legal: Action[]): CardName[] {
  const idx = new Set(legal
    .filter((a): a is Extract<Action, { type: 'playCached' }> => a.type === 'playCached')
    .map(a => a.index));
  return [...idx].sort((x, y) => x - y).map(i => cache[i]?.card).filter((n): n is CardName => !!n);
}

/**
 * Should the client auto-pass this priority window because the thing about to
 * resolve is a trigger the player has chosen to yield to?
 *
 * Playtest 2026-08-20 ("auto yield literally isn't doing anything"): the old
 * test was `stack.every(item is a yielded trigger)`. Passing priority only
 * ever resolves the TOP of the stack, so requiring the whole stack to be
 * yielded meant that the moment anything else was on it — the opponent's
 * spell, a second unit's trigger, the very common case in a real game — the
 * chip did nothing at all. One of Bena's stacks that turn held four triggers
 * from four different units.
 *
 * The right question is about the top item only. Everything under it gets its
 * own window later, and this runs again for each.
 */
export function shouldAutoYield(
  state: GameState, seat: Seat, yielded: ReadonlySet<number>,
): boolean {
  if (!yielded.size) return false;
  // a priority window of my own, with nothing being asked of anybody
  if (state.priority !== seat || state.decision) return false;
  // R68 note: negation REMOVES the item from the stack the instant it
  // resolves, so `negated` is no longer reachable on anything in
  // GameState.stack (test/50 pins that against the live engine). The guard
  // stays anyway, and is not dead weight: the flag is still on the type, and
  // this client now MINTS negated stack items itself — ui/flash.ts stamps one
  // on every snapshot it replays for a beat — so "never silently pass through
  // a negated item" is a live sentence again, not a fossil.
  const top = state.stack[state.stack.length - 1];
  if (!top || top.negated) return false;
  return top.kind === 'triggered' && top.sourceId !== undefined && yielded.has(top.sourceId);
}

// ── card names inside prose (the log, the reveal, the stack) ──────────

/** the longest card name in the pool, in words — the window the scan slides */
const MAX_NAME_WORDS = 6;
/** punctuation that clings to a word in prose but is never part of a name */
const CLING = /^[.,!:;()'"“”‘’]+|[.,!:;()'"“”‘’]+$/g;
/** the same characters, one at a time (a /g/ regex's `test` is stateful) */
const CLING_CH = /[.,!:;()'"“”‘’]/;

/**
 * Fast reject: could a card name begin with this word at all?
 *
 * The log is rescanned on every render, 80 lines at a time, and `getCard`
 * answers "no" by THROWING — several thousand exceptions per repaint is a
 * frame budget spent on nothing. Built once, from the registry itself.
 * (Retired ALIASES are not in allCardNames() and so are not prefiltered;
 * state only ever stores canonical names, which is what prose quotes.)
 */
let nameStarts: Set<string> | null = null;
function startsAName(word: string): boolean {
  if (!nameStarts) {
    nameStarts = new Set(allCardNames().map(n => n.split(' ')[0]!.toLowerCase()));
  }
  return nameStarts.has(word.toLowerCase());
}

/** one run of a message: either a stretch of plain prose, or a card name */
export interface NameSpan {
  /** the ORIGINAL text, verbatim — the log must still read the way it reads */
  text: string;
  /** the card it names, or null for ordinary prose */
  name: CardName | null;
}

/**
 * Cut a message into spans, marking every stretch that names a known card.
 *
 * Playtest UZRG: "the log and the stack are not inspectable". The engine does
 * log X, and does log "Bena spawns Wraith" — but the log was inert prose, so
 * there was nothing to hover, nothing to right-click, and no way to find out
 * what a Wraith is at the exact moment you are being told about one.
 *
 * Leftmost-longest, up to MAX_NAME_WORDS: at each word boundary the longest
 * name that starts there wins, so "Echo of Despair" is never mistaken for
 * "Echo". Punctuation clinging to the outside of a candidate is ignored for
 * the lookup and excluded from the span, so the sentence still punctuates
 * itself outside the link.
 *
 * This is the ONE name-matcher in the client: `findCardName` (the deployment
 * reveal) is a query over the same spans rather than a second implementation
 * that can disagree with it.
 */
export function linkCardNames(msg: string): NameSpan[] {
  const out: NameSpan[] = [];
  const words: { text: string; at: number; end: number }[] = [];
  for (const m of msg.matchAll(/\S+/g)) {
    words.push({ text: m[0], at: m.index, end: m.index + m[0].length });
  }
  let cut = 0;                       // how much of msg is already emitted
  const plain = (upto: number): void => {
    if (upto > cut) out.push({ text: msg.slice(cut, upto), name: null });
    cut = upto;
  };
  for (let i = 0; i < words.length;) {
    if (!startsAName(words[i]!.text.replace(CLING, ''))) { i++; continue; }
    let hit: { name: CardName; last: number } | null = null;
    for (let len = Math.min(MAX_NAME_WORDS, words.length - i); len >= 1 && !hit; len--) {
      const cand = words.slice(i, i + len).map(w => w.text.replace(CLING, '')).join(' ');
      if (!cand) continue;
      try { getCard(cand); hit = { name: cand, last: i + len - 1 }; } catch { /* not a card */ }
    }
    if (!hit) { i++; continue; }
    // trim the clinging punctuation back OUT of the span, so the full stop
    // after a card name is not part of the link
    let start = words[i]!.at, end = words[hit.last]!.end;
    while (start < end && CLING_CH.test(msg[start]!)) start++;
    while (end > start && CLING_CH.test(msg[end - 1]!)) end--;
    plain(start);
    out.push({ text: msg.slice(start, end), name: hit.name });
    cut = end;
    i = hit.last + 1;
  }
  plain(msg.length);
  return out;
}

/**
 * The longest word-sequence in `msg` that names a known card, if any.
 *
 * The deployment reveal picks ONE scan per row, and the longest name is the
 * most specific thing the sentence said. Ties go to the first, which is the
 * order the sentence puts them in.
 */
export function findCardName(msg: string): CardName | null {
  let best: CardName | null = null, bestLen = 0;
  for (const sp of linkCardNames(msg)) {
    if (!sp.name) continue;
    const len = sp.name.split(' ').length;
    if (len > bestLen) { best = sp.name; bestLen = len; }
  }
  return best;
}

/** one row of the reveal: a card scan (or none) and the sentence(s) it covers */
export interface RevealRow { name: CardName | null; text: string }

/** drop a single trailing full stop so messages can be joined with commas */
const unstop = (s: string): string => s.trim().replace(/\.$/, '');

/**
 * Join one row's messages: "a, b, c." — with a run of the SAME message
 * collapsed to "a ×3", because three identical sentences separated by commas
 * is the verbosity we are removing, not a shorter form of it.
 */
function joinMessages(msgs: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < msgs.length;) {
    let n = 1;
    while (i + n < msgs.length && msgs[i + n] === msgs[i]) n++;
    parts.push(unstop(msgs[i]!) + (n > 1 ? ` ×${n}` : ''));
    i += n;
  }
  const out = parts.join(', ');
  return /[.!?]$/.test(out) ? out : `${out}.`;
}

/**
 * Group the deployment reveal into rows.
 *
 * Playtest 2026-08-20, Bena: "single cards create 5 full sized entries […]
 * it's good to show the full chain of events, but they don't need to take up
 * so much space." One card being deployed is one beat, but the engine narrates
 * it as several events — played, resolved, and one line per token it made —
 * and each was drawing its own full card scan.
 *
 * CONSECUTIVE messages that resolve to the same card art collapse onto a
 * single row. Consecutive, not global: the point is to compress a chain, not
 * to reorder it, so a card that comes up again later still gets its own row in
 * the place it happened.
 */
export function groupReveal(msgs: readonly string[]): RevealRow[] {
  const groups: { name: CardName | null; msgs: string[] }[] = [];
  for (const msg of msgs) {
    const name = findCardName(msg);
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.msgs.push(msg);
    else groups.push({ name, msgs: [msg] });
  }
  return groups.map(g => ({ name: g.name, text: joinMessages(g.msgs) }));
}

// ── which units can ACT right now (playtest UZRG) ─────────────────────

/**
 * The units with at least one legal activated ability, by entity id.
 *
 * Playtest report (UZRG): "units with activated abilities don't get a green
 * highlight around them indicating you can activate their abilities". The
 * affordance simply did not exist — the board's `clickable` flag means "can be
 * dragged into a formation", which is a different question with a different
 * answer, and is false whenever there is no battle.
 *
 * This is a READ of the legal-action list, never a re-derivation. `legalActions`
 * already gates on suppression (R62), the per-ability {Battle}/{Deployment}
 * marker (R49), cost payability, bounded budgets and R64's "a mandatory target
 * with no candidate is not an option". Deriving the glow a second way is how a
 * highlight ends up promising something the engine will refuse.
 */
export function activatableUnits(legal: readonly Action[]): Set<EntityId> {
  const out = new Set<EntityId>();
  for (const a of legal) if (a.type === 'activateAbility') out.add(a.entityId);
  return out;
}

/**
 * How to NAME one activateAbility option: the ability's own label, prefixed
 * with the mod that donated it when it is not the unit's own text.
 *
 * `via` is the three-way the engine uses (dsl.ts): undefined = the card's own
 * `abilities`, 'augment' = its own text-box [Augment] clause, { mod } = an
 * augment mod slid under it, whose card is the one to name.
 */
function abilityOptionLabel(
  state: GameState, unit: Entity, a: Extract<Action, { type: 'activateAbility' }>,
): string {
  try {
    if (a.via === undefined) return getCard(unit.card).abilities?.[a.abilityIndex]?.label ?? '?';
    const name = a.via === 'augment' ? unit.card : state.entities[a.via.mod]?.card;
    if (!name) return '?';
    const label = getCard(name).augmentText?.[a.abilityIndex]?.label;
    return a.via === 'augment' ? label ?? '?' : `${name}: ${label ?? '?'}`;
  } catch { return '?'; }
}

/**
 * The badge a unit wears when it has something to activate.
 *
 * The glow says "something here"; the badge says WHAT, which is the difference
 * between an affordance and a mystery. One ability names itself; several
 * collapse to a count, because the menu is one click away and a card is 70px
 * wide.
 */
export function activationBadge(
  state: GameState, unit: Entity, legal: readonly Action[],
): string | null {
  const mine = legal.filter((a): a is Extract<Action, { type: 'activateAbility' }> =>
    a.type === 'activateAbility' && a.entityId === unit.id);
  if (!mine.length) return null;
  return mine.length === 1
    ? abilityOptionLabel(state, unit, mine[0]!)
    : `${mine.length} abilities`;
}

/** the formation job this unit could be clicked for, as main.ts knows it */
export interface FormationRole {
  /** which declaration is being built right now */
  step: 'attack' | 'block';
  /** it is already standing in a column (or in the send list) */
  placed: boolean;
  /** it is the unit currently in hand, waiting for a slot */
  carrying: boolean;
}

export interface UnitClickOption {
  kind: 'formation' | 'activate';
  label: string;
  /** present exactly when kind === 'activate' */
  action?: Extract<Action, { type: 'activateAbility' }>;
}

/**
 * Everything clicking this unit could mean right now.
 *
 * The second half of the UZRG report, and the worse half. main.ts tested the
 * formation branch FIRST, so during your own declare step (or your own block
 * step) a click on your own unit always picked it up for a column and the
 * `else if` that opened the ability menu was unreachable. A {Battle}-timed
 * ability on a unit you are also attacking with therefore had no input path at
 * all — the right-click menu offers details, judge and auto-yield, but never
 * activate.
 *
 * So the two are not a precedence any more, they are a LIST: one entry means
 * do it, more than one means ask.
 */
export function unitClickOptions(
  state: GameState, unit: Entity, legal: readonly Action[],
  formation: FormationRole | null,
): UnitClickOption[] {
  const out: UnitClickOption[] = [];
  if (formation) {
    out.push({
      kind: 'formation',
      label: formation.placed ? '↩ take out of the formation'
        : formation.carrying ? '✋ put back down'
          : formation.step === 'attack' ? '⚔ pick up — put in an attack column'
            : '🛡 pick up — put in a block',
    });
  }
  for (const a of legal) {
    if (a.type !== 'activateAbility' || a.entityId !== unit.id) continue;
    out.push({ kind: 'activate', label: abilityOptionLabel(state, unit, a), action: a });
  }
  return out;
}

// ── the tokens a card creates (playtest UZRG) ─────────────────────────

/**
 * Every registered card name that is not a playable deck card — i.e. a token.
 *
 * Tokens are ordinary registry cards (spawnUnit looks them up by name), so
 * "not in DECK_LIST" is the whole definition and a new token needs no
 * bookkeeping. Resource FACES are registry cards too and nothing creates one,
 * so they are dropped. Longest first, so "Crystal 2" wins over "Crystal" on
 * the same sentence.
 */
const TOKEN_NAMES: readonly string[] = (() => {
  const playable = new Set<string>(DECK_LIST);
  return allCardNames()
    .filter(n => !playable.has(n) && !/ Resource$/.test(n) && !/^Dormant/.test(n))
    .sort((a, b) => b.length - a.length);
})();

/**
 * Token names a piece of rules text NAMES — the fallback half of
 * `tokensCreatedBy`, and inflection-tolerant.
 *
 * The bug this fixes (UZRG: "Primordial Coalescence isn't showing the Tokens
 * it creates"): the old scan built `\bWraith\b` by hand, and card text says
 * "Create two **Wraiths**". Five cards were affected. `matcherFor` is the
 * matcher ui/glossary.ts already uses for exactly this job — one regex idiom
 * for the whole client rather than a second, worse one here.
 *
 * It stays a FALLBACK. Printed text is the card's history, not its rules, so
 * it cannot see a token created by granted (R63), donated or graft-composite
 * text, and it can never see a token whose card is also in DECK_LIST (Echo of
 * Despair, Hooba-God). Only the declared `EffectDef.creates` list can.
 */
export function tokensNamedIn(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  let left = text;
  for (const name of TOKEN_NAMES) {
    const re = matcherFor({ term: name, text: '' });
    if (!re.test(left)) continue;
    out.push(name);
    left = left.replace(new RegExp(re.source, 'gi'), ' ');   // don't match it twice
  }
  return out;
}

/**
 * The tokens this card can put onto the board.
 *
 * DECLARED first (`EffectDef.creates`, R69 — registry.createsOf), because that
 * is the rules answer and a conformance test keeps it honest. The text scan is
 * only a safety net for cards whose declaration has not been written yet.
 *
 * Pass `live` and the scan reads the unit's CURRENT text box instead of the
 * printed string — symmetric with `entityTextBox`, and the reason the
 * inspector can now show the Wraiths a unit makes because something GRANTED it
 * that clause five minutes ago. Every card contributing a live clause also
 * contributes its own declarations.
 */
export function tokensCreatedBy(name: CardName, live?: { e: E; unit: Entity }): string[] {
  const out: string[] = [];
  const add = (n: string): void => { if (n && !out.includes(n)) out.push(n); };
  const declared = (card: string): void => {
    try { for (const t of createsOf(card)) add(t); } catch { /* not a registry card */ }
  };
  declared(name);
  let text = '';
  if (live) {
    let box;
    try { box = entityTextBox(live.e, live.unit); } catch { box = undefined; }
    for (const line of box?.lines ?? []) {
      if (!line.active) continue;                 // switched off (R62) — it makes nothing
      if (line.from && line.from !== name) declared(line.from);
      text += `${line.text}\n`;
    }
  } else {
    try { text = getCard(name).text; } catch { /* unknown card */ }
  }
  for (const t of tokensNamedIn(text)) add(t);
  return out;
}

// ── the erased pile, as it is SHOWN (R69 fallout) ─────────────────────

/**
 * A name that can only ever have been a token — never a real card.
 *
 * The identification is the registry's TYPE LINE ("… Token …"), which is what
 * a token is and the same test DECK_LIST is built from, so a new token needs
 * no bookkeeping here and no list of names is hardcoded.
 *
 * It is deliberately NOT "absent from DECK_LIST", the other tempting question.
 * The two differ in both directions and the type line is right both times:
 *   • Resource FACES are registry cards outside DECK_LIST that are not tokens
 *     (ui/inspect's TOKEN_NAMES has to except them by hand); the type line
 *     never confuses one for a token.
 *   • `Echo of Despair` and `Hooba-God` spawn token COPIES of themselves, so
 *     their names land in the pile for both a token and the real card. Their
 *     printed type line says Unit, not Token — so they are shown, which is
 *     what the viewer wants: the pile records names, not entities, and after
 *     the fact nothing can tell the copy from the card. Hiding a real card
 *     that is genuinely out of the game is a false negative the player cannot
 *     recover from; showing two token copies is noise they can read past.
 * The DECK_LIST check stays as a guard on that promise — a deck card is never
 * hidden — rather than as the identification; today DECK_LIST's own filter
 * already implies it.
 *
 * An unregistered name (never mind how) is not a token: it gets shown.
 */
function tokenOnlyName(name: CardName): boolean {
  let type: string;
  try { type = getCard(name).type; } catch { return false; }
  if (!/Token/.test(type)) return false;
  return !DECK_LIST.includes(name);
}

/** the erased pile as the viewer shows it: real cards, plus an honest count of
 * what was left out */
export interface ErasedPileView {
  /** the entries worth listing, in the order they were erased */
  cards: CardName[];
  /** entries dropped because that name can only be a token */
  tokensOmitted: number;
  /** the trailing line for the omitted entries — '' when nothing was hidden */
  note: string;
  /** compact count for a header or a menu label: '3', or '3 +7 tokens' */
  countLabel: string;
}

/**
 * What the erased-pile viewer lists, out of everything `PlayerState.erased`
 * records.
 *
 * R65 built the viewer to answer one question — "which REAL cards are out of
 * the game?" — and R69 then made every dying token pass through a bin and be
 * erased by the state-based sweep. Correct by the rules, and the engine's
 * record stays complete; but a Dark board buries the handful of real cards
 * under a game's worth of Wisps, Wraiths and Fireballs. So the pile keeps
 * every entry and the VIEW drops the token-only ones. Presentation, not rules.
 *
 * What counts as a token is `tokenOnlyName` above. What is dropped is COUNTED
 * and reported (`note`, `countLabel`): a viewer that silently swallows entries
 * would be a worse bug than the noisy pile it is fixing.
 */
export function erasedPileView(erased: readonly CardName[] | undefined): ErasedPileView {
  const cards: CardName[] = [];
  let tokensOmitted = 0;
  for (const n of erased ?? []) {
    if (tokenOnlyName(n)) tokensOmitted++;
    else cards.push(n);
  }
  const note = tokensOmitted
    ? `+${tokensOmitted} token${tokensOmitted === 1 ? '' : 's'}`
    : '';
  return { cards, tokensOmitted, note, countLabel: note ? `${cards.length} ${note}` : `${cards.length}` };
}

// ── X on the stack (playtest UZRG) ────────────────────────────────────

/** what a cast-time cost payment actually consumed, in words. Public under
 * R65 — erasing a bin happens in the open, and the player who just paid ten
 * cards for a spell is entitled to see the receipt while it is still resolving. */
export function costReceipt(paid: EffectPart['costPaid']): string | undefined {
  if (!paid) return undefined;
  const bits: string[] = [];
  const n = (k: number, one: string, many = `${one}s`): string => `${k} ${k === 1 ? one : many}`;
  if (paid.erased?.length) bits.push(`erased ${n(paid.erased.length, 'card')}`);
  if (paid.discarded?.length) bits.push(`discarded ${n(paid.discarded.length, 'card')}`);
  if (paid.sacrificedUnits?.length) bits.push(`sacrificed ${n(paid.sacrificedUnits.length, 'unit')}`);
  if (paid.sacrificed) bits.push(`sacrificed ${paid.sacrificed.card}`);
  if (paid.counters?.length) {
    const total = paid.counters.reduce((t, c) => t + c.n, 0);
    bits.push(`removed ${n(total, 'counter')}`);
  }
  if (paid.life) bits.push(`paid ${n(paid.life, 'life', 'life')}`);
  if (paid.debt) bits.push(`took ${n(paid.debt, 'debt', 'debt')}`);
  return bits.length ? bits.join(', ') : undefined;
}

export interface StackXRow {
  /** 'cast' = the R35 mana X the whole item was cast for;
   *  'cost' = the R64 variable cast cost ONE part paid, defining that part's X */
  kind: 'cast' | 'cost';
  x: number;
  /** index into item.parts — 'cost' only; a mana X belongs to the item */
  part?: number;
  /** the card the clause came from, when the effect key names one */
  source?: CardName;
  /** what a variable cost consumed ("erased 10 cards") */
  receipt?: string;
}

/**
 * Every X on a stack item, per part.
 *
 * Playtest report (UZRG): "it's not possible to see the X value for an effect
 * while it's on the stack". The server is innocent — view.ts never touches
 * v.stack, so both X's arrive intact and stackFlash snapshots carry them too.
 * The client threw them away: the board printed `it.card ?? it.label` and kept
 * `it.label` (the one string apply.ts rewrites to "Card (X=n)") as a tooltip,
 * and the focus viewer replaces the label with ability rows, so for any real
 * spell the string carrying X was exactly the string discarded.
 *
 * There are TWO X's and they cannot be one number: R35's mana X lives on the
 * item, while R64's variable cast cost lives on the part that paid it,
 * precisely so a grafted rider's own X does not collide with its carrier's
 * (types.ts EffectPart.costPaid.x). Spent parts are skipped — they resolve to
 * nothing, so their X is not about to matter.
 */
export function stackItemX(item: StackItem): StackXRow[] {
  const out: StackXRow[] = [];
  if (item.x !== undefined) {
    out.push({ kind: 'cast', x: item.x, ...(item.card ? { source: item.card } : {}) });
  }
  item.parts.forEach((p, i) => {
    if (p.spent) return;
    const x = p.costPaid?.x;
    if (x === undefined) return;
    const src = partText(p.effectKey)?.source;
    const receipt = costReceipt(p.costPaid);
    out.push({
      kind: 'cost', x, part: i,
      ...(src ? { source: src } : {}), ...(receipt ? { receipt } : {}),
    });
  });
  return out;
}

/** the X's as one short tag for the card on the stack ('' when there is none).
 * Every card wears its own, not just the lead — the caption only ever
 * describes one item, and a stack four deep has four X's to answer for. */
export function stackXMark(item: StackItem): string {
  const xs = stackItemX(item);
  if (!xs.length) return '';
  const uniq = [...new Set(xs.map(r => r.x))];
  return `X=${uniq.join('/')}`;
}

// ── decision-bar options (playtest UZRG) ──────────────────────────────

export interface DecisionOptionLike { label: string; card?: CardName; value: unknown }

/** the value shapes the engine uses for "stop" rather than "do" */
const DECLINE_KEYS = ['doneTargets', 'doneCost', 'doneMods', 'declineCost'];

/** a decision option whose value names something on the board (or in a public
 * zone) — the kind the player is meant to click on the table */
function isTargetRefValue(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  return ['unit', 'player', 'stack', 'cached', 'bin'].some(k => k in (v as object));
}

/** a decision option that ENDS the step instead of answering it */
function isDeclineValue(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  return DECLINE_KEYS.some(k => k in (v as object));
}

export interface OptionSplit {
  /** render as a clickable card scan (bin/cache targets, hand looks, deck tops) */
  cards: number[];
  /** names something on the board: a real button, AND still clickable there */
  refs: number[];
  /** ordinary options with no board presence */
  plain: number[];
  /** "No more targets" / "Don't pay" — last, and secondary */
  decline: number[];
}

/**
 * Split a decision's options into the four things the prompt bar draws.
 *
 * Playtest UZRG, and the expensive one: the player paid a 10-card variable
 * cost for Necromantic Rebuke and then declined the target, losing their whole
 * bin for nothing. Part of that is engine ordering, but part is this bar —
 * ref-valued options ({stack:96}) rendered NO button at all, so with min:0 the
 * only button on screen was the decline, sitting in the same spot the player
 * had just clicked ten times to pay the cost.
 *
 * So every option gets a real, labelled button, and the decline is separated
 * out to be drawn last and styled as the secondary thing it is. Order within
 * each bucket is the engine's own.
 */
export function partitionOptions(options: readonly DecisionOptionLike[]): OptionSplit {
  const split: OptionSplit = { cards: [], refs: [], plain: [], decline: [] };
  options.forEach((o, i) => {
    if (isDeclineValue(o.value)) split.decline.push(i);
    else if (o.card) split.cards.push(i);
    else if (isTargetRefValue(o.value)) split.refs.push(i);
    else split.plain.push(i);
  });
  return split;
}
