/* Cube draft (docs/25 §7): the host's swap — two players trade places between a round's un-started
 * pairings, the bye included; refused once either match has a room or a result.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swapPlayers } from '../cube-tourney.ts';
import type { Pairing } from '../cube-types.ts';

const round = (): Pairing[] => [
  { id: 'r2p1', round: 2, a: 'a', b: 'b', posted: false },
  { id: 'r2p2', round: 2, a: 'c', b: 'd', posted: false },
  { id: 'r2p3', round: 2, a: 'e', b: null, posted: false, result: { kind: 'bye', at: 0, by: 'play' } },
  { id: 'r1p1', round: 1, a: 'a', b: 'c', posted: true, result: { kind: 'win', winner: 'a', at: 1, by: 'play' } },
];
const ok = (r: Pairing[] | { error: string }): Pairing[] => {
  assert.ok(Array.isArray(r), `expected pairings, got ${JSON.stringify(r)}`);
  return r;
};

test('swaps two players between pairings, returning a new array', () => {
  const pr = round();
  const before = JSON.stringify(pr);
  const out = ok(swapPlayers(pr, 2, 'b', 'c'));
  assert.deepEqual(out.slice(0, 2).map(p => [p.a, p.b]), [['a', 'c'], ['b', 'd']]);
  assert.equal(JSON.stringify(pr), before, 'input untouched');
  assert.notEqual(out[0], pr[0]);
});

test('moves someone onto and off the bye', () => {
  const out = ok(swapPlayers(round(), 2, 'a', 'e'));
  assert.deepEqual(out.slice(0, 3).map(p => [p.a, p.b]), [['e', 'b'], ['c', 'd'], ['a', null]]);
  assert.deepEqual(out[2]!.result, { kind: 'bye', at: 0, by: 'play' }, 'the bye stays a bye, now for a');
});

test('refuses a started or decided match, a stranger, or the same match', () => {
  const started = round();
  started[1] = { ...started[1]!, posted: true, match: { id: 'M1', room: 'ROOM' } };
  assert.ok('error' in swapPlayers(started, 2, 'a', 'c'));
  assert.ok('error' in swapPlayers(started, 2, 'd', 'e'));
  const decided = round();
  decided[0] = { ...decided[0]!, posted: true, result: { kind: 'draw', at: 1, by: 'host' } };
  assert.ok('error' in swapPlayers(decided, 2, 'a', 'c'));
  assert.ok('error' in swapPlayers(round(), 2, 'a', 'zz'), 'not in the round');
  assert.ok('error' in swapPlayers(round(), 1, 'a', 'b'), 'round 1 is decided; b is not in it');
  assert.ok('error' in swapPlayers(round(), 2, 'a', 'b'), 'already facing each other');
  assert.ok('error' in swapPlayers(round(), 2, 'a', 'a'));
});

test('posted but un-started pairings may still be swapped', () => {
  const pr = round().map(p => (p.round === 2 ? { ...p, posted: true } : p));
  const out = ok(swapPlayers(pr, 2, 'a', 'd'));
  assert.deepEqual(out.slice(0, 2).map(p => [p.a, p.b]), [['d', 'b'], ['c', 'a']]);
});
