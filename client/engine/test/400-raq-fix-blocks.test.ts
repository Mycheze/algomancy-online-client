/**
 * RAQ fix F2 — what is blocked, side-blocks, flash blocks, and the column's
 * memory of the damage sub-step it struck in. The thread claims themselves
 * are 388's (their {todo}s are gone); this file pins the parts of the
 * mechanism those claims do not reach.
 *
 *  - R320 (CT-202): a column that struck in the Swift sub-step deals no
 *    normal damage, and one that struck in the normal sub-step deals no
 *    Sluggish damage — "Swift/Normal/Sluggish" thread.
 *  - R321 (CT-203): side-blocks — blockers where no attacker is, any number,
 *    each its own column; they count as blocked and deal no combat damage —
 *    "What is blocked?" and "Piercing, side block and combat damage from
 *    defending formation".
 *  - R322 (CT-203): a unit put into the defending formation after blocks may
 *    stand in front of an unblocked attacker, and it blocks it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { blockDeclarationIssue } from '../src/apply.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, finishBattle, give, giveResources, pass, spawn, toDeployment, toNextBattle, unitsOf } from './util.ts';

function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  return u.id;
}
function passTo(h: Harness, seat: Seat): void {
  let guard = 8;
  while (h.state.priority !== seat && h.state.priority !== null && guard-- > 0) pass(h);
  assert.equal(h.state.priority, seat, 'priority reached the acting seat');
}
/** answer a formationSlot ask with the option whose label matches */
function place(h: Harness, re: RegExp): void {
  const dec = h.state.decision;
  assert.ok(dec, 'a placement is asked');
  const i = dec.options.findIndex(o => re.test(o.label));
  assert.ok(i >= 0, `an option matching ${re} (menu: ${dec.options.map(o => o.label).join(' | ')})`);
  h.do({ type: 'decide', seat: dec.seat, choice: i });
}

// ── R321: side-blocks ──

test('R321 side-blocks: two units block where no attacker is, each its own column, and Roving Quillback counts both', () => {
  const h = new Harness(40001);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const quill = spawn(h, A, 'Roving Quillback');      // 1/3 — 1 damage per blocked column
  const s1 = tok(h, D, 2, 2), s2 = tok(h, D, 2, 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[quill]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [s1], 2: [s2] } });
  const b = h.state.battle!;
  assert.equal(b.columns.length, 3, 'two empty attacking columns opened opposite the side-blocks');
  assert.deepEqual(b.columns.slice(1), [[], []]);
  assert.deepEqual(Object.keys(b.blocks).map(Number), [1, 2], 'the attack column itself stays unblocked');
  pass(h); pass(h);                                    // the Quillback trigger resolves
  assert.equal(h.state.players[D]!.life, 30 - 2, 'Quillback: 1 for each of the two side-blocked columns');
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 30 - 2 - 1, 'and the unblocked Quillback hits for its 1');
  assert.equal(h.state.players[A]!.life, 30, 'the side-blockers deal no combat damage');
  assert.equal(ent(h, s1)!.damage, 0, 'and take none');
});

test('R321 a Piercing side-blocker deals no combat damage to the attacking player', () => {
  // _passer: "Does my side-blocking units deal combat damage to enemy face?
  // No. … They wouldn't attack at all since they don't have any attacking
  // enemy units in front of them."
  const h = new Harness(40002);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 5);
  const side = tok(h, D, 5, 5);
  new E(h.state).addTempAttr(new E(h.state).entity(side)!, 'Piercing');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [side] } });
  finishBattle(h);
  assert.equal(h.state.players[A]!.life, 30, 'the Piercing side-block has nobody in front of it to pierce through');
  assert.equal(h.state.players[D]!.life, 30 - 1, 'the unblocked attacker still connects');
});

test('R321 a side-block on the left opens a column before column 1, and the attack moves right', () => {
  const h = new Harness(40003);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 2, 5);
  const side = tok(h, D, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { [-1]: [side] } });
  const b = h.state.battle!;
  assert.deepEqual(b.columns, [[], [atk]], 'an empty column on the left, the attack at index 1');
  assert.deepEqual(b.blocks, { 0: [side] }, 'the side-block keyed to the new column');
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 30 - 2, 'the attack column is unblocked and connects');
});

test('R321 side-blocks reach no further out than the declaration is wide', () => {
  const h = new Harness(40004);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 5);
  const side = tok(h, D, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  const issue = (blocks: Record<number, EntityId[]>): string | null =>
    blockDeclarationIssue(new E(structuredClone(h.state)), D, blocks, []);
  assert.equal(issue({ 1: [side] }), null, 'right beside the attack');
  assert.equal(issue({ [-1]: [side] }), null, 'or on the other side of it');
  assert.match(issue({ 3: [side] }) ?? '', /no such blocking column/, 'one unit cannot stand three columns out');
});

// ── R322: a blocker put in after blocks ──

test('R322 a Tiderunner put in front of an unblocked attacker fights it — the attacker deals its damage to the Tiderunner', () => {
  const h = new Harness(40005);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 3);
  giveResources(h, D, 'water', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tiderunner Initiate') });
  place(h, /^column 1, blocking it/);
  pass(h); pass(h);
  const runner = unitsOf(h, D).find(u => u.card === 'Tiderunner Initiate')!;
  let guard = 10;                                      // to the after-combat window (regroup wipes damage)
  while (h.state.battle?.step !== 'afterWindow' && guard-- > 0) pass(h);
  assert.equal(h.state.battle?.step, 'afterWindow');
  assert.equal(h.state.players[D]!.life, 30, 'no damage through a blocked column');
  assert.equal(ent(h, runner.id)!.damage, 1, 'the attacker hit the Tiderunner');
  assert.equal(ent(h, atk)!.damage, 2, 'and the Tiderunner hit back');
  finishBattle(h);
});

test('R322 the attacker is never offered a blocking spot', () => {
  const h = new Harness(40006);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 3);
  tok(h, D, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  const g = new E(h.state);
  assert.ok(g.formationSlots(A).every(s => s.spot.kind !== 'block'), 'the attacker gets no block spots');
  assert.deepEqual(g.formationSlots(D).map(s => s.spot), [{ kind: 'block', column: 0 }], 'the defender gets one, for column 1');
});

// ── R320: the mark is the column's, through a re-key ──

test('R320 a struck mark moves with its column when a new column opens on the left', () => {
  const h = new Harness(40007);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dune = spawn(h, A, 'Dune Drifter');          // 2/1 {Swift}
  const back = tok(h, A, 3, 3);                      // Swift while the Drifter is beside it
  const plain = tok(h, A, 1, 1);                     // a normal column, so there is a normal sub-step
  giveResources(h, A, 'water', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dune, back], [plain]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  let guard = 8;
  while (h.state.battle?.step !== 'damageWindow' && guard-- > 0) pass(h);
  assert.equal(h.state.players[D]!.life, 30 - 5, 'the Swift column struck for 2 + 3');
  passTo(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Tiderunner Initiate') });
  place(h, /new column on the left/);
  pass(h); pass(h);
  assert.equal(h.state.battle!.columns.findIndex(c => c.includes(back)), 1, 'the marked column is now column 2');
  {
    const g = new E(h.state);
    g.recall(g.entity(dune)!);
    g.settle();
  }
  finishBattle(h);
  assert.equal(h.state.players[D]!.life, 30 - 5 - 2 - 1,
    'normal sub-step: the new Tiderunner column and the plain one — the 3/3 already struck with its column');
});
