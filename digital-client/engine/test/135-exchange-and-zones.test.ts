/**
 * R157 §3 / §8 / §10 / §27 — WHAT LEAVES PLAY, AND WHERE IT LANDS.
 *
 * Four of the owner's twenty-seven answers of 2026-08-25, and three of them
 * are the same question from different sides: when a card stops being in play,
 * WHICH card is it and WHOSE zone does it go to?
 *
 *   §3  an EXCHANGE is not a death — but it is a despawn and a trashing
 *   §10 a TRANSFORMED card turns back over, and a back face is NOT a token
 *   §27 printed text beats the owner default — Grob caches to the CONTROLLER
 *
 * §8 (Dropslime's discard line is an activated ability from hand, usable in
 * battle) is the odd one out and is here because it was filed as a defect and
 * is not one: R65 already implemented it. Its test is a REGRESSION LOCK on
 * behaviour that shipped, plus the correction of two comments in
 * batch-dark-b.ts that claimed the mode "can never deal damage".
 *
 * Seeds are 13500+, clear of 42-dark-b (4200), 43-dark-c (4300) and
 * 129-disposal-tail (12900).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import {
  ent, give, giveResources, pass, pick, skipHasteStep, spawn,
  toDeployment, toNextBattle, unitsOf, withE as whiteBox,
} from './util.ts';
import type { DecisionOption, EngineEvent, Seat } from '../src/types.ts';

// ── harness plumbing (local, so neither this file's helpers nor another
//    file's can drift under the other) ──────────────────────────────────

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

/** finish deployment for both, plan through, and skip the battle → the next
 * deployment (which is where 'startOfDeployment' fires) */
function toNextDeployment(h: Harness): void {
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  skipHasteStep(h);
  let guard = 200;
  while (h.state.phase === 'battle' && guard-- > 0) {
    const b = h.state.battle!;
    if (h.state.decision) {
      const dec = h.state.decision;
      h.do({ type: 'decide', seat: dec.seat, choice: dec.pickOrder ? dec.options.map((_, i) => i) : 0 });
      continue;
    }
    if (b.step === 'declare') h.do({ type: 'declareAttack', seat: b.attacker, columns: [] });
    else if (b.step === 'blocks') h.do({ type: 'declareBlocks', seat: b.defender, blocks: {} });
    else pass(h);
  }
}

const bin = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.bin;
const hand = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.hand;
const cacheOf = (h: Harness, seat: Seat): string[] => new E(h.state).cache(seat).map(cc => cc.card);
const erasedOf = (h: Harness, seat: Seat): string[] => h.state.players[seat]!.erased ?? [];
const countIn = (xs: readonly string[], name: string): number => xs.filter(x => x === name).length;
const evs = (h: Harness, type: string): EngineEvent[] => h.events.filter(e => e.type === type);

// ══════════════════════════════════════════════════════════════════════
// §3 — AN EXCHANGE IS NOT A DEATH, BUT IT IS A DESPAWN AND A TRASHING
// ══════════════════════════════════════════════════════════════════════
//
// > "It's not a death, but it is a despawn and trashing. Weird corner case."
// >   — Bena, 2026-08-25
//
// Hooba-Mon was already right (its own file's exchange, now E.exchangeInPlace).
// NECROMORPH — the card whose printed text is literally "Exchange target unit
// in play for…" — called `g.destroy(victim, 'is deleted')`, a real death, and
// so fired every death trigger in the region. All three clauses of the ruling
// need a WITNESS, not just an absent log line, because the broken code logged
// plenty:
//
//  · not a death   → Refuse Reclaimer, "[Augment] Whenever another unit dies,
//                    put a +1/+1 counter on me". Zero decisions, any
//                    controller's unit counts, and the counter is a number on
//                    an entity. If a death fired, it is 1.
//  · IS a despawn  → Entropic Entity, "draw a card when a unit with counters
//                    despawns". A card in a hand is proof a listener RAN;
//                    R152 was an entire round spent on an exchange that logged
//                    a despawn it never fired.
//  · IS a trashing → the card in the bin and the 'trashed' event on it (R40).
test('R157 §3: Necromorph’s exchange fires NO death trigger — but it despawns and it trashes', () => {
  const h = new Harness(13501);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Grox');
  const victim = spawn(h, D, 'Good Whale');                 // cost 6
  // both witnesses stand in D's home region, which IS the battle region A
  // attacks into — every listener in this engine is region-scoped (R12)
  const deathWatch = spawn(h, D, 'Refuse Reclaimer');
  spawn(h, D, 'Entropic Entity');
  // Entropic Entity's `when` reads the counter count OFF THE EVENT, so the
  // victim needs one — and the exchange's despawn event has to carry it
  whiteBox(h, e => { e.addCounters(e.entity(victim)!, 1); });
  bin(h, D).push('Blightwalker');                           // cost 3 — a legal swap for a 6
  giveResources(h, A, 'dark', 3);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });

  const handD = hand(h, D).length;
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Necromorph') });
  pick(h, { unit: victim });
  pick(h, { bin: { seat: D, card: 'Blightwalker' } });
  pass(h); pass(h);                                         // resolve the spell
  // …and then the queued despawn trigger, which is a stack item of its own in
  // a battle window: fireEvent only COMPOSES triggers, it never resolves one
  drainStack(h);

  // the exchange itself happened
  assert.equal(ent(h, victim), undefined, 'the exchanged unit left play');
  assert.ok(unitsOf(h, D).some(u => u.card === 'Blightwalker'),
    'and its replacement arrived under the same controller');

  // ── NOT A DEATH ────────────────────────────────────────────────────
  assert.deepEqual(evs(h, 'died').map(e => e.data!['card']), [],
    'no died event at all — an exchange is not a death (R157 §3)');
  assert.equal(ent(h, deathWatch)!.counters, 0,
    'and a real "whenever another unit dies" listener did NOT fire. This is the assertion the '
    + 'old code failed: g.destroy(victim, "is deleted") fired every death trigger in the region.');

  // ── IS A DESPAWN ───────────────────────────────────────────────────
  const despawns = evs(h, 'despawned').filter(e => e.data!['card'] === 'Good Whale');
  assert.equal(despawns.length, 1, 'the departure was announced as a despawn…');
  assert.equal(despawns[0]!.data!['counters'], 1,
    '…carrying the leftPlayFacts a despawn listener reads (R70) — the counter count included');
  assert.equal(hand(h, D).length, handD + 1,
    '…and a third-party despawn watcher actually RAN. A log line is not proof: R152 spent a '
    + 'whole round on an exchange that logged a despawn it never fired.');

  // ── IS A TRASHING ──────────────────────────────────────────────────
  assert.equal(countIn(bin(h, D), 'Good Whale'), 1, 'the exchanged card is in its owner’s bin');
  assert.ok(evs(h, 'trashed').some(e => e.data!['card'] === 'Good Whale'),
    'and entering a bin from play is a trash (R40)');
  drainStack(h);
});

// The other half of "one behaviour": both exchanges in the pool go through the
// SAME method. This is behavioural, not a source scan — the primitive is
// replaced with a counting wrapper and both cards are driven. Re-inline the
// operation at either call site, even perfectly, and that route's counter
// stays at zero. (129-disposal-tail makes the same argument one layer down,
// for E.disposeToBin; this is the layer R157 §3 added.)
test('R157 §3: Hooba-Mon and Necromorph are ONE exchange — both go through E.exchangeInPlace', () => {
  const real = E.prototype.exchangeInPlace;
  let calls = 0;
  const wrapped = function (this: E, ...args: Parameters<E['exchangeInPlace']>) {
    calls++;
    return real.apply(this, args);
  };
  try {
    (E.prototype as { exchangeInPlace: E['exchangeInPlace'] }).exchangeInPlace = wrapped;

    // ── route 1: Hooba-Mon's attack trigger ─────────────────────────
    const h1 = new Harness(13502);
    toDeployment(h1);
    const A1 = h1.state.deployPlayer!;
    const hooba = spawn(h1, A1, 'Hooba-Mon');
    bin(h1, A1).push('Skittering Blight');
    toNextBattle(h1, A1);
    calls = 0;
    h1.do({ type: 'declareAttack', seat: A1, columns: [[hooba]] });
    pick(h1, { bin: { seat: A1, card: 'Skittering Blight' } });
    drainStack(h1);
    assert.equal(ent(h1, hooba), undefined, 'Hooba-Mon really exchanged itself away');
    assert.equal(calls, 1, 'Hooba-Mon must exchange through E.exchangeInPlace');

    // ── route 2: Necromorph the spell ───────────────────────────────
    const h2 = new Harness(13503);
    toDeployment(h2);
    const A2 = h2.state.deployPlayer!, D2 = (1 - A2) as Seat;
    const atk = spawn(h2, A2, 'Grox');
    const victim = spawn(h2, D2, 'Good Whale');
    bin(h2, D2).push('Blightwalker');
    giveResources(h2, A2, 'dark', 3);
    toNextBattle(h2, A2);
    h2.do({ type: 'declareAttack', seat: A2, columns: [[atk]] });
    calls = 0;
    h2.do({ type: 'playCard', seat: A2, handIndex: give(h2, A2, 'Necromorph') });
    pick(h2, { unit: victim });
    pick(h2, { bin: { seat: D2, card: 'Blightwalker' } });
    pass(h2); pass(h2);
    assert.equal(ent(h2, victim), undefined, 'Necromorph really exchanged the unit away');
    assert.equal(calls, 1,
      'Necromorph must exchange through E.exchangeInPlace. It used to call destroy() — two cards, '
      + 'one printed operation, two implementations, which is exactly the shape R153/CT-43 removed '
      + 'from the disposal tail one layer down.');
  } finally {
    (E.prototype as { exchangeInPlace: E['exchangeInPlace'] }).exchangeInPlace = real;
  }
});

// ══════════════════════════════════════════════════════════════════════
// §10 — A TRANSFORMED CARD TURNS BACK OVER, AND A BACK FACE IS NOT A TOKEN
// ══════════════════════════════════════════════════════════════════════
//
// > "Turns back over. In all zones, other than play, it exists as the front
// >  side. And the back is NOT a token."   — Bena, 2026-08-25
//
// R101 shipped the opposite of both halves — `self.token = true`, and no
// flip-back — and said so in its own comment, flagging the alternative as a
// real reading it would not invent without the owner. This is that reading,
// and the stake is the card: an erased Scholar is gone from the game for
// having used its own printed ability.
test('R157 §10: a transformed Scholar killed in play BINS as "Scholar of the Void"', () => {
  const h = new Harness(13504);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const sv = spawn(h, P, 'Scholar of the Void');
  toNextDeployment(h);
  pickBy(h, o => String(o.label).includes('transform into Beyond'));

  const flipped = ent(h, sv)!;
  assert.equal(flipped.card, 'Beyond, Codex Incarnate', 'it is turned over…');
  assert.ok(!flipped.token, '…and the back face is NOT a token (§10, second sentence)');
  assert.equal(flipped.frontFace, 'Scholar of the Void',
    'the entity remembers which side is up, which is what makes the flip reversible');

  const binBefore = [...bin(h, P)];
  whiteBox(h, e => { e.destroy(e.entity(sv)!, 'dies'); });

  assert.equal(ent(h, sv), undefined, 'it left play');
  assert.equal(countIn(bin(h, P), 'Scholar of the Void'),
    countIn(binBefore, 'Scholar of the Void') + 1,
    'the card in the bin is the FRONT face — "in all zones, other than play, it exists as the '
    + 'front side"');
  assert.equal(countIn(bin(h, P), 'Beyond, Codex Incarnate'), 0,
    'the back face reaches no zone but play, so no exhume or bin-play can ever fetch a 0-cost 8/3');
  assert.equal(countIn(erasedOf(h, P), 'Beyond, Codex Incarnate'), 0,
    'and NOTHING is erased: it was never a token, so R69 has nothing to sweep');
  assert.ok(h.log.some(l => l.includes('turns back over')),
    'the flip is announced — whether a card is recoverable is a real play decision');
});

// The consequence the ruling is FOR, end to end. A bin entry that no card can
// reach is a technicality; this drives a real recursion effect at it. Hooba-Mon
// fetches "target unit in your bin with cost 3 or less" and Scholar of the Void
// is a dd/1, so a Scholar that transformed, fought as an 8/3 and died comes
// back — as a Scholar. Under R101 that bin entry did not exist at all.
test('R157 §10: a transformed Scholar that died is RECURRABLE from the bin, as a Scholar', () => {
  const h = new Harness(13505);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  const sv = spawn(h, P, 'Scholar of the Void');
  const hooba = spawn(h, P, 'Hooba-Mon');
  toNextDeployment(h);
  pickBy(h, o => String(o.label).includes('transform into Beyond'));
  assert.equal(ent(h, sv)!.card, 'Beyond, Codex Incarnate', 'transformed');
  whiteBox(h, e => { e.destroy(e.entity(sv)!, 'dies'); });
  assert.ok(bin(h, P).includes('Scholar of the Void'), 'and binned as its front face');

  // now recur it: Hooba-Mon attacks and exchanges itself for a bin unit ≤ 3
  toNextBattle(h, P);
  h.do({ type: 'declareAttack', seat: P, columns: [[hooba]] });
  assert.ok(h.state.decision!.options.some(o => String(o.label).includes('Scholar of the Void')),
    'the binned Scholar is on the menu of a real recursion effect — this is the whole point of '
    + '§10: under R101 the card had been ERASED and there was nothing here to offer');
  pick(h, { bin: { seat: P, card: 'Scholar of the Void' } });
  drainStack(h);

  const back = unitsOf(h, P).find(u => u.card === 'Scholar of the Void');
  assert.ok(back, 'it is in play again');
  assert.ok(!back!.token, 'as a real card, not a token');
  assert.equal(back!.frontFace, undefined, 'front side up — a fresh copy is not mid-transform');
});

// ══════════════════════════════════════════════════════════════════════
// §27 — PRINTED TEXT BEATS THE OWNER DEFAULT
// ══════════════════════════════════════════════════════════════════════
//
// > "Controller's cache — the printed text wins. Printed text always wins."
// >   — Bena, 2026-08-25
//
// Grob prints "Up to one target unit's CONTROLLER caches it". E.cacheUnit
// always cached to `u.owner`, and the two differ only after a control change —
// which four cards in the pool produce. `giveControl` is the choke point all of
// them go through (R148/CT-38), so it is what this drives.
test('R157 §27: Grob caches a STOLEN unit into the CONTROLLER’s cache, not the owner’s', () => {
  const h = new Harness(13506);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const grob = spawn(h, A, 'Grob');
  const stolen = spawn(h, D, 'Good Whale');
  whiteBox(h, e => { e.giveControl(e.entity(stolen)!, A); });
  assert.equal(ent(h, stolen)!.controller, A, 'A controls it…');
  assert.equal(ent(h, stolen)!.owner, D, '…and D still owns it. This is the only state where the '
    + 'printed text and the engine default disagree.');

  toNextBattle(h, A);
  // both attack, so both stand in the battle region — every target is
  // region-scoped (R12)
  h.do({ type: 'declareAttack', seat: A, columns: [[grob], [stolen]] });
  pick(h, { unit: stolen });
  drainStack(h);

  assert.equal(ent(h, stolen), undefined, 'the unit left play');
  assert.deepEqual(cacheOf(h, A), ['Good Whale'],
    'PRINTED TEXT WINS: the card is in the CONTROLLER’s cache, with the prophecy Grob granted');
  assert.deepEqual(cacheOf(h, D), [],
    'and not in the owner’s, which is where E.cacheUnit used to put it unconditionally');
  assert.ok(new E(h.state).cache(A)[0]!.prophecy, 'the granted prophecy rode along');
});

// …and it is NOT a blanket change of the default, which is the other half of
// "printed text wins". Waxen Witness prints a bare "Cache target unit" — it
// names no seat, so the base-rules owner default stands, and the same stolen
// unit goes to the OWNER's cache. Same primitive, same board, opposite answer,
// decided entirely by what the card says.
test('R157 §27 control: Waxen Witness names no seat, so a stolen unit still caches to its OWNER', () => {
  const h = new Harness(13507);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Grox');
  const stolen = spawn(h, D, 'Good Whale');
  whiteBox(h, e => { e.giveControl(e.entity(stolen)!, A); });
  giveResources(h, A, 'light', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk], [stolen]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Waxen Witness') });
  pick(h, { unit: stolen });
  pass(h); pass(h);

  assert.equal(ent(h, stolen), undefined, 'the unit left play');
  assert.deepEqual(cacheOf(h, D), ['Good Whale'],
    'the OWNER’s cache — Waxen Witness prints no seat, so the default stands');
  assert.deepEqual(cacheOf(h, A), [], 'and the controller gets nothing');
  drainStack(h);
});

// ══════════════════════════════════════════════════════════════════════
// §8 — DROPSLIME'S DISCARD LINE IS AN ACTIVATED ABILITY FROM HAND
// ══════════════════════════════════════════════════════════════════════
//
// > "It doesn't have a battle icon, but that is just an activated ability that
// >  you do from hand, so it can be done during battle just fine."
// >   — Bena, 2026-08-25
//
// ⚠ THIS ONE WAS FILED AS A DEFECT AND IS NOT ONE, and the test is worth more
// for saying so than for what it changes: nothing. The claim under R157 §8 was
// that `printed.json` gives the discardMe mode no `timing` key, so it inherits
// the card's `deploy` timing, so the mode "can never deal damage" because the
// per-battle trash ledger is 0 outside battle. Measured, that is false. R65
// had already ruled a missing {Battle} marker to be NO restriction — the
// timing field is consulted in exactly one direction, `(c.discardMe.timing ??
// c.timing) !== 'battle'`, which keeps a {Battle}-MARKED line (Nothyr) out of
// DEPLOYMENT — and `legalBattlePriorityActions` offers every payable
// discard-me line with no timing gate at all. So the mode is live in battle,
// the ledger it reads counts its own trash, and the damage lands.
//
// What R157 §8 does change is two comments in batch-dark-b.ts that asserted
// the opposite; they are corrected, and this locks the behaviour they were
// wrong about.
test('R157 §8: Dropslime’s discard-me mode is offered IN BATTLE and deals damage there', () => {
  const h = new Harness(13508);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  giveResources(h, A, 'dark', 1);
  const idx = give(h, A, 'Dropslime');

  assert.equal(h.state.phase, 'battle', 'we are in a battle priority window');
  assert.ok(h.legal(A).some(a =>
    a.type === 'playCard' && a.handIndex === idx && a.mode === 'discardMe'),
  'the discard-me mode is OFFERED in battle. The missing {Battle} marker is not a restriction '
  + '(R65, confirmed by R157 §8) — it only ever restricts a MARKED line out of deployment.');

  const lifeD = h.state.players[D]!.life;
  h.do({ type: 'playCard', seat: A, handIndex: idx, mode: 'discardMe' });
  assert.ok(h.state.decision, 'its own trash trigger fires from the bin and asks for a target');
  pick(h, { player: D });
  drainStack(h);

  assert.ok(bin(h, A).includes('Dropslime'), 'the card was discarded');
  assert.equal(h.state.players[D]!.life, lifeD - 1,
    'and it dealt damage: the per-battle trash ledger counts Dropslime’s OWN trash (bumped before '
    + 'the trigger fires), so playing the mode into your own attack is 1 damage as a floor — not '
    + 'the 0 the batch header used to claim was unavoidable');
});
