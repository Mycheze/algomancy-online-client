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

const ROLE = 'algomancy-challenge-verifier';

export interface VerifyJob { def: ChallengeDef; deck: unknown; actions: unknown; maxActions: number }
export type VerifyResult =
  | { ok: true; score: RunScore; deck: CardName[]; actions: Action[] }
  | { ok: false; error: string; at?: number };

// ── the worker half ───────────────────────────────────────────────────

if (!isMainThread && (workerData as { role?: string } | null)?.role === ROLE && parentPort) {
  const port = parentPort;
  const { verifyRun, checkChallengeDeck } = await import('../engine/src/challenge.ts');
  port.on('message', (msg: { id: number; job: VerifyJob }) => {
    let out: VerifyResult;
    try {
      const r = verifyRun(msg.job.def, msg.job.deck, msg.job.actions, { maxActions: msg.job.maxActions });
      if (r.ok) {
        const d = checkChallengeDeck(msg.job.deck);
        out = d.ok ? { ok: true, score: r.score, deck: d.cards, actions: r.actions } : { ok: false, error: d.error };
      } else {
        out = { ok: false, error: r.error, ...(r.at !== undefined ? { at: r.at } : {}) };
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

interface Pending { id: number; job: VerifyJob; resolve: (r: VerifyResult) => void }

let worker: Worker | null = null;
let running: (Pending & { timer: NodeJS.Timeout; w: Worker }) | null = null;
const queue: Pending[] = [];
let nextId = 1;

function spawn(): Worker {
  const w = new Worker(new URL(import.meta.url), {
    workerData: { role: ROLE },
    // one engine and one replay; a runaway log should hit this, not the box
    resourceLimits: { maxOldGenerationSizeMb: 512 },
  });
  w.on('message', (msg: { id: number; out: VerifyResult }) => {
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

function finish(out: VerifyResult): void {
  const r = running;
  if (!r) return;
  clearTimeout(r.timer);
  running = null;
  r.resolve(out);
  pump();
}

function pump(): void {
  if (running) return;
  const next = queue.shift();
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
  w.postMessage({ id: next.id, job: next.job });
}

/** Verify a run off the main thread. Never rejects: every failure is a result. */
export function verifyInWorker(job: VerifyJob): Promise<VerifyResult> {
  if (queue.length >= MAX_QUEUED) {
    return Promise.resolve({ ok: false, error: 'the server is busy checking other runs; try again in a minute' });
  }
  return new Promise(resolve => {
    queue.push({ id: nextId++, job, resolve });
    pump();
  });
}

/** Tests and shutdown: stop the worker (queued jobs are failed). */
export async function stopChallengeWorker(): Promise<void> {
  for (const p of queue.splice(0)) p.resolve({ ok: false, error: 'the verifier stopped' });
  const w = worker;
  worker = null;
  if (running) finish({ ok: false, error: 'the verifier stopped' });
  if (w) await w.terminate();
}
