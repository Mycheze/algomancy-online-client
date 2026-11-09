/* 1187 — A COPY OF SOMEBODY'S SHARED DECK IS "BY" THEM, NEVER BY AN ID (CT-541, report #355).
 *
 * mycheze, 2026-11-08: "When you copy a deck that someone else made and play
 * it, it says \"Deck name copy - by _____\" but instead of their name, it's a
 * UUID string of nonsense."
 *
 * Taking a copy (/api/decks/take → duplicateDeck with the shared source)
 * copied the source's free-text `author` verbatim: 'you' on a deck its owner
 * built (so the copy named nobody), or whatever id had come in from outside.
 * Now a taken copy is by the source's named builder when it has one, and
 * otherwise by the account that shared it. Duplicating your OWN deck is
 * unchanged. The display side (every "by …" label refusing an id) is
 * ui/test/1188.
 *
 *  §1 a copy of a deck its owner built is by the owner's username
 *  §2 a copy of a deck whose author is an id is by the owner's username
 *  §3 a copy keeps a named outside builder (an algomancer.cc import)
 *  §4 duplicating your own deck keeps 'you'
 *  §5 the route passes the publisher: api-decks hands duplicateDeck the shared owner
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register, useAccountsFile } from '../accounts.ts';
import { createDeck, duplicateDeck, updateDeck } from '../collection.ts';
import { sharedDeck, sourceDeck } from '../publicdecks.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const root = mkdtempSync(join(tmpdir(), 'algo-1187-'));
const restoreAccounts = useAccountsFile(join(root, 'accounts.json'));
test.after(() => { restoreAccounts(); rmSync(root, { recursive: true, force: true }); });

const who = (name: string) => {
  const r = register(name, 'a good password');
  if (!r.ok) throw new Error(r.error);
  return r.account;
};
const owner = who('Publisher1187');
const taker = who('Borrower1187');
const MAIN = DECK_LIST.slice(0, 30);

/** publish a deck of `owner`'s with this author, and take a copy as the route does */
const takeOf = (author: string | undefined, url?: string) => {
  const made = createDeck(owner, { name: `deck ${author}`, cards: MAIN, ...(author ? { author } : {}), ...(url ? { url } : {}) });
  if (!made.ok) throw new Error(made.error);
  updateDeck(owner, made.deck.id, { visibility: 'public' });
  const shared = sharedDeck(made.deck.id);
  assert.ok(shared, 'the deck is shared');
  const r = duplicateDeck(taker, made.deck.id, sourceDeck(made.deck.id)!, shared.owner.username);
  assert.ok(r.ok);
  return r.deck;
};

test('§1 a copy of a deck its owner built is by the owner, not "you"', () => {
  assert.equal(takeOf(undefined).author, 'Publisher1187');
});

test('§2 a copy of a deck whose author is an id is by the owner, not the id', () => {
  assert.equal(takeOf('d72d0675-355f-44ca-beee-6f1ebfb5dcc1').author, 'Publisher1187');
  assert.equal(takeOf('5f1b2c3d4e5f60718293a4b5').author, 'Publisher1187');
});

test('§3 a copy keeps a named outside builder', () => {
  assert.equal(takeOf('aramsunat', 'https://www.algomancer.cc/decks/x').author, 'aramsunat');
});

test('§4 duplicating your own deck keeps "you"', () => {
  const made = createDeck(taker, { name: 'mine 1187', cards: MAIN });
  assert.ok(made.ok);
  const r = duplicateDeck(taker, made.deck.id);
  assert.ok(r.ok);
  assert.equal(r.deck.author, 'you');
});

test('§5 the take route hands duplicateDeck the shared deck\'s owner', () => {
  const src = readFileSync(new URL('../api-decks.ts', import.meta.url), 'utf8');
  assert.match(src, /duplicateDeck\(account, id, src, shared\.owner\.username\)/);
});
