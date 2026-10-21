/* HOW A DECK IS ARRANGED ON THE DECK TABLE — never what is in it.
 *
 * Two arrangements, both the owner's (2026-10-21):
 *
 *   SORTED MOVES. *"Sorted remembers it."* The Sorted view is the auto-sort of
 *   ui/decklayout.ts — rows by the row split, columns by cost — plus the
 *   cards you dragged somewhere else, each a remembered exception drawn with a
 *   "moved by you" mark. A move is ONE NAME (all its copies) to ONE CELL,
 *   under ONE row split: a row key like "units" or "fire/wood" only means
 *   something inside its own split, so each split keeps its own map and
 *   switching split shows that split's moves, never a translation.
 *
 *   FREEFORM PILES. Named piles in an ordered, wrapping row; cards cascade
 *   inside a pile and keep their order. One entry per COPY, so a name may be
 *   split across piles.
 *
 * ⚠ ARRANGEMENT ONLY. Nothing here adds, removes or counts a card. The deck is
 * `cards`; a move names a card that is in it or is dropped, and the piles are
 * reconciled to hold exactly the deck's multiset — surplus out of the LAST pile
 * holding it, a deficit placed by a fixed preference. The server clamps the
 * same two records (server/collection.ts sanitizePiles / sanitizeSortMoves)
 * but never FILLS a deficit, because filling has layout opinions and the two
 * halves share no layout code. So the client reconciles on read.
 *
 * Pure and DOM-free, like ui/decklayout.ts and ui/deckstats.ts:
 * ui/test/534-deck-arrangement.test.ts calls every function here.
 */
import type { DeckAnalysis, CardFacts } from './deckstats.ts';
import { cardFacts, ELEMENTS } from './deckstats.ts';
import { byCost, sectionOf, type DeckEntry, type DeckGrouping } from './decklayout.ts';

// ── the records (mirrored, field for field, in server/collection.ts) ──

/** the row splits the table offers. `cost` is not one: columns already are cost */
export type RowSplit = 'type' | 'element' | 'flat';
export const ROW_SPLITS: readonly RowSplit[] = ['type', 'element', 'flat'];

/** one Sorted tweak: the cell a name was moved to, under one row split.
 * `col` is a cost key: '0'…'n', 'X', or 'unknown'. */
export interface SortCell { row: string; col: string }

/** split → name → the cell it was moved to. ABSENT = pure auto-sort. */
export type SortMoves = Partial<Record<RowSplit, Record<string, SortCell>>>;

export interface DeckPile {
  /** client-made, ≤ 16 chars [A-Za-z0-9_-] */
  id: string;
  /** ≤ 40 chars */
  name: string;
  /** one entry per COPY, in the order drawn */
  cards: string[];
  /** the Sorted ROW key it was seeded from ('units', 'spells'…), if any */
  auto?: string;
}

// ── keys ──────────────────────────────────────────────────────────────

const colOfFacts = (f: CardFacts | null): string => (!f ? 'unknown' : f.isX ? 'X' : String(f.mana));

/** the row a card naturally sits in under a split — decklayout's own bucket key */
export const rowKeyOf = (name: string, split: RowSplit): string =>
  sectionOf(cardFacts(name), split as DeckGrouping).key;

/** the cost column a card naturally sits in: '0'…, 'X', 'unknown' */
export const colKeyOf = (name: string): string => colOfFacts(cardFacts(name));

/** where a card sits with nothing moved */
export const naturalCell = (name: string, split: RowSplit): SortCell =>
  ({ row: rowKeyOf(name, split), col: colKeyOf(name) });

const isCol = (col: string): boolean => col === 'X' || col === 'unknown' || /^(0|[1-9][0-9]?)$/.test(col);

/**
 * A FACTS PROBE for a row key: a card shape that decklayout would bucket under
 * that key, or undefined when no card could.
 *
 * This is how a row key is checked and labelled WITHOUT a second table of row
 * keys here. The probe is only a guess at a shape; what makes it an answer is
 * the round trip — `sectionOf(probe).key === row` — so a key decklayout no
 * longer produces (a renamed `spellUnits`, say) fails the trip and every move
 * stored under it is dropped on read, losing the placement and never a card.
 */
function rowProbe(split: RowSplit, row: string): { key: string; label: string; sort: number } | undefined {
  const shapes: (CardFacts | null)[] = [null];
  if (split === 'type') {
    for (const kind of ['unit', 'spell', 'spellUnit', 'spellToken'] as const) shapes.push({ kind } as CardFacts);
  }
  if (split === 'element') {
    const parts = row.split('/');
    if (parts.length && new Set(parts).size === parts.length && parts.every(p => ELEMENTS.includes(p))) {
      shapes.push({ factions: parts } as CardFacts);
    }
  }
  for (const f of shapes) {
    const s = sectionOf(f, split as DeckGrouping);
    if (s.key === row) return s;
  }
  return undefined;
}

/** is `row` a row this split can draw? type: units|spells|spellUnits|unknown;
 * element: an element or element pair | none; flat: all */
export const validRow = (split: RowSplit, row: string): boolean => rowProbe(split, row) !== undefined;

// ── Sorted moves ──────────────────────────────────────────────────────

const sameCell = (a: SortCell, b: SortCell): boolean => a.row === b.row && a.col === b.col;

/** drop the empty maps, and an empty record becomes undefined */
function pruned(moves: SortMoves): SortMoves | undefined {
  const out: SortMoves = {};
  for (const split of ROW_SPLITS) {
    const m = moves[split];
    if (m && Object.keys(m).length) out[split] = m;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The moves that still mean something for this deck. Drops:
 *   · a name not in `cards` (cut, or sent to Maybe — if it comes back it is
 *     auto-sorted, a fresh card with no history);
 *   · a row that is not `validRow` for its split, a column that is not a cost key;
 *   · a move that equals the name's natural cell — nothing is ever stored
 *     that equals the auto answer;
 *   · an empty split map; and an empty record becomes undefined.
 * Never mutates its input.
 */
export function normaliseMoves(cards: readonly string[], moves: SortMoves | undefined): SortMoves | undefined {
  if (!moves || typeof moves !== 'object') return undefined;
  const inDeck = new Set(cards);
  const out: SortMoves = {};
  for (const split of ROW_SPLITS) {
    const m = moves[split];
    if (!m || typeof m !== 'object') continue;
    const kept: Record<string, SortCell> = {};
    for (const [name, cell] of Object.entries(m)) {
      if (!inDeck.has(name) || !cell || typeof cell !== 'object') continue;
      const { row, col } = cell;
      if (typeof row !== 'string' || typeof col !== 'string') continue;
      if (!validRow(split, row) || !isCol(col)) continue;
      if (sameCell({ row, col }, naturalCell(name, split))) continue;
      kept[name] = { row, col };
    }
    out[split] = kept;
  }
  return pruned(out);
}

/** a copy of the record with one split's map replaced */
function withSplit(moves: SortMoves | undefined, split: RowSplit, m: Record<string, SortCell>): SortMoves | undefined {
  return pruned({ ...(moves ?? {}), [split]: m });
}

/** Move `name` to `cell` under `split`. Onto its natural cell, the move is CLEARED. */
export function moveTo(
  moves: SortMoves | undefined, split: RowSplit, name: string, cell: SortCell, natural: SortCell,
): SortMoves | undefined {
  if (sameCell(cell, natural)) return putBack(moves, split, name);
  return withSplit(moves, split, { ...(moves?.[split] ?? {}), [name]: { row: cell.row, col: cell.col } });
}

/** clear one name's move under one split */
export function putBack(moves: SortMoves | undefined, split: RowSplit, name: string): SortMoves | undefined {
  const { [name]: _gone, ...rest } = moves?.[split] ?? {};
  return withSplit(moves, split, rest);
}

/** clear every move under ONE split — the others are kept */
export function putAllBack(moves: SortMoves | undefined, split: RowSplit): SortMoves | undefined {
  return withSplit(moves, split, {});
}

export type GridEntry = DeckEntry & { moved: boolean };
export interface SortedGrid {
  rows: { key: string; label: string; cells: { col: string; entries: GridEntry[] }[] }[];
  /** every row draws these, in this order: the numbers min…max, then X, then unknown */
  cols: string[];
}

/**
 * The Sorted grid: rows × cost columns, with the moves applied.
 *
 *  · With no moves it IS `deckSections(a, split)` cut into cost columns, card
 *    for card and in the same order (534 pins it).
 *  · Every row draws the same columns — the deck's lowest cost to its highest,
 *    filled in between — so the grid lines up and an empty cell is a drop slot.
 *    A column holding only a moved card is drawn too: "the column no longer
 *    exists" cannot happen.
 *  · A row the deck naturally has stays even when every card has been moved
 *    out of it (it is where they go back to); a row holding only moved cards
 *    is drawn, labelled and placed by decklayout's own section order.
 *  · Inside a cell the order is always cost, then name (`byCost`).
 */
export function sortedGrid(a: DeckAnalysis, split: RowSplit, moves: SortMoves | undefined): SortedGrid {
  const m = normaliseMoves(a.copies.map(c => c.name), moves)?.[split] ?? {};
  const rows = new Map<string, { key: string; label: string; sort: number; byCol: Map<string, GridEntry[]> }>();
  const rowFor = (meta: { key: string; label: string; sort: number }) => {
    let r = rows.get(meta.key);
    if (!r) rows.set(meta.key, r = { ...meta, byCol: new Map() });
    return r;
  };
  const used = new Set<string>();
  for (const c of a.copies) {
    const home = sectionOf(c.facts, split as DeckGrouping);
    rowFor(home);
    const moved = m[c.name];
    const cell: SortCell = moved ?? { row: home.key, col: colOfFacts(c.facts) };
    const r = moved ? rowFor(rowProbe(split, cell.row)!) : rows.get(home.key)!;
    const list = r.byCol.get(cell.col) ?? [];
    list.push({ name: c.name, n: c.n, facts: c.facts, moved: !!moved });
    r.byCol.set(cell.col, list);
    used.add(cell.col);
  }
  const nums = [...used].filter(c => /^\d+$/.test(c)).map(Number);
  const cols: string[] = [];
  if (nums.length) for (let n = Math.min(...nums); n <= Math.max(...nums); n++) cols.push(String(n));
  if (used.has('X')) cols.push('X');
  if (used.has('unknown')) cols.push('unknown');
  return {
    cols,
    rows: [...rows.values()]
      .sort((x, y) => x.sort - y.sort || x.label.localeCompare(y.label))
      .map(r => ({
        key: r.key,
        label: r.label,
        cells: cols.map(col => ({ col, entries: (r.byCol.get(col) ?? []).sort(byCost) })),
      })),
  };
}

// ── Freeform piles ────────────────────────────────────────────────────

export const MAX_PILE_NAME = 40;

const copyPiles = (piles: readonly DeckPile[]): DeckPile[] => piles.map(p => ({ ...p, cards: [...p.cards] }));

/** the smallest `p<n>` nobody holds — deterministic, so the same edit makes the same record */
function freshId(piles: readonly DeckPile[]): string {
  const taken = new Set(piles.map(p => p.id));
  let n = 1;
  while (taken.has(`p${n}`)) n++;
  return `p${n}`;
}

/** a pile name nobody else holds: "Pile 2", or "Units · 2" for a second Units */
function freeName(piles: readonly DeckPile[], want: string, exceptId?: string): string {
  const taken = new Set(piles.filter(p => p.id !== exceptId).map(p => p.name.toLowerCase()));
  if (!taken.has(want.toLowerCase())) return want;
  for (let n = 2; ; n++) {
    const s = `${want.slice(0, MAX_PILE_NAME - 6)} · ${n}`;
    if (!taken.has(s.toLowerCase())) return s;
  }
}

/**
 * Freeform's first open on a deck with no piles: one pile per Sorted row
 * ("Units", "Spells", "Spell units" under the type split), each holding its
 * row's cards in Sorted order — moves included, copies expanded — and each
 * keeping `auto` = its row key. A deck with no cards gets one empty pile.
 */
export function seedPiles(a: DeckAnalysis, split: RowSplit, moves: SortMoves | undefined): DeckPile[] {
  const out: DeckPile[] = [];
  for (const row of sortedGrid(a, split, moves).rows) {
    const cards = row.cells.flatMap(c => c.entries.flatMap(e => Array.from({ length: e.n }, () => e.name)));
    if (!cards.length) continue;
    out.push({ id: freshId(out), name: freeName(out, row.label.slice(0, MAX_PILE_NAME)), cards, auto: row.key });
  }
  return out.length ? out : [{ id: 'p1', name: 'Pile', cards: [] }];
}

const tally = (list: readonly string[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const n of list) m.set(n, (m.get(n) ?? 0) + 1);
  return m;
};

/**
 * The piles, holding EXACTLY the deck: the multiset of every pile's cards
 * equals the multiset of `cards`.
 *
 *  · SURPLUS (a copy cut while piles exist): out of the LAST pile holding the
 *    name, its last copy there — the same rule as the server's clamp.
 *  · DEFICIT (a copy added from the drawer, an import, another device), each
 *    copy to the first of:
 *      1. the first pile already holding that name — beside its other copies;
 *      2. the first pile whose `auto` is the card's `rowKeyOf(name, 'type')`;
 *      3. a pile named "New", made at the FRONT if there is none.
 *  · Cards already placed are never reordered, and it is idempotent.
 */
export function reconcilePiles(cards: readonly string[], piles: readonly DeckPile[]): DeckPile[] {
  const out = copyPiles(piles);
  const want = tally(cards);
  const have = tally(out.flatMap(p => p.cards));
  for (const [name, n] of have) {
    let extra = n - (want.get(name) ?? 0);
    for (let p = out.length - 1; p >= 0 && extra > 0; p--) {
      const pile = out[p]!.cards;
      for (let i = pile.length - 1; i >= 0 && extra > 0; i--) {
        if (pile[i] === name) { pile.splice(i, 1); extra--; }
      }
    }
  }
  for (const [name, n] of want) {
    let short = n - (have.get(name) ?? 0);
    while (short-- > 0) {
      const holding = out.find(p => p.cards.includes(name));
      if (holding) { holding.cards.splice(holding.cards.lastIndexOf(name) + 1, 0, name); continue; }
      const row = rowKeyOf(name, 'type');
      const target = out.find(p => p.auto === row)
        ?? out.find(p => p.name === 'New')
        ?? (out.unshift({ id: freshId(out), name: freeName(out, 'New'), cards: [] }), out[0]!);
      target.cards.push(name);
    }
  }
  return out;
}

/**
 * One copy of `name` from pile `fromPile` to pile `toPile`, inserted before the
 * card now at `index` there (absent = at the end). The copy taken is the last
 * one in the source pile. An unknown pile or a name the source does not hold
 * changes nothing.
 */
export function movePileCard(
  piles: readonly DeckPile[], name: string, fromPile: string, toPile: string, index?: number,
): DeckPile[] {
  const out = copyPiles(piles);
  const from = out.find(p => p.id === fromPile);
  const to = out.find(p => p.id === toPile);
  if (!from || !to) return out;
  const at = from.cards.lastIndexOf(name);
  if (at < 0) return out;
  from.cards.splice(at, 1);
  // `index` counts the target as it was BEFORE the copy left it
  let i = index ?? to.cards.length;
  if (from === to && index !== undefined && at < index) i--;
  to.cards.splice(Math.max(0, Math.min(i, to.cards.length)), 0, name);
  return out;
}

const cleanName = (raw: string | undefined): string => String(raw ?? '').trim().slice(0, MAX_PILE_NAME);

/** an empty pile at the END of the row — the new pile is the last element */
export function newPile(piles: readonly DeckPile[], name?: string): DeckPile[] {
  const out = copyPiles(piles);
  const want = cleanName(name) || `Pile ${out.length + 1}`;
  out.push({ id: freshId(out), name: freeName(out, want), cards: [] });
  return out;
}

/** a blank name leaves the pile as it was named */
export function renamePile(piles: readonly DeckPile[], id: string, name: string): DeckPile[] {
  const out = copyPiles(piles);
  const p = out.find(x => x.id === id);
  const want = cleanName(name);
  if (p && want) p.name = freeName(out, want, id);
  return out;
}

/**
 * Delete a pile; its cards go to the NEXT pile, in front of what is there
 * (the previous pile, at its end, if it was the last), so the reading order of
 * every card is unchanged. The last pile standing cannot be deleted.
 */
export function deletePile(piles: readonly DeckPile[], id: string): DeckPile[] {
  const out = copyPiles(piles);
  const i = out.findIndex(p => p.id === id);
  if (i < 0 || out.length < 2) return out;
  const [gone] = out.splice(i, 1);
  if (i < out.length) out[i]!.cards.unshift(...gone!.cards);
  else out[i - 1]!.cards.push(...gone!.cards);
  return out;
}
