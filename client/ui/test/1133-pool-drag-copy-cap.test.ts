/* A DRAG FROM THE POOL STOPS AT THE COPY CAP, THE SAME WAY A TAP DOES (BL-65 F1).
 *
 * The builder's pool sends a new copy into the deck three ways: a tap (`tt-add`),
 * the card menu's Add another (`tt-more`), and a drag. The first builder refused
 * the third copy only on the two taps — a drag of a third Ignis Sprite onto the
 * table landed it (×3, red). The refusal lives in `place()` now, the one door all
 * three go through, so the three cannot drift apart again.
 *
 *   §1 a drag of a third copy onto the table is refused: the drop is not taken,
 *      the deck is the same, and the note is the tap's own words
 *   §2 a drag of a copy under the cap lands (the refusal is the cap, not the drag)
 *   §3 the tap at the cap still refuses with the same note
 *   §4 source: the cap check is inside place(), and no caller checks it beside it
 *
 * Seeds: none. The deck is real cards, served by the driver's fetch seam.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (f: string): string => readFileSync(join(UI, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const DECK = {
  id: 'd1133', name: 'Cap deck', cards: ['Ignis Sprite', 'Ignis Sprite', 'Good Whale'], maybe: [], cover: null,
  author: 'you', createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z', problems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
};
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't1133' };
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: [DECK] }) };
  return new Promise(() => {});
};
const { home, elementFor } = await import('./ui-driver.ts');
const { tableDrag } = await import('../tabletop.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

/** the copies on the table (every pile's cards) */
const onTable = (html: string, card?: string): number =>
  [...html.matchAll(/<section class="ttpile[^"]*" data-tt-zone="pile\|[\s\S]*?<\/section>/g)]
    .reduce((n, m) => n + [...m[0].matchAll(/class="ttcard[^"]*"[^>]*data-card="([^"]+)"/g)]
      .filter(c => !card || c[1] === card).length, 0);
const NOTE = /<div class="ttnote" role="status">Max 2 of Ignis Sprite\.<\/div>/;

/** drag the pool's `card` and drop it on the table's end slot (a new pile) */
function dragToTable(card: string): boolean {
  const html = ui.html();
  // the pool tile is its own drag source (sourceOf's `closest('[data-tt-src]')`;
  // the driver's closest() reads data attributes only, so the plan starts here)
  const tile = elementFor(html, { btn: 'tt-add', 'tt-src': `binder|${card}` }) as unknown as HTMLElement;
  const plan = tableDrag.plan(tile);
  assert.ok(plan, 'it may be picked up');
  const end = elementFor(html, { btn: 'tt-to', 'tt-zone': 'end' }) as unknown as Element;
  const zone = plan!.zoneAt(end) as HTMLElement | null;
  assert.equal(zone?.dataset['ttZone'], 'end', 'the table’s end slot is where it would go');
  return plan!.drop(zone!, 0, 0);
}

await flush();
ui.click({ btn: 'deck-openpage' });
await flush();
ui.click({ btn: 'deck-tabletop' });
// the pool shows its first page; narrow it to the two cards the test drags
ui.click({ btn: 'tt-chip', group: 'kind', value: 'unit' });
ui.click({ btn: 'tt-chip', group: 'el', value: 'fire' });
ui.click({ btn: 'tt-chip', group: 'mana', value: '1' });

test('§1 a drag of a third copy is refused, with the tap’s note', () => {
  const before = ui.html();
  assert.equal(onTable(before, 'Ignis Sprite'), 2);
  assert.equal(dragToTable('Ignis Sprite'), false, 'the drop is not taken: the card flies home');
  tableDrag.ended?.();
  const html = ui.html();
  assert.equal(onTable(html, 'Ignis Sprite'), 2, 'still two');
  assert.equal(onTable(html), 3, 'and nothing else moved');
  assert.match(html, NOTE, 'the note says why, in the tap’s words');
});

test('§2 under the cap, the same drag lands', () => {
  const other = /data-btn="tt-add" data-tt-src="binder\|([^"]+)"/g;
  const pick = [...ui.html().matchAll(other)].map(m => m[1]!).find(n => n !== 'Ignis Sprite');
  assert.ok(pick, 'another fire unit in the pool');
  assert.equal(dragToTable(pick!), true, 'the drop is taken');
  tableDrag.ended?.();
  const html = ui.html();
  assert.equal(onTable(html, pick), 1, 'one copy on the table');
  assert.equal(onTable(html), 4);
  assert.doesNotMatch(html, NOTE, 'and the old note is gone');
  ui.click({ btn: 'tt-undo' });
});

test('§3 the tap at the cap says the same', () => {
  const html = ui.click({ btn: 'tt-add', 'tt-src': 'binder|Ignis Sprite' });
  assert.equal(onTable(html, 'Ignis Sprite'), 2);
  assert.match(html, NOTE);
});

test('§4 the refusal is inside the one door', () => {
  const tt = code('tabletop.ts');
  const place = tt.slice(tt.indexOf('export function place('), tt.indexOf('export function tabletopChanged('));
  assert.match(place, /const capped = capNote\(h, carry, to\);\s*if \(capped\) \{ note = capped; paintPending = true; return false; \}/,
    'place() refuses a new copy at the cap, before anything is taken or put');
  assert.equal([...tt.matchAll(/capNote\(/g)].length, 2, 'its definition and place(): no caller checks beside it');
});
