/* The weekly challenge page, its home card and its header button
 * (ui/pages/challenge.ts), and a run's meter and end panels
 * (ui/pages/challengerun.ts), drawn from made-up views. The buttons do nothing
 * here — their handler is ui/challenge.ts, which a story does not load. */
import type { RunScore } from '../../../engine/src/challenge.ts';
import {
  challengeHomeCardHtml, challengeHomeView, challengeNavHtml, challengePageHtml,
  type BoardReply, type ChallengePageView, type ChallengeReply, type ChallengeView,
} from '../../../ui/pages/challenge.ts';
import { runEndHtml, runMeterHtml } from '../../../ui/pages/challengerun.ts';
import { frame } from '../_helpers.ts';

const NOW = Date.UTC(2026, 10, 10, 18);
const DAY = 86_400_000;
const sc = (turns: number, cards: number, elements: number, debtTurns = 0): RunScore =>
  ({ unique: cards, extra: 0, cards, elements, turns, raw: 0, skill: 0, ...(debtTurns ? { debtTurns, debt: 9 } : {}) });
const week = (id: string, over: Partial<ChallengeView> = {}): ChallengeView => ({
  id, week: '2026-11-08', title: 'Full House', blurb: 'Fill your side of the board, fast.', goal: { kind: 'unitsInPlay', n: 5 },
  seed: 1, par: 24, opens: NOW - 2 * DAY, closes: NOW + 3 * DAY + 5 * 3_600_000, closed: false, entrants: 7, ...over,
});
const CUR = week('cur');
const OLD = week('old', { title: 'Spell Slinger', week: '2026-11-01', closes: NOW - DAY, closed: true, entrants: 4 });
const ROWS = [
  { rank: 1, name: 'Tomzy', score: sc(4, 9, 2, 1), at: 0, runId: 'r1', deck: ['X'] },
  { rank: 2, name: 'Nyar', score: sc(5, 7, 1), at: 0, runId: 'r2', older: true },
  { rank: 3, name: 'Karanda', score: sc(6, 8, 2), at: 0, runId: 'r3' },
];
const board = (closed: boolean): BoardReply => ({ id: closed ? 'old' : 'cur', closed, boards: { fastest: ROWS, leanest: ROWS, purest: ROWS, overall: ROWS },
  ...(closed ? { winners: { fastest: ROWS[0], leanest: ROWS[1], purest: ROWS[1] } } : {}) });
const DATA: ChallengeReply = { now: NOW, current: CUR, past: [OLD],
  mine: { cur: { fastest: { score: sc(5, 8, 2), rank: 2 }, leanest: { score: sc(5, 8, 2), rank: 3 }, purest: { score: sc(5, 8, 2), rank: 2 }, overall: { score: sc(5, 8, 2), rank: 2 } } } };

const view = (over: Partial<ChallengePageView> = {}): ChallengePageView => ({
  data: DATA, loading: false, msg: '', now: NOW, tab: 'fastest', pastOpen: null, arming: null,
  boards: { cur: board(false) }, building: null, builder: null, kept: [], canSubmit: true, ...over,
});

export default {
  title: 'Pages/Weekly challenge',
  render: (args: { view: ChallengePageView }) => challengePageHtml(args.view),
  args: { view: view() },
};

export const ThisWeek = { name: 'This week, with its board' };
export const LeanestTab = { args: { view: view({ tab: 'leanest' }) } };
export const PastWeekOpen = { args: { view: view({ pastOpen: 'old', boards: { cur: board(false), old: board(true) } }) } };
export const Builder = {
  name: 'Building a deck (empty)',
  args: { view: view({ building: CUR, builder: { def: CUR, list: [], decks: [{ id: 'd1', name: 'Ember Rush', cards: [] }], importing: true, undo: null } }) },
};
export const KeptRuns = {
  name: 'Finished runs, signed out',
  args: { view: view({ canSubmit: false, kept: [{ run: { at: 1, challengeId: 'cur', title: 'Full House', score: sc(5, 8, 2), deck: [], actions: [] }, st: undefined }] }) },
};
export const NoWeek = { name: 'Empty: no challenge this week', args: { view: view({ data: { ...DATA, current: null }, boards: {} }) } };
export const Loading = { args: { view: view({ data: null, loading: true }) } };
export const Failed = { name: 'Error', args: { view: view({ data: null, msg: 'could not reach the server' }) } };
export const BoardFailed = { args: { view: view({ boards: { cur: 'error' } }) } };

export const HomeCard = {
  render: () => `<div style="max-width:320px">${challengeHomeCardHtml(challengeHomeView(DATA, NOW))}</div>`,
};
export const HeaderButton = { render: () => challengeNavHtml(challengeHomeView(DATA, NOW)) };

// ── a run, on the board (ui/pages/challengerun.ts): the meter and the end panels ──
export const RunMeter = { name: 'Run: the meter', render: () => runMeterHtml({ text: 'Turn 3 · 5 of 5 units · 7 cards · 2 elements', armed: false }) };
export const RunMeterArmed = { name: 'Run: the meter, Give up armed', render: () => runMeterHtml({ text: 'Turn 3 · 5 of 5 units', armed: true }) };
export const RunGoalMet = {
  name: 'Run: goal met, placed',
  render: () => frame(runEndHtml({ kind: 'done', score: sc(4, 9, 2, 1),
    submit: { s: 'done', reply: { ok: true, newBest: ['fastest'], ranks: { fastest: 1, leanest: 4, purest: 2, overall: 1 } } } }), 420),
};
export const RunGoalMetSignedOut = { name: 'Run: goal met, signed out', render: () => frame(runEndHtml({ kind: 'done', score: sc(5, 8, 2), submit: { s: 'guest' } }), 420) };
export const RunFailed = { name: 'Run: failed', render: () => frame(runEndHtml({ kind: 'failed', why: 'The dummy reached 0 cards in its deck before your goal was met.' }), 320) };
