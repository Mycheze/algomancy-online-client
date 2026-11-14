/* CUBE DRAFT EVENTS — THE CONTROLLER (docs/25-cube-draft.md §2–§9).
 *
 * The glue between the event record (cube-store.ts), the pure modules
 * (cube-draft.ts the pod draft, cube-bot.ts the bots and the suggested deck,
 * cube-tourney.ts the pairings and standings) and the ordinary match rooms an
 * event opens for its pairings (match.ts, the league's pattern).
 *
 *   lobby     players join by code; the host starts it, or `startAt` does
 *   drafting  the 1 s sweep runs `advance` (bot picks, human timeouts); the
 *             last pick → building
 *   building  each player submits a deck from their drafted cards; all in (or
 *             the host's Start, which drops whoever has none) → the break
 *   playing   the break: the next round is computed at once (the host sees it,
 *             may swap, may Post now) and posts itself after breakMs(). A Swiss
 *             round decided → the next break, or done after the last round.
 *             Round robin posts its whole schedule; exhibition pairs two Ready
 *             players who have not met, whenever it can.
 *   done      the final standings
 *
 * Every op takes `now` (the tests drive a fake clock) and returns
 * `{ok: true, …}` or `{ok: false, error, status}` — status is the HTTP code
 * api-cube.ts answers with. What this module needs from main.ts (fresh codes,
 * the pushes, the win rates) is INJECTED with `setCubeHooks`, so a test drives
 * it in-process with no sockets.
 *
 * MATCHES. A posted pairing opens its match room LAZILY, when either player
 * presses Play (`playMatch`) — exactly openLeagueMatch's shape: createRoom
 * stamped with both users, startMatch, and both seats registered server-side
 * with the decks submitted at that moment (which deals game 1). The match
 * carries `m.cube = {event, pairing}`, is never rated, and reports back
 * through `cubeMatchEnded` — called by main.ts's ONE composed `ended` hook
 * beside the league's. A void match (its room idle-closed) returns the
 * pairing to "not started"; the next Play opens a fresh room.
 */
import { randomInt } from 'node:crypto';
import type { CardName, Element } from '../engine/src/types.ts';
import { ALL_ELEMENTS } from '../engine/src/apply.ts';
import { checkMatchDeck } from '../engine/src/matchdeck.ts';
import { draftDeckList } from '../engine/src/cards/registry.ts';
import { importDeckText } from './decks.ts';
import { MIN_PICKS, advance, draftView, packMath, pick, reserve, seatOf, startDraft } from './cube-draft.ts';
import { autoBuild, botPick, type WinRates } from './cube-bot.ts';
import { pairExhibition, pairSwiss, roundDone, roundRobin, scoreLine, standings, swapPlayers } from './cube-tourney.ts';
import { addNote, allCubes, getCube, saveCube } from './cube-store.ts';
import { matchRules, registerSeat, reserveMatchId, startMatch, voidMatch } from './match.ts';
import { getMatch, matchOpen, matchScore, saveMatch, type Match } from './match-store.ts';
import { MATCH_CLOCK_MS, closeMatchRoom, createRoom, getRoom } from './rooms.ts';
import type {
  CubeConfig, CubeEvent, CubeMatchView, CubeMine, CubePlayer, CubeSource, CubeView, Pairing,
  PairingOutcome, Tournament,
} from './cube-types.ts';

/* ── HOOKS ─────────────────────────────────────────────────────────────── */

export interface CubeHooks {
  /** a fresh code for a new EVENT (main.ts freshRoomCode — not reserved: a
   *  reservation would let a game join turn the event's code into a room) */
  eventCode(): string;
  /** a fresh, RESERVED room code for a match room */
  roomCode(): string;
  /** the event changed: push its subscribers their views (`only`: just that account's) */
  changed(e: CubeEvent, only?: string): void;
  /** a pairing including `user` was posted, or exhibition paired them */
  matched(e: CubeEvent, user: string, match: CubeMatchView): void;
  /** the bots' win rates (main.ts: cardStats({mode:'all'}) gih); read once per draft start */
  winRates(): WinRates;
}
let n = 0;
let hooks: CubeHooks = {
  eventCode: () => `C${(++n).toString(36).toUpperCase().padStart(3, '0')}`,
  roomCode: () => { throw new Error('cube hooks not set'); },
  changed: () => {}, matched: () => {}, winRates: () => new Map(),
};
/** set some hooks, keeping the others */
export function setCubeHooks(h: Partial<CubeHooks>): void { hooks = { ...hooks, ...h }; }

/** the break between rounds (docs/25 §7): env ALGO_CUBE_BREAK_MS, default 90 s */
export function breakMs(): number {
  const v = Number(process.env['ALGO_CUBE_BREAK_MS']);
  return Number.isFinite(v) && v >= 0 ? v : 90_000;
}

/* ── RESULTS ───────────────────────────────────────────────────────────── */

export type Op<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };
const no = (error: string, status = 400): { ok: false; error: string; status: number } => ({ ok: false, error, status });
const OK = { ok: true } as const;
const HOST_ONLY = (): { ok: false; error: string; status: number } => no('only the host can do that', 403);

export interface Actor { id: string; username: string }

/* ── CACHES (never persisted) ──────────────────────────────────────────── */

/** the bots' win rates, read at the draft's start (and again after a restart) */
const wrCache = new Map<string, WinRates>();
const winRatesOf = (e: CubeEvent): WinRates => {
  let wr = wrCache.get(e.code);
  if (!wr) { wr = hooks.winRates(); wrCache.set(e.code, wr); }
  return wr;
};
/** per seat: the suggestion for the pack it holds now, so a push storm does not rescore */
const suggestCache = new Map<string, { key: string; card: string }>();
/** a scheduled start that could not start (pack math): not retried every second */
const startRefused = new Map<string, string>();

const botSeed = (e: CubeEvent, seat: number): number => (((e.seed ?? 0) ^ Math.imul(seat + 1, 0x9e3779b1)) >>> 0);

/** the bot heuristic's card for this seat's current pack (the client highlights it at ≤ 10 s,
 *  the server takes it on a timeout, a bot takes it after 1 s) */
export function suggestionFor(e: CubeEvent, seat: number): string | null {
  const s = e.draft?.seats[seat];
  const pack = s?.queue[0];
  if (!s || !pack?.length) return null;
  const key = `${pack.join('\u0001')}|${s.picks.length}`;
  const id = `${e.code}:${seat}`;
  const hit = suggestCache.get(id);
  if (hit && hit.key === key) return hit.card;
  const card = botPick(pack, s.picks, winRatesOf(e), botSeed(e, seat));
  suggestCache.set(id, { key, card });
  return card;
}

/* ── CONFIG ────────────────────────────────────────────────────────────── */

export const DEFAULT_ELEMENTS: Element[] = ['fire', 'water', 'earth', 'wood', 'metal'];
export const CUBE_LIMITS = {
  name: 40, players: [2, 12], packs: [1, 6], packSize: [5, 20], swissRounds: [1, 10],
  /** a scheduled start at most this far ahead */
  startAhead: 30 * 24 * 3600_000,
  /** a host's events that are not over yet */
  openPerHost: 5,
  /** copies of one card in a pasted list (the constructed copy cap, docs/25 §12 item 4) */
  copies: 2,
} as const;
const TOURNAMENTS: Tournament[] = ['swiss', 'roundrobin', 'exhibition'];

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

function intIn(v: unknown, lo: number, hi: number, def: number, what: string): number | string {
  if (v === undefined || v === null || v === '') return def;
  const x = Number(v);
  if (!Number.isInteger(x) || x < lo || x > hi) return `${what} must be ${lo}–${hi}`;
  return x;
}
function intOrNull(v: unknown, lo: number, hi: number, what: string): number | null | string {
  if (v === undefined || v === null || v === '' || v === 'auto') return null;
  const x = Number(v);
  if (!Number.isInteger(x) || x < lo || x > hi) return `${what} must be ${lo}–${hi}`;
  return x;
}

/** a pasted list (or a names array) → the pool, with the copies capped; or the bad names */
export function listPool(src: Raw): { names: CardName[] } | { error: string } {
  const text = typeof src['text'] === 'string' ? src['text']
    : Array.isArray(src['names']) ? (src['names'] as unknown[]).map(x => String(x ?? '')).join('\n') : '';
  if (!text.trim()) return { error: 'paste a card list' };
  // importDeckText also reports the deck rules (≥ 30, ≤ 2 copies): a cube list is not a deck,
  // so only its unknown names count. Its POOL is DECK_LIST, so "unknown" = not a deck card.
  const info = importDeckText(text.slice(0, 200_000));
  const bad = info.problems.filter(p => p.startsWith('unknown card: ')).map(p => p.slice('unknown card: '.length));
  if (bad.length) {
    const shown = bad.slice(0, 10).join(', ');
    return { error: `not cards in the game: ${shown}${bad.length > 10 ? ` and ${bad.length - 10} more` : ''}` };
  }
  const names: CardName[] = [];
  const count = new Map<string, number>();
  for (const c of [...info.cards, ...(info.sideboard ?? [])]) {
    const k = count.get(c) ?? 0;
    if (k >= CUBE_LIMITS.copies) continue;
    count.set(c, k + 1);
    names.push(c);
  }
  if (!names.length) return { error: 'the list is empty' };
  return { names };
}

/**
 * A config off the wire, checked (docs/25 §3). `prev` (an edit): fields left out keep theirs,
 * and the source and pool are kept unless a new source is sent.
 */
export function parseConfig(raw: unknown, hostName: string, now: number, prev?: { config: CubeConfig; pool: string[] }):
  { config: CubeConfig; pool: string[] } | { error: string } {
  const o: Raw = isObj(raw) ? raw : {};
  const base: Partial<CubeConfig> = prev?.config ?? {};
  const pickRaw = (k: keyof CubeConfig): unknown => (k in o ? o[k] : base[k]);

  const name = String(pickRaw('name') ?? '').trim().slice(0, CUBE_LIMITS.name) || `${hostName}'s cube`;

  let source: CubeSource;
  let pool: string[];
  if ('source' in o || !prev) {
    const s: Raw = isObj(o['source']) ? o['source'] : { kind: 'elements', elements: DEFAULT_ELEMENTS };
    if (s['kind'] === 'list') {
      const r = listPool(s);
      if ('error' in r) return r;
      source = { kind: 'list', names: r.names };
      pool = r.names;
    } else if (s['kind'] === 'elements' || s['kind'] === undefined) {
      const want = Array.isArray(s['elements']) ? s['elements'] : DEFAULT_ELEMENTS;
      const els = ALL_ELEMENTS.filter(el => want.includes(el));
      if (!els.length) return { error: 'pick at least one element' };
      source = { kind: 'elements', elements: els };
      pool = draftDeckList(els);
    } else return { error: 'unknown cube source' };
  } else {
    source = prev.config.source;
    pool = prev.pool;
  }

  const [pLo, pHi] = CUBE_LIMITS.players;
  const maxPlayers = intIn(pickRaw('maxPlayers'), pLo, pHi, 8, 'Max players');
  if (typeof maxPlayers === 'string') return { error: maxPlayers };
  const minPlayers = intIn(pickRaw('minPlayers'), pLo, maxPlayers, Math.min(2, maxPlayers), 'Min players');
  if (typeof minPlayers === 'string') return { error: minPlayers };
  const packs = intOrNull(pickRaw('packs'), CUBE_LIMITS.packs[0], CUBE_LIMITS.packs[1], 'Packs');
  if (typeof packs === 'string') return { error: packs };
  const packSize = intOrNull(pickRaw('packSize'), CUBE_LIMITS.packSize[0], CUBE_LIMITS.packSize[1], 'Pack size');
  if (typeof packSize === 'string') return { error: packSize };
  const fb = pickRaw('fillBots');
  const fillBots = fb === undefined ? true : fb !== false;
  let startAt: number | null = null;
  const sa = pickRaw('startAt');
  if (sa !== undefined && sa !== null && sa !== '') {
    const t = Number(sa);
    if (!Number.isFinite(t) || t <= now) return { error: 'pick a start time in the future' };
    if (t > now + CUBE_LIMITS.startAhead) return { error: 'pick a start time within 30 days' };
    startAt = Math.round(t);
  }
  const tv = pickRaw('tournament');
  const tournament: Tournament = tv === undefined ? 'swiss' : TOURNAMENTS.includes(tv as Tournament) ? tv as Tournament : ('' as Tournament);
  if (!tournament) return { error: 'unknown tournament' };
  const swissRounds = intIn(pickRaw('swissRounds'), CUBE_LIMITS.swissRounds[0], CUBE_LIMITS.swissRounds[1], 3, 'Rounds');
  if (typeof swissRounds === 'string') return { error: swissRounds };
  const rules = pickRaw('rules') === 'competitive' ? 'competitive' : 'casual';
  const bo = Number(pickRaw('bestOf') ?? 1);
  if (bo !== 1 && bo !== 3) return { error: 'best of 1 or 3' };
  return {
    config: { name, source, packs, packSize, minPlayers, maxPlayers, fillBots, startAt, tournament, swissRounds, rules, bestOf: bo },
    pool,
  };
}

/* ── LOOKUPS ───────────────────────────────────────────────────────────── */

const playerOf = (e: CubeEvent, user: string | null | undefined): CubePlayer | undefined =>
  (user ? e.players.find(p => p.user === user) : undefined);
const active = (e: CubeEvent): CubePlayer[] => e.players.filter(p => !p.dropped);
const nameOf = (e: CubeEvent, user: string | null): string => (user ? playerOf(e, user)?.name ?? '?' : '');
const involves = (p: Pairing, user: string): boolean => p.a === user || p.b === user;
const otherOf = (p: Pairing, user: string): string | null => (p.a === user ? p.b : p.a);
/** the pairing's match, while it is open */
function liveMatch(p: Pairing): Match | undefined {
  const m = p.match ? getMatch(p.match.id) : undefined;
  return m && matchOpen(m) ? m : undefined;
}
const inLiveMatch = (e: CubeEvent, user: string): boolean =>
  e.pairings.some(p => involves(p, user) && !p.result && !!liveMatch(p));
/** the round still waiting in the break */
const pendingOf = (e: CubeEvent): Pairing[] => e.pairings.filter(p => !p.posted);
const roundSeed = (e: CubeEvent, round: number): number => (((e.seed ?? 0) + Math.imul(round, 0x2545f491)) >>> 0);

function touch(e: CubeEvent, only?: string): void {
  saveCube(e);
  try { hooks.changed(e, only); } catch (err) { console.error(`[cube] ${e.code}: push failed:`, err); }
}

/* ── LOBBY ─────────────────────────────────────────────────────────────── */

export function createCube(host: Actor, raw: unknown, now: number): Op<{ code: string }> {
  const open = allCubes().filter(e => e.host === host.id && e.phase !== 'done' && e.phase !== 'cancelled');
  if (open.length >= CUBE_LIMITS.openPerHost) return no(`you already host ${open.length} events — finish or cancel one first`);
  const c = parseConfig(raw, host.username, now);
  if ('error' in c) return no(c.error);
  const code = hooks.eventCode();
  const e: CubeEvent = {
    code, host: host.id, createdAt: now, config: c.config, phase: 'lobby',
    players: [{ user: host.id, name: host.username, joinedAt: now }],
    pool: c.pool, pairings: [], round: 0, breakUntil: null, edits: [], seed: randomInt(2 ** 31),
  };
  saveCube(e);
  console.log(`[cube] ${code}: "${e.config.name}" by ${host.username} (${e.pool.length} cards, ${e.config.tournament})`);
  return { ok: true, code };
}

export function joinCube(e: CubeEvent, me: Actor, now: number): Op {
  if (playerOf(e, me.id)) return OK;
  if (e.phase !== 'lobby') return no(e.phase === 'cancelled' ? 'this event was cancelled' : 'this event has already started');
  if (e.players.length >= e.config.maxPlayers) return no('this event is full');
  e.players.push({ user: me.id, name: me.username, joinedAt: now });
  touch(e);
  return OK;
}

export function leaveCube(e: CubeEvent, me: Actor, now: number): Op {
  if (!playerOf(e, me.id)) return no('you are not in this event');
  if (e.phase === 'lobby') {
    e.players = e.players.filter(p => p.user !== me.id);
    touch(e);
    return OK;
  }
  return dropPlayer(e, me.id, true, now, 'left');
}

export function configCube(e: CubeEvent, by: Actor, raw: unknown, now: number): Op {
  if (e.host !== by.id) return HOST_ONLY();
  if (e.phase !== 'lobby') return no('settings can only change before the draft');
  const c = parseConfig(raw, nameOf(e, e.host) || by.username, now, { config: e.config, pool: e.pool });
  if ('error' in c) return no(c.error);
  if (e.players.length > c.config.maxPlayers) return no(`${e.players.length} players have already joined`);
  e.config = c.config;
  e.pool = c.pool;
  startRefused.delete(e.code);
  e.edits.push({ at: now, what: 'settings changed' });
  touch(e);
  return OK;
}

export function kickPlayer(e: CubeEvent, by: Actor, user: string, now: number): Op {
  if (e.host !== by.id) return HOST_ONLY();
  if (!playerOf(e, user)) return no('no such player');
  if (user === e.host) return no('the host cannot be removed');
  if (e.phase === 'lobby') {
    e.players = e.players.filter(p => p.user !== user);
    e.edits.push({ at: now, what: `removed ${nameOf(e, user) || user}` });
    touch(e);
    return OK;
  }
  return dropPlayer(e, user, true, now, 'removed');
}

/** the seats a draft would have now, and for a full table */
function seatCounts(e: CubeEvent): [number, number] {
  if (e.draft) return [e.draft.seats.length, e.draft.seats.length];
  const humans = e.players.length;
  const full = Math.max(e.config.maxPlayers, humans);
  return [e.config.fillBots ? full : humans, full];
}

function beginDraft(e: CubeEvent, now: number): Op {
  const humans = e.players.filter(p => !p.dropped);
  if (humans.length < e.config.minPlayers) return no(`at least ${e.config.minPlayers} players are needed`);
  if (humans.length < 2) return no('at least 2 players are needed');
  const seats = e.config.fillBots ? Math.max(e.config.maxPlayers, humans.length) : humans.length;
  const math = packMath(e.pool.length, seats, e.config.packs, e.config.packSize);
  if (!math.ok) {
    return no(math.packs * math.packSize < MIN_PICKS && math.packSize >= 5 && seats * math.packs * math.packSize <= e.pool.length
      ? `each player needs at least ${MIN_PICKS} picks — use more or bigger packs`
      : `this cube is too small for ${seats} players`);
  }
  wrCache.set(e.code, hooks.winRates());
  const list: { user: string | null; name: string }[] = humans.map(p => ({ user: p.user, name: p.name }));
  for (let b = 1; list.length < seats; b++) list.push({ user: null, name: `Bot ${b}` });
  e.draft = startDraft(list, e.pool, math.packs, math.packSize, e.seed ?? 0, now);
  e.phase = 'drafting';
  e.startedAt = now;
  for (const p of humans) addNote(e, p.user, 'starting', now);
  console.log(`[cube] ${e.code}: draft started — ${humans.length} players + ${seats - humans.length} bots, ${math.packs} × ${math.packSize}`);
  touch(e);
  return OK;
}

/** Start: the draft from the lobby, or (building) the tournament, dropping whoever has no deck */
export function startCube(e: CubeEvent, by: Actor, now: number): Op<{ dropped?: string[] }> {
  if (e.host !== by.id) return HOST_ONLY();
  if (e.phase === 'lobby') return beginDraft(e, now);
  if (e.phase === 'building') {
    const ready = active(e).filter(p => p.deck);
    if (ready.length < 2) return no('at least 2 players need a submitted deck');
    const dropped: string[] = [];
    for (const p of active(e)) if (!p.deck) { p.dropped = true; dropped.push(p.name); }
    if (dropped.length) e.edits.push({ at: now, what: `started without ${dropped.join(', ')}` });
    beginTournament(e, now);
    touch(e);
    return { ok: true, dropped };
  }
  return no('there is nothing to start');
}

export function cancelCube(e: CubeEvent, by: Actor, now: number): Op {
  if (e.host !== by.id) return HOST_ONLY();
  if (e.phase !== 'lobby' && e.phase !== 'drafting' && e.phase !== 'building') {
    return no(e.phase === 'playing' ? 'the tournament has started — end it instead' : 'this event is already over');
  }
  e.phase = 'cancelled';
  e.endedAt = now;
  e.edits.push({ at: now, what: 'cancelled' });
  touch(e);
  return OK;
}

/* ── THE DRAFT ─────────────────────────────────────────────────────────── */

function draftSeat(e: CubeEvent, user: string): number | string {
  if (e.phase !== 'drafting' || !e.draft) return 'the draft is not running';
  const s = seatOf(e.draft, user);
  return s < 0 ? 'you have no seat at this draft' : s;
}

export function reserveCard(e: CubeEvent, user: string, card: string): Op {
  const seat = draftSeat(e, user);
  if (typeof seat === 'string') return no(seat);
  const r = reserve(e.draft!, seat, card);
  if (!r.ok) return no(r.error);
  touch(e, user);
  return OK;
}

export function pickCard(e: CubeEvent, user: string, card: string, now: number): Op {
  const seat = draftSeat(e, user);
  if (typeof seat === 'string') return no(seat);
  const r = pick(e.draft!, seat, card, now);
  if (!r.ok) return no(r.error);
  if (e.draft!.done) endDraft(e, now);
  touch(e);
  return OK;
}

/** the last pick: every player's pool is their seat's picks; bots leave (their seats stay in the file) */
function endDraft(e: CubeEvent, now: number): void {
  const d = e.draft!;
  for (const p of e.players) {
    const s = seatOf(d, p.user);
    if (s >= 0) p.pool = [...d.seats[s]!.picks];
  }
  e.phase = 'building';
  for (const k of [...suggestCache.keys()]) if (k.startsWith(`${e.code}:`)) suggestCache.delete(k);
  console.log(`[cube] ${e.code}: draft over at ${new Date(now).toISOString()} — building`);
}

/* ── BUILDING ──────────────────────────────────────────────────────────── */

/** a deck submitted for the event (docs/25 §6): legal, and every card one I drafted */
export function submitDeck(e: CubeEvent, user: string, main: unknown, side: unknown, now: number): Op {
  const p = playerOf(e, user);
  if (!p) return no('you are not in this event');
  if (p.dropped) return no('you have left this event');
  if (e.phase !== 'building' && e.phase !== 'playing') return no('decks are built after the draft');
  if (!p.pool) return no('you have no drafted cards');
  if (inLiveMatch(e, user)) return no('finish your match first');
  const c = checkMatchDeck(main, side ?? []);
  if (!c.ok) return no(c.error);
  const have = new Map<string, number>();
  for (const x of p.pool) have.set(x, (have.get(x) ?? 0) + 1);
  for (const x of [...c.main, ...c.side]) {
    const k = have.get(x) ?? 0;
    if (k <= 0) return no(p.pool.includes(x) ? `you drafted fewer copies of ${x}` : `you did not draft ${x}`);
    have.set(x, k - 1);
  }
  const first = !p.deck;
  p.deck = { main: [...c.main], side: [...c.side], at: now };
  if (e.phase === 'playing' && e.config.tournament === 'exhibition' && first && !e.breakUntil) {
    p.ready = true; p.readySince = now;
  }
  if (e.phase === 'building' && active(e).every(x => x.deck)) beginTournament(e, now);
  touch(e);
  return OK;
}

/** "Suggest a deck": the bot's 30 + 7 from my drafted cards */
export function suggestDeck(e: CubeEvent, user: string): Op<{ main: string[]; side: string[] }> {
  const p = playerOf(e, user);
  if (!p?.pool) return no('you have no drafted cards');
  return { ok: true, ...autoBuild(p.pool, winRatesOf(e)) };
}

/** the most piles an arrangement may have, and a pile name's longest (ui/deckarrange.ts MAX_PILE_NAME) */
const ARRANGE_PILES_MAX = 60;
const PILE_NAME_MAX = 40;

/** a list of card names, or null */
const names = (v: unknown, most: number): string[] | null =>
  Array.isArray(v) && v.length <= most && v.every(x => typeof x === 'string' && x.length > 0 && x.length <= 80) ? v as string[] : null;

/**
 * My deck table's arrangement (docs/25 §6, owner 2026-11-14: "the layout you set during the draft
 * should automatically be there"): the main deck's piles, the sideboard, Maybe. Kept on my player
 * record and handed back in my view; the builder opens on it. Every card must be one I hold — my
 * picks while drafting, my drafted pool after — counting copies; a card not yet placed (a pick
 * still on its way) may be missing. Saved, not pushed: the table that sent it already shows it.
 */
export function arrangeCards(e: CubeEvent, user: string, raw: unknown): Op {
  const p = playerOf(e, user);
  if (!p) return no('you are not in this event');
  if (p.dropped) return no('you have left this event');
  let held: string[] | undefined;
  if (e.phase === 'drafting' && e.draft) {
    const s = seatOf(e.draft, user);
    held = s >= 0 ? e.draft.seats[s]!.picks : undefined;
  } else if (e.phase === 'building' || e.phase === 'playing') held = p.pool;
  if (!held) return no('there is no table to lay out now');
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const piles = Array.isArray(b['piles']) && b['piles'].length <= ARRANGE_PILES_MAX
    ? b['piles'].map(x => names(x, 200)) : null;
  const side = names(b['side'] ?? [], 200), maybe = names(b['maybe'] ?? [], 200);
  const titles = b['names'] === undefined ? undefined
    : Array.isArray(b['names']) && piles && b['names'].length === piles.length
      && b['names'].every(x => typeof x === 'string' && x.length <= PILE_NAME_MAX) ? b['names'] as string[] : null;
  const from = b['from'] === 'build' ? 'build' : b['from'] === undefined || b['from'] === 'draft' ? 'draft' : null;
  if (!piles || piles.some(x => !x) || !side || !maybe || titles === null || !from) return no('that is not a table layout');
  const have = new Map<string, number>();
  for (const x of held) have.set(x, (have.get(x) ?? 0) + 1);
  for (const x of [...(piles as string[][]).flat(), ...side, ...maybe]) {
    const k = have.get(x) ?? 0;
    if (k <= 0) return no(held.includes(x) ? `you have fewer copies of ${x}` : `you did not draft ${x}`);
    have.set(x, k - 1);
  }
  p.arrange = { piles: (piles as string[][]).map(x => [...x]), ...(titles ? { names: [...titles] } : {}), side: [...side], maybe: [...maybe], from };
  saveCube(e);
  return OK;
}

/* ── THE TOURNAMENT ────────────────────────────────────────────────────── */

/** every deck is in: the break before round 1 (round robin's whole schedule, exhibition's Ready) */
function beginTournament(e: CubeEvent, now: number): void {
  e.phase = 'playing';
  e.round = 0;
  e.pairings = e.pairings.filter(p => p.posted);
  if (e.config.tournament === 'swiss') e.pairings.push(...pairSwiss(e.players, e.pairings, 1, roundSeed(e, 1)));
  else if (e.config.tournament === 'roundrobin') e.pairings.push(...roundRobin(e.players, roundSeed(e, 0)));
  e.breakUntil = now + breakMs();
  console.log(`[cube] ${e.code}: every deck is in — round 1 in ${Math.round(breakMs() / 1000)} s`);
}

/** the break is over (or the host pressed Post now): the waiting pairings go live */
function postRound(e: CubeEvent, now: number): void {
  const pending = pendingOf(e);
  for (const p of pending) {
    p.posted = true;
    if (p.b === null) p.result = { kind: 'bye', at: now, by: 'play' };
  }
  e.breakUntil = null;
  const t = e.config.tournament;
  if (t === 'swiss') e.round = pending[0]?.round ?? e.round + 1;
  else if (t === 'roundrobin') {
    e.round = 1;
    for (const pl of active(e)) addNote(e, pl.user, 'round', now);
  } else {
    for (const pl of active(e)) { pl.ready = true; pl.readySince = now; }
  }
  if (t === 'swiss') {
    for (const p of pending) {
      addNote(e, p.a, 'round', now, { round: p.round, opponent: p.b ? nameOf(e, p.b) : null });
      if (p.b) addNote(e, p.b, 'round', now, { round: p.round, opponent: nameOf(e, p.a) });
    }
  }
  for (const p of pending) {
    if (!p.b) continue;
    const v = matchView(e, p);
    for (const u of [p.a, p.b]) {
      try { hooks.matched(e, u, v); } catch (err) { console.error(`[cube] ${e.code}: matched push failed:`, err); }
    }
  }
  console.log(`[cube] ${e.code}: ${t === 'swiss' ? `round ${e.round}` : t === 'roundrobin' ? 'the schedule' : 'exhibition'} posted`);
  progress(e, now);
}

/** after any result: the round's end (the next break, or done), round robin's last match */
function progress(e: CubeEvent, now: number): void {
  if (e.phase !== 'playing') return;
  const t = e.config.tournament;
  if (t === 'swiss') {
    if (e.breakUntil || pendingOf(e).length || e.round < 1 || !roundDone(e.pairings, e.round)) return;
    if (e.round >= e.config.swissRounds || active(e).length < 2) return finishEvent(e, now);
    e.pairings.push(...pairSwiss(e.players, e.pairings, e.round + 1, roundSeed(e, e.round + 1)));
    e.breakUntil = now + breakMs();
    console.log(`[cube] ${e.code}: round ${e.round} decided — round ${e.round + 1} in ${Math.round(breakMs() / 1000)} s`);
  } else if (t === 'roundrobin') {
    if (e.breakUntil) return;
    if (e.pairings.every(p => !!p.result)) finishEvent(e, now);
  }
}

function finishEvent(e: CubeEvent, now: number): void {
  for (const p of e.pairings) {
    const m = liveMatch(p);
    if (m) endCubeMatch(m, 'the event ended', now);
  }
  e.pairings = e.pairings.filter(p => p.posted);
  e.phase = 'done';
  e.endedAt = now;
  e.breakUntil = null;
  for (const p of active(e)) addNote(e, p.user, 'done', now);
  console.log(`[cube] ${e.code}: done`);
}

export function endCube(e: CubeEvent, by: Actor, now: number): Op {
  if (e.host !== by.id) return HOST_ONLY();
  if (e.phase !== 'playing') return e.phase === 'done' ? no('this event is already over') : no('the tournament has not started — cancel it instead');
  e.edits.push({ at: now, what: 'ended by the host' });
  finishEvent(e, now);
  touch(e);
  return OK;
}

export function postNow(e: CubeEvent, by: Actor, now: number): Op {
  if (e.host !== by.id) return HOST_ONLY();
  if (e.phase !== 'playing' || !e.breakUntil) return no('there is nothing to post');
  e.edits.push({ at: now, what: 'posted the round early' });
  postRound(e, now);
  touch(e);
  return OK;
}

/** the host swaps two players in the waiting round (or the current round's unstarted pairings) */
export function swapPairing(e: CubeEvent, by: Actor, u1: string, u2: string, now: number): Op {
  if (e.host !== by.id) return HOST_ONLY();
  if (e.phase !== 'playing') return no('there are no pairings yet');
  if (e.config.tournament === 'exhibition') return no('exhibition pairs itself');
  const pend = pendingOf(e);
  const round = pend[0]?.round ?? e.round;
  const r = swapPlayers(e.pairings, round, u1, u2);
  if ('error' in r) return no(r.error);
  e.pairings = r;
  e.edits.push({ at: now, what: `swapped ${nameOf(e, u1)} and ${nameOf(e, u2)} in round ${round}` });
  touch(e);
  return OK;
}

/** the host's result: a win for one side, a draw, or clear ("void": back to not played) */
export type HostOutcome = { kind: 'win'; winner: string; games?: [number, number] } | { kind: 'draw' } | { kind: 'clear' };

export function parseOutcome(raw: unknown): HostOutcome | null {
  if (typeof raw === 'string') {
    if (raw === 'draw') return { kind: 'draw' };
    if (raw === 'clear' || raw === 'void') return { kind: 'clear' };
    return raw ? { kind: 'win', winner: raw } : null;
  }
  if (!isObj(raw)) return null;
  if (raw['kind'] === 'draw') return { kind: 'draw' };
  if (raw['kind'] === 'clear' || raw['kind'] === 'void') return { kind: 'clear' };
  if (raw['kind'] === 'win' && typeof raw['winner'] === 'string') {
    const g = raw['games'];
    const games = Array.isArray(g) && g.length === 2 && g.every(x => Number.isInteger(x) && x >= 0 && x <= 3)
      ? [g[0] as number, g[1] as number] as [number, number] : undefined;
    return { kind: 'win', winner: raw['winner'], ...(games ? { games } : {}) };
  }
  return null;
}

export function setResult(e: CubeEvent, by: Actor, pairingId: string, outcome: HostOutcome, now: number): Op {
  if (e.host !== by.id) return HOST_ONLY();
  if (e.phase !== 'playing' && e.phase !== 'done') return no('there are no matches yet');
  const p = e.pairings.find(x => x.id === pairingId);
  if (!p || !p.posted) return no('no such match');
  if (p.b === null) return no('a bye has no result to change');
  if (outcome.kind === 'win' && !involves(p, outcome.winner)) return no('the winner must be one of the two players');
  const live = liveMatch(p);
  if (outcome.kind === 'clear') {
    delete p.result;
    delete p.match;
    // a cleared result in the round being played: the next round is not ready after all
    if (e.config.tournament === 'swiss' && p.round === e.round && e.breakUntil) {
      e.pairings = e.pairings.filter(x => x.posted);
      e.breakUntil = null;
    }
  } else {
    const res: PairingOutcome = outcome.kind === 'draw' ? { kind: 'draw' }
      : { kind: 'win', winner: outcome.winner, ...(outcome.games ? { games: outcome.games } : {}) };
    p.result = { ...res, at: now, by: 'host' };
  }
  e.edits.push({ at: now, what: `${outcome.kind === 'clear' ? 'cleared' : 'set'} the result of ${p.id}` });
  // docs/25 §7 "Award": a match in progress ends as a void, the host's result stands
  if (live) endCubeMatch(live, 'the host recorded the result', now);
  progress(e, now);
  touch(e);
  return OK;
}

/** void a cube match the host or the event ended, and close its room even mid-game: a game nobody's
 *  result can come from must not stay playable (voidMatch alone keeps a live game's room open) */
function endCubeMatch(m: Match, why: string, now: number): void {
  const room = getRoom(m.room);
  voidMatch(m, why, now);
  if (room) closeMatchRoom(room, 'void', now);
}

/** drop (or undrop) a player: never paired again; an undecided match of theirs goes to the opponent */
export function dropPlayer(e: CubeEvent, user: string, on: boolean, now: number, why = 'dropped'): Op {
  const pl = playerOf(e, user);
  if (!pl) return no('no such player');
  if (e.phase === 'done' || e.phase === 'cancelled') return no('this event is over');
  if (on) {
    if (pl.dropped) return OK;
    pl.dropped = true;
    pl.ready = false;
    if (e.phase === 'playing') {
      for (const p of e.pairings) {
        if (!involves(p, user) || p.result || p.b === null) continue;
        // a swiss pairing still in the break is re-paired below, not decided
        if (!p.posted && e.config.tournament !== 'roundrobin') continue;
        const live = liveMatch(p);
        p.result = { kind: 'win', winner: otherOf(p, user)!, at: now, by: 'drop' };
        if (live) endCubeMatch(live, 'a player left the event', now);
      }
      if (e.config.tournament === 'swiss' && e.breakUntil) {
        const round = pendingOf(e)[0]?.round ?? e.round + 1;
        e.pairings = e.pairings.filter(x => x.posted);
        e.pairings.push(...pairSwiss(e.players, e.pairings, round, roundSeed(e, round)));
      }
    }
  } else {
    if (!pl.dropped) return OK;
    pl.dropped = false;
    if (e.config.tournament === 'roundrobin') {
      for (const p of e.pairings) {
        if (involves(p, user) && p.result?.by === 'drop' && !p.match) delete p.result;
      }
    }
    if (e.config.tournament === 'exhibition' && pl.deck) { pl.ready = true; pl.readySince = now; }
  }
  e.edits.push({ at: now, what: `${on ? why : 'undropped'} ${pl.name}` });
  if (e.phase === 'building' && active(e).length && active(e).every(x => x.deck)) beginTournament(e, now);
  progress(e, now);
  touch(e);
  return OK;
}

export function hostDrop(e: CubeEvent, by: Actor, user: string, on: boolean, now: number): Op {
  if (e.host !== by.id) return HOST_ONLY();
  if (e.phase === 'lobby') return on ? kickPlayer(e, by, user, now) : OK;
  return dropPlayer(e, user, on, now);
}

/** exhibition: the Ready switch */
export function setReady(e: CubeEvent, user: string, on: boolean, now: number): Op {
  const p = playerOf(e, user);
  if (!p || p.dropped) return no('you are not in this event');
  if (e.config.tournament !== 'exhibition') return no('only exhibition has a Ready switch');
  if (e.phase !== 'playing') return no('the tournament has not started');
  if (!p.deck) return no('submit a deck first');
  p.ready = on;
  if (on) p.readySince = now;
  touch(e);
  return OK;
}

/** exhibition: pair everyone who can be paired now */
function pairReady(e: CubeEvent, now: number): boolean {
  let any = false;
  for (;;) {
    const pair = pairExhibition(e.players.filter(p => !p.dropped && p.deck), e.pairings, now);
    if (!pair) return any;
    const k = e.pairings.length + 1;
    const p: Pairing = { id: `x${k}`, round: k, a: pair[0], b: pair[1], posted: true };
    e.pairings.push(p);
    any = true;
    const v = matchView(e, p);
    for (const u of pair) {
      addNote(e, u, 'match', now, { opponent: nameOf(e, otherOf(p, u)) });
      try { hooks.matched(e, u, v); } catch (err) { console.error(`[cube] ${e.code}: matched push failed:`, err); }
    }
  }
}

/* ── MATCHES ───────────────────────────────────────────────────────────── */

/** Play: my pairing's match room — the one open now, or a new one (both decks registered) */
export function playMatch(e: CubeEvent, user: string, pairingId: string | null, now: number): Op<{ room: string; pairing: string }> {
  const me = playerOf(e, user);
  if (!me || me.dropped) return no('you are not in this event');
  if (e.phase !== 'playing') return no('there is no match to play');
  const mine = e.pairings.filter(p => p.posted && !p.result && p.b !== null && involves(p, user));
  const p = pairingId ? mine.find(x => x.id === pairingId)
    : mine.find(x => !!liveMatch(x)) ?? mine.find(x => !inLiveMatch(e, otherOf(x, user)!)) ?? mine[0];
  if (!p) return no('you have no match to play right now');
  const live = liveMatch(p);
  if (live) {
    const room = getRoom(live.room);
    if (room && !room.closed) return { ok: true, room: room.code, pairing: p.id };
  }
  const opp = otherOf(p, user)!;
  if (inLiveMatch(e, user)) return no('you are already playing a match');
  if (inLiveMatch(e, opp)) return no(`${nameOf(e, opp)} is still playing another match`);
  const A = playerOf(e, p.a)!, B = playerOf(e, p.b!)!;
  if (!A.deck || !B.deck) return no(`${!A.deck ? A.name : B.name} has no deck yet`);
  const code = openMatchRoom(e, p, A, B, now);
  touch(e);
  return { ok: true, room: code, pairing: p.id };
}

function openMatchRoom(e: CubeEvent, p: Pairing, A: CubePlayer, B: CubePlayer, now: number): string {
  // which of them takes seat 0 is a coin flip, as in the queue and the league
  const [first, second] = Math.random() < 0.5 ? [A, B] : [B, A];
  const id = reserveMatchId();
  const casual = e.config.rules === 'casual';
  const users: [string, string] = [first.user, second.user];
  const room = createRoom(hooks.roomCode(), (Math.random() * 1e9) >>> 0, [first.name, second.name], 'constructed',
    undefined, undefined, undefined, MATCH_CLOCK_MS.constructed, undefined, false,
    { rules: matchRules({ casual }), match: { id, game: 1 }, users });
  const m = startMatch(room, id, e.config.bestOf, now, casual);
  m.users = [...users];
  m.cube = { event: e.code, pairing: p.id };
  saveMatch(m);
  p.match = { id, room: room.code };
  // both seats registered with the decks submitted NOW (docs/25 §8); the second deals game 1
  for (const [seat, pl] of [[0, first], [1, second]] as const) {
    const r = registerSeat(room, seat, pl.user, pl.name, { main: pl.deck!.main as CardName[], side: pl.deck!.side as CardName[], deckId: null });
    if (!r.ok) console.error(`[cube] ${e.code}: could not register ${pl.name} in ${room.code}: ${r.why}`);
  }
  console.log(`[cube] ${e.code}: ${p.id} ${first.name} vs ${second.name} in ${room.code} (match ${id}, Best of ${e.config.bestOf})`);
  return room.code;
}

/**
 * match.ts `ended`, through main.ts's composed dispatcher: a cube match is over (its result goes on
 * the pairing, once) or void (the pairing goes back to not started). Idempotent.
 */
export function cubeMatchEnded(m: Match, now = Date.now()): void {
  if (!m.cube) return;
  const e = getCube(m.cube.event);
  const p = e?.pairings.find(x => x.id === m.cube!.pairing);
  if (!e || !p || p.match?.id !== m.id) return;
  if (m.phase === 'void') {
    if (p.result) return;
    delete p.match;
    touch(e);
    return;
  }
  if (m.phase !== 'over' || !m.result || p.result) return;
  const winner = m.users[m.result.winner];
  if (!winner || !involves(p, winner)) return;
  const score = matchScore(m);
  const ga = m.users[0] === p.a ? score[0] : score[1];
  const gb = m.users[0] === p.a ? score[1] : score[0];
  p.result = { kind: 'win', winner, ...(ga + gb > 0 ? { games: [ga, gb] as [number, number] } : {}), at: now, by: 'play' };
  if (e.config.tournament === 'exhibition') {
    for (const u of [p.a, p.b]) {
      const pl = playerOf(e, u);
      if (pl && !pl.dropped) { pl.ready = true; pl.readySince = now; }
    }
  }
  console.log(`[cube] ${e.code}: ${p.id} to ${nameOf(e, winner)} (${scoreLine(p) ?? ''})`);
  progress(e, now);
  touch(e);
}

/* ── THE SWEEP, AND THE BOOT ───────────────────────────────────────────── */

/** main.ts's 1 s tick: scheduled starts, the draft's clocks and bots, break ends, exhibition pairing */
export function sweepCubes(now = Date.now()): void {
  for (const e of allCubes()) {
    try { sweepOne(e, now); } catch (err) { console.error(`[cube] ${e.code}: sweep failed:`, err); }
  }
}

function sweepOne(e: CubeEvent, now: number): void {
  if (e.phase === 'lobby') {
    if (e.config.startAt !== null && now >= e.config.startAt && e.players.length >= e.config.minPlayers
      && startRefused.get(e.code) !== JSON.stringify(e.config) + e.players.length) {
      const r = beginDraft(e, now);
      if (!r.ok) {
        startRefused.set(e.code, JSON.stringify(e.config) + e.players.length);
        console.log(`[cube] ${e.code}: scheduled start refused — ${r.error}`);
      }
    }
    return;
  }
  if (e.phase === 'drafting' && e.draft) {
    const changed = advance(e.draft, now, seat => suggestionFor(e, seat) ?? e.draft!.seats[seat]!.queue[0]![0]!);
    if (!changed) return;
    if (e.draft.done) endDraft(e, now);
    touch(e);
    return;
  }
  if (e.phase === 'playing') {
    if (e.breakUntil && now >= e.breakUntil) { postRound(e, now); touch(e); return; }
    if (e.config.tournament === 'exhibition' && !e.breakUntil && pairReady(e, now)) touch(e);
  }
}

/** boot, after reconcileMatches: a pairing whose match ended while we were down takes its result
 *  (or goes back to not started); one whose match record is gone goes back too */
export function reconcileCubes(now = Date.now()): void {
  for (const e of allCubes()) {
    if (e.phase !== 'playing' && e.phase !== 'done') continue;
    for (const p of e.pairings) {
      if (!p.match || p.result) continue;
      const m = getMatch(p.match.id);
      if (!m) { delete p.match; saveCube(e); continue; }
      if (!matchOpen(m)) cubeMatchEnded(m, now);
    }
  }
}

/* ── WHAT EACH VIEWER SEES ─────────────────────────────────────────────── */

export function matchView(e: CubeEvent, p: Pairing): CubeMatchView {
  const live = liveMatch(p);
  const r = p.result;
  return {
    pairing: p.id, round: p.round,
    a: { user: p.a, name: nameOf(e, p.a) },
    b: p.b ? { user: p.b, name: nameOf(e, p.b) } : null,
    status: r ? 'done' : live ? 'live' : 'waiting',
    room: live ? live.room : null,
    score: scoreLine(p),
    winner: r?.kind === 'win' ? r.winner : null,
  };
}

/** what one viewer is shown (never another seat's picks; the pending round to the host only) */
export function viewFor(e: CubeEvent, userId: string | null, now: number): CubeView {
  const me = playerOf(e, userId);
  const isHost = !!userId && e.host === userId;
  const [cur, full] = seatCounts(e);
  let draft: CubeView['draft'] = null;
  if (e.phase === 'drafting' && e.draft && userId) {
    const seat = seatOf(e.draft, userId);
    if (seat >= 0) draft = draftView(e.draft, seat, now, suggestionFor(e, seat));
  }
  const tourney = e.phase === 'playing' || e.phase === 'done';
  const mine = me ? e.pairings.filter(p => p.posted && !p.result && p.b !== null && involves(p, me.user)) : [];
  const my = mine.find(p => !!liveMatch(p)) ?? mine[0];
  return {
    now, code: e.code, config: e.config, phase: e.phase,
    host: { user: e.host, name: nameOf(e, e.host) || 'the host' },
    isHost, me: userId ?? null, joined: !!me,
    players: e.players.map(p => ({
      user: p.user, name: p.name, dropped: !!p.dropped, submitted: !!p.deck, ready: !!p.ready,
      inMatch: inLiveMatch(e, p.user),
    })),
    poolSize: e.pool.length,
    packMath: [packMath(e.pool.length, cur, e.config.packs, e.config.packSize), packMath(e.pool.length, full, e.config.packs, e.config.packSize)],
    draft,
    myPool: me?.pool ? [...me.pool] : null,
    myDeck: me?.deck ? { main: [...me.deck.main], side: [...me.deck.side] } : null,
    myArrange: me?.arrange ? {
      piles: me.arrange.piles.map(x => [...x]), ...(me.arrange.names ? { names: [...me.arrange.names] } : {}),
      side: [...me.arrange.side], maybe: [...me.arrange.maybe], from: me.arrange.from ?? 'draft',
    } : null,
    round: e.round,
    breakUntil: e.breakUntil ?? null,
    pending: isHost && e.breakUntil ? pendingOf(e).map(p => matchView(e, p)) : null,
    matches: e.pairings.filter(p => p.posted).map(p => matchView(e, p)),
    standings: tourney ? standings(e.players, e.pairings) : [],
    myMatch: my ? matchView(e, my) : null,
  };
}

/** GET /api/cube/mine: the events I host or play in — not cancelled, and done ones for a week */
export function cubesFor(userId: string, now: number): CubeMine[] {
  return allCubes()
    .filter(e => (e.host === userId || !!playerOf(e, userId)) && e.phase !== 'cancelled'
      && !(e.phase === 'done' && now - (e.endedAt ?? now) > 7 * 24 * 3600_000))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(e => {
      const mine = e.pairings.filter(p => p.posted && !p.result && p.b !== null && involves(p, userId));
      const my = mine.find(p => !!liveMatch(p)) ?? mine[0];
      return {
        code: e.code, name: e.config.name, phase: e.phase, isHost: e.host === userId,
        players: e.players.filter(p => !p.dropped).length, maxPlayers: e.config.maxPlayers,
        startAt: e.config.startAt, myMatch: my ? matchView(e, my) : null,
      };
    });
}

export { getCube };
