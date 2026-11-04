/* THE SMALLEST SPLIT, THROUGH THE REAL CLIENT (BL-65 fix, 2026-11-04; the
 * layout half is 1137).
 *
 * A player who dragged the pool to its smallest today has 0.12 stored. On the
 * next load the builder still draws the divider with ▲, the grip and ▼, and
 * one ▼ grows the stored split by a whole step. A value below the range (a
 * hand-edited store) is read as the smallest.
 *
 * Seeds: none. The deck is served by the driver's fetch seam; there is no
 * layout here, so ▼ steps from the stored split (1137 §4 covers the drawn one).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPLIT_MIN, SPLIT_STEP } from '../splitter.ts';

const DECK = {
  id: 'd1138', name: 'Split deck', maybe: [], cover: null,
  cards: ['Ignis Sprite', 'Ignis Sprite', 'Good Whale', 'Fireball'],
  author: 'you', createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z', problems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
};
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '?table=d1138';
g['__UI_DRIVER_STORE'] = { algoToken: 't1138', algoBuilderSplit: '0.05' };
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: [DECK] }) };
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const ui = home();
for (let i = 0; i < 20; i++) await Promise.resolve();
const stored = (): number => Number((g['localStorage'] as Storage).getItem('algoBuilderSplit'));

test('a stored split under the range draws as the smallest, with the whole divider', () => {
  const html = ui.html();
  assert.match(html, /<div class="ttbuilder" style="--pool-f:0\.12">/, 'read back as the smallest');
  const div = /<div class="ttdivider">[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
  assert.match(div, /data-btn="tt-split"[^>]*data-by="-1"/, '▲ is there');
  assert.match(div, /data-tt-grip/, 'the grip is there');
  assert.match(div, /data-btn="tt-split"[^>]*data-by="1"/, '▼ is there');
});

test('▼ from the smallest grows the split by a whole step, and ▲ takes it back', () => {
  let html = ui.click({ btn: 'tt-split', by: '1' });
  assert.equal(stored(), Math.round((SPLIT_MIN + SPLIT_STEP) * 1000) / 1000, `stored ${stored()}`);
  assert.match(html, new RegExp(`--pool-f:${stored()}"`), 'and drawn');
  html = ui.click({ btn: 'tt-split', by: '1' });
  assert.ok(stored() > SPLIT_MIN + SPLIT_STEP, 'again');
  html = ui.click({ btn: 'tt-split', by: '-1' });
  html = ui.click({ btn: 'tt-split', by: '-1' });
  assert.equal(stored(), SPLIT_MIN, 'back to the smallest');
  assert.match(html, /class="ttdivider"/, 'and the divider is still there');
});
