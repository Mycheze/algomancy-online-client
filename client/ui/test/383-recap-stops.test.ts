/* Report #198 (UTVU, 2026-10-06) — THE RECAP STOPS AND WAITS FOR THE PLAYER.
 *
 * The owner: "The last 'tick' after deployment should actually just wait for
 * the user to press space/enter to confirm they saw the deployment recap. Then
 * proceed to EOT (if effects, wait to confirm again) then draw step and
 * planning." Settled with the owner the same round: Skip jumps to the NEXT
 * stop, not the live board (Space, Space… lands on the next turn with nothing
 * missed), and the haste step's playback stops the same way.
 *
 * Before, a playback handed over on the clock — PLAYBACK_END_MS after its last
 * frame (report #193) — so a player who looked away came back to the next
 * turn. Here the clock runs as long as it likes and the screen does not move
 * until the player says so. Driven through the real client (test/ui-driver.ts)
 * with a test clock, as test/371 does.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import type { Seat } from '../../engine/src/types.ts';
import { viewFor } from '../../server/view.ts';
import { emptyPace, paceDue, paceGo, paceHeld, paceSequence, paceStopped, paceToStop, paceWake, playbackStopsOf } from '../pace.ts';
import { client } from './ui-driver.ts';

const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;
/** a minute passes and every timer the client booked fires */
const wait = (): void => { clock += 60_000; ui.tick(); clock += 60_000; ui.tick(); };

const ui = await client();
const SEAT: Seat = 0;
const h = new Harness(38301);
const v = viewFor(h.state, SEAT);
const legal = legalActions(h.state, SEAT);
const frame = (kind: 'opp' | 'tail', msg: string) => ({ view: v, events: [{ type: 'info', msg }], kind });
/** what the bar is showing: "i/n" and the button, or 'live' off the playback */
const bar = (): string => {
  const html = ui.html();
  if (!/promptbar playbar/.test(html)) return 'live';
  const step = /class="playstep">(\d+\/\d+)</.exec(html)?.[1] ?? '?';
  const btn = /data-btn="playskip"[^>]*>(Continue|Skip)/.exec(html)?.[1] ?? '?';
  return `${step} ${btn}`;
};
/** `playbackdone` messages sent since the last call (ui.sent() drains) */
const done = (): number => ui.sent().filter(m => m['t'] === 'playbackdone').length;

ui.join(v, SEAT, legal);
ui.sent();

test('report #198: the deployment recap stops after their moves, and again after the end of turn', () => {
  ui.push({
    t: 'update', view: v, legal, step: 'deploy', events: [],
    frames: [frame('opp', 'They played Bubb.'), frame('opp', 'They played Bubb.'), frame('tail', 'A trigger resolved.')],
  });
  wait();
  assert.equal(bar(), '2/3 Continue', 'their moves played out, and the screen waits on the last of them however long passes');
  assert.equal(done(), 0, 'the seat is still watching');
  ui.key(' ');
  // its one frame is the end of the part, so the bar asks again at once
  assert.equal(bar(), '3/3 Continue', 'Space goes on: the end of turn plays');
  wait();
  assert.equal(bar(), '3/3 Continue', 'the end of turn had something in it, so it waits again');
  assert.equal(done(), 0);
  ui.key('Enter');
  assert.equal(bar(), 'live', 'Enter confirms too: the next turn');
  assert.equal(done(), 1, 'and only now is the server told the seat is back');
});

test('report #198: Skip jumps to the next stop, never past it', () => {
  ui.push({
    t: 'update', view: v, legal, step: 'deploy', events: [],
    frames: [frame('opp', 'a'), frame('opp', 'b'), frame('opp', 'c'), frame('tail', 'd'), frame('tail', 'e')],
  });
  assert.equal(bar(), '1/5 Skip', 'the first frame at once, the rest on the clock');
  ui.key(' ');
  assert.equal(bar(), '3/5 Continue', 'Skip: the end of their moves, and waiting');
  ui.key(' ');
  assert.equal(bar(), '4/5 Skip', 'Continue: the end of turn starts');
  ui.key(' ');
  assert.equal(bar(), '5/5 Continue', 'Skip again: the end of the end of turn');
  // an arrival while it waits (the opponent's planning click) queues behind
  ui.push({ t: 'update', view: v, legal, events: [] });
  assert.equal(bar(), '5/5 Continue', 'an arrival does not end a stop');
  ui.key(' ');
  assert.equal(bar(), 'live');
});

test('report #198: a quiet end of turn does not ask twice; the haste step stops the same way', () => {
  ui.push({ t: 'update', view: v, legal, step: 'haste', events: [], frames: [frame('opp', 'a'), frame('opp', 'b')] });
  assert.match(ui.html(), /haste step/, 'the haste step\'s playback');
  wait();
  assert.equal(bar(), '2/2 Continue', 'it stops at the end too');
  ui.key(' ');
  assert.equal(bar(), 'live', 'no end-of-turn frames, so one confirm and the board');
  // the button is the touch / mouse route to the same thing
  ui.push({ t: 'update', view: v, legal, step: 'deploy', events: [], frames: [frame('tail', 'only the end of turn')] });
  wait();
  assert.equal(bar(), '1/1 Continue');
  ui.click({ btn: 'playskip' });
  assert.equal(bar(), 'live');
});

test('report #198: "watch again" stops at the same places, and hands back the board', () => {
  ui.push({ t: 'update', view: v, legal, step: 'deploy', events: [], frames: [frame('opp', 'a'), frame('tail', 'b')] });
  ui.key(' '); ui.key(' '); ui.key(' ');
  assert.equal(bar(), 'live');
  done();
  ui.click({ btn: 'playagain' });
  wait();
  // the board-before is step 1 of 2 again (watchAgain shows it with frame 1)
  assert.equal(bar(), '1/2 Continue', 'watching again stops at the end of their moves');
  ui.key(' '); wait();
  assert.equal(bar(), '2/2 Continue');
  ui.key(' ');
  assert.equal(bar(), 'live');
  assert.equal(done(), 0, 'watching again is the player\'s own time: no clock message');
});

test('report #198: the stop rule and the queue arithmetic', () => {
  assert.deepEqual(playbackStopsOf(['opp', 'opp', 'tail', undefined]), [2, 3], 'end of their moves, end of the end of turn');
  assert.deepEqual(playbackStopsOf(['opp', 'opp', undefined]), [2], 'nothing at end of turn: one stop');
  assert.deepEqual(playbackStopsOf(['tail', undefined]), [1], 'only the end of turn: one stop');
  assert.deepEqual(playbackStopsOf([undefined]), [], 'nothing to watch, nothing to confirm');
  // a stop is never let out by the clock, and books no timer
  let q = paceSequence(emptyPace<string>(), ['f1', 'f2', 'end'], [0, 1000, 2000], 0, [2]);
  const due = paceDue(q, 1e9);
  assert.deepEqual(due.out, ['f1', 'f2']);
  q = due.rest;
  assert.ok(paceStopped(q));
  assert.equal(paceWake(q, 1e9), null, 'no timer behind a stop');
  assert.equal(paceHeld(q, 1e9), 1, 'the stop still counts as held');
  // confirming lets the stop out now and keeps the spacing behind it
  q = paceSequence(emptyPace<string>(), ['f1', 'f2', 'f3', 'end'], [0, 1000, 1000, 2000], 0, [1, 3]);
  q = paceToStop(q).rest;
  assert.deepEqual(q.queue.map(p => p.item), ['f2', 'f3', 'end']);
  q = paceGo(q, 50_000);
  assert.deepEqual(q.queue.map(p => [p.item, p.at, !!p.stop]), [['f2', 50_000, false], ['f3', 51_000, false], ['end', 53_000, true]]);
});

after(() => { Date.now = realNow; });
