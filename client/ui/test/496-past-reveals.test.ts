/* 496 — THIS GAME'S PAST REVEALS, OFF THE TABLE MENU (report #224, 2026-10-18).
 *
 * The owner: "make it possible to see past revealed zones in the right click
 * menu". A right-click on bare table — or the rail's ☰ table, which is the
 * same menu for a finger (test/273) — offers "Past reveals" once this seat
 * has been shown one, and it opens a dialog (a layer beside #app,
 * ui/reveallog.ts) with every reveal of the game, newest first: who, from
 * what, the cards.
 *
 * ⚠ ONLY WHAT THIS SEAT WAS SHOWN. The reveals are real ones (Oracle of
 * Foretelling, through the engine), put through the server's own redaction
 * for the watching seat; the dialog's cards are checked to be exactly the
 * cards those events carried, and nothing else.
 *
 * Seeds 49601-49699.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './ui-driver.ts';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { toDeployment } from '../../engine/test/util.ts';
import { boardMenuEntries } from '../inspect.ts';
import { redactEvent, viewFor, visibleToSeat } from '../../server/view.ts';
import type { CardName, EngineEvent, GameState, Seat } from '../../engine/src/types.ts';

const ui = await client();
const NAMES: [string, string] = ['Ann', 'Bo'];

function menuLabels(html: string): string[] {
  assert.ok(html.includes('class="menu"'), 'a right-click opened no menu at all');
  return [...html.matchAll(/data-btn="menuitem" data-i="\d+">([\s\S]*?)<\/button>/g)]
    .map(m => m[1]!.replace(/<[^>]*>/g, '').trim());
}
/** the dialog's markup, or null when it is shut */
const dialog = (html: string): string | null => {
  const at = html.indexOf('class="overlaybox revealbox"');
  return at < 0 ? null : html.slice(at);
};
/** the dialog's rows, top to bottom: headline (turn stripped) and card names */
const rows = (d: string): { head: string; cards: string[] }[] =>
  d.split('class="revealrow"').slice(1).map(r => ({
    head: (/<div class="revealhead">([\s\S]*?)<span class="revealturn">/.exec(r)?.[1] ?? '').trim(),
    cards: [...r.matchAll(/data-prev="([^"]*)"/g)].map(m => m[1]!),
  }));

/** `by` plays Oracle of Foretelling (glimpse 5) and keeps the first card; the
 * events as the server would send them to `viewer` */
function glimpse(h: Harness, by: Seat, viewer: Seat): { events: EngineEvent[]; cards: CardName[] } {
  for (let i = 0; i < 4; i++) h.state.players[by]!.resources.push({ kind: 'water', state: 'open' } as never);
  h.state.players[by]!.hand.push('Oracle of Foretelling');
  const evs = h.do({ type: 'playCard', seat: by, handIndex: h.state.players[by]!.hand.length - 1 });
  for (let g = 0; g < 6 && h.state.decision?.seat === by; g++) evs.push(...h.do({ type: 'decide', seat: by, choice: 0 }));
  const g = evs.find(e => e.type === 'glimpsed');
  assert.ok(g && Array.isArray(g.data?.['cards']), 'non-vacuous: the Oracle glimpsed');
  return {
    events: evs.filter(e => visibleToSeat(e, viewer)).map(e => redactEvent(e, viewer, NAMES)),
    cards: g!.data!['cards'] as CardName[],
  };
}

/** D watches A glimpse, then D deploys and glimpses itself */
function twoReveals(seed: number) {
  const h = new Harness(seed, NAMES);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat, D = (A === 0 ? 1 : 0) as Seat;
  const push = (events: EngineEvent[]) => ui.update(viewFor(h.state, D), legalActions(h.state, D), { events });
  ui.join(viewFor(h.state, D), D, legalActions(h.state, D));
  const theirs = glimpse(h, A, D);
  push(theirs.events);
  push(h.do({ type: 'doneDeploying', seat: A }).filter(e => visibleToSeat(e, D)));
  assert.equal(h.state.deployPlayer, D, 'fixture: D deploys next');
  const mine = glimpse(h, D, D);
  push(mine.events);
  return { h, A, D, theirs: theirs.cards, mine: mine.cards };
}

const openIt = (): string => {
  const labels = menuLabels(ui.rightClick({ act: 'player', p: 0 }));
  const i = labels.findIndex(l => /Past reveals/.test(l));
  assert.ok(i >= 0, `the table menu offers Past reveals: ${JSON.stringify(labels)}`);
  return ui.click({ btn: 'menuitem', i });
};

test('with nothing revealed yet, the table menu has no Past reveals entry', () => {
  const h = new Harness(49601, ['Cy', 'Di']);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat;
  ui.join(viewFor(h.state, A), A, legalActions(h.state, A));
  const labels = menuLabels(ui.rightClick({ act: 'player', p: A }));
  assert.ok(!labels.some(l => /reveal/i.test(l)), JSON.stringify(labels));
  assert.deepEqual(labels, boardMenuEntries(h.state as GameState, A).map(e => e.label), 'the menu is the plain table menu');
  ui.click({ btn: 'menuclose' });
});

test('right-click and the ☰ table button both offer it, with the count', () => {
  twoReveals(49602);
  const viaRight = menuLabels(ui.rightClick({ act: 'player', p: 0 }));
  assert.ok(viaRight.includes('👁 Past reveals (2)'), JSON.stringify(viaRight));
  ui.click({ btn: 'menuclose' });
  const viaButton = menuLabels(ui.click({ btn: 'tablemenu' }));
  assert.deepEqual(viaButton, viaRight, 'a finger gets the same entry off the ☰ table button');
  ui.click({ btn: 'menuclose' });
});

test('it opens every reveal, newest first: who, from what, and exactly the cards shown', () => {
  const { A, theirs, mine } = twoReveals(49603);
  const d = dialog(openIt());
  assert.ok(d, 'the dialog is up');
  assert.match(d!, /<h3>Past reveals<\/h3>/);
  const r = rows(d!);
  assert.equal(r.length, 2, 'one row per reveal');
  assert.equal(r[0]!.head, `You glimpsed ${mine.length}`, 'newest first: my own glimpse');
  assert.equal(r[1]!.head, `${NAMES[A]} glimpsed ${theirs.length}`, 'then the opponent\'s, by name');
  assert.deepEqual(r[0]!.cards, mine, 'my glimpse, card for card');
  assert.deepEqual(r[1]!.cards, theirs, 'theirs, card for card');
  assert.match(d!, /<span class="revealturn">turn \d+<\/span>/, 'each row names its turn');
  ui.click({ reveals: 'close' });
  assert.equal(dialog(ui.html()), null, 'the ✕ closes it');
});

test('Escape closes it, and no board hotkey reaches under it', () => {
  twoReveals(49604);
  const undos = (): number => ui.sent().filter(m => m['t'] === 'undo').length;
  openIt();
  ui.sent();
  ui.key('z', { ctrl: true });
  assert.equal(undos(), 0, 'Ctrl+Z sends no game undo from under the dialog');
  ui.key('Escape');
  assert.equal(dialog(ui.html()), null, 'Escape closes it');
  ui.key('z', { ctrl: true });
  assert.equal(undos(), 1, 'the control: with it shut, Ctrl+Z is the game undo again');
});

test('dismissing the notice keeps the reveal; a reconnect keeps the list; another game starts its own', () => {
  const { h, D } = twoReveals(49605);
  if (ui.has({ btn: 'glimpseclose' })) ui.click({ btn: 'glimpseclose' });
  ui.join(viewFor(h.state, D), D, legalActions(h.state, D));
  assert.equal(rows(dialog(openIt())!).length, 2, 'both reveals, after a dismiss and a reconnect');
  ui.click({ reveals: 'close' });
  const other = new Harness(49606, ['Cy', 'Di']);
  toDeployment(other);
  ui.join(viewFor(other.state, 0), 0, legalActions(other.state, 0));
  const labels = menuLabels(ui.rightClick({ act: 'player', p: 0 }));
  assert.ok(!labels.some(l => /reveal/i.test(l)), `a new game has no past reveals: ${JSON.stringify(labels)}`);
  ui.click({ btn: 'menuclose' });
});
