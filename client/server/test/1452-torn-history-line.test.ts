// A torn last line of the history file is dropped and cut off; any other unreadable line refuses the load and nothing is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gameHistory, loadAccounts, saveAccounts, useAccountsFile } from '../accounts.ts';
import { historyBeside } from '../statepaths.ts';
import { StoreLoadError } from '../store-file.ts';

const dir = mkdtempSync(join(tmpdir(), 'algo-1452-'));
const accounts = join(dir, 'accounts.json'), history = historyBeside(accounts);
const row = (code: string): string => `${JSON.stringify({ code, playedAt: '2026-11-01T12:00:00.000Z', users: [null, null] })}\n`;
const TORN = '{"code":"TORN","users":[nu';
writeFileSync(accounts, JSON.stringify({ version: 1, accounts: [], sessions: [] }));
writeFileSync(history, row('GOOD') + row('ALSO') + TORN);
const restore = useAccountsFile(accounts);
test.after(() => { restore(); rmSync(dir, { recursive: true, force: true }); });
const files = (): Record<string, string> => Object.fromEntries(readdirSync(dir).map(f => [f, readFileSync(join(dir, f), 'utf8')]));

test('⭐ a torn last line is dropped and cut off the file; a bad line anywhere else refuses the load, writing nothing', () => {
  assert.deepEqual(gameHistory().map(g => g.code), ['GOOD', 'ALSO']);
  assert.equal(readFileSync(history, 'utf8'), row('GOOD') + row('ALSO'), 'the torn line was not cut off');
  writeFileSync(history, row('GOOD') + 'not json\n' + row('ALSO') + TORN);
  const before = files();
  assert.throws(() => loadAccounts(), (err: Error) => err instanceof StoreLoadError && err.message.includes(`${history} line 2`));
  assert.equal(saveAccounts(), false, 'a store that did not load was written');
  assert.deepEqual(files(), before, 'something was written');
});
