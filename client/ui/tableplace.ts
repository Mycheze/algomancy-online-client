/* WHAT A MOVE ON THE TABLE DOES — the builder's one door, without the DOM.
 *
 * `applyPlace` is the arithmetic of ui/tabletop.ts `place()`: where a carried
 * card comes from, where it lands, what the copy cap and a restricted pool
 * refuse, and the arrangement following the deck. It reads the table through
 * `PlaceHost` (the slice of a TableHost it needs) and returns the change, or
 * why there is none; it never commits. Two callers:
 *
 *  · ui/tabletop.ts `place()`, which commits the change through its host;
 *  · server/collab.ts, which replays a shared table's moves against the
 *    session's own copy. A move names its card by (zone, index, name), and the
 *    name must still be there, so a move made against a table someone else has
 *    since changed is refused here rather than moving the wrong card.
 *
 * `undoMerge` is a shared table's Undo: a person's own last change, taken back
 * only where nobody has touched what it changed since.
 *
 * Pure and DOM-free, like ui/deckarrange.ts: the server imports it.
 */
import {
  deletePile, insertCard, movePile, movePileCard, newPileAt, reconcilePiles, removeAt, renamePile, seedPiles,
  type DeckPile, type ResortBy,
} from './deckarrange.ts';
import { MATCH_COPY_CAP } from '../engine/src/matchdeck.ts';

/** Where a card is picked up from. Indexes are positions in the pile as drawn.
 * `binder` is the pool (the name it had when the pool was a binder; 536 and
 * 541 pin it as the pool's source). */
export type Carry =
  | { from: 'binder'; name: string }
  | { from: 'pile'; pile: string; index: number; name: string }
  | { from: 'maybe'; index: number; name: string }
  | { from: 'side'; index: number; name: string }
  | { from: 'strip'; index: number; name: string }
  | { from: 'head'; pile: string };

/** An arrangement edit: no card moves, but it is still a `place()` */
export type Arrange =
  | { op: 'rename'; pile: string; name: string }
  | { op: 'delpile'; pile: string }
  | { op: 'addpile' }
  | { op: 'resort'; by: ResortBy }
  | { op: 'undo' }
  | { op: 'redo' }
  /** the deck replaced whole (the challenge's Import a deck), undoably —
   * with `side`, the sideboard too (a cube's Suggest a deck) */
  | { op: 'set'; cards: string[]; side?: string[]; sort?: 'cost' };

/** Where it goes. A destination index counts AFTER the carried card has left
 * (ui/deckarrange.ts); absent = the end. `binder` is the pool: out of the deck. */
export type Place =
  | { at: 'pile'; pile: string; index?: number }
  | { at: 'newpile'; pos: number }
  | { at: 'row'; pos: number }
  | { at: 'maybe'; index?: number }
  | { at: 'side'; index?: number }
  | { at: 'strip'; index?: number }
  | { at: 'binder' }
  | { at: 'auto' }
  | { at: 'arrange'; edit: Arrange };

/** what a move changes; a field is present only when it changed */
export interface TableNext { cards?: string[]; maybe?: string[]; sideboard?: string[]; piles?: DeckPile[] | null }

/** what applyPlace reads of a table: a TableHost is one */
export interface PlaceHost {
  kind: 'deck' | 'challenge';
  cards(): readonly string[];
  maybe?(): readonly string[];
  side?(): readonly string[];
  piles(): readonly DeckPile[] | null;
  cap?: number;
  owned?(): ReadonlyMap<string, number>;
  refuse?(next: TableNext): string | null;
}

export type Placed =
  | { ok: true; next: TableNext; landed: { zone: string; index: number } | null }
  /** nothing changes; `note` says why when a person should be told */
  | { ok: false; note: string | null };

const count = (list: readonly string[], name: string): number => list.filter(c => c === name).length;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const pileZone = (id: string): string => `pile|${id}`;

/** the piles on the table: a deck's saved ones held to the deck (or, never
 * arranged, the deck by cost); a challenge's scratch piles as saved */
export function pilesOf(h: PlaceHost): DeckPile[] {
  const saved = h.piles();
  if (h.kind !== 'deck') return saved ? saved.map(p => ({ ...p, cards: [...p.cards] })) : [];
  return saved ? reconcilePiles(h.cards(), saved) : seedPiles(h.cards(), 'cost');
}

/**
 * Put `carry` at `to` (or, with `carry` null, apply an arrangement edit other
 * than Undo and Redo, which are the caller's history). Computes the next state
 * with the pure edits of ui/deckarrange.ts; `ok: false` when nothing would
 * change or the move is refused.
 */
export function applyPlace(h: PlaceHost, carry: Carry | null, to: Place): Placed {
  const no = (note: string | null = null): Placed => ({ ok: false, note });
  const deckPiles = h.kind === 'deck';
  let cards = [...h.cards()];
  const maybe = h.maybe ? [...h.maybe()] : null;
  let side = h.side ? [...h.side()] : null;
  const saved = h.piles();
  let piles = pilesOf(h);
  let landed: { zone: string; index: number } | null = null;

  /** one copy of `name` out of the deck list (constructed: the last copy;
   * order means nothing there) */
  const cutOne = (name: string): void => { const i = cards.lastIndexOf(name); if (i >= 0) cards.splice(i, 1); };

  if (to.at === 'arrange') {
    const e = to.edit;
    if (e.op === 'rename') piles = renamePile(piles, e.pile, e.name);
    else if (e.op === 'delpile') piles = deletePile(piles, e.pile);
    else if (e.op === 'addpile') piles = newPileAt(piles, piles.length);
    else if (e.op === 'resort') piles = seedPiles(deckPiles ? cards : piles.flatMap(p => p.cards), e.by);
    // a deck replaced whole may ask to be laid out as Re-sort lays it (the cube's Suggest), not heaped in one "New" pile
    else if (e.op === 'set') { cards = [...e.cards]; if (e.side && side) side = [...e.side]; if (deckPiles && e.sort) piles = seedPiles(cards, e.sort); }
    else return no();
  } else if (!carry) {
    return no();
  } else if (carry.from === 'head') {
    if (to.at !== 'row') return no();
    const from = piles.findIndex(p => p.id === carry.pile);
    if (from < 0) return no();
    piles = movePile(piles, from, to.pos);
  } else {
    const { name } = carry;
    // 0 — a copy ENTERING the deck (a new one from the pool, tapped, dragged
    // or Add another; or one from Maybe or the Sideboard) stops at the copy
    // cap, the same note for all: nothing moves
    const capped = capNote(h, carry, to);
    if (capped) return no(capped);
    // …and a NEW copy stops at what a restricted pool holds (a cube's drafted cards)
    const short = ownedNote(h, carry, to);
    if (short) return no(short);
    // 1 — take it from where it was. A copy leaving the deck for good (the
    // pool, Maybe) leaves the deck list; one moving inside the table does not
    let piece: string | null = name;
    if (carry.from === 'maybe') {
      if (!maybe || maybe[carry.index] !== name) return no();
      maybe.splice(carry.index, 1);
    } else if (carry.from === 'side') {
      if (!side || side[carry.index] !== name) return no();
      side.splice(carry.index, 1);
    } else if (carry.from === 'strip') {
      if (cards[carry.index] !== name) return no();
      cards.splice(carry.index, 1);
    } else if (carry.from === 'pile') {
      const p = piles.find(x => x.id === carry.pile);
      if (!p || p.cards[carry.index] !== name) return no();
      const movingInside = to.at === 'pile' || to.at === 'newpile';
      if (!movingInside) {
        const r = removeAt(piles, carry.pile, carry.index);
        piles = r.piles;
        piece = r.name;
        if (deckPiles) cutOne(name);
      }
    }
    if (!piece) return no();
    // 2 — and put it where it goes
    const intoNewPile = (pos: number): string => {
      piles = newPileAt(piles, pos);
      return piles[Math.max(0, Math.min(pos, piles.length - 1))]!.id;
    };
    if (to.at === 'binder') {
      if (carry.from === 'binder') return no();
    } else if (to.at === 'maybe') {
      if (!maybe) return no();
      const at = Math.max(0, Math.min(to.index ?? maybe.length, maybe.length));
      maybe.splice(at, 0, name);
      landed = { zone: 'maybe', index: at };
    } else if (to.at === 'side') {
      if (!side) return no();
      const at = Math.max(0, Math.min(to.index ?? side.length, side.length));
      side.splice(at, 0, name);
      landed = { zone: 'side', index: at };
    } else if (to.at === 'strip') {
      if (deckPiles) return no();
      const at = Math.max(0, Math.min(to.index ?? cards.length, cards.length));
      cards.splice(at, 0, name);
      landed = { zone: 'strip', index: at };
    } else if (to.at === 'auto') {
      if (carry.from !== 'binder' && carry.from !== 'maybe' && carry.from !== 'side') return no();
      // the reconcile's rule: next to its other copies, else its Re-sort pile
      cards.push(name);
      if (!deckPiles) landed = { zone: 'strip', index: cards.length - 1 };
    } else {
      const pile = to.at === 'pile' ? to.pile : intoNewPile(to.pos);
      const target = piles.find(p => p.id === pile);
      if (!target) return no();
      const index = to.at === 'pile' && to.index !== undefined ? to.index : Number.MAX_SAFE_INTEGER;
      if (carry.from === 'pile') {
        piles = movePileCard(piles, carry.pile, carry.index, pile, index);
      } else {
        piles = insertCard(piles, name, pile, index);
        if (deckPiles) cards.push(name);
      }
      const now = piles.find(p => p.id === pile);
      if (now) landed = { zone: pileZone(pile), index: Math.min(index, now.cards.length - 1) };
    }
  }

  // the arrangement follows the deck, always
  if (deckPiles) piles = reconcilePiles(cards, piles);
  const next: TableNext = {};
  if (!same(cards, h.cards())) next.cards = cards;
  if (maybe && !same(maybe, h.maybe?.())) next.maybe = maybe;
  if (side && !same(side, h.side?.())) next.sideboard = side;
  if (!same(piles, saved)) next.piles = piles;
  if (!Object.keys(next).length) return no();
  // the host's rule: refused, nothing moves and the reason shows
  const why = h.refuse?.(next) ?? null;
  if (why) return no(why);
  return { ok: true, next, landed };
}

/** copies of `name` the cap counts: the deck and the sideboard together */
const capCount = (h: PlaceHost, name: string): number => count(h.cards(), name) + count(h.side?.() ?? [], name);

/** the refusal of a copy entering the deck at the copy cap — applyPlace asks
 * it for every carry: a new copy from the pool (tapped or dragged) and one from
 * Maybe count against the deck and sideboard together; one from the Sideboard
 * is already counted, so it stops only when the deck itself is full. A copy
 * moving inside the deck adds nothing (an imported over-cap deck still saves,
 * flagged). Into the Sideboard is the host's rule */
function capNote(h: PlaceHost, carry: Exclude<Carry, { from: 'head' }>, to: Place): string | null {
  if (h.cap === undefined || h.kind !== 'deck') return null;
  if (to.at === 'maybe' || to.at === 'side') return null;
  if (to.at === 'binder') return null; // back to the pool: out of the deck
  const { name } = carry;
  const full = carry.from === 'binder' || carry.from === 'maybe' ? capCount(h, name) >= h.cap
    : carry.from === 'side' ? count(h.cards(), name) >= h.cap : false;
  return full ? `Max ${h.cap} of ${name}.` : null;
}

/** copies of `name` on the table at all: the deck, the sideboard and Maybe */
export const usedCount = (h: PlaceHost, name: string): number => capCount(h, name) + count(h.maybe?.() ?? [], name);

/** the cap is reached for `name` (the card menu greys Add another) */
export const atCap = (h: PlaceHost, name: string): boolean =>
  (h.kind === 'deck' && h.cap !== undefined && capCount(h, name) >= h.cap)
  || (!!h.owned && usedCount(h, name) >= (h.owned().get(name) ?? 0));

/** the refusal of a NEW copy (from the pool, or Add another) past what a
 * restricted pool holds (TableHost.owned) — wherever it is put. A copy moving
 * on the table adds nothing, so only the pool's are counted */
function ownedNote(h: PlaceHost, carry: Exclude<Carry, { from: 'head' }>, to: Place): string | null {
  if (!h.owned || carry.from !== 'binder' || to.at === 'binder') return null;
  const have = h.owned().get(carry.name) ?? 0;
  if (usedCount(h, carry.name) < have) return null;
  return have ? `You have ${have} ${carry.name}.` : `${carry.name} is not in your pool.`;
}

/**
 * THE COPY CAP ACROSS BOTH BOARDS (docs/22 §4.1), as a refusal: the reason a
 * move may not happen, or null. A move that raises a card above two copies
 * counted over the deck AND the sideboard is refused when the sideboard holds
 * that card — moving a copy between the boards never changes the count, so
 * it is never refused. A third copy in the deck alone is NOT refused here:
 * that stays what it always was, an affordance (the `+` goes at two) and a
 * red ×3, because a saved deck may be illegal while you build.
 */
export function crossCapRefusal(
  before: { main: readonly string[]; side: readonly string[] },
  after: { main: readonly string[]; side: readonly string[] },
): string | null {
  const tally = (b: { main: readonly string[]; side: readonly string[] }): Map<string, number> => {
    const m = new Map<string, number>();
    for (const n of [...b.main, ...b.side]) m.set(n, (m.get(n) ?? 0) + 1);
    return m;
  };
  const was = tally(before);
  for (const [n, c] of tally(after)) {
    if (c > MATCH_COPY_CAP && c > (was.get(n) ?? 0) && after.side.includes(n)) {
      return `Max ${MATCH_COPY_CAP} of ${n} across the deck and sideboard.`;
    }
  }
  return null;
}

// ── a shared table ────────────────────────────────────────────────────

/** a deck table, whole: what a shared session holds */
export interface DeckTable { cards: string[]; maybe: string[]; side: string[]; piles: DeckPile[] }

/** a shared table as applyPlace reads it: a constructed deck at the copy cap,
 * with the cap across both boards as its rule — the deck page's own (ui/decks.ts).
 * The server replays every move through this, and each browser its own moves */
export function sharedDeckHost(t: DeckTable): PlaceHost {
  return {
    kind: 'deck',
    cards: () => t.cards, maybe: () => t.maybe, side: () => t.side, piles: () => t.piles,
    cap: MATCH_COPY_CAP,
    refuse: next => crossCapRefusal({ main: t.cards, side: t.side }, { main: next.cards ?? t.cards, side: next.sideboard ?? t.side }),
  };
}

/** a table after an applied move */
export function tableAfter(t: DeckTable, next: TableNext): DeckTable {
  return {
    cards: next.cards ?? [...t.cards],
    maybe: next.maybe ?? [...t.maybe],
    side: next.sideboard ?? [...t.side],
    piles: next.piles ?? t.piles.map(p => ({ ...p, cards: [...p.cards] })),
  };
}

const pileKey = (p: DeckPile | undefined): string => JSON.stringify(p ?? null);

/**
 * Take back the change `before` → `after` from `now`, where nobody has touched
 * what it changed since. What a change touched is counted in parts: each pile
 * (its name and its cards), the order of the piles, Maybe and the Sideboard.
 * Every part the change altered must still read as it left it; those parts go
 * back to `before`, and every other part stays as `now` has it. The deck list
 * follows the piles. Null when a part has moved on: the Undo is refused.
 *
 * Redo is the same call with `before` and `after` swapped.
 */
export function undoMerge(now: DeckTable, before: DeckTable, after: DeckTable): DeckTable | null {
  const byId = (t: DeckTable): Map<string, DeckPile> => new Map(t.piles.map(p => [p.id, p]));
  const b = byId(before), a = byId(after), n = byId(now);
  const touched = [...new Set([...b.keys(), ...a.keys()])].filter(id => pileKey(b.get(id)) !== pileKey(a.get(id)));
  for (const id of touched) if (pileKey(n.get(id)) !== pileKey(a.get(id))) return null;
  const listMoved = (k: 'maybe' | 'side'): boolean => !same(before[k], after[k]);
  for (const k of ['maybe', 'side'] as const) if (listMoved(k) && !same(now[k], after[k])) return null;
  // the order of the piles both sides hold: a moved pile is a change of its own
  const common = (t: DeckTable): string[] => t.piles.map(p => p.id).filter(id => b.has(id) && a.has(id));
  const reordered = !same(common(before), common(after));
  if (reordered && !same(common(now).filter(id => a.has(id) && b.has(id)), common(after))) return null;

  // the piles: now's, with every touched one put back as it was
  const back = new Set(touched);
  let piles = now.piles.filter(p => !back.has(p.id) || b.has(p.id)).map(p => (back.has(p.id) ? b.get(p.id)! : p));
  // a pile the change took away comes back where it stood
  for (const [i, p] of before.piles.entries()) {
    if (!back.has(p.id) || piles.some(x => x.id === p.id)) continue;
    const prev = before.piles.slice(0, i).reverse().find(x => piles.some(y => y.id === x.id));
    const at = prev ? piles.findIndex(y => y.id === prev.id) + 1 : 0;
    piles = [...piles.slice(0, at), p, ...piles.slice(at)];
  }
  if (reordered) {
    // the shared piles in before's order, in the slots they hold now
    const order = common(before);
    const slots = piles.map((p, i) => (order.includes(p.id) ? i : -1)).filter(i => i >= 0);
    const moved = order.map(id => piles.find(p => p.id === id)!);
    piles = [...piles];
    slots.forEach((slot, k) => { piles[slot] = moved[k]!; });
  }
  piles = piles.map(p => ({ ...p, cards: [...p.cards] }));

  // the deck is what the piles hold: now's list, less what left it, plus what came
  const tally = (ps: readonly DeckPile[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const p of ps) for (const c of p.cards) m.set(c, (m.get(c) ?? 0) + 1);
    return m;
  };
  const want = tally(piles), have = tally(now.piles);
  const cards = [...now.cards];
  for (const [c, k] of have) {
    for (let d = k - (want.get(c) ?? 0); d > 0; d--) { const i = cards.lastIndexOf(c); if (i >= 0) cards.splice(i, 1); }
  }
  for (const [c, k] of want) for (let d = k - (have.get(c) ?? 0); d > 0; d--) cards.push(c);

  return {
    cards,
    maybe: [...(listMoved('maybe') ? before.maybe : now.maybe)],
    side: [...(listMoved('side') ? before.side : now.side)],
    piles,
  };
}
