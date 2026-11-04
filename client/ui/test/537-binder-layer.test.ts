/* THE POOL IN THE BUILDER (pages/pool.ts, ui/tabletop.ts), driven through ui/main.ts.
 *
 * BL-65 (2026-11-04): the binder docked down the right of the tabletop — a
 * layer beside #app with its own `data-dd` clicks — became the POOL, a band
 * across the top of the builder page. It is inside #app now, so what the
 * binder's layer guaranteed by construction (the caret and the query survive
 * every repaint) the pool has to earn: typing repaints only the results, and
 * a full repaint carries the caret (pages/caret.ts) and keeps the query in
 * the controller's state. (This file was 537-binder-layer; the number stays.)
 *
 *   §1 no layer: the pool is in the page, and nothing installs a binder
 *   §2 a repaint keeps the query: a chip writes it, a Re-sort repaints the
 *      page, and the box and the chips still say it; typing repaints only
 *      the results and the chips (source-level — the driver's typing boxes
 *      are the report form's; the caret was checked in a real browser)
 *   §3 it speaks the page's `tt-` buttons; no `data-dd` anywhere
 *   §4 a tap adds ONE copy, and the card says how many; at the cap a tap
 *      refuses and the note says why
 *   §5 the band is the drop zone that means "take it out"
 *   §6 Escape closes a sheet (More filters), and the page stays
 *   §7 it fetches nothing, books no timers, and holds the deck-legal pool
 *   §8 a mouse click on a table card opens its menu; a click on the felt closes it
 *
 * Seeds: none. The deck is real cards, served by the driver's fetch seam.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (f: string): string => readFileSync(join(UI, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const DECK = {
  id: 'd537', name: 'Pool deck', cards: ['Ignis Sprite', 'Ignis Sprite', 'Good Whale'], maybe: [], cover: null,
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

/** the pool's own markup */
const poolOf = (html: string): string => {
  const at = html.indexOf('<section class="ttpool"');
  return at < 0 ? '' : html.slice(at, html.indexOf('</section>', html.indexOf('id="tt-results"', at)) + 10);
};
const deckCount = (html: string): number =>
  [...html.matchAll(/<section class="ttpile[^"]*" data-tt-zone="pile\|[\s\S]*?<\/section>/g)]
    .reduce((n, m) => n + [...m[0].matchAll(/class="ttcard/g)].length, 0);
const tileOf = (html: string, card: string): string => {
  const p = poolOf(html);
  const at = p.indexOf(`data-tt-src="binder|${card}"`);
  return at < 0 ? '' : p.slice(p.lastIndexOf('<div class="ttpooltile', at), p.indexOf('</div>', at) + 6);
};

await flush();
ui.click({ btn: 'deck-openpage' });
await flush();
const SINCE = FETCHED.length;

test('§1 no layer: the pool is in the page', () => {
  assert.equal(poolOf(ui.html()), '', 'the deck page has no pool');
  const html = ui.click({ btn: 'deck-tabletop' });
  assert.match(html, /\bttpage"/);
  const at = html.indexOf('<section class="ttpool"');
  assert.ok(at > 0 && at < html.indexOf('</main>'), 'the pool is inside the page’s main region');
  assert.ok(!existsSync(join(UI, 'binder.ts')), 'ui/binder.ts is gone');
  assert.doesNotMatch(code('main.ts'), /installBinder|binder\.ts/, 'and main.ts installs no binder');
  assert.doesNotMatch(html, /id="binderlayer"|class="ddpanel/);
});

test('§2 a repaint keeps the query; typing repaints the results alone', () => {
  let html = ui.click({ btn: 'tt-chip', group: 'kind', value: 'unit' });
  assert.match(poolOf(html), /<input id="tt-q"[^>]*value="kind:unit"/, 'the chip wrote the query');
  assert.match(poolOf(html), /data-btn="tt-chip"[^>]*aria-pressed="true"[^>]*data-group="kind" data-value="unit"/);
  html = ui.click({ btn: 'tt-resort', 'tt-by': 'type' });
  assert.match(poolOf(html), /<input id="tt-q"[^>]*value="kind:unit"/, 'a full repaint draws the same query');
  ui.click({ btn: 'tt-undo' });
  ui.click({ btn: 'tt-clear' });
  // typing: the controller's input listener paints the results and the chips, never the box
  const tt = code('tabletop.ts');
  assert.match(tt, /if \(!host \|\| box\?\.id !== 'tt-q'\) return;\s*query = box\.value;\s*shown = PAGE;\s*paintPool\(\);/);
  const pool = tt.slice(tt.indexOf('function paintPool('), tt.indexOf('export function focusPool('));
  assert.match(pool, /#tt-results/);
  assert.match(pool, /#tt-chips/);
  assert.doesNotMatch(pool, /#tt-q|paintBuilder|paintFrame/, 'the box is never rebuilt while typed into');
  // a full repaint carries the caret
  assert.match(code('pages/builder.ts'), /const caret = [^;]*caretIn\(CARET_IDS\)[^;]*;\s*paintFrame\(app, noImgDrag\(builderHtml\(v\)\)\);\s*restoreCaret\(caret\);/);
  assert.match(code('pages/builder.ts'), /CARET_IDS = \['tt-q', 'dk-name', 'dk-desc'\]/);
});

test('§3 tt- buttons, never data-dd', () => {
  const pool = poolOf(ui.html());
  assert.ok(pool.length > 500);
  assert.doesNotMatch(ui.html(), /data-dd=/, 'the binder’s attribute is gone');
  assert.match(pool, /data-btn="tt-add"/);
  assert.match(pool, /data-btn="tt-filters"/);
});

test('§4 a tap adds one copy; the card counts; at the cap a tap refuses', () => {
  let html = ui.html();
  assert.equal(deckCount(html), 3);
  const card = /data-btn="tt-add" data-tt-src="binder\|([^"]+)"/.exec(poolOf(html))![1]!;
  html = ui.click({ btn: 'tt-add', 'tt-src': `binder|${card}` });
  assert.equal(deckCount(html), 4, 'one copy, not two');
  assert.match(tileOf(html, card), /class="ttpooln">1</, 'the pool says how many are in now');
  assert.match(html, new RegExp(`class="ttcard[^"]*"[^>]*data-card="${card}"`), 'and it is on the table');
  ui.click({ btn: 'tt-chip', group: 'kind', value: 'unit' });
  ui.click({ btn: 'tt-chip', group: 'el', value: 'fire' });
  html = ui.click({ btn: 'tt-chip', group: 'mana', value: '1' });
  assert.match(tileOf(html, 'Ignis Sprite'), /class="ttpooltile ttcap"[\s\S]*class="ttpooln cap">2\/2</, 'at the cap: dimmed, 2/2');
  html = ui.click({ btn: 'tt-add', 'tt-src': 'binder|Ignis Sprite' });
  assert.equal(deckCount(html), 4, 'a third is refused');
  assert.match(html, /<div class="ttnote" role="status">Max 2 of Ignis Sprite\.<\/div>/);
  ui.click({ btn: 'tt-clear' });
});

test('§5 the band is the drop zone that takes a card out', () => {
  const pool = poolOf(ui.html());
  assert.match(pool, /^<section class="ttpool" data-tt-zone="binder"/);
  assert.match(pool, /class="ttremove"[^>]*>Drop to remove</, 'it says so, while a card is over it');
  assert.match(pool, /data-tt-src="binder\|/, 'and every card is a drag source');
});

test('§6 Escape closes a sheet, and the page stays', () => {
  let html = ui.click({ btn: 'tt-filters' });
  assert.match(html, /data-tt-sheet="filters"/, 'More filters is a sheet');
  assert.match(html, /data-btn="tt-chip" data-key=/, 'holding the full filter list');
  html = ui.key('Escape');
  assert.doesNotMatch(html, /data-tt-sheet=/, 'Escape closes it');
  html = ui.key('Escape');
  assert.match(html, /\bttpage"/, 'and the page is not a dialog: Escape never closes it');
});

test('§7 no fetch, no timers, the deck-legal pool', () => {
  assert.deepEqual(FETCHED.slice(SINCE).filter(u => !u.startsWith('/api/decks')), [],
    'since the table opened: no request but the deck page’s own saves');
  for (const f of ['pages/pool.ts', 'pages/builder.ts', 'pages/table.ts']) {
    assert.doesNotMatch(code(f), /\bfetch\(|setTimeout|setInterval/, `${f}: the pool is in the bundle, and a headless suite would hang on a timer`);
  }
  const pool = code('tabletop.ts').slice(code('tabletop.ts').indexOf('function poolView('));
  assert.match(pool, /allRows\(\)\.filter\(r => r\.playable\)/);
  assert.doesNotMatch(code('tabletop.ts'), /\bfetch\(|setTimeout|setInterval/);
});

test('§8 a mouse click on a table card opens its menu; the felt closes it', () => {
  const src = /data-tt-src="(pile\|[^"]*Good Whale)"/.exec(ui.html())![1]!;
  ui.pointer('pointerdown', { 'tt-src': src }, { pointerType: 'mouse', pointerId: 1, isPrimary: true, button: 0 });
  let html = ui.click({ 'tt-src': src });
  assert.match(html, /<div class="ttpop" role="menu" aria-label="Good Whale"/, 'its menu');
  assert.match(html, /data-btn="tt-details"/, 'with Details, to read it');
  html = ui.click({ btn: 'tt-to', 'tt-zone': 'end' });
  assert.doesNotMatch(html, /class="ttpop"/, 'a click on the felt closes it, and moves nothing');
  assert.equal(deckCount(html), 4);
});
