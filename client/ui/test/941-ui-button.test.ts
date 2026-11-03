/* 941 · ui/components/button.ts — every variant and size renders its class,
 * text is escaped, data-btn and the pass-throughs arrive, an icon button
 * cannot be made without its accessible name. DOM-free (components are pure). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUTTON_SIZES, BUTTON_VARIANTS, button, buttonClasses } from '../components/button.ts';

const NASTY = '<img src=x onerror="alert(1)">&';

test('every variant renders a <button> with its modifier; secondary is the default', () => {
  assert.ok(BUTTON_VARIANTS.length >= 7);
  for (const variant of BUTTON_VARIANTS) {
    const html = button({ label: 'Go', variant, title: 'go' });
    assert.match(html, new RegExp(`^<button class="ui-button ui-button--${variant}"`), html);
    assert.match(html, /type="button"/);
  }
  assert.match(button({ label: 'Go' }), /class="ui-button ui-button--secondary"/);
  for (const size of BUTTON_SIZES) assert.equal(buttonClasses('primary', size).includes('ui-button--sm'), size === 'sm');
});

test('the label is escaped; labelHtml is trusted', () => {
  const html = button({ label: NASTY });
  assert.ok(!html.includes('<img'), html);
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;'), html);
  assert.match(button({ labelHtml: '<b>2</b>' }), /><b>2<\/b><\/button>$/);
});

test('data-btn, className and attrs pass through, escaped', () => {
  const html = button({ label: 'x', dataBtn: 'acct-close', className: 'mine', attrs: { 'data-tab': 'a"b', hidden: true, skip: false } });
  assert.match(html, /class="ui-button ui-button--secondary mine" data-btn="acct-close"/);
  assert.match(html, /data-tab="a&quot;b"/);
  assert.match(html, / hidden[ >]/);
  assert.ok(!html.includes('skip'));
  assert.throws(() => button({ label: 'x', attrs: { 'on click': 'x' } }), /not an attribute name/);
});

test('disabled, submit, href', () => {
  assert.match(button({ label: 'x', disabled: true }), / disabled>/);
  assert.match(button({ label: 'x', type: 'submit' }), /type="submit"/);
  const a = button({ label: 'Rules', href: '/rules?a=1&b=2', variant: 'link' });
  assert.match(a, /^<a class="ui-button ui-button--link" href="\/rules\?a=1&amp;b=2">Rules<\/a>$/);
});

test('an icon button needs a title, which is also its aria-label', () => {
  assert.throws(() => button({ label: '✕', variant: 'icon' }), /needs a title/);
  assert.match(button({ label: '↻', variant: 'icon', title: 'reload' }), /title="reload" aria-label="reload"/);
});
