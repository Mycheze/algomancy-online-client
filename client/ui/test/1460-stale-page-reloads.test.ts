/* 1460 — a page outside any room reloads when the server says it serves another bundle
 * (ui/build.ts, read off the bell's poll). */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't1460' };
g['__UI_DRIVER_FETCH'] = async (url: string) => (url.startsWith('/api/inbox')
  ? { status: 200, headers: { get: (k: string) => (k === 'x-algo-build' ? 'bbbbbbbbbbbb' : null) }, json: async () => ({ ok: true }) }
  : new Promise(() => {}));
await import('./ui-driver.ts');
const { installBuildCheck } = await import('../build.ts');
const { pollInboxNow } = await import('../inbox.ts');
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test('the home page, built as aaaaaaaaaaaa, reloads when the server serves bbbbbbbbbbbb', async () => {
  let reloads = 0;
  (location as unknown as { reload: () => void }).reload = () => { reloads++; };
  await flush();
  installBuildCheck({ own: 'aaaaaaaaaaaa' });
  pollInboxNow();
  await flush();
  assert.equal(reloads, 1);
});
