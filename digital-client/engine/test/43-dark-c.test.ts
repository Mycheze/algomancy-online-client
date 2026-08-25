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
 * printed-only / PARKED cards (Its Dark Bubb, Lurking Dread,
 * Xzydris), Rotling's R124 'leftBin' trigger, and R101's TRANSFORM (Scholar of the Void turning over into
 * Beyond, Codex Incarnate — playtest ledger #24).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import { getCard, graftCauseIndex, isAugment } from '../src/cards/dsl.ts';
import { DECK_LIST, draftDeckList } from '../src/cards/registry.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, pick,
  skipHasteStep, spawn, toDeployment, toNextBattle, unitsOf,
} from './util.ts';
import type { DecisionOption, Entity, EntityId, Seat } from '../src/types.ts';

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
const erasedCards = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.erased ?? [];
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

// R137, FAMILY A (the six cards whose OWN "when I am trashed" trigger died
// with them whenever they died {Unstable}): Afflicting Anima, Blightwalker,
// Dropslime, Maw of Despair, Nothyr, Thoughtripper. Dropslime is pinned by the
// playtest-#93 fixture in 42-dark-b; this is the second witness, and it also
// shows the ⚠ consequence: unlike a trash from HAND, this card cannot leave
// itself in the bin to be recurred later — the sweep takes it.
test('R137: Blightwalker dying while {Unstable} fires its own "when I am trashed" trigger', () => {
  const h = new Harness(4392);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'dark', 2);
  bin(h, P).push('Grox');
  const bw = spawn(h, P, 'Blightwalker');
  whiteBox(h, e => {
    e.entity(bw)!.unstable = true;                         // the R96 until-regroup STAMP (Abyssal Evocation)
    e.destroy(e.entity(bw)!, 'dies');
  });
  assert.ok(trashedCards(h).includes('Blightwalker'),
    'R137: dying Unstable is a trash — before this ruling nothing fired at all');
  assert.ok(h.state.decision, 'and its own trigger asks for the bin card to recall');
  pickBy(h, o => o.label.startsWith('Grox'));
  pickBy(h, o => o.label === 'Pay [2]');
  assert.ok(hand(h, P).includes('Grox'), 'the recall happened');
  assert.ok(!bin(h, P).includes('Blightwalker'),
    'and the Blightwalker itself does NOT rest in the bin — Unstable swept it out');
  assert.ok(erasedCards(h, P).includes('Blightwalker'), 'it is in the erased pile (R65)');
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
  // restriction. R131: it excludes exactly ONE SLOT — the copy that just
  // landed — and NOT every card named Blightwalker; the earlier copy from the
  // first discard above is a different entity and is offered. (This assertion
  // used to read "no Blightwalker is offered", which was the name-comparison
  // bug: two copies in a bin are two things, and each is "another".)
  bin(h, P).push('Rotling');
  const j = give(h, P, 'Blightwalker');
  whiteBox(h, e => e.discardFromHand(P, j));
  assert.equal(bin(h, P).filter(c => c === 'Blightwalker').length, 2, 'two copies in the bin');
  assert.equal(h.state.decision!.options.filter(o => String(o.label).startsWith('Blightwalker')).length, 1,
    '"another": the trashed copy is excluded — and only it');
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
  // "Erase me." (CARD-TODO #15) — a bin-recursion spell that takes itself out
  // of the game. Fully asserted in 89-self-erase.
  assert.ok(!bin(h, A).includes('Collect Remains'), '"Erase me": not in a bin');
  assert.ok((h.state.players[A]!.erased ?? []).includes('Collect Remains'), 'the erased pile');
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

// R137 HAZARD 1. The Rector reaches for the trashed card IN THE BIN, and an
// Unstable card is in a bin only for the trigger window. The answer is NOT new
// and is not invented here: the TOKEN path has faced exactly this since R69,
// and the Rector already reads `bin.lastIndexOf(name)` and says so when the
// card is gone. So the sacrifice is paid (it is a CAST COST — R73 — settled
// on the way to the stack, before any bin lookup happens) and the recall
// finds nothing. Deliberate: the alternative is either refunding a cost after
// the fact, which the engine has no mechanism for and R73 exists to avoid, or
// recalling out of the ERASED PILE, which must never become reachable — that
// pile is how a card leaves the game permanently (R65).
test('R137 hazard: an Unstable death trashes, the Rector pays, and finds nothing — the erased pile stays unreachable', () => {
  const h = new Harness(4390);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const rector = spawn(h, P, 'Cthyrian Rector');
  const victim = spawn(h, P, 'Good Whale');
  whiteBox(h, e => {
    e.entity(victim)!.unstable = true;                     // the R96 until-regroup STAMP (Abyssal Evocation)
    e.destroy(e.entity(victim)!, 'dies');
  });
  assert.ok(trashedCards(h).includes('Good Whale'), 'R137: the Unstable death IS a trash');
  assert.ok(!ent(h, rector), 'so the Rector triggered and paid its sacrifice');
  assert.ok(bin(h, P).includes('Cthyrian Rector'), 'which put the Rector itself in the bin');
  assert.ok(!hand(h, P).includes('Good Whale'), 'but there was nothing left to recall');
  assert.ok(!bin(h, P).includes('Good Whale'), 'the sweep had already taken it out of the bin');
  assert.ok(erasedCards(h, P).includes('Good Whale'), 'it is in the erased pile — out of the game (R65)');
  assert.ok(h.log.some(l => l.includes('Cthyrian Rector: Good Whale is no longer in the bin')),
    'and the card says so out loud, exactly as it already did for a dying TOKEN');
});

// ── R140 — THE INNOCENT COPY ─────────────────────────────────────────────
//
// The fixture the whole ruling is about, and it takes all three of the cards
// below in exactly this shape:
//
//   · an INNOCENT copy of some card name is already resting in the bin —
//     trashed ages ago, nobody's business, recurrable by its owner;
//   · a SECOND copy of that same name is trashed now and swept straight back
//     out of the bin (a dying token, or R137's {Unstable} death);
//   · the responder resolves, and the only correct answer is NEITHER. The copy
//     it saw is gone; the copy still there is not the one it saw.
//
// The bug R140 fixes is that `bin.lastIndexOf(name)` says "the innocent one".
// A bin holds bare card NAMES, so that search cannot tell them apart — which
// is exactly why R131 stamped `binNth` on the event in the first place.
test('R140: the Rector does NOT recall an innocent older copy when the trashed one was swept', () => {
  const h = new Harness(4392);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  bin(h, P).push('Good Whale');                            // the INNOCENT copy, trashed long ago
  const rector = spawn(h, P, 'Cthyrian Rector');
  const victim = spawn(h, P, 'Good Whale');
  whiteBox(h, e => {
    e.entity(victim)!.unstable = true;                     // R96 stamp → R137: bin, trash, sweep
    e.destroy(e.entity(victim)!, 'dies');
  });
  assert.ok(!ent(h, rector), 'the Rector triggered and paid its sacrifice (a cast cost, R73)');
  assert.deepEqual(hand(h, P).filter(c => c === 'Good Whale'), [],
    'and recalled NOTHING — the copy it saw trashed is in the erased pile, out of the game');
  assert.deepEqual(bin(h, P).filter(c => c === 'Good Whale'), ['Good Whale'],
    'the innocent copy is untouched, still exactly one, still in the bin');
  assert.ok(h.log.some(l => l.includes('Cthyrian Rector: Good Whale is no longer in the bin')),
    'and it says the copy is gone rather than quietly taking the other one');
});

test('R140: the Distiller does NOT cache an innocent older copy, and refunds its [once] on that miss', () => {
  const h = new Harness(4393);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  bin(h, P).push('Good Whale');                            // the INNOCENT copy
  spawn(h, P, 'Murkdrop Distiller');
  const victim = spawn(h, P, 'Good Whale');
  whiteBox(h, e => {
    e.entity(victim)!.unstable = true;
    e.destroy(e.entity(victim)!, 'dies');
  });
  assert.equal(h.state.decision, null,
    'no cache is offered: the copy it saw trashed is gone, and the other copy is not it');
  assert.deepEqual(h.q.cache(P).map(c => c.card), [], 'nothing was cached');
  assert.deepEqual(bin(h, P).filter(c => c === 'Good Whale'), ['Good Whale'],
    'the innocent copy never left the bin');
  assert.ok(h.log.some(l => l.includes('Murkdrop Distiller: Good Whale is not in your bin')));
  // R108/R113: a wrong-copy miss is "no offer could be made", so the [once]
  // survives it exactly as an empty-bin miss does
  const j = give(h, P, 'Rotling');
  whiteBox(h, e => e.discardFromHand(P, j));
  assert.ok(h.state.decision, 'the [once] was refunded — a real trash later this turn still gets the offer');
  pickBy(h, o => String(o.label).startsWith('Cache'));
  assert.equal(h.q.cache(P)[0]!.card, 'Rotling');
});

// R140, the engine half: the state-based sweep that CREATES the window above
// had the same name-search in it. `destroy` pushes the card, fires 'died' and
// 'trashed' (both of which only QUEUE — nothing resolves yet), then sweeps; the
// sweep took `bin.lastIndexOf(name)`, which is the copy it pushed only by luck
// of ordering. It knows exactly where it pushed, so it says so, and a named
// slot that no longer holds that card means GONE — never a fall back to the
// search, because falling back is the whole bug.
test('R140: eraseFromZone can be told WHICH bin slot to take, and a mismatch means gone', () => {
  const h = new Harness(4394);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  bin(h, P).push('Grox', 'Rotling', 'Grox');
  whiteBox(h, e => e.eraseFromZone(P, 'Grox', 'bin', 'Grox is ERASED (test).', { index: 0 }));
  assert.deepEqual(bin(h, P), ['Rotling', 'Grox'],
    'the NAMED slot went — not "the last copy of that name", which is a different card');
  whiteBox(h, e => e.eraseFromZone(P, 'Grox', 'bin', 'Grox is ERASED (test).', { index: 0 }));
  assert.deepEqual(bin(h, P), ['Rotling', 'Grox'],
    'slot 0 holds Rotling now, so the erase is a no-op: a mismatch is GONE, not a name search');
  whiteBox(h, e => e.eraseFromZone(P, 'Grox', 'bin', 'Grox is ERASED (test).'));
  assert.deepEqual(bin(h, P), ['Rotling'],
    'and with no slot named it still searches by name, for the callers that have no handle');
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
  // an INERT filler on purpose: a binned Rotling really triggers on the
  // erase now (R124), and this test is about R68 negation, not about him
  bin(h, A).push('Tempest Wrangler');
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
  // inert filler on purpose: a binned Rotling really triggers on the erase
  // now (R124), and this test is about the graft socket, not about him
  bin(h, P).push('Tempest Wrangler', 'Xzydris');
  h.do({ type: 'graft', seat: P, from: 'hand', index: give(h, P, 'Primordial Coalescence'), hostId: grox, position: 0 });
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  pass(h);                                                    // attacker passes → P acts
  h.do({ type: 'activateAbility', seat: P, entityId: grox, abilityIndex: 0 });
  // R64: the erase is a bracketed CAST COST now, so both cards are chosen and
  // erased in the cast window — before the socket (and its rider) is on the
  // stack, and before anyone can respond
  pickBy(h, o => o.label === 'Tempest Wrangler');
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

/* ── Its Dark Bubb: stat layer 5 ({Inverted}) actually inverting ───────────
 *
 * These four replace a `{ todo: true }` that parked the card on "inversion is
 * effStats stat layer 5, which the engine does not have". The engine has had
 * it since R93 (`src/engine.ts`, the LAYER 5 block: `p = 2 * base[0]! - p`),
 * and layer 6 ({Unaware}) since R106 — so the park outlived its reason by two
 * engine waves while reading, on every run, as a tracked gap. That is the
 * Harbinger failure exactly, in its quietest form: a todo can never fail, so
 * nothing ever contradicted it. It was the last `{ todo: true }` in test/,
 * and 90-coverage-census now asserts the count stays zero.
 *
 * WHAT LAYER 5 MEANS, precisely — the three readings that fit the printed
 * sentence "invert the stat changes of inverted units", and which one shipped:
 *
 *   (i)  NET CHANGE FROM BASE, negated once: `2·base − current`. SHIPPED.
 *   (ii) each source's delta measured IN ISOLATION against base, negated,
 *        and summed.
 *   (iii) each source's OPERATION run backwards in order — under which
 *        {Tough} inverted would "halve" rather than "give back the +0/+N it
 *        granted".
 *
 * Caleb's own worked example (1/4 Tough Balanced Inverted → -6/0, pinned in
 * 79-round17-layers) does not separate (i) from (ii): with nothing but layer-4
 * attributes in play their arithmetic agrees. The fourth test below is the one
 * that separates all three, and it is why it is worth having.
 *
 * NOT DUPLICATING: 79-round17-layers pins the layer through DONATED
 * {Inverted} (Reality Bender onto Malformed Monstrosity's self-static) and
 * Caleb's example; 17-earth-b pins Reality Bender's own ±1 counter. Neither
 * uses Bubb, whose {Inverted} is PRINTED on its own type line rather than
 * granted, and neither uses a multi-source board.
 */

/** grant a layer-4/5 attribute WITHOUT settling. Deliberate: the third test
 *  below lands on a negative defense, so the unit is dead the moment the board
 *  is checked — and that is not a problem with the arithmetic. `effStats` is
 *  atomic and the death check is the caller's ("imagine it as one big
 *  equation… It is not a time thing"), so the number has to be readable
 *  before anything settles. Same device as 79-round17-layers' `grant`. */
function grantAttr(h: Harness, id: EntityId, attr: 'Tough' | 'Balanced' | 'Inverted'): void {
  const e = new E(h.state);
  e.addTempAttr(e.entity(id)!, attr);
  h.state = e.s;
}

test('Its Dark Bubb: {Inverted} turns a real static BUFF into a debuff', () => {
  const h = new Harness(4312);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  // Life Power Dude: "[Augment] As long as your life total is odd, all units
  // gain -2/-0. Otherwise they gain +2/+0." Life starts at 30 — even — so the
  // static is projecting +2/+0 onto every unit in the region, Bubb included.
  // Pinned rather than assumed: a control token in the same region shows the
  // contribution, so if the parity branch ever flips this test says which
  // half moved.
  assert.equal(h.state.players[P]!.life % 2, 0, 'even life → the +2/+0 branch');
  spawn(h, P, 'Life Power Dude');
  const control = spawn(h, P, 'Unit Token');
  const bubb = spawn(h, P, 'Its Dark Bubb');
  assert.deepEqual(effStats(h, control), [3, 1], 'the static really is +2/+0 (a 1/1 token reads 3/1)');
  assert.deepEqual(effStats(h, bubb), [2, 6],
    'R93: the same +2/+0 is inverted to -2/-0 off Bubb\'s printed 4/6');
});

test('Its Dark Bubb: {Inverted} turns a DEBUFF into a buff', () => {
  const h = new Harness(4313);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const bubb = spawn(h, P, 'Its Dark Bubb');
  // -1/-1 counters, the plainest debuff there is. Caleb, asked directly
  // whether {Inverted} reverses counters: "yes".
  whiteBox(h, e => e.addCounters(e.entity(bubb)!, -3));
  assert.equal(ent(h, bubb)!.counters, -3, 'three -1/-1 counters really are on it');
  assert.deepEqual(effStats(h, bubb), [7, 9],
    'R93: a -3/-3 net change is inverted to +3/+3, so the printed 4/6 reads 7/9 — '
    + 'and note it is BIGGER, not merely un-shrunk');
});

test('Its Dark Bubb: the printed reminder text, verbatim — "-1/+2 would become +1/-2"', () => {
  const h = new Harness(4314);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const bubb = spawn(h, P, 'Its Dark Bubb');
  // The card's own reminder text is the only ASYMMETRIC example in the rules,
  // and it is the one that rules out "invert the final numbers": a 4/6 that
  // took -1/+2 does not read -3/-8, it reads 5/4.
  whiteBox(h, e => e.addTemp(e.entity(bubb)!, -1, 2));
  assert.deepEqual(effStats(h, bubb), [5, 4],
    'printed: "-1/+2 would become +1/-2" — off a 4/6 that is a 5/4');
});

test('Its Dark Bubb: MULTI-SOURCE — layer 5 negates the NET change, not each source on its own', () => {
  // THE TEST THIS FILE IS FOR. Three sources, chosen so that the three
  // readings of "invert the stat changes" give three DIFFERENT answers — the
  // discrimination Caleb's own 1/4-tough-balanced example cannot make,
  // because with only layer-4 attributes in play (i) and (ii) coincide.
  //
  //   printed base                                    4 / 6
  //   + Life Power Dude's static  (+2/+0)             6 / 6
  //   + one +1/+1 counter         (+1/+1)             7 / 7
  //   + {Tough}                   (defense doubles)   7 / 14
  //
  //   (i)   NET, negated once   — 2·4−7 / 2·6−14  →  [1, -2]   ← SHIPPED
  //   (ii)  isolated deltas     — static +2/+0, counter +1/+1, and {Tough}
  //         measured on its own against the base 4/6 is +0/+6; the sum is
  //         +3/+7, negated → [1, -1].
  //   (iii) operations run backwards — -2/-0 → 2/6, -1/-1 → 1/5, and
  //         "{Tough} inverted = halve" → [1, 2.5].
  //
  // (ii) is wrong because {Tough} doubled a defense that the counter had
  // already raised: its real contribution to THIS board is +7, not +6. (iii)
  // is the reading R93 rejects in so many words — "it is a mathematical
  // operation, not a linguistic operation"; Tough inverted is "lose the +0/+N
  // you gained", not "halve".
  const h = new Harness(4315);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  assert.equal(h.state.players[P]!.life % 2, 0, 'even life → Life Power Dude projects +2/+0');
  spawn(h, P, 'Life Power Dude');
  const bubb = spawn(h, P, 'Its Dark Bubb');
  assert.deepEqual(effStats(h, bubb), [2, 6], 'one source so far: +2/+0 inverted');

  whiteBox(h, e => e.addCounters(e.entity(bubb)!, 1));
  assert.deepEqual(effStats(h, bubb), [1, 5], 'two sources: a +3/+1 net inverted');

  grantAttr(h, bubb, 'Tough');
  assert.deepEqual(effStats(h, bubb), [1, -2],
    'three sources: {Tough} doubled a defense the counter had already raised, so the '
    + 'net change is +3/+8 and layer 5 negates THAT — [1, -2]. Per-source inversion '
    + 'would say [1, -1]; running each operation backwards would say [1, 2.5].');
  // and the attribute is still only counted once, however it arrived
  assert.ok(ownAttrs(h, bubb).has('Inverted'), 'printed {Inverted}, not granted');
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

// R137 HAZARD 2, the same shape as the Rector's and with the same precedent:
// the Distiller caches the card it just saw trashed, and an Unstable card is
// already erased by the time the trigger resolves. It has always guarded on
// `bin.lastIndexOf(name) === -1` (this is how it behaves for a dying TOKEN),
// and R108/R113 make the guard refund the reservation: "a [once] is spent only
// when the ability DOES something", and no offer could be made at all.
test('R137 hazard: an Unstable death gives the Distiller nothing to cache, and does NOT spend its [once] (R108)', () => {
  const h = new Harness(4391);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'Murkdrop Distiller');
  const victim = spawn(h, P, 'Good Whale');
  whiteBox(h, e => {
    e.entity(victim)!.unstable = true;                     // the R96 until-regroup STAMP (Abyssal Evocation)
    e.destroy(e.entity(victim)!, 'dies');
  });
  assert.ok(trashedCards(h).includes('Good Whale'), 'R137: the trigger really did see a trash');
  assert.equal(h.state.decision, null, 'but no cache is offered — the card is already gone');
  assert.ok(h.log.some(l => l.includes('Murkdrop Distiller: Good Whale is not in your bin')));
  assert.deepEqual(h.q.cache(P).map(c => c.card), [], 'nothing was cached');
  assert.ok(erasedCards(h, P).includes('Good Whale'),
    'it is in the erased pile, and no card may reach back into that');
  // and the [once] survived, so a real trash later this turn still gets it
  const j = give(h, P, 'Rotling');
  whiteBox(h, e => e.discardFromHand(P, j));
  assert.ok(h.state.decision, 'R108: an offer that could not be made never spent the use');
  pickBy(h, o => String(o.label).startsWith('Cache'));
  assert.equal(h.q.cache(P)[0]!.card, 'Rotling');
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
  assert.equal(wights[0]!.region, h.q.homeRegion(P), 'created units arrive at ctx.region — home for a deploy spell (R115)');
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

test('Rotling: R124 — recalled out of your bin by a real recursion effect (Blightwalker), pay [1] to draw a card and gain 1 rot', () => {
  const h = new Harness(4341);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'dark', 3);
  const mana = h.q.openMana(P);
  bin(h, P).push('Rotling');
  const i = give(h, P, 'Blightwalker');
  whiteBox(h, e => e.discardFromHand(P, i));

  // Blightwalker's own R40 trigger recalls Rotling for [2] — a real, existing
  // bin-removal SITE (batch-dark-c), now routed through the R124 choke point
  pickBy(h, o => String(o.label).startsWith('Rotling'));
  pickBy(h, o => o.label === 'Pay [2]');

  assert.ok(h.events.some(ev => ev.type === 'leftBin' && ev.data?.['card'] === 'Rotling'),
    "the recall went through the choke point and fired 'leftBin'");
  assert.ok(hand(h, P).includes('Rotling'), 'Rotling itself was recalled to hand');
  assert.ok(h.state.decision, "Rotling's own leave-trigger asks");
  const before = hand(h, P).length;
  pickBy(h, o => String(o.label).startsWith('Pay [1]'));
  assert.equal(hand(h, P).length, before + 1, 'paying [1] draws a card');
  assert.equal(h.q.rot(P), 1, 'and gains 1 rot');
  assert.equal(h.q.openMana(P), mana - 3, 'the [2] and the [1] were both really paid');
});

test('Rotling: declining pays nothing, draws nothing, gains no rot — and R113 keeps the [Switch1] unspent', () => {
  const h = new Harness(4342);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'dark', 1);
  const mana = h.q.openMana(P);
  bin(h, P).push('Rotling');
  whiteBox(h, e => e.removeFromBin(P, e.player(P).bin.lastIndexOf('Rotling'), 'test'));

  assert.ok(h.state.decision, 'the leave-trigger asks');
  const before = hand(h, P).length;
  pickBy(h, o => o.label === 'Decline');
  assert.equal(hand(h, P).length, before, 'declining draws nothing');
  assert.equal(h.q.rot(P), 0, 'gains no rot');
  assert.equal(h.q.openMana(P), mana, 'and pays nothing');
  assert.deepEqual(h.state.zoneBudgets ?? {}, {},
    'R108/R113: the declined use is refunded, not spent');

  // the same turn, another Rotling leaves — the [Switch1] is still available
  bin(h, P).push('Rotling');
  whiteBox(h, e => e.removeFromBin(P, e.player(P).bin.lastIndexOf('Rotling'), 'test'));
  assert.ok(h.state.decision, 'it may ask again this turn (the use was never spent)');
  pickBy(h, o => o.label === 'Decline');
});

test("Rotling: another card leaving the bin is not me; leaving the OPPONENT's bin triggers the bin owner", () => {
  const h = new Harness(4343);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const A = (1 - P) as Seat;
  giveResources(h, P, 'dark', 1);
  giveResources(h, A, 'dark', 1);

  // another card leaves MY bin: 'leftBin' reaches only the card that left
  bin(h, P).push('Rotling', 'Grox');
  whiteBox(h, e => e.removeFromBin(P, e.player(P).bin.lastIndexOf('Grox'), 'test'));
  const askedForGrox = h.state.decision;   // snapshot: assert.equal(prop, null) would narrow the path
  assert.equal(askedForGrox, null, 'Grox leaving is not Rotling leaving — no ask');
  assert.ok(bin(h, P).includes('Rotling'), 'Rotling sat still');

  // Rotling leaves the OPPONENT's bin. Documented pronoun reading (R124):
  // "your bin" is the BIN OWNER's — the seat whose bin it leaves is the seat
  // that triggers, decides, pays, draws and gains the rot, whichever side
  // once played the card. (P's own binned Rotling stays silent through it.)
  bin(h, A).push('Rotling');
  const handA = hand(h, A).length;
  whiteBox(h, e => e.removeFromBin(A, e.player(A).bin.lastIndexOf('Rotling'), 'test'));
  assert.ok(h.state.decision, 'the leave-trigger asks');
  assert.equal(h.state.decision!.seat, A, 'and it asks the BIN OWNER, not the other seat');
  pickBy(h, o => String(o.label).startsWith('Pay [1]'));
  assert.equal(hand(h, A).length, handA + 1, 'the bin owner draws');
  assert.equal(h.q.rot(A), 1, 'the bin owner gains the rot');
  assert.equal(h.q.rot(P), 0, 'the other seat gains nothing');
});

test('Rotling: the [Switch1] bounds it once per turn when it does something, and startTurn refreshes it', () => {
  const h = new Harness(4344);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'dark', 2);
  bin(h, P).push('Rotling');
  whiteBox(h, e => e.removeFromBin(P, e.player(P).bin.lastIndexOf('Rotling'), 'test'));
  pickBy(h, o => String(o.label).startsWith('Pay [1]'));
  assert.equal(h.q.rot(P), 1, 'the first leave fired and did something');

  // second leave, same turn: the [Switch1] is spent — no ask, nothing happens
  bin(h, P).push('Rotling');
  whiteBox(h, e => e.removeFromBin(P, e.player(P).bin.lastIndexOf('Rotling'), 'test'));
  assert.equal(h.state.decision, null, 'bounded: it does not ask twice in one turn');
  assert.equal(h.q.rot(P), 1, 'and nothing happened');
  assert.equal(Object.keys(h.state.zoneBudgets ?? {}).length, 1,
    'the reservation is real GameState, not a stand-in ghost (CARD-TODO #21)');

  toNextDeployment(h);
  assert.deepEqual(h.state.zoneBudgets ?? {}, {}, 'startTurn wipes it beside Entity.budgets');
  const Q = h.state.deployPlayer!;
  giveResources(h, Q, 'dark', 1);
  bin(h, Q).push('Rotling');
  whiteBox(h, e => e.removeFromBin(Q, e.player(Q).bin.lastIndexOf('Rotling'), 'test'));
  assert.ok(h.state.decision, 'a fresh turn, a fresh [Switch1]');
  pickBy(h, o => o.label === 'Decline');
});

test("Rotling: R124 — two different engine removal sites (erase-from-bin, cache-from-bin) both fire 'leftBin'", () => {
  const h = new Harness(4345);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const leftBins = () => h.events.filter(ev => ev.type === 'leftBin').length;

  bin(h, P).push('Grox');
  whiteBox(h, e => e.eraseFromZone(P, 'Grox', 'bin', 'Grox is ERASED (test).'));
  assert.equal(leftBins(), 1, 'an erase-from-bin goes through the choke point');
  assert.ok(!bin(h, P).includes('Grox'), 'and the card really left');

  bin(h, P).push('Good Whale');
  whiteBox(h, e => { e.cacheFromBin(P, e.player(P).bin.lastIndexOf('Good Whale')); });
  assert.equal(leftBins(), 2, 'a cache-from-bin goes through the same choke point');
  assert.ok(h.q.cache(P).some(cc => cc.card === 'Good Whale'), 'the card is in the cache');
});

test('Rotling: the pending pay-[1] decision and the zoneBudgets reservation survive a JSON round-trip (pre-R124 states still load)', () => {
  const h = new Harness(4346);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  giveResources(h, P, 'dark', 1);
  bin(h, P).push('Rotling');
  whiteBox(h, e => e.removeFromBin(P, e.player(P).bin.lastIndexOf('Rotling'), 'test'));
  assert.ok(h.state.decision, 'the leave-trigger is mid-question');

  const round = JSON.parse(JSON.stringify(h.state)) as typeof h.state;
  assert.deepEqual(round.zoneBudgets, h.state.zoneBudgets, 'the reservation round-trips');
  assert.equal(Object.keys(round.zoneBudgets ?? {}).length, 1, 'and it is really there');
  h.state = round;
  const before = hand(h, P).length;
  pickBy(h, o => String(o.label).startsWith('Pay [1]'));
  assert.equal(hand(h, P).length, before + 1, 'the reloaded state still pays and draws');
  assert.equal(h.q.rot(P), 1, 'and gains the rot');

  // additive/optional: a game serialized before R124 has no such key at all
  const h2 = new Harness(4347);
  toDeployment(h2);
  const P2 = h2.state.deployPlayer!;
  const old = JSON.parse(JSON.stringify(h2.state)) as typeof h2.state;
  delete old.zoneBudgets;
  h2.state = old;
  bin(h2, P2).push('Rotling');
  // drain the mana first, so the R113 "cannot pay [1]" branch runs — it must
  // not crash on the absent field (composeParts recreates it, refundPart
  // hands the use back)
  whiteBox(h2, e => {
    const m = e.openMana(P2);
    if (m > 0) e.payMana(P2, m);
    e.removeFromBin(P2, e.player(P2).bin.lastIndexOf('Rotling'), 'test');
  });
  assert.equal(h2.state.decision, null, 'no [1] to offer — no question');
  assert.deepEqual(h2.state.zoneBudgets ?? {}, {}, 'and the unusable firing is refunded (R113)');
  assert.doesNotThrow(() => h2.legal(P2), 'a pre-R124 save still drives');
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

/** roll from the current deployment through a battle into the NEXT start of
 * deployment, where the R50 'startOfDeployment' event fires. (The Xzydris
 * tests below do the same six lines by hand; hoisted here because the R101
 * transform tests need it seven more times.) */
function toNextDeployment(h: Harness): void {
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  finishBattle(h);
}

test('Scholar of the Void: R101 — discard your hand and transform into Beyond, Codex Incarnate', () => {
  // Playtest ledger #24 (ZQPC, 2026-08-20). The owner supplied the back face on
  // 2026-08-22; before that the trigger fired and declined, because there was
  // no card to become. Now: "[Augment] At the start of deployment, you may
  // discard your hand and transform me into Beyond, Codex Incarnate."
  const h = new Harness(4337);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const sv = spawn(h, P, 'Scholar of the Void');
  assert.deepEqual(effStats(h, sv), [0, 2], 'a 0/2 while it is still a Scholar');
  give(h, P, 'Good Whale');
  give(h, P, 'Grox');
  const handBefore = hand(h, P).length;
  assert.ok(handBefore >= 2, 'there is a real hand to lose');

  toNextDeployment(h);
  assert.equal(h.state.phase, 'deploy');
  assert.ok(h.state.decision, 'R50 delivers the event and the "you may" asks');
  assert.equal(h.state.decision!.seat, P, 'its controller decides');
  pickBy(h, o => String(o.label).includes('transform into Beyond, Codex Incarnate'));

  assert.equal(ent(h, sv)!.card, 'Beyond, Codex Incarnate',
    'Entity.card IS the identity — turning it over is the whole transform');
  assert.deepEqual(effStats(h, sv), [8, 3], 'and the stats come off the new face for free');
  assert.equal(hand(h, P).length, 0, 'the whole hand was discarded — that is the cost');
  assert.equal(bin(h, P).length >= handBefore, true, 'and it went to the bin');
});

test('Scholar of the Void: R101 — declining keeps the hand and the 0/2 body', () => {
  const h = new Harness(4338);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const sv = spawn(h, P, 'Scholar of the Void');
  give(h, P, 'Good Whale');
  toNextDeployment(h);
  const handBefore = [...hand(h, P)];
  assert.ok(handBefore.length > 0, 'there is a hand to lose');
  assert.ok(h.state.decision, '"you may" — declining must be on offer');
  pickBy(h, o => String(o.label).startsWith('Decline'));
  assert.equal(ent(h, sv)!.card, 'Scholar of the Void', 'still itself');
  assert.deepEqual(effStats(h, sv), [0, 2]);
  assert.deepEqual(hand(h, P), handBefore, 'and the hand is untouched — a declined cost is not paid');
  assert.ok(!ent(h, sv)!.token, 'and it is still a real card, not a token');
});

test('Scholar of the Void: R101 — an EMPTY hand still pays the cost, and the option is still offered', () => {
  // "Discard your hand" is not "discard a card": a hand of zero cards is
  // discarded by doing nothing, so the option is legal and free. That makes an
  // empty-handed Scholar the card's best case, which is a line, not a bug.
  const h = new Harness(4339);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const sv = spawn(h, P, 'Scholar of the Void');
  // The turn draw refills a hand emptied before the phase roll, so the event
  // is fired directly instead — the same call startDeployment() makes, one
  // line later, with the hand in the state under test.
  hand(h, P).length = 0;
  whiteBox(h, e => e.fireEvent('startOfDeployment', e.ev('startOfDeployment', 'Start of deployment.')));
  assert.ok(h.state.decision, 'offered with an empty hand');
  assert.ok(h.state.decision!.options.some(o => String(o.label).includes('Discard 0 cards')),
    'and it says out loud that the cost is nothing');
  pickBy(h, o => String(o.label).includes('transform into Beyond, Codex Incarnate'));
  assert.equal(ent(h, sv)!.card, 'Beyond, Codex Incarnate');
});

test('Scholar of the Void: R101 — the transform is the SAME unit: same id, and its counters and damage survive', () => {
  // A transform is not a new unit. Nothing is deleted and nothing is spawned,
  // so every fact that hangs off the entity is still true afterwards — which
  // is also why no spawned/died event fires and why anything holding its id
  // (a block assignment, a queued trigger's sourceId, a spell already
  // targeting it) still points at the right thing.
  //
  // The event is fired directly rather than through a phase roll for one
  // reason: R11's regroup sweep clears marked DAMAGE, so a turn boundary would
  // wipe the very fact under test and the assertion would pass vacuously.
  const h = new Harness(4340);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const sv = spawn(h, P, 'Scholar of the Void');
  whiteBox(h, e => { e.addCounters(e.entity(sv)!, 1); e.entity(sv)!.damage = 1; });
  const before = ent(h, sv)!;
  const region = before.region, owner = before.owner;
  assert.equal(before.counters, 1);
  assert.equal(before.damage, 1);

  whiteBox(h, e => e.fireEvent('startOfDeployment', e.ev('startOfDeployment', 'Start of deployment.')));
  pickBy(h, o => String(o.label).includes('transform into Beyond'));

  const after = ent(h, sv)!;
  assert.ok(after, 'the very same entity id is still in play');
  assert.equal(after.counters, 1, 'counters are on the ENTITY, not on the face');
  assert.equal(after.damage, 1, 'and so is marked damage');
  assert.equal(after.region, region);
  assert.equal(after.owner, owner);
  assert.ok(!h.events.some(ev => ev.type === 'spawned' && ev.data?.['unit'] === sv),
    'nothing SPAWNED — a transform is not an arrival');
  assert.ok(!h.events.some(ev => ev.type === 'died' && ev.data?.['unit'] === sv),
    'and nothing DIED — the unit was never absent from the board');
  // 8/3 base, +1 counter = 9/4, and Beyond grants {Inverted} to YOUR units —
  // which includes ITSELF — so R93 layer 5 negates the +1/+1 back off: 7/2.
  // (Worth knowing at the table: a Beyond wearing +1/+1 counters is SMALLER
  // than one without, and enough of them will kill it. That is the printed
  // card working, not a bug — this test was written with two counters first
  // and the 6/1 body died to its own marked damage.)
  assert.deepEqual(effStats(h, sv), [7, 2],
    'R93: 2·base − current — the counters ride along and are then inverted');
});

test('Scholar of the Void: R157 §10 — a transformed Scholar TURNS BACK OVER on death and bins as itself', () => {
  // ⚠ THIS TEST IS THE REVERSE OF THE ONE IT REPLACES, and deliberately so.
  // R101 shipped `token = true` on the transform and this test asserted the
  // consequence: Beyond is erased on death, never binned, and "does NOT flip
  // back to its front face on the way out: nothing prints that". R101 said as
  // much in its own comment — it flagged the flip-back as a real reading it
  // would not invent without the owner. The owner ruled it, 2026-08-25:
  //
  //   "Turns back over. In all zones, other than play, it exists as the front
  //    side. And the back is NOT a token."
  //
  // Both halves, so both are asserted here. The thing R101 was protecting
  // against still cannot happen — the name "Beyond, Codex Incarnate" never
  // reaches a bin — but the player keeps their card instead of losing it to
  // the game for having used its own ability.
  const h = new Harness(4341);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const sv = spawn(h, P, 'Scholar of the Void');
  toNextDeployment(h);
  pickBy(h, o => String(o.label).includes('transform into Beyond'));
  assert.ok(!ent(h, sv)!.token, 'the back face is NOT a token');
  assert.equal(ent(h, sv)!.card, 'Beyond, Codex Incarnate', 'but it really is turned over');

  const binBefore = [...bin(h, P)];
  whiteBox(h, e => e.destroy(e.entity(sv)!, 'dies'));
  assert.equal(ent(h, sv), undefined, 'it left play');
  assert.ok(!bin(h, P).includes('Beyond, Codex Incarnate'),
    'the back face reaches no zone but play — a 0-cost 8/3 is never fetchable');
  const count = (xs: string[], n: string): number => xs.filter(x => x === n).length;
  assert.equal(count(bin(h, P), 'Scholar of the Void'),
    count(binBefore, 'Scholar of the Void') + 1,
    'the card that bins is the FRONT face: the physical Scholar of the Void');
  assert.ok(!(h.state.players[P]!.erased ?? []).includes('Beyond, Codex Incarnate'),
    'and nothing is erased — it was never a token, so R69 has nothing to sweep');
});

test('Scholar of the Void: R101 — donated to a HOST the transform is refused, because the back face belongs to Scholar', () => {
  // The whole text is [Augment], so it transfers, and "me" rebinds to the host
  // exactly as Skittering Blight's "counters on me" does. Transforming an
  // arbitrary host is incoherent — the owner: Beyond "is on the back of a
  // card", and that card is Scholar of the Void. A Good Whale has its own
  // reverse side. So the option is not offered at all.
  const h = new Harness(4342);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const host = spawn(h, P, 'Good Whale');
  whiteBox(h, e => e.attachMod(e.entity(host)!, 'Scholar of the Void', P, 'augment'));
  const handBefore = hand(h, P).length;
  toNextDeployment(h);
  assert.equal(h.state.decision, null, 'nothing is asked — there is no option to take');
  assert.equal(ent(h, host)!.card, 'Good Whale', 'the host is untouched');
  assert.ok(!ent(h, host)!.token, 'and it is emphatically not turned into a token');
  assert.ok(hand(h, P).length >= handBefore,
    'no hand was discarded — it only grew, by the turn draw');
  assert.ok(!h.log.some(l => l.includes('transforms into')), 'nothing was turned over');
  assert.ok(h.log.some(l => l.includes('has its own')),
    'and it SAYS why, rather than resolving into silence');
});

test('Scholar of the Void: R101 — a Scholar augmented onto ANOTHER Scholar does work: that host has the back face', () => {
  // Falls out of the same check rather than needing a special case: the
  // question asked is "does the ANCHOR print this back face?", and a Scholar
  // does. Both the body's own [Augment] text and the mod's donated copy fire
  // (R55), so the first transforms the host and the second finds a Beyond,
  // which has no back face of its own, and declines.
  const h = new Harness(4343);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const host = spawn(h, P, 'Scholar of the Void');
  whiteBox(h, e => e.attachMod(e.entity(host)!, 'Scholar of the Void', P, 'augment'));
  toNextDeployment(h);
  let guard = 6;
  while (h.state.decision && guard-- > 0) {
    const wants = h.state.decision.options.findIndex(o => String(o.label).includes('transform into Beyond'));
    h.do({ type: 'decide', seat: h.state.decision.seat, choice: wants === -1 ? 0 : wants });
  }
  assert.equal(ent(h, host)!.card, 'Beyond, Codex Incarnate', 'the host really did have a back face');
  // R157 §10: "the back is NOT a token". The entity is the physical Scholar
  // the whole time, and it remembers which side is up.
  assert.ok(!ent(h, host)!.token, 'turning a card over does not make it a token');
  assert.equal(ent(h, host)!.frontFace, 'Scholar of the Void',
    'and the front face is remembered, so it can turn back over on the way out');
});

test('Beyond, Codex Incarnate: R101 — registered, but it can never be drafted, decked or drawn', () => {
  // "Can't be played cause it's on the back of a card" (the owner). The
  // guarantee is the printed type line, not a hand-kept list: DECK_LIST drops
  // anything whose type says Token, and the draft pool is a filter over
  // DECK_LIST.
  const c = getCard('Beyond, Codex Incarnate');
  assert.equal(c.type, 'Book Token Unit');
  assert.deepEqual([c.power, c.toughness, c.mana], [8, 3, 0]);
  assert.ok(!DECK_LIST.includes('Beyond, Codex Incarnate'), 'not a deck card');
  assert.ok(!draftDeckList(['dark']).includes('Beyond, Codex Incarnate'), 'not draftable');
  assert.ok(!draftDeckList(['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'])
    .includes('Beyond, Codex Incarnate'), 'not draftable in ANY element set');
});

test('Beyond, Codex Incarnate: R93 — "Your units are inverted" reaches YOUR units and not the enemy', () => {
  // Stat layer 5 shipped as R93, which is what made this clause implementable
  // at all. The static is a plain attrs grant; ownership lives on the card and
  // region scoping (R12) comes free from E.staticsFor's anchored() walk.
  //
  // Tested on units carrying only COUNTERS — deliberately no base rewrite
  // anywhere near this test, because R93 has a live open question about
  // whether {Inverted} inverts from the printed base or from a post-rewrite
  // one, and nothing here should depend on how the owner settles it.
  const h = new Harness(4344);
  toDeployment(h);
  const P = h.state.deployPlayer!, D = (1 - P) as Seat;
  const sv = spawn(h, P, 'Scholar of the Void');
  const ally = spawn(h, P, 'Good Whale');                       // 7/5
  let foe = 0;
  whiteBox(h, e => {
    // an ENEMY unit standing in the same region, so the only thing that can
    // exclude it is the static's ownership test rather than R12
    foe = e.spawnUnit(D, 'Good Whale', e.entity(sv)!.region).id;
  });
  whiteBox(h, e => { e.addCounters(e.entity(ally)!, 1); e.addCounters(e.entity(foe)!, 1); });
  assert.deepEqual(effStats(h, ally), [8, 6], 'before: 7/5 with a +1/+1 counter');
  assert.deepEqual(effStats(h, foe), [8, 6]);

  toNextDeployment(h);
  pickBy(h, o => String(o.label).includes('transform into Beyond'));

  assert.ok(ownAttrs(h, ally).has('Inverted'), 'your unit is inverted');
  assert.deepEqual(effStats(h, ally), [6, 4], 'the +1/+1 is negated off base: 2·7−8, 2·5−6');
  assert.ok(!ownAttrs(h, foe).has('Inverted'), '"YOUR units" — not theirs');
  assert.deepEqual(effStats(h, foe), [8, 6], 'the enemy copy is untouched');
});

/* ── R102: the rot replacement, LIVE ────────────────────────────────────
 *
 * "If you would take damage from rot, put that many -1/-1 counters on target
 * unit instead." Parked in R101 behind the conclusion that a brand-new
 * Suspension variant was needed. The owner ruled otherwise, 2026-08-22:
 *
 *   "In Deployment, you're in your own region, alone. So you can only target
 *    your own units. It would trigger, ask you what you want to target, then
 *    put the -1/-1 counters on during deployment (which still has and uses a
 *    stack). But since Beyond gives all your units inverted, no one would die
 *    of course."
 *
 * So the replacement puts a TRIGGERED EFFECT on the stack and the R67
 * machinery that already exists does the asking. The engine seam is one new
 * dispatched event, 'rotReplaced', fired by E.replaceRotDamage the instant a
 * hook returns true; Beyond declares an ordinary `self: true` trigger against
 * it. These five tests are what keeps it honest.
 */

test('Beyond, Codex Incarnate: R102 — the rot replacement asks its controller for a target, and the damage never lands', () => {
  const h = new Harness(4346);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const sv = spawn(h, P, 'Scholar of the Void');
  toNextDeployment(h);
  pickBy(h, o => String(o.label).includes('transform into Beyond'));
  const ally = spawn(h, P, 'Good Whale');     // a second candidate, so there IS a choice
  whiteBox(h, e => e.gainRot(P, 3));
  const lifeBefore = h.state.players[P]!.life;

  toNextDeployment(h);                        // R38 rot fires at the start of deployment

  const dec = h.state.decision;
  assert.ok(dec, 'the replacement stopped to ask — it did not resolve into a guess');
  assert.equal(dec!.kind, 'targets', 'and it asked through the ordinary R67 target collector');
  assert.equal(dec!.seat, P, 'the CHOOSER is Beyond, Codex Incarnates controller');
  assert.ok(dec!.prompt.includes('-1/-1 counters on target unit'), 'the prompt is the printed line');
  assert.ok(h.log.some(l => l.includes('replaces the 3 damage')), 'the replacement is announced');
  assert.equal(h.state.players[P]!.life, lifeBefore,
    'and the damage is ALREADY gone before the question is answered — the hook returned true first');

  pickBy(h, o => (o.value as { unit?: number }).unit === ally);
  assert.equal(ent(h, ally)!.counters, -3, 'that many -1/-1 counters, on the unit that was named');
  assert.equal(ent(h, sv)!.counters, 0, 'and none on Beyond, which was merely one of the options');
  assert.equal(h.state.players[P]!.life, lifeBefore, 'still no rot damage — "instead" means instead');
});

test('Beyond, Codex Incarnate: R102 — the counters make your own units BIGGER, because Beyond inverts them', () => {
  // The owners closing observation, and a genuine consequence rather than a
  // curiosity: Beyond grants {Inverted} to your units, R93 layer 5 negates the
  // accumulated delta from base, so -1/-1 counters read as +1/+1. Your own rot
  // grows your board and "no one would die of course".
  const h = new Harness(4349);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  spawn(h, P, 'Scholar of the Void');
  toNextDeployment(h);
  pickBy(h, o => String(o.label).includes('transform into Beyond'));
  const ally = spawn(h, P, 'Good Whale');                 // 7/5
  assert.deepEqual(effStats(h, ally), [7, 5], 'inverted, but with no delta yet, it is itself');
  whiteBox(h, e => e.gainRot(P, 3));

  toNextDeployment(h);
  pickBy(h, o => (o.value as { unit?: number }).unit === ally);

  assert.equal(ent(h, ally)!.counters, -3, 'three -1/-1 counters really are on it');
  assert.deepEqual(effStats(h, ally), [10, 8],
    'R93 layer 5: 2·7−4 and 2·5−2 — three -1/-1 counters made a 7/5 into a 10/8');
  assert.ok(ent(h, ally), 'and it is emphatically alive');
  assert.ok(unitsOf(h, P).some(u => u.id === ally), 'still on the board');
});

test('Beyond, Codex Incarnate: R102 — the target list is your own units, even with an enemy standing in the region', () => {
  // R64: the ruling is written as a real `restrict` on a `what: 'unit'` spec —
  // the kind the card actually prints — and NOT left to the board happening to
  // be empty of enemies during deployment. This is the test that tells the two
  // apart: an enemy unit is put into the very region the replacement resolves
  // in, so the region-scoped candidate list (R12) would offer it, and the
  // restriction is the only thing that does not.
  const h = new Harness(4347);
  toDeployment(h);
  const P = h.state.deployPlayer!, D = (1 - P) as Seat;
  const sv = spawn(h, P, 'Scholar of the Void');
  toNextDeployment(h);
  pickBy(h, o => String(o.label).includes('transform into Beyond'));
  let foe = 0;
  whiteBox(h, e => { foe = e.spawnUnit(D, 'Good Whale', e.entity(sv)!.region).id; });
  assert.equal(ent(h, foe)!.region, ent(h, sv)!.region, 'the enemy really is in the same region');

  // rot damage driven directly, because R11s regroup would walk the enemy home
  // before the next deployment ever opened
  whiteBox(h, e => { e.gainRot(P, 2); e.rotDamage(); });

  const dec = h.state.decision;
  assert.ok(dec, 'the replacement asked');
  const offered = dec!.options.map(o => (o.value as { unit?: number }).unit);
  assert.ok(offered.includes(sv), 'your own units are candidates');
  assert.ok(!offered.includes(foe), 'the enemy in the same region is NOT — you can only target your own');
});

test('Beyond, Codex Incarnate: R102 — two Beyonds each queue their own, each asked of its own controller', () => {
  // Rot is per-seat and can hit BOTH players in the same opening. Each side
  // fires its own 'rotReplaced' off its own anchor, so each queues a trigger
  // under its own controller and each is asked separately, in the deterministic
  // order processTriggerQueue already imposes.
  const h = new Harness(4348);
  toDeployment(h);
  const P = h.state.deployPlayer!, D = (1 - P) as Seat;
  spawn(h, P, 'Scholar of the Void');
  spawn(h, D, 'Scholar of the Void');
  toNextDeployment(h);
  let guard = 8;
  while (h.state.decision && guard-- > 0) {
    const want = h.state.decision.options.findIndex(o => String(o.label).includes('transform into Beyond'));
    h.do({ type: 'decide', seat: h.state.decision.seat, choice: want === -1 ? 0 : want });
  }
  const allyP = spawn(h, P, 'Good Whale');
  const allyD = spawn(h, D, 'Good Whale');
  whiteBox(h, e => { e.gainRot(P, 1); e.gainRot(D, 2); });
  const lifeP = h.state.players[P]!.life, lifeD = h.state.players[D]!.life;

  toNextDeployment(h);
  const asked: Seat[] = [];
  guard = 8;
  while (h.state.decision && guard-- > 0) {
    asked.push(h.state.decision.seat);
    const want = h.state.decision.options.findIndex(o => String(o.label).includes('Good Whale'));
    assert.notEqual(want, -1, 'each side is offered its OWN Good Whale');
    h.do({ type: 'decide', seat: h.state.decision.seat, choice: want });
  }
  assert.deepEqual([...asked].sort(), [0, 1], 'both controllers were asked, once each');
  assert.equal(ent(h, allyP)!.counters, -1, 'one rot replaced, one counter, on the seat that had it');
  assert.equal(ent(h, allyD)!.counters, -2, 'two rot, two counters, on the other');
  assert.equal(h.state.players[P]!.life, lifeP, 'neither player took rot damage');
  assert.equal(h.state.players[D]!.life, lifeD);
});

test('Beyond, Codex Incarnate: R102 — the start-of-deployment event still fires after the rot replacement stopped to ask', () => {
  // The regression this whole deferral exists for. R50 puts rot damage FIRST
  // and the 'startOfDeployment' event second, both inside startDeployment().
  // Once rot can raise a DECISION, the suspension throws clean out of that
  // method and doDecide resumes into collectTargets/commitItem/settle, which
  // has never heard of the second half — so the event would simply never fire
  // and every "At the start of deployment, …" card on the board would miss its
  // turn. `deployStarting` + E.finishDeployStart (called from settle()) is the
  // fix, in the shape of hasteEnding/finishHasteEnd and turnEnding/finishTurnEnd.
  const h = new Harness(4350);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const sv = spawn(h, P, 'Scholar of the Void');
  toNextDeployment(h);
  pickBy(h, o => String(o.label).includes('transform into Beyond'));
  spawn(h, P, 'Good Whale');
  whiteBox(h, e => e.gainRot(P, 2));
  const firedBefore = h.events.filter(ev => ev.type === 'startOfDeployment').length;

  toNextDeployment(h);
  assert.ok(h.state.decision, 'the opening stopped mid-way to ask for a target');
  assert.equal(h.events.filter(ev => ev.type === 'startOfDeployment').length, firedBefore,
    'and while the question is open the event has NOT fired — rot is still first (R50)');

  pickBy(h, o => String(o.label).includes('Good Whale'));
  assert.equal(h.events.filter(ev => ev.type === 'startOfDeployment').length, firedBefore + 1,
    'answering it lets the opening finish: the event fires, once');
  assert.ok(!h.state.deployStarting, 'and the window is closed behind it');
  assert.equal(ent(h, sv)!.card, 'Beyond, Codex Incarnate', 'the board is intact');
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
  // R105 (owner, 2026-08-23): a modded card is {Unstable} (Manual p.35), so the
  // mod does NOT come back — it and its carrier are erased. Spellbind "basically
  // works as a 'flashback' for graft cards", and the one-shot is the price of
  // the flashback: "even though mods can be applied from the bin, they are
  // generally only able to be applied once". This assertion used to read
  // `bin(h, A).includes(...)`, which made the flashback infinite.
  assert.ok(!bin(h, A).includes('Primordial Coalescence'), 'the mod never returns to a bin');
  assert.ok(erasedCards(h, A).includes('Primordial Coalescence'), 'it is erased with the spell (R65, R69)');
  assert.ok(erasedCards(h, A).includes('Spellbind'), 'and so is the carrier — Unstable is a BIN replacement');
  assert.ok(!trashedCards(h).includes('Spellbind'),
    'nothing is trashed either: R40 needs a bin to be trashed out of, and it never reached one');
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
