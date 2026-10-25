/**
 * CR 708.4a, 708.7 — the counter amounts (Flux Resonator, Proliferating Slime)
 * and the counter redirect (Counter Thief) on ONE seam.
 *
 * Two things change:
 *
 *  1. THE RE-TEST. An amount replacement that did not apply to the placement
 *     as it first stood is offered it again once a redirect has changed it
 *     (CR 708.4a: each applies "to the event as the earlier ones left it, and
 *     only if that event still matches its own text"). Proliferating Slime:
 *     "If one or more counters would be put on an enemy unit or player, put
 *     that many counters plus one instead." Counters a player puts on their
 *     OWN unit do not match it — until the other player's Counter Thief moves
 *     them onto the thief, an enemy unit. It used to price the amount once,
 *     before the redirect, and never again.
 *
 *  2. THE DEFAULT. Where the order changes the result and one order is never
 *     worse (the amounts first — CR 708.7), the player is no longer silently
 *     given it. The owner, 2026-10-25: "For cases where its 'just worse' give
 *     them the option to choose, but be like 'Yo, this will be a higher
 *     number'. Sorta like when blocking, how it asks 'Choose your split? Or
 *     just use default?'". So the order question opens with a one-click
 *     DEFAULT that names what it gives, and the board still takes a click on
 *     the one to apply first.
 *
 * RED before: (1) 2 counters, not 3; (2) no question — always the amounts first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { registerSynthetic, type Printed } from '../src/cards/dsl.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, give, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';

registerSynthetic({
  name: 'T698 Growth', cost: '', mana: 0, power: 0, toughness: 0, type: '{Battle} Test Spell',
  kind: 'spell', timing: 'battle', attrs: [], virus: false, burst: false, augmentAttrs: [],
  text: 'Put two +1/+1 counters on target unit.', image: '',
} as Printed, {
  spellEffect: {
    targets: { what: 'unit', prompt: 'T698 Growth: put two +1/+1 counters on target unit' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      const u = t && 'id' in t ? g.entity(t.id) : undefined;
      if (u) g.addCounters(u, 2, ctx.controller);
    },
  },
});

const counters = (h: Harness, id: EntityId): number => ent(h, id)?.counters ?? 0;

/** A (initiative) attacks with Mohruung and `mine` beside it; D holds `theirs`
 * and The Foretold; A casts T698 Growth on `aim` ('own' = the Mohruung) */
function growth(seed: number, mine: string[], theirs: string[], aim: 'own' | 'enemy') {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Mohruung');
  const a = mine.map(c => spawn(h, A, c));
  const d = theirs.map(c => spawn(h, D, c));
  const mark = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk], ...a.map(id => [id])] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'T698 Growth') });
  pick(h, { unit: aim === 'own' ? atk : mark });
  // it resolves (a Mohruung that is targeted puts its own trigger above it)
  for (let i = 0; i < 8 && h.state.stack.length && !h.state.decision; i++) pass(h);
  return { h, A, D, atk, a, d, mark };
}

test('CR 708.4a: Proliferating Slime applies after a Counter Thief moves the counters onto an enemy unit', () => {
  const r = growth(69801, ['Proliferating Slime'], ['Counter Thief'], 'own');
  assert.equal(r.h.state.decision, null, 'one replacement each: nothing to order');
  assert.equal(counters(r.h, r.atk), 0, 'the thief took them');
  assert.equal(counters(r.h, r.d[0]!), 3, 'two, plus one: once on the thief they are on an enemy unit');
});

test('CR 708.7: Proliferating Slime and a Counter Thief of one player, the default is the amounts first and says it gives the higher number', () => {
  const r = growth(69802, ['Proliferating Slime', 'Counter Thief'], [], 'enemy');
  const dec = r.h.state.decision;
  assert.ok(dec, 'the order changes the result: asked');
  assert.equal(dec!.seat, r.A, 'the player whose replacements they are');
  assert.equal(dec!.prompt, 'Proliferating Slime and Counter Thief both apply to the 2 counters for The Foretold — which applies first?');
  assert.equal(dec!.options[0]!.label, 'Default: 3 counters on Counter Thief (the higher number)', 'the one-click default comes first and says what it gives');
  assert.deepEqual((dec!.options[0]!.value as { default?: boolean }).default, true);
  assert.deepEqual(dec!.options.slice(1).map(o => o.label), [
    'Proliferating Slime first: 3 counters on Counter Thief',
    'Counter Thief first: 2 counters on Counter Thief',
  ]);
  assert.deepEqual(dec!.options.slice(1).map(o => (o.value as { unit: number }).unit), [r.a[0], r.a[1]],
    'each order is a click on the unit that applies first');
  r.h.do({ type: 'decide', seat: r.A, choice: 0 });
  assert.equal(r.h.state.decision, null);
  assert.equal(counters(r.h, r.a[1]!), 3, 'the default: the Slime first, then the thief takes all three');
  assert.equal(counters(r.h, r.mark), 0);
});

test('CR 708.7: choosing the Counter Thief first, the counters arrive on the thief without the Slime', () => {
  const r = growth(69803, ['Proliferating Slime', 'Counter Thief'], [], 'enemy');
  const dec = r.h.state.decision!;
  const i = dec.options.findIndex(o => (o.value as { unit?: number }).unit === r.a[1]);
  r.h.do({ type: 'decide', seat: r.A, choice: i });
  assert.equal(counters(r.h, r.a[1]!), 2, 'on your own thief, the Slime no longer applies');
});

test('CR 708.4a: Flux Resonator and a Counter Thief, the order cannot change the result, nothing is asked', () => {
  // "by an allied source" depends on who put them, not on where they land (CR 708.8b)
  const r = growth(69804, ['Flux Resonator', 'Counter Thief'], [], 'enemy');
  assert.equal(r.h.state.decision, null);
  assert.equal(counters(r.h, r.a[1]!), 3);
});
