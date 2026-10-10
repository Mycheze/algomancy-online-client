/**
 * Comprehensive rules, unit U15 (activated, triggered and static abilities,
 * replacement and prevention) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U15
 * (data/comprehensive-rules/build/probes/U15/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U15.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * The two tests titled "engine differs" are the exception: their rules state
 * the ruling and carry an engineDiffers mark, and these tests pin the
 * divergence the mark describes. They are deliberately NOT listed in those
 * rules' sources. When one goes red the engine has been brought in line with
 * the ruling: drop the engineDiffers mark and the test, and bind a real example.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import type { EntityId, Seat } from '../src/types.ts';
import {
  ent, finishBattle, give, giveResources, pass, spawn, toDeployment, toNextBattle,
} from './util.ts';

function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  return u.id;
}
const openMana = (h: Harness, seat: number) => h.state.players[seat]!.resources.filter(r => r.state === 'open').length;

test('cr:effects.activated.procedure.gates — Instrument of Reassignment with only a token beside it is not offered, cannot be activated, and spends no mana', () => {
  const h = new Harness(91504);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const inst = spawn(h, D, 'Instrument of Reassignment');
  tok(h, D, 1, 1);                                     // a token: never a legal victim
  giveResources(h, D, 'metal', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  for (let g = 4; h.state.priority !== D && g-- > 0;) pass(h);
  assert.equal(h.state.priority, D, 'the defender holds priority');
  const open0 = openMana(h, D);
  assert.equal(open0, 3, 'three open mana before the attempt');
  const offers = legalActions(h.state, D).filter(a => a.type === 'activateAbility' && (a as { entityId: number }).entityId === inst);
  assert.equal(offers.length, 0, 'not offered');
  assert.throws(() => h.do({ type: 'activateAbility', seat: D, entityId: inst, abilityIndex: 0, via: 'augment' } as never));
  assert.equal(openMana(h, D), open0, 'no mana spent');
});

test('cr:effects.triggered.if-you-do — Eminence of the Barrens under an enemy Crevice Lurker is taxed once per trigger, and its pay-to-fight is asked inside that one trigger', () => {
  const h = new Harness(91503);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const emi = spawn(h, A, 'Eminence of the Barrens');
  spawn(h, D, 'Crevice Lurker');
  const victim = tok(h, D, 1, 1);
  giveResources(h, A, 'earth', 4);
  giveResources(h, D, 'fire', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[emi]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Flame of History') });
  let guard = 10;
  while (h.state.decision && guard-- > 0) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  const m0 = openMana(h, A);
  pass(h); pass(h);                       // Flame resolves; the Eminence trigger fires
  const asked: string[] = [];
  guard = 20;
  while (guard-- > 0) {
    const d = h.state.decision;
    if (d) {
      asked.push(`${d.kind}: ${d.prompt}`);
      // pay any tax / pay prompt (value true), else the first option, preferring the victim
      const idx = d.options.findIndex(o => o.value === true || (typeof o.value === 'object' && o.value && (o.value as { unit?: number }).unit === victim));
      h.do({ type: 'decide', seat: d.seat, choice: idx >= 0 ? idx : 0 });
      continue;
    }
    if (h.state.stack.length) { pass(h); continue; }
    break;
  }
  // The fight damages the Eminence again: a NEW damage event and a second trigger.
  // Judge the FIRST trigger alone: everything asked up to its pay-to-fight answer.
  const firstPay = asked.findIndex(a => /pay \[one\] to fight/.test(a));
  assert.ok(firstPay >= 0, 'the pay-to-fight question was asked');
  const firstTrigger = asked.slice(0, firstPay + 1);
  assert.equal(firstTrigger.filter(a => /taxes the trigger/.test(a)).length, 1, 'one tax question for the one trigger, and none for its if-you-do clause');
  assert.equal(asked.filter(a => /taxes the trigger/.test(a)).length, 2, 'two damage events (spell, then fight) = two triggers = two taxes');
  assert.equal(m0 - openMana(h, A), 4, 'per trigger: tax [1] + the if-you-do [one]; two triggers = 4');
  finishBattle(h);
});

test('cr:effects.static.permission — engine differs: The Bonesculptor bin permission is offered as an activateAbility action, and activating it asks a payOrDecline choice', () => {
  const h = new Harness(91502);
  toDeployment(h);
  const p = h.state.deployPlayer! as Seat;
  const bs = spawn(h, p, 'The Bonesculptor');
  h.state.players[p]!.bin.push('Unit Token');
  giveResources(h, p, 'earth', 3);
  const acts = legalActions(h.state, p).filter(a => a.type === 'activateAbility' && (a as { entityId: number }).entityId === bs);
  assert.equal(acts.length, 1, 'the permission is offered as an activateAbility action');
  h.do(acts[0]! as never);
  assert.equal(h.state.decision?.kind, 'payOrDecline', 'its choice is asked while the activated item resolves');
});

test('cr:effects.replacement.once.one-applies — engine differs: two Oorblaks both redirect one 10-point Piercing hit, so the defender loses 2 and both Oorblaks die', () => {
  const h = new Harness(91501);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 10, 10);
  const o1 = spawn(h, D, 'Oorblak');
  const o2 = spawn(h, D, 'Oorblak');
  toNextBattle(h, A);
  { const g = new E(h.state); g.addTempAttr(g.entity(atk)!, 'Piercing'); }
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  finishBattle(h);
  // the ruling reading: 30 - 6 = 24 and one Oorblak dies; the engine chains the second redirect
  assert.equal(h.state.players[D]!.life, 28, 'engine: the second Oorblak absorbs 4 of the leftover 6');
  assert.ok(!ent(h, o1) && !ent(h, o2), 'engine: both Oorblaks die');
});

test('cr:effects.triggered.when-stacked — a triggered ability is put on the stack, and when depends on when it triggered: at once outside the damage step, after combat inside it', () => {
  const settleAll = (h: Harness): void => {
    let guard = 40;
    while (h.state.decision && guard-- > 0) {
      const d = h.state.decision;
      h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : 0 });
    }
    assert.ok(guard > 0, 'decisions settled');
  };

  // (1) triggered in battle, outside the combat damage step: on the stack as soon as the cause resolved
  {
    const h = new Harness(91505);
    toDeployment(h);
    const A = h.state.initiative as Seat, D = (1 - A) as Seat;
    const emi = spawn(h, A, 'Eminence of the Barrens');
    spawn(h, D, 'Unit Token');
    giveResources(h, A, 'earth', 3);
    giveResources(h, D, 'fire', 3);
    toNextBattle(h, A);
    h.do({ type: 'declareAttack', seat: A, columns: [[emi]] });
    pass(h);
    h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Flame of History') });
    settleAll(h);
    pass(h); pass(h);                    // Flame resolves; the Eminence trigger fires
    settleAll(h);
    const item = h.state.stack.find(it => /Eminence of the Barrens/.test(it.label));
    assert.ok(item, 'the trigger is on the stack straight after the spell that caused it resolved');
    assert.equal(item!.kind, 'triggered', 'as a triggered stack item');
    assert.ok(h.state.battle && !h.state.battle.damageStep, 'still in battle, outside the damage step');
  }

  // (2) triggered inside the combat damage step: it waits, and reaches the stack in the after combat step
  {
    const h = new Harness(91506);
    toDeployment(h);
    const A = h.state.initiative as Seat, D = (1 - A) as Seat;
    const lith = spawn(h, A, 'Lithoghul');
    const geo = spawn(h, D, 'Geode');
    toNextBattle(h, A);
    h.do({ type: 'declareAttack', seat: A, columns: [[lith]] });
    pass(h); pass(h);
    h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [geo] }, send: [], spellTokens: [] });
    const mark = h.events.length;
    pass(h); pass(h);                    // out of the block window: combat damage
    let guard = 30;
    while (h.state.decision?.kind === 'assignDamage' && guard-- > 0) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    const evs = h.events.slice(mark);
    const cd = evs.findIndex(e => e.type === 'combatDamage');
    const ac = evs.findIndex(e => e.type === 'afterCombat');
    assert.ok(cd >= 0 && ac > cd, 'the damage step and the after combat step both happened');
    const win = evs.slice(cd, ac);
    assert.ok(win.some(e => e.type === 'triggered' && /Lithoghul/.test(e.msg)), 'it triggered inside the damage step');
    assert.ok(!win.some(e => e.type === 'stackPushed'), 'but nothing was put on the stack during the damage step');
    settleAll(h);
    const after = h.events.slice(mark).slice(ac);
    assert.ok(after.some(e => e.type === 'stackPushed' && /Lithoghul/.test(e.msg)), 'it is put on the stack in the after combat step');
    assert.ok(h.state.stack.some(it => /Lithoghul/.test(it.label)), 'where it is a real stack item');
  }
});
