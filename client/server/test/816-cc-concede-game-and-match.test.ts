/* docs/22 §0, §5.5 — "CONCEDE GAME", NOT "CONCEDE MATCH", AND IT MUST WORK.
 *
 *   §1 conceding a GAME in a Bo3 not yet decided goes on to the next game, as
 *      a lost game does (the engine's concede, the ordinary action)
 *   §2 conceding the MATCH in a game: the concede lands in that game's log as
 *      its own real action, and the match ends with how 'conceded'
 *   §3 conceding the match BETWEEN games stamps it directly, and the waiting
 *      room is closed (nothing is ever dealt there)
 *   §4 …and while PAUSED, and before game 1 is dealt
 *   §5 a match already over refuses a second concede
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Seat } from '../../engine/src/types.ts';
import { ccFixture } from './cc-match-fixture.ts';

const F = await ccFixture('t816');
const { R, M, S } = F;
// the socket layer's concede: the ordinary action path, then the record
M.setMatchHooks({
  code: (() => { let n = 0; return () => `T816X${(++n).toString(36).toUpperCase()}`; })(),
  concede: (room, seat) => { R.applyToRoom(room, { type: 'concede', seat }); M.matchGameDecided(room); },
});

test('§1 conceding a game in an undecided Bo3 goes on to the next game', () => {
  const { room, m } = F.start(3);
  F.concede(room, 0);
  assert.equal(m.phase, 'between', 'the match goes on');
  assert.deepEqual(m.games.map(g => [g.winner, g.how]), [[1, 'conceded']]);
  assert.deepEqual(M.matchSummary(m).games, [{ winner: 1, how: 'conceded' }], 'BL-55: the summary carries each game\'s winner, and nothing else of it');
  assert.ok(R.roomWaiting(F.current(m)), 'game 2 is waiting');
});

test('§2 conceding the match in a game: a real concede in that game, then the match ends', () => {
  const { room, m } = F.start(3);
  const n = room.actions.length;
  assert.deepEqual(M.concedeMatch(room, 1), { ok: true });
  assert.deepEqual(room.actions.slice(n), [{ type: 'concede', seat: 1 }], 'the game logs its own loss');
  assert.equal(R.decidedWinner(room), 0);
  assert.equal(m.phase, 'over');
  assert.deepEqual(m.result && [m.result.winner, m.result.how, m.result.concededBy], [0, 'conceded', 1]);
  assert.equal(m.room, room.code, 'no next room');
});

test('§3 conceding the match between games stamps it and closes the waiting room', () => {
  const { room, m } = F.start(3);
  F.concede(room, 1);
  const waiting = F.current(m);
  assert.deepEqual(M.concedeMatch(waiting, 1), { ok: true });
  assert.equal(m.phase, 'over');
  assert.deepEqual(m.result && [m.result.winner, m.result.how, m.result.concededBy], [0, 'conceded', 1]);
  assert.deepEqual(M.matchSummary(m).score, [1, 0], 'one game played; the concede is the match, not a game');
  assert.equal(R.getRoom(waiting.code), undefined, 'the waiting room is gone');
  assert.equal(R.closedNotice(waiting.code), `Game ${waiting.code} closed: its match is over.`);
});

test('§4 conceding while paused, and before game 1 is dealt', () => {
  const { room, m } = F.start(3);
  F.concede(room, 0);
  const waiting = F.current(m);
  F.seatUp(waiting, 0, 1);
  M.matchOp(waiting, 0, 'pause', {});
  M.matchOp(waiting, 1, 'pause', {});
  assert.equal(m.phase, 'paused');
  assert.deepEqual(M.concedeMatch(waiting, 0), { ok: true });
  assert.deepEqual(m.result && [m.result.winner, m.result.how], [1, 'conceded']);

  // game 1 not dealt yet: one seat registered
  const id = M.reserveMatchId();
  R.reserveRoomCode('T816P');
  const g1 = R.joinableRoom('T816P', 'constructed', undefined, F.REG[0].main, R.MATCH_CLOCK_MS.constructed, false,
    { rules: { sequential: true }, match: { id, game: 1 } })!;
  const m2 = M.startMatch(g1, id, 3);
  R.setSeatUser(g1, 0, 'u-ann');
  M.registerSeat(g1, 0 as Seat, 'u-ann', 'Ann', F.REG[0]);
  assert.ok(R.roomWaiting(g1));
  assert.deepEqual(M.concedeMatch(g1, 0), { ok: true });
  assert.equal(m2.phase, 'over');
  assert.equal(S.getMatch(id)?.result?.winner, 1);
  assert.equal(R.getRoom('T816P'), undefined, 'the unplayed game 1 room is closed');
});

test('§5 a decided match refuses a second concede', () => {
  const { room, m } = F.start(1);
  F.concede(room, 0);
  assert.equal(m.phase, 'over');
  const again = M.concedeMatch(room, 1);
  assert.equal(again.ok, false);
  assert.equal(m.result?.winner, 1, 'the result stands');
});
