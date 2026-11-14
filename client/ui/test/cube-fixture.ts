/* Made-up cube event views for the DOM-free page tests (1335–1342) — the shape
 * server/cube.ts sends (server/cube-types.ts CubeView). Not a test: no `.test.ts`. */
import type { CubeConfig, CubeMatchView, CubePhase, CubeView, StandingRow } from '../../server/cube-types.ts';
import type { CubePageView } from '../pages/cube.ts';

export const NOW = Date.UTC(2026, 10, 14, 18, 0, 0);

export const CONFIG: CubeConfig = {
  name: 'Friday <cube>', source: { kind: 'elements', elements: ['fire', 'water', 'earth', 'wood', 'metal'] },
  packs: null, packSize: null, minPlayers: 2, maxPlayers: 8, fillBots: true, startAt: null,
  tournament: 'swiss', swissRounds: 3, rules: 'casual', bestOf: 1,
};

export const HOST = { user: 'u1', name: 'Ann' };
export const PLAYERS = [
  { user: 'u1', name: 'Ann', dropped: false, submitted: true, ready: true, inMatch: false },
  { user: 'u2', name: 'Bo', dropped: false, submitted: true, ready: true, inMatch: false },
  { user: 'u3', name: 'Cy', dropped: false, submitted: false, ready: false, inMatch: false },
  { user: 'u4', name: 'Di', dropped: false, submitted: true, ready: true, inMatch: false },
];

export const match = (pairing: string, round: number, a: number, b: number | null, status: CubeMatchView['status'], over: Partial<CubeMatchView> = {}): CubeMatchView => ({
  pairing, round, a: { user: PLAYERS[a]!.user, name: PLAYERS[a]!.name },
  b: b === null ? null : { user: PLAYERS[b]!.user, name: PLAYERS[b]!.name },
  status, room: status === 'live' ? `R${pairing.toUpperCase()}` : null, score: null, winner: null, ...over,
});

export const STANDINGS: StandingRow[] = PLAYERS.map((p, i) => ({
  user: p.user, name: p.name, rank: i + 1, points: 6 - i * 2, w: 2 - Math.min(2, i), l: Math.min(2, i), d: 0,
  omw: 0.5, gw: 0.6, ogw: 0.45, dropped: false,
}));

/** a view of an event in `phase`, as `me` sees it (the host by default) */
export function eventView(phase: CubePhase, over: Partial<CubeView> = {}): CubeView {
  const me = over.me === undefined ? HOST.user : over.me;
  return {
    now: NOW, code: 'QZXV', config: CONFIG, phase, host: HOST, isHost: me === HOST.user, me, joined: me !== null,
    players: phase === 'lobby' ? PLAYERS.slice(0, 3).map(p => ({ ...p, submitted: false })) : PLAYERS,
    poolSize: 320,
    packMath: [{ seats: 8, packs: 3, packSize: 13, ok: true }, { seats: 8, packs: 3, packSize: 13, ok: true }],
    draft: null, myPool: phase === 'lobby' ? null : Array(39).fill('Fire Spirit'), myDeck: null,
    round: phase === 'playing' ? 2 : 0, breakUntil: null, pending: null,
    matches: phase === 'playing' || phase === 'done' ? [
      match('r1p1', 1, 0, 1, 'done', { score: '1–0', winner: 'u1' }),
      match('r1p2', 1, 2, 3, 'done', { score: '0–1', winner: 'u4' }),
      match('r2p1', 2, 0, 3, 'waiting'),
      match('r2p2', 2, 1, 2, 'live'),
    ] : [],
    standings: phase === 'playing' || phase === 'done' ? STANDINGS : [],
    myMatch: phase === 'playing' ? match('r2p1', 2, 0, 3, 'waiting') : null,
    ...over,
  };
}

/** the page's view around an event (or the list, with `code: null`) */
export function pageView(over: Partial<CubePageView> = {}): CubePageView {
  return {
    chrome: { signedIn: true, alerts: 0 }, now: NOW, tz: 'UTC', shareUrl: 'https://x/?cube=QZXV',
    code: 'QZXV', event: null, list: null, listMissed: false, loading: false, signedIn: true,
    tab: 'standings', sheet: null, form: null, formMath: null, days: [], startText: '',
    msg: '', msgTone: 'error', busy: false, arming: null, swapPick: null, banner: null, online: true,
    ...over,
  };
}

/** the tag that carries `data-btn="<btn>"` (and `extra`, if given) */
export function tagOf(html: string, btn: string, extra = ''): string {
  const re = new RegExp(`<(?:button|a|div)\\b[^>]*data-btn="${btn}"[^>]*>`, 'g');
  for (const m of html.matchAll(re)) if (!extra || m[0].includes(extra)) return m[0];
  return '';
}

/** every data-btn on the page */
export const btns = (html: string): string[] => [...new Set([...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!))];
