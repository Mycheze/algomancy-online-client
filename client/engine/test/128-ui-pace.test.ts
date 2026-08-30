/* R150 / CT-28 — the client's drain scheduler (ui/pace.ts).
 *
 * Playtest #94 (SMVJ): *"We need a 'max speed' that the gamestate can
 * resolve/put things onto the stack. When someone has auto pass on and has
 * nothing left to do, it's impossible to keep up with what's going on."*
 *
 * Pacing is exactly the kind of thing that gets "fixed" untestably — a
 * setTimeout inside a socket handler, reachable only by playing a whole game
 * over a real socket. So the decision lives in a pure module with the clock
 * passed IN, and every test below drives an injected `now`. Nothing here
 * sleeps, and nothing here touches the DOM or a WebSocket.
 *
 * §3 is the safety property and the reason this can ship at all: the throttle
 * may never leave the client showing a state older than one the local player
 * has to act on.
 *
 * ⚠ §1's DRIP tests exist because the first version of this module failed in a
 * real browser and passed here. It kept only the items still waiting, so a
 * queue that emptied between arrivals had nothing to space the next one from
 * and every update went straight out — which is precisely the shape a real
 * server produces. The burst tests could not see it. Both shapes are covered
 * now, and `PaceQueue.last` is what makes the drip work.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PACE_MAX_HELD, PACE_MS, emptyPace, holdable, pace, paceDue, paceFlush, paceHeld, paceWake,
  type PaceQueue,
} from '../ui/pace.ts';

/** the injected clock: a plain number a test moves by hand */
const T0 = 1_000_000;

/** N holdable updates arriving in the same instant (a server that answers
 * several times before the client has painted once) */
function burst(n: number, now = T0): PaceQueue<string> {
  let q = emptyPace<string>();
  for (let i = 0; i < n; i++) q = pace(q, `u${i}`, now, true);
  return q;
}

// ── 1. the drain scheduler ───────────────────────────────────────────────
//
// The whole ask, stated as arithmetic: N events, an injected clock, one item
// per interval — in a burst AND in a drip.

test('R150 #94: a BURST of updates surfaces ONE per PACE_MS, on an injected clock', () => {
  const q = burst(4);
  // the first arrival is never delayed: the player must not wait to be told
  // about a board they can already see
  const t0 = paceDue(q, T0);
  assert.deepEqual(t0.out, ['u0'], 'the first arrival is immediate');
  assert.equal(t0.rest.queue.length, 3);

  let rest = t0.rest;
  for (let i = 1; i <= 3; i++) {
    const early = paceDue(rest, T0 + i * PACE_MS - 1);
    assert.deepEqual(early.out, [], `u${i} is still held one ms before its moment`);
    const due = paceDue(rest, T0 + i * PACE_MS);
    assert.deepEqual(due.out, [`u${i}`], `u${i} surfaces at exactly +${i}s, and alone`);
    rest = due.rest;
  }
  assert.equal(rest.queue.length, 0, 'the queue is spent');
});

test('R150 #94: a DRIP is throttled too — the queue emptying is not a reset', () => {
  // THE BROWSER BUG. Updates 300ms apart, each fully drained before the next
  // arrives. A queue that remembers only what is waiting sees an empty queue
  // every time and paces nothing.
  let q = emptyPace<string>();
  const surfaced: { item: string; at: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const now = T0 + i * 300;
    q = pace(q, `d${i}`, now, true);
    for (const item of paceDue(q, now).out) surfaced.push({ item, at: now });
    q = paceDue(q, now).rest;
  }
  assert.deepEqual(surfaced.map(s => s.item), ['d0'],
    'only the first of four went out on arrival; the rest are waiting their turn '
    + '(the pre-fix module surfaced all four instantly and this said [d0,d1,d2,d3])');
  assert.equal(paceHeld(q, T0 + 900), 3, 'three updates are being held');
  // and they come out one second apart from the FIRST release, not from now
  assert.deepEqual(paceDue(q, T0 + PACE_MS).out, ['d1']);
  assert.deepEqual(paceDue(q, T0 + 3 * PACE_MS).out, ['d1', 'd2', 'd3']);
});

test('R150 #94: a lone update after a long quiet spell is NOT delayed', () => {
  // the floor is a rate limit, not a cooldown: nobody waits a second to be
  // shown the only thing that has happened in a minute
  let q = emptyPace<string>();
  q = pace(q, 'a', T0, true);
  q = paceDue(q, T0).rest;
  q = pace(q, 'b', T0 + 60_000, true);
  assert.deepEqual(paceDue(q, T0 + 60_000).out, ['b'], 'straight through');
});

test('R150 #94: PACE_MS is the single named knob, and it is the owner\'s one second', () => {
  assert.equal(PACE_MS, 1000,
    'the owner asked for "a max speed of 1 thing per second" — change this constant, not the callers');
});

test('R150 #94: the wake time is the next moment the screen changes, then null', () => {
  const q = burst(3);
  assert.equal(paceWake(q, T0), T0 + PACE_MS, 'the timer is set for the next release, not a poll');
  const { rest } = paceDue(q, T0 + PACE_MS);
  assert.equal(paceWake(rest, T0 + PACE_MS), T0 + 2 * PACE_MS);
  assert.equal(paceWake(emptyPace(), T0), null, 'a spent queue arms no timer at all');
});

test('R150 #94: the queue never falls further than PACE_MAX_HELD intervals behind', () => {
  const q = burst(PACE_MAX_HELD + 6);
  const last = q.queue[q.queue.length - 1]!;
  assert.equal(last.at, T0 + PACE_MS * PACE_MAX_HELD,
    'past the clamp the spacing collapses — a long chain crowds the screen rather than '
    + 'drifting minutes behind the table (flash.ts MAX_LEAD_MS, same reason)');
  for (let i = 1; i < q.queue.length; i++) {
    assert.ok(q.queue[i]!.at >= q.queue[i - 1]!.at, 'release order is arrival order');
  }
});

test('R150 #94: released updates keep arrival order, so game states never reorder', () => {
  assert.deepEqual(paceDue(burst(3), T0 + 10 * PACE_MS).out, ['u0', 'u1', 'u2']);
});

test('R150 #94: timer jitter cannot make the cadence drift slower', () => {
  // the floor advances to the released item's own `at`, not to the wall clock
  // the timer happened to fire at
  const q = burst(3);
  const late = paceDue(q, T0 + PACE_MS + 400);   // the timer fired 400ms late
  assert.deepEqual(late.out, ['u0', 'u1']);
  assert.equal(late.rest.last, T0 + PACE_MS, 'the floor is the schedule, not the jitter');
});

// ── 2. skip / fast-forward ───────────────────────────────────────────────
//
// A player who does not want the pacing must not be held hostage by it.

test('R150 #94: skip flushes the whole queue to the live state in ONE step', () => {
  const { out, rest } = paceFlush(burst(5));
  assert.deepEqual(out, ['u0', 'u1', 'u2', 'u3', 'u4'],
    'every held update, in order, in a single drain');
  assert.deepEqual(rest.queue, [], 'and nothing is left waiting');
  assert.equal(paceWake(rest, T0), null, 'so no timer survives the skip');
});

test('R150 #94: a skip does not then make the player wait for the NEXT update', () => {
  const rest = paceFlush(burst(4)).rest;
  const next = pace(rest, 'after', T0 + 5, true);
  assert.deepEqual(paceDue(next, T0 + 5).out, ['after'],
    'they just said "stop making me wait"; the throttle does not argue');
});

test('R150 #94: the skip chip counts what is actually still held', () => {
  const q = burst(4);
  assert.equal(paceHeld(q, T0), 3, 'u0 is already due; three are waiting');
  assert.equal(paceHeld(q, T0 + 2 * PACE_MS), 1);
  assert.equal(paceHeld(q, T0 + 9 * PACE_MS), 0, 'nothing held ⇒ no chip');
});

// ── 3. the safety property ───────────────────────────────────────────────
//
// THE THROTTLE MAY NEVER WITHHOLD A STATE THE LOCAL PLAYER MUST ACT ON.
//
// Two halves: the gate never marks such a state holdable, and an un-holdable
// arrival FLUSHES the backlog ahead of itself instead of jumping the queue —
// so the client cannot be painting an old board while asking a live question.

const GATE = { mine: false, askedOfMe: false, legal: 0, autoPassArmed: false, over: false };

test('R150 #94: a decision of MINE is never held', () => {
  assert.equal(holdable({ ...GATE, askedOfMe: true }), false,
    'server/view.ts nulls a decision that is not yours, so a visible decision is always mine');
});

test('R150 #94: a state with legal actions is never held unless auto-pass will answer it', () => {
  assert.equal(holdable({ ...GATE, legal: 3 }), false,
    'three things I could do is my turn, whatever else is going on');
  assert.equal(holdable({ ...GATE, legal: 3, autoPassArmed: true }), true,
    'auto-pass is the player saying "do not put these windows to me" — holding one '
    + 'gives them a readable second instead of 280ms, which IS the ask');
});

test('R150 #94: my OWN action\'s echo is never held — the throttle adds no input latency', () => {
  assert.equal(holdable({ ...GATE, mine: true }), false);
  assert.equal(holdable({ ...GATE, mine: true, autoPassArmed: true }), false,
    'even with auto-pass armed: I clicked, so I am waiting on this one');
});

test('R150 #94: the game ending is never held', () => {
  assert.equal(holdable({ ...GATE, over: true }), false);
  assert.equal(holdable({ ...GATE, over: true, autoPassArmed: true }), false);
});

test('R150 #94: the ONE thing that is held is a state I cannot act on at all', () => {
  assert.equal(holdable(GATE), true,
    'no decision, no legal action, not mine, not over — the opponent is resolving '
    + 'their stack and I am a spectator. This is #94\'s whole scenario.');
});

test('R150 #94: an urgent arrival FLUSHES the backlog rather than jumping it', () => {
  const held = burst(3);                       // three spectator updates, paced out to +2s
  assert.equal(paceHeld(held, T0), 2);
  // …and now the server asks me something. It must not appear on top of a
  // board two states old, and it must not wait behind two seconds of pacing.
  const q = pace(held, 'ASK', T0 + 5, false);
  const { out, rest } = paceDue(q, T0 + 5);
  assert.deepEqual(out, ['u0', 'u1', 'u2', 'ASK'],
    'the whole backlog surfaces WITH the question, in order — the client is never '
    + 'behind the server on a state the player has to act on');
  assert.deepEqual(rest.queue, [], 'and the queue is spent, so nothing lingers behind the ask');
});

test('R150 #94: …and that is exactly what the gate produces for a real ask', () => {
  // the two pieces wired together the way ui/main.ts wires them
  const q = pace(burst(2), 'ASK', T0 + 1, holdable({ ...GATE, askedOfMe: true }));
  assert.equal(paceHeld(q, T0 + 1), 0, 'nothing is held once a question for me arrives');
});
