/* 1343 · THE CUBE DRAFT'S PICK SCREEN (pages/cubedraft.ts, docs/25 §4) — DOM-free, from made-up views.
 *
 *   §1 a pack: every card a tile (`cd-card`, `data-cd-card`, zoomable), in the builder's
 *      layout (`ttpage cdpage`, the band, the divider, the picks table); Pack · Pick and
 *      the direction in the title; the clock in the tools
 *   §2 the chosen card is ringed and pressed; Confirm is on only with a card chosen, and
 *      off again once it is taken
 *   §3 ≤10 s: the clock is red and, nothing chosen, the suggestion is ringed; over 10 s
 *      neither; a chosen card wins over the suggestion
 *   §4 waiting for a pack: the band says so, no tiles, no Confirm, no clock — the picks stay
 *   §5 the table strip (in the pack's bar, waiting too): every seat in order, "You" lit, bots marked, the waiting packs as
 *      dots, the arrows the way the packs go
 *   §6 the picks: piles by cost, shown not edited (no tt- taps), the felt is the drop zone
 *   §7 the view: the deadline counted by the server's time; the draft over shows its line
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import type { CubeView } from '../../server/cube-types.ts';
import { clockText, cubeDraftHtml, cubeDraftView, URGENT_MS, type CubeDraftPageView } from '../pages/cubedraft.ts';

const PACK = DECK_LIST.slice(40, 46);
const PICKS = DECK_LIST.slice(0, 5);

const CUBE: CubeView = {
  now: 1_000_000, code: 'QWER', phase: 'drafting', host: { user: 'u1', name: 'Ann' }, isHost: false, me: 'u2', joined: true,
  config: { name: "Ann's cube", source: { kind: 'elements', elements: ['fire', 'water'] }, packs: null, packSize: null, minPlayers: 2,
    maxPlayers: 8, fillBots: true, startAt: null, tournament: 'swiss', swissRounds: 3, rules: 'casual', bestOf: 1 },
  players: [], poolSize: 320, packMath: [], myPool: null, myDeck: null, round: 0, breakUntil: null, pending: null,
  matches: [], standings: [], myMatch: null,
  draft: {
    packNo: 2, pickNo: 5, packs: 3, packSize: 13, direction: 'right',
    seats: [
      { name: 'Ann', bot: false, waiting: 1, picks: 17, me: false },
      { name: 'Bot 1', bot: true, waiting: 3, picks: 16, me: false },
      { name: 'Ben', bot: false, waiting: 1, picks: 16, me: true },
    ],
    pack: PACK, deadline: 1_042_000, reserved: null, suggest: PACK[2]!, picks: PICKS,
  },
};

const viewOf = (over: Partial<CubeView['draft'] & object> = {}, local: Partial<{ reserved: string | null; taken: string | null; serverNow: number }> = {}): CubeDraftPageView =>
  cubeDraftView({ ...CUBE, draft: { ...CUBE.draft!, ...over } }, { reserved: null, taken: null, serverNow: CUBE.now, ...local });

const tiles = (html: string): string[] => [...html.matchAll(/<div class="ttpooltile cdtile[^"]*" data-btn="cd-card" data-cd-card="([^"]+)"/g)].map(m => m[1]!);
const tileOf = (html: string, name: string): string => new RegExp(`<div class="ttpooltile cdtile[^"]*"[^>]*data-cd-card="${name}"[^>]*>`).exec(html)?.[0] ?? '';
const confirm = (html: string): string => /<button[^>]*data-btn="cd-confirm"[^>]*>/.exec(html)?.[0] ?? '';

test('§1 the pack in the builder’s layout', () => {
  const html = cubeDraftHtml(viewOf());
  assert.match(html, /class="[^"]*apppage[^"]* ttpage cdpage"/, 'the builder’s look, cdpage last');
  assert.deepEqual(tiles(html), PACK, 'every card of the pack, in order');
  for (const n of PACK) assert.match(tileOf(html, n), /data-zoom/, `${n} zooms`);
  assert.match(html, /<section class="ttpool cdpack" data-cd-zone="pack"/);
  assert.match(html, /class="ttdivider"/);
  assert.match(html, /data-btn="cd-split"[^>]*data-by="-1"/);
  assert.match(html, /class="tttablewrap/);
  assert.match(html, /<span class="cdwhere">Pack 2 · Pick 5<\/span><small class="cddir">Passing right<\/small>/);
  assert.match(html, /<span class="cdclock" role="timer" aria-label="Time left">0:42<\/span>/);
  assert.match(html, /data-btn="cube-close"/, 'the way back to the event');
});

test('§2 chosen, Confirm, taken', () => {
  let html = cubeDraftHtml(viewOf());
  assert.match(confirm(html), /disabled/, 'nothing chosen: Confirm is off');
  html = cubeDraftHtml(viewOf({}, { reserved: PACK[1]! }));
  assert.match(tileOf(html, PACK[1]!), /cdreserved/);
  assert.match(tileOf(html, PACK[1]!), /aria-pressed="true"/);
  assert.equal(tiles(html).filter(n => /cdreserved/.test(tileOf(html, n))).length, 1, 'one card ringed');
  assert.doesNotMatch(confirm(html), /disabled/, 'a card chosen: Confirm is on');
  html = cubeDraftHtml(viewOf({}, { reserved: PACK[1]!, taken: PACK[1]! }));
  assert.match(tileOf(html, PACK[1]!), /cdtaken/);
  assert.match(confirm(html), /disabled/, 'taken: no second take');
});

test('§3 ten seconds: red, and the suggestion ringed when nothing is chosen', () => {
  const at = (ms: number, reserved: string | null = null): string => cubeDraftHtml(viewOf({}, { reserved, serverNow: CUBE.draft!.deadline! - ms }));
  let html = at(URGENT_MS + 1000);
  assert.match(html, /<span class="cdclock" /);
  assert.equal(html.includes('cdhint'), false);
  html = at(URGENT_MS);
  assert.match(html, /<span class="cdclock cdurgent" [^>]*>0:10</);
  assert.match(tileOf(html, PACK[2]!), /cdhint/, 'the suggestion');
  html = at(4000, PACK[0]!);
  assert.equal(html.includes('cdhint'), false, 'a chosen card is not second-guessed');
  assert.match(tileOf(html, PACK[0]!), /cdreserved/);
});

test('§4 waiting for the next pack', () => {
  const html = cubeDraftHtml(viewOf({ pack: null, deadline: null }));
  assert.deepEqual(tiles(html), []);
  assert.match(html, /Waiting for the next pack/);
  assert.equal(confirm(html), '', 'no Confirm');
  assert.equal(html.includes('cdclock'), false, 'no clock');
  assert.match(html, /<b class="ttheadcount">5<\/b>/, 'the picks stay');
});

test('§5 the table strip', () => {
  const html = cubeDraftHtml(viewOf());
  const strip = /<ol class="cdseats"[\s\S]*?<\/ol>/.exec(html)?.[0] ?? '';
  assert.match(html, /<div class="ttpoolbar cdpackbar"><ol class="cdseats"/, 'in the pack’s bar');
  assert.match(cubeDraftHtml(viewOf({ pack: null })), /<ol class="cdseats"/, 'and while waiting');
  const seats = [...strip.matchAll(/<li class="cdseat([^"]*)"><span class="cdseatname">([^<]+)<\/span><span class="cdwait" aria-label="(\d+) waiting">((?:<i class="cddot"><\/i>)*)/g)];
  assert.deepEqual(seats.map(s => s[2]), ['Ann', 'Bot 1', 'You']);
  assert.deepEqual(seats.map(s => s[1]!.trim()), ['', 'cdbot', 'cdme']);
  assert.deepEqual(seats.map(s => (s[4]!.match(/cddot/g) ?? []).length), [1, 3, 1], 'a dot a waiting pack');
  assert.equal((strip.match(/class="cdsep" aria-hidden="true">←</g) ?? []).length, 2, 'passing right: ← between seats');
  const left = cubeDraftHtml(viewOf({ direction: 'left' }));
  assert.match(left, /class="cdsep" aria-hidden="true">→</);
});

test('§6 the picks: piles, shown not edited, the drop zone', () => {
  const html = cubeDraftHtml(viewOf());
  assert.match(html, /<div class="tttable" data-scroll="cd-picks" data-cd-zone="picks">/);
  const cards = [...html.matchAll(/class="ttcard[^"]*"[^>]*data-card="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual([...cards].sort(), [...PICKS].sort(), 'every pick on the table');
  assert.equal(/data-btn="tt-/.test(html), false, 'no builder taps here');
  assert.match(html, /<span class="ttheadlabel">Your picks<\/span><b class="ttheadcount">5<\/b>/);
  assert.match(html, /Tap a card, then Confirm, or drag it here\./, 'what to do, where it lands');
  assert.equal(cubeDraftHtml(viewOf({ pack: null })).includes('drag it here'), false, 'nothing to do while waiting');
});

test('§7 the view: the server’s clock; the draft over', () => {
  assert.equal(viewOf({}, { serverNow: 1_030_500 }).msLeft, 11_500);
  assert.equal(viewOf({ pack: null }).msLeft, null, 'no pack, no clock');
  assert.equal(clockText(90_000), '1:30');
  assert.equal(clockText(9_001), '0:10', 'a part second shows as the next one up');
  assert.equal(clockText(-500), '0:00');
  const over = cubeDraftHtml(cubeDraftView({ ...CUBE, draft: null, phase: 'building', myPool: PICKS }, { reserved: null, taken: null, serverNow: CUBE.now }));
  assert.match(over, /The draft is over/);
  assert.match(over, /<b class="ttheadcount">5<\/b>/, 'the pool shows as the picks');
});
