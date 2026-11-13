/* CT-523 / report #323 — THE AUTO-PASS TOGGLE AND THE YIELD STOP THE CLOCK TOO.
 *
 * The owner, report #323 (room SHXD, 2026-11-03): *"When 'all passing' your
 * clock still ticks down and it shouldn't."* And his rule, 2026-11-05: *"the
 * clock should only tick down when there's an action for you to take. When
 * you're holding up the game. So if you're 'all passed' and the stack is just
 * ticking down or the game is moving through its steps (and you have no
 * actions you can legally take), the clock must not tick down."*
 *
 * WHAT WAS WRONG. Three things in the browser pass a window by themselves
 * (ui/passrelease.ts autoPassDecision): the standing Pass all / Pass through
 * stack, the auto-pass TOGGLE (C4: "pass whenever passing is my only legal
 * action") and the auto-YIELD (#2: the top of the stack is a trigger of a unit
 * I yield to). Only the first ever reached the server. So in exactly the
 * windows the rule names — the stack resolving, nothing the seat can do but
 * pass, the client answering for it — the server billed the seat for the
 * client's pace hold (PACE_MS), its stagger (STAGGER_MS) and the round trip:
 * two seconds and more a window, every window of every resolving stack. Room
 * SHXD's third battle has six such windows per seat in one resolving stack
 * ([72]-[83]). The 2026-11-05 rebuild armed Pass all and so never met it.
 *
 * NOW the browser tells the server its toggle and its yields (`autopass`,
 * soft, like `passall`), the server asks the client's own `autoPassPlan`, and
 * a window that plan answers is stamped and unbilled exactly as a Pass-all
 * window is — with the same backstop behind it.
 *
 * §1 negative control: the toggle off, a pass-only window is billed
 * §2 the toggle on, the same window is not — and the backstop passes it
 * §3 the toggle does not answer a window with a real choice: billed
 * §4 a yielded trigger on top: not billed
 * §5 full control and the report dialog each put the seat back on the clock
 *
 * Driven in-process on a real Room, as 353b and 1145 are. Seeds 124200-124299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { give, giveResources, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';
import type { Room } from '../rooms.ts';

process.env['ALGO_GAMES_DIR'] = mkdtempSync(join(tmpdir(), 'algo-1242-'));
const {
  createRoom, passAllDue, setAutoPass, setFullControl, setReportHold, settleClock, PASS_ALL_BACKSTOP_MS,
} = await import('../rooms.ts');

/** a battle window in which `seat` has priority; `emptyHands` makes passing
 * its only legal action (as 353b) */
function windowState(seed: number, attacker = 'Oorblak'): { h: Harness; s: GameState; seat: Seat; atk: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, attacker);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const e = new E(h.state);
  e.player(0).hand = []; e.player(1).hand = [];
  e.settle();
  return { h, s: h.state, seat: h.state.priority as Seat, atk };
}

function roomAt(seed: number, s: GameState): Room {
  const room = createRoom(`P${seed}`, seed);
  room.state = s;
  room.sockets = [{} as never, {} as never];
  settleClock(room);
  return room;
}

test('§1 negative control: the toggle off, a pass-only window is billed', () => {
  const { s, seat } = windowState(124200);
  assert.deepEqual(legalActions(s, seat).map(a => a.type), ['passPriority'], 'fixture: a pass-only window');
  const room = roomAt(124200, s);
  assert.equal(room.clockRun[seat], true, 'nothing answers this window for the seat, so it is the seat\'s time');
});

test('§2 the toggle on: a pass-only window is not billed, and the backstop passes it', () => {
  const { s, seat } = windowState(124201);
  const room = roomAt(124201, s);
  assert.equal(setAutoPass(room, seat, { pref: true, yields: [] }), true, 'the toggle reached the room');
  settleClock(room);
  assert.equal(room.clockRun[seat], false,
    'the toggle passes this window for the seat (passing is all it can do): the owner — "the clock must not tick down"');
  assert.equal(room.clockRun[1 - seat], false, 'and the other seat has nothing to do in it either');
  // the backstop, exactly as for Pass all: a tab that never sends the pass
  // cannot hold a table whose clock has stopped
  room.passAllWait[seat]!.since -= PASS_ALL_BACKSTOP_MS + 10;
  assert.equal(passAllDue(room, Date.now()), seat, 'the server passes for the seat once the window is overdue');
  // and turning it off bills again
  assert.equal(setAutoPass(room, seat, null), true);
  settleClock(room);
  assert.equal(room.clockRun[seat], true, 'toggle off: billed again');
});

test('§3 the toggle does not answer a window with a real choice: billed', () => {
  const { h, seat } = windowState(124202);
  give(h, seat, 'Flame Shield');
  giveResources(h, seat, 'fire', 6);
  const legal = legalActions(h.state, seat);
  assert.ok(legal.some(a => a.type !== 'passPriority'), `fixture: the window offers more than a pass (${[...new Set(legal.map(a => a.type))]})`);
  const room = roomAt(124202, h.state);
  setAutoPass(room, seat, { pref: true, yields: [] });
  settleClock(room);
  assert.equal(room.clockRun[seat], true, 'the toggle passes only when passing is the only legal action — this window is the seat\'s');
  assert.equal(room.passAllWait[seat], null, 'and nothing is due for the backstop');
});

test('§4 a yielded trigger on top: the yield answers the window, so it is not billed', () => {
  // Flamebreath Initiate's attack trigger goes on the stack, and the attacker
  // has priority over it with nothing else to do
  const { s: y, seat, atk } = windowState(124203, 'Flamebreath Initiate');
  const top = y.stack[y.stack.length - 1];
  assert.ok(top && top.kind === 'triggered' && top.sourceId === atk,
    `fixture: the attack's trigger is on top (${JSON.stringify(y.stack.map(i => [i.kind, i.sourceId]))})`);
  assert.deepEqual(legalActions(y, seat).map(a => a.type), ['passPriority'], 'fixture: pass-only');
  const room = roomAt(124203, y);
  assert.equal(room.clockRun[seat], true, 'negative control: no yield, billed');
  setAutoPass(room, seat, { pref: false, yields: [99999] });
  settleClock(room);
  assert.equal(room.clockRun[seat], true, 'a yield to some other unit does not answer this window');
  setAutoPass(room, seat, { pref: false, yields: [atk] });
  settleClock(room);
  assert.equal(room.clockRun[seat], false, 'yielded to the unit whose trigger is on top: not billed');
});

test('§5 full control and the report dialog each put the seat back on the clock', () => {
  const { s, seat } = windowState(124204);
  const room = roomAt(124204, s);
  setAutoPass(room, seat, { pref: true, yields: [] });
  settleClock(room);
  assert.equal(room.clockRun[seat], false, 'fixture: unbilled under the toggle');
  setFullControl(room, seat, true);
  settleClock(room);
  assert.equal(room.clockRun[seat], true, 'full control: nothing acts for the seat, so the window is its own');
  assert.equal(room.passAllWait[seat], null, 'and the backstop does not pass for it');
  setFullControl(room, seat, false);
  settleClock(room);
  assert.equal(room.clockRun[seat], false, 'let go: the toggle answers again');
  setReportHold(room, seat, true);
  settleClock(room);
  assert.equal(room.clockRun[seat], true, 'the report dialog holds the auto-pass (CT-182), so the seat is billed');
});
