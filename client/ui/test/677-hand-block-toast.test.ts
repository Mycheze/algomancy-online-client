/* 677 — WHY A DARK HAND CARD WILL NOT PLAY, WHERE THE PLAYER LOOKS (CT-371).
 *
 * CT-288 (report #211) taught the client the reason a hand card has no offer
 * (handBlockReason, ui/inspect.ts) and hung it under the card ZOOM. The zoom is
 * the regions board's; the classic board has none, so there it said nothing,
 * and on either board a click on the dark card still did nothing at all.
 *
 * Now a mouse click on a dark hand card says the reason as a toast, on either
 * board; the classic board's hover box carries it as its last line; and a
 * finger's tap still only reads (#201), its zoom carrying the reason as before
 * (the headless-Chrome check of that is in the round's report).
 *
 * Driven through the real client (test/ui-driver.ts). The driver sends no
 * mouseover, so the hover box's wiring is read as text at the bottom, as 619
 * reads the zoom's.
 *
 * Seeds 67700-67799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import type { Seat } from '../../engine/src/types.ts';
import { give, giveResources, pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { client } from './ui-driver.ts';

const ui = await client();
const store = (globalThis as unknown as { localStorage: Storage }).localStorage;
const board = (regions: boolean): void => { store.setItem('algoLayout', regions ? '2' : '1'); };

/** A attacks with The Foretold; D holds priority in the battle, with `fire` open
 * fire resources and an Arc Lightning (rr, 4) in hand */
function battle(seed: number, fire: number): { h: Harness; D: Seat; i: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[D]!.resources = [];
  giveResources(h, D, 'fire', fire);
  while (h.state.priority !== D) pass(h);
  const i = give(h, D, 'Arc Lightning');
  return { h, D, i };
}

function show(h: Harness, seat: Seat): void {
  ui.tick();   // the last test's toast runs out (its 4s timer)
  ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
  ui.sent();
}

const mouse = (want: Record<string, string | number>): void => {
  ui.pointer('pointerdown', want, { pointerType: 'mouse', pointerId: 2, isPrimary: true });
};
const toast = (html: string): string | null => /<div class="toast">([^<]*)<\/div>/.exec(html)?.[1] ?? null;

for (const regions of [false, true]) {
  const name = regions ? 'the regions board' : 'the classic board';
  test(`CR 111.6 / CT-371: on ${name} a mouse click on a hand card it cannot afford says why, and sends nothing`, () => {
    board(regions);
    const { h, D, i } = battle(regions ? 67701 : 67700, 2);
    show(h, D);
    assert.ok(ui.has({ act: 'hand', p: D, i }), 'the card is in the hand strip');
    mouse({ act: 'hand', p: D, i });
    const html = ui.click({ act: 'hand', p: D, i });
    assert.deepEqual(ui.actions(), [], 'nothing is played');
    assert.equal(toast(html), 'Needs 4 mana; you have 2.', 'the toast says the reason the zoom would');
    store.removeItem('algoLayout');
  });
}

test('CR 403.3b / CT-371: a click on a card that is playable says no reason', () => {
  board(false);
  const { h, D, i } = battle(67702, 4);
  show(h, D);
  mouse({ act: 'hand', p: D, i });
  const html = ui.click({ act: 'hand', p: D, i });
  assert.equal(toast(html), null, 'a playable card has no reason to give');
  assert.ok(ui.actions().length > 0 || /class="menu"/.test(html), 'it is played or offered, as before');
  store.removeItem('algoLayout');
});

test('CR 111.6 / CT-371: a finger tap on the dark card only reads it, it raises no toast', () => {
  board(false);
  const { h, D, i } = battle(67703, 2);
  show(h, D);
  const html = ui.tap({ act: 'hand', p: D, i });
  assert.deepEqual(ui.actions(), []);
  assert.equal(toast(html), null, 'the read is the tap: its zoom carries the reason');
  store.removeItem('algoLayout');
});

test('CT-371: the classic board hover box ends with the reason, and the click and the zoom ask the same helper', () => {
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  assert.match(main, /function handWhy\(p: Seat, i: number\): string \{/, 'one helper owns the question');
  assert.match(main, /: handBlockLine\(handBlockReason\(q\(\), p, i, legalFor\(p\)\)\);/, 'and it is the CT-288 question');
  assert.match(main, /const why = handWhy\(p, i\);\n\s*if \(why\) copy\.insertAdjacentHTML\('beforeend', `<div class="zoomhang handwhy">/,
    'the zoom asks it');
  assert.match(main, /if \(!items\.length\) \{ const why = handWhy\(p, i\); if \(why\) showToast\(why\); \}/,
    'the click asks it when nothing is offered');
  assert.match(main, /if \(!zoomOn\(\) && target\.dataset\['act'\] === 'hand'\)/, 'the classic hover box asks it for a hand card');
});
