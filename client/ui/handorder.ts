/*
 * THE HAND'S ORDER ON SCREEN — the player's own, never the game's.
 *
 * A player may drag their hand into any order (and the draft step's hand row
 * carries its order into the game). It is drawing only: every card still
 * answers with its engine index (`data-i`), so nothing sent, logged or
 * replayed can tell the hand was rearranged.
 *
 * The engine keeps a hand's surviving cards in their relative order (a play
 * removes one, a draw appends, the draft keeps pile order), so a changed hand
 * is lined up against the last one by name, in order: a card that is still
 * there keeps its place on screen, and a new one joins at the right.
 */

export interface HandOrder {
  /** the hand, in engine order, that `order` was built for */
  names: readonly string[];
  /** engine indices, in the order they are drawn */
  order: readonly number[];
  /** the order the next CHANGED hand should take, by name (the draft step's
   * hand row), or null */
  want: readonly string[] | null;
}

const identity = (names: readonly string[]): HandOrder =>
  ({ names: [...names], order: names.map((_, i) => i), want: null });

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((n, i) => n === b[i]);

const sameCards = (a: readonly string[], b: readonly string[]): boolean =>
  sameList([...a].sort(), [...b].sort());

/** `want`'s order over `names`: each name takes the first unused copy of it */
function byName(want: readonly string[], names: readonly string[]): number[] {
  const used = new Set<number>();
  return want.map(n => {
    const i = names.findIndex((m, k) => m === n && !used.has(k));
    used.add(i);
    return i;
  });
}

/** the order for the hand as it is now, kept from `prev` wherever it can be */
export function reconcile(prev: HandOrder | null, names: readonly string[]): HandOrder {
  if (!prev) return identity(names);
  if (sameList(prev.names, names)) return prev;
  if (prev.want && sameCards(prev.want, names)) return { names: [...names], order: byName(prev.want, names), want: null };
  // line the old hand up against the new, in order: old index → new index
  const to = new Map<number, number>();
  let j = 0;
  prev.names.forEach((n, a) => {
    const k = names.indexOf(n, j);
    if (k >= 0) { to.set(a, k); j = k + 1; }
  });
  const kept = prev.order.flatMap(a => (to.has(a) ? [to.get(a)!] : []));
  const seen = new Set(kept);
  return { names: [...names], order: [...kept, ...names.map((_, i) => i).filter(i => !seen.has(i))], want: null };
}

/** engine index `i` moved to place `at` among the other cards on screen */
export function moveCard(o: HandOrder, i: number, at: number): HandOrder {
  const rest = o.order.filter(k => k !== i);
  if (rest.length === o.order.length) return o;
  rest.splice(Math.max(0, Math.min(at, rest.length)), 0, i);
  return { ...o, order: rest };
}

/** the next changed hand takes this order (by name) */
export function expectOrder(o: HandOrder | null, names: readonly string[], want: readonly string[]): HandOrder {
  return { ...(o ?? identity(names)), want: [...want] };
}
