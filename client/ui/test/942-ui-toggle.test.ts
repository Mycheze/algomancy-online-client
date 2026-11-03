/* 942 · ui/components/toggle.ts — the pressed state is the class `on` (which
 * tests and the ui-driver read) and aria-pressed; strong is the bold one. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggle } from '../components/toggle.ts';

test('off and on', () => {
  const off = toggle({ label: 'Mine', on: false, dataBtn: 'ms-mine' });
  assert.match(off, /^<button class="ui-button ui-button--secondary ui-toggle" data-btn="ms-mine" type="button" aria-pressed="false">Mine<\/button>$/);
  const on = toggle({ label: 'Mine', on: true, strong: true, dataBtn: 'ms-mine' });
  assert.match(on, /class="ui-button ui-button--secondary ui-toggle ui-toggle--strong on"/);
  assert.match(on, /aria-pressed="true"/);
});

test('escapes, passes through, small size', () => {
  const html = toggle({ label: '<x>', on: false, size: 'sm', attrs: { 'data-k': 1 }, title: 'a & b' });
  assert.ok(html.includes('&lt;x&gt;') && !html.includes('<x>'));
  assert.match(html, /ui-button--sm/);
  assert.match(html, /data-k="1"/);
  assert.match(html, /title="a &amp; b"/);
});
