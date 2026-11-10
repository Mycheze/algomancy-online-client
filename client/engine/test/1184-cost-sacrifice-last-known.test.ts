/* CR 714.2 / CT-538 (report #344, invi, ZFHC, 2026-11-07): "throwing a deadly
 * throwing bloulder should be a deadly 3 dmg! (it should remember the last state
 * of the card before it left the battlefield)".
 *
 * An effect whose source has left play has the attributes its source had when
 * it left — its column's included (CR 802.1e; RAQ "[Solved] Dead Unit Effect on
 * Stack", _passer: "Bellowing Boulder will remember his last state"). The engine
 * takes that snapshot as the unit leaves and writes it onto every stack item it
 * is the source of. But a COST that removes the source — "Sacrifice me:",
 * "Erase me:", a "sacrifice a unit" atom paid with the source — is paid in the
 * cast window, before the item is on the stack, so the snapshot found nothing to
 * write to and the ability read the bare printed card: Throwing Boulder thrown
 * from a column with Carapace Devourer ({Deadly}) dealt a plain 3.
 * Seeds: 11840-11849.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { ent, finishBattle, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';
import type { Seat } from '../src/types.ts';

const other = (s: Seat): Seat => (1 - s) as Seat;

/** Throwing Boulder attacking in one column with `partner`, its ability
 * activated and aimed at a Good Whale (7/5) — the sacrifice paid, the ability
 * on the stack. */
function throwAtWhale(seed: number, partner: string) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const boulder = spawn(h, A, 'Throwing Boulder');
  spawn(h, A, partner);
  const whale = spawn(h, D, 'Good Whale');                   // 7/5: 3 damage kills it only if Deadly
  toNextBattle(h, A);
  const ids = Object.values(h.state.entities).filter(u => u.controller === A).map(u => u.id);
  h.do({ type: 'declareAttack', seat: A, columns: [[boulder, ...ids.filter(i => i !== boulder)]] });
  h.do({ type: 'activateAbility', seat: A, entityId: boulder, abilityIndex: 0, via: 'augment' });
  pick(h, { unit: whale });
  assert.equal(ent(h, boulder), undefined, 'the Boulder was sacrificed as the cost');
  const item = h.state.stack.find(i => i.card === 'Throwing Boulder');
  assert.ok(item, 'its ability is on the stack');
  return { h, A, D, whale, item };
}

test('CR 714.2 / CT-538: Throwing Boulder sacrificed from a column with a Deadly unit throws a Deadly 3', () => {
  const { h, whale, item } = throwAtWhale(11840, 'Carapace Devourer');
  assert.ok(item.lastKnown?.attrs.includes('Deadly'),
    'the ability remembers the Deadly its column shared with the Boulder as it was sacrificed');
  pass(h); pass(h);
  assert.equal(ent(h, whale), undefined, '3 Deadly damage kills the 7/5');
  finishBattle(h);
});

test('CR 714.2 / CT-538: the control — beside a plain ally the thrown 3 is not Deadly', () => {
  const { h, whale, item } = throwAtWhale(11841, 'Unit Token');
  assert.ok(item.lastKnown, 'the last-known state is still taken');
  assert.ok(!item.lastKnown!.attrs.includes('Deadly'));
  pass(h); pass(h);
  assert.ok(ent(h, whale), 'the 7/5 survives a plain 3');
  assert.equal(ent(h, whale)!.damage, 3);
  finishBattle(h);
});

test('CR 714.2 / CT-538: Skybreaker erased as its own cost — its ability still carries its last-known state', () => {
  const h = new Harness(11842);
  toDeployment(h);
  const A = h.state.initiative;
  const sky = spawn(h, A, 'Skybreaker');
  spawn(h, A, 'Carapace Devourer');
  toNextBattle(h, A);
  const ids = Object.values(h.state.entities).filter(u => u.controller === A).map(u => u.id);
  h.do({ type: 'declareAttack', seat: A, columns: [[sky, ...ids.filter(i => i !== sky)]] });
  h.do({ type: 'activateAbility', seat: A, entityId: sky, abilityIndex: 0, via: 'augment' });
  assert.equal(ent(h, sky), undefined, 'erased as the cost');
  const item = h.state.stack.find(i => i.card === 'Skybreaker');
  assert.ok(item, 'its ability is on the stack');
  assert.equal(item!.lastKnown?.card, 'Skybreaker');
  assert.ok(item!.lastKnown!.attrs.includes('Deadly'), 'with what its column shared, as it left');
  pass(h); pass(h);
  finishBattle(h);
});

test('CR 714.2 / CT-538: Combustible Bogwalker sacrificing itself to its own either/or cost — its ability carries its last-known state', () => {
  // the "sacrifice a nontoken unit or discard a card" atom is answered as a
  // decision, a different payment path from "Sacrifice me:". (Pallid Gorger
  // carried this test until the 2026-11-10 printing gave it "another".)
  const h = new Harness(11843);
  toDeployment(h);
  const A = h.state.initiative;
  const bog = spawn(h, A, 'Combustible Bogwalker');
  spawn(h, A, 'Carapace Devourer');
  h.state.players[A]!.bin.push('Curio Drifter');   // the ability's required target
  toNextBattle(h, A);
  const ids = Object.values(h.state.entities).filter(u => u.controller === A).map(u => u.id);
  h.do({ type: 'declareAttack', seat: A, columns: [[bog, ...ids.filter(i => i !== bog)]] });
  h.do({ type: 'activateAbility', seat: A, entityId: bog, abilityIndex: 0, via: 'augment' });
  pick(h, { bin: { seat: A, card: 'Curio Drifter' } });
  pick(h, { unit: bog });
  assert.equal(ent(h, bog), undefined, 'it paid with itself');
  const item = h.state.stack.find(i => i.card === 'Combustible Bogwalker');
  assert.ok(item, 'its ability is on the stack');
  assert.equal(item!.lastKnown?.card, 'Combustible Bogwalker');
  assert.ok(item!.lastKnown!.attrs.includes('Deadly'), 'with what its column shared, as it left');
  pass(h); pass(h);
  finishBattle(h);
});
