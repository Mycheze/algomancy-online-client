/* The pick-set dialog — Wake the Dead and Tides of the Cosmos (ui/pickset.ts).
 *
 * The owner, 2026-09-28: *"UI for Wake the Dead kinda sucks. We should not be
 * using a 'search' for that. It should show a modal, with oppo's binned units
 * on one side, yours on the other side. Selecting units highlights them and
 * shows them as selected and there's a count of the remaining mana above."*
 *
 * UI-ONLY by the owner's choice: the engine still asks one question per pick
 * and each answer is an option INDEX, so the log does not change. The dialog
 * collects the set and answers the questions in a row, and the second answer
 * is found in the second question BY VALUE — its options are rebuilt, so the
 * first question's index for a card is not its index on the second. §4 builds
 * the case where the two differ, so a client sending the stale index fails.
 *
 * Everything here drives the real client (ui/test/ui-driver.ts) against real
 * engine positions, and feeds each answer it puts on the wire back into the
 * engine — the sequence is checked by the engine accepting it.
 *
 * Seeds 34100-34199.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { viewFor } from '../../server/view.ts';
import { client } from './ui-driver.ts';
import { optionPingId } from '../inspect.ts';
import type { Action, Decision, GameState, Seat } from '../../engine/src/types.ts';
import {
  give, giveResources, pass, spawn, toDeployment, toNextBattle, unitsOf,
} from '../../engine/test/util.ts';

const ui = await client();

/** a Wake the Dead resolving, its first question open. The chooser's bin
 * holds Good Whale [6] and Oorblak [4]; the other bin Curio Drifter [1] and
 * Bumblecrab [1], plus `extra` (which makes each fixture a distinct question,
 * so the dialog's per-question selection starts empty). */
function wake(seed: number, extra: string[] = []): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.deployPlayer!, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  h.state.players[A]!.bin.push('Good Whale', 'Oorblak');
  h.state.players[D]!.bin.push('Curio Drifter', 'Bumblecrab', ...extra);
  giveResources(h, A, 'dark', 8);
  toNextBattle(h, A);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Wake the Dead') });
  pass(h); pass(h);
  assert.ok(h.state.decision?.pickSet, 'fixture: Wake the Dead is asking its first question');
  assert.equal(h.state.decision!.seat, A);
  return { h, A, D };
}

const show = (h: Harness, seat: Seat): string => ui.join(viewFor(h.state, seat), seat, legalActions(h.state, seat));
const push = (h: Harness, seat: Seat): string => ui.update(viewFor(h.state, seat), legalActions(h.state, seat));
const idx = (dec: Decision, value: unknown): number => dec.options.findIndex(o => o.value === value);

interface Shown { name: string; i: number | null; on: boolean; off: boolean }
/** every card in the dialog, as drawn */
function cardsIn(html: string): Shown[] {
  return [...html.matchAll(/<div class="pscard( on| off)?">\s*<div class="[^"]*"(?: data-btn="pspick" data-i="(\d+)")? data-prev="([^"]*)"/g)]
    .map(m => ({ name: m[3]!, i: m[2] === undefined ? null : Number(m[2]), on: m[1] === ' on', off: m[1] === ' off' }));
}
/** the panes, by their label */
function panes(html: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const chunk of html.split('<div class="pspane">').slice(1)) {
    const label = /<div class="zonelabel">([^<]*)<\/div>/.exec(chunk)![1]!;
    out[label] = cardsIn(`<div class="pspane">${chunk}`.split('<div class="psfoot">')[0]!).map(c => c.name);
  }
  return out;
}
const card = (html: string, name: string): Shown => {
  const c = cardsIn(html).find(x => x.name === name);
  assert.ok(c, `${name} is not in the dialog`);
  return c!;
};
const counter = (html: string): string => /<span class="pscount">([^<]*)<\/span>/.exec(html)?.[1] ?? '';
const decides = (): Action[] => ui.actions().filter(a => a.type === 'decide');

/* ── §1 the dialog replaces the menu, and splits the bins by owner ────────── */

test('Wake the Dead opens the dialog with their bin and your bin apart', () => {
  const { h, A } = wake(34101);
  const html = show(h, A);
  assert.match(html, /class="overlay psover"/, 'the dialog is up');
  assert.deepEqual(panes(html), {
    'Their bin': ['Curio Drifter', 'Bumblecrab'],
    'Your bin': ['Good Whale', 'Oorblak'],
  });
  assert.equal(counter(html), '8 mana left · 0 of 2 chosen');
  assert.doesNotMatch(html, /data-btn="pspick"[^>]*data-ping=/, 'a bin card names no unit on the board');
  // every card starts clickable, and each is its own option's index
  const dec = h.state.decision!;
  for (const c of cardsIn(html)) {
    assert.equal(c.off, false, `${c.name} starts clickable`);
    assert.equal(dec.options[c.i!]!.card, c.name);
  }
});

/* ── §2 the budget and the max grey what can no longer be chosen ─────────── */

test('the budget greys a card that no longer fits once one is chosen', () => {
  const { h, A } = wake(34102, ['Bumblecrab']);
  let html = show(h, A);
  html = ui.click({ btn: 'pspick', i: card(html, 'Good Whale').i! });
  assert.equal(card(html, 'Good Whale').on, true, 'the whale is selected');
  assert.equal(counter(html), '2 mana left · 1 of 2 chosen');
  const oor = card(html, 'Oorblak');
  assert.equal(oor.off, true, 'Oorblak [4] is over the 2 left, so it is greyed');
  assert.equal(oor.i, null, 'and it cannot be clicked');
  assert.equal(card(html, 'Curio Drifter').off, false, 'a [1] still fits');
  // unticking gives the budget back
  html = ui.click({ btn: 'pspick', i: card(html, 'Good Whale').i! });
  assert.equal(card(html, 'Oorblak').off, false, 'with the whale unticked Oorblak fits again');
  assert.equal(counter(html), '8 mana left · 0 of 2 chosen');
  assert.deepEqual(decides(), [], 'ticking sends nothing');
});

test('the max of two greys every other card', () => {
  const { h, A } = wake(34103, ['Curio Drifter']);
  let html = show(h, A);
  html = ui.click({ btn: 'pspick', i: card(html, 'Curio Drifter').i! });
  html = ui.click({ btn: 'pspick', i: card(html, 'Bumblecrab').i! });
  assert.equal(counter(html), '6 mana left · 2 of 2 chosen');
  assert.equal(card(html, 'Oorblak').off, true, 'two are chosen: [4] fits the budget and is still greyed');
  assert.equal(card(html, 'Good Whale').off, true);
  assert.equal(card(html, 'Bumblecrab').off, false, 'a chosen card stays clickable, to untick');
});

/* ── §3 Confirm answers both questions, the second by value ──────────────── */

test('Confirm sends the first pick then finds the second in the rebuilt question by value', () => {
  const { h, A, D } = wake(34104, ['Oorblak']);
  const first = h.state.decision!;
  let html = show(h, A);
  // your bin first in the engine's list or theirs: pick one from each
  html = ui.click({ btn: 'pspick', i: card(html, 'Good Whale').i! });
  html = ui.click({ btn: 'pspick', i: card(html, 'Bumblecrab').i! });
  html = ui.click({ btn: 'psconfirm' });
  const one = decides();
  assert.deepEqual(one, [{ type: 'decide', seat: A, choice: idx(first, `${A}:0`) }], 'the whale goes first');
  h.do(one[0]!);
  const second = h.state.decision!;
  assert.equal(second.pickSet?.picked, 1, 'the engine asks its follow-up');
  const want = idx(second, `${D}:1`);
  assert.ok(want >= 0, 'Bumblecrab is still offered');
  assert.notEqual(want, idx(first, `${D}:1`),
    'fixture: the rebuilt question moved Bumblecrab, so a stale index would pick something else');
  html = push(h, A);
  assert.doesNotMatch(html, /class="overlay psover"/, 'the dialog stays down while the chain answers');
  const two = decides();
  assert.deepEqual(two, [{ type: 'decide', seat: A, choice: want }], 'the second answer is found by value');
  h.do(two[0]!);
  assert.equal(h.state.decision, null, 'both questions answered');
  const mine = unitsOf(h, A).map(u => u.card);
  assert.ok(mine.includes('Good Whale') && mine.includes('Bumblecrab'), `both are in play (${mine.join(', ')})`);
  push(h, A);
  assert.deepEqual(decides(), [], 'and nothing more is sent');
});

test('one pick sends it and then Done on the follow-up', () => {
  const { h, A } = wake(34105, ['Jelly']);
  let html = show(h, A);
  html = ui.click({ btn: 'pspick', i: card(html, 'Oorblak').i! });
  ui.click({ btn: 'psconfirm' });
  const one = decides();
  assert.equal(one.length, 1);
  h.do(one[0]!);
  const second = h.state.decision!;
  push(h, A);
  const two = decides();
  assert.deepEqual(two, [{ type: 'decide', seat: A, choice: idx(second, 'done') }], 'Done');
  h.do(two[0]!);
  assert.equal(h.state.decision, null);
});

test('zero picks sends Done at once', () => {
  const { h, A } = wake(34106, ['Bumblecrab', 'Bumblecrab']);
  const html = show(h, A);
  assert.match(html, /data-btn="psconfirm">Play none</);
  ui.click({ btn: 'psconfirm' });
  assert.deepEqual(decides(), [{ type: 'decide', seat: A, choice: idx(h.state.decision!, 'done') }]);
});

test('a follow-up that no longer offers the second card sends nothing and reopens the dialog', () => {
  const { h, A, D } = wake(34107, ['Curio Drifter', 'Jelly']);
  let html = show(h, A);
  html = ui.click({ btn: 'pspick', i: card(html, 'Good Whale').i! });
  html = ui.click({ btn: 'pspick', i: card(html, 'Bumblecrab').i! });
  ui.click({ btn: 'psconfirm' });
  h.do(decides()[0]!);
  // something moved under the pick: the follow-up the client receives has no
  // Bumblecrab in it
  const view: GameState = viewFor(h.state, A);
  view.decision!.options = view.decision!.options.filter(o => o.value !== `${D}:1`);
  ui.update(view, legalActions(h.state, A));
  assert.deepEqual(decides(), [], 'no wrong pick is sent');
  ui.tick();
  html = ui.html();
  assert.match(html, /class="overlay psover"/, 'the dialog is back over the real question');
  assert.match(html, /Bumblecrab can&#39;t be chosen now|Bumblecrab can't be chosen now/);
  assert.equal(counter(html), '2 mana left · 1 of 2 chosen', 'the whale is already in');
});

/* ── §4 the way out and back in ──────────────────────────────────────────── */

test('Escape and look at the board hide it, and the bar brings it back', () => {
  const { h, A } = wake(34108, ['Oorblak', 'Oorblak']);
  let html = show(h, A);
  html = ui.click({ btn: 'pspick', i: card(html, 'Oorblak').i! });
  html = ui.key('Escape');
  assert.doesNotMatch(html, /class="overlay psover"/, 'Escape hides it');
  assert.ok(ui.has({ btn: 'psshow' }), 'the decision bar offers it back');
  html = ui.click({ btn: 'psshow' });
  assert.match(html, /class="overlay psover"/);
  assert.equal(card(html, 'Oorblak').on, true, 'the selection was kept');
  html = ui.click({ btn: 'pshide' });
  assert.doesNotMatch(html, /class="overlay psover"/, 'the board button hides it too');
  assert.deepEqual(decides(), [], 'hiding decides nothing');
});

/* ── §5 Tides of the Cosmos ──────────────────────────────────────────────── */

test('Tides of the Cosmos shows the eight revealed cards in one pane and pings nothing', () => {
  const h = new Harness(34110);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Curio Drifter');
  giveResources(h, D, 'water', 11);
  toNextBattle(h, A);
  h.state.sharedDeck = [
    'Tidal Menace', 'Curio Drifter', 'Good Whale', 'Jelly', 'Ignis Sprite',
    'Dune Drifter', 'Whispering Mantid', 'Lonely Forager', 'Rune Channeler',
  ];
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  pass(h);
  h.do({ type: 'playCard', seat: D, handIndex: give(h, D, 'Tides of the Cosmos') });
  pass(h); pass(h);
  const dec = h.state.decision!;
  assert.equal(dec.pickSet?.group, 'reveal');
  // its values are DECK POSITIONS, and the kind is electricPath, whose bare
  // numbers are otherwise entity ids: a pick-set question is never pinged
  assert.equal(dec.kind, 'electricPath');
  assert.equal(optionPingId(3, 'electricPath'), 3, 'control: an electric path number is an entity');
  assert.equal(optionPingId(3, 'electricPath', true), null);
  const html = show(h, D);
  const p = panes(html);
  assert.deepEqual(Object.keys(p), ['Revealed']);
  assert.deepEqual(p['Revealed'], [
    'Tidal Menace', 'Curio Drifter', 'Good Whale', 'Jelly', 'Ignis Sprite',
    'Dune Drifter', 'Whispering Mantid', 'Lonely Forager',
  ]);
  assert.doesNotMatch(html, /data-ping="\d+"/, 'no option pings an entity');
  // and the pair plays through the engine
  let now = ui.click({ btn: 'pspick', i: card(html, 'Tidal Menace').i! });
  now = ui.click({ btn: 'pspick', i: card(now, 'Curio Drifter').i! });
  assert.equal(counter(now), '4 mana left · 2 of 2 chosen');
  ui.click({ btn: 'psconfirm' });
  h.do(decides()[0]!);
  push(h, D);
  const two = decides();
  const second = two[0];
  assert.ok(two.length === 1 && second?.type === 'decide');
  assert.equal(h.state.decision!.options[second.choice as number]!.card, 'Curio Drifter');
  h.do(second);
  assert.deepEqual(h.state.stack.map(i => i.card), ['Tidal Menace', 'Curio Drifter']);
});
