/* WEEKLY CHALLENGES — what THIS engine makes of a stored run (docs/21 "Watch").
 *
 * Two answers, from one re-simulation in the verifier worker (never on the
 * main loop), cached per run per engine:
 *
 *   · Watch's VERDICT — the BL-38 four facts, minus `forked` (a run is never
 *     rebuilt mid-game): `as-recorded` when every recorded fingerprint is
 *     reproduced, `reconstruction` from the first one that is not
 *     (`partedAt`), `unverified` when the run has no fingerprints to check
 *     against — never `as-recorded` on the strength of nothing. `refusedAt`
 *     is the first action this engine refuses, an upper bound on `partedAt`.
 *   · the board's OLDER-RULES MARK (owner, 2026-10-23: "Flag it, still
 *     ranked") — the run no longer reproduces MATERIALLY on this engine: it
 *     no longer verifies (an action refused, the dummy's move changed, the
 *     goal not met), or it meets the goal at another action, or for another
 *     score. The stamped score and rank stand; the mark says the rules moved.
 *     Derived, never a list of run ids. A COSMETIC parting (the board differs
 *     somewhere — the erased pile, say — and the run still verifies to the
 *     same score at the same action) is a reconstruction for Watch and NOT a
 *     mark.
 *
 * ── WHEN THE REPLAY IS SKIPPED ───────────────────────────────────────────
 *
 * A run stamped with THIS engine was verified by this engine: re-walking it
 * can only reproduce it (the engine is deterministic), so its mark is false
 * and its verdict is what its fingerprints say without a walk — as-recorded
 * when it has a full set, unverified when it has none. The fingerprints stay
 * the authority: a stamp alone never makes a run `as-recorded`.
 *
 * ── THE CACHE ────────────────────────────────────────────────────────────
 *
 * Keyed by the engine (a deploy must not serve the last engine's opinion —
 * engineVersion() cannot change under a running process, so that part is
 * implicit) and by whether the run has fingerprints (a backfill that lands
 * while the server runs must turn `unverified` into a real answer). A run's
 * deck, log and score never change. A failed re-simulation is cached too,
 * as "no answer": it would fail the same way again on this engine.
 */
import type { ChallengeDef } from '../engine/src/challenge.ts';
import { challengeById } from './challenges.ts';
import { hasSigs, runById, runMeta, sigsOf } from './challenge-store.ts';
import { partedAt as partedFrom, sameScore } from './challenge-sigs.ts';
import { resimInWorker, type Lane } from './challenge-worker.ts';
import { engineVersion } from './engine-version.ts';

export interface RunVerdict {
  verdict: 'as-recorded' | 'reconstruction' | 'unverified';
  partedAt: number | null;
  refusedAt: number | null;
  /** the run no longer reproduces materially on this engine (see the header) */
  older: boolean;
}

/** what a run is shown as when nothing could be worked out */
const UNKNOWN: RunVerdict = { verdict: 'unverified', partedAt: null, refusedAt: null, older: false };

const cache = new Map<string, { key: string; out: RunVerdict | null }>();
const pending = new Map<string, { key: string; p: Promise<RunVerdict | null> }>();

/** the cap a stored run was checked under (api-challenge.ts MAX_ACTIONS) */
const MAX_ACTIONS = 20_000;

/** a run's fingerprints are written once (the first line wins), so "has it
 * any" is all that can change — and the board asks this per row, per load,
 * without reading them */
const keyOf = (runId: string): string => `${engineVersion()}|${hasSigs(runId) ? 'sigs' : 'none'}`;

/** The verdict without a walk, when the run was stamped by this very engine. */
function sameEngine(runId: string, sigs: string[] | null, nActions: number): RunVerdict | null {
  const meta = runMeta(runId);
  if (!meta || meta.engine !== engineVersion()) return null;
  const complete = !!sigs && sigs.length === nActions && sigs.every(Boolean);
  return { verdict: complete ? 'as-recorded' : 'unverified', partedAt: null, refusedAt: null, older: false };
}

async function compute(runId: string, rows: readonly ChallengeDef[] | undefined, lane: Lane): Promise<RunVerdict | null> {
  const run = runById(runId);
  if (!run) return null;
  const sigs = sigsOf(runId)?.sigs ?? null;
  const quick = sameEngine(runId, sigs, run.actions.length);
  if (quick) return quick;
  const def = challengeById(run.challengeId, rows);
  if (!def) return null;
  const r = await resimInWorker({ def, deck: run.deck, actions: run.actions, maxActions: MAX_ACTIONS }, lane);
  if (!r.ok) {
    console.error(`[challenges] could not re-simulate run ${runId}: ${r.error}`);
    return null;
  }
  const older = !r.verify.ok || r.verify.n !== run.actions.length || !sameScore(run.score, r.verify.score);
  const recorded = sigs && sigs.length === run.actions.length ? sigs : null;
  const parted = recorded ? partedFrom(recorded, r.sigs) : null;
  // ⚠ EVERY action, or the claim is not available (api-replay.ts's rule): a
  // prefix of a record is not a record. A disagreement counts from whatever
  // part is covered.
  const complete = !!recorded && recorded.every(Boolean);
  return {
    verdict: parted !== null ? 'reconstruction' : complete ? 'as-recorded' : 'unverified',
    partedAt: parted,
    refusedAt: r.refusedAt,
    older,
  };
}

function start(runId: string, rows: readonly ChallengeDef[] | undefined, lane: Lane): Promise<RunVerdict | null> {
  const key = keyOf(runId);
  const hit = cache.get(runId);
  if (hit && hit.key === key) return Promise.resolve(hit.out);
  const inflight = pending.get(runId);
  if (inflight && inflight.key === key) return inflight.p;
  const p = compute(runId, rows, lane).catch(err => {
    console.error(`[challenges] re-simulating run ${runId} failed:`, err);
    return null;
  }).then(out => {
    cache.set(runId, { key, out });
    if (pending.get(runId)?.p === p) pending.delete(runId);
    return out;
  });
  pending.set(runId, { key, p });
  return p;
}

/** Watch: the run's verdict on this engine — waits for the re-simulation. */
export async function runVerdict(runId: string, rows?: readonly ChallengeDef[]): Promise<RunVerdict> {
  return (await start(runId, rows, 'watch')) ?? UNKNOWN;
}

/**
 * The board: is this run marked? Answers from the cache and never waits; a
 * run not worked out yet is queued in the background lane and reads unmarked
 * until it has been (the next load of the board has it).
 */
export function olderRules(runId: string, rows?: readonly ChallengeDef[]): boolean {
  const hit = cache.get(runId);
  if (hit && hit.key === keyOf(runId)) return !!hit.out?.older;
  void start(runId, rows, 'background');
  return false;
}

/** Tests: wait until every queued re-simulation has answered. */
export async function settleResims(): Promise<void> {
  while (pending.size) await Promise.all([...pending.values()].map(x => x.p));
}

/** Tests: forget every answer. Never called by the server. */
export function resetResimCache(): void { cache.clear(); pending.clear(); }
