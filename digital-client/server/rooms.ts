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
import type { Action, Element, EngineEvent, GameMode, GameState } from '../engine/src/types.ts';
import { apply, createGame, legalActions, sanitizeTrio, IllegalAction } from '../engine/src/apply.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAMES_DIR = join(HERE, 'games');

export interface Socket {
  send(data: string): void;
}

export interface Room {
  code: string;
  seed: number;
  mode: GameMode;
  /** draft mode: the chosen trio (sanitized); ignored in 'shared' */
  els: Element[];
  names: [string, string];
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
}

/** Chess-clock starting bank per player (40 minutes). */
export const CLOCK_START_MS = 40 * 60 * 1000;

/** Which seats' clocks should run right now: the game is waiting on a seat
 * iff it has at least one legal action (covers pending decisions, priority,
 * draft picks, and the simultaneous planning/deploy done-flags — both clocks
 * may run at once during simultaneous phases, which is correct). Clocks only
 * run while BOTH players are connected (casual client: waiting alone for an
 * opponent, a dropped tab, or a room restored after a server restart must
 * not silently drain anybody), and a finished game stops both clocks. */
export function clockRunning(room: Room): [boolean, boolean] {
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
function fresh(seed: number, names: [string, string], mode: GameMode, els: Element[]): { state: GameState; events: EngineEvent[] } {
  const r = createGame(seed, names, mode, els);
  return { state: r.state, events: r.events };
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
function rebuild(seed: number, names: [string, string], actions: Action[], mode: GameMode, els: Element[]): Rebuilt {
  let { state, events } = fresh(seed, names, mode, els);
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

export function createRoom(code: string, seed: number, names: [string, string] = ['Player 1', 'Player 2'], mode: GameMode = 'shared', els?: Element[]): Room {
  const trio = sanitizeTrio(els);
  const { state, events } = fresh(seed, names, mode, trio);
  const room: Room = {
    code, seed, mode, els: trio, names, state, actions: [], events, sockets: [null, null],
    deploySnapshot: null, heldDeploy: [[], []], deployStartIndex: -1,
    clockMs: [CLOCK_START_MS, CLOCK_START_MS], clockStamp: Date.now(), clockRun: [false, false],
  };
  rooms.set(code, room);
  persist(room);
  return room;
}

/** `mode`/`els` only matter when the room doesn't exist yet (the creator's
 * first join carries them); joining an existing room ignores them. */
export function getOrCreateRoom(code: string, mode: GameMode = 'shared', els?: Element[]): Room {
  return rooms.get(code) ?? createRoom(code, (Math.random() * 1e9) >>> 0, undefined, mode, els);
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
    rebuild(room.seed, room.names, room.actions, room.mode, room.els);
  room.state = state;
  room.events = events;
  room.deploySnapshot = deploySnapshot;
  room.heldDeploy = heldDeploy;
  room.deployStartIndex = deployStartIndex;
  settleClock(room);
  persist(room);
}

/** Rename a seat. Names are cosmetic: they live in room.names (persisted, used
 * by replay) and in the live state's player slot for rendering. */
export function renameSeat(room: Room, seat: 0 | 1, name: string): void {
  room.names[seat] = name;
  room.state.players[seat]!.name = name;
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
      actions: room.actions, clockMs: room.clockMs,
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
      };
      const names = raw.names ?? ['Player 1', 'Player 2'];
      const mode = raw.mode ?? 'shared';
      const els = sanitizeTrio(raw.els);
      const { state, events, deploySnapshot, heldDeploy, deployStartIndex } = rebuild(raw.seed, names, raw.actions, mode, els);
      const clockMs: [number, number] = Array.isArray(raw.clockMs) && raw.clockMs.length === 2
        ? [Math.max(0, Number(raw.clockMs[0]) || 0), Math.max(0, Number(raw.clockMs[1]) || 0)]
        : [CLOCK_START_MS, CLOCK_START_MS];
      rooms.set(code, {
        code, seed: raw.seed, mode, els, names, state, actions: raw.actions, events,
        sockets: [null, null], deploySnapshot, heldDeploy, deployStartIndex,
        // nobody is connected right after a restart, so no clock runs yet
        clockMs, clockStamp: Date.now(), clockRun: [false, false],
      });
      console.log(`[rooms] restored ${code} (${raw.actions.length} actions)`);
    } catch (err) {
      console.error(`[rooms] could not restore ${code}:`, err instanceof Error ? err.message : err);
    }
  }
}
