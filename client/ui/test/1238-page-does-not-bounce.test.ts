/* 1238 · ON A PHONE THE PAGE ITSELF DOES NOT BOUNCE (report #388, CT-563, 2026-11-12)
 *
 * mycheze, on a phone: "despite the pages not being scrollable, the whole UI
 * is still able to be dragged and moved vertically, for no reason, like a web
 * page … it always happens on accident." Nothing told the browser not to
 * overscroll the DOCUMENT: `overscroll-behavior` was set only on inner
 * scrollers (the tabletop, the sheet, the deck strip, the builder's pool…),
 * never on html or body. So iOS Safari rubber-banded the whole page on any
 * vertical drag past its end — even a page that fits — and Android Chrome drew
 * its glow and could pull to refresh.
 *
 * The fix stops the OVERSCROLL, not the scroll: below a tablet the app shell
 * lets go and the page scrolls (components/app-shell.css), and a long page must
 * still scroll there.
 *
 *   §1 html and body carry `overscroll-behavior: none`, unconditionally (no
 *      media query), and no later rule hands either of them back a bounce
 *   §2 the root is not made unscrollable instead: no rule hides html's or
 *      body's overflow, and the shell below a tablet still lets the page scroll
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { declarations } from '../scripts/css-scan.mjs';
import { readStyles } from './read-styles.ts';

type Decl = { prop: string; start: number; end: number; selector: string; at: string[] };

const CSS = readStyles();
const DECLS = (declarations(CSS) as { decls: Decl[] }).decls;

/** does this selector list name `el` itself (html or body), bare? */
const names = (selector: string, el: string): boolean =>
  selector.split(',').map(s => s.trim()).includes(el);

const value = (d: Decl): string => CSS.slice(d.start, d.end).trim();

function noBounce(el: string): void {
  const own = DECLS.filter(d => names(d.selector, el) && /^overscroll-behavior(-y)?$/.test(d.prop));
  const always = own.filter(d => d.at.length === 0);
  assert.ok(always.length > 0, `no unconditional overscroll-behavior on ${el} — a phone's browser rubber-bands the document on every vertical drag`);
  for (const d of own) {
    assert.equal(value(d), 'none', `${el} { ${d.prop}: ${value(d)} } gives the page its bounce back`);
  }
}

// the titles are spelled out, not templated: a ledger guard names a test by its literal title
test('§1 html has overscroll-behavior: none outside any media query, so a phone does not drag the whole page', () => noBounce('html'));
test('§1 body has overscroll-behavior: none outside any media query, so a phone does not drag the whole page', () => noBounce('body'));

test('§2 the bounce is stopped without stopping the scroll: the root keeps its overflow, and the shell below a tablet still lets the page scroll', () => {
  for (const el of ['html', 'body']) {
    const hidden = DECLS.filter(d => names(d.selector, el) && /^overflow(-y)?$/.test(d.prop) && /hidden|clip/.test(value(d)));
    assert.deepEqual(hidden.map(d => `${d.selector} { ${d.prop}: ${value(d)} }`), [],
      `${el} must not hide its overflow — a page longer than the phone could no longer scroll`);
  }
  const phone = DECLS.filter(d => d.selector === '.ui-app-shell' && d.prop === 'overflow'
    && d.at.some(a => /max-width:\s*759\.98px/.test(a)));
  assert.equal(phone.length, 1, 'the shell below a tablet sets its overflow once');
  assert.equal(value(phone[0]!), 'visible', 'below a tablet the shell lets go and the page scrolls');
});
