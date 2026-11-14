/* 1380 · THE PACK'S TILES ARE THE LARGEST THAT FIT THE BAND (pages/cubedraft.ts tileFit,
 * 57-cube-draft.css) — the Chrome walk of 2026-11-14 at 1345×746: the band was 1345×339, the
 * 13 tiles 96×133 in one row, more than half the band empty. The tiles were sized as if every grid
 * column stretched to the row (a pack of 11 got 13 columns' worth), so the size chosen was never
 * the size that fit.
 *
 *   §1 for several windows, band heights and pack sizes: the whole pack fits the band at the width
 *      chosen, in whatever rows that takes (columns counted with the thin scrollbar there), and one
 *      pixel more would not fit — unless it is already the most (the card zoom's 240) — and never
 *      under the least (72; a band smaller than that scrolls)
 *   §2 the walk's window: bigger than before at 11, 13 and 15 cards, and a taller band never gets
 *      smaller tiles, nor a wider window
 *   §3 drawn at exactly that width: the grid's columns are --pw (not stretched), and the band
 *      carries the fitted --pw; a moved divider or a resized window gives the band a new tile size
 *      (the controller's draw key moves, so the next beat after a release redraws it — 1360 §3
 *      holds it while a press is down)
 *
 * Seeds: none. DOM-free: innerWidth/innerHeight and localStorage are set on globalThis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import type { CubeView } from '../../server/cube-types.ts';
import { cubeDraftView, cubePackHtml, PACK_SPLIT_KEY, tileFit } from '../pages/cubedraft.ts';
import { drawKeys } from '../cubedraft.ts';
import { readStyles } from './read-styles.ts';

/* the page's measures (as 1350: the pack bar 39; its results padded 2 / 12 and 12 a side; a 6px gap;
 * the thin scrollbar 10; a scan is 720 × 1000) — and a little slack for rounding */
const BAR = 39, PADV = 14, PADH = 24, GAP = 6, SCROLLBAR = 10, SLACK = 4;
const MAX = 240, MIN = 72;
const cols = (w: number, pw: number): number => Math.max(1, Math.floor((w - PADH - SCROLLBAR + GAP) / (pw + GAP)));
const need = (n: number, w: number, pw: number): number => {
  const rows = Math.ceil(n / cols(w, pw));
  return BAR + PADV + SLACK + rows * pw * 1000 / 720 + (rows - 1) * GAP;
};
const fits = (n: number, w: number, band: number, pw: number): boolean => need(n, w, pw) <= band;

test('§1 the largest that shows the whole pack, in any rows, within the bounds', () => {
  let checked = 0, multiRow = 0;
  for (const w of [1024, 1180, 1345, 1440, 1920]) {
    for (const band of [160, 250, 339, 424, 520, 700]) {
      for (const n of [1, 5, 8, 11, 13, 15, 20]) {
        const pw = tileFit(n, w, band);
        assert.ok(pw >= MIN && pw <= MAX, `${w}×${band}, ${n}: ${pw} within the bounds`);
        if (pw > MIN) assert.ok(fits(n, w, band, pw), `${w}×${band}, ${n}: the whole pack shows at ${pw}`);
        if (pw < MAX) assert.ok(!fits(n, w, band, pw + 1), `${w}×${band}, ${n}: ${pw + 1} would not — ${pw} is the largest`);
        if (Math.ceil(n / cols(w, pw)) > 1) multiRow++;
        checked++;
      }
    }
  }
  assert.ok(checked === 210 && multiRow > 20, `positive control: ${multiRow} of the fits take more than one row`);
  assert.equal(tileFit(1, 1440, 2000), MAX, 'one card in a huge band: the most, no bigger');
  assert.equal(tileFit(15, 1024, 90), MIN, 'a band too small for any: the least (it scrolls)');
});

test('§2 the walk’s window: bigger than the stretched-column fit; taller and wider never smaller', () => {
  // the old fit at 1345 × 339 (measured on the walk, and what the old function gives): 96 wide for 11–13 cards
  const before = { 11: 96, 13: 96, 15: 96 } as const;
  for (const n of [11, 13, 15] as const) {
    const pw = tileFit(n, 1345, 339);
    assert.ok(pw > before[n], `${n} cards at 1345×339: ${pw} wide (was ${before[n]})`);
  }
  assert.equal(cols(1345, tileFit(11, 1345, 339)), 11, 'eleven: one row, filling it');
  assert.ok(tileFit(13, 1345, 339) >= 99, 'thirteen: the bigger of one row of 13 and two rows');
  for (const n of [8, 13, 15]) {
    let last = 0;
    for (const band of [200, 260, 320, 400, 480, 560]) {
      const pw = tileFit(n, 1345, band);
      assert.ok(pw >= last, `${n} cards: a taller band (${band}) never smaller tiles (${last} → ${pw})`);
      last = pw;
    }
    let lastW = 0;
    for (const w of [1024, 1200, 1345, 1600, 1920]) {
      const pw = tileFit(n, w, 339);
      assert.ok(pw >= lastW, `${n} cards: a wider window (${w}) never smaller tiles`);
      lastW = pw;
    }
  }
});

/** the declarations of the last rule whose selector list holds exactly `sel`, and where it is */
function rule(css: string, sel: string): { body: string; at: number } {
  let at = -1, body = '';
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    if (m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').split(',').map(s => s.trim()).includes(sel)) { at = m.index; body = m[2]!; }
  }
  return { body, at };
}

const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g['localStorage'] = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
const PACK = DECK_LIST.slice(40, 53);
const CUBE: CubeView = {
  now: 1_000_000, code: 'FITS', phase: 'drafting', host: { user: 'u1', name: 'Ann' }, isHost: false, me: 'u2', joined: true,
  config: { name: "Ann's cube", source: { kind: 'elements', elements: ['fire', 'water'] }, packs: 3, packSize: 13, minPlayers: 2,
    maxPlayers: 8, fillBots: true, startAt: null, tournament: 'swiss', swissRounds: 3, rules: 'casual', bestOf: 1 },
  players: [], poolSize: 320, packMath: [], myPool: null, myDeck: null, round: 0, breakUntil: null, pending: null,
  matches: [], standings: [], myMatch: null,
  draft: { packNo: 1, pickNo: 1, packs: 3, packSize: 13, direction: 'left', seats: [], pack: PACK, deadline: null,
    reserved: null, suggest: null, picks: [] },
};
const viewAt = (w: number, h: number) => {
  g['innerWidth'] = w; g['innerHeight'] = h;
  return cubeDraftView(CUBE, { reserved: null, taken: null, serverNow: CUBE.now });
};

test('§3 drawn at that width; the divider and the window move it', () => {
  const css = readStyles();
  const own = rule(css, '.cdgrid');
  assert.match(own.body, /grid-template-columns:\s*repeat\(auto-fill,\s*var\(--pw\)\)/, 'columns of exactly --pw, never stretched');
  assert.ok(own.at > rule(css, '.ttpoolgrid').at, 'after the builder’s stretched grid: this one holds');
  store.clear();
  store.set(PACK_SPLIT_KEY, '0.55');
  const v = viewAt(1345, 746);
  assert.equal(v.pw, tileFit(13, 1345, 0.55 * (746 - 130)), 'the band’s fit');
  assert.match(cubePackHtml(v), new RegExp(`<div class="ttpoolgrid cdgrid" style="--pw:${v.pw}px">`), 'the band carries it');
  store.set(PACK_SPLIT_KEY, '0.7');
  const taller = viewAt(1345, 746);
  assert.ok(taller.pw > v.pw, `the divider moved down: bigger tiles (${v.pw} → ${taller.pw})`);
  assert.notEqual(drawKeys(taller).band, drawKeys(v).band, 'and the band is drawn again');
  // the tall band's tiles are as wide as two rows allow at 1345: a window too narrow for 7 a row shrinks them
  const narrower = viewAt(900, 746);
  assert.ok(narrower.pw < taller.pw, `the window narrowed: smaller tiles (${taller.pw} → ${narrower.pw})`);
  assert.notEqual(drawKeys(narrower).band, drawKeys(taller).band);
  store.set(PACK_SPLIT_KEY, '0.55');
  const higher = viewAt(1345, 900);
  assert.ok(higher.pw > v.pw, `the window grew taller: bigger tiles (${v.pw} → ${higher.pw})`);
  assert.equal(drawKeys(viewAt(1345, 900)).band, drawKeys(higher).band, 'nothing moved: the same key, no redraw');
  store.clear();
});
