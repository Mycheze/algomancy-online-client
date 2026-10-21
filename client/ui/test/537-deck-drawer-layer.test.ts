/* THE CARD DRAWER IS A LAYER (ui/deckdrawer.ts), driven through ui/main.ts.
 *
 * The drawer the deck table opens has to survive every #app repaint the
 * table makes — that is the whole reason it is not markup inside the page
 * (the inline drawer needed `anchorTop` and two jump fixes to stay usable).
 * So, through the real client on the real deck page:
 *
 *   §1 it is a body layer, and opening it repaints nothing in #app
 *   §2 it survives a #app repaint byte-identical, with its query
 *   §3 it speaks `data-dd`, never the board's button attribute, and has no
 *      board scrim (269 counts that class across ui/, comments included)
 *   §4 a + in it adds ONE copy, through the table (the deck page's strip moves)
 *   §5 Escape closes it before the page's own Escape (which puts a picked-up
 *      card down) — and the page's still works once it is shut
 *   §6 it fetches nothing, ever, and offers the full browser
 *   §7 its pool is the deck-legal subset, the 212 wording
 *
 * Seeds: none. The deck is two real cards, served by the driver's fetch seam.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (f: string): string => readFileSync(join(UI, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const DECK = {
  id: 'd537', name: 'Table deck', cards: ['Ignis Sprite', 'Ignis Sprite', 'Good Whale'], maybe: [], cover: null,
  author: 'you', createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z', problems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
};
const FETCHED: string[] = [];
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't537' };
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  FETCHED.push(url);
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: [DECK] }) };
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

/** the drawer's own markup, as the layer holds it */
const drawerOf = (html: string): string => {
  const at = html.indexOf('<div class="ddscrim"');
  return at < 0 ? '' : html.slice(at, html.indexOf('</aside>', at) + 8);
};

await flush();
ui.click({ btn: 'deck-openpage' });
await flush();
/** what the page had fetched before the drawer was ever opened */
const SINCE = FETCHED.length;

test('§1 the drawer is a body layer, and opening it does not repaint the page', () => {
  const before = ui.html();
  assert.match(before, /class="dtable/, 'the deck page is up, with its table');
  assert.equal(drawerOf(before), '', 'closed to begin with');
  const app = before.slice(0, before.indexOf('<div class="ddscrim"') < 0 ? undefined : before.indexOf('<div class="ddscrim"'));
  const html = ui.click({ btn: 'deck-table', dt: 'drawer' });
  assert.match(drawerOf(html), /class="ddpanel/, 'the + Add cards button opens it');
  assert.ok(html.startsWith(app.slice(0, 200)), 'the page under it was not rewritten');
  assert.match(code('deckdrawer.ts'), /document\.body\.appendChild\(layer\)/);
  assert.match(code('main.ts'), /installReport\(reportOpenChanged\);\s*installDeckDrawer\(\);/,
    'installed at boot, beside the report layer');
});

test('§2 a #app repaint leaves it byte-identical, query and all', () => {
  ui.click({ dd: 'chip', key: 'kind', value: 'unit' });
  const drawer = drawerOf(ui.html());
  assert.match(drawer, /id="dd-search"[^>]*value="kind:unit"/, 'the chip wrote the query');
  // the table repaints #app wholesale: a row split, then a card picked up
  ui.click({ btn: 'deck-table', dt: 'split', 'dt-v': 'element' });
  ui.click({ btn: 'deck-table', dt: 'sel', 'dt-src': 'table|Good Whale' });
  const after = ui.html();
  assert.match(after, /class="dtselbar"/, 'the page did repaint');
  assert.equal(drawerOf(after), drawer, 'and the drawer did not');
  ui.click({ btn: 'deck-table', dt: 'clear' });
  ui.click({ btn: 'deck-table', dt: 'split', 'dt-v': 'type' });
});

test('§3 data-dd, never data-btn, and no board scrim', () => {
  const drawer = drawerOf(ui.html());
  assert.ok(drawer.length > 500);
  assert.doesNotMatch(drawer, /data-btn=/, 'main.ts sends every data-btn to the board’s handler');
  assert.match(drawer, /data-dd="close"/);
  assert.doesNotMatch(drawer, /class="overlay/, 'the board’s scrim class means “close the top board dialog”');
  assert.match(drawer, /class="ddscrim"/, 'its own scrim, for the bottom sheet');
  assert.doesNotMatch(code('deckdrawer.ts'), /data-btn/);
});

test('§4 a + in the drawer adds one copy, through the table', () => {
  ui.click({ dd: 'clear' });
  const strip = (h: string): string => /class="cbdeckcount">(\d+) cards?</.exec(h)?.[1] ?? '';
  assert.equal(strip(ui.html()), '3');
  const card = /data-dd="add" data-card="([^"]+)"/.exec(drawerOf(ui.html()))![1]!;
  ui.click({ dd: 'add', card });
  let html = ui.html();
  assert.equal(strip(html), '4', 'one copy, not two');
  const tileOf = (h: string): string => {
    const d = drawerOf(h);
    const at = d.indexOf(`data-prev="${card}"`);
    return d.slice(d.lastIndexOf('<div class="dktile', at), d.indexOf('</span>\n  </div>', at));
  };
  assert.match(tileOf(html), /×1</, 'the drawer says how many are in now');
  ui.click({ dd: 'add', card });
  html = ui.html();
  assert.equal(strip(html), '5');
  assert.match(tileOf(html), /dktile ddtile atcap/, 'at two it greys, where you are shopping');
  assert.doesNotMatch(tileOf(html), /data-dd="add"/, 'and offers no third');
});

test('§5 Escape closes the drawer first, then puts the card down', () => {
  ui.click({ btn: 'deck-table', dt: 'sel', 'dt-src': 'table|Ignis Sprite' });
  assert.match(ui.html(), /class="dtselbar"/);
  let html = ui.key('Escape');
  assert.equal(drawerOf(html), '', 'the drawer took the first Escape');
  assert.match(html, /class="dtselbar"/, 'and the page did not hear it');
  html = ui.key('Escape');
  assert.doesNotMatch(html, /class="dtselbar"/, 'the second puts the card down');
});

test('§6 it fetches nothing, and offers the full browser', () => {
  assert.deepEqual(FETCHED.slice(SINCE).filter(u => !u.startsWith('/api/decks')), [],
    'since the drawer opened: no request but the deck page’s own saves');
  assert.doesNotMatch(code('deckdrawer.ts'), /\bfetch\(/, 'the pool is in the bundle; the drawer never fetches');
  assert.doesNotMatch(code('deckdrawer.ts'), /setTimeout|setInterval/, 'and books no timers (a headless suite would hang on one)');
  const html = ui.click({ btn: 'deck-table', dt: 'drawer' });
  assert.match(drawerOf(html), /data-dd="browse"/, 'the full browser, one press away');
});

test('§7 the pool is the deck-legal subset', () => {
  assert.match(code('deckdrawer.ts'), /allRows\(\)\.filter\(r => r\.playable\)/);
});
