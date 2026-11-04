/* 1116 — THE DECKS PAGE, DRAWN WITHOUT A PAGE (BL-65, 2026-11-04).
 *
 * pages/decks.ts: decksView() gathers ui/decks.ts's snapshot, decksHtml(view)
 * draws it. Made-up decks of the real pool, no DOM.
 *
 * §1 the page in the frame: Back is deck-close, Refresh its tool; the shelf
 *    bar (n of 20, the sort, Import, + New deck); the boxes; signed out
 * §2 a deck box: cover, name, element dots, count · record; amber "27 / 30"
 *    on a deck that is not legal; "Bo3 ready" from the Competitive check
 * §3 the preview: name, meta, the description clipped, Edit on the table,
 *    Play, the four icon buttons, the list by cost, Side and Maybe, legality,
 *    Games — and no Test button (ruling 2)
 * §4 read-only (the shared deck): no Edit, no Play, no icon row, no Games;
 *    the host's own buttons in their place
 * §5 every sheet is a side sheet with its own buttons
 * §6 the sort orders the shelf; the list orders by cost, X last; ×3 is red
 * §7 text is escaped
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import { allRows } from '../cardindex.ts';
import { cardFacts } from '../deckstats.ts';
import {
  decksHtml, decksView, deckPreviewHtml, deckPreviewView, sortDecks, DECK_SORTS,
  type DeckSource, type DecksState,
} from '../pages/decks.ts';

const NAMES = allRows().filter(r => r.cls === 'card' && r.playable && r.scripted && /^[A-Za-z ]+$/.test(r.name)).map(r => r.name);
const pair = (from: number, n: number): string[] => NAMES.slice(from, from + n).flatMap(x => [x, x]);

function deck(i: number, over: Partial<DeckSource> = {}): DeckSource {
  return {
    id: `d${i}`, name: `Deck ${i}`, cards: pair(i * 15, 15), maybe: [], sideboard: [], cover: NAMES[i]!,
    visibility: 'public', updatedAt: `2026-11-0${i}T10:00:00Z`, author: 'you',
    record: { games: 0, wins: 0, losses: 0, unresolved: 0 }, ...over,
  };
}

function state(over: Partial<DecksState> = {}): DecksState {
  return {
    signedIn: true, loading: false, decks: [deck(1), deck(2)], openId: 'd1', sort: 'recent', msg: '', descOpen: false,
    chosenId: null, sheet: null, history: [], base: 'http://x/', exportBody: '', ...over,
  };
}
const html = (over: Partial<DecksState> = {}): string => decksHtml(decksView(state(over)));
const btns = (h: string): Set<string> => new Set([...h.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!));

test('1116 §1 the page in the frame, the shelf bar, the boxes; signed out', () => {
  const h = html();
  assert.match(h, /^<div class="ui-app-shell ui-app-shell--contained ui-app-shell--fill apppage framewide deckpage">/,
    'in the frame, the page class last (report.ts names the page "deck" from it)');
  assert.match(h, /<button class="ui-icon-button ui-icon-button--stack frameback" data-btn="deck-close"/, 'Back is deck-close');
  assert.match(h, /<div class="frametools"><button[^>]*data-btn="deck-refresh"/, 'Refresh is the page\'s tool');
  assert.match(h, /<span class="dkshelfcount">2 of 20<\/span>/);
  for (const b of ['deck-close', 'deck-refresh', 'deck-sort', 'deck-import-open', 'deck-new', 'deck-open', 'deck-tabletop', 'deck-play',
    'deck-duplicate', 'deck-share', 'deck-export', 'deck-delete', 'deck-focus', 'deck-games']) {
    assert.ok(btns(h).has(b), `${b} is drawn`);
  }
  assert.deepEqual([...h.matchAll(/data-btn="deck-sort"[^>]*data-sort="(\w+)"/g)].map(m => m[1]), [...DECK_SORTS]);
  assert.match(h, /class="ui-segmented__option on" data-btn="deck-sort" type="button" data-value="recent"/);
  assert.equal([...h.matchAll(/data-btn="deck-open" data-id="d\d"/g)].length, 2, 'one box a deck');
  assert.match(h, /<div class="dkshelf" data-scroll="deck-shelf">/, 'the shelf scrolls inside itself');
  // the old page is gone, every piece of it
  assert.doesNotMatch(h, /deck-tab"|deck-group|deck-adding|dk-search|dkmodal|data-btn="deck-more"|data-btn="deck-less"/);
  // signed out: the frame, one way to sign in, no shelf
  const out = html({ signedIn: false, decks: null });
  assert.match(out, /data-btn="acct-open-auth"/);
  assert.match(out, /data-btn="deck-close"/);
  assert.doesNotMatch(out, /dkshelf|deck-new/);
  // loading, and a note
  assert.match(html({ decks: null, loading: true, openId: null }), /Loading your decks…/);
  assert.match(html({ msg: 'Copied.' }), /class="[^"]*dkshelfnote[^"]*"[^>]*>Copied\.</);
});

test('1116 §2 a deck box: art, name, dots, count · record; amber when not legal; Bo3 ready', () => {
  const short = deck(3, { cards: pair(0, 13).concat(NAMES[40]!), record: { games: 6, wins: 4, losses: 2, unresolved: 0 } });
  const h = html({ decks: [deck(1), short], openId: 'd1' });
  const box = (id: string): string => new RegExp(`<button class="dkbox[^"]*" type="button" data-btn="deck-open" data-id="${id}"[\\s\\S]*?</button>`).exec(h)![0];
  assert.match(box('d1'), /class="dkbox on"/, 'the open deck\'s box is marked');
  assert.match(box('d1'), /<img src="[^"]+" alt=""/, 'cover art (paintDecks takes the native drag off it: noImgDrag)');
  assert.match(box('d1'), /<span class="dkboxname">Deck 1<\/span>/);
  assert.match(box('d1'), /<span class="dkdot" style="background:var\(--\w+\)"/, 'element dots, as tokens');
  assert.match(box('d1'), /<span class="dkboxcount">30<\/span>/);
  assert.match(box('d1'), />Bo3 ready</, 'a legal 30 with an empty sideboard is Competitive ready');
  assert.match(box('d3'), /<span class="dkboxcount warn" title="[^"]*at least 30[^"]*">27 \/ 30 · 4W–2L<\/span>/, 'amber, how far off, and the record');
  assert.doesNotMatch(box('d3'), /Bo3 ready/);
  // a legal deck with eight in the sideboard is not Bo3 ready; one with nothing played says its maybe count
  const eight = deck(4, { sideboard: NAMES.slice(100, 108), maybe: NAMES.slice(110, 112) });
  const h2 = html({ decks: [eight], openId: 'd4' });
  assert.doesNotMatch(h2, /Bo3 ready/);
  assert.match(h2, /<span class="dkboxcount">30 · 2 maybe<\/span>/);
});

test('1116 §3 the preview: the deck, its actions, its list, its legality — and no Test', () => {
  const d = deck(1, {
    description: `${'A fast deck that wants the game over early. '.repeat(10)}Keep ${NAMES[0]} in the opening hand.`,
    sideboard: NAMES.slice(100, 102), maybe: NAMES.slice(110, 113), record: { games: 6, wins: 4, losses: 2, unresolved: 0 },
  });
  const h = html({ decks: [d], openId: 'd1' });
  const prev = /<section class="dkprev" aria-label="Deck 1">[\s\S]*<\/section>/.exec(h)![0];
  assert.match(prev, /<h2 class="dkprevname">Deck 1<\/h2>/);
  assert.match(prev, /<div class="dkprevmeta">Public · edited [^<]+ · 4W–2L in 6 games<\/div>/);
  assert.match(prev, /data-btn="deck-desc-toggle"[^>]*>more</, 'a long description is clipped, with a way to the rest');
  assert.match(prev, /data-btn="deck-tabletop"[^>]*>Edit on the table</, 'Edit on the table is the primary action');
  assert.match(prev, /ui-button--primary dkprevedit/);
  assert.match(prev, /data-btn="deck-play"[^>]*>Play</);
  for (const [b, label] of [['deck-duplicate', 'Duplicate'], ['deck-share', 'Share'], ['deck-export', 'Export'], ['deck-delete', 'Delete']]) {
    assert.match(prev, new RegExp(`data-btn="${b}"[\\s\\S]*?<span class="ui-icon-button__label">${label}</span>`), `${label}, an icon with its caption`);
  }
  assert.doesNotMatch(h, />Test</, 'no Test button (test mode deals no deck: ruling 2)');
  assert.match(prev, /<span>Main deck 30<\/span><span>Side 2\/7 · Maybe 3<\/span>/);
  assert.match(prev, /<div class="dkprevlist" data-scroll="deck-list\|d1">/, 'the list scrolls inside the panel, keyed by the deck');
  assert.equal([...prev.matchAll(/<button class="dklrow" type="button" data-btn="deck-focus" data-card="[^"]+" data-prev="[^"]+">/g)].length, 15,
    'one row a card, a card link with the hover text');
  assert.doesNotMatch(prev, /class="dklrow"[^>]*title=/, 'no native tooltip competing with the hover text');
  assert.match(prev, /class="ui-chip ui-chip--success ui-chip--pill dkprevlegal">Legal · Competitive ready</);
  assert.match(prev, /data-btn="deck-games"[^>]*>Games ›</);
  // opened, the whole description, and "less"
  const open = html({ decks: [d], openId: 'd1', descOpen: true });
  assert.match(open, /Keep .* in the opening hand/);
  assert.match(open, /data-btn="deck-desc-toggle"[^>]*>less</);
  assert.match(open, /data-scroll="deck-desc\|d1"/, 'the opened description scrolls by itself');
  // the deck you are bringing; a deck that is not legal cannot be brought
  assert.match(html({ chosenId: 'd1' }), /data-btn="deck-play"[^>]*>Playing this ✓</);
  const bad = html({ decks: [deck(1, { cards: pair(0, 10) })] });
  assert.match(bad, /<button class="ui-button ui-button--action dkprevplay" data-btn="deck-play" type="button" title="Not legal yet" disabled>/);
  assert.match(bad, /<span class="dkprevlegal dkprevlegal--warn">a constructed deck needs at least 30 cards \(got 20\)<\/span>/, 'says what is wrong');
  // no deck open
  assert.match(html({ openId: null }), /class="dkprev dkprev--none"/);
});

test('1116 §4 read-only: someone else\'s deck, with the host\'s own buttons', () => {
  const v = deckPreviewView(deck(1, { author: 'Caleb', url: 'https://algomancer.cc/d/1' }), { focusBtn: 'meta-focus' });
  const h = deckPreviewHtml(v, { readOnly: true, actionsHtml: '<button data-btn="meta-take">Copy to my decks</button>' });
  assert.match(h, /data-btn="meta-take"/);
  for (const b of ['deck-tabletop', 'deck-play', 'deck-duplicate', 'deck-share', 'deck-export', 'deck-delete', 'deck-games', 'deck-focus']) {
    assert.ok(!btns(h).has(b), `${b} is not on a read-only preview`);
  }
  assert.match(h, /data-btn="meta-focus" data-card=/, 'its card links are the host\'s');
  assert.match(h, /· built by Caleb · <a href="https:\/\/algomancer\.cc\/d\/1"/);
});

test('1116 §5 every sheet is a side sheet, with its own buttons', () => {
  const sheets: [DecksState['sheet'], string, string[]][] = [
    [{ kind: 'import', msg: '' }, 'import', ['deck-import-close', 'deck-import-url', 'deck-import-text']],
    [{ kind: 'share' }, 'share', ['deck-share-close', 'deck-visibility', 'copylink']],
    [{ kind: 'export', format: 'text' }, 'export', ['deck-export-close', 'deck-export', 'deck-copy-list', 'deck-download']],
    [{ kind: 'delete' }, 'delete', ['deck-delete-yes', 'deck-delete-no']],
    [{ kind: 'games' }, 'games', ['deck-games-close']],
    [{ kind: 'card', name: NAMES[0]! }, 'card', ['deck-unfocus']],
  ];
  for (const [s, kind, want] of sheets) {
    const h = html({ sheet: s, exportBody: '2 Ignis Sprite' });
    const sh = new RegExp(`<div class="ui-sheet ui-sheet--side ui-sheet--\\w+ dksheet[^"]*" id="dk-${kind}" data-sheet data-dk-sheet="${kind}">`).exec(h);
    assert.ok(sh, `the ${kind} sheet is docked at the side`);
    for (const b of want) assert.ok(btns(h.slice(sh.index)).has(b), `${kind}: ${b}`);
  }
  assert.doesNotMatch(html(), /ui-sheet/, 'none open: none drawn');
  // the import's fields keep their ids; its answer is said
  const imp = html({ sheet: { kind: 'import', msg: 'could not reach the server' } });
  assert.match(imp, /<input class="ui-field__control"[^>]*id="dk-url"/);
  assert.match(imp, /<textarea class="ui-field__control"[^>]*id="dk-text"/);
  assert.match(imp, /could not reach the server/);
  // share: the three choices, the link
  const share = html({ sheet: { kind: 'share' } });
  assert.match(share, /class="ui-segmented__option on" data-btn="deck-visibility"[^>]*data-visibility="public">Public</);
  assert.match(share, /<input class="sharelink" readonly value="http:\/\/x\/\?deck=d1"/);
  assert.match(share, /data-btn="copylink"[^>]*data-link="http:\/\/x\/\?deck=d1"/);
  // export: the format, the body, the file name
  const exp = html({ sheet: { kind: 'export', format: 'file' }, exportBody: '{"version":2}' });
  assert.match(exp, /class="ui-segmented__option on" data-btn="deck-export"[^>]*data-format="file"/);
  assert.match(exp, /<textarea class="dkexporttext"[^>]*>\{&quot;version&quot;:2\}<\/textarea>/);
  assert.match(exp, /data-btn="deck-download"[^>]*data-name="Deck 1\.json"/);
  // delete asks once, naming the deck
  assert.match(html({ sheet: { kind: 'delete' } }), /“Deck 1” and its record go for good/);
  // games: the record and the rows from the history that brought this deck
  const games = html({
    decks: [deck(1, { record: { games: 2, wins: 1, losses: 1, unresolved: 0 } })], sheet: { kind: 'games' },
    history: [
      { deckId: 'd1', result: 'win', opponent: 'Rashi', turns: 9, life: [12, 0], playedAt: '2026-11-03T10:00:00Z', code: 'ABCD' },
      { deckId: 'd9', result: 'loss', opponent: 'Other', turns: 5, life: [0, 3], playedAt: '2026-11-03T10:00:00Z', code: 'WXYZ' },
    ],
  });
  assert.match(games, /<b class="good">1W–1L<\/b> in 2 games/);
  assert.match(games, /Rashi/);
  assert.doesNotMatch(games, /WXYZ/, 'another deck\'s game is not this deck\'s');
  assert.match(games, /href="\?replay=ABCD"/);
});

test('1116 §6 the sort orders the shelf; the list orders by cost, X last; ×3 is red', () => {
  const a = deck(1, { name: 'Zed', updatedAt: '2026-11-01T00:00:00Z', record: { games: 9, wins: 5, losses: 4, unresolved: 0 } });
  const b = deck(2, { name: 'Ann', updatedAt: '2026-11-03T00:00:00Z', record: { games: 1, wins: 1, losses: 0, unresolved: 0 } });
  const c = deck(3, { name: 'Mo', updatedAt: '2026-11-02T00:00:00Z' });
  const names = (s: DecksState['sort']): string[] => sortDecks([a, b, c], s).map(d => d.name);
  assert.deepEqual(names('recent'), ['Ann', 'Mo', 'Zed']);
  assert.deepEqual(names('name'), ['Ann', 'Mo', 'Zed']);
  assert.deepEqual(names('played'), ['Zed', 'Ann', 'Mo']);
  assert.deepEqual([...html({ decks: [a, b, c], sort: 'played' }).matchAll(/<span class="dkboxname">(\w+)</g)].map(m => m[1]), ['Zed', 'Ann', 'Mo']);
  // the list: cheapest first, X last, a third copy red
  const x = NAMES.find(n => cardFacts(n)?.isX)!;
  const cheap = NAMES.filter(n => !cardFacts(n)?.isX).sort((p, q) => cardFacts(p)!.mana - cardFacts(q)!.mana);
  const v = deckPreviewView(deck(1, { cards: [x, cheap.at(-1)!, cheap[0]!, cheap[0]!, cheap[0]!] }));
  assert.deepEqual(v.rows.map(r => r.name), [cheap[0], cheap.at(-1), x]);
  assert.equal(v.rows.at(-1)!.cost, 'X');
  const h = deckPreviewHtml(v);
  assert.match(h, /<span class="dkln bad">×3<\/span>/, 'over the cap: the number, in red');
});

test('1116 §7 text is escaped', () => {
  const h = html({ decks: [deck(1, { name: '<b>x</b>', description: '<script>no</script>' })], msg: '<i>m</i>' });
  assert.doesNotMatch(h, /<b>x<\/b>|<script>|<i>m<\/i>/);
  assert.match(h, /&lt;b&gt;x&lt;\/b&gt;/);
});
