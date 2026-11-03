/* 946 · ui/components/back-link.ts */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACK_LINK_VARIANTS, backLink } from '../components/back-link.ts';

test('the default is the green "Return to Lobby"; every variant renders', () => {
  assert.equal(backLink({ dataBtn: 'acct-close' }),
    '<button class="ui-button ui-button--primary ui-back-link" data-btn="acct-close" type="button">Return to Lobby</button>');
  for (const variant of BACK_LINK_VARIANTS) assert.match(backLink({ dataBtn: 'b', variant }), new RegExp(`ui-button--${variant} ui-back-link`));
});

test('the arrow, an escaped label, the pass-throughs', () => {
  const html = backLink({ dataBtn: 'queue-home', label: 'home <now>', arrow: true, size: 'sm', className: 'qback', title: 'to the home screen' });
  assert.match(html, /class="ui-button ui-button--primary ui-button--sm ui-back-link qback" data-btn="queue-home"/);
  assert.match(html, /<span class="ui-back-link__arrow" aria-hidden="true">←<\/span> home &lt;now&gt;<\/button>$/);
  assert.match(html, /title="to the home screen"/);
});
