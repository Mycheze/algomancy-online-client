/* 1162 — THE BROWSER'S CHOSEN DECK FOLLOWS THE COLLECTION (owner, 2026-11-07).
 *
 * *"Some users have complained about editing decks and then not seeing those
 * edits in their next constructed match with the deck."* "Play this deck"
 * stores a COPY of the list in this browser (ui/util.ts chooseDeck, key
 * `algoDeck`); the home screen and the waiting room show it and every join
 * sends it. The server now deals a saved deck from the collection (server
 * test 1161); this is the other half — when the collection loads, a chosen
 * deck that is in it is brought up to date, so what the browser shows and
 * sends is the list as edited (on this device or any other).
 *
 *   §1 ⭐ a stale copy of a saved deck is replaced by the collection's list
 *   §2 a chosen deck that is not in the collection (a default, a paste) is left alone
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 40);
const OLD = N.slice(0, 15).flatMap(n => [n, n]);
const NOW = [...OLD.slice(2), N[20]!, N[21]!];
const base = { maybe: [], sideboard: [] as string[], cover: null, author: 'you', createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-07T00:00:00Z', problems: [], ccProblems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null } };
const A = { ...base, id: 'dA', name: 'Alpha, tuned', cards: NOW };

const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = {
  algoToken: 't1162',
  // pressed "Play this deck" before the edit
  algoDeck: JSON.stringify({ id: 'dA', name: 'Alpha', author: 'you', cards: OLD }),
};
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: [A] }) };
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const chosen = (): { id?: string; name: string; cards: string[] } =>
  JSON.parse(localStorage.getItem('algoDeck') ?? 'null') as { id?: string; name: string; cards: string[] };

test('§1 ⭐ once the collection is loaded, the chosen deck is the list as edited', async () => {
  await flush();
  ui.click({ btn: 'deck-openpage' });
  await flush();
  assert.deepEqual(chosen().cards, NOW, 'the browser brings the edited list, not the one it copied');
  assert.equal(chosen().name, 'Alpha, tuned', 'under its current name');
  assert.equal(chosen().id, 'dA');
});

test('§2 a chosen deck that is not in the collection is left alone', async () => {
  const pasted = { name: 'Pasted', author: 'someone', cards: OLD };
  localStorage.setItem('algoDeck', JSON.stringify(pasted));
  ui.click({ btn: 'deck-refresh' });   // the collection is fetched again
  await flush();
  assert.deepEqual(chosen(), pasted);
});
