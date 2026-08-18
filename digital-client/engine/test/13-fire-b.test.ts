/* Per-card tests for batch-fire-b (project rule: a test for every card).
 * Covers spawn/death triggers with stack interaction (Molten Riftbreaker),
 * token-spell triggers and bounded budgets (Nimbus Eel R9), spell-played
 * self-buffs (Ravenous Fireslinger), R6-style mid-resolution payments and bin
 * picks (Reclaimer of Secrets, Resurrect, Soul Tithe, Wildfire), the R1
 * "still in formation" resolution recheck (Rousing Spirit), sacrifice
 * approximations (Sacrificial Burst, Soul Swallower, Spiteful Shadow),
 * text-box [Augment] triggers (Sparkwraith, Spirit of Vengeance, Static
 * Courier, Stormsowing Nimbus, Unstable Apparition, Voltwrath Behemoth), and
 * the two-target choice of Twin Flame. States are built explicitly
 * (give/spawn/giveResources) so parallel card registration can't shift
 * assertions. Seeds 1301-1399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, pick,
  spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

test('Molten Riftbreaker: spawning creates two Fireball 1', () => {
  const h = new Harness(1301);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const mr = spawn(h, p, 'Molten Riftbreaker');
  assert.deepEqual(effStats(h, mr), [3, 2], '3/2');
  const fires = tokensOf(h, p).filter(t => t.card === 'Fireball');
  assert.equal(fires.length, 2, 'two Fireballs created');
  assert.ok(fires.every(t => t.x === 1), 'each is a Fireball 1');
});

test('Molten Riftbreaker: [Augment] text — my despawn negates all allied spells', () => {
  const h = new Harness(1302);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const rift = spawn(h, D, 'Molten Riftbreaker');    // own [Augment] text is live
  const whale = spawn(h, A, 'Good Whale');
  giveResources(h, D, 'water', 3);                   // Jelly b/3
  giveResources(h, A, 'fire', 2);                    // Luminous Arc r/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h);                                           // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Jelly') });
  pick(h, { unit: whale });                          // D's spell sits on the stack
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: rift });
  pass(h); pass(h);                                  // Arc resolves: Riftbreaker dies
  assert.ok(!ent(h, rift), 'Riftbreaker died');
  pass(h); pass(h);                                  // the despawn trigger resolves
  assert.ok(h.log.some(l => l.includes('Jelly is negated')), 'allied spell negated');
  pass(h); pass(h);                                  // Jelly resolves (negated)
  assert.deepEqual(effStats(h, whale), [7, 5], 'the negated Jelly never buffed/debuffed');
  assert.ok(!unitsOf(h, D).some(u => u.card === 'Jelly'), 'a negated spell unit never spawns');
  assert.ok(h.state.players[D]!.bin.includes('Jelly'), 'negated Jelly → bin');
  finishBattle(h);
});

test('Nimbus Eel: token spell → target gains +2/+0 ([Switch1]: once per turn)', () => {
  const h = new Harness(1303);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const eel = spawn(h, D, 'Nimbus Eel');             // 2/1
  const whale = spawn(h, A, 'Good Whale');
  {
    const e = new E(h.state);                        // a castable token spell for D
    e.createSpellToken(D, 'Fireball', 1, e.homeRegion(D));
  }
  toNextBattle(h, A);
  const tok1 = tokensOf(h, D).find(t => t.card === 'Fireball')!;
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h);                                           // priority → D
  h.do({ type: 'castSpellToken', seat: D, entityId: tok1.id });
  pick(h, { player: A });                            // Fireball's own target
  pick(h, { unit: eel });                            // Eel trigger's target
  pass(h); pass(h);                                  // trigger resolves
  assert.deepEqual(effStats(h, eel), [4, 1], '2/1 + 2/0 = 4/1');
  pass(h); pass(h);                                  // Fireball resolves
  assert.equal(h.state.players[A]!.life, 29, 'Fireball 1 hit A');
  // a second token spell the same turn: [Switch1] budget is spent (R9)
  {
    const e = new E(h.state);
    e.createSpellToken(D, 'Fireball', 1, h.state.battle!.region);
  }
  const tok2 = tokensOf(h, D).find(t => t.card === 'Fireball')!;
  pass(h);                                           // priority → D
  h.do({ type: 'castSpellToken', seat: D, entityId: tok2.id });
  pick(h, { player: A });
  pass(h); pass(h);                                  // Fireball resolves, no trigger
  assert.deepEqual(effStats(h, eel), [4, 1], 'bounded: no second buff this turn');
  finishBattle(h);
});

test('Nimbus Eel: token spell → the target also gains flying until regroup', () => {
  const h = new Harness(1304);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const eel = spawn(h, D, 'Nimbus Eel');             // 2/1, no printed flying
  const whale = spawn(h, A, 'Good Whale');
  {
    const e = new E(h.state);                        // a castable token spell for D
    e.createSpellToken(D, 'Fireball', 1, e.homeRegion(D));
  }
  toNextBattle(h, A);
  const tok = tokensOf(h, D).find(t => t.card === 'Fireball')!;
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h);                                           // priority → D
  h.do({ type: 'castSpellToken', seat: D, entityId: tok.id });
  pick(h, { player: A });                            // Fireball's own target
  pick(h, { unit: eel });                            // Eel trigger's target
  assert.ok(!ownAttrs(h, eel).has('Flying'), 'not flying before the trigger resolves');
  pass(h); pass(h);                                  // trigger resolves (addTempAttr)
  assert.ok(ownAttrs(h, eel).has('Flying'), 'gains flying until regroup');
  assert.deepEqual(effStats(h, eel), [4, 1], '…alongside the +2/+0');
  pass(h); pass(h);                                  // Fireball resolves
  finishBattle(h);
  assert.ok(!ownAttrs(h, eel).has('Flying'), 'the flying grant ends at regroup');
});

test('Ravenous Fireslinger: each of my nontoken spells gives +1/-1 (unbounded)', () => {
  const h = new Harness(1305);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const slinger = spawn(h, p, 'Ravenous Fireslinger');   // 4/3
  giveResources(h, p, 'water', 6);                       // two Lonely Foragers b/3
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Lonely Forager') });
  assert.deepEqual(effStats(h, slinger), [5, 2], 'first spell: +1/-1');
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Lonely Forager') });
  assert.deepEqual(effStats(h, slinger), [6, 1], 'second spell: +1/-1 again (no bound)');
});

test('Reclaimer of Secrets: on death, pay [two] to recall a bin spell to hand', () => {
  const h = new Harness(1306);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const rec = spawn(h, D, 'Reclaimer of Secrets');   // 4/1
  const whale = spawn(h, A, 'Good Whale');           // 7/5 Piercing
  h.state.players[D]!.bin.push('Luminous Arc');      // the only bin SPELL
  giveResources(h, D, 'fire', 2);                    // the [two]
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h); pass(h);                                  // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [rec] } });
  pass(h); pass(h);   // combat: Reclaimer dies; death trigger resolves at once → payment
  assert.ok(!ent(h, rec), 'Reclaimer died blocking');
  assert.equal(h.state.decision?.kind, 'payOrDecline');
  assert.equal(h.state.decision!.seat, D);
  pick(h, true);                                     // pay [two]; single spell auto-picked
  assert.ok(h.state.players[D]!.hand.includes('Luminous Arc'), 'spell recalled to hand');
  assert.deepEqual(h.state.players[D]!.bin, ['Reclaimer of Secrets'],
    'the Arc left the bin; the dead unit (not a spell) stayed');
  assert.equal(new E(h.state).openMana(D), 0, '[two] was paid mid-resolution (R6)');
  finishBattle(h);
});

test('Resurrect: put a bin unit with cost 2 or less into play', () => {
  const h = new Harness(1307);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  // two legal picks (cost <= 2 units), one too expensive, one not a unit
  h.state.players[p]!.bin.push('Sparkwraith', 'Ignis Sprite', 'Good Whale', 'Luminous Arc');
  giveResources(h, p, 'fire', 2);                    // r / 2
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Resurrect') });
  assert.equal(h.state.decision?.kind, 'payOrDecline', 'which unit? (two qualify)');
  assert.deepEqual(h.state.decision!.options.map(o => o.label), ['Sparkwraith', 'Ignis Sprite'],
    'only units with cost 2 or less are offered');
  pick(h, 0);                                        // bin index of Sparkwraith
  assert.ok(unitsOf(h, p).some(u => u.card === 'Sparkwraith'), 'Sparkwraith in play');
  assert.deepEqual(h.state.players[p]!.bin, ['Ignis Sprite', 'Good Whale', 'Luminous Arc', 'Resurrect'],
    'picked card left the bin; the resolved spell joined it');
});

test('Rousing Spirit: attack → a cheap bin unit fills the slot behind me', () => {
  const h = new Harness(1308);
  toDeployment(h);
  const A = h.state.initiative;
  const spirit = spawn(h, A, 'Rousing Spirit');      // 4/3
  h.state.players[A]!.bin.push('Sparkwraith');       // cost 1 unit
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[spirit]] });
  pass(h); pass(h);                                  // attack trigger resolves
  assert.equal(h.state.decision?.kind, 'payOrDecline', 'in formation, slot free → offer');
  pick(h, 0);                                        // bin index of Sparkwraith
  const col = h.state.battle!.columns[0]!;
  assert.equal(col.length, 2, 'the column filled up');
  assert.equal(col[0], spirit, 'Spirit stays in front');
  assert.equal(ent(h, col[1]!)!.card, 'Sparkwraith', 'Sparkwraith in the slot behind');
  assert.deepEqual(h.state.players[A]!.bin, [], 'it left the bin');
  finishBattle(h);
});

test('Sacrificial Burst: sacrifice a unit, deal 4 to any target', () => {
  const h = new Harness(1309);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atkr = spawn(h, A, 'Ignis Sprite');          // 1/1 (its Fireball stays home)
  const whale = spawn(h, D, 'Good Whale');
  const fodder = spawn(h, D, 'Curio Drifter');       // 2/2
  giveResources(h, D, 'fire', 1);                    // r / 1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atkr]] });
  pass(h);                                           // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Sacrificial Burst') });
  pick(h, { player: A });                            // the 4 damage target
  pass(h); pass(h);                                  // resolve → sacrifice choice
  assert.equal(h.state.decision?.kind, 'payOrDecline');
  assert.equal(h.state.decision!.seat, D, 'the controller picks the sacrifice');
  pick(h, fodder);
  assert.ok(!ent(h, fodder), 'the sacrifice died');
  assert.ok(h.state.players[D]!.bin.includes('Curio Drifter'));
  assert.ok(ent(h, whale), 'the other unit was not touched');
  assert.equal(h.state.players[A]!.life, 26, '4 damage to A');
  finishBattle(h);
});

test('Soul Swallower: activated [Augment] text — sacrifice another unit for +2/+2', () => {
  const h = new Harness(1310);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const sw = spawn(h, p, 'Soul Swallower');          // 2/1
  const fodder = spawn(h, p, 'Curio Drifter');
  // played normally: its own [Augment] text is activatable (via 'augment')
  h.do({ type: 'activateAbility', seat: p, entityId: sw, abilityIndex: 0, via: 'augment' });
  pick(h, { unit: fodder });
  assert.ok(!ent(h, fodder), 'the sacrifice died');
  assert.deepEqual(effStats(h, sw), [4, 3], '2/1 + 2/2 = 4/3');
  // "ANOTHER unit": picking the carrier itself no-ops
  h.do({ type: 'activateAbility', seat: p, entityId: sw, abilityIndex: 0, via: 'augment' });
  pick(h, { unit: sw });
  assert.deepEqual(effStats(h, sw), [4, 3], 'self-pick: no sacrifice, no buff');
  assert.ok(ent(h, sw), 'still alive');
  // donated: augment a host, activate through the mod
  const whale = spawn(h, p, 'Good Whale');           // 7/5
  giveResources(h, p, 'fire', 2);                    // r / 2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Soul Swallower'), hostId: whale });
  const modId = ent(h, whale)!.mods[0]!;
  const fodder2 = spawn(h, p, 'Curio Drifter');
  h.do({ type: 'activateAbility', seat: p, entityId: whale, abilityIndex: 0, via: { mod: modId } });
  pick(h, { unit: fodder2 });
  assert.ok(!ent(h, fodder2), 'donated: the sacrifice died');
  assert.deepEqual(effStats(h, whale), [9, 7], 'donated: the HOST gains +2/+2');
});

test('Soul Tithe: decline → the effect is negated and I draw', () => {
  const h = new Harness(1311);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const whale = spawn(h, A, 'Good Whale');
  const du = spawn(h, D, 'Curio Drifter');           // Arc's would-be victim
  giveResources(h, A, 'fire', 2);                    // Arc r/2 — nothing left to pay with
  giveResources(h, D, 'fire', 1);                    // Tithe r/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: du });
  const arcId = h.state.stack[0]!.id;
  const handBefore = h.state.players[D]!.hand.length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Soul Tithe') });
  pick(h, { stack: arcId });
  pass(h); pass(h);                                  // Tithe resolves → payment
  assert.equal(h.state.decision?.kind, 'payOrDecline');
  assert.equal(h.state.decision!.seat, A, "the TARGET's controller decides");
  assert.deepEqual(h.state.decision!.options.map(o => o.label), ["Don't pay"],
    'A has no open mana — paying is not even offered');
  pick(h, false);
  assert.ok(h.log.some(l => l.includes('Luminous Arc is negated')), 'effect negated');
  assert.equal(h.state.players[D]!.hand.length, handBefore + 1, 'and I drew a card');
  pass(h); pass(h);                                  // the negated Arc resolves
  assert.ok(ent(h, du), 'the negated Arc never dealt its damage');
  assert.ok(h.state.players[A]!.bin.includes('Luminous Arc'));
  finishBattle(h);
});

test('Soul Tithe: pay [one] → the effect stands', () => {
  const h = new Harness(1312);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const whale = spawn(h, A, 'Good Whale');
  const du = spawn(h, D, 'Curio Drifter');           // 2/2
  giveResources(h, A, 'fire', 3);                    // Arc r/2 + [one] to spare
  giveResources(h, D, 'fire', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: du });
  const arcId = h.state.stack[0]!.id;
  const handBefore = h.state.players[D]!.hand.length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Soul Tithe') });
  pick(h, { stack: arcId });
  pass(h); pass(h);                                  // Tithe resolves → payment
  pick(h, true);                                     // pay [one]
  assert.equal(new E(h.state).openMana(A), 0, 'the [one] was expended');
  assert.equal(h.state.players[D]!.hand.length, handBefore, 'no draw on the pay branch');
  pass(h); pass(h);                                  // Arc resolves for real
  assert.ok(!ent(h, du), 'the un-negated Arc killed its target');
  finishBattle(h);
});

test('Sparkwraith: [Augment] text — my spells grow me by a +1/+1 counter', () => {
  const h = new Harness(1313);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const wraith = spawn(h, p, 'Sparkwraith');         // 0/1
  giveResources(h, p, 'water', 3);
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Lonely Forager') });
  assert.equal(ent(h, wraith)!.counters, 1, 'one +1/+1 counter');
  assert.deepEqual(effStats(h, wraith), [1, 2], '0/1 + a counter = 1/2');
});

test('Spirit of Vengeance: [Augment] text — a unit dying hits each opponent for 1', () => {
  const h = new Harness(1314);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  spawn(h, D, 'Spirit of Vengeance');
  let blocker: number;
  {
    const e = new E(h.state);                        // a trigger-free 2/2 blocker
    blocker = e.spawnUnit(D, 'Unit Token', e.homeRegion(D), { token: true, tokenStats: [2, 2] }).id;
    e.settle();
  }
  const sprite = spawn(h, A, 'Ignis Sprite');        // 1/1, dies in combat
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sprite]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  finishBattle(h);                                   // combat kills the sprite → trigger
  assert.ok(!ent(h, sprite), 'the attacker died');
  assert.equal(h.state.players[A]!.life, 29, 'each opponent (A, present in the region) lost 1');
  assert.equal(h.state.players[D]!.life, 30, 'the controller is not an opponent');
});

test('Spiteful Shadow: my death makes each player sacrifice a unit', () => {
  const h = new Harness(1315);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const shadow = spawn(h, A, 'Spiteful Shadow');     // 0/1
  const whale = spawn(h, A, 'Good Whale');
  let blocker: number;
  {
    const e = new E(h.state);                        // a trigger-free 1/1 blocker
    blocker = e.spawnUnit(D, 'Unit Token', e.homeRegion(D), { token: true, tokenStats: [1, 1] }).id;
    e.settle();
  }
  const extra = spawn(h, D, 'Curio Drifter');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[shadow], [whale]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  pass(h); pass(h);   // combat: the 0/1 Shadow dies; death trigger resolves at once
  assert.ok(!ent(h, shadow));
  assert.equal(h.state.decision?.kind, 'payOrDecline');
  assert.equal(h.state.decision!.seat, D, 'D has two units in the region — D picks');
  pick(h, extra);
  assert.ok(!ent(h, extra), 'D sacrificed the pick');
  assert.ok(!ent(h, whale), "A's only unit was auto-sacrificed");
  assert.ok(ent(h, blocker), "D's other unit lives");
  assert.ok(h.state.players[A]!.bin.includes('Good Whale'));
  assert.ok(h.state.players[D]!.bin.includes('Curio Drifter'));
  finishBattle(h);
});

test('Static Courier: [Augment] text — death makes a Fireball X (X = last-known power)', () => {
  const h = new Harness(1316);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const courier = spawn(h, D, 'Static Courier');     // 3/2
  new E(h.state).addCounters(ent(h, courier)!, 1);   // → 4/3: power counts counters
  const whale = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'fire', 2);                    // Luminous Arc r/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: courier });
  pass(h); pass(h);                                  // Arc kills the 4/3 Courier
  assert.ok(!ent(h, courier));
  pass(h); pass(h);                                  // death trigger resolves
  const fires = tokensOf(h, D).filter(t => t.card === 'Fireball');
  assert.equal(fires.length, 1, 'one Fireball created');
  assert.equal(fires[0]!.x, 4, 'X = my power when I died (3 printed + 1 counter)');
  finishBattle(h);
});

test('Stormsowing Nimbus: [Augment] text — my nontoken spell makes a 1/1', () => {
  const h = new Harness(1317);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Stormsowing Nimbus');
  giveResources(h, p, 'water', 3);
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Lonely Forager') });
  const made = unitsOf(h, p).filter(u => u.card === 'Unit Token');
  assert.equal(made.length, 1, 'exactly one 1/1 (the token spawn is not a "play")');
  assert.deepEqual(effStats(h, made[0]!.id), [1, 1]);
});

test('Twin Flame: 2 damage to each of up to two target units', () => {
  const h = new Harness(1318);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sprite = spawn(h, A, 'Ignis Sprite');        // 1/1
  const whale = spawn(h, A, 'Good Whale');           // 7/5
  giveResources(h, D, 'fire', 3);                    // rr / 3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sprite], [whale]] });
  pass(h);                                           // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Twin Flame') });
  // BOTH targets at cast time now (count: 2, min: 1) with a done-option
  pick(h, { unit: sprite });                         // first target
  assert.equal(h.state.decision?.kind, 'targets', 'second target asked at CAST');
  assert.ok(h.state.decision!.options.some(o => o.label === 'No more targets'), '"up to two"');
  pick(h, { unit: whale });                          // second target
  pass(h); pass(h);                                  // resolve
  assert.ok(!ent(h, sprite), 'the 1/1 died to 2 damage');
  assert.equal(ent(h, whale)!.damage, 2, 'the second target took its own 2');
  finishBattle(h);
});

test("Unstable Apparition: [once] — first nontoken spell makes a Fireball = its cost", () => {
  const h = new Harness(1319);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Unstable Apparition');
  giveResources(h, p, 'water', 6);                   // two Lonely Foragers (cost 3)
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Lonely Forager') });
  let fires = tokensOf(h, p).filter(t => t.card === 'Fireball');
  assert.equal(fires.length, 1, 'first spell → a Fireball');
  assert.equal(fires[0]!.x, 3, "X = the spell's cost (Lonely Forager: 3)");
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Lonely Forager') });
  fires = tokensOf(h, p).filter(t => t.card === 'Fireball');
  assert.equal(fires.length, 1, '[once]: no second Fireball this turn (R9)');
});

test('Voltwrath Behemoth: [Augment] text — my spell lets me deal 1 to any target', () => {
  const h = new Harness(1320);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Voltwrath Behemoth');
  const fodder = spawn(h, p, 'Curio Drifter');
  giveResources(h, p, 'water', 3);
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Lonely Forager') });
  assert.equal(h.state.decision?.kind, 'targets', 'the trigger asks for its target');
  pick(h, { unit: fodder });
  assert.equal(ent(h, fodder)!.damage, 1, '1 damage delivered');
});

test('Wildfire: X is chosen and paid at resolution, then dealt to any target', () => {
  const h = new Harness(1321);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const whale = spawn(h, A, 'Good Whale');
  giveResources(h, D, 'fire', 5);                    // rr affinity + up to 5 mana of X
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h);                                           // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wildfire') });
  pick(h, { player: A });
  pass(h); pass(h);                                  // resolve → choose X
  assert.equal(h.state.decision?.kind, 'payOrDecline');
  assert.equal(h.state.decision!.options.length, 6, 'X ranges 0..open mana (5)');
  pick(h, 4);                                        // X = 4
  assert.equal(h.state.players[A]!.life, 26, '4 damage to A');
  assert.equal(new E(h.state).openMana(D), 1, 'X was paid on the spot');
  finishBattle(h);
});
