/* 1230 — REPORT #385 / CT-560: THE BATTLE BOARD'S TWO REMINDER LINES ARE GONE.
 *
 * The owner (mycheze, WSVC, 2026-11-11): "let's remove the \"nothing placed
 * yet\" and \"arrives next round\" reminder text. it's just superfluous at
 * this point". Two dim lines on the battle board:
 *
 * §1  watching the other seat choose its attack with no column
 *     placed, the fight read "nothing placed yet…" under the ● live header;
 * §2  the strip of counterattackers in transit, beside the bin, ended with
 *     "arrives next round" under its "incoming — <name>" label.
 *
 * Both are drawn by ui/main.ts and are asserted on the rendered board here.
 * The strip itself and the watching header stay; the send slot's hover tip
 * ("… it arrives next round") is a tooltip, not the reminder, and stays.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import type { Seat } from '../../engine/src/types.ts';
import { pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { client } from './ui-driver.ts';

const ui = await client();

test('report #385: watching the other seat choose an attack with nothing placed, no "nothing placed yet" line', () => {
  const h = new Harness(123001);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  spawn(h, A, 'The Foretold');
  spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  assert.equal(h.state.battle!.step, 'declare', 'the premise: the attack is being chosen');
  ui.join(h.state, D, legalActions(h.state, D));
  ui.push({ t: 'building', seat: A, cols: [], send: [] });
  const html = ui.html();
  assert.match(html, /class="battle watching"/, 'the premise: the defender watches the attack being built');
  assert.doesNotMatch(html, /nothing placed yet/);
});

test('report #385: the counterattackers in transit carry no "arrives next round" line', () => {
  const h = new Harness(123002);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  const blocker = spawn(h, D, 'Good Whale');
  const send = [spawn(h, D, 'Trashling'), spawn(h, D, 'Trashling')];
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  for (let g = 0; g < 20 && h.state.battle!.step !== 'blocks'; g++) pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] }, send });
  const board = ui.join(h.state, A, legalActions(h.state, A));
  assert.match(board, /<div class="sentstrip"/, 'the premise: the in-transit strip is drawn');
  assert.doesNotMatch(board, /arrives next round<\/div>/);
  assert.doesNotMatch(board, /sentfoot/);
});
