/* Per-card tests for the metal-a batch (project rule: a test for every card).
 * States are built explicitly (spawn/give/giveResources, explicit counters) so
 * parallel card registration can't shift assertions; seeds are 2600-2699.
 *
 * Covers: base-setting statics in play AND virus-donated (Aberrant
 * Statweaver — layer 2, R66; see test 59 for the layer itself), the adjacent-ally trigger mimic (Ancient One, ⚠ triggered
 * abilities only), token copying (Arcane Echo), token duplication with the
 * loop guard (Automaton of Abundance), pay-to-erase death feeding (Biomass
 * Devourer, R31 immediate combat triggers), base-stat exchange until regroup
 * (Body Swap), erase-and-become (Borrower of Forms, ⚠ stats/counters only),
 * counters on spawn/mod + despawn cleanup (Celestial Fluxmorph), X-at-
 * resolution activation (Celestial Shifter), stack sweeps (Containment
 * Protocol), the Robot-swap half of Cosmic Conspirator, compound-cost board
 * wipes (Deformant), counter-fueled damage (Discharge), the R97 haste-step play
 * grant (Dispatch Courier), token theft + recast (Download, R8), combat
 * hand disruption (Eldritch Dreamtender) and mod-stacking counters
 * (Evolutionary Experiment).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { legalActions } from '../src/apply.ts';
import type { Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, handIdx, notOffered, pass, pick,
  spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';

/** Run raw engine calls against the harness state, absorbing a suspension
 * (a decision produced mid-settle). E may REPLACE its state object on a
 * mid-part rollback, so h.state is re-pointed afterwards. */
function withE(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state);
  try {
    fn(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
}

// ── Aberrant Statweaver ──────────────────────────────────────────────────

test('Aberrant Statweaver: "your units are base 3/3" — in play and virus-donated', () => {
  const h = new Harness(2601);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const sw = spawn(h, A, 'Aberrant Statweaver');
  const tok = spawn(h, A, 'Unit Token');                    // 1/1 base
  const whale = spawn(h, A, 'Good Whale');                  // 7/5 base
  const dTok = spawn(h, D, 'Unit Token');
  assert.deepEqual(effStats(h, sw), [3, 3], 'its own base is already 3/3');
  assert.deepEqual(effStats(h, tok), [3, 3], 'a 1/1 becomes base 3/3');
  assert.deepEqual(effStats(h, whale), [3, 3], 'a 7/5 becomes base 3/3 too (not a buff)');
  assert.deepEqual(effStats(h, dTok), [1, 1], 'enemy units are unaffected');
  withE(h, e => e.addCounters(e.entity(tok)!, 1));
  assert.deepEqual(effStats(h, tok), [4, 4], 'counters apply on top of the set base');

  // virus donation: the mod-carried static anchors on the host mid-battle
  giveResources(h, A, 'metal', 3);                          // mm/3
  give(h, A, 'Aberrant Statweaver');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  assert.deepEqual(effStats(h, whale), [7, 5], 'in the battle region, away from the in-play copy');
  h.do({ type: 'augment', seat: A, from: 'hand', index: h.state.players[A]!.hand.indexOf('Aberrant Statweaver'), hostId: whale });
  pass(h); pass(h);                                         // resolve the virus
  assert.equal(ent(h, whale)!.mods.length, 1, 'virus augment attached in battle');
  assert.deepEqual(effStats(h, whale), [3, 3], 'the donated static sets the host base 3/3');
  finishBattle(h);
});

// ── Ancient One ──────────────────────────────────────────────────────────

test('Ancient One: has the triggered abilities of adjacent allies (in formation)', () => {
  const h = new Harness(2602);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const kraken = spawn(h, A, 'Minor Kraken');               // "when I attack, recall target unit (def ≤ 5)"
  const ancient = spawn(h, A, 'Ancient One');
  const d1 = spawn(h, D, 'Unit Token');
  const d2 = spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[kraken, ancient]] });
  // two triggers for A: the kraken's own + the Ancient One's copy of it
  assert.equal(h.state.decision!.kind, 'orderTriggers', 'both attack triggers queued');
  assert.ok(h.state.decision!.options.some(o => String(o.label).includes('Ancient One (as Minor Kraken)')),
    'the copy is attributed to the Ancient One');
  h.do({ type: 'decide', seat: A, choice: [0, 1] });
  pick(h, { unit: d2 });                                    // targets, one per trigger
  pick(h, { unit: d1 });
  pass(h); pass(h);                                         // resolve trigger 1
  pass(h); pass(h);                                         // resolve trigger 2
  assert.ok(!ent(h, d1) && !ent(h, d2), 'both enemy units recalled — one per trigger');
  assert.equal(h.state.players[D]!.hand.filter(c => c === 'Unit Token').length, 2, 'to their owner\'s hand');
  finishBattle(h);
});

test('Ancient One: activated abilities and statics of neighbours are not copied', { todo: true }, () => {
  // PARKED half: apply.ts surfaces activated abilities only from a unit's own
  // lists and statics only from a card's own def — neighbours' activated
  // abilities/statics cannot be projected from card code. Triggered abilities
  // ARE mimicked (test above).
});

// ── Arcane Echo ──────────────────────────────────────────────────────────

test('Arcane Echo: creates a copy of a chosen token (unit copy arrives home, R28)', () => {
  const h = new Harness(2603);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 2);                          // m/2
  toNextBattle(h, A);
  let robot = 0;
  withE(h, e => { robot = e.spawnUnit(D, 'Robot', e.homeRegion(D), { token: true, counters: 2 }).id; });
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // R64: "target token" is chosen AT CAST, before anyone may respond
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Arcane Echo') });
  assert.equal(h.state.decision!.seat, A, 'the target is asked for as it is cast');
  pick(h, { unit: robot });
  pass(h); pass(h);                                         // resolve
  const copies = unitsOf(h, A).filter(u => u.card === 'Robot');
  assert.equal(copies.length, 1, 'a Robot copy was created for the caster');
  assert.ok(copies[0]!.token, 'the copy is a token');
  assert.equal(copies[0]!.counters, 2, 'with the same X (counters)');
  assert.equal(copies[0]!.region, new E(h.state).homeRegion(A), 'unit copies arrive in the controller\'s home region (R28)');
  assert.ok(ent(h, robot), 'the original is untouched');
  assert.ok(h.state.players[A]!.bin.includes('Arcane Echo'), 'the spell resolved → bin');
  finishBattle(h);
});

// ── Automaton of Abundance ───────────────────────────────────────────────

test('Automaton of Abundance: your unit tokens are duplicated; nontokens are not', () => {
  const h = new Harness(2604);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Automaton of Abundance');
  withE(h, e => { e.spawnUnit(A, 'Robot', e.homeRegion(A), { token: true, counters: 2 }); });
  const robots = unitsOf(h, A).filter(u => u.card === 'Robot');
  assert.equal(robots.length, 2, 'the created Robot was duplicated (and the copy did not re-trigger)');
  assert.ok(robots.every(r => r.token && r.counters === 2), 'the copy mirrors the original');
  spawn(h, A, 'Unit Token');                                // NONtoken unit (no token flag)
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Unit Token').length, 1, 'nontoken spawns are not duplicated');
});

test('Automaton of Abundance: "an additional copy of each UNIQUE token" batch semantics', { todo: true }, () => {
  // APPROXIMATION: duplication is per token spawn ('spawned' fires once per
  // token) — a batch of N identical tokens yields N extra copies instead of
  // one. Needs replacement-effect machinery to see a creation as one batch.
});

// ── Biomass Devourer ─────────────────────────────────────────────────────

test('Biomass Devourer: pay [two] to erase a dead nontoken unit and grow', () => {
  const h = new Harness(2605);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const dev = spawn(h, A, 'Biomass Devourer');              // 3/2
  const front = spawn(h, A, 'Unit Token');                  // nontoken 1/1
  const blk = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'metal', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[front, dev]] });
  pass(h); pass(h);                                         // → blocks
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  pass(h); pass(h);                                         // combat: both 1/1s die → two triggers (R31)
  // R34: the two triggers are IDENTICAL (same card/ability/label) — no
  // ordering decision; they enqueue in event order (A's own token's death first)
  assert.equal(h.state.decision!.kind, 'payOrDecline');
  pick(h, 1);                                               // pay 2 → erase it from A's bin
  // the second trigger (the blocker's death) auto-declined: no mana left
  assert.equal(ent(h, dev)!.counters, 2, 'two +1/+1 counters');
  assert.deepEqual(effStats(h, dev), [5, 4]);
  assert.ok(!h.state.players[A]!.bin.includes('Unit Token'), 'the erased card left the bin');
  assert.ok(h.state.players[D]!.bin.includes('Unit Token'), 'no mana for the second death — their card stays binned');
  assert.equal(h.state.players[A]!.resources.filter(r => r.state === 'open').length, 0, 'the [two] was paid');
  finishBattle(h);
});

// ── Body Swap ────────────────────────────────────────────────────────────

test('Body Swap: exchanges the base stats of two target units until regroup', () => {
  const h = new Harness(2606);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const tok = spawn(h, A, 'Unit Token');                    // 1/1
  const whale = spawn(h, D, 'Good Whale');                  // 7/5
  giveResources(h, A, 'metal', 2);                          // m/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Body Swap') });
  pick(h, { unit: tok });                                   // two targets, collected at cast
  pick(h, { unit: whale });
  pass(h); pass(h);                                         // resolve
  assert.deepEqual(effStats(h, tok), [7, 5], 'the 1/1 wears the whale\'s base');
  assert.deepEqual(effStats(h, whale), [1, 1], 'and vice versa');
  finishBattle(h);
  assert.deepEqual(effStats(h, tok), [1, 1], 'the exchange ends at regroup');
  assert.deepEqual(effStats(h, whale), [7, 5]);
});

// ── Borrower of Forms ────────────────────────────────────────────────────

test('Borrower of Forms: erases the target and takes its stats and counters', () => {
  const h = new Harness(2607);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');                  // 7/5
  withE(h, e => e.addCounters(e.entity(whale)!, 2));        // → 9/7
  giveResources(h, A, 'metal', 7);                          // mmm/7
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Borrower of Forms') });
  pick(h, { unit: whale });
  pass(h); pass(h);                                         // resolve: erase + spawn, self-trigger → stack
  pass(h); pass(h);                                         // resolve the become-a-copy trigger
  assert.ok(!ent(h, whale), 'the target was erased');
  assert.ok(!h.state.players[D]!.bin.includes('Good Whale'), 'erased, not binned');
  const bof = unitsOf(h, A).find(u => u.card === 'Borrower of Forms')!;
  assert.ok(bof, 'the spell unit spawned');
  assert.deepEqual(effStats(h, bof.id), [9, 7], 'base 7/5 + the 2 copied counters');
  finishBattle(h);
  assert.deepEqual(effStats(h, bof.id), [9, 7], '"become" is permanent — survives regroup');
});

test('Borrower of Forms: card text, attributes and mods are not copied', { todo: true }, () => {
  // APPROXIMATION: the engine has no transform machinery — the copy is base
  // stats + counters + temp changes relayed into the spawned Borrower. The
  // erased unit's card text, attrs and mods die with it.
});

// ── Celestial Fluxmorph ──────────────────────────────────────────────────

test('Celestial Fluxmorph: counters on spawn and on being modded; all removed at despawn', () => {
  const h = new Harness(2608);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const t1 = spawn(h, A, 'Unit Token');
  const t2 = spawn(h, A, 'Unit Token');
  const fm = spawn(h, A, 'Celestial Fluxmorph');            // spawn trigger: +1 to each of your units
  assert.deepEqual(effStats(h, t1), [2, 2]);
  assert.deepEqual(effStats(h, fm), [2, 2], 'itself included');
  // "or become modded": Dispatch Courier serves as the mod (its R97 grant is
  // a play permission, so it adds no stats to the host)
  giveResources(h, A, 'metal', 2);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Dispatch Courier'), hostId: fm });
  assert.deepEqual(effStats(h, t1), [3, 3], 'modding the Fluxmorph pays everyone again');
  assert.equal(ent(h, fm)!.counters, 2);
  withE(h, e => e.destroy(e.entity(fm)!, 'dies'));          // despawn: the [Augment] text, live on itself
  assert.equal(ent(h, t1)!.counters, 0, 'all counters removed from your units');
  assert.deepEqual(effStats(h, t1), [1, 1]);
  assert.deepEqual(effStats(h, t2), [1, 1]);
  assert.ok(!h.state.players[A]!.bin.includes('Celestial Fluxmorph'), 'it died modded → Unstable-erased');
});

// ── Celestial Shifter ────────────────────────────────────────────────────

test('Celestial Shifter: [x] makes it base X/X until regroup (X paid at resolution)', () => {
  const h = new Harness(2609);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const sh = spawn(h, A, 'Celestial Shifter');              // 2/2
  giveResources(h, A, 'metal', 5);
  h.do({ type: 'activateAbility', seat: A, entityId: sh, abilityIndex: 0, via: 'augment' });
  assert.equal(h.state.decision!.options.length, 6, 'X offered 0..open mana (5)');
  pick(h, 5);
  assert.deepEqual(effStats(h, sh), [5, 5], 'base 5/5');
  assert.equal(h.state.players[A]!.resources.filter(r => r.state === 'open').length, 0, 'X = 5 was paid');
  toNextBattle(h, A);
  finishBattle(h);
  assert.deepEqual(effStats(h, sh), [2, 2], 'the shift ends at regroup');
});

// ── Containment Protocol ─────────────────────────────────────────────────

test('Containment Protocol: negates all triggered and activated effects on the stack', () => {
  const h = new Harness(2610);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const kraken = spawn(h, A, 'Minor Kraken');
  const dTok = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'metal', 5);                          // mm/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[kraken]] });
  pick(h, { unit: dTok });                                  // the kraken trigger targets the token
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Containment Protocol') });
  pass(h); pass(h);                                         // resolve the Protocol first
  assert.ok(h.log.some(l => l.includes('is negated')), 'the triggered effect was negated');
  assert.equal(h.state.stack.length, 0, 'R68: the negated trigger left the stack at once');
  assert.ok(ent(h, dTok), 'the token was never recalled');
  finishBattle(h);
});

// ── Cosmic Conspirator ───────────────────────────────────────────────────

test('Cosmic Conspirator: a created Robot may become a Poison/Crystal/Fireball of the same X', () => {
  const h = new Harness(2611);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Cosmic Conspirator');
  withE(h, e => { e.spawnUnit(A, 'Robot', e.homeRegion(A), { token: true, counters: 3 }); });
  assert.equal(h.state.decision!.seat, A, 'the swap is offered');
  assert.equal(h.state.decision!.options.length, 4, 'keep / Poison / Crystal / Fireball');
  pick(h, 'Fireball');
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Robot').length, 0, 'the Robot was never created');
  const fb = tokensOf(h, A).find(t => t.card === 'Fireball')!;
  assert.ok(fb, 'a Fireball exists instead');
  assert.equal(fb.x, 3, 'with the same X value');
});

test('Cosmic Conspirator: swapping FROM Poison/Crystal/Fireball creations', { todo: true }, () => {
  // PARKED half: E.createSpellToken fires no dispatchable event (no fireEvent
  // on 'tokenCreated'), so spell-token creations cannot be intercepted from
  // card code. Only the Robot ('spawned') direction is implemented.
});

// ── Deformant ────────────────────────────────────────────────────────────

test('Deformant: sacrifice me + an ally, delete all units costing our counter total', () => {
  const h = new Harness(2612);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const b1 = spawn(h, A, 'Bripp');                          // mana 3
  const b2 = spawn(h, A, 'Bripp');
  const def = spawn(h, D, 'Deformant');
  const ally = spawn(h, D, 'Unit Token');
  withE(h, e => { e.addCounters(e.entity(def)!, 1); e.addCounters(e.entity(ally)!, 2); });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[b1], [b2]] });
  pass(h);                                                  // A passes → D may act
  h.do({ type: 'activateAbility', seat: D, entityId: def, abilityIndex: 0 });
  pass(h); pass(h);                                         // resolve the activation
  assert.equal(h.state.decision!.kind, 'payOrDecline');
  pick(h, ally);                                            // sacrifice the ally (total counters: 1 + 2 = 3)
  assert.ok(!ent(h, def) && !ent(h, ally), 'both sacrificed');
  assert.deepEqual(h.state.players[D]!.bin.sort(), ['Deformant', 'Unit Token']);
  assert.ok(!ent(h, b1) && !ent(h, b2), 'all cost-3 units in the region deleted');
  assert.equal(h.state.players[A]!.bin.filter(c => c === 'Bripp').length, 2, 'deleted → bin');
  finishBattle(h);
});

test('R77: Deformant is not offered with no other ally to sacrifice', () => {
  const h = new Harness(2620);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const def = spawn(h, A, 'Deformant');                     // its only unit
  assert.ok(!legalActions(h.state, A).some(a =>
    a.type === 'activateAbility' && a.entityId === def),
    'it used to activate, say "no other ally", and do nothing');
  spawn(h, A, 'Unit Token');
  assert.ok(legalActions(h.state, A).some(a =>
    a.type === 'activateAbility' && a.entityId === def), 'with an ally it is offered');
});

test('Deformant: "sacrifice me AND another ally" as one COMPOUND activation cost '
  + '(PARKED: AbilityCost has no compound shape)', { todo: true }, () => {
  // `AbilityCost` can express `sacrificeSelf: true` OR `sacrificeOther: n`,
  // never both as a single indivisible payment, so Deformant pays at
  // RESOLUTION: the ally is picked mid-resolution and both are destroyed there.
  // What is missing is a cost shape that takes several sacrifices as ONE
  // payment — offered, chosen and charged in the cast window like every other
  // activation cost (R49/R57) — so that a Deformant whose ally is removed in
  // response never half-pays. R77 gated the OFFER; the payment window is what
  // is still parked.
});

// ── Discharge ────────────────────────────────────────────────────────────

test('Discharge: remove X +1/+1 counters from allies, deal X to target unit', () => {
  const h = new Harness(2613);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const a1 = spawn(h, A, 'Unit Token');
  const a2 = spawn(h, A, 'Unit Token');
  withE(h, e => { e.addCounters(e.entity(a1)!, 2); e.addCounters(e.entity(a2)!, 2); });
  const kraken = spawn(h, D, 'Minor Kraken');               // 5/3
  giveResources(h, A, 'metal', 1);                          // m/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1], [a2]] });
  // R64: the bracketed cost is paid AT CAST — X is fixed and the counters are
  // gone before the spell is ever on the stack for anyone to answer.
  // The VARIABLE cost comes first (R64): X sizes the spell, so it is settled
  // with the mana X, before targets are asked for.
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Discharge') });
  pick(h, { counterFrom: a1 }); pick(h, { counterFrom: a1 }); pick(h, { counterFrom: a2 });
  pick(h, { doneCost: true });                              // X = 3
  pick(h, { unit: kraken });
  assert.equal(ent(h, a1)!.counters, 0, 'the counters are spent as the spell is cast…');
  assert.equal(h.state.stack.length, 1, '…and only then does it reach the stack');
  assert.equal(h.state.stack[0]!.parts[0]!.costPaid!.x, 3, 'X = 3, fixed at cast');
  pass(h); pass(h);                                         // resolve
  assert.ok(!ent(h, kraken), '3 damage kills the 5/3');
  assert.ok(h.state.players[D]!.bin.includes('Minor Kraken'));
  assert.equal(ent(h, a1)!.counters, 0, 'two counters paid');
  assert.equal(ent(h, a2)!.counters, 1, 'one counter paid');
  assert.deepEqual(effStats(h, a2), [2, 2]);
  finishBattle(h);
});

// ── Dispatch Courier ─────────────────────────────────────────────────────

test('Dispatch Courier: plays as a 2/1 and attaches as an augment', () => {
  const h = new Harness(2614);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const dc = spawn(h, A, 'Dispatch Courier');
  assert.deepEqual(effStats(h, dc), [2, 1]);
  const host = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 2);                          // mm/2
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Dispatch Courier'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'attached crash-free');
  assert.deepEqual(effStats(h, host), [1, 1], 'it donates a permission, not stats');
});

test('Dispatch Courier: "play a unit during the mana step as if it had [Haste]"', () => {
  // R97, report #74 (WEHH): "Dispatch Courier didn't give me the option to
  // play a card with haste". All three gates in one run — the step OPENS
  // (canHaste), the play is OFFERED (legalActions) and it is ACCEPTED
  // (playAtTiming), for a card whose printed timing is deploy.
  const h = new Harness(2624);
  const A: Seat = 0;
  spawn(h, A, 'Dispatch Courier');
  giveResources(h, A, 'metal', 4);
  const idx = give(h, A, 'Dispatch Courier');                // mm/2 deploy unit
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone, 'gate 1: the haste step OPENS for a grant-only hand');
  const offered = h.legal(A).some(a => a.type === 'playCard' && a.handIndex === idx);
  assert.ok(offered, 'gate 2: legalActions offers the deploy unit');
  h.do({ type: 'playCard', seat: A, handIndex: idx });       // gate 3
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Dispatch Courier').length, 2,
    'the unit is in play before the battle phase');
  assert.equal(h.state.hastePlaysUsed?.[A], 1, 'the printed "Each turn" budget was charged');
});

test('Dispatch Courier: the "Each turn" allowance is one, and one Courier grants one', () => {
  const h = new Harness(2625);
  const A: Seat = 0;
  spawn(h, A, 'Dispatch Courier');
  giveResources(h, A, 'metal', 8);
  // ⚠ both plays are VANILLA units on purpose: playing a second Courier would
  // add a second grantor mid-step and buy its own next play.
  const first = give(h, A, 'Nebula Drifter');               // m/1 deploy unit
  give(h, A, 'Nebula Drifter');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  h.do({ type: 'playCard', seat: A, handIndex: first });
  const stillOffered = h.legal(A).some(a => a.type === 'playCard');
  assert.ok(!stillOffered, 'the allowance is spent — nothing more is offered');
  assert.throws(() => h.do({ type: 'playCard', seat: A, handIndex: handIdx(h, A, 'Nebula Drifter') }),
    /only haste cards during the haste step/, 'and the enforcement agrees with the offer');
});

test('Dispatch Courier: a {Battle} unit stays a battle card even with the grant', () => {
  // RAQ "[Solved] Dispatch Courier vs Battle Timing": "No, despite gaining
  // :haste: they can still only be played during :battle:."
  const h = new Harness(2626);
  const A: Seat = 0;
  spawn(h, A, 'Dispatch Courier');
  giveResources(h, A, 'metal', 4);
  const monke = give(h, A, 'Monke');                         // m/1 {Battle} unit
  const dc = give(h, A, 'Dispatch Courier');                 // deploy — opens the step
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone, 'the step is open (the deploy unit opened it)');
  assert.ok(!h.legal(A).some(a => a.type === 'playCard' && a.handIndex === monke),
    'the {Battle} unit is NOT offered');
  assert.throws(() => h.do({ type: 'playCard', seat: A, handIndex: monke }),
    /only haste cards during the haste step/, 'nor accepted');
  assert.ok(h.legal(A).some(a => a.type === 'playCard' && a.handIndex === dc),
    'the deploy unit still is');
});

test('Dispatch Courier: no Courier, no haste step — the grant is what opens it', () => {
  const h = new Harness(2627);
  const A: Seat = 0;
  giveResources(h, A, 'metal', 4);
  give(h, A, 'Dispatch Courier');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.equal(h.state.hasteDone, null, 'R18 skips the step outright with no grantor');
});

// ── Download ─────────────────────────────────────────────────────────────

test('Download: steals a chosen enemy token; a stolen Fireball recasts with new targets', () => {
  const h = new Harness(2615);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 2);                          // mm/1
  toNextBattle(h, A);
  let robot = 0, fb = 0;
  withE(h, e => {
    robot = e.spawnUnit(D, 'Robot', e.homeRegion(D), { token: true, counters: 2 }).id;
    fb = e.createSpellToken(D, 'Fireball', 3, e.homeRegion(D)).id;
  });
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // R64: "target token" is a CAST-TIME target — the playtest report was
  // "Download didn't have me target anything".
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Download') });
  assert.equal(h.state.decision!.options.length, 2, 'both enemy tokens offered — and only those');
  notOffered(h, { unit: atk }, 'your own attacker is not an enemy token');
  pick(h, { unit: fb });
  pass(h); pass(h);                                         // resolve
  assert.equal(ent(h, fb)!.controller, A, 'the Fireball swapped sides (R8)');
  assert.equal(ent(h, fb)!.owner, D, 'owner unchanged');
  // "you may choose new targets": the new controller casts it fresh
  h.do({ type: 'castSpellToken', seat: A, entityId: fb });
  pick(h, { unit: robot });
  pass(h); pass(h);                                         // Fireball 3 resolves
  assert.ok(!ent(h, robot), 'the stolen Fireball killed its old owner\'s Robot');
  finishBattle(h);
});

// ── Eldritch Dreamtender ─────────────────────────────────────────────────

test('Eldritch Dreamtender: connects → sacrifices itself to discard from that hand; both are TRASHES (R40)', () => {
  const h = new Harness(2616);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const dt = spawn(h, A, 'Eldritch Dreamtender');           // 1/1 {Evasive}
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dt]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  const dHand = h.state.players[D]!.hand.slice();
  pass(h); pass(h);                                         // combat: 1 to D → immediate trigger (R31)
  assert.equal(h.state.players[D]!.life, 29);
  assert.equal(h.state.decision!.seat, A, 'the attacker picks the discard');
  assert.equal(h.state.decision!.options.length, dHand.length, 'the whole hand is shown');
  pick(h, 0);
  // (the sacrifice commits with the choice: a suspension rolls back to the part boundary)
  assert.ok(!ent(h, dt), 'sacrificed itself');
  assert.ok(h.state.players[A]!.bin.includes('Eldritch Dreamtender'), 'sacrifice → bin');
  assert.equal(h.state.players[D]!.hand.length, dHand.length - 1, 'one card discarded');
  assert.ok(h.state.players[D]!.bin.includes(dHand[0]!), 'to its owner\'s bin');
  assert.ok(h.state.seenHand[A], 'the look is remembered client-side');
  // R40: the discard is routed through E.discardFromHand, so it TRASHES —
  // attributed to the hand's owner (the bin the card enters is theirs), NOT
  // to the Dreamtender's controller who chose the card.
  const trashes = h.events.filter(ev => ev.type === 'trashed');
  const discard = trashes.find(ev => ev.data?.['card'] === dHand[0]);
  assert.ok(discard, 'the discard fired a trashed event');
  assert.equal(discard!.data!['seat'], D, 'trashed BY the hand\'s owner, not by the attacker');
  assert.equal(discard!.data!['from'], 'hand');
  // and the self-sacrifice is a trash too, by the Dreamtender's own owner
  const sac = trashes.find(ev => ev.data?.['card'] === 'Eldritch Dreamtender');
  assert.ok(sac, 'sacrificing is trashing (R40)');
  assert.equal(sac!.data!['seat'], A);
  assert.equal(sac!.data!['from'], 'play');
  finishBattle(h);
});

test('Eldritch Dreamtender: the sacrifice is paid on the way to the stack, '
  + 'not at resolution', () => {
  // The report: "Technically, Eldritch Dreamtender needs to be sacrificed for
  // its ability to go on the stack, but it's still visually in play while
  // resolving its trigger." It used to be a `g.destroy(self, …)` inside
  // effect.run — at resolution, after a whole priority window with the unit
  // still on the board.
  //
  // R73 (Bena, 2026-08-22) makes it a real cast cost:
  // `{ kind: 'sacrificeUnits', from: 'self', n: 1 }`. R64/R67 already settle
  // bracketed costs in the cast window for triggered items too, so the payment
  // now lands BEFORE the trigger is a thing anyone can answer.
  const h = new Harness(2618);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const dt = spawn(h, A, 'Eldritch Dreamtender');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dt]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                         // combat damage → trigger
  // THE ASSERTION THE PARK WAS WAITING FOR: the Dreamtender is already out of
  // play — and in its owner's bin — at the moment the trigger's own decision
  // is being asked for, i.e. before anything could have answered it.
  assert.ok(!ent(h, dt), 'sacrificed on the way to the stack, not at resolution');
  assert.ok(h.state.players[A]!.bin.includes('Eldritch Dreamtender'), 'and it is in the bin');
  assert.equal(h.state.decision!.seat, A, 'only now is the discard chosen');
  // the log order is the proof: the payment lands between the trigger being
  // QUEUED and the trigger RESOLVING — i.e. in the cast window, which is where
  // a bracketed cost belongs (R64/R67)
  const iPay = h.log.findIndex(l => l.includes('sacrifices Eldritch Dreamtender'));
  const iRes = h.log.findIndex(l => l.includes('Eldritch Dreamtender: sacrifice me')
    && l.startsWith('Resolving '));
  assert.ok(iPay !== -1, 'the sacrifice is logged as a cost payment');
  assert.ok(iRes !== -1 && iPay < iRes, 'and it is paid BEFORE the effect resolves');
  pick(h, 0);
  finishBattle(h);
});

test('Eldritch Dreamtender: the sacrifice is MANDATORY — no decline is ever offered (R73)', () => {
  // The other deliberate consequence of the ruling: the printed "sacrifice me.
  // If you do, …" loses its if-you-do. A choice-free cost on a spell/trigger's
  // OWN effect is charged outright — the decline option only exists for an
  // optional grafted rider. The dead-source half of R73 (an unpayable cost
  // skips the part) is pinned on the primitive in test/32-cast-costs.
  const h = new Harness(2619);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const dt = spawn(h, A, 'Eldritch Dreamtender');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dt]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  // the only decision raised is the discard — never "pay the cost?"
  assert.ok(!h.state.decision!.options.some(o => /Don't pay|Decline/.test(o.label)),
    'no way to keep the Dreamtender and still look at the hand');
  assert.ok(!ent(h, dt), 'it is already gone');
  pick(h, 0);
  finishBattle(h);
});

// ── Evolutionary Experiment ──────────────────────────────────────────────

test('Evolutionary Experiment: +2 counters when applied as a mod and on every later mod', () => {
  const h = new Harness(2617);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const host = spawn(h, A, 'Unit Token');                   // 1/1
  giveResources(h, A, 'metal', 4);                          // two m/2 augments
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Evolutionary Experiment'), hostId: host });
  assert.equal(ent(h, host)!.counters, 2, 'its own application counts as "applied as a mod"');
  assert.deepEqual(effStats(h, host), [3, 3]);
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Evolutionary Experiment'), hostId: host });
  // R34: both donated texts fire on the second mod, but they are IDENTICAL
  // (same card/ability/label) — no ordering decision, both resolve in order
  assert.equal(h.state.decision, null, 'identical triggers skip the ordering decision (R34)');
  assert.equal(ent(h, host)!.counters, 6, '2 + (2 from each of the two mods)');
  assert.deepEqual(effStats(h, host), [7, 7]);
});
