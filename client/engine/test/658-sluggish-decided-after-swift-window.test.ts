/**
 * CR 608.3d / CT-378 — whether the Sluggish sub-step is a step of its own
 * (with the before-Sluggish priority window ahead of it) is decided when the
 * window after the Swift sub-step ends, not when the damage step opens.
 *
 * The engine fixed the schedule once, as the step opened (`damageSubs`), so a
 * column given {Sluggish} in the after-Swift window struck in the Sluggish
 * sub-step with no window before it, and the triggers the normal sub-step
 * fired waited until after combat. The designer, rules-questions 2025-04-20:
 *
 *   his step diagram [1363278470938890250]: "Need sluggish to exist after
 *   here---> Combat / Before Sluggish priority window / Sluggish damage";
 *   his final scheme [1363287109401710603]: "Before sluggish priority <-
 *   remaining columns will deal sluggish damange here";
 *   and, to "if no sluggish unit exists ... you will go from normal damage ->
 *   after combat": "correct" / "you would have to add sluggish during the
 *   "after swift" window" [1363288029799911664].
 *
 * Both directions are read at that point. A Sluggish striker that is gone by
 * the end of the after-Swift window leaves no Sluggish step: the designer, on
 * the Sluggish being removed then, "should do regular damage in that case" /
 * "and no sluggish priority window would be opened" [1363281782749003809].
 * A Swift unit dying never unsplits the step: the Swift sub-step has already
 * happened (297, CR 608.3d).
 *
 * Seeds 65800-65899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Attr, EntityId, Seat } from '../src/types.ts';
import { ent, finishBattle, pass, spawn, toDeployment, toNextBattle, withE } from './util.ts';

function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle(); h.state = g.s;
  return u.id;
}
function grant(h: Harness, id: EntityId, attr: Attr): void {
  withE(h, g => { g.addTempAttr(g.entity(id)!, attr); });
}

test('CR 608.3d / CT-378: a column given Sluggish in the after-Swift window gets the before-Sluggish window, and the normal sub-step triggers resolve there before it strikes', () => {
  const h = new Harness(65800);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');             // 2/1 {Swift}
  const rubbish = spawn(h, A, 'A Pile of Rubbish');     // 1/1, "[Augment] When I die, draw a card."
  const late = tok(h, A, 2, 2);                         // normal, until it is given Sluggish
  const wall = tok(h, D, 2, 2);                         // kills the Rubbish in the normal sub-step
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune], [rubbish], [late]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [wall] } });
  pass(h); pass(h);
  const b = () => h.state.battle!;
  assert.deepEqual(b().damageSubs, ['Swift', 'normal'], 'as the step opens, nothing is Sluggish');
  assert.equal(b().step, 'damageWindow');
  assert.equal(b().pendingSub, 'normal', 'this is the window after the Swift sub-step');
  assert.equal(h.state.players[D]!.life, 28, 'the Drifter has struck');

  grant(h, late, 'Sluggish');
  const hand0 = h.state.players[A]!.hand.length;
  pass(h); pass(h);                                     // the after-Swift window closes; normal damage
  assert.ok(!ent(h, rubbish), 'the Rubbish died in the normal sub-step');
  assert.equal(b().step, 'damageWindow', 'a window opens before the Sluggish strike');
  assert.equal(b().pendingSub, 'Sluggish');
  assert.deepEqual(b().damageSubs, ['Swift', 'normal', 'Sluggish'], 'the Sluggish sub-step was scheduled when the after-Swift window ended');
  assert.equal(h.state.players[D]!.life, 28, 'the column that gained Sluggish has not struck yet');
  assert.ok(h.state.stack.some(it => (it.label ?? '').includes('draw a card')),
    'the Rubbish death trigger is on the stack in that window');
  let guard = 20;
  while (b().step === 'damageWindow' && b().pendingSub === 'Sluggish' && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
  assert.equal(h.state.players[A]!.hand.length, hand0 + 1, 'it resolved before the Sluggish strike');
  assert.equal(h.state.players[D]!.life, 26, 'then the column struck in the Sluggish sub-step');
  assert.equal(b().step, 'afterWindow');
  finishBattle(h);
});

test('CR 608.3d / CT-378: a Sluggish striker gone before the after-Swift window ends leaves no before-Sluggish window', () => {
  const h = new Harness(65801);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');             // {Swift}
  const one = tok(h, A, 1, 1);                          // normal
  const slug = spawn(h, A, 'Ambling Mountaintop');      // {Sluggish} 4/5
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune], [one], [slug]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  const b = () => h.state.battle!;
  assert.deepEqual(b().damageSubs, ['Swift', 'normal', 'Sluggish'], 'all three are scheduled as the step opens');
  assert.equal(b().pendingSub, 'normal', 'the after-Swift window');
  withE(h, g => { g.entity(slug)!.damage = 99; g.checkDeaths(); });
  assert.ok(!ent(h, slug), 'the only Sluggish striker is gone');
  pass(h); pass(h);
  assert.deepEqual(b().damageSubs, ['Swift', 'normal'], 'no Sluggish step is left to open a window for');
  assert.equal(b().step, 'afterWindow', '"you will go from normal damage -> after combat"');
  assert.equal(h.state.players[D]!.life, 30 - 2 - 1);
  finishBattle(h);
});

test('CR 608.3d / CT-378: control -- with no Swift sub-step the schedule fixed at the start of the step is not revisited', () => {
  const h = new Harness(65802);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const one = tok(h, A, 1, 1);
  const slug = spawn(h, A, 'Ambling Mountaintop');      // {Sluggish}
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[one], [slug]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  const b = () => h.state.battle!;
  assert.deepEqual(b().damageSubs, ['normal', 'Sluggish']);
  assert.equal(b().step, 'damageWindow');
  assert.equal(b().pendingSub, 'Sluggish', 'the ordinary before-Sluggish window');
  assert.equal(h.state.players[D]!.life, 29);
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 25);
});
