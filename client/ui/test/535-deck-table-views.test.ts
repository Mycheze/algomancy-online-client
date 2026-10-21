/* THE DECK TABLE'S VIEWS (ui/decktable.ts, 2026-10-21) — the markup and the
 * moves, called for real against a host held in this file.
 *
 *   §1 Sorted IS the shared layout: rows = deckSections, columns = costColumns,
 *      copies drawn through stackLayers, the number only over the cap
 *   §2 the toolbar offers exactly the host's views, and no `cost` row split
 *   §3 a column move records a move, draws ↪, keeps the view Sorted; onto its
 *      natural cell it clears (owner, Q1)
 *   §4 "Put all back" shows only when the split has moves, and its Undo
 *      restores them
 *   §5 a host that keeps no moves (the challenge) snaps a column move home and
 *      commits nothing; an add still lands
 *   §6 no Maybe tab; the Maybe zone and the Cut zone are on the table
 *   §7 every card drawn is a real scan, through the one art helper
 *   §8 Freeform: piles are arrangement only — a move between piles never
 *      changes the deck, a drawer add lands one copy in the pile it was dropped on
 *
 * The gestures themselves are proved over CDP (the driver dispatches no
 * pointer events); this pins the decisions under them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../engine/src/cards/registry.ts';
import { analyzeDeck } from '../deckstats.ts';
import { costColumns, deckSections, stackLayers } from '../decklayout.ts';
import { clearSelection, defaultPlace, place, selected, tableClick, tableHtml, type TableHost, type TableNext, type TableView } from '../decktable.ts';
import type { DeckPile, SortMoves } from '../deckarrange.ts';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (f: string): string => readFileSync(join(UI, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const DECK = ['Ignis Sprite', 'Ignis Sprite', 'Good Whale', 'Jelly', 'Biotoxicity', 'The Foretold'];

interface Box { cards: string[]; maybe: string[]; piles: DeckPile[] | null; moves: SortMoves | undefined; view: TableView; commits: TableNext[]; paints: number }

function host(o: { views?: TableView[]; keepsMoves?: boolean; maybe?: boolean; cards?: string[] } = {}): { h: TableHost; box: Box } {
  const box: Box = { cards: [...(o.cards ?? DECK)], maybe: [], piles: null, moves: undefined,
    view: (o.views ?? ['sorted', 'freeform'])[0]!, commits: [], paints: 0 };
  const h: TableHost = {
    key: `t:${Math.random()}`,
    btnPrefix: 'deck-',
    views: o.views ?? ['sorted', 'freeform'],
    view: () => box.view,
    setView: v => { box.view = v; },
    cards: () => box.cards,
    ...(o.maybe === false ? {} : { maybe: () => box.maybe }),
    piles: () => box.piles,
    ...(o.keepsMoves === false ? {} : { sortMoves: () => box.moves }),
    cap: 2,
    commit: next => {
      box.commits.push(next);
      if (next.cards) box.cards = next.cards;
      if (next.maybe) box.maybe = next.maybe;
      if ('piles' in next) box.piles = next.piles ?? null;
      if ('sortMoves' in next) box.moves = next.sortMoves;
    },
    repaint: () => { box.paints++; },
    drawer: () => { throw new Error('the drawer is not under test here'); },
  };
  return { h, box };
}
/** a fake button: what tableClick reads off the element */
const el = (dt: string, data: Record<string, string> = {}): HTMLElement =>
  ({ dataset: { btn: 'deck-table', dt, ...data } }) as unknown as HTMLElement;

/** the Sorted grid's cards, row by row, cell by cell, as the markup draws them */
function drawnRows(html: string): string[][][] {
  return html.split('class="dtrow"').slice(1).map(row =>
    row.split(/class="dtcell[ "]/).slice(1).map(cell =>
      [...cell.matchAll(/data-dt-src="table\|([^"]+)"/g)].map(m => m[1]!)));
}

test('§1 Sorted is deckSections × costColumns, copies stacked, the number only over the cap', () => {
  const { h } = host({ cards: [...DECK, 'Good Whale', 'Good Whale'] });
  const html = tableHtml(h);
  const a = analyzeDeck(h.cards() as string[]);
  const want = deckSections(a, 'type').map(sec => costColumns(sec).map(c => c.entries.map(e => e.name)));
  const got = drawnRows(html).map(row => row.filter(cell => cell.length));
  assert.deepEqual(got, want, 'the same rows, the same columns, the same order');
  // two Sprites: one ghost behind; three Whales: two ghosts and the red number
  assert.match(html, new RegExp(`--d:${stackLayers(2).length}"[^>]*data-prev="Ignis Sprite"`));
  assert.match(html, /×3<\/span>/, 'over the cap the number comes back');
  assert.doesNotMatch(html, /×2<\/span>/, 'and at the cap it does not');
  // every row draws every column, so the grid lines up and an empty cell is a slot
  const cols = (html.match(/class="dtcolhead"/g) ?? []).length;
  for (const row of drawnRows(html)) assert.equal(row.length, cols);
});

test('§2 the toolbar offers exactly the host’s views, and no cost split', () => {
  for (const views of [['sorted', 'freeform'], ['stacked', 'sorted']] as TableView[][]) {
    const { h } = host({ views });
    const html = tableHtml(h);
    const offered = [...html.matchAll(/data-dt="view" data-dt-v="(\w+)"/g)].map(m => m[1]);
    assert.deepEqual(offered, views);
  }
  const html = tableHtml(host().h);
  const splits = [...html.matchAll(/data-dt="split" data-dt-v="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(splits, ['type', 'element', 'flat'], 'columns already are cost, so cost is no row split');
  assert.match(code('decktable.ts'), /GROUPINGS\.filter\(g => g\.id !== 'cost'\)/);
});

test('§3 a column move is remembered, marked, and cleared on its natural cell', () => {
  const { h, box } = host();
  const name = 'Good Whale';
  const natural = drawnRows(tableHtml(h))[0]!.findIndex(cell => cell.includes(name));
  const cols = [...tableHtml(h).matchAll(/data-dt-zone="cell\|units\|([^"]+)"/g)].map(m => m[1]!);
  const other = cols.find((_, i) => i !== natural)!;
  assert.ok(place(h, { name, from: { at: 'table' } }, { at: 'cell', row: 'units', col: other }));
  assert.deepEqual(box.moves, { type: { [name]: { row: 'units', col: other } } });
  assert.deepEqual(box.cards, DECK, 'a move never changes the deck');
  const html = tableHtml(h);
  assert.equal(box.view, 'sorted', 'and the view stays Sorted');
  assert.match(html, new RegExp(`data-prev="${name}"[\\s\\S]*?class="dtmoved" title="Moved by you">↪`));
  assert.equal(drawnRows(html)[0]![cols.indexOf(other)]!.includes(name), true, 'drawn in its new cell');
  // a moved card picked up offers Put back
  tableClick(h, el('sel', { dtSrc: `table|${name}` }));
  assert.match(tableHtml(h), /data-dt="putback"/);
  clearSelection();
  // dropped on its natural cell, the move is gone — nothing equal to the auto answer is kept
  place(h, { name, from: { at: 'table' } }, { at: 'cell', row: 'units', col: cols[natural]! });
  assert.equal(box.moves, undefined);
  assert.doesNotMatch(tableHtml(h), /dtmoved/);
});

test('§4 Put all back shows only with moves, and its Undo restores them', () => {
  const { h, box } = host();
  assert.doesNotMatch(tableHtml(h), /data-dt="putallback"/, 'no moves, no button');
  place(h, { name: 'Good Whale', from: { at: 'table' } }, { at: 'cell', row: 'units', col: '1' });
  place(h, { name: 'The Foretold', from: { at: 'table' } }, { at: 'cell', row: 'spells', col: '1' });
  const moved = box.moves;
  assert.match(tableHtml(h), /data-dt="putallback">Put all back \(2\)/);
  tableClick(h, el('putallback'));
  assert.equal(box.moves, undefined);
  assert.match(tableHtml(h), /data-dt="undo"/, 'one step of undo');
  tableClick(h, el('undo'));
  assert.deepEqual(box.moves, moved, 'Undo puts every move back');
  assert.doesNotMatch(tableHtml(h), /data-dt="undo"/, 'and is spent');
  // the undo is gone after the next edit
  tableClick(h, el('putallback'));
  place(h, { name: 'Jelly', from: { at: 'drawer' } }, defaultPlace(h));
  assert.doesNotMatch(tableHtml(h), /data-dt="undo"/);
});

test('§5 a host that keeps no moves snaps a column move home', () => {
  const { h, box } = host({ views: ['stacked', 'sorted'], keepsMoves: false, maybe: false });
  box.view = 'sorted';
  assert.equal(place(h, { name: 'Good Whale', from: { at: 'table' } }, { at: 'cell', row: 'units', col: '1' }), false);
  assert.equal(box.commits.length, 0, 'nothing committed');
  assert.ok(place(h, { name: 'Jelly', from: { at: 'drawer' } }, { at: 'cell', row: 'units', col: '1' }),
    'an add onto a cell still adds');
  assert.deepEqual(box.cards, [...DECK, 'Jelly'], 'at the bottom, as addCard does');
  assert.equal(box.commits.every(c => !('sortMoves' in c)), true, 'and records no move');
  assert.doesNotMatch(tableHtml(h), /data-dt-zone="maybe"/, 'no maybeboard on this host');
});

test('§6 no Maybe tab; Maybe and Cut are zones on the table', () => {
  assert.doesNotMatch(code('decks.ts'), /'maybe', `maybeboard/, 'the Maybe tab is retired (owner, Q6)');
  assert.doesNotMatch(code('decks.ts'), /tab === 'maybe'/);
  const { h, box } = host();
  const html = tableHtml(h);
  assert.match(html, /data-dt-zone="maybe"/);
  assert.match(html, /data-dt-zone="cut"/);
  // Sorted carries the whole stack: two Sprites to Maybe is two
  assert.ok(place(h, { name: 'Ignis Sprite', from: { at: 'table' } }, { at: 'maybe' }));
  assert.deepEqual(box.maybe, ['Ignis Sprite', 'Ignis Sprite']);
  assert.equal(box.cards.includes('Ignis Sprite'), false);
  assert.match(tableHtml(h), /data-dt-src="maybe\|Ignis Sprite"/, 'and the zone draws them');
  // − on a picked-up card is one copy; Cut is the card
  tableClick(h, el('sel', { dtSrc: 'maybe|Ignis Sprite' }));
  assert.ok(selected(h));
  tableClick(h, el('less'));
  assert.deepEqual(box.maybe, ['Ignis Sprite']);
  tableClick(h, el('sel', { dtSrc: 'table|Good Whale' }));
  tableClick(h, el('cut'));
  assert.equal(box.cards.includes('Good Whale'), false);
});

test('§7 every card is a real scan, through the one art helper', () => {
  const src = code('decktable.ts');
  assert.doesNotMatch(src, /<img/, 'no hand-rolled <img>: artHtml is the one way to draw a scan');
  assert.match(src, /artHtml\(r, cls\)/);
  const html = tableHtml(host().h);
  const tiles = (html.match(/class="dktile dtcard/g) ?? []).length;
  assert.ok(tiles >= 5);
  assert.equal((html.match(/<img class="dkart"/g) ?? []).length
    + (html.match(/class="dkart cbnoart"/g) ?? []).length,
  tiles + (html.match(/class="dkghostwrap"/g) ?? []).length, 'one scan per card and per ghost');
});

test('§8 Freeform piles arrange and never change the deck', () => {
  const { h, box } = host();
  box.view = 'freeform';
  const html = tableHtml(h);
  const piles = [...html.matchAll(/data-dt-zone="pile\|(p\d+)"/g)].map(m => m[1]!);
  assert.ok(piles.length >= 2, 'seeded one pile per Sorted row');
  // a copy from one pile to another
  const first = box.cards[0]!;
  tableClick(h, el('to', { dtZone: 'newpile' }));
  assert.ok(box.piles, 'the seed is saved on the first commit');
  const fresh = box.piles!.at(-1)!.id;
  const from = box.piles!.find(p => p.cards.includes(first))!.id;
  assert.ok(place(h, { name: first, from: { at: 'pile', pile: from } }, { at: 'pile', pile: fresh }));
  assert.deepEqual([...box.cards].sort(), [...DECK].sort(), 'the deck is untouched');
  assert.deepEqual(box.piles!.at(-1)!.cards, [first]);
  // a drawer add on a pile: ONE copy, in that pile
  place(h, { name: 'Jelly', from: { at: 'drawer' } }, { at: 'pile', pile: fresh, index: 0 });
  assert.deepEqual(box.piles!.at(-1)!.cards, ['Jelly', first]);
  assert.equal(box.cards.filter(c => c === 'Jelly').length, 2);
  // and the piles always hold exactly the deck
  assert.deepEqual(box.piles!.flatMap(p => p.cards).sort(), [...box.cards].sort());
  // a rename is a place() too
  place(h, null, { at: 'arrange', edit: { op: 'rename', pile: fresh, name: 'Finishers' } });
  assert.equal(box.piles!.at(-1)!.name, 'Finishers');
});
