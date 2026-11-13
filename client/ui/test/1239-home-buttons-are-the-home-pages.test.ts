/* 1239 — THE HOME SCREEN'S BUTTONS ARE THE HOME PAGE'S (BL-63, the design-
 * system round's last TODO(ds) split on the home, 2026-11-13).
 *
 * main.ts handlePregameButton held the home screen's buttons, because they
 * wrote main.ts state: the element pick (`ui.homeEls`, `ui.homeFixedTrio`, in
 * its UiState) and the error line (`uiError`). The pick is pages/home.ts state
 * now — nothing but the home read it — and the error line and the repaints are
 * lent by main.ts as a host (HomeButtonHost). The waiting rooms' buttons stay in
 * main.ts (handleRoomButton): they drive the connection.
 *
 * §1 main.ts handles none of the home's buttons and holds no element pick;
 *    pages/home.ts handleHomeButton handles each one, and main.ts's click
 *    handler reaches it before the room's and the board's
 * §2 driven: the pick is read from this browser at boot (a stale entry
 *    filtered out), Pick now and a chip write it back, and the chips draw it
 * §3 driven: a Create room the server refuses says why on the home screen —
 *    the host's error line — and one it accepts opens the room, with the pick
 *
 * Titles carry no apostrophes: ledger guards cite them by substring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
// a pick saved by an older client: an unknown element and a repeat
g['__UI_DRIVER_STORE'] = { algoEls: JSON.stringify(['wood', 'aether', 'wood', 'fire']) };
let answer: { ok: boolean; body: Record<string, unknown> } = { ok: false, body: { error: 'too many bans for a 7-card pack' } };
g['__UI_DRIVER_FETCH'] = (url: string) => url === '/api/new'
  ? Promise.resolve({ ok: answer.ok, json: async () => answer.body })
  : new Promise(() => {});
const { home } = await import('./ui-driver.ts');
const hp = await import('../pages/home.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

const read = (f: string): string => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
/** every button the home screen's handler answers */
const HOME_BTNS = ['home-mode', 'home-format', 'home-els', 'home-sheet', 'home-sheet-close', 'eltoggle', 'elrandom',
  'clockpick', 'newgame', 'deckimporturl', 'deckimporttext', 'joincode'];

test('1239 §1 main.ts handles none of the home buttons and holds no element pick', () => {
  const main = read('main.ts');
  const page = read('pages/home.ts');
  const handler = page.slice(page.indexOf('export function handleHomeButton('));
  assert.ok(handler.length > 1000, 'positive control: pages/home.ts has handleHomeButton');
  for (const b of HOME_BTNS) {
    assert.doesNotMatch(main, new RegExp(`b === '${b}'`), `main.ts answers ${b} again`);
    assert.match(handler, new RegExp(`b === '${b}'`), `pages/home.ts handleHomeButton does not answer ${b}`);
  }
  assert.match(handler, /crp\.handlePanelButton\(b, btn\)/, 'the Custom rules rows are the home handler\'s too');
  assert.doesNotMatch(main, /homeEls|homeFixedTrio|'algoEls'/, 'main.ts holds the element pick again');
  // the room's buttons are still main.ts's, and the click handler asks the home first
  for (const b of ['deckjoin', 'singlejoin', 'gohome', 'copylink']) assert.match(main, new RegExp(`b === '${b}'`));
  assert.match(main, /if \(handleHomeButton\(b, btn, HOME_HOST\) \|\| handleRoomButton\(b, btn\)\) return;/);
});

test('1239 §2 the element pick is read at boot, written by Pick now and a chip, and drawn', () => {
  assert.deepEqual(hp.homePick().els, ['wood', 'fire'], 'the saved pick, an unknown element and the repeat dropped');
  assert.equal(hp.homePick().fixedOpen, false, 'first paint: chosen in the room');
  let html = ui.click({ btn: 'home-els', pick: 'now' });
  assert.equal(hp.homePick().fixedOpen, true);
  assert.match(html, /class="elchip wood on"/);
  assert.match(html, /class="elchip fire on"/);
  html = ui.click({ btn: 'eltoggle', el: 'water' });
  assert.deepEqual(JSON.parse(localStorage.getItem('algoEls') ?? ''), ['wood', 'fire', 'water'], 'the chip is saved');
  assert.match(html, /class="elchip water on"/, 'and drawn');
  html = ui.click({ btn: 'eltoggle', el: 'wood' });
  assert.deepEqual(JSON.parse(localStorage.getItem('algoEls') ?? ''), ['fire', 'water'], 'a second press takes it off');
  assert.doesNotMatch(html, /class="elchip wood on"/);
  ui.click({ btn: 'elrandom' });
  const rolled = JSON.parse(localStorage.getItem('algoEls') ?? '') as string[];
  assert.equal(new Set(rolled).size, 3, `the die picks three different elements: ${rolled.join(', ')}`);
  assert.deepEqual(hp.homePick().els, rolled);
});

test('1239 §3 a refused Create room says why on the home screen, an accepted one opens the room', async () => {
  ui.click({ btn: 'home-mode', mode: 'draft' });
  ui.click({ btn: 'newgame', mode: 'draft' });
  await flush();
  assert.match(ui.html(), /too many bans for a 7-card pack/, 'the server\'s reason is drawn on the home');
  answer = { ok: true, body: { code: 'H239' } };
  ui.click({ btn: 'newgame', mode: 'draft' });
  await flush();
  // Pick now is still on from §2, so the picked trio rides the creating link
  const els = encodeURIComponent(hp.homePick().els.join(','));
  assert.equal(String((g['location'] as { search: string }).search), `?ws=1&room=H239&seat=0&mode=draft&els=${els}&clock=3600000`);
});
