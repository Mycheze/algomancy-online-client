/* Ports of prototype sections 5 (stack: negate & fizzle), 6 (bounded triggers
 * & battle counters) and 7 (until-regroup cleanup). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick, spawn,
  toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

test('the stack: negate & fizzle, spell units, priority order', () => {
  const h = new Harness(5);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  spawn(h, A, 'Rune Channeler');
  const atk = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'fire', 4);
  giveResources(h, D, 'water', 12);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });

  assert.equal(h.state.priority, A, 'priority starts with initiative');
  pass(h);   // A passes
  const li = give(h, D, 'Leaping Lillik');
  h.do({ type: 'playCard', seat: D, handIndex: li });
  pick(h, { unit: atk });   // delete target: the whale
  // A's Rune Channeler must NOT trigger on the opponent's spell ("when YOU play")
  assert.equal(h.state.stack.length, 1, 'only Lillik on the stack');
  assert.equal(h.state.priority, A, 'priority passed to A after D acted');

  pass(h);   // A passes again
  const dv = give(h, D, 'Dreadwave Devourer');
  h.do({ type: 'playCard', seat: D, handIndex: dv });
  pick(h, { stack: h.state.stack[0]!.id });   // negate own Lillik (legal-shaped)
  pass(h); pass(h);   // resolve Dreadwave: negates Lillik, spawns 6/4
  assert.ok(unitsOf(h, D).some(u => u.card === 'Dreadwave Devourer'), 'Dreadwave spawned as a unit');
  assert.equal(h.state.stack[0]!.negated, true, 'Lillik marked negated');
  pass(h); pass(h);   // resolve negated Lillik
  assert.ok(!unitsOf(h, D).some(u => u.card === 'Leaping Lillik'), 'negated spell unit never spawned');
  assert.ok(h.state.players[D]!.bin.includes('Leaping Lillik'), 'negated Lillik in bin');
  assert.ok(ent(h, atk), 'whale survived (delete was negated)');
});

test('bounded triggers & battle-scoped ordinal counters', () => {
  const h = new Harness(6);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const rc = spawn(h, A, 'Rune Channeler');
  const mr = spawn(h, A, 'Mischievous Reclaimer');
  const f1 = spawn(h, A, 'Ignis Sprite');       // its spawn trigger makes a Fireball
  const f2 = spawn(h, A, 'Curio Drifter');
  giveResources(h, A, 'fire', 8);
  toNextBattle(h, A);
  // everyone attacks: with real regions, only units IN the battle can be
  // targeted or listen for its events (the prototype had one battlefield)
  h.do({ type: 'declareAttack', seat: A, columns: [[rc], [mr], [f1], [f2]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });

  // A plays Flame of History (nontoken spell) → Rune Channeler bounded trigger
  const fh = give(h, A, 'Flame of History');
  h.do({ type: 'playCard', seat: A, handIndex: fh });
  pick(h, { player: D });                        // spell target: face
  assert.ok(h.state.decision, 'Rune Channeler trigger wants a target');
  assert.equal(h.state.decision!.seat, A);
  pick(h, { unit: f2 });                         // trigger target: own 2/2
  assert.equal(h.state.stack.length, 2, 'trigger + spell on stack');
  pass(h); pass(h);                              // resolve trigger: 2 dmg kills the 2/2
  assert.ok(!ent(h, f2), 'Rune Channeler killed the 2/2');
  const region = h.state.battle!.region;
  assert.equal(h.state.battleCounters[region]![`allyDeaths:${A}`], 1, 'first ally death counted');
  assert.equal(h.state.stack.length, 1, 'Reclaimer silent on first death');

  pass(h); pass(h);                              // resolve Flame of History
  assert.equal(h.state.players[D]!.life, 29, 'spell resolved at face');

  // second spell this turn: Rune Channeler is bounded — must NOT retrigger
  const arc = give(h, A, 'Luminous Arc');
  h.do({ type: 'playCard', seat: A, handIndex: arc });
  pick(h, { unit: f1 });                         // kill own Ignis Sprite: second ally death
  assert.equal(h.state.decision, null, 'no second Rune Channeler trigger (bounded)');
  pass(h); pass(h);                              // resolve arc → Ignis dies, two triggers fire
  assert.ok(!ent(h, f1), 'Ignis died');
  assert.equal(h.state.battleCounters[region]![`allyDeaths:${A}`], 2, 'second ally death counted');
  // two simultaneous triggers for A → A orders them (R2): Reclaimer resolves first
  const dec = h.decision;   // fresh path: TS narrowed h.state.decision to null above
  assert.equal(dec?.kind, 'orderTriggers', 'owner orders simultaneous triggers');
  const opts = dec!.options.map(o => o.label);
  const reclaimerFirst = [opts.findIndex(l => l.includes('Reclaimer')), opts.findIndex(l => l.includes('Ignis'))];
  h.do({ type: 'decide', seat: A, choice: reclaimerFirst });
  const handBefore = h.state.players[A]!.hand.length;
  pass(h); pass(h);                              // resolve Reclaimer trigger → draw
  assert.equal(h.state.players[A]!.hand.length, handBefore + 1, 'Reclaimer drew on second death');
  pass(h); pass(h);                              // resolve Ignis death trigger → Fireball
  // one Fireball already existed from Ignis's spawn trigger during deployment,
  // but it stayed home — only the death Fireball is in the battle region... both
  // were created in A's home region and the battle is in D's region, so count all:
  assert.equal(tokensOf(h, A).length, 2, 'Ignis death trigger made a second Fireball');
});

test('until-regroup temp mods & cleanup', () => {
  const h = new Harness(7);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const big = spawn(h, A, 'Rune Channeler');   // 4/3
  giveResources(h, D, 'water', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[big]] });
  pass(h);
  const j = give(h, D, 'Jelly');
  h.do({ type: 'playCard', seat: D, handIndex: j });
  pick(h, { unit: big });
  pass(h); pass(h);
  assert.deepEqual(effStats(h, big), [2, 1], 'Jelly shrank the attacker');
  assert.ok(unitsOf(h, D).some(u => u.card === 'Jelly'), 'Jelly spawned a body');
  ent(h, big)!.damage = 0;   // isolate the cleanup check
  finishBattle(h);
  assert.equal(h.state.phase, 'deploy');
  assert.deepEqual(effStats(h, big), [4, 3], 'regroup cleared temp mods');
  assert.equal(tokensOf(h, A).length + tokensOf(h, D).length, 0, 'spell tokens erased at regroup');
});

test('Fireball goes to the stack in battle, Burst casts them all at once', () => {
  const h = new Harness(51);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Rune Channeler');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // give D two fireballs in the battle region (their home)
  const region = h.state.battle!.region;
  const e = new E(h.state);
  const t1 = e.createSpellToken(D, 'Fireball', 1, region);
  const t2 = e.createSpellToken(D, 'Fireball', 1, region);
  pass(h);   // A passes, D has priority
  h.do({ type: 'castSpellToken', seat: D, entityId: t1.id });
  pick(h, { unit: atk });        // first fireball target
  pick(h, { player: A });        // second fireball target (Burst: both cast)
  assert.equal(h.state.stack.length, 2, 'Burst: both Fireballs went to the stack');
  assert.ok(!h.state.entities[t1.id] && !h.state.entities[t2.id], 'tokens left play at cast');
  pass(h); pass(h);   // resolve second (face)
  assert.equal(h.state.players[A]!.life, 29, 'Fireball 1 at face');
  pass(h); pass(h);   // resolve first (unit)
  assert.equal(ent(h, atk)!.damage, 1, 'Fireball 1 into the unit');
});
