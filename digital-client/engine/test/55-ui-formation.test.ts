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
import { halfRows, MAX_ROWS, publishCols } from '../ui/formation.ts';

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
