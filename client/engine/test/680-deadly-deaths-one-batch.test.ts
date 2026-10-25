/**
 * CR 608.7b, 713.6 / CT-413 — a unit killed by {Deadly} (or by the collapsed
 * Unaware reading, or by the Pure reading) dies in the SAME batch as the units
 * killed by lethal damage in the same damage sub-step, or by the same
 * effect-damage batch.
 *
 * CR 608.7b: "After a sub-step's damage has been dealt, units with lethal
 * damage, and units dealt damage by a Deadly source, are destroyed before the
 * next sub-step begins." CR 713.6: "Units that die in the same state check die
 * together."
 *
 * `sweepDeadly`, `sweepCollapsedDeaths`, `sweepPureDeaths` and the Deadly loop
 * of `dealEffectDamageAll` used to `destroy` their victims one at a time,
 * before and outside `checkDeaths`, so they never shared a batch with the
 * lethal-damage deaths beside them. They now only DECIDE who dies, and the
 * deaths are disposed in the one `destroyBatch` with the state check's
 * lethal set.
 *
 * Witness (as test 660): A Pile of Rubbish ("[Augment] When I die, draw a
 * card.") on each side of an Ancient One ("[Augment] I have all abilities of
 * adjacent allies."). Dying together, the Ancient One borrows BOTH
 * when-I-die lines; split into two batches, it loses the one that died first.
 *
 * Seeds 68000-68099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { EffectCtx } from '../src/cards/dsl.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, pass, spawn, toDeployment, toNextBattle, withE } from './util.ts';

const BORROWED = '(as A Pile of Rubbish)';
const borrowedQueued = (h: Harness) =>
  h.state.triggerQueue.filter(t => t.label.includes(BORROWED)).length
  + h.state.stack.filter(it => (it.label ?? '').includes(BORROWED)).length;

/** a token for `s` with the given stats, in its home region */
function token(h: Harness, s: Seat, p: number, t: number): EntityId {
  let id = -1;
  withE(h, g => { id = g.spawnUnit(s, 'Unit Token', g.homeRegion(s), { token: true, tokenStats: [p, t] }).id; });
  return id;
}

test('CR 608.7b, 713.6 / CT-413: a Deadly kill and two lethal-damage kills in one combat sub-step are one batch, so the Ancient One borrows both when-I-die lines', () => {
  const h = new Harness(68000);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const a0 = token(h, A, 1, 9), a1 = token(h, A, 5, 9), a2 = token(h, A, 5, 9);
  withE(h, g => g.addTempAttr(g.entity(a0)!, 'Deadly'));
  // the left blocker survives ordinary damage (0/3 dealt 1) and dies only to Deadly
  const left = token(h, D, 0, 3), ancient = spawn(h, D, 'Ancient One'), right = token(h, D, 0, 3);
  withE(h, g => {
    g.attachMod(g.entity(left)!, 'A Pile of Rubbish', D, 'augment');
    g.attachMod(g.entity(right)!, 'A Pile of Rubbish', D, 'augment');
  });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a0], [a1], [a2]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [left], 1: [ancient], 2: [right] } });
  pass(h); pass(h);                                   // the one (normal) damage sub-step
  for (const id of [left, ancient, right]) assert.equal(ent(h, id), undefined, 'all three blockers died');
  assert.equal(borrowedQueued(h), 2, 'one borrowed "when I die" per neighbour, the Deadly-killed one included');
});

test('CR 802.3e, 713.6 / CT-413: a Deadly effect dealing damage to a row kills it in one batch, so the Ancient One borrows both when-I-die lines', () => {
  const h = new Harness(68001);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const ids: EntityId[] = [];
  withE(h, e => {
    for (const mod of ['A Pile of Rubbish', 'Ancient One', 'A Pile of Rubbish']) {
      const t = e.spawnUnit(A, 'Unit Token', e.homeRegion(A), { token: true, tokenStats: [3, 3] });
      e.attachMod(t, mod, A, 'augment');
      ids.push(t.id);
    }
    e.settle();
  });
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: ids.map(id => [id]) });
  const g = new E(h.state);
  g.dealEffectDamageAll({
    controller: D, sourceName: 'Carapace Devourer', region: h.state.battle!.region, targets: [],
    event: null, eraseSelf: () => {},   // printed {Deadly}
    choose: () => { throw new Error('no choice expected'); },
  } as unknown as EffectCtx, ids.map(id => ({ target: g.entity(id)!, n: 1 })));
  h.state = g.s;
  for (const id of ids) assert.equal(ent(h, id), undefined, '1 Deadly damage killed every 3/3 token');
  assert.equal(borrowedQueued(h), 2, 'one borrowed "when I die" per neighbour, the earlier-killed one included');
});
