/* Per-card tests for the dark-a batch (project rule: a test for every card).
 * States are built explicitly (spawn/give/giveResources, explicit bins and
 * counters) so parallel card registration can't shift assertions; seeds are
 * 4100-4199.
 *
 * Covers the expansion mechanics this batch touches: glimpse (R45 — Glook,
 * Maw of Despair), rot (R38 — Cosmic Devourer, Pestilent Titan, Burn the
 * Blight), trash (R40 — Afflicting Anima, Maw of Despair, Nothyr, Sacrifice
 * Dude, and the "Discard me" play mode) and the Wraith token (R71 —
 * Afflicting Anima, Cosmic Devourer); plus bin recursion (Exhume, Spore of
 * Regenesis, Tilling the Graves, Wake the Dead), the stat-change target gate
 * (Leave None Pure) and the ordinary battle triggers (Cull, Gzxyclop,
 * Möbius's Corruption, Reality Siphoner, Scuttling Abomination).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { IllegalAction } from '../src/apply.ts';
import type { Entity, Seat } from '../src/types.ts';
import {
  effStats, ent, finishBattle, give, giveResources, notOffered, pass, pick, spawn,
  toDeployment, toNextBattle, unitsOf,
} from './util.ts';

/** Run raw engine calls against the harness state, absorbing a suspension
 * (a decision produced mid-settle) and keeping the harness log honest. */
function whiteBox(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state);
  try {
    fn(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
  h.events.push(...e.events);
  for (const ev of e.events) h.log.push(ev.msg);
}

const named = (h: Harness, card: string): Entity[] =>
  Object.values(h.state.entities).filter(e => e.card === card && e.kind === 'unit' && !e.absent);

// ── Afflicting Anima ─────────────────────────────────────────────────────

test('Afflicting Anima: trashed from hand → pay [1] to create a Wraith (R40 + R71)', () => {
  const h = new Harness(4101);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  giveResources(h, A, 'dark', 1);
  const i = give(h, A, 'Afflicting Anima');
  whiteBox(h, e => { e.discardFromHand(A, i); });   // discarding is trashing (R40)
  assert.ok(h.log.some(l => l.includes('trashes Afflicting Anima')), 'the discard trashed it');
  assert.equal(h.state.decision!.kind, 'payOrDecline', 'the trigger fires FROM THE BIN');
  pick(h, true);
  const wights = named(h, 'Wraith');
  assert.equal(wights.length, 1, 'a Wraith was created');
  assert.deepEqual(effStats(h, wights[0]!.id), [3, 3], 'the Wraith is a 3/3 body (R71)');
  assert.ok(wights[0]!.token, 'and it is a token');
  assert.equal(h.q.openMana(A), 0, 'the [1] was paid');
  assert.ok(h.state.players[A]!.bin.includes('Afflicting Anima'), 'the card itself stays in the bin');
});

test('Afflicting Anima: declining the [1] makes no Wraith', () => {
  const h = new Harness(4102);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  giveResources(h, A, 'dark', 1);
  const i = give(h, A, 'Afflicting Anima');
  whiteBox(h, e => { e.discardFromHand(A, i); });
  pick(h, false);
  assert.equal(named(h, 'Wraith').length, 0, 'no Wraith');
  assert.equal(h.q.openMana(A), 1, 'and nothing was paid');
});

// ── Burn the Blight ──────────────────────────────────────────────────────

test('Burn the Blight: removes counters from units AND the rot/debt on players', () => {
  const h = new Harness(4103);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const def = spawn(h, D, 'Unit Token');
  whiteBox(h, e => {
    e.addCounters(e.entity(atk)!, 2);
    e.addCounters(e.entity(def)!, 3);
    e.gainRot(A, 2); e.gainRot(D, 1); e.gainDebt(D, 2);
  });
  giveResources(h, A, 'dark', 3);                       // dd/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Burn the Blight') });
  pass(h); pass(h);                                     // resolve
  assert.equal(ent(h, atk)!.counters, 0, 'counters gone from the attacker');
  assert.equal(ent(h, def)!.counters, 0, 'and from the defender');
  assert.deepEqual(effStats(h, def), [1, 1]);
  assert.equal(h.q.rot(A), 0, 'rot is a player counter (R38) — removed');
  assert.equal(h.q.rot(D), 0);
  assert.equal(h.q.debt(D), 0, 'so is debt (R39)');
  finishBattle(h);
});

// ── Cosmic Devourer ──────────────────────────────────────────────────────

test('Cosmic Devourer: end of turn → create a Wraith and gain 1 rot', () => {
  const h = new Harness(4104);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  spawn(h, A, 'Cosmic Devourer');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });   // → end of turn
  assert.equal(named(h, 'Wraith').length, 1, 'a Wraith at end of turn (R71)');
  assert.equal(h.q.rot(A), 1, 'and a rot (R38)');
  const life = h.state.players[A]!.life;
  // R38: the rot bites at the START of the next deployment
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  finishBattle(h);
  assert.equal(h.state.players[A]!.life, life - 1, 'rot deals its damage at the start of deployment');
});

// ── Cull ─────────────────────────────────────────────────────────────────

test('Cull: each player sacrifices a unit (region-scoped, R25)', () => {
  const h = new Harness(4105);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const d1 = spawn(h, D, 'Unit Token');
  const d2 = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'dark', 1);                       // d/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Cull') });
  pass(h); pass(h);                                     // resolve → D picks (A has only one unit here)
  assert.equal(h.state.decision!.seat, D, 'only the player with a choice is asked');
  pick(h, d2);
  assert.ok(!ent(h, atk), 'the attacker was auto-sacrificed (its only unit here)');
  assert.ok(!ent(h, d2), 'and D sacrificed the whale it chose');
  assert.ok(ent(h, d1), 'the other one survives');
  assert.ok(h.state.players[D]!.bin.includes('Good Whale'), 'sacrifice → bin (and a trash, R40)');
  finishBattle(h);
});

// ── Exhume ───────────────────────────────────────────────────────────────

test('Exhume: puts a bin unit costing up to your [d] into play', () => {
  const h = new Harness(4106);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  h.state.players[A]!.bin.push('Curio Drifter', 'Good Whale');   // cost 1 and cost 6
  giveResources(h, A, 'dark', 3);                       // d/2, and X = dark affinity = 3
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Exhume') });
  assert.equal(h.state.decision, null, 'only one bin unit qualifies — auto-picked');
  const revived = unitsOf(h, A).filter(u => u.card === 'Curio Drifter');
  assert.equal(revived.length, 1, 'the cost-1 unit is in play');
  assert.ok(h.state.players[A]!.bin.includes('Good Whale'), 'the cost-6 unit is out of range of X = 3');
  assert.ok(!h.state.players[A]!.bin.includes('Curio Drifter'), 'and it left the bin');
});

// ── Glook ────────────────────────────────────────────────────────────────

test('Glook: [once] discard X cards → glimpse 1, X times (R45)', () => {
  const h = new Harness(4107);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const glook = spawn(h, A, 'Glook');
  const hand = h.state.players[A]!.hand.slice();
  assert.ok(hand.length >= 3, 'the opening hand is big enough to pay with');
  h.do({ type: 'activateAbility', seat: A, entityId: glook, abilityIndex: 0 });
  // R196: "Discard X cards" is a real cast COST now — the picks belong to the
  // cost collector and are made before the ability is respondable
  pick(h, { discard: 0 }); pick(h, { discard: 0 });      // discard two named cards
  pick(h, { doneCost: true });                          // "That's enough" → X = 2
  assert.equal(h.state.players[A]!.hand.length, hand.length - 2, 'two cards discarded');
  assert.ok(h.state.players[A]!.bin.includes(hand[0]!), 'discards are trashes into the bin (R40)');
  assert.ok(h.state.players[A]!.bin.includes(hand[1]!));
  const cache = h.q.cache(A);
  assert.equal(cache.length, 2, 'glimpse 1 twice → two cached cards');
  assert.equal(h.q.cachePermission(A, 0), 'glimpse', 'playable until end of turn (R45)');
  assert.equal(h.q.cachePermission(A, 1), 'glimpse');
  assert.ok(h.events.filter(ev => ev.type === 'glimpsed').length === 2, 'two separate glimpses of 1');
  assert.throws(() => h.do({ type: 'activateAbility', seat: A, entityId: glook, abilityIndex: 0 }),
    IllegalAction, '[once]: not twice in a turn (R9)');
});

// ── Gzxyclop ─────────────────────────────────────────────────────────────

test('Gzxyclop: draws on spawn; the [Augment] despawn half discards two', () => {
  const h = new Harness(4108);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const before = h.state.players[A]!.hand.length;
  const gz = spawn(h, A, 'Gzxyclop');
  assert.equal(h.state.players[A]!.hand.length, before + 1, 'spawn drew a card');
  const hand = h.state.players[A]!.hand.slice();
  whiteBox(h, e => { e.destroy(e.entity(gz)!, 'dies'); });
  pick(h, 0); pick(h, 1);                               // the two discards
  assert.equal(h.state.players[A]!.hand.length, hand.length - 2, 'two cards discarded on despawn');
  assert.ok(h.state.players[A]!.bin.includes(hand[0]!));
  assert.ok(h.state.players[A]!.bin.includes(hand[1]!));
  assert.ok(h.state.players[A]!.bin.includes('Gzxyclop'), 'it died unmodded → bin');
});

// ── Leave None Pure ──────────────────────────────────────────────────────

test('Leave None Pure: deletes only a unit with no stat changes', () => {
  const h = new Harness(4109);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  const clean = spawn(h, D, 'Unit Token');
  const dirty = spawn(h, D, 'Unit Token');
  whiteBox(h, e => e.addCounters(e.entity(dirty)!, 1));
  giveResources(h, A, 'dark', 4);                       // two casts of d/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // R64: "with no stat changes" is a targeting restriction — the counter'd
  // unit is never offered rather than being chosen and then spared.
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Leave None Pure') });
  notOffered(h, { unit: dirty }, 'it has a +1/+1 counter');
  pick(h, { unit: atk });
  pass(h); pass(h);
  assert.ok(ent(h, dirty), 'a unit with a +1/+1 counter is not deleted');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Leave None Pure') });
  pick(h, { unit: clean });
  pass(h); pass(h);
  assert.ok(!ent(h, clean), 'an untouched unit is deleted');
  assert.ok(h.state.players[D]!.bin.includes('Unit Token'), 'deleted → bin');
  finishBattle(h);
});

// ── Maw of Despair ───────────────────────────────────────────────────────

test('Maw of Despair: trashed → glimpse 2 — reveal 2, cache ONE, recycle the other (R40 + R45)', () => {
  const h = new Harness(4110);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const deckTop = h.q.deckOf(A).slice(0, 2);
  const deckBefore = h.q.deckOf(A).length;
  const i = give(h, A, 'Maw of Despair');
  const handBefore = h.state.players[A]!.hand.filter((_, k) => k !== i);
  whiteBox(h, e => { e.discardFromHand(A, i); });
  const dec = h.state.decision!;
  assert.ok(dec, 'glimpse 2 asks the glimpser which one to cache');
  assert.equal(dec.seat, A);
  assert.deepEqual(dec.options.map(o => o.card), deckTop, 'both revealed cards are offered');
  h.do({ type: 'decide', seat: A, choice: 0 });
  const cache = h.q.cache(A);
  assert.equal(cache.length, 1, 'exactly ONE card is cached');
  assert.equal(cache[0]!.card, deckTop[0], 'the chosen one');
  assert.deepEqual(h.q.deckOf(A).slice(-1), [deckTop[1]], 'the other goes to the bottom of the deck');
  assert.equal(h.q.deckOf(A).length, deckBefore - 1, 'only the cached card left the deck');
  assert.deepEqual(h.state.players[A]!.hand, handBefore, 'nothing reaches hand');
  assert.equal(h.q.cachePermission(A, 0), 'glimpse', 'playable this turn, ignoring affinity');
  assert.ok(h.events.some(ev => ev.type === 'glimpsed'));
});

// ── Möbius's Corruption ──────────────────────────────────────────────────

test("Möbius's Corruption: after combat it puts two -1/-1 counters on itself", () => {
  const h = new Harness(4111);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const mob = spawn(h, A, "Möbius's Corruption");        // 5/3
  assert.deepEqual(effStats(h, mob), [5, 3]);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mob]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                     // combat → afterCombat trigger on the stack
  pass(h); pass(h);                                     // resolve it
  assert.equal(ent(h, mob)!.counters, -2, 'two -1/-1 counters');
  assert.deepEqual(effStats(h, mob), [3, 1], 'and they are permanent');
  finishBattle(h);
  assert.deepEqual(effStats(h, mob), [3, 1], 'counters are not temporary — they survive regroup');
});

// ── Nothyr ───────────────────────────────────────────────────────────────

test('Nothyr: "Discard me" in battle → its trash trigger negates a nonspell effect', () => {
  const h = new Harness(4112);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const kraken = spawn(h, A, 'Minor Kraken');           // "when I attack, recall target unit"
  const dTok = spawn(h, D, 'Unit Token');
  giveResources(h, D, 'dark', 2);                       // the "2 [d] Discard Me" line
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[kraken]] });
  pick(h, { unit: dTok });                              // the kraken trigger takes its target
  const krakenItem = h.state.stack[0]!.id;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Nothyr'), mode: 'discardMe' });
  assert.ok(h.state.players[D]!.bin.includes('Nothyr'), 'the cost discarded it — a trash (R40)');
  assert.equal(h.q.openMana(D), 0, 'and the [2] was paid');
  // R67: the negate names its victim as the trigger goes on the stack, while
  // there is still a window to respond — not once it is already resolving
  assert.equal(h.state.decision!.kind, 'targets');
  assert.equal(h.state.decision!.seat, D);
  pick(h, { stack: krakenItem });
  pass(h); pass(h);                                     // resolve Nothyr's trigger
  assert.ok(h.log.some(l => l.includes('is negated')), 'the triggered effect is negated');
  assert.equal(h.state.stack.length, 0, 'R68: the negated trigger left the stack at once');
  assert.ok(ent(h, dTok), 'the token was never recalled');
  finishBattle(h);
});

// ── Pestilent Titan ──────────────────────────────────────────────────────

test('Pestilent Titan: attacking shrinks every unit here and gives every player a rot', () => {
  const h = new Harness(4113);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const titan = spawn(h, A, 'Pestilent Titan');         // 3/4
  const whale = spawn(h, D, 'Good Whale');              // 7/5
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[titan]] });
  pass(h); pass(h);                                     // resolve the attack trigger
  assert.deepEqual(effStats(h, titan), [2, 3], 'itself included ("each unit")');
  assert.deepEqual(effStats(h, whale), [6, 4]);
  assert.equal(h.q.rot(A), 1, '"each player" includes the Titan\'s controller');
  assert.equal(h.q.rot(D), 1);
  finishBattle(h);
});

// ── Reality Siphoner ─────────────────────────────────────────────────────

test('Reality Siphoner: end of turn recycles your bin and grows by what moved', () => {
  const h = new Harness(4114);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const rs = spawn(h, A, 'Reality Siphoner');           // 2/2
  h.state.players[A]!.bin.push('Curio Drifter', 'Bumblecrab', 'Dune Drifter');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });   // → end of turn (then the next turn's draws)
  assert.equal(h.state.players[A]!.bin.length, 0, 'the bin was recycled');
  assert.deepEqual(h.q.deckOf(A).slice(-3), ['Curio Drifter', 'Bumblecrab', 'Dune Drifter'],
    'to the BOTTOM of the deck, in bin order');
  assert.equal(ent(h, rs)!.counters, 3, 'a +1/+1 counter per card recycled');
  assert.deepEqual(effStats(h, rs), [5, 5]);
});

// ── Sacrifice Dude ───────────────────────────────────────────────────────

test('Sacrifice Dude: entering the bin offers [2] — each opponent sacrifices a nontoken unit', () => {
  const h = new Harness(4115);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const dude = spawn(h, A, 'Sacrifice Dude');           // 2/1
  const whale = spawn(h, D, 'Good Whale');              // 7/5 — kills it, survives
  giveResources(h, A, 'dark', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[dude]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [whale] } });
  pass(h); pass(h);                                     // combat: the Dude dies → trashed (R40)
  assert.ok(!ent(h, dude), 'it died in combat');
  assert.equal(h.state.decision!.kind, 'payOrDecline');
  assert.equal(h.state.decision!.seat, A, 'its controller is offered the [2]');
  pick(h, true);
  assert.ok(!ent(h, whale), 'the only opponent nontoken unit here is sacrificed');
  assert.equal(h.q.openMana(A), 0, 'the [2] was paid');
  finishBattle(h);
});

test('Sacrifice Dude: the "Discard me" mode pays its cost and fires the same trigger', () => {
  const h = new Harness(4116);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  giveResources(h, A, 'dark', 4);                       // 2 for the mode, 2 for the trigger
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Sacrifice Dude'), mode: 'discardMe' });
  assert.ok(h.state.players[A]!.bin.includes('Sacrifice Dude'), 'discarded from hand → trashed');
  assert.equal(h.q.openMana(A), 2, 'the discard-me cost was paid');
  assert.equal(h.state.decision!.kind, 'payOrDecline', 'the trash trigger fired from the bin');
  pick(h, true);
  assert.equal(h.q.openMana(A), 0, 'and the [2] was paid');
  // ⚠ R25: during deployment the home region lists only its owner, so "each
  // opponent" reaches nobody — the payoff of this play mode is dead by design.
  assert.ok(!h.log.some(l => l.includes('is sacrificed')), 'no opponent is present in a deployment region (R25)');
});

// ── Scuttling Abomination ────────────────────────────────────────────────

test('Scuttling Abomination: attacking draws a card, then discards one', () => {
  const h = new Harness(4117);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const sc = spawn(h, A, 'Scuttling Abomination');
  toNextBattle(h, A);
  const before = h.state.players[A]!.hand.length;
  h.do({ type: 'declareAttack', seat: A, columns: [[sc]] });
  pass(h); pass(h);                                     // resolve the trigger → draw, then choose
  assert.equal(h.state.decision!.kind, 'payOrDecline');
  assert.equal(h.state.decision!.options.length, before + 1, 'the drawn card is a legal discard ("then")');
  const chosen = String(h.state.decision!.options[0]!.label);
  pick(h, 0);
  assert.equal(h.state.players[A]!.hand.length, before, 'net hand size unchanged');
  assert.ok(h.state.players[A]!.bin.includes(chosen), 'the chosen card was discarded (a trash, R40)');
  finishBattle(h);
});

// ── Spore of Regenesis ───────────────────────────────────────────────────

test('Spore of Regenesis: dying, it erases itself to revive every cost-[1] unit in the bin', () => {
  const h = new Harness(4118);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const spore = spawn(h, A, 'Spore of Regenesis');
  h.state.players[A]!.bin.push('Curio Drifter', 'Unit Token', 'Good Whale');   // cost 1 / 0 / 6
  whiteBox(h, e => { e.destroy(e.entity(spore)!, 'dies'); });
  assert.equal(h.state.decision!.kind, 'payOrDecline');
  pick(h, true);
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Curio Drifter').length, 1, 'the cost-[1] unit is back');
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Unit Token').length, 0, 'cost 0 is not cost [1]');
  assert.ok(h.state.players[A]!.bin.includes('Good Whale'), 'nor is cost 6');
  assert.ok(!h.state.players[A]!.bin.includes('Spore of Regenesis'), 'it erased itself out of the bin');
  assert.ok(h.log.some(l => l.includes('Spore of Regenesis is ERASED')));
});

test('Spore of Regenesis: declining leaves the bin alone', () => {
  const h = new Harness(4119);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const spore = spawn(h, A, 'Spore of Regenesis');
  h.state.players[A]!.bin.push('Curio Drifter');
  whiteBox(h, e => { e.destroy(e.entity(spore)!, 'dies'); });
  pick(h, false);
  assert.deepEqual(h.state.players[A]!.bin.sort(), ['Curio Drifter', 'Spore of Regenesis']);
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Curio Drifter').length, 0);
});

// ── Tilling the Graves ───────────────────────────────────────────────────

test('Tilling the Graves: two bin units back to hand, then a discard', () => {
  const h = new Harness(4120);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const atk = spawn(h, A, 'Unit Token');
  h.state.players[A]!.bin.push('Curio Drifter', 'Bumblecrab', 'Cull');   // two units + a spell
  giveResources(h, A, 'dark', 4);                       // dd/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const handBefore = h.state.players[A]!.hand.length;
  // R64: "two TARGET units in your bin" are declared as the spell is cast
  const bn = h.state.players[A]!.name;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Tilling the Graves') });
  assert.deepEqual(h.state.decision!.options.map(o => o.label),
    [`Curio Drifter (${bn}'s bin)`, `Bumblecrab (${bn}'s bin)`, 'No more targets'],
    'only UNITS in the bin are offered');
  pick(h, { bin: { seat: A, card: 'Curio Drifter' } });
  pick(h, { bin: { seat: A, card: 'Bumblecrab' } });
  pass(h); pass(h);                                     // resolve
  assert.equal(h.state.decision!.kind, 'payOrDecline', 'and "then discard a card" follows');
  const chosen = String(h.state.decision!.options[0]!.label);
  pick(h, 0);
  const hand = h.state.players[A]!.hand;
  assert.ok(hand.includes('Curio Drifter'), 'the first unit came back');
  assert.ok(hand.includes('Bumblecrab'), 'and the second');
  assert.equal(hand.length, handBefore + 2 - 1, 'net +2 recalled, -1 discarded');
  assert.ok(h.state.players[A]!.bin.includes('Cull'), 'the spell in the bin stayed put');
  assert.ok(h.state.players[A]!.bin.includes(chosen), 'the discard is a trash into the bin (R40)');
  finishBattle(h);
});

// ── Wake the Dead ────────────────────────────────────────────────────────

test('Wake the Dead: plays up to two units out of ANY bin, total cost 8 or less', () => {
  const h = new Harness(4121);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  h.state.players[A]!.bin.push('Good Whale');           // cost 6
  h.state.players[D]!.bin.push('Curio Drifter');        // cost 1, in the OPPONENT's bin
  giveResources(h, A, 'dark', 8);                       // ddd/8
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Wake the Dead') });
  pass(h); pass(h);                                     // resolve → the first pick
  assert.equal(h.state.decision!.seat, A);
  pick(h, `${A}:0`);                                    // the cost-6 whale from my own bin
  pick(h, `${D}:0`);                                    // 2 left of the budget: the cost-1 drifter
  const mine = unitsOf(h, A);
  assert.ok(mine.some(u => u.card === 'Good Whale'), 'the whale is in play');
  assert.ok(mine.some(u => u.card === 'Curio Drifter'), 'so is the unit taken from the opponent\'s bin');
  assert.equal(h.state.players[A]!.bin.filter(c => c === 'Good Whale').length, 0, 'it left my bin');
  assert.equal(h.state.players[D]!.bin.length, 0, 'and it left theirs');
  finishBattle(h);
});

test('Wake the Dead: the [8] budget is shared — a second pick over budget is not offered', () => {
  const h = new Harness(4122);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const atk = spawn(h, A, 'Unit Token');
  h.state.players[A]!.bin.push('Good Whale', 'Good Whale');   // 6 + 6 = 12 > 8
  giveResources(h, A, 'dark', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Wake the Dead') });
  pass(h); pass(h);
  pick(h, `${A}:0`);                                    // 2 of the budget left
  assert.equal(h.state.decision, null, 'nothing else fits — no second choice is offered');
  assert.equal(unitsOf(h, A).filter(u => u.card === 'Good Whale').length, 1, 'only one whale came back');
  assert.equal(h.state.players[A]!.bin.filter(c => c === 'Good Whale').length, 1, 'the other stays binned');
  finishBattle(h);
});
