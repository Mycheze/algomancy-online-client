/* The admin dashboard's CHALLENGES view: every calendar row, upcoming ones
 * included (owner, 2026-10-24: "I'd like to be able to see the upcoming
 * challenges in an admin tab").
 *
 * The data half; the route is api-admin.ts (`GET /api/admin/challenges`, behind
 * the same adminFor 404 as every other admin route) and the page ui/admin.ts.
 *
 * ⚠ THIS IS THE ONLY ROUTE THAT NAMES A ROW BEFORE ITS WEEK OPENS. The public
 * API (api-challenge.ts) answers with the open week and the closed ones only,
 * and 404s a board, run or submission for a row that has not opened. That is
 * unchanged; an upcoming row's title, goal and seed reach a browser only
 * through here, and only an admin's.
 *
 * ── THE REFERENCE RUN'S NUMBERS ARE THE ENGINE'S ─────────────────────────
 *
 * Each row's reference run (challenge-runs/<id>.json) is walked by the
 * engine's own verifyRun, in the verifier worker (challenge-worker.ts — a walk
 * takes seconds, and never on the main loop), on the BACKGROUND lane, behind
 * any player's submission or Watch. The answer is cached for the life of the
 * process: the file is committed source and the engine cannot change under a
 * running server, so a deploy (a restart) is the only thing that can move it.
 * A run that no longer verifies is shown as such — that is a row whose par is
 * now a claim about older rules, which test 506 would also say.
 *
 * The route waits a moment for the walks, then answers with whatever is done;
 * a row still being walked says `pending`, and the next refresh has it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChallengeDef, ChallengeSetup, Goal, RunScore } from '../engine/src/challenge.ts';
import type { Action, CardName } from '../engine/src/types.ts';
import { CHALLENGES, REFERENCE_RUNS_DIR, WEEK_MS, hasOpened, isClosed, weekWindow } from './challenges.ts';
import { entrants, runCount } from './challenge-store.ts';
import { resimInWorker } from './challenge-worker.ts';

export type RefResult =
  | { state: 'ok'; score: RunScore; actions: number }
  | { state: 'failed'; error: string; at?: number }
  | { state: 'missing' }
  | { state: 'pending' };

export interface AdminChallengeRow {
  id: string; week: string; title: string; blurb: string; goal: Goal; seed: number; par: number;
  /** what the row changes about the deal (the dummy's life, an emblem), when anything */
  setup?: ChallengeSetup;
  /** epoch ms, UTC */
  opens: number; closes: number;
  status: 'closed' | 'open' | 'upcoming';
  /** upcoming only: whole days until it opens, rounded up */
  opensInDays?: number;
  /** the reference run on this engine */
  ref: RefResult;
  /** opened rows only: runs stored, and distinct players behind them */
  runs?: number; players?: number;
}

export interface AdminChallenges {
  now: number;
  /** the open row, then the upcoming ones in calendar order, then the closed
   * ones newest first */
  rows: AdminChallengeRow[];
  /** the last row's close, or null for an empty calendar */
  runsOutAt: number | null;
  /** whole weeks from now until the last row closes (0 once it has) */
  weeksLeft: number;
  /** rows that have not opened yet */
  upcoming: number;
}

/** the cap a stored run is checked under (api-challenge.ts MAX_ACTIONS) */
const MAX_ACTIONS = 20_000;
/** how long the route waits for reference walks before answering without them */
export const REF_WAIT_MS = 2_000;

const refs = new Map<string, { done: RefResult | null; p: Promise<RefResult> }>();

function walkReference(def: ChallengeDef): Promise<RefResult> {
  const file = join(REFERENCE_RUNS_DIR, `${def.id}.json`);
  if (!existsSync(file)) return Promise.resolve({ state: 'missing' });
  let ref: { deck?: unknown; actions?: unknown };
  try { ref = JSON.parse(readFileSync(file, 'utf8')) as typeof ref; }
  catch (err) { return Promise.resolve({ state: 'failed', error: `the file is not JSON: ${String(err)}` }); }
  if (!Array.isArray(ref.deck) || !Array.isArray(ref.actions)) {
    return Promise.resolve({ state: 'failed', error: 'the file has no deck or no actions' });
  }
  return resimInWorker(
    { def, deck: ref.deck as CardName[], actions: ref.actions as Action[], maxActions: MAX_ACTIONS }, 'background',
  ).then((r): RefResult => {
    if (!r.ok) return { state: 'failed', error: r.error };
    const v = r.verify;
    return v.ok ? { state: 'ok', score: v.score, actions: v.n }
      : { state: 'failed', error: v.error, ...(v.at !== undefined ? { at: v.at } : {}) };
  }, (err: unknown): RefResult => ({ state: 'failed', error: String(err) }));
}

/** the row's reference walk, started once per process */
function refOf(def: ChallengeDef): { done: RefResult | null; p: Promise<RefResult> } {
  let e = refs.get(def.id);
  if (!e) {
    const entry: { done: RefResult | null; p: Promise<RefResult> } = { done: null, p: Promise.resolve({ state: 'pending' }) };
    entry.p = walkReference(def).then(r => { entry.done = r; return r; });
    refs.set(def.id, e = entry);
  }
  return e;
}

/** Tests: wait for every reference walk started so far. */
export async function settleReferenceRuns(): Promise<void> {
  await Promise.all([...refs.values()].map(e => e.p));
}
/** Tests: forget every reference walk. */
export function resetReferenceRuns(): void { refs.clear(); }

const DAY_MS = 86_400_000;

/** The view. Waits up to `waitMs` for the reference walks it starts. */
export async function adminChallenges(
  now: number, rows: readonly ChallengeDef[] = CHALLENGES, waitMs = REF_WAIT_MS,
): Promise<AdminChallenges> {
  const entries = rows.map(refOf);
  if (entries.some(e => !e.done) && waitMs > 0) {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all(entries.map(e => e.p)),
      new Promise<void>(r => { timer = setTimeout(r, waitMs); }),
    ]);
    clearTimeout(timer);
  }
  const out: AdminChallengeRow[] = rows.map((def, i) => {
    const { opens, closes } = weekWindow(def);
    const status = isClosed(def, now) ? 'closed' : hasOpened(def, now) ? 'open' : 'upcoming';
    return {
      id: def.id, week: def.week, title: def.title, blurb: def.blurb, goal: def.goal, seed: def.seed, par: def.par,
      ...(def.setup ? { setup: def.setup } : {}),
      opens, closes, status,
      ...(status === 'upcoming' ? { opensInDays: Math.ceil((opens - now) / DAY_MS) } : {}),
      ref: entries[i]!.done ?? { state: 'pending' },
      ...(status !== 'upcoming' ? { runs: runCount(def.id), players: entrants(def.id) } : {}),
    };
  });
  const rank = (r: AdminChallengeRow): number => (r.status === 'open' ? 0 : r.status === 'upcoming' ? 1 : 2);
  out.sort((a, b) => rank(a) - rank(b) || (a.status === 'closed' ? b.opens - a.opens : a.opens - b.opens));
  const runsOutAt = rows.length ? Math.max(...rows.map(d => weekWindow(d).closes)) : null;
  return {
    now,
    rows: out,
    runsOutAt,
    weeksLeft: runsOutAt === null ? 0 : Math.max(0, Math.ceil((runsOutAt - now) / WEEK_MS)),
    upcoming: out.filter(r => r.status === 'upcoming').length,
  };
}
