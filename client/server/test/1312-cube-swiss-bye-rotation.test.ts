/* Cube draft (docs/25 §7): the Swiss bye. Odd count → the lowest-ranked player who has not had one;
 * if all have, the lowest-ranked. The bye comes pre-resulted and counts once posted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairSwiss, standings } from '../cube-tourney.ts';
import { rngNext } from '../../engine/src/rng.ts';
import type { CubePlayer, Pairing } from '../cube-types.ts';

const players = (n: number): CubePlayer[] =>
  Array.from({ length: n }, (_, i) => ({ user: `u${i}`, name: `P${i}`, joinedAt: i }));
const mkRand = (seed: number): (() => number) => { let s = seed; return () => { const [r, n] = rngNext(s); s = n; return r; }; };
const post = (round: Pairing[], rand: () => number): Pairing[] => round.map(p => p.b === null
  ? { ...p, posted: true }
  : { ...p, posted: true, result: { kind: 'win', winner: rand() < 0.5 ? p.a : p.b, at: 1, by: 'play' } });

test('7 players over 3 rounds: three different players get the bye (100 seeds)', () => {
  const ps = players(7);
  for (let seed = 1; seed <= 100; seed++) {
    const rand = mkRand(seed);
    let all: Pairing[] = [];
    const byes: string[] = [];
    for (let r = 1; r <= 3; r++) {
      const round = pairSwiss(ps, all, r, seed);
      const bye = round.filter(p => p.b === null);
      assert.equal(bye.length, 1, 'exactly one bye');
      assert.equal(round.length, 4);
      assert.equal(bye[0], round[round.length - 1], 'the bye is listed last');
      assert.deepEqual(bye[0]!.result, { kind: 'bye', at: 0, by: 'play' }, 'pre-resulted');
      byes.push(bye[0]!.a);
      all = [...all, ...post(round, rand)];
    }
    assert.equal(new Set(byes).size, 3, `seed ${seed}: byes ${byes.join(',')}`);
  }
});

test('the bye goes to the lowest-ranked player without one', () => {
  const ps = players(5);
  // round 1: u0 beat u1, u2 beat u3, u4 bye  → standings: u4 (bye 2–0) and the winners on 3, losers on 0
  const r1: Pairing[] = [
    { id: 'r1p1', round: 1, a: 'u0', b: 'u1', posted: true, result: { kind: 'win', winner: 'u0', at: 1, by: 'play' } },
    { id: 'r1p2', round: 1, a: 'u2', b: 'u3', posted: true, result: { kind: 'win', winner: 'u2', at: 1, by: 'play' } },
    { id: 'r1p3', round: 1, a: 'u4', b: null, posted: true, result: { kind: 'bye', at: 0, by: 'play' } },
  ];
  const order = standings(ps, r1).map(r => r.user);
  const r2 = pairSwiss(ps, r1, 2, 1);
  const bye = r2.find(p => p.b === null)!;
  assert.equal(bye.a, order[order.length - 1], 'the bottom of the table');
  assert.notEqual(bye.a, 'u4');
});

test('when everyone has had a bye, the lowest-ranked gets it again', () => {
  const ps = players(3);
  let all: Pairing[] = [];
  const rand = mkRand(77);
  for (let r = 1; r <= 3; r++) all = [...all, ...post(pairSwiss(ps, all, r, 4), rand)];
  assert.equal(new Set(all.filter(p => p.b === null).map(p => p.a)).size, 3, 'all three have had one');
  const order = standings(ps, all).map(r => r.user);
  const r4 = pairSwiss(ps, all, 4, 4);
  assert.equal(r4.find(p => p.b === null)!.a, order[2]);
});

test('the bottom player already had a bye: it skips up to the lowest who has not', () => {
  const ps = players(5);
  const w = (id: string, r: number, a: string, b: string): Pairing =>
    ({ id, round: r, a, b, posted: true, result: { kind: 'win', winner: a, at: 1, by: 'play' } });
  const bye = (id: string, r: number, a: string): Pairing =>
    ({ id, round: r, a, b: null, posted: true, result: { kind: 'bye', at: 0, by: 'play' } });
  // Rd1 u0>u1 u2>u3 u4 bye · Rd2 u0>u4 u1>u2 u3 bye · Rd3 u1>u4 u0>u3 u2 bye
  // points u0 9, u1 6, u2 6, u3 3, u4 3; u3/u4 tie on OMW (.833) and GW (.5); OGW u3 .875 > u4 .833
  const hist = [w('a', 1, 'u0', 'u1'), w('b', 1, 'u2', 'u3'), bye('c', 1, 'u4'),
    w('d', 2, 'u0', 'u4'), w('e', 2, 'u1', 'u2'), bye('f', 2, 'u3'),
    w('g', 3, 'u1', 'u4'), w('h', 3, 'u0', 'u3'), bye('i', 3, 'u2')];
  const order = standings(ps, hist).map(r => r.user);
  assert.equal(order[4], 'u4', 'precondition: u4 is bottom, and had a bye');
  assert.ok(order.indexOf('u1') > order.indexOf('u0'), 'u1 is the lowest of the two without one');
  const r4 = pairSwiss(ps, hist, 4, 1);
  assert.equal(r4.find(p => p.b === null)!.a, 'u1');
});
