/* docs/25 — AN EVENT'S CODE IS RECOGNISED SIGNED OUT.
 *
 * The home's Join box asks `GET /api/cube/<code>` to tell an event's code from a room's. That
 * route needed a token, so a signed-out player who typed a friend's event code was sent to a
 * room of that name instead of the event page (which says "Sign in to join").
 *
 *   §1 ⭐ signed out, GET of an event answers its public view: `me` null, `joined` false, and
 *      nothing of anyone's own — no draft, no pool, no deck
 *   §2 everything else still needs an account: an unknown code is 404, `mine`, join and new are 401
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnServer } from '../e2e/test-util.ts';

const DIR = mkdtempSync(join(tmpdir(), 'algo-t1327-'));
const env = {
  ALGO_GAMES_DIR: join(DIR, 'games'), ALGO_MATCHES_DIR: join(DIR, 'matches'), ALGO_CUBE_DIR: join(DIR, 'cube'),
  ALGO_ACCOUNTS_FILE: join(DIR, 'accounts.json'), ALGO_ISSUES_FILE: join(DIR, 'issues.jsonl'),
};
const A = await import('../accounts.ts');
const restore = A.useAccountsFile(env.ALGO_ACCOUNTS_FILE);
const reg = A.register('Annt1327', 'correct horse battery');
if (!reg.ok) throw new Error(reg.error);
const ann = { id: reg.account.id, token: reg.token };
restore();
const server = await spawnServer(env);
test.after(async () => {
  await server.stop();
  rmSync(DIR, { recursive: true, force: true });
});
const base = `http://localhost:${server.port}`;
async function api(path: string, token: string | null, body?: unknown): Promise<{ status: number; body: Record<string, any> }> {
  const r = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: await r.json() as Record<string, any> };
}

let CODE = '';

test('§1 ⭐ signed out, an event answers with its public view', async () => {
  const made = await api('/api/cube/new', ann.token, { config: { name: 'Open cube', maxPlayers: 4 } });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  CODE = made.body['code'];
  for (const asked of [CODE, CODE.toLowerCase()]) {
    const r = await api(`/api/cube/${asked}`, null);
    assert.equal(r.status, 200, `${asked}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body['ok'], true);
    const v = r.body['view'];
    assert.equal(v.code, CODE);
    assert.equal(v.phase, 'lobby');
    assert.equal(v.config.name, 'Open cube');
    assert.equal(v.me, null);
    assert.equal(v.joined, false);
    assert.equal(v.isHost, false);
    assert.equal(v.draft, null);
    assert.equal(v.myPool, null);
    assert.equal(v.myDeck, null);
    assert.equal(v.myMatch, null);
  }
  // signed in, the same route is still the caller's own view
  const mine = await api(`/api/cube/${CODE}`, ann.token);
  assert.equal(mine.body['view'].me, ann.id);
  assert.equal(mine.body['view'].isHost, true);
});

test('§2 everything else still needs an account', async () => {
  const unknown = await api('/api/cube/ZZZZQ', null);
  assert.equal(unknown.status, 404, 'an unknown code is no event — the Join box then tries a room');
  assert.equal(unknown.body['ok'], false);
  assert.equal((await api('/api/cube/mine', null)).status, 401, 'my events');
  assert.equal((await api(`/api/cube/${CODE}/join`, null, {})).status, 401, 'join');
  assert.equal((await api(`/api/cube/${CODE}/start`, null, {})).status, 401, 'a host op');
  assert.equal((await api('/api/cube/new', null, { config: {} })).status, 401, 'new');
  assert.equal((await api(`/api/cube/${CODE}/suggest`, null)).status, 401, 'a GET of an op');
});
