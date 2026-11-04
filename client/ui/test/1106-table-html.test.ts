/* 1106 · THE TABLE (pages/table.ts tableHtml) — the felt every deck lies on.
 *
 * BL-65: one table for the builder (constructed and the challenge) and the
 * Competitive sideboarding table. DOM-free, from made-up views:
 *
 *   §1 the builder's row: a gap before each pile, the end slot, every one a
 *      `tt-to`; the bare felt is the end; an empty table says so
 *   §2 the rail: the sideboard (n/7, an empty one a slot), then Maybe —
 *      its own class (dashed, hatched) and "Not in the deck"
 *   §3 the card menu: one button per item with its data-btn, escaped, drawn
 *      AFTER the table region (outside its stacking context)
 *   §4 another host's taps: no new piles, its own zone attributes, the
 *      piles' own tap (`cc-move`), no `tt-to` anywhere
 *   §5 the CSS: the region isolates its z-indexes; the menu sits at --z-menu
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { tableHtml, tableMenuHtml, type TableView } from '../pages/table.ts';
import type { PileView } from '../piletable.ts';
import { readStyles } from './read-styles.ts';

const pile = (zone: string, names: string[], over: Partial<PileView> = {}): PileView => ({
  zone, name: zone.split('|').pop()!, cards: names.map((name, k) => ({ name, src: `${zone}|${k}|${name}` })), S: 30, ch: 150, ...over,
});
const BUILDER: TableView = {
  cw: 108, ch: 150,
  piles: [pile('pile|a', ['Ignis Sprite', 'Ignis Sprite']), pile('pile|b', ['Good Whale'])],
  newPiles: { emptyText: 'Drag cards here.' },
  rail: {
    side: pile('side', [], { name: 'Sideboard', limit: 7, slot: true, cls: 'ttsidepile' }),
    maybe: pile('maybe', ['Fireball'], { name: 'Maybe', cls: 'ttmaybepile' }),
  },
};

test('§1 the builder’s row: gaps, the end, the bare felt', () => {
  const html = tableHtml(BUILDER);
  assert.match(html, /^<div class="tttablewrap" style="--cw:108px;--ch:150px">/);
  assert.match(html, /<div class="tttable" data-scroll="tt-table" data-tt-zone="end" data-btn="tt-to">/, 'the felt is a new pile at the end');
  assert.deepEqual([...html.matchAll(/data-tt-zone="(gap\|\d+)" data-btn="tt-to"/g)].map(m => m[1]), ['gap|0', 'gap|1']);
  assert.match(html, /<div class="ttend" data-tt-zone="end" data-btn="tt-to"><\/div>/, 'the end slot, silent while there are piles');
  const zones = [...html.matchAll(/<section class="ttpile[^"]*" data-tt-zone="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(zones, ['pile|a', 'pile|b', 'side', 'maybe'], 'the row, then the rail');
  const empty = tableHtml({ ...BUILDER, piles: [] });
  assert.match(empty, /<div class="ttend"[^>]*><span class="dim">Drag cards here\.<\/span><\/div>/);
  assert.match(tableHtml({ ...BUILDER, holding: true }), /^<div class="tttablewrap ttholding"/);
});

test('§2 the rail: Sideboard n/7 with its slot, then Maybe, not in the deck', () => {
  const html = tableHtml(BUILDER);
  const rail = /<aside class="ttrail" data-scroll="tt-rail">([\s\S]*)<\/aside>/.exec(html)?.[1] ?? '';
  assert.ok(rail, 'a rail');
  assert.ok(rail.indexOf('data-tt-zone="side"') < rail.indexOf('data-tt-zone="maybe"'), 'the sideboard first');
  assert.match(rail, /class="ttpilecount">0\/7<\/span>/);
  assert.match(rail, /class="ttfan ttslot"/, 'an empty sideboard keeps a card’s room');
  assert.match(rail, /<div class="ttrailbox ttrailmaybe"><section class="ttpile ttmaybepile"/);
  assert.match(rail, /<p class="ttrailnote">Not in the deck<\/p>/);
  assert.doesNotMatch(tableHtml({ ...BUILDER, rail: null }), /ttrail/, 'no rail, none drawn');
  assert.doesNotMatch(tableHtml({ ...BUILDER, rail: { side: BUILDER.rail!.side } }), /ttrailmaybe|Not in the deck/);
});

test('§3 the card menu: its items, escaped, after the region', () => {
  const html = tableHtml({
    ...BUILDER,
    menu: { title: 'Ignis <Sprite>', for: 'pile|a|0|Ignis Sprite', items: [
      { btn: 'tt-cut', label: 'Remove one' }, { btn: 'tt-more', label: 'Add another', disabled: true },
      { btn: 'tt-toside', label: 'To sideboard' },
    ] },
  });
  const at = html.indexOf('<div class="ttpop"');
  assert.ok(at > html.indexOf('</aside>'), 'after the table and its rail, outside the region');
  const menu = html.slice(at);
  assert.match(menu, /^<div class="ttpop" role="menu" aria-label="Ignis &lt;Sprite&gt;" data-tt-menu="pile\|a\|0\|Ignis Sprite">/);
  assert.match(menu, /<b>Ignis &lt;Sprite&gt;<\/b>/);
  assert.deepEqual([...menu.matchAll(/data-btn="(tt-[a-z]+)"/g)].map(m => m[1]), ['tt-putdown', 'tt-cut', 'tt-more', 'tt-toside']);
  assert.match(menu, /data-btn="tt-more"[^>]*disabled/);
  assert.doesNotMatch(tableHtml(BUILDER), /ttpop/, 'closed: nothing');
  assert.match(tableMenuHtml({ title: 'x', for: 'head|a', items: [], closeBtn: 'cc-x' }), /data-btn="cc-x"/);
});

test('§4 another host: its own zones and taps, no new piles', () => {
  const cc = tableHtml({
    cw: 108, ch: 150, newPiles: null, scrollKey: 'cc-deck',
    zoneAttrs: { 'data-cc-zone': 'main' },
    piles: [pile('main|1', ['Ignis Sprite'], { cls: 'ccsbpile', tap: { card: 'cc-move', from: 'main' } })],
    rail: { side: pile('side', ['Good Whale'], { name: 'Sideboard', limit: 7, slot: true, tap: { card: 'cc-move', from: 'side' } }),
      sideAttrs: { 'data-cc-zone': 'side' } },
  });
  assert.match(cc, /<div class="tttable" data-scroll="cc-deck" data-cc-zone="main">/);
  assert.match(cc, /<div class="ttrailbox ttrailside" data-cc-zone="side">/);
  assert.doesNotMatch(cc, /ttgutter|ttend|tt-to|tt-card/, 'no builder taps');
  assert.match(cc, /data-btn="cc-move" data-from="main" data-tt-src="main\|1\|0\|Ignis Sprite"/);
});

test('§5 the CSS: an isolated region, the menu at --z-menu', () => {
  const css = readStyles();
  assert.match(css, /\.tttablewrap \{[^}]*isolation: isolate;/);
  assert.match(css, /\.ttpop \{[^}]*z-index: var\(--z-menu\)/);
});
