/* The judge box sends the session — 2026-09-05, the owner: "the judge bot
 * thing isn't working for me at all. I'm signed in, but it tells me to sign
 * in". The server has required a signed-in caller since the hosting round
 * (an anonymous POST would spend the model's bill); the client's fetch was
 * never given the header the other authed requests carry. The driver stubs
 * `judge-q` as absent, so this pins the source: the judge fetch must build
 * its headers with the account module's helper, like /api/decks does. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAIN = readFileSync(fileURLToPath(new URL('../main.ts', import.meta.url)), 'utf8');
const DECKS = readFileSync(fileURLToPath(new URL('../decks.ts', import.meta.url)), 'utf8');

const fetchBlock = (src: string, path: string): string => {
  const at = src.indexOf(`fetch('${path}'`);
  assert.ok(at > 0, `no fetch('${path}') in the source`);
  return src.slice(at, src.indexOf('body:', at));
};

test('the judge request carries the session header, built by the account module', () => {
  const judge = fetchBlock(MAIN, '/api/judge');
  assert.match(judge, /acct\.authHeaders\(\)/, 'the judge fetch does not use acct.authHeaders() — a signed-in player is told to sign in');
  assert.doesNotMatch(judge, /headers: \{ 'content-type'/, 'a bare content-type header is exactly the shape that dropped the token');
});

test('positive control: that helper is what the deck requests use, and it emits a bearer', () => {
  assert.match(DECKS, /headers: authHeaders\(\)/);
  const acct = readFileSync(fileURLToPath(new URL('../account.ts', import.meta.url)), 'utf8');
  assert.match(acct, /authorization: `Bearer \$\{t\}`/);
});
