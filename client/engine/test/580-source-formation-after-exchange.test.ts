/* CR 602.6e — "my formation" is the line the SOURCE stands in, even when that
 * is the other seat's.
 *
 * Organic Exchange ("Exchange control of two target units and swap their
 * positions") is the one control change that keeps a unit in a formation, and
 * it puts it in the OTHER seat's line. Hooba-Bot and Hooba-Pon trigger when
 * they block, so with that trigger waiting an exchange of the blocker and an
 * attacker leaves the source standing in the attacking line while the trigger
 * stays the defender's. The owner, 2026-10-22: "Source's formation" — the
 * Robot, or the played unit, joins the line the source now stands in.
 * E.placeInFormation already read it that way; Hooba-Pon's play into
 * formation read the CONTROLLER's grid, and is made to agree here.
 *
 * Seeds 58001-58009.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';

/** D blocks attacking column 0 with `name`; with its block trigger waiting, D
 * casts Organic Exchange on it and the attacker of column 1 */
function exchangedBlocker(seed: number, name: string): { h: Harness; A: Seat; D: Seat; src: EntityId; a2: EntityId } {
  const h = new Harness(seed, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a1 = spawn(h, A, 'Good Whale'), a2 = spawn(h, A, 'Good Whale');
  const src = spawn(h, D, name);
  giveResources(h, D, 'wood', 3);
  giveResources(h, D, 'water', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1], [a2]] });
  for (let i = 0; i < 40 && h.state.battle?.step !== 'blocks'; i++) pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [src] } });
  const trig = h.state.stack.find(i => i.sourceId === src);
  assert.ok(trig, `${name}: its block trigger waits`);
  assert.equal(trig.controller, D, 'and it is the defender\'s');
  if (h.state.priority !== D) pass(h);
  assert.equal(h.state.priority, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Organic Exchange') });
  pick(h, { unit: src });
  pick(h, { unit: a2 });
  pass(h); pass(h);                                   // the exchange resolves
  const b = h.state.battle!;
  assert.deepEqual(b.columns[1], [src], `${name} now stands in the attacking line`);
  assert.equal(ent(h, src)!.controller, A, 'under the attacker');
  assert.deepEqual(b.blocks[0], [a2], 'and the attacker it swapped with blocks for the defender');
  return { h, A, D, src, a2 };
}

test('CR 602.6e / Organic Exchange: Hooba-Bot swapped into the attacking line under its block trigger makes the Robot there, for the trigger controller', () => {
  const { h, D, src } = exchangedBlocker(58001, 'Hooba-Bot');
  for (let i = 0; i < 6 && !h.state.decision && h.state.stack.some(it => it.sourceId === src); i++) pass(h);
  const dec = h.state.decision!;
  assert.equal(dec.seat, D, 'the trigger controller chooses');
  assert.ok(dec.options.some(o => o.spot?.kind === 'end'), 'the options are the ATTACKING line (it has ends)');
  h.do({ type: 'decide', seat: D, choice: dec.options.findIndex(o => o.spot?.kind === 'behind' && o.spot.unit === src) });
  const b = h.state.battle!;
  const robot = b.columns.flat().map(id => ent(h, id)).find(u => u?.card === 'Robot');
  assert.ok(robot, 'the Robot stands in the line Hooba-Bot stands in');
  assert.equal(robot.controller, D, 'and it is the trigger controller\'s');
  assert.equal(b.columns.find(c => c.includes(robot.id))![0], src, 'behind Hooba-Bot, where it was put');
  finishBattle(h);
});

test('CR 602.6e / Organic Exchange: Hooba-Pon swapped into the attacking line under its block trigger plays the unit into that line, for the trigger controller', () => {
  const { h, D, src } = exchangedBlocker(58002, 'Hooba-Pon');
  give(h, D, 'Hooba-Pon');                            // the unit to pay for
  for (let i = 0; i < 6 && !h.state.decision && h.state.stack.some(it => it.sourceId === src); i++) pass(h);
  let dec = h.state.decision!;
  assert.equal(dec.seat, D);
  h.do({ type: 'decide', seat: D, choice: dec.options.findIndex(o => o.label === 'Hooba-Pon') });
  dec = h.state.decision!;
  assert.ok(dec, 'where it joins is asked');
  assert.ok(dec.options.some(o => o.spot?.kind === 'end'),
    'the options are the ATTACKING line Hooba-Pon stands in, not the defender\'s blocking grid');
  assert.ok(!dec.options.some(o => o.spot?.kind === 'block'), 'no spot in front of an unblocked attacker');
  h.do({ type: 'decide', seat: D, choice: dec.options.findIndex(o => o.spot?.kind === 'behind' && o.spot.unit === src) });
  for (let i = 0; i < 6 && h.state.stack.length && !h.state.decision; i++) pass(h);   // the played unit resolves
  const b = h.state.battle!;
  const col = b.columns.find(c => c.includes(src))!;
  assert.equal(col.length, 2, 'the paid unit stands behind Hooba-Pon');
  const played = ent(h, col[1]!)!;
  assert.equal(played.card, 'Hooba-Pon');
  assert.equal(played.controller, D, 'and it is the trigger controller\'s');
  assert.ok(!Object.values(b.blocks).flat().includes(played.id), 'not in the blocking grid');
  finishBattle(h);
});
