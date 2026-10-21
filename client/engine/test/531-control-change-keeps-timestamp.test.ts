/**
 * 531 — a change of control does not change an effect's timestamp (CR 113.2a).
 *
 * Report #231 (room ZKKX, 2026-10-18), and the answer to it. Transmogrifant
 * ("[Augment] Your other units gain +2/+2 and lose all attributes and
 * abilities.") was on Player B's The Bonesculptor first. Later Pernicious
 * Photosynthesis gave Player A's units Piercing until regroup. Then Rebalance
 * gave Player A the Bonesculptor, so "your other units" became Player A's.
 *
 * _passer, rules-questions, relayed by the owner on 2026-10-21: "We could ask a
 * question "Does Rebalance cause Transmog to refresh his timestamp?" but I think
 * going with MtG rules the answer is "no, it keeps its old timestamp"". So
 * Transmogrifant's strip is still older than the Piercing: Player A's units
 * lose what they PRINT (older than any effect) and keep the Piercing (later).
 *
 * §1 is the reported shape, played with real actions. §2 pins the mechanism:
 * the strip's stamp is the same number before and after the control change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, finishBattle, give, giveResources, ownAttrs, pass, spawn, toDeployment, toNextBattle, withE } from './util.ts';

/** Transmogrifant attached to `seat`'s The Bonesculptor; returns [host, mod] */
function bonesculptorWithTransmogrifant(h: Harness, seat: Seat): [EntityId, EntityId] {
  let host = -1, mod = -1;
  withE(h, e => {
    const u = e.spawnUnit(seat, 'The Bonesculptor', e.homeRegion(seat));
    host = u.id;
    mod = e.attachMod(u, 'Transmogrifant', seat, 'augment').id;
  });
  return [host, mod];
}

test('§1 report #231: Rebalance gives away the host of Transmogrifant; the earlier strip takes the printed attributes and the later Piercing stays', () => {
  const h = new Harness(53101);
  const A = h.state.initiative, B = (1 - A) as Seat;           // A casts Pernicious Photosynthesis, B owns Transmogrifant
  // Transmogrifant is on the board a step BEFORE the deployment the Piercing is
  // cast in, as in the reported game (in one deployment the initiative player's
  // plays would be the older, CR 113.2b — 532)
  const [bones] = bonesculptorWithTransmogrifant(h, B);
  const devourer = spawn(h, B, 'Carapace Devourer');            // {Deadly}
  assert.ok(!ownAttrs(h, devourer).has('Deadly'), 'setup: Transmogrifant strips Player B\'s other units');
  toDeployment(h);
  assert.equal(h.state.deployPlayer, A);

  const bubb = spawn(h, A, 'Bubb');                             // {Unaware}
  const drifter = spawn(h, A, 'Curio Drifter');                 // {Evasive}
  const token = spawn(h, A, 'Unit Token');                      // what Player A gives away
  assert.ok(ownAttrs(h, bubb).has('Unaware') && ownAttrs(h, drifter).has('Evasive'), 'setup: Player A\'s units are not covered yet');

  // later: Pernicious Photosynthesis — Player A's units gain +2/+2 and Piercing until regroup
  giveResources(h, A, 'wood', 4);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Pernicious Photosynthesis') });
  for (const u of [bubb, drifter, token]) assert.ok(ownAttrs(h, u).has('Piercing'), 'setup: the Piercing was granted');

  // next battle: Player B casts Rebalance and gives Player A The Bonesculptor
  giveResources(h, B, 'wood', 2);
  toNextBattle(h, A);
  // all three attack, so they stand in the region The Bonesculptor is in (Transmogrifant is region-scoped, CR 601.1d)
  h.do({ type: 'declareAttack', seat: A, columns: [[token], [bubb], [drifter]] });
  pass(h);                                                      // priority → B
  assert.equal(h.state.priority, B);
  h.do({ type: 'playCard', seat: B, handIndex: give(h, B, 'Rebalance') });
  pass(h); pass(h);                                             // Rebalance resolves
  for (let guard = 0; h.state.decision && guard < 4; guard++) {
    const dec = h.state.decision;
    const want = dec.seat === A ? token : bones;
    const i = dec.options.findIndex(o => JSON.stringify(o.value).includes(String(want)));
    assert.ok(i >= 0, `Rebalance offers ${want} to seat ${dec.seat}`);
    h.do({ type: 'decide', seat: dec.seat, choice: i });
  }
  assert.equal(ent(h, bones)!.controller, A, 'Rebalance gave Player A The Bonesculptor');
  assert.equal(ent(h, token)!.controller, B, 'and Player B the token');
  assert.equal(ent(h, bones)!.region, ent(h, bubb)!.region, 'The Bonesculptor stands in the region with Player A\'s units');

  // Transmogrifant now covers Player A's other units: what they print is gone ...
  assert.ok(!ownAttrs(h, bubb).has('Unaware'), 'Bubb lost its printed Unaware');
  assert.ok(!ownAttrs(h, drifter).has('Evasive'), 'Curio Drifter lost its printed Evasive');
  // ... and the Piercing, granted after Transmogrifant was applied, stays
  assert.ok(ownAttrs(h, bubb).has('Piercing'), 'Bubb keeps the Piercing: Rebalance did not refresh Transmogrifant\'s timestamp');
  assert.ok(ownAttrs(h, drifter).has('Piercing'), 'Curio Drifter keeps the Piercing');
  // Player B's units are out from under it
  assert.ok(ownAttrs(h, devourer).has('Deadly'), 'Carapace Devourer gets its Deadly back');
  finishBattle(h);
});

test('§2 the timestamp of the strip is the same before and after the control change, and older than the later grant', () => {
  const h = new Harness(53102);
  const A = h.state.initiative, B = (1 - A) as Seat;
  const [bones, mod] = bonesculptorWithTransmogrifant(h, B);   // a step before the Piercing, as in §1
  toDeployment(h);
  const drifter = spawn(h, A, 'Curio Drifter');
  const ally = spawn(h, B, 'Curio Drifter');
  giveResources(h, A, 'wood', 4);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Pernicious Photosynthesis') });

  const before = new E(h.state).strippersOf(ent(h, ally)!, 'attrs');
  assert.deepEqual(before, [new E(h.state).stampOf(mod)], 'before: Player B\'s unit carries the strip, stamped when Transmogrifant was applied');
  assert.deepEqual(new E(h.state).strippersOf(ent(h, drifter)!, 'attrs'), [], 'before: Player A\'s unit carries none');

  withE(h, e => { e.giveControl(e.s.entities[bones]!, A); });
  assert.equal(ent(h, bones)!.controller, A);
  const after = new E(h.state).strippersOf(ent(h, drifter)!, 'attrs');
  assert.deepEqual(after, before, 'the control change did not restamp the strip');
  const grant = ent(h, drifter)!.tempAttrsAt?.[ent(h, drifter)!.tempAttrs!.indexOf('Piercing')];
  assert.ok(grant && E.older(after[0]!, grant), 'the strip is older than the Piercing grant');
  assert.ok(ownAttrs(h, drifter).has('Piercing') && !ownAttrs(h, drifter).has('Evasive'));
});
