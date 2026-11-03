/* THE SIDEBOARD RULE — a Competitive Constructed deck: a main deck, a sideboard
 * of up to seven cards, and the swaps between them (docs/22 §4.1).
 *
 * The rule is the owner's (2026-11-02, docs/22 §0): "like Magic" — any cards
 * either way between games, the main deck stays at 30 or more, the sideboard
 * holds at most 7, and the copy cap counts main and sideboard together.
 * CR 901.9b, 901.9c
 *
 * PURE, and in its own file rather than in apply.ts on purpose: the engine is
 * never handed a sideboard. `createGame` still receives only the main deck, so
 * nothing here can change a game that exists, and the deck work and the
 * engine work never edit the same file.
 *
 * Two questions, two functions:
 *
 *   checkMatchDeck  may this deck be REGISTERED for a match?
 *   checkSwap       is this a legal between-games configuration OF that deck?
 *
 * (Saved swap presets were here until 2026-11-03, when the owner had them
 * taken out to be planned again: "the UX is terrible for it". Between games a
 * player moves cards by hand; checkSwap is all that needs.)
 */
import { checkDeck } from './apply.ts';
import { canonicalCardName } from './cards/dsl.ts';
import { DECK_LIST } from './cards/registry.ts';
import type { CardName } from './types.ts';

/** a sideboard holds at most this many cards. CR 901.9b */
export const SIDEBOARD_MAX = 7;
/** the copy cap, counted over main + sideboard together — checkDeck's number.
 * CR 901.9b */
export const MATCH_COPY_CAP = 2;

/** a deck as it is brought to one game of a match */
export interface MatchConfig {
  main: CardName[];
  side: CardName[];
}

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
  // CR 901.9b
  if (s.length > SIDEBOARD_MAX) {
    return { ok: false, error: `a sideboard holds at most ${SIDEBOARD_MAX} cards (got ${s.length})` };
  }
  // CR 901.9b — the cap counts both boards
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
 * from game 2's (§8 Q3). CR 901.9c
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
