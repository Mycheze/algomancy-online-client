/* 1364 · THE DRAFT ENDS IN THE BUILDER (ui/cube.ts, docs/25 §13) — owner, 2026-11-14: "After the
 * draft, you should first be dropped into deck building, not standings". Driven through the client.
 *
 *   §1 the last pick: the view turns drafting → building and the builder is up at once, on the
 *      draft's table (every pick in the main deck); Back from it is the event page, and the next
 *      push leaves it there
 *   §2 coming to the event in building with no deck in: the builder; with a deck in: the event page
 *   §3 a move on the table is sent to be kept — once, after the moves stop (POST …/arrange)
 *
 * Seeds: none.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';
import type { CubeDraftView } from '../../server/cube-types.ts';
import { eventView } from './cube-fixture.ts';

const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '?cube=qzxv';
g['__UI_DRIVER_STORE'] = { algoToken: 'tok1' };
const posts: { url: string; body: unknown }[] = [];
g['__UI_DRIVER_FETCH'] = (url: string, init?: { method?: string; body?: string }) => {
  if (init?.method !== 'POST' || !url.startsWith('/api/cube/')) return new Promise(() => {});
  posts.push({ url, body: JSON.parse(init.body ?? '{}') });
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
};
const { client } = await import('./ui-driver.ts');
const ui = await client();
// the way in from the home and the Join sheet (the driver's #app is the same client's)
const { openCube } = await import('../cube.ts');

const POOL = DECK_LIST.slice(200, 239);
const draft = (picks: string[]): CubeDraftView => ({
  packNo: 3, pickNo: 13, packs: 3, packSize: 13, direction: 'left', seats: [], pack: [POOL[38]!],
  deadline: null, reserved: null, suggest: null, picks,
});

test('1364 §1 the last pick lands me in the builder', () => {
  let html = ui.push({ t: 'cube', view: eventView('drafting', { draft: draft(POOL.slice(0, 38)), myPool: null }) });
  assert.match(html, /cdpage/, 'drafting: the pick screen');
  html = ui.push({ t: 'cube', view: eventView('building', { myPool: POOL }) });
  assert.match(html, /class="[^"]*ttpage"/, 'the builder, at once');
  assert.doesNotMatch(html, /cdpage/);
  assert.match(html, /data-btn="tt-cube-submit"/);
  assert.equal((html.match(/data-tt-src="pile\|/g) ?? []).length, 39, 'every pick on the table, the last one too');
  html = ui.click({ btn: 'tt-close' });
  assert.match(html, /cubepage/, 'Back: the event page');
  html = ui.push({ t: 'cube', view: eventView('building', { myPool: POOL, players: [] }) });
  assert.match(html, /cubepage/, 'and a push leaves it there');
});

test('1364 §2 coming to the event while building', () => {
  ui.click({ btn: 'cube-back' });
  openCube('QZXV');
  let html = ui.push({ t: 'cube', view: eventView('building', { myPool: POOL }) });
  assert.match(html, /data-btn="tt-cube-submit"/, 'no deck in yet: the builder');
  ui.click({ btn: 'tt-close' });
  ui.click({ btn: 'cube-back' });
  openCube('QZXV');
  html = ui.push({ t: 'cube', view: eventView('building', { myPool: POOL, myDeck: { main: POOL.slice(0, 30), side: [] } }) });
  assert.match(html, /cubepage/, 'a deck in: the event page');
});

test('1364 §3 a move is kept, once, after the moves stop', () => {
  let html = ui.click({ btn: 'cube-build' });
  assert.match(html, /data-btn="tt-cube-submit"/);
  posts.length = 0;
  ui.click({ btn: 'tt-addpile' });
  ui.click({ btn: 'tt-addpile' });
  assert.equal(posts.filter(p => p.url.endsWith('/arrange')).length, 0, 'not at once');
  ui.tick();   // the moves stopped: the debounce's one timer runs
  const sent = posts.filter(p => p.url === '/api/cube/QZXV/arrange');
  assert.equal(sent.length, 1, 'one send for the two moves');
  assert.equal((sent[0]!.body as { from: string }).from, 'build');
  html = ui.click({ btn: 'tt-close' });
});
