/**
 * CR 708.4a — WHO orders replacement effects that belong to DIFFERENT players.
 *
 * The owner, 2026-10-25 (zero-handoff REPLACEMENT-ORDER §7, Q1): "Each owner,
 * INT first" — each player orders their own replacement effects, and the
 * initiative player's apply first, then the other player's. Every family runs
 * through one seam (E.replaceEvent), so the rule is written once.
 *
 * The real pair that reaches it: two Counter Thieves of DIFFERENT players in a
 * battle region ("If one or more counters would be placed on one or more units
 * during battle, those counters are placed on me instead"). The initiative
 * player's thief applies first and takes the counters; the other player's
 * thief has not applied, the counters are still being placed on a unit during
 * battle, so it applies next and keeps them. Nothing is asked: each player had
 * one replacement to order.
 *
 * RED before: the controller of the unit the counters were aimed at was asked
 * "which unit keeps them" — a choice over the other player's replacement too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { registerSynthetic, type Printed } from '../src/cards/dsl.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, give, pass, pick, spawn, toDeployment, toNextBattle } from './util.ts';

registerSynthetic({
  name: 'T696 Growth', cost: '', mana: 0, power: 0, toughness: 0, type: '{Battle} Test Spell',
  kind: 'spell', timing: 'battle', attrs: [], virus: false, burst: false, augmentAttrs: [],
  text: 'Put two +1/+1 counters on target unit.', image: '',
} as Printed, {
  spellEffect: {
    targets: { what: 'unit', prompt: 'T696 Growth: put two +1/+1 counters on target unit' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      const u = t && 'id' in t ? g.entity(t.id) : undefined;
      if (u) g.addCounters(u, 2, ctx.controller);
    },
  },
});

/** A (initiative) attacks with `aThieves` Counter Thieves beside a Mohruung;
 * D holds `dThieves` thieves and The Foretold; A grows The Foretold */
function growth(seed: number, aThieves: number, dThieves: number) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Mohruung');
  const at = Array.from({ length: aThieves }, () => spawn(h, A, 'Counter Thief'));
  const dt = Array.from({ length: dThieves }, () => spawn(h, D, 'Counter Thief'));
  const mark = spawn(h, D, 'The Foretold');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk], ...at.map(id => [id])] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'T696 Growth') });
  pick(h, { unit: mark });
  pass(h); pass(h);                                  // it resolves
  return { h, A, D, at, dt, mark };
}

const counters = (h: Harness, id: EntityId): number => ent(h, id)?.counters ?? 0;

test('CR 708.4a: Counter Thieves of different players — nothing is asked, the initiative player applies first and the other keeps them', () => {
  const r = growth(69601, 1, 1);
  assert.equal(ent(r.h, r.at[0]!)!.region, ent(r.h, r.dt[0]!)!.region, 'both thieves stand in the battle region');
  assert.equal(r.h.state.decision, null, 'each player had one replacement to order: no question');
  assert.equal(counters(r.h, r.dt[0]!), 2, 'the non-initiative player’s thief, applying last, keeps them'.replace('’', ''));
  assert.equal(counters(r.h, r.at[0]!), 0, 'the initiative player’s thief applied first and lost them'.replace('’', ''));
  assert.equal(counters(r.h, r.mark), 0);
  const lines = r.h.log.filter(m => /Counter Thief: the 2 counter/.test(m));
  assert.deepEqual(lines, [
    'Counter Thief: the 2 counter(s) for The Foretold are placed on Counter Thief instead.',
    'Counter Thief: the 2 counter(s) for Counter Thief are placed on Counter Thief instead.',
  ], 'two redirects, one after the other');
});

test('CR 708.4a: two Counter Thieves of one player — that player orders them, not the player whose unit it was', () => {
  const r = growth(69602, 2, 0);
  const dec = r.h.state.decision;
  assert.ok(dec, 'a question is open as the spell resolves');
  assert.equal(dec!.seat, r.A, 'the thieves’ controller is asked'.replace('’', ''));
  assert.match(dec!.prompt, /Counter Thief: which unit keeps the 2 counter\(s\) meant for The Foretold\?/);
  const i = dec!.options.findIndex(o => (o.value as { unit?: number }).unit === r.at[0]);
  r.h.do({ type: 'decide', seat: r.A, choice: i });
  assert.equal(counters(r.h, r.at[0]!), 2, 'the chosen thief keeps them');
  assert.equal(counters(r.h, r.at[1]!), 0);
});

test('CR 708.4a: two thieves of the initiative player and one of the other — no question, since every order ends on the other player thief', () => {
  // the initiative player's two apply first in either order, then the other
  // player's applies last and keeps them: no order of A's changes the outcome
  const r = growth(69603, 2, 1);
  assert.equal(r.h.state.decision, null, 'no order the initiative player could choose changes where they end');
  assert.equal(counters(r.h, r.dt[0]!), 2, 'the other player thief applies last');
  assert.equal(counters(r.h, r.at[0]!) + counters(r.h, r.at[1]!), 0);
});
