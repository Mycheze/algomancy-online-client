/* Report #279 (Weekly Challenge 2026-10-25-crowd, LordZZX, 2026-10-23):
 * "Tough and Balanced don't seem to work together".
 *
 * Crumbling Ancient (3/8) augmented with Child of Aether (Balanced) and then
 * Rampart Guardian (Tough) read 8/16: the engine applied the augments'
 * attributes in attach order, so Balanced went first. The designer settled
 * the order a year before the CR was written, and it is not an order at all
 * for Balanced, it is "last":
 *
 *   calebgannon, rules-questions 2025-01-31: "My gut tells me we need to
 *     standardize this and just always have balanced apply last" / "So a
 *     balanced unit will always have equal stats" / "balanced units ALWAYS
 *     having balanced stats just makes intuitive sense". _passer: "Sooo...
 *     Balance is calculated after Tough, but before Inverted and Unaware?"
 *     calebgannon: "yeah".
 *   calebgannon, 2025-03-22: "The only change is balanced now applies after
 *     tough always".
 *   calebgannon, 2025-09-25, on a column of Child of Aether (2/0 Balanced) and
 *     Rampart Guardian (0/4 Tough): "balanced always applies last. So 8/8 and
 *     2/2".
 *
 * So whatever the source (printed, augment, granted by an effect, shared by
 * the column) and whatever the attach order, Tough doubles and THEN Balanced
 * balances. Inverted (layer 5) and Unaware (layer 6) keep their places after.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import {
  effStats, finishBattle, give, giveResources, pass, spawn, toDeployment, toNextBattle, withE,
} from './util.ts';

function augment(h: Harness, seat: Seat, card: string, hostId: number): void {
  h.do({ type: 'augment', seat, from: 'hand', index: give(h, seat, card), hostId });
}

test('CR 802.7 / report 279: Crumbling Ancient augmented with Child of Aether and then Rampart Guardian is a 16/16', () => {
  const h = new Harness(60301);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'earth', 8);
  const ancient = spawn(h, p, 'Crumbling Ancient');            // 3/8
  augment(h, p, 'Child of Aether', ancient);                    // Balanced: 8/8
  assert.deepEqual(effStats(h, ancient), [8, 8]);
  augment(h, p, 'Chitin Shredder', ancient);                    // Powerful: no stat change
  augment(h, p, 'Rampart Guardian', ancient);                   // Tough
  assert.deepEqual(effStats(h, ancient), [16, 16],
    '3/8, doubled to 3/16, then balanced: Balanced applies after Tough whatever the attach order');
});

test('CR 802.7 / report 279: Balanced augmented onto a Tough unit still applies last: Rampart Guardian with Child of Aether is an 8/8', () => {
  const h = new Harness(60302);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'earth', 4);
  const g = spawn(h, p, 'Rampart Guardian');                    // 0/4 printed Tough
  augment(h, p, 'Child of Aether', g);
  assert.deepEqual(effStats(h, g), [8, 8], '0/4, doubled to 0/8, then balanced');
});

test('CR 802.7 / report 279: Tough granted by an effect to a Balanced unit doubles first: Child of Aether stays a 2/2', () => {
  const h = new Harness(60303);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const child = spawn(h, p, 'Child of Aether');                 // 2/0 Balanced
  withE(h, e => e.addTempAttr(e.entity(child)!, 'Tough'));
  assert.deepEqual(effStats(h, child), [2, 2], '2/0 doubled is 2/0, then balanced: a Balanced unit always has equal stats');
});

test('CR 802.7 / report 279: a column of Child of Aether and Rampart Guardian is 2/2 and 8/8, the designer worked example', () => {
  const h = new Harness(60304);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const child = spawn(h, A, 'Child of Aether');
  const g = spawn(h, A, 'Rampart Guardian');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[child, g]] });
  assert.deepEqual(effStats(h, child), [2, 2], 'Child of Aether shares Tough: 2/0 doubled is 2/0, then balanced');
  assert.deepEqual(effStats(h, g), [8, 8], 'Rampart Guardian shares Balanced: 0/8, then balanced');
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: (1 - A) as Seat, blocks: {} });
  finishBattle(h);
});
