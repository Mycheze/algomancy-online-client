/* 1129 — SIDEBOARDING BETWEEN COMPETITIVE GAMES IS THE BUILDER'S TABLE (BL-65, 2026-11-04).
 *
 * The design pass (owner: "Oh helll yeah … You can start building now", Q3): the
 * sideboarding window moves onto the same table as the deck builder, so it is
 * one thing to learn. pages/match.ts draws pages/table.ts tableHtml inside the
 * app frame: the deck as piles by cost on the left, the Sideboard n/7 in the
 * rail on the right, and in the strip at the table's foot Main n · Side n/7 and
 * the verdict. There is NO pool — only the registered cards — and no card
 * menu: one tap moves a copy across (the window is 120 s).
 *
 *   §1 the page: the frame (edge to edge), the match in its toolbar (the room,
 *      the score, the countdown, both clocks, the opponent, the tools), the
 *      table's two zones, the foot strip; no pool, no menu, no builder taps
 *   §2 Undo takes the last move back THROUGH moveCopy: off with nothing to
 *      take back; a move turns it on; Undo puts that copy home, sends exactly
 *      what a tap would (nothing while the deck is illegal, the config once it
 *      is legal again); Back to the registered deck is a fresh start; locked,
 *      there is no Undo
 *   §3 a question waiting on you (Concede match? a pause offer) is the row
 *      under the toolbar, and its tool leaves the toolbar meanwhile
 *   §4 an empty sideboard keeps a card's room to drop on
 *
 * Driven through the real client (ui-driver.ts) with the server's payload shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { client } from './ui-driver.ts';

const ui = await client();

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 24);
const MAIN = N.slice(0, 15).flatMap(n => [n, n]);   // 30
const SIDE = N.slice(15, 20);                        // 5 singles
const REG = { main: MAIN, side: SIDE };
const info = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'M1129', bestOf: 3, game: 2, score: [1, 0], names: ['Ann', 'Bo'],
  banks: [38 * 60_000, 41 * 60_000], clockStart: 45 * 60_000,
  phase: 'between', chooser: 1, initiative: null, until: Date.now() + 100_000, locked: false, ready: [false, true],
  mine: { registered: REG, current: REG },
  ...over,
});
const lobby = (over: Record<string, unknown> = {}, t = 'update'): string => ui.push({
  t, room: 'UIDRIVER', seat: 0, waiting: { have: [true, true], match: info(over) }, peers: [true, true], names: ['Ann', 'Bo'],
});
const configs = (): Array<{ main: string[]; side: string[] }> =>
  ui.sent().filter(m => m['t'] === 'cc' && m['op'] === 'config') as never;

/** the toolbar, the row under it + the table, the foot strip */
const toolbar = (html: string): string => html.slice(html.indexOf('<header class="ui-app-shell__top">'), html.indexOf('</header>'));
const main = (html: string): string => html.slice(html.indexOf('<main'), html.indexOf('</main>'));
const foot = (html: string): string => html.slice(html.indexOf('<footer class="ccsbbar">'), html.indexOf('</footer>'));
/** the Undo tool's tag, or '' */
const undoTag = (html: string): string => /<button[^>]*data-btn="cc-undo"[^>]*>/.exec(html)?.[0] ?? '';
function zoneCards(html: string, z: 'main' | 'side'): string[] {
  const at = html.indexOf(`data-cc-zone="${z}"`);
  assert.ok(at >= 0, `no ${z} zone on screen`);
  const end = html.indexOf(z === 'main' ? 'data-cc-zone="side"' : '<footer', at);
  return [...html.slice(at, end).matchAll(/data-card="([^"]+)"/g)].map(m => m[1]!);
}
const count = (l: string[], n: string): number => l.filter(x => x === n).length;

lobby({}, 'joined');
ui.sent();

test('§1 the builder\'s table in the frame, the match in its toolbar, no pool', () => {
  const html = ui.html();
  assert.match(html, /<div class="ui-app-shell [^"]*\bapppage framewide framebleed ccsbtable ccpage">/, 'the frame, edge to edge');
  const bar = toolbar(html);
  assert.match(bar, /data-btn="gohome"[^>]*>(?:(?!<\/button>)[\s\S])*>Leave<\/span>/, 'Leave');
  assert.match(bar, /Competitive<span class="ccsbbo"> — Best of 3<\/span><small>room <span class="roomcode">UIDRIVER<\/span>/, 'the room');
  assert.match(bar, /<span class="ccsbclock"><span class="cccount" data-cc-until="\d+">1:[34]\d<\/span> to sideboard<\/span>/, 'the countdown');
  assert.match(bar, /Game 2 of 3 — you lead 1–0/, 'the score');
  assert.match(bar, /Your clock <b>38:00<\/b> · Bo <b>41:00<\/b>/, 'both clocks');
  assert.match(bar, /<i class="seatdot ready"><\/i>\s*<span>Bo — ready<\/span>/, 'the opponent\'s ready dot');
  for (const b of ['cc-undo', 'cc-pause', 'cc-concede']) assert.match(bar, new RegExp(`data-btn="${b}"`), `${b} is a toolbar tool`);
  // the table: the deck's region and the rail's sideboard, then the foot strip
  const m = main(html);
  assert.match(m, /<div class="tttablewrap ccsbwrap" style="--cw:\d+px;--ch:\d+px"><div class="ttbody"><div class="tttable" data-scroll="cc-table" data-cc-zone="main">/);
  assert.match(m, /<aside class="ttrail" data-scroll="tt-rail"><div class="ttrailbox ttrailside" data-cc-zone="side">/);
  assert.ok(m.indexOf('data-cc-zone="main"') < m.indexOf('data-cc-zone="side"'), 'deck left, sideboard right');
  assert.ok(m.indexOf('data-cc-zone="side"') < m.indexOf('<footer class="ccsbbar">'), '…the strip at the table\'s foot');
  assert.equal(zoneCards(html, 'main').length, 30);
  assert.equal(zoneCards(html, 'side').length, 5);
  const f = foot(html);
  assert.match(f, /Main <b class="">30<\/b>\s*· Side <b class="">5\/7<\/b><\/span>\s*<span class="ccsbok">✓ Legal<\/span>/, 'the counts and the verdict');
  assert.match(f, /data-btn="cc-reset" disabled>Back to the registered deck/);
  assert.match(f, /data-btn="cc-ready" >Ready</);
  // only the registered cards: no pool, no card menu, none of the builder's own taps
  assert.doesNotMatch(html, /ttpool|data-btn="tt-|data-tt-menu|ttrailmaybe/, 'no pool, no menu, no Maybe, no tt- taps');
  assert.doesNotMatch(html, /ccsbask/, 'nothing asked: no row under the toolbar');
});

test('§2 Undo takes the last move back through moveCopy, sending what a tap would', () => {
  let html = ui.html();
  assert.match(undoTag(html), /disabled/, 'nothing to take back yet');
  html = ui.click({ btn: 'cc-move', from: 'main', card: N[0]! });          // 29 / 6: illegal
  assert.doesNotMatch(undoTag(html), /disabled/, 'a move to take back');
  assert.equal(count(zoneCards(html, 'side'), N[0]!), 1);
  assert.deepEqual(configs(), [], 'illegal: not sent');
  html = ui.click({ btn: 'cc-undo' });
  assert.equal(count(zoneCards(html, 'main'), N[0]!), 2, 'the copy is home');
  assert.equal(count(zoneCards(html, 'side'), N[0]!), 0);
  assert.match(undoTag(html), /disabled/, 'nothing left to take back');
  const back = configs();
  assert.equal(back.length, 1, 'legal again: the config went out, as a tap\'s would');
  assert.deepEqual([...back[0]!.main].sort(), [...MAIN].sort());
  lobby({ mine: { registered: REG, current: { main: back[0]!.main, side: back[0]!.side } } });

  // a two-step swap, undone a step at a time: last move first
  ui.click({ btn: 'cc-move', from: 'main', card: N[1]! });               // 29 / 6
  html = ui.tap({ btn: 'cc-move', from: 'side', card: N[15]! });          // 30 / 5: legal, sent
  assert.equal(configs().length, 1);
  html = ui.click({ btn: 'cc-undo' });                                    // 29 / 6
  assert.equal(count(zoneCards(html, 'side'), N[15]!), 1, 'the last move went back first');
  assert.equal(count(zoneCards(html, 'side'), N[1]!), 1, '…the first is still made');
  assert.deepEqual(configs(), [], 'illegal again: nothing sent');
  html = ui.click({ btn: 'cc-undo' });                                    // 30 / 5
  assert.equal(count(zoneCards(html, 'main'), N[1]!), 2);
  assert.equal(configs().length, 1);

  // Back to the registered deck is a fresh start: nothing before it is taken back
  ui.click({ btn: 'cc-move', from: 'main', card: N[2]! });
  ui.click({ btn: 'cc-reset' });
  configs();
  html = lobby();
  assert.match(undoTag(html), /disabled/, 'after the reset there is nothing to undo');

  // locked: the table is shown, not editable — no Undo at all
  html = lobby({ locked: true, until: null, chooser: 1 });
  assert.equal(undoTag(html), '', 'locked: no Undo');
  assert.doesNotMatch(html, /data-btn="cc-move"/);
  lobby();
});

test('§3 a question waiting on you is the row under the toolbar', () => {
  let html = ui.click({ btn: 'cc-concede' });
  assert.match(main(html), /^<main[^>]*><div class="ccsbask" role="status"><span class="ccconcede">Concede the match\? You lose it\./, 'Concede asked: the row over the table');
  assert.doesNotMatch(toolbar(html), /data-btn="cc-concede"/, '…and the tool waits for the answer');
  html = ui.click({ btn: 'cc-concede-no' });
  assert.doesNotMatch(html, /ccsbask/);
  assert.match(toolbar(html), /data-btn="cc-concede"/);
  html = lobby({ pause: { offeredBy: 1, pausedAt: null, resume: [false, false] } });
  assert.match(main(html), /<div class="ccsbask" role="status"><span class="ccsbaskpause"><span>Bo offers to pause the match\.<\/span>/);
  assert.match(main(html), /data-btn="cc-pause">Accept pause<\/button> <button data-btn="cc-unpause">Decline<\/button>/);
  assert.doesNotMatch(toolbar(html), /data-btn="cc-pause"/, 'no second offer while one is open');
  html = lobby({ pause: { offeredBy: 0, pausedAt: null, resume: [false, false] } });
  assert.match(main(html), /You offered a pause\.<\/span> <button data-btn="cc-unpause">Withdraw<\/button>/);
  lobby();
});

test('§4 an empty sideboard keeps a card\'s room to drop on', () => {
  const html = lobby({ mine: { registered: { main: [...MAIN, ...SIDE], side: [] }, current: { main: [...MAIN, ...SIDE], side: [] } } });
  const at = html.indexOf('data-cc-zone="side"');
  const side = html.slice(at, html.indexOf('<footer', at));
  assert.match(side, /<div class="ttfan ttslot" style="height:\d+px">/, 'the outlined room');
  assert.match(side, /class="ttpilecount">0\/7</);
  assert.match(foot(html), /Main <b class="">35<\/b>\s*· Side <b class="">0\/7<\/b>/);
});
