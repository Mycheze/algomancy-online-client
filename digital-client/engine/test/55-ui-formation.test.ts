/* ui/formation.ts — the battle panel's column arithmetic. Seeds not needed:
 * these are pure functions over formation shapes.
 *
 * Both behaviours are playtest DEYK reports (2026-08-20, room DEYK):
 *  · "the blocks that show that my opponent are doing are wrong on my screen…
 *    it fixed itself when blocks were declared" — publishCols
 *  · "you can see the whole column, including the back row (which might be
 *    totally empty)… all the needed slots should be shown when there's a
 *    choice to be made" — halfRows
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { halfRows, MAX_ROWS, publishCols, rekeyBuild } from '../ui/formation.ts';

// ── publishCols ───────────────────────────────────────────────────────

test('publishCols: a hole keeps its lane', () => {
  // the exact shape of the reported game: eight attacking columns, blocks on
  // 1, 5 and 7 (0-indexed). Compacting these to three columns is what put the
  // blockers under columns 1, 2 and 3 on the attacker's screen.
  const cols: (readonly number[] | undefined)[] = new Array(8).fill(undefined);
  cols[1] = [52]; cols[5] = [60]; cols[7] = [4];
  const out = publishCols(cols);
  assert.equal(out.length, 8, 'the array still reaches column 8');
  assert.deepEqual(out[1], [52]);
  assert.deepEqual(out[5], [60]);
  assert.deepEqual(out[7], [4]);
  assert.deepEqual(out[0], [], 'the holes are empty, not absent');
  assert.deepEqual(out[4], []);
});

test('publishCols: trailing empties are dropped, interior ones are not', () => {
  const out = publishCols([[1], undefined, [2], undefined, undefined]);
  assert.deepEqual(out, [[1], [], [2]], 'trimmed to the last column that holds anything');
});

test('publishCols: nothing placed publishes nothing', () => {
  assert.deepEqual(publishCols([]), []);
  assert.deepEqual(publishCols([undefined, [], undefined]), []);
});

test('publishCols: the result is a copy — the caller keeps mutating its own', () => {
  const mine = [[1, 2]];
  const out = publishCols(mine);
  mine[0]!.push(3);
  assert.deepEqual(out[0], [1, 2], 'what was published is what was published');
});

// ── halfRows ──────────────────────────────────────────────────────────

test('halfRows: the deepest column sets the shared height', () => {
  assert.equal(halfRows([[1], [2, 3], [4]]), 2, 'one two-deep column makes every half two');
  assert.equal(halfRows([[1], [2], [3]]), 1, 'all one-deep: reserve one row, not two');
});

test('halfRows: an empty half reserves nothing at all', () => {
  assert.equal(halfRows([]), 0);
  assert.equal(halfRows([undefined, [], undefined]), 0,
    'nobody blocked anything — the whole half collapses');
});

test('halfRows: while the choice is yours, every slot is drawn', () => {
  assert.equal(halfRows([], true), MAX_ROWS, 'building an empty formation still shows both rows');
  assert.equal(halfRows([[1], [2]], true), MAX_ROWS, 'and does not shrink to what is placed');
  assert.equal(halfRows([[1], [2]], false), 1, 'but the moment it is committed it collapses');
});

test('halfRows: never exceeds the game\'s own two-row limit', () => {
  // a malformed column cannot stretch the board
  assert.equal(halfRows([[1, 2]]), MAX_ROWS, 'a full column is exactly the limit');
  assert.equal(halfRows([[1, 2, 3, 4]]), MAX_ROWS, 'and an impossible one is clamped to it');
});

// ── rekeyBuild ────────────────────────────────────────────────────────
//
// R72 (playtest BRDM, 2026-08-20, fixed round 13): "if the last unit in a
// column is removed from a formation, the columns on its sides will close in
// to fill the gap. THIS ONLY HAPPENS BEFORE BLOCKS ARE DECLARED" — so the
// attacking line's indices are still moving during the `blocks` step, which
// is precisely when the defender is clicking to build a preview keyed by
// those indices. R75's left-insert is the same shift the other way.
//
// The re-key follows the ATTACKERS, not the index, so every one of these is a
// question about who a blocker is answering rather than where it is sitting.

/** the attacking line, one attacker per column, written the short way */
const line = (...cols: number[][]): number[][] => cols;

test('rekeyBuild: a collapse to the LEFT drags the block along with its attacker', () => {
  // three attackers; I am blocking the RIGHTMOST one (column 2, attacker 30)
  const before = line([10], [20], [30]);
  const build: (readonly number[] | undefined)[] = [];
  build[2] = [99];
  // column 0 is emptied and the line closes ranks: 20 is now 0, 30 is now 1
  const after = line([20], [30]);
  const r = rekeyBuild(before, after, build);
  assert.equal(r.changed, true, 'the key moved, so the caller has to repaint');
  assert.deepEqual(r.dropped, [], 'nothing was lost — 30 is still on the board');
  assert.deepEqual(r.columns[1], [99], 'my blocker followed attacker 30 to column 1');
  assert.deepEqual(r.columns[0], [], 'and column 0 — attacker 20 — is still unblocked');
  assert.equal(r.columns.length, 2, 'and nothing is keyed past the last blocked lane');
});

test('rekeyBuild: a collapse to the RIGHT does not disturb the column being built', () => {
  const before = line([10], [20], [30]);
  const build: (readonly number[] | undefined)[] = [[99]];   // blocking attacker 10
  const after = line([10], [20]);                            // column 2 emptied
  const r = rekeyBuild(before, after, build);
  assert.equal(r.changed, false, 'nothing at or left of my column moved');
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.columns[0], [99], 'my blocker is where I put it');
});

test('rekeyBuild: the column I was blocking is the one that collapses', () => {
  // the only case with no honest remap: attacker 20 is dead, so the two
  // blockers I committed to it are answering nothing at all
  const before = line([10], [20], [30]);
  const build: (readonly number[] | undefined)[] = [];
  build[1] = [98, 99];
  const after = line([10], [30]);
  const r = rekeyBuild(before, after, build);
  assert.equal(r.changed, true);
  assert.deepEqual(r.dropped, [98, 99],
    'handed back unplaced rather than silently slid onto attacker 30');
  assert.deepEqual(r.columns, [], 'and nothing is left keyed to a column that is gone');
});

test('rekeyBuild: a left-insert (R75) shifts the keys the other way', () => {
  // "formations can scale infinitely in width" — a placement can open a new
  // column at the LEFT end, which renumbers every existing column upward
  const before = line([10], [20]);
  const build: (readonly number[] | undefined)[] = [[98], [99]];
  const after = line([77], [10], [20]);
  const r = rekeyBuild(before, after, build);
  assert.equal(r.changed, true);
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.columns[0], [], 'the new column arrives unblocked');
  assert.deepEqual(r.columns[1], [98], 'attacker 10 kept its blocker');
  assert.deepEqual(r.columns[2], [99], 'and so did attacker 20');
});

test('rekeyBuild: a RIGHT-end insert (R75) shifts nothing and must cost nothing', () => {
  // the case a `columns.length` trigger gets exactly backwards: the length
  // changed, and re-seeding here would throw the work away for free
  const before = line([10], [20]);
  const build: (readonly number[] | undefined)[] = [[98], [99]];
  const r = rekeyBuild(before, line([10], [20], [77]), build);
  assert.equal(r.changed, false, 'a wider line is not a moved line');
  assert.deepEqual(r.dropped, []);
});

test('rekeyBuild: a collapse and a right-end insert in one action leave the length alone', () => {
  // one spell kills the unit holding column 0 and places a unit in formation
  // (R75 resolves the placement on the same death). `columns.length` is 3
  // before and 3 after — a length-delta trigger sees NOTHING, and every
  // blocker is now under the wrong attacker.
  const before = line([10], [20], [30]);
  const build: (readonly number[] | undefined)[] = [];
  build[1] = [98]; build[2] = [99];
  const after = line([20], [30], [77]);
  assert.equal(before.length, after.length, 'the premise: no length change to trigger on');
  const r = rekeyBuild(before, after, build);
  assert.equal(r.changed, true, 'the keys moved even though the width did not');
  assert.deepEqual(r.columns[0], [98], 'attacker 20 kept its blocker');
  assert.deepEqual(r.columns[1], [99], 'attacker 30 kept its blocker');
  assert.equal(r.columns.length, 2,
    'and the newcomer is simply not keyed — trailing lanes stop where the blockers do');
  assert.deepEqual(r.dropped, []);
});

test('rekeyBuild: a still line is a no-op the caller can skip', () => {
  const before = line([10], [20], [30]);
  const build: (readonly number[] | undefined)[] = [];
  build[1] = [99];
  const r = rekeyBuild(before, line([10], [20], [30]), build);
  assert.equal(r.changed, false, 'no repaint, no republish, no toast');
  assert.deepEqual(r.dropped, []);
});

test('rekeyBuild: a back-row promotion is not a collapse', () => {
  // vertical gravity runs ALWAYS, horizontal only before blocks — a column
  // that loses its front unit but keeps its back one has not moved anywhere
  const before = line([10, 11], [20]);
  const build: (readonly number[] | undefined)[] = [[98], [99]];
  const r = rekeyBuild(before, line([11], [20]), build);
  assert.equal(r.changed, false, 'the column is still the same column');
  assert.deepEqual(r.dropped, []);
});

test('rekeyBuild: two collapses at once move a key two lanes', () => {
  const before = line([10], [20], [30], [40]);
  const build: (readonly number[] | undefined)[] = [];
  build[3] = [99];
  const r = rekeyBuild(before, line([30], [40]), build);
  assert.deepEqual(r.columns[1], [99], 'attacker 40 fell from column 3 to column 1');
  assert.deepEqual(r.dropped, []);
});

test('rekeyBuild: a collapse under one blocked column while another survives', () => {
  // the mixed case: one of my two answered columns dies, the other does not.
  // The survivor keeps its work; only the orphan comes loose.
  const before = line([10], [20], [30]);
  const build: (readonly number[] | undefined)[] = [[97], [98], [99]];
  const r = rekeyBuild(before, line([10], [30]), build);
  assert.deepEqual(r.columns[0], [97], 'attacker 10 never moved');
  assert.deepEqual(r.columns[1], [99], 'attacker 30 slid left and took its blocker');
  assert.deepEqual(r.dropped, [98], 'only the blocker with nothing to answer is freed');
  assert.equal(r.changed, true);
});

test('rekeyBuild: the whole line dying frees everything and keys nothing', () => {
  const before = line([10], [20]);
  const build: (readonly number[] | undefined)[] = [[98], [99]];
  const r = rekeyBuild(before, [], build);
  assert.deepEqual(r.dropped, [98, 99]);
  assert.deepEqual(r.columns, []);
  assert.equal(r.changed, true);
});

test('rekeyBuild: the result is a copy — the preview is not aliased into it', () => {
  const before = line([10]);
  const mine = [[98]];
  const r = rekeyBuild(before, line([77], [10]), mine);
  mine[0]!.push(97);
  assert.deepEqual(r.columns[1], [98], 'what was re-keyed is what was re-keyed');
});

test('rekeyBuild: it feeds publishCols without flattening the holes back out', () => {
  // the two halves have to agree: a re-key that produced a dense array would
  // undo publishCols and put the opponent's view back under the wrong columns
  const before = line([10], [20], [30]);
  const build: (readonly number[] | undefined)[] = [];
  build[2] = [99];
  const r = rekeyBuild(before, line([20], [30]), build);
  assert.deepEqual(publishCols(r.columns), [[], [99]],
    'lane 0 is published empty, not dropped, so 99 stays under attacker 30');
});
