/* Competitive Constructed — THE MATCH (docs/22 §2, §5).
 *
 * A match is one game or best of three (CR 901.9). Every game is an ordinary
 * room (rooms.ts) carrying `room.match = {id, game}` and `room.rules`; the
 * match record (match-store.ts) carries everything that lasts between games.
 * This module is the only place the two meet: rooms.ts must not import it
 * (it imports rooms.ts), so what rooms.ts needs from a match is INJECTED
 * (`setRoomHeld`), and what this module needs from the socket layer is
 * injected the other way (`setMatchHooks`, main.ts).
 *
 * THE FLOW (§5.2):
 *
 *   game 1    the creator's join makes the match and room 1; each seat
 *             REGISTERS a main deck + sideboard (checkMatchDeck); the second
 *             registration deals it, initiative rolled.
 *   decided   `matchGameDecided` (main.ts recordFinishedGame, which a win, a
 *             concede and a flag all reach): the score moves, the banks are
 *             written, and either the match is over or the NEXT game's room is
 *             created at once — a constructed room waiting on both decks.
 *   between   in that waiting room: a 120 s sideboarding window from the moment
 *             both seats are in it (CR D8.6b). Each seat's configuration is
 *             checked with checkSwap and kept only when legal, so "an illegal
 *             one falls back to the last legal one" holds by construction. The
 *             previous game's loser readies WITH the initiative choice (owner,
 *             §8 answer 1: two Ready buttons); both Ready deals at once. At the
 *             lock the configurations are final and the deal waits on the
 *             loser's choice alone, untimed — the server never chooses for them.
 *   paused    by mutual agreement, between games only; held through restarts
 *             and the idle sweep; resumed with both present and both asking,
 *             the window restarting at the full 120 s; void at 7 days.
 *   over      a game score reached, a match concede (in a game or between), or
 *             a flag — running out of time loses the MATCH (owner, §0).
 */
import type { CardName, Seat } from '../engine/src/types.ts';
import { applyPreset, checkMatchDeck, checkSwap, type MatchConfig } from '../engine/src/matchdeck.ts';
import { matchDeckForPlay } from './collection.ts';
import {
  MATCH_CLOCK_MS, closeMatchRoom, createRoom, decidedWinner, getRoom, roomWaiting, setRoomDeck,
  setRoomHeld, setSeatUser, settleClock, touchRoom, type Room,
} from './rooms.ts';
import {
  allMatches, copyConfig, getMatch, matchOpen, matchScore, newMatchId, saveMatch,
  type Match, type MatchGame, type Registered,
} from './match-store.ts';

/** CR D8.6b: the sideboarding window */
export const SIDEBOARD_WINDOW_MS = 120_000;
/** owner, §0: a paused match closes with no result after 7 days */
export const PAUSE_LIMIT_MS = 7 * 24 * 3600_000;

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

/** What the socket layer does for a match. main.ts sets it once at boot; a
 * test sets its own. Every hook is fire-and-forget: a match transition has
 * already been saved when one is called. */
export interface MatchHooks {
  /** a fresh, unused room code (main.ts freshRoomCode) */
  code(): string;
  /** a game was just dealt in this room — both seats need their 'joined' */
  dealt(room: Room): void;
  /** this room's between-games state changed — push both seats the lobby */
  lobby(room: Room): void;
  /** a game of the match just ended (`from`), and the match moved to `next`
   *  (null when it is over or void) — tell the seats where to go */
  moved(m: Match, from: Room | null, next: Room | null): void;
  /** land a concede for `seat` through the ordinary action path */
  concede(room: Room, seat: Seat): void;
  /** the match is over or void (W4: the league report and the rating fold) */
  ended(m: Match): void;
}
const NO_HOOKS: MatchHooks = {
  code: () => { throw new Error('match hooks not set'); },
  dealt: () => {}, lobby: () => {}, moved: () => {}, concede: () => {}, ended: () => {},
};
let hooks: MatchHooks = NO_HOOKS;
export function setMatchHooks(h: Partial<MatchHooks>): void { hooks = { ...NO_HOOKS, ...h }; }

/**
 * W4's hook (docs/22 §2.5, §6.2): is this match's LEAGUE week over? A league
 * CC match that is not in a live game when its league match already carries a
 * result is voided by the sweep ("league matches also close at league-week
 * end"). Nothing is a league match until W4 opens one, so the default says no.
 */
let leagueWeekClosed: (m: Match) => boolean = () => false;
export function setLeagueWeekClosed(fn: (m: Match) => boolean): void { leagueWeekClosed = fn; }

// a paused match's waiting room is not the idle sweep's to close (§2.5)
setRoomHeld(room => {
  const m = matchOfRoom(room);
  return !!m && m.phase === 'paused' && m.between?.code === room.code;
});

export const matchOfRoom = (room: Pick<Room, 'match'> | null | undefined): Match | undefined => getMatch(room?.match?.id);

export type MatchOutcome = { ok: true } | { ok: false; why: string };
const no = (why: string): MatchOutcome => ({ ok: false, why });

/* ── GAME 1 ────────────────────────────────────────────────────────────── */

/**
 * What a seat registers for a match (docs/22 §5.1): a SAVED deck, re-read from
 * the account and checked with checkMatchDeck (collection.ts matchDeckForPlay),
 * with its presets; or, with no deck id, a main + sideboard off the wire,
 * checked the same way and carrying no presets.
 */
export function registrationFor(userId: string, deckId: unknown, deck: unknown, side: unknown): Registered | { error: string } {
  if (typeof deckId === 'string' && deckId) {
    const d = matchDeckForPlay(userId, deckId);
    if (!d) return { error: 'that deck is not legal for Competitive Constructed — check its sideboard and copies in the deck builder' };
    return { main: d.main, side: d.side, deckId: d.id, presets: d.presets };
  }
  const c = checkMatchDeck(deck, side ?? []);
  return c.ok
    ? { main: c.main, side: c.side, deckId: null, presets: [] }
    : { error: `that deck is not legal for Competitive Constructed: ${c.error}` };
}

/** a match's first id, for the creating join to stamp on room 1 before the
 * room exists (rooms.ts joinableRoom's `cc`) */
export const reserveMatchId = (): string => newMatchId();

/**
 * Make the match around its freshly created room 1 (main.ts, the creating
 * join). The room already carries `rules: {sequential}` and `match: {id, 1}`.
 */
export function startMatch(room: Room, id: string, bestOf: 1 | 3, now = Date.now()): Match {
  const m: Match = {
    id, bestOf, users: [null, null], names: [...room.names] as [string, string], createdAt: now,
    registered: [null, null], current: [null, null], games: [],
    banks: [...room.clockMs] as [number, number], clockStart: room.clockStart ?? MATCH_CLOCK_MS.constructed,
    phase: 'game', room: room.code,
  };
  saveMatch(m);
  return m;
}

/**
 * A seat registers (or, until the deal, re-registers) for game 1. The second
 * registration deals it: the initiative is rolled (CR 901.9d's game 1).
 * Returns whether this registration dealt the game.
 */
export function registerSeat(room: Room, seat: Seat, userId: string, name: string, reg: Registered): { ok: true; dealt: boolean } | { ok: false; why: string } {
  const m = matchOfRoom(room);
  if (!m || !matchOpen(m)) return { ok: false, why: 'this match is not open' };
  if (room.match?.game !== 1 || m.phase !== 'game' || !roomWaiting(room)) {
    return { ok: false, why: 'decks are registered before game 1 only — between games you sideboard' };
  }
  m.registered[seat] = { ...reg, main: [...reg.main], side: [...reg.side], presets: reg.presets.map(p => ({ ...p, out: [...p.out], in: [...p.in] })) };
  m.current[seat] = copyConfig(reg);
  m.users[seat] = userId;
  m.names[seat] = name;
  saveMatch(m);
  const dealt = setRoomDeck(room, seat as 0 | 1, reg.main, reg.deckId);
  return { ok: true, dealt };
}

/* ── A GAME ENDS ───────────────────────────────────────────────────────── */

/** how this room's game was decided */
function howDecided(room: Room): MatchGame['how'] {
  // a flag is STAMPED, never logged (rooms.ts expireOnTime): the board does
  // not know, and the note says so
  const onTime = room.state.winner === null && room.events.some(e => {
    const n = e as unknown as { type?: unknown; data?: { onTime?: unknown } };
    return n.type === 'note' && n.data?.onTime === true;
  });
  if (onTime) return 'time';
  return room.concession ? 'conceded' : 'played';
}

/**
 * docs/22 §5.5 — THE ONE CHOKE POINT. main.ts recordFinishedGame calls this
 * first, and a win, a concede and a flag all reach recordFinishedGame. The
 * score moves, the banks are written (after settleClock), and the match is
 * either decided or moves on: the next game's room is created at once (§2.4).
 * Idempotent — a room already recorded is a no-op, which is what lets the
 * boot reconcile call it again after a crash between the two writes.
 */
export function matchGameDecided(room: Room, now = Date.now()): Match | undefined {
  const m = matchOfRoom(room);
  if (!m || !matchOpen(m) || m.phase !== 'game' || m.room !== room.code) return m;
  if (m.games.some(g => g.code === room.code)) return m;
  const winner = decidedWinner(room);
  if (winner === null) return m;
  settleClock(room);
  m.banks = [...room.clockMs] as [number, number];
  const how = howDecided(room);
  m.games.push({ code: room.code, initiative: room.state.initiative, winner, how, at: now });
  const score = matchScore(m);
  const need = m.bestOf === 3 ? 2 : 1;
  if (m.concedeBy !== undefined) {
    finish(m, other(m.concedeBy), 'conceded', now, m.concedeBy, room);
  } else if (how === 'time') {
    // the owner, §0: running out of time loses the MATCH
    finish(m, winner, 'time', now, undefined, room);
  } else if (score[winner]! >= need) {
    finish(m, winner, 'games', now, undefined, room);
  } else {
    nextGame(m, room, winner, now);
  }
  return m;
}

/** game k+1's room, created now: waiting on both decks, the banks carried */
function nextGame(m: Match, from: Room, winner: Seat, now: number): Room {
  const code = hooks.code();
  const next = createRoom(code, (Math.random() * 1e9) >>> 0, [...m.names] as [string, string], 'constructed',
    undefined, undefined, undefined, m.clockStart, undefined, false, {
      rules: { sequential: true }, match: { id: m.id, game: m.games.length + 1 },
      clockMs: [...m.banks] as [number, number], users: [...m.users] as [string | null, string | null],
      ...(m.league ? { league: m.league } : {}), ...(m.rated ? { rated: true } : {}),
    });
  m.phase = 'between';
  m.room = code;
  // §8 answer 3: the configurations carry over as they are (game 3 starts
  // from game 2's); the loser of the game just played chooses
  m.between = { code, chooser: other(winner), initiative: null, ready: [false, false], until: null, locked: false };
  delete m.pause;
  saveMatch(m);
  console.log(`[match] ${m.id}: game ${m.games.length} to ${m.names[winner]} (${matchScore(m).join('-')}) → game ${m.games.length + 1} in ${code}`);
  hooks.moved(m, from, next);
  // both seats may already be standing in it (a restart, a fast click)
  openWindowIfPresent(m, next, now);
  return next;
}

/** the match is decided: stamp it, close a between room, tell everybody */
function finish(m: Match, winner: Seat, how: 'games' | 'conceded' | 'time', now: number, concededBy?: Seat, from?: Room): void {
  const waiting = m.phase === 'between' || m.phase === 'paused' ? getRoom(m.between?.code ?? '') : undefined;
  m.phase = 'over';
  m.result = { winner, how, at: now, ...(concededBy !== undefined ? { concededBy } : {}) };
  m.endedAt = now;
  delete m.between;
  delete m.pause;
  delete m.concedeBy;
  saveMatch(m);
  console.log(`[match] ${m.id}: over — ${m.names[winner]} wins (${how}, ${matchScore(m).join('-')})`);
  hooks.moved(m, from ?? waiting ?? null, null);
  if (waiting) closeMatchRoom(waiting, 'match', now);
  hooks.ended(m);
}

/** no result: the games already played stay in history as single games */
export function voidMatch(m: Match, why: string, now = Date.now()): void {
  if (!matchOpen(m)) return;
  const room = getRoom(m.room);
  m.phase = 'void';
  m.voided = { at: now, why };
  m.endedAt = now;
  delete m.between;
  delete m.pause;
  delete m.concedeBy;
  saveMatch(m);
  console.log(`[match] ${m.id}: void — ${why}`);
  hooks.moved(m, room ?? null, null);
  // a room still waiting for a deal is closed; a game in progress is not
  // (the sweep voids only matches that are not in a live game)
  if (room && roomWaiting(room)) closeMatchRoom(room, 'void', now);
  hooks.ended(m);
}

/* ── BETWEEN GAMES ─────────────────────────────────────────────────────── */

/** the match, if `room` is its between-games room right now */
function betweenOf(room: Room): Match | undefined {
  const m = matchOfRoom(room);
  return m && (m.phase === 'between' || m.phase === 'paused') && m.between?.code === room.code ? m : undefined;
}

/** CR D8.6b: the window opens when both seats are in the room, so a slow
 * redirect does not cost anybody their sideboarding */
export function openWindowIfPresent(m: Match, room: Room, now = Date.now()): boolean {
  const b = m.between;
  if (m.phase !== 'between' || !b || b.code !== room.code || b.until !== null || b.locked) return false;
  if (!room.sockets[0] || !room.sockets[1]) return false;
  b.until = now + SIDEBOARD_WINDOW_MS;
  saveMatch(m);
  hooks.lobby(room);
  return true;
}

/** deal the next game from the locked configurations, on the chooser's choice */
function deal(m: Match, room: Room): void {
  const b = m.between!;
  const c0 = m.current[0], c1 = m.current[1];
  if (b.initiative === null || !c0 || !c1) return;
  // part of the deal: the chosen seat holds the initiative (the roll is still
  // drawn — engine createGame — so the shuffle is the seed's)
  room.rules = { sequential: true, initiative: b.initiative };
  setRoomDeck(room, 0, c0.main, m.registered[0]?.deckId ?? null);
  setRoomDeck(room, 1, c1.main, m.registered[1]?.deckId ?? null);
  m.phase = 'game';
  m.room = room.code;
  delete m.between;
  delete m.pause;
  saveMatch(m);
  console.log(`[match] ${m.id}: game ${room.match?.game} dealt in ${room.code}, ${m.names[room.state.initiative]} has the initiative`);
  hooks.dealt(room);
}

/** CR D8.6b: the window locks. What is set is what is played; the deal waits
 * only on the chooser's initiative choice, which nothing makes for them. */
function lockWindow(m: Match, room: Room): void {
  const b = m.between!;
  b.locked = true;
  b.until = null;
  // the offer lapses if the window locks first (§5.7)
  delete m.pause;
  if (b.initiative !== null) return deal(m, room);
  saveMatch(m);
  hooks.lobby(room);
}

/**
 * A seat's between-games request (main.ts `{t:'cc', op, …}`, docs/22 §5.8).
 * One entry so every op is refused in the same words when the room is not a
 * match's between room.
 */
export function matchOp(room: Room, seat: Seat, op: string, msg: Record<string, unknown>, now = Date.now()): MatchOutcome {
  const m = betweenOf(room);
  if (!m) return no('there is no match waiting between games in this room');
  const b = m.between!;
  const touch = (): MatchOutcome => { saveMatch(m); hooks.lobby(room); return { ok: true }; };

  if (op === 'resume') {
    if (m.phase !== 'paused') return no('the match is not paused');
    if (!room.sockets[0] || !room.sockets[1]) return no('both players must be here to resume');
    const p = m.pause ?? { offeredBy: null, pausedAt: now, resume: [false, false] as [boolean, boolean] };
    p.resume[seat] = true;
    m.pause = p;
    if (p.resume[0] && p.resume[1]) {
      // §5.7: exactly where it stood — the configurations, the initiative
      // choice once made, the score and the banks — with a full window
      m.phase = 'between';
      delete m.pause;
      b.ready = [false, false];
      b.until = now + SIDEBOARD_WINDOW_MS;
      touchRoom(room, now);
    }
    return touch();
  }
  if (m.phase === 'paused') return no('the match is paused — resume it first');

  if (op === 'pause') {
    if (b.locked) return no('the sideboarding window has closed — the next game is about to start');
    const offeredBy = m.pause?.offeredBy ?? null;
    if (offeredBy === null || offeredBy === seat) {
      m.pause = { offeredBy: seat, pausedAt: null, resume: [false, false] };
      return touch();
    }
    // the other seat offered: this is the agreement
    m.phase = 'paused';
    m.pause = { offeredBy: null, pausedAt: now, resume: [false, false] };
    b.until = null;
    b.ready = [false, false];
    // the 7-day restore window and the 7-day void now lapse together
    touchRoom(room, now);
    return touch();
  }
  if (op === 'unpause') {
    // withdraw an offer, or decline the other seat's
    if (!m.pause) return no('no pause has been offered');
    delete m.pause;
    return touch();
  }
  if (op === 'config' || op === 'preset') {
    if (b.locked) return no('the sideboarding window has closed — what was set is what is played');
    const reg = m.registered[seat];
    if (!reg) return no('you have no registered deck in this match');
    let next: MatchConfig;
    if (op === 'preset') {
      const id = msg['preset'];
      if (id === null || id === undefined || id === 'registered') next = copyConfig(reg);
      else {
        const p = reg.presets.find(x => x.id === id);
        if (!p) return no('no such swap on your deck');
        const r = applyPreset(reg, p);
        if ('error' in r) return no(`that swap cannot be used: ${r.error}`);
        next = r;
      }
    } else {
      next = { main: msg['main'] as CardName[], side: msg['side'] as CardName[] };
    }
    // checkSwap: the same cards as registered, main ≥ 30, side ≤ 7, the copy
    // cap over both (CR 901.9c). An illegal one is REFUSED and `current` keeps
    // the last legal one — so the lock can only ever deal a legal deck.
    const c = checkSwap(reg, next);
    if (!c.ok) return no(c.error);
    m.current[seat] = { main: c.main, side: c.side };
    b.ready[seat] = false;   // a changed deck is not the one they readied
    return touch();
  }
  if (op === 'ready') {
    const want = msg['ready'] !== false;
    const choice = msg['initiative'];
    const chose = choice === 0 || choice === 1 ? (choice as Seat) : null;
    if (b.locked) {
      // §8 answer 1: after the lock only the chooser's choice is left
      if (seat !== b.chooser) return no('waiting for your opponent to choose who takes the initiative');
      if (chose === null) return no('choose who takes the initiative');
      b.initiative = chose;
      b.ready[seat] = true;
      deal(m, room);
      return { ok: true };
    }
    if (!want) { b.ready[seat] = false; return touch(); }
    if (seat === b.chooser) {
      // the loser's Ready CARRIES the initiative choice — two Ready buttons,
      // no default (D1.2)
      if (chose === null) return no('you lost the last game — ready up with your choice of who takes the initiative');
      b.initiative = chose;
    }
    b.ready[seat] = true;
    if (b.ready[0] && b.ready[1] && b.initiative !== null) { deal(m, room); return { ok: true }; }
    return touch();
  }
  return no(`unknown match request ${op}`);
}

/**
 * docs/22 §5.5 — CONCEDE THE MATCH, in a game or between games, through ONE
 * function so the two cannot drift. In a game the concede is a real action
 * (the game's log records its own loss), and the match is stamped when that
 * game's end is recorded (matchGameDecided reads `concedeBy`). Between games,
 * paused, or before game 1 is dealt, the result is stamped directly.
 */
export function concedeMatch(room: Room, seat: Seat, now = Date.now()): MatchOutcome {
  const m = matchOfRoom(room);
  if (!m || !matchOpen(m)) return no('this match is already over');
  // which seat of the MATCH this is: seats never move between its games
  if (m.users[seat] !== null && room.users[seat] !== m.users[seat]) return no('you are not playing this match');
  const live = m.phase === 'game' ? getRoom(m.room) : undefined;
  if (live && !roomWaiting(live) && decidedWinner(live) === null) {
    m.concedeBy = seat;
    saveMatch(m);
    try { hooks.concede(live, seat); } catch (err) { console.error(`[match] ${m.id}: the concede could not land:`, err); }
    // a game that would not take the concede (a frozen one) still loses the match
    if (matchOpen(m)) finish(m, other(seat), 'conceded', now, seat, live);
    return { ok: true };
  }
  finish(m, other(seat), 'conceded', now, seat, room);
  // game 1 not yet dealt: its waiting room goes too
  if (live && roomWaiting(live)) closeMatchRoom(live, 'match', now);
  return { ok: true };
}

/* ── THE SWEEP, AND THE BOOT ───────────────────────────────────────────── */

/**
 * On main.ts's one-second tick: open a window both seats are now in, lock one
 * that has run out, and void what has lapsed (§2.5) — a pause past 7 days, a
 * league match whose week has closed, a match whose current room has gone.
 */
export function sweepMatches(now = Date.now()): void {
  for (const m of allMatches()) {
    if (!matchOpen(m)) continue;
    const room = getRoom(m.room);
    if (!room) { voidMatch(m, m.phase === 'game' ? 'its game room closed' : 'its waiting room closed', now); continue; }
    if (m.phase === 'paused') {
      if (now - (m.pause?.pausedAt ?? now) >= PAUSE_LIMIT_MS) voidMatch(m, 'paused for 7 days', now);
      else if (leagueWeekClosed(m)) voidMatch(m, 'its league week closed', now);
      continue;
    }
    if (m.phase === 'between') {
      if (leagueWeekClosed(m)) { voidMatch(m, 'its league week closed', now); continue; }
      const last = m.games.at(-1)?.at ?? m.createdAt;
      if (now - last >= PAUSE_LIMIT_MS) { voidMatch(m, 'no game for 7 days', now); continue; }
      const b = m.between!;
      if (b.until === null && !b.locked) openWindowIfPresent(m, room, now);
      else if (b.until !== null && !b.locked && now >= b.until) lockWindow(m, room);
    }
  }
}

/**
 * Boot, after restoreRooms (§2.5, Risk 4): a game decided just before a crash
 * whose match never moved on is moved on now — matchGameDecided is idempotent,
 * so a crash on either side of either write lands in the same place. Then the
 * ordinary sweep voids whatever lapsed while the server was down.
 */
export function reconcileMatches(now = Date.now()): void {
  for (const m of allMatches()) {
    if (!matchOpen(m) || m.phase !== 'game') continue;
    const room = getRoom(m.room);
    if (room && decidedWinner(room) !== null) matchGameDecided(room, now);
  }
  sweepMatches(now);
}

/* ── WHAT EACH SEAT IS SENT ────────────────────────────────────────────── */

/**
 * docs/22 §5.3 — `waitingInfo(...).match`. Built per seat. THE OPPONENT'S
 * CONFIGURATION, SIDEBOARD, PRESETS AND DECK ID ARE NEVER IN IT: `ready` is
 * the only thing said about their deck (test 820 asserts it over the wire).
 */
export interface MatchLobbyInfo {
  id: string; bestOf: 1 | 3;
  /** the game about to be dealt, 1-based */
  game: number;
  score: [number, number]; names: [string, string];
  /** the frozen chess clocks, ms, and the match's bank ("of 45:00") */
  banks: [number, number]; clockStart: number;
  phase: Match['phase'];
  /** the previous game's loser (null before game 1) and their choice, public once made */
  chooser: Seat | null; initiative: Seat | null;
  /** the window's deadline (null: not open yet, paused, or locked) */
  until: number | null;
  /** the window has locked and the deal waits on the chooser alone */
  locked: boolean;
  ready: [boolean, boolean];
  /** this seat's own deck — null before it has registered one */
  mine: { registered: MatchConfig; current: MatchConfig; presets: Registered['presets'] } | null;
  pause?: { offeredBy: Seat | null; pausedAt: number | null; resume: [boolean, boolean] };
  result?: Match['result'];
}

export function matchLobbyInfo(room: Room, seat: Seat): MatchLobbyInfo | undefined {
  const m = matchOfRoom(room);
  if (!m || !room.match) return undefined;
  const reg = m.registered[seat];
  const cur = m.current[seat];
  const b = m.between?.code === room.code ? m.between : undefined;
  return {
    id: m.id, bestOf: m.bestOf, game: room.match.game,
    score: matchScore(m), names: [...m.names] as [string, string],
    banks: [...m.banks] as [number, number], clockStart: m.clockStart,
    phase: m.phase,
    chooser: b?.chooser ?? null, initiative: b?.initiative ?? null,
    until: b?.until ?? null, locked: b?.locked ?? false,
    // game 1: "ready" is "has registered"
    ready: b ? [...b.ready] as [boolean, boolean] : [!!m.registered[0], !!m.registered[1]],
    mine: reg && cur ? {
      registered: { main: [...reg.main], side: [...reg.side] },
      current: { main: [...cur.main], side: [...cur.side] },
      presets: reg.presets.map(p => ({ ...p, out: [...p.out], in: [...p.in] })),
    } : null,
    ...(m.pause ? { pause: { offeredBy: m.pause.offeredBy, pausedAt: m.pause.pausedAt, resume: [...m.pause.resume] as [boolean, boolean] } } : {}),
    ...(m.result ? { result: { ...m.result } } : {}),
  };
}

/** the in-game chip and the post-game screen: public facts only */
export function matchSummary(m: Match): { id: string; bestOf: 1 | 3; score: [number, number]; game: number; phase: Match['phase']; room: string; result?: Match['result']; voided?: Match['voided'] } {
  return {
    id: m.id, bestOf: m.bestOf, score: matchScore(m), game: m.games.length + (m.phase === 'over' || m.phase === 'void' ? 0 : 1),
    phase: m.phase, room: m.room,
    ...(m.result ? { result: { ...m.result } } : {}), ...(m.voided ? { voided: { ...m.voided } } : {}),
  };
}

/** docs/22 §5.6 — the "Your matches" row: this account's open matches */
export function matchesFor(userId: string): Array<{
  id: string; bestOf: 1 | 3; seat: Seat; opponent: string; score: [number, number]; game: number;
  phase: Match['phase']; room: string; pausedAt: number | null; until: number | null; voidAt: number | null;
}> {
  const out = [];
  for (const m of allMatches()) {
    if (!matchOpen(m)) continue;
    const seat = m.users[0] === userId ? 0 : m.users[1] === userId ? 1 : null;
    if (seat === null) continue;
    const pausedAt = m.phase === 'paused' ? m.pause?.pausedAt ?? null : null;
    out.push({
      id: m.id, bestOf: m.bestOf, seat, opponent: m.names[other(seat)] ?? '', score: matchScore(m),
      game: m.games.length + 1, phase: m.phase, room: m.room, pausedAt,
      until: m.between?.until ?? null, voidAt: pausedAt === null ? null : pausedAt + PAUSE_LIMIT_MS,
    });
  }
  return out.sort((a, b) => a.id < b.id ? -1 : 1);
}

/**
 * docs/22 §2.6 — NO MID-MATCH PEEKING. Is this room (by its file's `match`)
 * part of a match that is still open? A replay of any of its games, and a
 * live watch of its room, are refused to its players until it is over or void.
 */
export function matchStillOpen(raw: unknown): Match | undefined {
  const id = (raw as { id?: unknown } | null | undefined)?.id;
  const m = typeof id === 'string' ? getMatch(id) : undefined;
  return m && matchOpen(m) ? m : undefined;
}

/** does this account play in this match? */
export const playsIn = (m: Match, userId: string | null | undefined): boolean =>
  !!userId && (m.users[0] === userId || m.users[1] === userId);

/** after a seat (re)joins a match room: open the window if both are now here */
export function matchSeatJoined(room: Room, now = Date.now()): void {
  const m = betweenOf(room);
  if (m) openWindowIfPresent(m, room, now);
}

/** the seat users of a game room must be the match's (createRoom stamps them;
 * a test that builds a room by hand uses this) */
export function stampUsers(room: Room, m: Match): void {
  for (const s of [0, 1] as const) if (m.users[s]) setSeatUser(room, s, m.users[s]);
}
