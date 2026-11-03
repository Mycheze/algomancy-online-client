/* 1051 — THE SIDEBOARD IS THE SECOND TAB, AND THE MAIN LIST LINKS TO IT
 * (owner, 2026-11-03: "the sideboard should be the second tab AND have a link
 * to that tab from below the main list, where people will normally look for
 * it") — ui/decks.ts, driven through the real client.
 *
 *   §1 the tabs: cards, sideboard, then the rest — their data-btns unchanged
 *   §2 under the main list, BEFORE the add-cards row: "Add a sideboard →" on
 *      a deck with none, the same deck-tab button the tab is
 *   §3 it opens the sideboard tab; with cards it reads "Sideboard · n cards →"
 *   §4 no saved swaps anywhere on the deck page (taken out the same day)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 20);
const DECK = {
  id: 'd1051', name: 'Link deck', cards: N.slice(0, 15).flatMap(n => [n, n]), maybe: [], sideboard: [] as string[],
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

const tabs = (html: string): string[] =>
  [...html.matchAll(/class="accttab[^"]*" data-btn="deck-tab" data-tab="(\w+)"/g)].map(m => m[1]!);
const link = (html: string): string => /<div class="dksidelink">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';

test('§1 the sideboard is the second tab', () => {
  assert.deepEqual(tabs(ui.html()), ['cards', 'side', 'mana', 'maybe', 'games']);
});

test('§2 under the main list: Add a sideboard →, the tab\'s own button', () => {
  const html = ui.html();
  const l = link(html);
  assert.ok(l, 'the link is drawn on the cards tab');
  assert.match(l, /data-btn="deck-tab"[^>]*data-tab="side"[^>]*>Add a sideboard →<\/button>/);
  const grid = html.lastIndexOf('class="dkgrid"', html.indexOf('class="dksidelink"'));
  assert.ok(grid >= 0 && grid < html.indexOf('class="dksidelink"'), 'after the main list');
  assert.ok(html.indexOf('class="dksidelink"') < html.indexOf('data-btn="deck-adding"'), 'and before the add-cards row');
});

test('§3 it opens the sideboard tab; with cards it counts them', () => {
  let html = ui.click({ btn: 'deck-tab', tab: 'side' });
  assert.match(html, /<h3>Sideboard <span class="acctcount">0\/7<\/span><\/h3>/, 'the sideboard tab');
  assert.equal(link(html), '', 'the link is the main list\'s, not the sideboard\'s');
  ui.click({ btn: 'deck-tab', tab: 'cards' });
  ui.click({ btn: 'deck-to-side', card: N[0]! });
  html = ui.click({ btn: 'deck-to-side', card: N[1]! });
  assert.match(link(html), />Sideboard · 2 cards →<\/button>/);
  ui.click({ btn: 'deck-tab', tab: 'side' });
  ui.click({ btn: 'deck-from-side', card: N[1]! });
  html = ui.click({ btn: 'deck-tab', tab: 'cards' });
  assert.match(link(html), />Sideboard · 1 card →<\/button>/, 'one card, singular');
});

test('§4 no saved swaps on the deck page', () => {
  for (const t of ['cards', 'side']) {
    const html = ui.click({ btn: 'deck-tab', tab: t });
    assert.doesNotMatch(html, /deck-swap|deck-try|Swaps|Save as a swap/, `none on ${t}`);
  }
});
