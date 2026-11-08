/* 1179 — A SHARED DECK COPIED TO YOUR DECKS IS THERE AT ONCE, OPEN IN THE BUILDER (inbox-1568909829345644666).
 *
 * The owner, 2026-11-08: "When you copy a deck to your collection, from the
 * metagame list (or a deck), it doesn't show up in your deck list until you
 * RELOAD the page (which is bad UX). it should immediately update and be
 * there. Clicking "copy" on the deck should also just skip to opening it in
 * your collection so you can edit and see it."
 *
 * The take's reply always carried the whole collection; ui/meta.ts read only
 * its note, and ui/decks.ts — which loads the collection once — never heard of
 * the copy. Now meta-take hands the reply to decks.ts openTaken: the copy is
 * in the list and the builder opens on it. Driven through the real client.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 15);
const STAMP = { createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' };
const REC = { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null };
const SHARED = {
  id: 'p1179', name: 'Their burn deck', cards: N.flatMap(n => [n, n]), cover: null, author: 'someone',
  visibility: 'public', owner: { id: 'u1', username: 'someone' }, ...STAMP, problems: [], record: REC, copies: 0,
};
const MINE = { id: 'd1179', name: 'My old deck', cards: N.flatMap(n => [n, n]), maybe: [], sideboard: [], cover: null,
  author: 'you', ...STAMP, problems: [], ccProblems: [], record: REC };
const COPY = { ...MINE, id: 'd1179copy', name: 'Their burn deck', author: 'someone' };
let list: unknown[] = [MINE];
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't1179' };
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: list }) };
  if (url.startsWith('/api/deck/meta')) return { status: 200, json: async () => ({ ok: true, decks: [SHARED], minGames: 0 }) };
  if (url.startsWith('/api/deck/shared')) return { status: 200, json: async () => ({ ok: true, deck: SHARED }) };
  if (url === '/api/decks/take') {
    list = [...list, COPY];
    return { status: 200, json: async () => ({ ok: true, decks: list, id: COPY.id, note: 'copied from someone' }) };
  }
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const dk = await import('../decks.ts');
const meta = await import('../meta.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test('1179 Copy to my decks: the copy is in your decks at once, and the builder opens on it', async () => {
  await flush();
  // the collection loaded BEFORE the copy — the state a reload used to be needed to leave
  ui.click({ btn: 'deck-openpage' });
  await flush();
  ui.click({ btn: 'deck-close' });
  assert.deepEqual(dk.playableDecks().map(d => d.id), ['d1179'], 'positive control: the old list');

  ui.click({ btn: 'meta-openpage' });
  await flush();
  ui.click({ btn: 'meta-open', id: 'p1179' });
  await flush();
  assert.match(ui.html(), /data-btn="meta-take"/, 'the shared deck, with Copy to my decks');

  ui.click({ btn: 'meta-take' });
  await flush();
  assert.deepEqual(dk.playableDecks().map(d => d.id), ['d1179', 'd1179copy'], 'the copy is in your decks, no reload');
  const html = ui.html();
  assert.match(html, /class="[^"]*\bttpage"/, 'the builder is open');
  assert.match(html, /Their burn deck/, 'on the copy');
  assert.match(html, /Copied from someone\. It starts private\./, 'with what happened, in its note row');
  assert.equal(meta.screen(), null, 'the metagame page stepped aside');
  assert.equal(location.search.includes('deck='), false, 'and its ?deck= went with it');
});

test('1179 Back from the copy is your Decks page, open on the copy', async () => {
  const html = ui.click({ btn: 'tt-close' });
  assert.doesNotMatch(html, /class="[^"]*\bttpage"/, 'the builder is closed');
  assert.equal(dk.screen(), 'decks');
  assert.match(html, /Their burn deck/);
  assert.match(html, /My old deck/, 'the whole collection');
});
