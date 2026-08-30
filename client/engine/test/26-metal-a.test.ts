/* Per-card tests for the metal-a batch (project rule: a test for every card).
 * States are built explicitly (spawn/give/giveResources, explicit counters) so
 * parallel card registration can't shift assertions; seeds are 2600-2699.
 *
 * Covers: base-setting statics in play AND virus-donated (Aberrant
 * Statweaver — layer 2, R66; see test 59 for the layer itself), the
 * adjacent-ally ability mimic (Ancient One — triggered via its bookkeeping
 * when(), statics and ACTIVATED via R118's `CardDef.projects`), token copying
 * (Arcane Echo), token duplication with the loop guard (Automaton of
 * Abundance), pay-to-erase death feeding (Biomass
 * Devourer, R31 immediate combat triggers), base-stat exchange until regroup
 * (Body Swap), erase-and-become (Borrower of Forms — a full R118 face: name,
 * stats, counters, attributes, text and activated abilities, permanently),
 * counters on spawn/mod + despawn cleanup (Celestial Fluxmorph), X-at-
 * resolution activation (Celestial Shifter), stack sweeps (Containment
 * Protocol), the Robot-swap half of Cosmic Conspirator, the `includeSelf`
 * cast-cost board wipe (Deformant), counter-fueled damage (Discharge), the R97 haste-step play
 * grant (Dispatch Courier), token theft + recast (Download, R8), combat
 * hand disruption (Eldritch Dreamtender) and mod-stacking counters
 * (Evolutionary Experiment).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { apply, legalActions } from '../src/apply.ts';
import type { Entity, EntityId, Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, handIdx, logFor, notOffered, pass, pick,
  resolveAfterCombat, spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
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

test('R118: Ancient One radiates an adjacent ally\'s STATIC, and stops when the column breaks', () => {
  const h = new Harness(2620);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const elder = spawn(h, A, 'Glowhaven Elder');             // "[Augment] your OTHER units gain +1/+1"
  const ancient = spawn(h, A, 'Ancient One');               // 1/1
  const bystander = spawn(h, A, 'Unit Token');              // 1/1, its own column
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  // adjacency is a formation concept, so the two have to be in ONE column —
  // and the bystander has to be in the battle region for a region-scoped
  // static to reach it at all, so it attacks in a column of its own
  h.do({ type: 'declareAttack', seat: A, columns: [[elder, ancient], [bystander]] });
  assert.deepEqual(effStats(h, bystander), [3, 3],
    'the Elder\'s own +1/+1, and the Ancient One\'s projected copy of it, both land');
  assert.deepEqual(effStats(h, ancient), [2, 2],
    'the projected static excludes its own anchor by id — only the Elder\'s copy reaches it');
  const e = new E(h.state);
  assert.equal(e.projections(ent(h, bystander)!).filter(p => p.from === 'Glowhaven Elder').length, 2,
    'two radiators, and the text box names the card the clause is printed on for both');
  // R118: the projection is CONTINUOUS, not a stamp — kill the neighbour
  // mid-combat and the borrowed static is gone in the same instant
  withE(h, g => g.destroy(g.entity(elder)!, 'dies'));
  assert.deepEqual(effStats(h, bystander), [1, 1],
    'the Elder left the column, so the Ancient One has nothing to borrow');
  finishBattle(h);
});

test('R118: Ancient One projects an adjacent ally\'s face WITHOUT taking its name or its body', () => {
  const h = new Harness(2621);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const whale = spawn(h, A, 'Good Whale');                  // 7/5
  const ancient = spawn(h, A, 'Ancient One');               // 1/1
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale, ancient]] });
  const e = new E(h.state);
  assert.equal(e.nameOf(ent(h, ancient)!), 'Ancient One',
    '"I have all ABILITIES of adjacent allies" is additive — facesOf()[0] is always the identity');
  assert.deepEqual(effStats(h, ancient), [1, 1], 'and it is still a 1/1');
  finishBattle(h);
});

/** every activateAbility `seat` may take on `id` right now, as its `via` */
function activations(h: Harness, seat: Seat, id: EntityId): unknown[] {
  return h.legal(seat)
    .filter(a => a.type === 'activateAbility' && a.entityId === id)
    .map(a => (a as { via?: unknown }).via ?? 'own');
}

test('R118: Ancient One offers an adjacent ally\'s ACTIVATED ability, and loses it when the column breaks', () => {
  const h = new Harness(2628);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const evoker = spawn(h, A, 'Omniwield Evoker');           // "[three]: put a +1/+1 counter on me"
  const ancient = spawn(h, A, 'Ancient One');               // 1/1, no activated text of its own
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  giveResources(h, A, 'metal', 3);                          // the [three]
  assert.deepEqual(activations(h, A, ancient), [],
    'out of formation there is no neighbour, so nothing is borrowed');
  h.do({ type: 'declareAttack', seat: A, columns: [[evoker, ancient]] });

  // THE OFFER SIDE. A projected face is NOT the identity face, so it is
  // addressed by name — two neighbours' ability #0 are two different options.
  assert.deepEqual(activations(h, A, ancient), [{ face: 'Omniwield Evoker' }],
    'the neighbour\'s activated ability reaches legalActions, attributed to its face');
  // the fuzzer's "legalActions lied" invariant, aimed at this path by hand:
  // a random game almost never puts an Ancient One next to an ally with an
  // activated ability, so the offer/accept agreement is asserted here instead
  for (const a of legalActions(h.state, A)) {
    assert.doesNotThrow(() => apply(h.state, a), `legalActions offered ${JSON.stringify(a)} and apply refused it`);
  }

  // THE ACCEPT SIDE, which used to refuse what the other half offered
  h.do({ type: 'activateAbility', seat: A, entityId: ancient, abilityIndex: 0, via: { face: 'Omniwield Evoker' } });
  pass(h); pass(h);                                         // resolve it
  assert.equal(ent(h, ancient)!.counters, 1, '"me" is the Ancient One — it took the counter');
  assert.equal(ent(h, evoker)!.counters, 0, 'and the neighbour it was borrowed from did not');
  assert.deepEqual(effStats(h, ancient), [2, 2], 'a 1/1 with one +1/+1 counter');
  assert.equal(new E(h.state).nameOf(ent(h, ancient)!), 'Ancient One',
    'borrowing an ABILITY is not becoming the card');

  // R118: the projection is continuous, so the offer has to be too
  giveResources(h, A, 'metal', 3);
  withE(h, g => g.destroy(g.entity(evoker)!, 'dies'));
  assert.deepEqual(activations(h, A, ancient), [],
    'the Evoker left the column, so the ability stops being offered in the same instant');
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: A, entityId: ancient, abilityIndex: 0, via: { face: 'Omniwield Evoker' } }),
    /does not have that ability/,
    'and apply refuses it too — the two sides agree, which is the whole point');
  finishBattle(h);
});

test('R118: the R9 [once] budget is keyed by FACE — two projected faces do not share one', () => {
  const h = new Harness(2629);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  // both print "[Augment][once] Gain N debt: …", both at augmentText index 0 —
  // keyed on the PHYSICAL card these would collide into one 'augment:Ancient One#0'
  const blep = spawn(h, A, 'Debt Blep');                    // [once] gain 2 debt: +3/+3
  const ancient = spawn(h, A, 'Ancient One');               // 1/1
  const drone = spawn(h, A, 'Deferral Drone');              // [once] gain 4 debt: next card costs [3] less
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  // R75 adjacency: same row, horizontally adjacent columns — a column only
  // holds two, so the three stand side by side rather than stacked
  h.do({ type: 'declareAttack', seat: A, columns: [[blep], [ancient], [drone]] });
  assert.deepEqual(activations(h, A, ancient),
    [{ face: 'Debt Blep', text: 'augment' }, { face: 'Deferral Drone', text: 'augment' }],
    'both neighbours\' [Augment] abilities are borrowed, each under its own face');
  for (const a of legalActions(h.state, A)) {
    assert.doesNotThrow(() => apply(h.state, a), `legalActions offered ${JSON.stringify(a)} and apply refused it`);
  }

  h.do({ type: 'activateAbility', seat: A, entityId: ancient, abilityIndex: 0, via: { face: 'Debt Blep', text: 'augment' } });
  pass(h); pass(h);                                         // resolve it
  assert.deepEqual(effStats(h, ancient), [4, 4], 'the borrowed +3/+3 landed on the Ancient One');
  assert.deepEqual(activations(h, A, ancient), [{ face: 'Deferral Drone', text: 'augment' }],
    'the Blep\'s [once] is spent and the Drone\'s is NOT — one budget each, keyed by face');
  assert.deepEqual(Object.keys(ent(h, ancient)!.budgets), ['augment:Debt Blep#0'],
    'and the key names the FACE the ability came from, never the physical Ancient One');
  assert.deepEqual(activations(h, A, blep), ['augment'],
    'and the Blep\'s own use is its own: R9 budgets live on the entity that used them');
  finishBattle(h);
});

test('R118: an activateAbility carrying via:{face} replays byte for byte', () => {
  const h = new Harness(2630);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const evoker = spawn(h, A, 'Omniwield Evoker');
  const ancient = spawn(h, A, 'Ancient One');
  spawn(h, D, 'Unit Token');
  toNextBattle(h, A);
  giveResources(h, A, 'metal', 3);
  // the spawns are white-box, so the round trip is anchored at the state just
  // before the declaration; everything past that point is nothing but actions
  const start = structuredClone(h.state);
  const from = h.actions.length;
  h.do({ type: 'declareAttack', seat: A, columns: [[evoker, ancient]] });
  h.do({ type: 'activateAbility', seat: A, entityId: ancient, abilityIndex: 0, via: { face: 'Omniwield Evoker' } });
  pass(h); pass(h);
  assert.equal(ent(h, ancient)!.counters, 1);
  assert.ok(h.actions.slice(from).some(a => JSON.stringify(a).includes('"face":"Omniwield Evoker"')),
    'the new via arm really is in the log being replayed');
  let st = start;
  for (const a of h.actions.slice(from)) st = apply(st, a).state;
  assert.equal(JSON.stringify(st), JSON.stringify(h.state),
    'the { face } arm is plain serializable data — seed + actions replays identically');
  finishBattle(h);
});

// ── Arcane Echo ──────────────────────────────────────────────────────────

test('Arcane Echo: creates a copy of a chosen token (the unit copy arrives in the BATTLE region, R115)', () => {
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
  assert.equal(copies[0]!.region, h.state.battle!.region,
    'R115: the copy arrives where the SOURCE is — this spell was cast in the battle region');
  assert.notEqual(h.state.battle!.region, new E(h.state).homeRegion(A), 'which is not the caster\'s home');
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

test('R157 §24: a batch of a Robot 3, a Robot 2 and a Robot 1 yields THREE extras', () => {
  // R104, and the exact defect playtest report #60 named: "Automaton of
  // Abundance fires per spawn so N identical tokens yield N copies instead of
  // one per unique." Manufacture creates a Robot 3, a Robot 2 and a Robot 1 in
  // ONE resolution, which is one creation batch — that half is unchanged.
  //
  // WHAT "UNIQUE" MEANS IS REVERSED. This used to key on the card NAME alone
  // (three Robots = one unique token = one extra) on the argument that
  // `Entity.card` is the engine's definition of identity. R157 §24, owner
  // 2026-08-25: *"'Unique' means unique (name, X) pair — you get two extras."*
  // Three different X are three unique tokens, so three extras.
  const h = new Harness(2620);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Automaton of Abundance');
  giveResources(h, A, 'metal', 6);                          // mmm / 6
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Manufacture') });
  const robots = unitsOf(h, A).filter(u => u.card === 'Robot');
  assert.equal(robots.length, 6, 'three printed Robots plus THREE copies (not four)');
  assert.deepEqual(robots.map(r => r.counters).sort((a, b) => a - b), [1, 1, 2, 2, 3, 3],
    'one extra per (name, X) pair — a copy of each, X and all');
});

test('Automaton of Abundance: a mixed batch gets one extra per KIND, and spell tokens are not units', () => {
  // "each unique token" over two kinds, and the printed restriction to UNIT
  // tokens. Robot Corps creates a Robot; Biotoxicity creates three Poison 1 —
  // spell tokens, which this card does not name.
  const h = new Harness(2621);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Automaton of Abundance');
  giveResources(h, A, 'wood', 2);                           // g / 2
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Biotoxicity') });
  assert.equal(tokensOf(h, A).filter(t => t.card === 'Poison').length, 3,
    'three Poisons and no fourth — "unit tokens" does not mean spell tokens');
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
  // R261: both are held through the damage step and stacked together in the
  // after-combat window. The order they resolve in is unchanged, and so is
  // everything below.
  pass(h); pass(h);                                         // after-combat: the first resolves
  assert.equal(h.state.decision!.kind, 'payOrDecline');
  pick(h, 1);                                               // pay 2 → erase it from A's bin
  // the second trigger (the blocker's death) auto-declined: no mana left
  resolveAfterCombat(h);
  assert.equal(ent(h, dev)!.counters, 2, 'two +1/+1 counters');
  assert.deepEqual(effStats(h, dev), [5, 4]);
  assert.ok(!h.state.players[A]!.bin.includes('Unit Token'), 'the erased card left the bin');
  assert.ok(h.state.players[D]!.bin.includes('Unit Token'), 'no mana for the second death — their card stays binned');
  assert.equal(h.state.players[A]!.resources.filter(r => r.state === 'open').length, 0, 'the [two] was paid');
  finishBattle(h);
});

// R140 — THE INNOCENT COPY, and this is the card where getting it wrong is
// worst: Biomass Devourer ERASES what it finds, so a miss removes a card from
// the game permanently. The fixture is the ruling's: an innocent copy of some
// card name already resting in the bin, a second copy of that name dying and
// being swept straight back out ({Unstable}, R137), and the only correct
// answer is NEITHER. `bin.lastIndexOf(name)` cannot tell them apart — a bin
// holds bare card NAMES — so the card is told WHICH copy died: R140 stamps
// (binSeat, binNth) onto the 'died' event, the same bin identity R131 already
// put on 'trashed'.
test('R140: Biomass Devourer does NOT erase an innocent older copy when the dead one was swept', () => {
  const h = new Harness(2694);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  h.state.players[A]!.bin.push('Good Whale');            // the INNOCENT copy, binned long ago
  const dev = spawn(h, A, 'Biomass Devourer');
  giveResources(h, A, 'metal', 2);                       // the [two] is payable, so that is not what stops it
  const victim = spawn(h, A, 'Good Whale');
  withE(h, e => {
    e.entity(victim)!.unstable = true;                   // R96 stamp → R137: bin, trash, then the sweep
    e.destroy(e.entity(victim)!, 'dies');
  });
  assert.equal(h.state.decision, null,
    'no bargain is offered: the copy that died is in the erased pile and the other copy is not it');
  assert.deepEqual(h.state.players[A]!.bin.filter(c => c === 'Good Whale'), ['Good Whale'],
    'the innocent copy is untouched — it was never the card that died');
  assert.equal(ent(h, dev)!.counters, 0, 'and no counters: nothing was erased, so nothing was paid for');
  assert.equal(h.q.openMana(A), 2, 'the [two] was never asked for');
});

// R140, the second miss the same stamp closes and one that needs no sweep at
// all: a death event's `seat` is the CONTROLLER while the card bins to its
// OWNER. Searching by name found the controller's bin first, so a stolen unit
// dying erased a same-named card out of the THIEF's bin and left the dead
// card's own copy sitting in its owner's. The stamp names the bin.
test('R140: a stolen unit dies — the erase reaches the OWNER\'s bin, not the controller\'s', () => {
  const h = new Harness(2695);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  h.state.players[A]!.bin.push('Good Whale');            // the thief's own innocent copy
  const dev = spawn(h, A, 'Biomass Devourer');
  giveResources(h, A, 'metal', 2);
  const victim = spawn(h, D, 'Good Whale');              // owned by D
  withE(h, e => e.giveControl(e.entity(victim)!, A));    // R112: controlled by A, still owned by D
  assert.equal(ent(h, victim)!.controller, A, 'A controls it');
  assert.equal(ent(h, victim)!.owner, D, 'but D still owns it');
  withE(h, e => e.destroy(e.entity(victim)!, 'dies'));   // → D's bin (the owner's)
  assert.ok(h.state.decision, 'the death is offered to the Devourer');
  pick(h, 1);                                            // pay [two] → erase
  assert.deepEqual(h.state.players[A]!.bin.filter(c => c === 'Good Whale'), ['Good Whale'],
    "the thief's own copy is untouched: it is not the card that died");
  assert.deepEqual(h.state.players[D]!.bin.filter(c => c === 'Good Whale'), [],
    "the copy that died — in its OWNER's bin — is the one erased");
  assert.equal(ent(h, dev)!.counters, 2, 'and the erase really happened, so the counters are earned');
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
  pass(h); pass(h);                                         // R147: ONE resolution — erase, spawn, copy
  assert.ok(!ent(h, whale), 'the target was erased');
  assert.ok(!h.state.players[D]!.bin.includes('Good Whale'), 'erased, not binned');
  const bof = unitsOf(h, A).find(u => u.card === 'Borrower of Forms')!;
  assert.ok(bof, 'the spell unit spawned');
  assert.deepEqual(effStats(h, bof.id), [9, 7], 'base 7/5 + the 2 copied counters');
  finishBattle(h);
  assert.deepEqual(effStats(h, bof.id), [9, 7], '"become" is permanent — survives regroup');
});

/** R118: cast Borrower of Forms at `target` and resolve it. Returns the
 * spawned Borrower body, already wearing the borrowed face — R147: the copy is
 * part of the one resolution that spawns the body, so there is no second
 * resolution to pass through here. */
function borrow(h: Harness, A: Seat, target: EntityId): Entity {
  giveResources(h, A, 'metal', 7);                          // mmm/7
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Borrower of Forms') });
  pick(h, { unit: target });
  pass(h); pass(h);                                         // resolve: erase + spawn, already copied
  return unitsOf(h, A).find(u => u.card === 'Borrower of Forms')!;
}

test('R118: Borrower of Forms takes the NAME, the attributes and the card TEXT', () => {
  const h = new Harness(2622);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const siren = spawn(h, D, 'Sporebloom Siren');            // 2/2 {Poisonous}, "when I die …"
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const bof = borrow(h, A, siren);
  const e = new E(h.state);
  assert.equal(e.nameOf(bof), 'Sporebloom Siren', 'the GAME name is the borrowed one');
  assert.equal(bof.card, 'Borrower of Forms', 'R118 ruling 1: the PHYSICAL card never changes');
  assert.ok(e.ownAttrs(bof).has('Poisonous'), 'the attributes came with the face');
  assert.deepEqual(effStats(h, bof.id), [2, 2], 'and so did the body');
  finishBattle(h);
});

test('R118: a Borrower that became something else still bins as BORROWER OF FORMS (ruling 1)', () => {
  const h = new Harness(2623);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');                  // 7/5
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const bof = borrow(h, A, whale);
  assert.equal(new E(h.state).nameOf(bof), 'Good Whale');
  withE(h, e => e.destroy(e.entity(bof.id)!, 'dies'));
  assert.ok(h.state.players[A]!.bin.includes('Borrower of Forms'),
    'the card that goes to the bin is the one that came out of the deck');
  assert.ok(!h.state.players[A]!.bin.includes('Good Whale'),
    'and the copied card, which nobody ever owned, does not');
});

test('R118 ruling 2: copying a MODDED unit inherits the mods TEXT and makes the copy {Unstable}', () => {
  const h = new Harness(2624);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const host = spawn(h, D, 'Good Whale');                   // 7/5
  giveResources(h, D, 'wood', 3);                           // gg/3
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Glowhaven Elder'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'the target is modded, and therefore Unstable');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const bof = borrow(h, A, host);
  const ref = bof.copies!.find(c => c.facets.includes('name'))!;
  assert.equal(ref.modded, true, 'the owner: "the copy is still considered modded"');
  assert.deepEqual(ref.modText, ['Glowhaven Elder (augmented)'],
    'the owner: "inherit the mods text" — the TEXT, not the mod entity');
  assert.equal(bof.mods.length, 0, 'no mod ENTITY was cloned');
  assert.ok(new E(h.state).isUnstable(bof), 'and therefore: "but it IS Unstable"');
  withE(h, e => e.destroy(e.entity(bof.id)!, 'dies'));
  assert.ok(!h.state.players[A]!.bin.includes('Borrower of Forms'),
    'R69: an Unstable card is ERASED instead of binned');
  assert.ok(h.log.some(l => l.includes('Unstable')), 'and the log says why');
});

test('R118: the Borrower\'s face is PERMANENT and its layer-1 numbers are the borrowed BASE', () => {
  const h = new Harness(2625);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const tok = spawn(h, D, 'Unit Token');                    // 1/1 …
  withE(h, e => e.setBase(e.entity(tok)!, 6, 6));           // … made base 6/6 (layer 2)
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const bof = borrow(h, A, tok);
  const e = new E(h.state);
  assert.deepEqual(e.printedStats(bof), [6, 6],
    '"I copy all stat changes": the face snapshots the base it HAD, not the card\'s printed 1/1');
  assert.equal(bof.tokenStats, undefined,
    'and it is NOT written to tokenStats — the Borrower is not a token, and {Unaware} reads that');
  finishBattle(h);
  assert.deepEqual(effStats(h, bof.id), [6, 6], '"become" is permanent — the face survives regroup');
  assert.equal(new E(h.state).nameOf(ent(h, bof.id)!), 'Unit Token', 'name included');
});

test('R118: Borrower of Forms offers the borrowed ACTIVATED ability, and keeps it permanently', () => {
  const h = new Harness(2631);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const evoker = spawn(h, D, 'Omniwield Evoker');           // 2/1, "[three]: +1/+1 counter on me"
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const bof = borrow(h, A, evoker);
  assert.equal(new E(h.state).nameOf(bof), 'Omniwield Evoker');
  giveResources(h, A, 'metal', 3);                          // the [three]
  // the borrowed face IS the Borrower's identity, so its abilities are its
  // own — the same `via: undefined` a pre-R118 log carries
  assert.deepEqual(activations(h, A, bof.id), ['own'],
    'the erased unit\'s activated ability is offered on the body that became it');
  h.do({ type: 'activateAbility', seat: A, entityId: bof.id, abilityIndex: 0 });
  pass(h); pass(h);
  assert.equal(ent(h, bof.id)!.counters, 1, 'and it fires');
  assert.deepEqual(effStats(h, bof.id), [3, 2], 'base 2/1 plus the counter it just gave itself');
  finishBattle(h);

  // "I BECOME an exact copy": the face never lapses, so neither does the offer
  toNextBattle(h, A);
  giveResources(h, A, 'metal', 3);
  h.do({ type: 'declareAttack', seat: A, columns: [[bof.id]] });
  assert.deepEqual(activations(h, A, bof.id), ['own'],
    '"become" is permanent — the borrowed ability survives regroup with the face');
  finishBattle(h);
});

/* ── R147: the body ENTERS as the copy ─────────────────────────────────────
 *
 * CARD-TODO #37. Every test below needs the caster's own ally-spawn watchers
 * to be standing WHERE THE BODY ARRIVES, and a spell unit's body arrives in
 * the region the spell resolved in — the BATTLE region. A unit spawned by the
 * test rig stands in its controller's HOME region, so the caster has to be the
 * DEFENDER: only then are the two the same region and only then can a watcher
 * see anything at all. `toNextBattle(h, D)` hands the initiative to the
 * opponent; the assertion on `battle.region` right after the declaration is
 * there so the arrangement can never rot into a test that passes because
 * nobody was looking.
 */

/** R147: set up "A defends at home, D attacks", leaving A holding priority in
 * the attack window with `metal` to spend. Returns the battle region. */
function defendingCaster(h: Harness, A: Seat, D: Seat, metal = 7): number {
  const raider = spawn(h, D, 'Unit Token');
  giveResources(h, A, 'metal', metal);
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  pass(h);                                                  // D's window pass → A has priority
  return h.state.battle!.region;
}

test('R147: the Oracle\'s "defense > power" watcher sees the COPIED body, not Borrower of Forms', () => {
  const h = new Harness(2640);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const crab = spawn(h, A, 'Bumblecrab');                   // 2/3 — defense > power
  const oracle = spawn(h, A, 'Nectar Ridge Oracle');        // "[once] when another ally with
  const region = defendingCaster(h, A, D);                  //  greater defense than power spawns"
  assert.equal(ent(h, oracle)!.region, region,
    'the Oracle is standing in the battle region — or it could not see the spawn at all');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Borrower of Forms') });
  pick(h, { unit: crab });
  const hand = h.state.players[A]!.hand.length;
  pass(h); pass(h);                                         // resolve the spell
  // R143's preference: check the QUEUEING, which is the instant the watcher
  // read the body — not the card, which lands a whole resolution later.
  assert.ok(h.log.some(l => l.includes('Trigger: Nectar Ridge Oracle')),
    'Borrower of Forms enters as a 2/3 Bumblecrab, so the Oracle triggers');
  assert.equal(h.state.decision, null, 'and it is the only trigger, so nothing is ordered');
  pass(h); pass(h);                                         // resolve the Oracle's trigger
  assert.equal(h.state.players[A]!.hand.length, hand + 1, 'the card is drawn');
  finishBattle(h);
});

test('R147: becoming the copy is NOT a trigger — no spurious trigger-ordering question', () => {
  const h = new Harness(2641);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const crab = spawn(h, A, 'Bumblecrab');
  const wanderer = spawn(h, A, 'Boreal Wanderer');          // "when another ally spawns during
  const region = defendingCaster(h, A, D);                  //  battle, deal 2 to each opponent"
  assert.equal(ent(h, wanderer)!.region, region, 'the watcher is where the body will arrive');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Borrower of Forms') });
  pick(h, { unit: crab });
  pass(h); pass(h);                                         // resolve the spell
  assert.equal(h.state.decision, null,
    'the Borrower has no trigger of its own to race the Wanderer, so nothing is ordered');
  assert.deepEqual(h.state.stack.map(i => i.label), ['Boreal Wanderer: deal 2 damage to each opponent'],
    'exactly one trigger is waiting, and it is the watcher\'s — not "I become an exact copy"');
  finishBattle(h);
});

/** R147: what a `spawned` watcher SEES, at the instant the event fires.
 * `E.fireEvent` is the single door every listener goes through, so patching it
 * reads the body at exactly the moment the whole board reads it — which is the
 * only moment in question, since "afterwards" is what already worked. */
function watchBorrowerSpawn(h: Harness, fn: () => void): { name: string; stats: [number, number]; attrs: Set<string> } | null {
  type Fire = E['fireEvent'];
  let seen: { name: string; stats: [number, number]; attrs: Set<string> } | null = null;
  const orig: Fire = E.prototype.fireEvent;
  E.prototype.fireEvent = function (this: E, ...args: Parameters<Fire>): void {
    const [type, ev] = args;
    const u = ev.data?.['unit'] !== undefined ? this.entity(ev.data['unit'] as EntityId) : undefined;
    if (type === 'spawned' && u && u.card === 'Borrower of Forms' && !seen) {
      seen = {
        name: this.nameOf(u),
        stats: this.effStats(u),
        attrs: new Set<string>([...this.ownAttrs(u)] as string[]),
      };
    }
    orig.apply(this, args);
  };
  try { fn(); } finally { E.prototype.fireEvent = orig; }
  void h;
  return seen;
}

test('R147: the body wears the borrowed IDENTITY from the instant it enters play', () => {
  const h = new Harness(2642);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const siren = spawn(h, A, 'Sporebloom Siren');            // 2/2 {Poisonous}
  defendingCaster(h, A, D);
  const seen = watchBorrowerSpawn(h, () => {
    h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Borrower of Forms') });
    pick(h, { unit: siren });
    pass(h); pass(h);
  });
  assert.ok(seen, 'the body spawned and the spawn event fired');
  assert.equal(seen!.name, 'Sporebloom Siren',
    'R147: it ENTERS as the thing it copied — it is never a plain Borrower of Forms in play');
  assert.deepEqual(seen!.stats, [2, 2], 'with the borrowed body, not the Borrower\'s own 2/2… ');
  assert.ok(seen!.attrs.has('Poisonous'), '…and the borrowed attributes');
  finishBattle(h);
});

test('R147 (negative control): a Borrower whose target is gone spawns no body at all', () => {
  const h = new Harness(2643);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const crab = spawn(h, A, 'Bumblecrab');
  spawn(h, A, 'Nectar Ridge Oracle');
  defendingCaster(h, A, D);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Borrower of Forms') });
  pick(h, { unit: crab });
  withE(h, e => e.destroy(e.entity(crab)!, 'dies'));         // the form walks away in response
  pass(h); pass(h);
  assert.ok(!unitsOf(h, A).some(u => u.card === 'Borrower of Forms'),
    'R5: the whole item fizzles, so there is no body to wear anything');
  assert.ok(h.state.players[A]!.bin.includes('Borrower of Forms'), 'and the card is binned (R40)');
  assert.ok(!h.log.some(l => l.includes('Trigger: Nectar Ridge Oracle')),
    'nothing spawned, so nothing was watched');
  assert.equal(h.state.decision, null, 'and nothing is left half-asked');
  finishBattle(h);
});

test('R147: two Borrowers of Forms in ONE region each keep their own borrowed face', () => {
  const h = new Harness(2644);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const crab = spawn(h, A, 'Bumblecrab');                   // 2/3
  const slink = spawn(h, A, 'Slink');                       // 2/3, a different name
  const region = defendingCaster(h, A, D, 14);              // two castings
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Borrower of Forms') });
  pick(h, { unit: crab });
  pass(h); pass(h);                                         // #1 resolves — body #1 is in play
  const first = unitsOf(h, A).find(u => u.card === 'Borrower of Forms')!;
  assert.ok(first, 'the first body spawned');
  pass(h);                                                  // priority comes back round to A
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Borrower of Forms') });
  pick(h, { unit: slink });
  pass(h); pass(h);                                         // #2 resolves in the SAME region
  const second = unitsOf(h, A).find(u => u.card === 'Borrower of Forms' && u.id !== first.id)!;
  assert.ok(second, 'the second body spawned');
  const e = new E(h.state);
  assert.equal(e.nameOf(ent(h, first.id)!), 'Bumblecrab',
    'the answer rides each spell\'s own stack item — the second casting cannot eat the first\'s face');
  assert.equal(e.nameOf(ent(h, second.id)!), 'Slink');
  assert.equal(ent(h, first.id)!.region, region);
  assert.equal(ent(h, second.id)!.region, region, 'both of them, in one region');
  finishBattle(h);
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

test('Celestial Shifter: [x] makes it base X/X until regroup (X paid at ACTIVATION)', () => {
  const h = new Harness(2609);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const sh = spawn(h, A, 'Celestial Shifter');              // 2/2
  giveResources(h, A, 'metal', 5);
  h.do({ type: 'activateAbility', seat: A, entityId: sh, abilityIndex: 0, via: 'augment' });
  // R196: the [x] is a `payMana` cast COST, paid a point at a time in the cast
  // window — "pay 1 more" plus "that's enough", the shape every variable cost
  // in the pool has, instead of one X=0..5 menu at resolution.
  for (let k = 0; k < 5; k++) pick(h, { payMana1: true });
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

test('Cosmic Conspirator: a created Robot may become a Fireball of the same X, and no Robot ever exists', () => {
  // R104. The old implementation really created the Robot, fired a `spawned`
  // for it, asked, and then erased it — so a token the card says was never
  // created was on the board and in the event stream. The replacement is
  // consulted BEFORE anything exists, which is what "you would create" means,
  // and the assertion is the ABSENCE of that spawn.
  const h = new Harness(2611);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Cosmic Conspirator');
  giveResources(h, A, 'metal', 2);                          // Self-Assembly: m / 2
  const before = h.events.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Self-Assembly') });
  assert.equal(h.state.decision!.seat, A, 'the swap is offered');
  assert.equal(h.state.decision!.options.length, 4, 'keep / Poison / Crystal / Fireball');
  pick(h, 'Fireball');
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Robot').length, 0, 'no Robot on the board');
  assert.equal(h.events.slice(before)
    .filter(ev => ev.type === 'spawned' && ev.data?.['card'] === 'Robot').length, 0,
    'and no `spawned` for a Robot was ever fired — the replacement is not a create-then-erase');
  assert.equal(h.events.slice(before).filter(ev => ev.type === 'erased').length, 0,
    'nothing was erased, because nothing was created');
  const fb = tokensOf(h, A).find(t => t.card === 'Fireball')!;
  assert.ok(fb, 'a Fireball exists instead');
  assert.equal(fb.x, 2, 'with the same X value (Self-Assembly\'s X is your [m])');
});

test('Cosmic Conspirator: Biotoxicity asks once per token in the batch (report #64)', () => {
  // The owner, 2026-08-22 (GETD): "Biotoxicity didn't give me the choice of
  // what kinds of tokens I wanted even though I had Cosmic Conspirator."
  //
  // TWO defects, both here. Biotoxicity creates three SPELL tokens, and
  // `E.createSpellToken` fires no dispatchable event — so the old `spawned`
  // trigger heard nothing at all. And a per-spawn trigger could not have asked
  // per token in a batch even if it had. A replacement is consulted at the
  // creation call, once per request.
  const h = new Harness(2622);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Cosmic Conspirator');
  giveResources(h, A, 'wood', 2);                           // g / 2
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Biotoxicity') });
  assert.equal(h.state.decision!.seat, A, 'asked for the FIRST Poison');
  pick(h, 'Crystal');
  assert.equal(h.state.decision!.seat, A, 'asked again for the second');
  pick(h, 'keep');
  assert.equal(h.state.decision!.seat, A, 'and again for the third');
  pick(h, 'Fireball');
  assert.equal(h.state.decision, null, 'three tokens, three questions, then done');
  const kinds = tokensOf(h, A).map(t => t.card).sort();
  assert.deepEqual(kinds, ['Crystal', 'Fireball', 'Poison'],
    'one of each kind the player chose — the choice really is per token');
  assert.ok(tokensOf(h, A).every(t => t.x === 1), '"(With the same X value.)"');
});

// ── Deformant ────────────────────────────────────────────────────────────

test('Deformant: sacrifice me + an ally, delete all units costing our counter total', () => {
  // ⚠ THIS TEST CHANGED SHAPE with the move to the `castCost` route, and the
  // change is the point of the card. It used to `pass(h); pass(h)` to RESOLVE
  // the activation and only then meet a `payOrDecline` picking the ally
  // mid-resolution — a response window between cost and effect the printed
  // card does not have. The cost is now paid in the CAST window, so the
  // decision is a `targets` one carrying `{ unit: id }` and it arrives BEFORE
  // the item is on the stack: the passes move to after the payment.
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
  assert.equal(h.state.decision!.kind, 'targets', 'the ally is a COST choice now');
  pick(h, { unit: ally });                                  // total counters: 1 + 2 = 3
  assert.ok(!ent(h, def) && !ent(h, ally), 'both sacrificed');
  assert.deepEqual(h.state.players[D]!.bin.sort(), ['Deformant', 'Unit Token']);
  pass(h); pass(h);                                         // resolve the activation
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

test('Deformant: "sacrifice me AND another ally" is ONE payment, made in the CAST window', () => {
  // The promoted todo. Its old title blamed `AbilityCost` for having no
  // compound shape; that claim was stale twice over — `AbilityCost` DOES carry
  // `sacrificeSelf` and `sacrificeOther` together, and it is the wrong route
  // anyway, because `collectItemCosts` charges the choice-free half a call
  // earlier than the choice-bearing half and Deformant would have been the
  // first card to meet that latent half-pay. The effect-level `castCost` is
  // one collector and one window.
  const h = new Harness(2621);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const def = spawn(h, D, 'Deformant');
  const ally = spawn(h, D, 'Unit Token');
  const spare = spawn(h, D, 'Unit Token');
  const atk = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                  // A passes → D may act
  h.do({ type: 'activateAbility', seat: D, entityId: def, abilityIndex: 0 });
  // the SOURCE half carries no choice, so it is charged first and outright…
  assert.ok(!ent(h, def), 'the Deformant is already sacrificed');
  // …and the picker for "another ally" is open with NOTHING on the stack yet
  assert.equal(h.state.decision!.kind, 'targets');
  assert.equal(h.state.stack.length, 0,
    'the whole cost is paid before the item is a thing anyone can answer');
  notOffered(h, { unit: def }, 'the source is not on its own "another ALLY" menu');
  pick(h, { unit: ally });
  assert.equal(h.state.stack.length, 1, 'only once BOTH are paid does it reach the stack');
  assert.ok(!ent(h, ally) && ent(h, spare), 'exactly the two sacrifices, no more');
  // and there is no priority window BETWEEN cost and effect: the first thing
  // either player may do after the payment is respond to the item itself
  assert.equal(h.state.decision, null, 'no further decision between cost and effect');
  pass(h); pass(h);
  assert.equal(h.state.stack.length, 0, 'resolved');
  finishBattle(h);
});

test('Deformant: the counter total is read off the RECEIPT as of payment, not off the board', () => {
  // Both sacrificed units are DEAD by the time `run` executes, so a board read
  // would total zero. The counters are snapshotted at payment — RAW
  // `Entity.counters`, because Caleb rules they net (+1/+1 and -1/-1 "cancel
  // out") and that a temporary buff is not a counter at all, so `effStats`
  // cannot reconstruct them.
  const h = new Harness(2622);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const bripp = spawn(h, A, 'Bripp');                       // mana 3 — the victim
  const whale = spawn(h, A, 'Good Whale');                  // a different cost
  const def = spawn(h, D, 'Deformant');
  const ally = spawn(h, D, 'Unit Token');
  const third = spawn(h, D, 'Unit Token');                  // survives the whole thing
  withE(h, e => {
    e.addCounters(e.entity(def)!, 2);
    e.addCounters(e.entity(def)!, -1);                      // counters NET: 2 - 1 = 1
    e.addCounters(e.entity(ally)!, 2);
    e.addCounters(e.entity(third)!, 5);                     // a third unit's counters…
  });
  assert.equal(ent(h, def)!.counters, 1, '+1/+1 and -1/-1 cancel pairwise');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bripp], [whale]] });
  pass(h);
  h.do({ type: 'activateAbility', seat: D, entityId: def, abilityIndex: 0 });
  pick(h, { unit: ally });
  const receipt = h.state.stack[0]!.parts[0]!.costPaid!.sacrificedUnits!;
  assert.deepEqual(receipt.map(r => [r.card, r.counters]),
    [['Deformant', 1], ['Unit Token', 2]],
    'the receipt names both units and their counters as of payment');
  // …changed after payment, and it must not move the total
  withE(h, e => { e.addCounters(e.entity(third)!, 4); });
  pass(h); pass(h);                                         // resolve
  assert.ok(!ent(h, bripp), 'the cost-3 unit is deleted — the total is 1 + 2, not 9');
  assert.ok(ent(h, whale), 'and nothing else is');
  assert.ok(ent(h, third), 'the third unit was never part of the cost');
  finishBattle(h);
});

test('Deformant: all or nothing — it never half-pays when the second sacrifice is unavailable', () => {
  // `canPayCastCost` demands BOTH halves up front, which is what stops the
  // source dying for a cost whose remainder cannot be paid. R110 applies the
  // same all-or-nothing rule to a multiplied graft cost.
  const h = new Harness(2623);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = 1 - A;
  const def = spawn(h, D, 'Deformant');
  const ally = spawn(h, D, 'Unit Token');
  const atk = spawn(h, A, 'Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                  // A passes → D may act
  assert.ok(legalActions(h.state, D).some(a =>
    a.type === 'activateAbility' && a.entityId === def), 'offered while the ally stands');
  withE(h, e => { e.destroy(e.entity(ally)!, 'is deleted'); });
  assert.ok(!legalActions(h.state, D).some(a =>
    a.type === 'activateAbility' && a.entityId === def),
    'the ally is gone, so the ability is no longer offered');
  assert.throws(() => h.do({ type: 'activateAbility', seat: D, entityId: def, abilityIndex: 0 }),
    /nothing it can be used on/, 'and it cannot be forced through either');
  assert.ok(ent(h, def), 'the Deformant is ALIVE — no half-payment happened');
  assert.ok(!h.state.players[D]!.bin.includes('Deformant'));
  finishBattle(h);
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

test('Dispatch Courier: no Courier, no OFFER — the grant is what makes the play legal', () => {
  // R228 moved the negative control from the WINDOW to the OFFER. The step
  // opens for everyone now (the window can no longer report what is in a
  // hand), so the thing that must still turn on the grantor is the play
  // itself: with no Courier on the board, the deploy unit is neither offered
  // nor accepted, and `doneHaste` is the whole of the seat's options.
  const h = new Harness(2627);
  const A: Seat = 0;
  giveResources(h, A, 'metal', 4);
  const idx = give(h, A, 'Dispatch Courier');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.deepEqual(h.state.hasteDone, [false, false], 'the step opens regardless (R228)');
  assert.deepEqual(h.legal(A).map(a => a.type), ['doneHaste'],
    'but with no grantor there is nothing to do in it');
  assert.throws(() => h.do({ type: 'playCard', seat: A, handIndex: idx }),
    /only haste cards during the haste step/, 'and the enforcement agrees');
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
  pass(h); pass(h);                                         // combat: 1 to D → the trigger
  assert.equal(h.state.players[D]!.life, 29);
  // R261: the connect trigger is stacked in the after-combat window instead of
  // resolving inside the damage step. R73's shape is untouched — the sacrifice
  // is still paid on the way to the stack, the discard is still chosen at
  // resolution — and every assertion below is the one that was here.
  pass(h); pass(h);                                         // after-combat: it resolves
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
  // R261 moved the window, not the ordering: the trigger is stacked after
  // combat, and the sacrifice is paid as it goes ON the stack there — so the
  // Dreamtender is in the bin before the first priority window, one pass
  // before anyone could answer the trigger, which is exactly R73's claim.
  assert.ok(!ent(h, dt), 'sacrificed on the way to the stack, not at resolution');
  assert.ok(h.state.players[A]!.bin.includes('Eldritch Dreamtender'), 'and it is in the bin');
  pass(h); pass(h);                                         // after-combat: it resolves
  assert.equal(h.state.decision!.seat, A, 'only now is the discard chosen');
  // the log order is the proof: the payment lands between the trigger being
  // QUEUED and the trigger RESOLVING — i.e. in the cast window, which is where
  // a bracketed cost belongs (R64/R67)
  //
  // Read through `logFor(h, A)` and not `h.log` (R203 / CT-84). Both lines are
  // PUBLIC and this test is about ordering, not secrecy — but the Dreamtender
  // also prints "look at that player's hand", and 174-secrecy-is-seat-aware
  // will not let an assertion name a private-look card while reading the
  // seatless firehose. The rule is deliberately blunt there: `logFor` costs
  // nothing, says which seat, and an exemption would have to be argued in
  // prose (CT-83). Ordering is preserved by redaction, which only ever drops
  // or rewrites lines — it never reorders them.
  const iPay = logFor(h, A).findIndex(l => l.includes('sacrifices Eldritch Dreamtender'));
  const iRes = logFor(h, A).findIndex(l => l.includes('Eldritch Dreamtender: sacrifice me')
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
  pass(h); pass(h);   // R261: the trigger is stacked after combat; this resolves it
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

// ── R148 / CT-38: Download routes its steal through E.giveControl ─────────
//
// "Target token" is not only spell tokens — `pushUnitTargets` offers UNIT
// tokens too, and a unit token can be augmented. Download used to flip
// `tok.controller` by hand and unslot it locally, which stole the body and
// left its augments answering to the seat it was taken from. The spell-token
// case above never saw it, because a spell token has no mods.
test('Download steals a MODDED unit token: the augment changes controller with it, and it leaves the blocker grid (R148/CT-38)', () => {
  const h = new Harness(2696);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 2);                          // mm/1
  toNextBattle(h, A);
  const region = h.state.battle!.region;
  let robot = 0, mod = 0;
  withE(h, e => {
    // counters: 2 — a Robot prints 0/0 and carries its size in +1/+1 counters,
    // so a counterless one is a 0/0 and dies to the state-based sweep before
    // it can be stolen. The augment is a VANILLA card on purpose: 'Bubb' would
    // donate {Unaware} to its host, which then reads the printed 0/0 and
    // ignores the counters — the Robot dies of being modded.
    robot = e.spawnUnit(D, 'Robot', e.homeRegion(D), { token: true, counters: 2 }).id;
    mod = e.attachMod(e.entity(robot)!, 'The Foretold', D, 'augment').id;
  });
  assert.equal(ent(h, mod)!.controller, D, 'the augment starts on the victim\'s side');
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [robot] } });
  assert.deepEqual(h.state.battle!.blocks[0], [robot], 'the Robot is a declared blocker');
  const mark = h.events.length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Download') });
  pick(h, { unit: robot });
  pass(h); pass(h);                                         // resolve

  assert.equal(ent(h, robot)!.controller, A, 'the Robot swapped sides (R8)');
  assert.equal(ent(h, robot)!.owner, D, 'owner unchanged');
  assert.equal(ent(h, mod)!.controller, A, 'and its augment swapped sides WITH it (R112)');
  assert.ok(!Object.values(h.state.battle!.blocks).some(col => col.includes(robot)),
    'a stolen blocker leaves the grid it was declared in');
  // CT-39: the typed event, with the seats and the region of the handover
  const changes = h.events.slice(mark).filter(e => e.type === 'controlChanged');
  assert.equal(changes.length, 1, 'exactly one controlChanged');
  assert.deepEqual(
    { from: changes[0]!.data!.from, to: changes[0]!.data!.to, region: changes[0]!.data!.region },
    { from: D, to: A, region }, 'it names who lost it, who got it and where');
  finishBattle(h);
});
