/* R230 — report #110: THE TOOLTIP THAT NEVER APPEARED ON FIRST LANDING.
 *
 * Owner, SBCM action 269: *"It's weirdly difficult to get the hover to work on
 * units and show their text. I often have to move my mouse several times to
 * get it to show up"*. He described it as flaky. It is not: ONE mouseover arms
 * the 550ms dwell and then paints the focus rail, `scrollFocusToBottom`
 * assigns `#preview.scrollTop`, and the `scroll` event three milliseconds
 * later reaches the window-capture listener that hides the tip — cancelling
 * the dwell the same gesture had just armed. Whenever the rail's content
 * overflows the rail, the tooltip cannot appear at all.
 *
 * ── ⚠ READ THIS BEFORE ADDING A "THE TOOLTIP APPEARED" TEST HERE ─────────
 *
 * IT CANNOT BE WRITTEN IN THIS DRIVER, and writing it anyway is how this bug
 * would have survived a round with a green suite. test/ui-driver.ts:
 *
 *  - has `preview` and `hovertip` in its ABSENT set, so
 *    `document.getElementById('preview')` returns null. `paintFocus` bails on
 *    its first line, `scrollFocusToBottom` never runs, and the client's own
 *    scroll — the entire cause of #110 — never happens here at all.
 *  - fires no `scroll` event when `scrollTop` is assigned, so even a rail that
 *    existed would scroll silently.
 *  - answers `classList.contains` with a flat `false` on any element it did
 *    not build from rendered markup, so "the tip is showing" and "the tip is
 *    not showing" are the same answer, and an assertion either way passes for
 *    a reason that has nothing to do with the client.
 *  - dispatches `click` and `contextmenu` only. There is no mouseover, so
 *    `armHoverTip` is never called.
 *
 * A driver test asserting the tooltip therefore goes GREEN against a client
 * that is RED in every browser. That is the CT-75 family — the driver cannot
 * see something, so nobody sees it — and it has already produced one wrong
 * ticket in this repo.
 *
 * ── SO WHAT IS TESTED HERE, AND WHAT WAS TESTED ELSEWHERE ────────────────
 *
 * §1-§4: the RULE, as a pure function. R230 moved the decision out of the
 * listener into `ui/inspect.ts scrollHidesHoverTip`, which is this repo's
 * standing shape for client logic worth asserting (cf. ui/cardtext.ts). The
 * function is total and the cases below are its whole domain, so a regression
 * in the rule is caught here rather than in a browser six weeks later.
 *
 * §5: the DRIVER's own honesty about cancelled timers, which R230 repaired.
 *
 * THE WIRING — that this rule really is on the window's capture-phase `scroll`
 * listener, that `hoverEl` really is the hovered card, and that the tooltip
 * really does appear on first landing — was verified in headless Chrome over
 * CDP, serving the Algomancy repo root so the card art loads (with the art
 * missing the rail does not overflow and the bug does not reproduce). Two
 * bundles differing in exactly that one listener, three viewports:
 *
 *     viewport    before      after
 *     1280x720    0 of 4      4 of 4
 *     1400x900    2 of 4      4 of 4      (the 2 that failed are the 2 whose
 *     1600x1200   4 of 4      4 of 4       rail content overflowed)
 *
 * and the contract the listener exists for, unchanged: a DOCUMENT scroll still
 * hides the tip, a pointerdown still hides it, and a scroll of the rail — the
 * one case that changed — no longer does.
 *
 * Seeds 19900-19999 (unused so far: nothing here needs a game).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrollHidesHoverTip } from '../../ui/inspect.ts';
import type { ScrollContainer } from '../../ui/inspect.ts';

/* §5 drives the driver itself. Set BEFORE the import, and the import must
 * therefore be dynamic: a static one is hoisted and would run ui/main.ts
 * before this line ever executed. */
(globalThis as Record<string, unknown>)['__UI_DRIVER_SEARCH'] = '?hotseat=1';
const { local } = await import('./ui-driver.ts');
const ui = local();

/* ── a two-line stand-in for the DOM's containment ───────────────────── */

/** the only thing the rule asks an element: is this node inside me? */
const holding = (...nodes: unknown[]): ScrollContainer =>
  ({ contains: (n: unknown) => nodes.includes(n) });

const CARD = { what: 'a unit on the board' };
const OTHER = { what: 'a different card' };

/* ═══ §1 THE CLIENT SCROLLING ITS OWN RAIL ════════════════════════════ */

test('R230 §1: the focus rail scrolling does NOT hide the tip — this is #110', () => {
  // #preview is a sibling panel: it does not contain the card the cursor is
  // on, so it cannot have moved it. This is the exact call the client makes
  // three milliseconds after arming the dwell.
  const rail = holding(/* nothing from the board */);
  assert.equal(scrollHidesHoverTip(rail, CARD), false,
    'the client talking to itself must not cancel the player\'s dwell');

  // and it stays false however many times the rail scrolls — scrollFocusToBottom
  // drops the panel again on every image that lands late, which is where the
  // appearance of randomness in the owner\'s report came from
  for (let i = 0; i < 5; i++) {
    assert.equal(scrollHidesHoverTip(rail, CARD), false, 'still not the player');
  }
});

/* ═══ §2 THE SCROLLS THAT STILL HIDE ══════════════════════════════════ */

test('R230 §2: a scroll that could have MOVED the card still hides the tip', () => {
  // the document scrolled: `e.target` is the document, not an Element, so the
  // wiring passes null. Everything on screen moved.
  assert.equal(scrollHidesHoverTip(null, CARD), true,
    'a window/document scroll moves the board out from under the cursor');

  // a scrollable container the card lives in — a region row, a dialog, a panel
  // nobody has written yet. No list of element ids anywhere: the rule asks the
  // element, so a new scroller is covered the day it is added.
  assert.equal(scrollHidesHoverTip(holding(CARD), CARD), true,
    'the card is INSIDE this one, so it moved');
  assert.equal(scrollHidesHoverTip(holding(CARD, OTHER), CARD), true,
    'a container holding several cards, one of them the hovered one');
});

/* ═══ §3 NOTHING HOVERED ══════════════════════════════════════════════ */

test('R230 §3: with nothing hovered, every scroll hides — there is nothing to protect', () => {
  for (const scroller of [null, holding(), holding(CARD)]) {
    assert.equal(scrollHidesHoverTip(scroller, null), true,
      'no dwell in flight: hiding is free, and it clears a tip left over from a repaint');
  }
});

/* ═══ §4 THE RULE IS ABOUT *THIS* CARD ════════════════════════════════ */

test('R230 §4: a scroller holding some OTHER card does not hide this one', () => {
  assert.equal(scrollHidesHoverTip(holding(OTHER), CARD), false,
    'containment is asked about the hovered card, not about cards in general');
  // the mirror image, so the two arguments cannot be swapped without failing
  assert.equal(scrollHidesHoverTip(holding(CARD), OTHER), false,
    'and the other way round');
});

/* ═══ §5 THE DRIVER TELLS THE TRUTH ABOUT CANCELLED TIMERS ════════════ */

test('R230 §5: test/ui-driver.ts really cancels a cleared timeout', () => {
  /* This is the guard on the fidelity repair, not on the client. The driver's
   * `clearTimeout` was `() => {}`, so `tick()` ran callbacks the client had
   * explicitly called off — which is precisely the shape of #110 (arm, cancel,
   * never fire) and precisely what would have made a driver test of it green.
   *
   * Asserted through the same globals ui/main.ts uses, because that is what
   * the client actually calls. Importing the driver installs them. */
  const fired: string[] = [];
  const st = globalThis.setTimeout as unknown as (fn: () => void, ms: number) => number;
  const ct = globalThis.clearTimeout as unknown as (id: number) => void;

  const kept = st(() => fired.push('kept'), 10);
  const killed = st(() => fired.push('killed'), 10);
  ct(killed);
  ui.tick();
  assert.deepEqual(fired, ['kept'],
    'a cleared timeout does not run — a driver that ran it would report #110 as fixed');

  // and the ids do not get recycled across a drain: an id held from before a
  // tick must not cancel a timer booked after it
  const fresh = st(() => fired.push('fresh'), 10);
  ct(kept);                       // stale id from the previous batch
  ct(killed);                     // and one that was already cancelled
  ui.tick();
  assert.deepEqual(fired, ['kept', 'fresh'],
    'a stale id cancels nothing — monotonic ids, not array positions');
  assert.notEqual(fresh, kept, 'and the ids really are distinct across a drain');
});
