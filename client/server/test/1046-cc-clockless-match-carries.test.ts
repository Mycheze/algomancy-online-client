/* 1046 — A MATCH WITH NO CLOCK STAYS CLOCKLESS GAME AFTER GAME (docs/22 §6.1, 2026-11-03).
 *
 * The match used to store `clockStart: room.clockStart ?? 45 min`, harmless
 * while every match had the 45-minute bank. With the creator able to choose
 * Off, that fallback would have created game 2 with a 45-minute bank and the
 * banks carried from game 1 — [0, 0] — so both seats would flag the moment
 * game 2 began. In-process, on the CC fixture:
 *   §1 an Off match records clockStart null; game 2's room is clockless too,
 *      sends no clock and can never expire
 *   §2 positive control: a timed match carries its own bank into game 2
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Seat } from '../../engine/src/types.ts';
import { ccFixture } from './cc-match-fixture.ts';

const F = await ccFixture('t1046');
const { R, start, seatUp, concede, current } = F;

test('1046 §1 an Off match: game 2 is clockless, never a 45-minute bank of zero', () => {
  const { room, m } = start(3, ['u-ann', 'u-bo'], F.REG, null);
  assert.equal(room.clockStart, null, 'positive control: game 1 is clockless');
  assert.equal(m.clockStart, null, 'the match records no clock');
  seatUp(room, 0, 1);
  concede(room, 0);
  const g2 = current(m);
  assert.notEqual(g2.code, room.code, 'positive control: game 2 has its own room');
  assert.equal(g2.clockStart, null, 'game 2 is created clockless');
  assert.equal(R.clockSnapshot(g2), null, 'and sends no clock');
  seatUp(g2, 0, 1 as Seat);
  assert.equal(R.expiredSeat(g2), null, 'nobody can lose game 2 on time');
});

test('1046 §2 a timed match carries its own bank into game 2', () => {
  const { room, m } = start(3, ['u-cy', 'u-di'], F.REG, 60 * 60_000);
  assert.equal(m.clockStart, 60 * 60_000);
  // no sockets: nothing bills while the banks are set by hand (as 814 does)
  room.clockMs = [50 * 60_000, 55 * 60_000];
  concede(room, 0);
  const g2 = current(m);
  assert.equal(g2.clockStart, 60 * 60_000, 'the match\'s bank, for "of 60:00"');
  assert.deepEqual(g2.clockMs, [50 * 60_000, 55 * 60_000], 'the banks carried');
});
