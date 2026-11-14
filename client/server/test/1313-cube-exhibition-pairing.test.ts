/* Cube draft (docs/25 §7): exhibition pairing — two Ready players who have not met, the smallest
 * points gap first, then the longest combined wait; null when nobody can be paired.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairExhibition } from '../cube-tourney.ts';
import type { CubePlayer, Pairing } from '../cube-types.ts';

const NOW = 1_000_000;
const ready = (u: string, i: number, since = NOW - 1000): CubePlayer =>
  ({ user: u, name: u, joinedAt: i, ready: true, readySince: since });
let n = 0;
const won = (a: string, b: string, winner: string): Pairing =>
  ({ id: `x${++n}`, round: n, a, b, posted: true, result: { kind: 'win', winner, at: 1, by: 'play' } });

test('never a rematch; null when only met pairs remain', () => {
  const ps = [ready('a', 0), ready('b', 1), ready('c', 2)];
  const pr = [won('a', 'b', 'a'), won('a', 'c', 'c')];
  assert.deepEqual(pairExhibition(ps, pr, NOW), ['b', 'c']);
  assert.equal(pairExhibition(ps, [...pr, won('b', 'c', 'b')], NOW), null, 'everyone has met everyone');
});

test('prefers the closest record over the longest wait', () => {
  // a 6 pts, b 6 pts, c 0, d 0 — a/b and c/d have not met; c has waited far longer
  const ps = [ready('a', 0), ready('b', 1), ready('c', 2, NOW - 999_000), ready('d', 3)];
  const pr = [won('a', 'c', 'a'), won('a', 'd', 'a'), won('b', 'c', 'b'), won('b', 'd', 'b')];
  // only a–b and c–d have not met; both gap 0 → the longer combined wait: c–d
  assert.deepEqual(pairExhibition(ps, pr, NOW), ['c', 'd']);
  // e (0 pts, waited longest of all) joins: a–e gap 6 loses to c–e / d–e / c–d (gap 0)
  const ps2 = [...ps, ready('e', 4, NOW - 5_000_000)];
  const pick = pairExhibition(ps2, pr, NOW)!;
  assert.ok(pick.includes('e') && pick.includes('c'), `closest record, then longest wait: got ${pick}`);
});

test('the smallest points gap wins even when a bigger gap waited longer', () => {
  // a 3 pts (beat x), b 0 (lost to y), c 3 (beat z) — x/y/z not ready
  const ps: CubePlayer[] = [ready('a', 0, NOW - 900_000), ready('b', 1, NOW - 900_000), ready('c', 2, NOW - 10),
    { user: 'x', name: 'x', joinedAt: 3 }, { user: 'y', name: 'y', joinedAt: 4 }, { user: 'z', name: 'z', joinedAt: 5 }];
  const pr = [won('a', 'x', 'a'), won('b', 'y', 'y'), won('c', 'z', 'c')];
  assert.deepEqual(pairExhibition(ps, pr, NOW), ['a', 'c'], 'a–c (gap 0) over a–b (gap 3, longer wait)');
});

test('only ready, undropped players not already in an undecided match', () => {
  const ps: CubePlayer[] = [ready('a', 0), ready('b', 1), { ...ready('c', 2), ready: false }, { ...ready('d', 3), dropped: true }, ready('e', 4)];
  const live: Pairing = { id: 'x99', round: 99, a: 'a', b: 'q', posted: true, match: { id: 'M1', room: 'ABCD' } };
  assert.deepEqual(pairExhibition(ps, [live], NOW), ['b', 'e']);
  assert.equal(pairExhibition(ps.slice(0, 4), [live], NOW), null, 'b alone is free');
});

test('a full tie falls to players order, and the inputs are untouched', () => {
  const ps = [ready('a', 0), ready('b', 1), ready('c', 2), ready('d', 3)];
  const before = JSON.stringify(ps);
  assert.deepEqual(pairExhibition(ps, [], NOW), ['a', 'b']);
  assert.equal(JSON.stringify(ps), before);
});
