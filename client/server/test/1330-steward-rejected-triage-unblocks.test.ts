/**
 * 1330 — rejecting a triage branch must not stop the next triage.
 *
 * 2026-11-13 15:41: the owner answered a staged triage on Discord with "reject — I'm not actually
 * rejecting this. This is fine! But …". The runner archived and deleted the branch, as a rejection
 * does, and journalled `rejected`. queue.mjs counted `rejected` as "a triage branch is waiting on
 * the owner", and triage is the only door a report comes in by: for two days no report reached the
 * queue (13 rows, Nyar's The Everywhere and a draw scored as a loss among them) while every tick
 * logged "queue empty — nothing to do".
 *
 * The queue reads the ledgers off its own checkout, so this builds a throwaway one: queue.mjs copied
 * in, every ledger file linked to the real one except the report snapshot, which gets one row the
 * ledger has never seen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LEDGERS = join(ROOT, 'client', 'ledgers');
const SNAP = 'playtest-issues.snapshot.jsonl';

/** the queue, run against a checkout with one unledgered report row and this journal */
function queue(rows: Array<Record<string, string>>): { lines: string[]; excluded: string } {
  const dir = mkdtempSync(join(tmpdir(), 'steward-1330-'));
  try {
    const repo = join(dir, 'repo'), state = join(dir, 'state');
    mkdirSync(join(repo, 'steward'), { recursive: true });
    mkdirSync(join(repo, 'client', 'ledgers'), { recursive: true });
    mkdirSync(state);
    copyFileSync(join(ROOT, 'steward', 'queue.mjs'), join(repo, 'steward', 'queue.mjs'));
    copyFileSync(join(ROOT, 'steward', 'hold.txt'), join(repo, 'steward', 'hold.txt'));
    for (const f of readdirSync(LEDGERS)) {
      if (f !== SNAP) symlinkSync(join(LEDGERS, f), join(repo, 'client', 'ledgers', f));
    }
    const snap = readFileSync(join(LEDGERS, SNAP), 'utf8').replace(/\n*$/, '\n');
    writeFileSync(join(repo, 'client', 'ledgers', SNAP),
      snap + JSON.stringify({ ts: '2026-11-14T16:07:07.577Z', room: 'TEST', seat: 0, note: 'a report nobody has triaged' }) + '\n');
    execFileSync('bash', ['-c', 'git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base'], { cwd: repo });
    writeFileSync(join(state, 'journal.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    const r = spawnSync(process.execPath, [join(repo, 'steward', 'queue.mjs'), '--why'], {
      encoding: 'utf8', env: { ...process.env, STEWARD_STATE: state },
    });
    assert.equal(r.status, 0, r.stderr);
    return { lines: r.stdout.split('\n').filter(l => l.trim()), excluded: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const row = (outcome: string) => ({ ts: new Date(Date.now() - 3600e3).toISOString(), item: 'triage', outcome });
const triaged = (q: { lines: string[] }) => q.lines.some(l => l.startsWith('triage #'));

test('1330 an unledgered report row is triaged', () => {
  assert.ok(triaged(queue([])), 'the throwaway checkout must offer triage at all');
});

test('1330 a staged triage branch still holds the rows it carries', () => {
  const q = queue([row('staged')]);
  assert.ok(!triaged(q), `triage offered while a branch waits: ${q.lines.join(' | ')}`);
  assert.match(q.excluded, /triage: a triage branch is waiting on the owner \(staged\)/);
});

test('1330 a rejected triage is finished: the next tick triages again', () => {
  const q = queue([row('staged'), row('rejected')]);
  assert.ok(triaged(q), `no triage after a rejection; excluded:\n${q.excluded}`);
});
