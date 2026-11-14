/* Competitive Constructed in the LEAGUE, and a match's records (docs/22 §2.6, §6.2).
 *
 * A Competitive season's league match is a best-of-three CC MATCH (match.ts),
 * not a room. This module is the seam between the two stores, kept out of
 * main.ts so the tests can drive it in-process:
 *
 *   openLeagueMatch   Play: the league match's CC match — its CURRENT room
 *                     (game 1's registration room, the between-games room, or
 *                     the game being played), or a new match when it has none
 *                     still open. Rated from week 1, the same rule as every
 *                     league room (api-league.ts).
 *   matchEnded        match.ts's `ended` hook: a decided league match reports
 *                     ONCE, as a match (the per-game league branch in main.ts
 *                     recordFinishedGame is skipped for a match room), with
 *                     every game's code so a dispute from any of them is
 *                     accepted; and a decided rated match re-folds the ratings,
 *                     where it is ONE result (rating.ts matchRatingRow).
 *   week closed       match.ts's `setLeagueWeekClosed`: once the league match
 *                     carries a result (the week's close marks it unplayed),
 *                     the sweep voids a CC match that is between games or
 *                     paused — "league matches also close at the end of their
 *                     league week" (owner, 2026-11-02).
 */
import type { Seat } from '../engine/src/types.ts';
import { gameHistory, rebuildProfiles } from './accounts.ts';
import { leagueMatchDeadline, leagueMatchSettled, recordPlayed } from './league-store.ts';
import { getMatch, matchOpen, saveMatch, type Match } from './match-store.ts';
import { reserveMatchId, setLeagueWeekClosed, setLeagueWeekEnd, setMatchHooks, startMatch } from './match.ts';
import { MATCH_CLOCK_MS, createRoom, getRoom, type RoomLeague } from './rooms.ts';

export interface LeagueMatchRequest {
  /** what the league match remembers (LeagueMatch.room): its CC match id */
  existing: string | null;
  a: { userId: string; username: string };
  b: { userId: string; username: string };
  season: string; match: string; rated: boolean;
}

/**
 * The room a Competitive league match is played in now. `code` mints a fresh
 * room code (main.ts freshRoomCode, already reserved). Returns the room, its
 * two accounts, and the CC match id the league remembers.
 */
export function openLeagueMatch(req: LeagueMatchRequest, code: () => string, now = Date.now()):
  { code: string; users: [string | null, string | null]; match: string } {
  const cur = req.existing ? getMatch(req.existing) : undefined;
  if (cur && matchOpen(cur) && cur.league?.match === req.match) {
    // Play opens where the match STANDS: never game 1's room once it is played
    const room = getRoom(cur.room);
    if (room && !room.closed) return { code: room.code, users: [...room.users], match: cur.id };
  }
  // which of them takes seat 0 is a coin flip, as in the queue
  const [first, second] = Math.random() < 0.5 ? [req.a, req.b] : [req.b, req.a];
  const id = reserveMatchId();
  const league: RoomLeague = { season: req.season, match: req.match };
  const users: [string, string] = [first.userId, second.userId];
  const room = createRoom(code(), (Math.random() * 1e9) >>> 0, [first.username, second.username], 'constructed',
    undefined, undefined, undefined, MATCH_CLOCK_MS.constructed, undefined, false, {
      rules: { sequential: true }, match: { id, game: 1 }, users, league,
      ...(req.rated ? { rated: true } : {}),
    });
  const m = startMatch(room, id, 3, now);
  // both accounts known from the start: "Your matches" lists it for both, and
  // match.ts carries league + rated onto every later game's room
  m.users = [...users];
  m.league = { ...league };
  if (req.rated) m.rated = true;
  saveMatch(m);
  console.log(`[league] ${room.code}: match ${id} (Best of 3), ${first.username} vs ${second.username} for ${req.match}${req.rated ? ' (rated)' : ''}`);
  return { code: room.code, users: [...room.users], match: id };
}

/** did any game of this match take an agreed fix? (BL-46: a tag on the result) */
function anyFixed(codes: readonly string[]): boolean {
  const history = gameHistory();
  return codes.some(c => (getRoom(c)?.amendments.length ?? 0) > 0 || (history.find(g => g.code === c)?.amended ?? 0) > 0);
}

/** match.ts `ended`: the league report, once, and the rating fold */
export function matchEnded(m: Match, now = Date.now()): void {
  if (m.phase !== 'over' || !m.result) return;   // void: no result, nothing to report
  if (m.league) {
    const winner = m.users[m.result.winner as Seat];
    const codes = m.games.map(g => g.code);
    // a match conceded before game 1 was dealt was "played" in game 1's room
    if (!codes.length) codes.push(m.room);
    try {
      if (winner) recordPlayed(m.league.match, winner, codes.at(-1)!, now, { fixed: anyFixed(codes), codes });
    } catch (err) {
      console.error(`[league] could not record match ${m.id} for ${m.league.match}:`, err);
    }
  }
  // the one Elo result of a rated match (a game of it moves nobody's rating)
  if (m.rated) {
    try { rebuildProfiles(); } catch (err) { console.error(`[accounts] could not fold match ${m.id}:`, err); }
  }
}

/** a league CC match whose league match already has a result is closed by the
 * sweep when it is between games or paused */
export const leagueWeekClosed = (m: Match): boolean => !!m.league && leagueMatchSettled(m.league.match);

/** main.ts, once at boot (a test calls it too): W3's hooks keep theirs.
 *
 * ⚠ ONE `ended`. setMatchHooks keeps one function per key, so another module
 * setting its own `ended` would silently replace the league's. Whoever else
 * needs it (docs/25: the cube events, `cubeMatchEnded`) is passed in here and
 * called after the league, each in its own catch; each ignores a match that is
 * not its own. */
export function installLeagueMatchHooks(alsoEnded: ReadonlyArray<(m: Match) => void> = []): void {
  setMatchHooks({
    ended: m => {
      try { matchEnded(m); } catch (err) { console.error(`[league] ended hook failed for ${m.id}:`, err); }
      for (const f of alsoEnded) {
        try { f(m); } catch (err) { console.error(`[match] an ended hook failed for ${m.id}:`, err); }
      }
    },
  });
  setLeagueWeekClosed(leagueWeekClosed);
  setLeagueWeekEnd(m => m.league ? leagueMatchDeadline(m.league.match) : null);
}
