/* 1349 — THE BELL'S CUBE LINES, DRIVEN: the real ui/main.ts on the home screen, with an
 * /api/inbox that sends cube news (server/api-inbox.ts `cube`).
 *
 *   §1 ⭐ unread cube lines count in the bell, as unread league news does
 *   §2 opening the bell draws them and marks them read on the server, by time (`cubeUpTo`)
 *   §3 a line's Open opens that event's page (ui/cube.ts openCube), which asks for its view
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CubeNote } from '../../server/cube-types.ts';

const NOTES: CubeNote[] = [
  { id: 'QZXV:3', event: 'QZXV', eventName: 'Friday cube', kind: 'round', at: 3000, read: false, round: 2, opponent: 'Sim Ada' },
  { id: 'QZXV:1', event: 'QZXV', eventName: 'Friday cube', kind: 'starting', at: 2000, read: false },
  { id: 'AB12:4', event: 'AB12', eventName: 'Old cube', kind: 'done', at: 1000, read: true },
];
const POSTS: { url: string; body: Record<string, unknown> }[] = [];
const GETS: string[] = [];
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't1349' };
g['__UI_DRIVER_FETCH'] = async (url: string, init?: { method?: string; body?: string }) => {
  if (init?.body) POSTS.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
  else GETS.push(url);
  if (url === '/api/inbox' || url.startsWith('/api/inbox?')) {
    return { ok: true, status: 200, json: async () => ({ ok: true, invites: [], requests: [], league: [], times: [],
      friends: [], decks: [], cube: NOTES }) };
  }
  if (url === '/api/inbox/read') return { ok: true, status: 200, json: async () => ({ ok: true }) };
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
await flush();

test('1349 §1 ⭐ the bell counts the unread cube lines', () => {
  assert.match(ui.html(), /data-inbox="bell"[^>]*>🔔<span class="inboxcount">2<\/span>/, 'two unread, the read one not counted');
});

test('1349 §2 opening the bell draws them and marks them read', async () => {
  const html = ui.click({ inbox: 'bell' });
  assert.match(html, /<div class="zonelabel">Cube draft<\/div>/);
  assert.match(html, /Round 2 is up: you play <b>Sim Ada<\/b>\./);
  assert.match(html, /The draft is starting — <b>Friday cube<\/b>\./);
  assert.match(html, /<b>Old cube<\/b> is over\./);
  const read = POSTS.filter(p => p.url === '/api/inbox/read');
  assert.deepEqual(read.map(p => p.body), [{ cubeUpTo: 3000 }], 'read up to the newest unread line, by time; no league id');
  assert.doesNotMatch(ui.html(), /class="inboxcount"/, 'nothing unread now');
});

test('1349 §3 Open opens the event page', async () => {
  const html = ui.click({ inbox: 'cube', event: 'QZXV' });
  assert.match(html, /class="[^"]*cubepage"/, 'the cube page owns #app');
  assert.doesNotMatch(html, /class="inboxlist"/, 'the list closed');
  await flush();
  assert.ok(GETS.includes('/api/cube/QZXV'), `the page asks for the event's view (asked: ${GETS.join(', ')})`);
});
