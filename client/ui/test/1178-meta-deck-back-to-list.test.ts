/* 1178 — A SHARED DECK'S BACK BUTTON GOES BACK TO THE LIST (inbox-1568909425371127962).
 *
 * The owner, 2026-11-08: "When viewing a deck in the Metagame, after you click
 * into it, there's no "back" button. There's just a button to go back "Home".
 * But I usually want to just go back to the whole list."
 *
 * The deck page's top-left button was meta-close (Home) like every other
 * metagame view. It is now Back → the published-deck list, scrolled to where
 * the list was when the deck was opened. ui/meta.ts, driven through the real
 * client; the markup of each case is 981 §3b.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 16);
const deck = (id: string, name: string) => ({
  id, name, cards: N.flatMap(n => [n, n]), cover: null, author: 'someone',
  visibility: 'public', owner: { id: 'u1', username: 'someone' },
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', problems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null }, copies: 0,
});
const DECKS = [deck('p1178a', 'First list deck'), deck('p1178b', 'Second list deck')];
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url.startsWith('/api/deck/meta')) return { status: 200, json: async () => ({ ok: true, decks: DECKS, minGames: 0 }) };
  if (url.startsWith('/api/deck/shared')) return { status: 200, json: async () => ({ ok: true, deck: DECKS[1] }) };
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

/** the list's scrolling region, as the page would have it: one box that keeps
 * its scrollTop (the driver's page answers every querySelector with null) */
const listBox = { scrollTop: 0 };
const doc = g['document'] as { querySelector: (s: string) => unknown };
const realQuery = doc.querySelector;
doc.querySelector = (s: string) => (s === '[data-scroll="meta-decks"]' && /data-scroll="meta-decks"/.test(ui.html()) ? listBox : realQuery(s));

const backBtn = (html: string): string =>
  /<(?:button|a)\b[^>]*\bframeback\b[^>]*data-btn="([^"]*)"/.exec(html)?.[1]
  ?? /<(?:button|a)\b[^>]*data-btn="([^"]*)"[^>]*\bframeback\b/.exec(html)?.[1] ?? '';

test('1178 a deck opened off the metagame list has Back, which returns to the list where it was', async () => {
  await flush();
  let html = ui.click({ btn: 'meta-openpage' });
  await flush();
  html = ui.html();
  assert.match(html, /Second list deck/, 'positive control: the list is up');
  assert.equal(backBtn(html), 'meta-close', 'the list itself goes Home');

  listBox.scrollTop = 640;                     // scrolled down the list to the deck
  ui.click({ btn: 'meta-open', id: 'p1178b' });
  await flush();
  html = ui.html();
  assert.match(html, /<h1 class="frametitle">Second list deck/, 'the deck is open');
  assert.equal(backBtn(html), 'meta-list', 'its top-left button is Back to the list, not Home');
  assert.match(html, /<span class="ui-icon-button__label">Back<\/span>/);

  listBox.scrollTop = 0;                       // the list's region was rebuilt under the deck page
  html = ui.click({ btn: 'meta-list' });
  assert.match(html, /<div class="framelist" data-scroll="meta-decks">/, 'Back is the list again');
  assert.match(html, /First list deck[\s\S]*Second list deck/, 'the whole list');
  assert.equal(listBox.scrollTop, 640, 'scrolled to where it was when the deck was opened');
});

test('1178 the list opened fresh from Home starts at the top', async () => {
  ui.click({ btn: 'meta-close' });
  listBox.scrollTop = 0;
  ui.click({ btn: 'meta-openpage' });
  await flush();
  assert.equal(listBox.scrollTop, 0, 'no remembered place from an earlier visit');
  assert.equal(backBtn(ui.html()), 'meta-close');
});
