/* docs/25 §8 (D, §12 item 11) — A CUBE GAME IS RECORDED, TAGGED AND COUNTED BY NOTHING.
 *
 * Like a custom-rules game: in the match history with its event's code, and left out of the
 * profile (games, wins, losses — so the achievements), the rating and the card stats.
 *
 *   §1 ⭐ a cube match's game: a history row tagged `cube: CODE`, the match history row too
 *   §2 ⭐ the profile does not move; isRated says no; the card stats leave it out (both the
 *      history join and the fold's own check)
 *   §3 the control: an ordinary match's game in the same process counts
 *   §4 a re-import (the boot sync) keeps the tag, read off the match record
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Seat } from '../../engine/src/types.ts';
import { cubeFixture } from './cube-fixture.ts';

const X = await cubeFixture('t1325');
test.after(() => X.cleanup());
const { C, F, A, ev, ok, clock } = X;
const H = await import('../history.ts');
const CS = await import('../api-cardstats.ts');
const CF = await import('../cardstats.ts');
const RT = await import('../rating.ts');
const [host, guest] = X.people(2);

const code = ok(C.createCube(host!, { fillBots: false, swissRounds: 1 }, clock.T)).code;
ok(C.joinCube(ev(code), guest!, clock.T));
ok(C.startCube(ev(code), host!, clock.T));
X.draftOut(code);
X.buildAll(code);
X.toRound(code);
const p = ev(code).pairings[0]!;
const roomCode = ok(C.playMatch(ev(code), p.a, null, clock.T)).room;
const room = F.R.getRoom(roomCode)!;
const loser = (room.users[0] === p.b ? 0 : 1) as Seat;
F.concede(room, loser);
// not a walkover (CR D8.5a): a turn-5 concede, an ordinary decided game
room.concession = { seat: loser, turn: 5 };
F.R.touchRoom(room, Date.now());
H.recordLiveGame(room);

test('§1 ⭐ the cube game is in the history, tagged with its event', () => {
  assert.equal(ev(code).phase, 'done');
  const row = A.gameHistory().find(g => g.code === roomCode)!;
  assert.ok(row, 'recorded');
  assert.equal(row.cube, code, '⭐ tagged with the event');
  assert.equal(row.match?.id, ev(code).pairings[0]!.match!.id, 'and its match');
  const mine = A.recentGames(p.a).find(r => r.code === roomCode);
  assert.equal(mine?.cube, code, 'the match history row says so');
});

test('§2 ⭐ the profile, the rating and the card stats leave it out', () => {
  for (const u of [p.a, p.b!]) {
    const prof = A.accountById(u)!.profile;
    assert.equal(prof.games, 0, '⭐ no game on the profile');
    assert.equal(prof.wins + prof.losses, 0);
  }
  const row = A.gameHistory().find(g => g.code === roomCode)!;
  assert.equal(RT.isRated({ ...row, rated: true }), false, 'never rated, even if a file said so');
  assert.ok(!CS.statsGames().some(g => g.code === roomCode), '⭐ not joined into the card stats');
  assert.equal(CF.eligible({ ...row, ledger: { seats: [] } } as never, { mode: 'all' }), false, 'and the fold refuses it itself');
});

test('§3 the control: an ordinary match game counts', () => {
  const { room: g, m } = F.start(1, [host!.id, guest!.id]);
  F.concede(g, 1);
  g.concession = { seat: 1, turn: 5 };
  H.recordLiveGame(g);
  assert.equal(m.phase, 'over');
  const row = A.gameHistory().find(x => x.code === g.code)!;
  assert.equal(row.cube, undefined);
  assert.equal(A.accountById(host!.id)!.profile.games, 1, 'it is on the profile');
});

test('§4 a re-import keeps the tag', () => {
  const report = H.syncGamesDir(process.env['ALGO_GAMES_DIR']!, { force: true });
  assert.ok(report);
  const row = A.gameHistory().find(g => g.code === roomCode)!;
  assert.equal(row.cube, code);
  assert.equal(H.cubeTagOf(room.match), code);
  assert.equal(H.cubeTagOf({ id: 'MNOSUCHMATC', game: 1 }), undefined);
});
