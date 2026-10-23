/**
 * CR 702.6b, 111.6b, 109.9 / report 273 — PAYING X LIFE IS ONE LIFE CHANGE OF X.
 *
 * Report 273 (Karanda, Weekly Challenge "Full House"): "Life plant only made
 * 1 token when paying 29 life". Life Plant: "[Augment][once] When you gain or
 * lose life, create that many 1/1 units." Flesh Tithe: "[Pay X life], create
 * an X/X unit."
 *
 * The variable cost was sized one point at a time (CR 702.6b) and each point
 * was LOST as it was chosen — 29 separate one-point 'lifeLost' events. Life
 * Plant's [once] heard the first, made one 1/1, and its use was spent. "[Pay X
 * life]" is one payment: the points are still chosen one at a time (CR 111.6b
 * re-asked against the running total), and the X life is lost together, as
 * one life change, when X closes.
 *
 * The same shape was in Torrential Reclamation ("you lose 1 life for each ally
 * recalled this way"), which looped one-point losses. The class guard below is
 * DERIVED from the registry: every effect with a variable life cast cost.
 *
 * Seeds 59000-59099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { allCardNames, getCard } from '../src/cards/dsl.ts';
import type { EntityId, Seat } from '../src/types.ts';
import {
  finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, unitsOf, withE,
} from './util.ts';

function mod(h: Harness, host: EntityId, card: string, seat: Seat): EntityId {
  let id = -1;
  withE(h, e => { id = e.attachMod(e.s.entities[host]!, card, seat, 'augment').id; });
  return id;
}
/** the Life Plant 1/1s (Flesh Tithe's own token is an X/X, so stats tell them apart) */
const ones = (h: Harness, s: Seat): number => unitsOf(h, s).filter(u =>
  u.card === 'Unit Token' && u.token && u.tokenStats?.[0] === 1 && u.tokenStats?.[1] === 1).length;
const lossesOf = (h: Harness, s: Seat): number[] => h.events
  .filter(e => e.type === 'lifeLost' && e.data?.['seat'] === s).map(e => e.data!['n'] as number);

/** cast `name` (Flesh Tithe by default) for `seat` and pay `x` life a point at a time */
function fleshTithe(h: Harness, seat: Seat, x: number, name = 'Flesh Tithe'): void {
  for (const k of ['light', 'dark', 'fire', 'water', 'earth', 'wood', 'metal'] as const) giveResources(h, seat, k, 4);
  h.do({ type: 'playCard', seat, handIndex: give(h, seat, name) });
  for (let i = 0; i < x; i++) pick(h, { payLife1: true });
  // at 1 life nothing more is offered and X closes on its own (CR 111.6b)
  if (h.state.decision && h.state.suspension?.type === 'cast') pick(h, { doneCost: true });
  for (let i = 0; i < 6 && (h.state.stack.length || h.state.triggerQueue.length); i++) pass(h);
}

for (const as of ['unit', 'augment mod'] as const) {
  test(`CR 702.6b / report 273: paying 29 life for Flesh Tithe makes 29 Life Plant units (Life Plant ${as === 'unit' ? 'as a unit' : 'as an augment mod'})`, () => {
    const h = new Harness(as === 'unit' ? 59000 : 59001);
    toDeployment(h);
    const A = h.state.deployPlayer!;
    if (as === 'unit') spawn(h, A, 'Life Plant');
    else mod(h, spawn(h, A, 'Good Whale'), 'Life Plant', A);
    const mark = h.events.length;
    fleshTithe(h, A, 29);
    assert.equal(h.state.players[A]!.life, 1, '29 of 30 life paid (CR 111.6b stops it at 1)');
    assert.deepEqual(h.events.slice(mark).filter(e => e.type === 'lifeLost').map(e => e.data!['n']), [29],
      'ONE life change of 29, not twenty-nine of 1');
    assert.equal(ones(h, A), 29, 'that many: twenty-nine 1/1 units');
    const tithe = unitsOf(h, A).filter(u => u.card === 'Unit Token' && u.tokenStats?.[0] === 29);
    assert.equal(tithe.length, 1, 'and Flesh Tithe still made its 29/29');
  });
}

test('CR 111.6b / report 273: the life is lost when X closes, and the running total is what is asked', () => {
  const h = new Harness(59002);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  h.state.players[A]!.life = 4;
  giveResources(h, A, 'light', 4);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Flesh Tithe') });
  pick(h, { payLife1: true });
  pick(h, { payLife1: true });
  assert.equal(h.state.players[A]!.life, 4, 'the points are counted, not yet lost');
  pick(h, { payLife1: true });                                // 3 of 4: the last one allowed
  assert.equal(h.state.players[A]!.life, 1, 'nothing more can be chosen, so X closed and 3 life was paid at once');
  assert.deepEqual(lossesOf(h, A), [3]);
  assert.equal(h.state.winner, null, 'never the last life');
});

test('CR 109.9 / report 273: Life Plant hears a gain, and damage, as that many; a second change in the turn makes nothing', () => {
  const h = new Harness(59003);
  toDeployment(h);
  const A = h.state.initiative;
  const D = (1 - A) as Seat;
  spawn(h, D, 'Life Plant');
  const atk = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  finishBattle(h);
  const dealt = lossesOf(h, D);
  assert.equal(dealt.length, 1, 'one combat life loss');
  assert.ok(dealt[0]! > 0, 'the unblocked Good Whale connected');
  assert.equal(ones(h, D), dealt[0], 'damage causes loss of life: that many 1/1s');
  withE(h, e => e.gainLife(D, 4, 'test'));
  assert.equal(ones(h, D), dealt[0], '[once]: a second life change this turn makes nothing');
});

test('CR 702.6b / report 273: Torrential Reclamation loses its life as one change, so Life Plant makes that many', () => {
  const h = new Harness(59004);
  toDeployment(h);
  const A = h.state.initiative;
  spawn(h, A, 'Life Plant');
  const w1 = spawn(h, A, 'Good Whale');
  const w2 = spawn(h, A, 'Good Whale');
  const fodder = [spawn(h, A, 'Good Whale'), spawn(h, A, 'Good Whale')];   // one sacrifice per recalled ally
  for (const k of ['water', 'dark', 'fire', 'light', 'earth', 'wood', 'metal'] as const) giveResources(h, A, k, 3);
  toNextBattle(h, A);
  const plant = unitsOf(h, A).find(u => u.card === 'Life Plant')!.id;
  h.do({ type: 'declareAttack', seat: A, columns: [[plant], [w1], [w2], [fodder[0]!], [fodder[1]!]] });
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Torrential Reclamation') });
  pick(h, 2);                                                 // X = 2
  pick(h, { unit: w1 });
  pick(h, { unit: w2 });
  pass(h); pass(h);
  for (let i = 0; i < 8 && h.state.decision; i++) {
    const d = h.state.decision!;
    const keep = d.options.findIndex(o => fodder.includes(o.value as EntityId));   // sacrifice the fodder, never the plant
    h.do({ type: 'decide', seat: d.seat, choice: keep >= 0 ? keep : 0 });
  }
  for (let i = 0; i < 4 && (h.state.stack.length || h.state.triggerQueue.length); i++) pass(h);
  assert.deepEqual(h.events.slice(mark).filter(e => e.type === 'lifeLost' && e.data?.['seat'] === A).map(e => e.data!['n']), [2],
    'one loss of 2 for the two recalled allies');
  assert.equal(ones(h, A), 2, 'Life Plant made two 1/1s');
});

// DERIVED: every effect in the registry whose cast cost is a variable life
// cost goes through the one collector — sized a point at a time, lost once.
test('CR 702.6b / report 273: every variable life cost in the pool is lost as one change of X', () => {
  const subjects = allCardNames().filter(n => {
    const c = getCard(n);
    const fx = [c.spellEffect, c.graftEffect?.effect, ...(c.abilities ?? []).map(a => ('effect' in a ? a.effect : undefined))];
    return fx.some(f => f?.castCost?.kind === 'payLife' && f.castCost.n === 'X');
  });
  assert.ok(subjects.includes('Flesh Tithe'), 'the sweep finds Flesh Tithe');
  for (const name of subjects) {
    const c = getCard(name);
    assert.ok(c.spellEffect?.castCost?.kind === 'payLife',
      `${name}: a variable life cost off a spell's own cast is the only route this sweep drives — add one for this card`);
    const h = new Harness(59010);
    toDeployment(h);
    const A = h.state.deployPlayer!;
    spawn(h, A, 'Adversary of the Deep');                     // "put that many +1/+1 counters on me"
    const adv = unitsOf(h, A).find(u => u.card === 'Adversary of the Deep')!;
    const before = adv.counters;
    const mark = h.events.length;
    fleshTithe(h, A, 7, name);
    assert.deepEqual(h.events.slice(mark).filter(e => e.type === 'lifeLost').map(e => e.data!['n']), [7],
      `${name}: one loss of 7`);
    assert.equal(unitsOf(h, A).find(u => u.id === adv.id)!.counters - before, 7,
      `${name}: Adversary of the Deep hears 7, once`);
  }
});
