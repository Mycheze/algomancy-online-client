/* Per-card tests for the mechanics-batch-2 pool (project rule: a test for
 * every card): stat layer 4 (Tough/Balanced, R19), Deadly (R21), Sneaky (R20),
 * Feeble, the planning haste step (R18), unit-token makers (Wisp/Robot), and
 * the Ambush battle mode (R22) — Orblish Horroth AND Good Whale's parked mode. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  effStats, ent, finishBattle, give, giveResources, handIdx, pass, pick,
  skipHasteStep, spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';
import type { Seat } from '../src/types.ts';

const passUntil = (h: Harness, seat: Seat) => { while (h.state.priority !== seat) pass(h); };
const drainStack = (h: Harness) => { while (h.state.stack.length) pass(h); };

test('Rampart Guardian: Tough doubles defense (layer 4), own and via augment', () => {
  const h = new Harness(301);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const guardian = spawn(h, p, 'Rampart Guardian');       // 0/4 Tough
  assert.deepEqual(effStats(h, guardian), [0, 8], 'own Tough: 0/4 → 0/8');
  const host = spawn(h, p, 'Lonely Forager');             // 3/1
  giveResources(h, p, 'earth', 3);
  const rg = give(h, p, 'Rampart Guardian');
  h.do({ type: 'augment', seat: p, from: 'hand', index: rg, hostId: host });
  assert.deepEqual(effStats(h, host), [3, 2], 'augmented Tough: 3/1 → 3/2');
});

test('Child of Aether: Balanced (power & defense = max) keeps a 2/0 alive', () => {
  const h = new Harness(302);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const child = spawn(h, p, 'Child of Aether');           // 2/0 Balanced
  assert.ok(ent(h, child), 'survives: layer 4 runs before the death check');
  assert.deepEqual(effStats(h, child), [2, 2], 'Balanced: 2/0 → 2/2');
});

test('R19: layer-4 application order — Tough→Balanced ≠ Balanced→Tough', () => {
  const h = new Harness(303);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'earth', 6);
  const host1 = spawn(h, p, 'Lonely Forager');            // 3/1
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Rampart Guardian'), hostId: host1 });
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Child of Aether'), hostId: host1 });
  assert.deepEqual(effStats(h, host1), [3, 3], 'Tough then Balanced: 3/1 → 3/2 → 3/3');
  const host2 = spawn(h, p, 'Lonely Forager');
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Child of Aether'), hostId: host2 });
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Rampart Guardian'), hostId: host2 });
  assert.deepEqual(effStats(h, host2), [3, 6], 'Balanced then Tough: 3/1 → 3/3 → 3/6');
});

test('Tidepool Terror: Deadly — 1 damage kills the 7/5 it blocks (R21)', () => {
  const h = new Harness(304);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const whale = spawn(h, A, 'Good Whale');                // 7/5 Piercing
  const terror = spawn(h, D, 'Tidepool Terror');          // 1/2 Deadly
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [terror] } });
  pass(h); pass(h);
  assert.ok(!ent(h, whale), 'Deadly: 1 damage killed the 7/5');
  assert.ok(!ent(h, terror), 'the blocker died to 2 of the 7');
  assert.equal(h.state.players[D]!.life, 25, 'Piercing overflow: 7 - 2 lethal = 5 through');
  finishBattle(h);
});

test('Whispering Mantid: Sneaky — unblockable only when attacking alone (R20)', () => {
  const h = new Harness(305);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const mantid = spawn(h, A, 'Whispering Mantid');        // 3/2 Sneaky
  const extra = spawn(h, A, 'Lonely Forager');
  const blocker = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mantid]] });
  pass(h); pass(h);
  assert.ok(
    !h.legal(D).some(a => a.type === 'declareBlocks' && Object.keys(a.blocks).length > 0),
    'no block options offered against a lone Sneaky attacker');
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } }),
    /Sneaky/, 'explicit block rejected');
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, 27, 'unblocked for 3');
  finishBattle(h);

  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mantid], [extra]] });
  pass(h); pass(h);
  assert.ok(
    h.legal(D).some(a => a.type === 'declareBlocks' && a.blocks[0]?.length),
    'not alone → the Sneaky column is blockable again');
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  finishBattle(h);
});

test('Molten Upheaval + the haste step: haste cards play between planning and battle (R18)', () => {
  const h = new Harness(306);
  toDeployment(h);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });   // → next turn's planning
  const p = h.state.initiative, o = 1 - p;
  giveResources(h, p, 'fire', 1);
  const mu = give(h, p, 'Molten Upheaval');
  assert.throws(() => h.do({ type: 'playCard', seat: p, handIndex: mu }),
    /haste/, 'not playable during the main planning step');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.equal(h.state.phase, 'planning');
  assert.ok(h.state.hasteDone, 'haste step engaged (p holds a payable haste card)');
  // R228: no seat is auto-done any more — a seat with nothing to play is
  // served `doneHaste` and nothing else, which is what a bluff looks like.
  assert.equal(h.state.hasteDone![o], false, 'the other seat is offered the step too (R228)');
  assert.deepEqual(h.legal(o).map(a => a.type), ['doneHaste'],
    'and is offered nothing but done');
  assert.ok(h.legal(p).some(a => a.type === 'playCard'), 'haste card offered');
  h.do({ type: 'playCard', seat: p, handIndex: handIdx(h, p, 'Molten Upheaval') });
  const toks = tokensOf(h, p);
  assert.equal(toks.length, 1, 'resolved immediately (planning is not interactive)');
  assert.equal(toks[0]!.x, 3, 'a Fireball 3');
  h.do({ type: 'doneHaste', seat: p });
  h.do({ type: 'doneHaste', seat: o });
  assert.equal(h.state.phase, 'battle', 'haste step ends into the battle phase');
});

test('the haste step opens even when nobody has a legal haste play (R228)', () => {
  // Was "skipped outright when nobody has a legal haste play (R18)". R224/R228
  // reversed it: `hasteDone` is served live and public, so a step that only
  // appeared when somebody COULD act broadcast the contents of a hidden hand.
  const h = new Harness(307);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  // turn 1: nobody can pay anything (two dormant Prismites each)
  assert.equal(h.state.phase, 'planning', 'the step still opens');
  assert.deepEqual(h.state.hasteDone, [false, false], 'and it opens for BOTH seats');
  for (const s of [0, 1] as const) {
    assert.deepEqual(h.legal(s).map(a => a.type), ['doneHaste'],
      `seat ${s} is offered done and nothing else`);
  }
  h.do({ type: 'doneHaste', seat: 0 });
  h.do({ type: 'doneHaste', seat: 1 });
  assert.equal(h.state.phase, 'battle', 'and it closes into the battle phase');
});

test('Awoken Tomb: dealt damage → X/X unit token, [once] per turn', () => {
  const h = new Harness(308);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const tomb = spawn(h, A, 'Awoken Tomb');                // 0/5, {Haste} timing
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tomb]] });
  const region = h.state.battle!.region;
  new E(h.state).createSpellToken(D, 'Fireball', 3, region);
  passUntil(h, D);
  h.do({ type: 'castSpellToken', seat: D, entityId: tokensOf(h, D)[0]!.id });
  pick(h, { unit: tomb });
  drainStack(h);   // fireball resolves (3 damage), then the Tomb trigger resolves
  const made = unitsOf(h, A).filter(u => u.card === 'Unit Token');
  assert.equal(made.length, 1, 'one token from the trigger');
  assert.deepEqual(effStats(h, made[0]!.id), [3, 3], 'X = the damage dealt (3)');
  assert.equal(ent(h, tomb)!.damage, 3, 'tomb survives at 3/5');
  // second damage the same turn: [once] budget is spent
  new E(h.state).createSpellToken(D, 'Fireball', 3, region);
  passUntil(h, D);
  h.do({ type: 'castSpellToken', seat: D, entityId: tokensOf(h, D)[0]!.id });
  pick(h, { unit: tomb });
  drainStack(h);
  assert.ok(!ent(h, tomb), '3+3 ≥ 5: the tomb died');
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Unit Token').length, 1,
    '[once]: no second token this turn');
  finishBattle(h);
});

test('Aberrant Populace: attack → two Wisps out of formation; Wisps sacrifice after combat', () => {
  const h = new Harness(309);
  toDeployment(h);
  const A = h.state.initiative;
  const pop = spawn(h, A, 'Aberrant Populace');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[pop]] });
  drainStack(h);   // the attacked-trigger resolves
  const wisps = unitsOf(h, A).filter(u => u.card === 'Wisp');
  assert.equal(wisps.length, 2, 'two Wisps created');
  assert.ok(wisps.every(w => !h.state.battle!.columns.flat().includes(w.id)),
    'they are not in formation');
  assert.ok(wisps.every(w => w.token), 'they are tokens');
  finishBattle(h);   // damage, then after combat: both Wisps sacrifice themselves
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Wisp').length, 0,
    'Wisps sacrificed themselves after combat');
});

test('Spectrogenesis: three Wisps; Feeble means they cannot block', () => {
  const h = new Harness(310);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const attacker = spawn(h, A, 'Lonely Forager');         // 3/1
  giveResources(h, D, 'fire', 1);
  const sg = give(h, D, 'Spectrogenesis');
  h.do({ type: 'doneDeploying', seat: A });
  h.do({ type: 'playCard', seat: D, handIndex: sg });
  const wisps = unitsOf(h, D).filter(u => u.card === 'Wisp');
  assert.equal(wisps.length, 3, 'three Wisps');
  assert.deepEqual(effStats(h, wisps[0]!.id), [0, 1]);
  h.do({ type: 'doneDeploying', seat: D });               // → next turn
  h.state.initiative = A;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  h.do({ type: 'declareAttack', seat: A, columns: [[attacker]] });
  pass(h); pass(h);
  assert.ok(
    !h.legal(D).some(a => a.type === 'declareBlocks' && Object.keys(a.blocks).length > 0),
    'Feeble: no block options at all');
  assert.throws(() => h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [wisps[0]!.id] } }),
    /Feeble/, 'explicit Wisp block rejected');
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  finishBattle(h);   // after combat in D's region: the Wisps sacrifice themselves
  assert.equal(unitsOf(h, D).filter(u => u.card === 'Wisp').length, 0);
});

test('Recyclable Sentinel: spawn → Robot 1; [Switch1] budget blocks the death trigger same turn', () => {
  const h = new Harness(311);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const sent = spawn(h, p, 'Recyclable Sentinel');        // spawn trigger → Robot 1
  let robots = unitsOf(h, p).filter(u => u.card === 'Robot');
  assert.equal(robots.length, 1, 'Robot created on spawn');
  assert.equal(robots[0]!.counters, 1, 'a Robot 1 = 0/0 with one +1/+1 counter');
  assert.deepEqual(effStats(h, robots[0]!.id), [1, 1]);
  const e = new E(h.state);
  e.destroy(ent(h, sent)!, 'is deleted');
  e.settle();
  robots = unitsOf(h, p).filter(u => u.card === 'Robot');
  assert.equal(robots.length, 1, 'died same turn: bounded budget already spent (R9)');
  // Robots are unit tokens: they persist through regroup, counters intact
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  toDeployment(h);   // next turn's regroup has run
  robots = unitsOf(h, p).filter(u => u.card === 'Robot');
  assert.equal(robots.length, 1, 'unit token survives regroup');
  assert.deepEqual(effStats(h, robots[0]!.id), [1, 1], 'counters are permanent');
});

test('Orblish Horroth: Ambush swaps into the blocker\'s formation slot (R22)', () => {
  const h = new Harness(312);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sprite = spawn(h, A, 'Ignis Sprite');
  const rc = spawn(h, D, 'Rune Channeler');
  giveResources(h, D, 'water', 5);
  give(h, D, 'Orblish Horroth');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sprite]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [rc] } });
  passUntil(h, D);
  assert.ok(h.legal(D).some(a => a.type === 'playCard' && a.mode === 'ambush'),
    'ambush play offered ([3bb] payable)');
  h.do({ type: 'playCard', seat: D, handIndex: handIdx(h, D, 'Orblish Horroth'), mode: 'ambush' });
  pick(h, { unit: rc });
  drainStack(h);
  assert.ok(!ent(h, rc), 'Rune Channeler left play');
  assert.ok(h.state.players[D]!.hand.includes('Rune Channeler'), 'recalled to hand');
  const orb = unitsOf(h, D).find(u => u.card === 'Orblish Horroth');
  assert.ok(orb, 'the ambusher is in play');
  assert.equal(h.state.battle!.blocks[0]![0], orb!.id, 'it took the exact blocking slot');
  assert.equal(h.state.players[D]!.resources.filter(r => r.state === 'expended').length, 3,
    'paid the ambush cost (3), not the card cost (4)');
  finishBattle(h);
});

test('Ambush fizzles when the target is removed — the ambusher is binned (R22)', () => {
  const h = new Harness(313);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sprite = spawn(h, A, 'Ignis Sprite');             // + a Fireball 1 token for A
  const victim = spawn(h, D, 'Unit Token');               // trigger-free 1/1 ally for D
  giveResources(h, D, 'water', 5);
  give(h, D, 'Orblish Horroth');
  toNextBattle(h, A);
  const fb = tokensOf(h, A)[0]!;
  h.do({ type: 'declareAttack', seat: A, columns: [[sprite]], spellTokens: [fb.id] });
  passUntil(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: handIdx(h, D, 'Orblish Horroth'), mode: 'ambush' });
  pick(h, { unit: victim });
  // A responds: Fireball 1 kills the ambush target
  h.do({ type: 'castSpellToken', seat: A, entityId: fb.id });
  pick(h, { unit: victim });
  drainStack(h);
  assert.ok(!ent(h, victim), 'the target died in response');
  assert.ok(!unitsOf(h, D).some(u => u.card === 'Orblish Horroth'), 'the ambusher never spawned');
  assert.ok(h.state.players[D]!.bin.includes('Orblish Horroth'), 'it went to the bin — lost both');
  finishBattle(h);
});

test('Good Whale: the parked Ambush mode works ([4bb], into the attacking column)', () => {
  const h = new Harness(314);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sprite = spawn(h, A, 'Ignis Sprite');
  giveResources(h, A, 'water', 6);
  give(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sprite]] });
  // initiative acts first in the attack window — A ambushes its own attacker
  assert.ok(h.legal(A).some(a => a.type === 'playCard' && a.mode === 'ambush'));
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Good Whale'), mode: 'ambush' });
  pick(h, { unit: sprite });
  drainStack(h);
  const whale = unitsOf(h, A).find(u => u.card === 'Good Whale');
  assert.ok(whale, 'whale in play');
  assert.equal(h.state.battle!.columns[0]![0], whale!.id, 'it attacks from the sprite\'s slot');
  assert.ok(h.state.players[A]!.hand.includes('Ignis Sprite'), 'sprite recalled to hand');
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, 23, 'the swapped-in whale dealt its 7');
  finishBattle(h);
});
