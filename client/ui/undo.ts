/* Whether this client offers UNDO right now — and so whether a slip can be
 * taken back without the client's help.
 *
 * One answer, two readers in ui/main.ts:
 *   · the ↶ undo button on the rail, which shows only when this is true;
 *   · the "Yes, activate" bar (report #194, the owner: "During deployment (or
 *     any phase that allows undo), we should not ask for 'confirmation' when
 *     activating abilities. The 'Yes, activate' is supposed to just prevent
 *     people from accidentally activating abilities during combat, but doing
 *     it during Deployment doesn't make sense."). Where undo works the
 *     confirm is skipped; in battle, where nothing is undone, it still asks.
 *
 * The step test is the engine's own `hiddenSegment` — the key the server
 * segments undo by (server/rooms.ts) — so planning, haste and deployment all
 * count, and a step the server cannot undo never reads as one this can.
 *
 * ⚠ It does not mirror the server's undo lock after a reveal: the confirm
 * is about the activation in hand, which stays undoable until it shows
 * somebody a card, and that lock refuses the undo with its own message.
 */
import { hiddenSegment } from '../engine/src/apply.ts';
import type { GameState } from '../engine/src/types.ts';

/** a seat at the table (not a spectator, not a replay, not the `?demo` board),
 * inside a step the server undoes.
 *
 * Competitive Constructed (docs/22 §8 answer 2, CR D4.6) has no hidden steps —
 * `hiddenSegment` is null there — and undoes instead inside the acting seat's
 * own resource, haste or deploy step, until they press Done. What may be taken
 * back is the server's call (the engine's marks never leave it), so the answer
 * is the push's own `ccUndo`, never worked out here. */
export function undoAvailable(s: GameState, net: { readonly spectating: boolean; readonly ccUndo?: boolean } | null): boolean {
  if (!net || net.spectating) return false;
  if (s.sequential) return net.ccUndo === true;
  return hiddenSegment(s) !== null;
}
