/* 1334 — THE EVENT PAGE OPENED SIGNED OUT, THEN SIGNED IN (docs/25 §9).
 *
 * The socket's subscription carries the token it was sent with, and the server pushes that
 * account's view. A player who opens the event's link signed out, logs in and presses Join must
 * be subscribed again as themselves (the page repaints on the way back from signing in), or every push (the start, their pool, their pack) is a
 * visitor's view and the builder never opens without a reload.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventView } from './cube-fixture.ts';

const g = globalThis as unknown as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '?cube=qzxv';
g['__UI_DRIVER_STORE'] = {};
g['__UI_DRIVER_FETCH'] = (url: string, init?: { method?: string }) => {
  if (init?.method !== 'POST' || !url.startsWith('/api/cube/')) return new Promise(() => {});
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
};
const { client } = await import('./ui-driver.ts');
const ui = await client();
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
/** every subscription so far, by its token (ui.sent() hands over what is new since the last call) */
const seen: unknown[] = [];
const subs = (): unknown[] => { seen.push(...ui.sent().filter(m => m['t'] === 'cube' && m['op'] === 'sub').map(m => m['token'])); return seen; };

test('1334 signed out, the page subscribes as a visitor', () => {
  assert.deepEqual(subs(), [null]);
  ui.push({ t: 'cube', view: eventView('lobby', { me: null, joined: false }) });
});

test('1334 signed in: the next paint subscribes again as me, once', () => {
  globalThis.localStorage.setItem('algoToken', 'tok-new');
  ui.push({ t: 'cube', view: eventView('lobby', { me: null, joined: false }) });
  assert.deepEqual(subs(), [null, 'tok-new'], 'the second subscription carries the new token');
  ui.push({ t: 'cube', view: eventView('lobby', { me: 'u2' }) });
  ui.push({ t: 'cube', view: eventView('building', { me: 'u2' }) });
  assert.deepEqual(subs(), [null, 'tok-new'], 'no resubscribe while the account is the same');
});
