/* THE JUDGE BOT'S CALCULATOR, OFF THE MAIN THREAD (simulate.ts).
 *
 * Copied from challenge-worker.ts's pattern, with tighter numbers because the
 * caller is a chat answer, not a submitted run: one lazy worker, one job at a
 * time, a short queue, and a hard wall clock after which the worker is killed
 * and replaced. One file is both halves:
 *
 *   - in a `worker_threads` Worker (workerData.role === ROLE) it imports the
 *     engine and answers one simulation per message;
 *   - on the main thread it exports `simulateInWorker`.
 *
 * ── THE CLOCK STARTS WHEN THE JOB DOES, NOT WHEN THE WORKER BOOTS ─────
 *
 * Importing the engine (every card set) takes about a second. A job posted
 * to a booting worker would spend that second of its 2 s budget waiting on
 * imports and then look slow. So the worker says `ready` once its imports are
 * done, and jobs are only posted — and only timed — after that. Booting has
 * its own, generous, deadline (BOOT_TIMEOUT_MS). `warmSimulator()` starts the
 * boot early; api-bot.ts calls it on /api/bot/health, which the bot polls
 * before it offers the tool, so the first real question does not pay for it.
 *
 * The worker is `unref`'d whenever it is idle so it never holds a process open.
 * Nothing here writes anything anywhere: no room, no var/ file (768 checks).
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { SimResult } from './simulate.ts';

const ROLE = 'algomancy-simulator';

/** a simulation that runs past this is abandoned and its worker replaced */
export const JOB_TIMEOUT_MS = 2000;
/** the engine import, once per worker */
export const BOOT_TIMEOUT_MS = 30_000;
/** jobs waiting behind the running one; past this the answer is "busy" */
export const MAX_QUEUED = 4;
/** one engine and one small game */
export const WORKER_HEAP_MB = 256;

interface Job { spec: unknown; engine: string; budgetMs?: number }

// ── the worker half ───────────────────────────────────────────────────

if (!isMainThread && (workerData as { role?: string } | null)?.role === ROLE && parentPort) {
  const port = parentPort;
  const { simulate } = await import('./simulate.ts');
  port.on('message', (msg: { id: number } & Job) => {
    let out: SimResult;
    try {
      out = simulate(msg.spec, { engine: msg.engine, ...(msg.budgetMs !== undefined ? { budgetMs: msg.budgetMs } : {}) });
    } catch (err) {
      out = { ok: false, error: `engine error: ${err instanceof Error ? err.message : String(err)}` };
    }
    port.postMessage({ id: msg.id, out });
  });
  port.postMessage({ ready: true });
}

// ── the main-thread half ──────────────────────────────────────────────

interface Pending { id: number; job: Job; resolve: (r: SimResult) => void }

let worker: Worker | null = null;
let ready = false;
let bootTimer: NodeJS.Timeout | null = null;
let running: (Pending & { timer: NodeJS.Timeout; w: Worker }) | null = null;
const queue: Pending[] = [];
let nextId = 1;
/** for tests: how many workers this process has started */
let spawned = 0;
/** JOB_TIMEOUT_MS, lowerable by a test so an ordinary job overruns it */
let jobTimeoutMs = JOB_TIMEOUT_MS;

function spawn(): Worker {
  spawned++;
  ready = false;
  const w = new Worker(new URL(import.meta.url), {
    workerData: { role: ROLE },
    resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
  });
  bootTimer = setTimeout(() => {
    console.error(`[simulate] worker did not boot within ${BOOT_TIMEOUT_MS} ms; replacing it`);
    if (worker === w) { worker = null; ready = false; }
    void w.terminate();
    failAll('the engine could not be started');
  }, BOOT_TIMEOUT_MS);
  w.on('message', (msg: { ready?: true; id?: number; out?: SimResult }) => {
    if (msg.ready) {
      if (worker !== w) return;
      if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
      ready = true;
      pump();
      return;
    }
    if (!running || running.w !== w || msg.id !== running.id) return;
    finish(msg.out!);
  });
  w.on('error', err => {
    console.error('[simulate] worker crashed:', err);
    if (worker === w) { worker = null; ready = false; }
    if (running?.w === w) finish({ ok: false, error: 'the simulation crashed the engine worker' });
    else pump();
  });
  w.on('exit', code => {
    if (worker === w) { worker = null; ready = false; }
    if (running?.w === w) finish({ ok: false, error: `the engine worker stopped (exit ${code})` });
    else pump();
  });
  return w;
}

function failAll(error: string): void {
  for (const p of queue.splice(0)) p.resolve({ ok: false, error });
}

function finish(out: SimResult): void {
  const r = running;
  if (!r) return;
  clearTimeout(r.timer);
  running = null;
  r.resolve(out);
  pump();
}

function pump(): void {
  if (running) return;
  if (!queue.length) { worker?.unref(); return; }
  if (!worker) worker = spawn();
  const w = worker;
  w.ref();
  if (!ready) return;   // the `ready` message pumps again
  const next = queue.shift()!;
  const timer = setTimeout(() => {
    console.error(`[simulate] a simulation took over ${jobTimeoutMs} ms; replacing the worker`);
    if (worker === w) { worker = null; ready = false; }
    finish({ ok: false, error: `the simulation took longer than ${jobTimeoutMs / 1000} s and was stopped`, limit: 'time' });
    void w.terminate();
  }, jobTimeoutMs);
  running = { ...next, timer, w };
  w.postMessage({ id: next.id, ...next.job });
}

/** Run one simulation off the main thread. Never rejects: every failure,
 * "busy" included, is a `{ ok:false }` result. */
export function simulateInWorker(spec: unknown, engine: string, budgetMs?: number): Promise<SimResult> {
  if (queue.length >= MAX_QUEUED) {
    return Promise.resolve({ ok: false, busy: true, error: 'busy: the engine is answering other questions; try again in a moment' });
  }
  return new Promise(resolve => {
    queue.push({ id: nextId++, job: { spec, engine, ...(budgetMs !== undefined ? { budgetMs } : {}) }, resolve });
    pump();
  });
}

/** Start the worker booting now, so the first question does not wait on it. */
export function warmSimulator(): void {
  if (!worker) { worker = spawn(); worker.unref(); }
}

/** Tests: is a worker up, and how many have been started. */
export function simulatorStats(): { alive: boolean; ready: boolean; spawned: number; queued: number; running: boolean } {
  return { alive: worker !== null, ready, spawned, queued: queue.length, running: running !== null };
}

/** Tests and shutdown: stop the worker (queued jobs are failed). */
export async function stopSimulator(): Promise<void> {
  failAll('the engine worker stopped');
  const w = worker;
  worker = null;
  ready = false;
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
  if (running) finish({ ok: false, error: 'the engine worker stopped' });
  if (w) await w.terminate();
}

/** Tests only: lower the wall clock so an ordinary simulation overruns it. */
export function setJobTimeoutForTests(ms: number): void { jobTimeoutMs = ms; }
