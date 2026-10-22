/* CT-250 — a source that left play remembers its formation even when that
 * formation is now EMPTY.
 *
 * The RAQ, "[Solved] Dead Unit Effect on Stack" (_passer, adopted 2026-10-09):
 * "there are some which will remember they were in formation and will work
 * fine (Hooba-Bot, Hooba-Pon, Hooba-Lin, ...)" — with no exception for a lone
 * attacker. CR 602.6f states it and CR 602.6k names it as an exception to "no
 * unit standing in the formation, no position". The engine used to answer the
 * lone case from 602.6k: a lone Hooba-Lin killed under its own attack trigger
 * collapsed its column, `formationSlots` found no living unit and offered no
 * slot, and the 1/1 was created OUTSIDE any formation.
 *
 * The placers that read a dead source are every card calling
 * `placeInFormation` with a `sourceId` (Hooba-Lin, Hooba-Bot, Hooba-God) plus
 * Hooba-Pon's in-formation play; the last test derives that list from the
 * card sources so a new one cannot be missed.
 *
 * Seeds 56101-56109.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { E } from '../src/engine.ts';
import { Harness } from '../src/harness.ts';
import type { EntityId, Seat } from '../src/types.ts';
import { ent, finishBattle, give, giveResources, pass, spawn, toDeployment, toNextBattle, unitsOf } from './util.ts';

/** `name` attacks ALONE and is killed with its attack trigger on the stack */
function loneAttackKilled(seed: number, name: string): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const src = spawn(h, A, name);
  if (name === 'Hooba-Pon') { giveResources(h, A, 'water', 4); give(h, A, 'Hooba-Pon'); }
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[src]] });
  assert.equal(h.state.stack.length, 1, `${name}: its attack trigger is on the stack`);
  new E(h.state).destroy(ent(h, src)!, 'dies');
  assert.deepEqual(h.state.battle!.columns, [], `${name}: its column closed up (CR 602.5)`);
  return { h, A, D };
}

/** the units of `seat` in the battle region that stand in no formation */
function outsideLine(h: Harness, seat: Seat): string[] {
  const b = h.state.battle!;
  const grid = new Set<EntityId>([...b.columns.flat(), ...Object.values(b.blocks).flat()]);
  return unitsOf(h, seat).filter(u => u.region === b.region && !grid.has(u.id)).map(u => u.card);
}

for (const [name, made] of [['Hooba-Lin', 'Unit Token'], ['Hooba-Bot', 'Robot'], ['Hooba-God', 'Hooba-God']] as const) {
  test(`CR 602.6f / CT-250: a lone ${name} killed under its attack trigger puts its ${made} in the formation it remembers`, () => {
    const { h, A } = loneAttackKilled(name === 'Hooba-Lin' ? 56101 : name === 'Hooba-Bot' ? 56102 : 56103, name);
    pass(h); pass(h);                                  // the trigger resolves
    // one position (the line has no column left, so its two ends are one
    // place) — auto-picked, CR 602.6d
    assert.equal(h.state.decision, null, 'one legal position, so nothing is asked');
    const cols = h.state.battle!.columns;
    assert.equal(cols.length, 1, 'a column is opened');
    assert.equal(ent(h, cols[0]![0]!)!.card, made, `the ${made} stands in it`);
    assert.deepEqual(outsideLine(h, A), [], 'and nothing is left outside the line');
    finishBattle(h);
  });
}

test('CR 602.6f / CT-250: a lone Hooba-Pon killed under its attack trigger still plays the paid unit into the formation it remembers', () => {
  const { h, A } = loneAttackKilled(56104, 'Hooba-Pon');
  pass(h); pass(h);
  const dec = h.state.decision!;
  assert.ok(dec, 'the pay question is asked — there is a position to play into');
  h.do({ type: 'decide', seat: A, choice: dec.options.findIndex(o => o.label === 'Hooba-Pon') });
  pass(h); pass(h);                                    // the played unit resolves
  const cols = h.state.battle!.columns;
  assert.equal(cols.length, 1);
  assert.equal(ent(h, cols[0]![0]!)!.card, 'Hooba-Pon', 'the paid unit is played into the line');
  assert.deepEqual(outsideLine(h, A), []);
  finishBattle(h);
});

test('CR 602.6f / CT-250: a lone blocking Hooba-Bot killed under its block trigger puts its Robot into the blocking column it remembers', () => {
  const h = new Harness(56105, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Good Whale');
  const bot = spawn(h, D, 'Hooba-Bot');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h); pass(h);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [bot] } });
  assert.ok(h.state.stack.some(i => i.sourceId === bot), 'its block trigger is on the stack');
  new E(h.state).destroy(ent(h, bot)!, 'dies');
  assert.deepEqual(h.state.battle!.blocks[0], [], 'the blocking column is empty');
  while (h.state.stack.some(i => i.sourceId === bot)) pass(h);
  assert.equal(h.state.decision, null, 'one position (the hole it left), so nothing is asked');
  const robot = h.state.battle!.blocks[0]![0];
  assert.equal(robot !== undefined && ent(h, robot)!.card, 'Robot', 'the Robot stands where Hooba-Bot blocked');
  assert.deepEqual(outsideLine(h, D), []);
  finishBattle(h);
});

test('CR 602.6k / CT-250: the remembered exception is the dead source only — a living source with an empty line is still offered nothing', () => {
  const h = new Harness(56106, ['Ben', 'Rashi']);
  toDeployment(h);
  const A = h.state.initiative;
  const src = spawn(h, A, 'Hooba-Lin');
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[src]] });
  const e = new E(h.state);
  assert.equal(e.remembersFormation(src), false, 'alive: it names its formation by standing in it');
  e.destroy(ent(h, src)!, 'dies');
  assert.equal(e.remembersFormation(src), true, 'dead with its trigger waiting: it remembers');
  assert.deepEqual(e.formationSlots(A), [], 'the seat itself, with nobody standing in the line, is offered nothing');
  assert.deepEqual(e.myFormationSlots(src).map(s => s.spot), [{ kind: 'end', end: 'right' }],
    'through the source that remembers it: one new column');
  pass(h); pass(h);
  finishBattle(h);
});

test('CR 602.6f / CT-250: every placer that reads its source is covered — the dead-source placers are derived from the card sources', async () => {
  // every card that hands placeInFormation a sourceId, plus every in-formation
  // play; each must be one of the cards exercised above
  const dir = new URL('../src/cards/sets/', import.meta.url);
  const found = new Set<string>();
  for (const f of await readdir(dir)) {
    if (!f.endsWith('.ts')) continue;
    const src = await readFile(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/placeInFormation\([^;]*?source: '([^']+)',\s*sourceId/g)) found.add(m[1]!);
    for (const m of src.matchAll(/card\('([^']+)'[\s\S]*?(?=\ncard\(|$)/g)) {
      if (/intoFormation: true/.test(m[0])) found.add(m[1]!);
    }
  }
  assert.deepEqual([...found].sort(), ['Hooba-Bot', 'Hooba-God', 'Hooba-Lin', 'Hooba-Pon'],
    'a new dead-source placer needs its own lone-source case in this file');
});
