/* Competitive Constructed (doc 22 §3.1) — how the rules reach the engine.
 *
 * `createGame`'s eighth argument, `rules {sequential, initiative}`: absent on
 * every existing call, so every existing deal is untouched; `sequential` is
 * stamped on the state (constructed only) and read from there on; a chosen
 * initiative (games 2-3, the previous game's loser chooses) still DRAWS the
 * roll, so the RNG stream and every shuffle stay the seed's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { createGame, replay } from '../src/apply.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import type { CardName, GameMode, GameRules, Seat } from '../src/types.ts';
import { randomDeck } from './cc-walk.ts';

const decks = (): [CardName[], CardName[]] => [DECK_LIST.slice(0, 30), DECK_LIST.slice(30, 60)];
const deal = (seed: number, rules?: GameRules) =>
  createGame(seed, ['Ann', 'Bob'], 'constructed', undefined, decks(), undefined, undefined, rules);

test('CC rules: no rules and empty rules deal byte-identical games in every mode', () => {
  for (const mode of ['shared', 'draft', 'constructed'] as GameMode[]) {
    const d = mode === 'constructed' ? decks() : undefined;
    for (const seed of [1, 7, 42]) {
      const plain = createGame(seed, undefined, mode, undefined, d);
      const none = createGame(seed, undefined, mode, undefined, d, undefined, undefined, undefined);
      const empty = createGame(seed, undefined, mode, undefined, d, undefined, undefined, {});
      assert.equal(JSON.stringify(none), JSON.stringify(plain), `${mode} ${seed}: rules undefined`);
      assert.equal(JSON.stringify(empty), JSON.stringify(plain), `${mode} ${seed}: rules {}`);
      assert.equal('sequential' in plain.state, false, 'no stamp on a house-rules game');
    }
  }
});

test('CC rules: sequential is stamped on a constructed or draft state; only constructed may choose the initiative', () => {
  assert.equal(deal(5, { sequential: true }).state.sequential, true);
  // report #356: Competitive is the rules set on Draft too
  assert.equal(createGame(5, undefined, 'draft', undefined, undefined, undefined, undefined, { sequential: true }).state.sequential, true);
  assert.throws(() => createGame(5, undefined, 'shared', undefined, undefined, undefined, undefined, { sequential: true }), /constructed or draft mode/);
  for (const mode of ['shared', 'draft'] as GameMode[]) {
    assert.throws(() => createGame(5, undefined, mode, undefined, undefined, undefined, undefined, { initiative: 1 }), /constructed mode/);
  }
  assert.throws(() => deal(5, { initiative: 2 as Seat }), /seat/);
  assert.throws(() => deal(5, { sequential: false as never }), /true or absent/);
});

test('CC rules: the sequential stamp changes nothing in the deal itself', () => {
  for (const seed of [3, 11, 2026]) {
    const plain = deal(seed).state, cc = deal(seed, { sequential: true }).state;
    const { sequential, ...rest } = cc;
    assert.equal(sequential, true);
    assert.equal(JSON.stringify(rest), JSON.stringify(plain), `seed ${seed}: only the stamp differs`);
  }
});

test('CC rules: a chosen initiative keeps the RNG stream, the same shuffle with the chosen seat', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const d: [CardName[], CardName[]] = [randomDeck(seed), randomDeck(seed + 1)];
    const rolled = createGame(seed, undefined, 'constructed', undefined, d).state;
    for (const pick of [0, 1] as Seat[]) {
      const chosen = createGame(seed, undefined, 'constructed', undefined, d, undefined, undefined, { sequential: true, initiative: pick }).state;
      assert.equal(chosen.initiative, pick, `seed ${seed}: the chosen seat holds the initiative`);
      assert.equal(chosen.rngState, rolled.rngState, `seed ${seed}: the roll was still drawn`);
      assert.deepEqual(chosen.decks, rolled.decks, `seed ${seed}: the same shuffle`);
      assert.deepEqual(chosen.players.map(p => p.hand), rolled.players.map(p => p.hand), `seed ${seed}: the same hands`);
    }
  }
  // and the roll alone still decides when nothing is chosen
  const seen = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(seed => deal(seed, { sequential: true }).state.initiative));
  assert.equal(seen.size, 2, 'a random game 1 lands on both seats across seeds');
});

test('CC rules: replay and the Harness carry the rules', () => {
  const r = replay(9, [], ['Ann', 'Bob'], 'constructed', undefined, decks(), undefined, undefined, { sequential: true, initiative: 1 });
  assert.equal(r.state.sequential, true);
  assert.equal(r.state.initiative, 1);
  const h = new Harness(9, ['Ann', 'Bob'], 'constructed', undefined, decks(), undefined, undefined, { sequential: true, initiative: 0 });
  assert.equal(h.state.sequential, true);
  assert.equal(h.state.initiative, 0);
  // a replay of a CC log needs its rules: without them it is a house-rules game
  assert.equal(replay(9, [], ['Ann', 'Bob'], 'constructed', undefined, decks()).state.sequential, undefined);
});
