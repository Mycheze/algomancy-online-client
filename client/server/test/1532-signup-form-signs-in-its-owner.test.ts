/* 1532 — THE SIGN-UP FORM SIGNS IN THE NAME'S OWNER.
 *
 * Typing your own username and password into "Create an account" signs you
 * in: whoever knows a name's password is its owner, not a second claimant.
 * A wrong password still reads "that username is taken", and counts toward
 * the same failed-login brake as the login route, so the sign-up route is
 * not a way round it. Real HTTP, api-accounts.ts's handler, a throwaway store.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allAccounts, register, useAccountsFile } from '../accounts.ts';
import { accountRoutes } from '../api-accounts.ts';

const root = mkdtempSync(join(tmpdir(), 'signup-owner-'));
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

/** each case its own forwarded address, so one case's failures never brake another */
async function post(path: string, body: unknown, from: string, token?: string): Promise<Record<string, unknown>> {
  const res = await fetch(BASE + path, {
    method: path === '/api/me' ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json', 'x-forwarded-for': from,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(path === '/api/me' ? {} : { body: JSON.stringify(body) }),
  });
  return await res.json() as Record<string, unknown>;
}

const made = register('Oweneth', 'my real password');
assert.ok(made.ok, 'register');

test('sign-up form: an existing name with its own password signs that account in', async () => {
  const before = allAccounts().length;
  const r = await post('/api/auth/register', { username: 'Oweneth', password: 'my real password' }, '10.0.0.1');
  assert.equal(r['ok'], true, 'signed in, not "taken"');
  assert.equal(r['signedIn'], true, 'and the reply says it was a sign-in');
  assert.equal(r['claimed'], 0, 'a sign-in redeems no sign-up ticket');
  assert.equal((r['me'] as { id?: string }).id, made.ok ? made.account.id : '', 'as the account that already had the name');
  assert.equal(allAccounts().length, before, 'and no second account is made');
  const me = await post('/api/me', null, '10.0.0.1', String(r['token']));
  assert.equal((me['me'] as { username?: string }).username, 'Oweneth', 'the token is a real session');
});

test('sign-up form: the name is matched the way the login matches it, case and spaces aside', async () => {
  const r = await post('/api/auth/register', { username: '  oWENETH ', password: 'my real password' }, '10.0.0.2');
  assert.equal(r['ok'], true);
  assert.equal((r['me'] as { username?: string }).username, 'Oweneth');
});

test('sign-up form: an existing name with the wrong password is still taken, and nothing changes', async () => {
  const before = allAccounts().length;
  const r = await post('/api/auth/register', { username: 'Oweneth', password: 'a guess at it' }, '10.0.0.3');
  assert.deepEqual(r, { ok: false, error: 'that username is taken' });
  assert.equal(allAccounts().length, before);
});

test('sign-up form: wrong passwords there count toward the failed-login brake', async () => {
  for (let i = 0; i < 10; i++) {
    const r = await post('/api/auth/register', { username: 'Oweneth', password: `guess ${i}` }, '10.0.0.4');
    assert.equal(r['error'], 'that username is taken', `guess ${i}`);
  }
  const login = await post('/api/auth/login', { username: 'Oweneth', password: 'my real password' }, '10.0.0.4');
  assert.deepEqual(login, { ok: false, error: 'too many failed attempts — wait a minute' },
    'the login route is braked by them, even for the right password');
});

test('sign-up form: a name nobody has still makes a new account', async () => {
  const before = allAccounts().length;
  const r = await post('/api/auth/register', { username: 'Freshling', password: 'another password' }, '10.0.0.5');
  assert.equal(r['ok'], true);
  assert.equal(r['signedIn'], undefined, 'a real sign-up, not a sign-in');
  assert.equal(allAccounts().length, before + 1);
});
