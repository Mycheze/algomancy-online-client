/* Draft trio selection + full-set completeness: with all five elements
 * scripted, every one of the 10 trios must be a Manual-exact deck
 * (54 per element + 5 per hybrid pair = 177), and createGame must honor a
 * chosen trio end to end. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { createGame, sanitizeTrio, ALL_ELEMENTS } from '../src/apply.ts';
import { draftDeckList } from '../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import type { Element } from '../src/types.ts';

const trios: Element[][] = [];
for (let i = 0; i < 5; i++) {
  for (let j = i + 1; j < 5; j++) {
    for (let k = j + 1; k < 5; k++) trios.push([ALL_ELEMENTS[i]!, ALL_ELEMENTS[j]!, ALL_ELEMENTS[k]!]);
  }
}

test('sanitizeTrio: valid trios pass, everything else falls back to fire+water+earth', () => {
  assert.deepEqual(sanitizeTrio(['wood', 'metal', 'fire']), ['fire', 'wood', 'metal'], 'canonical order');
  assert.deepEqual(sanitizeTrio(['fire', 'fire', 'water']), ['fire', 'water', 'earth'], 'dupes rejected');
  assert.deepEqual(sanitizeTrio(['fire', 'water']), ['fire', 'water', 'earth'], 'too few');
  assert.deepEqual(sanitizeTrio(['fire', 'water', 'earth', 'wood']), ['fire', 'water', 'earth'], 'too many');
  assert.deepEqual(sanitizeTrio('junk'), ['fire', 'water', 'earth'], 'not an array');
  assert.deepEqual(sanitizeTrio(['fire', 'plasma', 'water']), ['fire', 'water', 'earth'], 'unknown element');
});

test('ALL 10 trios are Manual-exact: 54 per element + 5 per hybrid pair = 177', () => {
  for (const trio of trios) {
    const deck = draftDeckList(trio);
    const byF: Record<string, number> = {};
    for (const n of deck) {
      const f = [...(getCard(n).factions ?? [])].sort().join('+');
      byF[f] = (byF[f] ?? 0) + 1;
    }
    for (const el of trio) assert.equal(byF[el], 54, `${trio.join('+')}: ${el} mono count (got ${byF[el] ?? 0})`);
    assert.equal(deck.length, 177, `${trio.join('+')}: total (got ${deck.length})`);
    assert.equal(new Set(deck).size, 177, `${trio.join('+')}: one copy each`);
  }
});

test('createGame honors the chosen trio: deck, elements, and the recycle menu', () => {
  const h = new Harness(3100, undefined, 'draft', ['wood', 'metal', 'fire']);
  assert.deepEqual(h.state.elements, ['fire', 'wood', 'metal'], 'canonical order in state');
  assert.equal(h.state.sharedDeck.length, 177 - 32, 'trio deck minus opening deal');
  // a full draft turn works in a wood/metal trio
  const H = h.state.players[0]!.hand.length;
  h.do({ type: 'draftCommit', seat: 0, packIndices: h.state.packs[0]!.map((_, i) => H + i) });
  h.do({ type: 'draftCommit', seat: 1, packIndices: h.state.packs[1]!.map((_, i) => H + i) });
  assert.equal(h.state.draftDone, null, 'packs passed');
  // resources are gated to the trio
  assert.throws(() => h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'water' }));
  h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'wood' });
});

test('two different trios from the same seed are different decks; same trio replays identically', () => {
  const a = createGame(777, undefined, 'draft', ['fire', 'water', 'earth']);
  const b = createGame(777, undefined, 'draft', ['fire', 'wood', 'metal']);
  const a2 = createGame(777, undefined, 'draft', ['fire', 'water', 'earth']);
  assert.notDeepEqual(a.state.sharedDeck, b.state.sharedDeck);
  assert.deepEqual(a.state.sharedDeck, a2.state.sharedDeck);
});
