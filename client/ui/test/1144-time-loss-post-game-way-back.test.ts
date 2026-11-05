/* Report #324 / CT-524 — A GAME LOST ON TIME KEEPS ITS WAY BACK TO THE SUMMARY.
 *
 * mycheze (SHXD, 2026-11-03): "there's no way to get back to the Game Over
 * summary after you View Board." That game was lost on time. A time loss is
 * stamped on the room, never on the state (server rooms.ts expireOnTime: the
 * clock is wall time and must not enter a replayable state), so the board the
 * client holds stays at turn 4's planning step for ever. The prompt bar's
 * game-over branch — the one with "Post-game summary" — was keyed on
 * `state.phase === 'gameover'`, so after "view the final board" the bar fell
 * through to an ordinary waiting bar and the summary was gone until a reload.
 * The table's menu had the same blind spot: it still offered Concede (which
 * the server refuses: "this game is already over") and no Home.
 *
 * The client's own "is this game over" is the state's phase OR the server's
 * post-game payload having arrived. Driven through the real client.
 *
 *   §1 lost on time, board viewed: the bar says who won and offers the way back
 *   §2 …and the way back works
 *   §3 the table's menu: Home, no Concede
 *   §4 the control: a live game with no payload is untouched
 *
 * Seeds 1144xx.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';

const ui = await client();
const SEAT: Seat = 0;

const seatStats = (name: string): Record<string, unknown> => ({
  name, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0, modsApplied: 0,
  cardElements: {}, recycled: {}, resourcesActivated: 0, abilitiesActivated: 0,
  attacksDeclared: 0, unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0,
  unitsLost: 0, unitsKilled: 0, cardsDrafted: 0, lifeLeft: 30,
});

/** a live board — then the seat runs out of time: the server stops offering
 * anything (legal []) and sends the post-game payload naming the other seat */
function lostOnTime(seed: number): { s: GameState; html: string } {
  const s = new Harness(seed).state;
  assert.notEqual(s.phase, 'gameover', 'the fixture: the state does not know the game is over');
  ui.join(viewFor(s, SEAT), SEAT, legalActions(s, SEAT));
  if (ui.has({ report: 'close' })) ui.click({ report: 'close' });
  ui.update(viewFor(s, SEAT), []);
  ui.sent();
  const html = ui.push({
    t: 'gameover', seat: SEAT, winner: 1, names: [s.players[0]!.name, s.players[1]!.name],
    mode: 'draft', els: ['fire', 'water', 'earth'], turns: s.turn,
    seats: [seatStats(s.players[0]!.name), seatStats(s.players[1]!.name)],
    rematch: [false, false], rematchRoom: null, recorded: true,
  });
  return { s, html };
}

/** the prompt bar's markup */
const bar = (html: string): string => {
  const m = /<div class="promptbar[^"]*">[\s\S]*?<\/div>/.exec(html);
  assert.ok(m, 'there is a prompt bar');
  return m[0];
};

/** the bare table's menu, as its entries' labels */
function tableMenu(): string[] {
  const menu = ui.rightClick({ act: 'player', p: 0 });
  assert.ok(menu.includes('class="menu"'), 'right-clicking bare table opened no menu');
  const labels = [...menu.matchAll(/data-btn="menuitem" data-i="(\d+)">([\s\S]*?)<\/button>/g)]
    .map(m => m[2]!.replace(/<[^>]*>/g, '').trim());
  ui.key('Escape');
  return labels;
}

test('§1 lost on time, board viewed: the bar says who won and offers the way back to the summary', () => {
  const { s, html } = lostOnTime(114401);
  assert.ok(ui.has({ btn: 'pg-close' }), 'the post-game screen is up');
  assert.ok(html.includes('class="pg'), 'the post-game screen is drawn');
  const board = ui.click({ btn: 'pg-close' });
  assert.ok(!ui.has({ btn: 'pg-close' }), 'view the final board hid the screen');
  const b = bar(board);
  assert.ok(ui.has({ btn: 'pg-reopen' }), `no way back to the summary; the bar is: ${b}`);
  assert.match(b, new RegExp(`${s.players[1]!.name} wins`), 'the bar says who won');
  assert.ok(ui.has({ btn: 'gohome' }), 'and the way home');
  assert.doesNotMatch(b, /Waiting|Pass/i, 'not a bar for a game still going');
});

test('§2 …and the way back works', () => {
  lostOnTime(114402);
  ui.click({ btn: 'pg-close' });
  ui.click({ btn: 'pg-reopen' });
  assert.ok(ui.has({ btn: 'pg-close' }), 'Post-game summary brought the screen back');
});

test('§3 the table menu of a game lost on time goes home and does not offer a concede', () => {
  lostOnTime(114403);
  ui.click({ btn: 'pg-close' });
  const labels = tableMenu();
  assert.ok(labels.some(l => /Home/.test(l)), `no Home in the menu: ${labels.join(' | ')}`);
  assert.ok(!labels.some(l => /Concede|propose a fix/i.test(l)),
    `a decided game still offers: ${labels.join(' | ')}`);
});

test('§4 the control: a live game with no post-game payload keeps its ordinary bar and menu', () => {
  const s = new Harness(114404).state;
  ui.join(viewFor(s, SEAT), SEAT, legalActions(s, SEAT));
  if (ui.has({ report: 'close' })) ui.click({ report: 'close' });
  assert.ok(!ui.has({ btn: 'pg-reopen' }), 'no summary to go back to');
  const labels = tableMenu();
  assert.ok(labels.some(l => /Concede/.test(l)), `a live game can be conceded: ${labels.join(' | ')}`);
  assert.ok(!labels.some(l => /Home/.test(l)), 'mid-game, leaving is a concede');
});
