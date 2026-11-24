/* 1517 — THE ADMIN ROWS SAY WHEN A GAME IS A SINGLE CARD DUEL.
 *
 * A single card duel is a constructed game on the wire (CR D8.2), so a row
 * that carries only `mode` reads "constructed" on the dashboard. The Games
 * and Live rooms rows carry `single` beside it; ui/test/1516 draws them.
 *
 * §1 a stored single card duel's games row names its two cards, by seat;
 *    an ordinary constructed row carries no `single`
 * §2 a live single card duel room's row is marked; an ordinary one is not
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* THROWAWAY STATE: set before the imports — accounts.ts and rooms.ts capture
 * their files at module scope. */
const SCRATCH = mkdtempSync(join(tmpdir(), 'algo-1517-'));
process.env['ALGO_GAMES_DIR'] = join(SCRATCH, 'games');
process.env['ALGO_ACCOUNTS_FILE'] = join(SCRATCH, 'accounts.json');

const accounts = await import('../accounts.ts');
const { summarizeGame } = await import('../stats.ts');
const { createRoom } = await import('../rooms.ts');
const { DECK_LIST } = await import('../../engine/src/cards/registry.ts');
const { gameRows, roomRows } = await import('../admin.ts');

type RecordedGame = import('../accounts.ts').RecordedGame;
type CardName = import('../../engine/src/types.ts').CardName;

function stored(code: string, extra: Partial<RecordedGame> = {}): RecordedGame {
  const seats = summarizeGame({ code, seed: 1, mode: 'constructed', names: ['Ann', 'Bo'], actions: [] }).seats;
  return {
    code, playedAt: '2026-11-20T12:00:00.000Z', recordedAt: '2026-11-20T12:00:00.000Z',
    mode: 'constructed', els: [], finished: true, winner: 0, turns: 6, diverged: false,
    users: [null, null], names: ['Ann', 'Bo'], seats, ...extra,
  };
}

accounts.loadAccounts();
accounts.stashHistory(stored('SCD1', { single: ['Mindburn', 'Fight'] as [CardName, CardName] }));
accounts.stashHistory(stored('CON1'));

test('1517 §1 a stored single card duel row names its cards; a constructed row carries no single', () => {
  const rows = gameRows();
  assert.deepEqual(rows.find(g => g.code === 'SCD1')?.single, ['Mindburn', 'Fight']);
  assert.equal(rows.find(g => g.code === 'SCD1')?.mode, 'constructed', 'the wire mode is untouched');
  const plain = rows.find(g => g.code === 'CON1');
  assert.ok(plain, 'positive control: the constructed row is listed');
  assert.equal('single' in plain, false);
});

test('1517 §2 a live single card duel room is marked; an ordinary room is not', () => {
  const deck = DECK_LIST.slice(0, 30);
  createRoom('SCDR', 1, ['Ann', 'Bo'], 'constructed', undefined, Array(30).fill(deck[0]!), undefined, null, undefined, true);
  createRoom('CONR', 2, ['Ann', 'Bo'], 'constructed', undefined, deck);
  const rows = roomRows();
  assert.equal(rows.find(r => r.code === 'SCDR')?.single, true);
  const plain = rows.find(r => r.code === 'CONR');
  assert.ok(plain, 'positive control: the ordinary room is listed');
  assert.equal('single' in plain, false);
});
