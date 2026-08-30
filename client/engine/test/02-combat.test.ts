/* Ports of prototype sections 4 (combat math) and 9 (win condition), plus
 * region movement and the counterattack-send rule that the prototype lacked. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { IllegalAction } from '../src/apply.ts';
import { ent, giveResources, pass, spawn, toDeployment, toNextBattle } from './util.ts';

test('combat math: columns, flying, piercing overflow, deaths', () => {
  const h = new Harness(4);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const whale = spawn(h, A, 'Good Whale');          // 7/5 Piercing
  const sky = spawn(h, A, 'Ephemeral Skywalker');   // 3/1 Flying
  const b1 = spawn(h, D, 'Curio Drifter');          // 2/2
  const b2 = spawn(h, D, 'Rune Channeler');         // 4/3
  toNextBattle(h, A);
  assert.equal(h.state.battle!.attacker, A, 'battle round 1: initiative attacks');

  h.do({ type: 'declareAttack', seat: A, columns: [[whale], [sky]] });
  assert.equal(ent(h, whale)!.region, h.state.battle!.region, 'attackers moved into the defending region');
  assert.ok(h.state.regions[h.state.battle!.region]!.presentSeats.includes(A), 'attacking player entered too');
  pass(h); pass(h);   // attack window

  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [b1] } }), IllegalAction,
    'flying block restriction enforced');
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b1, b2] } });
  pass(h); pass(h);   // block window → damage

  // Whale 7: 2 lethal to b1 (front), 3 to b2 (back), 2 excess → Piercing → player
  assert.ok(!ent(h, b1), 'front blocker died');
  assert.ok(!ent(h, b2), 'back blocker died');
  assert.equal(h.state.players[D]!.life, 30 - 2 - 3, '2 pierce + 3 unblocked flyer');
  // blockers dealt 2+4=6 back into the whale column (5 toughness) → whale died
  assert.ok(!ent(h, whale), 'whale died to combined blocker power');
  assert.ok(ent(h, sky), 'skywalker survived unblocked');
});

test('blocked column stays blocked; piercing still carries through dead blockers', () => {
  const h = new Harness(41);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const whale = spawn(h, A, 'Good Whale');          // 7/5 Piercing
  const chump = spawn(h, D, 'Curio Drifter');       // 2/2
  giveResources(h, D, 'fire', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [chump] } });
  // D kills their own blocker in the block window with Luminous Arc
  pass(h);   // A passes
  h.state.players[D]!.hand = ['Luminous Arc'];
  h.do({ type: 'playCard', seat: D, handIndex: 0 });
  h.do({ type: 'decide', seat: D, choice: h.state.decision!.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify({ unit: chump })) });
  pass(h); pass(h);   // resolve arc, blocker dies
  assert.ok(!ent(h, chump), 'blocker died before damage');
  pass(h); pass(h);   // damage
  // column is still blocked, but Piercing overflows everything past 0 blockers
  assert.equal(h.state.players[D]!.life, 30 - 7, 'piercing carried all 7 through the empty blocked column');
});

test('win condition', () => {
  const h = new Harness(9);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  h.state.players[D]!.life = 3;
  const whale = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(h.state.phase, 'gameover', 'game over');
  assert.equal(h.state.winner, A, 'attacker won');
});

test('1v1 counterattack: NIT sends units at block time, they attack in round 2', () => {
  const h = new Harness(42);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Curio Drifter');        // 2/2 attacker
  const counter = spawn(h, D, 'Rune Channeler');   // 4/3 counterattacker
  const homebody = spawn(h, D, 'Good Whale');      // stays home, cannot attack round 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [counter] });
  assert.ok(ent(h, counter)!.absent, 'sent counterattacker "does not exist" during round 1');
  pass(h); pass(h);   // block window
  assert.equal(h.state.players[D]!.life, 28, 'unblocked 2 damage');
  pass(h); pass(h);   // after-combat window → round 2
  assert.equal(h.state.battle!.round, 2);
  assert.equal(h.state.battle!.attacker, D, 'NIT attacks in round 2');
  assert.ok(!ent(h, counter)!.absent, 'counterattacker arrived');
  assert.equal(ent(h, counter)!.region, h.state.battle!.region, 'counterattacker is in IT region');
  assert.throws(() => h.do({ type: 'declareAttack', seat: D, columns: [[homebody]] }), IllegalAction,
    'only units sent at block time may counterattack');
  h.do({ type: 'declareAttack', seat: D, columns: [[counter]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: A, blocks: {} });
  pass(h); pass(h);
  assert.equal(h.state.players[A]!.life, 26, 'counterattacker hit for 4');
  pass(h); pass(h);   // after combat → regroup → deployment
  assert.equal(h.state.phase, 'deploy');
  const e = new E(h.state);
  assert.equal(ent(h, counter)!.region, e.homeRegion(D), 'regroup returned the counterattacker home');
  assert.equal(ent(h, atk)!.region, e.homeRegion(A), 'regroup returned the attacker home');
});

test('R3/Swift: swift column deals damage first, no priority between sub-steps', () => {
  const h = new Harness(43);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  // Dune Drifter 2/1 {Swift} + Rune Channeler 4/3 share a column: the column
  // is Swift, kills the 2/2 blocker in the swift sub-step before it strikes back
  const swift = spawn(h, A, 'Dune Drifter');
  const buddy = spawn(h, A, 'Rune Channeler');
  const blocker = spawn(h, D, 'Curio Drifter');   // 2/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[swift, buddy]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  pass(h); pass(h);   // damage: swift sub-step kills the blocker (4 ≥ 2)
  assert.ok(!ent(h, blocker), 'blocker died in the swift sub-step');
  assert.ok(ent(h, swift) && ent(h, buddy), 'attackers untouched: blocker never dealt damage');
  assert.equal(h.state.players[D]!.life, 30, 'blocked stays blocked: no damage through');
});
