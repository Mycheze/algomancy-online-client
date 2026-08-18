/* Per-card tests for batch-wood-c (project rule: a test for every card).
 * Covers the control-change approximation (Ralph's defection, Rebalance's
 * mutual handover, Stellarspore Harvester's steal + death gift), Poison
 * token production (Spewing Mushroom's power-X, Sprouter's sacrifice,
 * Verdant Necrophage's spawn 6, Spawning Ground's end-of-turn tax), the
 * -1/-1-counter payoffs (Sporebloom Siren's delete, Wandering Blightshell's
 * bounded draw), until-regroup team buffs (Sudden Bloom, Warbloom Herald),
 * counting effects (Sylvan Sprouting's affinity units, Verdant Vengeance's
 * unit-count damage), the nontoken-death token mill (Saprophytic Oracle,
 * played normally AND donated), the bin recall (Verdant Necrophage's
 * augment) and the selective mass negate (Woodland Warding). States are
 * built explicitly (give/spawn/giveResources + white-box E edits).
 * Seeds 2500-2599. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick,
  spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

const home = (h: Harness, seat: number): number =>
  h.state.regions.findIndex(r => r.owner === seat);

test('Ralph: [one] gives target opponent control of it, creates three 1/1s at home; bounded across the handover', () => {
  const h = new Harness(2500);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const ralph = spawn(h, A, 'Ralph');                 // 2/1
  giveResources(h, A, 'wood', 1);                     // the [one]
  giveResources(h, D, 'wood', 1);                     // D's later attempt
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ralph]] });
  h.do({ type: 'activateAbility', seat: A, entityId: ralph, abilityIndex: 0 });
  pick(h, { player: D });                             // target opponent
  pass(h); pass(h);                                   // resolve
  assert.equal(ent(h, ralph)!.controller, D, 'the opponent gained control of Ralph');
  assert.ok(!h.state.battle!.columns.flat().includes(ralph), 'Ralph dropped out of the attack formation');
  const tokens = unitsOf(h, A).filter(u => u.card === 'Unit Token');
  assert.equal(tokens.length, 3, '"if you do": three 1/1 units for the giver');
  assert.ok(tokens.every(u => u.region === home(h, A)), 'created units arrive at HOME (R28), not the battle region');
  pass(h);                                            // priority → D
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: D, entityId: ralph, abilityIndex: 0 }),
    /already used/, '[Switch1]: the per-card budget survives the control change (R9)');
  finishBattle(h);
});

test('Rebalance: each present player gives an opponent control of one of their units', () => {
  const h = new Harness(2501);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');              // A's only in-region unit → auto-pick
  const lurk = spawn(h, D, 'Crevice Lurker');         // D chooses between two
  const tok = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'wood', 2);                     // g / 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                            // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Rebalance') });
  pass(h); pass(h);                                   // resolve → D's pick is asked
  pick(h, lurk);                                      // D gives the Lurker
  assert.equal(ent(h, atk)!.controller, D, "A's auto-picked attacker now belongs to D");
  assert.equal(ent(h, lurk)!.controller, A, "D's chosen Lurker now belongs to A");
  assert.equal(ent(h, tok)!.controller, D, 'the unchosen unit stayed put');
  assert.ok(!h.state.battle!.columns.flat().includes(atk), 'the handed-over attacker left the formation');
  finishBattle(h);
  assert.equal(ent(h, lurk)!.region, home(h, A), 'regroup takes the Lurker to its NEW controller (R11)');
});

test('Saprophytic Oracle: a nontoken death mints a 1/1 at home; token deaths do not', () => {
  const h = new Harness(2502);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Saprophytic Oracle');                  // 2/3, own [Augment] text live
  const victim = spawn(h, p, 'Sprouter');             // nontoken 1/1
  const e = new E(h.state);
  e.destroy(ent(h, victim)!, 'dies');
  e.settle();
  const minted = unitsOf(h, p).filter(u => u.card === 'Unit Token');
  assert.equal(minted.length, 1, 'nontoken death → one 1/1 unit');
  assert.equal(minted[0]!.region, home(h, p), 'the 1/1 arrives at home (R28)');
  const e2 = new E(h.state);
  e2.destroy(minted[0]!, 'dies');                     // the token itself dies…
  e2.settle();
  assert.equal(unitsOf(h, p).filter(u => u.card === 'Unit Token').length, 0,
    '…and mints nothing ("nontoken", no loop)');
});

test('Saprophytic Oracle: donated [Augment] text fires for the host on a nontoken death', () => {
  const h = new Harness(2503);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const host = spawn(h, p, 'Crevice Lurker');
  giveResources(h, p, 'wood', 3);                     // gg / 3
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Saprophytic Oracle'), hostId: host });
  const victim = spawn(h, p, 'Sprouter');
  const e = new E(h.state);
  e.destroy(ent(h, victim)!, 'dies');
  e.settle();
  assert.equal(unitsOf(h, p).filter(u => u.card === 'Unit Token').length, 1,
    'the donated text minted a 1/1 for the host controller');
});

test('Spawning Ground: at the end of turn its controller loses 1 life and gets a Poison 1', () => {
  const h = new Harness(2504);
  toDeployment(h);
  const p = h.state.deployPlayer!, o = 1 - p;
  spawn(h, p, 'Spawning Ground');                     // 0/2, own [Augment] text live
  const lifeP = h.state.players[p]!.life;
  const lifeO = h.state.players[o]!.life;
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });   // → end of turn
  assert.equal(h.state.players[p]!.life, lifeP - 1, 'the controller lost 1 life');
  assert.equal(h.state.players[o]!.life, lifeO, 'the opponent lost nothing');
  const poison = tokensOf(h, p).filter(t => t.card === 'Poison');
  assert.equal(poison.length, 1, 'a Poison was created');
  assert.equal(poison[0]!.x, 1, 'a Poison 1');
  assert.equal(h.state.turn, 2, 'the turn flipped normally');
});

test('Spewing Mushroom: attacking creates a Poison X where X is its power AT RESOLUTION', () => {
  const h = new Harness(2505);
  toDeployment(h);
  const A = h.state.initiative;
  const mush = spawn(h, A, 'Spewing Mushroom');       // 1/3
  toNextBattle(h, A);
  new E(h.state).addTemp(ent(h, mush)!, 2, 0);        // white-box: 3/3 until regroup
  h.do({ type: 'declareAttack', seat: A, columns: [[mush]] });
  pass(h); pass(h);                                   // resolve the trigger
  const poison = tokensOf(h, A).filter(t => t.card === 'Poison');
  assert.equal(poison.length, 1, 'one Poison token');
  assert.equal(poison[0]!.x, 3, 'X = live power 3 (R1 amounts at resolution)');
  assert.equal(poison[0]!.region, h.state.battle!.region, 'spell tokens appear where the effect resolves');
  finishBattle(h);
});

test('Sporebloom Siren: its Poisonous trade marks the killer; the death trigger deletes all countered units', () => {
  const h = new Harness(2506);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const siren = spawn(h, A, 'Sporebloom Siren');      // 2/2 {Poisonous}
  const lurk = spawn(h, D, 'Crevice Lurker');         // 2/3 — blocks, takes -2 counters
  const tok = spawn(h, D, 'Unit Token');              // clean bystander
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[siren]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [lurk] } });
  pass(h); pass(h);   // combat: siren poisons the Lurker (-2), dies to its 2 power → trigger (R31)
  assert.ok(!ent(h, siren), 'the Siren died in the trade');
  assert.ok(h.state.players[A]!.bin.includes('Sporebloom Siren'), 'Siren → bin');
  assert.ok(!ent(h, lurk), 'the countered Lurker was DELETED by the death trigger');
  assert.ok(h.state.players[D]!.bin.includes('Crevice Lurker'), 'deleted (nontoken, unmodded) → bin');
  assert.ok(ent(h, tok), 'the counter-free bystander survived');
  finishBattle(h);
});

test('Sprouter: sacrifice it (cost, during deployment) → a Poison 1 appears', () => {
  const h = new Harness(2507);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const sp = spawn(h, p, 'Sprouter');                 // 1/1
  h.do({ type: 'activateAbility', seat: p, entityId: sp, abilityIndex: 0 });
  assert.ok(!ent(h, sp), 'the Sprouter was sacrificed as the cost');
  assert.ok(h.state.players[p]!.bin.includes('Sprouter'), 'sacrificed → bin');
  const poison = tokensOf(h, p).filter(t => t.card === 'Poison');
  assert.equal(poison.length, 1, 'a Poison was created');
  assert.equal(poison[0]!.x, 1, 'a Poison 1');
});

test('Stellarspore Harvester: after combat it steals a target unit carrying a -1/-1 counter', () => {
  const h = new Harness(2508);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const harv = spawn(h, A, 'Stellarspore Harvester'); // 3/5
  const lurk = spawn(h, D, 'Crevice Lurker');         // 2/3, gets a -1/-1 counter
  new E(h.state).addCounters(ent(h, lurk)!, -1);      // white-box: 1/2 now
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[harv]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);   // combat + after-combat → the trigger asks for its target
  pick(h, { unit: lurk });
  pass(h); pass(h);   // the trigger resolves from the stack (after-window)
  assert.equal(ent(h, lurk)!.controller, A, 'the countered Lurker was stolen');
  finishBattle(h);
  assert.equal(ent(h, lurk)!.region, home(h, A), 'regroup takes it to its new controller (R11)');
});

test('Stellarspore Harvester: [Augment] death gives your countered units to target opponent', () => {
  const h = new Harness(2509);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const harv = spawn(h, A, 'Stellarspore Harvester'); // 3/5, own [Augment] text live
  const mine = spawn(h, A, 'Crevice Lurker');         // A's unit with a -1/-1 counter
  new E(h.state).addCounters(ent(h, mine)!, -1);
  const bubb = spawn(h, D, 'Bubb');                   // 5/6 — kills the Harvester
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[harv], [mine]] });   // both must be IN the battle
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [bubb] } });
  pass(h); pass(h);   // combat: Bubb's 5 kills the 3/5 → died trigger asks for its target
  pick(h, { player: D });
  assert.ok(!ent(h, harv), 'the Harvester died in combat');
  assert.equal(ent(h, mine)!.controller, D, 'its countered unit went to the targeted opponent');
  finishBattle(h);
});

test('Sudden Bloom: your in-region units get +1/+1 until regroup (and only until regroup)', () => {
  const h = new Harness(2510);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const u1 = spawn(h, A, 'Unit Token');               // 1/1
  const u2 = spawn(h, A, 'Unit Token');               // 1/1
  const dUnit = spawn(h, D, 'Unit Token');            // 1/1 enemy
  giveResources(h, A, 'wood', 1);                     // g / 1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[u1], [u2]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Sudden Bloom') });
  pass(h); pass(h);                                   // resolve
  assert.deepEqual(effStats(h, u1), [2, 2], 'attacker one buffed');
  assert.deepEqual(effStats(h, u2), [2, 2], 'attacker two buffed');
  assert.deepEqual(effStats(h, dUnit), [1, 1], 'enemy untouched ("your units")');
  finishBattle(h);
  assert.deepEqual(effStats(h, u1), [1, 1], 'the buff was cleaned up at regroup');
});

test('Sylvan Sprouting: one 1/1 per wood affinity — expended wood still counts', () => {
  const h = new Harness(2511);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'wood', 4);                     // paying [3] expends 3 of these
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Sylvan Sprouting') });
  const tokens = unitsOf(h, p).filter(u => u.card === 'Unit Token');
  assert.equal(tokens.length, 4, '4 wood affinity → 4 units (expended resources still give affinity)');
  assert.ok(tokens.every(u => u.region === home(h, p)), 'created units arrive at home (R28)');
});

test('Verdant Necrophage: spawning creates a Poison 6', () => {
  const h = new Harness(2512);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Verdant Necrophage');                  // 2/4
  const poison = tokensOf(h, p).filter(t => t.card === 'Poison');
  assert.equal(poison.length, 1, 'one Poison token');
  assert.equal(poison[0]!.x, 6, 'a Poison 6');
});

test('Verdant Necrophage: [Augment] its death lets each opponent recall a UNIT from their bin', () => {
  const h = new Harness(2513);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const necro = spawn(h, A, 'Verdant Necrophage');    // 2/4, own [Augment] text live
  const bubb = spawn(h, D, 'Bubb');                   // 5/6 — kills it
  h.state.players[D]!.bin.push('Sprouter', 'Ralph', 'Rebalance');   // Rebalance is a spell — not offered
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[necro]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [bubb] } });
  pass(h); pass(h);   // combat kills the Necrophage → trigger asks D which unit to recall
  pick(h, 1);                                         // bin index 1 = Ralph
  assert.ok(!ent(h, necro), 'the Necrophage died');
  assert.ok(h.state.players[D]!.hand.includes('Ralph'), 'D recalled Ralph to hand');
  assert.deepEqual(h.state.players[D]!.bin, ['Sprouter', 'Rebalance'],
    'the other unit stayed binned; the spell was never an option');
  finishBattle(h);
});

test('Verdant Vengeance: damage to target unit equals your in-region unit count at resolution', () => {
  const h = new Harness(2514);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const bubb = spawn(h, A, 'Bubb');                   // 5/6 attacker — the target
  spawn(h, D, 'Unit Token'); spawn(h, D, 'Unit Token'); spawn(h, D, 'Unit Token');
  giveResources(h, D, 'wood', 2);                     // gg / 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bubb]] });
  pass(h);                                            // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Verdant Vengeance') });
  pick(h, { unit: bubb });
  pass(h); pass(h);                                   // resolve
  assert.equal(ent(h, bubb)!.damage, 3, 'D controls 3 in-region units → 3 damage');
  finishBattle(h);
});

test('Wandering Blightshell: a -1/-1 counter you put on an enemy draws a card — once per turn (R9)', () => {
  const h = new Harness(2515);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const shell = spawn(h, A, 'Wandering Blightshell'); // 1/2 — must share the region
  const lurk = spawn(h, D, 'Crevice Lurker');         // 2/3 victim
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[shell]] });
  const region = h.state.battle!.region;
  const t1 = new E(h.state).createSpellToken(A, 'Poison', 1, region);
  const hand0 = h.state.players[A]!.hand.length;
  h.do({ type: 'castSpellToken', seat: A, entityId: t1.id });
  pick(h, { unit: lurk });
  pass(h); pass(h);                                   // Poison resolves → counter → trigger
  pass(h); pass(h);                                   // the trigger resolves → draw
  assert.equal(h.state.players[A]!.hand.length, hand0 + 1, 'the counter drew a card');
  const t2 = new E(h.state).createSpellToken(A, 'Poison', 1, region);
  h.do({ type: 'castSpellToken', seat: A, entityId: t2.id });
  pick(h, { unit: lurk });
  pass(h); pass(h);                                   // second counter: budget spent → no trigger
  assert.equal(h.state.players[A]!.hand.length, hand0 + 1, '[Switch1]: only one draw per turn');
  assert.equal(h.log.filter(m => m.includes('Trigger: Wandering Blightshell')).length, 1,
    'the trigger fired exactly once');
  finishBattle(h);
});

test('Warbloom Herald: attacking gives your in-region units +1/+0 until regroup', () => {
  const h = new Harness(2516);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const herald = spawn(h, A, 'Warbloom Herald');      // 1/1
  const ally = spawn(h, A, 'Unit Token');             // 1/1 fellow attacker
  const dUnit = spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[herald], [ally]] });
  pass(h); pass(h);                                   // resolve the trigger
  assert.deepEqual(effStats(h, herald), [2, 1], 'the Herald buffed itself');
  assert.deepEqual(effStats(h, ally), [2, 1], 'and its fellow attacker');
  assert.deepEqual(effStats(h, dUnit), [1, 1], 'enemies untouched');
  finishBattle(h);
  assert.deepEqual(effStats(h, herald), [1, 1], 'cleared at regroup');
});

test('Woodland Warding: negates enemy effects aimed at your side, spares the rest', () => {
  const h = new Harness(2517);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');              // A's attacker (Boon target)
  const lurk = spawn(h, D, 'Crevice Lurker');         // D's unit (Vengeance target)
  giveResources(h, A, 'fire', 2);                     // Channeled Boon rr/2
  giveResources(h, A, 'wood', 2);                     // Verdant Vengeance gg/2
  giveResources(h, D, 'wood', 3);                     // Woodland Warding ggg/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: atk });                             // enemy effect aimed at A's OWN unit
  pass(h);                                            // D passes; priority → A
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Verdant Vengeance') });
  pick(h, { unit: lurk });                            // enemy effect aimed at D's unit
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Woodland Warding') });
  pass(h); pass(h);                                   // Warding (top) resolves
  const vv = h.state.stack.find(i => i.label.includes('Verdant Vengeance'))!;
  const boon = h.state.stack.find(i => i.label.includes('Channeled Boon'))!;
  assert.equal(vv.negated, true, 'the effect targeting an allied unit is negated');
  assert.equal(boon.negated, false, "the enemy effect aimed at the enemy's OWN unit is spared");
  pass(h); pass(h);                                   // negated Vengeance fizzles away
  pass(h); pass(h);                                   // the Boon still resolves
  assert.equal(ent(h, lurk)!.damage, 0, 'no damage got through');
  assert.deepEqual(effStats(h, atk), [5, 5], 'the spared Boon did its +4/+4');
  finishBattle(h);
});
