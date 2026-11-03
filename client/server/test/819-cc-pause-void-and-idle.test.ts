/* docs/22 §2.5, §5.7 — PAUSE, THE IDLE SWEEP, AND THE 7-DAY VOID.
 *
 *   §1 a pause needs both: an offer, then the other seat's agreement; it stops
 *      the window; it lapses if the window locks first
 *   §2 a PAUSED match's waiting room survives the idle sweep, however long
 *      it sits empty (rooms.ts idleDue, the injected setRoomHeld)
 *   §3 resume needs both seats present and both asking; the window restarts
 *      at the full 120 s, everything else exactly as it stood
 *   §4 paused 7 days: the match is VOID — no result, the room closed 'void'
 *   §5 an UNPAUSED waiting room is closed by the idle sweep as any room is,
 *      and its match is voided by the next match sweep
 *   §6 W4's hook: a league match whose week has closed is voided between games
 *   §7 CT-517: "Your matches" says whether the opponent is in the room and has
 *      pressed Resume — what the bell's "wants to resume" line is made from
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ccFixture } from './cc-match-fixture.ts';

const F = await ccFixture('t819');
const { R, M, REG } = F;

function between() {
  const { room, m } = F.start(3);
  F.concede(room, 0);
  return { m, room: F.current(m) };
}

test('§1-§4 a pause is agreed, held through the idle sweep, resumed where it stood, and void at 7 days', () => {
  const { m, room } = between();
  F.seatUp(room, 0, 1);
  const t0 = Date.now();
  M.sweepMatches(t0);
  const swap = { main: [...REG[0].main.slice(1), REG[0].side[0]!], side: [REG[0].main[0]!, ...REG[0].side.slice(1)] };
  M.matchOp(room, 0, 'config', swap);
  M.matchOp(room, 0, 'ready', { ready: true, initiative: 1 });
  // §1
  assert.deepEqual(M.matchOp(room, 1, 'pause', {}), { ok: true }, 'seat 1 offers');
  assert.equal(m.phase, 'between', 'an offer alone pauses nothing');
  assert.deepEqual(M.matchOp(room, 0, 'pause', {}), { ok: true }, 'seat 0 agrees');
  assert.equal(m.phase, 'paused');
  assert.equal(m.between!.until, null, 'the window stopped');
  M.sweepMatches(t0 + 10 * M.SIDEBOARD_WINDOW_MS);
  assert.equal(m.between!.locked, false, 'a paused window never locks');
  assert.equal(M.matchOp(room, 0, 'config', { main: REG[0].main, side: REG[0].side }).ok, false, 'no sideboarding while paused');
  // §2 — both leave; days pass
  room.sockets = [null, null];
  const pausedAt = m.pause!.pausedAt!;
  for (const later of [2 * 3600_000, 3 * 24 * 3600_000, 6 * 24 * 3600_000]) {
    assert.equal(R.idleDue(room, pausedAt + later), false, `held after ${later / 3600_000} h empty`);
  }
  assert.deepEqual(R.sweepIdleRooms(pausedAt + 6 * 24 * 3600_000), [], 'the idle sweep closes nothing');
  // §3 — resume
  F.seatUp(room, 0);
  assert.equal(M.matchOp(room, 0, 'resume', {}).ok, false, 'one seat present cannot resume');
  F.seatUp(room, 1);
  assert.deepEqual(M.matchOp(room, 0, 'resume', {}), { ok: true });
  assert.equal(m.phase, 'paused', 'one ask is not both');
  const t1 = Date.now();
  assert.deepEqual(M.matchOp(room, 1, 'resume', {}, t1), { ok: true });
  assert.equal(m.phase, 'between');
  assert.equal(m.between!.until, t1 + M.SIDEBOARD_WINDOW_MS, 'a full window again');
  assert.deepEqual(m.current[0], swap, 'the configuration as it was');
  assert.deepEqual(m.between!.ready, [false, false], 'ready again from nothing');
  assert.deepEqual(M.matchSummary(m).score, [0, 1], 'the score as it was');
  // §4 — pause again, and wait out the 7 days
  M.matchOp(room, 1, 'pause', {});
  M.matchOp(room, 0, 'pause', {});
  const p2 = m.pause!.pausedAt!;
  M.sweepMatches(p2 + M.PAUSE_LIMIT_MS - 1);
  assert.equal(m.phase, 'paused', 'not a moment early');
  M.sweepMatches(p2 + M.PAUSE_LIMIT_MS);
  assert.equal(m.phase, 'void');
  assert.equal(m.result, undefined, 'no result');
  assert.equal(R.getRoom(room.code), undefined, 'the waiting room is closed');
  assert.equal(R.closedNotice(room.code), `Game ${room.code} closed: its match was called off with no result.`);
});

test('§5 an unpaused waiting room idles out as any room does, and voids its match', () => {
  const { m, room } = between();
  const now = Date.now();
  assert.equal(R.idleDue(room, now), false, 'starts the unattended clock');
  const later = now + R.RECONNECT_GRACE_MS + R.IDLE_SHORT_MS + 1;
  room.lastActionAt = now;
  assert.deepEqual(R.sweepIdleRooms(later), [room.code], 'closed for idling');
  M.sweepMatches(later);
  assert.equal(m.phase, 'void');
  assert.match(m.voided!.why, /waiting room closed/);
});

test('§6 a league week that closed voids a league match between games', () => {
  const { m } = between();
  M.setLeagueWeekClosed(x => x.id === m.id);
  M.sweepMatches(Date.now());
  M.setLeagueWeekClosed(() => false);
  assert.equal(m.phase, 'void');
  assert.match(m.voided!.why, /league week/);
});

test('§7 Your matches says the opponent is here and has asked to resume', () => {
  const { m, room } = between();
  F.seatUp(room, 0, 1);
  M.matchOp(room, 1, 'pause', {});
  M.matchOp(room, 0, 'pause', {});
  assert.equal(m.phase, 'paused');
  room.sockets = [null, null];
  const row = (user: string) => M.matchesFor(user).find(x => x.id === m.id)!;
  assert.deepEqual([row('u-ann').opponentHere, row('u-ann').resumeAsked], [false, false], 'nobody there');
  F.seatUp(room, 1);
  assert.deepEqual([row('u-ann').opponentHere, row('u-ann').resumeAsked], [true, false], 'Bo is back in the room, waiting for Ann');
  assert.deepEqual([row('u-bo').opponentHere, row('u-bo').resumeAsked], [false, false], 'and Bo is told nothing of himself');
  F.seatUp(room, 0);
  assert.deepEqual(M.matchOp(room, 1, 'resume', {}), { ok: true }, 'both here: Bo asks');
  room.sockets[0] = null;
  assert.deepEqual([row('u-ann').opponentHere, row('u-ann').resumeAsked], [true, true], 'Ann stepped away: Bo is here and has asked');
});
