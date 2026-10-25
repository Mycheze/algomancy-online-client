/**
 * CR 708.6a — an ADDITION and a DOUBLING on one amount of damage: the order is
 * the dealer's, with the additions first as the one-click DEFAULT.
 *
 * Conduit of Pain: "[Augment] If an allied source would deal noncombat damage,
 * it deals that much damage plus 1 instead." Beside a {Powerful} source (which
 * deals double) the order changes the number — (1+1)x2 = 4 or 1x2+1 = 3 — and
 * beside Arbiter of Vitality ("Double all life gain and life loss. (Damage
 * causes loss of life.)") it changes the life lost.
 *
 * Sources: RAQ "[Solved] Resonant, Combat Damage, Conduit and Powerful": a
 * Powerful Bellowing Boulder with Conduit deals "(1+1)x2 damage to each unit =
 * 4"; Caleb Gannon, rules-questions 2026-02-23: "generally as the owner of all
 * the replacement effects, you can choose the order you'd like to apply them
 * in" / "which usually would mean doing +1 then doubling" / "for max damage".
 * The owner, 2026-10-25 (Q5): "For cases where its 'just worse' give them the
 * option to choose, but be like 'Yo, this will be a higher number'. Sorta like
 * when blocking, how it asks 'Choose your split? Or just use default?'"; (Q1)
 * "Each owner, INT first".
 *
 * RED before: no question — the additions always went first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { registerSynthetic, type Printed } from '../src/cards/dsl.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, give, pass, spawn, toDeployment, toNextBattle, withE } from './util.ts';

registerSynthetic({
  name: 'T699 Burn', cost: '', mana: 0, power: 0, toughness: 0, type: 'Test Spell',
  kind: 'spell', timing: 'deploy', attrs: [], virus: false, burst: false, augmentAttrs: [],
  text: 'Deal 2 damage to each opponent.', image: '',
} as Printed, {
  spellEffect: {
    run: (g, ctx) => { g.dealEffectDamageAll(ctx, [{ target: { player: (1 - ctx.controller) as Seat }, n: 2 }]); },
  },
});

/** a vanilla token with the given stats, as 387 builds its walls */
function wall(h: Harness, seat: Seat): EntityId {
  let id = -1;
  withE(h, e => { id = e.spawnUnit(seat, 'Unit Token', e.homeRegion(seat), { token: true, tokenStats: [0, 40] }).id; e.settle(); });
  return id;
}

/** A attacks with a Powerful Bellowing Boulder ("when I attack or block, deal
 * 1 damage to each unit") beside a Conduit of Pain; D has two walls */
function boulder(seed: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const b = spawn(h, A, 'Bellowing Boulder');
  const c = spawn(h, A, 'Conduit of Pain');
  const w = [wall(h, D), wall(h, D)];
  toNextBattle(h, A);
  withE(h, e => { e.addTempAttr(e.entity(b)!, 'Powerful'); });
  h.do({ type: 'declareAttack', seat: A, columns: [[b], [c]] });
  pass(h); pass(h);                                  // the trigger resolves
  return { h, A, D, b, c, w };
}

test('CR 708.6a: Conduit of Pain and Powerful, the default is the addition first and says it gives the higher number', () => {
  const r = boulder(69901);
  const dec = r.h.state.decision;
  assert.ok(dec, 'the order changes the number: asked');
  assert.equal(dec!.seat, r.A, 'the dealer, whose both replacements are');
  assert.equal(dec!.prompt, 'Bellowing Boulder: Conduit of Pain and {Powerful} both change its 1 damage — which applies first?');
  assert.deepEqual(dec!.options.map(o => o.label), [
    'Default: 4 damage (the higher number)',
    '4 damage: Conduit of Pain first',
    '3 damage: Bellowing Boulder first ({Powerful})',
  ]);
  assert.deepEqual(dec!.options.slice(1).map(o => (o.value as { unit: number }).unit), [r.c, r.b],
    'each order is a click on its unit: the Conduit, or the Powerful source');
  r.h.do({ type: 'decide', seat: r.A, choice: 0 });
  assert.equal(r.h.state.decision, null, 'one question for the whole batch');
  assert.deepEqual(r.w.map(id => ent(r.h, id)!.damage), [4, 4], '(1+1)x2 to each unit');
});

test('CR 708.6a: choosing Powerful first, the damage is doubled and then one is added', () => {
  const r = boulder(69902);
  const dec = r.h.state.decision!;
  r.h.do({ type: 'decide', seat: r.A, choice: dec.options.findIndex(o => (o.value as { unit?: number }).unit === r.b) });
  assert.deepEqual(r.w.map(id => ent(r.h, id)!.damage), [3, 3], '1x2+1 to each unit');
});

/** `dealer` casts T699 Burn in deployment; `conduit` and `arbiter` say whose */
function burn(seed: number, who: { dealer: 'int' | 'nit'; arbiter: 'dealer' | 'other' }) {
  const h = new Harness(seed);
  toDeployment(h);
  const INT = h.state.initiative as Seat;
  const dealer = (who.dealer === 'int' ? INT : 1 - INT) as Seat, other = (1 - dealer) as Seat;
  const c = spawn(h, dealer, 'Conduit of Pain');
  const a = spawn(h, who.arbiter === 'dealer' ? dealer : other, 'Arbiter of Vitality');
  // the Arbiter's doubling is not regional outside a battle; the Conduit's
  // addition reads the source's region, which is the dealer's home
  const life = h.state.players[other]!.life;
  h.do({ type: 'playCard', seat: dealer, handIndex: give(h, dealer, 'T699 Burn') });
  return { h, dealer, other, c, a, lost: () => life - h.state.players[other]!.life };
}

test('CR 708.6a: Conduit of Pain and Arbiter of Vitality of one player, the default doubles the whole loss', () => {
  const r = burn(69903, { dealer: 'int', arbiter: 'dealer' });
  const dec = r.h.state.decision;
  assert.ok(dec, 'asked');
  assert.equal(dec!.seat, r.dealer);
  assert.match(dec!.prompt, /Conduit of Pain and Arbiter of Vitality both apply — which applies first\?$/);
  assert.deepEqual(dec!.options.map(o => o.label), [
    'Default: 6 life (the higher number)',
    '6 life: Conduit of Pain first',
    '5 life: Arbiter of Vitality first',
  ]);
  r.h.do({ type: 'decide', seat: r.dealer, choice: 0 });
  assert.equal(r.lost(), 6, '(2+1)x2');
});

test('CR 708.6a: choosing Arbiter of Vitality first, the doubled loss has the addition added after', () => {
  const r = burn(69904, { dealer: 'int', arbiter: 'dealer' });
  const dec = r.h.state.decision!;
  r.h.do({ type: 'decide', seat: r.dealer, choice: dec.options.findIndex(o => (o.value as { unit?: number }).unit === r.a) });
  assert.equal(r.lost(), 5, '2x2+1');
  assert.ok(r.h.log.some(m => /^Arbiter of Vitality first, then Conduit of Pain: the 3 life .* would lose \(T699 Burn\) becomes 5\.$/.test(m)),
    'the log says which went first');
});

test('CR 708.4a: Conduit of Pain and an Arbiter of Vitality of the other player, nothing is asked and the initiative player applies first', () => {
  // the dealer has the initiative: the Conduit first, the whole loss doubled
  const a = burn(69905, { dealer: 'int', arbiter: 'other' });
  assert.equal(a.h.state.decision, null, 'each player had one replacement to order');
  assert.equal(a.lost(), 6);
  // the Arbiter's controller has it: the Arbiter first, the addition after
  const b = burn(69906, { dealer: 'nit', arbiter: 'other' });
  assert.equal(b.h.state.decision, null);
  assert.equal(b.lost(), 5);
});

test('CR 708.6a: Powerful alone and Conduit alone ask nothing', () => {
  const h = new Harness(69907);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const b = spawn(h, A, 'Bellowing Boulder');
  const w = wall(h, D);
  toNextBattle(h, A);
  new E(h.state).addTempAttr(new E(h.state).entity(b)!, 'Powerful');
  h.do({ type: 'declareAttack', seat: A, columns: [[b]] });
  pass(h); pass(h);
  assert.equal(h.state.decision, null);
  assert.equal(ent(h, w)!.damage, 2);
});
