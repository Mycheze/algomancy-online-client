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
 *                — rewritten atomically (temp file + rename, the
 *                pattern league-store.ts and accounts.ts use).
 *   sigs.jsonl   APPEND-ONLY, one line per fingerprinted run:
 *                {runId, engine, sigs} — the board's fingerprint after every
 *                action of the run, on the engine that verified it
 *                (challenge-sigs.ts). Written by the verifier at submission,
 *                and by the backfill tool (challenge-sigs-backfill.ts) for a
 *                run verified before fingerprints were kept — which is why it
 *                is its own file and not a field on the run's line: runs.jsonl
 *                is never rewritten. Like a run's score, a recorded fingerprint
 *                is NEVER recomputed; the first line for a run wins.
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
 *
 * ── FOUR BOARDS, THREE FIRST PLACES ──────────────────────────────────────
 *
 * Each board ranks the same stamped scores its own way (the engine's
 * `compareScores`): fastest, leanest, purest — each with a week winner — and
 * overall, a view with no trophy. Ties go to the earlier run. A player's entry
 * on a board is their best run FOR THAT BOARD, so one player can stand on
 * the boards with different runs. Nothing is recomputed: a re-ranking is a
 * re-sort of what was stamped. (2026-10-21 to -23 it was one board, by Skill.)
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
  BOARD_KINDS, TROPHY_KINDS, compareScores, type BoardKind, type ChallengeDef, type RunScore,
} from '../engine/src/challenge.ts';
import type { Action, CardName } from '../engine/src/types.ts';
import { accountById } from './accounts.ts';
import { CHALLENGES, isClosed, weekWindow } from './challenges.ts';
import { challengesDir } from './statepaths.ts';
import { parseSigsIndex, readSigsLine, type SigsRow } from './challenge-sigs.ts';

export type { SigsRow };

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
  /** the run no longer reproduces on today's rules (challenge-resim.ts); its
   * score and rank stand. Absent when it does, or is not worked out yet. */
  older?: true;
}

/** a frozen row: the public row plus whose it was (kept, never sent) */
interface FrozenRow extends BoardRow { user: string; runId: string; deck: CardName[] }

export interface FrozenWeek {
  /** epoch ms the week closed (its calendar boundary, not when the sweep ran) */
  closedAt: number;
  /** when the sweep wrote it */
  frozenAt: number;
  /** each board's first FROZEN_TOP rows at the close; a trophy board's
   * winner is its first row */
  boards: Record<BoardKind, FrozenRow[]>;
}

/** version 3: a top ten per board. Version 2 kept one board by Skill, and
 * version 1 a board per metric; neither froze a week on the live server (the
 * first week closed under version 3), and an older file is not read. */
interface WeeksFile { version: 3; weeks: Record<string, FrozenWeek> }

/** rows kept when a week freezes */
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
      || typeof r.at !== 'number' || typeof r.score?.raw !== 'number' || !Array.isArray(r.deck)) return null;
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
  const m: Mem = { runs: [], byId: new Map(), byChallenge: new Map(), size: 0, ragged: false, weeks: { version: 3, weeks: {} } };
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
    // an older shape is not read: nothing deployed ever wrote one, and the
    // sweep refreezes a closed week from runs.jsonl
    if (raw && raw.version === 3 && typeof raw.weeks === 'object' && raw.weeks) m.weeks = { version: 3, weeks: raw.weeks };
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
export function loadChallengeStore(): void { mem = null; sigMem = null; db(); }

/** Tests only: point the store at a throwaway directory. Returns a restore function. */
export function useChallengeDir(path: string): () => void {
  const prev = dirOverride;
  dirOverride = path;
  loadChallengeStore();
  return () => { dirOverride = prev; mem = null; sigMem = null; };
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

// ── fingerprints (sigs.jsonl) ─────────────────────────────────────────

const sigsFile = (): string => join(dir(), 'sigs.jsonl');

/** fingerprinted runs: runId → where its line is. The fingerprints themselves
 * stay on disk (a long run's are hundreds of KB), as a run's log does. */
interface SigMem { at: Map<string, { off: number; len: number }>; size: number; mtime: number }
let sigMem: SigMem | null = null;

/**
 * The index, current with the file on disk. Re-read whenever the file's size
 * or mtime moved under us: the backfill's output is appended (or uploaded) by
 * an operator while the server runs, and a run it fingerprinted must not go
 * on reading "unverified" until a restart.
 */
function sigDb(): SigMem {
  let st: { size: number; mtimeMs: number } | null = null;
  try { st = statSync(sigsFile()); } catch { /* no fingerprints yet */ }
  const size = st?.size ?? 0, mtime = st?.mtimeMs ?? 0;
  if (sigMem && sigMem.size === size && sigMem.mtime === mtime) return sigMem;
  let buf: Buffer = Buffer.alloc(0);
  try { buf = readFileSync(sigsFile()); } catch { /* none */ }
  sigMem = { at: parseSigsIndex(buf), size, mtime };
  return sigMem;
}

/** Is this run fingerprinted? */
export const hasSigs = (runId: string): boolean => sigDb().at.has(runId);

/** A run's recorded fingerprints, or null. */
export function sigsOf(runId: string): SigsRow | null {
  const where = sigDb().at.get(runId);
  if (!where) return null;
  let fd: number | null = null;
  try {
    fd = openSync(sigsFile(), 'r');
    const buf = Buffer.alloc(where.len);
    readSync(fd, buf, 0, where.len, where.off);
    const r = readSigsLine(buf);
    return r && r.runId === runId ? r : null;
  } catch (err) {
    console.error(`[challenges] could not read the fingerprints of ${runId}:`, err);
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * Record a run's fingerprints. Never twice: a run that already has a line
 * keeps it (a recorded fingerprint is never recomputed). Throws if it could
 * not be written; the caller decides what that costs (a run without
 * fingerprints is shown as unverified, never refused).
 */
export function appendSigs(row: SigsRow): boolean {
  const m = sigDb();
  if (m.at.has(row.runId)) return false;
  mkdirSync(dir(), { recursive: true });
  let lead = '';
  try {
    const fd = openSync(sigsFile(), 'r');
    try {
      const st = statSync(sigsFile());
      if (st.size > 0) {
        const last = Buffer.alloc(1);
        readSync(fd, last, 0, 1, st.size - 1);
        if (last[0] !== 0x0a) lead = '\n';
      }
    } finally { closeSync(fd); }
  } catch { /* no file yet */ }
  appendFileSync(sigsFile(), `${lead}${JSON.stringify({ runId: row.runId, engine: row.engine, sigs: row.sigs })}\n`);
  sigMem = null;
  return true;
}

/** the account id behind a run (the run route's owner check) */
export const runOwner = (runId: string): string | null => db().byId.get(runId)?.user ?? null;
export const runMeta = (runId: string): Omit<RunMeta, 'off' | 'len' | 'hash'> | null => db().byId.get(runId) ?? null;

/** how many runs are stored on this challenge (the admin view) */
export const runCount = (challengeId: string): number => db().byChallenge.get(challengeId)?.length ?? 0;

/** how many distinct players have a run on this challenge */
export function entrants(challengeId: string): number {
  return new Set((db().byChallenge.get(challengeId) ?? []).map(r => r.user)).size;
}

// ── ranking ───────────────────────────────────────────────────────────

type Ranked = { score: RunScore; at: number; runId: string };

/** <0 when `a` ranks above `b` on board `kind`: the better score, then the
 * earlier run (then the run id, so the order is total) */
export function compareRuns(kind: BoardKind, a: Ranked, b: Ranked): number {
  return compareScores(kind, a.score, b.score)
    || a.at - b.at || (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0);
}

/** each player's best run for board `kind`, ranked; `before` keeps only runs stamped before it */
function ranked(challengeId: string, kind: BoardKind, before = Infinity): RunMeta[] {
  const best = new Map<string, RunMeta>();
  for (const r of db().byChallenge.get(challengeId) ?? []) {
    if (r.at >= before) continue;
    const cur = best.get(r.user);
    if (!cur || compareRuns(kind, r, cur) < 0) best.set(r.user, r);
  }
  return [...best.values()].sort((a, b) => compareRuns(kind, a, b));
}

/** the name a row shows: the account's name as every public view shows it
 * now (a guest who later names their account shows the new name), else the
 * name stamped on the run */
const shownName = (r: { user: string; name: string }): string => accountById(r.user)?.username ?? r.name;

/** is this run marked as played on older rules (challenge-resim.ts `olderRules`) */
export type OlderFlag = (runId: string) => boolean;

function publicRow(r: RunMeta, rank: number, closed: boolean, flag?: OlderFlag): BoardRow {
  return {
    rank, name: shownName(r), score: r.score, at: r.at,
    ...(closed ? { runId: r.runId, deck: r.deck } : {}),
    ...(flag?.(r.runId) ? { older: true as const } : {}),
  };
}

const stripFrozen = (r: FrozenRow, flag?: OlderFlag): BoardRow => {
  const { user, ...row } = r;
  return { ...row, name: accountById(user)?.username ?? r.name, ...(flag?.(r.runId) ? { older: true as const } : {}) };
};

/** a cap on what one board answer carries (a closed board carries decks) */
export const BOARD_ROWS = 200;

export interface BoardReply {
  id: string;
  closed: boolean;
  boards: Record<BoardKind, BoardRow[]>;
  /** only on a closed week: the frozen first place of each trophy board */
  winners?: Partial<Record<BoardKind, BoardRow>>;
}

const perBoard = <T>(f: (kind: BoardKind) => T): Record<BoardKind, T> =>
  Object.fromEntries(BOARD_KINDS.map(k => [k, f(k)])) as Record<BoardKind, T>;

/**
 * The boards for one challenge, as anybody may see them: decks and run ids
 * only once the week has closed. `winners` are the frozen ones, and only on a
 * closed week.
 */
export function board(def: ChallengeDef, now: number, flag?: OlderFlag): BoardReply {
  const closed = isClosed(def, now);
  // a board asked for between the close and the sweep's next tick freezes it
  // there and then — the freeze's answer does not depend on when it runs
  if (closed) sweepChallenges(now, [def]);
  const boards = perBoard(k => ranked(def.id, k).slice(0, BOARD_ROWS).map((r, i) => publicRow(r, i + 1, closed, flag)));
  const fw = closed ? db().weeks.weeks[def.id] : null;
  const winners: Partial<Record<BoardKind, BoardRow>> = {};
  if (fw) for (const k of TROPHY_KINDS) { const w = fw.boards[k]?.[0]; if (w) winners[k] = stripFrozen(w, flag); }
  return { id: def.id, closed, boards, ...(fw ? { winners } : {}) };
}

/** a player's best run on one board, and its rank there (rank 0 = no run) */
export interface MyBest { score: RunScore; rank: number }

/** a player's best on each board of one challenge, or null for no run */
export function bestOf(challengeId: string, user: string): Record<BoardKind, MyBest> | null {
  if (!(db().byChallenge.get(challengeId) ?? []).some(r => r.user === user)) return null;
  return perBoard(k => {
    const list = ranked(challengeId, k);
    const i = list.findIndex(r => r.user === user);
    return { score: list[i]!.score, rank: i + 1 };
  });
}

/** every challenge this player has a run on → their best on each board */
export function mine(user: string): Record<string, Record<BoardKind, MyBest>> {
  const out: Record<string, Record<BoardKind, MyBest>> = {};
  const ids = new Set(db().runs.filter(r => r.user === user).map(r => r.challengeId));
  for (const id of ids) { const b = bestOf(id, user); if (b) out[id] = b; }
  return out;
}

// ── the week close ────────────────────────────────────────────────────

export const frozenWeek = (id: string): FrozenWeek | null => db().weeks.weeks[id] ?? null;

/** Freeze one closed week if it is not frozen yet. True when it wrote. */
function freeze(def: ChallengeDef, now: number): boolean {
  const m = db();
  if (m.weeks.weeks[def.id] || !isClosed(def, now)) return false;
  const { closes } = weekWindow(def);
  const boards = perBoard(k => ranked(def.id, k, closes).slice(0, FROZEN_TOP).map((r, i): FrozenRow => ({
    rank: i + 1, name: shownName(r), score: r.score, at: r.at, runId: r.runId, deck: r.deck, user: r.user,
  })));
  m.weeks.weeks[def.id] = { closedAt: closes, frozenAt: now, boards };
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
