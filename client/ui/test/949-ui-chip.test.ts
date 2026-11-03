/* 949 · ui/components/chip.ts */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHIP_SHAPES, CHIP_TONES, chip } from '../components/chip.ts';

test('every tone and shape; the default is a neutral tag', () => {
  assert.equal(chip({ label: 'early' }), '<span class="ui-chip ui-chip--neutral ui-chip--tag">early</span>');
  for (const tone of CHIP_TONES) for (const shape of CHIP_SHAPES) {
    assert.match(chip({ label: 'x', tone, shape, solid: true }), new RegExp(`^<span class="ui-chip ui-chip--${tone} ui-chip--${shape} ui-chip--solid">`));
  }
});

test('escaping, title, pass-through', () => {
  const html = chip({ label: '<owner>', title: 'conceded "early"', dataBtn: 'c', className: 'constag' });
  assert.match(html, /class="ui-chip ui-chip--neutral ui-chip--tag constag" data-btn="c" title="conceded &quot;early&quot;">&lt;owner&gt;<\/span>/);
});
