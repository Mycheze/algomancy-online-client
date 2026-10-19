/* WEEKLY CHALLENGES — every calendar row's reference run (docs/21 "Reference runs").
 *
 * Each row of CHALLENGES has `challenge-runs/<id>.json`, `{challengeId, deck,
 * actions}`, written by `node server/challenge-solve.ts <id> --write`. This
 * replays each one through the real `verifyRun` and requires it to pass at the
 * row's own goal — the proof that the goal is reachable at its n — and pins
 * the score it earns, which is the row's par.
 *
 * WHEN A SCORE HERE GOES RED: a rules change moved what the recorded log
 * does. The run is a claim about the old rules; do not edit the number to
 * match. Re-record the run (the command above), check it still meets the goal
 * in a sensible number of turns, and then update PAR below — and only for a
 * row whose week has not opened yet (challenges.ts: a row is a promise once
 * its week opens).
 *
 * §1 every calendar row has a reference file naming that row
 * §2 ⭐ each reference run verifies at its row's goal, and its score is the pinned par
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyRun, type RunScore } from '../../engine/src/challenge.ts';
import { CHALLENGES, REFERENCE_RUNS_DIR } from '../challenges.ts';

/** the Skill (and the rest) each reference run scores, by row id */
const PAR: Record<string, RunScore> = {
  '2026-10-25-crowd': { unique: 10, extra: 0, cards: 10, elements: 1, turns: 9, skill: 90 },
  '2026-11-01-tokens': { unique: 10, extra: 3, cards: 13, elements: 1, turns: 8, skill: 104 },
  '2026-11-08-giant': { unique: 10, extra: 0, cards: 10, elements: 1, turns: 10, skill: 100 },
  '2026-11-15-counters': { unique: 9, extra: 0, cards: 9, elements: 1, turns: 9, skill: 81 },
  '2026-11-22-parade': { unique: 13, extra: 0, cards: 13, elements: 2, turns: 11, skill: 286 },
};

const fileOf = (id: string): string => join(REFERENCE_RUNS_DIR, `${id}.json`);

test('§1 every calendar row has a reference run file that names it', () => {
  for (const c of CHALLENGES) {
    assert.ok(existsSync(fileOf(c.id)), `${c.id} has no reference run: node server/challenge-solve.ts ${c.id} --write`);
    const ref = JSON.parse(readFileSync(fileOf(c.id), 'utf8')) as { challengeId?: unknown };
    assert.equal(ref.challengeId, c.id, `${c.id}.json names another challenge`);
    assert.ok(PAR[c.id], `${c.id} has no pinned par in this test`);
  }
});

for (const c of CHALLENGES) {
  test(`§2 the reference run for ${c.id} verifies and scores its pinned par`, () => {
    const ref = JSON.parse(readFileSync(fileOf(c.id), 'utf8')) as { deck: unknown; actions: unknown };
    const v = verifyRun(c, ref.deck, ref.actions);
    assert.ok(v.ok, v.ok ? '' : `${c.id}: the reference run no longer verifies (${v.error}). `
      + `A rules change moved it: re-record it with node server/challenge-solve.ts ${c.id} --write`);
    assert.deepEqual(v.score, PAR[c.id], `${c.id}: the reference run now scores ${JSON.stringify(v.score)}. `
      + `A rules change moved it: re-record it with node server/challenge-solve.ts ${c.id} --write, `
      + 'check the turns are still sensible, then update PAR in this test');
  });
}
