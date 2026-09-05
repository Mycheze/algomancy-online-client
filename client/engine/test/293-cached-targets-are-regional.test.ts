/* R291 — A CACHED CARD IS A TARGET ONLY WHERE ITS OWNER IS PRESENT.
 *
 * Owner, live report 2026-09-05 (room VNNW, action 178, bug / game breaking):
 *
 *   "The card that says 'Recall up to one cached card' allowed me to target an
 *    opponent's card *while I was in deployment*. During deployment, they
 *    don't exist, neither does their region or cached cards (during battle,
 *    this interaction would be fine)."
 *
 * VNNW replays FAITHFULLY at HEAD (222/222, 0 refused, no fork), and the
 * Observer's activation at [176]/[177] is the moment. `pushCachedCardTargets`
 * walked BOTH players' caches with the comment "not region-scoped: the cache is
 * not in a region" — true of the zone, wrong about its owner. R12: during
 * deployment each seat is alone in its own region and the other seat does not
 * exist; the same `presentSeats` test that decides who is a legal "target
 * player" now decides whose cache is on the menu.
 *
 *   §1 the enumeration: in deployment a seat's home region offers only that
 *      seat's cache; in battle (both present) it offers both
 *   §2 the report's shape, through the real action: Prismatic Observer
 *      sacrificed during deployment never offers the opponent's cached card
 *   §3 the control: R41 still holds in battle — the opponent's cache IS a
 *      target there, which is what the Observer is printed for
 *
 * Seeds 2930-2939.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import { notOffered, offered, pass, spawn, toDeployment, toNextBattle, withE } from './util.ts';

const SPEC = { what: 'cachedCard' as const, prompt: 'recall up to one target cached card', count: 1, min: 0 };

/** both seats holding one targetable cache entry each, mid-deployment */
function twoCaches(seed: number): { h: Harness; uid: [number, number] } {
  const h = new Harness(seed);
  toDeployment(h);
  const uid: [number, number] = [-1, -1];
  withE(h, e => {
    uid[0] = e.cacheCard(0, 'Wisp', 'effect', { prophecy: 'Three Turns Pass' }).uid!;
    uid[1] = e.cacheCard(1, 'Hammer of Justice', 'effect', { prophecy: 'Three Turns Pass' }).uid!;
  });
  return { h, uid };
}

test('R291 §1 in deployment a home region reaches only its own seat\'s cache; in battle both', () => {
  const { h, uid } = twoCaches(2930);
  for (const seat of [0, 1] as Seat[]) {
    const region = h.q.homeRegion(seat);
    assert.deepEqual(h.state.regions[region]!.presentSeats, [seat],
      'the premise: during deployment a seat is alone in its home region (R12)');
    const refs = h.q.targetCandidates(SPEC, region, undefined, seat).map(r => JSON.stringify(r));
    assert.deepEqual(refs, [JSON.stringify({ cached: { seat, uid: uid[seat] } })],
      `seat ${seat}'s deployment menu is exactly its own cache entry`);
  }
  // a seat ENTERS the other's region by attacking into it (apply.ts
  // declareAttack pushes onto presentSeats); an attack with no columns is no
  // battle and nobody goes anywhere
  const atk = spawn(h, 0, 'Curio Drifter');
  toNextBattle(h, 0);
  h.do({ type: 'declareAttack', seat: 0, columns: [[atk]] });
  const region = h.state.battle!.region;
  assert.equal(h.state.regions[region]!.presentSeats.length, 2, 'the premise: both seats are present in the battle');
  const refs = h.q.targetCandidates(SPEC, region, undefined, 0).map(r => JSON.stringify(r));
  assert.deepEqual(refs.sort(), [
    JSON.stringify({ cached: { seat: 0, uid: uid[0] } }),
    JSON.stringify({ cached: { seat: 1, uid: uid[1] } }),
  ].sort(), 'in battle the opponent\'s cache is on the menu too (R41)');
});

test('R291 §2 the report: Prismatic Observer sacrificed in deployment cannot reach the opponent\'s cache', () => {
  const { h, uid } = twoCaches(2931);
  const A = h.state.deployPlayer!, B = (1 - A) as Seat;
  const obs = spawn(h, A, 'Prismatic Observer');
  h.do({ type: 'activateAbility', seat: A, entityId: obs, abilityIndex: 0 });
  const dec = h.state.decision;
  assert.ok(dec && dec.kind === 'targets', 'the sacrifice raised its target question');
  notOffered(h, { cached: { seat: B, uid: uid[B] } }, 'R291: the opponent is not in this region during deployment');
  assert.ok(offered(h).includes(JSON.stringify({ cached: { seat: A, uid: uid[A] } })),
    'my own cache entry is still offered');
});

test('R291 §3 the control: in battle the Observer reaches the opponent\'s cache, as printed', () => {
  const { h, uid } = twoCaches(2932);
  // the battle is fought in the DEFENDER's home region, so the defender's
  // Observer is the one standing where both seats are
  const A = h.state.deployPlayer!, B = (1 - A) as Seat;
  const obs = spawn(h, B, 'Prismatic Observer');
  const atk = spawn(h, A, 'Curio Drifter');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const region = h.state.battle!.region;
  assert.equal(region, h.q.homeRegion(B), 'the premise: the battle is in the defender\'s region');
  const refs = h.q.targetCandidates(SPEC, region, undefined, B).map(r => JSON.stringify(r));
  assert.ok(refs.includes(JSON.stringify({ cached: { seat: A, uid: uid[A] } })),
    'R41 still holds: in battle an opponent\'s nearly-fulfilled prophecy is exactly what the Observer answers');
  // and through the real action, at priority in the attack window
  if (h.state.priority !== B) pass(h);
  h.do({ type: 'activateAbility', seat: B, entityId: obs, abilityIndex: 0 });
  assert.equal(h.state.decision?.kind, 'targets', 'the sacrifice raised its target question');
  assert.ok(offered(h).includes(JSON.stringify({ cached: { seat: A, uid: uid[A] } })),
    'the opponent\'s cache entry is on the real menu during battle');
});
