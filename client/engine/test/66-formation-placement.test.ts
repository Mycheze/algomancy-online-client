/* R75 — joining a formation, and what "adjacent" means.
 *
 * Two rulings from Bena, 2026-08-21, and one engine primitive each.
 *
 *   "When something spawns something 'in my formation' or 'in formation', it's
 *    up to the controller of the effect to choose where the unit goes. They can
 *    put it to either side of the existing units OR in the second slot of a
 *    column for a column which only has 1 unit. That choice should be made on
 *    effect resolution."
 *
 *   "If a unit references its own adjacent slots (which only exist if it's in a
 *    formation) it's referring to its sides and above/below. Nothing diagonal."
 *
 * `E.formationSlots` / `E.placeInFormation` answer the first; `E.adjacentSlots`
 * answers the second (with R304, 2026-09-25, opening the ends of the attacking
 * line to it). Five cards were each doing their own version of the
 * first, and one card its own version of the second.
 *
 * The placement tests drive the primitive directly with a stand-in ctx, because
 * the question under test is the SLOT SET and the re-key, not any one card's
 * trigger plumbing; the per-card behaviour is pinned in each card's own file.
 *
 * Seeds 6600-6699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { ent, finishBattle, pass, spawn, toDeployment, toNextBattle } from './util.ts';
import type { EntityId, Seat } from '../src/types.ts';

/** a stand-in EffectCtx: answers every choice with `answer(labels)`. */
function chooser(controller: Seat, answer: (labels: string[]) => number) {
  const seen: string[][] = [];
  return {
    controller,
    seen,
    choose: (_k: string, dec: { options: { label: string; value: unknown }[] }) => {
      const labels = dec.options.map(o => o.label);
      seen.push(labels);
      return dec.options[answer(labels)]!.value;
    },
  };
}
const byLabel = (want: string) => (labels: string[]) => {
  const i = labels.findIndex(l => l === want || l.startsWith(want));
  assert.ok(i !== -1, `no option matching "${want}" in [${labels.join(' | ')}]`);
  return i;
};

function cols(h: Harness): EntityId[][] {
  return h.state.battle!.columns.map(c => c.slice());
}

/** `n` one-unit attacking columns of vanilla 3/3s, stopped at the block step */
function board(seed: number, n = 2): { h: Harness; A: Seat; D: Seat; atk: EntityId[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = Array.from({ length: n }, () => spawn(h, A, 'The Foretold'));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: atk.map(id => [id]) });
  pass(h); pass(h);
  return { h, A, D, atk };
}

/* ── the legal placement set ───────────────────────────────────────────── */

test('R75: both ENDS and the back slot of every one-unit column are offered', () => {
  const { h, A } = board(6600, 2);
  assert.deepEqual(h.q.formationSlots(A).map(s => s.label), [
    'a new column on the left',
    'column 1, behind The Foretold',
    'column 2, behind The Foretold',
    'a new column on the right',
  ]);
});

test('R75: a two-unit column offers no back slot', () => {
  const h = new Harness(6601);
  toDeployment(h);
  const A = h.state.initiative;
  const a = spawn(h, A, 'The Foretold'), b = spawn(h, A, 'The Foretold');
  const c = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a, b], [c]] });
  pass(h); pass(h);
  assert.deepEqual(h.q.formationSlots(A).map(s => s.label), [
    'a new column on the left',
    'column 2, behind The Foretold',
    'a new column on the right',
  ]);
});

test('R75: "either side" means the two ENDS — no insertion between two columns', () => {
  // stated as a reading in the rules entry: the ruling says "to either side of
  // the existing units", and the engine reads "the existing units" as the line
  // as a whole rather than as any one column
  const { h, A } = board(6602, 3);
  const newColumns = h.q.formationSlots(A).filter(s => s.col === null);
  assert.equal(newColumns.length, 2, 'exactly two — one per end');
  assert.deepEqual(newColumns.map(s => s.end), ['left', 'right']);
});

test('R75: a formation you are not standing in cannot be joined at all', () => {
  const h = new Harness(6603);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const a = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a]] });
  pass(h); pass(h);
  assert.deepEqual(h.q.formationSlots(D), [],
    'the defender has declared no blocks — there is no formation of theirs to widen');
});

test('R75: a full BLOCKING formation offers nothing, and the effect says why', () => {
  // the attacker's line can always widen at an end, so "no open position" is a
  // defender's problem: a blocking column is keyed to an attacking column
  // (R72), so a new one has no index to exist at
  const h = new Harness(6604);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const a = spawn(h, A, 'The Foretold');
  const d1 = spawn(h, D, 'The Foretold'), d2 = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1, d2] } });
  assert.deepEqual(h.q.formationSlots(D), [], 'the only blocking column is full');

  const e = new E(h.state);
  const late = e.spawnUnit(D, 'Unit Token', h.state.battle!.region, { token: true });
  const placed = e.placeInFormation(late, chooser(D, () => 0), { source: 'a test effect' });
  assert.equal(placed, false);
  assert.ok(e.events.some(ev => /no open position in the formation/.test(ev.msg)),
    'an effect that cannot place must SAY so — silence is a conformance failure');
  finishBattle(h);
});

/* ── the choice itself ─────────────────────────────────────────────────── */

test('R75: exactly one legal placement is auto-picked, with no decision raised', () => {
  const h = new Harness(6605);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const a = spawn(h, A, 'The Foretold');
  const d1 = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [d1] } });   // one one-unit blocking column

  const e = new E(h.state);
  const late = e.spawnUnit(D, 'Unit Token', h.state.battle!.region, { token: true });
  const ctx = chooser(D, () => { throw new Error('should not have asked'); });
  assert.equal(e.placeInFormation(late, ctx, { source: 'a test effect' }), true);
  assert.deepEqual(ctx.seen, [], 'one candidate, no question');
  assert.deepEqual(h.state.battle!.blocks[0], [d1, late.id], 'it took the only slot');
  finishBattle(h);
});

test('R75: the chooser is the EFFECT\'s controller, and declining is only offered when optional', () => {
  const { h, A, atk } = board(6606, 1);
  const e = new E(h.state);
  const tok = e.spawnUnit(A, 'Unit Token', h.state.battle!.region, { token: true });
  const ctx = chooser(A, byLabel('column 1, behind'));
  assert.equal(e.placeInFormation(tok, ctx, { source: 'a test effect' }), true);
  assert.deepEqual(ctx.seen, [[
    'a new column on the left', 'column 1, behind The Foretold', 'a new column on the right',
  ]], 'no "stay out" answer unless the printed text says "may"');
  assert.deepEqual(cols(h), [[atk[0]!, tok.id]]);

  const tok2 = e.spawnUnit(A, 'Unit Token', h.state.battle!.region, { token: true });
  const ctx2 = chooser(A, byLabel('stay out'));
  assert.equal(e.placeInFormation(tok2, ctx2, { source: 'a test effect', optional: true }), false);
  assert.ok(ctx2.seen[0]!.includes('stay out of formation'));
  assert.ok(e.events.some(ev => /stays out of the formation/.test(ev.msg)), 'and it says so');
  assert.deepEqual(cols(h), [[atk[0]!, tok.id]], 'the formation is unchanged');
  finishBattle(h);
});

/* ── the dangerous one: a column opened at index 0 ─────────────────────── */

test('R75: opening a column on the LEFT re-keys every block and every column counter', () => {
  const { h, A, D, atk } = board(6607, 2);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  // give column 1 a block and a column-scoped ledger, then push a column in
  // front of both of them
  const e0 = new E(h.state);
  const blk = e0.spawnUnit(D, 'Unit Token', h.state.battle!.region, { token: true });
  h.state.battle!.blocks[1] = [blk.id];
  const region = h.state.battle!.region;
  e0.bumpBattleCounter(region, e0.colCounterKey(1, 'connected'), 7);

  const e = new E(h.state);
  const tok = e.spawnUnit(A, 'Unit Token', region, { token: true });
  assert.equal(e.placeInFormation(tok, chooser(A, byLabel('a new column on the left')), {
    source: 'a test effect',
  }), true);

  const b = h.state.battle!;
  assert.deepEqual(cols(h), [[tok.id], [atk[0]!], [atk[1]!]], 'it went in at index 0');
  assert.deepEqual(Object.keys(b.blocks), ['2'], 'the block key shifted with its attacker');
  assert.deepEqual(b.blocks[2], [blk.id]);
  assert.equal(b.blocks[1], undefined, 'and is not still sitting at the old index');
  assert.equal(h.q.battleCounter(region, h.q.colCounterKey(2, 'connected')), 7,
    'the column-scoped ledger shifted too');
  assert.equal(h.q.battleCounter(region, h.q.colCounterKey(1, 'connected')), 0);
});

test('R75: opening a column on the RIGHT disturbs nothing', () => {
  const { h, A, D, atk } = board(6608, 2);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  const e0 = new E(h.state);
  const blk = e0.spawnUnit(D, 'Unit Token', h.state.battle!.region, { token: true });
  h.state.battle!.blocks[1] = [blk.id];

  const e = new E(h.state);
  const tok = e.spawnUnit(A, 'Unit Token', h.state.battle!.region, { token: true });
  e.placeInFormation(tok, chooser(A, byLabel('a new column on the right')), { source: 'a test effect' });
  assert.deepEqual(cols(h), [[atk[0]!], [atk[1]!], [tok.id]]);
  assert.deepEqual(h.state.battle!.blocks[1], [blk.id], 'the key is where it was');
});

/* ── R72 × R75: the same data model from opposite ends ─────────────────── */

test('R75: a placement right after a collapse offers the ends of the COLLAPSED line', () => {
  const { h, A, atk } = board(6609, 3);
  new E(h.state).destroy(ent(h, atk[1]!)!, 'is deleted');   // middle column, unblocked → collapses
  new E(h.state).settle();
  assert.deepEqual(cols(h), [[atk[0]!], [atk[2]!]], 'R72 closed the gap');

  assert.deepEqual(h.q.formationSlots(A).map(s => s.label), [
    'a new column on the left',
    'column 1, behind The Foretold',
    'column 2, behind The Foretold',
    'a new column on the right',
  ], 'two columns, so two back slots and two ends — not three of anything');

  const e = new E(h.state);
  const tok = e.spawnUnit(A, 'Unit Token', h.state.battle!.region, { token: true });
  e.placeInFormation(tok, chooser(A, byLabel('a new column on the right')), { source: 'a test effect' });
  assert.deepEqual(cols(h), [[atk[0]!], [atk[2]!], [tok.id]]);
  finishBattle(h);
});

test('R75: a placement can FILL an R72 hole, and can never create one', () => {
  const { h, A, D, atk } = board(6610, 3);
  const e0 = new E(h.state);
  const big = e0.spawnUnit(D, 'The Foretold', h.state.battle!.region);
  e0.setBase(big, 9, 9);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [big.id] } });
  pass(h); pass(h);                                          // combat: the middle attacker dies
  assert.deepEqual(cols(h), [[atk[0]!], [], [atk[2]!]], 'a hole, held open by its blocker (R72)');

  const e = new E(h.state);
  const tok = e.spawnUnit(A, 'Unit Token', h.state.battle!.region, { token: true });
  assert.ok(h.q.formationSlots(A).some(s => /column 2 \(an empty slot/.test(s.label)),
    'the hole is an open position — the only way a line ever heals one');
  e.placeInFormation(tok, chooser(A, byLabel('column 2 (an empty slot')), { source: 'a test effect' });
  assert.deepEqual(cols(h), [[atk[0]!], [tok.id], [atk[2]!]], 'the hole is filled in place');
  assert.deepEqual(h.state.battle!.blocks[1], [big.id], 'and it walks straight into the block');

  // and every other placement adds a unit, so none of them can empty a column
  e.settle();
  assert.ok(!h.state.battle!.columns.some(c => c.length === 0), 'no hole was created');
  finishBattle(h);
});

/* ── adjacency: sides and above/below, nothing diagonal ────────────────── */

test('R75 adjacency: my own back slot, and the same ROW of each neighbour', () => {
  const h = new Harness(6611);
  toDeployment(h);
  const A = h.state.initiative;
  const l = spawn(h, A, 'The Foretold');
  const me = spawn(h, A, 'The Foretold');
  const r = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[l], [me], [r]] });
  pass(h); pass(h);
  // every neighbour's front row is taken, so only my own back slot is empty
  assert.deepEqual(h.q.adjacentSlots(me).map(s => s.label), ['column 2, behind The Foretold']);
  // …and the neighbours' empty BACK slots are diagonal to me, so they are not
  // mine. (The leftmost unit also has the new column past the end — R304.)
  assert.deepEqual(h.q.adjacentSlots(l).map(s => s.label), ['a new column on the left', 'column 1, behind The Foretold']);
});

test('R75 adjacency: the same row of a neighbour IS adjacent when it is empty', () => {
  // a hole (R72) is an existing column with an empty front row: my left-hand
  // neighbour's front slot, at my row
  const { h, D, atk } = board(6612, 3);
  const e0 = new E(h.state);
  const big = e0.spawnUnit(D, 'The Foretold', h.state.battle!.region);
  e0.setBase(big, 9, 9);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 1: [big.id] } });
  pass(h); pass(h);
  assert.deepEqual(cols(h), [[atk[0]!], [], [atk[2]!]]);
  // atk[2] sits at (column 3, front). Adjacent: (2, front) — the hole — its
  // own back slot, and (R304) the front of a new column past the right end.
  assert.deepEqual(h.q.adjacentSlots(atk[2]!).map(s => s.label),
    ['column 2, front row', 'column 3, behind The Foretold', 'a new column on the right']);
  finishBattle(h);
});

test('R304 adjacency: past the edge of the ATTACKING line is a slot — the front of a new column', () => {
  // R304 (Bena 2026-09-25): "The columns to the left and right, even when
  // empty, DO technically exist." R75 read the edge the other way and this
  // test asserted it; a front-row unit at either end now has the new column
  // beyond it, the same end formationSlots offers.
  const { h, atk } = board(6613, 2);
  const left = h.q.adjacentSlots(atk[0]!);
  assert.deepEqual(left.map(s => s.label), ['a new column on the left', 'column 1, behind The Foretold']);
  assert.deepEqual(left.filter(s => s.col === null).map(s => s.end), ['left'], 'only the left end, from the left unit');
  const right = h.q.adjacentSlots(atk[1]!);
  assert.deepEqual(right.map(s => s.label), ['column 2, behind The Foretold', 'a new column on the right']);
  assert.deepEqual(right.filter(s => s.col === null).map(s => s.end), ['right']);
});

test('R304 adjacency: a BACK-row unit and a BLOCKING line have nothing past the edge', () => {
  const h = new Harness(6617);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const front = spawn(h, A, 'The Foretold');
  const back = spawn(h, A, 'The Foretold');
  const blocker = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[front, back]] });
  pass(h); pass(h);
  // the slot beside a back-row unit past the end is the back row of a column
  // with no front — unreachable, the front row fills first
  assert.deepEqual(h.q.adjacentSlots(back), [], 'a full column, and no reachable slot past either end');
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blocker] } });
  // a blocking column is keyed to an attacking one (R72), so the blocking
  // line cannot open a column of its own at either end
  assert.deepEqual(h.q.adjacentSlots(blocker).map(s => s.label), ['column 1, behind The Foretold'],
    'the blocker has its own back slot and nothing past the edges');
  finishBattle(h);
});

test('R75 adjacency: a unit out of formation has no adjacent slots', () => {
  const { h, A } = board(6614, 2);
  const bystander = spawn(h, A, 'The Foretold');   // spawned at home, never declared
  assert.deepEqual(h.q.adjacentSlots(bystander), []);
});

test('R75 adjacency: the front row always fills first, so no slot is ever stranded', () => {
  // the invariant the "empty back slot above an empty front slot" case rests
  // on: removeFromFormation promotes the back row, repairFormation splices dead
  // ids out, and every placement appends — so a column is [], [front] or
  // [front, back], never [gap, back].
  const h = new Harness(6615);
  toDeployment(h);
  const A = h.state.initiative;
  const front = spawn(h, A, 'The Foretold');
  const back = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[front, back]] });
  pass(h); pass(h);
  new E(h.state).destroy(ent(h, front)!, 'is deleted');
  new E(h.state).settle();
  assert.deepEqual(cols(h), [[back]], 'the back row came forward rather than leaving a gap');
  assert.deepEqual(h.q.adjacentSlots(back).map(s => s.label),
    ['a new column on the left', 'column 1, behind The Foretold', 'a new column on the right'],
    'and the empty slot in its column is the BACK one, which is the only one that can exist');
  finishBattle(h);
});

/* ── the Manual's other formation rules, guarded ───────────────────────── */

test('R75: formations scale infinitely in width — repeated LEFT inserts keep every key straight', () => {
  // Manual: "Formations have a front and back row but can scale infinitely in
  // width", and the human: "there can be column 0 or -1". The engine keeps
  // integer keys and NORMALISES on every left-insert instead of going negative:
  // a left-insert relabels every column and everything keyed to one, in a
  // single commit, which is observationally identical to negative indices and
  // keeps the `declareBlocks` wire format (0..n-1) replayable.
  const { h, A, D, atk } = board(6616, 2);
  const region = h.state.battle!.region;
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  const e0 = new E(h.state);
  const blk = e0.spawnUnit(D, 'Unit Token', region, { token: true });
  h.state.battle!.blocks[1] = [blk.id];
  e0.bumpBattleCounter(region, e0.colCounterKey(1, 'tag'), 4);

  const e = new E(h.state);
  const added: EntityId[] = [];
  for (let i = 0; i < 4; i++) {
    const tok = e.spawnUnit(A, 'Unit Token', region, { token: true });
    added.push(tok.id);
    e.placeInFormation(tok, chooser(A, byLabel('a new column on the left')), { source: 'a test effect' });
  }
  assert.deepEqual(cols(h),
    [[added[3]!], [added[2]!], [added[1]!], [added[0]!], [atk[0]!], [atk[1]!]],
    'six columns, newest on the left');
  assert.deepEqual(Object.keys(h.state.battle!.blocks), ['5'],
    'the block followed its attacker across four relabels');
  assert.deepEqual(h.state.battle!.blocks[5], [blk.id]);
  assert.equal(h.q.battleCounter(region, h.q.colCounterKey(5, 'tag')), 4, 'and so did its ledger');
});

test('R75: a blocking formation may legitimately have EMPTY columns, and they are never "repaired"', () => {
  // Manual: "a blocking formation is allowed to be assigned with empty
  // columns." The collapse only ever looks at the ATTACKING line, and only
  // before blocks are declared, so a deliberately sparse block map is safe.
  const h = new Harness(6617);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const a = [0, 1, 2].map(() => spawn(h, A, 'The Foretold'));
  const d = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: a.map(id => [id]) });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 2: [d] } });   // only the third column
  assert.deepEqual(Object.keys(h.state.battle!.blocks), ['2'], 'columns 1 and 2 are unblocked');
  new E(h.state).settle();
  assert.deepEqual(Object.keys(h.state.battle!.blocks), ['2'], 'and stay that way');
  assert.equal(h.state.battle!.columns.length, 3);
  finishBattle(h);
});
