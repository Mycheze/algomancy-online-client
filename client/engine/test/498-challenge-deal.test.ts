/* WEEKLY CHALLENGES — the deal (client/docs/21-weekly-challenges.md, "The game
 * a challenge deals"; src/challenge.ts).
 *
 * A challenge game is a constructed game with a lesson deal (CR D8.1): the
 * player's deck dealt exactly as arranged, with the REAL constructed card step
 * (opening 4, then draw 4 / bottom 2 every turn) — the lesson deal's per-seat
 * `cardStep` knob — against a dummy with no cards, no Shards, no Prismites and
 * 99 life. The knob is optional and absent from every Learn to Play deal, and
 * §5 holds those games to exactly the state they had before it existed.
 *
 * Seeds 49800-49899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { createGame } from '../src/apply.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import { sanitizeLessonDeal, type LessonDeal } from '../src/lessondeal.ts';
import {
  DUMMY, DUMMY_DECK, PLAYER, challengeDeal, checkChallengeDeck, dummyMove, newChallengeGame, settleDummy,
  type ChallengeDef,
} from '../src/challenge.ts';
import type { Action, CardName } from '../src/types.ts';
import type { Harness } from '../src/harness.ts';

const def = (seed: number): ChallengeDef => ({
  id: `t${seed}`, week: '2026-10-25', title: 'Test', blurb: '', goal: { kind: 'unitsInPlay', n: 40 }, seed, par: 100,
});
/** forty distinct deck cards, in registration order — a deck whose order is visible */
const DECK: CardName[] = DECK_LIST.slice(0, 40);

/** finish the player's planning (bottoming the last two cards) and walk to the next turn's planning */
function nextTurn(h: Harness): void {
  const turn = h.state.turn;
  for (let i = 0; i < 200 && h.state.turn === turn && h.state.phase !== 'gameover'; i++) {
    settleDummy(h);
    if (h.state.turn !== turn) break;
    const legal = h.legal(PLAYER);
    const hand = h.state.players[PLAYER]!.hand;
    const a = legal.find(x => x.type === 'bottomCards' && x.handIndices.join() === `${hand.length - 2},${hand.length - 1}`)
      ?? legal.find(x => x.type === 'donePlanning' || x.type === 'doneHaste' || x.type === 'doneDeploying' || x.type === 'passPriority')
      ?? legal.find(x => x.type === 'declareAttack' && x.columns.length === 0)
      ?? legal.find(x => x.type === 'declareBlocks');
    assert.ok(a, `the player has a way on (phase ${h.state.phase})`);
    h.do(a as Action);
  }
  settleDummy(h);
}

test('§1 seat 0 gets the stacked order and the real constructed card step on turn 1', () => {
  const h = newChallengeGame(def(49800), DECK);
  const me = h.state.players[PLAYER]!;
  assert.deepEqual(me.hand, DECK.slice(0, 8), 'opening 4 + turn 1 draw 4, off the top in order');
  assert.deepEqual(h.state.decks![PLAYER], DECK.slice(8), 'the rest of the deck, still in order');
  assert.deepEqual(h.state.bottomDone, [false, true], 'the player owes the bottom step; the dummy does not');
  assert.ok(h.legal(PLAYER).every(a => a.type === 'bottomCards'), 'nothing else until two cards go back');
  assert.equal(me.life, 30);
  assert.deepEqual(me.resources, [{ kind: 'prismite', state: 'dormant' }, { kind: 'prismite', state: 'dormant' }]);
  assert.equal(h.state.initiative, PLAYER);
  // the same card step as a real constructed game: 8 in hand, bottoming pending for everyone
  const real = createGame(49800, undefined, 'constructed', undefined, [DECK.slice(0, 30), DECK.slice(10, 40)]).state;
  assert.equal(real.players[0]!.hand.length, me.hand.length, 'the constructed opening hand + draw');
  assert.deepEqual(real.bottomDone, [false, false]);
});

test('§2 seat 1 has no cards, no shards, no prismites and 99 life, and stays that way', () => {
  const h = newChallengeGame(def(49801), DECK);
  const check = () => {
    const d = h.state.players[DUMMY]!;
    assert.deepEqual(d.hand, [], `turn ${h.state.turn}: no hand`);
    assert.deepEqual(d.resources, [], `turn ${h.state.turn}: no resources`);
    assert.equal(d.life, 99);
  };
  check();
  assert.deepEqual(h.state.decks![DUMMY]!.length, DUMMY_DECK.length, 'the dummy never drew');
  assert.deepEqual(h.legal(DUMMY), [], 'newChallengeGame leaves the dummy settled');
  for (let t = 0; t < 3; t++) { nextTurn(h); check(); }
  assert.equal(h.state.turn, 4);
  assert.deepEqual(h.state.decks![DUMMY]!.length, DUMMY_DECK.length, 'still never drew');
});

test('§3 later turns: the player draws 4 off the top and owes 2 back, every turn', () => {
  const h = newChallengeGame(def(49802), DECK);
  nextTurn(h);   // turn 1: DECK[6], DECK[7] went to the bottom (past the mark)
  assert.equal(h.state.turn, 2);
  assert.deepEqual(h.state.players[PLAYER]!.hand, [...DECK.slice(0, 6), ...DECK.slice(8, 12)]);
  assert.deepEqual(h.state.bottomDone, [false, true]);
  nextTurn(h);
  assert.equal(h.state.turn, 3);
  assert.deepEqual(h.state.players[PLAYER]!.hand, [...DECK.slice(0, 6), ...DECK.slice(8, 10), ...DECK.slice(12, 16)]);
  assert.deepEqual(h.state.decks![PLAYER], DECK.slice(16), 'the bottomed cards wait past the mark, not in the deck');
});

test('§4 checkChallengeDeck: the real deck pool, 1 to 200 cards, no floor and no copy cap', () => {
  const lessonOnly = 'Training Construct';
  assert.equal(getCard(lessonOnly).lessonOnly, true);
  assert.equal(checkChallengeDeck([lessonOnly]).ok, false, 'a lesson-only card is refused');
  assert.equal(checkChallengeDeck(['Unit Token']).ok, false, 'a token is refused');
  assert.equal(checkChallengeDeck(['Fire Resource']).ok, false, 'a resource face is refused');
  assert.equal(checkChallengeDeck(['No Such Card']).ok, false, 'an unknown name is refused');
  assert.equal(checkChallengeDeck([]).ok, false, 'an empty deck is refused');
  assert.equal(checkChallengeDeck(Array.from({ length: 201 }, () => DECK[0]!)).ok, false, 'over 200 is refused');
  assert.equal(checkChallengeDeck('Ignis Sprite').ok, false, 'not a list');
  assert.equal(checkChallengeDeck([1, 2]).ok, false, 'not names');
  assert.deepEqual(checkChallengeDeck(['Ignis Sprite']), { ok: true, cards: ['Ignis Sprite'] }, 'one card is a deck');
  const sixty = Array.from({ length: 60 }, () => 'Ignis Sprite');
  assert.deepEqual(checkChallengeDeck(sixty), { ok: true, cards: sixty }, 'sixty copies of one card');
  const r = checkChallengeDeck(['Counter Theif', 'Ignis Sprite']);
  assert.ok(r.ok && r.cards[0] === 'Counter Thief', 'an alias comes back canonical, in place');
  // a one-card deck deals and plays
  const h = newChallengeGame(def(49803), ['Ignis Sprite']);
  assert.deepEqual(h.state.players[PLAYER]!.hand, ['Ignis Sprite']);
  assert.deepEqual(h.state.bottomDone, [false, true], 'one card to put back: fewer only when the hand is shorter');
  assert.throws(() => newChallengeGame(def(49803), ['Training Construct']), /not a deck card/);
});

test('§5 a lesson deal without the knob is the deal it always was', () => {
  const LEARNER = DECK.slice(0, 30);
  const BOT = Array.from({ length: 40 }, () => 'Training Construct');
  const deal: LessonDeal = {
    openingHand: [4, 1], drawPerTurn: [2, 1], stacked: [true, false],
    shardsPerTurn: [0, 1], firstShardTurn: 1, shardState: 'open',
    prismites: [2, 0], startingLife: [30, 30], initiative: 0,
  };
  assert.ok(!('cardStep' in sanitizeLessonDeal(deal)!), 'no knob, no key');
  assert.ok(!('cardStep' in sanitizeLessonDeal({ ...deal, cardStep: ['lesson', 'lesson'] })!), 'the default spelled out is no key either');
  assert.deepEqual(sanitizeLessonDeal({ ...deal, cardStep: ['constructed', 'nonsense'] })!.cardStep, ['constructed', 'lesson']);
  const plain = createGame(49804, ['L', 'B'], 'constructed', undefined, [LEARNER, BOT], undefined, deal);
  const spelled = createGame(49804, ['L', 'B'], 'constructed', undefined, [LEARNER, BOT], undefined,
    { ...deal, cardStep: ['lesson', 'lesson'] });
  assert.deepEqual(spelled.state, plain.state, 'byte-identical state');
  assert.ok(!('cardStep' in plain.state.lesson!), 'GameState.lesson carries no new key');
  assert.equal(plain.state.players[0]!.hand.length, 6, 'learner: 4 dealt + 2 drawn, as before');
  assert.equal(plain.state.bottomDone, null, 'no bottom step');
  // both seats on the constructed step: the plain constructed draw phase for each
  const both = createGame(49805, ['L', 'B'], 'constructed', undefined, [LEARNER, LEARNER], undefined,
    { ...deal, openingHand: [4, 4], cardStep: ['constructed', 'constructed'] });
  assert.deepEqual(both.state.bottomDone, [false, false]);
  assert.deepEqual(both.state.players.map(p => p.hand.length), [8, 8]);
});

test('§6 the challenge deal is the spec table', () => {
  const d = challengeDeal(def(49806));
  assert.deepEqual(d.openingHand, [4, 0]);
  assert.deepEqual(d.drawPerTurn[DUMMY], 0);
  assert.deepEqual(d.stacked, [true, false]);
  assert.deepEqual(d.shardsPerTurn, [0, 0]);
  assert.deepEqual(d.prismites, [2, 0]);
  assert.deepEqual(d.startingLife, [30, 99]);
  assert.equal(d.initiative, PLAYER);
  assert.deepEqual(d.cardStep, ['constructed', 'lesson']);
  assert.ok(DUMMY_DECK.length > 0 && DUMMY_DECK.every(n => getCard(n).lessonOnly), 'the dummy deck is lesson-only cards');
});

test('§7 dummyMove is the most passive legal action', () => {
  const h = newChallengeGame(def(49807), DECK);
  // the dummy finished planning at once
  assert.deepEqual(h.actions, [{ type: 'donePlanning', seat: DUMMY }]);
  assert.throws(() => dummyMove(h.state, h.legal(DUMMY)), /no move/);
  const offers: Action[] = [
    { type: 'declareAttack', seat: DUMMY, columns: [[5], [6]] },
    { type: 'declareAttack', seat: DUMMY, columns: [] },
    { type: 'declareAttack', seat: DUMMY, columns: [[5]] },
  ];
  assert.deepEqual(dummyMove(h.state, offers), { type: 'declareAttack', seat: DUMMY, columns: [] });
  assert.deepEqual(dummyMove(h.state, [
    { type: 'decide', seat: DUMMY, choice: 1 }, { type: 'passPriority', seat: DUMMY },
  ]), { type: 'passPriority', seat: DUMMY });
  assert.deepEqual(dummyMove(h.state, [
    { type: 'decide', seat: DUMMY, choice: 0 }, { type: 'decide', seat: DUMMY, choice: 1 },
  ]), { type: 'decide', seat: DUMMY, choice: 0 }, 'a question: its first answer');
});
