/* CT-515 ON THE SHARED DECK PAGE — ui/meta.ts, driven through the real client.
 *
 * A shared deck's sideboard is part of its list (server/publicdecks.ts sends
 * it, docs/22 §4.3), but the page's card-list export wrote only the main deck:
 * ui/meta.ts's PublicDeck type had no `sideboard`, so nothing passed it on.
 * The text grammar and its round trip are engine/test/188 §6; this is the
 * wiring — the shared deck's sideboard reaches the export, the shelf does not
 * exist there (it is never published).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 24);
const MAIN = N.slice(0, 16).flatMap(n => [n, n]);
const SIDE = N.slice(16, 23);
const SHARED = {
  id: 'p1141', name: 'Shared side deck', cards: MAIN, sideboard: SIDE, cover: null, author: 'someone',
  visibility: 'public', owner: { id: 'u1', username: 'someone' },
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', problems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null }, copies: 0,
};
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url.startsWith('/api/deck/meta')) return { status: 200, json: async () => ({ ok: true, decks: [SHARED], minGames: 0 }) };
  if (url.startsWith('/api/deck/shared')) return { status: 200, json: async () => ({ ok: true, deck: SHARED }) };
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test('1141 CT-515: a shared deck\'s card list export carries its sideboard under its own divider', async () => {
  await flush();
  ui.click({ btn: 'meta-openpage' });
  await flush();
  ui.click({ btn: 'meta-open', id: 'p1141' });
  await flush();
  ui.click({ btn: 'meta-export' });                       // "Export this deck" opens the panel
  const html = ui.click({ btn: 'meta-export', format: 'text' });
  const text = /<textarea class="dkexporttext"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1]
    ?.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
  assert.ok(text, 'the export panel shows the card list');
  const [deck, side] = text!.split('\n\n// sideboard\n');
  assert.ok(side, 'a sideboard divider: ' + text!.slice(0, 200));
  assert.deepEqual(side!.split('\n').map(l => l.replace(/^1 /, '')).sort(), [...SIDE].sort(), 'every sideboard card, once');
  for (const n of SIDE) assert.ok(!new RegExp(`^\\d+ ${n}$`, 'm').test(deck!), `${n} is not in the deck part`);
  assert.doesNotMatch(text!, /\/\/ maybeboard/, 'a shared deck has no shelf');
});
