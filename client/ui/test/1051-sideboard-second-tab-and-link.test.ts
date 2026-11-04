/* 1051 — THE SIDEBOARD IS WHERE PEOPLE LOOK FOR IT (owner, 2026-11-03: "the
 * sideboard should be the second tab AND have a link to that tab from below the
 * main list, where people will normally look for it") — ui/decks.ts, driven
 * through the real client.
 *
 * Rewritten for BL-65 (2026-11-04): the deck page's tabs and the link under its
 * list are gone. The request — the sideboard right beside the main list, never
 * a hunt — is met by the Decks page preview, which counts it on the list's own
 * header, and by the builder, whose rail shows it beside the table always.
 *
 *   §1 the preview's list header: "Main deck n" and, beside it, "Side n/7 · Maybe m"
 *   §2 Edit on the table: the Sideboard pile is on the rail, first, empty or not
 *   §3 no tabs and no saved swaps anywhere on the Decks page (swaps were taken out the same day)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 20);
const DECK = {
  id: 'd1051', name: 'Link deck', cards: N.slice(0, 15).flatMap(n => [n, n]), maybe: [N[16]!], sideboard: [] as string[],
  cover: null, author: 'you', createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z',
  problems: [], ccProblems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
};
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't1051' };
g['__UI_DRIVER_FETCH'] = async (url: string) => url === '/api/decks'
  ? { status: 200, json: async () => ({ ok: true, decks: [DECK] }) }
  : new Promise(() => {});
const { home } = await import('./ui-driver.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
await flush();
ui.click({ btn: 'deck-openpage' });
await flush();

test('§1 the sideboard is counted beside the main list', () => {
  const html = ui.html();
  assert.match(html, /<div class="dkprevlisthead"><span>Main deck 30<\/span><span>Side 0\/7 · Maybe 1<\/span><\/div>/);
  assert.ok(html.indexOf('class="dkprevlisthead"') < html.indexOf('class="dkprevlist"'), 'on the list\'s own header');
});

test('§2 the builder shows the sideboard on its rail, first, even empty', () => {
  const html = ui.click({ btn: 'deck-tabletop' });
  assert.match(html, /<aside class="ttrail"[^>]*><div class="ttrailbox ttrailside"><section class="ttpile ttsidepile"/, 'first on the rail');
  assert.match(html, /class="ttpilecount">0\/7</);
  ui.click({ btn: 'tt-close' });
});

test('§3 no tabs and no saved swaps on the Decks page', () => {
  const html = ui.html();
  assert.doesNotMatch(html, /data-btn="deck-tab"|accttab|dksidelink/, 'no tabs, no link to one');
  assert.doesNotMatch(html, /deck-swap|deck-try|Swaps|Save as a swap/);
});
