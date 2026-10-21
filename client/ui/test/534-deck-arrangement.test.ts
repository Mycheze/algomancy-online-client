/* THE DECK TABLE'S ARRANGEMENT MODEL — ui/deckarrange.ts, pure.
 *
 * Owner, 2026-10-21: *Sorted remembers it* — a card dragged to another cell
 * stays there as a marked exception — and Freeform is named piles. Both are
 * ARRANGEMENT ONLY: nothing here may add, remove or count a card, which is
 * the property most of these cases come back to.
 *
 *   SORTED MOVES
 *   §1  no moves = deckSections × costColumns, card for card, in order
 *   §2  a move puts the name in its cell, marked; onto its natural cell it clears
 *   §3  moves are per row split, and switching split back restores them
 *   §4  normaliseMoves drops what no longer means anything; putBack / putAllBack
 *   §5  under ANY moves the grid never loses or duplicates a card
 *   §6  the row keys are pinned — a stored move is keyed by them (risk 14)
 *   PILES
 *   §7  reconcile: multiset equality over randomised add/cut sequences, never
 *       reordering a placed card, idempotent
 *   §8  the deficit order, and the surplus from the last pile
 *   §9  seedPiles: one pile per Sorted row; the pile edits keep the contents
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { analyzeDeck, cardFacts, ELEMENTS } from '../deckstats.ts';
import { costColumns, deckSections, type DeckGrouping } from '../decklayout.ts';
import {
  colKeyOf, deletePile, movePileCard, moveTo, naturalCell, newPile, normaliseMoves, putAllBack, putBack,
  reconcilePiles, renamePile, rowKeyOf, ROW_SPLITS, seedPiles, sortedGrid, validRow,
  type DeckPile, type RowSplit, type SortMoves,
} from '../deckarrange.ts';

/** a deterministic PRNG, so a red run can be re-run */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const facts = DECK_LIST.map(n => cardFacts(n)!);
const firstOf = (p: (f: NonNullable<ReturnType<typeof cardFacts>>) => boolean): string => facts.find(p)!.name;
const UNIT = firstOf(f => f.kind === 'unit' && !f.isX);
const UNIT2 = facts.filter(f => f.kind === 'unit' && !f.isX && f.mana !== cardFacts(UNIT)!.mana)[0]!.name;
const SPELL = firstOf(f => f.kind === 'spell' && !f.isX);
const SPELL_UNIT = firstOf(f => f.kind === 'spellUnit');
const XCARD = firstOf(f => f.isX);
const UNKNOWN = 'Not A Card In This Build';

/** a deck with every kind of column in it: numbers, X, a card the build lacks */
const MIXED = [UNIT, UNIT, UNIT2, SPELL, SPELL_UNIT, XCARD, UNKNOWN, ...DECK_LIST.slice(40, 60)];
/** a few real-shaped decks: a mixed one, a slice of the pool, the whole pool */
const DECKS: string[][] = [MIXED, DECK_LIST.slice(100, 140).flatMap(n => [n, n]), [...DECK_LIST]];

const flatCount = (grid: ReturnType<typeof sortedGrid>): Map<string, number> => {
  const m = new Map<string, number>();
  for (const r of grid.rows) for (const c of r.cells) for (const e of c.entries) m.set(e.name, (m.get(e.name) ?? 0) + e.n);
  return m;
};
const tally = (list: readonly string[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const n of list) m.set(n, (m.get(n) ?? 0) + 1);
  return m;
};
const sameMultiset = (a: readonly string[], b: readonly string[]): boolean =>
  JSON.stringify([...tally(a)].sort()) === JSON.stringify([...tally(b)].sort());

/* ══ §1 the auto-sort ══════════════════════════════════════════════════ */

test('§1 ⭐ with no moves the grid IS deckSections × costColumns, card for card and in order', () => {
  for (const cards of DECKS) {
    const a = analyzeDeck(cards);
    for (const split of ROW_SPLITS) {
      const grid = sortedGrid(a, split, undefined);
      const secs = deckSections(a, split as DeckGrouping);
      assert.deepEqual(grid.rows.map(r => [r.key, r.label]), secs.map(s => [s.key, s.label]), `${split}: rows = sections`);
      grid.rows.forEach((row, i) => {
        const sec = secs[i]!;
        assert.equal(row.cells.length, grid.cols.length, 'every row draws every column');
        const nonEmpty = row.cells.filter(c => c.entries.length)
          .map(c => ({ col: c.col, entries: c.entries.map(({ moved: _m, ...e }) => e) }));
        assert.deepEqual(nonEmpty, costColumns(sec), `${split}/${row.key}: the cells are costColumns`);
        assert.ok(row.cells.every(c => c.entries.every(e => !e.moved)), 'nothing reads as moved');
      });
    }
  }
});

test('§1 the columns: lowest cost to highest with the gaps filled, then X, then unknown', () => {
  const a = analyzeDeck(MIXED);
  const { cols } = sortedGrid(a, 'type', undefined);
  const nums = cols.filter(c => /^\d+$/.test(c)).map(Number);
  assert.deepEqual(nums, Array.from({ length: nums.length }, (_, i) => nums[0]! + i), 'numbers contiguous');
  assert.deepEqual(cols.slice(nums.length), ['X', 'unknown']);
  assert.equal(colKeyOf(XCARD), 'X');
  assert.equal(colKeyOf(UNKNOWN), 'unknown');
  assert.equal(colKeyOf(UNIT), String(cardFacts(UNIT)!.mana));
  assert.deepEqual(sortedGrid(analyzeDeck([]), 'type', undefined), { cols: [], rows: [] }, 'an empty deck is an empty grid');
});

/* ══ §2 a move ═════════════════════════════════════════════════════════ */

test('§2 ⭐ a move puts the name in its cell, marked moved; back onto its natural cell it CLEARS', () => {
  const a = analyzeDeck(MIXED);
  const home = naturalCell(UNIT, 'type');
  assert.deepEqual(home, { row: 'units', col: colKeyOf(UNIT) });
  const cell = { row: 'spells', col: 'X' };
  const moves = moveTo(undefined, 'type', UNIT, cell, home);
  assert.deepEqual(moves, { type: { [UNIT]: cell } });
  const grid = sortedGrid(a, 'type', moves);
  const where = grid.rows.flatMap(r => r.cells.flatMap(c => c.entries.filter(e => e.name === UNIT).map(e => ({ row: r.key, col: c.col, e }))));
  assert.equal(where.length, 1, 'the name is in ONE cell');
  assert.deepEqual([where[0]!.row, where[0]!.col], ['spells', 'X']);
  assert.equal(where[0]!.e.moved, true);
  assert.equal(where[0]!.e.n, 2, 'all of its copies move together');
  assert.equal(grid.rows.flatMap(r => r.cells.flatMap(c => c.entries)).filter(e => e.moved).length, 1, 'nothing else is marked');

  assert.equal(moveTo(moves, 'type', UNIT, home, home), undefined, 'onto its natural cell: nothing stored');
  assert.equal(moveTo(undefined, 'type', UNIT, home, home), undefined, 'a natural-cell move is never recorded');
});

test('§2 a column or row that holds only a moved card is drawn; a natural row emptied by moves stays', () => {
  const cards = [UNIT, SPELL];
  const a = analyzeDeck(cards);
  const far = String(Math.max(cardFacts(UNIT)!.mana, cardFacts(SPELL)!.mana) + 3);
  const moves = moveTo(undefined, 'type', SPELL, { row: 'units', col: far }, naturalCell(SPELL, 'type'));
  const grid = sortedGrid(a, 'type', moves);
  assert.ok(grid.cols.includes(far), 'the far column exists because a moved card is in it');
  const lo = Math.min(cardFacts(UNIT)!.mana, cardFacts(SPELL)!.mana);
  assert.deepEqual(grid.cols, Array.from({ length: Number(far) - lo + 1 }, (_, i) => String(lo + i)),
    'and every column between is drawn, as a drop slot');
  assert.deepEqual(grid.rows.map(r => r.key), ['units', 'spells'], 'the spells row stays, empty — it is where SPELL goes back to');
  // a row only a moved card is in: a unit moved into "spellUnits", which this deck has none of
  const m2 = moveTo(undefined, 'type', UNIT, { row: 'spellUnits', col: colKeyOf(UNIT) }, naturalCell(UNIT, 'type'));
  const g2 = sortedGrid(a, 'type', m2);
  assert.deepEqual(g2.rows.map(r => [r.key, r.label]), [['units', 'Units'], ['spells', 'Spells'], ['spellUnits', 'Spell units']],
    'labelled and placed in decklayout\'s own section order');
});

/* ══ §3 per split ══════════════════════════════════════════════════════ */

test('§3 ⭐ moves are per row split: a type move leaves element untouched, and switching back restores it', () => {
  const a = analyzeDeck(MIXED);
  let moves: SortMoves | undefined = moveTo(undefined, 'type', SPELL, { row: 'units', col: colKeyOf(SPELL) }, naturalCell(SPELL, 'type'));
  const elementBefore = sortedGrid(a, 'element', undefined);
  assert.deepEqual(sortedGrid(a, 'element', moves), elementBefore, 'the element grid ignores a type move');
  moves = moveTo(moves, 'element', UNIT2, { row: 'none', col: colKeyOf(UNIT2) }, naturalCell(UNIT2, 'element'));
  assert.deepEqual(Object.keys(moves!).sort(), ['element', 'type']);
  const typeGrid = sortedGrid(a, 'type', moves);
  const movedNames = (g: ReturnType<typeof sortedGrid>) => g.rows.flatMap(r => r.cells.flatMap(c => c.entries.filter(e => e.moved).map(e => e.name)));
  assert.deepEqual(movedNames(typeGrid), [SPELL], 'back on type: the type move, and only it');
  assert.deepEqual(movedNames(sortedGrid(a, 'element', moves)), [UNIT2]);
  assert.deepEqual(movedNames(sortedGrid(a, 'flat', moves)), [], 'flat has none');
});

/* ══ §4 normalise, put back ════════════════════════════════════════════ */

test('§4 ⭐ normaliseMoves drops a name that left the deck, an invalid row, a non-cost column, a natural-cell entry', () => {
  const cards = [UNIT, UNIT2, SPELL, XCARD];
  const keep = { row: 'spells', col: '1' };
  const raw: SortMoves = {
    type: {
      [UNIT]: keep,                                    // kept (unless it IS its natural cell)
      [SPELL_UNIT]: { row: 'units', col: '1' },        // not in the deck
      [UNIT2]: { row: 'spell', col: '1' },             // not a row ("spells")
      [SPELL]: { row: 'units', col: 'seven' },         // not a cost column
      [XCARD]: naturalCell(XCARD, 'type'),             // equals the auto answer
    },
    element: { [UNIT]: { row: 'fire/fire', col: '1' } }, // a pair of one element is no row
    flat: {},
  };
  const frozen = JSON.stringify(raw);
  const out = normaliseMoves(cards, raw);
  assert.equal(JSON.stringify(raw), frozen, 'the input is not mutated');
  const natural = naturalCell(UNIT, 'type');
  const expectKept = natural.row === keep.row && natural.col === keep.col ? undefined : { type: { [UNIT]: keep } };
  assert.deepEqual(out, expectKept, 'one survivor; the empty splits go');
  assert.equal(normaliseMoves(cards, { type: { [SPELL_UNIT]: keep } }), undefined, 'nothing left → undefined');
  assert.equal(normaliseMoves(cards, undefined), undefined);
  // the grid applies the same rule: a stale move draws nothing odd
  assert.deepEqual(sortedGrid(analyzeDeck(cards), 'type', { type: { [UNIT2]: { row: 'spell', col: '1' } } }),
    sortedGrid(analyzeDeck(cards), 'type', undefined));
});

test('§4 putBack clears one move; putAllBack clears ONE split and keeps the others', () => {
  let m: SortMoves | undefined = moveTo(undefined, 'type', UNIT, { row: 'spells', col: 'X' }, naturalCell(UNIT, 'type'));
  m = moveTo(m, 'type', SPELL, { row: 'units', col: 'X' }, naturalCell(SPELL, 'type'));
  m = moveTo(m, 'flat', SPELL, { row: 'all', col: 'X' }, naturalCell(SPELL, 'flat'));
  const one = putBack(m, 'type', UNIT);
  assert.deepEqual(Object.keys(one!.type!), [SPELL]);
  assert.ok(one!.flat, 'putBack under type leaves flat');
  assert.deepEqual(putAllBack(m, 'type'), { flat: m!.flat }, 'putAllBack(type) leaves flat');
  assert.equal(putAllBack(putAllBack(m, 'type'), 'flat'), undefined, 'all clear → undefined');
  assert.equal(Object.keys(m!.type!).length, 2, 'the edits never mutate the record they were given');
});

/* ══ §5 no card lost ═══════════════════════════════════════════════════ */

test('§5 ⭐ under any moves at all the grid never loses or duplicates a card', () => {
  const r = rng(53401);
  for (const cards of DECKS) {
    const a = analyzeDeck(cards);
    const names = [...new Set(cards)];
    for (let trial = 0; trial < 40; trial++) {
      let m: SortMoves | undefined;
      for (let k = 0; k < 12; k++) {
        const split = ROW_SPLITS[Math.floor(r() * 3)]! as RowSplit;
        const name = names[Math.floor(r() * names.length)]!;
        const rows = split === 'type' ? ['units', 'spells', 'spellUnits', 'unknown', 'bogus']
          : split === 'element' ? [...ELEMENTS, 'none', 'fire/water', 'bogus'] : ['all', 'bogus'];
        const cell = { row: rows[Math.floor(r() * rows.length)]!, col: ['0', '3', '7', 'X', 'unknown', '-1'][Math.floor(r() * 6)]! };
        m = moveTo(m, split, name, cell, naturalCell(name, split));
      }
      for (const split of ROW_SPLITS) {
        const got = flatCount(sortedGrid(a, split, m));
        assert.deepEqual([...got].sort(), [...tally(cards)].sort(), `trial ${trial} ${split}`);
      }
    }
  }
});

/* ══ §6 the row keys ═══════════════════════════════════════════════════ */

test('§6 ⭐ the row keys are pinned — a stored move is keyed by them', () => {
  assert.deepEqual(['units', 'spells', 'spellUnits', 'unknown'].map(k => validRow('type', k)), [true, true, true, true]);
  assert.deepEqual([rowKeyOf(UNIT, 'type'), rowKeyOf(SPELL, 'type'), rowKeyOf(SPELL_UNIT, 'type'), rowKeyOf(UNKNOWN, 'type')],
    ['units', 'spells', 'spellUnits', 'unknown']);
  assert.ok(validRow('flat', 'all') && rowKeyOf(UNIT, 'flat') === 'all');
  assert.ok(validRow('element', 'none') && rowKeyOf(UNKNOWN, 'element') === 'none');
  for (const el of ELEMENTS) assert.ok(validRow('element', el), el);
  for (const bad of ['spell', 'Units', 'all', '']) assert.equal(validRow('type', bad), false, `type: ${bad}`);
  for (const bad of ['fire/fire', 'fire/', 'plasma', 'units']) assert.equal(validRow('element', bad), false, `element: ${bad}`);
  assert.equal(validRow('flat', 'units'), false);
  // DERIVED, not listed: every row any card of the pool files under is a valid row
  const pool = analyzeDeck(DECK_LIST);
  for (const split of ROW_SPLITS) {
    for (const sec of deckSections(pool, split as DeckGrouping)) assert.ok(validRow(split, sec.key), `${split}: ${sec.key}`);
  }
});

/* ══ §7 reconcile ══════════════════════════════════════════════════════ */

test('§7 ⭐ reconcile: the piles hold exactly the deck, over randomised add/cut sequences', () => {
  const r = rng(53402);
  const names = DECK_LIST.slice(0, 25);
  let cards = names.slice(0, 15).flatMap(n => [n, n]);
  let piles = seedPiles(analyzeDeck(cards), 'type', undefined);
  for (let step = 0; step < 400; step++) {
    const roll = r();
    if (roll < 0.45 || !cards.length) cards = [...cards, names[Math.floor(r() * names.length)]!];
    else if (roll < 0.9) cards = cards.filter((_, i, all) => i !== Math.floor(r() * all.length));
    else piles = newPile(piles);
    const next = reconcilePiles(cards, piles);
    assert.ok(sameMultiset(next.flatMap(p => p.cards), cards), `step ${step}: the multiset is the deck's`);
    assert.deepEqual(reconcilePiles(cards, next), next, `step ${step}: idempotent`);
    // never reorders a placed card: the cards that were already in a pile and
    // are still in it keep their relative order
    for (const before of piles) {
      const after = next.find(p => p.id === before.id)!;
      assert.ok(after, 'no pile is dropped');
      const kept = after.cards.filter(c => before.cards.includes(c));
      const was = before.cards.filter(c => after.cards.includes(c));
      // equal-name copies are interchangeable; compare the order of first appearances
      const firsts = (l: string[]) => l.filter((c, i) => l.indexOf(c) === i);
      assert.deepEqual(firsts(kept), firsts(was), `step ${step}: pile ${before.id} kept its order`);
    }
    piles = next;
  }
});

/* ══ §8 deficit order, surplus ═════════════════════════════════════════ */

test('§8 ⭐ a deficit goes to the pile holding the name, else the auto row pile, else "New" at the front', () => {
  const piles: DeckPile[] = [
    { id: 'a', name: 'Mine', cards: [SPELL] },
    { id: 'b', name: 'Units', cards: [UNIT2], auto: 'units' },
    { id: 'c', name: 'Also mine', cards: [UNIT] },
  ];
  // 1. a second UNIT joins its first copy — in pile c, not the auto "units" pile b
  const one = reconcilePiles([SPELL, UNIT2, UNIT, UNIT], piles);
  assert.deepEqual(one.map(p => p.cards), [[SPELL], [UNIT2], [UNIT, UNIT]]);
  // 2. a unit nobody holds goes to the pile whose auto is its type row
  const NEWUNIT = facts.find(f => f.kind === 'unit' && ![UNIT, UNIT2].includes(f.name))!.name;
  const two = reconcilePiles([SPELL, UNIT2, UNIT, NEWUNIT], piles);
  assert.deepEqual(two.map(p => p.cards), [[SPELL], [UNIT2, NEWUNIT], [UNIT]]);
  // 3. a spell unit has no holder and no auto pile → a "New" pile, made at the FRONT
  const three = reconcilePiles([SPELL, UNIT2, UNIT, SPELL_UNIT], piles);
  assert.equal(three[0]!.name, 'New');
  assert.deepEqual(three[0]!.cards, [SPELL_UNIT]);
  assert.ok(!piles.some(p => p.id === three[0]!.id), 'with an id of its own');
  // …and an existing "New" is reused, wherever it is
  const withNew = [...piles, { id: 'n', name: 'New', cards: [] }];
  const four = reconcilePiles([SPELL, UNIT2, UNIT, SPELL_UNIT], withNew);
  assert.equal(four.length, 4);
  assert.deepEqual(four[3]!.cards, [SPELL_UNIT]);
  assert.equal(piles[0]!.cards.length, 1, 'the input piles are not mutated');
});

test('§8 ⭐ surplus comes off the LAST pile holding the name', () => {
  const piles: DeckPile[] = [
    { id: 'a', name: 'A', cards: [UNIT, SPELL] },
    { id: 'b', name: 'B', cards: [UNIT] },
    { id: 'c', name: 'C', cards: [SPELL, UNIT] },
  ];
  assert.deepEqual(reconcilePiles([UNIT, UNIT, SPELL, SPELL], piles).map(p => p.cards), [[UNIT, SPELL], [UNIT], [SPELL]]);
  assert.deepEqual(reconcilePiles([UNIT, SPELL], piles).map(p => p.cards), [[UNIT, SPELL], [], []],
    'empty piles are kept');
  assert.deepEqual(reconcilePiles([], piles).map(p => p.cards), [[], [], []]);
});

/* ══ §9 seed, and the pile edits ═══════════════════════════════════════ */

test('§9 ⭐ seedPiles: one pile per Sorted row, in Sorted order (moves included), each keeping its row key', () => {
  const a = analyzeDeck(MIXED);
  const grid = sortedGrid(a, 'type', undefined);
  const seed = seedPiles(a, 'type', undefined);
  assert.deepEqual(seed.map(p => [p.name, p.auto]), grid.rows.map(r => [r.label, r.key]));
  assert.ok(sameMultiset(seed.flatMap(p => p.cards), MIXED), 'the seed holds the deck exactly');
  seed.forEach((p, i) => assert.deepEqual(p.cards,
    grid.rows[i]!.cells.flatMap(c => c.entries.flatMap(e => Array(e.n).fill(e.name))), `${p.name}: Sorted order`));
  assert.equal(new Set(seed.map(p => p.id)).size, seed.length, 'ids unique');
  assert.ok(seed.every(p => /^[A-Za-z0-9_-]{1,16}$/.test(p.id)), 'ids the server keeps');
  // a moved card is seeded where it was moved to
  const m = moveTo(undefined, 'type', UNIT, { row: 'spells', col: colKeyOf(UNIT) }, naturalCell(UNIT, 'type'));
  const moved = seedPiles(a, 'type', m);
  assert.ok(moved.find(p => p.auto === 'spells')!.cards.includes(UNIT));
  assert.ok(!moved.find(p => p.auto === 'units')!.cards.includes(UNIT));
  assert.deepEqual(seedPiles(analyzeDeck([]), 'type', undefined), [{ id: 'p1', name: 'Pile', cards: [] }]);
  assert.deepEqual(reconcilePiles(MIXED, seed), seed, 'a fresh seed needs no reconcile');
});

test('§9 the pile edits move, add, rename and delete — and never change the cards', () => {
  const base: DeckPile[] = [
    { id: 'p1', name: 'Units', cards: [UNIT, UNIT2, UNIT] },
    { id: 'p2', name: 'Spells', cards: [SPELL] },
  ];
  const all = (ps: DeckPile[]) => ps.flatMap(p => p.cards);
  const moved = movePileCard(base, UNIT, 'p1', 'p2', 0);
  assert.deepEqual(moved.map(p => p.cards), [[UNIT, UNIT2], [UNIT, SPELL]], 'the LAST copy in the source, before index 0');
  assert.deepEqual(movePileCard(base, UNIT, 'p1', 'p1', 0).map(p => p.cards)[0], [UNIT, UNIT, UNIT2], 'within one pile');
  assert.deepEqual(movePileCard(base, UNIT2, 'p1', 'p1', 3)[0]!.cards, [UNIT, UNIT, UNIT2], 'index counts the pile before the lift');
  const row: DeckPile[] = [{ id: 'q', name: 'q', cards: [UNIT, UNIT2, SPELL, XCARD] }];
  assert.deepEqual(movePileCard(row, UNIT, 'q', 'q', 2)[0]!.cards, [UNIT2, UNIT, SPELL, XCARD],
    'dropped before SPELL (index 2 as the pile was) lands before SPELL');
  assert.deepEqual(movePileCard(base, SPELL, 'p1', 'p2'), base, 'a name the source lacks changes nothing');
  assert.deepEqual(movePileCard(base, UNIT, 'p1', 'nope'), base, 'an unknown pile changes nothing');

  const added = newPile(base);
  assert.equal(added.length, 3);
  assert.deepEqual(added[2], { id: 'p3', name: 'Pile 3', cards: [] }, 'appended, named, with a free id');
  assert.equal(newPile(base, 'Units')[2]!.name, 'Units · 2', 'a clashing name is told apart');
  assert.equal(newPile(base, 'x'.repeat(60))[2]!.name.length, 40);
  assert.equal(renamePile(base, 'p2', '  Tricks ')[1]!.name, 'Tricks');
  assert.equal(renamePile(base, 'p2', '   ')[1]!.name, 'Spells', 'a blank rename keeps the name');

  const del = deletePile(base, 'p1');
  assert.deepEqual(del, [{ id: 'p2', name: 'Spells', cards: [UNIT, UNIT2, UNIT, SPELL] }],
    'the cards go to the front of the NEXT pile — reading order unchanged');
  assert.deepEqual(deletePile(base, 'p2')[0]!.cards, [UNIT, UNIT2, UNIT, SPELL], 'the last pile hands back to the previous');
  assert.deepEqual(deletePile(del, 'p2'), del, 'the only pile cannot be deleted');
  for (const ps of [moved, added, del]) assert.ok(sameMultiset(all(ps), all(base)), 'same cards, always');
  assert.deepEqual(base[0]!.cards, [UNIT, UNIT2, UNIT], 'and the input is never mutated');
});
