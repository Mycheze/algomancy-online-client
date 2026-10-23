/* Report round 2026-10-23 — A REPORTED SOLO RUN COMES DOWN AND REPLAYS.
 *
 * The other two halves of "we can replay this exact moment" for a report
 * filed from a Weekly Challenge run or Learn to Play (592: the client sends
 * the run; 593: the server keeps it beside the journal):
 *
 *   §1 replay-report-run.ts rebuilds a challenge run to the reporter's index —
 *      the same board the engine reaches applying the log by hand — and the
 *      full run to the goal the server's verifier scores
 *   §2 the command line: a report's ts (or a unique prefix) out of the runs
 *      journal, the note out of the report journal, the log with action
 *      indices, and exit 0; `--at` moves the stop
 *   §3 a run this engine refuses says WHERE (exit 2), not a stack trace
 *   §4 a Learn to Play game replays from its own deal
 *   §5 `npm run reports` brings the runs file down beside the journal and
 *      names the replay command for each new report that has one — run end to
 *      end between two scratch directories (its test seam; no ssh)
 *
 * Seeds 59400-59499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../engine/src/cards/registry.ts';
import { apply, createGame, forcedAction, legalActions } from '../../engine/src/apply.ts';
import { DUMMY_DECK, challengeDeal, verifyRun } from '../../engine/src/challenge.ts';
import type { Action, GameState, Seat } from '../../engine/src/types.ts';
import { CHALLENGES, REFERENCE_RUNS_DIR } from '../challenges.ts';
import { replayRun, runLines, EXIT } from '../replay-report-run.ts';
import { sanitizeReportRun, type ChallengeReportRun, type LearnReportRun } from '../report-run.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = join(HERE, '..', 'replay-report-run.ts');
const FETCH = join(HERE, '..', '..', 'engine', 'scripts', 'fetch-reports.mjs');
const DIR = mkdtempSync(join(tmpdir(), 'algo-594-'));
test.after(() => rmSync(DIR, { recursive: true, force: true }));

const DEF = CHALLENGES[0]!;
const REF = JSON.parse(readFileSync(join(REFERENCE_RUNS_DIR, `${DEF.id}.json`), 'utf8')) as { deck: string[]; actions: Action[] };
const AT = 60;
const RUN: ChallengeReportRun = (() => {
  const r = sanitizeReportRun({
    kind: 'challenge', def: { id: DEF.id, week: DEF.week, title: DEF.title, goal: DEF.goal, seed: DEF.seed, par: DEF.par },
    deck: REF.deck, actions: REF.actions, at: AT,
  });
  assert.ok(r.ok && r.run.kind === 'challenge');
  return r.run;
})();
const TS = '2026-10-23T05:00:00.000Z';

/** the board the engine reaches applying the first n actions by hand */
function byHand(n: number): GameState {
  let s = createGame(DEF.seed, ['Challenger', 'Dummy'], 'constructed', undefined, [[...REF.deck], [...DUMMY_DECK]], undefined, challengeDeal(DEF)).state;
  for (let i = 0; i < n; i++) s = apply(s, REF.actions[i]!).state;
  return s;
}

test('CR D8.1 / report 271 §1 the replay rebuilds the reported board, and the whole run to its goal', () => {
  const r = replayRun(RUN);
  assert.equal(r.refused, null);
  assert.equal(r.at, AT, 'stopped where the reporter was');
  assert.equal(r.steps.length, AT);
  assert.deepEqual(r.state, byHand(AT), 'the board the engine reaches by hand at that index');
  assert.deepEqual(r.dummyDrift, [], 'every dummy move is the dummyMove of this engine');
  const full = replayRun(RUN, RUN.actions.length);
  const v = verifyRun(DEF, REF.deck, REF.actions);
  assert.ok(v.ok, 'fixture: the reference run verifies');
  assert.ok(full.acc?.met, 'the replay meets the goal at the end');
  assert.equal(full.at, v.actions.length, 'at the action the verifier cuts at');
});

test('CR D8.1 / report 271 §2 the command line: ts to log, with the note, exit 0', () => {
  const runs = join(DIR, 'report-runs.jsonl');
  const issues = join(DIR, 'issues.jsonl');
  writeFileSync(runs, JSON.stringify({ ts: '2026-10-22T01:00:00.000Z', run: RUN }) + '\n' + JSON.stringify({ ts: TS, run: RUN }) + '\n');
  writeFileSync(issues, JSON.stringify({ ts: TS, room: '', seat: null, note: 'Pack Leader did nothing', actionIndex: null, kind: 'bug', severity: 'medium', page: 'challenge', solo: { kind: 'challenge', at: AT, challengeId: DEF.id } }) + '\n');
  const out = spawnSync(process.execPath, [TOOL, '2026-10-23T05', '--runs', runs, '--issues', issues], { encoding: 'utf8' });
  assert.equal(out.status, EXIT.replayed, out.stderr);
  assert.match(out.stdout, /challenge run 2026-10-25-crowd "Full House"/);
  assert.match(out.stdout, /Pack Leader did nothing/, 'the note, out of the report journal');
  assert.match(out.stdout, /replaying to action 60 \(where the reporter was\)/);
  assert.match(out.stdout, /── game log ──[\s\S]*\n\[0\] [\s\S]*\n\[59\] /, 'the log, by action index, to the last action before the stop');
  assert.doesNotMatch(out.stdout, /\n\[60\] /, 'and no further');
  assert.match(out.stdout, /✓ all 60 actions replayed/);
  assert.match(out.stdout, /goal: Units in play \d+ \/ 60/);
  const at = spawnSync(process.execPath, [TOOL, TS, '--runs', runs, '--issues', issues, '--at', '12', '--quiet'], { encoding: 'utf8' });
  assert.equal(at.status, EXIT.replayed, at.stderr);
  assert.match(at.stdout, /replaying to action 12 \(the reporter was at 60\)/);
  assert.doesNotMatch(at.stdout, /── game log ──/, '--quiet: no log');
  const ambiguous = spawnSync(process.execPath, [TOOL, '2026-10-2', '--runs', runs], { encoding: 'utf8' });
  assert.equal(ambiguous.status, EXIT.usage, 'a prefix two runs share is refused');
  assert.match(ambiguous.stderr, /2 runs match/);
});

test('CR D8.1 / report 271 §3 a run this engine refuses says where', () => {
  const bad: ChallengeReportRun = { ...RUN, actions: RUN.actions.map((a, i) => (i === 20 ? { type: 'passPriority', seat: 0 } as Action : a)) };
  const r = runLines({ ts: TS, run: bad }, { quiet: true });
  assert.equal(r.exit, EXIT.refused);
  assert.match(r.lines.join('\n'), /⛔ action \[20\] \(passPriority, seat 0\) REFUSED/);
});

test('CR D8.1 / report 271 §4 a Learn to Play game replays from its own deal', () => {
  const deal: LearnReportRun['deal'] = {
    seed: 59400, names: ['Lea', 'Tutorial Bot'],
    decks: [Array(40).fill('Training Construct'), Array(40).fill('Training Construct')],
    lesson: { openingHand: [0, 1], drawPerTurn: [2, 1], stacked: [true, false], shardsPerTurn: [0, 1], firstShardTurn: 1, shardState: 'open', prismites: [2, 0], startingLife: [30, 30], initiative: 0 },
  };
  // a passive game, both seats, by the engine's own legal lists
  let s = createGame(deal.seed, deal.names, 'constructed', undefined, deal.decks, undefined, deal.lesson).state;
  const log: Action[] = [];
  const PASSIVE = ['passPriority', 'donePlanning', 'doneHaste', 'doneDeploying', 'declareAttack', 'declareBlocks'];
  for (let k = 0; k < 40 && s.phase !== 'gameover'; k++) {
    const f = forcedAction(s);
    const legal = f ? [f] : ([0, 1] as Seat[]).flatMap(seat => legalActions(s, seat)).filter(a => a.type !== 'concede');
    const a = legal.find(x => PASSIVE.includes(x.type)) ?? legal[0];
    if (!a) break;
    s = apply(s, a).state;
    log.push(a);
  }
  assert.ok(log.length > 10, 'fixture: a game with a log');
  const r = replayRun({ kind: 'learn', deal, actions: log, at: log.length });
  assert.equal(r.refused, null);
  assert.deepEqual(r.state, s, 'the board the log reached');
  assert.equal(runLines({ ts: '', run: { kind: 'learn', deal, actions: log, at: log.length } }, { quiet: true }).lines[0], `═ Learn to Play game · seed 59400 · Lea vs Tutorial Bot · ${log.length} actions logged`);
});

test('CR D8.1 / report 271 §5 npm run reports brings the runs down and names the replay', () => {
  const src = join(DIR, 'box');      // laid out like the deploy box's checkout
  const dest = join(DIR, 'repo');    // laid out like this repo
  mkdirSync(join(src, 'var'), { recursive: true });
  mkdirSync(join(dest, 'client', 'ledgers'), { recursive: true });
  const old = { ts: '2026-10-20T00:00:00.000Z', room: 'ABCD', seat: 0, note: 'old', actionIndex: 3, kind: 'bug', severity: 'minor' };
  const fresh = { ts: TS, room: '', seat: null, note: 'the meter stopped', actionIndex: null, kind: 'bug', severity: 'medium', page: 'challenge', solo: { kind: 'challenge', at: AT, challengeId: DEF.id } };
  const refused = { ts: '2026-10-23T06:00:00.000Z', room: '', seat: null, note: 'junk', actionIndex: null, kind: 'bug', severity: 'minor', page: 'challenge', solo: { refused: 'not a deck' } };
  writeFileSync(join(dest, 'client', 'ledgers', 'playtest-issues.snapshot.jsonl'), JSON.stringify(old) + '\n');
  writeFileSync(join(src, 'var', 'issues.jsonl'), [old, fresh, refused].map(r => JSON.stringify(r)).join('\n') + '\n');
  const runLine = JSON.stringify({ ts: TS, run: RUN });
  writeFileSync(join(src, 'var', 'report-runs.jsonl'), runLine + '\n');
  writeFileSync(join(src, 'var', 'verdicts.jsonl'), JSON.stringify({ ts: '2026-10-01T00:00:00.000Z', verdict: 'works' }) + '\n');
  // ⚠ a stand-in scp that refuses, first on the PATH: a script that ignored
  // the seam would otherwise reach the REAL deploy box and write the real
  // snapshot (it did once, while this guard was being proved against the
  // unfixed script). With this, it fails here instead.
  const bin = join(DIR, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'scp'), '#!/bin/sh\necho "test 594: scp must not be called" >&2\nexit 1\n', { mode: 0o755 });
  const out = spawnSync(process.execPath, [FETCH], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}`, ALGO_REPORTS_SOURCE_ROOT: src, ALGO_REPORTS_DEST_ROOT: dest },
  });
  assert.equal(out.status, 0, out.stderr + out.stdout);
  assert.equal(readFileSync(join(dest, 'var', 'report-runs.jsonl'), 'utf8'), runLine + '\n', 'the runs, into var/ beside the working copies');
  assert.equal(readFileSync(join(dest, 'client', 'ledgers', 'playtest-issues.snapshot.jsonl'), 'utf8').split('\n').filter(Boolean).length, 3,
    'the journal merged as it always was');
  assert.match(out.stdout, /2 NEW REPORTS/);
  assert.match(out.stdout, new RegExp(`challenge run attached \\(${DEF.id}\\), at action ${AT} — replay: node client/server/replay-report-run\\.ts ${TS.replace(/\./g, '\\.')}`));
  assert.match(out.stdout, /run NOT kept: not a deck/);
  assert.match(out.stdout, /runs: {5}1 solo-room run\(s\) kept/);
});
