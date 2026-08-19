/* Per-card tests for batch-earth-a (project rule: a test for every card).
 * Covers the Rockfall death graft (A Fast Pile of Rocks, R25 per-seat picks),
 * the counters-as-permanent-buff approximation (Aetherflux Golem), the two
 * fight effects (Battle / Fight — cast-time first target + mid-resolution
 * second pick), type-line and text-box augments (Bubb, Deathglow Strider,
 * Lithoghul), activated abilities living in [Augment] text (Enigmatic
 * Warder, Graxxlid — via: 'augment'), the column-combat-damage trigger
 * (Flowstone Arcanite, both the lifeLost and unit-damage channels), a
 * region-wide sweep (Haboob), the pay-to-fight damage trigger (Eminence of
 * the Barrens, R6 payment), and the parked cards (Crevice Lurker, Hooba-Lan,
 * Earth Resource). States are built explicitly (give/spawn/giveResources).
 * Seeds 1600-1699. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { getCard } from '../src/cards/dsl.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, pick,
  spawn, toDeployment, toNextBattle,
} from './util.ts';

test('A Fast Pile of Rocks: dies in combat → Rockfall 4 (each present player picks a unit; 4 damage each)', () => {
  const h = new Harness(1600);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const pile = spawn(h, A, 'A Fast Pile of Rocks');   // 2/1 haste body
  const bubbA = spawn(h, A, 'Bubb');                  // 5/6 — A's only other unit in region
  const blocker = spawn(h, D, 'Unit Token');          // 1/1 — trades with the pile
  const bubbD = spawn(h, D, 'Bubb');                  // 5/6
  const tokD = spawn(h, D, 'Unit Token');             // second D unit → D gets a real choice
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[pile], [bubbA]] });
  pass(h); pass(h);                                   // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  pass(h); pass(h);   // combat: pile & blocker trade → Rockfall resolves at once: A auto-picks…
  assert.ok(!ent(h, pile) && !ent(h, blocker), 'pile and its blocker died in combat');
  pick(h, ent(h, bubbD)!.id);                         // …D chooses Bubb over the token
  assert.equal(ent(h, bubbA)!.damage, 4, "A's auto-picked unit took 4");
  assert.equal(ent(h, bubbD)!.damage, 4, "D's chosen unit took 4");
  assert.equal(ent(h, tokD)!.damage, 0, 'the unchosen unit is untouched');
  assert.ok(h.state.players[A]!.bin.includes('A Fast Pile of Rocks'), 'the pile went to the bin');
  finishBattle(h);
});

test('Aetherflux Golem: +2/+2 for itself when played normally; +2/+2 to the host when augmenting', () => {
  const h = new Harness(1601);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const golem = spawn(h, p, 'Aetherflux Golem');
  assert.deepEqual(effStats(h, golem), [3, 3], "1/1 + its own [Augment] text's +2/+2 = 3/3");
  const host = spawn(h, p, 'Unit Token');             // vanilla 1/1
  giveResources(h, p, 'earth', 2);                    // ee / 1
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Aetherflux Golem'), hostId: host });
  assert.deepEqual(effStats(h, host), [3, 3], 'host 1/1 + donated +2/+2 = 3/3');
  assert.equal(ent(h, host)!.counters, 2, 'modelled as two +1/+1 counters (approximation)');
  assert.deepEqual(effStats(h, golem), [3, 3], 'the in-play Golem did not double-fire on the attach');
});

test('Battle: two target units fight (mutual power damage; both targets at cast)', () => {
  const h = new Harness(1602);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');              // 1/1 attacker
  const bubbD = spawn(h, D, 'Bubb');                  // 5/6 defender-side unit
  giveResources(h, D, 'earth', 4);                    // ee / 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                            // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Battle') });
  pick(h, { unit: atk });                             // first target (at cast)
  pick(h, { unit: bubbD });                           // second target (at cast — count: 2)
  pass(h); pass(h);                                   // resolve
  assert.ok(!ent(h, atk), "the 1/1 died to Bubb's 5 power");
  assert.equal(ent(h, bubbD)!.damage, 1, "Bubb took the 1/1's 1 power back");
  finishBattle(h);
});

test('Bubb: 5/6 Unaware; type-line [Augment] donates Unaware (attrs only, no stats)', () => {
  const h = new Harness(1603);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const bubb = spawn(h, p, 'Bubb');
  assert.deepEqual(effStats(h, bubb), [5, 6], '5/6');
  assert.ok(ownAttrs(h, bubb).has('Unaware'), 'played normally: has Unaware');
  const host = spawn(h, p, 'Unit Token');
  giveResources(h, p, 'earth', 4);                    // e / 4
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Bubb'), hostId: host });
  assert.ok(ownAttrs(h, host).has('Unaware'), 'type-line [Augment] donates Unaware');
  assert.deepEqual(effStats(h, host), [1, 1], 'attr-only donation: stats unchanged');
});

test('Crevice Lurker: 2/3 body, augments crash-free (ability-cost tax PARKED)', { todo: true }, () => {
  const h = new Harness(1604);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const cl = spawn(h, p, 'Crevice Lurker');
  assert.deepEqual(effStats(h, cl), [2, 3], '2/3 body');
  const host = spawn(h, p, 'Unit Token');
  giveResources(h, p, 'earth', 2);                    // ee / 2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Crevice Lurker'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'recognised as an augment, attaches cleanly');
  // TODO(parked): "abilities cost [one] more to activate or trigger during
  // battle" needs an ability-cost taxation / pay-to-trigger hook.
});

test('Deathglow Strider: after combat, deals its defense to each opponent', () => {
  const h = new Harness(1605);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const strider = spawn(h, A, 'Deathglow Strider');   // 2/3
  toNextBattle(h, A);
  const lifeD = h.state.players[D]!.life;
  const lifeA = h.state.players[A]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[strider]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, lifeD - 5, '2 combat (unblocked) + 3 (my defense) after combat');
  assert.equal(h.state.players[A]!.life, lifeA, 'controller untouched ("each opponent")');
});

test('Earth Resource: registered printed-data-only (resource face, not a deck card)', () => {
  const c = getCard('Earth Resource');
  assert.equal(c.mana, 0);
  assert.deepEqual([c.power, c.toughness], [2, 0]);
  assert.match(c.type, /Earth Resource/);
});

test('Eminence of the Barrens: dealt damage → may pay [one] to fight another target unit (R6)', () => {
  const h = new Harness(1607);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const tok = spawn(h, A, 'Unit Token');              // 1/1 — pokes the Eminence
  const bubbA = spawn(h, A, 'Bubb');                  // 5/6 — the fight victim
  const emin = spawn(h, D, 'Eminence of the Barrens');// 6/8
  giveResources(h, D, 'earth', 1);                    // the [one]
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok], [bubbA]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [emin] } });
  pass(h); pass(h);   // combat: tok deals 1 to Eminence → trigger resolves at once
  pick(h, { unit: bubbA });                           // trigger target: "another target unit"
  pick(h, true);                                      // pay [one] → the fight happens
  assert.ok(!ent(h, bubbA), 'Bubb died to the 6-power fight');
  assert.equal(ent(h, emin)!.damage, 6, '1 combat + 5 from the fight');
  assert.equal(h.state.players[D]!.resources.filter(r => r.state === 'expended').length, 1, 'the [one] was paid');
  // "whenever": the fight's 5 damage re-triggered the ability — the only
  // remaining unit is the Eminence itself, so it resolves as a no-op
  pick(h, { unit: emin });
  assert.ok(h.log.some(m => m.includes('cannot fight myself')), 'self-target no-op ("another target unit")');
  finishBattle(h);
});

test("Enigmatic Warder: [two] activated ([Augment] text, via: 'augment') redirects a spell target to itself", () => {
  const h = new Harness(1608);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');              // 1/1 — the Boon's intended target
  const warder = spawn(h, D, 'Enigmatic Warder');     // 1/2
  giveResources(h, A, 'fire', 2);                     // Channeled Boon rr/2
  giveResources(h, D, 'earth', 2);                    // the [two]
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: atk });
  const boonId = h.state.stack[0]!.id;
  h.do({ type: 'activateAbility', seat: D, entityId: warder, abilityIndex: 0, via: 'augment' });
  pick(h, { stack: boonId });
  pass(h); pass(h);                                   // Warder resolves: the Boon now targets it
  pass(h); pass(h);                                   // Boon resolves on the new target
  assert.deepEqual(effStats(h, warder), [5, 6], 'the Warder stole the +4/+4');
  assert.deepEqual(effStats(h, atk), [1, 1], 'the original target got nothing');
  finishBattle(h);
});

test('Fight: BOTH units are cast-time targets, ally first (R58)', () => {
  const h = new Harness(1609);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');              // 1/1 attacker
  const bubbD = spawn(h, D, 'Bubb');                  // 5/6 — the ally
  giveResources(h, D, 'earth', 1);                    // e / 1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Fight') });
  // slot 0 is 'allyUnit' — only D's own units are offered
  assert.deepEqual(h.state.decision!.options.map(o => o.value), [{ unit: bubbD }],
    'the ally slot offers allies of the CASTER only');
  pick(h, { unit: bubbD });
  // slot 1 is 'unit' — any OTHER unit in the region, so the attacker appears
  assert.deepEqual(h.state.decision!.options.map(o => o.value), [{ unit: atk }],
    'the second slot offers the other units, and never the ally again');
  pick(h, { unit: atk });
  pass(h); pass(h);                                   // resolve
  assert.ok(!ent(h, atk), 'the 1/1 died to Bubb');
  assert.equal(ent(h, bubbD)!.damage, 1, 'Bubb took 1 back');
  finishBattle(h);
});

test('Flowstone Arcanite: column deals combat damage → +1/+1 counter on each of your units (once/turn)', () => {
  // unblocked: connects to the player (the lifeLost channel); the ally's
  // later hit does NOT double-fire ([Switch1] budget, R9)
  const h = new Harness(1610);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const flow = spawn(h, A, 'Flowstone Arcanite');     // 1/3 {Swift}
  const tok = spawn(h, A, 'Unit Token');              // 1/1 ally attacker
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[flow], [tok]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  finishBattle(h);
  assert.equal(ent(h, flow)!.counters, 1, 'Flowstone got exactly one counter (bounded)');
  assert.equal(ent(h, tok)!.counters, 1, 'each of your units, ally included');

  // blocked: combat damage to a unit (the damage channel)
  const h2 = new Harness(1620);
  toDeployment(h2);
  const A2 = h2.state.initiative, D2 = 1 - A2;
  const flow2 = spawn(h2, A2, 'Flowstone Arcanite');
  const blk = spawn(h2, D2, 'Unit Token');            // 1/1 blocker
  toNextBattle(h2, A2);
  h2.do({ type: 'declareAttack', seat: A2, columns: [[flow2]] });
  pass(h2); pass(h2);
  h2.do({ type: 'declareBlocks', seat: D2, blocks: { 0: [blk] } });
  finishBattle(h2);
  assert.ok(!ent(h2, blk), 'the blocker died to the Swift hit');
  assert.equal(ent(h2, flow2)!.counters, 1, 'damage to the blocker triggered the counter');
});

test('Graxxlid: [once][one] negates an effect targeting it; that controller draws; once per turn', () => {
  const h = new Harness(1611);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const grax = spawn(h, D, 'Graxxlid');               // 2/3
  giveResources(h, A, 'fire', 2);                     // Channeled Boon rr/2
  giveResources(h, D, 'earth', 2);                    // [one] with one to spare
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: grax });                            // the Boon targets Graxxlid
  const boonId = h.state.stack[0]!.id;
  const handA = h.state.players[A]!.hand.length;
  h.do({ type: 'activateAbility', seat: D, entityId: grax, abilityIndex: 0, via: 'augment' });
  pick(h, { stack: boonId });
  pass(h); pass(h);                                   // Graxxlid resolves
  assert.ok(h.state.stack.find(i => i.id === boonId)!.negated, 'the Boon is negated');
  assert.equal(h.state.players[A]!.hand.length, handA + 1, "the Boon's controller drew a card");
  pass(h); pass(h);                                   // the negated Boon resolves → bin
  assert.deepEqual(effStats(h, grax), [2, 3], 'no buff landed');
  pass(h);                                            // priority → D
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: D, entityId: grax, abilityIndex: 0, via: 'augment' }),
    /already used/, '[once]: spent for the turn (R9)');
  finishBattle(h);
});

test('Haboob: deals 1 damage to each unit in the battle region (both sides)', () => {
  const h = new Harness(1612);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');              // 1/1 — dies to the sweep
  const bubbD = spawn(h, D, 'Bubb');                  // 5/6 — takes 1
  giveResources(h, D, 'earth', 4);                    // ee / 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Haboob') });
  pass(h); pass(h);                                   // resolve
  assert.ok(!ent(h, atk), "the caster's own sweep killed the 1/1 attacker");
  assert.equal(ent(h, bubbD)!.damage, 1, "the caster's Bubb was hit too (each unit)");
  finishBattle(h);
});

test('Hooba-Lan: attacking creates a real dormant Shard for its controller', () => {
  // Was TODO while there was no Shard primitive; E.createShard exists now, so
  // the payload is live. The Shard is dormant and gives mana only — see
  // 48-playtest-hotfix for what separates it from a prismite.
  const h = new Harness(1613);
  toDeployment(h);
  const A = h.state.initiative;
  const hooba = spawn(h, A, 'Hooba-Lan');             // 3/4
  const before = h.state.players[A]!.resources.length;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[hooba]] });
  pass(h); pass(h);                                   // resolve the trigger
  const made = h.state.players[A]!.resources.slice(before);
  assert.equal(made.length, 1, 'exactly one Shard per attack');
  assert.equal(made[0]!.kind, 'shard');
  assert.equal(made[0]!.state, 'dormant', 'printed "(It will spawn dormant.)"');
  finishBattle(h);
});

test('Lithoghul: dealt damage → deals that much damage to its controller', () => {
  const h = new Harness(1614);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');              // 1/1
  const lith = spawn(h, D, 'Lithoghul');              // 4/4
  toNextBattle(h, A);
  const lifeD = h.state.players[D]!.life;
  const lifeA = h.state.players[A]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [lith] } });
  pass(h); pass(h);   // combat → trigger resolves at once (R3 sub-step drain)
  assert.ok(!ent(h, atk), 'the attacker died to the 4-power block');
  assert.equal(ent(h, lith)!.damage, 1, 'Lithoghul took 1 combat damage (pre-regroup)');
  assert.equal(h.state.players[D]!.life, lifeD - 1, 'its controller took the mirrored 1');
  assert.equal(h.state.players[A]!.life, lifeA, 'the attacker took nothing (blocked)');
  finishBattle(h);
});
