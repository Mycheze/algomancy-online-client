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
 *   2. THE LIST CAN BE READ. `data-prev` is the whole hover box, and it is one
 *      attribute — an attribute that was missing here for a whole release
 *      while the identical grid in the browser had it. (BL-65: the deck page's
 *      tile grid became the Decks page preview's list; the claim moved with it.)
 *   3. OVER THE CAP IS SAID, NOT REFUSED. A deck holding three still saves and
 *      shows; its third copy is the red ×3. (BL-65: the tile's withheld `+` went
 *      with the tile; a tap at two in the builder's pool refuses with a note,
 *      which the builder's tests guard.)
 *   4. ONE CLIPBOARD PATH. The deck page's copy button and main.ts's share
 *      link go through the same helper. They diverged once — one had the
 *      execCommand fallback the plain-http deploy needs and the other did not
 *      — and the duplication is what allowed it.
 *   5. THE TABLE IS A BUTTON AWAY (2026-10-21; BL-65 "Edit on the table").
 *      It opens ui/tabletop.ts on top of this page; this page must not paint
 *      over it, and its save must carry the piles the table arranged.
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
import { deckPreviewHtml, deckPreviewView } from '../pages/decks.ts';

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
  // the browser's markup is pages/cards.ts since the design-system round
  // the Decks page's card sheet is pages/decks.ts since BL-65
  for (const f of ['pages/decks.ts', 'pages/cards.ts']) {
    assert.match(read(f), /from '\.\.?\/cardpanel\.ts'/, `${f} must use the shared panel`);
  }
  // the shape the browser's private copy had: a <section class="cbdetail">
  // built inline. Exactly one file may emit it, and it is not a page.
  for (const f of ['decks.ts', 'cards.ts', 'meta.ts', 'pages/cards.ts', 'pages/decks.ts', 'pages/meta.ts', 'pages/cardstats.ts']) {
    assert.doesNotMatch(code(f), /<section class="cbdetail">/,
      `${f} grew its own card panel again`);
  }
  assert.match(read('cardpanel.ts'), /<section class="cbdetail">/, 'the one panel lives here');
});

test('the Decks page’s list can be read without opening the card', () => {
  // called for real: the preview of a deck holding three of a card (an import, say)
  const v = deckPreviewView({ id: 'd', name: 'D', cards: [CARD, CARD, CARD], cover: null });
  const html = deckPreviewHtml(v);
  const row = /<button class="dklrow"[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? '';
  assert.ok(row, 'a row a card');
  assert.match(row, new RegExp(`data-prev="${CARD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), 'the hover box is data-prev, and it is the whole feature');
  assert.match(row, /data-btn="deck-focus"/, 'and the row opens the card panel');
  assert.doesNotMatch(row, /\btitle=/, 'no native tooltip competing with the hover box');
});

test('a third copy is said, in red, and the deck still shows', () => {
  const rest = allRows().filter(r => r.playable && r.cls === 'card' && r.scripted && r.name !== CARD).slice(0, 27).map(r => r.name);
  const html = deckPreviewHtml(deckPreviewView({ id: 'd', name: 'D', cards: [CARD, CARD, CARD, ...rest], cover: null }));
  assert.match(html, /<span class="dkln bad">×3<\/span>/, 'over the cap: the number, red');
  assert.match(html, /max 2 copies of each card/, 'and the legality line says why it cannot be played');
  const two = deckPreviewHtml(deckPreviewView({ id: 'd', name: 'D', cards: [CARD, CARD], cover: null }));
  assert.match(two, /<span class="dkln">×2<\/span>/, 'two is ordinary');
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
  const handler = decks.slice(decks.indexOf("case 'deck-copy-list'"), decks.indexOf("case 'deck-download'"));
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
  for (const f of ['meta.ts', 'pages/meta.ts']) {
    assert.doesNotMatch(code(f), /visibility === 'private'/,
      `the client must not be the thing deciding what is private (${f})`);
  }
});

test('the table is one button away, and the page under it neither paints over it nor loses its piles', () => {
  // the Decks page offers the table by a BUTTON (the installed web app has no
  // address bar): Edit on the table, the preview's primary action (BL-65)
  const page = code('pages/decks.ts');
  assert.match(page, /<div class="dkprevmain">\$\{\s*button\(\{ label: 'Edit on the table', variant: 'primary', dataBtn: 'deck-tabletop'/,
    'the button leads the preview\'s actions');
  const dk = code('decks.ts');
  assert.match(dk, /case 'deck-tabletop':[\s\S]*?flushSave\(\);[\s\S]*?openBuilder\(/, 'it flushes, then opens the table');
  assert.match(dk, /function openBuilder\([\s\S]*?tt\.openTabletop\(host\)/, 'through tabletop.ts');
  // the table sits on top of this still-`open` page and every drop is edit()
  assert.match(dk, /function paint\(\): void \{[\s\S]{0,400}?if \(cb\.screen\(\)\) return;[\s\S]{0,200}?if \(tt\.screen\(\)\) return;/,
    'paint must step aside while the table is up, as it does for the browser');
  // the arrangement rides the same debounced save as everything else
  assert.match(dk, /function flushSave\(\)[\s\S]*?piles: deck\.piles \?\? null,[\s\S]*?\}\)\.then/, 'the save sends the piles');
  // and the host's commit is the file's one funnel
  assert.match(dk, /commit: next => \{[\s\S]*?edit\(d => \{/, 'the table edits through edit()');
});
