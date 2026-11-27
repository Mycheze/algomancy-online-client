/* Weekly Challenge Watch names the cards of a run that changed since it was
 * verified (`cardsChanged` on `GET /api/challenge/run/<id>`), from the run's
 * `engine` stamp and its deck, read against the real git history.
 *
 * A run of thirty Murkstalker stamped at the commit before 26e536f0, which
 * reprinted Murkstalker, Seer of Empty Spaces and The Everywhere, names
 * Murkstalker alone. A stamp git cannot show says "can't tell".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ChallengeDef, RunScore } from '../../engine/src/challenge.ts';
import { useAccountsFile } from '../accounts.ts';
import { challengeRoutes } from '../api-challenge.ts';
import { appendRun, useChallengeDir } from '../challenge-store.ts';
import { stopChallengeWorker } from '../challenge-worker.ts';
import { weekWindow } from '../challenges.ts';
import { repoDir } from '../engine-version.ts';

const root = mkdtempSync(join(tmpdir(), 'watch-cards-changed-'));
const restoreAccounts = useAccountsFile(join(root, 'accounts.json'));
const restoreDir = useChallengeDir(join(root, 'challenges'));

const W: ChallengeDef = { id: 'cc-w1', week: '2026-10-25', title: 'Drain', blurb: 'Play two units.', goal: { kind: 'unitsPlayed', n: 2 }, seed: 59701, par: 100 };
const win = weekWindow(W);
// a closed week: anybody may watch its runs
process.env['ALGO_CHALLENGE_NOW'] = new Date(win.closes + 60_000).toISOString();

test.after(async () => {
  delete process.env['ALGO_CHALLENGE_NOW'];
  await stopChallengeWorker();
  restoreDir(); restoreAccounts();
  rmSync(root, { recursive: true, force: true });
});

const PARENT = execFileSync('git', ['-C', repoDir(), 'rev-parse', '26e536f0^'], { encoding: 'utf8' }).trim();
const SCORE = { cards: 30, unique: 1, raw: 30 } as unknown as RunScore;

function run(engine: string): string {
  return appendRun({
    challengeId: W.id, user: 'u1', name: 'Alice', at: win.opens + 7_200_000,
    deck: Array(30).fill('Murkstalker'), score: SCORE, engine, actions: [],
  }).runId;
}

async function watch(runId: string): Promise<Record<string, unknown>> {
  const req = { method: 'GET', headers: {} } as unknown as IncomingMessage;
  let status = 0;
  let payload = '';
  const res = {
    writeHead(s: number) { status = s; return res; },
    end(b?: string | Buffer) { payload = b === undefined ? '' : String(b); return res; },
    setHeader() { /* unused */ },
  } as unknown as ServerResponse;
  const url = new URL(`http://x/api/challenge/run/${runId}`);
  await challengeRoutes(req, res, url.pathname, url, { rows: [W] });
  assert.equal(status || 200, 200, payload);
  return JSON.parse(payload) as Record<string, unknown>;
}

test('watch cards changed: a run verified before a card update names the changed card in its deck', async () => {
  const body = await watch(run(PARENT));
  const changed = body['cardsChanged'];
  assert.ok(Array.isArray(changed), `a readable stamp gives a list, got ${JSON.stringify(changed)}`);
  assert.deepEqual((changed as { card: string }[]).map(c => c.card), ['Murkstalker'],
    'its deck is all Murkstalker; the other cards that commit reprinted are not on this table');
});

test('watch cards changed: a stamp git cannot show says cant-tell', async () => {
  assert.equal((await watch(run('f'.repeat(40))))['cardsChanged'], 'cant-tell');
  assert.equal((await watch(run('')))['cardsChanged'], 'cant-tell');
});
