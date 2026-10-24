/* 646 — ON TOUCH, A TAP ON A BIN CARD ONLY READS (CT-381, the half of report
 * #201 that was missed).
 *
 * Report #201 (WUSC, 2026-10-08): "the game forced me to play my card in
 * battle when I was just trying to look at it." The owner's answer: on touch,
 * a tap only reads; drag plays. test/384 pins it for the hand and the cache.
 * The bin had neither guard: the dialog's `data-act="bin"` entry and the
 * region panel's `data-btn="binplay"` thumb both went straight to
 * handleBinClick, so a finger's tap on a bin card that was playable (CR 405.9),
 * prophesiable (CR 803.7c) or usable as a mod (CR 720.5) did it.
 *
 * The bin has no drag (a dialog's cards never drag, and the panel's thumbs are
 * buttons), so "tap only reads" alone would have left a finger NO way to use a
 * bin card at all. The finger's route is a button under each usable card in
 * the dialog (`data-btn="binuse"`): a button is a button, like the rail's. And
 * a finger's tap on a usable thumb in the panel opens the bin, as a tap on any
 * other thumb there always has — the dialog is where the card is read and used.
 *
 * Driven through the real client (test/ui-driver.ts), as 384 is: the finger is
 * a pointerdown/pointerup of type `touch` and the click the browser makes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './ui-driver.ts';
import { Harness } from '../../engine/src/harness.ts';
import { spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';

const ui = await client();
const me = 0 as Seat;

/** a mouse's press, so the next click is a mouse click again */
const mouse = (want: Record<string, string | number>): void => {
  ui.pointer('pointerdown', want, { pointerType: 'mouse', pointerId: 2, isPrimary: true });
};

/** a battle, one card in my bin, and `legal` the bin's one route */
function battleWithABinCard(seed: number): GameState {
  const h = new Harness(seed);
  toDeployment(h);
  spawn(h, me, 'Hooba-Nan');   // a unit of mine, to be a mod's host
  toNextBattle(h, me);
  const s = structuredClone(h.state);
  s.players[me]!.bin = ['Fireball'];
  return s;
}

const PLAY: Action[] = [{ type: 'playFromBin', seat: me, binIndex: 0 }];

/** the bin dialog, opened with a mouse (opening is not what is under test) */
function openBin(state: GameState, legal: Action[]): string {
  ui.join(state, me, legal);
  mouse({ btn: 'binopen', p: me });
  const html = ui.click({ btn: 'binopen', p: me });
  assert.match(html, /binbox/, 'the bin dialog is open');
  ui.sent();
  return html;
}

test('CR 405.9 / CT-381: the control, a mouse click on a playable card in the bin dialog still plays it', () => {
  openBin(battleWithABinCard(64601), PLAY);
  mouse({ act: 'bin', p: me, i: 0 });
  ui.click({ act: 'bin', p: me, i: 0 });
  assert.deepEqual(ui.actions(), PLAY, 'one legal play, one click, played: the desktop is unchanged');
});

test('CR 405.9 / CT-381: a finger tap on a playable card in the bin dialog sends nothing and opens no menu', () => {
  openBin(battleWithABinCard(64602), PLAY);
  const html = ui.tap({ act: 'bin', p: me, i: 0 });
  assert.deepEqual(ui.actions(), [], 'a tap must not play the bin card (report #201)');
  assert.doesNotMatch(html, /class="menu"/, 'nor offer a menu to play it from');
  assert.match(html, /binbox/, 'and the bin stays open to read');
});

test('CR 803.7c / CT-381: a finger tap on a bin card that can be prophesied or modded does neither', () => {
  const proph: Action[] = [{ type: 'prophesy', seat: me, from: 'bin', index: 0 }];
  openBin(battleWithABinCard(64603), proph);
  let html = ui.tap({ act: 'bin', p: me, i: 0 });
  assert.deepEqual(ui.actions(), []);
  assert.doesNotMatch(html, /class="menu"/, 'no prophesy menu on a tap');
  mouse({ act: 'bin', p: me, i: 0 });
  assert.match(ui.click({ act: 'bin', p: me, i: 0 }), /class="menu"/, 'a mouse click still opens it');
  ui.key('Escape');

  const s = battleWithABinCard(64604);
  const host = Object.values(s.entities).find(en => en.kind === 'unit' && en.controller === me && !en.absent);
  assert.ok(host, 'the fixture has a unit of mine to be a host');
  const mod: Action[] = [{ type: 'augment', seat: me, from: 'bin', index: 0, hostId: host.id }];
  openBin(s, mod);
  html = ui.tap({ act: 'bin', p: me, i: 0 });
  assert.deepEqual(ui.actions(), []);
  assert.match(html, /binbox/, 'a tap does not close the bin to start a mod placement');
  assert.doesNotMatch(html, /modhost/, 'and no host lights up');
  // the control: the same card under a mouse starts the placement
  mouse({ act: 'bin', p: me, i: 0 });
  html = ui.click({ act: 'bin', p: me, i: 0 });
  assert.match(html, /modhost/, 'a mouse click lights the host, so the tap above was really refused');
  ui.key('Escape');
});

test('CR 405.9 / CT-381: the finger route, a tap on the use button under a usable bin card plays it', () => {
  const html = openBin(battleWithABinCard(64605), PLAY);
  assert.ok(ui.has({ btn: 'binuse', p: me, i: 0 }), 'the usable bin card has its own button in the dialog');
  ui.tap({ btn: 'binuse', p: me, i: 0 });
  assert.deepEqual(ui.actions(), PLAY, 'a button is a button: tapped, it plays');
  // and only usable cards carry one
  const s = battleWithABinCard(64606);
  s.players[me]!.bin.push('Fireball');
  openBin(s, PLAY);
  assert.ok(!ui.has({ btn: 'binuse', p: me, i: 1 }), 'a card with nothing to do has no button');
  assert.match(html, /binbox/);
});

test('CR 405.9 / CT-381: a finger tap on a usable bin thumb in the region panel opens the bin, it does not play', () => {
  ui.join(battleWithABinCard(64607), me, PLAY);
  ui.sent();
  assert.ok(ui.has({ btn: 'binplay', p: me, i: 0 }), 'the usable thumb carries its own affordance');
  const html = ui.tap({ btn: 'binplay', p: me, i: 0 });
  assert.deepEqual(ui.actions(), [], 'a tap on the thumb must not play the card');
  assert.match(html, /binbox/, 'it opens the bin, as a tap on any other thumb there does');
  ui.click({ btn: 'binclose' });

  // a mouse still plays straight off the thumb
  mouse({ btn: 'binplay', p: me, i: 0 });
  ui.click({ btn: 'binplay', p: me, i: 0 });
  assert.deepEqual(ui.actions(), PLAY, 'a mouse click on the thumb still plays it');
});
