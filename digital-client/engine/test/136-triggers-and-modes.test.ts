/* R161 — six of the owner's R157 answers, made real.
 *
 * R157 is the owner's 2026-08-25 pass over 27 card questions. Six of them are
 * behaviour changes in cards this file guards, and every one of them REVERSES
 * something the engine shipped, which is why they get a file rather than a
 * line in a per-batch test: a reversal that is only ever asserted next to the
 * card it changed is a reversal nobody notices going back.
 *
 *   §15  Stellarspore Harvester's condition is checked at RESOLUTION only —
 *        "you can target any enemy, it only checks whether you gain control of
 *        it on resolution". Both `when` gates go.
 *   §16  A trigger fires ONCE PER TARGETED ALLY — "two targets, two triggers,
 *        two 1/1s" (Earnest Defender).
 *   §21  A [bracketed] clause is an additional cost or a MODE, chosen when the
 *        item goes on the stack (Retribution Thing's "[lost or gained]").
 *   §22  X = 0 is a legal activation — "you can legally activate it and
 *        discard no cards" (No Hand Killer).
 *   §24  "Unique token" means a unique (name, X) pair — "you get two extras"
 *        (Automaton of Abundance).
 *   §26  Rook grants {Virus} ITSELF, not merely the battle-window timing —
 *        "(a) yes it does. and for (b) yes it can also go to an enemy. That's
 *        the whole point of the card."
 *
 * HOUSE RULES this file obeys:
 *  · assertions are on STATE and on the engine's event vocabulary, never on
 *    log prose;
 *  · no `{ todo: true }` — a todo can never fail;
 *  · every test was red-checked against a named mutation of the card it
 *    guards, written down beside it.
 *
 * Seeds 13600-13699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { getCard } from '../src/cards/dsl.ts';
import type { TokenRequest } from '../src/cards/dsl.ts';
import type { Entity, EntityId, Seat } from '../src/types.ts';
import {
  assignDefault, ent, finishBattle, give, giveResources, offered, pass, pick,
  spawn, toDeployment, toNextBattle, unitsOf, withE as whiteBox,
} from './util.ts';

/** spawn a stat token (no printed triggers) into a seat's home region */
function spawnToken(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const e = new E(h.state);
  const u = e.spawnUnit(seat, 'Unit Token', e.homeRegion(seat), { token: true, tokenStats: [p, t] });
  e.settle();
  return u.id;
}

/** the actions `seat` is being offered right now, as a JSON multiset */
const actionKeys = (h: Harness, seat: Seat): string[] => h.legal(seat).map(a => JSON.stringify(a));

/** pass the stack empty, answering any decision with its first option */
function drainStack(h: Harness): void {
  let guard = 60;
  while (h.state.stack.length && guard-- > 0) {
    if (h.state.decision) {
      const dec = h.state.decision;
      h.do({
        type: 'decide', seat: dec.seat,
        choice: dec.pickOrder ? dec.options.map((_, i) => i) : 0,
      });
      continue;
    }
    pass(h);
  }
  if (guard <= 0) throw new Error('drainStack did not terminate');
}

// ══════════════════════════════════════════════════════════════════════════
// §15 — STELLARSPORE HARVESTER CHECKS ITS CONDITION AT RESOLUTION ONLY
// ══════════════════════════════════════════════════════════════════════════
//
// RED-CHECK for both tests below: restore either gate on the card —
//   `when: (g, self) => g.unitsIn(self.region).some(u => u.counters < 0)`
// on the afterCombat half, or
//   `when: (g, self) => g.unitsOf(self.controller, self.region).some(u => u.counters < 0 && u.id !== self.id)`
// on the [Augment] died half — and the matching test fails on "the trigger
// fired at all", because with a clean board neither gate is satisfied.

test('R157 §15: the after-combat trigger fires with NO -1/-1 counter anywhere, and offers a clean enemy', () => {
  const h = new Harness(13600);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const harv = spawn(h, D, 'Stellarspore Harvester');       // 3/5, the defender's
  const clean = spawnToken(h, A, 2, 2);                     // a spotless enemy
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[clean]] });
  pass(h); pass(h);                                         // attack window → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                         // → combat → after-combat
  assignDefault(h);
  // nothing on the board carries a counter, and the trigger still asked
  assert.ok(unitsOf(h, A).concat(unitsOf(h, D)).every(u => u.counters === 0),
    'the board really is clean — the old gate would have found nothing');
  assert.equal(h.state.decision?.kind, 'targets', 'the trigger fired and is asking for a target');
  assert.ok(offered(h).includes(JSON.stringify({ unit: clean })),
    'a spotless enemy is on the menu — "you can target any enemy"');
  assert.ok(ent(h, harv), 'the Harvester is still standing');
  pick(h, { unit: clean });
  finishBattle(h);
});

test('R157 §15: target a clean enemy, counter it in the after-window, and the steal lands', () => {
  // THE LINE THE GATE COST, and the reason it was escalated: after combat,
  // aim at a spotless enemy, put a -1/-1 counter on it with a {Battle} spell
  // while the trigger sits on the stack, and gain control of it. Under the old
  // gate the trigger never fired, so this play did not exist.
  const h = new Harness(13601);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  spawn(h, D, 'Stellarspore Harvester');
  const prey = spawnToken(h, A, 3, 3);                      // a spotless enemy 3/3
  giveResources(h, D, 'wood', 2);                           // Noxious Demise gg/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[prey]] });
  pass(h); pass(h);                                         // attack window → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assignDefault(h);
  pick(h, { unit: prey });                                  // aim the trigger at the CLEAN enemy
  assert.equal(h.state.stack.length, 1, 'the trigger is on the stack, waiting');
  assert.equal(ent(h, prey)!.counters, 0, 'and its target has no counter yet');
  // …now make the condition true, in the window the stack gives us
  pass(h);                                                  // A responds first, and declines
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Noxious Demise') });
  pick(h, { unit: prey });
  pass(h); pass(h);                                         // the Demise resolves (above the trigger)
  assert.equal(ent(h, prey)!.counters, -1, 'the counter landed first');
  assert.equal(h.state.stack.length, 1, 'and the trigger is still there, unresolved');
  pass(h); pass(h);                                         // the trigger resolves
  assert.equal(ent(h, prey)!.controller, D, 'the condition was true AT RESOLUTION — the steal happens');
  finishBattle(h);
});

test('R157 §15: the [Augment] death half fires with no -1/-1-countered ally to give away', () => {
  const h = new Harness(13602);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const harv = spawn(h, D, 'Stellarspore Harvester');
  spawnToken(h, D, 1, 1);                                   // a spotless ally, not given away
  const atk = spawnToken(h, A, 1, 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });   // R25: A is present here
  // kill it outright: the death trigger must fire even with nothing to hand over
  whiteBox(h, e => e.destroy(e.entity(harv)!, 'dies'));
  assert.equal(h.state.decision?.kind, 'targets',
    'the death trigger fired with nothing to hand over — the old gate would have queued nothing');
  assert.deepEqual(offered(h), [JSON.stringify({ player: A })], 'target OPPONENT, and only that');
  pick(h, { player: A });
  drainStack(h);
  assert.equal(unitsOf(h, D).length, 1, 'the spotless ally stayed put — none of them qualified');
  assert.equal(unitsOf(h, A).length, 1, 'and the opponent received nothing — just their attacker');
  finishBattle(h);
});

// ══════════════════════════════════════════════════════════════════════════
// §16 — ONE 1/1 PER TARGETED ALLY
// ══════════════════════════════════════════════════════════════════════════
//
// RED-CHECK: change Earnest Defender's `run` back to the single
// `makeOneOne(g, ctx.controller, ctx.region)` (drop the loop) and the
// two-target test fails 1 !== 2. Red-checked a second way, at the counting
// helper: replace `targetedAllies`' final `.filter(...).length` with
// `.some(...) ? 1 : 0` and it fails identically, which pins the count on the
// number of TARGETED ALLIES rather than on the loop existing.

/** D fields an Earnest Defender and two more allies; A holds a Twin Flame.
 * Stops in the attack window with A holding priority. */
function twinFlameBoard(seed: number):
{ h: Harness; A: Seat; D: Seat; allies: EntityId[]; theirs: EntityId[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  spawn(h, D, 'Earnest Defender');                          // 1/3, the [Augment] text is live
  const allies = [spawnToken(h, D, 1, 4), spawnToken(h, D, 1, 4)];
  // A's own units reach the battle region only by ATTACKING into it (R12), and
  // the "aimed at their own board" case needs two of them there to shoot
  const theirs = [spawnToken(h, A, 1, 4), spawnToken(h, A, 1, 4)];
  giveResources(h, A, 'fire', 3);                           // Twin Flame rr/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[theirs[0]!], [theirs[1]!]] });
  return { h, A, D, allies, theirs };                       // A holds priority
}

test('R157 §16: two targeted allies are TWO TRIGGERS on the stack, not one that makes two', () => {
  // The ruling is "two targets, two TRIGGERS, two 1/1s" — and the trigger count
  // is not cosmetic. Under the old log-tail reconstruction one trigger made two
  // tokens, so a negate aimed at it took BOTH, an ordering question listed one
  // entry instead of two, and both tokens arrived in a single creation batch
  // (where an Automaton of Abundance adds one extra, not two).
  //
  // Asserted on the STACK, before anything resolves, because that is where the
  // difference lives; the token count downstream is identical either way and
  // the sibling test above cannot tell them apart.
  const { h, A, allies } = twinFlameBoard(13611);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Twin Flame') });
  pick(h, { unit: allies[0]! });
  pick(h, { unit: allies[1]! });
  if (h.state.decision) pick(h, { doneTargets: true });

  const mine = h.state.stack.filter(i => i.kind === 'triggered'
    && (i.label ?? '').includes('1/1'));
  assert.equal(mine.length, 2,
    `two allies were targeted, so Earnest Defender is on the stack TWICE — one trigger per `
    + `target, each separately respondable. Stack held: `
    + JSON.stringify(h.state.stack.map(i => `${i.kind}:${i.label ?? ''}`)));
  finishBattle(h);
});

test('R157 §16: an enemy spell targeting TWO allies makes TWO 1/1s', () => {
  const { h, A, D, allies } = twinFlameBoard(13610);
  const before = unitsOf(h, D).length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Twin Flame') });
  pick(h, { unit: allies[0]! });
  pick(h, { unit: allies[1]! });
  if (h.state.decision) pick(h, { doneTargets: true });
  drainStack(h);                                            // the trigger, then Twin Flame
  const made = unitsOf(h, D).length - before;
  assert.equal(made, 2, 'once per targeted ally — two targets, two 1/1s');
  finishBattle(h);
});

test('R157 §16: the same spell aimed at ONE ally still makes exactly one', () => {
  const { h, A, D, allies } = twinFlameBoard(13611);
  const before = unitsOf(h, D).length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Twin Flame') });
  pick(h, { unit: allies[0]! });
  if (h.state.decision) pick(h, { doneTargets: true });
  drainStack(h);
  assert.equal(unitsOf(h, D).length - before, 1, 'one targeted ally, one 1/1');
  finishBattle(h);
});

test('R157 §16: a spell aimed at the enemy\'s OWN units makes none', () => {
  // the multiplicity is over TARGETED ALLIES, not over targets: A shooting
  // A's own board is not "an ally becomes the target of an enemy spell"
  const { h, A, D, theirs } = twinFlameBoard(13612);
  const before = unitsOf(h, D).length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Twin Flame') });
  pick(h, { unit: theirs[0]! });
  pick(h, { unit: theirs[1]! });
  if (h.state.decision) pick(h, { doneTargets: true });
  drainStack(h);
  assert.equal(unitsOf(h, D).length - before, 0, 'no ally was targeted — no 1/1');
  finishBattle(h);
});

// ══════════════════════════════════════════════════════════════════════════
// §21 — RETRIBUTION THING'S BRACKET IS A CAST-TIME MODE
// ══════════════════════════════════════════════════════════════════════════
//
// RED-CHECK: put the sum back —
//   `const x = g.battleCounter(ctx.region, 'lifeLost:' + ctx.controller)
//            + g.battleCounter(ctx.region, 'lifeGained:' + ctx.controller);`
// and drop `modes`. The two mode tests then fail at `decision.kind === 'mode'`
// ("the half is a cast-time question"), and the "5, not 12" assertion fails
// with 12 even if the modes block is kept and only `run` reverts.

/** A attacks with a 7/5 into an empty board: D loses 7, and D then gains 5
 * from a Ceremonial Blade-free source (white-box gainLife, which is what the
 * `lifeGained` ledger is bumped by). Stops in the after-combat window. */
function bothLedgersMoved(seed: number): { h: Harness; A: Seat; D: Seat; prey: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const prey = spawnToken(h, D, 9, 9);                      // the punchbag, in the battle region
  const atk = spawn(h, A, 'Good Whale');                    // 7/5
  giveResources(h, D, 'light', 2);                          // Retribution Thing l/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                         // combat: D loses 7
  assignDefault(h);
  whiteBox(h, e => e.gainLife(D, 5, 'test'));               // …and gains 5
  pass(h);                                                  // A declines the after-window
  return { h, A, D, prey };                                 // D holds priority
}

test('R157 §21: the half is named at CAST, and "gained" reads only the gained ledger', () => {
  const { h, D, prey } = bothLedgersMoved(13620);
  const ledger = new E(h.state);
  assert.equal(ledger.battleCounter(h.state.battle!.region, `lifeLost:${D}`), 7, 'lost 7');
  assert.equal(ledger.battleCounter(h.state.battle!.region, `lifeGained:${D}`), 5, 'gained 5');
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Retribution Thing') });
  pick(h, { unit: prey });
  assert.equal(h.state.decision?.kind, 'mode', 'the half is a cast-time question');
  assert.equal(h.state.stack.length, 0, 'and it is asked BEFORE the item reaches the stack');
  pick(h, 'gained');
  assert.deepEqual(h.state.stack.map(i => i.parts.map(p => p.mode)), [['gained']],
    'the declared half is readable on the stack, for the whole response window');
  pass(h); pass(h);
  assert.equal(ent(h, prey)!.damage, 5, 'X is the GAINED ledger alone — 5, not 12 and not 7');
  finishBattle(h);
});

test('R157 §21: the other half of the same board reads the lost ledger', () => {
  const { h, D, prey } = bothLedgersMoved(13621);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Retribution Thing') });
  pick(h, { unit: prey });
  pick(h, 'lost');
  pass(h); pass(h);
  assert.equal(ent(h, prey)!.damage, 7, 'X is the LOST ledger alone — 7, not 12 and not 5');
  finishBattle(h);
});

test('R157 §21: the mode is FIXED at cast — a ledger that moves afterwards does not re-pick it', () => {
  // R57's whole point: the opponent responds to a fully declared effect. The
  // half cannot be re-chosen once it is on the stack, and R1 still reads the
  // AMOUNT at resolution — so a "gained" cast whose gained ledger grows in the
  // response window deals the bigger number, and never switches to "lost".
  const { h, D, prey } = bothLedgersMoved(13622);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Retribution Thing') });
  pick(h, { unit: prey });
  pick(h, 'gained');
  whiteBox(h, e => e.gainLife(D, 2, 'test'));               // gained: 5 → 7
  whiteBox(h, e => e.loseLife(D, 6, 'test'));               // lost:   7 → 13
  assert.deepEqual(h.state.stack.map(i => i.parts.map(p => p.mode)), [['gained']],
    'still "gained" — nobody was asked again');
  pass(h); pass(h);
  assert.equal(ent(h, prey)!.damage, 7,
    'the declared LEDGER is fixed at cast; the AMOUNT in it is read at resolution (R1)');
  finishBattle(h);
});

// ══════════════════════════════════════════════════════════════════════════
// §22 — X = 0 IS A LEGAL ACTIVATION
// ══════════════════════════════════════════════════════════════════════════
//
// RED-CHECK: put `xMin: 1` back on No Hand Killer's castCost. The empty-hand
// test then fails at "the ability is offered" (canPayCastCost wants 1 card
// and legalActions stops offering it), which is exactly the behaviour the
// ruling refuses.

test('R157 §22: No Hand Killer is activatable with an EMPTY hand, and burns its [once] for nothing', () => {
  const h = new Harness(13630);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const nhk = spawn(h, P, 'No Hand Killer');
  const foe = spawnToken(h, 1 - P as Seat, 2, 2);
  h.state.players[P]!.hand.length = 0;                      // no cards at all
  const act = JSON.stringify({ type: 'activateAbility', seat: P, entityId: nhk, abilityIndex: 0, via: 'augment' });
  assert.ok(actionKeys(h, P).includes(act),
    'the ability is offered with nothing to discard — "you can legally activate it"');
  h.do({ type: 'activateAbility', seat: P, entityId: nhk, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.decision, null, 'nothing to ask: an empty hand pays X = 0 with no menu');
  assert.ok(ent(h, foe), 'X = 0 — nobody sacrificed anything');
  // …and the [once] really is gone, which is the price the ruling accepts
  assert.ok(!actionKeys(h, P).includes(act), 'the [once] budget was spent on the pointless activation');
});

test('R157 §22: with cards in hand the same ability still offers a real X, and X = 0 is one of the options', () => {
  const h = new Harness(13631);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const nhk = spawn(h, P, 'No Hand Killer');
  const foe = spawnToken(h, 1 - P as Seat, 2, 2);
  h.state.players[P]!.hand.length = 0;
  give(h, P, 'Unit Token');
  h.do({ type: 'activateAbility', seat: P, entityId: nhk, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.decision?.kind, 'targets', 'the discard cost is being paid in the cast window');
  assert.ok(offered(h).includes(JSON.stringify({ doneCost: true })),
    'stopping at X = 0 is on the menu — the floor is 0, not 1');
  pick(h, { doneCost: true });                              // discard nothing
  assert.ok(ent(h, foe), 'X = 0 sacrificed nothing');
  assert.equal(h.state.players[P]!.hand.length, 1, 'and discarded nothing');
});

// ══════════════════════════════════════════════════════════════════════════
// §24 — "UNIQUE" IS THE (name, X) PAIR
// ══════════════════════════════════════════════════════════════════════════
//
// RED-CHECK: key the uniqueness Set on `r.name` alone again (the shipped
// behaviour before this ruling). The Robot 2 + Robot 5 test then fails 1 !== 2
// and the Manufacture test fails 4 !== 6, while the three-identical-Robots
// test stays green — which is what makes it worth keeping.

/** the batch replacement as the engine calls it, on a real anchor */
function extrasFor(h: Harness, anchor: Entity, batch: TokenRequest[]): TokenRequest[] {
  const e = new E(h.state);
  return getCard('Automaton of Abundance').replaceTokenBatch!(e, anchor, batch) ?? [];
}

test('R157 §24: a Robot 2 and a Robot 5 in one batch yield TWO extras, one of each', () => {
  const h = new Harness(13640);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const aoa = ent(h, spawn(h, A, 'Automaton of Abundance'))!;
  const region = aoa.region;
  const extras = extrasFor(h, aoa, [
    { form: 'unit', name: 'Robot', x: 2, seat: A, region },
    { form: 'unit', name: 'Robot', x: 5, seat: A, region },
  ]);
  assert.equal(extras.length, 2, '"you get two extras" — the pair (name, X) is what is unique');
  assert.deepEqual(extras.map(r => r.x).sort((a, b) => a - b), [2, 5],
    'one of each, not two of the first');
});

test('R157 §24: three IDENTICAL Robot 2s are one unique token and still yield ONE extra', () => {
  const h = new Harness(13641);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const aoa = ent(h, spawn(h, A, 'Automaton of Abundance'))!;
  const region = aoa.region;
  const extras = extrasFor(h, aoa, [
    { form: 'unit', name: 'Robot', x: 2, seat: A, region },
    { form: 'unit', name: 'Robot', x: 2, seat: A, region },
    { form: 'unit', name: 'Robot', x: 2, seat: A, region },
  ]);
  assert.equal(extras.length, 1, 'same name AND same X is one unique token');
  assert.equal(extras[0]!.x, 2);
});

test('R157 §24: end to end — Manufacture\'s Robot 3/2/1 is THREE unique tokens', () => {
  // the whole path, through a real creation batch: one resolving part, three
  // requests with three different X, three extras
  const h = new Harness(13642);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Automaton of Abundance');
  giveResources(h, A, 'metal', 6);                          // Manufacture mmm/6
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Manufacture') });
  const robots = unitsOf(h, A).filter(u => u.card === 'Robot');
  assert.equal(robots.length, 6, 'three printed Robots and three extras');
  assert.deepEqual(robots.map(r => r.counters).sort((a, b) => a - b), [1, 1, 2, 2, 3, 3],
    'one extra per (name, X) pair — a copy of each, X and all');
});

// ══════════════════════════════════════════════════════════════════════════
// §26 — ROOK CONFERS {Virus}, SO ITS AUGMENT REACHES AN ENEMY AND THE STACK
// ══════════════════════════════════════════════════════════════════════════
//
// RED-CHECK: narrow Rook's grant to its own side —
//   `augmentInBattle: (g, self, ctx) => ctx.seat === self.controller
//      && (ctx.from === 'hand' || ctx.from === 'bin') && false`
// (or simply delete `modPermissions`) and both tests fail at "the augment is
// offered". Narrower and more interesting: keep the grant but make apply.ts's
// battle branch demand `host.controller === seat` and the ENEMY test fails
// while the stack test stays green — which is the exact half of the ruling
// ("(b) it can also go to an enemy") that was flagged open.

/** D fields a Rook and holds a plain non-Virus augment; A is attacking with a
 * 2/2. Stops in the attack window with D holding priority. */
function rookBoard(seed: number): { h: Harness; A: Seat; D: Seat; theirs: EntityId; curio: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  spawn(h, D, 'Rook');                                      // 4/4, the permission
  const theirs = spawnToken(h, A, 2, 2);
  giveResources(h, D, 'water', 1);                          // Curio Drifter b/1
  toNextBattle(h, A);
  const curio = give(h, D, 'Curio Drifter');
  h.do({ type: 'declareAttack', seat: A, columns: [[theirs]] });
  return { h, A, D, theirs, curio };                        // A holds priority
}

test('R157 §26: a Rook-enabled augment lands on an ENEMY unit during battle', () => {
  const { h, D, theirs, curio } = rookBoard(13650);
  pass(h);                                                  // A declines → D holds priority
  assert.equal(getCard('Curio Drifter').virus, false,
    'the card is NOT printed {Virus} — the permission is doing all the work');
  const act = { type: 'augment' as const, seat: D, from: 'hand' as const, index: curio, hostId: theirs };
  assert.ok(actionKeys(h, D).includes(JSON.stringify(act)),
    'the augment is offered onto the ENEMY unit — "it can also go to an enemy"');
  h.do(act);
  assert.equal(h.state.stack.length, 1, 'it is a response, on the stack above nothing');
  pass(h); pass(h);
  const host = ent(h, theirs)!;
  assert.equal(host.mods.length, 1, 'the mod attached to the enemy unit');
  assert.ok(new E(h.state).ownAttrs(host).has('Evasive'),
    'and it really donated its [Augment] attribute to a unit its owner does not control');
  finishBattle(h);
});

test('R157 §26: without a Rook the same augment is not offered at all', () => {
  // the control: this is R95's printed base case ("a {Virus}, from hand, and
  // nothing else"), and it is what the permission is overriding
  const h = new Harness(13651);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const theirs = spawnToken(h, A, 2, 2);
  const mine = spawnToken(h, D, 2, 2);
  giveResources(h, D, 'water', 1);
  toNextBattle(h, A);
  const curio = give(h, D, 'Curio Drifter');
  h.do({ type: 'declareAttack', seat: A, columns: [[theirs]] });
  pass(h);
  const keys = actionKeys(h, D);
  assert.ok(!keys.some(k => k.includes('"augment"')),
    `no Rook, no battle augment — onto an enemy OR onto my own ${mine}: ${keys.join(' ')}`);
  assert.ok(!keys.includes(JSON.stringify(
    { type: 'augment', seat: D, from: 'hand', index: curio, hostId: theirs })));
  finishBattle(h);
});

test('R157 §26: a Rook-enabled augment reaches a SPELL ON THE STACK (R79)', () => {
  const { h, A, D, curio } = rookBoard(13652);
  giveResources(h, A, 'fire', 3);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Twin Flame') });
  if (h.state.decision) pick(h, { doneTargets: true });                                  // R126: "up to two" — declare none
  const host = h.state.stack[0]!.id;
  const act = { type: 'augment' as const, seat: D, from: 'hand' as const, index: curio, hostStack: host };
  assert.ok(actionKeys(h, D).includes(JSON.stringify(act)),
    'R79\'s stack host is reachable through the same permission');
  h.do(act);
  assert.equal(h.state.stack.length, 2, 'the virus sits above the spell it is augmenting');
  finishBattle(h);
});

test('R157 §26: the permission is the ROOK CONTROLLER\'s, not everybody\'s', () => {
  // "[Augment] You may augment…" — `self` is the anchor, so the grant belongs
  // to the Rook's controller. The attacker gets nothing out of it.
  const { h, A, theirs } = rookBoard(13653);
  giveResources(h, A, 'water', 1);
  const theirCurio = give(h, A, 'Curio Drifter');
  assert.ok(!actionKeys(h, A).includes(JSON.stringify(
    { type: 'augment', seat: A, from: 'hand', index: theirCurio, hostId: theirs })),
  'A holds a Rook-less hand: no battle augment for them');
  assert.ok(ent(h, theirs), 'their unit is untouched');
  finishBattle(h);
});
