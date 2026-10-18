/* Game invites between friends, and the bell (run: node test-invites.ts).
 *
 * Owner, 2026-10-18: make a room, see your friends (online first), click one
 * and they get a popup that joins them; a bell counts invites and friend
 * requests. server/inbox.ts + api-inbox.ts.
 *
 *   §1 a poll of /api/inbox is a sighting: a friend who polled is online,
 *      one who never did is offline; signed out is a 401
 *   §2 in a room, the friends list carries per-friend invite state (none yet)
 *   §3 refused: a stranger, a room you are not in, signed out
 *   §4 an invite lands in the friend's inbox with the room, the OTHER seat and
 *      the room's mode and label; the sender's panel says "sent"
 *   §5 the sender leaving hides it; coming back shows it again
 *   §6 a decline hides it and the sender sees "declined"; asking again re-sends
 *   §7 Join answers the invite: gone at once, before the friend has even sat
 *      down (and any other invite to the same room with it); once seated,
 *      another is refused
 *   §8 a dealt game shows its players as "playing"
 *   §9 an incoming friend request is in the bell's list
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintRoom, spawnServer } from './test-util.ts';

const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-invite-test-'));
let failures = 0;
function ok(cond: unknown, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
const eq = (got: unknown, want: unknown, label: string): void =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

const server = await spawnServer({ ALGO_ACCOUNTS_FILE: join(SCRATCH, 'accounts.json'), ALGO_GAMES_DIR: join(SCRATCH, 'games'), ALGO_ISSUES_FILE: join(SCRATCH, 'issues.jsonl') });
const base = `http://localhost:${server.port}`;
type J = Record<string, any>;
const post = async (path: string, body: unknown, token?: string): Promise<J> =>
  (await fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })).json() as Promise<J>;
const inbox = async (token: string, room = ''): Promise<J> =>
  (await fetch(`${base}/api/inbox${room ? `?room=${room}` : ''}`, { headers: { authorization: `Bearer ${token}` } })).json() as Promise<J>;
const settle = (ms = 400): Promise<void> => new Promise(r => setTimeout(r, ms));

class Client {
  ws = new WebSocket(`ws://localhost:${server.port}`);
  msgs: J[] = [];
  async open(): Promise<void> {
    await new Promise<void>(res => {
      this.ws.addEventListener('message', ev => this.msgs.push(JSON.parse(String((ev as MessageEvent).data))));
      this.ws.addEventListener('open', () => res(), { once: true });
    });
  }
  send(o: unknown): void { this.ws.send(JSON.stringify(o)); }
  close(): void { this.ws.close(); }
}

const sockets: Client[] = [];
try {
  const ben = String((await post('/api/auth/register', { username: 'Ben', password: 'hunter22' }))['token']);
  const rashi = String((await post('/api/auth/register', { username: 'Rashi', password: 'hunter22' }))['token']);
  const mo = String((await post('/api/auth/register', { username: 'Mo', password: 'hunter22' }))['token']);
  await post('/api/friends/request', { username: 'Rashi' }, ben);
  const rashiId = String(((await post('/api/friends/request', { username: 'Ben' }, rashi))['me'] as J)['id']);
  const moId = String(((await (await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${mo}` } })).json() as J)['me'] as J)['id']);

  console.log('\n[§1 presence]');
  eq((await fetch(`${base}/api/inbox`)).status, 401, 'signed out: 401');
  let b = await inbox(ben);
  eq(b['friends'].map((f: J) => [f.username, f.status]), [['Rashi', 'offline']], 'a friend who has not polled is offline');
  await inbox(rashi);
  b = await inbox(ben);
  eq(b['friends'].map((f: J) => [f.username, f.status]), [['Rashi', 'online']], 'one who has polled is online');
  eq(b['invites'], [], 'nothing waiting');

  console.log('\n[§2 a room]');
  const room = await mintRoom(server.port);
  const bs = new Client(); sockets.push(bs); await bs.open();
  bs.send({ t: 'join', room, seat: 0, mode: 'draft', token: ben });
  await settle();
  b = await inbox(ben, room);
  eq(b['friends'][0]?.invite, null, 'the panel shows Rashi, not yet invited');

  console.log('\n[§3 refusals]');
  ok(!(await post('/api/invite', { to: moId, room }, ben))['ok'], 'a stranger cannot be invited');
  const elsewhere = await mintRoom(server.port);
  ok(!(await post('/api/invite', { to: rashiId, room: elsewhere }, ben))['ok'], 'nor into a room you are not in');
  ok(!(await post('/api/invite', { to: rashiId, room })).ok, 'nor signed out');
  eq((await inbox(rashi))['invites'], [], 'none of those reached Rashi');

  console.log('\n[§4 an invite]');
  eq((await post('/api/invite', { to: rashiId, room }, ben))['ok'], true, 'Ben invites Rashi');
  eq((await inbox(ben, room))['friends'][0]?.invite, 'sent', 'Ben sees "sent"');
  let r = await inbox(rashi);
  const inv = r['invites'][0] ?? {};
  eq([r['invites'].length, inv.from, inv.room, inv.seat, inv.mode, inv.label], [1, 'Ben', room, 1, 'draft', 'Live draft'],
    'Rashi has one invite: from Ben, this room, the other seat, its mode and label');
  eq((await inbox(mo))['invites'], [], 'Mo has none');

  console.log('\n[§5 the sender leaves]');
  bs.close();
  await settle();
  eq((await inbox(rashi))['invites'], [], 'with Ben gone the invite is hidden');
  const bs2 = new Client(); sockets.push(bs2); await bs2.open();
  bs2.send({ t: 'join', room, seat: 0, mode: 'draft', token: ben });
  await settle();
  eq((await inbox(rashi))['invites'].length, 1, 'and back when he is');

  console.log('\n[§6 decline, ask again]');
  await post('/api/invite/decline', { id: inv.id }, rashi);
  eq((await inbox(rashi))['invites'], [], 'declined: gone from Rashi\'s bell');
  eq((await inbox(ben, room))['friends'][0]?.invite, 'declined', 'Ben sees "declined"');
  await post('/api/invite', { to: rashiId, room }, ben);
  r = await inbox(rashi);
  eq(r['invites'].length, 1, 'asking again sends a new one');

  console.log('\n[§7 join]');
  await post('/api/invite/accept', { id: r['invites'][0].id }, mo);
  eq((await inbox(rashi))['invites'].length, 1, 'somebody else cannot take Rashi\'s invite up');
  await post('/api/invite/accept', { id: r['invites'][0].id }, rashi);
  eq((await inbox(rashi))['invites'], [], 'Join: gone at once, before Rashi has sat down');
  const rs = new Client(); sockets.push(rs); await rs.open();
  rs.send({ t: 'join', room, seat: r['invites'][0].seat, mode: r['invites'][0].mode, token: rashi });
  await settle();
  eq((await inbox(rashi))['invites'], [], 'once seated the invite is gone');
  const again = await post('/api/invite', { to: rashiId, room }, ben);
  ok(!again['ok'] && /other seat|already in/.test(String(again['error'])), `and another is refused (${again['error']})`);

  console.log('\n[§8 playing]');
  bs2.send({ t: 'lobby', submission: { element: 'fire' }, lock: true });
  rs.send({ t: 'lobby', submission: { element: 'dark' }, lock: true });
  await settle(700);
  ok(rs.msgs.some(m => m.t === 'joined' && m.view), 'the game is dealt');
  eq((await inbox(ben))['friends'].map((f: J) => f.status), ['playing'], 'Rashi reads as in a game');

  console.log('\n[§9 friend requests]');
  await post('/api/friends/request', { username: 'Ben' }, mo);
  eq((await inbox(ben))['requests'].map((q: J) => q.username), ['Mo'], 'Mo\'s request is in Ben\'s bell');
} finally {
  for (const s of sockets) s.close();
  await server.stop();
  rmSync(SCRATCH, { recursive: true, force: true });
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall invite checks passed');
