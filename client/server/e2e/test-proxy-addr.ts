/* The address a request "came from", behind a reverse proxy
 * (run: node test-proxy-addr.ts).
 *
 * Every brake in the server — the login throttle, the signup brake, the
 * report/verdict/sandbox/judge limits — keys on an address. On the LAN that
 * was the socket's peer. Behind Caddy on the VPS the socket's peer is Caddy,
 * for everyone, so the first tester to mistype a password ten times would
 * lock the whole site out of login for a minute. api-util.ts's `addrOf` now
 * reads X-Forwarded-For — but only from a loopback peer, i.e. from the proxy,
 * and only its LAST entry, the one the proxy itself appended.
 *
 * Two halves:
 *   1. in-process: addrOf on hand-built requests, including the one that
 *      cannot be produced over a real loopback socket — a NON-loopback peer
 *      sending the header, which must be ignored (honouring it would let a
 *      caller rotate their own bucket).
 *   2. the real server: eleven bad logins carrying `X-Forwarded-For: 1.2.3.4`
 *      throttle; a twelfth carrying `5.6.7.8` does NOT. That assertion failed
 *      on the code before this — every login collapsed to 127.0.0.1.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnServer } from './test-util.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-proxy-test-'));
const STORE = join(SCRATCH, 'accounts.json');
const GAMES = join(SCRATCH, 'games');
process.env['ALGO_ACCOUNTS_FILE'] = STORE;
process.env['ALGO_GAMES_DIR'] = GAMES;

const { addrOf } = await import('../api-util.ts');

let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

// ── 1. addrOf as a value ──────────────────────────────────────────────

console.log('\n[addrOf: whose address is it]');
const fake = (peer: string, fwd?: string): import('node:http').IncomingMessage =>
  ({ socket: { remoteAddress: peer }, headers: fwd === undefined ? {} : { 'x-forwarded-for': fwd } }) as never;
eq(addrOf(fake('127.0.0.1')), '127.0.0.1', 'no header: the peer, as always');
eq(addrOf(fake('127.0.0.1', '1.2.3.4')), '1.2.3.4', 'loopback peer + header: the forwarded address');
eq(addrOf(fake('::1', '1.2.3.4')), '1.2.3.4', 'IPv6 loopback counts as loopback');
eq(addrOf(fake('::ffff:127.0.0.1', '9.9.9.9, 1.2.3.4')), '1.2.3.4',
  'a chain: the LAST entry, the one the proxy appended, never the first (client-supplied)');
eq(addrOf(fake('127.0.0.1', '')), '127.0.0.1', 'an empty header is no header');
eq(addrOf(fake('203.0.113.9', '1.2.3.4')), '203.0.113.9',
  'NEGATIVE CONTROL: a non-loopback peer\'s header is ignored — it typed it');

// ── 2. the real server: the login throttle keys on the forwarded address ──

console.log('\n[server: one tester\'s failures do not lock out another]');
const server = await spawnServer({ ALGO_ACCOUNTS_FILE: STORE, ALGO_GAMES_DIR: GAMES });
const base = `http://localhost:${server.port}`;
const post = async (path: string, body: unknown, fwd?: string): Promise<Record<string, any>> => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(fwd ? { 'x-forwarded-for': fwd } : {}) },
    body: JSON.stringify(body),
  });
  return await res.json() as Record<string, any>;
};

try {
  const made = await post('/api/auth/register', { username: 'Ann', password: 'a good password' });
  ok(made['ok'], 'an account to fail against');

  let last: Record<string, any> = {};
  for (let i = 0; i < 10; i++) last = await post('/api/auth/login', { username: 'Ann', password: 'nope' }, '1.2.3.4');
  ok(!last['ok'] && !/too many/.test(String(last['error'])), 'ten wrong passwords are ten refusals');
  const eleventh = await post('/api/auth/login', { username: 'Ann', password: 'nope' }, '1.2.3.4');
  ok(/too many/.test(String(eleventh['error'])), 'the eleventh from 1.2.3.4 is throttled');
  const otherTester = await post('/api/auth/login', { username: 'Ann', password: 'nope' }, '5.6.7.8');
  ok(!otherTester['ok'] && !/too many/.test(String(otherTester['error'])),
    'THE POINT: 5.6.7.8 is refused for the password, not throttled for 1.2.3.4\'s sins');
  const otherRight = await post('/api/auth/login', { username: 'Ann', password: 'a good password' }, '5.6.7.8');
  ok(otherRight['ok'] === true, 'and can log in');
  const stillLocked = await post('/api/auth/login', { username: 'Ann', password: 'a good password' }, '1.2.3.4');
  ok(/too many/.test(String(stillLocked['error'])), 'while 1.2.3.4 stays throttled even with the right password');
  const bare = await post('/api/auth/login', { username: 'Ann', password: 'a good password' });
  ok(bare['ok'] === true, 'no header at all is its own bucket (the socket address), as before');
} finally {
  await server.stop();
  rmSync(SCRATCH, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURES ✗`);
process.exit(failures === 0 ? 0 : 1);
