/* A COPY FROM MAYBE OR THE SIDEBOARD STOPS AT THE COPY CAP, LIKE ONE FROM THE POOL (BL-65 F11).
 *
 * F1 put the cap into `place()` for a new copy from the pool. A copy moving
 * into the deck from Maybe or the Sideboard went round it: "To deck" (or a
 * drag onto the table) landed a third Ignis Sprite, flagged ×3. Now every copy
 * ENTERING the deck asks the same check, with the same note, and nothing moves.
 *
 *   §1 Maybe → To deck at the cap: refused, the note, Maybe and the deck unchanged
 *   §2 Maybe → a drag onto the table at the cap: the drop is not taken
 *   §3 Maybe → To deck under the cap lands (the refusal is the cap, not the move)
 *   §4 Sideboard → deck when the deck already holds two: refused, tap and drag
 *   §5 Sideboard → deck under the cap lands (a copy between the boards adds nothing)
 *   §6 source: one capNote call in place(), for every carry
 *
 * Seeds: none. The deck is real cards, served by the driver's fetch seam. Its
 * sideboard is over the cap on purpose (an imported deck may be) — the only way
 * the deck can hold two while the Sideboard holds a third.
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
  id: 'd1135', name: 'Cap deck', cards: ['Ignis Sprite', 'Ignis Sprite', 'Good Whale'],
  maybe: ['Ignis Sprite', 'Good Whale'], sideboard: ['Ignis Sprite', 'Bumblecrab'], cover: null,
  author: 'you', createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z', problems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
};
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't1135' };
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
/** the cards in one rail box, in order */
const inRail = (html: string, box: 'side' | 'maybe'): string[] =>
  [...html.matchAll(new RegExp(`data-tt-src="${box}\\|\\d+\\|([^"]+)"`, 'g'))].map(m => m[1]!);
const note = (card: string): RegExp => new RegExp(`<div class="ttnote" role="status">Max 2 of ${card}\\.</div>`);

/** tap a rail card (its menu opens), then To deck */
function toDeck(src: string): string {
  ui.click({ btn: 'tt-card', 'tt-src': src });
  return ui.click({ btn: 'tt-todeck' });
}
/** drag a rail card onto the table's end slot (a new pile) */
function dragToTable(src: string): boolean {
  const html = ui.html();
  const card = elementFor(html, { btn: 'tt-card', 'tt-src': src }) as unknown as HTMLElement;
  const plan = tableDrag.plan(card);
  assert.ok(plan, 'it may be picked up');
  const end = elementFor(html, { btn: 'tt-to', 'tt-zone': 'end' }) as unknown as Element;
  const zone = plan!.zoneAt(end) as HTMLElement | null;
  assert.equal(zone?.dataset['ttZone'], 'end', 'the table’s end slot is where it would go');
  const took = plan!.drop(zone!, 0, 0);
  tableDrag.ended?.();
  return took;
}

await flush();
ui.click({ btn: 'deck-openpage' });
await flush();
ui.click({ btn: 'deck-tabletop' });

test('§1 Maybe → To deck at the cap is refused, with the pool’s note', () => {
  assert.equal(onTable(ui.html(), 'Ignis Sprite'), 2);
  const html = toDeck('maybe|0|Ignis Sprite');
  assert.equal(onTable(html, 'Ignis Sprite'), 2, 'still two in the deck');
  assert.deepEqual(inRail(html, 'maybe'), ['Ignis Sprite', 'Good Whale'], 'and the copy stays in Maybe');
  assert.match(html, note('Ignis Sprite'), 'the note says why');
});

test('§2 Maybe → a drag onto the table at the cap is not taken', () => {
  assert.equal(dragToTable('maybe|0|Ignis Sprite'), false, 'the card flies home');
  const html = ui.html();
  assert.equal(onTable(html, 'Ignis Sprite'), 2);
  assert.equal(onTable(html), 3, 'nothing else moved');
  assert.deepEqual(inRail(html, 'maybe'), ['Ignis Sprite', 'Good Whale']);
  assert.match(html, note('Ignis Sprite'));
});

test('§3 Maybe → To deck under the cap lands', () => {
  const html = toDeck('maybe|1|Good Whale');
  assert.equal(onTable(html, 'Good Whale'), 2, 'the second copy is in the deck');
  assert.deepEqual(inRail(html, 'maybe'), ['Ignis Sprite'], 'and out of Maybe');
  assert.doesNotMatch(html, note('Ignis Sprite'));
  ui.click({ btn: 'tt-undo' });
});

test('§4 Sideboard → deck when the deck holds two is refused, tap and drag', () => {
  let html = toDeck('side|0|Ignis Sprite');
  assert.equal(onTable(html, 'Ignis Sprite'), 2, 'still two in the deck');
  assert.deepEqual(inRail(html, 'side'), ['Ignis Sprite', 'Bumblecrab'], 'the copy stays in the Sideboard');
  assert.match(html, note('Ignis Sprite'));
  assert.equal(dragToTable('side|0|Ignis Sprite'), false, 'a drag is refused too');
  html = ui.html();
  assert.equal(onTable(html, 'Ignis Sprite'), 2);
  assert.deepEqual(inRail(html, 'side'), ['Ignis Sprite', 'Bumblecrab']);
});

test('§5 Sideboard → deck under the cap lands', () => {
  assert.equal(dragToTable('side|1|Bumblecrab'), true, 'the drop is taken');
  const html = ui.html();
  assert.equal(onTable(html, 'Bumblecrab'), 1);
  assert.deepEqual(inRail(html, 'side'), ['Ignis Sprite']);
  ui.click({ btn: 'tt-undo' });
});

test('§6 place() asks the cap for every carry, once', () => {
  const tt = code('tabletop.ts');
  const place = tt.slice(tt.indexOf('export function place('), tt.indexOf('export function tabletopChanged('));
  assert.match(place, /const capped = capNote\(h, carry, to\);\s*if \(capped\) \{ note = capped; paintPending = true; return false; \}/,
    'one check, before anything is taken or put');
  assert.match(tt, /carry\.from === 'binder' \|\| carry\.from === 'maybe' \? capCount\(h, name\) >= h\.cap/,
    'a copy from Maybe counts like a new one');
  assert.match(tt, /carry\.from === 'side' \? count\(h\.cards\(\), name\) >= h\.cap/,
    'one from the Sideboard is already counted: it stops when the deck is full');
});
