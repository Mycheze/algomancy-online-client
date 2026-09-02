/* BL-39 — the link-code lifecycle, on its own.
 *
 * server/link.ts's pure half: mint, claim, expire. The round trip over HTTP,
 * the uniqueness rules and — the two that matter most — whether a link SURVIVES
 * a profile rebuild and a restart are in server/test-bot.ts, because those need
 * a real server and a real accounts file.
 *
 * §1 the alphabet is the one people can actually retype
 * §2 a code is single-use and time-limited
 * §3 ⭐ ONE LIVE CODE PER ACCOUNT — clicking the button twice must not leave
 *    two working codes and no way to know which one the page is showing
 * §4 ⭐ A WRONG CODE AND AN EXPIRED ONE ARE INDISTINGUISHABLE. Telling them
 *    apart would say "that code was real, you were just slow", which is an
 *    oracle for guessing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE_ALPHABET, CODE_LENGTH, TTL_MS, claim, mint, pendingCount, resetLinks,
  sweepLinks,
} from '../../server/link.ts';

test('BL-39 §1 the alphabet drops what a person misreads', () => {
  // I/L/O read as 1/1/0. V does NOT — an earlier test assumed it was excluded,
  // passed five runs and failed the sixth, because V is one letter in 23.
  for (const bad of ['I', 'L', 'O', '0', '1']) {
    assert.ok(!CODE_ALPHABET.includes(bad), `${bad} must not be in the alphabet`);
  }
  assert.ok(CODE_ALPHABET.includes('V'), 'V is not ambiguous and stays');
  assert.equal(CODE_ALPHABET.length, 23);

  resetLinks();
  const p = mint('u1');
  assert.equal(p.code.length, CODE_LENGTH);
  assert.ok([...p.code].every(c => CODE_ALPHABET.includes(c)),
    `a minted code uses only the alphabet (got ${p.code})`);
});

test('BL-39 §2 a code is single-use and expires', () => {
  resetLinks();
  const now = 1_000_000;
  const p = mint('u1', now);

  assert.equal(claim(p.code, now + TTL_MS - 1), 'u1', 'valid just before the TTL');

  resetLinks();
  const q = mint('u2', now);
  assert.equal(claim(q.code, now + TTL_MS), null, '…and dead exactly at it');

  resetLinks();
  const r = mint('u3', now);
  assert.equal(claim(r.code, now), 'u3', 'the first claim works');
  assert.equal(claim(r.code, now), null, '⭐ …and the second does not');

  // case and whitespace are what a person actually types
  resetLinks();
  const s = mint('u4', now);
  assert.equal(claim(`  ${s.code.toLowerCase()} `, now), 'u4',
    'a lowercased, space-padded code still works — that is how it gets typed');
});

test('BL-39 §3 ⭐ minting again replaces, so only one code is ever live', () => {
  resetLinks();
  const now = 1_000_000;
  const first = mint('u1', now);
  const second = mint('u1', now + 1);
  assert.notEqual(first.code, second.code, 'a new code is issued');
  assert.equal(claim(first.code, now + 2), null,
    '⭐ the FIRST code is dead — clicking the button twice must not leave two '
    + 'working codes and no way to tell which one the page is showing');
  assert.equal(claim(second.code, now + 2), 'u1', 'and the second one works');
  assert.equal(pendingCount(), 0, 'claiming clears it');
});

test('BL-39 §4 ⭐ wrong and expired are the same answer', () => {
  resetLinks();
  const now = 1_000_000;
  const p = mint('u1', now);
  const expired = claim(p.code, now + TTL_MS + 1);
  const wrong = claim('ZZZZZZ', now);
  assert.equal(expired, null);
  assert.equal(wrong, null);
  assert.equal(expired, wrong,
    '⭐ both are null. Distinguishing them would tell a guesser "that code was '
    + 'real, you were just slow", which is an oracle');
});

test('BL-39 §5 the sweep drops what has expired and nothing else', () => {
  resetLinks();
  const now = 1_000_000;
  mint('u1', now);
  mint('u2', now + TTL_MS);          // still live at `now + TTL_MS + 1`
  assert.equal(pendingCount(), 2);
  sweepLinks(now + TTL_MS + 1);
  assert.equal(pendingCount(), 1, 'the old one is gone, the fresh one is not');
});
