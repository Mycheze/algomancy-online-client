/* Per-card tests for the water/metal batch (project rule: a test for every
 * card). Seeds 501-549. States are built explicitly with give()/spawn()/
 * giveResources() — never asserting on shuffled hand/deck contents, since
 * concurrent card registrations shift the seeded shuffle. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, pick,
  spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';

test('Ambling Mountaintop: {Sluggish} 4/5, and the type-line [Augment] donates Sluggish', () => {
  const h = new Harness(501);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const amb = spawn(h, p, 'Ambling Mountaintop');            // 4/5 Sluggish
  assert.ok(ownAttrs(h, amb).has('Sluggish'), 'own {Sluggish} live when played normally');
  assert.deepEqual(effStats(h, amb), [4, 5]);
  // augment a host: type-line [Augment] grants {Sluggish}
  const host = spawn(h, p, 'Lonely Forager');               // 3/1
  giveResources(h, p, 'earth', 2);                          // cost ee/2
  const idx = give(h, p, 'Ambling Mountaintop');
  h.do({ type: 'augment', seat: p, from: 'hand', index: idx, hostId: host });
  assert.ok(ownAttrs(h, host).has('Sluggish'), 'host gained {Sluggish} from the type line');
});

test('Bloated Manablub: dying in battle → each opponent loses 3 life (region-scoped)', () => {
  const h = new Harness(502);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const blub = spawn(h, A, 'Bloated Manablub');             // 2/1, A's attacker
  const wall = spawn(h, D, 'Good Whale');                   // 7/5 blocker
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[blub]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [wall] } });
  pass(h); pass(h);                                         // combat: the 2/1 dies to the 7
  assert.ok(!ent(h, blub), 'Manablub died in combat');
  // its despawn/die trigger is on the stack (battle); resolve it
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, 27, 'opponent (D) present in the region lost 3');
  finishBattle(h);
});

test('Boreal Wanderer: another ally spawning during battle → 2 damage to each opponent [Switch1]', () => {
  const h = new Harness(503);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const bw = spawn(h, A, 'Boreal Wanderer');                // present before battle
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bw]] }); // bw enters the battle region
  const region = h.state.battle!.region;
  // an ally spawns during battle in the same region → Boreal triggers
  const e = new E(h.state);
  e.spawnUnit(A, 'Unit Token', region);
  e.settle();                                                // trigger pushed to the stack
  pass(h); pass(h);                                          // resolve it → 2 to D
  assert.equal(h.state.players[D]!.life, 28, 'each opponent took 2');
  // [Switch1]: a second ally spawn the same turn does nothing more
  const e2 = new E(h.state);
  e2.spawnUnit(A, 'Unit Token', region);
  e2.settle();
  assert.equal(h.state.stack.length, 0, 'bounded budget spent — no second trigger');
  assert.equal(h.state.players[D]!.life, 28);
  finishBattle(h);
});

test('A Pile of Rubbish: played normally, dying draws a card (own [Augment] text is live)', () => {
  // NOTE: the augment-DONATION of this "when I die" text does NOT fire in the
  // current engine — destroy() erases the host's mods BEFORE firing the 'died'
  // event, so the donated augmentText trigger is gone by scan time. See the ⚠
  // engine finding in the batch report. The played-normally path (a card's own
  // [Augment] text is live in play, Manual Q&A) works and is tested here.
  const h = new Harness(504);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const rub = spawn(h, p, 'A Pile of Rubbish');             // 1/1, own [Augment] text active
  const before = h.state.players[p]!.hand.length;
  const e = new E(h.state);
  e.destroy(ent(h, rub)!, 'is deleted');
  e.settle();
  assert.ok(!ent(h, rub), 'left play');
  assert.equal(h.state.players[p]!.hand.length, before + 1, 'its own [Augment] text drew a card');
});

test('Astralith: [three] activated ability puts a +1/+1 counter on a target unit', () => {
  const h = new Harness(505);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const astra = spawn(h, p, 'Astralith');                   // 2/3
  const target = spawn(h, p, 'Lonely Forager');             // 3/1
  giveResources(h, p, 'metal', 3);                          // activation costs 3 mana
  // the ability is declared ONCE, in augmentText — a card's own [Augment] text
  // is live when it is played normally (Manual Q&A), so it is offered as
  // via: 'augment'. It used to be declared in `abilities` as well, which made
  // legalActions offer the very same ability twice.
  const offers = h.legal(p).filter(a =>
    a.type === 'activateAbility' && a.entityId === astra);
  assert.equal(offers.length, 1, 'offered exactly once, not once per list');
  assert.equal(offers[0]!.type === 'activateAbility' && offers[0]!.via, 'augment');
  h.do({ type: 'activateAbility', seat: p, entityId: astra, abilityIndex: 0, via: 'augment' });
  pick(h, { unit: target });
  assert.equal(ent(h, target)!.counters, 1, 'a +1/+1 counter landed');
  assert.deepEqual(effStats(h, target), [4, 2], '3/1 → 4/2');
  assert.equal(h.state.players[p]!.resources.filter(r => r.state === 'expended').length, 3, 'paid 3 mana');
});

test('Construct Overseer: after combat → a Robot 1 (0/0 + one counter), unbounded [Switch]', () => {
  const h = new Harness(506);
  toDeployment(h);
  const A = h.state.initiative;
  const overseer = spawn(h, A, 'Construct Overseer');       // 2/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[overseer]] }); // into the battle region
  finishBattle(h);                                          // combat, then after-combat trigger
  const robots = unitsOf(h, A).filter(u => u.card === 'Robot');
  assert.equal(robots.length, 1, 'one Robot from the after-combat trigger');
  assert.equal(robots[0]!.counters, 1, 'Robot 1 = one +1/+1 counter');
  assert.deepEqual(effStats(h, robots[0]!.id), [1, 1]);
});

test('Channeled Amalgam: [once] — playing a nontoken spell puts X = its cost in counters', () => {
  const h = new Harness(507);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const amalgam = spawn(h, p, 'Channeled Amalgam');         // 1/1
  giveResources(h, p, 'fire', 2);
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Flame Juggle') }); // r/2 nontoken spell
  assert.equal(ent(h, amalgam)!.counters, 2, 'X = Flame Juggle mana (2)');
  assert.deepEqual(effStats(h, amalgam), [3, 3]);
  // [once]: a second nontoken spell the same turn adds nothing
  giveResources(h, p, 'fire', 2);
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Flame Juggle') });
  assert.equal(ent(h, amalgam)!.counters, 2, '[once] budget spent this turn');
});

test('Arcane Concentrator: [once] — playing a nontoken spell creates an X/X unit', () => {
  const h = new Harness(508);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const conc = spawn(h, p, 'Arcane Concentrator');          // 3/2
  giveResources(h, p, 'fire', 2);
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Flame Juggle') }); // mana 2
  let tokens = unitsOf(h, p).filter(u => u.card === 'Unit Token');
  assert.equal(tokens.length, 1, 'one X/X unit created');
  assert.deepEqual(effStats(h, tokens[0]!.id), [2, 2], 'X = the spell cost (2)');
  // [once]: no second token the same turn
  giveResources(h, p, 'fire', 2);
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Flame Juggle') });
  tokens = unitsOf(h, p).filter(u => u.card === 'Unit Token');
  assert.equal(tokens.length, 1, '[once] budget spent');
  void conc;
});

test('Adversary of the Deep: {Sluggish}, and life loss adds that many +1/+1 counters', () => {
  const h = new Harness(509);
  toDeployment(h);
  const p = h.state.deployPlayer!, o = 1 - p;
  const adv = spawn(h, p, 'Adversary of the Deep');         // 2/2 {Sluggish}
  assert.ok(ownAttrs(h, adv).has('Sluggish'), '{Sluggish} is a printed attr, not an augment grant');
  assert.deepEqual(effStats(h, adv), [2, 2]);
  const e = new E(h.state);
  e.loseLife(o, 3, 'test');                                 // any player losing life counts
  e.settle();
  assert.equal(ent(h, adv)!.counters, 3, 'grew by the amount of life lost');
  assert.deepEqual(effStats(h, adv), [5, 5]);
});

test('A Pile of Rubbish: donated "[Augment] when I die" text fires on the host (post-fix)', () => {
  const h = new Harness(510);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const host = spawn(h, p, 'Lonely Forager');               // 3/1 host
  giveResources(h, p, 'metal', 2);                          // Rubbish is m/2
  const idx = give(h, p, 'A Pile of Rubbish');
  h.do({ type: 'augment', seat: p, from: 'hand', index: idx, hostId: host });
  const handBefore = h.state.players[p]!.hand.length;
  const e = new E(h.state);
  e.destroy(ent(h, host)!, 'is deleted');
  e.settle();
  assert.ok(!ent(h, host), 'host (Unstable) died — erased with its mod');
  assert.equal(h.state.players[p]!.hand.length, handBefore + 1,
    'the donated died-trigger drew a card (mods scanned before erasure)');
});

test('Astralith: donated "[Augment] [three]: +1/+1 counter" is activatable on the host (post-fix)', () => {
  const h = new Harness(511);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const host = spawn(h, p, 'Lonely Forager');               // 3/1 host
  giveResources(h, p, 'metal', 1);                          // Astralith is m/1
  const idx = give(h, p, 'Astralith');
  h.do({ type: 'augment', seat: p, from: 'hand', index: idx, hostId: host });
  giveResources(h, p, 'metal', 3);                          // the [three] activation cost
  const modId = ent(h, host)!.mods[0]!;
  const offered = h.legal(p).some(a =>
    a.type === 'activateAbility' && a.entityId === host
    && typeof a.via === 'object' && 'mod' in a.via && a.via.mod === modId);
  assert.ok(offered, 'donated activated ability is offered by legalActions');
  h.do({ type: 'activateAbility', seat: p, entityId: host, abilityIndex: 0, via: { mod: modId } });
  pick(h, { unit: host });                                  // target: the host itself
  assert.equal(ent(h, host)!.counters, 1, 'the donated ability put a +1/+1 counter');
  assert.deepEqual(effStats(h, host), [4, 2]);
});
