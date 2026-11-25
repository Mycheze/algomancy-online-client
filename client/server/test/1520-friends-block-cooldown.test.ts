/* 1520 — FRIENDS: BLOCKING, THE COOLDOWN AFTER A DECLINE, AND WHAT A FRIEND ROW CARRIES.
 *
 * A friend request was the one way a stranger could reach somebody here, and a
 * declined one could be sent straight back. server/accounts.ts now keeps a
 * block list and remembers a decline for REQUEST_COOLDOWN_MS.
 *
 *  §1 a declined request cannot be sent again until the cooldown is up; a cancel or unfriend is not a decline
 *  §2 a block severs every tie, and the blocked player's request looks sent but never arrives
 *  §3 the blocker cannot ask until they unblock; unblocking lets requests through again
 *  §4 a guest neither adds nor is added
 *  §5 the private view: each friend's record against them, the blocked list (never in the public view)
 *  §6 friendshipWith says where two accounts stand (the post-game's Add friend reads it)
 *  §7 the inbox poll tells a friend's game: the room Watch opens and what it is called
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  REQUEST_COOLDOWN_MS, acceptFriend, accountById, blockPlayer, friendshipWith, privateView, publicView, register,
  registerGuest, removeFriend, requestFriend, unblockPlayer, useAccountsFile, type Account,
} from '../accounts.ts';
import { inboxRoutes } from '../api-inbox.ts';

const root = mkdtempSync(join(tmpdir(), 'algo-1520-'));
const restoreAccounts = useAccountsFile(join(root, 'accounts.json'));
test.after(() => { restoreAccounts(); rmSync(root, { recursive: true, force: true }); });

function who(name: string): { account: Account; token: string } {
  const r = register(name, 'a good password');
  if (!r.ok) throw new Error(r.error);
  return { account: r.account, token: r.token };
}
const acct = (x: { account: Account }): Account => accountById(x.account.id)!;
const NOW = Date.parse('2026-11-25T12:00:00Z');

test('§1 a declined request waits out the cooldown; a cancel does not', () => {
  const asker = who('Asker1520'), them = who('Them1520');
  assert.deepEqual(requestFriend(acct(asker), 'Them1520', NOW), { ok: true, friends: false });
  assert.ok(removeFriend(acct(them), asker.account.id, NOW).ok, 'declined');
  assert.equal(acct(them).incoming.length, 0);
  const again = requestFriend(acct(asker), 'Them1520', NOW + 1000);
  assert.equal(again.ok, false);
  assert.match(again.error ?? '', /recently/);
  assert.equal(acct(them).incoming.length, 0, 'and nothing arrived');
  assert.equal(requestFriend(acct(asker), 'Them1520', NOW + REQUEST_COOLDOWN_MS).ok, true, 'a week on, it goes');
  assert.deepEqual(acct(them).incoming, [asker.account.id]);

  // the asker cancelling their own request is not a decline: they may ask again at once
  const other = who('Other1520');
  requestFriend(acct(asker), 'Other1520', NOW);
  removeFriend(acct(asker), other.account.id, NOW);
  assert.equal(requestFriend(acct(asker), 'Other1520', NOW + 1).ok, true);
  // …and nor is an unfriend
  acceptFriend(acct(other), asker.account.id);
  removeFriend(acct(other), asker.account.id, NOW + 2);
  assert.equal(requestFriend(acct(asker), 'Other1520', NOW + 3).ok, true);
});

test('§2 a block severs every tie, and the blocked player\'s request never arrives', () => {
  const ben = who('Ben1520'), pest = who('Pest1520');
  requestFriend(acct(pest), 'Ben1520', NOW);
  acceptFriend(acct(ben), pest.account.id);
  assert.ok(acct(ben).friends.includes(pest.account.id));
  assert.ok(blockPlayer(acct(ben), pest.account.id).ok);
  assert.deepEqual([acct(ben).friends, acct(ben).incoming, acct(ben).outgoing], [[], [], []]);
  assert.deepEqual(acct(pest).friends, [], 'the friendship is gone on both sides');
  assert.deepEqual(acct(ben).blocked, [pest.account.id]);

  assert.deepEqual(requestFriend(acct(pest), 'Ben1520', NOW + 1), { ok: true, friends: false }, 'it looks sent');
  assert.deepEqual(acct(pest).outgoing, [ben.account.id], 'their side shows it waiting');
  assert.deepEqual(acct(ben).incoming, [], 'it never reaches Ben');

  // a request already waiting when the block lands stays waiting on their side, and gone from Ben's
  const asker = who('Waiting1520');
  requestFriend(acct(asker), 'Ben1520', NOW);
  blockPlayer(acct(ben), asker.account.id);
  assert.deepEqual(acct(asker).outgoing, [ben.account.id]);
  assert.ok(!acct(ben).incoming.includes(asker.account.id));
  assert.equal(blockPlayer(acct(ben), ben.account.id).ok, false, 'nobody blocks themselves');
});

test('§3 the blocker cannot ask until they unblock', () => {
  const a = who('Blocker1520'), b = who('Blocked1520');
  blockPlayer(acct(a), b.account.id);
  const r = requestFriend(acct(a), 'Blocked1520', NOW);
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /unblock/);
  assert.ok(unblockPlayer(acct(a), b.account.id).ok);
  assert.equal(acct(a).blocked, undefined, 'an empty list is not stored');
  assert.equal(requestFriend(acct(b), 'Blocker1520', NOW).ok, true);
  assert.deepEqual(acct(a).incoming, [b.account.id], 'their requests arrive again');
});

test('§4 a guest neither adds nor is added', () => {
  const named = who('Named1520');
  const g = registerGuest();
  if (!g.ok) throw new Error(g.error);
  const guest = accountById(g.account.id)!;
  assert.match(requestFriend(acct(named), guest.username, NOW).error ?? '', /guest/);
  assert.match(requestFriend(guest, 'Named1520', NOW).error ?? '', /guest/);
  assert.deepEqual(acct(named).outgoing, []);
});

test('§5 the private view carries each friend\'s record and the blocked list; the public one neither', () => {
  const me = who('Viewer1520'), pal = who('Pal1520'), nope = who('Nope1520');
  requestFriend(acct(me), 'Pal1520', NOW);
  acceptFriend(acct(pal), me.account.id);
  blockPlayer(acct(me), nope.account.id);
  acct(me).profile.opponents[pal.account.id] = { games: 5, wins: 3, losses: 1 };
  const v = privateView(acct(me), () => false);
  assert.deepEqual(v.friends.map(f => [f.username, f.vs]), [['Pal1520', { games: 5, wins: 3, losses: 1 }]]);
  assert.deepEqual(v.blocked, [{ id: nope.account.id, username: 'Nope1520' }]);
  assert.ok(!('blocked' in publicView(acct(me))), 'nobody else learns who you blocked');
  assert.deepEqual(privateView(acct(pal), () => false).friends[0]?.vs, { games: 0, wins: 0, losses: 0 }, 'no games yet: zeros');
});

test('§6 friendshipWith says where two accounts stand', () => {
  const a = who('StandA1520'), b = who('StandB1520');
  assert.equal(friendshipWith(acct(a), acct(b)), 'none');
  requestFriend(acct(a), 'StandB1520', NOW);
  assert.equal(friendshipWith(acct(a), acct(b)), 'asked');
  assert.equal(friendshipWith(acct(b), acct(a)), 'theyAsked');
  acceptFriend(acct(b), a.account.id);
  assert.equal(friendshipWith(acct(a), acct(b)), 'friends');
  blockPlayer(acct(b), a.account.id);
  assert.equal(friendshipWith(acct(b), acct(a)), 'blocked');
});

test('§7 the inbox poll tells a playing friend\'s room and what it is', async () => {
  const me = who('Poller1520'), pal = who('Player1520'), idle = who('Idle1520');
  requestFriend(acct(me), 'Player1520', NOW); acceptFriend(acct(pal), me.account.id);
  requestFriend(acct(me), 'Idle1520', NOW); acceptFriend(acct(idle), me.account.id);
  const req = Object.assign(Readable.from([]), {
    method: 'GET', headers: { authorization: `Bearer ${me.token}` }, socket: { remoteAddress: '10.3.0.1' },
  }) as unknown as IncomingMessage;
  let raw = '';
  const res = { writeHead() { return res; }, end(b?: string) { raw = b ?? ''; return res; } } as unknown as ServerResponse;
  const url = new URL('http://x/api/inbox');
  await inboxRoutes(req, res, url.pathname, url, {
    online: id => id === idle.account.id,
    playing: () => new Map([[pal.account.id, { room: 'WXYZ', label: 'Live draft' }]]),
    lookup: () => null,
  });
  const friends = (JSON.parse(raw) as { friends: { username: string; status: string; game: unknown }[] }).friends;
  assert.deepEqual(friends.map(f => [f.username, f.status, f.game]), [
    ['Idle1520', 'online', null],
    ['Player1520', 'playing', { room: 'WXYZ', label: 'Live draft' }],
  ]);
});

test('§8 every friends list: on the site first (in a game counts), then most games together, then name', async () => {
  const me = who('Sorter1520');
  const names = ['Zed1520', 'Amy1520', 'Bo1520', 'Cy1520', 'Dee1520'];
  const ids = new Map<string, string>();
  for (const n of names) {
    const f = who(n);
    ids.set(n, f.account.id);
    requestFriend(acct(me), n, NOW); acceptFriend(acct(f), me.account.id);
  }
  const games: Record<string, number> = { Zed1520: 9, Amy1520: 1, Bo1520: 5, Cy1520: 5, Dee1520: 0 };
  for (const [n, g] of Object.entries(games)) acct(me).profile.opponents[ids.get(n)!] = { games: g, wins: 0, losses: 0 };
  // Zed is the best friend but offline; Dee is in a game; the rest are online
  const onSite = (id: string): boolean => id !== ids.get('Zed1520');
  const want = ['Bo1520', 'Cy1520', 'Amy1520', 'Dee1520', 'Zed1520'];
  assert.deepEqual(privateView(acct(me), onSite).friends.map(f => f.username), want, 'the profile');

  const req = Object.assign(Readable.from([]), {
    method: 'GET', headers: { authorization: `Bearer ${me.token}` }, socket: { remoteAddress: '10.3.0.2' },
  }) as unknown as IncomingMessage;
  let raw = '';
  const res = { writeHead() { return res; }, end(b?: string) { raw = b ?? ''; return res; } } as unknown as ServerResponse;
  const url = new URL('http://x/api/inbox');
  await inboxRoutes(req, res, url.pathname, url, {
    online: id => onSite(id) && id !== ids.get('Dee1520'),
    playing: () => new Map([[ids.get('Dee1520')!, { room: 'QRST', label: 'Constructed' }]]),
    lookup: () => null,
  });
  assert.deepEqual((JSON.parse(raw) as { friends: { username: string }[] }).friends.map(f => f.username), want,
    'the inbox (a room\'s Invite a friend, the Share sheet)');
});
