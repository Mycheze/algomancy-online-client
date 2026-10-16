/**
 * CR 708.4a, 608.8c — combat damage to a player with two or more replacement
 * effects that want it.
 *
 * THE ORDER IS THE PLAYER'S. Caleb Gannon, rules-questions 2025-11-25: "its a
 * replacement effect so it just takes one thing and replaces it with another
 * (you the player control how they stack)". The owner, 2026-10-16, asked who
 * orders replacement effects when the order changes the outcome, chose "Ask
 * the player now". With two Oorblaks ("[Augment] If combat damage would be
 * dealt to you, that damage is dealt to me instead") the order decides which
 * one takes the damage, so the player being hit is asked — and only then:
 * one Oorblak asks nothing.
 *
 * A REDIRECT COMES BEFORE "AS 1 ROT", always, and it is not a choice. The
 * owner, 2026-10-16, on Blightsea Polyp ("[Augment] Columns deal combat damage
 * to players as 1 rot.") beside Oorblak: "The column doesn't even get to deal
 * damage to the player. It gets redirected to the Oorblak instead. There's no
 * way for it to add rot (unless piercing is added into the mix) since it gets
 * directed to the Oorblak, which isn't a player". Before this, the two applied
 * in entity-id order, so a Polyp that entered play first turned the hit into
 * rot and the Oorblak never saw it.
 *
 * RED before the fix: no question was ever asked (the first Oorblak in id
 * order always took the hit), and an earlier Polyp made rot of a hit an
 * Oorblak should have taken.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { apply } from '../src/apply.ts';
import { E } from '../src/engine.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, pass, spawn, toDeployment, toNextBattle } from './util.ts';

function tok(h: Harness, seat: Seat, p: number, t: number): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  g.settle();
  return u.id;
}

/** A attacks unblocked with a p/10 token into D, who holds `cards` (spawned in
 * that order, so the first has the lowest id); stops at the moment combat
 * damage is dealt — which is either done, or a question */
function strike(seed: number, cards: string[], power: number, piercing: boolean) {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, power, 10);
  const ids = cards.map(c => spawn(h, D, c));
  const life = h.state.players[D]!.life;
  const rot = new E(h.state).rot(D);
  toNextBattle(h, A);
  if (piercing) { const g = new E(h.state); g.addTempAttr(g.entity(atk)!, 'Piercing'); }
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);                                  // combat damage
  const after = () => ({
    lost: life - h.state.players[D]!.life,
    rot: new E(h.state).rot(D) - rot,
    damage: ids.map(id => ent(h, id)?.damage ?? 'dead'),
  });
  return { h, A, D, ids, after };
}

/** answer the open question by clicking the unit `id` */
function choose(h: Harness, id: EntityId): void {
  const dec = h.state.decision!;
  const i = dec.options.findIndex(o => (o.value as { unit?: number })?.unit === id);
  assert.ok(i !== -1, `the question offers unit ${id}: ${dec.options.map(o => o.label).join(', ')}`);
  h.do({ type: 'decide', seat: dec.seat, choice: i });
}

test('CR 708.4a: two Oorblaks and combat damage — the player being hit is asked which takes it, and the answer decides it', () => {
  // RED before: no question, and the first Oorblak (lowest id) always took it
  const r = strike(47101, ['Oorblak', 'Oorblak'], 3, false);
  const dec = r.h.state.decision;
  assert.ok(dec, 'a question is open');
  assert.equal(dec!.seat, r.D, 'the player the damage would be dealt to chooses');
  assert.match(dec!.prompt, /Which Oorblak takes the 3 combat damage first\?/);
  assert.deepEqual(dec!.options.map(o => (o.value as { unit: number }).unit), r.ids,
    'one choice per Oorblak, each naming the unit on the board');
  assert.equal(r.h.state.battle?.damageStep, 'normal', 'asked before any damage is dealt');
  assert.deepEqual(r.after().damage, [0, 0], 'nothing has been dealt while the question is open');
  choose(r.h, r.ids[1]!);
  assert.equal(r.h.state.decision, null, 'one question: the other Oorblak has nothing left to take');
  assert.deepEqual(r.after().damage, [0, 3], 'the SECOND Oorblak, as chosen, took all of it');
  assert.equal(r.after().lost, 0);
});

test('CR 708.4a: two Oorblaks — choosing the first one puts the damage on the first one', () => {
  const r = strike(47102, ['Oorblak', 'Oorblak'], 3, false);
  choose(r.h, r.ids[0]!);
  assert.deepEqual(r.after().damage, [3, 0]);
});

test('CR 708.4a: one Oorblak asks nothing', () => {
  const r = strike(47103, ['Oorblak'], 3, false);
  assert.equal(r.h.state.decision, null, 'one replacement effect: nothing to order');
  assert.deepEqual(r.after().damage, [3]);
  assert.equal(r.after().lost, 0);
});

test('CR 708.4a: two Oorblaks and Piercing — the chosen one takes its lethal share first, the other takes what is left', () => {
  // 6 Piercing into two 2/4 Oorblaks: the chosen one dies to 4, the other takes 2
  const r = strike(47104, ['Oorblak', 'Oorblak'], 6, true);
  assert.match(r.h.state.decision!.prompt, /Piercing/, 'the prompt says the excess goes on');
  choose(r.h, r.ids[1]!);
  assert.equal(r.h.state.decision, null, 'with one Oorblak left there is no second question');
  assert.deepEqual(r.after().damage, [2, 'dead'], 'the second died first; the first took the 2 left over');
  assert.equal(r.after().lost, 0);
});

test('CR 708.4a: the answer is an action — a saved log replays into the same game', () => {
  // the board is set up white-box, so the replay starts from a SAVED state
  // (a JSON round trip, as a saved game is) taken before the attack, and runs
  // every action after it — the question and its answer included
  const h = new Harness(47105);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = tok(h, A, 3, 10);
  const oo = [spawn(h, D, 'Oorblak'), spawn(h, D, 'Oorblak')];
  toNextBattle(h, A);
  const saved = JSON.stringify(h.state);
  const from = h.actions.length;
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  pass(h); pass(h);
  assert.ok(h.state.decision, 'the question is asked');
  choose(h, oo[1]!);
  let again = JSON.parse(saved) as typeof h.state;
  for (const a of h.actions.slice(from)) again = apply(again, a).state;
  assert.equal(JSON.stringify(again), JSON.stringify(h.state), 'the replay is identical');
  assert.equal(again.entities[oo[1]!]!.damage, 3, 'and the recorded answer decided it');
});

for (const order of [['Blightsea Polyp', 'Oorblak'], ['Oorblak', 'Blightsea Polyp']]) {
  test(`CR 608.8c: ${order.join(' then ')} — Oorblak takes the damage of the column and no rot is gained`, () => {
    // RED before when the Polyp entered first: it made 1 rot of the hit and
    // the Oorblak never saw it
    const r = strike(order[0] === 'Oorblak' ? 47106 : 47107, order, 3, false);
    assert.equal(r.h.state.decision, null, 'not a choice: a redirect always comes first');
    const oo = order.indexOf('Oorblak');
    assert.equal(r.after().damage[oo], 3, 'owner: "It gets redirected to the Oorblak instead"');
    assert.equal(r.after().rot, 0, 'owner: "There\'s no way for it to add rot"');
    assert.equal(r.after().lost, 0);
  });
}

test('CR 608.8c: Polyp, Oorblak and a Piercing column — the excess past the Oorblak is dealt to the player, as 1 rot', () => {
  const r = strike(47108, ['Blightsea Polyp', 'Oorblak'], 10, true);
  assert.equal(r.h.state.decision, null);
  assert.equal(r.after().damage[1], 'dead', 'the Oorblak took its 4 and died');
  assert.equal(r.after().rot, 1, 'the 6 that reached the player became the column\'s 1 rot');
  assert.equal(r.after().lost, 0, 'and no life');
});

test('CR 608.8c: Polyp beside two Oorblaks — the question is about the Oorblaks only, and no rot', () => {
  const r = strike(47109, ['Blightsea Polyp', 'Oorblak', 'Oorblak'], 3, false);
  const dec = r.h.state.decision!;
  assert.deepEqual(dec.options.map(o => (o.value as { unit: number }).unit), [r.ids[1], r.ids[2]],
    'Blightsea Polyp is not a choice: it never comes before a redirect');
  choose(r.h, r.ids[2]!);
  assert.deepEqual(r.after().damage, [0, 0, 3]);
  assert.equal(r.after().rot, 0);
});
