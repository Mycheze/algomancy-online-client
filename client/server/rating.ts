/* BL-02 — Elo ratings.
 *
 * The whole of the arithmetic, and no I/O. accounts.ts calls foldRatings()
 * from rebuildProfiles(); nothing else in here knows the store exists.
 *
 * ── THREE THINGS THAT ARE NOT ARBITRARY ──────────────────────────────
 *
 * (1) RATED IS NOT THE SAME AS RECORDED. Every finished game reaches the stats
 *     fold; only a game the MATCHMAKER made reaches this one. Two friends
 *     trading a room code can already run each other's win count up, and that
 *     is harmless while it only moves a stat sheet — it is not harmless once
 *     it moves a public ladder. `RecordedGame.rated` is the flag, stamped by
 *     the room, and a row without it is unrated (which is every game played
 *     before the queue existed).
 *
 * (2) THIS CANNOT BE A `foldSeat` COUNTER, and that is why it is its own
 *     module rather than eight more lines in accounts.ts. Every other stat in
 *     this codebase is addition on ONE account — `foldSeat(profile, game,
 *     seat)` never looks at the opponent. Elo is pairwise: what a win is worth
 *     depends on the other player's rating AT THAT MOMENT, so the two seats
 *     have to be updated together, in game order, in one pass. Splitting it
 *     per-seat would need each account's fold to see the other's partial
 *     result, which is exactly the "derived state to keep in sync" the Profile
 *     comment rules out.
 *
 * (3) THE ORDER IS THE ANSWER. Elo is path-dependent — the same games folded
 *     in a different order give different numbers — so the sort here has to be
 *     TOTAL, not merely "by date". Two games can share a `playedAt` (the
 *     seeder stamps fixtures in a loop, and a fast rematch can land in the same
 *     millisecond), and `Array.prototype.sort` is only stable with respect to
 *     the order it was handed, which for `store.history` is insertion order and
 *     therefore not reproducible after a re-import. `code` breaks the tie, so
 *     the fold is a pure function of the SET of games and BL-02's "re-running
 *     the seed reproduces the exact same ratings" is a property rather than a
 *     hope.
 */
import type { GameMode, Seat } from '../engine/src/types.ts';
// R290: a conceded game weighs by the turn it was conceded on. The amounts
// and thresholds are named in concession.ts and nowhere else.
import {
  concessionWeight, EARLY_K_SCALE, WALKOVER_PENALTY, type Concession,
} from './concession.ts';

/**
 * The formats that carry a rating.
 *
 * ⚠ NOT `GameMode`. `shared` is the quick shared-pool deal — link-only, never
 * offered by the queue, never rated — and saying so in the type means a
 * `shared` game cannot reach a rating table through a branch somebody forgot
 * to write. The one narrowing function below is the only door.
 */
export type RatedMode = 'constructed' | 'draft';

export const RATED_MODES: readonly RatedMode[] = ['constructed', 'draft'];

/** Narrow a GameMode, or refuse. The only way into a rating table. */
export const ratedMode = (mode: GameMode): RatedMode | null =>
  mode === 'constructed' || mode === 'draft' ? mode : null;

/** Everybody starts here. Owner, 2026-08-25: "standard is to start with 1000". */
export const START_RATING = 1000;

/**
 * Rated games before a player is listed on the PUBLIC leaderboard. Owner,
 * 2026-08-25: *"Someone can always see where they are on the leaderboard, but
 * don't appear publically until 5 rated games are finished."* — so this gates
 * the LISTING and nothing else. The rating itself exists and moves from game 1.
 */
export const PUBLIC_AFTER = 5;

/** K while a player is still provisional, and after. */
export const K_PROVISIONAL = 40;
export const K_SETTLED = 20;

/**
 * How much one game can move you.
 *
 * The step is at `PUBLIC_AFTER` deliberately and not by coincidence: a new
 * player's rating should find its level while nobody is looking at it, and go
 * public on the same game it stops swinging. One number, two jobs, no second
 * threshold to keep in step with the first.
 */
export const kFactor = (ratedGames: number): number =>
  ratedGames < PUBLIC_AFTER ? K_PROVISIONAL : K_SETTLED;

/** The logistic expectation: P(a beats b). */
export const expectedScore = (a: number, b: number): number =>
  1 / (1 + 10 ** ((b - a) / 400));

/**
 * One player's new rating. Rounded to a whole number because a rating is a
 * thing people read out loud, and because storing the fraction would make the
 * fold's reproducibility depend on float printing.
 *
 * ⚠ Rounding is applied per player per game, so a pair's ratings are NOT
 * exactly zero-sum on any single game (1 point can appear or vanish). That is
 * the ordinary Elo compromise and it is deliberate; the alternative is
 * carrying fractions nobody can read.
 */
export const nextRating = (mine: number, theirs: number, score: 0 | 0.5 | 1, k: number): number =>
  Math.round(mine + k * (score - expectedScore(mine, theirs)));

/** Where a player stands in one format. */
export interface RatingStanding {
  rating: number;
  /** rated games folded in — what `PUBLIC_AFTER` is measured against */
  games: number;
}

/** userId → format → standing. Only accounts with a rated game appear. */
export type RatingTable = Map<string, Record<RatedMode, RatingStanding>>;

export const emptyStanding = (): Record<RatedMode, RatingStanding> => ({
  constructed: { rating: START_RATING, games: 0 },
  draft: { rating: START_RATING, games: 0 },
});

/** The subset of a history row this fold reads. Structural on purpose: the
 * tests build rows by hand and must not have to fake a whole RecordedGame. */
export interface RatableGame {
  code: string;
  playedAt: string;
  mode: GameMode;
  finished: boolean;
  winner: Seat | null;
  users: [string | null, string | null];
  /** stamped by the room: this game was made by the matchmaker */
  rated?: boolean;
  /** R290: stamped by the room when a concede decided it — who, which turn */
  concession?: Concession;
  /** BL-43: played with custom rules — never rated */
  custom?: unknown;
}

/**
 * Is this game allowed to move anybody's rating?
 *
 * Every clause is one of BL-02's `doneWhen` lines, and they are all here
 * rather than spread over the caller so that "what counts" is one readable
 * predicate somebody can argue with.
 */
export function isRated(game: RatableGame): boolean {
  // (a) only the matchmaker's games — see (1) at the top of the file
  if (!game.rated) return false;
  // BL-43: nor a custom-rules game. The queue cannot make one; this is the
  // belt to that brace, so a hand-edited file cannot move a rating either.
  if (game.custom) return false;
  // (b) the format must be one that has a rating at all
  if (ratedMode(game.mode) === null) return false;
  // (c) "a game both seats abandoned moves nobody's rating". A game with no
  //     stamped winner and a diverged replay lands here too: `finished` is
  //     false for it, which is the same refusal, and deliberately so — an
  //     unknown result is not a draw and is not a loss.
  if (!game.finished || game.winner === null) return false;
  // (d) both seats must be somebody. An account cannot gain rating off a
  //     stranger the server cannot name.
  if (!game.users[0] || !game.users[1]) return false;
  // (e) and they must be two DIFFERENT somebodies (one account on both seats
  //     is a self-match; it would be a no-op with rounding, but silently)
  return game.users[0] !== game.users[1];
}

/**
 * The total order the fold runs in. See (3) at the top of the file: `playedAt`
 * alone is not a total order and Elo is path-dependent, so the code breaks
 * every tie and the result stops depending on insertion order.
 */
export const ratingOrder = (a: RatableGame, b: RatableGame): number =>
  a.playedAt.localeCompare(b.playedAt) || a.code.localeCompare(b.code);

/**
 * Fold a whole history into a rating table.
 *
 * Pure: same games in, same numbers out, in any input order. That is BL-02's
 * "re-running the seed/rebuild reproduces the exact same ratings — no drift",
 * and it is why nothing here is incremental.
 */
export function foldRatings(history: readonly RatableGame[]): RatingTable {
  const table: RatingTable = new Map();
  const standing = (userId: string): Record<RatedMode, RatingStanding> => {
    let s = table.get(userId);
    if (!s) { s = emptyStanding(); table.set(userId, s); }
    return s;
  };

  for (const game of [...history].filter(isRated).sort(ratingOrder)) {
    const mode = ratedMode(game.mode)!;
    const ids = game.users as [string, string];
    const a = standing(ids[0])[mode];
    const b = standing(ids[1])[mode];
    // ⚠ BOTH ratings are read BEFORE either is written. Updating seat 0 first
    // and then using its NEW rating to score seat 1 is the classic way to get
    // an Elo fold subtly wrong: the pair would no longer be symmetric, and
    // swapping which seat a player sat in would change the result.
    const ra = a.rating, rb = b.rating;
    const weight = concessionWeight(game);
    if (weight === 'walkover') {
      // R290 — A WALKOVER: conceded on turn 1. The owner: "The conceder
      // should take a few ELO points away, but the winner doesn't get
      // anything. They didn't do anything either."
      //
      // ⚠ DELIBERATELY NOT ZERO-SUM, and not Elo at all: a flat penalty on
      // the conceder, nothing to the winner, no expectation read. Elo's
      // exchange prices a RESULT between two players, and the owner's call
      // is that a walkover is not a result — it is a small tax on wasting
      // somebody's queue time. Points leave the pool; that is the point.
      //
      // Nor does it count as a rated game (`games` is left alone): the
      // provisional K and the PUBLIC_AFTER listing both measure games that
      // said something about the player, and this one said nothing about
      // either of them. Five walkovers must not make somebody "settled".
      const conceder = game.concession!.seat === 0 ? a : b;
      conceder.rating -= WALKOVER_PENALTY;
      continue;
    }
    // R290 — an EARLY concession (turn 2) is a game, at reduced weight:
    // "doesn't affect ELO as much as a 'full' game". The same exchange,
    // with K scaled, so it stays symmetric and stays a result. It DOES count
    // toward `games`: it is a decided game in the record.
    const scale = weight === 'early' ? EARLY_K_SCALE : 1;
    const ka = kFactor(a.games) * scale, kb = kFactor(b.games) * scale;
    const aWon = game.winner === 0;
    a.rating = nextRating(ra, rb, aWon ? 1 : 0, ka);
    b.rating = nextRating(rb, ra, aWon ? 0 : 1, kb);
    a.games++;
    b.games++;
  }
  return table;
}

/** A player's standing, for somebody who has never played a rated game. */
export const standingFor = (table: RatingTable, userId: string): Record<RatedMode, RatingStanding> =>
  table.get(userId) ?? emptyStanding();
