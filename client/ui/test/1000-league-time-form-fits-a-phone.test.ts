/* 1000 — THE LEAGUE'S "SUGGEST A TIME" FORM FITS A PHONE
 * (design-system round, 2026-11-03, stream ds-w3b).
 *
 * The open form sat in the third column of the week's matches table. On a
 * 390px phone the name and Play columns kept their width, and the form's date
 * box (~190px, it cannot wrap) pushed the table, and the page, ~90px past the
 * right edge: "Europe/London time [Suggest]" was cut off. ui-shots never said
 * so (its overflow walk measured a zoomed-out innerWidth; test 999). On a
 * phone, while the form is open, that week's rows stack instead: who and Play
 * on a line, the time cell (with the form) under them at the row's full width.
 *
 * §1 the markup the rule keys on: the form is inside the LAST cell of its row,
 *    in a table.lgmatches
 * §2 the rule: phone-only (inside a max-width media query), and it stacks the
 *    table that holds the form and gives that last cell the whole row
 *
 * The picture is the ui-shots state league__suggest-time__phone (and its
 * overflow entry: horizontal false, nothing past the edge).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultGrid, leagueHtml, type LeagueView, type SeasonView } from '../pages/league.ts';
import { readStyles } from './read-styles.ts';

const NOW = Date.UTC(2026, 10, 10, 12);
const WEEK = 7 * 864e5;
const T0 = Date.UTC(2026, 10, 1, 7);
const P = (id: string, name: string, contact?: string) => ({ id, name, ...(contact ? { contact } : {}) });
const SEASON: SeasonView = {
  id: '2026-11', name: 'November', format: 'constructed', phase: 2, label: 'Week 2 of 3', weeks: 3, perWeek: 3, lateUntil: 2,
  signupOpens: new Date(T0 - WEEK).toISOString(), start: new Date(T0).toISOString(),
  phases: [0, 1, 2, 3, 4, 5].map(k => ({ phase: k, label: k ? `Week ${k} of 3` : 'Sign-up week', at: new Date(T0 + (k - 1) * WEEK).toISOString() })),
  auto: true, hold: false, hidden: false,
  entrants: [{ ...P('me', 'Me'), joinedPhase: 0, withdrawn: false, skips: [] }, { ...P('cy', 'Cy'), joinedPhase: 0, withdrawn: false, skips: [] }],
  standings: [], matches: [], champion: null,
  me: { entered: true, withdrawn: false, skips: [], joinProblem: null, contact: 'me', suggestions: [], week0Cap: 3,
    matches: [
      { id: 'm1', week: 2, final: false, opponent: P('cy', 'Cy', 'cy_d'), windows: [{ start: NOW + 3_600_000, hours: 2 }],
        result: null, won: null, playable: true, time: null },
      { id: 'm2', week: 2, final: false, opponent: P('bo', 'Bo'), windows: [], result: null, won: null, playable: true, time: null },
    ] },
  repairProblem: null, formatProblem: null, log: [], outbox: [],
};
const view = (timeOpen: string | null): LeagueView => ({
  data: { season: SEASON, seasons: [{ id: SEASON.id, name: SEASON.name, phase: 2, weeks: 3, hidden: false }], signedIn: true,
    availability: { tz: 'UTC', grid: defaultGrid() }, contact: 'me', minHours: 6, organizer: false },
  loading: false, msg: '', draft: { tz: 'UTC', grid: defaultGrid(), contact: 'me' }, dirty: false, busy: false,
  arming: null, gridFocus: null, timeOpen, preview: null, now: NOW, tz: 'UTC', browserTz: 'UTC', zones: ['UTC'],
  origin: 'https://example.test', stampAt: NOW, chips: { champion: '', finalist: '' },
});

test('1000 §1 the open form sits in the last cell of its row, in a table.lgmatches', () => {
  const html = leagueHtml(view('m1'));
  const tables = [...html.matchAll(/<table class="ui-table lgmatches">([\s\S]*?)<\/table>/g)].map(m => m[1]!);
  assert.ok(tables.length >= 1, 'positive control: the matches table is drawn');
  const holder = tables.find(t => t.includes('class="lgtimeform"'));
  assert.ok(holder, 'the form is inside a table.lgmatches');
  const row = /<tr>((?:(?!<\/tr>)[\s\S])*?class="lgtimeform"[\s\S]*?)<\/tr>/.exec(holder)?.[1] ?? '';
  const cells = row.split(/<td\b/).slice(1);
  assert.equal(cells.length, 3, 'who · Play · the time');
  assert.match(cells[2]!, /class="lgtimeform"/, 'the form is in the last cell — the one the phone rule gives the whole row');
  assert.doesNotMatch(leagueHtml(view(null)), /lgtimeform/, 'closed, no form (and the rule matches nothing)');
});

test('1000 §2 on a phone, the table holding the open form stacks its rows', () => {
  const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');
  // every rule that names the open form's table, with the at-rule around it
  const rules: { at: string; sel: string; body: string }[] = [];
  for (const m of css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
    for (const r of m[2]!.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (r[1]!.includes('.lgmatches:has(.lgtimeform)')) rules.push({ at: m[1]!, sel: r[1]!.trim(), body: r[2]! });
    }
  }
  const outside = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '');
  assert.doesNotMatch(outside, /\.lgmatches:has\(\.lgtimeform\)/, 'phone only: a desktop or tablet row is a table row as before');
  const body = (sel: string): string => rules.find(r => r.sel.split(',').map(s => s.trim()).includes(sel))?.body ?? '';
  assert.ok(rules.length && rules.every(r => Number(r.at) <= 760), `inside the phone query: ${JSON.stringify(rules.map(r => r.at))}`);
  assert.match(body('.lgmatches:has(.lgtimeform)'), /display:\s*block/, 'the table stops being a table');
  assert.match(body('.lgmatches:has(.lgtimeform) > tbody'), /display:\s*block/);
  assert.match(body('.lgmatches:has(.lgtimeform) tr'), /display:\s*flex;[^}]*flex-wrap:\s*wrap/, 'a row wraps');
  assert.match(body('.lgmatches:has(.lgtimeform) td:last-child'), /flex:\s*1 0 100%/, 'and the time cell takes the whole next line');
  assert.match(body('.lgmatches:has(.lgtimeform) td'), /width:\s*auto/, 'the name cell\'s width: 1% does not squeeze it to nothing');
});
