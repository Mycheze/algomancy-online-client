/* WEEKLY CHALLENGES — the calendar (docs/21-weekly-challenges.md).
 *
 * Committed data, one row per week, and the four questions everything else
 * asks of it: which week is open now, which have closed, when does a row's
 * week open and close, and which row is this id. Pure apart from `challengeNow`,
 * which is the one place "now" is read — so `ALGO_CHALLENGE_NOW` (an ISO date,
 * tests and dev only) moves the whole mode through time at once.
 *
 * A week opens Sunday 07:00 UTC and closes the next Sunday 07:00 UTC — the
 * league's boundary (league.ts), so the two never disagree about what "this
 * week" means. UTC on purpose: a challenge is global, and a local-time
 * boundary would move an hour twice a year.
 *
 * ⚠ A ROW IS A PROMISE ONCE ITS WEEK OPENS. Its goal and seed are what every
 * run on its board was verified against, and its par is what every stamped
 * Skill was divided by; changing any of them afterwards turns every stamped
 * score into a claim about a different puzzle. Add rows at the end; fix a row
 * only before its week opens.
 *
 * `par` is the row's reference run's raw score (challenge-runs/<id>.json —
 * cards × max(1, elements) × turns), so that run scores Skill 100. It is
 * written here by hand, not read off the file: the file can be re-solved, the
 * number on the board cannot move. Test 506 holds the two equal. `calendarProblems` (test 500)
 * checks the shape, not the history — git is the history.
 *
 * An id is a name, not a date. The calendar went live on Wednesday 2026-10-21
 * and the owner wanted the first puzzle playable that day, so every row was
 * moved a week earlier before any had opened (Full House: the week of
 * 10-18, closing Sunday 10-25). The ids, seeds, pars and reference runs kept
 * their original names; a new row may name its id after its own week.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChallengeDef } from '../engine/src/challenge.ts';

export const HOUR_MS = 3_600_000;
export const WEEK_MS = 7 * 24 * HOUR_MS;
/** the hour (UTC) on the Sunday a week opens and the next one closes */
export const OPEN_HOUR_UTC = 7;

/** `client/server/challenge-runs/<id>.json` — each row's reference run,
 * `{challengeId, deck, actions}`. Committed source, not runtime state; its
 * raw score is the row's `par` (test 506). */
export const REFERENCE_RUNS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'challenge-runs');

export const CHALLENGES: ChallengeDef[] = [
  {
    id: '2026-10-25-crowd', week: '2026-10-18', title: 'Full House',
    blurb: 'Fill your side of the table: have 60 units in play at the same time.',
    goal: { kind: 'unitsInPlay', n: 60 },
    seed: 20261025, par: 90,
  },
  {
    id: '2026-11-01-tokens', week: '2026-10-25', title: 'Token Gesture',
    blurb: 'Create 100 spell tokens.',
    goal: { kind: 'spellTokens', n: 100 },
    seed: 20261101, par: 104,
  },
  {
    id: '2026-11-08-giant', week: '2026-11-01', title: 'Something Big',
    blurb: 'Build a single unit that is at least 80/80.',
    goal: { kind: 'unitSize', p: 80, t: 80 },
    seed: 20261108, par: 70,
  },
  {
    id: '2026-11-15-counters', week: '2026-11-08', title: 'Counting Up',
    blurb: 'Put 100 +1/+1 counters on your units.',
    goal: { kind: 'counters', n: 100 },
    seed: 20261115, par: 81,
  },
  {
    id: '2026-11-22-parade', week: '2026-11-15', title: 'The Parade',
    blurb: 'Play 100 unit cards.',
    goal: { kind: 'unitsPlayed', n: 100 },
    seed: 20261122, par: 286,
  },
];

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "Now" for the challenge mode: `ALGO_CHALLENGE_NOW` when it is a date,
 * else the clock. Read on every call, so a test can move it in-process. */
export function challengeNow(): number {
  const o = process.env['ALGO_CHALLENGE_NOW'];
  if (o) {
    const t = Date.parse(o);
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

/** epoch ms of `YYYY-MM-DD` at 07:00 UTC, or NaN */
function weekStart(week: string): number {
  const m = DAY.exec(week);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), OPEN_HOUR_UTC);
}

export function weekWindow(def: ChallengeDef): { opens: number; closes: number } {
  const opens = weekStart(def.week);
  return { opens, closes: opens + WEEK_MS };
}

export function challengeById(id: unknown, rows: readonly ChallengeDef[] = CHALLENGES): ChallengeDef | null {
  return typeof id === 'string' ? rows.find(c => c.id === id) ?? null : null;
}

/** has this row's week begun? (open or closed — anything a run may be sent to) */
export const hasOpened = (def: ChallengeDef, now: number): boolean => now >= weekWindow(def).opens;
export const isClosed = (def: ChallengeDef, now: number): boolean => now >= weekWindow(def).closes;

/** the row whose window holds `now`, or null between rows / before the first */
export function currentChallenge(now: number, rows: readonly ChallengeDef[] = CHALLENGES): ChallengeDef | null {
  return rows.find(c => { const w = weekWindow(c); return now >= w.opens && now < w.closes; }) ?? null;
}

/** the closed rows, newest first */
export function pastChallenges(now: number, rows: readonly ChallengeDef[] = CHALLENGES): ChallengeDef[] {
  return rows.filter(c => isClosed(c, now)).sort((a, b) => weekWindow(b).opens - weekWindow(a).opens);
}

/** Every way the calendar is malformed, as sentences; [] when it is sound:
 * each `week` a real Sunday, strictly increasing (so no two windows overlap),
 * ids unique and URL-safe, a title and blurb, a whole-number seed and par. */
export function calendarProblems(rows: readonly ChallengeDef[] = CHALLENGES): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  let prev = -Infinity;
  for (const [i, c] of rows.entries()) {
    const at = `row ${i} (${c.id})`;
    if (!/^[a-z0-9-]{3,60}$/.test(c.id)) out.push(`${at}: id must be 3–60 of a-z, 0-9, -`);
    if (ids.has(c.id)) out.push(`${at}: duplicate id`);
    ids.add(c.id);
    const t = weekStart(c.week);
    const d = new Date(t);
    if (!Number.isFinite(t) || d.toISOString().slice(0, 10) !== c.week) out.push(`${at}: week ${c.week} is not a date`);
    else if (d.getUTCDay() !== 0) out.push(`${at}: week ${c.week} is not a Sunday`);
    if (!(t > prev)) out.push(`${at}: week ${c.week} does not come after the row before it`);
    if (Number.isFinite(t)) prev = t;
    if (!c.title.trim() || c.title.length > 40) out.push(`${at}: title must be 1–40 characters`);
    if (!c.blurb.trim() || c.blurb.length > 160) out.push(`${at}: blurb must be 1–160 characters`);
    if (!Number.isSafeInteger(c.seed)) out.push(`${at}: seed must be a whole number`);
    if (!Number.isSafeInteger(c.par) || c.par < 1) out.push(`${at}: par must be a whole number, 1 or more`);
  }
  return out;
}
