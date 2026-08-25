/* Trigger fixes from the 2026-08-18 playtest feedback:
 *  - Ember of Life (triple fix): "one of YOUR spell effects" filters on the
 *    effect's CONTROLLER (damage events now carry it); spell-effect damage
 *    to a PLAYER's face counts (a damage event is emitted for it); the 1/1s
 *    spawn in the CARRIER's region (R33, absorbed into R115).
 *  - Unstable Apparition: pinned once-per-TURN semantics for [once] (R9) —
 *    the AGBP game review found the engine correct (fired on Accelerated
 *    Germination in the haste step, X = 2; correctly silent on Organic
 *    Exchange later the same turn).
 *  - R34: a seat's simultaneous IDENTICAL triggers (same card, ability,
 *    label, parts) skip the orderTriggers decision; mixed triggers still ask.
 * Seeds: 3300-3399.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E, Suspended } from '../src/engine.ts';
import {
  effStats, ent, finishBattle, give, giveResources, pass, pick,
  skipHasteStep, spawn, toDeployment, toNextBattle, tokensOf, unitsOf,
} from './util.ts';
import type { EntityId } from '../src/types.ts';

/** run engine mutations white-box; a trigger's decision may suspend —
 * the suspension is recorded in state and answered via h.do('decide'). */
function whiteBox(h: Harness, f: (e: E) => void): void {
  const e = new E(h.state);
  try {
    f(e);
    e.settle();
  } catch (sig) {
    if (!(sig instanceof Suspended)) throw sig;
  }
  h.state = e.s;
}

const mintedOnes = (h: Harness, seat: number) =>
  unitsOf(h, seat as 0 | 1).filter(u => u.card === 'Unit Token');

// ── Ember of Life: controller filtering ─────────────────────────────────

test("Ember of Life: an OPPONENT's spell effect neither fires it nor spends [once]", () => {
  const h = new Harness(3300);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as 0 | 1;
  const a1 = spawn(h, A, 'Unit Token');
  const ember = spawn(h, D, 'Ember of Life');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[a1]] });
  // A (the opponent) Fireballs Ember itself — damage in Ember's region,
  // but the effect's controller is A, not Ember's controller
  let fbA: EntityId = 0;
  whiteBox(h, e => { fbA = e.createSpellToken(A, 'Fireball', 1, h.state.battle!.region).id; });
  h.do({ type: 'castSpellToken', seat: A, entityId: fbA });
  pick(h, { unit: ember });
  pass(h); pass(h);                          // Fireball resolves — NO trigger
  assert.equal(ent(h, ember)!.damage, 1, "the opponent's Fireball landed on Ember");
  assert.equal(mintedOnes(h, D).length, 0, "an opponent's spell effect does not fire Ember");
  assert.equal(h.state.decision, null, 'nothing queued, nothing asked');
  // D's OWN spell now fires it — proving the enemy spell also left [once] unspent
  pass(h);                                   // priority → D
  let fbD: EntityId = 0;
  whiteBox(h, e => { fbD = e.createSpellToken(D, 'Fireball', 1, h.state.battle!.region).id; });
  h.do({ type: 'castSpellToken', seat: D, entityId: fbD });
  pick(h, { unit: a1 });
  pass(h); pass(h);                          // Fireball resolves, trigger → stack
  pass(h); pass(h);                          // resolve the Ember trigger
  assert.equal(mintedOnes(h, D).length, 1,
    "D's own spell fires it — [once] was not consumed by the enemy spell");
  finishBattle(h);
});

// ── Ember of Life: face damage counts; 1/1s spawn in the carrier's region ──

test("Ember of Life: your spell hitting a player's FACE fires it; 1/1s arrive in the carrier's region (R33)", () => {
  const h = new Harness(3301);
  toDeployment(h);
  const P = h.state.initiative, O = (1 - P) as 0 | 1;
  const ember = spawn(h, P, 'Ember of Life');
  toNextBattle(h, P);
  h.do({ type: 'declareAttack', seat: P, columns: [[ember]] });
  // Ember traveled into O's home region — the carrier is AWAY from home
  const away = ent(h, ember)!.region;
  assert.equal(away, new E(h.state).homeRegion(O), 'the attacker stands in the enemy region');
  const lifeBefore = h.state.players[O]!.life;
  let fb: EntityId = 0;
  whiteBox(h, e => { fb = e.createSpellToken(P, 'Fireball', 2, h.state.battle!.region).id; });
  h.do({ type: 'castSpellToken', seat: P, entityId: fb });
  pick(h, { player: O });
  pass(h); pass(h);                          // Fireball → 2 to O's face, trigger → stack
  pass(h); pass(h);                          // resolve the Ember trigger
  assert.equal(h.state.players[O]!.life, lifeBefore - 2, 'the face damage landed');
  const minted = mintedOnes(h, P);
  assert.equal(minted.length, 2, 'player damage counts — "that many" = 2');
  assert.ok(minted.every(u => u.region === away),
    "created in the CARRIER's region (R33) — the battle region, not home");
  assert.ok(minted.every(u => u.region !== new E(h.state).homeRegion(P)),
    'and that region is NOT the controller\'s home');
  finishBattle(h);
});

// ── Unstable Apparition: [once] = once per TURN (the AGBP diagnosis) ──────

test('Unstable Apparition: [once] resets each turn — silent same-turn, fires again next turn (R9)', () => {
  const h = new Harness(3302);
  toDeployment(h);
  const p = h.state.deployPlayer!;
  spawn(h, p, 'Unstable Apparition');
  giveResources(h, p, 'water', 6);
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Lonely Forager') });
  assert.equal(tokensOf(h, p).filter(t => t.card === 'Fireball').length, 1,
    'first nontoken spell of the turn → a Fireball');
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Lonely Forager') });
  assert.equal(tokensOf(h, p).filter(t => t.card === 'Fireball').length, 1,
    'second nontoken spell the SAME turn → nothing ([once], R9)');
  // roll into the next turn's deployment (regroup erases the old Fireball)
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  h.do({ type: 'doneDeploying', seat: h.state.deployPlayer! });
  toDeployment(h);
  assert.equal(tokensOf(h, p).filter(t => t.card === 'Fireball').length, 0,
    'regroup cleaned up the unused Fireball');
  h.do({ type: 'playCard', seat: p, handIndex: give(h, p, 'Lonely Forager') });
  const fires = tokensOf(h, p).filter(t => t.card === 'Fireball');
  assert.equal(fires.length, 1, 'NEXT turn the budget is fresh — it fires again (once per TURN, not once ever)');
  assert.equal(fires[0]!.x, 3, "X = the spell's cost (Lonely Forager: 3)");
});

// ── R34: identical simultaneous triggers skip the ordering decision ───────

test('R34: Flourishing Flora firing twice at once (one spell, two spawns) asks NO ordering', () => {
  const h = new Harness(3303);
  const p = 0 as const;
  const flora = spawn(h, p, 'Flourishing Flora');            // 0/1
  giveResources(h, p, 'wood', 2);                            // gg/2 haste spell
  const idx = give(h, p, 'Accelerated Germination');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  assert.ok(h.state.hasteDone, 'the payable haste card engaged the haste step (R18)');
  h.do({ type: 'playCard', seat: p, handIndex: idx });       // two 1/1s spawn at once
  assert.equal(h.state.decision, null,
    'two IDENTICAL Flora triggers — no orderTriggers decision (R34)');
  assert.deepEqual(effStats(h, flora), [2, 3], 'both triggers resolved (+1/+1 each)');
  skipHasteStep(h);
});

test('R34: MIXED simultaneous triggers (different cards) still ask for an order', () => {
  const h = new Harness(3304);
  const p = 0 as const;
  const flora = spawn(h, p, 'Flourishing Flora');            // +1/+1 on another ally spawn
  // ⚠ This used to use Bloomcaster, whose trigger fired on 'spawned'. It now
  // fires on 'cardPlayed' (it prints "whenever you PLAY a unit", and
  // spawnUnit is a PUT INTO PLAY), so it no longer fires here and there was
  // only one trigger left to order. The subject of this test is R2/R34 trigger
  // ORDERING, not Bloomcaster — so it takes a card that genuinely triggers on
  // its own spawn. Pathogenic Enclave prints "When I spawn, create two 1/1
  // units", which fires alongside Flora's "another ally spawned".
  whiteBox(h, e => { e.spawnUnit(p, 'Pathogenic Enclave', e.homeRegion(p)); });
  const dec = h.state.decision;
  assert.equal(dec?.kind, 'orderTriggers', 'different triggers still ask (R2)');
  assert.equal(dec!.options.length, 2, 'one Flora + one Pathogenic Enclave');
  assert.notEqual(dec!.options[0]!.label, dec!.options[1]!.label, 'distinguishable labels');
  h.do({ type: 'decide', seat: p, choice: [0, 1] });
  // the Enclave's two token spawns re-fire Flora; each is a singleton (no ask)
  assert.equal(h.state.decision, null, 'the follow-up single triggers resolve without asking');
  assert.equal(unitsOf(h, p).filter(u => u.card === 'Unit Token').length, 2,
    'the Enclave made its two 1/1s');
  assert.deepEqual(effStats(h, flora), [3, 4],
    'Flora grew from the Enclave AND from each of its two created tokens');
});
