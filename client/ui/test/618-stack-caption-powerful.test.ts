/* CT-194 (found with report #188, room UVYZ): the stack caption said what a
 * spell would deal without the attribute that changes it — a Fireball under
 * Emberflame Enlightener read "Deal 1 damage to The Foretold" and dealt 2.
 *
 * #188 gave the stack card its Powerful chip (test 365) and left the wording.
 * The does-line now asks the same `E.stackItemAttrs` the chips and resolution
 * read, per part, and says the number the item will really deal, and why.
 *
 * Seeds 61800-61899.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { E } from '../../engine/src/engine.ts';
import type { GameState, Seat, StackItem, TargetRef } from '../../engine/src/types.ts';
import { ent, pass, pick, spawn, toDeployment, toNextBattle, tokensOf } from '../../engine/test/util.ts';
import { viewFor } from '../../server/view.ts';
import { doesLine, renderTemplate, type SlotContext } from '../doesline.ts';

const nameIn = (s: GameState) => (t: TargetRef): string => ('unit' in t ? s.entities[t.unit]?.card ?? '?' : '?');

/** A Fireball 1 cast by D at A's attacker, with or without Emberflame Enlightener */
function fireball(seed: number, enlightener: boolean, at = 'The Foretold'): { h: Harness; it: StackItem; victim: number } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const victim = spawn(h, A, at);
  if (enlightener) spawn(h, D, 'Emberflame Enlightener');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[victim]] });
  new E(h.state).createSpellToken(D, 'Fireball', 1, h.state.battle!.region);
  while (h.state.priority !== D) pass(h);
  h.do({ type: 'castSpellToken', seat: D, entityId: tokensOf(h, D)[0]!.id });
  pick(h, { unit: victim });
  return { h, it: h.state.stack.find(i => i.controller === D)!, victim };
}

test('CR 802.10d / CT-194: a Powerful Fireball says the damage it will deal, and why, in both seat views', () => {
  const { h, it, victim } = fireball(61800, true);
  assert.equal(doesLine(it, h.state, nameIn(h.state)), 'Deal 2 damage to The Foretold (Powerful)');
  for (const seat of [0, 1] as Seat[]) {
    const v = viewFor(h.state, seat) as GameState;
    const seen = v.stack.find(i => i.id === it.id)!;
    assert.equal(doesLine(seen, v, nameIn(v)), 'Deal 2 damage to The Foretold (Powerful)', `seat ${seat}`);
  }
  pass(h); pass(h);
  assert.equal(ent(h, victim)!.damage, 2, 'and it resolves as the line says');
});

test('CR 802.10d / CT-194: without the grant the line is the printed number, unchanged', () => {
  const { h, it } = fireball(61801, false);
  assert.equal(doesLine(it, h.state, nameIn(h.state)), 'Deal 1 damage to The Foretold');
});

test('CR 802.10f / CT-194: aimed at a Pure unit the grant does nothing, and the line says the printed number', () => {
  const { h, it, victim } = fireball(61802, true, 'Just a Unit');
  assert.equal(doesLine(it, h.state, nameIn(h.state)), 'Deal 1 damage to Just a Unit');
  pass(h); pass(h);
  assert.equal(ent(h, victim)!.damage, 1, 'and it resolves as the line says');
});

const ctx = (o: Partial<SlotContext> = {}): SlotContext => ({
  target: i => ['Bubb', 'Skybreaker', 'Chombot'][i] ?? null, count: 1,
  controllerOf: () => 'Rashi', me: 'Verdant Vengeance', you: 'Ben', opponent: 'Rashi',
  amount: { x: 9, live: false }, mode: undefined, text: s => s, powerful: true, ...o,
});

test('CR 802.10d / CT-194: every way a line states the item damage is doubled, fixed and live', () => {
  assert.equal(renderTemplate('Deal {X} damage to {0}', ctx()), 'Deal 18 damage to Bubb (Powerful)');
  assert.equal(renderTemplate('Deal {X} damage to {0}', ctx({ amount: { x: 3, live: true } })),
    'Deal X damage to Bubb (currently 6, Powerful)');
  assert.equal(renderTemplate('{me} deals {X} damage to {0}', ctx({ amount: { x: 3, live: true } })),
    'Verdant Vengeance deals X damage to Bubb (currently 6, Powerful)');
  assert.equal(renderTemplate('Deal 8 damage to {0}. Draw a card', ctx()), 'Deal 16 damage to Bubb (Powerful). Draw a card');
  assert.equal(renderTemplate('Put a -1/-1 counter on each unit, then deal 2 damage to each player', ctx()),
    'Put a -1/-1 counter on each unit, then deal 4 damage to each player (Powerful)');
  assert.equal(renderTemplate('Deal damage to each player equal to cards in their hand', ctx()),
    'Deal double damage to each player equal to cards in their hand (Powerful)');
  assert.equal(renderTemplate("Deal 2 damage to {1+}, then split 2 per ally hit among {0}'s units", ctx({ count: 2 })),
    "Deal 4 damage to Skybreaker, then split 4 per ally hit among Bubb's units (Powerful)");
});

test('CR 802.10e / CT-194: a unit made to deal damage is the source, so the item grant leaves its number alone', () => {
  assert.equal(renderTemplate('{0} deals {X} damage to {1}', ctx({ count: 2 })), 'Bubb deals 9 damage to Skybreaker');
  assert.equal(renderTemplate('Create a Fireball {X}', ctx()), 'Create a Fireball 9', 'not damage at all');
});
