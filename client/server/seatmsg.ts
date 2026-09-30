/* CT-179 — THE SERVER OWNS "A SEAT MESSAGE CARRIES A GAME OR A LOBBY".
 *
 * A `joined` or an `update` sent to a seat is one of exactly two things:
 *
 *   · a GAME — it carries `view`, the seat's redacted state, and the client
 *     paints a board from it;
 *   · a LOBBY — it carries `waiting`, the constructed/draft/single-card room
 *     before the deal, and the client paints the waiting room.
 *
 * Never both, never neither. The client used to assume this (`this.state =
 * m.view!` on a join, and an update's `noteCast(this.state, …)`), and it was
 * true only because every site that built one happened to spread `baseView`
 * or `waitingInfo` into it. Nothing on either side of the wire said so. This
 * is where it is said: every `joined` and `update` in server/main.ts is built
 * here, the type cannot express the bad shape, and a caller that gets round
 * the type (an `as`, a spread of something optional) is refused at runtime
 * rather than put on the wire. 356 holds both halves, and counts the literal
 * spellings in server/ so a new site that bypasses this is found.
 *
 * NOT covered, deliberately: `watching` (a spectator's payload — its own type,
 * and its client branch already asks `if (m.view)`), `building`, `me`,
 * `gameover`, `error`, `rematch` — none of them is read as a board.
 */
import type { GameState } from '../engine/src/types.ts';

/** a seat message's body: every other field is free, but exactly one of
 * `view` and `waiting` is present */
export type SeatBody =
  | { view: GameState; waiting?: never; [k: string]: unknown }
  | { waiting: object; view?: never; [k: string]: unknown };

export type SeatMsg = { t: 'joined' | 'update' } & SeatBody;

/** Build a `joined` or `update`. Throws on a body carrying both or neither of
 * `view` and `waiting` — a message the client cannot paint is a server bug,
 * and it is found here, by name, not on somebody's screen. */
export function seatMsg(t: 'joined' | 'update', body: SeatBody): SeatMsg {
  const hasView = body.view !== undefined && body.view !== null;
  const hasWaiting = body.waiting !== undefined && body.waiting !== null;
  if (hasView === hasWaiting) {
    throw new Error(`a '${t}' must carry exactly one of view and waiting; this one carries `
      + `${hasView ? 'both' : 'neither'} (CT-179)`);
  }
  return { t, ...body } as SeatMsg;
}
