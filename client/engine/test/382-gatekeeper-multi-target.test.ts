/**
 * R314 — report #199 (UTVU, 2026-10-06): "Twin Flame (and things with two
 * targets) should be allowed to target Gatekeeper of Souls AND other things.
 * As long as Gatekeeper of Souls is one of the targets, it's fine."
 *
 * Gatekeeper's "I must be targeted if able" was applied to every target SLOT,
 * so the second slot of a two-target spell was narrowed to the Gatekeeper
 * again, the duplicate filter emptied it, and the spell stopped at one target.
 * The compulsion is on the effect's targets as a whole: once a Gatekeeper is
 * among them it compels nothing more.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';
import type { Seat } from '../src/types.ts';

/** the units offered — "up to two" also offers "No more targets", which is not one */
const values = (h: Harness): unknown[] => h.state.decision!.options.map(o => o.value)
  .filter(v => !(v as { doneTargets?: true }).doneTargets);

test('R314: a two-target spell aims at the Gatekeeper first and then at anything else', () => {
  const h = new Harness(4380);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const gk = spawn(h, D, 'Gatekeeper of Souls');              // 0/7
  const other = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'fire', 3);                             // Twin Flame rr/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Twin Flame') });
  assert.deepEqual(values(h), [{ unit: gk }],
    'the first slot is still compelled: the Gatekeeper must be one of the targets');
  pick(h, { unit: gk });
  const second = values(h);
  assert.ok(second.some(v => JSON.stringify(v) === JSON.stringify({ unit: other })),
    'with the Gatekeeper targeted, the second slot may aim at another unit');
  assert.ok(second.some(v => JSON.stringify(v) === JSON.stringify({ unit: atk })),
    'any other legal unit, ally included');
  pick(h, { unit: other });
  pass(h); pass(h);                                           // Twin Flame resolves
  assert.equal(ent(h, gk)!.damage, 2, 'the Gatekeeper took 2');
  assert.equal(ent(h, other), undefined, 'and the 1/1 beside it died to the second 2');
  finishBattle(h);
});

test('R314: two Gatekeepers — each one must be targeted if able, so both slots go to them', () => {
  const h = new Harness(4381);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const gk1 = spawn(h, D, 'Gatekeeper of Souls');
  const gk2 = spawn(h, D, 'Gatekeeper of Souls');
  spawn(h, D, 'Unit Token');
  giveResources(h, A, 'fire', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Twin Flame') });
  assert.deepEqual(values(h), [{ unit: gk1 }, { unit: gk2 }], 'either Gatekeeper first');
  pick(h, { unit: gk2 });
  assert.deepEqual(values(h), [{ unit: gk1 }],
    'the other Gatekeeper is still owed a target, so it is the only unit offered');
  pick(h, { unit: gk1 });
  pass(h); pass(h);
  assert.equal(ent(h, gk1)!.damage, 2);
  assert.equal(ent(h, gk2)!.damage, 2);
  finishBattle(h);
});
