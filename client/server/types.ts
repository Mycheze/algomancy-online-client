/**
 * The shapes a saved game FILE has — the contract between the process that
 * writes `server/games/<code>.json` (`rooms.ts`) and everything that reads one
 * back (`rooms.ts`'s own restore, and `replay-room.ts`).
 *
 * WHY THIS FILE EXISTS (R181). `replay-room.ts` used to restate `Fork` and
 * `LostAction` structurally, with a comment explaining that it had to: its
 * canonical home is `rooms.ts`, but `rooms.ts` imports `ws` and pulls the whole
 * socket layer in behind it, and `engine/test/143` imports `replay-room.ts` —
 * so importing even a TYPE from `rooms.ts` dragged the server's socket layer
 * into the engine's typecheck (7 errors, and the reason nobody wanted to do
 * it). The restatement was honest but rot-prone: rename a field in `rooms.ts`
 * and the replay tool's fork block silently stops printing, which is the exact
 * failure mode "loud" was supposed to prevent.
 *
 * So the on-disk shapes live here instead. This module imports ONLY engine
 * types and declares no values — it can never pull `ws` in, so both sides can
 * name the same interface and a rename is a compile error in both.
 */
import type { Action, Seat } from '../engine/src/types.ts';

/** One logged action a rebuild could not apply FAITHFULLY — it was refused,
 *  or (R191) it was accepted and came to mean something else. */
export interface LostAction {
  /** index into the room's `actions` */
  i: number;
  type: Action['type'];
  seat: Seat;
  /** the engine's own refusal, or — for a 'changed' entry, which nothing
   *  refused — what moved under it */
  why: string;
  /**
   * WHICH failure this is, so the refusal a player reads names the real
   * reason instead of a guess (additive; absent in files written before it
   * existed).
   *
   *   'lost'     the action no longer replays at all — the rebuild refused it.
   *   'changed'  the action still replays and is still legal, but it now
   *              REFERS to something else (another unit, another card in hand,
   *              another roll). The dangerous one: nothing downstream would
   *              ever notice, which is exactly why it is measured.
   */
  kind?: 'lost' | 'changed';
}

/** A restore that could not faithfully rebuild a game still being played. */
export interface Fork {
  /** when the restore happened (ISO) */
  at: string;
  /** what the log claimed vs what could actually be replayed */
  logged: number;
  lost: LostAction[];
  /** where the rebuild landed — the board play resumed from */
  turn: number;
  phase: string;
  /**
   * R200: the engine that DID this rebuild — the one that refused the actions
   * in `lost`, and the one play then continued under.
   *
   * Restated here rather than living only in `VersionStamp` below, so a fork
   * record reads standalone: "these 15 actions stopped replaying, and here is
   * the commit that stopped replaying them" is one fact, and splitting it
   * across two arrays is how a reader ends up pairing the wrong halves.
   * `replay-room.ts` checks the two agree and says INCONSISTENT when they do
   * not, so the redundancy is guarded rather than merely duplicated.
   *
   * Additive/optional — every file written before R200 lacks it.
   */
  engineVersion?: string;
}

/**
 * R200 — one stretch of a game, and the engine it was recorded against.
 *
 * WHY A LIST AND NOT ONE FIELD. A forked file is not one game: the server
 * restarted onto a changed engine, rebuilt the room without the actions it
 * could no longer replay, and play CONTINUED from there. Game VEAV is two
 * games in one file recorded against two engines, so a single `engineVersion`
 * on the room would be a true statement about the first half and a false one
 * about the second — and `--as-recorded` would check out the wrong commit for
 * the tail, replay garbage against it, and report the result as a rules
 * change. One stamp per file is not enough, and the file that proves it is
 * already in the corpus.
 *
 * `from` is an index into `actions`: from there up to the next stamp's `from`
 * (or to the end of the log), this game was recorded under `sha`.
 * `versions[0].from` is always 0 — the stamp written when the room was made.
 */
export interface VersionStamp {
  /** when this stamp was written (ISO) */
  at: string;
  /** the engine's commit SHA, or 'unknown' when git could not be consulted */
  sha: string;
  /** index into `actions`: everything from here on was recorded under `sha` */
  from: number;
}
