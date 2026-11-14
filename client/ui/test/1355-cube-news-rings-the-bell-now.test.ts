/* 1355 · CUBE NEWS RINGS THE BELL NOW (ui/cube.ts → ui/inbox.ts pollInboxNow) — the walk of 2026-11-14:
 * the bell kept its old count for about a minute after a round's note existed, waiting for its
 * next scheduled poll. The event page knows the moment something moved; it asks the bell then.
 *
 *   §1 bellMoved: a new phase or a new round, not the first view and not a repeat
 *   §2 driven (the real ui/main.ts on `?cube=qzxv`, its socket held by this test): a view whose phase
 *      or round changed, and `matched`, each make one /api/inbox ask at once; a repeat of the same
 *      view makes none
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventView, match } from './cube-fixture.ts';

const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '?cube=qzxv';
g['__UI_DRIVER_STORE'] = { algoToken: 'tok1355' };
let inboxAsks = 0;
g['__UI_DRIVER_FETCH'] = (url: string) => {
  if (url === '/api/inbox' || url.startsWith('/api/inbox?')) {
    inboxAsks++;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, invites: [], requests: [], league: [], times: [], friends: [], decks: [], cube: [] }) });
  }
  return new Promise(() => {});
};
const { bellMoved } = await import('../cube.ts');
const { client } = await import('./ui-driver.ts');
const ui = await client();
const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

test('§1 what counts as news', () => {
  const lobby = { phase: 'lobby', round: 0 } as const;
  assert.equal(bellMoved(null, lobby), false, 'the first view is not news');
  assert.equal(bellMoved(lobby, lobby), false, 'a repeat is not');
  assert.equal(bellMoved(lobby, { phase: 'drafting', round: 0 }), true, 'a new phase is');
  assert.equal(bellMoved({ phase: 'playing', round: 1 }, { phase: 'playing', round: 2 }), true, 'a new round is');
});

test('§2 driven: one ask a change, at once', async () => {
  await settle();
  ui.push({ t: 'cube', view: eventView('building') });
  await settle();
  const base = inboxAsks;
  ui.push({ t: 'cube', view: eventView('building') });
  await settle();
  assert.equal(inboxAsks, base, 'the same view again: no ask');
  ui.push({ t: 'cube', view: eventView('playing', { round: 1 }) });
  await settle();
  assert.equal(inboxAsks, base + 1, 'building → playing: asked at once');
  ui.push({ t: 'cube', view: eventView('playing', { round: 2 }) });
  await settle();
  assert.equal(inboxAsks, base + 2, 'round 1 → 2: asked at once');
  ui.push({ t: 'cube', matched: match('r2p1', 2, 0, 3, 'waiting') });
  await settle();
  assert.equal(inboxAsks, base + 3, 'a match found for me: asked at once');
});
