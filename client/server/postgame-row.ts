/* CT-530 — THE POST-GAME SCREEN'S NUMBERS, WORKED OUT ONCE PER FINISHED GAME.
 *
 * The post-game payload (main.ts sendGameOver) is built from a summary of the
 * whole game, and a summary is a full replay (stats.ts summarizeGame): about
 * four seconds on a crowded board, on the event loop, with every other room on
 * the server waiting. main.ts used to replay a finished room again for every
 * rejoin or reload into it, and once per seat when the game could not be
 * recorded (a scenario room, or a record that threw).
 *
 * This keeps the row the screen was last built from, per room, and hands it
 * back while nothing it was summarized from has changed: the log (the array
 * and its length), the result, the concession, the agreed fixes and who sits
 * in each seat. Anything else changing does not change the summary. Held in a
 * WeakMap keyed on the live Room object, so it is never persisted, a restored
 * room starts empty (and pays one replay on its first rejoin), and a dropped
 * room takes its row with it.
 *
 * Lifted out of main.ts so it can be driven in-process (1154).
 */
import type { RecordedGame } from './accounts.ts';
import type { Room } from './rooms.ts';

type Summarized = Pick<Room, 'actions' | 'winner' | 'concession' | 'amendments' | 'users'>;

interface Kept { actions: Room['actions']; key: string; row: RecordedGame }
const KEPT = new WeakMap<Summarized, Kept>();

/** what the row was summarized from, besides the log array's identity */
function keyOf(room: Summarized): string {
  return JSON.stringify([room.actions.length, room.winner, room.concession ?? null, room.amendments.length, room.users]);
}

/** Remember `row` as the summary of `room` as it stands now (the live record's row). */
export function keepPostgameRow(room: Summarized, row: RecordedGame): void {
  KEPT.set(room, { actions: room.actions, key: keyOf(room), row });
}

/** The kept row while it still describes `room`; otherwise `summarize()`, kept. */
export function postgameRow(room: Summarized, summarize: () => RecordedGame): RecordedGame {
  const k = KEPT.get(room);
  if (k && k.actions === room.actions && k.key === keyOf(room)) return k.row;
  const row = summarize();
  keepPostgameRow(room, row);
  return row;
}
