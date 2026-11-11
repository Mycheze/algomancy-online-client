/* 1226 · A STATE IS TOLD BY MORE THAN ITS COLOUR (BL-10, 2026-11-11)
 *
 * The inventory listed it (docs/23-ui-inventory/01 §4 S15): "Colour is the
 * only state cue for `.qstripcount.live`, `.crknob.changed`, `.lgbdates
 * .now/.past` and `.lgbrows li.mine`." A player who cannot tell the gold from
 * the grey (or who is listening, not looking) could not see
 *   - which of the Game values sheet's numbers they had moved off the standard
 *     (the label only turned from dim to plain text);
 *   - which of the league banner's dates is this week and which are over (an
 *     accent border; the past ones only faded);
 *   - which of the banner's pairings is their own (only the accent colour);
 *   - and, same shape on the home page's League card, which step of the
 *     season's track is now (an accent bar and text).
 * Each now carries a mark, a weight or a bar besides its colour, and the
 * spoken page says it.
 *
 * Left on purpose: `.qstripcount.live`. Its words already differ ("nobody
 * waiting — be the first" vs "2 waiting · …"), so the glow is a second cue,
 * not the only one.
 *
 *   §1  the Game values sheet marks a changed number, and only a changed one
 *   §2  the league banner: ✓ on what is over, aria-current on now, "Your match" on yours
 *   §3  the home League card's track names the current step
 *   §4  the stylesheet gives each state a cue that is not a colour
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { customRulesView, gameValuesHtml } from '../pages/customrules.ts';
import { leagueBannerHtml, leagueGlanceHtml, defaultGrid, type LeagueState, type SeasonView } from '../pages/league.ts';
import { readStyles } from './read-styles.ts';

const W = 7 * 864e5;
const T0 = Date.UTC(2026, 10, 1, 7);
const P = (id: string, name: string) => ({ id, name });

function season(): SeasonView {
  return {
    id: '2026-11', name: 'November', format: 'constructed', phase: 2, label: 'Week 2 of 3', weeks: 3, perWeek: 3, lateUntil: 2,
    signupOpens: new Date(T0 - W).toISOString(), start: new Date(T0).toISOString(),
    phases: [0, 1, 2, 3, 4, 5].map(k => ({ phase: k, label: k ? `Week ${k} of 3` : 'Sign-up week', at: new Date(T0 + (k - 1) * W).toISOString() })),
    auto: true, hold: false, hidden: false,
    entrants: [{ ...P('me', 'Me'), joinedPhase: 0, withdrawn: false, skips: [] }, { ...P('cy', 'Cy'), joinedPhase: 0, withdrawn: false, skips: [] },
      { ...P('an', 'Ann'), joinedPhase: 0, withdrawn: false, skips: [] }, { ...P('bo', 'Bo'), joinedPhase: 0, withdrawn: false, skips: [] }],
    standings: [{ id: 'me', name: 'Me', w: 2, l: 1, unplayed: 0, points: 6, omw: 0.5, rank: 1 }],
    matches: [
      { id: 'm2', week: 2, final: false, a: P('an', 'Ann'), b: P('bo', 'Bo'), result: null, room: null, disputes: [] },
      { id: 'm1', week: 2, final: false, a: P('me', 'Me'), b: P('cy', 'Cy'), result: null, room: null, disputes: [] },
    ],
    champion: null,
    me: { entered: true, withdrawn: false, skips: [], joinProblem: null, contact: 'me', suggestions: [], week0Cap: 3,
      matches: [{ id: 'm1', week: 2, final: false, opponent: P('cy', 'Cy'), windows: [],
        result: null, won: null, playable: true, time: null }] },
    repairProblem: null, formatProblem: null, log: [], outbox: [],
  } as SeasonView;
}

const state = (s: SeasonView): LeagueState => ({ season: s, seasons: [{ id: s.id, name: s.name, phase: s.phase, weeks: s.weeks, hidden: false }],
  signedIn: true, availability: { tz: 'UTC', grid: defaultGrid() }, contact: 'me', minHours: 6, organizer: false });

test('§1 the Game values sheet marks a changed number with a ● and says so, and leaves the standard ones bare', () => {
  const base = customRulesView(null);
  assert.doesNotMatch(gameValuesHtml(base), /crchanged|changed from the standard/, 'every number at its standard: no mark');
  const sheet = gameValuesHtml({ ...base, rules: { ...base.rules, packSize: 15 } });
  const knobs = sheet.split('<div class="crknob').slice(1);
  const pack = knobs.find(k => k.includes('Pack size'))!;
  assert.match(pack, /^ changed"><span>Pack size <i class="crchanged" aria-hidden="true" title="Changed — the standard is 10">●<\/i><span class="srname">, changed from the standard 10<\/span><\/span>/);
  assert.equal(knobs.filter(k => k.includes('crchanged')).length, 1, 'only the changed number is marked');
});

test('§2 the league banner: ✓ on the weeks that are over, aria-current on this one, "Your match" on yours', () => {
  const html = leagueBannerHtml({ st: state(season()), open: true, howOpen: false, tz: 'UTC' });
  const dates = html.match(/<ol class="lgbdates">([\s\S]*?)<\/ol>/)![1]!.split('<li ').slice(1);
  assert.equal(dates.length, 6);
  for (const d of dates.slice(0, 2)) assert.match(d, /^class="past"><span class="lgbover" aria-hidden="true">✓<\/span><span class="srname">Over: <\/span>/, d);
  assert.match(dates[2]!, /^class="now" aria-current="step"><span>Week 2<\/span>/);
  for (const d of dates.slice(3)) assert.match(d, /^class="">/, 'a week to come has no mark');
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  const rows = html.match(/<ul class="lgbrows">((?:(?!<\/ul>)[\s\S])*Ann(?:(?!<\/ul>)[\s\S])*)<\/ul>/)![1]!.split('<li ').slice(1);
  assert.match(rows[0]!, /^class="mine"><span class="srname">Your match: <\/span><span>Me /, 'yours first, and said');
  assert.match(rows[1]!, /^class=""><span>Ann /, 'the others are not');
});

test('§3 the home League card\'s track names the current step', () => {
  const html = leagueGlanceHtml({ name: 'November', phase: 'Week 2 of 3', status: 'in', next: '', players: 4, leaders: [], matches: [],
    track: [{ label: 'Sign-ups', state: 'past' }, { label: 'W1', state: 'now' }, { label: 'Final', state: 'next' }] });
  assert.match(html, /<li class="past">Sign-ups<\/li><li class="now" aria-current="step">W1<\/li><li class="next">Final<\/li>/);
});

/** every declaration the stylesheet gives exactly `selector`, wherever it is written */
function declarations(css: string, selector: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1]!.split(',').some(s => s.trim() === selector)) continue;
    out.push(...m[2]!.split(';').map(d => d.trim().split(':')[0]!.trim()).filter(Boolean));
  }
  return out;
}

const COLOUR_ONLY = new Set(['color', 'opacity', 'background', 'background-color', 'border-color', 'border-top-color', 'outline-color', 'filter']);

test('§4 the stylesheet gives each of these states a cue that is not a colour', () => {
  const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(declarations(css, '.lgbrows li.mine').includes('color'), 'non-vacuity: the selectors are found');
  for (const sel of ['.lgbdates li.now', '.lgbrows li.mine', '.lggltrack li.now']) {
    const props = declarations(css, sel);
    assert.ok(props.some(p => !COLOUR_ONLY.has(p)),
      `${sel} is drawn by colour alone (${props.join(', ')}): give it a weight, a bar or a mark as well`);
  }
  assert.match(css, /\.crknob \.crchanged \{[^}]*font-style: normal/, 'the ● is upright, not an italic glyph');
});
