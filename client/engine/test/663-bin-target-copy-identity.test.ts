/**
 * CR 405.6b / CT-380 — A BIN TARGET NAMES ONE COPY, AND FOLLOWS THAT COPY.
 *
 * CR 405.6b: "If that copy has left the bin, the effect finds nothing. It never
 * takes a different copy of the same name." A declared bin target is a BinRef
 * (seat, card, nth). `E.binIndexOf` read it against the live bin and, when the
 * nth copy was not there any more, fell back to the last copy left — and the
 * nth itself slid when an earlier copy left. Measured before the fix with two
 * copies of Just a Unit in one bin and two Collect Remains (A casts, D answers):
 *
 *   A aims at | D takes | A got            | right answer
 *   copy 2    | copy 2  | copy 1 (wrong)   | nothing
 *   copy 1    | copy 1  | copy 2 (wrong)   | nothing
 *   copy 2    | copy 1  | copy 2 (right)   | copy 2
 *   copy 1    | copy 2  | copy 1 (right)   | copy 1
 *
 * The ticket's proposed fix (return -1 when the nth copy is missing) fixes row
 * one, leaves row two wrong, and breaks row three, because (name, nth) names a
 * different physical card after an EARLIER copy leaves. The fix keeps every
 * live ref pointing at its copy instead: `E.removeFromBin` (the one bin exit,
 * CR 405.7) re-indexes the BinRefs the stack, the resolving item and the cast
 * window hold — the removed copy's refs become gone, later copies' refs move
 * down one — and `binIndexOf` has no fallback left to need.
 *
 * The copies are told apart by OWNER (CR 102.4 / CT-233): the second one is A
 * card sitting in D bin, so the hand owner says which copy A took.
 *
 * Seeds: 66300-66349.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import '../src/index.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { BinRef, Seat } from '../src/types.ts';
import { finishBattle, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';

const X = 'Just a Unit';

/** A battle with A holding priority, and D bin = [X (D card), Shard Sprite, X (A card)] */
function setup(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  for (const s of [A, D]) {
    h.state.players[s]!.hand = h.state.players[s]!.hand.filter(c => c !== X);
    delete h.state.players[s]!.foreign;
  }
  const p = h.state.players[D]!;
  p.bin.length = 0;
  p.bin.push(X, 'Shard Sprite', X);
  p.foreign = [{ zone: 'bin', at: 2, card: X, owner: A }];
  giveResources(h, A, 'dark', 2);
  giveResources(h, D, 'dark', 2);
  return { h, A, D };
}

const ref = (seat: Seat, nth: number): { bin: BinRef } => ({ bin: { seat, card: X, ...(nth ? { nth } : {}) } });

/** A casts Collect Remains at copy `aNth`, D answers with one at copy `dNth`, both resolve */
function duel(seed: number, aNth: number, dNth: number): { h: Harness; A: Seat; D: Seat } {
  const s = setup(seed);
  const { h, A, D } = s;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Collect Remains') });
  pick(h, ref(D, aNth));
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Collect Remains') });
  pick(h, ref(D, dNth));
  pass(h); pass(h);                                  // D Collect Remains resolves
  return s;
}

/** the owners of the copies of X in `seat` hand */
function handCopies(h: Harness, seat: Seat): Seat[] {
  const e = new E(h.state);
  return h.state.players[seat]!.hand.flatMap((c, i) => c === X ? [e.zoneOwner(seat, 'hand', i)] : []);
}

test('CR 405.6b / CT-380: the second copy targeted and taken in response leaves the first copy alone', () => {
  const { h, A, D } = duel(66301, 1, 1);
  assert.deepEqual(handCopies(h, D), [A], 'D took copy 2 (A card)');
  pass(h); pass(h);                                  // A Collect Remains resolves
  assert.deepEqual(handCopies(h, A), [], 'A finds nothing: its copy is gone (it used to take copy 1)');
  assert.deepEqual(h.state.players[D]!.bin, [X, 'Shard Sprite'], 'and copy 1 is still in the bin');
  finishBattle(h);
});

test('CR 405.6b / CT-380: the first copy targeted and taken in response does not slide onto the second', () => {
  const { h, A, D } = duel(66302, 0, 0);
  assert.deepEqual(handCopies(h, D), [D], 'D took copy 1 (D card)');
  const aim = h.state.stack.at(-1)!.parts[0]!.targets[0]!;
  assert.equal(new E(h.state).targetStillLegal(aim), false, 'the stack already shows the target as gone');
  pass(h); pass(h);
  assert.deepEqual(handCopies(h, A), [], 'A finds nothing (it used to take copy 2, the next copy of the name)');
  assert.deepEqual(h.state.players[D]!.bin, ['Shard Sprite', X], 'and copy 2 is still in the bin');
  finishBattle(h);
});

test('CR 405.6b / CT-380: an earlier copy leaving does not lose the target, which is still the same card', () => {
  const { h, A, D } = duel(66303, 1, 0);
  assert.deepEqual(handCopies(h, D), [D], 'D took copy 1');
  const aim = h.state.stack.at(-1)!.parts[0]!.targets[0]! as { bin: BinRef };
  assert.equal(new E(h.state).binIndexOf(aim.bin), 1, 'the ref follows its copy down the pile');
  pass(h); pass(h);
  assert.deepEqual(handCopies(h, A), [A], 'A gets the copy it aimed at, its own card');
  finishBattle(h);
});

test('CR 405.6b / CT-380: a later copy leaving does not move the target', () => {
  const { h, A, D } = duel(66304, 0, 1);
  assert.deepEqual(handCopies(h, D), [A], 'D took copy 2');
  pass(h); pass(h);
  assert.deepEqual(handCopies(h, A), [D], 'A gets copy 1, D card, still owned by D');
  finishBattle(h);
});

test('CR 405.6b / CT-380: a ref whose copy has gone resolves to no index at all', () => {
  const { h, D } = setup(66305);
  const e = new E(h.state);
  assert.equal(e.binIndexOf({ seat: D, card: X, nth: 2 }), -1, 'there is no third copy, and no fallback to the last one');
  assert.equal(e.binIndexOf({ seat: D, card: X, nth: -1 }), -1, 'a ref marked gone stays gone');
  assert.equal(e.binIndexOf({ seat: D, card: X, nth: 1 }), 2);
});
