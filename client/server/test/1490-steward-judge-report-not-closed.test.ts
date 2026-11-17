/**
 * 1490 — a triage that closes a judge's report against them does not ship by itself.
 *
 * A judge at level 2 (trusted) or 3 (word of law) outranks the owner, who is level 1, and every
 * rule we wrote; a rules report from one is a ticket (steward SKILL §5). policy.mjs reads the
 * settled rows a branch appends and the report rows they close, and stages a by-design or wontfix
 * on a judge's report. A take-back row, a non-judge's report and a ticket still ship.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const POLICY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'steward', 'policy.mjs');

type Row = { note: string; by: { name: string; judge?: number }; fix?: { takeBack?: boolean } };

/** a throwaway repo: `reports` as the snapshot, then one commit appending `settled` → the policy's verdict */
function policyOn(reports: Row[], settled: object[]): { verdict: string; reasons: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'steward-1490-'));
  try {
    const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
    g('init', '-q', '-b', 'master');
    g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    mkdirSync(join(dir, 'client', 'ledgers'), { recursive: true });
    writeFileSync(join(dir, 'client/ledgers/playtest-issues.snapshot.jsonl'), reports.map(r => JSON.stringify(r)).join('\n') + '\n');
    writeFileSync(join(dir, 'client/ledgers/settled.jsonl'), '{"id":"#0","as":"fixed"}\n');
    g('add', '-A'); g('commit', '-qm', 'base');
    appendFileSync(join(dir, 'client/ledgers/settled.jsonl'), settled.map(r => JSON.stringify(r)).join('\n') + '\n');
    g('commit', '-qam', 'triage');
    const r = spawnSync('node', [POLICY, 'HEAD~1', 'HEAD'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const REPORTS: Row[] = [
  { note: 'first', by: { name: 'Someone' } },
  { note: 'It does not have a graft to be able to graft onto Spellbind.', by: { name: 'Nyar', judge: 2 } },
  { note: 'void mandible should trigger from viruses', by: { name: 'invi' } },
  { note: '[Take-back] back to before my blocks. Not a bug, just taking something back.', by: { name: 'Karanda', judge: 2 }, fix: { takeBack: true } },
  { note: 'Pass through stack isn\'t working right', by: { name: 'mycheze', judge: 1 } },
];

test('1490 a by-design on a level-2 judge\'s report is staged, and the reason names it', () => {
  const p = policyOn(REPORTS, [{ id: '#1', as: 'by-design', note: 'the owner ruled anything goes' }]);
  assert.equal(p.verdict, 'stage');
  assert.match(p.reasons.join('\n'), /closes a judge's report \(#1 by-design, Nyar L2\)/);
});

test('1490 so is a wontfix on one', () => {
  assert.equal(policyOn(REPORTS, [{ id: '#1', as: 'wontfix', note: 'no' }]).verdict, 'stage');
});

test('1490 a judge\'s report filed as a ticket ships', () => {
  assert.equal(policyOn(REPORTS, [{ id: '#1', as: 'ticket', to: ['CT-1'], note: 'the judge is right' }]).verdict, 'ship');
});

test('1490 a non-judge\'s by-design, a judge\'s take-back and a level-1 report are not this tripwire', () => {
  const p = policyOn(REPORTS, [
    { id: '#2', as: 'by-design', note: 'RAQ [Solved]' },
    { id: '#3', as: 'agreed-fix', note: 'a take-back' },
    { id: '#4', as: 'by-design', note: 'answered' },
  ]);
  assert.equal(p.verdict, 'ship', p.reasons.join('\n'));
});

test('1490 the reason is one an owner\'s answer may waive (run-once.sh owners_call_made)', () => {
  const p = policyOn(REPORTS, [{ id: '#1', as: 'by-design', note: 'x' }]);
  assert.match(p.reasons.join('\n'), /the owner's call$/);
});
