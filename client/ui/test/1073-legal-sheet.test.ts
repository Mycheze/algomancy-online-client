/* 1073 — THE LEGAL PAGES ARE A SHEET (ui/legal.ts legalPageHtml, 2026-11-04).
 *
 * About / AI disclosure / Privacy / Terms open as components/sheet.ts over
 * whatever page is up: the page's title in the sheet's head, the four pages
 * as a segmented switch, the page's text in .lgbody (the one part that
 * scrolls). Every control is `data-legal` or the sheet's `data-sheet-dismiss`
 * — never `data-btn`, which main.ts's delegator would also act on.
 *
 * §1 each page: its title, the switch with only its own option on, its text
 * §2 the hooks: data-legal on every option, the dismiss on the scrim and ✕, no data-btn
 * §3 About carries the unofficial notice verbatim (BL-15, 267); an unknown page draws nothing
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNOFFICIAL, legalPageHtml } from '../legal.ts';

const PAGES = { about: 'About &amp; attribution', ai: 'AI disclosure', privacy: 'Privacy', terms: 'Terms' } as const;

test('1073 §1 each page: the sheet, its title, the switch, its text', () => {
  for (const [k, title] of Object.entries(PAGES)) {
    const html = legalPageHtml(k);
    assert.match(html, /^<div class="ui-sheet ui-sheet--center ui-sheet--lg lgsheet" id="legalsheet"/);
    assert.match(html, new RegExp(`<h2 class="ui-sheet__title" id="legalsheet-title">${title}</h2>`));
    const on = [...html.matchAll(/class="ui-segmented__option on"[^>]*data-legal="(\w+)"/g)].map(m => m[1]);
    assert.deepEqual(on, [k], `${k}: the only page that is on`);
    assert.match(html, /<div class="lgbody">[\s\S]*<h2>/, `${k}: its text, in the part that scrolls`);
  }
});

test('1073 §2 the hooks: data-legal and the sheet dismiss, never data-btn', () => {
  const html = legalPageHtml('privacy');
  for (const k of Object.keys(PAGES)) assert.match(html, new RegExp(`data-legal="${k}"`));
  assert.equal([...html.matchAll(/data-sheet-dismiss/g)].length, 2, 'the scrim and the ✕');
  assert.doesNotMatch(html, /data-btn=/, 'a data-btn would reach main.ts as well');
});

test('1073 §3 About says it is unofficial; an unknown page draws nothing', () => {
  assert.ok(legalPageHtml('about').includes(UNOFFICIAL));
  assert.equal(legalPageHtml('nope'), '');
});
