/* 960 — THE HOME SCREEN, DRAWN WITHOUT A PAGE.
 *
 * pages/home.ts homeHtml(view) is pure (the page contract, docs/23); this file
 * drives it with made-up views and no DOM at all — node has no `document`, so a
 * homeHtml that reached for one would throw here.
 *
 * Rewritten for the new home layout (client/docs/24-redesign/, 2026-11-03): an
 * app shell with a toolbar, the Play card (Draft | Constructed, the settings
 * rows, Join a room and Create room), three cards beside it, a bottom bar, and
 * sheets drawn from state. The old file pinned the old markup (the header row,
 * the five-card grid, the folds, the updates band after .homepage); what it
 * pinned about BEHAVIOUR — every data-btn drawn, the name box only signed out,
 * the Create buttons' disabled states — is pinned again below, against the new
 * places. var/records/ds-round-2026-11-03-home-page.md has the old → new map.
 *
 * §0 no DOM; the root is the app shell with `homepage` LAST (report.ts, 287)
 * §1 who you are: the name box only signed out; the account in the toolbar
 * §2 the toolbar's buttons, in the top bar
 * §3 Draft: Mode, the clock, the elements (room | now), the custom rules' rows
 *    (Cards, Banned, Game values — taken out of their sheet 2026-11-03), Create room
 * §4 Constructed: Casual and Competitive, signed in and out
 * §5 the three cards beside Play open their pages; inner buttons survive
 * §6 the sheets: one at a time, from the view, each dismissable
 * §7 badges: Alerts, Join, Updates — and none at zero
 * §8 every data-btn the OLD home drew is still reachable from the new one
 *
 * 2026-11-03 (round 2): the shell is `contained` (one column for the bars and
 * the main region); Competitive has a Clock row (the match clock); the custom
 * rules' Mode, Cards and Banned are Draft rows and the sheet is "Game values".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeHtml, HOME_SHEETS, type HomeView } from '../pages/home.ts';
import type { DeckPickerView } from '../pages/deckpicker.ts';
import type { CustomRulesView } from '../pages/customrules.ts';
import type { CustomRules } from '../customrules.ts';
import { DEAL_DEFAULTS } from '../../engine/src/draftdeal.ts';

const STANDARD = { v: 1, ...DEAL_DEFAULTS, simpleOnly: false, query: '', bans: [], preset: null } as CustomRules;
/** the custom rules untouched, with the typing fragments as markers */
const RULES: CustomRulesView = {
  active: null, rules: STANDARD, summary: [], values: [], beginner: false, advancedOpen: false, banDraft: '',
  deckCount: 528, simpleCount: 300, suggestions: '<!--SLOT:sugg-->', queryNote: 'q', pool: '<!--SLOT:pool-->',
};

const PICKER: DeckPickerView = {
  current: null, signedIn: false, mine: [],
  defaults: [{ name: 'Ember Rush', author: 'Caleb', url: 'https://algomancer.cc/d/1', cards: Array(30).fill('X') }],
  msg: '',
};
const ME = { username: 'Quil <lon>', favoriteElement: 'water', games: 6, wins: 4, losses: 2, unresolved: 1, streak: 3 };
const CC = [{ id: 'dOK', name: 'Legal', error: null }, { id: 'dBAD', name: 'Big side', error: 'too many' }];

/** a view with every slot stubbed by a marker, so where each lands can be read */
function view(over: Partial<HomeView> = {}): HomeView {
  return {
    account: { resolving: false, me: null },
    nameBox: '',
    signedIn: false,
    mode: 'draft',
    format: 'casual',
    sheet: null,
    draft: { k: 3, els: [], fixedOpen: false, setCount: 35, fixedError: undefined, customError: undefined, custom: false, rules: RULES },
    clock: { mode: 'draft', auto: true, now: 60 * 60_000, byModeMin: 60 },
    error: '',
    deckPicker: PICKER,
    hasDeck: false,
    competitive: { signedIn: false, decks: null, bestOf: 3, pick: null },
    singleCard: null,
    leagueLive: true,
    challengeLive: true,
    badges: { alerts: 0, join: 0, updates: 0 },
    slots: {
      league: '<!--SLOT:league-->', challenge: '<!--SLOT:challenge-->', queue: '<!--SLOT:queue-->',
      invites: '<!--SLOT:invites-->', yourMatches: '<!--SLOT:yourMatches-->', leagueMatches: '<!--SLOT:leagueMatches-->',
      scpicker: '<!--SLOT:scpicker-->', info: '<!--SLOT:info-->', updates: '<!--SLOT:updates-->',
    },
    art: { backdrop: { src: 'art/backdrop.jpg', card: 'Backdrop Card', focusY: 30 }, draft: { src: 'art/draft.jpg', card: 'Draft Card', focusY: 30 }, constructed: { src: 'art/constructed.jpg', card: 'Constructed Card', focusY: 30 }, league: { src: 'art/league.jpg', card: 'League Card', focusY: 30 }, challenge: { src: 'art/challenge.jpg', card: 'Challenge Card', focusY: 30 }, queue: { src: 'art/queue.jpg', card: 'Queue Card', focusY: 30 } },
    ...over,
  };
}
const signedIn = (over: Partial<HomeView> = {}): HomeView => view({
  account: { resolving: false, me: ME }, nameBox: null, signedIn: true,
  deckPicker: { ...PICKER, signedIn: true, mine: PICKER.defaults!, defaults: null },
  competitive: { signedIn: true, decks: CC, bestOf: 3, pick: CC[0]! },
  ...over,
});
/** a Constructed view; Best of follows the rules set's default (ui/match.ts
 * bestOfFor: Casual one game, Competitive three) unless `bestOf` is given */
const cons = (v: HomeView, format: HomeView['format'] = 'casual', bestOf: 1 | 3 = format === 'casual' ? 1 : v.competitive.bestOf): HomeView => {
  const match = format === 'competitive' || bestOf === 3;
  return { ...v, mode: 'constructed', format, competitive: { ...v.competitive, bestOf },
    clock: { mode: match ? 'competitive' : 'constructed', auto: true, now: 45 * 60_000, byModeMin: 45 } };
};

const btns = (html: string): string[] => [...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!);
/** the region of the shell: top bar, main, bottom bar */
const region = (html: string, r: 'top' | 'main' | 'bottom'): string => {
  const tag = r === 'top' ? 'header' : r === 'main' ? 'main' : 'footer';
  const at = html.indexOf(`<${tag} class="ui-app-shell__${r}">`);
  assert.ok(at >= 0, `no ${r} region`);
  return html.slice(at, html.indexOf(`</${tag}>`, at));
};
/** the markup of the button whose data-btn (and optional data attribute) is given */
const buttonOf = (html: string, b: string, extra = ''): string =>
  new RegExp(`<button[^>]*data-btn="${b}"[^>]*${extra}[^>]*>[^]*?</button>`).exec(html)?.[0] ?? '';

test('960 §0 positive control: there is no DOM here; the root is the app shell, homepage last', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined',
    'a document global exists, so this file would not notice homeHtml reaching for it');
  const html = homeHtml(view());
  assert.match(html, /^<div class="ui-app-shell ui-app-shell--contained apppage homepage">/, 'report.ts names the page from the LAST class of #app\'s first div');
  for (const r of ['top', 'main', 'bottom'] as const) region(html, r);
});

test('960 §1 the name box only signed out (escaped); the account in the toolbar centre', () => {
  const out = homeHtml(view({ nameBox: 'Ann <&>' }));
  assert.match(out, /<input id="h-name" maxlength="24" value="Ann &lt;&amp;&gt;"/);
  assert.match(region(out, 'top'), /<button class="homeacct out" data-btn="acct-open-auth"[^>]*>[^]*Sign in[^]*playing as a guest/);
  const resolving = homeHtml(view({ nameBox: null, account: { resolving: true, me: null } }));
  assert.doesNotMatch(resolving, /id="h-name"/, 'a null nameBox draws no box (the "signing in" moment)');
  assert.match(resolving, /class="homeacct busy" aria-busy="true"[^]*Signing in…/);
  assert.doesNotMatch(resolving, /acct-open-auth/, 'no Sign in flashes while a stored token resolves');
  const html = homeHtml(signedIn());
  assert.doesNotMatch(html, /id="h-name"/);
  const acct = buttonOf(region(html, 'top'), 'acct-open-profile');
  assert.match(acct, /Quil &lt;lon&gt;/, 'the name, escaped');
  assert.match(acct, /4W–2L · 1 unrecorded · 🔥3/, 'the record line');
  assert.match(acct, /<img src="\/data\/icons\/water\.webp"/, 'the favourite element is the avatar');
});

test('960 §2 the toolbar: Decks Cards Metagame | account | Learn Test Rules Alerts Report', () => {
  for (const v of [view(), signedIn()]) {
    const top = region(homeHtml(v), 'top');
    const order = ['data-btn="deck-openpage"', 'data-btn="cards-openpage"', 'data-btn="meta-openpage"', 'class="homeacct',
      'data-learn="menu"', 'data-sbx="open"', 'data-help="rules"', 'homealerts', 'data-report="open"'].map(a => top.indexOf(a));
    assert.ok(order.every(i => i >= 0), `a toolbar button is missing: ${order}`);
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'the toolbar is out of order');
    assert.match(top, /data-sbx="open"[^>]*>[^]*?<span class="homesbxnote" data-sbx-label><\/span>/,
      'test mode writes its "dealing…" into a label span, not over the icon');
    assert.equal((top.match(/class="ui-icon-button /g) ?? []).length, 8, 'eight icon buttons, one style');
  }
  assert.match(region(homeHtml(signedIn()), 'top'), /class="ui-icon-button ui-icon-button--stack homealerts" type="button"[^>]* data-inbox="bell"/,
    'signed in, Alerts is the bell');
  assert.match(region(homeHtml(view()), 'top'), /homealerts" data-btn="home-sheet"[^>]*data-sheet="alerts-signin"/,
    'signed out, Alerts says to sign in');
});

test('960 §3 Draft: Mode, clock, elements, the custom rules rows, Create room', () => {
  const html = homeHtml(view());
  const main = region(html, 'main');
  // the rows, in order, each under its label
  const labels = [...main.matchAll(/<div class="ui-setting-row__label">([^<]+)<\/div>/g)].map(m => m[1]);
  assert.deepEqual(labels, ['Mode', 'Rules', 'Clock', 'Elements', 'Cards', 'Banned', 'Game values']);
  // report #356: the rules set, on Draft too — Casual first and on, each option's tooltip says what it means
  assert.match(main, /data-btn="home-format" type="button" data-value="casual" aria-pressed="true" title="Casual: both players take the resource step, the haste step and deployment at the same time[^"]*" data-format="casual">Casual</);
  assert.match(main, /data-btn="home-format" type="button" data-value="competitive" aria-pressed="false" title="Competitive: the printed turn order\. The initiative player takes [^"]*" data-format="competitive">Competitive</);
  assert.doesNotMatch(main, /data-rules=/, 'a Casual draft is the room it always was');
  const ccDraft = region(homeHtml(view({ format: 'competitive' })), 'main');
  assert.match(buttonOf(ccDraft, 'newgame'), /data-mode="draft" data-rules="competitive">Create room</, 'a Competitive draft says so on its Create button');
  assert.match(buttonOf(homeHtml(view({ format: 'competitive', draft: { ...view().draft, fixedOpen: true, els: ['fire', 'wood', 'water'] } })), 'newgame'),
    /data-mode="draft" data-els="1" data-rules="competitive">/, '…and with the elements picked now');
  assert.match(main, /data-btn="cr-beginner"[^>]*aria-pressed="true"[^>]*data-on="0">Standard</, 'first visit: Standard');
  assert.doesNotMatch(main, /homemodehint/, 'no Beginner line while Standard');
  assert.match(main, /data-btn="cr-simple"/);
  assert.match(main, /data-btn="cr-advanced"[^>]*>Card filter…</);
  assert.match(main, /<input id="cr-ban" /);
  assert.match(main, /<span id="cr-bansugg" class="crsugg"><!--SLOT:sugg--><\/span>/);
  assert.match(main, /<div id="cr-pool" class="crpool"><!--SLOT:pool--><\/div>/);
  assert.doesNotMatch(main, /data-btn="cr-step"/, 'the numbers are in the Game values sheet only');
  assert.equal((main.match(/data-btn="clockpick"[^>]*data-clockfor="draft"/g) ?? []).length, 4, 'Default Off 45m 60m');
  assert.match(main, /class="ui-segmented__option on" data-btn="clockpick" type="button" data-value="auto"/);
  assert.match(main, /data-btn="home-els"[^>]*aria-pressed="true"[^>]*data-pick="room"/, 'first visit: choose in the room');
  assert.doesNotMatch(main, /data-btn="eltoggle"/, 'no chips until Pick now');
  assert.match(buttonOf(main, 'home-sheet', 'data-sheet="rules"'), /Change…/);
  assert.match(main, /<span class="dim">Standard values<\/span>/);
  assert.match(buttonOf(main, 'newgame', 'data-mode="draft"'), /^<button class="ui-button ui-button--action homecreate" data-btn="newgame" type="button" data-mode="draft">Create room</);
  assert.ok(main.indexOf('data-btn="home-sheet"') < main.lastIndexOf('data-sheet="join"'), 'positive control');
  assert.ok(main.indexOf('data-sheet="join"') < main.indexOf('data-btn="newgame"'), 'Join a room sits left of Create');

  // Pick now: seven chips and the die; Create is live only with k picked
  const pick = (els: string[], over: Partial<HomeView['draft']> = {}): string =>
    homeHtml(view({ draft: { ...view().draft, fixedOpen: true, els, ...over } }));
  const now = pick(['fire', 'wood', 'water']);
  assert.equal((now.match(/data-btn="eltoggle"/g) ?? []).length, 7);
  assert.match(now, /data-btn="elrandom"/);
  assert.match(now, /class="elchip fire on" aria-pressed="true" data-btn="eltoggle" data-el="fire"/);
  assert.match(buttonOf(now, 'newgame', 'data-els="1"'), /type="button" data-mode="draft" data-els="1">Create room · Fire \+ Wood \+ Water</);
  assert.equal((now.match(/data-btn="newgame"/g) ?? []).length, 1, 'one Create button');
  assert.match(buttonOf(pick(['fire']), 'newgame'), / disabled data-mode="draft" data-els="1">Pick 3 elements \(1\/3\)</);
  assert.match(buttonOf(pick(['fire', 'wood', 'water'], { fixedError: 'no <trio>' }), 'newgame'), /title="no &lt;trio&gt;" disabled data-mode="draft" data-els="1">/);
  // custom rules: the values summary, the label, and the verdict on the room button
  const custom = homeHtml(view({ draft: { ...view().draft, custom: true, rules: { ...RULES, values: ['Packs of <5>', 'Life 20'] } } }));
  assert.match(custom, /<b>Packs of &lt;5&gt; · Life 20<\/b>/);
  // Beginner: the Mode row says what it is, beside the control
  const beg = homeHtml(view({ draft: { ...view().draft, rules: { ...RULES, beginner: true } } }));
  assert.match(beg, /data-btn="cr-beginner"[^>]*aria-pressed="true"[^>]*data-on="1">Beginner</);
  assert.match(beg, /<span class="homemodehint">The rulebook’s Quick Start: 2 elements, packs of 5, simple cards only\.<\/span>/);
  assert.match(buttonOf(custom, 'newgame'), />Create custom room</);
  assert.match(buttonOf(homeHtml(view({ draft: { ...view().draft, customError: 'too few' } })), 'newgame'), /title="too few" disabled data-mode="draft">Create room</);
  // the last refusal, above the buttons, escaped
  const refused = homeHtml(view({ error: 'the server <refused>' }));
  assert.match(refused, /<p class="ui-status ui-status--error pageerr" role="alert">the server &lt;refused&gt;<\/p>/);
  assert.ok(refused.indexOf('pageerr') <refused.indexOf('class="homeactions"'));
});

test('960 §4 Constructed: Casual and Competitive', () => {
  // casual, signed out: the bundled decks, Import… opens a sheet, Single Card Duel is a quiet link
  const out = homeHtml(cons(view()));
  assert.match(out, /data-btn="home-mode"[^>]*aria-pressed="true"[^>]*data-mode="constructed"/);
  assert.match(out, /data-btn="home-format"[^>]*aria-pressed="true"[^>]*data-format="casual"/);
  assert.equal((out.match(/data-btn="clockpick"[^>]*data-clockfor="constructed"/g) ?? []).length, 4);
  assert.match(out, /<select id="h-deck"/);
  assert.doesNotMatch(out, /id="h-deckurl"/, 'the import boxes are in the Import sheet now');
  assert.match(buttonOf(out, 'home-sheet', 'data-sheet="import"'), /Import a deck…/);
  assert.match(buttonOf(out, 'home-sheet', 'data-sheet="single"'), /Single Card Duel/);
  assert.match(buttonOf(out, 'newgame'), /type="button" disabled data-mode="constructed">Pick a deck first</);
  assert.match(buttonOf(homeHtml(cons(view({ hasDeck: true }))), 'newgame'), /data-mode="constructed">Create room</);
  // signed in: My decks, no Import
  const mine = homeHtml(cons(signedIn({ hasDeck: true })));
  assert.match(mine, /data-btn="deck-openpage"[^>]*>My decks →/);
  assert.doesNotMatch(mine, /data-sheet="import"/);
  // report #356: Rules and Best of are two choices, both shown, with no subtext line for the rules
  const consLabels = (h: string): string[] => [...region(h, 'main').matchAll(/<div class="ui-setting-row__label">([^<]+)<\/div>/g)].map(m => m[1]!);
  assert.deepEqual(consLabels(out), ['Rules', 'Best of', 'Clock', 'Deck']);
  assert.match(out, /data-btn="cc-bo" type="button" data-value="1" aria-pressed="true" data-bo="1">1 game</, 'Casual: one game first');
  assert.match(out, /data-btn="home-format"[^>]*title="Casual: [^"]*" data-format="casual">Casual</);
  assert.doesNotMatch(out, /Players take each step in turn/);
  // Casual, Best of 3: a match — the sideboard line, the match clock, the CC picker, and a Create match that says Casual
  const casualBo3 = homeHtml(cons(signedIn(), 'casual', 3));
  assert.deepEqual(consLabels(casualBo3), ['Rules', 'Best of', 'Clock', 'Deck']);
  assert.match(casualBo3, /data-btn="home-format"[^>]*aria-pressed="true"[^>]*data-format="casual"/);
  assert.match(casualBo3, /data-bo="3">3 games</);
  assert.match(casualBo3, /A sideboard of up to 7, swapped between games\./);
  assert.match(casualBo3, /data-clockfor="competitive"/, 'the match clock');
  assert.match(buttonOf(casualBo3, 'cc-new'), /data-rules="casual">Create match</);
  assert.doesNotMatch(casualBo3, /data-btn="newgame"/);
  assert.match(homeHtml(cons(view(), 'casual', 3)), /Matches of three games need an account/);
  // Competitive, Best of 1: still a match, one game, played in turn
  const ccBo1 = homeHtml(cons(signedIn(), 'competitive', 1));
  assert.match(buttonOf(ccBo1, 'cc-new'), /data-rules="competitive">Create match</);
  assert.doesNotMatch(ccBo1, /A sideboard of up to 7/, 'one game: no sideboarding line');
  // competitive: Best of (3 first), the match clock, the CC picker, Create match
  const cc = homeHtml(cons(signedIn(), 'competitive'));
  assert.match(cc, /data-btn="cc-bo" type="button" data-value="3" aria-pressed="true" data-bo="3">3 games</);
  assert.match(cc, /data-btn="cc-bo" type="button" data-value="1" aria-pressed="false" data-bo="1">1 game</);
  // the match clock (owner, 2026-11-03): its own picker, Default first and on
  assert.equal((cc.match(/data-btn="clockpick"[^>]*data-clockfor="competitive"/g) ?? []).length, 4, 'Default Off 45m 60m');
  assert.doesNotMatch(cc, /data-clockfor="constructed"/, 'not the casual clock');
  assert.match(cc, /class="ui-segmented__option on" data-btn="clockpick" type="button" data-value="auto" aria-pressed="true" title="45 minutes per player, for the whole match"/);
  assert.match(cc, /45m per player, for the whole match/);
  assert.match(cc, /<option value="dOK" selected>Legal<\/option>/);
  assert.match(cc, /<option value="dBAD" disabled>Big side — too many<\/option>/);
  assert.match(buttonOf(cc, 'cc-new'), />Create match</);
  assert.doesNotMatch(cc, /data-btn="newgame"/);
  assert.match(buttonOf(homeHtml(cons(signedIn({ competitive: { signedIn: true, decks: [CC[1]!], bestOf: 1, pick: null } }), 'competitive')), 'cc-new'),
    /type="button" disabled data-rules="competitive">Pick a deck first</);
  // competitive signed out: it says so, with the sign-in, instead of disappearing
  const ccOut = homeHtml(cons(view(), 'competitive'));
  assert.match(ccOut, /Competitive matches need an account/);
  assert.match(region(ccOut, 'main'), /data-btn="acct-open-auth"/);
  assert.doesNotMatch(ccOut, /cc-new|newgame/);
  assert.match(ccOut, /data-btn="cc-bo"/, 'report #356: the two choices stay, so switching to Casual · 1 game is one click away');
  assert.match(ccOut, /data-sheet="join"/, 'joining still works');
});

test('960 §5 League, Challenge and Matchmaking open their pages; Join buttons inside still work', () => {
  const html = homeHtml(view({ slots: { ...view().slots, queue: '<button data-btn="queue-join-open" data-id="g1">Join →</button>' } }));
  for (const [b, slot] of [['nav-league', 'league'], ['nav-challenge', 'challenge'], ['queue-open', 'queue']] as const) {
    const card = new RegExp(`<section class="homeside[^"]*"[^>]*>[^]*?<!--SLOT:${slot}-->|<section class="homeside[^"]*"[^>]*>[^]*?queue-join-open`).exec(html)?.[0];
    assert.ok(card, `no card for ${slot}`);
    assert.match(html, new RegExp(`<button class="homesideopen" data-btn="${b}" aria-label="[^"]+"></button>`), `${b} is the card's button`);
  }
  assert.ok(html.indexOf('data-btn="queue-join-open"') < html.indexOf('data-btn="queue-open"'),
    'the open games sit in the card, under its stretched button in the markup');
  const none = homeHtml(view({ leagueLive: false, challengeLive: false, slots: { ...view().slots, league: '', challenge: '' } }));
  assert.doesNotMatch(none, /nav-league|nav-challenge/, 'nothing to open: no button');
  assert.match(none, /No league running right now\./);
  assert.match(none, /No challenge this week\./);
  assert.match(none, /data-btn="queue-open"/, 'matchmaking is always open');
});

test('960 §6 the sheets: one at a time, from the view, each dismissable', () => {
  assert.doesNotMatch(homeHtml(view()), /data-sheet(?!=)/, 'no sheet drawn while none is open');
  const want: Record<string, RegExp[]> = {
    join: [/id="h-code"/, /data-btn="joincode"/, /<!--SLOT:invites-->/, /<!--SLOT:yourMatches-->/, /<!--SLOT:leagueMatches-->/],
    info: [/ui-sheet--anchor-bottom-left/, /<!--SLOT:info-->/],
    updates: [/ui-sheet--anchor-bottom-right/, /<!--SLOT:updates-->/],
    rules: [/Game values/, /data-btn="cr-step"/, /data-btn="cr-values"/, /data-btn="home-sheet-close"[^>]*>Done</],
    import: [/id="h-deckurl"/, /data-btn="deckimporturl"/, /id="h-decktext"/, /data-btn="deckimporttext"/],
    single: [/<!--SLOT:scpicker-->/, /data-btn="meta-ladder"/, /data-btn="newgame" type="button" disabled data-mode="constructed" data-single="1">Pick a card first/],
    'alerts-signin': [/Sign in to get friend invites/, /data-btn="acct-open-auth"/],
  };
  assert.deepEqual(Object.keys(want).sort(), [...HOME_SHEETS].sort(), 'a sheet is not checked here');
  for (const name of HOME_SHEETS) {
    const html = homeHtml(signedIn({ sheet: name }));
    assert.equal((html.match(/<div class="ui-sheet /g) ?? []).length, 1, `${name}: one sheet`);
    for (const re of want[name]!) assert.match(html, re, `${name}: ${re}`);
    assert.match(html, /<div class="ui-sheet__scrim" data-btn="home-sheet-close"/, `${name}: the scrim dismisses`);
    assert.match(html, /<button class="ui-sheet__close" type="button" data-btn="home-sheet-close"/, `${name}: the ✕ dismisses`);
    assert.ok(html.indexOf('class="ui-sheet ') > html.indexOf('<main') && html.indexOf('class="ui-sheet ') < html.indexOf('</main>'),
      `${name}: the sheet is inside #app (the ui-driver sees only #app)`);
  }
  assert.match(homeHtml(view({ sheet: 'join', slots: { ...view().slots, invites: '', yourMatches: '', leagueMatches: '' } })),
    /Nothing waiting for you — ask for a code\./);
  assert.match(homeHtml(view({ sheet: 'single', singleCard: 'Ignis <Sprite>' })), /data-single="1">Create duel · Ignis &lt;Sprite&gt;</);
  assert.match(homeHtml(view({ sheet: 'info' })), /class="ui-icon-button ui-icon-button--inline on homeinfo"/, 'its button shows it is open');
});

test('960 §7 the badges, and none at zero', () => {
  const zero = homeHtml(signedIn());
  assert.doesNotMatch(zero, /ui-icon-button__badge|homejoinbadge/);
  assert.match(zero, /<span class="ui-icon-button__label">Updates<\/span>/);
  const some = homeHtml(signedIn({ badges: { alerts: 4, join: 2, updates: 3 } }));
  assert.match(some, /homealerts[^>]*>[^]*?<span class="ui-icon-button__badge">4<\/span>/, 'Alerts counts the bell');
  assert.match(buttonOf(some, 'home-sheet', 'data-sheet="join"'), /homejoinbadge[^>]*>2</, 'Join counts what waits');
  assert.match(some, /<span class="ui-icon-button__label">Updates · 3 new<\/span>/, 'Updates says how many are new');
});

test('960 §8 every data-btn the old home drew is still reachable from the new one', () => {
  // the old home's list (960 §3 before 2026-11-03, plus what its slots drew):
  // each one must be on the new home in SOME state — a tab, a format or a sheet
  const OLD = ['cards-openpage', 'meta-openpage', 'deck-openpage', 'acct-open-auth', 'acct-open-profile', 'eltoggle', 'elrandom',
    'newgame', 'joincode', 'deckimporturl', 'deckimporttext', 'clockpick', 'meta-ladder', 'nav-league', 'nav-challenge',
    'queue-open', 'cc-bo', 'cc-new'];
  const states: HomeView[] = [
    view(), signedIn(), view({ draft: { ...view().draft, fixedOpen: true } }), cons(view()), cons(signedIn(), 'competitive'),
    ...HOME_SHEETS.map(s => signedIn({ sheet: s })), view({ sheet: 'import' }),
  ];
  const seen = new Set(states.flatMap(s => btns(homeHtml(s))));
  for (const b of OLD) assert.ok(seen.has(b), `data-btn="${b}" can no longer be reached on the home screen`);
  const all = states.map(homeHtml).join('');
  for (const a of ['data-help="rules"', 'data-learn="menu"', 'data-sbx="open"', 'data-report="open"', 'data-inbox="bell"'])
    assert.ok(all.includes(a), `${a} is gone from the home screen`);
  // the four kinds of New game, each still drawn: draft, draft with fixed elements, constructed, single card
  const modes = new Set([...all.matchAll(/data-btn="newgame" type="button"(?: title="[^"]*")?(?: disabled)? data-mode="(\w+)"( data-els="1")?( data-single="1")?/g)]
    .map(m => `${m[1]}${m[2] ? '+els' : ''}${m[3] ? '+single' : ''}`));
  assert.deepEqual([...modes].sort(), ['constructed', 'constructed+single', 'draft', 'draft+els']);
  for (const id of ['h-name', 'h-code', 'h-deck', 'h-deckurl', 'h-decktext', 'cc-deck'])
    assert.ok(all.includes(`id="${id}"`), `#${id} is gone`);
});
