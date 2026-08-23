/* Per-card tests for batch-earth-b (project rule: a test for every card).
 * Covers the graft-doubling cause (Lost Guardian), a true self-affecting
 * static -7/-7 (Malformed Monstrosity — its augment-donated half stays a ⚠
 * counters approximation: mod-carried statics), Crystal makers
 * (Metamorphic Luminary, Mohruung), a plan-then-commit each-player damage
 * spell (Meteor Shower, R25), survive-damage growth (Mirage Scuttler),
 * augment-application triggers (Morphic Mentor, Perpetual Construct), R1's
 * textbook spawn condition (Nectar Ridge Oracle), damage-triggered growth
 * (Plodding Pebble), retaliation (Restitution), attrs-only registration
 * (Reality Bender) and a stack sweep (Return to Nature). Oorblak's combat-
 * damage redirection (R38 replaceCombatDamageToPlayer) is live as of
 * 2026-08-22, with a todo left for the Piercing-excess half of Caleb's RAQ
 * answer. States are built explicitly (give/spawn/giveResources); seeds
 * 1700-1799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { EffectCtx } from '../src/cards/dsl.ts';
import type { EntityId, Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, pick,
  spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

/** spawn a stat token (no triggers) into a seat's home region */
function spawnToken(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const e = new E(h.state);
  const u = e.spawnUnit(seat, 'Unit Token', e.homeRegion(seat), { token: true, tokenStats: [p, t] });
  e.settle();
  return u.id;
}

/** deal effect damage from a source card with no attrs, firing triggers */
function dealDamage(h: Harness, from: Seat, targetId: EntityId, n: number): void {
  const e = new E(h.state);
  const u = e.entity(targetId)!;
  const ctx: EffectCtx = {
    controller: from, sourceName: 'Meteor Shower', region: u.region,
    targets: [], event: null,
    choose: () => { throw new Error('unexpected choice'); },
  };
  e.dealEffectDamage(ctx, u, n);
  e.settle();
}

test('Lost Guardian: after combat, each attached graft triggers twice as one trigger', () => {
  const h = new Harness(1700);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const lg = spawn(h, p, 'Lost Guardian');            // 0/3, graft cause
  giveResources(h, p, 'earth', 1);                    // Geode: e / 1
  h.do({ type: 'graft', seat: p, from: 'hand', index: give(h, p, 'Geode'), hostId: lg, position: 0 });
  assert.equal(ent(h, lg)!.mods.length, 1, 'Geode grafted on');
  toNextBattle(h, p);
  h.do({ type: 'declareAttack', seat: p, columns: [[lg]] });
  pass(h); pass(h);                                   // attackWindow → blocks
  h.do({ type: 'declareBlocks', seat: 1 - p, blocks: {} });
  pass(h); pass(h);                                   // combat (0 power) → afterCombat trigger
  pass(h); pass(h);                                   // resolve the trigger
  const crystals = tokensOf(h, p).filter(t => t.card === 'Crystal');
  assert.equal(crystals.length, 2, 'one grafted "Create a Crystal 1" ran TWICE');
  assert.ok(crystals.every(c => c.x === 1), 'both are Crystal 1');
  finishBattle(h);
});

test('Malformed Monstrosity: a true -7/-7 static in BOTH forms (mod-carried, host-anchored)', () => {
  const h = new Harness(1701);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  // played normally: own [Augment] text is live (R26) → a continuous static,
  // not counters: the 10/9 is a live 3/2 with a clean counters field
  const mm = spawn(h, p, 'Malformed Monstrosity');
  assert.deepEqual(effStats(h, mm), [3, 2], '10/9 with the -7/-7 static = 3/2');
  assert.equal(ent(h, mm)!.counters, 0, 'a true static — NO -1/-1 counters involved');
  // +1/+1 counters stack ON TOP of the static instead of eating into a
  // -7 counter pile (the old approximation's pairwise-cancel deviation)
  const e = new E(h.state);
  e.addCounters(ent(h, mm)!, 2); e.settle();
  assert.deepEqual(effStats(h, mm), [5, 4], '3/2 + two +1/+1 counters = 5/4, static intact');
  assert.equal(ent(h, mm)!.counters, 2, 'the counter pile holds only the +2');
  // augmented: the mod CARRIES the static, anchored on the host — a live
  // -7/-7 with no counters involved (un-parked)
  const host = spawnToken(h, p, 9, 9);
  giveResources(h, p, 'earth', 3);                    // ee / 3
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Malformed Monstrosity'), hostId: host });
  assert.deepEqual(effStats(h, host), [2, 2], '9/9 host with -7/-7 = 2/2');
  assert.equal(ent(h, host)!.counters, 0, 'a true mod-carried static — no counters');
  assert.ok(ent(h, host), 'the big host survives its new drawback');
});

test('Metamorphic Luminary: attacking creates a Crystal 1', () => {
  const h = new Harness(1702);
  toDeployment(h);
  const A = h.state.initiative;
  const ml = spawn(h, A, 'Metamorphic Luminary');     // 2/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ml]] });
  pass(h); pass(h);                                   // resolve the attack trigger
  const crystals = tokensOf(h, A).filter(t => t.card === 'Crystal');
  assert.equal(crystals.length, 1, 'attack → one Crystal');
  assert.equal(crystals[0]!.x, 1, 'a Crystal 1');
  finishBattle(h);
});

test('Meteor Shower: rockfall 3 three times — each player picks, damage stacks up', () => {
  const h = new Harness(1703);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const u1 = spawnToken(h, A, 4, 4);
  const u2 = spawnToken(h, A, 4, 4);
  const d1 = spawnToken(h, D, 5, 5);
  giveResources(h, D, 'earth', 4);                    // e / 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[u1], [u2]] });
  pass(h);                                            // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Meteor Shower') });
  pass(h); pass(h);                                   // resolve
  // rockfall 1: A has two units in the region → A picks (D's lone unit auto)
  assert.equal(h.state.decision!.seat, A, 'A chooses their rockfall victim');
  pick(h, u1);                                        // u1: 3 damage; d1: 3 damage
  // rockfall 2: A picks again (u1 survived rockfall 1 with 3 on it)
  pick(h, u1);                                        // u1: 6 ≥ 4 dies; d1: 6 ≥ 5 dies
  // rockfall 3: only u2 remains on A's side (auto), D has nothing → skipped
  assert.ok(!ent(h, u1), 'u1 died to the second rockfall');
  assert.ok(!ent(h, d1), 'd1 died to the second rockfall');
  assert.equal(ent(h, u2)!.damage, 3, 'u2 caught only the third rockfall');
  assert.ok(h.state.players[D]!.bin.includes('Meteor Shower'), 'spell → bin');
  finishBattle(h);
});

test('Mirage Scuttler: surviving damage grows it by that much; lethal damage does not', () => {
  const h = new Harness(1704);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  // played normally: own [Augment] text live (R26)
  const sc = spawn(h, p, 'Mirage Scuttler');          // 0/2
  dealDamage(h, 1 - p, sc, 1);                        // survives 1 → +1 counter
  assert.deepEqual(effStats(h, sc), [1, 3], '0/2 +1/+1 = 1/3 (damage survived)');
  assert.equal(ent(h, sc)!.counters, 1);
  // as an augment: the host grows by the damage it survives
  const host = spawnToken(h, p, 3, 5);
  giveResources(h, p, 'earth', 1);                    // e / 1
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Mirage Scuttler'), hostId: host });
  dealDamage(h, 1 - p, host, 2);                      // survives 2 → +2 counters
  assert.deepEqual(effStats(h, host), [5, 7], '3/5 +2/+2 = 5/7');
  // lethal damage: "survive" fails at event time (R1) → no counters, it dies
  dealDamage(h, 1 - p, host, 20);
  assert.ok(!ent(h, host), 'lethal damage kills without triggering the growth');
});

test('Mohruung: augment-targeting triggers a Crystal 2, once per turn ([Switch1])', () => {
  const h = new Harness(1705);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const mo = spawn(h, p, 'Mohruung');                 // 1/5
  giveResources(h, p, 'earth', 4);                    // two Reality Benders: e / 2 each
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Reality Bender'), hostId: mo });
  let crystals = tokensOf(h, p).filter(t => t.card === 'Crystal');
  assert.equal(crystals.length, 1, 'being targeted by an augment → one Crystal');
  assert.equal(crystals[0]!.x, 2, 'a Crystal 2');
  // bounded (R9): a second targeting this turn makes nothing
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Reality Bender'), hostId: mo });
  crystals = tokensOf(h, p).filter(t => t.card === 'Crystal');
  assert.equal(crystals.length, 1, '[Switch1]: only once per turn');
  assert.equal(ent(h, mo)!.mods.length, 2, 'both augments landed regardless');
});

test('Morphic Mentor: your battle augment gives +2/+2 until regroup; an enemy augment does not', () => {
  const h = new Harness(1706);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const mentor = spawn(h, A, 'Morphic Mentor');       // 2/3
  const d1 = spawnToken(h, D, 1, 1);
  giveResources(h, A, 'earth', 2);
  giveResources(h, D, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mentor]] });
  // A virus-augments Reality Bender onto the Mentor during battle
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Reality Bender'), hostId: mentor });
  pass(h); pass(h);                                   // virus resolves → mod applied → trigger
  pass(h); pass(h);                                   // resolve the trigger
  // R93: Reality Bender is the convenient cheap Virus here, and its type-line
  // [Augment] donates {Inverted} to the Mentor along the way — so stat layer 5
  // now negates the Mentor's own +2/+2 off its printed 2/3: 4/5 → 2·2−4 /
  // 2·3−5 = 0/1. The +2/+2 is still what is being measured (without the
  // trigger the answer would be the unchanged 2/3, and this line would be the
  // first thing to say so); it is just being read through the inversion.
  assert.deepEqual(effStats(h, mentor), [0, 1], '2/3 +2/+2 = 4/5, inverted by the Bender to 0/1');
  // the ENEMY applying an augment ("you") buffs nothing
  pass(h);                                            // A passes, priority → D
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Reality Bender'), hostId: d1 });
  pass(h); pass(h);                                   // virus resolves — no Mentor trigger
  assert.deepEqual(effStats(h, mentor), [0, 1], "an opponent's augment is not \"you apply\"");
  finishBattle(h);
});

test('Nectar Ridge Oracle: defense>power ally spawn draws, once per turn ([once], R1 condition)', () => {
  const h = new Harness(1707);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const before = h.state.players[p]!.hand.length;
  spawn(h, p, 'Nectar Ridge Oracle');                 // 1/3 — own spawn is not "another"
  assert.equal(h.state.players[p]!.hand.length, before, 'its own spawn does not draw');
  spawn(h, p, 'Unit Token');                          // 1/1: defense NOT greater than power
  assert.equal(h.state.players[p]!.hand.length, before, '1/1 ally: condition false, budget kept');
  spawn(h, p, 'Mohruung');                            // 1/5: defense > power → draw
  assert.equal(h.state.players[p]!.hand.length, before + 1, 'defense>power ally → draw');
  spawn(h, p, 'Mohruung');                            // second qualifying spawn same turn
  assert.equal(h.state.players[p]!.hand.length, before + 1, '[once]: only once per turn (R9)');
});

// ── Oorblak (R38 replaceCombatDamageToPlayer; un-parked 2026-08-22) ──────
//
// "[Augment] If combat damage would be dealt to you, that damage is dealt to
// me instead." Assertions stop just after the combat-damage sub-step rather
// than running finishBattle, because Oorblak is {Unstable} and regroup would
// erase the very entity whose damage we are reading (R69).

/** attack unblocked with `columns` and stop with combat damage dealt */
function unblockedCombat(h: Harness, attacker: Seat, columns: EntityId[][]): void {
  h.do({ type: 'declareAttack', seat: attacker, columns });
  pass(h); pass(h);                                   // → block step
  h.do({ type: 'declareBlocks', seat: (1 - attacker) as Seat, blocks: {} });
  pass(h); pass(h);                                   // → combat damage
}

test('Oorblak: combat damage to me is dealt to my Oorblak instead — my life is untouched', () => {
  const h = new Harness(1708);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawnToken(h, A, 3, 3);
  const oo = spawn(h, D, 'Oorblak');                   // 2/4, the defender's
  assert.deepEqual(effStats(h, oo), [2, 4], '2/4 body');
  const lifeD = h.state.players[D]!.life;
  toNextBattle(h, A);
  unblockedCombat(h, A, [[atk]]);
  assert.equal(h.state.players[D]!.life, lifeD, 'the 3 never reached the life total');
  assert.ok(ent(h, oo), 'Oorblak took 3 into a 4-toughness body and lived');
  assert.equal(ent(h, oo)!.damage, 3, 'it really is damage on Oorblak, not nothing');
});

test('Oorblak: the redirected damage can kill it, and the life total is still spared', () => {
  const h = new Harness(1714);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawnToken(h, A, 6, 1);                 // 6 > Oorblak's 4 toughness
  const oo = spawn(h, D, 'Oorblak');
  const lifeD = h.state.players[D]!.life;
  toNextBattle(h, A);
  unblockedCombat(h, A, [[atk]]);
  assert.ok(!ent(h, oo), 'Oorblak ate 6 and died on the state check');
  assert.equal(h.state.players[D]!.life, lifeD, 'and none of it spilled onto the life total');
});

test('Oorblak: "dealt to YOU" is its own controller — it does not eat the enemy\'s hits', () => {
  const h = new Harness(1715);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawnToken(h, A, 3, 3);
  const oo = spawn(h, A, 'Oorblak');                   // the ATTACKER's Oorblak, not attacking
  const lifeD = h.state.players[D]!.life;
  toNextBattle(h, A);
  unblockedCombat(h, A, [[atk]]);
  assert.equal(h.state.players[D]!.life, lifeD - 3, 'D takes the 3 normally');
  assert.equal(ent(h, oo)!.damage, 0, "A's Oorblak is offered the hit by the engine and declines it");
});

test('Oorblak: as a Virus, "me" is the HOST — an enemy host eats its own controller\'s damage', () => {
  const h = new Harness(1716);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawnToken(h, A, 3, 3);
  const host = spawnToken(h, D, 0, 5);                // D's unit, not blocking
  giveResources(h, A, 'earth', 4);                    // eee / 4
  const lifeD = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Oorblak'), hostId: host });
  pass(h); pass(h);                                   // the Virus resolves → attaches
  assert.equal(ent(h, host)!.mods.length, 1, 'applies as an augment/virus (augmentable)');
  pass(h); pass(h);                                   // attack window (now empty) → block step
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                   // → combat damage
  assert.equal(h.state.players[D]!.life, lifeD,
    'the donated text reads "you" as the HOST\'s controller (D), not the mod owner (A)');
  assert.equal(ent(h, host)!.damage, 3, 'and "me" is the host, which took the 3');
});

test('Oorblak: PARKED — Piercing excess past its toughness does not carry on to the face', { todo: true }, () => {
  // RAQ "[Solved] Oorblak vs Piercing": "10 damage is redirected to Oorblak, he
  // takes 4 damage which is enough to kill him and leftover 6 damage is still
  // Piercing so it goes to players face." The excess carries on BECAUSE the hit
  // is Piercing; a plain overkill spills nothing. `replaceCombatDamageToPlayer`
  // is handed `info: { attacker, region }` only, so the hook cannot tell the two
  // apart, and its boolean return is all-or-nothing. Needs the hit's `attrs`
  // (and `pure`) on `info`, plus a way to hand part of the hit back.
  assert.fail('needs the hit attributes on replaceCombatDamageToPlayer\'s info');
});

test("Perpetual Construct: an applied mod creates an X/X, X = the mod's cost", () => {
  const h = new Harness(1709);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const pc = spawn(h, p, 'Perpetual Construct');      // 1/3
  giveResources(h, p, 'earth', 2);                    // Reality Bender: e / 2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Reality Bender'), hostId: pc });
  const made = unitsOf(h, p).filter(u => u.card === 'Unit Token' && u.token);
  assert.equal(made.length, 1, 'mod applied → one token');
  assert.deepEqual(effStats(h, made[0]!.id), [2, 2], "Reality Bender costs 2 → a 2/2");
  assert.ok(ent(h, pc), 'the Construct itself is untouched');
});

test('Plodding Pebble: dealt damage → a +1/+1 counter, once per turn ([Switch1])', () => {
  const h = new Harness(1710);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const pb = spawn(h, p, 'Plodding Pebble');          // 0/4 {Sluggish}
  assert.ok(ownAttrs(h, pb).has('Sluggish'), 'printed {Sluggish}');
  dealDamage(h, 1 - p, pb, 1);
  assert.deepEqual(effStats(h, pb), [1, 5], '0/4 +1/+1 = 1/5');
  assert.equal(ent(h, pb)!.counters, 1);
  dealDamage(h, 1 - p, pb, 1);                        // second damage same turn
  assert.equal(ent(h, pb)!.counters, 1, '[Switch1]: only once per turn (R9)');
  assert.equal(ent(h, pb)!.damage, 2, 'the damage itself still lands');
});

test('Reality Bender: {Inverted} 2/3 — as a unit and donated by type-line [Augment]', () => {
  const h = new Harness(1711);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const rb = spawn(h, p, 'Reality Bender');
  assert.ok(ownAttrs(h, rb).has('Inverted'), 'played normally: has Inverted');
  // Stat layer 5 landed in round 17 (R93), and the card is no longer
  // attrs-only registration. With nothing having CHANGED its stats there is
  // no change to invert, so the printed 2/3 still stands — that is the layer
  // working, not the layer missing.
  assert.deepEqual(effStats(h, rb), [2, 3], '2/3: no stat change, so nothing to invert');
  ent(h, rb)!.counters = -1;
  assert.deepEqual(effStats(h, rb), [3, 4], 'R93: its own -1/-1 counter inverts to +1/+1');
  ent(h, rb)!.counters = 0;
  const host = spawnToken(h, p, 1, 1);
  giveResources(h, p, 'earth', 2);                    // e / 2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Reality Bender'), hostId: host });
  assert.ok(ownAttrs(h, host).has('Inverted'), 'type-line [Augment] donates Inverted');
  ent(h, host)!.counters = 2;
  assert.deepEqual(effStats(h, host), [-1, -1],
    'R93: and the donated {Inverted} really inverts the host — a 1/1 at +2/+2 is a -1/-1');
});

test('Restitution: dealt combat damage → each opponent loses that much (R25)', () => {
  const h = new Harness(1712);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const rest = spawn(h, A, 'Restitution');            // 4/4
  const blocker = spawnToken(h, D, 3, 3);
  const lifeD = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[rest]] });
  pass(h); pass(h);                                   // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  finishBattle(h);                                    // combat: rest takes 3 → trigger
  assert.ok(!ent(h, blocker), 'the 3/3 blocker died to the 4/4');
  assert.ok(ent(h, rest), 'Restitution survived (3 < 4)');
  assert.equal(h.state.players[D]!.life, lifeD - 3, 'D lost 3 — the damage Restitution took');
});

test('Return to Nature: negates everything on the stack and erases all mods in the region', () => {
  const h = new Harness(1713);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const ml = spawn(h, A, 'Metamorphic Luminary');
  const host = spawnToken(h, D, 1, 1);
  const e = new E(h.state);                           // pre-attach a mod to erase
  const mod = e.attachMod(e.entity(host)!, 'Reality Bender', D, 'augment');
  e.settle();
  giveResources(h, D, 'earth', 4);                    // eee / 4
  const binD = h.state.players[D]!.bin.length;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ml]] });   // Luminary trigger → stack
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Return to Nature') });
  pass(h); pass(h);                                   // Return to Nature resolves first
  assert.equal(h.state.stack.length, 0, 'R68: the negated trigger left the stack with it');
  assert.equal(tokensOf(h, A).filter(t => t.card === 'Crystal').length, 0,
    'the Crystal trigger was negated — no Crystal');
  assert.equal(ent(h, host)!.mods.length, 0, 'all mods erased');
  assert.ok(!ent(h, mod.id), 'the mod entity is gone');
  assert.ok(!h.state.players[D]!.bin.includes('Reality Bender'), 'erased, not binned');
  assert.equal(h.state.players[D]!.bin.length, binD + 1, 'only Return to Nature itself was binned');
  finishBattle(h);
});

// ── R110: "trigger two copies of this graft ability" — the ruling ────────
//
// "Amphivore / Lost Guardian. Bounded Grafts and Ralph explained." (moderator,
// 2025-03-21): ONE stack item with the grafts doubled, top-to-bottom and then
// top-to-bottom again; "Any Bounded Grafts will be repeated"; a "[cost]:
// effect" graft pays its cost twice, and if it cannot pay both times it pays
// nothing and the effect does not happen at all.

/** answer every pending decision of the composite: a discard cost takes the
 * first card offered, a target menu takes the opponent's face */
function answerAll(h: Harness, foe: Seat): void {
  for (let guard = 0; guard < 20 && h.state.decision; guard++) {
    const dec = h.state.decision;
    const vals = dec.options.map(o => JSON.stringify(o.value));
    let idx = vals.findIndex(v => v.startsWith('{"discard"'));
    if (idx === -1) idx = vals.indexOf(JSON.stringify({ player: foe }));
    if (idx === -1) throw new Error(`unexpected decision ${dec.prompt}: [${vals}]`);
    h.do({ type: 'decide', seat: dec.seat, choice: idx });
  }
}

function lostGuardianAfterCombat(h: Harness, p: Seat, lg: EntityId, hand?: string[]): void {
  toNextBattle(h, p);
  if (hand) h.state.players[p]!.hand = hand;          // set AFTER the turn's draw
  h.do({ type: 'declareAttack', seat: p, columns: [[lg]] });
  pass(h); pass(h);                                   // attackWindow → blocks
  h.do({ type: 'declareBlocks', seat: 1 - p, blocks: {} });
  pass(h); pass(h);                                   // combat (0 power) → afterCombat trigger
}

test('R110: Lost Guardian repeats a BOUNDED [Switch1] graft too — two copies, one budget', () => {
  const h = new Harness(1760);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const lg = spawn(h, p, 'Lost Guardian');
  giveResources(h, p, 'fire', 2);                     // Flame Juggle: r/2, [Switch1] three Fireball 1
  h.do({ type: 'graft', seat: p, from: 'hand', index: give(h, p, 'Flame Juggle'), hostId: lg, position: 0 });
  lostGuardianAfterCombat(h, p, lg);
  answerAll(h, 1 - p);
  pass(h); pass(h);                                   // resolve the trigger
  const fires = tokensOf(h, p).filter(t => t.card === 'Fireball');
  assert.equal(fires.length, 6, 'a bounded "Create three Fireball 1" ran TWICE (6 Fireballs) — "Any Bounded Grafts will be repeated"');
  finishBattle(h);
});

test('R110: a "[cost]: effect" graft under Lost Guardian pays its cost TWICE and resolves twice', () => {
  const h = new Harness(1761);
  toDeployment(h);
  const p = h.state.deployPlayer!, foe = 1 - p;
  const lg = spawn(h, p, 'Lost Guardian');
  giveResources(h, p, 'fire', 1); giveResources(h, p, 'dark', 1);   // Darkblast: rd/1
  h.do({ type: 'graft', seat: p, from: 'hand', index: give(h, p, 'Darkblast'), hostId: lg, position: 0 });
  const life = h.state.players[foe]!.life;
  lostGuardianAfterCombat(h, p, lg, ['Geode', 'Geode']);   // exactly two cards to discard
  answerAll(h, foe);                                  // discard, target; discard, target
  pass(h); pass(h);
  assert.equal(h.state.players[p]!.hand.length, 0, 'both cards were discarded — the cost is paid twice');
  assert.equal(h.state.players[foe]!.life, life - 10, '5 damage, twice');
  finishBattle(h);
});

test('R110: all or nothing — one card in hand cannot pay a doubled [Discard a card], so nothing is paid and nothing happens', () => {
  const h = new Harness(1762);
  toDeployment(h);
  const p = h.state.deployPlayer!, foe = 1 - p;
  const lg = spawn(h, p, 'Lost Guardian');
  giveResources(h, p, 'fire', 1); giveResources(h, p, 'dark', 1);
  h.do({ type: 'graft', seat: p, from: 'hand', index: give(h, p, 'Darkblast'), hostId: lg, position: 0 });
  const life = h.state.players[foe]!.life;
  lostGuardianAfterCombat(h, p, lg, ['Geode']);       // ONE card: can pay once, not twice
  answerAll(h, foe);
  pass(h); pass(h);
  assert.equal(h.state.players[p]!.hand.length, 1, 'the one card is still in hand — "No Sacrifice at all"');
  assert.equal(h.state.players[foe]!.life, life, '"and you don\'t get the effect"');
  assert.ok(h.log.some(l => /must be paid 2 times and cannot be/.test(l)), 'the log says why');
  finishBattle(h);
});
