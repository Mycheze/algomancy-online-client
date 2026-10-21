/* BL-48 — DISPUTE A FINISHED GAME, from the post-game screen.
 *
 * Report #231 (ZKKX, a rated league game): the loser wanted to be able to
 * "concede the win to the opponent after a match — for instance, if you ended
 * up winning due to a bug." The owner, 2026-10-21: "Maybe just a 'dispute
 * game' button right on the final screen, by 'rematch'".
 *
 * Filing one does four things and changes nothing else:
 *   1. records it on the room, which saves it with the game (rooms.ts)
 *   2. tags the game in the match history (accounts.ts, history.ts)
 *   3. for a league match, flags it for the organizer (league-store.ts),
 *      whose result override already exists
 *   4. files a report row into the ordinary report journal, like any report
 * The result, ratings and stats stand. Changing them is a person's decision.
 *
 * Lifted out of main.ts so the whole of it can be driven in-process (520).
 */
import { appendFile } from 'node:fs/promises';
import type { Seat } from '../engine/src/types.ts';
import { accountById, markGameDisputed } from './accounts.ts';
import { flagDispute } from './league-store.ts';
import { reportedBy, reporterLabel, type IssueRow } from './report-fields.ts';
import { decidedWinner, disputedSeats, recordDispute, type Room } from './rooms.ts';
import { issuesFile } from './statepaths.ts';

export type DisputeResult =
  | { ok: true; disputed: [boolean, boolean]; row: IssueRow }
  | { ok: false; error: string };

/** `seat` null: the asker holds no seat in this room (a spectator). */
export async function fileDispute(room: Room, seat: Seat | null, note: unknown, now = Date.now()): Promise<DisputeResult> {
  const text = typeof note === 'string' ? note : '';
  const d = recordDispute(room, seat, text, now);
  if (typeof d === 'string') return { ok: false, error: d };
  const s = d.seat;
  // 2: the tag, at once (the file carries it too, for the next sync)
  try { markGameDisputed(room.code, s); } catch (err) {
    console.error(`[dispute] could not tag ${room.code} in the history:`, err);
  }
  // 3: the league
  let league: string | undefined;
  const user = room.users[s];
  if (room.league && user) {
    try {
      if (flagDispute(room.league.match, user, room.code, d.note, now)) league = room.league.match;
    } catch (err) {
      console.error(`[dispute] could not flag ${room.code} for ${room.league.match}:`, err);
    }
  }
  // 4: the report row
  const row: IssueRow = {
    ts: new Date(now).toISOString(),
    room: room.code,
    seat: s,
    note: `[Dispute] ${d.note}`.slice(0, 4000),
    actionIndex: d.actionIndex,
    kind: 'bug',
    // the form's own words for it: "the outcome was wrong"
    severity: 'gamebreaking',
    by: reportedBy(accountById(user)),
    page: 'game',
    dispute: { winner: decidedWinner(room), ...(league ? { league } : {}) },
  };
  try {
    await appendFile(issuesFile(), JSON.stringify(row) + '\n');
    console.log(`[report] ${room.code} seat ${s} @action ${d.actionIndex} by ${reporterLabel(row.by)} [dispute${league ? ` ${league}` : ''}]: `
      + row.note.replace(/\s*\n\s*/g, ' ⏎ '));
  } catch (err) {
    console.error(`[dispute] could not file the report for ${room.code}:`, err);
  }
  return { ok: true, disputed: disputedSeats(room), row };
}
