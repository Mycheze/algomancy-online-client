/**
 * CR 701.2c, 723.4, 721.4a / CT-416 — a Virus played by Tides of the Cosmos
 * reaches every host a Virus applied from hand in the battle reaches: the
 * units there, a spell on the stack (CR 723.4), and a spell token in play in
 * the battle region (CR 721.4a, CT-407).
 *
 * The RAQ write-up of Tides (1396955380000755795): "Tides allows you to play
 * Ambushes/Prophecy and apply Viruses". Its Virus mode used to collect the
 * units in the region and nothing else, so a Virus it revealed could not go
 * onto a spell on the stack or a spell token in play. It now reads the one
 * battle Virus host list, `E.battleVirusHosts`.
 *
 * Seeds 68200-68249.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { give, giveResources, pass, spawn, toDeployment, toNextBattle, withE } from './util.ts';
import type { Seat } from '../src/types.ts';

function decide(h: Harness, match: (label: string) => boolean): void {
  const d = h.state.decision;
  assert.ok(d, 'a decision is pending');
  const i = d.options.findIndex(o => match(o.label));
  assert.notEqual(i, -1, `no option matching; menu was [${d.options.map(o => o.label).join(' | ')}]`);
  h.do({ type: 'decide', seat: d.seat, choice: i });
}

/** A attacks; D answers with Tides, which reveals Molten Riftbreaker (a Virus) on top;
 * `before` runs while A holds priority after the attack (put a spell on the stack, or not) */
function tidesVirus(seed: number, before: (h: Harness, A: Seat) => void): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  giveResources(h, D, 'water', 11);
  giveResources(h, A, 'earth', 4);
  toNextBattle(h, A);
  h.state.sharedDeck = ['Molten Riftbreaker', ...Array(7).fill('Good Whale'), 'Dune Drifter'];
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  before(h, A);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tides of the Cosmos') });
  pass(h); pass(h);                                   // Tides resolves
  decide(h, l => l.startsWith('Molten Riftbreaker'));
  if (h.state.decision?.options.some(o => o.label === 'Done')) decide(h, l => l === 'Done');
  decide(h, l => /as a Virus/.test(l));
  return { h, A, D };
}

test('CR 723.4 / CT-416: a Virus played by Tides of the Cosmos is offered onto an enemy spell on the stack, and goes there', () => {
  const { h } = tidesVirus(68200, (h, A) => {
    h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Haboob') });   // "I deal 1 damage to each unit."
  });
  const haboob = h.state.stack.find(i => i.card === 'Haboob');
  assert.ok(haboob, 'Haboob waits on the stack under Tides');
  const d = h.state.decision;
  assert.ok(d && /as a Virus/.test(d.prompt ?? ''), 'the host question is up');
  const i = d!.options.findIndex(o => /Haboob/.test(o.label));
  assert.notEqual(i, -1, `Haboob is offered as a host; menu was [${d!.options.map(o => o.label).join(' | ')}]`);
  assert.ok(d!.options.some(o => /Curio Drifter/.test(o.label)), 'beside the units in the battle');
  h.do({ type: 'decide', seat: d!.seat, choice: i });
  const item = h.state.stack.find(it => it.kind === 'virus' && it.card === 'Molten Riftbreaker');
  assert.ok(item, 'the Virus is on the stack');
  assert.equal(item!.hostStack, haboob!.id, 'aimed at Haboob on the stack');
  for (let k = 0; k < 30 && (h.state.stack.length || h.state.decision); k++) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
  assert.equal(h.state.stack.length, 0, 'everything resolved');
});

test('CR 721.4a / CT-416: a Virus played by Tides of the Cosmos is offered onto a spell token in play in the battle', () => {
  let tok = -1;
  const { h } = tidesVirus(68201, (h, A) => {
    withE(h, g => { g.createSpellToken(A, 'Fireball', 2, h.state.battle!.region); });
    tok = new E(h.state).tokensOf(A, h.state.battle!.region).find(t => t.card === 'Fireball')!.id;
    pass(h);                                          // A passes; D has priority
  });
  const d = h.state.decision;
  assert.ok(d, 'the host question is up');
  const i = d!.options.findIndex(o => o.value === tok);
  assert.notEqual(i, -1, `the Fireball token is offered; menu was [${d!.options.map(o => o.label).join(' | ')}]`);
  h.do({ type: 'decide', seat: d!.seat, choice: i });
  const item = h.state.stack.find(it => it.kind === 'virus' && it.card === 'Molten Riftbreaker');
  assert.equal(item?.hostId, tok, 'aimed at the Fireball token');
});
