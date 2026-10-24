/* WEEKLY CHALLENGES — the fingerprint BACKFILL round-trips (docs/21 "Watch";
 * report round 2026-10-23).
 *
 * Runs verified before the verifier kept fingerprints (every run on the box
 * at the time of writing, on engine e201f89) have none, so Watch can only
 * call them unverified — and only the engine that verified them can say what
 * their game was. `challenge-sigs-backfill.ts` runs a CHECKOUT of that engine
 * over runs.jsonl and writes sigs.jsonl in the server's own format. Here the
 * checkout is this tree, presented as engine X with `--engine`, the way a
 * checkout without .git is.
 *
 * §1 ⭐ what it writes for a run is exactly what the verifier stores at
 *    submission, and an engine without verifyRun's step hook (e201f89 is
 *    one) is walked to the same fingerprints
 * §2 ⭐ it fingerprints only runs stamped with the checkout's engine, writes
 *    nothing for a run the checkout does not reproduce, and is idempotent
 * §3 ⭐ the server reads its output: the run is watched as recorded, on an
 *    engine that is not X
 *
 * It never reaches for the box: a refusing scp and ssh sit first on its PATH.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import * as ch from '../../engine/src/challenge.ts';
import * as ap from '../../engine/src/apply.ts';
import type { Action, CardName } from '../../engine/src/types.ts';
import { appendRun, loadChallengeStore, useChallengeDir } from '../challenge-store.ts';
import { stopChallengeWorker, verifyInWorker } from '../challenge-worker.ts';
import { runVerdict, resetResimCache } from '../challenge-resim.ts';
import { walkRun, type WalkEngine } from '../challenge-sigs.ts';
import { challengeById } from '../challenges.ts';
import { engineVersion } from '../engine-version.ts';

const SERVER = resolve(import.meta.dirname, '..');
const REPO = resolve(SERVER, '..', '..');
const root = mkdtempSync(join(tmpdir(), 'challenge-backfill-'));
const DIR = join(root, 'challenges');
const restoreDir = useChallengeDir(DIR);
test.after(async () => {
  await stopChallengeWorker();
  restoreDir();
  rmSync(root, { recursive: true, force: true });
});

// a calendar row and its committed reference run: the tool reads the
// CHECKOUT's calendar, so the run must be on it
const ID = '2026-11-01-tokens';   // quick to verify (The Parade, the quickest, is parked)
const DEF = challengeById(ID)!;
assert.ok(DEF, `the calendar has ${ID}`);
const REF = JSON.parse(readFileSync(join(SERVER, 'challenge-runs', `${ID}.json`), 'utf8')) as { deck: CardName[]; actions: Action[] };

const X = 'a'.repeat(40), Y = 'b'.repeat(40);
assert.ok(engineVersion() !== X && engineVersion() !== Y);

const BIN = join(root, 'bin');
mkdirSync(BIN);
for (const tool of ['scp', 'ssh']) {
  writeFileSync(join(BIN, tool), `#!/bin/sh\necho "test 599: ${tool} must not be called" >&2\ntouch "${root}/${tool}-called"\nexit 1\n`, { mode: 0o755 });
}
function backfill(out: string): { code: number; text: string } {
  try {
    const text = execFileSync(process.execPath, [join(SERVER, 'challenge-sigs-backfill.ts'),
      '--runs', join(DIR, 'runs.jsonl'), '--engine-root', REPO, '--out', out, '--engine', X], {
      encoding: 'utf8', env: { ...process.env, PATH: `${BIN}:${process.env['PATH'] ?? ''}` }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, text };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, text: `${e.stdout}${e.stderr}` };
  }
}

const verified = await verifyInWorker({ def: DEF, deck: REF.deck, actions: REF.actions, maxActions: 20_000 });
assert.ok(verified.ok, verified.ok ? '' : verified.error);
const row = (engine: string, score = verified.score): string => appendRun({
  challengeId: ID, user: `u-${engine.slice(0, 1)}-${score.raw}`, name: 'Ann', at: 1, deck: verified.deck, score, engine, actions: verified.actions,
}).runId;
const GOOD = row(X);
const ELSEWHERE = row(Y);
const FORGED = row(X, { ...verified.score, raw: verified.score.raw + 1 });
const OUT = join(DIR, 'sigs.jsonl');

test('docs/21 Watch / report round 2026-10-23 §1 the backfill writes what the verifier stores, with or without the step hook', () => {
  assert.equal(verified.sigs.length, verified.actions.length, 'non-vacuous: the verifier fingerprinted every action');
  const r = backfill(OUT);
  assert.equal(r.code, 1, `one run is not reproduced, so it says so in its exit code\n${r.text}`);
  const lines = readFileSync(OUT, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { runId: string; engine: string; sigs: string[] });
  assert.deepEqual(lines.map(l => l.runId), [GOOD], `exactly the one run it can vouch for\n${r.text}`);
  assert.equal(lines[0]!.engine, X);
  assert.deepEqual(lines[0]!.sigs, verified.sigs, 'byte for byte what the verifier stored at submission');
  // e201f89's verifyRun has no `onStep`: the walk then deals and applies the log itself
  const old = {
    verifyRun: (d: ch.ChallengeDef, deck: unknown, a: unknown, o?: { maxActions?: number }) => ch.verifyRun(d, deck, a, { ...(o?.maxActions ? { maxActions: o.maxActions } : {}) }),
    checkChallengeDeck: ch.checkChallengeDeck, challengeDeal: ch.challengeDeal, DUMMY_DECK: ch.DUMMY_DECK,
    createGame: ap.createGame, apply: ap.apply,
  } as unknown as WalkEngine;
  assert.deepEqual(walkRun(old, DEF, verified.deck, verified.actions, { full: false }).sigs, verified.sigs,
    'an engine without the hook is walked to the same fingerprints');
  assert.equal(existsSync(join(root, 'scp-called')) || existsSync(join(root, 'ssh-called')), false, 'and it never reached for the box');
});

test('docs/21 Watch / report round 2026-10-23 §2 only runs of its own engine, only runs it reproduces, and never twice', () => {
  const first = readFileSync(OUT, 'utf8');
  const r = backfill(OUT);
  assert.match(r.text, /0 fingerprinted, 1 already, 1 recorded on another engine, 1 failed/);
  assert.match(r.text, new RegExp(`other engine: ${ELSEWHERE} \\(${Y}\\)`));
  assert.match(r.text, new RegExp(`FAILED: ${FORGED}: scores .* is this the engine it was recorded on\\?`));
  assert.equal(readFileSync(OUT, 'utf8'), first, 'a second run adds nothing');
  // and a checkout it cannot name is refused before anything is read
  let code = 0;
  try {
    execFileSync(process.execPath, [join(SERVER, 'challenge-sigs-backfill.ts'), '--runs', join(DIR, 'runs.jsonl'),
      '--engine-root', dirname(root), '--out', join(root, 'x.jsonl')], { stdio: 'ignore' });
  } catch (err) { code = (err as { status: number }).status; }
  assert.equal(code, 2, 'no git, no --engine: a usage error');
});

test('docs/21 Watch / report round 2026-10-23 §3 the server reads the backfill and watches the run as recorded', async () => {
  loadChallengeStore();
  resetResimCache();
  const v = await runVerdict(GOOD);
  assert.deepEqual(v, { verdict: 'as-recorded', partedAt: null, refusedAt: null, older: false },
    'walked again on this engine (not X) and every fingerprint reproduced');
  const u = await runVerdict(ELSEWHERE);
  assert.equal(u.verdict, 'unverified', 'a run it did not fingerprint stays unverified');
});
