/* R238 — a REPLACED combat hit was still DEALT.
 *
 * Owner, 2026-08-28, on a hit Blightsea Polyp turned into rot: "Yes, blightsea
 * pollup says it deals damage as, so its still damage. Just not as life."
 * Caleb had already ruled it on 2024-10-24 ("Is combat damage still applied
 * after this replacement effect?" — "Yes"), and R197 measured the gap on
 * 2026-08-26 and filed it "Reported, not fixed". See scratchpad/rulings/R238.md.
 *
 * The complete set of hooks that can consume a combat hit to a player is
 * DERIVED here, not typed: every card declaring `replaceCombatDamageToPlayer`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/apply.ts';
import { Harness } from '../src/harness.ts';
import { allCardNames, radiantHook } from '../src/cards/dsl.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, finishBattle, pass, resolveAfterCombat, spawn, toDeployment, toNextBattle } from './util.ts';

const drainStack = (h: Harness) => { while (h.state.stack.length) pass(h); };

function attackWith(h: Harness, attacker: Seat, columns: EntityId[][]): void {
  toNextBattle(h, attacker);
  h.do({ type: 'declareAttack', seat: attacker, columns });
  drainStack(h);
}

/** from the attack window: no blocks, then let combat damage happen */
function throughCombat(h: Harness, defender: Seat): void {
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: defender, blocks: {} });
  pass(h); pass(h);
}

/** every card that can consume a combat hit to a player — the hook IS the
 * class, so it is asked for rather than listed. */
function combatHitReplacers(): string[] {
  // R268: Oorblak and Blightsea Polyp print the hook inside their [Augment]
  // box, so it is declared in `augmentBox` — read both halves or the class is empty.
  return allCardNames().filter(n => radiantHook(n, 'replaceCombatDamageToPlayer') !== undefined);
}

test('R238: the replacer class is derived from the hook, and it is not empty', () => {
  const who = combatHitReplacers();
  assert.ok(who.length > 0, 'at least one card can consume a combat hit to a player');
  assert.ok(allCardNames().length === 496, `the pool is 496, saw ${allCardNames().length}`);
  assert.ok(who.includes('Blightsea Polyp'), 'the card the ruling is about is in the class');
  // Oorblak redirects rather than absorbing, and it is the same hook — the
  // rule below has to be uniform across the class, so both are named here.
  assert.ok(who.includes('Oorblak'), 'the redirect is the same hook and the same rule');
});

// ── the gap itself ────────────────────────────────────────────────────

test('R238: a fully replaced hit still fires the face-damage event, with the DEALT amount', () => {
  const h = new Harness(2381);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const hitter = spawn(h, A, 'Rune Channeler');    // 4/3
  spawn(h, D, 'Blightsea Polyp');                  // "columns deal combat damage as 1 rot"
  const lifeD = h.state.players[D]!.life;
  attackWith(h, A, [[hitter]]);
  throughCombat(h, D);

  assert.equal(h.state.players[D]!.life, lifeD, 'no life was lost — the hit was replaced');
  assert.equal(h.events.filter(e => e.type === 'lifeLost' && e.data?.['why'] === 'combat').length, 0,
    'and so no combat lifeLost fired at all — which is why lifeLost could never carry this');

  const face = h.events.filter(e => e.type === 'combatFaceDamage');
  assert.equal(face.length, 1, 'exactly one face-damage event, for the one damaged seat');
  assert.equal(face[0]!.data?.['seat'], D);
  assert.equal(face[0]!.data?.['n'], 4, 'n is what was DEALT (4), not what was lost (0)');
  const hits = face[0]!.data?.['hits'] as { dealt: number; amount: number; col: EntityId[] }[];
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.dealt, 4, 'the column dealt 4');
  assert.equal(hits[0]!.amount, 0, 'and none of it became life loss');
  assert.ok(hits[0]!.col.includes(hitter), 'attributed to the column that dealt it');
  finishBattle(h);
});

test('R238: "when my column deals combat damage" pays out through the replacement', () => {
  const h = new Harness(2382);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  // Vroot: "[Augment] When my column deals combat damage, each opponent gains
  // that much life." R26: its own [Augment] text is live when played normally.
  const vroot = spawn(h, A, 'Vroot');
  spawn(h, D, 'Blightsea Polyp');
  const lifeD = h.state.players[D]!.life;
  attackWith(h, A, [[vroot]]);
  throughCombat(h, D);
  finishBattle(h);
  assert.ok(h.state.players[D]!.life > lifeD,
    'Vroot saw a hit the engine used to hide from it, and paid out "that much life"');
});

test('R238: the payout is the DAMAGE DEALT, not the life lost', () => {
  const h = new Harness(2383);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const vroot = spawn(h, A, 'Vroot');
  spawn(h, D, 'Blightsea Polyp');
  const lifeD = h.state.players[D]!.life;
  attackWith(h, A, [[vroot]]);
  throughCombat(h, D);
  resolveAfterCombat(h);   // R261: Vroot's column-damage trigger pays out after combat
  const face = h.events.find(e => e.type === 'combatFaceDamage')!;
  const n = face.data?.['n'] as number;
  // measured BEFORE the battle is finished: the rot the replacement handed out
  // is its own damage on its own schedule (R38) and is not part of this sum.
  assert.equal(h.state.players[D]!.life, lifeD + n,
    'the opponent gained exactly the damage the column dealt, though it lost no life to it');
  finishBattle(h);
});

// ── what must NOT change ──────────────────────────────────────────────

test('R238: an ordinary unreplaced hit is unchanged — one event, dealt === lost', () => {
  const h = new Harness(2384);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const hitter = spawn(h, A, 'Rune Channeler');   // 4/3
  const lifeD = h.state.players[D]!.life;
  attackWith(h, A, [[hitter]]);
  throughCombat(h, D);
  assert.equal(h.state.players[D]!.life, lifeD - 4, 'the life still goes');
  const face = h.events.filter(e => e.type === 'combatFaceDamage');
  assert.equal(face.length, 1);
  const hits = face[0]!.data?.['hits'] as { dealt: number; amount: number }[];
  assert.equal(hits[0]!.dealt, 4);
  assert.equal(hits[0]!.amount, 4, 'with nothing replaced the two halves agree');
  assert.equal(h.events.filter(e => e.type === 'lifeLost' && e.data?.['why'] === 'combat').length, 1,
    'and the lifeLost still fires exactly once for the seat');
  finishBattle(h);
});

test('R238: PREVENTION is still the other thing — a blocked column deals nothing to the face', () => {
  const h = new Harness(2385);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const hitter = spawn(h, A, 'Rune Channeler');    // 4/3
  const wall = spawn(h, D, 'Awoken Tomb');         // 0/5 — absorbs the whole pool
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[hitter]] });
  drainStack(h);
  pass(h); pass(h);
  const ci = h.state.battle!.columns.findIndex(c => c.includes(hitter));
  h.do({ type: 'declareBlocks', seat: D, blocks: { [ci]: [wall] } });
  pass(h); pass(h);
  assert.equal(h.events.filter(e => e.type === 'combatFaceDamage').length, 0,
    'no face damage was dealt at all — a blocked non-Piercing column reaches no player');
  assert.ok(ent(h, wall), 'the 0/5 absorbed it');
  finishBattle(h);
});
