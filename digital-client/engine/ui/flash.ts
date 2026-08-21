/* DOM-free logic for the VISUAL stack: what belongs on it right now.
 *
 * The real stack (GameState.stack) is only half the story. An item nobody may
 * respond to — a haste-step card, anything played during deployment, an
 * activation outside battle, a trigger between combat sub-steps — never
 * touches `state.stack` at all: engine.ts commitItem() resolves it on the
 * spot. On screen that is no journey at all, which is exactly the playtest
 * complaint ("they happen and resolve instantly so it's very hard to track").
 *
 * So the engine hands the client a snapshot of every such item as a
 * 'stackFlash' event (rules-inert, no log line), and this module decides when
 * each one is on the visual stack and when it has had its beat. Same split as
 * ui/motion.ts and ui/sfx.ts: the arithmetic is pure and tested here, the DOM
 * layer just draws whatever `stackRows()` returns.
 *
 * Time is a plain millisecond reading (Date.now()) passed in, never read here
 * — so a test can run a whole flash queue without a clock.
 */
import type { EngineEvent, StackItem } from '../src/types.ts';

/** how long one flashed item sits on the visual stack. The ask was "at least
 * a second so that it doesn't happen too fast" — long enough to read the art
 * and the name, short enough that a deployment of six cards is not a slideshow */
export const HOLD_MS = 1200;
/** gap between two items of the same batch, so a settle() cascade arrives as
 * a sequence you can follow rather than a fan of cards appearing at once */
export const STAGGER_MS = 280;
/** the queue never runs more than this far behind the board. Past it the
 * staggering stops and the rest of the batch shares one arrival — a long
 * chain should crowd the stack, not queue up for five seconds */
export const MAX_LEAD_MS = 2200;

export interface Flash {
  /** the item exactly as it stood a moment before it resolved */
  item: StackItem;
  /** clock reading at which it appears on the visual stack */
  at: number;
  /** clock reading at which it leaves again */
  until: number;
}

/** every 'stackFlash' payload in one batch of engine events, in order */
export function flashItems(events: readonly EngineEvent[]): StackItem[] {
  const out: StackItem[] = [];
  for (const ev of events) {
    if (ev.type !== 'stackFlash') continue;
    const item = ev.data?.['item'] as StackItem | undefined;
    if (item && typeof item.id === 'number') out.push(item);
  }
  return out;
}

/**
 * Fold one action's events into the queue.
 *
 * New arrivals line up BEHIND whatever is already pending, so two clicks in
 * quick succession read as two beats rather than one pile — up to MAX_LEAD_MS,
 * after which they land together instead of drifting further from the board
 * they are supposed to be explaining.
 */
export function queueFlashes(
  existing: readonly Flash[], events: readonly EngineEvent[], now: number,
): Flash[] {
  const items = flashItems(events);
  if (!items.length) return existing as Flash[];
  const out = existing.slice();
  const seen = new Set(out.map(f => f.item.id));
  let at = now;
  for (const f of out) at = Math.max(at, f.at + STAGGER_MS);
  for (const item of items) {
    if (seen.has(item.id)) continue;   // a resync must not replay a beat
    seen.add(item.id);
    at = Math.min(at, now + MAX_LEAD_MS);
    out.push({ item, at, until: at + HOLD_MS });
    at += STAGGER_MS;
  }
  return out;
}

/** the flashes on the visual stack at `now` */
export const visibleFlashes = (list: readonly Flash[], now: number): Flash[] =>
  list.filter(f => f.at <= now && now < f.until);

/** the queue with everything that has had its beat dropped */
export const pruneFlashes = (list: readonly Flash[], now: number): Flash[] =>
  list.filter(f => now < f.until);

/** The next clock reading at which the visible set changes — what the client
 * schedules its next repaint for. null when the queue is spent. */
export function nextFlashWake(list: readonly Flash[], now: number): number | null {
  let best: number | null = null;
  for (const f of list) {
    for (const t of [f.at, f.until]) {
      if (t > now && (best === null || t < best)) best = t;
    }
  }
  return best;
}

/** one card-shaped thing on the visual stack, bottom of the stack first */
export interface StackRow {
  item: StackItem;
  /** true: it has already resolved and is being replayed for the eye */
  flashing: boolean;
  /** true: the real top of the real stack — the thing that resolves next */
  top: boolean;
}

/**
 * The visual stack: what is really on it, then whatever is having its beat.
 *
 * A flash sits ABOVE the real items because that is where it would have gone
 * had the rules given it a stop — and only the real top of the real stack
 * wears the "resolves next" mark, because a flash resolves next to nothing.
 */
export function stackRows(
  stack: readonly StackItem[], flashes: readonly Flash[], now: number,
): StackRow[] {
  const rows: StackRow[] = stack.map((item, i) => ({
    item, flashing: false, top: i === stack.length - 1,
  }));
  for (const f of visibleFlashes(flashes, now)) {
    rows.push({ item: f.item, flashing: true, top: false });
  }
  return rows;
}
