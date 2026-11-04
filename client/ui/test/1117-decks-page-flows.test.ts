/* 1117 — THE DECKS PAGE, CLICKED (BL-65, 2026-11-04) — ui/decks.ts through the real client.
 *
 *   §1 the page opens on the first deck; a box selects its deck (Q2: the preview, not the builder)
 *   §2 the sort is kept in this browser, and orders the shelf
 *   §3 Share: the visibility saves; Esc closes the sheet
 *   §4 Export: the format, the body from the local copy, and Copy
 *   §5 Delete asks once, in its sheet; Keep it keeps it; Duplicate is one tap
 *   §6 a card in the list opens its panel in a side sheet
 *   §7 Games: the deck's record and its games from the account's history
 *   §8 Play brings the deck; a deck that is not legal cannot be brought
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 40);
const base = { maybe: [], sideboard: [] as string[], cover: null, author: 'you', createdAt: '2026-11-01T00:00:00Z', problems: [], ccProblems: [] };
const A = { ...base, id: 'dA', name: 'Alpha', cards: N.slice(0, 15).flatMap(n => [n, n]), updatedAt: '2026-11-03T00:00:00Z',
  record: { games: 1, wins: 1, losses: 0, unresolved: 0, lastPlayed: null } };
const B = { ...base, id: 'dB', name: 'Beta', cards: N.slice(15, 30).flatMap(n => [n, n]), updatedAt: '2026-11-01T00:00:00Z',
  record: { games: 5, wins: 2, losses: 3, unresolved: 0, lastPlayed: null } };
const C = { ...base, id: 'dC', name: 'Gamma', cards: N.slice(0, 10), updatedAt: '2026-11-02T00:00:00Z',
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null } };
const POSTS: { url: string; body: Record<string, unknown> }[] = [];
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't1117' };
g['__UI_DRIVER_FETCH'] = async (url: string, init?: { body?: string }) => {
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: [A, B, C] }) };
  if (init?.body) POSTS.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
await flush();
ui.click({ btn: 'deck-openpage' });
await flush();

const openName = (html: string): string => /<h2 class="dkprevname">([^<]+)<\/h2>/.exec(html)?.[1] ?? '';
const sheetOf = (html: string): string => /data-dk-sheet="(\w+)"/.exec(html)?.[1] ?? '';
const shelf = (html: string): string[] => [...html.matchAll(/<span class="dkboxname">([^<]+)</g)].map(m => m[1]!);

test('§1 the page opens on a deck; a box selects its deck, the builder waits for Edit', () => {
  let html = ui.html();
  assert.match(html, /class="[^"]*apppage[^"]*deckpage"/, 'the Decks page, in the frame');
  assert.equal(openName(html), 'Alpha');
  html = ui.click({ btn: 'deck-open', id: 'dB' });
  assert.equal(openName(html), 'Beta');
  assert.match(html, /class="dkbox on" type="button" data-btn="deck-open" data-id="dB"/);
  assert.doesNotMatch(html, /ttpage/, 'a tap on a box opens its preview, not the table');
});

test('§2 the sort is kept in this browser and orders the shelf', () => {
  assert.deepEqual(shelf(ui.html()), ['Alpha', 'Gamma', 'Beta'], 'Recent first by default');
  let html = ui.click({ btn: 'deck-sort', sort: 'played' });
  assert.deepEqual(shelf(html), ['Beta', 'Alpha', 'Gamma']);
  assert.equal(localStorage.getItem('algoDeckSort'), 'played');
  html = ui.click({ btn: 'deck-sort', sort: 'name' });
  assert.deepEqual(shelf(html), ['Alpha', 'Beta', 'Gamma']);
  assert.equal(localStorage.getItem('algoDeckSort'), 'name');
});

test('§3 Share: the visibility saves, and Esc closes the sheet', () => {
  ui.click({ btn: 'deck-open', id: 'dA' });
  let html = ui.click({ btn: 'deck-share' });
  assert.equal(sheetOf(html), 'share');
  assert.match(html, /class="ui-segmented__option on" data-btn="deck-visibility"[^>]*data-visibility="private"/);
  html = ui.click({ btn: 'deck-visibility', visibility: 'unlisted' });
  assert.match(html, /class="ui-segmented__option on" data-btn="deck-visibility"[^>]*data-visibility="unlisted"/);
  assert.equal(sheetOf(html), 'share', 'the sheet stays up');
  assert.match(html, /<div class="dkprevmeta">Unlisted ·/, 'the preview says so at once');
  ui.tick();
  const last = POSTS.filter(p => p.url === '/api/decks/update').at(-1);
  assert.equal(last?.body['visibility'], 'unlisted', 'and it is saved');
  html = ui.key('Escape');
  assert.equal(sheetOf(html), '', 'Esc closes it');
});

test('§4 Export: the format, the body, and Copy', () => {
  let html = ui.click({ btn: 'deck-export', format: 'text' });
  assert.equal(sheetOf(html), 'export');
  const text = /<textarea class="dkexporttext"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)![1]!;
  assert.match(text, new RegExp(`2 ${N[0]}`), 'the card list');
  html = ui.click({ btn: 'deck-export', format: 'file' });
  assert.match(/<textarea class="dkexporttext"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)![1]!, /&quot;version&quot;/, 'the deck file');
  // copying hands the textarea over as the selection and does not repaint (214 reads the handler)
  assert.equal(sheetOf(ui.click({ btn: 'deck-copy-list' })), 'export', 'the sheet is still up');
  html = ui.click({ btn: 'deck-export-close' });
  assert.equal(sheetOf(html), '');
});

test('§5 Delete asks once, in its sheet; Duplicate is one tap', () => {
  let html = ui.click({ btn: 'deck-delete' });
  assert.equal(sheetOf(html), 'delete');
  assert.match(html, /“Alpha” and its record go for good/);
  html = ui.click({ btn: 'deck-delete-no' });
  assert.equal(sheetOf(html), '', 'Keep it keeps it');
  assert.ok(!POSTS.some(p => p.url === '/api/decks/delete'));
  ui.click({ btn: 'deck-delete' });
  ui.click({ btn: 'deck-delete-yes' });
  assert.deepEqual(POSTS.filter(p => p.url === '/api/decks/delete').map(p => p.body['id']), ['dA'], 'the second tap deletes');
  ui.click({ btn: 'deck-duplicate' });
  assert.deepEqual(POSTS.filter(p => p.url === '/api/decks/duplicate').map(p => p.body['id']), ['dA']);
});

test('§6 a card in the list opens its panel in a side sheet', () => {
  let html = ui.click({ btn: 'deck-focus', card: N[0]! });
  assert.equal(sheetOf(html), 'card');
  assert.match(html, /class="ui-sheet ui-sheet--side[^"]*" id="dk-card"/);
  assert.match(html, /<section class="cbdetail">/, 'the one card panel (ui/cardpanel.ts)');
  html = ui.click({ btn: 'deck-unfocus' });
  assert.equal(sheetOf(html), '');
});

test('§7 Games: the record, from the deck', () => {
  ui.click({ btn: 'deck-open', id: 'dB' });
  const html = ui.click({ btn: 'deck-games' });
  assert.equal(sheetOf(html), 'games');
  assert.match(html, /<b class="bad">2W–3L<\/b> in 5 games/);
  assert.equal(sheetOf(ui.click({ btn: 'deck-games-close' })), '');
});

test('§8 Play brings the deck; one that is not legal cannot be brought', () => {
  let html = ui.click({ btn: 'deck-play' });
  assert.match(html, /data-btn="deck-play"[^>]*>Playing this ✓</);
  assert.match(html, /“Beta” is the deck you bring to constructed games\./);
  html = ui.click({ btn: 'deck-open', id: 'dC' });
  assert.match(html, /data-btn="deck-play" type="button" title="Not legal yet" disabled/);
  assert.match(html, /<span class="dkboxcount warn"[^>]*>10 \/ 30</, 'its box says how far off it is');
});
