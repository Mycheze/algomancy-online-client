/**
 * Comprehensive rules — CR example tests for the rules drafted for the live
 * rulings no CR rule cited (the 2026-10-11 coverage round, before the R-ruling
 * register is retired).
 *
 * Each test title starts with `cr:<key>`, and the test backs the rule whose key
 * it names: the rule record in data/comprehensive-rules/rules/<unit>.json lists
 * this file in its sources.tests, and an example may be bound to the test by its
 * title.
 *
 * If one of these fails, either the engine changed or the rule is wrong.
 * Do not just edit the assertion: find out which, fix the rule text (or file
 * the engine divergence), and regenerate the comprehensive-rules document.
 *
 * Seeds 44000-44099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { DecisionOption, Seat } from '../src/types.ts';
import { ent, pass, spawn, toDeployment, toNextBattle, withE } from './util.ts';

/** the index in the event stream of the first `type` event naming `card` */
const firstAt = (h: Harness, type: string, card: string): number =>
  h.events.findIndex(ev => ev.type === type && ev.data?.['card'] === card);

/** drive everything pending to a standstill (first option, or `choose`) */
function resolveAll(h: Harness, choose: (o: DecisionOption) => boolean = () => true): void {
  for (let guard = 120; guard > 0; guard--) {
    const dec = h.state.decision;
    if (dec) {
      if (dec.pickOrder) { h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) }); continue; }
      const i = dec.options.findIndex(choose);
      h.do({ type: 'decide', seat: dec.seat, choice: i === -1 ? 0 : i });
      continue;
    }
    if (h.state.phase === 'battle' && h.state.stack.length) { pass(h); continue; }
    return;
  }
  throw new Error('resolveAll did not terminate');
}

test('cr:zones.changes.leave-play-order — a unit that dies dies first, and is trashed after', () => {
  const h = new Harness(44000);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const u = spawn(h, A, 'Rune Channeler');
  const from = h.events.length;
  withE(h, e => { e.destroy(e.entity(u)!, 'dies'); });
  resolveAll(h);

  assert.equal(ent(h, u), undefined, 'the unit left play');
  assert.ok(h.state.players[A]!.bin.includes('Rune Channeler'), 'and went to its controller’s bin');
  const died = firstAt(h, 'died', 'Rune Channeler');
  const trashed = firstAt(h, 'trashed', 'Rune Channeler');
  assert.ok(died >= from, 'it died');
  assert.ok(trashed >= from, 'it was trashed');
  assert.ok(died < trashed, `its death (event ${died}) comes before its trash (event ${trashed})`);
});

test('cr:zones.changes.leave-play-order — a unit exchanged out of play despawns first, and is trashed after', () => {
  const h = new Harness(44001);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat;
  // Hooba-Mon's own text-box [Augment] exchanges it for a unit card in A's bin
  const hooba = spawn(h, A, 'Hooba-Mon');
  h.state.players[A]!.bin.push('Skittering Blight');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[hooba]] });
  const dec = h.state.decision!;
  const pick = dec.options.findIndex(o =>
    JSON.stringify(o.value) === JSON.stringify({ bin: { seat: A, card: 'Skittering Blight' } }));
  assert.ok(pick >= 0, 'Hooba-Mon offers the bin card');
  h.do({ type: 'decide', seat: dec.seat, choice: pick });
  resolveAll(h);

  assert.equal(ent(h, hooba), undefined, 'Hooba-Mon left play');
  const despawned = firstAt(h, 'despawned', 'Hooba-Mon');
  const trashed = firstAt(h, 'trashed', 'Hooba-Mon');
  assert.ok(despawned >= 0 && trashed >= 0, 'it despawned and was trashed');
  assert.equal(firstAt(h, 'died', 'Hooba-Mon'), -1, 'an exchange is not a death');
  assert.ok(despawned < trashed, `its despawn (event ${despawned}) comes before its trash (event ${trashed})`);
});
