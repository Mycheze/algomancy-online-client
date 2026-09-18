/* R298 — THE CARD LADDER: Elo for cards, folded out of Single Card Duels.
 *
 * A single card duel pits two decks of thirty copies of one card against each
 * other, so its result says something about the two CARDS and next to nothing
 * about the players — which is why the players' own folds all skip it (foldSeat,
 * isRated, the deck and lineage records) and this one reads nothing else.
 *
 * Same arithmetic as the player ladder, on purpose: rating.ts's expectation,
 * K-factor and rounding, and its TOTAL order, so the ladder is a pure function
 * of the set of games (rating.ts (3)) and a rebuild never drifts.
 *
 * WHAT COUNTS — the owner, 2026-09-18: "any finished game". Guests, signed in,
 * a link game, a rematch: all of it. Three things are not a result about two
 * cards and are left out:
 *   · an unfinished game, or one with no known winner;
 *   · a MIRROR (the same card on both sides) — a card beating itself says
 *     nothing about it. Counted in `mirrors` so the page can say it was played;
 *   · a WALKOVER (R290, conceded on turn 1). Nobody played the card. An EARLY
 *     concession (turn 2) counts at the reduced weight the player ladder uses.
 */
import type { CardName, Seat } from '../engine/src/types.ts';
import { checkSingleDeck } from '../engine/src/apply.ts';
import { concessionWeight, EARLY_K_SCALE, type Concession } from './concession.ts';
import { kFactor, nextRating, PUBLIC_AFTER, ratingOrder, START_RATING } from './rating.ts';

/** the part of a history row this fold reads (structural, like RatableGame) */
export interface DuelGame {
  code: string;
  playedAt: string;
  finished: boolean;
  winner: Seat | null;
  /** the card per seat — absent on every game that was not a duel */
  single?: [CardName, CardName];
  concession?: Concession;
}

export interface CardStanding {
  card: CardName;
  rating: number;
  /** decided non-mirror duels — what the K-factor and the listing measure */
  games: number;
  wins: number;
  losses: number;
  /** duels against itself: played, and counted nowhere else */
  mirrors: number;
}

/** the two cards of a pair of single-card decks, seat order — null unless both
 * decks ARE single-card decks. Read by rooms.ts (singleCards) and
 * history.ts, so the room, the history row and the card ladder agree by
 * construction. */
export function singleCardsOf(decks: readonly (readonly CardName[] | null | undefined)[] | undefined): [CardName, CardName] | null {
  const a = decks?.[0], b = decks?.[1];
  if (!a || !b || !checkSingleDeck(a).ok || !checkSingleDeck(b).ok) return null;
  return [a[0]!, b[0]!];
}

/** A card is ranked once it has this many duels — the same bar as a player. */
export const CARD_RANKED_AFTER = PUBLIC_AFTER;

/** Is this game a result about two cards? (the mirror is handled by the fold) */
export function isDuelResult(g: DuelGame): g is DuelGame & { single: [CardName, CardName]; winner: Seat } {
  if (!g.single || !g.single[0] || !g.single[1]) return false;
  if (!g.finished || (g.winner !== 0 && g.winner !== 1)) return false;
  return concessionWeight(g) !== 'walkover';
}

export function foldCardLadder(history: readonly DuelGame[]): Map<CardName, CardStanding> {
  const table = new Map<CardName, CardStanding>();
  const standing = (card: CardName): CardStanding => {
    let s = table.get(card);
    if (!s) { s = { card, rating: START_RATING, games: 0, wins: 0, losses: 0, mirrors: 0 }; table.set(card, s); }
    return s;
  };
  for (const g of [...history].filter(isDuelResult).sort(ratingOrder)) {
    const [c0, c1] = g.single;
    if (c0 === c1) { standing(c0).mirrors++; continue; }
    const a = standing(c0), b = standing(c1);
    // both read before either is written — rating.ts's ⚠, for the same reason
    const ra = a.rating, rb = b.rating;
    const scale = concessionWeight(g) === 'early' ? EARLY_K_SCALE : 1;
    const aWon = g.winner === 0;
    a.rating = nextRating(ra, rb, aWon ? 1 : 0, kFactor(a.games) * scale);
    b.rating = nextRating(rb, ra, aWon ? 0 : 1, kFactor(b.games) * scale);
    a.games++; b.games++;
    if (aWon) { a.wins++; b.losses++; } else { b.wins++; a.losses++; }
  }
  return table;
}

/** The ladder as the page shows it: best first, ties broken by games then name. */
export function cardLadder(history: readonly DuelGame[]): CardStanding[] {
  return [...foldCardLadder(history).values()].sort((x, y) =>
    y.rating - x.rating || y.games - x.games || x.card.localeCompare(y.card));
}
