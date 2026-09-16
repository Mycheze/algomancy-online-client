/* R295 — A SPLIT DAMAGE STEP IS SEVERAL STEPS.
 *
 * PLAYTEST REPORT #165, room KAWJ, 2026-09-15, filed by the owner (judge L1)
 * at action [246]: *"Damage got combined here Adversary of the Deep. All
 * combat damage happens as a single number."*
 *
 * The replay is faithful, and it says exactly what happened. mycheze attacked
 * with three columns: Bripp (4 power) and Bloated Manablub (2) struck in the
 * NORMAL sub-step for 6, and {Sluggish} Adversary of the Deep struck in the
 * Sluggish sub-step for 2. Adversary prints *"[Augment] Whenever a player
 * loses life, put that many +1/+1 counters on me"* — so its trigger heard the
 * 6, was HELD by R261, and Adversary struck as a printed 2/2. Both triggers
 * then landed after combat, on a board where the damage they were for had
 * already been dealt.
 *
 * The owner, 2026-09-16, on what should have happened:
 *
 *   > "165 is making a massive, fundamental error on combat calculations. When
 *   > there is no Sluggish or Swift involved in the combat, all damage happens
 *   > at once and any 'On damage' triggers end up happening in End of Combat.
 *   > But when there IS sluggish or swift, then there is a big change. They are
 *   > processed each as entire steps. The reason that the Adversary of the Deep
 *   > has sluggish is so that it gets its counters BEFORE dealing damage. So
 *   > there should have been 6 damage from the normal units, then the trigger
 *   > and resolution (allowing for responses and priority and everything), then
 *   > the adversary does 8 damage to Karanda."
 *
 * ⚠ THE CONDITION WAS ALWAYS IN R261 AND R261 DROPPED IT. Its own source quote
 * opens *"**If there are no units in combat with sluggish or [swift]**, there
 * will be no triggers during the damage step"*; the implementation kept the
 * sentence after it and made the hold unconditional. R295 is not a new rule so
 * much as the other half of an old one.
 *
 * ⚠ AND IT IS NOT A REVERT TO THE PRE-R261 ENGINE. That one resolved a
 * sub-step's triggers INSIDE the sub-step: built, aimed and resolved to
 * completion, never on the stack, never respondable, never taxed — which is
 * what report #119 (room YFUE) was filed about. R295 resolves them at the
 * sub-step BOUNDARY, on the stack, in an open priority window. The ordering
 * came back; R261's machinery is what carries it. 21-fixes' Flowstone Arcanite
 * test tells that story against a card.
 *
 * Seeds 29700-29799.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  effStats, ent, finishBattle, giveResources, pass, spawn, throughDamageWindows,
  toDeployment, toNextBattle,
} from './util.ts';
import type { Seat } from '../src/types.ts';

/* ══ §1 — THE REPORT ═════════════════════════════════════════════════ */

test('R295 §1 the report: a {Sluggish} Adversary of the Deep grows on the normal step BEFORE it strikes', () => {
  const h = new Harness(29701);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  // KAWJ's board, reduced: two normal columns that connect, and the Sluggish
  // Adversary in a third
  const adv = spawn(h, A, 'Adversary of the Deep');      // {Sluggish} 2/2
  const bripp = spawn(h, A, 'Bripp');                    // 4 power
  const blub = spawn(h, A, 'Bloated Manablub');          // 2 power
  toNextBattle(h, A);
  const life0 = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[bripp], [blub], [adv]] });
  assert.equal(h.q.combatSubStepOf(ent(h, adv)!), 'Sluggish', 'the Adversary strikes last');
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);

  // the normal sub-step has struck for 6 and the step has STOPPED there
  assert.equal(h.state.players[D]!.life, life0 - 6, 'Bripp 4 + Manablub 2, as one number');
  assert.equal(h.state.battle!.step, 'damageWindow', 'and the step is split, so priority is offered');
  assert.equal(h.state.battle!.pendingSub, 'Sluggish', 'with the Sluggish sub-step still to come');
  assert.deepEqual(effStats(h, adv), [2, 2], 'the Adversary has not grown yet — its trigger is on the stack');

  throughDamageWindows(h);

  // …and it grew BEFORE striking, which is the whole reason it is Sluggish
  assert.equal(ent(h, adv)!.counters, 6, 'six +1/+1 counters, off the six life lost');
  assert.deepEqual(effStats(h, adv), [8, 8], 'an 8/8 by the time its own sub-step runs');
  assert.equal(h.state.players[D]!.life, life0 - 14,
    'THE REPORT: 6, then 8 — not 6 then 2 with the counters arriving after combat');
  finishBattle(h);
});

/* ══ §2 — PRIORITY IS REAL AT THE BOUNDARY ══════════════════════════ */

test('R295 §2 the boundary is a real priority window: the other seat can respond before the next strike', () => {
  const h = new Harness(29702);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const adv = spawn(h, A, 'Adversary of the Deep');
  const bripp = spawn(h, A, 'Bripp');
  giveResources(h, D, 'fire', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bripp], [adv]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);

  assert.equal(h.state.battle!.step, 'damageWindow');
  assert.ok(h.state.stack.some(it => /Adversary of the Deep/.test(it.label)),
    'the trigger is a real stack item at the boundary');
  assert.equal(h.state.priority, D,
    "priority sits with the seat that does not control it — 'allowing for responses and "
    + "priority and everything'");
  assert.notEqual(h.state.passes, undefined);
  finishBattle(h);
});

/* ══ §3 — THE CONTROL: AN UNSPLIT STEP IS UNCHANGED ═════════════════ */

test('R295 §3 the control: with no {Swift} and no {Sluggish} anywhere, R261 is untouched', () => {
  const h = new Harness(29703);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  // the same Adversary trigger on a board with nothing fast or slow in it: its
  // carrier is a plain unit, so there is ONE sub-step and no boundary at all
  const lith = spawn(h, A, 'Lithoghul');                 // 4/4, no speed attribute
  const geo = spawn(h, A, 'Geode');                      // 1/1, no speed attribute
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lith], [geo]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.deepEqual(h.state.battle!.damageSubs, ['normal'],
    'one striking sub-step — the step is not split');
  assert.equal(h.state.battle!.step, 'afterWindow',
    'so combat runs straight through to after-combat, exactly as R261 leaves it');
  assert.equal(h.state.players[D]!.life, 30 - 5, 'and all of it landed as one number');
  finishBattle(h);
});

test('R295 §3b an EMPTY sub-step opens no window — a Swift-only battle gets one boundary, not two', () => {
  const h = new Harness(29704);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const swift = spawn(h, A, 'Dune Drifter');             // {Swift}
  const plain = spawn(h, A, 'Lithoghul');                // normal
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[swift], [plain]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.deepEqual(h.state.battle!.damageSubs, ['Swift', 'normal'],
    'Swift and normal strike; NOTHING strikes in the Sluggish sub-step');
  let windows = 0;
  let guard = 20;
  while (h.state.battle?.step === 'damageWindow' && guard-- > 0) { windows++; throughDamageWindows(h); }
  assert.equal(windows, 1,
    'exactly ONE boundary — the empty Sluggish sub-step is not a step to stop for, and the '
    + 'last striking sub-step hands over to the after-combat window it already had');
  finishBattle(h);
});

/* ══ §4 — WHAT IS FIXED ONCE, STAYS FIXED ═══════════════════════════ */

test('R295 §4 damageSubs is fixed when the step opens: a Swift unit dying cannot unsplit the battle', () => {
  const h = new Harness(29705);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const swift = spawn(h, A, 'Dune Drifter');             // {Swift} 2/1
  const plain = spawn(h, A, 'Lithoghul');                // 4/4 normal
  // the BLOCKER is Swift too, so the whole exchange happens in the Swift
  // sub-step and both 2/1s trade there. Recomputed after that sub-step, the
  // schedule would read ['normal'] — nothing Swift is left alive — and the
  // boundary would vanish along with the answerable death triggers.
  const killer = spawn(h, D, 'Dune Drifter');            // {Swift} 2/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[swift], [plain]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [killer] } });
  pass(h); pass(h);
  assert.ok(!ent(h, swift) && !ent(h, killer),
    'both Swift units traded in the Swift sub-step — nothing Swift is on the board any more');
  assert.deepEqual(h.state.battle!.damageSubs, ['Swift', 'normal'],
    'and the schedule is unchanged — it was read once, before any damage');
  assert.equal(h.state.battle!.step, 'damageWindow',
    'so the boundary is still offered, and the death trigger it queued is answerable there');
  throughDamageWindows(h);
  finishBattle(h);
});

/* ══ §5 — R157 §5: A {Swift}{Sluggish} COLUMN ═══════════════════════ */

test('R295 §5 a {Swift}{Sluggish} column strikes in two sub-steps, with a boundary between them', () => {
  const h = new Harness(29706);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const rw = spawn(h, A, 'Rime Wraith');                 // 2/1 {Swift}{Sluggish}
  toNextBattle(h, A);
  const life0 = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[rw]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.deepEqual(h.state.battle!.damageSubs, ['Swift', 'Sluggish'],
    'R157 §5: "both apply" — the column is scheduled in two sub-steps, and the empty normal '
    + 'one between them is not a step');
  assert.equal(h.state.battle!.step, 'damageWindow', 'so there is a boundary between them');
  assert.equal(h.state.battle!.pendingSub, 'normal',
    'the pump resumes into the normal sub-step, which has nothing in it and falls through');
  assert.equal(h.state.players[D]!.life, life0 - 2, 'the Swift half has struck; the Sluggish has not');
  throughDamageWindows(h);
  assert.equal(h.state.players[D]!.life, life0 - 4, 'and then it does — 2 + 2 across two steps');
  finishBattle(h);
});

/* ══ §6 — THE PUMP SURVIVES A SUSPENSION AT THE BOUNDARY ════════════ */

test('R295 §6 a decision raised INSIDE a boundary window still resumes the pump when it closes', () => {
  const h = new Harness(29707);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const adv = spawn(h, A, 'Adversary of the Deep');
  const bripp = spawn(h, A, 'Bripp');
  toNextBattle(h, A);
  const life0 = h.state.players[D]!.life;
  h.do({ type: 'declareAttack', seat: A, columns: [[bripp], [adv]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  // drive the window the long way round — decisions and passes interleaved, the
  // shape a real client produces — and check the battle still completes
  let guard = 60;
  while (h.state.phase === 'battle' && h.state.battle?.step !== 'afterWindow' && guard-- > 0) {
    if (h.state.decision) {
      const d = h.state.decision;
      h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : 0 });
      continue;
    }
    if (h.state.priority === null) break;
    pass(h);
  }
  assert.ok(guard > 0, 'the pump terminated');
  assert.equal(h.state.battle!.step, 'afterWindow', 'and reached the after-combat window');
  assert.equal(h.state.battle!.damageStep, null, 'with the damage step finished');
  assert.equal(h.state.battle!.pendingSub, null, 'and nothing left parked');
  assert.ok(h.state.players[D]!.life < life0 - 6, 'both sub-steps really dealt their damage');
  void new E(h.state);
  finishBattle(h);
});
