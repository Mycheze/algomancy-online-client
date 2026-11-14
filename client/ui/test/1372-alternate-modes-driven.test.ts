/* 1372 — ALTERNATE MODES, DRIVEN (owner, 2026-11-14: "Instead of 'Mode', there should be one (at the
 * bottom) called 'Alternate modes' with Standard default selected. If Beginner is selected, it sets
 * the settings for beginner. If Cube draft is selected, it greys out everything else, and the start
 * button says 'Host a Cube draft'"). The real ui/main.ts and its real handler.
 *
 * §1 Standard first; Beginner is the old Mode row's Beginner — the same preset (Fire + Wood picked
 *    now, simple cards, packs of 5) and the same persistence (the custom rules' own key)
 * §2 Cube draft greys the rest out (disabled, still drawn) and the button is Host a Cube draft; a
 *    click on a greyed control changes nothing
 * §3 Standard or Beginner from Cube draft is that mode again, with Create room
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_FETCH'] = () => new Promise(() => {});
const { home } = await import('./ui-driver.ts');
const crp = await import('../customrulespanel.ts');
const ui = home();
const on = (h: string): string | null =>
  /<div class="ui-setting-row__label">Alternate modes<\/div>[^]*?class="ui-segmented__option on"[^>]*data-value="(\w+)"/.exec(h)?.[1] ?? null;
const fieldsetOpen = (h: string): string => /<fieldset class="homerowsset"[^>]*>/.exec(h)?.[0] ?? '';

test('1372 §1 Standard first; Beginner is the old Beginner', () => {
  let html = ui.html();
  assert.equal(on(html), 'standard', 'positive control: a first visit is Standard');
  assert.equal(localStorage.getItem('algoCustomRules'), null);
  html = ui.click({ btn: 'cr-beginner', on: '1' });
  assert.equal(on(html), 'beginner');
  assert.ok(crp.beginnerOn());
  assert.match(html, /data-btn="home-els"[^>]*aria-pressed="true"[^>]*data-pick="now"/, 'the pair is picked now');
  assert.match(html, /class="elchip fire on"[^]*class="elchip wood on"|class="elchip wood on"[^]*class="elchip fire on"/);
  const kept = JSON.parse(localStorage.getItem('algoCustomRules') ?? 'null') as { elements: number; packSize: number; simpleOnly: boolean } | null;
  assert.deepEqual(kept && { e: kept.elements, p: kept.packSize, s: kept.simpleOnly }, { e: 2, p: 5, s: true }, 'remembered as it always was');
  assert.match(html, /data-btn="newgame"[^>]*data-els="1"[^>]*>Create custom room · Fire \+ Wood</);
});

test('1372 §2 Cube draft greys the rest out and hosts', () => {
  let html = ui.click({ btn: 'home-cube' });
  assert.equal(on(html), 'cube');
  assert.equal(fieldsetOpen(html), '<fieldset class="homerowsset" disabled>');
  assert.match(html, /data-btn="home-cube-host"[^>]*>Host a Cube draft</);
  assert.doesNotMatch(html, /data-btn="newgame"/);
  assert.match(html, /data-btn="clockpick"/, 'greyed out, not hidden');
  assert.doesNotMatch(html, /homemodehint/);
  // the driver clicks whatever it is told to; a browser sends nothing from a disabled
  // fieldset, so here the point is only that Cube draft is not left by an unrelated repaint
  html = ui.click({ btn: 'home-mode', mode: 'draft' });
  assert.equal(on(html), 'cube', 'a repaint left Cube draft');
  html = ui.click({ btn: 'home-mode', mode: 'constructed' });
  assert.doesNotMatch(html, /home-cube|homerowsset/, 'the Constructed tab knows nothing of it');
  html = ui.click({ btn: 'home-mode', mode: 'draft' });
  assert.equal(on(html), 'cube', 'and the Draft tab comes back to it');
});

test('1372 §3 Standard or Beginner from Cube draft', () => {
  let html = ui.click({ btn: 'cr-beginner', on: '1' });
  assert.equal(on(html), 'beginner');
  assert.equal(fieldsetOpen(html), '<fieldset class="homerowsset">', 'the rows are live again');
  assert.match(html, /data-btn="newgame"/);
  ui.click({ btn: 'home-cube' });
  html = ui.click({ btn: 'cr-beginner', on: '0' });
  assert.equal(on(html), 'standard');
  assert.equal(crp.activeRules(), null, 'Standard is the standard game');
  assert.match(html, /data-btn="newgame"[^>]*data-mode="draft">Create room</);
  // Cube draft over a standard game, then Standard: still the standard game, nothing wiped
  ui.click({ btn: 'home-cube' });
  html = ui.click({ btn: 'cr-beginner', on: '0' });
  assert.equal(on(html), 'standard');
  assert.equal(fieldsetOpen(html), '<fieldset class="homerowsset">');
});
