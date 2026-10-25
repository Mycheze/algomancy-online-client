/**
 * CR 706.8c, 713.6, 714.9 / CT-363 — a "delete all …" effect deletes its
 * victims as ONE simultaneous batch, the same batch the state-based death
 * check uses.
 *
 * The five delete-all sweepers in the pool (found by sweeping the printed
 * text for "delete all": Ruinbringer, Ominous Growth, Deformant, Pathogenic
 * Enclave, Sporebloom Siren) used to loop `destroy` over their victims
 * themselves. `destroy` deletes a body before it announces, so each victim
 * was gone from the board before the next one died: an Ancient One deleted
 * after its neighbour no longer had that neighbour's "when I die" (CT-351's
 * snapshot never applied), and a disposal listener deleted first stopped
 * hearing the rest. They now go through `E.destroyBatch`.
 *
 * Witness: A Pile of Rubbish ("[Augment] When I die, draw a card.") on each
 * side of an Ancient One ("[Augment] I have all abilities of adjacent
 * allies."). Deleted together, the Ancient One borrows BOTH when-I-die lines.
 * The batch disposes in id order, so the left neighbour goes first; deleted
 * one at a time, only the right neighbour's line was borrowed.
 *
 * Seeds 66000-66099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { getCard, type EffectCtx, type EffectDef } from '../src/cards/dsl.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, finishBattle, pass, spawn, toDeployment, toNextBattle, withE } from './util.ts';

// the borrowed line is labelled with the borrower's name: "Ancient One (as A
// Pile of Rubbish): …", or "Unit Token (as A Pile of Rubbish): …" on a token
// wearing Ancient One
const BORROWED = '(as A Pile of Rubbish)';
const borrowedQueued = (h: Harness) =>
  h.state.triggerQueue.filter(t => t.label.includes(BORROWED)).length
  + h.state.stack.filter(it => (it.label ?? '').includes(BORROWED)).length;

test('CR 706.8c, 714.9 / CT-363: Ruinbringer after combat deletes an Ancient One with both neighbours in one batch, so it borrows both when-I-die lines', () => {
  const h = new Harness(66000);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const left = spawn(h, A, 'A Pile of Rubbish');
  const ancient = spawn(h, A, 'Ancient One');
  const right = spawn(h, A, 'A Pile of Rubbish');
  const ruin = spawn(h, A, 'Ruinbringer');           // "[Augment] After combat, delete all units."
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[left], [ancient], [right], [ruin]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                   // combat damage, then the after-combat step
  const ruinItem = () => h.state.stack.find(it => it.label?.includes('delete all units'));
  assert.ok(ruinItem(), 'Ruinbringer\'s after-combat trigger is on the stack');
  let guard = 20;
  while (ruinItem() && guard-- > 0) {
    if (h.state.decision) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
    else pass(h);
  }
  assert.ok(!ruinItem(), 'it resolved');
  assert.equal(ent(h, ancient), undefined, 'the Ancient One was deleted');
  assert.equal(ent(h, left), undefined, 'and both neighbours');
  assert.equal(borrowedQueued(h), 2, 'one borrowed "when I die" per neighbour, the earlier-deleted one included');
  finishBattle(h);
});

/** Three 3/3 tokens in three attacking columns, each with a -1/-1 counter:
 * the outer two wear A Pile of Rubbish, the middle one wears Ancient One.
 * Every one of the four other sweepers deletes all three. */
function tokenRow(seed: number): { h: Harness; A: Seat; ids: EntityId[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const ids: EntityId[] = [];
  withE(h, e => {
    for (const mod of ['A Pile of Rubbish', 'Ancient One', 'A Pile of Rubbish']) {
      const t = e.spawnUnit(A, 'Unit Token', e.homeRegion(A), { token: true, tokenStats: [3, 3] });
      e.attachMod(t, mod, A, 'augment');
      t.counters = -1;                                // for Sporebloom Siren
      ids.push(t.id);
    }
    e.settle();
  });
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: ids.map(id => [id]) });
  return { h, A, ids };
}

function runSweep(h: Harness, A: Seat, name: string, effect: EffectDef, extra: Partial<EffectCtx> = {}): void {
  withE(h, e => {
    effect.run(e, {
      controller: A, sourceName: name, region: h.state.battle!.region, targets: [],
      event: null, eraseSelf: () => {},
      choose: (_k: string, d: { options: { value: unknown }[] }) => d.options[0]!.value,
      ...extra,
    } as unknown as EffectCtx);
  });
}

const SWEEPS: [string, (h: Harness, A: Seat) => void][] = [
  ['Ominous Growth', (h, A) => runSweep(h, A, 'Ominous Growth', getCard('Ominous Growth').augmentText![0]!.effect)],
  ['Pathogenic Enclave', (h, A) => runSweep(h, A, 'Pathogenic Enclave', getCard('Pathogenic Enclave').augmentText![0]!.effect)],
  ['Sporebloom Siren', (h, A) => {
    const died = getCard('Sporebloom Siren').abilities!.find(a => a.type === 'triggered')!;
    runSweep(h, A, 'Sporebloom Siren', (died as { effect: EffectDef }).effect);
  }],
  ['Deformant', (h, A) => {
    // "Delete all units with cost equal to the total number of counters on us":
    // the two sacrificed carried no counters, so every cost-0 unit (each token) goes
    const e = new E(h.state);
    const total = 0;
    assert.ok(h.state.battle!.columns.flat().every(id => e.costOf(e.entity(id)!) === total), 'the tokens cost 0');
    runSweep(h, A, 'Deformant', (getCard('Deformant').abilities![0] as { effect: EffectDef }).effect, {
      costPaid: { sacrificedUnits: [] } as unknown as EffectCtx['costPaid'],
    });
  }],
];

for (const [name, sweep] of SWEEPS) {
  test(`CR 706.8c, 714.9 / CT-363: ${name} deletes its victims in one batch, so a deleted Ancient One borrows both neighbours`, () => {
    const { h, A, ids } = tokenRow(66001 + SWEEPS.findIndex(s => s[0] === name));
    sweep(h, A);
    for (const id of ids) assert.equal(ent(h, id), undefined, `${name} deleted every token in the row`);
    assert.equal(borrowedQueued(h), 2, 'one borrowed "when I die" per neighbour, the earlier-deleted one included');
  });
}
