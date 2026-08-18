/* Multi-process fuzz runner for big runs (M1 exit criterion: 1M games).
 *
 *   node test/fuzz-parallel.ts [games] [workers] [maxActionsPerGame]
 *
 * Splits the seed range into contiguous chunks, one child process per worker
 * (each just runs this file with --worker), aggregates progress, and exits
 * non-zero on the first violation — reprinting the failing seed so
 * `node test/fuzz-run.ts` / fuzzGame(seed) can reproduce it exactly.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';

const SELF = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);

// ── worker mode ───────────────────────────────────────────────────────
if (args[0] === '--worker') {
  const { fuzzGame } = await import('./fuzz.ts');
  const start = Number(args[1]);
  const count = Number(args[2]);
  const maxActions = Number(args[3]);
  let finished = 0, turns = 0, actions = 0;
  for (let i = 0; i < count; i++) {
    const seed = start + i;
    try {
      const r = fuzzGame(seed, maxActions);
      if (r.finished) finished++;
      turns += r.turns;
      actions += r.actions.length;
    } catch (err) {
      console.error(`FAIL at seed ${seed}:\n${(err as Error).message}`);
      process.exit(1);
    }
    if ((i + 1) % 50 === 0 || i + 1 === count) {
      console.log(JSON.stringify({ done: i + 1, finished, turns, actions }));
    }
  }
  process.exit(0);
}

// ── parent mode ───────────────────────────────────────────────────────
const games = Number(args[0] ?? 10_000);
const workers = Number(args[1] ?? Math.max(1, availableParallelism() - 1));
const maxActions = Number(args[2] ?? 3000);

console.log(`fuzzing ${games} games across ${workers} workers (maxActions ${maxActions})`);
const t0 = Date.now();
const per = Math.ceil(games / workers);
const latest: { done: number; finished: number; turns: number; actions: number }[] = [];
let failed = false;
let exited = 0;

const children = Array.from({ length: workers }, (_, w) => {
  const start = 1 + w * per;
  const count = Math.max(0, Math.min(per, games - w * per));
  latest[w] = { done: 0, finished: 0, turns: 0, actions: 0 };
  if (count === 0) { exited++; return null; }
  const child = spawn(process.execPath, [SELF, '--worker', String(start), String(count), String(maxActions)], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let buf = '';
  child.stdout.on('data', (d: Buffer) => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop()!;
    for (const line of lines) {
      if (line.trim()) latest[w] = JSON.parse(line);
    }
  });
  child.on('exit', code => {
    exited++;
    if (code !== 0 && !failed) {
      failed = true;
      for (const c of children) c?.kill();
    }
  });
  return child;
});

const totals = () => latest.reduce(
  (a, l) => ({ done: a.done + l.done, finished: a.finished + l.finished, turns: a.turns + l.turns, actions: a.actions + l.actions }),
  { done: 0, finished: 0, turns: 0, actions: 0 });

const tick = setInterval(() => {
  const t = totals();
  const dt = (Date.now() - t0) / 1000;
  const rate = t.done / dt;
  const eta = rate > 0 ? (games - t.done) / rate : Infinity;
  console.log(`${t.done}/${games} — ${t.finished} finished, ${rate.toFixed(1)} games/s, ETA ${Math.round(eta / 60)}m`);
  if (exited === workers) {
    clearInterval(tick);
    const total = totals();
    const secs = (Date.now() - t0) / 1000;
    if (failed) {
      console.error('\nFAILED — see the seed above; reproduce with fuzzGame(seed).');
      process.exit(1);
    }
    console.log(`\nOK: ${total.done} games, ${total.finished} reached game over (${(100 * total.finished / total.done).toFixed(1)}%),`);
    console.log(`avg ${(total.turns / total.done).toFixed(1)} turns / ${(total.actions / total.done).toFixed(0)} actions per game,`);
    console.log(`${secs.toFixed(1)}s total, ${(total.done / secs).toFixed(1)} games/s across ${workers} workers`);
    console.log(`1M games at this rate: ${(1_000_000 / (total.done / secs) / 3600).toFixed(1)} h`);
  }
}, 5000);
