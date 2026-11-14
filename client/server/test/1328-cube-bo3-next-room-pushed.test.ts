/* docs/25 §8 — A BEST-OF-THREE CUBE MATCH MOVING TO GAME 2 TELLS THE EVENT PAGE.
 *
 * The event page's Play and Watch links are the match's CURRENT room. When game 1 is decided the
 * match moves to a fresh room for game 2; the event's subscribers must be pushed a view naming it
 * (main.ts's `moved` match hook), or the page keeps pointing at the finished room until something
 * else happens to change.
 *
 * Over the wire: two people, no bots, a 10 ms-a-card pick clock (every pick times out, so the
 * draft runs itself), a 100 ms break, Best of 3. Ann concedes game 1; a third person subscribed
 * to the event sees the live match's room change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnServer } from '../e2e/test-util.ts';
import { Client, type Msg } from './cc-wire.ts';

const DIR = mkdtempSync(join(tmpdir(), 'algo-t1328-'));
const env = {
  ALGO_GAMES_DIR: join(DIR, 'games'), ALGO_MATCHES_DIR: join(DIR, 'matches'), ALGO_CUBE_DIR: join(DIR, 'cube'),
  ALGO_ACCOUNTS_FILE: join(DIR, 'accounts.json'), ALGO_ISSUES_FILE: join(DIR, 'issues.jsonl'),
  ALGO_CUBE_PICK_MS_PER_CARD: '10', ALGO_CUBE_BREAK_MS: '100',
};
const A = await import('../accounts.ts');
const restore = A.useAccountsFile(env.ALGO_ACCOUNTS_FILE);
const [ann, bo, cy] = ['Ann', 'Bo', 'Cy'].map(n => {
  const r = A.register(`${n}t1328`, 'correct horse battery');
  if (!r.ok) throw new Error(r.error);
  return { id: r.account.id, token: r.token };
}) as [{ id: string; token: string }, { id: string; token: string }, { id: string; token: string }];
restore();
const server = await spawnServer(env);
const clients: Client[] = [];
test.after(async () => {
  for (const c of clients) c.close();
  await server.stop();
  rmSync(DIR, { recursive: true, force: true });
});
const base = `http://localhost:${server.port}`;
async function api(path: string, token: string, body?: unknown): Promise<Record<string, any>> {
  const r = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const j = await r.json() as Record<string, any>;
  assert.equal(r.status, 200, `${path}: ${JSON.stringify(j)}`);
  return j;
}
const client = async (): Promise<Client> => { const c = new Client(server.port); clients.push(c); await c.open(); return c; };
const until = async (what: string, f: () => Promise<boolean>, ms = 20_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 50));
  }
};

test('⭐ game 1 decided → the event page is pushed game 2\'s room', { timeout: 60_000 }, async () => {
  const code = (await api('/api/cube/new', ann.token, {
    config: { name: 'Bo3 wire', maxPlayers: 2, fillBots: false, bestOf: 3, tournament: 'swiss', swissRounds: 1 },
  }))['code'] as string;
  await api(`/api/cube/${code}/join`, bo.token, {});
  await api(`/api/cube/${code}/start`, ann.token, {});
  await until('the draft to run itself out', async () => (await api(`/api/cube/${code}`, ann.token))['view'].phase === 'building');
  for (const p of [ann, bo]) {
    const s = await api(`/api/cube/${code}/suggest`, p.token, {});
    await api(`/api/cube/${code}/deck`, p.token, { main: s['main'], side: s['side'] });
  }
  await until('round 1 to post', async () => !!(await api(`/api/cube/${code}`, ann.token))['view'].myMatch);

  const watch = await client();
  await watch.ask({ t: 'cube', op: 'sub', code, token: cy.token }, m => m.t === 'cube' && !!m['view']);
  const room1 = (await api(`/api/cube/${code}/play`, ann.token, {}))['room'] as string;
  const liveRoom = (m: Msg): string | null => m['view']?.matches?.find((x: { status: string }) => x.status === 'live')?.room ?? null;

  // Ann takes her seat in game 1 and concedes it
  const g = await client();
  const joined = await g.ask({ t: 'join', room: room1, token: ann.token }, m => m.t === 'joined' && m['room'] === room1);
  const mark = watch.msgs.length;
  g.send({ t: 'action', action: { type: 'concede', seat: joined['seat'] } });

  const pushed = await watch.next(m => m.t === 'cube' && !!liveRoom(m) && liveRoom(m) !== room1, mark);
  const room2 = liveRoom(pushed)!;
  assert.notEqual(room2, room1, 'the event page now names game 2\'s room');
  const v = (await api(`/api/cube/${code}`, ann.token))['view'];
  assert.equal(v.myMatch.room, room2, 'and my match is there too');
  assert.equal(v.myMatch.status, 'live', 'a Best of 3 at 0–1 is still live');
});
