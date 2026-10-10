/**
 * Comprehensive rules, unit U07 (zones) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U07
 * (data/comprehensive-rules/build/probes/U07/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U07.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../src/cards/registry.ts';
import { getCard } from '../src/cards/dsl.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { IllegalAction } from '../src/apply.ts';
import { ZONES } from '../src/types.ts';
import type { ResourceKind, Seat } from '../src/types.ts';
import { HIDDEN_CARD, viewFor } from '../../server/view.ts';
import {
  absorb, ent, finishBattle, give, giveResources, logFor, pass, pick, skipHasteStep, spawn, toDeployment, toNextBattle,
  withE,
} from './util.ts';

const trashes = (h: Harness, from = 0) => h.events.slice(from).filter(ev => ev.type === 'trashed');
const erasedOf = (h: Harness, s: Seat): string[] => new E(h.state).erased(s);

/** pass and answer decisions (first option) until the stack is empty */
function drain(h: Harness): void {
  for (let k = 0; k < 20 && (h.state.stack.length || h.state.decision); k++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
}

/** a battle in which `A` attacks with a vanilla token, after `who` was given `n` resources of `kind` */
function attacking(seed: number, who: 'A' | 'D', kind: ResourceKind, n: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, who === 'A' ? A : D, kind, n);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  return { h, A, D, atk };
}

const count = (xs: readonly string[], n: string): number => xs.filter(x => x === n).length;

/** util.ts withE without the settle(): look at a zone before any trigger runs */
function withEUnsettled(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state);
  fn(e);
  h.state = e.s;
  absorb(h, e.events);
}

const constructedGame = (seed: number): Harness =>
  new Harness(seed, undefined, 'constructed', undefined, [DECK_LIST.slice(0, 30), DECK_LIST.slice(30, 60)]);

/** the constructed draw phase: each seat puts its first two hand cards back */
function bottomBoth(h: Harness): void {
  for (const seat of [0, 1] as Seat[]) {
    if (h.state.bottomDone && !h.state.bottomDone[seat]) h.do({ type: 'bottomCards', seat, handIndices: [0, 1] });
  }
}

/* ── the bin ────────────────────────────────────────────────────────────── */

test('cr:zones.bin.entering.spell-unit-fails — a spell unit whose only target left play does not spawn, enters the bin of its caster, and is not trashed', () => {
  const h = new Harness(70705);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const w = spawn(h, A, 'Good Whale');
  giveResources(h, D, 'water', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[w]] });
  while (h.state.priority !== D) pass(h);
  const binBefore = h.state.players[D]!.bin.filter(c => c === 'Jelly').length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Jelly') });
  pick(h, { unit: w });
  assert.ok(h.state.stack.some(i => i.card === 'Jelly'), 'Jelly is on the stack');
  const mark = h.events.length;
  withE(h, e => { e.recall(e.entity(w)!); });               // the target leaves play
  drain(h);
  assert.ok(!Object.values(h.state.entities).some(x => x.card === 'Jelly'), 'no Jelly body in play');
  assert.equal(h.state.players[D]!.bin.filter(c => c === 'Jelly').length, binBefore + 1, 'Jelly is in its caster bin');
  assert.equal(trashes(h, mark).filter(t => t.data!['card'] === 'Jelly').length, 0, 'not trashed (from the stack)');
  assert.ok(h.events.slice(mark).some(ev => ev.type === 'fizzled'), 'it fizzled');
  finishBattle(h);
});

test('cr:zones.bin.mods-from-bin.virus — a Virus card in the bin is offered as an augment in deployment, never in battle', () => {
  const h = new Harness(70721);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  spawn(h, D, 'Unit Token');
  giveResources(h, D, 'earth', 4);
  // battle: D holds priority with Bumblecrab (a Virus) in BOTH hand and bin
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  if (h.state.priority !== D) pass(h);
  h.state.players[D]!.bin.push('Bumblecrab');
  give(h, D, 'Bumblecrab');
  const battleMods = h.legal(D).filter(a => a.type === 'augment') as { from: string }[];
  assert.ok(battleMods.some(a => a.from === 'hand'), 'control: from hand it is offered in battle');
  assert.ok(!battleMods.some(a => a.from === 'bin'), 'from the bin it is NOT offered in battle');
  finishBattle(h);
  // deployment: from the bin it is an ordinary mod
  const h2 = new Harness(70722);
  toDeployment(h2);
  const P = h2.state.deployPlayer!;
  spawn(h2, P, 'Unit Token');
  giveResources(h2, P, 'earth', 2);
  h2.state.players[P]!.bin.push('Bumblecrab');
  const depMods = h2.legal(P).filter(a => a.type === 'augment') as { from: string }[];
  assert.ok(depMods.some(a => a.from === 'bin'), 'in deployment it augments out of the bin');
});

test('cr:zones.bin.unstable — a modded unit that dies ends on the erased pile, not in the bin', () => {
  const h = new Harness(70708);
  toDeployment(h);
  const A = h.state.initiative;
  const host = spawn(h, A, 'Rune Channeler');
  withE(h, e => { e.attachMod(e.entity(host)!, 'Ignis Sprite', A, 'augment'); });
  withE(h, e => { e.destroy(e.entity(host)!, 'dies'); });
  assert.equal(ent(h, host), undefined, 'it left play');
  assert.ok(erasedOf(h, A).includes('Rune Channeler'), 'it is on the erased pile');
  assert.ok(!h.state.players[A]!.bin.includes('Rune Channeler'), 'and not left in the bin');
});

/* ── zone changes ───────────────────────────────────────────────────────── */

test('cr:zones.changes.mods.exchanged — Hooba-Mon augmented onto a host exchanges the host: host and the Hooba-Mon mod end on the erased pile, neither in a bin, and it is not a death', () => {
  const h = new Harness(70707);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Rune Channeler');
  giveResources(h, A, 'dark', 3);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Hooba-Mon'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1);
  h.state.players[A]!.bin.push('Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[host]] });
  const d = h.state.decision!;
  const i = d.options.findIndex(o => JSON.stringify(o.value).includes('Unit Token'));
  assert.notEqual(i, -1, 'the exchange offers the Unit Token in the bin');
  h.do({ type: 'decide', seat: d.seat, choice: i });
  drain(h);
  const bin = h.state.players[A]!.bin;
  assert.ok(!bin.includes('Rune Channeler'), 'host not in bin');
  assert.ok(!bin.includes('Hooba-Mon'), 'mod not in bin');
  assert.ok(erasedOf(h, A).includes('Rune Channeler'), 'host erased');
  assert.ok(erasedOf(h, A).includes('Hooba-Mon'), 'mod erased');
  assert.equal(h.events.filter(ev => ev.type === 'died' && ev.data!['card'] === 'Rune Channeler').length, 0,
    'and it is not a death');
});

test('cr:zones.changes.new-object.targets — a target that left play and came back is a new object: the effect does not touch it and fizzles', () => {
  const h = new Harness(70706);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const w = spawn(h, A, 'Good Whale');
  giveResources(h, D, 'fire', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[w]] });
  while (h.state.priority !== D) pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: w });
  let fresh = -1;
  const mark = h.events.length;
  withE(h, e => {
    e.recall(e.entity(w)!);
    fresh = e.spawnUnit(A, 'Good Whale', e.homeRegion(A)).id;   // the same card, back in play
  });
  drain(h);
  assert.notEqual(fresh, w, 'a new entity');
  assert.ok(ent(h, fresh), 'the new Good Whale survives');
  assert.equal(ent(h, fresh)!.damage, 0, 'and took no damage from the Arc aimed at the old one');
  assert.ok(h.events.slice(mark).some(ev => ev.type === 'fizzled'), 'the Arc fizzled — its only target is gone');
  finishBattle(h);
});

/* ── the erased pile ────────────────────────────────────────────────────── */

test('cr:zones.erased.tokens — a unit token sent to the cache ceases to exist there and is recorded on the erased pile', () => {
  const h = new Harness(70709);
  toDeployment(h);
  const A = h.state.initiative;
  withE(h, e => {
    const t = e.spawnUnit(A, 'Rune Channeler', e.homeRegion(A), { token: true });
    e.cacheUnit(t);
  });
  assert.deepEqual(new E(h.state).cache(A).filter(c => c.card === 'Rune Channeler'), [], 'swept out of the cache');
  assert.ok(erasedOf(h, A).includes('Rune Channeler'), 'and recorded on the erased pile');
});

/* ── the hand ───────────────────────────────────────────────────────────── */

test('cr:zones.hand.hidden.look-at — Thought Extraction aimed at the opponent shows that hand to the looker only', () => {
  const { h, A, D } = attacking(70716, 'A', 'dark', 2);
  h.state.players[D]!.hand = ['Good Whale', 'Shard Sprite'];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Thought Extraction') });
  pick(h, { player: D });
  pass(h); pass(h);
  if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  assert.ok(logFor(h, A).some(l => l.includes('Shard Sprite') || l.includes('Good Whale')), 'the looker is told the hand');
  // in 1v1 the only other seat is the hand's owner, so check the naming line is private to the looker
  const naming = h.events.filter(e => e.msg.includes('Thought Extraction reveals'));
  assert.equal(naming.length, 1, 'one naming line');
  assert.equal(naming[0]!.data?.['privateTo'], A, 'tagged private to the looker');
  finishBattle(h);
});

test('cr:zones.hand.hidden.look-at — Thought Extraction aimed at the hand of its own caster tells the opponent nothing', () => {
  const { h, A, D } = attacking(70717, 'A', 'dark', 2);
  h.state.players[A]!.hand = ['Good Whale', 'Shard Sprite'];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Thought Extraction') });
  pick(h, { player: A });
  pass(h); pass(h);
  if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  assert.deepEqual(logFor(h, D).filter(l => l.includes('Shard Sprite') || l.includes('Thought Extraction reveals')), [],
    'the opponent reads none of the caster hand');
  finishBattle(h);
});

test('cr:zones.hand.hidden.look-at — a hand revealed by Bioremediation is shown to every player', () => {
  const { h, A, D } = attacking(70718, 'D', 'wood', 4);
  pass(h);
  h.state.players[A]!.hand = ['Good Whale', 'Shard Sprite'];
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Bioremediation') });
  pick(h, { player: A });
  pass(h); pass(h);
  pick(h, 0);
  for (const s of [A, D]) {
    assert.ok(logFor(h, s).some(l => l.includes('Shard Sprite')), `seat ${s} sees the whole revealed hand`);
  }
  finishBattle(h);
});

/* ── the recycle pile ───────────────────────────────────────────────────── */

test('cr:zones.recycle.hidden — Bripp recycles a card out of the opponent hand without naming it to that player', () => {
  const h = new Harness(70719);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat, D = (1 - A) as Seat;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 5);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Bripp') });
  pick(h, { player: D });
  h.state.players[D]!.hand = ['Good Whale', 'Shard Sprite'];
  pass(h); pass(h);
  pick(h, 0);                                       // recycle 'Good Whale'
  assert.ok(!h.state.players[D]!.hand.includes('Good Whale'), 'the card left the hand');
  assert.ok(logFor(h, A).some(l => l.includes('recycles Good Whale')), 'the looker who chose it is told');
  assert.deepEqual(logFor(h, D).filter(l => l.includes('recycles') && l.includes('Good Whale')), [],
    'no recycle line names the card to the other seat');
  finishBattle(h);
});

test('cr:zones.recycle.mark.whose — in constructed each player recycles into a pile of their own', () => {
  const h = new Harness(70704, undefined, 'constructed', undefined, [DECK_LIST.slice(0, 30), DECK_LIST.slice(30, 60)]);
  assert.equal(h.state.mode, 'constructed');
  const g = new E(h.state);
  g.recycleToBottom(0, 'Geode');
  g.recycleToBottom(1, 'Gublin');
  assert.deepEqual(g.recycleOf(0), ['Geode'], 'seat 0 pile holds only its own card');
  assert.deepEqual(g.recycleOf(1), ['Gublin'], 'seat 1 pile holds only its own card');
  assert.notEqual(g.recycleOf(0), g.recycleOf(1), 'two different piles');
});

/* ══ the tester pass: one test per behavioural rule that had no demonstration ══ */

/* ── general ── */

test('cr:zones.general.list — the engine keeps cards in exactly nine zones: deck, hand, cache, play, bin, stack, erased pile, recycle pile and pack', () => {
  assert.deepEqual([...ZONES].sort(), ['bin', 'cache', 'deck', 'erased', 'hand', 'pack', 'play', 'recycle', 'stack']);
  // and a fresh live-draft game accounts for every card of its pool in those zones
  const h = new Harness(71800, undefined, 'draft');
  const held = [...h.state.sharedDeck, ...h.state.packs.flat(), ...h.state.players.flatMap(p => p.hand)];
  assert.equal(held.length, 177, 'deck + packs + hands hold the whole 177-card pool');
});

test('cr:zones.general.active — a printed Unstable card is erased leaving play or the stack, and only binned leaving the hand, the deck or the cache', () => {
  // active: play
  {
    const h = new Harness(71810);
    toDeployment(h);
    const P = h.state.deployPlayer!;
    const u = spawn(h, P, 'Aberrant Statweaver');
    withE(h, e => { e.destroy(e.entity(u)!, 'dies'); });
    assert.equal(count(erasedOf(h, P), 'Aberrant Statweaver'), 1, 'from play: erased');
    assert.equal(count(h.state.players[P]!.bin, 'Aberrant Statweaver'), 0, 'from play: not left in the bin');
  }
  // active: the stack (a battle Virus augment, negated)
  {
    const h = new Harness(71811);
    toDeployment(h);
    const A = h.state.initiative, D = (1 - A) as Seat;
    const atk = spawn(h, A, 'The Foretold');
    toNextBattle(h, A);
    h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
    giveResources(h, D, 'metal', 3);
    giveResources(h, A, 'wood', 2);
    pass(h);
    h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Aberrant Statweaver'), hostId: atk });
    const item = h.state.stack.find(i => i.card === 'Aberrant Statweaver')!;
    h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Hush Mush') });
    pick(h, { stack: item.id });
    pass(h); pass(h);
    assert.ok(!h.state.stack.some(i => i.id === item.id), 'negated off the stack');
    assert.equal(count(erasedOf(h, D), 'Aberrant Statweaver'), 1, 'from the stack: erased');
    assert.equal(count(h.state.players[D]!.bin, 'Aberrant Statweaver'), 0, 'from the stack: not binned');
  }
  // inactive: hand, deck, cache
  {
    const h = new Harness(71812);
    toDeployment(h);
    const P = h.state.deployPlayer!;
    withEUnsettled(h, e => {
      e.discardFromHand(P, give(h, P, 'Aberrant Statweaver'));
      e.deckOf(P).unshift('Aberrant Statweaver'); e.mill(P, 1);
      e.cacheCard(P, 'Aberrant Statweaver', 'effect');
      const taken = e.uncache(P, e.cache(P).length - 1)!;
      e.toBin(P, taken.card, 'cache');
    });
    assert.equal(count(h.state.players[P]!.bin, 'Aberrant Statweaver'), 3, 'from hand, deck and cache: binned');
    assert.equal(count(erasedOf(h, P), 'Aberrant Statweaver'), 0, 'and none of the three erased');
  }
});

test('cr:zones.general.per-player — a card put in one player hand, cache, bin or erased pile leaves the other player four zones untouched', () => {
  const h = new Harness(71801);
  toDeployment(h);
  const P = h.state.deployPlayer!, O = (1 - P) as Seat;
  const before = structuredClone(h.state.players[O]!);
  withEUnsettled(h, e => {
    e.toBin(P, 'Jelly', 'hand');
    e.toHand(P, 'Geode', 'deck');
    e.cacheCard(P, 'Gublin', 'effect');
    e.eraseFromZone(P, 'Geode', 'hand', 'test');
  });
  assert.equal(count(h.state.players[P]!.bin, 'Jelly'), 1, 'P bin');
  assert.equal(count(new E(h.state).cache(P).map(c => c.card), 'Gublin'), 1, 'P cache');
  assert.equal(count(erasedOf(h, P), 'Geode'), 1, 'P erased pile');
  const after = h.state.players[O]!;
  assert.deepEqual(after.hand, before.hand, 'O hand untouched');
  assert.deepEqual(after.bin, before.bin, 'O bin untouched');
  assert.deepEqual(after.cache ?? [], before.cache ?? [], 'O cache untouched');
  assert.deepEqual(after.erased ?? [], before.erased ?? [], 'O erased pile untouched');
});

test('cr:zones.general.follow-control.constructed-owner — in constructed every card a seat holds comes from the deck that seat brought, and a unit it plays is owned by it even after control changes', () => {
  const h = constructedGame(71802);
  const decks = [new Set(DECK_LIST.slice(0, 30)), new Set(DECK_LIST.slice(30, 60))];
  for (const s of [0, 1] as Seat[]) {
    assert.ok(h.state.players[s]!.hand.every(c => decks[s]!.has(c)), `seat ${s} holds only its own deck cards`);
  }
  bottomBoth(h);
  toDeployment(h);
  const P = h.state.deployPlayer!, O = (1 - P) as Seat;
  const unit = h.state.players[P]!.hand.find(c => getCard(c).kind === 'unit' && getCard(c).timing === 'deploy'
    && typeof getCard(c).mana === 'number' && (getCard(c).factions ?? []).length === 1)!;
  assert.ok(unit, 'a unit from the deck P brought');
  const el = getCard(unit).factions![0] as ResourceKind;
  giveResources(h, P, el, getCard(unit).mana as number);
  const ids = new Set(Object.keys(h.state.entities));
  h.do({ type: 'playCard', seat: P, handIndex: h.state.players[P]!.hand.indexOf(unit) });
  drain(h);
  const body = Object.values(h.state.entities).find(x => !ids.has(String(x.id)) && x.card === unit)!;
  assert.ok(body, `${unit} entered play`);
  assert.equal(body.owner, P, 'owned by the seat that brought it');
  withE(h, e => { e.giveControl(e.entity(body.id)!, O); });
  assert.equal(ent(h, body.id)!.controller, O, 'control changed');
  assert.equal(ent(h, body.id)!.owner, P, 'ownership did not');
});

/* ── the deck ── */

test('cr:zones.deck.what — the deck is face down to every seat, a draw takes its top card, and the live-draft packs are dealt out of it', () => {
  const h = new Harness(71803, undefined, 'draft');
  for (const s of [0, 1] as Seat[]) {
    const v = viewFor(h.state, s);
    assert.ok(v.sharedDeck.length > 0 && v.sharedDeck.every(c => c === HIDDEN_CARD), `seat ${s} sees the deck face down`);
  }
  assert.deepEqual(h.state.packs.map(p => p.length), [10, 10], 'two 10-card packs');
  // the live-draft pool holds one copy of each card, so a pack card is no longer in the deck
  const all = [...h.state.sharedDeck, ...h.state.packs.flat(), ...h.state.players.flatMap(p => p.hand)];
  assert.equal(all.length, 177, 'deck, packs and hands are the 177-card pool');
  assert.equal(new Set(all).size, 177, 'and no card is in two of them: the packs came out of the deck');
  const top = h.state.sharedDeck[0]!;
  withE(h, e => e.draw(0, 1));
  assert.equal(h.state.players[0]!.hand.at(-1), top, 'a draw takes the top card');
});

test('cr:zones.deck.shared — in live draft both players draw from the one shared deck', () => {
  const h = new Harness(71813, undefined, 'draft');
  assert.equal(h.state.decks, undefined, 'no per-seat decks');
  const deck = [...h.state.sharedDeck];
  withE(h, e => { e.draw(0, 1); e.draw(1, 1); });
  assert.equal(h.state.players[0]!.hand.at(-1), deck[0], 'seat 0 drew the top card');
  assert.equal(h.state.players[1]!.hand.at(-1), deck[1], 'seat 1 drew the next card of the same deck');
  assert.equal(h.state.sharedDeck.length, deck.length - 2);
});

test('cr:zones.deck.shared.constructed — in constructed there is no shared deck and each seat draws from its own', () => {
  const h = constructedGame(71814);
  assert.deepEqual(h.state.sharedDeck, [], 'no shared deck');
  assert.equal(h.state.decks!.length, 2, 'one deck per seat');
  const d0 = [...h.state.decks![0]!], d1 = [...h.state.decks![1]!];
  withE(h, e => { e.draw(0, 1); });
  assert.equal(h.state.players[0]!.hand.at(-1), d0[0], 'seat 0 drew its own top card');
  assert.deepEqual(h.state.decks![1], d1, 'seat 1 deck untouched');
});

test('cr:zones.deck.the-deck — in constructed a Glimpse 1 reveals the top of the deck of the effect controller, not of the opponent', () => {
  const h = constructedGame(71804);
  bottomBoth(h);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 2);
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.state.initiative = A;
  bottomBoth(h);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  if (h.state.priority !== A) pass(h);
  const mine = h.state.decks![A]![0]!, theirs = [...h.state.decks![D]!];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Foretell') });
  drain(h);
  assert.deepEqual(new E(h.state).cache(A).map(c => c.card), [mine], 'the caster deck top was glimpsed');
  assert.deepEqual(h.state.decks![D], theirs, 'the opponent deck is untouched');
  finishBattle(h);
});

test('cr:zones.deck.the-deck — in live draft a Glimpse 1 reveals the top of the shared deck', () => {
  const { h, A } = attacking(71815, 'A', 'metal', 2);
  if (h.state.priority !== A) pass(h);
  assert.equal(h.state.decks, undefined);
  const top = h.state.sharedDeck[0]!;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Foretell') });
  drain(h);
  assert.deepEqual(new E(h.state).cache(A).map(c => c.card), [top], 'the shared deck top was glimpsed');
  finishBattle(h);
});

/* ── the hand ── */

test('cr:zones.hand.what — a drawn card goes to the hand, and a card is played out of the hand', () => {
  const h = new Harness(71816);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const top = h.state.sharedDeck[0]!;
  const n = h.state.players[P]!.hand.length;
  withE(h, e => e.draw(P, 1));
  assert.equal(h.state.players[P]!.hand.length, n + 1);
  assert.equal(h.state.players[P]!.hand.at(-1), top, 'the drawn card is in the hand');
  giveResources(h, P, 'earth', 2);
  const i = give(h, P, 'Bumblecrab');
  const before = count(h.state.players[P]!.hand, 'Bumblecrab');
  h.do({ type: 'playCard', seat: P, handIndex: i });
  drain(h);
  assert.equal(count(h.state.players[P]!.hand, 'Bumblecrab'), before - 1, 'it left the hand');
  assert.ok(Object.values(h.state.entities).some(x => x.card === 'Bumblecrab' && x.controller === P), 'into play');
});

test('cr:zones.hand.hidden — the server view shows a hand to its holder and only card backs to the other player', () => {
  const h = new Harness(71817);
  for (const s of [0, 1] as Seat[]) {
    const o = (1 - s) as Seat;
    const v = viewFor(h.state, s);
    assert.deepEqual(v.players[s]!.hand, h.state.players[s]!.hand, `seat ${s} sees its own hand`);
    assert.equal(v.players[o]!.hand.length, h.state.players[o]!.hand.length, 'the count is public');
    assert.ok(v.players[o]!.hand.every(c => c === HIDDEN_CARD), `seat ${s} sees only backs of the other hand`);
  }
});

/* ── play ── */

test('cr:zones.play.what — a unit in play stays there through whole turns until something removes it', () => {
  const h = new Harness(71818);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const u = spawn(h, P, 'Bumblecrab');
  const turn = h.state.turn;
  for (let k = 0; k < 2; k++) {
    toNextBattle(h);
    finishBattle(h);
    assert.ok(ent(h, u), `still in play on turn ${h.state.turn}`);
  }
  assert.ok(h.state.turn >= turn + 2);
  withE(h, e => { e.destroy(e.entity(u)!, 'dies'); });
  assert.equal(ent(h, u), undefined, 'gone once something removes it');
});

test('cr:zones.play.tokens — Galactic Germination cast by the attacker creates its unit tokens straight into play in the battle region', () => {
  const h = new Harness(71806);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const w = spawn(h, A, 'Good Whale');
  spawn(h, D, 'Unit Token');
  giveResources(h, A, 'water', 2); giveResources(h, A, 'wood', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[w]] });
  if (h.state.priority !== A) pass(h);
  const battleRegion = ent(h, w)!.region;
  const home = new E(h.state).homeRegion(A);
  assert.notEqual(battleRegion, home, 'the battle is away from the attacker home');
  const ids = new Set(Object.keys(h.state.entities));
  const hand = [...h.state.players[A]!.hand], bin = [...h.state.players[A]!.bin];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Galactic Germination') });
  h.do({ type: 'decide', seat: h.state.decision!.seat, choice: 0 });
  drain(h);
  const made = Object.values(h.state.entities).filter(x => !ids.has(String(x.id)) && x.token);
  assert.ok(made.length >= 1, 'tokens were created');
  for (const t of made) {
    assert.equal(t.kind, 'unit');
    assert.equal(t.region, battleRegion, 'in the region where it was created');
  }
  assert.deepEqual(h.state.players[A]!.hand, hand, 'no token passed through the hand');
  assert.deepEqual(h.state.players[A]!.bin, [...bin, 'Galactic Germination'], 'only the spell reached the bin');
  finishBattle(h);
});

test('cr:zones.play.tokens — Ignis Sprite creates its Fireball spell token straight into play in its region', () => {
  const h = new Harness(71807);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const before = h.state.players[P]!.hand.length;
  const s = spawn(h, P, 'Ignis Sprite');
  const toks = Object.values(h.state.entities).filter(x => x.kind === 'spellToken' && x.controller === P);
  assert.equal(toks.length, 1);
  assert.equal(toks[0]!.card, 'Fireball');
  assert.equal(toks[0]!.region, ent(h, s)!.region, 'in the region it was created');
  assert.equal(h.state.players[P]!.hand.length, before, 'not via the hand');
});

test('cr:zones.play.spell-units — Jelly resolves into play as a unit and does not go to the bin', () => {
  const h = new Harness(71819);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const w = spawn(h, A, 'Good Whale');
  giveResources(h, D, 'water', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[w]] });
  while (h.state.priority !== D) pass(h);
  const bin = count(h.state.players[D]!.bin, 'Jelly');
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Jelly') });
  pick(h, { unit: w });
  drain(h);
  assert.ok(Object.values(h.state.entities).some(x => x.card === 'Jelly' && x.kind === 'unit' && x.controller === D),
    'a Jelly unit is in play');
  assert.equal(count(h.state.players[D]!.bin, 'Jelly'), bin, 'not in the bin');
  finishBattle(h);
});

/* ── the bin ── */

test('cr:zones.bin.what — a discarded card goes to the bin of the player who discarded it', () => {
  const h = new Harness(71820);
  toDeployment(h);
  const P = h.state.deployPlayer!, O = (1 - P) as Seat;
  const ob = [...h.state.players[O]!.bin];
  withEUnsettled(h, e => { e.discardFromHand(P, give(h, P, 'Geode')); });
  assert.equal(h.state.players[P]!.bin.at(-1), 'Geode', 'into the discarder bin');
  assert.deepEqual(h.state.players[O]!.bin, ob, 'not into the other bin');
});

test('cr:zones.bin.entering — a unit that dies, is deleted or is sacrificed, and a discarded card, each go to the bin', () => {
  const h = new Harness(71821);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const a = spawn(h, P, 'Bumblecrab'), b = spawn(h, P, 'Geode'), c = spawn(h, P, 'Rune Channeler');
  withE(h, e => {
    e.destroy(e.entity(a)!, 'dies');
    e.destroy(e.entity(b)!, 'is deleted');
    e.destroy(e.entity(c)!, 'is sacrificed');
  });
  withEUnsettled(h, e => { e.discardFromHand(P, give(h, P, 'Gublin')); });
  const bin = h.state.players[P]!.bin;
  for (const n of ['Bumblecrab', 'Geode', 'Rune Channeler', 'Gublin']) assert.equal(count(bin, n), 1, `${n} is in the bin`);
});

test('cr:zones.bin.entering — a resolved spell, a negated spell and a spell that fails to resolve each go to the bin of their caster', () => {
  // resolved
  {
    const { h, A, D, atk } = attacking(71822, 'D', 'fire', 2);
    while (h.state.priority !== D) pass(h);
    h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
    pick(h, { unit: atk });
    drain(h);
    assert.equal(count(h.state.players[D]!.bin, 'Luminous Arc'), 1, 'resolved → bin');
    assert.equal(count(h.state.players[A]!.bin, 'Luminous Arc'), 0, 'not the other bin');
    finishBattle(h);
  }
  // negated
  {
    const { h, A, D, atk } = attacking(71823, 'D', 'fire', 2);
    giveResources(h, A, 'wood', 2);
    while (h.state.priority !== D) pass(h);
    h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
    pick(h, { unit: atk });
    const item = h.state.stack.find(i => i.card === 'Luminous Arc')!;
    h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Hush Mush') });
    pick(h, { stack: item.id });
    pass(h); pass(h);
    assert.ok(!h.state.stack.some(i => i.id === item.id), 'negated');
    assert.equal(count(h.state.players[D]!.bin, 'Luminous Arc'), 1, 'negated → bin');
    assert.ok(ent(h, atk), 'and it did nothing');
    finishBattle(h);
  }
  // fails to resolve
  {
    const { h, D, atk } = attacking(71824, 'D', 'fire', 2);
    while (h.state.priority !== D) pass(h);
    h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
    pick(h, { unit: atk });
    const mark = h.events.length;
    withE(h, e => { e.recall(e.entity(atk)!); });
    drain(h);
    assert.ok(h.events.slice(mark).some(ev => ev.type === 'fizzled'), 'it fizzled');
    assert.equal(count(h.state.players[D]!.bin, 'Luminous Arc'), 1, 'fizzled → bin');
    finishBattle(h);
  }
});

test('cr:zones.bin.identity — a bin holds bare card names, and two copies of one card are offered as the same name told apart only by which copy', () => {
  const { h, A, D } = attacking(71808, 'A', 'dark', 2);
  h.state.players[D]!.bin = ['Jelly', 'Shard Sprite', 'Jelly'];
  if (h.state.priority !== A) pass(h);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Collect Remains') });
  const jellies = h.state.decision!.options.map(o => o.value as { bin?: { seat: Seat; card: string; nth?: number } })
    .filter(v => v.bin?.seat === D && v.bin.card === 'Jelly');
  assert.equal(jellies.length, 2, 'one option per copy');
  for (const j of jellies) assert.deepEqual(Object.keys(j.bin!).filter(k => k !== 'nth').sort(), ['card', 'seat'],
    'a bin ref names only the seat, the card name and which copy');
  assert.deepEqual(jellies.map(j => j.bin!.nth ?? 0).sort(), [0, 1], 'the copies differ only by their copy number');
  assert.ok(h.state.players[D]!.bin.every(c => typeof c === 'string'), 'the bin stores bare names');
  pick(h, { bin: { seat: D, card: 'Jelly', nth: 1 } });
  drain(h);
  assert.deepEqual(h.state.players[D]!.bin, ['Jelly', 'Shard Sprite'], 'one Jelly left, indistinguishable from the other');
  finishBattle(h);
});

/* ── the stack ── */

test('cr:zones.stack.what — two spells wait on the stack and the one put there last resolves first', () => {
  const h = new Harness(71825);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const x = spawn(h, A, 'Good Whale');
  const y = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'fire', 2); giveResources(h, D, 'fire', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[x]] });
  while (h.state.priority !== D) pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: x });
  assert.equal(h.state.priority, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: y });
  assert.deepEqual(h.state.stack.map(i => i.controller), [D, A], 'both wait on the stack, A on top');
  pass(h); pass(h);
  assert.equal(h.state.stack.length, 1, 'one resolved');
  assert.equal(h.state.stack[0]!.controller, D, 'the last one put there (A) resolved first');
  assert.ok(!ent(h, y) || ent(h, y)!.damage > 0, 'A spell hit its target');
  assert.ok(ent(h, x) && ent(h, x)!.damage === 0, 'D spell has not yet');
  finishBattle(h);
});

/* ── the erased pile ── */

test('cr:zones.erased.what — Celestial Purge takes a unit out of the game onto the erased pile: no bin and no death', () => {
  const h = new Harness(71826);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const w = spawn(h, A, 'Good Whale');
  giveResources(h, D, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[w]] });
  while (h.state.priority !== D) pass(h);
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Celestial Purge') });
  pick(h, { unit: w });
  drain(h);
  assert.equal(ent(h, w), undefined, 'out of play');
  assert.equal(count(erasedOf(h, A), 'Good Whale'), 1, 'on the erased pile');
  assert.equal(count(h.state.players[A]!.bin, 'Good Whale') + count(h.state.players[D]!.bin, 'Good Whale'), 0, 'in no bin');
  assert.equal(h.events.slice(mark).filter(ev => ev.type === 'died').length, 0, 'not a death');
  finishBattle(h);
});

test('cr:zones.erased.public — the server view shows each erased pile in full to both seats', () => {
  const h = new Harness(71827);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  withEUnsettled(h, e => { give(h, P, 'Geode'); e.eraseFromZone(P, 'Geode', 'hand', 'erased'); });
  const pile = erasedOf(h, P);
  assert.ok(pile.includes('Geode'), 'the pile holds the erased card');
  for (const s of [0, 1] as Seat[]) {
    assert.deepEqual(viewFor(h.state, s).players[P]!.erased, pile, `seat ${s} reads the whole pile`);
  }
});

test('cr:zones.erased.final — a card on the erased pile adds nothing to the legal actions, where the same card in the bin does', () => {
  const h = new Harness(71805);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'Unit Token');
  giveResources(h, P, 'earth', 2);
  const base = JSON.stringify(h.legal(P));
  h.state.players[P]!.erased = [...(h.state.players[P]!.erased ?? []), 'Bumblecrab'];
  assert.equal(JSON.stringify(h.legal(P)), base, 'erased: no action reaches it');
  h.state.players[P]!.bin.push('Bumblecrab');
  assert.ok(h.legal(P).some(a => a.type === 'augment' && (a as { from: string }).from === 'bin'),
    'control: from the bin the same card is offered');
});

/* ── the recycle pile ── */

test('cr:zones.recycle.what — a card recycled for a resource is drawn again once the rest of the deck is gone, so it never left the game', () => {
  const h = new Harness(71828);
  const P: Seat = 0;
  h.state.sharedDeck = ['Geode', 'Gublin'];
  const card = h.state.players[P]!.hand[0]!;
  h.do({ type: 'recycleForResource', seat: P, handIndex: 0, element: 'fire' });
  assert.deepEqual(h.state.sharedRecycled, [card], 'it went under the deck, past the mark');
  assert.equal(count(erasedOf(h, P), card), 0, 'it is not out of the game');
  withE(h, e => e.draw(P, 3));
  assert.deepEqual(h.state.players[P]!.hand.slice(-3), ['Geode', 'Gublin', card], 'under the rest of the deck, and back');
});

test('cr:zones.recycle.mark.order — the recycle pile is hidden from both seats and is shuffled before it is drawn again', () => {
  const cards = ['Geode', 'Gublin', 'Jelly', 'Bumblecrab', 'Shard Sprite', 'Good Whale', 'Luminous Arc', 'Foretell'];
  let reordered = 0;
  for (let seed = 71830; seed < 71850; seed++) {
    const h = new Harness(seed);
    h.state.sharedDeck = [];
    withE(h, e => { for (const c of cards) e.recycleToBottom(0, c); });
    for (const s of [0, 1] as Seat[]) {
      assert.ok(viewFor(h.state, s).sharedRecycled!.every(c => c === HIDDEN_CARD), 'nobody can read the pile');
    }
    const n = h.state.players[0]!.hand.length;
    withE(h, e => e.draw(0, cards.length));
    const drawn = h.state.players[0]!.hand.slice(n);
    assert.deepEqual([...drawn].sort(), [...cards].sort(), 'every recycled card comes back');
    if (JSON.stringify(drawn) !== JSON.stringify(cards)) reordered++;
  }
  assert.ok(reordered > 0, 'the recycling order is not the draw order');
});

/* ── the pack ── */

test('cr:zones.pack.what — a live draft deals each seat a 10-card pack from the deck at the start, and the pack is what that seat drafts from', () => {
  const h = new Harness(71851, undefined, 'draft');
  assert.deepEqual(h.state.packs.map(p => p.length), [10, 10]);
  const deck = new Set(h.state.sharedDeck);
  for (const p of h.state.packs) for (const c of p) assert.ok(!deck.has(c), `${c} left the deck`);
  const commits = h.legal(0).filter(a => a.type === 'draftCommit');
  assert.ok(commits.length > 1, 'seat 0 may draft from it');
});

test('cr:zones.pack.what.constructed — a constructed game has no packs and no draft step', () => {
  const h = constructedGame(71852);
  assert.deepEqual(h.state.packs, [[], []]);
  assert.equal(h.state.draftDone, null);
  assert.ok(!h.legal(0).some(a => a.type === 'draftCommit') && !h.legal(1).some(a => a.type === 'draftCommit'));
});

test('cr:zones.pack.private — a seat sees its own pack only while its draft step is open, and never the other pack', () => {
  const h = new Harness(71853, undefined, 'draft');
  for (const s of [0, 1] as Seat[]) {
    const v = viewFor(h.state, s), o = (1 - s) as Seat;
    assert.deepEqual(v.packs[s], h.state.packs[s], `seat ${s} sees its own pack in its draft step`);
    assert.ok(v.packs[o]!.every(c => c === HIDDEN_CARD), `seat ${s} never sees the other pack`);
  }
  const H = h.state.players[0]!.hand.length;
  h.do({ type: 'draftCommit', seat: 0, packIndices: h.state.packs[0]!.map((_, i) => H + i) });
  assert.ok(viewFor(h.state, 0).packs[0]!.every(c => c === HIDDEN_CARD), 'committed: its own pack is face down again');
  assert.deepEqual(viewFor(h.state, 1).packs[1], h.state.packs[1], 'the other seat is still drafting');
  assert.ok(viewFor(h.state, 1).packs[0]!.every(c => c === HIDDEN_CARD));
});

test('cr:zones.pack.drafting — the draft commit merges hand and pack, keeps any cards, and passes on a pack of exactly 10', () => {
  const h = new Harness(71854, undefined, 'draft');
  const hand = [...h.state.players[0]!.hand], pack = [...h.state.packs[0]!];
  const pile = [...hand, ...pack];
  const H = hand.length;
  assert.throws(() => h.do({ type: 'draftCommit', seat: 0, packIndices: [H, H + 1, H + 2, H + 3, H + 4, H + 5, H + 6, H + 7, H + 8] }),
    IllegalAction, 'a pack of 9 is refused');
  assert.throws(() => h.do({ type: 'draftCommit', seat: 0, packIndices: [0, H, H + 1, H + 2, H + 3, H + 4, H + 5, H + 6, H + 7, H + 8, H + 9] }),
    IllegalAction, 'a pack of 11 is refused');
  const packIndices = [0, 1, H + 2, H + 3, H + 4, H + 5, H + 6, H + 7, H + 8, H + 9];   // keep pack cards 0 and 1
  h.do({ type: 'draftCommit', seat: 0, packIndices });
  assert.deepEqual([...h.state.players[0]!.hand].sort(), [...hand.slice(2), pack[0]!, pack[1]!].sort(), 'kept two pack cards');
  const H1 = h.state.players[1]!.hand.length;
  h.do({ type: 'draftCommit', seat: 1, packIndices: h.state.packs[1]!.map((_, i) => H1 + i) });
  assert.equal(h.state.packs[1]!.length, 10, 'the pack passed on holds exactly 10');
  assert.deepEqual(h.state.packs[1], packIndices.map(i => pile[i]), 'and it is the pack seat 0 left');
});

/* ── zone changes ── */

test('cr:zones.changes.tokens.spell-tokens-regroup — a Fireball spell token left unused is erased at regroup', () => {
  const h = new Harness(71855);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'Ignis Sprite');
  const tok = Object.values(h.state.entities).find(x => x.kind === 'spellToken' && x.controller === P)!;
  toNextBattle(h);
  assert.ok(ent(h, tok.id), 'the token is still in play in the battle phase');
  const mark = h.events.length;
  finishBattle(h);
  const ev = h.events.slice(mark);
  const rg = ev.findIndex(e => e.type === 'regroup');
  assert.ok(rg >= 0, 'regroup ran');
  assert.equal(ent(h, tok.id), undefined, 'gone after regroup');
  assert.ok(ev.slice(rg).some(e => e.type === 'erased'), 'erased during regroup');
});
