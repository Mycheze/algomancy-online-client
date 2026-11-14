/* 1351 · A NEW PACK OPENS AT ITS TOP (pages/cubedraft.ts packScrollKey) — the walk of 2026-11-14: the
 * next pack came up scrolled as far down as the last one was left, its first cards out of sight.
 *
 *   §1 the pack band's scroll key is the pick's: the same within a pick (a tap, a push from the
 *      server), another for the next pick or the next pack
 *   §2 painted through paintFrame (which keeps every region's scroll by its key): a repaint within a
 *      pick keeps where the band was scrolled; the next pick's band starts at 0 — and the picks
 *      table, whose key does not change, keeps its scroll throughout
 *
 * Seeds: none. DOM-free: a stand-in #app whose regions are made from the markup's data-scroll keys.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { cubeDraftHtml, packScrollKey, type CubeDraftPageView } from '../pages/cubedraft.ts';
import { paintFrame } from '../pages/frame.ts';

const PACK = DECK_LIST.slice(40, 53);
const view = (packNo: number, pickNo: number, reserved: string | null = null): CubeDraftPageView => ({
  event: 'Friday cube', packNo, pickNo, direction: 'left', seats: [], pack: PACK.slice(pickNo - 1), reserved, taken: null, suggest: null,
  msLeft: 30_000, picks: [], split: 0.6, pw: 160, chrome: { signedIn: true, alerts: 0 },
  table: { cw: 132, ch: 183, piles: [], newPiles: null, rail: null, scrollKey: 'cd-picks', zoneAttrs: { 'data-cd-zone': 'picks' } },
});

test('§1 one key a pick', () => {
  assert.equal(packScrollKey(view(1, 3)), packScrollKey(view(1, 3, PACK[4]!)), 'a tap keeps the key');
  assert.notEqual(packScrollKey(view(1, 3)), packScrollKey(view(1, 4)), 'the next pick has its own');
  assert.notEqual(packScrollKey(view(1, 3)), packScrollKey(view(2, 3)), 'and the next pack');
  assert.match(cubeDraftHtml(view(2, 5)), new RegExp(`<div class="ttpoolresults" data-scroll="${packScrollKey(view(2, 5))}">`));
});

/** a stand-in #app: its scrolling regions are the markup's data-scroll keys, each with a scrollTop */
function fakeApp(): HTMLElement & { region(key: string): { scrollTop: number } | null } {
  let regions = new Map<string, { scrollTop: number; scrollLeft: number; dataset: Record<string, string> }>();
  let html = '';
  const app = {
    classList: { remove: () => {} },
    get innerHTML() { return html; },
    set innerHTML(v: string) {
      html = v;
      regions = new Map([...v.matchAll(/data-scroll="([^"]+)"/g)].map(m => [m[1]!, { scrollTop: 0, scrollLeft: 0, dataset: { scroll: m[1]! } }]));
    },
    querySelectorAll: (s: string) => (s === '[data-scroll]' ? [...regions.values()] : []),
    querySelector: (s: string) => { const k = /^\[data-scroll="(.+)"\]$/.exec(s)?.[1]; return k ? regions.get(k.replace(/\\(.)/g, '$1')) ?? null : null; },
    region: (k: string) => regions.get(k) ?? null,
  };
  return app as unknown as HTMLElement & { region(key: string): { scrollTop: number } | null };
}

test('§2 painted: kept within a pick, the top for the next', () => {
  const app = fakeApp();
  paintFrame(app, cubeDraftHtml(view(1, 3)));
  app.region(packScrollKey(view(1, 3)))!.scrollTop = 320;
  app.region('cd-picks')!.scrollTop = 90;
  paintFrame(app, cubeDraftHtml(view(1, 3, PACK[3]!)));
  assert.equal(app.region(packScrollKey(view(1, 3)))!.scrollTop, 320, 'a tap repaints the band where it was');
  paintFrame(app, cubeDraftHtml(view(1, 4)));
  assert.equal(app.region(packScrollKey(view(1, 4)))!.scrollTop, 0, 'the next pick opens at the top');
  assert.equal(app.region('cd-picks')!.scrollTop, 90, 'the picks keep theirs');
});
