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
 *
 * …and one owner request, BL-19 (2026-08-24), two words long:
 *  · "reset blocks" — hasBuild / clearBuild
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Build } from '../ui/formation.ts';
import {
  clearBuild, dropIntoRow, halfRows, hasBuild, MAX_ROWS, publishCols, rekeyBuild,
} from '../ui/formation.ts';

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

// ── hasBuild / clearBuild (BL-19: "reset blocks") ─────────────────────
//
// The owner's whole request was two words — *"reset blocks"* — and the
// expansion is that un-assigning a block line one column at a time is the
// same chore on an attack formation and on a counterattack send, so one
// control clears all three.
//
// The interesting half is not the emptying, it is what the emptying must NOT
// do. `columns` is sparse and the index is the meaning (publishCols, above);
// compacting it once already slid blockers onto the wrong attackers. A reset
// is safe exactly because `[]` has no indices left to get wrong — and these
// tests are here so that stays true if somebody tidies later.

/** a build in the shape ui/main.ts keeps, so these are the real arguments */
const build = (over: Partial<Build> = {}): Build => ({ ...clearBuild(), ...over });

test('clearBuild: every kind of assignment goes at once', () => {
  // blocks (sparse), a counterattack send, ride-along spell tokens and a unit
  // still in hand — one click, and none of them survive it
  const started = build({ send: [41, 42], spellTokens: [7], carrying: 9 });
  started.columns[3] = [98, 99];
  assert.equal(hasBuild(started), true, 'the premise: there is something to clear');
  const after = clearBuild();
  assert.deepEqual(after.columns, [], 'no blockers and no attack columns');
  assert.deepEqual(after.send, [], 'and no counterattackers');
  assert.deepEqual(after.spellTokens, [], 'and no tokens riding along');
  assert.equal(after.carrying, null, 'and nothing left in hand');
  assert.equal(after.rideAnswered, false, '[69] a cleared formation asks the ride question again');
  assert.equal(hasBuild(after), false, 'nothing is built any more');
});

test('clearBuild: the SPARSE index survives a clear — column 3 still means column 3', () => {
  // the trap. If a clear compacted (or a re-assignment landed on a normalised
  // array), the blocker put back on attacker 3 would answer attacker 0 —
  // which is the exact bug publishCols was written to end.
  // assign to attacker 3, clear, assign to attacker 3 again
  const first = clearBuild();
  first.columns[3] = dropIntoRow(first.columns[3] ?? [], 0, 99);
  assert.deepEqual(publishCols(first.columns), [[], [], [], [99]], 'the premise');
  const again = clearBuild();
  again.columns[3] = dropIntoRow(again.columns[3] ?? [], 0, 99);
  assert.deepEqual(publishCols(again.columns), [[], [], [], [99]],
    'still attacker 3 after the reset — not attacker 0');
  assert.equal(again.columns[0], undefined, 'lanes 0-2 are holes, not blockers');
  assert.equal(again.columns.length, 4, 'the array reaches lane 3 and stops');
});

test('clearBuild: what gets republished is an EMPTY formation', () => {
  // the opponent is watching this build live. Clearing locally and NOT
  // publishing the empty result leaves a formation on their screen that has
  // already been thrown away — publishCols of a cleared build is the payload
  // that takes it off.
  const before: (readonly number[] | undefined)[] = [];
  before[1] = [52]; before[5] = [60];
  assert.deepEqual(publishCols(before), [[], [52], [], [], [], [60]], 'the premise: they can see it');
  assert.deepEqual(publishCols(clearBuild().columns), [],
    'and after a clear there is nothing left to show them');
});

test('clearBuild: a fresh object every call — two clears cannot alias one array', () => {
  const a = clearBuild(), c = clearBuild();
  a.columns.push([1]); a.send.push(2); a.spellTokens.push(3);
  assert.deepEqual(c.columns, [], 'the second clear is not the first one');
  assert.deepEqual(c.send, []);
  assert.deepEqual(c.spellTokens, []);
});

test('hasBuild: any one kind of assignment on its own counts', () => {
  // each bar used to ask this question its own way and get its own answer:
  // the attack bar forgot `send`, the block bar forgot `spellTokens`, so a
  // player holding only that one thing was offered no Clear at all
  const sparse = build();
  sparse.columns[4] = [99];
  assert.equal(hasBuild(sparse), true, 'a blocker on attacker 4 and nothing else');
  assert.equal(hasBuild(build({ columns: [[1]] })), true, 'an attack column');
  assert.equal(hasBuild(build({ send: [1] })), true, 'a counterattacker sent back');
  assert.equal(hasBuild(build({ spellTokens: [1] })), true, 'a spell token riding along');
});

test('hasBuild: empty lanes are not assignments, and a carried unit is not one either', () => {
  assert.equal(hasBuild(build()), false, 'a brand new build');
  assert.equal(hasBuild(build({ columns: [[], [], []] })), false,
    'three columns with nobody in them is still nothing built');
  const holed = build();
  holed.columns[3] = [];
  assert.equal(hasBuild(holed), false, 'and a hole reads as empty, not as a crash');
  assert.equal(hasBuild(build({ carrying: 9 })), false,
    'a unit in hand has not been assigned to anything — Esc drops it by its own rule');
});

test('the three clear paths in ui/main.ts all go through resetFormation', () => {
  // main.ts takes the document at import time and cannot be loaded here, so
  // the wiring is read as text — the house pattern (74-ui-stack-mod-host, and
  // dropIntoRow above). Any one of these reverting to a hand-written copy of
  // the five assignments is how the three paths drifted apart in the first
  // place: Esc used to leave the block-refusal notice standing over a plan it
  // had just deleted.
  const MAIN = readFileSync(new URL('../ui/main.ts', import.meta.url), 'utf8');
  assert.match(MAIN, /clearform: \(\) => \{ resetFormation\(\); \}/,
    'the Clear button on the attack and block bars');
  assert.match(MAIN, /resetblocks: \(\) => \{ resetFormation\(\); \}/,
    'the [77] "Reset blockers?" button on a refusal notice');
  assert.match(MAIN, /if \(hasBuild\(ui\)\) \{ resetFormation\(\); render\(\); return; \}/,
    'and Esc, which must clear AND repaint — the repaint is the republish');
  const fn = MAIN.slice(MAIN.indexOf('function resetFormation('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /const fresh = clearBuild\(\);/,
    'and what "empty" means lives in ui/formation.ts, not inline here');
  for (const field of ['columns', 'send', 'spellTokens', 'carrying', 'rideAnswered']) {
    assert.match(body, new RegExp(`ui\\.${field} = fresh\\.${field};`), `${field} is reset`);
  }
  assert.doesNotMatch(body, /NET|sendBuilding|\.do\(|act\(/,
    'a clear is LOCAL — it declares nothing and sends nothing by itself');
  // the Clear button is offered on both declarations, gated by the one predicate
  assert.equal((MAIN.match(/const built = hasBuild\(ui\);/g) ?? []).length, 2,
    'the attack bar and the block bar ask the same question');
  assert.equal((MAIN.match(/data-btn="clearform"/g) ?? []).length, 2,
    'and both of them actually draw the button');
});
