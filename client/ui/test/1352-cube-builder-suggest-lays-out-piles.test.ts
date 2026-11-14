/* 1352 · THE CUBE BUILDER LAYS A DECK OUT IN ITS PILES (ui/tabletop.ts `set`, ui/cubebuild.ts) — the walk
 * of 2026-11-14: "Suggest a deck" dumped thirty cards into one pile "New" that ran off the bottom,
 * and "Save and submit deck" wrapped to three lines at 1024 wide.
 *
 *   §1 Suggest lays the suggested deck out exactly as Re-sort by cost would (one pile a cost), and
 *      Undo still takes it back in one step
 *   §2 opened on a submitted deck: the same piles
 *   §3 the toolbar's words: "Suggest" and "Submit deck", each kept on one line (57-cube-draft.css)
 *
 * Seeds: none. The table paints into a stand-in #app (no DOM), as 1346 does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import type { CubeView } from '../../server/cube-types.ts';
import { seedPiles } from '../deckarrange.ts';
import * as tt from '../tabletop.ts';
import { cubeBuild, openCubeBuilder, type CubeBuildActs } from '../cubebuild.ts';
import { readStyles } from './read-styles.ts';

const POOL = DECK_LIST.slice(100, 145);
const root = { innerHTML: '' } as unknown as HTMLElement;
tt.initTabletop({ app: root, rerender: () => {} });

const view = (over: Partial<CubeView> = {}): CubeView => ({
  now: 1, code: 'PILE', phase: 'building', host: { user: 'u1', name: 'Ann' }, isHost: false, me: 'u2', joined: true,
  config: { name: 'Friday cube', source: { kind: 'elements', elements: ['fire'] }, packs: null, packSize: null, minPlayers: 2,
    maxPlayers: 8, fillBots: true, startAt: null, tournament: 'swiss', swissRounds: 3, rules: 'casual', bestOf: 1 },
  players: [], poolSize: 320, packMath: [], draft: null, myPool: POOL, myDeck: null, round: 0, breakUntil: null, pending: null,
  matches: [], standings: [], myMatch: null, ...over,
});
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const el = (btn: string): HTMLElement => ({ dataset: { btn }, closest: () => null }) as unknown as HTMLElement;
const acts = (suggest: { main: string[]; side: string[] } | null = null): CubeBuildActs =>
  ({ submit: async () => null, suggest: async () => suggest, back: () => {} });
/** the piles on the table, as their names and cards */
const piles = (): [string, string[]][] => (cubeBuild()!.piles ?? []).map(p => [p.name, [...p.cards]]);
const byCost = (cards: string[]): [string, string[]][] => seedPiles(cards, 'cost').map(p => [p.name, p.cards]);

const MAIN = POOL.slice(0, 30), SIDE = POOL.slice(30, 37);

test('§1 Suggest: the piles Re-sort makes, and one Undo', async () => {
  openCubeBuilder(view({ code: 'SUG1' }), acts({ main: MAIN, side: SIDE }));
  tt.handleButton(el('tt-cube-suggest'));
  await flush();
  const got = piles();
  assert.ok(got.length > 2, `${got.length} piles, not one heap`);
  assert.ok(!got.some(([name]) => name === 'New'), 'no "New" pile');
  assert.deepEqual(got, byCost(MAIN), 'by cost, as Re-sort lays it');
  assert.deepEqual([...cubeBuild()!.side], SIDE);
  tt.handleButton(el('tt-undo'));
  assert.deepEqual([cubeBuild()!.main, cubeBuild()!.side], [[], []], 'Undo takes it back');
  tt.closeTabletop();
});

test('§2 opened on a submitted deck: the same piles', () => {
  openCubeBuilder(view({ code: 'SUB1', myDeck: { main: MAIN, side: SIDE } }), acts());
  const html = root.innerHTML;
  for (const [name] of byCost(MAIN)) assert.match(html, new RegExp(`class="ttpilename"[^>]*>${name}<`), `the "${name}" pile`);
  assert.doesNotMatch(html, /class="ttpilename"[^>]*>New</);
  tt.closeTabletop();
});

test('§3 the words, one line each', () => {
  openCubeBuilder(view({ code: 'WRDS' }), acts());
  const html = root.innerHTML;
  const label = (b: string): string => new RegExp(`<button[^>]*data-btn="${b}"[^>]*>([^<]*)<`).exec(html)?.[1] ?? '';
  assert.equal(label('tt-cube-suggest'), 'Suggest');
  assert.equal(label('tt-cube-submit'), 'Submit deck');
  for (const b of ['tt-cube-suggest', 'tt-cube-submit']) assert.match(new RegExp(`<button[^>]*data-btn="${b}"[^>]*>`).exec(html)![0], /\bcbtool\b/);
  const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.match(css, /\.cbtool\s*\{[^}]*white-space:\s*nowrap/, 'never wrapped');
  tt.closeTabletop();
});
