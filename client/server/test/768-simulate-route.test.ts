/* /api/bot/simulate — THE GATE, THE BODY CAP, AND NOTHING WRITTEN.
 *
 * The one bot route that spends real CPU per call, so it has two gates, both
 * answered 404 like every bot route (api-bot.ts): the bot token, and a DIRECT
 * loopback peer with no forwarding header — behind Caddy every request comes
 * from loopback, and only the X-Forwarded-For Caddy adds tells them apart.
 * deploy/Caddyfile also answers the path 404 at the edge.
 *
 * §1 directLoopback: loopback with no forwarding header only
 * §2 ⭐ the real server: 404 without the token header, 404 with the token but
 *    through a proxy, 405 for GET, 413 over 16 KB, 400 unparseable, and a
 *    real answer (with the engine SHA) when everything is right
 * §3 ⭐ no token configured → the route does not exist, header or not
 * §4 the edge 404 is in the Caddyfile
 * §5 ⭐ nothing is written: no file write of any kind while simulations run
 *    (every fs write entry point trapped), the working directory stays
 *    empty, and the worker's whole import graph imports no fs at all
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { directLoopback } from '../api-bot.ts';
import { spawnServer, type ServerHandle } from '../e2e/test-util.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN = 'test-bot-token-768';
const SPEC = {
  you: { hand: ['Luminous Arc'], play: ['The Foretold'], resources: { fire: 3 } },
  opponent: { play: ['Towering Colossus'] },
  attack: [['you.0']],
  steps: [{ do: 'play', card: 'Luminous Arc', targets: ['opponent.0'] }],
};

/* ══ §1 ═════════════════════════════════════════════════════════════ */

test('§1 directLoopback: a loopback peer with no forwarding header, and nothing else', () => {
  const req = (remoteAddress: string, headers: Record<string, string> = {}) => ({ socket: { remoteAddress }, headers });
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(directLoopback(req(a)), true, a);
  assert.equal(directLoopback(req('10.0.0.5')), false, 'a LAN peer');
  assert.equal(directLoopback(req('203.0.113.9')), false, 'a public peer');
  assert.equal(directLoopback(req('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' })), false, '⭐ through the proxy');
  assert.equal(directLoopback(req('127.0.0.1', { forwarded: 'for=203.0.113.9' })), false);
  assert.equal(directLoopback(req('127.0.0.1', { 'x-real-ip': '203.0.113.9' })), false);
  assert.equal(directLoopback(req('127.0.0.1', { 'x-forwarded-host': 'algomancy.online' })), false);
  assert.equal(directLoopback({ socket: { remoteAddress: undefined }, headers: {} }), false);
});

/* ══ §2 + §3 ════════════════════════════════════════════════════════ */

async function post(srv: ServerHandle, body: string, headers: Record<string, string> = {}, method = 'POST'): Promise<{ status: number; text: string }> {
  const r = await fetch(`http://127.0.0.1:${srv.port}/api/bot/simulate`, {
    method, headers: { 'content-type': 'application/json', ...headers }, ...(method === 'POST' ? { body } : {}),
  });
  return { status: r.status, text: await r.text() };
}

test('§2 ⭐ the real server: both gates, the caps, and a real answer', async () => {
  const srv = await spawnServer({ ALGO_BOT_TOKEN: TOKEN });
  try {
    const good = JSON.stringify(SPEC);
    const auth = { 'x-algo-bot': TOKEN };
    const none = await post(srv, good);
    assert.deepEqual([none.status, none.text], [404, 'not found'], 'no token header → 404');
    const wrong = await post(srv, good, { 'x-algo-bot': 'nope' });
    assert.equal(wrong.status, 404, 'a wrong token → 404');
    const proxied = await post(srv, good, { ...auth, 'x-forwarded-for': '203.0.113.9' });
    assert.deepEqual([proxied.status, proxied.text], [404, 'not found'], '⭐ the right token through a proxy → 404');
    assert.equal((await post(srv, '', auth, 'GET')).status, 405);
    const big = await post(srv, JSON.stringify({ pad: 'x'.repeat(17 * 1024) }), auth);
    assert.equal(big.status, 413, 'over 16 KB');
    assert.equal((await post(srv, '{not json', auth)).status, 400);

    const ok = await post(srv, good, auth);
    assert.equal(ok.status, 200);
    const r = JSON.parse(ok.text) as { ok: boolean; engine: string; final: { units: { ref: string; damage: number }[] } };
    assert.equal(r.ok, true, ok.text);
    assert.match(r.engine, /^([0-9a-f]{40}|unknown)$/, 'stamped with the engine version');
    assert.equal(r.final.units.find(u => u.ref === 'opponent.0')!.damage, 6);
    assert.ok(Buffer.byteLength(ok.text) <= 6 * 1024);

    const bad = JSON.parse((await post(srv, JSON.stringify({ you: { hand: ['Luminos Arc'] } }), auth)).text) as { ok: boolean; errors: { didYouMean?: string[] }[] };
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.errors[0]!.didYouMean?.[0], 'Luminous Arc', 'a refusal is a 200 with the reason');
  } finally {
    await srv.stop();
  }
});

test('§3 ⭐ no ALGO_BOT_TOKEN: the route does not exist, header or not', async () => {
  const srv = await spawnServer({ ALGO_BOT_TOKEN: '' });
  try {
    const r = await post(srv, JSON.stringify(SPEC), { 'x-algo-bot': '' });
    assert.deepEqual([r.status, r.text], [404, 'not found']);
    const r2 = await post(srv, JSON.stringify(SPEC), { 'x-algo-bot': TOKEN });
    assert.equal(r2.status, 404);
  } finally {
    await srv.stop();
  }
});

/* ══ §4 ═════════════════════════════════════════════════════════════ */

test('§4 the Caddyfile answers the route 404 at the edge', () => {
  const caddy = readFileSync(join(HERE, '..', '..', '..', 'deploy', 'Caddyfile'), 'utf8');
  const site = caddy.slice(caddy.indexOf('algomancy.online {'), caddy.indexOf('algomancyonline.com,'));
  assert.match(site, /handle \/api\/bot\/simulate\* \{\s*respond "not found" 404\s*\}/);
  assert.ok(site.indexOf('handle /api/bot/simulate*') < site.indexOf('reverse_proxy'), 'inside the public site');
});

/* ══ §5 ═════════════════════════════════════════════════════════════ */

const WRITERS = ['writeFileSync', 'appendFileSync', 'mkdirSync', 'mkdtempSync', 'renameSync', 'copyFileSync',
  'rmSync', 'unlinkSync', 'createWriteStream', 'writeFile', 'appendFile', 'mkdir', 'rename', 'rm', 'unlink',
  'copyFile', 'cpSync', 'symlinkSync', 'truncateSync'] as const;

test('§5 ⭐ nothing is written while simulations run', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'algo-768-var-'));
  const cwd = process.cwd();
  const writes: string[] = [];
  const saved = new Map<string, unknown>();
  const f = fs as unknown as Record<string, unknown>;
  const p = fs.promises as unknown as Record<string, unknown>;
  for (const name of WRITERS) {
    if (typeof f[name] === 'function') {
      saved.set(name, f[name]);
      f[name] = (...args: unknown[]) => { writes.push(`${name}(${String(args[0])})`); throw new Error(`768: ${name} called`); };
    }
    if (typeof p[name] === 'function') {
      saved.set(`p.${name}`, p[name]);
      p[name] = async (...args: unknown[]) => { writes.push(`promises.${name}(${String(args[0])})`); throw new Error(`768: promises.${name} called`); };
    }
  }
  const origOpen = fs.openSync;
  f['openSync'] = (path: unknown, flags?: unknown, ...rest: unknown[]) => {
    if (typeof flags === 'string' && /[wa+]/.test(flags)) writes.push(`openSync(${String(path)}, ${flags})`);
    return (origOpen as (...a: unknown[]) => number)(path, flags, ...rest);
  };
  syncBuiltinESMExports();
  try {
    process.chdir(empty);
    const { simulate } = await import('../simulate.ts');
    for (const spec of [SPEC, { you: { play: [{ card: 'Static Courier', temp: { attrs: ['Balanced', 'Inverted'] } }] }, until: 'endOfTurn' },
      { you: { hand: ['Nope Card'] } }]) {
      simulate(spec, { engine: 'test' });
    }
  } finally {
    process.chdir(cwd);
    for (const [k, v] of saved) { if (k.startsWith('p.')) p[k.slice(2)] = v; else f[k] = v; }
    f['openSync'] = origOpen;
    syncBuiltinESMExports();
  }
  assert.deepEqual(writes, [], `a simulation wrote: ${writes.join(', ')}`);
  assert.deepEqual(readdirSync(empty), [], 'the working directory stayed empty');
  rmSync(empty, { recursive: true, force: true });
});

test('§5b the worker\'s whole import graph imports no fs, no state paths, no rooms', () => {
  const seen = new Set<string>();
  const offenders: string[] = [];
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    if (/from\s+'(node:)?fs(\/promises)?'|import\('(node:)?fs/.test(text)) offenders.push(`${file}: fs`);
    if (/statepaths\.ts|rooms\.ts'|child_process/.test(text.replace(/^\s*(\*|\/\/).*$/gm, ''))) offenders.push(`${file}: state`);
    for (const m of text.matchAll(/^(?!\s*import\s+type\b)(?:import|export)\s[^;]*?from\s+'(\.{1,2}\/[^']+\.ts)'|import\('(\.{1,2}\/[^']+\.ts)'\)/gm)) {
      walk(resolve(dirname(file), (m[1] ?? m[2])!));
    }
  };
  walk(join(HERE, '..', 'simulate-worker.ts'));
  assert.ok(seen.size > 20, `the walk reached the engine (${seen.size} files)`);
  assert.ok([...seen].some(f => f.endsWith('simulate.ts')) && [...seen].some(f => f.endsWith('engine.ts')));
  assert.deepEqual(offenders, []);
});
