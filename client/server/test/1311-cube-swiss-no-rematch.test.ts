/* Cube draft (docs/25 §7): Swiss pairing never pairs a rematch when a no-rematch pairing exists.
 *
 * Three ways: 3 rounds of 8 over 200 seeds with random results (wins and draws); a brute-force
 * oracle on random histories of 6 and 8 (pairSwiss finds a clean pairing exactly when one exists);
 * and 16 players over 7 rounds stays fast. Plus: round 2+ pairs top-down through the standings.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairSwiss, standings } from '../cube-tourney.ts';
import { rngNext } from '../../engine/src/rng.ts';
import type { CubePlayer, Pairing } from '../cube-types.ts';

const players = (n: number): CubePlayer[] =>
  Array.from({ length: n }, (_, i) => ({ user: `u${i}`, name: `P${i}`, joinedAt: i }));
const key = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** post a round and give every match a random result */
function playRound(round: Pairing[], rand: () => number): Pairing[] {
  return round.map(p => {
    if (p.b === null) return { ...p, posted: true };
    const r = rand();
    const result = r < 0.1
      ? { kind: 'draw' as const, games: [1, 1] as [number, number], at: 1, by: 'host' as const }
      : { kind: 'win' as const, winner: r < 0.55 ? p.a : p.b, games: (rand() < 0.5 ? [2, 0] : [2, 1]) as [number, number], at: 1, by: 'play' as const };
    if (result.kind === 'win' && result.winner === p.b) result.games = [result.games[1], result.games[0]];
    return { ...p, posted: true, result };
  });
}
const mkRand = (seed: number): (() => number) => { let s = seed; return () => { const [r, n] = rngNext(s); s = n; return r; }; };

function assertWellFormed(round: Pairing[], ps: CubePlayer[], r: number): void {
  const seen = new Set<string>();
  for (const p of round) {
    assert.equal(p.round, r);
    assert.equal(p.posted, false);
    for (const u of [p.a, p.b]) if (u !== null) { assert.ok(!seen.has(u), `${u} twice`); seen.add(u); }
  }
  assert.equal(seen.size, ps.filter(p => !p.dropped).length, 'everyone active is in the round');
  assert.deepEqual(round.map(p => p.id), round.map((_, i) => `r${r}p${i + 1}`));
}

test('8 players × 3 rounds × 200 seeds: never a rematch', () => {
  const ps = players(8);
  for (let seed = 1; seed <= 200; seed++) {
    const rand = mkRand(seed * 7919);
    let all: Pairing[] = [];
    const met = new Set<string>();
    for (let r = 1; r <= 3; r++) {
      const round = pairSwiss(ps, all, r, seed);
      assertWellFormed(round, ps, r);
      for (const p of round) {
        if (p.b === null) continue;
        assert.ok(!met.has(key(p.a, p.b)), `seed ${seed} round ${r}: rematch ${p.a}–${p.b}`);
        met.add(key(p.a, p.b));
      }
      all = [...all, ...playRound(round, rand)];
    }
  }
});

/** does any perfect matching of `ids` avoid `met`? */
function cleanExists(ids: string[], met: Set<string>): boolean {
  if (ids.length === 0) return true;
  const [x, ...rest] = ids;
  return rest.some((y, j) => !met.has(key(x!, y)) && cleanExists(rest.filter((_, k) => k !== j), met));
}

test('brute-force oracle: a clean pairing is found exactly when one exists (random histories, n = 6 and 8)', () => {
  let impossible = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const n = seed % 2 ? 6 : 8;
    const ps = players(n);
    const rand = mkRand(seed * 104729);
    // a random history: 2–4 random rounds (rematches allowed in the history) so some cases are impossible
    const rounds = 2 + Math.floor(rand() * 3);
    let hist: Pairing[] = [];
    for (let r = 1; r <= rounds; r++) {
      const order = ps.map(p => p.user).sort(() => rand() - 0.5);
      const round: Pairing[] = [];
      for (let i = 0; i < n; i += 2) round.push({ id: `h${r}p${i}`, round: r, a: order[i]!, b: order[i + 1]!, posted: false });
      hist = [...hist, ...playRound(round, rand)];
    }
    const met = new Set(hist.map(p => key(p.a, p.b!)));
    const next = pairSwiss(ps, hist, rounds + 1, seed);
    assertWellFormed(next, ps, rounds + 1);
    const clean = next.every(p => p.b === null || !met.has(key(p.a, p.b)));
    const exists = cleanExists(ps.map(p => p.user), met);
    if (!exists) impossible++;
    assert.equal(clean, exists, `seed ${seed}: found clean=${clean}, exists=${exists}`);
  }
  assert.ok(impossible > 0, 'the oracle test covered at least one impossible case');
});

test('round 2+: pairs top-down through the standings (1 v 2, 3 v 4 … when nobody has met)', () => {
  const ps = players(8);
  // round 1: u0 beat u1, u2 beat u3, u4 beat u5, u6 beat u7 (Bo1)
  const r1: Pairing[] = [0, 2, 4, 6].map((i, k) => ({
    id: `r1p${k + 1}`, round: 1, a: `u${i}`, b: `u${i + 1}`, posted: true,
    result: { kind: 'win', winner: `u${i}`, at: 1, by: 'play' },
  }));
  const order = standings(ps, r1).map(r => r.user);
  const r2 = pairSwiss(ps, r1, 2, 5);
  // the four winners on 3 points pair among themselves, and the losers among themselves
  const winners = new Set(['u0', 'u2', 'u4', 'u6']);
  for (const p of r2) assert.equal(winners.has(p.a), winners.has(p.b!), `${p.a}–${p.b} crosses the points groups`);
  assert.deepEqual(r2.map(p => [p.a, p.b]), [[order[0], order[1]], [order[2], order[3]], [order[4], order[5]], [order[6], order[7]]]);
});

test('a rematch only when nothing else is possible (4 players, round 4)', () => {
  const ps = players(4);
  let all: Pairing[] = [];
  const rand = mkRand(3);
  for (let r = 1; r <= 3; r++) all = [...all, ...playRound(pairSwiss(ps, all, r, 9), rand)];
  const met = new Set(all.map(p => key(p.a, p.b!)));
  assert.equal(met.size, 6, 'three rounds of four is every pair once');
  const r4 = pairSwiss(ps, all, 4, 9);
  assertWellFormed(r4, ps, 4);
  assert.equal(r4.length, 2, 'still paired, with rematches');
});

test('16 players over 7 rounds stays fast', () => {
  const ps = players(16);
  const rand = mkRand(16);
  let all: Pairing[] = [];
  const t0 = performance.now();
  for (let r = 1; r <= 7; r++) {
    const round = pairSwiss(ps, all, r, 16);
    assertWellFormed(round, ps, r);
    all = [...all, ...playRound(round, rand)];
  }
  assert.ok(performance.now() - t0 < 2000, 'seven rounds of sixteen in under 2 s');
});

test('round 1 is the seed: same seed same pairing, and pairSwiss never mutates its inputs', () => {
  const ps = players(8);
  const before = JSON.stringify(ps);
  assert.deepEqual(pairSwiss(ps, [], 1, 42), pairSwiss(ps, [], 1, 42));
  const seeds = new Set(Array.from({ length: 20 }, (_, s) => JSON.stringify(pairSwiss(ps, [], 1, s))));
  assert.ok(seeds.size > 1, 'different seeds give different round-1 pairings');
  const hist = playRound(pairSwiss(ps, [], 1, 42), mkRand(1));
  const h = JSON.stringify(hist);
  pairSwiss(ps, hist, 2, 42);
  assert.equal(JSON.stringify(ps), before);
  assert.equal(JSON.stringify(hist), h);
});
