/* Per-card tests (project rule: a test for every card). Cards whose whole
 * behavior is already pinned by the ported/rulings suites are noted there:
 *   Rune Channeler, Mischievous Reclaimer, Ephemeral Skywalker (03/04),
 *   Luminous Arc, Flame Juggle, Oracle of the Flame, Jelly, Leaping Lillik,
 *   Dreadwave Devourer, Good Whale, Astral Tidewraith, Arc Lightning,
 *   Accelerated Germination, Fireball (02-05). This file covers the rest. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  ent, finishBattle, give, giveResources, ownAttrs, pass, pick, spawn,
  toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

test('Ignis Sprite: death also makes a Fireball (spawn already covered)', () => {
  const h = new Harness(201);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const sprite = spawn(h, p, 'Ignis Sprite');       // spawn → Fireball #1
  assert.equal(tokensOf(h, p).length, 1);
  const e = new E(h.state);
  e.destroy(ent(h, sprite)!, 'is deleted');
  e.settle();
  assert.equal(tokensOf(h, p).length, 2, 'death → Fireball #2');
});

test('Flame of History: Reaping — killing a unit draws a card', () => {
  const h = new Harness(202);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sprite = spawn(h, A, 'Ignis Sprite');       // 1/1 victim
  giveResources(h, D, 'fire', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sprite]] });
  pass(h);
  const fh = give(h, D, 'Flame of History');
  h.do({ type: 'playCard', seat: D, handIndex: fh });
  pick(h, { unit: sprite });
  const handBefore = h.state.players[D]!.hand.length;
  pass(h); pass(h);
  assert.ok(!ent(h, sprite), '1 damage killed the 1/1');
  assert.equal(h.state.players[D]!.hand.length, handBefore + 1, 'Reaping drew a card');
});

test('All-Consuming Blaze: damage equals your fire affinity (expended counts, dormant does not)', () => {
  const h = new Harness(203);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const target = spawn(h, A, 'Good Whale');         // 7/5
  giveResources(h, D, 'fire', 2, 'open');
  giveResources(h, D, 'fire', 1, 'expended');       // affinity even while expended
  giveResources(h, D, 'fire', 1, 'dormant');        // no affinity
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[target]] });
  pass(h);
  const blaze = give(h, D, 'All-Consuming Blaze');
  h.do({ type: 'playCard', seat: D, handIndex: blaze });
  pick(h, { unit: target });
  pass(h); pass(h);
  // affinity: 2 open fire + 1 expended fire = 3 (dormant excluded, prismites give none)
  assert.ok(h.log.some(l => l.includes('deals 3 to Good Whale')),
    '2 open + 1 expended fire = 3; dormant and prismites excluded');
  assert.equal(ent(h, target)!.damage, 3, 'whale survives at 3');
});

test('Lonely Forager: draws on resolution, then spawns as a unit', () => {
  const h = new Harness(204);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'water', 3);
  const lf = give(h, p, 'Lonely Forager');
  const handBefore = h.state.players[p]!.hand.length - 1;   // minus the card itself
  h.do({ type: 'playCard', seat: p, handIndex: lf });
  assert.equal(h.state.players[p]!.hand.length, handBefore + 1, 'drew a card');
  assert.ok(unitsOf(h, p).some(u => u.card === 'Lonely Forager'), 'spawned as a 3/1');
});

test('Curio Drifter: Evasive requires two blockers', () => {
  const h = new Harness(205);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const drifter = spawn(h, A, 'Curio Drifter');
  const b1 = spawn(h, D, 'Rune Channeler');
  const b2 = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[drifter]] });
  pass(h); pass(h);
  const single = h.legal(D).some(a => a.type === 'declareBlocks' && Object.values(a.blocks).some(c => c.length === 1));
  assert.ok(!single, 'no single-blocker option offered against Evasive');
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [b1, b2] } });
  pass(h); pass(h);
  assert.ok(!ent(h, drifter), 'two blockers brought it down');
});

test('Bellowing Boulder: attack trigger nukes every unit in the region for 1', () => {
  const h = new Harness(206);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const boulder = spawn(h, A, 'Bellowing Boulder');   // 3/4
  const frail = spawn(h, D, 'Ignis Sprite');          // 1/1, in the defending region
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[boulder]] });
  // trigger is on the stack; resolve it
  pass(h); pass(h);
  assert.ok(!ent(h, frail), 'the 1/1 died to the region-wide ping');
  assert.equal(ent(h, boulder)!.damage, 1, 'Boulder pings itself too ("each unit")');
  // Ignis died → its own death trigger made a Fireball for D
  assert.equal(tokensOf(h, D).length, 1, 'death trigger chained');
});

test('Dune Drifter: virus augment grants Swift (type-line [Augment])', () => {
  const h = new Harness(207);
  toDeployment(h);
  const p = h.state.deployPlayer!, o = 1 - p;
  const target = spawn(h, o, 'Good Whale');
  toNextBattle(h, o);
  h.do({ type: 'declareAttack', seat: o, columns: [[target]] });
  pass(h);
  giveResources(h, p, 'earth', 2);   // Dune Drifter is ee / 1
  const dd = give(h, p, 'Dune Drifter');
  h.do({ type: 'augment', seat: p, from: 'hand', index: dd, hostId: target });
  pass(h); pass(h);   // resolve the virus
  assert.ok(ownAttrs(h, target).has('Swift'), 'host gained Swift from the type line');
});

test('Smouldering Inferno played as a unit sacrifices itself after combat', () => {
  const h = new Harness(208);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const inferno = spawn(h, A, 'Smouldering Inferno');   // 7/1 piercing
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[inferno]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);   // damage: 7 to the face
  assert.equal(h.state.players[D]!.life, 23);
  pass(h); pass(h);   // resolve its own after-combat sacrifice
  assert.ok(!ent(h, inferno), 'own [Augment] text is active when played normally');
  assert.ok(h.state.players[A]!.bin.includes('Smouldering Inferno'), 'unmodded: to the bin');
  finishBattle(h);
});
