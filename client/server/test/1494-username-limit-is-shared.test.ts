/* 1494 — THE SERVER'S USERNAME BOUNDS ARE THE ONES THE BOXES USE.
 *
 * usernameProblem reads USERNAME_MIN and USERNAME_MAX from client/shared/username.ts,
 * the same constants every username box in ui/ is capped with (ui/test/1493), so a
 * name the box lets through is never refused for its length, at sign-up or when a
 * guest keeps their account.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { USERNAME_MAX, USERNAME_MIN } from '../../shared/username.ts';

const dir = mkdtempSync(join(tmpdir(), 'algo-1494-'));
process.env['ALGO_ACCOUNTS_FILE'] = join(dir, 'accounts.json');
const A = await import('../accounts.ts');

test('BL-10 1494: a username is refused one character past USERNAME_MAX and below USERNAME_MIN, and nowhere between', () => {
  assert.equal(A.usernameProblem('a'.repeat(USERNAME_MAX)), null, 'the longest a box takes is accepted');
  assert.match(A.usernameProblem('a'.repeat(USERNAME_MAX + 1)) ?? '', new RegExp(`at most ${USERNAME_MAX} characters`));
  assert.equal(A.usernameProblem('a'.repeat(USERNAME_MIN)), null);
  assert.match(A.usernameProblem('a'.repeat(USERNAME_MIN - 1)) ?? '', new RegExp(`at least ${USERNAME_MIN} characters`));

  const guest = A.registerGuest();
  assert.ok(guest.ok);
  const long = A.claimGuest(guest.account, 'b'.repeat(USERNAME_MAX + 1), 'hunter22');
  assert.equal(long.ok, false, 'a guest keeping their account is held to the same limit');
  assert.equal(A.claimGuest(guest.account, 'b'.repeat(USERNAME_MAX), 'hunter22').ok, true);
});
