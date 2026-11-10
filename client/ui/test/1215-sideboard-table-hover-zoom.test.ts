/* 1215 — HOVERING A CARD ON THE SIDEBOARDING TABLE SHOWS THE BIG ZOOM (BL-55's first leftover).
 *
 * BL-55: "Hovering a card on the sideboarding table with a mouse shows the big
 * zoom, as on the board". The table between Competitive games (pages/match.ts,
 * BL-65) draws the tabletop's `.ttcard` tiles, and the hover zoom
 * (ui/zoom.ts zoomTarget) only ever matched board `.card`s — so a mouse got
 * nothing on hover there, only the press zoom (press and hold, or the wheel).
 *
 *   §1 the decision: a tile on the sideboarding table is a hover target; the
 *      same tile on the deck builder's tabletop is not (the owner asked for the
 *      press zoom there, 2026-10-21); nor a tile with no scan, nor one inside
 *      the zoom or drag layer, nor any tile while a card is being carried
 *   §2 the markup it relies on: every copy on the real sideboarding table, deck
 *      and sideboard alike, is a `data-zoom` tile with its scan, under the
 *      `ccsbtable` root — driven through the real client
 *   §3 the seam: a drag starting lets the hover zoom go, as it does the press zoom
 *
 * The suites cannot move a real mouse (test 322's header): no browser on the
 * home box looked at it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { client } from './ui-driver.ts';
import { zoomTarget } from '../zoom.ts';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (f: string): string => readFileSync(join(UI, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const ui = await client();

/** a tabletop tile: `on` = the screen it sits on, `img` = has a scan,
 * `layer` = sits inside the zoom or drag layer */
function tile(on: 'sideboard' | 'builder', img = true, layer = false): { el: Element; tile: object } {
  const t = {
    querySelector: (s: string) => (s === 'img' && img ? {} : null),
    closest: (s: string) => (s.includes('#cardzoom') && layer ? t : null),
  };
  const el = {
    closest: (s: string) => (s.includes('.ccsbtable') && on === 'sideboard' ? t : null),
  } as unknown as Element;
  return { el, tile: t };
}

const doc = globalThis as Record<string, unknown>;
function withDragging<T>(dragging: boolean, fn: () => T): T {
  const was = doc['document'];
  doc['document'] = { documentElement: { classList: { contains: (c: string) => dragging && c === 'dragging' } } };
  try { return fn(); } finally { doc['document'] = was; }
}

test('§1 a sideboarding-table tile is a hover target; a builder tile, a scanless one, one in a layer and any tile under a drag are not', () => {
  withDragging(false, () => {
    const s = tile('sideboard');
    assert.equal(zoomTarget(s.el), s.tile, 'a tile on the sideboarding table zooms on hover');
    assert.equal(zoomTarget(tile('builder').el), null, 'the deck builder keeps its press zoom only');
    assert.equal(zoomTarget(tile('sideboard', false).el), null, 'a card with no scan has nothing to magnify');
    assert.equal(zoomTarget(tile('sideboard', true, true).el), null, 'the copy itself is never a target');
  });
  withDragging(true, () => {
    assert.equal(zoomTarget(tile('sideboard').el), null, 'nothing zooms while a card is carried');
  });
});

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 24);
const MAIN = N.slice(0, 15).flatMap(n => [n, n]);
const SIDE = N.slice(15, 20);
const REG = { main: MAIN, side: SIDE };

test('§2 every copy on the real sideboarding table is a data-zoom tile with its scan, under the ccsbtable root', () => {
  ui.push({
    t: 'joined', room: 'UIDRIVER', seat: 0, peers: [true, true], names: ['Ann', 'Bo'],
    waiting: { have: [true, true], match: {
      id: 'M1215', bestOf: 3, game: 2, score: [1, 0], names: ['Ann', 'Bo'],
      banks: [38 * 60_000, 41 * 60_000], clockStart: 45 * 60_000,
      phase: 'between', chooser: 1, initiative: null, until: Date.now() + 100_000, locked: false, ready: [false, true],
      mine: { registered: REG, current: REG },
    } },
  });
  const html = ui.html();
  const root = html.search(/class="[^"]*\bccsbtable\b/);
  assert.ok(root >= 0, 'the sideboarding table is on screen');
  const tiles = [...html.matchAll(/<div class="ttcard[^"]*"[^>]*>[\s\S]*?<\/div>/g)];
  assert.equal(tiles.length, MAIN.length + SIDE.length, 'one tile per copy, deck and sideboard');
  for (const m of tiles) {
    assert.ok(m.index! > root, 'inside the ccsbtable root');
    assert.match(m[0], /\sdata-zoom[\s>]/, 'carries data-zoom');
    assert.match(m[0], /<img /, 'carries its scan');
  }
});

test('§3 a drag starting lets the hover zoom go, not only the press zoom', () => {
  const begin = code('drag.ts').match(/function begin\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(begin, /zoomPressEnd\(\);/);
  assert.match(begin, /zoomOff\(\);/);
});
