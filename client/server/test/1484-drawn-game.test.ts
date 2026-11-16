/* CR 104.1b — a drawn game: phase 'gameover' and no winner.
 *
 *   §1 the room counts as over (`gameDecided`) though nobody won
 *   §2 in a match a drawn game scores for nobody and another game is played,
 *      chosen by the player who did not have the initiative in it
 *   §3 a Bo1 match whose one game is drawn goes on to a second game
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { other } from '../../engine/src/engine.ts';
import type { Room } from '../rooms.ts';
import { ccFixture } from './cc-match-fixture.ts';

const F = await ccFixture('t1484');
const { R, M } = F;
M.setMatchHooks({
  code: (() => { let n = 0; return () => `T1484X${(++n).toString(36).toUpperCase()}`; })(),
});

/** end the room's game the way the engine ends a draw */
function draw(room: Room): void {
  room.state.players[0]!.life = 0;
  room.state.players[1]!.life = 0;
  room.state.winner = null;
  room.state.phase = 'gameover';
}

test('CT-565 §1: a drawn room is over, and nobody won it', () => {
  const { room } = F.start(3);
  assert.equal(R.gameDecided(room), false);
  draw(room);
  assert.equal(R.gameDecided(room), true);
  assert.equal(R.decidedWinner(room), null);
});

test('CT-565 §2: a drawn game in a Bo3 scores for nobody and the match goes on', () => {
  const { room, m } = F.start(3);
  const init = room.state.initiative;
  draw(room);
  M.matchGameDecided(room);
  assert.equal(m.phase, 'between', 'the match goes on');
  assert.deepEqual(m.games.map(g => [g.winner, g.how]), [[null, 'played']]);
  assert.deepEqual(M.matchSummary(m).score, [0, 0]);
  assert.equal(m.between?.chooser, other(init), 'the player without the initiative chooses');
  assert.ok(R.roomWaiting(F.current(m)), 'game 2 is waiting');
  M.matchGameDecided(room);
  assert.equal(m.games.length, 1, 'recording it again changes nothing');
});

test('CT-565 §3: a Bo1 match whose game is drawn plays another game', () => {
  const { room, m } = F.start(1);
  draw(room);
  M.matchGameDecided(room);
  assert.equal(m.phase, 'between');
  assert.equal(m.result, undefined, 'no result yet');
  assert.notEqual(m.room, room.code);
});
