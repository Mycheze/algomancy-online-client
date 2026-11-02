/* A SHARED DECK SHOWS ITS SIDEBOARD AND NEVER ITS SWAPS (docs/22 §4.3).
 *
 * The sideboard is part of the list, so the share link, the profile shelf and
 * the meta page show it. The swap presets are the owner's own plans for a
 * match: they are in no public view, under any name, and a copy taken of
 * somebody else's deck has none — while a copy of your own keeps them (812).
 *
 *  §1 sharedDeck, publicDecksOf and metaList carry the sideboard
 *  §2 none of them carries the swaps — not the field, not a preset name
 *  §3 take (duplicateDeck with the shared source) copies the side, not the swaps
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register, useAccountsFile } from '../accounts.ts';
import { createDeck, duplicateDeck, updateDeck } from '../collection.ts';
import { metaList, publicDecksOf, sharedDeck, sourceDeck } from '../publicdecks.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const root = mkdtempSync(join(tmpdir(), 'algo-813-'));
const restoreAccounts = useAccountsFile(join(root, 'accounts.json'));
test.after(() => { restoreAccounts(); rmSync(root, { recursive: true, force: true }); });

const who = (name: string) => {
  const r = register(name, 'a good password');
  if (!r.ok) throw new Error(r.error);
  return r.account;
};
const owner = who('Publisher');
const taker = who('Borrower');

const MAIN = DECK_LIST.slice(0, 30);
const SIDE = DECK_LIST.slice(30, 37);
const SECRET = 'my secret plan vs Bena';

const made = createDeck(owner, { name: 'shared one', cards: MAIN, sideboard: SIDE });
if (!made.ok) throw new Error(made.error);
const ID = made.deck.id;
updateDeck(owner, ID, { visibility: 'public', swaps: [{ id: 'p1', name: SECRET, out: [MAIN[0]], in: [SIDE[0]] }] });

const views = () => [
  ['sharedDeck', sharedDeck(ID)],
  ['publicDecksOf', publicDecksOf(owner.id).find(d => d.id === ID)],
  ['metaList', metaList({ minGames: 0 }).find(d => d.id === ID)],
] as const;

test('§1 every public view of a deck carries its sideboard', () => {
  for (const [where, v] of views()) {
    assert.ok(v, `${where} lists the deck`);
    assert.deepEqual(v.sideboard, SIDE, `${where} shows the sideboard`);
  }
});

test('§2 no public view carries the swaps under any name', () => {
  for (const [where, v] of views()) {
    assert.ok(!('swaps' in v!), `${where} has no swaps field`);
    assert.ok(!JSON.stringify(v).includes(SECRET), `${where} leaks a preset name`);
  }
});

test('§3 taking a copy brings the sideboard and none of the swaps', () => {
  const r = duplicateDeck(taker, ID, sourceDeck(ID)!);
  assert.ok(r.ok);
  assert.deepEqual(r.deck.sideboard, SIDE);
  assert.ok(!('swaps' in r.deck), 'somebody else\'s plans stay theirs');
});
