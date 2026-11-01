/* REPORT FXMF #306 (Nyar, 2026-10-31) — Death Greeter's trigger names the bar.
 *
 * "Death Greeter should indicate the number of the triggering spell. Most of
 * the time it is obvious because it is on top of the triggering spell, but
 * sometimes it can get removed and the lonely death greeter trigger does not
 * tell you what you will need to sacrifice."
 *
 * The stack caption's one-line "does" text (ui/doesline.ts, ui/does-lines.json)
 * read "Each player sacrifices a unit costing at most the spell's cost" — the
 * one "that spell's cost" trigger in the pool whose line had no number. Its
 * three siblings (Arcane Concentrator, Channeled Amalgam, Unstable Apparition)
 * already said {X} off the same event snapshot (eventCardCost, CR 111.11), so
 * Death Greeter now does the same: the cost is fixed when the spell is played,
 * so it prints as a plain number, and it reads off the trigger's own event —
 * the spell need not still be on the stack under it.
 *
 * Seeds 74500-74599.
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

/** a battle in D's region with D's Death Greeter on the table and D on priority */
function greeterBattle(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - h.state.initiative) as Seat;
  const bubb = spawn(h, A, 'Bubb');
  spawn(h, D, 'Death Greeter');
  giveResources(h, D, 'fire', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bubb]] });
  pass(h);                                          // priority -> D
  return { h, A, D };
}

const ui = await client();

const greeterItem = (s: GameState): StackItem | undefined =>
  s.stack.find(i => i.parts.some(p => p.effectKey === 'augment:Death Greeter#0'));
const name = (s: GameState) => (t: TargetRef): string =>
  ('unit' in t ? s.entities[t.unit]?.card ?? '?' : 'player' in t ? s.players[t.player]!.name : '?');

test('report FXMF #306: the Death Greeter trigger says the cost bar of the spell that set it off', () => {
  const { h, A, D } = greeterBattle(74501);
  // Wildfire is an X spell: its cost is the X paid (CR 111.11), here 4
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wildfire') });
  pick(h, 4);
  pick(h, { player: A });
  const it = greeterItem(h.state);
  assert.ok(it, 'the Greeter triggered on the Wildfire');
  assert.equal(doesLine(it!, h.state, name(h.state)), 'Each player sacrifices a unit costing 4 or less (Wildfire)');
});

test('report FXMF #306: the lonely trigger still says it with the spell gone from under it', () => {
  const { h, A, D } = greeterBattle(74502);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wildfire') });
  pick(h, 2);
  pick(h, { player: A });
  const it = greeterItem(h.state)!;
  // Nyar's case: the spell has left the stack (negated, or moved), the trigger stays
  const lonely = { ...h.state, stack: h.state.stack.filter(i => i.id === it.id) } as GameState;
  assert.equal(lonely.stack.length, 1);
  assert.equal(doesLine(it, lonely, name(lonely)), 'Each player sacrifices a unit costing 2 or less (Wildfire)');
});

test('report FXMF #306: the stack caption on the board says it, to both seats', () => {
  const { h, A, D } = greeterBattle(74503);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wildfire') });
  pick(h, 3);
  pick(h, { player: A });
  assert.ok(greeterItem(h.state), 'the premise: the trigger is on the stack, over the Wildfire');
  for (const seat of [A, D]) {
    const html = ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
    const at = html.indexOf('class="stackdoes"');
    assert.ok(at >= 0, `seat ${seat}: the lead caption has a does-line`);
    assert.match(html.slice(at, at + 200), /Each player sacrifices a unit costing 3 or less \(Wildfire\)/, `seat ${seat}`);
  }
});
