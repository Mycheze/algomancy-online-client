// Every store write keeps the previous generation as .bak, and the account store is mode 0600.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register, useAccountsFile } from '../accounts.ts';

const root = mkdtempSync(join(tmpdir(), 'store-bak-'));
const accounts = join(root, 'accounts.json');
const restoreAccounts = useAccountsFile(accounts);
test.after(() => { restoreAccounts(); rmSync(root, { recursive: true, force: true }); });

test('⭐ accounts.json.bak is the generation before the last write; the file is 0600', () => {
  assert.ok(register('First', 'a password').ok);
  const gen1 = readFileSync(accounts, 'utf8');
  assert.ok(register('Second', 'a password').ok);
  assert.notEqual(readFileSync(accounts, 'utf8'), gen1);
  assert.equal(readFileSync(`${accounts}.bak`, 'utf8'), gen1, 'the .bak is not the previous generation');
  assert.equal(statSync(accounts).mode & 0o777, 0o600, 'the store is readable by others');
});
