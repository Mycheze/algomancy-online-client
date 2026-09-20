/* THE PROPHECY METER — live report 2026-09-05, room VNNW action 131, ux / medium:
 *
 *   "For cards prophesied, you can't tell how many turns are left or how
 *    'close' you are to being able to play it. So here my Hooba-God just says
 *    '4 turns pass' but I have no way to check how many already passed."
 *
 * The number existed — R43 stamps the turn a card was prophesied on and the
 * fulfilment test reads `turn - stamp >= n` — and nothing showed it. Now:
 *
 *   §1 the engine says how far along a COUNTING prophecy is (turns, battles),
 *      read off the same delta `prophecyMet` reads, and says nothing for a
 *      state condition or a fulfilled one
 *   §2 the cache dialog wears it: the chip "⏳ 1/4 turns" and the sentence
 *      "— 3 turns to go" under the card, and once fulfilled the ✓ and no meter
 *   §3 the control: a state condition still reads "⏳ not yet"
 *
 * Seeds 2940-2949.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { finishBattle, toDeployment, toNextBattle, withE } from '../../engine/test/util.ts';
import { client } from './ui-driver.ts';

const ui = await client();

/** seat 0 mid-deployment with Hooba-God cached under "4 Turns Pass" (the
 * VNNW shape — Prophecy Bug computes the count) and a state-condition card */
function cached(seed = 2940): Harness {
  const h = new Harness(seed);
  toDeployment(h);
  withE(h, e => {
    e.cacheCard(0, 'Hooba-God', 'effect', { prophecy: '4 Turns Pass' });
    e.cacheCard(0, 'Wisp', 'effect', { prophecy: 'Your life is 10 or less' });
  });
  return h;
}

test('§1 the engine meters a counting prophecy off the same delta the fulfilment test reads', () => {
  const h = cached();
  const p = h.state.players[0]!.cache![0]!.prophecy!;
  assert.deepEqual(h.q.prophecyProgress(0, p), { done: 0, need: 4, unit: 'turn' }, 'just prophesied: 0 of 4');
  toNextBattle(h);                                           // a turn passes
  assert.deepEqual(h.q.prophecyProgress(0, p), { done: 1, need: 4, unit: 'turn' }, 'one turn later: 1 of 4');
  assert.equal(h.q.prophecyMet(0, p), false, 'and it is not met — the two agree');
  // a state condition has nothing to count
  const state = h.state.players[0]!.cache![1]!.prophecy!;
  assert.equal(h.q.prophecyProgress(0, state), null, 'a state condition has no meter');
  // once fulfilled (R44 latches) the meter is gone
  p.fulfilled = true;
  assert.equal(h.q.prophecyProgress(0, p), null, 'a fulfilled prophecy has no meter');
  // and the other counting unit
  const h2 = cached(2941);
  withE(h2, e => { e.cacheCard(1, 'Wisp', 'effect', { prophecy: 'Two Battles Pass' }); });
  const b = h2.state.players[1]!.cache![0]!.prophecy!;
  assert.deepEqual(h2.q.prophecyProgress(1, b), { done: 0, need: 2, unit: 'battle' }, 'battles count too');
});

test('§2 the cache dialog shows how far along it is, and drops the meter once fulfilled', () => {
  const h = cached(2942);
  toNextBattle(h);                                           // 1 of 4
  ui.join(h.state, 0, []);
  const html = ui.click({ btn: 'cacheopen', p: 0 });
  assert.match(html, /⏳ 1\/4 turns/, 'the chip says how many of the turns have passed');
  assert.match(html, /4 Turns Pass — 3 turns to go/, 'the sentence under the card says how many are left');
  assert.doesNotMatch(html, /⏳ not yet/.source.length ? /Hooba-God[\s\S]{0,400}⏳ not yet/ : /$^/,
    'the counting card no longer says only "not yet"');
  // fulfil it: three more turns
  for (let i = 0; i < 3; i++) { finishBattle(h); toNextBattle(h); }
  const after = ui.update(h.state, []);
  const dialog = after.includes('cacheopen') ? ui.click({ btn: 'cacheopen', p: 0 }) : after;
  assert.match(dialog, /✓ fulfilled/, 'the ✓ once the count is reached');
  assert.doesNotMatch(dialog, /turns to go/, 'and no meter beside a fulfilled card');
});

test('§3 the control: a state condition still reads "not yet" with no meter', () => {
  const h = cached(2943);
  ui.join(h.state, 0, []);
  const html = ui.click({ btn: 'cacheopen', p: 0 });
  assert.match(html, /Your life is 10 or less/, 'the state condition is on screen');
  assert.match(html, /⏳ not yet/, 'and it is "not yet" — there is nothing to count');
  assert.doesNotMatch(html, /Your life is 10 or less — \d/, 'no "n to go" on a state condition');
});

// ── §4 R302: the meter is on the TABLE, not only inside the dialog ────
//
// Owner, 2026-09-20: "the tally and 'progress toward Prophecy working' needs
// to be VISIBLE to all players at all times". §2 above is the dialog, which
// you have to open. This is the zone line under the cache on the board, which
// you do not — and because R41 makes the cache public, it renders for the
// opponent's cache on the same terms as your own.

test('§4 the cache zone line meters a counting prophecy without opening anything', () => {
  const h = cached(2944);
  toNextBattle(h);                                           // 1 of 4
  ui.join(h.state, 0, []);
  const board = ui.update(h.state, []);
  assert.match(board, /⏳ 1\/4 turns/,
    'the board itself says how far along it is — no click required');
});

test('§4 it meters the OPPONENT\'s cache too — the zone is public (R41)', () => {
  const h = new Harness(2945);
  toDeployment(h);
  // seat 1's prophecy, watched from seat 0
  withE(h, e => { e.cacheCard(1, 'Hooba-God', 'effect', { prophecy: '4 Turns Pass' }); });
  toNextBattle(h);
  ui.join(h.state, 0, []);
  const board = ui.update(h.state, []);
  assert.match(board, /⏳ 1\/4 turns/,
    'seat 0 can see how close seat 1 is — a hidden clock on a public zone '
    + 'would be exactly the thing report VNNW complained about, one seat over');
});

test('§4 Vengeance\'s 13 deaths meter on the table like any other count (R302)', () => {
  const h = new Harness(2946);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  withE(h, e => { e.cacheCard(A, 'Vengeance', 'effect', { prophecy: '13 Units Die' }); });
  ui.join(h.state, A, []);
  assert.match(ui.update(h.state, []), /⏳ 0\/13 units/,
    'the longest condition in the pool is the one that most needs a meter');
});

test('§4 a state condition puts no meter on the board — there is nothing to count', () => {
  const h = new Harness(2947);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  withE(h, e => { e.cacheCard(A, 'Wisp', 'effect', { prophecy: 'Your life is 10 or less' }); });
  ui.join(h.state, A, []);
  const board = ui.update(h.state, []);
  assert.doesNotMatch(board, /cachemeter/,
    'no meter chip at all — the dialog still says "⏳ not yet", which is the '
    + 'honest thing to say about a condition with no progress to report');
});
