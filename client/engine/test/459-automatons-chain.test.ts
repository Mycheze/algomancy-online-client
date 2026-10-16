/**
 * Reports #212 / #213, the second defect: TWO Automatons of Abundance gave
 * only ONE extra token. `settleTokenBatch` stopped at the first donor that
 * returned extras ("first to replace consumes").
 *
 * Caleb, rules-questions 2025-11-25, on two Automatons: "1 token -> 2tokens
 * -> 3 tokens", and "the tldr is replacement effects only apply once onto an
 * effect". CR 708.4: each replacement effect applies to the event at most
 * once, and the event it produces can still be replaced by a DIFFERENT effect
 * that has not applied yet. So the second Automaton sees the creation as the
 * first left it — the original plus its copy — and adds one copy of each
 * unique token in THAT, which, the first copy being identical, is one more.
 *
 * RED-CHECK: put `return;` back after the first donor's extras are queued in
 * `settleTokenBatch` and every test here fails (2 !== 3, 4 !== 6).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Seat } from '../src/types.ts';
import { give, giveResources, spawn, toDeployment, unitsOf } from './util.ts';

function create(h: Harness, A: Seat, opts: { tokenStats?: [number, number]; counters?: number }, name = 'Unit Token'): void {
  const e = new E(h.state);
  e.spawnUnit(A, name, e.homeRegion(A), { token: true, ...opts });
  e.settle();
}

function tokens(h: Harness, A: Seat, name: string): string[] {
  const e = new E(h.state);
  return unitsOf(h, A).filter(u => u.card === name && u.token)
    .map(u => `${e.printedStats(u).join('/')}+${u.counters}`).sort();
}

test('CR 708.4: two Automatons of Abundance turn one created token into three', () => {
  const h = new Harness(45901);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Automaton of Abundance');
  spawn(h, A, 'Automaton of Abundance');
  create(h, A, {});
  assert.equal(tokens(h, A, 'Unit Token').length, 3,
    'Caleb 2025-11-25: "1 token -> 2tokens -> 3 tokens" — each Automaton applies once');
});

test('CR 708.4: two Automatons and a 3/3 Unit Token give three 3/3s', () => {
  const h = new Harness(45902);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Automaton of Abundance');
  spawn(h, A, 'Automaton of Abundance');
  create(h, A, { tokenStats: [3, 3] });
  assert.deepEqual(tokens(h, A, 'Unit Token'), ['3/3+0', '3/3+0', '3/3+0']);
});

test('CR 708.4: three Automatons turn one created token into four', () => {
  const h = new Harness(45903);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  for (let i = 0; i < 3; i++) spawn(h, A, 'Automaton of Abundance');
  create(h, A, {});
  assert.equal(tokens(h, A, 'Unit Token').length, 4, 'one more per Automaton, never one Automaton twice');
});

test('CR 708.4: two Automatons and Manufacture make nine Robots, three of each X', () => {
  // three unique tokens; the first Automaton adds three, the second sees six
  // requests that are still three unique tokens and adds three more
  const h = new Harness(45904);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Automaton of Abundance');
  spawn(h, A, 'Automaton of Abundance');
  giveResources(h, A, 'metal', 6);                          // Manufacture mmm/6
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Manufacture') });
  const robots = unitsOf(h, A).filter(u => u.card === 'Robot');
  assert.deepEqual(robots.map(r => r.counters).sort((a, b) => a - b), [1, 1, 1, 2, 2, 2, 3, 3, 3],
    'three printed Robots, then one copy of each unique Robot per Automaton');
});

test('CR 708.4: an opposing Automaton of Abundance adds nothing to your creation', () => {
  const h = new Harness(45905);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Automaton of Abundance');
  const e = new E(h.state);                                  // in YOUR region, so only "you" excludes it
  e.spawnUnit((1 - A) as Seat, 'Automaton of Abundance', e.homeRegion(A));
  e.settle();
  create(h, A, {});
  assert.equal(tokens(h, A, 'Unit Token').length, 2, '"you created" — only your own Automaton applies');
});
