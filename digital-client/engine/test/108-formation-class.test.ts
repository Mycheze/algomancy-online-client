/* BL-24 — "The 'into formation' or 'in my formation' hasn't been working."
 *
 * The owner's report (2026-08-24) names the whole class: Hooba-Lin, Hooba-Bot,
 * Hooba-Pon, Hooba-God ("create/play … in my formation", R75 — the controller
 * chooses the slot at the effect's resolution), Tiderunner Initiate and Trench
 * Stalker ("played directly into formation", R29 — the spot is part of the
 * CAST). Investigated at be4cd54: every card in the class asks and places
 * correctly through the REAL action path, and the server's per-seat relay
 * (viewFor + legalActions) delivers the question intact — the reported
 * experience matches the class's documented pre-2026-08-22/24 behaviour
 * (ledger #54; the Hooba auto-pick; Trench Stalker parked until R123).
 *
 * What WAS broken at HEAD is the question's presentation contract: both
 * mechanisms raised their ask as kind 'electricPath', whose numeric option
 * values the client reads as RAW ENTITY IDS (that is R4's contract — the
 * electric-path options really are entity ids). R75's slot options are slot
 * INDEXES 0..n-1, so the slot buttons pinged/previewed whichever units
 * happened to own entity ids 0..n-1 — actively misleading on exactly the
 * question the report is about. The ask is its own kind now: 'formationSlot'.
 *
 * These guards pin, PER CARD, the two halves the report names:
 *   1. the ASK — a decision really is raised, to the effect's controller,
 *      as kind 'formationSlot' (never the entity-id-valued 'electricPath');
 *   2. the LANDING — answering it puts the unit in the chosen slot.
 *
 * Seeds 10501-10508.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legalActions } from '../src/apply.ts';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import {
  ent, finishBattle, give, giveResources, pass, pick, spawn,
  toDeployment, toNextBattle, unitsOf,
} from './util.ts';

/** the pending ask, asserted to be the formation-slot question for `seat` */
function expectSlotAsk(h: Harness, seat: Seat, source: string): void {
  const dec = h.state.decision;
  assert.ok(dec, `${source}: the slot question is actually asked`);
  assert.equal(dec.seat, seat, `${source}: the effect's CONTROLLER is asked`);
  assert.equal(dec.kind, 'formationSlot',
    `${source}: its own kind — 'electricPath' numeric values are raw entity ids (R4), and slot indexes are not`);
}

// ── Hooba-Lin: "[Augment] When I attack, create a 1/1 unit in my formation" ──

test('BL-24 Hooba-Lin (augment): the host attacks → the ask, and the 1/1 lands in the chosen slot', () => {
  const h = new Harness(10501, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative;
  const host = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'fire', 4);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Hooba-Lin'), hostId: host });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  pass(h); pass(h);                                   // the attack trigger resolves
  expectSlotAsk(h, A, 'Hooba-Lin');
  assert.deepEqual(h.state.decision!.options.map(o => o.label),
    ['a new column on the left', 'column 1, behind Good Whale', 'a new column on the right']);
  pick(h, 1);                                         // behind the host
  const col = h.state.battle!.columns[0]!;
  assert.equal(col.length, 2, 'the 1/1 joined the column');
  assert.equal(ent(h, col[1]!)!.card, 'Unit Token');
  finishBattle(h);
});

// ── Hooba-Bot: "[Augment] When I attack or block, create a Robot 2 in my formation" ──

test('BL-24 Hooba-Bot (played as a unit): attack → the ask, and the Robot 2 lands behind me', () => {
  const h = new Harness(10502, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative;
  const bot = spawn(h, A, 'Hooba-Bot');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bot]] });
  pass(h); pass(h);
  expectSlotAsk(h, A, 'Hooba-Bot');
  // the R75 values are slot INDEXES — the exact namespace that collided with
  // entity ids while the ask rode kind 'electricPath'
  assert.ok(h.state.decision!.options.every((o, i) => o.value === i),
    'R75 option values are indexes into the offered slot list');
  pick(h, 1);                                         // behind me
  const col = h.state.battle!.columns[0]!;
  const robot = ent(h, col[1]!)!;
  assert.equal(robot.card, 'Robot');
  assert.equal(robot.counters, 2, 'a Robot 2');
  finishBattle(h);
});

test('BL-24 Hooba-Bot (as a mod on a host): the donated trigger asks too, and the Robot lands', () => {
  const h = new Harness(10503, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative;
  const host = spawn(h, A, 'Good Whale');
  giveResources(h, A, 'metal', 4);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Hooba-Bot'), hostId: host });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  pass(h); pass(h);
  expectSlotAsk(h, A, 'Hooba-Bot (augment)');
  pick(h, 0);                                         // a new column on the left
  assert.equal(h.state.battle!.columns.length, 2, 'the formation widened');
  assert.equal(ent(h, h.state.battle!.columns[0]![0]!)!.card, 'Robot');
  finishBattle(h);
});

// ── Hooba-Pon: attack → you may pay for a unit from hand into my formation ──

test('BL-24 Hooba-Pon: the pay question, THEN the slot question, and the paid unit lands', () => {
  const h = new Harness(10504, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative;
  const pon = spawn(h, A, 'Hooba-Pon');
  giveResources(h, A, 'water', 4);
  give(h, A, 'Hooba-Pon');                            // the unit to pay for
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[pon]] });
  pass(h); pass(h);
  assert.equal(h.state.decision?.kind, 'payOrDecline', 'first: whether (and what) to pay for');
  pick(h, h.state.players[A]!.hand.indexOf('Hooba-Pon'));
  expectSlotAsk(h, A, 'Hooba-Pon');
  // R198: still kind 'formationSlot' — which is what this file is about — but
  // the VALUES are R29 `FormationSpot`s now rather than R75 slot indexes,
  // because the answer is stamped on the stack item and taken at the spawn.
  // Both shapes are opaque to the client, which is exactly BL-24's point.
  pick(h, { kind: 'behind', unit: pon });             // behind me
  pass(h); pass(h);                                   // the play's own response window
  const col = h.state.battle!.columns[0]!;
  assert.equal(col.length, 2, 'the paid-for unit joined the column');
  assert.equal(ent(h, col[1]!)!.card, 'Hooba-Pon');
  finishBattle(h);
});

// ── Hooba-God: attack or block → a copy of me in my formation ──

test('BL-24 Hooba-God: attack → the ask, and the copy token lands in the chosen slot', () => {
  const h = new Harness(10505, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative;
  const hg = spawn(h, A, 'Hooba-God');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[hg]] });
  pass(h); pass(h);
  expectSlotAsk(h, A, 'Hooba-God');
  pick(h, 1);                                         // behind me
  const col = h.state.battle!.columns[0]!;
  const copy = ent(h, col[1]!)!;
  assert.equal(copy.card, 'Hooba-God');
  assert.ok(copy.token, 'the copy is a token');
  finishBattle(h);
});

// ── Tiderunner Initiate: "you may play me into an open spot in your formation" (R29) ──

test('BL-24 Tiderunner Initiate: the spot is asked in the CAST window, as formationSlot, and taken at resolution', () => {
  const h = new Harness(10506, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative;
  const wh = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });
  giveResources(h, A, 'water', 1);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Tiderunner Initiate') });
  expectSlotAsk(h, A, 'Tiderunner Initiate');
  // R29's values are FormationSpot descriptors, and "may" keeps the decline
  assert.ok(h.state.decision!.options.some(o => o.label === 'stay out of formation'));
  pick(h, { kind: 'behind', unit: wh });
  pass(h); pass(h);                                   // the play resolves
  const tr = unitsOf(h, A).find(u => u.card === 'Tiderunner Initiate')!;
  assert.deepEqual(h.state.battle!.columns[0], [wh, tr.id], 'in the line, behind the whale');
  finishBattle(h);
});

// ── Trench Stalker: "[Discard two cards] … played directly into formation, and from your bin" ──

test('BL-24 Trench Stalker (from hand): the spot is asked at cast, and it resolves into the chosen slot', () => {
  const h = new Harness(10507, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative;
  const wh = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });
  giveResources(h, A, 'water', 4);
  giveResources(h, A, 'dark', 4);
  give(h, A, 'Jelly'); give(h, A, 'Jelly');           // discard fodder
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Trench Stalker') });
  expectSlotAsk(h, A, 'Trench Stalker');
  pick(h, { kind: 'end', end: 'left' });
  // the [Discard two cards] cast cost follows, in the same window (R35/R49)
  for (let k = 0; k < 2; k++) {
    assert.equal(h.state.decision?.kind, 'targets', 'the discard cost is collected at cast');
    h.do({ type: 'decide', seat: A, choice: 0 });
  }
  pass(h); pass(h);                                   // the play resolves
  const ts = unitsOf(h, A).find(u => u.card === 'Trench Stalker')!;
  assert.deepEqual(h.state.battle!.columns[0], [ts.id], 'it fronts the new left column');
  finishBattle(h);
});

test('BL-24 Trench Stalker (from bin): offered, asked, and it lands in the line', () => {
  const h = new Harness(10508, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative;
  const wh = spawn(h, A, 'Good Whale');
  h.state.players[A]!.bin.push('Trench Stalker');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[wh]] });
  giveResources(h, A, 'water', 4);
  giveResources(h, A, 'dark', 4);
  give(h, A, 'Jelly'); give(h, A, 'Jelly');
  const offer = legalActions(h.state, A).find(a => a.type === 'playFromBin');
  assert.ok(offer, 'R123: the bin play is OFFERED (its own printed permission)');
  h.do(offer!);
  expectSlotAsk(h, A, 'Trench Stalker (bin)');
  pick(h, { kind: 'behind', unit: wh });
  for (let k = 0; k < 2 && h.state.decision; k++) h.do({ type: 'decide', seat: A, choice: 0 });
  pass(h); pass(h);
  const ts = unitsOf(h, A).find(u => u.card === 'Trench Stalker')!;
  assert.deepEqual(h.state.battle!.columns[0], [wh, ts.id], 'played out of the bin, straight into the line');
  assert.ok(!h.state.players[A]!.bin.includes('Trench Stalker'), 'and it left the bin');
  finishBattle(h);
});
