/**
 * CR 708.4, the replacement CHAIN, for damage and for the hooks whose
 * substitute is a different kind of event.
 *
 * The owner, 2026-10-16, on two Oorblaks ("[Augment] If combat damage would be
 * dealt to you, that damage is dealt to me instead"): "if you have two
 * Oorblaks, then take damage, only ONE of them will actually get damaged. The
 * other receives 0 damage." — each effect applies once, and only if the event
 * as the earlier effects left it still matches its own condition: once Oorblak
 * A has the damage it is no longer dealt to "you", so B has nothing to take.
 * And on the {Piercing} excess an Oorblak lets through: "it's all combat
 * damage, and that damage is still considered combat damage, so it'd go to
 * the second one". Caleb Gannon, rules-questions 2025-11-25: "the tldr is
 * replacement effects only apply once onto an effect".
 *
 * The engine already chained these (`E.replaceCombatDamage` offers each
 * holder what the ones before it let through, and stops when nothing is left),
 * so these are guards, not fixes. RED-CHECK: offer each holder the ORIGINAL
 * `amount` instead of `left` and the two-and-three Oorblak Piercing tests
 * fail; drop the `left <= 0` stop as well and the first test fails too (the
 * second Oorblak takes 3 as well — [3, 3]); drop the `return true` after a rot
 * replacement and the Skittering Blight test fails.
 *
 * The rot, life-gain and card-step hooks are "first true consumes", and that
 * IS the chain: what each puts in the event's place (counters, a loss, a
 * draw) is no longer the event any other holder's condition names.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, pass, spawn, toDeployment, toNextBattle, withE as whiteBox } from './util.ts';

function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  return u.id;
}

/** A attacks unblocked with a p/p token, D holds `n` Oorblaks; stops right after combat damage */
function oorblaks(seed: number, n: number, power: number, piercing: boolean) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, power, 10);
  const oo = Array.from({ length: n }, () => spawn(h, D, 'Oorblak'));   // 2/4 each
  const life = h.state.players[D]!.life;
  toNextBattle(h, A);
  if (piercing) { const g = new E(h.state); g.addTempAttr(g.entity(atk)!, 'Piercing'); }
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                  // combat damage
  // CR 708.4a: with two or more Oorblaks the defender is now ASKED which takes
  // the damage first (471). Answering with the first choice each time is the
  // timestamp order, which is the chain these tests pin.
  while (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  return {
    lost: life - h.state.players[D]!.life,
    damage: oo.map(id => ent(h, id)?.damage ?? 'dead'),
  };
}

test('CR 708.4: two Oorblaks and combat damage to you — one takes all of it, the other takes 0', () => {
  const r = oorblaks(46901, 2, 3, false);
  assert.equal(r.lost, 0, 'none of it reached the player');
  assert.deepEqual(r.damage, [3, 0],
    'owner 2026-10-16: "only ONE of them will actually get damaged. The other receives 0 damage."');
});

test('CR 708.4: two Oorblaks and 10 Piercing — 4 destroy the first, the 6 left are still combat damage and the second takes them, 2 reach you', () => {
  const r = oorblaks(46902, 2, 10, true);
  assert.deepEqual(r.damage, ['dead', 'dead'], 'each Oorblak took its 4 and died');
  assert.equal(r.lost, 2,
    'owner 2026-10-16: "it\'s all combat damage, and that damage is still considered combat damage, so it\'d go to the second one"');
});

test('CR 708.4: three Oorblaks and 10 Piercing — 4, 4, and the third takes the last 2', () => {
  const r = oorblaks(46903, 3, 10, true);
  assert.deepEqual(r.damage, ['dead', 'dead', 2], 'each Oorblak applied once, to what the ones before it let through');
  assert.equal(r.lost, 0, 'nothing reached the player');
});

test('CR 708.4: one Oorblak and 10 Piercing — 4 destroy it and the other 6 reach the player', () => {
  // the RAQ case, unchanged by the chain: with no second Oorblak, nothing is
  // left to take the excess.
  const r = oorblaks(46904, 1, 10, true);
  assert.deepEqual(r.damage, ['dead']);
  assert.equal(r.lost, 6);
});

test('CR 708.4: two Skittering Blights — rot damage becomes counters on ONE of them, because counters are not rot damage', () => {
  const h = new Harness(46905);
  toDeployment(h);
  const P = h.state.deployPlayer! as Seat;
  const b1 = spawn(h, P, 'Skittering Blight');
  const b2 = spawn(h, P, 'Skittering Blight');
  const life = h.state.players[P]!.life;
  whiteBox(h, e => { e.gainRot(P, 3 - e.rot(P)); e.rotDamage(); });
  // CR 708.4a: the player is now asked which Blight replaces it (472); the
  // first choice is the timestamp order this test pins
  assert.equal(h.state.decision?.seat, P, 'the player is asked which one');
  h.do({ type: 'decide', seat: P, choice: 0 });
  assert.equal(h.state.players[P]!.life, life, 'the rot dealt no damage');
  assert.deepEqual([ent(h, b1)!.counters, ent(h, b2)!.counters], [3, 0],
    'the first replaced it with 3 counters; the second "if rot would deal damage to you" has no rot damage left to match');
});
