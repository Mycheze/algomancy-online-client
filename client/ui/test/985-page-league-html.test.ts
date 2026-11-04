/* 985 — THE LEAGUE PAGE, ITS HOME BANNER AND ITS HEADER BUTTON, DRAWN WITHOUT
 * A PAGE (design-system round, 2026-11-03).
 *
 * The league's markup left ui/league.ts for pages/league.ts: leagueHtml,
 * leagueBannerHtml and leagueNavHtml draw a view and touch nothing else. This
 * file drives them with made-up views and no DOM — node has no `document`,
 * so a renderer that reached for one would throw here.
 *
 * §1 no season, signed out, a running week (entered), the organizer: the
 *    main states render, every data-btn the click handler routes is drawn
 * §2 player text is escaped (a season name, a Discord name, a dispute)
 * §3 the home banner: unfolded with How it works, folded to one line, none;
 *    the header button: sign up, organizer only, nothing
 * §4 BUG (owner, 2026-11-02 "tap cells + arrow keys"): the availability
 *    help text said "drag across the grid" on a touch screen too. It says
 *    "drag across" to a mouse and "tap hours on" to a finger, by the global
 *    .mouseonly/.touchonly switch on html.touch
 * §5 moved: the Report pill covering "Suggest a time" is fixed for every page (978 §7)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEAGUE_SECTIONS, leagueBannerHtml, leagueHtml, leagueNavHtml, leagueSections, defaultGrid,
  type LeagueState, type LeagueView, type SeasonView,
} from '../pages/league.ts';
import { readStyles } from './read-styles.ts';

const NOW = Date.UTC(2026, 10, 10, 12);
const W = 7 * 864e5;
const T0 = Date.UTC(2026, 10, 1, 7);
const P = (id: string, name: string, contact?: string) => ({ id, name, ...(contact ? { contact } : {}) });

function season(over: Partial<SeasonView> = {}): SeasonView {
  return {
    id: '2026-11', name: 'November', format: 'constructed', phase: 2, label: 'Week 2 of 3', weeks: 3, perWeek: 3, lateUntil: 2,
    signupOpens: new Date(T0 - W).toISOString(), start: new Date(T0).toISOString(),
    phases: [0, 1, 2, 3, 4, 5].map(k => ({ phase: k, label: k ? `Week ${k} of 3` : 'Sign-up week', at: new Date(T0 + (k - 1) * W).toISOString() })),
    auto: true, hold: false, hidden: false,
    entrants: [{ ...P('me', 'Me'), joinedPhase: 0, withdrawn: false, skips: [] }, { ...P('cy', 'Cy'), joinedPhase: 0, withdrawn: false, skips: [2] }],
    standings: [{ id: 'me', name: 'Me', w: 2, l: 1, unplayed: 0, points: 6, omw: 0.5, rank: 1 }, { id: 'cy', name: 'Cy', w: 1, l: 2, unplayed: 1, points: 3, omw: 0.6, rank: 2 }],
    matches: [{ id: 'm1', week: 2, final: false, a: P('me', 'Me'), b: P('cy', 'Cy'), result: null, room: null,
      disputes: [{ name: 'Cy', code: 'QXZZ', at: '', note: 'it <froze>' }] }],
    champion: null,
    me: { entered: true, withdrawn: false, skips: [], joinProblem: null, contact: 'me', suggestions: [], week0Cap: 3,
      matches: [{ id: 'm1', week: 2, final: false, opponent: P('cy', 'Cy', 'cy<1>'), windows: [{ start: NOW + 3_600_000, hours: 2 }],
        result: null, won: null, playable: true, time: { at: NOW + 7_200_000, mine: false, agreed: false } }] },
    repairProblem: null, formatProblem: null, log: [], outbox: [],
    ...over,
  };
}

function state(s: SeasonView | null, over: Partial<LeagueState> = {}): LeagueState {
  return { season: s, seasons: s ? [{ id: s.id, name: s.name, phase: s.phase, weeks: s.weeks, hidden: false }] : [],
    signedIn: true, availability: { tz: 'UTC', grid: defaultGrid() }, contact: 'me', minHours: 6, organizer: false, ...over };
}

function view(data: LeagueState | null, over: Partial<LeagueView> = {}): LeagueView {
  return {
    data, loading: false, msg: '', draft: { tz: 'UTC', grid: defaultGrid(), contact: 'me' }, dirty: false, busy: false,
    arming: null, gridFocus: null, timeOpen: null, preview: null, now: NOW, tz: 'UTC', browserTz: 'UTC', zones: ['UTC'],
    origin: 'https://example.test', stampAt: NOW, chips: { champion: '<!--SLOT:champion-->', finalist: '<!--SLOT:finalist-->' },
    section: 'season', chrome: { signedIn: true, alerts: 0 },
    ...over,
  };
}

const btns = (html: string): Set<string> => new Set([...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!));
/** the page has its parts as tabs since the app frame (2026-11-04): every part, drawn */
const allParts = (v: LeagueView): string => LEAGUE_SECTIONS.map(section => leagueHtml({ ...v, section })).join('\n');

test('985 §0 positive control: there is no DOM here', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
  // the app frame (pages/frame.ts), its page class last (287)
  assert.match(leagueHtml(view(null, { loading: true })), /^<div class="ui-app-shell ui-app-shell--contained ui-app-shell--fill apppage lgpage">/);
});

test('985 §1 the main states render, with every button the click handler routes', () => {
  assert.match(leagueHtml(view(null, { loading: true })), /<p class="dim">Loading…<\/p>/, 'loading');
  const none = leagueHtml(view(state(null)));
  assert.match(none, /No season yet/);
  assert.match(none, /class="ui-icon-button ui-icon-button--stack frameback" data-btn="lg-close"/, 'the way back, the toolbar\'s Home');

  const out = leagueHtml(view(state(season(), { signedIn: false, availability: null })));
  assert.match(out, /Sign in to join the league\./);
  assert.ok(btns(out).has('acct-open-auth'));
  assert.doesNotMatch(allParts(view(state(season(), { signedIn: false, availability: null }))), /id="lg-grid"/, 'no availability grid signed out');

  const running = allParts(view(state(season()), { timeOpen: null, arming: 'leave' }));
  for (const b of ['lg-close', 'lg-skip', 'lg-leave', 'lg-tz-here', 'lg-grid-preset', 'lg-grid-clear', 'lg-grid-save',
    'lg-play', 'lg-time-accept', 'lg-time-open', 'lg-stamp-copy']) assert.ok(btns(running).has(b), b);
  assert.match(running, /Press again to leave the league/, 'the armed button says so');
  assert.match(running, /class="ui-panel ui-panel--default ui-panel--wide"/, 'the cards are ui-panels');
  const form = leagueHtml(view(state(season()), { timeOpen: 'm1' }));
  for (const b of ['lg-time', 'lg-time-custom', 'lg-time-close']) assert.ok(btns(form).has(b), b);

  const org = allParts(view(state(season(), { organizer: true }), { preview: { week: 3, short: null, total: 1, edges: [] } }));
  for (const b of ['lg-advance', 'lg-preview', 'lg-set', 'lg-format', 'lg-repair', 'lg-add', 'lg-copy', 'lg-create', 'lg-override']) {
    assert.ok(btns(org).has(b), b);
  }
  assert.match(org, /Week 3 would be/, 'the preview');
  assert.match(org, /https:\/\/example\.test\/\?league/, 'the Discord post links the site the view names');
});

test('985 §2 player text is escaped', () => {
  const html = allParts(view(state(season({ name: 'Nov <b>' }), { organizer: true })));
  assert.match(html, /Nov &lt;b&gt;/);
  assert.doesNotMatch(html, /Nov <b>/);
  assert.match(html, /cy&lt;1&gt;/, 'a Discord name');
  assert.match(html, /it &lt;froze&gt;/, 'a dispute');
  const banner = leagueBannerHtml({ st: state(season({ name: 'Nov <b>' })), open: true, howOpen: true, tz: 'UTC' });
  assert.match(banner, /<b>Nov &lt;b&gt;<\/b>/);
});

test('985 §3 the home banner and the header button', () => {
  const st = state(season());
  const open = leagueBannerHtml({ st, open: true, howOpen: true, tz: 'UTC' });
  assert.match(open, /^<section class="lgbanner"/);
  assert.match(open, /<ul class="lgbhow">/, 'How it works, unfolded');
  for (const b of ['lg-banner', 'lg-how', 'lg-open', 'lg-play']) assert.ok(btns(open).has(b), b);
  const folded = leagueBannerHtml({ st, open: false, howOpen: null, tz: 'UTC' });
  assert.doesNotMatch(folded, /lgbbody/, 'folded to one line');
  assert.equal(leagueBannerHtml({ st: state(null), open: true, howOpen: null, tz: 'UTC' }), '', 'no season, no banner');

  const join = season({ phase: 0, label: 'Sign-up week', me: { ...season().me!, entered: false } });
  assert.match(leagueNavHtml({ season: join, organizer: false }), /class="homedecks lgnavjoin" data-btn="nav-league">🏅 League · sign up</);
  assert.match(leagueNavHtml({ season: null, organizer: true }), /data-btn="nav-league">🏅 League</, 'an organizer, before any season');
  assert.equal(leagueNavHtml({ season: null, organizer: false }), '');
});

test('985 §4 the grid help text follows the input method: drag to a mouse, tap to a finger', () => {
  const html = leagueHtml(view(state(season()), { section: 'avail' }));
  assert.match(html, /pick quick fills, or <span class="mouseonly">drag across<\/span><span class="touchonly">tap hours on<\/span> the grid\./);
  const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /(^|\})\s*\.touchonly\s*\{\s*display:\s*none;?\s*\}/, 'a mouse never sees the finger words');
  assert.match(css, /html\.touch \.mouseonly[^{]*\{\s*display:\s*none/, 'a finger never sees the mouse words');
});

// 985 §5 (a league-only phone padding for the Report pill) is gone: the pill now keeps the
// corner clear on EVERY page while it is up (shared/13-report-and-inbox.css, guarded by 978 §7).

test('985 §6 the app frame: the parts as tabs, the seasons as a rail, each part its own scroll', () => {
  const v = view(state(season()));
  // the tabs: Availability only signed in, Organizer only for an organizer
  assert.deepEqual(leagueSections(v), ['season', 'avail', 'standings', 'stamp']);
  assert.deepEqual(leagueSections(view(state(season(), { signedIn: false }))), ['season', 'standings', 'stamp']);
  assert.deepEqual(leagueSections(view(state(season(), { organizer: true }))), [...LEAGUE_SECTIONS]);
  const html = leagueHtml(v);
  assert.match(html, /class="ui-segmented__option on" data-btn="lg-section" type="button" data-value="season" aria-pressed="true" data-v="season">Season</);
  assert.match(html, /data-scroll="lg-season-2026-11"/, 'the part showing scrolls by itself, keyed by part and season');
  // a part the viewer has not got falls back to the season
  assert.match(leagueHtml(view(state(season(), { signedIn: false }), { section: 'avail' })), /aria-pressed="true" data-v="season"/);
  // one season and nothing else running: no rail
  assert.doesNotMatch(html, /class="lgrail"/);
  // two: a row each; the one showing is marked and has no Play (its matches are beside it);
  // another season's open match has its Play in its row
  const other = season({ id: 'old', name: 'October', phase: 4, label: 'The final' });
  const two = leagueHtml(view(state(season(), {
    seasons: [{ id: 'old', name: 'October', phase: 4, weeks: 3, hidden: false }, { id: '2026-11', name: 'November', phase: 2, weeks: 3, hidden: false },
      { id: 'dec', name: 'December', phase: -1, weeks: 3, hidden: false }],
    others: [other],
  })));
  const rail = /<nav class="lgrail"[\s\S]*?<\/nav>/.exec(two)?.[0] ?? '';
  assert.match(rail, /data-btn="lg-season" data-id="old"/);
  assert.match(rail, /<div class="lgrailrow on">\s*<button class="lgrailopen" data-btn="lg-season" data-id="2026-11" aria-current="true">/);
  assert.match(rail, /data-btn="lg-play" data-season="old" data-match="m1"/, 'the other season\'s Play');
  assert.doesNotMatch(rail, /data-season="2026-11"/, 'no Play for the season showing');
  assert.match(rail, /data-id="dec"[\s\S]*?Announced/, 'a season the answer only numbers still says where it is');
  // a join problem that is fixed on Availability says where that is
  const blocked = leagueHtml(view(state(season({ phase: 0, label: 'Sign-up week', me: { ...season().me!, entered: false, joinProblem: 'mark when you are usually free' } }))));
  assert.match(blocked, /Mark when you are usually free\. <button class="linkbtn" data-btn="lg-section" data-v="avail">Availability<\/button>/);
});
