/* 1346 · A CUBE EVENT'S BUILDER (ui/cubebuild.ts, docs/25 §6) — the tabletop on my drafted pool.
 *
 *   §1 openCubeBuilder: the event's name, Back to the event, Suggest and Submit deck,
 *      the sideboard n/7, only the drafted cards in the pool; it starts from my submitted deck
 *   §2 Suggest a deck fills the main deck AND the sideboard as one step: Undo takes it back
 *   §3 Save and submit sends both boards; the server's refusal shows in the note row; taken, the
 *      note says so and the button says Submitted (off) while the deck is the submitted one
 *   §4 the pill: n / 30 and what is wrong, until it is a deck
 *   §5 Back calls acts.back and the table is gone; reopened, the table is as it was left
 *   §6 the cube's deck never touches the deck collection: nothing in cubebuild.ts reaches it
 *
 * Seeds: none. The table paints into a stand-in #app (no DOM).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import type { CubeView } from '../../server/cube-types.ts';
import * as tt from '../tabletop.ts';
import { cubeBuild, cubeDeckProblems, cubeTableWanted, openCubeBuilder, type CubeBuildActs } from '../cubebuild.ts';

const POOL = DECK_LIST.slice(100, 140);   // 40 drafted cards, one of each
const root = { innerHTML: '' } as unknown as HTMLElement;
tt.initTabletop({ app: root, rerender: () => {} });

const view = (over: Partial<CubeView> = {}): CubeView => ({
  now: 1, code: 'BLDR', phase: 'building', host: { user: 'u1', name: 'Ann' }, isHost: false, me: 'u2', joined: true,
  config: { name: 'Friday cube', source: { kind: 'elements', elements: ['fire'] }, packs: null, packSize: null, minPlayers: 2,
    maxPlayers: 8, fillBots: true, startAt: null, tournament: 'swiss', swissRounds: 3, rules: 'casual', bestOf: 1 },
  players: [], poolSize: 320, packMath: [], draft: null, myPool: POOL, myDeck: null, round: 0, breakUntil: null, pending: null,
  matches: [], standings: [], myMatch: null, ...over,
});
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const el = (btn: string): HTMLElement => ({ dataset: { btn }, closest: () => null }) as unknown as HTMLElement;
const btnTag = (html: string, b: string): string => new RegExp(`<button[^>]*data-btn="${b}"[^>]*>([^<]*)`).exec(html)?.[0] ?? '';
const NOTE = (html: string): string | null => /<div class="ttnote" role="status">([^<]*)<\/div>/.exec(html)?.[1] ?? null;

function acts(o: { suggest?: { main: string[]; side: string[] } | null; submit?: string | null } = {}): CubeBuildActs & { sent: [string[], string[]][]; backs: number } {
  const a = {
    sent: [] as [string[], string[]][], backs: 0,
    submit: async (main: string[], side: string[]) => { a.sent.push([main, side]); return o.submit ?? null; },
    suggest: async () => o.suggest ?? null,
    back: () => { a.backs++; },
  };
  return a;
}

test('§1 the builder on my pool', () => {
  openCubeBuilder(view({ myDeck: { main: POOL.slice(0, 3), side: [POOL[5]!] } }), acts());
  const html = root.innerHTML;
  assert.equal(tt.screen(), 'tabletop');
  assert.match(html, /<span class="tttitletext">Friday cube<\/span>/);
  assert.match(html, /data-btn="tt-close"[\s\S]*?Event/);
  assert.match(btnTag(html, 'tt-cube-suggest'), />Suggest$/);
  assert.match(btnTag(html, 'tt-cube-submit'), /Submitted/, 'the deck on the table is the submitted one');
  assert.match(html, /class="ttpilecount">1\/7</, 'the sideboard, 1/7');
  const tiles = [...html.matchAll(/data-tt-src="binder\|([^"]+)"/g)].map(m => m[1]!);
  assert.deepEqual(tiles.sort(), [...POOL].sort(), 'only what I drafted');
  assert.deepEqual([...cubeBuild()!.main], POOL.slice(0, 3), 'from my submitted deck');
  tt.closeTabletop();
});

test('§2 Suggest a deck: both boards, one undoable step', async () => {
  const main = POOL.slice(0, 30), side = POOL.slice(30, 37);
  openCubeBuilder(view({ code: 'SUGG' }), acts({ suggest: { main, side } }));
  assert.deepEqual(cubeBuild()!.main, [], 'no deck submitted: empty');
  tt.handleButton(el('tt-cube-suggest'));
  await flush();
  assert.deepEqual([...cubeBuild()!.main].sort(), [...main].sort());
  assert.deepEqual([...cubeBuild()!.side], side);
  assert.match(root.innerHTML, /30 cards/);
  tt.handleButton(el('tt-undo'));
  assert.deepEqual([cubeBuild()!.main, cubeBuild()!.side], [[], []], 'Undo takes it back');
  tt.closeTabletop();
});

test('§3 Save and submit: refused, then taken', async () => {
  const deck = { main: POOL.slice(0, 30), side: POOL.slice(30, 32) };
  const no = acts({ suggest: deck, submit: 'Your deck needs 30 cards.' });
  openCubeBuilder(view({ code: 'SUB1' }), no);
  tt.handleButton(el('tt-cube-suggest'));
  await flush();
  tt.handleButton(el('tt-cube-submit'));
  await flush();
  assert.equal(no.sent.length, 1);
  assert.deepEqual(no.sent[0]!.map(l => [...l].sort()), [[...deck.main].sort(), [...deck.side].sort()], 'both boards sent');
  assert.equal(NOTE(root.innerHTML), 'Your deck needs 30 cards.');
  tt.closeTabletop();
  const yes = acts({ suggest: deck, submit: null });
  openCubeBuilder(view({ code: 'SUB2' }), yes);
  tt.handleButton(el('tt-cube-suggest'));
  await flush();
  tt.handleButton(el('tt-cube-submit'));
  await flush();
  assert.equal(NOTE(root.innerHTML), 'Deck submitted.');
  // the server's next view carries the deck: the button says so
  openCubeBuilder(view({ code: 'SUB2', myDeck: { main: [...cubeBuild()!.main], side: [...cubeBuild()!.side] } }), yes);
  assert.match(btnTag(root.innerHTML, 'tt-cube-submit'), /disabled[^>]*>Submitted/);
  tt.closeTabletop();
});

test('§4 the pill and what is wrong', () => {
  assert.deepEqual(cubeDeckProblems(POOL.slice(0, 27), [], POOL), ['3 cards short of 30']);
  assert.deepEqual(cubeDeckProblems(POOL.slice(0, 30), POOL.slice(30, 38), POOL), ['The sideboard holds 7 at most']);
  assert.deepEqual(cubeDeckProblems([...POOL.slice(0, 29), POOL[0]!], [], POOL), [`Not in your pool: ${POOL[0]}`]);
  assert.deepEqual(cubeDeckProblems(POOL.slice(0, 30), POOL.slice(30, 37), POOL), []);
  openCubeBuilder(view({ code: 'PILL', myDeck: { main: POOL.slice(0, 27), side: [] } }), acts());
  assert.match(root.innerHTML, /data-btn="tt-problems"[^>]*>27 \/ 30</);
  tt.closeTabletop();
});

test('§5 Back, and back in', () => {
  const a = acts();
  openCubeBuilder(view({ code: 'BACK' }), a);
  tt.handleButton({ dataset: { btn: 'tt-add', ttSrc: `binder|${POOL[0]}` }, closest: () => null } as unknown as HTMLElement);
  assert.deepEqual([...cubeBuild()!.main], [POOL[0]], 'a tap on the pool adds it');
  tt.handleButton(el('tt-close'));
  assert.equal(a.backs, 1);
  assert.equal(tt.screen(), null, 'the table is gone');
  openCubeBuilder(view({ code: 'BACK' }), a);
  assert.deepEqual([...cubeBuild()!.main], [POOL[0]], 'as it was left');
  tt.closeTabletop();
  assert.equal(cubeTableWanted(), null, 'not loaded on a cube’s ?table=');
});

test('§6 never the deck collection', () => {
  const src = readFileSync(new URL('../cubebuild.ts', import.meta.url), 'utf8');
  assert.equal(/from '\.\/decks\.ts'|\/api\/decks|collection\.ts/.test(src), false);
  assert.equal(/\bfetch\(/.test(src), false, 'it sends nothing itself: acts.submit does');
});
