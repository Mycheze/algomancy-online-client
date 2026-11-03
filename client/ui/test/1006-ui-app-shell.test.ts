/* 1006 · ui/components/app-shell.ts — the three regions in order (a bar given
 * no markup is left out, the main region never is), and shellBar's three zones. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appShell, shellBar } from '../components/app-shell.ts';

test('top, main, bottom — trusted markup, in that order', () => {
  const html = appShell({ topHtml: '<b>t</b>', mainHtml: '<i>m</i>', bottomHtml: '<u>b</u>', className: 'home', dataBtn: 'x', attrs: { 'data-page': 'home' } });
  assert.equal(html, '<div class="ui-app-shell home" data-btn="x" data-page="home">'
    + '<header class="ui-app-shell__top"><b>t</b></header><main class="ui-app-shell__main"><i>m</i></main>'
    + '<footer class="ui-app-shell__bottom"><u>b</u></footer></div>');
});

test('a bar with no markup is left out; the main region is always there', () => {
  const html = appShell({ mainHtml: 'm' });
  assert.equal(html, '<div class="ui-app-shell"><main class="ui-app-shell__main">m</main></div>');
  assert.equal(appShell({}), '<div class="ui-app-shell"><main class="ui-app-shell__main"></main></div>');
});

test('shellBar: start | centre | end, each zone present even when empty', () => {
  assert.equal(shellBar({ startHtml: 'a', endHtml: 'c', className: 'top' }),
    '<div class="ui-app-shell__bar top"><div class="ui-app-shell__zone ui-app-shell__zone--start">a</div>'
    + '<div class="ui-app-shell__zone ui-app-shell__zone--center"></div>'
    + '<div class="ui-app-shell__zone ui-app-shell__zone--end">c</div></div>');
});
