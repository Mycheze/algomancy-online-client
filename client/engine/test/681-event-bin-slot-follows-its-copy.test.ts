/**
 * CR 405.6b / CT-415 — the bin copy an EVENT names follows that copy, as a
 * declared bin target does (CT-380, test 663).
 *
 * A 'died' or 'trashed' event stamps (seat, card, binNth): which copy of its
 * name in that bin the event's card is. `eventBinSlot` resolves that pair
 * against the live bin when the responder resolves (Biomass Devourer, Cthyrian
 * Rector, Murkdrop Distiller). CT-380 taught `E.removeFromBin` to re-index the
 * live BinRefs as a copy leaves, but not the `binNth` stamped on the events of
 * waiting triggers: when an EARLIER copy of the same name left first, the stamp
 * pointed one past the copy, and the responder found nothing though its card
 * was still in the bin (or, with three copies, found a different one).
 *
 * Seeds: 68100-68149.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { BinRef, EntityId, Seat } from '../src/types.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, withE } from './util.ts';

const X = 'Just a Unit';

/** A attacks with Biomass Devourer; A bin = [X]; A's X in play dies, so the
 * Devourer's trigger waits on the stack with the death's copy = copy 2 of X. */
function setup(seed: number): { h: Harness; A: Seat; D: Seat; x: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const dev = spawn(h, A, 'Biomass Devourer');
  const x = spawn(h, A, X);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dev], [x]] });
  for (const s of [A, D]) {
    h.state.players[s]!.hand = h.state.players[s]!.hand.filter(c => c !== X);
    h.state.players[s]!.bin.length = 0;
    delete h.state.players[s]!.foreign;
  }
  h.state.players[A]!.bin.push(X);
  giveResources(h, A, 'dark', 4);
  giveResources(h, D, 'dark', 2);
  withE(h, g => g.destroy(g.entity(x)!, 'dies'));
  return { h, A, D, x };
}

const devourerItem = (h: Harness) => h.state.stack.find(it => it.card === 'Biomass Devourer');

test('CR 405.6b / CT-415: an earlier copy taken from the bin in response leaves the death copy findable, and Biomass Devourer still offers to erase it', () => {
  const { h, A, D } = setup(68100);
  assert.deepEqual(h.state.players[A]!.bin, [X, X], 'the dead copy is copy 2 of X in A bin');
  assert.ok(devourerItem(h), 'the Devourer trigger waits on the stack');
  // D answers with Collect Remains on copy 1, the copy the death did NOT make
  pass(h);                                           // A passes with the trigger on the stack
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Collect Remains') });
  pick(h, { bin: { seat: A, card: X } as BinRef });
  pass(h); pass(h);                                  // Collect Remains resolves
  assert.deepEqual(h.state.players[A]!.bin, [X], 'copy 1 left; the death copy is still there');
  let guard = 10;
  while (devourerItem(h) && !h.state.decision && guard-- > 0) pass(h);
  const dec = h.state.decision;
  assert.ok(dec && /Biomass Devourer: pay \[two\] to erase/.test(dec.prompt ?? ''),
    'the Devourer finds its copy and asks for the [two] (it used to say the card was no longer in the bin)');
  h.do({ type: 'decide', seat: dec!.seat, choice: dec!.options.findIndex(o => o.value === 1) });
  assert.deepEqual(h.state.players[A]!.bin, [], 'and erases it');
});

test('CR 405.6b / CT-415: the death copy itself taken in response is gone, and the Devourer erases nothing', () => {
  const { h, A, D } = setup(68101);
  pass(h);                                           // A passes with the trigger on the stack
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Collect Remains') });
  pick(h, { bin: { seat: A, card: X, nth: 1 } as BinRef });
  pass(h); pass(h);
  assert.deepEqual(h.state.players[A]!.bin, [X], 'the death copy left; copy 1 stays');
  let guard = 10;
  while (devourerItem(h) && !h.state.decision && guard-- > 0) pass(h);
  assert.ok(!h.state.decision, 'no offer: its copy is gone');
  assert.deepEqual(h.state.players[A]!.bin, [X], 'and the innocent copy 1 is never erased');
});

test('CR 405.6b / CT-415: the re-indexed stamp is the one the trigger holds -- a direct read through eventBinSlot', async () => {
  const { h, A } = setup(68102);
  const { eventBinSlot } = await import('../src/cards/dsl.ts');
  withE(h, g => { g.removeFromBin(A, 0, 'recalled'); });
  const g = new E(h.state);
  const slot = eventBinSlot(g, devourerItem(h)!.event);
  assert.deepEqual(slot, { seat: A, card: X, index: 0 }, 'the event names the copy now at index 0');
});
