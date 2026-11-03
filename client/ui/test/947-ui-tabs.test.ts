/* 947 · ui/components/tabs.ts — the current tab is `on` and aria-selected,
 * every tab carries data-tab and the row's data-btn (or its own). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TABS_VARIANTS, tabs } from '../components/tabs.ts';

const items = [{ id: 'stats', label: 'Stats' }, { id: 'friends', label: 'Friends <3>', count: 4 }, { id: 'admin', label: 'Admin', dataBtn: 'nav-admin' }];

test('a tablist; the active tab is on; data-btn and data-tab on each', () => {
  const html = tabs({ items, active: 'friends', dataBtn: 'acct-tab', label: 'Profile' });
  assert.match(html, /^<div class="ui-tabs ui-tabs--plain" role="tablist" aria-label="Profile">/);
  assert.match(html, /<button class="ui-button ui-button--secondary ui-tabs__tab" data-btn="acct-tab" data-tab="stats" type="button" role="tab" aria-selected="false">Stats<\/button>/);
  assert.match(html, /class="ui-button ui-button--secondary ui-tabs__tab on" data-btn="acct-tab" data-tab="friends"[^>]*aria-selected="true">Friends &lt;3&gt; <span class="ui-tabs__count">4<\/span>/);
  assert.match(html, /data-btn="nav-admin" data-tab="admin"/);
  assert.equal((html.match(/ on"/g) ?? []).length, 1);
});

test('every variant', () => {
  for (const variant of TABS_VARIANTS) assert.match(tabs({ items, active: 'stats', variant }), new RegExp(`^<div class="ui-tabs ui-tabs--${variant}"`));
});
