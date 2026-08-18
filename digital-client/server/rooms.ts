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
import type { Action, EngineEvent, GameState } from '../engine/src/types.ts';
import { apply, createGame } from '../engine/src/apply.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAMES_DIR = join(HERE, 'games');

export interface Socket {
  send(data: string): void;
}

export interface Room {
  code: string;
  seed: number;
  names: [string, string];
  state: GameState;
  actions: Action[];
  /** full authoritative event history, for per-seat redacted log resync */
  events: EngineEvent[];
  /** connected client per seat (null = nobody there) */
  sockets: [Socket | null, Socket | null];
}

const rooms = new Map<string, Room>();

/** Build a fresh game and its initial event list. */
function fresh(seed: number, names: [string, string]): { state: GameState; events: EngineEvent[] } {
  const r = createGame(seed, names);
  return { state: r.state, events: r.events };
}

/** Re-run seed + actions, accumulating the full event history (the engine's
 * own replay() keeps only the last events, so we accumulate here). */
function rebuild(seed: number, names: [string, string], actions: Action[]): { state: GameState; events: EngineEvent[] } {
  let { state, events } = fresh(seed, names);
  const all = [...events];
  for (const a of actions) {
    const r = apply(state, a);
    state = r.state;
    all.push(...r.events);
  }
  return { state, events: all };
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function createRoom(code: string, seed: number, names: [string, string] = ['Player 1', 'Player 2']): Room {
  const { state, events } = fresh(seed, names);
  const room: Room = { code, seed, names, state, actions: [], events, sockets: [null, null] };
  rooms.set(code, room);
  persist(room);
  return room;
}

export function getOrCreateRoom(code: string): Room {
  return rooms.get(code) ?? createRoom(code, (Math.random() * 1e9) >>> 0);
}

/** Apply an action to the room's authoritative state and record it. Throws
 * whatever the engine throws (IllegalAction) — caller reports it to the actor. */
export function applyToRoom(room: Room, action: Action): EngineEvent[] {
  const r = apply(room.state, action);
  room.state = r.state;
  room.actions.push(action);
  room.events.push(...r.events);
  persist(room);
  return r.events;
}

/** Undo the most recent action (single-step, docs/07 §15): pop it and rebuild
 * state by replaying seed + remaining actions. Caller enforces who/when. */
export function undoLastAction(room: Room): void {
  room.actions.pop();
  const { state, events } = rebuild(room.seed, room.names, room.actions);
  room.state = state;
  room.events = events;
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
    writeFileSync(path, JSON.stringify({ seed: room.seed, names: room.names, actions: room.actions }));
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
        seed: number; names?: [string, string]; actions: Action[];
      };
      const names = raw.names ?? ['Player 1', 'Player 2'];
      const { state, events } = rebuild(raw.seed, names, raw.actions);
      rooms.set(code, { code, seed: raw.seed, names, state, actions: raw.actions, events, sockets: [null, null] });
      console.log(`[rooms] restored ${code} (${raw.actions.length} actions)`);
    } catch (err) {
      console.error(`[rooms] could not restore ${code}:`, err instanceof Error ? err.message : err);
    }
  }
}
