/* 1360 · A PUSH REDRAWS ONLY WHAT IT CHANGED (ui/cubedraft.ts, docs/25 §13) — owner, 2026-11-14,
 * after a whole draft: "There is something weird with the UI. I think it's like resetting or
 * something when other players do something. It was sometimes hard to select the card I wanted and
 * felt not super responsive." Every other player's pick pushes my view; the screen was painted
 * whole for each one, the pack's tiles rebuilt between a press and its release.
 *
 *   §1 another player's pick (only the seats strip's counts move): the seats strip is patched in
 *      place — the page is not painted, the band is not redrawn
 *   §2 a tap rings the card AT ONCE (the band, alone, before any answer); the server's echo of it
 *      redraws nothing
 *   §3 while a pointer is down on the screen a push that changes my pack and my picks waits: no
 *      band, no table; the beat after the release draws it — once
 *   §4 the urgent clock redraws the band once (the hint), not every beat
 *
 * Seeds: none. A stand-in #app whose few regions (the band, the seats strip, the title, the clock)
 * are found in its markup and counted as they are written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import type { CubeDraftView, CubeView } from '../../server/cube-types.ts';
import { cubeDraftButton, cubeDraftPress, paintCubeDraft, stopCubeDraft, tickCubeDraft } from '../cubedraft.ts';
import * as tt from '../tabletop.ts';

const PACK = DECK_LIST.slice(60, 70);
const NOW = 9_000_000;

/** a stand-in #app: the page's markup, and a count of every write — whole, or one region's */
function fakeApp() {
  let html = '';
  const n = { page: 0, band: 0, seats: 0, title: 0 };
  const region = (re: RegExp, count: keyof typeof n) => {
    const m = re.exec(html);
    if (!m) return null;
    return {
      dataset: {}, scrollTop: 0, querySelector: () => null,
      set outerHTML(v: string) { html = html.replace(m[0], v); n[count]++; },
      set innerHTML(v: string) { html = html.replace(m[0], m[0].replace(m[1]!, v)); n[count]++; },
    };
  };
  const app = {
    get innerHTML() { return html; },
    set innerHTML(v: string) { html = v; n.page++; },
    querySelector(sel: string) {
      if (sel === '.cdpage') return html.includes('cdpage') ? {} : null;
      if (sel === '.cdpack') return region(/<section class="ttpool cdpack"[\s\S]*?<\/section>/, 'band');
      if (sel === '.cdseats') return region(/<ol class="cdseats"[\s\S]*?<\/ol>/, 'seats');
      if (sel === '.frametitle') return region(/<h1 class="frametitle">([\s\S]*?)<\/h1>/, 'title');
      if (sel === '.cdclock') return { textContent: '', classList: { toggle: () => {} } };
      return null;
    },
  };
  return { app: app as unknown as HTMLElement, n, html: () => html };
}

const F = fakeApp();
tt.initTabletop({ app: F.app, rerender: () => {} });

const seats = (waitingThere: number) => [
  { name: 'Ann', bot: false, waiting: waitingThere, picks: 3, me: false },
  { name: 'You', bot: false, waiting: 1, picks: 3, me: true },
];
const draft = (over: Partial<CubeDraftView> = {}): CubeDraftView => ({
  packNo: 1, pickNo: 4, packs: 3, packSize: 10, direction: 'left', seats: seats(0),
  pack: PACK, deadline: NOW + 60_000, reserved: null, suggest: PACK[2]!, picks: DECK_LIST.slice(0, 3), ...over,
});
const cube = (d: CubeDraftView): CubeView => ({
  now: NOW, code: 'PUSH', phase: 'drafting', host: { user: 'u1', name: 'Ann' }, isHost: false, me: 'u2', joined: true,
  config: { name: 'Push cube', source: { kind: 'elements', elements: ['fire'] }, packs: null, packSize: null, minPlayers: 2,
    maxPlayers: 8, fillBots: true, startAt: null, tournament: 'swiss', swissRounds: 3, rules: 'casual', bestOf: 1 },
  players: [], poolSize: 320, packMath: [], myPool: null, myDeck: null, round: 0, breakUntil: null, pending: null,
  matches: [], standings: [], myMatch: null, draft: d,
});
const calls: string[] = [];
const acts = { reserve: (c: string) => { calls.push(`reserve ${c}`); }, pick: (c: string) => { calls.push(`pick ${c}`); }, arrange: () => {} };
const snap = () => ({ ...F.n });

test('§1 another player’s pick: the seats strip, in place', () => {
  paintCubeDraft(F.app, cube(draft()), acts);
  assert.ok(F.n.page >= 1, 'the first paint is the whole screen');
  assert.match(F.html(), /class="[^"]*ttpage cdpage"/);
  const was = snap();
  paintCubeDraft(F.app, cube(draft({ seats: seats(1) })), acts);
  assert.equal(F.n.page, was.page, 'the page is not painted again');
  assert.equal(F.n.band, was.band, 'the pack band is not redrawn');
  assert.equal(F.n.seats, was.seats + 1, 'the seats strip is');
  assert.match(F.html(), /aria-label="1 waiting"><i class="cddot"><\/i><\/span><\/li><li class="cdsep"/, 'with the new count');
  // the same push again: nothing at all
  const again = snap();
  paintCubeDraft(F.app, cube(draft({ seats: seats(1) })), acts);
  assert.deepEqual(snap(), again, 'nothing changed, nothing drawn');
});

test('§2 a tap rings at once; the echo redraws nothing', () => {
  const was = snap();
  cubeDraftButton('cd-card', { dataset: { cdCard: PACK[5]! } });
  assert.deepEqual(calls, [`reserve ${PACK[5]}`]);
  assert.equal(F.n.band, was.band + 1, 'the band, alone');
  assert.equal(F.n.page, was.page);
  assert.match(F.html(), new RegExp(`cdreserved"[^>]*data-cd-card="${PACK[5]}"`), 'ringed before the server answers');
  const echo = snap();
  paintCubeDraft(F.app, cube(draft({ seats: seats(1), reserved: PACK[5]! })), acts);
  assert.deepEqual(snap(), echo, 'the server’s echo of my choice changes nothing on screen');
});

test('§3 a press holds the band and the table until it lifts', () => {
  cubeDraftButton('cd-card', { dataset: { cdCard: PACK[5]! } });   // the second tap: taken
  assert.deepEqual(calls.slice(-1), [`pick ${PACK[5]}`]);
  cubeDraftPress(true);
  const was = snap();
  // the pack moved on and my pick is in: both the band and the table change
  paintCubeDraft(F.app, cube(draft({ pickNo: 5, pack: PACK.slice(6), seats: seats(1), picks: [...DECK_LIST.slice(0, 3), PACK[5]!] })), acts);
  assert.equal(F.n.page, was.page, 'held: the table waits');
  assert.equal(F.n.band, was.band, 'held: the band waits');
  tickCubeDraft();
  assert.equal(F.n.page, was.page, 'still held on the next beat');
  cubeDraftPress(false);
  tickCubeDraft();
  assert.equal(F.n.page, was.page + 1, 'the beat after the release draws it, once');
  assert.match(F.html(), new RegExp(`data-card="${PACK[5]}"`), 'the pick is on the table');
  tickCubeDraft();
  assert.equal(F.n.page, was.page + 1, 'and not again');
});

test('§4 the urgent clock redraws the band once', () => {
  const was = snap();
  // 9 s left by the server's clock: the suggestion is chosen for me (reserve) and the band shows it
  paintCubeDraft(F.app, { ...cube(draft({ pickNo: 6, pack: PACK.slice(7), suggest: PACK[8]!, deadline: NOW + 9_000, seats: seats(1),
    picks: [...DECK_LIST.slice(0, 3), PACK[5]!] })) }, acts);
  assert.equal(F.n.page, was.page, 'a new pack: still not the page');
  const after = snap();
  for (let i = 0; i < 6; i++) tickCubeDraft();
  assert.equal(F.n.band, after.band, 'the beats draw nothing more');
  assert.deepEqual(calls.slice(-1), [`reserve ${PACK[8]}`]);
  stopCubeDraft();
});
