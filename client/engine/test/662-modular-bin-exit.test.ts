/**
 * CR 405.7 / CT-366 — A {MODULAR} MOD PAID OUT OF THE BIN LEAVES THE BIN.
 *
 * CR 405.7: "A card leaves a bin whenever an effect takes it out, for any
 * reason: recalled, played, cached, erased, recycled, prophesied, or applied
 * as a mod. A 'when I leave your bin' ability triggers on every such
 * departure." `E.payModularMod` took a bin mod out with a raw splice, so the
 * 'leftBin' event never fired and Rotling ("When I leave your bin, [Switch1]
 * You may pay [1] to draw a card and gain 1 rot.") paid as a cost of
 * Spellbind ({Modular}) never heard its own exit. It now goes through
 * `E.takeFromBin`, the bin exit every other path uses.
 *
 * Seeds: 66200-66249.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import { finishBattle, give, giveResources, pass, spawn, toDeployment, toNextBattle } from './util.ts';

/** A battle window with A holding priority, an empty hand and an empty bin */
function battle(seed: number): { h: Harness; A: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.state.players[A]!.hand.length = 0;
  h.state.players[A]!.bin.length = 0;
  return { h, A };
}

function applyFromBin(h: Harness, seat: Seat, card: string): void {
  const dec = h.state.decision;
  assert.ok(dec, 'the {Modular} window asks');
  const i = dec!.options.findIndex(o => o.card === card && o.label.endsWith('(bin)'));
  assert.ok(i >= 0, `${card} is offered out of the bin`);
  h.do({ type: 'decide', seat, choice: i });
  const stop = h.state.decision?.options.findIndex(o => o.label === 'No more mods') ?? -1;
  if (stop >= 0) h.do({ type: 'decide', seat, choice: stop });
}

test('CR 405.7 / CT-366: a Rotling paid as a Modular cost out of the bin fires leftBin with reason modded', () => {
  const { h, A } = battle(66201);
  h.state.players[A]!.bin.push('Rotling');
  giveResources(h, A, 'dark', 3);
  const before = h.events.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  applyFromBin(h, A, 'Rotling');
  const left = h.events.slice(before).filter(e => e.type === 'leftBin');
  assert.deepEqual(left.map(e => [e.data!['card'], e.data!['reason']]), [['Rotling', 'modded']],
    'the bin exit is announced once, as a mod');
  assert.ok(!h.state.players[A]!.bin.includes('Rotling'), 'and the card really left the bin');
});

test('CR 405.7 / CT-366: Rotling hears its own exit as a Modular cost and offers the pay [1]', () => {
  const { h, A } = battle(66202);
  h.state.players[A]!.bin.push('Rotling');
  giveResources(h, A, 'dark', 3);                       // Spellbind 1, Rotling 1, the trigger 1
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  applyFromBin(h, A, 'Rotling');
  assert.deepEqual(h.state.stack.map(i => i.label),
    ['Spellbind + Rotling', 'Rotling: you may pay [1] to draw a card and gain 1 rot'],
    'the bin trigger is on the stack above the spell it was paid into');
  const hand = h.state.players[A]!.hand.length;
  const rot = h.state.players[A]!.rot ?? 0;
  pass(h); pass(h);                                     // the trigger resolves
  const dec = h.state.decision;
  assert.equal(dec?.kind, 'payOrDecline', 'it offers the [1]');
  h.do({ type: 'decide', seat: A, choice: dec!.options.findIndex(o => o.value === true) });
  assert.equal(h.state.players[A]!.hand.length, hand + 1, 'a card is drawn');
  assert.equal(h.state.players[A]!.rot ?? 0, rot + 1, 'and a rot gained');
  finishBattle(h);
});
