/**
 * CR 110.12 / CT-239 — Gatekeeper of Souls compels only DURING BATTLE.
 *
 * Printed: "[Augment] When a player selects targets for an effect during
 * battle, I must be targeted if able." `mustBeTargetedIn` gathered the holders
 * by region alone and never asked whether a battle was on, so in deployment a
 * player whose own Gatekeeper stood in their home region could aim Overbloom
 * only at the Gatekeeper. Deployment happens in the home region too, so region
 * scope is not what "during battle" amounts to: the battle has to be on, and in
 * that region.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { ent, finishBattle, give, giveResources, offered, pick, spawn, toDeployment, toNextBattle } from './util.ts';
import type { Seat } from '../src/types.ts';

test('CR 110.12 / CT-239: in deployment a Gatekeeper of Souls compels nothing', () => {
  const h = new Harness(5440);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const gk = spawn(h, p, 'Gatekeeper of Souls');
  const tok = spawn(h, p, 'Unit Token');
  assert.equal(new E(h.state).mustBeTargetedIn(ent(h, gk)!.region).size, 0,
    'no battle is on, so nothing must be targeted');
  giveResources(h, p, 'wood', 2);                              // Overbloom g/2
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Overbloom') });
  const menu = offered(h);
  assert.ok(menu.includes(JSON.stringify({ unit: tok })),
    'the other unit is on the menu: the Gatekeeper does not narrow a deployment play');
  assert.ok(menu.includes(JSON.stringify({ unit: gk })), 'and the Gatekeeper is still a legal target');
  pick(h, { unit: tok });
  assert.equal(ent(h, tok)!.tempPower ?? 0, 7, 'the 1/1 got the +7/+7');
});

test('CR 110.12 / CT-239: during battle a Gatekeeper outside the battle region compels nothing', () => {
  const h = new Harness(5441);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const homeGk = spawn(h, A, 'Gatekeeper of Souls');         // stays home, out of the battle
  const fieldGk = spawn(h, D, 'Gatekeeper of Souls');        // stands in the battle region
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const g = new E(h.state);
  const battleRegion = h.state.battle!.region;
  assert.notEqual(ent(h, homeGk)!.region, battleRegion);
  assert.equal(g.mustBeTargetedIn(ent(h, homeGk)!.region).size, 0,
    'the battle is in another region, so the home Gatekeeper compels nothing');
  assert.ok(g.mustBeTargetedIn(battleRegion).has(fieldGk),
    'the Gatekeeper standing in the battle still must be targeted');
  finishBattle(h);
});
