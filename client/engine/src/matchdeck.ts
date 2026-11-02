/* THE SIDEBOARD RULE — a Competitive Constructed deck: a main deck, a sideboard
 * of up to seven cards, and the swaps between them (docs/22 §4.1, §4.6).
 *
 * The rule is the owner's (2026-11-02, docs/22 §0): "like Magic" — any cards
 * either way between games, the main deck stays at 30 or more, the sideboard
 * holds at most 7, and the copy cap counts main and sideboard together.
 * CR: see W1 (sideboard record)
 *
 * PURE, and in its own file rather than in apply.ts on purpose: the engine is
 * never handed a sideboard. `createGame` still receives only the main deck, so
 * nothing here can change a game that exists, and the deck work and the
 * engine work never edit the same file.
 *
 * Three questions, three functions:
 *
 *   checkMatchDeck  may this deck be REGISTERED for a match?
 *   checkSwap       is this a legal between-games configuration OF that deck?
 *   applyPreset     what configuration does this saved swap give, or why not?
 *
 * ⚠ A PRESET IS A TARGET, NEVER A DELTA ON WHATEVER IS CURRENT. It is applied
 * to the REGISTERED deck every time, so two clicks give what one does, and a
 * preset that worked in game 2 still works in game 3 whatever game 2 used.
 * The delta reading fails half the time, for reasons nobody can see (§4.6).
 */
import { checkDeck } from './apply.ts';
import { canonicalCardName } from './cards/dsl.ts';
import { DECK_LIST } from './cards/registry.ts';
import type { CardName } from './types.ts';

/** a sideboard holds at most this many cards. CR: see W1 (sideboard record) */
export const SIDEBOARD_MAX = 7;
/** the copy cap, counted over main + sideboard together — checkDeck's number.
 * CR: see W1 (sideboard record) */
export const MATCH_COPY_CAP = 2;

/** a deck as it is brought to one game of a match */
export interface MatchConfig {
  main: CardName[];
  side: CardName[];
}

/** A saved swap (§4.6): which copies leave the main deck and which come in,
 * both MULTISETS relative to the registered deck. |in| ≠ |out| is fine — the
 * main deck's size may change. */
export interface SwapPreset {
  id: string;
  /** ≤ PRESET_NAME_MAX chars */
  name: string;
  /** main → sideboard */
  out: CardName[];
  /** sideboard → main */
  in: CardName[];
}

/** at most this many presets on a deck, and this long a name (§4.6) */
export const PRESETS_MAX = 12;
export const PRESET_NAME_MAX = 40;

export type MatchDeckResult =
  | { ok: true; main: CardName[]; side: CardName[] }
  | { ok: false; error: string };

const POOL = new Set<string>(DECK_LIST);

const isNameList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(c => typeof c === 'string');

function counts(list: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of list) m.set(n, (m.get(n) ?? 0) + 1);
  return m;
}

/** "Ignis Sprite, Rune Channeler (+3 more)" */
const few = (names: string[]): string =>
  names.slice(0, 5).join(', ') + (names.length > 5 ? ` (+${names.length - 5} more)` : '');

/**
 * May this deck be registered for a Competitive Constructed match?
 *
 * The main deck is `checkDeck`'s question exactly — the pool, the canonical
 * names, at least 30, at most two of a card — so a Single Card Duel deck is
 * never a CC deck (its thirty copies break the cap). Then the sideboard: pool
 * cards only, at most SIDEBOARD_MAX, and at most MATCH_COPY_CAP of any card
 * across BOTH boards, an alias counted as the card it names.
 *
 * Both lists come back in canonical names, positions unmoved. An absent
 * sideboard is an empty one.
 */
export function checkMatchDeck(main: unknown, side: unknown): MatchDeckResult {
  const m = checkDeck(main);
  if (!m.ok) return { ok: false, error: `main deck: ${m.error}` };
  const rawSide = side ?? [];
  if (!isNameList(rawSide)) return { ok: false, error: 'a sideboard must be a list of card names' };
  const s = rawSide.map(canonicalCardName);
  const unknown = [...new Set(s.filter(n => !POOL.has(n)))];
  if (unknown.length) return { ok: false, error: `sideboard: not in the scripted pool: ${few(unknown)}` };
  // CR: see W1 (sideboard record)
  if (s.length > SIDEBOARD_MAX) {
    return { ok: false, error: `a sideboard holds at most ${SIDEBOARD_MAX} cards (got ${s.length})` };
  }
  // CR: see W1 (sideboard record) — the cap counts both boards
  const over = [...counts([...m.cards, ...s])].filter(([, c]) => c > MATCH_COPY_CAP).map(([n]) => n);
  if (over.length) {
    return { ok: false, error: `max ${MATCH_COPY_CAP} copies of each card across the main deck and sideboard: ${few(over)}` };
  }
  return { ok: true, main: m.cards, side: s };
}

/**
 * Is `next` a legal configuration of the deck that was `registered`?
 *
 * Legal (checkMatchDeck) AND the same cards — main + side as a multiset,
 * aliases canonicalised — as the registration. Nothing else is asked: any
 * card may cross either way (owner, docs/22 §0), so this accepts every
 * configuration reachable from any other, which is what lets game 3 start
 * from game 2's (§8 Q3). CR: see W1 (sideboard record)
 */
export function checkSwap(registered: MatchConfig, next: MatchConfig): MatchDeckResult {
  if (!isNameList(next?.main) || !isNameList(next?.side)) {
    return { ok: false, error: 'a configuration is a main deck and a sideboard, each a list of card names' };
  }
  const was = counts([...registered.main, ...registered.side].map(canonicalCardName));
  const now = counts([...next.main, ...next.side].map(canonicalCardName));
  const added = [...now].filter(([n, c]) => c > (was.get(n) ?? 0)).map(([n]) => n);
  if (added.length) return { ok: false, error: `not in the registered deck: ${few(added)}` };
  const lost = [...was].filter(([n, c]) => c > (now.get(n) ?? 0)).map(([n]) => n);
  if (lost.length) return { ok: false, error: `missing from both boards: ${few(lost)}` };
  return checkMatchDeck(next.main, next.side);
}

/** `list` with one copy of each name in `take` removed — the LAST copy, so the
 * positions in front of it never move. Null if `list` holds too few. */
function without(list: readonly CardName[], take: readonly CardName[]): CardName[] | null {
  const out = [...list];
  for (const n of take) {
    const i = out.lastIndexOf(n);
    if (i < 0) return null;
    out.splice(i, 1);
  }
  return out;
}

/** the first card `want` needs more of than `have` holds, and how many it needs */
function shortOf(have: readonly CardName[], want: readonly CardName[]): [CardName, number] | null {
  const h = counts(have);
  for (const [n, c] of counts(want)) if (c > (h.get(n) ?? 0)) return [n, c];
  return null;
}

/**
 * The configuration a preset gives: the REGISTERED deck with `out` moved to
 * the sideboard and `in` moved to the main deck — or why it cannot be.
 *
 * Absolute, so idempotent: it never reads the current configuration. A preset
 * is usable iff `out ⊆ main`, `in ⊆ side` (multisets) and the result passes
 * checkMatchDeck. A later deck edit can make a stored preset stale; the error
 * says why in a sentence a button can show ("needs 2× Ignis Sprite in the
 * main deck"). Validity is computed, never stored (§4.6).
 *
 * Deterministic order: the main deck keeps its registered order with the
 * leavers taken out and the arrivals appended in preset order; the same for
 * the sideboard.
 */
export function applyPreset(registered: MatchConfig, p: Pick<SwapPreset, 'out' | 'in'>): MatchConfig | { error: string } {
  const main = registered.main.map(canonicalCardName);
  const side = registered.side.map(canonicalCardName);
  const out = (isNameList(p?.out) ? p.out : []).map(canonicalCardName);
  const inn = (isNameList(p?.in) ? p.in : []).map(canonicalCardName);
  const shortMain = shortOf(main, out);
  if (shortMain) return { error: `needs ${shortMain[1]}× ${shortMain[0]} in the main deck` };
  const shortSide = shortOf(side, inn);
  if (shortSide) return { error: `needs ${shortSide[1]}× ${shortSide[0]} in the sideboard` };
  const next: MatchConfig = {
    main: [...without(main, out)!, ...inn],
    side: [...without(side, inn)!, ...out],
  };
  if (next.main.length < 30) return { error: `would leave the main deck at ${next.main.length} cards — it needs 30` };
  if (next.side.length > SIDEBOARD_MAX) {
    return { error: `would put ${next.side.length} cards in the sideboard — it holds ${SIDEBOARD_MAX}` };
  }
  const c = checkMatchDeck(next.main, next.side);
  return c.ok ? { main: c.main, side: c.side } : { error: c.error };
}

/**
 * The preset that turns `registered` into `current` — the "set from current"
 * button (§4.6), and the inverse of applyPreset: applying the result to
 * `registered` gives `current`'s cards on each board. `out` is what the main
 * deck lost, `in` what it gained, both multisets in canonical names.
 */
export function presetBetween(registered: MatchConfig, current: MatchConfig): Pick<SwapPreset, 'out' | 'in'> {
  const was = counts(registered.main.map(canonicalCardName));
  const now = counts(current.main.map(canonicalCardName));
  const diff = (a: Map<string, number>, b: Map<string, number>): CardName[] => {
    const r: CardName[] = [];
    for (const [n, c] of a) for (let i = (b.get(n) ?? 0); i < c; i++) r.push(n);
    return r;
  };
  return { out: diff(was, now), in: diff(now, was) };
}
