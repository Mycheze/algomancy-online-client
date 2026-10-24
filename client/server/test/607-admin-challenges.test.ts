/* The admin dashboard's Challenges tab, server half (server/admin-challenges.ts,
 * `GET /api/admin/challenges` in api-admin.ts). Owner, 2026-10-24: "I'd like
 * to be able to see the upcoming challenges in an admin tab."
 *
 * The REAL calendar (CHALLENGES) and the real reference runs, walked by the
 * real verifier worker; the clock is ALGO_CHALLENGE_NOW, set in-process.
 *
 * §1 signed out, and signed in without the admin flag: the same 404 a path
 *    the server does not serve gets — the upcoming rows reach nobody else
 * §2 an admin gets every row, upcoming ones included, ordered open, upcoming,
 *    closed; each with its status, window, seed and par; opened rows with
 *    their run and player counts; and when the calendar runs out
 * §3 each reference run is scored by the engine's own verifyRun (its raw is
 *    the row's par, so Skill 100) — pending until the walk is done
 * §4 the public calendar still names no row that has not opened
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { register, setAdmin, accountForToken, useAccountsFile } from '../accounts.ts';
import { adminRoutes } from '../api-admin.ts';
import { challengeRoutes } from '../api-challenge.ts';
import { appendRun, useChallengeDir } from '../challenge-store.ts';
import { stopChallengeWorker } from '../challenge-worker.ts';
import { CHALLENGES, WEEK_MS, hasOpened, weekWindow } from '../challenges.ts';
import { resetReferenceRuns, settleReferenceRuns, type AdminChallenges } from '../admin-challenges.ts';

const root = mkdtempSync(join(tmpdir(), 'admin-challenges-'));
const restoreAccounts = useAccountsFile(join(root, 'accounts.json'));
const restoreDir = useChallengeDir(join(root, 'challenges'));

/** a moment inside the SECOND row's week: one closed, one open, the rest upcoming */
const OPEN = CHALLENGES[1]!;
const NOW = weekWindow(OPEN).opens + 3 * 86_400_000 + 5 * 3_600_000;
process.env['ALGO_CHALLENGE_NOW'] = new Date(NOW).toISOString();

function account(name: string): { id: string; token: string } {
  const r = register(name, 'correct horse battery');
  assert.ok(r.ok, `could not register ${name}`);
  return { id: r.account.id, token: r.token };
}
const PLAYER = account('player');
const OTHER = account('other');
const OPS = account('ops');
setAdmin(accountForToken(OPS.token)!, true);

// two runs by one player and one by another on the open week; one on the closed
const score = { unique: 1, extra: 0, cards: 1, elements: 1, turns: 9, raw: 9, skill: 100 };
for (const [user, challengeId] of [[PLAYER.id, OPEN.id], [PLAYER.id, OPEN.id], [OTHER.id, OPEN.id], [OTHER.id, CHALLENGES[0]!.id]] as const) {
  appendRun({ challengeId, user, name: user, at: NOW - 1000, deck: ['Bumblecrab'], score, engine: 'test', actions: [] });
}

test.after(async () => {
  delete process.env['ALGO_CHALLENGE_NOW'];
  await settleReferenceRuns();
  resetReferenceRuns();
  await stopChallengeWorker();
  restoreDir(); restoreAccounts();
  rmSync(root, { recursive: true, force: true });
});

interface Answer { status: number; raw: string; handled: boolean }
async function get(path: string, token: string | null, routes = adminRoutes): Promise<Answer> {
  const req = { method: 'GET', headers: token ? { authorization: `Bearer ${token}` } : {} } as unknown as IncomingMessage;
  let status = 0;
  let raw = '';
  const res = {
    writeHead(s: number) { status = s; return res; },
    end(b?: string | Buffer) { raw = b === undefined ? '' : String(b); return res; },
    setHeader() { /* unused */ },
  } as unknown as ServerResponse;
  const handled = await (routes as (q: IncomingMessage, s: ServerResponse, p: string, u: URL) => Promise<boolean>)(
    req, res, path, new URL(`http://x${path}`));
  return { status: status || 200, raw, handled };
}
const upcoming = CHALLENGES.filter(d => !hasOpened(d, NOW));

test('§1 signed out and signed in without the admin flag: the plain 404 a missing path gets', async () => {
  assert.ok(upcoming.length >= 1, 'this test needs an upcoming row to be measuring anything');
  const missing = await get('/api/admin/no-such-route', PLAYER.token);
  for (const [who, token] of [['signed out', null], ['a player', PLAYER.token]] as const) {
    const r = await get('/api/admin/challenges', token);
    assert.equal(r.handled, true, `${who}: the route answers rather than falling through to the file handler`);
    assert.equal(r.status, 404, `${who}: refused`);
    assert.equal(r.raw, missing.raw, `${who}: refused exactly as a path that does not exist is`);
    for (const d of upcoming) {
      assert.ok(!r.raw.includes(d.id) && !r.raw.includes(d.title), `${who} learns nothing of ${d.id}`);
    }
  }
});

test('§2 an admin gets every row, upcoming ones included, and when the calendar runs out', async () => {
  const r = await get('/api/admin/challenges', OPS.token);
  assert.equal(r.status, 200);
  const body = JSON.parse(r.raw) as { ok: boolean } & AdminChallenges;
  assert.equal(body.ok, true);
  assert.equal(body.rows.length, CHALLENGES.length, 'every calendar row');
  assert.deepEqual(body.rows.map(x => x.status),
    ['open', ...upcoming.map(() => 'upcoming'), 'closed'], 'open now first, then upcoming, then closed');
  assert.deepEqual(body.rows.map(x => x.id), [OPEN.id, ...upcoming.map(d => d.id), CHALLENGES[0]!.id]);
  for (const x of body.rows) {
    const def = CHALLENGES.find(d => d.id === x.id)!;
    assert.equal(x.title, def.title); assert.equal(x.blurb, def.blurb);
    assert.deepEqual(x.goal, def.goal); assert.equal(x.seed, def.seed); assert.equal(x.par, def.par);
    assert.deepEqual([x.opens, x.closes], [weekWindow(def).opens, weekWindow(def).closes]);
  }
  const next = body.rows[1]!;
  assert.equal(next.opensInDays, 4, 'the next row opens Sunday 07:00; it is Wednesday noon — 3 days 19 hours, so 4');
  assert.equal(body.rows[0]!.opensInDays, undefined, 'an opened row has no countdown');
  assert.deepEqual([body.rows[0]!.runs, body.rows[0]!.players], [3, 2], 'the open week: three runs by two players');
  assert.deepEqual([body.rows.at(-1)!.runs, body.rows.at(-1)!.players], [1, 1], 'the closed week');
  assert.ok(upcoming.every(d => body.rows.find(x => x.id === d.id)!.runs === undefined), 'no board counts on an unopened row');
  const lastClose = weekWindow(CHALLENGES.at(-1)!).closes;
  assert.equal(body.runsOutAt, lastClose, 'the calendar runs out when its last row closes');
  assert.equal(body.weeksLeft, Math.ceil((lastClose - NOW) / WEEK_MS));
  assert.equal(body.upcoming, upcoming.length);
});

test('§3 each reference run is scored by the engine: its raw is the row par, Skill 100', async () => {
  await get('/api/admin/challenges', OPS.token);
  await settleReferenceRuns();
  const r = await get('/api/admin/challenges', OPS.token);
  const body = JSON.parse(r.raw) as AdminChallenges;
  for (const x of body.rows) {
    assert.equal(x.ref.state, 'ok', `${x.id}: ${JSON.stringify(x.ref)}`);
    if (x.ref.state !== 'ok') continue;
    assert.equal(x.ref.score.raw, x.par, `${x.id}: the reference run is what par was set from (test 506)`);
    assert.equal(x.ref.score.skill, 100);
    assert.equal(x.ref.score.raw, x.ref.score.cards * Math.max(1, x.ref.score.elements) * x.ref.score.turns);
  }
});

test('§4 the public calendar is unchanged: it still names no row that has not opened', async () => {
  const r = await get('/api/challenge', PLAYER.token, challengeRoutes as typeof adminRoutes);
  assert.equal(r.status, 200);
  const body = JSON.parse(r.raw) as { current: { id: string } | null; past: { id: string }[] };
  assert.equal(body.current?.id, OPEN.id);
  for (const d of upcoming) assert.ok(!r.raw.includes(d.id) && !r.raw.includes(d.title), `the public API names ${d.id}`);
  const board = await get(`/api/challenge/${upcoming[0]!.id}/board`, PLAYER.token, challengeRoutes as typeof adminRoutes);
  assert.equal(board.status, 404, 'an upcoming board is still not found');
});
