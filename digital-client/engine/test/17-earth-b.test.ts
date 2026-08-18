/* Per-card tests for batch-earth-b (project rule: a test for every card).
 * Covers the graft-doubling cause (Lost Guardian), a true self-affecting
 * static -7/-7 (Malformed Monstrosity — its augment-donated half stays a ⚠
 * counters approximation: mod-carried statics), Crystal makers
 * (Metamorphic Luminary, Mohruung), a plan-then-commit each-player damage
 * spell (Meteor Shower, R25), survive-damage growth (Mirage Scuttler),
 * augment-application triggers (Morphic Mentor, Perpetual Construct), R1's
 * textbook spawn condition (Nectar Ridge Oracle), damage-triggered growth
 * (Plodding Pebble), retaliation (Restitution), attrs-only registration
 * (Reality Bender) and a stack sweep (Return to Nature). Oorblak is PARKED
 * (damage replacement hooks). States are built explicitly (give/spawn/
 * giveResources); seeds 1700-1799.
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

test('Malformed Monstrosity: a true -7/-7 static on itself; counters -7/-7 to an augmented host (⚠)', () => {
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
  // augmented: the host takes the -7/-7 when the mod lands — still the
  // counters approximation (⚠ mod-carried statics don't exist)
  const host = spawnToken(h, p, 9, 9);
  giveResources(h, p, 'earth', 3);                    // ee / 3
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Malformed Monstrosity'), hostId: host });
  assert.deepEqual(effStats(h, host), [2, 2], '9/9 host with -7/-7 = 2/2');
  assert.equal(ent(h, host)!.counters, -7, '⚠ augment half: permanent -1/-1 counters (mod-carried statics PARKED)');
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
  assert.deepEqual(effStats(h, mentor), [4, 5], '2/3 +2/+2 = 4/5');
  // the ENEMY applying an augment ("you") buffs nothing
  pass(h);                                            // A passes, priority → D
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Reality Bender'), hostId: d1 });
  pass(h); pass(h);                                   // virus resolves — no Mentor trigger
  assert.deepEqual(effStats(h, mentor), [4, 5], "an opponent's augment is not \"you apply\"");
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

test('Oorblak: combat-damage redirection — PARKED (no damage replacement hooks)', { todo: true }, () => {
  // Workable subset: it registers, spawns as a 2/4, and can still be applied
  // as a (currently blank) virus augment. The "damage to you is dealt to me
  // instead" replacement needs an engine seam that does not exist yet.
  const h = new Harness(1708);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const oo = spawn(h, p, 'Oorblak');
  assert.deepEqual(effStats(h, oo), [2, 4], '2/4 body');
  const host = spawnToken(h, p, 2, 2);
  giveResources(h, p, 'earth', 4);                    // eee / 4
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Oorblak'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'applies as an augment (text inert)');
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
  // PARTIAL: the Inverted stat swap is effStats layer 5 (unimplemented) —
  // the printed 2/3 stands until that layer lands.
  assert.deepEqual(effStats(h, rb), [2, 3], '2/3 (layer-5 swap not yet applied)');
  const host = spawnToken(h, p, 1, 1);
  giveResources(h, p, 'earth', 2);                    // e / 2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Reality Bender'), hostId: host });
  assert.ok(ownAttrs(h, host).has('Inverted'), 'type-line [Augment] donates Inverted');
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
  pass(h); pass(h);                                   // the negated trigger resolves
  assert.equal(tokensOf(h, A).filter(t => t.card === 'Crystal').length, 0,
    'the Crystal trigger was negated — no Crystal');
  assert.equal(ent(h, host)!.mods.length, 0, 'all mods erased');
  assert.ok(!ent(h, mod.id), 'the mod entity is gone');
  assert.ok(!h.state.players[D]!.bin.includes('Reality Bender'), 'erased, not binned');
  assert.equal(h.state.players[D]!.bin.length, binD + 1, 'only Return to Nature itself was binned');
  finishBattle(h);
});
