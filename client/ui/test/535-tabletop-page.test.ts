/* THE TABLETOP IS A PAGE OF ITS OWN (ui/tabletop.ts), driven through ui/main.ts.
 *
 * Owner, 2026-10-21, on v1's table inside the deck page: "The builder doesn't
 * need to be integrated into the pages. it can be its whole own page and
 * layout." So, through the real client:
 *
 *   §1 a reload on `?table=<deck id>` lands on the table (the URL is how a
 *      reload comes back; the buttons are the real way in — the owner uses an
 *      installed web app with no address bar)
 *   §2 its root class is `ttpage`, the LAST class (ui/report.ts's pageOf
 *      names the page by it) — with a card picked up too
 *   §3 Back returns to the deck page; the deck page offers "Build on the
 *      table" and nothing else of the table; the button opens it again, and
 *      Back again gives the deck page byte-identical
 *   §4 one mode: piles by cost, and no Sorted / Freeform toggle anywhere
 *   §5 Re-sort lays the table out by type, and Undo puts it back
 *   §6 every scan the page and its binder draw is `draggable="false"`
 *   §7 renderHome asks for the table after the card browser and before the
 *      deck page and the challenge page it sits on
 *
 * The challenge page's button is the challenge host's (ui/challenge.ts).
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
  id: 'd535', name: 'Table deck', maybe: [], cover: null,
  cards: ['Ignis Sprite', 'Ignis Sprite', 'Good Whale', 'Good Whale', 'Fireball'],
  author: 'you', createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z', problems: [],
  record: { games: 0, wins: 0, losses: 0, unresolved: 0, lastPlayed: null },
};
const g = globalThis as Record<string, unknown>;
g['__UI_DRIVER_SEARCH'] = '?table=d535';
g['__UI_DRIVER_STORE'] = { algoToken: 't535' };
g['__UI_DRIVER_FETCH'] = async (url: string) => {
  if (url === '/api/decks') return { status: 200, json: async () => ({ ok: true, decks: [DECK] }) };
  return new Promise(() => {});
};
const { home } = await import('./ui-driver.ts');
const ui = home();
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
await flush();

/** #app's markup alone, without the layers beside it */
const appOf = (html: string): string => {
  const at = html.indexOf('<div class="ddscrim"');
  return at < 0 ? html : html.slice(0, at);
};
/** the pile names on the table, in order */
const piles = (html: string): string[] =>
  [...html.matchAll(/class="ttpilename"[^>]*>([^<]*)</g)].map(m => m[1]!);

test('§1 a reload on ?table= lands on the table', () => {
  const html = ui.html();
  assert.match(html, /<div class="ttpage"/, 'the tabletop page is up');
  assert.match(html, /Table deck/, 'with the deck it was asked for');
  assert.equal((html.match(/class="ttcard/g) ?? []).length, DECK.cards.length, 'every copy a card of its own');
});

test('§2 the root class is ttpage, last, even with a card picked up', () => {
  assert.match(appOf(ui.html()), /^<div class="(?:[\w-]+ )*ttpage"/);
  const src = /data-tt-src="(pile\|[^"]+)"/.exec(ui.html())![1]!;
  const html = ui.tap({ 'tt-src': src });
  assert.match(html, /class="ttselbar"/, 'a finger picked it up');
  assert.match(appOf(html), /^<div class="ttholding ttpage"/, 'and the page is still named ttpage');
  ui.click({ btn: 'tt-putdown' });
});

let deckPage = '';
test('§3 Back to the deck page, the one button there, and back again byte-identical', () => {
  let html = ui.click({ btn: 'tt-close' });
  assert.doesNotMatch(html, /class="ttpage/, 'the table is gone');
  assert.match(html, /<div class="deckpage"/, 'Back lands on the deck page');
  assert.match(html, /data-btn="deck-tabletop"[^>]*>\s*Build on the table/, 'which offers the table');
  assert.doesNotMatch(appOf(html), /class="tt|data-tt-|data-dd=/, 'and nothing else of it');
  deckPage = appOf(html);
  html = ui.click({ btn: 'deck-tabletop' });
  assert.match(html, /<div class="ttpage"/, 'the button opens it');
  html = ui.click({ btn: 'tt-close' });
  assert.equal(appOf(html), deckPage, 'and Back gives the same deck page');
  ui.click({ btn: 'deck-tabletop' });
});

test('§4 one mode: piles by cost, no view toggle', () => {
  const html = ui.html();
  assert.ok(piles(html).length >= 2, `a deck nobody arranged opens as piles by cost: ${piles(html)}`);
  assert.ok(piles(html).every(n => /^(\d+|X)$/.test(n)), `each named by its mana value: ${piles(html)}`);
  assert.doesNotMatch(html, /Sorted|Freeform|data-dt-v=/, 'no Sorted / Freeform view');
  for (const f of ['tabletop.ts', 'piletable.ts', 'binder.ts']) {
    assert.doesNotMatch(code(f), /sortMoves|setView|'freeform'|'sorted'/, `${f} has no second mode`);
  }
});

test('§5 Re-sort by type, then Undo', () => {
  const before = piles(ui.html());
  let html = ui.click({ btn: 'tt-resort', 'tt-by': 'type' });
  assert.ok(piles(html).includes('Units'), `by type: ${piles(html)}`);
  assert.match(html, /data-btn="tt-undo"/, 'with one Undo');
  html = ui.click({ btn: 'tt-undo' });
  assert.deepEqual(piles(html), before, 'Undo puts the table back');
  assert.doesNotMatch(html, /data-btn="tt-undo"/, 'and is spent');
});

test('§6 every scan on the page and in the binder is draggable="false"', () => {
  const html = ui.html();
  const imgs = html.match(/<img\b[^>]*>/g) ?? [];
  assert.ok(imgs.length >= DECK.cards.length, `scans on screen: ${imgs.length}`);
  const bad = imgs.filter((t: string) => !/draggable="false"/.test(t));
  assert.deepEqual(bad.slice(0, 3), [], 'Firefox starts its own image drag on any other');
});

test('§7 renderHome asks for the table between the card browser and the pages under it', () => {
  const main = code('main.ts');
  const home = main.slice(main.indexOf('function renderHome('));
  const at = (s: string): number => home.indexOf(s);
  assert.ok(at('cb.screen()') >= 0 && at('cb.screen()') < at('tt.screen()'), 'after the card browser');
  assert.ok(at('tt.screen()') < at('dk.screen()'), 'before the deck page');
  assert.ok(at('tt.screen()') < at('chal.screen()'), 'before the challenge page');
  assert.match(main, /if \(tt\.handleButton\(btn\)\) return;/, 'its tt- buttons are its own');
  assert.match(main, /tt\.registerTableResolver\('deck', dk\.tabletopHostFor\)/, 'a reload finds the deck');
});
