/* R157 §1 and §20 — what an X-cost card COSTS, and who can read it.
 *
 * §1, verbatim: "Pips aren't a relevant part of looking at the cost of a card
 * in Algomancy. And paying X replaces the letter X on the printed card
 * temporarily."
 *
 * So an X spell's cost is THE X ACTUALLY PAID — not 0, not its pips, not
 * pips+X. Three contexts, three answers, and they are one rule:
 *   · a spell being CAST or just cast — the paid X (`StackItem.x`, and the `x`
 *     the engine now puts on the 'spellPlayed' / 'cardPlayed' events);
 *   · a card sitting in a hand / bin / cache / deck, or a unit standing in
 *     play — no X has been paid for it, so it has no cost: 0;
 *   · the cost QUOTE for a cast that has not chosen its X yet (the castability
 *     gate) — the printed floor `xMin`, i.e. the cheapest legal cast.
 *
 * §20, verbatim: "They're sort of exempt, but only if X => 3. If the player
 * wants to cast it for 0, 1, or 2, they'd have to pay the tax to bring its
 * cost to at least 3."
 *
 * Stasis Sentry is therefore neither a flat exemption (what it used to ship)
 * nor a flat +3: the cost mod raises the spell TO 3 when the chosen X is below
 * 3 and does nothing at X >= 3. That needs the chosen X inside the CostMod
 * layer, which is `CostCtx.x` / `CostOpts.x`, and it needs the whole mana bill
 * of an X spell to be settled at `E.collectX` rather than half at `payCard`.
 *
 * Every test drives the real reducer path. Seeds: 13300-13399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import type { Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick,
  spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';
import { manaOf as manaOfName, castCostOf as castCost } from '../src/cards/sets/helpers.ts';

const open = (h: Harness, seat: Seat): number => new E(h.state).openMana(seat);

/** deployment, an attacker declared, and priority handed to the DEFENDER —
 * the seat that will be doing the casting in most of these. The Stasis Sentry
 * / Death Greeter / Amalgam under test lives in the defender's region, which
 * is where the battle lands (R12: a CostMod and a trigger are both scoped to
 * it). */
function battleWithDefenderOnPriority(h: Harness): { A: Seat; D: Seat; atk: number } {
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - h.state.initiative) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  return { A, D, atk };
}

// ── §20: Stasis Sentry prices each X ─────────────────────────────────────

test('R157 §20 — Stasis Sentry quotes an X spell per chosen X: 0/2/3 -> [3], 5 -> [5]', () => {
  const h = new Harness(13301);
  const { A, D, atk } = battleWithDefenderOnPriority(h);
  spawn(h, D, 'Stasis Sentry');                     // the battle lands in D's region
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const e = new E(h.state);
  assert.equal(getCard('Wildfire').mana, 'X', 'Wildfire is the X spell under test');
  // the four the brief names, from BOTH seats (unqualified subject)
  assert.equal(e.manaToPlay(D, 'Wildfire', { x: 0 }), 3, 'X=0 is taxed up to [3]');
  assert.equal(e.manaToPlay(D, 'Wildfire', { x: 2 }), 3, 'X=2 is taxed up to [3]');
  assert.equal(e.manaToPlay(D, 'Wildfire', { x: 3 }), 3, 'X=3 is already [3] — no tax');
  assert.equal(e.manaToPlay(D, 'Wildfire', { x: 5 }), 5, 'X=5 is "sort of exempt" — untouched');
  assert.equal(e.manaToPlay(A, 'Wildfire', { x: 0 }), 3, 'the attacker is taxed too');
  assert.equal(e.manaToPlay(A, 'Wildfire', { x: 9 }), 9, 'and untaxed above three too');
  // with the X still open, the quote is the CHEAPEST legal cast (xMin = 0 -> 3)
  assert.equal(e.manaToPlay(D, 'Wildfire'), 3,
    'the castability quote prices the cheapest X, which the Sentry raises to [3]');
  // xMin > 0 shifts the floor but not the rule
  assert.equal(getCard('Frosted Denial').xMin, 1, '"X can\'t be zero"');
  assert.equal(e.manaToPlay(D, 'Frosted Denial'), 3, 'X=1 is taxed up to [3] — so is the quote');
  assert.equal(e.manaToPlay(D, 'Frosted Denial', { x: 4 }), 4, 'X=4 is untouched');
  finishBattle(h);
});

test('R157 §20 — with no Stasis Sentry an X spell costs exactly X', () => {
  const h = new Harness(13302);
  const { A, D, atk } = battleWithDefenderOnPriority(h);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const e = new E(h.state);
  for (const x of [0, 2, 3, 5]) {
    assert.equal(e.manaToPlay(D, 'Wildfire', { x }), x, `X=${x} costs [${x}]`);
  }
  assert.equal(e.manaToPlay(D, 'Wildfire'), 0, 'and the open quote is the printed floor');
  finishBattle(h);
});

/** cast Wildfire as D at the given X, at the given target, and report how much
 * mana the whole cast actually took out of D's pool. */
function castWildfireForX(seed: number, x: number, sentry: boolean): number {
  const h = new Harness(seed);
  const { A, D, atk } = battleWithDefenderOnPriority(h);
  if (sentry) spawn(h, D, 'Stasis Sentry');
  giveResources(h, D, 'fire', 12);                  // rr affinity + plenty of mana
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                          // priority -> D
  const before = open(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wildfire') });
  pick(h, x);                                       // R35: X chosen and PAID here
  pick(h, { player: A });                           // "any target"
  const spent = before - open(h, D);
  pass(h); pass(h);                                 // let it resolve
  finishBattle(h);
  return spent;
}

test('R157 §20 — the real cast pays it: X=0 and X=2 both cost [3] under a Stasis Sentry', () => {
  assert.equal(castWildfireForX(13303, 0, true), 3,
    '"If the player wants to cast it for 0 … they\'d have to pay the tax to bring its cost to at least 3"');
  assert.equal(castWildfireForX(13304, 2, true), 3, 'and the same at X=2');
});

test('R157 §20 — the real cast pays it: X=3 costs [3] and X=5 costs [5] under a Stasis Sentry', () => {
  assert.equal(castWildfireForX(13305, 3, true), 3, 'at exactly three the tax is zero');
  assert.equal(castWildfireForX(13306, 5, true), 5,
    '"They\'re sort of exempt, but only if X => 3" — no flat +3');
});

test('R157 §20 — without the Sentry the same casts pay exactly X', () => {
  assert.equal(castWildfireForX(13307, 0, false), 0);
  assert.equal(castWildfireForX(13308, 2, false), 2);
  assert.equal(castWildfireForX(13309, 5, false), 5);
});

test('R157 §20 — the tax gates castability: an X spell needs [3] open, and the big X is still offered', () => {
  const h = new Harness(13310);
  const { A, D, atk } = battleWithDefenderOnPriority(h);
  spawn(h, D, 'Stasis Sentry');
  giveResources(h, D, 'fire', 2);                   // rr affinity, only [2] open
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  const idx = give(h, D, 'Wildfire');
  assert.equal(open(h, D), 2, 'two open');
  assert.equal(new E(h.state).canPayCard(D, 'Wildfire'), false,
    'every X below three costs [3], so [2] cannot start the cast at all');
  assert.throws(() => h.do({ type: 'playCard', seat: D, handIndex: idx }), /cannot pay/i,
    'and the reducer refuses it');
  // one more resource and the whole menu opens up — including an X the old
  // code could not reach, because it had already taken the tax off the top
  giveResources(h, D, 'fire', 5);                   // [7] open
  h.do({ type: 'playCard', seat: D, handIndex: idx });
  const menu = h.state.decision!.options.map(o => o.value);
  assert.deepEqual(menu, [0, 1, 2, 3, 4, 5, 6, 7],
    'X=7 is offered on [7] open mana: at X>=3 the Sentry takes nothing');
  const labels = h.state.decision!.options.map(o => o.label);
  assert.equal(labels[0], 'X = 0 — pay [3]', 'the taxed options say what they cost');
  assert.equal(labels[7], 'X = 7', 'an untaxed one does not');
  pick(h, 7);
  assert.equal(open(h, D), 0, 'and X=7 really took [7]');
  pick(h, { player: A });
  pass(h); pass(h);
  finishBattle(h);
});

// ── §1: "where X is that spell's cost" ───────────────────────────────────

test("R157 §1 — Channeled Amalgam reads the PAID X of an X spell (was dead against all eleven)", () => {
  const h = new Harness(13311);
  const { A, D, atk } = battleWithDefenderOnPriority(h);
  const amalgam = spawn(h, D, 'Channeled Amalgam');  // 1/1, own [Augment] text live
  giveResources(h, D, 'fire', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                          // priority -> D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wildfire') });
  pick(h, 4);                                       // X = 4, paid at cast
  pick(h, { player: A });
  pass(h); pass(h);                                 // resolve the Amalgam trigger
  assert.equal(ent(h, amalgam)!.counters, 4, "X = the spell's cost = the X paid (4)");
  assert.deepEqual(effStats(h, amalgam), [5, 5], '1/1 plus four +1/+1 counters');
  finishBattle(h);
});

test('R157 §1 — Arcane Concentrator makes an X/X off the paid X', () => {
  const h = new Harness(13312);
  const { A, D, atk } = battleWithDefenderOnPriority(h);
  spawn(h, D, 'Arcane Concentrator');                // 3/2, own [Augment] text live
  giveResources(h, D, 'fire', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wildfire') });
  pick(h, 3);
  pick(h, { player: A });
  pass(h); pass(h);
  const tokens = unitsOf(h, D).filter(u => u.card === 'Unit Token');
  assert.equal(tokens.length, 1, 'one X/X unit created');
  assert.deepEqual(effStats(h, tokens[0]!.id), [3, 3], 'X = the paid X (3), not 0');
  finishBattle(h);
});

test('R157 §1 — a DEPLOY-timing X spell reports its X too (the item is never pushed)', () => {
  // Floral Singularity is the one X spell in the pool with deploy timing, so
  // it goes through commitItem(..., 'resolve') and never reaches the stack at
  // all. Reading "that spell's cost" off a stack lookup would silently answer
  // 0 here; the paid X rides on the 'spellPlayed' event instead.
  const h = new Harness(13313);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  assert.equal(getCard('Floral Singularity').timing, 'deploy', 'the deploy-timing X spell');
  const amalgam = spawn(h, p, 'Channeled Amalgam');
  giveResources(h, p, 'wood', 4);
  giveResources(h, p, 'metal', 2);                  // ggm affinity + mana
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Floral Singularity') });
  pick(h, 2);                                       // X = 2
  // the printed "[Create X 1/1 units or your units become base X/X]" mode
  h.do({ type: 'decide', seat: h.state.decision!.seat, choice: 0 });
  assert.equal(ent(h, amalgam)!.counters, 2, 'the Amalgam saw X = 2 with no stack item to find');
});

/** Death Greeter's whole scenario at one chosen X: A's only unit is a Bubb
 * (cost 4), D's only unit is the Greeter itself (cost 3), and D casts a
 * Wildfire for `x`. Reports which of the two survived the sacrifice clause. */
function deathGreeterAt(seed: number, x: number): { bubb: boolean; greeter: boolean } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - h.state.initiative) as Seat;
  const bubb = spawn(h, A, 'Bubb');                 // cost 4 — A's only unit
  const greeter = spawn(h, D, 'Death Greeter');     // cost 3 — D's only unit
  giveResources(h, D, 'fire', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bubb]] });
  pass(h);                                          // priority -> D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wildfire') });
  pick(h, x);
  pick(h, { player: A });
  pass(h); pass(h);                                 // resolve the Greeter trigger
  const out = { bubb: !!ent(h, bubb), greeter: !!ent(h, greeter) };
  finishBattle(h);
  return out;
}

test("R157 §1 — Death Greeter's sacrifice bar is the paid X, not 0", () => {
  assert.equal(getCard('Bubb').mana, 4);
  assert.equal(getCard('Death Greeter').mana, 3);
  // X = 0: the bar is 0, both pools are empty, "(If able.)" skips both seats
  assert.deepEqual(deathGreeterAt(13314, 0), { bubb: true, greeter: true },
    'nothing costs 0 or less — nobody sacrifices');
  // X = 4: the bar is the PAID X, and each seat's only unit is under it. This
  // is the whole of the fix — before it every X spell priced at 0, so this
  // clause could never reach anything but a token.
  assert.deepEqual(deathGreeterAt(13318, 4), { bubb: false, greeter: false },
    'cost 4 <= 4 and cost 3 <= 4 — both are sacrificed');
});

test('R157 §1 — Null Drone already read the paid X, and still does', () => {
  const h = new Harness(13315);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - h.state.initiative) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'fire', 12);
  giveResources(h, D, 'water', 6);                  // Null Drone is b/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // A burns D's face for 4 — that is the "greatest life lost this battle" bar
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Wildfire') });
  pick(h, 4);
  pick(h, { player: D });
  pass(h); pass(h);
  const drone = h.state.players[D]!.life;
  assert.ok(drone > 0);
  // a Wildfire for X=5 is ABOVE the bar — Null Drone cannot negate it
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Wildfire') });
  pick(h, 5);
  pick(h, { player: D });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Null Drone') });
  pick(h, { stack: h.state.stack[0]!.id });
  pass(h); pass(h);                                 // resolve the Drone
  assert.ok(h.log.some(m => m.includes('costs 5 > 4')),
    'the Drone priced the spell at its paid X (5), not at 0 and not at its pips');
  assert.equal(h.state.stack.length, 1, 'the Wildfire is still on the stack');
  finishBattle(h);
});

// ── §1: no X was ever paid ───────────────────────────────────────────────

test('R157 §1 — a card that was never cast has no cost: an X card in hand reads 0', () => {
  // Prophecy Bug: "Cache a card in your hand. It gains 'Prophecy — X Turns
  // Pass', where X is half of its cost, rounded up." Nobody has paid an X for
  // a card sitting in a hand, so it has no cost — 0, giving "0 Turns Pass",
  // which fulfils at once. Not an approximation: R157 §1 says the pips are not
  // the cost either, and the standing steer takes the reading that lets more
  // things happen over one that refuses to see the card.
  const h = new Harness(13316);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  h.state.players[p]!.hand.length = 0;
  giveResources(h, p, 'light', 1);
  giveResources(h, p, 'water', 1);                  // Prophecy Bug is lb/1
  give(h, p, 'Wildfire');                           // the only hand card: mana 'X'
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Prophecy Bug') });
  const cached = new E(h.state).cache(p);
  assert.equal(cached.length, 1, 'the X card was cached');
  assert.equal(cached[0]!.card, 'Wildfire');
  assert.match(cached[0]!.prophecy!.condition, /^0 /,
    'ceil(0 / 2) = 0 — an uncast X card has no cost to halve');
});

test('R157 §1 — the three answers are one rule (helpers)', () => {
  const h = new Harness(13317);
  const e = new E(h.state);
  const A = 0 as Seat;
  // a name alone -> 0 (no X has been paid for it)
  assert.equal(manaOfName('Wildfire'), 0, 'an X card known only by name has no cost');
  assert.equal(manaOfName('Bubb'), 4, 'a printed number is itself');
  // a cast -> the paid X
  assert.equal(castCost('Wildfire', 5), 5, 'the X actually paid');
  assert.equal(castCost('Wildfire', 0), 0, 'including a deliberate zero');
  assert.equal(castCost('Bubb', 5), 4, 'a printed number ignores any x');
  assert.equal(castCost('Wildfire', undefined), 0, 'a free release casts for X = 0 (R111)');
  // the open quote -> the printed floor
  assert.equal(e.manaToPlay(A, 'Wildfire'), 0, 'no floor printed');
  assert.equal(e.manaToPlay(A, 'Frosted Denial'), 1, '"X can\'t be zero"');
});
