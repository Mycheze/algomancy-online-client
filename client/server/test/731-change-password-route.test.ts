/* 731 — CHANGING YOUR PASSWORD, OVER HTTP (report #296).
 *
 * `POST /api/auth/password` had been on the server since accounts landed and
 * nothing in the browser called it; the profile's Password box now does
 * (ui/account.ts, guarded in ui/test/732). This is the route itself, over real
 * HTTP on an ephemeral port, with api-accounts.ts's real handler and a
 * throwaway accounts file:
 *
 *   §1 no session is refused, and nothing changes
 *   §2 ⭐ the wrong current password is refused, and the old one still logs in
 *   §3 a new password the sign-up rules refuse is refused the same way
 *   §4 ⭐ a valid change: the NEW password logs in and the OLD one does not
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register, useAccountsFile } from '../accounts.ts';
import { accountRoutes } from '../api-accounts.ts';

const root = mkdtempSync(join(tmpdir(), 'pw-route-'));
const restoreAccounts = useAccountsFile(join(root, 'accounts.json'));

const server: Server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  accountRoutes(req, res, url.pathname, url, { online: () => false }).then(handled => {
    if (!handled) { res.writeHead(404); res.end(); }
  }, err => { res.writeHead(500); res.end(String(err)); });
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

test.after(async () => {
  await new Promise<void>(r => server.close(() => r()));
  restoreAccounts();
  rmSync(root, { recursive: true, force: true });
});

async function post(path: string, body: unknown, token?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}
const logsIn = async (password: string): Promise<boolean> =>
  (await post('/api/auth/login', { username: 'Cobsen', password })).body['ok'] === true;

const made = register('Cobsen', 'first password');
assert.ok(made.ok, 'register');
const TOKEN = made.ok ? made.token : '';

test('§1 report 296 change password: no session is refused, and nothing changes', async () => {
  const r = await post('/api/auth/password', { oldPassword: 'first password', newPassword: 'second password' });
  assert.equal(r.status, 401);
  assert.equal(r.body['ok'], false);
  assert.ok(await logsIn('first password'), 'the password is what it was');
});

test('§2 report 296 change password: the wrong current password is refused, and the old one still logs in', async () => {
  const r = await post('/api/auth/password', { oldPassword: 'not my password', newPassword: 'second password' }, TOKEN);
  assert.deepEqual(r.body, { ok: false, error: 'that is not your current password' });
  assert.ok(await logsIn('first password'), 'the old password still works');
  assert.ok(!(await logsIn('second password')), 'the refused one was never set');
});

test('§3 report 296 change password: a new password the sign-up rules refuse is refused', async () => {
  const r = await post('/api/auth/password', { oldPassword: 'first password', newPassword: 'x' }, TOKEN);
  assert.equal(r.body['ok'], false);
  assert.match(String(r.body['error']), /6 characters/, 'the same reason sign-up gives');
  assert.ok(await logsIn('first password'));
});

test('§4 report 296 change password: a valid change logs in with the NEW password and not the old', async () => {
  const r = await post('/api/auth/password', { oldPassword: 'first password', newPassword: 'second password' }, TOKEN);
  assert.deepEqual(r.body, { ok: true });
  assert.ok(await logsIn('second password'), 'the new password logs in');
  assert.ok(!(await logsIn('first password')), 'the old password no longer does');
});
