// Every bot-token route refuses a request that came through the proxy, and the Caddyfile's edge block covers every such path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnServer } from '../e2e/test-util.ts';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'test-bot-token-1410';

test('⭐ each gated group: answered direct with the token, 404 through the proxy', async () => {
  const srv = await spawnServer({ ALGO_BOT_TOKEN: TOKEN });
  const call = (method: string, path: string, extra: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${srv.port}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-algo-bot': TOKEN, ...extra },
      ...(method === 'POST' ? { body: '{}' } : {}),
    }).then(async r => ({ status: r.status, text: await r.text() }));
  try {
    const routes: [string, string, number][] = [
      ['GET', '/api/bot/health', 200],
      ['GET', '/api/league/bot/status?discord=1', 200],
      ['POST', '/api/cr/editor', 400],   // reached: an empty op is refused by the route, not the gate
    ];
    for (const [method, path, direct] of routes) {
      const ok = await call(method, path);
      assert.equal(ok.status, direct, `${path} direct with the token: ${ok.text.slice(0, 120)}`);
      assert.equal((await call(method, path, { 'x-forwarded-for': '203.0.113.9' })).status, 404, `${path} through the proxy`);
    }
  } finally {
    await srv.stop();
  }
});

// The one source read: the edge block and the handlers' paths are two files nothing can drive together.
test('⭐ every bot-token path literal is in the public site\'s @botonly block', () => {
  const caddy = readFileSync(join(SERVER, '..', '..', 'deploy', 'Caddyfile'), 'utf8');
  const site = caddy.slice(caddy.indexOf('algomancy.online {'), caddy.indexOf('algomancyonline.com,'));
  assert.match(site, /handle @botonly \{\s*respond "not found" 404\s*\}/);
  const patterns = site.match(/@botonly path ([^\n]+)/)?.[1]?.trim().split(/\s+/) ?? [];
  const covered = (p: string): boolean => patterns.some(pt => (pt.endsWith('*') ? p.startsWith(pt.slice(0, -1)) : p === pt));
  const GATED: [string, string][] = [['api-bot.ts', '/api/bot/'], ['api-league.ts', '/api/league/bot/'], ['api-crreview.ts', '/api/cr/editor']];
  for (const [file, prefix] of GATED) {
    const paths = [...readFileSync(join(SERVER, file), 'utf8').matchAll(/'(\/api\/[^'?]*)'/g)].map(m => m[1]!).filter(p => p.startsWith(prefix));
    assert.ok(paths.length > 0, `${file} serves nothing under ${prefix}`);
    for (const p of paths) assert.ok(covered(p), `${p} (${file}) is not in the Caddyfile's @botonly`);
  }
});
