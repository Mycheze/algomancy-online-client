/* LITERAL-READING AUDIT — fire (a, b), fire/wood and wood-a.
 *
 * R125's principle, applied as a sweep rather than to one card: *"when a
 * printed text carries no qualifier, do not invent one … Read the card, then
 * find the mechanism."* (Owner, 2026-08-24: "I think you're underestimating
 * most cards. All the cards in Algomancy are pretty literal.")
 *
 * Two narrowings came out of the 63 cards in those four files. This file pins
 * the one that was FIXED, plus the seeded question that turned out not to be
 * a bug at all. (The other, Twin Flame's `min: 1` against a printed "up to
 * two", is written up at the card as NEEDS-ESCALATION: the one-character fix
 * red-checked green but re-points a general engine assertion in
 * `test/21-fixes.test.ts`, which is out of this pass's remit to edit.)
 *
 *  1. HEXBANE SHIITAKE printed "whenever another player plays a spell" and
 *     tested `ev.data?.token !== true`, i.e. it invented a "nontoken" the card
 *     does not print. The engine fires 'spellPlayed' for a cast spell token
 *     with `token: true` — Nimbus Eel's printed "when you play a TOKEN spell"
 *     is built on that very event — and every OTHER card in the pool with
 *     that guard prints the word "nontoken".
 *  2. EMBERFLAME ENLIGHTENER / ENVOY OF LIGHTNING — the R94 ⚠ OPEN note asks
 *     whether "your spells" reaches spell TOKENS and says the engine's default
 *     is yes. It IS yes, on every path that matters, and both cards ask the
 *     same predicate. Pinned here so the two cannot drift apart.
 *
 * States are built explicitly (spawn / give / giveResources) so parallel card
 * registration cannot shift assertions. Seeds 11100-11199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import type { Seat } from '../src/types.ts';
import { isSpellEffect, radiantList } from '../src/cards/dsl.ts';
import type { EffectAttrCtx } from '../src/cards/dsl.ts';
import {
  ent, finishBattle, give, giveResources, pass, pick, spawn,
  toDeployment, toNextBattle, tokensOf,
} from './util.ts';

// ── 1. Hexbane Shiitake: a SPELL TOKEN is a spell being played ────────────

test('Hexbane Shiitake: an enemy SPELL TOKEN is "a spell" — it exchanges for a cast Fireball', () => {
  const h = new Harness(11103);
  toDeployment(h);
  const D = h.state.initiative, A = (1 - D) as Seat;   // D attacks, A defends at home
  const host = spawn(h, A, 'Unit Token');              // carries the Hexbane augment
  const atkD = spawn(h, D, 'Unit Token');              // 1/1 attacker — the retarget victim
  giveResources(h, A, 'wood', 4);                      // g / 4 (the augment)
  h.do({ type: 'augment', seat: A, from: 'hand', index: give(h, A, 'Hexbane Shiitake'), hostId: host });
  assert.equal(ent(h, host)!.mods.length, 1, 'Hexbane attached during deployment');
  toNextBattle(h, D);
  h.do({ type: 'declareAttack', seat: D, columns: [[atkD]] });
  const region = h.state.battle!.region;
  new E(h.state).createSpellToken(D, 'Fireball', 2, region);
  while (h.state.priority !== D) pass(h);
  const fireball = tokensOf(h, D).find(t => t.card === 'Fireball')!;
  h.do({ type: 'castSpellToken', seat: D, entityId: fireball.id });
  pick(h, { unit: host });                             // D aims the Fireball at A's host
  pass(h); pass(h);                                    // the Hexbane trigger resolves first
  assert.ok(h.log.some(m => m.includes('Trigger: Hexbane Shiitake')),
    'a cast spell TOKEN fires "whenever another player plays a spell"');
  pick(h, true);                                       // exchange!
  pick(h, { unit: atkD });                             // …and point the Fireball back at D
  assert.equal(ent(h, host)!.controller, D, "the carrier went to the token's owner");
  pass(h); pass(h);                                    // the stolen Fireball resolves under A
  assert.ok(!ent(h, atkD), 'Fireball 2 killed the 1/1 attacker A retargeted it onto');
  assert.ok(ent(h, host), 'and A\'s old host, the original target, was spared');
  finishBattle(h);
});

// ── 2. "Your spells" and spell tokens — the R94 ⚠ OPEN note, verified ─────

test('Emberflame Enlightener: a cast Fireball 1 under the aura deals DOUBLE (R94 default)', () => {
  const withAura = (aura: boolean): number => {
    const h = new Harness(aura ? 11104 : 11105);
    toDeployment(h);
    const A = h.state.initiative, D = (1 - A) as Seat;
    const whale = spawn(h, A, 'Good Whale');           // 7/5, trigger-free
    if (aura) spawn(h, D, 'Emberflame Enlightener');   // radiates over D's region
    toNextBattle(h, A);
    h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
    const region = h.state.battle!.region;
    new E(h.state).createSpellToken(D, 'Fireball', 1, region);
    while (h.state.priority !== D) pass(h);
    const fb = tokensOf(h, D).find(t => t.card === 'Fireball')!;
    h.do({ type: 'castSpellToken', seat: D, entityId: fb.id });
    pick(h, { unit: whale });
    pass(h); pass(h);
    const dmg = ent(h, whale)!.damage;
    finishBattle(h);
    return dmg;
  };
  assert.equal(withAura(false), 1, 'the boundary: a bare Fireball 1 marks one point');
  assert.equal(withAura(true), 2,
    '"your units and SPELLS gain {Powerful}" reaches a spell token — R94 effectAttrs, '
    + 'which is the only channel that can (a cast token has no entity left to read)');
});

test('Emberflame and Envoy of Lightning ask the SAME question about a spell token', () => {
  assert.ok(isSpellEffect('spellToken'),
    "the engine's single answer: a spell token IS a spell effect");
  const h = new Harness(11106);
  toDeployment(h);
  const A = h.state.initiative;
  const g = new E(h.state);
  const region = g.homeRegion(A);
  const mk = (name: string) => {
    const self = g.entity(spawn(h, A, name))!;
    const mod = radiantList(name, 'effectAttrs')[0]!;   // R268: both halves of the box
    const ctx = (kind: EffectAttrCtx['kind']): EffectAttrCtx =>
      ({ seat: A, region, kind, targets: 1 });
    return { self, mod, ctx };
  };
  for (const name of ['Emberflame Enlightener', 'Envoy of Lightning']) {
    const { self, mod, ctx } = mk(name);
    assert.ok(mod.affects(g, self, ctx('spell')), `${name}: a spell qualifies`);
    assert.ok(mod.affects(g, self, ctx('spellToken')),
      `${name}: and so does a spell TOKEN — one predicate, both cards`);
    assert.ok(!mod.affects(g, self, ctx('triggered')),
      `${name}: a triggered ability is not a spell effect`);
  }
});
