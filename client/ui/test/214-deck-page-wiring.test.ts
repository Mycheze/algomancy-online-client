/**
 * The deck page's card grid, the shared panel, and the copy button.
 *
 * TWO KINDS OF TEST IN HERE, and the split is deliberate.
 *
 * The first half is REAL BEHAVIOUR: ui/cardpanel.ts is pure and DOM-free on
 * purpose, so the panel both pages pin can be called and read here the way
 * ui/cardindex.ts and ui/deckstats.ts already are.
 *
 * The second half asserts over the SOURCE, for the same reason
 * 212-card-browser-wiring.test.ts does: ui/decks.ts is a painting layer that
 * builds strings for `$app.innerHTML`, and test/ui-driver.ts reaches main.ts
 * only. The claims below are not formatting — each is a property the module's
 * comments state, each is one edit away from being false, and none of them
 * would break any other test:
 *
 *   1. ONE PANEL. Both pages pin the same card panel. The browser grew one
 *      first and the deck page had none; the failure mode this guards is the
 *      deck page growing a SECOND one, which is how the two card filters
 *      drifted before ui/cardindex.ts existed.
 *   2. THE TILE CAN BE READ. `data-prev` is the whole hover box, and it is one
 *      attribute — an attribute that was missing here for a whole release
 *      while the identical grid in the browser had it.
 *   3. THE CAP IS OFFERED, NOT ENFORCED. At two copies the `+` goes and `−`
 *      stays. Turning it into a refusal would contradict server/collection.ts's
 *      stated commitment that a saved deck may be illegal while you build.
 *   4. ONE CLIPBOARD PATH. The deck page's copy button and main.ts's share
 *      link go through the same helper. They diverged once — one had the
 *      execCommand fallback the plain-http deploy needs and the other did not
 *      — and the duplication is what allowed it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../engine/src/cards/registry.ts';
import { allRows } from '../cardindex.ts';
import { analyzeDeck } from '../deckstats.ts';
import { cardPanelHtml, deckStripHtml, similarQuery } from '../cardpanel.ts';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string): string => readFileSync(join(UI, f), 'utf8');
/** the code with its comments stripped — the comments SAY what the code must
 * not do, so a forbidden-token check that read them would fail on its own
 * documentation. Same helper as 212. */
const code = (f: string): string => read(f)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const CARD = allRows().find(r => r.playable && r.cls === 'card' && r.scripted)!.name;

// ── the shared panel, called for real ─────────────────────────────────

test('the panel prints the card, and nothing at all for one that is not there', () => {
  const html = cardPanelHtml(CARD, { close: 'deck-unfocus' });
  assert.ok(html.includes(CARD), 'the name is on it');
  assert.match(html, /class="cbdetail"/);
  assert.match(html, /data-btn="deck-unfocus"/, 'the × answers to the host that asked');
  assert.equal(cardPanelHtml('Not A Real Card', { close: 'x' }), '',
    'an unknown name is empty, so a host may pass whatever it has focused');
});

test('the panel takes its buttons from the host, and has none of its own', () => {
  const bare = cardPanelHtml(CARD, { close: 'deck-unfocus' });
  assert.doesNotMatch(bare, /cbdetailbtns/, 'no button row when the host offers no buttons');
  const withBtns = cardPanelHtml(CARD, { close: 'deck-unfocus', actions: '<button data-btn="deck-add">add</button>' });
  assert.match(withBtns, /data-btn="deck-add"/);
  // "find similar" is the browser's; the deck page's is "add a copy". Neither
  // is baked in, which is what lets one panel serve both.
  assert.doesNotMatch(bare, /cards-similar/);
});

test('the panel prints an extra line only when the host has one', () => {
  assert.doesNotMatch(cardPanelHtml(CARD, { close: 'x' }), /cbfact">Played in/);
  const withExtra = cardPanelHtml(CARD, { close: 'x', extra: '<div class="cbfact">Played in 3 decks</div>' });
  assert.match(withExtra, /Played in 3 decks/);
});

test('rulings print only when they are for the card on screen', () => {
  const other = allRows().find(r => r.name !== CARD)!.name;
  const mine = cardPanelHtml(CARD, { close: 'x', rulings: { name: CARD, lines: ['R1: it works'] } });
  assert.match(mine, /R1: it works/);
  const stale = cardPanelHtml(CARD, { close: 'x', rulings: { name: other, lines: ['R1: it works'] } });
  assert.doesNotMatch(stale, /R1: it works/, 'a rulings fetch for another card must not leak onto this one');
});

test('the deck strip says the count, the legality and the curve', () => {
  const a = analyzeDeck([CARD, CARD]);
  const strip = deckStripHtml('My Deck', a);
  assert.match(strip, /My Deck/);
  assert.match(strip, /2 cards/);
  assert.match(strip, /class="warn"/, 'two cards is not a legal deck, and it says so');
  assert.match(strip, /cbminicurve/);
  assert.doesNotMatch(strip, /back to the deck/, 'the trailing button is the host’s, not the strip’s');
  assert.match(deckStripHtml('x', a, { trailing: '<button>go</button>' }), /<button>go<\/button>/);
  // "Building" is right where you are editing and wrong on a deck you are only
  // reading, which is why the lead-in is the host's word too
  assert.match(strip, /Building/, 'the default is the deckbuilder’s word');
  assert.match(deckStripHtml('x', a, { lead: 'Deck' }), /Deck <b>x<\/b>/);
});

test('one card is one card, however the strip is asked', () => {
  assert.match(deckStripHtml('x', analyzeDeck([CARD])), /1 card</, 'no stray plural');
});

test('"similar" is one notion, and it is a query you can read', () => {
  const q = similarQuery(CARD);
  assert.match(q, /kind:/, 'it filters by kind');
  assert.match(q, new RegExp(`-name="${CARD.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}"`),
    'and excludes the card itself');
  assert.equal(similarQuery('Not A Real Card'), '', 'and says nothing about a card it does not know');
});

// ── the wiring, asserted over the source ──────────────────────────────

test('both pages pin the SAME panel — neither has one of its own', () => {
  for (const f of ['decks.ts', 'cards.ts']) {
    assert.match(read(f), /from '\.\/cardpanel\.ts'/, `${f} must use the shared panel`);
  }
  // the shape the browser's private copy had: a <section class="cbdetail">
  // built inline. Exactly one file may emit it, and it is not a page.
  for (const f of ['decks.ts', 'cards.ts', 'meta.ts']) {
    assert.doesNotMatch(code(f), /<section class="cbdetail">/,
      `${f} grew its own card panel again`);
  }
  assert.match(read('cardpanel.ts'), /<section class="cbdetail">/, 'the one panel lives here');
});

test('the deck page’s cards can be read without opening the art in another tab', () => {
  // since the deck table (2026-10-21) the deck's cards are ui/decktable.ts's
  // and the pool's are ui/deckdrawer.ts's; both are the same readable tile
  const table = code('decktable.ts');
  const tile = table.slice(table.indexOf('function cardTile('), table.indexOf('function keyOf('));
  assert.ok(tile.length > 100, 'cardTile() moved — this test needs updating');
  assert.match(tile, /data-prev="\$\{esc\(name\)\}"/,
    'the hover box is data-prev, and it is the whole feature');
  assert.match(tile, /btn\(h, 'sel'\)/, 'and a click picks the card up, which pins the panel');
  const drawer = code('deckdrawer.ts');
  const dtile = drawer.slice(drawer.indexOf('function tileHtml('), drawer.indexOf('function chipsHtml('));
  assert.ok(dtile.length > 100, 'tileHtml() moved — this test needs updating');
  assert.match(dtile, /data-prev="\$\{esc\(name\)\}"/, 'the drawer’s scans read the same way');
  // the two the browser dropped for the owner's stated reasons, which apply
  // to the identical grid here: a native tooltip that competes with the hover
  // box, and a banner across the printed text
  for (const [f, src] of [['decktable.ts', tile], ['deckdrawer.ts', dtile]] as const) {
    assert.doesNotMatch(src, /\btitle="\$\{esc\(name\)\}/, `${f}: the competing native tooltip came back`);
    assert.doesNotMatch(src, /class="dkname"/, `${f}: the name banner came back over the card text`);
  }
  // and the panel the selection pins is the shared one
  assert.match(code('decks.ts'), /dt\.selected\(tableHost\(\)\)/, 'the picked-up card is the one pinned');
});

test('at two copies nothing OFFERS a third, and a cut is still allowed', () => {
  // the drawer: its + is behind the cap
  const drawer = code('deckdrawer.ts');
  const dtile = drawer.slice(drawer.indexOf('function tileHtml('), drawer.indexOf('function chipsHtml('));
  assert.match(dtile, /atCap/, 'the cap must be marked on the drawer’s tile');
  for (const add of [...dtile.matchAll(/data-dd="add"/g)]) {
    const before = dtile.slice(0, add.index);
    assert.match(before.slice(-80), /atCap \? '' :/, 'the drawer’s + is offered without checking the cap');
  }
  // the table's selection bar: + behind the cap, − never
  const table = code('decktable.ts');
  const bar = table.slice(table.indexOf('function selBarHtml('), table.indexOf('function zonesHtml('));
  assert.match(bar, /const canMore = fromMaybe \|\| h\.cap === undefined \|\| count\(h\.cards\(\), c\.name\) < h\.cap;/,
    'the + stops at the host’s cap (constructed: 2), and only there');
  assert.match(bar, /\$\{canMore \? `<button \$\{btn\(h, 'more'\)\}/, 'and the + is what it withholds');
  const less = bar.slice(0, bar.indexOf("btn(h, 'less')"));
  assert.doesNotMatch(less.slice(-60), /canMore \? /, 'the cap must not withhold the cut');
  assert.match(read('decks.ts'), /cap: 2,/, 'the constructed host names the cap');
  // ⚠ BL-34's REQUIREMENT SURVIVES; ITS MECHANISM DID NOT. The badge at two is
  // gone (*"actually show two of those cards, just stacked"*) and the STACK is
  // what says you already have two; the number comes back only over the cap.
  const tile = table.slice(table.indexOf('function cardTile('), table.indexOf('function keyOf('));
  assert.match(tile, /stackLayers\(n\)/, 'two copies must be DRAWN as two cards');
  assert.match(tile, /needsCountBadge\(n\)/,
    'and the NUMBER still comes back over the cap, where "too many of these" is exactly what '
    + 'must not be left to counting overlapping corners by eye');
});

test('there is one clipboard path, and both buttons take it', () => {
  assert.match(read('util.ts'), /export function copyText/, 'the one implementation lives in util.ts');
  assert.match(read('util.ts'), /execCommand\('copy'\)/, 'and it has the plain-http fallback');
  for (const f of ['decks.ts', 'main.ts']) {
    assert.match(code(f), /copyText\(/, `${f} must copy through the shared helper`);
    assert.doesNotMatch(code(f), /execCommand/, `${f} grew its own clipboard path again`);
  }
  // and the fault that made the deck page's copy button do nothing: it selected
  // the textarea and then repainted the page out from under the selection
  const decks = code('decks.ts');
  const handler = decks.slice(decks.indexOf("case 'deck-copy-list'"), decks.indexOf("case 'deck-adding'"));
  assert.ok(handler.length > 40, "the copy-list handler moved — this test needs updating");
  assert.doesNotMatch(handler, /paint\(\)/, 'a repaint here destroys the selection it just made');
});

test('the metagame page is dispatched, and the deck page still yields to the browser', () => {
  const main = read('main.ts');
  assert.match(main, /meta\.initMeta\(/, 'the metagame page must be initialised');
  assert.match(main, /if \(meta\.handleButton\(btn\)\) return;/, 'meta- buttons must be dispatched');
  assert.match(main, /if \(meta\.screen\(\)\) \{ meta\.renderScreen\(\); return; \}/,
    'and it must be able to own the page');
  // 212 asserts cards-before-decks; this asserts adding a page did not disturb it
  assert.ok(main.indexOf('if (cb.screen())') < main.indexOf('if (dk.screen())'),
    'the deck page would swallow a browser opened from it');
});

test('a shared deck link is read on a COLD load, which is the whole point of it', () => {
  const meta = code('meta.ts');
  assert.match(meta, /url\.get\('deck'\)/, 'initMeta must read ?deck= from the address bar');
  assert.match(meta, /history\.replaceState/, 'and write it back');
  assert.doesNotMatch(meta, /history\.pushState/,
    'pushState would put one back-button step per filter click in the way');
});

test('the metagame page never decides for itself who may be seen', () => {
  // The visibility rule lives in server/publicdecks.ts, once. A client-side
  // filter would be a second copy of it, and the dangerous kind: it would look
  // right while the server was the one actually shipping private lists.
  const meta = code('meta.ts');
  assert.doesNotMatch(meta, /visibility === 'private'/,
    'the client must not be the thing deciding what is private');
});
