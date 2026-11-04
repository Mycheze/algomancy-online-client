/* 1103 — THE SAMPLE OPENING HAND (BL-65 W0, architecture §0 ruling 9): the
 * builder's Stats sheet deals a sample hand the way a constructed game does.
 *
 * §1 CONSTRUCTED_OPENING_HAND is what a real constructed game deals (createGame,
 *    before turn 1's draw phase) — the export cannot drift from the deal
 * §2 sampleOpeningHand: that many cards off a shuffled COPY (the deck is not
 *    touched); a seed always deals the same hand, the engine's own shuffle;
 *    an rng function works too; a short deck deals what it has
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { createGame } from '../src/apply.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { CONSTRUCTED_OPENING_HAND, sampleOpeningHand } from '../src/challenge.ts';
import { rngShuffle } from '../src/rng.ts';
import type { CardName } from '../src/types.ts';

const DECK: CardName[] = DECK_LIST.slice(0, 30);

test('1103 §1 the exported hand size is the constructed deal', () => {
  const { state } = createGame(110300, ['A', 'B'], 'constructed', undefined, [[...DECK], [...DECK]]);
  // createGame deals the opening hand, then startTurn's draw phase draws 4 more (the bottom 2 still pending)
  assert.equal(CONSTRUCTED_OPENING_HAND, 4);
  assert.equal(state.players[0]!.hand.length, CONSTRUCTED_OPENING_HAND + 4, 'seat 0 holds the opening hand and turn 1\'s draw');
});

test('1103 §2 sampleOpeningHand: a shuffled copy, seeded or not', () => {
  const before = [...DECK];
  const a = sampleOpeningHand(DECK, 7);
  assert.deepEqual(DECK, before, 'the deck is not touched');
  assert.equal(a.length, CONSTRUCTED_OPENING_HAND);
  assert.deepEqual(sampleOpeningHand(DECK, 7), a, 'a seed always deals the same hand');
  assert.deepEqual(a, rngShuffle(DECK, 7)[0].slice(0, CONSTRUCTED_OPENING_HAND), 'the engine\'s own shuffle');
  const hands = new Set(Array.from({ length: 20 }, (_, s) => sampleOpeningHand(DECK, s).join('|')));
  assert.ok(hands.size > 15, 'different seeds deal different hands');
  for (const h of hands) for (const c of h.split('|')) assert.ok(DECK.includes(c), 'every card is from the deck');
  // a counted multiset: never more copies than the deck holds
  const dup: CardName[] = ['A', 'A', 'B', 'C', 'D', 'E'];
  for (let s = 0; s < 50; s++) assert.ok(sampleOpeningHand(dup, s).filter(c => c === 'A').length <= 2);
  let calls = 0;
  const fn = sampleOpeningHand(DECK, () => { calls++; return 0.5; });
  assert.equal(fn.length, CONSTRUCTED_OPENING_HAND);
  assert.equal(calls, DECK.length - 1, 'an rng function drives a Fisher-Yates over the whole copy');
  assert.deepEqual(sampleOpeningHand(DECK.slice(0, 2), 1), sampleOpeningHand(DECK.slice(0, 2), 1));
  assert.equal(sampleOpeningHand(DECK.slice(0, 2), 1).length, 2, 'a short deck deals what it has');
  assert.equal(sampleOpeningHand(DECK, 1, 8).length, 8, 'the caller may ask for more (opening hand + turn 1\'s draw)');
  assert.deepEqual(sampleOpeningHand([], 1), []);
});
