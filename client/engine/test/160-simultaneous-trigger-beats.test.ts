/* R189 — playtest report #105 (GYSR, 2026-08-25), CARD-TODO #72.
 *
 * THE REPORT, verbatim: *"All triggers from death (and after combat) should go
 * onto the stack VISUALLY at the same time. The Geode's trigger did, but not
 * visually."*
 *
 * ⚠ NOTE THE PRECISION. He says the trigger DID reach the stack. The objection
 * is that the SCREEN staged them one after another, so this is the pacing
 * layer and nothing here may change when anything actually resolves. The
 * instructive counterpart is report #53 (*"damage and all effects happened
 * instantly"*), which asked for the opposite. Neither "stage more" nor "stage
 * less" is the rule:
 *
 *     A BATCH THAT IS SIMULTANEOUS IN THE RULES MUST LOOK SIMULTANEOUS,
 *     AND A SEQUENCE MUST LOOK SEQUENTIAL.
 *
 * A one-directional test is exactly how #53 and #105 came to contradict each
 * other, so every fixture below is read BOTH ways.
 *
 * ── WHAT THE REPLAY SHOWED ───────────────────────────────────────────
 *
 * GYSR replays 306/306 FAITHFUL. The moment is action [135], not [140] (the
 * report's index is his own count): combat damage kills four units at once and
 * queues THREE death triggers in one sweep —
 *
 *     died · triggered(Maw of Despair) · died · triggered(Sacrifice Dude)
 *          · died · triggered(Geode)          ← all three, action [135]
 *     FLASH(53) …  action [136]   ⎫ each stopped on a decision of his, so each
 *     FLASH(56) …  action [137]   ⎬ reached the client in an update of its own
 *     FLASH(58) …  action [138]   ⎭
 *
 * So at HIS moment the three flashes were three separate server round-trips
 * with his own answers in between, and no pacing rule can honestly merge them
 * (the last test in this file pins that they are not merged). The GENERAL form
 * of his complaint — and the form CT-72 states as its verify line, "triggers
 * that reach the stack in one batch appear on screen in one beat" — is the
 * shape one action further along the same corpus, SMVJ [141]:
 *
 *     triggered ×4 · FLASH(59) · FLASH(60) · FLASH(62) · FLASH(64)
 *
 * four death triggers, one action, one update — drawn 280ms apart, one at a
 * time. That is what this file fixes.
 *
 * ── R261 TOOK THIS FILE'S FIXTURE AND LEFT ITS RULE ──────────────────
 *
 * ⚠ THE FIXTURE USED TO BE A COMBAT DEATH SWEEP, and every test below was
 * built on it. `deathSweep(seed, swift)` attacked with The Foretold and Good
 * Whale into three blocking Geodes (1/1, *"When I spawn or die, Create a
 * Crystal 1"*), so combat damage killed all three at once and their three
 * death triggers resolved unanswerably between the sub-steps — three
 * `stackFlash` events, one action, nothing to answer. Its `swift: true` arm
 * put a Dune Drifter in front, so the Swift sub-step's death resolved before
 * the normal sub-step killed the other two: ONE update, TWO generations, which
 * is #53's direction.
 *
 * R261 (owner, 2026-08-30) moved every combat-damage and combat-death trigger
 * to the AFTER-COMBAT window, where it goes on the real stack and both seats
 * may respond. A trigger on the stack emits `stackPushed`, never `stackFlash`.
 * So the whole fixture went to zero and its own positive control caught it:
 *
 *     assert.equal(flashes.length, 3, `three death triggers resolved unanswerably`)
 *     // → 'three death triggers resolved unanswerably (0)'
 *
 * R189's RULE is untouched — it is about how the client PACES a batch, and it
 * still has to pace one. What had to be rebuilt is the segment the batch comes
 * out of, and the search for one is worth writing down, because it is short:
 *
 *   · BATTLE is out. `processTriggerQueue`'s `battleMode` is now plain
 *     `phase === 'battle'`, so in battle every trigger goes on the stack.
 *   · DEPLOYMENT is out, and was already out before R261: R144(a) routes
 *     deployment triggers through the stack too (`stackMode` includes
 *     'deploy'). Measured, not assumed — a Geode deployed under a real
 *     `playCard` logs `triggered · stackPushed · resolved`, and the only
 *     `stackFlash` in that action is the unit CARD.
 *   · REGROUP fires nothing that queues.
 *
 * That leaves the HASTE STEP (R18) — `phase === 'planning'`, a hidden
 * simultaneous segment with no priority windows at all, where `playAtTiming`
 * commits with `then = 'resolve'` and the triggers the play causes drain
 * immediately. It is the last place in the engine where a trigger resolves
 * without ever being respondable, and it is where this file now lives.
 *
 * ⚠ ONE THING THE HASTE STEP CANNOT PRODUCE, and it is why the shapes below
 * are not a one-for-one port: a TRIGGER-TO-TRIGGER cascade. A second
 * generation needs a trigger whose resolution queues another trigger, and over
 * the whole printed pool there is no such pair reachable from a haste-step play
 * without a decision in the middle (the near miss is Engorged Caudex drawing a
 * card into Galerider Eel's `handEntered`, and the Eel is *"during battle"*).
 * The sequence direction is therefore read off the cut that IS there and is
 * just as real: the card that was played is one generation, and the triggers it
 * caused are the next.
 *
 * ── THE FIXTURE ─────────────────────────────────────────────────────
 *
 * `hasteSweep(seed, n)`: n copies of ENGORGED CAUDEX (*"When another nontoken
 * ally spawns, [Switch1] Draw a card"* — no target, no choice, no decision)
 * stand on the board; a {Haste} TIDAL MENACE is played in the haste step. Its
 * spawn queues all n triggers before any of them drains, so the batch is
 *
 *     cardPlayed · FLASH(unit) · spawned · triggered ×n · FLASH ×n
 *
 * — one action, one update, two generations, the second of which is n cards at
 * once. Both of the report's directions out of one board, which is what the old
 * fixture's two arms were for.
 *
 * ⚠ GUARD THE FEEDING, NOT THE STAGER. R173 had to widen #53's guards because
 * they called the pure stager on hand-written arrays: they proved it COULD
 * stage and could not fail if the client stopped feeding it. So the load-
 * bearing tests here drive the real ui/main.ts through test/ui-driver.ts, and
 * cutting `absorbFlashes(m.events)` to `absorbFlashes([])` reddens all of them.
 *
 * Seeds 6180-6199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { viewFor } from '../../server/view.ts';
import { flashBatches, flashItems, queueFlashes, STAGGER_MS } from '../../ui/flash.ts';
import { give, giveResources, spawn, toDeployment } from './util.ts';
import { client } from '../../ui/test/ui-driver.ts';
import type { Action, EngineEvent, EntityId, Seat } from '../src/types.ts';

/** the real client, driven — see test/ui-driver.ts */
const ui = await client();

/* ── the clock ──────────────────────────────────────────────────────────
 *
 * ui/main.ts reads Date.now() directly (ui/flash.ts never does — the reading
 * is passed in, which is the whole reason it is testable). A beat queue is
 * arithmetic ON A CLOCK, so a test that cannot move the clock can only ever
 * see the first frame. `at()` lends the client a stopped one.
 *
 * The readings only ever go FORWARD across the file: R150's pace queue
 * remembers the moment it last released, and a clock that jumps backwards
 * between tests would make one test's throttle state decide the next one's.
 */
const REAL_NOW = Date.now;
let base = 6_000_000;
function at<T>(now: number, fn: () => T): T {
  Date.now = () => now;
  try { return fn(); } finally { Date.now = REAL_NOW; }
}

/** the stack items on the strip right now, out of the ones we are asking about
 * — read through the driver's own attribute matcher, so it survives a reorder
 * of the markup it is about */
const onStrip = (ids: readonly number[]): number[] =>
  ids.filter(id => ui.has({ act: 'stackitem', id }));

interface Sweep {
  h: Harness;
  seat: Seat;
  /** the unit the play put on the board */
  unit: EntityId;
  events: EngineEvent[];
  /** the CARD the play flashed — a generation of its own */
  card: number;
  /** the n trigger flashes it caused — one generation, together */
  triggers: number[];
  /** all of them, in event order */
  flashes: number[];
}

/**
 * One real haste-step play, in the last segment of the engine where a trigger
 * resolves without ever being respondable. See the R261 note in the header for
 * why it is not a combat death sweep any more.
 *
 * Everything about the batch that the tests below depend on is asserted HERE,
 * because a fixture that has quietly stopped reproducing the report is worse
 * than no fixture — and under R261 the failure mode is specifically an EMPTY
 * subject set, which passes and looks exactly like a fixture that works.
 */
function hasteSweep(seed: number, listeners: number): Sweep {
  const h = new Harness(seed);
  toDeployment(h);
  const seat = h.state.deployPlayer! as Seat;
  for (let i = 0; i < listeners; i++) spawn(h, seat, 'Engorged Caudex');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.state.initiative = seat;
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.equal(h.state.phase, 'planning', 'the haste step — R18, and the last unrespondable '
    + 'segment a trigger can resolve in (R261 took the other two)');
  giveResources(h, seat, 'water', 6);
  const idx = give(h, seat, 'Tidal Menace');            // {Haste}, nontoken, 7/2
  const mark = h.events.length;
  const events = h.do({ type: 'playCard', seat, handIndex: idx }).slice();
  assert.equal(h.events.length - mark, events.length, 'the batch is exactly this one action');
  assert.equal(h.state.decision, null,
    'nothing in this play stops to ask anybody anything — the whole report is about a '
    + 'moment nobody could act in');
  assert.equal(h.state.stack.length, 0,
    'and nothing is on the REAL stack afterwards: everything here resolved unanswerably, '
    + 'which is the property R261 left in exactly one segment');

  const items = flashItems(events);
  assert.equal(items.length, listeners + 1,
    `the card and its ${listeners} triggers all flashed (${items.length})`);
  assert.equal(items[0]!.kind, 'unit', 'the play itself flashes first');
  const triggers = items.slice(1);
  assert.ok(triggers.length > 0 && triggers.every(i => i.kind === 'triggered'),
    'and the rest are TRIGGERS — a non-empty subject set, asserted because an empty one '
    + 'would make every screen assertion below pass vacuously');
  assert.equal(events.filter(e => e.type === 'triggered').length, listeners,
    'each of them carries the queue marker that says it was queued in this batch (R189 is '
    + 'positive evidence only)');

  const unit = Object.values(h.state.entities)
    .find(e => e.card === 'Tidal Menace' && e.controller === seat)!;
  return {
    h, seat, unit: unit.id, events,
    card: items[0]!.id,
    triggers: triggers.map(i => i.id),
    flashes: items.map(i => i.id),
  };
}

/** put the fixture's board and batch in front of the real client at `now`.
 *
 * The legal list is deliberately NON-EMPTY. R150's holdable() holds an update
 * the player cannot act on, and a held update never reaches absorbFlashes at
 * all — so an empty list would make every assertion below depend on how many
 * updates ran earlier in the same process rather than on the beat queue. (The
 * same construction note #53's guards carry, and for the same reason.)
 */
function show(s: Sweep, now: number): void {
  const legal: Action[] = [{ type: 'doneHaste', seat: s.seat }];
  at(now, () => {
    ui.join(viewFor(s.h.state, s.seat), s.seat, legal);   // resetUi() → a clean beat queue
    ui.update(viewFor(s.h.state, s.seat), legal, { events: s.events });
  });
}

/* ── the report ─────────────────────────────────────────────────────── */

test('R189 THE REPORT: a trigger sweep puts every trigger on the strip in ONE frame', () => {
  const now = (base += 100_000);
  const s = hasteSweep(6181, 3);
  assert.equal(s.triggers.length, 3, 'three triggers to be simultaneous about');
  show(s, now);

  // the first frame is the CARD that was played: it resolved before any of the
  // triggers was even queued, so it is a generation of its own (#53's
  // direction, and the third test below is about exactly this).
  assert.deepEqual(onStrip(s.triggers), [],
    'not one of the three has had its beat yet');

  // …and one stagger later they arrive TOGETHER. Nothing has been ticked
  // twice, no trigger is ahead of another: this is the frame the batch
  // produced, and it is report #105 exactly — "they should go onto the stack
  // visually at the same time".
  at(now + STAGGER_MS, () => ui.tick());
  assert.deepEqual(onStrip(s.triggers), s.triggers,
    'the three triggers were queued together in the rules and must be on the strip together '
    + 'on the screen');
});

test('R189 a beat explains and never gates: the board under it is already final', () => {
  const now = (base += 100_000);
  const s = hasteSweep(6182, 3);
  const hand = s.h.state.players[s.seat]!.hand.length;
  show(s, now);
  at(now + STAGGER_MS, () => ui.tick());
  assert.deepEqual(onStrip(s.triggers), s.triggers, 'the beats really are playing');

  // docs/11's contract, and the half of the ticket that says the fix must not
  // change when anything RESOLVES: the pacing is over the strip, never over
  // the table. In the same frame that is still showing the beats, the unit the
  // play made is drawn and clickable…
  assert.ok(ui.has({ act: 'unit', id: s.unit }),
    'the Tidal Menace is on the board in the frame the beat is playing in');
  // …and every card the three triggers drew is already in the hand the client
  // is drawing. A hand of `hand` cards has a last index of `hand - 1`; asking
  // for `hand` as well is the positive control that this counts anything.
  assert.ok(ui.has({ act: 'hand', p: s.seat, i: hand - 1 }),
    'the drawn cards are in the hand under the beat, not held back behind it');
  assert.ok(!ui.has({ act: 'hand', p: s.seat, i: hand }),
    'and the hand really is that size — the index above is not one the markup hands out freely');
});

/* ── the other direction (#53) ──────────────────────────────────────── */

test('R189 a play and the triggers it caused are TWO beats, and the second is three cards at once', () => {
  const now = (base += 100_000);
  const s = hasteSweep(6183, 3);
  show(s, now);
  assert.deepEqual(onStrip(s.flashes), [s.card],
    'the card RESOLVED before any of the triggers it caused was queued, so it is a generation '
    + 'of its own and must not be swept into their beat — this is report #53 direction and '
    + 'collapsing the whole batch would break it');

  // one stagger later the triggers arrive — together, because they are one
  // sweep, exactly like the test above
  at(now + STAGGER_MS, () => ui.tick());
  assert.deepEqual(onStrip(s.flashes), s.flashes,
    'and when the second generation arrives it arrives WHOLE');
  assert.deepEqual(onStrip(s.triggers), s.triggers, 'all three of it, in the same frame');
});

test('R189 a second batch queues behind the first — two updates are never one beat', () => {
  const now = (base += 100_000);
  const one = hasteSweep(6184, 3);
  const two = hasteSweep(6185, 3);
  // two boards, two sweeps: the ids are minted per game and would collide,
  // which the client would (correctly) read as a resync replaying a beat
  assert.deepEqual(one.flashes, two.flashes, 'same ids, as two separate games mint them');

  show(one, now);
  at(now + STAGGER_MS, () => ui.tick());
  assert.deepEqual(onStrip(one.flashes), one.flashes, 'the first sweep, whole');

  // a SECOND action's sweep arrives 10ms later. Its beat lines up BEHIND the
  // one already playing — a batch is one beat, not "every batch is now".
  const later = hasteSweep(6186, 3);
  const legal: Action[] = [{ type: 'doneHaste', seat: later.seat }];
  at(now + STAGGER_MS + 10,
    () => ui.update(viewFor(later.h.state, later.seat), legal, { events: later.events }));
  assert.deepEqual(onStrip(later.flashes), one.flashes,
    'ids repeat across games, so all this frame can say is that nothing NEW appeared: the '
    + 'second sweep has not had its beat yet');
});

/* ── the classifier, on real events ─────────────────────────────────── */

test('R189 flashBatches cuts a real batch where the RULES cut it', () => {
  const three = hasteSweep(6187, 3).events;
  assert.deepEqual(flashBatches(three).map(g => g.length), [1, 3],
    'the play is one generation and the three triggers it caused are the next — and the '
    + 'second one holds all three');

  const one = hasteSweep(6188, 1).events;
  assert.deepEqual(flashBatches(one).map(g => g.length), [1, 1],
    'one listener, one trigger: the cut is in the same place and neither side is a fan');

  const two = hasteSweep(6189, 2).events;
  assert.deepEqual(flashBatches(two).map(g => g.length), [1, 2],
    'and the grouping really does track the number of triggers the rules queued together, '
    + 'rather than any fixed shape of the batch');
});

test('R189 positive evidence only: flashes with no queue marker keep a beat each', () => {
  const { events } = hasteSweep(6190, 3);
  const bare = events.filter(e => e.type === 'stackFlash');
  assert.equal(events.filter(e => e.type === 'triggered').length, 3, 'three markers…');
  assert.equal(bare.length, 4, '…the three flashes they account for, and the card play');

  assert.deepEqual(flashBatches(events).map(g => g.length), [1, 3],
    'with the markers, the batch says the three were queued together: one beat');

  // The SAME four real items, in a batch that says nothing at all about how
  // they got there. That is not a hypothetical: GYSR's own moment is this
  // shape one flash at a time — the three markers were spent at action [135]
  // and the flashes arrived at [136], [137] and [138], each in an update whose
  // marker the client had already seen and spent three updates earlier.
  //
  // A batch with no evidence gets the pre-R189 answer, a beat each. This is
  // the conservative gate the whole fix rests on: it is why R189 never has to
  // widen 56-ui-flash's docs/11 guards ("a batch arrives as a sequence, not a
  // fan"), and why a deployment reveal of six cards is still six beats.
  assert.deepEqual(flashBatches(bare).map(g => g.length), [1, 1, 1, 1],
    'no marker, no grouping — the client never invents a simultaneity the wire did not show it');
  assert.deepEqual(queueFlashes([], bare, 0).map(f => f.at),
    [0, STAGGER_MS, STAGGER_MS * 2, STAGGER_MS * 3],
    'and the queue still spaces them exactly as it did before R189');
});
