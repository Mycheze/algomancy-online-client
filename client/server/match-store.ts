/* Competitive Constructed — THE MATCH STORE (docs/22 §2.2).
 *
 * A match is one Bo1 or Bo3. Every game of it is an ordinary room with its own
 * code, seed, log and file (rooms.ts); this record ties them together and holds
 * everything that lasts BETWEEN games: what each seat registered, the
 * configuration each will play next, the score, the chess clocks, the pause.
 *
 * One file per match under `matchesDir()` (statepaths.ts — paths are named
 * once), written temp + rename like a room file. Read once at boot into a map;
 * every change is written through `saveMatch`. ONE WRITER PER FIELD: this store
 * and server/match.ts write the match, rooms.ts writes the room. Nothing here
 * knows a room exists, so the two stores can only meet in match.ts.
 *
 * Mutable runtime state (var/), never committed.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { CardName, Seat } from '../engine/src/types.ts';
import type { MatchConfig } from '../engine/src/matchdeck.ts';
import type { DeckPile } from './collection.ts';
import type { RoomLeague } from './rooms.ts';
import { matchesDir } from './statepaths.ts';

/** what a seat brought to game 1: the pool every later configuration must be
 * a rearrangement of (CR 901.9c), and the saved deck it came from. (A match
 * file written before 2026-11-03 may also carry that deck's swap `presets`;
 * nothing reads them any more.) */
export interface Registered extends MatchConfig {
  deckId: string | null;
  /** the saved deck's tabletop piles at registration (BL-55) — how its owner
   * laid the main deck out; absent for a deck never arranged, one sent off
   * the wire, and every match file written before 2026-11-11 */
  piles?: DeckPile[];
}

export interface MatchGame {
  /** the game's room code */
  code: string;
  initiative: Seat;
  winner: Seat | null;
  /** 'played' a real win · 'conceded' a concede (game or match) · 'time' a
   *  flag · 'closed' the room closed with no result */
  how: 'played' | 'conceded' | 'time' | 'closed';
  at: number;
}

export type MatchPhase = 'game' | 'between' | 'paused' | 'over' | 'void';

export interface MatchBetween {
  /** the waiting room of the next game (docs/22 §2.4) */
  code: string;
  /** the previous game's loser — makes the initiative choice (§8 answer 1) */
  chooser: Seat;
  /** the seat the chooser chose to take the initiative, once chosen */
  initiative: Seat | null;
  ready: [boolean, boolean];
  /** epoch ms the sideboarding window locks; null until both seats are in the
   *  room for the first time, and while paused */
  until: number | null;
  /** the window has locked: configurations are final, and the deal waits only
   *  on the chooser's initiative choice (untimed — §8 answer 1) */
  locked: boolean;
}

export interface Match {
  /** 'M' + 10 base32 characters — never a room code (docs/22 §2.1) */
  id: string;
  bestOf: 1 | 3;
  users: [string | null, string | null];
  names: [string, string];
  createdAt: number;
  endedAt?: number;
  registered: [Registered | null, Registered | null];
  /** the configuration each seat plays next — always a LEGAL one: an illegal
   *  submission is refused and this keeps the last legal one (§5.4) */
  current: [MatchConfig | null, MatchConfig | null];
  games: MatchGame[];
  /** chess-clock ms left per seat, written at each game's end */
  banks: [number, number];
  /** the bank the match started with (the display's "of 45:00"); null when
   *  the creator chose no clock (2026-11-03) — every game of it is clockless */
  clockStart: number | null;
  phase: MatchPhase;
  /** the room of the game being played (phase 'game') */
  room: string;
  between?: MatchBetween;
  /** offered while between; once accepted, when it was paused and who has
   *  asked to resume */
  pause?: { offeredBy: Seat | null; pausedAt: number | null; resume: [boolean, boolean] };
  /** a match concede taken IN a game, waiting for that game's end to be
   *  recorded (match.ts concedeMatch) */
  concedeBy?: Seat;
  result?: { winner: Seat; how: 'games' | 'conceded' | 'time'; at: number; concededBy?: Seat };
  /** why it was voided, when it was */
  voided?: { at: number; why: string };
  league?: RoomLeague;
  rated?: true;
  /** report #356 (owner, 2026-11-08): Best of is apart from the rules set, so
   *  a match may be CASUAL — its games played with both players' resource,
   *  haste and deploy steps at once (the house rule, Annex D1.5), the match's
   *  sideboarding, clock and initiative choice unchanged. Absent on every
   *  Competitive match and on every file written before it. */
  casual?: true;
}

const matches = new Map<string, Match>();
/** where the files go: set by loadMatches, else the env's at FIRST USE — never
 * read at import, because accounts.ts and history.ts import this store (the
 * match rows of the rating fold, the history's match tag) and a test that
 * imports them before pointing ALGO_MATCHES_DIR at a scratch directory must
 * not have its matches written into the real var/ */
let dirSet: string | null = null;
const dirNow = (): string => dirSet ?? matchesDir();

/** Load every saved match. Idempotent; a file that does not parse is skipped
 * with a line (a match is never worth a crash at boot). */
export function loadMatches(from = matchesDir()): void {
  dirSet = from;
  const dir = from;
  matches.clear();
  let files: string[];
  try { files = readdirSync(dir).filter(f => f.endsWith('.json')); } catch { return; }
  for (const f of files) {
    try {
      const m = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Match;
      if (typeof m.id === 'string' && Array.isArray(m.games) && Array.isArray(m.banks)) matches.set(m.id, m);
    } catch (err) {
      console.error(`[match] could not load ${f}:`, err instanceof Error ? err.message : err);
    }
  }
}

export function saveMatch(m: Match): void {
  matches.set(m.id, m);
  try {
    const dir = dirNow();
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${m.id}.json`);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(m));
    renameSync(tmp, path);
  } catch (err) {
    console.error(`[match] could not persist ${m.id}:`, err);
  }
}

export const getMatch = (id: string | undefined | null): Match | undefined => (id ? matches.get(id) : undefined);
export const allMatches = (): Match[] => [...matches.values()];

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newMatchId(): string {
  for (;;) {
    const b = randomBytes(10);
    let id = 'M';
    for (let i = 0; i < 10; i++) id += B32[b[i]! & 31];
    if (!matches.has(id) && !existsSync(join(dirNow(), `${id}.json`))) return id;
  }
}

/** A saved room's `match` link ({id, game}), or null if it is not one —
 * rooms.ts restores `Room.match` with it and history.ts tags a recorded game
 * with it (here, not in rooms.ts, so the history can read a link without
 * loading the rooms module). */
export function sanitizeMatchLink(raw: unknown): { id: string; game: number } | null {
  const r = raw as { id?: unknown; game?: unknown } | null;
  return r && typeof r.id === 'string' && /^M[A-Z0-9]{4,16}$/.test(r.id)
    && typeof r.game === 'number' && Number.isInteger(r.game) && r.game >= 1 && r.game <= 3
    ? { id: r.id, game: r.game } : null;
}

/** is it still being played (or waiting to be)? */
export const matchOpen = (m: Match): boolean => m.phase !== 'over' && m.phase !== 'void';

/** game wins per seat */
export function matchScore(m: Pick<Match, 'games'>): [number, number] {
  const s: [number, number] = [0, 0];
  for (const g of m.games) if (g.winner === 0 || g.winner === 1) s[g.winner]++;
  return s;
}

/** the configuration as a fresh pair of arrays */
export const copyConfig = (c: MatchConfig): MatchConfig => ({ main: [...c.main] as CardName[], side: [...c.side] as CardName[] });
