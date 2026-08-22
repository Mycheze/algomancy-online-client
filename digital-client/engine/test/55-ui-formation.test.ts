/* ui/formation.ts — the battle panel's column arithmetic. Seeds not needed:
 * these are pure functions over formation shapes.
 *
 * Both behaviours are playtest DEYK reports (2026-08-20, room DEYK):
 *  · "the blocks that show that my opponent are doing are wrong on my screen…
 *    it fixed itself when blocks were declared" — publishCols
 *  · "you can see the whole column, including the back row (which might be
 *    totally empty)… all the needed slots should be shown when there's a
 *    choice to be made" — halfRows
 *
 * …and one more from the same room, backfilled 2026-08-22 because the fix
 * shipped in ui/main.ts with nothing at all asserting it:
 *  · "Sometimes the system wants you to block in a specific order. I was
 *    forced to do creature B as a blocker before creature A despite it being
 *    pointless" — dropIntoRow
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dropIntoRow, halfRows, MAX_ROWS, publishCols, rekeyBuild } from '../ui/formation.ts';

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

// ── dropIntoRow (playtest BRDM: the forced block order) ───────────────

/* The report is about ORDER, and the column has only two places in it: the
 * front row takes the damage and the back row does not. The old builder
 * offered one open slot at a time and appended into it, so the front row was
 * always whoever you clicked first — wanting A in front and B behind meant
 * clicking A first, and changing your mind meant taking the column apart.
 *
 * These are the four things that has to mean. The main.ts side of it (both
 * rows always drawn, `data-row` on the slot, the carried unit routed through
 * here) is read as text at the bottom, and is also a ledger row in
 * 75-ui-reachability. */

test('dropIntoRow: the row you click is the row you get', () => {
  assert.deepEqual(dropIntoRow([], 0, 7), [7], 'front of an empty column');
  assert.deepEqual(dropIntoRow([], 1, 7), [7],
    'and the back row of an EMPTY column is still the front — nobody floats');
  assert.deepEqual(dropIntoRow([5], 1, 7), [5, 7], 'behind the unit already standing there');
});

test('dropIntoRow: dropping into an occupied FRONT row pushes the sitting unit back', () => {
  // this is the whole report. Without it, putting A in front of a column B is
  // already in means removing B first — the "specific order" that was forced.
  assert.deepEqual(dropIntoRow([5], 0, 7), [7, 5]);
});

test('dropIntoRow: a full column takes no third unit', () => {
  // MAX_ROWS is the game's own limit and apply() refuses a third — a client
  // that built one would only be building a declaration it cannot send
  assert.deepEqual(dropIntoRow([5, 6], 0, 7), [5, 6]);
  assert.deepEqual(dropIntoRow([5, 6], 1, 7), [5, 6]);
  assert.equal(MAX_ROWS, 2);
});

test('dropIntoRow: the caller keeps its own column, and a wild row is clamped', () => {
  const col = [5];
  const out = dropIntoRow(col, 0, 7);
  col.push(9);
  assert.deepEqual(out, [7, 5], 'the result is a copy, not the array that was passed in');
  assert.deepEqual(dropIntoRow([5], 99, 7), [5, 7], 'a row past the end lands at the end');
  assert.deepEqual(dropIntoRow([5], -3, 7), [7, 5], 'and one before the start lands at the front');
});

test('the block builder in ui/main.ts really routes its drop through dropIntoRow', () => {
  // main.ts takes the document at import time and cannot be loaded here, so
  // the three lines between this function and the page are read as text (the
  // house pattern — see 74-ui-stack-mod-host). Deleting any one of them puts
  // the forced order back with every test above still green.
  const MAIN = readFileSync(new URL('../ui/main.ts', import.meta.url), 'utf8');
  assert.match(MAIN, /ui\.columns\[ci\] = dropIntoRow\(ui\.columns\[ci\] \?\? \[\], row, ui\.carrying\);/,
    'the slot click must delegate the insert, not splice by hand');
  assert.match(MAIN, /const row = Number\(t\.dataset\['row'\]\) \|\| 0;/,
    'and it must read WHICH row was clicked — without this every drop is a front-row drop');
  assert.match(MAIN, /data-act="slot" data-ci="\$\{ci\}" data-row="\$\{row\}"/,
    'the slot has to carry its row');
  const cols = MAIN.slice(MAIN.indexOf('function colSlotsHtml('));
  const body = cols.slice(0, cols.indexOf('\n}\n'));
  assert.match(body, /slotHtml\(ci, 0,/, 'the front row is always drawn…');
  assert.match(body, /slotHtml\(ci, 1,/, '…and so is the back row, or there is nothing to click');
});
