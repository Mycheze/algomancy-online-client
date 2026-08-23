/* R68 — negation is REMOVAL from the stack.
 *
 * Playtest game UZRG, 2026-08-21: "Is negate supposed to remove effects from
 * the stack? I thought it was supposed to work by just removing them from the
 * stack and putting them into the bin (if a spell/unit), not just 'greying
 * them out' and removing their effect."
 *
 * It was not. `negate()` set a flag and left the item sitting there; the
 * removal-and-bin lived in resolveItem's negated branch, which only ran once
 * resolveTop() eventually popped it — and finishResolutionTail() restarts the
 * window after every resolution, so EACH negated item cost a whole extra
 * priority round to shuffle off. One Containment Protocol in UZRG negated four
 * items and then took eight further passPriority actions to clear them.
 *
 * The missing piece was a second exit from the stack. E.removeFromStack() is
 * it, and negate() is written over it. Seeds 6100-6199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import type { StackItem } from '../src/types.ts';
import {
  ent, finishBattle, give, giveResources, pass, pick, spawn, toDeployment,
  toNextBattle, tokensOf, unitsOf,
} from './util.ts';

/** raw engine calls against the harness state, absorbing a suspension */
function withE(h: Harness, fn: (e: E) => void): void {
  const e = new E(h.state);
  try { fn(e); e.settle(); } catch (sig) { if (!(sig instanceof Suspended)) throw sig; }
  h.state = e.s;
}

const binOf = (h: Harness, seat: number): string[] => h.state.players[seat]!.bin;
const handOf = (h: Harness, seat: number): string[] => h.state.players[seat]!.hand;
const count = (xs: string[], n: string): number => xs.filter(c => c === n).length;

// ── the UZRG position ───────────────────────────────────────────────────

test('R68: a mass negate empties the stack of its victims AT ONCE — no extra priority rounds', () => {
  // the UZRG shape: four triggered abilities and one spell on the stack, and a
  // Containment Protocol that answers the four. Before R68 the four stayed on
  // the stack greyed out and cost eight further passPriority actions.
  const h = new Harness(6100);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as 0 | 1;
  const heralds = [0, 1, 2, 3].map(() => spawn(h, A, 'Warbloom Herald'));
  giveResources(h, D, 'light', 2);                          // Godray ll/2
  giveResources(h, D, 'metal', 3);                          // Containment Protocol mm/3
  const lifeA = h.state.players[A]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: heralds.map(u => [u]) });
  assert.equal(h.state.stack.length, 4, 'four attack triggers');
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Godray') });
  pick(h, { player: A });
  assert.equal(h.state.stack.length, 5, 'four triggers + one spell');
  pass(h);                                                  // A declines
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Containment Protocol') });
  pass(h); pass(h);                                         // the Protocol resolves

  assert.equal(h.state.stack.length, 1, 'the four negated triggers are GONE, not greyed out');
  assert.ok(h.state.stack[0]!.label.includes('Godray'), 'only the un-negated remainder is left');
  assert.equal(h.log.filter(l => l.includes('is negated')).length, 4, 'all four were negated');
  // a negated ABILITY has no card of its own — nothing is binned for it
  assert.equal(count(binOf(h, A), 'Warbloom Herald'), 0, 'the source cards are still in play');

  // and the very NEXT priority round resolves the survivor: zero passes were
  // spent popping dead items
  pass(h); pass(h);
  assert.equal(h.state.players[A]!.life, lifeA - 3, 'the Godray resolved on the next window');
  assert.equal(h.state.stack.length, 0);
  finishBattle(h);
});

// ── the kind: 'unit' hole ───────────────────────────────────────────────

test("R68: a negated kind:'unit' item reaches its owner's bin (it used to be erased into nowhere)", () => {
  // The old negated branch gated the bin push on spell/spellUnit/virus/ambush
  // but gated the "→ bin" LOG on kind !== spellToken/triggered/activated. A
  // {Battle} unit caught mid-cast therefore logged "→ bin" and vanished.
  const h = new Harness(6101);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as 0 | 1;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'metal', 1);                          // Monke: m/1 {Battle} unit
  giveResources(h, D, 'light', 2);                          // Calming Force: ll/2
  const trashesBefore = h.events.filter(ev => ev.type === 'trashed').length;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Monke') });
  assert.equal(h.state.stack[0]!.kind, 'unit', "a {Battle} unit is a kind:'unit' stack item");
  // R100: Calming Force "can't be played from your hand", so the negator gets
  // onto the stack the way it now has to — cached with R45's glimpse stamp and
  // released from there (the mana is still paid, which is what the `light 2`
  // above is for). This test is about R68 — what happens to the NEGATED item —
  // so the route the negator took to the stack is scenery, not the subject.
  withE(h, e => { e.cacheCard(D, 'Calming Force', 'deck', { playable: true }); });
  h.do({ type: 'playCached', seat: D, index: 0 });
  pass(h); pass(h);                                         // Calming Force resolves

  assert.equal(h.state.stack.length, 0, 'the negated unit left the stack');
  assert.ok(!unitsOf(h, A).some(u => u.card === 'Monke'), 'it never spawned');
  assert.equal(count(binOf(h, A), 'Monke'), 1, 'and the CARD is in its bin, exactly once');
  assert.equal(h.events.filter(ev => ev.type === 'trashed').length, trashesBefore,
    'R40: from the stack, so still not a trash');
  finishBattle(h);
});

test('R68: a negated spell TOKEN is erased, never binned', () => {
  const h = new Harness(6102);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as 0 | 1;
  const atk = spawn(h, A, 'Unit Token');
  giveResources(h, D, 'light', 2);
  const lifeD = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  let fb = 0;
  withE(h, e => { fb = e.createSpellToken(A, 'Fireball', 1, e.s.battle!.region).id; });
  h.do({ type: 'castSpellToken', seat: A, entityId: fb });
  pick(h, { player: D });
  // R100 again: the hand route is gone, so the cache release is the vehicle.
  withE(h, e => { e.cacheCard(D, 'Calming Force', 'deck', { playable: true }); });
  h.do({ type: 'playCached', seat: D, index: 0 });
  pass(h); pass(h);
  assert.equal(h.state.stack.length, 0, 'the negated token left the stack');
  assert.equal(count(binOf(h, A), 'Fireball'), 0, 'a token never reaches a bin (R40)');
  assert.equal(h.state.players[D]!.life, lifeD, 'and it dealt nothing');
  finishBattle(h);
});

test('R68: removeFromStack is the bare primitive — it moves nothing but the item', () => {
  const h = new Harness(6103);
  toDeployment(h);
  const P = h.state.deployPlayer!;
  withE(h, e => {
    const item: StackItem = {
      id: e.s.nextId++, kind: 'spell', card: 'Test Bin Spell', label: 'Test Bin Spell',
      controller: P, region: e.homeRegion(P), negated: false, parts: [],
    };
    e.s.stack.push(item);
    const got = e.removeFromStack(item.id);
    assert.equal(got, item, 'the item itself comes back');
    assert.equal(e.s.stack.length, 0, 'and it is off the stack');
    assert.equal(e.removeFromStack(item.id), undefined, 'a second call finds nothing');
  });
  assert.equal(count(binOf(h, P), 'Test Bin Spell'), 0,
    'removeFromStack does NOT bin — the caller decides where the card goes');
});

// ── the three cards that used to hand-roll the removal ──────────────────

test('R68: Temporal Rift bins each negated card exactly once', () => {
  // it used to call negate() AND push the card itself AND clear the stack by
  // hand; with negate() doing the removal that would be a duplicate bin entry
  const h = new Harness(6104);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as 0 | 1;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'fire', 2);                             // Luminous Arc r/2
  giveResources(h, D, 'water', 2);
  giveResources(h, D, 'metal', 2);                            // Temporal Rift bmm/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: whale });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Temporal Rift') });
  pass(h); pass(h);                                           // the Rift resolves
  assert.equal(h.state.stack.length, 0, 'the stack is wiped');
  assert.equal(count(binOf(h, A), 'Luminous Arc'), 1, 'the negated Arc is binned ONCE');
  assert.equal(count(binOf(h, D), 'Temporal Rift'), 1, 'and the Rift itself once');
  assert.ok(ent(h, whale), 'the Arc never dealt its damage');
});

test('R68: Dream Lapse recalls the card to hand and does NOT also bin it', () => {
  const h = new Harness(6105);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as 0 | 1;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');
  giveResources(h, D, 'fire', 2);                             // Luminous Arc r/2
  giveResources(h, A, 'water', 1);
  giveResources(h, A, 'dark', 1);                             // Dream Lapse bd/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                                    // hand D the window
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Luminous Arc') });
  pick(h, { unit: whale });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Dream Lapse') });
  pick(h, { stack: h.state.stack[0]!.id });
  pass(h); pass(h);                                           // Dream Lapse resolves
  if (h.state.decision) pick(h, 0);                           // "then its controller discards"
  assert.ok(!h.state.stack.some(i => i.label.includes('Luminous Arc')),
    'the recalled item left the stack');
  assert.equal(count(binOf(h, D), 'Luminous Arc'), 0,
    'a recall is NOT a negate-to-bin — the card must not be duplicated into the bin');
  assert.equal(count(handOf(h, D), 'Luminous Arc') + count(binOf(h, D), 'Luminous Arc'), 1,
    'exactly one copy of the card exists, wherever the discard put it');
});

test('R68: Cosmic Reversal puts every recalled spell in its owner’s hand, none in a bin', () => {
  const h = new Harness(6106);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as 0 | 1;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'fire', 4);                             // two Luminous Arcs, r/2 each
  giveResources(h, D, 'water', 2);                            // Cosmic Reversal bb/2
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: whale });
  pass(h);                                                    // D declines → back to A
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: whale });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Cosmic Reversal') });
  pass(h); pass(h);                                           // Cosmic Reversal resolves
  assert.equal(h.state.stack.length, 0, 'both Arcs left the stack');
  assert.equal(count(handOf(h, A), 'Luminous Arc'), 2, 'both are back in A’s hand');
  assert.equal(count(binOf(h, A), 'Luminous Arc'), 0, 'and neither reached a bin');
  assert.ok(ent(h, whale), 'neither dealt its damage');
});

// ── the splice-during-iteration bug ─────────────────────────────────────

test('R68: Flame Shield counts every nontoken spell it negates (the iteration bug)', () => {
  // `for (const it of g.s.stack) g.negate(it.id)` used to skip every other
  // item once negate() started splicing — two Arcs would pay out one Fireball
  // and leave the second Arc alive on the stack.
  const h = new Harness(6107);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as 0 | 1;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'fire', 4);                             // two Luminous Arcs
  giveResources(h, D, 'fire', 4);                             // Flame Shield rr/4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: whale });
  pass(h);
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: whale });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Flame Shield') });
  assert.equal(h.state.stack.length, 3, 'two Arcs under the Shield');
  pass(h); pass(h);                                           // Flame Shield resolves

  assert.equal(h.state.stack.length, 0, 'BOTH Arcs were negated off the stack');
  assert.equal(tokensOf(h, D).filter(t => t.card === 'Fireball').length, 2,
    'one Fireball per nontoken spell negated — the loop saw both');
  assert.equal(count(binOf(h, A), 'Luminous Arc'), 2, 'both Arcs binned from the stack');
  assert.ok(ent(h, whale), 'and neither dealt its damage');
  finishBattle(h);
});

// ── the ⚠ ordering question ─────────────────────────────────────────────

test('R68 ⚠: Finality erases the very cards it just negated', () => {
  // "Negate all other effects. Erase all cards in bins." Under R68 the negated
  // card reaches the bin DURING the first sentence, so the second sentence
  // erases it. Before R68 it arrived a whole priority round later and survived.
  // THIS NEEDS A HUMAN RULING — the test pins what is implemented, not what is
  // necessarily right. See docs/digital-rules.md R68.
  const h = new Harness(6108);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as 0 | 1;
  const atk = spawn(h, A, 'Unit Token');
  const whale = spawn(h, D, 'Good Whale');
  giveResources(h, A, 'fire', 2);                             // Luminous Arc r/2
  giveResources(h, D, 'dark', 5);                             // Finality dd/5
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Luminous Arc') });
  pick(h, { unit: whale });
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Finality') });
  pass(h); pass(h);                                           // Finality resolves
  assert.equal(h.state.stack.length, 0, 'the negated Arc left the stack at once');
  assert.equal(count(binOf(h, A), 'Luminous Arc'), 0,
    '⚠ it was binned by the negation and then erased by the same resolution');
  assert.ok((h.state.players[A]!.erased ?? []).includes('Luminous Arc'),
    '⚠ and it is in the erased pile (R65) as a bin card, not as a negated one');
  assert.equal(count(binOf(h, D), 'Finality'), 1,
    'Finality itself is binned AFTER the erase, exactly as printed');
});
