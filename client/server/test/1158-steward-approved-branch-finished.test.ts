/**
 * 1158 — an approved branch whose item already reached master another way is finished (BL-68).
 *
 * 2026-11-05: CT-521's approved branch (23d78f55) had been re-applied by a repair run as c674d37c.
 * The stale steward-approved/CT-521 branch stayed, and every tick the runner rebased it onto its own
 * landed patch, conflicted, and queued "repair origin/steward-approved/CT-521" ahead of everything:
 * three Claude runs for one line. steward/run-once.sh's approved_finished() now reads the item's
 * last journal row, not counting the landing loop's own rows, and land_approved archives the branch
 * when that row says the work is on master. It worked live on 2026-11-06 at 10:41 (CT-521 →
 * landed-elsewhere, never queued again). The whole tick is `steward/test-runner.sh landed-elsewhere`,
 * which pushes to a remote; this pins the decision itself, using the runner's own bash.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'steward', 'run-once.sh');
const src = readFileSync(RUNNER, 'utf8');

/** one top-level shell function, cut out of run-once.sh by its name */
function fn(name: string): string {
  const one = src.match(new RegExp(`^${name}\\(\\) \\{.*\\}$`, 'm'));
  if (one) return one[0];
  const many = src.match(new RegExp(`^${name}\\(\\) \\{[^\\n]*\\n[\\s\\S]*?^\\}$`, 'm'));
  assert.ok(many, `run-once.sh has no function ${name}()`);
  return many[0];
}

const hasJq = (() => { try { execFileSync('jq', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

/** does approved_finished say the item's approved work is already on master, given these journal rows? */
function finished(item: string, rows: Array<Record<string, string>>): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'steward-1158-'));
  try {
    writeFileSync(join(dir, 'journal.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    const script = `STATE=${JSON.stringify(dir)}\n${fn('slug')}\n${fn('approved_finished')}\n`
      + `approved_finished "$1" && echo yes || echo no`;
    return execFileSync('bash', ['-c', script, 'bash', item], { encoding: 'utf8' }).trim() === 'yes';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const row = (item: string, outcome: string) => ({ ts: '2026-11-06T00:00:00Z', item, outcome });

test('1158 CT-521\'s real history: shipped by a repair, then the stale approved branch conflicts — finished', { skip: !hasJq && 'no jq' }, () => {
  assert.equal(finished('CT-521', [
    row('CT-521', 'staged'), row('CT-521', 'approved'), row('CT-521', 'approved-conflict'),
    row('CT-521', 'shipped'), row('CT-521', 'approved-conflict'), row('CT-424', 'staged'),
  ]), true, 'the landing loop\'s own approved-conflict rows do not hide the shipped row before them');
  for (const o of ['landed', 'already-fixed', 'not-a-bug']) {
    assert.equal(finished('CT-9', [row('CT-9', 'approved'), row('CT-9', o), row('CT-9', 'approved-gate-red')]), true, o);
  }
});

test('1158 an approval that has not landed, or a re-approval after a ship, still lands', { skip: !hasJq && 'no jq' }, () => {
  assert.equal(finished('CT-9', [row('CT-9', 'staged'), row('CT-9', 'approved'), row('CT-9', 'approved-conflict')]), false);
  assert.equal(finished('CT-9', [row('CT-9', 'shipped'), row('CT-9', 'staged'), row('CT-9', 'approved')]), false,
    'a later approved row is a second piece of work');
  assert.equal(finished('CT-9', [row('CT-10', 'shipped')]), false, 'another item\'s rows say nothing');
  assert.equal(finished('CT-9', []), false);
});

test('1158 a report item is matched by its branch spelling', { skip: !hasJq && 'no jq' }, () => {
  assert.equal(finished('#332', [row('report-332', 'approved'), row('report-332', 'landed')]), true);
});
