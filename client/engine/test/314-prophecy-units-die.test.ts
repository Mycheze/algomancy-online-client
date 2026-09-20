/* R302 — "13 Units Die": the WITNESSED death count (Vengeance).
 *
 * Vengeance's banner was missing from the transcription entirely until
 * 2026-09-20 (R301, bot/pipeline/read_card_faces.py). Restoring it handed the
 * engine a condition PROPHECY_RULES had never seen, and an unrecognised
 * condition can never be fulfilled — `prophecyMet` logs a warning and returns
 * false forever. So for the length of one commit Vengeance was worse than it
 * had been: a card you could pay [2lr] to cache and never get back.
 *
 * WHAT IT COUNTS, and this is the whole of the ruling. Not your dead, and not
 * every death on the board — the deaths YOU WERE THERE FOR. Owner,
 * 2026-09-20: *"YOU (the player) need to be in a region for it to 'see' the
 * death. So if your opponent sacrifices a unit during their deployment or
 * something, it will NOT be seen by Vengeance. But during combat, it will see
 * all deaths."*
 *
 * `Region.presentSeats` already meant exactly that — a region holds its owner
 * plus whoever attacked into it, until regroup sends everyone home — so the
 * tally is per seat and the two seats legitimately disagree. §2 and §3 are the
 * two halves of that sentence, and they are the point of this file.
 *
 * Seeds 3140-3149.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { spawn, toDeployment, toNextBattle, withE } from './util.ts';
import type { Seat } from '../src/types.ts';

const seen = (h: Harness): number[] => h.state.deathsSeen ?? [0, 0];

/** spawn `n` units for `seat` and kill them where they stand */
function killUnits(h: Harness, seat: Seat, n: number): void {
  for (let i = 0; i < n; i++) {
    const id = spawn(h, seat, 'Unit Token');
    withE(h, e => {
      e.entity(id)!.damage = 99;
      e.checkDeaths();
      e.settle();
    });
  }
}

// ── §1 the condition is known at all ──────────────────────────────────

test('R302 §1: the banner Vengeance prints is a condition the engine knows', () => {
  const p = getCard('Vengeance').prophecy;
  assert.ok(p, 'Vengeance prints a prophecy banner (R301 restored it)');
  assert.equal(p.condition, '13 Units Die');
  const h = new Harness(3140);
  const e = new E(h.state);
  assert.ok(e.prophecyProgress(0, e.makeProphecy(p.condition, 0)),
    'it METERS — an unrecognised condition returns null here and can never be '
    + 'fulfilled, which is what Vengeance was between R301 and R302');
});

// ── §2 a death you were not there for does not count ──────────────────

test('R302 §2: a death is counted only by the seats that were in the region', () => {
  const h = new Harness(3141);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  assert.deepEqual(seen(h), [0, 0], 'a fresh game has buried nobody');

  // deployment: each seat is alone in its own region (presentSeats = [owner])
  killUnits(h, D, 3);
  assert.equal(seen(h)[D], 3, 'D was there — D saw all three');
  assert.equal(seen(h)[A], 0,
    'and A saw NONE of them. This is the ruling: "if your opponent sacrifices '
    + 'a unit during their deployment it will NOT be seen". A global tally '
    + 'would read 3 here and Vengeance would count a battle it never joined');

  killUnits(h, A, 1);
  assert.deepEqual([seen(h)[A], seen(h)[D]], [1, 3],
    'the two seats keep different books, and are meant to');
});

// ── §3 ...and in combat, everyone is there ────────────────────────────

test('R302 §3: combat puts the attacker in the region, so both seats see every death in it', () => {
  const h = new Harness(3142);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  // a REAL attack: declining ends the round without entering the region, which
  // is the ruling working rather than a gap — you cannot witness a battle you
  // did not go to.
  const atk = spawn(h, A, 'Unit Token');
  const before = [...seen(h)];

  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const region = h.state.battle!.region;
  assert.deepEqual([...h.state.regions[region]!.presentSeats].sort(), [0, 1],
    'non-vacuity: declaring the attack really did put BOTH seats in the region '
    + '— that is the mechanism the ruling rides on, not an assumption');

  // a defender unit dies at home, which is where the battle is being fought
  killUnits(h, D, 2);
  assert.equal(seen(h)[D]! - before[D]!, 2, 'the defender saw its own units die');
  assert.equal(seen(h)[A]! - before[A]!, 2,
    'and so did the attacker, because it is standing in that region — '
    + '"during combat, it will see all deaths"');
});

// ── §4 the counting rules that make it a prophecy ─────────────────────

test('R302 §4: it counts forward from prophesying, off THIS seat\'s witnessed total (R43)', () => {
  const h = new Harness(3143);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  killUnits(h, A, 4);                       // before the prophecy: must not count

  withE(h, e => e.cacheCard(A, 'Throwing Boulder', 'effect', { prophecy: '3 Units Die' }));
  const pr = () => h.state.players[A]!.cache![0]!.prophecy!;
  assert.equal(pr().deaths, 4, 'the stamp records the four this seat had already seen');

  const prog = () => new E(h.state).prophecyProgress(A, pr());
  assert.deepEqual(prog(), { done: 0, need: 3, unit: 'unit' },
    'and the meter starts at zero, not four — R43 counts forward');

  killUnits(h, A, 2);
  assert.deepEqual(prog(), { done: 2, need: 3, unit: 'unit' });
  assert.equal(new E(h.state).prophecyMet(A, pr()), false, 'two of three is not three');

  killUnits(h, A, 1);
  assert.equal(new E(h.state).prophecyMet(A, pr()), true, 'the third death fulfils it');
  assert.equal(prog(), null,
    'and the meter goes away rather than reading 3/3: R44 latches fulfilment '
    + 'and the card wears its ✓ instead (prophecyProgress returns null for a '
    + 'fulfilled entry by design — see its doc comment)');
});

test('R302 §4: the stamp is the CONTROLLER\'s count, not a shared one', () => {
  const h = new Harness(3144);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  killUnits(h, D, 5);                       // five deaths A never witnessed

  withE(h, e => e.cacheCard(A, 'Throwing Boulder', 'effect', { prophecy: '2 Units Die' }));
  assert.equal(h.state.players[A]!.cache![0]!.prophecy!.deaths, 0,
    "A stamps ZERO — it saw none of D's five. Stamping a global count here "
    + "would start A's meter at five and the card would be counting deaths "
    + 'its controller was never present for');
});

test('R302 §4: the meter keeps pace at Vengeance\'s own printed 13', () => {
  const h = new Harness(3145);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  withE(h, e => e.cacheCard(A, 'Vengeance', 'effect', { prophecy: '13 Units Die' }));
  const pr = () => h.state.players[A]!.cache![0]!.prophecy!;

  killUnits(h, A, 12);
  // read the meter BEFORE the thirteenth death: a fulfilled prophecy meters
  // null, so 12/13 is the last number this card ever shows
  assert.deepEqual(new E(h.state).prophecyProgress(A, pr()), { done: 12, need: 13, unit: 'unit' },
    'twelve of thirteen — and this is the number the table meter shows, which '
    + 'is the whole reason the rule carries a progress function. A WITNESSED '
    + 'count is one no player could reconstruct from the board: the deaths it '
    + 'counts have already left it');
  assert.equal(new E(h.state).prophecyMet(A, pr()), false);

  killUnits(h, A, 1);
  assert.equal(new E(h.state).prophecyMet(A, pr()), true, 'the thirteenth does it');
});

test('R302 §4: a state cached before the tally existed counts from zero, not from nothing', () => {
  // `deaths` is optional and additive (a save written before R302 has no such
  // field). The fallback must be 0, so an old entry becomes fulfillable rather
  // than permanently stuck — generous, which is the safe direction.
  const h = new Harness(3146);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  withE(h, e => e.cacheCard(A, 'Throwing Boulder', 'effect', { prophecy: '2 Units Die' }));
  delete h.state.players[A]!.cache![0]!.prophecy!.deaths;   // the old shape
  killUnits(h, A, 2);
  assert.equal(new E(h.state).prophecyMet(A, h.state.players[A]!.cache![0]!.prophecy!), true,
    'an entry with no stamp counts from the start of the game');
});

// ── §5 the systemic guards ────────────────────────────────────────────

test('R302 §5: EVERY printed prophecy banner names a condition the engine can fulfil', () => {
  // The Vengeance bug generalised. A condition with no PROPHECY_RULES row is
  // not inert: `prophecyMet` returns false forever, so the card is cacheable
  // and unreleasable — strictly worse than having no banner. Nothing caught
  // that, because the engine's own complaint is an `info` event and a passing
  // suite never reads the log.
  //
  // Derived from DECK_LIST, never listed: the next card to print a banner is
  // covered the day it is registered, which is the only way this guard is
  // worth having. It asserts on the engine's own warning rather than on a
  // copy of the rules table, so the two cannot drift apart.
  const unrecognised: string[] = [];
  for (const name of DECK_LIST) {
    const banner = getCard(name).prophecy;
    if (!banner) continue;
    const e = new E(new Harness(3149).state);
    e.prophecyMet(0, e.makeProphecy(banner.condition, 0));
    // `msg`, not `text`: EngineEvent's field is msg, and reading the wrong one
    // made this guard pass VACUOUSLY the first time it was written — green
    // against an empty set, and only breaking the rule exposed it.
    if (e.events.some(ev => /Unrecognised prophecy condition/.test(ev.msg))) {
      unrecognised.push(`${name}: ${JSON.stringify(banner.condition)}`);
    }
  }
  assert.deepEqual(unrecognised, [],
    'a printed banner the engine cannot fulfil. Add a row to PROPHECY_RULES '
    + '(engine.ts) — and give it a `progress` function, or the card counts '
    + 'toward something no player can see (R302).');
});

test('R302 §5: and every counting condition in the pool can be metered', () => {
  // The other half: a rule with no `progress` is legal (a STATE condition has
  // nothing to count) but a rule whose condition contains a number and offers
  // no meter is the readability bug R279 and R302 both exist to fix.
  const unmetered: string[] = [];
  for (const name of DECK_LIST) {
    const banner = getCard(name).prophecy;
    if (!banner) continue;
    const e = new E(new Harness(3149).state);
    const cp = e.makeProphecy(banner.condition, 0);
    // "your life is 5 or less" and "your units have 4 unique costs" hold a
    // numeral and are STATES, not counts — they are true or they are not, and
    // there is no partial progress to show. A count is a thing that ticks.
    const counts = /^\d+ \w+ /.test(cp.norm);
    if (counts && !e.prophecyProgress(0, cp)) unmetered.push(`${name}: ${cp.norm}`);
  }
  assert.deepEqual(unmetered, [],
    'a counting condition with no meter — the player has no way to see how close it is');
});
