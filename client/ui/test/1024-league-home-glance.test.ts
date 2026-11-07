/* 1024 — THE LEAGUE ON THE NEW HOME: THE CARD'S GLANCE AND THE JOIN SHEET'S
 * ROWS (docs/24, 2026-11-03).
 *
 * pages/league.ts leagueGlanceView/Html draws the League card's body from
 * the same answer the banner used: the season's name, its format and phase,
 * where the viewer stands, and the next date. The whole card is the home's
 * `nav-league` button, so the glance has NO buttons. leagueJoinView /
 * leagueJoinRowsHtml lists the matches you can press Play on now, with the
 * banner's own `lg-play` buttons. No DOM here.
 *
 * §1 the glance: entered, sign-ups open, closed, before sign-ups, champion; no season → ''
 * §2 the glance has no buttons, and the season's name is escaped
 * §3 the join rows: playable and unplayed only, from this season and the others still running
 * §4 the rows' Play buttons carry the season and the match; text escaped; none → ''
 * §5 (2026-11-07) the track of the season's steps, the player count, the leaders once a week is played, your next match
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  leagueGlanceHtml, leagueGlanceView, leagueJoinRowsHtml, leagueJoinView,
  type LeagueState, type MyMatch, type SeasonView,
} from '../pages/league.ts';

const W = 7 * 864e5;
const T0 = Date.UTC(2026, 10, 1, 7);
const P = (id: string, name: string) => ({ id, name });
const TZ = 'UTC';

const match = (id: string, over: Partial<MyMatch> = {}): MyMatch => ({
  id, week: 2, final: false, opponent: P('p1', 'Ann'), windows: [], result: null, won: null, playable: true, time: null, ...over,
});
function season(over: Partial<SeasonView> = {}, me: SeasonView['me'] | 'none' = 'none'): SeasonView {
  return {
    id: '2026-11', name: 'November League', format: 'competitive', phase: 2, label: 'Week 2 of 3', weeks: 3, perWeek: 3, lateUntil: 2,
    signupOpens: new Date(T0 - W).toISOString(), start: new Date(T0).toISOString(),
    phases: [0, 1, 2, 3, 4, 5].map(k => ({ phase: k, label: k ? `Week ${k} of 3` : 'Sign-up week', at: new Date(T0 + (k - 1) * W).toISOString() })),
    auto: true, hold: false, hidden: false, entrants: [], standings: [], matches: [], champion: null,
    me: me === 'none' ? null : me,
    ...over,
  };
}
const ME = (matches: MyMatch[]): NonNullable<SeasonView['me']> =>
  ({ entered: true, withdrawn: false, skips: [], joinProblem: null, contact: null, suggestions: [], week0Cap: 3, matches });
const state = (s: SeasonView | null, others: SeasonView[] = []): LeagueState =>
  ({ season: s, others, seasons: [], signedIn: true, availability: null, contact: null, minHours: 6, organizer: false });

test('1024 §1 the glance says where the season and the viewer stand', () => {
  const inSeason = leagueGlanceView(state(season({}, ME([]))), TZ)!;
  assert.deepEqual({ name: inSeason.name, phase: inSeason.phase, status: inSeason.status },
    { name: 'November League', phase: 'Competitive · Week 2 of 3', status: 'in' });
  assert.match(inSeason.next, /^Week 3 starts /);
  const html = leagueGlanceHtml(inSeason);
  assert.match(html, /^<div class="lgglance">/);
  assert.match(html, /<span class="lgglstate in">✓ you're in<\/span>/);
  assert.match(html, /<div class="lgglphase">Competitive · Week 2 of 3<\/div>/);

  assert.equal(leagueGlanceView(state(season({ phase: 0, label: 'Sign-up week', format: 'constructed' })), TZ)!.status, 'open');
  assert.match(leagueGlanceHtml(leagueGlanceView(state(season({ phase: 0, format: 'constructed' })), TZ)), /lgglstate open">Sign-ups open</);
  assert.equal(leagueGlanceView(state(season({ format: 'draft' })), TZ)!.phase, 'Draft · Week 2 of 3');
  assert.equal(leagueGlanceView(state(season({ phase: 3 })), TZ)!.status, 'closed', 'running, past late entry, not in');
  const before = leagueGlanceView(state(season({ phase: -1 })), TZ)!;
  assert.equal(before.status, '', 'before sign-ups: the next date says when they open');
  assert.match(before.next, /^Sign-ups open /);
  assert.doesNotMatch(leagueGlanceHtml(before), /lgglstate/);
  const done = leagueGlanceView(state(season({ phase: 5, champion: P('c', 'Cy') })), TZ)!;
  assert.deepEqual([done.status, done.next], ['', 'Champion: Cy']);
  assert.equal(leagueGlanceView(null, TZ), null);
  assert.equal(leagueGlanceView(state(null), TZ), null);
  assert.equal(leagueGlanceHtml(null), '', 'no season: the card says so itself');
});

test('1024 §2 no buttons in the glance; the name is escaped', () => {
  const html = leagueGlanceHtml(leagueGlanceView(state(season({ name: 'Nov <b>League</b>' }, ME([match('m1')]))), TZ));
  assert.doesNotMatch(html, /<button|data-btn=/, 'the whole card is the button');
  assert.match(html, /Nov &lt;b&gt;League&lt;\/b&gt;/);
});

test('1024 §3 the matches to play now, from every running season', () => {
  const cur = season({}, ME([
    match('m1'),
    match('m2', { opponent: P('p2', 'Bo'), playable: false }),
    match('m3', { result: { outcome: 'a', how: 'game', at: '' }, won: true }),
    match('m4', { opponent: P('p3', 'Cy'), time: { at: Date.UTC(2026, 10, 12, 18), mine: true, agreed: true } }),
  ]));
  const old = season({ id: '2026-10', name: 'October League', phase: 4 }, ME([match('f1', { final: true, opponent: P('p4', 'Dee') })]));
  const rows = leagueJoinView(state(cur, [old]), TZ);
  assert.deepEqual(rows.map(r => `${r.season}/${r.match}/${r.opponent}`), ['2026-11/m1/Ann', '2026-11/m4/Cy', '2026-10/f1/Dee']);
  assert.equal(rows[0]!.when, '', 'no agreed time');
  assert.ok(/Nov/.test(rows[1]!.when) && /12/.test(rows[1]!.when), 'the agreed time, in the viewer\'s zone');
  assert.deepEqual(leagueJoinView(state(season()), TZ), [], 'not entered: none');
  assert.deepEqual(leagueJoinView(null, TZ), []);
});

test('1024 §4 each row has the banner\'s Play button; escaped; none → nothing', () => {
  const html = leagueJoinRowsHtml([
    { season: '2026-11', seasonName: 'November', match: 'm1', opponent: 'Ann <x>', when: '' },
    { season: '2026-10', seasonName: 'Oct "final"', match: 'f1', opponent: 'Dee', when: 'Thu 12 Nov, 18:00' },
  ]);
  assert.match(html, /^<div class="lgjoinrows">/);
  assert.deepEqual([...html.matchAll(/data-btn="lg-play" data-season="([^"]*)" data-match="([^"]*)"/g)].map(m => `${m[1]}/${m[2]}`),
    ['2026-11/m1', '2026-10/f1']);
  assert.match(html, /vs <b>Ann &lt;x&gt;<\/b>/);
  assert.match(html, /Oct &quot;final&quot; · Thu 12 Nov, 18:00 ✓/);
  assert.equal(leagueJoinRowsHtml([]), '');
});

test('1024 §5 the track, the players, the leaders, your next match', () => {
  const E = (id: string, name: string, withdrawn = false) => ({ ...P(id, name), joinedPhase: 0, withdrawn, skips: [] });
  const R = (id: string, name: string, w: number, l: number, points: number, rank: number) =>
    ({ id, name, w, l, unplayed: 0, points, omw: 0, rank });
  const s = season({
    entrants: [E('a', 'Ann'), E('b', 'Bo'), E('c', 'Cy'), E('d', 'Di', true)],
    standings: [R('c', 'Cy', 3, 0, 9, 1), R('a', 'Ann', 2, 1, 6, 2), R('b', 'Bo', 1, 2, 3, 3), R('z', 'Zed', 0, 0, 0, 4)],
  }, ME([match('m1', { opponent: P('c', 'Cy'), time: { at: T0 + 9 * 864e5, mine: false, agreed: true } })]));
  const v = leagueGlanceView(state(s), TZ)!;
  assert.deepEqual(v.track.map(t => `${t.label}:${t.state}`), ['Sign-ups:past', 'W1:past', 'W2:now', 'W3:next', 'Final:next'],
    'phase 5 (after the final) is not a step');
  assert.equal(v.players, 3, 'a withdrawn player is not counted');
  assert.deepEqual(v.leaders, [{ name: 'Cy', points: 9 }, { name: 'Ann', points: 6 }, { name: 'Bo', points: 3 }]);
  assert.equal(v.match?.opponent, 'Cy');
  assert.notEqual(v.match?.when, '', 'an agreed time is shown');
  const html = leagueGlanceHtml(v);
  assert.match(html, /<ol class="lggltrack"><li class="past">Sign-ups<\/li><li class="past">W1<\/li><li class="now">W2<\/li>/);
  assert.match(html, /<span class="lgglstate in">✓ you're in<\/span><span class="lgglplayers">3 players<\/span>/);
  assert.match(html, /<div class="lgglmatch">Next: vs <b>Cy<\/b> · /);
  assert.match(html, /<ol class="lgglleaders"><li><span>Cy<\/span><b>9<\/b><\/li>/);

  // sign-up week: no leaders yet, even with rows; a champion makes every step past
  const signup = leagueGlanceView(state(season({ phase: 0, standings: [R('a', 'Ann', 1, 0, 3, 1)] })), TZ)!;
  assert.deepEqual(signup.leaders, []);
  assert.equal(signup.match, null);
  assert.doesNotMatch(leagueGlanceHtml(signup), /lgglleaders|lgglmatch|lgglplayers/);
  const done = leagueGlanceView(state(season({ phase: 5, champion: P('c', 'Cy') })), TZ)!;
  assert.ok(done.track.every(t => t.state === 'past'));
});
