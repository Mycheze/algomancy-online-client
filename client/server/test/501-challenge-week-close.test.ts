/* WEEKLY CHALLENGES — the calendar and the week close (docs/21 "Storage").
 *
 * §1 the committed calendar is sound: Sundays, strictly increasing, unique ids
 *    — and the check catches each way a row can be wrong
 * §2 a week's window is Sunday 07:00 UTC to the next Sunday 07:00 UTC, and
 *    current/past read it
 * §3 ⭐ the sweep freezes a closed week once: the winner is the best Skill,
 *    a tie goes to the earlier run, and a reload of the store (a restart)
 *    followed by another sweep rewrites nothing
 * §4 ⭐ a run sent to a closed week is ranked on its board but cannot move
 *    the frozen winner — even when the sweep had not run yet when it arrived
 * §5 a server that was down across two closes catches both up in one sweep
 * §6 ⭐ ONE board, by Skill: each player's best run; one element or fewer
 *    cards are both just ways to a raw, and an equal raw goes to the earlier
 *    run; a category asked for is not a thing; the frozen top is ten rows
 *
 * The store is driven directly with stamped scores — what is under test is
 * keeping and ranking, not verification (500 sends real runs over HTTP).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { skillOf, type ChallengeDef, type RunScore } from '../../engine/src/challenge.ts';
import { register, useAccountsFile } from '../accounts.ts';
import {
  CHALLENGES, WEEK_MS, calendarProblems, currentChallenge, pastChallenges, weekWindow,
} from '../challenges.ts';
import {
  FROZEN_TOP, appendRun, board, frozenWeek, loadChallengeStore, sweepChallenges, useChallengeDir,
} from '../challenge-store.ts';

const root = mkdtempSync(join(tmpdir(), 'challenge-close-'));
const restoreAccounts = useAccountsFile(join(root, 'accounts.json'));
let restoreDir = useChallengeDir(join(root, 'c0'));
test.after(() => { restoreDir(); restoreAccounts(); rmSync(root, { recursive: true, force: true }); });

const A: ChallengeDef = { id: 'test-a', week: '2026-10-25', title: 'A', blurb: 'a', goal: { kind: 'unitsPlayed', n: 1 }, seed: 1, par: 100 };
const B: ChallengeDef = { id: 'test-b', week: '2026-11-01', title: 'B', blurb: 'b', goal: { kind: 'unitsPlayed', n: 1 }, seed: 2, par: 100 };
const ROWS = [A, B];
const HOUR = 3_600_000;
const aw = weekWindow(A), bw = weekWindow(B);

const ids = new Map<string, string>();
function user(name: string): string {
  let id = ids.get(name);
  if (!id) {
    const r = register(name, 'correct horse battery');
    assert.ok(r.ok, `register ${name}`);
    id = r.account.id;
    ids.set(name, id);
  }
  return id;
}

/** a stamped score, the way docs/21 defines it, against A's and B's par of 100 */
function score(unique: number, extra: number, elements: number, turns: number): RunScore {
  const cards = unique + extra;
  const raw = cards * Math.max(1, elements) * turns;
  return { unique, extra, cards, elements, turns, raw, skill: skillOf(100, raw) };
}

function run(def: ChallengeDef, name: string, s: RunScore, at: number): string {
  return appendRun({
    challengeId: def.id, user: user(name), name, at, deck: ['Some Card'], score: s, engine: 'test', actions: [],
  }).runId;
}

function fresh(sub: string): void {
  restoreDir();
  restoreDir = useChallengeDir(join(root, sub));
}

test('challenge close §1 the calendar is sound, and the check catches each fault', () => {
  assert.deepEqual(calendarProblems(), [], 'the committed calendar has a problem');
  assert.ok(CHALLENGES.length >= 5);
  for (const c of CHALLENGES) assert.equal(new Date(weekWindow(c).opens).getUTCDay(), 0, `${c.id} does not open on a Sunday`);

  const ok = CHALLENGES[0]!;
  const bad = (rows: ChallengeDef[], re: RegExp): void => {
    const p = calendarProblems(rows);
    assert.ok(p.some(x => re.test(x)), `expected ${re} in ${JSON.stringify(p)}`);
  };
  bad([ok, { ...ok }], /duplicate id/);
  bad([{ ...ok, week: '2026-10-26' }], /not a Sunday/);
  bad([{ ...ok, week: '2026-02-30' }], /not a date/);
  bad([ok, { ...ok, id: 'later', week: ok.week }], /does not come after/);
  bad([{ ...ok, id: 'later', week: '2026-11-01' }, { ...ok, id: 'earlier' }], /does not come after/);
  bad([{ ...ok, id: 'Bad Id' }], /id must be/);
  bad([{ ...ok, seed: 1.5 }], /seed/);
  bad([{ ...ok, par: 0 }], /par/);
  bad([{ ...ok, par: 12.5 }], /par/);
});

test('challenge close §2 a week runs Sunday 07:00 UTC to Sunday 07:00 UTC', () => {
  assert.equal(new Date(aw.opens).toISOString(), '2026-10-25T07:00:00.000Z');
  assert.equal(aw.closes - aw.opens, WEEK_MS);
  assert.equal(currentChallenge(aw.opens - 1, ROWS), null, 'before the first row');
  assert.equal(currentChallenge(aw.opens, ROWS)?.id, 'test-a');
  assert.equal(currentChallenge(aw.closes - 1, ROWS)?.id, 'test-a');
  assert.equal(currentChallenge(aw.closes, ROWS)?.id, 'test-b', 'the close of one week is the open of the next');
  assert.deepEqual(pastChallenges(aw.closes, ROWS).map(c => c.id), ['test-a']);
  assert.deepEqual(pastChallenges(bw.closes, ROWS).map(c => c.id), ['test-b', 'test-a'], 'newest first');
  assert.equal(currentChallenge(bw.closes, ROWS), null, 'after the last row');
});

test('challenge close §3 the sweep freezes once, and a restart changes nothing', () => {
  fresh('c3');
  run(A, 'Alice', score(5, 0, 2, 10), aw.opens + 1 * HOUR);   // raw 100, Skill 100
  run(A, 'Bob', score(4, 0, 2, 10), aw.opens + 2 * HOUR);     // raw 80, Skill 125
  run(A, 'Carol', score(2, 0, 4, 10), aw.opens + 3 * HOUR);   // raw 80, Skill 125, later
  assert.deepEqual(sweepChallenges(aw.closes - 1, ROWS), [], 'nothing has closed yet');
  assert.equal(frozenWeek('test-a'), null);

  assert.deepEqual(sweepChallenges(aw.closes, ROWS), ['test-a'], 'week A closes; B is still open');
  const w = frozenWeek('test-a')!;
  assert.equal(w.closedAt, aw.closes);
  assert.equal(w.winner?.name, 'Bob', 'the best Skill wins, and the tie goes to the earlier run');
  assert.equal(w.winner?.score.skill, 125);
  assert.deepEqual(w.top.map(r => r.name), ['Bob', 'Carol', 'Alice']);
  const file = join(root, 'c3', 'weeks.json');
  const bytes = readFileSync(file, 'utf8');

  loadChallengeStore();
  assert.deepEqual(sweepChallenges(aw.closes + 5 * HOUR, ROWS), [], 'a frozen week is never frozen again');
  assert.equal(readFileSync(file, 'utf8'), bytes, 'weeks.json is untouched by a second sweep after a reload');
  assert.equal(frozenWeek('test-a')?.winner?.name, 'Bob', 'the frozen winner survives the reload');
});

test('challenge close §4 a late run is ranked but cannot move the frozen winner', () => {
  fresh('c4');
  run(A, 'Alice', score(5, 0, 2, 10), aw.opens + HOUR);
  // the week closes, and before the sweep's next tick a far better run arrives
  const late = run(A, 'Dave', score(1, 0, 1, 1), aw.closes + 1000);
  const b = board(A, aw.closes + 2000);
  assert.equal(b.closed, true);
  assert.equal(b.rows[0]?.name, 'Dave', 'the late run is ranked on the board');
  assert.equal(b.rows[0]?.runId, late, 'a closed board shows run ids');
  assert.deepEqual(b.rows[0]?.deck, ['Some Card'], '…and decks');
  assert.equal(b.winner?.name, 'Alice', 'the winner counts only runs from before the close');
  assert.equal('user' in (b.winner ?? {}), false, 'a frozen row goes out without its account id');

  run(A, 'Erin', score(1, 0, 1, 1), aw.closes + 3 * HOUR);
  assert.deepEqual(sweepChallenges(aw.closes + 4 * HOUR, [A]), []);
  assert.equal(board(A, aw.closes + 4 * HOUR).winner?.name, 'Alice');

  const open = board(B, bw.opens + HOUR);
  assert.equal(open.closed, false);
  assert.equal(open.winner, undefined, 'an open week has no winner');
});

test('challenge close §5 a sweep after downtime catches up on every missed week', () => {
  fresh('c5');
  run(A, 'Alice', score(5, 0, 2, 10), aw.opens + HOUR);
  run(B, 'Bob', score(5, 0, 2, 10), bw.opens + HOUR);
  assert.deepEqual(sweepChallenges(bw.closes + 3 * WEEK_MS, ROWS).sort(), ['test-a', 'test-b']);
  assert.equal(frozenWeek('test-a')?.winner?.name, 'Alice');
  assert.equal(frozenWeek('test-b')?.winner?.name, 'Bob');
  assert.equal(frozenWeek('test-b')?.closedAt, bw.closes, 'closedAt is the boundary, not the late sweep');
});

test('challenge close §6 one board by Skill: each best, either way to it, top ten frozen', () => {
  fresh('c6');
  // Alice: one cheap long run, one expensive short run — she is ranked by the cheaper
  run(A, 'Alice', score(2, 0, 1, 20), aw.opens + HOUR);       // raw 40, Skill 250
  run(A, 'Alice', score(10, 0, 3, 3), aw.opens + 2 * HOUR);   // raw 90, Skill 111
  run(A, 'Bob', score(3, 0, 1, 3), aw.opens + 3 * HOUR);      // raw 9, Skill 1111
  // the owner's point: one element, or fewer cards — the same raw is the same rank
  run(A, 'Carol', score(6, 0, 1, 5), aw.opens + 4 * HOUR);    // 6 cards · 1 element: raw 30
  run(A, 'Dave', score(3, 0, 2, 5), aw.opens + 5 * HOUR);     // 3 cards · 2 elements: raw 30, later
  const b = board(A, aw.opens + 6 * HOUR);
  assert.deepEqual(b.rows.map(r => [r.rank, r.name, r.score.skill]),
    [[1, 'Bob', 1111], [2, 'Carol', 333], [3, 'Dave', 333], [4, 'Alice', 250]]);
  assert.equal('by' in b, false, 'there are no categories');
  assert.equal(b.rows[0]?.runId, undefined, 'an open board shows no run ids');
  assert.equal(b.rows[0]?.deck, undefined, '…and no decks');

  for (let i = 0; i < 12; i++) run(A, `Many${i}`, score(50 + i, 0, 1, 1), aw.opens + (7 + i) * HOUR);
  sweepChallenges(aw.closes, [A]);
  const w = frozenWeek('test-a')!;
  assert.equal(w.top.length, FROZEN_TOP, 'ten rows frozen');
  assert.equal(w.winner?.name, 'Bob');
});
