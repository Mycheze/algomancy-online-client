/* 629 — CT-292: the sized (non-1/1) Unit Token creators that 458's sweep does
 * not reach, driven DIRECTLY with an Automaton of Abundance on their side and a
 * nonzero X.
 *
 * 458's sweep drills every card that creates a Unit Token and checks that each
 * Automaton copy has its original's printed stats (CR 304.14). Since CT-292 its
 * expensive press-mode drill runs only for the cards whose printed text creates
 * a token bigger than 1/1, and even then the drill's boards never give some X/X
 * creators a nonzero X. This file drives those by hand, so each one is seen
 * making an X/X with X > 0 and the Automaton copying it as the same X/X.
 *
 * §0 is the derived census: every sized creator in the pool must be reached by
 * 458's sweep (its positive-control list) or driven here. A new card that
 * creates "a 6/6 unit" fails §0 until it is in one or the other.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import { DECK_LIST, createsOf } from '../src/cards/registry.ts';
import type { Seat } from '../src/types.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, unitsOf, withE } from './util.ts';

/** the printed (layer-1) stats of every Unit Token `seat` controls */
function unitTokenStats(h: Harness, seat: Seat): string[] {
  const e = new E(h.state);
  return unitsOf(h, seat).filter(u => u.card === 'Unit Token' && u.token)
    .map(u => e.printedStats(u).join('/')).sort();
}

/** pass priority until `seat` has at least `n` Unit Tokens or nothing is left to pass */
function passUntilTokens(h: Harness, seat: Seat, n: number): void {
  for (let i = 0; i < 10 && unitTokenStats(h, seat).length < n && h.state.priority !== null && !h.state.decision; i++) pass(h);
}

/** 458's sweep reaches these (its positive-control list); everything else sized is driven here */
const SWEPT = ['Mirage Walker', 'Spawntender', 'Feed to Hooba', 'Flesh Tithe', 'Forager of the Fallen',
  'Xenopod Progenitor', 'Stoneborn Progenitor', 'Tidelurker', 'Embermaw Fledgling'];
const DRIVEN = new Set<string>();

test('CR 304.14 / CT-292: Awoken Tomb dealt 3 makes a 3/3, and the Automaton copies it as a 3/3', () => {
  DRIVEN.add('Awoken Tomb');
  const h = new Harness(62901);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  spawn(h, A, 'Automaton of Abundance');
  const tomb = spawn(h, A, 'Awoken Tomb');                  // 0/5
  const src = spawn(h, D, 'Rune Channeler');
  withE(h, e => {
    e.dealEffectDamageAll({
      controller: D, sourceName: 'Rune Channeler', sourceId: src, region: e.homeRegion(A),
      targets: [], event: null, eraseSelf: () => {}, choose: () => { throw new Error('no choice expected'); },
    }, [{ target: e.entity(tomb)!, n: 3 }]);
  });
  passUntilTokens(h, A, 2);
  assert.deepEqual(unitTokenStats(h, A), ['3/3', '3/3'], 'the 3/3 and its copy, both 3/3');
});

test('CR 304.14 / CT-292: Perpetual Construct given a [3] mod makes a 3/3, and the Automaton copies it as a 3/3', () => {
  DRIVEN.add('Perpetual Construct');
  const h = new Harness(62902);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Automaton of Abundance');
  const pc = spawn(h, A, 'Perpetual Construct');
  const mod = 'Arcane Concentrator';                         // mana 3
  assert.equal(getCard(mod).mana, 3, 'premise: the mod costs [3]');
  withE(h, e => { e.attachMod(e.entity(pc)!, mod, A, 'augment'); });
  passUntilTokens(h, A, 2);
  assert.deepEqual(unitTokenStats(h, A), ['3/3', '3/3'], 'the 3/3 and its copy, both 3/3');
});

// Both of these are fought in A's OWN region: the Automaton's replacement and
// the Concentrator's trigger read their own region (CR 601.1b), so A defends at
// home, where both stand, and acts there.
test('CR 304.14 / CT-292: Soul Siphon after 7 life lost makes a 7/7, and the Automaton copies it as a 7/7', () => {
  DRIVEN.add('Soul Siphon');
  const h = new Harness(62903);
  toDeployment(h);
  const D = h.state.initiative as Seat, A = (1 - D) as Seat;
  spawn(h, A, 'Automaton of Abundance');
  const atk = spawn(h, D, 'Good Whale');                     // 7 power, no text
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: A, blocks: {} });
  pass(h); pass(h);                                          // combat damage: A loses 7
  assert.equal(h.state.players[A]!.life, 23, 'premise: A lost 7 in this battle');
  for (let i = 0; i < 4 && h.state.priority !== A && h.state.priority !== null; i++) pass(h);
  assert.equal(h.state.priority, A, 'premise: A holds priority in the after-combat window');
  giveResources(h, A, 'water', 2);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Soul Siphon') });
  pick(h, { player: A });                                    // "the life target player lost in this battle"
  passUntilTokens(h, A, 2);
  assert.deepEqual(unitTokenStats(h, A), ['7/7', '7/7'], 'the 7/7 and its copy, both 7/7');
});

test('CR 304.14 / CT-292: Arcane Concentrator sees a [2] spell and makes a 2/2, and the Automaton copies it as a 2/2', () => {
  DRIVEN.add('Arcane Concentrator');
  const h = new Harness(62904);
  toDeployment(h);
  const D = h.state.initiative as Seat, A = (1 - D) as Seat;
  spawn(h, A, 'Automaton of Abundance');
  spawn(h, A, 'Arcane Concentrator');
  const atk = spawn(h, D, 'Good Whale');
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[atk]] });
  pass(h);                                                   // D passes, A holds priority at home
  giveResources(h, A, 'fire', 2);
  assert.equal(getCard('Luminous Arc').mana, 2, 'premise: the spell costs [2]');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: atk });
  passUntilTokens(h, A, 2);
  assert.deepEqual(unitTokenStats(h, A), ['2/2', '2/2'], 'the 2/2 and its copy, both 2/2');
});

test('CR 304.14 / CT-292 §0: every sized Unit Token creator is reached by the 458 sweep or driven here', () => {
  const SIZED = /\b(\d+|X)\/(\d+|X)\s+units?\b/gi;
  const sized = [...new Set(DECK_LIST.filter(n => createsOf(n).includes('Unit Token')))].filter(n =>
    [...getCard(n).text.replace(/\{\/?n\}|\{\/?i1?\}/g, ' ').matchAll(SIZED)].some(m => !(m[1] === '1' && m[2] === '1')));
  assert.ok(sized.length >= 15, `derived from printed text (${sized.length})`);
  const missing = sized.filter(n => !SWEPT.includes(n) && !DRIVEN.has(n));
  assert.deepEqual(missing.sort(), ['Keeper of Tithes', 'Prediction Prophet'],
    'the sized creators nobody drives: exactly the two whose trigger needs the haste step (see the report)');
});
