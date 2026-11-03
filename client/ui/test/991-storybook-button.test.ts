/* 991 — THE PROFILE'S "DESIGN (STORYBOOK)" BUTTON (design-system round,
 * 2026-11-03). The owner opens Storybook from the installed web app, which has
 * no URL bar, so it needs a button (every page has one). Driven through the
 * real client (test/ui-driver.ts), fed the server's own privateView:
 *
 *   §1 ⭐ an admin's profile has the button, beside 🛠 Admin
 *   §2 ⭐ a player's profile does not, and neither has a judge's or the owner
 *      badge's without the admin flag: the server (server/storybook.ts) asks
 *      the admin flag, so the button does too
 *   §3 ⭐ clicking it opens the window inside the click, asks
 *      /api/storybook/ticket with the session, and points the window at the
 *      URL the server answered
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountByName, privateView, register, setAdmin, setBadge, useAccountsFile, type Account } from '../../server/accounts.ts';

const dir = mkdtempSync(join(tmpdir(), 'storybook-btn-'));
const restoreAccounts = useAccountsFile(join(dir, 'accounts.json'));
test.after(() => { restoreAccounts(); rmSync(dir, { recursive: true, force: true }); });

for (const n of ['Opsy', 'Playa', 'Judgey']) assert.ok(register(n, 'first password').ok);
const admin = accountByName('Opsy')!;
assert.ok(setAdmin(admin, true));
const player = accountByName('Playa')!;
const judge = accountByName('Judgey')!;
setBadge(judge, { owner: true, judge: 1 });

let who: Account = admin;
const POSTS: { url: string; auth: string | undefined }[] = [];
const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 'tok' };
const reply = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
g['__UI_DRIVER_FETCH'] = (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
  if (url === '/api/me') return reply({ ok: true, me: privateView(who, () => false) });
  if (url === '/api/storybook/ticket' && init?.method === 'POST') {
    POSTS.push({ url, auth: init.headers?.['authorization'] });
    return reply({ ok: true, url: '/storybook/?ticket=T1' });
  }
  return new Promise(() => {});
};
// window.open: the driver's window is globalThis, which has none
const OPENED: { url: string; target: string }[] = [];
const replaced: string[] = [];
const popup = { opener: {} as unknown, document: { body: { textContent: '' } }, location: { replace: (u: string) => { replaced.push(u); } } };
g['open'] = (url: string, target: string) => { OPENED.push({ url, target }); return popup; };

const { home } = await import('./ui-driver.ts');
const acct = await import('../account.ts');
const settle = (): Promise<void> => new Promise(r => { setImmediate(() => r()); });
await settle();
const ui = home();

async function profile(): Promise<string> {
  acct.reloadMe();
  await settle(); await settle();
  if (ui.has({ btn: 'acct-close' })) { ui.click({ btn: 'acct-close' }); await settle(); }
  ui.click({ btn: 'acct-open-profile' });
  await settle(); await settle();
  const html = ui.html();
  assert.match(html, /<div class="accthead">/, 'the profile did not paint');
  return html;
}
const BTN = /<button data-btn="nav-storybook"[^>]*>🎨 Design \(Storybook\)<\/button>/;

test('§1 an admin has a Design (Storybook) button on the profile, beside Admin', async () => {
  who = admin;
  const html = await profile();
  assert.match(html, BTN);
  assert.match(html, /data-btn="nav-admin"[^]*?<\/button>\s*<button data-btn="nav-storybook"/, 'beside the Admin button');
});

test('§2 a player has no button, and neither has an owner/judge badge without the admin flag', async () => {
  for (const a of [player, judge]) {
    who = a;
    const html = await profile();
    assert.doesNotMatch(html, /nav-storybook/, `${a.username}'s profile offers Storybook`);
  }
});

test('§3 the button opens a window in the click, gets a ticket with the session, and sends the window there', async () => {
  who = admin;
  await profile();
  ui.click({ btn: 'nav-storybook' });
  assert.deepEqual(OPENED, [{ url: '', target: '_blank' }], 'the window opens inside the click, before any await');
  await settle(); await settle();
  assert.deepEqual(POSTS, [{ url: '/api/storybook/ticket', auth: 'Bearer tok' }]);
  assert.deepEqual(replaced, ['/storybook/?ticket=T1'], 'the window goes to the ticket URL the server answered');
  assert.equal(popup.opener, null, 'Storybook gets no handle on the game page');
  assert.match(ui.html(), /<div class="accthead">/, 'the profile stays where it was');
});
