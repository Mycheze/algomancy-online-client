/* 1341 — THE EVENT PAGE, DRIVEN (docs/25 §9, §10): the real ui/main.ts booted on `?cube=qzxv`
 * with a socket this test holds the other end of (test/ui-driver.ts).
 *
 * §1 the page opens its own room-less socket and subscribes with the code and the token
 * §2 a pushed view is what is drawn; a newer one replaces it
 * §3 `matched` puts up the banner (and asks for attention — the cue and the tab alert)
 * §4 the toolbar's tabs, and an op over HTTP (Join) carrying the token
 * §5 Play opens the match room as a seat, with the event on the link for the way back
 * §6 the draft goes up the same socket; Back from the pick screen is the event page, and back again
 * §7 leaving the page unsubscribes and paints the home
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventView, match, PLAYERS } from './cube-fixture.ts';

const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '?cube=qzxv';
g['__UI_DRIVER_STORE'] = { algoToken: 'tok1' };
const posts: { url: string; body: unknown; auth: string | undefined }[] = [];
g['__UI_DRIVER_FETCH'] = (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
  if (init?.method !== 'POST' || !url.startsWith('/api/cube/')) return new Promise(() => {});
  posts.push({ url, body: JSON.parse(init.body ?? '{}'), auth: init.headers?.['Authorization'] ?? init.headers?.['authorization'] });
  const answer = url.endsWith('/play') ? { ok: true, room: 'RM1', seat: 1 } : { ok: true };
  return Promise.resolve({ ok: true, status: 200, json: async () => answer });
};
const { client } = await import('./ui-driver.ts');
const ui = await client();
const loc = globalThis.location as unknown as { search: string; href: string };
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

test('1341 §1 the page subscribes', () => {
  const sent = ui.sent();
  assert.deepEqual(sent.filter(m => m['t'] === 'cube'), [{ t: 'cube', op: 'sub', code: 'QZXV', token: 'tok1' }]);
  assert.match(ui.html(), /class="[^"]*cubepage"/, 'the cube page owns #app, not the home');
});

test('1341 §2 the pushed view is drawn', () => {
  let html = ui.push({ t: 'cube', view: eventView('lobby', { me: 'u9', joined: false }) });
  assert.match(html, /Seats <span class="dim">3 of 8<\/span>/);
  assert.match(html, /data-btn="cube-join"/);
  html = ui.push({ t: 'cube', view: eventView('lobby', { me: 'u9', joined: false, players: PLAYERS }) });
  assert.match(html, /Seats <span class="dim">4 of 8<\/span>/, 'the newer view replaces it');
  html = ui.push({ t: 'cube', error: 'the table is full' });
  assert.match(html, /the table is full/);
});

test('1341 §3 a match is found: the banner', () => {
  ui.push({ t: 'cube', view: eventView('playing') });
  const html = ui.push({ t: 'cube', matched: match('r2p1', 2, 0, 3, 'waiting') });
  assert.match(html, /Your match is ready: <b>vs Di<\/b>/);
  assert.doesNotMatch(ui.click({ btn: 'cube-banner-close' }), /Your match is ready:/);
});

test('1341 §4 the tabs, and an op over HTTP', async () => {
  let html = ui.click({ btn: 'cube-tab', v: 'players' });
  assert.match(html, /data-scroll="cube-tab-players"/);
  html = ui.click({ btn: 'cube-tab', v: 'matches' });
  assert.match(html, /data-scroll="cube-tab-matches"/);
  ui.push({ t: 'cube', view: eventView('lobby', { me: 'u9', joined: false }) });
  ui.click({ btn: 'cube-join' });
  await settle();
  const join = posts.find(p => p.url === '/api/cube/QZXV/join');
  assert.ok(join, 'Join posts to the event');
  assert.match(String(join.auth), /tok1/, 'as me');
});

test('1341 §5 Play opens the room as a seat, the event on the link', async () => {
  ui.push({ t: 'cube', view: eventView('playing') });
  ui.click({ btn: 'cube-play', pairing: 'r2p1' });
  await settle();
  assert.deepEqual(posts.find(p => p.url === '/api/cube/QZXV/play')?.body, { pairing: 'r2p1' });
  assert.equal(loc.search, '?ws=1&room=RM1&seat=1&mode=constructed&cc=1&cube=QZXV');
});

test('1341 §6 the draft', () => {
  const drafting = eventView('drafting', {
    draft: { packNo: 1, pickNo: 1, packs: 3, packSize: 13, direction: 'left', seats: [], pack: ['Fire Spirit', 'Golem'], deadline: null,
      reserved: null, suggest: 'Golem', picks: [] },
  });
  let html = ui.push({ t: 'cube', view: drafting });
  assert.match(html, /cdpage/, 'the pick screen (ui/cubedraft.ts) is what a drafter sees');
  ui.sent();
  html = ui.click({ btn: 'cube-close' });
  assert.match(html, /data-btn="cube-draft-show"/, 'its Back is the event page, with the way back to the draft');
  assert.doesNotMatch(html, /cdpage/);
  html = ui.click({ btn: 'cube-draft-show' });
  assert.match(html, /cdpage/);
});

test('1341 §7 leaving unsubscribes', () => {
  ui.push({ t: 'cube', view: eventView('lobby') });
  ui.sent();
  const html = ui.click({ btn: 'cube-back' });
  assert.deepEqual(ui.sent().filter(m => m['t'] === 'cube'), [{ t: 'cube', op: 'unsub' }], 'my events need no socket');
  assert.match(html, /class="[^"]*cubepage"/, 'my events');
  const home = ui.click({ btn: 'cube-close' });
  assert.match(home, /homepage/, 'and Home is the home');
});
