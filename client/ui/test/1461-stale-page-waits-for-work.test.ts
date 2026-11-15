/* 1461 — a stale page does NOT reload while a reload would lose work: here a deck on the
 * builder's table (main.ts installBuildCheck's `busy`). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 15);
const D = {
  id: 'd1461', name: 'Mid-edit', cards: N.flatMap(n => [n, n]), maybe: [], sideboard: [], cover: null, author: 'you',
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', problems: [], ccProblems: [], description: '',
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
};
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't1461' };
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: [D] }) };
  if (url.startsWith('/api/inbox')) {
    return { status: 200, headers: { get: (k: string) => (k === 'x-algo-build' ? 'bbbbbbbbbbbb' : null) }, json: async () => ({ ok: true }) };
  }
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const { installBuildCheck } = await import('../build.ts');
const { pollInboxNow } = await import('../inbox.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test('with a deck on the table, the newer bundle waits', async () => {
  let reloads = 0;
  (location as unknown as { reload: () => void }).reload = () => { reloads++; };
  await flush();
  ui.click({ btn: 'deck-openpage' });
  await flush();
  assert.match(ui.click({ btn: 'deck-tabletop' }), /class="[^"]*\bttpage"/, 'the builder is open');
  installBuildCheck({ own: 'aaaaaaaaaaaa' });
  pollInboxNow();
  await flush();
  assert.equal(reloads, 0);
});
