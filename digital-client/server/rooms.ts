/* In-memory room store + JSON persistence.
 *
 * A room is one game: an authoritative GameState, the seed + action log (the
 * whole game — docs/04 §1), the full event history (for redacted log resync),
 * and up to two connected sockets (seat 0 and seat 1).
 *
 * Persistence is a plain JSON file per room under server/games/<code>.json
 * holding { seed, names, actions }. On startup rooms are restored by replaying
 * the action log through the engine (replay = seed + actions).
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Action, CardName, Element, EngineEvent, GameMode, GameState, Seat } from '../engine/src/types.ts';
import { apply, checkDeck, createGame, legalActions, sanitizeTrio, IllegalAction } from '../engine/src/apply.ts';
import {
  resolveTrio, sanitizeMethod, sanitizeSubmission, submissionReady,
  type TrioHistoryRow, type TrioMethod, type TrioResult, type TrioSubmission,
} from './trio.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
// ALGO_GAMES_DIR lets a test run against a throwaway directory of saved rooms
const GAMES_DIR = process.env['ALGO_GAMES_DIR'] ?? join(HERE, 'games');

export interface Socket {
  send(data: string): void;
}

export interface Room {
  code: string;
  seed: number;
  mode: GameMode;
  /** draft mode: the chosen trio (sanitized); ignored in 'shared' */
  els: Element[];
  /** constructed mode: each seat's deck list (null = not brought yet). The
   * game does not really start until both are in — see roomWaiting(). */
  decks: [CardName[] | null, CardName[] | null];
  names: [string, string];
  /** ACCOUNT id per seat (null = whoever sat here was not logged in). Set on
   * join from the token, persisted with the room, and read back when the game
   * is folded into the players' stats — see history.ts. */
  users: [string | null, string | null];
  /**
   * Who won, RECORDED AT THE TIME and persisted — not re-derived.
   *
   * A saved game is replayed to restore it, and an old log replayed onto a
   * newer engine can diverge (R34 re-ordered simultaneous triggers; the log
   * then describes a board that no longer exists). When that happens the
   * replay stops short of the ending, and the game reads as if nobody won —
   * which is how three real wins turned into "five unfinished games". A fact
   * stamped when it happened cannot rot, so this is stickily kept: once set
   * it is never cleared by a replay that fails to reach it.
   */
  winner: Seat | null;
  state: GameState;
  actions: Action[];
  /** full authoritative event history, for per-seat redacted log resync */
  events: EngineEvent[];
  /** connected client per seat (null = nobody there) */
  sockets: [Socket | null, Socket | null];
  /** simultaneous deployment: the state as of deploy start — each seat's view
   * of the OPPONENT is served from this freeze until both are done */
  deploySnapshot: GameState | null;
  /** events each seat has NOT yet been shown (their opponent's hidden deploy
   * moves); flushed as the "replay" when deployment ends */
  heldDeploy: [EngineEvent[], EngineEvent[]];
  /** index into `actions` where the current deploy phase began (-1 outside
   * deploy) — undo may splice a seat's own actions at/after this point */
  deployStartIndex: number;
  /** chess clock (MTGO-style, display only): remaining ms per seat */
  clockMs: [number, number];
  /** Date.now() of the last clock settle — elapsed since then is still
   * unbilled and belongs to the seats in clockRun */
  clockStamp: number;
  /** which seats' clocks have been RUNNING since clockStamp */
  clockRun: [boolean, boolean];
  /**
   * The formation a seat is CURRENTLY BUILDING, before they commit it.
   *
   * Not a game action and never in `actions`: it is the digital stand-in for
   * watching someone physically slide units into columns across the table
   * (playtest ask, 2026-08-20 — "it'd be cool to see their thought process
   * and see where they're putting the units, live"). Purely presentational,
   * leaks nothing (the declaration becomes public a moment later anyway), and
   * dropped the instant any action lands, because the real declaration
   * supersedes it. Held on the room, not just relayed, so a reconnecting or
   * re-rendering client picks it up without waiting for the next twitch.
   */
  building: [Formation | null, Formation | null];
  /**
   * Draft mode: the room where the trio gets chosen, before there is a game.
   *
   * A draft room used to be dealt the instant its creator joined, which meant
   * one player picked the elements alone AND got to study pack 1 pick 1 for
   * however long the other took to click the link. Both go away if the cards
   * are not dealt until the trio is settled and both players are in — so a
   * draft room now starts here and only becomes a game when `result` is set.
   *
   * null for a room created with an explicit trio (`&els=`, hotseat, tests),
   * which still deals immediately.
   */
  lobby: Lobby | null;
  /** post-game: which seats have asked for a rematch. In memory only — a
   * rematch offer does not deserve to outlive the tab it was made in. */
  rematch: [boolean, boolean];
  /** the room a rematch moved to, so a straggler who clicks late (or
   * reconnects into the finished game) is still sent where their opponent
   * went rather than into a second, empty rematch */
  rematchRoom: string | null;
}

/** The pre-game room: choose a method, both submit, the server resolves. */
export interface Lobby {
  method: TrioMethod;
  /** a rematch's lobby knows what you just played, which is what makes
   * "run it back" a one-click option instead of a re-pick */
  previousTrio?: Element[];
  /** each seat's submission (empty until they put something in) */
  submissions: [TrioSubmission, TrioSubmission];
  /** each seat has locked their submission in */
  locked: [boolean, boolean];
  /** set once both are locked — from here the room is a real game */
  result: TrioResult | null;
}

/** an uncommitted attack/block declaration: columns of entity ids, plus the
 * counterattackers being set aside (round-1 blocks) */
export interface Formation { cols: number[][]; send: number[] }

/** Chess-clock starting bank per player. 40 minutes ran out mid-game in the
 * playtests — a draft game with real decisions wants an hour (Bena,
 * 2026-08-20). Persisted games keep whatever bank they were saved with. */
export const CLOCK_START_MS = 60 * 60 * 1000;

/** Which seats' clocks should run right now: the game is waiting on a seat
 * iff it has at least one legal action (covers pending decisions, priority,
 * draft picks, and the simultaneous planning/deploy done-flags — both clocks
 * may run at once during simultaneous phases, which is correct). Clocks only
 * run while BOTH players are connected (casual client: waiting alone for an
 * opponent, a dropped tab, or a room restored after a server restart must
 * not silently drain anybody), and a finished game stops both clocks. */
export function clockRunning(room: Room): [boolean, boolean] {
  if (roomWaiting(room)) return [false, false];
  if (room.state.winner !== null || room.state.phase === 'gameover') return [false, false];
  if (!room.sockets[0] || !room.sockets[1]) return [false, false];
  return [0, 1].map(s => legalActions(room.state, s as 0 | 1).length > 0) as [boolean, boolean];
}

/** Bill the time elapsed since the last settle to whichever seats were
 * running, clamp at zero (display only — no enforcement), and recompute the
 * running set from the current state + connections. Call after anything that
 * changes either (action applied, undo, join, leave). */
export function settleClock(room: Room): void {
  const now = Date.now();
  const dt = Math.max(0, now - room.clockStamp);
  for (const s of [0, 1] as const) {
    if (room.clockRun[s]) room.clockMs[s] = Math.max(0, room.clockMs[s] - dt);
  }
  room.clockStamp = now;
  room.clockRun = clockRunning(room);
}

/** The clock snapshot attached to every state broadcast: clients extrapolate
 * locally from `at` using `running` until the next message arrives. */
export function clockSnapshot(room: Room): { ms: [number, number]; running: [boolean, boolean]; at: number } {
  settleClock(room);
  return { ms: [...room.clockMs], running: [...room.clockRun], at: room.clockStamp };
}

const rooms = new Map<string, Room>();

/** Build a fresh game and its initial event list. */
function fresh(seed: number, names: [string, string], mode: GameMode, els: Element[], decks?: [CardName[], CardName[]]): { state: GameState; events: EngineEvent[] } {
  const r = createGame(seed, names, mode, els, decks);
  return { state: r.state, events: r.events };
}

/** A room that is not a game yet: its held state is a PLACEHOLDER (never
 * acted on — main.ts gates actions/undo on this) and the real one is dealt
 * once the missing piece arrives. Two kinds: a constructed room still waiting
 * for decks, and a draft room still choosing its trio. */
export function roomWaiting(room: Room): boolean {
  if (room.lobby && !room.lobby.result) return true;
  return room.mode === 'constructed' && (!room.decks[0] || !room.decks[1]);
}

/**
 * Is this game decided, and by whom?
 *
 * The live state first, then the stamp. They come apart for a game saved
 * before the winner stamp existed whose log no longer replays to its ending:
 * the replay stops short so `state.winner` is null, but we know perfectly
 * well who won. Anything asking "is this game over" wants this, not the raw
 * state — otherwise such a room reads as still playable.
 */
export const decidedWinner = (room: Room): Seat | null => room.state.winner ?? room.winner;

/** The draft lobby, while it is still open. */
export function roomLobby(room: Room): Lobby | null {
  return room.lobby && !room.lobby.result ? room.lobby : null;
}

const freshLobby = (method: TrioMethod = 'pick-one', previousTrio?: Element[]): Lobby => ({
  method, submissions: [{}, {}], locked: [false, false], result: null,
  // coming out of a game, "the same again" is the most likely answer, so it
  // is the one already selected
  ...(previousTrio ? { previousTrio: [...previousTrio], method: 'again' as TrioMethod } : {}),
});

/**
 * Change the method. Either player may, while the lobby is open, and it
 * clears both submissions — a ranking is not a pick, and silently carrying
 * one over into another method would submit something nobody chose.
 */
export function setLobbyMethod(room: Room, method: unknown): boolean {
  const lobby = roomLobby(room);
  if (!lobby) return false;
  const next = sanitizeMethod(method);
  if (next === lobby.method) return false;
  lobby.method = next;
  lobby.submissions = [{}, {}];
  lobby.locked = [false, false];
  persist(room);
  return true;
}

/** Record a seat's submission. `lock` marks them ready; the caller resolves. */
export function setLobbySubmission(room: Room, seat: 0 | 1, raw: unknown, lock: boolean): boolean {
  const lobby = roomLobby(room);
  if (!lobby) return false;
  const sub = sanitizeSubmission(raw, lobby.method);
  lobby.submissions[seat] = sub;
  lobby.locked[seat] = lock && submissionReady(sub, lobby.method);
  persist(room);
  return true;
}

/** Un-lock (the "change my mind" button), legal until the other side is in. */
export function unlockLobby(room: Room, seat: 0 | 1): boolean {
  const lobby = roomLobby(room);
  if (!lobby || !lobby.locked[seat]) return false;
  lobby.locked[seat] = false;
  persist(room);
  return true;
}

/**
 * Both seats are locked in: decide the trio and DEAL THE GAME. Returns the
 * result, or null if the lobby is not ready.
 *
 * The randomness is seeded off the room seed — reproducible, and not
 * something either player can influence by the timing of their click.
 */
export function resolveLobby(room: Room, history: TrioHistoryRow[]): TrioResult | null {
  const lobby = roomLobby(room);
  if (!lobby) return null;
  if (!lobby.locked[0] || !lobby.locked[1]) return null;
  const result = resolveTrio({
    method: lobby.method,
    submissions: lobby.submissions,
    names: room.names,
    history,
    previousTrio: lobby.previousTrio,
    rng: room.seed,
  });
  lobby.result = result;
  room.els = sanitizeTrio(result.els);
  const { state, events } = fresh(room.seed, room.names, room.mode, room.els);
  room.state = state;
  room.actions = [];
  room.events = events;
  room.clockStamp = Date.now();
  persist(room);
  return result;
}

/** the decks to build a constructed room's state from: any missing deck is
 * stood in for by the other one (placeholder games are never played) */
function decksFor(room: Pick<Room, 'decks'>): [CardName[], CardName[]] {
  const a = room.decks[0] ?? room.decks[1];
  const b = room.decks[1] ?? room.decks[0];
  if (!a || !b) throw new Error('a constructed room needs at least one deck');
  return [a, b];
}

/** Register `seat`'s deck (validated!) while the room is waiting. When it
 * completes the pair, the REAL game is dealt (the placeholder state and the
 * empty action log are discarded). Returns true when the game just started. */
export function setRoomDeck(room: Room, seat: 0 | 1, cards: CardName[]): boolean {
  if (!roomWaiting(room)) return false;
  room.decks[seat] = [...cards];
  const complete = !!room.decks[0] && !!room.decks[1];
  if (complete) {
    const { state, events } = fresh(room.seed, room.names, room.mode, room.els, decksFor(room));
    room.state = state;
    room.actions = [];
    room.events = events;
    room.clockStamp = Date.now();
  }
  persist(room);
  return complete;
}

interface Rebuilt {
  state: GameState;
  events: EngineEvent[];
  deploySnapshot: GameState | null;
  heldDeploy: [EngineEvent[], EngineEvent[]];
  deployStartIndex: number;
}

/** Re-run seed + actions, accumulating the full event history (the engine's
 * own replay() keeps only the last events, so we accumulate here) and the
 * deploy-phase hidden-info bookkeeping. Tolerant: an action the (possibly
 * newer) engine now rejects is skipped with a warning instead of killing the
 * whole room — a personal server should never eat a live game over a rules
 * tweak. */
function rebuild(seed: number, names: [string, string], actions: Action[], mode: GameMode, els: Element[], decks?: [CardName[], CardName[]]): Rebuilt {
  let { state, events } = fresh(seed, names, mode, els, decks);
  const all = [...events];
  let deploySnapshot: GameState | null = null;
  let deployStartIndex = -1;
  const heldDeploy: [EngineEvent[], EngineEvent[]] = [[], []];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    const wasDeploy = state.phase === 'deploy';
    let r;
    try {
      r = apply(state, a);
    } catch (err) {
      if (err instanceof IllegalAction) {
        console.warn(`[rooms] replay skipped now-illegal action ${a.type}: ${err.message}`);
        continue;
      }
      throw err;
    }
    state = r.state;
    all.push(...r.events);
    if (state.phase === 'deploy' && !deploySnapshot) {
      deploySnapshot = structuredClone(state);
      deployStartIndex = i + 1;
    }
    if (wasDeploy) heldDeploy[a.seat === 0 ? 1 : 0].push(...r.events);
    if (state.phase !== 'deploy') {
      deploySnapshot = null;
      deployStartIndex = -1;
      heldDeploy[0] = [];
      heldDeploy[1] = [];
    }
  }
  return { state, events: all, deploySnapshot, heldDeploy, deployStartIndex };
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

/** `creatorDeck` (constructed only): the first joiner's deck, used to build
 * the waiting room's placeholder state — setRoomDeck assigns it to the actual
 * seat once main.ts has picked one. */
export function createRoom(code: string, seed: number, names: [string, string] = ['Player 1', 'Player 2'], mode: GameMode = 'shared', els?: Element[], creatorDeck?: CardName[]): Room {
  const trio = sanitizeTrio(els);
  if (mode === 'constructed' && !creatorDeck) throw new IllegalAction('a constructed room needs a deck');
  const decks: [CardName[] | null, CardName[] | null] = [null, null];
  const { state, events } = mode === 'constructed'
    ? fresh(seed, names, mode, trio, [creatorDeck!, creatorDeck!])
    : fresh(seed, names, mode, trio);
  const room: Room = {
    code, seed, mode, els: trio, decks, names, users: [null, null], winner: null,
    lobby: mode === 'draft' && !els ? freshLobby() : null,
    rematch: [false, false], rematchRoom: null,
    state, actions: [], events, sockets: [null, null],
    deploySnapshot: null, heldDeploy: [[], []], deployStartIndex: -1,
    clockMs: [CLOCK_START_MS, CLOCK_START_MS], clockStamp: Date.now(), clockRun: [false, false],
    building: [null, null],
  };
  rooms.set(code, room);
  persist(room);
  return room;
}

// ── who is allowed to CREATE a room ───────────────────────────────────
//
// Joining used to be get-or-create, so a mistyped code silently minted a brand
// new empty game and dropped you into it, alone, convinced you were in your
// friend's room. Playtest: Rashi did exactly that, twice, and the misses sat in
// games/ afterwards as empty rooms nobody had played in.
//
// Creation is now the privilege of a code the SERVER handed out: /api/new mints
// one and reserves it, and the first join to a reserved code spends the
// reservation to create the room. Every other code must already exist. A code
// you typed yourself can never create anything, which is the whole point — the
// New-game button is unaffected because it goes through /api/new already.

/** minted-but-not-yet-joined codes, and when they were minted */
const reserved = new Map<string, number>();
/** a reservation nobody used is a dead code — do not honour it forever */
const RESERVE_TTL_MS = 6 * 60 * 60 * 1000;
/** hard cap so a script hammering /api/new cannot grow this without bound */
const RESERVE_MAX = 500;

function pruneReservations(): void {
  const now = Date.now();
  for (const [code, at] of reserved) {
    if (now - at > RESERVE_TTL_MS) reserved.delete(code);
  }
  // still too many: drop the oldest (Map iterates in insertion order)
  while (reserved.size > RESERVE_MAX) {
    const oldest = reserved.keys().next();
    if (oldest.done) break;
    reserved.delete(oldest.value);
  }
}

/** /api/new: this code may be turned into a room by its first joiner */
export function reserveRoomCode(code: string): void {
  pruneReservations();
  reserved.set(code, Date.now());
}

/** is `code` either a live room or a code we minted? (i.e. joinable at all) */
export function roomExistsOrReserved(code: string): boolean {
  pruneReservations();
  return rooms.has(code) || reserved.has(code);
}

/**
 * The room for `code`, creating it ONLY if the code was reserved by /api/new.
 * Returns null when the code names nothing — the caller turns that into the
 * error the player sees.
 *
 * `mode`/`els`/`creatorDeck` only matter when the room doesn't exist yet (the
 * creator's first join carries them); joining an existing room ignores them.
 */
export function joinableRoom(code: string, mode: GameMode = 'shared', els?: Element[], creatorDeck?: CardName[]): Room | null {
  const existing = rooms.get(code);
  if (existing) return existing;
  pruneReservations();
  // spending the reservation and creating are one step: a second join to the
  // same code finds the room above rather than a second reservation
  if (!reserved.delete(code)) return null;
  return createRoom(code, (Math.random() * 1e9) >>> 0, undefined, mode, els, creatorDeck);
}

/** Apply an action to the room's authoritative state and record it. Throws
 * whatever the engine throws (IllegalAction) — caller reports it to the actor. */
export function applyToRoom(room: Room, action: Action): EngineEvent[] {
  settleClock(room);   // bill elapsed time to whoever WAS on the clock
  const wasDeploy = room.state.phase === 'deploy';
  const r = apply(room.state, action);
  room.state = r.state;
  room.actions.push(action);
  room.events.push(...r.events);
  // simultaneous-deploy bookkeeping: freeze a snapshot the moment deployment
  // starts, and hold every deploy-phase event back from the actor's opponent
  // (main.ts flushes the reveal; clearDeployHold() resets after the flush).
  if (room.state.phase === 'deploy' && !room.deploySnapshot) {
    room.deploySnapshot = structuredClone(room.state);
    room.deployStartIndex = room.actions.length;
  }
  if (wasDeploy) room.heldDeploy[action.seat === 0 ? 1 : 0].push(...r.events);
  if (room.state.winner !== null) room.winner = room.state.winner;   // stamp it
  settleClock(room);   // recompute who is on the clock under the NEW state
  persist(room);
  return r.events;
}

/** Deployment ended and the reveal has been sent — drop the freeze. */
export function clearDeployHold(room: Room): void {
  room.deploySnapshot = null;
  room.heldDeploy = [[], []];
  room.deployStartIndex = -1;
}

/** Undo the most recent action (single-step, docs/07 §15): pop it and rebuild
 * state by replaying seed + remaining actions. Caller enforces who/when. */
export function undoLastAction(room: Room): void {
  undoActionAt(room, room.actions.length - 1);
}

/** Undo the action at `index` (splice + full rebuild). Callers enforce who
 * may remove what; deploy-phase actions are seat-independent, so splicing a
 * seat's own action out of the middle of the deploy segment is sound. */
export function undoActionAt(room: Room, index: number): void {
  settleClock(room);   // bill up to the undo; the rebuild changes who runs
  room.actions.splice(index, 1);
  const { state, events, deploySnapshot, heldDeploy, deployStartIndex } =
    rebuild(room.seed, room.names, room.actions, room.mode, room.els,
      room.mode === 'constructed' ? decksFor(room) : undefined);
  room.state = state;
  room.events = events;
  room.deploySnapshot = deploySnapshot;
  room.heldDeploy = heldDeploy;
  room.deployStartIndex = deployStartIndex;
  settleClock(room);
  persist(room);
}

/**
 * Build the room a rematch moves to: same players, same seats, same format,
 * a new seed — and, for a draft, a fresh lobby that already knows what you
 * just played (so "run it back" is one click).
 *
 * Constructed keeps both decks and deals immediately: you have already each
 * brought one, and being sent back to the deck picker to choose the same deck
 * again would be a strange way to say "again".
 */
export function createRematch(old: Room, code: string): Room {
  const seed = (Math.random() * 1e9) >>> 0;
  const room = old.mode === 'constructed' && old.decks[0] && old.decks[1]
    ? createRoom(code, seed, [...old.names], old.mode, old.els, old.decks[0]!)
    : createRoom(code, seed, [...old.names], old.mode, old.mode === 'draft' ? undefined : old.els);
  if (old.mode === 'constructed' && old.decks[0] && old.decks[1]) {
    room.decks = [[...old.decks[0]!], [...old.decks[1]!]];
    const { state, events } = fresh(seed, room.names, room.mode, room.els, [room.decks[0]!, room.decks[1]!]);
    room.state = state;
    room.events = events;
  } else if (old.mode === 'draft') {
    room.lobby = freshLobby('pick-one', old.els);
  }
  // carry the seat↔account binding over, so the rematch is already countable
  // even before either client has re-joined
  room.users = [...old.users];
  for (const seat of [0, 1] as Seat[]) room.state.players[seat]!.name = room.names[seat]!;
  old.rematchRoom = code;
  persist(room);
  return room;
}

/** Rename a seat. Names are cosmetic: they live in room.names (persisted, used
 * by replay) and in the live state's player slot for rendering. */
export function renameSeat(room: Room, seat: 0 | 1, name: string): void {
  room.names[seat] = name;
  room.state.players[seat]!.name = name;
  persist(room);
}

/** Bind a seat to an account (or clear it when nobody is logged in there).
 * Idempotent, and persisted — this is what makes the game countable later. */
export function setSeatUser(room: Room, seat: 0 | 1, userId: string | null): void {
  if (room.users[seat] === userId) return;
  room.users[seat] = userId;
  persist(room);
}

// ── persistence ───────────────────────────────────────────────────────

function persist(room: Room): void {
  try {
    mkdirSync(GAMES_DIR, { recursive: true });
    const path = join(GAMES_DIR, `${room.code}.json`);
    // clockMs is persisted too: elapsed time cannot be reconstructed from a
    // replay. (Additive field — older files without it restore at 40:00.)
    writeFileSync(path, JSON.stringify({
      seed: room.seed, mode: room.mode, els: room.els, names: room.names,
      // accounts: who each seat belonged to, so the stats fold knows whose
      // game this was long after the sockets are gone (additive field)
      users: room.users,
      // and the result, stamped at the time — see Room.winner
      winner: room.winner,
      // the draft lobby: a room can be restarted mid-trio-choice, and losing
      // two rankings to a deploy would be a genuinely annoying way to lose
      // them (additive field)
      ...(room.lobby ? { lobby: room.lobby } : {}),
      actions: room.actions, clockMs: room.clockMs,
      // constructed: decks are part of the replay config (additive field)
      ...(room.mode === 'constructed' ? { decks: room.decks } : {}),
    }));
  } catch (err) {
    console.error(`[rooms] could not persist ${room.code}:`, err);
  }
}

/** Restore all persisted rooms by replaying their action logs. Best-effort:
 * a room whose replay throws (e.g. an engine change made an old log invalid)
 * is skipped with a warning rather than crashing startup. */
export function restoreRooms(): void {
  let files: string[];
  try {
    files = readdirSync(GAMES_DIR).filter(f => f.endsWith('.json'));
  } catch {
    return; // no games dir yet
  }
  for (const f of files) {
    const code = f.replace(/\.json$/, '');
    try {
      const raw = JSON.parse(readFileSync(join(GAMES_DIR, f), 'utf8')) as {
        seed: number; mode?: GameMode; els?: Element[]; names?: [string, string];
        actions: Action[]; clockMs?: [number, number];
        users?: [string | null, string | null];
        winner?: number | null;
        lobby?: Lobby;
        decks?: [CardName[] | null, CardName[] | null];
      };
      const names = raw.names ?? ['Player 1', 'Player 2'];
      const users: [string | null, string | null] = [raw.users?.[0] ?? null, raw.users?.[1] ?? null];
      const savedWinner: Seat | null = raw.winner === 0 || raw.winner === 1 ? raw.winner : null;
      const mode = raw.mode ?? 'shared';
      const els = sanitizeTrio(raw.els);
      const decks: [CardName[] | null, CardName[] | null] = [null, null];
      if (mode === 'constructed') {
        for (const s of [0, 1] as const) {
          const c = checkDeck(raw.decks?.[s]);
          if (c.ok) decks[s] = c.cards;
        }
        if (!decks[0] && !decks[1]) throw new Error('constructed room with no decks');
      }
      // a draft lobby that never resolved: keep the method and both
      // submissions, and make sure the placeholder is rebuilt, not replayed
      const lobby: Lobby | null = raw.lobby
        ? {
            method: sanitizeMethod(raw.lobby.method),
            submissions: [
              sanitizeSubmission(raw.lobby.submissions?.[0], sanitizeMethod(raw.lobby.method)),
              sanitizeSubmission(raw.lobby.submissions?.[1], sanitizeMethod(raw.lobby.method)),
            ],
            locked: [!!raw.lobby.locked?.[0], !!raw.lobby.locked?.[1]],
            result: raw.lobby.result ?? null,
          }
        : null;
      // a still-waiting room never had real actions — drop any strays
      const unresolved = (mode === 'constructed' && (!decks[0] || !decks[1]))
        || (!!lobby && !lobby.result);
      const actions = unresolved ? [] : raw.actions;
      const { state, events, deploySnapshot, heldDeploy, deployStartIndex } = rebuild(
        raw.seed, names, actions, mode, els,
        mode === 'constructed' ? decksFor({ decks }) : undefined);
      const clockMs: [number, number] = Array.isArray(raw.clockMs) && raw.clockMs.length === 2
        ? [Math.max(0, Number(raw.clockMs[0]) || 0), Math.max(0, Number(raw.clockMs[1]) || 0)]
        : [CLOCK_START_MS, CLOCK_START_MS];
      rooms.set(code, {
        code, seed: raw.seed, mode, els, decks, names, users, lobby,
        rematch: [false, false], rematchRoom: null,
        // the replay may not reach the ending this game actually had
        winner: state.winner ?? savedWinner,
        state, actions, events,
        sockets: [null, null], deploySnapshot, heldDeploy, deployStartIndex,
        // nobody is connected right after a restart, so no clock runs yet
        clockMs, clockStamp: Date.now(), clockRun: [false, false],
        building: [null, null],
      });
      console.log(`[rooms] restored ${code} (${raw.actions.length} actions)`);
    } catch (err) {
      console.error(`[rooms] could not restore ${code}:`, err instanceof Error ? err.message : err);
    }
  }
}
