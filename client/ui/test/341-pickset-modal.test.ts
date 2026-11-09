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
 * §6 is Big Glimpse Card's two-pile split (CT-539).
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
  give, giveResources, pass, pick, spawn, toDeployment, toNextBattle,
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
  pass(h);
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
  // CT-245 (CR 701.4): both are PLAYED, so they wait on the stack, not yet in play
  const played = h.state.stack.map(i => i.card);
  assert.ok(played.includes('Good Whale') && played.includes('Bumblecrab'), `both were played (${played.join(', ')})`);
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
  pass(h);
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

/* ── §6 Big Glimpse Card's split: two piles, moved freely (CT-539) ────────── */
/* Report #349, invi: "big glimpse card: make a view where you can reorder the
 * cards between two piles until happy". The engine still asks for pile 1 one
 * card at a time, then "Done splitting"; the dialog answers that run. */

const SEVEN = ['Gublin', 'Shib', 'Chombot', 'Uglk', 'Bloppert', 'Zephyrzoa', 'Mindburn'];

/** a Big Glimpse Card resolving, the opponent's first split question open */
function glimpse(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed);
  toDeployment(h);
  const A = h.state.initiative, D = (1 - A) as Seat;
  const atk = spawn(h, A, 'Unit Token');
  toNextBattle(h, A);
  giveResources(h, A, 'light', 1);
  giveResources(h, A, 'water', 1);
  giveResources(h, A, 'earth', 2);
  h.state.sharedDeck.unshift(...SEVEN);
  // every fixture asks the SAME question, which is what the dialog keys its
  // picks on: a state with no such question first, as in play, forgets the
  // last test's
  show(h, D);
  h.do({ type: 'declareAttack', seat: A, columns: [[atk]] });
  h.do({ type: 'playCard', seat: A, handIndex: give(h, A, 'Big Glimpse Card') });
  pick(h, { player: D });
  pass(h);
  assert.equal(h.state.decision?.pickSet?.group, 'split', 'fixture: the split question is open');
  assert.equal(h.state.decision!.seat, D, 'fixture: the opponent splits');
  return { h, A, D };
}
/** the caster's pile question, read as the two piles' card names */
function pilesAsked(h: Harness): { a: string; b: string } {
  const dec = h.state.decision!;
  assert.equal(dec.options.length, 2, 'the caster is asked which pile to cache');
  return { a: dec.options[0]!.label, b: dec.options[1]!.label };
}
/** feed every answer the client sends back into the engine, one state at a time */
function runChain(h: Harness, D: Seat): number {
  let n = 0;
  for (let sent = decides(); sent.length; sent = decides()) {
    assert.equal(sent.length, 1, 'one answer per state');
    h.do(sent[0]!);
    n++;
    if (h.state.decision?.seat !== D) { push(h, D); assert.deepEqual(decides(), []); break; }
    push(h, D);
  }
  return n;
}

test('Big Glimpse Card: the split opens as two piles, all seven in pile 2', () => {
  const { h, D } = glimpse(34120);
  const html = show(h, D);
  assert.match(html, /class="overlay psover"/, 'the dialog is up for the splitter');
  assert.deepEqual(panes(html), { 'Pile 1': [], 'Pile 2': SEVEN });
  assert.equal(counter(html), '0 in pile 1 · 7 in pile 2');
  assert.match(html, /data-btn="psconfirm">Confirm the piles</);
  assert.doesNotMatch(html, /mana left/, 'the split has no mana count');
  assert.ok(cardsIn(html).every(c => c.i !== null && !c.off), 'every card can be moved');
});

test('Big Glimpse Card: a tap moves a card to the other pile, and back, sending nothing', () => {
  const { h, D } = glimpse(34121);
  let html = show(h, D);
  html = ui.click({ btn: 'pspick', i: card(html, 'Uglk').i! });
  html = ui.click({ btn: 'pspick', i: card(html, 'Gublin').i! });
  assert.deepEqual(panes(html)['Pile 1'], ['Gublin', 'Uglk'], 'pile 1 keeps the revealed order');
  assert.equal(counter(html), '2 in pile 1 · 5 in pile 2');
  html = ui.click({ btn: 'pspick', i: card(html, 'Uglk').i! });
  assert.deepEqual(panes(html), {
    'Pile 1': ['Gublin'], 'Pile 2': SEVEN.filter(n => n !== 'Gublin'),
  }, 'Uglk went back to pile 2');
  assert.deepEqual(decides(), [], 'moving cards decides nothing');
});

test('Big Glimpse Card: Confirm answers every pile-1 card by value, then Done splitting', () => {
  const { h, D } = glimpse(34122);
  const first = h.state.decision!;
  let html = show(h, D);
  // ticked out of order, and changed once, so the answers are not just 0, 1, 2
  for (const n of ['Mindburn', 'Shib', 'Chombot', 'Bloppert']) html = ui.click({ btn: 'pspick', i: card(html, n).i! });
  html = ui.click({ btn: 'pspick', i: card(html, 'Chombot').i! });
  ui.click({ btn: 'psconfirm' });
  const one = decides();
  assert.deepEqual(one, [{ type: 'decide', seat: D, choice: idx(first, 6) }], 'Mindburn first, as ticked');
  h.do(one[0]!);
  // the next question's options are rebuilt without Mindburn: Shib is found by value
  push(h, D);
  const second = decides();
  assert.equal(second.length, 1);
  assert.equal(h.state.decision!.options[(second[0] as { choice: number }).choice]!.card, 'Shib');
  h.do(second[0]!);
  push(h, D);
  const sent = 2 + runChain(h, D);
  assert.equal(sent, 4, 'three cards and Done splitting');
  const p = pilesAsked(h);
  assert.equal(p.a, 'Pile 1: Shib, Bloppert, Mindburn');
  assert.equal(p.b, 'Pile 2: Gublin, Chombot, Uglk, Zephyrzoa');
});

test('Big Glimpse Card: Confirm with pile 1 empty sends Done splitting at once', () => {
  const { h, D } = glimpse(34123);
  show(h, D);
  ui.click({ btn: 'psconfirm' });
  const one = decides();
  assert.deepEqual(one, [{ type: 'decide', seat: D, choice: idx(h.state.decision!, false) }]);
  h.do(one[0]!);
  assert.equal(pilesAsked(h).a, 'Pile 1: (empty)');
});

test('Big Glimpse Card: all seven in pile 1 sends seven answers and no Done', () => {
  const { h, D } = glimpse(34124);
  let html = show(h, D);
  for (const n of SEVEN) html = ui.click({ btn: 'pspick', i: card(html, n).i! });
  assert.equal(counter(html), '7 in pile 1 · 0 in pile 2');
  ui.click({ btn: 'psconfirm' });
  assert.equal(runChain(h, D), 7);
  assert.equal(pilesAsked(h).b, 'Pile 2: (empty)');
});

test('Big Glimpse Card: reopened part-way, the cards already in pile 1 are shown there, fixed', () => {
  const { h, D } = glimpse(34125);
  pick(h, 1);   // Shib into pile 1 before this client drew the dialog (a reload)
  assert.equal(h.state.decision?.pickSet?.picked, 1);
  const html = show(h, D);
  assert.deepEqual(panes(html), { 'Pile 1': [], 'Pile 2': SEVEN.filter(n => n !== 'Shib') },
    'the six still to split can be moved');
  assert.match(html.split('Pile 2')[0]!, /class="pscard locked"[^>]*>\s*<div class="[^"]*" data-prev="Shib"/,
    'Shib is drawn in pile 1, not as a button');
  assert.equal(counter(html), '1 in pile 1 · 6 in pile 2');
});

/* ── §7 Big Glimpse Card: the caster chooses a pile from the piles as cards ──
 *
 * CT-549, report #360 (mycheze): *"it should be basically the same for the
 * chooser. Instead of giving them two buttons with a list of options, it
 * should present them with two modal piles of cards to choose from with
 * buttons below."* The engine's question is unchanged ('a' or 'b'); it says
 * which cards each pile holds in `Decision.piles`, display only. */

/** split the seven as `one` | the rest, straight through the engine, and
 * return the caster's pile question */
function toPiles(seed: number, one: string[]): { h: Harness; A: Seat; D: Seat } {
  const g = glimpse(seed);
  const { h, D } = g;
  for (const n of one) {
    const dec = h.state.decision!;
    h.do({ type: 'decide', seat: D, choice: dec.options.findIndex(o => o.card === n) });
  }
  if (h.state.decision?.seat === D) {
    h.do({ type: 'decide', seat: D, choice: h.state.decision.options.findIndex(o => o.value === false) });
  }
  assert.equal(h.state.decision?.seat, g.A, 'fixture: the caster is asked which pile to cache');
  return g;
}
/** each pile pane of the dialog: its label, its cards, its button's option */
function pilePanes(html: string): { label: string; cards: string[]; i: number | null; button: string }[] {
  return html.split('<div class="pspane pspile">').slice(1).map(chunk => ({
    label: /<div class="zonelabel">([^<]*)<\/div>/.exec(chunk)![1]!,
    cards: [...chunk.split('<div class="psfoot">')[0]!.matchAll(/<div class="pscard">\s*<div class="[^"]*" data-prev="([^"]*)"/g)]
      .map(m => m[1]!),
    i: Number(/data-btn="pspile" data-i="(\d+)"/.exec(chunk)?.[1] ?? NaN),
    button: /data-btn="pspile" data-i="\d+">([^<]*)</.exec(chunk)?.[1] ?? '',
  }));
}

test('Big Glimpse Card: the caster is shown both piles as cards, a button under each', () => {
  const { h, A } = toPiles(34130, ['Shib', 'Mindburn']);
  const dec = h.state.decision!;
  assert.deepEqual(dec.piles, [['Shib', 'Mindburn'], SEVEN.filter(n => n !== 'Shib' && n !== 'Mindburn')],
    'the engine names each pile\'s cards, in option order');
  const html = show(h, A);
  assert.match(html, /class="overlay psover"/, 'the dialog is up for the caster');
  const p = pilePanes(html);
  assert.deepEqual(p.map(x => x.cards), dec.piles, 'each pile drawn as its cards');
  assert.deepEqual(p.map(x => x.label), ['Pile 1 · 2 cards', 'Pile 2 · 5 cards']);
  assert.deepEqual(p.map(x => x.button), ['Cache pile 1', 'Cache pile 2']);
  assert.match(html, /and recycle pile 2/);
  assert.doesNotMatch(html, /data-btn="pspick"/, 'the caster cannot move cards between the piles');
  assert.deepEqual(decides(), [], 'opening the dialog decides nothing');
});

test('Big Glimpse Card: the button under each pile sends that pile as its option, and the engine caches it', () => {
  for (const [k, seed] of [[0, 34131], [1, 34132]] as const) {
    const { h, A } = toPiles(seed, ['Uglk', 'Gublin', 'Zephyrzoa']);
    const want = h.state.decision!.piles![k]!;
    const html = show(h, A);
    ui.click({ btn: 'pspile', i: pilePanes(html)[k]!.i! });
    const sent = decides();
    assert.deepEqual(sent, [{ type: 'decide', seat: A, choice: k }], `pile ${k + 1}'s button`);
    h.do(sent[0]!);
    assert.deepEqual([...(h.state.players[A]!.cache ?? []).map(c => c.card)].sort(), [...want].sort(),
      `pile ${k + 1} is cached`);
    push(h, A);
  }
});

test('Big Glimpse Card: an empty pile says so, and its button still works', () => {
  const { h, A } = toPiles(34133, []);
  const html = show(h, A);
  const p = pilePanes(html);
  assert.deepEqual(p[0]!.cards, []);
  assert.match(html.split('<div class="pspane pspile">')[1]!, /<span class="binempty">empty<\/span>/);
  ui.click({ btn: 'pspile', i: p[0]!.i! });
  assert.deepEqual(decides(), [{ type: 'decide', seat: A, choice: 0 }]);
});

test('Big Glimpse Card: the pile dialog hides to look at the board, and the bar brings it back', () => {
  const { h, A } = toPiles(34134, ['Chombot']);
  show(h, A);
  let html = ui.click({ btn: 'pshide' });
  assert.doesNotMatch(html, /class="overlay psover"/, 'hidden');
  assert.match(html, /data-btn="psshow"/, 'the bar offers the way back');
  html = ui.click({ btn: 'psshow' });
  assert.equal(pilePanes(html).length, 2, 'back up');
  assert.deepEqual(decides(), []);
});

test('Big Glimpse Card: without the piles hint the pile question is still answerable from the bar', () => {
  const { h, A } = toPiles(34135, ['Bloppert']);
  const view = viewFor(h.state, A);
  delete (view.decision as { piles?: unknown }).piles;
  const html = ui.join(view, A, legalActions(h.state, A));
  assert.doesNotMatch(html, /class="overlay psover"/, 'no dialog without the hint');
  assert.match(html, /Pile 1: Bloppert/, 'the text buttons are the fallback');
});
