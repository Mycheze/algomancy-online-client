/**
 * CR 109.9k, 710.7 / CT-342 — ANCIENT ONE HAS ONE BORROWED USE PER SOURCE.
 *
 * The owner, 2026-10-22: an Ancient One with two adjacent neighbours that
 * share a face (two Jollyglops) gets TWO uses — "each neighbour's copy of the
 * ability is separate, the same as two mods each having their own use".
 *
 * The triggered half keys each borrowed box by its source (a neighbour, a
 * neighbour's mod, a neighbouring copy's copied box). The activated half came
 * off `facesWith`, which names a face once however many sources carry it, so
 * two Debt Blep neighbours — or one neighbour wearing two Debt Bleps — gave
 * one activation. Each source is now its own activation (E.activatedBoxes):
 * the first keeps the old address `{ face, text: 'augment' }`, so an old log
 * keeps meaning it, and the k-th adds `copy: k`.
 *
 * Seeds 58500-58599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { apply, legalActions } from '../src/apply.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, finishBattle, pass, pick, spawn, toDeployment, toNextBattle, unitsOf, withE } from './util.ts';

const vias = (h: Harness, seat: Seat, id: EntityId) => h.legal(seat)
  .filter(a => a.type === 'activateAbility' && a.entityId === id)
  .map(a => (a as { via?: unknown }).via);

/** resolve what is on the stack, then hand `seat` the priority again */
function settleTo(h: Harness, seat: Seat): void {
  for (let guard = 12; (h.state.stack.length || h.state.priority !== seat) && guard-- > 0;) pass(h);
  assert.equal(h.state.priority, seat, 'priority came back');
}

function agree(h: Harness, seat: Seat): void {
  // the fuzzer's "legalActions lied" invariant, aimed at this path by hand
  for (const a of legalActions(h.state, seat)) {
    assert.doesNotThrow(() => apply(h.state, a), `legalActions offered ${JSON.stringify(a)} and apply refused it`);
  }
}

test('CR 710.7 / CT-342: Ancient One between two Jollyglops makes two 1/1s per damage from each (owner 2026-10-22)', () => {
  const h = new Harness(58500);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const j1 = spawn(h, A, 'Jollyglop');
  const ancient = spawn(h, A, 'Ancient One');
  const j2 = spawn(h, A, 'Jollyglop');
  withE(h, e => { e.s.entities[ancient]!.counters = 3; });   // a 4/4, so it lives through the Fireball
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[j1], [ancient], [j2]] });
  let fire = -1;
  withE(h, e => { fire = e.createSpellToken(D, 'Fireball', 2, e.s.battle!.region).id; });
  for (let guard = 8; h.state.priority !== D && guard-- > 0;) pass(h);
  h.do({ type: 'castSpellToken', seat: D, entityId: fire });
  pick(h, { unit: ancient });
  for (let guard = 60; (h.state.stack.length || h.state.decision) && guard-- > 0;) {
    const d = h.state.decision;
    if (d?.pickOrder) h.do({ type: 'decide', seat: d.seat, choice: d.options.map((_, i) => i) });
    else if (d) pick(h, d.options[0]!.value);
    else { pass(h); pass(h); }
  }
  assert.equal(ent(h, ancient)!.damage, 2, 'the Fireball hit the Ancient One');
  assert.equal(unitsOf(h, A).filter(u => u.token).length, 4, 'one borrowed use per neighbour: two 1/1s each');
  finishBattle(h);
});

test('CR 710.7 / CT-342: Ancient One between two Debt Bleps has two activations, the first at the old address', () => {
  const h = new Harness(58501);
  toDeployment(h);
  const A = h.state.initiative;
  const b1 = spawn(h, A, 'Debt Blep');
  const ancient = spawn(h, A, 'Ancient One');
  const b2 = spawn(h, A, 'Debt Blep');
  spawn(h, (1 - A) as Seat, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[b1], [ancient], [b2]] });
  for (let guard = 8; h.state.priority !== A && guard-- > 0;) pass(h);
  assert.deepEqual(vias(h, A, ancient), [
    { face: 'Debt Blep', text: 'augment' },
    { face: 'Debt Blep', text: 'augment', copy: 1 },
  ], 'one activation per neighbour');
  agree(h, A);
  h.do({ type: 'activateAbility', seat: A, entityId: ancient, abilityIndex: 0, via: { face: 'Debt Blep', text: 'augment' } });
  settleTo(h, A);
  assert.deepEqual(vias(h, A, ancient), [{ face: 'Debt Blep', text: 'augment', copy: 1 }],
    'the old address spent the first; the second is left');
  assert.equal(ent(h, ancient)!.budgets['augment:Debt Blep#0'], 1, 'the first keeps the key it always had');
  finishBattle(h);
});

test('CR 710.7 / CT-342: Ancient One next to an ally wearing two Debt Bleps has two activations', () => {
  const h = new Harness(58502);
  toDeployment(h);
  const A = h.state.initiative;
  const whale = spawn(h, A, 'Good Whale');
  withE(h, e => {
    e.attachMod(e.s.entities[whale]!, 'Debt Blep', A, 'augment');
    e.attachMod(e.s.entities[whale]!, 'Debt Blep', A, 'augment');
  });
  const ancient = spawn(h, A, 'Ancient One');
  spawn(h, (1 - A) as Seat, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale, ancient]] });
  for (let guard = 8; h.state.priority !== A && guard-- > 0;) pass(h);
  assert.deepEqual(vias(h, A, ancient), [
    { face: 'Debt Blep', text: 'augment' },
    { face: 'Debt Blep', text: 'augment', copy: 1 },
  ], 'one activation per augment the neighbour wears');
  agree(h, A);
  h.do({ type: 'activateAbility', seat: A, entityId: ancient, abilityIndex: 0, via: { face: 'Debt Blep', text: 'augment', copy: 1 } });
  settleTo(h, A);
  h.do({ type: 'activateAbility', seat: A, entityId: ancient, abilityIndex: 0, via: { face: 'Debt Blep', text: 'augment' } });
  settleTo(h, A);
  assert.deepEqual(vias(h, A, ancient), [], 'both are spent');
  assert.throws(() => h.do({ type: 'activateAbility', seat: A, entityId: ancient, abilityIndex: 0,
    via: { face: 'Debt Blep', text: 'augment', copy: 2 } }), /does not have that ability/, 'and there is no third');
  finishBattle(h);
});
