/**
 * CR 110.7, 722.6 / CT-252 — a graft composite whose REQUIRED target has none
 * is never put on the stack.
 *
 * RAQ "[Solved] Target requirements to put effect on stack.", _passer: "When
 * you attack with Megadeath + Resurrect, then Create Poison 5 + Put target
 * unit with cost 2 or less from your bin into play cannot be put on the stack
 * unless you target such unit in your bin." The engine used to push the
 * composite with the Resurrect part aimed at nothing and let it fizzle whole,
 * which handed the opponent a priority window over an item that should never
 * exist. Now it is dropped at trigger time, and (CR 109.9b) a composite never
 * offered spends no bounded use.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../src/harness.ts';
import { ent, finishBattle, give, giveResources, pass, spawn, toDeployment, toNextBattle } from './util.ts';
import type { EntityId, Seat } from '../src/types.ts';

const answer = (h: Harness): void => {
  const dec = h.state.decision!;
  h.do({ type: 'decide', seat: dec.seat, choice: dec.pickOrder ? dec.options.map((_, i) => i) : 0 });
};
const poisons = (h: Harness): number => Object.values(h.state.entities).filter(u => u.card === 'Poison').length;

/** Megadeath with `graft` grafted under it, the bin emptied of the graft card itself */
function megadeathWith(seed: number, graft: string, kind: 'fire' | 'dark'): { h: Harness; A: Seat; mega: EntityId; mod: EntityId } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative;
  const mega = spawn(h, A, 'Megadeath');
  giveResources(h, A, kind, 4);
  h.do({ type: 'graft', seat: A, from: 'hand', index: give(h, A, graft), hostId: mega, position: 0 });
  h.state.players[A]!.bin = [];
  const mod = ent(h, mega)!.mods.find(m => ent(h, m)?.card === graft)!;
  assert.ok(mod !== undefined, `setup: ${graft} is grafted under Megadeath`);
  toNextBattle(h, A);
  return { h, A, mega, mod };
}

test('CR 110.7 / CT-252: Megadeath + Resurrect with no legal bin card never reaches the stack', () => {
  const { h, A, mega, mod } = megadeathWith(5460, 'Resurrect', 'fire');
  const before = h.state.stack.length;
  const seen: string[] = [];
  h.do({ type: 'declareAttack', seat: A, columns: [[mega]] });
  seen.push(...h.state.stack.map(i => i.label));
  assert.equal(h.state.stack.length, before, `nothing was put on the stack: [${seen.join(' | ')}]`);
  assert.ok(h.events.some(ev => /does not go on the stack/.test(ev.msg)), 'and the log says why');
  // CR 109.9b: never offered, so neither bounded use is spent
  assert.equal(ent(h, mega)!.budgets['ability:Megadeath#0'] ?? 0, 0, 'Megadeath [once] not spent');
  assert.equal(ent(h, mod)!.budgets['graft'] ?? 0, 0, 'Resurrect graft use not spent');
  while (h.state.stack.length > before || h.state.decision) {
    if (h.state.decision) answer(h);
    else pass(h);
  }
  assert.equal(poisons(h), 0, 'no Poison 5: the untargeted half goes too');
  finishBattle(h);
});

test('CR 110.7 / CT-252: the control — with a cost 2 unit in the bin the composite goes on the stack', () => {
  const { h, A, mega } = megadeathWith(5461, 'Resurrect', 'fire');
  h.state.players[A]!.bin.push('Ignis Sprite');                 // cost 1
  const before = h.state.stack.length;
  h.do({ type: 'declareAttack', seat: A, columns: [[mega]] });
  while (h.state.decision && h.state.stack.length === before) answer(h);
  assert.equal(h.state.stack.length, before + 1, 'the composite is on the stack');
  assert.equal(ent(h, mega)!.budgets['ability:Megadeath#0'], 1,
    'and its [once] is spent: the key the first test reads is the live one');
  while (h.state.stack.length > before || h.state.decision) {
    if (h.state.decision) answer(h);
    else pass(h);
  }
  assert.equal(poisons(h), 1, 'and it made its Poison 5');
  finishBattle(h);
});

test('CR 110.7 / CT-252: an optional graft target (you may) does not hold the composite back', () => {
  // Blightwalker: "you may pay [2] to recall another unit from your bin" — a
  // "you may ... target" declines at the target step, so an empty bin is no bar
  const { h, A, mega } = megadeathWith(5462, 'Blightwalker', 'dark');
  const before = h.state.stack.length;
  h.do({ type: 'declareAttack', seat: A, columns: [[mega]] });
  while (h.state.decision && h.state.stack.length === before) answer(h);
  assert.equal(h.state.stack.length, before + 1, 'the composite is on the stack');
  while (h.state.stack.length > before || h.state.decision) {
    if (h.state.decision) answer(h);
    else pass(h);
  }
  assert.equal(poisons(h), 1, 'and Megadeath made its Poison 5');
  finishBattle(h);
});
