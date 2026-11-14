/* CUBE DRAFT EVENTS — THE STORE (docs/25-cube-draft.md §2, §3).
 *
 * One JSON file per event, `cubeDir()/<CODE>.json` (statepaths.ts — paths are
 * named once, env ALGO_CUBE_DIR), written temp + rename like a match file. Read
 * once at boot into a map (after loadMatches: the reconcile in cube.ts reads
 * match records); every change is written through `saveCube`.
 *
 * ONE WRITER: cube.ts (the controller) mutates an event and saves it here.
 * Nothing in this file knows a room or a match exists.
 *
 * The event's NOTES (the bell's lines, api-inbox.ts) live in its own file, so a
 * change and the line that announces it are one atomic write.
 *
 * Mutable runtime state (var/), never committed.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CubeEvent, CubeNote, CubeNoteKind, CubeNoteRow } from './cube-types.ts';
import { cubeDir } from './statepaths.ts';

const events = new Map<string, CubeEvent>();
/** set by loadCubes, else the env's at FIRST USE (never at import — a test
 * points ALGO_CUBE_DIR at a scratch directory after importing) */
let dirSet: string | null = null;
const dirNow = (): string => dirSet ?? cubeDir();

/** a code that could name a file in the cube directory — and nothing outside it */
const FILE_CODE = /^[A-Z0-9]{1,12}$/;

/** Load every saved event. Idempotent; a file that does not parse is skipped
 * with a line (an event is never worth a crash at boot). */
export function loadCubes(from = cubeDir()): void {
  dirSet = from;
  events.clear();
  let files: string[];
  try { files = readdirSync(from).filter(f => f.endsWith('.json')); } catch { return; }
  for (const f of files) {
    try {
      const e = JSON.parse(readFileSync(join(from, f), 'utf8')) as CubeEvent;
      if (typeof e.code === 'string' && e.config && Array.isArray(e.players) && Array.isArray(e.pairings)) {
        events.set(e.code, e);
      }
    } catch (err) {
      console.error(`[cube] could not load ${f}:`, err instanceof Error ? err.message : err);
    }
  }
}

export function saveCube(e: CubeEvent): void {
  events.set(e.code, e);
  try {
    const dir = dirNow();
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${e.code}.json`);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(e));
    renameSync(tmp, path);
  } catch (err) {
    console.error(`[cube] could not persist ${e.code}:`, err);
  }
}

export const getCube = (code: string | null | undefined): CubeEvent | undefined =>
  (code ? events.get(code.toUpperCase()) : undefined);
export const allCubes = (): CubeEvent[] => [...events.values()];

/** rooms.ts codeTaken's other half (docs/25 §3: one code space) — an event in
 * memory, or the file of one */
export function cubeCodeTaken(code: string): boolean {
  if (events.has(code)) return true;
  return FILE_CODE.test(code) && existsSync(join(dirNow(), `${code}.json`));
}

/* ── THE BELL ─────────────────────────────────────────────────────────────── */

/** how many notes an event keeps per player, newest */
const NOTES_PER_PLAYER = 20;
/** the bell shows a week of them */
const NOTES_WINDOW_MS = 7 * 24 * 3600_000;

/** add a line to `to`'s bell (the caller saves the event) */
export function addNote(e: CubeEvent, to: string, kind: CubeNoteKind, at: number,
  extra: { round?: number; opponent?: string | null } = {}): void {
  const notes = e.notes ??= [];
  const n = (notes.at(-1)?.n ?? 0) + 1;
  notes.push({ n, to, kind, at, ...extra });
  // bounded: the oldest of this player's lines go first
  const mine = notes.filter(r => r.to === to);
  if (mine.length > NOTES_PER_PLAYER) {
    const drop = new Set(mine.slice(0, mine.length - NOTES_PER_PLAYER));
    e.notes = notes.filter(r => !drop.has(r));
  }
}

/** this player's cube lines over every event, newest first */
export function cubeNotesFor(userId: string, now: number): CubeNote[] {
  const out: CubeNote[] = [];
  for (const e of events.values()) {
    for (const r of e.notes ?? []) {
      if (r.to !== userId || now - r.at > NOTES_WINDOW_MS) continue;
      out.push({
        id: `${e.code}:${r.n}`, event: e.code, eventName: e.config.name, kind: r.kind, at: r.at, read: !!r.readAt,
        ...(r.round !== undefined ? { round: r.round } : {}),
        ...(r.opponent !== undefined ? { opponent: r.opponent } : {}),
      });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

/** the bell was opened: every cube line to this player stamped at or before `upTo` is read */
export function markCubeNotesRead(userId: string, upTo: number, now: number): void {
  for (const e of events.values()) {
    let n = 0;
    for (const r of e.notes ?? [] as CubeNoteRow[]) {
      if (r.to === userId && r.at <= upTo && !r.readAt) { r.readAt = now; n++; }
    }
    if (n) saveCube(e);
  }
}
