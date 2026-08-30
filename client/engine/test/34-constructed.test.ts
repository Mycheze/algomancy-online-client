/* Constructed mode (Manual "Constructed"): per-player decks brought to the
 * game (min 30, max 2 copies), the combined draw phase (draw 4, then put 2
 * on the bottom of your OWN deck in any order), and recycling to your own
 * deck. Replay = seed + decks + actions. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { ALL_ELEMENTS, checkDeck, replay, legalActions, IllegalAction } from '../src/apply.ts';
import { getCard } from '../src/cards/dsl.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import type { CardName, Seat } from '../src/types.ts';

const deckA = (): CardName[] => DECK_LIST.slice(0, 30);
const deckB = (): CardName[] => DECK_LIST.slice(30, 60);
const newGame = (seed = 42): Harness =>
  new Harness(seed, undefined, 'constructed', undefined, [deckA(), deckB()]);

/** put both seats' 2 cards back (first two hand indices) */
function bottomBoth(h: Harness): void {
  for (const seat of [0, 1] as Seat[]) {
    if (h.state.bottomDone && !h.state.bottomDone[seat]) {
      h.do({ type: 'bottomCards', seat, handIndices: [0, 1] });
    }
  }
}

// ── deck validation ───────────────────────────────────────────────────

test('checkDeck: min 30, max 2 copies, scripted pool only', () => {
  assert.equal(checkDeck(deckA()).ok, true);
  assert.equal(checkDeck(DECK_LIST.slice(0, 15).flatMap(n => [n, n])).ok, true, '2 copies are fine');
  assert.equal(checkDeck(deckA().slice(0, 29)).ok, false, 'under 30');
  assert.equal(checkDeck(Array(30).fill(DECK_LIST[0])).ok, false, 'over 2 copies');
  assert.equal(checkDeck([...deckA().slice(0, 29), 'Totally Fake Card']).ok, false, 'unknown card');
  assert.equal(checkDeck([...deckA().slice(0, 29), 'Unit Token']).ok, false, 'tokens are not deck cards');
  assert.equal(checkDeck('nope').ok, false);
});

// ── game creation + the draw phase ────────────────────────────────────

test('createGame constructed: per-seat decks, opening 4 + draw 4, bottoming open', () => {
  const h = newGame();
  assert.equal(h.state.mode, 'constructed');
  assert.deepEqual(h.state.sharedDeck, [], 'no communal deck');
  assert.deepEqual(h.state.bottomDone, [false, false]);
  for (const seat of [0, 1]) {
    assert.equal(h.state.players[seat]!.hand.length, 8, `seat ${seat}: opening 4 + turn-1 draw 4`);
    assert.equal(h.state.decks![seat]!.length, 30 - 8, `seat ${seat} deck`);
  }
  // each seat draws only their own cards
  const a = new Set(deckA()), b = new Set(deckB());
  assert.ok(h.state.players[0]!.hand.every(n => a.has(n)), 'seat 0 draws from deck A');
  assert.ok(h.state.players[1]!.hand.every(n => b.has(n)), 'seat 1 draws from deck B');
});

test('nothing moves until the 2 cards go back; bottoming keeps the given order', () => {
  const h = newGame();
  assert.throws(() => h.do({ type: 'donePlanning', seat: 0 }), IllegalAction);
  assert.throws(() => h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'fire' }), IllegalAction);
  assert.throws(() => h.do({ type: 'bottomCards', seat: 0, handIndices: [0] }), IllegalAction, 'must be exactly 2');
  assert.throws(() => h.do({ type: 'bottomCards', seat: 0, handIndices: [3, 3] }), IllegalAction, 'distinct');

  const legal = legalActions(h.state, 0);
  assert.ok(legal.length > 0 && legal.every(action => action.type === 'bottomCards'),
    'only bottomCards is offered while pending');

  const [first, second] = [h.state.players[0]!.hand[5]!, h.state.players[0]!.hand[2]!];
  h.do({ type: 'bottomCards', seat: 0, handIndices: [5, 2] });
  assert.equal(h.state.players[0]!.hand.length, 6);
  const deck = h.state.decks![0]!;
  assert.deepEqual(deck.slice(-2), [first, second], 'bottom of the deck, in the order given');
  assert.deepEqual(h.state.bottomDone, [true, false]);
  assert.throws(() => h.do({ type: 'bottomCards', seat: 0, handIndices: [0, 1] }), IllegalAction, 'once per turn');

  h.do({ type: 'bottomCards', seat: 1, handIndices: [0, 1] });
  assert.equal(h.state.bottomDone, null, 'both done — the step closes');
});

test('recycling goes to the bottom of YOUR deck; draws come from it too', () => {
  const h = newGame();
  bottomBoth(h);
  const d0 = h.state.decks![0]!.length, d1 = h.state.decks![1]!.length;
  const name = h.state.players[0]!.hand[0]!;
  h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'water' });
  assert.equal(h.state.decks![0]!.length, d0 + 1, 'own deck grew');
  assert.equal(h.state.decks![0]![h.state.decks![0]!.length - 1], name, 'on the bottom');
  assert.equal(h.state.decks![1]!.length, d1, 'opponent deck untouched');
});

test('turn 2 reopens the draw phase: 4 more cards, bottoming pending again', () => {
  const h = newGame();
  bottomBoth(h);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  for (const seat of [0, 1] as Seat[]) {
    if (h.state.phase === 'planning' && h.state.hasteDone && !h.state.hasteDone[seat]) {
      h.do({ type: 'doneHaste', seat });
    }
  }
  // two empty battle rounds → deploy → next turn
  h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  if (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  h.do({ type: 'doneDeploying', seat: 0 });
  h.do({ type: 'doneDeploying', seat: 1 });
  assert.equal(h.state.turn, 2);
  assert.deepEqual(h.state.bottomDone, [false, false]);
  assert.equal(h.state.players[0]!.hand.length, 6 + 4, 'turn-1 net 6 + turn-2 draw 4');
});

test('replay = seed + decks + actions reproduces the game exactly', () => {
  const h = newGame(777);
  bottomBoth(h);
  h.do({ type: 'recycleForResource', seat: 0, handIndex: 2, element: 'earth' });
  h.do({ type: 'donePlanning', seat: 0 });
  const r = replay(777, (h as Harness).actions, undefined, 'constructed', undefined, [deckA(), deckB()]);
  assert.deepEqual(r.state, h.state);
});

test('the other modes still create games without decks', () => {
  const shared = new Harness(9);
  assert.equal(shared.state.decks, undefined);
  assert.equal(shared.state.players[0]!.hand.length, 7);
  const draft = new Harness(9, undefined, 'draft');
  assert.equal(draft.state.players[0]!.hand.length, 6);
});

// ── R99: deck element identity (playtest ledger #63) ──────────────────

test('deckElements: constructed records each seat’s deck element identity', () => {
  // Ledger #63 (GETD): "In constructed, the resource options from recycling
  // and prismites should be limited just to the elements that are in your
  // deck." This is the engine half — the field the client defaults its menu to.
  const mono: CardName[] = DECK_LIST.filter(n => {
    const f = getCard(n).factions ?? [];
    return f.length === 1 && f[0] === 'light';
  }).slice(0, 30);
  assert.equal(mono.length, 30, 'enough mono-light cards to build a legal deck');
  const h = new Harness(77, undefined, 'constructed', undefined, [mono, deckB()]);
  assert.deepEqual(h.state.deckElements![0], ['light'], 'a mono-light deck is light and nothing else');
  const b = h.state.deckElements![1]!;
  assert.ok(b.length > 0, 'the other deck reports its own elements');
  // canonical ALL_ELEMENTS order, so two identical decks give identical arrays
  assert.deepEqual(b, ALL_ELEMENTS.filter(el => b.includes(el)), 'canonical element order');
  const fromDeck = new Set(deckB().flatMap(n => getCard(n).factions ?? []));
  assert.deepEqual(b, ALL_ELEMENTS.filter(el => fromDeck.has(el)), 'the union of the decklist’s factions');
});

test('deckElements: it is a PRESENTATION default — all seven stay legal', () => {
  // The restraint is the point. Reap the Due is mono-light and scales off DARK
  // affinity, so a mono-light deck must still be able to take a dark resource.
  const mono: CardName[] = DECK_LIST.filter(n => {
    const f = getCard(n).factions ?? [];
    return f.length === 1 && f[0] === 'light';
  }).slice(0, 30);
  const h = new Harness(78, undefined, 'constructed', undefined, [mono, deckB()]);
  bottomBoth(h);
  const legal = legalActions(h.state, 0);
  const offered = new Set(legal
    .filter((a): a is Extract<typeof a, { type: 'recycleForResource' }> => a.type === 'recycleForResource')
    .map(a => a.element));
  assert.deepEqual([...offered].sort(), [...ALL_ELEMENTS].sort(),
    'legalActions still offers every element — nothing legal became illegal');
  h.do({ type: 'recycleForResource', seat: 0, handIndex: 0, element: 'dark' });
  assert.ok(h.state.players[0]!.resources.some(r => r.kind === 'dark'),
    'and an off-element resource is really takeable');
});

test('deckElements: absent outside constructed — the client falls back to `elements`', () => {
  assert.equal(new Harness(79).state.deckElements, undefined, 'shared');
  assert.equal(new Harness(80, undefined, 'draft', ['fire', 'water', 'earth']).state.deckElements,
    undefined, 'draft already narrows `elements` to its trio');
});
