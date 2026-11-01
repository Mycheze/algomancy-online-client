/* DEATH GREETER'S STACK LINE NAMES THE SPELL (owner, 2026-11-01).
 *
 * Report #306 gave the lonely Death Greeter trigger its number ("costing 2 or
 * less", guard 745). The owner asked for the spell as well: "Each player
 * sacrifices a unit costing 2 or less (Squish)". The name comes from the new
 * {spell} slot (ui/doesline.ts), read off the trigger's own 'spellPlayed'
 * event snapshot (event.data.card) — the same snapshot eventCardCost reads the
 * number from — so it holds after the spell has left the stack.
 *
 * The three siblings whose amount is "that spell's cost" (Arcane Concentrator,
 * Channeled Amalgam, Unstable Apparition) read the same number off the same
 * event and say where it came from the same way. DERIVED below: every AMOUNT
 * entry that reads eventCardCost names the spell, and {spell} sits only on a
 * clause triggered by 'spellPlayed', the one event that carries the card.
 *
 * Seeds 76000-76099.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/sets/index.ts';
import { Harness } from '../../engine/src/harness.ts';
import { getCard } from '../../engine/src/cards/dsl.ts';
import type { GameState, Seat, StackItem, TargetRef } from '../../engine/src/types.ts';
import { AMOUNT, DOES, doesLine } from '../doesline.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';

function greeterBattle(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - h.state.initiative) as Seat;
  const bubb = spawn(h, A, 'Bubb');
  spawn(h, D, 'Death Greeter');
  giveResources(h, D, 'fire', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[bubb]] });
  pass(h);
  return { h, A, D };
}
const greeterItem = (s: GameState): StackItem | undefined =>
  s.stack.find(i => i.parts.some(p => p.effectKey === 'augment:Death Greeter#0'));
const name = (s: GameState) => (t: TargetRef): string =>
  ('unit' in t ? s.entities[t.unit]?.card ?? '?' : 'player' in t ? s.players[t.player]!.name : '?');

test('Death Greeter: the line names the spell that set it off, and still does with the spell gone', () => {
  const { h, A, D } = greeterBattle(76001);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Wildfire') });
  pick(h, 2);
  pick(h, { player: A });
  const it = greeterItem(h.state);
  assert.ok(it, 'the Greeter triggered on the Wildfire');
  assert.equal(doesLine(it!, h.state, name(h.state)), 'Each player sacrifices a unit costing 2 or less (Wildfire)');
  const lonely = { ...h.state, stack: h.state.stack.filter(i => i.id === it!.id) } as GameState;
  assert.equal(lonely.stack.length, 1, 'the premise: the spell has left the stack');
  assert.equal(doesLine(it!, lonely, name(lonely)), 'Each player sacrifices a unit costing 2 or less (Wildfire)');
});

test('every "that spell\'s cost" line names the spell; {spell} only where the trigger is a spell being played', () => {
  const bad: string[] = [];
  const readers = Object.entries(AMOUNT).filter(([, fn]) => String(fn).includes('eventCardCost')).map(([k]) => k);
  assert.ok(readers.length >= 4, `only ${readers.length} AMOUNT entries read eventCardCost — the match has drifted`);
  for (const k of readers) if (!DOES[k]?.includes('{spell}')) bad.push(`${k} reads the spell's cost but does not name it: "${DOES[k]}"`);
  for (const [k, tpl] of Object.entries(DOES)) {
    if (!tpl.includes('{spell}')) continue;
    const m = /^(augment|ability):(.+)#(\d+)$/.exec(k);
    const c = m ? getCard(m[2]!) : undefined;
    const ab = m && c ? (m[1] === 'augment' ? c.augmentText : c.abilities)?.[Number(m[3])] : undefined;
    const events = (ab as { events?: readonly string[] } | undefined)?.events ?? [];
    if (!events.includes('spellPlayed')) bad.push(`${k}: {spell} on a clause no 'spellPlayed' event triggers`);
  }
  assert.deepEqual(bad, []);
});
