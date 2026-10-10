/**
 * Comprehensive rules, unit U13 (after combat, counterattacks, later rounds) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U13
 * (data/comprehensive-rules/build/probes/U13/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U13.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
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
import type { EntityId, Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, offered, pass, spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  return u.id;
}

test('cr:combat.counterattack.sent.not-targetable — a sent counterattacker is not offered as a target; a unit that stayed is', () => {
  const h = new Harness(91301);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 9);
  const stay = tok(h, D, 1, 9);
  const sent = tok(h, D, 1, 9);
  giveResources(h, A, 'fire', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [sent] });
  assert.equal(h.state.priority, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Arc Lightning') });
  const menu = offered(h);
  assert.ok(menu.includes(JSON.stringify({ unit: stay })), `the unit that stayed is a target [${menu}]`);
  assert.ok(!menu.includes(JSON.stringify({ unit: sent })), `the sent unit is not [${menu}]`);
});

test('cr:combat.counterattack.sent.not-targetable — a sent counterattacker is never offered for a sacrifice', () => {
  const h = new Harness(91302);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a1 = tok(h, A, 1, 9);
  const a2 = tok(h, A, 1, 9);
  const s1 = tok(h, D, 1, 9);
  const s2 = tok(h, D, 1, 9);
  const s3 = tok(h, D, 1, 9);
  const sent = tok(h, D, 1, 9);
  giveResources(h, A, 'fire', 1);
  giveResources(h, A, 'metal', 1);
  giveResources(h, A, 'wood', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1], [a2]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [sent] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Maw of Damnation') });
  pass(h); pass(h);
  let sawD = 0, guard = 20;
  while (h.state.decision && guard-- > 0) {
    const dec = h.state.decision;
    if (dec.seat === D) {
      sawD++;
      assert.ok(!offered(h).includes(JSON.stringify(sent)) && !offered(h).includes(JSON.stringify({ unit: sent })),
        `the sent unit is not a sacrifice option [${offered(h)}]`);
    }
    h.do({ type: 'decide', seat: dec.seat, choice: 0 });
  }
  assert.ok(sawD > 0, 'the defender was asked to sacrifice');
  assert.ok(ent(h, sent), 'the sent unit survived the sacrifice');
  assert.ok([s1, s2, s3].filter(id => !ent(h, id)).length >= 2, 'the defender sacrificed from the units that stayed');
});

test('cr:combat.counterattack.sent.no-statics — a sent Prickly Protector does not give itself its own bonus while away', () => {
  const h = new Harness(91303);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 9);
  const prick = spawn(h, D, 'Prickly Protector');
  tok(h, D, 1, 9);   // stays home: an ally in the region the Protector leaves
  assert.deepEqual(effStats(h, prick), [1, 2], 'at home with one other ally: 1/2');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [prick] });
  assert.equal(ent(h, prick)!.absent, true);
  assert.deepEqual(effStats(h, prick), [0, 1], 'away: its own static applies to nothing, itself included');
});

test('cr:combat.counterattack.round-two.return — sent units and a sent spell token reappear in the region they attack when round 2 begins', () => {
  const h = new Harness(91304);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 9);
  const c1 = tok(h, D, 1, 9);
  const c2 = tok(h, D, 1, 9);
  const g = new E(h.state);
  const st = g.createSpellToken(D, 'Fireball', 2, g.homeRegion(D)).id;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [c1, c2], spellTokens: [st] });
  for (const id of [c1, c2, st]) assert.equal(ent(h, id)!.absent, true);
  let guard = 20;
  while (h.state.battleRound === 1 && guard-- > 0) pass(h);
  assert.equal(h.state.battle!.round, 2);
  const homeA = new E(h.state).homeRegion(A);
  assert.equal(h.state.battle!.region, homeA);
  for (const id of [c1, c2, st]) {
    assert.equal(ent(h, id)!.absent, false, 'exists again');
    assert.equal(ent(h, id)!.region, homeA, 'in the region it is attacking');
  }
  assert.deepEqual(h.state.battle!.attackerPool, [c1, c2, st]);
  assert.equal(h.state.battle!.step, 'declare', 'not yet in formation: the declaration is still to come');
});

test('cr:combat.after.window — initiative first; a spell cast in the window resolves after both pass, priority returns to the initiative player; two passes on an empty stack end the step', () => {
  const h = new Harness(91305);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 9);
  giveResources(h, D, 'fire', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(h.state.battle!.step, 'afterWindow');
  assert.equal(h.state.priority, A, 'initiative first');
  pass(h);
  assert.equal(h.state.priority, D, 'then the non-initiative player');
  const lifeA = h.state.players[A]!.life;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Arc Lightning') });
  const dec = h.state.decision!;
  const pi = dec.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify({ player: A }));
  h.do({ type: 'decide', seat: D, choice: pi });
  assert.equal(h.state.stack.length, 1);
  pass(h); pass(h);
  assert.equal(h.state.stack.length, 0, 'resolved');
  assert.equal(h.state.players[A]!.life, lifeA - 6);
  assert.equal(h.state.battle!.step, 'afterWindow', 'still the after-combat step');
  assert.equal(h.state.priority, A, 'initiative receives priority again');
  pass(h); pass(h);
  assert.notEqual(h.state.phase, 'battle', 'two passes on an empty stack end the step (and, with no counterattack, the battle)');
});

test('cr:combat.counterattack.round-two.other-region-absent — the initiative attacker left in the round-1 region cannot block in round 2 and is not a target there', () => {
  const h = new Harness(91306);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 9);
  const homeA = tok(h, A, 1, 9);
  const c = tok(h, D, 1, 9);
  giveResources(h, D, 'fire', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [c] });
  let guard = 20;
  while (h.state.battleRound === 1 && guard-- > 0) pass(h);
  assert.equal(h.state.battle!.round, 2);
  h.do({ type: 'declareAttack', seat: D, columns: [[c]] });
  pass(h);   // A passes; D has priority
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Arc Lightning') });
  const menu = offered(h);
  assert.ok(menu.includes(JSON.stringify({ unit: homeA })), `the initiative unit in the round-2 region is a target [${menu}]`);
  assert.ok(!menu.includes(JSON.stringify({ unit: atk })), `the initiative round-1 attacker, in the other region, is not [${menu}]`);
  h.do({ type: 'decide', seat: D, choice: menu.indexOf(JSON.stringify({ unit: homeA })) });
  pass(h); pass(h);
  pass(h); pass(h);
  assert.equal(h.state.battle!.step, 'blocks');
  assert.throws(() => h.do({ type: 'declareBlocks', seat: A, blocks: { 0: [atk] } }), /another region/);
});

test('cr:combat.counterattack.round-two.may-decline — declining with a sent unit opens no window and ends the battle phase', () => {
  const h = new Harness(91307);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 9);
  const c = tok(h, D, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [c] });
  let guard = 20;
  while (h.state.battleRound === 1 && guard-- > 0) pass(h);
  assert.deepEqual(h.state.battle!.attackerPool, [c]);
  const evs = h.do({ type: 'declareAttack', seat: D, columns: [] });
  assert.ok(evs.some(e => e.type === 'regroup'), 'regroup inside the decline itself');
  assert.notEqual(h.state.phase, 'battle');
  finishBattle(h);
});

test('cr:combat.after.triggers.presence — an after-combat unit in the battle region that is not in formation still triggers; one in another region does not', () => {
  const h = new Harness(91308);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 9);
  const overseer = spawn(h, D, 'Construct Overseer');   // stands in the battle region and does not block
  spawn(h, A, 'Construct Overseer');                    // in the initiative home region: no battle there
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  assert.equal(ent(h, overseer)!.region, h.state.battle!.region, 'the Overseer is present in the battle region');
  const b = h.state.battle!;
  assert.ok(![...b.columns.flat(), ...Object.values(b.blocks).flat()].includes(overseer), 'and is in no formation');
  finishBattle(h);
  assert.ok(unitsOf(h, D).some(u => u.card === 'Robot'), 'the Overseer in the battle region made its Robot');
  assert.ok(!unitsOf(h, A).some(u => u.card === 'Robot'), 'the Overseer in the region with no battle made nothing');
});

function afterCombatBatch(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const lith = spawn(h, A, 'Lithoghul');   // initiative: whenever I am dealt damage
  const geo = spawn(h, D, 'Geode');        // non-initiative: when I die (dies to 4 combat damage)
  spawn(h, D, 'Wisp');                     // non-initiative: after combat, sacrifice me
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lith]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [geo] }, send: [], spellTokens: [] });
  pass(h); pass(h);
  let guard = 30;
  while (h.state.decision?.kind === 'assignDamage' && guard-- > 0) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  return { h, A, D };
}

test('cr:combat.after.triggers.batch — damage-step and after-combat triggers go on the stack together in the after combat step, initiative first, and each player orders theirs either way', () => {
  for (const order of [[0, 1], [1, 0]]) {
    const { h, A, D } = afterCombatBatch(91309);
    assert.equal(h.state.stack.length, 0, 'nothing was put on the stack during the damage step');
    assert.equal(h.state.battle!.step, 'afterWindow', 'the batch is handled in the after combat step');
    const dec = h.state.decision!;
    assert.equal(dec.kind, 'orderTriggers');
    assert.equal(dec.seat, D);
    assert.ok(dec.pickOrder, 'one ordering decision');
    const labels = dec.options.map(o => o.label);
    assert.equal(labels.length, 2);
    assert.ok(labels.some(l => /Geode/.test(l)), 'the damage-caused death trigger is in the batch');
    assert.ok(labels.some(l => /Wisp/.test(l) && /after combat/i.test(l)), 'and so is the after-combat trigger');
    h.do({ type: 'decide', seat: D, choice: order });
    let guard = 10;
    while (h.state.decision && guard-- > 0) {
      const d = h.state.decision;
      h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : 0 });
    }
    const st = h.state.stack;
    assert.equal(st.length, 3, 'all three triggers are on the stack');
    assert.equal(st[0]!.controller, A, 'the initiative player put theirs on first: bottom of the stack');
    assert.ok(/Lithoghul/.test(st[0]!.label));
    assert.equal(st[1]!.controller, D);
    assert.equal(st[2]!.controller, D, 'the non-initiative player put theirs on top');
    assert.equal(st[2]!.label, labels[order[0]!], `the non-initiative player chose which of their two kinds resolves first (${order})`);
    assert.equal(st[1]!.label, labels[order[1]!]);
    pass(h); pass(h);
    assert.equal(h.state.stack.length, 2, 'the non-initiative top item resolved first');
    assert.equal(h.state.stack[0]!.controller, A, 'the initiative item is still waiting at the bottom');
  }
});

test('cr:combat.counterattack.tokens — spell tokens go with a counterattacking unit; tokens alone, or from another region, are refused', () => {
  const h = new Harness(91310);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 9);
  const ctr = tok(h, D, 1, 9);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const g = new E(h.state);
  const region = h.state.battle!.region;
  const here = g.createSpellToken(D, 'Poison', 1, region).id;          // in the region the counterattack leaves from
  const away = g.createSpellToken(D, 'Poison', 1, g.homeRegion(A)).id;  // the same player's token, in another region
  pass(h); pass(h);
  assert.equal(h.state.battle!.step, 'blocks');
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [], spellTokens: [here] }),
    /spell tokens travel only with units/, 'a counterattack of spell tokens alone is not allowed');
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [ctr], spellTokens: [away] }),
    /not your spell token/, 'a token outside the region the counterattack leaves from cannot go');
  assert.equal(h.state.battle!.step, 'blocks', 'both refusals left the step where it was');
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [ctr], spellTokens: [here] });
  assert.ok(ent(h, here)!.absent, 'the token left with the counterattacking unit');
  assert.deepEqual(h.state.battle!.sentAttackers, [ctr, here]);
  let guard = 20;
  while (h.state.battleRound === 1 && guard-- > 0) pass(h);
  assert.equal(h.state.battle!.round, 2);
  assert.ok(h.state.battle!.attackerPool!.includes(here), 'it is in the round-2 attacking pool');
  h.do({ type: 'declareAttack', seat: D, columns: [[ctr]], spellTokens: [here] });
  assert.equal(ent(h, here)!.region, h.state.battle!.region, 'and goes into the counterattacked region with the unit');
  assert.ok(tokensOf(h, D).some(t => t.id === away) && ent(h, away)!.absent !== true, 'the other token never left');
});
