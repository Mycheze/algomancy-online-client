/* 1011 — THE NEW HOME'S TABS AND SHEETS, DRIVEN (client/docs/24-redesign/, 2026-11-03).
 *
 * The home screen is painted by the real ui/main.ts (no room in the URL) and
 * clicked through its real handler (pages/home.ts handleHomeButton's home-* switches).
 *
 * §1 Draft | Constructed and Casual | Competitive are REMEMBERED (algoHomeMode,
 *    algoHomeFormat — legal.ts BROWSER_KEYS lists both); first visit: Draft
 * §2 Elements: "Choose in the room" | "Pick now" is the old fixed-trio fold
 * §3 a sheet opens from its button, survives a repaint, and closes by its ✕ /
 *    scrim (home-sheet-close) or by Esc — and Esc with no sheet open is left
 *    alone for whatever else wants it
 * §4 a button in a sheet that leads somewhere else closes the sheet first, so
 *    coming back does not find it still up; the sheet's own controls keep it
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
const { home } = await import('./ui-driver.ts');
const hp = await import('../pages/home.ts');
const ui = home();

const sheetOpen = (html: string): string | null => /<div class="ui-sheet [^"]*" id="([^"]+)"/.exec(html)?.[1] ?? null;

test('1011 §1 the Play tab and the format are remembered; first visit is Draft, Casual', () => {
  assert.equal(localStorage.getItem('algoHomeMode'), null, 'positive control: a first visit');
  let html = ui.html();
  assert.match(html, /data-btn="home-mode"[^>]*aria-pressed="true"[^>]*data-mode="draft"/);
  html = ui.click({ btn: 'home-mode', mode: 'constructed' });
  assert.equal(localStorage.getItem('algoHomeMode'), 'constructed');
  assert.match(html, /data-btn="home-mode"[^>]*aria-pressed="true"[^>]*data-mode="constructed"/);
  assert.match(html, /data-btn="home-format"[^>]*aria-pressed="true"[^>]*data-format="casual"/);
  html = ui.click({ btn: 'home-format', format: 'competitive' });
  assert.equal(localStorage.getItem('algoHomeFormat'), 'competitive');
  assert.match(html, /Competitive matches need an account/, 'signed out, it says so');
  // a value that is not a tab changes nothing
  hp.setHomeMode('nonsense');
  assert.equal(hp.homeMode(), 'constructed');
  ui.click({ btn: 'home-format', format: 'casual' });
  html = ui.click({ btn: 'home-mode', mode: 'draft' });
  assert.equal(hp.homeMode(), 'draft');
  assert.match(html, /data-btn="clockpick"[^>]*data-clockfor="draft"/);
});

test('1011 §2 Elements: Pick now shows the chips, Choose in the room hides them', () => {
  let html = ui.click({ btn: 'home-els', pick: 'now' });
  assert.equal((html.match(/data-btn="eltoggle"/g) ?? []).length, 7);
  assert.match(html, /data-els="1"/, 'Create room carries the fixed elements');
  const fireOn = (h: string): boolean => /class="elchip fire on"/.test(h);
  const before = fireOn(html);
  html = ui.click({ btn: 'eltoggle', el: 'fire' });
  assert.notEqual(fireOn(html), before, 'the chip did not toggle');
  html = ui.click({ btn: 'home-els', pick: 'room' });
  assert.doesNotMatch(html, /data-btn="eltoggle"|data-els="1"/);
  // owner 2026-11-14: "'Elements' don't need reminder text"
  assert.doesNotMatch(html, /elements in the room/);
});

test('1011 §3 a sheet opens, survives a repaint, closes by its button or by Esc', () => {
  assert.equal(sheetOpen(ui.html()), null);
  let html = ui.click({ btn: 'home-sheet', sheet: 'join' });
  assert.equal(sheetOpen(html), 'home-join');
  assert.match(html, /id="h-code"/);
  assert.equal(hp.openSheet(), 'join');
  // a repaint the player did not ask for (a poll, a friend online) draws it
  // again: here a button from under the sheet (the driver has no scrim)
  html = ui.click({ btn: 'clockpick', ms: 'auto' });
  assert.equal(sheetOpen(html), 'home-join', 'a repaint closed the sheet');
  html = ui.click({ btn: 'home-sheet-close' });
  assert.equal(sheetOpen(html), null, 'the ✕ / scrim closes it');
  // Esc — on the Game values sheet, whose button is behind More settings (2026-11-14)
  ui.click({ btn: 'home-more' });
  ui.click({ btn: 'home-sheet', sheet: 'rules' });
  html = ui.key('Escape');
  assert.equal(sheetOpen(html), null, 'Esc does not close the sheet');
  assert.equal(hp.openSheet(), null);
  // with nothing open Esc is not taken (installSheetEsc leaves the default alone)
  assert.equal(hp.closeHomeSheet(), false);
  assert.equal(hp.openHomeSheet('no-such-sheet'), false, 'an unknown sheet opens nothing');
});

test('1011 §4 a button that leads elsewhere closes the sheet; the sheet\'s own controls keep it', () => {
  ui.click({ btn: 'home-mode', mode: 'constructed' });
  let html = ui.click({ btn: 'home-sheet', sheet: 'single' });
  assert.equal(sheetOpen(html), 'home-single');
  html = ui.click({ btn: 'sc-random' });
  assert.equal(hp.openSheet(), 'single', 'a pick in the sheet keeps it open');
  ui.click({ btn: 'meta-ladder' });
  assert.equal(hp.openSheet(), null, 'the card ladder is another page: the sheet must not wait for the way back');
  ui.click({ btn: 'meta-close' });
  // the info sheet's legal pages are a layer over the page, not a page
  ui.click({ btn: 'home-sheet', sheet: 'info' });
  assert.equal(hp.openSheet(), 'info');
  html = ui.click({ legal: 'about' });
  assert.equal(hp.openSheet(), null, 'About opened UNDER the info sheet');
  assert.equal(sheetOpen(html), null, 'a layer button repaints the home without the sheet');
  ui.click({ btn: 'home-mode', mode: 'draft' });
});
