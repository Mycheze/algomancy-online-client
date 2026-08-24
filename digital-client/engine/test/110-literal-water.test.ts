/* Literal-reading regressions for the water / attribute batches.
 *
 * The hunt these come from: an implementation that is NARROWER than the words
 * printed on the card. The narrowing pinned here is the kind filter on
 * "play a unit from your hand" — the code read "unit" as `kind === 'unit'` and
 * silently dropped SPELL UNITS, which are units.
 *
 * The designer was asked this about Hooba-Pon BY NAME, RAQ "[Solved] Spell
 * Units played when you can 'play a unit from hand'":
 *   Q: "If you decide to use Hooba-Pon Effect to play Spell-Unit, does that
 *       units 'spell' part happens?"
 *   A: "Yes, the spell part happens and if it resolves, the unit will spawn
 *       into formation"
 *   Q: "Does that count as 'playing a spell' for some triggers?"  A: "Yes."
 * (Recorded in docs/digital-rules.md, and already honoured by Dispatch Courier
 * and Writhing Host, which both read `kind === 'unit' || kind === 'spellUnit'`.)
 *
 * Seeds 11000-11099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import {
  ent, finishBattle, give, giveResources, offered, pass, pick, spawn, toDeployment,
  toNextBattle, unitsOf,
} from './util.ts';

// ── Hooba-Pon: "play a UNIT from your hand" reaches a spell unit ──────────

test('Hooba-Pon: a SPELL UNIT is a unit — it is offered, its spell part happens, its body takes the slot', () => {
  const h = new Harness(11001);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const hooba = spawn(h, A, 'Hooba-Pon');
  giveResources(h, A, 'water', 7);                     // Spawntender: bbb/7
  toNextBattle(h, A);
  h.state.players[A]!.hand = ['Spawntender'];          // {Battle} Alien SPELL Unit, 2/2
  h.do({ type: 'declareAttack', seat: A, columns: [[hooba]] });
  pass(h); pass(h);                                    // resolve the attack trigger

  // 1. it is on the menu at all (the narrowing made this list empty)
  assert.ok(offered(h).includes('0'),
    `the spell unit in hand is offered as "a unit"; menu was [${offered(h)}]`);
  pick(h, 0);

  // 2. "the spell part happens" — Spawntender's spell half makes an 8/8
  const eights = unitsOf(h, A).filter(u => u.card === 'Unit Token' && u.tokenStats?.[0] === 8);
  assert.equal(eights.length, 1, "the spell unit's SPELL part resolved (8/8 token)");

  // 3. "…and if it resolves, the unit will spawn into formation"
  pick(h, 1);                                          // R75: the open back slot
  const col = h.state.battle!.columns[0]!;
  assert.equal(col.length, 2, 'the body joined my formation');
  assert.equal(ent(h, col[1]!)!.card, 'Spawntender', 'and it is the spell unit body');
  assert.equal(h.state.players[A]!.resources.filter(r => r.state === 'open').length, 0,
    'the cost was still paid');
  finishBattle(h);
});

// ── Insidious Invitation: the same noun, the same reading ────────────────

test('Insidious Invitation: "play a unit from hand" lets each player play a SPELL UNIT', () => {
  const h = new Harness(11002);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const tok = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'water', 8);                     // Invitation b/1 + Spawntender bbb/7
  giveResources(h, D, 'water', 3);                     // Oracle of Foretelling: b/3
  toNextBattle(h, A);
  h.state.players[A]!.hand = ['Insidious Invitation', 'Spawntender'];
  h.state.players[D]!.hand = ['Oracle of Foretelling'];   // Polyform Oracle SPELL Unit
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: 0 });
  pass(h); pass(h);                                    // resolve: draw, then the invitations

  assert.equal(h.state.decision!.seat, A, 'the caster is invited first');
  const mine = h.state.players[A]!.hand.indexOf('Spawntender');
  assert.ok(offered(h).includes(String(mine)), 'A is offered their spell unit');
  pick(h, mine);
  assert.ok(unitsOf(h, A).some(u => u.card === 'Spawntender'), "A's spell-unit body arrived");
  assert.ok(unitsOf(h, A).some(u => u.card === 'Unit Token' && u.tokenStats?.[0] === 8),
    "…and its spell part resolved (the 8/8)");

  assert.equal(h.state.decision!.seat, D, 'then the opponent');
  const theirs = h.state.players[D]!.hand.indexOf('Oracle of Foretelling');
  assert.ok(offered(h).includes(String(theirs)), 'D is offered theirs too');
  pick(h, -1);                                         // D declines — the offer is the point
  finishBattle(h);
});

// ── the plain-unit path is untouched ─────────────────────────────────────

test('Hooba-Pon: a plain unit still plays into the formation exactly as before', () => {
  const h = new Harness(11003);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const hooba = spawn(h, A, 'Hooba-Pon');
  giveResources(h, A, 'water', 2);
  give(h, A, 'Hooba-Pon');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[hooba]] });
  pass(h); pass(h);
  pick(h, h.state.players[A]!.hand.indexOf('Hooba-Pon'));
  pick(h, 1);
  const col = h.state.battle!.columns[0]!;
  assert.equal(col.length, 2);
  assert.equal(ent(h, col[1]!)!.card, 'Hooba-Pon');
  finishBattle(h);
});
