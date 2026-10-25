/**
 * CR 708.9 — all the tokens ONE RESOLUTION OF ONE EFFECT creates are one
 * creation, even when grafts split it into parts.
 *
 * _passer, rules-questions 2025-04-08 (RQ 1358924177163288707), asked about
 * Automaton of Abundance ("If you would create one or more unit tokens,
 * instead create those tokens plus an additional copy of each unique token you
 * created") and an Omniwield Evoker grafted with Manufacture, Self-Assembly and
 * Construct Overseer. Option 2 was "2x (Robot 1 + Robot 2 + Robot 3) / 1x
 * Robot 3 (cuz you already made extra Robot 3 with this effect) / 1x Robota
 * (cuz you already made extra Robot 1 with this effect)". Caleb Gannon
 * (RQ 1358924537160536247): "it would be the second one".
 *
 * The engine batched per resolving PART, so each graft was a creation of its
 * own and paid its own copy: Manufacture's Robot 1 and Construct Overseer's
 * Robot 1 were both copied. Now the item remembers what each Automaton has
 * copied (`StackItem.tokenMemo`), and a part only adds copies of tokens not yet
 * copied in the effect. The copies are still made at the end of each part.
 *
 * RED before: 8 Robots, four copies; Caleb's answer is 7, three copies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import { give, giveResources, spawn, toDeployment, unitsOf } from './util.ts';

function evoker(seed: number, grafts: string[]) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat;
  spawn(h, A, 'Automaton of Abundance');
  const ev = spawn(h, A, 'Omniwield Evoker');
  giveResources(h, A, 'metal', 30);
  for (const g of grafts) h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, g), hostId: ev, position: 0 });
  const at = h.events.length;
  h.do({ type: 'activateAbility', seat: A, entityId: ev, abilityIndex: 0 });
  return { h, A, at };
}

const robots = (h: Harness, A: Seat): number[] =>
  unitsOf(h, A).filter(u => u.card === 'Robot').map(u => u.counters).sort((a, b) => a - b);

test('CR 708.9: Omniwield Evoker grafted with Manufacture and Construct Overseer, one extra Robot 1, not two', () => {
  const { h, A, at } = evoker(70001, ['Manufacture', 'Construct Overseer']);
  assert.equal(h.state.decision, null);
  assert.deepEqual(robots(h, A), [1, 1, 1, 2, 2, 3, 3],
    'Manufacture 3/2/1 and a copy of each; the Overseer Robot 1 is not copied — a Robot 1 already was');
  // each graft went in at position 0, so the Overseer part resolves first: its
  // Robot 1 is copied there, and Manufacture's Robot 1 is the one not copied
  const lines = h.events.slice(at).map(e => e.msg).filter(m => /Automaton of Abundance: the creation is replaced/.test(m));
  assert.deepEqual(lines, [
    'Automaton of Abundance: the creation is replaced — 1 more token(s) (Robot) are created with it.',
    'Automaton of Abundance: the creation is replaced — 2 more token(s) (Robot, Robot) are created with it.',
  ], 'three copies in the whole effect, one per unique token');
});

test('CR 708.9: a token not yet copied in the effect is still copied in a later part', () => {
  // Self-Assembly: "Create a Robot X, where X is your [m]" — a Robot X that
  // Manufacture did not make is a new unique token, and is copied
  const { h, A } = evoker(70002, ['Manufacture', 'Self-Assembly']);
  const xs = robots(h, A);
  const big = xs.filter(x => x > 3);
  assert.equal(big.length, 2, `the Robot X (X = your [m], more than 3) and its copy: ${xs.join(',')}`);
  assert.equal(xs.length, 8);
});

test('CR 708.9: two activations are two effects — the second copies again', () => {
  const { h, A } = evoker(70003, ['Construct Overseer']);
  assert.deepEqual(robots(h, A), [1, 1], 'the first activation: a Robot 1 and its copy');
  h.do({ type: 'activateAbility', seat: A, entityId: unitsOf(h, A).find(u => u.card === 'Omniwield Evoker')!.id, abilityIndex: 0 });
  assert.deepEqual(robots(h, A), [1, 1, 1, 1], 'a new effect, a new creation');
});
