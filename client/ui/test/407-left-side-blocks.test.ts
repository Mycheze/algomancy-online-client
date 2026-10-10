/* 407 — R321 IN THE CLIENT, THE LEFT-HAND SIDE: a side-block before column 1
 * is built on the board exactly as one past the attack's right end is.
 *
 * The RAQ ("What is blocked?"): a defender may block where no attacker is, to
 * either side of the attack, any number of units, each its own column. The
 * engine keys a side-block to the left `-1`, `-2`, … (engine/test/400); until
 * this file the board offered only the right side. ui/test/400 is the right
 * side's half and this is modelled on it.
 *
 * §1  while I build blocks the panel draws one open side-block column BEFORE
 *     column 1 — and only while blocks are being built
 * §2  a unit dropped there goes out keyed -1, the engine takes it, and the
 *     builder opens the next one further out
 * §2b the same by touch
 * §3  two to the left and one to the right go out as one declaration
 * §4  taken back out, the left column closes up to the one open column again
 * §4b the line closing ranks under the build leaves a left side-block put
 * §5  committed, the left side-block is column 1, "no attacker"
 * §6  a left side-block does not move the number keys: 1 is still column 1
 * §7  the opponent watches it being built, and is sent it as `left`
 * §8  the build arithmetic (ui/formation.ts): keys survive opening, a refused
 *     plan's kept part, the re-key, and what the opponent is sent
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import type { Action, EntityId, Seat } from '../../engine/src/types.ts';
import { pass, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { buildOfPlan, leftCols, leftReach, openLeft, planOfBuild } from '../formation.ts';
import { client } from './ui-driver.ts';

const ui = await client();

/** the block step: A attacks with two one-unit columns, D has `k` units */
function blockStep(seed: number, k: number): { h: Harness; A: Seat; D: Seat; mine: EntityId[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = [spawn(h, A, 'The Foretold'), spawn(h, A, 'The Foretold')];
  const mine = Array.from({ length: k }, () => spawn(h, D, 'The Foretold'));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: atk.map(id => [id]) });
  for (let g = 0; g < 10 && h.state.battle!.step !== 'blocks'; g++) pass(h);
  assert.equal(h.state.battle!.step, 'blocks', 'the premise: the block step');
  return { h, A, D, mine };
}

/** join as the defender with nothing in hand and nothing built — the client
 * is one module for the whole file, so a build can outlive its test */
function joinBlocking(h: Harness, D: Seat): void {
  ui.join(h.state, D, legalActions(h.state, D));
  ui.key('Escape');   // put down anything carried
  ui.key('Escape');   // and clear any build (BL-19)
  ui.sent();
}

/** the declaration Confirm sends */
function confirm(): Extract<Action, { type: 'declareBlocks' }> {
  ui.actions();
  ui.click({ btn: 'confirmblocks' });
  const sent = ui.actions().filter((a): a is Extract<Action, { type: 'declareBlocks' }> => a.type === 'declareBlocks');
  assert.equal(sent.length, 1, 'Confirm sent one declaration');
  return sent[0]!;
}

test('§1 while blocks are built, one open side-block column stands before column 1', () => {
  const { h, D } = blockStep(40701, 2);
  joinBlocking(h, D);
  assert.ok(ui.has({ act: 'slot', ci: '0', row: '0' }), 'the first attacking column');
  assert.ok(ui.has({ act: 'slot', ci: '-1', row: '0' }), 'and a side-block slot before it');
  assert.ok(ui.has({ act: 'slot', ci: '-1', row: '1' }), 'both rows of it');
  assert.ok(!ui.has({ act: 'slot', ci: '-2', row: '0' }), 'one open side column, not a run of them');
  assert.match(ui.html(), /side-block · left/, 'labelled as a side-block');
  const html = ui.html();
  assert.ok(html.indexOf('data-ci="-1"') < html.indexOf('data-ci="0"'), 'drawn to the LEFT of column 1');
  assert.ok(ui.has({ act: 'slot', ci: '2', row: '0' }), 'the right-hand one is still there too');
});

test('§1b outside the block step there is no left side column', () => {
  const { h, A, D, mine } = blockStep(40711, 1);
  h.do({ type: 'declareBlocks', seat: D, blocks: { 0: [mine[0]!] } });
  ui.join(h.state, A, legalActions(h.state, A));
  assert.ok(!ui.has({ act: 'slot', ci: '-1', row: '0' }));
  assert.doesNotMatch(ui.html(), /side-block · left/);
});

test('§2 a unit dropped in the left column is sent as key -1, and the engine takes it', () => {
  const { h, D, mine } = blockStep(40702, 2);
  joinBlocking(h, D);
  ui.click({ act: 'unit', id: String(mine[0]) });
  ui.click({ act: 'slot', ci: '-1', row: '0' });
  assert.ok(ui.has({ act: 'slot', ci: '-2', row: '0' }), 'the next side column opens beyond it');
  assert.ok(!ui.has({ act: 'slot', ci: '-1', row: '0' }), 'the front of -1 is taken');
  assert.ok(ui.has({ act: 'slot', ci: '-1', row: '1' }), 'its back row still open');
  assert.ok(ui.has({ act: 'slot', ci: '0', row: '0' }), 'column 1 is untouched by the opening');
  const sent = confirm();
  assert.deepEqual(sent.blocks, { [-1]: [mine[0]] }, 'keyed just left of column 1');
  h.do(sent);
  assert.deepEqual(h.state.battle!.blocks, { 0: [mine[0]] }, 'the engine opened a column for it on the left');
  assert.deepEqual(h.state.battle!.sideCols, [0]);
});

test('§2b a finger reaches it too: tap the unit, tap the left column', () => {
  const { h, D, mine } = blockStep(40712, 1);
  joinBlocking(h, D);
  ui.tap({ act: 'unit', id: String(mine[0]) });
  ui.tap({ act: 'slot', ci: '-1', row: '1' });     // the back row: it moves up on Confirm
  assert.deepEqual(confirm().blocks, { [-1]: [mine[0]] });
});

test('§3 two to the left and one to the right go out in one declaration', () => {
  const { h, D, mine } = blockStep(40703, 4);
  joinBlocking(h, D);
  ui.click({ act: 'unit', id: String(mine[0]) });
  ui.click({ act: 'slot', ci: '-1', row: '0' });
  ui.click({ act: 'unit', id: String(mine[1]) });
  ui.click({ act: 'slot', ci: '-2', row: '0' });
  ui.click({ act: 'unit', id: String(mine[3]) });
  ui.click({ act: 'slot', ci: '0', row: '0' });
  // the left ones stand at the front of the build: the right-hand side must
  // not read them as built side-blocks of its own
  assert.ok(ui.has({ act: 'slot', ci: '2', row: '0' }), 'one open right-hand column');
  assert.ok(!ui.has({ act: 'slot', ci: '3', row: '0' }), 'and only one');
  ui.click({ act: 'unit', id: String(mine[2]) });
  ui.click({ act: 'slot', ci: '2', row: '0' });
  assert.ok(ui.has({ act: 'slot', ci: '-3', row: '0' }), 'a third open column further out');
  const sent = confirm();
  assert.deepEqual(sent.blocks, { [-2]: [mine[1]], [-1]: [mine[0]], 0: [mine[3]], 2: [mine[2]] });
  h.do(sent);
  assert.equal(h.state.battle!.columns.length, 5, 'two opened left, two attacking, one opened right');
  assert.deepEqual(h.state.battle!.blocks, { 0: [mine[1]], 1: [mine[0]], 2: [mine[3]], 4: [mine[2]] });
});

test('§4 taken back out, the left side closes up to one open column', () => {
  const { h, D, mine } = blockStep(40704, 2);
  joinBlocking(h, D);
  ui.click({ act: 'unit', id: String(mine[0]) });
  ui.click({ act: 'slot', ci: '-1', row: '0' });
  assert.ok(ui.has({ act: 'slot', ci: '-2', row: '0' }));
  ui.click({ act: 'unit', id: String(mine[0]) });   // a placed unit clicked again comes out
  assert.ok(ui.has({ act: 'slot', ci: '-1', row: '0' }), 'the -1 column is open again');
  assert.ok(!ui.has({ act: 'slot', ci: '-2', row: '0' }), 'and nothing past it');
  // …and a unit put back in a right-hand column is keyed as it always was
  ui.click({ act: 'unit', id: String(mine[1]) });
  ui.click({ act: 'slot', ci: '1', row: '0' });
  assert.deepEqual(confirm().blocks, { 1: [mine[1]] }, 'the emptied left column sends nothing');
});

test('§4b when the line closes ranks under the build, a left side-block keeps its key', () => {
  const { h, D, mine } = blockStep(40714, 2);
  joinBlocking(h, D);
  ui.click({ act: 'unit', id: String(mine[0]) });
  ui.click({ act: 'slot', ci: '-1', row: '0' });
  ui.click({ act: 'unit', id: String(mine[1]) });
  ui.click({ act: 'slot', ci: '1', row: '0' });     // blocking the SECOND attacker
  // R72: the first attacking column empties and the line closes up — the
  // second attacker is column 1 now (ui/main.ts ensureBlockKeys re-keys)
  const s2 = structuredClone(h.state);
  s2.battle!.columns = [s2.battle!.columns[1]!];
  ui.update(s2, legalActions(h.state, D));
  assert.deepEqual(confirm().blocks, { [-1]: [mine[0]], 0: [mine[1]] },
    'the blocker followed its attacker in; the side-block stayed beside column 1');
});

test('§5 committed, a left side-block is column 1 and has no attacker', () => {
  const { h, D, mine } = blockStep(40705, 1);
  h.do({ type: 'declareBlocks', seat: D, blocks: { [-1]: [mine[0]!] } });
  ui.join(h.state, D, legalActions(h.state, D));
  assert.match(ui.html(), /column 1 · side-block/);
  assert.match(ui.html(), /no attacker/, 'not "gone": nobody ever stood there');
});

test('§6 with a left side-block placed, number key 1 still means column 1', () => {
  const { h, D, mine } = blockStep(40706, 2);
  joinBlocking(h, D);
  ui.click({ act: 'unit', id: String(mine[0]) });
  ui.click({ act: 'slot', ci: '-1', row: '0' });
  ui.click({ act: 'unit', id: String(mine[1]) });
  ui.key('1');
  assert.deepEqual(confirm().blocks, { [-1]: [mine[0]], 0: [mine[1]] });
});

test('§7 the opponent is sent the left side-blocks, and watches them pending', () => {
  const { h, A, D, mine } = blockStep(40707, 1);
  joinBlocking(h, D);
  ui.click({ act: 'unit', id: String(mine[0]) });
  ui.click({ act: 'slot', ci: '-1', row: '0' });
  const wire = ui.sent().filter(m => m['t'] === 'building');
  assert.ok(wire.length, 'the build was published');
  assert.deepEqual(wire.at(-1)!['left'], [[mine[0]]], 'as `left`, nearest column 1 first');
  assert.deepEqual(wire.at(-1)!['cols'], [], 'and not in the right-hand columns');
  ui.key('Escape');
  // the attacker's screen, as the server relays it
  ui.join(h.state, A, legalActions(h.state, A));
  ui.push({ t: 'building', seat: D, cols: [], send: [], left: [[mine[0]]] });
  const html = ui.html();
  assert.match(html, /side-block · left/, 'the watcher sees the left column');
  assert.ok(html.includes(`data-previd="${mine[0]}"`), 'with the unit in it');
  assert.ok(!ui.has({ act: 'slot', ci: '-1', row: '0' }), 'and nothing of theirs to drop into');
  ui.push({ t: 'building', seat: D, cols: [], send: [] });
  assert.doesNotMatch(ui.html(), /side-block · left/, 'gone again when they take it back');
});

test('§8 the build arithmetic', () => {
  const a = 11 as EntityId, b = 12 as EntityId, c = 13 as EntityId;
  // opening keeps every key where it was
  const o = openLeft([[a], [], [b]], 0, -2);
  assert.equal(o.left, 2);
  assert.equal(o.index, 0);
  assert.deepEqual(planOfBuild(o.columns, o.left), { 0: [a], 2: [b] }, 'the attack-side keys did not move');
  assert.deepEqual(openLeft([[a]], 1, -1).columns, [[a]], 'already open: nothing changes');
  assert.deepEqual(openLeft([[a]], 1, 0).index, 1, 'key 0 is behind the left columns');
  // holes stay holes (publishCols reads them as lanes)
  const sparse: EntityId[][] = []; sparse[2] = [a];
  const os = openLeft(sparse, 0, -1);
  assert.ok(!(1 in os.columns) && os.columns[3]?.[0] === a, 'a hole is shifted, not filled');
  // a refused declaration's kept part comes back where it was
  const back = buildOfPlan({ [-2]: [a], 1: [b] });
  assert.deepEqual(back, { columns: [[a], [], [], [b]], left: 2 });
  assert.deepEqual(planOfBuild(back.columns, back.left), { [-2]: [a], 1: [b] }, 'and round-trips');
  assert.deepEqual(buildOfPlan({}), { columns: [], left: 0 });
  // how far out the build reaches, and what the opponent is sent
  assert.equal(leftReach([[], [c], [a]], 2), 1, 'an emptied outer column does not count');
  assert.equal(leftReach([[c], [], [a]], 2), 2);
  assert.deepEqual(leftCols([[c], [], [a]], 2), [[], [c]], 'nearest first, holes kept');
  assert.deepEqual(leftCols([[], [c], [a]], 2), [[c]], 'empty outer ones dropped');
  assert.deepEqual(leftCols([[a]], 0), []);
});
