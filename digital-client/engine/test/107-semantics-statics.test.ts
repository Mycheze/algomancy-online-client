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
 * Still OPEN (escalated, not guessed): whether "Everything" also deadly-fies
 * NON-unit damage sources — a spell resolving in the region, or a Fireball /
 * Poison spell token. The static grants {Deadly} to units only, and a
 * source with no entity in play still reads printed card attrs (R94's
 * fallback), so spell damage does not kill today. That needs a ruling on the
 * scope of "everything", not an engine patch on a guess.
 *
 * States are built explicitly (spawn/giveResources + a white-box counter
 * preset, as in 28-metal-c). Seeds 10700-10799. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import type { Seat } from '../src/types.ts';
import {
  ent, finishBattle, giveResources, ownAttrs, pass, pick,
  spawn, toDeployment, toNextBattle,
} from './util.ts';

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
