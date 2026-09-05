/* R290 — how much a CONCEDED game weighs.
 *
 * The owner, 2026-09-05:
 *
 *   "Right now, an opponent conceding is like they lose. But if they concede
 *    with basically no actions taken (insta concede) it shouldn't really be a
 *    'game'. The conceder should take a few ELO points away, but the winner
 *    doesn't get anything. They didn't do anything either. And if there's a
 *    concession in the first 2 turns, that's also not really a full game, so
 *    it doesn't count toward achievements/stats for fast games and doesn't
 *    affect ELO as much as a 'full' game (going to turn 3 or longer and then
 *    conceding). But if someone concedes on turn 5 or whatever, the assumption
 *    is that they're dead and they just concede to save time. That should be
 *    treated fully normally."
 *
 * So a concession has a WEIGHT, and the weight is decided by ONE number: the
 * game turn the concede was taken on. Every threshold and every amount is a
 * named constant HERE and nowhere else, so the owner can move them without a
 * search — rating.ts, accounts.ts and the history views all import from this
 * file and none of them carries a literal.
 *
 * ── THE STAMP ───────────────────────────────────────────────────────
 *
 * `Concession` is stamped onto the room by rooms.ts the moment a `concede`
 * action decides the game (`{ seat, turn }` — who, and `state.turn` at that
 * moment), persisted with the room file, and copied onto the RecordedGame by
 * history.ts. It is never re-derived from a replay: the register's standing
 * law is that a result is stamped when it happens (Room.winner) and a profile
 * is a pure fold over stamped rows. A row WITHOUT the stamp — every game
 * played before 2026-09-05, and every game that did not end in a concession —
 * weighs `normal`, which is exactly how it always folded. Additive, optional.
 *
 * ── THE TIERS ───────────────────────────────────────────────────────
 *
 *   walkover   conceded on turn ≤ WALKOVER_MAX_TURN (1). Not a game. It counts
 *              toward NOTHING — not games/wins/losses/streaks, not a single
 *              stat, not an achievement, for EITHER player. Rating: the
 *              conceder loses WALKOVER_PENALTY, the winner gains nothing, and
 *              it is not a rated game for the provisional count. It still sits
 *              in each player's match history, labelled "not counted".
 *   early      conceded on turn ≤ EARLY_MAX_TURN (2). A decided game for the
 *              record — win, loss, streak, head-to-head all count — but rating
 *              moves at K × EARLY_K_SCALE, and the fast-game achievements and
 *              stats skip it (see accounts.ts foldSeat and history.ts
 *              matchLengths for the list).
 *   normal     conceded on turn ≥ EARLY_MAX_TURN + 1, or any game that did not
 *              end in a concession. Exactly as before.
 *
 * Only a RATED game (rating.ts isRated) moves a rating at all; the tiers sit
 * on top of that gate, never beside it.
 */
import type { Seat } from '../engine/src/types.ts';

/** Who conceded, and the game turn (`state.turn`) they conceded on. */
export interface Concession {
  seat: Seat;
  turn: number;
}

/** Concede on this turn or earlier and the game is a walkover: not a game. */
export const WALKOVER_MAX_TURN = 1;

/** Concede on this turn or earlier (and past the walkover line) and the game
 * counts, at reduced weight. Turn `EARLY_MAX_TURN + 1` onward is normal. */
export const EARLY_MAX_TURN = 2;

/**
 * What a walkover costs the conceder, in rating points, flat. The winner
 * gets nothing — see rating.ts for why that is deliberately not zero-sum.
 */
export const WALKOVER_PENALTY = 5;

/** The K multiplier for an early concession: "doesn't affect ELO as much". */
export const EARLY_K_SCALE = 0.5;

export type ConcessionWeight = 'walkover' | 'early' | 'normal';

/** The subset of a row this reads. Structural so a room, a history row and a
 * hand-built test fixture can all be asked without faking the rest. */
export interface ConcededGame {
  concession?: Concession | null;
}

/**
 * The one function that turns a stamp into a tier. Pure; a row with no stamp
 * is `normal`, which is the whole of backward compatibility.
 *
 * `turn <= WALKOVER_MAX_TURN` rather than `=== 1` on purpose: a concede in a
 * room whose game has not really started reads `state.turn` as 0, and that is
 * even less of a game than turn 1.
 */
export function concessionWeight(game: ConcededGame): ConcessionWeight {
  const c = game.concession;
  if (!c) return 'normal';
  if (c.turn <= WALKOVER_MAX_TURN) return 'walkover';
  if (c.turn <= EARLY_MAX_TURN) return 'early';
  return 'normal';
}

/** A stamp as it comes off a JSON file or the wire: keep it only if it is one. */
export function sanitizeConcession(raw: unknown): Concession | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { seat?: unknown; turn?: unknown };
  if (r.seat !== 0 && r.seat !== 1) return undefined;
  const turn = Number(r.turn);
  if (!Number.isFinite(turn) || turn < 0) return undefined;
  return { seat: r.seat, turn: Math.floor(turn) };
}
