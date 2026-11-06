/* 1148 — CT-511: A JOIN IS THE LIVE BOARD; WHAT THE PACE WAS HOLDING IS OLDER.
 *
 * CR D5.4: an update the player cannot act on is held, one a second, so the
 * table moves at a pace a person can follow (ui/pace.ts). A `joined` — a
 * reconnect, a reload, a deck rejoin — is the server's whole live board, and
 * on one socket every update still held arrived BEFORE it, so each describes
 * a board at or before the join's.
 *
 * Only an agreed rewind's join dropped them (BL-46). Every other join kept
 * them queued on their wall-clock moments, and the first update after the join
 * whose own moment had not come released them: an older board painted over
 * the live one, until the next release a second later.
 *
 * That is also why ui test 294 failed only under machine load: its tests share
 * one client, a held update from one test sat in the queue into the next, and
 * whether its moment had passed by the next test's update depended on how fast
 * the box was running. Here the clock is mocked, so the moment is exact.
 *
 * Seeds 114800-114899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { toDeployment, withE } from '../../engine/test/util.ts';
import { client } from './ui-driver.ts';

const ui = await client();
const METER = /class="cchip proph">⏳ 0\/4</;

test('CT-511: a held update from before a join is not painted over the joined board', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 5_000_000 });
  // the OLD board: seat 0 has Hooba-God cached under a counting prophecy
  const old = new Harness(114801);
  toDeployment(old);
  withE(old, e => { e.cacheCard(0, 'Hooba-God', 'effect', { prophecy: '4 Turns Pass' }); });
  // the LIVE board the join brings: nothing cached
  const live = new Harness(114802);
  toDeployment(live);

  ui.join(old.state, 0, []);
  ui.update(old.state, []);                 // nothing to act on, nothing queued: out at once
  ui.update(old.state, []);                 // within the second: HELD, due one second on
  assert.match(ui.html(), METER, 'fixture: the old board is on screen');

  t.mock.timers.tick(200);
  assert.doesNotMatch(ui.join(live.state, 0, []), METER, 'the join paints the live board');

  // past the held update's moment, and another update arrives
  t.mock.timers.tick(1300);
  const after = ui.update(live.state, []);
  assert.doesNotMatch(after, METER,
    'the update held from before the join did not come back over the live board');
  ui.tick();
  assert.doesNotMatch(ui.html(), METER, 'nor on the next beat');
});
