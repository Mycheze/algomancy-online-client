/* 1071 — THE APP FRAME (ui/pages/frame.ts, 2026-11-04): every page after the
 * home, drawn in one window with one toolbar.
 *
 * §1 frameHtml: the contained shell, `apppage` and the page's class LAST
 *    (287), Home or Back first with its own data-btn, the title, the tabs in
 *    the centre, the page's tools before the shared ones, the notice's bar
 * §2 the shared tools are one list: the home draws all five, a page three
 *    (Rules, Alerts, Report); signed out there is no bell unless the caller
 *    draws one
 * §3 the scroll carry: every [data-scroll] region (and the shell's main
 *    region) is read before a repaint and put back after it, by key; a key the
 *    new markup has not got is dropped, and a card's name in a key is quoted
 * §4 the chrome comes from the source main.ts sets — signed out until then
 * §5 `bleed` (BL-65): the builder's main region edge to edge, one class on the
 *    root; a page that does not ask is untouched
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_TOOLS, TOOL_NAMES, frameChromeView, frameHtml, restoreScrolls, scrollsIn, setChromeSource, toolsHtml } from '../pages/frame.ts';

const IN = { signedIn: true, alerts: 4 };
const OUT = { signedIn: false, alerts: 0 };

test('1071 §1 the frame: root, toolbar, main, the notice', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined', 'no DOM here');
  const html = frameHtml({
    page: 'xpage', title: 'A <b>', back: { dataBtn: 'x-close', label: 'Home' }, centerHtml: '<!--TABS-->',
    toolsHtml: '<!--TOOLS-->', chrome: IN, mainHtml: '<!--MAIN-->', fill: true, wide: true,
  });
  assert.match(html, /^<div class="ui-app-shell ui-app-shell--contained ui-app-shell--fill apppage framewide xpage">/);
  assert.match(html, /<button class="ui-icon-button ui-icon-button--stack frameback" data-btn="x-close" type="button">[\s\S]*ui-icon--home/);
  assert.match(html, /<h1 class="frametitle">A &lt;b&gt;<\/h1>/, 'the title is text');
  assert.match(html, /zone--center"><!--TABS--><\/div>/);
  assert.match(html, /<div class="frametools"><!--TOOLS--><\/div><span class="framesep" aria-hidden="true"><\/span>[\s\S]*data-help="rules"/,
    'the page\'s own tools come before the shared ones');
  assert.match(html, /<main class="ui-app-shell__main"><!--MAIN--><\/main>/);
  assert.match(html, /<footer class="ui-app-shell__bottom">[\s\S]*data-legal="about"[\s\S]*Unofficial Client/);
  const back = frameHtml({ page: 'p', title: 'T', back: { dataBtn: 'b', label: 'Deck', icon: 'back' }, chrome: OUT, mainHtml: '' });
  assert.match(back, /ui-icon--back[\s\S]*>Deck</);
  assert.doesNotMatch(back, /frametools|ui-app-shell--fill|framewide/, 'nothing that was not asked for');
});

test('1071 §2 the shared tools: one list, the home draws them all', () => {
  assert.deepEqual([...TOOL_NAMES], ['learn', 'test', 'rules', 'alerts', 'report']);
  assert.deepEqual([...PAGE_TOOLS], ['rules', 'alerts', 'report']);
  const all = toolsHtml(IN, TOOL_NAMES);
  for (const a of ['data-learn="menu"', 'data-sbx="open"', 'data-help="rules"', 'data-inbox="bell"', 'data-report="open"']) assert.ok(all.includes(a), a);
  assert.match(all, /ui-icon-button__badge">4</, 'the bell carries the unread count');
  assert.doesNotMatch(toolsHtml(OUT, TOOL_NAMES), /data-inbox/, 'signed out: no bell');
  assert.match(toolsHtml(OUT, ['alerts'], { alertsSignedOutHtml: '<!--SIGNIN-->' }), /^<!--SIGNIN-->$/);
  // the home really draws them through here, so a tool changed here changes everywhere
  // (its toolbar markup is pinned by 960; this is the source side)
});

test('1071 §3 the scroll carry: by key, the main region too', () => {
  const el = (scroll: string | null, top: number, left = 0) => ({ scrollTop: top, scrollLeft: left, dataset: scroll ? { scroll } : {} });
  const before = { main: el(null, 5), rail: el('cards-rail', 120), grid: el('cards-results-grid', 900, 3), card: el('cards-detail-Ann\'s "Big" Card', 40) };
  const app = {
    querySelector: (s: string) => (s === '.ui-app-shell__main' ? before.main : null),
    querySelectorAll: () => [before.rail, before.grid, before.card],
  };
  const kept = scrollsIn(app);
  assert.deepEqual([...kept.keys()], ['__main', 'cards-rail', 'cards-results-grid', 'cards-detail-Ann\'s "Big" Card']);
  // the repaint: new elements, at the top, and the grid is now the list view
  const after: Record<string, ReturnType<typeof el>> = {
    '.ui-app-shell__main': el(null, 0), '[data-scroll="cards-rail"]': el('cards-rail', 0),
    '[data-scroll="cards-results-list"]': el('cards-results-list', 0),
    '[data-scroll="cards-detail-Ann\'s \\"Big\\" Card"]': el('cards-detail-Ann\'s "Big" Card', 0),
  };
  restoreScrolls({ querySelector: (s: string) => after[s] ?? null }, kept);
  assert.equal(after['.ui-app-shell__main']!.scrollTop, 5);
  assert.equal(after['[data-scroll="cards-rail"]']!.scrollTop, 120);
  assert.equal(after['[data-scroll="cards-results-list"]']!.scrollTop, 0, 'another key starts at the top');
  assert.equal(after['[data-scroll="cards-detail-Ann\'s \\"Big\\" Card"]']!.scrollTop, 40, 'a quote in a card\'s name is escaped in the selector');
  // a fake without the DOM methods (the ui-driver's) is a no-op, not a throw
  assert.equal(scrollsIn({}).size, 0);
});

test('1071 §4 the chrome is the source main.ts sets; signed out until then', () => {
  assert.deepEqual(frameChromeView(), OUT);
  setChromeSource(() => IN);
  assert.deepEqual(frameChromeView(), IN);
  setChromeSource(() => OUT);
});

test('1071 §5 bleed (BL-65): the main region edge to edge — one class on the root, nothing else; absent, no trace', () => {
  const base = { page: 'ttpage', title: 'T', back: { dataBtn: 'tt-close', label: 'Decks', icon: 'back' as const }, chrome: OUT, mainHtml: '<!--MAIN-->', fill: true };
  const bled = frameHtml({ ...base, bleed: true });
  assert.match(bled, /^<div class="ui-app-shell ui-app-shell--contained ui-app-shell--fill apppage framebleed ttpage">/,
    'framebleed before the page\'s class, which stays LAST (287)');
  assert.equal(bled.replace(' framebleed', ''), frameHtml(base), 'bleed changes the root\'s class and nothing else');
  assert.doesNotMatch(frameHtml(base), /framebleed/);
  assert.match(frameHtml({ ...base, wide: true, bleed: true }), /class="[^"]* apppage framewide framebleed ttpage"/);
});
