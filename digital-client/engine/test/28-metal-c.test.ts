/* Per-card tests for the metal-c batch (project rule: a test for every card).
 * States are built explicitly (spawn/give/giveResources, explicit hands,
 * white-box counter presets) so parallel card registration can't shift
 * assertions; seeds are 2800-2899.
 *
 * Covers: death-fed counters (Refuse Reclaimer — unit form and augment-
 * donated), formation-array position swapping (Riftwalker, bounded [once]),
 * a real sacrifice ACTIVATION cost (Scavenging Sentry, R49 sacrificeOther —
 * it used to be a mid-resolution pick), moving net
 * counters between two cast-time targets (Scrap For Parts), affinity-sized
 * Robot tokens arriving at HOME (Self-Assembly, R28), counter-fueled damage
 * (Soul Reaver), the R62 suppression layer + mod erasure + effect negation
 * (Suppression Field, all three clauses), region-scoped mass counters with a
 * bounded budget (Synaptic Energizer, R9/R12), net-counter duplication
 * (Technological Superiority), a +2/+2-and-silence static in both forms
 * (Transmogrifant, R62), a type-line Virus augment (Trashling),
 * base-stat gates (Unmake, R66), a layer-2 re-base (Unstable Refactor), an
 * immediate mid-combat death trigger (Unstable Singularity, R31), forced
 * discards (Void Memory), and a parked draft-skipper (Worldbender).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  effStats, ent, finishBattle, give, giveResources, notOffered, ownAttrs, pass, pick,
  spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

// ── Refuse Reclaimer ─────────────────────────────────────────────────────

test('Refuse Reclaimer: another unit dies → a +1/+1 counter on me (live when played)', () => {
  const h = new Harness(2801);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const rr = spawn(h, A, 'Refuse Reclaimer');               // 1/1
  const tok = spawn(h, A, 'Unit Token');
  {
    const e = new E(h.state);                               // another unit dies in my region
    e.destroy(ent(h, tok)!, 'dies');
    e.settle();                                             // outside battle: resolves at once
  }
  assert.equal(ent(h, rr)!.counters, 1, 'one death → one counter');
  assert.deepEqual(effStats(h, rr), [2, 2], '1/1 + the counter');
});

test('Refuse Reclaimer: the donated [Augment] text feeds the HOST counters', () => {
  const h = new Harness(2802);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  const victim = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 1);                          // Refuse Reclaimer: m/1
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Refuse Reclaimer'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'augment attached');
  {
    const e = new E(h.state);
    e.destroy(ent(h, victim)!, 'dies');
    e.settle();
  }
  assert.equal(ent(h, host)!.counters, 1, '"me" is the host when mod-carried');
  assert.deepEqual(effStats(h, host), [2, 2]);
});

/*
 * THE BRDM REPORT (playtest ledger #15, 2026-08-20): "Why didn't Refuse
 * Reclaimer get a counter from my Oracle dying?"
 *
 * Round 7 closed this as NOT A BUG on the strength of a commit message — the
 * trigger fired, the report was filed while it was still sitting on the stack
 * — and left no artefact behind, so the claim was not reproducible from the
 * repo. It also left a much better explanation untested: the death listener is
 * REGION-SCOPED. `E.fireEvent` filters the scan to `e.region === region`,
 * where the region comes off the death event, so a Reclaimer standing at home
 * genuinely does not see a unit die in the battle region it did not go to.
 * That reproduces the reported symptom exactly, and it is CORRECT — Caleb, in
 * rules-questions on 2025-03-09, answering "do these effects only trigger if
 * the unit is in the same region as the thing that is happening?":
 *
 *   "Everything in the game is region specific. So nothing will ever impact
 *    anything in another region. You should be able to completely ignore
 *    cards in other regions when resolving a battle.
 *    Units don't need to block to trigger (unless the card specifically says
 *    so). Just being in the region is enough."
 *
 * So the two tests below are the artefact round 7 never wrote. The first is
 * the "just being in the region is enough" half — the Reclaimer attacks and
 * feeds on a death beside it, without blocking or fighting anything. The
 * second is the half that answers the report: same board, Reclaimer left at
 * home, and it stays a 1/1.
 *
 * The first test at the top of this file already covers a death in a HOME
 * region outside battle; these two are about the region SPLIT, which is the
 * only shape that could have produced the report.
 */

test('Refuse Reclaimer: a death in the battle region it attacked into feeds it — no blocking required (R12)', () => {
  const h = new Harness(2811);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const rr = spawn(h, A, 'Refuse Reclaimer');               // 1/1
  const mate = spawn(h, A, 'Unit Token');
  const home = new E(h.state).homeRegion(A);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[rr], [mate]] });

  const region = h.state.battle!.region;
  assert.notEqual(region, home, 'the attack really did leave home — otherwise this proves nothing');
  assert.equal(ent(h, rr)!.region, region, 'the Reclaimer travelled with the attack');
  assert.equal(ent(h, mate)!.region, region, 'and so did the unit about to die');

  {
    const e = new E(h.state);                               // an ally dies beside it
    e.destroy(ent(h, mate)!, 'dies');
    e.settle();
  }
  assert.equal(h.state.stack.length, 1, 'in battle the death trigger goes on the stack, not off at once');
  pass(h); pass(h);                                         // resolve it
  assert.equal(ent(h, rr)!.counters, 1, 'the death in ITS region fed it');
  assert.deepEqual(effStats(h, rr), [2, 2], '1/1 + the counter');
  finishBattle(h);
});

test('Refuse Reclaimer: a death in a region it is not in leaves it cold (R12) — the BRDM report shape', () => {
  const h = new Harness(2812);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const rr = spawn(h, A, 'Refuse Reclaimer');               // stays HOME
  const atk = spawn(h, A, 'Unit Token');                    // goes to the battle
  const home = new E(h.state).homeRegion(A);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });

  const region = h.state.battle!.region;
  assert.equal(ent(h, rr)!.region, home, 'the Reclaimer stayed at home');
  assert.notEqual(region, home, 'and the battle is happening somewhere else');

  {
    const e = new E(h.state);
    e.destroy(ent(h, atk)!, 'dies');
    e.settle();
  }
  // Not "the trigger resolved and did nothing" — it is never even QUEUED. The
  // region filter in fireEvent means the Reclaimer is not among the listeners
  // scanned at all, which is why the owner saw nothing happen rather than
  // seeing a trigger sit on the stack.
  assert.equal(h.state.stack.length, 0, 'no trigger was queued for a death in another region');
  assert.equal(ent(h, rr)!.counters, 0, 'the Reclaimer never saw it');
  assert.deepEqual(effStats(h, rr), [1, 1], 'still a printed 1/1');
  finishBattle(h);
});

// ── Riftwalker ───────────────────────────────────────────────────────────

test('Riftwalker: [one] switches my position with a target ally in my formation; [once]', () => {
  const h = new Harness(2803);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const rift = spawn(h, A, 'Riftwalker');                   // 4/2, [Augment] text live
  const ally = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 2);                          // two activation attempts @ [one]
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[rift], [ally]] });
  h.do({ type: 'activateAbility', seat: A, entityId: rift, abilityIndex: 0, via: 'augment' });
  pick(h, { unit: ally });                                  // the target ally
  pass(h); pass(h);                                         // resolve the activation
  const b = h.state.battle!;
  assert.equal(b.columns[0]![0], ally, 'the ally took my column slot');
  assert.equal(b.columns[1]![0], rift, 'I took the ally\'s slot');
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: A, entityId: rift, abilityIndex: 0, via: 'augment' }),
    /already used/, '[once]: bounded to one activation per turn (R9)');
  finishBattle(h);
});

// ── Scavenging Sentry ────────────────────────────────────────────────────

test('Scavenging Sentry: sacrifice another unit → +1/+1 counter; no fodder → not offered', () => {
  // R49 UN-PARKED: the bracketed sacrifice is a real AbilityCost, paid in the
  // cast window, and it GATES the activation.
  const h = new Harness(2804);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const sentry = spawn(h, A, 'Scavenging Sentry');          // 2/2
  const fodder = spawn(h, A, 'Unit Token');
  h.do({ type: 'activateAbility', seat: A, entityId: sentry, abilityIndex: 0, via: 'augment' });
  notOffered(h, { unit: sentry }, '"another unit" — never the carrier');
  pick(h, { unit: fodder });                                // the activation cost
  assert.ok(!ent(h, fodder), 'the fodder was sacrificed (token: erased)');
  assert.equal(ent(h, sentry)!.counters, 1);
  assert.deepEqual(effStats(h, sentry), [3, 3], '2/2 + the counter');
  // no other unit left → the cost is unpayable, so the ability is not offered
  assert.ok(!h.legal(A).some(a => a.type === 'activateAbility' && a.entityId === sentry),
    'unpayable cost → not offered');
  assert.throws(() => h.do({ type: 'activateAbility', seat: A, entityId: sentry, abilityIndex: 0, via: 'augment' }),
    /cannot pay/, 'and apply() refuses it');
  assert.equal(ent(h, sentry)!.counters, 1, 'no second counter');
});

// ── Scrap For Parts ──────────────────────────────────────────────────────

test('Scrap For Parts: moves ALL counters from the first target onto the second', () => {
  const h = new Harness(2805);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const from = spawn(h, A, 'Unit Token');
  const to = spawn(h, A, 'Unit Token');
  h.state.entities[from]!.counters = 3;                     // white-box preset
  giveResources(h, A, 'metal', 2);                          // m/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[from], [to]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Scrap For Parts') });
  pick(h, { unit: from });                                  // first target (at cast, count: 2)
  pick(h, { unit: to });                                    // second target
  pass(h); pass(h);                                         // resolve
  assert.equal(ent(h, from)!.counters, 0, 'stripped bare');
  assert.equal(ent(h, to)!.counters, 3, 'all three moved over');
  assert.deepEqual(effStats(h, from), [1, 1]);
  assert.deepEqual(effStats(h, to), [4, 4]);
  finishBattle(h);
});

// ── Self-Assembly ────────────────────────────────────────────────────────

test('Self-Assembly: creates a Robot X at HOME, X = metal affinity at resolution', () => {
  const h = new Harness(2806);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  giveResources(h, A, 'metal', 3);                          // m/2 — pays 2, affinity stays 3 (R17)
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Self-Assembly') });
  const robot = unitsOf(h, A).find(u => u.card === 'Robot')!;
  assert.ok(robot, 'a Robot was created');
  assert.ok(robot.token, 'created = a token');
  assert.equal(robot.counters, 3, 'X = 3 metal affinity (expended resources count)');
  assert.deepEqual(effStats(h, robot.id), [3, 3], 'a 0/0 living on its counters');
  assert.equal(robot.region, h.q.homeRegion(A), 'created units arrive at HOME (R28)');
});

// ── Soul Reaver ──────────────────────────────────────────────────────────

test('Soul Reaver: [one] + remove X counters → X damage to target unit', () => {
  const h = new Harness(2807);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const sr = spawn(h, A, 'Soul Reaver');                    // 2/3
  h.state.entities[sr]!.counters = 2;                       // white-box preset
  const slime = spawn(h, D, 'Lurking Slimebeast');          // 8/3, trigger-free
  giveResources(h, A, 'metal', 1);                          // the [one]
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[sr]] });
  // R64: "Remove X +1/+1 counters from me" is before the colon — a COST, paid
  // as the ability is activated, so X is fixed before anyone can respond.
  h.do({ type: 'activateAbility', seat: A, entityId: sr, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.decision!.seat, A, 'the controller pays');
  pick(h, { counterFrom: sr }); pick(h, { counterFrom: sr });
  // the counters ran out, so the variable cost closes itself: X = 2
  pick(h, { unit: slime });                                 // then aim
  assert.equal(ent(h, sr)!.counters, 0, 'the counters are gone as it is activated');
  assert.deepEqual(effStats(h, sr), [2, 3], 'back to the printed 2/3');
  pass(h); pass(h);                                         // resolve
  assert.equal(ent(h, slime)!.damage, 2, 'X = 2 damage dealt');
  finishBattle(h);
});

// ── Suppression Field ────────────────────────────────────────────────────

test('Suppression Field: erases all of the target\'s mods (donated attrs vanish)', () => {
  const h = new Harness(2808);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const host = spawn(h, D, 'Unit Token');
  {
    const e = new E(h.state);                               // white-box: pre-modded host
    e.attachMod(ent(h, host)!, 'Trashling', D, 'augment');
    e.settle();
  }
  const modId = ent(h, host)!.mods[0]!;
  assert.ok(ownAttrs(h, host).has('Unaware'), 'the Trashling augment donates Unaware');
  giveResources(h, A, 'metal', 1);                          // m/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Suppression Field') });
  pick(h, { unit: host });
  pass(h); pass(h);                                         // resolve
  assert.equal(ent(h, host)!.mods.length, 0, 'mods gone');
  assert.ok(!ent(h, modId), 'the mod entity was ERASED');
  assert.ok(!h.state.players[D]!.bin.includes('Trashling'), 'erased, not binned');
  assert.ok(!ownAttrs(h, host).has('Unaware'), 'the donated attribute went with it');
  finishBattle(h);
});

test('Suppression Field: R62 — the target loses its printed attributes and its triggers', () => {
  const h = new Harness(2820);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  // a printed flier with a printed spawn/death trigger, so both layers are
  // observable on one card
  const sprite = spawn(h, D, 'Ephemeral Skywalker');        // 3/1 {Flying}
  assert.ok(ownAttrs(h, sprite).has('Flying'), 'printed Flying, before');
  giveResources(h, A, 'metal', 1);                          // m/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Suppression Field') });
  pick(h, { unit: sprite });
  pass(h); pass(h);                                         // resolve
  assert.equal(ownAttrs(h, sprite).size, 0, 'the attribute layer is off');
  assert.equal(ent(h, sprite)!.suppressed?.abilities, 'Suppression Field');
  const e = new E(h.state);
  assert.ok(e.abilitiesSuppressed(ent(h, sprite)!), 'and so is the ability layer');
  finishBattle(h);
  assert.ok(ownAttrs(h, sprite).has('Flying'), 'until REGROUP — it comes back');
  assert.equal(ent(h, sprite)!.suppressed, undefined, 'the flag is cleared');
});

test('Suppression Field: a silenced unit stops firing its triggered abilities', () => {
  const h = new Harness(2821);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  // "When I spawn or die, create a Fireball 1" — the death half is the half
  // a suppressed unit must not get
  const sprite = spawn(h, D, 'Ignis Sprite');               // 1/1
  const before = tokensOf(h, D).length;
  giveResources(h, A, 'metal', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Suppression Field') });
  pick(h, { unit: sprite });
  pass(h); pass(h);                                         // resolve
  const e = new E(h.state);
  e.destroy(ent(h, sprite)!, 'is deleted');
  e.settle();
  assert.equal(tokensOf(h, D).length, before, 'the death trigger never queued');
  finishBattle(h);
});

// ── Synaptic Energizer ───────────────────────────────────────────────────

test('Synaptic Energizer: after combat, a +1/+1 counter on each of your units (once/turn)', () => {
  const h = new Harness(2809);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const se = spawn(h, A, 'Synaptic Energizer');             // 0/1
  const tok = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[se], [tok]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                         // combat → afterCombat trigger
  pass(h); pass(h);                                         // resolve the trigger
  assert.equal(ent(h, se)!.counters, 1, 'the Energizer counts itself');
  assert.equal(ent(h, tok)!.counters, 1, 'each of your units in the battle (R12)');
  assert.deepEqual(effStats(h, se), [1, 2]);
  assert.deepEqual(effStats(h, tok), [2, 2]);
  finishBattle(h);                                          // round 2's afterCombat fires too…
  assert.equal(ent(h, se)!.counters, 1, '…but [Switch1] spent its budget (R9): still 1');
  assert.equal(ent(h, tok)!.counters, 1);
});

// ── Technological Superiority ────────────────────────────────────────────

test('Technological Superiority: duplicates each (net) counter on target unit', () => {
  const h = new Harness(2810);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const tok = spawn(h, A, 'Unit Token');
  h.state.entities[tok]!.counters = 2;                      // white-box preset
  giveResources(h, A, 'metal', 2);                          // m/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Technological Superiority') });
  pick(h, { unit: tok });
  pass(h); pass(h);                                         // resolve
  assert.equal(ent(h, tok)!.counters, 4, '2 counters duplicated → 4');
  assert.deepEqual(effStats(h, tok), [5, 5]);
  finishBattle(h);
  assert.equal(ent(h, tok)!.counters, 4, 'counters are permanent — survive regroup');
});

// ── Transmogrifant ───────────────────────────────────────────────────────

test('Transmogrifant: your OTHER units gain +2/+2 (in play, region-scoped)', () => {
  const h = new Harness(2811);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const tm = spawn(h, A, 'Transmogrifant');                 // 4/3
  const mine = spawn(h, A, 'Unit Token');
  const theirs = spawn(h, D, 'Unit Token');
  assert.deepEqual(effStats(h, mine), [3, 3], 'my other unit: 1/1 + 2/2');
  assert.deepEqual(effStats(h, tm), [4, 3], '"other": not itself');
  assert.deepEqual(effStats(h, theirs), [1, 1], 'only YOUR units');
});

test('Transmogrifant: the augment-donated static anchors on the host', () => {
  const h = new Harness(2812);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');
  const other = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 4);                          // mm/4
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Transmogrifant'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'augment attached');
  assert.deepEqual(effStats(h, other), [3, 3], 'the host\'s OTHER units get +2/+2');
  assert.deepEqual(effStats(h, host), [1, 1], 'the host itself ("other") does not');
});

test('Transmogrifant: R62 — the same static that gives +2/+2 takes the attributes away', () => {
  const h = new Harness(2822);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const sprite = spawn(h, A, 'Ephemeral Skywalker');        // 3/1 {Flying}
  const theirs = spawn(h, D, 'Ephemeral Skywalker');
  assert.ok(ownAttrs(h, sprite).has('Flying'), 'before');
  const tm = spawn(h, A, 'Transmogrifant');
  assert.equal(ownAttrs(h, sprite).size, 0, 'my other unit loses its attributes…');
  assert.deepEqual(effStats(h, sprite), [5, 3], '…and still gets the +2/+2');
  assert.ok(!new E(h.state).abilitiesSuppressed(ent(h, tm)!),
    'the Transmogrifant itself is untouched ("other")');
  assert.ok(ownAttrs(h, theirs).has('Flying'), 'their units are untouched ("your")');
  // continuous, not until-regroup: it ends the instant the projector does
  new E(h.state).destroy(ent(h, tm)!, 'is deleted');
  assert.ok(ownAttrs(h, sprite).has('Flying'), 'the projector left — everything is back');
});

test('Transmogrifant: a silenced unit radiates nothing of its own (R62)', () => {
  const h = new Harness(2823);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const other = spawn(h, A, 'Unit Token');
  // two Transmogrifants: each is the OTHER's "other unit", so each silences
  // the other. Static-vs-static suppression resolves in ONE pass (R62), so
  // both keep radiating and the token gets +2/+2 twice.
  spawn(h, A, 'Transmogrifant');
  spawn(h, A, 'Transmogrifant');
  assert.deepEqual(effStats(h, other), [5, 5], 'both statics still project');
});

// ── Trashling ────────────────────────────────────────────────────────────

test('Trashling: 2/2 Unaware body; type-line [Augment] donates Unaware (attrs only)', () => {
  const h = new Harness(2813);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const tr = spawn(h, A, 'Trashling');
  assert.deepEqual(effStats(h, tr), [2, 2]);
  assert.ok(ownAttrs(h, tr).has('Unaware'), 'played normally: has Unaware');
  const host = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 2);                          // m/2
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Trashling'), hostId: host });
  assert.ok(ownAttrs(h, host).has('Unaware'), 'type-line [Augment] donates Unaware');
  assert.deepEqual(effStats(h, host), [1, 1], 'attr-only donation: stats unchanged');
});

// ── Unmake ───────────────────────────────────────────────────────────────

test('Unmake: deletes only units with BASE power 2 or less (counters don\'t count)', () => {
  const h = new Harness(2814);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const small = spawn(h, D, 'Trashling');                   // base 2/2
  const big = spawn(h, D, 'Lurking Slimebeast');            // base 8/3
  h.state.entities[small]!.counters = 5;                    // 7/7 live — base still 2
  giveResources(h, A, 'metal', 4);                          // two casts @ m/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Unmake') });
  pick(h, { unit: small });
  pass(h); pass(h);                                         // resolve
  assert.ok(!ent(h, small), 'base power 2 → deleted despite 7/7 live stats');
  assert.ok(h.state.players[D]!.bin.includes('Trashling'), 'deleted → owner\'s bin');
  // R64: a base-8 unit is not a legal target at all — it is never offered
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Unmake') });
  notOffered(h, { unit: big }, 'base power 8 > 2');
  pick(h, { unit: atk });                                   // the only one left
  pass(h); pass(h);                                         // resolve
  assert.ok(ent(h, big), 'base power 8 > 2 → not deleted');
  finishBattle(h);
});

// ── Unstable Refactor ────────────────────────────────────────────────────

test('Unstable Refactor: target becomes base 5/0 until regroup (counters still apply)', () => {
  const h = new Harness(2815);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const mine = spawn(h, A, 'Unit Token');                   // 1/1
  h.state.entities[mine]!.counters = 2;                     // 3/3 live
  const slime = spawn(h, D, 'Lurking Slimebeast');          // 8/3
  giveResources(h, A, 'metal', 4);                          // two casts @ m/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Unstable Refactor') });
  pick(h, { unit: slime });
  pass(h); pass(h);                                         // resolve
  assert.ok(!ent(h, slime), 'a counterless 5/0 dies at the death check');
  assert.ok(h.state.players[D]!.bin.includes('Lurking Slimebeast'));
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Unstable Refactor') });
  pick(h, { unit: mine });
  pass(h); pass(h);                                         // resolve
  assert.deepEqual(effStats(h, mine), [7, 2], 'base 5/0 + its 2 counters');
  finishBattle(h);
  assert.deepEqual(effStats(h, mine), [3, 3], 'the re-base ends at regroup');
});

// ── Unstable Singularity ─────────────────────────────────────────────────

test('Unstable Singularity: dies in combat → immediately deletes target unit (R31)', () => {
  const h = new Harness(2816);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const us = spawn(h, A, 'Unstable Singularity');           // 0/1
  const blk = spawn(h, D, 'Unit Token');                    // 1/1 blocker kills it
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[us]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  pass(h); pass(h);            // combat: the blocker kills me → died trigger, mid-sub-step
  assert.ok(!ent(h, us), 'the Singularity died to the blocker');
  assert.equal(h.state.decision!.kind, 'targets', 'the trigger resolves immediately (R31)');
  pick(h, { unit: blk });                                   // delete target unit
  assert.ok(!ent(h, blk), 'the blocker is deleted');
  assert.ok(h.state.players[A]!.bin.includes('Unstable Singularity'), 'I went to the bin');
  assert.ok(h.state.players[D]!.bin.includes('Unit Token'), 'deleted (nontoken) → owner\'s bin');
  finishBattle(h);
});

// ── Void Memory ──────────────────────────────────────────────────────────

test('Void Memory: each opponent discards a card of their choice (a TRASH by them, R40); empty hand → reveal', () => {
  const h = new Harness(2817);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 4);                          // two casts @ m/2
  toNextBattle(h, A);
  h.state.players[D]!.hand = ['Trashling', 'Self-Assembly'];
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Void Memory') });
  pass(h); pass(h);                                         // resolve → discard decision
  assert.equal(h.state.decision!.seat, D, 'the DISCARDING player picks the card');
  pick(h, 1);                                               // discard Self-Assembly
  assert.deepEqual(h.state.players[D]!.hand, ['Trashling'], 'one card left');
  assert.ok(h.state.players[D]!.bin.includes('Self-Assembly'), 'discarded → bin');
  // R40: the discard is routed through E.discardFromHand, so it TRASHES —
  // attributed to D (whose bin it enters), never to Void Memory's caster
  const discard = h.events.filter(ev => ev.type === 'trashed')
    .find(ev => ev.data?.['card'] === 'Self-Assembly');
  assert.ok(discard, 'discarding from hand fires trashed (R40)');
  assert.equal(discard!.data!['seat'], D, 'trashed BY the discarding player, not the caster');
  assert.equal(discard!.data!['from'], 'hand');
  // an empty hand is revealed instead of discarding
  h.state.players[D]!.hand = [];
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Void Memory') });
  pass(h); pass(h);                                         // resolve — no decision this time
  assert.equal(h.state.decision, null, 'nothing to discard → no prompt');
  assert.ok(h.log.some(l => l.includes('hand is empty — revealed')), 'the hand is revealed');
  finishBattle(h);
});

// ── Worldbender ──────────────────────────────────────────────────────────

test('Worldbender: registers and plays as a 2/2 {Feeble} body (skip is parked)', () => {
  const h = new Harness(2818);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const wb = spawn(h, A, 'Worldbender');
  assert.deepEqual(effStats(h, wb), [2, 2]);
  assert.ok(ownAttrs(h, wb).has('Feeble'));
});

test('Worldbender: "Skip your draft step. When you do, draw a card." (no skip machinery)', { todo: true }, () => {
  // PARKED: the engine has draft state (state.draftDone, mode 'draft') but no
  // way to SKIP a draft step, and no constructed-format flag for the life
  // clause. Needs draft-skip machinery in startDraftStep/passPacks.
});
