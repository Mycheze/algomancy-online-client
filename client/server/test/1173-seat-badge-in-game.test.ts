/* BL-17 — "An account can hold a badge level and it is visible on their
 * profile and in game."
 *
 * The profile has shown the badge since the first slice (2026-09-05); a game
 * said nothing about who was sitting there. Every game push now carries
 * `badges`: each seat's mark, read off the seat's ACCOUNT (server/main.ts
 * seatBadges), and the board draws the profile's chip beside the name
 * (ui/test/1174).
 *
 *   §1 both seats and a spectator are told: [null, {judge: 2}] — the mark
 *      only, never the date it was set
 *   §2 a game where nobody is badged carries no `badges` field at all, so an
 *      ordinary payload is what it was
 *
 * Drives the real server over raw WebSockets with its own accounts file, like
 * the cc-wire tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnServer, mintRoom } from '../e2e/test-util.ts';
import { Client, type Msg } from './cc-wire.ts';

const DIR = mkdtempSync(join(tmpdir(), 'algo-seatbadge-'));
const env = {
  ALGO_GAMES_DIR: join(DIR, 'games'), ALGO_MATCHES_DIR: join(DIR, 'matches'),
  ALGO_ACCOUNTS_FILE: join(DIR, 'accounts.json'), ALGO_ISSUES_FILE: join(DIR, 'issues.jsonl'),
};
const A = await import('../accounts.ts');
const restore = A.useAccountsFile(env.ALGO_ACCOUNTS_FILE);
const people = ['Plain', 'Judge', 'Other', 'Guest'].map(n => {
  const r = A.register(`${n}1173`, 'correct horse battery');
  if (!r.ok) throw new Error(r.error);
  return r;
});
A.setBadge(people[1]!.account, { judge: 2 });
restore();

const server = await spawnServer(env);
const clients: Client[] = [];
const client = async (): Promise<Client> => { const c = new Client(server.port); clients.push(c); await c.open(); return c; };
const game = (m: Msg): boolean => (m.t === 'joined' || m.t === 'update' || m.t === 'watching') && !!m['view'];

async function seat(tokens: [string, string]): Promise<{ code: string; a: Client; b: Client; ja: Msg; jb: Msg }> {
  const code = await mintRoom(server.port);
  const a = await client(), b = await client();
  a.send({ t: 'join', room: code, seat: 0, name: 'a', token: tokens[0] });
  await a.next(m => m.t === 'joined');
  const mark = a.msgs.length;
  b.send({ t: 'join', room: code, seat: 1, name: 'b', token: tokens[1] });
  const jb = await b.next(game);
  const ja = await a.next(game, mark).catch(() => a.msgs.filter(game).at(-1)!);
  return { code, a, b, ja, jb };
}

test.after(async () => { for (const c of clients) c.close(); await server.stop(); });

test('1173 §1: both seats and a spectator see the judge badge of the seat that has one, the mark only', async () => {
  const { code, ja, jb } = await seat([people[0]!.token, people[1]!.token]);
  const want = [null, { judge: 2 }];
  assert.deepEqual(jb['badges'], want, 'the judge\'s own seat');
  assert.deepEqual(ja['badges'], want, 'the opponent');
  const w = await client();
  w.send({ t: 'watch', room: code, token: people[3]!.token });
  const seen = await w.next(game);
  assert.deepEqual(seen['badges'], want, 'a spectator');
});

test('1173 §2: a game where nobody is badged carries no badges field', async () => {
  const { ja, jb } = await seat([people[0]!.token, people[2]!.token]);
  assert.ok(!('badges' in ja) && !('badges' in jb), `got ${JSON.stringify(ja['badges'])} / ${JSON.stringify(jb['badges'])}`);
});
