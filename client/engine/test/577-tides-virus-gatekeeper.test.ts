/**
 * CR 110.12 / CT-331 (follow-up) — a Virus played MID-RESOLUTION (Tides of the
 * Cosmos, CR 701.2c) obeys Gatekeeper of Souls too.
 *
 * CT-331 narrowed the battle Virus from hand (apply.ts battleVirusHosts). The
 * inline Virus mode in batch-water-a.ts had its own host list — every unit in
 * the battle — so a Virus played off Tides could still go onto another unit
 * with a Gatekeeper standing there. It now narrows through the same
 * E.compelledTargets.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { ent, finishBattle, give, giveResources, pass, spawn, toDeployment, toNextBattle } from './util.ts';
import type { Seat } from '../src/types.ts';

function decide(h: Harness, match: (label: string) => boolean): void {
  const d = h.state.decision;
  assert.ok(d, 'a decision is pending');
  const i = d.options.findIndex(o => match(o.label));
  assert.notEqual(i, -1, `no option matching; menu was [${d.options.map(o => o.label).join(' | ')}]`);
  h.do({ type: 'decide', seat: d.seat, choice: i });
}

test('CR 110.12 / CT-331: a Virus played by Tides of the Cosmos goes onto the Gatekeeper of Souls in the battle', () => {
  const h = new Harness(5770);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  const gk = spawn(h, D, 'Gatekeeper of Souls');
  giveResources(h, D, 'water', 11);
  toNextBattle(h, A);
  h.state.sharedDeck = ['Molten Riftbreaker', ...Array(7).fill('Good Whale'), 'Dune Drifter'];
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tides of the Cosmos') });
  pass(h); pass(h);
  decide(h, l => l.startsWith('Molten Riftbreaker'));
  if (h.state.decision?.options.some(o => o.label === 'Done')) decide(h, l => l === 'Done');
  decide(h, l => /as a Virus/.test(l));
  // one legal host: no host question at all, and the item is aimed at the Gatekeeper
  const item = h.state.stack.find(i => i.kind === 'virus' && i.card === 'Molten Riftbreaker');
  assert.ok(item, 'the Virus is on the stack');
  assert.equal(item!.hostId, gk, 'aimed at the Gatekeeper, not the attacking Curio Drifter');
  for (let k = 0; k < 20 && (h.state.stack.length || h.state.decision); k++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
  assert.ok(ent(h, gk)!.mods.some(id => h.state.entities[id]?.card === 'Molten Riftbreaker'));
  assert.ok(!ent(h, atk) || !ent(h, atk)!.mods.length, 'the attacker took nothing');
  finishBattle(h);
});
