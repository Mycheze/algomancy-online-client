// /api/admin/grant and /api/admin/badge take the tester token from the header only, never ?token=.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnServer } from '../e2e/test-util.ts';

const TOKEN = 'test-tester-token-1411';

test('⭐ grant and badge: ?token= is a 404, the header works', async () => {
  const srv = await spawnServer({ ALGO_TESTER_TOKEN: TOKEN });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${srv.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
      .then(async r => ({ status: r.status, text: await r.text() }));
  try {
    assert.equal((await post('/api/auth/register', { username: 'Rhea', password: 'correct horse battery' })).status, 200);
    for (const [path, body] of [['/api/admin/grant', { name: 'Rhea' }], ['/api/admin/badge', { name: 'Rhea', judge: 1 }]] as const) {
      assert.equal((await post(`${path}?token=${TOKEN}`, body)).status, 404, `${path}?token= must not open the route`);
      const h = await post(path, body, { 'x-algo-tester': TOKEN });
      assert.equal(h.status, 200, `${path} with the header: ${h.text}`);
    }
  } finally {
    await srv.stop();
  }
});
