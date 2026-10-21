/* HOW A DECK IS ARRANGED ON THE TABLETOP — never what is in it.
 *
 * The owner's tabletop deck builder (2026-10-21, spec v2): the deck's cards
 * lie on a table in PILES — named, in an ordered wrapping row, every copy a
 * card of its own, a pile's order kept. A deck nobody has arranged starts as
 * piles by cost; Re-sort lays it out again by cost, type or element. There is
 * one mode; the v1 "Sorted with remembered moves" view is gone, and so is its
 * record.
 *
 * ⚠ ARRANGEMENT ONLY. The deck is `cards`. `insertCard` and `removeAt` put a
 * copy on or take one off the TABLE; the caller adds it to or cuts it from
 * `cards` in the same commit — nothing here touches the list. The piles are
 * reconciled to hold exactly the deck's multiset: surplus out of the LAST pile
 * holding it, a deficit placed by a fixed preference. The server clamps the
 * same record (server/collection.ts sanitizePiles) but never FILLS a deficit,
 * because filling has layout opinions and the two halves share no layout
 * code. So the client reconciles on read.
 *
 * INDEXES, NOT NAMES. "Any single copy can be grabbed" means the copy under
 * the pointer, so a move names its source by (pile, index). And every
 * destination index counts the target AFTER the moved thing has left it —
 * which is what the drop preview shows: the gap opens at that index among the
 * cards that are still there.
 *
 * Pure and DOM-free, like ui/decklayout.ts and ui/deckstats.ts:
 * ui/test/534-deck-piles.test.ts calls every function here.
 */
import { analyzeDeck, cardFacts } from './deckstats.ts';
import { deckSections, sectionOf } from './decklayout.ts';

// ── the record (mirrored, field for field, in server/collection.ts) ──

export interface DeckPile {
  /** client-made, ≤ 16 chars [A-Za-z0-9_-] */
  id: string;
  /** ≤ 40 chars */
  name: string;
  /** one entry per COPY, in the order drawn (index 0 is the top of the fan) */
  cards: string[];
  /** the Re-sort bucket that made it, `<by>:<key>` ('cost:3', 'type:units',
   * 'element:fire/wood') — where reconcile sends a newcomer of that bucket */
  auto?: string;
  /** the user gave it its name. A NAMED pile survives being emptied; any other
   * pile disappears with its last card, the way a physical pile does */
  named?: boolean;
}

/** what Re-sort lays the table out by */
export type ResortBy = 'cost' | 'type' | 'element';

export const MAX_PILE_NAME = 40;

const copyPiles = (piles: readonly DeckPile[]): DeckPile[] => piles.map(p => ({ ...p, cards: [...p.cards] }));
const clampTo = (i: number, len: number): number => Math.max(0, Math.min(Number.isFinite(i) ? Math.trunc(i) : len, len));

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

/** the pile header a bucket gets: cost piles are just the number ("3", "X") */
function pileName(by: ResortBy, key: string, label: string): string {
  if (by === 'cost' && (key === 'X' || /^\d+$/.test(key))) return key;
  return label.slice(0, MAX_PILE_NAME);
}

/** the bucket a card files under for `by` — decklayout's own key, so the two can never disagree */
const bucketOf = (name: string, by: ResortBy): string => `${by}:${sectionOf(cardFacts(name), by).key}`;

/**
 * The table laid out by `by`: one pile per ui/decklayout.ts section — per
 * mana value (cheapest first, then X), per kind (Units / Spells / Spell
 * units), or per element and pair — each holding its cards in cost order
 * (`byCost`), copies expanded and adjacent, and each keeping `auto`. A deck
 * with no cards is a table with no piles.
 */
export function seedPiles(cards: readonly string[], by: ResortBy): DeckPile[] {
  const out: DeckPile[] = [];
  for (const sec of deckSections(analyzeDeck(cards), by)) {
    const list = sec.entries.flatMap(e => Array.from({ length: e.n }, () => e.name));
    out.push({ id: freshId(out), name: freeName(out, pileName(by, sec.key, sec.label)), cards: list, auto: `${by}:${sec.key}` });
  }
  return out;
}

const tally = (list: readonly string[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const n of list) m.set(n, (m.get(n) ?? 0) + 1);
  return m;
};

/**
 * The piles, holding EXACTLY the deck: the multiset of every pile's cards
 * equals the multiset of `cards`. This is how a deck changed somewhere else
 * (another device, an import, the deck page's own add drawer) comes back to
 * the table, and it is the binder's `+` too: add the name to `cards`, then
 * reconcile.
 *
 *  · SURPLUS (a copy cut while piles exist): out of the LAST pile holding the
 *    name, its last copy there — the same rule as the server's clamp.
 *  · DEFICIT, each copy to the first of:
 *      1. the first pile already holding that name — after its last copy there;
 *      2. the first pile whose `auto` bucket is the card's bucket under that
 *         pile's own Re-sort (a 3-drop joins "3"; a unit joins "Units");
 *      3. a pile named "New", made at the FRONT if there is none.
 *  · Cards already placed are never reordered, no pile is dropped (an emptied
 *    one included — only a DRAG empties a pile away), and it is idempotent.
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
      const target = out.find(p => {
        const by = p.auto?.split(':')[0];
        return (by === 'cost' || by === 'type' || by === 'element') && bucketOf(name, by) === p.auto;
      })
        ?? out.find(p => p.name === 'New')
        ?? (out.unshift({ id: freshId(out), name: freeName(out, 'New'), cards: [] }), out[0]!);
      target.cards.push(name);
    }
  }
  return out;
}

/** a pile a drag has just emptied goes, unless the user named it */
const tidy = (piles: DeckPile[], id: string): DeckPile[] =>
  piles.filter(p => p.id !== id || p.cards.length > 0 || p.named);

/**
 * One copy of `name` onto pile `toPile`, inserted at `index` (clamped; past
 * the end = at the end). A copy from the binder: the caller adds `name` to
 * `cards` in the same commit. An unknown pile changes nothing.
 */
export function insertCard(piles: readonly DeckPile[], name: string, toPile: string, index: number): DeckPile[] {
  const out = copyPiles(piles);
  const to = out.find(p => p.id === toPile);
  if (to) to.cards.splice(clampTo(index, to.cards.length), 0, name);
  return out;
}

/**
 * THE copy at `fromIndex` of pile `fromPile`, to pile `toPile` at `toIndex`.
 *
 * ⚠ `toIndex` COUNTS THE TARGET AFTER THE COPY HAS LEFT IT — the same pile
 * included: in [a, b, c, d], moving b (index 1) to index 2 gives [a, c, b, d].
 * A source pile left empty disappears unless it is named. An unknown pile or
 * an index the source does not have changes nothing.
 */
export function movePileCard(
  piles: readonly DeckPile[], fromPile: string, fromIndex: number, toPile: string, toIndex: number,
): DeckPile[] {
  const out = copyPiles(piles);
  const from = out.find(p => p.id === fromPile);
  const to = out.find(p => p.id === toPile);
  if (!from || !to || !Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= from.cards.length) return out;
  const [name] = from.cards.splice(fromIndex, 1);
  to.cards.splice(clampTo(toIndex, to.cards.length), 0, name!);
  return tidy(out, from.id);
}

/**
 * Take the copy at `index` off pile `pile` — to the binder (a cut), or to the
 * Maybe pile. `name` is the card taken, or null when there is no such copy
 * (and the piles are unchanged). The caller cuts it from `cards`. A pile left
 * empty disappears unless it is named.
 */
export function removeAt(piles: readonly DeckPile[], pile: string, index: number): { piles: DeckPile[]; name: string | null } {
  const out = copyPiles(piles);
  const p = out.find(x => x.id === pile);
  if (!p || !Number.isInteger(index) || index < 0 || index >= p.cards.length) return { piles: out, name: null };
  const [name] = p.cards.splice(index, 1);
  return { piles: tidy(out, p.id), name: name! };
}

const cleanName = (raw: string | undefined): string => String(raw ?? '').trim().slice(0, MAX_PILE_NAME);

/**
 * An empty pile inserted at row position `at` (clamped: 0 = first, past the
 * end = last), so the new pile is `out[clamp(at)]`. A drop on a gutter or the
 * empty table is this followed by `movePileCard`/`insertCard` into it, by the
 * new pile's id — so a source pile that empties away cannot lose it. Given a
 * name it is a NAMED pile; without one it is "Pile n".
 */
export function newPileAt(piles: readonly DeckPile[], at: number, name?: string): DeckPile[] {
  const out = copyPiles(piles);
  const given = cleanName(name);
  const pile: DeckPile = { id: freshId(out), name: freeName(out, given || `Pile ${out.length + 1}`), cards: [] };
  if (given) pile.named = true;
  out.splice(clampTo(at, out.length), 0, pile);
  return out;
}

/**
 * The pile at row position `from`, moved to `to` — and, as for a card, `to`
 * counts the row AFTER the pile has left it. Out of range changes nothing.
 */
export function movePile(piles: readonly DeckPile[], from: number, to: number): DeckPile[] {
  const out = copyPiles(piles);
  if (!Number.isInteger(from) || from < 0 || from >= out.length) return out;
  const [p] = out.splice(from, 1);
  out.splice(clampTo(to, out.length), 0, p!);
  return out;
}

/** a blank name leaves the pile as it was named; any other makes it NAMED */
export function renamePile(piles: readonly DeckPile[], id: string, name: string): DeckPile[] {
  const out = copyPiles(piles);
  const p = out.find(x => x.id === id);
  const want = cleanName(name);
  if (p && want) { p.name = freeName(out, want, id); p.named = true; }
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
