/* Per-card tests for the light-b batch (project rule: a test for every card).
 * States are built explicitly (spawn/give/giveResources, explicit life totals
 * and deck tops) so parallel card registration can't shift assertions; seeds
 * are 3900-3999.
 *
 * Covers: the parked Banishment (crash-free) and Proph, end-of-turn caching
 * with a granted prophecy and debt (Blurf), a debt-cost activated pump with a
 * [once] budget (Debt Blep), retargeting a spell on the stack (Divine
 * Intervention), {Blessed} + the gain-life drain (Flzzz), debt on attack
 * (Glutton of Absolution), cache-a-unit-with-a-prophecy on attack (Grob) and
 * at battle speed (Waxen Witness), parity-split symmetry (Insatiable Want),
 * life-fuelled pump (Life Channel), the end-of-turn hand bank (Living Vault),
 * the parity Virus (Ploosh), the conditional Virus static (Riftspawn Remnant),
 * an X drain/heal (Siphon Life), erase-for-life (Stellar Fission), the free
 * prophecy release (The Foretold) and symmetric halving (Visage of Ruin).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { IllegalAction } from '../src/apply.ts';
import {
  effStats, ent, finishBattle, give, giveResources, offered, pass, pick,
  spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';
import type { Seat } from '../src/types.ts';

/** Run raw engine calls against the harness state, absorbing a suspension.
 * E may REPLACE its state object on a mid-part rollback, so h.state is
 * re-pointed afterwards. */
function withE(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state);
  try {
    fn(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
}

/** the cache entries of a seat (R41: public information, so tests just read) */
const cacheOf = (h: Harness, seat: Seat) => h.state.players[seat]!.cache ?? [];

/** empty a hand so a choice list is exactly what the test put there */
function clearHand(h: Harness, seat: Seat): void {
  h.state.players[seat]!.hand.length = 0;
}

// ── Banishment ───────────────────────────────────────────────────────────

test('Banishment: erases units that spawned this turn, and spares the older ones', () => {
  const h = new Harness(3901);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');                    // spawned LAST turn
  const old = spawn(h, D, 'Unit Token');                    // spawned LAST turn
  giveResources(h, A, 'light', 3);                          // l/3
  toNextBattle(h, A);
  // R12/R25: the spell sweeps the region it resolves in — the battle region,
  // which is the defender's home. Both of D's units sit there.
  const fresh = spawn(h, D, 'Unit Token');
  assert.equal(ent(h, old)!.spawnedTurn, h.state.turn - 1, 'the old one carries last turn\'s stamp');
  assert.equal(ent(h, fresh)!.spawnedTurn, h.state.turn);

  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Banishment') });
  pass(h); pass(h);
  assert.ok(!ent(h, fresh), 'everything that spawned this turn is erased');
  assert.ok(ent(h, old), 'and everything older survives');
  assert.ok(!h.state.players[A]!.bin.includes('Unit Token'),
    'erased means erased: no bin, no death (and a token would not bin anyway)');
  assert.ok(h.state.players[A]!.bin.includes('Banishment'), 'the spell resolved → bin');
  finishBattle(h);
});

test('Banishment: a unit that spawned during [Haste] is erased too', () => {
  const h = new Harness(3931);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const D = 1 - A;
  const old = spawn(h, D, 'Unit Token');
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 3);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.state.initiative = A;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  // a haste-step spawn carries THIS turn's stamp, exactly like any other
  const hasted = spawn(h, D, 'Unit Token');
  assert.equal(ent(h, hasted)!.spawnedTurn, h.state.turn);
  for (const seat of [0, 1]) {
    if (h.state.phase === 'planning' && h.state.hasteDone && !h.state.hasteDone[seat]) {
      h.do({ type: 'doneHaste', seat });
    }
  }
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Banishment') });
  pass(h); pass(h);
  assert.ok(!ent(h, hasted), 'the haste-step spawn is erased');
  assert.ok(ent(h, old), 'the older unit is not');
  finishBattle(h);
});

// ── Blurf ────────────────────────────────────────────────────────────────

test("Blurf: end of turn — caches the deck top with 'Prophecy: 1 turn passes' and gains its cost in debt", () => {
  const h = new Harness(3902);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Blurf');
  h.state.sharedDeck.unshift('Noxious Demise');             // a known [1] deck top
  const cost = h.q.card('Noxious Demise').mana as number;

  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });   // end of turn fires here

  const cache = cacheOf(h, A);
  assert.equal(cache.length, 1, 'the deck top was cached');
  assert.equal(cache[0]!.card, 'Noxious Demise');
  assert.equal(cache[0]!.prophecy!.norm, '1 turn passes',
    "the inconsistently printed 'Prophecy: 1 turn passes' normalises onto the turns row");
  assert.equal(cache[0]!.prophecy!.turn, h.state.turn - 1,
    'stamped on the turn it was cached — it counts forward from there (R43)');
  assert.ok(cache[0]!.prophecy!.fulfilled,
    'cached at the very end of a turn, so the turn flip immediately satisfies "1 turn passes"');
  assert.equal(h.state.players[A]!.debt, cost, "debt equal to the cached card's cost (R39)");
});

// ── Debt Blep ────────────────────────────────────────────────────────────

test('Debt Blep: [once] gain 2 debt for +3/+3 until regroup — and only once a turn', () => {
  const h = new Harness(3903);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const blep = spawn(h, A, 'Debt Blep');                    // 1/1
  assert.deepEqual(effStats(h, blep), [1, 1]);

  h.do({ type: 'activateAbility', seat: A, entityId: blep, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.players[A]!.debt, 2, 'the debt cost was paid (at resolution, R39)');
  assert.deepEqual(effStats(h, blep), [4, 4], '+3/+3 until regroup');

  assert.throws(
    () => h.do({ type: 'activateAbility', seat: A, entityId: blep, abilityIndex: 0, via: 'augment' }),
    IllegalAction, '[once] is a per-turn budget (R9)');
  assert.equal(h.state.players[A]!.debt, 2, 'no second debt');
});

// ── Divine Intervention ──────────────────────────────────────────────────

test("Divine Intervention: may change the targets of an effect on the stack", () => {
  const h = new Harness(3904);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Good Whale');                    // 7/5, survives a -1/-1
  const blk = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'light', 5);                          // ll/5
  giveResources(h, D, 'wood', 2);                           // gg/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });

  // D aims a -1/-1 counter at A's attacker …
  while (h.state.priority !== D) pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Noxious Demise') });
  pick(h, { unit: atk });
  // … and A turns it around
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Divine Intervention') });
  pick(h, { stack: h.state.stack[0]!.id });
  pass(h); pass(h);                                         // resolve Divine Intervention
  assert.equal(h.state.decision!.seat, A, 'the caster is asked whether to change anything');
  pick(h, true);
  pick(h, { unit: blk });                                   // the new target
  assert.equal(h.state.stack.length, 1, 'Noxious Demise is still on the stack');
  pass(h); pass(h);                                         // resolve it, now retargeted
  assert.equal(ent(h, atk)!.counters, 0, 'the original target is untouched');
  assert.equal(ent(h, blk)!.counters, -1, "the counter landed on D's own unit");
  finishBattle(h);
});

test('Divine Intervention: "you may" — declining leaves the targets alone', () => {
  const h = new Harness(3905);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Good Whale');                    // 7/5, survives a -1/-1
  spawn(h, D, 'Good Whale');
  giveResources(h, A, 'light', 5);
  giveResources(h, D, 'wood', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  while (h.state.priority !== D) pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Noxious Demise') });
  pick(h, { unit: atk });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Divine Intervention') });
  pick(h, { stack: h.state.stack[0]!.id });
  pass(h); pass(h);
  pick(h, false);                                           // "leave them"
  pass(h); pass(h);
  assert.equal(ent(h, atk)!.counters, -1, 'the original target still takes it');
  finishBattle(h);
});

/*
 * Playtest ledger #6 (MNWK, 2026-08-19), "I'm unable to cast Divine
 * Intervention at all", was closed by R60: the printed line is "You may change
 * the targets of TARGET EFFECT", and "effect" is the SUPERSET — every spell,
 * spell unit, spell token and ambush, PLUS the triggered and activated
 * abilities. The engine spells that as `what: 'stackEffect'`, against
 * `'stackSpell'` for the cards that really do say "target spell".
 *
 * But both tests above aim Divine Intervention at a SPELL, and a spell is
 * legal under BOTH specs. Narrow the card back to 'stackSpell' and neither of
 * them notices — the only thing keeping the superset honest was Hush Mush's
 * test in 23-wood-a, a different card in a different file, which is a guard by
 * coincidence rather than by intent. The ledger entry said so in as many
 * words: "the real guard is Hush Mush's. A DI-against-a-trigger case would
 * close it."
 *
 * This is that case. Both halves of the superset are on the stack at once — a
 * spell AND a triggered ability, each holding a target — so the test cannot
 * pass by accident: it asserts the trigger is on the menu (which 'stackSpell'
 * would not offer) and then retargets it.
 */
test('Divine Intervention: "target effect" reaches a TRIGGER on the stack, not just a spell (R60)', () => {
  const h = new Harness(3905.5);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');                    // 7/5 attacker, survives everything here
  // D's Behemoth: "[Augment] Whenever you play a spell, I deal 1 damage to any
  // target." Its own [Augment] text is live while it is a unit in play, so
  // D casting anything queues a TRIGGER that holds a target of its own.
  const volt = spawn(h, D, 'Voltwrath Behemoth');           // 5/4, survives its own 1 damage
  giveResources(h, A, 'light', 5);                          // Divine Intervention: ll/5
  giveResources(h, D, 'wood', 2);                           // Noxious Demise: gg/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });

  while (h.state.priority !== D) pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Noxious Demise') });
  pick(h, { unit: atk });                                   // the SPELL aims at A's attacker
  pick(h, { unit: atk });                                   // and so does the Behemoth's trigger

  const spellItem = h.state.stack.find(i => i.kind === 'spell')!;
  const trigItem = h.state.stack.find(i => i.kind === 'triggered')!;
  assert.ok(spellItem && trigItem, 'a spell AND a trigger are both waiting on the stack');

  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Divine Intervention') });
  // THE ASSERTION THAT CLOSES #6: under a 'stackSpell' spec only the Noxious
  // Demise item is a candidate and this menu does not contain the trigger.
  assert.ok(offered(h).includes(JSON.stringify({ stack: trigItem.id })),
    `R60: the triggered ability is a legal "target effect" — menu was [${offered(h)}]`);
  pick(h, { stack: trigItem.id });

  pass(h); pass(h);                                         // resolve Divine Intervention
  assert.equal(h.state.decision!.seat, A, 'the caster is asked whether to change anything');
  pick(h, true);
  pick(h, { unit: volt });                                  // send the damage back at its own source

  pass(h); pass(h);                                         // resolve the retargeted trigger
  assert.equal(ent(h, volt)!.damage, 1, "the Behemoth's own ping landed on the Behemoth");
  assert.equal(ent(h, atk)!.damage, 0, 'and never reached the attacker it was aimed at');

  pass(h); pass(h);                                         // resolve Noxious Demise, untouched
  assert.equal(ent(h, atk)!.counters, -1,
    'the SPELL was left alone — Divine Intervention retargeted the trigger, not everything in sight');
  finishBattle(h);
});

// ── Flzzz ────────────────────────────────────────────────────────────────

test('Flzzz: whenever you gain life, each opponent in the region loses that much (R25)', () => {
  const h = new Harness(3906);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const flz = spawn(h, A, 'Flzzz');
  assert.ok(h.q.ownAttrs(ent(h, flz)!).has('Blessed'), '{Blessed} comes from the printed attribute');

  // R25: out of battle a home region lists only its owner, so there is no
  // opponent present to drain. This is the standing region-scoped reading that
  // every other "each opponent" in the expansion uses.
  let before = h.state.players[D]!.life;
  withE(h, e => e.gainLife(A, 4, 'test'));
  assert.equal(h.state.players[D]!.life, before, 'no opponent is present during deployment');

  // …but when the battle comes to Flzzz's region both players are present
  // there, and it drains. (A DEFENDS, so the battle region is A's home.)
  const raider = spawn(h, D, 'Unit Token');
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  assert.equal(h.state.battle!.region, ent(h, flz)!.region, 'the battle is where Flzzz is');
  before = h.state.players[D]!.life;
  withE(h, e => e.gainLife(A, 4, 'test'));
  let guard = 10;
  while (h.state.stack.length && !h.state.decision && guard-- > 0) pass(h);   // in battle it uses the stack
  assert.equal(h.state.players[D]!.life, before - 4, 'the opponent loses the gained amount');
  finishBattle(h);
});

test("Flzzz: {Blessed} combat damage feeds its own drain", () => {
  const h = new Harness(3907);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const flz = spawn(h, A, 'Flzzz');                         // 1/3 {Blessed}
  const aLife = h.state.players[A]!.life, dLife = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[flz]] });
  finishBattle(h);
  assert.equal(h.state.players[A]!.life, aLife + 1, 'Blessed: 1 damage dealt → 1 life gained (R48)');
  assert.equal(h.state.players[D]!.life, dLife - 1 - 1,
    'the 1 combat damage plus 1 more from the drain the gain triggered');
});

// ── Glutton of Absolution ────────────────────────────────────────────────

test('Glutton of Absolution: 3 debt when it attacks — bounded to once a turn', () => {
  const h = new Harness(3908);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const glut = spawn(h, A, 'Glutton of Absolution');        // 7/7 for [3]
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[glut]] });
  pass(h); pass(h);                                         // resolve the trigger
  assert.equal(h.state.players[A]!.debt, 3, 'attacking gains 3 debt (R39)');
  finishBattle(h);
  assert.equal(h.state.players[A]!.debt, 3, 'blocking in round 2 does not add — [Switch1] is bounded');
});

test('Glutton of Absolution: the debt is paid off at the next resource step (R39)', () => {
  const h = new Harness(3909);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const glut = spawn(h, A, 'Glutton of Absolution');
  giveResources(h, A, 'light', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[glut]] });
  pass(h); pass(h);
  assert.equal(h.state.players[A]!.debt, 3);
  finishBattle(h);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'donePlanning', seat: A });
  assert.equal(h.state.players[A]!.debt, 0, 'mandatory, automatic, at the END of the resource step');
  assert.equal(h.q.openMana(A), 1, '3 of the 4 mana went to the debt and cannot be cast with');
});

// ── Grob ─────────────────────────────────────────────────────────────────

test("Grob: on attack, up to one unit's controller caches it with 'One Battle Passes'", () => {
  const h = new Harness(3910);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const grob = spawn(h, A, 'Grob');
  const victim = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[grob]] });
  pick(h, { unit: victim });                                // targets are collected as the trigger stacks
  pass(h); pass(h);                                         // resolve it
  assert.ok(!ent(h, victim), 'the unit left play');
  const cache = cacheOf(h, D);
  assert.equal(cache.length, 1, "into its OWNER's cache (R46)");
  assert.equal(cache[0]!.card, 'Good Whale');
  assert.equal(cache[0]!.prophecy!.norm, '1 battle passes', 'with the granted prophecy attached');
  finishBattle(h);
  // R43: in 1v1 BOTH battle rounds tick, so one full battle phase fulfils it
  assert.ok(cacheOf(h, D)[0]!.prophecy!.fulfilled, 'fulfilled once a battle has passed');
});

test('Grob: "up to one" — declining a target still resolves the trigger', () => {
  const h = new Harness(3911);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const grob = spawn(h, A, 'Grob');
  const victim = spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[grob]] });
  pick(h, { doneTargets: true });                           // min: 0
  pass(h); pass(h);
  assert.ok(ent(h, victim), 'nothing was cached');
  assert.equal(cacheOf(h, D).length, 0);
  finishBattle(h);
});

// ── Insatiable Want ──────────────────────────────────────────────────────

test('Insatiable Want: even life sacrifices, odd life draws (parity snapshotted first)', () => {
  const h = new Harness(3912);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Good Whale');
  giveResources(h, A, 'light', 1);                          // l/1
  toNextBattle(h, A);
  h.state.players[A]!.life = 20;                            // even → sacrifices
  h.state.players[D]!.life = 19;                            // odd  → draws
  const dHand = h.state.players[D]!.hand.length;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Insatiable Want') });
  pass(h); pass(h);                                         // resolve
  assert.equal(h.state.decision!.seat, A, 'the even-life player picks their own sacrifice');
  pick(h, atk);
  assert.ok(!ent(h, atk), 'the even-life player sacrificed a unit');
  assert.equal(h.state.players[D]!.hand.length, dHand + 1, 'the odd-life player drew');
  assert.equal(unitsOf(h, D).length, 1, 'and kept their unit');
  finishBattle(h);
});

// ── Life Channel ─────────────────────────────────────────────────────────

test("Life Channel: gain 3 life, then target unit gains +X/+X (X = life gained this battle)", () => {
  const h = new Harness(3913);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');                    // 1/1
  spawn(h, D, 'Unit Token');
  giveResources(h, A, 'light', 2);                          // l/2
  toNextBattle(h, A);
  const life = h.state.players[A]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Life Channel') });
  pick(h, { unit: atk });
  pass(h); pass(h);
  assert.equal(h.state.players[A]!.life, life + 3, 'you gain 3 life');
  assert.deepEqual(effStats(h, atk), [4, 4], 'X = the 3 just gained → +3/+3 until regroup');
  finishBattle(h);
  assert.deepEqual(effStats(h, atk), [1, 1], 'the pump ends at regroup');
});

test('Life Channel: X counts OTHER life gained this battle too, and never double-counts its own 3', () => {
  const h = new Harness(3933);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const atk = spawn(h, A, 'Unit Token');                    // 1/1
  giveResources(h, A, 'light', 2);                          // l/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // 5 life gained earlier in this battle by something else
  withE(h, e => e.gainLife(A, 5, 'test'));
  assert.equal(h.q.battleCounter(h.state.battle!.region, `lifeGained:${A}`), 5,
    'E.gainLife bumps the per-battle ledger, mirroring lifeLost');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Life Channel') });
  pick(h, { unit: atk });
  pass(h); pass(h);
  assert.deepEqual(effStats(h, atk), [9, 9],
    'X = 5 already gained + this spell\'s own 3 = 8, counted exactly once');
  assert.equal(h.q.battleCounter(h.state.battle!.region, `lifeGained:${A}`), 8,
    'and the ledger itself now reads 8');
  finishBattle(h);
});

test('Life Channel: the [Switch1] graft rider reads the ledger straight', () => {
  const h = new Harness(3934);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  withE(h, e => e.gainLife(A, 4, 'test'));
  // run the graft half directly: it is the buff clause alone, no "gain 3"
  withE(h, (e) => {
    const def = h.q.card('Life Channel').graftEffect!.effect;
    def.run(e, {
      controller: A, sourceName: 'Life Channel', region: h.state.battle!.region,
      targets: [h.state.entities[atk]!], event: null,
      eraseSelf: () => {},   // no stack item here — a direct-run ctx
      choose: () => { throw new Error('no choice expected'); },
    });
  });
  assert.deepEqual(effStats(h, atk), [5, 5], 'X = the 4 gained this battle');
  finishBattle(h);
});

test('Living Vault: an X-cost card in hand is offered at pay [0] (R157 §1)', () => {
  // R157 §1: an X card's cost is the X actually PAID, and a card in a HAND has
  // had no X paid — so its cost is 0, not "unknown". `printedMana` used to
  // return null for X and the option filter dropped it, so an X card was never
  // offered AT ALL. That was a THIRD answer to one question: manaOf said 0,
  // this said "excluded", Null Drone said "the paid X". One rule now.
  const h = new Harness(9001);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  h.state.players[P]!.hand.length = 0;
  h.state.players[P]!.hand.push('Mindburn');          // printed mana: 'X'
  const e = new E(h.state);
  assert.equal(e.card('Mindburn').mana, 'X', 'the premise: Mindburn is an X spell');

  let labels: string[] = [];
  const def = e.card('Living Vault').augmentText![0]!.effect;
  def.run(e, {
    controller: P, sourceName: 'Living Vault', region: e.homeRegion(P),
    targets: [], x: undefined, event: null,
    choose: (_k: string, q: { options: { label: string }[] }) => {
      labels = q.options.map(o => o.label);
      return -1;                                       // decline; we only want the menu
    },
  } as never);

  assert.ok(labels.some(l => l.includes('Mindburn')),
    `an X card in hand must be OFFERED — its cost is 0 because no X has been paid. `
    + `Offered: ${JSON.stringify(labels)}`);
  assert.ok(labels.some(l => l.includes('Mindburn') && l.includes('[0]')),
    `and priced at [0], not at a pip total. Offered: ${JSON.stringify(labels)}`);
});
// ── Living Vault ─────────────────────────────────────────────────────────

test("Living Vault: end of turn, pay [x] to bank a hand card with 'Prophecy — One Turn Passes'", () => {
  const h = new Harness(3914);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Living Vault');
  giveResources(h, A, 'light', 2);
  clearHand(h, A);
  give(h, A, 'Good Whale');                                 // the only bankable card
  const cost = h.q.card('Good Whale').mana as number;
  giveResources(h, A, 'light', cost);                       // make sure [x] is payable

  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  assert.ok(h.state.decision, 'the end-of-turn choice is asked for real (turnEnding resumes it)');
  assert.equal(h.state.decision!.seat, A);
  pick(h, 0);                                               // hand index 0

  const cache = cacheOf(h, A);
  assert.equal(cache.length, 1, 'the card was banked into the cache');
  assert.equal(cache[0]!.card, 'Good Whale');
  assert.equal(cache[0]!.prophecy!.norm, '1 turn passes');
  assert.equal(h.state.players[A]!.hand.filter(c => c === 'Good Whale').length, 0, 'and left the hand');
  assert.equal(h.state.phase, 'planning', 'the turn flip completed after the decision');
});

test('Living Vault: "you may" — declining banks nothing and spends nothing', () => {
  const h = new Harness(3915);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Living Vault');
  clearHand(h, A);
  give(h, A, 'Noxious Demise');                             // [1]
  giveResources(h, A, 'light', 2);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  pick(h, -1);                                              // decline
  assert.equal(cacheOf(h, A).length, 0, 'nothing cached');
  assert.ok(h.state.players[A]!.hand.includes('Noxious Demise'), 'the card stayed in hand');
});

// ── Ploosh ───────────────────────────────────────────────────────────────

test('Ploosh: after combat with an ODD life total — gain 3 and draw', () => {
  const h = new Harness(3916);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const ploosh = spawn(h, A, 'Ploosh');                     // 2/2 {Virus}
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.state.players[A]!.life = 19;                            // odd
  const hand = h.state.players[A]!.hand.length;
  h.do({ type: 'declareAttack', seat: A, columns: [[ploosh]] });
  finishBattle(h);
  assert.equal(h.state.players[A]!.life, 19 + 3, 'odd: gain 3 life');
  assert.equal(h.state.players[A]!.hand.length, hand + 1, 'and draw a card');
  assert.ok(ent(h, ploosh), 'and it survives');
});

test('Ploosh: as a Virus on an enemy unit with an EVEN life total — the HOST is sacrificed', () => {
  const h = new Harness(3917);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const host = spawn(h, D, 'Good Whale');                   // D's blocker becomes the host
  giveResources(h, A, 'light', 2);                          // l/2 Virus
  toNextBattle(h, A);
  h.state.players[D]!.life = 20;                            // even → the host dies
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);                                         // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [host] } });
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Ploosh'), hostId: host });
  pass(h); pass(h);                                         // the Virus resolves onto the host
  assert.equal(ent(h, host)!.mods.length, 1, 'Ploosh rode on as a Virus');
  finishBattle(h);
  assert.ok(!ent(h, host), 'even life: "sacrifice me" reads the HOST');
  assert.equal(h.state.players[D]!.life, 20 - 3, 'and "you" is the host\'s controller');
});

// ── Proph ────────────────────────────────────────────────────────────────

test('Proph: draws when you play a card from your CACHE, and not from your hand', () => {
  const h = new Harness(3918);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const proph = spawn(h, A, 'Proph');

  // a play from HAND does not feed it (data.from === 'hand')
  giveResources(h, A, 'light', 12);
  let hand = h.state.players[A]!.hand.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'The Foretold') });
  assert.equal(h.state.players[A]!.hand.length, hand,
    'a hand play draws nothing — that is the whole point of the card');

  // a play from the CACHE does
  h.state.sharedDeck.unshift('The Foretold');               // l/3
  withE(h, e => { e.cacheTopOfDeck(A, 1, { playable: true }); });
  hand = h.state.players[A]!.hand.length;
  h.do({ type: 'playCached', seat: A, index: 0 });
  assert.ok(ent(h, proph), 'still there');
  assert.equal(h.state.players[A]!.hand.length, hand + 1, 'the cache play drew a card');
  assert.equal(unitsOf(h, A).filter(u => u.card === 'The Foretold').length, 2,
    'both copies really arrived');

  // [Switch1] is a per-turn budget (R9): a second cache play draws nothing
  h.state.sharedDeck.unshift('The Foretold');
  withE(h, e => { e.cacheTopOfDeck(A, 1, { playable: true }); });
  hand = h.state.players[A]!.hand.length;
  h.do({ type: 'playCached', seat: A, index: 0 });
  assert.equal(h.state.players[A]!.hand.length, hand, '[Switch1]: once per turn (R9)');
});

test('Proph: R37 — augmenting out of the cache is APPLYING a mod, not playing a card', () => {
  const h = new Harness(3932);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Proph');
  const host = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 6);
  h.state.sharedDeck.unshift('Blob of the Dark Order');     // l/3, an [Augment] card
  withE(h, e => { e.cacheTopOfDeck(A, 1, { playable: true }); });
  const hand = h.state.players[A]!.hand.length;
  h.do({ type: 'augment', seat: A, from: 'cache', index: 0, hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'the mod really attached');
  assert.equal(h.state.players[A]!.hand.length, hand,
    'R37: applying a mod is not playing a card, so Proph stays quiet');
});

// ── Riftspawn Remnant ────────────────────────────────────────────────────

test('Riftspawn Remnant: +4/-4 while you have lost life this battle', () => {
  const h = new Harness(3919);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const rift = spawn(h, A, 'Riftspawn Remnant');            // 0/5
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk, rift]] });
  assert.deepEqual(effStats(h, rift), [0, 5], 'no life change yet — the wall stays a wall');
  withE(h, e => e.loseLife(A, 1, 'test'));
  assert.deepEqual(effStats(h, rift), [4, 1], 'life lost this battle → +4/-4');
  finishBattle(h);
  assert.deepEqual(effStats(h, rift), [0, 5], 'out of battle the condition is off again');
});

test('Riftspawn Remnant: life GAINED this battle also switches it on', () => {
  const h = new Harness(3935);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const rift = spawn(h, A, 'Riftspawn Remnant');            // 0/5
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk, rift]] });
  assert.deepEqual(effStats(h, rift), [0, 5], 'no life change yet');
  withE(h, e => e.gainLife(A, 2, 'test'));
  assert.deepEqual(effStats(h, rift), [4, 1], 'life GAINED this battle → +4/-4 (R49 ledger)');
  finishBattle(h);
  assert.deepEqual(effStats(h, rift), [0, 5], 'out of battle the condition is off again');
});

// ── Siphon Life ──────────────────────────────────────────────────────────

test('Siphon Life: X is paid at cast; target player gains or loses X life', () => {
  const h = new Harness(3920);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 3);                          // ll/X
  toNextBattle(h, A);
  const dLife = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Siphon Life') });
  pick(h, 3);                                               // X = 3, paid now (R35)
  assert.equal(h.q.openMana(A), 0, 'X was paid at cast');
  pick(h, { player: D });
  // R57 — the report this fix is named for: "[gains or loses]" is the caster's
  // choice and it is DECLARED AT CAST, after X and the target, before the
  // stack. It used to be asked after both passes, so the opponent spent their
  // window responding to a spell that would not say whether it was a burn or
  // a heal.
  assert.equal(h.state.decision?.kind, 'mode');
  assert.equal(h.state.stack.length, 0, 'not on the stack until the half is named');
  pick(h, 'lose');
  assert.equal(h.state.stack[0]?.parts[0]?.mode, 'lose', 'and it rides on the stack');
  pass(h); pass(h);                                         // resolve
  assert.equal(h.state.players[D]!.life, dLife - 3, 'the target player lost X');
  finishBattle(h);
});

test('Siphon Life: the caster may choose "gains" instead', () => {
  const h = new Harness(3921);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 3);
  toNextBattle(h, A);
  const aLife = h.state.players[A]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Siphon Life') });
  pick(h, 2);
  pick(h, { player: A });
  pick(h, 'gain');                                          // R57: declared at cast
  pass(h); pass(h);
  assert.equal(h.state.players[A]!.life, aLife + 2, 'a heal for X instead');
  finishBattle(h);
});

// ── Stellar Fission ──────────────────────────────────────────────────────

test('Stellar Fission: erases a unit and pays its controller power + defense in life', () => {
  const h = new Harness(3922);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');                  // 7/5
  giveResources(h, A, 'light', 3);                          // lll/3
  toNextBattle(h, A);
  const dLife = h.state.players[D]!.life;
  const dBin = h.state.players[D]!.bin.length;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Stellar Fission') });
  pick(h, { unit: whale });
  pass(h); pass(h);
  assert.ok(!ent(h, whale), 'erased');
  assert.equal(h.state.players[D]!.bin.length, dBin, 'no bin, so no trash (R40)');
  assert.equal(h.state.players[D]!.life, dLife + 12, 'its controller gains 7 + 5 life');
  finishBattle(h);
});

// ── The Foretold ─────────────────────────────────────────────────────────

test('The Foretold: prophesied for [0], then released from cache for free a turn later', () => {
  const h = new Harness(3923);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  clearHand(h, A);
  give(h, A, 'The Foretold');
  h.do({ type: 'prophesy', seat: A, from: 'hand', index: 0 });
  assert.equal(cacheOf(h, A).length, 1, 'the banner card moved to the cache (R42)');
  assert.equal(cacheOf(h, A)[0]!.prophecy!.norm, '1 turn passes');
  assert.ok(!cacheOf(h, A)[0]!.prophecy!.fulfilled, 'not yet — it counts forward (R43)');

  toNextBattle(h, A);
  finishBattle(h);                                          // → regroup → next deployment
  assert.ok(cacheOf(h, A)[0]!.prophecy!.fulfilled, 'one turn has passed');
  assert.equal(h.q.openMana(A), 0, 'and the release needs no mana at all');
  h.do({ type: 'playCached', seat: A, index: 0 });
  assert.equal(unitsOf(h, A).filter(u => u.card === 'The Foretold').length, 1,
    'the 3/3 arrives for free, ignoring affinity (R42)');
  assert.equal(cacheOf(h, A).length, 0, 'and left the cache');
});

// ── Visage of Ruin ───────────────────────────────────────────────────────

test('Visage of Ruin: when it attacks, each player loses half their life, rounded up', () => {
  const h = new Harness(3924);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const visage = spawn(h, A, 'Visage of Ruin');
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.state.players[A]!.life = 20;
  h.state.players[D]!.life = 15;
  h.do({ type: 'declareAttack', seat: A, columns: [[visage]] });
  pass(h); pass(h);                                         // resolve the trigger
  assert.equal(h.state.players[A]!.life, 10, 'symmetric: 20 → 10');
  assert.equal(h.state.players[D]!.life, 7, '15 → 7 (half, rounded up, is 8)');
  finishBattle(h);
});

// ── Waxen Witness ────────────────────────────────────────────────────────

test("Waxen Witness: caches target unit with 'One Battle Passes', then arrives as a 3/3", () => {
  const h = new Harness(3925);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'light', 4);                          // lll/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Waxen Witness') });
  pick(h, { unit: whale });
  pass(h); pass(h);
  assert.ok(!ent(h, whale), 'the target left play');
  assert.equal(cacheOf(h, D)[0]!.card, 'Good Whale', "into its owner's cache");
  assert.equal(cacheOf(h, D)[0]!.prophecy!.norm, '1 battle passes');
  const body = unitsOf(h, A).find(u => u.card === 'Waxen Witness');
  assert.ok(body, 'the spell unit then spawns its body');
  assert.deepEqual(effStats(h, body!.id), [3, 3]);
  finishBattle(h);
});

test('Waxen Witness: mods on the cached unit stay behind and are trashed (R46/R40)', () => {
  const h = new Harness(3926);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'light', 4);
  giveResources(h, D, 'metal', 3);
  // D augments their own whale during deployment, then it gets cached in battle
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Aberrant Statweaver'), hostId: whale });
  assert.equal(ent(h, whale)!.mods.length, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Waxen Witness') });
  pick(h, { unit: whale });
  pass(h); pass(h);
  assert.equal(cacheOf(h, D)[0]!.card, 'Good Whale', 'the card is cached');
  assert.ok(h.state.players[D]!.bin.includes('Aberrant Statweaver'),
    'its mod did NOT travel — it went to the bin (R46)');
  assert.ok(h.events.some(e => e.type === 'trashed' && e.data?.['card'] === 'Aberrant Statweaver'),
    'and entering a bin from play trashes it (R40)');
  finishBattle(h);
});
