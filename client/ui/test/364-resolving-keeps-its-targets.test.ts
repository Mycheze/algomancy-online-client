/* #189 (owner, room QJAF): "Celestial Purge said 'target gone' when it itself
 * erased the target and was still resolving. A spell that loses its target
 * while resolving shouldn't get that warning."
 *
 * Purge erases its unit and THEN its controller Glimpses 3 — a decision, so
 * the resolution stops part-way (R78) with the spell on the strip as the
 * resolving row and its target already gone. Two things went wrong there:
 *
 *  1. the strip judged the resolving row like a waiting one (`lostTargets`
 *     against the table as it is now), so the spell wore TARGET MISSING for
 *     the target it had just removed — the badge, the caption's
 *     strike-through and the missing arrow all said so. They all ask
 *     ui/effectface.ts `lostTargetsForRow` now, and a resolving row answers
 *     nothing.
 *  2. the caption's one-line "Erase {0}. {0.controller} Glimpses 3" lost its
 *     second sentence — the erased unit has no controller left to name, and a
 *     sentence with an empty slot is dropped — so mid-Glimpse it read
 *     "Erase (gone)." with no Glimpse. The board now remembers what it was
 *     shown (ui/doesline.ts TableMemory) and names a departed target from it.
 *
 * ui/main.ts is a boot script with no DOM harness, so the wiring is read as
 * text at the bottom.
 *
 * Seeds 36400-36499.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Harness } from '../../engine/src/harness.ts';
import type { GameState, Seat, StackItem, TargetRef } from '../../engine/src/types.ts';
import { give, giveResources, pass, pick, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { lostTargetsForRow } from '../effectface.ts';
import { doesLine, lastKnown, noteTable, tableMemory, type TableMemory } from '../doesline.ts';
import { stackRows } from '../flash.ts';

/** QJAF's moment: Celestial Purge cast at an enemy unit, resolved into its
 * Glimpse — the board's memory fed every state on the way, as the strip does */
function midGlimpse(seed: number): {
  h: Harness; A: Seat; D: Seat; slime: number; purge: StackItem; mem: TableMemory;
} {
  const h = new Harness(seed);
  const mem = tableMemory();
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const tok = spawn(h, A, 'Unit Token');
  const slime = spawn(h, D, 'Lurking Slimebeast');          // 8/3, trigger-free
  giveResources(h, A, 'water', 3);                          // Purge: bb/1
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[tok]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Celestial Purge') });
  pick(h, { unit: slime });
  noteTable(mem, h.state);                                  // the spell waits, its target named
  pass(h); pass(h);                                         // resolve → erase, then the Glimpse
  noteTable(mem, h.state);
  const purge = h.state.resolving!;
  assert.ok(purge, 'the fixture is mid-resolution (R78)');
  assert.equal(purge.card, 'Celestial Purge');
  assert.equal(h.state.decision?.seat, D, 'the Glimpse is being asked of the erased unit controller');
  assert.equal(h.state.entities[slime], undefined, 'and the unit is gone from the table');
  return { h, A, D, slime, purge, mem };
}

test('a resolving Celestial Purge mid-Glimpse reports no lost target, a waiting item aimed at the same unit does', () => {
  const { h, A, slime, purge } = midGlimpse(36400);
  // a second spell, still WAITING below, aimed at the same unit (QJAF had a
  // Capture there): for it the target really has gone
  const waiting: StackItem = {
    id: 9001, kind: 'spell', card: 'Capture', label: 'Capture', controller: A, region: purge.region,
    negated: false, parts: [{ effectKey: 'spell:Capture', targets: [{ unit: slime }] }],
  } as StackItem;
  const rows = stackRows([waiting], [], Date.now(), purge);
  const resolving = rows.find(r => r.resolving)!;
  const below = rows.find(r => !r.resolving)!;
  assert.equal(resolving.item.id, purge.id);
  assert.deepEqual(lostTargetsForRow(resolving, h.state), [],
    'no "target gone" on the spell that removed it and is still resolving');
  assert.deepEqual(lostTargetsForRow(below, h.state), [{ unit: slime }],
    'the waiting item whose target left still says so');
});

test('the resolving Celestial Purge caption still says who Glimpses, naming the erased unit', () => {
  const { h, purge, mem, slime } = midGlimpse(36401);
  const names = h.state.players.map(p => p.name);
  const label = (t: TargetRef): string =>
    ('unit' in t ? h.state.entities[t.unit]?.card ?? lastKnown(mem, t)?.name ?? '(gone)' : '?');
  const line = doesLine(purge, h.state, label, s => s, mem);
  const ctl = names[lastKnown(mem, { unit: slime })!.seat]!;
  assert.equal(line, `Erase Lurking Slimebeast. ${ctl} Glimpses 3`,
    'both sentences, with the name and seat the board last saw');
  // the memory is what carries it: without one the second sentence drops
  assert.doesNotMatch(doesLine(purge, h.state, label)!, /Glimpse/);
});

test('the table memory forgets a finished game and remembers only what it was shown', () => {
  const mem = tableMemory();
  const s = (n: number, entities: Record<number, unknown>): GameState =>
    ({ actionCount: n, entities, stack: [], resolving: null } as unknown as GameState);
  noteTable(mem, s(10, { 4: { id: 4, card: 'Bubb', controller: 1 } }));
  assert.deepEqual(lastKnown(mem, { unit: 4 }), { name: 'Bubb', seat: 1 });
  noteTable(mem, s(11, {}));
  assert.deepEqual(lastKnown(mem, { unit: 4 }), { name: 'Bubb', seat: 1 }, 'gone from the table, still known');
  noteTable(mem, s(0, {}));
  assert.equal(lastKnown(mem, { unit: 4 }), undefined, 'a new game (the count went back) starts the memory over');
  assert.equal(lastKnown(mem, { player: 0 as Seat }), undefined, 'players never leave, and are not remembered');
});

test('the board asks the row-aware helper at all three sites and names departed targets from memory', () => {
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /\blostTargets\(/,
    'no site judges a row by the bare item: the resolving row would say "target gone" again');
  assert.equal(main.match(/lostTargetsForRow\(/g)?.length, 3, 'the badge, the caption and the arrows');
  assert.match(main, /function stackBoardHtml\(\): string \{\n\s*const now = Date\.now\(\);\n\s*noteTable\(TABLE_MEMORY, h\.state\);/,
    'the strip feeds the memory on every paint, before it can return early');
  assert.match(main, /doesLine\(it, h\.state, [^\n]*TABLE_MEMORY\)/, 'the caption line reads seats from it');
  assert.match(main, /entities\[t\.unit\]\?\.card \?\? lastKnown\(TABLE_MEMORY, t\)\?\.name/,
    'and the target label reads names from it');
});
