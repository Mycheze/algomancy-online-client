/* Cube draft §4: what reserve and pick refuse, and what the view hides (docs/25-cube-draft.md §4).
 *
 * §1 reserve and pick refuse a card not in my current pack, a seat with no pack, a bad seat, and
 *    anything once the draft is over; a refusal changes nothing
 * §2 a pick cannot be undone: the card is gone from the pack, and picking it again is refused
 * §3 a pack with two copies of a card (a pasted list) gives up one copy per pick
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, draftView, pick, reserve, startDraft } from '../cube-draft.ts';

const POOL = Array.from({ length: 60 }, (_, i) => `card${i}`);
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ user: `u${i}`, name: `P${i}` }));

test('cube §1 refusals', () => {
  const d = startDraft(people(2), POOL, 2, 5, 11, 0, 1000);
  const mine = d.seats[0]!.queue[0]!;
  const theirs = d.seats[1]!.queue[0]!;
  const before = JSON.stringify(d);
  assert.deepEqual(reserve(d, 0, theirs[0]!), { ok: false, error: 'that card is not in your pack' });
  assert.deepEqual(pick(d, 0, theirs[0]!, 10), { ok: false, error: 'that card is not in your pack' });
  assert.deepEqual(pick(d, 0, 'Not A Card', 10), { ok: false, error: 'that card is not in your pack' });
  assert.equal(reserve(d, 5, mine[0]!).ok, false);
  assert.equal(pick(d, -1, mine[0]!, 10).ok, false);
  assert.equal(JSON.stringify(d), before, 'a refusal changes nothing');
  // seat 0 picks; its next pack has not arrived (seat 1 has not passed)
  assert.ok(pick(d, 0, mine[0]!, 10).ok);
  assert.equal(reserve(d, 0, theirs[0]!).ok, false, 'no pack yet');
  assert.deepEqual(pick(d, 0, mine[1]!, 10), { ok: false, error: 'no pack to pick from yet' });
  // to the end, then everything is refused
  advance(d, 1e12, seat => d.seats[seat]!.queue[0]![0]!);
  assert.equal(d.done, true);
  assert.deepEqual(pick(d, 0, mine[1]!, 1e12), { ok: false, error: 'the draft is over' });
  assert.equal(reserve(d, 1, mine[1]!).ok, false);
  const v = draftView(d, 0, 1e12, 'card1');
  assert.equal(v.pack, null);
  assert.equal(v.deadline, null);
  assert.equal(v.suggest, null, 'no suggestion without a pack');
  assert.equal(v.packNo, 2);
  assert.equal(v.picks.length, 10);
});

test('cube §2 a pick is final', () => {
  const d = startDraft(people(3), POOL, 3, 5, 12, 0, 1000);
  const card = d.seats[1]!.queue[0]![2]!;
  assert.ok(reserve(d, 1, card).ok);
  assert.ok(pick(d, 1, card, 50).ok);
  assert.deepEqual(d.seats[1]!.picks, [card]);
  assert.equal(d.seats[1]!.reserved, null);
  assert.ok(!d.seats[2]!.queue[0]!.includes(card) && !d.seats[2]!.queue[1]!.includes(card));
  assert.equal(pick(d, 2, card, 60).ok, false, 'the next seat cannot take it either');
  // the view's suggestion is only ever a card of my pack
  const v = draftView(d, 2, 60, card);
  assert.equal(v.suggest, null);
  assert.equal(draftView(d, 2, 60, v.pack![0]!).suggest, v.pack![0]);
});

test('cube §3 duplicates leave one copy per pick', () => {
  const pool = ['A', 'A', 'B', 'C', 'D', 'E'];
  const d = startDraft([{ user: 'u', name: 'U' }], pool, 1, 6, 1, 0, 1000);
  assert.ok(pick(d, 0, 'A', 1).ok);
  assert.equal(d.seats[0]!.queue[0]!.filter(c => c === 'A').length, 1, 'a solo seat passes to itself');
  assert.ok(pick(d, 0, 'A', 2).ok);
  assert.equal(pick(d, 0, 'A', 3).ok, false);
  assert.deepEqual(d.seats[0]!.picks, ['A', 'A']);
});
