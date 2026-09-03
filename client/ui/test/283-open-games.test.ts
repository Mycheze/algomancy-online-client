/* BL-42 — WHAT IS OPEN, NOT JUST HOW MANY, and who may click it.
 *
 * Three changes the owner asked for after using the first version, and the
 * parts of each that live in the browser:
 *
 * §1 the strip lists the games themselves. "A count buried as one line" was
 *    the old complaint about a number in a card; a number that cannot be
 *    clicked is the same complaint one level up.
 * §2 ⭐ DRAFT NO LONGER NEEDS AN ACCOUNT and constructed still does — and the
 *    reason constructed does is NOT identity, it is that the queue needs a
 *    deck at queue time. Getting that backwards would either lock guests out
 *    of everything or deal a constructed game with no deck.
 * §3 ⭐ A DIRECT CHALLENGE MUST NOT SHOW A BAND. It deliberately ignores one,
 *    and queueStateFor's own comment is that a client showing a ± the server
 *    is not using is how "ranked" quietly becomes a lie.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countsSummary, queueBlocker, waitLabel, MODE_LABEL } from '../queue.ts';

test('BL-42 §1 a count still reads well, but is no longer the whole answer', () => {
  // the summary line survives — the list sits under it, it does not replace it
  assert.match(countsSummary(null), /checking/i);
  assert.match(countsSummary({ total: 0, byMode: { constructed: 0, draft: 0 } }),
    /nobody waiting/i);
  const two = countsSummary({ total: 2, byMode: { constructed: 1, draft: 1 } });
  assert.match(two, /2 waiting/);
  assert.match(two, new RegExp(MODE_LABEL.draft, 'i'));

  // and each row needs a readable wait
  assert.equal(typeof waitLabel(0), 'string');
  assert.ok(waitLabel(65_000).length > 0);
});

test('BL-42 §2 ⭐ draft is open to guests; constructed needs a deck', () => {
  // signed out
  assert.equal(queueBlocker('draft', false, false), null,
    '⭐ a signed-out player may queue for DRAFT. It used to say "sign in to use '
    + 'the queue"; the owner\'s call is that a draft game should just start and '
    + 'the account can be made afterwards');
  assert.ok(queueBlocker('constructed', false, false),
    'constructed still refuses — but for the DECK, not the identity');
  assert.match(String(queueBlocker('constructed', false, false)), /deck/i,
    '⭐ …and the refusal says so, because "sign in" would be the wrong reason '
    + 'and would send them to fix the wrong thing');

  // signed in
  assert.equal(queueBlocker('draft', true, false), null, 'signed in, draft is fine');
  assert.equal(queueBlocker('constructed', true, false) === null, false,
    'signed in with no deck still cannot queue constructed');
  assert.equal(queueBlocker('constructed', true, true), null,
    'signed in WITH a deck can');
});

test('BL-42 §3 ⭐ the searching line never shows a band for a challenge', () => {
  // The rendering is private, so this reads the source: the point is that the
  // `vs` branch returns BEFORE the band branch can run, and no amount of
  // exercising the happy path proves that ordering.
  const src = readSource();
  const vsAt = src.indexOf('if (s.vs)');
  const bandAt = src.indexOf('bandLabel(s.band)');
  assert.ok(vsAt > 0, 'searchingHtml has a challenge branch');
  assert.ok(bandAt > 0, 'and a band branch');
  assert.ok(vsAt < bandAt,
    '⭐ the challenge branch must come FIRST and return. A direct challenge '
    + 'ignores the band, so printing "within ±100" next to it claims a promise '
    + 'the server is not keeping — the exact failure queueStateFor\'s ⚠ exists '
    + 'to prevent, arriving from the client side');
});

const readSource = (): string =>
  readFileSync(new URL('../queue.ts', import.meta.url), 'utf8');
