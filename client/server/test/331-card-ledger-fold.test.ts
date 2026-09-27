/* CARD STATS §2 — ONE ACTION'S CARD FACTS, AND THE LEDGER FOLDED FROM THEM.
 *
 * `cardFact` is taken off real engine states here, one action at a time, so
 * the meaning of each move is pinned against the engine and not against a
 * hand-written guess at it: a draft commit's picks and give-backs, a
 * constructed bottom, a recycle, a play. `ledgerOf` is then a pure fold.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, createGame, legalActions } from '../../engine/src/apply.ts';
import type { Action, GameState } from '../../engine/src/types.ts';
import { readFileSync } from 'node:fs';
import { cardFact, cardOpen, ledgerOf, type CardFact } from '../cardledger.ts';

const DEFAULT_DECKS = JSON.parse(readFileSync(new URL('../default-decks.json', import.meta.url), 'utf8')) as { cards: string[] }[];

const step = (s: GameState, a: Action): { next: GameState; fact: CardFact } => {
  const r = apply(s, a);
  return { next: r.state, fact: cardFact(s, r.state, a, r.events) };
};

test('a draft commit that swaps: the pack card is PICKED, the hand card is GIVEN, the whole pack was OFFERED', () => {
  const g = createGame(99, ['A', 'B'], 'draft', ['fire', 'water', 'earth']);
  const s = g.state;
  const hand = s.players[0]!.hand, pack = s.packs[0]!;
  // keep everything in the pack except pack[0], and send hand[0] in its place
  const packIndices = [0, ...pack.map((_, i) => hand.length + i).filter(i => i !== hand.length)];
  const { fact } = step(s, { type: 'draftCommit', seat: 0, packIndices });
  assert.deepEqual(fact.pk?.[0], 0);
  assert.equal(fact.pk?.[2], 0, 'a fresh pack has had no merges before this one');
  assert.deepEqual(fact.pk?.[3], pack);
  assert.deepEqual(fact.m, [[0, pack[0], 'P', 'H'], [0, hand[0], 'H', 'P']]);

  const l = ledgerOf(cardOpen(s), [fact], undefined, 'live');
  assert.equal(l.seats[0].picked[pack[0]!], 1);
  assert.equal(l.seats[0].given[hand[0]!], 1);
  assert.equal(Object.values(l.seats[0].offered).reduce((a, b) => a + b, 0), pack.length);
  assert.equal(l.seats[0].seen[pack[0]!], (hand.includes(pack[0]!) ? 2 : 1), 'a pick is a card that entered the hand');
  assert.deepEqual(l.seats[1].picked, {}, 'the other seat took nothing');
});

test('a recycle and a play are named, with the turn played on', () => {
  let s = createGame(7, ['A', 'B'], 'draft', ['fire', 'water', 'earth']).state;
  const facts: CardFact[] = [];
  let x = 17;
  const rnd = (k: number): number => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x % k; };
  for (let i = 0; i < 400 && !facts.some(f => f.m?.some(m => m[3] === 'X')); i++) {
    const legal = [...legalActions(s, 0), ...legalActions(s, 1)].filter(a => a.type !== 'concede');
    if (!legal.length) break;
    const a = legal.find(x => x.type === 'playCard') ?? legal[rnd(legal.length)]!;
    const r = step(s, a);
    facts.push(r.fact);
    s = r.next;
  }
  const played = facts.find(f => f.m?.some(m => m[3] === 'X'));
  assert.ok(played, 'no card was ever played — untested');
  const [seat, card] = played.m!.find(m => m[3] === 'X')!;
  const me = ledgerOf(null, facts, undefined, 'live').seats[seat]!;
  assert.ok(me.played[card]! >= 1);
  assert.equal(me.firstTurn[card], played.t);
  const l = ledgerOf(null, facts, undefined, 'live');
  assert.ok(Object.keys(l.seats[0].recycled).length + Object.keys(l.seats[1].recycled).length > 0, 'nothing recycled — untested');
});

test('constructed: the opening is the first decision\'s 8 cards, and the two put back are BOTTOMED', () => {
  const deck = DEFAULT_DECKS[0]!.cards;
  const s = createGame(3, ['A', 'B'], 'constructed', ['fire', 'water', 'earth'], [deck, deck]).state;
  const open = cardOpen(s);
  assert.equal(open.hands[0].length, 8, 'dealt 4, plus turn 1\'s draw of 4, before the first bottom');
  const put = [open.hands[0][0]!, open.hands[0][1]!];
  const { fact } = step(s, { type: 'bottomCards', seat: 0, handIndices: [0, 1] });
  assert.deepEqual(fact.m, put.map(c => [0, c, 'H', 'U']));
  const l = ledgerOf(open, [fact], [deck, deck], 'live');
  assert.equal(Object.values(l.seats[0].deck).reduce((a, b) => a + b, 0), deck.length);
  assert.equal(Object.values(l.seats[0].bottomed).reduce((a, b) => a + b, 0), 2);
});
