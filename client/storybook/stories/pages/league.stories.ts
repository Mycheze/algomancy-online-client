/* The League page, its home banner and its header button (ui/pages/league.ts),
 * drawn from made-up views: no server, no account. The page's own buttons do
 * nothing here — their handler is ui/league.ts, which a story does not load. */
import { CHROME } from './_page.ts';
import {
  defaultGrid, leagueBannerHtml, leagueGlanceHtml, leagueGlanceView, leagueHtml, leagueJoinRowsHtml, leagueJoinView, leagueNavHtml,
  type LeagueState, type LeagueView, type SeasonView,
} from '../../../ui/pages/league.ts';

const NOW = Date.UTC(2026, 10, 10, 18);
const W = 7 * 864e5;
const T0 = Date.UTC(2026, 10, 1, 7);
const P = (id: string, name: string, contact?: string) => ({ id, name, ...(contact ? { contact } : {}) });
const NAMES = ['Ann', 'Bo', 'Cy', 'Dee', 'Eli', 'Fen', 'Gus', 'Hal', 'Ivy'];

function season(over: Partial<SeasonView> = {}): SeasonView {
  return {
    id: '2026-11', name: 'November League', format: 'constructed', phase: 2, label: 'Week 2 of 3', weeks: 3, perWeek: 3, lateUntil: 2,
    signupOpens: new Date(T0 - W).toISOString(), start: new Date(T0).toISOString(),
    phases: [0, 1, 2, 3, 4, 5].map(k => ({ phase: k, label: k === 0 ? 'Sign-up week' : k === 4 ? 'The final' : k === 5 ? 'Finished' : `Week ${k} of 3`,
      at: new Date(T0 + (k - 1) * W).toISOString() })),
    auto: true, hold: false, hidden: false,
    entrants: ['Me', ...NAMES].map((n, i) => ({ ...P(i ? `p${i}` : 'me', n), joinedPhase: 0, withdrawn: i === 9, skips: [] })),
    standings: ['Me', ...NAMES].map((n, i) => ({ id: i ? `p${i}` : 'me', name: n, w: 4 - (i >> 1), l: i >> 2, unplayed: i % 3 === 2 ? 1 : 0,
      points: 12 - i, omw: 0.62 - i / 40, rank: i + 1 })),
    matches: [
      { id: 'm1', week: 2, final: false, a: P('me', 'Me'), b: P('p1', 'Ann'), result: null, room: null },
      { id: 'm2', week: 2, final: false, a: P('p2', 'Bo'), b: P('p3', 'Cy'), result: { outcome: 'a', how: 'game', at: '' }, room: null },
      { id: 'm3', week: 1, final: false, a: P('me', 'Me'), b: P('p2', 'Bo'), result: { outcome: 'a', how: 'game', at: '' }, room: null },
      { id: 'm4', week: 1, final: false, a: P('p1', 'Ann'), b: P('p3', 'Cy'), result: { outcome: 'unplayed', how: 'deadline', at: '' }, room: null },
    ],
    champion: null,
    me: { entered: true, withdrawn: false, skips: [], joinProblem: null, contact: 'me_plays', suggestions: [], week0Cap: 3,
      matches: [
        { id: 'm1', week: 2, final: false, opponent: P('p1', 'Ann', 'ann_d'), windows: [{ start: NOW + 3_600_000, hours: 3 }, { start: NOW + 25 * 3_600_000, hours: 2 }],
          result: null, won: null, playable: true, time: { at: NOW + 26 * 3_600_000, mine: false, agreed: false } },
        { id: 'm3', week: 1, final: false, opponent: P('p2', 'Bo'), windows: [], result: { outcome: 'a', how: 'game', at: '' }, won: true, playable: false, time: null },
      ] },
    repairProblem: null, formatProblem: null,
    log: [{ at: new Date(T0 + W).toISOString(), what: 'week 2 paired' }],
    outbox: [{ id: 1, to: 'Ann', kind: 'pairing', createdAt: new Date(T0 + W).toISOString(), sentAt: new Date(T0 + W).toISOString(), failed: null }],
    ...over,
  };
}

const state = (s: SeasonView | null, over: Partial<LeagueState> = {}): LeagueState => ({
  season: s, seasons: s ? [{ id: s.id, name: s.name, phase: s.phase, weeks: s.weeks, hidden: false }] : [],
  signedIn: true, availability: { tz: 'Europe/London', grid: defaultGrid() }, contact: 'me_plays', minHours: 6, organizer: false, ...over,
});

const view = (data: LeagueState | null, over: Partial<LeagueView> = {}): LeagueView => ({
  data, loading: false, msg: '', msgTone: 'error', draft: { tz: 'Europe/London', grid: defaultGrid(), contact: 'me_plays' }, dirty: false, busy: false,
  arming: null, gridFocus: null, timeOpen: null, preview: null, now: NOW, tz: 'Europe/London', browserTz: 'Europe/London',
  zones: ['Europe/London', 'America/New_York', 'UTC'], origin: 'https://algomancy.online', stampAt: NOW, stampMsg: '', stampCal: null,
  chips: { champion: ' <span class="badgechip trophy champion">🏆 Champion</span>', finalist: ' <span class="badgechip trophy finalist">🥈 Finalist</span>' },
  section: 'season', chrome: CHROME,
  ...over,
});

export default {
  title: 'Pages/League',
  render: (args: { view: LeagueView }) => leagueHtml(args.view),
  args: { view: view(state(season())) },
};

export const Running = { name: 'Running week (entered)' };
export const SuggestATime = { name: 'Suggest a time, open', args: { view: view(state(season()), { timeOpen: 'm1' }) } };
export const TimeCode = {
  name: 'Time code: a message with a time, the calendar open',
  args: { view: view(state(season()), { section: 'stamp', stampAt: NOW + 26 * 3_600_000, stampCal: new Date(NOW).toISOString().slice(0, 7),
    stampMsg: `Up for our week 2 game at <t:${Math.floor((NOW + 26 * 3_600_000) / 1000)}:f>? I am free until <t:${Math.floor((NOW + 30 * 3_600_000) / 1000)}:t>.` }) },
};
export const SignUpWeek = {
  args: { view: view(state(season({ phase: 0, label: 'Sign-up week', standings: [], me: { ...season().me!, entered: false, joinProblem: null } }))) },
};
export const SignedOut = { args: { view: view(state(season(), { signedIn: false, availability: null })) } };
export const Organizer = { args: { view: view(state(season(), { organizer: true })) } };
export const NoSeason = { name: 'Empty: no season', args: { view: view(state(null)) } };
export const Loading = { args: { view: view(null, { loading: true }) } };
export const Failed = { name: 'Error', args: { view: view(null, { msg: 'could not reach the server' }) } };
export const Saved = { name: 'A button\'s result', args: { view: view(state(season()), { msgTone: 'ok', msg: 'Saved.' }) } };
export const Finished = {
  args: { view: view(state(season({ phase: 5, label: 'Finished', champion: P('me', 'Me'),
    matches: [...season().matches, { id: 'fin', week: 4, final: true, a: P('me', 'Me'), b: P('p1', 'Ann'), result: { outcome: 'a', how: 'game', at: '' }, room: null }] }))) },
};

const pad = (html: string): string => `<div style="max-width:1100px">${html}</div>`;
export const HomeBanner = { name: 'Home banner, unfolded', render: () => pad(leagueBannerHtml({ st: state(season()), open: true, howOpen: null, tz: 'Europe/London' })) };
export const HomeBannerFolded = { name: 'Home banner, folded', render: () => pad(leagueBannerHtml({ st: state(season()), open: false, howOpen: null, tz: 'Europe/London' })) };
export const HomeBannerSignUp = {
  name: 'Home banner, sign-ups open',
  render: () => pad(leagueBannerHtml({ st: state(season({ phase: 0, label: 'Sign-up week', me: { ...season().me!, entered: false } })), open: true, howOpen: null, tz: 'Europe/London' })),
};
export const HeaderButton = {
  render: () => `${leagueNavHtml({ season: season({ phase: 0, me: { ...season().me!, entered: false } }), organizer: false })} ${leagueNavHtml({ season: season(), organizer: false })}`,
};

// ── the new home (docs/24): the League card's body and the Join sheet's rows ──
const card = (html: string): string => `<div style="max-width:320px;padding:12px;border:1px dashed var(--color-border)">${html}</div>`;
export const HomeGlance = { name: 'Home card glance, entered', render: () => card(leagueGlanceHtml(leagueGlanceView(state(season()), 'Europe/London'))) };
export const HomeGlanceSignUp = {
  name: 'Home card glance, sign-ups open',
  render: () => card(leagueGlanceHtml(leagueGlanceView(state(season({ phase: 0, label: 'Sign-up week', me: { ...season().me!, entered: false } })), 'Europe/London'))),
};
export const HomeGlanceNone = { name: 'Home card glance, no season (draws nothing)', render: () => card(leagueGlanceHtml(leagueGlanceView(state(null), 'Europe/London'))) };
export const JoinRows = {
  name: 'Join sheet: league matches to play',
  render: () => card(leagueJoinRowsHtml(leagueJoinView(state(season(), { others: [season({ id: '2026-10', name: 'October League', phase: 4, label: 'The final' })] }), 'Europe/London'))),
};
