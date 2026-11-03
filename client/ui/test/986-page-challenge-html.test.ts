/* 986 — THE WEEKLY CHALLENGE PAGE, ITS HOME CARD AND ITS HEADER BUTTON, DRAWN
 * WITHOUT A PAGE (design-system round, 2026-11-03).
 *
 * The challenge's markup left ui/challenge.ts for pages/challenge.ts. This
 * file drives challengePageHtml, challengeHomeCardHtml and challengeNavHtml
 * with made-up views and no DOM.
 *
 * §1 loading, no week, a week with a board: the states render, and every
 *    data-btn the click handler routes is drawn
 * §2 a board that is loading, failed, empty; a closed week's winners, Try
 *    and Watch; the tabs are the ui-tabs component, the current one on
 * §3 kept runs: signed out, sending, refused, the armed ✕
 * §4 player text is escaped
 * §5 the home card and the header button
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/src/cards/registry.ts';
import type { RunScore } from '../../engine/src/challenge.ts';
import {
  challengeHomeCardHtml, challengeHomeView, challengeNavHtml, challengePageHtml,
  type BoardReply, type ChallengePageView, type ChallengeReply, type ChallengeView,
} from '../pages/challenge.ts';

const NOW = Date.UTC(2026, 10, 10, 12);
const DAY = 86_400_000;
const sc = (turns: number, debtTurns = 0): RunScore => ({ unique: 2, extra: 1, cards: 3, elements: 2, turns, raw: 9, skill: 9, ...(debtTurns ? { debtTurns, debt: 5 } : {}) });
const week = (id: string, over: Partial<ChallengeView> = {}): ChallengeView => ({
  id, week: '2026-11-08', title: `Week ${id}`, blurb: 'A short puzzle.', goal: { kind: 'unitsInPlay', n: 4 }, seed: 1, par: 24,
  opens: NOW - 2 * DAY, closes: NOW + 3 * DAY + 2 * 3_600_000, closed: false, entrants: 2, ...over,
});
const CUR = week('cur');
const OLD = week('old', { title: 'Week <old>', week: '2026-11-01', closes: NOW - DAY, closed: true });
const rows = (closed: boolean) => [
  { rank: 1, name: 'Ann <a>', score: sc(4, 2), at: 1, older: true, ...(closed ? { runId: 'r1', deck: ['X'] } : {}) },
  { rank: 2, name: 'Bo', score: sc(5), at: 1, ...(closed ? { runId: 'r2' } : {}) },
];
const board = (closed: boolean, empty = false): BoardReply => {
  const r = empty ? [] : rows(closed);
  return { id: closed ? 'old' : 'cur', closed, boards: { fastest: r, leanest: r, purest: r, overall: r },
    ...(closed && !empty ? { winners: { fastest: r[0], purest: r[1] } } : {}) };
};
const DATA: ChallengeReply = { now: NOW, current: CUR, past: [OLD],
  mine: { cur: { fastest: { score: sc(3), rank: 2 }, leanest: { score: sc(3), rank: 1 }, purest: { score: sc(3), rank: 3 }, overall: { score: sc(3), rank: 2 } } } };

function view(over: Partial<ChallengePageView> = {}): ChallengePageView {
  return { data: DATA, loading: false, msg: '', now: NOW, tab: 'fastest', pastOpen: null, arming: null,
    boards: { cur: board(false) }, building: null, builder: null, kept: [], canSubmit: true, ...over };
}
const btns = (html: string): Set<string> => new Set([...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!));

test('986 §0 positive control: there is no DOM here', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
  assert.match(challengePageHtml(view()), /^<div class="metapage chpage">/);
});

test('986 §1 loading, no week, a week with its board', () => {
  assert.match(challengePageHtml(view({ data: null, loading: true })), /<p class="dim">Loading…<\/p>/);
  const none = challengePageHtml(view({ data: { ...DATA, current: null } }));
  assert.match(none, /No challenge this week/);
  const html = challengePageHtml(view());
  assert.match(html, /class="ui-page-header"/, 'the header is the page-header component');
  assert.match(html, /3d 2h left · 2 entrants/, 'time left on the server clock the view carries');
  assert.match(html, /<h4>Your best<\/h4>/);
  for (const b of ['ch-close', 'ch-build', 'ch-tab', 'ch-past']) assert.ok(btns(html).has(b), b);
  const built = challengePageHtml(view({ building: CUR, builder: { def: CUR, list: [], decks: [], importing: true, undo: 'Cleared.' } }));
  for (const b of ['ch-tabletop', 'ch-import', 'ch-undo', 'ch-play']) assert.ok(btns(built).has(b), b);
  assert.doesNotMatch(built, /data-btn="ch-build" data-id="cur"/, 'no Build a deck while it is being built');
});

test('986 §2 a board loading, failed, empty; a closed week; the tabs', () => {
  assert.match(challengePageHtml(view({ boards: {} })), /Leaderboard<\/h3><p class="dim">Loading…/);
  assert.match(challengePageHtml(view({ boards: { cur: 'error' } })), /Could not load the leaderboard\./);
  assert.match(challengePageHtml(view({ boards: { cur: board(false, true) } })), /No runs yet\./);
  const html = challengePageHtml(view({ tab: 'leanest' }));
  assert.match(html, /<div class="ui-tabs ui-tabs--plain chtabs" role="tablist">/);
  assert.match(html, /class="[^"]*ui-tabs__tab on" data-btn="ch-tab" data-tab="leanest"[^>]*aria-selected="true"/);
  assert.match(html, /<th class="chsorted"[^>]*>Cards<\/th>/, 'the leanest board sorts by cards');
  const past = challengePageHtml(view({ pastOpen: 'old', boards: { cur: board(false), old: board(true) } }));
  assert.match(past, /Winners · Fastest: <b>Ann &lt;a&gt;<\/b>/);
  for (const b of ['ch-try', 'ch-watch']) assert.ok(btns(past).has(b), b);
  assert.match(past, /played on older rules/);
});

test('986 §3 kept runs: signed out, sending, refused, armed', () => {
  const run = { at: 11, challengeId: 'cur', title: 'Week cur', score: sc(4), deck: [], actions: [] };
  const out = challengePageHtml(view({ kept: [{ run, st: undefined }], canSubmit: false }));
  assert.ok(btns(out).has('ch-signin'));
  assert.match(challengePageHtml(view({ kept: [{ run, st: 'sending' }] })), /Submitting…/);
  const refused = challengePageHtml(view({ kept: [{ run, st: { ok: false, error: 'no <x>' } }] }));
  assert.match(refused, /<span class="chproblem">no &lt;x&gt;<\/span>/);
  assert.ok(btns(refused).has('ch-send'));
  assert.match(challengePageHtml(view({ kept: [{ run, st: undefined }], arming: 'forget:11' })),
    /<button class="danger" data-btn="ch-forget" data-at="11">Press again to drop this run<\/button>/);
});

test('986 §4 player text is escaped', () => {
  const html = challengePageHtml(view({ pastOpen: 'old', boards: { cur: board(false), old: board(true) } }));
  assert.match(html, /Week &lt;old&gt;/);
  assert.doesNotMatch(html, /<old>|<a>/);
});

test('986 §5 the home card and the header button', () => {
  const home = challengeHomeView(DATA, NOW);
  const card = challengeHomeCardHtml(home);
  assert.match(card, /This week's challenge/);
  assert.match(card, /your best: 3 turns \(#2 fastest\)/);
  assert.ok(btns(card).has('ch-home-play'));
  assert.match(challengeNavHtml(home), /data-btn="nav-challenge">🧩 Challenge</);
  const pastOnly = challengeHomeView({ ...DATA, current: null }, NOW);
  assert.equal(challengeHomeCardHtml(pastOnly), '', 'no card without a week on');
  assert.match(challengeNavHtml(pastOnly), /nav-challenge/, 'but the button, while a past week can be looked at');
  assert.equal(challengeNavHtml(challengeHomeView(null, NOW)), '', 'no server, nothing');
});
