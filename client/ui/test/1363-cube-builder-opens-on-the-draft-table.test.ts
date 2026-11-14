/* 1363 · THE BUILDER OPENS ON THE TABLE I LAID OUT (ui/cubebuild.ts, docs/25 §6, §13) — owner,
 * 2026-11-14: "When building, the layout you set during the draft should automatically be there,
 * for you".
 *
 *   §1 straight from the draft in this tab: the draft's piles, Sideboard and Maybe, and the last
 *      pick (not on the draft's table yet) landed by cost; the builder has a Maybe pile now
 *   §2 after a reload (no draft table in this tab): the server's layout — the draft's with every
 *      pick on it; the builder's own with the rest left in the pool
 *   §3 after a submit: the submitted deck, in the kept piles where its cards are there
 *   §4 every change on the builder's table is kept (acts.arrange, `from` build); Maybe never holds a
 *      card the deck and sideboard already use (a Suggest takes from it)
 *
 * Seeds: none. The table paints into a stand-in #app (no DOM).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import type { CubeArrange, CubeDraftView, CubeView } from '../../server/cube-types.ts';
import { cubeBuild, openCubeBuilder, type CubeBuildActs } from '../cubebuild.ts';
import { draftLayout, paintCubeDraft, stopCubeDraft } from '../cubedraft.ts';
import * as tt from '../tabletop.ts';

const ROOT = { innerHTML: '' } as unknown as HTMLElement;
tt.initTabletop({ app: ROOT, rerender: () => {} });
const POOL = DECK_LIST.slice(120, 160);
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const el = (btn: string, data: Record<string, string> = {}): HTMLElement => ({ dataset: { btn, ...data }, closest: () => null }) as unknown as HTMLElement;

const base = (code: string, over: Partial<CubeView> = {}): CubeView => ({
  now: 1, code, phase: 'building', host: { user: 'u1', name: 'Ann' }, isHost: false, me: 'u2', joined: true,
  config: { name: 'Layout cube', source: { kind: 'elements', elements: ['fire'] }, packs: null, packSize: null, minPlayers: 2,
    maxPlayers: 8, fillBots: true, startAt: null, tournament: 'swiss', swissRounds: 3, rules: 'casual', bestOf: 1 },
  players: [], poolSize: 320, packMath: [], draft: null, myPool: POOL, myDeck: null, myArrange: null, round: 0, breakUntil: null,
  pending: null, matches: [], standings: [], myMatch: null, ...over,
});
function acts(suggest?: { main: string[]; side: string[] }): CubeBuildActs & { kept: CubeArrange[] } {
  const a = {
    kept: [] as CubeArrange[],
    submit: async () => null, suggest: async () => suggest ?? null, back: () => {},
    arrange: (x: CubeArrange) => { a.kept.push(x); },
  };
  return a;
}

test('§1 straight from the draft: its table, the last pick by cost', () => {
  const picks = POOL.slice(0, 39);
  const d: CubeDraftView = { packNo: 3, pickNo: 13, packs: 3, packSize: 13, direction: 'left', seats: [], pack: [POOL[39]!],
    deadline: 999_999, reserved: null, suggest: null, picks };
  paintCubeDraft(ROOT, base('LAY1', { phase: 'drafting', draft: d, myPool: null }), { reserve: () => {}, pick: () => {}, arrange: () => {} });
  // the player laid some out: two to the Sideboard, one to Maybe
  const t = draftLayout('LAY1')!;
  t.side.push(...[POOL[0]!, POOL[1]!]);
  t.maybe.push(POOL[2]!);
  for (const p of t.piles) p.cards = p.cards.filter(n => n !== POOL[0] && n !== POOL[1] && n !== POOL[2]);
  stopCubeDraft();
  // the last pick made, the draft over: the builder opens (ui/cube.ts) on what this tab holds
  openCubeBuilder(base('LAY1'), acts());
  const b = cubeBuild()!;
  assert.deepEqual(b.side, [POOL[0], POOL[1]]);
  assert.deepEqual(b.maybe, [POOL[2]]);
  assert.equal(b.main.length, 37, 'every other pick in the main deck — the last one too');
  assert.ok(b.main.includes(POOL[39]!));
  assert.match(ROOT.innerHTML, /data-tt-zone="maybe"/, 'the builder has Maybe');
  tt.closeTabletop();
});

test('§2 after a reload: the server’s layout', () => {
  // the draft's: every pick on the table, a missing one by cost
  const draftKept: CubeArrange = { piles: [POOL.slice(0, 20)], names: ['Mine'], side: [POOL[20]!], maybe: [POOL[21]!], from: 'draft' };
  openCubeBuilder(base('LAY2', { myArrange: draftKept }), acts());
  let b = cubeBuild()!;
  assert.deepEqual(b.piles![0]!.name, 'Mine');
  assert.deepEqual(b.piles![0]!.cards, POOL.slice(0, 20));
  assert.equal(b.main.length + b.side.length + b.maybe.length, POOL.length, 'every drafted card on the table');
  tt.closeTabletop();
  // the builder's own: what is not on it is in the pool
  const built: CubeArrange = { piles: [POOL.slice(0, 25)], names: ['Deck'], side: [], maybe: [], from: 'build' };
  openCubeBuilder(base('LAY3', { myArrange: built }), acts());
  b = cubeBuild()!;
  assert.deepEqual(b.main, POOL.slice(0, 25), 'the rest stay in the pool');
  tt.closeTabletop();
});

test('§3 after a submit: the submitted deck, in the kept piles', () => {
  const kept: CubeArrange = { piles: [POOL.slice(0, 15), POOL.slice(15, 35)], names: ['Early', 'Late'], side: [], maybe: [POOL[36]!], from: 'build' };
  const deck = { main: [...POOL.slice(0, 10), ...POOL.slice(15, 35)], side: [POOL[36]!] };
  openCubeBuilder(base('LAY4', { myArrange: kept, myDeck: deck }), acts());
  const b = cubeBuild()!;
  assert.deepEqual(b.piles!.find(p => p.name === 'Early')!.cards, POOL.slice(0, 10));
  assert.deepEqual(b.piles!.find(p => p.name === 'Late')!.cards, POOL.slice(15, 35));
  assert.deepEqual(b.side, [POOL[36]]);
  assert.deepEqual(b.maybe, [], 'Maybe less what the sideboard uses');
  tt.closeTabletop();
});

test('§4 every change kept; Maybe gives way to a Suggest', async () => {
  const kept: CubeArrange = { piles: [POOL.slice(0, 5)], side: [], maybe: [POOL[5]!], from: 'build' };
  const a = acts({ main: POOL.slice(5, 35), side: [] });
  openCubeBuilder(base('LAY5', { myArrange: kept }), a);
  tt.handleButton(el('tt-addpile'));
  assert.equal(a.kept.at(-1)!.from, 'build');
  assert.equal(a.kept.at(-1)!.piles.length, 2, 'the new pile is kept');
  tt.handleButton(el('tt-cube-suggest'));
  await flush();
  assert.ok(cubeBuild()!.main.includes(POOL[5]!));
  assert.deepEqual(cubeBuild()!.maybe, [], 'the suggested deck took it from Maybe: never twice on the table');
  tt.closeTabletop();
});
