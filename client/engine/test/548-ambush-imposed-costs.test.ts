/**
 * CR 111.10e — AN AMBUSH IS A CARD PLAYED, SO IT PAYS THE IMPOSED PLAY COSTS.
 *
 * CT-243, ruled by the owner 2026-10-22: an Ambush DOES pay an imposed
 * "cards played" cost. Arbiter of Armistice prints "Cards played during battle
 * gain [Pay 2 life]" and Vengeance prints "Cards your opponents play during
 * battle gain [Sacrifice a unit]"; CR 111.10e counts an Ambush as a card being
 * played. `doAmbush` used to pay only the Ambush line's mana and never asked
 * the imposed-cost layer, so an Ambush under the Arbiter paid no life while a
 * spell card in the same spot paid 2.
 *
 * The imposed channels of the cost-modifier layer are exactly two (CostMod's
 * `life` and `sacrifice`; `delta` is the card's own mana, `xMin` its X floor),
 * and the Ambush now reaches both through the helpers the hand cast uses:
 * `E.canPayImposedPlayCosts` for the offer and the refusal, `E.payPlayLife`
 * for the life, and the same `playSacrifice` atom for the sacrifice.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import { IllegalAction } from '../src/engine.ts';
import type { Seat } from '../src/types.ts';
import { ent, finishBattle, give, giveResources, offered, pick, spawn, toDeployment, toNextBattle } from './util.ts';

/** A owns the tax card in its home region; D attacks into it with `n` units
 * and holds priority with the Ambush mana open (Lurking Slimebeast, [3b]). */
function battleUnder(seed: number, taxCard: string, n: number): { h: Harness; A: Seat; D: Seat; raiders: number[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  spawn(h, A, taxCard);
  const raiders = Array.from({ length: n }, () => spawn(h, D, 'Unit Token'));
  giveResources(h, D, 'water', 3);
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: raiders.map(r => [r]) });
  assert.equal(h.state.priority, D, 'setup: the attacker holds priority');
  return { h, A, D, raiders };
}

const ambushOffered = (h: Harness, seat: Seat, handIndex: number): boolean =>
  h.legal(seat).some(a => a.type === 'playCard' && a.handIndex === handIndex
    && (a as { mode?: string }).mode === 'ambush');

test('CR 111.10e / CT-243: an Ambush played under Arbiter of Armistice pays the 2 life', () => {
  const { h, D, raiders } = battleUnder(54801, 'Arbiter of Armistice', 1);
  const life = h.state.players[D]!.life;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Lurking Slimebeast'), mode: 'ambush' });
  pick(h, { unit: raiders[0] });
  assert.equal(h.state.players[D]!.life, life - 2, 'the imposed [Pay 2 life] came off as the Ambush was played');
  assert.ok(h.log.some(l => l.includes('pays 2 life to play Lurking Slimebeast')), 'and the log says why');
  finishBattle(h);
});

test('CR 111.10d / CT-243: an Ambush that cannot pay the imposed life is not offered, and apply refuses it', () => {
  const { h, D } = battleUnder(54802, 'Arbiter of Armistice', 1);
  const slime = give(h, D, 'Lurking Slimebeast');
  h.state.players[D]!.life = 2;   // CR 111.6b: pay N life only while you have MORE
  assert.ok(!ambushOffered(h, D, slime), 'not offered at exactly 2 life');
  const open0 = h.state.players[D]!.resources.filter(r => r.state === 'open').length;
  assert.throws(() => h.do({ type: 'playCard', seat: D, handIndex: slime, mode: 'ambush' }), IllegalAction,
    'and apply() refuses it too, so the offer and the accept agree');
  assert.equal(h.state.players[D]!.resources.filter(r => r.state === 'open').length, open0, 'nothing was half-paid');
  h.state.players[D]!.life = 3;
  assert.ok(ambushOffered(h, D, slime), 'one more life and the Ambush is offered again');
});

test('CR 111.10e / CT-243: an Ambush under an opposing Vengeance owes the sacrifice, chosen by its player before it reaches the stack', () => {
  const { h, D, raiders } = battleUnder(54803, 'Vengeance', 2);
  const [target, spare] = raiders as [number, number];
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Lurking Slimebeast'), mode: 'ambush' });
  pick(h, { unit: target });                // the Ambush target first (CR 702.3f)
  const dec = h.state.decision!;
  assert.ok(dec, 'the imposed sacrifice is a real decision');
  assert.equal(dec.seat, D, 'the player who plays the Ambush chooses the sacrifice');
  assert.ok(dec.prompt.includes('sacrifice a unit') && dec.prompt.includes('additional cost'), dec.prompt);
  assert.deepEqual(offered(h).sort(), [JSON.stringify({ unit: target }), JSON.stringify({ unit: spare })].sort(),
    'off a menu of their own units only');
  assert.equal(h.state.stack.length, 0, 'the cost is paid BEFORE the Ambush reaches the stack');
  pick(h, { unit: spare });
  assert.ok(!ent(h, spare), 'the sacrificed unit died');
  assert.equal(h.state.stack.length, 1, 'and only then is the Ambush on the stack');
  finishBattle(h);
});
