/* 686 — THE STACK CAPTION SAYS THE LIFE, ROT, DEBT AND COUNTERS THAT LAND
 * (CT-412, the rest of CT-370's class).
 *
 * CT-370 (test 678) priced a damage line. The pool's other amount modifiers
 * were never said on the line (the sweep: every card declaring `amountMods` or
 * `amountMultipliers` — Conduit of Pain, Flux Resonator, Proliferating Slime,
 * Arbiter of Vitality):
 *   - Arbiter of Vitality doubles all life gain and life loss (CR 708.6), and
 *     damage to a player is a life loss: "Deal 3 damage" to a player took 6;
 *   - Flux Resonator puts one more counter when an allied source puts them
 *     (CR 708.5), and Proliferating Slime one more counter, rot or debt on an
 *     enemy unit or player.
 * The caption now asks the engine (ui/doesline.ts amountPricer, and
 * damagePricer for the life a player's damage costs: E.amountPreview, the
 * same amount layer lifeAmount, gainRot/gainDebt and addCounters commit
 * with), and every case here is then RESOLVED, so the line is held to what
 * the engine really does, in both seats' views.
 *
 * Seeds 68600-68699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import type { EntityId, GameState, Seat, StackItem, TargetRef } from '../../engine/src/types.ts';
import { ent, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, tokensOf } from '../../engine/test/util.ts';
import { viewFor } from '../../server/view.ts';
import { doesLine } from '../doesline.ts';

const nameIn = (s: GameState) => (t: TargetRef): string =>
  ('unit' in t ? s.entities[t.unit]?.card ?? '?' : 'player' in t ? s.players[t.player]!.name : '?');

/** the line in the engine's state and in both seats' views, which must agree */
function line(h: Harness, it: StackItem): string | null {
  const own = doesLine(it, h.state, nameIn(h.state));
  for (const seat of [0, 1] as Seat[]) {
    const v = viewFor(h.state, seat) as GameState;
    assert.equal(doesLine(v.stack.find(i => i.id === it.id)!, v, nameIn(v)), own, `seat ${seat} reads the same line`);
  }
  return own;
}

const resolve = (h: Harness): void => { pass(h); pass(h); };

/** A attacks with Good Whale into D's region, where D's `mods` stand; D holds priority */
function battle(seed: number, mods: string[], aMods: string[] = []): { h: Harness; A: Seat; D: Seat; whale: EntityId; mine: EntityId[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const whale = spawn(h, A, 'Good Whale');
  for (const m of aMods) spawn(h, A, m);
  const mine = mods.map(m => spawn(h, D, m));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[whale]] });
  while (h.state.priority !== D) pass(h);
  return { h, A, D, whale, mine };
}

/** D casts spell token `card` (value `x`) at `ref` */
function token(h: Harness, D: Seat, card: string, x: number, ref: unknown): StackItem {
  new E(h.state).createSpellToken(D, card, x, h.state.battle!.region);
  h.do({ type: 'castSpellToken', seat: D, entityId: tokensOf(h, D).at(-1)!.id });
  pick(h, ref);
  return h.state.stack.find(i => i.controller === D && i.card === card)!;
}

/** D plays `card` from hand, paying with these resources */
function cast(h: Harness, D: Seat, card: string, ...els: Parameters<typeof giveResources>[2][]): void {
  h.state.players[D]!.resources = [];
  for (const el of els) giveResources(h, D, el, 1);
  const i = give(h, D, card);
  h.do({ type: 'playCard', seat: D, handIndex: i });
}

const onStack = (h: Harness, D: Seat, card: string): StackItem => {
  const it = h.state.stack.find(i => i.controller === D && i.card === card);
  assert.ok(it, `${card} is on the stack`);
  return it;
};

test('CR 708.6 / CT-412: under Arbiter of Vitality damage to a player says the doubled life it costs, and costs it', () => {
  const { h, A, D } = battle(68600, ['Arbiter of Vitality']);
  const it = token(h, D, 'Fireball', 3, { player: A });
  const who = h.state.players[A]!.name;
  assert.equal(line(h, it), `Deal 3 damage to ${who} (6 life lost, Arbiter of Vitality)`);
  const before = h.state.players[A]!.life;
  resolve(h);
  assert.equal(before - h.state.players[A]!.life, 6);
});

test('CR 708.6 / CT-412: under Arbiter of Vitality a gain life line says the doubled gain, and gains it', () => {
  const { h, D, whale } = battle(68601, ['Arbiter of Vitality']);
  cast(h, D, 'Life Channel', 'light', 'light');
  pick(h, { unit: whale });
  const it = onStack(h, D, 'Life Channel');
  assert.match(line(h, it) ?? '', /^Gain 6 life, then Good Whale gains .*Arbiter of Vitality\)$/);
  const before = h.state.players[D]!.life;
  resolve(h);
  assert.equal(h.state.players[D]!.life - before, 6);
});

test('CR 708.5 / CT-412: under Proliferating Slime rot on an enemy player says the one more, and puts it', () => {
  const { h, A, D } = battle(68602, ['Proliferating Slime']);
  cast(h, D, 'Fester', 'dark');
  pick(h, { player: A });
  const it = onStack(h, D, 'Fester');
  assert.equal(line(h, it), `${h.state.players[A]!.name} gains 2 rot (+1 Proliferating Slime)`);
  resolve(h);
  assert.equal(h.state.players[A]!.rot ?? 0, 2);
});

test('CR 708.5 / CT-412: the Slime own controller gains the printed rot, and the line says so', () => {
  const { h, D } = battle(68603, ['Proliferating Slime']);
  cast(h, D, 'Fester', 'dark');
  pick(h, { player: D });
  const it = onStack(h, D, 'Fester');
  assert.equal(line(h, it), `${h.state.players[D]!.name} gains a rot`);
  resolve(h);
  assert.equal(h.state.players[D]!.rot ?? 0, 1);
});

test('CR 708.5 / CT-412: under Flux Resonator an X counters line says the one more an allied source puts', () => {
  const { h, D, mine } = battle(68604, ['Flux Resonator']);
  const flux = mine[0]!;
  const it = token(h, D, 'Crystal', 2, { unit: flux });
  assert.equal(line(h, it), 'Put 3 +1/+1 counters on Flux Resonator (+1 Flux Resonator)');
  resolve(h);
  assert.equal(ent(h, flux)!.counters, 3);
});

test('CR 708.5 / CT-412: a counter on each of your units, a group, priced per unit: all agree under Flux Resonator', () => {
  const { h, D, mine } = battle(68605, ['Flux Resonator', 'Good Whale']);
  cast(h, D, 'Wither and Bloom', 'wood', 'metal', 'wood');
  pick(h, 'bloom');
  const it = onStack(h, D, 'Wither and Bloom');
  assert.equal(line(h, it), 'Put 2 +1/+1 counters on each of your units (+1 Flux Resonator)');
  resolve(h);
  for (const u of mine) assert.equal(ent(h, u)!.counters, 2, `${ent(h, u)!.card} got 2`);
});

test('CR 708.5 / CT-412: a counter on each enemy under the caster Slime: the one more, as -1/-1 counters', () => {
  const { h, D, whale } = battle(68606, ['Proliferating Slime']);
  cast(h, D, 'Wither and Bloom', 'wood', 'metal', 'wood');
  pick(h, 'wither');
  const it = onStack(h, D, 'Wither and Bloom');
  assert.equal(line(h, it), 'Put 2 -1/-1 counters on each enemy (+1 Proliferating Slime)');
  resolve(h);
  assert.equal(ent(h, whale)!.counters, -2);
});

test('CR 708.5 / CT-412: each player gains a rot under the caster Slime: the line says who gains the one more', () => {
  const { h, A, D } = battle(68608, ['Proliferating Slime']);
  cast(h, D, 'Plague Ritual', 'dark', 'dark');
  const it = onStack(h, D, 'Plague Ritual');
  assert.equal(line(h, it),
    `Each player discards a card, gains a rot, augments a Wraith (${h.state.players[A]!.name} gains 2, +1 Proliferating Slime)`);
  resolve(h);
  for (let k = 0; k < 10 && h.state.decision; k++) h.do({ type: 'decide', seat: h.state.decision.seat, choice: 0 });
  assert.equal(h.state.players[A]!.rot ?? 0, 2, 'the enemy gains the one more');
  assert.equal(h.state.players[D]!.rot ?? 0, 1, 'the Slime own controller gains the printed one');
});

test('CR 708.11a / CT-412: aimed at a unit under a prevention shield the line says none of it gets through, and none does', () => {
  const { h, A, D, whale } = battle(68609, []);
  const w = ent(h, whale)!;
  w.damageShield = 'Phytochemical Protection';   // as the spell sets it
  w.damageShieldBy = A;
  const it = token(h, D, 'Fireball', 3, { unit: whale });
  assert.equal(line(h, it), 'Deal 3 damage to Good Whale (prevented by Phytochemical Protection)');
  resolve(h);
  assert.equal(ent(h, whale)!.damage, 0, 'nothing is dealt');
});

test('CR 708.5 / CT-412: with nothing on the table to change them the lines are the printed amounts', () => {
  const { h, A, D, whale } = battle(68607, ['Hooba-Nan']);
  assert.equal(line(h, token(h, D, 'Fireball', 3, { player: A })), `Deal 3 damage to ${h.state.players[A]!.name}`);
  resolve(h);
  while (h.state.priority !== D) pass(h);
  assert.equal(line(h, token(h, D, 'Crystal', 2, { unit: whale })), 'Put 2 +1/+1 counters on Good Whale');
});
