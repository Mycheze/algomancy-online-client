/**
 * 1331 — when the owner has answered, "the owner's call" is made: the policy may not hold the work
 * for him a second time.
 *
 * 2026-11-12: a League page rework was staged with a question, A or B. He answered "approve A is
 * fine for now". That is not the bare word (by design: "Approve, but change …" must not land), so it
 * went back to the worker as an answer; the worker re-ran, read it as yes, wrote "You said yes to
 * option A, so this is going live", passed the gate — and policy.mjs staged it again for "292 changed
 * UI lines (over 250) — a rework of a screen, the owner's call". It sat for three days behind an
 * approval he had already given, and he found it by asking why it was still waiting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STEWARD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'steward');
const src = readFileSync(join(STEWARD, 'run-once.sh'), 'utf8');
const policySrc = readFileSync(join(STEWARD, 'policy.mjs'), 'utf8');

function fn(name: string): string {
  const many = src.match(new RegExp(`^${name}\\(\\) \\{[^\\n]*\\n[\\s\\S]*?^\\}$`, 'm'));
  assert.ok(many, `run-once.sh has no function ${name}()`);
  return many[0];
}

/** the policy's own reason strings, so a reworded reason cannot silently stop matching */
const reason = (needle: string): string => {
  const line = policySrc.split('\n').find(l => l.includes('reasons.push') && l.includes(needle));
  assert.ok(line, `policy.mjs has no reason mentioning ${needle}`);
  return line.slice(line.indexOf('`') + 1, line.lastIndexOf('`')).replace(/\$\{[^}]*\}/g, 'X');
};
const UI_LINES = reason('changed UI lines');
const UI_FILES = reason('adds or removes UI files');
const PROTECTED = reason('touches protected files');

function made(answered: 0 | 1, outcome: string, reasons: string[]): boolean {
  const pol = JSON.stringify({ verdict: reasons.length ? 'stage' : 'ship', reasons });
  const r = spawnSync('bash', ['-c', `${fn('owners_call_made')}\nowners_call_made "$1" "$2" "$3"`, 'x', String(answered), outcome, pol]);
  assert.ok(r.status === 0 || r.status === 1, String(r.stderr));
  return r.status === 0;
}

test('1331 the UI reasons are the ones that say "the owner\'s call"', () => {
  assert.match(UI_LINES, /the owner's call/);
  assert.match(UI_FILES, /the owner's call/);
  assert.doesNotMatch(PROTECTED, /the owner's call/);
});

test('1331 an answered run the worker calls ship is not held for the owner\'s call again', () => {
  assert.equal(made(1, 'ship', [UI_LINES]), true);
  assert.equal(made(1, 'ship', [UI_LINES, UI_FILES]), true);
});

test('1331 with no answer, a big UI change still waits for him', () => {
  assert.equal(made(0, 'ship', [UI_LINES]), false);
});

test('1331 an answer waives only the owner\'s call: any other reason still stages', () => {
  assert.equal(made(1, 'ship', [UI_LINES, PROTECTED]), false);
  assert.equal(made(1, 'ship', [PROTECTED]), false);
});

test('1331 the worker must read the answer as a go-ahead', () => {
  assert.equal(made(1, 'stage', [UI_LINES]), false);
  assert.equal(made(1, 'not-a-bug', [UI_LINES]), false);
});

test('1331 the runner applies it where the policy is read after a run', () => {
  assert.match(src, /\[ -f "\$STATE\/answers\/\$\(slug "\$item"\)\.md" \] && answered=1/);
  assert.match(src, /if owners_call_made "\$answered" "\$outcome" "\$pol"; then\n\s*pol=\$\(jq -c '\.verdict = "ship"'/);
});
