/* 495 — THE OPPONENT'S REVEAL WAITS FOR YOU (report #224, TRST, 2026-10-18).
 *
 * The report: Gember's Celestial Purge glimpsed three cards and the notice
 * was gone before the reporter had read it. It was a MOMENT — up for a dwell
 * of 1.2 s plus a second a card, then gone — and a resync, a layout or a
 * motion toggle dropped it sooner. The owner: it closes ONLY when the viewer
 * dismisses it or a newer reveal takes that space. No timer. Every reveal the
 * strip shows (a glimpse, Tides of the Cosmos, Big Glimpse Card) is the same
 * strip, so one glimpse stands for them here; the recap half is test/371.
 *
 * The glimpse is a REAL one — Oracle of Foretelling played through the
 * engine, its events put through the server's own redaction for the watching
 * seat — and the client is the real client (test/ui-driver.ts), on a test
 * clock so "a minute later" is a number and not a wait.
 *
 * Seeds 49501-49599.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './ui-driver.ts';
import { Harness } from '../../engine/src/harness.ts';
import { legalActions } from '../../engine/src/apply.ts';
import { toDeployment } from '../../engine/test/util.ts';
import { redactEvent, viewFor, visibleToSeat } from '../../server/view.ts';
import type { CardName, EngineEvent, Seat } from '../../engine/src/types.ts';

const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;
after(() => { Date.now = realNow; });

const ui = await client();
const NAMES: [string, string] = ['Ann', 'Bo'];

const notice = (html: string): string | null => {
  const at = html.indexOf('class="glimpsenotice"');
  return at < 0 ? null : html.slice(at, at + 4000);
};

/** a deployment, the deploying seat A, and the seat D watching it */
function table(seed: number): { h: Harness; A: Seat; D: Seat } {
  const h = new Harness(seed, NAMES);
  toDeployment(h);
  const A = h.state.deployPlayer! as Seat;
  return { h, A, D: (A === 0 ? 1 : 0) as Seat };
}

/** A plays Oracle of Foretelling (glimpse 5) and keeps the first card; the
 * events as the server would send them to `viewer` */
function glimpse(h: Harness, A: Seat, viewer: Seat): { events: EngineEvent[]; cards: CardName[] } {
  for (let i = 0; i < 4; i++) h.state.players[A]!.resources.push({ kind: 'water', state: 'open' } as never);
  h.state.players[A]!.hand.push('Oracle of Foretelling');
  const evs = h.do({ type: 'playCard', seat: A, handIndex: h.state.players[A]!.hand.length - 1 });
  for (let g = 0; g < 6 && h.state.decision?.seat === A; g++) evs.push(...h.do({ type: 'decide', seat: A, choice: 0 }));
  const g = evs.find(e => e.type === 'glimpsed');
  assert.ok(g && Array.isArray(g.data?.['cards']), 'non-vacuous: the Oracle glimpsed');
  return {
    events: evs.filter(e => visibleToSeat(e, viewer)).map(e => redactEvent(e, viewer, NAMES)),
    cards: g!.data!['cards'] as CardName[],
  };
}

/** the watcher joined on the board before the glimpse, then sent it */
function shown(seed: number): { h: Harness; A: Seat; D: Seat; cards: CardName[] } {
  const t = table(seed);
  ui.join(viewFor(t.h.state, t.D), t.D, legalActions(t.h.state, t.D));
  assert.equal(notice(ui.html()), null, 'no notice before the glimpse');
  const { events, cards } = glimpse(t.h, t.A, t.D);
  ui.update(viewFor(t.h.state, t.D), legalActions(t.h.state, t.D), { events });
  const up = notice(ui.html());
  assert.ok(up, 'the glimpse pops the notice');
  assert.match(up!, new RegExp(`${NAMES[t.A]} glimpsed ${cards.length}`));
  for (const n of cards) assert.ok(up!.includes(n), `showing ${n}`);
  return { ...t, cards };
}

test('a minute later, and every tick on the way, it is still up', () => {
  shown(49501);
  for (let s = 0; s < 60; s++) { clock += 1000; ui.tick(); }
  assert.ok(notice(ui.html()), 'still up after 60 s — there is no timer');
});

test('an update that reveals nothing does not take it down', () => {
  const { h, D } = shown(49502);
  const other: EngineEvent[] = [{ type: 'info', msg: 'Something else happened.' }];
  clock += 30_000; ui.tick();
  ui.update(viewFor(h.state, D), legalActions(h.state, D), { events: other });
  clock += 5000; ui.tick();
  assert.ok(notice(ui.html()), 'still up after a non-reveal update');
});

test('the motion toggle and a reconnect to the same game leave it up', () => {
  const { h, D } = shown(49503);
  ui.click({ btn: 'motiontoggle' });
  ui.click({ btn: 'motiontoggle' });
  assert.ok(notice(ui.html()), 'still up after the motion toggle, twice');
  ui.join(viewFor(h.state, D), D, legalActions(h.state, D));
  assert.ok(notice(ui.html()), 'still up after the server sends the game again (a reconnect)');
});

test('its ✕ is a button on the strip, and a click on it puts it away — for good', () => {
  const { h, D } = shown(49504);
  assert.match(notice(ui.html())!, /<button[^>]*data-btn="glimpseclose"/, 'the strip has a dismiss BUTTON');
  ui.click({ btn: 'glimpseclose' });
  assert.equal(notice(ui.html()), null, 'dismissed');
  ui.join(viewFor(h.state, D), D, legalActions(h.state, D));
  assert.equal(notice(ui.html()), null, 'and a reconnect does not bring it back');
});

test('a finger: a tap on the ✕ puts it away too', () => {
  shown(49505);
  assert.match(notice(ui.html())!, /<button[^>]*data-btn="glimpseclose"/, 'a button a finger can find');
  ui.tap({ btn: 'glimpseclose' });
  assert.equal(notice(ui.html()), null, 'dismissed by a tap');
});

test('a newer reveal takes its place', () => {
  const { h, A, D, cards } = shown(49506);
  const second = glimpse(h, A, D);
  assert.notDeepEqual(second.cards, cards, 'non-vacuous: the second glimpse shows other cards');
  ui.update(viewFor(h.state, D), legalActions(h.state, D), { events: second.events });
  const up = notice(ui.html());
  assert.ok(up, 'a notice is up');
  for (const n of second.cards) assert.ok(up!.includes(n), `the newer one: ${n}`);
  const only = cards.filter(n => !second.cards.includes(n));
  assert.ok(only.length, 'non-vacuous: the first glimpse had a card the second does not');
  for (const n of only) assert.ok(!up!.includes(`data-prev="${n}"`), `the older one is gone: ${n}`);
  assert.equal(ui.html().split('class="glimpsenotice"').length - 1, 1, 'one strip, not two');
});

test('the glimpser\'s own screen gets no notice (their decision already showed the cards)', () => {
  const t = table(49507);
  ui.join(viewFor(t.h.state, t.A), t.A, legalActions(t.h.state, t.A));
  const { events } = glimpse(t.h, t.A, t.A);
  ui.update(viewFor(t.h.state, t.A), legalActions(t.h.state, t.A), { events });
  assert.equal(notice(ui.html()), null);
});
