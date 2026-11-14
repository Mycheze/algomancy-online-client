/* 1344 · THE PICK SCREEN'S CONTROLLER (ui/cubedraft.ts, docs/25 §4) — the auto-choice at ten
 * seconds as a pure function on made-up times, and every route to a pick through a stand-in #app.
 *
 *   §1 autoReserve: nothing over 10 s; the suggestion at ≤10 s (by the server's time); never with a
 *      card chosen, without a pack, a deadline or a suggestion, or a suggestion not in the pack;
 *      once per pick (pickKey)
 *   §2 painted under 10 s with nothing chosen, the screen chooses the suggestion — acts.reserve
 *      ONCE, however many beats follow; the server's clock is the view's `now`, not this one's
 *   §3 a tap chooses (reserve), a tap on the chosen card takes it (pick); Confirm takes the chosen
 *      card; after a take nothing more is taken until the pack moves on
 *   §4 a drag onto the deck table takes the card (the click's own door); a drag off the table does
 *      not; no drag while waiting
 *   §5 the clock is one setInterval, and nothing in the module re-arms a setTimeout
 *
 * Seeds: none. The stand-in #app has no DOM: the tabletop (the pick screen is its host) writes its innerHTML.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import type { CubeDraftView, CubeView } from '../../server/cube-types.ts';
import { autoReserve, cubeDraftButton, cubeDraftDrag, paintCubeDraft, pickKey, stopCubeDraft, tickCubeDraft } from '../cubedraft.ts';
import * as tt from '../tabletop.ts';

const PACK = DECK_LIST.slice(60, 66);
const NOW = 5_000_000;

const draft = (over: Partial<CubeDraftView> = {}): CubeDraftView => ({
  packNo: 1, pickNo: 3, packs: 3, packSize: 8, direction: 'left',
  seats: [{ name: 'Ben', bot: false, waiting: 1, picks: 2, me: true }, { name: 'Bot 1', bot: true, waiting: 0, picks: 2, me: false }],
  pack: PACK, deadline: NOW + 30_000, reserved: null, suggest: PACK[4]!, picks: DECK_LIST.slice(0, 2), ...over,
});
const cube = (d: CubeDraftView | null, now = NOW): CubeView => ({
  now, code: 'ZXCV', phase: 'drafting', host: { user: 'u1', name: 'Ann' }, isHost: false, me: 'u2', joined: true,
  config: { name: 'Test cube', source: { kind: 'elements', elements: ['fire'] }, packs: null, packSize: null, minPlayers: 2,
    maxPlayers: 8, fillBots: true, startAt: null, tournament: 'swiss', swissRounds: 3, rules: 'casual', bestOf: 1 },
  players: [], poolSize: 320, packMath: [], myPool: null, myDeck: null, round: 0, breakUntil: null, pending: null,
  matches: [], standings: [], myMatch: null, draft: d,
});

/** the acts, recording */
function acts(): { calls: string[]; reserve(c: string): void; pick(c: string): void } {
  const calls: string[] = [];
  return { calls, reserve: c => { calls.push(`reserve ${c}`); }, pick: c => { calls.push(`pick ${c}`); } };
}
const ROOT = { innerHTML: '' } as unknown as HTMLElement;
tt.initTabletop({ app: ROOT, rerender: () => {} });
/** the one #app (the tabletop paints into it), emptied */
const app = (): HTMLElement => { stopCubeDraft(); ROOT.innerHTML = ''; return ROOT; };
const tile = (card: string) => ({ dataset: { cdCard: card } as Record<string, string | undefined> });

test('§1 autoReserve, pure', () => {
  const d = draft();
  const at = (left: number): number => d.deadline! - left;
  assert.equal(autoReserve(d, at(10_001), null, null), null, 'over 10 s: nothing');
  assert.equal(autoReserve(d, at(10_000), null, null), PACK[4], 'at 10 s: the suggestion');
  assert.equal(autoReserve(d, at(500), null, null), PACK[4]);
  assert.equal(autoReserve(d, at(5000), PACK[1]!, null), null, 'a card chosen: left alone');
  assert.equal(autoReserve(d, at(5000), null, pickKey(d)), null, 'once per pick');
  assert.equal(autoReserve(draft({ pickNo: 4, pack: PACK.slice(1) }), at(5000), null, pickKey(d)), PACK[4], 'the next pick fires again');
  assert.equal(autoReserve(draft({ pack: null }), at(5000), null, null), null, 'no pack');
  assert.equal(autoReserve(draft({ deadline: null }), 0, null, null), null, 'no deadline');
  assert.equal(autoReserve(draft({ suggest: null }), at(5000), null, null), null, 'no suggestion');
  assert.equal(autoReserve(draft({ suggest: 'Nope' }), at(5000), null, null), null, 'a suggestion not in the pack');
  assert.equal(autoReserve(null, 0, null, null), null);
  assert.notEqual(pickKey(draft()), pickKey(draft({ pickNo: 4 })));
});

test('§2 painted at 9 s: the suggestion chosen, once — by the server’s clock', () => {
  const a = acts();
  // the server's `now` is far from this machine's: only the skew-corrected clock is under 10 s
  paintCubeDraft(app(), cube(draft({ deadline: NOW + 9_000 })), a, () => {});
  assert.deepEqual(a.calls, [`reserve ${PACK[4]}`]);
  for (let i = 0; i < 5; i++) tickCubeDraft();
  assert.deepEqual(a.calls, [`reserve ${PACK[4]}`], 'once');
  // the same view at 30 s chooses nothing
  const b = acts();
  paintCubeDraft(app(), cube(draft({ pickNo: 7 })), b, () => {});
  tickCubeDraft();
  assert.deepEqual(b.calls, []);
  stopCubeDraft();
});

test('§3 tap, tap again, Confirm, and no second take', () => {
  const a = acts();
  const root = app();
  paintCubeDraft(root, cube(draft()), a, () => {});
  cubeDraftButton('cd-card', tile(PACK[0]!));
  assert.deepEqual(a.calls, [`reserve ${PACK[0]}`]);
  assert.match(root.innerHTML, new RegExp(`cdreserved"[^>]*data-cd-card="${PACK[0]}"`), 'ringed at once, before the server echoes it');
  cubeDraftButton('cd-card', tile(PACK[1]!));
  cubeDraftButton('cd-card', tile(PACK[1]!));
  assert.deepEqual(a.calls, [`reserve ${PACK[0]}`, `reserve ${PACK[1]}`, `pick ${PACK[1]}`], 'a second tap takes it');
  cubeDraftButton('cd-card', tile(PACK[2]!));
  cubeDraftButton('cd-confirm');
  assert.equal(a.calls.length, 3, 'taken: nothing more this pick');
  // the pack moves on: the server's echo of my choice, then Confirm
  paintCubeDraft(root, cube(draft({ pickNo: 4, pack: PACK.slice(2), reserved: PACK[3]! })), a, () => {});
  cubeDraftButton('cd-confirm');
  assert.deepEqual(a.calls.slice(3), [`pick ${PACK[3]}`], 'Confirm takes the server’s chosen card');
  assert.equal(cubeDraftButton('tt-add'), false, 'not ours');
  stopCubeDraft();
});

test('§4 the drag is the take', () => {
  const a = acts();
  paintCubeDraft(app(), cube(draft()), a, () => {});
  const src = { ...tile(PACK[5]!), closest: () => null } as unknown as HTMLElement;
  const plan = cubeDraftDrag.plan(src);
  assert.ok(plan, 'a pack card may be picked up');
  const wrap = { dataset: {} } as unknown as Element;
  const pile = { dataset: { ttZone: 'pile|p1' } } as unknown as Element;
  const felt = { dataset: { ttZone: 'end' } } as unknown as Element;
  const over = (zone: Element) => ({ closest: (s: string) => (s === '.tttablewrap' ? wrap : s === '[data-tt-zone]' ? zone : null) }) as unknown as Element;
  const offPicks = { closest: () => null } as unknown as Element;
  assert.equal(plan!.zoneAt(offPicks), null, 'over the pack: nowhere');
  assert.equal(plan!.zoneAt(over(pile)), pile, 'over a pile: that pile');
  assert.equal(plan!.zoneAt(over(felt)), wrap, 'over the bare felt: the table');
  assert.equal(plan!.drop(pile, 0, 0), true);
  assert.deepEqual(a.calls, [`pick ${PACK[5]}`]);
  assert.equal(cubeDraftDrag.plan(src), null, 'taken: no second drag');
  paintCubeDraft(app(), cube(draft({ pack: null, deadline: null })), a, () => {});
  assert.equal(cubeDraftDrag.plan(src), null, 'waiting: nothing to drag');
  stopCubeDraft();
});

test('§5 one interval; no re-arming timeout', () => {
  const src = readFileSync(new URL('../cubedraft.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.equal((src.match(/\bsetInterval\(/g) ?? []).length, 1, 'one setInterval');
  assert.equal(/\bsetTimeout\(/.test(src), false, 'no setTimeout');
  assert.match(src, /clearInterval\(timer\)/);
});
