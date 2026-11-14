/* docs/25 §9 — A CUBE EVENT OVER THE WIRE: the real server, HTTP and the room-less socket.
 *
 *   §1 the HTTP gates: signed out 401, an unknown code 404, a host-only op 403; new → join → mine
 *   §2 ⭐ the socket: `sub` answers with my view; Start pushes the draft to every subscriber, each
 *      its own pack (never another seat's picks); `reserve` and `pick` over the socket move my view
 *   §3 the event's code is a taken code: a game join with it is refused (one code space), and
 *      GET /api/cube/<code> and the bell answer for it
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnServer } from '../e2e/test-util.ts';
import { Client, type Msg } from './cc-wire.ts';

const DIR = mkdtempSync(join(tmpdir(), 'algo-t1326-'));
const env = {
  ALGO_GAMES_DIR: join(DIR, 'games'), ALGO_MATCHES_DIR: join(DIR, 'matches'), ALGO_CUBE_DIR: join(DIR, 'cube'),
  ALGO_ACCOUNTS_FILE: join(DIR, 'accounts.json'), ALGO_ISSUES_FILE: join(DIR, 'issues.jsonl'),
};
const A = await import('../accounts.ts');
const restore = A.useAccountsFile(env.ALGO_ACCOUNTS_FILE);
const people = ['Ann', 'Bo', 'Cy'].map(n => {
  const r = A.register(`${n}t1326`, 'correct horse battery');
  if (!r.ok) throw new Error(r.error);
  return { id: r.account.id, token: r.token };
});
restore();
const server = await spawnServer(env);
const clients: Client[] = [];
test.after(async () => {
  for (const c of clients) c.close();
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
const client = async (): Promise<Client> => { const c = new Client(server.port); clients.push(c); await c.open(); return c; };
const [ann, bo, cy] = people as [typeof people[0], typeof people[0], typeof people[0]];
let CODE = '';

test('§1 the HTTP gates; new, join, mine', async () => {
  assert.equal((await api('/api/cube/new', null, { config: {} })).status, 401, 'signed out');
  const made = await api('/api/cube/new', ann.token, { config: { name: 'Wire cube', maxPlayers: 4 } });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  CODE = made.body['code'];
  assert.match(CODE, /^[A-Z0-9]{4,5}$/);
  assert.equal(made.body['view'].isHost, true);
  assert.equal((await api('/api/cube/ZZZZQ/join', bo.token, {})).status, 404, 'no such event');
  const j = await api(`/api/cube/${CODE}/join`, bo.token, {});
  assert.equal(j.status, 200);
  assert.equal(j.body['view'].joined, true);
  assert.equal((await api(`/api/cube/${CODE}/start`, bo.token, {})).status, 403, 'not the host');
  const mine = await api('/api/cube/mine', bo.token);
  assert.deepEqual(mine.body['events'].map((e: { code: string }) => e.code), [CODE]);
  const bad = await api('/api/cube/new', ann.token, { config: { source: { kind: 'list', text: 'Nonsense Card' } } });
  assert.equal(bad.status, 400);
  assert.match(bad.body['error'], /Nonsense Card/);
});

test('§2 ⭐ the socket: sub, the pushed draft, reserve and pick', async () => {
  const a = await client(), b = await client(), watcher = await client();
  const va = await a.ask({ t: 'cube', op: 'sub', code: CODE, token: ann.token }, m => m.t === 'cube' && !!m['view']);
  assert.equal(va['view'].phase, 'lobby');
  assert.equal(va['view'].me, ann.id);
  await b.ask({ t: 'cube', op: 'sub', code: CODE.toLowerCase(), token: bo.token }, m => m.t === 'cube' && !!m['view']);
  const vw = await watcher.ask({ t: 'cube', op: 'sub', code: CODE, token: cy.token }, m => m.t === 'cube' && !!m['view']);
  assert.equal(vw['view'].joined, false, 'a signed-in stranger may look');
  const markA = a.msgs.length, markB = b.msgs.length;
  const st = await api(`/api/cube/${CODE}/start`, ann.token, {});
  assert.equal(st.status, 200, JSON.stringify(st.body));
  const isDraft = (m: Msg): boolean => m.t === 'cube' && m['view']?.phase === 'drafting';
  const da = (await a.next(isDraft, markA))['view'];
  const db = (await b.next(isDraft, markB))['view'];
  assert.equal(da.draft.pack.length, 15, '4 seats (2 bots): 3 packs of 15');
  assert.equal(da.draft.seats.length, 4);
  assert.notDeepEqual(da.draft.pack, db.draft.pack, 'each its own pack');
  assert.equal((await watcher.next(isDraft))['view'].draft, null, 'a stranger sees no pack');
  // reserve: my view says so
  const card = da.draft.pack[2] as string;
  const rv = await a.ask({ t: 'cube', op: 'reserve', card }, m => m.t === 'cube' && m['view']?.draft?.reserved === card);
  assert.equal(rv['view'].draft.reserved, card);
  // pick: my picks grow; the pick is mine alone
  const pk = await a.ask({ t: 'cube', op: 'pick', card }, m => m.t === 'cube' && m['view']?.draft?.picks?.length === 1);
  assert.deepEqual(pk['view'].draft.picks, [card]);
  const bAfter = await b.next(m => m.t === 'cube' && m['view']?.draft?.seats?.some((s: { picks: number }) => s.picks === 1), markB);
  assert.deepEqual(bAfter['view'].draft.picks, [], 'Bo never sees Ann\'s picks');
  const wrong = await a.ask({ t: 'cube', op: 'pick', card: 'Not In The Pack' }, m => m.t === 'cube' && !!m['error']);
  assert.ok(wrong['error']);
  const out = await watcher.ask({ t: 'cube', op: 'pick', card }, m => m.t === 'cube' && !!m['error']);
  assert.match(out['error'], /seat/, 'a stranger cannot pick');
});

test('§3 one code space; the reload view; the bell', async () => {
  const c = await client();
  const j = await c.ask({ t: 'join', room: CODE, seat: 0, mode: 'shared', token: cy.token }, m => m.t === 'error');
  assert.ok(j['msg'], 'a game join with an event code is refused');
  const g = await api(`/api/cube/${CODE}`, bo.token);
  assert.equal(g.body['view'].phase, 'drafting');
  assert.equal(g.body['view'].draft.pack !== undefined, true);
  const inbox = await api('/api/inbox', bo.token);
  assert.ok(inbox.body['cube'].some((n: { kind: string; event: string }) => n.kind === 'starting' && n.event === CODE),
    'the bell: the draft is starting');
  await api('/api/inbox/read', bo.token, { cubeUpTo: Date.now() + 1000 });
  const again = await api('/api/inbox', bo.token);
  assert.ok(again.body['cube'].every((n: { read: boolean }) => n.read), 'read');
});
