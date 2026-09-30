/* 351 — THE COUNTERATTACK BUILD HAS ITS OWN LAYOUT (CT-192, report #179).
 *
 * Owner: "Counter attack UI is pretty bad. There should be a special layout
 * for choosing how to build your formation". Owner's choice, 2026-09-30:
 * "Full-size staging row: sent units shown full-size as a 'sent units' tray in
 * the fight block nearest your home, all front/back slots drawn up front, bar
 * says 'Build your counterattack (N sent)', plus one-click shapes (one column
 * / pairs)."
 *
 * XSEN [274]–[279] is the case: three units sent, round 2 opened with
 * attackerPool [70, 87, 74], and on the regions board they stood in the
 * invader strip (.linvside) at 0.6 of a card while the builder drew one
 * column at a time.
 *
 * §1  regions board: the sent units stand in the tray inside the fight (a
 *     .zone of the battle's fit, not the invader strip), every slot of four
 *     columns is drawn, and the bar names the step
 * §2  placing one takes it out of the tray, into the column clicked — no
 *     column slides — and taking it back out returns it
 * §3  "Pairs" builds a formation the engine accepts, sent through Attack!
 * §4  a pool of two offers "One column", also accepted
 * §5  a number key reaches every column drawn, the last one included
 * §6  classic board: no tray (the region panel keeps them), but the slots,
 *     the bar and the shapes
 * §7  the opponent watches: no tray and no shape buttons on their screen
 * §8  an ordinary round-1 attack is untouched: no tray, built-so-far + 1
 * §9  Attack with everything fills the columns left empty, not new ones
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { apply, legalActions } from '../../engine/src/apply.ts';
import { spawn, toDeployment, toNextBattle } from '../../engine/test/util.ts';
import type { Action, EntityId, GameState, Seat } from '../../engine/src/types.ts';
import { counterShapes } from '../battle.ts';
import { client, idsIn } from './ui-driver.ts';

const ui = await client();
const store = (globalThis as { localStorage: Storage }).localStorage;
const { dealScenario } = await import('../../server/scenarios.ts');

/** the `<div …>` element whose opening tag contains `marker`, whole */
function divWith(html: string, marker: string): string {
  const at = html.indexOf(marker);
  assert.ok(at >= 0, `no ${marker} on the board`);
  const start = html.lastIndexOf('<div', at);
  let i = html.indexOf('>', at), depth = 1;
  while (depth > 0) {
    const open = html.indexOf('<div', i), close = html.indexOf('</div>', i);
    assert.ok(close >= 0, `unbalanced markup around ${marker}`);
    if (open >= 0 && open < close) { depth++; i = open + 4; } else { depth--; i = close + 6; }
  }
  return html.slice(start, i);
}
/** the build slots drawn, as "ci:row" */
const slots = (html: string): string[] =>
  [...html.matchAll(/data-act="slot" data-ci="(\d+)" data-row="(\d+)"/g)].map(m => `${m[1]}:${m[2]}`);
/** the units standing in build column `ci` */
function column(html: string, ci: number): number[] {
  const parts = html.split(/<div class="col"><div class="collabel">column /);
  const col = parts.find(p => p.startsWith(`${ci + 1}<`));
  assert.ok(col, `no column ${ci + 1}`);
  // cut where the tray begins: the last column's chunk would run on into it
  const end = col.indexOf('<div class="stagerow"');
  return idsIn(end >= 0 ? col.slice(0, end) : col);
}

/** the owner's review board: four sent, round 2, seat 0 declaring */
function counterBoard(): GameState {
  const s = dealScenario(351351, ['You', 'Tester Bot'], 'shared', undefined as never, undefined, 'counter-build').state;
  const b = s.battle!;
  assert.equal(b.step, 'declare', 'the premise: a declare step');
  assert.equal(b.round, 2, 'the premise: round 2');
  assert.equal(b.attacker, 0, 'the premise: seat 0 is counterattacking');
  assert.equal(b.attackerPool?.length, 4, 'the premise: four were sent');
  return s;
}
/** a harness counterattack of `k` sent units, round 2 open, D declaring */
function sentPool(seed: number, k: number): { s: GameState; D: Seat; sent: EntityId[] } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative as Seat, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'The Foretold');
  const sent = Array.from({ length: k }, () => spawn(h, D, 'The Foretold'));
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  for (let g = 0; g < 60 && !(h.state.battle?.round === 2 && h.state.battle.step === 'declare'); g++) {
    const b = h.state.battle;
    if (b?.step === 'blocks') { h.do({ type: 'declareBlocks', seat: D, blocks: {}, send: sent }); continue; }
    const dec = h.state.decision;
    if (dec) { h.do({ type: 'decide', seat: dec.seat, choice: 0 }); continue; }
    h.do({ type: 'passPriority', seat: h.state.priority! });
  }
  assert.equal(h.state.battle?.round, 2, 'the premise: round 2 is open');
  assert.equal(h.state.battle?.attacker, D);
  return { s: h.state, D, sent };
}
const join = (s: GameState, seat: Seat): string => ui.join(s, seat, legalActions(s, seat));
/** Attack!, and the declaration it sent — which the engine must take */
function confirmAndApply(s: GameState): Action {
  ui.actions();
  ui.click({ btn: 'confirmattack' });
  const sent = ui.actions().filter(a => a.type === 'declareAttack');
  assert.equal(sent.length, 1, 'Attack! sent one declaration');
  assert.doesNotThrow(() => apply(s, sent[0]!), 'the engine accepts the shape');
  return sent[0]!;
}

test('§1 regions board: the sent units wait full-size in the fight, every slot is drawn, the bar names the step', () => {
  store.removeItem('algoLayout');
  const s = counterBoard();
  const pool = s.battle!.attackerPool!;
  const html = join(s, 0);
  const fight = divWith(html, 'class="lfight theirs focus"');
  assert.match(fight, /data-fit="battle"/, 'the fight block is the battle fit zone');
  const tray = divWith(fight, 'class="stagerow"');
  assert.deepEqual(idsIn(tray).sort((a, z) => a - z), [...pool].sort((a, z) => a - z), 'all four stand in the tray');
  assert.match(tray, /class="zone stagezone"/, 'as a zone of the fight, sized with its columns');
  assert.match(tray, /data-pool="4"/);
  assert.doesNotMatch(html, /class="linvside"/, 'and not in the 0.6-size invader strip');
  assert.deepEqual(slots(html), ['0:0', '0:1', '1:0', '1:1', '2:0', '2:1', '3:0', '3:1'],
    'four columns, front and back each, before anything is placed');
  const bar = divWith(html, 'class="promptbar');
  assert.match(bar, /Build your counterattack \(4 sent\)/);
  assert.match(bar, /data-btn="countershape" data-shape="pairs"[^>]*>Pairs</);
  assert.match(bar, /data-btn="attackall"/, 'Attack with everything is still there');
});

test('§2 a placed unit leaves the tray for the column clicked, and comes back', () => {
  const s = counterBoard();
  const [u] = s.battle!.attackerPool!;
  join(s, 0);
  ui.click({ act: 'unit', id: String(u) });
  let html = ui.click({ act: 'slot', ci: '2', row: '1' });
  assert.deepEqual(column(html, 2), [u], 'it stands in column 3 (its back slot, R304) — no column slid left');
  assert.equal(idsIn(divWith(html, 'class="stagerow"')).includes(u!), false, 'the tray gave it up');
  assert.equal(slots(html).length, 7, 'every other slot is still drawn');
  html = ui.click({ act: 'unit', id: String(u) });
  assert.ok(idsIn(divWith(html, 'class="stagerow"')).includes(u!), 'taken back out, it is in the tray again');
  assert.equal(slots(html).length, 8);
});

test('§3 Pairs builds front-and-back pairs the engine accepts', () => {
  const s = counterBoard();
  const pool = s.battle!.attackerPool!;
  join(s, 0);
  const html = ui.click({ btn: 'countershape', shape: 'pairs' });
  assert.deepEqual(column(html, 0), pool.slice(0, 2));
  assert.deepEqual(column(html, 1), pool.slice(2, 4));
  assert.match(divWith(html, 'class="stagerow"'), /all placed/);
  const a = confirmAndApply(s);
  assert.deepEqual((a as { columns: EntityId[][] }).columns, [pool.slice(0, 2), pool.slice(2, 4)]);
});

test('§4 a pool of two offers One column, and the engine takes it', () => {
  const { s, D, sent } = sentPool(35104, 2);
  assert.deepEqual(counterShapes(sent).map(sh => sh.key), ['onecol']);
  const html = join(s, D);
  assert.match(divWith(html, 'class="promptbar'), /Build your counterattack \(2 sent\)[\s\S]*>One column</);
  assert.doesNotMatch(html, /data-shape="pairs"/, 'pairs of two IS one column — not offered twice');
  ui.click({ btn: 'countershape', shape: 'onecol' });
  const a = confirmAndApply(s);
  assert.deepEqual((a as { columns: EntityId[][] }).columns, [sent]);
  // a pool of three: pairs with the odd one alone; of one: no shape (it is prefilled)
  assert.deepEqual(counterShapes([7, 8, 9]).map(sh => sh.columns), [[[7, 8], [9]]]);
  assert.deepEqual(counterShapes([7]), []);
});

test('§5 a number key reaches every column drawn', () => {
  const s = counterBoard();
  const [u] = s.battle!.attackerPool!;
  join(s, 0);
  ui.click({ act: 'unit', id: String(u) });
  const html = ui.key('4');
  assert.deepEqual(column(html, 3), [u], '4 put it in column 4, drawn before anything was built');
  ui.click({ btn: 'clearform' });
});

test('§6 classic board: no tray, but every slot, the bar and the shapes', () => {
  store.setItem('algoLayout', '1');
  try {
    const s = counterBoard();
    const html = join(s, 0);
    assert.doesNotMatch(html, /class="lboard/, 'the premise: classic');
    assert.doesNotMatch(html, /stagerow|stagewrap/, 'the region panel keeps the sent units on this board');
    assert.equal(slots(html).length, 8);
    assert.match(divWith(html, 'class="promptbar'), /Build your counterattack \(4 sent\)[\s\S]*>Pairs</);
  } finally {
    store.removeItem('algoLayout');
  }
});

test('§7 the opponent watching sees no tray and no shape buttons', () => {
  const s = counterBoard();
  const html = join(s, 1);
  assert.doesNotMatch(html, /stagerow|countershape|Build your counterattack/);
  // the sent units are still on their screen, in the fight's invader strip
  const pool = s.battle!.attackerPool!;
  assert.deepEqual(idsIn(divWith(html, 'class="linvside"')).sort((a, z) => a - z), [...pool].sort((a, z) => a - z));
});

test('§8 a round-1 attack is the ordinary builder', () => {
  const h = new Harness(35108);
  toDeployment(h);
  const A = h.state.initiative as Seat;
  spawn(h, A, 'The Foretold'); spawn(h, A, 'The Foretold');
  toNextBattle(h, A);
  const html = join(h.state, A);
  assert.doesNotMatch(html, /stagerow|stagewrap|countershape/);
  assert.deepEqual(slots(html), ['0:0', '0:1'], 'one empty column to start, as before');
  assert.match(divWith(html, 'class="promptbar'), /build your attack/);
});

test('§9 Attack with everything fills the empty columns first', () => {
  const s = counterBoard();
  const pool = s.battle!.attackerPool!;
  join(s, 0);
  ui.click({ act: 'unit', id: String(pool[0]) });
  ui.click({ act: 'slot', ci: '2', row: '0' });
  const html = ui.click({ btn: 'attackall' });
  assert.equal([...html.matchAll(/<div class="col"><div class="collabel">column /g)].length, 4, 'still four columns');
  assert.deepEqual([0, 1, 2, 3].map(ci => column(html, ci)), [[pool[1]], [pool[2]], [pool[0]], [pool[3]]]);
  confirmAndApply(s);
});
