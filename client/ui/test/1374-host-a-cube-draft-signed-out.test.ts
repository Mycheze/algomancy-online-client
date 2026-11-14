/* 1374 — "HOST A CUBE DRAFT" SIGNED OUT: a cube event hangs off accounts, so the button opens the
 * cube page, which says to sign in — no form for an event nobody could host.
 *
 * §1 signed out, Cube draft is still a choice and Host still goes to the cube page
 * §2 that page asks for a sign-in and draws no form
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_FETCH'] = () => new Promise(() => {});
const { home } = await import('./ui-driver.ts');
const ui = home();

test('1374 §1 signed out, Host still goes to the cube page', () => {
  let html = ui.click({ btn: 'home-cube' });
  assert.match(html, /id="h-name"/, 'positive control: signed out (the name box)');
  assert.match(html, /data-btn="home-cube-host"[^>]*>Host a Cube draft</);
  html = ui.click({ btn: 'home-cube-host' });
  assert.match(html, /class="[^"]*cubepage"/);
});

test('1374 §2 the cube page asks for a sign-in, with no form', () => {
  const html = ui.html();
  assert.match(html, /Sign in to make a cube event or join one/);
  assert.doesNotMatch(html, /id="cube-form"/);
});
