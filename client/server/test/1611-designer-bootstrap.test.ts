/* 1611 — the tester-token bootstrap grants the designer flag (POST /api/admin/grant,
 * deploy/admin.sh designer <name>), against the real server.
 *
 * §1 a body naming `designer` sets that flag, both ways, and leaves admin alone;
 *    the account's own /api/me says so; a body without it still grants admin;
 *    without the tester header it is the plain 404
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnServer } from '../e2e/test-util.ts';

const TOKEN = 'test-tester-token-1611';

test('1611 §1 the bootstrap grants and revokes designer, and leaves admin alone', async () => {
  const srv = await spawnServer({ ALGO_TESTER_TOKEN: TOKEN });
  const base = `http://127.0.0.1:${srv.port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
      .then(async r => ({ status: r.status, body: await r.json().catch(() => null) as Record<string, unknown> | null }));
  const tester = { 'x-algo-tester': TOKEN };
  try {
    const reg = await post('/api/auth/register', { username: 'Caleb', password: 'correct horse battery' });
    assert.equal(reg.status, 200);
    const session = String(reg.body!['token']);
    const me = async () => ((await (await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${session}` } })).json()) as
      { me: { designer?: boolean; admin?: boolean } }).me;
    assert.equal((await me()).designer, undefined, 'a new account is not a designer');

    assert.equal((await post('/api/admin/grant', { name: 'Caleb', designer: true })).status, 404, 'no tester header: 404');
    assert.equal((await me()).designer, undefined, 'and nothing changed');

    const on = await post('/api/admin/grant', { name: 'Caleb', designer: true }, tester);
    assert.deepEqual(on.body, { ok: true, name: 'Caleb', designer: true });
    const after = await me();
    assert.equal(after.designer, true, 'the own view carries it');
    assert.equal(after.admin, undefined, 'and granting designer granted no admin');

    const off = await post('/api/admin/grant', { name: 'Caleb', designer: false }, tester);
    assert.deepEqual(off.body, { ok: true, name: 'Caleb', designer: false });
    assert.equal((await me()).designer, undefined);

    // the existing usage, deploy/admin.sh <name>, still makes an admin
    const admin = await post('/api/admin/grant', { name: 'Caleb' }, tester);
    assert.deepEqual(admin.body, { ok: true, name: 'Caleb', admin: true });
    const both = await me();
    assert.equal(both.admin, true);
    assert.equal(both.designer, undefined, 'the admin grant sets no designer flag');
  } finally {
    await srv.stop();
  }
});
