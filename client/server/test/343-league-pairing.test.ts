/* The league's weekly pairing and table (docs/20-league.md §4).
 *
 * §1 ⭐ everybody gets exactly perWeek opponents (capped at n − 1), and when
 *    n × perWeek is odd exactly one player is short by one — for every n
 *    from 1 to 14 and every perWeek from 1 to 3
 * §2 the same input pairs the same way (preview == publish)
 * §3 ⭐ availability outranks everything: two groups who cannot meet are
 *    never paired across, even when that means a repeat
 * §4 a fresh opponent beats a close record
 * §5 the short seat rotates to whoever has been short least
 * §6 ⭐ the search finds the true optimum — checked against brute force on
 *    every small field
 * §7 the table: points, OMW% with its ⅓ floor, head to head, the final left out
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRID_LEN, OVERLAP_PREFERRED, OVERLAP_TARGET, PAIR_COST, overlapScore, pairKey, pairWeek, rng,
  sharedWindows, standings, type Availability, type LeagueMatch, type PairingPlayer,
} from '../league.ts';

const WEEK = Date.parse('2026-10-12T00:00:00Z');
const everyEvening: Availability = {
  tz: 'UTC', grid: Array.from({ length: GRID_LEN }, (_, i) => (i % 24 >= 18 && i % 24 < 22 ? '1' : '0')).join(''),
};
const mornings: Availability = {
  tz: 'UTC', grid: Array.from({ length: GRID_LEN }, (_, i) => (i % 24 >= 6 && i % 24 < 10 ? '1' : '0')).join(''),
};
const player = (id: string, over: Partial<PairingPlayer> = {}): PairingPlayer =>
  ({ id, wins: 0, av: everyEvening, shortCount: 0, rank: 1, ...over });
const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${String(i).padStart(2, '0')}`);

function degrees(edges: { a: string; b: string }[]): Map<string, number> {
  const d = new Map<string, number>();
  for (const e of edges) { d.set(e.a, (d.get(e.a) ?? 0) + 1); d.set(e.b, (d.get(e.b) ?? 0) + 1); }
  return d;
}

test('league pairing §1 ⭐ exact degrees, one short seat when odd, no repeats inside a week', () => {
  for (let n = 1; n <= 14; n++) {
    for (let per = 1; per <= 3; per++) {
      const p = pairWeek({ players: ids(n).map(id => player(id)), perWeek: per, weekStartMs: WEEK, met: new Map(), seed: `x${n}-${per}`, restarts: 5 });
      const d = Math.min(per, n - 1);
      const deg = degrees(p.edges);
      const keys = p.edges.map(e => pairKey(e.a, e.b));
      assert.equal(new Set(keys).size, keys.length, `n=${n} per=${per}: nobody plays the same opponent twice in a week`);
      assert.ok(p.edges.every(e => e.a !== e.b), 'nobody plays themselves');
      if (n < 2) { assert.equal(p.edges.length, 0); continue; }
      const odd = (n * d) % 2 === 1;
      assert.equal(p.short !== null, odd, `n=${n} per=${per}: a short seat exactly when n × d is odd`);
      for (const id of ids(n)) {
        assert.equal(deg.get(id) ?? 0, id === p.short ? d - 1 : d, `n=${n} per=${per}: ${id}'s opponents`);
      }
    }
  }
});

test('league pairing §2 the same input pairs the same way', () => {
  const input = { players: ids(10).map((id, i) => player(id, { wins: i % 4 })), perWeek: 3, weekStartMs: WEEK, met: new Map(), seed: '2026-10:w2' };
  assert.deepEqual(pairWeek(input).edges, pairWeek(input).edges);
});

test('league pairing §3 ⭐ two groups who cannot meet are never paired across', () => {
  // four evening players and four morning players; the evening four have
  // already all met each other once — a repeat is still better than no overlap
  const eve = ['e1', 'e2', 'e3', 'e4'], morn = ['m1', 'm2', 'm3', 'm4'];
  const met = new Map<string, number>();
  for (const a of eve) for (const b of eve) if (a < b) met.set(pairKey(a, b), 1);
  const p = pairWeek({
    players: [...eve.map(id => player(id)), ...morn.map(id => player(id, { av: mornings }))],
    perWeek: 3, weekStartMs: WEEK, met, seed: 's',
  });
  for (const e of p.edges) {
    assert.equal(eve.includes(e.a), eve.includes(e.b), `${e.a}–${e.b} crosses the groups`);
  }
  assert.equal(p.weak.length, 0, 'every pair has time to play');
  assert.ok(p.edges.every(e => e.score >= OVERLAP_PREFERRED), 'and several evenings to choose from');
});

test('league pairing §4 a fresh opponent beats a close record', () => {
  // a/b are 3–0 and have met; c/d are 0–3 and have met. One opponent each:
  // records say a–b and c–d, freshness says cross over — and freshness wins
  const met = new Map([[pairKey('a', 'b'), 1], [pairKey('c', 'd'), 1]]);
  const p = pairWeek({
    players: [player('a', { wins: 3 }), player('b', { wins: 3 }), player('c'), player('d')],
    perWeek: 1, weekStartMs: WEEK, met, seed: 's',
  });
  const keys = p.edges.map(e => pairKey(e.a, e.b)).sort();
  assert.ok(!keys.includes(pairKey('a', 'b')) && !keys.includes(pairKey('c', 'd')), `got ${keys.join(', ')}`);
  // …and without the history, record decides
  const q = pairWeek({
    players: [player('a', { wins: 3 }), player('b', { wins: 3 }), player('c'), player('d')],
    perWeek: 1, weekStartMs: WEEK, met: new Map(), seed: 's',
  });
  assert.deepEqual(q.edges.map(e => pairKey(e.a, e.b)).sort(), [pairKey('a', 'b'), pairKey('c', 'd')]);
});

test('league pairing §5 the short seat goes to whoever has been short least, then the lowest standing', () => {
  const five = (short: Record<string, number>) => pairWeek({
    players: ['a', 'b', 'c', 'd', 'e'].map((id, i) => player(id, { rank: i + 1, shortCount: short[id] ?? 0 })),
    perWeek: 3, weekStartMs: WEEK, met: new Map(), seed: 's',
  }).short;
  assert.equal(five({}), 'e', 'nobody has been short: the lowest standing is');
  assert.equal(five({ e: 1 }), 'd', 'e has had their turn');
  assert.equal(five({ a: 1, b: 1, c: 1, d: 1, e: 1 }), 'e');
});

/** every edge set with these exact degrees, by brute force */
function* graphs(n: number, want: number[]): Generator<[number, number][]> {
  const all: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) all.push([i, j]);
  const m = want.reduce((s, k) => s + k, 0) / 2;
  const left = [...want];
  const pick: [number, number][] = [];
  function* go(from: number): Generator<[number, number][]> {
    if (pick.length === m) { if (left.every(k => k === 0)) yield [...pick]; return; }
    for (let x = from; x < all.length; x++) {
      const [i, j] = all[x]!;
      if (!left[i] || !left[j]) continue;
      left[i]!--; left[j]!--; pick.push(all[x]!);
      yield* go(x + 1);
      pick.pop(); left[i]!++; left[j]!++;
    }
  }
  yield* go(0);
}

test('league pairing §6 ⭐ the search finds the brute-force optimum on small fields', () => {
  const r = rng(7);
  let cases = 0;
  for (let n = 3; n <= 7; n++) {
    for (let per = 1; per <= Math.min(3, n - 1); per++) {
      for (let trial = 0; trial < 6; trial++) {
        // random availability: each player free on a random handful of evenings
        const players = ids(n).map(id => player(id, {
          wins: Math.floor(r() * 4),
          av: { tz: 'UTC', grid: Array.from({ length: GRID_LEN }, (_, i) => (i % 24 >= 18 && i % 24 < 21 && r() < 0.45 ? '1' : '0')).join('') },
        }));
        const met = new Map<string, number>();
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (r() < 0.25) met.set(pairKey(players[i]!.id, players[j]!.id), 1);
        const got = pairWeek({ players, perWeek: per, weekStartMs: WEEK, met, seed: `t${n}${per}${trial}` });
        const matrix = players.map((pi, i) => players.map((pj, j) => {
          if (i === j) return 0;
          const s = overlapScore(sharedWindows(pi.av, pj.av, WEEK));
          return (s < OVERLAP_TARGET ? PAIR_COST.noOverlap : s < OVERLAP_PREFERRED ? PAIR_COST.thinOverlap : 0)
            + (met.get(pairKey(pi.id, pj.id)) ?? 0) * PAIR_COST.repeat
            + Math.abs(pi.wins - pj.wins) * PAIR_COST.winGap;
        }));
        const cost = (i: number, j: number): number => matrix[i]![j]!;
        const shortIdx = got.short ? players.findIndex(p => p.id === got.short) : -1;
        const want = players.map((_, i) => (i === shortIdx ? per - 1 : per));
        let best = Infinity;
        for (const g of graphs(n, want)) best = Math.min(best, g.reduce((s, [i, j]) => s + cost(i, j), 0));
        assert.equal(got.total, best, `n=${n} per=${per} trial ${trial}: the search's total is the optimum`);
        cases++;
      }
    }
  }
  assert.ok(cases >= 50, `ran ${cases} cases`);
});

test('league table §7 points, OMW%, head to head, and the final left out', () => {
  const at = '2026-10-18T00:00:00Z';
  const m = (id: string, a: string, b: string, outcome: 'a' | 'b' | 'unplayed' | 'double-loss', final = false): LeagueMatch =>
    ({ id, week: final ? 4 : 1, a, b, windows: [], result: { outcome, how: 'played', at }, ...(final ? { final: true as const } : {}) });
  const rows = standings(['a', 'b', 'c', 'd'], [
    m('1', 'a', 'b', 'a'),
    m('2', 'c', 'd', 'b'),          // d beats c
    m('3', 'a', 'c', 'unplayed'),
    m('4', 'b', 'd', 'double-loss'),
    m('F', 'a', 'd', 'b', true),    // the final: not in the table
  ]);
  const by = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.deepEqual([by['a']!.w, by['a']!.l, by['a']!.unplayed, by['a']!.points], [1, 0, 1, 3]);
  assert.deepEqual([by['d']!.w, by['d']!.l], [1, 1], 'a double loss is a loss for both');
  assert.deepEqual([by['b']!.w, by['b']!.l], [0, 2]);
  assert.equal(by['c']!.unplayed, 1);
  // a and d both have 3 points; a's opponent (b, 0–2) floors at ⅓, d's opponents (c 0–1 → ⅓, b → ⅓)
  assert.equal(by['a']!.omw.toFixed(4), (1 / 3).toFixed(4));
  assert.deepEqual(rows.map(r => r.id).slice(0, 2).sort(), ['a', 'd'], 'the 3-point players lead');
  assert.equal(rows[0]!.rank, 1);

  // head to head breaks an exact tie
  const h = standings(['x', 'y'], [m('1', 'x', 'y', 'b'), m('2', 'x', 'y', 'a')].map((r, i) => ({ ...r, id: String(i) })));
  assert.equal(h[0]!.points, h[1]!.points);
  const tie = standings(['x', 'y', 'z'], [m('1', 'y', 'x', 'a'), m('2', 'x', 'z', 'a'), m('3', 'z', 'y', 'a')]);
  assert.deepEqual(tie.map(r => r.points), [3, 3, 3], 'a three-way cycle ties on points');
});
