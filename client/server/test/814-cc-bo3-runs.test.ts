/* docs/22 §2.4, §3.4, §5.2, §5.5 — A BEST OF THREE RUNS GAME 1 → 2 → 3.
 *
 *   §1 game 1 deals from the two registrations, sequential, initiative rolled
 *   §2 a decided game creates the next room at once: waiting on both decks,
 *      the match's two accounts and link stamped, the banks carried (one
 *      45-minute bank per player per MATCH — owner, §0)
 *   §3 the previous game's LOSER chooses the initiative, by readying with it
 *      (§8 answer 1); the winner's Ready carries nothing; the chosen seat
 *      holds the initiative in the dealt game and the configuration each seat
 *      set is the deck it was dealt
 *   §4 game 3 starts from game 2's configuration (§8 answer 3) and the match
 *      ends 2-1 with a result; a decided match creates no further room
 *   §5 a Bo1 is over after one game
 *
 * Seeds: rooms take random seeds; nothing here depends on a deal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Seat } from '../../engine/src/types.ts';
import { ccFixture } from './cc-match-fixture.ts';

const F = await ccFixture('t814');
const { R, M, REG } = F;

test('§1-§4 a Bo3 runs game 1, 2 and 3 with the loser choosing and the banks carried', () => {
  const { room: g1, m } = F.start(3);
  assert.equal(g1.state.sequential, true, 'game 1 is a CC game');
  assert.deepEqual(g1.rules, { sequential: true }, 'game 1 rolls its initiative (no initiative in its rules)');
  assert.deepEqual(g1.decks, [REG[0].main, REG[1].main], 'dealt from the two registered mains');
  assert.equal(m.phase, 'game');

  // §2 — game 1 decided (seat 0 concedes); the clocks it leaves are the match's
  g1.clockMs = [41 * 60_000, 39 * 60_000];
  F.concede(g1, 0);
  assert.equal(m.phase, 'between');
  const g2 = F.current(m);
  assert.notEqual(g2.code, g1.code, 'a new room with a new code');
  assert.deepEqual(g2.match, { id: m.id, game: 2 });
  assert.ok(R.roomWaiting(g2), 'waiting on both decks');
  assert.deepEqual(g2.users, ['u-ann', 'u-bo'], 'the match accounts are stamped before anybody connects');
  assert.deepEqual(g2.clockMs, [41 * 60_000, 39 * 60_000], 'the banks are carried, not reset');
  assert.equal(g2.clockStart, R.MATCH_CLOCK_MS.constructed, 'the bank shown is the match\'s');
  assert.equal(m.between?.chooser, 0, 'the loser of game 1 chooses');
  assert.deepEqual(m.games.map(g => [g.code, g.winner, g.how]), [[g1.code, 1, 'conceded']]);

  // §3 — sideboarding: seat 0 brings in its whole side for three main cards
  F.seatUp(g2, 0, 1);
  M.matchSeatJoined(g2);
  assert.ok(m.between!.until !== null, 'both seats in: the window opened');
  const next0 = { main: [...REG[0].main.slice(3), ...REG[0].side], side: REG[0].main.slice(0, 3) };
  assert.deepEqual(M.matchOp(g2, 0, 'config', next0), { ok: true });
  assert.equal(M.matchOp(g2, 0, 'ready', { ready: true }).ok, false, 'the loser cannot ready without choosing');
  assert.deepEqual(M.matchOp(g2, 1, 'ready', { ready: true, initiative: 1 }), { ok: true }, 'the winner readies');
  assert.equal(m.between!.initiative, null, 'and the winner\'s Ready carries no choice');
  assert.deepEqual(M.matchOp(g2, 0, 'ready', { ready: true, initiative: 0 }), { ok: true });
  assert.equal(m.phase, 'game', 'both Ready: dealt at once');
  assert.ok(!R.roomWaiting(g2));
  assert.deepEqual(g2.rules, { sequential: true, initiative: 0 }, 'the chosen initiative is part of the deal');
  assert.equal(g2.state.initiative, 0, 'the chooser took the initiative');
  assert.deepEqual(g2.decks[0], next0.main, 'seat 0 plays the configuration it set');
  assert.deepEqual(g2.decks[1], REG[1].main, 'seat 1 plays its registered main');

  // game 2 to seat 0: 1-1, seat 1 chooses
  g2.clockMs = [30 * 60_000, 35 * 60_000];
  F.concede(g2, 1);
  const g3 = F.current(m);
  assert.deepEqual(g3.match, { id: m.id, game: 3 });
  assert.deepEqual(g3.clockMs, [30 * 60_000, 35 * 60_000], 'carried again');
  assert.equal(m.between?.chooser, 1);
  // §4 — game 3 starts from game 2's configuration
  const info = M.matchLobbyInfo(g3, 0)!;
  assert.deepEqual(info.mine?.current, next0, 'seat 0 starts game 3 from its game 2 deck');
  assert.deepEqual(info.score, [1, 1]);
  F.seatUp(g3, 0, 1);
  M.matchSeatJoined(g3);
  assert.equal(M.matchOp(g3, 0, 'ready', { ready: true }).ok, true);
  assert.equal(M.matchOp(g3, 1, 'ready', { ready: true, initiative: 0 }).ok, true, 'the loser may hand the initiative over');
  assert.equal(g3.state.initiative, 0, 'and seat 0 has it');
  assert.deepEqual(g3.decks[0], next0.main);
  F.concede(g3, 1);
  assert.equal(m.phase, 'over');
  assert.deepEqual(m.result && [m.result.winner, m.result.how], [0, 'games']);
  assert.deepEqual(m.games.map(g => g.winner), [1, 0, 0] as Seat[]);
  assert.equal(m.between, undefined);
  assert.equal(F.current(m), g3, 'no fourth room');
});

test('§5 a Bo1 is over after one game', () => {
  const { room, m } = F.start(1);
  F.concede(room, 1);
  assert.equal(m.phase, 'over');
  assert.equal(m.result?.winner, 0);
  assert.equal(m.games.length, 1);
  assert.equal(m.room, room.code, 'no second room');
});
