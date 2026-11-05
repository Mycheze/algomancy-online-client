/* THE BUILDER'S HEAD ROW IS NOT A PLACE TO PUT A CARD (CT-521).
 *
 * The row over the piles — MAIN DECK n, + Pile, Re-sort — sits inside the
 * table's region, and the region's bare felt means "a new pile at the end".
 * So a card let go over the head row made a pile after the last one, which
 * reads as a stray pile nobody asked for. The head row is now its own `off`
 * zone: a drag there flies home, a tap there with a picked card does nothing,
 * and the bare felt below it still makes a new pile.
 *
 *   §1 markup: the head row carries data-tt-zone="off", inside the table's end zone
 *   §2 a drag over the head row (its + Pile button) has no drop zone: the card flies home
 *   §3 a drag over the bare felt still lands in the end slot (the felt is unchanged)
 *   §4 Move…, then a tap on the head row: nothing moves, the card stays picked
 *
 * Seeds: none. The deck is real cards, served by the driver's fetch seam.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const DECK = {
  id: 'd1143', name: 'Head deck', cards: ['Ignis Sprite', 'Good Whale', 'Bumblecrab'],
  maybe: [], sideboard: [], cover: null,
  author: 'you', createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z', problems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
};
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't1143' };
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: [DECK] }) };
  return new Promise(() => {});
};
const { home, elementFor } = await import('./ui-driver.ts');
const { tableDrag } = await import('../tabletop.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

/** the piles on the table, by their zone key */
const piles = (html: string): string[] =>
  [...html.matchAll(/<section class="ttpile[^"]*" data-tt-zone="(pile\|[^"]+)"/g)].map(m => m[1]!);
/** the first card of the first pile, as its data-tt-src */
const firstCard = (html: string): string => {
  const m = /data-tt-src="(pile\|[^"]+)"/.exec(html);
  assert.ok(m, 'the table has a card');
  return m[1]!;
};

/** the drop zone a carried card would get over `over` */
function zoneOver(over: Record<string, string>): HTMLElement | null {
  const html = ui.html();
  const card = elementFor(html, { btn: 'tt-card', 'tt-src': firstCard(html) }) as unknown as HTMLElement;
  const plan = tableDrag.plan(card);
  assert.ok(plan, 'the card may be picked up');
  const zone = plan!.zoneAt(elementFor(html, over) as unknown as Element) as HTMLElement | null;
  tableDrag.ended?.();
  return zone;
}

await flush();
ui.click({ btn: 'deck-openpage' });
await flush();
ui.click({ btn: 'deck-tabletop' });

test('§1 the head row is its own off zone, inside the table’s end zone', () => {
  const html = ui.html();
  assert.match(html, /<div class="tttable"[^>]*data-tt-zone="end"[^>]*>\s*<div class="tthead" data-tt-zone="off" data-btn="tt-to">/);
});

test('§2 a drag over the head row has no drop zone, so the card flies home', () => {
  const before = piles(ui.html());
  assert.ok(before.length > 0);
  assert.equal(zoneOver({ btn: 'tt-addpile' }), null, 'over + Pile: nowhere to drop');
  assert.equal(zoneOver({ btn: 'tt-to', 'tt-zone': 'off' }), null, 'over the bare head row: nowhere to drop');
  assert.deepEqual(piles(ui.html()), before, 'no pile was made');
});

test('§3 the bare felt still means a new pile at the end', () => {
  const felt = zoneOver({ btn: 'tt-to', 'tt-zone': 'end' });
  assert.equal(felt?.dataset['ttZone'], 'end');
});

test('§4 Move…, then a tap on the head row: nothing moves and the card stays picked', () => {
  const before = piles(ui.html());
  const src = firstCard(ui.html());
  ui.click({ btn: 'tt-card', 'tt-src': src });
  ui.click({ btn: 'tt-move' });
  const html = ui.click({ btn: 'tt-to', 'tt-zone': 'off' });
  assert.deepEqual(piles(html), before, 'no new pile');
  const picked = [...html.matchAll(/<div class="ttcard[^"]*ttpicked[^"]*"[^>]*>/g)].map(m => m[0]);
  assert.equal(picked.length, 1, 'one card is picked');
  assert.ok(picked[0]!.includes(`data-tt-src="${src}"`), 'and it is still the one Move… picked');
  ui.click({ btn: 'tt-card', 'tt-src': src }); // a tap on the picked card puts it down
});
