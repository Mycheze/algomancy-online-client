/* Cube draft §4: packs pass left, then right, then left (docs/25-cube-draft.md §4).
 *
 * §1 round 1 (left): the pack seat i passes arrives at seat i+1, the last seat's at seat 0
 * §2 round 2 (right): it arrives at seat i−1; round 3 is left again — checked by following
 *    every pack, by its cards, through every pick of a 4-seat draft
 * §3 a waiting pack is current at once when the one before it is passed: its clock starts at that
 *    pick, and the table shows how many packs wait at each seat
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftView, pick, startDraft } from '../cube-draft.ts';

const POOL = Array.from({ length: 60 }, (_, i) => `card${i}`);   // the draft never reads card data
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ user: `u${i}`, name: `P${i}` }));

test('cube §1–2 every pack moves one seat, in its round\'s direction', () => {
  const d = startDraft(people(4), POOL, 3, 5, 3, 0, 1000);
  const n = 4;
  for (let round = 0; round < 3; round++) {
    const dir = round % 2 === 0 ? 1 : -1;
    assert.equal(draftView(d, 0, 0, null).direction, dir === 1 ? 'left' : 'right');
    assert.equal(draftView(d, 0, 0, null).packNo, round + 1);
    for (let p = 0; p < 5; p++) {
      for (let seat = 0; seat < n; seat++) {
        assert.equal(d.round, round);
        const pack = d.seats[seat]!.queue[0]!;
        assert.equal(pack.length, 5 - p, 'everyone picks in lockstep here');
        const card = pack[0]!;
        const rest = pack.slice(1).join();
        assert.deepEqual(pick(d, seat, card, 0), { ok: true });
        if (rest) {
          const to = d.seats[(seat + dir + n) % n]!;
          assert.equal(to.queue[to.queue.length - 1]!.join(), rest, `round ${round + 1}: seat ${seat} → ${(seat + dir + n) % n}`);
        }
      }
    }
  }
  assert.equal(d.done, true);
  assert.ok(d.seats.every(s => s.picks.length === 15));
});

test('cube §3 a waiting pack starts its clock when the one before it is passed', () => {
  const d = startDraft(people(3), POOL, 3, 5, 9, 0, 1000);
  // seat 0 picks at 100 → its pack waits at seat 1, behind seat 1's own
  assert.ok(pick(d, 0, d.seats[0]!.queue[0]![0]!, 100).ok);
  assert.equal(d.seats[0]!.since, null, 'nothing waits at seat 0');
  assert.equal(draftView(d, 0, 100, null).pack, null);
  assert.equal(draftView(d, 0, 100, null).deadline, null);
  assert.deepEqual(draftView(d, 0, 100, null).seats.map(s => s.waiting), [0, 2, 1]);
  assert.equal(d.seats[1]!.since, 0, 'seat 1\'s own clock still runs from the start');
  assert.equal(draftView(d, 1, 100, null).deadline, 5 * 1000);
  // seat 1 picks at 700: the waiting 4-card pack is current at once, its clock from 700
  assert.ok(pick(d, 1, d.seats[1]!.queue[0]![0]!, 700).ok);
  const v = draftView(d, 1, 700, null);
  assert.equal(v.pack!.length, 4);
  assert.equal(v.deadline, 700 + 4 * 1000);
  assert.equal(v.pickNo, 2);
  // never another seat's picks
  assert.deepEqual(v.picks, d.seats[1]!.picks);
  assert.ok(!JSON.stringify(v).includes(d.seats[0]!.picks[0]!), 'seat 0\'s pick is not in seat 1\'s view');
});
