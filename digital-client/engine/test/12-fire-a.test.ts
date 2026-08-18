/* Per-card tests for batch-fire-a (project rule: a test for every card).
 * Covers a stack sweeper (Flame Shield), mid-resolution sacrifice choices
 * (Immolate, Bloodwind Revenant, General Smof, Ghord, Infernal Cultivator —
 * the R6 choose model), bin recall (Delver of Mysteries), retargeting with a
 * payment out (Gravitational Correction), end-of-turn triggers (Harbinger of
 * Immolation, Infernal Wispweaver), formation token creation (Hooba-Lin), a
 * trigger-approximated aura (Animated Spark), a haste body (Cinder Scuttler)
 * and the PARKED cards (todo tests state exactly what's missing). States are
 * built explicitly (give/spawn/giveResources) so parallel card registration
 * can't shift assertions. Seeds: 1200-1299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick,
  spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

// ── Abyssal Evocation ────────────────────────────────────────────────────

test('Abyssal Evocation: resolves as a no-op and is binned (bin-play PARKED)', () => {
  const h = new Harness(1200);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'Conduit of Pain');
  giveResources(h, A, 'fire', 4);                    // rr / 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Abyssal Evocation') });
  pass(h); pass(h);                                  // resolve
  assert.ok(h.state.players[A]!.bin.includes('Abyssal Evocation'), 'spell → bin');
  assert.ok(h.log.some(l => l.includes('PARKED')), 'no-op resolution is logged');
  finishBattle(h);
});

test('Abyssal Evocation: playing spells from the bin (unstable until regroup)', { todo: true }, () => {
  // PARKED: doPlayCard only reads the hand — a bin-play permission window plus
  // an "unstable until regroup" marker on cards so played does not exist yet.
});

// ── Animated Spark ───────────────────────────────────────────────────────

test('Animated Spark: each nontoken spell played in battle gives your units +1/+0', () => {
  const h = new Harness(1201);
  toDeployment(h);
  const A = h.state.initiative;
  const spark = spawn(h, A, 'Animated Spark');       // 0/1; own [Augment] text live
  const ally = spawn(h, A, 'Conduit of Pain');       // 2/1
  giveResources(h, A, 'fire', 1);                    // Immolate r / 1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[spark], [ally]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Immolate') });
  pass(h); pass(h);                                  // Spark trigger resolves first
  assert.deepEqual(effStats(h, spark), [1, 1], 'Spark itself +1/+0');
  assert.deepEqual(effStats(h, ally), [3, 1], 'ally +1/+0 per nontoken spell');
  pass(h); pass(h);                                  // Immolate resolves → choice
  pick(h, false);                                    // decline the sacrifice
  finishBattle(h);
});

// ── Bloodwind Revenant ───────────────────────────────────────────────────

test('Bloodwind Revenant: unblocked combat damage to opponent → may sacrifice to draw', () => {
  const h = new Harness(1202);
  toDeployment(h);
  const A = h.state.initiative;
  const rev = spawn(h, A, 'Bloodwind Revenant');     // 1/2 Flying
  const fodder = spawn(h, A, 'Conduit of Pain');     // 2/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[rev], [fodder]] });
  pass(h); pass(h);                                  // → blocks
  h.do({ type: 'declareBlocks', seat: 1 - A, blocks: {} });
  pass(h); pass(h);                                  // combat: opponent takes 3 → trigger
  const handBefore = h.state.players[A]!.hand.length;
  pass(h); pass(h);                                  // resolve the trigger → choice
  assert.equal(h.state.decision?.kind, 'payOrDecline');
  assert.equal(h.state.decision!.seat, A, 'the controller chooses the sacrifice');
  pick(h, fodder);                                   // sacrifice the fodder
  assert.ok(!ent(h, fodder), 'fodder sacrificed');
  assert.ok(h.state.players[A]!.bin.includes('Conduit of Pain'), 'sacrifice → bin');
  assert.equal(h.state.players[A]!.hand.length, handBefore + 1, 'drew a card');
  finishBattle(h);

  // blocked with no damage through: no trigger at all
  const h2 = new Harness(1252);
  toDeployment(h2);
  const A2 = h2.state.initiative, D2 = 1 - A2;
  const rev2 = spawn(h2, A2, 'Bloodwind Revenant');
  const blk = spawn(h2, D2, 'Bloodwind Revenant');   // a Flying blocker
  toNextBattle(h2, A2);
  h2.do({ type: 'declareAttack', seat: A2, columns: [[rev2]] });
  pass(h2); pass(h2);
  h2.do({ type: 'declareBlocks', seat: D2, blocks: { 0: [blk] } });
  const hand2 = h2.state.players[A2]!.hand.length;
  finishBattle(h2);                                  // trade, no player damage
  assert.equal(h2.state.players[A2]!.hand.length, hand2, 'no combat damage to a player → no draw');
});

// ── Cinder Scuttler ──────────────────────────────────────────────────────

test('Cinder Scuttler: playable in the haste step as a 2/1', () => {
  const h = new Harness(1203);
  const p = 0;
  const idx = give(h, p, 'Cinder Scuttler');
  giveResources(h, p, 'fire', 1);                    // r / 1
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone && !h.state.hasteDone[p], 'haste step engaged (R18)');
  h.do({ type: 'playCard', seat: p, handIndex: idx });
  const scut = unitsOf(h, p).find(u => u.card === 'Cinder Scuttler');
  assert.ok(scut, 'spawned during the haste step');
  assert.deepEqual(effStats(h, scut!.id), [2, 1], '2/1');
  h.do({ type: 'doneHaste', seat: p });
  assert.equal(h.state.phase, 'battle', 'battle follows the haste step');
});

test('Cinder Scuttler: recalled from the bin on combat damage to an opponent', { todo: true }, () => {
  // PARKED: "if I am in your bin, recall me" needs bin-resident trigger
  // listeners — fireEvent only scans in-play units.
});

// ── Conduit of Pain ──────────────────────────────────────────────────────

test('Conduit of Pain: plays as a 2/1; augments (donating nothing yet)', () => {
  const h = new Harness(1204);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const cp = spawn(h, p, 'Conduit of Pain');
  assert.deepEqual(effStats(h, cp), [2, 1], '2/1 body');
  const host = spawn(h, p, 'Unit Token');
  giveResources(h, p, 'fire', 2);                    // rr / 2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Conduit of Pain'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'recognised as an augment');
  assert.deepEqual(effStats(h, host), [1, 1], 'host stats unchanged (text is PARKED)');
});

test('Conduit of Pain: allied noncombat damage dealt +1 instead', { todo: true }, () => {
  // PARKED: damage replacement — dealEffectDamage has no would-deal hooks.
});

// ── Delver of Mysteries ──────────────────────────────────────────────────

test('Delver of Mysteries: recalls a chosen spell from the bin, then spawns 2/2', () => {
  const h = new Harness(1205);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  h.state.players[p]!.bin.push('Immolate', 'Conduit of Pain');   // spell + unit
  giveResources(h, p, 'fire', 4);                    // rr / 4
  const immolatesBefore = h.state.players[p]!.hand.filter(n => n === 'Immolate').length;
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Delver of Mysteries') });
  assert.equal(h.state.decision?.kind, 'payOrDecline', 'mid-resolution bin pick');
  assert.equal(h.state.decision!.options.length, 1, 'only the SPELL is offered, not the unit');
  pick(h, 0);                                        // bin index of Immolate
  assert.equal(h.state.players[p]!.hand.filter(n => n === 'Immolate').length,
    immolatesBefore + 1, 'Immolate recalled to hand');
  assert.deepEqual(h.state.players[p]!.bin, ['Conduit of Pain'], 'unit stays in the bin');
  const delver = unitsOf(h, p).find(u => u.card === 'Delver of Mysteries');
  assert.ok(delver, 'spell unit spawns after resolving');
  assert.deepEqual(effStats(h, delver!.id), [2, 2]);
});

// ── Emberflame Enlightener ───────────────────────────────────────────────

test('Emberflame Enlightener: plays as a 0/5 (Powerful aura PARKED)', () => {
  const h = new Harness(1206);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const ee = spawn(h, p, 'Emberflame Enlightener');
  assert.deepEqual(effStats(h, ee), [0, 5], '0/5 body');
});

test('Emberflame Enlightener: your units and spells gain Powerful', { todo: true }, () => {
  // PARKED: global attribute aura — the engine reads attrs only from a card's
  // own printed data and its own augment mods; no aura layer exists.
});

// ── Envoy of Lightning ───────────────────────────────────────────────────

test('Envoy of Lightning: plays as a 3/2 (Electric aura PARKED)', () => {
  const h = new Harness(1207);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const el = spawn(h, p, 'Envoy of Lightning');
  assert.deepEqual(effStats(h, el), [3, 2], '3/2 body');
});

test('Envoy of Lightning: your single-target spell effects are Electric', { todo: true }, () => {
  // PARKED: same missing aura/replacement layer (dealEffectDamage reads the
  // source CARD's printed attrs only).
});

// ── Fire Resource ────────────────────────────────────────────────────────

test('Fire Resource: registered with its printed face', () => {
  const c = getCard('Fire Resource');
  assert.equal(c.cost, 'r');
  assert.equal(c.power, 2);
  assert.equal(c.toughness, 0);
});

test('Fire Resource: activation → Shard at [r][r][r]', { todo: true }, () => {
  // PARKED: resource cards aren't modelled — resources are plain ResourceState
  // (not entities), doActivateResource doesn't fireEvent, and no 'Shard'
  // resource kind exists. Also flags: registering leaks it into DECK_LIST as a
  // phantom 2/0 unit.
});

// ── Flame Shield ─────────────────────────────────────────────────────────

test('Flame Shield: negates the rest of the stack; a Fireball per nontoken spell', () => {
  const h = new Harness(1209);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Conduit of Pain');
  const whale = spawn(h, D, 'Good Whale');           // 7/5, Arc's target
  giveResources(h, A, 'fire', 8);
  giveResources(h, D, 'fire', 4);                    // rr / 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: whale });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Flame Shield') });
  pass(h); pass(h);                                  // Flame Shield resolves first
  const fires = tokensOf(h, D).filter(t => t.card === 'Fireball');
  assert.equal(fires.length, 1, 'one nontoken spell negated → one Fireball');
  assert.equal(fires[0]!.x, 1, 'Fireball 1');
  assert.ok(h.state.stack[0]!.negated, 'Luminous Arc is negated');
  pass(h); pass(h);                                  // negated Arc resolves → bin
  assert.ok(ent(h, whale), 'target survives');
  assert.equal(ent(h, whale)!.damage, 0, 'no damage dealt');
  assert.ok(h.state.players[A]!.bin.includes('Luminous Arc'), 'negated spell → bin');
  finishBattle(h);
});

// ── General Smof ─────────────────────────────────────────────────────────

test('General Smof: after combat, each present player sacrifices a unit of their choice', () => {
  const h = new Harness(1210);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const smof = spawn(h, A, 'General Smof');
  const fodder = spawn(h, A, 'Conduit of Pain');
  const whale = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[smof], [fodder]] });
  pass(h); pass(h);                                  // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                  // combat, afterCombat trigger pushed
  pass(h); pass(h);                                  // resolve the trigger
  assert.equal(h.state.decision?.seat, D, 'region owner picks first (presentSeats order)');
  pick(h, whale);                                    // D sacrifices the whale
  assert.equal(h.state.decision?.seat, A, 'then the attacker picks');
  pick(h, fodder);                                   // A keeps Smof
  assert.ok(!ent(h, whale) && !ent(h, fodder), 'both sacrifices committed together');
  assert.ok(h.state.players[D]!.bin.includes('Good Whale'));
  assert.ok(h.state.players[A]!.bin.includes('Conduit of Pain'));
  assert.ok(ent(h, smof), 'Smof survives');
  finishBattle(h);
});

// ── Ghord ────────────────────────────────────────────────────────────────

test('Ghord: sacrificing a unit makes each present opponent sacrifice a nontoken unit', () => {
  const h = new Harness(1211);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const ghord = spawn(h, A, 'Ghord');
  const fodder = spawn(h, A, 'Conduit of Pain');
  const whale = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'fire', 1);                    // Immolate r / 1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ghord], [fodder]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Immolate') });
  pass(h); pass(h);                                  // Immolate resolves → choice
  const handBefore = h.state.players[A]!.hand.length;
  pick(h, fodder);                                   // A sacrifices → Ghord triggers
  assert.ok(h.state.players[A]!.bin.includes('Conduit of Pain'), 'sacrificed → bin');
  assert.equal(h.state.players[A]!.hand.length, handBefore + 1, 'Immolate drew');
  pass(h); pass(h);                                  // resolve Ghord's trigger
  assert.equal(h.state.decision?.seat, D, 'the opponent picks their sacrifice');
  pick(h, whale);
  assert.ok(!ent(h, whale), 'opponent sacrificed a nontoken unit');
  assert.ok(h.state.players[D]!.bin.includes('Good Whale'));
  assert.ok(ent(h, ghord), 'Ghord still in play');
  finishBattle(h);
});

// ── Gravitational Correction ─────────────────────────────────────────────

test('Gravitational Correction: retargets the effect unless its controller pays [x]', () => {
  const h = new Harness(1212);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const conduit = spawn(h, A, 'Conduit of Pain');    // 2/1 attacker (the new target)
  const whale = spawn(h, D, 'Good Whale');           // 7/5 (the original target)
  giveResources(h, A, 'fire', 8);
  giveResources(h, D, 'fire', 2);                    // rr / X
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[conduit]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: whale });
  const arcId = h.state.stack.find(i => i.card === 'Luminous Arc')!.id;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Gravitational Correction') });
  pick(h, { stack: arcId });
  // no cast-time X primitive (PARKED half): set X = 2 white-box on the item
  h.state.stack.find(i => i.card === 'Gravitational Correction')!.x = 2;
  pass(h); pass(h);                                  // resolve the Correction
  assert.equal(h.state.decision?.kind, 'payOrDecline');
  assert.equal(h.state.decision!.seat, A, "the EFFECT's controller decides (R6)");
  assert.ok(h.state.decision!.options.some(o => o.value === true), 'pay [2] is affordable & offered');
  pick(h, false);                                    // decline → retarget
  assert.equal(h.state.decision?.seat, D, "the Correction's controller picks the new target");
  pick(h, { unit: conduit });
  assert.ok(h.state.players[D]!.bin.includes('Gravitational Correction'), 'spell → bin');
  pass(h); pass(h);                                  // Arc resolves at its NEW target
  assert.ok(!ent(h, conduit), 'retargeted Arc killed the 2/1');
  assert.ok(ent(h, whale), 'original target untouched');
  assert.equal(ent(h, whale)!.damage, 0);
  finishBattle(h);
});

// ── Harbinger of Immolation ──────────────────────────────────────────────

test('Harbinger of Immolation: end of turn → Fireball X, X = 1 + your spell tokens', () => {
  const h = new Harness(1213);
  toDeployment(h);
  const p = h.state.initiative;
  spawn(h, p, 'Harbinger of Immolation');
  const e = new E(h.state);                          // two tokens made after regroup
  e.createSpellToken(p, 'Fireball', 1, e.homeRegion(p));
  e.createSpellToken(p, 'Fireball', 1, e.homeRegion(p));
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });   // → end of turn
  const fires = tokensOf(h, p).filter(t => t.card === 'Fireball');
  assert.equal(fires.length, 3, 'the two originals plus the new one');
  assert.ok(fires.some(t => t.x === 3), 'X = 1 + 2 controlled tokens = 3 (R1: live at resolution)');
});

test('Harbinger of Immolation: [Augment] your spell tokens stay through regroup', { todo: true }, () => {
  // PARKED: startRegroup erases all spell tokens unconditionally — a
  // regroup-replacement hook does not exist.
});

// ── Hooba-Lin ────────────────────────────────────────────────────────────

test('Hooba-Lin: augmented host attacking creates a 1/1 in its formation column', () => {
  const h = new Harness(1214);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const host = spawn(h, p, 'Conduit of Pain');
  giveResources(h, p, 'fire', 2);                    // rr / 1
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Hooba-Lin'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'Hooba-Lin augments the host');
  toNextBattle(h, p);
  h.do({ type: 'declareAttack', seat: p, columns: [[host]] });
  pass(h); pass(h);                                  // resolve the attack trigger
  const col = h.state.battle!.columns[0]!;
  assert.equal(col.length, 2, 'the 1/1 joined my column');
  const tok = ent(h, col[1]!)!;
  assert.equal(tok.card, 'Unit Token');
  assert.ok(tok.token, 'a token');
  assert.deepEqual(effStats(h, tok.id), [1, 1]);
  finishBattle(h);
});

// ── Immolate ─────────────────────────────────────────────────────────────

test('Immolate: sacrifice a unit to draw a card', () => {
  const h = new Harness(1215);
  toDeployment(h);
  const A = h.state.initiative;
  const atk = spawn(h, A, 'Conduit of Pain');
  giveResources(h, A, 'fire', 1);                    // r / 1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Immolate') });
  pass(h); pass(h);                                  // resolve → choice
  const handBefore = h.state.players[A]!.hand.length;
  pick(h, atk);
  assert.ok(!ent(h, atk), 'unit sacrificed');
  assert.ok(h.state.players[A]!.bin.includes('Conduit of Pain'), 'sacrifice → bin');
  assert.ok(h.state.players[A]!.bin.includes('Immolate'), 'the spell → bin');
  assert.equal(h.state.players[A]!.hand.length, handBefore + 1, 'drew a card');
  finishBattle(h);
});

// ── Infernal Cultivator ──────────────────────────────────────────────────

test('Infernal Cultivator: [once] sacrifice X units → X Fireball 1; once per turn', () => {
  const h = new Harness(1216);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const cult = spawn(h, p, 'Infernal Cultivator');
  const f1 = spawn(h, p, 'Conduit of Pain');
  const f2 = spawn(h, p, 'Conduit of Pain');
  h.do({ type: 'activateAbility', seat: p, entityId: cult, abilityIndex: 0, via: 'augment' });
  pick(h, f1);                                       // first sacrifice
  pick(h, f2);                                       // second
  pick(h, false);                                    // Done → X = 2
  assert.ok(!ent(h, f1) && !ent(h, f2), 'both sacrificed');
  assert.equal(h.state.players[p]!.bin.filter(n => n === 'Conduit of Pain').length, 2);
  const fires = tokensOf(h, p).filter(t => t.card === 'Fireball');
  assert.equal(fires.length, 2, 'X Fireballs created');
  assert.ok(fires.every(t => t.x === 1), 'each is a Fireball 1');
  assert.ok(ent(h, cult), 'Cultivator itself was not picked');
  assert.throws(() => h.do({ type: 'activateAbility', seat: p, entityId: cult, abilityIndex: 0, via: 'augment' }),
    /already used/, '[once]: bounded per turn (R9)');
});

// ── Infernal Wispweaver ──────────────────────────────────────────────────

test('Infernal Wispweaver: [Augment] end of turn → create a Wisp', () => {
  const h = new Harness(1217);
  toDeployment(h);
  const p = h.state.initiative;
  spawn(h, p, 'Infernal Wispweaver');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });   // → end of turn
  const wisp = unitsOf(h, p).find(u => u.card === 'Wisp');
  assert.ok(wisp, 'a Wisp is created at end of turn');
  assert.ok(wisp!.token, 'the Wisp is a token');
  assert.deepEqual(effStats(h, wisp!.id), [0, 1]);
});

test('Infernal Wispweaver: wisps +2/+1 and skip their after-combat sacrifice', { todo: true }, () => {
  // PARKED: needs a stat aura layer plus suppression of another card's
  // trigger (the Wisp token's own after-combat self-sacrifice).
});
