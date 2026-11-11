/* 1228 — THE METAGAME'S TWO FILTER BOXES DO NOT LEAK INTO EACH OTHER (BL-63).
 *
 * The Published decks tab searches decks ("name, builder, or a card in it");
 * the Card ladder tab finds a card. Both boxes are `#meta-q`, and ui/meta.ts
 * kept ONE `text` behind them, so a card name typed on the ladder came back as
 * a deck search on the list (hiding every deck without that card), and a deck
 * search came back on the ladder as "No rated card matches that." Each tab now
 * keeps its own text, and the list's Clear clears only the list's.
 *
 * Driven through the real client (ui/test/ui-driver.ts): the box is typed in
 * by its own `oninput`, which pages/meta.ts paintMeta hangs on it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 16);
const deck = (id: string, name: string) => ({
  id, name, cards: N.flatMap(n => [n, n]), cover: null, author: 'someone',
  visibility: 'public', owner: { id: 'u1', username: 'someone' },
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', problems: [],
  record: { games: 3, wins: 2, losses: 1, unresolved: 0, lastPlayed: null }, copies: 0,
});
const DECKS = [deck('p1228a', 'Tempo Fire'), deck('p1228b', 'Slow Water')];
const standing = (card: string, rating: number) => ({ card, rating, games: 9, wins: 5, losses: 4, mirrors: 0 });
const LADDER = { ok: true, cards: [standing('Zz Ladder One', 1520), standing('Zz Ladder Two', 1480)], rankedAfter: 5, duels: 9 };

const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url.startsWith('/api/deck/meta')) return { status: 200, json: async () => ({ ok: true, decks: DECKS, minGames: 0 }) };
  if (url.startsWith('/api/cardladder')) return { status: 200, json: async () => LADDER };
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const doc = g['document'] as { getElementById: (id: string) => Record<string, unknown> | null };

/** type into the page's filter box through the handler paintMeta put on it */
function typeFilter(text: string): string {
  const box = doc.getElementById('meta-q');
  assert.ok(box, 'the filter box is on the page');
  box['value'] = text;
  (box['oninput'] as () => void)();
  return ui.html();
}
const boxValue = (html: string): string => /id="meta-q"[^>]*\bvalue="([^"]*)"/.exec(html.replace(/\n\s*/g, ' '))?.[1] ?? '?';

test('1228 a card typed on the ladder does not filter the published-deck list, and back again', async () => {
  await flush();
  ui.click({ btn: 'meta-openpage' });
  await flush();
  let html = typeFilter('tempo');
  assert.match(html, /Tempo Fire/, 'positive control: the list filters');
  assert.doesNotMatch(html, /Slow Water/, 'positive control: the other deck is filtered out');

  ui.click({ btn: 'meta-ladder' });
  await flush();
  html = ui.html();
  assert.match(html, /Zz Ladder One/, 'the ladder is not filtered by the deck search');
  assert.doesNotMatch(html, /No rated card matches that/);
  assert.equal(boxValue(html), '', 'the ladder\'s box starts empty');

  html = typeFilter('one');
  assert.match(html, /Zz Ladder One/);
  assert.doesNotMatch(html, /Zz Ladder Two/, 'the ladder filters on its own text');

  ui.click({ btn: 'meta-list' });
  await flush();
  html = ui.html();
  assert.equal(boxValue(html), 'tempo', 'the list keeps its own search');
  assert.match(html, /Tempo Fire/);
  assert.doesNotMatch(html, /Slow Water/);

  ui.click({ btn: 'meta-clear' });
  html = ui.html();
  assert.match(html, /Slow Water/, 'Clear empties the list\'s search');
  ui.click({ btn: 'meta-ladder' });
  await flush();
  html = ui.html();
  assert.equal(boxValue(html), 'one', 'the list\'s Clear leaves the ladder\'s box alone');
  assert.doesNotMatch(html, /Zz Ladder Two/);
});
