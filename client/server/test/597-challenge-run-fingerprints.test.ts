/* WEEKLY CHALLENGES — Watch tells the truth, and the board marks a run the
 * rules have moved under (docs/21 "Watch"; report round 2026-10-23).
 *
 * Watch replays a stored run on the LIVE engine. It used to open every run
 * under a hard-coded green "as recorded", and to skip any action the engine
 * now refuses — so the week's top run, whose rules were fixed the day after
 * it was played, would have played a different game (parted at action 44,
 * 21 of 112 actions refused) under a badge that said it had not. Now the
 * verifier records the board's fingerprint after every action it accepts
 * (`digest(signature(state))`, BL-38's), and the run route compares a fresh
 * walk on this engine against it.
 *
 * Owner, 2026-10-23: "Fingerprints + banner", and for the leaderboard "Flag
 * it, still ranked" — a run that no longer reproduces MATERIALLY (refused,
 * not verifying, another goal action or another score) is marked; a cosmetic
 * parting is not.
 *
 * §1 ⭐ a submitted run's fingerprints are stored at verify, one per action,
 *    and they are the board's own
 * §2 a run stamped with this engine and fingerprinted: as recorded
 * §3 ⭐ a run from another engine is walked again here and checked against
 *    its fingerprints: faithful / a cosmetic parting / a refusal / another
 *    score / no fingerprints at all — five different answers
 * §4 ⭐ the board marks the material ones only, and keeps their rank
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Action, CardName } from '../../engine/src/types.ts';
import {
  DUMMY_DECK, PLAYER, challengeDeal, foldRun, newChallengeGame, newRun, settleDummy, verifyRun, type ChallengeDef, type RunScore,
} from '../../engine/src/challenge.ts';
import { apply, createGame } from '../../engine/src/apply.ts';
import { register, useAccountsFile } from '../accounts.ts';
import { challengeRoutes } from '../api-challenge.ts';
import { appendRun, appendSigs, useChallengeDir } from '../challenge-store.ts';
import { stopChallengeWorker } from '../challenge-worker.ts';
import { resetResimCache, settleResims } from '../challenge-resim.ts';
import { weekWindow } from '../challenges.ts';
import { engineVersion } from '../engine-version.ts';
import { digest, signature } from '../replay-probe.ts';

const root = mkdtempSync(join(tmpdir(), 'challenge-sigs-'));
const restoreAccounts = useAccountsFile(join(root, 'accounts.json'));
const DIR = join(root, 'challenges');
const restoreDir = useChallengeDir(DIR);

const W: ChallengeDef = { id: 'sigs-w1', week: '2026-10-25', title: 'Prints', blurb: 'Play two units.', goal: { kind: 'unitsPlayed', n: 2 }, seed: 59701, par: 100 };
const ROWS = [W];
const win = weekWindow(W);
const setNow = (ms: number): void => { process.env['ALGO_CHALLENGE_NOW'] = new Date(ms).toISOString(); };
setNow(win.opens + 3_600_000);

const server: Server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  challengeRoutes(req, res, url.pathname, url, { rows: ROWS }).then(handled => {
    if (!handled) { res.writeHead(404); res.end(); }
  }, err => { res.writeHead(500); res.end(String(err)); });
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

test.after(async () => {
  delete process.env['ALGO_CHALLENGE_NOW'];
  await stopChallengeWorker();
  await new Promise<void>(r => server.close(() => r()));
  restoreDir(); restoreAccounts();
  rmSync(root, { recursive: true, force: true });
});

async function call(method: 'GET' | 'POST', path: string, token: string | null = null, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await r.text();
  return { status: r.status, body: raw ? JSON.parse(raw) as Record<string, unknown> : {} };
}

/** a real run (test 500's): all Bumblecrab, a unit whenever one can be played */
function playRun(def: ChallengeDef): { deck: CardName[]; actions: Action[] } {
  const deck: CardName[] = Array<CardName>(30).fill('Bumblecrab');
  const h = newChallengeGame(def, deck);
  let acc = newRun(def.goal, deck);
  let recycled = -1;
  const prio: Record<string, number> = { playCard: 0, activateResource: 1, recycleForResource: 2, bottomCards: 2, decide: 3, declareAttack: 4, declareBlocks: 4 };
  for (let step = 0; step < 2000 && !acc.met; step++) {
    settleDummy(h);
    const legal = h.legal(PLAYER).filter(a => a.type !== 'concede'
      && (a.type !== 'recycleForResource' || (recycled !== h.state.turn && JSON.stringify(a).includes('earth'))));
    const meets = legal.find(a => {
      try { const r = apply(h.state, a); return foldRun(acc, h.state, a, r.state, r.events).met; } catch { return false; }
    });
    const pick = meets ?? [...legal].sort((x, y) => (prio[x.type] ?? 9) - (prio[y.type] ?? 9))[0]!;
    if (pick.type === 'recycleForResource') recycled = h.state.turn;
    const before = h.state;
    const ev = h.do(pick);
    acc = foldRun(acc, before, pick, h.state, ev);
  }
  assert.ok(acc.met, 'the scripted run meets its goal');
  return { deck, actions: h.actions };
}

/** the board after each action, walked here independently of the server */
function fingerprints(def: ChallengeDef, deck: CardName[], actions: Action[]): string[] {
  let state = createGame(def.seed, ['a', 'b'], 'constructed', undefined, [deck, [...DUMMY_DECK]], undefined, challengeDeal(def)).state;
  return actions.map(a => { state = apply(state, a).state; return digest(signature(state)); });
}

const RUN = playRun(W);
const V = verifyRun(W, RUN.deck, RUN.actions);
assert.ok(V.ok, 'the scripted run verifies');
const SCORE: RunScore = V.score;
const ACTIONS = V.actions;
const PRINTS = fingerprints(W, RUN.deck, ACTIONS);
const sigLines = (): { runId: string; engine: string; sigs: string[] }[] => {
  const f = join(DIR, 'sigs.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
};

const ALICE = (() => { const r = register('Alice', 'correct horse battery'); assert.ok(r.ok); return { id: r.account.id, token: r.token }; })();
let aliceRun = '';

test('docs/21 Watch / report round 2026-10-23 §1 a submitted run keeps the fingerprint of every action it was verified on', async () => {
  const r = await call('POST', '/api/challenge/run', ALICE.token, { challengeId: W.id, deck: RUN.deck, actions: RUN.actions });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  aliceRun = String(r.body['runId']);
  const line = sigLines().find(l => l.runId === aliceRun);
  assert.ok(line, 'sigs.jsonl has a line for the run');
  assert.equal(line.engine, engineVersion(), 'stamped with the engine that verified it');
  assert.equal(line.sigs.length, ACTIONS.length, 'one per action of the stored (goal-truncated) log');
  assert.deepEqual(line.sigs, PRINTS, 'and each is the board after that action');
  // the same run twice is one run, and one line
  const again = await call('POST', '/api/challenge/run', ALICE.token, { challengeId: W.id, deck: RUN.deck, actions: RUN.actions });
  assert.equal(again.body['runId'], aliceRun);
  assert.equal(sigLines().filter(l => l.runId === aliceRun).length, 1);
});

test('docs/21 Watch / report round 2026-10-23 §2 a run fingerprinted by this very engine is watched as recorded', async () => {
  const r = await call('GET', `/api/challenge/run/${aliceRun}`, ALICE.token);
  assert.equal(r.status, 200);
  assert.equal(r.body['verdict'], 'as-recorded');
  assert.equal(r.body['partedAt'], null);
  assert.equal(r.body['refusedAt'], null);
  assert.equal(r.body['older'], undefined);
});

// ── runs recorded on ANOTHER engine (stamped, as the box's are, with its sha) ──

const OTHER = 'f'.repeat(40);
assert.notEqual(engineVersion(), OTHER);
let n = 0;
function forge(o: { actions?: Action[]; sigs?: string[] | null; score?: RunScore }): string {
  n++;
  const meta = appendRun({
    challengeId: W.id, user: `forged-${n}`, name: `Forged${n}`, at: win.opens + 7_200_000 + n,
    deck: RUN.deck, score: o.score ?? SCORE, engine: OTHER, actions: o.actions ?? ACTIONS,
  });
  if (o.sigs !== null) appendSigs({ runId: meta.runId, engine: OTHER, sigs: o.sigs ?? PRINTS });
  return meta.runId;
}
const K = Math.floor(ACTIONS.length / 2);
const J = ACTIONS.findIndex((a, i) => i > 2 && a.type === 'playCard');
assert.ok(J > 0, 'non-vacuous: the run plays a card from hand');
const tampered = ACTIONS.map((a, i) => (i === J ? { ...a, handIndex: 99 } as Action : a));

const FAITHFUL = forge({});
const COSMETIC = forge({ sigs: PRINTS.map((s, i) => (i === K ? '0123456789abcdef' : s)) });
const REFUSED = forge({ actions: tampered });
const BETTER = forge({ score: { ...SCORE, raw: SCORE.raw - 1 } });
const BARE = forge({ sigs: null });

test('docs/21 Watch / report round 2026-10-23 §3 a run from another engine is checked against its own fingerprints', async () => {
  const get = async (id: string): Promise<Record<string, unknown>> => {
    const r = await call('GET', `/api/challenge/run/${id}`, null);
    assert.equal(r.status, 200);
    return r.body;
  };
  // the week has to have closed for strangers to watch
  setNow(win.closes + 60_000);
  const f = await get(FAITHFUL);
  assert.deepEqual([f['verdict'], f['partedAt'], f['refusedAt'], f['older']], ['as-recorded', null, null, undefined],
    'every fingerprint reproduced: as recorded, though the engine is not the one stamped');
  const c = await get(COSMETIC);
  assert.deepEqual([c['verdict'], c['partedAt'], c['refusedAt'], c['older']], ['reconstruction', K, null, undefined],
    'one board differs: a reconstruction from there, but the run still verifies to the same score, so no mark');
  const x = await get(REFUSED);
  assert.deepEqual([x['verdict'], x['partedAt'], x['refusedAt'], x['older']], ['reconstruction', J, J, true],
    'this engine refuses an action: parted and refused there, and marked');
  const s = await get(BETTER);
  assert.deepEqual([s['verdict'], s['older']], ['as-recorded', true], 'the same game, another score: marked');
  const b = await get(BARE);
  assert.deepEqual([b['verdict'], b['partedAt'], b['older']], ['unverified', null, undefined],
    'no fingerprints: unverified — never "as recorded" on the strength of nothing');
});

test('docs/21 Watch / report round 2026-10-23 §4 the board marks a run the rules moved under, and keeps its rank', async () => {
  resetResimCache();
  const first = await call('GET', `/api/challenge/${W.id}/board`);
  assert.equal(first.status, 200);
  await settleResims();
  const r = await call('GET', `/api/challenge/${W.id}/board`);
  const rows = r.body['rows'] as { rank: number; runId: string; older?: boolean }[];
  const marked = rows.filter(x => x.older).map(x => x.runId).sort();
  assert.deepEqual(marked, [REFUSED, BETTER].sort(), 'the material ones, and only those');
  assert.equal(rows.find(x => x.runId === BETTER)?.rank, 1, 'still ranked: first, on its stamped score');
  const winner = r.body['winner'] as { runId?: string; older?: boolean };
  assert.equal(winner.older, true, 'the frozen winner wears the mark too');
});
