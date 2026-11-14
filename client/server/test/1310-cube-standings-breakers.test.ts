/* Cube draft (docs/25 §7): the standings and their MTG-style tie-breaks, on hand-worked examples.
 *
 * Every expected number below is worked by hand in the comments, from the definitions in
 * cube-tourney.ts's header: 3/1/0; OMW% = mean of opponents' match-win % (floored ⅓, byes are not
 * opponents); GW% = games won / games played (floored ⅓); OGW% = mean of opponents' GW%; join order.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standings } from '../cube-tourney.ts';
import type { CubePlayer, Pairing } from '../cube-types.ts';

const players = (ids: string[]): CubePlayer[] => ids.map((u, i) => ({ user: u, name: u.toUpperCase(), joinedAt: 1000 + i }));
let seq = 0;
const win = (round: number, a: string, b: string, winner: string, games?: [number, number]): Pairing =>
  ({ id: `t${++seq}`, round, a, b, posted: true, result: { kind: 'win', winner, ...(games ? { games } : {}), at: 1, by: 'play' } });
const draw = (round: number, a: string, b: string, games?: [number, number]): Pairing =>
  ({ id: `t${++seq}`, round, a, b, posted: true, result: { kind: 'draw', ...(games ? { games } : {}), at: 1, by: 'host' } });
const near = (x: number, y: number): boolean => Math.abs(x - y) < 1e-6;

test('8 players, 3 rounds of Bo3: points, then OMW%, decide the order', () => {
  // R1  a 2–1 b · c 2–0 d · e 2–1 f · g 2–0 h
  // R2  a 2–0 c · e 2–1 g · b 2–1 d · f 1–1 h (draw)
  // R3  e 2–1 a · c 2–0 g · f 2–0 b · h 2–1 d
  const ps = players(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  const pr: Pairing[] = [
    win(1, 'a', 'b', 'a', [2, 1]), win(1, 'c', 'd', 'c', [2, 0]), win(1, 'e', 'f', 'e', [2, 1]), win(1, 'g', 'h', 'g', [2, 0]),
    win(2, 'a', 'c', 'a', [2, 0]), win(2, 'e', 'g', 'e', [2, 1]), win(2, 'b', 'd', 'b', [2, 1]), draw(2, 'f', 'h', [1, 1]),
    win(3, 'e', 'a', 'e', [2, 1]), win(3, 'c', 'g', 'c', [2, 0]), win(3, 'f', 'b', 'f', [2, 0]), win(3, 'h', 'd', 'h', [2, 1]),
  ];
  // records         pts  MW%(floored)  games  GW%(floored)
  // a W W L          6   6/9 = .6667   5/8    .625
  // b L W L          3   3/9 = .3333   3/8    .375
  // c W L W          6   .6667         4/6    .6667
  // d L L L          0   0 → .3333     2/8    .25 → .3333
  // e W W W          9   1             6/9    .6667
  // f L D W          4   4/9 = .4444   4/7    .5714
  // g W L L          3   .3333         3/7    .4286
  // h L D W          4   .4444         3/7    .4286
  // OMW: a (b,c,e) = (.3333+.6667+1)/3 = .6667   c (d,a,g) = (.3333+.6667+.3333)/3 = .4444  → a over c
  //      f (e,h,b) = (1+.4444+.3333)/3 = .5926   h (g,f,d) = (.3333+.4444+.3333)/3 = .3704  → f over h
  //      g (h,e,c) = (.4444+1+.6667)/3 = .7037   b (a,d,f) = (.6667+.3333+.4444)/3 = .4815  → g over b
  const rows = standings(ps, pr);
  assert.deepEqual(rows.map(r => r.user), ['e', 'a', 'c', 'f', 'h', 'g', 'b', 'd']);
  assert.deepEqual(rows.map(r => r.rank), [1, 2, 3, 4, 5, 6, 7, 8]);
  const by = new Map(rows.map(r => [r.user, r]));
  assert.deepEqual([by.get('f')!.w, by.get('f')!.l, by.get('f')!.d, by.get('f')!.points], [1, 1, 1, 4]);
  assert.ok(near(by.get('a')!.omw, 2 / 3));
  assert.ok(near(by.get('c')!.omw, 4 / 9));
  assert.ok(near(by.get('f')!.omw, (1 + 4 / 9 + 1 / 3) / 3));
  assert.ok(near(by.get('h')!.omw, (1 / 3 + 4 / 9 + 1 / 3) / 3));
  assert.ok(near(by.get('g')!.omw, (4 / 9 + 1 + 2 / 3) / 3));
  assert.ok(near(by.get('a')!.gw, 5 / 8));
  assert.ok(near(by.get('d')!.gw, 1 / 3), 'GW% floored at a third');
  assert.ok(near(by.get('f')!.gw, 4 / 7));
  // OGW of e (f,g,a) = (4/7 + 3/7 + 5/8) / 3
  assert.ok(near(by.get('e')!.ogw, (4 / 7 + 3 / 7 + 5 / 8) / 3));
});

test('6 players, 2 rounds: GW% and then OGW% break ties that points and OMW% leave', () => {
  // join order w x y z u v
  // R1  w 2–0 x · y 2–0 z · u 2–0 v
  // R2  w 2–0 v · y 2–0 u · x 2–1 z
  const ps = players(['w', 'x', 'y', 'z', 'u', 'v']);
  const pr: Pairing[] = [
    win(1, 'w', 'x', 'w', [2, 0]), win(1, 'y', 'z', 'y', [2, 0]), win(1, 'u', 'v', 'u', [2, 0]),
    win(2, 'w', 'v', 'w', [2, 0]), win(2, 'y', 'u', 'y', [2, 0]), win(2, 'x', 'z', 'x', [2, 1]),
  ];
  // MW%: w 1, y 1, x .5, u .5, z .3333, v .3333
  // GW%: w 4/4=1, y 4/4=1, x 2/5=.4, u 2/4=.5, z 1/5=.2→.3333, v 0/4→.3333
  // w vs y: 6 pts each; OMW w (x,v) = (.5+.3333)/2 = y (z,u) — tied; GW 1 = 1 — tied;
  //         OGW w = (x .4 + v .3333)/2 = .3667, y = (z .3333 + u .5)/2 = .4167 → y first, although w joined first.
  // x vs u: 3 pts; OMW x (w,z) = (1+.3333)/2 = u (v,y) — tied; GW u .5 > x .4 → u first.
  // z vs v: 0 pts; OMW z (y,x) = (1+.5)/2 = v (u,w) — tied; GW both floored .3333 — tied;
  //         OGW z = (y 1 + x .4)/2 = .7, v = (u .5 + w 1)/2 = .75 → v first.
  const rows = standings(ps, pr);
  assert.deepEqual(rows.map(r => r.user), ['y', 'w', 'u', 'x', 'v', 'z']);
  const by = new Map(rows.map(r => [r.user, r]));
  assert.ok(near(by.get('w')!.omw, by.get('y')!.omw));
  assert.ok(near(by.get('w')!.ogw, (0.4 + 1 / 3) / 2));
  assert.ok(near(by.get('y')!.ogw, (1 / 3 + 0.5) / 2));
  assert.ok(near(by.get('z')!.ogw, 0.7));
  assert.ok(near(by.get('v')!.ogw, 0.75));
});

test('nothing decided: everyone on 0, in join order (joinedAt, then array order)', () => {
  const ps: CubePlayer[] = [
    { user: 'late', name: 'Late', joinedAt: 30 },
    { user: 'first', name: 'First', joinedAt: 10 },
    { user: 'tieA', name: 'A', joinedAt: 20 },
    { user: 'tieB', name: 'B', joinedAt: 20 },
  ];
  const rows = standings(ps, []);
  assert.deepEqual(rows.map(r => r.user), ['first', 'tieA', 'tieB', 'late']);
  assert.deepEqual(rows.map(r => [r.points, r.omw, r.ogw]), [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  assert.ok(rows.every(r => near(r.gw, 1 / 3)));
});

test('a bye is a 2–0 match win and not an opponent; Bo1 wins without games are 1–0', () => {
  const ps = players(['a', 'b', 'c']);
  const pr: Pairing[] = [
    { id: 'r1p1', round: 1, a: 'a', b: 'b', posted: true, result: { kind: 'win', winner: 'b', at: 1, by: 'play' } },
    { id: 'r1p2', round: 1, a: 'c', b: null, posted: true, result: { kind: 'bye', at: 0, by: 'play' } },
  ];
  const by = new Map(standings(ps, pr).map(r => [r.user, r]));
  const c = by.get('c')!;
  assert.deepEqual([c.w, c.l, c.points, c.omw, c.ogw], [1, 0, 3, 0, 0], 'a bye: a win, 3 points, no opponents');
  assert.equal(c.gw, 1, 'a bye is 2–0 in games');
  assert.equal(by.get('b')!.gw, 1, 'a Bo1 win with no games recorded is 1–0');
  assert.ok(near(by.get('a')!.gw, 1 / 3));
  assert.equal(by.get('b')!.omw, 1 / 3, "the loser's match-win % floored");
});

test('only POSTED and DECIDED pairings count — an unposted bye scores nothing yet', () => {
  const ps = players(['a', 'b', 'c']);
  const pr: Pairing[] = [
    { id: 'r1p1', round: 1, a: 'a', b: 'b', posted: true },
    { id: 'r1p2', round: 1, a: 'c', b: null, posted: false, result: { kind: 'bye', at: 0, by: 'play' } },
  ];
  assert.ok(standings(ps, pr).every(r => r.points === 0 && r.w === 0));
  const posted = pr.map(p => ({ ...p, posted: true }));
  assert.equal(standings(ps, posted).find(r => r.user === 'c')!.points, 3);
});

test('standings never mutates its inputs', () => {
  const ps = players(['a', 'b']);
  const pr: Pairing[] = [win(1, 'a', 'b', 'a', [2, 1])];
  const before = JSON.stringify([ps, pr]);
  standings(ps, pr);
  assert.equal(JSON.stringify([ps, pr]), before);
});
