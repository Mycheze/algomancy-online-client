/* 1239 — "YOUR MATCHES" SAYS WHAT HAPPENS AT THE TABLE IN THIS SEASON'S FORMAT
 * (BL-10, docs/23-ui-inventory/02 §8.4 item 21: "The league footnote says 'the
 * elements are drawn at random' even for constructed seasons").
 *
 * The note under a player's league matches ended "Nothing is dealt until you
 * are both there, and the elements are drawn at random." in every season. Only
 * a live-draft season draws elements: a casual constructed match is a room
 * where each player picks a deck (server/api-league.ts openRoom `mode`), and a
 * Competitive one is a best of three with a registered deck
 * (server/league-match.ts). Neither draws anything.
 *
 * §1 a draft season still says the elements are drawn at random
 * §2 a casual constructed season says each of you picks a deck, never elements
 * §3 a Competitive season says each of you registers a deck, never elements
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultGrid, leagueHtml, type Format, type LeagueView, type SeasonView } from '../pages/league.ts';

const NOW = Date.UTC(2026, 10, 10, 12);
const W = 7 * 864e5;
const T0 = Date.UTC(2026, 10, 1, 7);
const P = (id: string, name: string) => ({ id, name });

function season(format: Format | undefined): SeasonView {
  return {
    id: '2026-11', name: 'November', ...(format ? { format } : {}), phase: 2, label: 'Week 2 of 3', weeks: 3, perWeek: 3, lateUntil: 2,
    signupOpens: new Date(T0 - W).toISOString(), start: new Date(T0).toISOString(),
    phases: [0, 1, 2, 3, 4, 5].map(k => ({ phase: k, label: k ? `Week ${k} of 3` : 'Sign-up week', at: new Date(T0 + (k - 1) * W).toISOString() })),
    auto: true, hold: false, hidden: false,
    entrants: [{ ...P('me', 'Me'), joinedPhase: 0, withdrawn: false, skips: [] }, { ...P('cy', 'Cy'), joinedPhase: 0, withdrawn: false, skips: [] }],
    standings: [],
    matches: [{ id: 'm1', week: 2, final: false, a: P('me', 'Me'), b: P('cy', 'Cy'), result: null, room: null, disputes: [] }],
    champion: null,
    me: { entered: true, withdrawn: false, skips: [], joinProblem: null, contact: 'me', suggestions: [], week0Cap: 3,
      matches: [{ id: 'm1', week: 2, final: false, opponent: P('cy', 'Cy'), windows: [],
        result: null, won: null, playable: true, time: null }] },
    repairProblem: null, formatProblem: null, log: [], outbox: [],
  } as SeasonView;
}

function page(format: Format | undefined): string {
  const s = season(format);
  const v: LeagueView = {
    data: { season: s, seasons: [{ id: s.id, name: s.name, phase: s.phase, weeks: s.weeks, hidden: false }], signedIn: true,
      availability: { tz: 'UTC', grid: defaultGrid() }, contact: 'me', minHours: 6, organizer: false },
    loading: false, msg: '', msgTone: 'error', draft: { tz: 'UTC', grid: defaultGrid(), contact: 'me' }, dirty: false, busy: false,
    arming: null, gridFocus: null, timeOpen: null, preview: null, now: NOW, tz: 'UTC', browserTz: 'UTC', zones: ['UTC'],
    origin: 'https://example.test', stampAt: NOW, chips: { champion: '', finalist: '' },
    section: 'season', chrome: { signedIn: true, alerts: 0 },
  };
  const html = leagueHtml(v);
  // positive control: "Your matches" and its note are on the page at all
  assert.match(html, /Your matches/);
  assert.match(html, /Nothing is dealt until you are both there/);
  return html;
}

test('1239 §1 a live-draft season: the elements are drawn at random', () => {
  for (const f of [undefined, 'draft'] as const) {
    assert.match(page(f), /Nothing is dealt until you are both there, and the elements are drawn at random\./, String(f));
  }
});

test('1239 §2 a casual constructed season: each of you picks a deck, no elements are drawn', () => {
  const html = page('constructed');
  assert.match(html, /Nothing is dealt until you are both there and each of you has picked a deck\./);
  assert.doesNotMatch(html, /drawn at random/);
});

test('1239 §3 a Competitive season: each of you registers a deck, no elements are drawn', () => {
  const html = page('competitive');
  assert.match(html, /Nothing is dealt until you are both there and each of you has registered a deck\./);
  assert.doesNotMatch(html, /drawn at random/);
});
