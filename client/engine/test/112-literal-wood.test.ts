/* The 2026-08-24 LITERAL-READING audit of batch-wood-b/c and batch-earth-a/b.
 *
 * R125's principle — "when a printed text carries no qualifier, do not invent
 * one… the narrow reading was the shape of the mechanism that happened to be
 * built first, quietly promoted into a rule about the card" — applied to three
 * sentences whose code was narrower than their words:
 *
 *  1. Phytochemical Protection, "prevent ALL damage that would be dealt to
 *     target unit", vs Oorblak's card-side unit-damage commit (a THIRD commit
 *     that never passed through E.preventUnitDamage).
 *  2. Woodland Warding, "negate all enemy effects targeting allied effects,
 *     players or units", vs a VIRUS — a stack item with no parts and no target
 *     refs, which the designer calls a targeted effect in as many words.
 *  3. Return to Nature, "Erase ALL mods", vs a mod on a spell token (R89).
 *
 * Seeds 11200-11299.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Attr, EntityId, Seat } from '../src/types.ts';
import {
  assignDefault, ent, give, giveResources, ownAttrs, pass, pick,
  spawn, toDeployment, toNextBattle,
} from './util.ts';

/** spawn a stat token (no triggers) into a seat's home region */
function spawnToken(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const e = new E(h.state);
  const u = e.spawnUnit(seat, 'Unit Token', e.homeRegion(seat), { token: true, tokenStats: [p, t] });
  e.settle();
  return u.id;
}

/** grant an attribute until regroup (tempAttrs; read by ownAttrs/colAttrs) */
function attrOn(h: Harness, id: EntityId, attr: Attr): void {
  const e = new E(h.state);
  e.addTempAttr(e.entity(id)!, attr);
  e.settle();
}

/** D casts Phytochemical Protection on its own unit in the attack window */
function shield(h: Harness, seat: Seat, unit: EntityId): void {
  h.do({ type: 'playCard', seat, handIndex: give(h, seat, 'Phytochemical Protection') });
  pick(h, { unit });
  pass(h); pass(h);                                   // the spell resolves
  assert.equal(ent(h, unit)!.damageShield, 'Phytochemical Protection', 'the shield is up');
}

// ── 1. "prevent ALL damage that would be dealt to target unit" ───────────
//
// The redirect is a REPLACEMENT and still happens ("replacing the damage does
// NOT unmake it", Caleb 2024-10-24); the shield is a PREVENTION and unmakes
// what was redirected ("if there is not damage being dealt, then no counters
// are placed", RAQ). So: no damage on the body, a +1/+1 counter per point, and
// the life total still spared by the redirect.

test('Phytochemical Protection prevents the combat damage Oorblak redirects onto itself', () => {
  const h = new Harness(11200);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawnToken(h, A, 3, 3);
  const oo = spawn(h, D, 'Oorblak');                   // 2/4, the defender's
  giveResources(h, D, 'wood', 2);                      // gg / 2
  const lifeD = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                             // A passes → D holds priority
  shield(h, D, oo);
  pass(h); pass(h);                                    // attack window → block step
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                    // → combat damage
  assignDefault(h);
  assert.equal(h.state.players[D]!.life, lifeD, 'the redirect still spares the life total');
  assert.ok(ent(h, oo), 'Oorblak is alive');
  assert.equal(ent(h, oo)!.damage, 0,
    'PREVENTED means not dealt — the redirected 3 never lands as damage');
  assert.equal(ent(h, oo)!.counters, 3,
    'a +1/+1 counter for each damage prevented this way');
  assert.ok(h.log.some(l => l.includes('prevents all 3 damage to Oorblak')),
    'the prevention is logged through the one choke point');
});

test('Phytochemical Protection does not change what Oorblak absorbs — the Piercing excess still reaches the face', () => {
  // RAQ's assignment rule, restated on the replacement side: the shield is a
  // COMMIT-time layer and must not make the attacker's damage go anywhere
  // else. 5 Piercing, a 2/4 body: 4 is absorbed (and then prevented), 1 spills.
  const h = new Harness(11201);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawnToken(h, A, 5, 1);
  attrOn(h, atk, 'Piercing');
  const oo = spawn(h, D, 'Oorblak');                   // 2/4
  giveResources(h, D, 'wood', 2);
  const lifeD = h.state.players[D]!.life;
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  shield(h, D, oo);
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assignDefault(h);
  assert.ok(ent(h, oo), 'the body it would have killed survives the prevention');
  assert.equal(ent(h, oo)!.damage, 0, 'none of the absorbed 4 was dealt');
  assert.equal(ent(h, oo)!.counters, 4, '+1/+1 for each of the 4 prevented');
  assert.equal(h.state.players[D]!.life, lifeD - 1,
    'the 1 that was never absorbed is still Piercing and still hits the player');
});

// ── 2. "negate all enemy effects targeting allied … units" ───────────────

test('Woodland Warding negates an enemy VIRUS aimed at your unit, and spares one aimed at their own', () => {
  const h = new Harness(11202);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');               // A's attacker — the virus target
  const theirs = spawn(h, D, 'Unit Token');            // D's own unit
  giveResources(h, D, 'earth', 3);                     // Lithoghul e/1 + Aetherflux Golem ee/1
  giveResources(h, A, 'wood', 3);                      // Woodland Warding ggg/3
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);                                             // A passes → D holds priority
  // an enemy effect aimed at D's OWN unit — Woodland Warding must spare it
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Aetherflux Golem'), hostId: theirs });
  pass(h);                                             // A declines to answer → D again
  // and one aimed at MY unit — a targeted enemy effect with no parts at all
  h.do({ type: 'augment', seat: D, from: 'hand', index: give(h, D, 'Lithoghul'), hostId: atk });
  assert.equal(h.state.stack.filter(i => i.kind === 'virus').length, 2, 'both viruses are on the stack');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Woodland Warding') });
  pass(h); pass(h);                                    // Warding (top) resolves
  assert.ok(!h.state.stack.some(i => i.card === 'Lithoghul'),
    'the virus targeting an allied unit is negated and off the stack');
  assert.ok(h.state.stack.some(i => i.card === 'Aetherflux Golem'),
    "the virus aimed at the enemy's OWN unit is spared");
  pass(h); pass(h);                                    // the spared virus still resolves
  assert.equal(ent(h, atk)!.mods.length, 0, 'the negated virus never attached');
  assert.equal(ent(h, theirs)!.mods.length, 1, 'the spared one did');
});

// ── 3. "Erase ALL mods" ─────────────────────────────────────────────────

test('Return to Nature erases a mod riding a SPELL TOKEN, not just mods on units', () => {
  const h = new Harness(11203);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const unit = spawn(h, A, 'Unit Token');
  giveResources(h, A, 'earth', 4);                     // eee / 4
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[unit]] });
  const region = h.state.battle!.region;
  // R89: an augment on a spell token in play — the board state Caleb described
  // ("you can only do this with attributes"), built directly here.
  const e = new E(h.state);
  const tok = e.createSpellToken(D, 'Poison', 1, region);
  const mod = e.attachMod(tok, 'Reality Bender', D, 'augment');
  e.settle();
  assert.ok(ownAttrs(h, tok.id).has('Inverted'), 'the token really is wearing the mod');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Return to Nature') });
  pass(h); pass(h);                                    // it resolves
  assert.equal(ent(h, tok.id)!.mods.length, 0, '"all mods" reached the spell token');
  assert.ok(!ent(h, mod.id), 'the mod entity is gone');
  assert.ok(!ownAttrs(h, tok.id).has('Inverted'), 'and the attribute it granted with it');
  assert.ok(!h.state.players[D]!.bin.includes('Reality Bender'), 'erased, not binned');
});
