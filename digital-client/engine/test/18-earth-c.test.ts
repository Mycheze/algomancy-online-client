/* Per-card tests for batch-earth-c (project rule: a test for every card).
 * States are built explicitly (spawn/give/giveResources, direct bin setup) so
 * parallel card registration can't shift assertions. Seeds: 1800-1899.
 *
 * Live statics: Sandstone Defender (+0/+2 to its controller's other units)
 * and Towering Colossus (+2/+2 to enemies in its region) — their
 * augment-DONATED forms stay parked (mod-carried statics don't exist).
 * PARKED (todo tests state exactly what's missing): Tranquility (static
 * cost modifiers).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick,
  spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';

/** answer a mid-resolution (payOrDecline/electricPath) decision by label match */
function decide(h: Harness, match: (label: string, value: unknown) => boolean): void {
  const dec = h.state.decision!;
  const idx = dec.options.findIndex(o => match(o.label, o.value));
  assert.notEqual(idx, -1, `no option matching in [${dec.options.map(o => o.label)}]`);
  h.do({ type: 'decide', seat: dec.seat, choice: idx });
}

test('Roving Quillback: after the blocking step, 1 damage per blocked column to each opponent (R13 sticky blocks, R25)', () => {
  const h = new Harness(1800);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const quill = spawn(h, A, 'Roving Quillback');        // [Augment] text live when played normally
  const tok = spawn(h, A, 'Unit Token');                // 1/1 second attacker
  const blocker = spawn(h, D, 'Curio Drifter');         // 2/2 blocker
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[quill], [tok]] });
  pass(h); pass(h);                                     // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [blocker] } });
  pass(h); pass(h);                                     // resolve the blocksDeclared trigger
  assert.equal(h.state.players[D]!.life, 29, '1 blocked column → 1 damage to the opponent');
  assert.equal(h.state.players[A]!.life, 30, 'the controller is not an opponent');
  finishBattle(h);                                      // combat: quill unblocked deals 1 more
  assert.equal(h.state.players[D]!.life, 28);
});

test('Ruinbringer: [Augment] after combat, delete ALL units in the region (both sides, itself included)', () => {
  const h = new Harness(1801);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const ruin = spawn(h, A, 'Ruinbringer');              // 8/9 Piercing; augment text live normally
  const bystander = spawn(h, D, 'Curio Drifter');       // not even blocking — deleted anyway
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ruin]] });
  pass(h); pass(h);                                     // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  finishBattle(h);                                      // combat (D takes 8), afterCombat trigger
  assert.equal(h.state.players[D]!.life, 22, 'unblocked 8 combat damage first');
  assert.ok(!ent(h, ruin) && !ent(h, bystander), 'every unit in the region was deleted');
  assert.ok(h.state.players[A]!.bin.includes('Ruinbringer'), "Ruinbringer → its owner's bin");
  assert.ok(h.state.players[D]!.bin.includes('Curio Drifter'), "bystander → its owner's bin");
});

test('Sandstone Defender: 0/3 body; the augment applies crash-free (donated static PARKED, adds nothing)', () => {
  const h = new Harness(1802);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const sd = spawn(h, p, 'Sandstone Defender');
  assert.deepEqual(effStats(h, sd), [0, 3], '0/3');
  const host = spawn(h, p, 'Unit Token');               // vanilla 1/1
  assert.deepEqual(effStats(h, host), [1, 3], 'the IN-PLAY unit already grants it +0/+2');
  giveResources(h, p, 'earth', 3);                      // e / 2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Sandstone Defender'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'the augment attached');
  assert.deepEqual(effStats(h, host), [1, 3],
    'PARKED: the augment-DONATED static needs mod-carried statics — the mod itself adds nothing');
});

test('Sandstone Defender: "Your other units gain +0/+2" — a live static on allies, never itself', () => {
  const h = new Harness(1816);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const sd = spawn(h, A, 'Sandstone Defender');
  assert.deepEqual(effStats(h, sd), [0, 3], '"OTHER units" — never itself');
  const ally = spawn(h, A, 'Unit Token');
  assert.deepEqual(effStats(h, ally), [1, 3], 'an allied 1/1 is a live 1/3');
  const enemy = spawn(h, D, 'Unit Token');
  assert.deepEqual(effStats(h, enemy), [1, 1], "the opponent's unit (another region) is untouched");
  const e = new E(h.state);
  e.destroy(ent(h, sd)!, 'dies'); e.settle();
  assert.deepEqual(effStats(h, ally), [1, 1], 'the aura ends when the Defender leaves play');
});

test('Seismomancy: 3 damage to any target; {Reaping} kill draws; player targets work', () => {
  const h = new Harness(1803);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const vict = spawn(h, D, 'Curio Drifter');            // 2/2 — dies to 3
  giveResources(h, A, 'earth', 8);                      // two casts: ee / 3 each
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // cast 1: at a unit — the kill triggers Reaping (printed attr, engine-handled)
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Seismomancy') });
  pick(h, { unit: vict });
  const handBefore = h.state.players[A]!.hand.length;
  pass(h); pass(h);
  assert.ok(!ent(h, vict), '3 damage kills the 2/2');
  assert.ok(h.state.players[D]!.bin.includes('Curio Drifter'));
  assert.equal(h.state.players[A]!.hand.length, handBefore + 1, 'Reaping: the kill draws a card');
  // cast 2: at a player
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Seismomancy') });
  pick(h, { player: D });
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, 27, '3 damage to the player');
  finishBattle(h);
});

test('Skybreaker: sacrifice ("Erase me" ⚠) negates all spell effects on the stack', () => {
  const h = new Harness(1804);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const sky = spawn(h, D, 'Skybreaker');                // [Augment] text live when played normally
  giveResources(h, A, 'fire', 3);                       // Channeled Boon: r / 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Channeled Boon') });
  pick(h, { unit: atk });                               // +4/+4 unless negated
  // D responds with Skybreaker's ability; the sacrifice is the activation cost
  h.do({ type: 'activateAbility', seat: D, entityId: sky, abilityIndex: 0, via: 'augment' });
  assert.ok(!ent(h, sky), 'Skybreaker left play as the cost');
  assert.ok(h.state.players[D]!.bin.includes('Skybreaker'), '⚠ approximation: binned, not erased');
  pass(h); pass(h);                                     // resolve the ability → Boon negated
  pass(h); pass(h);                                     // the negated Boon "resolves"
  assert.deepEqual(effStats(h, atk), [1, 1], 'the Boon was negated — no +4/+4');
  assert.ok(h.state.players[A]!.bin.includes('Channeled Boon'), 'negated spell → bin');
  finishBattle(h);
});

test('Squish: target ally deals its defense to another unit (amount at resolution, R1)', () => {
  const h = new Harness(1805);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const whale = spawn(h, A, 'Good Whale');              // 7/5 → deals 5
  const vict = spawn(h, D, 'Curio Drifter');            // 2/2 — squished
  giveResources(h, A, 'earth', 3);                      // e / 2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Squish') });
  pick(h, { unit: whale });                             // the ally target
  pass(h); pass(h);                                     // resolve: sole other unit auto-picked
  assert.ok(!ent(h, vict), 'the drifter took 5 (= whale defense) and died');
  assert.ok(h.state.players[D]!.bin.includes('Curio Drifter'));
  assert.equal(ent(h, whale)!.damage, 0, 'the ally itself is unharmed');
  assert.ok(h.state.players[A]!.bin.includes('Squish'), 'spell → bin');
  finishBattle(h);
});

test('Stoneborn Progenitor: one of your units survives damage → a 2/2 (once per turn, R9)', () => {
  const h = new Harness(1806);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');                // 1/1 attacker
  const stone = spawn(h, D, 'Stoneborn Progenitor');    // 1/3 — blocks and survives
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);                                     // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [stone] } });
  finishBattle(h);                                      // combat: stone takes 1 and survives; atk dies
  const made = unitsOf(h, D).filter(u => u.card === 'Unit Token' && u.tokenStats?.[0] === 2);
  assert.equal(made.length, 1, 'surviving damage → one 2/2');
  assert.deepEqual(effStats(h, made[0]!.id), [2, 2]);
  assert.ok(ent(h, stone), 'the Progenitor survived the block');
  // bounded: a second surviving-damage event the same turn does nothing (R9)
  const e = new E(h.state);
  e.dealEffectDamage(
    { controller: A, sourceName: 'Unit Token', region: h.state.entities[stone]!.region, targets: [], event: null, choose: () => { throw new Error('no choice expected'); } },
    h.state.entities[stone]!, 1);
  e.settle();
  assert.ok(ent(h, stone), 'survived again');
  assert.equal(unitsOf(h, D).filter(u => u.card === 'Unit Token' && u.tokenStats?.[0] === 2).length, 1,
    '[Switch1]: no second 2/2 this turn');
});

test('Swirling Shardform: spawning creates two dormant Shards (⚠ engine: prismites)', () => {
  const h = new Harness(1807);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const before = h.state.players[p]!.resources.length;
  spawn(h, p, 'Swirling Shardform');
  const res = h.state.players[p]!.resources;
  assert.equal(res.length, before + 2, 'two resources appeared');
  const shards = res.slice(before);
  assert.ok(shards.every(r => r.kind === 'prismite' && r.state === 'dormant'),
    'both spawn dormant (⚠ approximated as prismites — no Shard ResourceKind yet)');
});

test('Tenebrous Bulborb: played normally, its own "[Augment] I gain -2/-2" makes it 3/2', () => {
  const h = new Harness(1808);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const tb = spawn(h, p, 'Tenebrous Bulborb');          // printed 5/4
  assert.equal(ent(h, tb)!.counters, -2, 'the -2/-2 landed as permanent counters');
  assert.deepEqual(effStats(h, tb), [3, 2], '5/4 - 2/2 = 3/2');
});

test('Tenebrous Bulborb: augmenting a host gives THE HOST -2/-2 (once per application)', () => {
  const h = new Harness(1809);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const host = spawn(h, p, 'Good Whale');               // 7/5
  giveResources(h, p, 'earth', 2);                      // e / 1
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Tenebrous Bulborb'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'the augment attached');
  assert.equal(ent(h, host)!.counters, -2, 'exactly one -2/-2 (dedup guard)');
  assert.deepEqual(effStats(h, host), [5, 3], '7/5 - 2/2 = 5/3');
});

test('The Bonesculptor: play one ability-free unit from your bin each deployment (attrs are not abilities)', () => {
  const h = new Harness(1810);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const bone = spawn(h, p, 'The Bonesculptor');
  // bin: an eligible vanilla (Curio Drifter — {Evasive} is an attr, not an
  // ability), an affordable unit WITH abilities, and a spell
  h.state.players[p]!.bin.push('Curio Drifter', 'Ignis Sprite', 'Channeled Boon');
  giveResources(h, p, 'water', 1);                      // Curio Drifter: b / 1
  giveResources(h, p, 'fire', 2);                       // Ignis Sprite affordable — still excluded
  h.do({ type: 'activateAbility', seat: p, entityId: bone, abilityIndex: 0 });
  const labels = h.state.decision!.options.map(o => o.label);
  assert.ok(labels.includes('Curio Drifter'), 'the vanilla unit is offered');
  assert.ok(!labels.includes('Ignis Sprite'), 'a unit with abilities is not');
  assert.ok(!labels.includes('Channeled Boon'), 'a spell is not');
  decide(h, l => l === 'Curio Drifter');
  assert.ok(unitsOf(h, p).some(u => u.card === 'Curio Drifter'), 'the unit was played into the region');
  assert.deepEqual(h.state.players[p]!.bin, ['Ignis Sprite', 'Channeled Boon'], 'it left the bin');
  assert.ok(h.state.players[p]!.resources.some(r => r.kind === 'water' && r.state === 'expended'),
    'its cost was paid');
  // once per deployment: the bounded budget blocks a second activation (R9)
  assert.throws(() => h.do({ type: 'activateAbility', seat: p, entityId: bone, abilityIndex: 0 }),
    /already used this turn/);
});

test('Throw off a Cliff: deletes a 4+-defense target; an under-4 target survives (⚠ resolution-time check)', () => {
  const h = new Harness(1811);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const big = spawn(h, D, 'Good Whale');                // 7/5 — deletable
  const small = spawn(h, D, 'Curio Drifter');           // 2/2 — not deletable
  giveResources(h, A, 'earth', 5);                      // two casts: e / 2 each
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Throw off a Cliff') });
  pick(h, { unit: big });
  pass(h); pass(h);
  assert.ok(!ent(h, big), '5 defense ≥ 4 → deleted');
  assert.ok(h.state.players[D]!.bin.includes('Good Whale'));
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Throw off a Cliff') });
  pick(h, { unit: small });
  pass(h); pass(h);
  assert.ok(ent(h, small), '2 defense < 4 → survives');
  assert.equal(ent(h, small)!.damage, 0, 'no damage either — the spell just fails');
  finishBattle(h);
});

test('Throwing Boulder: sacrifice + 3 damage — only with an adjacent ally', () => {
  // with an adjacent ally: the throw connects
  const h = new Harness(1812);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const boulder = spawn(h, A, 'Throwing Boulder');      // 0/3; augment text live normally
  const ally = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[boulder], [ally]] });   // adjacent columns
  h.do({ type: 'activateAbility', seat: A, entityId: boulder, abilityIndex: 0, via: 'augment' });
  pick(h, { player: D });
  pass(h); pass(h);                                     // resolve
  assert.ok(!ent(h, boulder), 'the Boulder was sacrificed');
  assert.ok(h.state.players[A]!.bin.includes('Throwing Boulder'));
  assert.equal(h.state.players[D]!.life, 27, '3 damage to the player');
  finishBattle(h);

  // attacking alone: no adjacent ally → nothing happens (⚠ resolution-time check)
  const h2 = new Harness(1813);
  toDeployment(h2);
  const A2 = h2.state.initiative, D2 = 1 - A2;
  const b2 = spawn(h2, A2, 'Throwing Boulder');
  toNextBattle(h2, A2);
  h2.do({ type: 'declareAttack', seat: A2, columns: [[b2]] });
  h2.do({ type: 'activateAbility', seat: A2, entityId: b2, abilityIndex: 0, via: 'augment' });
  pick(h2, { player: D2 });
  pass(h2); pass(h2);
  assert.ok(ent(h2, b2), 'no adjacent ally → the Boulder survives');
  assert.equal(h2.state.players[D2]!.life, 30, 'and no damage is dealt');
  finishBattle(h2);
});

test('Towering Colossus: 10/15 body registers and plays', () => {
  const h = new Harness(1814);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const tc = spawn(h, p, 'Towering Colossus');
  assert.deepEqual(effStats(h, tc), [10, 15]);
});

test('Towering Colossus: "Enemies gain +2/+2" — attackers entering its region grow (live static)', () => {
  const h = new Harness(1817);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const tc = spawn(h, D, 'Towering Colossus');
  const dTok = spawn(h, D, 'Unit Token');
  const aTok = spawn(h, A, 'Unit Token');
  assert.deepEqual(effStats(h, aTok), [1, 1], 'still at home — another region, unaffected (R12)');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[aTok]] });
  assert.deepEqual(effStats(h, aTok), [3, 3], "entering the Colossus's region: the enemy 1/1 is a live 3/3");
  assert.deepEqual(effStats(h, dTok), [1, 1], "its controller's own units gain nothing");
  assert.deepEqual(effStats(h, tc), [10, 15], 'not an enemy of itself');
  pass(h); pass(h);                                     // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 27, 'the drawback bites: the unblocked visitor hits for 3, not 1');
});

test('Tranquility: 3/4 body registers and plays', () => {
  const h = new Harness(1815);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const tr = spawn(h, p, 'Tranquility');
  assert.deepEqual(effStats(h, tr), [3, 4]);
});

test('Tranquility: "[Augment] Spells cost [one] more during battle" (PARKED: no static cost-modifier hook)', { todo: true }, () => {
  // needs canPayCard/payCard to consult in-play cost modifiers.
});
