/* THE BINDER IS A LAYER (ui/binder.ts), driven through ui/main.ts.
 *
 * The binder docked beside the tabletop has to survive every #app repaint the
 * table makes — that is the whole reason it is not markup inside the page.
 * So, through the real client on the real tabletop:
 *
 *   §1 it is a body layer, installed at boot beside the report layer, and it
 *      is up for as long as the table is
 *   §2 it survives a #app repaint byte-identical, query and all
 *   §3 it speaks `data-dd`, never the board's button attribute, and has no
 *      board scrim (269 counts that class across ui/, comments included)
 *   §4 its + adds ONE copy, and each tile says how many are in the deck
 *   §5 the panel is a drop zone that means "take it out"
 *   §6 Escape unpins the pinned card and leaves the page alone
 *   §7 it fetches nothing, books no timers, and holds the deck-legal pool
 *   §8 a mouse click on a table card pins that card here, to read
 *
 * Seeds: none. The deck is real cards, served by the driver's fetch seam.
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
  id: 'd537', name: 'Binder deck', cards: ['Ignis Sprite', 'Ignis Sprite', 'Good Whale'], maybe: [], cover: null,
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

/** the binder's own markup, as the layer holds it */
const binderOf = (html: string): string => {
  const at = html.indexOf('<div class="ddscrim"');
  return at < 0 ? '' : html.slice(at, html.indexOf('</aside>', at) + 8);
};
const strip = (h: string): string => /class="cbdeckcount">(\d+) cards?</.exec(h)?.[1] ?? '';

await flush();
ui.click({ btn: 'deck-openpage' });
await flush();
const SINCE = FETCHED.length;

test('§1 a body layer, up with the table and only with it', () => {
  assert.equal(binderOf(ui.html()), '', 'the deck page has no binder');
  const html = ui.click({ btn: 'deck-tabletop' });
  assert.match(html, /<div class="ttpage"/);
  assert.match(binderOf(html), /class="ddpanel/, 'the table docks it');
  assert.match(code('binder.ts'), /document\.body\.appendChild\(layer\)/);
  assert.match(code('main.ts'), /installReport\(reportOpenChanged\);[\s\S]{0,40}installBinder\(\);/,
    'installed at boot, beside the report layer');
  assert.match(code('binder.ts'), /new MutationObserver\(\(\) => \{\s*if \(host && !onTabletop\(\)\) closeBinder\(\);/,
    'and it goes when #app becomes another page');
});

test('§2 a #app repaint leaves it byte-identical, query and all', () => {
  ui.click({ dd: 'chip', key: 'kind', value: 'unit' });
  const binder = binderOf(ui.html());
  assert.match(binder, /id="dd-search"[^>]*value="kind:unit"/, 'the chip wrote the query');
  const before = ui.html();
  const after = ui.click({ btn: 'tt-resort', 'tt-by': 'type' });
  assert.notEqual(after.slice(0, 2000), before.slice(0, 2000), 'the page did repaint');
  assert.equal(binderOf(after), binder, 'and the binder did not change');
  ui.click({ btn: 'tt-undo' });
  ui.click({ dd: 'clear' });
});

test('§3 data-dd, never data-btn, and no board scrim', () => {
  const binder = binderOf(ui.html());
  assert.ok(binder.length > 500);
  assert.doesNotMatch(binder, /data-btn=/, 'main.ts sends every data-btn to the board’s handler');
  assert.doesNotMatch(binder, /class="overlay/, 'the board’s scrim class means “close the top board dialog”');
  assert.match(binder, /class="ddscrim"/, 'its own scrim, for the bottom sheet');
  assert.doesNotMatch(code('binder.ts'), /data-btn/);
});

test('§4 + adds one copy; each tile says how many are in the deck', () => {
  const tileOf = (h: string, card: string): string => {
    const b = binderOf(h);
    const at = b.indexOf(`data-card="${card}" data-tt-src=`);
    return b.slice(b.lastIndexOf('<div class="dktile', at), b.indexOf('</span>\n    </span>', at));
  };
  let html = ui.html();
  assert.equal(strip(html), '3');
  const card = /data-dd="add" data-card="([^"]+)"/.exec(binderOf(html))![1]!;
  html = ui.click({ dd: 'add', card });
  assert.equal(strip(html), '4', 'one copy, not two');
  assert.match(tileOf(html, card), /×1</, 'the binder says how many are in now');
  assert.match(html, new RegExp(`class="ttcard[^"]*"[^>]*data-card="${card}"`), 'and it is on the table');
  // the deck's own cards, by the "in deck" chip
  html = ui.click({ dd: 'chip', key: 'in', value: 'deck' });
  assert.match(tileOf(html, 'Ignis Sprite'), /×2</);
  assert.match(tileOf(html, 'Good Whale'), /×1</);
});

test('§5 the panel is the drop zone that takes a card out', () => {
  const binder = binderOf(ui.html());
  assert.match(binder, /<aside class="ddpanel[^"]*" data-tt-zone="binder"/);
  assert.match(binder, /class="ddremove"[^>]*>Drop to remove</, 'it says so, while a card is over it');
  assert.match(binder, /data-tt-src="binder\|/, 'and every tile is a drag source');
});

test('§6 Escape unpins, and the page stays', () => {
  let html = ui.click({ dd: 'pin', card: 'Good Whale' });
  assert.match(binderOf(html), /class="ddpinbox"[\s\S]*Good Whale/, 'a tile click pins it');
  html = ui.key('Escape');
  assert.doesNotMatch(binderOf(html), /class="ddpinbox"/, 'Escape unpins');
  html = ui.key('Escape');
  assert.match(html, /<div class="ttpage"/, 'and the page is not a dialog: Escape never closes it');
  ui.click({ dd: 'clear' });
});

test('§7 no fetch, no timers, the deck-legal pool, and the full browser one press away', () => {
  assert.deepEqual(FETCHED.slice(SINCE).filter(u => !u.startsWith('/api/decks')), [],
    'since the table opened: no request but the deck page’s own saves');
  assert.doesNotMatch(code('binder.ts'), /\bfetch\(/, 'the pool is in the bundle; the binder never fetches');
  assert.doesNotMatch(code('binder.ts'), /setTimeout|setInterval/, 'and books no timers (a headless suite would hang on one)');
  assert.match(code('binder.ts'), /allRows\(\)\.filter\(r => r\.playable\)/);
  assert.match(binderOf(ui.html()), /data-dd="browse"/);
});

test('§8 a mouse click on a table card pins it in the binder', () => {
  const src = /data-tt-src="(pile\|[^"]*Good Whale)"/.exec(ui.html())![1]!;
  const html = ui.click({ 'tt-src': src });
  assert.match(binderOf(html), /class="ddpinbox"[\s\S]*Good Whale/, 'the card is up to read');
  assert.doesNotMatch(html, /class="ttselbar"/, 'and a mouse click picked nothing up');
});
