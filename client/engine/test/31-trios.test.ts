/* Draft trio selection + full-set completeness: with all five BASE elements
 * scripted, every one of the 10 base trios must be a Manual-exact deck
 * (54 per element + 5 per hybrid pair = 177), and createGame must honor a
 * chosen trio end to end.
 *
 * The Light & Dark expansion added light and dark, taking the element count to
 * 7 and the trio count to C(7,3)=35. All 163 of its cards are now scripted, so
 * the same Manual-exact assertion runs over every one of the 35 trios at the
 * bottom of this file — that test is the completeness guard for the whole
 * card pool: a card that stops registering shows up here as a short deck. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { createGame, sanitizeTrio, ALL_ELEMENTS } from '../src/apply.ts';
import { draftDeckList } from '../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import type { Element } from '../src/types.ts';

/** every 3-subset of `els`, in canonical (ALL_ELEMENTS) order */
function allTrios(els: Element[]): Element[][] {
  const out: Element[][] = [];
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) {
      for (let k = j + 1; k < els.length; k++) out.push([els[i]!, els[j]!, els[k]!]);
    }
  }
  return out;
}

const BASE_ELEMENTS: Element[] = ['fire', 'water', 'earth', 'wood', 'metal'];
const baseTrios = allTrios(BASE_ELEMENTS);
const everyTrio = allTrios(ALL_ELEMENTS);

/** a trio's deck is Manual-exact: 54 per element + 5 per hybrid pair = 177 */
function assertManualExact(trio: Element[]): void {
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

test('seven elements, 35 trios: Light & Dark joined the canonical element list', () => {
  assert.deepEqual(ALL_ELEMENTS, ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark']);
  assert.equal(ALL_ELEMENTS.length, 7, 'five base elements + light + dark');
  assert.equal(new Set(ALL_ELEMENTS).size, 7, 'no duplicates');
  assert.equal(everyTrio.length, 35, 'C(7,3) = 35 trios');
  assert.equal(new Set(everyTrio.map(t => t.join('+'))).size, 35, 'all 35 distinct');
  assert.equal(baseTrios.length, 10, 'C(5,3) = 10 base trios');
});

test('sanitizeTrio: valid trios pass, everything else falls back to fire+water+earth', () => {
  assert.deepEqual(sanitizeTrio(['wood', 'metal', 'fire']), ['fire', 'wood', 'metal'], 'canonical order');
  // light and dark are real elements now: a trio naming them is valid, and
  // comes back in canonical order with light/dark LAST
  assert.deepEqual(sanitizeTrio(['light', 'dark', 'fire']), ['fire', 'light', 'dark'], 'light/dark sort last');
  assert.deepEqual(sanitizeTrio(['dark', 'light', 'water']), ['water', 'light', 'dark'], 'input order ignored');
  assert.deepEqual(sanitizeTrio(['light', 'wood', 'metal']), ['wood', 'metal', 'light'], 'one new element');
  assert.deepEqual(sanitizeTrio(['fire', 'fire', 'water']), ['fire', 'water', 'earth'], 'dupes rejected');
  assert.deepEqual(sanitizeTrio(['light', 'light', 'dark']), ['fire', 'water', 'earth'], 'dupes rejected (new)');
  assert.deepEqual(sanitizeTrio(['fire', 'water']), ['fire', 'water', 'earth'], 'too few');
  assert.deepEqual(sanitizeTrio(['light', 'dark']), ['fire', 'water', 'earth'], 'too few (new)');
  assert.deepEqual(sanitizeTrio(['fire', 'water', 'earth', 'wood']), ['fire', 'water', 'earth'], 'too many');
  assert.deepEqual(sanitizeTrio(['fire', 'water', 'earth', 'light']), ['fire', 'water', 'earth'], 'too many (new)');
  assert.deepEqual(sanitizeTrio('junk'), ['fire', 'water', 'earth'], 'not an array');
  assert.deepEqual(sanitizeTrio(['fire', 'plasma', 'water']), ['fire', 'water', 'earth'], 'unknown element');
  assert.deepEqual(sanitizeTrio(['light', 'shadow', 'dark']), ['fire', 'water', 'earth'], 'unknown element (new)');
});

test('ALL 10 base trios are Manual-exact: 54 per element + 5 per hybrid pair = 177', () => {
  assert.equal(baseTrios.length, 10);
  for (const trio of baseTrios) assertManualExact(trio);
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

// The completeness target for the expansion, now live: all 163 Light & Dark
// cards (54 light + 54 dark + 5 per hybrid pair) are registered, so EVERY one
// of the 35 trios builds a Manual-exact 177-card deck — 54 per element and 5
// per hybrid pair, one copy of each. This is the whole pool's completeness
// guard: any card that stops registering turns up here as a short deck.
test('all 35 trios are Manual-exact at 177 cards (54 per element + 5 per hybrid pair)', () => {
  assert.equal(everyTrio.length, 35);
  for (const trio of everyTrio) assertManualExact(trio);
  // and the expansion trios really are new ground, not the base ten again
  const withNew = everyTrio.filter(t => t.includes('light') || t.includes('dark'));
  assert.equal(withNew.length, 25, '35 trios - the 10 base-only ones');
});

test('every trio deck is drawn only from its own three elements, hybrids included', () => {
  for (const trio of everyTrio) {
    for (const n of draftDeckList(trio)) {
      const factions = getCard(n).factions ?? [];
      assert.ok(factions.length > 0 && factions.every(el => (trio as string[]).includes(el)),
        `${n} is outside ${trio.join('+')}`);
    }
  }
});

test('createGame deals a light/dark trio end to end', () => {
  // the headline expansion case: a trio of one base element + both new ones
  const h = new Harness(3535, undefined, 'draft', ['dark', 'light', 'fire']);
  assert.deepEqual(h.state.elements, ['fire', 'light', 'dark'], 'canonical order, light/dark last');
  assert.equal(h.state.sharedDeck.length, 177 - 32, 'trio deck minus the opening deal');
  for (const seat of [0, 1]) {
    assert.equal(h.state.players[seat]!.hand.length, 6, `seat ${seat} opening hand`);
    assert.equal(h.state.packs[seat]!.length, 10, `seat ${seat} pack`);
  }
  // a full draft turn works in a light/dark trio
  const H = h.state.players[0]!.hand.length;
  h.do({ type: 'draftCommit', seat: 0, packIndices: h.state.packs[0]!.map((_, i) => H + i) });
  h.do({ type: 'draftCommit', seat: 1, packIndices: h.state.packs[1]!.map((_, i) => H + i) });
  assert.equal(h.state.draftDone, null, 'packs passed');
  // resources are gated to the trio: light and dark are in, water is not
  assert.throws(() => h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'water' }));
  h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'light' });
  h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'dark' });
});
