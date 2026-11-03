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
 *      (server/api-decks.ts over server/collection.ts, in process): the
 *      binder's SB on the table, the Sideboard tab's own add drawer, the cards
 *      drawer's SB and a deck tile's SB — each card is in the sideboard, and
 *      still there after the collection is fetched again
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
/** the sideboard tab's tiles, by name */
const sideTiles = (html: string): string[] =>
  [...html.matchAll(/data-btn="deck-from-side" data-card="([^"]+)"/g)].map(m => m[1]!);
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
  // the table: the binder's SB (the owner's own route), then Back
  let html = ui.html();
  const viaBinder = freshFrom(html, 'data-dd="side"', ADDED);
  html = ui.click({ dd: 'side', card: viaBinder });
  ADDED.push(viaBinder);
  assert.deepEqual(namesIn(pileOf(html, 'side')), [viaBinder], 'on the table');
  ui.click({ btn: 'tt-close' });
  await settle();
  // the Sideboard tab: its own add drawer, whose + is the sideboard's
  html = ui.click({ btn: 'deck-tab', tab: 'side' });
  assert.match(html, /data-btn="deck-adding">\+ Add cards to the sideboard</, 'the sideboard tab can add');
  assert.doesNotMatch(html, /data-btn="deck-browse"/, 'and does not offer the browser, which adds to the deck');
  html = ui.click({ btn: 'deck-adding' });
  assert.doesNotMatch(/<div id="dk-results"[\s\S]*$/.exec(html)![0], /data-btn="deck-add"/, 'its + is not the deck\'s');
  assert.doesNotMatch(html, /data-btn="deck-browse"/, 'open, no browse either');
  const viaSideDrawer = freshFrom(html, 'data-btn="deck-add-side"', ADDED);
  html = ui.click({ btn: 'deck-add-side', card: viaSideDrawer });
  ADDED.push(viaSideDrawer);
  ui.click({ btn: 'deck-adding-close' });
  // the cards tab: the drawer's SB, and a deck tile's SB (a move — so one more
  // card into the deck keeps it at thirty)
  html = ui.click({ btn: 'deck-tab', tab: 'cards' });
  html = ui.click({ btn: 'deck-adding' });
  const viaDrawerSb = freshFrom(html, 'data-btn="deck-add-side"', ADDED);
  ui.click({ btn: 'deck-add-side', card: viaDrawerSb });
  ADDED.push(viaDrawerSb);
  const moved = MAIN0[0]!;
  ui.click({ btn: 'deck-to-side', card: moved });
  ADDED.push(moved);
  html = ui.html();
  const refill = freshFrom(html, 'data-btn="deck-add"', ADDED);
  ui.click({ btn: 'deck-add', card: refill });
  ui.tick();                                   // the save's debounce
  await settle();
  // the server's copy, and the page's after a fresh fetch
  assert.deepEqual([...(decksOf(me).find(d => d.id === DECK.id)!.sideboard ?? [])].sort(), [...ADDED].sort(), 'stored');
  ui.click({ btn: 'deck-refresh' });
  await settle();
  html = ui.click({ btn: 'deck-tab', tab: 'side' });
  assert.deepEqual(sideTiles(html).sort(), [...ADDED].sort(), 'shown in the SB after a refetch');
  assert.match(html, /data-tab="side">sideboard <span class="acctcount">4\/7<\/span>/);
});

test('§3 the registration\'s deck verdict carries that sideboard', () => {
  const reg = registrationFor(me.id, DECK.id, null, null);
  assert.ok(!('error' in reg), `registrable: ${'error' in reg ? reg.error : ''}`);
  assert.deepEqual([...reg.side].sort(), [...ADDED].sort());
  assert.equal(reg.main.length, 30);
  assert.ok(!reg.main.includes(ADDED[3]!), 'the moved copy left the main deck');
});
