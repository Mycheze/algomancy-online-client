/* 497 — IN PLANNING, A CLICK THAT WAS A MOVE LEAVES THE RAIL ALONE
 * (report #223, 2026-10-18, regions board).
 *
 * The regions board put EVERY clicked card in the right-hand rail, a move
 * included (owner, 2026-09-23, docs/18 round 3). In the draw step that meant
 * the card you just sent to the bottom took over the rail; in the draft, the
 * card you just picked; in the resource step, the card you just opened the
 * recycle menu on. The owner, 2026-10-18: "only in planning I think (which
 * counts draft/draw/recycle). When you're attacking/playing with cards, it's
 * fine to show them."
 *
 * So in the planning phase (CR 501.2) up to its haste step — whose moves are
 * plays, and a play still shows its card — the regions board asks the classic
 * board's question — did the click move anything (main.ts clickSig)? — and a
 * move keeps the rail. Outside planning nothing changed. Touch is not special-
 * cased: a tap only reads (test/384), so it moves nothing and fills the rail.
 *
 * Driven through the real client (test/ui-driver.ts): a mouse press, then the
 * click, then the tick that runs the rail's deferred paint.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './ui-driver.ts';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { give, giveResources, toDeployment } from '../../engine/test/util.ts';
import type { GameState, Seat } from '../../engine/src/types.ts';

const ui = await client();
const me = 0 as Seat;
const store = (globalThis as { localStorage: Storage }).localStorage;
store.setItem('algoLayout', '2');

const mouse = (want: Record<string, string | number>): void => {
  ui.pointer('pointerdown', want, { pointerType: 'mouse', pointerId: 2, isPrimary: true });
};
const preview = (): string =>
  String((globalThis as unknown as { document: { getElementById(id: string): { innerHTML?: unknown } | null } })
    .document.getElementById('preview')?.innerHTML ?? '');
/** the name on the rail's text box, or null for an empty rail */
const rail = (): string | null => {
  const m = /<span class="tbname">([^<]*)<\/span>/.exec(preview());
  return m ? m[1]!.replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim() : null;
};
const click = (want: Record<string, string | number>): string => {
  mouse(want);
  const html = ui.click(want);
  ui.tick();
  return html;
};

/** Join `s`, then put the OPPONENT's first hand card in the rail (a test
 * state is not redacted, so their hand is drawn, and a click on it does
 * nothing but read). Every fixture starts from this, so "the rail is
 * unchanged" means "it still shows THIS card", not "it is empty". */
function primed(s: GameState): string {
  ui.join(s, me, legalActions(s, me));
  ui.tick();
  const name = s.players[1]!.hand[0]!;
  click({ act: 'hand', p: 1, i: 0 });
  assert.equal(rail(), name, 'primed: a click that read the opponent\'s card fills the rail');
  return name;
}

/** my first hand card that is not `other`, so the rail can tell them apart */
const mineNot = (s: GameState, other: string): number => {
  const i = s.players[me]!.hand.findIndex(n => n !== other);
  assert.ok(i >= 0, 'the fixture has a card of mine that differs from the primed one');
  return i;
};

test('control: in planning, a hand card with no legal click still fills the rail', () => {
  const h = new Harness(49701);
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  const s = h.state;
  assert.ok(s.phase === 'planning' && s.hasteDone && !s.hasteDone[me], 'the haste step: still planning');
  const p = primed(s);
  const legal = legalActions(s, me);
  const i = s.players[me]!.hand.findIndex((n, k) => n !== p && !legal.some(a => 'handIndex' in a && a.handIndex === k));
  assert.ok(i >= 0, 'a hand card with nothing to do in the haste step');
  ui.sent();
  click({ act: 'hand', p: me, i });
  assert.deepEqual(ui.actions(), [], 'the click did nothing');
  assert.equal(rail(), s.players[me]!.hand[i], 'a click that only read fills the rail, in planning too');
});

test('the draw step: a bottom pick does not take the rail', () => {
  const h = new Harness(49702);
  const s = h.state;
  // the constructed draw step, as test/269 raises it: a seat that still owes cards back
  Object.assign(s, { mode: 'constructed', phase: 'planning', bottomDone: [false, false] });
  const p = primed(s);
  const i = mineNot(s, p);
  assert.ok(ui.has({ act: 'bottomcard', i }), 'the pick dialog is up');
  click({ act: 'bottomcard', i });
  assert.equal(rail(), p, `the bottom pick (${s.players[me]!.hand[i]}) took the rail`);
});

test('the resource step: the click that opens the recycle menu does not take the rail', () => {
  const h = new Harness(49703);
  const s = h.state;
  const p = primed(s);
  const i = mineNot(s, p);
  const html = click({ act: 'hand', p: me, i });
  assert.match(html, /Recycle →/, 'the click was a move: the recycle menu opened');
  assert.equal(rail(), p, `the recycle click (${s.players[me]!.hand[i]}) took the rail`);
});

test('the draft step: a pick off the dock does not take the rail', () => {
  const h = new Harness(49704, undefined, 'draft');
  const s = h.state;
  assert.deepEqual(s.draftDone, [false, false]);
  const p = primed(s);
  const pile = [...s.players[me]!.hand, ...s.packs[me]!];
  const i = pile.findIndex(n => n !== p);
  assert.ok(ui.has({ act: 'draftcard', i }), 'the draft dock is up');
  click({ act: 'draftcard', i });
  assert.equal(rail(), p, `the draft pick (${pile[i]}) took the rail`);
});

test('deployment: a click that PLAYS a card still puts it in the rail', () => {
  const h = new Harness(49705);
  toDeployment(h);
  for (const el of ['fire', 'water', 'earth', 'wood', 'metal'] as const) giveResources(h, me, el, 3);
  const s = h.state;
  assert.equal(s.phase, 'deploy');
  const p = primed(s);
  const play = legalActions(s, me).find(a => a.type === 'playCard' && s.players[me]!.hand[a.handIndex] !== p);
  assert.ok(play && play.type === 'playCard', 'the fixture has a playable card');
  ui.update(s, [play]);
  ui.sent();
  click({ act: 'hand', p: me, i: play.handIndex });
  assert.deepEqual(ui.actions(), [play], 'the click played the card');
  assert.equal(rail(), s.players[me]!.hand[play.handIndex], 'the played card is in the rail, as before');
});

test('the haste step: a click that PLAYS a Haste card still puts it in the rail', () => {
  // the haste step is part of planning (CR 501.2), but a move there plays a
  // card — the owner's "when you're playing with cards, it's fine to show them"
  const h = new Harness(49707);
  giveResources(h, me, 'fire', 6);
  const i = give(h, me, 'Molten Upheaval');
  h.do({ type: 'donePlanning', seat: 0 });
  h.do({ type: 'donePlanning', seat: 1 });
  const s = h.state;
  assert.ok(s.phase === 'planning' && s.hasteDone && !s.hasteDone[me], 'the haste step is running');
  const play = legalActions(s, me).find(a => a.type === 'playCard' && a.handIndex === i);
  assert.ok(play, 'the fixture: Molten Upheaval is playable in the haste step');
  const p = primed(s);
  assert.notEqual(p, 'Molten Upheaval');
  ui.update(s, [play]);
  ui.sent();
  click({ act: 'hand', p: me, i });
  assert.deepEqual(ui.actions(), [play], 'the click played the card');
  assert.equal(rail(), 'Molten Upheaval', 'the played Haste card is in the rail');
});

test('touch: a tap in planning reads — it fills the rail and sends nothing', () => {
  const h = new Harness(49706);
  const s = h.state;
  const p = primed(s);
  const i = mineNot(s, p);
  ui.sent();
  ui.tap({ act: 'hand', p: me, i });
  ui.tick();
  assert.deepEqual(ui.actions(), [], 'a tap only reads');
  assert.equal(rail(), s.players[me]!.hand[i], 'the tapped card is in the rail');
});
