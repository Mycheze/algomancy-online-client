/* docs/22 §5.2, §5.4, §8 answer 1 — THE SIDEBOARDING WINDOW (CR D8.6b, D8.6c).
 *
 *   §1 it opens only when BOTH seats are in the room, and runs 120 s
 *   §2 a configuration is checked with checkSwap: an illegal one is refused and
 *      the last legal one stands; a preset applies absolutely; a changed deck
 *      un-readies its seat
 *   §3 at 120 s it LOCKS: the last legal configurations are what is dealt —
 *      but with no initiative choice made, nothing is dealt: the loser is left
 *      with the choice alone, untimed, and nothing chooses for them however
 *      long they wait; their choice deals
 *   §4 locked, configurations and readiness can no longer change
 *   §5 both Ready (the loser's carrying the choice) deals before the window ends
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CardName } from '../../engine/src/types.ts';
import { ccFixture } from './cc-match-fixture.ts';

const F = await ccFixture('t817');
const { R, M, REG } = F;

/** a match whose game 1 seat 1 lost, sitting in game 2's waiting room */
function between(regs = REG) {
  const { room, m } = F.start(3, undefined, regs);
  F.concede(room, 1);
  return { m, room: F.current(m) };
}

test('§1 the window opens when both seats are in, and runs 120 s', () => {
  const { m, room } = between();
  F.seatUp(room, 0);
  M.sweepMatches(Date.now());
  assert.equal(m.between!.until, null, 'one seat in: not open');
  F.seatUp(room, 1);
  const t = Date.now();
  M.sweepMatches(t);
  assert.equal(m.between!.until, t + M.SIDEBOARD_WINDOW_MS, 'both in: 120 s from now');
  assert.equal(M.SIDEBOARD_WINDOW_MS, 120_000);
});

test('§2-§4 an illegal configuration falls back to the last legal one at the lock; the loser alone chooses, untimed', () => {
  const preset = { id: 'p1', name: 'side in', out: REG[1].main.slice(0, 2), in: REG[1].side.slice(0, 2) };
  const { m, room } = between([REG[0], { ...REG[1], presets: [preset] }]);
  F.seatUp(room, 0, 1);
  const t0 = Date.now();
  M.sweepMatches(t0);
  // seat 1 (the loser) uses its preset — legal
  assert.deepEqual(M.matchOp(room, 1, 'preset', { preset: 'p1' }), { ok: true });
  const legal = m.current[1]!;
  assert.equal(legal.main.length, 30, 'two out, two in');
  assert.ok(legal.side.includes(REG[1].main[0]!), 'the preset moved the cards out');
  // then an illegal one: 29 cards in main
  const short = { main: legal.main.slice(1), side: [...legal.side, legal.main[0]!] as CardName[] };
  const refused = M.matchOp(room, 1, 'config', short);
  assert.equal(refused.ok, false, 'a 29-card main is refused');
  // and one with a card that was never registered
  const foreign = { main: [...legal.main.slice(1), REG[0].main[0]!], side: legal.side };
  assert.equal(M.matchOp(room, 1, 'config', foreign).ok, false, 'a card from outside the registration is refused');
  assert.deepEqual(m.current[1], legal, 'the last legal configuration stands');
  // the winner readies; a changed deck un-readies
  assert.deepEqual(M.matchOp(room, 0, 'ready', { ready: true }), { ok: true });
  const swap0 = { main: [...REG[0].main.slice(1), REG[0].side[0]!], side: [REG[0].main[0]!, ...REG[0].side.slice(1)] };
  assert.deepEqual(M.matchOp(room, 0, 'config', swap0), { ok: true });
  assert.equal(m.between!.ready[0], false, 'a changed deck is not the one that was readied');

  // §3 — 120 s pass with no initiative choice
  M.sweepMatches(t0 + M.SIDEBOARD_WINDOW_MS - 1);
  assert.equal(m.between!.locked, false, 'not before 120 s');
  M.sweepMatches(t0 + M.SIDEBOARD_WINDOW_MS);
  assert.equal(m.between!.locked, true, 'locked at 120 s');
  assert.ok(R.roomWaiting(room), 'but NOT dealt: the loser has not chosen');
  M.sweepMatches(t0 + 6 * 3600_000);
  assert.ok(R.roomWaiting(room) && m.between!.initiative === null, 'six hours later still nobody has chosen for them');
  const info = M.matchLobbyInfo(room, 1)!;
  assert.equal(info.locked, true);
  assert.equal(info.chooser, 1);
  // §4 locked
  assert.equal(M.matchOp(room, 0, 'config', REG[0]).ok, false, 'no more sideboarding');
  assert.equal(M.matchOp(room, 0, 'ready', { ready: true, initiative: 0 }).ok, false, 'the winner cannot choose');
  assert.equal(M.matchOp(room, 1, 'ready', { ready: true }).ok, false, 'the loser must choose');
  assert.equal(M.matchOp(room, 0, 'pause', {}).ok, false, 'no pause once locked');
  // the loser's choice deals, with the locked configurations
  assert.deepEqual(M.matchOp(room, 1, 'ready', { ready: true, initiative: 0 }), { ok: true });
  assert.equal(m.phase, 'game');
  assert.equal(room.state.initiative, 0);
  assert.deepEqual(room.decks[1], legal.main, 'seat 1 plays its last LEGAL configuration');
  assert.deepEqual(room.decks[0], swap0.main, 'seat 0 plays what it set, ready or not');
});

test('§5 both Ready deals at once, before the window ends', () => {
  const { m, room } = between();
  F.seatUp(room, 0, 1);
  M.sweepMatches(Date.now());
  assert.deepEqual(M.matchOp(room, 1, 'ready', { ready: true, initiative: 1 }), { ok: true });
  assert.ok(R.roomWaiting(room), 'one Ready is not enough');
  assert.deepEqual(M.matchOp(room, 1, 'ready', { ready: false }), { ok: true }, 'un-Ready is allowed while open');
  assert.equal(m.between!.ready[1], false);
  M.matchOp(room, 1, 'ready', { ready: true, initiative: 1 });
  M.matchOp(room, 0, 'ready', { ready: true });
  assert.equal(m.phase, 'game');
  assert.equal(room.state.initiative, 1);
});
