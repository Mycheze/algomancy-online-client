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
 * time. That is what this file fixes, and the fixture below is that shape
 * built from a real combat: Geodes are 1/1 and print "When I spawn or die,
 * Create a Crystal 1", so a column of them dying is a death sweep with nothing
 * to answer.
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
import { flashBatches, flashItems, queueFlashes, STAGGER_MS } from '../ui/flash.ts';
import { pass, spawn, toDeployment, toNextBattle } from './util.ts';
import { client } from './ui-driver.ts';
import type { Action, EngineEvent, Seat } from '../src/types.ts';

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

/* ── the fixture ────────────────────────────────────────────────────────
 *
 * One real combat, two shapes out of one board:
 *
 *   `swift: false`   The Foretold (3/3) and Good Whale (7/5 Piercing) attack
 *                    in two columns; three Geodes block. Everything strikes in
 *                    the normal damage sub-step, so all three die in ONE death
 *                    sweep and all three triggers are queued before any of
 *                    them drains. THE REPORT'S SHAPE.
 *
 *   `swift: true`    the same, with Dune Drifter (2/1 Swift) leading instead.
 *                    engine.ts pumpCombatDamage runs Swift → normal →
 *                    Sluggish with checkDeaths between each, so the Drifter's
 *                    blocker dies and its trigger RESOLVES before the normal
 *                    sub-step kills the other two. One update, two generations:
 *                    a sequence that must still read as one. #53'S DIRECTION.
 *
 * Both are one action and one batch — asserted, because a fixture that has
 * quietly stopped reproducing the report is worse than no fixture.
 */
function deathSweep(seed: number, swift: boolean): {
  h: Harness; D: Seat; events: EngineEvent[]; flashes: number[];
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lead = spawn(h, A, swift ? 'Dune Drifter' : 'The Foretold');
  const whale = spawn(h, A, 'Good Whale');
  const g1 = spawn(h, D, 'Geode'), g2 = spawn(h, D, 'Geode'), g3 = spawn(h, D, 'Geode');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lead], [whale]] });
  pass(h); pass(h);                                    // attack window
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [g1], 1: [g2, g3] } });
  pass(h);                                             // block window
  const mark = h.events.length;
  const events = h.do({ type: 'passPriority', seat: h.state.priority! }).slice();
  assert.equal(h.events.length - mark, events.length, 'the batch is exactly this one action');
  assert.equal(h.state.decision, null,
    'nothing in this combat stops to ask anybody anything — the whole report is about a '
    + 'moment nobody could act in');
  const flashes = flashItems(events).map(i => i.id);
  assert.equal(flashes.length, 3, `three death triggers resolved unanswerably (${flashes.length})`);
  assert.equal(h.state.stack.length, 0, 'and none of them is on the real stack afterwards');
  return { h, D, events, flashes };
}

/** put the fixture's board and batch in front of the real client at `now`.
 *
 * The legal list is deliberately NON-EMPTY. R150's holdable() holds an update
 * the player cannot act on, and a held update never reaches absorbFlashes at
 * all — so an empty list would make every assertion below depend on how many
 * updates ran earlier in the same process rather than on the beat queue. (The
 * same construction note #53's guards carry, and for the same reason.)
 */
function show(h: Harness, D: Seat, events: EngineEvent[], now: number): void {
  const legal: Action[] = [{ type: 'passPriority', seat: D }];
  at(now, () => {
    ui.join(viewFor(h.state, D), D, legal);       // resetUi() → a clean beat queue
    ui.update(viewFor(h.state, D), legal, { events });
  });
}

/* ── the report ─────────────────────────────────────────────────────── */

test('R189 THE REPORT: a death sweep puts every trigger on the strip in ONE frame', () => {
  const now = (base += 100_000);
  const { h, D, events, flashes } = deathSweep(6181, false);
  show(h, D, events, now);

  // …and read the screen at the very moment the update landed. Nothing has
  // been ticked, no timer has fired: this is the frame the batch produced.
  assert.deepEqual(onStrip(flashes), flashes,
    'the three death triggers went onto the stack together in the rules and must be on the '
    + 'strip together on the screen — this is report #105 exactly: "they should go onto the '
    + 'stack visually at the same time"');
});

test('R189 a beat explains and never gates: the board under it is already final', () => {
  const now = (base += 100_000);
  const { h, D, events, flashes } = deathSweep(6182, false);
  // the Crystals THIS BATCH made — a Geode triggers on spawn as well as on
  // death, so the board already held three from the fixture's own setup
  const tokens = events.filter(e => e.type === 'tokenCreated')
    .map(e => e.data?.['id']).filter((id): id is number => typeof id === 'number');
  assert.equal(tokens.length, 3, 'the three death triggers really did each create a Crystal');

  show(h, D, events, now);
  // docs/11's contract, and the half of the ticket that says the fix must not
  // change when anything RESOLVES: the pacing is over the strip, never over
  // the table. Every Crystal is drawn, and clickable, in the same frame that
  // is still showing the beats that made them.
  for (const id of tokens) {
    assert.ok(ui.has({ act: 'token', id }),
      `Crystal ${id} is on the board in the frame the beat is playing in`);
  }
  assert.deepEqual(onStrip(flashes), flashes, 'and the beats really are playing in it');
});

/* ── the other direction (#53) ──────────────────────────────────────── */

test('R189 a Swift wave and a normal wave are TWO beats, and the second is two cards at once', () => {
  const now = (base += 100_000);
  const { h, D, events, flashes } = deathSweep(6183, true);
  const [first, ...rest] = flashes;
  assert.equal(rest.length, 2, 'one Swift death, then two normal ones');

  show(h, D, events, now);
  assert.deepEqual(onStrip(flashes), [first],
    'the Swift sub-step\'s trigger had already RESOLVED before the normal sub-step killed the '
    + 'other two, so it is a generation of its own and must not be swept into their beat — '
    + 'this is report #53\'s direction and collapsing the whole batch would break it');

  // one stagger later the other two arrive — together, because they are one
  // death sweep, exactly like the test above
  at(now + STAGGER_MS, () => ui.tick());
  assert.deepEqual(onStrip(flashes), flashes,
    'and when the second generation arrives it arrives WHOLE');
  assert.deepEqual(onStrip(rest), rest, 'both of it, in the same frame');
});

test('R189 a second batch queues behind the first — two updates are never one beat', () => {
  const now = (base += 100_000);
  const one = deathSweep(6184, false);
  const two = deathSweep(6185, false);
  // two boards, two sweeps: the ids are minted per game and would collide,
  // which the client would (correctly) read as a resync replaying a beat
  assert.deepEqual(one.flashes, two.flashes, 'same ids, as two separate games mint them');

  show(one.h, one.D, one.events, now);
  assert.deepEqual(onStrip(one.flashes), one.flashes, 'the first sweep, whole');

  // a SECOND action's sweep arrives 10ms later. Its beat lines up BEHIND the
  // one already playing — a batch is one beat, not "every batch is now".
  const later = deathSweep(6186, false);
  const legal: Action[] = [{ type: 'passPriority', seat: later.D }];
  at(now + 10, () => ui.update(viewFor(later.h.state, later.D), legal, { events: later.events }));
  assert.deepEqual(onStrip(later.flashes), one.flashes,
    'ids repeat across games, so all this frame can say is that nothing NEW appeared: the '
    + 'second sweep has not had its beat yet');
});

/* ── the classifier, on real events ─────────────────────────────────── */

test('R189 flashBatches cuts a real combat batch where the RULES cut it', () => {
  const sweep = deathSweep(6187, false).events;
  assert.deepEqual(flashBatches(sweep).map(g => g.length), [3],
    'one death sweep, one batch');

  const waves = deathSweep(6188, true).events;
  assert.deepEqual(flashBatches(waves).map(g => g.length), [1, 2],
    'a Swift sub-step and a normal one are two generations, and the second holds two');
});

test('R189 positive evidence only: flashes with no queue marker keep a beat each', () => {
  const { events } = deathSweep(6189, false);
  const bare = events.filter(e => e.type === 'stackFlash');
  assert.equal(events.filter(e => e.type === 'triggered').length, 3, 'three markers…');
  assert.equal(bare.length, 3, '…and the three flashes they account for');

  assert.deepEqual(flashBatches(events).map(g => g.length), [3],
    'with the markers, the batch says the three were queued together: one beat');

  // The SAME three real items, in a batch that says nothing at all about how
  // they got there. That is not a hypothetical: GYSR's own moment is this
  // shape one flash at a time — the three markers were spent at action [135]
  // and the flashes arrived at [136], [137] and [138], each in an update whose
  // marker the client had already seen and spent three updates earlier.
  //
  // A batch with no evidence gets the pre-R189 answer, a beat each. This is
  // the conservative gate the whole fix rests on: it is why R189 never has to
  // widen 56-ui-flash's docs/11 guards ("a batch arrives as a sequence, not a
  // fan"), and why a deployment reveal of six cards is still six beats.
  assert.deepEqual(flashBatches(bare).map(g => g.length), [1, 1, 1],
    'no marker, no grouping — the client never invents a simultaneity the wire did not show it');
  assert.deepEqual(queueFlashes([], bare, 0).map(f => f.at), [0, STAGGER_MS, STAGGER_MS * 2],
    'and the queue still spaces them exactly as it did before R189');
});
