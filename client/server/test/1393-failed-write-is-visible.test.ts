// A store write that fails shows in the admin overview, and a sign-up that cannot be saved is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allAccounts, register, registerGuest, saveAccounts, setAdmin, useAccountsFile } from '../accounts.ts';
import { adminRoutes } from '../api-admin.ts';

const root = mkdtempSync(join(tmpdir(), 'store-fail-'));
const dir = join(root, 'acc');
const restoreAccounts = useAccountsFile(join(dir, 'accounts.json'));

const server: Server = createServer((req, res) => {
  adminRoutes(req, res, new URL(req.url ?? '/', 'http://x').pathname).then(handled => {
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

const admin = register('Boss', 'a password');
assert.ok(admin.ok);
setAdmin(admin.account, true);

const stores = async (): Promise<Record<string, { ok: boolean }>> =>
  ((await (await fetch(`${BASE}/api/admin/overview`, { headers: { authorization: `Bearer ${admin.token}` } })).json()) as
    { stores: Record<string, { ok: boolean }> }).stores;

test('⭐ a failed write shows in the admin overview, and sign-up is refused while it fails', async () => {
  assert.equal((await stores())['accounts']!.ok, true);
  // the store's directory becomes a file: every write under it fails, as on a full or read-only disk
  rmSync(dir, { recursive: true, force: true });
  writeFileSync(dir, 'not a directory');
  assert.equal(saveAccounts(), false);
  assert.equal((await stores())['accounts']!.ok, false, 'the admin overview does not show the failing store');
  const before = allAccounts().length;
  assert.equal(register('Newcomer', 'a password').ok, false, 'an account that exists only until the restart was handed out');
  assert.equal(registerGuest().ok, false, 'a guest that exists only until the restart was handed out');
  assert.equal(allAccounts().length, before, 'a refused sign-up left an account in memory');
});
