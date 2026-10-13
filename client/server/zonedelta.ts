/* THE ZONE DELTA — the tail of every reference key, and the reader for it.
 *
 * rooms.ts writes one reference key per action (`referenceKey`): the action's
 * type, what it RESOLVED to in the state it was applied to, and, last, what it
 * moved through its own seat's private zones, as card names. That last part is
 * this file's `zoneDelta`. It lives here rather than in rooms.ts because it has
 * two readers now: rooms.ts, which compares two rebuilds of one log with it,
 * and cardledger.ts, which reads the card facts of a game that was played
 * before anybody wrote those facts down — the refs are the only record of
 * such a game that no rules change can move.
 *
 * The format is FROZEN by the files already on disk: every saved game since
 * reference keys were added carries these strings. Change a character of what zoneDelta emits and
 * every old file's refs read as drifted (driftedAgainst) and every refs-only
 * card ledger misreads. 333-zone-delta-parse pins it.
 */
import type { CardName, GameState, Seat } from '../engine/src/types.ts';
import { cardAliases } from '../engine/src/cards/dsl.ts';

/** The acting seat's own private zones, as card names — no entity ids, so a
 * renumbering cannot move it. */
export function zoneCards(s: GameState, seat: Seat): string[] {
  const p = s.players[seat];
  if (!p) return [];
  return [
    ...p.hand.map(c => `h:${c}`),
    ...p.bin.map(c => `b:${c}`),
    ...(p.cache ?? []).map(c => `c:${JSON.stringify(c)}`),
    ...(p.erased ?? []).map(c => `x:${c}`),
  ];
}

/** What an action MOVED through its own seat's private zones, as a multiset
 * difference. A difference, not a snapshot: the board an action lands on may
 * legitimately differ after an undo (the spliced play's own units are gone,
 * and that is what undo means), but what the action itself did with the
 * actor's cards is theirs and must come out the same. */
export function zoneDelta(before: GameState, after: GameState, seat: Seat): string {
  const n = new Map<string, number>();
  for (const c of zoneCards(before, seat)) n.set(c, (n.get(c) ?? 0) - 1);
  for (const c of zoneCards(after, seat)) n.set(c, (n.get(c) ?? 0) + 1);
  return [...n.entries()].filter(([, k]) => k !== 0).sort(([x], [y]) => (x < y ? -1 : 1))
    .map(([c, k]) => `${k > 0 ? '+' : ''}${k}${c}`).join(',');
}

/** One entry of a zone delta: `k` copies (signed) of `card` in zone `z`
 * (h hand, b bin, c cache, x erased). A cache entry's `card` is the cached
 * card's name, read out of its JSON. */
export interface ZoneMove { k: number; z: 'h' | 'b' | 'c' | 'x'; card: CardName }

/**
 * Read a zone delta back. Split only where a NEW entry starts — a signed count
 * followed by a zone letter and a colon — because a cache entry is JSON and
 * may itself contain commas. Card names contain no `,`, `|` or `:` (all of
 * them checked), and the lookahead does not care if one ever does.
 */
export function parseZoneDelta(tail: string): ZoneMove[] {
  if (!tail) return [];
  const out: ZoneMove[] = [];
  for (const part of tail.split(/,(?=[+-]\d+[hbcx]:)/)) {
    const m = /^([+-]\d+)([hbcx]):(.*)$/s.exec(part);
    if (!m) continue;
    const z = m[2] as ZoneMove['z'];
    let card = m[3]!;
    if (z === 'c') {
      try { card = (JSON.parse(card) as { card?: string }).card ?? card; } catch { /* keep the raw text */ }
    }
    out.push({ k: Number(m[1]), z, card });
  }
  return out;
}

/** A reference key split into what the card ledger needs: the action type,
 * every `i:"Card"` it resolved (in order), and the zone delta. */
export interface ParsedRef { type: string; named: CardName[]; indexed: [number, CardName][]; delta: ZoneMove[]; tail: string }

const NAMED = /(\d+):("(?:[^"\\]|\\.)*")/g;

export function parseRef(ref: string): ParsedRef {
  const bar = ref.indexOf('|');
  const type = bar < 0 ? ref : ref.slice(0, bar);
  const last = ref.lastIndexOf('|');
  const tail = last > bar ? ref.slice(last + 1) : '';
  const body = last > bar ? ref.slice(bar + 1, last) : '';
  const indexed: [number, CardName][] = [];
  for (const m of body.matchAll(NAMED)) {
    try {
      const v = JSON.parse(m[2]!) as unknown;
      // a resolved slot holds a card name; a resource slot holds an object
      if (typeof v === 'string') indexed.push([Number(m[1]), v]);
    } catch { /* an unreadable slot names nothing */ }
  }
  return { type, named: indexed.map(([, c]) => c), indexed, delta: parseZoneDelta(tail), tail };
}

/* ── A SAVED REF IN TODAY'S CARD NAMES ───────────────────────────────────
 *
 * A card named by an alias (registerAlias) is the same card — the printed
 * "Counter Theif" is Counter Thief, and a card renamed upstream is the same
 * card under a new name, while every ref written before the rename spells the
 * old one: in its resolved slots (`0:"Old Name"`), in a decision's label, and
 * in the zone delta (`-1h:Old Name`). Compared as text, each of those actions
 * would read as drifted ("it now refers to a different card") on a game that
 * replays exactly.
 *
 * The rule for a stored ref is therefore the rule for every stored name:
 * canonicalise ON READ, never rewrite the file, and never change what
 * `referenceKey` writes. The names come from the registry's own alias table
 * (`registerAlias`), so the next rename is one `registerAlias` line and this
 * follows it. The delta is RE-SORTED after respelling, because `zoneDelta`
 * sorts its entries by their text and a new name can sort to a new place.
 */

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** every whole-word occurrence of an old name, replaced by the name it is now */
function respell(text: string, pairs: readonly [string, string][]): string {
  for (const [old, now] of pairs) {
    if (!text.includes(old)) continue;
    text = text.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRe(old)}(?![A-Za-z0-9])`, 'g'), now);
  }
  return text;
}

/** a zone delta respelled and re-rendered exactly as `zoneDelta` renders one;
 * anything it cannot read as a delta is respelled as plain text */
function respellDelta(tail: string, pairs: readonly [string, string][]): string {
  if (!tail) return tail;
  const n = new Map<string, number>();
  for (const part of tail.split(/,(?=[+-]\d+[hbcx]:)/)) {
    const m = /^([+-]\d+)([hbcx]:.*)$/s.exec(part);
    if (!m) return respell(tail, pairs);
    const key = respell(m[2]!, pairs);
    n.set(key, (n.get(key) ?? 0) + Number(m[1]));
  }
  return [...n.entries()].filter(([, k]) => k !== 0).sort(([x], [y]) => (x < y ? -1 : 1))
    .map(([c, k]) => `${k > 0 ? '+' : ''}${k}${c}`).join(',');
}

/** A saved reference key, spelled in today's card names. Identity on every ref
 * that names no aliased card, which is nearly all of them.
 *
 * Compare refs with it on BOTH sides, never one: an alias is a whole word, and
 * a fresh ref can carry one in printed text the engine echoes (Blight's End's
 * prompt still says "Wight", the alias of Wraith). Respelled on one side only,
 * that would read as a difference where the raw text agreed. */
export function canonicalRef(ref: string): string {
  const pairs = cardAliases();
  if (!pairs.some(([old]) => ref.includes(old))) return ref;
  const bar = ref.lastIndexOf('|');
  if (bar < 0) return respell(ref, pairs);
  return respell(ref.slice(0, bar + 1), pairs) + respellDelta(ref.slice(bar + 1), pairs);
}

/** A bare zone delta (a ref's tail) in today's card names — canonicalRef for
 * the part after the last `|`. */
export function canonicalDelta(tail: string): string {
  const pairs = cardAliases();
  if (!pairs.some(([old]) => tail.includes(old))) return tail;
  return respellDelta(tail, pairs);
}
