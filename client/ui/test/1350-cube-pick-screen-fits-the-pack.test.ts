/* 1350 · THE PACK FIRST (pages/cubedraft.ts packFit, docs/25 §4) — the walk of 2026-11-14: the band
 * showed 8 of 13 cards while the empty picks took 60% of the height. Like MTGO, the band opens tall
 * enough for the WHOLE pack, and the picks get the rest.
 *
 *   §1 a pack of 15 shows whole at 1440×900 and at 1024×768: two rows, the tiles made smaller where
 *      a row would not hold half of it (8 at 1024), the band's share holds both rows, the picks keep
 *      at least a strip of the table — worked out here from the page's own measures, not packFit's
 *   §2 counting the columns with the thin scrollbar there (so a pack that fits never tips into a
 *      scrollbar and one column fewer), and a short pack takes one row
 *   §3 the screen draws it: the grid's --pw and the divider's --pool-f are the fit's, the divider
 *      stores under the pick screen's own key (not the builder's), and the player's stored share wins
 *   §4 the picks are piled by cost, as the builder's Re-sort piles a deck
 *
 * Seeds: none. DOM-free: innerWidth/innerHeight and localStorage are set on globalThis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import type { CubeView } from '../../server/cube-types.ts';
import { seedPiles } from '../deckarrange.ts';
import { cubeDraftHtml, cubeDraftView, PACK_SPLIT_KEY, packFit } from '../pages/cubedraft.ts';
import { SPLIT_KEY } from '../splitter.ts';

/* the page's measures (frame toolbar 64 + 2, foot bar 40, divider 24; the pack bar 39; its results
 * padded 2 / 12 and 12 a side; a 6px gap; a scan is 720 × 1000) — measured in Chrome, 2026-11-14 */
const FRAME = 106, DIVIDER = 24, BAR = 39, PADV = 14, PADH = 24, GAP = 6, SCROLLBAR = 10;
const tileH = (w: number, cols: number, scrollbar: boolean): number =>
  ((w - PADH - (scrollbar ? SCROLLBAR : 0) - (cols - 1) * GAP) / cols) * 1000 / 720;
/** the columns the grid makes for a least width at a window width */
const colsOf = (w: number, pw: number, scrollbar: boolean): number => Math.floor((w - PADH - (scrollbar ? SCROLLBAR : 0) + GAP) / (pw + GAP));

for (const [w, h] of [[1440, 900], [1024, 768]] as const) {
  test(`§1 a pack of 15 shows whole at ${w}×${h}`, () => {
    const f = packFit(15, w, h);
    const span = h - FRAME - DIVIDER;
    for (const sb of [false, true]) {
      const cols = colsOf(w, f.pw, sb);
      assert.ok(cols >= 8, `${cols} columns ${sb ? 'with' : 'without'} the scrollbar: 15 cards in two rows`);
      const need = BAR + PADV + 2 * tileH(w, cols, sb) + GAP;
      assert.ok(f.split * span >= need, `the band (${Math.round(f.split * span)}px) holds both rows (${Math.round(need)}px)`);
    }
    assert.equal(f.rows, 2);
    assert.ok(span * (1 - f.split) >= 150, `the picks keep ${Math.round(span * (1 - f.split))}px of the table`);
    assert.ok(f.split > 0.5, 'the pack is the main thing');
  });
}

test('§2 the scrollbar counted, a short pack one row, a big one smaller tiles', () => {
  // 1024: at the CSS's 132px only 7 fit a row; packFit makes them small enough for 8 WITH the scrollbar
  const f = packFit(15, 1024, 768);
  assert.ok(f.pw < 132);
  assert.equal(colsOf(1024, f.pw, true), 8, 'eight a row even with the scrollbar there');
  assert.equal(packFit(5, 1440, 900).rows, 1, 'five cards: one row');
  assert.ok(packFit(5, 1440, 900).split < packFit(15, 1440, 900).split, 'and a smaller band');
  const big = packFit(20, 1440, 900);
  assert.equal(big.rows, 2);
  assert.ok(colsOf(1440, big.pw, true) >= 10, 'twenty cards: ten a row');
});

/* the screen */
const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g['localStorage'] = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
g['innerWidth'] = 1440;
g['innerHeight'] = 900;

const PACK = DECK_LIST.slice(40, 55);
const PICKS = DECK_LIST.slice(0, 12);
const CUBE: CubeView = {
  now: 1_000_000, code: 'FITS', phase: 'drafting', host: { user: 'u1', name: 'Ann' }, isHost: false, me: 'u2', joined: true,
  config: { name: "Ann's cube", source: { kind: 'elements', elements: ['fire', 'water'] }, packs: 3, packSize: 15, minPlayers: 2,
    maxPlayers: 8, fillBots: true, startAt: null, tournament: 'swiss', swissRounds: 3, rules: 'casual', bestOf: 1 },
  players: [], poolSize: 320, packMath: [], myPool: null, myDeck: null, round: 0, breakUntil: null, pending: null,
  matches: [], standings: [], myMatch: null,
  draft: { packNo: 1, pickNo: 1, packs: 3, packSize: 15, direction: 'left', seats: [], pack: PACK, deadline: 1_090_000,
    reserved: null, suggest: null, picks: PICKS },
};
const html = (): string => cubeDraftHtml(cubeDraftView(CUBE, { reserved: null, taken: null, serverNow: CUBE.now }));

test('§3 the screen draws the fit; the player’s share wins; its own key', () => {
  store.clear();
  store.set(SPLIT_KEY, '0.2');   // the builder's divider, dragged small: none of the pick screen's business
  const fit = packFit(15, 1440, 900);
  let page = html();
  assert.match(page, new RegExp(`<div class="ttpoolgrid cdgrid" style="--pw:${fit.pw}px">`));
  assert.match(page, new RegExp(`style="--pool-f:${fit.split}" data-split-key="${PACK_SPLIT_KEY}"`), 'the fit, not the builder’s 0.2');
  store.set(PACK_SPLIT_KEY, '0.4');
  page = html();
  assert.match(page, /style="--pool-f:0.4" data-split-key="algoCubePackSplit"/, 'the player moved it: theirs');
  store.clear();
});

test('§4 the picks, piled by cost', () => {
  const v = cubeDraftView(CUBE, { reserved: null, taken: null, serverNow: CUBE.now });
  assert.deepEqual(v.table.piles.map(p => p.cards.map(c => c.name)), seedPiles(PICKS, 'cost').map(p => p.cards));
  assert.ok(v.table.piles.length > 1, 'more than one pile');
});
