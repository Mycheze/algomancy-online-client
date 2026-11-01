/* WEEKLY CHALLENGES — re-scored runs (owner, 2026-11-01: debt owed at the
 * goal costs the turns paying it off).
 *
 * runs.jsonl is append-only and a stamp is never recomputed, so a run scored
 * before the rule is re-scored through rescores.jsonl (challenge-rescore.ts),
 * which the store lays over the stamp at load.
 *
 *   §1 ⭐ a re-score replaces the stamp everywhere: the board, the rank, the
 *      player's best, the run itself (Watch) — and runs.jsonl is not touched
 *   §2 the last line for a run wins; a line for an unknown run or a broken
 *      line is skipped, not fatal
 *   §3 ⭐ a frozen week dropped by --refreeze refreezes from the new scores
 *   §4 the tool leaves a run without debt alone, and is a dry run unless told
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { skillOf, type ChallengeDef, type RunScore } from '../../engine/src/challenge.ts';
import { register, useAccountsFile } from '../accounts.ts';
import { weekWindow } from '../challenges.ts';
import {
  appendRun, board, bestOf, frozenWeek, loadChallengeStore, runById, sweepChallenges, useChallengeDir,
} from '../challenge-store.ts';
import { rescore } from '../challenge-rescore.ts';

const root = mkdtempSync(join(tmpdir(), 'challenge-rescore-'));
const restoreAccounts = useAccountsFile(join(root, 'accounts.json'));
let dir = join(root, 'c0');
let restoreDir = useChallengeDir(dir);
test.after(() => { restoreDir(); restoreAccounts(); rmSync(root, { recursive: true, force: true }); });

const A: ChallengeDef = { id: 'test-a', week: '2026-10-25', title: 'A', blurb: 'a', goal: { kind: 'unitsPlayed', n: 1 }, seed: 1, par: 100 };
const HOUR = 3_600_000;
const aw = weekWindow(A);

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

function score(cards: number, elements: number, turns: number, debt?: { debt: number; debtTurns: number }): RunScore {
  const t = turns + (debt?.debtTurns ?? 0);
  const raw = cards * Math.max(1, elements) * t;
  return { unique: cards, extra: 0, cards, elements, turns: t, raw, skill: skillOf(100, raw), ...(debt ?? {}) };
}

const run = (name: string, s: RunScore, at: number): string => appendRun({
  challengeId: A.id, user: user(name), name, at, deck: ['Some Card'], score: s, engine: 'test', actions: [],
}).runId;

function fresh(sub: string): void {
  restoreDir();
  dir = join(root, sub);
  restoreDir = useChallengeDir(dir);
}

const rescoreLine = (runId: string, s: RunScore): string => `${JSON.stringify({ runId, rule: 'debt-2026-11-01', score: s })}\n`;

test('§1 a re-score replaces the stamp on the board, the best, and the run', () => {
  fresh('c1');
  const borrowed = run('Kay', score(8, 3, 2), aw.opens + HOUR);
  run('Tom', score(4, 2, 3), aw.opens + 2 * HOUR);
  assert.equal(board(A, aw.opens + 3 * HOUR).boards.fastest[0]!.name, 'Kay', 'before: the 2-turn run leads');
  const runs = readFileSync(join(dir, 'runs.jsonl'), 'utf8');
  appendFileSync(join(dir, 'rescores.jsonl'), rescoreLine(borrowed, score(8, 3, 2, { debt: 38, debtTurns: 5 })));
  loadChallengeStore();
  const b = board(A, aw.opens + 3 * HOUR);
  assert.deepEqual(b.boards.fastest.map(r => `${r.name} ${r.score.turns}`), ['Tom 3', 'Kay 7']);
  assert.equal(b.boards.fastest[1]!.score.debtTurns, 5);
  assert.equal(bestOf(A.id, user('Kay'))!.fastest.score.turns, 7);
  assert.equal(bestOf(A.id, user('Kay'))!.fastest.rank, 2);
  assert.equal(runById(borrowed)!.score.turns, 7, 'Watch reads the score in force');
  assert.equal(readFileSync(join(dir, 'runs.jsonl'), 'utf8'), runs, 'runs.jsonl is never rewritten');
});

test('§2 the last line wins; an unknown run or a broken line is skipped', () => {
  fresh('c2');
  const r = run('Kay', score(8, 3, 2), aw.opens + HOUR);
  writeFileSync(join(dir, 'rescores.jsonl'),
    rescoreLine(r, score(8, 3, 2, { debt: 4, debtTurns: 1 }))
    + 'not json\n'
    + rescoreLine('nobody', score(1, 1, 1))
    + rescoreLine(r, score(8, 3, 2, { debt: 38, debtTurns: 5 })));
  loadChallengeStore();
  assert.equal(runById(r)!.score.turns, 7);
});

test('§3 a dropped frozen week refreezes from the new scores', () => {
  fresh('c3');
  const borrowed = run('Kay', score(8, 3, 2), aw.opens + HOUR);
  run('Tom', score(5, 5, 3), aw.opens + 2 * HOUR);
  sweepChallenges(aw.closes + HOUR, [A]);
  assert.equal(frozenWeek(A.id)!.boards.fastest[0]!.name, 'Kay');
  // what challenge-rescore.ts --write --refreeze does to the files
  appendFileSync(join(dir, 'rescores.jsonl'), rescoreLine(borrowed, score(8, 3, 2, { debt: 38, debtTurns: 5 })));
  const weeks = JSON.parse(readFileSync(join(dir, 'weeks.json'), 'utf8'));
  delete weeks.weeks[A.id];
  writeFileSync(join(dir, 'weeks.json'), JSON.stringify(weeks));
  loadChallengeStore();
  const b = board(A, aw.closes + 2 * HOUR);
  assert.equal(b.winners!.fastest!.name, 'Tom', 'the refrozen winner is the honest 3-turn run');
  assert.equal(frozenWeek(A.id)!.boards.fastest[1]!.score.turns, 7);
});

test('§4 the tool: a run with no debt is unchanged, and nothing is written without --write', () => {
  fresh('c4');
  // a stamp that already carries debtTurns is on the new rule: skipped unread
  run('Kay', score(4, 2, 3, { debt: 0, debtTurns: 0 }), aw.opens + HOUR);
  const r = rescore(dir, { refreeze: true });
  assert.equal(r.skipped, 1);
  assert.equal(r.rescored.length, 0);
  assert.throws(() => readFileSync(join(dir, 'rescores.jsonl')), 'a dry run writes nothing');
});
