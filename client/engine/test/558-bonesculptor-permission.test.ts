/* CT-255 — THE BONESCULPTOR GRANTS A PERMISSION; IT HAS NO ABILITY TO ACTIVATE.
 *
 * "You may play one unit with no abilities from your bin each deployment."
 *
 * CR 707.10: a permission a card grants is a standing fact, not an ability that
 * goes on the stack. Using it cannot be responded to, and an effect that
 * negates activated or triggered abilities cannot stop it.
 *
 * It used to be built as a free bounded ACTIVATED ability (offered as
 * `activateAbility`), whose resolution asked which unit — so the permission
 * itself was an item on the stack, an activated ability for everything that
 * reads one. It is a `playPermissions` grant now: each eligible unit in the
 * bin is an ordinary `playFromBin` action in deployment, bounded once per
 * deployment per Bonesculptor.
 *
 * Seeds 55800-55849.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import type { Action, Seat } from '../src/types.ts';
import { getCard } from '../src/cards/dsl.ts';
import { giveResources, spawn, toDeployment, unitsOf } from './util.ts';

const binPlays = (h: Harness, seat: Seat): Extract<Action, { type: 'playFromBin' }>[] =>
  legalActions(h.state, seat).filter((a): a is Extract<Action, { type: 'playFromBin' }> => a.type === 'playFromBin');

function setup(seed: number, bonesculptors = 1) {
  const h = new Harness(seed);
  toDeployment(h);
  const p = h.state.deployPlayer! as Seat;
  const bones: number[] = [];
  for (let i = 0; i < bonesculptors; i++) bones.push(spawn(h, p, 'The Bonesculptor'));
  // an eligible vanilla (Curio Drifter: {Evasive} is an attribute), a unit WITH
  // abilities, and a spell
  h.state.players[p]!.bin.push('Curio Drifter', 'Ignis Sprite', 'Channeled Boon', 'Curio Drifter');
  giveResources(h, p, 'water', 2);                       // Curio Drifter: b/1, twice
  giveResources(h, p, 'fire', 2);                        // Ignis Sprite affordable — still excluded
  return { h, p, bones };
}

test('CR 707.10 / CT-255: The Bonesculptor has no activated ability, and its permission is a play from the bin', () => {
  assert.equal((getCard('The Bonesculptor').abilities ?? []).filter(a => a.type === 'activated').length, 0,
    'the permission is not an ability: nothing to activate');
  const { h, p, bones } = setup(55800);
  assert.ok(!legalActions(h.state, p).some(a => a.type === 'activateAbility' && a.entityId === bones[0]),
    'no activateAbility is offered for it');
  const offered = binPlays(h, p).map(a => h.state.players[p]!.bin[a.binIndex]);
  assert.ok(offered.includes('Curio Drifter'), 'the ability-free unit is offered as a playFromBin');
  assert.ok(!offered.includes('Ignis Sprite'), 'a unit with abilities is not');
  assert.ok(!offered.includes('Channeled Boon'), 'nor is a spell');
});

test('CR 707.10 / CT-255: using the permission puts no ability on the stack, and the unit is played', () => {
  const { h, p } = setup(55801);
  const mark = h.events.length;
  const play = binPlays(h, p).find(a => h.state.players[p]!.bin[a.binIndex] === 'Curio Drifter');
  assert.ok(play, 'the play is offered');
  h.do(play);
  assert.equal(h.state.decision, null, 'no question is asked — choosing the card IS the action');
  const evs = h.events.slice(mark);
  assert.ok(!evs.some(e => (e.type === 'resolved' || e.type === 'stackPushed') && /Bonesculptor/.test(e.msg)),
    'no Bonesculptor item ever resolved: nothing there for Containment Protocol to negate');
  assert.ok(unitsOf(h, p).some(u => u.card === 'Curio Drifter'), 'the unit is in play');
  const played = evs.find(e => e.type === 'cardPlayed' && e.data?.['card'] === 'Curio Drifter');
  assert.ok(played, 'it was PLAYED (CR 301.9) — the wide play event fired');
  assert.equal(played.data?.['from'], 'bin', 'from the bin (CR 410.6)');
  assert.ok(h.state.players[p]!.resources.some(r => r.kind === 'water' && r.state === 'expended'),
    'and its cost was paid');
});

test('CR 707.10 / CT-255: one play each deployment for each Bonesculptor', () => {
  const one = setup(55802);
  one.h.do(binPlays(one.h, one.p)[0]!);
  assert.deepEqual(binPlays(one.h, one.p), [], 'one Bonesculptor: the second Drifter is not offered');
  const two = setup(55803, 2);
  two.h.do(binPlays(two.h, two.p)[0]!);
  assert.equal(binPlays(two.h, two.p).length, 1, 'two Bonesculptors: a second play is offered');
  two.h.do(binPlays(two.h, two.p)[0]!);
  assert.deepEqual(binPlays(two.h, two.p), [], 'and then none');
  assert.equal(unitsOf(two.h, two.p).filter(u => u.card === 'Curio Drifter').length, 2, 'both arrived');
});

test('CR 707.10 / CT-255: the permission belongs to the controller and to deployment only', () => {
  const { h, p } = setup(55804);
  const o = (1 - p) as Seat;
  h.state.players[o]!.bin.push('Curio Drifter');
  giveResources(h, o, 'water', 1);
  assert.deepEqual(binPlays(h, o), [], 'the other seat is granted nothing by my Bonesculptor');
  h.do({ type: 'doneDeploying', seat: p });
  assert.deepEqual(binPlays(h, p), [], 'and once I am done deploying it offers nothing');
});
