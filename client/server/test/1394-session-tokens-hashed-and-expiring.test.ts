// Sessions are stored only as a hash, old plaintext ones migrate, idle ones end at 90 days, a password change ends the others.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountForToken, changePassword, loadAccounts, login, register, SESSION_IDLE_MS, useAccountsFile } from '../accounts.ts';

const root = mkdtempSync(join(tmpdir(), 'sessions-'));
const file = join(root, 'accounts.json');
const restoreAccounts = useAccountsFile(file);
test.after(() => { restoreAccounts(); rmSync(root, { recursive: true, force: true }); });

const sha = (t: string): string => createHash('sha256').update(t).digest('hex');
const DAY = 86_400_000;

test('⭐ a session token never reaches the file; its SHA-256 does', () => {
  const r = register('Hasher', 'a password');
  assert.ok(r.ok);
  const text = readFileSync(file, 'utf8');
  assert.equal(text.includes(r.token), false, 'the bearer token is in the file in the clear');
  assert.ok(text.includes(sha(r.token)), 'the token\'s hash is not what is stored');
  assert.equal(accountForToken(r.token)?.username, 'Hasher');
});

test('⭐ a plaintext session from an older file is hashed on load and still signs in', () => {
  const store = JSON.parse(readFileSync(file, 'utf8')) as { accounts: { id: string }[]; sessions: unknown[] };
  const now = new Date().toISOString();
  const OLD = 'a'.repeat(48);
  store.sessions = [{ token: OLD, userId: store.accounts[0]!.id, createdAt: now, lastSeen: now }];
  writeFileSync(file, JSON.stringify(store));
  loadAccounts();
  assert.equal(accountForToken(OLD)?.username, 'Hasher', 'the migrated session no longer signs in');
  assert.equal(readFileSync(file, 'utf8').includes(OLD), false, 'the plaintext token is still in the file after the load');
});

test('⭐ a session idle past 90 days is refused, one used within it is not', () => {
  const t0 = Date.now();
  const a = login('Hasher', 'a password');
  const b = login('Hasher', 'a password');
  assert.ok(a.ok && b.ok);
  assert.equal(SESSION_IDLE_MS, 90 * DAY);
  assert.ok(accountForToken(a.token, t0 + SESSION_IDLE_MS - DAY), 'a session used within the limit was refused');
  assert.equal(accountForToken(b.token, t0 + SESSION_IDLE_MS + DAY), undefined, 'an idle session still signs in');
});

test('⭐ a password change ends every other session of the account and keeps the caller\'s', () => {
  const mine = login('Hasher', 'a password');
  const phone = login('Hasher', 'a password');
  const other = register('Bystander', 'their password');
  assert.ok(mine.ok && phone.ok && other.ok);
  assert.deepEqual(changePassword(mine.account, 'a password', 'second password', mine.token), { ok: true });
  assert.ok(accountForToken(mine.token), 'the session that changed it was signed out');
  assert.equal(accountForToken(phone.token), undefined, 'another session survived the password change');
  assert.ok(accountForToken(other.token), 'somebody else was signed out');
});
