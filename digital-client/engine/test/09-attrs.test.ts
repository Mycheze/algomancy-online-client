/* Per-card + per-attribute tests for the combat-attribute batch (batch-attrs):
 * Powerful, Vulnerable, Poisonous, Resonant, Thieving — each exercised over
 * combat damage, effect damage, and column sharing where it matters — plus the
 * cards that carry or make them (Chitin Shredder, Crumbling Ancient, Slink,
 * Resonant Form, Noxious Sporefiend, Biotoxicity, Geode, Accumulated
 * Nucleation, Poison, Crystal). Proposed rulings R23 (Vulnerable × Piercing)
 * and R24 (Thieving = one draw per connecting column) live in the report. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { EntityId, Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, handIdx, ownAttrs,
  pass, pick, spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

const drainStack = (h: Harness) => { while (h.state.stack.length) pass(h); };

/** deal effect damage from `sourceName` (whose printed attrs drive Powerful/
 * Poisonous/Resonant) to a unit, then settle any resulting triggers */
function dealEffect(h: Harness, controller: Seat, sourceName: string, targetId: EntityId, n: number): void {
  const g = new E(h.state);
  const target = g.entity(targetId)!;
  g.dealEffectDamage(
    { controller, sourceName, region: g.homeRegion(controller), targets: [], event: null,
      choose: () => { throw new Error('no choice expected'); } },
    target, n);
  g.settle();
}

// ─────────────────────────────── POWERFUL ───────────────────────────────

test('Powerful: Chitin Shredder deals double combat damage to a player', () => {
  const h = new Harness(401);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const chitin = spawn(h, A, 'Chitin Shredder');   // 1/2 Powerful
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[chitin]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, 28, '1 power doubled to 2 (not 1)');
  finishBattle(h);
});

test('Powerful: column-shares — a vanilla front doubles behind Chitin Shredder', () => {
  const h = new Harness(402);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const front = spawn(h, A, 'Rune Channeler');     // 4/3, no attrs
  const chitin = spawn(h, A, 'Chitin Shredder');   // 1/2 Powerful (back)
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[front, chitin]] });
  assert.ok(new E(h.state).effAttrs(ent(h, front)!).has('Powerful'),
    'the vanilla front is Powerful via column sharing');
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, 30 - (4 + 1) * 2, 'column power 5, doubled to 10');
  finishBattle(h);
});

test('Powerful: doubles effect damage from a Powerful source', () => {
  const h = new Harness(403);
  toDeployment(h);
  const A = h.state.initiative;
  const whale = spawn(h, A, 'Good Whale');         // 7/5
  dealEffect(h, A, 'Chitin Shredder', whale, 2);   // Chitin is Powerful → 4
  assert.equal(ent(h, whale)!.damage, 4, '2 effect damage doubled to 4');
});

test('Chitin Shredder: [Augment] donates Powerful to its host', () => {
  const h = new Harness(404);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const host = spawn(h, p, 'Rune Channeler');
  giveResources(h, p, 'earth', 2);
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Chitin Shredder'), hostId: host });
  assert.ok(ownAttrs(h, host).has('Powerful'), 'the host now has Powerful');
});

// ────────────────────────────── VULNERABLE ──────────────────────────────

test('Vulnerable: Crumbling Ancient marks double the combat damage it receives', () => {
  const h = new Harness(405);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const forager = spawn(h, A, 'Lonely Forager');   // 3/1
  const crumb = spawn(h, D, 'Crumbling Ancient');  // 3/8 Vulnerable
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[forager]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [crumb] } });
  pass(h); pass(h);
  assert.ok(ent(h, crumb), 'survives: marked 6 < 8 toughness');
  assert.equal(ent(h, crumb)!.damage, 6, '3 combat damage doubled to 6');
  finishBattle(h);
});

test('Vulnerable × Piercing (R23): the pre-double amount pierces through', () => {
  const h = new Harness(406);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const whale = spawn(h, A, 'Good Whale');         // 7/5 Piercing
  const crumb = spawn(h, D, 'Crumbling Ancient');  // 3/8 Vulnerable
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [crumb] } });
  pass(h); pass(h);
  assert.ok(!ent(h, crumb), 'Vulnerable made 4 pool (received 8) lethal on the 8-toughness blocker');
  assert.equal(h.state.players[D]!.life, 27, 'pre-double remainder 3 pierced through');
  assert.ok(ent(h, whale), 'the whale survived the 3 it took back');
  finishBattle(h);
});

test('Vulnerable: doubles effect damage received', () => {
  const h = new Harness(407);
  toDeployment(h);
  const A = h.state.initiative;
  const crumb = spawn(h, A, 'Crumbling Ancient');  // 3/8 Vulnerable
  dealEffect(h, A, 'Luminous Arc', crumb, 3);      // plain source → 3, doubled to 6
  assert.equal(ent(h, crumb)!.damage, 6, 'received doubled to 6');
  dealEffect(h, A, 'Luminous Arc', crumb, 1);      // +2 → 8 ≥ toughness
  assert.ok(!ent(h, crumb), 'a further 1 (doubled to 2) reaches lethal 8');
});

// ────────────────────────────── POISONOUS ───────────────────────────────

test('Poisonous: Noxious Sporefiend deals combat damage as permanent -1/-1 counters', () => {
  const h = new Harness(408);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const nox = spawn(h, A, 'Noxious Sporefiend');   // 2/2 Poisonous Swift
  const whale = spawn(h, D, 'Good Whale');         // 7/5
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[nox]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [whale] } });
  pass(h); pass(h);   // Swift: nox poisons in the swift sub-step, then dies to the whale
  assert.ok(!ent(h, nox), 'the 2/2 died to the whale in the normal sub-step');
  assert.equal(ent(h, whale)!.counters, -2, 'took 2 -1/-1 counters, not marked damage');
  assert.deepEqual(effStats(h, whale), [5, 3], 'now a 5/3');
  assert.equal(ent(h, whale)!.damage, 0, 'no marked damage — it was replaced');
  finishBattle(h);
  assert.equal(h.state.phase, 'deploy');
  assert.equal(ent(h, whale)!.counters, -2, 'counters are permanent: survive regroup');
  assert.equal(ent(h, whale)!.damage, 0, 'damage cleared at regroup');
});

test('Poisonous: effect damage becomes -1/-1 counters and can kill', () => {
  const h = new Harness(409);
  toDeployment(h);
  const A = h.state.initiative;
  const whale = spawn(h, A, 'Good Whale');         // 7/5
  dealEffect(h, A, 'Noxious Sporefiend', whale, 3);
  assert.equal(ent(h, whale)!.counters, -3, '3 damage → 3 -1/-1 counters');
  assert.equal(ent(h, whale)!.damage, 0, 'no marked damage');
  const curio = spawn(h, A, 'Curio Drifter');      // 2/2
  dealEffect(h, A, 'Noxious Sporefiend', curio, 2);
  assert.ok(!ent(h, curio), '2 counters → 0/0 → dies via the counters');
  assert.ok(h.state.players[A]!.bin.includes('Curio Drifter'), 'died to the bin (counter kill is a death)');
});

// ─────────────────────────────── RESONANT ───────────────────────────────

test('Resonant: Resonant Form combat damage to a unit also hits its controller', () => {
  const h = new Harness(410);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const res = spawn(h, A, 'Resonant Form');        // 2/4 Resonant
  const rune = spawn(h, D, 'Rune Channeler');      // 4/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[res]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [rune] } });
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, 28, 'the rider dealt the 2 to the blocker\'s controller');
  assert.equal(h.state.players[A]!.life, 30, 'no rider back onto the attacker');
  assert.ok(ent(h, rune), 'the blocker survived the marked 2');
  assert.ok(!ent(h, res), 'Resonant Form died to the 4 it took');
  finishBattle(h);
});

test('Resonant: effect damage riders onto the damaged unit\'s controller', () => {
  const h = new Harness(411);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const curio = spawn(h, D, 'Curio Drifter');      // 2/2 (D's unit)
  dealEffect(h, A, 'Resonant Form', curio, 1);
  assert.equal(ent(h, curio)!.damage, 1, 'unit took its 1');
  assert.equal(h.state.players[D]!.life, 29, 'the unit\'s controller also took 1');
});

// ─────────────────────────────── THIEVING ───────────────────────────────

test('Thieving: Slink draws when its column deals combat damage to a player (R24)', () => {
  const h = new Harness(412);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const slink = spawn(h, A, 'Slink');              // 2/3 Thieving
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[slink]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  const handBefore = h.state.players[A]!.hand.length;
  pass(h); pass(h);   // damage
  assert.equal(h.state.players[D]!.life, 28, 'unblocked for 2');
  assert.equal(h.state.players[A]!.hand.length, handBefore + 1, 'Thieving drew exactly one card');
  finishBattle(h);
});

// ───────────────────────── token & counter cards ────────────────────────

test('Biotoxicity: creates three Poison 1 spell tokens', () => {
  const h = new Harness(413);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'wood', 2);
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Biotoxicity') });
  const poisons = tokensOf(h, p).filter(t => t.card === 'Poison');
  assert.equal(poisons.length, 3, 'three Poison tokens');
  assert.ok(poisons.every(t => t.x === 1), 'each is a Poison 1');
});

test('Geode: spawn and die each create a Crystal 1 token', () => {
  const h = new Harness(414);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const geo = spawn(h, p, 'Geode');                // spawn trigger → Crystal 1
  assert.equal(tokensOf(h, p).filter(t => t.card === 'Crystal').length, 1, 'one on spawn');
  assert.equal(tokensOf(h, p).find(t => t.card === 'Crystal')!.x, 1, 'a Crystal 1');
  const e = new E(h.state);
  e.destroy(ent(h, geo)!, 'is deleted');
  e.settle();
  assert.equal(tokensOf(h, p).filter(t => t.card === 'Crystal').length, 2, 'a second on death');
});

test('Poison token: casts to put X -1/-1 counters on target unit', () => {
  const h = new Harness(415);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Ignis Sprite');
  const whale = spawn(h, D, 'Good Whale');         // 7/5 target
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const region = h.state.battle!.region;
  new E(h.state).createSpellToken(A, 'Poison', 3, region);
  h.do({ type: 'castSpellToken', seat: A, entityId: tokensOf(h, A).find(t => t.card === 'Poison')!.id });
  pick(h, { unit: whale });
  drainStack(h);
  assert.equal(ent(h, whale)!.counters, -3, 'Poison 3 → 3 -1/-1 counters');
  assert.deepEqual(effStats(h, whale), [4, 2], 'now a 4/2');
  finishBattle(h);
});

test('Crystal token: casts to put X +1/+1 counters on target unit', () => {
  const h = new Harness(416);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Ignis Sprite');         // 1/1 target for the buff
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const region = h.state.battle!.region;
  new E(h.state).createSpellToken(A, 'Crystal', 2, region);
  h.do({ type: 'castSpellToken', seat: A, entityId: tokensOf(h, A).find(t => t.card === 'Crystal')!.id });
  pick(h, { unit: atk });
  drainStack(h);
  assert.equal(ent(h, atk)!.counters, 2, 'Crystal 2 → 2 +1/+1 counters');
  finishBattle(h);
});

test('Accumulated Nucleation: +1/+1 counters equal to your earth affinity', () => {
  const h = new Harness(417);
  toDeployment(h);
  const A = h.state.initiative;
  const u = spawn(h, A, 'Ignis Sprite');
  toNextBattle(h, A);
  giveResources(h, A, 'earth', 3);                 // affinity 3
  give(h, A, 'Accumulated Nucleation');
  h.do({ type: 'declareAttack', seat: A, columns: [[u]] });
  h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Accumulated Nucleation') });
  pick(h, { unit: u });
  drainStack(h);
  assert.equal(ent(h, u)!.counters, 3, 'three +1/+1 counters (earth affinity 3)');
  finishBattle(h);
});
