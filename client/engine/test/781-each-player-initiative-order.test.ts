/* 781 — WHEN ONE EFFECT ASKS EACH PLAYER, THE INITIATIVE PLAYER CHOOSES FIRST,
 * AND THE NEXT CHOOSER IS TOLD WHAT WAS CHOSEN IF IT WAS OPEN INFORMATION.
 *
 * Report #317 (EMNR) asked whether the second chooser should see the first
 * pick. The rules channel's answer, relayed by the owner on 2026-11-01:
 *
 *   "It depends on the zone. Hidden information stays hidden (all you know is
 *    that your opponent made a choice), but open information is known by both
 *    players for the choice. It's just like magic: [MTG CR 101.4] (and active
 *    player = INT in Algomancy)."
 *
 * CR 102.3a (the order) and CR 102.3b (what the later chooser knows). The
 * whole-pool halves are 65-effect-conformance §4 (every effect that asks more
 * than one player asks the initiative player first, and declares open/hidden
 * on every question); the wire is server/test/779. This file pins the engine
 * on real games, through the real action path.
 *
 * Seeds 78100-78199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { ent, give, pass, spawn, toDeployment, toNextBattle } from './util.ts';
import type { Seat } from '../src/types.ts';

const ANVIL = 'Triskaidekaphage';        // 0/13, no static, no spawn trigger

/** General Smof attacks in round 1 (attacker = initiative player), so the
 * battle is in the OTHER player's region and that region's raw presentSeats
 * lists its owner — the player WITHOUT initiative — first. */
function smofBattle(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const general = spawn(h, A, 'General Smof');
  const fodder = spawn(h, A, 'Conduit of Pain');
  spawn(h, D, 'Good Whale'); spawn(h, D, ANVIL);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[general], [fodder]] });
  pass(h); pass(h);                                  // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                  // combat, afterCombat trigger pushed
  pass(h); pass(h);                                  // resolve the trigger
  return { h, A, D };
}

test('CR 102.3a: General Smof asks the initiative player first, not the owner of the battle region', () => {
  const { h, A, D } = smofBattle(78101);
  assert.equal(h.state.initiative, A);
  const region = h.state.battle!.region;
  assert.equal(h.state.regions[region]!.presentSeats[0], D,
    "the fixture is the one that tells the orders apart: the region's raw order puts the other player first");
  const dec = h.state.decision!;
  assert.ok(dec, 'Smof asks');
  assert.equal(dec.seat, A, 'the initiative player is asked first');
  assert.equal(dec.earlier, undefined, 'nothing has been chosen yet');
  h.do({ type: 'decide', seat: A, choice: 0 });
  assert.equal(h.state.decision?.seat, D, 'then the player without initiative');
});

test('CR 102.3b: the second sacrificer is told which unit the first chose (a unit in play is open)', () => {
  const { h, A, D } = smofBattle(78102);
  const first = h.state.decision!;
  const pickedOpt = first.options[1]!;
  h.do({ type: 'decide', seat: A, choice: 1 });
  const second = h.state.decision!;
  assert.equal(second.seat, D);
  assert.deepEqual(second.earlier, [
    { seat: A, open: true, option: { label: pickedOpt.label, value: pickedOpt.value }, kind: first.kind },
  ]);
  // nothing has happened yet: the pick is still standing on the board
  assert.ok(ent(h, pickedOpt.value as never), 'the first pick is not sacrificed before the second is made');
  h.do({ type: 'decide', seat: D, choice: 0 });
  assert.equal(ent(h, pickedOpt.value as never), undefined, 'both picks then die together');
});

/** Cthyrian Culler's augment text, live on the unit: "After combat, each
 * player discards a card." A card in hand is HIDDEN information. */
function cullerBattle(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const culler = spawn(h, A, 'Cthyrian Culler');
  spawn(h, D, ANVIL);
  toNextBattle(h, A);
  for (const s of [A, D]) {
    h.state.players[s]!.hand = [];
    give(h, s, 'Immolate'); give(h, s, 'Tidal Menace'); give(h, s, 'Bubb');
  }
  h.do({ type: 'declareAttack', seat: A, columns: [[culler]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  for (let guard = 0; guard < 12 && !h.state.decision; guard++) pass(h);
  return { h, A, D };
}

test('CR 102.3b: the second discarder is told only THAT the first chose (a card in hand is hidden)', () => {
  const { h, A, D } = cullerBattle(78103);
  const first = h.state.decision!;
  assert.ok(first, 'the Culler asks');
  assert.equal(first.seat, A, 'CR 102.3a: the initiative player first');
  assert.match(first.prompt, /Cthyrian Culler/);
  h.do({ type: 'decide', seat: A, choice: 2 });
  const second = h.state.decision!;
  assert.equal(second.seat, D);
  assert.deepEqual(second.earlier, [{ seat: A, open: false }],
    'a hidden pick carries who chose and nothing else — not even into the engine state');
  assert.ok(!JSON.stringify(second.earlier).includes('Bubb'));
});
