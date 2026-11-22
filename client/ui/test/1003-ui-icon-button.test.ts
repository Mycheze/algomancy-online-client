/* 1003 · ui/components/icon-button.ts — the toolbar button: icon + caption,
 * both layouts, the badge (count, 99+, dot, hidden at 0), on, disabled, href,
 * escaping and pass-through. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ICON_BUTTON_LAYOUTS, iconButton, iconButtonBadge, iconButtonName } from '../components/icon-button.ts';
import { icon } from '../components/icon.ts';

test('a stack button: the icon, then the caption', () => {
  const html = iconButton({ label: 'Decks', icon: 'decks', dataBtn: 'nav-decks' });
  assert.equal(html, `<button class="ui-icon-button ui-icon-button--stack" data-btn="nav-decks" type="button">`
    + `<span class="ui-icon-button__icon">${icon('decks')}</span><span class="ui-icon-button__label">Decks</span></button>`);
  for (const layout of ICON_BUTTON_LAYOUTS) {
    assert.match(iconButton({ label: 'x', icon: 'play', layout }), new RegExp(`class="ui-icon-button ui-icon-button--${layout}"`));
  }
});

test('the badge: a count, 99+, a dot, nothing at 0 / false / undefined / nonsense', () => {
  assert.match(iconButton({ label: 'Alerts', icon: 'alerts', badge: 3 }), /<span class="ui-icon-button__badge">3<\/span><\/span><span class="ui-icon-button__label">/);
  assert.equal(iconButtonBadge(140), '<span class="ui-icon-button__badge">99+</span>');
  assert.equal(iconButtonBadge(99), '<span class="ui-icon-button__badge">99</span>');
  assert.equal(iconButtonBadge('dot'), '<span class="ui-icon-button__badge ui-icon-button__badge--dot"></span>');
  assert.equal(iconButtonBadge(true), iconButtonBadge('dot'));
  for (const none of [0, false, undefined, -1, Number.NaN]) assert.equal(iconButtonBadge(none), '', String(none));
  assert.ok(!iconButton({ label: 'Alerts', icon: 'alerts', badge: 0 }).includes('__badge'));
});

test('on: the class `on` and aria-pressed; left out, no aria-pressed at all', () => {
  const on = iconButton({ label: 'Rules', icon: 'rules', on: true });
  assert.match(on, /class="ui-icon-button ui-icon-button--stack on"/);
  assert.match(on, /aria-pressed="true"/);
  assert.match(iconButton({ label: 'Rules', icon: 'rules', on: false }), /aria-pressed="false"/);
  assert.ok(!iconButton({ label: 'Rules', icon: 'rules' }).includes('aria-pressed'));
});

test('disabled, title, href (a link, aria-current when on)', () => {
  const dis = iconButton({ label: 'Test', icon: 'test', disabled: true, title: 'Sign in first' });
  assert.match(dis, / title="Sign in first" disabled>/);
  const a = iconButton({ label: 'Buy', icon: 'link', href: 'https://x.test/?a=1&b=2', on: true, layout: 'inline' });
  assert.match(a, /^<a class="ui-icon-button ui-icon-button--inline on" href="https:\/\/x\.test\/\?a=1&amp;b=2" aria-current="page">/);
  assert.ok(a.endsWith('</a>') && !a.includes('aria-pressed') && !a.includes('type='));
});

test('escapes the caption; iconHtml is trusted; className and attrs pass through', () => {
  const html = iconButton({ label: '<b>me</b>', iconHtml: '<img src="a.png" alt="">', className: 'acct', attrs: { 'data-seat': 1 } });
  assert.ok(html.includes('&lt;b&gt;me&lt;/b&gt;') && !html.includes('<b>'));
  assert.match(html, /<span class="ui-icon-button__icon"><img src="a\.png" alt=""><\/span>/);
  assert.match(html, /class="ui-icon-button ui-icon-button--stack acct"/);
  assert.match(html, /data-seat="1"/);
});

test('a number badge is spoken in the button\'s name, with what it counts', () => {
  assert.match(iconButton({ label: 'Alerts', icon: 'alerts', badge: 3, badgeName: 'unread' }), /<button class="[^"]*" type="button" aria-label="Alerts, 3 unread">/);
  assert.match(iconButton({ label: 'Alerts', icon: 'alerts', badge: 3 }), /aria-label="Alerts, 3"/, 'no noun: the count alone');
  assert.equal(iconButtonName('Alerts', 140, 'unread'), 'Alerts, more than 99 unread', '99+ is not read as "99 plus"');
  for (const quiet of [0, 'dot', true, false, undefined] as const) {
    assert.equal(iconButtonName('Alerts', quiet, 'unread'), 'Alerts', String(quiet));
    assert.doesNotMatch(iconButton({ label: 'Alerts', icon: 'alerts', badge: quiet, badgeName: 'unread' }), /aria-label/, `${String(quiet)}: the caption is the name`);
  }
  assert.match(iconButton({ label: 'Home <x>', labelHtml: '<b>Home</b>', icon: 'home', badge: 2, badgeName: 'new' }), /aria-label="Home &lt;x&gt;, 2 new"/, 'escaped, beside labelHtml');
});
