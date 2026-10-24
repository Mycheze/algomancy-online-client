/**
 * CR 714.9, 710.7 / CT-351 — in a simultaneous death batch, a dying Ancient
 * One has the text of every ally it stood beside as the batch began, the
 * ones disposed before it included.
 *
 * checkDeaths disposes the batch one body at a time. The died event's
 * `adjacent` fact was read off the grid as each body went, so a neighbour
 * disposed earlier in the same batch was already out of the grid (and out of
 * the entity table) when the Ancient One's turn came, and its "when I die"
 * was not borrowed. CR 714.9 fixes the facts as the units leave play, and in
 * a simultaneous batch that is before any of them has left.
 *
 * Seeds 62700-62799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, finishBattle, spawn, toDeployment, toNextBattle, withE } from './util.ts';

const borrowedQueued = (h: Harness) =>
  h.state.triggerQueue.filter(t => t.label.startsWith('Ancient One (as A Pile of Rubbish)')).length;

function killTogether(h: Harness, ids: EntityId[]): void {
  withE(h, e => {
    for (const id of ids) e.entity(id)!.damage = 99;
    e.checkDeaths();
  });
}

test('CR 714.9, 710.7 / CT-351: an Ancient One dying in one batch with both neighbours borrows both when-I-die lines', () => {
  const h = new Harness(62700);
  toDeployment(h);
  const A = h.state.initiative;
  // A Pile of Rubbish: "[Augment] When I die, draw a card." The left one has
  // the lower id, so the batch disposes it before the Ancient One.
  const left = spawn(h, A, 'A Pile of Rubbish');
  const ancient = spawn(h, A, 'Ancient One');
  const right = spawn(h, A, 'A Pile of Rubbish');
  spawn(h, (1 - A) as Seat, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[left], [ancient], [right]] });
  killTogether(h, [left, ancient, right]);
  assert.equal(ent(h, ancient), undefined, 'all three died together');
  assert.equal(borrowedQueued(h), 2, 'one borrowed "when I die" per neighbour, the earlier-disposed one included');
  finishBattle(h);
});

test('CR 714.9, 710.7 / CT-351: a neighbour killed alone first is not borrowed by a later death', () => {
  const h = new Harness(62701);
  toDeployment(h);
  const A = h.state.initiative;
  const left = spawn(h, A, 'A Pile of Rubbish');
  const ancient = spawn(h, A, 'Ancient One');
  const right = spawn(h, A, 'Unit Token');
  spawn(h, (1 - A) as Seat, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[left], [ancient], [right]] });
  killTogether(h, [left]);
  const before = borrowedQueued(h);
  killTogether(h, [ancient]);
  assert.equal(borrowedQueued(h), before, 'two separate deaths: the Rubbish was gone before the Ancient One died');
  finishBattle(h);
});

test('CR 714.9, 710.7 / CT-351: a batch-mate neighbour lends the when-I-die text of the mod it wore', () => {
  const h = new Harness(62702);
  toDeployment(h);
  const A = h.state.initiative;
  const left = spawn(h, A, 'Unit Token');
  const ancient = spawn(h, A, 'Ancient One');
  const right = spawn(h, A, 'Unit Token');
  spawn(h, (1 - A) as Seat, 'Unit Token');
  withE(h, e => { e.attachMod(e.entity(left)!, 'A Pile of Rubbish', A, 'augment'); });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[left], [ancient], [right]] });
  killTogether(h, [left, ancient, right]);
  assert.equal(borrowedQueued(h), 1, 'the token disposed first still wore its Rubbish as the batch died');
  finishBattle(h);
});

test('CR 714.9, 710.7 / CT-351: a dying Ancient One borrows through a second Ancient One disposed earlier in the same batch', () => {
  const h = new Harness(62703);
  toDeployment(h);
  const A = h.state.initiative;
  // ids in disposal order: the Rubbish, the near Ancient One, then the far one
  const rubbish = spawn(h, A, 'A Pile of Rubbish');
  const near = spawn(h, A, 'Ancient One');
  const far = spawn(h, A, 'Ancient One');
  spawn(h, (1 - A) as Seat, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[rubbish], [near], [far]] });
  killTogether(h, [rubbish, near, far]);
  assert.equal(ent(h, far), undefined, 'all three died together');
  assert.equal(borrowedQueued(h), 2,
    'the near one borrows the Rubbish directly, the far one through the near one (the designer: "adjacent to either")');
  finishBattle(h);
});

test('CR 714.9, 710.7 / CT-351: a batch-mate that wore Ancient One as a mod still passes its neighbours text on', () => {
  const h = new Harness(62704);
  toDeployment(h);
  const A = h.state.initiative;
  const rubbish = spawn(h, A, 'A Pile of Rubbish');
  const carrier = spawn(h, A, 'Unit Token');
  const ancient = spawn(h, A, 'Ancient One');
  spawn(h, (1 - A) as Seat, 'Unit Token');
  withE(h, e => { e.attachMod(e.entity(carrier)!, 'Ancient One', A, 'augment'); });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[rubbish], [carrier], [ancient]] });
  killTogether(h, [rubbish, carrier, ancient]);
  assert.equal(ent(h, ancient), undefined, 'all three died together');
  assert.equal(borrowedQueued(h), 1,
    'the Ancient One reaches the Rubbish through the token that wore the Ancient One mod, disposed before it');
  finishBattle(h);
});
