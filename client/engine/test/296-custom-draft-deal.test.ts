/* BL-43 — custom rules on a live draft: the ENGINE half, the deal.
 *
 * The one promise that matters most is §1: a game with no custom deal, and a
 * game whose deal was left at the defaults, are the same game as every game
 * dealt before BL-43 existed — same shuffle, same hands, same events. Live
 * rooms are replayed onto the new engine on every deploy, so a drift there
 * would rewrite games in progress. The non-vacuity control comes first: a
 * deal that is NOT standard must actually change the game, or §1 proves
 * nothing.
 *
 * Titles carry no apostrophes: ledger guards cite them by substring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { ALL_ELEMENTS, createGame, defaultElements, DRAFT_TRIO, legalActions, replay, sanitizeTrio } from '../src/apply.ts';
import { DEAL_BOUNDS, DEAL_DEFAULTS, dealSummary, draftPool, minPool, sanitizeDraftDeal, type DraftDeal } from '../src/draftdeal.ts';
import { DECK_LIST, draftDeckList } from '../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import type { CardName, GameMode, GameState, Seat } from '../src/types.ts';
import { toDeployment } from './util.ts';
import { fuzzGame } from './fuzz.ts';

/** a resolved custom deal: the defaults with some knobs changed */
function deal(over: Partial<DraftDeal>): DraftDeal {
  const d = sanitizeDraftDeal({ ...DEAL_DEFAULTS, excluded: [], ...over });
  assert.ok(d, 'the helper was asked for a standard deal — use no deal instead');
  return d;
}

function noopCommit(h: Harness, seat: Seat): void {
  const H = h.state.players[seat]!.hand.length;
  h.do({ type: 'draftCommit', seat, packIndices: h.state.packs[seat]!.map((_, i) => H + i) });
}

/** one full draft turn: no-op drafts, planning, empty battle, deploy (as 20-draft) */
function playTurn(h: Harness): void {
  noopCommit(h, 0);
  noopCommit(h, 1);
  toDeployment(h);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
}

/** every card name held anywhere a card can be */
function cardsIn(s: GameState): CardName[] {
  return [
    ...s.sharedDeck, ...s.packs.flat(),
    ...s.players.flatMap(p => [...p.hand, ...p.bin, ...(p.cache ?? []).map(c => c.card)]),
    ...Object.values(s.entities).map(e => e.card),
  ];
}

const CONSTRUCTED: [CardName[], CardName[]] = [DECK_LIST.slice(0, 30), DECK_LIST.slice(30, 60)];
const decksFor = (mode: GameMode) => (mode === 'constructed' ? CONSTRUCTED : undefined);

// ── §1 the standard game is untouched ───────────────────────────────────

test('BL-43 §1a control: a custom deal changes the draft for the same seed', () => {
  const plain = createGame(7, undefined, 'draft');
  const custom = createGame(7, undefined, 'draft', undefined, undefined, deal({ packSize: 5 }));
  assert.notDeepEqual(custom.state, plain.state);
});

test('BL-43 §1b no deal and a deal left at the defaults deal the identical game in every mode', () => {
  const untouched = { ...DEAL_DEFAULTS, excluded: [] } as DraftDeal;
  for (const mode of ['draft', 'shared', 'constructed'] as GameMode[]) {
    for (let seed = 1; seed <= 30; seed++) {
      const before = createGame(seed, undefined, mode, undefined, decksFor(mode));
      const after = createGame(seed, undefined, mode, undefined, decksFor(mode), untouched);
      assert.deepEqual(after.state, before.state, `${mode} seed ${seed}: state`);
      assert.deepEqual(after.events, before.events, `${mode} seed ${seed}: events`);
      assert.ok(!('draftDeal' in before.state), `${mode} seed ${seed}: no draftDeal on a standard game`);
    }
  }
});

test('BL-43 §1c a custom deal is ignored outside a live draft', () => {
  const d = deal({ packSize: 5, startingLife: 12, excluded: DECK_LIST.slice(0, 40) });
  for (const mode of ['shared', 'constructed'] as GameMode[]) {
    const plain = createGame(11, undefined, mode, undefined, decksFor(mode));
    const custom = createGame(11, undefined, mode, undefined, decksFor(mode), d);
    assert.deepEqual(custom.state, plain.state, mode);
  }
});

// ── §2 each knob ─────────────────────────────────────────────────────────

test('BL-43 §2a pack size: packs of 5 at the deal, the commit leaves 5, and the turn-4 refresh deals 5', () => {
  const h = new Harness(2006, undefined, 'draft', undefined, undefined, deal({ packSize: 5 }));
  assert.deepEqual(h.state.draftDeal, { packSize: 5, draftDraw: 2 });
  for (const seat of [0, 1]) assert.equal(h.state.packs[seat]!.length, 5, `seat ${seat} pack`);
  assert.equal(h.state.sharedDeck.length, 177 - 2 * 6 - 2 * 5);
  assert.equal(legalActions(h.state, 0).length, 1 + 6 * 5, 'the no-op plus every single swap of a 5-card pack');
  assert.ok(h.log.some(l => l.includes('leave exactly 5 cards')), 'the draft step names the real pack size');
  playTurn(h); playTurn(h); playTurn(h);
  assert.equal(h.state.turn, 4);
  assert.ok(h.log.some(l => l.includes('fresh pack of 5')), 'the refresh names the real pack size');
  for (const seat of [0, 1]) assert.equal(h.state.packs[seat]!.length, 5, `seat ${seat} refreshed pack`);
});

test('BL-43 §2b opening hand, draws per turn and starting life', () => {
  const h = new Harness(2010, undefined, 'draft', undefined, undefined, deal({ openingHand: 4, draftDraw: 1, startingLife: 20 }));
  for (const seat of [0, 1]) {
    assert.equal(h.state.players[seat]!.hand.length, 4, `seat ${seat} opening hand`);
    assert.equal(h.state.players[seat]!.life, 20, `seat ${seat} life`);
  }
  playTurn(h);
  for (const seat of [0, 1]) assert.equal(h.state.players[seat]!.hand.length, 5, `seat ${seat} drew 1 on turn 2`);

  const none = new Harness(2010, undefined, 'draft', undefined, undefined, deal({ draftDraw: 0 }));
  playTurn(none);
  for (const seat of [0, 1]) assert.equal(none.state.players[seat]!.hand.length, 6, `seat ${seat} drew nothing on turn 2`);
});

test('BL-43 §2c two elements: the rulebook pair by default, a chosen pair when given, 113 cards', () => {
  const d = deal({ elements: 2 });
  const byDefault = new Harness(2020, undefined, 'draft', undefined, undefined, d);
  assert.deepEqual(byDefault.state.elements, ['fire', 'wood']);
  const chosen = new Harness(2020, undefined, 'draft', ['dark', 'water'], undefined, d);
  assert.deepEqual(chosen.state.elements, ['water', 'dark']);
  const three = new Harness(2020, undefined, 'draft', ['fire', 'water', 'earth'], undefined, d);
  assert.deepEqual(three.state.elements, ['fire', 'wood'], 'three elements under a two-element deal fall back to the default pair');
  for (const h of [byDefault, chosen]) {
    const cards = cardsIn(h.state);
    assert.equal(cards.length, 113, `${h.state.elements.join('+')} pool`);
    for (const n of cards) {
      assert.ok((getCard(n).factions ?? []).every(f => (h.state.elements as string[]).includes(f)), `${n} is outside ${h.state.elements.join('+')}`);
    }
  }
});

test('BL-43 §2d sanitizeTrio keeps its three-element answers and generalises to any count', () => {
  assert.deepEqual(sanitizeTrio(undefined), DRAFT_TRIO);
  assert.deepEqual(sanitizeTrio(['wood', 'fire', 'metal']), ['fire', 'wood', 'metal']);
  assert.deepEqual(sanitizeTrio(['fire', 'wood']), DRAFT_TRIO, 'two elements are not a trio');
  assert.deepEqual(sanitizeTrio(['fire', 'plaid', 'wood']), DRAFT_TRIO);
  assert.equal(DEAL_BOUNDS.elements[1], ALL_ELEMENTS.length, 'the element bound is the element list');
  for (let k = DEAL_BOUNDS.elements[0]; k <= DEAL_BOUNDS.elements[1]; k++) {
    assert.equal(defaultElements(k).length, k);
    assert.deepEqual(sanitizeTrio(defaultElements(k), k), defaultElements(k), `k=${k} default is itself sane`);
  }
});

// ── §3 excluded cards ───────────────────────────────────────────────────

test('BL-43 §3 an excluded card is nowhere in the game, at the deal or after a fuzzed game', () => {
  const trioPool = draftDeckList(DRAFT_TRIO);
  const excluded = trioPool.filter((_, i) => i % 2 === 0);
  const d = deal({ excluded, packSize: 5 });
  assert.equal(draftPool(DRAFT_TRIO, d).length, trioPool.length - excluded.length);
  const out = new Set(excluded);
  const dealt = createGame(31, undefined, 'draft', undefined, undefined, d).state;
  assert.equal(cardsIn(dealt).length, trioPool.length - excluded.length);
  for (const seed of [31, 32, 33]) {
    const r = fuzzGame(seed, 1200, 'draft', undefined, d);
    for (const n of cardsIn(r.state)) assert.ok(!out.has(n), `seed ${seed}: excluded ${n} is in the game`);
    const again = replay(seed, r.actions, undefined, 'draft', undefined, undefined, d);
    assert.deepEqual(again.state, r.state, `seed ${seed}: a custom game replays from seed + deal + actions`);
  }
});

// ── §4 the deal object ──────────────────────────────────────────────────

test('BL-43 §4 sanitizeDraftDeal: the standard game is undefined, knobs clamp, names go canonical', () => {
  assert.equal(sanitizeDraftDeal(undefined), undefined);
  assert.equal(sanitizeDraftDeal('packs of 5'), undefined);
  assert.equal(sanitizeDraftDeal({}), undefined, 'every knob missing is every knob default');
  assert.equal(sanitizeDraftDeal({ ...DEAL_DEFAULTS, excluded: ['Not A Card'] }), undefined, 'an unknown name leaves nothing excluded');
  const d = sanitizeDraftDeal({ packSize: 99, elements: 1, draftDraw: -3, startingLife: 'lots', openingHand: 4.6 })!;
  assert.deepEqual({ ...d, excluded: undefined }, { elements: 2, packSize: 15, openingHand: 5, draftDraw: 0, startingLife: 30, excluded: undefined });
  const [a, b] = [DECK_LIST[5]!, DECK_LIST[2]!];
  assert.deepEqual(sanitizeDraftDeal({ excluded: [a, 'Not A Card', b, a] })!.excluded, [b, a], 'unique, known, DECK_LIST order');
});

test('BL-43 §5 minPool: the standard game needs 64, the beginner deal 44', () => {
  assert.equal(minPool(), 64);
  assert.equal(minPool(deal({ packSize: 5, elements: 2 })), 44);
  assert.ok(draftDeckList(DRAFT_TRIO).length >= minPool(), 'the standard trio clears its own floor');
});

test('BL-43 §6 the game log names the custom rules once, and a standard game says nothing', () => {
  const d = deal({ packSize: 5, elements: 2, excluded: DECK_LIST.slice(0, 3) });
  assert.equal(dealSummary(d), 'packs of 5, 2 elements, 3 cards left out of the pool');
  const h = new Harness(40, undefined, 'draft', undefined, undefined, d);
  assert.equal(h.log.filter(l => l.startsWith('Custom rules:')).length, 1);
  assert.ok(!new Harness(40, undefined, 'draft').log.some(l => l.startsWith('Custom rules:')));
});
