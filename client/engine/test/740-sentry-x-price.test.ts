/* Stasis Sentry vs an X spell — the price is raised, the X is not (CR 107.5,
 * 111.10i, 202.5; Caleb 2026-11-01, reversing CT-224's 2026-10-09 reading).
 *
 * Report FXMF #304 (Nyar vs Yagamino, 2026-10-31): Yagamino, attacking into a
 * Stasis Sentry with two nontoken allies and [10] open, could not cast
 * Torrential Reclamation at all. The engine forced X to at least 3 under the
 * Sentry, and "Recall X target nontoken allies" at X = 3 needs three allies.
 * The players hand-simulated an X = 2 cast with agreed fixes ("should be
 * castable"). Nyar asked the RAQ, and the thread settled it:
 *
 *   Nyar:   "If Stasis sentry is in play the torrential reclamation needs to
 *            cost at least 3. Does this automatically require 3 targets?"
 *   _passer: "No, you paid 2 +1 extra, but X=2"
 *   Caleb:   "Yeah, you set targets before paying the cost"
 *
 * So the caster picks X freely (down to the printed floor), the chosen X is the
 * base cost (CR 202.5), and the Sentry raises a base of three or less to three.
 * Everything that reads X — targets, damage — reads the chosen X, and so does
 * every "that spell's cost" watcher: the older RAQ "[Solved] Increasing Spells
 * Cost vs Triggers" (_passer) says those read the printed cost, never the
 * increased price, and an X spell's printed X is the X chosen.
 *
 * Seeds: 74000-74099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import type { Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick, spawn,
  toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

const open = (h: Harness, seat: Seat): number => new E(h.state).openMana(seat);
/** answer the pending question by shape: a permutation for an ordering, else the first option */
const answer = (h: Harness): void => {
  const dec = h.state.decision!;
  h.do({ type: 'decide', seat: dec.seat, choice: dec.pickOrder ? dec.options.map((_, i) => i) : 0 });
};

test('report FXMF #304: Torrential Reclamation at X = 2 under a Stasis Sentry — castable with two allies, two targets, pays [3]', () => {
  const h = new Harness(74001);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - h.state.initiative) as Seat;
  // the FXMF board: A attacks with exactly two nontoken allies into D's region,
  // where D's Stasis Sentry stands
  const a1 = spawn(h, A, 'Good Whale');
  const a2 = spawn(h, A, 'Bubb');
  spawn(h, D, 'Stasis Sentry');
  spawn(h, D, 'Unit Token');
  giveResources(h, A, 'water', 4);
  giveResources(h, A, 'fire', 2);                    // br affinity, [6] open
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1], [a2]] });
  assert.equal(h.state.priority, A, 'A holds priority after its attack');
  const idx = give(h, A, 'Torrential Reclamation');
  assert.ok(legalActions(h.state, A).some(a => a.type === 'playCard' && a.handIndex === idx),
    'the play is offered — it used to be refused: "no legal targets"');
  const lifeA = h.state.players[A]!.life;
  const before = open(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: idx });
  const menu = h.state.decision!.options;
  assert.deepEqual(menu.map(o => o.value), [0, 1, 2],
    'X = 3 needs three nontoken allies, so it is not offered; X = 2 is');
  assert.equal(menu.find(o => o.value === 2)!.label, 'X = 2 — pay [3]', 'and it names its price');
  pick(h, 2);
  assert.equal(before - open(h, A), 3, '"you paid 2 +1 extra"');
  assert.equal(h.state.decision!.options.length, 2, '"but X=2": two targets to choose, not three');
  pick(h, { unit: a1 });
  pick(h, { unit: a2 });
  pass(h); pass(h);                                  // resolve
  while (h.state.decision) answer(h);
  assert.ok(h.state.players[A]!.hand.includes('Good Whale') && h.state.players[A]!.hand.includes('Bubb'),
    'both allies were recalled');
  assert.equal(h.state.players[A]!.life, lifeA - 2, 'and A lost 1 life for each of the two — X is 2');
  finishBattle(h);
});

/** D casts Wildfire at `x` into A's face in a battle in D's region, with a
 * Stasis Sentry there (and a Tranquility too, if asked). Returns what the cast
 * took out of D's pool and the damage it dealt. */
function wildfire(seed: number, x: number, opts: { tranquility?: boolean } = {}): { paid: number; dealt: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - h.state.initiative) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Stasis Sentry');
  if (opts.tranquility) spawn(h, D, 'Tranquility');
  giveResources(h, D, 'fire', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                           // priority -> D
  const life = h.state.players[A]!.life;
  const before = open(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wildfire') });
  pick(h, x);
  pick(h, { player: A });
  const paid = before - open(h, D);
  pass(h); pass(h);
  const dealt = life - h.state.players[A]!.life;
  finishBattle(h);
  return { paid, dealt };
}

test('CR 107.5: Wildfire at X = 1 under a Stasis Sentry deals 1 and pays [3]', () => {
  assert.deepEqual(wildfire(74002, 1), { paid: 3, dealt: 1 });
});

test('CR 107.5: Wildfire at X = 4 under a Stasis Sentry pays [4] — a base above three is untouched', () => {
  assert.deepEqual(wildfire(74003, 4), { paid: 4, dealt: 4 });
});

test('CR 111.10: Wildfire at X = 2 under a Stasis Sentry AND a Tranquility pays [4] (raised to 3, then +1) and deals 2', () => {
  assert.deepEqual(wildfire(74004, 2, { tranquility: true }), { paid: 4, dealt: 2 });
});

test('CR 107.5: outside battle a Stasis Sentry changes nothing — Floral Singularity at X = 1 pays [1]', () => {
  const h = new Harness(74005);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Stasis Sentry');
  spawn(h, (1 - p) as Seat, 'Stasis Sentry');
  giveResources(h, p, 'wood', 4);
  giveResources(h, p, 'metal', 2);                   // ggm affinity + mana
  assert.equal(new E(h.state).manaToPlay(p, 'Floral Singularity', { x: 1 }), 1, 'the quote');
  const before = open(h, p);
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Floral Singularity') });
  assert.equal(h.state.decision!.options[0]!.value, 0, 'the menu starts at the printed floor');
  pick(h, 1);
  assert.equal(before - open(h, p), 1, 'X = 1 costs [1] in deployment');
});

test('RAQ printed cost, X spell: under a Stasis Sentry and a Tranquility, Wildfire at X = 2 paid [4] reads as a 2 to Arcane Concentrator, Channeled Amalgam and Unstable Apparition', () => {
  // _passer ("[Solved] Increasing Spells Cost vs Triggers"): "despite paying increased
  // price to play spell, those effects will only check for … printed cost of the spell".
  // On an X spell the printed X is the X chosen (CR 202.5), not the [4] paid.
  const h = new Harness(74006);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - h.state.initiative) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Stasis Sentry');
  spawn(h, D, 'Tranquility');
  spawn(h, D, 'Arcane Concentrator');
  const amalgam = spawn(h, D, 'Channeled Amalgam');
  spawn(h, D, 'Unstable Apparition');
  giveResources(h, D, 'water', 4);
  giveResources(h, D, 'fire', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                           // priority -> D
  const before = open(h, D);
  const xxBefore = unitsOf(h, D).filter(u => u.card === 'Unit Token').length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wildfire') });
  pick(h, 2);
  pick(h, { player: A });
  assert.equal(before - open(h, D), 4, 'X = 2 paid [4]: raised to 3 by the Sentry, +1 Tranquility');
  while (h.state.stack.length || h.state.decision) {
    if (h.state.decision) answer(h);
    else pass(h);
  }
  const xx = unitsOf(h, D).filter(u => u.card === 'Unit Token');
  assert.equal(xx.length, xxBefore + 1, 'the Concentrator made one X/X');
  assert.deepEqual(effStats(h, xx[xx.length - 1]!.id), [2, 2], 'a 2/2 — the X chosen, not the [4] paid');
  assert.equal(ent(h, amalgam)!.counters, 2, 'the Amalgam took 2 counters');
  assert.deepEqual(tokensOf(h, D).filter(t => t.card === 'Fireball').map(t => t.x), [2], 'a Fireball 2');
  finishBattle(h);
});

test("RAQ printed cost, X spell: Death Greeter's bar is the X chosen under a Stasis Sentry — X = 2 paid [3] spares a cost-3 unit", () => {
  // "each player sacrifices a unit with cost less than or equal to the spell's cost":
  // the bar is 2, not the [3] paid, so D's Greeter (cost 3) and A's Bubb (cost 4) live.
  const h = new Harness(74007);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - h.state.initiative) as Seat;
  const bubb = spawn(h, A, 'Bubb');
  const greeter = spawn(h, D, 'Death Greeter');
  const sentry = spawn(h, D, 'Stasis Sentry');
  const fodder = spawn(h, D, 'Crumbling Ancient');
  giveResources(h, D, 'fire', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bubb]] });
  pass(h);
  const before = open(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wildfire') });
  pick(h, 2);
  pick(h, { player: A });
  assert.equal(before - open(h, D), 3, 'X = 2 paid [3]');
  pass(h); pass(h);                                  // resolve the Greeter trigger
  assert.ok(ent(h, greeter), 'the cost-3 Greeter is over the bar of 2');
  assert.ok(ent(h, bubb), 'and so is the cost-4 Bubb');
  assert.ok(ent(h, sentry), 'and the cost-3 Sentry');
  assert.ok(!ent(h, fodder), 'the cost-2 unit is at the bar, and is sacrificed');
  finishBattle(h);
});
