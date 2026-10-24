/* CR 608.9, 608.9b — NOTHING TRIGGERED BY COMBAT DAMAGE RESOLVES DURING THE DAMAGE STEP.
 *
 * The owner, 2026-08-30, answering the round-32 sheet's Q1 (which was itself
 * the open half of playtest report #119, room YFUE, and ticket CT-112):
 *
 *   > "The ruling is correct, but *where* the trigger goes is wrong. If there
 *   > are no units in combat with sluggish or [swift], there will be no
 *   > triggers during the damage step. Instead, all triggers that are caused
 *   > by damage get moved to 'After combat', along with anything that triggers
 *   > then. Here is an official RAQ ruling:
 *   >
 *   >   Q: What is the order of effects on the stack, which result from Combat
 *   >   Damage ("Whenever I am dealt damage", "When I die" etc.) and resulting
 *   >   from "After Combat"?
 *   >
 *   >   A: Since all those effects are put on the same stack at the same time,
 *   >   each player can decide the order of their effects. Initiative (IT)
 *   >   player put all of his effects on the stack first, then non-Initiative
 *   >   (NIT) player puts his. This may lead to stack like this:
 *   >     After Combat ...
 *   >     When I die ...
 *   >     After Combat ...
 *   >     Whenever I am dealt damage ...
 *   >     After combat ...
 *   >
 *   > Both the initiative player and non-initiative player have their triggers
 *   > put onto the stack during after combat and can respond to them there."
 *
 * ── WHAT THE ENGINE DID BEFORE ───────────────────────────────────────
 * `pumpCombatDamage` walked Swift → normal → Sluggish → 'after' and carried
 * the line `if (this.s.triggerQueue.length) { this.settle(); continue; }`,
 * which drained the queue BETWEEN sub-steps with `battle.damageStep` still
 * set. `processTriggerQueue` computed `battleMode` as
 * `phase === 'battle' && !battle.damageStep`, so every one of those triggers
 * found `battleMode` false, took the `'resolve'` branch of
 * `stackPendingTrigger`, and was built, aimed and resolved to completion:
 * never on the stack, never respondable, never taxed. That was the sub-step ruling's "no
 * priority window between damage sub-steps" read one step too far — that ruling (now CR 608.3e) is
 * about FORMATION, and it still stands (§4 below).
 *
 * ── WHAT IT DOES NOW ─────────────────────────────────────────────────
 * The drain line is gone; `settle()` carries a CR 608.9b hold that refuses to
 * touch the queue while `battle.damageStep` is set (the one choke point — a
 * CR 608.6a election answer and a CR 111.10g pay answer both reach settle() mid-damage
 * through `doDecide`, so guarding the pump alone would have left back doors
 * open); and the 'after' branch nulls `damageStep`, fires `afterCombat`, opens
 * the `afterWindow` priority and only THEN settles — so the whole held batch
 * and the after-combat triggers are ordered, stacked and answered together.
 *
 * ── THE CONDITION IS BACK (CR 608.3a) ──────────────────────────────────────
 * Read the owner's first sentence again: *"**If there are no units in combat
 * with sluggish or [swift]**, there will be no triggers during the damage
 * step."* The first implementation took the sentence after it and dropped that clause, so
 * the hold became unconditional — and playtest report #165 (room KAWJ,
 * 2026-09-15) is what that cost. A {Sluggish} Adversary of the Deep, whose
 * whole reason for being Sluggish is to grow off the earlier damage before it
 * strikes, struck as a printed 2/2 with its own trigger still held.
 *
 * So the rule has two halves, and this file now tests both:
 *
 *   UNSPLIT (no Swift, no Sluggish anywhere in the exchange) — CR 608.9b exactly as
 *     written below. One batch, drained after combat, respondable there. §1's
 *     first test, §2 and §3 are all this shape.
 *   SPLIT (Swift or Sluggish is in it) — each sub-step is a real step. What it
 *     fired goes on the stack and resolves, with priority, at the boundary
 *     BEFORE the next sub-step deals damage. `battle.step` is 'damageWindow'
 *     there, and `throughDamageWindows` in test/util.ts drives past it.
 *
 * What did NOT change is the thing CR 608.9 is really about: nothing resolves
 * INSIDE a sub-step, ever. The sweep below is re-aimed at exactly that.
 *
 * ⚠ THE TRIGGER STILL *FIRES* DURING THE DAMAGE STEP, and every test below
 * that reads the log depends on the difference. `fireEvent` announces
 * 'triggered' at QUEUE time, inside the sub-step, and that is correct: the
 * condition is evaluated at event time (CR 109.3a) and the trigger really did
 * trigger. What waits is the BUILD (targets) and the RESOLUTION. So the shape
 * of a combat trigger in the log is now 'triggered' before 'afterCombat' and
 * 'stackPushed' after it, and §1 asserts exactly that pair.
 *
 * Seeds 23900-23999.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import '../src/index.ts';
import { allCardNames, getCard, isTriggered } from '../src/cards/dsl.ts';
import type { EngineEvent, Seat } from '../src/types.ts';
import { ent, give, giveResources, pass, spawn, throughDamageWindows, toDeployment, toNextBattle } from './util.ts';

/* ── shared driving ──────────────────────────────────────────────────── */

/** answer everything the board raises, ordering decisions with the identity
 * order. Only ever called AFTER the assertion a test is about. */
function settleDecisions(h: Harness): void {
  let guard = 40;
  while (h.state.decision && guard-- > 0) {
    const d = h.state.decision;
    h.do({ type: 'decide', seat: d.seat, choice: d.pickOrder ? d.options.map((_, i) => i) : 0 });
  }
  assert.ok(guard > 0, 'settleDecisions did not terminate');
}

/** CR D1.2g: answer only the elective-split questions the damage step itself
 * raises, with the one-click default. Anything else is left standing — a
 * trigger asking its controller something is the thing under test. */
function answerElections(h: Harness): void {
  let guard = 30;
  while (h.state.decision?.kind === 'assignDamage' && guard-- > 0) {
    h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  }
}

/** the index of the one 'combatDamage' event and the one 'afterCombat' event
 * in a slice, asserted present. The window between them is the damage step. */
function damageWindow(evs: EngineEvent[]): [number, number] {
  const cd = evs.findIndex(e => e.type === 'combatDamage');
  const ac = evs.findIndex(e => e.type === 'afterCombat');
  assert.ok(cd >= 0, 'the slice contains the combat-damage announcement');
  assert.ok(ac > cd, 'and the after-combat step that closes it');
  return [cd, ac];
}

/** every event type that means "an item was built, stacked or resolved" —
 * the three things CR 608.9 says cannot happen inside the damage window.
 * 'stackFlash' is the simultaneity signal (CR D6.7) for a trigger that resolved unanswerably,
 * which is precisely the shape the old engine produced here. */
const RESOLUTION_EVENTS = new Set(['stackPushed', 'resolved', 'stackFlash']);

/* ══ §1 — THE DAMAGE STEP RESOLVES NOTHING ═══════════════════════════ */

/** Lithoghul: "[Augment] Whenever I am dealt damage, I deal that much damage
 * to you." A 4/4 with a self damage trigger that needs no target and cannot
 * fizzle — the cleanest damage trigger in the pool to read a log against. */
test('CR 608.9: a combat-damage trigger is announced INSIDE the damage step and pushed to the stack AFTER it', () => {
  const h = new Harness(23901);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lith = spawn(h, A, 'Lithoghul');
  const geo = spawn(h, D, 'Geode');            // 1/1: hits back for 1, dies to 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lith]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [geo] }, send: [], spellTokens: [] });
  const mark = h.events.length;
  pass(h); pass(h);                            // out of the block window → damage
  answerElections(h);

  const evs = h.events.slice(mark);
  const [cd, ac] = damageWindow(evs);
  const win = evs.slice(cd, ac);

  // the trigger really did trigger, in the sub-step, at event time (CR 109.3a)
  assert.ok(win.some(e => e.type === 'triggered' && /Lithoghul/.test(e.msg)),
    'the damage sub-step ANNOUNCED the trigger — CR 109.3a, the condition is read at event time');
  // …and nothing was built, stacked or resolved while the damage step ran
  assert.deepEqual(win.filter(e => RESOLUTION_EVENTS.has(e.type)).map(e => e.type), [],
    'CR 608.3a: nothing resolves between combat damage and after combat');

  settleDecisions(h);
  const after = h.events.slice(mark).slice(ac);
  assert.ok(after.some(e => e.type === 'stackPushed' && /Lithoghul/.test(e.msg)),
    'and the same trigger reaches the stack in the after-combat step');
  assert.ok(h.state.stack.some(it => /Lithoghul/.test(it.label)),
    'where it is a real stack item, not a resolved memory');
});

/** THE ROOM YFUE MOMENT, which is what report #119 was about: the seat that
 * did NOT control the trigger is holding priority with a live window and a
 * castable card. Under the old engine `legalActions` for that seat was the
 * empty array and priority was null — test/229 pins that historical state. */
test('CR 608.9b: the other seat holds priority over a combat-damage trigger and can actually respond to it', () => {
  const h = new Harness(23902);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lith = spawn(h, A, 'Lithoghul');
  // a blocker with NO printed text, so the batch holds exactly one trigger and
  // the seat priority lands on is unambiguous
  const drift = spawn(h, D, 'Dune Drifter');
  giveResources(h, D, 'fire', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lith]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [drift] }, send: [], spellTokens: [] });
  pass(h); pass(h);
  settleDecisions(h);

  // CR 608.9c: the blocker is {Swift}, so this exchange is SPLIT and the window the
  // trigger is answerable in is the sub-step boundary rather than after combat
  // — which is the better half of the owner's ruling, not a weaker one. The
  // Drifter's Swift damage fired Lithoghul's "whenever I am dealt damage"; D
  // gets to answer it BEFORE Lithoghul strikes back in the normal sub-step.
  // §1's first test is the unsplit control for the same claim.
  assert.equal(h.state.battle!.step, 'damageWindow',
    'the sub-step boundary window is open (CR 608.3b — {Swift} blocker splits the damage step)');
  assert.equal(h.state.stack.length, 1, 'with the Swift sub-step batch standing on the stack');
  const mine = h.state.stack.find(it => /Lithoghul/.test(it.label))!;
  assert.ok(mine, 'including the attacker damage trigger');
  assert.equal(mine.kind, 'triggered');
  assert.equal(mine.controller, A, 'which the ATTACKER controls');
  assert.equal(h.state.passes, 0, 'the push reset the pass count');
  // CR 703.3a (report #234): the boundary window opens with the initiative
  // player, who controls the trigger; D answers once A passes
  assert.equal(h.state.priority, A, 'the boundary window opens with the initiative player');
  pass(h);
  assert.equal(h.state.priority, D, 'and then priority sits with the seat that does not control it');
  const idx = give(h, D, 'Flame of History');
  assert.ok(legalActions(h.state, D).some(
    a => a.type === 'playCard' && (a as { handIndex: number }).handIndex === idx),
  'so D may cast in response — this is what the owner meant by "can respond to them there"');
  // …and the battle really does carry on into the normal sub-step afterwards,
  // rather than the window being a dead end that ate the rest of combat
  throughDamageWindows(h);
  settleDecisions(h);
  assert.equal(h.state.battle!.step, 'afterWindow',
    'once the window closes the remaining sub-steps run and combat reaches its after-step');
});

/** THE DERIVED SWEEP. DERIVE, NEVER ENUMERATE (docs/13-assessment.md §7.2):
 * the subject set is every UNIT in the live registry printing a triggered
 * ability that listens on an event combat damage can cause, computed from the
 * card data at test time. A hand-typed list would stop covering new cards the
 * day the pool grows, and the whole claim of CR 608.9 is that it is universal.
 *
 * `zone` triggers (CR 400.5, "if I am in your bin") are excluded because they are
 * dispatched off a detached stand-in and cannot be put on the board as a
 * blocker; they take the same queue and are covered by §1 and §2 through it.
 *
 * A card whose SETUP raises a decision (Unrelenting Horror: "When I spawn,
 * discard a card" — the `spawn` helper throws Suspended) is recorded as
 * unbuildable rather than skipped by name, and the ratio is asserted: an
 * exclusion list that grew silently would empty this guard out.
 */
const DAMAGE_CAUSED = new Set(['damage', 'combatFaceDamage', 'lifeLost', 'died', 'trashed']);

function damageTriggerUnits(): string[] {
  return allCardNames().filter(name => {
    const c = getCard(name) as {
      kind?: string; abilities?: unknown[]; augmentText?: unknown[];
    };
    if (c.kind !== 'unit') return false;
    return [...(c.abilities ?? []), ...(c.augmentText ?? [])].some(a => {
      const ab = a as { type?: string; events?: string[]; zone?: string };
      return isTriggered(ab as never) && !ab.zone
        && (ab.events ?? []).some(e => DAMAGE_CAUSED.has(e));
    });
  });
}

test('THE SWEEP: over every unit in the pool that triggers on combat damage, nothing resolves inside a SUB-STEP', () => {
  const names = damageTriggerUnits();
  assert.ok(names.length >= 50,
    `the derived subject set collapsed (${names.length}) — a check with an empty subject set `
    + 'passes forever and looks identical to one that works');

  const violations: string[] = [];
  const unbuildable: string[] = [];
  const swept: string[] = [];
  const firedInDamageStep: string[] = [];
  /** CR 608.9c: subjects whose own {Swift}/{Sluggish} split the damage step, so the
   *  span below is cut at the first boundary window instead of at afterCombat */
  const split: string[] = [];
  let seed = 23910;

  for (const name of names) {
    let evs: EngineEvent[];
    try {
      const h = new Harness(seed++);
      toDeployment(h);
      const A = h.state.initiative, D = (1 - A) as Seat;
      const atk = spawn(h, A, 'Lithoghul');    // 4 power: enough to kill or hurt anything small
      const def = spawn(h, D, name);
      toNextBattle(h, A);
      h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
      pass(h); pass(h);
      h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [def] }, send: [], spellTokens: [] });
      const mark = h.events.length;
      // drive to the after-combat window. A block-window trigger (Legion of
      // the Depths, Aberrant Populace) puts an item on the stack BEFORE the
      // damage step and legitimately resolves there, which is why the window
      // below is cut at the 'combatDamage' event rather than at `mark`.
      let guard = 60;
      while (h.state.battle && h.state.battle.step !== 'afterWindow' && guard-- > 0) {
        if (h.state.decision) {
          if (h.state.decision.kind !== 'assignDamage') break;
          answerElections(h);
          continue;
        }
        if (h.state.priority === null) break;
        pass(h);
      }
      evs = h.events.slice(mark);
    } catch { unbuildable.push(name); continue; }

    const cd = evs.findIndex(e => e.type === 'combatDamage');
    const ac = evs.findIndex(e => e.type === 'afterCombat');
    if (cd < 0 || ac < cd) { unbuildable.push(name); continue; }
    swept.push(name);
    /**
     * CR 608.3b — THE SPAN IS THE SUB-STEP, NOT THE WHOLE DAMAGE STEP.
     *
     * This used to slice cd..ac and demand nothing resolve anywhere in it,
     * which was the after-combat hold read without its own first clause. A subject printing
     * {Swift} or {Sluggish} splits the step, and at the boundary its triggers
     * are SUPPOSED to stack and resolve — that is report #165's fix. Cutting
     * at the first 'damageWindow' announcement keeps the guard pointed at the
     * claim that did not change: nothing resolves inside a sub-step.
     */
    const dw = evs.findIndex(e => e.type === 'phase' && e.data?.['step'] === 'damageWindow');
    const splitHere = dw > cd && dw < ac;
    if (splitHere) split.push(name);
    const win = evs.slice(cd, splitHere ? dw : ac);
    if (win.some(e => RESOLUTION_EVENTS.has(e.type))) violations.push(name);
    if (win.some(e => e.type === 'triggered')) firedInDamageStep.push(name);
  }

  assert.deepEqual(violations, [],
    'CR 608.9: every one of these resolved something inside a damage SUB-STEP');
  // CR 608.3b POSITIVE CONTROL. Without this the sweep would pass on an engine that
  // never split a damage step at all — which is the engine report #165 was
  // filed against, and it would look identical here.
  assert.ok(split.length > 0,
    'no subject in the whole pool split the damage step — CR 608.3b is not being exercised, and '
    + 'the cut above is then a no-op that can hide anything');
  assert.ok(swept.length >= names.length * 0.9,
    `only ${swept.length} of ${names.length} subjects reached a damage step — the sweep is `
    + `hollowing out (unbuildable: ${unbuildable.join(', ')})`);
  // THE POSITIVE CONTROL. Without this the sweep above would pass on a board
  // where no trigger ever fired, which is the same shape as a broken fixture.
  assert.ok(firedInDamageStep.length >= 50,
    `only ${firedInDamageStep.length} subjects actually announced a trigger inside the damage `
    + 'step — the window this guard is about is nearly empty and it is proving nothing');
  console.log(`    CR 608.9 SWEEP: ${swept.length}/${names.length} units driven through a real `
    + `damage step, ${firedInDamageStep.length} of them firing inside it, 0 resolving `
    + `(${split.length} split the step and were measured to their first boundary: `
    + `${split.join(', ')}).`);
});

/* ══ §2 — ONE BATCH, AND THE RAQ ORDER ═══════════════════════════════ */

/** The RAQ names "When I die" explicitly, so the death half needs its own
 * pin: Ignis Sprite dies to combat damage and its "when I spawn or die"
 * trigger must wait with everything else, even though `checkDeaths()` still
 * runs between sub-steps and the body is off the board immediately.
 *
 * ⚠ THE BLOCKER USED TO BE A {Swift} Dune Drifter, and under CR 608.9c that made
 * this an accidental test of the OTHER half of the rule: a Swift blocker
 * splits the damage step, so the death trigger resolves at the boundary
 * rather than after combat and the RAQ claim went untested. The blocker is
 * the {Evasive} 2/2 Curio Drifter now — same kill, no speed attribute, one
 * sub-step — and the split shape has its own test directly below. */
test('CR 608.9b: a combat DEATH trigger waits with the rest — when I die is on the RAQ list by name', () => {
  const h = new Harness(23903);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const sprite = spawn(h, A, 'Ignis Sprite');       // 1/1, "when I spawn or die, create a Fireball"
  const drift = spawn(h, D, 'Curio Drifter');       // 2/2, no speed attribute — ONE sub-step
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sprite]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [drift] }, send: [], spellTokens: [] });
  const mark = h.events.length;
  pass(h); pass(h);
  answerElections(h);

  const evs = h.events.slice(mark);
  const [cd, ac] = damageWindow(evs);
  const win = evs.slice(cd, ac);
  assert.ok(win.some(e => e.type === 'died' && /Ignis Sprite/.test(e.msg)),
    'the Sprite died inside the damage step — CR 608.7b, deaths are immediate');
  assert.ok(win.some(e => e.type === 'triggered' && /Ignis Sprite/.test(e.msg)),
    'and its death trigger was announced there');
  assert.deepEqual(win.filter(e => RESOLUTION_EVENTS.has(e.type)).map(e => e.type), [],
    'but nothing resolved: the death trigger waited for after combat');
  assert.ok(h.state.stack.some(it => /Ignis Sprite/.test(it.label)),
    'and it is on the after-combat stack');
});

/** CR 608.3b, the split sibling of the test above: the SAME death, in a step that
 * {Swift} has made into two steps. The trigger still resolves nothing inside
 * its own sub-step — but it does not wait for after combat either. It stacks
 * and is answerable at the boundary, before the normal sub-step strikes.
 *
 * This is the shape playtest report #165 was filed about, reduced to its
 * smallest form: what a sub-step fires must land before the next sub-step
 * deals its damage, or a card built to grow first cannot. */
test('CR 608.9c: in a SPLIT damage step a death trigger resolves at the boundary, not after combat', () => {
  const h = new Harness(23913);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const sprite = spawn(h, A, 'Ignis Sprite');       // 1/1
  const drift = spawn(h, D, 'Dune Drifter');        // 2/1 {Swift} — kills it in the Swift sub-step
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sprite]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [drift] }, send: [], spellTokens: [] });
  const mark = h.events.length;
  pass(h); pass(h);
  answerElections(h);

  const evs = h.events.slice(mark);
  const cd = evs.findIndex(e => e.type === 'combatDamage');
  const dw = evs.findIndex(e => e.type === 'phase' && e.data?.['step'] === 'damageWindow');
  assert.ok(cd >= 0 && dw > cd, 'the step split and announced its boundary window');
  assert.ok(evs.findIndex(e => e.type === 'afterCombat') < 0,
    'and combat has NOT reached its after-step — this is mid-damage');
  assert.deepEqual(evs.slice(cd, dw).filter(e => RESOLUTION_EVENTS.has(e.type)).map(e => e.type), [],
    'CR 608.9 still holds inside the sub-step itself: nothing resolved there');
  assert.equal(h.state.battle!.step, 'damageWindow');
  assert.ok(h.state.stack.some(it => /Ignis Sprite/.test(it.label)),
    'CR 608.9c: the death trigger is on the stack AT THE BOUNDARY, where either seat can answer it');
  assert.equal(h.state.battle!.pendingSub, 'normal',
    'and the pump is parked, waiting to run the normal sub-step once the window closes');
});

/** THE RAQ's INTERLEAVING, which is the sharpest thing the ruling says: a
 * trigger caused by damage and a trigger that fires "After combat" are in the
 * SAME batch, so one seat orders them in ONE decision and may put either
 * first. The RAQ's example stack alternates the two kinds for exactly this
 * reason. Under the old engine the Geode death trigger had already resolved
 * before the afterCombat event was even emitted, so no such decision could
 * exist.
 *
 * ⚠ REGION MATTERS and cost this fixture two attempts: `afterCombat` is fired
 * with the battle's region and CostMod-style radiation is region-scoped (CR 601.1d),
 * so an after-combat trigger only joins the batch if its card stands in the
 * region the battle is in. The defender's own units do; the attacker's, coming
 * from its home region, do not. */
test('CR 608.9b THE RAQ BATCH: a damage-caused trigger and an after-combat trigger are ordered together, in one decision', () => {
  const h = new Harness(23904);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lith = spawn(h, A, 'Lithoghul');
  const geo = spawn(h, D, 'Geode');                 // dies to 4 → "create a Crystal"
  spawn(h, D, 'Wisp');                              // "After combat, sacrifice me."
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[lith]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [geo] }, send: [], spellTokens: [] });
  pass(h); pass(h);
  answerElections(h);

  const dec = h.state.decision;
  assert.ok(dec, 'the defender is asked to order its batch');
  assert.equal(dec!.kind, 'orderTriggers');
  assert.equal(dec!.seat, D);
  assert.ok(dec!.pickOrder, 'it is an ordering decision, not a pick-one');
  const labels = dec!.options.map(o => o.label);
  assert.ok(labels.some(l => /Geode/.test(l)),
    'the DEATH trigger caused by combat damage is one of the options');
  assert.ok(labels.some(l => /Wisp/.test(l) && /after combat/i.test(l)),
    'and so is the AFTER-COMBAT trigger — one batch, orderable against each other');
  assert.equal(labels.length, 2, 'and nothing else got in between them');
});

/** THE RAQ's STACK ORDER, verbatim: *"Initiative (IT) player put all of his
 * effects on the stack first, then non-Initiative (NIT) player puts his."*
 * The owner adds that he does not remember which way round it is, so the RAQ
 * text is the authority and this is the guard that pins it. The engine already
 * did this for battle triggers under CR 706.5 (NIT enters last, thus resolves
 * first); holding combat-damage triggers to after combat only widened which triggers get here. IT at the BOTTOM of the
 * stack, NIT on TOP.
 *
 * One trigger per seat, deliberately: with two the per-seat ordering decision
 * would sit in front of the assertion and blur what is being measured. */
test('CR 609.3c RAQ STACK ORDER: the initiative seat effects go on the stack FIRST and sit at the bottom', () => {
  const h = new Harness(23905);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const lith = spawn(h, A, 'Lithoghul');            // IT: "whenever I am dealt damage"
  const geo = spawn(h, D, 'Geode');                 // NIT: "when I die"
  toNextBattle(h, A);
  assert.equal(h.state.initiative, A, 'A really is the initiative seat');
  h.do({ type: 'declareAttack', seat: A, columns: [[lith]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [geo] }, send: [], spellTokens: [] });
  pass(h); pass(h);
  answerElections(h);
  settleDecisions(h);

  assert.equal(h.state.stack.length, 2, 'one trigger per seat, both on the stack');
  assert.equal(h.state.stack[0]!.controller, A,
    'RAQ: the INITIATIVE player puts his effects on the stack first, so his is the bottom item');
  assert.equal(h.state.stack[1]!.controller, D,
    'and the non-initiative player puts his on top — CR 703.4, so NIT resolves first');
  assert.ok(/Lithoghul/.test(h.state.stack[0]!.label));
  assert.ok(/Geode/.test(h.state.stack[1]!.label));
});

/* ══ §3 — WHAT DID NOT MOVE ══════════════════════════════════════════ */

/** THE SUB-STEP RULING (now CR 608.3e) IS NOT OVERRULED, only narrowed to what it was always about. Formation
 * changes — deaths, promotion, column membership — still recalculate between
 * sub-steps with nobody getting priority. The measurement: a {Swift} blocker
 * kills the attacker in the Swift sub-step, so the attacker deals NOTHING in
 * the normal one. If deaths had moved to after combat with the triggers, the
 * Drifter would have taken 1 and died. */
test('CR 608.3e STILL STANDS: a unit killed in the Swift sub-step deals no normal damage, and only the trigger queue waits', () => {
  const h = new Harness(23906);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const sprite = spawn(h, A, 'Ignis Sprite');       // 1/1, normal sub-step
  const drift = spawn(h, D, 'Dune Drifter');        // 2/1 {Swift}
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sprite]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [drift] }, send: [], spellTokens: [] });
  pass(h); pass(h);
  answerElections(h);

  assert.ok(!ent(h, sprite), 'the Sprite died in the Swift sub-step');
  // CR 608.3b: the split step opens a window after the Swift sub-step. The
  // Sprite is already gone at that window, before anything else happens.
  assert.equal(h.state.battle?.step, 'damageWindow', 'paused at the window after the Swift sub-step');
  // Pass the window so the NORMAL sub-step really runs, then read the result:
  // asserting at the window would hold whatever the normal sub-step does.
  throughDamageWindows(h);
  assert.equal(h.state.battle?.step, 'afterWindow', 'the normal sub-step has run and combat damage is over');
  assert.ok(ent(h, drift), 'and the Drifter survives');
  assert.equal(ent(h, drift)!.damage, 0,
    'having been dealt NOTHING in the normal sub-step — CR 608.3e, the death was immediate');
});

/** BITE 4: a decision raised MID-SUB-STEP must not lose the held batch.
 * Column 0 is {Swift} and kills a Geode; column 1 raises a CR 608.6a elective
 * split in the NORMAL sub-step, which suspends the pump. `doDecide` resumes
 * through `settle()`, and settle() is where the CR 608.9b hold lives — so this is
 * the exact path that would have drained the batch had the hold been put on
 * the pump instead. */
test('CR 608.9: a sub-step suspended by a CR 608.6a election resumes with the held batch intact', () => {
  const h = new Harness(23907);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const drift = spawn(h, A, 'Dune Drifter');        // {Swift} 2/1
  const lith = spawn(h, A, 'Lithoghul');            // 4/4, normal
  const g0 = spawn(h, D, 'Geode');
  const g1 = spawn(h, D, 'Geode');
  const g2 = spawn(h, D, 'Geode');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[drift], [lith]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [g0], 1: [g1, g2] }, send: [], spellTokens: [] });
  pass(h); pass(h);

  /**
   * ⚠ SPLIT-STEP WINDOWS (CR 608.9c) MOVED THE FIRST HALF OF THIS TEST, and the move is the point.
   *
   * It used to read: the Swift sub-step is done, the NORMAL one is already
   * asking its election, and the Swift death trigger is sitting HELD in the
   * queue behind it. That was the old unconditional hold. The exchange is split
   * ({Swift} Dune Drifter), so the normal sub-step no longer runs until the
   * boundary window has closed — the Swift death trigger stacks and resolves
   * FIRST, and only then is anybody asked how to split the normal damage.
   *
   * What the test is actually for survives intact and is asserted below: a
   * CR 608.6a suspension in the middle of a sub-step must not leak a resolution
   * INTO that sub-step. `doDecide` reaches settle() with the pump half-run,
   * which is one of the three back doors the CR 608.9b hold in settle() was built
   * to close, and it is still closed.
   */
  assert.equal(h.state.battle!.step, 'damageWindow',
    'CR 608.3b: the Swift sub-step has struck and the boundary window is open');
  // ⚠ read through a fresh expression, not `h.state.decision` directly: an
  // `assert.equal(x, null)` narrows x to `never` for the rest of the scope,
  // and the assertions after the window would stop typechecking.
  assert.equal(h.state.decision === null, true, 'the normal sub-step has not asked anything yet');
  assert.equal(h.state.stack.length, 1, 'the Swift sub-step death trigger is on the stack');
  assert.equal(h.state.triggerQueue.length, 0, 'and nothing is left held in the queue');

  throughDamageWindows(h);

  // NOW the normal sub-step runs, and this is the suspension under test
  assert.equal(h.state.decision?.kind, 'assignDamage', 'the normal sub-step raised an election');
  assert.equal(h.state.battle!.damageStep, 'normal', 'and the pump is mid-damage-step');
  const subMark = h.events.length;
  h.do({ type: 'decide', seat: h.state.decision!.seat, choice: 0 });
  settleDecisions(h);

  const sub = h.events.slice(subMark);
  const ac = sub.findIndex(e => e.type === 'afterCombat');
  assert.ok(ac >= 0, 'combat reached its after-step');
  assert.deepEqual(sub.slice(0, ac).filter(e => RESOLUTION_EVENTS.has(e.type)).map(e => e.type), [],
    'the suspend and resume did not leak a resolution into the sub-step it suspended');
  assert.equal(h.state.stack.length, 3,
    'the normal sub-step\'s own batch — two Geode deaths and the Lithoghul damage trigger — '
    + 'reached the stack together after combat (the Swift death already resolved at the boundary)');
});

/* ══ §4 — THE TRIGGER TAX (CR 111.10g), WIDENED ══════════════════════════════════════════════ */

/** Crevice Lurker: "[Augment] Abilities cost [one] more to activate or trigger
 * during battle." Its CostMod delta was always keyed on `phase === 'battle'`
 * and never on the damage step, but `processTriggerQueue` only ran
 * `gateTaxedTrigger` for `battleMode` triggers — so a combat-damage trigger
 * slipped past the tax entirely. That exemption was an artefact of where the
 * queue drained, not a reading of any card: combat damage IS during battle.
 * Under the after-combat hold (CR 608.9b) these triggers arrive with `damageStep` already null and are
 * taxed like every other battle trigger.
 *
 * The control is the same board without the Lurker, because a pay gate that
 * fires on every board would prove nothing about the Lurker.
 *
 * ⚠ CT-146 — THE TWO BOARDS ARE NOT OTHERWISE IDENTICAL, and this note used to
 * say they were. The Lurker's clause is UNQUALIFIED ("Abilities cost [one]
 * more"), so it taxes the ATTACKER's Lithoghul trigger as well as the
 * defender's Geode one — and the attacker is funded with nothing, so that
 * trigger is not taxed but PREVENTED OUTRIGHT, silently, in the `taxed` build
 * only. The assertions below never mentioned it, which is exactly the shape
 * CT-146 is about: a fixture that uses a Crevice Lurker as scenery and passes
 * without saying what the scenery did. Measured across all 8 test files that
 * spawn one (19 spawn sites): THREE triggers are ever prevented, and the other
 * two are in `16-earth-a`'s own prevention and decline tests, which exist to
 * assert them. This was the only silent one. It is asserted now rather than
 * funded away — funding the attacker would put ITS pay question in front of
 * the Geode one and change what `taxed.state.decision` even is. */
test('CR 111.10g WIDENED BY CR 608.9d: a combat-damage trigger is taxed by Crevice Lurker, and is not without one', () => {
  const build = (seed: number, lurker: boolean): Harness => {
    const h = new Harness(seed);
    toDeployment(h);
    const A = h.state.initiative, D = (1 - A) as Seat;
    const lith = spawn(h, A, 'Lithoghul');
    const geo = spawn(h, D, 'Geode');
    if (lurker) spawn(h, D, 'Crevice Lurker');
    giveResources(h, D, 'earth', 3);          // D can afford the tax, so it is ASKED
    toNextBattle(h, A);
    h.do({ type: 'declareAttack', seat: A, columns: [[lith]] });
    pass(h); pass(h);
    h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [geo] }, send: [], spellTokens: [] });
    pass(h); pass(h);
    answerElections(h);
    return h;
  };

  const taxed = build(23908, true);
  // CT-146: what the scenery did, said out loud. The attacker holds no mana,
  // so its own taxed trigger is prevented rather than offered.
  const prevented = (h: Harness, frag: string): boolean =>
    h.events.some(e => e.data?.['prevented'] === true && e.msg.includes(frag));
  assert.equal(prevented(taxed, 'Lithoghul'), true,
    'the Lurker taxes the ATTACKER too, and the attacker cannot pay — so that trigger is '
    + 'prevented outright. Asserted, not assumed: a silently vanished trigger is how a '
    + 'fixture ends up passing on a board nobody described');
  const dec = taxed.state.decision;
  assert.ok(dec, 'the Geode death trigger is stopped at the CR 111.10g pay gate');
  assert.equal(dec!.kind, 'payOrDecline');
  assert.equal(dec!.seat, taxed.state.initiative === 0 ? 1 : 0,
    'and it is the defender — the seat whose trigger it is — being asked');
  assert.match(dec!.prompt, /Crevice Lurker taxes the trigger/);
  assert.match(dec!.prompt, /Geode/,
    'a trigger caused by COMBAT DAMAGE, which could never reach this gate before the after-combat move (CR 608.9b)');

  const free = build(23909, false);
  assert.equal(prevented(free, 'Lithoghul'), false,
    'and with no Lurker on the board nothing is prevented — which is what makes the line '
    + 'above an effect of the CARD rather than of the fixture');
  assert.equal(free.state.decision?.kind, undefined,
    'the same board with no Lurker asks nothing — the tax is the card, not the board');
  assert.ok(free.state.stack.some(it => /Geode/.test(it.label)),
    'and the trigger goes straight to the stack');
});
