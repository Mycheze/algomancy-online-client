/* 714 — A FINGER'S CARD MENU HANGS UNDER THE READ (board round 8, plan §P4).
 *
 * The iPad had no right-click (2026-09-05), so the card menu — details &
 * rulings, Ask the judge, auto-yield, propose a fix — was ALSO drawn in the
 * rail under the card a tap had put there (`railMenuHtml`, `data-btn=
 * "railitem"`). Round 8 removed the rail. The menu now hangs under the READ a
 * tap opens: a hand or cache card's (#201), or any card whose tap moved
 * nothing. Same list as the right-click (test/273 §3).
 *
 * The zoom layer takes no pointer events, so an entry is not clicked: the
 * finger that lands on it is hit-tested when it lifts (ui/tapgo.ts
 * zoomHangHit), the read goes, and main.ts runs the entry — the path CT-408's
 * cast / activate button already took. Pinned here: the hit test, that the
 * lift hands the entry over and eats the click it would make, and the wiring.
 *
 * The driver lays nothing out, so the zoom never goes up in it. The whole
 * gesture was run in headless Chrome with CDP touch input at 1024x768 on a
 * review board: a tap on the opponent's unit, on a hand card, on a resource
 * each opened the read with its entries under it, and a tap on "📖 … details"
 * opened the card inspector.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zoomHangHit } from '../tapgo.ts';
import { liftSwallows } from '../touch.ts';

const read = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const MAIN = read('../main.ts');
const TOUCH = read('../touch.ts');

type Box = { left: number; top: number; right: number; bottom: number; width: number };
const el = (data: Record<string, string>, r: Box): HTMLElement =>
  ({ dataset: data, getBoundingClientRect: () => r }) as unknown as HTMLElement;
const box = (left: number, top: number, w: number, h: number): Box => ({ left, top, right: left + w, bottom: top + h, width: w });

test('the hit test finds the entry under the finger, the cast button too, and nothing elsewhere', () => {
  const entries = [el({ zmi: '0' }, box(100, 500, 300, 36)), el({ zmi: '1' }, box(100, 540, 300, 36))];
  const go = el({}, box(150, 600, 120, 40));
  let asked = '';
  const g = globalThis as { document?: unknown };
  const had = g.document;
  g.document = { querySelectorAll: (sel: string) => { asked = sel; return [go, ...entries]; } };
  try {
    assert.equal(zoomHangHit(200, 520)?.dataset['zmi'], '0');
    assert.equal(zoomHangHit(399, 575)?.dataset['zmi'], '1');
    assert.equal(zoomHangHit(200, 620), go, 'CT-408\'s button is found by the same test');
    assert.equal(zoomHangHit(50, 520), null, 'beside the menu: nothing');
    assert.equal(zoomHangHit(200, 538), null, 'between two entries: nothing');
    assert.match(asked, /#cardzoom \.zoomgo \.tapgo/);
    assert.match(asked, /#cardzoom \.zoommenu \[data-zmi\]/, 'it looks only inside the zoom layer');
  } finally { g.document = had; }
});

test('the lift that lands on an entry hands it over and eats its click', () => {
  // `go` is a hit on the read's own buttons: the click that lift makes must not
  // also land on whatever board card is under the (pointer-inert) zoom
  assert.equal(liftSwallows(true, 'pointerup', true, null), true);
  assert.match(TOUCH, /const hit = was && e\.type === 'pointerup' && goFrom === e\.pointerId \? zoomHangHit\(e\.clientX, e\.clientY\) : null;/,
    'the press must have STARTED on the button too (goFrom), as CT-408 required');
  assert.match(TOUCH, /peekEnd\(\);\n\s*if \(hit\) deps\.zoomGo\?\.\(hit\);/, 'the read goes first, then the entry runs');
  assert.match(MAIN, /zoomGo: hit => \{[\s\S]{0,200}readMenuItems\[Number\(i\)\]\?\.go\(\); render\(\); return; \}\n\s*BOARD_BTNS\['tapgo'\]/,
    'main.ts runs the entry by its index, and anything else is CT-408\'s button');
});

test('only a TAP\'s read carries the menu — a held peek ends as the finger lifts, with no second touch to press it', () => {
  const fn = /function menuRead[\s\S]*?\n}/.exec(MAIN)?.[0] ?? '';
  assert.match(fn, /readMenuArmed = true;\n\s*try \{ return tapRead\(el, at\); \} finally \{ readMenuArmed = false; \}/,
    'the flag is up exactly while the read is drawn');
  assert.match(MAIN, /if \(readMenuArmed\) hangReadMenu\(src, copy\);/, 'the zoom decorator hangs it only then');
  assert.doesNotMatch(TOUCH, /readMenuArmed|menuRead\(/, 'the peek in ui/touch.ts never arms it');
  // the menu shares the one hang under the card with what else hangs there
  // (a hand card's why, a stack card's caption, the cast button)
  assert.match(MAIN, /const hang = copy\.querySelector<HTMLElement>\(':scope > \.zoomhang'\);\n\s*if \(hang\) hang\.insertAdjacentHTML\('beforeend', readMenuHtml\(items\)\);/);
  // its entries are plain spans with data-zmi — never data-btn, which main.ts's
  // own click handler owns (and the layer takes no clicks anyway)
  const html = /function readMenuHtml[\s\S]*?\n}/.exec(MAIN)?.[0] ?? '';
  assert.match(html, /<span class="zmi" data-zmi="\$\{i\}">/);
  assert.doesNotMatch(html, /data-btn/);
});

test('a mouse click reads nothing new: it has the zoom on hover and the menu on a right-click', () => {
  const listener = MAIN.slice(MAIN.indexOf('// BOARD ROUND 8: the regions board has no rail to put a card in'));
  assert.match(listener.slice(0, 1500), /if \(zoomOn\(\)\) \{\n\s*if \(pointerCanHover\(\)\) return;/);
  assert.doesNotMatch(listener.slice(0, 1500), /paintFocus\(/, 'nothing is painted into a rail on the regions board');
});
