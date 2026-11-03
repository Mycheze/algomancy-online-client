/* 951 · ui/components/empty-state.ts */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../components/empty-state.ts';

test('the boxed default and the bare line', () => {
  assert.equal(emptyState({ text: 'no decks <yet>' }), '<div class="ui-empty-state"><span class="ui-empty-state__text">no decks &lt;yet&gt;</span></div>');
  assert.match(emptyState({ text: 'x', bare: true }), /^<div class="ui-empty-state ui-empty-state--bare">/);
});

test('title escaped, action trusted, pass-through', () => {
  const html = emptyState({ title: 'Nothing & none', text: 'x', actionHtml: '<button data-btn="new">New</button>', dataBtn: 'e' });
  assert.match(html, /^<div class="ui-empty-state" data-btn="e"><strong class="ui-empty-state__title">Nothing &amp; none<\/strong>/);
  assert.match(html, /<button data-btn="new">New<\/button><\/div>$/);
});
