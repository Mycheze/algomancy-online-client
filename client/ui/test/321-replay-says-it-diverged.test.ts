/* BL-38 §5 — A REPLAY THAT IS NOT THE RECORDED GAME HAS TO SAY SO.
 *
 * This is the assertion the whole feature exists to make true. BL-38's own
 * words: *"a viewer that quietly showed a RECONSTRUCTED game instead of saying
 * so would be lying to the person watching."*
 *
 * The lie is comfortable and almost invisible. A saved game replays; the board
 * looks like a board; every control works. Nothing about the experience tells
 * you that the engine changed under the log and that what you are watching
 * diverged from the real game forty actions ago. Room KAWJ is the proof it
 * happens: 253 of 253 actions replayed, nothing refused, and a different final
 * life total.
 *
 * So: the chip names the divergence and cannot be styled quiet, the bar says
 * "not the recorded game" from the action it parted at, and — the part that is
 * easy to get subtly wrong — the marker appears at `partedAt` and NOT at
 * `refusedAt`. They are different numbers. `refusedAt` is where this engine
 * finally choked, which on ANBB is 93 actions after the boards actually parted.
 * Leading with it would present a third of a game that never happened as
 * though it had.
 *
 * A separate file from 320 because `?replay=` boots once, at import, and this
 * needs a different answer from the route.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzGame } from '../../engine/test/fuzz.ts';

const PARTED = 12;
const REFUSED = 40;

const FUZZ = fuzzGame(11, 200);
const PAYLOAD: Record<string, unknown> = {
  ok: true,
  file: { seed: 11, mode: 'shared', names: ['Alice', 'Bob'], actions: FUZZ.actions },
  mySeat: 0, asAdmin: false,
  verdict: 'reconstruction', forked: false, partedAt: PARTED, refusedAt: REFUSED,
};

const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '?replay=DRFT';
g['__UI_DRIVER_FETCH'] = () => Promise.resolve({ ok: true, json: () => Promise.resolve(PAYLOAD) });

const { replay } = await import('./ui-driver.ts');
const settle = (): Promise<void> => new Promise(r => { setImmediate(() => r()); });
await settle();
const ui = replay();

const PARTED_MARK = /not the recorded game/;

test('BL-38 §5a the chip names the divergence, in actions, and is not quiet', () => {
  const html = ui.html();
  assert.match(html, new RegExp(`reconstruction from action ${PARTED}`),
    'the verdict chip does not say where this stopped being the recorded game');
  assert.match(html, /replaychip bad/,
    'a reconstruction is styled as though it were fine');
});

test('BL-38 §5b the explanation distinguishes where they PARTED from where it REFUSED', () => {
  const open = ui.click({ replay: 'detail' });
  assert.match(open, new RegExp(`Up to action ${PARTED}`));
  assert.match(open, new RegExp(`action ${REFUSED}`),
    'the explanation never mentions the refusal, so the reader cannot tell the '
    + 'two numbers apart');
  assert.match(open, new RegExp(`${REFUSED - PARTED} actions earlier`),
    'the gap between the two is the whole of R200 and should be stated, not left '
    + 'as arithmetic for the reader');
  ui.click({ replay: 'detail' });
});

test('BL-38 §5c the marker appears at partedAt — not before, and not at the refusal', () => {
  assert.doesNotMatch(ui.html(), PARTED_MARK, 'a replay at action 0 is not past anything');

  for (let i = 0; i < PARTED; i++) ui.click({ replay: 'fwd' });
  assert.match(ui.html(), /action 12 \//);
  assert.doesNotMatch(ui.html(), PARTED_MARK,
    'AT the parting the board is still the recorded one — the action at `partedAt` '
    + 'is the last one that matched');

  ui.click({ replay: 'fwd' });
  assert.match(ui.html(), PARTED_MARK,
    'one action past the divergence and the viewer is showing a game that never '
    + 'happened, with nothing on screen saying so');

  // and it does not wait for the refusal to admit it
  assert.ok(PARTED < REFUSED, 'fixture: the refusal must be the later number');
});

test('BL-38 §5d stepping back before the parting clears the marker', () => {
  for (let i = 0; i < 5; i++) ui.click({ replay: 'back' });
  assert.doesNotMatch(ui.html(), PARTED_MARK,
    'the marker is about where the cursor IS, not about the file');
});
