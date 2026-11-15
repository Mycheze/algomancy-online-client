// A login or a deck save rewrites the account file and never touches the match history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import { accountByName, login, register, saveAccounts, stashHistory, useAccountsFile } from '../accounts.ts';
import { createDeck } from '../collection.ts';
import { historyBeside } from '../statepaths.ts';

const dir = mkdtempSync(join(tmpdir(), 'algo-1450-'));
const accounts = join(dir, 'accounts.json'), history = historyBeside(accounts);
const restore = useAccountsFile(accounts);
test.after(() => { restore(); rmSync(dir, { recursive: true, force: true }); });

test('⭐ a login and a deck save leave the history file byte-identical and unwritten', () => {
  assert.ok(register('Ann1450', 'correct horse battery').ok);
  stashHistory({ code: 'HLA1', playedAt: '2026-11-01T12:00:00.000Z', users: [null, null] } as never);
  assert.ok(saveAccounts());
  const bytes = readFileSync(history), mtime = statSync(history).mtimeMs, saved = statSync(accounts).mtimeMs;
  assert.ok(login('ann1450', 'correct horse battery').ok);
  assert.ok(createDeck(accountByName('Ann1450')!, { name: 'deck 1450', cards: DECK_LIST.slice(0, 30) }).ok);
  assert.notEqual(statSync(accounts).mtimeMs, saved, 'the account file was not saved at all');
  assert.deepEqual(readFileSync(history), bytes, 'the history file changed');
  assert.equal(statSync(history).mtimeMs, mtime, 'the history file was rewritten');
});
