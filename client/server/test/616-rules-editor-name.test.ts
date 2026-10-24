/* 616 — CT-276: NOBODY CAN POST AS THE RULES EDITOR.
 *
 * The comment-review process replies and resolves on the rules review page as
 * a system author, crreview.ts RULES_EDITOR ({ id: 'system:rules-editor',
 * name: 'Rules editor' }), through the bot-token door. The page showed authors
 * by NAME only, and accounts.ts allows spaces in a username, so an account
 * called "Rules editor" posted comments that looked exactly like the system's.
 *
 *   §1  the name is reserved: refused at registration and when a guest claims
 *       it, case and separators folded; a name that merely contains it is fine
 *   §2  what a reader is sent marks the system author `system`, by its id —
 *       an account that already holds the name (taken before the reservation)
 *       is sent no such mark
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'algo-616-'));
process.env['ALGO_ACCOUNTS_FILE'] = join(dir, 'accounts.json');
process.env['ALGO_CR_COMMENTS_FILE'] = join(dir, 'cr-comments.jsonl');
const A = await import('../accounts.ts');
const { fold, viewFor, RULES_EDITOR } = await import('../crreview.ts');
const { commentHtml } = await import('../../ui/crreview.ts');
type CrRow = import('../crreview.ts').CrRow;

test('CT-276: the username Rules editor is reserved, case and separators folded', () => {
  for (const name of ['Rules editor', 'rules editor', 'RULES EDITOR', 'Rules.Editor', 'rules_editor', 'RulesEditor', 'rules-editor', '  Rules editor  ']) {
    assert.match(A.usernameProblem(name) ?? '', /reserved/, `"${name}" is refused`);
  }
  assert.equal(A.usernameProblem(RULES_EDITOR.name) !== null, true, 'derived from the system author, not a copy of its name');
  for (const name of ['Rules editors', 'Rules', 'editor', 'Rule seditor2']) {
    assert.equal(A.usernameProblem(name), null, `"${name}" is an ordinary name`);
  }
  const reg = A.register('Rules editor', 'hunter22');
  assert.equal(reg.ok, false, 'registering it is refused');
  const guest = A.registerGuest();
  assert.ok(guest.ok);
  const claim = A.claimGuest(guest.account, 'rules.editor', 'hunter22');
  assert.equal(claim.ok, false, 'and so is a guest claiming it');
});

test('CT-276: only the system author is sent the system mark, never an account that shares its name', () => {
  const at = '2026-10-24T00:00:00.000Z';
  const rows: CrRow[] = [
    { v: 1, op: 'add', id: 'c_616_1', at, by: { id: 'acct-1', name: 'Rules editor' }, target: 'rule:100.1', parent: null, anchor: null, body: 'I am the editor, honest' },
    { v: 1, op: 'add', id: 'c_616_2', at, by: RULES_EDITOR, target: 'rule:100.1', parent: 'c_616_1', anchor: null, body: 'the real one' },
  ];
  const out = viewFor(fold(rows), null);
  const fake = out.find(c => c.id === 'c_616_1')!;
  const real = out.find(c => c.id === 'c_616_2')!;
  assert.equal(fake.by.name, real.by.name, 'the two names read the same');
  assert.equal(fake.by.system, undefined, 'the account is sent no system mark');
  assert.equal(real.by.system, true, 'the Rules editor is');
});

test('CT-276: the review page draws the system chip on the Rules editor reply and on no account comment', () => {
  const at = '2026-10-24T00:00:00.000Z';
  const rows: CrRow[] = [
    { v: 1, op: 'add', id: 'c_616_3', at, by: { id: 'acct-1', name: 'Rules editor' }, target: 'rule:100.1', parent: null, anchor: null, body: 'a lookalike' },
    { v: 1, op: 'add', id: 'c_616_4', at, by: RULES_EDITOR, target: 'rule:100.1', parent: 'c_616_3', anchor: null, body: 'the real one' },
  ];
  const out = viewFor(fold(rows), null);
  const fake = commentHtml(out.find(c => c.id === 'c_616_3')!);
  const real = commentHtml(out.find(c => c.id === 'c_616_4')!);
  assert.match(real, /class="crchipx crsys"[^>]*>system</, 'the system author is drawn with the chip');
  assert.doesNotMatch(fake, /crsys/, 'the account that shares its name is not');
});
