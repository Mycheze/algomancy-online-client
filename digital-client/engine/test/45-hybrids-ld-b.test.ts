/* Per-card tests for the Light & Dark hybrid batch B (batch-hybrids-ld-b):
 * a prophecy-bannered lord (Air Plant, R42/R43), doubled life change (Arbiter
 * of Vitality), X-many Wraith augments (Blight's End, R71), board-wide
 * {Balanced} (Brough, R19), a discard-fuelled graft cause (Cadaverous
 * Cultivator), a resolution-paid recursion engine (Combustible Bogwalker),
 * a discard-costed burn spell (Darkblast, R35/R40), life averaging
 * (Equilibriate), the {Poisonous} half of Inexorable Miasma, life-parity
 * statics (Life Power Dude), trash-triggered drain and burn (Murkstalker,
 * Splort, R40), counter/rot proliferation (Proliferating Slime), bin-fed
 * attribute theft (The Omniphage) and the two vanillas (Hammer of Justice,
 * Rime Wraith). Deferral Drone and Vengeance are still parked, but no longer
 * on "there is no cost-modification layer" (R59 shipped it) — their todos name
 * what each is actually waiting on. Inexorable Miasma's bin half is live (R51).
 * States are built explicitly (give/spawn/giveResources/whiteBox) so parallel
 * card registration can't shift assertions. Seeds: 4500-4599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import { E, Suspended } from '../src/engine.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, pick,
  spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';

/** run engine mutations white-box; a trigger's decision may suspend —
 * the suspension is recorded in state and answered via h.do('decide'). */
function whiteBox(h: Harness, f: (e: E) => void): void {
  const e = new E(h.state);
  try {
    f(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  // a mid-resolution suspension rolls the draft back via structuredClone,
  // re-pointing e.s at a fresh object — re-sync the harness to it
  h.state = e.s;
  h.events.push(...e.events);
  for (const ev of e.events) h.log.push(ev.msg);
}

/** answer the pending decision by the option that names `card` (the
 * mid-resolution cost pickers label their options with the card) */
function pickCard(h: Harness, card: string): void {
  const dec = h.state.decision!;
  const idx = dec.options.findIndex(o => o.card === card);
  if (idx === -1) throw new Error(`no option for ${card} in ${JSON.stringify(dec.options)}`);
  h.do({ type: 'decide', seat: dec.seat, choice: idx });
}

/** empty a seat's opening hand so a discard cost has exactly one candidate */
function emptyHand(h: Harness, seat: Seat): void {
  h.state.players[seat]!.hand.length = 0;
}

// ── Air Plant ────────────────────────────────────────────────────────────

test('Air Plant: [Augment] your OTHER units gain +2/+2 and Flying', () => {
  const h = new Harness(4501);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const plant = spawn(h, p, 'Air Plant');
  const ally = spawn(h, p, 'Hammer of Justice');               // printed 10/3
  assert.deepEqual(effStats(h, ally), [12, 5], 'the other unit gets +2/+2');
  assert.ok(ownAttrs(h, ally).has('Flying'), 'and Flying');
  assert.deepEqual(effStats(h, plant), [2, 2], '"other" excludes the Air Plant itself');
  assert.ok(ownAttrs(h, plant).has('Flying'), 'its own Flying is printed, not granted');
});

test('Air Plant: prophesied for [2], released free once four unique unit costs are out (R42)', () => {
  const h = new Harness(4502);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  giveResources(h, p, 'earth', 2);                             // the plain [2] banner cost
  const idx = give(h, p, 'Air Plant');
  h.do({ type: 'prophesy', seat: p, from: 'hand', index: idx });
  const cc = h.state.players[p]!.cache![0]!;
  assert.equal(cc.card, 'Air Plant', 'the card moved to cache');
  assert.equal(cc.prophecy!.condition, 'Your units have four unique costs.', 'banner attached');
  const e = new E(h.state);
  assert.ok(!e.cachePermission(p, 0), 'no permission yet — no unique costs on board');
  spawn(h, p, 'Splort');                                       // [2]
  spawn(h, p, 'Murkstalker');                                  // [3]
  spawn(h, p, 'Brough');                                       // [4]
  assert.ok(!new E(h.state).cachePermission(p, 0), 'three unique costs is not enough');
  spawn(h, p, 'Hammer of Justice');                            // [6] — the fourth
  assert.equal(new E(h.state).cachePermission(p, 0), 'prophecy', 'four unique costs → released');
  // and the release is FREE, with no light/wood affinity anywhere in sight
  h.do({ type: 'playCached', seat: p, index: 0 });
  assert.ok(unitsOf(h, p).some(u => u.card === 'Air Plant'), 'played from cache for free');
});

// ── Arbiter of Vitality ──────────────────────────────────────────────────

test('Arbiter of Vitality: doubles life GAIN (⚠ trigger approximation)', () => {
  const h = new Harness(4503);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Arbiter of Vitality');
  const before = h.state.players[p]!.life;
  whiteBox(h, e => e.gainLife(p, 3, 'a test'));
  assert.equal(h.state.players[p]!.life, before + 6, '3 gained, then 3 more');
  assert.ok(h.log.some(m => m.includes('Arbiter of Vitality doubles it')), 'logged as the doubling');
});

test('Arbiter of Vitality: doubles life LOSS, and never doubles its own doubling', () => {
  const h = new Harness(4504);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Arbiter of Vitality');
  h.state.players[p]!.life = 40;
  whiteBox(h, e => e.loseLife(p, 5, 'a test'));
  assert.equal(h.state.players[p]!.life, 30, '5 lost, then 5 more — and no runaway recursion');
});

// ── Blight's End ─────────────────────────────────────────────────────────

test("Blight's End: augments a Wraith (R71) onto X target units, enemies included", () => {
  const h = new Harness(4505);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const mine = spawn(h, A, 'Hammer of Justice');
  const theirs = spawn(h, D, 'Hammer of Justice');
  giveResources(h, A, 'wood', 1);
  giveResources(h, A, 'dark', 1);
  giveResources(h, A, 'earth', 1);                             // gd, X up to 3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mine]] });   // both units now in region 1
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, "Blight's End") });
  pick(h, 2);                                                  // X = 2, paid at cast (R35)
  // R67: the X hosts are DECLARED targets, chosen at CAST — X is settled
  // first, so the collector knows to ask for exactly two of them
  pick(h, { unit: mine });
  pick(h, { unit: theirs });
  assert.equal(h.state.stack.length, 1, 'only now is it on the stack, fully aimed');
  pass(h); pass(h);                                            // resolve
  for (const id of [mine, theirs]) {
    const mods = ent(h, id)!.mods.map(m => ent(h, m)!);
    assert.equal(mods.length, 1, 'exactly one mod landed');
    // Blight's End still prints the retired name "Wight"; state stores the
    // current canonical name, so the alias never leaks out of getCard().
    assert.equal(mods[0]!.card, 'Wraith', 'it is the Wraith token');
    assert.equal(mods[0]!.appliedAs, 'augment', 'applied as an augment, not spawned');
    assert.ok(mods[0]!.token, 'the mod is a token — a mod has no card of its own to bin (R69)');
  }
  finishBattle(h);
});

// ── Brough ───────────────────────────────────────────────────────────────

test('Brough: everything is {Balanced} — both players’ units, itself included (R19)', () => {
  const h = new Harness(4506);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const brough = spawn(h, p, 'Brough');                        // printed 0/4
  const hammer = spawn(h, p, 'Hammer of Justice');             // printed 10/3
  assert.deepEqual(effStats(h, brough), [4, 4], '0/4 balances up to 4/4');
  assert.deepEqual(effStats(h, hammer), [10, 10], '10/3 balances up to 10/10');
  assert.ok(ownAttrs(h, hammer).has('Balanced'), 'the attribute really is granted');
});

// ── Cadaverous Cultivator ────────────────────────────────────────────────

test('Cadaverous Cultivator: [Battle] discard a card to fire its grafts', () => {
  const h = new Harness(4507);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  // the Cultivator defends, so the battle happens in ITS region and both
  // players are present there (R25, for the grafted "each opponent" rider)
  const cult = spawn(h, D, 'Cadaverous Cultivator');
  const atk = spawn(h, A, 'Hammer of Justice');
  whiteBox(h, e => e.attachMod(ent(h, cult)!, 'Murkstalker', D, 'graft', 0));
  h.state.players[D]!.life = 30;
  const foeLife = h.state.players[A]!.life;
  toNextBattle(h, A);
  emptyHand(h, D);                                             // after the turn's draw
  give(h, D, 'Brough');                                        // the only card to discard
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                     // priority → D
  h.do({ type: 'activateAbility', seat: D, entityId: cult, abilityIndex: 0 });
  // R49: the discard is an ACTIVATION cost — chosen and paid in the cast
  // window, before the item ever reaches the stack
  assert.equal(h.state.decision!.seat, D, 'the cost choice is asked at activation');
  h.do({ type: 'decide', seat: D, choice: 0 });
  assert.ok(h.state.players[D]!.bin.includes('Brough'),
    'the cost was paid immediately — before anyone could respond');
  pass(h); pass(h);                                            // resolve the ability
  assert.equal(h.state.players[A]!.life, foeLife - 3, 'the grafted Murkstalker rider fired');
  assert.equal(h.state.players[D]!.life, 33, 'and gained the Cultivator’s controller 3');
  finishBattle(h);
});

test('Cadaverous Cultivator: R49 — [Battle] is enforced at ACTIVATION, not at resolution', () => {
  const h = new Harness(4508);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const cult = spawn(h, p, 'Cadaverous Cultivator');
  emptyHand(h, p);
  give(h, p, 'Hammer of Justice');
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: p, entityId: cult, abilityIndex: 0 }),
    /can only be activated during battle/,
    'the printed [Battle] marker gates the activation itself');
  assert.deepEqual(h.state.players[p]!.bin, [], 'nothing was discarded');
  assert.ok(!h.legal(p).some(a => a.type === 'activateAbility' && a.entityId === cult),
    'and it is not even offered during deployment');
});

test('Cadaverous Cultivator: R49 — an empty hand makes the activation cost unpayable', () => {
  const h = new Harness(4530);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const cult = spawn(h, D, 'Cadaverous Cultivator');
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  emptyHand(h, D);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: D, entityId: cult, abilityIndex: 0 }),
    /cannot pay the activation cost/);
  assert.ok(!h.legal(D).some(a => a.type === 'activateAbility' && a.entityId === cult));
  finishBattle(h);
});

// ── Combustible Bogwalker ────────────────────────────────────────────────

test('Combustible Bogwalker: discard a card to recall a unit from your bin ([once])', () => {
  const h = new Harness(4509);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const bog = spawn(h, p, 'Combustible Bogwalker');
  h.state.players[p]!.bin.push('Brough');                      // the unit to recall
  emptyHand(h, p);
  give(h, p, 'Darkblast');                                     // a SPELL, so the bin
  h.do({ type: 'activateAbility', seat: p, entityId: bog, abilityIndex: 0, via: 'augment' });
  // R64/R57: the TARGET is chosen first — against the bin as it is now, which
  // is before the cost pushes a card into it
  pickCard(h, 'Brough');
  // R49: the either/or cost is asked at ACTIVATION, before the item exists
  pickCard(h, 'Darkblast');
  assert.ok(h.state.players[p]!.bin.includes('Darkblast'),
    'paid immediately — nobody could respond in between');
  assert.ok(h.state.players[p]!.hand.includes('Brough'), 'the bin unit is back in hand');
  assert.ok(!h.state.players[p]!.bin.includes('Brough'), 'and left the bin');
  assert.ok(h.state.players[p]!.bin.includes('Darkblast'), 'the discard trashed the paid card (R40)');
  assert.ok(ent(h, bog), 'the OTHER cost mode was not taken — the Bogwalker lives');
  // [once] per turn (R9)
  assert.ok(!h.legal(p).some(a => a.type === 'activateAbility' && a.entityId === bog),
    'the [once] budget is spent for the turn');
});

test('Combustible Bogwalker: R49 — with an empty bin the cost is paid for nothing', () => {
  const h = new Harness(4510);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const bog = spawn(h, p, 'Combustible Bogwalker');
  emptyHand(h, p);
  give(h, p, 'Darkblast');                                     // a SPELL: not recallable
  h.do({ type: 'activateAbility', seat: p, entityId: bog, abilityIndex: 0, via: 'augment' });
  pickCard(h, 'Darkblast');
  // ⚠ the printed line is a COST, and R35 pays costs before effects — so an
  // activation with nothing to recall wastes the payment. The old
  // resolution-time version checked the bin first and paid nothing; that was
  // the more forgiving reading, not the more correct one.
  assert.deepEqual(h.state.players[p]!.bin, ['Darkblast'], 'the cost was paid');
  assert.ok(!h.state.players[p]!.hand.includes('Darkblast'), 'and left the hand');
  assert.ok(h.log.some(m => m.includes('no unit in your bin')), 'and it says why');
});

test('Combustible Bogwalker: R49 — with no payment available the activation is refused', () => {
  const h = new Harness(4534);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const bog = spawn(h, p, 'Combustible Bogwalker');   // its ONLY unit — "another"
  h.state.players[p]!.bin.push('Brough');
  emptyHand(h, p);
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: p, entityId: bog, abilityIndex: 0, via: 'augment' }),
    /cannot pay the activation cost/);
  assert.ok(!h.legal(p).some(a => a.type === 'activateAbility' && a.entityId === bog),
    'and the [once] budget is not burned on it either');
  assert.ok(h.state.players[p]!.bin.includes('Brough'), 'nothing moved');
});

// ── Darkblast ────────────────────────────────────────────────────────────

test('Darkblast: discard a card, deal 5 damage to any target (R35 cost, R40 trash)', () => {
  const h = new Harness(4511);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const victim = spawn(h, D, 'Hammer of Justice');             // 10/3 — 5 damage kills it
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'fire', 1);
  giveResources(h, A, 'dark', 1);                              // rd / 1
  toNextBattle(h, A);
  emptyHand(h, A);                                             // after the turn's draw
  give(h, A, 'Brough');                                        // the only card to discard
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Darkblast') });
  // R57: the TARGET is declared first, then the bracketed cost is chosen and
  // paid — both still at cast, before the spell reaches the stack (R35).
  assert.equal(h.state.decision!.seat, A, 'the caster aims it');
  pick(h, { unit: victim });
  assert.ok(!h.state.players[A]!.bin.includes('Brough'), 'nothing discarded yet');
  h.do({ type: 'decide', seat: A, choice: 0 });                // discard Brough
  assert.ok(h.state.players[A]!.bin.includes('Brough'),
    'the discard cost was paid at cast and trashed (R40)');
  pass(h); pass(h);                                            // resolve
  assert.ok(!ent(h, victim), 'the target took 5 and died');
  finishBattle(h);
});

test('Darkblast: R35 — with nothing else in hand the cost is unpayable and the CAST is illegal', () => {
  const h = new Harness(4512);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const victim = spawn(h, D, 'Hammer of Justice');
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'fire', 1);
  giveResources(h, A, 'dark', 1);
  toNextBattle(h, A);
  emptyHand(h, A);                                             // after the turn's draw
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const only = give(h, A, 'Darkblast');                        // its own only hand card
  assert.throws(
    () => h.do({ type: 'playCard', seat: A, handIndex: only }),
    /unpayable \[cost\]/,
    'R35: a spell cannot discard ITSELF to pay its own [Discard a card] cost');
  assert.ok(!h.legal(A).some(a => a.type === 'playCard' && a.handIndex === only),
    'and legalActions does not offer it');
  assert.ok(ent(h, victim), 'nothing happened at all');
  finishBattle(h);
});

// ── Deferral Drone (PARKED) ──────────────────────────────────────────────

test('Deferral Drone: gain 4 debt → the next card you play this turn costs [3] less', { todo: true }, () => {
  // PARKED — but the reason has MOVED. It used to be "the cost-modification
  // layer does not exist"; R59's CostMod is that layer (Tranquility, The
  // Silent and Stasis Sentry all ride it, and `costMods` is a first-class
  // CardBehavior field).
  //
  // WAITING ON: a ONE-SHOT cost charge. CostMod is a continuous, stateless
  // query — E.costModsFor asks every holder "what does this card cost right
  // now" — and there is nowhere to record "…and stop after the next play".
  // "The NEXT card you play this turn" needs a per-turn charge that a play
  // consumes, i.e. state on the player (or the mod) plus a hook on the play
  // path to spend it. Wiring only the "gain 4 debt" half meanwhile would hand
  // the player a cost with no benefit, so the ability is not offered at all.
});

test('Deferral Drone: plays as a 2/2 and augments, offering no ability', () => {
  const h = new Harness(4513);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const drone = spawn(h, p, 'Deferral Drone');
  assert.deepEqual(effStats(h, drone), [2, 2], 'vanilla 2/2 in play');
  assert.ok(!h.legal(p).some(a => a.type === 'activateAbility' && a.entityId === drone),
    'PARKED: no activated ability is offered');
  const host = spawn(h, p, 'Brough');
  giveResources(h, p, 'light', 1);
  giveResources(h, p, 'metal', 1);                             // lm / 2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Deferral Drone'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'still recognised as an augment (inert donation)');
});

// ── Equilibriate ─────────────────────────────────────────────────────────

test('Equilibriate: sets every life total to the floored average', () => {
  const h = new Harness(4514);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  h.state.players[A]!.life = 20;
  h.state.players[D]!.life = 7;                                // average 13.5 → 13
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'light', 1);
  giveResources(h, A, 'wood', 1);
  giveResources(h, A, 'earth', 3);                             // lg / 5
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Equilibriate') });
  pass(h); pass(h);                                            // resolve
  assert.equal(h.state.players[A]!.life, 13, 'the high player comes down');
  assert.equal(h.state.players[D]!.life, 13, 'the low player comes up');
  finishBattle(h);
});

// ── Hammer of Justice / Rime Wraith (vanilla) ────────────────────────────

test('Hammer of Justice and Rime Wraith: printed bodies and printed attributes only', () => {
  const h = new Harness(4515);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const hammer = spawn(h, p, 'Hammer of Justice');
  assert.deepEqual(effStats(h, hammer), [10, 3], 'a 10/3 structure');
  assert.ok(ownAttrs(h, hammer).has('Blessed'), '{Blessed} comes off the type line (R48)');
  assert.ok(ownAttrs(h, hammer).has('Piercing'), 'as does {Piercing}');
  // Rime Wraith is a {Virus} [Augment] {Swift}{Sluggish} body with no behaviour:
  // augmenting it donates both type-line attributes and nothing else
  giveResources(h, p, 'light', 1);
  giveResources(h, p, 'water', 1);                             // lb / 2
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Rime Wraith'), hostId: hammer });
  const attrs = ownAttrs(h, hammer);
  assert.ok(attrs.has('Swift') && attrs.has('Sluggish'),
    '⚠ the card grants BOTH Swift and Sluggish — see the batch report');
  assert.deepEqual(effStats(h, hammer), [10, 3], 'the augment changes no stats');
});

// ── Inexorable Miasma ────────────────────────────────────────────────────

test('Inexorable Miasma: target unit gains {Poisonous} until regroup', () => {
  const h = new Harness(4516);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const victim = spawn(h, D, 'Hammer of Justice');
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'wood', 1);
  giveResources(h, A, 'dark', 1);                              // gd / 1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Inexorable Miasma') });
  pick(h, { unit: victim });
  pass(h); pass(h);
  assert.ok(ownAttrs(h, victim).has('Poisonous'), 'the target is poisonous');
  assert.deepEqual(ent(h, victim)!.tempAttrs, ['Poisonous'], 'granted as a temp attr (clears at regroup)');
  finishBattle(h);
});

test('Inexorable Miasma: R51 — after combat, from your BIN, remove a -1/-1 counter to recall it', () => {
  const h = new Harness(4531);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  // the counter-carrying unit has to be IN the battle region (R12/R25), i.e.
  // the defender's home — so it is D's, which is fine: the text says "a unit"
  const shrunk = spawn(h, D, 'Hammer of Justice');
  whiteBox(h, e => e.addCounters(ent(h, shrunk)!, -2));         // net -2: it has -1/-1 counters
  h.state.players[A]!.bin.push('Inexorable Miasma');            // sitting in A's bin
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);                                             // attack window
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                             // block window → damage → after-combat
  // in battle a trigger uses the stack, so it asks when it RESOLVES
  pass(h); pass(h);
  assert.ok(h.state.decision, 'the bin-resident trigger asked its question');
  assert.equal(h.state.decision!.seat, A, '"if I am in YOUR bin" — the bin owner decides');
  const opt = h.state.decision!.options.findIndex(o => o.card === 'Hammer of Justice');
  assert.ok(opt >= 0, 'only a unit carrying a -1/-1 counter is offered');
  h.do({ type: 'decide', seat: A, choice: opt });
  assert.equal(ent(h, shrunk)!.counters, -1, 'one -1/-1 counter was removed');
  assert.ok(!h.state.players[A]!.bin.includes('Inexorable Miasma'), 'it left the bin');
  assert.ok(h.state.players[A]!.hand.includes('Inexorable Miasma'), 'recalled to hand');
  finishBattle(h);
});

test('Inexorable Miasma: with no -1/-1 counters anywhere it just stays in the bin', () => {
  const h = new Harness(4532);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  h.state.players[A]!.bin.push('Inexorable Miasma');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  pass(h); pass(h);                                             // the trigger resolves
  assert.equal(h.state.decision, null, 'nothing to ask');
  assert.ok(h.state.players[A]!.bin.includes('Inexorable Miasma'), 'still in the bin');
  assert.ok(h.log.some(m => m.includes('no unit carries a -1/-1 counter')));
  finishBattle(h);
});

test('Inexorable Miasma: a card that is NOT in the bin never hears the after-combat event', () => {
  const h = new Harness(4533);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const shrunk = spawn(h, A, 'Hammer of Justice');
  whiteBox(h, e => e.addCounters(ent(h, shrunk)!, -2));
  toNextBattle(h, A);                                            // bin is empty
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.equal(h.state.decision, null, 'no zone trigger without the card in the zone');
  assert.equal(ent(h, shrunk)!.counters, -2, 'and nothing was removed');
  finishBattle(h);
});

// ── Life Power Dude ──────────────────────────────────────────────────────

test('Life Power Dude: odd life → all units -2/-0, even life → +2/+0 (live, R27)', () => {
  const h = new Harness(4517);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const dude = spawn(h, p, 'Life Power Dude');                 // printed 2/3
  const ally = spawn(h, p, 'Hammer of Justice');               // printed 10/3
  h.state.players[p]!.life = 21;                               // odd
  assert.deepEqual(effStats(h, ally), [8, 3], 'odd life: -2/-0');
  assert.deepEqual(effStats(h, dude), [0, 3], '"all units" includes the Dude itself');
  h.state.players[p]!.life = 20;                               // even
  assert.deepEqual(effStats(h, ally), [12, 3], 'even life: +2/+0');
  assert.deepEqual(effStats(h, dude), [4, 3], 'and again, itself included');
});

// ── Murkstalker ──────────────────────────────────────────────────────────

test('Murkstalker: when YOU trash a card, drain 3 — bounded once per turn (R9/R40)', () => {
  const h = new Harness(4518);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  // "each opponent" is region-scoped (R25), so the drain needs both players in
  // one region: the Murkstalker DEFENDS and the battle comes to it
  const murk = spawn(h, D, 'Murkstalker');
  const atk = spawn(h, A, 'Unit Token');
  h.state.players[D]!.life = 30;
  const foeLife = h.state.players[A]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  assert.equal(ent(h, murk)!.region, h.state.battle!.region, 'setup: the battle is in its region');
  whiteBox(h, e => { e.discardFromHand(D, 0); });
  pass(h); pass(h);                                            // resolve the trigger
  assert.equal(h.state.players[A]!.life, foeLife - 3, 'each opponent loses 3');
  assert.equal(h.state.players[D]!.life, 33, 'and I gain 3');
  whiteBox(h, e => { e.discardFromHand(D, 0); });
  assert.equal(h.state.players[A]!.life, foeLife - 3, '[Switch1]: only once this turn');
  finishBattle(h);
});

test('Murkstalker: an OPPONENT trashing a card does not fire it', () => {
  const h = new Harness(4519);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const foe = 1 - p;
  // put the Murkstalker in the trasher's region so only "who trashed" can differ
  whiteBox(h, e => { e.spawnUnit(p, 'Murkstalker', e.homeRegion(foe)); });
  const myLife = h.state.players[p]!.life;
  give(h, foe, 'Brough');
  whiteBox(h, e => { e.discardFromHand(foe, 0); });
  assert.equal(h.state.players[p]!.life, myLife, '"when YOU trash" — not their trash');
});

// ── Proliferating Slime ──────────────────────────────────────────────────

test('Proliferating Slime: counters on an ENEMY unit arrive plus one (⚠ approximation)', () => {
  const h = new Harness(4520);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const foe = 1 - p;
  spawn(h, p, 'Proliferating Slime');
  let enemy = 0, mine = 0;
  whiteBox(h, e => {
    enemy = e.spawnUnit(foe, 'Hammer of Justice', e.homeRegion(p)).id;
    mine = e.spawnUnit(p, 'Hammer of Justice', e.homeRegion(p)).id;
  });
  whiteBox(h, e => e.addCounters(ent(h, enemy)!, -1));
  assert.equal(ent(h, enemy)!.counters, -2, 'one -1/-1 counter became two — and did not run away');
  whiteBox(h, e => e.addCounters(ent(h, mine)!, 2));
  assert.equal(ent(h, mine)!.counters, 2, 'my own units are untouched');
});

test('Proliferating Slime: rot given to an enemy PLAYER arrives plus one (⚠ interpretation)', () => {
  const h = new Harness(4521);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const foe = 1 - p;
  spawn(h, p, 'Proliferating Slime');
  whiteBox(h, e => e.gainRot(foe, 2));
  assert.equal(new E(h.state).rot(foe), 3, '"or player" is read as rot/debt — 2 became 3');
  whiteBox(h, e => e.gainDebt(p, 2));
  assert.equal(new E(h.state).debt(p), 2, 'my own debt is not proliferated');
});

// ── Splort ───────────────────────────────────────────────────────────────

test('Splort: when ANOTHER card is trashed, deal 2 to any target (R40)', () => {
  const h = new Harness(4522);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Splort');
  const target = spawn(h, p, 'Life Power Dude');               // 2/3 — survives 2 damage
  give(h, p, 'Brough');
  give(h, p, 'Murkstalker');
  whiteBox(h, e => { e.discardFromHand(p, 0); });
  assert.ok(h.state.decision, 'the trigger asks for its target');
  pick(h, { unit: target });
  assert.equal(ent(h, target)!.damage, 2, 'two damage landed');
  whiteBox(h, e => { e.discardFromHand(p, 0); });
  assert.ok(!h.state.decision, '[Switch1]: bounded to once per turn');
});

// ── The Omniphage ────────────────────────────────────────────────────────

test('The Omniphage: gains every attribute printed on units in your bin (live)', () => {
  const h = new Harness(4523);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const omni = spawn(h, p, 'The Omniphage');
  assert.equal(ownAttrs(h, omni).size, 0, 'an empty bin grants nothing');
  h.state.players[p]!.bin.push('Air Plant');                   // a {Flying} unit
  assert.ok(ownAttrs(h, omni).has('Flying'), 'Flying is copied out of the bin');
  h.state.players[p]!.bin.push('Hammer of Justice');           // {Blessed} {Piercing}
  const attrs = ownAttrs(h, omni);
  assert.ok(attrs.has('Blessed') && attrs.has('Piercing') && attrs.has('Flying'),
    'all of them, from every unit in the bin');
  h.state.players[1 - p]!.bin.push('Rime Wraith');
  assert.ok(!ownAttrs(h, omni).has('Sluggish'), '"YOUR bin" — not the opponent’s');
});

// ── Vengeance (PARKED) ───────────────────────────────────────────────────

test("Vengeance: opponents' battle cards gain '[Sacrifice a unit]'", { todo: true }, () => {
  // PARKED — but not on the cost-modification layer any more: R59's CostMod
  // exists, it already applies to BOTH players (Tranquility and Stasis Sentry
  // are unqualified taxes on everyone), and R60 gave it a second channel for
  // life (Arbiter of Armistice).
  //
  // WAITING ON: a SACRIFICE channel on CostMod. It carries `delta` (extra
  // mana) and `life` (extra life) and nothing else, so an imposed
  // "[Sacrifice a unit]" has no way to be charged — and, unlike mana or life,
  // it is a cost with a CHOICE in it, so it would also need to reach the cast
  // window's pendingCosts rather than being charged outright, and to gate the
  // opponent's cast when they control no unit.
});

test('Vengeance: plays as a 7/9 and is recognised as an augment', () => {
  const h = new Harness(4524);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  const v = spawn(h, p, 'Vengeance');
  assert.deepEqual(effStats(h, v), [7, 9], 'vanilla 7/9 in play');
  const host = spawn(h, p, 'Brough');
  giveResources(h, p, 'light', 1);
  giveResources(h, p, 'fire', 1);
  giveResources(h, p, 'earth', 11);                            // lr / 13
  h.do({ type: 'augment', seat: p, from: 'hand', index: give(h, p, 'Vengeance'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'inert donation, but a legal augment');
});
