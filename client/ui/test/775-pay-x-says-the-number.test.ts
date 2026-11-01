/* REPORT #318 (the owner, room EMNR, 2026-11-01) — the stack says the price.
 *
 * "Text under Abduct while on the stack says 'unless Gember pays its cost'
 * but it's actually 'unless Gember pays 5'."
 *
 * Abduct prints "…unless its controller pays [x]", and the X it means is the
 * X paid to cast it. The stack's one-line does-text (ui/does-lines.json)
 * paraphrased it as "its cost" — which reads as the TARGET's cost. Gravitational
 * Correction had the same clause as a raw "[x]" (drawn as the X glyph, not a
 * number). Both now say {X}, which `amountOf` fills from the item's committed
 * X: a paid X is fixed, so it prints as its number (the owner's rule in
 * ui/doesline.ts). Frosted Denial already read "pays {X}".
 *
 * Soul Tithe's "[one]" is left alone: it is a printed fixed 1, drawn as the
 * same cost glyph the card prints.
 *
 * Real games, both seats' board captions. Seeds 77500-77599.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/sets/index.ts';
import { Harness } from '../../engine/src/harness.ts';
import type { GameState, Seat, StackItem, TargetRef } from '../../engine/src/types.ts';
import { doesLine } from '../doesline.ts';
import { client } from './ui-driver.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';

/** a battle in D's region, A attacking with a Bubb, D on priority with mana to spare */
function battle(seed: number): { h: Harness; A: Seat; D: Seat; bubb: number } {
  // named as in EMNR (a seat named "Player 1" trips the caption's "1 units"
  // singular rule — a separate defect, see the round report)
  const h = new Harness(seed, ['Gember', 'mycheze']);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - h.state.initiative) as Seat;
  const bubb = spawn(h, A, 'Bubb');
  for (const k of ['wood', 'metal'] as const) giveResources(h, D, k, 6);
  giveResources(h, A, 'fire', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bubb]] });
  pass(h);                                          // priority -> D
  return { h, A, D, bubb };
}

const ui = await client();
const itemOf = (s: GameState, card: string): StackItem | undefined => s.stack.find(i => i.card === card);
const name = (s: GameState) => (t: TargetRef): string =>
  ('unit' in t ? s.entities[t.unit]?.card ?? '?'
    : 'player' in t ? s.players[t.player]!.name
      : 'stack' in t ? s.stack.find(i => i.id === t.stack)?.label ?? '?' : '?');

/** D casts Abduct for X = x at A's Bubb */
function abduct(seed: number, x: number) {
  const b = battle(seed);
  const { h, D, bubb } = b;
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Abduct') });
  pick(h, x);
  pick(h, { unit: bubb });
  const it = itemOf(h.state, 'Abduct');
  assert.ok(it, 'the premise: Abduct is on the stack');
  assert.equal(it!.x, x, 'the premise: X was paid at cast');
  return { ...b, it: it! };
}

test('report #318: Abduct on the stack says the X paid, not "its cost"', () => {
  const { h, A, it } = abduct(77501, 5);
  const owner = h.state.players[A]!.name;
  assert.equal(doesLine(it, h.state, name(h.state)), `Gain control of Bubb unless ${owner} pays 5`);
});

test('report #318: the number follows the X — Abduct for 7 says 7', () => {
  const { h, A, it } = abduct(77502, 7);
  assert.equal(doesLine(it, h.state, name(h.state)), `Gain control of Bubb unless ${h.state.players[A]!.name} pays 7`);
});

test('report #318: the board caption says it, to both seats', () => {
  const { h, A, D } = abduct(77503, 5);
  const owner = h.state.players[A]!.name;
  for (const seat of [A, D]) {
    const html = ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
    const at = html.indexOf('class="stackdoes"');
    assert.ok(at >= 0, `seat ${seat}: the lead caption has a does-line`);
    const cap = html.slice(at, at + 300);
    assert.match(cap, new RegExp(`unless ${owner} pays 5`), `seat ${seat}`);
    assert.doesNotMatch(cap, /its cost/, `seat ${seat}`);
  }
});

test('report #318, same clause: Gravitational Correction says the X paid, not the X glyph', () => {
  const { h, A, D } = abduct(77504, 4);
  const ab = itemOf(h.state, 'Abduct')!;
  if (h.state.priority === D) pass(h);              // priority -> A, over the Abduct
  assert.equal(h.state.priority, A, 'the premise: A may answer the Abduct');
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Gravitational Correction') });
  pick(h, 3);
  pick(h, { stack: ab.id });
  const gc = itemOf(h.state, 'Gravitational Correction');
  assert.ok(gc, 'the premise: the Correction is on the stack');
  assert.equal(doesLine(gc!, h.state, name(h.state)),
    `Change the targets of ${ab.label} unless ${h.state.players[D]!.name} pays 3`);
});
