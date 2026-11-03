/* 944 · ui/components/panel.ts */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PANEL_VARIANTS, panel } from '../components/panel.ts';

test('every variant; a titled panel is a section, an untitled one a div', () => {
  for (const variant of PANEL_VARIANTS) {
    assert.match(panel({ variant, bodyHtml: '<p>x</p>' }), new RegExp(`^<div class="ui-panel ui-panel--${variant}"><p>x</p></div>$`));
  }
  assert.match(panel({ title: 'Stats', bodyHtml: '<p>x</p>' }), /^<section class="ui-panel ui-panel--default"><h3 class="ui-panel__title">Stats<\/h3><p>x<\/p><\/section>$/);
  assert.match(panel({ tag: 'aside' }), /^<aside /);
});

test('roomy, wide, escaping, pass-through', () => {
  const html = panel({ title: '<Me>', roomy: true, wide: true, dataBtn: 'p', className: 'acctcard' });
  assert.match(html, /class="ui-panel ui-panel--default ui-panel--roomy ui-panel--wide acctcard" data-btn="p"/);
  assert.ok(html.includes('&lt;Me&gt;'));
});
