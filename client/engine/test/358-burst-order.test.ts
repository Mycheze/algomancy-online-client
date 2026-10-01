/* R309 — THE CASTER ORDERS A {BURST} (owner, 2026-10-01, report FXAE a86).
 *
 *   "it needs to do the same thing as stacking triggers where you click them
 *    in the order you want them to resolve NOT in the order you want to put
 *    them on the stack."
 *   "You have to put all tokens (of the same name) onto the stack at once …
 *    It's all or nothing with Burst tokens." — and no auto mode: "Just force
 *    them to choose the order."
 *
 * The group still goes on together (R16/R81). What is new is `ordered`: the
 * caster picks the token that resolves next, aims it, and so on; the first
 * pick ends on top. Without the flag a log replays exactly as it always did.
 *
 * Seeds 35800-35899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { E } from '../src/engine.ts';
import { apply } from '../src/apply.ts';
import { finishBattle, pass, pick, spawn, toDeployment, toNextBattle, tokensOf } from './util.ts';
import type { Seat } from '../src/types.ts';

/** a battle where the defender D holds priority with Fireball 1, 3 and 2 */
function burstInBattle(seed: number): { h: Harness; A: Seat; D: Seat; atk: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const e = new E(h.state);
  const r = e.homeRegion(D);
  e.createSpellToken(D, 'Fireball', 1, r);
  e.createSpellToken(D, 'Fireball', 3, r);
  e.createSpellToken(D, 'Fireball', 2, r);
  h.state = e.s;
  pass(h);                                          // initiative acts first — priority → D
  return { h, A, D, atk };
}
const fireballs = (h: Harness, D: Seat) => tokensOf(h, D).filter(t => t.card === 'Fireball');
const byX = (h: Harness, D: Seat, x: number) => fireballs(h, D).find(t => t.x === x)!.id;

test('R309: the caster picks each Fireball in RESOLVE order and aims it — the first pick ends on top', () => {
  const { h, A, D } = burstInBattle(35800);
  h.do({ type: 'castSpellToken', seat: D, entityId: byX(h, D, 1), ordered: true });
  assert.equal(h.state.suspension?.type, 'burstPick', 'the first question is which resolves first');
  assert.equal(h.state.decision!.options.length, 3, 'all three are offered');
  assert.equal(h.state.stack.length, 0, 'nothing is on the stack yet');
  pick(h, { unit: byX(h, D, 3) });                  // #1: the 3
  pick(h, { player: A });                           // …aimed at the attacker
  assert.equal(h.state.suspension?.type, 'burstPick', 'then which resolves second');
  assert.equal(h.state.decision!.options.length, 2);
  pick(h, { unit: byX(h, D, 1) });                  // #2: the 1
  pick(h, { player: A });
  // one left: no question, straight to its target
  assert.equal(h.state.suspension?.type, 'cast', 'the last one is not asked about, only aimed');
  pick(h, { player: A });                           // #3: the 2
  assert.deepEqual(h.state.stack.map(i => i.x), [2, 1, 3],
    'bottom → top: the first pick (the 3) is on top, so it resolves first');
  assert.equal(h.state.priority, (1 - D), 'and only now does the opponent get priority');
  finishBattle(h);
});

test('R309: without `ordered` a burst casts exactly as before — entity-id order, first aimed at the bottom', () => {
  const { h, A, D } = burstInBattle(35801);
  h.do({ type: 'castSpellToken', seat: D, entityId: byX(h, D, 2) });
  assert.equal(h.state.suspension?.type, 'cast', 'no order question at all');
  pick(h, { player: A }); pick(h, { player: A }); pick(h, { player: A });
  assert.deepEqual(h.state.stack.map(i => i.x), [1, 3, 2],
    'created 1, 3, 2 — aimed and pushed in that order, as every old log expects');
  finishBattle(h);
});

test('R309: a lone token is not asked to be ordered', () => {
  const h = new Harness(35802);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  const e = new E(h.state);
  e.createSpellToken(D, 'Fireball', 2, e.homeRegion(D));
  h.state = e.s;
  pass(h);
  h.do({ type: 'castSpellToken', seat: D, entityId: fireballs(h, D)[0]!.id, ordered: true });
  assert.equal(h.state.suspension?.type, 'cast', 'straight to its target');
  pick(h, { player: A });
  assert.equal(h.state.stack.length, 1);
  finishBattle(h);
});

test('R309: an ordered burst is deterministic — the same actions from the same state give the same stack', () => {
  const { h, A, D } = burstInBattle(35804);
  const before = structuredClone(h.state);
  const from = h.actions.length;
  h.do({ type: 'castSpellToken', seat: D, entityId: byX(h, D, 2), ordered: true });
  pick(h, { unit: byX(h, D, 2) }); pick(h, { player: A });
  pick(h, { unit: byX(h, D, 3) }); pick(h, { player: A });
  pick(h, { player: A });
  let st = before;
  for (const a of h.actions.slice(from)) st = apply(st, a).state;
  assert.deepEqual(st, h.state, 'the burst questions are answered by index, like every decision');
  assert.deepEqual(st.stack.map(i => i.x), [1, 3, 2]);
});
