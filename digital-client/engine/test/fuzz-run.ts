/* Standalone fuzz runner for big runs (the M1 exit criterion is 1M games):
 *   node test/fuzz-run.ts [games] [maxActionsPerGame]
 * Prints progress and stats; exits non-zero on the first violation. */
import { fuzzGame } from './fuzz.ts';

const games = Number(process.argv[2] ?? 1000);
const maxActions = Number(process.argv[3] ?? 3000);

let finished = 0;
let totalTurns = 0;
let totalActions = 0;
const t0 = Date.now();

for (let seed = 1; seed <= games; seed++) {
  try {
    const r = fuzzGame(seed, maxActions);
    if (r.finished) finished++;
    totalTurns += r.turns;
    totalActions += r.actions.length;
  } catch (err) {
    console.error(`\nFAIL at seed ${seed}:`);
    console.error((err as Error).message);
    process.exit(1);
  }
  if (seed % 100 === 0) {
    const dt = (Date.now() - t0) / 1000;
    console.log(`${seed}/${games} games — ${finished} finished, ${(seed / dt).toFixed(1)} games/s`);
  }
}

const dt = (Date.now() - t0) / 1000;
console.log(`\nOK: ${games} games, ${finished} reached game over (${(100 * finished / games).toFixed(1)}%),`);
console.log(`avg ${(totalTurns / games).toFixed(1)} turns / ${(totalActions / games).toFixed(0)} actions per game, ${dt.toFixed(1)}s total (${(games / dt).toFixed(1)} games/s)`);
