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

test('titleHtml after the escaped title, or alone; panelSubheading', async () => {
  const both = panel({ title: 'Nov <league>', titleHtml: '<span class="lgtag">hidden</span>' });
  assert.match(both, /^<section class="ui-panel ui-panel--default"><h3 class="ui-panel__title">Nov &lt;league&gt; <span class="lgtag">hidden<\/span><\/h3><\/section>$/);
  assert.match(panel({ titleHtml: 'Leaderboard <span class="dim">· week 1</span>', bodyHtml: '<p>x</p>' }),
    /^<section class="ui-panel ui-panel--default"><h3 class="ui-panel__title">Leaderboard <span class="dim">· week 1<\/span><\/h3><p>x<\/p><\/section>$/);
  assert.match(panel({ title: 'Plain', titleHtml: '' }), /<h3 class="ui-panel__title">Plain<\/h3>/, 'an empty titleHtml adds no space');
  const { panelSubheading } = await import('../components/panel.ts');
  assert.equal(panelSubheading({ text: 'Week <1>' }), '<h4 class="ui-panel__subheading">Week &lt;1&gt;</h4>');
  assert.equal(panelSubheading({ textHtml: '<b>x</b>', className: 'mine' }), '<h4 class="ui-panel__subheading mine"><b>x</b></h4>');
});
