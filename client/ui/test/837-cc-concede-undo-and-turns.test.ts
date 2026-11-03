/* docs/22 §5.5, §8 answer 2, Risk 5 — A COMPETITIVE GAME ON THE BOARD.
 *
 *   §1 "Concede game" in every room (owner: "Concede GAME, not Concede
 *      MATCH"); a Competitive Best of 3 also offers "Concede match", whose
 *      confirmation sends the socket's {t:'concedeMatch'}, never the engine's
 *      concede; a Best of 1 does not offer it
 *   §2 the between screen's Concede match asks once, then sends it
 *   §3 UNDO UNTIL DONE: the ↶ button follows the push's `ccUndo` in a
 *      Competitive game, and sends the ordinary undo
 *   §4 the steps are taken in turn, and the waiting seat is told whose step
 *      it is; the non-initiative player's haste bar does not say "…" about an
 *      initiative player who is done (CT-510: the server hides that flag)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { ccGame, ccToDeploy, ccToHaste, ccBottomed } from '../../engine/test/cc-walk.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { client } from './ui-driver.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';

const ui = await client();

/** the seat's own view, as the server serves it */
const view = (s: GameState, seat: Seat): GameState => viewFor(s, seat) as unknown as GameState;
const MATCH = (bestOf: 1 | 3) => ({ id: 'M837', bestOf, score: [0, 0], game: 1, phase: 'game', room: 'UIDRIVER' });
const menuLabels = (html: string): { i: string; label: string }[] =>
  [...html.matchAll(/data-btn="menuitem" data-i="(\d+)">([\s\S]*?)<\/button>/g)]
    .map(m => ({ i: m[1]!, label: m[2]!.replace(/<[^>]*>/g, '').trim() }));
const openMenu = (): { i: string; label: string }[] => menuLabels(ui.rightClick({ act: 'player', p: 0 }));

test('§1 Concede game everywhere; Concede match only in a Best of 3', () => {
  const h = ccBottomed(ccGame(0));
  ui.push({ t: 'joined', seat: 0, view: view(h.state, 0), log: [], legal: legalActions(h.state, 0), peers: [true, true], names: ['Ann', 'Bob'], match: MATCH(1) });
  let items = openMenu();
  assert.ok(items.some(x => x.label === '🏳 Concede game'), items.map(x => x.label).join(' | '));
  assert.ok(!items.some(x => /Concede match/.test(x.label)), 'a Best of 1 is one game: no match entry');
  assert.ok(!items.some(x => /Concede the match/.test(x.label)));
  ui.click({ btn: 'menuitem', i: items.find(x => x.label === '🏳 Concede game')!.i });
  assert.match(ui.html(), /<h3>Concede the game\?<\/h3>/);
  ui.click({ btn: 'concedeno' });

  ui.push({ t: 'update', view: view(h.state, 0), legal: legalActions(h.state, 0), events: [], match: MATCH(3) });
  items = openMenu();
  const m = items.find(x => x.label === '🏳 Concede match');
  assert.ok(m, items.map(x => x.label).join(' | '));
  assert.ok(items.some(x => x.label === '🏳 Concede game'), 'both, in a Best of 3');
  const html = ui.click({ btn: 'menuitem', i: m.i });
  assert.match(html, /<h3>Concede the match\?<\/h3>/);
  assert.match(html, /Ann loses the match\./);
  ui.sent();
  ui.click({ btn: 'concedematchyes' });
  const sent = ui.sent();
  assert.deepEqual(sent, [{ t: 'concedeMatch' }], 'the socket message, not an engine action');
  assert.doesNotMatch(ui.html(), /Concede the match\?/, 'the question closes');
});

test('§2 the between screen: Concede match asks, then sends', () => {
  const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 22);
  const MAIN = N.slice(0, 15).flatMap(n => [n, n]), SIDE = N.slice(15, 22);
  ui.push({
    t: 'joined', room: 'UIDRIVER', seat: 0, peers: [true, true], names: ['Ann', 'Bob'], waiting: { have: [true, true], match: {
      id: 'M837', bestOf: 3, game: 2, score: [0, 1], names: ['Ann', 'Bob'], banks: [1, 1], clockStart: 2700_000,
      phase: 'between', chooser: 0, initiative: null, until: Date.now() + 60_000, locked: false, ready: [false, false],
      mine: { registered: { main: MAIN, side: SIDE }, current: { main: MAIN, side: SIDE } },
    } },
  });
  ui.sent();
  let html = ui.click({ btn: 'cc-concede' });
  assert.match(html, /Concede the match\? You lose it\./);
  assert.deepEqual(ui.sent(), [], 'asking sends nothing');
  html = ui.click({ btn: 'cc-concede-no' });
  assert.match(html, /data-btn="cc-concede">🏳 Concede match/);
  ui.click({ btn: 'cc-concede' });
  ui.click({ btn: 'cc-concede-yes' });
  assert.deepEqual(ui.sent(), [{ t: 'concedeMatch' }]);
});

test('§3 undo until Done: the button follows ccUndo, and sends the ordinary undo', () => {
  const h = ccToDeploy(ccGame(0));
  const s = view(h.state, 0);
  ui.push({ t: 'joined', seat: 0, view: s, log: [], legal: legalActions(h.state, 0), peers: [true, true], names: ['Ann', 'Bob'], match: MATCH(3), ccUndo: false });
  assert.equal(ui.has({ btn: 'undo' }), false, 'nothing to take back yet');
  ui.push({ t: 'update', view: s, legal: legalActions(h.state, 0), events: [], ccUndo: true });
  assert.equal(ui.has({ btn: 'undo' }), true, 'the server says this seat can undo');
  ui.sent();
  ui.click({ btn: 'undo' });
  assert.deepEqual(ui.sent().filter(m => m['t'] === 'undo'), [{ t: 'undo' }]);
  ui.push({ t: 'update', view: s, legal: legalActions(h.state, 0), events: [], ccUndo: false });
  assert.equal(ui.has({ btn: 'undo' }), false, 'after Done (or past a reveal) it goes');
});

test('§4 whose step it is, said to the seat that waits', () => {
  const who = (html: string): string => /<span class="who">(?:<span class="livedot">●<\/span> )?([^<]*)/.exec(html)?.[1] ?? '';
  // the resource step: Ann (initiative) first
  let h = ccBottomed(ccGame(0));
  ui.push({ t: 'joined', seat: 1, view: view(h.state, 1), log: [], legal: legalActions(h.state, 1), peers: [true, true], names: ['Ann', 'Bob'] });
  assert.equal(who(ui.html()), 'Waiting for Ann to finish planning');
  // the haste step
  h = ccToHaste(ccGame(0));
  ui.push({ t: 'joined', seat: 1, view: view(h.state, 1), log: [], legal: legalActions(h.state, 1), peers: [true, true], names: ['Ann', 'Bob'] });
  assert.equal(who(ui.html()), 'Waiting for Ann to finish the haste step');
  // Ann is done: Bob's own bar — and Ann's flag reaches him as false (CR D2.5d).
  // Bluff haste keeps Bob in the step although he holds nothing for it (CR D2.5b)
  localStorage.setItem('algoBluffHaste', '1');
  h.do({ type: 'doneHaste', seat: 0 });
  const bobView = view(h.state, 1);
  assert.equal(bobView.hasteDone![0], false, 'premise: the server does not say Ann is done');
  const bar = ui.push({ t: 'joined', seat: 1, view: bobView, log: [], legal: legalActions(h.state, 1), peers: [true, true], names: ['Ann', 'Bob'] });
  assert.match(bar, /Haste step/);
  assert.match(bar, /Ann ready ✓/, 'she is done: the bar must not say "…"');
  localStorage.removeItem('algoBluffHaste');
  // deployment
  h = ccToDeploy(ccGame(0));
  ui.push({ t: 'joined', seat: 1, view: view(h.state, 1), log: [], legal: legalActions(h.state, 1), peers: [true, true], names: ['Ann', 'Bob'] });
  assert.equal(who(ui.html()), 'Waiting for Ann to deploy');
});
