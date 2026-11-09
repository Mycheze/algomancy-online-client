/* The two board reads that stalled a crowded game, counted.
 *
 * A declared block is offered for every blocker and every pair of blockers, and
 * each of those asked every attacker and blocker whether it is Pure: on a big
 * board that was the longest single stall on the server, and every other game
 * waited behind it. Separately, one `staticsFor` asked whether anything on the
 * board could project a face once per radiator, walking the whole board each
 * time. The results were always right, so these count the work.
 * Seeds: 11920-11929.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legalActions } from '../src/apply.ts';
import { E } from '../src/engine.ts';
import { Harness } from '../src/harness.ts';
import { pass, spawn, toDeployment, toNextBattle } from './util.ts';
import type { EntityId, Seat } from '../src/types.ts';

const other = (s: Seat): Seat => (1 - s) as Seat;

/** run `body` while counting calls to one method of E */
function counting(method: string, body: () => void): number {
  const proto = E.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const real = proto[method]!;
  let calls = 0;
  proto[method] = function (this: unknown, ...a: unknown[]) { calls++; return real.apply(this, a); };
  try { body(); } finally { proto[method] = real; }
  return calls;
}

function atBlocks(seed: number, blockers: number): { h: Harness; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = other(A);
  const ids: EntityId[] = [spawn(h, A, 'Good Whale'), spawn(h, A, 'Good Whale')];
  for (let i = 0; i < blockers; i++) spawn(h, D, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: ids.map(id => [id]) });
  for (let g = 0; g < 8 && h.state.battle?.step !== 'blocks'; g++) pass(h);
  assert.equal(h.state.battle?.step, 'blocks', 'reached the block step');
  return { h, D };
}

test('1192 the block list asks about each unit once, not once per pair', () => {
  const { h, D } = atBlocks(11920, 12);
  let list = 0;
  const calls = counting('pure', () => { list = legalActions(h.state, D).length; });
  assert.ok(list > 66, `the pairs are still offered (${list})`);
  assert.ok(calls <= 12 + 2 + 12, `Pure was asked ${calls} times for 12 blockers and 2 columns`);
});

test('1192 one statics lookup asks once whether anything can project', () => {
  const { h, D } = atBlocks(11921, 12);
  const e = new E(structuredClone(h.state)) as unknown as { staticsFor(u: unknown): unknown[]; s: typeof h.state };
  const target = Object.values(e.s.entities).find(u => u.kind === 'unit' && u.controller === D)!;
  const calls = counting('anyProjector', () => { e.staticsFor(target); });
  assert.equal(calls, 1, 'one walk for the whole lookup');
  assert.ok(counting('anyProjector', () => { e.staticsFor(target); }) === 1, 'and the answer is not kept past it');
});
