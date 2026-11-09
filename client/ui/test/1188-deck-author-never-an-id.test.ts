/* 1188 — NO "BY …" LABEL EVER PRINTS AN ID (CT-541, report #355).
 *
 * mycheze, 2026-11-08: a copied deck read "Deck name copy - by <a UUID>" in
 * the deck picker. server/test/1187 makes new copies name their publisher;
 * this is the other half: a deck already stored with an id for an author (or
 * one arriving from a deck file or algomancer.cc) shows no author at all
 * rather than the id, on the deck picker, the Decks page and the waiting room.
 *
 *  §1 authorName keeps names and 'you', drops ids
 *  §2 the deck picker: no "— by <id>" in the collection list, an import, the info line
 *  §3 the Decks page preview: no "built by <id>"
 *  §4 the waiting room's locked-in line: no "by <id>"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorName } from '../deckformat.ts';
import { deckPickerHtml, type DeckPickerView } from '../pages/deckpicker.ts';
import { deckPreviewView } from '../pages/decks.ts';
import { readFileSync } from 'node:fs';

const UUID = 'd72d0675-355f-44ca-beee-6f1ebfb5dcc1';

test('§1 authorName keeps names and "you", drops ids', () => {
  for (const name of ['aramsunat', 'Caleb', 'you', 'Bo 2', 'mycheze']) assert.equal(authorName(name), name);
  for (const id of [UUID, UUID.toUpperCase(), '5f1b2c3d4e5f60718293a4b5', 'user_2abcDEFghiJKLmnoPQR', '', '  ', undefined, null]) {
    assert.equal(authorName(id), '', `${String(id)} is not a name`);
  }
});

const pv = (over: Partial<DeckPickerView> = {}): DeckPickerView =>
  ({ current: null, signedIn: false, mine: [], defaults: null, msg: '', ...over });

test('§2 the deck picker never says "by" an id', () => {
  const mine = [{ id: 'd1', name: 'Their burn deck copy', author: UUID, cards: [] },
    { id: 'd2', name: 'B', author: 'Bo', cards: [] }];
  const coll = deckPickerHtml(pv({ signedIn: true, mine, current: mine[0] }));
  assert.match(coll, /<option value="c0" selected>Their burn deck copy<\/option><option value="c1" >B — by Bo<\/option>/);
  assert.ok(!coll.includes(UUID), 'the id is nowhere on the picker');
  const imported = deckPickerHtml(pv({ defaults: [], current: { name: 'Pasted', author: UUID, cards: [] } }));
  assert.match(imported, /<option value="custom" selected>Pasted \(imported\)<\/option>/);
  assert.match(imported, /<div class="deckinfo">0 cards<\/div>/);
  assert.ok(!imported.includes(UUID));
});

test('§3 the Decks page preview never says "built by" an id', () => {
  const d = { id: 'x', name: 'n', cards: [], cover: null, author: UUID, createdAt: '', updatedAt: '' };
  const v = deckPreviewView(d as unknown as Parameters<typeof deckPreviewView>[0]);
  assert.equal(v.author, '');
  const named = deckPreviewView({ ...d, author: 'aramsunat' } as unknown as Parameters<typeof deckPreviewView>[0]);
  assert.equal(named.author, 'built by aramsunat');
});

test('§4 the waiting room\'s "deck is in" line goes through authorName', () => {
  const src = readFileSync(new URL('../pages/waiting.ts', import.meta.url), 'utf8');
  assert.match(src, /esc\(v\.deck\.name\)\}\$\{authorName\(v\.deck\.author\)/);
  assert.doesNotMatch(src, /by \$\{esc\(v\.deck\.author\)\}/);
});
