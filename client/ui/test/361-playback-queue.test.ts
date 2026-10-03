/* 2026-10-03 — THE PLAYBACK ON THE PACE QUEUE (ui/pace.ts paceSequence /
 * paceBehind / samePlay).
 *
 * The owner replaced the "Your opponent's deployment" modal with a playback:
 * the board after each of their moves, one a second ("1 step/sec, auto"), a
 * run of copies of one card three a second, and Space to skip. The frames
 * ride the client's one pacing queue. Two rules are new and both are about
 * ORDER, which is the thing a queue of game states must never get wrong:
 *
 *   · a playback goes on behind nothing — what was already waiting is older
 *     than the step that just closed, so it is let out first, at once;
 *   · while a playback is still queued, a new arrival waits BEHIND it, even
 *     one the player could act on. In the next turn's planning the opponent's
 *     own clicks refresh this seat's view, and under R150's flush-on-actionable
 *     rule any one of them would have cut the playback off after a frame.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyPace, pace, paceBehind, paceDue, paceFlush, paceSequence, PACE_MS, PACE_SAME_SOURCE_MS, PACE_MAX_HELD, samePlay } from '../pace.ts';
import type { StackItem } from '../../engine/src/types.ts';

test('§1 a playback lets out what was waiting first, then a frame per gap, in order', () => {
  let q = pace(emptyPace<string>(), 'old', 0, true);              // held for a second
  q = paceSequence(q, ['f1', 'f2', 'f3', 'final'], [0, PACE_MS, PACE_SAME_SOURCE_MS, PACE_MS], 100);
  assert.deepEqual(q.queue.map(p => [p.item, p.at]),
    [['old', 100], ['f1', 100], ['f2', 100 + PACE_MS], ['f3', 100 + PACE_MS + PACE_SAME_SOURCE_MS],
      ['final', 100 + 2 * PACE_MS + PACE_SAME_SOURCE_MS]]);
  const first = paceDue(q, 100);
  assert.deepEqual(first.out, ['old', 'f1'], 'the stale update and the first frame together');
  assert.deepEqual(paceDue(first.rest, 100 + PACE_MS).out, ['f2']);
});

test('§2 a long playback is not cut short by the lag clamp', () => {
  const n = PACE_MAX_HELD + 6;
  const items = Array.from({ length: n }, (_, i) => `f${i}`);
  const q = paceSequence(emptyPace<string>(), items, items.map(() => PACE_MS), 0);
  assert.equal(q.queue[n - 1]!.at, (n - 1) * PACE_MS,
    'PACE_MAX_HELD bounds falling behind the server; a playback is behind it on purpose');
});

test('§3 an arrival during a playback waits behind it — never ahead, never collapsing it', () => {
  let q = paceSequence(emptyPace<string>(), ['f1', 'f2', 'final'], [0, PACE_MS, PACE_MS], 0);
  q = paceBehind(q, 'their planning click', 10);
  assert.deepEqual(q.queue.map(p => p.item), ['f1', 'f2', 'final', 'their planning click']);
  const ats = q.queue.map(p => p.at);
  assert.deepEqual([...ats].sort((a, b) => a - b), ats, 'times never go backwards — paceDue takes a prefix');
  // …and the old rule, for contrast: an actionable arrival COLLAPSES the queue
  const flushed = pace(paceSequence(emptyPace<string>(), ['f1', 'f2'], [0, PACE_MS], 0), 'x', 10, false);
  assert.ok(flushed.queue.every(p => p.at <= 10), 'which is exactly what would have ended the playback at frame 1');
  // the skip is still the whole way out
  assert.deepEqual(paceFlush(q).out, ['f1', 'f2', 'final', 'their planning click']);
});

test('§4 samePlay: copies of one card by one seat, never abilities, never across seats', () => {
  const it = (id: number, card: string, controller: 0 | 1, extra: Partial<StackItem> = {}): StackItem =>
    ({ id, kind: 'spellToken', card, label: card, controller, region: 0, negated: false, parts: [], ...extra });
  assert.equal(samePlay(it(1, 'Fireball', 1), it(2, 'Fireball', 1)), true);
  assert.equal(samePlay(it(1, 'Fireball', 1), it(2, 'Fireball', 0)), false, 'two players are two stories');
  assert.equal(samePlay(it(1, 'Fireball', 1), it(2, 'Bubb', 1)), false);
  assert.equal(samePlay(it(1, 'Ignis Sprite', 1, { kind: 'triggered', sourceId: 4 }), it(2, 'Ignis Sprite', 1, { kind: 'triggered', sourceId: 4 })),
    false, 'a run of one source\'s triggers is sameSource\'s business, not this');
  assert.equal(samePlay(undefined, it(2, 'Fireball', 1)), false);
});
