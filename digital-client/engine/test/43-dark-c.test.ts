/* Per-card tests for the dark-c batch (project rule: a test for every card).
 * States are built explicitly (spawn/give/giveResources, explicit bins) so
 * parallel card registration cannot shift assertions; seeds are 4300-4399.
 *
 * Covers: the R40 trash family (Blightwalker's pay-to-recall from the bin,
 * Cthyrian Rector's sacrifice-and-recall in play AND Virus-donated, Murkdrop
 * Distiller's trash → cache with R45 permission, Thoughtripper's
 * pay-[2]-each-opponent-discards, Unrelenting Horror's self-feeding spawn
 * discard), bin manipulation (Collect Remains across BOTH bins, Finality's
 * stack sweep + bin erase, Grox's erase cost and its graft socket,
 * Necromorph's exchange), the counters-on-despawn draw (Entropic Entity),
 * the R47 Wight (Primordial Coalescence) and R38 rot (Spellbind, which also
 * exercises {Modular}), the augment-box activation (Pallid Gorger), and the
 * printed-only / PARKED cards (Its Dark Bubb, Lurking Dread, Rotling,
 * Scholar of the Void, Xzydris).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { getCard, graftCauseIndex, isAugment } from '../src/cards/dsl.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, pick,
  skipHasteStep, spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';
import type { DecisionOption, Entity, Seat } from '../src/types.ts';

// ── helpers ───────────────────────────────────────────────────────────

/** Run raw engine calls against the harness state, absorbing a suspension
 * (a decision produced mid-settle) and keeping the harness log honest. E may
 * REPLACE its state object on a mid-part rollback, so h.state is re-pointed. */
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

/** answer the pending decision with the first option matching `match` */
function pickBy(h: Harness, match: (o: DecisionOption) => boolean): void {
  const dec = h.state.decision!;
  assert.ok(dec, 'a decision was expected');
  const i = dec.options.findIndex(match);
  if (i === -1) throw new Error(`no matching option in [${dec.options.map(o => o.label).join(' | ')}]`);
  h.do({ type: 'decide', seat: dec.seat, choice: i });
}

/** pass priority until the stack drains (two passes resolve each item) */
function drainStack(h: Harness): void {
  let guard = 40;
  while (h.state.stack.length && h.state.phase === 'battle' && !h.state.decision && guard-- > 0) pass(h);
}

const unitsNamed = (h: Harness, name: string): Entity[] =>
  Object.values(h.state.entities).filter(e => e.card === name && e.kind === 'unit');
const bin = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.bin;
const hand = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.hand;
const trashedCards = (h: Harness): unknown[] =>
  h.events.filter(ev => ev.type === 'trashed').map(ev => ev.data!['card']);

// ── Blightwalker ─────────────────────────────────────────────────────────

test('Blightwalker: trashed from hand → pay [2] to recall another unit from your bin', () => {
  const h = new Harness(4301);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'dark', 2);
  const mana = h.q.openMana(P);
  bin(h, P).push('Grox');
  const i = give(h, P, 'Blightwalker');
  whiteBox(h, e => e.discardFromHand(P, i));

  assert.ok(trashedCards(h).includes('Blightwalker'), 'discarding it is a trash (R40)');
  // R64: the bin card is a declared target, chosen as the trigger is put on
  // the stack; the [2] is still paid at resolution.
  assert.ok(h.state.decision, 'its own trigger fires FROM THE BIN and asks for its target');
  pickBy(h, o => o.label.startsWith('Grox'));
  pickBy(h, o => o.label === 'Pay [2]');
  assert.ok(hand(h, P).includes('Grox'), 'the only unit in the bin comes back to hand');
  assert.ok(!bin(h, P).includes('Grox'), 'and leaves the bin');
  assert.equal(h.q.openMana(P), mana - 2, 'the [2] really was paid');
  assert.ok(bin(h, P).includes('Blightwalker'), 'the Blightwalker itself stays in the bin');
});

test('Blightwalker: "another" excludes the copy that was just trashed, and the payment is optional', () => {
  const h = new Harness(4302);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'dark', 2);
  const i = give(h, P, 'Blightwalker');
  whiteBox(h, e => e.discardFromHand(P, i));
  assert.equal(h.state.decision, null, 'the bin holds only me — nothing to recall');

  // now with a real candidate, but declined. R64: "another" is a targeting
  // restriction, so the Blightwalker copies in the bin are never offered.
  bin(h, P).push('Rotling');
  const j = give(h, P, 'Blightwalker');
  whiteBox(h, e => e.discardFromHand(P, j));
  assert.deepEqual(h.state.decision!.options.filter(o => String(o.label).startsWith('Blightwalker')), [],
    '"another": the trashed copy is not a legal target');
  pickBy(h, o => String(o.label).startsWith('Rotling'));
  pickBy(h, o => o.label === 'Decline');
  assert.ok(!hand(h, P).includes('Rotling'), 'declining recalls nothing');
  assert.equal(h.q.openMana(P), 2, 'and pays nothing');
});

// ── Collect Remains ──────────────────────────────────────────────────────

test('Collect Remains: takes a card out of EITHER bin into your hand', () => {
  const h = new Harness(4303);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Grox');
  giveResources(h, A, 'dark', 2);
  bin(h, A).push('Rotling');
  bin(h, D).push('Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  // R64: "target card in a bin" is declared at cast — either bin, both offered
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Collect Remains') });
  assert.equal(h.state.decision!.seat, A);
  assert.equal(h.state.decision!.options.length, 2, 'both bins are on offer');
  pickBy(h, o => String(o.label).startsWith('Good Whale'));
  pass(h); pass(h);                                        // resolve
  assert.ok(hand(h, A).includes('Good Whale'), "the enemy's card comes to MY hand");
  assert.ok(!bin(h, D).includes('Good Whale'));
  // ⚠ approximation: "Erase me" is the spell being binned normally instead
  assert.ok(bin(h, A).includes('Collect Remains'), '⚠ "Erase me" approximated as a normal bin');
  finishBattle(h);
});

// ── Cthyrian Rector ──────────────────────────────────────────────────────

test('Cthyrian Rector: you trash a card → it sacrifices itself and recalls that card', () => {
  const h = new Harness(4304);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const rector = spawn(h, P, 'Cthyrian Rector');
  const i = give(h, P, 'Good Whale');
  whiteBox(h, e => e.discardFromHand(P, i));
  assert.ok(!ent(h, rector), 'it sacrificed itself');
  assert.ok(hand(h, P).includes('Good Whale'), 'and the trashed card came back to hand');
  assert.ok(!bin(h, P).includes('Good Whale'), 'out of the bin again');
  assert.ok(bin(h, P).includes('Cthyrian Rector'), 'the sacrifice put the Rector in the bin');
});

test('Cthyrian Rector: Virus-donated, "me" is the HOST and "you" is the host\'s controller', () => {
  const h = new Harness(4305);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const host = spawn(h, D, 'Good Whale');
  whiteBox(h, e => e.attachMod(e.entity(host)!, 'Cthyrian Rector', A, 'augment'));
  assert.equal(ent(h, host)!.mods.length, 1, 'the Virus is attached');
  hand(h, D).length = 0;
  hand(h, D).push('Rotling');
  whiteBox(h, e => e.discardFromHand(D, 0));
  assert.ok(!ent(h, host), "the HOST is what gets sacrificed");
  assert.ok(hand(h, D).includes('Rotling'), "and the host controller's card is recalled");
});

// ── Entropic Entity ──────────────────────────────────────────────────────

test('Entropic Entity: draws when a unit WITH COUNTERS despawns — once per turn', () => {
  const h = new Harness(4306);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'Entropic Entity');
  const plain = spawn(h, P, 'Rotling');
  const marked = spawn(h, P, 'Good Whale');
  const marked2 = spawn(h, P, 'Grox');
  whiteBox(h, e => { e.addCounters(e.entity(marked)!, 1); e.addCounters(e.entity(marked2)!, 2); });

  let n = hand(h, P).length;
  whiteBox(h, e => e.destroy(e.entity(plain)!, 'is sacrificed'));
  assert.equal(hand(h, P).length, n, 'a counterless despawn draws nothing');

  n = hand(h, P).length;
  whiteBox(h, e => e.destroy(e.entity(marked)!, 'is sacrificed'));
  assert.equal(hand(h, P).length, n + 1, 'a counter-carrying despawn draws a card');

  n = hand(h, P).length;
  whiteBox(h, e => e.destroy(e.entity(marked2)!, 'is sacrificed'));
  assert.equal(hand(h, P).length, n, '[Switch1] is bounded — only once per turn (R9)');
});

// ── Finality ─────────────────────────────────────────────────────────────

test('Finality: negates every other effect on the stack and erases both bins', () => {
  const h = new Harness(4307);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Grox');
  giveResources(h, A, 'dark', 7);                          // dd/2 + dd/5
  bin(h, A).push('Rotling');
  bin(h, D).push('Good Whale');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Collect Remains') });
  pickBy(h, o => String(o.label).startsWith('Good Whale'));  // R64: targeted at cast
  pass(h);                                                 // the responder declines
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Finality') });
  assert.equal(h.state.stack.length, 2);
  pass(h); pass(h);                                        // Finality resolves first
  assert.equal(h.state.stack.length, 0, 'R68: the negated effect left the stack at once');
  assert.ok(!hand(h, A).includes('Good Whale'), 'the negated Collect Remains did nothing');
  assert.deepEqual(bin(h, D), [], 'the enemy bin is erased');
  // ⚠ R68 ORDERING, needs a human ruling. Negation now bins the card DURING
  // the negation, so by the time Finality's second sentence runs, Collect
  // Remains is sitting in A's bin — and is erased with everything else.
  // Before R68 it reached the bin a whole priority round later and survived.
  // Finality itself is binned by afterParts, AFTER the erase, as printed.
  assert.deepEqual(bin(h, A), ['Finality'],
    'the card Finality just negated was erased with the rest of the bin (see R68 ⚠)');
  drainStack(h);
  assert.deepEqual(bin(h, A), ['Finality'], 'and nothing else arrives afterwards');
  finishBattle(h);
});

// ── Grox ─────────────────────────────────────────────────────────────────

test('Grox: R49 — the printed [Battle] marker is enforced at ACTIVATION', () => {
  const h = new Harness(4330);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const grox = spawn(h, P, 'Grox');
  bin(h, P).push('Rotling', 'Xzydris', 'Good Whale');
  assert.throws(
    () => h.do({ type: 'activateAbility', seat: P, entityId: grox, abilityIndex: 0 }),
    /can only be activated during battle/);
  assert.ok(!h.legal(P).some(a => a.type === 'activateAbility' && a.entityId === grox),
    'and it is not offered during deployment');
  assert.deepEqual(bin(h, P), ['Rotling', 'Xzydris', 'Good Whale'], 'nothing was erased');
});

test('Grox: the activation erases two chosen cards from your bin', () => {
  const h = new Harness(4308);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const D = 1 - P;
  const grox = spawn(h, P, 'Grox');
  const raider = spawn(h, D, 'Unit Token');
  bin(h, P).push('Rotling', 'Xzydris', 'Good Whale');
  // P DEFENDS, so the battle happens in P's region — where Grox is (R12)
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  pass(h);                                                    // attacker passes → P acts
  h.do({ type: 'activateAbility', seat: P, entityId: grox, abilityIndex: 0 });
  // R64 UN-PARKED: "Erase two cards in your bin:" is a bracketed CAST COST —
  // chosen and paid on the way to the stack, not at resolution
  pickBy(h, o => o.label === 'Rotling');
  pickBy(h, o => o.label === 'Xzydris');
  assert.deepEqual(bin(h, P), ['Good Whale'], 'exactly the two chosen cards are gone');
  assert.equal(trashedCards(h).filter(c => c === 'Rotling').length, 0, 'erasing is not trashing (R40)');
  drainStack(h);
  finishBattle(h);
});

test('Grox: an unpayable erase makes the activation illegal — no free ride for a rider', () => {
  // The consequence the old resolution-time approximation flagged and could
  // not fix: "grafted riders resolve even when the bin turns out too small to
  // pay". As a real CastCost the whole activation is refused instead.
  const h = new Harness(4331);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const D = 1 - P;
  const grox = spawn(h, P, 'Grox');
  const raider = spawn(h, D, 'Unit Token');
  giveResources(h, P, 'dark', 3);
  bin(h, P).push('Rotling');                                  // one card — not two
  h.do({ type: 'graft', seat: P, from: 'hand', index: give(h, P, 'Primordial Coalescence'), hostId: grox, position: 0 });
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  pass(h);
  assert.ok(!h.legal(P).some(a => a.type === 'activateAbility' && a.entityId === grox),
    'unpayable [Erase two cards] → not offered');
  assert.throws(() => h.do({ type: 'activateAbility', seat: P, entityId: grox, abilityIndex: 0 }),
    /nothing it can be used on/);
  assert.deepEqual(bin(h, P), ['Rotling'], 'nothing erased');
  assert.equal(unitsNamed(h, 'Wraith').length, 0, 'and the rider never resolved');
  finishBattle(h);
});

test('Grox: the bare [Switch] is a graft SOCKET — a grafted rider resolves with it', () => {
  const h = new Harness(4309);
  assert.equal(graftCauseIndex('Grox'), 0, 'its activated ability is the graft cause');
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const D = 1 - P;
  const grox = spawn(h, P, 'Grox');
  const raider = spawn(h, D, 'Unit Token');
  giveResources(h, P, 'dark', 3);
  bin(h, P).push('Rotling', 'Xzydris');
  h.do({ type: 'graft', seat: P, from: 'hand', index: give(h, P, 'Primordial Coalescence'), hostId: grox, position: 0 });
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  pass(h);                                                    // attacker passes → P acts
  h.do({ type: 'activateAbility', seat: P, entityId: grox, abilityIndex: 0 });
  // R64: the erase is a bracketed CAST COST now, so both cards are chosen and
  // erased in the cast window — before the socket (and its rider) is on the
  // stack, and before anyone can respond
  pickBy(h, o => o.label === 'Rotling');
  pickBy(h, o => o.label === 'Xzydris');
  assert.deepEqual(bin(h, P), [], 'both cards erased as the cost');
  drainStack(h);
  assert.equal(unitsNamed(h, 'Wraith').length, 3, 'and the grafted rider made its three Wraiths');
  assert.equal(h.q.rot(P), 2);
  finishBattle(h);
});

// ── Its Dark Bubb ────────────────────────────────────────────────────────

test('Its Dark Bubb: a printed {Inverted} 4/6 body', () => {
  const h = new Harness(4310);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const bubb = spawn(h, P, 'Its Dark Bubb');
  assert.deepEqual(effStats(h, bubb), [4, 6]);
  assert.ok(ownAttrs(h, bubb).has('Inverted'), 'the attribute is carried');
});

test('Its Dark Bubb: {Inverted} actually inverting stat changes', { todo: true }, () => {
  // PARKED: inversion is effStats stat layer 5, which the engine does not have
  // ("layer 5 (Inverted), 6 (Unaware) go here"). Reality Bender (batch-earth-b)
  // is parked on the same seam. The attribute is present; -1/+2 does not
  // become +1/-2.
});

// ── Lurking Dread ────────────────────────────────────────────────────────

test('Lurking Dread: plays as a printed 8/8', () => {
  const h = new Harness(4311);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  assert.deepEqual(effStats(h, spawn(h, P, 'Lurking Dread')), [8, 8]);
});

test('Lurking Dread: R51 — after combat, sacrifice two nontokens to put it into play from your BIN', () => {
  const h = new Harness(4331);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const a = spawn(h, D, 'Grox');                              // two nontoken units of D's,
  const b = spawn(h, D, 'Rotling');                           // in the battle region (D's home)
  bin(h, D).push('Lurking Dread');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                           // → after-combat
  drainStack(h);                                              // the zone trigger resolves
  pickBy(h, o => o.card === 'Grox');
  pickBy(h, o => o.card === 'Rotling');
  assert.ok(!ent(h, a) && !ent(h, b), 'both nontoken units were sacrificed');
  assert.ok(!bin(h, D).includes('Lurking Dread'), 'it left the bin');
  assert.equal(unitsNamed(h, 'Lurking Dread').length, 1, 'and is in play');
  finishBattle(h);
});

test('Lurking Dread: R51 — the same trigger reaches it in the CACHE', () => {
  const h = new Harness(4332);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Grox');
  spawn(h, D, 'Rotling');
  whiteBox(h, e => e.cacheCard(D, 'Lurking Dread', 'hand'));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  drainStack(h);
  pickBy(h, o => o.card === 'Grox');
  pickBy(h, o => o.card === 'Rotling');
  assert.equal((h.state.players[D]!.cache ?? []).length, 0, 'it left the cache');
  assert.equal(unitsNamed(h, 'Lurking Dread').length, 1, 'and is in play');
  finishBattle(h);
});

test('Lurking Dread: "you may" — declining leaves it in the bin and pays nothing', () => {
  const h = new Harness(4333);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  const a = spawn(h, D, 'Grox');
  spawn(h, D, 'Rotling');
  bin(h, D).push('Lurking Dread');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  drainStack(h);
  pickBy(h, o => o.label === 'Decline');
  assert.ok(ent(h, a), 'nothing was sacrificed');
  assert.ok(bin(h, D).includes('Lurking Dread'), 'and it stays in the bin');
  finishBattle(h);
});

test('Lurking Dread: with fewer than two nontoken units the offer is not even made', () => {
  const h = new Harness(4334);
  toDeployment(h);
  const A = h.state.initiative, D = 1 - A;
  const atk = spawn(h, A, 'Unit Token');
  spawn(h, D, 'Grox');                                        // only one
  bin(h, D).push('Lurking Dread');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  drainStack(h);
  assert.equal(h.state.decision, null);
  assert.ok(bin(h, D).includes('Lurking Dread'));
  assert.ok(h.log.some(l => l.includes('fewer than two nontoken units')));
  finishBattle(h);
});

// ── Murkdrop Distiller ───────────────────────────────────────────────────

test('Murkdrop Distiller: a trashed card may be cached and played this turn (R41/R45)', () => {
  const h = new Harness(4312);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'Murkdrop Distiller');
  const i = give(h, P, 'Good Whale');
  whiteBox(h, e => e.discardFromHand(P, i));
  assert.ok(h.state.decision, 'it offers the cache');
  pickBy(h, o => String(o.label).startsWith('Cache'));
  const cache = h.q.cache(P);
  assert.equal(cache.length, 1);
  assert.equal(cache[0]!.card, 'Good Whale', 'the card LEFT the bin for the cache');
  assert.ok(!bin(h, P).includes('Good Whale'));
  assert.equal(h.q.cachePermission(P, 0), 'glimpse', 'playable until end of turn, ignoring affinity');

  // [once]: bounded per turn (R9)
  const j = give(h, P, 'Rotling');
  whiteBox(h, e => e.discardFromHand(P, j));
  assert.equal(h.state.decision, null, '[once] — it does not offer again this turn');
  assert.ok(bin(h, P).includes('Rotling'));
});

// ── Necromorph ───────────────────────────────────────────────────────────

test('Necromorph: exchanges a unit in play for a cheaper one in ITS controller\'s bin', () => {
  const h = new Harness(4313);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Grox');
  const victim = spawn(h, D, 'Good Whale');                // cost 6
  bin(h, D).push('Blightwalker', 'Lurking Dread');         // cost 3 (legal) / 8 (too dear)
  giveResources(h, A, 'dark', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Necromorph') });
  pick(h, { unit: victim });                               // cast-time target
  // R64: the bin half is a cast-time target too, and only the affordable one
  // in the VICTIM's bin is offered
  assert.deepEqual(h.state.decision!.options.map(o => o.label),
    [`Blightwalker (${h.state.players[D]!.name}'s bin)`],
    'only the cost-3 unit in D\'s bin is a legal exchange for a cost-6 Whale');
  pick(h, { bin: { seat: D, card: 'Blightwalker' } });
  pass(h); pass(h);                                        // resolve
  assert.ok(!ent(h, victim), 'the unit in play is gone');
  const fresh = unitsOf(h, D).find(u => u.card === 'Blightwalker');
  assert.ok(fresh, 'and its replacement arrived under the SAME controller');
  assert.equal(fresh!.region, h.q.homeRegion(D));
  assert.ok(bin(h, D).includes('Good Whale'), 'the exchanged-out unit goes to the bin');
  assert.ok(bin(h, D).includes('Lurking Dread'), 'a costlier bin unit was never eligible');
  assert.ok(trashedCards(h).includes('Good Whale'), 'entering the bin from play is a trash (R40)');
  drainStack(h);
  finishBattle(h);
});

// ── Pallid Gorger ────────────────────────────────────────────────────────

test('Pallid Gorger: discard a card → +2/+2 until regroup (and the discard is a trash)', () => {
  const h = new Harness(4314);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const pg = spawn(h, P, 'Pallid Gorger');
  hand(h, P).length = 0;
  give(h, P, 'Good Whale');
  h.do({ type: 'activateAbility', seat: P, entityId: pg, abilityIndex: 0, via: 'augment' });
  pickBy(h, o => o.label === 'Discard Good Whale');
  assert.deepEqual(effStats(h, pg), [3, 3], '1/1 + 2/+2');
  assert.ok(trashedCards(h).includes('Good Whale'), 'discarding is a trash (R40)');
});

test('Pallid Gorger: donated as an augment, "I" is the host and the host pays', () => {
  const h = new Harness(4315);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const host = spawn(h, P, 'Good Whale');
  const fodder = spawn(h, P, 'Rotling');
  let mod = 0;
  whiteBox(h, e => { mod = e.attachMod(e.entity(host)!, 'Pallid Gorger', P, 'augment').id; });
  hand(h, P).length = 0;
  h.do({ type: 'activateAbility', seat: P, entityId: host, abilityIndex: 0, via: { mod } });
  pickBy(h, o => o.label === 'Sacrifice Rotling');
  assert.ok(!ent(h, fodder), 'the nontoken unit was sacrificed instead');
  assert.deepEqual(effStats(h, host), [9, 7], 'the HOST gained +2/+2 (7/5 → 9/7)');
});

// ── Primordial Coalescence ───────────────────────────────────────────────

test('Primordial Coalescence: three Wraiths (= Wights, R47) and 2 rot (R38)', () => {
  const h = new Harness(4316);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'dark', 3);
  h.do({ type: 'playCard', seat: P, handIndex: give(h, P, 'Primordial Coalescence') });
  const wights = unitsNamed(h, 'Wraith');
  assert.equal(wights.length, 3, 'three token bodies');
  assert.equal(wights[0]!.token, true);
  assert.deepEqual(effStats(h, wights[0]!.id), [3, 3], 'each a real 3/3 (R71)');
  assert.equal(wights[0]!.region, h.q.homeRegion(P), 'created units arrive at home (R28)');
  assert.equal(h.q.rot(P), 2, 'and the downside is 2 rot');

  // R38: that rot bites at the start of the next deployment
  const life = h.state.players[P]!.life;
  toNextBattle(h, P);
  finishBattle(h);
  assert.equal(h.state.players[P]!.life, life - 2, 'rot deals its damage at the start of deployment');
});

// ── Rotling ──────────────────────────────────────────────────────────────

test('Rotling: plays as a printed 2/1', () => {
  const h = new Harness(4317);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  assert.deepEqual(effStats(h, spawn(h, P, 'Rotling')), [2, 1]);
});

test('Rotling: "when I leave your bin, pay [1] to draw and gain 1 rot"', { todo: true }, () => {
  // STILL PARKED, on the half R51 did not solve. R51 gave bin-resident cards a
  // trigger SURFACE (`zone: 'bin'`, used by Lurking Dread, Xzydris and
  // Inexorable Miasma) — but nothing emits "a card LEFT a bin", and there is no
  // choke point to emit it from: bins are spliced directly by a dozen card
  // effects (exhume, recall-from-bin, erase-from-bin, graft/augment-from-bin,
  // cacheFromBin, {Modular} mod payment) as well as by engine code. Wiring it
  // means routing every one of those through an E.takeFromBin() helper — a
  // cross-cutting change across batch files owned by other lanes.
});

// ── Scholar of the Void ──────────────────────────────────────────────────

test('Scholar of the Void: plays and augments crash-free as a {Haste} 0/2', () => {
  const h = new Harness(4318);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const sv = spawn(h, P, 'Scholar of the Void');
  assert.deepEqual(effStats(h, sv), [0, 2]);
  assert.equal(getCard('Scholar of the Void').timing, 'haste');
  assert.ok(isAugment('Scholar of the Void'), 'still recognised as an augment');
  const host = spawn(h, P, 'Good Whale');
  whiteBox(h, e => e.attachMod(e.entity(host)!, 'Scholar of the Void', P, 'augment'));
  assert.equal(ent(h, host)!.mods.length, 1, 'attaching the inert augment does nothing and crashes nothing');
});

test('Scholar of the Void: R50 — the start-of-deployment trigger fires (transform still parked)', () => {
  const h = new Harness(4337);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'Scholar of the Void');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  const handBefore = hand(h, P).length;
  finishBattle(h);
  assert.equal(h.state.phase, 'deploy');
  assert.ok(h.log.some(l => l.includes('Beyond, Codex Incarnate')),
    'R50: the event reaches the card and it says exactly what is missing');
  assert.equal(hand(h, P).length, handBefore,
    'and it does NOT discard your hand for a transform that cannot happen');
});

test('Scholar of the Void: still parked — transform machinery and the target card', { todo: true }, () => {
  // HALF PARKED. R50 gave it the start-of-deployment event and the trigger
  // fires. What is still missing: (1) TRANSFORM machinery — nothing in the
  // engine replaces one card's identity with another's; (2) the target itself,
  // "Beyond, Codex Incarnate", which is not in printed.json at all.
});

// ── Spellbind ────────────────────────────────────────────────────────────

test('Spellbind: {Modular} carrier — the applied mod rides along, and you gain the rot', () => {
  const h = new Harness(4319);
  toDeployment(h);
  const A = h.state.deployPlayer!;
  const atk = spawn(h, A, 'Grox');
  giveResources(h, A, 'dark', 4);                          // d/1 + the mod's d/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  hand(h, A).length = 0;
  give(h, A, 'Primordial Coalescence');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Spellbind') });
  assert.ok(h.state.decision, '{Modular} asks for mods as the card is played (R35 cast-time cost)');
  pickBy(h, o => String(o.label).startsWith('Primordial Coalescence'));
  assert.ok(h.state.stack[0]!.label.includes('Primordial Coalescence'), 'the mod rides on the stack with it');
  pass(h); pass(h);
  assert.equal(h.q.rot(A), 3, "Spellbind's own rot plus the rider's two");
  assert.equal(unitsNamed(h, 'Wraith').length, 3, "and the rider's three Wraiths");
  assert.ok(bin(h, A).includes('Primordial Coalescence'), 'the mod leaves with the spell, from the stack');
  assert.ok(!trashedCards(h).includes('Spellbind'), 'a resolved spell is binned, never trashed (R40)');
  finishBattle(h);
});

// ── Thoughtripper ────────────────────────────────────────────────────────

test('Thoughtripper: dying in combat is a trash — pay [2] and each opponent discards', () => {
  const h = new Harness(4320);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const tr = spawn(h, A, 'Thoughtripper');                 // 1/1
  const blk = spawn(h, D, 'Good Whale');                   // 7/5
  giveResources(h, A, 'dark', 2);
  toNextBattle(h, A);
  hand(h, D).length = 0;                                   // exactly one card to lose
  hand(h, D).push('Rotling');
  h.do({ type: 'declareAttack', seat: A, columns: [[tr]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [blk] } });
  pass(h); pass(h);                                        // combat damage
  assert.ok(!ent(h, tr), 'it died…');
  assert.ok(trashedCards(h).includes('Thoughtripper'), '…which trashes it (R40)');
  assert.ok(h.state.decision, 'and the trigger fires from the bin, between damage sub-steps (R31)');
  pickBy(h, o => o.label === 'Pay [2]');
  assert.deepEqual(hand(h, D), [], 'the only opponent present discarded their card');
  assert.ok(bin(h, D).includes('Rotling'));
  assert.equal(h.q.openMana(A), 0, 'the [2] was paid');
  finishBattle(h);
});

test('Thoughtripper: R25 — trashed outside battle, no opponent is present to discard', () => {
  const h = new Harness(4321);
  toDeployment(h);
  const P = h.state.deployPlayer!, O = (1 - P) as Seat;
  giveResources(h, P, 'dark', 2);
  hand(h, O).push('Rotling');
  const i = give(h, P, 'Thoughtripper');
  whiteBox(h, e => e.discardFromHand(P, i));
  assert.equal(h.state.decision, null, 'a home region lists only its owner — nobody to hit');
  assert.ok(h.log.some(l => l.includes('no opponent here')));
  assert.ok(hand(h, O).includes('Rotling'));
});

// ── Unrelenting Horror ───────────────────────────────────────────────────

test('Unrelenting Horror: its own spawn discard is a trash, so it pumps itself', () => {
  const h = new Harness(4322);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  hand(h, P).length = 0;
  hand(h, P).push('Good Whale');
  let uh = 0;
  whiteBox(h, e => { uh = e.spawnUnit(P, 'Unrelenting Horror', e.homeRegion(P)).id; });
  assert.deepEqual(hand(h, P), [], 'the spawn trigger discarded the only card');
  assert.ok(trashedCards(h).includes('Good Whale'));
  assert.deepEqual(effStats(h, uh), [5, 5], '3/3 +2/+2 until regroup');
  assert.ok(ownAttrs(h, uh).has('Piercing'), 'and piercing until regroup');

  // [Switch1] is bounded: a second trash this turn does nothing more
  hand(h, P).push('Rotling');
  whiteBox(h, e => e.discardFromHand(P, 0));
  assert.deepEqual(effStats(h, uh), [5, 5], 'bounded — once per turn (R9)');
});

// ── Xzydris ──────────────────────────────────────────────────────────────

test('Xzydris: plays as a printed 2/1', () => {
  const h = new Harness(4323);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  assert.deepEqual(effStats(h, spawn(h, P, 'Xzydris')), [2, 1]);
});

test('Xzydris: R50/R51 — at the start of deployment, augment a Wraith to recall it from the bin', () => {
  const h = new Harness(4335);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const host = spawn(h, P, 'Grox');
  bin(h, P).push('Xzydris');
  // roll into the NEXT start of deployment
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  finishBattle(h);
  assert.equal(h.state.phase, 'deploy');
  assert.ok(h.state.decision, 'the bin-resident start-of-deployment trigger asked');
  assert.equal(h.state.decision!.seat, P, '"YOUR bin" — the bin owner decides');
  pickBy(h, o => o.card === 'Grox');
  const mods = ent(h, host)!.mods.map(m => ent(h, m)!);
  assert.equal(mods.length, 1);
  assert.equal(mods[0]!.card, 'Wraith', 'R47: the Wraith token, applied as an augment');
  assert.equal(mods[0]!.appliedAs, 'augment');
  assert.ok(!bin(h, P).includes('Xzydris'), 'it left the bin');
  assert.ok(hand(h, P).includes('Xzydris'), 'recalled to hand');
});

test('Xzydris: declining leaves it in the bin and creates no Wraith', () => {
  const h = new Harness(4336);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const host = spawn(h, P, 'Grox');
  bin(h, P).push('Xzydris');
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  finishBattle(h);
  pickBy(h, o => o.label.startsWith('Decline'));
  assert.equal(ent(h, host)!.mods.length, 0, 'no Wraith');
  assert.ok(bin(h, P).includes('Xzydris'), 'still in the bin');
});
