/* 1224 — THE ALERTS BUTTON SHOWS PRESSED WHILE ITS LIST IS OPEN (BL-63).
 *
 * Every toolbar button whose panel is open is drawn pressed (`on`, gold, and
 * aria-pressed) — the home's signed-out Alerts, which opens a sheet, already
 * was. The signed-in Alerts opens the notifications list (ui/inbox.ts), and
 * nothing told the toolbar: the frame passed no `on`, and a click on the bell
 * repaints only the inbox's own layer, never the page under it.
 *
 *  §1 drawn: toolsHtml / frameHtml draw Alerts pressed exactly when chrome says the list is open
 *  §2 clicked: on the home, opening the list presses Alerts in place, closing it (bell or a click elsewhere) lets go
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountByName, privateView, register, useAccountsFile } from '../../server/accounts.ts';
import { frameHtml, toolsHtml, PAGE_TOOLS, TOOL_NAMES } from '../pages/frame.ts';

const alertsBtn = (h: string): string => {
  const m = /<button[^>]*data-inbox="bell"[^>]*>/.exec(h);
  assert.ok(m, 'there is an Alerts button');
  return m[0];
};

test('1224 §1 the toolbar draws Alerts pressed exactly while the list is open', () => {
  const open = alertsBtn(toolsHtml({ signedIn: true, alerts: 2, alertsOpen: true }, TOOL_NAMES));
  assert.match(open, /class="ui-icon-button ui-icon-button--stack on homealerts"/);
  assert.match(open, /aria-pressed="true"/);
  const shut = alertsBtn(toolsHtml({ signedIn: true, alerts: 2, alertsOpen: false }, TOOL_NAMES));
  assert.doesNotMatch(shut, / on /);
  assert.match(shut, /aria-pressed="false"/);
  // absent (a story, a test) is shut
  assert.match(alertsBtn(toolsHtml({ signedIn: true, alerts: 0 }, PAGE_TOOLS)), /aria-pressed="false"/);
  // every page in the frame carries the same tool
  const page = frameHtml({ page: 'x', title: 'X', back: { dataBtn: 'b', label: 'Home' }, chrome: { signedIn: true, alerts: 0, alertsOpen: true }, mainHtml: '' });
  assert.match(alertsBtn(page), /ui-icon-button--stack on homealerts[^>]*aria-pressed="true"/);
});

/* ── §2: the real client ─────────────────────────────────────────────── */

// a real account's profile, as /api/me sends it
const dir = mkdtempSync(join(tmpdir(), 'algo-1224-'));
const restoreAccounts = useAccountsFile(join(dir, 'accounts.json'));
test.after(() => { restoreAccounts(); rmSync(dir, { recursive: true, force: true }); });
assert.ok(register('Quil', 'correct horse battery').ok);
const QUIL = accountByName('Quil')!;

const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't1224' };
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url === '/api/inbox' || url.startsWith('/api/inbox?')) {
    return { ok: true, status: 200, json: async () => ({ ok: true, invites: [], requests: [], league: [], times: [], friends: [], decks: [] }) };
  }
  if (url === '/api/me') {
    return { ok: true, status: 200, json: async () => ({ ok: true, me: privateView(QUIL, () => false) }) };
  }
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const { inboxListOpen } = await import('../inbox.ts');
const { reloadMe } = await import('../account.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
await flush();

/* the harness's document has no element lookup by selector: stand one
 * pressable button in for the page's Alerts, and see what the inbox does to it */
const pressed = { on: false, aria: '' };
const BELL = {
  classList: { toggle: (c: string, force: boolean) => { if (c === 'on') pressed.on = force; } },
  setAttribute: (k: string, v: string) => { if (k === 'aria-pressed') pressed.aria = v; },
};
const doc = g['document'] as Record<string, unknown>;
const before = doc['querySelectorAll'];
doc['querySelectorAll'] = (sel: string) => (sel === '.ui-icon-button[data-inbox="bell"]' ? [BELL] : []);

test('1224 §2 opening the list presses Alerts in place; closing it lets go', async () => {
  assert.equal(inboxListOpen(), false);
  // the selector the inbox patches is the one the toolbar's Alerts answers to
  assert.match(alertsBtn(ui.html()), /<button class="ui-icon-button[^"]*homealerts"[^>]*aria-pressed="false"/, 'signed in: Alerts is the bell');
  ui.click({ inbox: 'bell' });
  assert.equal(inboxListOpen(), true, 'the list is open');
  assert.deepEqual(pressed, { on: true, aria: 'true' }, 'Alerts is pressed while it is');
  // the home repainting under the open list (a profile push) draws it pressed too
  reloadMe();
  await flush();
  assert.equal(inboxListOpen(), true);
  assert.match(alertsBtn(ui.html()), / on homealerts"[^>]*aria-pressed="true"/, 'a repaint keeps it pressed');
  ui.click({ inbox: 'bell' });
  assert.equal(inboxListOpen(), false);
  assert.deepEqual(pressed, { on: false, aria: 'false' }, 'the bell again closes it and lets go');
  reloadMe();
  await flush();
  assert.match(alertsBtn(ui.html()), /homealerts"[^>]*aria-pressed="false"/, 'and the next repaint agrees');
  ui.click({ inbox: 'bell' });
  assert.deepEqual(pressed, { on: true, aria: 'true' });
  // a click anywhere else closes the list, as a menu would
  ui.click({ btn: 'home-sheet' });
  assert.equal(inboxListOpen(), false);
  assert.deepEqual(pressed, { on: false, aria: 'false' }, 'a click elsewhere lets go');
  doc['querySelectorAll'] = before;
});
