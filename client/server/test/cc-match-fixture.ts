/* docs/22 — the shared fixture of the Competitive Constructed server tests
 * (814-823). Not a test: it points rooms.ts and match-store.ts at throwaway
 * directories BEFORE they are loaded (both read their path at import), then
 * hands back the modules and a way to start a match exactly as main.ts's
 * creating join does — joinableRoom with the `cc` stamp, startMatch, and the
 * two registrations — without a socket.
 *
 * Decks: two disjoint 30-card mains and two disjoint 3-card sideboards off the
 * scripted pool, so a test can tell every card's owner by its name.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CardName, Seat } from '../../engine/src/types.ts';
import type { Room } from '../rooms.ts';
import type { Match, Registered } from '../match-store.ts';

export async function ccFixture(tag: string) {
  const DIR = mkdtempSync(join(tmpdir(), `algo-${tag}-`));
  process.env['ALGO_GAMES_DIR'] = join(DIR, 'games');
  process.env['ALGO_MATCHES_DIR'] = join(DIR, 'matches');
  const R = await import('../rooms.ts');
  const S = await import('../match-store.ts');
  const M = await import('../match.ts');
  const { DECK_LIST } = await import('../../engine/src/cards/registry.ts');
  const pool = DECK_LIST as CardName[];
  const twice = (names: CardName[]): CardName[] => names.flatMap(n => [n, n]);
  /** seat s's registration: a 30-card main (15 × 2) and a 3-card side */
  const REG: [Registered, Registered] = [
    { main: twice(pool.slice(0, 15)), side: pool.slice(30, 33), deckId: null },
    { main: twice(pool.slice(15, 30)), side: pool.slice(33, 36), deckId: null },
  ];
  let n = 0;
  const codes: string[] = [];
  M.setMatchHooks({ code: () => { const c = `${tag.toUpperCase().slice(0, 3)}${(++n).toString(36).toUpperCase()}`; codes.push(c); return c; } });

  /** a match as main.ts's creating join builds it, both seats registered and game 1 dealt */
  function start(bestOf: 1 | 3, users: [string, string] = ['u-ann', 'u-bo'], regs: [Registered, Registered] = REG): { room: Room; m: Match } {
    const id = M.reserveMatchId();
    const code = `${tag.toUpperCase().slice(0, 3)}G${(++n).toString(36).toUpperCase()}`;
    R.reserveRoomCode(code);
    const room = R.joinableRoom(code, 'constructed', undefined, regs[0].main, R.MATCH_CLOCK_MS.constructed, false,
      { rules: { sequential: true }, match: { id, game: 1 } })!;
    const m = M.startMatch(room, id, bestOf);
    for (const s of [0, 1] as Seat[]) R.setSeatUser(room, s as 0 | 1, users[s]!);
    M.registerSeat(room, 0, users[0], 'Ann', regs[0]);
    const r = M.registerSeat(room, 1, users[1], 'Bo', regs[1]);
    if (!r.ok || !r.dealt) throw new Error('fixture: game 1 did not deal');
    return { room, m };
  }
  /** a pretend socket per seat (rooms.ts only asks whether one is there) */
  const seatUp = (room: Room, ...seats: Seat[]): void => {
    for (const s of seats) room.sockets[s] = {} as Room['sockets'][number];
  };
  /** `seat` concedes the game in `room` and the server records it */
  const concede = (room: Room, seat: Seat): Match | undefined => {
    R.applyToRoom(room, { type: 'concede', seat });
    return M.matchGameDecided(room);
  };
  /** the match's current room */
  const current = (m: Match): Room => R.getRoom(m.room)!;
  return { DIR, R, S, M, REG, pool, start, seatUp, concede, current, codes };
}
