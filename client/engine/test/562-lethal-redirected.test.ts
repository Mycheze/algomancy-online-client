/* CT-296 — {Lethal} kills only with combat damage that REACHES the player.
 *
 * Lethal: "Any combat damage from a lethal unit will kill a player." Oorblak:
 * "If combat damage would be dealt to you, that damage is dealt to me
 * instead." The owner ruled on 2026-10-22 that a Lethal column whose combat
 * damage is wholly redirected into Oorblak does NOT kill — his words of
 * 2026-10-16: "The column doesn't even get to deal damage to the player. It
 * gets redirected to the Oorblak instead." Two halves are kept: {Piercing}
 * excess that gets past the Oorblak does reach the player and kills, and
 * Blightsea Polyp's rot is still combat damage DEALT to the player (CR 608.8a,
 * Caleb RQ 1298894533718970370), so Lethal still kills through it.
 *
 * Seeds 56201-56209.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E } from '../src/engine.ts';
import { Harness } from '../src/harness.ts';
import type { Attr, EntityId, Seat } from '../src/types.ts';
import { ent, pass, spawn, toDeployment, toNextBattle } from './util.ts';

function tok(h: Harness, seat: Seat, p: number, t: number, attrs: Attr[]): EntityId {
  const g = new E(h.state);
  const u = g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [p, t] });
  for (const a of attrs) g.addTempAttr(u, a);
  g.settle();
  return u.id;
}

/** `make` the attacker's column, `defence` the defender's board, then attack unblocked */
function unblocked(seed: number, make: (h: Harness, A: Seat) => EntityId, defence: string[]): { h: Harness; A: Seat; D: Seat; atk: EntityId; def: EntityId[] } {
  const h = new Harness(seed, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = make(h, A);
  const def = defence.map(n => spawn(h, D, n));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  for (let i = 0; i < 40 && h.state.battle?.step !== 'blocks'; i++) pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: {} });
  for (let i = 0; i < 10 && h.state.battle && h.state.winner === null && h.state.battle.step !== 'afterWindow'; i++) pass(h);
  return { h, A, D, atk, def };
}

test('CR 802.24a / CT-296: Gublin wholly redirected into Oorblak deals the player nothing, and the player lives', () => {
  const { h, D, def: [oo] } = unblocked(56201, (h, A) => spawn(h, A, 'Gublin'), ['Oorblak']);
  assert.equal(ent(h, oo!)?.damage, 1, 'Oorblak took the 1');
  assert.equal(h.state.winner ?? null, null, 'nobody has won');
  assert.ok(h.state.players[D]!.life > 0);
  assert.ok(h.events.some(e => /is Lethal, but none of its damage reached/.test(e.msg)),
    'the log says why Lethal did nothing');
});

test('CR 608.8c / CT-296: a Piercing Lethal excess that gets past Oorblak reaches the player and kills', () => {
  const { h, A, def: [oo] } = unblocked(56202, (h, A) => tok(h, A, 6, 9, ['Lethal', 'Piercing']), ['Oorblak']);
  assert.equal(ent(h, oo!)?.damage, 4, 'Oorblak took its lethal 4, no more (the game ended before it was swept)');
  assert.equal(h.state.winner, A, 'the 2 that reached the defender are Lethal');
});

test('CR 608.8a / CT-296: Blightsea Polyp turns the Lethal hit into rot, which is still damage dealt, so the player is killed', () => {
  const { h, A } = unblocked(56203, (h, A) => spawn(h, A, 'Gublin'), ['Blightsea Polyp']);
  assert.equal(h.state.winner, A, 'rot is still combat damage dealt to the player');
});

test('CR 608.8c / CT-296: Oorblak first, then Blightsea Polyp — the redirect takes it all, so the Polyp sees nothing and Lethal kills nobody', () => {
  const { h, D, def: [oo] } = unblocked(56204, (h, A) => spawn(h, A, 'Gublin'), ['Oorblak', 'Blightsea Polyp']);
  assert.equal(ent(h, oo!)?.damage, 1, 'Oorblak took the 1');
  assert.equal(h.state.winner ?? null, null);
  assert.ok(h.state.players[D]!.life > 0);
});
