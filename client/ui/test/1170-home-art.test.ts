/* 1170 — THE HOME'S ART AND DISPLAY TYPE (ui/homeart.ts, owner 2026-11-07:
 * "more colour… card images", after Caleb's early mockups).
 *
 * The home draws card paintings behind the page, the Draft | Constructed
 * tiles and the League, Challenge and Matchmaking cards, and sets its titles
 * in the brand's wide face. The picks are taste, written once in homeart.ts;
 * this holds them to the disk and to the page.
 *
 * §1 every card name homeart.ts can return has a scan in data/cards/ (a rename
 *    would otherwise just lose its picture, silently)
 * §2 the backdrop follows the favourite element; the challenge's art is its
 *    own, else the same pool pick every time for the same id
 * §3 homeHtml draws every picture as decoration (aria-hidden, no alt, removes
 *    itself on a failed load), its crop centred where the view says, and
 *    Draft | Constructed as two pressed-state tiles
 * §5 Draft and Constructed: two different random cards a page load, real
 *    cards only, the same two on every paint; the crop centres on the painting
 * §4 the brand face: Ethnocentric (gitignored: Typodermic's, and the repo is public)
 *    first, Krona One (committed, OFL) behind it
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARDS_DIR, UI_DIR } from '../../engine/scripts/paths.mjs';
import {
  ALL_HOME_ART, backdropCard, CHALLENGE_ART, CHALLENGE_POOL, challengeArtCard, DEFAULT_BACKDROP, drawModeArt, focusOn, modeArt,
  modeArtPool, RESOURCE_ART, scanOf,
} from '../homeart.ts';
import { ALL_ELEMENTS } from '../../engine/src/apply.ts';
import { homeHtml, type HomeView } from '../pages/home.ts';
import { readStyles } from './read-styles.ts';
import { STANDARD_RULES } from '../customrules.ts';

const file = (card: string): string => card.replace(/ /g, '-') + '.jpg';

test('1170 §1 every picture the home can show is a scan on disk', () => {
  assert.ok(ALL_HOME_ART.length >= 20, 'positive control: the list is the whole list');
  const missing = ALL_HOME_ART.filter(c => !existsSync(join(CARDS_DIR, file(c))));
  assert.deepEqual(missing, []);
  assert.match(scanOf('Water Resource'), /Water-Resource\.jpg/);
  for (const el of ALL_ELEMENTS) assert.ok(RESOURCE_ART[el], `${el} has a resource painting`);
});

test('1170 §2 the backdrop follows the favourite; a challenge keeps its picture', () => {
  assert.equal(backdropCard('fire'), 'Fire Resource');
  assert.equal(backdropCard(null), DEFAULT_BACKDROP);
  assert.equal(backdropCard('not-an-element'), DEFAULT_BACKDROP);
  const named = Object.keys(CHALLENGE_ART)[0]!;
  assert.equal(challengeArtCard(named), CHALLENGE_ART[named]);
  const a = challengeArtCard('2099-01-01-unnamed');
  assert.ok(CHALLENGE_POOL.includes(a));
  assert.equal(challengeArtCard('2099-01-01-unnamed'), a, 'the same id draws the same picture every time');
  assert.ok(CHALLENGE_POOL.includes(challengeArtCard('')), 'no week: still a picture, never undefined');
});

function view(mode: HomeView['mode']): HomeView {
  return {
    account: { resolving: false, me: null }, nameBox: '', signedIn: false, mode, format: 'casual', sheet: null,
    draft: { k: 3, els: [], fixedOpen: false, setCount: 35, fixedError: undefined, customError: undefined, custom: false,
      rules: { active: null, rules: { ...STANDARD_RULES, bans: [] }, summary: [], values: [], beginner: false, advancedOpen: false, banDraft: '',
        deckCount: 528, simpleCount: 300, suggestions: '', queryNote: '', pool: '' } },
    clock: { mode: 'draft', auto: true, now: 0, byModeMin: 60 }, error: '',
    deckPicker: { current: null, signedIn: false, mine: [], defaults: null, msg: '' }, hasDeck: false,
    competitive: { signedIn: false, decks: null, bestOf: 3, pick: null }, singleCard: null,
    leagueLive: true, challengeLive: false, badges: { alerts: 0, join: 0, updates: 0 },
    slots: { league: '', challenge: '', queue: '', invites: '', yourMatches: '', leagueMatches: '', scpicker: '', info: '', updates: '' },
    art: { backdrop: { src: 'B.jpg', card: 'Backdrop Card', focusY: 30 }, draft: { src: 'D.jpg', card: 'Draft Card', focusY: 30 }, constructed: { src: 'C.jpg', card: 'Constructed Card', focusY: 30 }, league: { src: 'L.jpg', card: 'League Card', focusY: 30 }, challenge: { src: 'CH.jpg', card: 'Challenge Card', focusY: 30 }, queue: { src: 'Q.jpg', card: 'Queue Card', focusY: 30 } },
  };
}

test('1170 §3 the page draws each picture as decoration, and the two mode tiles', () => {
  const html = homeHtml(view('draft'));
  const imgs = [...html.matchAll(
    /<span class="homeart ([^"]+)" aria-hidden="true"><img src="([^"]+)" alt="" loading="lazy" style="object-position:50% (\d+)%" onerror="this.remove\(\)"><\/span>/g)]
    .map(m => `${m[1]}=${m[2]}@${m[3]}`);
  assert.deepEqual(imgs.sort(), [
    'homebackdrop=B.jpg@30', 'homemodeart=C.jpg@30', 'homemodeart=D.jpg@30',
    'homesideart=CH.jpg@30', 'homesideart=L.jpg@30', 'homesideart=Q.jpg@30',
  ]);
  assert.doesNotMatch(html, /homeartname/, 'no caption on a painting (owner: the crop was the problem, not the name)');
  assert.equal((html.match(/<img /g) ?? []).length, imgs.length, 'positive control: no picture escaped the pattern');
  assert.match(html, /<div class="homemodes" role="group" aria-label="Game type">/);
  assert.match(html, /class="homemodetile on" data-btn="home-mode" type="button" aria-pressed="true" data-mode="draft"/);
  assert.match(html, /class="homemodetile" data-btn="home-mode" type="button" aria-pressed="false" data-mode="constructed"/);
  const cons = homeHtml(view('constructed'));
  assert.match(cons, /class="homemodetile on"[^>]*data-mode="constructed"/);
  // the wordmark: the info button keeps its full name for a screen reader
  assert.match(html, /aria-label="Algomancy Online \(Unofficial Client\)"[^>]*>.*<span class="homewordmark">Algomancy<\/span>/s);
});

test('1170 §4 the brand face: Ethnocentric where present, never in git; Krona One always', () => {
  const css = readStyles();
  const src = (family: string): string | undefined =>
    new RegExp(`@font-face \\{ font-family: '${family}';[^}]*src: url\\('fonts/([^']+)'\\) format\\('woff2'\\); \\}`).exec(css)?.[1];
  const brand = src('Algo Brand'), fallback = src('Algo Display');
  assert.equal(brand, 'Ethnocentric-Regular.woff2');
  assert.equal(fallback, 'KronaOne-Regular.woff2');
  assert.match(css, /--font-brand: 'Algo Brand', 'Algo Display'/, 'Ethnocentric first, the free face behind it');
  // the fallback is committed and licensed…
  assert.ok(existsSync(join(UI_DIR, 'fonts', fallback!)));
  assert.match(readFileSync(join(UI_DIR, 'fonts', 'KronaOne-OFL.txt'), 'utf8'), /SIL Open Font License/);
  // …and Ethnocentric is not ours to publish: the public repo must never carry it
  assert.match(readFileSync(join(UI_DIR, '.gitignore'), 'utf8'), /^fonts\/Ethnocentric-\*$/m);
  const tracked = execFileSync('git', ['ls-files', '--', 'fonts'], { cwd: UI_DIR, encoding: 'utf8' });
  assert.match(tracked, /KronaOne-Regular\.woff2/, 'positive control: git sees the fonts folder');
  assert.doesNotMatch(tracked, /Ethnocentric/i);
});

test('1170 §5 the mode tiles: a random real card each, drawn once a load', () => {
  const pool = modeArtPool();
  assert.ok(pool.length > 300, `positive control: the pool is the card pool (${pool.length})`);
  const names = new Set(pool.map(p => p.card));
  for (const not of ['Fire Resource', 'Cardback', 'Blank Card', 'Unit Token']) assert.ok(!names.has(not), `${not} is no painting to show`);
  const missing = pool.filter(p => !existsSync(join(CARDS_DIR, p.image))).map(p => p.card);
  assert.deepEqual(missing, [], 'every card in the pool has its scan');

  // the ends of the random range: the first card and the last, never the same twice
  const lo = drawModeArt(() => 0), hi = drawModeArt(() => 0.999999);
  assert.equal(lo.draft.card, pool[0]!.card);
  assert.notEqual(lo.draft.card, lo.constructed.card);
  assert.equal(hi.draft.card, pool[pool.length - 1]!.card);
  assert.notEqual(hi.draft.card, hi.constructed.card);
  for (let k = 0; k < 200; k++) {
    const d = drawModeArt();
    assert.notEqual(d.draft.card, d.constructed.card);
  }
  assert.deepEqual(modeArt(), modeArt(), 'one draw per page load: a repaint keeps the same two');

  // the crop: the middle of the painting, between the name bar and the rules box
  assert.equal(focusOn(0.78), 43, "(0.445 − 0.125) / 0.75");
  assert.ok(focusOn(0.6) < focusOn(0.9), 'a taller painting centres lower');
  assert.ok(focusOn(null) >= 0 && focusOn(null) <= 100);
});
