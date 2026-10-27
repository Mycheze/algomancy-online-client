/* 702 — REPORTS #281 AND #292: CONFIRM ASKS ABOUT THE COUNTERATTACK.
 *
 * Two players in three days (CQTW, Karanda; KEHE, StubTailDstroyer) took back
 * a block declaration to send the counterattack they had forgotten. The owner,
 * 2026-10-27: *"once a player declares their blocking formation and has
 * leftover units that aren't blocking, didn't send any units during the normal
 * window AND is able to counter attack, then we should add a 'send counter
 * attackers?' window that they can do it very easily and quickly (or hit no
 * counterattackers)"* — and leave it the same for whoever already sends while
 * blocking.
 *
 * §1  Confirm with units left over and none sent sends nothing, and asks
 * §2  "No counterattack" declares exactly the blocks that were built
 * §3  a chip sends that unit, "All" sends every leftover; the engine takes both
 * §4  whoever already sent a unit is never asked; Enter does not decline
 * §5  no leftover unit, no question; "Go back" keeps the plan and asks again
 * §6  only the blocker, only in round 1, only once — ui/battle.ts shouldAskCounter
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Harness } from '../../engine/src/harness.ts';
import { apply, legalActions } from '../../engine/src/apply.ts';
import type { Action, EntityId, Seat } from '../../engine/src/types.ts';
import { pass, pick, spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import { shouldAskCounter } from '../battle.ts';
import { client } from './ui-driver.ts';

const ui = await client();
const MAIN = readFileSync(fileURLToPath(new URL('../main.ts', import.meta.url)), 'utf8');

type Blocks = Extract<Action, { type: 'declareBlocks' }>;

/** round 1's block step: A attacks with two columns, D has `k` units */
function blockStep(seed: number, k: number): { h: Harness; A: Seat; D: Seat; mine: EntityId[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = [spawn(h, A, 'The Foretold'), spawn(h, A, 'The Foretold')];
  const mine = Array.from({ length: k }, () => spawn(h, D, 'The Foretold'));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: atk.map(id => [id]) });
  for (let g = 0; g < 40 && h.state.battle!.step !== 'blocks'; g++) {
    const dec = h.state.decision;
    if (dec?.kind === 'orderTriggers') h.do({ type: 'decide', seat: dec.seat, choice: dec.options.map((_, i) => i) });
    else if (dec) pick(h, { unit: mine[0]! });
    else pass(h);
  }
  assert.equal(h.state.battle!.step, 'blocks', 'the premise: the block step');
  assert.equal(h.state.battle!.round, 1, 'the premise: round 1');
  return { h, A, D, mine };
}

/** put `id` in front of attacking column `ci` */
function block(id: EntityId, ci: number): void {
  ui.click({ act: 'unit', id: String(id) });
  ui.click({ act: 'slot', ci: String(ci), row: '0' });
}

/** the declarations sent since the last call */
function sent(): Blocks[] {
  return ui.actions().filter((a): a is Blocks => a.type === 'declareBlocks');
}

const sorted = (ids: readonly EntityId[]): EntityId[] => [...ids].sort((x, y) => x - y);

test('§1 Confirm with units left over and none sent asks, and sends nothing yet', () => {
  const { h, D, mine } = blockStep(70201, 4);
  ui.join(h.state, D, legalActions(h.state, D));
  block(mine[0]!, 0);
  ui.actions();
  const html = ui.click({ btn: 'confirmblocks' });
  assert.equal(sent().length, 0, 'the declaration is held');
  assert.match(html, /Send counterattackers\? 3 units aren’t blocking/);
  for (const id of mine.slice(1)) assert.ok(ui.has({ btn: 'countertoggle', id: String(id) }), `a chip for unit ${id}`);
  assert.ok(!ui.has({ btn: 'countertoggle', id: String(mine[0]) }), 'no chip for the blocker');
  assert.ok(ui.has({ btn: 'counternone' }) && ui.has({ btn: 'counterall' }) && ui.has({ btn: 'countercancel' }));
  assert.ok(!ui.has({ btn: 'counterconfirm' }), 'nothing picked: no Counterattack button');
  assert.ok(!ui.has({ btn: 'confirmblocks' }), 'the block bar is replaced while it asks');
});

test('§2 "No counterattack" declares exactly the blocks that were built', () => {
  const { h, D, mine } = blockStep(70202, 3);
  ui.join(h.state, D, legalActions(h.state, D));
  block(mine[0]!, 1);
  ui.click({ btn: 'confirmblocks' });
  ui.actions();
  ui.click({ btn: 'counternone' });
  const a = sent();
  assert.equal(a.length, 1, 'one declaration');
  assert.deepEqual(a[0]!.blocks, { 1: [mine[0]] });
  assert.deepEqual(a[0]!.send ?? [], [], 'nobody sent');
  assert.doesNotThrow(() => apply(h.state, a[0]!), 'the engine takes it');
});

test('§3 a chip sends that unit, and "All" sends every leftover — both declarations the engine takes', () => {
  {
    const { h, D, mine } = blockStep(70203, 4);
    ui.join(h.state, D, legalActions(h.state, D));
    block(mine[0]!, 0);
    ui.click({ btn: 'confirmblocks' });
    let html = ui.click({ btn: 'countertoggle', id: String(mine[2]) });
    assert.match(html, /Counterattack — 1 unit/);
    html = ui.click({ btn: 'countertoggle', id: String(mine[3]) });
    html = ui.click({ btn: 'countertoggle', id: String(mine[3]) });
    assert.match(html, /Counterattack — 1 unit/, 'a second click takes the unit back out');
    ui.actions();
    ui.click({ btn: 'counterconfirm' });
    const a = sent();
    assert.equal(a.length, 1);
    assert.deepEqual(a[0]!.blocks, { 0: [mine[0]] });
    assert.deepEqual(a[0]!.send, [mine[2]]);
    assert.doesNotThrow(() => apply(h.state, a[0]!));
  }
  {
    const { h, D, mine } = blockStep(70204, 5);
    ui.join(h.state, D, legalActions(h.state, D));
    block(mine[0]!, 0);
    ui.click({ btn: 'confirmblocks' });
    const html = ui.click({ btn: 'counterall' });
    assert.match(html, /Counterattack — 4 units/);
    assert.doesNotMatch(html, /data-btn="counterall"/, 'every one picked: All goes');
    ui.actions();
    ui.click({ btn: 'counterconfirm' });
    const a = sent();
    assert.equal(a.length, 1);
    assert.deepEqual(sorted(a[0]!.send ?? []), sorted(mine.slice(1)));
    assert.doesNotThrow(() => apply(h.state, a[0]!));
  }
});

test('§4 whoever already sent a unit is never asked — and Enter never declines', () => {
  const { h, D, mine } = blockStep(70205, 4);
  ui.join(h.state, D, legalActions(h.state, D));
  block(mine[0]!, 0);
  ui.click({ act: 'unit', id: String(mine[1]) });
  ui.click({ act: 'sendslot' });
  ui.actions();
  ui.click({ btn: 'confirmblocks' });
  const a = sent();
  assert.equal(a.length, 1, 'Confirm declares straight away, as it always did');
  assert.deepEqual(a[0]!.send, [mine[1]], 'two units left behind, and that is the player’s choice');
  // the Enter list: the Counterattack button is on it, No counterattack is not
  const at = MAIN.indexOf('const ENTER_BTNS');
  assert.ok(at >= 0, 'the Enter list is where it was');
  const list = MAIN.slice(at, MAIN.indexOf('];', at)).replace(/\/\/.*$/gm, '');
  assert.match(list, /"counterconfirm"/);
  assert.doesNotMatch(list, /"counternone"/);
});

test('§5 no leftover unit, no question; "Go back" keeps the plan and Confirm asks again', () => {
  {
    const { h, D, mine } = blockStep(70206, 2);
    ui.join(h.state, D, legalActions(h.state, D));
    block(mine[0]!, 0);
    block(mine[1]!, 1);
    ui.actions();
    ui.click({ btn: 'confirmblocks' });
    assert.equal(sent().length, 1, 'every unit is blocking: Confirm declares');
  }
  {
    const { h, D, mine } = blockStep(70207, 3);
    ui.join(h.state, D, legalActions(h.state, D));
    block(mine[0]!, 0);
    ui.click({ btn: 'confirmblocks' });
    const html = ui.click({ btn: 'countercancel' });
    assert.match(html, /data-btn="confirmblocks"/, 'back on the block bar');
    ui.click({ btn: 'confirmblocks' });
    assert.ok(ui.has({ btn: 'counternone' }), 'asked again');
    ui.key('Escape');
    assert.ok(ui.has({ btn: 'confirmblocks' }) && !ui.has({ btn: 'counternone' }), 'Escape is Go back');
    ui.actions();
    ui.click({ btn: 'confirmblocks' });
    assert.equal(sent().length, 0, 'unanswered, so it asks again');
    assert.ok(ui.has({ btn: 'counternone' }));
    ui.click({ btn: 'counternone' });
    const a = sent();
    assert.equal(a.length, 1);
    assert.deepEqual(a[0]!.blocks, { 0: [mine[0]] }, 'the block survived Go back');
  }
});

test('§6 shouldAskCounter: only the blocker, only in round 1, only until answered', () => {
  const { h, A, D, mine } = blockStep(70208, 3);
  assert.equal(shouldAskCounter(h.state, D, [mine[0]!], [], false), true);
  assert.equal(shouldAskCounter(h.state, D, [mine[0]!], [], true), false, 'answered');
  assert.equal(shouldAskCounter(h.state, D, [mine[0]!], [mine[1]!], false), false, 'a unit already sent');
  assert.equal(shouldAskCounter(h.state, D, mine, [], false), false, 'nothing left over');
  assert.equal(shouldAskCounter(h.state, A, [], [], false), false, 'the attacker is never asked');
  // round 2's block step: the counter-counterattack the rules do not have
  h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: mine });
  for (let g = 0; g < 80 && !(h.state.battle?.round === 2 && h.state.battle.step === 'blocks'); g++) {
    const b = h.state.battle;
    if (!b) break;
    if (b.round === 2 && b.step === 'declare') { h.do({ type: 'declareAttack', seat: b.attacker, columns: mine.map(id => [id]) }); continue; }
    const dec = h.state.decision;
    if (dec) { h.do({ type: 'decide', seat: dec.seat, choice: 0 }); continue; }
    pass(h);
  }
  const b = h.state.battle;
  assert.ok(b && b.round === 2 && b.step === 'blocks', 'the premise: round 2 blocks');
  assert.equal(shouldAskCounter(h.state, b.defender, [], [], false), false, 'round 2: never');
});
