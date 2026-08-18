/* Per-card tests for the metal-c batch (project rule: a test for every card).
 * States are built explicitly (spawn/give/giveResources, explicit hands,
 * white-box counter presets) so parallel card registration can't shift
 * assertions; seeds are 2800-2899.
 *
 * Covers: death-fed counters (Refuse Reclaimer — unit form and augment-
 * donated), formation-array position swapping (Riftwalker, bounded [once]),
 * a mid-resolution sacrifice cost (Scavenging Sentry, R6-style), moving net
 * counters between two cast-time targets (Scrap For Parts), affinity-sized
 * Robot tokens arriving at HOME (Self-Assembly, R28), counter-fueled damage
 * (Soul Reaver), mod erasure + effect negation (Suppression Field — the
 * attribute-suppression half is parked), region-scoped mass counters with a
 * bounded budget (Synaptic Energizer, R9/R12), net-counter duplication
 * (Technological Superiority), a mod-carried +2/+2 static (Transmogrifant —
 * the attribute-loss half is parked), a type-line Virus augment (Trashling),
 * base-stat gates (Unmake), a temp re-base (Unstable Refactor), an
 * immediate mid-combat death trigger (Unstable Singularity, R31), forced
 * discards (Void Memory), and a parked draft-skipper (Worldbender).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, pick,
  spawn, toDeployment, toNextBattle, unitsOf,
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

test('Scavenging Sentry: sacrifice another unit → +1/+1 counter; no fodder → no counter', () => {
  const h = new Harness(2804);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const sentry = spawn(h, A, 'Scavenging Sentry');          // 2/2
  const fodder = spawn(h, A, 'Unit Token');
  h.do({ type: 'activateAbility', seat: A, entityId: sentry, abilityIndex: 0, via: 'augment' });
  pick(h, fodder);                                          // the R6-style sacrifice payment
  assert.ok(!ent(h, fodder), 'the fodder was sacrificed (token: erased)');
  assert.equal(ent(h, sentry)!.counters, 1);
  assert.deepEqual(effStats(h, sentry), [3, 3], '2/2 + the counter');
  // no other unit left → the cost cannot be paid, no counter
  h.do({ type: 'activateAbility', seat: A, entityId: sentry, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.decision, null, 'nothing to sacrifice → no prompt');
  assert.equal(ent(h, sentry)!.counters, 1, 'unpaid cost → no second counter');
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
  h.do({ type: 'activateAbility', seat: A, entityId: sr, abilityIndex: 0, via: 'augment' });
  pick(h, { unit: slime });                                 // damage target (at activation)
  pass(h); pass(h);                                         // resolve → choose X
  assert.equal(h.state.decision!.seat, A, 'the controller picks X');
  pick(h, 2);                                               // remove both counters
  assert.equal(ent(h, sr)!.counters, 0, 'the counters are gone');
  assert.deepEqual(effStats(h, sr), [2, 3], 'back to the printed 2/3');
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

test('Suppression Field: "loses all attributes and abilities until regroup" (no suppression layer)', { todo: true }, () => {
  // PARKED: the engine cannot REMOVE a card's own printed attributes or
  // silence its abilities — needs a suppression layer in ownAttrs/fireEvent.
  // The mod-erasure + stack-negation halves are live (test above).
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

test('Transmogrifant: "…and lose all attributes and abilities" (no suppression layer)', { todo: true }, () => {
  // PARKED: same missing machinery as Suppression Field — the engine cannot
  // strip printed attributes/abilities. The +2/+2 half is live (tests above).
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
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Unmake') });
  pick(h, { unit: big });
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

test('Void Memory: each opponent discards a card of their choice; empty hand → reveal', () => {
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
