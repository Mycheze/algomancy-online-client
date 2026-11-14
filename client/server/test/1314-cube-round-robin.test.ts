/* Cube draft (docs/25 §7): the round-robin schedule — every pair exactly once, nobody twice in a
 * schedule round, no bye pairings (an odd count just sits one player out a round).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundRobin } from '../cube-tourney.ts';
import type { CubePlayer } from '../cube-types.ts';

const players = (n: number): CubePlayer[] =>
  Array.from({ length: n }, (_, i) => ({ user: `u${i}`, name: `P${i}`, joinedAt: i }));
const key = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`);

for (let n = 2; n <= 8; n++) {
  test(`n = ${n}: every pair once, nobody twice in a round`, () => {
    for (const seed of [1, 2, 3, 99]) {
      const s = roundRobin(players(n), seed);
      assert.equal(s.length, n * (n - 1) / 2);
      assert.ok(s.every(p => p.b !== null && !p.posted && !p.result), 'no byes, unposted, undecided');
      assert.equal(new Set(s.map(p => key(p.a, p.b!))).size, s.length, 'no pair twice');
      const rounds = n % 2 ? n : n - 1;
      assert.equal(Math.max(...s.map(p => p.round)), rounds);
      for (let r = 1; r <= rounds; r++) {
        const inR = s.filter(p => p.round === r);
        const seen = inR.flatMap(p => [p.a, p.b!]);
        assert.equal(new Set(seen).size, seen.length, `round ${r}: someone twice`);
        assert.equal(inR.length, Math.floor(n / 2));
        assert.deepEqual(inR.map(p => p.id), inR.map((_, i) => `rr${r}p${i + 1}`));
      }
      assert.equal(new Set(s.map(p => p.id)).size, s.length, 'ids unique');
    }
  });
}

test('dropped players are left out; the seed decides the schedule', () => {
  const ps = players(6);
  ps[2] = { ...ps[2]!, dropped: true };
  const s = roundRobin(ps, 5);
  assert.equal(s.length, 10);
  assert.ok(s.every(p => p.a !== 'u2' && p.b !== 'u2'));
  assert.deepEqual(roundRobin(ps, 5), s);
  assert.ok(new Set([1, 2, 3, 4, 5, 6].map(x => JSON.stringify(roundRobin(ps, x)))).size > 1);
});
