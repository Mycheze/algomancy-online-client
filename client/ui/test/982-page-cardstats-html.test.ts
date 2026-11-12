/* 982 — CARD STATS, DRAWN WITHOUT A PAGE (design-system round, 2026-11-03).
 *
 * The tab's markup left ui/cardstats.ts for pages/cardstats.ts:
 * cardStatsView() gathers, cardStatsHtml(view) draws. Made-up numbers, no DOM.
 *
 * §1 loading, and the "not enough games" message, before any data
 * §2 the Cards section: filters, sortable columns, raw numbers with their n, every data-btn
 * §3 the format decides the columns; the sort arrow follows the key
 * §4 a pinned card's own numbers
 * §5 Elements, Highlights and Games
 * §6 text is escaped
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { allRows } from '../cardindex.ts';
import { cardStatsHtml, colsFor, type CardStatsView } from '../pages/cardstats.ts';
import type { CsCard, CsResult } from '../cardstats.ts';

const NAMES = allRows().filter(r => r.cls === 'card' && r.playable).map(r => r.name);
const wr = (n: number, w: number) => ({ n, w });

function card(name: string, games: number): CsCard {
  return {
    card: name, games, gih: wr(games, Math.floor(games / 2)), oh: wr(3, 2), drawn: wr(4, 1), played: wr(5, 4), gns: wr(2, 0),
    copiesSeen: 6, timesPlayed: 4, recycled: 1, bottomed: 0, gihPlayed: 3, recycledFull: 1, bottomedFull: 0,
    firstTurnSum: 9, firstTurnN: 3, turnHist: [0, 1, 2, 0, 1], offered: 4, picked: 2, pickPosSum: 1, given: 1,
    deck: wr(2, 1), deckCopies: 4,
  };
}
const DATA: CsResult = {
  ok: true, games: 12, seatGames: 24, coverage: { open: 20, draws: 22, plays: 24, picks: 10, init: 24 },
  sources: { live: 10, refs: 2 }, firstPlayed: '2026-10-01T00:00Z', lastPlayed: '2026-11-01T00:00Z',
  cards: NAMES.slice(0, 6).map((n, i) => card(n, 2 + i)),
  elements: ['fire', 'water'].map(el => ({ el, seat: wr(10, 6), picked: 4, played: 3 })),
  pairs: { fire: wr(5, 3), 'fire+water': wr(4, 1) }, trios: { 'fire+water+earth': 2 },
  onPlay: wr(12, 7), turns: { 6: 3, 7: 5 }, constructedSeatGames: 8, floor: 5,
};

function view(over: Partial<CardStatsView> = {}): CardStatsView {
  return {
    data: DATA, loading: false, msg: '', msgTone: 'error', mode: 'all', range: 'all', rated: false, bothSigned: false, mine: false,
    section: 'cards', sortKey: 'games', sortDir: -1, text: '', els: [], kind: 'all', minGames: 1, focus: null,
    signedIn: true, tabs: '<!--SLOT:tabs-->', chrome: { signedIn: true, alerts: 0 }, ...over,
  };
}
const btns = (html: string): Set<string> => new Set([...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!));

test('982 §1 loading, and a message before any data', () => {
  const loading = cardStatsHtml(view({ data: null, loading: true }));
  assert.match(loading, /<p class="hint">loading…<\/p>/);
  assert.match(loading, /<!--SLOT:tabs-->/);
  assert.doesNotMatch(loading, /cstable/);
  const short = cardStatsHtml(view({ data: null, msgTone: 'note', msg: 'Only 1 game matches these filters.' }));
  assert.match(short, /<div class="ui-status ui-status--note" role="status">Only 1 game matches these filters\.<\/div>/);
  assert.doesNotMatch(short, /loading…/);
});

test('982 §2 the Cards section', () => {
  const html = cardStatsHtml(view());
  assert.match(html, /<b>12<\/b> games · 24 seats · 2026-10-01 → 2026-11-01/);
  for (const b of ['meta-close', 'meta-cs-mode', 'meta-cs-range', 'meta-cs-rated', 'meta-cs-signed', 'meta-cs-mine',
    'meta-cs-section', 'meta-cs-sort', 'meta-cs-kind', 'meta-cs-min', 'meta-cs-el', 'meta-cs-focus']) {
    assert.ok(btns(html).has(b), `${b} is drawn`);
  }
  assert.doesNotMatch(cardStatsHtml(view({ signedIn: false })), /meta-cs-mine/, '"my games" only when signed in');
  assert.equal([...html.matchAll(/<button class="csname" data-btn="meta-cs-focus" data-card="[^"]+" data-prev=/g)].length, 6);
  // raw numbers: a rate always prints its n
  assert.match(html, /<td class="csnum cswr" style="background: rgb\(var\(--color-winrate-up-rgb\) \/ 0\.000\)" title="1 won of 2">50%<small>2<\/small><\/td>/);
  assert.match(cardStatsHtml(view({ minGames: 5 })), /<th class="cscard">Card <span class="dim">3<\/span>/, 'min games filters rows');
  assert.match(cardStatsHtml(view({ text: 'zzz' })), /No card matches that\./);
  assert.match(cardStatsHtml(view({ text: 'x' })), /data-btn="meta-cs-clear"/);
});

test('982 §3 the format decides the columns', () => {
  const heads = (v: CardStatsView) => [...cardStatsHtml(v).matchAll(/data-btn="meta-cs-sort" data-v="([a-z]+)"/g)].map(m => m[1]);
  assert.deepEqual(heads(view({ mode: 'draft' })), colsFor('draft').map(c => c.key));
  assert.ok(heads(view({ mode: 'constructed' })).includes('deckwr'));
  assert.ok(!heads(view({ mode: 'draft' })).includes('deck'));
  assert.match(cardStatsHtml(view({ sortKey: 'gih', sortDir: 1 })), /class="cssort on" aria-pressed="true" data-btn="meta-cs-sort" data-v="gih"[^>]*>GIH WR ▴/);
});

test('982 §4 a pinned card shows its own numbers', () => {
  const html = cardStatsHtml(view({ focus: NAMES[0]! }));
  assert.match(html, /<tr class="on"><td class="cscard">/);
  assert.match(html, /<div class="csdetail">[\s\S]*<div class="cstiles">/);
  assert.match(html, /<h4>In the draft<\/h4>/);
  assert.match(html, /<h4>First played on turn<\/h4>/);
  assert.match(html, /data-btn="meta-cs-unfocus"/);
  assert.match(cardStatsHtml(view({ focus: NAMES[40]! })), /No finished game under these filters has this card in it\./);
});

test('982 §5 Elements, Highlights and Games', () => {
  const el = cardStatsHtml(view({ section: 'elements' }));
  assert.match(el, /<table class="cstable cselements">/);
  assert.match(el, /<h3>Colour pairs<\/h3>/);
  assert.match(el, /<h3>Draft trios<\/h3>/);
  const hl = cardStatsHtml(view({ section: 'highlights' }));
  assert.equal([...hl.matchAll(/<div class="csboard">/g)].length, 12);
  assert.match(hl, /<button class="csboardrow" data-btn="meta-cs-focus"/);
  const game = cardStatsHtml(view({ section: 'game' }));
  assert.match(game, /<h3>How long games run<\/h3>/);
  assert.match(game, /<li><b>10<\/b> recorded as played<\/li>/);
});

test('982 §6 text is escaped', () => {
  const html = cardStatsHtml(view({ text: '"><script>', msg: '<b>x</b>' }));
  assert.doesNotMatch(html, /<script>|<b>x<\/b>/);
  assert.match(html, /value="&quot;&gt;&lt;script&gt;"/);
});
