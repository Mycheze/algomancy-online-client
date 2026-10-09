/**
 * R337–R339 — Tides of the Cosmos and the other mid-resolution plays, fixed
 * to the RAQ (CT-220, CT-221, CT-222).
 *
 * RAQ "[Solved] Tides of Cosmos - all you need to know." (_passer):
 *   3. "Tides allows you to play Viruses/Ambushes/Prophecy (you still look at
 *      'main' cost of the card, even if you used it as Ambush/Prophecy)."
 *   5. "Any additional [cost] of the card must be paid. That means you CANNOT
 *      use Volatile Toxicity on Towering Colossus from same Tides of the
 *      Cosmos (he cannot be sacrificed, since he is not yet in play)."
 *   6. "Any spells with X cost can only be played with X=0 … it also means
 *      that you CANNOT play Frosted Denial from Tides of Cosmos."
 *
 * The three reproductions that found these are in 396 ("RAQ Tides 3/5/6");
 * these follow each fix through to what ends up on the board.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import {
  ent, finishBattle, give, giveResources, pass, spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';
import type { Seat } from '../src/types.ts';

function decide(h: Harness, match: (label: string) => boolean): void {
  const d = h.state.decision;
  assert.ok(d, 'a decision is pending');
  const i = d.options.findIndex(o => match(o.label));
  assert.notEqual(i, -1, `no option matching; menu was [${d.options.map(o => o.label).join(' | ')}]`);
  h.do({ type: 'decide', seat: d.seat, choice: i });
}
const labels = (h: Harness): string[] => (h.state.decision?.options ?? []).map(o => o.label);
/** "Done" on the second pick — when there is one (nothing else may fit) */
function noSecondPick(h: Harness): void {
  if (labels(h).includes('Done')) decide(h, l => l === 'Done');
}
/** resolve the stack out, answering anything asked with its first option */
function drain(h: Harness): void {
  for (let k = 0; k < 20 && (h.state.stack.length || h.state.decision); k++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
}

/** D casts Tides in A's attack window with `deck` on top (padded with cards
 * it is never asked to pick); resolves to the first pick */
function tides(seed: number, deck: string[], setup?: (h: Harness, A: Seat, D: Seat) => void): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  giveResources(h, D, 'water', 11);
  setup?.(h, A, D);
  toNextBattle(h, A);
  const fill = Array(Math.max(0, 8 - deck.length)).fill('Good Whale');
  h.state.sharedDeck = [...deck, ...fill, 'Dune Drifter'];
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tides of the Cosmos') });
  pass(h); pass(h);
  return { h, A, D };
}

test('R337: a Virus card played by Tides as a Virus augments a unit and never enters play', () => {
  const { h, A, D } = tides(40401, ['Molten Riftbreaker']);
  const host = unitsOf(h, A).find(u => u.card === 'Curio Drifter')!.id;
  decide(h, l => l.startsWith('Molten Riftbreaker'));
  noSecondPick(h);
  decide(h, l => /as a Virus/.test(l));
  assert.ok(h.state.stack.some(i => i.kind === 'virus' && i.card === 'Molten Riftbreaker'),
    'the Virus is on the stack as an augment');
  drain(h);
  assert.ok(ent(h, host)!.mods.some(id => h.state.entities[id]?.card === 'Molten Riftbreaker'),
    'and it is a mod on the only unit there was to augment');
  assert.ok(!unitsOf(h, D).some(u => u.card === 'Molten Riftbreaker'), 'not a unit in play');
  finishBattle(h);
});

test('R337: an Ambush card played by Tides as an Ambush takes an ally place', () => {
  const { h, D } = tides(40402, ['Mirrorback Ambusher'], (g, _A, d) => { spawn(g, d, 'Curio Drifter'); });
  const ally = unitsOf(h, D).find(u => u.card === 'Curio Drifter')!.id;
  decide(h, l => l.startsWith('Mirrorback Ambusher'));
  noSecondPick(h);
  decide(h, l => /as an Ambush/.test(l));
  assert.ok(h.state.stack.some(i => i.kind === 'ambush'), 'the Ambush is on the stack');
  drain(h);
  assert.equal(h.state.entities[ally], undefined, 'the ally left play');
  assert.ok(h.state.players[D]!.hand.includes('Curio Drifter'), 'back to its owner hand');
  assert.ok(unitsOf(h, D).some(u => u.card === 'Mirrorback Ambusher'), 'and the ambusher stands in its place');
  finishBattle(h);
});

test('R337: a card played by Tides as a Prophecy is cached with its banner, for free, and not binned', () => {
  const { h, D } = tides(40403, ['The Foretold']);
  const mana = h.state.players[D]!.resources.length;
  decide(h, l => l.startsWith('The Foretold'));
  noSecondPick(h);
  decide(h, l => /^Prophesy/.test(l));
  drain(h);
  const cached = (h.state.players[D]!.cache ?? []).find(c => c.card === 'The Foretold');
  assert.ok(cached?.prophecy, 'it sits in the cache with its prophecy');
  assert.ok(!h.state.players[D]!.bin.includes('The Foretold'), 'it was not binned');
  assert.ok(!unitsOf(h, D).some(u => u.card === 'The Foretold'), 'and it is not in play');
  assert.equal(h.state.players[D]!.resources.length, mana, 'nothing was paid for the prophecy');
  finishBattle(h);
});

test('R337: a pick with no alternative mode asks nothing new', () => {
  // the replay guarantee: a Tides pick of a card with no Virus, Ambush or
  // Prophecy line raises exactly the questions it always did
  const { h, D } = tides(40404, ['Curio Drifter']);
  decide(h, l => l.startsWith('Curio Drifter'));
  noSecondPick(h);
  assert.ok(!labels(h).some(l => /^Play |as a Virus|as an Ambush|^Prophesy/.test(l)),
    `no mode question; asked [${labels(h).join(' | ')}]`);
  drain(h);
  assert.ok(unitsOf(h, D).some(u => u.card === 'Curio Drifter'), 'the card is played as before');
  finishBattle(h);
});

test('R338: a Tides play pays its additional cost — the sacrifice happens and Volatile Toxicity resolves', () => {
  const { h, D } = tides(40405, ['Volatile Toxicity'], (g, _A, d) => { spawn(g, d, 'Curio Drifter'); });
  const curio = unitsOf(h, D).find(u => u.card === 'Curio Drifter')!.id;
  decide(h, l => l.startsWith('Volatile Toxicity'));
  noSecondPick(h);
  assert.ok(h.state.decision?.options.some(o => JSON.stringify(o.value) === JSON.stringify({ unit: curio })),
    `the sacrifice is asked; menu [${labels(h).join(' | ')}]`);
  h.do({ type: 'decide', seat: D, choice: h.state.decision!.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify({ unit: curio })) });
  assert.equal(h.state.entities[curio], undefined, 'the cost is paid before the spell is on the stack');
  assert.ok(h.state.stack.some(i => i.card === 'Volatile Toxicity'), 'and the spell is on the stack');
  finishBattle(h);
});

test('R338: with nothing to sacrifice, Tides does not offer Volatile Toxicity', () => {
  const { h } = tides(40406, ['Volatile Toxicity']);
  assert.ok(!labels(h).some(l => l.startsWith('Volatile Toxicity')),
    `an unpayable additional cost keeps the card off the menu; menu [${labels(h).join(' | ')}]`);
});

test('R338: a unit played by Hooba-Pon pays its additional cost — Trench Stalker discards two', () => {
  const h = new Harness(40407);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const pon = spawn(h, A, 'Hooba-Pon');
  giveResources(h, A, 'water', 1);                           // Trench Stalker bd/2
  giveResources(h, A, 'dark', 1);
  toNextBattle(h, A);
  h.state.players[A]!.hand = [];
  give(h, A, 'Trench Stalker');
  give(h, A, 'Dune Drifter');
  give(h, A, 'Curio Drifter');
  h.do({ type: 'declareAttack', seat: A, columns: [[pon]] });
  pass(h); pass(h);                                          // the attack trigger resolves
  decide(h, l => l === 'Trench Stalker');
  const asked: string[] = [];
  for (let k = 0; k < 6 && h.state.decision; k++) {
    asked.push(h.state.decision.prompt);
    h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  }
  assert.ok(asked.some(p => /discard/i.test(p)), `the discard is asked; asked [${asked.join(' | ')}]`);
  assert.deepEqual(h.state.players[A]!.hand, [], 'both other cards were discarded');
  assert.ok(h.state.stack.some(i => i.card === 'Trench Stalker'), 'and Trench Stalker is on the stack');
  finishBattle(h);
});

test('R339: an X card that may not be zero is never a Tides pick; one that may be zero still is', () => {
  const { h } = tides(40408, ['Frosted Denial', 'Wildfire']);
  assert.ok(!labels(h).some(l => l.startsWith('Frosted Denial')), 'Frosted Denial ("X can\'t be zero") is not offered');
  assert.ok(labels(h).some(l => l === 'Wildfire [0]'), 'Wildfire (X may be zero) is, at [0]');
});
