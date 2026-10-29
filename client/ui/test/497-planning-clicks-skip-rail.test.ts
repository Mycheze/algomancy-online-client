/* 497 — IN PLANNING, A CLICK THAT WAS A MOVE LEAVES THE RAIL ALONE
 * (report #223, 2026-10-18, regions board) — AND THEN THERE WAS NO RAIL
 * (board round 8, owner 2026-10-27).
 *
 * The regions board put every clicked card in the right-hand rail, a move
 * included; #223 took the planning moves (a bottom pick, a draft pick, the
 * recycle menu's click) back out. Round 8 removed the rail's viewer
 * altogether: a card is read by the zoom (a mouse) or the peek and a tap's
 * read (a finger, test/384, test/715). This file now pins the other side of
 * that removal — that every click #223 cared about still does exactly its
 * move, and that nothing on the regions board catches the clicked card any
 * more (no `#preview`, nothing deferred painted into the toolbar).
 *
 * Driven through the real client (test/ui-driver.ts): a mouse press, then the
 * click, then the tick that ran the rail's deferred paint.
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

const mouse = (want: Record<string, string | number>): void => {
  ui.pointer('pointerdown', want, { pointerType: 'mouse', pointerId: 2, isPrimary: true });
};
const preview = (): string =>
  String((globalThis as unknown as { document: { getElementById(id: string): { innerHTML?: unknown } | null } })
    .document.getElementById('preview')?.innerHTML ?? '');
/** the regions board has no rail viewer: nothing may catch a clicked card */
const noRail = (html: string): void => {
  assert.equal(preview(), '', 'no #preview on the regions board');
  assert.doesNotMatch(html, /id="preview"|class="railmenu"|data-btn="railitem"/, 'no viewer, no rail card menu');
};
const click = (want: Record<string, string | number>): string => {
  mouse(want);
  const html = ui.click(want);
  ui.tick();
  return html;
};

/** Join `s`, then click the OPPONENT's first hand card (a test state is not
 * redacted, so their hand is drawn, and a click on it does nothing but read —
 * on the old board it filled the rail). Every fixture starts from this. */
function primed(s: GameState): string {
  ui.join(s, me, legalActions(s, me));
  ui.tick();
  const name = s.players[1]!.hand[0]!;
  noRail(click({ act: 'hand', p: 1, i: 0 }));
  return name;
}

/** my first hand card that is not `other`, so the rail can tell them apart */
const mineNot = (s: GameState, other: string): number => {
  const i = s.players[me]!.hand.findIndex(n => n !== other);
  assert.ok(i >= 0, 'the fixture has a card of mine that differs from the primed one');
  return i;
};

test('control: in planning, a hand card with no legal click does nothing, and nothing catches it', () => {
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
  noRail(click({ act: 'hand', p: me, i }));
  assert.deepEqual(ui.actions(), [], 'the click did nothing');
});

test('the draw step: a bottom pick is still a pick', () => {
  const h = new Harness(49702);
  const s = h.state;
  // the constructed draw step, as test/269 raises it: a seat that still owes cards back
  Object.assign(s, { mode: 'constructed', phase: 'planning', bottomDone: [false, false] });
  const p = primed(s);
  const i = mineNot(s, p);
  assert.ok(ui.has({ act: 'bottomcard', i }), 'the pick dialog is up');
  const html = click({ act: 'bottomcard', i });
  noRail(html);
  assert.ok(ui.has({ act: 'bottomcard', i }), 'the pick dialog is still up after one pick');
});

test('the resource step: the click still opens the recycle menu', () => {
  const h = new Harness(49703);
  const s = h.state;
  const p = primed(s);
  const i = mineNot(s, p);
  const html = click({ act: 'hand', p: me, i });
  assert.match(html, /Recycle →/, 'the click was a move: the recycle menu opened');
  noRail(html);
});

test('the draft step: a pick off the dock is still a pick', () => {
  const h = new Harness(49704, undefined, 'draft');
  const s = h.state;
  assert.deepEqual(s.draftDone, [false, false]);
  const p = primed(s);
  const pile = [...s.players[me]!.hand, ...s.packs[me]!];
  const i = pile.findIndex(n => n !== p);
  assert.ok(ui.has({ act: 'draftcard', i }), 'the draft dock is up');
  noRail(click({ act: 'draftcard', i }));
});

test('deployment: a click that PLAYS a card plays it', () => {
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
  noRail(ui.html());
});

test('the haste step: a click that PLAYS a Haste card plays it', () => {
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
  noRail(ui.html());
});

test('touch: a tap in planning reads — it sends nothing, and no rail takes it', () => {
  const h = new Harness(49706);
  const s = h.state;
  const p = primed(s);
  const i = mineNot(s, p);
  ui.sent();
  ui.tap({ act: 'hand', p: me, i });
  ui.tick();
  assert.deepEqual(ui.actions(), [], 'a tap only reads');
  noRail(ui.html());
});
