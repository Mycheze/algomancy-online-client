/* R130 — EVERY COUNTER IS A COUNTER, AND A PLACEMENT CARRIES ITS ACTOR.
 *
 * The owner, 2026-08-24: "All counters count as counters." No sign filter,
 * ever — and the three cards that had one were not narrow, they were WRONG:
 * the sign was standing in for an ATTRIBUTION the engine did not keep.
 *
 *   · Wandering Blightshell — "When you put a counter on an enemy, [Switch1]
 *     Draw a card." Read as "-1/-1 counters landed on an enemy of mine", which
 *     drew me a card when an OPPONENT shrank their own unit and drew me
 *     nothing when I grew theirs.
 *   · Scrapyard Custodian — "When you put one or more counters on an ally",
 *     read as "counters landed on an ally of mine, by anyone".
 *   · Flux Resonator — "If one or more counters would be put on a unit by an
 *     allied source", read as "onto an allied unit", positive counters only.
 *
 * `E.addCounters(target, n, by?: Seat)` is the fix, with `by` defaulting to
 * the controller of the effect currently resolving (`partActor`, published by
 * resolveParts exactly as `partChoose` is) and carried onto both the
 * `countersChanged` event and `AmountCtx.sourceSeat`.
 *
 * HOUSE RULES: assertions are on state and on the event vocabulary, never on
 * log prose; no `{ todo: true }` — a todo can never fail.
 *
 * Seeds 12000-12099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  ent, finishBattle, pass, pick, spawn, toDeployment, toNextBattle, withE as whiteBox,
} from './util.ts';
import type { EngineEvent, EntityId, Seat } from '../src/types.ts';

/** the events one action produced, so a test can assert on what was NOT said */
function during(h: Harness, fn: () => void): EngineEvent[] {
  const before = h.events.length;
  fn();
  return h.events.slice(before);
}

const handOf = (h: Harness, seat: Seat): number => h.state.players[seat]!.hand.length;

/**
 * A board where the two seats SHARE a region, which is what every one of
 * these cards needs (fireEvent scopes listeners to the counted unit's region,
 * R12) and what deployment does not give you for free. The enemy body is
 * spawned straight into the listener's home region — the same white-box setup
 * 27-metal-b uses to isolate allegiance from geography.
 *
 * Returns the listener's seat, its opponent, an ALLY of the listener and an
 * ENEMY unit, all in one region. Both bodies are vanilla 3/3s, so a -1/-1
 * counter is survivable and nothing else on the board has an opinion.
 */
function board(seed: number, listener: string): {
  h: Harness; A: Seat; D: Seat; self: EntityId; ally: EntityId; enemy: EntityId;
} {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const self = spawn(h, A, listener);
  const ally = spawn(h, A, 'The Foretold');            // 3/3 vanilla ally
  let enemy = -1;
  whiteBox(h, e => { enemy = e.spawnUnit(D, 'The Foretold', e.homeRegion(A)).id; });
  assert.equal(ent(h, enemy)!.region, ent(h, self)!.region, 'both sides share a region');
  return { h, A, D, self, ally, enemy };
}

// ══ WANDERING BLIGHTSHELL ══════════════════════════════════════════════
//
// "When you put a counter on an enemy, [Switch1] Draw a card." Both halves of
// the fix are load-bearing: sign-blind AND actor-gated. Landing one without
// the other only trades one false reading for another.

test('Blightshell: a +1/+1 counter YOU put on an enemy draws a card', () => {
  // The direction the old sign test refused outright. A counter is a counter:
  // growing an enemy unit (Flux Resonator's plus-one onto their side, a stat
  // swap, Buffer Overflow doubling their +1/+1s) is putting a counter on an
  // enemy, and the card does not say which kind.
  const { h, A, enemy } = board(12001, 'Wandering Blightshell');
  const hand0 = handOf(h, A);
  whiteBox(h, e => e.addCounters(ent(h, enemy)!, 1, A));
  assert.equal(ent(h, enemy)!.counters, 1, 'the counter landed');
  assert.equal(handOf(h, A), hand0 + 1, '+1/+1 on an enemy is a counter you put on an enemy');
});

test('Blightshell: a -1/-1 counter YOU put on an enemy draws a card', () => {
  // The direction that already worked — pinned so the fix cannot swap the
  // filter instead of removing it.
  const { h, A, enemy } = board(12002, 'Wandering Blightshell');
  const hand0 = handOf(h, A);
  whiteBox(h, e => e.addCounters(ent(h, enemy)!, -1, A));
  assert.equal(ent(h, enemy)!.counters, -1, 'the counter landed');
  assert.equal(handOf(h, A), hand0 + 1, '-1/-1 on an enemy still draws');
});

test('Blightshell: the enemy countering their OWN unit draws me nothing', () => {
  // The false positive the sign test could not see. "When YOU put" is an
  // attribution, and an opponent shrinking their own unit is their placement.
  const { h, A, D, enemy } = board(12003, 'Wandering Blightshell');
  const hand0 = handOf(h, A);
  const evs = during(h, () => whiteBox(h, e => e.addCounters(ent(h, enemy)!, -1, D)));
  assert.equal(ent(h, enemy)!.counters, -1, 'the counter still landed — only the draw is gone');
  assert.equal(handOf(h, A), hand0, 'not my placement, not my card');
  assert.equal(evs.filter(e => e.type === 'triggered').length, 0, 'and nothing was even queued');
});

test('Blightshell: a counter you put on your own ALLY draws nothing', () => {
  const { h, A, ally } = board(12004, 'Wandering Blightshell');
  const hand0 = handOf(h, A);
  whiteBox(h, e => e.addCounters(ent(h, ally)!, 1, A));
  assert.equal(ent(h, ally)!.counters, 1);
  assert.equal(handOf(h, A), hand0, '"on an ENEMY" — my own unit is not one');
});

test('Blightshell: [Switch1] — one draw per turn however many counters you put', () => {
  const { h, A, enemy } = board(12005, 'Wandering Blightshell');
  const hand0 = handOf(h, A);
  whiteBox(h, e => e.addCounters(ent(h, enemy)!, 1, A));
  assert.equal(handOf(h, A), hand0 + 1, 'the first placement drew');
  whiteBox(h, e => e.addCounters(ent(h, enemy)!, 1, A));
  assert.equal(ent(h, enemy)!.counters, 2, 'the second counter landed all the same');
  assert.equal(handOf(h, A), hand0 + 1, 'R9: the bounded budget is spent for the turn');
});

test('Blightshell: an UNATTRIBUTED placement draws nothing — no answer is not a yes', () => {
  // `by` is optional and genuinely absent for engine sweeps and raw calls.
  // "When YOU put" asks a question; an unattributed counter is not an answer,
  // and guessing one is exactly the bug this ruling closes.
  const { h, A, enemy } = board(12006, 'Wandering Blightshell');
  const hand0 = handOf(h, A);
  whiteBox(h, e => e.addCounters(ent(h, enemy)!, -1));
  assert.equal(ent(h, enemy)!.counters, -1);
  assert.equal(handOf(h, A), hand0, 'nobody put it, so nobody drew');
});

// ── the actor arrives on its own through a real card ─────────────────────

test('a card that puts counters attributes them to its controller, on the event', () => {
  // The default that makes the optional parameter usable: `partActor` is the
  // resolving item's controller, so every existing call site inside an effect
  // got the right actor without being touched. A Crystal is the smallest card
  // that puts a counter — and the +1/+1 direction is the half the Blightshell
  // used to be blind to, so this is the fix end to end.
  const h = new Harness(12007);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const shell = spawn(h, A, 'Wandering Blightshell');
  const victim = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[shell]] });
  const region = h.state.battle!.region;
  const crystal = new E(h.state).createSpellToken(A, 'Crystal', 1, region);
  const hand0 = handOf(h, A);
  const evs = during(h, () => {
    h.do({ type: 'castSpellToken', seat: A, entityId: crystal.id });
    pick(h, { unit: victim });
    pass(h); pass(h);                                 // the Crystal resolves
    pass(h); pass(h);                                 // the trigger resolves
  });
  const changed = evs.filter(e => e.type === 'countersChanged');
  assert.equal(changed.length, 1, 'one placement, one event');
  assert.equal(changed[0]!.data!['by'], A, 'the event names who put them');
  assert.equal(ent(h, victim)!.counters, 1);
  assert.equal(handOf(h, A), hand0 + 1, 'a +1/+1 counter A put on an enemy drew A a card');
  finishBattle(h);
});

test("an opponent's card countering their OWN unit is their placement, not yours", () => {
  // The same route from the other side, and the reading the old sign test got
  // backwards: D's Poison on D's own unit fires nothing of A's.
  const h = new Harness(12008);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const shell = spawn(h, A, 'Wandering Blightshell');
  const theirs = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[shell]] });
  const region = h.state.battle!.region;
  const poison = new E(h.state).createSpellToken(D, 'Poison', 1, region);
  const hand0 = handOf(h, A);
  const evs = during(h, () => {
    pass(h);                                          // priority → D
    h.do({ type: 'castSpellToken', seat: D, entityId: poison.id });
    pick(h, { unit: theirs });
    pass(h); pass(h);                                 // the Poison resolves
  });
  const changed = evs.filter(e => e.type === 'countersChanged');
  assert.equal(changed.length, 1);
  assert.equal(changed[0]!.data!['by'], D, 'D put it');
  assert.equal(ent(h, theirs)!.counters, -1, 'the counter landed');
  assert.equal(handOf(h, A), hand0, "A drew nothing from D's own placement");
  finishBattle(h);
});

// ══ SCRAPYARD CUSTODIAN ════════════════════════════════════════════════

test("Custodian: an ENEMY's counters on your ally are not counters YOU put", () => {
  // "When you put one or more counters on an ally" — the other card that read
  // the recipient and called it an actor. An opponent's Wraith shrinking one
  // of my units used to draw me a card for the privilege.
  const { h, A, D, ally } = board(12009, 'Scrapyard Custodian');
  const hand0 = handOf(h, A);
  whiteBox(h, e => e.addCounters(ent(h, ally)!, -1, D));
  assert.equal(ent(h, ally)!.counters, -1, 'their counter landed on my unit');
  assert.equal(handOf(h, A), hand0, 'and drew me nothing');
  whiteBox(h, e => e.addCounters(ent(h, ally)!, 1, A));
  assert.equal(handOf(h, A), hand0 + 1, 'my own placement on my own ally still draws');
});

// ══ FLUX RESONATOR ═════════════════════════════════════════════════════
//
// "If one or more counters would be put on a unit by an allied source, put
// that many counters plus one instead." The recipient is ANY unit; the source
// is the clause. Both halves of the old approximation come off with `by`.

test('Resonator: counters YOU put on an ENEMY unit are plus one too', () => {
  // "On a unit", not "on an allied unit". The old reading keyed on the
  // recipient and so refused this outright.
  const { h, A, enemy } = board(12010, 'Flux Resonator');
  whiteBox(h, e => e.addCounters(ent(h, enemy)!, 1, A));
  assert.equal(ent(h, enemy)!.counters, 2, '1 put by an allied source + 1');
});

test('Resonator: -1/-1 counters get one more of the SAME — all counters count', () => {
  // The sign filter was never printed. "That many counters plus one" is one
  // more of the same thing, which is the `step` idiom Proliferating Slime (the
  // same clause from the other side) has always used. It cuts both ways: my
  // own -1/-1s deepen too, and nothing prints that the clause only helps.
  const { h, A, ally, enemy } = board(12011, 'Flux Resonator');
  whiteBox(h, e => e.addCounters(ent(h, enemy)!, -1, A));
  assert.equal(ent(h, enemy)!.counters, -2, 'one -1/-1 becomes two');
  whiteBox(h, e => e.addCounters(ent(h, ally)!, -1, A));
  assert.equal(ent(h, ally)!.counters, -2, 'and on my own unit as well — a drawback is still the card');
});

test("Resonator: an ENEMY's placement onto your own unit is not an allied source", () => {
  // The false positive the recipient reading could not see, and the one that
  // was actively working for the other player: D's Buffer Overflow doubling
  // the +1/+1s on MY unit used to collect a free extra counter from my
  // Resonator, because the counters landed on an allied unit.
  const { h, A, D, ally } = board(12012, 'Flux Resonator');
  whiteBox(h, e => e.addCounters(ent(h, ally)!, 1, D));
  assert.equal(ent(h, ally)!.counters, 1, 'their placement, their number');
  whiteBox(h, e => e.addCounters(ent(h, ally)!, 1, A));
  assert.equal(ent(h, ally)!.counters, 3, 'and mine is plus one: 1 + (1 + 1)');
});
