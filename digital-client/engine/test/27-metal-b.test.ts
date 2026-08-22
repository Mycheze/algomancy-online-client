/* Per-card tests for the metal-b batch (project rule: a test for every card).
 * States are built explicitly (spawn/give/giveResources, explicit hands) so
 * parallel card registration can't shift assertions; seeds are 2700-2799.
 *
 * Covers: counter-bonus trigger in both forms (Flux Resonator), Glimpse 1
 * (Foretell — R45: the top card is CACHED and playable until end of turn
 * ignoring affinity, never put into hand), base-4/4 reshaping
 * plus R62 attribute suppression (Formless), a battle-local Robot
 * (Hooba-Bot), resolution-paid X + sacrifice costs (Instrument of
 * Reassignment), opponent-chosen negation (Interdiction Rift), stat swapping
 * + card-code Reaping (Invasive Reassignment), linked sacrifices (Linked
 * Extinction), activated [Augment] abilities own AND donated (Living Forge),
 * a Robot 3+2+1 spread at home per R28 (Manufacture), a battle-timing unit
 * that switches the battle's attribute and ability layers off (Monke, R62),
 * type-line augment attrs (Nebula Drifter), an
 * activated graft cause carrying a grafted Foretell (Omniwield Evoker),
 * region-scoped mass sacrifice (Perish), spawn counters + a died-trigger
 * counter move under R31 (Powerforge Synergist), and R63 ability granting
 * (Reforge the Dead). Nothing here is parked any more: Flux Constructor's
 * "died-event counter snapshot" turned out to already exist (destroy() stamps
 * `counters` onto the event), so R67 implemented it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { getCard, isAugment } from '../src/cards/dsl.ts';
import {
  effStats, ent, finishBattle, give, giveResources, offered, ownAttrs, pass, pick,
  spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';
import type { CachedCard, Seat } from '../src/types.ts';

/** R41: the cache zone — optional field, so read it through here. */
const cacheOf = (h: Harness, seat: Seat): CachedCard[] => h.state.players[seat]!.cache ?? [];

const homeOf = (h: Harness, seat: number): number =>
  h.state.regions.findIndex(r => r.owner === seat);

/** run engine mutations white-box, absorbing the suspension a mid-settle
 * decision throws (test 59 precedent) */
function whiteBox(h: Harness, f: (e: E) => void): void {
  const e = new E(h.state);
  try {
    f(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
}

// ── Flux Constructor ─────────────────────────────────────────────────────

test('Flux Constructor: registers as a 3/3 augment (behavior parked)', () => {
  const h = new Harness(2701);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const fc = spawn(h, p, 'Flux Constructor');
  assert.deepEqual(effStats(h, fc), [3, 3]);
  assert.ok(isAugment('Flux Constructor'), 'recognised as an augment (inert text)');
});

test("Flux Constructor: a dead ally's counters move onto another target unit", () => {
  const h = new Harness(2716);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  spawn(h, A, 'Flux Constructor');
  const donor = spawn(h, A, 'Unit Token');
  const heir = spawn(h, A, 'Good Whale');           // 7/5
  const enemy = spawn(h, D, 'Unit Token');
  whiteBox(h, e => e.addCounters(e.entity(donor)!, 3));   // the ally dies holding +3
  whiteBox(h, e => e.destroy(e.entity(donor)!, 'dies'));
  // R67: the heir is a DECLARED target, asked as the trigger goes on the stack
  assert.equal(h.state.decision?.kind, 'targets');
  assert.equal(h.state.decision!.seat, A, 'the augment controller chooses');
  // "another target unit" is unqualified, but targeting is REGION-scoped
  // (R12): in deployment each player sits in their own home region, so the
  // enemy is not reachable here — not because it is an enemy.
  assert.ok(!h.state.decision!.options.some(o =>
    JSON.stringify(o.value) === JSON.stringify({ unit: enemy })), 'another region (R12)');
  pick(h, { unit: heir });
  assert.deepEqual(effStats(h, heir), [10, 8], 'the 3 counters landed on the heir');
});

test('Flux Constructor: the counters keep their SIGN, and "you may" can decline', () => {
  const h = new Harness(2717);
  toDeployment(h);
  const A = h.state.initiative;
  spawn(h, A, 'Flux Constructor');
  const donor = spawn(h, A, 'Good Whale');
  const heir = spawn(h, A, 'Good Whale');           // 7/5
  whiteBox(h, e => e.addCounters(e.entity(donor)!, -2));  // two -1/-1 counters
  whiteBox(h, e => e.destroy(e.entity(donor)!, 'dies'));
  // a unit that died holding -1/-1 counters is still "a unit with counters on
  // it" — the engine keeps one signed total, so the drawback moves too
  assert.equal(h.state.decision?.kind, 'targets');
  pick(h, { unit: heir });
  assert.deepEqual(effStats(h, heir), [5, 3], 'the -2 moved, sign intact');
});

test('Flux Constructor: a counterless death, and an ENEMY death, do not fire it', () => {
  const h = new Harness(2718);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  spawn(h, A, 'Flux Constructor');
  const bare = spawn(h, A, 'Unit Token');           // no counters
  const theirs = spawn(h, D, 'Unit Token');
  whiteBox(h, e => e.addCounters(e.entity(theirs)!, 4));  // counters, but not MINE
  for (const id of [bare, theirs]) {
    whiteBox(h, e => e.destroy(e.entity(id)!, 'dies'));
    assert.equal(h.state.decision, null,
      '"one of YOUR units with one or more counters" — neither death qualifies');
  }
});

// ── Flux Resonator ───────────────────────────────────────────────────────

test('Flux Resonator: a counter put on an allied unit becomes one more', () => {
  const h = new Harness(2702);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Flux Resonator');
  const ally = spawn(h, p, 'Lurking Slimebeast');           // 8/3, trigger-free
  {
    const e = new E(h.state);
    e.addCounters(h.state.entities[ally]!, 1);
    e.settle();
  }
  assert.equal(ent(h, ally)!.counters, 2, '1 put + 1 from the Resonator');
  assert.deepEqual(effStats(h, ally), [10, 5]);
});

test('Flux Resonator: the donated [Augment] text boosts allied counters via the host', () => {
  const h = new Harness(2703);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const host = spawn(h, p, 'Lurking Slimebeast');
  const ally = spawn(h, p, 'Unit Token');
  giveResources(h, p, 'metal', 2);                          // Resonator: mm/2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Flux Resonator'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'augment attached');
  {
    const e = new E(h.state);
    e.addCounters(h.state.entities[ally]!, 2);
    e.settle();
  }
  assert.equal(ent(h, ally)!.counters, 3, '2 put + 1 (the donated text, once)');
});

// ── Foretell ─────────────────────────────────────────────────────────────

test('Foretell: Glimpse 1 — the top card goes to the CACHE, playable this turn ignoring affinity', () => {
  const h = new Harness(2704);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 2);                          // Foretell m/1 + 1 spare, ZERO water affinity
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.q.deckOf(A).unshift('Premonition');                     // b/1 {Battle} — needs water affinity from hand
  const top = h.q.deckOf(A)[0]!;
  const deckLen = h.q.deckOf(A).length;
  const handBefore = [...h.state.players[A]!.hand];
  const inHand = give(h, A, 'Premonition');
  assert.ok(!h.legal(A).some(a => a.type === 'playCard' && a.handIndex === inHand),
    'baseline: with no water affinity the copy IN HAND cannot be played');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Foretell') });
  pass(h); pass(h);                                         // resolve
  assert.ok(!h.state.decision, 'Glimpse 1 asks nothing — no suspension');
  assert.deepEqual(cacheOf(h, A).map(c => c.card), [top], 'the top card is CACHED, not drawn');
  assert.deepEqual(h.state.players[A]!.hand, [...handBefore, 'Premonition'],
    'nothing reached hand beyond the copy the test put there');
  assert.equal(h.q.deckOf(A).length, deckLen - 1, 'it left the deck');
  assert.ok(h.state.players[A]!.bin.includes('Foretell'), 'the spell resolved → bin');
  assert.equal(h.q.cachePermission(A, 0), 'glimpse', 'playable until end of turn (R45)');
  const mana = h.q.openMana(A);
  assert.ok(h.legal(A).some(a => a.type === 'playCached' && a.index === 0),
    'the cached copy IS offered — glimpse ignores affinity');
  h.do({ type: 'playCached', seat: A, index: 0 });
  assert.equal(h.q.openMana(A), mana - 1, 'the mana cost is still paid');
  assert.equal(cacheOf(h, A).length, 0, 'it left the cache');
  finishBattle(h);
});

// ── Formless ─────────────────────────────────────────────────────────────

test('Formless: attack trigger — target unit becomes a base 4/4 until regroup', () => {
  const h = new Harness(2705);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const fl = spawn(h, A, 'Formless');
  const big = spawn(h, D, 'Lurking Slimebeast');            // 8/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[fl]] });
  pick(h, { unit: big });                                   // the trigger's target
  pass(h); pass(h);                                         // resolve
  assert.deepEqual(effStats(h, big), [4, 4], 'a base 4/4 (layer 2 rewrite)');
  finishBattle(h);
  assert.deepEqual(effStats(h, big), [8, 3], 'restored at regroup');
});

test('Formless: R62 — "and loses all attributes", abilities untouched', () => {
  const h = new Harness(2722);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const fl = spawn(h, A, 'Formless');
  const sprite = spawn(h, D, 'Ephemeral Skywalker');        // 3/1 {Flying}
  assert.ok(ownAttrs(h, sprite).has('Flying'), 'before');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[fl]] });
  pick(h, { unit: sprite });
  pass(h); pass(h);                                         // resolve
  assert.equal(ownAttrs(h, sprite).size, 0, 'the attribute layer is off');
  assert.deepEqual(effStats(h, sprite), [4, 4], 'and it is a base 4/4');
  assert.ok(!new E(h.state).abilitiesSuppressed(ent(h, sprite)!),
    'Formless takes attributes only — abilities are not in its text');
  finishBattle(h);
  assert.ok(ownAttrs(h, sprite).has('Flying'), 'until REGROUP');
});

/* Playtest BRDM, 2026-08-20: "FORMLESS SHOULD BE ABLE TO TARGET ITSELF".
 *
 * It always could — a bare `what: 'unit'` spec offers every unit in the
 * region, the source included, and "another target …" is a SEPARATE clause
 * (dsl.ts `notSelf`) that Formless does not print. Nothing asserted it, which
 * is the problem: 16-earth-a.test.ts asserts the exact OPPOSITE for Eminence
 * of Fire ("no self-target is offered"), because that card really does print
 * "another target unit". With one card pinned and the other not, an
 * "exclude self" refactor would have looked sanctioned by the suite.
 *
 * So this pins both halves — the declaration and the live menu — and the
 * whole point is that Formless is a 2/2 {Flying} choosing to become a 4/4
 * that has lost Flying, which is a real play and not a misclick. */
test('Formless: BRDM — "target unit" includes ME, and self-targeting really works', () => {
  const spec = getCard('Formless').abilities![0]!.effect.targets!;
  assert.equal(spec.what, 'unit', 'the printed text says "target unit", not "another target unit"');
  assert.equal(spec.restrict, undefined, 'and nothing excludes the source (dsl.ts notSelf)');

  const h = new Harness(2726);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const fl = spawn(h, A, 'Formless');                       // printed 2/2 {Flying}
  const them = spawn(h, D, 'The Foretold');
  assert.deepEqual(effStats(h, fl), [2, 2]);
  assert.ok(ownAttrs(h, fl).has('Flying'));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[fl]] });

  // R64: a legal target is one you are OFFERED, so the menu is the assertion
  assert.ok(offered(h).includes(JSON.stringify({ unit: fl })),
    `Formless must be on its own trigger's menu; it offered [${offered(h)}]`);
  assert.ok(offered(h).includes(JSON.stringify({ unit: them })), 'and so is everyone else');
  pick(h, { unit: fl });
  pass(h); pass(h);                                         // resolve

  assert.deepEqual(effStats(h, fl), [4, 4], 'it rewrote its own base');
  assert.equal(ownAttrs(h, fl).size, 0, 'and dropped its own {Flying} with the rest');
  finishBattle(h);
  assert.deepEqual(effStats(h, fl), [2, 2], 'until regroup');
  assert.ok(ownAttrs(h, fl).has('Flying'));
});

// ── Hooba-Bot ────────────────────────────────────────────────────────────

test('Hooba-Bot: attack → a Robot 2 joins my formation (battle-local)', () => {
  const h = new Harness(2706);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const hb = spawn(h, A, 'Hooba-Bot');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[hb]] });
  pass(h); pass(h);                                         // resolve the trigger
  pick(h, 1);                                               // R75: behind me, not auto-picked
  const col = h.state.battle!.columns[0]!;
  assert.equal(col.length, 2, 'the Robot joined my column');
  const robot = ent(h, col[1]!)!;
  assert.equal(robot.card, 'Robot');
  assert.equal(robot.counters, 2, 'a Robot 2');
  assert.deepEqual(effStats(h, robot.id), [2, 2]);
  assert.equal(robot.region, h.state.battle!.region, 'battle-local ("in my formation"), not home');
  finishBattle(h);
});

// ── Instrument of Reassignment ───────────────────────────────────────────

test('Instrument of Reassignment: [x] + sacrifice another nontoken unit → a Robot X', () => {
  const h = new Harness(2707);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const inst = spawn(h, p, 'Instrument of Reassignment');
  const slime = spawn(h, p, 'Lurking Slimebeast');
  giveResources(h, p, 'metal', 3);
  h.do({ type: 'activateAbility', seat: p, entityId: inst, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.decision!.options.length, 3, 'X = 1..open mana');
  pick(h, 2);                                               // X = 2
  assert.equal(h.state.decision!.options.length, 1, 'only ANOTHER nontoken unit is offered (not me)');
  pick(h, slime);
  assert.ok(!ent(h, slime), 'sacrificed');
  assert.ok(h.state.players[p]!.bin.includes('Lurking Slimebeast'), 'nontoken sacrifice → bin');
  const robot = unitsOf(h, p).find(u => u.card === 'Robot')!;
  assert.ok(robot, 'a Robot was created');
  assert.equal(robot.counters, 2, 'a Robot X = 2');
  assert.equal(robot.region, homeOf(h, p), 'created at home (R28)');
  assert.equal(h.state.players[p]!.resources.filter(r => r.state === 'open').length, 1, 'X = 2 was paid');
});

// ── Interdiction Rift ────────────────────────────────────────────────────

test('Interdiction Rift: target opponent negates an effect they control', () => {
  const h = new Harness(2708);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 2);                          // Rift: mm/2
  giveResources(h, D, 'water', 1);                          // Overwhelm: b/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  pass(h);                                                  // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Overwhelm') });
  pick(h, { unit: tok });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Interdiction Rift') });
  pick(h, { player: D });                                   // target opponent
  pass(h); pass(h);                                         // resolve the Rift
  // D controls exactly one effect → it is negated without a choice
  assert.equal(h.state.stack.length, 0, 'R68: the only effect D controls is negated and off the stack');
  assert.ok(h.state.players[D]!.bin.includes('Overwhelm'), 'negated → bin');
  assert.deepEqual(effStats(h, tok), [1, 1], 'the token was never shrunk');
  finishBattle(h);
});

// ── Invasive Reassignment ────────────────────────────────────────────────

test('Invasive Reassignment: switches power and defense until regroup', () => {
  const h = new Harness(2709);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const tok = spawn(h, A, 'Unit Token');
  const big = spawn(h, D, 'Lurking Slimebeast');            // 8/3
  giveResources(h, A, 'metal', 2);                          // mm/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Invasive Reassignment') });
  pick(h, { unit: big });
  pass(h); pass(h);                                         // resolve
  assert.deepEqual(effStats(h, big), [3, 8], '8/3 → 3/8');
  finishBattle(h);
  assert.deepEqual(effStats(h, big), [8, 3], 'temporary — gone at regroup');
});

test('Invasive Reassignment: a 0-power victim dies swapped — printed Reaping draws', () => {
  const h = new Harness(2710);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const tok = spawn(h, A, 'Unit Token');
  const eel = spawn(h, D, 'Galerider Eel');                 // 0/4
  giveResources(h, A, 'metal', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Invasive Reassignment') });
  pick(h, { unit: eel });
  const aHand = h.state.players[A]!.hand.length;
  pass(h); pass(h);                                         // resolve: 0/4 → 4/0 → dies
  assert.ok(!ent(h, eel), 'the swapped 4/0 died at the death check');
  assert.ok(h.state.players[D]!.bin.includes('Galerider Eel'), '→ bin');
  assert.equal(h.state.players[A]!.hand.length, aHand + 1, 'Reaping: the kill drew a card');
  finishBattle(h);
});

// ── Linked Extinction ────────────────────────────────────────────────────

test('Linked Extinction: you sacrifice a unit; each opponent here sacrifices one', () => {
  const h = new Harness(2711);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const a1 = spawn(h, A, 'Unit Token');
  const a2 = spawn(h, A, 'Lurking Slimebeast');             // stays home — still payable
  const d1 = spawn(h, D, 'Lurking Slimebeast');             // in the battle region
  giveResources(h, A, 'metal', 1);                          // m/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Linked Extinction') });
  // cast cost (R35): paid BEFORE the stack push, region-scoped — the home
  // Slimebeast (a2) is not in the battle region and cannot pay
  assert.equal(h.state.decision!.seat, A, 'the caster pays the sacrifice cost at cast');
  assert.ok(!h.state.decision!.options.some(o => JSON.stringify(o.value) === JSON.stringify({ unit: a2 })),
    'home units are outside the battle region — not offered as the cost (R35)');
  pick(h, { unit: a1 });                                    // pay with the attacker
  assert.ok(!ent(h, a1), 'the cost was paid at cast');
  pass(h); pass(h);                                         // resolve
  // D has exactly one unit in the region → sacrificed without a choice
  assert.ok(!ent(h, d1), 'the opponent sacrificed too');
  assert.ok(h.state.players[A]!.bin.includes('Unit Token'), 'caster\'s unit → bin');
  assert.ok(h.state.players[D]!.bin.includes('Lurking Slimebeast'), 'opponent\'s unit → bin');
  assert.ok(ent(h, a2), 'the home unit survived (only one sacrifice each)');
  finishBattle(h);
});

// ── Living Forge ─────────────────────────────────────────────────────────

test('Living Forge: [three]: create a Robot 2 (own [Augment] text, played normally)', () => {
  const h = new Harness(2712);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const lf = spawn(h, p, 'Living Forge');
  giveResources(h, p, 'metal', 3);
  h.do({ type: 'activateAbility', seat: p, entityId: lf, abilityIndex: 0, via: 'augment' });
  const robots = unitsOf(h, p).filter(u => u.card === 'Robot');
  assert.equal(robots.length, 1, 'one Robot created');
  assert.equal(robots[0]!.counters, 2, 'a Robot 2');
  assert.equal(robots[0]!.region, homeOf(h, p), 'at home (R28)');
  assert.equal(h.state.players[p]!.resources.filter(r => r.state === 'open').length, 0, '[three] paid');
});

test('Living Forge: donated on a host, the [three] ability activates via the mod', () => {
  const h = new Harness(2713);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const host = spawn(h, p, 'Lurking Slimebeast');
  giveResources(h, p, 'metal', 7);                          // augment mm/4 + the [three]
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Living Forge'), hostId: host });
  const modId = ent(h, host)!.mods[0]!;
  assert.equal(ent(h, modId)!.card, 'Living Forge');
  h.do({ type: 'activateAbility', seat: p, entityId: host, abilityIndex: 0, via: { mod: modId } });
  const robots = unitsOf(h, p).filter(u => u.card === 'Robot');
  assert.equal(robots.length, 1, 'the donated activated ability made a Robot');
  assert.equal(robots[0]!.counters, 2);
});

// ── Manufacture ──────────────────────────────────────────────────────────

test('Manufacture: creates a Robot 3, a Robot 2 and a Robot 1 at home (R28)', () => {
  const h = new Harness(2714);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'metal', 6);                          // mmm/6
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Manufacture') });
  const robots = unitsOf(h, p).filter(u => u.card === 'Robot');
  assert.deepEqual(robots.map(r => r.counters).sort(), [1, 2, 3], 'a 3, a 2 and a 1');
  assert.ok(robots.every(r => r.region === homeOf(h, p)), 'all at home (R28)');
  assert.ok(robots.every(r => r.token), 'tokens');
  assert.ok(h.state.players[p]!.bin.includes('Manufacture'), 'the spell → bin');
});

// ── Monke ────────────────────────────────────────────────────────────────

test('Monke: plays as a battle-timing 1/1 into the battle', () => {
  const h = new Harness(2715);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 1);                          // m/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Monke') });
  pass(h); pass(h);                                         // the unit item resolves
  const monke = unitsOf(h, A).find(u => u.card === 'Monke')!;
  assert.ok(monke, 'spawned during battle');
  assert.deepEqual(effStats(h, monke.id), [1, 1]);
  assert.equal(monke.region, h.state.battle!.region);
  finishBattle(h);
});

test('Monke: R62 — other units lose all attributes and abilities during battle', () => {
  const h = new Harness(2723);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const mine = spawn(h, A, 'Ephemeral Skywalker');          // 3/1 {Flying}
  const theirs = spawn(h, D, 'Ephemeral Skywalker');
  giveResources(h, A, 'metal', 1);                          // m/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  assert.ok(ownAttrs(h, mine).has('Flying'), 'before Monke arrives');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Monke') });
  pass(h); pass(h);                                         // the unit item resolves
  const monke = unitsOf(h, A).find(u => u.card === 'Monke')!;
  assert.equal(ownAttrs(h, mine).size, 0, '"other units" — mine included');
  assert.equal(ownAttrs(h, monke.id).size, 0, 'Monke is a vanilla 1/1 either way');
  assert.ok(new E(h.state).abilitiesSuppressed(ent(h, mine)!), 'and their abilities');
  // "if I spawned this turn" and "during battle" are both live conditions
  finishBattle(h);
  assert.ok(ownAttrs(h, mine).has('Flying'), 'out of battle: everything is back');
  void theirs;
});

test('Monke: "other units" is both sides — it turns the whole battle vanilla', () => {
  const h = new Harness(2724);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const mine = spawn(h, A, 'Unit Token');
  const theirs = spawn(h, D, 'Ephemeral Skywalker');        // 3/1 {Flying}
  giveResources(h, A, 'metal', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Monke') });
  pass(h); pass(h);
  assert.equal(ownAttrs(h, theirs).size, 0, 'the text says units, not YOUR units');
  finishBattle(h);
});

// ── Nebula Drifter ───────────────────────────────────────────────────────

test('Nebula Drifter: a 1/1 flier; as a Virus augment it grants Flying', () => {
  const h = new Harness(2716);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const nd = spawn(h, A, 'Nebula Drifter');
  assert.deepEqual(effStats(h, nd), [1, 1]);
  assert.ok(ownAttrs(h, nd).has('Flying'), 'printed Flying');
  const host = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 1);                          // m/1 Virus
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Nebula Drifter'), hostId: host });
  pass(h); pass(h);                                         // the virus resolves
  assert.equal(ent(h, host)!.mods.length, 1, 'virus augment attached in battle');
  assert.ok(ownAttrs(h, host).has('Flying'), 'the type-line [Augment] grants Flying');
  finishBattle(h);
});

// ── Omniwield Evoker ─────────────────────────────────────────────────────

test('Omniwield Evoker: [three] puts a counter on me; a grafted Foretell rides the cause', () => {
  const h = new Harness(2717);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const ev = spawn(h, p, 'Omniwield Evoker');               // 2/1
  giveResources(h, p, 'metal', 4);                          // Foretell m/1 + the [three]
  h.do({ type: 'graft', seat: p, from: 'hand', index: give(h, p, 'Foretell'), hostId: ev, position: 0 });
  assert.equal(ent(h, ev)!.mods.length, 1, 'Foretell grafted onto the cause');
  const top = h.q.deckOf(p)[0]!;
  h.do({ type: 'activateAbility', seat: p, entityId: ev, abilityIndex: 0 });
  assert.equal(ent(h, ev)!.counters, 1, 'a +1/+1 counter on me');
  assert.deepEqual(effStats(h, ev), [3, 2]);
  assert.deepEqual(cacheOf(h, p).map(c => c.card), [top],
    'the grafted Foretell Glimpsed the top card into the cache (R45), not into hand');
  assert.ok(!h.state.players[p]!.hand.includes(top), 'and it is NOT in hand');
  assert.equal(h.q.cachePermission(p, 0), 'glimpse');
  assert.equal(h.state.players[p]!.resources.filter(r => r.state === 'open').length, 0, '1 + 3 paid');
});

// ── Perish ───────────────────────────────────────────────────────────────

test('Perish: each player here sacrifices half of their units, rounded up', () => {
  const h = new Harness(2718);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const a1 = spawn(h, A, 'Unit Token');
  const a2 = spawn(h, A, 'Unit Token');
  const a3 = spawn(h, A, 'Unit Token');
  const d1 = spawn(h, D, 'Lurking Slimebeast');
  const d2 = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'metal', 4);                          // mm/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1], [a2], [a3]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Perish') });
  pass(h); pass(h);                                         // resolve
  assert.equal(h.state.decision!.seat, A, 'the caster picks first');
  pick(h, a1);                                              // A: 3 units → sacrifice 2
  pick(h, a2);
  assert.equal(h.state.decision!.seat, D, 'then the opponent');
  pick(h, d1);                                              // D: 2 units → sacrifice 1
  assert.ok(!ent(h, a1) && !ent(h, a2), 'A sacrificed two');
  assert.ok(ent(h, a3), 'and kept the third');
  assert.ok(!ent(h, d1), 'D sacrificed one');
  assert.ok(ent(h, d2), 'and kept the other');
  assert.ok(h.state.players[D]!.bin.includes('Lurking Slimebeast'), 'sacrifices go to the bin');
  assert.equal(h.state.players[A]!.bin.filter(c => c === 'Unit Token').length, 2, 'both of A\'s picks binned');
  finishBattle(h);
});

// ── Powerforge Synergist ─────────────────────────────────────────────────

test('Powerforge Synergist: spawns with two +1/+1 counters (0/0 base → 2/2)', () => {
  const h = new Harness(2719);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const pf = spawn(h, p, 'Powerforge Synergist');
  assert.equal(ent(h, pf)!.counters, 2, 'two counters on arrival (spawn-trigger approximation)');
  assert.deepEqual(effStats(h, pf), [2, 2]);
});

test('Powerforge Synergist: dies in combat → move my counters onto target unit (R31)', () => {
  const h = new Harness(2720);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const pf = spawn(h, A, 'Powerforge Synergist');           // 2/2 with its counters
  const ally = spawn(h, A, 'Unit Token');
  const blocker = spawn(h, D, 'Lurking Slimebeast');        // 8/3 — kills it in combat
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[pf], [ally]] });
  pass(h); pass(h);                                         // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  pass(h); pass(h);                                         // combat: the Synergist dies
  // R31: the died trigger resolves immediately between sub-steps — target now
  assert.equal(h.state.decision!.seat, A, 'the controller aims the counter move');
  pick(h, { unit: ally });
  assert.ok(!ent(h, pf), 'the Synergist died');
  assert.ok(h.state.players[A]!.bin.includes('Powerforge Synergist'), '→ bin');
  assert.equal(ent(h, ally)!.counters, 2, 'both counters moved');
  assert.deepEqual(effStats(h, ally), [3, 3], '1/1 + 2 counters');
  finishBattle(h);
});

// ── Reforge the Dead ─────────────────────────────────────────────────────

test('Reforge the Dead: R63 — your units gain "When I die, create a Robot 3."', () => {
  const h = new Harness(2721);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 3);                          // mm/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Reforge the Dead') });
  pass(h); pass(h);                                         // resolve
  assert.ok(h.state.players[A]!.bin.includes('Reforge the Dead'), 'resolved → bin');
  assert.equal(ent(h, tok)!.granted?.length, 1, 'the grant landed on the unit');
  assert.equal(ent(h, tok)!.granted?.[0]?.text, 'When I die, create a Robot 3.');
  // and it actually fires: the spell is long gone, the reference is not
  {
    const e = new E(h.state);
    e.destroy(ent(h, tok)!, 'is deleted');
    e.settle();
  }
  pass(h); pass(h);                                         // resolve the granted trigger
  const robot = unitsOf(h, A).find(u => u.card === 'Robot');
  assert.ok(robot, 'a Robot was created');
  assert.equal(robot!.counters, 3, 'a Robot 3');
  assert.equal(unitsOf(h, D).filter(u => u.card === 'Robot').length, 0, 'only YOUR units');
  finishBattle(h);
});

test('Reforge the Dead: the grant is until regroup, and only for units already there', () => {
  const h = new Harness(2725);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const early = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[early]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Reforge the Dead') });
  pass(h); pass(h);
  const late = spawn(h, A, 'Unit Token');
  assert.equal(ent(h, late)!.granted, undefined, 'arrived after the spell resolved');
  finishBattle(h);
  assert.equal(ent(h, early)!.granted, undefined, 'cleared at regroup');
});
