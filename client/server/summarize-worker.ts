/* CT-533 — A FINISHED GAME'S SUMMARY, REPLAYED OFF THE MAIN THREAD.
 *
 * When a game ends, main.ts records it (history.ts), and the record is built
 * from stats.ts summarizeGame: a full replay of the game. On a crowded board
 * that is seconds (MCHQ, 600 actions and ~75 units: ~3.9 s on the home box
 * after CT-529, ~23 s with the steward's two pinned cores), and on the event
 * loop it stood every other room on the server still while it ran.
 *
 * summarizeGame is pure — a GameRecord in, a GameSummary out, no var/ file and
 * no account read — so it runs here, in a worker, and main.ts folds the result
 * into the history when it lands. One file is both halves, simulate-worker.ts's
 * shape:
 *
 *   - in a `worker_threads` Worker (workerData.role === ROLE) it imports the
 *     engine and answers one summary per message;
 *   - on the main thread it exports `summarizeOffThread`.
 *
 * ── NO WALL CLOCK, AND NEVER A FAILURE ───────────────────────────────
 *
 * simulate-worker kills a job past two seconds because a judge-bot question
 * can describe a game that never ends. A recorded game already ended: its
 * replay is finite. So there is no job timeout here, and every failure — the
 * worker not booting, crashing, or exiting mid-job — falls back to running
 * summarizeGame on the main thread, which is what main.ts did before. The
 * record is never lost to the worker; at worst it costs the old stall.
 *
 * One worker, one job at a time, FIFO. Idle, it is `unref`'d (it never holds
 * a process open) and stopped after IDLE_STOP_MS, so the engine copy it holds
 * is not kept for a server whose games end hours apart.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { summarizeGame, type GameRecord, type GameSummary } from './stats.ts';

const ROLE = 'algomancy-summarizer';

/** the engine import, once per worker; past this the jobs run on the main thread */
export const BOOT_TIMEOUT_MS = 30_000;
/** an idle worker is stopped after this */
export const IDLE_STOP_MS = 10 * 60_000;
/** one engine and one replay of a long game */
export const WORKER_HEAP_MB = 512;

// ── the worker half ───────────────────────────────────────────────────

if (!isMainThread && (workerData as { role?: string } | null)?.role === ROLE && parentPort) {
  const port = parentPort;
  port.on('message', (msg: { id: number; rec: GameRecord }) => {
    try {
      port.postMessage({ id: msg.id, summary: summarizeGame(msg.rec) });
    } catch (err) {
      port.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
    }
  });
  port.postMessage({ ready: true });
}

// ── the main-thread half ──────────────────────────────────────────────

interface Pending { id: number; rec: GameRecord; resolve: (s: GameSummary) => void }

let worker: Worker | null = null;
let ready = false;
let bootTimer: NodeJS.Timeout | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let running: (Pending & { w: Worker }) | null = null;
const queue: Pending[] = [];
let nextId = 1;
/** for tests: how many workers were started, and how many jobs fell back */
let spawned = 0;
let fellBack = 0;

/** run one job here, on the main thread: the old behaviour, for when the worker cannot */
function onMainThread(p: Pending, why: string): void {
  fellBack++;
  console.error(`[summarize] ${p.rec.code}: ${why}; summarizing on the main thread`);
  p.resolve(summarizeGame(p.rec));
}

/** the worker `w` is gone: the job it held and everything queued run here */
function lost(w: Worker, why: string): void {
  const current = worker === w;
  if (current) {
    worker = null;
    ready = false;
    if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
  }
  // the queue waits on the CURRENT worker only: a stale one's late `exit`
  // (after its boot timeout, say) must not take jobs queued for its successor
  const jobs = [...(running?.w === w ? [running] : []), ...(current ? queue.splice(0) : [])];
  if (running?.w === w) running = null;
  for (const p of jobs) onMainThread(p, why);
}

function spawn(): Worker {
  spawned++;
  ready = false;
  const w = new Worker(new URL(import.meta.url), {
    workerData: { role: ROLE },
    resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
  });
  bootTimer = setTimeout(() => {
    lost(w,`the worker did not boot within ${BOOT_TIMEOUT_MS} ms`);
    void w.terminate();
  }, BOOT_TIMEOUT_MS);
  w.on('message', (msg: { ready?: true; id?: number; summary?: GameSummary; error?: string }) => {
    if (msg.ready) {
      if (worker !== w) return;
      if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
      ready = true;
      pump();
      return;
    }
    if (!running || running.w !== w || msg.id !== running.id) return;
    const p = running;
    running = null;
    if (msg.summary) p.resolve(msg.summary);
    else onMainThread(p, `the worker's replay threw (${msg.error})`);
    pump();
  });
  w.on('error', err => lost(w, `the worker crashed (${err instanceof Error ? err.message : String(err)})`));
  w.on('exit', code => lost(w, `the worker stopped (exit ${code})`));
  return w;
}

function pump(): void {
  if (running) return;
  if (!queue.length) {
    worker?.unref();
    if (worker && !idleTimer) {
      const w = worker;
      idleTimer = setTimeout(() => {
        idleTimer = null;
        if (worker === w && !running && !queue.length) { worker = null; ready = false; void w.terminate(); }
      }, IDLE_STOP_MS);
      idleTimer.unref();
    }
    return;
  }
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (!worker) worker = spawn();
  const w = worker;
  w.ref();
  if (!ready) return;   // the `ready` message pumps again
  const next = queue.shift()!;
  running = { ...next, w };
  w.postMessage({ id: next.id, rec: next.rec });
}

/** stats.ts summarizeGame(rec), replayed in the worker. Never rejects: a
 * worker that cannot do it hands the job back to the main thread. */
export function summarizeOffThread(rec: GameRecord): Promise<GameSummary> {
  return new Promise(resolve => {
    queue.push({ id: nextId++, rec, resolve });
    pump();
  });
}

/** Tests: is a worker up, how many were started, how many jobs fell back. */
export function summarizerStats(): { alive: boolean; ready: boolean; spawned: number; fellBack: number; queued: number; running: boolean } {
  return { alive: worker !== null, ready, spawned, fellBack, queued: queue.length, running: running !== null };
}

/** Tests and shutdown: stop the worker. A job it held runs on the main thread. */
export async function stopSummarizer(): Promise<void> {
  const w = worker;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (!w) return;
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
  w.removeAllListeners('exit');
  w.removeAllListeners('error');
  lost(w, 'the worker was stopped');
  await w.terminate();
}
