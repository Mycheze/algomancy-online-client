/* 1070 · ui/components/setting-row.ts — the label escaped on the left, the
 * control and its hint (trusted markup) on the right, the hint left out when
 * there is none, and the shared pass-through (className, data-btn, attrs). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingRow } from '../components/setting-row.ts';

test('label | control, then the hint under the control', () => {
  assert.equal(settingRow({ label: 'Clock', controlHtml: '<b>c</b>', hintHtml: '60m <i>each</i>' }),
    '<div class="ui-setting-row"><div class="ui-setting-row__label">Clock</div>\n'
    + '    <div class="ui-setting-row__control"><b>c</b><div class="ui-setting-row__hint">60m <i>each</i></div></div></div>');
});

test('no hint, no hint line; the label is text, escaped', () => {
  const html = settingRow({ label: 'Best <of>', controlHtml: 'x' });
  assert.doesNotMatch(html, /__hint/);
  assert.match(html, /<div class="ui-setting-row__label">Best &lt;of&gt;<\/div>/);
});

test('className, data-btn and attrs reach the root', () => {
  assert.match(settingRow({ label: 'Deck', controlHtml: '', className: 'qrow', dataBtn: 'b', attrs: { 'data-k': 'deck' } }),
    /^<div class="ui-setting-row qrow" data-btn="b" data-k="deck">/);
});
