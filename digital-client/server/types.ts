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
}
