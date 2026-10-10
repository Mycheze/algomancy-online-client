/**
 * R341 — a copy's copied AUGMENT mods work: it carries each copied mod's
 * [Augment] box (extends R336, which made copied grafts run).
 *
 * Borrower of Forms: "Erase target unit. I become an exact copy of that unit
 * (I copy all stat changes, counters, card text and mods)." RAQ "[Solved &
 * Expanding?] Borrower of Forms - The weird interactions" (_passer quoting
 * Caleb): "it inherits all of the combined text". R118 ruling 2: "Inherit the
 * mods text".
 *
 * What is pinned, channel by channel — each one the channel a REAL augment
 * mod's box reaches: type-line attrs (Chitin Shredder's {Powerful}), the
 * activated [Augment] text and its R9 [once] budget (Graxxlid), the
 * continuous box (Dreadspawn Horror's static), the triggered [Augment] text
 * (Mirage Scuttler). And what is NOT copied: no mod entity, no Unstable, no
 * second card in any bin. The copied text is part of the copy's card text, so
 * a stripper takes it (R328).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { legalActions } from '../src/apply.ts';
import {
  effStats, ent, finishBattle, give, giveResources, ownAttrs, pass, pick, spawn, toDeployment,
  toNextBattle, unitsOf, withE as whiteBox,
} from './util.ts';
import type { Action, Seat } from '../src/types.ts';

/** pass priority until `seat` holds it */
function passTo(h: Harness, seat: Seat): void {
  let guard = 8;
  while (h.state.priority !== seat && guard-- > 0) pass(h);
  assert.equal(h.state.priority, seat, 'priority reached the acting seat');
}

/** answer every open question with its first option and drain the stack */
function drain(h: Harness): void {
  let guard = 60;
  while ((h.state.stack.length || h.state.decision) && guard-- > 0) {
    const d = h.state.decision;
    if (d?.pickOrder) h.do({ type: 'decide', seat: d.seat, choice: d.options.map((_, i) => i) });
    else if (d) pick(h, d.options[0]!.value);
    else { pass(h); pass(h); }
  }
}

function borrow(h: Harness, A: Seat, target: number): number {
  giveResources(h, A, 'metal', 7);
  passTo(h, A);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Borrower of Forms') });
  pick(h, { unit: target });
  drain(h);
  return unitsOf(h, A).find(u => u.card === 'Borrower of Forms')!.id;
}

/**
 * A attacks into D's home region, where D holds a `hostCard` carrying `mods`
 * (augments); A's Borrower of Forms erases it and becomes it.
 */
function borrowModded(seed: number, hostCard: string, mods: string[]) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  let host = -1;
  h.state.players[D]!.hand = [];                              // Dreadspawn Horror's host must live,
  h.state.players[A]!.hand = [];                              // and so must its copy
  whiteBox(h, e => {
    host = e.spawnUnit(D, hostCard, e.homeRegion(D)).id;
    for (const m of mods) e.attachMod(e.s.entities[host]!, m, D, 'augment');
  });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const bof = borrow(h, A, host);
  return { h, A, D, host, bof };
}

const GRAX: Action['type'] = 'activateAbility';
const graxOffers = (h: Harness, seat: Seat, id: number) => legalActions(h.state, seat).filter(a =>
  a.type === GRAX && a.entityId === id && typeof a.via === 'object' && 'face' in a.via
  && a.via.face === 'Graxxlid' && a.via.text === 'augment');

test('R341: a Borrower that copied a unit carrying a Powerful virus is Powerful — and is not itself modded or Unstable', () => {
  const { h, bof } = borrowModded(40601, 'Good Whale', ['Chitin Shredder']);
  const u = ent(h, bof)!;
  assert.equal(u.mods.length, 0, 'no mod entity was cloned (R336)');
  assert.deepEqual(u.copies?.[0]?.mods, [{ card: 'Chitin Shredder', appliedAs: 'augment' }], 'the face records it');
  assert.ok(ownAttrs(h, bof).has('Powerful'), 'the copied [Augment] {Powerful} is the copy\'s');
  let unstable = true;
  whiteBox(h, e => { unstable = e.isUnstable(e.s.entities[bof]!); });
  assert.equal(unstable, false, 'and the copy is not Unstable (R336 / CT-225)');
  finishBattle(h);
});

test('R341: when that copy dies, only Borrower of Forms goes to the bin — nothing is erased, no virus binned', () => {
  const { h, A, D, bof } = borrowModded(40602, 'Good Whale', ['Chitin Shredder']);
  const binA = [...h.state.players[A]!.bin], binD = [...h.state.players[D]!.bin];
  const erasedA = [...(h.state.players[A]!.erased ?? [])], erasedD = [...(h.state.players[D]!.erased ?? [])];
  whiteBox(h, e => { e.destroy(e.s.entities[bof]!, 'dies'); });
  assert.ok(!ent(h, bof), 'it died');
  assert.deepEqual(h.state.players[A]!.bin.slice(binA.length), ['Borrower of Forms'], 'one card to A\'s bin, the physical one');
  assert.deepEqual(h.state.players[D]!.bin.slice(binD.length), [], 'nothing to D\'s bin');
  assert.deepEqual((h.state.players[A]!.erased ?? []).slice(erasedA.length), [], 'nothing erased for A');
  assert.deepEqual((h.state.players[D]!.erased ?? []).slice(erasedD.length), [], 'nothing erased twice for D');
  finishBattle(h);
});

test('R341: a Borrower that copied a Graxxlid-augmented unit can use Graxxlid — once, on its own [once] budget', () => {
  const { h, A, D, bof } = borrowModded(40603, 'Bubb', ['Graxxlid']);
  giveResources(h, A, 'earth', 2);
  giveResources(h, D, 'fire', 4);                             // two Channeled Boons, rr/2 each
  assert.equal(graxOffers(h, A, bof).length, 0, 'nothing aims at it yet: not offered');
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Channeled Boon') });
  pick(h, { unit: bof });                                     // aimed at the copy
  const boon = h.state.stack[h.state.stack.length - 1]!.id;
  passTo(h, A);
  assert.equal(graxOffers(h, A, bof).length, 1, 'Graxxlid\'s ability is offered on the copy, once');
  const handD = h.state.players[D]!.hand.length;
  h.do({ type: 'activateAbility', seat: A, entityId: bof, abilityIndex: 0, via: { face: 'Graxxlid', text: 'augment' } });
  pick(h, { stack: boon });
  pass(h); pass(h);                                           // Graxxlid's negate resolves
  assert.ok(!h.state.stack.some(i => i.id === boon), 'the Boon is negated');
  assert.equal(h.state.players[D]!.hand.length, handD + 1, 'and its controller draws');
  assert.equal(ent(h, bof)!.budgets['augment:Graxxlid#0'], 1, 'the [once] is spent on the copy (R9, the real mod\'s key)');
  // a second Boon at the copy: the [once] is gone
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Channeled Boon') });
  pick(h, { unit: bof });
  passTo(h, A);
  assert.equal(graxOffers(h, A, bof).length, 0, 'not offered a second time this turn');
  assert.throws(() => h.do({ type: 'activateAbility', seat: A, entityId: bof, abilityIndex: 0,
    via: { face: 'Graxxlid', text: 'augment' } }), /already used/, 'and refused');
  finishBattle(h);
});

test('R341: the address is refused on a unit that copied no Graxxlid', () => {
  const { h, A, bof } = borrowModded(40604, 'Bubb', []);
  passTo(h, A);
  assert.throws(() => h.do({ type: 'activateAbility', seat: A, entityId: bof, abilityIndex: 0,
    via: { face: 'Graxxlid', text: 'augment' } }), /does not have that ability/);
  finishBattle(h);
});

test('R341: a copied [Augment] static box radiates off the copy (Dreadspawn Horror: -1/-1 per card in hand)', () => {
  const { h, A, bof } = borrowModded(40605, 'Good Whale', ['Dreadspawn Horror']);
  h.state.players[A]!.hand = ['Geode', 'Geode'];
  assert.deepEqual(effStats(h, bof), [5, 3], 'the borrowed 7/5, less two for A\'s two cards');
  h.state.players[A]!.hand = [];
  assert.deepEqual(effStats(h, bof), [7, 5], 'and live: an empty hand takes nothing');
  finishBattle(h);
});

test('R341: copied [Augment] triggered text fires off the copy (Mirage Scuttler: survive damage, gain counters)', () => {
  const { h, A, D, bof } = borrowModded(40606, 'Good Whale', ['Mirage Scuttler']);
  void A;
  let fire = -1;
  whiteBox(h, e => { fire = e.createSpellToken(D, 'Fireball', 2, e.s.battle!.region).id; });
  passTo(h, D);
  h.do({ type: 'castSpellToken', seat: D, entityId: fire });
  pick(h, { unit: bof });
  drain(h);
  assert.equal(ent(h, bof)!.damage, 2, 'the Fireball hit the copy');
  assert.equal(ent(h, bof)!.counters, 2, 'and the copied Scuttler text put two +1/+1 counters on it');
  finishBattle(h);
});

test('R341: a copy of an unmodded unit is exactly what it was — no copied mods, no extra text', () => {
  const { h, A, bof } = borrowModded(40607, 'Good Whale', []);
  assert.equal(ent(h, bof)!.copies?.[0]?.mods, undefined, 'the face records no mods');
  let copied: readonly string[] = ['x'];
  whiteBox(h, e => { copied = e.copiedAugments(e.s.entities[bof]!, 'attrs'); });
  assert.deepEqual(copied, [], 'and copiedAugments answers nothing');
  assert.ok(!ownAttrs(h, bof).has('Powerful'), 'a plain Good Whale is not Powerful');
  passTo(h, A);
  assert.ok(!legalActions(h.state, A).some(a => a.type === 'activateAbility' && a.entityId === bof),
    'and has nothing to activate');
  finishBattle(h);
});

test('R341 / R328: the copied augment text is the copy\'s card text — Suppression Field strips it', () => {
  const { h, A, D, bof } = borrowModded(40608, 'Bubb', ['Chitin Shredder', 'Graxxlid']);
  giveResources(h, A, 'earth', 2);
  giveResources(h, D, 'fire', 2);
  assert.ok(ownAttrs(h, bof).has('Powerful'), 'setup: Powerful');
  whiteBox(h, e => { e.suppress(e.s.entities[bof]!, 'Suppression Field', { attrs: true, abilities: true }); });
  assert.ok(!ownAttrs(h, bof).has('Powerful'), 'stripped of the copied attribute');
  passTo(h, D);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Channeled Boon') });
  pick(h, { unit: bof });
  passTo(h, A);
  assert.equal(graxOffers(h, A, bof).length, 0, 'and of the copied Graxxlid ability');
  finishBattle(h);
});

test('R341 / R328: Transmogrifant arriving after the copy takes the copied {Powerful}', () => {
  const { h, A, bof } = borrowModded(40609, 'Good Whale', ['Chitin Shredder']);
  assert.ok(ownAttrs(h, bof).has('Powerful'), 'setup: Powerful');
  whiteBox(h, e => { e.spawnUnit(A, 'Transmogrifant', e.s.entities[bof]!.region); });  // "Your other units … lose all attributes"
  assert.ok(!ownAttrs(h, bof).has('Powerful'), 'the copied attribute is as old as printed text, so it is taken');
  finishBattle(h);
});

test('R341: a copy of the copy chains — it carries the copied virus too', () => {
  const { h, A, bof } = borrowModded(40610, 'Good Whale', ['Chitin Shredder']);
  let tok = -1;
  whiteBox(h, e => {
    const t = e.spawnUnit(A, 'Unit Token', e.s.entities[bof]!.region, { token: true });
    tok = t.id;
    e.becomeCopy(t, e.s.entities[bof]!, { from: 'Apex Prime', until: 'regroup' });
  });
  assert.ok(ownAttrs(h, tok).has('Powerful'), 'Powerful, two copies removed from the real virus');
  assert.equal(ent(h, tok)!.mods.length, 0, 'still no mod entity');
  finishBattle(h);
});

test('R341: a copied [Augment] box radiates to OTHER units, and an adjacent Ancient One borrows it too', () => {
  const h = new Harness(40611);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const mimic = spawn(h, A, 'Unit Token');
  const ancient = spawn(h, A, 'Ancient One');                 // 1/1, "I have all abilities of adjacent allies"
  const bystander = spawn(h, A, 'Unit Token');                // 1/1, its own column
  spawn(h, D, 'Unit Token');
  whiteBox(h, e => {
    const src = e.spawnUnit(D, 'Good Whale', e.homeRegion(D));
    e.attachMod(src, 'Glowhaven Elder', D, 'augment');        // "[Augment] your OTHER units gain +1/+1"
    e.becomeCopy(e.s.entities[mimic]!, src, { from: 'Borrower of Forms', until: 'permanent' });
  });
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[mimic, ancient], [bystander]] });
  assert.deepEqual(effStats(h, bystander), [3, 3], 'the copy\'s copied Elder, and the Ancient One\'s borrowed one');
  assert.deepEqual(effStats(h, ancient), [2, 2], 'the copy\'s reaches the Ancient One; its own excludes itself');
  assert.deepEqual(effStats(h, mimic), [8, 6], 'a 7/5 Good Whale, +1/+1 only from the Ancient One — "OTHER" excludes the copy');
  finishBattle(h);
});
