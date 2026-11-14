/* CUBE DRAFT EVENTS — every shared type (docs/25-cube-draft.md is the contract).
 *
 * The server's event record (`CubeEvent`), what one viewer is shown (`CubeView`), and the socket
 * messages. The UI imports this file TYPE-ONLY; nothing here may carry runtime code.
 *
 * Time is always epoch ms. The view carries absolute deadlines plus the server's `now`, and the client
 * counts down itself — the server never pushes per-second ticks.
 */

import type { Element } from '../engine/src/types.ts';

export type CubeSource =
  | { kind: 'elements'; elements: Element[] }
  /** with multiplicity, each name at most 2 copies (docs/25 §3) */
  | { kind: 'list'; names: string[] };

export type Tournament = 'swiss' | 'roundrobin' | 'exhibition';
export type CubeRules = 'casual' | 'competitive';

export interface CubeConfig {
  name: string;
  source: CubeSource;
  /** null = auto (3) */
  packs: number | null;
  /** null = auto: min(15, floor(pool / (seats × packs))) */
  packSize: number | null;
  minPlayers: number;
  maxPlayers: number;
  fillBots: boolean;
  /** null = the host starts it */
  startAt: number | null;
  tournament: Tournament;
  swissRounds: number;
  rules: CubeRules;
  bestOf: 1 | 3;
}

export type CubePhase = 'lobby' | 'drafting' | 'building' | 'playing' | 'done' | 'cancelled';

/** a person in the event (bots are never Players — they live only in the draft) */
export interface CubePlayer {
  user: string;            // account id
  name: string;            // display name at join
  joinedAt: number;
  dropped?: boolean;
  /** the drafted cards (names, with multiplicity), set when the draft ends */
  pool?: string[];
  /** the last submitted deck */
  deck?: { main: string[]; side: string[]; at: number };
  /** exhibition: willing to be paired now */
  ready?: boolean;
  readySince?: number;
}

// ── the draft ────────────────────────────────────────────────────────────────

export interface DraftSeat {
  /** account id, or null for a bot */
  user: string | null;
  name: string;            // a bot's name: "Bot 1"…
  picks: string[];
  /** FIFO; queue[0] is the current pack. A pack is a list of card names. */
  queue: string[][];
  /** when queue[0] became current (its clock started) */
  since: number | null;
  reserved: string | null;
}

export interface DraftState {
  seed: number;
  packs: number;           // pack rounds
  packSize: number;
  round: number;           // 0-based pack round
  /** the round's pick number for the seat with the fewest picks… informational; see seats */
  seats: DraftSeat[];      // in table order (seat i passes left to i+1)
  /** packs dealt but not opened yet: unopened[round][seat] */
  unopened: string[][][];
  msPerCard: number;
  done: boolean;
}

// ── the tournament ───────────────────────────────────────────────────────────

export type PairingOutcome =
  | { kind: 'win'; winner: string; games?: [number, number] }   // games = [a's, b's]
  | { kind: 'draw'; games?: [number, number] }
  | { kind: 'bye' };

export interface Pairing {
  id: string;              // stable within the event, e.g. "r2p3" / "x14"
  round: number;           // 1-based; exhibition and round robin also number them (rr: schedule round)
  a: string;               // user id
  b: string | null;        // null = bye
  posted: boolean;
  /** the live match, once someone pressed Play */
  match?: { id: string; room: string | null };
  result?: PairingOutcome & { at: number; by: 'play' | 'host' | 'drop' };
}

export interface StandingRow {
  user: string;
  name: string;
  rank: number;
  points: number;
  w: number; l: number; d: number;
  omw: number; gw: number; ogw: number;
  dropped: boolean;
}

// ── the record ───────────────────────────────────────────────────────────────

export interface CubeEvent {
  code: string;
  host: string;            // account id
  createdAt: number;
  config: CubeConfig;
  phase: CubePhase;
  players: CubePlayer[];
  /** the resolved pool at creation (names, with multiplicity) */
  pool: string[];
  draft?: DraftState;
  pairings: Pairing[];
  /** the current Swiss round (0 before round 1) */
  round: number;
  /** a computed-but-unposted round waits here during the break */
  breakUntil?: number | null;
  startedAt?: number;
  endedAt?: number;
  /** append-only log of host edits, for the record */
  edits: { at: number; what: string }[];
  /** the event's seed (the draft's, and every pairing's) — set at creation */
  seed?: number;
  /** the bell's lines for this event's players (cube-store.ts notes) */
  notes?: CubeNoteRow[];
}

// ── the bell ─────────────────────────────────────────────────────────────────

/** 'starting' the draft is starting · 'round' a round was posted (your opponent, or a bye) ·
 *  'match' exhibition found you an opponent · 'done' the event is over */
export type CubeNoteKind = 'starting' | 'round' | 'match' | 'done';

/** one stored note, in the event's file */
export interface CubeNoteRow {
  n: number;               // per event, increasing
  to: string;              // account id
  kind: CubeNoteKind;
  at: number;
  readAt?: number;
  round?: number;
  /** the opponent's name; null = a bye */
  opponent?: string | null;
}

/** what /api/inbox sends under `cube` (newest first) */
export interface CubeNote {
  id: string;              // "<CODE>:<n>"
  event: string;           // the event code
  eventName: string;
  kind: CubeNoteKind;
  at: number;
  read: boolean;
  round?: number;
  opponent?: string | null;
}

/** GET /api/cube/mine — one row per event I host or play in (not cancelled, not long done) */
export interface CubeMine {
  code: string;
  name: string;
  phase: CubePhase;
  isHost: boolean;
  players: number;
  maxPlayers: number;
  startAt: number | null;
  /** my current match, if any (playing) */
  myMatch: CubeMatchView | null;
}

// ── what one viewer sees ─────────────────────────────────────────────────────

export interface CubeSeatView {
  name: string;
  bot: boolean;
  /** packs waiting at this seat (incl. the current one) */
  waiting: number;
  picks: number;
  me: boolean;
}

export interface CubeDraftView {
  packNo: number;          // 1-based
  pickNo: number;          // 1-based, my next pick in this pack round
  packs: number;
  packSize: number;
  direction: 'left' | 'right';
  seats: CubeSeatView[];
  /** my current pack, or null while I wait for one */
  pack: string[] | null;
  /** when my current pack's clock runs out */
  deadline: number | null;
  reserved: string | null;
  /** the card the client highlights at ≤10 s and the server takes on timeout */
  suggest: string | null;
  picks: string[];
}

export interface CubeMatchView {
  pairing: string;
  round: number;
  a: { user: string; name: string };
  b: { user: string; name: string } | null;
  status: 'waiting' | 'live' | 'done';
  /** the live room, for Watch / rejoin */
  room: string | null;
  /** "2–1", "Bye", "Draw" */
  score: string | null;
  winner: string | null;
}

export interface CubeView {
  now: number;
  code: string;
  config: CubeConfig;
  phase: CubePhase;
  host: { user: string; name: string };
  isHost: boolean;
  me: string | null;       // my user id; null = signed out / not joined
  joined: boolean;
  players: { user: string; name: string; dropped: boolean; submitted: boolean; ready: boolean; inMatch: boolean }[];
  /** pool size and the pack math for the current count and for a full table */
  poolSize: number;
  packMath: { seats: number; packs: number; packSize: number; ok: boolean }[];
  draft: CubeDraftView | null;
  /** building+: my drafted cards and my submitted deck */
  myPool: string[] | null;
  myDeck: { main: string[]; side: string[] } | null;
  round: number;
  breakUntil: number | null;
  /** host only: the computed next round during the break */
  pending: CubeMatchView[] | null;
  matches: CubeMatchView[];
  standings: StandingRow[];
  /** my current or next match, if any */
  myMatch: CubeMatchView | null;
  error?: string;
}

// ── the socket ───────────────────────────────────────────────────────────────

export type CubeClientMsg =
  | { t: 'cube'; op: 'sub'; code: string; token: string | null }
  | { t: 'cube'; op: 'unsub' }
  | { t: 'cube'; op: 'reserve'; card: string }
  | { t: 'cube'; op: 'pick'; card: string };

export type CubeServerMsg =
  | { t: 'cube'; view: CubeView }
  | { t: 'cube'; error: string }
  /** a pairing including me was posted / exhibition found me an opponent */
  | { t: 'cube'; matched: CubeMatchView };
