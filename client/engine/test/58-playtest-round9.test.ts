/* Playtest round 9 (game PEMC, 2026-08-21) — R64 and R65.
 *
 * The report that named the whole class:
 *
 *   "Shouldn't Discharge have you remove counters as an additional cost? Not
 *    on resolution"
 *
 * It should, and so should every other bracketed cost in the pool. What
 * actually happened at the table was worse than untidy: Rashi cast Discharge,
 * Ben got a full priority window to respond to it, and only THEN was the
 * spell's size chosen and paid for. A cost paid after the response window is
 * not a cost — it can be negated away unpaid, and it leaves the opponent
 * answering a spell whose X nobody knows.
 *
 * Its siblings, from the same game and the same seam:
 *
 *   "Download didn't have me target anything..."      → picked at resolution
 *   "I was allowed to choose illegal targets for Reconfigure"
 *   "I can't discard Sacrifice Dude at 'instant' speed"
 *   "We need a way to right click -> concede match :("
 *   "I dont think there's currently a way to view erased cards"
 *
 * and the one Rashi hit without reporting: she aimed Discharge at her own
 * Unit Token, off a menu that read "Unit Token, Unit Token" with nothing on
 * it to say which was whose.
 *
 * Seeds 5800-5899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { legalActions, IllegalAction } from '../src/apply.ts';
import type { Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, notOffered, offered,
  pass, pick, spawn, toDeployment, toNextBattle,
} from './util.ts';

/* ── R64: a bracketed cost is paid at CAST ─────────────────────────────── */

test('R64: Discharge pays its counters before the spell is respondable, and X is fixed there', () => {
  const h = new Harness(5800);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ally = spawn(h, A, 'Unit Token');
  const victim = spawn(h, D, 'Unit Token');
  new E(h.state);
  h.state.entities[ally]!.counters = 2;
  giveResources(h, A, 'metal', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ally]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Discharge') });

  // the cost is the FIRST thing asked for — before the opponent sees anything
  assert.equal(h.state.stack.length, 0, 'nothing is on the stack yet');
  assert.equal(h.state.decision!.seat, A);
  pick(h, { counterFrom: ally });
  pick(h, { doneCost: true });                        // X = 1
  assert.equal(ent(h, ally)!.counters, 1, 'the counter is really gone, at cast');
  pick(h, { unit: victim });
  assert.equal(h.state.stack.length, 1, 'only now is it a thing anyone can answer');
  assert.equal(h.state.stack[0]!.parts[0]!.costPaid!.x, 1, 'and its X is already fixed');
  pass(h); pass(h);
  assert.ok(!ent(h, victim), '1 damage killed the 1/1');
  finishBattle(h);
});

test('R64: negating a spell does not refund the cost it already paid', () => {
  const h = new Harness(5801);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ally = spawn(h, A, 'Unit Token');
  const victim = spawn(h, D, 'Unit Token');
  h.state.entities[ally]!.counters = 2;
  giveResources(h, A, 'metal', 1);
  giveResources(h, D, 'dark', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ally]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Discharge') });
  pick(h, { counterFrom: ally });
  pick(h, { counterFrom: ally });                      // both counters — the pool empties, X = 2
  pick(h, { unit: victim });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Necromantic Rebuke') });
  pick(h, { stack: h.state.stack[0]!.id });            // X = 0 erase, so the ransom is trivially met…
  pass(h); pass(h);
  drain(h);
  assert.equal(ent(h, ally)!.counters, 0, 'the counters stay spent whatever happens to the spell');
  finishBattle(h);
});

/** answer whatever pay-or-decline the tail throws up until the stack is empty */
function drain(h: Harness): void {
  for (let i = 0; i < 20 && (h.state.stack.length || h.state.decision); i++) {
    if (h.state.decision) { h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); continue; }
    pass(h);
  }
}

test('R64: an unpayable variable cost is simply X = 0 — the cast is still legal', () => {
  const h = new Harness(5802);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const ally = spawn(h, A, 'Unit Token');              // no counters anywhere
  const victim = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'metal', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ally]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Discharge') });
  pick(h, { unit: victim });                           // no cost to ask about: straight to the target
  pass(h); pass(h);
  assert.ok(ent(h, victim), 'X = 0 deals nothing');
  assert.ok(h.log.some(l => l.includes('X is 0')), 'and says so');
  finishBattle(h);
});

/* ── R64: targets are declared at cast, and only legal ones ────────────── */

test('R64: Download names its token as it is cast, and only the enemy\'s', () => {
  const h = new Harness(5803);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 2);
  toNextBattle(h, A);
  let mine = 0, theirs = 0;
  withERaw(h, e => {
    mine = e.createSpellToken(A, 'Fireball', 1, e.homeRegion(A)).id;
    theirs = e.createSpellToken(D, 'Fireball', 2, e.homeRegion(D)).id;
  });
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Download') });
  notOffered(h, { unit: mine }, 'you cannot gain control of your own token');
  notOffered(h, { unit: atk }, 'a nontoken unit is not a token');
  pick(h, { unit: theirs });
  assert.equal(h.state.stack.length, 1, 'targeted before it reached the stack');
  pass(h); pass(h);
  assert.equal(ent(h, theirs)!.controller, A);
  finishBattle(h);
});

test("R64: Reconfigure's first slot only offers cards that have [Augment]", () => {
  const h = new Harness(5804);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');               // no [Augment]
  const mover = spawn(h, D, 'Decay Distributor');      // has [Augment]
  const host = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'earth', 1);
  giveResources(h, D, 'metal', 1);
  giveResources(h, D, 'wood', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Reconfigure') });
  notOffered(h, { unit: atk }, 'a Unit Token has no [Augment] to move');
  notOffered(h, { unit: host }, 'neither does the intended host');
  assert.deepEqual(offered(h), [JSON.stringify({ unit: mover })], 'exactly one legal mover');
  pick(h, { unit: mover });
  pick(h, { unit: host });
  pass(h); pass(h);
  assert.ok(!ent(h, mover), 'it moved onto the host');
  finishBattle(h);
});

test('R64: a target menu says whose each unit is', () => {
  const h = new Harness(5805);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const mine = spawn(h, A, 'Unit Token');
  const theirs = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'fire', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  const labels = h.state.decision!.options.map(o => o.label);
  assert.deepEqual(labels, [
    `Unit Token (${h.state.players[A]!.name}'s)`,
    `Unit Token (${h.state.players[D]!.name}'s)`,
  ], 'two identical cards, told apart by the only thing that could tell them apart');
  void theirs;
  pick(h, { unit: theirs });
  finishBattle(h);
});

test('R64: an ability with nothing legal to aim at is not offered and is refused', () => {
  const h = new Harness(5806);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const grax = spawn(h, A, 'Graxxlid');
  giveResources(h, A, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[grax]] });
  // an empty stack: "negate target effect" has nothing to negate
  assert.ok(!legalActions(h.state, A).some(a => a.type === 'activateAbility' && a.entityId === grax),
    'not offered');
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: A, entityId: grax, abilityIndex: 0, via: 'augment' }),
    /nothing it can be used on/, 'and refused if asked for anyway');
  finishBattle(h);
});

test('R64: a bin is a targetable zone, and two copies of one card are two targets', () => {
  const h = new Harness(5812);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const atk = spawn(h, A, 'Unit Token');
  // two copies of ONE unit card, plus a spell that must never be offered
  h.state.players[A]!.bin.push('Curio Drifter', 'Curio Drifter', 'Cull');
  giveResources(h, A, 'dark', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Tilling the Graves') });
  const bn = h.state.players[A]!.name;
  assert.deepEqual(h.state.decision!.options.map(o => o.label),
    [`Curio Drifter (${bn}'s bin)`, `Curio Drifter #2 (${bn}'s bin)`, 'No more targets'],
    'both copies are separate targets, and the spell in the bin is not one');
  pick(h, { bin: { seat: A, card: 'Curio Drifter' } });
  pick(h, { bin: { seat: A, card: 'Curio Drifter', nth: 1 } });
  pass(h); pass(h);                                    // resolve → "then discard a card"
  pick(h, 0);
  assert.equal(h.state.players[A]!.bin.filter(c => c === 'Curio Drifter').length, 0,
    'both copies came back — a name-only reference could only ever have taken one');
  finishBattle(h);
});

/* ── R65: discard-me at instant speed ──────────────────────────────────── */

test('R65: a "Discard me" line works during battle, whatever the card\'s own timing says', () => {
  const h = new Harness(5807);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Lurking Slimebeast');                    // something for D to lose
  giveResources(h, A, 'dark', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const i = give(h, A, 'Sacrifice Dude');               // "2 [d] Discard me", a DEPLOY unit
  assert.ok(legalActions(h.state, A).some(a =>
    a.type === 'playCard' && a.handIndex === i && a.mode === 'discardMe'),
    'the discard mode is on the menu mid-battle');
  h.do({ type: 'playCard', seat: A, handIndex: i, mode: 'discardMe' });
  assert.ok(h.state.players[A]!.bin.includes('Sacrifice Dude'), 'discarded from hand');
  finishBattle(h);
});

/* ── R65: concede ──────────────────────────────────────────────────────── */

test('R65: conceding ends the game the way a lethal blow does', () => {
  const h = new Harness(5808);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  h.do({ type: 'concede', seat: A });
  assert.equal(h.state.phase, 'gameover');
  assert.equal(h.state.winner, D, 'the other seat wins');
  assert.ok(h.log.some(l => l.includes('conceded')), 'and the log says why');
});

test('R65: you may concede even while a decision is pending against you', () => {
  const h = new Harness(5809);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const mine = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Unit Token');
  giveResources(h, A, 'fire', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  assert.ok(h.state.decision, 'a target decision is open');
  assert.throws(() => h.do({ type: 'passPriority', seat: A }), /decision is pending/,
    'everything else is still refused');
  h.do({ type: 'concede', seat: A });
  assert.equal(h.state.winner, D);
});

/* ── R65: the erased pile ──────────────────────────────────────────────── */

test('R65: erased cards are kept in a public pile', () => {
  const h = new Harness(5810);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const victim = spawn(h, D, 'Lurking Slimebeast');
  giveResources(h, A, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Celestial Purge') });
  pick(h, { unit: victim });
  pass(h); pass(h);
  drain(h);                                            // its controller Glimpses 3
  // erased is not dead: no bin, no death — but the card is now LOOKABLE-AT
  assert.ok(!ent(h, victim), 'gone from play');
  assert.ok(!h.state.players[D]!.bin.includes('Lurking Slimebeast'), 'and not in the bin');
  assert.deepEqual(h.state.players[D]!.erased, ['Lurking Slimebeast'], 'it is in the erased pile');
  finishBattle(h);
});

test('R65: an erase-from-bin cost lands in the erased pile', () => {
  const h = new Harness(5811);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Unit Token');
  giveResources(h, D, 'dark', 2);
  h.state.players[D]!.bin.push('Rotling');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Necromantic Rebuke') });
  pick(h, { erase: 'Rotling' });                        // the bin empties → X = 1
  assert.deepEqual(h.state.players[D]!.erased, ['Rotling'], 'the cost is visible afterwards');
  finishBattle(h);
});

/** run engine mutations white-box (the harness pattern used across the suite) */
/** util.ts's withE without settle() and without absorb: a raw poke at the
 *  state for the two round-9 cases below, which assert on the state alone.
 *  Named so 284-util-is-not-shadowed can tell it from a stale copy. */
function withERaw(h: Harness, f: (e: E) => void): void {
  const e = new E(h.state);
  f(e);
  h.state = e.s;
}

void effStats; void IllegalAction;
