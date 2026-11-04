/* THE SIDEBOARD PILE ON THE TABLETOP (docs/22 §4.5) — ui/tabletop.ts and
 * ui/binder.ts, driven through the real client.
 *
 *   §1 a Sideboard pile at the table's edge (the rail, BL-65), above Maybe, its header n/7
 *   §2 every move has a tap: a finger takes a deck card to the sideboard
 *      (the bar's Sideboard, or a tap on the pile) and back (To deck)
 *   §3 the binder's SB adds a copy to the sideboard; a ninth card reads 8/7
 *      and the count turns red
 *   §4 a copy the cap across both boards forbids is refused, and the table
 *      says why
 *   §5 the save carries the sideboard the table built
 *   §6 the drag is the same door: a drop is a place(), and the side zone is a
 *      legal drop for a card and only with a host that has a sideboard
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (f: string): string => readFileSync(join(UI, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 30);
const MAIN = N.slice(0, 15).flatMap(n => [n, n]);            // 30 cards
const SIDE = N.slice(15, 17);                                // 2 singles
const DECK = {
  id: 'd831', name: 'Table side deck', cards: MAIN, maybe: [], sideboard: SIDE, cover: null,
  author: 'you', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', problems: [], ccProblems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
};
const POSTS: { url: string; body: Record<string, unknown> }[] = [];
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '?table=d831';
g['__UI_DRIVER_STORE'] = { algoToken: 't831' };
g['__UI_DRIVER_FETCH'] = async (url: string, init?: { body?: string }) => {
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: [DECK] }) };
  if (init?.body) POSTS.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
await flush();

/** a zone's pile markup */
const pileOf = (html: string, zone: string): string => {
  const m = new RegExp(`<section class="ttpile[^"]*" data-tt-zone="${zone.replace(/\|/g, '\\|')}"[\\s\\S]*?</section>`).exec(html);
  return m?.[0] ?? '';
};
const namesIn = (pile: string): string[] => [...pile.matchAll(/data-tt-i="\d+" data-card="([^"]+)"/g)].map(m => m[1]!);
const srcsIn = (pile: string): string[] => [...pile.matchAll(/data-tt-src="([^"]+)"/g)].map(m => m[1]!);
const deckCount = (html: string): number => [...html.matchAll(/<section class="ttpile[^"]*" data-tt-zone="pile\|[\s\S]*?<\/section>/g)]
  .reduce((n, m) => n + namesIn(m[0]).length, 0);
const firstPile = (html: string): string => /data-tt-zone="(pile\|[^"]+)"/.exec(html)![1]!;

test('§1 a Sideboard pile at the edge, above Maybe, n/7', () => {
  const html = ui.html();
  const side = pileOf(html, 'side');
  assert.ok(side, 'the table has a Sideboard pile');
  assert.match(side, /class="ttpile ttsidepile"/);
  assert.match(side, /<span class="ttpilelabel">Sideboard<\/span>/);
  assert.match(side, /class="ttpilecount">2\/7</, 'its header counts n/7');
  assert.deepEqual(namesIn(side), SIDE);
  // BL-65: the edge is the table's rail (pages/table.ts), the sideboard first
  const edge = /<aside class="ttrail"[^>]*><div class="ttrailbox ttrailside"><section class="ttpile ttsidepile"/.exec(html);
  assert.ok(edge, 'at the same edge as Maybe: the rail');
  assert.ok(html.indexOf('data-tt-zone="side"') < html.indexOf('data-tt-zone="maybe"'), 'above it');
  assert.equal(deckCount(html), 30, 'the sideboard is not counted in the deck');
});

test('§2 a finger moves a card to the sideboard and back', () => {
  let html = ui.html();
  const src = srcsIn(pileOf(html, firstPile(html)))[0]!;
  const name = src.split('|').slice(3).join('|');
  html = ui.tap({ 'tt-src': src });
  assert.match(html, /class="ttselbar"[\s\S]*?data-btn="tt-toside"[^>]*>Sideboard</, 'its bar offers the sideboard');
  html = ui.click({ btn: 'tt-toside' });
  assert.equal(deckCount(html), 29, 'off the deck');
  assert.deepEqual(namesIn(pileOf(html, 'side')), [...SIDE, name], 'onto the sideboard, at its end');
  assert.match(pileOf(html, 'side'), /class="ttpilecount">3\/7</);
  // and back, by the bar's To deck
  html = ui.tap({ 'tt-src': srcsIn(pileOf(html, 'side'))[2]! });
  assert.match(html, /data-btn="tt-todeck"[^>]*>To deck</);
  html = ui.click({ btn: 'tt-todeck' });
  assert.equal(deckCount(html), 30);
  assert.deepEqual(namesIn(pileOf(html, 'side')), SIDE);
  // a tap on the pile itself is a drop there
  ui.tap({ 'tt-src': srcsIn(pileOf(html, firstPile(html)))[0]! });
  html = ui.tap({ btn: 'tt-to', 'tt-zone': 'side' });
  assert.equal(namesIn(pileOf(html, 'side')).length, 3, 'tapping the pile drops it there');
  ui.tap({ 'tt-src': srcsIn(pileOf(html, 'side'))[2]! });
  html = ui.click({ btn: 'tt-todeck' });
  assert.equal(deckCount(html), 30);
});

test('§3 the binder adds to the sideboard; past seven the count is red', () => {
  let html = ui.html();
  assert.match(html, /data-dd="side" data-card="[^"]+" aria-label="to the sideboard">SB</, 'every binder tile has SB');
  // six cards the binder shows that are in neither board
  const fresh = [...new Set([...html.matchAll(/data-dd="side" data-card="([^"]+)"/g)].map(m => m[1]!))]
    .filter(n => /^[A-Za-z ]+$/.test(n) && !MAIN.includes(n) && !SIDE.includes(n)).slice(0, 6);
  assert.equal(fresh.length, 6);
  for (const n of fresh) html = ui.click({ dd: 'side', card: n });
  const side = pileOf(html, 'side');
  assert.deepEqual(namesIn(side), [...SIDE, ...fresh]);
  assert.match(side, /class="ttpilecount bad">8\/7</, '8/7, in red');
  assert.equal(deckCount(html), 30, 'the deck is untouched');
  html = ui.click({ dd: 'pin', card: fresh[0]! });
  assert.match(html, /1 in the sideboard/, 'the pinned card says where its copy is');
  assert.match(html, /data-dd="side" data-card="[^"]+">\+ Sideboard</);
});

test('§4 the cap across both boards refuses, and says why', () => {
  const before = ui.html();
  const two = MAIN[0]!;                                       // two in the deck already
  const html = ui.click({ dd: 'side', card: two });
  assert.deepEqual(namesIn(pileOf(html, 'side')), namesIn(pileOf(before, 'side')), 'nothing moved');
  assert.match(html, new RegExp(`<div class="ttnote" role="status">Max 2 of ${two} across the deck and sideboard\\.</div>`),
    'the table says why');
  // and a move between the boards is never refused: the count is the same
  const src = srcsIn(pileOf(html, firstPile(html)))[0]!;
  ui.tap({ 'tt-src': src });
  const after = ui.click({ btn: 'tt-toside' });
  assert.doesNotMatch(after, /class="ttnote"/, 'a move goes through, and the note goes');
  assert.equal(deckCount(after), 29);
});

test('§5 Back saves the sideboard the table built', () => {
  const html = ui.click({ btn: 'tt-close' });
  assert.match(html, /<div class="deckpage"/);
  const last = POSTS.filter(p => p.url === '/api/decks/update').at(-1);
  assert.ok(last, 'the table’s edits were saved');
  assert.equal((last!.body['sideboard'] as string[]).length, 9);
  assert.equal((last!.body['cards'] as string[]).length, 29);
});

test('§6 a drop is the same door, and the side zone is a card’s to drop on', () => {
  const tt = code('tabletop.ts');
  const legal = tt.slice(tt.indexOf('function legalZone('));
  assert.match(legal, /case 'side': return !!h\.side;/, 'a drop on the sideboard needs a host that has one');
  assert.match(tt, /if \(kind === 'side'\) return \{ at: 'side' \};/, 'a tap on the pile is a place()');
  assert.match(tt, /case 'tt-toside': put\(\{ at: 'side' \}\); return true;/, 'the bar’s Sideboard is a place()');
  assert.match(tt, /toSide: \(name: string\) => \{ if \(!place\(h, \{ from: 'binder', name \}, \{ at: 'side' \}\)\) paint\(\); \}/,
    'the binder’s SB is a place()');
  assert.match(tt, /const why = h\.refuse\?\.\(next\) \?\? null;\s*if \(why\) \{ note = why; paintPending = true; return false; \}/,
    'the host refuses inside place(), before its one commit');
  assert.match(code('decks.ts'), /refuse: next => \{[\s\S]*?crossCapRefusal\(/, 'and the deck page’s rule is the cap across both');
});
