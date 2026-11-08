/* 981 — THE METAGAME, DRAWN WITHOUT A PAGE (design-system round, 2026-11-03).
 *
 * The metagame's markup left ui/meta.ts for pages/meta.ts: metaView()
 * gathers, metaHtml(view) draws whichever view is up. Made-up views, no DOM.
 *
 * §1 the published-deck list: loading, empty, filtered to nothing, typical, an error
 * §2 the card duel ladder: ranked, unranked under the divider, the filter
 * §3 one shared deck: not found, typical, yours, someone else's while signed in — the left side is the Decks
 *    page's preview panel, read-only (BL-65), with Copy to my decks, the link and the export as its actions
 * §4 the shared deck's export panel, stats and pinned card
 * §5 text is escaped: names, builders, descriptions, messages, the filter box
 * §6 the tab row marks the view, and the card stats view draws the stats page
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { allRows } from '../cardindex.ts';
import { metaHtml, metaTabsHtml, type MetaView } from '../pages/meta.ts';
import type { PublicDeck } from '../meta.ts';

const NAMES = allRows().filter(r => r.cls === 'card' && r.playable).map(r => r.name);

function deck(i: number, over: Partial<PublicDeck> = {}): PublicDeck {
  return {
    id: `d${i}`, name: `Deck ${i}`, cards: [...NAMES.slice(i, i + 14), ...NAMES.slice(i, i + 14), NAMES[i + 20]!, NAMES[i + 21]!],
    cover: NAMES[i]!, author: 'Ann', visibility: 'public', owner: { id: `u${i}`, username: `Builder${i}` },
    createdAt: '2026-10-01', updatedAt: '2026-10-02', problems: [],
    record: { games: 8, wins: 6, losses: 2, unresolved: 0, lastPlayed: null }, copies: 2, ...over,
  };
}

function view(over: Partial<MetaView> = {}): MetaView {
  return {
    view: 'list', rows: null, minGames: 5, one: null, loading: false, msg: '', sort: 'winrate', els: [], text: '',
    focus: null, deckGroup: 'type', statsOpen: false, descOpen: false, exporting: null, backTo: 'list', ladder: null,
    signedIn: false, mine: false, link: 'http://x/?deck=d1', exportText: '', stats: null, chrome: { signedIn: false, alerts: 0 }, ...over,
  };
}
const btns = (html: string): Set<string> => new Set([...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!));

test('981 §1 the published-deck list in each of its states', () => {
  // in the app frame since 2026-11-04 (pages/frame.ts): Home, the tabs in the toolbar, one list surface
  assert.match(metaHtml(view()), /^<div class="ui-app-shell ui-app-shell--contained ui-app-shell--fill apppage metapage">/);
  assert.match(metaHtml(view({ loading: true })), /<p class="hint metaempty">loading…<\/p>/);
  assert.match(metaHtml(view({ rows: [] })), /Nothing on the list yet\. A deck appears here once it is <b>public<\/b>/);
  assert.match(metaHtml(view({ rows: [deck(1)], text: 'zzz' })), /Nothing matches those filters\./);
  const html = metaHtml(view({ rows: [deck(1), deck(2)], sort: 'games' }));
  assert.equal([...html.matchAll(/<button class="metarow" data-btn="meta-open" data-id="d\d">/g)].length, 2);
  assert.match(html, /<b class="good">75%<\/b> <span class="dim">6W–2L in 8 games · 2 copies<\/span>/);
  assert.match(html, /class="ui-segmented__option on" data-btn="meta-sort" type="button" data-value="games" aria-pressed="true" data-sort="games"/);
  assert.match(html, /<div class="framelist" data-scroll="meta-decks">/, 'the list scrolls by itself, and keeps its place over a repaint');
  for (const b of ['meta-close', 'meta-list', 'meta-stats-open', 'meta-ladder', 'meta-sort', 'meta-el', 'meta-open']) {
    assert.ok(btns(html).has(b), `${b} is drawn`);
  }
  assert.doesNotMatch(html, /data-btn="meta-clear"/, 'no clear without a filter');
  assert.match(metaHtml(view({ rows: [deck(1)], els: ['fire'] })), /data-btn="meta-clear"/);
  assert.match(metaHtml(view({ msg: 'could not reach the server' })), /<div class="acctmsg">could not reach the server<\/div>/);
});

test('981 §2 the card duel ladder', () => {
  const cards = NAMES.slice(0, 4).map((card, i) => ({ card, rating: 1500 - i, games: 8 - i * 2, wins: 4, losses: 2, mirrors: i % 2 }));
  const html = metaHtml(view({ view: 'ladder', ladder: { cards, rankedAfter: 5, duels: 9 } }));
  assert.match(html, /<h1 class="frametitle">Metagame<\/h1>/);
  assert.match(html, /class="ui-segmented__option on" data-btn="meta-ladder"/, 'the ladder\'s tab is the lit one');
  assert.match(html, /data-scroll="meta-ladder"/, 'another tab, another scroll'); 
  assert.match(html, /9 duels · 4 cards rated/);
  assert.equal([...html.matchAll(/<div class="metarow ladderrow" data-prev=/g)].length, 4, 'every card, with its hover');
  assert.match(html, /<span class="dim">#1<\/span>/);
  assert.match(html, /<div class="metadivider">Not enough duels yet/, 'the cards under 5 duels sit under the divider');
  assert.match(metaHtml(view({ view: 'ladder', ladder: { cards: [], rankedAfter: 5, duels: 0 } })), /No duels yet\./);
  assert.match(metaHtml(view({ view: 'ladder', ladder: { cards, rankedAfter: 5, duels: 9 }, text: 'zzz' })), /No rated card matches that\./);
});

test('981 §3 one shared deck: not found, typical, yours, another\'s', () => {
  const gone = metaHtml(view({ view: 'deck', msg: 'That deck is not shared, or the link is wrong.' }));
  assert.match(gone, /<h1 class="frametitle">Deck<\/h1>/);
  assert.match(gone, /That deck is not shared, or the link is wrong\./);
  assert.match(gone, /data-btn="meta-list">See the metagame list/);
  const d = deck(3, { visibility: 'unlisted', copiedFrom: { id: 'x', name: 'Orig', owner: 'Zed' }, description: 'A **bold** plan.' });
  const html = metaHtml(view({ view: 'deck', one: d }));
  assert.match(html, /<h1 class="frametitle">Deck 3<small>by Builder3/, 'the deck\'s name is the page\'s title, its builder beside it');
  assert.match(html, /by Builder3 · after Zed’s Orig · unlisted — only people with the link see this/);
  assert.match(html, /<strong>bold<\/strong>|<b>bold<\/b>/);
  assert.match(html, /<input class="sharelink" readonly value="http:\/\/x\/\?deck=d1"/);
  for (const b of ['meta-list', 'copylink', 'meta-export', 'meta-group', 'meta-stats', 'meta-focus']) {
    assert.ok(btns(html).has(b), `${b} is drawn`);
  }
  assert.doesNotMatch(html, /meta-take/, 'signed out: nothing to copy into');
  assert.match(metaHtml(view({ view: 'deck', one: d, signedIn: true })), /<button class="ui-button ui-button--primary" data-btn="meta-take" type="button">Copy to my decks<\/button>/);
  // the left side is the Decks page's preview, read-only: no Edit, no Play, no icon row, no Games
  const info = html.slice(html.indexOf('<aside class="metadeckinfo"'), html.indexOf('<div class="dkwork metadeckcards"'));
  assert.match(info, /<section class="dkprev" aria-label="Deck 3">/, 'the preview panel');
  assert.doesNotMatch(info, /data-btn="deck-(?:tabletop|play|duplicate|share|export|delete|games)"/, 'read-only');
  assert.match(info, /class="dklrow" type="button" data-btn="meta-focus"/, 'its card rows pin a card on this page');
  assert.match(info, /class="deckrecline"/, 'the record, with the floor’s rule');
  assert.doesNotMatch(info, /class="dkprevmeta">[^<]*\d+W–\d+L/, 'and only once (not again in the preview’s meta line)');
  assert.match(info, /data-btn="meta-desc-toggle"|<strong>bold<\/strong>/);
  assert.match(html.slice(html.indexOf('<div class="dkwork metadeckcards"')), /class="dkgrid"/, 'the card column stays on the right');
  const yours = metaHtml(view({ view: 'deck', one: d, signedIn: true, mine: true }));
  assert.doesNotMatch(yours, /meta-take/);
  assert.match(yours, /Yours — edit it on your decks page\./);
  // copies are drawn as a stack, with the depth on the tile
  assert.match(html, /<div class="dktile dkstack"\s+style="--d:1"/);
});

/** the frame's top-left button: its data-btn, caption and title */
function frameBack(html: string): { btn: string; label: string; title: string } {
  const tag = /<(?:button|a)\b[^>]*\bframeback\b[^>]*>[\s\S]*?<\/(?:button|a)>/.exec(html)?.[0] ?? '';
  return {
    btn: /data-btn="([^"]*)"/.exec(tag)?.[1] ?? '',
    label: /<span class="ui-icon-button__label">([^<]*)<\/span>/.exec(tag)?.[1] ?? '',
    title: /title="([^"]*)"/.exec(tag)?.[1] ?? '',
  };
}

test('981 §3b a shared deck has Back to where it was opened from, not Home (inbox-1568909425371127962)', () => {
  const d = deck(3);
  // positive control: the list itself still has Home
  assert.deepEqual(frameBack(metaHtml(view({ rows: [d] }))), { btn: 'meta-close', label: 'Home', title: '' });
  // opened off the list, or cold off a share link: Back is the list
  for (const html of [metaHtml(view({ view: 'deck', one: d })), metaHtml(view({ view: 'deck', msg: 'gone' }))]) {
    assert.deepEqual(frameBack(html), { btn: 'meta-list', label: 'Back', title: 'back to the published decks' });
    assert.doesNotMatch(html, /data-btn="meta-close"/, 'no Home on a shared deck');
  }
  // opened from a profile: Back closes the metagame, which puts the profile back
  assert.deepEqual(frameBack(metaHtml(view({ view: 'deck', one: d, backTo: 'host' }))),
    { btn: 'meta-close', label: 'Back', title: 'back to the profile' });
});

test('981 §4 the export panel, the stats and the pinned card', () => {
  const d = deck(1);
  const ex = metaHtml(view({ view: 'deck', one: d, exporting: 'file', exportText: '{"a":"<b>"}' }));
  assert.match(ex, /<div class="dkexport">/);
  assert.match(ex, /class="dkkind on" data-btn="meta-export" data-format="file"/);
  assert.match(ex, /\{&quot;a&quot;:&quot;&lt;b&gt;&quot;\}<\/textarea>/);
  for (const b of ['meta-copy-export', 'meta-export-close']) assert.ok(btns(ex).has(b));
  assert.match(metaHtml(view({ view: 'deck', one: d, statsOpen: true })), /<div class="acctbody deckbody metastats">/);
  const pinned = metaHtml(view({ view: 'deck', one: d, focus: NAMES[1]! }));
  assert.match(pinned, /<section class="cbdetail">/);
  assert.match(pinned, /data-btn="meta-unfocus"/);
});

test('981 §5 text is escaped', () => {
  const evil = deck(1, { name: '<img src=x>', owner: { id: 'u', username: 'A&B' }, description: '<script>x</script>' });
  const list = metaHtml(view({ rows: [evil] }));
  assert.match(list, /<span class="metaname">&lt;img src=x&gt;<\/span>/, 'positive control: the row is on the list');
  assert.doesNotMatch(list, /<img src=x>|<script>/);
  assert.match(metaHtml(view({ rows: [evil], text: '"><' })), /value="&quot;&gt;&lt;"/);
  const one = metaHtml(view({ view: 'deck', one: evil, msg: '<b>no</b>' }));
  assert.doesNotMatch(one, /<img src=x>|<script>|<b>no<\/b>/);
  assert.match(one, /&lt;img src=x&gt;/);
  assert.match(one, /by A&amp;B/);
});

test('981 §6 the tab row, and the card stats view', () => {
  // a segmented control in the toolbar's centre since 2026-11-04
  assert.match(metaTabsHtml('ladder'), /<button class="ui-segmented__option on" data-btn="meta-ladder" type="button" data-value="ladder" aria-pressed="true">Card duel ladder<\/button>/);
  assert.match(metaTabsHtml('list'), /class="ui-segmented__option on" data-btn="meta-list"/);
  // a shared deck is under Published decks: that tab is lit, and pressing it goes back to the list
  assert.match(metaTabsHtml('deck'), /class="ui-segmented__option on" data-btn="meta-list"/);
  assert.equal([...metaTabsHtml('deck').matchAll(/ on"/g)].length, 1);
  const stats = {
    data: null, loading: true, msg: '', mode: 'all', range: 'all', rated: false, bothSigned: false, mine: false,
    section: 'cards', sortKey: 'games', sortDir: -1, text: '', els: [], kind: 'all', minGames: 1, focus: null,
    signedIn: false, tabs: '<!--SLOT:tabs-->', chrome: { signedIn: false, alerts: 0 },
  } as const;
  const html = metaHtml(view({ view: 'stats', stats: { ...stats, els: [] } }));
  assert.match(html, /^<div class="ui-app-shell ui-app-shell--contained ui-app-shell--fill apppage cspage">/);
  assert.match(html, /<h1 class="frametitle">Metagame<\/h1>/);
  assert.match(html, /<!--SLOT:tabs-->/, 'the tab row lands as a slot');
  assert.equal(metaHtml(view({ view: null })), '', 'nothing when the page does not own #app');
});
