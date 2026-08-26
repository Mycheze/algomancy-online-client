/**
 * THE WINDOW THAT NEVER CLOSED — R211, CARD-TODO #87.
 *
 * ── WHAT WAS ACTUALLY WRONG ──────────────────────────────────────────────
 *
 * `drillCard` opens an evidence window at every `activateAbility` it takes and
 * closes it when that activation resolves. Both ends matter: the first cut of
 * stage 2 ran the window to game over, and every ability's evidence then
 * included the next three turns of combat damage, draws and spawns.
 *
 * But the window had a THIRD exit that closed nothing. When the loop ended with
 * an activation still on the stack — `maxSteps` exhausted, or the game over —
 * a tail at the bottom of `drillCard` ran the same two lines against the FINAL
 * state, which credited `activateTypes` with every event from the stuck
 * activation to wherever the run stopped. Any event any card produced in that
 * span became this card's evidence.
 *
 * It had a live victim. **Slag Spewer read as OBSERVED** because the span
 * swallowed an `erased` produced when its HOST was destroyed several beats
 * later (CT-86). R199 made press runs end cleanly, the span closed, and the
 * card went dark — which is how the EVENTLESS category in `84-card-semantics`
 * was discovered at all. R199 REPORTED it rather than changing it, correctly:
 * a late unverified edit to the drill would have invalidated that round's
 * measurements. R211 is the follow-through.
 *
 * ── WHAT R211 MEASURED FIRST ─────────────────────────────────────────────
 *
 * Before changing anything: over all 491 drillable cards, in the exact scenario
 * set `84-card-semantics` drives (1296 runs), **the tail fired ZERO times.**
 * The ticket's "mostly moot since R199" is right, and no card at HEAD was
 * standing on this accident — the whole-pool tally is unmoved by the fix.
 *
 * That null result is what makes this file necessary rather than optional.
 * `84-card-semantics` now prints "INCONCLUSIVE: 0 runs", and a channel that
 * reports zero with nothing proving it can report anything else is precisely
 * the failure docs/13-assessment.md §5 catalogues: **six checkers in one round
 * reported more sight than they had.** §7.4 makes the rule explicit —
 * *require a positive control for every observation channel.*
 *
 * ── WHAT THIS FILE ASSERTS ───────────────────────────────────────────────
 *
 * A run is FORCED to end mid-activation, a later card is caught emitting events
 * inside the unclosed span, and the same run is driven BOTH WAYS:
 *
 *   · with `unboundedActTailForControl` — the pre-R211 code, which credits the
 *     other card's events to the card under test;
 *   · without it — which refuses them and records INCONCLUSIVE.
 *
 * The refusal is only meaningful if the flag can also say NO, so the unclipped
 * run of the same card is asserted to be conclusive. Both directions, the way
 * every other blind-check in this suite is written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import '../src/cards/registry.ts';
import { drillCard } from './drill.ts';
import { EVIDENCE, STATE_EVIDENCE } from './claims.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** the augment run that historically produced the accident. Slag Spewer prints
 *  "[Augment][once] [one], Erase one of my mods: I deal 2 damage to any
 *  target." — its ability is offered on the HOST, so the drill activates twice
 *  (two mods), and the second activation is the one left on the stack. */
const CARD = 'Slag Spewer';
const OPTS = { augment: true, press: true } as const;

/**
 * Find a `maxSteps` that clips this run mid-activation AND leaves another
 * card's event inside the unclosed span.
 *
 * ⚠ DERIVED, NOT TYPED. The clipping step depends on how many actions the
 * engine takes to get Slag Spewer onto a host and its ability onto the stack,
 * and that number moves whenever anything upstream changes. A hardcoded 47
 * would rot into a vacuous pass the first time somebody added a step — the
 * exact shape of the four `fixed` reports in §5 whose guards could never have
 * failed. Searching for it means the control either finds a real clip or fails
 * out loud saying it has lost its reach.
 */
function findClip(): { steps: number; foreign: string } {
  for (let steps = 1; steps <= 200; steps++) {
    let r;
    try { r = drillCard(CARD, 900_000, { ...OPTS, maxSteps: steps }); } catch { continue; }
    if (!r.actInconclusive) continue;
    // "another card emitted the event", read off the engine's own log line
    // rather than guessed at from the type stream.
    const foreign = r.actInconclusiveTailEvents.find(
      m => /^Resolving (.+):$/.test(m) && !m.includes(CARD));
    if (foreign && r.actInconclusiveTail.includes('statChanged')) return { steps, foreign };
  }
  throw new Error(
    'CT-87 POSITIVE CONTROL HAS LOST ITS REACH: no maxSteps in 1..200 clips the '
    + `${CARD} augment run mid-activation with another card's event inside the unclosed span. `
    + 'The control can no longer demonstrate the bug it guards against, so the "INCONCLUSIVE: 0" '
    + 'that 84-card-semantics prints is unbacked. Re-derive the clip (widen the range, or pick '
    + 'another card with an [Augment] activated ability) — do NOT delete this test.');
}

const clip = findClip();

test('CT-87 POSITIVE CONTROL: a later card emits inside the unclosed window, and it is refused', () => {
  const before = drillCard(CARD, 900_000,
    { ...OPTS, maxSteps: clip.steps, unboundedActTailForControl: true });
  const after = drillCard(CARD, 900_000, { ...OPTS, maxSteps: clip.steps });

  // the control is worth nothing if the two runs are not the same run
  assert.deepEqual(after.activated, before.activated,
    'the two runs took different actions — the flag must change only what is CREDITED');
  assert.equal(after.actInconclusive, true);
  assert.equal(after.actInconclusiveReason, 'maxSteps');

  // 1. THE BORROWED EVENTS ARE REAL AND BELONG TO SOMEBODY ELSE.
  //    `foreign` is a `Resolving <card>:` line naming a card that is not the
  //    one under test, standing inside the span the old tail credited.
  assert.ok(clip.foreign.startsWith('Resolving ') && !clip.foreign.includes(CARD), clip.foreign);
  assert.ok(after.actInconclusiveTailEvents.includes(clip.foreign));

  // 2. THE OLD CODE CREDITED THEM. Not "would have" — this is the old code,
  //    reinstated behind the control flag, on the same run.
  const borrowed = after.actInconclusiveTail.filter(t => !after.activateTypes.includes(t));
  assert.ok(borrowed.length > 0, 'the unclosed span carried nothing new — nothing to refuse');
  for (const t of borrowed) {
    assert.ok(before.activateTypes.includes(t),
      `the pre-R211 tail did not credit "${t}", so this control is not measuring the old bug`);
  }

  // 3. THE NEW CODE REFUSES THEM.
  for (const t of borrowed) {
    assert.ok(!after.activateTypes.includes(t),
      `"${t}" came from an activation the drill never saw finish and is still being credited to `
      + `${CARD} — the CT-87 window is open again`);
  }
  assert.ok(before.activateTypes.length > after.activateTypes.length,
    'the bounded window is not narrower than the unbounded one');

  // 4. THE STATE DELTA TOO. `activateChanged` is scored by STATE_EVIDENCE and
  //    it had the same tail; a fix that bounded only the type stream would
  //    leave half the bug in place.
  for (const c of after.actInconclusiveTailChanged) {
    assert.ok(before.activateChanged.includes(c));
  }
  assert.ok(before.activateChanged.length > after.activateChanged.length,
    'the state-delta half of the window is still unbounded');
});

test('CT-87: the borrowed evidence was SCORING evidence, not harmless noise', () => {
  // A window can be over-wide and still harmless if everything that leaks into
  // it is a type nothing is scored on. This one is not. What the accident
  // actually buys a card is derived from `claims.ts` rather than asserted from
  // memory: `statChanged` is the WHOLE of EVIDENCE.pump and half of
  // EVIDENCE.counters, so an [Augment] pump promise is scored on exactly the
  // event another card produced inside the unclosed span.
  assert.deepEqual(EVIDENCE.pump, ['statChanged'],
    'if `pump` is no longer evidenced by `statChanged` alone, re-derive which claim kind this '
    + 'control should be built on — do not weaken the control to match');

  const before = drillCard(CARD, 900_000,
    { ...OPTS, maxSteps: clip.steps, unboundedActTailForControl: true });
  const after = drillCard(CARD, 900_000, { ...OPTS, maxSteps: clip.steps });

  // `84-card-semantics` folds an augment run's `activateTypes` straight into
  // `augTypes`, and `met()` scores an augment-gated claim off that set — so
  // these two lines are the scoring decision verbatim, in both directions.
  const scored = (types: string[]) => EVIDENCE.pump.some(t => types.includes(t));
  assert.equal(scored(before.activateTypes), true,
    "the pre-R211 window scored a `pump` claim off another card's +1/+1 — if this is false the "
    + "control has stopped reproducing CT-86's mechanism");
  assert.equal(scored(after.activateTypes), false,
    `${CARD} prints no pump ("[Augment][once] [one], Erase one of my mods: I deal 2 damage to `
    + 'any target"), and the only `statChanged` in this run is Protective Adaptations giving '
    + 'the host +1/+1 after the drill stopped watching. Scoring one here means the CT-87 window '
    + 'is crediting events it never saw attributed.');

  // ⚠ AND THE STATE CHANNEL, WHICH IS THE HALF THAT DOES NOT FLIP HERE.
  // `STATE_EVIDENCE.pump === 'stats'`, and the CLOSED window already contains
  // "unit stats/attributes changed" for an honest reason of its own (Slag
  // Spewer's 2 damage kills a body). So the state channel cannot show a flip on
  // this card — what it can show is that the refused span is scoring-grade on
  // its own, which is the property that matters for any OTHER card whose closed
  // window happens to be empty. Said out loud rather than hidden behind a
  // green, because "the control passed" must not be read as more than it is.
  assert.equal(STATE_EVIDENCE.pump, 'stats');
  assert.ok(after.actInconclusiveTailChanged.some(c => c.includes('stats')),
    'the refused span carries a stats delta of its own, so it is scoring-grade evidence and not '
    + 'merely bookkeeping');
  assert.ok(after.activateChanged.some(c => c.includes('stats')),
    'and the CLOSED window carries one too, for its own reason — this control demonstrates the '
    + 'state-channel bound by containment, not by a flip');
});

test('CT-87: the inconclusive flag can also say NO — measured in the other direction', () => {
  // The always-true failure mode. A flag that is set on every run would make
  // the tally above meaningless in the flattering-looking direction ("we refuse
  // everything, so nothing is borrowed") while quietly discarding real evidence.
  const full = drillCard(CARD, 900_000, OPTS);
  assert.equal(full.actInconclusive, false,
    'the unclipped run must close its activation window — R199 made runs end cleanly and the '
    + 'whole-pool measurement for CT-87 (0 of 1296 runs) rests on it');
  assert.deepEqual(full.actInconclusiveTail, []);
  assert.deepEqual(full.actInconclusiveTailEvents, []);
  assert.ok(full.activateTypes.length > 0,
    'and it still has an activation window with something in it, so the `false` above is a real '
    + 'distinction and not a dead observation');
});

test('CT-87: the pre-R211 behaviour is reachable ONLY from this control', () => {
  // `unboundedActTailForControl` reinstates a known bug. It exists so the
  // control can show a before, and for nothing else — a second caller would be
  // the bug back in production with a plausible name on it. Derived by scanning
  // the tree, not by trusting a comment.
  const OPT = 'unboundedActTailForControl';
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
      if (!/\.ts$/.test(e.name)) continue;
      if (readFileSync(p, 'utf8').includes(OPT)) hits.push(e.name);
    }
  };
  walk(join(HERE, '..'));
  assert.deepEqual(hits.sort(), ['181-inconclusive-activation-window.test.ts', 'drill.ts'],
    `${OPT} reinstates the CT-87 bug and may be named only where it is DEFINED (drill.ts) and `
    + 'where it is CONTROLLED FOR (this file). Another caller is the unbounded evidence window '
    + `back in service: ${hits.join(', ')}`);
});
