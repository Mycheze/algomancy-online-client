/* BL-01 / BL-02 — THE CLIENT HALF OF THE MATCHMAKING QUEUE.
 *
 * The server lane has its own two guards (server/test-queue.ts and
 * server/test-elo.ts) and they cover the rules. This file covers the three
 * things that live only in the browser, plus one thing that lives in both and
 * is therefore the most likely of the lot to go quietly wrong.
 *
 * §1 the wording rules — an empty queue is an invitation, not "0 waiting",
 *    and a band with no limit is a word rather than a very large number
 * §2 who may queue, and why not — the constructed gate is the same gate the
 *    home screen already applies, and the signed-out refusal is a sentence
 * §3 ⭐ THE CLOCK-DEFAULT LOCK. `MATCH_CLOCK_MS` (server/rooms.ts) and
 *    `CLOCK_DEFAULT_BY_MODE` (ui/main.ts) are the same table written twice,
 *    because the browser bundle cannot import from server/. Two copies of a
 *    number is exactly the thing this repo has already been bitten by, and
 *    the failure here is silent and asymmetric: change the UI's copy and a
 *    matchmade game quietly keeps the old bank while every screen says the
 *    new one.
 * §4 the queue reaches the player — the home strip, and the post-game button
 *    that has been `disabled` since the day that screen was built
 *
 * No seeds: nothing here deals a board.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MATCH_CLOCK_MS } from '../../server/rooms.ts';
import {
  bandLabel, countsSummary, MODES, MODE_LABEL, queueBlocker, waitLabel,
} from '../../ui/queue.ts';

const MAIN = readFileSync(new URL('../../ui/main.ts', import.meta.url), 'utf8');
const POSTGAME = readFileSync(new URL('../../ui/postgame.ts', import.meta.url), 'utf8');

/* ══ §1 — how the queue reads ══════════════════════════════════════════ */

test('BL-01 §1 an empty queue is an invitation, and a real one is a count', () => {
  // ⚠ THE ZERO CASE IS THE ONE THAT MATTERS. On a deploy this size the honest
  // answer most of the time is nobody, and "0 waiting" reads as a broken
  // feature rather than as a thing to do. The count must still be exact the
  // moment there is one — this is a wording rule, not a rounding one.
  const empty = countsSummary({ total: 0, byMode: { constructed: 0, draft: 0 } });
  assert.doesNotMatch(empty, /\b0\b/,
    'an empty queue is being shown as a number — "0 waiting" is how a live feature reads as a '
    + 'dead one to the first person who arrives');
  assert.match(empty, /first/i, 'and it should invite them to be the first');

  const some = countsSummary({ total: 3, byMode: { constructed: 1, draft: 2 } });
  assert.match(some, /3 waiting/, 'three waiting says three');
  assert.match(some, /Constructed 1/, 'and breaks down by format');
  assert.match(some, /Live draft 2/, 'both of them');

  // a format nobody is queueing for is left out rather than shown as 0, for
  // the same reason the total is
  const one = countsSummary({ total: 2, byMode: { constructed: 0, draft: 2 } });
  assert.doesNotMatch(one, /Constructed/,
    'an empty FORMAT is being listed at 0 — the breakdown should name what is there');
  assert.match(one, /Live draft 2/, 'and still name what is');

  assert.match(countsSummary(null), /checking/i,
    'before the first poll answers it should say it is looking, not claim the queue is empty');
});

test('BL-01 §1 "anyone" is a word, not a very large number', () => {
  // The band widens to no limit at all, and that state has to be nameable: a
  // ± with a huge number in it reads as a bug, and the player is being shown
  // this line precisely so the wide match at three minutes is something they
  // watched happen.
  assert.equal(bandLabel(null), 'anyone');
  assert.equal(bandLabel(100), '±100');
  assert.equal(bandLabel(300), '±300');

  assert.equal(waitLabel(0), '0:00', 'a fresh search reads 0:00');
  assert.equal(waitLabel(64_000), '1:04', 'and a minute and four seconds reads 1:04');
  assert.equal(waitLabel(-500), '0:00', 'a clock skew must not print a negative wait');
});

/* ══ §2 — who may queue ════════════════════════════════════════════════ */

test('BL-01 §2 queueing signed out is refused WITH A REASON', () => {
  // BL-01 asks for this by name. The failure mode a queue cannot afford is
  // "nothing happened when I clicked": from the player's side that is
  // indistinguishable from an empty queue, and they will wait in it.
  for (const mode of MODES) {
    const why = queueBlocker(mode, false, true);
    assert.ok(why, `${mode}: signed out is not blocked at all`);
    assert.match(why, /sign in/i, `${mode}: the refusal does not say what to do about it`);
  }
});

test('BL-01 §2 constructed needs a deck; draft does not', () => {
  // ⚠ Sharper here than on the home screen. A room made from a code opens a
  // deck-picker lobby, so a player can bring one late; a matchmade constructed
  // game DEALS the instant both sides accept, and there is no lobby to fall
  // back into. The gate has to be at queue time.
  assert.ok(queueBlocker('constructed', true, false), 'constructed with no deck must be blocked');
  assert.match(queueBlocker('constructed', true, false)!, /deck/i, 'and say so');
  assert.equal(queueBlocker('constructed', true, true), null, 'with a deck it is fine');
  assert.equal(queueBlocker('draft', true, false), null,
    'a live draft needs no deck — the whole format is drafting one');
});

test('BL-01 §2 the queue offers exactly the two rated formats', () => {
  // `shared` is the quick shared-pool deal: link-only, and never rated. It
  // must not appear as something to queue for, or a player could earn a rating
  // in a format the ladder does not have a column for.
  assert.deepEqual([...MODES], ['constructed', 'draft']);
  assert.ok(!Object.keys(MODE_LABEL).includes('shared'),
    'the shared-pool mode is being offered in the queue — it is not a rated format');
});

/* ══ §3 — ⭐ THE CLOCK-DEFAULT LOCK ════════════════════════════════════ */

test('BL-01 §3 the matchmade clock matches the UI\'s per-format defaults', () => {
  /* Why this is a guard and not a comment.
   *
   * A matchmade game must NOT use either player's `algoClockMs`: whoever's
   * setting won would be choosing for a stranger who never saw it, and one
   * player's "Off" would hand the other an untimed RATED game — which
   * silently disables BL-27, the rule that makes a stalled rated game end in
   * a result instead of in silence. So the server has its own table.
   *
   * Two copies of a number is the thing that rots. The failure is quiet: the
   * client would go on displaying 45m while the server dealt something else,
   * and nothing in either suite would notice.
   */
  const table = /const CLOCK_DEFAULT_BY_MODE: Record<string, number> = \{([^}]*)\}/.exec(MAIN);
  assert.ok(table, 'CLOCK_DEFAULT_BY_MODE has moved or been renamed in ui/main.ts — this lock '
    + 'is now checking nothing, which is worse than not having it');

  const read = (mode: string): number => {
    const m = new RegExp(`${mode}:\\s*([0-9_]+)\\s*\\*\\s*([0-9_]+)`).exec(table![1]!);
    assert.ok(m, `the UI's default for ${mode} is not in the shape this lock can read`);
    return Number(m![1]!.replace(/_/g, '')) * Number(m![2]!.replace(/_/g, ''));
  };

  assert.equal(read('constructed'), MATCH_CLOCK_MS.constructed,
    'the constructed bank the queue deals and the one the home screen offers have come apart');
  assert.equal(read('draft'), MATCH_CLOCK_MS.draft,
    'the draft bank the queue deals and the one the home screen offers have come apart');

  // and the owner's own numbers, so a matching pair of WRONG values still fails
  assert.equal(MATCH_CLOCK_MS.constructed, 45 * 60_000,
    'constructed is 45m (owner, 2026-09-01: "the default for constructed is 45m")');
  assert.equal(MATCH_CLOCK_MS.draft, 60 * 60_000,
    'live draft is 60m (owner, same answer: "the default for live draft is 60m")');
  assert.ok(MATCH_CLOCK_MS.draft > MATCH_CLOCK_MS.constructed,
    'a draft game includes the draft, so it gets the longer bank');
});

/* ══ §4 — the queue actually reaches the player ════════════════════════ */

test('BL-01 §4 the home screen shows the queue, and the post-game button is alive', () => {
  assert.match(MAIN, /mm\.stripHtml\(/,
    'the home screen no longer paints the queue strip — the at-a-glance count is the half of '
    + 'this feature a visitor sees without clicking anything');
  assert.match(MAIN, /mm\.startCountsPoll\(\)/,
    'nothing refreshes the count, so it is whatever it was when the page loaded');
  assert.match(MAIN, /if \(mm\.screen\(\)\)/,
    'the queue screen is not in renderHome\'s screen chain, so it can never be shown');
  assert.match(MAIN, /if \(mm\.handleButton\(btn\)\) return;/,
    'nothing routes queue- clicks, so every button on that screen is inert');

  // ⭐ the button that was disabled from the day the post-game screen was
  // built ("not built yet — for when there are more than two of us")
  assert.doesNotMatch(POSTGAME, /disabled[^>]*>\s*Join matchmaking queue/,
    'the post-game "Join matchmaking queue" button is still disabled — it was a placeholder for '
    + 'exactly this feature and is the natural place to want another game from');
  assert.match(POSTGAME, /data-btn="pg-queue"/, 'and it needs a handler to be worth enabling');
  assert.match(POSTGAME, /case 'pg-queue':/, 'which has to be routed');
});

test('BL-02 §4 the queue explains what is rated, where it is claimed', () => {
  const ACCOUNT = readFileSync(new URL('../../ui/account.ts', import.meta.url), 'utf8');
  // Two friends passing a room code cannot move a rating, and a player who
  // does not know that will assume their games are counting and be wrong
  // about their own numbers. It is a rule, so it has to be written down where
  // the numbers are read.
  assert.match(ACCOUNT, /matchmaking queue<\/b>[\s\S]{0,200}rated/,
    'the ladder does not say that only queue games are rated — the one thing a player has to '
    + 'know to make sense of a rating that has not moved');
  assert.match(ACCOUNT, /Constructed and live draft are rated separately/,
    'nor that the two formats are separate boards');
});
