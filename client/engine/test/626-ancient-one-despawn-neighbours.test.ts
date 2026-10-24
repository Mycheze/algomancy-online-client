/**
 * CR 721.1f, 714.9, 710.7 / CT-350 — an Ancient One that leaves play WITHOUT
 * dying still has the text of the allies it stood beside, so a borrowed
 * "[Augment] When I despawn" fires for it.
 *
 * Report 271 gave the 'died' event the allies a dying unit stood beside, read
 * off the grid before the gap closes. A recall or a cache carried no such
 * list: leavePlay closes the grid first, so a recalled or cached Ancient One
 * had no neighbours and its borrowed "when I despawn" was silent. CR 721.1f:
 * such text triggers whichever way the unit leaves play.
 *
 * Seeds 62600-62699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import { ent, finishBattle, spawn, toDeployment, toNextBattle, withE } from './util.ts';

/** Ancient One between A Pile of Runes ("[Augment] When I despawn, create a
 * Crystal X, where X is my defense.") and a plain token, in a battle line */
function board(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative;
  const runes = spawn(h, A, 'A Pile of Runes');
  const ancient = spawn(h, A, 'Ancient One');
  const other = spawn(h, A, 'Unit Token');
  spawn(h, (1 - A) as Seat, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[runes], [ancient], [other]] });
  return { h, A, runes, ancient };
}
const borrowed = (h: Harness) => h.state.triggerQueue.filter(t => t.label.startsWith('Ancient One (as A Pile of Runes)')).length
  + h.state.stack.filter(i => (i.label ?? '').startsWith('Ancient One (as A Pile of Runes)')).length;

test('CR 721.1f, 714.9 / CT-350: a recalled Ancient One has the when-I-despawn text of the ally it stood beside', () => {
  const { h, ancient } = board(62600);
  withE(h, e => { e.recall(e.entity(ancient)!); });
  assert.equal(ent(h, ancient), undefined, 'the Ancient One is back in hand');
  assert.equal(borrowed(h), 1, 'one borrowed "when I despawn" trigger, from the Pile of Runes beside it');
  finishBattle(h);
});

test('CR 721.1f, 714.9 / CT-350: a cached Ancient One has the when-I-despawn text of the ally it stood beside', () => {
  const { h, ancient } = board(62601);
  withE(h, e => { e.cacheUnit(e.entity(ancient)!); });
  assert.equal(ent(h, ancient), undefined, 'the Ancient One is in the cache');
  assert.equal(borrowed(h), 1, 'one borrowed "when I despawn" trigger, from the Pile of Runes beside it');
  finishBattle(h);
});

test('CR 721.1f, 714.9 / CT-350: a recalled Ancient One does not borrow from a unit that was never beside it', () => {
  const { h, ancient, runes } = board(62602);
  void runes;
  // move the Runes away first: a fresh line with the Ancient One at the far end
  withE(h, e => { e.recall(e.entity(runes)!); });
  const before = borrowed(h);
  withE(h, e => { e.recall(e.entity(ancient)!); });
  assert.equal(borrowed(h), before, 'no Runes beside it any more, nothing borrowed');
  finishBattle(h);
});

test('CR 721.1f, 714.9 / CT-350: an erased Ancient One has the when-I-despawn text of the ally it stood beside', () => {
  const { h, ancient } = board(62603);
  withE(h, e => { e.eraseFromPlay(e.entity(ancient)!); });
  assert.equal(ent(h, ancient), undefined, 'the Ancient One is erased');
  assert.equal(borrowed(h), 1, 'one borrowed "when I despawn" trigger, from the Pile of Runes beside it');
  finishBattle(h);
});
