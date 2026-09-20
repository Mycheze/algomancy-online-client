/* The favourite element you CHOOSE, and who is on the friends board
 * (run: node test-favorite.ts).
 *
 * Owner, 2026-09-05: "Allow them to override and choose their favorite in the
 * account stats tab" and "The Friends tab 'Everyone here' shouldn't show Guest
 * accounts".
 *
 *   §1 with nothing chosen /api/me shows the element played most (null on a
 *      fresh account) and favoritePicked null
 *   §2 POST /api/me/favorite {element} picks; /api/me, /api/player and the
 *      no-mode /api/players board all show it; an unknown element clears
 *   §3 an unclaimed guest is not on the no-mode board; a registered account is
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnServer } from './test-util.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-fav-test-'));
let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

const server = await spawnServer({ ALGO_ACCOUNTS_FILE: join(SCRATCH, 'accounts.json'), ALGO_GAMES_DIR: join(SCRATCH, 'games'), ALGO_ISSUES_FILE: join(SCRATCH, 'issues.jsonl') });
const base = `http://localhost:${server.port}`;
type J = Record<string, unknown>;
const post = async (path: string, body: unknown, token?: string): Promise<J> =>
  (await fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })).json() as Promise<J>;
const get = async (path: string, token?: string): Promise<J> =>
  (await fetch(base + path, { headers: token ? { authorization: `Bearer ${token}` } : {} })).json() as Promise<J>;

try {
  const reg = await post('/api/auth/register', { username: 'Ben', password: 'hunter22' });
  const tok = String(reg['token']);
  console.log('\n[§1 nothing chosen]');
  let me = (await get('/api/me', tok))['me'] as J;
  eq(me['favoriteElement'], null, 'a fresh account has played nothing');
  eq(me['favoritePicked'], null, 'and chose nothing');

  console.log('\n[§2 choosing]');
  const r = await post('/api/me/favorite', { element: 'dark' }, tok);
  eq(r['favoriteElement'], 'dark', 'the pick is what is shown');
  me = (await get('/api/me', tok))['me'] as J;
  eq(me['favoriteElement'], 'dark', '/api/me shows the chosen element');
  eq(me['favoritePicked'], 'dark', 'and says it was chosen');
  eq(((await get('/api/player?name=Ben'))['player'] as J)['favoriteElement'], 'dark', '/api/player shows it to everyone');
  const board = (await get('/api/players'))['players'] as J[];
  eq(board.find(p => p['username'] === 'Ben')?.['favoriteElement'], 'dark', 'the board shows it');
  await post('/api/me/favorite', { element: 'plasma' }, tok);
  me = (await get('/api/me', tok))['me'] as J;
  eq(me['favoritePicked'], null, 'an element that is not one clears the pick');
  eq(me['favoriteElement'], null, 'back to the one played most');
  eq((await post('/api/me/favorite', { element: 'fire' }))['ok'], false, 'signed out: refused');

  console.log('\n[§3 guests are not on the friends board]');
  const guest = await post('/api/auth/guest', {});
  const gname = String((guest['me'] as J)['username']);
  ok(gname.length > 0, `fixture: a guest ${gname}`);
  const names = ((await get('/api/players'))['players'] as J[]).map(p => p['username']);
  ok(names.includes('Ben'), 'the registered account is on the board');
  ok(!names.includes(gname), 'the unclaimed guest is not');
  await post('/api/auth/claim', { username: 'Claimed', password: 'hunter22' }, String(guest['token']));
  const after = ((await get('/api/players'))['players'] as J[]).map(p => p['username']);
  ok(after.includes('Claimed'), 'once claimed, the same account is on the board');
} finally {
  await server.stop();
  rmSync(SCRATCH, { recursive: true, force: true });
}
console.log(failures === 0 ? '\nALL PASS ✓' : `\n${failures} FAILURES ✗`);
process.exit(failures === 0 ? 0 : 1);
