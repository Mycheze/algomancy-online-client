/* THE SIDEBOARD ON THE DECKS PAGE, AND THE COMPETITIVE CHECK (docs/22 §4.5) — ui/decks.ts,
 * driven through the real client.
 *
 * Rewritten for BL-65 (2026-11-04): the deck page's Sideboard TAB, its tiles with − « +,
 * and the Competitive chip beside the legality line are gone. The sideboard is the rail of
 * the builder's table (831), the Decks page says it in the preview and on the box, and the
 * builder's count pill carries the Competitive problem. What this file guarded survives:
 *
 *   §1 the preview counts Side n/7 and says "Legal · Competitive ready"; the box wears Bo3 ready
 *   §2 an eighth sideboard card: no Bo3 badge, and the preview and the builder's pill say why
 *   §3 a copy to the sideboard and back on the table, and the Decks page follows
 *   §4 the cap across both boards refuses a move that would break it, with the reason; a move
 *      between the boards never is
 *   §5 the save carries the sideboard — and never `swaps`, even from a reply that still has
 *      them (saved swaps were taken out on 2026-11-03)
 *   §6 the export file carries the sideboard, and no swaps
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 30);
const MAIN = N.slice(0, 16).flatMap(n => [n, n]);            // 32 cards
const SIDE = N.slice(16, 23);                                // 7 singles
const base = {
  maybe: [], cover: null, author: 'you', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z',
  problems: [], ccProblems: [], record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
};
const DECK = {
  ...base, id: 'd830', name: 'Side deck', cards: MAIN, sideboard: SIDE,
  // a deck saved while swaps existed — an older reply may still carry them
  swaps: [{ id: 'w1', name: 'vs control', out: [N[0]], in: [N[16]] }],
};
const EIGHT = { ...base, id: 'd8', name: 'Eight', cards: MAIN, sideboard: N.slice(16, 24), updatedAt: '2026-11-01T00:00:00Z' };
const POSTS: { url: string; body: Record<string, unknown> }[] = [];
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't830' };
g['__UI_DRIVER_FETCH'] = async (url: string, init?: { body?: string }) => {
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: [DECK, EIGHT] }) };
  if (init?.body) POSTS.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const dk = await import('../decks.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
await flush();
ui.click({ btn: 'deck-openpage' });
await flush();

const box = (html: string, id: string): string =>
  new RegExp(`<button class="dkbox[^"]*" type="button" data-btn="deck-open" data-id="${id}"[\\s\\S]*?</button>`).exec(html)?.[0] ?? '';
const sideHead = (html: string): string => /<div class="dkprevlisthead">[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
const legal = (html: string): string => /dkprevlegal[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
const pileOf = (html: string, zone: string): string =>
  new RegExp(`<section class="ttpile[^"]*" data-tt-zone="${zone.replace(/\|/g, '\\|')}"[\\s\\S]*?</section>`).exec(html)?.[0] ?? '';
const namesIn = (pile: string): string[] => [...pile.matchAll(/data-tt-i="\d+" data-card="([^"]+)"/g)].map(m => m[1]!);
const srcsIn = (pile: string): string[] => [...pile.matchAll(/data-tt-src="([^"]+)"/g)].map(m => m[1]!);
const firstPile = (html: string): string => /data-tt-zone="(pile\|[^"]+)"/.exec(html)![1]!;

test('§1 the preview counts the sideboard and says it is Competitive ready; so does the box', () => {
  const html = ui.click({ btn: 'deck-open', id: 'd830' });
  assert.match(sideHead(html), /<span>Main deck 32<\/span><span>Side 7\/7 · Maybe 0<\/span>/, 'counting n/7');
  assert.equal(legal(html), 'Legal · Competitive ready', 'a 32 + 7 deck is Competitive legal');
  assert.match(box(html, 'd830'), />Bo3 ready</);
});

test('§2 an eighth card: no badge, and the preview and the builder say why', () => {
  let html = ui.click({ btn: 'deck-open', id: 'd8' });
  assert.doesNotMatch(box(html, 'd8'), /Bo3 ready/);
  assert.match(sideHead(html), /Side 8\/7/);
  assert.equal(legal(html), 'Legal · not Competitive: a sideboard holds at most 7 cards (got 8)', 'the chip says no, and why');
  html = ui.click({ btn: 'deck-tabletop' });
  assert.match(html, /ttpill--warn"[^>]*data-btn="tt-problems"/, 'the builder\'s pill is amber');
  html = ui.click({ btn: 'tt-problems' });
  assert.match(html, /Competitive: a sideboard holds at most 7 cards \(got 8\)/);
  ui.click({ btn: 'tt-sheet-close' });
  ui.click({ btn: 'tt-close' });
});

test('§3 a copy to the sideboard and back on the table, and the Decks page follows', () => {
  ui.click({ btn: 'deck-open', id: 'd830' });
  let html = ui.click({ btn: 'deck-tabletop' });
  const src = srcsIn(pileOf(html, firstPile(html)))[0]!;
  ui.click({ 'tt-src': src });
  html = ui.click({ btn: 'tt-toside' });
  assert.equal(namesIn(pileOf(html, 'side')).length, 8, 'onto the sideboard');
  html = ui.click({ btn: 'tt-close' });
  assert.match(sideHead(html), /Side 8\/7/, 'the preview counts it');
  assert.match(legal(html), /^Legal · not Competitive: a sideboard holds at most 7 cards \(got 8\)$/);
  assert.doesNotMatch(box(html, 'd830'), /Bo3 ready/);
  html = ui.click({ btn: 'deck-tabletop' });
  const back = srcsIn(pileOf(html, 'side')).at(-1)!;
  ui.click({ 'tt-src': back });
  ui.click({ btn: 'tt-todeck' });
  html = ui.click({ btn: 'tt-close' });
  assert.equal(legal(html), 'Legal · Competitive ready', 'and back');
  assert.match(box(html, 'd830'), />Bo3 ready</);
});

test('§4 the cap across both boards refuses, with the reason; a move between them never is', () => {
  const two = { main: [N[0]!, N[0]!], side: [] as string[] };
  assert.equal(dk.crossCapRefusal(two, { main: [N[0]!], side: [N[0]!] }), null, 'a move keeps the count');
  assert.equal(dk.crossCapRefusal(two, { main: [N[0]!, N[0]!], side: [N[0]!] }),
    `Max 2 of ${N[0]} across the deck and sideboard.`, 'a third copy into the sideboard is refused');
  assert.equal(dk.crossCapRefusal({ main: [N[0]!, N[0]!], side: [] }, { main: [N[0]!, N[0]!, N[0]!], side: [] }), null,
    'a third copy in the deck alone stays what it was: allowed, and red');
  // through the table: the host refuses inside the table's one door, and the table says why
  let html = ui.click({ btn: 'deck-tabletop' });
  ui.click({ btn: 'tt-target', to: 'side' });
  html = ui.click({ btn: 'tt-add', 'tt-src': `binder|${N[0]}` });
  assert.equal(namesIn(pileOf(html, 'side')).length, 7, 'nothing moved');
  assert.match(html, new RegExp(`<div class="ttnote" role="status">Max 2 of ${N[0]} across the deck and sideboard\\.</div>`));
  ui.click({ btn: 'tt-target', to: 'deck' });
  ui.click({ btn: 'tt-close' });
});

test('§5 the save carries the sideboard, and never swaps', () => {
  ui.tick();
  const last = POSTS.filter(p => p.url === '/api/decks/update' && p.body['id'] === 'd830').at(-1);
  assert.ok(last, 'an edit was saved');
  assert.deepEqual([...(last!.body['sideboard'] as string[])].sort(), [...SIDE].sort(), 'the sideboard as it stands');
  assert.ok(!('swaps' in last!.body), 'saved swaps are gone: never sent');
});

test('§6 the export file carries the sideboard, and no swaps', () => {
  ui.click({ btn: 'deck-export', format: 'text' });        // the preview's Export opens the sheet
  const html = ui.click({ btn: 'deck-export', format: 'file' });  // and the sheet picks the file
  const text = /<textarea class="dkexporttext"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)![1]!
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
  const file = JSON.parse(text) as { version: number; sideboard?: { name: string }[]; swaps?: { name: string }[] };
  assert.equal(file.version, 2);
  assert.deepEqual(file.sideboard?.map(e => e.name).sort(), [...SIDE].sort());
  assert.ok(!('swaps' in file), 'no swaps in the file');
  assert.match(html, /cover, sideboard, maybeboard/, 'and the note does not promise them');
  assert.doesNotMatch(html, /deck-swap|deck-try|Save as a swap/, 'nor anywhere on the page');
});
