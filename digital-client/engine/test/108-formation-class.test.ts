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
import { readFile, readdir } from 'node:fs/promises';
import { legalActions } from '../src/apply.ts';
import { E } from '../src/engine.ts';
import { Harness } from '../src/harness.ts';
import type { Entity, EntityId, Seat } from '../src/types.ts';
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
  // Report #107: EVERY option on EVERY formation ask carries the FormationSpot
  // it refers to. Without it the client has label prose and nothing else, so
  // it cannot draw a drop target on the line even in principle. This runs on
  // all three ask sites (R75 placeInFormation, R29 collectFormationSpot, R198
  // pushInlinePlay) because all seven cards in the class come through here.
  assert.ok(dec.options.every(o => o.spot !== undefined),
    `${source}: #107 — every option says WHERE on the board it puts the unit`);
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

/* ═══════════════════════════════════════════════════════════════════════════
 * R225 — "IN MY FORMATION" IS READ OFF THE SOURCE, NOT OFF THE SEAT.
 *
 * Owner, room FTUW action 45 (2026-08-27): *"Hooba-Lin should not have made a
 * token here since it does not have a formation"*. Hooba-Lin attacked, its
 * trigger went on the stack, a Fireball killed it, the formation closed up —
 * and the trigger still put a 1/1 in the line, from the bin.
 *
 * The engine already had the right reading of the same printed phrase: the
 * COUNTING half of the family reads the source (`columnOf` on Hooba-Nan and
 * Rousing Spirit; R27's "a unit that wasn't attacking gets X = 0"). The
 * PLACING half read `formationSlots(ctx.controller)` — the SEAT's grid — and
 * `placeInFormation` was only ever handed the source's DISPLAY NAME, so it
 * could not have read the source even if it had wanted to. That asymmetry is
 * the whole bug, and it is not an exception to R1's "if I am still in
 * formation is the only recheck mechanism": R1 is about CONDITIONS, and "in my
 * formation" is a REFERENT computed at resolution (R27), which simply has
 * nothing to point at when the source is not in a line.
 *
 * TWO GRADES, and every card in the class was wrong in at least one:
 *  · DEAD SOURCE — Hooba-Lin and Hooba-Bot had no guard at all and placed from
 *    the bin. Hooba-God and Hooba-Pon refused this one already (`selfOf`).
 *  · ALIVE BUT UNSLOTTED — R172's mid-battle control theft leaves a unit in
 *    play, out of the formation, until regroup. ALL FOUR placed, because
 *    `selfOf` tests IN PLAY, which is the wrong predicate. Hooba-Pon
 *    additionally CHARGED the player for the play.
 *
 * Seeds 10520-10528.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** units of `seat` standing in the battle region but in NO formation column —
 * what a token that was minted and then refused a slot leaves behind */
function stranded(h: Harness, seat: Seat, exempt: EntityId): Entity[] {
  const b = h.state.battle!;
  const grid = new Set<EntityId>([...b.columns.flat(), ...Object.values(b.blocks).flat()]);
  // the SOURCE is exempt: in the alive-but-unslotted grade it is deliberately
  // standing outside the line, and that is the setup rather than the damage.
  return unitsOf(h, seat).filter(u => u.id !== exempt && u.region === b.region && !grid.has(u.id));
}

/**
 * The board both grades are run on: `name` and a Good Whale attack in columns
 * of their own.
 *
 * ⚠ THE WHALE IS LOad-BEARING, not scenery. `formationSlots` answers "no slots
 * at all" for a grid with no living unit in it, so a scenario where the source
 * is the ONLY attacker would pass on the OLD code too — the old placement
 * would find nothing to do and the guard under test would never be reached. A
 * second, living, unrelated column keeps three real slots on offer, so the
 * unguarded engine really does place and these tests really can fail.
 */
function twoColumnAttack(seed: number, name: string): { h: Harness; A: Seat; D: Seat; src: EntityId; whale: EntityId } {
  const h = new Harness(seed, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const src = spawn(h, A, name);
  const whale = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[src], [whale]] });
  assert.equal(h.state.battle!.columns.length, 2, `${name}: two attacking columns`);
  return { h, A, D, src, whale };
}

/** grade 1: the source DIES with its own trigger still on the stack (FTUW/45) */
function killSource(h: Harness, src: EntityId): void {
  new E(h.state).destroy(ent(h, src)!, 'dies');
  assert.equal(ent(h, src), undefined, 'the source really is gone');
}

/**
 * grade 2: the source is ALIVE and IN PLAY but stands in no formation.
 *
 * R172's own primitive produces it — `giveControl` unslots mid-battle and
 * never re-slots ("it sits out until regroup"). Stealing it straight back
 * leaves the controller, the region and the trigger's seat exactly as they
 * were, so the ONLY fact that changed is the one under test: it is not in a
 * line any more.
 */
function unslotSource(h: Harness, src: EntityId, D: Seat, A: Seat): void {
  const e = new E(h.state);
  e.giveControl(ent(h, src)!, D);
  e.giveControl(ent(h, src)!, A);
  const u = ent(h, src)!;
  assert.equal(u.controller, A, 'still mine');
  assert.equal(u.region, h.state.battle!.region, 'still standing in the battle region');
  assert.equal(e.columnOf(src), null, 'and out of the formation (R172)');
}

/** the shared verdict: the trigger resolved into nothing, loudly and cleanly */
function expectNoPlacement(h: Harness, A: Seat, src: EntityId, before: number, why: string): void {
  assert.equal(h.state.decision, null, `${why}: NO slot question is even raised`);
  assert.equal(unitsOf(h, A).length, before, `${why}: nothing was created`);
  assert.deepEqual(stranded(h, A, src), [], `${why}: and nothing is left stranded in the region`);
}

// ── Hooba-Lin — "create a 1/1 unit in my formation" ─────────────────────────

test('R225 Hooba-Lin: killed under its own attack trigger → no token, no question, nothing stranded', () => {
  const { h, A, src, whale } = twoColumnAttack(10520, 'Hooba-Lin');
  killSource(h, src);
  const before = unitsOf(h, A).length;
  pass(h); pass(h);                                   // the attack trigger resolves
  expectNoPlacement(h, A, src, before, 'Hooba-Lin (dead source)');
  assert.deepEqual(h.state.battle!.columns, [[whale]], 'the line is exactly what the collapse left');
  finishBattle(h);
});

test('R225 Hooba-Lin: alive but out of the formation (R172) → no token, no question', () => {
  const { h, A, D, src, whale } = twoColumnAttack(10521, 'Hooba-Lin');
  unslotSource(h, src, D, A);
  const before = unitsOf(h, A).length;
  pass(h); pass(h);
  expectNoPlacement(h, A, src, before, 'Hooba-Lin (in play, unslotted)');
  assert.deepEqual(h.state.battle!.columns, [[whale]], 'the whale keeps three open slots on offer — '
    + 'the unguarded engine would have used one');
  finishBattle(h);
});

// ── Hooba-Bot — "create a Robot 2 in my formation" ──────────────────────────

test('R225 Hooba-Bot: killed under its own attack trigger → no Robot, no question, nothing stranded', () => {
  const { h, A, src, whale } = twoColumnAttack(10522, 'Hooba-Bot');
  killSource(h, src);
  const before = unitsOf(h, A).length;
  pass(h); pass(h);
  expectNoPlacement(h, A, src, before, 'Hooba-Bot (dead source)');
  assert.ok(!unitsOf(h, A).some(u => u.card === 'Robot'), 'no Robot anywhere');
  assert.deepEqual(h.state.battle!.columns, [[whale]]);
  finishBattle(h);
});

test('R225 Hooba-Bot: alive but out of the formation (R172) → no Robot, no question', () => {
  const { h, A, D, src, whale } = twoColumnAttack(10523, 'Hooba-Bot');
  unslotSource(h, src, D, A);
  const before = unitsOf(h, A).length;
  pass(h); pass(h);
  expectNoPlacement(h, A, src, before, 'Hooba-Bot (in play, unslotted)');
  assert.ok(!unitsOf(h, A).some(u => u.card === 'Robot'), 'no Robot anywhere');
  assert.deepEqual(h.state.battle!.columns, [[whale]]);
  finishBattle(h);
});

// ── Hooba-God — "create a token that's a copy of me in my formation" ────────

test('R225 Hooba-God: killed under its own attack trigger → no copy (the pre-R225 guard already held)', () => {
  const { h, A, src, whale } = twoColumnAttack(10524, 'Hooba-God');
  killSource(h, src);
  const before = unitsOf(h, A).length;
  pass(h); pass(h);
  expectNoPlacement(h, A, src, before, 'Hooba-God (dead source)');
  assert.deepEqual(h.state.battle!.columns, [[whale]]);
  finishBattle(h);
});

test('R225 Hooba-God: alive but out of the formation (R172) → no copy — IN PLAY was the wrong predicate', () => {
  const { h, A, D, src, whale } = twoColumnAttack(10525, 'Hooba-God');
  unslotSource(h, src, D, A);
  const before = unitsOf(h, A).length;
  pass(h); pass(h);
  expectNoPlacement(h, A, src, before, 'Hooba-God (in play, unslotted)');
  assert.ok(!unitsOf(h, A).some(u => u.id !== src && u.card === 'Hooba-God'), 'no copy token');
  assert.deepEqual(h.state.battle!.columns, [[whale]]);
  finishBattle(h);
});

// ── Hooba-Pon — "you may play a unit from your hand into an open position in
//    my formation (you still pay the cost)" ─────────────────────────────────

test('R225 Hooba-Pon: killed under its own attack trigger → nothing played, and NOTHING PAID', () => {
  const { h, A, src, whale } = twoColumnAttack(10526, 'Hooba-Pon');
  giveResources(h, A, 'water', 4);
  give(h, A, 'Hooba-Pon');                            // a unit it could otherwise pay for
  const hand = [...h.state.players[A]!.hand];
  const purse = JSON.stringify(h.state.players[A]!.resources);
  killSource(h, src);
  const before = unitsOf(h, A).length;
  pass(h); pass(h);
  expectNoPlacement(h, A, src, before, 'Hooba-Pon (dead source)');
  assert.deepEqual(h.state.players[A]!.hand, hand, 'the hand is untouched');
  assert.equal(JSON.stringify(h.state.players[A]!.resources), purse, 'and no resource was spent');
  assert.deepEqual(h.state.battle!.columns, [[whale]]);
  finishBattle(h);
});

test('R225 Hooba-Pon: alive but out of the formation (R172) → the PAY QUESTION is never asked', () => {
  const { h, A, D, src, whale } = twoColumnAttack(10527, 'Hooba-Pon');
  giveResources(h, A, 'water', 4);
  give(h, A, 'Hooba-Pon');
  const hand = [...h.state.players[A]!.hand];
  const purse = JSON.stringify(h.state.players[A]!.resources);
  unslotSource(h, src, D, A);
  const before = unitsOf(h, A).length;
  pass(h); pass(h);
  // the guard is AHEAD of the pay question on purpose: asked after it, a
  // player pays a card's full cost for a play that cannot happen, and
  // `payCard` has no refund.
  expectNoPlacement(h, A, src, before, 'Hooba-Pon (in play, unslotted)');
  assert.deepEqual(h.state.players[A]!.hand, hand, 'the hand is untouched');
  assert.equal(JSON.stringify(h.state.players[A]!.resources), purse,
    'and the player was never charged for a play that could not happen');
  assert.deepEqual(h.state.battle!.columns, [[whale]]);
  finishBattle(h);
});

/* ── the class fix, rather than four card fixes ─────────────────────────── */

/** every `.name(...)` call in `src`, balanced-paren, as source text */
function callsIn(src: string, name: string): string[] {
  const out: string[] = [];
  const needle = `.${name}(`;
  for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + needle.length)) {
    let depth = 0, j = i + needle.length - 1;
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')' && --depth === 0) break;
    }
    out.push(src.slice(i, j + 1));
  }
  return out;
}

async function cardSources(): Promise<{ file: string; text: string }[]> {
  const dir = new URL('../src/cards/', import.meta.url);
  const names = (await readdir(dir, { recursive: true })).filter(f => f.endsWith('.ts'));
  return Promise.all(names.map(async f => ({ file: f, text: await readFile(new URL(f, dir), 'utf8') })));
}

test('R225 conformance: EVERY card call site of placeInFormation names its source ENTITY', async () => {
  // DERIVED, never typed. The repo's signature failure is a one-card fix for a
  // whole class (report #46, closed single-card and re-filed twice), so the
  // guard's membership is computed from the tree: a FIFTH card that calls
  // placeInFormation without a `sourceId` reddens this the day it lands,
  // instead of shipping the FTUW bug again under a new name.
  const sites = (await cardSources())
    .flatMap(({ file, text }) => callsIn(text, 'placeInFormation').map(call => ({ file, call })));
  assert.ok(sites.length >= 4,
    `the scan must actually find the call sites — it found ${sites.length}, so it is not testing anything`);
  const bare = sites.filter(s => !/\bsourceId\s*:/.test(s.call));
  assert.deepEqual(bare.map(s => `${s.file}: ${s.call.replace(/\s+/g, ' ')}`), [],
    '"in my formation" is read off the SOURCE (R225/R27), and a display string cannot answer that: '
    + 'pass `sourceId: <the source entity id>`, and guard the effect on it BEFORE anything is minted or paid');
});

test('R225 conformance: every "in my formation" placer guards on the SOURCE before it spawns', async () => {
  // The second half of the same class: a guard that runs AFTER the spawn
  // leaves a token stranded in the region, which is a different wrong answer
  // rather than a safe one. Every effect body that calls placeInFormation must
  // mention `columnOf` (or `myFormationSlots`) — the source-read primitives —
  // somewhere in the same card definition.
  const offenders: string[] = [];
  for (const { file, text } of await cardSources()) {
    for (const m of text.matchAll(/\bcard\('([^']+)',/g)) {
      const start = m.index!;
      const next = text.indexOf("\ncard('", start + 1);
      const body = text.slice(start, next === -1 ? text.length : next);
      if (!body.includes('.placeInFormation(')) continue;
      if (!/\.(columnOf|myFormationSlots|formationSeatOf)\(/.test(body)) offenders.push(`${file}: ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, [],
    'guard on the source\'s own formation (E.columnOf / E.myFormationSlots) before creating or paying');
});

/* ── report #107: the ask can be pointed at, and the ANSWER did not move ─── */

test('#107 R75: the slot ask carries the real FormationSpot, and is still ANSWERED BY INDEX', () => {
  const h = new Harness(10528, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative;
  const bot = spawn(h, A, 'Hooba-Bot');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bot]] });
  pass(h); pass(h);
  expectSlotAsk(h, A, 'Hooba-Bot');
  const opts = h.state.decision!.options;
  // ⚠ THE ANSWER NAMESPACE IS THE INTEGER INDEX AND MUST STAY THERE. Every
  // saved game keys its `decide` on the decision kind, the option count and
  // the chosen option's LABEL (server/rooms.ts referenceKey); the engine reads
  // `value` as a slot index. `spot` is additive and display-only — read it to
  // resolve an answer and every saved game re-keys, taking
  // 143-replay-divergence and the R200 forensic stack with it.
  assert.deepEqual(opts.map(o => o.value), [0, 1, 2], 'values are still bare slot indexes');
  assert.deepEqual(opts.map(o => o.spot),
    [{ kind: 'end', end: 'left' }, { kind: 'behind', unit: bot }, { kind: 'end', end: 'right' }],
    '#107: and each one now says which real spot on the board it means');
  h.do({ type: 'decide', seat: A, choice: 1 });        // answered by INDEX, as always
  assert.deepEqual(h.state.battle!.columns[0]!.slice(0, 1), [bot]);
  assert.equal(h.state.battle!.columns[0]!.length, 2,
    'index 1 landed where index 1\'s `spot` said it would — behind me');
  finishBattle(h);
});

test('#107: all three formationSlot ask sites are accounted for', async () => {
  // Derived, not typed: three SITES serving seven cards (R75 placeInFormation
  // → Hooba-Lin/Bot/God/Pon-out-of-battle; R29 collectFormationSpot →
  // Tiderunner Initiate/Trench Stalker; R198 pushInlinePlay → Hooba-Pon in
  // battle). A fourth site reddens this, and its author has to give it a
  // `spot` and a test rather than shipping an unpointable question.
  const dir = new URL('../src/', import.meta.url);
  const files = (await readdir(dir, { recursive: true })).filter(f => f.endsWith('.ts'));
  const sites: string[] = [];
  for (const f of files) {
    const text = await readFile(new URL(f, dir), 'utf8');
    for (const line of text.split('\n')) {
      const code = line.trim();
      if (code.startsWith('*') || code.startsWith('//')) continue;   // prose, not a site
      if (code.includes("kind: 'formationSlot'")) sites.push(f);
    }
  }
  assert.deepEqual(sites.sort(), ['cards/sets/batch-water-a.ts', 'engine.ts', 'engine.ts'],
    'a new formationSlot ask must carry `spot` on every option (#107) and be covered here');
});

test('R225 the primitive itself: placeInFormation given a sourceId that is in NO formation refuses', () => {
  // The engine half, tested where the card guards cannot reach it. Both are
  // wanted: the card guard stops the token being minted at all, and this stops
  // a future caller that forgets one from placing into the SEAT's grid — the
  // exact substitution that produced FTUW/45.
  const h = new Harness(10529, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const whale = spawn(h, A, 'Good Whale');
  const loose = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });   // `loose` sat the attack out
  pass(h); pass(h);
  const e = new E(h.state);
  assert.ok(e.formationSlots(A).length, 'the SEAT\'s grid really does have slots on offer');
  assert.equal(e.formationSeatOf(loose), null, 'but the source is standing in no formation');
  assert.deepEqual(e.myFormationSlots(loose), [], 'so "my formation" names none');

  const tok = e.spawnUnit(A, 'Unit Token', h.state.battle!.region, { token: true });
  const asked: unknown[] = [];
  const ctx = { controller: A, choose: (_k: string, d: { options: unknown[] }) => { asked.push(d); return 0; } };
  assert.equal(e.placeInFormation(tok, ctx as never, { source: 'Hooba-Lin', sourceId: loose }), false,
    'R225: the source names no formation, so nothing joins one');
  assert.deepEqual(asked, [], 'and nothing was asked');
  assert.deepEqual(h.state.battle!.columns, [[whale]], 'the line is untouched');
  assert.ok(e.events.some(ev => /not in a formation/.test(ev.msg)), 'it says why — silence is a conformance failure');

  // and the fallback still works for an effect with no source entity at all
  assert.equal(e.placeInFormation(tok, ctx as never, { source: 'a test effect' }), true,
    'no sourceId → the seat\'s grid, which is what an effect with no unit behind it means');
  void D;
  finishBattle(h);
});
