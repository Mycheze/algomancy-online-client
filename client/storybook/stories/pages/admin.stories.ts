/* The admin dashboard (ui/pages/admin.ts), drawn from made-up views: no
 * server, no account. `adminHtml` is pure, so every state the page can be in
 * is one object away. */
import { type AdminView, adminHtml } from '../../../ui/pages/admin.ts';

const OVER: NonNullable<AdminView['overview']> = {
  me: 'Warden', admins: 2, accounts: 41, games: 312, rooms: 3,
  reports: { total: 3, unmarked: 1, real: 1, not: 1, live: 1, unfetched: 1 },
};

const base: AdminView = {
  access: true, current: 'reports', isLoading: false, actionMsg: '', faultMsg: '', overview: OVER,
  accountRows: [
    { id: 'a1', username: 'Warden', createdAt: '2026-08-30T10:00:00Z', admin: true, badge: { owner: true, since: '2026-09-01' },
      games: 120, wins: 70, lastPlayed: '2026-11-02T20:00:00Z', friends: 9, decks: 6, discord: 'warden' },
    { id: 'a2', username: 'Nyar', createdAt: '2026-09-05T10:00:00Z', admin: false, badge: { judge: 2, since: '2026-10-01' },
      games: 64, wins: 30, lastPlayed: '2026-11-01T18:00:00Z', friends: 4, decks: 3, discord: null },
    { id: 'a3', username: 'Quillon', createdAt: '2026-10-20T10:00:00Z', admin: false, badge: null,
      games: 0, wins: 0, lastPlayed: null, friends: 0, decks: 0, discord: null },
  ],
  reportRows: [
    { id: 318, ledgerId: 318, ts: '2026-11-01T19:02:00Z', room: 'QXZK', seat: 0, note: 'Mindburn showed the discarded card to the next chooser.',
      actionIndex: 212, kind: 'bug', severity: 'medium', by: { name: 'Nyar', judge: 2 }, status: 'fixed', guards: ['cbb48f1a'],
      ledgerNote: null, mark: 'real', markedBy: 'Warden' },
    { id: 319, ledgerId: null, ts: '2026-11-02T08:15:00Z', room: '', seat: null, page: 'deck', note: 'The deck page jumps when I add a card.',
      actionIndex: null, kind: 'ux', severity: 'minor', by: null, status: null, guards: [], ledgerNote: null, mark: null, markedBy: null },
    { id: 320, ledgerId: 320, ts: '2026-11-02T09:40:00Z', room: 'RRTA', seat: 1, note: 'I want a dark-mode card zoom.',
      actionIndex: 3, kind: 'feature', by: { name: 'Quillon' }, status: 'live', guards: [], ledgerNote: 'parked', mark: 'not', markedBy: 'Warden' },
  ],
  gameRows: [
    { code: 'QXZK', playedAt: '2026-11-01T18:30:00Z', mode: 'constructed', els: [], sides: [['fire', 'earth'], ['water']],
      finished: true, diverged: false, winner: 0, turns: 9, minutes: 31, players: ['Nyar', 'Warden'], known: [true, true],
      rated: true, custom: false, amended: 1 },
    { code: 'OLD1', playedAt: '2026-08-21T12:00:00Z', mode: 'draft', els: ['air', 'wood', 'metal'],
      finished: false, diverged: true, winner: null, turns: 4, minutes: null, players: ['Ann', 'guest'], known: [false, true],
      rated: false, custom: true, disputed: 1 },
  ],
  roomRows: [
    { code: 'RRTA', mode: 'draft', names: ['Quillon', 'Nyar'], connected: [true, false], users: ['a3', null],
      turn: 4, phase: 'main', winner: null, actions: 88, minutes: 12, watchers: 1, rated: true },
  ],
  calendar: {
    now: Date.UTC(2026, 10, 3), runsOutAt: Date.UTC(2026, 10, 15, 7), weeksLeft: 2, upcoming: 1,
    rows: [
      { id: 'wk-open', week: '2026-11-01', title: 'Full House', blurb: 'Fill the board.', goal: { kind: 'unitsPlayed', n: 6 },
        seed: 606, par: 140, opens: Date.UTC(2026, 10, 1, 7), closes: Date.UTC(2026, 10, 8, 7), status: 'open',
        ref: { state: 'ok', score: { unique: 9, extra: 1, cards: 10, elements: 2, turns: 7, raw: 140, skill: 100 }, actions: 321 },
        runs: 7, players: 3 },
      { id: 'wk-soon', week: '2026-11-08', title: 'Quiet Week', blurb: 'Win without attacking.', goal: { kind: 'unitsPlayed', n: 4 },
        seed: 607, par: 90, opens: Date.UTC(2026, 10, 8, 7), closes: Date.UTC(2026, 10, 15, 7), status: 'upcoming', opensInDays: 5,
        ref: { state: 'failed', error: 'the goal was not met', at: 140 } },
    ],
  },
  onlyUnmarked: false,
};

export default {
  title: 'Pages/Admin',
  render: (args: AdminView) => adminHtml(args),
  args: base,
};

export const Reports = {};
export const ReportsUnjudgedOnly = { name: 'Reports, unjudged only', args: { onlyUnmarked: true } };
export const Accounts = { args: { current: 'accounts' } };
export const Games = { args: { current: 'games' } };
export const LiveRooms = { name: 'Live rooms', args: { current: 'rooms' } };
export const Challenges = { args: { current: 'challenges' } };
export const Loading = { args: { isLoading: true } };
export const Empty = { name: 'Empty tables', args: { reportRows: [], accountRows: [], current: 'reports' } };
export const ServerFault = { name: 'Server fault', args: { faultMsg: 'the server answered 502 — try refresh' } };
export const Refused = { name: 'Not an admin', args: { access: false } };
