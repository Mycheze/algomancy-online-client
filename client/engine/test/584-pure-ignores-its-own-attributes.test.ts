/* CR 802.25a — a Pure card ignores its own other attributes, everywhere.
 *
 * "A Pure card ignores its own other attributes too." The owner, 2026-10-22,
 * on the question 427 left open: this holds always, not only inside an
 * interaction. So a Pure unit is read without its own Tough, Balanced,
 * Inverted and Unaware even when nothing is interacting with it, and the
 * state-based check sees those plain numbers. CR 802.25k: a unit standing in
 * a column with a Pure unit is Pure too, so the same goes for it.
 *
 * (In an interaction a NON-Pure participant loses its stat attributes as well
 * — that is CT-260, 555.)
 *
 * Seeds 58400-58499. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Attr, EntityId, Seat } from '../src/types.ts';
import { effStats, ent, finishBattle, spawn, toDeployment, toNextBattle } from './util.ts';

function grant(h: Harness, id: EntityId, ...attrs: Attr[]): void {
  const g = new E(h.state);
  for (const a of attrs) g.addTempAttr(g.entity(id)!, a);
  g.settle();
  h.state = g.s;
}

test('CR 802.25a: a Pure Rampart Guardian, in no interaction, ignores its own Tough and reads 0/4', () => {
  const h = new Harness(58401);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const g0 = spawn(h, p, 'Rampart Guardian');               // 0/4 Tough
  assert.deepEqual(effStats(h, g0), [0, 8], 'PREMISE: not Pure, Tough doubles it');
  grant(h, g0, 'Pure');
  assert.deepEqual(effStats(h, g0), [0, 4], 'Pure: its own Tough is ignored');
});

test('CR 802.25a: a Pure Child of Aether ignores its own Balanced, reads 2/0 and dies in the state check', () => {
  const h = new Harness(58402);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const child = spawn(h, p, 'Child of Aether');             // 2/0 Balanced, alive as a 2/2
  assert.deepEqual(effStats(h, child), [2, 2], 'PREMISE: Balanced keeps the 2/0 alive');
  grant(h, child, 'Pure');
  assert.equal(ent(h, child), undefined, 'without its Balanced it is a 2/0, and 0 defense is death');
});

test('CR 802.25a: a Pure Bubb ignores its own Unaware, so its counters count', () => {
  const h = new Harness(58403);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const bubb = spawn(h, p, 'Bubb');                         // 5/6 Unaware
  { const g = new E(h.state); g.addCounters(g.entity(bubb)!, 2); g.settle(); h.state = g.s; }
  assert.deepEqual(effStats(h, bubb), [5, 6], 'PREMISE: Unaware reads the printed 5/6 through the counters');
  grant(h, bubb, 'Pure');
  assert.deepEqual(effStats(h, bubb), [7, 8], 'Pure: Unaware is ignored and the two +1/+1 counters count');
  assert.equal(new E(h.state).unaware(ent(h, bubb)!), false, 'and it collapses nobody');
});

test('CR 802.25a, 802.25k: Rampart Guardian attacking in a column with Just a Unit is Pure, so its Tough is off: 0/4', () => {
  const h = new Harness(58404);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  const g0 = spawn(h, A, 'Rampart Guardian');
  const jau = spawn(h, A, 'Just a Unit');                   // 2/3 Pure
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[g0, jau]] });
  assert.deepEqual(effStats(h, g0), [0, 4], 'the column shares Pure, and a Pure card ignores its own Tough');
  finishBattle(h);
});

/* ── the kill riders ────────────────────────────────────────────────── */

function killedOne(seed: number, attrs: string[]) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const victim = spawn(h, D, 'Unit Token');
  const e = new E(h.state);
  const before = e.snapshotUnits();
  e.destroy(e.entity(victim)!, 'dies');
  const rot = e.rot(D), hand = h.state.players[A]!.hand.length;
  e.killRiders(before, new Set(attrs), 'Probe', A);
  return { rotGained: e.rot(D) - rot, drew: h.state.players[A]!.hand.length - hand };
}

test('CR 802.25a: a Pure source that is Afflicting and Reaping pays neither rider for a kill', () => {
  assert.deepEqual(killedOne(58405, ['Afflicting', 'Reaping']), { rotGained: 1, drew: 1 },
    'PREMISE: without Pure the kill pays a rot to the victim controller and a card to the source controller');
  assert.deepEqual(killedOne(58406, ['Pure', 'Afflicting', 'Reaping']), { rotGained: 0, drew: 0 },
    'a Pure source ignores its own Afflicting and Reaping');
});

/** an effect-damage batch dealt outside a resolving part, from a source
 *  carrying `attrs`: how many cards its controller drew */
function reapedOne(seed: number, attrs: string[]): number {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const src = spawn(h, A, 'Unit Token');
  const victim = spawn(h, D, 'Unit Token');
  const g = new E(h.state);
  const hand = g.s.players[A]!.hand.length;
  g.dealEffectDamageAll({
    controller: A, sourceName: 'Unit Token', sourceId: src, region: g.homeRegion(A),
    targets: [], event: null, grantedAttrs: attrs as Attr[],
    eraseSelf: () => {},
    choose: (_k, dec) => { throw new Error(`unexpected ${dec.kind}`); },
  }, [{ target: g.entity(victim)!, n: 5 }]);
  g.settle();
  assert.ok(!g.entity(victim), 'the victim died');
  return g.s.players[A]!.hand.length - hand;
}

test('CR 802.25a: a Pure Reaping source draws nothing for a kill dealt outside a resolving part either', () => {
  assert.equal(reapedOne(58407, ['Reaping']), 1, 'PREMISE: the direct batch pays the Reaping draw');
  assert.equal(reapedOne(58408, ['Pure', 'Reaping']), 0, 'a Pure source ignores its own Reaping');
});
