/* A CUBE EVENT'S DECK TABLE, AS IT IS LAID OUT — the piles, the sideboard and
 * Maybe a player arranged while drafting and then while building (docs/25 §6,
 * owner 2026-11-14: *"When building, the layout you set during the draft should
 * automatically be there, for you"*).
 *
 * The server keeps one arrangement per player (POST /api/cube/<code>/arrange,
 * `CubeArrange`: plain lists of names) and hands it back in my view; these pure
 * functions turn it into the tabletop's piles and back, and hold a layout to
 * the cards a player really has:
 *
 *   · the DRAFT's table holds every pick — a pick that is not on it yet (a
 *     timeout's, or one made in another tab) lands in the main deck by cost
 *     (ui/deckarrange.ts landByCost), the way MTGO lays out a pick;
 *   · the BUILDER's table holds what is in the deck, the sideboard and Maybe —
 *     a card that is on none of them is in the pool, and stays there;
 *   · a submitted deck opens laid out in the last arrangement's piles where
 *     its cards are there, and by cost where they are not.
 *
 * Pure and DOM-free: ui/test/1361 calls every function here.
 */
import type { CubeArrange } from '../server/cube-types.ts';
import { landByCost, type DeckPile } from './deckarrange.ts';

export interface TableLayout {
  piles: DeckPile[];
  side: string[];
  maybe: string[];
}

export const emptyLayout = (): TableLayout => ({ piles: [], side: [], maybe: [] });

/** a pile Re-sort by cost made is named for its cost: "3", "X" */
const COST_NAME = /^(\d+|X)$/;

/** The server's arrangement as the table's piles: ids by position; a pile named for a cost takes
 *  that cost's new picks again; any other name is the player's (it survives being emptied). */
export function layoutFrom(a: CubeArrange | null | undefined): TableLayout {
  if (!a) return emptyLayout();
  const piles: DeckPile[] = a.piles.map((cards, i) => {
    const name = a.names?.[i]?.trim() || `Pile ${i + 1}`;
    return {
      id: `p${i + 1}`, name, cards: [...cards],
      ...(COST_NAME.test(name) ? { auto: `cost:${name}` } : { named: true }),
    };
  });
  return { piles, side: [...a.side], maybe: [...a.maybe] };
}

/** The table's layout as the server keeps it; `from` = whose table it is (the draft's holds every pick). */
export function arrangeOf(t: TableLayout, from: 'draft' | 'build' = 'draft'): CubeArrange {
  return { piles: t.piles.map(p => [...p.cards]), names: t.piles.map(p => p.name), side: [...t.side], maybe: [...t.maybe], from };
}

/** every card on the table: the main deck's piles, then the sideboard, then Maybe */
export const onTable = (t: TableLayout): string[] => [...t.piles.flatMap(p => p.cards), ...t.side, ...t.maybe];

const tally = (list: readonly string[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const n of list) m.set(n, (m.get(n) ?? 0) + 1);
  return m;
};

/**
 * The layout holding no card the player does not have (counting copies: the main deck's copies
 * are kept first, then the sideboard's, then Maybe's) — and, with `land`, EVERY card they have:
 * each one missing lands in the main deck by cost, in `held`'s order. Nothing kept moves.
 */
export function fitLayout(t: TableLayout, held: readonly string[], land: boolean): TableLayout {
  const left = tally(held);
  const keep = (n: string): boolean => {
    const k = left.get(n) ?? 0;
    if (k <= 0) return false;
    left.set(n, k - 1);
    return true;
  };
  let piles = t.piles.map(p => ({ ...p, cards: p.cards.filter(keep) }));
  const side = t.side.filter(keep), maybe = t.maybe.filter(keep);
  if (land) {
    for (const n of held) {
      const k = left.get(n) ?? 0;
      if (k <= 0) continue;
      left.set(n, k - 1);
      piles = landByCost(piles, n);
    }
  }
  return { piles, side, maybe };
}

/** the same layout? (what a push changed, what a save needs) */
export const sameLayout = (a: TableLayout, b: TableLayout): boolean =>
  JSON.stringify(arrangeOf(a)) === JSON.stringify(arrangeOf(b));

/**
 * The builder's table for a SUBMITTED deck: its main deck in the arrangement's piles where those
 * cards are there (by cost where they are not), its sideboard, and Maybe as arranged — less any
 * card the deck and sideboard already use.
 */
export function deckLayout(deck: { main: readonly string[]; side: readonly string[] }, a: CubeArrange | null | undefined,
  pool: readonly string[]): TableLayout {
  const t = layoutFrom(a);
  const main = fitLayout({ piles: t.piles, side: [], maybe: [] }, deck.main, true);
  const rest = tally(pool);
  for (const n of [...deck.main, ...deck.side]) rest.set(n, (rest.get(n) ?? 0) - 1);
  const maybe = t.maybe.filter(n => { const k = rest.get(n) ?? 0; if (k <= 0) return false; rest.set(n, k - 1); return true; });
  return { piles: main.piles, side: [...deck.side], maybe };
}
