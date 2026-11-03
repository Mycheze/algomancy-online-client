/* THE SIDEBOARD TAB AND THE COMPETITIVE CHIP (docs/22 §4.5) — ui/decks.ts,
 * driven through the real client.
 *
 *   §1 the deck page has a sideboard tab between the maybeboard and the
 *      games, counting n/7, and a Competitive chip beside the legality line
 *   §2 the tab draws the sideboard as tiles: − and « on every one, + only
 *      under the copy cap counted across BOTH boards
 *   §3 a copy moves to the sideboard and back; an eighth card turns the
 *      chip red with its reason and the count red
 *   §4 the cap across both boards refuses a move that would break it, with
 *      the reason; a move between the boards never is
 *   §5 the save carries the sideboard, and not the swaps nobody edited
 *   §6 the export file carries the sideboard and the swaps
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_LIST } from '../../engine/src/cards/registry.ts';

const N = DECK_LIST.filter(n => /^[A-Za-z ]+$/.test(n)).slice(0, 30);
const MAIN = N.slice(0, 16).flatMap(n => [n, n]);            // 32 cards
const SIDE = N.slice(16, 23);                                // 7 singles
const DECK = {
  id: 'd830', name: 'Side deck', cards: MAIN, maybe: [], sideboard: SIDE,
  swaps: [{ id: 'w1', name: 'vs control', out: [N[0]], in: [N[16]] }],
  cover: null, author: 'you', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z',
  problems: [], ccProblems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
};
const POSTS: { url: string; body: Record<string, unknown> }[] = [];
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: 't830' };
g['__UI_DRIVER_FETCH'] = async (url: string, init?: { body?: string }) => {
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: [DECK] }) };
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

/** the tab buttons' data-tab values, in order */
const tabs = (html: string): string[] => [...html.matchAll(/data-btn="deck-tab" data-tab="(\w+)"/g)].map(m => m[1]!);
/** the tile for `name` in the grid on screen, as markup */
const tileOf = (html: string, name: string): string => {
  const at = html.indexOf(`data-btn="deck-focus" data-card="${name}"`);
  assert.ok(at >= 0, `no tile for ${name}`);
  return html.slice(at, html.indexOf('</span>', html.indexOf('class="dkbtns"', at)));
};
const chip = (html: string): string => /<span class="deckstatus (?:ok|bad) deckcc"[^>]*>[^<]*<\/span>/.exec(html)?.[0] ?? '';

test('§1 a sideboard tab between maybeboard and games, and a Competitive chip', () => {
  const html = ui.html();
  assert.deepEqual(tabs(html), ['cards', 'mana', 'maybe', 'side', 'games']);
  assert.match(html, /data-tab="side">sideboard <span class="acctcount">7\/7<\/span>/, 'counting n/7');
  assert.match(chip(html), /class="deckstatus ok deckcc">Competitive ✓/, 'a 32 + 7 deck is Competitive legal');
});

test('§2 the tab draws the sideboard, + only under the cap across both boards', () => {
  let html = ui.click({ btn: 'deck-tab', tab: 'side' });
  assert.match(html, /<h3>Sideboard <span class="acctcount">7\/7<\/span><\/h3>/);
  for (const n of SIDE) assert.ok(html.includes(`data-btn="deck-from-side" data-card="${n}"`), `${n} has its « into the deck`);
  assert.match(tileOf(html, SIDE[0]!), /data-btn="deck-side-more"/, 'one copy in all: + is offered');
  assert.match(tileOf(html, SIDE[0]!), /data-btn="deck-side-less"/);
  html = ui.click({ btn: 'deck-side-more', card: SIDE[0]! });
  assert.doesNotMatch(tileOf(html, SIDE[0]!), /data-btn="deck-side-more"/, 'two in the sideboard: no +');
  assert.match(tileOf(html, SIDE[0]!), /data-btn="deck-side-less"/, 'and − stays');
  ui.click({ btn: 'deck-side-less', card: SIDE[0]! });
  // one copy on each board is the cap too
  ui.click({ btn: 'deck-tab', tab: 'cards' });
  html = ui.click({ btn: 'deck-to-side', card: N[0]! });
  assert.doesNotMatch(tileOf(html, N[0]!), /data-btn="deck-more"/, 'the deck tile: one here + one there = no +');
  html = ui.click({ btn: 'deck-tab', tab: 'side' });
  assert.doesNotMatch(tileOf(html, N[0]!), /data-btn="deck-side-more"/, 'the sideboard tile: the same');
  ui.click({ btn: 'deck-from-side', card: N[0]! });
});

test('§3 a copy to the sideboard and back; an eighth turns the chip and the count red', () => {
  ui.click({ btn: 'deck-tab', tab: 'cards' });
  let html = ui.click({ btn: 'deck-to-side', card: MAIN[0]! });
  assert.match(html, /data-tab="side">sideboard <span class="acctcount bad">8\/7<\/span>/, '8/7, red');
  assert.match(chip(html), /class="deckstatus bad deckcc"[^>]*>Competitive ✗ · a sideboard holds at most 7 cards \(got 8\)/,
    'the chip says no, and why');
  html = ui.click({ btn: 'deck-tab', tab: 'side' });
  html = ui.click({ btn: 'deck-from-side', card: MAIN[0]! });
  assert.match(chip(html), /Competitive ✓/, 'and back');
  assert.match(html, /<span class="acctcount">7\/7<\/span>/);
});

test('§4 the cap across both boards refuses, with the reason; a move between them never is', () => {
  const two = { main: [N[0]!, N[0]!], side: [] as string[] };
  assert.equal(dk.crossCapRefusal(two, { main: [N[0]!], side: [N[0]!] }), null, 'a move keeps the count');
  assert.equal(dk.crossCapRefusal(two, { main: [N[0]!, N[0]!], side: [N[0]!] }),
    `Max 2 of ${N[0]} across the deck and sideboard.`, 'a third copy into the sideboard is refused');
  assert.equal(dk.crossCapRefusal({ main: [N[0]!, N[0]!], side: [] }, { main: [N[0]!, N[0]!, N[0]!], side: [] }), null,
    'a third copy in the deck alone stays what it was: allowed, and red');
  // through the page: the pinned panel's "to the sideboard" on a card with
  // two in the sideboard already is a refusal, and the status line says so
  ui.click({ btn: 'deck-tab', tab: 'side' });
  ui.click({ btn: 'deck-side-more', card: SIDE[1]! });
  let html = ui.click({ btn: 'deck-side-less', card: SIDE[1]! });
  html = ui.click({ btn: 'deck-focus', card: SIDE[1]! });
  assert.match(html, /data-btn="deck-to-side" data-card="[^"]+">to the sideboard/, 'one copy: the panel offers it');
  ui.click({ btn: 'deck-to-side', card: SIDE[1]! });
  html = ui.html();
  assert.match(tileOf(html, SIDE[1]!), /dkbtns/);
  assert.doesNotMatch(tileOf(html, SIDE[1]!), /data-btn="deck-side-more"/, 'two in the sideboard: no + on it');
  assert.doesNotMatch(html, /data-btn="deck-to-side" data-card="[^"]+">to the sideboard/, 'nor in the panel');
  ui.click({ btn: 'deck-side-less', card: SIDE[1]! });
});

test('§5 the save carries the sideboard, and leaves the swaps alone', () => {
  ui.tick();
  const last = POSTS.filter(p => p.url === '/api/decks/update').at(-1);
  assert.ok(last, 'an edit was saved');
  assert.deepEqual([...(last!.body['sideboard'] as string[])].sort(), [...SIDE].sort(), 'the sideboard as it stands');
  assert.ok(!('swaps' in last!.body), 'swaps nobody edited are not re-sent (a stale one stays as it was)');
});

test('§6 the export file carries the sideboard and the swaps', () => {
  ui.click({ btn: 'deck-settings' });
  const html = ui.click({ btn: 'deck-export', format: 'file' });
  const text = /<textarea class="dkexporttext"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)![1]!
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
  const file = JSON.parse(text) as { version: number; sideboard?: { name: string }[]; swaps?: { name: string }[] };
  assert.equal(file.version, 2);
  assert.deepEqual(file.sideboard?.map(e => e.name).sort(), [...SIDE].sort());
  assert.deepEqual(file.swaps?.map(s => s.name), ['vs control']);
  assert.match(html, /sideboard, swaps/, 'and says so');
});
