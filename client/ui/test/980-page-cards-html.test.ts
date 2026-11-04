/* 980 — THE CARD BROWSER, DRAWN WITHOUT A PAGE (design-system round, 2026-11-03).
 *
 * The browser's markup left ui/cards.ts for pages/cards.ts: cardsView()
 * gathers, cardsHtml(view) draws. This file drives cardsHtml with made-up
 * views and no DOM — node has no `document`, so a cardsHtml that reached for
 * one would throw here. The search itself is real (ui/cardsearch.ts is pure).
 *
 * §1 browsing: the header, the bar, the rail, the grid, every data-btn
 * §2 the list and text views, and the keyboard cursor
 * §3 the syntax sheet, generated from the parser's tables
 * §4 a pinned card: its actions, the published-deck count, its rulings
 * §5 deckbuilding mode: the strip, the per-tile buttons, the copies, no » for a challenge
 * §6 text is escaped: the query, a deck name, a saved search, a ruling
 * §7 nothing matches
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { search } from '../cardsearch.ts';
import { allRows, rowFor } from '../cardindex.ts';
import { CHUNK, cardsHtml, facets, type CardsView } from '../pages/cards.ts';

const CARDS = allRows().filter(r => r.cls === 'card' && r.playable);
const A = CARDS[0]!, B = CARDS[1]!;

function view(over: Partial<CardsView> = {}, q = ''): CardsView {
  return {
    q, res: search(q), cardCount: 450, deck: null, facets: facets(false),
    railOpen: { element: true, cost: true, kind: true }, hints: [], saved: [], helpOpen: false,
    focus: null, focusRow: null, played: 0, rulings: null, cursor: -1, shown: CHUNK, chrome: { signedIn: true, alerts: 0 }, ...over,
  };
}
const btns = (html: string): Set<string> => new Set([...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!));

test('980 §0 positive control: there is no DOM here', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
  // the app frame (pages/frame.ts, 2026-11-04): the shell, its page class last (287)
  assert.match(cardsHtml(view()), /^<div class="ui-app-shell ui-app-shell--contained ui-app-shell--fill apppage framewide cbpage">/);
});

test('980 §1 browsing: header, bar, rail, grid and their buttons', () => {
  const html = cardsHtml(view());
  // the toolbar: Home, the title, the shared tools
  assert.match(html, /<h1 class="frametitle">Cards<\/h1>/);
  assert.match(html, /<button class="ui-icon-button ui-icon-button--stack frameback" data-btn="cards-close" type="button">[\s\S]*?<span class="ui-icon-button__label">Home<\/span><\/button>/);
  assert.match(html, /data-help="rules"/);
  // the three regions that scroll by themselves carry their keys (paintFrame)
  assert.match(html, /<aside class="cbrail" data-scroll="cards-rail">/);
  assert.match(html, /<div class="cbscroll" data-scroll="cards-results-grid">/);
  assert.match(html, /<input id="cb-q" class="cbq"/);
  assert.match(html, /<select id="cb-sort">/);
  for (const b of ['cards-close', 'cards-try', 'cards-help', 'cards-dir', 'cards-view', 'cards-section', 'cards-chip', 'cards-focus', 'cards-more']) {
    assert.ok(btns(html).has(b), `${b} is drawn`);
  }
  assert.doesNotMatch(html, /data-btn="cards-clear"/, 'no × without a query');
  // the grid: one tile per painted card, the hover box's data-prev on each
  const tiles = [...html.matchAll(/<div class="dktile cbtile[^"]*"\s+data-prev="([^"]+)" data-btn="cards-focus"/g)];
  assert.equal(tiles.length, CHUNK, 'a chunk of tiles is painted');
  assert.match(html, new RegExp(`<b>${view().res.total}</b> cards <span class="dim">· showing ${CHUNK}</span>`));
  // only the open rail sections show their chips
  assert.match(html, /<section class="cbsection open">[\s\S]*?Element/);
  assert.match(html, /<section class="cbsection">\s*<button class="cbsectionhead" data-btn="cards-section" data-section="attr">/);
  assert.doesNotMatch(html, /data-section="building"/, 'no "This deck" section outside deckbuilding');
});

test('980 §2 the list and text views, and the keyboard cursor', () => {
  const list = cardsHtml(view({ cursor: 1 }, 'view:list'));
  assert.match(list, /<div class="cblist">/);
  assert.equal([...list.matchAll(/<div class="cbrow sel"/g)].length, 1, 'one row carries the cursor');
  assert.match(list, /<div class="cbrow"\s+data-prev="[^"]+" data-btn="cards-focus"/);
  assert.match(list, /<span class="cbpt">/, 'the stats cell is always drawn');
  const text = cardsHtml(view({}, 'view:text'));
  assert.match(text, /<textarea class="cbtext" readonly/);
  assert.doesNotMatch(text, /cbtile|cbrow/);
  // the views are a segmented control since 2026-11-04
  assert.match(text, /class="ui-segmented__option on" data-btn="cards-view" type="button" data-value="text" aria-pressed="true" data-view="text"/);
  assert.match(text, /data-scroll="cards-results-text"/, 'another view is another scroll: it starts at the top');
});

test('980 §3 the syntax sheet is generated from the parser tables', () => {
  // a sheet over the page since 2026-11-04 (components/sheet.ts): its title is the heading,
  // and the scrim and the ✕ answer to cards-help, which toggled it open
  assert.doesNotMatch(cardsHtml(view()), /cbhelp/);
  const html = cardsHtml(view({ helpOpen: true }));
  assert.match(html, /<div class="ui-sheet [^"]*cbhelp" id="cards-syntax"[\s\S]*Search syntax/);
  assert.match(html, /class="ui-sheet__scrim" data-btn="cards-help"/);
  assert.match(html, /<table class="cbkeys">/);
  assert.match(html, /<div class="cbflags">/);
});

test('980 §4 a pinned card: the panel, its actions, the count, the rulings', () => {
  const html = cardsHtml(view({ focus: A.name, focusRow: A, played: 3, rulings: { name: A.name, lines: ['ruled'] } }));
  assert.match(html, new RegExp(`<div class="cbside" data-scroll="cards-detail-${A.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"><section class="cbdetail">`));
  for (const b of ['cards-unfocus', 'cards-similar', 'cards-rulings', 'cards-copylink', 'meta-openpage', 'meta-stats-open']) {
    assert.ok(btns(html).has(b), `${b} is drawn on the pinned card`);
  }
  assert.match(html, /In 3 published decks —/);
  assert.match(html, /ruled/);
  assert.doesNotMatch(cardsHtml(view({ focus: A.name, focusRow: A })), /published deck/, 'no count line at zero');
  assert.doesNotMatch(cardsHtml(view({ focus: 'Nope', focusRow: null })), /cbdetail/, 'an unknown card pins nothing');
});

test('980 §5 deckbuilding mode', () => {
  const deck = {
    name: 'Mine', noMaybe: false, copies: { [A.name]: 2, [B.name]: 3 },
    summary: { total: 5, legal: false, problems: ['too few'], curve: [{ mana: 2, total: 5 }], elements: { fire: 5 } },
  };
  const v = view({ deck, facets: facets(true), focus: A.name, focusRow: A, railOpen: { building: true } });
  const html = cardsHtml(v);
  // the way back is to the deck, with a back arrow, not Home
  assert.match(html, /data-btn="cards-close" type="button" title="back to Mine">[\s\S]*?ui-icon--back[\s\S]*?<span class="ui-icon-button__label">Deck<\/span>/);
  assert.match(html, /data-btn="cards-toDeck"/, 'the strip has its own way back');
  assert.match(html, /data-section="building"/);
  for (const b of ['cards-add', 'cards-less', 'cards-maybe']) assert.ok(btns(html).has(b), `${b} is drawn`);
  assert.match(html, /<button class="primary" data-btn="cards-add" data-card="[^"]+">add to Mine<\/button>/);
  assert.match(html, /<span class="dkn bad">×3<\/span>/, 'over the cap the count turns red');
  const challenge = cardsHtml({ ...v, deck: { ...deck, noMaybe: true } });
  assert.doesNotMatch(challenge, /data-btn="cards-maybe"/, 'a challenge deck has no maybeboard');
});

test('980 §6 text is escaped', () => {
  const html = cardsHtml(view({
    saved: [{ name: '<b>x</b>', q: 'a"b' }],
    deck: { name: 'Deck <i>', noMaybe: false, copies: {}, summary: { total: 0, legal: true, problems: [], curve: [], elements: {} } },
  }, 'name:"<script>"'));
  assert.doesNotMatch(html, /<script>|<b>x<\/b>|<i>/);
  assert.match(html, /value="name:&quot;&lt;script&gt;&quot;"/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /Deck &lt;i&gt;/);
});

test('980 §7 nothing matches', () => {
  const html = cardsHtml(view({}, 'name:"zzzz no such card"'));
  assert.match(html, /<b>0<\/b> cards/);
  assert.match(html, /Nothing matches\. Loosen a filter/);
  assert.ok(rowFor(A.name), 'positive control: the index is loaded');
});
