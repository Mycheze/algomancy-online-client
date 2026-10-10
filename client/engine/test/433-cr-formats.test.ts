/**
 * Comprehensive rules, unit U22 (multiplayer and formats) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U22
 * (data/comprehensive-rules/build/probes/U22/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U22.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../src/cards/registry.ts';
import { checkDeck, checkSingleCard, checkSingleDeck, createGame, legalActions, makesUnits } from '../src/apply.ts';
import { DEAL_BOUNDS, DEAL_DEFAULTS, sanitizeDraftDeal } from '../src/draftdeal.ts';
import { getCard } from '../src/cards/dsl.ts';
import { Harness } from '../src/harness.ts';
import type { CardName, Seat } from '../src/types.ts';
import { E } from '../src/engine.ts';
import { finishBattle, giveResources, pass, spawn, toDeployment, toNextBattle } from './util.ts';

const unitCard = DECK_LIST.find(n => getCard(n).kind === 'unit')!;
const duelDeck = (): CardName[] => (checkSingleCard(unitCard) as { cards: CardName[] }).cards;

/* ── constructed ────────────────────────────────────────────────────────── */

test('cr:formats.constructed.copies — exactly a third copy is refused, two are accepted', () => {
  const two = [...DECK_LIST.slice(1, 29), DECK_LIST[0]!, DECK_LIST[0]!];
  const three = [...DECK_LIST.slice(1, 28), DECK_LIST[0]!, DECK_LIST[0]!, DECK_LIST[0]!];
  assert.equal(two.length, 30);
  assert.equal(three.length, 30);
  assert.equal(checkDeck(two).ok, true, 'two copies');
  const r = checkDeck(three);
  assert.equal(r.ok, false, 'three copies');
  assert.match((r as { error: string }).error, /max 2 copies/);
});

test('cr:formats.constructed.deck-size — a 200-card deck passes, so there is no maximum; 29 is refused', () => {
  assert.equal(checkDeck(DECK_LIST.slice(0, 200)).ok, true, '200 cards');
  assert.equal(checkDeck(DECK_LIST.slice(0, 29)).ok, false, '29 cards');
});

test('cr:formats.constructed.no-packs — a constructed game has no shared deck and no packs', () => {
  const s = createGame(8, undefined, 'constructed', undefined, [DECK_LIST.slice(0, 30), DECK_LIST.slice(30, 60)]).state;
  assert.deepEqual(s.sharedDeck, []);
  assert.deepEqual(s.packs, [[], []]);
  assert.equal(s.draftDone, null);
});

/* ── single card duel ───────────────────────────────────────────────────── */

test('cr:formats.constructed.single-card — a duel deck is 30 copies of one card, and a constructed game accepts it', () => {
  const r = checkSingleCard(unitCard);
  assert.ok(r.ok);
  const deck = (r as { cards: CardName[] }).cards;
  assert.equal(deck.length, 30);
  assert.ok(deck.every(n => n === unitCard));
  const s = createGame(9, undefined, 'constructed', undefined, [deck, deck]).state;
  assert.equal(s.singleCard, true);
});

test('cr:formats.constructed.single-card.copies — the duel deck breaks the two-copy cap: checkDeck refuses it, checkSingleDeck and createGame accept it', () => {
  const deck = duelDeck();
  assert.equal(checkDeck(deck).ok, false, 'over the two-copy cap');
  assert.equal(checkSingleDeck(deck).ok, true);
  assert.doesNotThrow(() => createGame(9, undefined, 'constructed', undefined, [deck, deck]));
});

test('cr:formats.constructed.single-card.no-draw-phase — opening 4, a flat 2 each turn, nothing put back', () => {
  const deck = duelDeck();
  const h = new Harness(10, undefined, 'constructed', undefined, [deck, deck]);
  assert.equal(h.state.singleCard, true);
  assert.ok(h.state.bottomDone == null, 'no put-back pending on turn 1');
  for (const seat of [0, 1]) {
    assert.equal(h.state.players[seat]!.hand.length, 6, 'opening 4 + turn 1 draw 2');
    assert.equal(h.state.decks![seat]!.length, 24);
  }
  toDeployment(h);
  const before = h.state.players.map(p => p.hand.length);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  assert.equal(h.state.turn, 2);
  assert.ok(h.state.bottomDone == null, 'no put-back pending on turn 2');
  for (const seat of [0, 1] as Seat[]) {
    assert.equal(h.state.players[seat]!.hand.length, before[seat]! + 2, 'turn 2 draws exactly 2');
  }
});

test('cr:formats.constructed.single-card.no-units — makesUnits is true for a unit and a unit-token maker, false for a spell that makes none', () => {
  assert.equal(makesUnits(unitCard), true);
  assert.equal(makesUnits('Self-Assembly'), true, 'creates a Robot unit token');
  const noUnit = DECK_LIST.find(n => getCard(n).kind === 'spell' && !makesUnits(n));
  assert.ok(noUnit, 'some spell makes no unit');
  assert.equal(makesUnits(noUnit!), false);
});

/* ── custom draft rules ─────────────────────────────────────────────────── */

test('cr:formats.draft.custom.pack-size — the pack-size knob runs 3 to 15, and a 13- or 15-card pack is really dealt', () => {
  assert.deepEqual(DEAL_BOUNDS.packSize, [3, 15]);
  assert.equal(sanitizeDraftDeal({ ...DEAL_DEFAULTS, excluded: [], packSize: 15 })!.packSize, 15);
  assert.equal(sanitizeDraftDeal({ ...DEAL_DEFAULTS, excluded: [], packSize: 2 })!.packSize, 3, 'below the range clamps to 3');
  for (const size of [13, 15]) {
    const d = sanitizeDraftDeal({ ...DEAL_DEFAULTS, excluded: [], packSize: size })!;
    const s = createGame(5, undefined, 'draft', undefined, undefined, d).state;
    for (const seat of [0, 1]) assert.equal(s.packs[seat]!.length, size, `packs of ${size}`);
  }
});

test('cr:formats.draft.custom.elements — the elements knob runs 2 to 7, and a seven-element pool is every deck card once', () => {
  assert.deepEqual(DEAL_BOUNDS.elements, [2, 7]);
  const d = sanitizeDraftDeal({ ...DEAL_DEFAULTS, excluded: [], elements: 7 })!;
  const s = createGame(6, undefined, 'draft', undefined, undefined, d).state;
  assert.equal(s.elements.length, 7);
  const dealt = [...s.sharedDeck, ...s.packs.flat(), ...s.players.flatMap(p => p.hand)];
  assert.deepEqual([...dealt].sort(), [...DECK_LIST].sort());
});

/* ── 1v1 as a player setup ──────────────────────────────────────────────── */

test('cr:formats.general.one-v-one-is-team — with The Silent out, each player is billed only for the spells that player has played, as a one-player team', () => {
  const h = new Harness(43301, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'The Silent');
  giveResources(h, D, 'earth', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  const region = h.state.battle!.region;
  new E(h.state).bumpBattleCounter(region, `spellsPlayedAny:${D}`, 2);
  const e = new E(h.state);
  assert.equal(e.manaToPlay(D, 'Fight'), 1 + 4, 'the two spells of this player count for this player');
  assert.equal(e.manaToPlay(A, 'Fight'), 1, 'and not for the other player, who is not on that team');
  finishBattle(h);
});

test('cr:formats.general.seating.one-v-one — a two-player game has two regions, one per player, and an attack is fought in the one other region with no region to choose', () => {
  const h = new Harness(43302);
  assert.equal(h.state.regions.length, 2);
  assert.deepEqual(h.state.regions.map(r => r.owner).sort(), [0, 1]);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  const g = new E(h.state);
  assert.equal(h.state.battle!.region, g.homeRegion(D), 'the attack goes into the opponent region');
  const attacks = legalActions(h.state, A).filter(a => a.type === 'declareAttack');
  assert.ok(attacks.length > 0);
  assert.ok(attacks.every(a => !('region' in a)), 'a declared attack names no region');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  assert.equal(h.state.battle!.region, g.homeRegion(D));
  finishBattle(h);
});

test('cr:formats.general.simultaneous-regions — battle is in one region at a time: the first round ends in the defending region before the counterattack starts in the other', () => {
  const h = new Harness(43303);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a = spawn(h, A, 'Unit Token');
  const c = spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  const g = new E(h.state);
  const seen: string[] = [];
  const note = (): void => {
    const b = h.state.battle;
    if (!b) return;
    assert.equal(typeof b.region, 'number', 'the battle state holds a single region');
    const row = `${b.round}:${b.region}`;
    if (seen[seen.length - 1] !== row) seen.push(row);
  };
  note();
  h.do({ type: 'declareAttack', seat: A, columns: [[a]] }); note();
  pass(h); pass(h); note();
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: [c] }); note();
  let guard = 60;
  while (h.state.phase === 'battle' && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else if (h.state.priority !== null) pass(h);
    else if (h.state.battle!.round === 2 && h.state.battle!.step === 'declare') {
      h.do({ type: 'declareAttack', seat: D, columns: [[c]] });
    } else break;
    note();
  }
  assert.deepEqual(seen, [`1:${g.homeRegion(D)}`, `2:${g.homeRegion(A)}`],
    'one region, then the other, never back');
});

test('cr:formats.teams.initiative.alternates — in a two-player game, where each player is a team, the initiative changes hands every turn', () => {
  const h = new Harness(43304);
  const seen: Seat[] = [];
  for (let turn = 0; turn < 4; turn++) {
    seen.push(h.state.initiative as Seat);
    toDeployment(h);
    h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
    h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  }
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1], `turn ${i + 1}: ${seen}`);
  assert.equal(new Set(seen).size, 2);
});
