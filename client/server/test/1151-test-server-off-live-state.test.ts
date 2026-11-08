/* A SERVER A TEST SPAWNS NEVER BOOTS ON THE LIVE STATE.
 *
 * spawnServer() (e2e/test-util.ts) used to throw away only the league, the
 * challenges and the matches. Every other statepaths.ts getter — the saved
 * games, the account store, the reports, the owner's verdicts — fell back to
 * var/ whenever neither the caller nor suite.test.ts named a path. 768 runs as
 * a unit test and names none, so on 2026-11-06 its two servers each restored
 * the six games the steward had fetched into var/games (one a 600-action
 * crowded board) before listening: 22 s a boot on an idle box, past the 60 s
 * deadline under the gate's load, and an unrelated branch went red. On the
 * deploy box the same servers would have opened the real account store.
 *
 * §1 ⭐ with nothing set, EVERY statepaths.ts getter resolves outside var/ in
 *    the spawned server's environment — swept off the module's exports, so a
 *    new getter is covered the day it is added
 * §2 the scratch directory is one per process: a restarted server finds its
 *    rooms again, and gamesDir() names the directory the server writes
 * §3 a path the caller or process.env names still wins
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sep } from 'node:path';
import * as statepaths from '../statepaths.ts';
import { gamesDir, serverEnv } from '../e2e/test-util.ts';

const VARS = [
  'ALGO_GAMES_DIR', 'ALGO_ACCOUNTS_FILE', 'ALGO_ISSUES_FILE', 'ALGO_REPORT_RUNS_FILE',
  'ALGO_VERDICTS_FILE', 'ALGO_REPORT_MARKS_FILE', 'ALGO_LEAGUE_FILE', 'ALGO_CR_COMMENTS_FILE', 'ALGO_JUDGE_FLAGS_FILE',
  'ALGO_CHALLENGES_DIR', 'ALGO_MATCHES_DIR', 'ALGO_OG_CACHE_DIR',
];

/** Run `fn` with none of the state variables in process.env, as when a test
 * file is run on its own. */
function bare<T>(fn: () => T): T {
  const saved = Object.fromEntries(VARS.map(k => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
}

/** Call every statepaths getter as the spawned server would, in `env`. */
function resolveIn(env: NodeJS.ProcessEnv): Record<string, string> {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, env);
  try {
    const out: Record<string, string> = {};
    for (const [name, v] of Object.entries(statepaths)) if (typeof v === 'function') out[name] = (v as () => string)();
    return out;
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

test('§1 ⭐ with nothing set, every live-state path a spawned server resolves is outside var/', () => {
  const paths = bare(() => resolveIn(serverEnv()));
  assert.ok(Object.keys(paths).length >= 11, `swept ${Object.keys(paths).join(', ')}`);
  const live = statepaths.VAR_DIR + sep;
  const onLive = Object.entries(paths).filter(([, p]) => p === statepaths.VAR_DIR || p.startsWith(live));
  assert.deepEqual(onLive, [], 'a test server would read or write the live state here');
});

test('§2 one scratch directory per process: a restart finds its rooms, and gamesDir() names them', () => {
  bare(() => {
    const a = serverEnv()['ALGO_GAMES_DIR'];
    const b = serverEnv()['ALGO_GAMES_DIR'];
    assert.equal(a, b, 'two spawns in one test share their saved rooms');
    assert.equal(gamesDir(), a, 'a test reads its room back from where the server wrote it');
    assert.equal(serverEnv()['ALGO_ACCOUNTS_FILE'], serverEnv()['ALGO_ACCOUNTS_FILE']);
  });
});

test('§3 the caller\'s path, then process.env\'s, still wins over the scratch default', () => {
  bare(() => {
    process.env['ALGO_GAMES_DIR'] = '/tmp/from-the-suite';
    try {
      assert.equal(serverEnv()['ALGO_GAMES_DIR'], '/tmp/from-the-suite');
      assert.equal(gamesDir(), '/tmp/from-the-suite');
      assert.equal(serverEnv({ ALGO_GAMES_DIR: '/tmp/from-the-test' })['ALGO_GAMES_DIR'], '/tmp/from-the-test');
    } finally { delete process.env['ALGO_GAMES_DIR']; }
  });
});
