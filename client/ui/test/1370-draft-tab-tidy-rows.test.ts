/* 1370 — THE DRAFT TAB, TIDIED (owner, 2026-11-14: "let's actually fix this whole box up a bit …
 * That should greatly simplify the Draft Play area"), DOM-free: pages/home.ts homeHtml(view).
 *
 * §1 the rows, in order: Rules, Clock, Elements, Alternate modes, More settings (shut) — owner
 *    2026-11-14: "More settings should be below the Alt modes. It looks weird in this order"; no
 *    "Draft from shared packs…" line, no reminder under Elements, no Mode row
 * §2 More settings shut hides Cards, Banned and Game values; open, it draws them in place, last;
 *    the disclosure says which way it is (aria-expanded)
 * §3 shut, it says how many of its settings are changed (moreChanged), so a custom game is never
 *    hidden — Simple cards only (owner 2026-11-03: "not hard to miss"), the filter, the bans (one
 *    setting), each game value
 * §4 Alternate modes: Standard | Beginner | Cube draft, Standard on by default; Cube draft greys
 *    out every other row (disabled fieldsets above and below it: inert, not hidden) and the one gold button is
 *    "Host a Cube draft"; Beginner keeps its line
 * §5 the Constructed tab is as it was
 * §6 the screenshot rig photographs the four Draft states (server/e2e/ui-shots-states.mjs)
 * §7 a repaint puts the same pictures back (owner 2026-11-14: "all the images on the screen flash
 *    for a frame"): keepArt, which paintHome paints through — since 2026-11-14 the shared one in
 *    pages/frame.ts that every page paints through (test/1375–1377)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeHtml, moreChanged, type HomeView } from '../pages/home.ts';
import { keepArt } from '../pages/frame.ts';
import type { CustomRulesView } from '../pages/customrules.ts';
import type { CustomRules } from '../customrules.ts';
import { DEAL_DEFAULTS } from '../../engine/src/draftdeal.ts';
import { SCENARIOS } from '../../server/e2e/ui-shots-states.mjs';

const STANDARD = { v: 1, ...DEAL_DEFAULTS, simpleOnly: false, query: '', bans: [], preset: null } as CustomRules;
const RULES: CustomRulesView = {
  active: null, rules: STANDARD, summary: [], values: [], beginner: false, advancedOpen: false, banDraft: '',
  deckCount: 528, simpleCount: 300, suggestions: '', queryNote: '', pool: '<!--SLOT:pool-->',
};
const ART = { src: 'a.jpg', card: 'A', focusY: 30 };
function view(over: Partial<HomeView> = {}, draft: Partial<HomeView['draft']> = {}): HomeView {
  return {
    account: { resolving: false, me: null }, nameBox: '', signedIn: false, mode: 'draft', format: 'casual', sheet: null,
    draft: { k: 3, els: [], fixedOpen: false, setCount: 35, fixedError: undefined, customError: undefined, custom: false, rules: RULES, ...draft },
    clock: { mode: 'draft', auto: true, now: 60 * 60_000, byModeMin: 60 }, error: '',
    deckPicker: { current: null, signedIn: false, mine: [], defaults: null, msg: '' }, hasDeck: false,
    competitive: { signedIn: false, decks: null, bestOf: 1, pick: null }, singleCard: null,
    leagueLive: true, challengeLive: true, badges: { alerts: 0, join: 0, updates: 0 },
    slots: { league: '', challenge: '', queue: '', invites: '', yourMatches: '', leagueMatches: '', scpicker: '', info: '', updates: '' },
    art: { backdrop: ART, draft: ART, constructed: ART, league: ART, challenge: ART, queue: ART },
    ...over,
  };
}
const play = (h: string): string => h.slice(h.indexOf('<section class="homeplay"'), h.indexOf('</section>', h.indexOf('<section class="homeplay"')));
const labels = (h: string): string[] => [...play(h).matchAll(/<div class="ui-setting-row__label">([^<]+)<\/div>/g)].map(m => m[1]!);
const moreBtn = (h: string): string => /<button[^>]*data-btn="home-more"[^>]*>[^]*?<\/button>/.exec(h)?.[0] ?? '';
/** every greyable row: the fieldsets' markup, joined */
const fieldset = (h: string): string => [...h.matchAll(/<fieldset class="homerowsset"[^>]*>[^]*?<\/fieldset>/g)].map(m => m[0]).join('');

test('1370 §1 the rows, in order, and the lines that went', () => {
  const html = homeHtml(view());
  assert.deepEqual(labels(html), ['Rules', 'Clock', 'Elements', 'Alternate modes']);
  const p = play(html);
  assert.ok(p.indexOf('data-pick="now"') < p.indexOf('Alternate modes') && p.indexOf('Alternate modes') < p.indexOf('data-btn="home-more"'),
    'More settings sits under Alternate modes');
  assert.doesNotMatch(html, /Draft from shared packs|homeplaysub/, 'the description line is gone');
  assert.doesNotMatch(html, /elements in the room\./, 'Elements has no reminder line');
  assert.doesNotMatch(html, />Mode</, 'no Mode row');
  assert.doesNotMatch(html, /nav-cube|Cube draft…/, 'the line\'s link went with it');
});

test('1370 §2 More settings: shut hides its rows, open draws them in place', () => {
  const shut = homeHtml(view());
  assert.match(moreBtn(shut), /aria-expanded="false"/);
  assert.match(moreBtn(shut), /<span>More settings<\/span>/);
  for (const b of ['cr-simple', 'cr-advanced', 'cr-unban']) assert.doesNotMatch(shut, new RegExp(`data-btn="${b}"`), `${b} shows while shut`);
  assert.doesNotMatch(shut, /id="cr-ban"|data-sheet="rules"/);
  assert.match(shut, /<div id="cr-pool" class="crpool"><!--SLOT:pool--><\/div>/, 'the pool verdict is never behind it');
  const open = homeHtml(view({}, { more: true }));
  assert.match(moreBtn(open), /aria-expanded="true" aria-controls="home-more-rows"/);
  assert.deepEqual(labels(open), ['Rules', 'Clock', 'Elements', 'Alternate modes', 'Cards', 'Banned', 'Game values']);
  assert.match(open, /<div class="homemorerows" id="home-more-rows">/);
  for (const re of [/data-btn="cr-simple"/, /data-btn="cr-advanced"/, /<input id="cr-ban" /, /data-btn="home-sheet"[^>]*data-sheet="rules"[^>]*>Change…</])
    assert.match(open, re);
});

test('1370 §3 shut, it says how many of its settings are changed', () => {
  const r = (rules: Partial<CustomRules>, values: string[] = []): CustomRulesView => ({ ...RULES, rules: { ...STANDARD, ...rules }, values });
  assert.equal(moreChanged(RULES), 0);
  assert.equal(moreChanged(r({ simpleOnly: true })), 1, 'Simple cards only');
  assert.equal(moreChanged(r({ query: 'set:lightdark' })), 1, 'the card filter');
  assert.equal(moreChanged(r({ bans: ['A', 'B', 'C'] })), 1, 'the bans are one setting');
  assert.equal(moreChanged(r({ simpleOnly: true, bans: ['A'] }, ['2 elements', 'Packs of 5'])), 4, 'each value');
  assert.doesNotMatch(moreBtn(homeHtml(view())), /changed/, 'nothing changed: nothing said');
  const simple = moreBtn(homeHtml(view({}, { rules: { ...r({ simpleOnly: true }), summary: ['Simple cards only'] } })));
  assert.match(simple, /<span class="ui-chip ui-chip--accent ui-chip--pill homemorecount">1 changed<\/span><\/button>$/);
  assert.match(simple, /title="Simple cards only"/, 'the hover names what is set');
  assert.match(moreBtn(homeHtml(view({}, { more: true, rules: r({ simpleOnly: true }) }))), /1 changed/, 'open too');
});

test('1370 §4 Alternate modes: Standard by default; Cube draft greys the rest out and hosts', () => {
  const opt = (h: string, v: string): string => new RegExp(`<button[^>]*data-value="${v}"[^>]*>[^<]*</button>`).exec(h)?.[0] ?? '';
  const std = homeHtml(view());
  assert.match(opt(std, 'standard'), /class="ui-segmented__option on" data-btn="cr-beginner"[^>]*data-on="0">Standard</);
  assert.match(opt(std, 'beginner'), /aria-pressed="false"[^>]*data-on="1">Beginner</);
  assert.match(opt(std, 'cube'), /data-btn="home-cube"[^>]*aria-pressed="false"[^>]*>Cube draft</);
  assert.doesNotMatch(fieldset(std), /disabled/, 'positive control: Standard leaves the rows live');
  assert.match(std, /data-btn="newgame"[^>]*data-mode="draft">Create room</);
  // Beginner: the old Mode row's Beginner, with its line
  const beg = homeHtml(view({}, { rules: { ...RULES, beginner: true } }));
  assert.match(opt(beg, 'beginner'), /class="ui-segmented__option on"/);
  assert.match(beg, /<span class="homemodehint">The rulebook’s Quick Start: [^<]+<\/span>/);
  // Cube draft: every row but Alternate modes is in the disabled fieldset
  const cube = homeHtml(view({}, { cube: true, rules: { ...RULES, beginner: true }, fixedOpen: true, els: ['fire', 'wood'] }));
  assert.match(opt(cube, 'cube'), /class="ui-segmented__option on" data-btn="home-cube"/);
  assert.doesNotMatch(opt(cube, 'beginner'), / on"/, 'one option on');
  assert.doesNotMatch(cube, /homemodehint/, 'no Beginner line under Cube draft');
  const fs = fieldset(cube);
  assert.equal((cube.match(/<fieldset class="homerowsset" disabled>/g) ?? []).length, 2, 'above Alternate modes and below it');
  assert.doesNotMatch(cube, /<fieldset class="homerowsset">/);
  for (const b of ['home-format', 'clockpick', 'home-els', 'eltoggle', 'elrandom', 'home-more']) assert.match(fs, new RegExp(`data-btn="${b}"`), `${b} is not greyed out`);
  assert.doesNotMatch(fs, /Alternate modes|home-cube/, 'Alternate modes stays live');
  assert.equal(labels(cube).length, 4, 'disabled, not hidden');
  assert.match(cube, /<button class="ui-button ui-button--action homecreate" data-btn="home-cube-host" type="button" title="[^"]+">Host a Cube draft<\/button>/);
  assert.doesNotMatch(cube, /data-btn="newgame"/);
  assert.match(cube, /data-sheet="join"/, 'Join a room stays');
  assert.match(opt(homeHtml(view({ badges: { alerts: 0, join: 0, updates: 0, cube: 3 } })), 'cube'), />Cube draft · 3</, 'my events\' count');
});

test('1370 §5 the Constructed tab is as it was', () => {
  const html = homeHtml(view({ mode: 'constructed' }));
  assert.deepEqual(labels(html), ['Rules', 'Best of', 'Clock', 'Deck']);
  assert.match(html, /<p class="homeplaysub">Bring a deck you built: 30 cards, at most 2 of each\.<\/p>/);
  assert.doesNotMatch(html, /home-more|home-cube|homerowsset|Alternate modes/);
});

test('1370 §6 the rig photographs Standard, More settings open, Beginner and Cube draft', () => {
  const FX = { seasons: { running: 's1' }, challenge: { current: 'c1', past: 'c0' }, sharedDeck: 'd1', decks: { pub: 'dp', unlisted: 'du', maybe: 'dm' }, cc: { deck: 'd2', room: 'R', seat: 0 } };
  const home = (SCENARIOS(FX) as { page: string; state: string; steps?: { click?: string }[] }[]).filter(s => s.page === 'home');
  const steps = (state: string): string[] => (home.find(s => s.state === state)?.steps ?? []).map(s => s.click ?? '');
  assert.ok(home.some(s => s.state === 'signed-in' && !s.steps?.length), 'Standard');
  assert.deepEqual(steps('more-open'), ['[data-btn="home-more"]']);
  assert.deepEqual(steps('beginner'), ['[data-btn="cr-beginner"][data-on="1"]']);
  assert.deepEqual(steps('cube-draft'), ['[data-btn="home-cube"]']);
  // the states that reach a row behind the disclosure open it first
  for (const s of ['customrules-open', 'ban-typing']) assert.equal(steps(s)[0], '[data-btn="home-more"]', s);
});

test('1370 §7 a repaint puts the same pictures back, not new ones (keepArt)', () => {
  // a stand-in #app: its pictures are the elements a paint leaves, each with its markup
  type Img = { outerHTML: string; id: number; replaceWith(n: Img): void };
  let made = 0;
  let imgs: Img[] = [];
  const paintOf = (srcs: string[]) => (): void => {
    imgs = srcs.map(src => {
      const me: Img = { outerHTML: `<img src="${src}" alt="" loading="lazy">`, id: ++made,
        replaceWith(n: Img) { imgs[imgs.indexOf(me)] = n; } };
      return me;
    });
  };
  const app = { querySelectorAll: (sel: string) => { assert.equal(sel, 'img'); return imgs as unknown as NodeListOf<Element>; } };
  paintOf(['back.jpg', 'draft.jpg', 'cons.jpg', 'side.jpg', 'side.jpg'])();
  const first = imgs.map(i => i.id);
  keepArt(app, paintOf(['back.jpg', 'draft.jpg', 'cons.jpg', 'side.jpg', 'side.jpg']));
  assert.deepEqual(imgs.map(i => i.id), first, 'every picture is the element it was — twins included');
  keepArt(app, paintOf(['back.jpg', 'other.jpg', 'cons.jpg', 'side.jpg', 'side.jpg']));
  assert.equal(imgs[1]!.id > first[4]!, true, 'a picture that changed is the new element');
  assert.deepEqual([0, 2, 3, 4].map(i => imgs[i]!.id), [0, 2, 3, 4].map(i => first[i]!), 'and the rest are kept');
});

test('1370 §8 paintHome paints through keepArt — never a bare innerHTML that re-creates the pictures', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../pages/home.ts', import.meta.url), 'utf8');
  const start = src.indexOf('export function paintHome(');
  assert.ok(start > 0, 'paintHome is in pages/home.ts');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  const paints = body.split('\n').filter(l => /\bapp\.innerHTML\s*=/.test(l));
  assert.ok(paints.length > 0, 'non-vacuous: paintHome writes #app');
  for (const l of paints) assert.match(l, /keepArt\(app,/, `a repaint outside keepArt flashes every picture: ${l.trim()}`);
});
