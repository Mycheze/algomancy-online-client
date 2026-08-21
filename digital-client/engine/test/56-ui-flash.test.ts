/* Playtest round 8 — the visual stack (ui/flash.ts + the 'stackFlash' event).
 *
 * Bena: "all effects that can't be responded to (like haste or end of turn)
 * happen and resolve instantly so it's very hard to track."
 *
 * Two halves to pin. First that the ENGINE announces every item that resolves
 * without ever reaching the stack — and announces it as a signal, not as a
 * log line, because the reader already has "X resolves." Second that the
 * queue arithmetic in ui/flash.ts gives each of them its beat, in order, and
 * never drifts far behind the board it is explaining.
 *
 * Seeds 5600-5699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { EngineEvent, StackItem } from '../src/types.ts';
import {
  HOLD_MS, MAX_LEAD_MS, STAGGER_MS,
  flashItems, nextFlashWake, pruneFlashes, queueFlashes, stackRows, visibleFlashes,
} from '../ui/flash.ts';
import { give, giveResources, spawn, toDeployment, toNextBattle } from './util.ts';

/** a bare item, enough for the queue arithmetic (which never reads the rest) */
const item = (id: number): StackItem => ({
  id, kind: 'triggered', label: `item ${id}`, controller: 0, region: 0,
  negated: false, parts: [],
});
const flashEv = (id: number): EngineEvent =>
  ({ type: 'stackFlash', msg: '', data: { item: item(id) } });

/* ── the engine half: what gets announced, and what it costs the log ────── */

test('an item that resolves with no response window announces itself', () => {
  const h = new Harness(5601);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  giveResources(h, seat, 'fire', 6);
  const idx = give(h, seat, 'Ignis Sprite');
  const events = h.do({ type: 'playCard', seat, handIndex: idx });
  // deployment: nobody may respond, so the unit never reaches state.stack
  assert.equal(h.state.stack.length, 0);
  const flashed = flashItems(events);
  // the Sprite itself, and the spawn trigger it fires on the way in — both
  // resolved with no window, both worth a beat
  assert.ok(flashed.length >= 1, 'something was announced');
  assert.equal(flashed[0]!.card, 'Ignis Sprite');
  assert.equal(flashed[0]!.controller, seat);
  assert.ok(flashed.some(f => f.kind === 'triggered'), 'the spawn trigger too');
  // …and the announcement is a signal, not a line: no blank log lines
  assert.ok(!h.log.some(l => l === ''));
  assert.equal(h.log.length, h.logTypes.length);
});

test('a battle spell reaches the real stack and is NOT flashed', () => {
  const h = new Harness(5602);
  toDeployment(h);
  toNextBattle(h);
  const b = h.state.battle!;
  const atk = spawn(h, b.attacker, 'Ignis Sprite');
  h.do({ type: 'declareAttack', seat: b.attacker, columns: [[atk]] });
  const me = h.state.priority!;
  giveResources(h, me, 'water', 6);
  const idx = give(h, me, 'Jelly');
  const events = h.do({ type: 'playCard', seat: me, handIndex: idx });
  assert.equal(flashItems(events).length, 0, 'it can be responded to — no flash');
  // it is on the real stack (or still choosing its target), where it stays
  // visible for as long as the response window lasts
  assert.ok(h.state.stack.length >= 1 || h.state.decision !== null);
});

test('every log line still knows its event type', () => {
  const h = new Harness(5603);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  giveResources(h, seat, 'fire', 8);
  h.do({ type: 'playCard', seat, handIndex: give(h, seat, 'Ignis Sprite') });
  assert.equal(h.log.length, h.logTypes.length);
  // the parallel array is the REAL one: events still holds the silent flash
  assert.ok(h.events.some(e => e.type === 'stackFlash'));
  assert.ok(!h.logTypes.includes('stackFlash'));
});

test('a flashed item carries everything the card needs to be drawn', () => {
  const h = new Harness(5604);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  giveResources(h, seat, 'fire', 6);
  const ev = h.do({ type: 'playCard', seat, handIndex: give(h, seat, 'Ignis Sprite') })
    .find(e => e.type === 'stackFlash')!;
  const it = ev.data!['item'] as StackItem;
  assert.equal(ev.msg, '', 'silent by construction');
  assert.equal(it.card, 'Ignis Sprite');
  assert.ok(typeof it.label === 'string' && it.label.length > 0);
  assert.ok(Array.isArray(it.parts));
  // a SNAPSHOT: the engine spends parts as it resolves, and the copy the
  // client draws must still show what was about to happen
  assert.ok(it.parts.every(p => !p.spent));
});

/* ── the queue arithmetic ───────────────────────────────────────────────── */

test('one flash appears now and leaves after HOLD_MS', () => {
  const q = queueFlashes([], [flashEv(1)], 1000);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.at, 1000);
  assert.equal(q[0]!.until, 1000 + HOLD_MS);
  assert.equal(visibleFlashes(q, 1000).length, 1);
  assert.equal(visibleFlashes(q, 1000 + HOLD_MS - 1).length, 1);
  assert.equal(visibleFlashes(q, 1000 + HOLD_MS).length, 0, 'its beat is over');
  assert.equal(pruneFlashes(q, 1000 + HOLD_MS).length, 0);
});

test('a batch arrives as a sequence, not a fan', () => {
  const q = queueFlashes([], [flashEv(1), flashEv(2), flashEv(3)], 0);
  assert.deepEqual(q.map(f => f.at), [0, STAGGER_MS, STAGGER_MS * 2]);
  assert.equal(visibleFlashes(q, 0).length, 1);
  assert.equal(visibleFlashes(q, STAGGER_MS).length, 2);
  assert.equal(visibleFlashes(q, STAGGER_MS * 2).length, 3);
});

test('a second action queues behind the first, it does not pile on top', () => {
  const first = queueFlashes([], [flashEv(1)], 0);
  const both = queueFlashes(first, [flashEv(2)], 10);
  assert.equal(both[1]!.at, STAGGER_MS, 'lines up behind the pending one');
  assert.ok(both[1]!.at > both[0]!.at);
});

test('the queue never runs further than MAX_LEAD_MS behind the board', () => {
  const many = Array.from({ length: 40 }, (_, i) => flashEv(i + 1));
  const q = queueFlashes([], many, 0);
  assert.equal(q.length, 40, 'nothing is dropped');
  for (const f of q) assert.ok(f.at <= MAX_LEAD_MS, `${f.at} <= ${MAX_LEAD_MS}`);
  // past the cap they share an arrival: a long chain CROWDS the stack rather
  // than queueing up for half a minute
  assert.ok(q.filter(f => f.at === MAX_LEAD_MS).length > 1);
});

test('the same item is never given two beats (a resync must not replay one)', () => {
  const q1 = queueFlashes([], [flashEv(7)], 0);
  const q2 = queueFlashes(q1, [flashEv(7)], 5);
  assert.equal(q2.length, 1);
});

test('nextFlashWake names the next moment the stack looks different', () => {
  const q = queueFlashes([], [flashEv(1), flashEv(2)], 0);
  assert.equal(nextFlashWake(q, 0), STAGGER_MS, 'item 2 arrives');
  assert.equal(nextFlashWake(q, STAGGER_MS), HOLD_MS, 'item 1 leaves');
  assert.equal(nextFlashWake(q, HOLD_MS + STAGGER_MS), null, 'nothing left to do');
  assert.equal(nextFlashWake([], 0), null);
});

/* ── what the board actually draws ──────────────────────────────────────── */

test('stackRows puts the real stack first and marks what resolves next', () => {
  const stack = [item(10), item(11)];
  const rows = stackRows(stack, [], 0);
  assert.deepEqual(rows.map(r => r.item.id), [10, 11]);
  assert.deepEqual(rows.map(r => r.top), [false, true], 'the LAST one resolves next');
  assert.ok(rows.every(r => !r.flashing));
});

test('a flash sits above the real stack and claims nothing about resolving', () => {
  const q = queueFlashes([], [flashEv(99)], 0);
  const rows = stackRows([item(10)], q, 0);
  assert.deepEqual(rows.map(r => r.item.id), [10, 99]);
  assert.deepEqual(rows.map(r => r.flashing), [false, true]);
  assert.deepEqual(rows.map(r => r.top), [true, false],
    'the real top still resolves next — a flash already resolved');
  // once its beat is over the stack is just the stack again
  assert.deepEqual(stackRows([item(10)], q, HOLD_MS).map(r => r.item.id), [10]);
});

test('an empty stack with nothing flashing draws nothing', () => {
  assert.deepEqual(stackRows([], [], 0), []);
});
