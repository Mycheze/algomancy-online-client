/* 1118 — THE DECK'S HOST IN THE BUILDER (BL-65, 2026-11-04) — ui/decks.ts tabletopHost, through the real client.
 *
 *   §1 Edit on the table opens the builder with the pool, the count pill and a Deck info button;
 *      the pill's What's wrong lists the Competitive problem too
 *   §2 Deck info: a side sheet with the name, the cover, the description and who can see it;
 *      a cover tap saves; the description editor keeps its draft across a repaint and saves it;
 *      Esc closes the sheet
 *   §3 Back lands on the Decks page, on that deck
 *   §4 + New deck and a successful Import open the builder straight away, the import with its note
 *      in the builder's note row
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 40);
const D = {
  id: 'd1118', name: 'Host deck', cards: N.slice(0, 15).flatMap(n => [n, n]), maybe: [], sideboard: N.slice(20, 28),
  cover: null, author: 'you', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', problems: [], ccProblems: [],
  description: 'Old words.', record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
};
const NEW = { ...D, id: 'dNew', name: 'New deck', cards: [], sideboard: [], description: '' };
const IMP = { ...D, id: 'dImp', name: 'Imported', cards: N.slice(0, 14).flatMap(n => [n, n]), sideboard: [], description: '' };
let list: unknown[] = [D];
const POSTS: { url: string; body: Record<string, unknown> }[] = [];
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't1118' };
g['__UI_DRIVER_FETCH'] = async (url: string, init?: { body?: string }) => {
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: list }) };
  if (init?.body) POSTS.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
  if (url === '/api/decks/create') { list = [...list, NEW]; return { status: 200, json: async () => ({ ok: true, decks: list, id: 'dNew' }) }; }
  if (url === '/api/decks/import') {
    list = [...list, IMP];
    return { status: 200, json: async () => ({ ok: true, decks: list, id: 'dImp', note: 'Imported 28 cards; 2 short of 30.' }) };
  }
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const dk = await import('../decks.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
await flush();
ui.click({ btn: 'deck-openpage' });
await flush();

/** a stand-in for a text box the driver does not type into: getElementById answers it with this value */
const realGet = (document as unknown as { getElementById: (id: string) => unknown }).getElementById;
function withBox<T>(id: string, value: string, fn: () => T): T {
  const doc = document as unknown as { getElementById: (id: string) => unknown };
  doc.getElementById = (x: string) => (x === id ? { id, value, focus: () => {} } : realGet(x));
  try { return fn(); } finally { doc.getElementById = realGet; }
}
const sheetOf = (html: string): string => /data-dk-sheet="(\w+)"/.exec(html)?.[1] ?? '';

test('§1 the builder: the pool, the count pill, Deck info; What\'s wrong says the Competitive problem', () => {
  const html = ui.click({ btn: 'deck-tabletop' });
  assert.match(html, /class="[^"]*\bttpage"/, 'the builder');
  assert.match(html, /data-btn="tt-add" data-tt-src="binder\|/, 'with the pool over the table (pool: true)');
  assert.match(html, /data-btn="tt-close"[\s\S]*?<span class="ui-icon-button__label">Decks<\/span>/, 'Back says where it goes');
  assert.match(html, /<button class="ui-button ui-button--ghost tttitlebtn" data-btn="deck-settings"/, 'the name opens Deck info');
  assert.match(html, /<div class="frametools"><button class="ui-icon-button ui-icon-button--stack" data-btn="deck-settings"[\s\S]*?Deck info</,
    'and so does the host\'s own tool, first in the toolbar');
  assert.match(html, /class="[^"]*ttpill ttpill--warn"[^>]*data-btn="tt-problems"[^>]*>30 cards</, '30 cards, amber: legal, not Competitive');
  const why = ui.click({ btn: 'tt-problems' });
  assert.match(why, /Competitive: a sideboard holds at most 7 cards \(got 8\)/);
  ui.click({ btn: 'tt-sheet-close' });
  // the pill itself, for the other shapes
  assert.deepEqual(dk.tabletopHostFor('d1118')!.pill!().problems, ['Competitive: a sideboard holds at most 7 cards (got 8)']);
});

test('§2 Deck info: name, cover, description, who can see it — a side sheet', () => {
  let html = ui.click({ btn: 'deck-settings' });
  const info = /<div class="ui-sheet ui-sheet--side ui-sheet--md dksheet dkinfo" id="dk-info" data-sheet data-dk-sheet="info">[\s\S]*$/.exec(html)?.[0] ?? '';
  assert.ok(info, 'Deck info is a side sheet');
  assert.match(info, /<input class="ui-field__control"[^>]*id="dk-name"[^>]*value="Host deck"/);
  assert.match(info, /data-btn="deck-cover-random"/);
  assert.equal([...info.matchAll(/data-btn="deck-cover" data-card=/g)].length, 15, 'every distinct card, to pick the cover from');
  assert.match(info, /Old words\./);
  assert.match(info, /data-btn="deck-desc-edit"/);
  assert.match(info, /data-btn="deck-visibility"[^>]*data-visibility="public"/);
  assert.match(info, /data-btn="copylink"/);
  assert.match(info, /data-btn="deck-settings-close"/);
  // a cover tap saves, and the sheet stays up
  html = ui.click({ btn: 'deck-cover', card: N[3]! });
  assert.match(html, new RegExp(`class="dkcovertile on" aria-pressed="true" type="button" data-btn="deck-cover" data-card="${N[3]}"`));
  ui.tick();
  assert.equal(POSTS.filter(p => p.url === '/api/decks/update').at(-1)?.body['cover'], N[3]);
  // the editor: its draft survives a repaint (the syntax note), and Save keeps it
  html = ui.click({ btn: 'deck-desc-edit' });
  assert.match(html, /<textarea class="ui-field__control"[^>]*id="dk-desc"[^>]*>Old words\.<\/textarea>/);
  html = withBox('dk-desc', 'New words, half typed', () => ui.click({ btn: 'deck-desc-syntax' }));
  assert.match(html, /Description syntax/);
  assert.match(html, /id="dk-desc"[^>]*>New words, half typed<\/textarea>/, 'the draft is state, not markup');
  // the box still holds what was typed when Save is pressed, as a browser's does
  html = withBox('dk-desc', 'New words, half typed', () => ui.click({ btn: 'deck-desc-save' }));
  assert.match(html, /New words, half typed/);
  assert.doesNotMatch(html, /id="dk-desc"/, 'the editor closed');
  ui.tick();
  assert.equal(POSTS.filter(p => p.url === '/api/decks/update').at(-1)?.body['description'], 'New words, half typed');
  // Esc closes it
  html = ui.key('Escape');
  assert.equal(sheetOf(html), '', 'Esc closes Deck info');
  assert.match(html, /ttpage/, 'and leaves the builder up');
});

test('§3 Back lands on the Decks page, on that deck', () => {
  const html = ui.click({ btn: 'tt-close' });
  assert.match(html, /class="[^"]*apppage[^"]*deckpage"/);
  assert.match(html, /<h2 class="dkprevname">Host deck<\/h2>/);
  assert.match(html, /New words, half typed/, 'with the description it was given');
});

test('§4 + New deck and Import open the builder straight away', async () => {
  ui.click({ btn: 'deck-new' });
  await flush();
  let html = ui.html();
  assert.match(html, /class="[^"]*\bttpage"/, 'a new deck opens on the table');
  assert.match(html, /tttitlebtn" data-btn="deck-settings"[^>]*><span class="tttitlename">New deck<\/span>/);
  ui.click({ btn: 'tt-close' });
  html = ui.click({ btn: 'deck-import-open' });
  assert.equal(sheetOf(html), 'import');
  withBox('dk-text', '2 Ignis Sprite', () => ui.click({ btn: 'deck-import-text' }));
  assert.deepEqual(POSTS.filter(p => p.url === '/api/decks/import').map(p => p.body), [{ text: '2 Ignis Sprite' }]);
  await flush();
  html = ui.html();
  assert.match(html, /class="[^"]*\bttpage"/, 'the import opens on the table');
  assert.match(html, /tttitlebtn" data-btn="deck-settings"[^>]*><span class="tttitlename">Imported<\/span>/);
  assert.match(html, /<div class="ttnote" role="status">Imported 28 cards; 2 short of 30\.<\/div>/,
    'the import\'s note is in the builder\'s note row');
  const host = dk.tabletopHostFor('dImp')!;
  assert.equal(host.note?.(), 'Imported 28 cards; 2 short of 30.', 'its note is the host\'s, for the builder\'s note row');
});
