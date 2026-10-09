/* 328 — A NUMBER KEY PUTS THE UNIT YOU PICKED UP INTO THAT COLUMN (owner,
 * 2026-09-27: "Click a unit then a number key to quick add that unit to that
 * number column (default to adding it as forward as possible, so front
 * first, then back)").
 *
 * §1  forwardRow: the front if it is free, else the back, else nothing
 * §2  blocking: 1 puts the first blocker in front of column 1, 1 again puts
 *     the next one behind it, a third stays in your hand; a column past the
 *     attack is not a column
 * §3  declaring: the key reaches the empty column after the built ones, so
 *     2 opens column 2 — and no further
 * §4  a key with nothing picked up does nothing
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { EntityId, Seat } from '../../engine/src/types.ts';
import { forwardRow } from '../formation.ts';
import { client, idsIn } from './ui-driver.ts';

const ui = await client();

/** battle column `ci` (0-based) as markup, cut where the next column or the
 * next block of the board begins — the last column's chunk would otherwise
 * run on into the In Play zone, where a unit still in your hand stands */
function colChunk(html: string, ci: number): string {
  const col = html.split('<div class="col"')[ci + 1];
  assert.ok(col, `no column ${ci + 1} on the board`);
  const ends = ['<div class="linv', '<div class="lplay', '<div class="linfo', '<div class="lfight', '<div class="linvside']
    .map(m => col.indexOf(m)).filter(i => i >= 0);
  return col.slice(0, ends.length ? Math.min(...ends) : undefined);
}
/** the units standing in battle column `ci`, in markup order (front first) */
const column = (html: string, ci: number): number[] => idsIn(colChunk(html, ci));
/** the blockers under attacking column `ci`, front first */
function blockersUnder(html: string, ci: number): number[] {
  const col = colChunk(html, ci);
  return idsIn(col.slice(col.indexOf('bhalf bot')));
}

function blockStep(seed: number, attackers: number, defenders: number): { h: Harness; D: Seat; def: EntityId[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = Array.from({ length: attackers }, () => spawn(h, A, 'The Foretold'));
  const def = Array.from({ length: defenders }, () => spawn(h, D, 'The Foretold'));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: atk.map(id => [id]) });
  for (let guard = 0; guard < 40 && h.state.battle!.step !== 'blocks'; guard++) {
    const dec = h.state.decision;
    if (dec) h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
    else h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  assert.equal(h.state.battle!.step, 'blocks', 'the premise: the block step is open');
  return { h, D, def };
}

test('§1 forwardRow: front, then back, then full', () => {
  assert.equal(forwardRow(undefined, []), 0);
  assert.equal(forwardRow([5], []), 1);
  assert.equal(forwardRow([5], [5]), 0, 'a unit waiting in the back leaves the front free');
  assert.equal(forwardRow([5, 6], []), null);
});

test('§2 blocking: 1, then 1 again, fills column 1 front to back; a third stays in hand', () => {
  const { h, D, def } = blockStep(32801, 2, 3);
  ui.join(h.state, D, legalActions(h.state, D));
  ui.click({ act: 'unit', id: String(def[0]!) });
  let html = ui.key('1');
  assert.deepEqual(blockersUnder(html, 0), [def[0]!], 'the first goes to the front of column 1');
  ui.click({ act: 'unit', id: String(def[1]!) });
  html = ui.key('1');
  assert.deepEqual(blockersUnder(html, 0), [def[0]!, def[1]!], 'the second goes behind it');
  ui.click({ act: 'unit', id: String(def[2]!) });
  html = ui.key('1');
  assert.deepEqual(blockersUnder(html, 0), [def[0]!, def[1]!], 'a full column takes no third');
  // R321: column 3 is the open side-block column now; 4 is past everything drawn
  html = ui.key('4');
  assert.equal(blockersUnder(html, 1).includes(def[2]!), false, 'there is no column 4 to block');
  html = ui.key('2');
  assert.deepEqual(blockersUnder(html, 1), [def[2]!], '…and it was still in hand for column 2');
});

test('§3 declaring: the next empty column is a number too, and no further', () => {
  const h = new Harness(32802);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const u = [spawn(h, A, 'The Foretold'), spawn(h, A, 'The Foretold'), spawn(h, A, 'The Foretold')];
  toNextBattle(h, A);
  assert.equal(h.state.battle?.step, 'declare', 'the premise: declaring');
  ui.join(h.state, A, legalActions(h.state, A));
  ui.click({ act: 'unit', id: String(u[0]!) });
  let html = ui.key('3');
  assert.equal(html.includes('column 3'), false, 'column 3 does not exist yet — nothing happened');
  html = ui.key('1');
  assert.deepEqual(column(html, 0), [u[0]!]);
  ui.click({ act: 'unit', id: String(u[1]!) });
  html = ui.key('2');
  assert.deepEqual(column(html, 1), [u[1]!], '2 opened column 2');
  ui.click({ act: 'unit', id: String(u[2]!) });
  html = ui.key('1');
  assert.deepEqual(column(html, 0), [u[0]!, u[2]!], 'and 1 again stands behind the first');
});

test('§4 nothing picked up, nothing happens', () => {
  const { h, D } = blockStep(32803, 1, 1);
  const before = ui.join(h.state, D, legalActions(h.state, D));
  assert.equal(ui.key('1'), before);
});
