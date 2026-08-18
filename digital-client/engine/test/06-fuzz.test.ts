/* In-suite fuzz: a modest number of seeds (fuzz-run.ts does the big runs)
 * plus the replay-determinism guarantee (seed + action log = the game). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzGame } from './fuzz.ts';
import { replay } from '../src/apply.ts';

test('fuzz: 40 random games hold all invariants', () => {
  let finished = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = fuzzGame(seed, 2500);
    if (r.finished) finished++;
  }
  assert.ok(finished > 0, 'at least some random games actually end');
});

test('replay determinism: seed + action log reproduces the exact final state', () => {
  for (const seed of [3, 17, 29]) {
    const r = fuzzGame(seed, 1500);
    const replayed = replay(seed, r.actions);
    assert.equal(JSON.stringify(replayed.state), JSON.stringify(r.state),
      `seed ${seed}: replay diverged`);
  }
});
