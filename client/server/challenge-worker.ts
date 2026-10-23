/* WEEKLY CHALLENGES — the verifier, OFF the main thread (docs/21).
 *
 * A submitted run is replayed whole through the engine's `verifyRun`: thousands
 * of actions at a few milliseconds each. On the main loop that would freeze
 * every live game for the length of the replay, so it never runs there. This
 * one file is both halves:
 *
 *   - in a `worker_threads` Worker (workerData.role === ROLE) it imports the
 *     engine and answers one job per message;
 *   - on the main thread it exports `verifyInWorker`, which keeps ONE such
 *     worker, feeds it one job at a time from a bounded queue, and kills and
 *     replaces it when a job runs past JOB_TIMEOUT_MS or the worker dies.
 *
 * ── HOW THE WORKER LOADS TYPESCRIPT ──────────────────────────────────────
 *
 * Nothing special: the server runs as `node main.ts` on Node ≥ 22.18 (deploy
 * README), whose built-in type stripping applies to a Worker's entry module
 * exactly as to the main one, so `new Worker(new URL(import.meta.url))` loads
 * this .ts file and its .ts imports directly. No loader, no build step.
 *
 * The worker is lazy: nothing starts it until the first run needs
 * verifying, so a server nobody submits to never pays for a second engine. It
 * is `unref`'d whenever it is idle so it never holds a process open.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { ChallengeDef, RunScore } from '../engine/src/challenge.ts';
import type { Action, CardName } from '../engine/src/types.ts';
import type { Walk } from './challenge-sigs.ts';

const ROLE = 'algomancy-challenge-verifier';

export interface VerifyJob { def: ChallengeDef; deck: unknown; actions: unknown; maxActions: number }
export type VerifyResult =
  /** `sigs`: the board's fingerprint after each of `actions` (challenge-sigs.ts) */
  | { ok: true; score: RunScore; deck: CardName[]; actions: Action[]; sigs: string[] }
  | { ok: false; error: string; at?: number };

/** A stored run walked again on THIS engine — Watch's verdict and the board's
 * "older rules" mark (challenge-resim.ts). The whole log, as Watch walks it. */
export interface ResimJob { def: ChallengeDef; deck: CardName[]; actions: Action[]; maxActions: number }
export type ResimResult = ({ ok: true } & Walk) | { ok: false; error: string };

type Job = { kind: 'verify'; job: VerifyJob } | { kind: 'resim'; job: ResimJob };
type Out = VerifyResult | ResimResult;

// ── the worker half ───────────────────────────────────────────────────

if (!isMainThread && (workerData as { role?: string } | null)?.role === ROLE && parentPort) {
  const port = parentPort;
  const ch = await import('../engine/src/challenge.ts');
  const ap = await import('../engine/src/apply.ts');
  const { walkRun } = await import('./challenge-sigs.ts');
  const eng = {
    verifyRun: ch.verifyRun, checkChallengeDeck: ch.checkChallengeDeck, challengeDeal: ch.challengeDeal,
    DUMMY_DECK: ch.DUMMY_DECK, createGame: ap.createGame, apply: ap.apply,
  } as unknown as import('./challenge-sigs.ts').WalkEngine;
  port.on('message', (msg: { id: number } & Job) => {
    let out: Out;
    if (msg.kind === 'resim') {
      try {
        out = { ok: true, ...walkRun(eng, msg.job.def, msg.job.deck, msg.job.actions, { maxActions: msg.job.maxActions, full: true }) };
      } catch (err) {
        out = { ok: false, error: `the run could not be replayed: ${err instanceof Error ? err.message : String(err)}` };
      }
      port.postMessage({ id: msg.id, out });
      return;
    }
    try {
      // one pass: verifyRun's own walk, fingerprinted as it goes
      const w = Array.isArray(msg.job.actions)
        ? walkRun(eng, msg.job.def, msg.job.deck, msg.job.actions, { maxActions: msg.job.maxActions, full: false })
        : null;
      if (!w) {
        out = { ok: false, error: 'the run must be a list of actions' };
      } else if (w.verify.ok) {
        const d = ch.checkChallengeDeck(msg.job.deck);
        out = d.ok
          ? { ok: true, score: w.verify.score, deck: d.cards, actions: (msg.job.actions as Action[]).slice(0, w.verify.n), sigs: w.sigs }
          : { ok: false, error: d.error };
      } else {
        out = { ok: false, error: w.verify.error, ...(w.verify.at !== undefined ? { at: w.verify.at } : {}) };
      }
    } catch (err) {
      out = { ok: false, error: `the run could not be replayed: ${err instanceof Error ? err.message : String(err)}` };
    }
    port.postMessage({ id: msg.id, out });
  });
}

// ── the main-thread half ──────────────────────────────────────────────

/** a replay that takes longer than this is abandoned and its worker replaced */
export const JOB_TIMEOUT_MS = 180_000;
/** jobs waiting behind the running one; past this a submit is told to retry */
export const MAX_QUEUED = 16;

interface Pending { id: number; job: Job; resolve: (r: Out) => void }

/**
 * Three lanes, served in this order: a SUBMISSION (a player is waiting on
 * their score), then a WATCH (a player is waiting on a replay to open), then
 * the BACKGROUND re-simulations behind the board's "older rules" mark. One
 * worker, one job at a time: a submission waits at most for the one job
 * already running, never behind a backlog of re-simulations.
 */
export type Lane = 'watch' | 'background';
let worker: Worker | null = null;
let running: (Pending & { timer: NodeJS.Timeout; w: Worker }) | null = null;
const queue: Pending[] = [];
const watchQueue: Pending[] = [];
const backQueue: Pending[] = [];
let nextId = 1;

function spawn(): Worker {
  const w = new Worker(new URL(import.meta.url), {
    workerData: { role: ROLE },
    // one engine and one replay; a runaway log should hit this, not the box
    resourceLimits: { maxOldGenerationSizeMb: 512 },
  });
  w.on('message', (msg: { id: number; out: Out }) => {
    if (!running || running.w !== w || msg.id !== running.id) return;
    finish(msg.out);
  });
  w.on('error', err => {
    console.error('[challenges] verifier crashed:', err);
    if (worker === w) worker = null;
    // only the job THIS worker was running: a replaced worker's late death
    // must not fail the job its successor is on
    if (running?.w === w) finish({ ok: false, error: 'the verifier crashed on this run' });
  });
  w.on('exit', code => {
    if (worker === w) worker = null;
    if (running?.w === w) finish({ ok: false, error: `the verifier stopped (exit ${code})` });
  });
  return w;
}

function finish(out: Out): void {
  const r = running;
  if (!r) return;
  clearTimeout(r.timer);
  running = null;
  r.resolve(out);
  pump();
}

function pump(): void {
  if (running) return;
  const next = queue.shift() ?? watchQueue.shift() ?? backQueue.shift();
  if (!next) { worker?.unref(); return; }
  if (!worker) worker = spawn();
  const w = worker;
  w.ref();
  const timer = setTimeout(() => {
    console.error(`[challenges] verifier took over ${JOB_TIMEOUT_MS} ms; replacing it`);
    if (worker === w) worker = null;
    finish({ ok: false, error: 'the run took too long to check' });
    void w.terminate();
  }, JOB_TIMEOUT_MS);
  running = { ...next, timer, w };
  w.postMessage({ id: next.id, ...next.job });
}

/** Verify a run off the main thread. Never rejects: every failure is a result. */
export function verifyInWorker(job: VerifyJob): Promise<VerifyResult> {
  if (queue.length >= MAX_QUEUED) {
    return Promise.resolve({ ok: false, error: 'the server is busy checking other runs; try again in a minute' });
  }
  return new Promise(resolve => {
    queue.push({ id: nextId++, job: { kind: 'verify', job }, resolve: resolve as (r: Out) => void });
    pump();
  });
}

/** Walk a stored run again on this engine, off the main thread. Never rejects. */
export function resimInWorker(job: ResimJob, lane: Lane): Promise<ResimResult> {
  return new Promise(resolve => {
    (lane === 'watch' ? watchQueue : backQueue).push({ id: nextId++, job: { kind: 'resim', job }, resolve: resolve as (r: Out) => void });
    pump();
  });
}

/** Tests and shutdown: stop the worker (queued jobs are failed). */
export async function stopChallengeWorker(): Promise<void> {
  for (const p of [...queue.splice(0), ...watchQueue.splice(0), ...backQueue.splice(0)]) p.resolve({ ok: false, error: 'the verifier stopped' });
  const w = worker;
  worker = null;
  if (running) finish({ ok: false, error: 'the verifier stopped' });
  if (w) await w.terminate();
}
