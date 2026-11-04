/* A TALL PILE NEVER FANS TIGHTER THAN A READABLE NAME BAR (BL-65 F12).
 *
 * At 1440×900 the builder's 14-card cost-2 pile fanned at the old 14px floor,
 * so each card covered the one above it halfway down its name bar and no name
 * could be read. The floor is the name bar now — cost, name and stats, the top
 * NAME_BAR_SHARE of a scan — and a pile that does not fit at it runs on: the
 * table region scrolls inside itself (the page never does).
 *
 *   §1 at every card size the table draws, a pile far too tall for its pane
 *      fans at the readable step, and that step clears the name bar
 *   §2 room to spare still gives the full fifth; a squeeze still tightens
 *   §3 the real builder: an 18-card pile in a short window draws every card at
 *      the readable step, and its fan is taller than the pane it sits in
 *   §4 the region that holds it scrolls vertically inside itself
 *
 * Seeds: none. The deck is real cards, served by the driver's fetch seam.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_STRIP, NAME_BAR_SHARE, STRIP_SHARE, cardHeight, cardWidth, fanHeight, readableStrip, stripOf,
} from '../piletable.ts';
import { readStyles } from './read-styles.ts';

/** the scan's name bar ends 100px down its 1000px height */
const BAR = 100 / 1000;

test('§1 a pile too tall for its pane fans at the readable step, at every card size', () => {
  for (const cw of [132, 108, 88]) {
    const ch = cardHeight(cw);
    const S = stripOf(40, 300, ch);
    assert.equal(S, readableStrip(ch), `cw ${cw}: the floor`);
    assert.ok(S >= ch * BAR, `cw ${cw}: S=${S} clears the name bar (${(ch * BAR).toFixed(1)}px)`);
    assert.ok(S >= MIN_STRIP);
    assert.ok(fanHeight(40, S, ch) > 300, 'so the pile runs past the pane');
  }
  assert.ok(NAME_BAR_SHARE >= BAR && NAME_BAR_SHARE < STRIP_SHARE, 'the floor sits between the bar and the full strip');
  // the case F12 was: 14 cards at the 1440 card size in a ~360px pane
  const ch = cardHeight(cardWidth({ touch: false, width: 1440 }));
  assert.ok(stripOf(14, 360, ch) >= Math.ceil(ch * BAR), '14 cards at 1440×900 read');
});

test('§2 room to spare is a fifth; a squeeze above the floor still tightens', () => {
  const ch = cardHeight(132);
  assert.equal(stripOf(5, 2000, ch), Math.round(ch * STRIP_SHARE));
  const S = stripOf(10, 450, ch);
  assert.ok(S > readableStrip(ch) && S < Math.round(ch * STRIP_SHARE), `S=${S} fits the pane`);
  assert.ok(fanHeight(10, S, ch) <= 450);
});

// ── §3 the builder itself ──────────────────────────────────────────────

const g = globalThis as Record<string, unknown>;
// eighteen one-drops: the builder's cost piles put them in one pile
const ONES = ['Ignis Sprite', 'Ignis Sprite', 'Cinder Scuttler', 'Cinder Scuttler', 'Hooba-Lin', 'Hooba-Lin',
  'Immolate', 'Immolate', 'Burning Vengeance', 'Burning Vengeance', 'Sacrificial Burst', 'Sacrificial Burst',
  'Spectrogenesis', 'Spectrogenesis', 'Spiteful Shadow', 'Spiteful Shadow', 'Refuse Reclaimer', 'Refuse Reclaimer'];
const DECK = {
  id: 'd1136', name: 'Tall pile', cards: ONES, maybe: [], cover: null,
  author: 'you', createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z', problems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
};
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't1136' };
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: [DECK] }) };
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
g['innerWidth'] = 1440; g['innerHeight'] = 500; // a short window: the pane is small
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
await flush();
ui.click({ btn: 'deck-openpage' });
await flush();
ui.click({ btn: 'deck-tabletop' });

test('§3 the builder draws a tall pile at the readable step, past its pane', () => {
  const html = ui.html();
  const ch = Number(/class="tttablewrap[^"]*" style="--cw:\d+px;--ch:(\d+)px/.exec(html)?.[1]);
  assert.equal(ch, cardHeight(132), 'the 1440 card size');
  const piles = [...html.matchAll(/<section class="ttpile[^"]*" data-tt-zone="pile\|[^"]*" data-tt-s="(\d+)" data-tt-n="(\d+)"[\s\S]*?<\/section>/g)];
  const tall = piles.find(m => Number(m[2]) === ONES.length);
  assert.ok(tall, `one pile holds all ${ONES.length} (piles: ${piles.map(m => m[2]).join(',')})`);
  const S = Number(tall![1]);
  assert.equal(S, readableStrip(ch), 'it fans at the floor');
  const tops = [...tall![0].matchAll(/class="ttcard[^"]*" style="--k:(\d+);top:(\d+)px"/g)];
  assert.equal(tops.length, ONES.length);
  for (const t of tops) assert.equal(Number(t[2]), Number(t[1]) * S, 'every card one readable step below the last');
  const fan = Number(/class="ttfan[^"]*" style="height:(\d+)px"/.exec(tall![0])?.[1]);
  assert.equal(fan, fanHeight(ONES.length, S, ch));
  assert.ok(fan > 500 - 150, 'taller than the pane: the region scrolls rather than squeeze it');
});

test('§4 the table region scrolls inside itself', () => {
  const css = readStyles();
  const rule = /(?:^|\n)\.tttable \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(rule, /overflow: auto/, '.tttable scrolls its own piles');
  assert.match(rule, /min-width: 0/);
});
