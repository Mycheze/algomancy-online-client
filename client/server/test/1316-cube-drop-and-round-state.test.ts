/* Cube draft (docs/25 §7): a dropped player is never paired but stays in the standings; roundDone
 * and scoreLine read a round and a pairing the way the event page shows them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairExhibition, pairSwiss, roundDone, scoreLine, standings } from '../cube-tourney.ts';
import type { CubePlayer, Pairing } from '../cube-types.ts';

const players = (n: number): CubePlayer[] =>
  Array.from({ length: n }, (_, i) => ({ user: `u${i}`, name: `P${i}`, joinedAt: i }));

test('a dropped player is not paired, but keeps their row (marked dropped)', () => {
  const ps = players(6);
  const r1 = pairSwiss(ps, [], 1, 3).map(p => ({ ...p, posted: true,
    result: { kind: 'win' as const, winner: p.a, at: 1, by: 'play' as const } }));
  const dropper = r1[0]!.a;   // a winner drops
  const ps2 = ps.map(p => (p.user === dropper ? { ...p, dropped: true } : p));
  const r2 = pairSwiss(ps2, r1, 2, 3);
  assert.ok(r2.every(p => p.a !== dropper && p.b !== dropper));
  assert.equal(r2.filter(p => p.b === null).length, 1, 'five left: one bye');
  const rows = standings(ps2, r1);
  const row = rows.find(r => r.user === dropper)!;
  assert.equal(row.dropped, true);
  assert.equal(row.points, 3, 'their results still stand');
  assert.equal(rows.length, 6);
  assert.equal(pairExhibition(ps2.map(p => ({ ...p, ready: true })).filter(p => p.dropped || p.user === r1[0]!.b), [], 0), null,
    'exhibition never pairs a dropped player');
});

test('roundDone: every posted pairing of the round has a result', () => {
  const pr: Pairing[] = [
    { id: 'r1p1', round: 1, a: 'a', b: 'b', posted: true, result: { kind: 'win', winner: 'a', at: 1, by: 'play' } },
    { id: 'r1p2', round: 1, a: 'c', b: null, posted: true, result: { kind: 'bye', at: 0, by: 'play' } },
    { id: 'r2p1', round: 2, a: 'a', b: 'c', posted: true },
    { id: 'r3p1', round: 3, a: 'a', b: 'b', posted: false },
  ];
  assert.equal(roundDone(pr, 1), true);
  assert.equal(roundDone(pr, 2), false);
  assert.equal(roundDone(pr, 3), false, 'nothing posted is not done');
  assert.equal(roundDone(pr, 4), false);
});

test("scoreLine: a's games – b's, Bye, Draw, null", () => {
  const base = { id: 'p', round: 1, a: 'a', b: 'b', posted: true } as const;
  assert.equal(scoreLine({ ...base }), null);
  assert.equal(scoreLine({ ...base, result: { kind: 'win', winner: 'b', games: [1, 2], at: 1, by: 'play' } }), '1–2');
  assert.equal(scoreLine({ ...base, result: { kind: 'win', winner: 'a', games: [2, 0], at: 1, by: 'play' } }), '2–0');
  assert.equal(scoreLine({ ...base, result: { kind: 'win', winner: 'b', at: 1, by: 'play' } }), '0–1', 'a Bo1');
  assert.equal(scoreLine({ ...base, result: { kind: 'draw', games: [1, 1], at: 1, by: 'host' } }), 'Draw');
  assert.equal(scoreLine({ ...base, b: null, result: { kind: 'bye', at: 0, by: 'play' } }), 'Bye');
});
