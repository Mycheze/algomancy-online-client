/* 400 — R321/R322 IN THE CLIENT: side-blocks are built on the board, and a
 * blocker put in after blocks is placed by clicking the column it blocks.
 *
 * The RAQ ("What is blocked?"): a defender may block where no attacker is,
 * any number of units, each its own column (Caleb); and a unit put in front
 * of an unblocked attacker after blocks blocks it. The engine half is
 * engine/test/400; this is the half a player touches.
 *
 * §1  while I build blocks the panel draws one open side-block column past
 *     the attack — and only while blocks are being built
 * §2  a unit dropped there goes out as a key past the last attacking column,
 *     the engine takes it, and the builder opens the next side column
 * §3  committed, the side-block's column says "no attacker", not "gone"
 * §4  the in-progress side-blocks survive the line re-keying under them
 * §5  a blocking spot (R322) is drawn in the column it blocks
 * §6  a number key reaches the side-block column
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { apply, legalActions } from '../../engine/src/apply.ts';
import type { Action, EntityId, Seat } from '../../engine/src/types.ts';
import { pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { rekeyBuild } from '../formation.ts';
import { spotAnchor } from '../fslot.ts';
import { client } from './ui-driver.ts';

const ui = await client();

/** the block step: A attacks with two one-unit columns, D has `k` units */
function blockStep(seed: number, k: number): { h: Harness; A: Seat; D: Seat; mine: EntityId[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = [spawn(h, A, 'The Foretold'), spawn(h, A, 'The Foretold')];
  const mine = Array.from({ length: k }, () => spawn(h, D, 'The Foretold'));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: atk.map(id => [id]) });
  for (let g = 0; g < 10 && h.state.battle!.step !== 'blocks'; g++) pass(h);
  assert.equal(h.state.battle!.step, 'blocks', 'the premise: the block step');
  return { h, A, D, mine };
}

test('§1 while blocks are built, one open side-block column stands past the attack', () => {
  const { h, D } = blockStep(40001, 2);
  ui.join(h.state, D, legalActions(h.state, D));
  assert.ok(ui.has({ act: 'slot', ci: '1', row: '0' }), 'the last attacking column');
  assert.ok(ui.has({ act: 'slot', ci: '2', row: '0' }), 'and a side-block slot past it');
  assert.ok(!ui.has({ act: 'slot', ci: '3', row: '0' }), 'one open side column, not a run of them');
  assert.match(ui.html(), /column 3 · side-block/, 'labelled as a side-block');
});

test('§2 a unit dropped in the side column is sent past the last attacking column, and the engine takes it', () => {
  const { h, D, mine } = blockStep(40002, 2);
  ui.join(h.state, D, legalActions(h.state, D));
  ui.click({ act: 'unit', id: String(mine[0]) });
  ui.click({ act: 'slot', ci: '2', row: '0' });
  assert.ok(ui.has({ act: 'slot', ci: '3', row: '0' }), 'the next side column opens beside it');
  ui.actions();
  ui.click({ btn: 'confirmblocks' });
  const sent = ui.actions().filter((a): a is Extract<Action, { type: 'declareBlocks' }> => a.type === 'declareBlocks');
  assert.equal(sent.length, 1, 'Confirm sent one declaration');
  assert.deepEqual(sent[0]!.blocks, { 2: [mine[0]] }, 'keyed past the two attacking columns');
  assert.doesNotThrow(() => apply(h.state, sent[0]!), 'the engine accepts the side-block');
});

test('§3 committed, a side-block column says there is no attacker in it', () => {
  const { h, D, mine } = blockStep(40003, 1);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 2: [mine[0]!] } });
  ui.join(h.state, D, legalActions(h.state, D));
  assert.match(ui.html(), /column 3 · side-block/);
  assert.match(ui.html(), /no attacker/, 'not "gone": nobody ever stood there');
});

test('§4 an in-progress side-block keeps its distance from the end of the line as the line moves', () => {
  const before = [[1], [2]];
  const build = [[], [], [9]];                         // a side-block just past column 2
  assert.deepEqual(rekeyBuild(before, before, build).columns, [[], [], [9]], 'nothing moved, nothing changes');
  const shrunk = rekeyBuild(before, [[2]], build);       // column 1 collapsed
  assert.deepEqual(shrunk.columns, [[], [9]], 'it follows the end of the line in');
  assert.deepEqual(shrunk.dropped, [], 'and is not thrown away');
});

test('§5 a blocking spot is drawn in the column it blocks', () => {
  const { h, D } = blockStep(40005, 1);
  assert.deepEqual(spotAnchor(h.state, D, { kind: 'block', column: 1 }), { kind: 'col', ci: 1 });
});

test('§6 a number key reaches the open side-block column', () => {
  const { h, D, mine } = blockStep(40006, 1);
  ui.join(h.state, D, legalActions(h.state, D));
  ui.click({ act: 'unit', id: String(mine[0]) });
  ui.key('3');                                          // two attacking columns, then the side column
  ui.actions();
  ui.click({ btn: 'confirmblocks' });
  const sent = ui.actions().filter((a): a is Extract<Action, { type: 'declareBlocks' }> => a.type === 'declareBlocks');
  assert.deepEqual(sent[0]?.blocks, { 2: [mine[0]] }, 'key 3 put it in the side-block column');
});
