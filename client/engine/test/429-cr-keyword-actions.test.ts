/**
 * Comprehensive rules, unit U18 (keyword actions) — CR example tests.
 *
 * Generated from the verifier probes for comprehensive-rules unit U18
 * (data/comprehensive-rules/build/probes/U18/). Each test title starts with
 * `cr:<key>`, and the test backs the rule whose key it names: the rule record
 * in data/comprehensive-rules/rules/U18.json lists this file in its
 * sources.tests, and an example may be bound to the test by its title.
 *
 * The one test titled "engine differs" is the exception: its rule states the
 * printed reading and carries an engineDiffers mark, and this test pins the
 * divergence the mark describes. It is deliberately NOT listed in that rule's
 * sources. When it goes red the engine has been brought in line with the
 * printed reading: drop the engineDiffers mark and the test, and bind a real
 * example.
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
import type { EntityId, Seat } from '../src/types.ts';
import {
  absorb, ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, unitsOf, withE,
} from './util.ts';

/** a vanilla token unit with the given stats, in the seat's home region */
function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  return u.id;
}

// ---------------------------------------------------------------- trash

test('cr:keywords.actions.trash.unstable-death — engine differs: a printed-Unstable card that dies in play is trashed once and then erased', () => {
  const h = new Harness(71803);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const u = spawn(h, P, 'Aberrant Statweaver');
  assert.ok(h.q.isUnstable(ent(h, u)!), 'premise: it is Unstable in play');
  const mark = h.events.length;
  withE(h, e => { e.destroy(e.entity(u)!, 'dies'); });
  const after = h.events.slice(mark);
  assert.equal(after.filter(ev => ev.type === 'died').length, 1, 'it died');
  assert.equal(after.filter(ev => ev.type === 'trashed' && ev.data!['card'] === 'Aberrant Statweaver').length, 1,
    'and the engine trashed it (the printed reading says it is not trashed)');
  assert.ok(new E(h.state).erased(P).includes('Aberrant Statweaver'), 'then erased');
  assert.ok(!h.state.players[P]!.bin.includes('Aberrant Statweaver'), 'and not left in the bin');
});

// ---------------------------------------------------------------- discard

test('cr:keywords.actions.discard — a discard from a hand puts nothing on the stack and is not played, and a cached card cannot be discarded', () => {
  const h = new Harness(71823);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const idx = give(h, P, 'Good Whale');
  const mark = h.events.length;
  const stackBefore = h.state.stack.length;
  withE(h, e => { e.discardFromHand(P, idx); });
  const after = h.events.slice(mark);
  assert.equal(after.filter(ev => ev.type === 'cardPlayed' || ev.type === 'spellPlayed' || ev.type === 'stackPushed').length, 0,
    'not played: no cardPlayed, spellPlayed or stackPushed event');
  assert.equal(h.state.stack.length, stackBefore, 'nothing on the stack');
  assert.equal(after.filter(ev => ev.type === 'trashed').length, 1, 'trashed');
  assert.ok(h.state.players[P]!.bin.includes('Good Whale'), 'in the bin');
  // the cache: a "Discard me" card held under a live glimpse
  withE(h, e => { e.cacheCard(P, 'Nothyr', 'deck', { playable: true }); });
  giveResources(h, P, 'dark', 4);
  const ci = h.state.players[P]!.cache!.length - 1;
  assert.ok(!h.legal(P).some(a => a.type === 'playCached' && (a as { mode?: string }).mode === 'discardMe'),
    'no discard-me offer from the cache');
  assert.throws(() => h.do({ type: 'playCached', seat: P, index: ci, mode: 'discardMe' } as never),
    (err: unknown) => err instanceof IllegalAction && /cached card cannot be discarded/.test(String((err as Error).message)));
});

// ---------------------------------------------------------------- sacrifice

test('cr:keywords.actions.sacrifice.control — General Smof offers each player only their own units and asks each player to choose', () => {
  const h = new Harness(71822);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const smof = spawn(h, A, 'General Smof');
  const fodder = spawn(h, A, 'Conduit of Pain');
  spawn(h, D, 'Good Whale');
  spawn(h, D, 'Curio Drifter');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[smof], [fodder]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  pass(h); pass(h);
  const asked: Seat[] = [];
  let guard = 6;
  while (h.state.decision && guard-- > 0) {
    const dec = h.state.decision;
    asked.push(dec.seat as Seat);
    for (const o of dec.options) {
      const u = h.state.entities[o.value as number];
      assert.ok(u, 'every option is a unit');
      assert.equal(u!.controller, dec.seat, `seat ${dec.seat} offered ${u!.card} controlled by ${u!.controller}`);
    }
    h.do({ type: 'decide', seat: dec.seat, choice: 0 });
  }
  assert.deepEqual(asked.slice().sort(), [A, D].sort(), 'each player chose for themself');
  finishBattle(h);
});

test('cr:keywords.actions.sacrifice.control — when Ghord triggers, the opponent and not the Ghord player is asked to choose, from their own units', () => {
  const h = new Harness(71805);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ghord = spawn(h, A, 'Ghord');
  const fodder = spawn(h, A, 'Curio Drifter');
  const d1 = spawn(h, D, 'Good Whale');
  const d2 = spawn(h, D, 'Curio Drifter');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ghord], [fodder]] });
  withE(h, e => { e.destroy(e.entity(fodder)!, 'is sacrificed'); });
  let guard = 10;
  while (!h.state.decision && h.state.stack.length && guard-- > 0) pass(h);
  const dec = h.state.decision;
  assert.ok(dec, 'Ghord asked a question');
  assert.equal(dec!.seat, D, 'the sacrificing opponent chooses, not the effect controller');
  const ids = dec!.options.map(o => o.value);
  assert.ok(ids.includes(d1) && ids.includes(d2), 'from their own units');
});

// ---------------------------------------------------------------- delete

test('cr:keywords.actions.delete — Throw off a Cliff deletes a unit: one died event with the verb is deleted, and the card goes to its controller bin', () => {
  const h = new Harness(71808);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 1, 1);
  tok(h, D, 0, 13);
  const plain = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Throw off a Cliff') });
  pick(h, { unit: plain });
  pass(h); pass(h);
  const died = h.events.slice(mark).filter(ev => ev.type === 'died' && ev.data!['card'] === 'Good Whale');
  assert.equal(died.length, 1, 'a delete is a death');
  assert.equal(died[0]!.data!['verb'], 'is deleted');
  assert.ok(h.state.players[D]!.bin.includes('Good Whale'), 'into its controller bin');
  finishBattle(h);
});

// ---------------------------------------------------------------- recall

test('cr:keywords.actions.recall — Prismatic Observer recalls a cached card to the hand: the cache is a zone a recall takes from', () => {
  const h = new Harness(71806);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  let uid = -1;
  withE(h, e => { uid = e.cacheCard(A, 'Wisp', 'effect', { prophecy: 'Three Turns Pass' }).uid!; });
  const obs = spawn(h, A, 'Prismatic Observer');
  const before = h.state.players[A]!.hand.filter(c => c === 'Wisp').length;
  h.do({ type: 'activateAbility', seat: A, entityId: obs, abilityIndex: 0 });
  pick(h, { cached: { seat: A, uid } });
  let guard = 10;
  while (h.state.stack.length && !h.state.decision && guard-- > 0) pass(h);
  assert.equal(h.state.players[A]!.hand.filter(c => c === 'Wisp').length, before + 1, 'the cached card is in the hand');
  assert.equal((h.state.players[A]!.cache ?? []).length, 0, 'and left the cache');
});

test('cr:keywords.actions.recall.from-bin — Eldritch Reclaimer offers a unit in its own bin and never one in the opponent bin, even with both players in the battle', () => {
  const h = new Harness(71807);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[A]!.bin.push('Good Whale');
  h.state.players[D]!.bin.push('Echo of Despair');
  const region = h.state.battle!.region;
  assert.equal(h.state.regions[region]!.presentSeats.length, 2, 'premise: both seats present');
  const spec = getCard('Eldritch Reclaimer').spellEffect!.targets!;
  const refs = h.q.targetCandidates(spec as never, region, undefined, A).map(r => JSON.stringify(r));
  assert.ok(refs.includes(JSON.stringify({ bin: { seat: A, card: 'Good Whale' } })), 'my bin unit is offered');
  assert.ok(!refs.some(r => r.includes(`"seat":${D}`)), `the opponent bin is not: ${refs}`);
});

// ---------------------------------------------------------------- fight

test('cr:keywords.actions.fight.not-spell-damage — the 3 damage Fight makes a unit deal does not trigger Ember of Life', () => {
  const h = new Harness(71801);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ally = tok(h, A, 3, 10);
  const ember = spawn(h, A, 'Ember of Life');
  const wall = tok(h, D, 0, 20);
  giveResources(h, A, 'earth', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ally], [ember]] });
  const before = unitsOf(h, A).length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Fight') });
  pick(h, { unit: ally });
  pick(h, { unit: wall });
  pass(h); pass(h);
  pass(h); pass(h);
  assert.equal(ent(h, wall)!.damage, 3, 'the fight happened: the ally dealt its 3 power');
  assert.equal(unitsOf(h, A).length, before, 'no 1/1s: fight damage is the unit damage, not a spell effect damage');
  finishBattle(h);
});

test('cr:keywords.actions.fight.not-spell-damage — control: in the same setup the damage of the spell Luminous Arc does trigger Ember of Life', () => {
  const h = new Harness(71809);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ally = tok(h, A, 3, 10);
  const ember = spawn(h, A, 'Ember of Life');
  const wall = tok(h, D, 0, 20);
  giveResources(h, A, 'fire', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[ally], [ember]] });
  const before = unitsOf(h, A).length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: wall });
  let guard = 12;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 }); else pass(h);
  }
  assert.ok(ent(h, wall)!.damage > 0, 'the spell dealt damage');
  assert.ok(unitsOf(h, A).length > before, 'and Ember of Life made 1/1s, so the silence after Fight is meaningful');
  finishBattle(h);
});

test('cr:keywords.actions.fight.lost-one — Fight that loses one fighter resolves without fizzling and deals the survivor no damage', () => {
  const h = new Harness(71802);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const mine = spawn(h, A, 'Good Whale');
  const theirs = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'earth', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Fight') });
  pick(h, { unit: mine });
  pick(h, { unit: theirs });
  withE(h, e => e.destroy(e.s.entities[theirs]!, 'dies'));
  const mark = h.events.length;
  pass(h); pass(h);
  const after = h.events.slice(mark);
  assert.equal(after.filter(ev => ev.type === 'fizzled').length, 0, 'the item does not fizzle');
  assert.equal(ent(h, mine)!.damage, 0, 'and the survivor took nothing');
  assert.ok(h.log.some(l => /no fight/.test(l)), 'the item resolved and said it did nothing');
  finishBattle(h);
});

// ---------------------------------------------------------------- glimpse

test('cr:keywords.actions.glimpse.whose-deck — in constructed a glimpse reads the deck of the glimpser and leaves the other deck untouched', () => {
  const h = new Harness(71821, undefined, 'constructed', undefined, [DECK_LIST.slice(0, 30), DECK_LIST.slice(30, 60)]);
  assert.equal(h.state.mode, 'constructed');
  const g = new E(h.state);
  g.deckOf(0).splice(0, 3, 'Geode', 'Geode', 'Geode');
  g.deckOf(1).splice(0, 3, 'Gublin', 'Good Whale', 'Jelly');
  const deck0 = [...g.deckOf(0)];
  const deck1Len = g.deckOf(1).length;
  const kept = g.glimpse(1, 3);
  h.state = g.s; absorb(h, g.events);
  assert.deepEqual(kept, ['Gublin'], 'the glimpser revealed the top of their own deck');
  assert.equal(new E(h.state).deckOf(1).length, deck1Len - 3, 'three left the deck of seat 1');
  assert.deepEqual(new E(h.state).deckOf(0), deck0, 'the deck of seat 0 is untouched');
  assert.deepEqual(new E(h.state).recycleOf(1), ['Good Whale', 'Jelly'], 'the rest recycled into the own pile of seat 1');
  assert.deepEqual((h.state.players[1]!.cache ?? []).map(c => c.card), ['Gublin'], 'cached in the cache of seat 1');
});

// ---------------------------------------------------------------- general

test('cr:keywords.actions.general — where a card prints the reminder for a keyword action, the reminder a player is shown is that printed sentence and not our paraphrase', async () => {
  await import('../src/index.ts');
  const { AUTHORED_GLOSSARY, GLOSSARY, PRINTED_REMINDERS } = await import('../../ui/glossary.ts');
  const { cardPanelHtml } = await import('../../ui/cardpanel.ts');
  // the keyword actions this section defines, read off the rule keys' printed verbs
  const verbs = ['trash', 'discard', 'sacrifice', 'delete', 'erase', 'recall', 'cache', 'glimpse', 'recycle',
    'fight', 'rockfall', 'exchange', 'prophesy'];
  const checked: string[] = [];
  for (const verb of verbs) {
    const row = GLOSSARY.find(e => e.term.toLowerCase() === verb);
    const printed = row && PRINTED_REMINDERS.get(row.term)?.[0];
    if (!row || !printed) continue;
    checked.push(row.term);
    const authored = AUTHORED_GLOSSARY.find(e => e.term === row.term)!;
    assert.notEqual(authored.text, printed.text, `premise: our ${row.term} paraphrase differs from the print`);
    assert.equal(row.text, printed.text, `the ${row.term} reminder shown is the sentence ${printed.card} prints`);
    assert.equal(row.printedOn, printed.card, `and it says which card prints it`);
    assert.equal(row.rule, authored.text, 'our paraphrase is kept only as the longer rule, not shown as the reminder');
    const card = getCard(printed.card);
    assert.ok(card.text.replace(/\s+/g, ' ').includes(printed.text.replace(/\s+/g, ' ')),
      `premise: ${printed.card} really prints it`);
    const html = cardPanelHtml(printed.card, { close: 'cards-unfocus' });
    assert.ok(html.includes(printed.text), `the card inspector for ${printed.card} shows the printed reminder`);
  }
  assert.ok(checked.includes('Glimpse'), 'not vacuous: Glimpse has a printed reminder and was checked');
});
