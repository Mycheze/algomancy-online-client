/* The cube draft event page (ui/pages/cube.ts, docs/25 §10), drawn from made-up views: no
 * server, no account, no socket. The buttons do nothing here — their handler is ui/cube.ts. The
 * draft itself is the pick screen's story (pages/cubedraft.ts). The views are the page tests'
 * (ui/test/cube-fixture.ts), so a story and its test show the same event. */
import { CHROME, overlay, page } from './_page.ts';
import { cubeHtml, cubeJoinRowsHtml, defaultForm, formPool, packMath, type CubeForm } from '../../../ui/pages/cube.ts';
import { eventView, match, NOW, pageView, PLAYERS } from '../../../ui/test/cube-fixture.ts';
import type { CubeMine } from '../../../server/cube-types.ts';

const MINE: CubeMine[] = [
  { code: 'QZXV', name: 'Friday cube', phase: 'lobby', isHost: true, players: 3, maxPlayers: 8, startAt: null, myMatch: null },
  { code: 'KPLM', name: 'Sunday at the shop', phase: 'playing', isHost: false, players: 6, maxPlayers: 8, startAt: null,
    myMatch: match('r2p1', 2, 0, 3, 'waiting') },
  { code: 'WRTB', name: 'Old one', phase: 'done', isHost: false, players: 8, maxPlayers: 8, startAt: null, myMatch: null },
];

const show = (v: Parameters<typeof pageView>[0]): string => overlay(page(cubeHtml(pageView({ chrome: CHROME, ...v }))), 760);

function withForm(f: CubeForm, kind: 'new' | 'edit' = 'new'): string {
  const pool = formPool(f);
  return show({
    code: null, list: MINE, sheet: { kind }, form: f,
    formMath: { pool, full: packMath(pool, f.maxPlayers, f.packs, f.packSize), least: packMath(pool, f.minPlayers, f.packs, f.packSize) },
    days: ['Today', 'Tomorrow', 'Mon 16', 'Tue 17', 'Wed 18', 'Thu 19', 'Fri 20'].map((label, i) => ({ label, offset: i, on: i === 1 })),
    startText: 'Sun 15 Nov, 19:00',
  });
}

const PENDING = [match('r3p1', 3, 0, 1, 'waiting'), match('r3p2', 3, 2, 3, 'waiting')];
const EXHIBITION = { ...eventView('playing').config, tournament: 'exhibition' as const };

export default {
  title: 'Pages/Cube draft',
  parameters: { layout: 'fullscreen' },
};

export const MyEvents = { name: 'My events', render: () => show({ code: null, list: MINE }) };
export const NoEvents = { name: 'My events, none yet', render: () => show({ code: null, list: [] }) };
export const SignedOut = { name: 'Signed out', render: () => show({ code: null, signedIn: false }) };
export const NewEvent = { name: 'New event', render: () => withForm(defaultForm('Ann', NOW)) };
export const NewEventScheduled = {
  name: 'New event, a set time, round robin, no bots',
  render: () => withForm({ ...defaultForm('Ann', NOW), start: 'time', tournament: 'roundrobin', fillBots: false, packSize: 12 }),
};
export const NewEventPasted = { name: 'New event, a pasted list', render: () => withForm({ ...defaultForm('Ann', NOW), source: 'list', listText: '2 Fire Spirit\n2 Golem\nWater Wisp' }) };
export const NewEventTooSmall = { name: 'New event, too few cards', render: () => withForm({ ...defaultForm('Ann', NOW), elements: ['fire'], maxPlayers: 12 }) };

export const LobbyHost = { name: 'Lobby, the host', render: () => show({ event: eventView('lobby') }) };
export const LobbyPlayer = { name: 'Lobby, a player', render: () => show({ event: eventView('lobby', { me: 'u2' }) }) };
export const LobbyVisitor = {
  name: 'Lobby, not in yet, a set start',
  render: () => show({ event: eventView('lobby', { me: 'u9', joined: false, config: { ...eventView('lobby').config, startAt: NOW + 2 * 3_600_000, fillBots: false } }) }),
};
export const Drafting = { name: 'Drafting, stepped out of the pick screen', render: () => show({ event: eventView('drafting') }) };
export const Building = { name: 'Building decks, the host', render: () => show({ event: eventView('building') }) };
export const BuildingStartNow = { name: 'Building, Start now asks first', render: () => show({ event: eventView('building'), sheet: { kind: 'startnow' } }) };
export const Standings = { name: 'Playing: Standings', render: () => show({ event: eventView('playing') }) };
export const Round = { name: 'Playing: Round', render: () => show({ event: eventView('playing'), tab: 'round' }) };
export const Matches = { name: 'Playing: Matches, one live to watch', render: () => show({ event: eventView('playing', { me: 'u4' }), tab: 'matches' }) };
export const Players = { name: 'Playing: Players, the host', render: () => show({ event: eventView('playing'), tab: 'players' }) };
export const Schedule = {
  name: 'Round robin: Schedule',
  render: () => show({ event: eventView('playing', { config: { ...eventView('playing').config, tournament: 'roundrobin' } }), tab: 'round' }),
};
export const BreakHost = { name: 'The break, the host', render: () => show({ event: eventView('playing', { breakUntil: NOW + 72_000, pending: PENDING, myMatch: null }) }) };
export const PairingsSheet = {
  name: 'The break, the pairings sheet',
  render: () => show({ event: eventView('playing', { breakUntil: NOW + 72_000, pending: PENDING, myMatch: null }), sheet: { kind: 'pairings' }, swapPick: 'u2' }),
};
export const ResultSheet = { name: 'A result, set by the host', render: () => show({ event: eventView('playing'), tab: 'matches', sheet: { kind: 'result', pairing: 'r1p1' } }) };
export const Exhibition = { name: 'Exhibition, ready', render: () => show({ event: eventView('playing', { config: EXHIBITION, myMatch: null, round: 0 }) }) };
export const ExhibitionOff = {
  name: 'Exhibition, taking a break',
  render: () => show({ event: eventView('playing', { config: EXHIBITION, myMatch: null, round: 0, players: PLAYERS.map(p => (p.user === 'u1' ? { ...p, ready: false } : p)) }) }),
};
export const Matched = { name: 'A match found: the banner', render: () => show({ event: eventView('playing'), banner: match('r2p1', 2, 0, 3, 'waiting') }) };
export const Done = { name: 'Finished', render: () => show({ event: eventView('done') }) };
export const CalledOff = { name: 'Called off', render: () => show({ event: eventView('cancelled') }) };

const card = (html: string): string => `<div style="max-width:320px;padding:12px;border:1px dashed var(--color-border)">${html}</div>`;
export const JoinRows = { name: 'Join sheet: Your cube events', render: () => card(cubeJoinRowsHtml(MINE)) };
