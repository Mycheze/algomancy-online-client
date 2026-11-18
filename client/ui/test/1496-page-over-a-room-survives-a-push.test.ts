/* 1496 — A PAGE OPENED OVER A WAITING ROOM IS NOT PAINTED OVER BY THE ROOM.
 *
 * A constructed waiting room's deck picker offers "My decks →"; the Decks page
 * opens over the room, and the builder opens over the Decks page. Every server
 * push to the room (the opponent arrives, brings a deck, leaves) calls render(),
 * which paints the room — so it must leave a page the player opened alone. That
 * page's Back paints the room again, as it stands by then.
 *
 *   §1 the Decks page stays up when the opponent arrives, and Back shows them here
 *   §2 the builder opened from it stays up too, and its Back goes to the Decks page
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 15);
const DECK = {
  id: 'd1496', name: 'Room deck', cards: N.flatMap(n => [n, n]), maybe: [], sideboard: [] as string[], cover: null,
  author: 'you', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z', problems: [], ccProblems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
};

const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_STORE'] = { algoToken: 't1496' };
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: [DECK] }) };
  return new Promise(() => {});
};
const { client } = await import('./ui-driver.ts');
const ui = await client();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

const ROOM = /data-btn="deckjoin"/;
const DECKS_PAGE = /data-btn="deck-close"/;
const BUILDER = /data-btn="tt-close"/;
const roomMsg = (t: 'joined' | 'update', bothHere: boolean): Record<string, unknown> => ({
  t, seat: 0, room: 'UIDRIVER', waiting: { have: [false, false] },
  peers: [true, bothHere], names: ['Ann', bothHere ? 'Bo' : null],
});

test('BL-10 §1 the Decks page opened from a waiting room stays up when the opponent arrives', async () => {
  ui.push(roomMsg('joined', false));
  await flush();
  assert.match(ui.html(), ROOM, 'the fixture is not in a constructed waiting room');
  ui.click({ btn: 'deck-openpage' });
  await flush();
  assert.match(ui.html(), DECKS_PAGE, 'My decks → did not open the Decks page');

  ui.push(roomMsg('update', true));
  ui.tick();
  assert.match(ui.html(), DECKS_PAGE, 'the opponent arriving painted the waiting room over the Decks page');
  assert.doesNotMatch(ui.html(), ROOM);

  ui.click({ btn: 'deck-close' });
  assert.match(ui.html(), ROOM, 'Back did not return to the room');
  assert.match(ui.html(), /connected — still choosing a deck/, 'the room was not repainted as it stands now: the opponent is missing');
});

test('BL-10 §2 the builder opened over that Decks page stays up too, and its Back goes to the Decks page', async () => {
  ui.click({ btn: 'deck-openpage' });
  await flush();
  ui.click({ btn: 'deck-open', id: 'd1496' });
  ui.click({ btn: 'deck-tabletop' });
  await flush();
  const builder = ui.html();
  assert.doesNotMatch(builder, ROOM);
  assert.doesNotMatch(builder, DECKS_PAGE, 'the builder did not open');

  ui.push(roomMsg('update', false));
  ui.tick();
  assert.doesNotMatch(ui.html(), ROOM, 'the opponent leaving painted the waiting room over the builder');
  assert.match(ui.html(), BUILDER, 'the builder is not on screen');

  ui.click({ btn: 'tt-close' });
  assert.match(ui.html(), DECKS_PAGE, 'the builder\'s Back did not go to the Decks page');
  ui.click({ btn: 'deck-close' });
  assert.match(ui.html(), ROOM, 'the Decks page\'s Back did not return to the room');
  assert.match(ui.html(), /not here yet/, 'the room was not repainted as it stands now: the opponent left');
});
