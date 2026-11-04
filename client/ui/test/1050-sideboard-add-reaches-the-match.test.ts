/* 1050 — ADDING TO THE SIDEBOARD, THE WAY THE OWNER DID IT (2026-11-03:
 * "Adding cards to your sideboard isn't working. They're not showing up in
 * the SB.")
 *
 * What went wrong: on the tabletop an EMPTY Sideboard pile was its header and
 * nothing else — 36px — with the Maybe pile under it filling the rest of the
 * column. A card dropped on the sideboard landed in Maybe. The owner's dev deck
 * said exactly that: `sideboard: []`, and two binder cards in its maybeboard.
 * On the deck page the Sideboard tab had no add control at all.
 *
 *   §1 the empty Sideboard pile keeps one card's room, outlined — a drop slot
 *      as tall as a card, so the column under its header IS the sideboard
 *   §2 every add route, end to end through the REAL deck routes
 *      (server/api-decks.ts over server/collection.ts, in process). BL-65
 *      (2026-11-04) took the deck page's Sideboard tab, its drawers and its
 *      tiles' SB away; the routes now are the builder's: the pool with its
 *      Add to switch on Side (the owner's own route, the old binder SB), and a
 *      deck card's menu To sideboard (a move — one more card into the deck
 *      keeps it at thirty). Each card is in the sideboard, and still there
 *      after the collection is fetched again
 *   §3 and it reaches the match: the Competitive registration's deck verdict
 *      (server/match.ts registrationFor) carries that sideboard
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { register, useAccountsFile } from '../../server/accounts.ts';
import { deckRoutes } from '../../server/api-decks.ts';
import { decksOf } from '../../server/collection.ts';
import { registrationFor } from '../../server/match.ts';

const root = mkdtempSync(join(tmpdir(), 'algo-1050-'));
const restoreAccounts = useAccountsFile(join(root, 'accounts.json'));
test.after(() => { restoreAccounts(); rmSync(root, { recursive: true, force: true }); });

const made = register('Sideboarder1050', 'a good password');
if (!made.ok) throw new Error(made.error);
const me = made.account;
const DECK = decksOf(me)[0]!;                 // a starter: thirty singles
const MAIN0 = [...DECK.cards];

/** the deck routes, called in process: no port, no timers */
async function route(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<unknown> {
  const req = Readable.from(init?.body ? [init.body] : []) as unknown as IncomingMessage;
  req.method = init?.method ?? 'GET';
  req.headers = Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  let status = 200, text = '';
  const done = new Promise<void>(resolve => {
    const res = {
      writeHead(s: number) { status = s; return res; },
      setHeader() { return res; },
      end(b?: string) { text = b ?? ''; resolve(); },
    };
    void deckRoutes(req, res as unknown as ServerResponse, url).then(ours => { if (!ours) { status = 404; resolve(); } });
  });
  await done;
  return { status, json: async () => JSON.parse(text || '{}') };
}

const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '';
g['__UI_DRIVER_STORE'] = { algoToken: made.token };
g['__UI_DRIVER_FETCH'] = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
  url.startsWith('/api/decks') ? route(url, init) : new Promise(() => {});
const { home } = await import('./ui-driver.ts');
const ui = home();
/** let the in-process request and its answer run (the driver owns setTimeout) */
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
await settle();
ui.click({ btn: 'deck-openpage' });
await settle();

const pileOf = (html: string, zone: string): string =>
  new RegExp(`<section class="ttpile[^"]*" data-tt-zone="${zone}"[\\s\\S]*?</section>`).exec(html)?.[0] ?? '';
const namesIn = (pile: string): string[] => [...pile.matchAll(/data-tt-i="\d+" data-card="([^"]+)"/g)].map(m => m[1]!);
/** the preview's sideboard count */
const sideCount = (html: string): string => /<span>Side (\d+\/7) ·/.exec(html)?.[1] ?? '';
/** a card the button offers that is in neither board */
const freshFrom = (html: string, attr: string, taken: readonly string[]): string => {
  const hit = [...html.matchAll(new RegExp(`${attr} data-card="([^"]+)"`, 'g'))].map(m => m[1]!)
    .find(n => !MAIN0.includes(n) && !taken.includes(n));
  assert.ok(hit, `a fresh card behind ${attr}`);
  return hit!;
};
const ADDED: string[] = [];

test('§1 the empty Sideboard pile keeps a card\'s room — somewhere to drop', () => {
  assert.match(ui.html(), /data-btn="deck-tabletop"/);
  const html = ui.click({ btn: 'deck-tabletop' });
  const ch = Number(/--ch:(\d+(?:\.\d+)?)px/.exec(html)?.[1]);
  assert.ok(ch > 0, 'the table says how tall a card is');
  const side = pileOf(html, 'side');
  assert.ok(side, 'the table has a Sideboard pile');
  assert.equal(namesIn(side).length, 0, 'and it is empty');
  const fan = /<div class="ttfan([^"]*)" style="height:([\d.]+)px">/.exec(side);
  assert.ok(fan, 'its fan is drawn');
  assert.match(fan[1]!, /\bttslot\b/, 'outlined as a slot');
  assert.equal(Number(fan[2]), ch, 'as tall as a card, not a bare header');
  // the Maybe pile is the rest of the column already: it keeps its own look
  assert.doesNotMatch(pileOf(html, 'maybe'), /ttslot/);
});

test('§2 every add route puts the card in the sideboard, and a refetch still has it', async () => {
  // the pool, its switch on Side: a tap adds a copy there (the owner's own route)
  let html = ui.click({ btn: 'tt-target', to: 'side' });
  const viaPool = freshFrom(html, 'data-btn="tt-add" data-tt-src="binder\\|[^"]+"', ADDED);
  html = ui.click({ btn: 'tt-add', 'tt-src': `binder|${viaPool}` });
  ADDED.push(viaPool);
  assert.deepEqual(namesIn(pileOf(html, 'side')), [viaPool], 'on the table');
  const viaPool2 = freshFrom(html, 'data-btn="tt-add" data-tt-src="binder\\|[^"]+"', ADDED);
  html = ui.click({ btn: 'tt-add', 'tt-src': `binder|${viaPool2}` });
  ADDED.push(viaPool2);
  // a deck card's menu: To sideboard moves a copy across
  const moved = MAIN0[0]!;
  const src = [...html.matchAll(/data-tt-src="(pile\|[^"]+)"/g)].map(m => m[1]!).find(k => k.endsWith(`|${moved}`))!;
  ui.click({ 'tt-src': src });
  html = ui.click({ btn: 'tt-toside' });
  ADDED.push(moved);
  assert.deepEqual(namesIn(pileOf(html, 'side')), ADDED, 'three in the sideboard, in the order they came');
  // one more card into the deck keeps it at thirty: the switch back on Deck
  ui.click({ btn: 'tt-target', to: 'deck' });
  html = ui.html();
  const refill = freshFrom(html, 'data-btn="tt-add" data-tt-src="binder\\|[^"]+"', ADDED);
  ui.click({ btn: 'tt-add', 'tt-src': `binder|${refill}` });
  ui.click({ btn: 'tt-close' });
  ui.tick();                                   // the save's debounce
  await settle();
  // the server's copy, and the page's after a fresh fetch
  assert.deepEqual([...(decksOf(me).find(d => d.id === DECK.id)!.sideboard ?? [])].sort(), [...ADDED].sort(), 'stored');
  html = ui.click({ btn: 'deck-refresh' });
  await settle();
  html = ui.click({ btn: 'deck-open', id: DECK.id });
  assert.equal(sideCount(html), '3/7', 'the Decks page counts them after a refetch');
  html = ui.click({ btn: 'deck-tabletop' });
  assert.deepEqual([...namesIn(pileOf(html, 'side'))].sort(), [...ADDED].sort(), 'and the table shows them');
  ui.click({ btn: 'tt-close' });
});

test('§3 the registration\'s deck verdict carries that sideboard', () => {
  const reg = registrationFor(me.id, DECK.id, null, null);
  assert.ok(!('error' in reg), `registrable: ${'error' in reg ? reg.error : ''}`);
  assert.deepEqual([...reg.side].sort(), [...ADDED].sort());
  assert.equal(reg.main.length, 30);
  assert.ok(!reg.main.includes(ADDED[2]!), 'the moved copy left the main deck');
});
