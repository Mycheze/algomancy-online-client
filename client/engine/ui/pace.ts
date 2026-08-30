/* R150 / CT-28: HOW FAST THE TABLE IS ALLOWED TO MOVE.
 *
 * Playtest #94 (SMVJ): *"We need a 'max speed' that the gamestate can
 * resolve/put things onto the stack. When someone has auto pass on and has
 * nothing left to do, it's impossible to keep up with what's going on
 * currently. Things should go onto the stack and then resolve at a max speed
 * of 1 thing per second, I think."*
 *
 * WHY THIS IS NOT IN THE ENGINE
 *
 * The engine is a PURE reducer. A delay inside it would make every test and
 * every replay time-dependent, and `server/replay-room.ts` — the forensics
 * tool that pushes a saved action log through the current engine — would stop
 * being a straight-line function of the log. So the ceiling is a CLIENT
 * concern, and it goes exactly where the client already puts pacing: a queue
 * with the clock passed in (ui/flash.ts does the same for stack beats).
 *
 * WHAT WAS ALREADY THERE, AND WHY IT WAS NOT ENOUGH
 *
 * ui/flash.ts paces the story WITHIN one server batch: a combat damage step
 * arrives as one `update` and is let out one stage at a time. But a resolving
 * stack is not one batch — it is one server `update` PER RESOLUTION, and each
 * new batch REPLACES the beat queue by design (see queueBeats). With auto-pass
 * on at both seats, those updates arrive back to back at machine speed, every
 * one of them cancelling the explanation of the one before. The missing knob
 * is BETWEEN batches, which is this file.
 *
 * THE ONE THING THIS MUST NEVER DO
 *
 * Hold back a state the player has to act on. The gate below (`holdable`) is
 * the whole safety argument, and it is deliberately conservative: an update is
 * eligible to be held ONLY when the player is not being asked anything — no
 * decision of theirs in the view, no legal action at all, or auto-pass armed
 * (which is the player having said, out loud, "do not ask me about these
 * windows"). Everything else surfaces at once — and surfacing is a FLUSH, not
 * a jump-the-queue: an urgent update drags the whole backlog onto the screen
 * ahead of itself, in order, so the client can never be showing a state older
 * than the one it is asking the player about.
 *
 * Time is a plain millisecond reading passed in, never read here, so a test
 * can drain a whole queue without a clock. Same rule as ui/flash.ts.
 */

/** The ceiling, in milliseconds: the owner's "1 thing per second". ONE named
 * constant — the interval is not to be spelled out anywhere else. */
export const PACE_MS = 1000;

/**
 * How far behind the server the queue is ever allowed to fall, expressed in
 * paced items. Past it the spacing collapses and the backlog arrives together
 * rather than drifting further from the table it is supposed to be explaining
 * — the same bounded-lag rule (and the same reason) as flash.ts MAX_LEAD_MS.
 */
export const PACE_MAX_HELD = 12;

/** one queued item and the clock reading it surfaces at */
export interface Paced<T> { item: T; at: number }

/**
 * Everything the hold decision looks at. All five come off the arriving
 * message and the local UI; none of them is wall-clock.
 */
export interface PaceGate {
  /** this update is the echo of something THIS client sent — never delayed,
   * or the throttle would be adding latency to the player's own input */
  mine: boolean;
  /** the view carries a decision. server/view.ts redacts a decision that is
   * not yours to null, so a decision the client can see is always MINE */
  askedOfMe: boolean;
  /** how many legal actions the server published for this seat */
  legal: number;
  /**
   * This window is going to be answered without asking the player: the
   * Pass-all chip is armed, or the auto-pass PREFERENCE is on and passing is
   * the only legal action. Either way they have said these windows are not to
   * be put to them, so holding one costs them nothing and buys a readable
   * second per resolution where `sendAutoPass` gave them 280ms — which is the
   * whole ask. The caller decides which of the two it is (ui/main.ts); the
   * preference alone is deliberately not enough, because it does not fire on a
   * window that offers a real choice.
   */
  autoPassArmed: boolean;
  /** the game is decided — the post-game screen is not something to pace */
  over: boolean;
}

/**
 * May this update wait its turn?
 *
 * The negative form is the one that matters: this returns false — surface it
 * NOW — for every state the player could possibly act on. That is the answer
 * to "the throttle must never leave the client behind the server when it is
 * that player's turn to act": a state that is the player's turn has either a
 * decision of theirs or a non-empty legal list, and the only way a non-empty
 * legal list is held is when the player has themselves armed auto-pass.
 */
export function holdable(g: PaceGate): boolean {
  if (g.mine || g.askedOfMe || g.over) return false;
  return g.legal === 0 || g.autoPassArmed;
}

/**
 * The queue, plus the one piece of history it cannot do without.
 *
 * ⚠ `last` is not bookkeeping — it is the whole rate limit. A queue that
 * remembers only what is still WAITING paces nothing in the case this exists
 * for: server updates that arrive a few hundred ms apart empty the queue
 * between arrivals, so every one of them finds it empty and goes straight out.
 * (Caught in a real browser against a real two-seat game, not by the unit
 * tests, which enqueued a burst before draining and so never emptied it. The
 * tests below now cover the drip as well as the burst.)
 *
 * Spacing is measured from the last RELEASE, so the ceiling is a real
 * "1 per second", not "1 per second within a burst".
 */
export interface PaceQueue<T> {
  /** items still waiting, in arrival order */
  queue: Paced<T>[];
  /** the `at` of the most recently released item — the floor the next held
   * one is spaced from. Starts at -Infinity so the first arrival of a session
   * is never delayed. */
  last: number;
}

export const emptyPace = <T>(): PaceQueue<T> => ({ queue: [], last: -Infinity });

/**
 * Fold one arriving update into the queue.
 *
 * `hold: false` (i.e. `!holdable(...)`) does not jump the queue — it COLLAPSES
 * it: everything already waiting is re-stamped `now` and this item lands
 * behind it. Order is preserved, the backlog is spent, and the client is
 * showing the newest state by the end of the same drain.
 *
 * `hold: true` lines up one PACE_MS behind whatever went out (or is due to go
 * out) last, clamped so the queue can never run more than PACE_MAX_HELD
 * intervals behind the table.
 */
export function pace<T>(q: PaceQueue<T>, item: T, now: number, hold: boolean): PaceQueue<T> {
  if (!hold) {
    return { queue: [...q.queue.map(p => ({ item: p.item, at: now })), { item, at: now }], last: q.last };
  }
  const tail = q.queue[q.queue.length - 1];
  const floor = tail ? tail.at : q.last;
  const at = Math.min(Math.max(now, floor + PACE_MS), now + PACE_MS * PACE_MAX_HELD);
  return { queue: [...q.queue, { item, at }], last: q.last };
}

/** Everything whose moment has come, in order, and what is left waiting.
 * `at` is non-decreasing by construction, so this is a prefix — taken as one
 * explicitly, because releasing out of order would reorder game states.
 *
 * The floor moves to the last released item's own `at`, not to `now`: timer
 * jitter must not let the cadence drift slower and slower. */
export function paceDue<T>(q: PaceQueue<T>, now: number): { out: T[]; rest: PaceQueue<T> } {
  let i = 0;
  while (i < q.queue.length && q.queue[i]!.at <= now) i++;
  const gone = q.queue.slice(0, i);
  return {
    out: gone.map(p => p.item),
    rest: { queue: q.queue.slice(i), last: gone.length ? gone[gone.length - 1]!.at : q.last },
  };
}

/** The skip / fast-forward affordance: everything, right now, in one step.
 * A player who does not want the pacing is not held hostage by it, and a
 * player who has already read it can jump straight to the live state.
 *
 * The floor is left where it was rather than advanced to the skipped items'
 * future moments: the player has just said "stop making me wait", and holding
 * the next arrival for a second they already declined would be the throttle
 * arguing with them. */
export function paceFlush<T>(q: PaceQueue<T>): { out: T[]; rest: PaceQueue<T> } {
  return { out: q.queue.map(p => p.item), rest: { queue: [], last: q.last } };
}

/** The next clock reading at which something surfaces — what the client sets
 * its timer for. null when nothing is waiting. */
export function paceWake<T>(q: PaceQueue<T>, now: number): number | null {
  for (const p of q.queue) if (p.at > now) return p.at;
  return null;
}

/** How many updates are still being held — what the skip chip counts. */
export const paceHeld = <T>(q: PaceQueue<T>, now: number): number =>
  q.queue.reduce((n, p) => (p.at > now ? n + 1 : n), 0);
