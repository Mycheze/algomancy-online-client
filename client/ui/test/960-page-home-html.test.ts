/* 960 — THE HOME SCREEN, DRAWN WITHOUT A PAGE (design-system round, 2026-11-03).
 *
 * The home screen left main.ts for pages/home.ts, split the way docs/23
 * § Target structure asks: homeView() gathers, homeHtml(view) draws. This
 * file drives homeHtml with made-up views and no DOM at all — node has no
 * `document`, so a homeHtml that reached for one would throw here.
 *
 * §1 signed out: the "Your name" box, no My decks button
 * §2 signed in: no name box, the My decks button, the identity bar slot
 * §3 every data-btn the home screen's handlers and tests rely on is drawn
 * §4 the slots land where they did: the updates band after .homepage closes
 * §5 the New buttons' disabled states follow the view
 * §6 the Options fold and Single Card Duel fold remember being opened
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeHtml, constructedOptionsHtml, singleDuelHtml, type HomeView } from '../pages/home.ts';
import type { DeckPickerView } from '../pages/deckpicker.ts';

const PICKER: DeckPickerView = {
  current: null, signedIn: false, mine: [],
  defaults: [{ name: 'Ember Rush', author: 'Caleb', url: 'https://algomancer.cc/d/1', cards: Array(30).fill('X') }],
  msg: '',
};

/** a view with every slot stubbed by a marker, so where each lands can be read */
function view(over: Partial<HomeView> = {}): HomeView {
  return {
    nameBox: '',
    signedIn: false,
    draft: { k: 3, els: [], fixedOpen: false, setCount: 35, fixedError: undefined, customError: undefined, custom: false },
    error: '',
    deckPicker: PICKER,
    options: { open: false, ms: 45 * 60_000, clock: { mode: 'constructed', auto: true, now: 45 * 60_000, byModeMin: 45 } },
    hasDeck: false,
    singleDuel: { open: false, card: null, picker: '<!--SLOT:scpicker-->' },
    slots: {
      acctBar: '<!--SLOT:acctBar-->', leagueNav: '<!--SLOT:leagueNav-->', challengeNav: '<!--SLOT:challengeNav-->',
      leagueBanner: '<!--SLOT:leagueBanner-->', queueStrip: '<!--SLOT:queueStrip-->', yourMatches: '<!--SLOT:yourMatches-->',
      customRules: '<!--SLOT:customRules-->', competitiveCard: '<!--SLOT:competitiveCard-->',
      challengeCard: '<!--SLOT:challengeCard-->', updates: '<!--SLOT:updates-->',
    },
    ...over,
  };
}

const btns = (html: string): string[] => [...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!);

test('960 §0 positive control: there is no DOM here', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined',
    'a document global exists, so this file would not notice homeHtml reaching for it');
  assert.match(homeHtml(view()), /^<div class="homepage">/);
});

test('960 §1 signed out: the name box (escaped), and no My decks button', () => {
  const html = homeHtml(view({ nameBox: 'Ann <&>' }));
  assert.match(html, /<input id="h-name" maxlength="24" value="Ann &lt;&amp;&gt;"/);
  assert.doesNotMatch(html, /homedecks" data-btn="deck-openpage"/);
});

test('960 §2 signed in (or still resolving): no name box; signed in: the My decks button', () => {
  const resolving = homeHtml(view({ nameBox: null }));
  assert.doesNotMatch(resolving, /id="h-name"/, 'a null nameBox draws no box (the "signing in" moment)');
  const html = homeHtml(view({ nameBox: null, signedIn: true }));
  assert.doesNotMatch(html, /id="h-name"/);
  // a button() since 2026-11-03, still carrying .homedecks
  assert.match(html, /<button class="ui-button ui-button--secondary homedecks" data-btn="deck-openpage" type="button">🗂 My decks<\/button>/);
  assert.ok(html.indexOf('<!--SLOT:acctBar-->') < html.indexOf('data-btn="deck-openpage"'),
    'the identity bar comes before the nav buttons');
});

test('960 §3 every data-btn the home handlers answer is drawn', () => {
  const html = homeHtml(view({ draft: { ...view().draft, fixedOpen: true } }));
  const have = new Set(btns(html));
  for (const b of ['cards-openpage', 'meta-openpage', 'eltoggle', 'elrandom', 'newgame', 'joincode',
    'deckimporturl', 'deckimporttext', 'clockpick', 'meta-ladder']) {
    assert.ok(have.has(b), `data-btn="${b}" is missing from the home screen`);
  }
  // three ways to start a game: fixed draft, draft, constructed, single card
  const modes = [...html.matchAll(/data-btn="newgame" data-mode="(\w+)"([^>]*)/g)].map(m => `${m[1]}${/data-els/.test(m[2]!) ? '+els' : ''}${/data-single/.test(m[2]!) ? '+single' : ''}`);
  assert.deepEqual(modes, ['draft+els', 'draft', 'constructed', 'constructed+single']);
  assert.match(html, /data-help="rules"/, 'the How to play button');
  assert.match(html, /data-learn="menu"/, 'the Learn to play button');
  assert.match(html, /id="h-code"/);
});

test('960 §4 the slots land in their places, the updates band after .homepage', () => {
  const html = homeHtml(view());
  const order = ['acctBar', 'leagueNav', 'challengeNav', 'leagueBanner', 'queueStrip', 'yourMatches',
    'customRules', 'scpicker', 'competitiveCard', 'challengeCard', 'updates'].map(s => html.indexOf(`<!--SLOT:${s}-->`));
  assert.ok(order.every(i => i >= 0), 'a slot is not drawn at all');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'the slots are drawn out of order');
  const grid = html.indexOf('<div class="homegrid">');
  assert.ok(html.indexOf('<!--SLOT:customRules-->') > grid && html.indexOf('<!--SLOT:challengeCard-->') > grid,
    'the custom rules panel and the challenge card are inside the card grid');
  assert.match(html, /<\/div>\s*<!--SLOT:updates-->$/, 'the updates band is last, after .homepage closes');
});

test('960 §5 the New buttons follow the view', () => {
  const noDeck = homeHtml(view());
  assert.match(noDeck, /data-mode="constructed" disabled>\s*New constructed game — pick a deck first/);
  const deck = homeHtml(view({ hasDeck: true }));
  assert.match(deck, /data-mode="constructed" >\s*New constructed game<\/button>/);
  // a fixed pick: complete and accepted, complete and refused, incomplete
  const pick = (els: string[], fixedError?: string): string =>
    homeHtml(view({ draft: { ...view().draft, els, fixedError } }));
  assert.match(pick(['fire', 'wood', 'water']), /data-els="1" \s*>\s*Start with fire \+ wood \+ water/);
  assert.match(pick(['fire', 'wood', 'water'], 'no <trio>'), /data-els="1" disabled\s*title="no &lt;trio&gt;"/);
  assert.match(pick(['fire']), /data-els="1" disabled[^>]*>\s*pick 3 of the \d+ \(1\/3\)/);
  // the custom rules verdict on the plain draft button
  const refused = homeHtml(view({ draft: { ...view().draft, customError: 'too few' } }));
  assert.match(refused, /class="cta primary" data-btn="newgame" data-mode="draft" disabled title="too few"/);
  assert.match(homeHtml(view({ draft: { ...view().draft, custom: true } })), /New custom live draft/);
  // the last refusal shows on the Live draft card
  assert.match(homeHtml(view({ error: 'the server <refused>' })), /<p class="deckmsg">the server &lt;refused&gt;<\/p>/);
});

test('960 §6 the two folds draw open when the view says so', () => {
  const opts = view().options;
  assert.match(constructedOptionsHtml(opts), /data-homeoptions >/);
  assert.match(constructedOptionsHtml({ ...opts, open: true }), /data-homeoptions open>/);
  assert.match(constructedOptionsHtml({ ...opts, ms: 0 }), /— clock off/);
  assert.match(constructedOptionsHtml(opts), /— clock 45m/);
  const sd = view().singleDuel;
  assert.match(singleDuelHtml({ ...sd, open: true }), /data-singleduel open>/);
  assert.match(singleDuelHtml(sd), /data-single="1" disabled>\s*pick a card first/);
  assert.match(singleDuelHtml({ ...sd, card: 'Ignis <Sprite>' }), /New single card duel — Ignis &lt;Sprite&gt;/);
});
