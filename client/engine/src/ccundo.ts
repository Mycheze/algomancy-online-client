/* Competitive Constructed — UNDO UNTIL DONE (doc 22 §3.6, §8 answer 2).
 *
 * The owner, 2026-11-02, choosing "Undo until Done": in a CC resource, haste
 * or deploy step the player taking it may take back their own actions in that
 * step until they press Done, and the opponent watches it happen.
 *
 * Today's undo (Annex D4.1) is defined only inside a HIDDEN segment and walks
 * the open segment's actions (server/rooms.ts `undoForSeat`, `segStartIndex`,
 * `segmentFloor`). A CC game has no hidden segment (`hiddenSegment` is null),
 * so that walk never starts. This module is the engine half of the CC walk:
 * which step is open and whose it is, and, per action, whether it can ever be
 * taken back. It is PURE (engine only, no server, no view), so the server, the
 * browser's solo runner and a test all ask the same thing.
 *
 * ── WHAT A CC UNDO MAY REWIND ────────────────────────────────────────────
 *
 * Only the trailing run of the asking seat's OWN actions inside the OPEN step
 * (`sequentialStep`), and only back to the first of them that is not a
 * barrier. Nothing before the step began, so never past a Done: a Done ends
 * the step and opens the next one (the other seat's, or the next step), and
 * the walk only ever looks at the step open now.
 *
 * A BARRIER (`CcBarrier`) is an action that stands, and everything before it
 * with it. Measured off the action's own before/after boards, never off a list
 * of cards:
 *
 *   'done'     it ended the step (donePlanning / doneHaste / doneDeploying, a
 *              concede, anything that moved the game out of the step).
 *   'other'    it is the OTHER seat's action (in CC the step's owner is the
 *              only seat that may act in it, so this is the other seat
 *              answering a question one of the owner's actions raised: taking
 *              the owner's action back would take their answer with it).
 *   'asks'     it left a question standing for the other seat.
 *   'fix'      an agreed fix (BL-46): the server's own floor governs it.
 *   'random'   it moved the RNG stream (a shuffle, a random pick).
 *   'deck'     a deck or recycle pile lost a card or changed order: a draw,
 *              a search, a mill, a card put on top. Cards ADDED to the
 *              bottom (a recycle, the cards a glimpse sends back) do not
 *              count: the player already saw them.
 *   'seen'     it showed someone hidden cards: a 'glimpsed' or 'revealed'
 *              event, or a looked-at hand (`seenHand`).
 *
 * WHAT CAN HAPPEN INSIDE THESE STEPS (checked 2026-11-02, the report to the
 * owner): the RESOURCE step holds recycle / activate / exchange / done, none
 * of which draws, shuffles or reveals (a recycle adds a public card to the
 * bottom of the pile; an activation's affinity Shard is public); debt is paid
 * inside the Done itself. The HASTE step and DEPLOYMENT play cards and
 * abilities, and those CAN draw, search, shuffle, glimpse, cache off the deck
 * and look at a hand — every one of which is a barrier above. So the resource
 * step is always fully undoable up to Done; a haste or deploy step is undoable
 * back to its latest barrier.
 *
 * The server keeps a second, MEASURED floor beside this one and must apply
 * both: server/seen.ts `seenBy` asks whether what each seat was shown
 * depended on hidden cards (CR D4.3). Outside a hidden segment it is run with
 * `{ frozen: null, holding: false }`, and in CC the floor is the latest action
 * that showed EITHER seat a hidden card (both watch every event live).
 */
import { E, planningStep } from './engine.ts';
import type { Action, EngineEvent, GameState, Seat } from './types.ts';

/** the open CC step and the seat taking it, or null (no CC game, not in one of
 * the three steps, or between turns / while both are bottoming) */
export interface SequentialStep {
  /** `${turn}:${step}:${seat}` — one per seat per step per turn */
  key: string;
  step: 'plan' | 'haste' | 'deploy';
  seat: Seat;
}

export function sequentialStep(s: GameState): SequentialStep | null {
  if (!s.sequential || s.phase === 'gameover' || s.winner !== null) return null;
  const step = planningStep(s);
  if (!step) return null;
  const e = new E(s);   // queries only
  const may = step === 'plan' ? (x: Seat) => e.planning(x) : step === 'haste' ? (x: Seat) => e.hasting(x) : (x: Seat) => e.deploying(x);
  for (const seat of [s.initiative, 1 - s.initiative] as Seat[]) {
    if (may(seat)) return { key: `${s.turn}:${step}:${seat}`, step, seat };
  }
  return null;
}

export type CcBarrier = 'done' | 'other' | 'asks' | 'fix' | 'random' | 'deck' | 'seen';

/** What one applied action means to a CC undo. Derived, cheap, and stored by
 * the server parallel to its log the way `segSeen` is (rebuilt on restore). */
export interface CcUndoMark {
  /** the open step the action was taken in (`sequentialStep(before).key`), or null */
  key: string | null;
  seat: Seat;
  /** why it can never be taken back, or null */
  barrier: CcBarrier | null;
  /** it left a decision standing (the next step may open on a question) */
  leftDecision: boolean;
  /** it was an answer (`decide`) */
  decide: boolean;
}

const PILES = (s: GameState): (readonly string[])[] =>
  [s.sharedDeck ?? [], s.sharedRecycled ?? [], ...(s.decks ?? []), ...(s.recycled ?? [])];

/** `after` is `before` with zero or more cards appended at the end */
function onlyAppended(before: readonly string[], after: readonly string[]): boolean {
  if (after.length < before.length) return false;
  for (let i = 0; i < before.length; i++) if (after[i] !== before[i]) return false;
  return true;
}

export function ccUndoMark(before: GameState, action: Action, after: GameState, events: readonly EngineEvent[]): CcUndoMark {
  const open = sequentialStep(before);
  const mark = (barrier: CcBarrier | null): CcUndoMark =>
    ({ key: open?.key ?? null, seat: action.seat, barrier, leftDecision: after.decision !== null, decide: action.type === 'decide' });
  if (!open) return mark(null);
  if (action.type === 'amend') return mark('fix');
  if (action.seat !== open.seat) return mark('other');
  if (sequentialStep(after)?.key !== open.key) return mark('done');
  if (after.decision && after.decision.seat !== action.seat) return mark('asks');
  if (after.rngState !== before.rngState) return mark('random');
  const b = PILES(before), a = PILES(after);
  if (b.length !== a.length || b.some((p, i) => !onlyAppended(p, a[i]!))) return mark('deck');
  if (events.some(ev => ev.type === 'glimpsed' || ev.type === 'revealed')
    || JSON.stringify(before.seenHand) !== JSON.stringify(after.seenHand)) return mark('seen');
  return mark(null);
}

/**
 * The CC undo window for `seat`, over the marks of the whole log and the
 * board now: the index of the EARLIEST action an undo may take back, or
 * `marks.length` when there is nothing to undo. The server undoes the LAST of
 * `[floor, marks.length)` per press (one at a time, as D4.1), each a splice
 * and rebuild under its own existing gates (`spliceable`, `undoActionAt`, the
 * agreed-fix floor, the measured seen floor).
 *
 * Not this seat's step now, or not a CC game: nothing. A step that opened on
 * a question (a start-of-deployment trigger) keeps the answers to it, as
 * D4.1's `segmentFloor` does: what the step did as it began is not the
 * player's to take back.
 */
export function ccUndoFloor(marks: readonly CcUndoMark[], seat: Seat, now: GameState): number {
  const open = sequentialStep(now);
  if (!open || open.seat !== seat) return marks.length;
  // the step's own actions: the trailing run with its key
  let start = marks.length;
  while (start > 0 && marks[start - 1]!.key === open.key) start--;
  // it opened on a question: the leading run of answers is the step's
  // business (nobody else may act while a question stands, so nothing can be
  // interleaved into that run, and it ends at the first non-answer)
  if (start > 0 && marks[start - 1]!.leftDecision) {
    while (start < marks.length && marks[start]!.decide) start++;
  }
  let floor = marks.length;
  while (floor > start) {
    const m = marks[floor - 1]!;
    if (m.seat !== seat || m.barrier !== null) break;
    floor--;
  }
  return floor;
}
