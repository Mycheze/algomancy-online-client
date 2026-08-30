/* CARD-TODO #9 — the statics / end-of-turn / activated band of the
 * "registration smoke check" list. The audit of the 18 assigned cards found
 * 17 already pinned by real behavior tests in their batch files (see the
 * per-card table in the CT-9 commit); the one uncovered printed promise was
 * Rotspore Herald's EFFECT-damage half.
 *
 * Rotspore Herald: "[Augment] Everything is {g}deadly. (Any damage from a
 * deadly source will kill a unit.)" — 30-hybrids-wm-b pins the COMBAT read
 * (both sides' units). The batch header still says "effect-damage sources
 * read printed attrs only (engine limitation)", but R94 rebuilt
 * dealEffectDamageAll on the source's LIVE attributes (ownAttrs → staticsFor)
 * whenever the source is an entity in play — so a unit standing in the
 * Herald's region IS a deadly effect source now. These two tests pin that:
 * a 1-point counter-fueled ability (Soul Reaver) kills a 7/5 with the Herald
 * present, and leaves it at 1 damage without (the boundary, so the kill can
 * only come from the static).
 *
 * RULED 2026-08-24 (R125), and the escalation is closed: "Everything" is
 * literal. The owner: "Rotspore also applies to all spells and spell tokens.
 * Literally everything in its region. I think you're underestimating most
 * cards. All the cards in Algomancy are pretty literal." So the scope is the
 * REGION, not a category of object in it, and the card now carries BOTH
 * attribute channels — `statics` (unfiltered by kind, so spell tokens too)
 * for any source with an entity in play, and R94's `effectAttrs` for a
 * resolving spell, which has no entity and would otherwise read only its
 * printed attrs. The four tests below the first two pin that half.
 *
 * States are built explicitly (spawn/giveResources + a white-box counter
 * preset, as in 28-metal-c). Seeds 10700-10799. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import {
  ent, finishBattle, give, giveResources, ownAttrs, pass, pick,
  spawn, toDeployment, toNextBattle, tokensOf,
} from './util.ts';
import { E } from '../src/engine.ts';

// ── Rotspore Herald — the effect-damage half of "Everything is deadly" ───

test('Rotspore Herald: a unit-sourced EFFECT from the region is deadly — 1 point kills a 7/5 (R94)', () => {
  const h = new Harness(10701);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const whale = spawn(h, A, 'Good Whale');                  // 7/5, trigger-free
  spawn(h, D, 'Rotspore Herald');                           // the static radiates in D's region
  const sr = spawn(h, D, 'Soul Reaver');                    // "[one], Remove X counters: X damage to target unit"
  h.state.entities[sr]!.counters = 1;                       // white-box preset (as 28-metal-c)
  giveResources(h, D, 'metal', 1);                          // the [one]
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  assert.ok(ownAttrs(h, sr).has('Deadly'), 'the Herald deadly-fies the effect SOURCE');
  assert.ok(ownAttrs(h, whale).has('Deadly'), 'and the enemy attacker (both sides — the combat test)');
  pass(h);                                                  // priority → D
  h.do({ type: 'activateAbility', seat: D, entityId: sr, abilityIndex: 0, via: 'augment' });
  pick(h, { counterFrom: sr });                             // the only counter → the cost closes: X = 1
  pick(h, { unit: whale });                                 // aim at the 7/5
  pass(h); pass(h);                                         // resolve
  assert.ok(!ent(h, whale),
    'one point of effect damage from a deadly-fied unit source KILLS the 7/5 — '
    + '"Any damage from a deadly source will kill a unit"');
  finishBattle(h);
});

test('Rotspore Herald: absent, the same 1-point ability only marks damage — the kill is the static', () => {
  const h = new Harness(10702);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const whale = spawn(h, A, 'Good Whale');                  // 7/5
  const sr = spawn(h, D, 'Soul Reaver');
  h.state.entities[sr]!.counters = 1;
  giveResources(h, D, 'metal', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  assert.ok(!ownAttrs(h, sr).has('Deadly'), 'no Herald → no {Deadly} on the source');
  pass(h);
  h.do({ type: 'activateAbility', seat: D, entityId: sr, abilityIndex: 0, via: 'augment' });
  pick(h, { counterFrom: sr });
  pick(h, { unit: whale });
  pass(h); pass(h);
  assert.ok(ent(h, whale), 'the 7/5 survives one plain point');
  assert.equal(ent(h, whale)!.damage, 1, 'X = 1 was dealt and merely marked');
  finishBattle(h);
});

// ── R125: "everything" reaches SPELLS and SPELL TOKENS, not just units ────
//
// The ruling's own words are the spec: literally everything in its region.
// A spell has no entity in play, so `dealEffectDamageAll` reads its PRINTED
// attrs plus `EffectCtx.grantedAttrs` — which is why the card needs R94's
// `effectAttrs` channel as well as its `statics` one. Flame of History
// ("I deal 1 damage to any target", r/1, battle) is the discriminator: one
// point against a 7/5 either kills or merely marks.

test('Rotspore Herald: R125 — a SPELL resolving in the region is deadly, so 1 damage kills a 7/5', () => {
  const h = new Harness(10703);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const whale = spawn(h, A, 'Good Whale');                  // 7/5, trigger-free
  spawn(h, D, 'Rotspore Herald');                           // radiates over the region
  giveResources(h, D, 'fire', 1);                           // Flame of History is r/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h);                                                  // priority → D
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Flame of History') });
  pick(h, { unit: whale });                                 // R64: targeted at cast
  pass(h); pass(h);                                         // resolve
  assert.ok(!ent(h, whale),
    'a 1-damage SPELL kills the 7/5 — the Herald deadly-fies the spell, not just units');
  finishBattle(h);
});

test('Rotspore Herald: R125 — without the Herald the same spell only marks 1 damage', () => {
  const h = new Harness(10704);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const whale = spawn(h, A, 'Good Whale');
  giveResources(h, D, 'fire', 1);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Flame of History') });
  pick(h, { unit: whale });
  pass(h); pass(h);
  assert.ok(ent(h, whale), 'no Herald → the 7/5 survives');
  assert.equal(ent(h, whale)!.damage, 1, 'the point was dealt and merely marked');
  finishBattle(h);
});

test('Rotspore Herald: R125 — a SPELL TOKEN standing in the region is deadly too', () => {
  const h = new Harness(10705);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const whale = spawn(h, A, 'Good Whale');                  // 7/5
  spawn(h, D, 'Rotspore Herald');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  const region = h.state.battle!.region;
  new E(h.state).createSpellToken(D, 'Fireball', 1, region);
  while (h.state.priority !== D) pass(h);
  const fireball = tokensOf(h, D).find(t => t.card === 'Fireball')!;
  assert.ok(ownAttrs(h, fireball.id).has('Deadly'),
    'the static is not filtered by entity kind any more — a spell token carries it');
  h.do({ type: 'castSpellToken', seat: D, entityId: fireball.id });
  pick(h, { unit: whale });
  pass(h); pass(h);
  assert.ok(!ent(h, whale), 'a Fireball 1 kills the 7/5 in the Herald\'s region');
  finishBattle(h);
});

test('Rotspore Herald: R125 — the scope is the REGION: a spell resolving elsewhere is not deadly', () => {
  const h = new Harness(10706);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  // D ATTACKS, so the battle happens in A's region (R12) — and D's Herald
  // stays home, in a region the spell never resolves in.
  const raider = spawn(h, D, 'Unit Token');
  const whale = spawn(h, A, 'Good Whale');                  // 7/5, defending at home
  const herald = spawn(h, D, 'Rotspore Herald');
  giveResources(h, D, 'fire', 1);
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[raider]] });
  const region = h.state.battle!.region;
  assert.notEqual(ent(h, herald)!.region, region,
    'the fixture only means anything if the Herald is OUTSIDE the battle region');
  assert.ok(!ownAttrs(h, whale).has('Deadly'),
    'and its static does not reach the units fighting over there');
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Flame of History') });
  pick(h, { unit: whale });
  pass(h); pass(h);
  assert.ok(ent(h, whale), 'a Herald in ANOTHER region deadly-fies nothing here');
  assert.equal(ent(h, whale)!.damage, 1, 'just one plain point');
  finishBattle(h);
});
