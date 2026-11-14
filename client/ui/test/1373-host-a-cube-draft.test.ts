/* 1373 — "HOST A CUBE DRAFT" OPENS THE NEW EVENT FORM (owner, 2026-11-14: "Clicking it then brings
 * up the settings and everything is normal from there"). Signed in (a stored token); the real
 * ui/main.ts, the real home handler, the real cube page (ui/cube.ts).
 *
 * §1 Cube draft, then Host: the cube page owns #app with its New cube event form open
 * §2 from there it is the cube page as ever: the form's ✕ leaves the event list
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 'tok1' };
g['__UI_DRIVER_FETCH'] = () => new Promise(() => {});
const { home } = await import('./ui-driver.ts');
const ui = home();

test('1373 §1 Host a Cube draft opens the New event form', () => {
  let html = ui.html();
  assert.match(html, /homepage"/, 'positive control: the home');
  assert.doesNotMatch(html, /cubepage/);
  html = ui.click({ btn: 'home-cube' });
  html = ui.click({ btn: 'home-cube-host' });
  assert.match(html, /class="[^"]*cubepage"/, 'the cube page owns #app');
  assert.match(html, /<div class="ui-sheet [^"]*" id="cube-form"/, 'the form is open');
  assert.match(html, /New cube event/);
});

test('1373 §2 then it is the cube page as ever', () => {
  const html = ui.click({ btn: 'cube-sheet-close' });
  assert.doesNotMatch(html, /id="cube-form"/);
  assert.match(html, /data-btn="cube-new"[^>]*>New event</, 'the event list, with its own New event');
});
