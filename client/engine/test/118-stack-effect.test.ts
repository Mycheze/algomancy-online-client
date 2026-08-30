/* R128 — ANYTHING ON THE STACK IS AN EFFECT (R60 reversed).
 *
 * Owner, 2026-08-24, verbatim: "ANYTHING on the stack is an effect, including
 * units and spell units. Units aren't spells, so if they say 'spell effect' a
 * unit would be unaffected."
 *
 * R60 had carved a {Battle} unit mid-cast out of BOTH halves — not a spell,
 * and "not an effect at all, there are no parts to negate". The second half of
 * that is what the owner reversed. So:
 *   - 'stackEffect' ("target effect") is now LITERALLY every item on the stack.
 *   - 'stackSpell' ("target SPELL effect") is unchanged and still refuses a
 *     plain unit — a unit is not a spell — while a SPELL unit stays spell-side.
 *   - "target NONSPELL effect" (Nothyr) is the complement, so it GAINS the
 *     plain unit.
 *   - The all-effect sweeps (Finality, Return to Nature, Temporal Rift) were
 *     already taking units. R128 says that was right; they are pinned, not
 *     narrowed.
 *
 * Seeds 12800-12809.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { EntityId, Seat } from '../src/types.ts';
import {
  give, giveResources, notOffered, offered, pass, pick, spawn, toDeployment,
  toNextBattle, unitsOf,
} from './util.ts';

/** A battle with `A` attacking with one body, priority open to A, so that a
 * {Battle} card played now reaches the stack and can be answered. Returns the
 * two seats and the attacker's id. */
function openBattle(h: Harness): { A: Seat; D: Seat; attacker: EntityId } {
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat, D = (1 - A) as Seat;
  const attacker = spawn(h, A, 'Good Whale');
  return { A, D, attacker };
}

/** Put A's {Battle} unit Monke on the stack (a 'unit' item — the kind R60
 * refused to call an effect) and return its stack id. */
function monkeOnStack(h: Harness, A: Seat): number {
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Monke') });
  const it = h.state.stack[h.state.stack.length - 1]!;
  assert.equal(it.kind, 'unit', 'Monke is on the stack as a plain unit item');
  assert.equal(it.parts.length, 0, 'and it has NO parts — R60\'s whole argument');
  return it.id;
}

const named = (h: Harness, seat: Seat, card: string): boolean =>
  unitsOf(h, seat).some(u => u.card === card);

// ── "target effect" reaches a unit ───────────────────────────────────────

test('R128: a unit on the stack is a legal "target effect" (Dematerialize)', () => {
  const h = new Harness(12800);
  const { A, D, attacker } = openBattle(h);
  giveResources(h, A, 'metal', 2);
  giveResources(h, D, 'water', 2); giveResources(h, D, 'metal', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[attacker]] });
  const monke = monkeOnStack(h, A);

  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Dematerialize') });
  assert.equal(h.state.decision!.kind, 'targets');
  assert.deepEqual(offered(h), [JSON.stringify({ stack: monke })],
    'R128: the unit on the stack IS the effect Dematerialize may target');
});

test('R128: negating a unit on the stack — it never arrives, and its card is binned (R68)', () => {
  const h = new Harness(12801);
  const { A, D, attacker } = openBattle(h);
  giveResources(h, A, 'metal', 2);
  giveResources(h, D, 'water', 2); giveResources(h, D, 'metal', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[attacker]] });
  const monke = monkeOnStack(h, A);

  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Dematerialize') });
  pick(h, { stack: monke });
  pass(h); pass(h);                                   // resolve Dematerialize

  assert.ok(h.log.some(l => l.includes('Monke is negated → bin')),
    'the unit item was negated and its CARD took the bin branch (NEGATE_BINS)');
  assert.ok(!h.state.stack.some(i => i.id === monke), 'R68: it left the stack at once');
  assert.ok(!named(h, A, 'Monke'), 'the unit never arrived in play');
  assert.ok(h.state.players[A]!.bin.includes('Monke'),
    'R68: a negated card goes to its controller\'s bin — a unit has a real card to land');
});

test('R128: negating a SPELL unit on the stack — no body, card binned', () => {
  const h = new Harness(12802);
  const { A, D, attacker } = openBattle(h);
  giveResources(h, A, 'water', 4);
  giveResources(h, D, 'water', 2); giveResources(h, D, 'metal', 2);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[attacker]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Jelly') });
  pick(h, { unit: attacker });                        // Jelly's own -2/-2 target
  const jelly = h.state.stack[h.state.stack.length - 1]!;
  assert.equal(jelly.kind, 'spellUnit');

  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Dematerialize') });
  pick(h, { stack: jelly.id });
  pass(h); pass(h);

  assert.ok(h.log.some(l => l.includes('Jelly is negated → bin')));
  assert.ok(!named(h, A, 'Jelly'), 'the spell unit\'s body never spawned');
  assert.ok(h.state.players[A]!.bin.includes('Jelly'), 'and its card is in the bin');
});

// ── "target NONSPELL effect" gains the unit ──────────────────────────────

test('R128: Nothyr\'s "target nonspell effect" reaches a unit on the stack', () => {
  const h = new Harness(12803);
  const { A, D, attacker } = openBattle(h);
  giveResources(h, A, 'metal', 2);
  giveResources(h, D, 'dark', 2);                     // the "2 [d] Discard Me" line
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[attacker]] });
  const monke = monkeOnStack(h, A);

  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Nothyr'), mode: 'discardMe' });
  assert.equal(h.state.decision!.kind, 'targets');
  assert.ok(offered(h).includes(JSON.stringify({ stack: monke })),
    'a unit is an effect (R128) and is not a spell (same sentence) — so it is a NONSPELL effect');
  pick(h, { stack: monke });
  pass(h); pass(h);                                   // resolve Nothyr's trigger

  assert.ok(h.log.some(l => l.includes('Monke is negated → bin')));
  assert.ok(!named(h, A, 'Monke'), 'the unit never arrived');
});

// ── "target SPELL effect" does NOT ───────────────────────────────────────

test('R128: "target spell effect" refuses a plain unit but takes a spell unit', () => {
  const h = new Harness(12804);
  const { A, D, attacker } = openBattle(h);
  giveResources(h, A, 'metal', 2); giveResources(h, A, 'water', 2); giveResources(h, A, 'dark', 2);
  giveResources(h, D, 'water', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[attacker]] });
  const monke = monkeOnStack(h, A);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Jelly') });
  pick(h, { unit: attacker });
  const jelly = h.state.stack[h.state.stack.length - 1]!;
  assert.equal(jelly.kind, 'spellUnit');

  // "Recall target SPELL effect" — 'stackSpell', unchanged by R128
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Dream Lapse') });
  assert.equal(h.state.decision!.kind, 'targets');
  notOffered(h, { stack: monke }, 'a unit is not a spell (owner, R128)');
  assert.deepEqual(offered(h), [JSON.stringify({ stack: jelly.id })],
    'a SPELL unit stays spell-side: it is a spell that becomes a unit');
});

// ── the all-effect sweeps: confirmed, not narrowed ───────────────────────

test('R128: Finality\'s "negate all other effects" still catches a unit on the stack', () => {
  const h = new Harness(12805);
  const { A, D, attacker } = openBattle(h);
  giveResources(h, A, 'metal', 2);
  giveResources(h, D, 'dark', 6);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[attacker]] });
  monkeOnStack(h, A);

  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Finality') });
  pass(h); pass(h);                                   // resolve Finality

  assert.ok(h.log.some(l => l.includes('Monke is negated')),
    'the audit had flagged this sweep as possibly too wide; R128 settles it the other way');
  assert.ok(!named(h, A, 'Monke'), 'the unit never arrived');
  assert.equal(h.state.stack.length, 0);
});

// ── no path assumes item.parts.length > 0 ────────────────────────────────

test('R128: an effect that walks the targeted item\'s parts survives a unit\'s empty part list', () => {
  const h = new Harness(12806);
  const { A, D, attacker } = openBattle(h);
  giveResources(h, A, 'metal', 2);
  giveResources(h, D, 'fire', 4);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[attacker]] });
  const monke = monkeOnStack(h, A);

  // "Change the targets of target effect unless its controller pays [x]."
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Gravitational Correction') });
  h.do({ type: 'decide', seat: h.state.decision!.seat, choice: 0 });   // X = 0
  pick(h, { stack: monke });
  pass(h); pass(h);
  // the item's controller declines the (zero) ransom, so the retarget runs
  const dec = h.state.decision!;
  h.do({ type: 'decide', seat: dec.seat, choice: dec.options.findIndex(o => o.value === false) });

  assert.ok(h.log.some(l => l.includes('Monke has no target to change')),
    'a unit item has no parts and no declared targets — the walk is a clean no-op, not a crash');
  assert.ok(h.state.stack.some(i => i.id === monke), 'and the unit is untouched on the stack');
});
