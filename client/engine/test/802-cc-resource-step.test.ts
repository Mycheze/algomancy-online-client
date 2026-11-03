/* Competitive Constructed (doc 22 §3.2) — the draw phase and the resource step.
 *
 * CR 501.4: the draw step and the draft step happen for both players at once;
 * the resource step is taken first by the initiative player and then by the
 * other. CR 501.4a: no player begins the resource step until every player has
 * finished the draft step. The constructed draw-4/bottom-2 is the draw step and
 * the draft step together (CR 901.5), so it stays simultaneous in CC.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import { ccDecks as decks, ccGame, gateDisagreements, refused, types } from './cc-walk.ts';


const agree = (h: Harness, where: string): void => assert.deepEqual(gateDisagreements(h.state), [], where);

test('CC draw phase: both players bottom at once, the non-initiative player may go first', () => {
  const h = ccGame(0);
  assert.deepEqual(types(h.legal(0)), ['bottomCards']);
  assert.deepEqual(types(h.legal(1)), ['bottomCards'], 'the non-initiative player bottoms at the same time');
  agree(h, 'both bottoming');
  h.do({ type: 'bottomCards', seat: 1, handIndices: [0, 1] });
  assert.deepEqual(types(h.legal(0)), ['bottomCards']);
  agree(h, 'NIT has bottomed');
});

test('CC resource step: it opens only when both players have bottomed', () => {
  for (const first of [0, 1] as Seat[]) {
    const h = ccGame(0);
    h.do({ type: 'bottomCards', seat: first, handIndices: [0, 1] });
    assert.deepEqual(h.legal(first), [], `seat ${first} bottomed first: nothing until the other has`);
    refused(h, { type: 'recycleForResource', seat: first, handIndex: 0, element: 'fire' }, /not your planning/);
    refused(h, { type: 'donePlanning', seat: first }, /not your planning/);
    agree(h, `seat ${first} waiting for the other to bottom`);
    h.do({ type: 'bottomCards', seat: 1 - first, handIndices: [0, 1] });
    assert.equal(h.state.bottomDone, null);
    assert.ok(h.legal(0).some(a => a.type === 'donePlanning'), 'now the initiative player plans');
  }
});

test('CC resource step: the initiative player first, then the non-initiative player', () => {
  for (const int of [0, 1] as Seat[]) {
    const nit = 1 - int;
    const h = ccGame(int);
    h.do({ type: 'bottomCards', seat: 0, handIndices: [0, 1] });
    h.do({ type: 'bottomCards', seat: 1, handIndices: [0, 1] });
    assert.deepEqual(h.legal(nit), [], 'the NIT watches');
    assert.deepEqual(types(h.legal(int)), ['recycleForResource', 'activateResource', 'donePlanning']);
    // the reducer refuses the NIT's early play by the same predicate
    refused(h, { type: 'recycleForResource', seat: nit, handIndex: 0, element: 'fire' }, /not your planning/);
    refused(h, { type: 'activateResource', seat: nit, index: 0 }, /not your planning/);
    refused(h, { type: 'donePlanning', seat: nit }, /not your planning/);
    agree(h, 'INT planning');
    h.do({ type: 'activateResource', seat: int, index: 0 });
    h.do({ type: 'recycleForResource', seat: int, handIndex: 0, element: 'water' });
    agree(h, 'INT mid-step');
    h.do({ type: 'donePlanning', seat: int });
    assert.equal(h.state.hasteDone, null, 'still the resource step');
    assert.deepEqual(h.legal(int), [], 'the INT is done and watches');
    assert.ok(h.legal(nit).some(a => a.type === 'recycleForResource'), 'the NIT plans now');
    refused(h, { type: 'activateResource', seat: int, index: 1 }, /not your planning/);
    agree(h, 'NIT planning');
    h.do({ type: 'donePlanning', seat: nit });
    assert.deepEqual(h.state.hasteDone, [false, false], 'the haste step opens after both');
  }
});

test('CC resource step: the same moves in a house-rules game are simultaneous (unchanged)', () => {
  const h = new Harness(42, ['Ann', 'Bob'], 'constructed', undefined, decks());
  h.do({ type: 'bottomCards', seat: 1, handIndices: [0, 1] });
  assert.ok(h.legal(1).some(a => a.type === 'donePlanning'), 'a seat that has bottomed may start at once');
  const nit = 1 - h.state.initiative;
  h.do({ type: 'bottomCards', seat: 0, handIndices: [0, 1] });
  h.do({ type: 'donePlanning', seat: nit });
  assert.equal(h.state.planningDone[nit], true, 'the NIT may finish before the INT');
});
