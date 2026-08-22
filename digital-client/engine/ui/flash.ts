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

/**
 * R68: the stack ids a batch of events removed from the stack WITHOUT
 * resolving, in order.
 *
 * The 'negated' event is the engine's marker for "this item left the stack and
 * did nothing" — `E.negate()` fires it, and Dream Lapse fires it for a recall,
 * which is the same fact about the item even though the card goes somewhere
 * else. It carries only `{ id }`: the item itself is detached and dropped, so
 * a client that wants to draw the thing that just got answered has to have
 * kept its own copy (see `negatedFlashItems`).
 */
export function negatedIds(events: readonly EngineEvent[]): number[] {
  const out: number[] = [];
  for (const ev of events) {
    if (ev.type !== 'negated') continue;
    const id = ev.data?.['id'];
    if (typeof id === 'number') out.push(id);
  }
  return out;
}

/**
 * Snapshots of the items a batch of events negated, for their beat.
 *
 * Before R68, negating set `item.negated = true` and LEFT the item on the
 * stack, so it sat there greyed out until a later priority round popped it —
 * slow, but you could see that your spell had been answered. R68 removes it
 * the instant the negation resolves, which is the right rule and costs the
 * player the only picture they had of it.
 *
 * That is precisely the problem this module already exists to solve (docs/11):
 * an item the rules stack no longer holds still gets a beat on the VISUAL
 * stack. The engine hands over its own `structuredClone` for the items that
 * never reached the stack at all; a negated item DID reach it, and was on this
 * client's screen a render ago, so the snapshot comes from `seen` — the
 * client's memory of what it last drew. Remembering what you drew is not
 * inventing state: an id that is missing simply gets no beat, never a wrong one.
 *
 * `negated` is stamped on the COPY, exactly as `E.negate()` stamps its own
 * detached copy, and it is what the board greys. Nothing in `GameState` ever
 * carries it any more — so this is the one and only source of a negated item
 * anywhere in the client, and deleting it would take the grey-out with it.
 */
export function negatedFlashItems(
  events: readonly EngineEvent[], seen: ReadonlyMap<number, StackItem>,
): StackItem[] {
  const out: StackItem[] = [];
  for (const id of negatedIds(events)) {
    const item = seen.get(id);
    if (item) out.push({ ...item, negated: true });
  }
  return out;
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
  remembered: ReadonlyMap<number, StackItem> = new Map(),
): Flash[] {
  // two sources, one queue: items that never reached the stack (the engine's
  // own snapshots) and items R68 took OFF it without resolving (ours)
  const items = [...flashItems(events), ...negatedFlashItems(events, remembered)];
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

/**
 * The beats that also belong in the MOTION census as phantom stack slots.
 *
 * A normal flash is an item that never touched `state.stack`, so its `s<id>`
 * key is born in the after-census and the card visibly flies onto the stack
 * (docs/11). A NEGATED beat is the mirror image: its key was really there a
 * frame ago and is really gone now, and its card is really travelling — to a
 * bin under R68, or out of existence. Handing the census a phantom would keep
 * that key alive across the diff, `stack>bin` would never pair, and the card
 * would pop into the bin instead of flying there.
 *
 * So the ghost stays on the strip and the card still makes its journey. The
 * board underneath is final either way — the beat is explanation, not a gate.
 */
export const censusFlashes = (rows: readonly StackRow[]): StackRow[] =>
  rows.filter(r => r.flashing && !r.item.negated);
