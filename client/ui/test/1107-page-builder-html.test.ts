/* 1107 · THE BUILDER PAGE (pages/builder.ts builderHtml) — DOM-free, from made-up views.
 *
 *   §1 in the app frame: `ttpage` last on the root (report.ts, the drag
 *      provider), bleed + fill, Back is `tt-close`
 *   §2 the toolbar: the name (its own button when the host gives one), the
 *      count pill (a button to What's wrong when something is), the host's
 *      tools, then Undo, Redo (disabled when spent), Stats
 *   §3 the order down the page: the note, the pool, the divider (▲ grip ▼),
 *      the table with its head (+ Pile, Re-sort), the stats strip (tt-stats)
 *   §4 sheets are side sheets with tt-sheet-close; the host's sheet is drawn after
 *   §5 no pool: no divider, `ttnopool`; read-only: no Undo / Redo / Stats
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { builderHtml, builderLoadingHtml, type BuilderView } from '../pages/builder.ts';
import type { PoolView } from '../pages/pool.ts';

const POOL: PoolView = {
  query: '', chips: [{ group: 'mana', value: '2', label: '2', on: false }], active: false, total: 1,
  tiles: [{ name: 'Ignis Sprite', inDeck: 1, inSide: 0, atCap: false, over: false }],
  cap: 2, target: 'deck', targets: ['deck', 'side', 'maybe'], scrollKey: 'tt-pool|',
};
const V: BuilderView = {
  title: 'Ember <Rush>', titleBtn: 'deck-settings', backLabel: 'Decks',
  pill: { text: '27 / 30', tone: 'warn', problems: ['3 cards short'] }, stripHtml: '',
  hostToolsHtml: '<!--SLOT:tools-->', canUndo: true, canRedo: false, stats: true,
  note: 'Max 2 of Ignis Sprite.', pool: POOL, split: 0.4,
  head: { label: 'Main deck', count: 27, tools: true },
  table: { cw: 108, ch: 150, piles: [], newPiles: { emptyText: 'x' } },
  statsStripHtml: '<!--SLOT:strip-->', sheet: null, hostSheetHtml: '<!--SLOT:sheet-->', readOnly: false,
  chrome: { signedIn: true, alerts: 0 },
};

test('§1 in the frame, ttpage last', () => {
  const html = builderHtml(V);
  assert.match(html, /^<div class="ui-app-shell ui-app-shell--contained ui-app-shell--fill apppage framebleed ttpage"/);
  assert.match(html, /data-btn="tt-close"[^>]*>[\s\S]*?Decks</, 'Back, captioned by the host');
  assert.match(builderLoadingHtml(V.chrome), /apppage ttpage"[\s\S]*Setting out the table/);
});

test('§2 the toolbar', () => {
  const html = builderHtml(V);
  const top = html.slice(0, html.indexOf('<main'));
  assert.match(top, /data-btn="deck-settings"[^>]*><span class="tttitlename">Ember &lt;Rush&gt;<\/span><svg/, 'the name opens Deck info, escaped');
  assert.match(top, /data-btn="tt-problems"[^>]*>27 \/ 30</, 'the pill opens What’s wrong');
  assert.match(top, /class="[^"]*ttpill--warn/);
  const order = ['<!--SLOT:tools-->', 'data-btn="tt-undo"', 'data-btn="tt-redo"', 'data-btn="tt-stats"', 'data-help="rules"'].map(s => top.indexOf(s));
  assert.ok(order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1]!)), `host tools, Undo, Redo, Stats, then the shared tools: ${order}`);
  assert.doesNotMatch(top, /data-btn="tt-undo"[^>]*disabled/, 'Undo on');
  assert.match(top, /data-btn="tt-redo"[^>]*disabled/, 'Redo spent');
  const legal = builderHtml({ ...V, pill: { text: '30 cards · legal', tone: 'ok', problems: [] } });
  assert.doesNotMatch(legal, /tt-problems/, 'nothing wrong: the pill is not a button');
  assert.match(legal, /30 cards · legal/);
});

test('§3 the page, top to bottom', () => {
  const html = builderHtml(V);
  const at = (s: string): number => html.indexOf(s);
  const order = ['class="ttnote"', 'class="ttpool"', 'class="ttdivider"', 'class="tttablewrap', 'class="ttstatsstrip"', '<!--SLOT:sheet-->'].map(at);
  assert.ok(order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1]!)), `note, pool, divider, table, strip, host sheet: ${order}`);
  assert.match(html, /<div class="ttbuilder" style="--pool-f:0.4">/);
  assert.match(html, /data-btn="tt-split"[^>]*data-by="-1"[\s\S]*data-tt-grip[\s\S]*data-btn="tt-split"[^>]*data-by="1"/);
  assert.match(html, /class="ttheadlabel">Main deck<\/span><b class="ttheadcount">27<\/b>/);
  assert.match(html, /data-btn="tt-addpile"[\s\S]*<details class="ttresort">[\s\S]*data-btn="tt-resort"[^>]*data-tt-by="type"/);
  assert.match(html, /<div class="ttstatsstrip"><!--SLOT:strip--><\/div>/, "the strip is its own button (pages/deckstats.ts)");
  assert.match(html, /<div class="ttnote" role="status">Max 2 of Ignis Sprite\.<\/div>/);
});

test('§4 sheets: side, dismissed by tt-sheet-close', () => {
  const html = builderHtml({ ...V, sheet: { kind: 'problems', title: 'What’s wrong', bodyHtml: '<ul><li>x</li></ul>' } });
  assert.match(html, /class="ui-sheet ui-sheet--side[^"]*"[^>]*data-tt-sheet="problems"/);
  assert.match(html, /ui-sheet__scrim" data-btn="tt-sheet-close"/);
  assert.ok(html.indexOf('ui-sheet--side') < html.indexOf('<!--SLOT:sheet-->'), 'the host’s own sheet after');
});

test('§5 no pool; read-only', () => {
  const np = builderHtml({ ...V, pool: null });
  assert.match(np, /class="ttbuilder ttnopool"/);
  assert.doesNotMatch(np, /ttdivider|ttpool"/);
  const ro = builderHtml({ ...V, readOnly: true });
  assert.doesNotMatch(ro, /tt-undo|tt-redo|data-btn="tt-stats"[^>]*><span class="ui-icon/);
});
