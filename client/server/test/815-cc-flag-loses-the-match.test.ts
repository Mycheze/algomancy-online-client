/* docs/22 §0, §5.5 — RUNNING OUT OF TIME LOSES THE MATCH (owner, 2026-11-02:
 * "Clock flag: LOSE THE MATCH"; CR D8.6a).
 *
 * A flag is stamped by rooms.ts expireOnTime exactly as in any timed game —
 * the room's own result is untouched by CC. What CC adds is the match's
 * reading of it: matchGameDecided sees a game decided on time and ends the
 * MATCH, whatever the score, with no next room.
 *
 *   §1 a flag in game 1 of a Bo3 (score 0-0) ends the match 0-1, how 'time'
 *   §2 the game itself is an ordinary decided game: the flagged seat lost it
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Seat } from '../../engine/src/types.ts';
import { ccFixture } from './cc-match-fixture.ts';

const F = await ccFixture('t815');
const { R, M } = F;

test('§1-§2 a flag in game 1 of a Bo3 loses the match, not just the game', async () => {
  const { room, m } = F.start(3);
  F.seatUp(room, 0, 1);
  R.settleClock(room);
  const running = ([0, 1] as Seat[]).filter(s => room.clockRun[s]);
  assert.ok(running.length >= 1, 'fixture: somebody is on the clock');
  const loser = running[0]!;
  room.clockMs[loser] = 1;
  await new Promise(r => setTimeout(r, 5));
  const out = R.expireOnTime(room);
  assert.equal(out?.loser, loser, 'the seat ran out of time');
  M.matchGameDecided(room);
  assert.equal(m.phase, 'over', 'the match is over after one game of three');
  assert.deepEqual(m.result && [m.result.winner, m.result.how], [loser === 0 ? 1 : 0, 'time']);
  assert.deepEqual(m.games.map(g => g.how), ['time']);
  assert.deepEqual(M.matchSummary(m).score, loser === 0 ? [0, 1] : [1, 0], 'one game played');
  assert.equal(m.room, room.code, 'no next room');
  assert.equal(m.between, undefined);
  assert.equal(R.decidedWinner(room), loser === 0 ? 1 : 0, '§2 the game is decided as any flagged game is');
  assert.equal(m.banks[loser], 0, 'the flagged bank is written to the match');
});
