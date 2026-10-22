/* CT-226 — the Electric path belongs to the Electric SOURCE's controller.
 *
 * CR 802.17c: "The Electric source's controller chooses where the excess goes
 * at each jump." dealEffectDamageAll asked the effect's controller instead,
 * which is the same player on every board 05-rulings builds (Arc Lightning is
 * its own source). The two differ when a spell makes another player's unit the
 * source of the damage — a Fight or Battle, where each fighter is the source
 * of what it deals (CR 801.11a). Then the CASTER used to steer the OPPONENT's
 * Electric excess.
 *
 * No printed unit carries {Electric}, so the source is a synthetic unit. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { registerSynthetic } from '../src/cards/dsl.ts';
import { ent, give, giveResources, pick, pass, spawn, toDeployment, toNextBattle } from './util.ts';
import type { Seat } from '../src/types.ts';

registerSynthetic({
  name: 'T552 Volt Brute', cost: '', mana: 0, power: 5, toughness: 9,
  type: 'Test Unit', kind: 'unit', timing: 'deploy', attrs: ['Electric'],
  virus: false, burst: false, augmentAttrs: [], text: '', image: '',
}, {});

/** A attacks with two 1/1s side by side; A casts Fight: its first attacker
 *  fights D's Electric 5/9. The 5 the Brute deals is 1 lethal and 4 excess,
 *  and the attacker beside it is a unit the excess can jump to. */
function fightTheBrute(seed: number): { h: Harness; A: Seat; D: Seat; a0: number; a1: number; volt: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a0 = spawn(h, A, 'Unit Token');
  const a1 = spawn(h, A, 'Unit Token');
  const volt = spawn(h, D, 'T552 Volt Brute');
  giveResources(h, A, 'earth', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0], [a1]] });
  assert.equal(h.state.priority, A, 'setup: the attack window opens on A');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Fight') });
  pick(h, { unit: a0 });
  pick(h, { unit: volt });
  pass(h); pass(h);
  return { h, A, D, a0, a1, volt };
}

test('CR 802.17c / CT-226: a Fight that makes the opponents Electric unit the source asks the SOURCE controller for the path, not the caster', () => {
  const { h, A, D } = fightTheBrute(55201);
  assert.equal(h.state.decision?.kind, 'electricPath', 'the 4 excess has a unit to jump to, so the path is asked');
  assert.notEqual(A, D);
  assert.equal(h.state.decision!.seat, D,
    'the Brute is the source of the damage it deals (CR 801.11a), so its controller chooses, even though A cast the Fight');
});

test('CR 802.17c / CT-226: the source controller answer steers the excess onto the chosen neighbour', () => {
  const { h, D, a0, a1 } = fightTheBrute(55202);
  const toA1 = h.state.decision!.options.findIndex(o => o.value === a1);
  assert.ok(toA1 >= 0, 'the neighbouring attacker is offered');
  h.do({ type: 'decide', seat: D, choice: toA1 });
  assert.ok(!ent(h, a0), 'the fighter died to its lethal share');
  assert.ok(!ent(h, a1), 'the excess jumped to the unit the source controller chose');
});
