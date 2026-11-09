/* 1108 · THE POOL (pages/pool.ts) — DOM-free, from made-up views.
 *
 *   §1 the band is the table's "take it out" zone (`data-tt-zone="binder"`);
 *      the search box is `tt-q`; the results region scrolls by the query's key
 *   §2 every card is a tap that adds (`tt-add`) and a drag source of the
 *      table's provider with the literal `binder` source, and it zooms
 *   §3 the counts: n in the deck; dimmed n/cap at the cap; red over it; S1
 *   §4 the chips carry their group and value; Clear only when a filter is on;
 *      More filters; the Add to switch only with more than one target
 *   §5 120 at a time: Show more (tt-show) says how many are left
 *   §6 the zoom hint (BL-74): beside the count, the held wheel (or click) for a
 *      mouse and the held finger on touch — one shown at a time, never on a card
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { poolChipsHtml, poolHtml, type PoolView } from '../pages/pool.ts';
import { readStyles } from './read-styles.ts';

const V: PoolView = {
  query: 'el:"fire"', active: true, total: 300, cap: 2, target: 'side', targets: ['deck', 'side', 'maybe'], scrollKey: 'tt-pool|el:"fire"',
  chips: [
    { group: 'el', value: 'fire', label: 'fire', iconHtml: '<img alt="fire">', on: true },
    { group: 'mana', value: '2', label: '2', on: false },
    { group: 'kind', value: 'unit', label: 'Unit', on: false },
  ],
  tiles: [
    { name: 'Ignis Sprite', inDeck: 1, inSide: 0, atCap: false, over: false },
    { name: 'Good Whale', inDeck: 2, inSide: 0, atCap: true, over: false },
    { name: 'Fireball', inDeck: 2, inSide: 1, atCap: true, over: true },
    { name: 'Hooba-Lin', inDeck: 0, inSide: 1, atCap: false, over: false },
  ],
};
const tile = (html: string, name: string): string => /<div class="ttpooltile[^"]*"[^>]*>[\s\S]*?<\/div>/.exec(html.slice(html.indexOf(`data-card="${name}"`) - 120))?.[0] ?? '';

test('§1 the band, the box, the results', () => {
  const html = poolHtml(V);
  assert.match(html, /^<section class="ttpool" data-tt-zone="binder"/);
  assert.match(html, /<input id="tt-q"[^>]*value="el:&quot;fire&quot;"/, 'the query, escaped');
  assert.match(html, /id="tt-results" data-scroll="tt-pool\|el:&quot;fire&quot;"/);
  assert.match(html, /class="ttremove"[^>]*>Drop to remove</);
});

test('§2 a tap adds, a press drags, a hold zooms', () => {
  const html = poolHtml(V);
  for (const t of V.tiles) {
    assert.match(html, new RegExp(`data-btn="tt-add" data-tt-src="binder\\|${t.name}" data-card="${t.name}" data-zoom>`), t.name);
  }
  const scans = (html.match(/<img [^>]*class="ttart"[^>]*>/g) ?? []);
  assert.equal(scans.length, V.tiles.length);
  assert.ok(scans.every(s => /draggable="false"/.test(s)), 'every scan through scanHtml: never the browser’s own drag');
});

test('§3 the counts', () => {
  const html = poolHtml(V);
  assert.match(tile(html, 'Ignis Sprite'), /<span class="ttpooln">1<\/span>/);
  assert.match(tile(html, 'Good Whale'), /class="ttpooltile ttcap"[\s\S]*<span class="ttpooln cap">2\/2<\/span>/);
  assert.match(tile(html, 'Fireball'), /<span class="ttpooln bad">2\/2<\/span><span class="ttpools">S1<\/span>/);
  assert.match(tile(html, 'Hooba-Lin'), /^(?![\s\S]*ttpooln)[\s\S]*<span class="ttpools">S1<\/span>/);
  assert.match(poolHtml({ ...V, cap: undefined, tiles: [{ name: 'Good Whale', inDeck: 2, inSide: 0, atCap: false, over: false }] }), /<span class="ttpooln">2<\/span>/, 'no cap: the bare count');
});

test('§4 the chips, Clear, More filters, Add to', () => {
  const html = poolHtml(V);
  assert.match(html, /data-btn="tt-chip"[^>]*aria-pressed="true"[^>]*data-group="el" data-value="fire"/);
  assert.match(html, /data-btn="tt-chip"[^>]*data-group="mana" data-value="2">2</);
  assert.match(html, /data-btn="tt-filters"/);
  assert.match(html, /data-btn="tt-clear"/);
  assert.doesNotMatch(poolHtml({ ...V, active: false }), /tt-clear/);
  assert.match(html, /<span class="ttpoolcount">300 cards<\/span>/);
  const to = [...html.matchAll(/data-btn="tt-target"[^>]*aria-pressed="(true|false)"[^>]*data-to="(\w+)"/g)].map(m => `${m[2]}${m[1] === 'true' ? '*' : ''}`);
  assert.deepEqual(to, ['deck', 'side*', 'maybe']);
  assert.doesNotMatch(poolHtml({ ...V, targets: ['deck'], target: 'deck' }), /tt-target/, 'one place to add: no switch');
});

test('§5 Show more', () => {
  assert.match(poolHtml(V), /data-btn="tt-show"[^>]*>Show more \(296\)</);
  assert.doesNotMatch(poolHtml({ ...V, total: 4 }), /tt-show/);
  assert.match(poolHtml({ ...V, tiles: [], total: 0 }), /No cards match\./);
});

test('§6 the zoom hint: hold the wheel, a click or a finger on a card (BL-74)', () => {
  const html = poolHtml(V);
  // it rides with the count, so a repaint while typing keeps it
  assert.match(poolChipsHtml(V), /<span class="ttpoolcount">300 cards<\/span><span class="ttpoolhint">/);
  assert.match(html, /<span class="ttpoolhint--mouse">Hold the mouse wheel, or a click, on a card to zoom<\/span>/);
  assert.match(html, /<span class="ttpoolhint--touch">Hold a card to zoom<\/span>/);
  assert.equal(html.match(/class="ttpoolhint"/g)?.length, 1, 'once, in the bar');
  assert.doesNotMatch(tile(html, 'Ignis Sprite'), /ttpoolhint/, 'never on a card');
  const css = readStyles();
  assert.match(css, /\.ttpoolhint \{[^}]*color: var\(--color-text-muted\)/, 'quiet: muted, like the count');
  assert.match(css, /html\.touch \.ttpoolhint--mouse, html:not\(\.touch\) \.ttpoolhint--touch \{ display: none; \}/, 'one wording at a time');
});
