/* 1381 · A CHOICE RINGS ITS TILE, NOTHING ELSE (ui/cubedraft.ts patchRing) — the Chrome walk of
 * 2026-11-14: reserving a card (one tap) rebuilt the whole pack band, every tile element replaced,
 * for a ring on one card. Now a choice moves the ring on the tiles it concerns and leaves the rest
 * of the band alone (1360 §2 keeps its meaning: a tap rings at once, the echo redraws nothing).
 *
 *   §1 the draw keys: a view differing only in the chosen card (or the clock's hint) moves the
 *      ring's key, not the band's; a new pick, a new tile size moves the band's
 *   §2 a tap: the band is not rebuilt, the tapped tile is ringed (class and aria-pressed), Confirm
 *      comes on; another tap moves the ring — the old tile and the new one, no other tile written
 *   §3 under a press the ring still moves (it replaces nothing a pointer could be over), while a
 *      new pack waits for the release
 *   §4 the auto-choice at ten seconds rings its tile the same way, the band not rebuilt
 *
 * Seeds: none. A stand-in #app whose regions and tiles are found in its markup and counted as they are written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import type { CubeDraftView, CubeView } from '../../server/cube-types.ts';
import { cubeDraftButton, cubeDraftPress, drawKeys, paintCubeDraft, stopCubeDraft, tickCubeDraft } from '../cubedraft.ts';
import { packView } from './cubedraft-fixture.ts';
import * as tt from '../tabletop.ts';

const PACK = DECK_LIST.slice(80, 92);
const NOW = 7_000_000;

/** a stand-in #app: the page's markup, and a count of every write — whole, or one region's */
function fakeApp() {
  let html = '';
  const n = { page: 0, band: 0, seats: 0, title: 0, tile: 0 };
  /** one tag found by `re`, rewritten in place (a tile's ring, Confirm's disabled) — every write counted as `tile` */
  const tag = (re: RegExp) => {
    const edit = (f: (t: string) => string): void => {
      const m = re.exec(html);
      if (m) { html = html.replace(m[0], f(m[0])); n.tile++; }
    };
    return {
      classList: { toggle: (c: string, on: boolean) => edit(t => t.replace(/class="([^"]*)"/, (_, cls: string) => {
        const list = cls.split(' ').filter(x => x && x !== c);
        return `class="${(on ? [...list, c] : list).join(' ')}"`;
      })) },
      setAttribute: (a: string, v: string) => edit(t => t.replace(new RegExp(`${a}="[^"]*"`), `${a}="${v}"`)),
      set disabled(on: boolean) { edit(t => t.replace(/ disabled(?=[ >])/, '').replace(/>$/, on ? ' disabled>' : '>')); },
    };
  };
  const region = (re: RegExp, count: Exclude<keyof typeof n, 'tile'>) => {
    const m = re.exec(html);
    if (!m) return null;
    return {
      dataset: {}, scrollTop: 0,
      querySelector: (sel: string) => (sel === '.cdconfirm' ? tag(/<button[^>]*data-btn="cd-confirm"[^>]*>/) : null),
      querySelectorAll: (sel: string) => {
        const card = /^\[data-cd-card="(.*)"\]$/.exec(sel)?.[1];
        if (!card) return [];
        const at = new RegExp(`<div class="[^"]*" data-btn="cd-card" data-cd-card="${card.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
        return at.test(html) ? [tag(at)] : [];
      },
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

const draft = (over: Partial<CubeDraftView> = {}): CubeDraftView => ({
  packNo: 1, pickNo: 2, packs: 3, packSize: 12, direction: 'left',
  seats: [{ name: 'Ann', bot: false, waiting: 0, picks: 1, me: false }, { name: 'You', bot: false, waiting: 1, picks: 1, me: true }],
  pack: PACK, deadline: NOW + 60_000, reserved: null, suggest: PACK[7]!, picks: DECK_LIST.slice(0, 1), ...over,
});
const cube = (d: CubeDraftView): CubeView => ({
  now: NOW, code: 'RING', phase: 'drafting', host: { user: 'u1', name: 'Ann' }, isHost: false, me: 'u2', joined: true,
  config: { name: 'Ring cube', source: { kind: 'elements', elements: ['fire'] }, packs: null, packSize: null, minPlayers: 2,
    maxPlayers: 8, fillBots: true, startAt: null, tournament: 'swiss', swissRounds: 3, rules: 'casual', bestOf: 1 },
  players: [], poolSize: 320, packMath: [], myPool: null, myDeck: null, round: 0, breakUntil: null, pending: null,
  matches: [], standings: [], myMatch: null, draft: d,
});
const calls: string[] = [];
const acts = { reserve: (c: string) => { calls.push(`reserve ${c}`); }, pick: (c: string) => { calls.push(`pick ${c}`); }, arrange: () => {} };
const tap = (card: string): void => { cubeDraftButton('cd-card', { dataset: { cdCard: card } }); };
const tiles = (): Map<string, string> => new Map([...F.html().matchAll(/<div class="[^"]*" data-btn="cd-card" data-cd-card="([^"]+)"[^>]*>/g)].map(m => [m[1]!, m[0]]));
const changedTiles = (before: Map<string, string>): string[] => [...tiles()].filter(([k, t]) => before.get(k) !== t).map(([k]) => k).sort();
const ringed = (card: string): boolean => /cdreserved/.test(tiles().get(card) ?? '') && /aria-pressed="true"/.test(tiles().get(card) ?? '');

test('§1 the draw keys: the ring apart from the band', () => {
  const v = packView({ pack: PACK, reserved: null, msLeft: 60_000, suggest: PACK[7]! });
  const chose = drawKeys({ ...v, reserved: PACK[2]! });
  assert.equal(chose.band, drawKeys(v).band, 'a choice: the band key is the same');
  assert.notEqual(chose.ring, drawKeys(v).ring, 'the ring key moves');
  const hint = drawKeys({ ...v, msLeft: 9_000 });
  assert.equal(hint.band, drawKeys(v).band, 'the clock turning urgent (the hint): not the band');
  assert.notEqual(hint.ring, drawKeys(v).ring, 'the ring');
  assert.notEqual(drawKeys({ ...v, pickNo: (v.pickNo ?? 0) + 1 }).band, drawKeys(v).band, 'a new pick: the band');
  assert.notEqual(drawKeys({ ...v, pw: v.pw + 10 }).band, drawKeys(v).band, 'a new tile size: the band');
});

test('§2 a tap rings its tile; another moves the ring, two tiles only', () => {
  paintCubeDraft(F.app, cube(draft()), acts);
  assert.equal(tiles().size, PACK.length, 'positive control: every tile is found');
  assert.match(F.html(), /data-btn="cd-confirm" type="button" disabled>/);
  const was = { ...F.n };
  let before = tiles();
  tap(PACK[2]!);
  assert.deepEqual(calls, [`reserve ${PACK[2]}`]);
  assert.equal(F.n.band, was.band, 'the band is not rebuilt');
  assert.equal(F.n.page, was.page, 'nor the page');
  assert.ok(ringed(PACK[2]!), 'the tapped tile is ringed');
  assert.deepEqual(changedTiles(before), [PACK[2]!], 'no other tile changed');
  // a tile's ring is three writes (two classes, aria-pressed), Confirm one: no other tile is even written
  assert.ok(F.n.tile - was.tile <= 3 + 1, `${F.n.tile - was.tile} writes: the one tile and Confirm`);
  assert.match(F.html(), /data-btn="cd-confirm" type="button">/, 'Confirm is on');
  before = tiles();
  const w2 = F.n.tile;
  tap(PACK[9]!);
  assert.ok(F.n.tile - w2 <= 2 * 3 + 1, `${F.n.tile - w2} writes: the two tiles and Confirm`);
  assert.equal(F.n.band, was.band, 'still not rebuilt');
  assert.ok(ringed(PACK[9]!) && !ringed(PACK[2]!), 'the ring moved');
  assert.deepEqual(changedTiles(before), [PACK[2]!, PACK[9]!].sort(), 'the old tile and the new one, no other');
  // the server's echo: nothing
  const echo = { ...F.n };
  paintCubeDraft(F.app, cube(draft({ reserved: PACK[9]! })), acts);
  assert.deepEqual(F.n, echo, 'the echo writes nothing');
});

test('§3 under a press the ring moves; a new pack waits', () => {
  cubeDraftPress(true);
  const was = { ...F.n };
  tap(PACK[4]!);
  assert.ok(ringed(PACK[4]!) && !ringed(PACK[9]!), 'ringed under the press');
  assert.equal(F.n.band, was.band);
  paintCubeDraft(F.app, cube(draft({ pickNo: 3, pack: PACK.slice(1), reserved: PACK[4]! })), acts);
  assert.equal(F.n.band, was.band, 'a new pack: held');
  cubeDraftPress(false);
  tickCubeDraft();
  assert.equal(F.n.band, was.band + 1, 'drawn after the release');
  assert.ok(!tiles().has(PACK[0]!), 'the new pack');
});

test('§4 the auto-choice at ten seconds rings its tile in place', () => {
  const was = { ...F.n };
  const before = tiles();
  // the same pick, its clock now at 9 s by the server: the suggestion is chosen for me
  paintCubeDraft(F.app, { ...cube(draft({ pickNo: 3, pack: PACK.slice(1), deadline: NOW + 9_000, reserved: null })) }, acts);
  assert.deepEqual(calls.slice(-1), [`reserve ${PACK[7]}`]);
  assert.equal(F.n.band, was.band, 'the band is not rebuilt');
  assert.ok(ringed(PACK[7]!), 'the suggestion is ringed');
  assert.ok(changedTiles(before).every(c => c === PACK[7] || c === PACK[4]), `only the tiles concerned: ${changedTiles(before).join(', ')}`);
  stopCubeDraft();
});
