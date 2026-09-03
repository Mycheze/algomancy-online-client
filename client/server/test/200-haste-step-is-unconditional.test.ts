/* R228 (owner ruling, 2026-08-28) — THE HASTE STEP IS ALWAYS OFFERED.
 *
 * ── THE RULING
 *
 * Asked whether the haste step should open when you have nothing you can
 * actually do, the owner chose **"always offer the step"** over "make
 * `canHaste` ask `castable()`" and over "leave it, just fix the skip". The
 * option he took folds his separate "Bluff Haste" request (playtest report
 * #109) in as THE FIX rather than as a new feature.
 *
 * ── WHY, AND WHY THIS FILE IS MOSTLY ABOUT AN ABSENCE
 *
 * `startHasteStep` used to compute a local `canHaste` predicate and skip the
 * step outright when it said no for everybody, marking any other seat done
 * before it could act. Two things were wrong with that, and the second is the
 * one this file is built around:
 *
 *  1. `canHaste` WAS A HAND-MAINTAINED DUPLICATE of apply.ts's `castable()`,
 *     the shape report #74 already cost us once. Measured over the whole pool,
 *     its over-permissive directions had population ZERO and its
 *     under-permissive one was live on exactly one card — §2 below.
 *
 *  2. ⚠ THE SKIP WAS AN INFORMATION LEAK, AT FULL STRENGTH. `hasteDone` is
 *     served LIVE AND PUBLIC by design — server/view.ts: *"done-flags stay
 *     live and public … 'they are finished' is exactly what you can see across
 *     a table"* — so a step that appeared only when somebody COULD act
 *     published "your opponent is holding something haste-playable" to a seat
 *     whose view of that hand reads `__HIDDEN__`, and published the negative
 *     just as loudly by not appearing. A physical table has no `hasteDone`
 *     array. Always opening does not CREATE a channel; it removes one the
 *     client invented as an optimisation. The repo already held the argument
 *     against itself: `startBattlePhase` fires 'endOfHaste' even on the
 *     skipped path because *an optimisation must not be observable*.
 *
 * ── WHAT IS HERE
 *
 *   §1  THE SIDE CHANNEL IS GONE, read SEAT-AWARE off `viewFor` / `logFor`.
 *       Two boards that differ ONLY in the hidden hand must be served the
 *       same view and the same log, byte for byte — with a positive control
 *       proving the comparison can tell two boards apart at all.
 *   §2  The named Eldritch Reclaimer repro, with its bin control and the
 *       no-Courier negative control.
 *   §3  The INVARIANT rather than the card: at every `donePlanning → haste`
 *       transition, the step's presence does not depend on hand contents.
 *   §4  The measurement that made §2 the whole population, derived from the
 *       pool so a new card extends it instead of rotting it.
 *   §5  Nothing else moved: no seat is auto-done, and both must close it.
 *
 * ⚠ §1 IS THE ONE THAT IS EASY TO GET WRONG. Every secrecy test in this
 * engine was unfalsifiable for months because `Harness.absorb()` flattens all
 * events into one seatless `h.log`; two genuine leaks survived 153 test files
 * for that reason (R203 / 174-secrecy-is-seat-aware). Nothing below reads
 * `h.log`. §1's control is there so a green cannot mean "the assertion cannot
 * fail" — it compares two boards that DO differ publicly and requires the
 * served views to differ.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { allCardNames, getCard } from '../../engine/src/cards/dsl.ts';
import type { Seat } from '../../engine/src/types.ts';
import { give, giveResources, logFor, spawn, unitsOf } from '../../engine/test/util.ts';
import { viewFor } from '../view.ts';

/* ── the fixture ───────────────────────────────────────────────────────
 *
 * One board, one seed, one knob: what seat 0 is holding. Everything a seat-1
 * viewer is allowed to see — the resources, the counts, the deck, seat 1's own
 * hand — is identical across every call, so any difference §1 finds in seat
 * 1's SERVED view is a difference it learned about a hidden hand.
 */
const A: Seat = 0, D: Seat = 1;

interface Opts { courier?: boolean; bin?: string[] }

/** planning through to the haste step, with `hand` in seat 0's hand */
function board(hand: string[], opts: Opts = {}): Harness {
  const h = new Harness(9200);
  if (opts.courier) spawn(h, A, 'Dispatch Courier');
  giveResources(h, A, 'fire', 6);
  giveResources(h, A, 'water', 6);
  giveResources(h, A, 'metal', 6);
  h.state.players[A]!.hand = [...hand];
  h.state.players[A]!.bin = [...(opts.bin ?? [])];
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  return h;
}

/** exactly what seat 1's client is handed */
const served = (h: Harness): string => JSON.stringify(viewFor(h.state, D));

/* ═══ §1 — the channel is closed, and the instrument can still see ═════ */

test('R228 §1: seat 1 is served the same view whatever seat 0 is holding', () => {
  // one printed {Haste} unit (r/1, affordable) against one {Battle} unit that
  // no timing and no grant can make playable here. Same hand SIZE, which is
  // public and must stay public; different contents, which are not.
  const hasteable = board(['Cinder Scuttler']);
  const nothing = board(['Monke']);
  assert.deepEqual(hasteable.state.hasteDone, [false, false],
    'the step opens for a seat that can act…');
  assert.deepEqual(nothing.state.hasteDone, [false, false],
    '…and identically for a seat that cannot — this is the ruling');
  assert.equal(
    hasteable.state.players[A]!.hand.length, nothing.state.players[A]!.hand.length,
    'the two boards must differ ONLY in what the hand IS, never in how big it is');

  // ⚠ the assertion the whole file exists for, read off the production
  // redactor rather than off the seatless firehose
  assert.equal(served(hasteable), served(nothing),
    'seat 1\'s served view tells the two hands apart — the haste step is a side '
    + 'channel out of a hidden hand');
  assert.deepEqual(logFor(hasteable, D), logFor(nothing, D),
    'and seat 1\'s served LOG tells them apart');

  // and seat 0 really was holding two different things, so this is not a
  // comparison of one board with itself
  assert.notDeepEqual(hasteable.state.players[A]!.hand, nothing.state.players[A]!.hand);
  assert.notEqual(served(hasteable), JSON.stringify(viewFor(hasteable.state, A)),
    'the two SEATS are served different views — the redactor is doing something');
});

test('R228 §1 control: the same comparison DOES fire on a difference seat 1 may see', () => {
  // docs/13 §7.4: an observation channel needs a control showing it can see.
  // If `served()` compared two boards as equal no matter what, §1 above would
  // be green and unfalsifiable. Here the boards differ in something PUBLIC —
  // a unit standing in seat 0's region — and the comparison must notice.
  const plain = board(['Cinder Scuttler']);
  const withUnit = board(['Cinder Scuttler']);
  spawn(withUnit, A, 'The Foretold');
  assert.notEqual(served(plain), served(withUnit),
    'seat 1\'s view cannot see a unit arrive on the board — the instrument is blind, '
    + 'so §1\'s equality means nothing');

  // and the same for the LOG, which needs a real logged action rather than a
  // white-box spawn: playing the haste card is public, and seat 1 must see it
  const played = board(['Cinder Scuttler']);
  const notPlayed = board(['Cinder Scuttler']);
  played.do({ type: 'playCard', seat: A, handIndex: 0 });
  assert.notDeepEqual(logFor(played, D), logFor(notPlayed, D),
    'seat 1\'s log cannot see a haste card actually being played — the log instrument is '
    + 'blind, so §1\'s log equality means nothing');
});

/* ═══ §2 — the repro, its bin control and its negative control ═════════ */

const RECLAIMER = 'Eldritch Reclaimer';   // bb/4 spell unit, "recall target unit in your bin", min 0

test(`R228 §2: ${RECLAIMER} under Dispatch Courier, EMPTY BIN — the step used to vanish`, () => {
  // THE REPRO. `canHaste` judged the spec-wide `targets` and treated a min-0
  // "up to N" spec as needing a candidate; `castable()` lets such a spell be
  // cast at nothing. With an empty bin the two disagreed, `canHaste` won
  // (it decided whether the window existed at all), and the step was skipped
  // outright while `legalActions` would have offered the play and `apply`
  // would have accepted it.
  const h = board([RECLAIMER], { courier: true, bin: [] });
  assert.deepEqual(h.state.players[A]!.bin, [], 'the bin really is empty — that is the repro');
  assert.deepEqual(h.state.hasteDone, [false, false], 'the step opens');
  assert.ok(h.legal(A).some(a => a.type === 'playCard' && a.handIndex === 0),
    'and the play the old window hid is offered in it');
  h.do({ type: 'playCard', seat: A, handIndex: 0 });
  assert.ok(unitsOf(h, A).some(u => u.card === RECLAIMER),
    'and accepted — the offer and the enforcement always agreed; only the window did not');
});

test(`R228 §2 bin control: a UNIT in the bin is what used to open the same board`, () => {
  // the control that isolates the divergence to the empty-bin case: with a
  // candidate to recall, `canHaste`'s copy agreed with `castable()` and the
  // step opened even before R228. A SPELL in the bin did not — the spec is
  // unit-restricted — which is how narrow the old gate was.
  const unit = board([RECLAIMER], { courier: true, bin: ['Nebula Drifter'] });
  const spell = board([RECLAIMER], { courier: true, bin: ['Fireball'] });
  for (const [what, h] of [['unit', unit], ['spell', spell]] as const) {
    assert.deepEqual(h.state.hasteDone, [false, false], `the step opens with a ${what} in the bin`);
    assert.ok(h.legal(A).some(a => a.type === 'playCard'),
      `and the play is offered with a ${what} in the bin`);
  }
  // and the restriction itself is unchanged: only the unit is a legal target
  assert.ok(getCard(RECLAIMER).spellEffect?.targets, 'the spec is still there to be restricted');
});

test('R228 §2 negative control: no Courier, no play — the step opens, and does nothing', () => {
  // ⚠ WITHOUT THIS THE FIX COULD DEGRADE INTO "always open for the wrong
  // reason". The window is unconditional now, so every claim about the R97
  // grant has to be read off the OFFER instead. Take the grantor away and the
  // seat is served `doneHaste` and nothing else.
  const h = board([RECLAIMER], { courier: false, bin: ['Nebula Drifter'] });
  assert.deepEqual(h.state.hasteDone, [false, false], 'the step still opens');
  assert.deepEqual(h.legal(A).map(a => a.type), ['doneHaste'],
    'but with no grantor the deploy-timed spell unit is not offered');
  assert.throws(() => h.do({ type: 'playCard', seat: A, handIndex: 0 }),
    /only haste cards during the haste step/, 'nor accepted');
});

/* ═══ §3 — the invariant, not the card ════════════════════════════════ */

/** hands chosen to hit every arm the old `canHaste` had, and a few it never
 * looked at: nothing at all, a printed {Haste} unit, a {Battle} unit, a
 * deploy unit needing a grant, the min-0 spell unit, and a bare mod. */
const HANDS: Record<string, string[]> = {
  'empty hand': [],
  'a printed {Haste} unit': ['Cinder Scuttler'],
  'a {Battle} unit': ['Monke'],
  'a deploy unit (needs a grant)': ['Nebula Drifter'],
  'the min-0 spell unit': [RECLAIMER],
  'nothing but a mod': ['Ephemeral Skywalker'],
  'an unaffordable haste unit': ['The Everywhere'],
};

test('R228 §3: at donePlanning → haste, the step does not depend on hand contents', () => {
  // The claim R224 actually makes, stated once over the whole matrix rather
  // than card by card — and stated as an INVARIANT, so a future card cannot
  // reintroduce the dependency without reddening this.
  const seen = new Set<string>();
  for (const [label, hand] of Object.entries(HANDS)) {
    for (const courier of [false, true]) {
      const h = board(hand, { courier });
      assert.equal(h.state.phase, 'planning', `${label}${courier ? ' + Courier' : ''}: still in planning`);
      assert.deepEqual(h.state.hasteDone, [false, false],
        `${label}${courier ? ' + Courier' : ''}: the window must not report what is in the hand`);
      seen.add(JSON.stringify(h.state.hasteDone));
    }
  }
  assert.equal(seen.size, 1, 'one shape across the whole matrix — that IS the invariant');
  assert.ok(Object.keys(HANDS).length >= 6, 'and the matrix is wide enough for that to mean something');
});

/* ═══ §4 — the measurement, derived so it cannot rot ══════════════════ */

/** a card an R97 grant ("play a UNIT during the mana step as if it had
 * [Haste]") could ever reach: a unit or spell unit whose printed timing is
 * neither {Battle} (RAQ: a battle card stays one) nor already [Haste]. */
function grantEligible(name: string): boolean {
  const c = getCard(name);
  return (c.kind === 'unit' || c.kind === 'spellUnit')
    && c.timing !== 'battle' && c.timing !== 'haste';
}

test('R228 §4: the over-permissive half of the old divergence had population ZERO', () => {
  // `canHaste` never asked whether a bracketed [cast cost] / [Gain N debt] was
  // payable, and judged the spec-wide `targets` rather than slot 0 — three
  // ways to say "yes" to a hand `castable()` would refuse, i.e. an empty step
  // with a `doneHaste` to click. Every card that could have exhibited it is
  // {Battle} and so unreachable at haste timing. Derived, not enumerated: a
  // new card carrying any of these arrives in this count by itself.
  const reachable = allCardNames().filter(n => grantEligible(n) || getCard(n).timing === 'haste');
  const offenders = reachable.filter(n => {
    const c = getCard(n);
    return c.gainDebt !== undefined || c.noPlayFromHand === true || !!c.spellEffect?.castCost;
  });
  assert.deepEqual(offenders, [],
    'a haste-reachable card now carries a cast cost, a debt line or {noPlayFromHand}. That is '
    + 'not a bug — R228 deleted the predicate that could disagree about it — but it means the '
    + 'measurement this ruling rests on has changed, and the ruling note should say so.');
  assert.ok(reachable.length > 200, `only ${reachable.length} reachable cards — this would pass vacuously`);
});

test(`R228 §4: ${RECLAIMER} is still the whole under-permissive population`, () => {
  // The other half: `canHaste` said NO to a min-0 spec with no candidate,
  // where `castable()` says yes. Only a grant-eligible card could reach the
  // step to be refused, and there is exactly one. If a second ever appears,
  // §2's repro has stopped being the whole story and this says so by name.
  const minZero = allCardNames().filter(n => {
    const t = getCard(n).spellEffect?.targets;
    return !!t && (t.min ?? 1) === 0 && grantEligible(n);
  });
  assert.deepEqual(minZero, [RECLAIMER],
    'the set of cards that could be refused a haste step they were legally able to use has '
    + 'changed. §2 repros the named one; a new entry needs its own line there.');

  // and the 21 printed {Haste} cards were vacuously fine on both counts —
  // none of them has a target spec at all, which is why the fault could only
  // ever arrive through a grant
  const printedHaste = allCardNames().filter(n => getCard(n).timing === 'haste');
  assert.ok(printedHaste.length >= 20, `only ${printedHaste.length} printed {Haste} cards`);
  assert.deepEqual(printedHaste.filter(n => getCard(n).spellEffect?.targets), [],
    'a printed {Haste} card now has a cast-time target spec — see the note in §4 above');
});

/* ═══ §5 — nothing else moved ═════════════════════════════════════════ */

test('R228 §5: no seat is auto-done, and BOTH have to close the step', () => {
  // the old code marked a seat done before it could act, which is the same
  // broadcast wearing a different hat. Now `doneHaste` is a thing a player
  // says, and one saying it is not two.
  const h = board(['Cinder Scuttler']);
  assert.deepEqual(h.state.hasteDone, [false, false]);
  h.do({ type: 'doneHaste', seat: A });
  assert.equal(h.state.phase, 'planning', 'one seat finishing does not end the step');
  assert.deepEqual(h.state.hasteDone, [true, false]);
  assert.deepEqual(h.legal(A), [], 'and a finished seat is offered nothing');
  h.do({ type: 'doneHaste', seat: D });
  assert.equal(h.state.phase, 'battle', 'the second one does');
  assert.equal(h.state.hasteDone, null, 'R43: the window is nulled on the way out');
});

test('R228 §5: the step still ENDS properly — endOfHaste fires exactly once', () => {
  // R50/R18: 'endOfHaste' used to fire even on the skipped path, because *an
  // optimisation must not be observable*. There is no skipped path any more,
  // so the guarantee is now structural — but firing it twice, or not at all,
  // would be a new bug and this is where it would show.
  const h = board([]);
  const before = h.events.filter(e => e.type === 'endOfHaste').length;
  h.do({ type: 'doneHaste', seat: A });
  h.do({ type: 'doneHaste', seat: D });
  const after = h.events.filter(e => e.type === 'endOfHaste').length;
  assert.equal(after - before, 1, 'exactly one end-of-haste per haste step');
  assert.equal(h.state.phase, 'battle');
});

test('R228 §5: a bluff is a real move — you may sit in the step holding nothing', () => {
  // playtest report #109, "Bluff Haste", granted as the fix. The empty-handed
  // seat is offered the step, may sit in it, and the OTHER seat's served view
  // never says which of those two things is happening.
  // ⚠ the two hands must be the same SIZE: a hand count is public across a
  // real table too, and comparing a 0-card hand with a 1-card one would fail
  // for a reason that has nothing to do with the haste step.
  const bluffing = board(['Monke']);            // {Battle}: unplayable here, whatever else happens
  const armed = board(['Cinder Scuttler']);     // r/1 printed {Haste}, and affordable
  assert.deepEqual(bluffing.legal(A).map(a => a.type), ['doneHaste'],
    'a hand with no haste play is offered exactly one thing — the one thing a bluffer clicks');
  assert.ok(armed.legal(A).some(a => a.type === 'playCard'),
    'and the armed hand really does have more to do, or there is no bluff to hide');
  assert.equal(served(bluffing), served(armed),
    'seat 1 can tell the bluff from the real hand');
  // the bluffer's opponent also gets the step, so "they are still thinking"
  // is available to both of them
  assert.equal(bluffing.state.hasteDone![D], false, 'seat 1 is in the step too');
  give(bluffing, A, 'Cinder Scuttler');   // and picking one up mid-step changes nothing structural
  assert.deepEqual(bluffing.state.hasteDone, [false, false]);
});
