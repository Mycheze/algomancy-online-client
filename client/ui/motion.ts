/* DOM-free motion logic: what MOVED between two game states.
 *
 * The client is a dumb terminal that re-renders everything after every action
 * (main.ts §render), so nothing in the DOM survives to be animated. Instead we
 * take a CENSUS of every card-shaped thing in the state before and after, diff
 * the two, and hand the DOM layer (ui/anim.ts) a list of "this card went from
 * here to there". That keeps the hard part — identity across zones — pure and
 * testable, and keeps the animation layer a dumb tweener.
 *
 * Identity is per-zone and deliberately weak:
 *   field/mod entity  e<id>            stable (engine entity id)
 *   stack item        s<id>            stable (engine stack id)
 *   cache entry       c<uid>           stable (R41 uid), else name+occurrence
 *   hand / bin card   h<seat>:<name>#k index-free: the k-th copy of that name
 *
 * Hand and bin hold bare CardNames with no identity of their own, so the k-th
 * copy is the best handle there is. It has the property we actually want:
 * playing the 2nd of 5 cards retires exactly one key and leaves the other four
 * alone, instead of shifting every index by one.
 *
 * A card CHANGING zone therefore changes key, and no key survives the trip.
 * That is what makeMoves is for: a key that vanished and a key that appeared
 * naming the same card are the same physical card, moving. Wrong pairings are
 * possible (two copies of one card, one dying as the other is cast) and are
 * fine — the worst case is an arrow pointing at the wrong twin for 300ms.
 */
import type { CardName, GameState, Seat } from '../engine/src/types.ts';

/** placeholder name the server sends for a hidden card (opp hand / deck) —
 * see server/view.ts. A hidden card matches ANY card of the same seat, which
 * is exactly how "the opponent played something from hand" gets animated. */
export const HIDDEN_CARD = '__HIDDEN__';

export type MotionZone = 'hand' | 'bin' | 'cache' | 'field' | 'stack' | 'player';

/** one card-shaped thing in the state, and where to find it on screen */
export interface Slot {
  key: string;
  zone: MotionZone;
  seat: Seat;
  card: CardName;
  /** where to fly to/from when `key` itself has no element on screen (the bin
   * mini only shows the last three cards; a mod is a badge on its host) */
  anchor: string;
  /** change fingerprint — a difference here pulses the card in place */
  sig?: string;
  /** signed "how well is it doing", for the DIRECTION of that pulse */
  vitality?: number;
  /** a slot that appears from nowhere but KNOWS where it came from: a
   * triggered or activated ability leaps from the unit that produced it. Used
   * only when nothing else paired with it. */
  origin?: string;
}

/** the whole state as motion sees it: the slots, plus the zone sizes that have
 * no per-card slots (deck, pack, resources) and so can only be seen as deltas */
export interface Census {
  slots: Slot[];
  deck: number[];
  pack: number[];
  res: number[];
}

export interface Move {
  card: CardName;
  seat: Seat;
  /** slot key of the origin, or null when the card came out of nowhere */
  from: string | null;
  /** zone anchor to use when `from` is not on screen */
  fromAnchor: string | null;
  to: string | null;
  toAnchor: string | null;
  kind: 'move' | 'enter' | 'leave';
}

export interface Pulse { key: string; anchor: string; kind: 'hurt' | 'buff' }

export interface Motion { moves: Move[]; pulses: Pulse[] }

/** a zone anchor: the element to use when a slot has no element of its own.
 * ui/anim.ts resolves these against [data-animzone]. */
const anchorOf = (zone: MotionZone, seat: Seat): string =>
  zone === 'stack' ? '@stack' : `@${zone}:${seat}`;

const DECK_ANCHOR = (seat: Seat): string => `@deck:${seat}`;
const RES_ANCHOR = (seat: Seat): string => `@res:${seat}`;

/** the k-th copy of each name in a bare CardName list (hand, bin) */
export function nameKeys(names: readonly CardName[], prefix: string): string[] {
  const seen = new Map<CardName, number>();
  return names.map(n => {
    const k = seen.get(n) ?? 0;
    seen.set(n, k + 1);
    return `${prefix}${n}#${k}`;
  });
}

const deckCount = (s: GameState, seat: Seat): number =>
  s.mode === 'constructed' ? (s.decks?.[seat]?.length ?? 0) : s.sharedDeck.length;

/** every card-shaped thing in `s`, keyed for cross-render identity */
export function census(s: GameState): Census {
  const slots: Slot[] = [];
  const deck: number[] = [], pack: number[] = [], res: number[] = [];

  for (const pl of s.players) {
    const seat = pl.seat;
    deck[seat] = deckCount(s, seat);
    pack[seat] = s.packs?.[seat]?.length ?? 0;
    res[seat] = pl.resources.length;

    nameKeys(pl.hand, `h${seat}:`).forEach((key, i) => slots.push({
      key, zone: 'hand', seat, card: pl.hand[i]!, anchor: anchorOf('hand', seat),
    }));
    nameKeys(pl.bin, `b${seat}:`).forEach((key, i) => slots.push({
      key, zone: 'bin', seat, card: pl.bin[i]!, anchor: anchorOf('bin', seat),
    }));
    // cache entries carry a stable uid (R41); pre-uid entries fall back to
    // name+occurrence like hand and bin
    const cache = pl.cache ?? [];
    const cacheFallback = nameKeys(cache.map(c => c.card), `c${seat}:`);
    cache.forEach((cc, i) => slots.push({
      key: cc.uid !== undefined ? `c${cc.uid}` : cacheFallback[i]!,
      zone: 'cache', seat, card: cc.card, anchor: anchorOf('cache', seat),
    }));

    // the player themself: life / rot / debt changes pulse the identity row
    const rot = pl.rot ?? 0, debt = pl.debt ?? 0;
    slots.push({
      key: `p${seat}`, zone: 'player', seat, card: '',
      anchor: `@life:${seat}`,
      sig: `${pl.life}:${rot}:${debt}`,
      vitality: pl.life - rot * 2 - debt,
    });
  }

  for (const en of Object.values(s.entities)) {
    // a mod has no card of its own on screen — it is a badge on its host, and
    // ui/anim.ts tags that badge with the mod's key so the flight lands on it
    //
    // ZQPC: spell tokens have their own strip on the board now, beside the
    // bin. The ZONE stays 'field' — a token is still a permanent standing in a
    // region, and the pairing rules (PLAUSIBLE) must not change underneath it
    // — but the fallback ANCHOR points at the strip it actually lands in.
    slots.push({
      key: `e${en.id}`, zone: 'field', seat: en.controller, card: en.card,
      anchor: en.kind === 'spellToken'
        ? `@tokens:${en.controller}` : anchorOf('field', en.controller),
      sig: `${en.damage}:${en.counters}:${en.tempPower}:${en.tempToughness}:${en.mods.length}:${en.absent ? 1 : 0}`,
      vitality: en.counters + en.tempPower + en.tempToughness - en.damage,
    });
  }

  for (const it of s.stack) {
    // a triggered/activated ability is not a card changing zone — nothing left
    // hand for it — but it DID come from somewhere, and watching it leap off
    // its unit is the whole answer to "why is this on the stack?"
    const src = it.sourceId !== undefined ? s.entities[it.sourceId] : undefined;
    slots.push({
      key: `s${it.id}`, zone: 'stack', seat: it.controller,
      card: it.card ?? src?.card ?? '',
      anchor: anchorOf('stack', it.controller),
      ...(it.sourceId !== undefined ? { origin: `e${it.sourceId}` } : {}),
    });
  }

  return { slots, deck, pack, res };
}

/** zone transitions a card actually makes, as a small pairing bonus so a
 * hand→stack play beats a coincidental bin→bin name collision */
const PLAUSIBLE = new Set([
  'hand>stack', 'hand>field', 'hand>cache', 'hand>bin',
  'stack>field', 'stack>bin', 'stack>cache',
  'field>bin', 'field>field', 'field>hand', 'field>cache',
  'cache>stack', 'cache>field', 'cache>bin',
  'bin>field', 'bin>stack', 'bin>hand', 'bin>cache',
]);

/** how good a "this vanished slot became that new slot" pairing is; a score
 * below MIN_SCORE is no pairing at all */
const MIN_SCORE = 2;
function pairScore(g: Slot, a: Slot): number {
  if (g.zone === 'player' || a.zone === 'player') return -1;
  const hidden = g.card === HIDDEN_CARD || a.card === HIDDEN_CARD;
  // a hidden card is only ever "one of that seat's cards" — never match one
  // across seats, or every opponent draw would look like a card teleporting
  if (hidden && g.seat !== a.seat) return -1;
  let score = hidden ? 2 : g.card === a.card ? 5 : -1;
  if (score < 0) return -1;
  if (g.seat === a.seat) score += 2;
  if (PLAUSIBLE.has(`${g.zone}>${a.zone}`)) score += 1;
  return score;
}

/**
 * What changed between two censuses.
 *
 * Slots that survive with the same key are handled by the DOM layer's FLIP
 * pass (a unit walking from its region into an attack column keeps `e<id>`),
 * so they appear here only as `pulses` when their fingerprint changed. Keys
 * that came or went are paired up into `moves`.
 */
export function diffCensus(before: Census, after: Census): Motion {
  const bMap = new Map(before.slots.map(s => [s.key, s]));
  const aMap = new Map(after.slots.map(s => [s.key, s]));

  const pulses: Pulse[] = [];
  for (const [key, a] of aMap) {
    const b = bMap.get(key);
    if (!b || b.sig === undefined || a.sig === undefined || b.sig === a.sig) continue;
    const db = (a.vitality ?? 0) - (b.vitality ?? 0);
    if (db === 0) continue;
    pulses.push({ key, anchor: a.anchor, kind: db < 0 ? 'hurt' : 'buff' });
  }

  const gone = before.slots.filter(s => !aMap.has(s.key) && s.zone !== 'player');
  const born = after.slots.filter(s => !bMap.has(s.key) && s.zone !== 'player');

  // greedy best-first pairing: score every candidate pair, take them in order,
  // never reusing a side. Small n (a busy resolution moves a handful of cards)
  // so the O(n²) scan is free and beats a fussy incremental match.
  const pairs: { g: Slot; a: Slot; score: number }[] = [];
  for (const g of gone) {
    for (const a of born) {
      const score = pairScore(g, a);
      if (score >= MIN_SCORE) pairs.push({ g, a, score });
    }
  }
  pairs.sort((x, y) => y.score - x.score || x.g.key.localeCompare(y.g.key));

  const usedG = new Set<string>(), usedA = new Set<string>();
  const moves: Move[] = [];
  for (const p of pairs) {
    if (usedG.has(p.g.key) || usedA.has(p.a.key)) continue;
    usedG.add(p.g.key); usedA.add(p.a.key);
    moves.push({
      card: p.a.card === HIDDEN_CARD ? p.g.card : p.a.card,
      seat: p.a.seat,
      from: p.g.key, fromAnchor: p.g.anchor,
      to: p.a.key, toAnchor: p.a.anchor,
      kind: 'move',
    });
  }

  // What is left went somewhere with no per-card slot, or came from one. The
  // only honest evidence is a size delta on a countable zone; with none, the
  // card just fades (erased, trashed) or pops (created out of thin air).
  for (const g of gone) {
    if (usedG.has(g.key)) continue;
    const grewRes = (after.res[g.seat] ?? 0) > (before.res[g.seat] ?? 0);
    const grewDeck = (after.deck[g.seat] ?? 0) > (before.deck[g.seat] ?? 0);
    const to = g.zone === 'hand' && grewRes ? RES_ANCHOR(g.seat)
      : g.zone === 'hand' && grewDeck ? DECK_ANCHOR(g.seat)
        : null;
    moves.push({
      card: g.card, seat: g.seat,
      from: g.key, fromAnchor: g.anchor,
      to, toAnchor: to,
      kind: to ? 'move' : 'leave',
    });
  }
  for (const a of born) {
    if (usedA.has(a.key)) continue;
    const shrankDeck = (before.deck[a.seat] ?? 0) > (after.deck[a.seat] ?? 0);
    const shrankPack = (before.pack[a.seat] ?? 0) > (after.pack[a.seat] ?? 0);
    // an ability's source unit is still standing there, so the origin key is
    // looked up in the BEFORE frame and is normally still on screen
    const origin = a.origin && bMap.has(a.origin) ? a.origin : null;
    const from = origin ?? (a.zone === 'hand' && (shrankDeck || shrankPack) ? DECK_ANCHOR(a.seat) : null);
    moves.push({
      card: a.card, seat: a.seat,
      from, fromAnchor: origin ? `@field:${a.seat}` : from,
      to: a.key, toAnchor: a.anchor,
      kind: from ? 'move' : 'enter',
    });
  }

  return { moves, pulses };
}
