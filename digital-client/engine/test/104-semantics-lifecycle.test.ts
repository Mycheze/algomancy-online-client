/* CT-9 (semantics band): lifecycle-watcher cards — spawn/death/despawn/trash
 * triggers. The audit of this band found real behavior tests already standing
 * for 19 of its 20 cards (each drives the trigger through the engine and
 * asserts the printed payload; see the per-card files). What was NOT pinned
 * anywhere is Recyclable Sentinel's "…or die" branch actually PAYING OUT:
 * 08-cards2 drives the death only on the spawn turn, where the [Switch1]
 * budget is already spent, so the death branch has only ever been observed
 * being correctly BLOCKED (R9). This file pins the positive case — a fresh
 * turn's budget, a death, a second Robot. Seeds are 10400-10499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { effStats, ent, spawn, toDeployment, unitsOf } from './util.ts';

/** run raw engine calls against the harness state, absorbing a suspension */
function whiteBox(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state);
  try {
    fn(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
  h.events.push(...e.events);
  for (const ev of e.events) h.log.push(ev.msg);
}

// ── Recyclable Sentinel ──────────────────────────────────────────────────
//
// "When I spawn or die, [Switch1] Create a Robot 1."
//
// The spawn branch and the R9 same-turn bound are pinned in
// 08-cards2.test.ts. This is the death branch DELIVERING: on a later turn
// the [Switch1] budget is fresh, so the death itself must mint a Robot.

test('Recyclable Sentinel: dying on a LATER turn creates a second Robot 1 (fresh [Switch1] budget)', () => {
  const h = new Harness(10400);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const sent = spawn(h, p, 'Recyclable Sentinel');        // spawn branch → Robot #1
  assert.equal(unitsOf(h, p).filter(u => u.card === 'Robot').length, 1, 'spawn branch fired');

  // roll into the next turn's deployment: the R9 budget resets, the Robot
  // (a unit token) persists through regroup
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  toDeployment(h);
  assert.ok(ent(h, sent), 'the Sentinel survived regroup');
  assert.equal(unitsOf(h, p).filter(u => u.card === 'Robot').length, 1, 'still exactly one Robot');

  whiteBox(h, e => e.destroy(e.entity(sent)!, 'is deleted'));
  const robots = unitsOf(h, p).filter(u => u.card === 'Robot');
  assert.equal(robots.length, 2, 'the death branch created the second Robot');
  for (const r of robots) {
    assert.equal(r.counters, 1, 'a Robot 1 = 0/0 with one +1/+1 counter');
    assert.deepEqual(effStats(h, r.id), [1, 1]);
  }
  assert.ok(h.events.some(ev => ev.type === 'spawned' && ev.data?.card === 'Robot'),
    'the mint is a real spawn event, not log prose');
  assert.ok(h.state.players[p]!.bin.includes('Recyclable Sentinel'), 'the Sentinel itself was binned');
});
