/* R67 — "target" is chosen when the effect is PUT ON THE STACK.
 *
 * The playtest report: "Lots of cards seem to choose targets on resolution
 * rather than when they're played or put onto the stack. In many cases, this
 * is wrong. Any card or effect that says 'target' has to be chosen initially
 * when put onto the stack. Same for when you need to pay an additional cost."
 *
 * The engine's cast chain was already right — E.castChain runs collectTargets
 * and THEN commitItem, for played cards, activated abilities and (through
 * processTriggerQueue) triggered ones, and every cast-time cost is paid in the
 * same pass. What was wrong was eleven individual cards that never declared a
 * `targets` spec and re-derived their "target" with a mid-resolution
 * ctx.choose, most of them written before R58/R64 built the seams they needed.
 *
 * These tests pin the PROPERTY rather than each card's flavour: while the
 * decision is pending the item is not yet on the stack, and once it is on the
 * stack its declared targets are visible in `part.targets`. That is what makes
 * a response window meaningful, what lets a redirect find a slot, and what
 * makes R5's "the target is gone" fizzle possible at all.
 *
 * Seeds 6000-6099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  ent, finishBattle, give, giveResources, notOffered, pass, pick,
  spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';
import type { Seat } from '../src/types.ts';

/** the declared targets of everything currently on the stack */
const aimedAt = (h: Harness): unknown[] =>
  h.state.stack.flatMap(i => i.parts.flatMap(p => p.targets));

/** clear a seat's bin and hand so a bin target menu is exactly what we put there */
function clearBin(h: Harness, seat: Seat): void { h.state.players[seat]!.bin = []; }

/* ── the property: aimed BEFORE it lands on the stack ──────────────────── */

test('R67: a bin target is asked while the stack is still empty, then rides on the stack', () => {
  const h = new Harness(6000);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  clearBin(h, p);
  h.state.players[p]!.bin.push('Immolate', 'Conduit of Pain');   // a spell and a unit
  giveResources(h, p, 'fire', 4);
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Delver of Mysteries') });
  // the decision is part of CASTING: nothing is on the stack yet
  assert.equal(h.state.decision?.kind, 'targets');
  assert.equal(h.state.stack.length, 0, 'targets come before the stack');
  // and only the SPELL is a legal target — "target spell in your bin"
  notOffered(h, { bin: { seat: p, card: 'Conduit of Pain' } }, 'a unit is not a spell');
  pick(h, { bin: { seat: p, card: 'Immolate' } });
  assert.ok(h.state.players[p]!.hand.includes('Immolate'), 'recalled on resolution');
});

test('R67: a spell played in battle shows its declared target on the stack, before it resolves', () => {
  const h = new Harness(6001);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Curio Drifter');
  const whale = spawn(h, D, 'Good Whale');
  giveResources(h, D, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tidal Reversion') });
  // "For each player, recall target unit that player controls" — one per
  // player, both named while the Reversion is still being cast
  assert.equal(h.state.stack.length, 0, 'not on the stack while it is being aimed');
  pick(h, { unit: whale });
  notOffered(h, { unit: whale }, 'already chosen — one target per player');
  pick(h, { unit: atk });
  assert.equal(h.state.stack.length, 1, 'now it is on the stack');
  assert.deepEqual(aimedAt(h), [{ unit: whale }, { unit: atk }],
    'and the opponent can SEE what it is aimed at while they still hold priority');
  pass(h); pass(h);
  assert.ok(!ent(h, whale) && !ent(h, atk), 'both recalled');
  finishBattle(h);
});

test('R67: a triggered ability is aimed as it goes on the stack, not as it resolves', () => {
  const h = new Harness(6002);
  toDeployment(h);
  const A = h.state.initiative;
  const hooba = spawn(h, A, 'Hooba-Mon');
  clearBin(h, A);
  h.state.players[A]!.bin.push('Unit Token');                    // [0] — cost ≤ 3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[hooba]] });
  assert.equal(h.state.decision?.kind, 'targets', 'the trigger asks first');
  assert.equal(h.state.stack.length, 0, 'and is not on the stack yet');
  pick(h, { bin: { seat: A, card: 'Unit Token' } });
  assert.equal(h.state.stack.length, 1);
  assert.deepEqual(aimedAt(h), [{ bin: { seat: A, card: 'Unit Token' } }]);
});

/* ── a mandatory target with nothing legal makes the CAST illegal ──────── */

test('R67: "put target unit from your bin into play" with an empty bin is refused, not wasted', () => {
  const h = new Harness(6003);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  clearBin(h, p);
  giveResources(h, p, 'light', 1);
  giveResources(h, p, 'dark', 1);
  giveResources(h, p, 'earth', 1);
  const idx = give(h, p, 'Covenant of the Damned');
  const manaBefore = h.q.openMana(p);
  assert.throws(() => h.do({ type: 'playCard', seat: p, handIndex: idx }), /no legal target/i);
  assert.ok(h.state.players[p]!.hand.includes('Covenant of the Damned'), 'still in hand');
  assert.equal(h.q.openMana(p), manaBefore, 'and the mana was not spent');
  // with something legal in the bin it becomes castable again
  h.state.players[p]!.bin.push('Gublin');
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Covenant of the Damned') });
  pick(h, { bin: { seat: p, card: 'Gublin' } });
  assert.ok(unitsOf(h, p).some(u => u.card === 'Gublin'), 'reanimated');
});

/* ── the ownership kinds: 'opponent' vs the new 'player' (R67) ─────────── */

test("R67: 'opponent' is measured from the EFFECT's controller, not the chooser's", () => {
  const h = new Harness(6004);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const frog = spawn(h, D, 'Mindwarp Sporefrog');   // "target opponent gains control of me"
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                 // D takes 1 → the trigger fires
  assert.equal(h.state.decision?.kind, 'targets');
  // D controls the effect, so D is NOT an opponent of it — only A is offered
  assert.deepEqual(h.state.decision!.options.map(o => o.value), [{ player: A }]);
  pick(h, { player: A });
  assert.equal(ent(h, frog)!.controller, A);
  finishBattle(h);
});

test("R67: plain \"target player\" ('player') may legally be YOURSELF", () => {
  const h = new Harness(6005);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const whale = spawn(h, A, 'Good Whale');          // 7/5
  giveResources(h, D, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                 // D loses 7
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Soul Siphon') });
  // Soul Siphon says "target player", not "target opponent" — BOTH are legal,
  // and aiming it at yourself is the whole point when you are the one bleeding
  const vals = h.state.decision!.options.map(o => JSON.stringify(o.value));
  assert.ok(vals.includes(JSON.stringify({ player: D })), 'yourself is a legal target');
  assert.ok(vals.includes(JSON.stringify({ player: A })), 'so is the opponent');
  pick(h, { player: D });
  pass(h); pass(h);
  const made = unitsOf(h, D).filter(u => u.card === 'Unit Token');
  assert.equal(made.length, 1);
  assert.deepEqual(new E(h.state).effStats(made[0]!), [7, 7], 'X = the 7 D lost');
  finishBattle(h);
});

/* ── TargetCtx.event: a target phrased relative to the trigger (R67) ───── */

test("R67: \"that player's bin\" reads the EVENT — only the damaged player's bin is offered", () => {
  const h = new Harness(6006);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const sk = spawn(h, A, 'Rippleback Skulker');
  clearBin(h, A); clearBin(h, D);
  h.state.players[D]!.bin.push('Jelly');            // the victim's bin
  h.state.players[A]!.bin.push('Good Whale');       // my own — NOT "that player's"
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                 // my column connects to D
  assert.equal(h.state.decision?.kind, 'targets');
  notOffered(h, { bin: { seat: A, card: 'Good Whale' } }, "my bin is not THAT player's");
  pick(h, { bin: { seat: D, card: 'Jelly' } });
  assert.ok(h.state.players[A]!.hand.includes('Jelly'), 'taken into my hand');
  finishBattle(h);
});

/* ── X sizes the spell first, then the collector asks for that many ────── */

test('R67: "X target units" asks for exactly X targets, after X is fixed and paid', () => {
  const h = new Harness(6007);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const mine = spawn(h, A, 'Hammer of Justice');
  const theirs = spawn(h, D, 'Hammer of Justice');
  giveResources(h, A, 'wood', 1);
  giveResources(h, A, 'dark', 1);
  giveResources(h, A, 'earth', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, "Blight's End") });
  pick(h, 2);                                       // X = 2, paid at cast (R35)
  // "target units" is unqualified, so an ENEMY unit is a legal host
  pick(h, { unit: mine });
  pick(h, { unit: theirs });
  assert.equal(h.state.stack.length, 1, 'fully aimed before it lands');
  assert.deepEqual(aimedAt(h), [{ unit: mine }, { unit: theirs }]);
  pass(h); pass(h);
  for (const id of [mine, theirs]) {
    assert.equal(ent(h, id)!.mods.length, 1, 'a Wraith augmented each declared target');
  }
  finishBattle(h);
});

/* ── a declared target that dies before resolution FIZZLES (R5) ────────── */

test('R67: declaring the target is what lets R5 fizzle it when it disappears', () => {
  const h = new Harness(6008);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Curio Drifter');
  const whale = spawn(h, D, 'Good Whale');
  giveResources(h, D, 'water', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tidal Reversion') });
  pick(h, { unit: whale });
  pick(h, { unit: atk });
  assert.equal(h.state.stack.length, 1);
  // the whale leaves before the Reversion resolves — the declared slot is now
  // empty, which is only observable BECAUSE it was declared
  const e = new E(h.state);
  e.destroy(e.entity(whale)!, 'is deleted');
  h.state = e.s;
  assert.ok(!h.state.stack[0]!.parts[0]!.targets.every(t => e.targetStillLegal(t)),
    'one declared target is gone');
  pass(h); pass(h);
  assert.ok(!ent(h, atk), 'the surviving target still resolves (R5 partial)');
  finishBattle(h);
});

/* ── the restriction that used to probe ANOTHER card's spec ──────────── */

// R197 RETIRED THE HAZARD THIS TEST WAS WRITTEN FOR, and the test is kept
// because the CARD is still the one that would have hit it. Spell Excavation's
// restriction used to ask targetCandidates about the bin card's OWN spec —
// "could that spell actually be played right now" — which is a nested query,
// self-referential when the bin card is another Spell Excavation, and it
// needed a `probing` re-entrancy guard. The card grants a play window until
// regroup now instead of playing the spell inline, so affordability and "can
// it find a target" are asked when the spell is actually PLAYED, later; the
// restriction is a printed-noun test (a spell, of battle timing) with no
// nested query in it at all. What is asserted below is unchanged and still
// worth asserting: a Spell Excavation in the bin is a legal target, and asking
// about it terminates.
test('R67/R197: a Spell Excavation in the bin is a legal target of another Spell Excavation', () => {
  const h = new Harness(6009);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Curio Drifter');
  clearBin(h, D);
  h.state.players[D]!.bin.push('Spell Excavation');   // ITSELF, in the bin
  giveResources(h, D, 'water', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  // "target spell from your bin" is a spell of battle timing — which the bin
  // copy is — and the question terminates because nothing about it is nested.
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Spell Excavation') });
  assert.equal(h.state.decision?.kind, 'targets');
  assert.ok(h.state.decision!.options.some(o => o.label.startsWith('Spell Excavation')),
    'the bin copy is offered, and asking about it terminated');
  pick(h, { doneTargets: true });                    // min 0: decline the "you may"
  pass(h); pass(h);
  finishBattle(h);
});
