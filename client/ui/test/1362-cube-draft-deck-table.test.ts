/* 1362 · THE DRAFT'S DECK TABLE (ui/cubedraft.ts as a tabletop host, docs/25 §13) — owner,
 * 2026-11-14: "The deck area should also already have the 'sideboard' and 'maybeboard' areas" and
 * "you should be able to freely drag cards around in your deck area during the draft".
 *
 *   §1 the screen is the builder's table: piles, + Pile, Re-sort, the Sideboard and Maybe; the pack
 *      is the band (no pool); a card's menu moves it (To sideboard, To Maybe, Move…) but never takes
 *      it off the table (no Remove one, Add another, Find similar)
 *   §2 a pick lands in the main deck by cost (as MTGO lays a pick out), on its cost's pile
 *   §3 a pack card dropped on the Sideboard (or a pile, or Maybe) lands there once the pick is in
 *   §4 a move on the table goes through the table's one door and is kept (acts.arrange, `from`
 *      draft); a pick is not something Undo takes back
 *   §5 opened again (a reload: no table in this tab), the server's layout is the table's — with a
 *      pick not on it landed by cost; Back calls acts.back and takes the table down
 *
 * Seeds: none. The table paints into a stand-in #app (no DOM).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import type { CubeArrange, CubeDraftView, CubeView } from '../../server/cube-types.ts';
import { cubeDraftDrag, draftLayout, paintCubeDraft, stopCubeDraft } from '../cubedraft.ts';
import { cardFacts } from '../deckstats.ts';
import * as tt from '../tabletop.ts';

const ROOT = { innerHTML: '' } as unknown as HTMLElement;
tt.initTabletop({ app: ROOT, rerender: () => {} });
const PACK = DECK_LIST.slice(80, 92);
const NOW = 7_000_000;
const costKey = (n: string): string => { const f = cardFacts(n)!; return f.isX ? 'X' : String(f.mana); };

const draft = (picks: string[], over: Partial<CubeDraftView> = {}): CubeDraftView => ({
  packNo: 1, pickNo: picks.length + 1, packs: 3, packSize: 12, direction: 'left', seats: [],
  pack: PACK.slice(picks.length), deadline: NOW + 60_000, reserved: null, suggest: null, picks, ...over,
});
const cube = (code: string, d: CubeDraftView, myArrange: CubeArrange | null = null): CubeView => ({
  now: NOW, code, phase: 'drafting', host: { user: 'u1', name: 'Ann' }, isHost: false, me: 'u2', joined: true,
  config: { name: 'Table cube', source: { kind: 'elements', elements: ['fire'] }, packs: null, packSize: null, minPlayers: 2,
    maxPlayers: 8, fillBots: true, startAt: null, tournament: 'swiss', swissRounds: 3, rules: 'casual', bestOf: 1 },
  players: [], poolSize: 320, packMath: [], myPool: null, myDeck: null, myArrange, round: 0, breakUntil: null, pending: null,
  matches: [], standings: [], myMatch: null, draft: d,
});
function acts() {
  const a = { kept: [] as CubeArrange[], picks: [] as string[], backs: 0,
    reserve: () => {}, pick: (c: string) => { a.picks.push(c); }, arrange: (x: CubeArrange) => { a.kept.push(x); }, back: () => { a.backs++; } };
  return a;
}
const el = (btn: string, data: Record<string, string> = {}): HTMLElement => ({ dataset: { btn, ...data }, closest: () => null }) as unknown as HTMLElement;
const html = (): string => ROOT.innerHTML;

test('§1 the builder’s table, the pack for its band', () => {
  const a = acts();
  paintCubeDraft(ROOT, cube('TBL1', draft([PACK[0]!])), a);
  const h = html();
  assert.match(h, /class="[^"]*ttpage cdpage"/);
  assert.match(h, /<section class="ttpool cdpack"/, 'the pack is the band');
  assert.doesNotMatch(h, /id="tt-q"/, 'no pool');
  for (const b of ['tt-addpile', 'tt-resort', 'tt-undo', 'tt-close']) assert.match(h, new RegExp(`data-btn="${b}"`), b);
  assert.match(h, /data-tt-zone="side"/, 'the Sideboard');
  assert.match(h, /data-tt-zone="maybe"/, 'Maybe');
  const src = new RegExp(`data-tt-src="(pile\\|[^"]+\\|0\\|${PACK[0]})"`).exec(h)?.[1];
  assert.ok(src, 'my pick is a card on the table');
  tt.handleButton(el('tt-card', { ttSrc: src! }));
  const menu = /<div class="ttpop"[\s\S]*?<\/div><\/div>/.exec(html())?.[0] ?? '';
  for (const b of ['tt-toside', 'tt-tomaybe', 'tt-move', 'tt-details']) assert.match(menu, new RegExp(`data-btn="${b}"`), `the menu: ${b}`);
  for (const b of ['tt-cut', 'tt-more', 'tt-similar']) assert.doesNotMatch(menu, new RegExp(`data-btn="${b}"`), `never ${b}`);
  tt.handleButton(el('tt-putdown'));
  stopCubeDraft();
});

test('§2 a pick lands on its cost’s pile', () => {
  const a = acts();
  const picks = [PACK[0]!];
  paintCubeDraft(ROOT, cube('TBL2', draft(picks)), a);
  // a second card of the same cost as one already there, and one of a cost not yet on the table
  const same = PACK.slice(1).find(n => costKey(n) === costKey(PACK[0]!));
  const other = PACK.slice(1).find(n => costKey(n) !== costKey(PACK[0]!))!;
  assert.ok(same && other, 'the made-up pack has both');
  const next = [...picks, other, ...(same ? [same] : [])];
  paintCubeDraft(ROOT, cube('TBL2', draft(next)), a);
  const t = draftLayout('TBL2')!;
  for (const n of next) {
    const pile = t.piles.find(p => p.cards.includes(n))!;
    assert.equal(pile.auto, `cost:${costKey(n)}`, `${n} on the ${costKey(n)} pile`);
  }
  assert.deepEqual(t.side, []);
  assert.match(html(), new RegExp(`data-card="${other}"`), 'drawn');
  assert.equal(a.kept.at(-1)!.from, 'draft');
  assert.deepEqual(a.kept.at(-1)!.piles.flat().sort(), [...next].sort(), 'and kept');
  stopCubeDraft();
});

test('§3 a drop on the Sideboard lands there', () => {
  const a = acts();
  paintCubeDraft(ROOT, cube('TBL3', draft([PACK[0]!])), a);
  const src = { dataset: { cdCard: PACK[1]! }, closest: () => null } as unknown as HTMLElement;
  const plan = cubeDraftDrag.plan(src)!;
  const side = { dataset: { ttZone: 'side' } } as unknown as Element;
  assert.equal(plan.drop(side, 0, 0), true);
  assert.deepEqual(a.picks, [PACK[1]]);
  paintCubeDraft(ROOT, cube('TBL3', draft([PACK[0]!, PACK[1]!])), a);
  assert.deepEqual(draftLayout('TBL3')!.side, [PACK[1]], 'on the Sideboard, not by cost');
  // and one dropped on Maybe
  const plan2 = cubeDraftDrag.plan({ dataset: { cdCard: PACK[2]! }, closest: () => null } as unknown as HTMLElement)!;
  plan2.drop({ dataset: { ttZone: 'maybe' } } as unknown as Element, 0, 0);
  paintCubeDraft(ROOT, cube('TBL3', draft([PACK[0]!, PACK[1]!, PACK[2]!])), a);
  assert.deepEqual(draftLayout('TBL3')!.maybe, [PACK[2]]);
  stopCubeDraft();
});

test('§4 a move on the table is kept; Undo never takes a pick back', () => {
  const a = acts();
  const picks = [PACK[0]!, PACK[1]!];
  paintCubeDraft(ROOT, cube('TBL4', draft(picks)), a);
  const pile = draftLayout('TBL4')!.piles.find(p => p.cards.includes(PACK[0]!))!;
  const k = pile.cards.indexOf(PACK[0]!);
  tt.handleButton(el('tt-card', { ttSrc: `pile|${pile.id}|${k}|${PACK[0]}` }));
  tt.handleButton(el('tt-tomaybe'));
  assert.deepEqual(draftLayout('TBL4')!.maybe, [PACK[0]], 'moved through the table’s own menu');
  assert.deepEqual(a.kept.at(-1)!.maybe, [PACK[0]], 'and kept');
  assert.doesNotMatch(/<button[^>]*data-btn="tt-undo"[^>]*>/.exec(html())![0], /disabled/, 'Undo takes the move back');
  paintCubeDraft(ROOT, cube('TBL4', draft([...picks, PACK[2]!])), a);
  assert.match(/<button[^>]*data-btn="tt-undo"[^>]*>/.exec(html())![0], /disabled/, 'a pick came in: nothing to take back');
  assert.deepEqual(draftLayout('TBL4')!.maybe, [PACK[0]], 'the move stands');
  stopCubeDraft();
});

test('§5 a reload opens on the server’s layout; Back', () => {
  const a = acts();
  const kept: CubeArrange = { piles: [[PACK[1]!]], names: ['Mine'], side: [PACK[0]!], maybe: [], from: 'draft' };
  // this tab holds no table for TBL5: the server's layout, and the pick it does not hold landed by cost
  paintCubeDraft(ROOT, cube('TBL5', draft([PACK[0]!, PACK[1]!, PACK[2]!]), kept), a);
  const t = draftLayout('TBL5')!;
  assert.deepEqual(t.side, [PACK[0]]);
  assert.deepEqual(t.piles.find(p => p.name === 'Mine')!.cards, [PACK[1]]);
  assert.ok(t.piles.some(p => p.auto === `cost:${costKey(PACK[2]!)}` && p.cards.includes(PACK[2]!)), 'the missing pick by cost');
  assert.match(html(), /Mine/);
  tt.handleButton(el('tt-close'));
  assert.equal(a.backs, 1, 'Back is the event page');
  assert.equal(tt.tableOpen(), null, 'the table is down');
  assert.ok(draftLayout('TBL5'), 'the layout stays in this tab');
  stopCubeDraft();
});
