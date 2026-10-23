/* Report round 2026-10-23 — /api/report KEEPS THE RUN A SOLO-ROOM REPORT
 * CARRIES, and leaves the journal's rows the shape they were.
 *
 * A Weekly Challenge run and a Learn to Play game have no room on the server;
 * since this round the report form sends the game itself (ui/report.ts,
 * test 592). The server's half (report-run.ts):
 *
 *   §1 the sanitizer: a real challenge run and a Learn to Play game are kept,
 *      rebuilt from their fields; junk, an index past the log, a foreign
 *      goal, an oversize run are refused with a reason
 *   §2 over the wire: the run lands in report-runs.jsonl BESIDE the journal,
 *      keyed by the row's `ts`; the issues row carries only a small pointer —
 *      no action log, still one short line, every older field as before — and
 *      the admin page's reader still parses it
 *   §3 a refused run never costs the note: the row is written, saying why
 *   §4 a report with no run is the row it always was, and writes no run
 *   §5 the default path is the one `npm run reports` fetches (paths.mjs)
 *
 * Seeds 59300-59399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import '../../engine/src/cards/registry.ts';
import { REPORT_RUNS_JSONL } from '../../engine/scripts/paths.mjs';
import { CHALLENGES, REFERENCE_RUNS_DIR } from '../challenges.ts';
import { MAX_RUN_BYTES, parseReportRuns, pointerOf, sanitizeReportRun } from '../report-run.ts';
import { reportRunsFile } from '../statepaths.ts';
import type { IssueRow } from '../report-fields.ts';
import { spawnServer } from '../e2e/test-util.ts';

const DIR = mkdtempSync(join(tmpdir(), 'algo-593-'));
const ISSUES = join(DIR, 'issues.jsonl');
const RUNS = join(DIR, 'report-runs.jsonl');
test.after(() => rmSync(DIR, { recursive: true, force: true }));

const DEF = CHALLENGES[0]!;
const REF = JSON.parse(readFileSync(join(REFERENCE_RUNS_DIR, `${DEF.id}.json`), 'utf8')) as { deck: string[]; actions: Record<string, unknown>[] };
/** a challenge run as the browser sends it (ui/challengerun.ts reportAttachment) */
const challengeRun = (at = 40): Record<string, unknown> => ({
  kind: 'challenge',
  def: { id: DEF.id, week: DEF.week, title: DEF.title, goal: DEF.goal, seed: DEF.seed, par: DEF.par },
  deck: REF.deck, actions: REF.actions, at,
});
const learnRun = (): Record<string, unknown> => ({
  kind: 'learn',
  deal: {
    seed: 59300, names: ['Lea', 'Tutorial Bot'],
    decks: [Array(40).fill('Training Construct'), Array(40).fill('Training Construct')],
    lesson: { openingHand: [0, 1], drawPerTurn: [2, 1], stacked: [true, false], shardsPerTurn: [0, 1], firstShardTurn: 1, shardState: 'open', prismites: [2, 0], startingLife: [30, 30], initiative: 0 },
  },
  actions: [{ type: 'donePlanning', seat: 1 }], at: 1,
});

test('CR D8.1 / report 271 §1 the sanitizer keeps a real run and refuses junk with a reason', () => {
  const c = sanitizeReportRun(challengeRun());
  assert.ok(c.ok, c.ok ? '' : c.why);
  assert.equal(c.run.kind, 'challenge');
  assert.equal(c.run.actions.length, REF.actions.length, 'every action kept');
  assert.deepEqual(pointerOf(c.run), { kind: 'challenge', at: 40, challengeId: DEF.id });
  const l = sanitizeReportRun(learnRun());
  assert.ok(l.ok, l.ok ? '' : l.why);
  assert.deepEqual(pointerOf(l.run), { kind: 'learn', at: 1 });
  // rebuilt, never the object as sent
  const extra = sanitizeReportRun({ ...challengeRun(), evil: 'x'.repeat(100), def: { ...(challengeRun()['def'] as object), blurb: 'y'.repeat(5000) } });
  assert.ok(extra.ok);
  assert.ok(!JSON.stringify(extra.run).includes('xxxx') && !JSON.stringify(extra.run).includes('yyyy'), 'unknown fields are not kept');

  const refused: [string, unknown][] = [
    ['not an object', 'a string'],
    ['no actions', { ...challengeRun(), actions: 'nope' }],
    ['an action with no seat', { ...challengeRun(), actions: [{ type: 'passPriority' }], at: 1 }],
    ['an index past the log', { ...challengeRun(), at: REF.actions.length + 1 }],
    ['a negative index', { ...challengeRun(), at: -1 }],
    ['a goal that is not one', { ...challengeRun(), def: { ...(challengeRun()['def'] as object), goal: { kind: 'win' } } }],
    ['an id with a slash', { ...challengeRun(), def: { ...(challengeRun()['def'] as object), id: '../x' } }],
    ['an empty deck', { ...challengeRun(), deck: [] }],
    ['a deck of numbers', { ...challengeRun(), deck: [1, 2] }],
    ['a deal with three names', { ...learnRun(), deal: { ...(learnRun()['deal'] as object), names: ['a', 'b', 'c'] } }],
    ['an unknown kind', { ...challengeRun(), kind: 'draft' }],
    ['oversize', { ...challengeRun(), deck: REF.deck, pad: 'z'.repeat(MAX_RUN_BYTES) }],
  ];
  for (const [what, v] of refused) {
    const r = sanitizeReportRun(v);
    assert.equal(r.ok, false, `${what} is refused`);
    assert.ok(!r.ok && r.why.length > 0 && r.why.length < 80, `${what}: a short reason`);
  }
});

test('CR D8.1 / report 271 §2-§4 over the wire: the run beside the journal, a pointer on the row', async () => {
  const server = await spawnServer({ ALGO_ISSUES_FILE: ISSUES, ALGO_GAMES_DIR: join(DIR, 'games'), ALGO_ACCOUNTS_FILE: join(DIR, 'accounts.json') });
  const post = async (body: unknown): Promise<number> => {
    const res = await fetch(`http://localhost:${server.port}/api/report`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    await res.json();
    return res.status;
  };
  const rows = (): IssueRow[] => readFileSync(ISSUES, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as IssueRow);
  try {
    // §2
    assert.equal(await post({ room: '', seat: null, page: 'challenge', note: 'the meter stopped', kind: 'bug', severity: 'medium', solo: challengeRun() }), 200);
    let all = rows();
    assert.equal(all.length, 1);
    const r = all[0]!;
    assert.deepEqual(r.solo, { kind: 'challenge', at: 40, challengeId: DEF.id }, 'the row points at the run');
    assert.equal(r.note, 'the meter stopped');
    assert.equal(r.page, 'challenge');
    assert.equal(r.room, '');
    assert.equal(r.actionIndex, null, 'actionIndex keeps its meaning: a SERVER room count');
    assert.equal(r.kind, 'bug');
    assert.equal(r.severity, 'medium');
    const line = readFileSync(ISSUES, 'utf8').split('\n')[0]!;
    assert.ok(line.length < 1000, `the row stays a short line (${line.length} chars) — the run is not in it`);
    assert.ok(!line.includes('"actions"'), 'no action log on the row');
    assert.ok(existsSync(RUNS), 'report-runs.jsonl beside issues.jsonl');
    const runs = parseReportRuns(readFileSync(RUNS, 'utf8'));
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.ts, r.ts, 'keyed by the row ts');
    assert.equal(runs[0]!.run.kind, 'challenge');
    assert.deepEqual(runs[0]!.run.actions, REF.actions, 'the whole log');
    assert.equal(runs[0]!.run.at, 40);

    assert.equal(await post({ room: '', seat: null, page: 'learn', note: 'bot froze', kind: 'bug', severity: 'minor', solo: learnRun() }), 200);
    assert.deepEqual(rows()[1]!.solo, { kind: 'learn', at: 1 });
    assert.equal(parseReportRuns(readFileSync(RUNS, 'utf8')).length, 2);

    // §3
    assert.equal(await post({ room: '', seat: null, page: 'challenge', note: 'junk run', kind: 'bug', severity: 'minor', solo: { kind: 'challenge', actions: 5 } }), 200,
      'a bad run is never a refusal of the report');
    all = rows();
    assert.equal(all.length, 3, 'the note is logged');
    assert.equal(all[2]!.note, 'junk run');
    assert.ok(all[2]!.solo && 'refused' in all[2]!.solo, 'and the row says the run was refused');
    assert.equal(parseReportRuns(readFileSync(RUNS, 'utf8')).length, 2, 'nothing written for a refused run');

    // §4
    assert.equal(await post({ room: '', seat: null, page: 'deck', note: 'plain', kind: 'ux', severity: 'minor' }), 200);
    all = rows();
    assert.ok(!('solo' in all[3]!), 'no solo key on an ordinary report');
    assert.equal(parseReportRuns(readFileSync(RUNS, 'utf8')).length, 2, 'and no run line');
  } finally {
    await server.stop();
  }

  // the admin page's reader parses the new rows as it did the old
  process.env['ALGO_ISSUES_FILE'] = ISSUES;
  const { reportRows } = await import('../admin.ts');
  const parsed = reportRows();
  assert.equal(parsed.length, 4, 'the admin page reads every row');
  assert.ok(parsed.some(p => p.solo && 'kind' in p.solo && p.solo.kind === 'challenge'), 'and carries the pointer through');
});

test('CR D8.1 / report 271 §5 the runs file sits beside the journal, at the path the fetch reads', () => {
  const saved = { i: process.env['ALGO_ISSUES_FILE'], r: process.env['ALGO_REPORT_RUNS_FILE'] };
  try {
    delete process.env['ALGO_REPORT_RUNS_FILE'];
    process.env['ALGO_ISSUES_FILE'] = ISSUES;
    assert.equal(reportRunsFile(), RUNS, 'an override of the journal takes the runs with it (tests, npm run dev, the prod mirror)');
    delete process.env['ALGO_ISSUES_FILE'];
    assert.equal(resolve(reportRunsFile()), resolve(REPORT_RUNS_JSONL),
      'server/statepaths.ts and engine/scripts/paths.mjs agree, so `npm run reports` fetches the file the server writes');
    assert.equal(dirname(reportRunsFile()).endsWith('var'), true);
  } finally {
    if (saved.i !== undefined) process.env['ALGO_ISSUES_FILE'] = saved.i; else delete process.env['ALGO_ISSUES_FILE'];
    if (saved.r !== undefined) process.env['ALGO_REPORT_RUNS_FILE'] = saved.r;
  }
});
