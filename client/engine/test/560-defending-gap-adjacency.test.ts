/* CT-249 — an unblocked attacking column is a GAP in the defending formation.
 *
 * A blocking column is keyed to the attacking column it faces (CR 606.1e), and
 * an empty blocking column keeps its place (CR 606.1f, 602.5d). The engine used
 * to build the defender's grid from the block keys sorted and COMPRESSED, so
 * blockers on attacking columns 1 and 3 with column 2 unblocked read as
 * left/right neighbours: Inspiration buffed across the gap (CR 603.2's own
 * example says it must not). The defending grid now has one column per
 * attacking column, empty where unblocked.
 *
 * Seeds 56001-56009.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E } from '../src/engine.ts';
import { Harness } from '../src/harness.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { effStats, finishBattle, pass, spawn, toDeployment, toNextBattle } from './util.ts';

/** three attacking 1/1 columns; the defender has Inspiration and two 1/1s at home */
function threeColumnAttack(seed: number): { h: Harness; A: Seat; D: Seat; atk: EntityId[]; insp: EntityId; t1: EntityId; t2: EntityId } {
  const h = new Harness(seed, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = [spawn(h, A, 'Unit Token'), spawn(h, A, 'Unit Token'), spawn(h, A, 'Unit Token')];
  const insp = spawn(h, D, 'Inspiration');             // 3/2
  const t1 = spawn(h, D, 'Unit Token');
  const t2 = spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk[0]!], [atk[1]!], [atk[2]!]] });
  pass(h); pass(h);
  return { h, A, D, atk, insp, t1, t2 };
}

test('CR 606.1f / CT-249: blockers either side of an unblocked column are not adjacent, so Inspiration does not buff across the gap', () => {
  const { h, D, insp, t1 } = threeColumnAttack(56001);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [insp], 2: [t1] } });
  const e = new E(h.state);
  assert.deepEqual(e.adjacentInFormation(insp), [], 'the unblocked middle column lies between them');
  assert.deepEqual(e.adjacentInFormation(t1), []);
  assert.deepEqual(effStats(h, t1), [1, 1], 'no +2/+2 across the gap');
  finishBattle(h);
});

test('CR 603.2 / CT-249: blockers on NEIGHBOURING attacking columns are still adjacent', () => {
  const { h, D, insp, t1, t2 } = threeColumnAttack(56002);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [insp], 1: [t1, t2] } });
  const e = new E(h.state);
  assert.deepEqual(e.adjacentInFormation(insp).map(u => u.id), [t1], 'same row of the next column; the back unit is diagonal');
  assert.deepEqual(effStats(h, t1), [3, 3], 'the neighbour is buffed');
  assert.deepEqual(effStats(h, t2), [1, 1], 'the diagonal is not');
  finishBattle(h);
});

test('CR 602.6a / CT-249: the defending slots name the attacking column, and an unblocked column is not a hole', () => {
  const { h, D, insp, t1 } = threeColumnAttack(56003);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [insp], 2: [t1] } });
  const e = new E(h.state);
  const slots = e.formationSlots(D);
  // behind each blocker, then (CR 607.2) in front of the unblocked attacker
  assert.deepEqual(slots.map(s => s.spot), [
    { kind: 'behind', unit: insp },
    { kind: 'behind', unit: t1 },
    { kind: 'block', column: 1 },
  ]);
  assert.deepEqual(slots.map(s => s.label), [
    'column 1, behind Inspiration',
    'column 3, behind Unit Token',
    'column 2, blocking it (it is unblocked)',
  ]);
  finishBattle(h);
});

test('CR 602.6j / CT-249: a blocking column emptied after blocks is a hole keyed to its attacking column, past a gap', () => {
  const { h, D, insp, t1 } = threeColumnAttack(56004);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [insp], 2: [t1] } });
  const e = new E(h.state);
  e.destroy(h.state.entities[t1]!, 'dies');
  e.settle();
  const holes = e.formationSlots(D).filter(s => s.spot.kind === 'hole');
  assert.deepEqual(holes.map(s => s.spot), [{ kind: 'hole', column: 2 }], 'the hole is the third column, not the second');
  assert.equal(holes[0]!.label, 'column 3 (an empty slot in the line)');
  finishBattle(h);
});

test('CR 603.3b / CT-249: a blocker next to an unblocked column has no adjacent slot in it', () => {
  const { h, D, insp, t1 } = threeColumnAttack(56005);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [insp], 2: [t1] } });
  const e = new E(h.state);
  // behind itself only: the unblocked column is not a slot of the defending
  // grid (a unit enters it only through CR 607.2 blocking, never as a neighbour)
  assert.deepEqual(e.adjacentSlots(insp).map(s => s.label), ['column 1, behind Inspiration']);
  assert.deepEqual(e.adjacentSlots(t1).map(s => s.label), ['column 3, behind Unit Token']);
  finishBattle(h);
});
