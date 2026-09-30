/* ── WHERE AN ANSWER LIVES ────────────────────────────────────────────────
 *
 * The owner, 2026-09-30: *"All selections should be done by tapping/clicking
 * the unit or player that is actually on the board (targeting, choosing a
 * selection) rather than with a list of buttons in the 'up next' bar. If a
 * selection needs to be made between cards that aren't in play at all … little
 * representations/images of the card can appear in the bar. I want to avoid
 * ever having the player select a card based on card NAME alone."*
 *
 * The prompt bar used to decide how to draw an option from two accidents: the
 * decision KIND (only `targets` could be answered on the board) and whether the
 * engine happened to stamp a `card` on the option (which drew a scan, even for
 * a unit standing right there). A census of 400 fuzz games found the same fact
 * — "this option is unit N" — spelled eight different ways:
 *
 *   {unit: N}  N (electricPath, payOrDecline)  "u:N"  {recall: N}
 *   {counterFrom: N}  {eraseMod: N}  {discard: i}  "h:i"  {modFrom:'hand', index}
 *
 * so Wraith's ally, Torrential Reclamation's sacrifice, Auric Ascendant's
 * recall, Divine Intervention's new target and every hand discard were all
 * dead on the board.
 *
 * This module is the ONE place that knows those spellings. It answers, per
 * option, WHERE the thing it names is: something on the board (click it), a
 * card that is not in play (a scan in the bar), or not a card at all (a
 * button). Nothing here resolves an answer — the answer is always the option's
 * INDEX, exactly as before, so saved games and replays are untouched.
 *
 * ⚠ BARE NUMBERS ARE NOT SELF-DESCRIBING. `value: u.id` (an entity), `value: i`
 * (a hand index) and `value: i` (a deck position) all appear under the SAME
 * decision kinds. So a bare number is read against live state, per DECISION:
 * a namespace is taken only when EVERY numeric option in the question agrees
 * with it (entity N exists, is on the board, and carries the option's card
 * name — or hand[N] is that card — or stack item N has that label), and only
 * when exactly one namespace does. Anything else is not guessed at: it falls
 * back to a scan (when the option carries a card) or a button. A wrong guess
 * would light a unit the answer is not about; a fallback only costs a click.
 *
 * ⚠ ADDING A SPELLING. `test/348-board-picks.test.ts` plays fuzz games and
 * fails on any card-bearing option this file cannot place while a same-named
 * card stands on the board — which is how a new card with a new encoding
 * announces itself. Teach `objectSubject` / `stringSubject` the shape.
 */
import { E } from '../engine/src/engine.ts';
import type { CardName, Decision, DecisionOption, EntityId, GameState, Seat } from '../engine/src/types.ts';
import { HIDDEN_CARD as HIDDEN } from './motion.ts';

export type Subject =
  /** a unit or spell token on the board */
  | { at: 'unit'; id: EntityId }
  /** a mod, which on the board is a badge on its host */
  | { at: 'mod'; id: EntityId; host: EntityId }
  /** a player — their life total */
  | { at: 'player'; seat: Seat }
  /** an item on the stack */
  | { at: 'stack'; id: number }
  /** a card in a hand the viewer can see */
  | { at: 'hand'; seat: Seat; index: number }
  /** a cached card */
  | { at: 'cache'; seat: Seat; uid: number }
  /** a formation spot — drawn as a drop target on the line (ui/fslot.ts) */
  | { at: 'slot' }
  /** a card that is not in play (bin, deck, a reveal, a name): a scan */
  | { at: 'card'; card: CardName }
  /** not a card at all: a mode, yes/no, an amount, a decline */
  | { at: 'button' };

/** the subjects a click on the board can land on */
export type BoardSubject = Extract<Subject, { at: 'unit' | 'mod' | 'player' | 'stack' | 'hand' | 'cache' }>;

export function isBoard(s: Subject): s is BoardSubject {
  return s.at === 'unit' || s.at === 'mod' || s.at === 'player' || s.at === 'stack'
    || s.at === 'hand' || s.at === 'cache';
}

/** the key a board element and an option meet on */
export function boardKey(s: BoardSubject): string {
  switch (s.at) {
    case 'unit': return `unit:${s.id}`;
    case 'mod': return `mod:${s.id}`;
    case 'player': return `player:${s.seat}`;
    case 'stack': return `stack:${s.id}`;
    case 'hand': return `hand:${s.seat}:${s.index}`;
    case 'cache': return `cache:${s.seat}:${s.uid}`;
  }
}

const DECLINE_KEYS = ['doneTargets', 'doneCost', 'doneMods', 'declineCost'];

const fallback = (o: DecisionOption): Subject => (o.card ? { at: 'card', card: o.card } : { at: 'button' });

/** a unit or spell token the board draws and takes clicks on */
function liveBody(s: GameState, id: EntityId): boolean {
  const en = s.entities[id];
  return !!en && !en.absent && (en.kind === 'unit' || en.kind === 'spellToken');
}

/** the names an entity answers to: its cardboard, and the face it is wearing */
function namesOf(s: GameState, id: EntityId): string[] {
  const en = s.entities[id];
  if (!en) return [];
  let face = en.card;
  try { face = new E(s).faceName(en); } catch { /* a redacted view may not know */ }
  return face === en.card ? [en.card] : [en.card, face];
}

/** does this option name this card? By its `card` when it has one, else by
 * its label (which is `u.card`, "Sacrifice X", "X (Player 2's)", …) */
function names(o: DecisionOption, candidates: readonly string[]): boolean {
  if (!candidates.length) return false;
  if (o.card) return candidates.includes(o.card);
  return candidates.some(n => n && o.label.includes(n));
}

function unitSubject(s: GameState, id: EntityId, o: DecisionOption): Subject {
  return liveBody(s, id) ? { at: 'unit', id } : fallback(o);
}

function handSubject(s: GameState, seat: Seat, index: number, o: DecisionOption): Subject {
  const card = s.players[seat]?.hand[index];
  if (card === undefined || card === HIDDEN) return fallback(o);
  return { at: 'hand', seat, index };
}

/** the object spellings (TargetRef and the cost-payment shapes) */
function objectSubject(s: GameState, dec: Decision, o: DecisionOption, v: Record<string, unknown>): Subject {
  if (DECLINE_KEYS.some(k => k in v)) return { at: 'button' };
  const num = (k: string): number | null => (typeof v[k] === 'number' ? v[k] as number : null);
  // a FormationSpot ({kind:'behind', unit}) names a place, not the unit
  if ('kind' in v && dec.kind === 'formationSlot') return { at: 'slot' };
  for (const k of ['unit', 'recall', 'counterFrom'] as const) {
    const id = num(k);
    if (id !== null) return unitSubject(s, id, o);
  }
  const mod = num('eraseMod');
  if (mod !== null) {
    const host = s.entities[mod]?.modOf;
    return host !== undefined && liveBody(s, host) ? { at: 'mod', id: mod, host } : fallback(o);
  }
  const player = num('player');
  if (player !== null) return { at: 'player', seat: player as Seat };
  const stack = num('stack');
  if (stack !== null) return s.stack.some(i => i.id === stack) ? { at: 'stack', id: stack } : fallback(o);
  const cached = v['cached'] as { seat?: unknown; uid?: unknown } | undefined;
  if (cached && typeof cached.seat === 'number' && typeof cached.uid === 'number') {
    return { at: 'cache', seat: cached.seat as Seat, uid: cached.uid };
  }
  const discard = num('discard');
  if (discard !== null) return handSubject(s, dec.seat, discard, o);
  if (v['modFrom'] === 'hand' && typeof v['index'] === 'number') return handSubject(s, dec.seat, v['index'] as number, o);
  return fallback(o);
}

/** Mindburn's "u:<id>" / "h:<index>" */
function stringSubject(s: GameState, dec: Decision, o: DecisionOption, v: string): Subject {
  const m = /^([uh]):(\d+)$/.exec(v);
  if (!m) return fallback(o);
  const n = Number(m[2]);
  return m[1] === 'u' ? unitSubject(s, n, o) : handSubject(s, dec.seat, n, o);
}

type Namespace = 'unit' | 'hand' | 'stack';

/** which namespaces a bare number could be read in, for this option */
function numberReadings(s: GameState, dec: Decision, o: DecisionOption, n: number): Set<Namespace> {
  const out = new Set<Namespace>();
  if (liveBody(s, n) && names(o, namesOf(s, n))) out.add('unit');
  const inHand = s.players[dec.seat]?.hand[n];
  if (inHand !== undefined && inHand !== HIDDEN && names(o, [inHand])) out.add('hand');
  const item = s.stack.find(i => i.id === n);
  if (item && o.label === item.label) out.add('stack');
  return out;
}

/** decision kinds whose numbers are never an entity, a hand slot or a stack id */
const NUMBER_IS_A_VALUE = new Set(['formationSlot', 'assignDamage', 'number', 'orderTriggers', 'mode']);

/**
 * Where every option of this decision lives, index-aligned with `options`.
 * Pure: the same decision over the same state always answers the same.
 */
export function optionSubjects(dec: Decision, s: GameState): Subject[] {
  // a pick-set question (Tides, Wake the Dead) has its own picker, and its
  // numbers are deck positions
  const numbersMean = dec.pickSet || NUMBER_IS_A_VALUE.has(dec.kind) ? null : bareNumberNamespace(dec, s);
  return dec.options.map((o): Subject => {
    const v = o.value;
    if (dec.kind === 'formationSlot') return { at: 'slot' };
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return objectSubject(s, dec, o, v as Record<string, unknown>);
    if (typeof v === 'string') return stringSubject(s, dec, o, v);
    if (typeof v === 'number' && numbersMean && v >= 0) {
      if (numbersMean === 'unit') return { at: 'unit', id: v };
      if (numbersMean === 'hand') return { at: 'hand', seat: dec.seat, index: v };
      return { at: 'stack', id: v };
    }
    return fallback(o);
  });
}

/** The one namespace every non-negative numeric option of this decision
 * agrees on, or null. Negative numbers are sentinels ("decline", "Done"). */
function bareNumberNamespace(dec: Decision, s: GameState): Namespace | null {
  const nums = dec.options.filter(o => typeof o.value === 'number' && (o.value as number) >= 0);
  if (!nums.length) return null;
  let agreed: Namespace[] = ['unit', 'hand', 'stack'];
  for (const o of nums) {
    const r = numberReadings(s, dec, o, o.value as number);
    agreed = agreed.filter(n => r.has(n));
    if (!agreed.length) return null;
  }
  return agreed.length === 1 ? agreed[0]! : null;
}

/**
 * The board half: which option indexes a click on each board element answers.
 * A mod is ALSO reachable through its host — the badge is small, the unit is
 * not — so a mod option is listed under both keys.
 */
export function boardIndex(dec: Decision, s: GameState, subjects = optionSubjects(dec, s)): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const put = (k: string, i: number): void => {
    const at = out.get(k);
    if (at) { if (!at.includes(i)) at.push(i); } else out.set(k, [i]);
  };
  subjects.forEach((sub, i) => {
    if (!isBoard(sub)) return;
    put(boardKey(sub), i);
    if (sub.at === 'mod') put(`unit:${sub.host}`, i);
  });
  return out;
}
