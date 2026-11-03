/* 945 · ui/components/page-header.ts — title, subtitle, actions, and the back link last */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageHeader } from '../components/page-header.ts';

test('title and subtitle escaped; trusted html appended', () => {
  const html = pageHeader({ title: 'Decks & <co>', titleHtml: '<span class="x">!</span>', subtitle: '3 < 4' });
  assert.match(html, /^<header class="ui-page-header"><div class="ui-page-header__titles"><h1 class="ui-page-header__title">Decks &amp; &lt;co&gt; <span class="x">!<\/span><\/h1><div class="ui-page-header__subtitle">3 &lt; 4<\/div><\/div><\/header>$/);
});

test('actions, then the back link last; data-btn passes through', () => {
  const html = pageHeader({ title: 'Cards', actionsHtml: '<button data-btn="r">↻</button>', back: { dataBtn: 'cards-close' }, dataBtn: 'hd' });
  assert.match(html, /^<header class="ui-page-header" data-btn="hd">/);
  assert.match(html, /<div class="ui-page-header__actions"><button data-btn="r">↻<\/button><button class="ui-button ui-button--primary ui-back-link" data-btn="cards-close" type="button">Return to Lobby<\/button><\/div>/);
});

test('no actions, no actions box', () => {
  assert.ok(!pageHeader({ title: 'x' }).includes('__actions'));
});

test('subtitleAs p: the subtitle is a paragraph, with the margin class (league, challenge)', () => {
  const html = pageHeader({ title: 'League', subtitle: 'Week <2>', subtitleAs: 'p' });
  assert.match(html, /<p class="ui-page-header__subtitle ui-page-header__subtitle--p">Week &lt;2&gt;<\/p><\/div><\/header>$/);
  assert.match(pageHeader({ title: 'League', subtitle: 'x' }), /<div class="ui-page-header__subtitle">x<\/div>/, 'the default is the bare line');
  assert.doesNotMatch(pageHeader({ title: 'League', subtitleAs: 'p' }), /<p/, 'no subtitle, no paragraph');
});
