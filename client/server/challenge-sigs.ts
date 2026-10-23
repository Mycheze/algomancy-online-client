/* WEEKLY CHALLENGES — a run's per-action FINGERPRINTS (docs/21 "Watch").
 *
 * Watch replays a stored run on the LIVE engine. A run is a claim — deck +
 * actions reproduces this game — and the claim was checked by the engine
 * that verified it, not by today's. When the rules change between the two,
 * the log still walks, mostly legally, into a DIFFERENT game (measured
 * 2026-10-23: the week's top run parted at action 44 and 21 of 112 actions
 * were refused). So, exactly as BL-38 does for saved games (rooms.ts `sigs`,
 * api-replay.ts): the verifier records `digest(signature(state))` after every
 * action of the run it accepted, and Watch compares today's walk against it.
 *
 * ── ONE WALK, TWO ENGINES ────────────────────────────────────────────────
 *
 * `walkRun` takes the engine as ARGUMENTS rather than importing it, because it
 * runs against two kinds of engine:
 *
 *   · the live one — the verifier worker at submission, and the re-simulation
 *     behind Watch and the board's "older rules" mark (challenge-worker.ts);
 *   · a CHECKOUT of the engine a run was recorded on — the backfill
 *     (challenge-sigs-backfill.ts), for runs verified before fingerprints
 *     were stored. Only that engine can say what the recorded game was.
 *
 * The SIGNATURE is always this tree's (replay-probe.ts), never the
 * checkout's: one projection on both ends of the comparison, the rule
 * replay-room.ts follows for the same reason.
 *
 * The walk is verifyRun's own: its `onStep` hook fingerprints the boards it
 * applies, so what is stored is the game that was verified, in the same pass.
 * An engine older than that hook (e201f89) never calls it; the walk then
 * repeats verifyRun's deal and applies the log itself — the same game, which
 * the backfill's round-trip test (599) holds to the hooked path.
 *
 * Past the point where verifyRun stops (a refusal, a dummy move it no longer
 * makes, the goal met sooner) the walk goes on the way Watch does
 * (ui/replayserver.ts): a refused action is skipped and leaves `''`, the rest
 * apply. `''` against a recorded fingerprint is a disagreement, as in
 * api-replay.ts's `partedFrom`.
 */
import { digest, signature } from './replay-probe.ts';
import type { ChallengeDef, RunScore } from '../engine/src/challenge.ts';

/** the parts of an engine a walk needs — the live one's modules, or a checkout's */
export interface WalkEngine {
  verifyRun: (def: ChallengeDef, deck: unknown, actions: unknown,
    opts?: { maxActions?: number; onStep?: (i: number, after: unknown) => void }) =>
    { ok: true; score: RunScore; actions: unknown[] } | { ok: false; error: string; at?: number };
  checkChallengeDeck: (cards: unknown) => { ok: true; cards: string[] } | { ok: false; error: string };
  challengeDeal: (def: ChallengeDef) => unknown;
  DUMMY_DECK: readonly string[];
  createGame: (...args: unknown[]) => { state: unknown };
  apply: (state: unknown, action: unknown) => { state: unknown };
}

export type WalkVerify = { ok: true; score: RunScore; n: number } | { ok: false; error: string; at?: number };

export interface Walk {
  /** what verifyRun made of the log on this engine */
  verify: WalkVerify;
  /** one per action walked: the board after it, `''` where it was refused */
  sigs: string[];
  /** the first action this engine refused on the Watch walk, or null */
  refusedAt: number | null;
}

/** the seat names verifyRun deals with — the signature never reads them */
const NAMES = ['Challenger', 'Dummy'];

/**
 * Walk a run on `eng`. `full: false` stops where verifyRun stops (the
 * submission: only an accepted run's own actions are stored); `full: true`
 * walks every action given, as Watch does.
 */
export function walkRun(eng: WalkEngine, def: ChallengeDef, deck: unknown, actions: unknown[],
  opts: { maxActions?: number; full: boolean }): Walk {
  const sigs: string[] = [];
  let last: unknown = undefined;
  let lastI = -1;
  const v = eng.verifyRun(def, deck, actions, {
    ...(opts.maxActions !== undefined ? { maxActions: opts.maxActions } : {}),
    onStep: (i, after) => { sigs[i] = digest(signature(after)); last = after; lastI = i; },
  });
  const verify: WalkVerify = v.ok ? { ok: true, score: v.score, n: v.actions.length }
    : { ok: false, error: v.error, ...(v.at !== undefined ? { at: v.at } : {}) };
  // the hook covered what verifyRun applied; on an engine without it, nothing
  const hooked = lastI >= 0 || (v.ok && v.actions.length === 0);
  const want = opts.full ? actions.length : v.ok ? v.actions.length : 0;
  if (hooked && lastI + 1 >= want) return { verify, sigs: sigs.slice(0, want), refusedAt: null };

  let state: unknown;
  let from: number;
  if (hooked) {
    state = last; from = lastI + 1;
  } else {
    // no hook (an engine older than it), or verifyRun refused before applying
    // anything: verifyRun's own deal, then the log from the top
    sigs.length = 0;
    const check = eng.checkChallengeDeck(deck);
    if (!check.ok) return { verify, sigs: [], refusedAt: null };
    try {
      state = eng.createGame(def.seed, NAMES, 'constructed', undefined, [check.cards, [...eng.DUMMY_DECK]], undefined, eng.challengeDeal(def)).state;
    } catch {
      return { verify, sigs: [], refusedAt: null };
    }
    from = 0;
  }
  let refusedAt: number | null = null;
  for (let i = from; i < want; i++) {
    try {
      state = eng.apply(state, actions[i]).state;
      sigs[i] = digest(signature(state));
    } catch {
      sigs[i] = '';
      if (refusedAt === null) refusedAt = i;
    }
  }
  return { verify, sigs: sigs.slice(0, want), refusedAt };
}

/** a fingerprint as stored: 16 hex characters (replay-probe.ts `digest`), or `''` */
export const SIG = /^(?:[0-9a-f]{16})?$/;

/**
 * Where the live walk stops being the recorded game: the first action whose
 * recorded fingerprint it does not reproduce. Compared only where there IS a
 * recorded fingerprint — api-replay.ts's `partedFrom`, the same rule.
 */
export function partedAt(recorded: readonly string[], live: readonly string[]): number | null {
  for (let i = 0; i < recorded.length; i++) {
    const r = recorded[i];
    if (r && r !== live[i]) return i;
  }
  return null;
}

/** the same score, field for field, on every field the stamped one has */
export function sameScore(stamped: RunScore, live: RunScore): boolean {
  const a = stamped as unknown as Record<string, unknown>, b = live as unknown as Record<string, unknown>;
  return Object.keys(a).every(k => a[k] === b[k]);
}

// ── the stored form (var/challenges/sigs.jsonl; challenge-store.ts keeps it) ──

/** one line of sigs.jsonl: a run's fingerprints and the engine that made them */
export interface SigsRow { runId: string; engine: string; sigs: string[] }

/** one line, checked: a run id, an engine, and a list of 16-hex-or-empty strings */
export function readSigsLine(line: Buffer | string): SigsRow | null {
  try {
    const r = JSON.parse(line.toString()) as Partial<SigsRow>;
    if (typeof r.runId !== 'string' || typeof r.engine !== 'string' || !Array.isArray(r.sigs)) return null;
    if (!r.sigs.every(x => typeof x === 'string' && SIG.test(x))) return null;
    return { runId: r.runId, engine: r.engine, sigs: r.sigs };
  } catch {
    return null;
  }
}

/** A whole sigs.jsonl → runId → where its line is. The FIRST line for a run
 * wins: a recorded fingerprint is never replaced. */
export function parseSigsIndex(buf: Buffer): Map<string, { off: number; len: number }> {
  const at = new Map<string, { off: number; len: number }>();
  let start = 0;
  while (start < buf.length) {
    let end = buf.indexOf(0x0a, start);
    if (end < 0) end = buf.length;
    if (end > start) {
      const r = readSigsLine(buf.subarray(start, end));
      if (r && !at.has(r.runId)) at.set(r.runId, { off: start, len: end - start });
      else if (!r) console.error(`[challenges] sigs.jsonl: unreadable line at byte ${start}, skipped`);
    }
    start = end + 1;
  }
  return at;
}
