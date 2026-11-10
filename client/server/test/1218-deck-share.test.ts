/* 1218 — SENDING A DECK TO A FRIEND (owner, #steward 2026-11-10).
 *
 * "I want a way to easily share a deck (inside the webapp) to a friend. When
 * you're on the deck sharing page, there should be way to, basically, send
 * them a notification that they can click on to view the deck you want them
 * to see." server/deckshare.ts keeps the sent deck on the friend's account;
 * the bell (GET /api/inbox `decks`) lists it with the deck's live name; View
 * or Dismiss clears it. The screens are ui/test/1219.
 *
 *  §1 a friend's Send lands in their bell, through the routes, and clearing it empties it
 *  §2 only a friend, only your own deck, never a private one
 *  §3 the line follows the deck: renamed, made private (hidden, not lost), deleted
 *  §4 sending the same deck again is one line, not two; the bell keeps at most DECK_SHARE_CAP
 *  §5 it outlives a restart: the store is written and read back
 *  §6 an ex-friend's sends are not shown
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  acceptFriend, accountById, accountForToken, loadAccounts, register, removeFriend, requestFriend, useAccountsFile,
  type Account,
} from '../accounts.ts';
import { createDeck, deleteDeck, updateDeck } from '../collection.ts';
import { DECK_SHARE_CAP, clearDeckShare, deckSharesFor, sendDeck } from '../deckshare.ts';
import { inboxRoutes } from '../api-inbox.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const root = mkdtempSync(join(tmpdir(), 'algo-1218-'));
const restoreAccounts = useAccountsFile(join(root, 'accounts.json'));
test.after(() => { restoreAccounts(); rmSync(root, { recursive: true, force: true }); });

function who(name: string): { account: Account; token: string } {
  const r = register(name, 'a good password');
  if (!r.ok) throw new Error(r.error);
  return { account: r.account, token: r.token };
}
const BEN = who('Sender1218');
const RASHI = who('Friend1218');
const STRANGER = who('Stranger1218');
requestFriend(BEN.account, 'Friend1218');
assert.ok(acceptFriend(RASHI.account, BEN.account.id).ok);

const MAIN = DECK_LIST.slice(0, 30);
function deckOf(a: Account, name: string, visibility: 'private' | 'unlisted' | 'public' = 'unlisted'): string {
  const r = createDeck(a, { name, cards: MAIN });
  if (!r.ok) throw new Error(r.error);
  updateDeck(a, r.deck.id, { visibility });
  return r.deck.id;
}
/** the live account: loadAccounts() replaces every object */
const acct = (x: { account: Account }): Account => accountById(x.account.id)!;

let addrN = 0;
async function call(method: string, path: string, token: string, body?: unknown): Promise<Record<string, unknown>> {
  const text = body === undefined ? '' : JSON.stringify(body);
  const req = Object.assign(Readable.from(text ? [Buffer.from(text)] : []), {
    method, headers: { authorization: `Bearer ${token}` }, socket: { remoteAddress: `10.2.0.${(addrN++ % 200) + 1}` },
  }) as unknown as IncomingMessage;
  let raw = '';
  const res = { writeHead() { return res; }, end(b?: string) { raw = b ?? ''; return res; } } as unknown as ServerResponse;
  const url = new URL(`http://x${path}`);
  assert.equal(await inboxRoutes(req, res, url.pathname, url, {
    online: () => false, playing: () => new Set(), lookup: () => null,
  }), true, `${method} ${path} not handled`);
  return JSON.parse(raw) as Record<string, unknown>;
}

test('§1 a friend\'s Send lands in their bell through the routes; clearing it empties it', async () => {
  const id = deckOf(acct(BEN), 'Tempo Fire');
  assert.deepEqual(await call('POST', '/api/inbox/deck', BEN.token, { to: RASHI.account.id, deck: id }), { ok: true });
  const bell = await call('GET', '/api/inbox', RASHI.token);
  const decks = bell['decks'] as { id: string; from: string; deck: string; name: string }[];
  assert.equal(decks.length, 1);
  assert.equal(decks[0]!.from, 'Sender1218');
  assert.equal(decks[0]!.deck, id, 'the id View opens');
  assert.equal(decks[0]!.name, 'Tempo Fire');
  assert.deepEqual((await call('GET', '/api/inbox', BEN.token))['decks'], [], 'the sender\'s own bell has nothing');
  assert.deepEqual(await call('POST', '/api/inbox/deck/clear', BEN.token, { id: decks[0]!.id }), { ok: true });
  assert.equal(((await call('GET', '/api/inbox', RASHI.token))['decks'] as unknown[]).length, 1, 'only the recipient can clear it');
  await call('POST', '/api/inbox/deck/clear', RASHI.token, { id: decks[0]!.id });
  assert.deepEqual((await call('GET', '/api/inbox', RASHI.token))['decks'], []);
});

test('§2 only to a friend, only your own deck, never a private one', () => {
  const mine = deckOf(acct(BEN), 'Mine');
  const r1 = sendDeck(acct(BEN), STRANGER.account.id, mine);
  assert.equal(r1.ok, false);
  assert.match(!r1.ok ? r1.error : '', /friend/);
  const theirs = deckOf(acct(RASHI), 'Not Ben\'s');
  const r2 = sendDeck(acct(BEN), RASHI.account.id, theirs);
  assert.equal(r2.ok, false, 'a deck id that is not in your collection');
  const secret = deckOf(acct(BEN), 'Secret', 'private');
  const r3 = sendDeck(acct(BEN), RASHI.account.id, secret);
  assert.equal(r3.ok, false);
  assert.match(!r3.ok ? r3.error : '', /private.*Unlisted or Public/);
  assert.deepEqual(deckSharesFor(acct(STRANGER)), []);
  assert.deepEqual(deckSharesFor(acct(RASHI)), []);
});

test('§3 the line follows the deck: renamed, made private (hidden, not lost), deleted', () => {
  const id = deckOf(acct(BEN), 'Before');
  assert.ok(sendDeck(acct(BEN), RASHI.account.id, id).ok);
  updateDeck(acct(BEN), id, { name: 'After' });
  assert.equal(deckSharesFor(acct(RASHI))[0]?.name, 'After', 'the name is read live');
  updateDeck(acct(BEN), id, { visibility: 'private' });
  assert.deepEqual(deckSharesFor(acct(RASHI)), [], 'a private deck cannot be opened, so it is not offered');
  updateDeck(acct(BEN), id, { visibility: 'public' });
  assert.equal(deckSharesFor(acct(RASHI)).length, 1, 'published again, the line is back');
  deleteDeck(acct(BEN), id);
  assert.deepEqual(deckSharesFor(acct(RASHI)), []);
  acct(RASHI).deckShares = [];
});

test('§4 the same deck again is one line, at the top; the bell keeps at most the cap', () => {
  const a = deckOf(acct(BEN), 'Deck A');
  const b = deckOf(acct(BEN), 'Deck B');
  sendDeck(acct(BEN), RASHI.account.id, a, 1000);
  sendDeck(acct(BEN), RASHI.account.id, b, 2000);
  sendDeck(acct(BEN), RASHI.account.id, a, 3000);
  assert.deepEqual(deckSharesFor(acct(RASHI)).map(d => d.name), ['Deck A', 'Deck B']);
  // the cap: the oldest go first
  for (let i = 0; i < DECK_SHARE_CAP + 5; i++) acct(RASHI).deckShares!.push({ id: `x${i}`, from: BEN.account.id, deck: b, at: 4000 + i });
  sendDeck(acct(BEN), RASHI.account.id, a, 9000);
  assert.equal(acct(RASHI).deckShares!.length, DECK_SHARE_CAP);
  assert.equal(acct(RASHI).deckShares!.at(-1)!.deck, a, 'the newest is kept');
  acct(RASHI).deckShares = [];
  for (const d of [a, b]) deleteDeck(acct(BEN), d);
});

test('§5 it outlives a restart', () => {
  const id = deckOf(acct(BEN), 'Kept');
  sendDeck(acct(BEN), RASHI.account.id, id);
  loadAccounts();
  const after = deckSharesFor(accountForToken(RASHI.token)!);
  assert.equal(after.length, 1);
  assert.equal(after[0]!.name, 'Kept');
  clearDeckShare(acct(RASHI), after[0]!.id);
  loadAccounts();
  assert.deepEqual(deckSharesFor(acct(RASHI)), [], 'and so does clearing it');
  deleteDeck(acct(BEN), id);
});

test('§6 an ex-friend\'s sends are not shown', () => {
  const id = deckOf(acct(BEN), 'Parting gift');
  sendDeck(acct(BEN), RASHI.account.id, id);
  assert.equal(deckSharesFor(acct(RASHI)).length, 1);
  removeFriend(acct(RASHI), BEN.account.id);
  assert.deepEqual(deckSharesFor(acct(RASHI)), []);
});
