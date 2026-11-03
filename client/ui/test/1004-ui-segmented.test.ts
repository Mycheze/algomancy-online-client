/* 1004 · ui/components/segmented.ts — one button per option, each with its
 * OWN data-btn and attrs (the pages route `clockpick` with `data-ms`), `on` +
 * aria-pressed on the chosen one, role="group" on the root. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEGMENTED_SIZES, segmented } from '../components/segmented.ts';

const CLOCK = [['Off', 0], ['20m', 1_200_000], ['40m', 2_400_000], ['60m', 3_600_000]] as const;

test('the root is a named group; each option a button with its own data-btn and attrs', () => {
  const html = segmented({
    ariaLabel: 'Clock', dataBtn: 'g',
    options: CLOCK.map(([label, ms], i) => ({ label, value: String(ms), on: i === 1, dataBtn: 'clockpick', attrs: { 'data-ms': ms } })),
  });
  assert.match(html, /^<div class="ui-segmented" data-btn="g" role="group" aria-label="Clock">/);
  const opts = [...html.matchAll(/<button [^>]*>[^<]*<\/button>/g)].map(m => m[0]);
  assert.equal(opts.length, 4);
  assert.equal(opts[0], '<button class="ui-segmented__option" data-btn="clockpick" type="button" data-value="0" aria-pressed="false" data-ms="0">Off</button>');
  assert.equal(opts[1], '<button class="ui-segmented__option on" data-btn="clockpick" type="button" data-value="1200000" aria-pressed="true" data-ms="1200000">20m</button>');
  for (const [i, [, ms]] of CLOCK.entries()) assert.match(opts[i]!, new RegExp(`data-ms="${ms}"`));
});

test('per-option disabled, title, className and a data-btn given in attrs', () => {
  const html = segmented({
    options: [
      { label: 'Bo1', value: '1', on: true, title: 'One game', className: 'first' },
      { label: 'Bo3', value: '3', on: false, disabled: true, attrs: { 'data-btn': 'bestof', 'data-n': 3 } },
    ],
  });
  assert.match(html, /<button class="ui-segmented__option on first" type="button" data-value="1" aria-pressed="true" title="One game">Bo1<\/button>/);
  assert.match(html, /<button class="ui-segmented__option" data-btn="bestof" type="button" data-value="3" aria-pressed="false" disabled data-n="3">Bo3<\/button>/);
});

test('escapes labels and values; size and full', () => {
  const html = segmented({ options: [{ label: '<Draft>', value: 'a"b', on: false }], size: 'sm', full: true, className: 'mode' });
  assert.ok(html.includes('&lt;Draft&gt;') && !html.includes('<Draft>'));
  assert.match(html, /data-value="a&quot;b"/);
  assert.match(html, /^<div class="ui-segmented ui-segmented--sm ui-segmented--full mode" role="group">/);
  for (const size of SEGMENTED_SIZES) assert.match(segmented({ options: [], size }), /^<div class="ui-segmented[ "]/);
});
