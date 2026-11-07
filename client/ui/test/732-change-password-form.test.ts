/* 732 — THE PROFILE'S CHANGE-PASSWORD BOX (report 296).
 *
 * "I would like a way to set a new password." The server route was there
 * (server/test/731); the browser never called it. The profile's stats tab now
 * carries a Password box, driven here through the real client
 * (test/ui-driver.ts) and fed the server's own privateView:
 *
 *   §1 ⭐ a signed-in, named account sees the box on its own profile, with
 *      the password-manager hints
 *   §2 ⭐ a guest does not: its password is one nobody knows, and it claims an
 *      account instead
 *   §3 ⭐ Change password posts {oldPassword, newPassword} to
 *      /api/auth/password and says so when it worked; the server's error is
 *      shown when it did not
 *   §4 a confirm that does not match is caught before anything is sent
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountByName, privateView, register, registerGuest, useAccountsFile, type Account } from '../../server/accounts.ts';

const dir = mkdtempSync(join(tmpdir(), 'pw-form-'));
const restoreAccounts = useAccountsFile(join(dir, 'accounts.json'));
test.after(() => { restoreAccounts(); rmSync(dir, { recursive: true, force: true }); });

assert.ok(register('Cobsen', 'first password').ok);
const named = accountByName('Cobsen')!;
const g0 = registerGuest();
assert.ok(g0.ok);
const guest: Account = g0.ok ? g0.account : named;
assert.ok(guest.provisional, 'a guest account');

let who: Account = named;
let answer: Record<string, unknown> = { ok: true };
const POSTS: { url: string; body: Record<string, unknown> }[] = [];
const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 'tok' };
const reply = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
g['__UI_DRIVER_FETCH'] = (url: string, init?: { body?: string }) => {
  if (url === '/api/me') return reply({ ok: true, me: privateView(who, () => false) });
  if (url === '/api/auth/password') {
    POSTS.push({ url, body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> });
    return reply(answer);
  }
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const acct = await import('../account.ts');
const settle = (): Promise<void> => new Promise(r => { setImmediate(() => r()); });
await settle();
const ui = home();

/** the profile's stats tab, signed in as `who` */
async function profile(): Promise<string> {
  acct.reloadMe();
  await settle(); await settle();
  // a fresh visit each time: back to the lobby, then the profile again
  if (ui.has({ btn: 'acct-close' })) { ui.click({ btn: 'acct-close' }); await settle(); }
  ui.click({ btn: 'acct-open-profile' });
  await settle(); await settle();
  // the password is on the Settings tab since the account redesign (2026-11-07)
  ui.click({ btn: 'acct-tab', tab: 'settings' });
  await settle();
  const html = ui.html();
  // the profile is drawn in the app frame since 2026-11-04 (pages/frame.ts), its class last
  assert.match(html, /<div class="ui-app-shell [^"]*apppage acctpage">/, 'the profile did not paint');
  return html;
}
/** the Settings tab's Account section, which holds the password row (or nothing: '' when there is no password form) */
const box = (html: string): string => {
  const sec = /<h3>Account<\/h3>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? '';
  return /pwform/.test(sec) ? sec : '';
};

test('§1 report 296: a signed-in named account has a Change password box on its own profile', async () => {
  who = named;
  const b = box(await profile());
  assert.ok(b, 'there is no password box on the profile');
  assert.match(b, /<div class="ui-setting-row__label">Password<\/div>/);
  assert.match(b, /id="acct-pw-old" type="password"[^>]*autocomplete="current-password"/);
  assert.match(b, /id="acct-pw-new" type="password"[^>]*autocomplete="new-password"/);
  assert.match(b, /id="acct-pw-again" type="password"[^>]*autocomplete="new-password"/);
  assert.match(b, /<button [^>]*data-btn="acct-password" type="button">Change password<\/button>/,
    'a plain button: a submit in a form would put the passwords in the address');
});

test('§2 report 296: a guest has no password box', async () => {
  who = guest;
  const html = await profile();
  assert.doesNotMatch(html, /acct-password|acct-pw-old|pwform/);
  who = named;
  assert.ok(box(await profile()), 'and it is back for a named account');
});

test('§3 report 296: Change password posts the old and new password, and shows the answer', async () => {
  who = named;
  await profile();
  POSTS.length = 0;
  answer = { ok: false, error: 'that is not your current password' };
  ui.type('acct-pw-old', 'not it');
  ui.type('acct-pw-new', 'second password');
  ui.type('acct-pw-again', 'second password');
  ui.click({ btn: 'acct-password' });
  await settle(); await settle();
  assert.deepEqual(POSTS, [{ url: '/api/auth/password', body: { oldPassword: 'not it', newPassword: 'second password' } }]);
  assert.match(box(ui.html()), /that is not your current password/, 'the server error is shown in the box');

  answer = { ok: true };
  ui.type('acct-pw-old', 'first password');
  ui.type('acct-pw-new', 'second password');
  ui.type('acct-pw-again', 'second password');
  ui.click({ btn: 'acct-password' });
  await settle(); await settle();
  assert.deepEqual(POSTS[1], { url: '/api/auth/password', body: { oldPassword: 'first password', newPassword: 'second password' } });
  const b = box(ui.html());
  assert.match(b, /Password changed\./);
  assert.doesNotMatch(b, /not your current password/, 'the old error is gone');
});

test('§4 report 296: a confirm that does not match is caught before posting', async () => {
  who = named;
  await profile();
  POSTS.length = 0;
  ui.type('acct-pw-old', 'first password');
  ui.type('acct-pw-new', 'second password');
  ui.type('acct-pw-again', 'second pasword');
  ui.click({ btn: 'acct-password' });
  await settle();
  assert.equal(POSTS.length, 0, 'nothing was sent');
  assert.match(box(ui.html()), /the new passwords do not match/);
});
