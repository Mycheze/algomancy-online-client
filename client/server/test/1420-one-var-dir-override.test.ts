// ALGO_VAR_DIR moves every state path statepaths.ts exports, and a per-file variable still wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import * as statepaths from '../statepaths.ts';

const getters = Object.entries(statepaths).filter((e): e is [string, () => string] => typeof e[1] === 'function');

/** Run `fn` with exactly `env` for the ALGO_* variables. */
function withEnv<T>(env: Record<string, string>, fn: () => T): T {
  const saved = Object.entries(process.env).filter(([k]) => k.startsWith('ALGO_'));
  for (const [k] of saved) delete process.env[k];
  Object.assign(process.env, env);
  try { return fn(); } finally {
    for (const k of Object.keys(process.env)) if (k.startsWith('ALGO_')) delete process.env[k];
    for (const [k, v] of saved) process.env[k] = v;
  }
}

test('⭐ with ALGO_VAR_DIR set, every exported path getter resolves inside it', () => {
  assert.ok(getters.length >= 13, `swept ${getters.map(([n]) => n).join(', ')}`);
  const dir = join(tmpdir(), 'algo-1420');
  const outside = withEnv({ ALGO_VAR_DIR: dir }, () =>
    getters.map(([name, get]) => [name, get()] as const).filter(([, p]) => p !== dir && !p.startsWith(dir + sep)));
  assert.deepEqual(outside, [], `these ignore ALGO_VAR_DIR=${dir}`);
});

test('a per-file variable still wins over ALGO_VAR_DIR', () => {
  const mine = join(tmpdir(), 'algo-1420-own', 'accounts.json');
  assert.equal(withEnv({ ALGO_VAR_DIR: join(tmpdir(), 'algo-1420'), ALGO_ACCOUNTS_FILE: mine }, () => statepaths.accountsFile()), mine);
});
