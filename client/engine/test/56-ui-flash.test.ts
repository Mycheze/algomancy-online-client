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
  censusFlashes, combatStages, dueBeats, flashItems, heldLines, leadRow, negatedFlashItems,
  negatedIds, nextBeatWake, nextFlashWake, pruneFlashes, queueBeats, queueFlashes,
  stackCaption, stackRows, visibleFlashes,
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
  // the Sprite itself: played during deployment, so it goes from hand to board
  // with no journey at all, and the flash is the only thing that shows it
  assert.ok(flashed.length >= 1, 'something was announced');
  assert.equal(flashed[0]!.card, 'Ignis Sprite');
  assert.equal(flashed[0]!.controller, seat);
  // R144(a): its SPAWN TRIGGER is a different matter now. This used to assert
  // `flashed.some(f => f.kind === 'triggered')` — the trigger resolved without
  // ever reaching state.stack, so a flash was all the reader could be given.
  // Deployment triggers use the real stack now, so the trigger has a real
  // stackPushed/resolved pair of its own and flashing it as well would draw it
  // twice. A flash is for what the stack never showed; nothing regressed here,
  // the trigger simply stopped qualifying.
  assert.ok(!flashed.some(f => f.kind === 'triggered'),
    'the spawn trigger is NOT flashed — R144 put it on the real stack instead');
  assert.ok(events.some(ev => ev.type === 'stackPushed'),
    'and it announced itself there, which is where the reader now finds it');
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
  // three flashes that are NOT one trigger batch (R189) — three separate
  // things, so three groups, one item each
  const q = queueFlashes([], [flashEv(1), flashEv(2), flashEv(3)], 0);
  assert.deepEqual(q.map(f => f.at), [0, STAGGER_MS, STAGGER_MS * 2],
    'distinct arrivals, one tempo-step apart — this is the whole claim of this test');
  assert.equal(visibleFlashes(q, 0).length, 1);
  assert.equal(visibleFlashes(q, STAGGER_MS).length, 2, 'the next arrives before the first has gone');
  // ⚠ THIS NUMBER MOVED WITH R242 AND THE MOVE IS DELIBERATE. It used to be 3:
  // at STAGGER_MS = 280 a whole batch of separate items piled up inside one
  // HOLD_MS and sat there together. The tempo is a full second now (the
  // client-wide ceiling — see ui/flash.ts's header), so consecutive SEPARATE
  // things hand over instead of piling: #1 has had its 1200ms beat by the time
  // #3 lands. Items that are genuinely SIMULTANEOUS still share an arrival and
  // still pile — that is R189's grouping, and 218 §2 is the test of it.
  assert.equal(visibleFlashes(q, STAGGER_MS * 2).length, 2,
    'a sequence hands over; only a simultaneous batch piles');
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
  h.do({ type: 'decide', seat: dec.seat, choice: dec.options.findIndex(o => o.value === want) });
  // R57: the Singularity's "[create X 1/1s or become base X/X]" is a modal
  // bracket, declared in the same cast window right after X. Answering IT is
  // what completes the cast, so this is the call whose events carry the beat.
  const mode = h.state.decision!;
  assert.equal(mode.kind, 'mode', 'the half is asked at cast, after X');
  const events = h.do({ type: 'decide', seat: mode.seat, choice: 0 });
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

/* ── R78: the item that is RESOLVING is on the strip, and reads as pending ──
 *
 * Bena: "to my opponent, it looks like something already resolved and there's
 * something confusing about seeing 'xyz resolves' while your opponent is
 * actually choosing how their effect resolves… it would make more sense if
 * there was a different state before resolution like 'Opponent is resolving
 * [effect]' and leave the effect on the stack until it's ACTUALLY resolved."
 *
 * The engine half is GameState.resolving — a whole StackItem, kept OUT of
 * s.stack so the "negate every effect on the stack" sweeps cannot reach it.
 * These pin the display half: it is on the visual stack, it is distinct from
 * both beats, it says whose it is, and it goes when the resolution finishes.
 */

const names = ['Alice', 'Bob'];
const theirs = (id: number): StackItem => ({ ...item(id), controller: 1 });

test('a resolving item is on the visual stack, last and marked', () => {
  const rows = stackRows([item(1), item(2)], [], 0, item(9));
  assert.deepEqual(rows.map(r => r.item.id), [1, 2, 9],
    'rightmost: nothing overlaps the thing that is actually happening');
  const res = rows[2]!;
  assert.equal(res.resolving, true);
  assert.equal(res.flashing, false, 'it has NOT resolved — that is the whole report');
  assert.equal(res.top, false, 'and it is not "next" either: next is what is still waiting');
  // the real top of the real stack keeps its own mark — item 2 is still next
  assert.deepEqual(rows.filter(r => r.top).map(r => r.item.id), [2]);
  assert.deepEqual(rows.filter(r => r.resolving).map(r => r.item.id), [9], 'exactly one');
});

test('a resolving item is never drawn as a resolved beat', () => {
  const rows = stackRows([], [], 0, item(9));
  assert.deepEqual(rows.map(r => [r.flashing, r.resolving]), [[false, true]]);
  // the three states of a card on the strip are mutually exclusive
  const beat = stackRows([], queueFlashes([], [flashEv(1)], 0), 0)[0]!;
  assert.equal(beat.flashing, true);
  assert.equal(beat.resolving, false);
  const answered = stackRows([], queueFlashes([], [negEv(5)], 0, new Map([[5, item(5)]])), 0)[0]!;
  assert.equal(answered.item.negated, true);
  assert.equal(answered.resolving, false);
  // …and the caption never calls a resolving item resolved
  const verb = stackCaption(rows, { mySeat: 0, names })!.verb;
  assert.doesNotMatch(verb, /resolved|answered/, `"${verb}" must not read as finished`);
});

test('the caption says WHOSE it is, from both seats', () => {
  const rows = stackRows([], [], 0, theirs(9));       // seat 1's effect
  const mine = stackCaption(stackRows([], [], 0, item(9)), { mySeat: 0, names })!;
  const opp = stackCaption(rows, { mySeat: 0, names })!;
  // seat 0 watching seat 1: the report's exact ask
  assert.equal(opp.verb, 'Bob is resolving');
  assert.equal(opp.pending, true);
  // seat 1 watching their OWN: the prompt bar above is already asking them in
  // their own name, so the table does not repeat it
  assert.equal(stackCaption(rows, { mySeat: 1, names })!.verb, 'resolving now');
  assert.equal(mine.verb, 'resolving now', 'seat 0 watching seat 0');
  // hotseat has no "me": both seats are the player, so both get named
  assert.equal(stackCaption(rows, { mySeat: null, names })!.verb, 'Bob is resolving');
  // and the name is never printed twice — the verb already carried it
  assert.equal(opp.by, null);
  assert.equal(stackCaption(stackRows([item(1)], [], 0), { mySeat: 0, names })!.by, 'Alice');
});

test('what is HAPPENING leads the caption over what is next', () => {
  const rows = stackRows([item(1), item(2)], [], 0, theirs(9));
  assert.equal(leadRow(rows)!.item.id, 9, 'not the top of the stack, which is only waiting');
  assert.equal(stackCaption(rows, { mySeat: 0, names })!.row.item.id, 9);
  // with nothing resolving the old order is untouched
  assert.equal(leadRow(stackRows([item(1), item(2)], [], 0))!.item.id, 2);
  assert.equal(stackCaption(stackRows([item(1), item(2)], [], 0), { names })!.verb, 'resolves next');
  assert.equal(stackCaption(stackRows([item(1)], [], 0), { names })!.verb, 'on the stack');
  assert.equal(stackCaption([], {}), null, 'and an empty strip captions nothing');
});

test('it clears the instant the resolution finishes', () => {
  // the marker is the ONLY thing keeping it on screen: hand back null and the
  // card is gone, exactly as it is gone from the engine
  assert.deepEqual(stackRows([item(1)], [], 0, item(9)).map(r => r.item.id), [1, 9]);
  assert.deepEqual(stackRows([item(1)], [], 0, null).map(r => r.item.id), [1]);
  assert.deepEqual(stackRows([], [], 0, null), [], 'and nothing is left behind');
  // the default keeps every pre-R78 caller honest
  assert.deepEqual(stackRows([item(1)], [], 0).map(r => r.resolving), [false]);
});

test('a resolving item is drawn ONCE, whatever else the queue is holding', () => {
  // a resync could hand the client a stale beat for the very item that is now
  // resolving; two cards on the strip would read as two copies of the spell
  const q = queueFlashes([], [flashEv(9)], 0);
  assert.deepEqual(stackRows([], q, 0).map(r => r.item.id), [9], 'the beat alone');
  const rows = stackRows([], q, 0, item(9));
  assert.deepEqual(rows.map(r => r.item.id), [9]);
  assert.equal(rows[0]!.resolving, true, 'and the live state wins over the stale beat');
});

test('a resolving item is a PHANTOM stack slot — its card goes nowhere yet', () => {
  // mirror of the negated case. Its s<id> key really was in the census a
  // render ago and is really out of state.stack now, but the card has not
  // moved: it is mid-resolution and still drawn. Without the phantom the diff
  // sees the key vanish and flies the card to a destination that does not
  // exist yet — the spell is not in the bin until the resolution finishes.
  const rows = stackRows([item(1)], [], 0, item(9));
  assert.deepEqual(censusFlashes(rows).map(r => r.item.id), [9]);
  // and once it is over, nothing is a phantom and the card is free to travel
  assert.deepEqual(censusFlashes(stackRows([item(1)], [], 0)), []);
});

test('end to end: the strip holds the spell while its controller is still choosing', () => {
  // Recall asks "choose a unit to recall" DURING resolution, which is exactly
  // the window the report is about: pre-R78 the item was off the stack, "X
  // resolves." was already in the log, and the board had not changed.
  const h = new Harness(5680);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as 0 | 1;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Unit Token');
  spawn(h, D, 'Unit Token');   // more than one candidate, so Recall must ASK
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  for (let g = 0; g < 40 && h.state.decision; g++) {
    const d = h.state.decision!;
    h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : 0 });
  }
  const me = h.state.priority!;
  giveResources(h, me, 'water', 8);
  h.do({ type: 'playCard', seat: me, handIndex: give(h, me, 'Recall') });
  for (let g = 0; g < 8 && h.state.decision; g++) {
    const d = h.state.decision!;
    h.do({ type: 'decide', seat: d.seat, choice: 0 });
  }
  const id = h.state.stack.find(i => i.card === 'Recall')!.id;
  h.do({ type: 'passPriority', seat: h.state.priority! });
  if (h.state.stack.length) h.do({ type: 'passPriority', seat: h.state.priority! });

  // mid-resolution: off the rules stack, and the engine says so
  assert.equal(h.state.stack.some(i => i.id === id), false, 'R78: s.stack is what is WAITING');
  assert.equal(h.state.resolving?.id, id, 'and this is what is happening');
  assert.ok(h.state.decision, 'its controller is being asked something');

  const rows = stackRows(h.state.stack, [], 0, h.state.resolving ?? null);
  const row = rows.find(r => r.item.id === id)!;
  assert.ok(row, 'the card is still on the table — it has not "already resolved"');
  assert.equal(row.resolving, true);
  assert.equal(row.flashing, false);
  const watcher = (1 - me) as 0 | 1;
  const cap = stackCaption(rows, { mySeat: watcher, names: h.state.players.map(p => p.name) })!;
  assert.equal(cap.pending, true);
  assert.equal(cap.verb, `${h.state.players[me]!.name} is resolving`);
  assert.equal(cap.row.item.id, id);

  // answer it → the resolution finishes and the marker goes with it
  for (let g = 0; g < 8 && h.state.decision; g++) {
    const d = h.state.decision!;
    h.do({ type: 'decide', seat: d.seat, choice: 0 });
  }
  assert.equal(h.state.resolving ?? null, null, 'nothing is resolving any more');
  assert.deepEqual(
    stackRows(h.state.stack, [], 0, h.state.resolving ?? null).filter(r => r.item.id === id), [],
    'and the card has left the strip, now that it really is done',
  );
});

/* ── R80: narrative beats — a combat step told one stage at a time ─────── */

/* UFAB: "Neither of us had anything to do during the end of that combat, but
 * damage and all effects happened instantly. We should have been able to see,
 * much slower, what happened and how much damage went through."
 *
 * The grouping has to come out of the batch as the engine already emits it —
 * no `data.sub` on the damage events, no engine change at all. What IS in the
 * batch is the 'combatDamage' header, the pump's alternation between damage
 * and the checkDeaths() sweep after it, and the 'afterCombat' bookend. */

const ev = (type: EngineEvent['type'], msg: string, data?: Record<string, unknown>): EngineEvent =>
  ({ type, msg, ...(data ? { data } : {}) });

/** the shape engine.ts emits for one unblocked column hitting a player */
const simpleCombat = (): EngineEvent[] => [
  ev('combatDamage', 'Combat damage (simultaneous):', { region: 0 }),
  ev('lifeLost', 'Ben loses 4 life (combat) → 24.', { seat: 0, n: 4 }),
  ev('afterCombat', 'After-combat step.', { region: 0 }),
];

test('a combat batch is cut at the seams the pump already leaves', () => {
  const stages = combatStages(simpleCombat());
  assert.deepEqual(stages.map(s => [s.kind, s.lines]), [['strike', 2], ['after', 1]]);
  assert.deepEqual(stages[0]!.keys, ['@life:0'], 'the strike points at who was hit');
});

test('damage, then what it killed, then the after-step — three beats', () => {
  const stages = combatStages([
    ev('combatDamage', 'Combat damage (simultaneous):'),
    ev('damage', 'Ember of Life takes 1 (1 total).', { unit: 45, n: 1 }),
    ev('damage', 'Enigmatic Warder takes 2 (2 total).', { unit: 10, n: 2 }),
    ev('lifeLost', 'Ben loses 16 life (combat) → 11.', { seat: 0 }),
    ev('died', 'Enigmatic Warder dies → bin.', { unit: 10, seat: 1, card: 'Enigmatic Warder' }),
    ev('trashed', 'Rashi trashes Enigmatic Warder (from play).', { seat: 1 }),
    ev('afterCombat', 'After-combat step.'),
    ev('triggered', 'Trigger: Spirit of Nature — create a Poison 2 or a Crystal 2 (after combat).'),
  ]);
  assert.deepEqual(stages.map(s => [s.kind, s.lines]),
    [['strike', 4], ['fallout', 2], ['after', 2]]);
  assert.deepEqual(stages[0]!.keys, ['e45', 'e10', '@life:0']);
  // a dead unit's own key is off the board — the bin is what is left to pulse
  assert.ok(stages[1]!.keys.includes('@bin:1'));
});

test('Swift → normal → Sluggish reads as its own sub-steps, with no engine tag', () => {
  // checkDeaths() runs between every sub-step, so the batch alternates
  // damage-run / death-run all by itself. That alternation IS the grouping.
  const stages = combatStages([
    ev('combatDamage', 'Combat damage (simultaneous):'),
    ev('damage', 'A takes 3 (3 total).', { unit: 1 }),
    ev('died', 'A dies → bin.', { unit: 1, seat: 0 }),
    ev('damage', 'B takes 2 (2 total).', { unit: 2 }),
    ev('lifeLost', 'Ben loses 1 life (combat) → 19.', { seat: 0 }),
    ev('died', 'B dies → bin.', { unit: 2, seat: 0 }),
    ev('damage', 'C takes 9 (9 total).', { unit: 3 }),
    ev('died', 'C dies → bin.', { unit: 3, seat: 1 }),
    ev('afterCombat', 'After-combat step.'),
  ]);
  assert.deepEqual(stages.map(s => s.kind),
    ['strike', 'fallout', 'strike', 'fallout', 'strike', 'fallout', 'after']);
  assert.deepEqual(stages.map(s => s.lines), [2, 1, 2, 1, 1, 1, 1]);
});

test('every line of the batch lands in exactly one stage, in order', () => {
  for (const events of [simpleCombat(), [
    ev('spellPlayed', 'Rashi plays Fight → stack.'),          // before the header
    ev('combatDamage', 'Combat damage (simultaneous):'),
    ev('damage', 'A takes 3 (3 total).', { unit: 1 }),
    ev('stackFlash', ''),                                      // not a log line
    ev('died', 'A dies → bin.', { unit: 1, seat: 0 }),
    ev('afterCombat', 'After-combat step.'),
    ev('phase', 'Battle: Ben may attack.'),
  ]]) {
    const lines = events.filter(e => e.msg);
    const head = lines.findIndex(e => e.type === 'combatDamage');
    const stages = combatStages(events);
    assert.equal(stages.reduce((n, s) => n + s.lines, 0), lines.length - head,
      'the stages cover the header onwards, and nothing before it');
  }
});

test('nothing to pace is paced not at all', () => {
  assert.deepEqual(combatStages([]), []);
  assert.deepEqual(combatStages([ev('phase', 'Battle: Ben may attack.')]), [],
    'a batch with no combat in it');
  assert.deepEqual(combatStages([
    ev('combatDamage', 'Combat damage (simultaneous):'),
    ev('afterCombat', 'After-combat step.'),
  ]), [], 'an unblocked attack into an empty board: nothing landed');
  assert.deepEqual(queueBeats([{ kind: 'strike', lines: 3, keys: [] }], 0), [],
    'and one stage is not a sequence');
});

test('the first beat is NOW — the board is already final under it', () => {
  const q = queueBeats(combatStages(simpleCombat()), 1000);
  assert.equal(q[0]!.at, 1000);
  assert.equal(q[1]!.at, 1000 + HOLD_MS);
  assert.equal(heldLines(q, 1000), 1, 'the after-step line is still held back');
  assert.equal(heldLines(q, 1000 + HOLD_MS), 0, 'and then it is not');
});

test('the queue never runs more than MAX_LEAD_MS behind the board', () => {
  // docs/11's contract: a beat explains, it never gates. A long combat crowds
  // the beats together rather than queueing up for half a minute.
  for (const n of [2, 3, 4, 6, 12, 40]) {
    const stages = Array.from({ length: n }, () => ({ kind: 'strike' as const, lines: 1, keys: [] }));
    const q = queueBeats(stages, 0);
    assert.equal(q.length, n);
    assert.equal(q[0]!.at, 0);
    for (const [i, b] of q.entries()) {
      assert.ok(b.at <= MAX_LEAD_MS, `${n}: beat ${i} at ${b.at}`);
      if (i) assert.ok(b.at >= q[i - 1]!.at, 'and they never go backwards');
    }
    const gap = q[1]!.at - q[0]!.at;
    assert.ok(gap <= HOLD_MS && (gap >= STAGGER_MS || q[n - 1]!.at === MAX_LEAD_MS),
      `${n}: gap ${gap}`);
  }
});

test('a beat is played once, and the wake is the moment the log changes', () => {
  const q = queueBeats(combatStages(simpleCombat()), 0);
  assert.equal(nextBeatWake(q, 0), HOLD_MS);
  assert.deepEqual(dueBeats(q, 0).map(b => b.kind), ['strike']);
  for (const b of dueBeats(q, 0)) b.fired = true;
  assert.deepEqual(dueBeats(q, 0), [], 'a repaint inside the same beat replays nothing');
  assert.deepEqual(dueBeats(q, HOLD_MS).map(b => b.kind), ['after']);
  for (const b of dueBeats(q, HOLD_MS)) b.fired = true;
  assert.equal(nextBeatWake(q, HOLD_MS), null, 'and then the queue is spent');
  assert.equal(heldLines(q, HOLD_MS), 0);
});

test('the beats a real end-of-combat produces, played through the engine', () => {
  // no synthetic events: play a battle to the damage step and stage the batch
  // the client would actually be handed.
  const h = new Harness(5680);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as 0 | 1;
  const att = spawn(h, A, 'Ignis Sprite');
  spawn(h, D, 'Ignis Sprite');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[att]] });
  for (let g = 0; g < 12 && h.state.battle?.step !== 'blocks'; g++) {
    if (h.state.decision) { const d = h.state.decision; h.do({ type: 'decide', seat: d.seat, choice: 0 }); continue; }
    h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });   // unblocked: it hits the player
  let events: EngineEvent[] = [];
  for (let g = 0; g < 12 && !events.some(e => e.type === 'combatDamage'); g++) {
    if (h.state.decision) { const d = h.state.decision; h.do({ type: 'decide', seat: d.seat, choice: 0 }); continue; }
    events = h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  assert.ok(events.some(e => e.type === 'combatDamage'), 'the damage step ran in one batch');
  assert.ok(events.some(e => e.type === 'afterCombat'), '…and the after-step with it');
  const stages = combatStages(events);
  assert.ok(stages.length >= 2, `a real combat is told in stages (${stages.length})`);
  assert.equal(stages[0]!.kind, 'strike');
  assert.equal(stages[stages.length - 1]!.kind, 'after');
  const lines = events.filter(e => e.msg);
  const head = lines.findIndex(e => e.type === 'combatDamage');
  assert.equal(stages.reduce((n, s) => n + s.lines, 0), lines.length - head);
});
