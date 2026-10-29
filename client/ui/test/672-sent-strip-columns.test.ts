/* CT-383 — THE COUNTERATTACKERS-IN-TRANSIT STRIP WITH ELEVEN SENT.
 *
 * The probe asked whether the classic board's strip (a fixed 96px column of
 * 40px cards) clips once ten or more units are sent. Measured in headless
 * Chrome on review-ui-sent-eleven: it never clipped — but its inside was 82px,
 * a pixel short of two cards and a gap (83px), so every sent unit took a row
 * of its own. Eleven made a column 703px tall that stretched the region row
 * and scrolled the board by 548px at 1440x900. Now the strip is a grid,
 * `--sentcols` wide: two columns, and one more for every four past eight
 * (eleven: three columns of four, 293px).
 *
 * The geometry is the browser's (that measurement is in the round's report);
 * what can be held here is that the board asks for the columns and the
 * stylesheet lays them out.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import type { Seat } from '../../engine/src/types.ts';
import { pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { client } from './ui-driver.ts';


/** you attack with one unit; they block it and send `n` units back at you */
function sent(seed: number, n: number): { h: Harness; A: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  const blocker = spawn(h, D, 'Good Whale');
  const send = Array.from({ length: n }, () => spawn(h, D, 'Trashling'));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  for (let guard = 0; guard < 20 && h.state.battle!.step !== 'blocks'; guard++) pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] }, send });
  return { h, A };
}

const ui = await client();

test('CR 606.2d / CT-383: eleven units sent to counterattack are laid out three columns wide, not one', () => {
  const { h, A } = sent(67201, 11);
  const board = ui.join(h.state, A, legalActions(h.state, A));
  const strip = /<div class="sentstrip" style="--sentcols:(\d+)"/.exec(board);
  assert.ok(strip, 'the in-transit strip says how many columns it wants');
  assert.equal(Number(strip![1]), 3, 'eleven sent: three columns of four');
  assert.equal((board.match(/data-previd="\d+"/g) ?? []).length >= 11, true, 'every sent unit is drawn');
});

test('CR 606.2d / CT-383: a few sent keep the two columns the strip always meant', () => {
  const { h, A } = sent(67202, 4);
  const board = ui.join(h.state, A, legalActions(h.state, A));
  assert.match(board, /<div class="sentstrip" style="--sentcols:2"/);
});

