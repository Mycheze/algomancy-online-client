/* Per-card tests for the light-c batch (project rule: a test for every card).
 * States are built explicitly (spawn/give/giveResources) so parallel card
 * registration can't shift assertions; seeds are 4000-4099.
 *
 * Covers: {Blessed} lifelink off a printed attribute (Blessed Thing), the
 * whole-stack sweep (Calming Force), bin→cache with an until-end-of-turn
 * stamp (Delver of the Ephemeral, R45), erase-and-replace-in-slot (Feed to
 * Hooba), blessed effect damage (Godray), pay-life activations (Hand Peeper,
 * Life Leech), the life-gain inversion approximation (Nullbringer), the
 * "unless its controller gains debt" dialogue (Reap the Due, R6/R39),
 * Glimpse 1 on spawn (Seer of Empty Spaces, R45), the prophecy banner
 * end-to-end (Tithe Enforcer, R42/R43), the sacrifice-to-negate augment
 * (Void Mandible) and the triple-graft cause (Witness of the Crossing).
 *
 * PARKED cards get a { todo: true } test naming exactly what is missing, plus
 * one shared crash-free registration test: Gatekeeper of Souls, Just a Unit,
 * Prediction Prophet, Slurpr, Suspend.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick, skipHasteStep,
  spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';
import type { CachedCard, Seat } from '../src/types.ts';

/** run raw engine calls against the harness state, absorbing a suspension and
 * keeping the harness log honest (E may REPLACE its state object on a
 * mid-part rollback, so h.state is re-pointed afterwards) */
function whiteBox(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state);
  try {
    fn(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
  h.events.push(...e.events);
  for (const ev of e.events) h.log.push(ev.msg);
}

const cacheOf = (h: Harness, seat: Seat): CachedCard[] => h.state.players[seat]!.cache ?? [];

/** finish deployment for both seats — the turn flips */
function endDeployment(h: Harness): void {
  for (const seat of [0, 1] as Seat[]) {
    if (h.state.phase === 'deploy' && h.state.deployDone && !h.state.deployDone[seat]) {
      h.do({ type: 'doneDeploying', seat });
    }
  }
}

// ── Blessed Thing ────────────────────────────────────────────────────────

test('Blessed Thing: a printed {Blessed} body — its combat damage is lifelink (R48)', () => {
  const h = new Harness(4000);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const bt = spawn(h, A, 'Blessed Thing');                    // 2/2 {Blessed}
  assert.deepEqual(getCard('Blessed Thing').attrs, ['Blessed'], 'the attribute is printed, not scripted');
  assert.deepEqual(getCard('Blessed Thing').augmentAttrs, ['Blessed'],
    'and the type-line [Augment] donates it');
  const lifeA = h.state.players[A]!.life, lifeD = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bt]] });
  pass(h); pass(h);                                           // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                           // combat: 2 unblocked
  assert.equal(h.state.players[D]!.life, lifeD - 2, 'the defender takes 2');
  assert.equal(h.state.players[A]!.life, lifeA + 2, 'and the blessed source gains that much');
  finishBattle(h);
});

// ── Calming Force ────────────────────────────────────────────────────────

test('Calming Force: negates every OTHER effect on the stack', () => {
  const h = new Harness(4001);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 2);                            // Godray: ll/2
  giveResources(h, D, 'light', 2);                            // Calming Force: ll/2
  const lifeD = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Godray') });
  pick(h, { player: D });
  assert.equal(h.state.stack.length, 1, 'Godray is on the stack');
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Calming Force') });
  assert.equal(h.state.stack.length, 2);
  pass(h); pass(h);                                           // Calming Force resolves (top)
  assert.ok(h.log.some(l => l.includes('Calming Force negates 1 other effect')), 'the sweep is logged');
  assert.ok(h.state.stack[0]!.negated, 'Godray is negated');
  pass(h); pass(h);                                           // the negated Godray leaves the stack
  assert.equal(h.state.players[D]!.life, lifeD, 'no damage, no blessed gain');
  assert.ok(h.state.players[A]!.bin.includes('Godray'), 'a negated spell still goes to the bin (R40: from the stack)');
  finishBattle(h);
});

test('Calming Force: "I can\'t be played from your hand" is NOT enforced', { todo: true }, () => {
  // PARKED HALF: a zone restriction on PLAYING lives in apply.ts's doPlayCard,
  // which card code cannot reach. The engine is strictly more permissive than
  // printed — the card is castable from hand today.
});

// ── Delver of the Ephemeral ──────────────────────────────────────────────

test('Delver of the Ephemeral: after combat, caches a cost-1 card from your bin, playable this turn', () => {
  const h = new Harness(4002);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const delver = spawn(h, A, 'Delver of the Ephemeral');      // 0/1, stays home
  const raider = spawn(h, D, 'Unit Token');
  h.state.players[A]!.bin.push('Hand Peeper');                // l/1 — a legal pick
  h.state.players[A]!.bin.push('Gatekeeper of Souls');        // l/4 — not a legal pick
  // A defends, so A's home region IS the battle region and the Delver hears it
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  pass(h); pass(h);                                           // → blocks
  h.do({ type: 'declareBlocks', seat: A, blocks: {} });
  pass(h); pass(h);                                           // combat → afterCombat trigger
  pass(h); pass(h);                                           // resolve the trigger → the bin choice
  const dec = h.state.decision!;
  assert.equal(dec.seat, A, 'the Delver\'s controller chooses');
  assert.deepEqual(dec.options.map(o => o.label), ['Hand Peeper', '(cache nothing)'],
    'only cost-1 cards, plus the "up to one" decline');
  pick(h, 0);                                                 // the bin index of Hand Peeper
  assert.ok(!h.state.players[A]!.bin.includes('Hand Peeper'), 'it LEFT the bin');
  assert.deepEqual(cacheOf(h, A).map(c => c.card), ['Hand Peeper'], 'and is in the cache');
  assert.equal(cacheOf(h, A)[0]!.playableUntilTurn, h.state.turn, 'playable until end of THIS turn');
  assert.equal(h.q.cachePermission(A, 0), 'glimpse', 'R45: pay the mana, ignore affinity');
  assert.ok(ent(h, delver), 'the Delver is still around');
  finishBattle(h);
});

// ── Feed to Hooba ────────────────────────────────────────────────────────

test('Feed to Hooba: erases a unit and gives its controller a 3/3 in its formation slot', () => {
  const h = new Harness(4003);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const front = spawn(h, A, 'Unit Token');
  const back = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 2);                            // l/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[front, back]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Feed to Hooba') });
  pick(h, { unit: front });
  pass(h); pass(h);                                           // resolve
  assert.ok(!ent(h, front), 'the target is erased');
  assert.ok(!h.state.players[A]!.bin.includes('Unit Token'), 'erased, not binned (no trash)');
  const threes = unitsOf(h, A).filter(u => u.tokenStats?.[0] === 3);
  assert.equal(threes.length, 1, 'its controller got a 3/3');
  assert.deepEqual(effStats(h, threes[0]!.id), [3, 3]);
  assert.deepEqual(h.state.battle!.columns[0], [threes[0]!.id, back],
    'it took the erased unit\'s exact position in the formation');
  finishBattle(h);
});

test('Feed to Hooba: the whole sentence is the bounded [Switch1] graft', () => {
  const h = new Harness(4004);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Seer of Empty Spaces');           // graft cause (spawn/die)
  giveResources(h, A, 'light', 2);
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Feed to Hooba'), hostId: host, position: 0 });
  assert.equal(ent(h, host)!.mods.length, 1, 'Feed to Hooba grafted on (it has a [Switch1] effect)');
  // the host's OWN [Switch1] cause was spent by its spawn glimpse, and a spent
  // bounded cause bounds the whole composite (R9) — so wait for the budget
  // reset at the next turn before killing it
  toNextBattle(h, A);
  finishBattle(h);
  const victim = spawn(h, A, 'Unit Token');                   // in the host's region (R12)
  whiteBox(h, e => e.destroy(e.entity(host)!, 'dies'));
  if (h.state.decision) pick(h, { unit: victim });
  assert.ok(!ent(h, victim), 'the grafted erase ran off the death trigger');
  assert.equal(unitsOf(h, A).filter(u => u.tokenStats?.[0] === 3).length, 1, 'and its controller got the 3/3');
});

// ── Gatekeeper of Souls ──────────────────────────────────────────────────

test('Gatekeeper of Souls: "I must be targeted if able" (targeting restriction)', { todo: true }, () => {
  // PARKED: E.targetCandidates builds the legal target set with no filter seam
  // a card can narrow, and "if able" needs the same machinery to fall back
  // when the Gatekeeper is not itself a legal target for that effect.
});

// ── Godray ───────────────────────────────────────────────────────────────

test('Godray: 3 damage to any target, and {Blessed} gains its controller 3 (R48)', () => {
  const h = new Harness(4005);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const target = spawn(h, D, 'Gatekeeper of Souls');          // 0/7 — survives 3
  giveResources(h, A, 'light', 4);
  const lifeA = h.state.players[A]!.life, lifeD = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Godray') });
  pick(h, { unit: target });
  pass(h); pass(h);
  assert.equal(ent(h, target)!.damage, 3, 'the unit took 3');
  assert.equal(h.state.players[A]!.life, lifeA + 3, 'blessed: the caster gained 3');
  assert.equal(h.state.players[D]!.life, lifeD, 'the defender lost nothing');
  finishBattle(h);
});

test('Godray: aimed at a player it damages AND heals on the same check', () => {
  const h = new Harness(4006);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 2);
  const lifeA = h.state.players[A]!.life, lifeD = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Godray') });
  pick(h, { player: D });
  pass(h); pass(h);
  assert.equal(h.state.players[D]!.life, lifeD - 3);
  assert.equal(h.state.players[A]!.life, lifeA + 3);
  finishBattle(h);
});

// ── Hand Peeper ──────────────────────────────────────────────────────────

test('Hand Peeper: pay 3 life to look at target player\'s hand', () => {
  const h = new Harness(4007);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const hp = spawn(h, A, 'Hand Peeper');
  const raider = spawn(h, D, 'Unit Token');
  give(h, D, 'Godray'); give(h, D, 'Suspend');
  // A defends: both seats are present in A's home region, so D is targetable
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  pass(h);                                                    // initiative (D) passes → A acts
  const lifeA = h.state.players[A]!.life;
  h.do({ type: 'activateAbility', seat: A, entityId: hp, abilityIndex: 0, via: 'augment' });
  pick(h, { player: D });
  pass(h); pass(h);                                           // resolve
  assert.equal(h.state.players[A]!.life, lifeA - 3, 'the 3 life was paid (at resolution — see header)');
  assert.deepEqual(h.state.seenHand[A]!.cards, h.state.players[D]!.hand, 'D\'s whole hand was revealed to A');
  assert.ok(h.state.seenHand[A]!.cards.includes('Godray'), 'including what we planted');
  finishBattle(h);
});

test('Hand Peeper: R49 — at exactly 3 life the cost is unpayable and the activation is ILLEGAL', () => {
  const h = new Harness(4008);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const hp = spawn(h, A, 'Hand Peeper');
  const raider = spawn(h, D, 'Unit Token');
  give(h, D, 'Godray');
  toNextBattle(h, D);
  h.state.players[A]!.life = 3;
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  pass(h);
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: A, entityId: hp, abilityIndex: 0, via: 'augment' }),
    /cannot pay the activation cost/,
    'R49: a cost you cannot survive is not payable');
  assert.equal(h.state.players[A]!.life, 3, 'still alive — a cost is never paid to kill yourself');
  assert.equal(h.state.seenHand[A], null, 'and nothing was seen');
  assert.ok(!h.legal(A).some(a => a.type === 'activateAbility' && a.entityId === hp),
    'and it is not offered');
  // at 4 life it IS payable, and the life goes at ACTIVATION, before the stack
  h.state.players[A]!.life = 4;
  h.do({ type: 'activateAbility', seat: A, entityId: hp, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.players[A]!.life, 1, 'the 3 life is paid as the ability is activated');
  pick(h, { player: D });
  pass(h); pass(h);
  assert.ok(h.state.seenHand[A], 'and the hand was seen');
  finishBattle(h);
});

// ── Just a Unit ──────────────────────────────────────────────────────────

test('Just a Unit: {Pure} suppresses all other attributes', { todo: true }, () => {
  // PARKED BY DECISION (docs/08 §New attributes): {Pure} needs the
  // attribute-suppression layer already parked for Monke, Suppression Field
  // and Transmogrifant, plus Pure's bidirectional "and cards they are
  // interacting with" variant that nothing else in the pool wants.
});

// ── Life Leech ───────────────────────────────────────────────────────────

test('Life Leech: pay 5 life for +3/+3 until regroup', () => {
  const h = new Harness(4009);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const ll = spawn(h, A, 'Life Leech');                       // 1/1
  const lifeA = h.state.players[A]!.life;
  h.do({ type: 'activateAbility', seat: A, entityId: ll, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.players[A]!.life, lifeA - 5);
  assert.deepEqual(effStats(h, ll), [4, 4], '+3/+3');
  toNextBattle(h, A);
  finishBattle(h);
  assert.deepEqual(effStats(h, ll), [1, 1], 'the bonus ends at regroup');
});

test('Life Leech: donated as a Virus, "I" is the HOST', () => {
  const h = new Harness(4010);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const whale = spawn(h, A, 'Good Whale');                    // 7/5
  giveResources(h, A, 'light', 2);                            // l/2
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Life Leech'), hostId: whale });
  const modId = ent(h, whale)!.mods[0]!;
  const lifeA = h.state.players[A]!.life;
  h.do({ type: 'activateAbility', seat: A, entityId: whale, abilityIndex: 0, via: { mod: modId } });
  assert.equal(h.state.players[A]!.life, lifeA - 5);
  assert.deepEqual(effStats(h, whale), [10, 8], 'the HOST got the +3/+3');
});

// ── Nullbringer ──────────────────────────────────────────────────────────

test('Nullbringer: a player who would gain life loses that much instead (both players)', () => {
  const h = new Harness(4011);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  spawn(h, A, 'Nullbringer');
  const lifeA = h.state.players[A]!.life, lifeD = h.state.players[D]!.life;
  whiteBox(h, e => e.gainLife(D, 4, 'test'));
  assert.equal(h.state.players[D]!.life, lifeD - 4, 'the opponent LOST 4 where they would have gained 4');
  whiteBox(h, e => e.gainLife(A, 2, 'test'));
  assert.equal(h.state.players[A]!.life, lifeA - 2, 'and so does its own controller');
});

test('Nullbringer: two copies do not stack — one inversion per life-gain event', () => {
  const h = new Harness(4012);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  spawn(h, A, 'Nullbringer');
  spawn(h, A, 'Nullbringer');
  const lifeD = h.state.players[D]!.life;
  whiteBox(h, e => e.gainLife(D, 3, 'test'));
  assert.equal(h.state.players[D]!.life, lifeD - 3, 'still exactly -3, not -6 or -9');
});

test('Nullbringer: "instead" is a TRIGGER, not a replacement (life spikes, then comes back)', { todo: true }, () => {
  // APPROXIMATION: there is no life-gain replacement seam (the engine's only
  // two hooks are rot damage and column combat damage), so the gain really
  // happens and is then doubled back. The endpoint is right; the intermediate
  // life total is not, and in battle the correction goes on the stack (so it
  // is respondable and delayed) instead of being simultaneous.
});

// ── Prediction Prophet ───────────────────────────────────────────────────

test('Prediction Prophet: HALF unparked — the start-of-deployment trigger fires (R50)', () => {
  const h = new Harness(4030);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Prediction Prophet');
  const before = unitsOf(h, A).length;
  // next start of deployment
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  finishBattle(h);
  assert.equal(h.state.phase, 'deploy');
  assert.ok(h.log.some(l => l.includes('Prediction Prophet: no prediction on record')),
    'R50: the start-of-deployment event reaches the card');
  assert.equal(unitsOf(h, A).length, before,
    'and no 5/5 is created — the PREDICT half still has no player action');
});

test('Prediction Prophet: still parked — "predict your life total during [Haste]"', { todo: true }, () => {
  // HALF PARKED. The start-of-deployment trigger exists now (R50) and this
  // card hears it; what is still missing is a "predict a number" PLAYER ACTION
  // legal in the haste step, plus somewhere in PlayerState/Entity to keep the
  // prediction across phases. Until that lands the comparison has nothing to
  // compare against and the 5/5 can never be created.
});

// ── Reap the Due ─────────────────────────────────────────────────────────

test('Reap the Due: its controller may gain 2x your [d] debt to save the unit (R6/R39)', () => {
  const h = new Harness(4013);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'light', 1);
  giveResources(h, A, 'dark', 2);                             // [d] affinity 2 → 4 debt
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Reap the Due') });
  pick(h, { unit: victim });
  pass(h); pass(h);                                           // resolve → the victim's controller decides
  const dec = h.state.decision!;
  assert.equal(dec.seat, D, 'the TARGET\'s controller pays or declines');
  assert.equal(dec.kind, 'payOrDecline');
  assert.ok(dec.prompt.includes('4 debt'), 'twice the caster\'s dark affinity');
  pick(h, true);
  assert.equal(h.state.players[D]!.debt, 4, 'debt gained');
  assert.ok(ent(h, victim), 'and the unit is saved');
  finishBattle(h);
});

test('Reap the Due: declining erases the unit outright (no bin, no trash)', () => {
  const h = new Harness(4014);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'light', 1);
  giveResources(h, A, 'dark', 1);                             // → 2 debt
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Reap the Due') });
  pick(h, { unit: victim });
  pass(h); pass(h);
  pick(h, false);
  assert.ok(!ent(h, victim), 'erased');
  assert.equal(h.state.players[D]!.debt, 0, 'no debt');
  assert.ok(!h.state.players[D]!.bin.includes('Good Whale'), 'erasing never touches a bin (R40)');
  finishBattle(h);
});

test('Reap the Due: with no dark affinity the "payment" is 0 debt and the unit is always saved', () => {
  const h = new Harness(4015);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'light', 2);                            // no [d] at all
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Reap the Due') });
  pick(h, { unit: victim });
  pass(h); pass(h);
  assert.equal(h.state.decision, null, 'nothing to decide — a free save needs no dialogue');
  assert.ok(ent(h, victim));
  assert.equal(h.state.players[D]!.debt, 0);
  finishBattle(h);
});

// ── Seer of Empty Spaces ─────────────────────────────────────────────────

test('Seer of Empty Spaces: Glimpse 1 when it spawns (R45)', () => {
  const h = new Harness(4016);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const top = h.q.deckOf(A)[0]!;
  const deckBefore = h.q.deckOf(A).length;
  whiteBox(h, e => { e.spawnUnit(A, 'Seer of Empty Spaces', e.homeRegion(A)); });
  assert.equal(h.q.deckOf(A).length, deckBefore - 1, 'the top card left the deck');
  assert.deepEqual(cacheOf(h, A).map(c => c.card), [top], 'and is cached, revealed');
  assert.equal(h.q.cachePermission(A, 0), 'glimpse', 'playable until end of turn, ignoring affinity');
  assert.ok(h.log.some(l => l.includes('glimpses 1')), 'logged as a glimpse');
});

test('Seer of Empty Spaces: the [Switch1] glimpse is bounded, and graftable onto another cause', () => {
  const h = new Harness(4017);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const seer = spawn(h, A, 'Seer of Empty Spaces');           // glimpse #1 (spawn)
  assert.equal(cacheOf(h, A).length, 1);
  whiteBox(h, e => e.destroy(e.entity(seer)!, 'dies'));
  assert.equal(cacheOf(h, A).length, 1, 'bounded ([Switch1], R9): only once per turn');

  // grafted onto ANOTHER graft cause the glimpse rides that host's trigger —
  // here Witness of the Crossing, whose base effect triples it (3 glimpses)
  const woc = spawn(h, A, 'Witness of the Crossing');
  const raider = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'light', 1);
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Seer of Empty Spaces'), hostId: woc, position: 0 });
  const cached = cacheOf(h, A).length;
  toNextBattle(h, D);                                        // A defends → A's home is the battle region
  h.state.players[A]!.life = 2;
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  whiteBox(h, e => e.loseLife(A, 1, 'test'));                // 2 → 1
  pass(h); pass(h);                                          // resolve the Witness trigger
  assert.equal(cacheOf(h, A).length, cached + 3,
    'the grafted Glimpse 1 ran three times off the tripling cause');
  finishBattle(h);
});

// ── Slurpr ───────────────────────────────────────────────────────────────

test('Slurpr: mods may be applied during [Haste] as if it was deployment', { todo: true }, () => {
  // PARKED: a play-timing permission. apply.ts's doApplyMod phase gate is the
  // only place that decides when a mod may be applied and card code cannot
  // reach it (the Dispatch Courier precedent).
});

// ── Suspend ──────────────────────────────────────────────────────────────

test('Suspend: target player\'s life total can\'t change during this battle', { todo: true }, () => {
  // PARKED: a life-change LOCK. E.gainLife / E.loseLife commit
  // unconditionally; the engine's only replacement hooks are rot damage
  // (replaceRotDamage) and column combat damage (replaceCombatDamageToPlayer).
  // "Erase me" is likewise approximated as the spell being binned normally
  // (the Temporal Rift precedent).
});

// ── Tithe Enforcer ───────────────────────────────────────────────────────

test('Tithe Enforcer: prophesy for [2], fulfil by ending [Haste] with used mana, release free', () => {
  const h = new Harness(4018);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'light', 2);
  const banner = getCard('Tithe Enforcer').prophecy!;
  assert.deepEqual(banner, { mana: 2, condition: 'End [Haste] with used mana' }, 'the printed banner');
  h.do({ type: 'prophesy', seat: P, from: 'hand', index: give(h, P, 'Tithe Enforcer') });
  assert.deepEqual(cacheOf(h, P).map(c => c.card), ['Tithe Enforcer']);
  assert.equal(h.q.cachePermission(P, 0), null, 'not yet fulfilled');

  // next turn: spend mana during the haste step on something ELSE
  endDeployment(h);
  const seerIdx = give(h, P, 'Seer of Empty Spaces');         // l/1 {Haste}
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone, 'the haste step opened');
  h.do({ type: 'playCard', seat: P, handIndex: seerIdx });
  assert.equal(h.q.cachePermission(P, 0), null, 'the step has not ENDED yet');
  skipHasteStep(h);
  assert.equal(h.q.cachePermission(P, 0), 'prophecy', 'fulfilled at the end of the haste step (R43)');

  // and the turn after that, release it for free at its printed {Haste} timing
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  endDeployment(h);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone, 'the fulfilled cached haste card opens the step by itself');
  const open = h.q.openMana(P);
  h.do({ type: 'playCached', seat: P, index: 0 });
  assert.equal(h.q.openMana(P), open, 'free: no mana spent for a [7] unit');
  assert.equal(unitsOf(h, P).filter(u => u.card === 'Tithe Enforcer').length, 1, 'it is in play');
  assert.deepEqual(cacheOf(h, P).map(c => c.card).filter(c => c === 'Tithe Enforcer'), [], 'and left the cache');
});

// ── Void Mandible ────────────────────────────────────────────────────────

test('Void Mandible: a nontoken card played in battle sacrifices it and is negated', () => {
  const h = new Harness(4019);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const vm = spawn(h, A, 'Void Mandible');                    // 2/1, in A's home
  const raider = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'light', 2);
  const lifeA = h.state.players[A]!.life;
  toNextBattle(h, D);                                         // D attacks → A's home is the battle region
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Godray') });
  pick(h, { player: A });
  assert.equal(h.state.stack.length, 2, 'Godray + the Mandible trigger above it');
  pass(h); pass(h);                                           // the trigger resolves first
  assert.ok(!ent(h, vm), 'the Mandible sacrificed itself');
  assert.ok(h.state.players[A]!.bin.includes('Void Mandible'), 'a sacrifice bins it (and trashes it, R40)');
  assert.ok(h.state.stack[0]!.negated, 'Godray is negated');
  pass(h); pass(h);
  assert.equal(h.state.players[A]!.life, lifeA, 'no 3 damage, and no blessed gain for D');
  finishBattle(h);
});

test('Void Mandible: it is NOT optional and fires on its own controller\'s spells too', () => {
  const h = new Harness(4020);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const vm = spawn(h, A, 'Void Mandible');
  const raider = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'light', 2);
  toNextBattle(h, D);                                         // A defends → A's home is the battle region
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  pass(h);                                                    // initiative (D) passes → A acts
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Godray') });
  pick(h, { player: D });
  pass(h); pass(h);
  assert.ok(!ent(h, vm), 'its own controller\'s Godray ate the Mandible');
  assert.ok(h.state.stack[0]!.negated, 'and the Godray');
  finishBattle(h);
});

test('Void Mandible: a spell TOKEN does not trigger it ("nontoken")', () => {
  const h = new Harness(4021);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const vm = spawn(h, A, 'Void Mandible');
  const raider = spawn(h, D, 'Unit Token');
  let tok = 0;
  whiteBox(h, e => { tok = e.createSpellToken(A, 'Fireball', 2, e.homeRegion(A)).id; });
  toNextBattle(h, D);                                         // A defends in its own region
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  pass(h);
  h.do({ type: 'castSpellToken', seat: A, entityId: tok });
  pick(h, { player: D });
  assert.ok(ent(h, vm), 'the Mandible is untouched by a token spell');
  pass(h); pass(h);
  finishBattle(h);
});

// ── Witness of the Crossing ──────────────────────────────────────────────

test('Witness of the Crossing: life becoming 13 in battle triggers three copies of each graft', () => {
  const h = new Harness(4022);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const woc = spawn(h, A, 'Witness of the Crossing');         // 0/3, graft cause
  const raider = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'earth', 1);                            // Geode: e/1 ("Create a Crystal 1")
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Geode'), hostId: woc, position: 0 });
  assert.equal(ent(h, woc)!.mods.length, 1, 'Geode grafted on');
  toNextBattle(h, D);                                         // A defends → A's home is the battle region
  h.state.players[A]!.life = 14;
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  whiteBox(h, e => e.loseLife(A, 1, 'test'));                 // 14 → 13
  assert.ok(h.state.stack.length >= 1, 'the Witness trigger went on the stack');
  pass(h); pass(h);                                           // resolve it
  const crystals = Object.values(h.state.entities)
    .filter(e => e.kind === 'spellToken' && e.card === 'Crystal' && e.controller === A);
  assert.equal(crystals.length, 3, 'one grafted "Create a Crystal 1" ran THREE times');
  assert.ok(crystals.every(c => c.x === 1));
  finishBattle(h);
});

test('Witness of the Crossing: only 1 or 13, only during battle, only your own life total', () => {
  const h = new Harness(4023);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const woc = spawn(h, A, 'Witness of the Crossing');
  const raider = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'earth', 1);
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, 'Geode'), hostId: woc, position: 0 });
  const crystalCount = () => Object.values(h.state.entities)
    .filter(e => e.kind === 'spellToken' && e.card === 'Crystal').length;
  // outside battle: nothing, whatever the life total does
  h.state.players[A]!.life = 15;
  whiteBox(h, e => e.loseLife(A, 2, 'test'));                 // → 13, but in deployment
  assert.equal(crystalCount(), 0, 'not during battle → no trigger');
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  whiteBox(h, e => e.loseLife(A, 1, 'test'));                 // 13 → 12
  assert.equal(h.state.stack.length, 0, '12 is not 1 or 13');
  h.state.players[D]!.life = 14;
  whiteBox(h, e => e.loseLife(D, 1, 'test'));                 // the OPPONENT hits 13
  assert.equal(h.state.stack.length, 0, '"your life total" is the Witness\'s controller\'s');
  finishBattle(h);
});

test('Witness of the Crossing: [Switch1][Switch1][Switch1] means three copies', { todo: true }, () => {
  // AMBIGUOUS PRINTED TEXT: the card prints three [Switch1] marks and NO
  // reminder text. The three-copy reading is inferred from Lost Guardian
  // ("[Switch1][Switch1] (Trigger two copies of this graft ability as one
  // single trigger.)"), which prints the same shape with two marks. Confirm
  // with the card image / Caleb before this is more than a precedent.
});

// ── parked cards: registration is still load-bearing ─────────────────────

test('parked cards still register, play and attach without crashing', () => {
  const h = new Harness(4024);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  // vanilla bodies
  const ju = spawn(h, A, 'Just a Unit');
  assert.deepEqual(effStats(h, ju), [2, 3]);
  const pp = spawn(h, A, 'Prediction Prophet');
  assert.deepEqual(effStats(h, pp), [1, 3]);
  // inert [Augment] entries: still applicable as (blank) augments
  const gk = spawn(h, A, 'Gatekeeper of Souls');
  giveResources(h, A, 'light', 4);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Slurpr'), hostId: gk });
  assert.equal(ent(h, gk)!.mods.length, 1, 'Slurpr attached as an augment');
  assert.deepEqual(effStats(h, gk), [0, 7], 'and changes nothing');
  // Suspend resolves as a logged no-op
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  const lifeD = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Suspend') });
  pick(h, { player: D });
  pass(h); pass(h);
  assert.ok(h.log.some(l => l.includes('Suspend is PARKED')), 'and says so loudly');
  assert.equal(h.state.players[D]!.life, lifeD);
  finishBattle(h);
});
