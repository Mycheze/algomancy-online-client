// An account file that still holds a `history` array moves it to the history file once, every row, and the next save drops it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gameHistory, loadAccounts, saveAccounts, useAccountsFile } from '../accounts.ts';
import { historyBeside } from '../statepaths.ts';

const dir = mkdtempSync(join(tmpdir(), 'algo-1451-'));
const accounts = join(dir, 'accounts.json');
const rows = ['MIG1', 'MIG2', 'MIG3'].map(code => ({ code, playedAt: '2026-11-01T12:00:00.000Z', users: [null, null], winner: 1 }));
const legacy = JSON.stringify({ version: 1, accounts: [], sessions: [], history: rows });
writeFileSync(accounts, legacy);
const restore = useAccountsFile(accounts);
test.after(() => { restore(); rmSync(dir, { recursive: true, force: true }); });

test('⭐ a legacy history array becomes the history file: every row, once, and gone from the account file at the next save', () => {
  const lines = (): unknown[] => readFileSync(historyBeside(accounts), 'utf8').split('\n').slice(0, -1).map(l => JSON.parse(l));
  assert.deepEqual(gameHistory(), rows, 'the history did not load whole');
  assert.deepEqual(lines(), rows, 'the history file is not one line per row');
  assert.equal(readFileSync(accounts, 'utf8'), legacy, 'loading rewrote the account file');
  loadAccounts();   // both present: the file wins, and nothing migrates twice
  assert.deepEqual(lines(), rows);
  assert.ok(saveAccounts());
  assert.equal('history' in JSON.parse(readFileSync(accounts, 'utf8')), false, 'the account file still carries the history');
  loadAccounts();
  assert.deepEqual(gameHistory(), rows, 'the history did not survive the save');
});
