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

test('fuzz: 25 random DRAFT games hold all invariants', () => {
  let finished = 0;
  for (let seed = 101; seed <= 125; seed++) {
    const r = fuzzGame(seed, 2500, 'draft');
    if (r.finished) finished++;
  }
  assert.ok(finished > 0, 'at least some random draft games actually end');
});

test('replay determinism: seed + action log reproduces the exact final state', () => {
  for (const seed of [3, 17, 29]) {
    const r = fuzzGame(seed, 1500);
    const replayed = replay(seed, r.actions);
    assert.equal(JSON.stringify(replayed.state), JSON.stringify(r.state),
      `seed ${seed}: replay diverged`);
  }
});

test('replay determinism holds in draft mode too', () => {
  for (const seed of [104, 111]) {
    const r = fuzzGame(seed, 1500, 'draft');
    const replayed = replay(seed, r.actions, undefined, 'draft');
    assert.equal(JSON.stringify(replayed.state), JSON.stringify(r.state),
      `seed ${seed}: draft replay diverged`);
  }
});

/* ── regression seeds ──────────────────────────────────────────────────────
 * Seeds that once found a real bug get pinned here by number. They are cheap,
 * and a fuzz seed that has already caught something is worth more than a random
 * one. The hand-built version of each position lives with its rule — a seed
 * drifts the moment anything upstream of it changes, so it pins the symptom
 * while the constructed test pins the cause.
 */
test('fuzz seed 1993: no stuck state at the block step (R76)', () => {
  // Two Alluring columns and enough able blockers to cover both. Every
  // declaration legalActions could think of blocked ONE column, and Alluring is
  // compulsory for BOTH, so every option was refused: no legal action for
  // either player, no pending decision, game hangs.
  // Constructed version: test/53-playtest-round7.test.ts.
  assert.doesNotThrow(() => fuzzGame(1993, 3000));
});
