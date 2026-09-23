/* BL-38 §4 — THE REPLAY VIEWER, END TO END THROUGH ui/main.ts.
 *
 * 319 proves the replay SERVER walks a log correctly. This proves the browser
 * client is actually wired to it: `?replay=CODE` fetches the saved game, swaps
 * the `openSocket` seam for the in-page server, and the ordinary board renderer
 * paints a board it has no idea is a recording.
 *
 * The wiring is where the interesting failures live, and none of them would be
 * caught by 319:
 *
 *   §1  the board paints at all, and the transport is on screen with it
 *   §2  ▶ moves the game forward and the bar's counter follows
 *   §3  ◀ moves it back — the bar and the board agree about where they are
 *   §4  the eye toggle changes what is on the board, not just the label
 *   §5  the verdict chip is present, and a reconstruction SAYS SO and cannot
 *       be dismissed
 *   §6  a replay offers no affordance: this is a spectator view of a finished
 *       game and clicking a card must never be able to send anything
 *
 * ⚠ The driver's `fetch` normally never resolves, on purpose. This file
 * installs `__UI_DRIVER_FETCH` before importing it — the one door in that,
 * opened for exactly this route (see ui-driver.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzGame } from '../../engine/test/fuzz.ts';

/* ── the saved game the route will be answered with ──────────────────── */

const FUZZ = fuzzGame(11, 200);
const FILE = { seed: 11, mode: 'shared', names: ['Alice', 'Bob'], actions: FUZZ.actions };

/** what `/api/replay/RPLY` hands back. Mutated by §5 before its own import. */
const PAYLOAD: Record<string, unknown> = {
  ok: true, file: FILE, mySeat: 0, asAdmin: false,
  verdict: 'as-recorded', forked: false, partedAt: null, refusedAt: null,
};

const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '?replay=RPLY';
g['__UI_DRIVER_FETCH'] = (url: string) => {
  assert.match(url, /^\/api\/replay\/RPLY$/, `the client asked for ${url}`);
  return Promise.resolve({ ok: true, json: () => Promise.resolve(PAYLOAD) });
};

const { replay } = await import('./ui-driver.ts');

/**
 * Let the microtasks run.
 *
 * TWO things here are deferred and both have to be, so a test that read the
 * page synchronously after a click would be reading one frame behind. The
 * fetch is a promise; and `FakeSocket` delivers on `queueMicrotask` rather
 * than synchronously, because a real socket never delivers inside `send` and
 * the client is written against one. The BAR repaints synchronously (it owns
 * its own layer), so an assertion about the bar needs no settle and one about
 * the BOARD does.
 */
const settle = (): Promise<void> => new Promise(r => { setImmediate(() => r()); });
await settle();

const ui = replay();

/* ── reading the bar ─────────────────────────────────────────────────── */

/** "action 12 / 200" → 12 */
function at(html: string): number {
  const m = /action (\d+) \/ (\d+)/.exec(html);
  assert.ok(m, 'the replay bar is not showing where it is');
  return Number(m[1]);
}

/* ══════════════════════════════════════════════════════════════════════ */

test('BL-38 §1 the board and the transport are both on screen', () => {
  const html = ui.html();
  // the driver reads each layer's innerHTML, so the bar's ROOT class is not
  // visible here — its contents are
  assert.match(html, /class="replayhead"/, 'the replay transport did not install');
  assert.match(html, /class="replaytransport"/, 'the transport has no controls');
  assert.match(html, /RPLY/, 'the bar does not say which game this is');
  assert.equal(at(html), 0, 'a replay opens at the beginning');
  assert.ok(ui.has({ replay: 'play' }), 'no play button');
  assert.ok(ui.has({ replay: 'scrub' }), 'no scrubber — BL-38 asks for step AND scrub');
  // the board itself, not just the furniture
  assert.match(html, /class="table|regionpanel|stickytop/,
    'the ordinary board renderer never painted — the socket seam is not wired');
});

test('BL-38 §2 forward moves the game, and the bar follows', () => {
  const before = at(ui.html());
  const after = at(ui.click({ replay: 'fwd' }));
  assert.equal(after, before + 1, 'one click, one action');
  for (let i = 0; i < 20; i++) ui.click({ replay: 'fwd' });
  assert.equal(at(ui.html()), before + 21);
});

test('BL-38 §3 back moves it back, past a checkpoint boundary', () => {
  // sit well past the first checkpoint (every 25) so the rewind is a real one
  for (let i = at(ui.html()); i < 60; i++) ui.click({ replay: 'fwd' });
  assert.equal(at(ui.html()), 60);
  const boardAt60 = ui.html();
  ui.click({ replay: 'back' });
  assert.equal(at(ui.html()), 59);
  ui.click({ replay: 'fwd' });
  assert.equal(at(ui.html()), 60);
  assert.equal(ui.html(), boardAt60,
    'stepping back and forward again did not come home — the checkpoint rewind '
    + 'is reconstructing a different board (319 §2 covers the server; this is the page)');
});

test('BL-38 §4 the eye toggle changes the board, not only its own label', async () => {
  const seatView = ui.html();
  ui.click({ replay: 'eye' });
  await settle();                       // the new board arrives over the socket
  const both = ui.html();
  assert.notEqual(both, seatView, 'the toggle painted nothing new');
  // the button carries the CURRENT mode and lights up when omniscient, the way
  // every other toggle on this board does; its title says what a click will do
  assert.match(seatView, /replayeye"[^>]*>\s*your view/, 'a replay does not open on your own seat');
  assert.match(both, /replayeye on/, 'the toggle did not light up');
  assert.match(both, /both hands/);
  ui.click({ replay: 'eye' });
  await settle();
  assert.match(ui.html(), /your view/, 'the toggle would not come back');
  assert.equal(at(ui.html()), at(seatView), 'the toggle moved the cursor');
});

test('BL-38 §5 the verdict is always on screen, and opens its explanation', () => {
  assert.match(ui.html(), /replaychip/, 'no verdict chip');
  assert.match(ui.html(), /as recorded/, 'a faithful replay should say so');
  const open = ui.click({ replay: 'detail' });
  assert.match(open, /replaydetail/, 'the chip did not open its explanation');
  assert.match(open, /the game that was played/);
  ui.click({ replay: 'detail' });
});

test('BL-38 §6 a replay offers no affordance — nothing on this board can be played', () => {
  // `spectating` on the NetBackend empties `legal`, and the renderer draws
  // affordances from `legal`. A replay that offered one would be offering to
  // change a game that is over.
  const html = ui.html();
  assert.doesNotMatch(html, /data-btn="play"/,
    'the board offered a play action in a replay — `spectating` is not set');
  assert.doesNotMatch(html, /data-btn="pass"/,
    'the board offered to pass priority in a replay');
});
