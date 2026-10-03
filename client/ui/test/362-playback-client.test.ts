/* 2026-10-03 — THE PLAYBACK, ON THE REAL CLIENT (test/ui-driver.ts).
 *
 * A haste or deploy close arrives as frames (server/view.ts playbackFrames)
 * and ui/main.ts plays them before the update itself. Two things went wrong
 * in a real browser that no unit test of ui/pace.ts could see, because both
 * live in NetBackend:
 *
 *   · AN ARRIVAL CUT THE PLAYBACK OFF AFTER FRAME 1. "Is a playback still
 *     queued?" looked for FRAMES — and once frame 1 was released only the
 *     update it ends on was left, so the next arrival (in Learn to Play the
 *     bot's own push, a moment later; in a room the opponent's first planning
 *     click) collapsed the queue onto the live board. Every Learn to Play
 *     playback on the deployed site was one frame long.
 *   · "DONE" WENT OUT TOO EARLY. The seat's clock is held while it watches
 *     (server/rooms.ts Room.watchHold) until the client says `playbackdone`,
 *     and the first version said so on the first ORDINARY update applied —
 *     which can be an older one the playback lets out ahead of itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import type { Seat } from '../../engine/src/types.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';

const ui = await client();
const SEAT: Seat = 0;

test('a playback holds the screen through an arrival, and says "done" once, when its own last message lands', () => {
  const h = new Harness(36201);
  ui.join(viewFor(h.state, SEAT), SEAT, legalActions(h.state, SEAT));
  ui.sent();   // forget the join's own traffic
  const v = viewFor(h.state, SEAT);
  const frame = (msg: string) => ({ view: v, events: [{ type: 'info', msg }], kind: 'opp' });
  ui.push({
    t: 'update', view: v, legal: legalActions(h.state, SEAT), step: 'deploy', events: [],
    // ONE frame, on purpose: it is released at once, and what is left queued
    // is only the update the playback ends on — the case that broke (with two,
    // frame 2 would still be queued and hide it)
    frames: [frame('Bot played Bubb.')],
  });
  assert.match(ui.html(), /promptbar playbar/, 'the frame is on screen as a playback');
  assert.match(ui.html(), /1\/1/);
  // the opponent's planning click: an update this seat COULD act on, which
  // under R150's rule would flush the queue — it must wait behind the playback
  ui.push({ t: 'update', view: v, legal: legalActions(h.state, SEAT), events: [] });
  assert.match(ui.html(), /promptbar playbar/, 'an arrival during the playback does not end it');
  assert.ok(!ui.sent().some(m => m['t'] === 'playbackdone'), 'and nothing has said "done" yet');
  // Space skips — to the live board, and the clock is told
  ui.key(' ');
  assert.doesNotMatch(ui.html(), /promptbar playbar/, 'skipped: the live board');
  const done = ui.sent().filter(m => m['t'] === 'playbackdone');
  assert.equal(done.length, 1, 'the server is told the seat is back, exactly once');
});
