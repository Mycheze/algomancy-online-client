/**
 * 1160 — a repaired approved branch keeps the owner's approval (BL-71).
 *
 * 2026-11-07: BL-61 was approved at 05:48 and its branch conflicted with master. A repair run rebased
 * it cleanly, and the runner treated the result as new work: staged it as steward/BL-61 and asked the
 * owner to approve it again, while steward-approved/BL-61 stayed at the stale tip, conflicted on the
 * next tick and queued the same repair — three times by 08:25, and report-329 the same. A re-approval
 * could not have fixed it either: the approve push was not forced, and the repaired branch is not a
 * descendant of the stale tip. Now run-once.sh's approval_carries() decides that a green repair which
 * touches no file the approved change did not is that change, rebased, and work_one pushes it over the
 * approved tip (journal: approved-repaired) for the next tick to land. The whole tick is
 * `steward/test-runner.sh`, which pushes to a remote; this pins the decision with the runner's own bash.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STEWARD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'steward');
const src = readFileSync(join(STEWARD, 'run-once.sh'), 'utf8');

/** one top-level shell function, cut out of run-once.sh by its name */
function fn(name: string): string {
  const one = src.match(new RegExp(`^${name}\\(\\) \\{.*\\}$`, 'm'));
  if (one) return one[0];
  const many = src.match(new RegExp(`^${name}\\(\\) \\{[^\\n]*\\n[\\s\\S]*?^\\}$`, 'm'));
  assert.ok(many, `run-once.sh has no function ${name}()`);
  return many[0];
}

/**
 * A scratch repo: master M0 → M1 (master moved on, touching m.txt); the approved change was made on
 * M0 and touched a.txt and b.txt; HEAD is a "repair" on M1 that touches `files`.
 * Does approval_carries say HEAD is the approved change?
 */
function carries(files: string[]): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'steward-1160-'));
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  const commit = (msg: string, edits: string[]) => {
    for (const f of edits) writeFileSync(join(dir, f), `${msg} ${f}\n`);
    git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', msg, '--allow-empty');
  };
  try {
    git('init', '-q'); commit('M0', ['a.txt', 'b.txt', 'm.txt']);
    const m0 = git('rev-parse', 'HEAD');
    commit('approved', ['a.txt', 'b.txt']); git('update-ref', 'refs/remotes/origin/steward-approved/X', 'HEAD');
    git('checkout', '-q', '--detach', m0); commit('M1', ['m.txt']); git('update-ref', 'refs/remotes/origin/master', 'HEAD');
    if (files.length) commit('repair', files);
    const script = `REPO=${JSON.stringify(dir)}\n${fn('g')}\n${fn('approval_carries')}\n`
      + 'approval_carries origin/steward-approved/X && echo yes || echo no';
    return execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim() === 'yes';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('1160 the approved change, rebased onto a moved master, carries the approval', () => {
  assert.equal(carries(['a.txt', 'b.txt']), true);
  assert.equal(carries(['a.txt']), true, 'a repair that needs fewer files is still the approved change');
});

test('1160 a repair that touches a file the owner never approved, or nothing, does not', () => {
  assert.equal(carries(['a.txt', 'b.txt', 'c.txt']), false, 'a new file is new work: it goes back to the owner');
  assert.equal(carries([]), false, 'an empty repair carries nothing');
});

test('1160 work_one hands a carried repair to the approved branch, and the queue waits for it', () => {
  const wiring = src.slice(src.indexOf('approval_carries "$aref"'));
  assert.match(src, /\[\[ "\$aref" == origin\/steward-approved\/\* \]\] && g rev-parse -q --verify "\$aref" >\/dev\/null && approval_carries "\$aref"/,
    'only a repair of an approved branch is carried');
  assert.match(wiring, /push -q --atomic -f origin "HEAD:refs\/heads\/steward-approved\/\$\(slug "\$item"\)"/,
    'the repaired HEAD replaces the stale approved tip');
  assert.match(wiring, /final=approved-repaired/);
  const queue = readFileSync(join(STEWARD, 'queue.mjs'), 'utf8');
  assert.match(queue.match(/const WAITING = new Set\(\[[^\]]*\]\)/)![0], /'approved-repaired'/,
    'an approved-repaired item is waiting to land, not fresh work');
});

test('1160 an approval is a forced, atomic push: it replaces a stale approved tip and never loses the staged branch', () => {
  assert.match(fn('discord_sync'), /g push -q --atomic origin "\+refs\/remotes\/origin\/steward\/\$item:refs\/heads\/steward-approved\/\$item" ":refs\/heads\/steward\/\$item"/);
  const review = readFileSync(join(STEWARD, 'review.sh'), 'utf8');
  assert.match(review, /g push -q --atomic origin "\+refs\/remotes\/origin\/steward\/\$s:refs\/heads\/steward-approved\/\$s" ":refs\/heads\/steward\/\$s"/);
});
