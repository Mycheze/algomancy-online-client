/* 678 — THE STACK CAPTION SAYS THE DAMAGE THAT LANDS (CT-370).
 *
 * CT-194 made the does-line double a {Powerful} item's own damage (test 618).
 * It left out three things the engine applies to the same hit
 * (dealEffectDamageAllIn, CR 112.9): Conduit of Pain's "plus 1" (an additive
 * amount modifier, CR 708.5, applied BEFORE the doubling), a {Vulnerable}
 * recipient's receive-side doubling (CR 802.16a), and, on a line naming no
 * one ("each unit"), the Pure unit on the table that the doubling skips.
 *
 * The caption now asks the engine's own pieces (ui/doesline.ts damagePricer:
 * E.amountDeltaPreview, E.stackItemAttrs, E.effAttrs), and every case here is
 * then RESOLVED, so the line is held to the damage the engine really deals.
 *
 * Seeds 67800-67899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import type { GameState, Seat, StackItem, TargetRef } from '../../engine/src/types.ts';
import { ent, give, giveResources, pass, pick, spawn, toDeployment, toNextBattle, tokensOf } from '../../engine/test/util.ts';
import { viewFor } from '../../server/view.ts';
import { doesLine } from '../doesline.ts';

const nameIn = (s: GameState) => (t: TargetRef): string => ('unit' in t ? s.entities[t.unit]?.card ?? '?' : '?');

interface Board { conduit?: boolean; powerful?: boolean; vulnerable?: boolean; at?: string }

/** A attacks with `at` (Good Whale, 7/5); D casts a Fireball 1 at it, with
 * D's Conduit of Pain / Emberflame Enlightener at home (the battle region) */
function fireball(seed: number, o: Board): { h: Harness; it: StackItem; victim: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const victim = spawn(h, A, o.at ?? 'Good Whale');
  if (o.conduit) spawn(h, D, 'Conduit of Pain');
  if (o.powerful) spawn(h, D, 'Emberflame Enlightener');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[victim]] });
  if (o.vulnerable) { const g = new E(h.state); g.addTempAttr(g.entity(victim)!, 'Vulnerable'); }
  new E(h.state).createSpellToken(D, 'Fireball', 1, h.state.battle!.region);
  while (h.state.priority !== D) pass(h);
  h.do({ type: 'castSpellToken', seat: D, entityId: tokensOf(h, D)[0]!.id });
  pick(h, { unit: victim });
  return { h, it: h.state.stack.find(i => i.controller === D)!, victim };
}

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

test('CR 112.9 / CT-370: under Conduit of Pain the caption says the 1 more it deals, and it deals it', () => {
  const { h, it, victim } = fireball(67800, { conduit: true });
  assert.equal(line(h, it), 'Deal 2 damage to Good Whale (+1 Conduit of Pain)');
  resolve(h);
  assert.equal(ent(h, victim)!.damage, 2);
});

test('CR 112.9 / CT-370: Conduit of Pain and Powerful together, the addition first: (1 + 1) x 2', () => {
  const { h, it, victim } = fireball(67801, { conduit: true, powerful: true });
  assert.equal(line(h, it), 'Deal 4 damage to Good Whale (Powerful, +1 Conduit of Pain)');
  resolve(h);
  assert.equal(ent(h, victim)!.damage, 4);
});

test('CR 802.16a / CT-370: aimed at a Vulnerable unit the caption says what it receives', () => {
  const { h, it, victim } = fireball(67802, { vulnerable: true });
  assert.equal(line(h, it), 'Deal 2 damage to Good Whale (Vulnerable)');
  resolve(h);
  assert.equal(ent(h, victim)!.damage, 2);
});

test('CR 802.25g / CT-370: a Pure target is dealt the addition but not the doubling', () => {
  const { h, it, victim } = fireball(67803, { conduit: true, powerful: true, at: 'Just a Unit' });
  assert.equal(line(h, it), 'Deal 2 damage to Just a Unit (+1 Conduit of Pain)');
  resolve(h);
  assert.equal(ent(h, victim)?.damage ?? 'dead', 2);
});

test('CR 802.25g / CT-370: an each-unit line under Powerful says the Pure unit on the table takes the printed number', () => {
  const h = new Harness(67804);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  const pure = spawn(h, A, 'Just a Unit');
  spawn(h, D, 'Emberflame Enlightener');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk], [pure]] });
  h.state.players[D]!.resources = [];
  giveResources(h, D, 'earth', 4);
  while (h.state.priority !== D) pass(h);
  const i = give(h, D, 'Haboob');
  h.do({ type: 'playCard', seat: D, handIndex: i });
  const it = h.state.stack.find(x => x.controller === D && x.card === 'Haboob');
  assert.ok(it, 'Haboob is on the stack');
  assert.equal(line(h, it), 'Deal 2 damage to each unit (Powerful, Pure units take 1)');
  const before = { whale: ent(h, atk)!.damage, pure: ent(h, pure)!.damage };
  resolve(h);
  assert.equal(ent(h, atk)!.damage - before.whale, 2, 'a plain unit takes the doubled number');
  assert.equal(ent(h, pure)!.damage - before.pure, 1, 'the Pure one takes the printed number, as the note said');
});

test('CR 112.9 / CT-370: with nothing on the table to change it the line is the printed number', () => {
  const { h, it } = fireball(67805, {});
  assert.equal(line(h, it), 'Deal 1 damage to Good Whale');
});
