/* WEEKLY CHALLENGES — the half that remembers (docs/21-weekly-challenges.md).
 *
 * challenges.ts is the calendar; the engine's challenge.ts verifies and
 * scores; this file keeps. It owns `var/challenges/` (statepaths.ts
 * `challengesDir`):
 *
 *   runs.jsonl   APPEND-ONLY, one line per accepted run:
 *                {runId, challengeId, user, name, at, deck, score, engine, actions}.
 *                A score is stamped once, when the run is verified, and never
 *                recomputed — a later rules change makes an old run's log a
 *                claim about an older engine (`engine` says which), not a
 *                different score.
 *   weeks.json   the FROZEN result of every closed week — winner and top ten
 *                per category — rewritten atomically (temp file + rename, the
 *                pattern league-store.ts and accounts.ts use).
 *
 * ── WHY `actions` IS WRITTEN LAST ────────────────────────────────────────
 *
 * A run's log is by far the biggest thing on its line (thousands of actions),
 * and nothing but `GET /api/challenge/run/<id>` ever needs it. So the store
 * keeps every run's metadata in memory and only the BYTE OFFSET of its line;
 * the log is read off disk when somebody asks for that one run. Loading parses
 * each line only up to `,"actions":` — safe because JSON escapes every quote
 * inside a string, so that literal can only be the key itself.
 *
 * ── THE BOARD IS LIVE; THE WINNER IS FROZEN ──────────────────────────────
 *
 * A run sent to a closed week is recorded and ranked on that week's board
 * (docs/21: "Try this deck" on a past week), but it cannot move the frozen
 * winner. So `board()` is always computed from every run, and `winner` is read
 * from weeks.json. The freeze itself only counts runs stamped before the week
 * closed — so it gives the same answer whenever the sweep happens to run,
 * including after downtime, which is what makes it idempotent in substance
 * and not just in "it skips a week it already wrote".
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { CATEGORIES, better, type Category, type ChallengeDef, type RunScore } from '../engine/src/challenge.ts';
import type { Action, CardName } from '../engine/src/types.ts';
import { accountById } from './accounts.ts';
import { CHALLENGES, isClosed, weekWindow } from './challenges.ts';
import { challengesDir } from './statepaths.ts';

/** a row of runs.jsonl, whole */
export interface RunRow {
  runId: string;
  challengeId: string;
  /** account id — never sent to anybody */
  user: string;
  /** the account's name when it submitted (a fallback: boards show the live name) */
  name: string;
  /** epoch ms, on the challenge clock (`challengeNow`) */
  at: number;
  deck: CardName[];
  score: RunScore;
  /** the engine commit it was verified on (engine-version.ts) */
  engine: string;
  /** the log as verified, truncated at the action that met the goal */
  actions: Action[];
}

/** what the store keeps in memory per run: everything but the log */
interface RunMeta extends Omit<RunRow, 'actions'> {
  /** byte offset and length of its line in runs.jsonl */
  off: number;
  len: number;
  /** sha256 of deck + actions: the same run sent twice is stored once */
  hash: string;
}

export interface BoardRow {
  rank: number;
  name: string;
  score: RunScore;
  at: number;
  /** only once the week has closed */
  runId?: string;
  deck?: CardName[];
}

/** a frozen row: the public row plus whose it was (kept, never sent) */
interface FrozenRow extends BoardRow { user: string; runId: string; deck: CardName[] }

export interface FrozenWeek {
  /** epoch ms the week closed (its calendar boundary, not when the sweep ran) */
  closedAt: number;
  /** when the sweep wrote it */
  frozenAt: number;
  winner: FrozenRow | null;
  top: Record<Category, FrozenRow[]>;
}

interface WeeksFile { version: 1; weeks: Record<string, FrozenWeek> }

/** rows kept per category when a week freezes */
export const FROZEN_TOP = 10;

// ── the files ─────────────────────────────────────────────────────────

let dirOverride: string | null = null;
const dir = (): string => dirOverride ?? challengesDir();
const runsFile = (): string => join(dir(), 'runs.jsonl');
const weeksFile = (): string => join(dir(), 'weeks.json');

interface Mem {
  runs: RunMeta[];
  byId: Map<string, RunMeta>;
  byChallenge: Map<string, RunMeta[]>;
  /** bytes in runs.jsonl as this process knows it */
  size: number;
  /** the file's last byte is not a newline (a crash mid-append): the next append starts a line first */
  ragged: boolean;
  weeks: WeeksFile;
}
let mem: Mem | null = null;

const ACTIONS_KEY = Buffer.from(',"actions":');

function parseMeta(line: Buffer, off: number): RunMeta | null {
  try {
    const cut = line.indexOf(ACTIONS_KEY);
    const head = cut >= 0 ? `${line.subarray(0, cut).toString('utf8')}}` : line.toString('utf8');
    const r = JSON.parse(head) as Partial<RunRow>;
    if (typeof r.runId !== 'string' || typeof r.challengeId !== 'string' || typeof r.user !== 'string'
      || typeof r.at !== 'number' || !r.score || !Array.isArray(r.deck)) return null;
    return {
      runId: r.runId, challengeId: r.challengeId, user: r.user, name: String(r.name ?? ''), at: r.at,
      deck: r.deck, score: r.score, engine: String(r.engine ?? ''), off, len: line.length,
      hash: typeof (r as { hash?: unknown }).hash === 'string' ? (r as { hash: string }).hash : '',
    };
  } catch {
    return null;
  }
}

function db(): Mem {
  if (mem) return mem;
  const m: Mem = { runs: [], byId: new Map(), byChallenge: new Map(), size: 0, ragged: false, weeks: { version: 1, weeks: {} } };
  let buf: Buffer | null = null;
  try { buf = readFileSync(runsFile()); } catch { /* no runs yet */ }
  if (buf) {
    m.size = buf.length;
    m.ragged = buf.length > 0 && buf[buf.length - 1] !== 0x0a;
    let start = 0;
    while (start < buf.length) {
      let end = buf.indexOf(0x0a, start);
      if (end < 0) end = buf.length;
      if (end > start) {
        const meta = parseMeta(buf.subarray(start, end), start);
        if (meta) index(m, meta);
        else console.error(`[challenges] runs.jsonl: unreadable line at byte ${start}, skipped`);
      }
      start = end + 1;
    }
  }
  try {
    const raw = JSON.parse(readFileSync(weeksFile(), 'utf8')) as Partial<WeeksFile>;
    if (raw && typeof raw.weeks === 'object' && raw.weeks) m.weeks = { version: 1, weeks: raw.weeks };
  } catch { /* nothing frozen yet */ }
  mem = m;
  return m;
}

function index(m: Mem, meta: RunMeta): void {
  m.runs.push(meta);
  m.byId.set(meta.runId, meta);
  let list = m.byChallenge.get(meta.challengeId);
  if (!list) m.byChallenge.set(meta.challengeId, list = []);
  list.push(meta);
}

/** Re-read both files (boot, and the tests' "after a restart"). */
export function loadChallengeStore(): void { mem = null; db(); }

/** Tests only: point the store at a throwaway directory. Returns a restore function. */
export function useChallengeDir(path: string): () => void {
  const prev = dirOverride;
  dirOverride = path;
  loadChallengeStore();
  return () => { dirOverride = prev; mem = null; };
}

function persistWeeks(m: Mem): void {
  try {
    const file = weeksFile();
    mkdirSync(dir(), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(m.weeks, null, 1));
    renameSync(`${file}.tmp`, file);
  } catch (err) {
    console.error('[challenges] could not persist weeks.json:', err);
  }
}

// ── runs ──────────────────────────────────────────────────────────────

export const runHash = (deck: readonly CardName[], actions: readonly Action[]): string =>
  createHash('sha256').update(JSON.stringify([deck, actions])).digest('hex');

/** A user's run with exactly this deck and log on this challenge, if they already sent it. */
export function duplicateRun(challengeId: string, user: string, hash: string): RunMeta | null {
  return db().byChallenge.get(challengeId)?.find(r => r.user === user && r.hash === hash) ?? null;
}

/** Append one verified run. Throws if it could not be written — the caller
 * must not tell the player a run was recorded when it was not. */
export function appendRun(input: Omit<RunRow, 'runId'> & { hash?: string }): RunMeta {
  const m = db();
  const runId = randomBytes(9).toString('base64url');
  const hash = input.hash ?? runHash(input.deck, input.actions);
  // key order is load-bearing: `actions` LAST (see the header)
  const row = {
    runId, challengeId: input.challengeId, user: input.user, name: input.name, at: input.at,
    deck: input.deck, score: input.score, engine: input.engine, hash, actions: input.actions,
  };
  const lead = m.ragged ? '\n' : '';
  const line = `${lead}${JSON.stringify(row)}\n`;
  mkdirSync(dir(), { recursive: true });
  appendFileSync(runsFile(), line);
  const off = m.size + lead.length;
  const bytes = Buffer.byteLength(line);
  m.size += bytes;
  m.ragged = false;
  const meta: RunMeta = {
    runId, challengeId: row.challengeId, user: row.user, name: row.name, at: row.at, deck: row.deck,
    score: row.score, engine: row.engine, off, len: bytes - lead.length - 1, hash,
  };
  index(m, meta);
  return meta;
}

/** A whole run, its log read off disk; null for an unknown id. */
export function runById(runId: string): RunRow | null {
  const meta = db().byId.get(runId);
  if (!meta) return null;
  let fd: number | null = null;
  try {
    fd = openSync(runsFile(), 'r');
    const buf = Buffer.alloc(meta.len);
    readSync(fd, buf, 0, meta.len, meta.off);
    const r = JSON.parse(buf.toString('utf8')) as RunRow;
    return r.runId === runId ? r : null;
  } catch (err) {
    console.error(`[challenges] could not read run ${runId}:`, err);
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** the account id behind a run (the run route's owner check) */
export const runOwner = (runId: string): string | null => db().byId.get(runId)?.user ?? null;
export const runMeta = (runId: string): Omit<RunMeta, 'off' | 'len' | 'hash'> | null => db().byId.get(runId) ?? null;

/** how many distinct players have a run on this challenge */
export function entrants(challengeId: string): number {
  return new Set((db().byChallenge.get(challengeId) ?? []).map(r => r.user)).size;
}

// ── ranking ───────────────────────────────────────────────────────────

/** <0 when `a` ranks above `b` in category `by`: the category, then skill,
 * then the earlier run (then the run id, so the order is total). */
export function compareRuns(a: { score: RunScore; at: number; runId: string }, b: { score: RunScore; at: number; runId: string }, by: Category): number {
  if (better(a.score, b.score, by)) return -1;
  if (better(b.score, a.score, by)) return 1;
  if (by !== 'skill') {
    if (better(a.score, b.score, 'skill')) return -1;
    if (better(b.score, a.score, 'skill')) return 1;
  }
  return a.at - b.at || (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0);
}

/** each player's best run for `by`, ranked; `before` keeps only runs stamped before it */
function ranked(challengeId: string, by: Category, before = Infinity): RunMeta[] {
  const best = new Map<string, RunMeta>();
  for (const r of db().byChallenge.get(challengeId) ?? []) {
    if (r.at >= before) continue;
    const cur = best.get(r.user);
    if (!cur || compareRuns(r, cur, by) < 0) best.set(r.user, r);
  }
  return [...best.values()].sort((a, b) => compareRuns(a, b, by));
}

/** the name a row shows: the account's name as every public view shows it
 * now (a guest who later names their account shows the new name), else the
 * name stamped on the run */
const shownName = (r: { user: string; name: string }): string => accountById(r.user)?.username ?? r.name;

function publicRow(r: RunMeta, rank: number, closed: boolean): BoardRow {
  return {
    rank, name: shownName(r), score: r.score, at: r.at,
    ...(closed ? { runId: r.runId, deck: r.deck } : {}),
  };
}

const stripFrozen = (r: FrozenRow): BoardRow => {
  const { user, ...row } = r;
  return { ...row, name: accountById(user)?.username ?? r.name };
};

/** a cap on what one board answer carries (a closed board carries decks) */
export const BOARD_ROWS = 200;

/**
 * The board for one challenge in one category, as anybody may see it: decks
 * and run ids only once the week has closed. `winner` is the frozen one, and
 * only on a closed week.
 */
export function board(def: ChallengeDef, by: Category, now: number): { id: string; by: Category; closed: boolean; rows: BoardRow[]; winner?: BoardRow } {
  const closed = isClosed(def, now);
  // a board asked for between the close and the sweep's next tick freezes it
  // there and then — the freeze's answer does not depend on when it runs
  if (closed) sweepChallenges(now, [def]);
  const rows = ranked(def.id, by).slice(0, BOARD_ROWS).map((r, i) => publicRow(r, i + 1, closed));
  const w = closed ? db().weeks.weeks[def.id]?.winner : null;
  return { id: def.id, by, closed, rows, ...(w ? { winner: stripFrozen(w) } : {}) };
}

/** a player's rank in each category on the live board (0 = no run) */
export function ranksOf(challengeId: string, user: string): Record<Category, number> {
  const out = {} as Record<Category, number>;
  for (const c of CATEGORIES) out[c] = ranked(challengeId, c).findIndex(r => r.user === user) + 1;
  return out;
}

/** a player's best run per category on one challenge (absent categories: no run) */
export function bestsOf(challengeId: string, user: string): Partial<Record<Category, { score: RunScore; at: number; runId: string }>> {
  const out: Partial<Record<Category, { score: RunScore; at: number; runId: string }>> = {};
  for (const r of db().byChallenge.get(challengeId) ?? []) {
    if (r.user !== user) continue;
    for (const c of CATEGORIES) {
      const cur = out[c];
      if (!cur || compareRuns(r, cur, c) < 0) out[c] = { score: r.score, at: r.at, runId: r.runId };
    }
  }
  return out;
}

/** every challenge this player has a run on → their best score per category */
export function mine(user: string): Record<string, Partial<Record<Category, RunScore>>> {
  const out: Record<string, Partial<Record<Category, RunScore>>> = {};
  const ids = new Set(db().runs.filter(r => r.user === user).map(r => r.challengeId));
  for (const id of ids) {
    const b = bestsOf(id, user);
    const row: Partial<Record<Category, RunScore>> = {};
    for (const c of CATEGORIES) { const x = b[c]; if (x) row[c] = x.score; }
    out[id] = row;
  }
  return out;
}

// ── the week close ────────────────────────────────────────────────────

export const frozenWeek = (id: string): FrozenWeek | null => db().weeks.weeks[id] ?? null;

/** Freeze one closed week if it is not frozen yet. True when it wrote. */
function freeze(def: ChallengeDef, now: number): boolean {
  const m = db();
  if (m.weeks.weeks[def.id] || !isClosed(def, now)) return false;
  const { closes } = weekWindow(def);
  const top = {} as Record<Category, FrozenRow[]>;
  for (const c of CATEGORIES) {
    top[c] = ranked(def.id, c, closes).slice(0, FROZEN_TOP).map((r, i) => ({
      rank: i + 1, name: shownName(r), score: r.score, at: r.at, runId: r.runId, deck: r.deck, user: r.user,
    }));
  }
  m.weeks.weeks[def.id] = { closedAt: closes, frozenAt: now, winner: top.skill[0] ?? null, top };
  return true;
}

/**
 * The server's sweep (main.ts, on the expiry tick, throttled): freeze every
 * closed week that is not frozen yet — so a server that was down across one
 * or more Sundays catches up on its next tick — and write once. Idempotent:
 * a frozen week is never rewritten. Returns the ids it froze.
 */
export function sweepChallenges(now: number, rows: readonly ChallengeDef[] = CHALLENGES): string[] {
  const done: string[] = [];
  for (const def of rows) if (freeze(def, now)) done.push(def.id);
  if (done.length) {
    persistWeeks(db());
    console.log(`[challenges] froze ${done.join(', ')}`);
  }
  return done;
}

/** for the tests: does the store's directory hold a weeks.json yet */
export const weeksFileExists = (): boolean => existsSync(weeksFile());
/** for the tests: bytes on disk in runs.jsonl */
export const runsFileSize = (): number => { try { return statSync(runsFile()).size; } catch { return 0; } };
