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
  censusFlashes, flashItems, negatedFlashItems, negatedIds, nextFlashWake,
  pruneFlashes, queueFlashes, stackRows, visibleFlashes,
} from '../ui/flash.ts';
import { census, diffCensus } from '../ui/motion.ts';
import { stackItemX, stackXMark } from '../ui/inspect.ts';
import { give, giveResources, pick, spawn, toDeployment, toNextBattle } from './util.ts';

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

/* ── X survives the beat (playtest round 13, UZRG) ──────────────────────── */

test('a flashed item still knows its X — the beat is the only chance to read it', () => {
  // "It's not possible to see the X value for an effect while it's on the
  // stack." A haste-step or deployment X spell resolves with no response
  // window: it never touches state.stack at all, so the flash beat is the ONE
  // frame in which a player can read its X. If the snapshot lost it, nothing
  // downstream could put it back.
  const h = new Harness(5610);
  toDeployment(h);
  const seat = h.state.deployPlayer!;
  giveResources(h, seat, 'wood', 4);
  giveResources(h, seat, 'metal', 3);
  h.do({ type: 'playCard', seat, handIndex: give(h, seat, 'Floral Singularity') });
  // R35: X is chosen and paid as the card is cast
  const dec = h.state.decision!;
  const want = 3;
  const events = h.do({
    type: 'decide', seat: dec.seat, choice: dec.options.findIndex(o => o.value === want),
  });
  assert.equal(h.state.stack.length, 0, 'deployment gives no window — it never reaches the stack');

  const flashed = flashItems(events).find(i => i.card === 'Floral Singularity')!;
  assert.ok(flashed, 'it got its beat');
  assert.equal(flashed.x, want, 'the structuredClone snapshot carries X');

  // …and all the way through the queue to what the board draws
  const rows = stackRows([], queueFlashes([], events, 0), 0);
  const row = rows.find(r => r.item.card === 'Floral Singularity')!;
  assert.ok(row, 'on the visual stack');
  assert.equal(row.item.x, want, 'stackRows preserves it');
  assert.deepEqual(stackItemX(row.item).map(r => [r.kind, r.x]), [['cast', want]]);
  assert.equal(stackXMark(row.item), `X=${want}`, 'and the card wears the tag');
});

/* ── R68: a negated item still gets its beat ────────────────────────────
 *
 * Negation used to set `item.negated = true` and LEAVE the item on the stack,
 * so it sat there greyed out — slow (each corpse cost a full priority round to
 * pop), but you could see that your spell had been answered. R68 removes it
 * the instant the negation resolves, which is the right rule and takes the
 * only picture of it away with it.
 *
 * This module already exists for exactly that shape of problem (docs/11), so
 * a negated item goes through it. The one difference is where the snapshot
 * comes from: the engine hands over its own clone for items that never reached
 * the stack, while a negated item WAS on the stack and on this client's screen
 * a render ago, so main.ts remembers it. Seeds 6120-6199.
 */

const negEv = (id: number, msg = 'thing is negated → bin.'): EngineEvent =>
  ({ type: 'negated', msg, data: { id } });

test('negatedIds reads the ids off the event and ignores everything else', () => {
  assert.deepEqual(negatedIds([negEv(4), flashEv(9), negEv(7)]), [4, 7]);
  assert.deepEqual(negatedIds([flashEv(1)]), []);
  assert.deepEqual(negatedIds([]), []);
  // a malformed payload is not an id
  assert.deepEqual(negatedIds([{ type: 'negated', msg: '', data: {} }]), []);
});

test('a remembered item comes back stamped negated — that stamp is the client\'s', () => {
  // GameState never carries `negated` any more: E.negate() sets it on a copy
  // it has already detached and then drops. So this is the ONLY source of a
  // negated item anywhere in the client, and it is what the board greys.
  const remembered = new Map([[5, item(5)]]);
  assert.equal(remembered.get(5)!.negated, false, 'the live item never was');
  const out = negatedFlashItems([negEv(5)], remembered);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 5);
  assert.equal(out[0]!.negated, true);
  assert.equal(remembered.get(5)!.negated, false, 'and the snapshot is not edited in place');
});

test('an id the client never drew gets no beat rather than a wrong one', () => {
  assert.deepEqual(negatedFlashItems([negEv(99)], new Map()), [],
    'remembering what you drew can only ever fail to a MISSING beat');
});

test('queueFlashes takes both sources — the engine\'s snapshots and ours', () => {
  const remembered = new Map([[5, item(5)]]);
  const q = queueFlashes([], [flashEv(1), negEv(5)], 0, remembered);
  assert.deepEqual(q.map(f => f.item.id), [1, 5]);
  assert.deepEqual(q.map(f => f.item.negated), [false, true]);
  assert.deepEqual(q.map(f => f.at), [0, STAGGER_MS], 'and they queue like any other batch');
  // …and with nothing remembered the negation is simply not a beat
  assert.deepEqual(queueFlashes([], [negEv(5)], 0).map(f => f.item.id), []);
});

test('a negated beat is NOT a phantom stack slot for the motion layer', () => {
  // A normal flash never touched state.stack, so its key is born in the after
  // census and the card flies ONTO the stack. A negated item's key was really
  // there and is really gone, and its card is really travelling to a bin — a
  // phantom would keep the key alive across the diff and cancel that flight.
  const q = queueFlashes([], [flashEv(1), negEv(5)], 0, new Map([[5, item(5)]]));
  const rows = stackRows([], q, STAGGER_MS);       // both have arrived by now
  assert.deepEqual(rows.map(r => r.item.id), [1, 5], 'both have their beat on screen');
  assert.deepEqual(censusFlashes(rows).map(r => r.item.id), [1], 'only one is a phantom');
  // a real (non-flashing) stack row is never a phantom either
  assert.deepEqual(censusFlashes(stackRows([item(10)], [], 0)), []);
});

test('the beat and the flight to the bin both happen, and neither eats the other', () => {
  // end to end, against the engine: Godray answered by Frosted Denial.
  const h = new Harness(6120);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as 0 | 1;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 2);                       // Godray ll/2
  giveResources(h, D, 'water', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  for (let g = 0; g < 40 && h.state.decision; g++) {
    const d = h.state.decision;
    h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : 0 });
  }
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Godray') });
  pick(h, { player: D });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Frosted Denial') });
  for (let g = 0; g < 10 && h.state.decision; g++) {
    const d = h.state.decision;
    h.do({ type: 'decide', seat: d.seat, choice: 0 });
  }
  const godray = h.state.stack.find(i => i.card === 'Godray')!;
  assert.ok(godray, 'it is on the stack, about to be answered');

  // what the client does: remember the stack, then act
  const remembered = new Map(h.state.stack.map(i => [i.id, structuredClone(i)]));
  const before = census(h.state);
  let events: EngineEvent[] = [];
  for (let g = 0; g < 4 && !events.some(e => e.type === 'negated'); g++) {
    const d = h.state.decision;
    if (d) {
      const i = d.options.findIndex(o => o.label === 'let it be negated');
      events = events.concat(h.do({ type: 'decide', seat: d.seat, choice: i >= 0 ? i : 0 }));
    } else events = events.concat(h.do({ type: 'passPriority', seat: h.state.priority! }));
  }

  // R68: gone from the rules stack immediately, and in the bin already
  assert.equal(h.state.stack.some(i => i.id === godray.id), false, 'off the stack at once');
  assert.ok(h.state.players[A]!.bin.includes('Godray'), 'and binned at that same instant');
  // …and it emitted only `negated`, never a second `resolved` for the victim
  assert.deepEqual(
    events.filter(e => e.type === 'resolved').map(e => e.data?.['id']),
    events.filter(e => e.type === 'resolved').map(e => e.data?.['id']).filter(id => id !== godray.id),
    'a negated item does not also resolve',
  );

  // the beat: a greyed Godray on the VISUAL stack, which is otherwise empty
  const q = queueFlashes([], events, 0, remembered);
  const rows = stackRows(h.state.stack, q, 0);
  const beat = rows.find(r => r.item.id === godray.id)!;
  assert.ok(beat, 'the player still gets to see what was answered');
  assert.equal(beat.flashing, true);
  assert.equal(beat.item.negated, true);
  assert.equal(beat.top, false, 'an answered item resolves next to nothing');

  // the flight: the card still travels stack → bin in this very frame
  const phantom = censusFlashes(rows).map(r => ({
    key: `s${r.item.id}`, zone: 'stack' as const, seat: r.item.controller,
    card: r.item.card ?? '', anchor: '@stack',
  }));
  const after = census(h.state);
  const moves = diffCensus(before, { ...after, slots: [...phantom, ...after.slots] }).moves;
  const flight = moves.find(m => m.from === `s${godray.id}`)!;
  assert.ok(flight, 'the negated card is seen leaving the stack');
  assert.equal(flight.kind, 'move');
  assert.equal(flight.toAnchor, `@bin:${A}`, 'and landing in its owner\'s bin');
});
