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
import { readdirSync, readFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// type-only, so rooms.ts gains no runtime dependency on ws — the sockets are
// the real WebSockets main.ts plugs in; this module only checks presence
import type { WebSocket } from 'ws';
import type { Action, CardName, Element, EngineEvent, GameMode, GameState, Seat } from '../engine/src/types.ts';
import { apply, checkDeck, createGame, legalActions, sanitizeTrio, IllegalAction } from '../engine/src/apply.ts';
import { other } from './view.ts';
import {
  resolveTrio, sanitizeMethod, sanitizeSubmission, submissionReady,
  type TrioHistoryRow, type TrioMethod, type TrioResult, type TrioSubmission,
} from './trio.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
// ALGO_GAMES_DIR lets a test run against a throwaway directory of saved rooms
const GAMES_DIR = process.env['ALGO_GAMES_DIR'] ?? join(HERE, 'games');

/**
 * The HIDDEN SIMULTANEOUS SEGMENTS — the one place that knows which steps are
 * played behind a screen.
 *
 * Playtest UZRG (2026-08-21): "Planning should be like deployment, entirely
 * divorced from what your opponent is doing. But right now, you can't take
 * back making the wrong resource or recycling the wrong card if your opponent
 * does something (which shouldn't matter) and you can see what your opponent
 * is doing live, so there's technically a reason to wait to see what they do
 * (which there shouldn't be)."
 *
 * So a turn has THREE hidden segments, not one:
 *
 *   'plan'   the resource step  — recycle / activate / exchange / draft /
 *            bottom, ending when both players have hit done planning. Every
 *            one of those actions is confined to the actor's own hand and
 *            resources, fires no triggers, touches no stack, draws no RNG and
 *            allocates no entity ids, so the two seats' actions COMMUTE
 *            (test-hidden.ts asserts it directly) — which is exactly what
 *            makes an undo here always safe.
 *   'haste'  the haste step — plays resolve immediately, no priority, no
 *            responses (R18). Deployment's hazards, and no more.
 *   'deploy' simultaneous deployment, as before.
 *
 * Everything downstream is ONE rule: **the key changed → flush the old
 * segment's reveal, snapshot the new one.** Nothing else in the server knows
 * which phase it is looking at.
 */
export type SegKey = 'plan' | 'haste' | 'deploy';

/** Which hidden segment is this state in, if any? */
export function segmentKey(s: GameState): SegKey | null {
  // hasteEnding: the haste step's end-of-step triggers may suspend on a
  // decision with hasteDone already conceptually spent — the resource step is
  // definitively over, so this is never 'plan' again.
  if (s.phase === 'planning') return (s.hasteDone || s.hasteEnding) ? 'haste' : 'plan';
  if (s.phase === 'deploy') return 'deploy';
  return null;
}

/** Did this action move the id clock or the RNG stream? (the undo gate) */
const movedIdOrRng = (before: GameState, after: GameState): boolean =>
  before.nextId !== after.nextId || before.rngState !== after.rngState;

// ── the log's contract, and what happens when it breaks ───────────────
//
// A room file is a claim: **seed + actions reproduces this game**. It is the
// forensic record the whole playtest loop runs on, so when the claim stops
// being true that has to be LOUD.
//
// It stops being true like this. `rebuild()` is deliberately tolerant: an
// action the (possibly newer) engine now rejects is skipped rather than
// killing the room, because losing a live game to a rules tweak is worse than
// a slightly wrong log. But the skipped action STAYS in `actions`, and one
// skip cascades — the state the rest of the log was written against no longer
// exists, so action after action is refused too. Measured on a synthetic
// 60-action game: ONE action becoming illegal cost 28 of the 60, and rolled
// the game back from turn 4 to turn 2. Play then continues from the rolled-
// back board, appending to a log that is now two different games end to end,
// with nothing to mark the join.
//
// Note what is NOT wrong: the skip is deterministic, so `rebuild(seed,
// actions)` still equals the state the players are sitting in. The file is not
// self-contradictory — it is FORKED, and says nothing about it. That silence
// is the bug, and it is what makes a review months later report 79 rejections
// with no way to tell "the rules changed under this game" from "the server
// wrote a log it cannot honour".
//
// The fix is to make the file say so. We do NOT prune the skipped actions,
// even though pruning would restore the literal contract, because those
// actions are the evidence: a forked game is precisely the one you most want
// to inspect, `history.ts` counts the RAW log length so a real game is never
// demoted to a stub, and a rules commit can be reverted — a recorded fork can
// then be re-evaluated, a pruned one is gone. So the contract becomes
// explicit and checkable instead: **seed + actions, minus the forks this file
// declares, reproduces this game.** replay-room.ts verifies exactly that.

/** One logged action a rebuild could not apply. */
export interface LostAction {
  /** index into the room's `actions` */
  i: number;
  type: Action['type'];
  seat: Seat;
  /** the engine's own refusal */
  why: string;
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

/** Two skip sets describe the same fork iff they lost the same indices. */
const sameLoss = (a: LostAction[], b: LostAction[]): boolean =>
  a.length === b.length && a.every((x, i) => x.i === b[i]!.i);

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
  /**
   * Every restore that could NOT faithfully rebuild this game. Persisted.
   *
   * The log's contract is "seed + actions reproduces this game". A tolerant
   * restore breaks it silently: an action the current engine refuses is
   * skipped but LEFT in `actions`, so the file goes on claiming to be a
   * straight-through record of a game it no longer describes. This is the
   * file admitting otherwise — see recordFork().
   */
  forks: Fork[];
  /**
   * Actions the most recent rebuild could not apply. DERIVED (never
   * persisted): it is `forks` restated for the CURRENT engine, and it is what
   * undoActionAt() measures against to guarantee an undo never loses a play.
   */
  lost: LostAction[];
  /** full authoritative event history, for per-seat redacted log resync */
  events: EngineEvent[];
  /** connected client per seat (null = nobody there) */
  sockets: [WebSocket | null, WebSocket | null];
  /** which hidden simultaneous segment is open right now (null = none) */
  segKey: SegKey | null;
  /** the state as of the open segment's start — each seat's view of the
   * OPPONENT is served from this freeze until the segment closes */
  segSnapshot: GameState | null;
  /** events each seat has NOT yet been shown (their opponent's hidden moves
   * this segment); flushed as the "reveal" when the segment closes */
  heldEvents: [EngineEvent[], EngineEvent[]];
  /** index into `actions` where the open segment began (-1 outside one) —
   * undo may splice a seat's own actions at/after this point */
  segStartIndex: number;
  /**
   * Per-action: did it move the id clock or the RNG stream?
   *
   * Parallel to `actions` (same length, same indices) and DERIVED — never
   * persisted, rebuilt by rebuild(). It is the undo gate: splicing action `i`
   * out of a hidden segment re-runs everything after it from a different
   * prior state, so an action that consumed an entity id or an RNG draw
   * renumbers/re-rolls its successors. Seat B's augment on "unit 8" quietly
   * becomes an IllegalAction and is dropped by the tolerant replay — B loses
   * a play they were never told about. So an action may only leave a segment
   * when it is id- and RNG-inert, or when no opponent action follows it.
   */
  segTouched: boolean[];
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
  // the dealt game's first planning segment starts here — without this the
  // freeze would still hold the placeholder (and its placeholder NAMES) for
  // the whole of turn 1
  resetSegment(room);
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
    resetSegment(room);   // same as resolveLobby: the real game's turn 1
    room.clockStamp = Date.now();
  }
  persist(room);
  return complete;
}

interface Rebuilt {
  state: GameState;
  events: EngineEvent[];
  segKey: SegKey | null;
  segSnapshot: GameState | null;
  heldEvents: [EngineEvent[], EngineEvent[]];
  segStartIndex: number;
  segTouched: boolean[];
  /** logged actions this rebuild could not apply (see LostAction) */
  skipped: LostAction[];
}

/** Re-run seed + actions, accumulating the full event history (the engine's
 * own replay() returns only the creation events, so we accumulate here) and the
 * hidden-segment bookkeeping. Tolerant: an action the (possibly newer) engine
 * now rejects is skipped with a warning instead of killing the whole room — a
 * personal server should never eat a live game over a rules tweak. */
function rebuild(seed: number, names: [string, string], actions: Action[], mode: GameMode, els: Element[], decks?: [CardName[], CardName[]]): Rebuilt {
  let { state, events } = fresh(seed, names, mode, els, decks);
  const all = [...events];
  // SEED THE SEGMENT FROM THE INITIAL STATE: createGame already ends inside
  // turn 1's planning, and turn-1 planning has no preceding action — a
  // "snapshot after an action" pattern would miss the very first segment of
  // every game (and serve a stale, placeholder-named opponent all through it).
  let segKey = segmentKey(state);
  let segSnapshot: GameState | null = segKey ? structuredClone(state) : null;
  let segStartIndex = segKey ? 0 : -1;
  let heldEvents: [EngineEvent[], EngineEvent[]] = [[], []];
  const segTouched: boolean[] = [];
  const skipped: LostAction[] = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    const before = state;
    // hold only while the open segment is still the one this action is in:
    // the forced battle drain runs public actions after the key has moved on
    const holding = segKey !== null && segmentKey(before) === segKey;
    let r;
    try {
      r = apply(state, a);
    } catch (err) {
      if (err instanceof IllegalAction) {
        // NOT just a warning: the caller records this into the file, because
        // a log that quietly stopped describing its own game is the thing we
        // most need to be able to see afterwards
        skipped.push({ i, type: a.type, seat: a.seat, why: err.message });
        segTouched.push(false);   // keep the index alignment with `actions`
        continue;
      }
      throw err;
    }
    state = r.state;
    all.push(...r.events);
    segTouched.push(movedIdOrRng(before, state));
    if (holding) heldEvents[other(a.seat)].push(...r.events);
    const now = segmentKey(state);
    if (now !== segKey) {
      segKey = now;
      segSnapshot = now ? structuredClone(state) : null;
      segStartIndex = now ? i + 1 : -1;
      heldEvents = [[], []];
    }
  }
  return { state, events: all, segKey, segSnapshot, heldEvents, segStartIndex, segTouched, skipped };
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
    state, actions: [], events, sockets: [null, null], forks: [], lost: [],
    segKey: null, segSnapshot: null, heldEvents: [[], []], segStartIndex: -1, segTouched: [],
    clockMs: [CLOCK_START_MS, CLOCK_START_MS], clockStamp: Date.now(), clockRun: [false, false],
    building: [null, null],
  };
  // turn 1's planning segment opens HERE, not on the first action
  resetSegment(room);
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
  const before = room.state;
  // hold this action's events back from the opponent only while the segment
  // it was taken in is the one still open. (main.ts drains a run of forced
  // battle actions after a segment's key has already moved on; those are
  // public and must not land in anybody's held queue.)
  const holding = room.segKey !== null && segmentKey(before) === room.segKey;
  const r = apply(room.state, action);
  room.state = r.state;
  room.actions.push(action);
  room.segTouched.push(movedIdOrRng(before, r.state));
  room.events.push(...r.events);
  if (holding) room.heldEvents[other(action.seat)].push(...r.events);
  if (room.state.winner !== null) room.winner = room.state.winner;   // stamp it
  settleClock(room);   // recompute who is on the clock under the NEW state
  persist(room);
  return r.events;
}

/**
 * Close whatever segment was open and open the one the CURRENT state is in
 * (which may be none): a fresh freeze, a fresh start index, an empty hold.
 *
 * The caller reads `heldEvents` for the reveal BEFORE calling this. Every
 * segment boundary — 'plan'→'haste', 'haste'→null, 'deploy'→'plan' — is this
 * one call; there is no per-phase branch anywhere.
 */
export function openSegment(room: Room): void {
  room.segKey = segmentKey(room.state);
  room.segSnapshot = room.segKey ? structuredClone(room.state) : null;
  room.segStartIndex = room.segKey ? room.actions.length : -1;
  room.heldEvents = [[], []];
}

/** A room whose state was re-dealt and whose action log was reset (a resolved
 * lobby, a completed constructed pair, a rematch): the derived per-action
 * bookkeeping goes with it, and the new game's first segment opens now. */
function resetSegment(room: Room): void {
  room.segTouched = [];
  // the previous action log is gone, so any fork recorded against it is too:
  // a fork is a claim about THIS log, and this is a different one
  room.forks = [];
  room.lost = [];
  openSegment(room);
}

/** Undo the most recent action (single-step, docs/07 §15): pop it and rebuild
 * state by replaying seed + remaining actions. Caller enforces who/when. */
export function undoLastAction(room: Room): LostAction[] {
  return undoActionAt(room, room.actions.length - 1);
}

/**
 * May `seat` splice the action at `index` out of the open hidden segment?
 *
 * The action log stays ARRIVAL ORDER — it is the record, and replay(seed,
 * actions) must still reproduce it bit-identically. What needs a rule is the
 * SPLICE, because removing seat A's action re-runs seat B's from a different
 * prior state. An action that moved the id clock or the RNG stream renumbers
 * everything after it (A deploys unit 7, B deploys 8 and augments hostId 8;
 * A undoes → B's unit is 7 → B's augment is now illegal and is SILENTLY
 * skipped by the tolerant replay: B loses a play nobody told them about).
 *
 * So: an action may leave a segment iff it is id- and RNG-inert, or no
 * opponent action follows it in the log. Refusing is deliberate — the
 * alternative is silently reordering somebody else's game.
 *
 * The resource step is provably inert, so this never fires there. It also
 * closes the same hole in deployment, which had it all along.
 */
export function spliceable(room: Room, index: number, seat: Seat): boolean {
  if (!room.segTouched[index]) return true;
  return !room.actions.slice(index + 1)
    .some(a => a.seat !== seat && !RENUMBER_IMMUNE.has(a.type));
}

/**
 * DO NOT "TIDY THIS AWAY". It is load-bearing, and the reasoning is here so
 * that a later reader does not mistake it for an unprincipled special case.
 *
 * These five action types carry NO id, NO index and NO choice — their entire
 * payload is `{ type, seat }`. Splicing an action out from under one of them
 * renumbers entity ids and re-rolls the RNG stream, and neither can change
 * what a bare barrier flag MEANS or whether it is legal: `doneDeploying` is
 * legal iff you are deploying and have not yet finished, which no renumbering
 * can affect. So one of these landing on top of your play is not a reason to
 * refuse to take the play back.
 *
 * Without the exception the gate re-creates the exact complaint this whole
 * design answers, one step further along: your opponent presses "done" and
 * your undo silently disappears. Reviewed and approved 2026-08-21 after the
 * first implementation flagged it.
 *
 * Anything with a payload — an entityId, a hand index, a decision choice —
 * stays gated, because for those the renumbering genuinely can change what
 * the action refers to.
 */
const RENUMBER_IMMUNE = new Set<Action['type']>([
  'donePlanning', 'doneHaste', 'doneDeploying', 'passPriority', 'concede',
]);

/** Undo the action at `index` (splice + full rebuild). Callers enforce who
 * may remove what and check spliceable() first. */
export function undoActionAt(room: Room, index: number): LostAction[] {
  settleClock(room);   // bill up to the undo; the rebuild changes who runs
  const restore = [...room.actions];
  room.actions.splice(index, 1);
  let rb = rebuildRoom(room);
  // An undo must never cost anybody an action they did not ask to give up.
  // spliceable() predicts that from the action's payload; this MEASURES it,
  // and a measurement beats a prediction — if taking this one out made
  // anything else in the log unreplayable, put it back and say so. A refused
  // undo is a mild annoyance; a silently dropped play is the bug that made
  // game UZRG unreadable.
  if (rb.skipped.length > room.lost.length) {
    const wouldLose = rb.skipped;        // capture before the roll-back rebuild
    room.actions = restore;
    assignRebuild(room, rebuildRoom(room));   // deterministic: exact prior state
    settleClock(room);
    return wouldLose;                    // non-empty ⇒ the undo was REFUSED
  }
  assignRebuild(room, rb);
  settleClock(room);
  persist(room);
  return [];
}

/**
 * A restore could not faithfully rebuild this game: write that into the file,
 * and tell the players.
 *
 * Only for rooms still being PLAYED. A finished game's skips are read-only
 * forensics — `stats.ts` already reports it as diverged, `replay-room.ts`
 * spells it out, and recording a fork for each of them would rewrite hundreds
 * of settled files on every boot (the ~650 skip warnings at startup are these,
 * and they are normal). A LIVE room is different: play is about to continue
 * into that log, and the join has to be marked before it happens.
 *
 * Idempotent across restarts — restoring the same room under the same engine
 * loses the same actions, and that is one fork, not one per boot.
 */
function recordFork(room: Room): boolean {
  if (!room.lost.length) return false;
  const previous = room.forks[room.forks.length - 1];
  if (previous && sameLoss(previous.lost, room.lost)) return false;   // already known
  room.forks.push({
    at: new Date().toISOString(),
    logged: room.actions.length,
    lost: room.lost.map(l => ({ ...l })),
    turn: room.state.turn,
    phase: room.state.phase,
  });
  // and say it OUT LOUD, in the game's own log, where both players see it on
  // their next join. Degrading quietly is the whole failure mode here.
  room.events.push({
    type: 'note',
    msg: `⚠ This game could not be fully restored: ${room.lost.length} of ${room.actions.length} `
      + `logged actions no longer replay under the current rules, so it has been rebuilt without `
      + `them and stands at turn ${room.state.turn}. Everything before this line describes a `
      + `different board.`,
    data: { lost: room.lost.length, logged: room.actions.length },
  } as unknown as EngineEvent);
  console.warn(`[rooms] ${room.code} FORKED on restore: ${room.lost.length} of ${room.actions.length} `
    + `actions could not be replayed; the game resumes at turn ${room.state.turn} ${room.state.phase}`);
  return true;
}

/** rebuild() for a room that already knows its own seed/mode/els/decks. */
function rebuildRoom(room: Room): Rebuilt {
  return rebuild(room.seed, room.names, room.actions, room.mode, room.els,
    room.mode === 'constructed' ? decksFor(room) : undefined);
}

/** Adopt a rebuild's results wholesale (state + event history + the derived
 * segment and integrity bookkeeping). */
function assignRebuild(room: Room, rb: Rebuilt): void {
  room.state = rb.state;
  room.events = rb.events;
  room.segKey = rb.segKey;
  room.segSnapshot = rb.segSnapshot;
  room.heldEvents = rb.heldEvents;
  room.segStartIndex = rb.segStartIndex;
  room.segTouched = rb.segTouched;
  room.lost = rb.skipped;
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
  resetSegment(room);   // the constructed branch above replaced the state
  old.rematchRoom = code;
  persist(room);
  return room;
}

/** Rename a seat. Names are cosmetic: they live in room.names (persisted, used
 * by replay) and in the live state's player slot for rendering.
 *
 * NOTE this happens OUTSIDE the action log, so it does not reach the open
 * segment's frozen snapshot — and turn 1's 'plan' segment is snapshotted at
 * room creation, before anybody has typed a name. viewFor() therefore carries
 * the LIVE name over the frozen player slot; a name is never hidden. */
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
    // temp + rename, like accounts.ts: this file is the game's only record,
    // and a crash mid-write must not leave it half-written (restoreRooms
    // would silently skip the corrupt room and the game would be lost)
    const tmp = `${path}.tmp`;
    // clockMs is persisted too: elapsed time cannot be reconstructed from a
    // replay. (Additive field — older files without it restore at 40:00.)
    writeFileSync(tmp, JSON.stringify({
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
      // every restore that could not faithfully rebuild this game. Without
      // it the file goes on claiming to be a straight-through record of a
      // game it no longer describes (additive field)
      ...(room.forks.length ? { forks: room.forks } : {}),
      // constructed: decks are part of the replay config (additive field)
      ...(room.mode === 'constructed' ? { decks: room.decks } : {}),
    }));
    renameSync(tmp, path);
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
        forks?: Fork[];
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
      const { state, events, segKey, segSnapshot, heldEvents, segStartIndex, segTouched, skipped } = rebuild(
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
        sockets: [null, null], segKey, segSnapshot, heldEvents, segStartIndex, segTouched,
        forks: Array.isArray(raw.forks) ? raw.forks : [], lost: skipped,
        // nobody is connected right after a restart, so no clock runs yet
        clockMs, clockStamp: Date.now(), clockRun: [false, false],
        building: [null, null],
      });
      // a LIVE room whose log could not be fully replayed has just forked:
      // record it in the file and in the game's own log before play resumes
      const restored = rooms.get(code)!;
      if (decidedWinner(restored) === null && recordFork(restored)) persist(restored);
      console.log(`[rooms] restored ${code} (${raw.actions.length} actions`
        + `${skipped.length ? `, ${skipped.length} unreplayable` : ''})`);
    } catch (err) {
      console.error(`[rooms] could not restore ${code}:`, err instanceof Error ? err.message : err);
    }
  }
}
