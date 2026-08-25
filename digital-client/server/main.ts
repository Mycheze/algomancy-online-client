/* Algomancy game server (M2 slice): HTTP static host + WebSocket game loop.
 *
 * Server-authoritative: clients send an intended Action; the server checks the
 * action's seat matches the connection's seat, applies it through the pure
 * engine, then pushes to BOTH clients a per-seat REDACTED view + the new
 * (redacted) events + that seat's legalActions (computed server-side so the
 * client never needs hidden info to highlight plays).
 *
 * Scope is personal: a handful of players, join-by-room-code, no TLS. Accounts
 * (username + password, stats, achievements, friends) live in accounts.ts and
 * api-accounts.ts; the game loop only cares about them at two points — binding
 * a seat to an account on join, and recording the game when it ends.
 *
 *   npm install && node main.ts            # serves + listens on :8080
 *   PORT=9000 node main.ts                 # custom port
 */
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Action, CardName, Seat } from '../engine/src/types.ts';
import { checkDeck, forcedAction, legalActions, IllegalAction } from '../engine/src/apply.ts';
import { other, viewFor, redactEvent, redactLog, visibleToSeat } from './view.ts';
import { defaultDecks, importDeckText, importDeckUrl } from './decks.ts';
import {
  applyToRoom, arrivalVerdict, clockSnapshot, createRematch, decidedWinner, deferAction, getRoom,
  joinableRoom, legalForSeat, openSegment, renameSeat,
  reserveRoomCode, resolveLobby, roomExistsOrReserved, roomLobby,
  restoreRooms, roomWaiting, segmentKey, setLobbyMethod, setLobbySubmission, setRoomDeck,
  setSeatUser, settleClock, takeDeferred, undoForSeat, unlockLobby,
  type Room, type SegKey,
} from './rooms.ts';
import { METHOD_BLURBS, METHOD_LABELS, TRIO_METHODS, type TrioHistoryRow } from './trio.ts';
import { accountRoutes } from './api-accounts.ts';
import { ACHIEVEMENTS } from './achievements.ts';
import { accountById, accountForToken, gameHistory, loadAccounts, privateView } from './accounts.ts';
import { recordLiveGame, syncGamesDir } from './history.ts';
import { summarizeGame } from './stats.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(HERE, '..', 'engine', 'ui');
const GAMES_DIR = process.env['ALGO_GAMES_DIR'] ?? join(HERE, 'games');
/**
 * Where the 🐛 button's reports land. Overridable for the same reason
 * ALGO_GAMES_DIR and ALGO_ACCOUNTS_FILE are: this file is LIVE DATA on the
 * deploy box — it is the only copy of every playtest report ever filed — and
 * `npm test` has to be safe to run there. test-clock.ts posts two reports, and
 * before this existed it protected the real file by reading it into memory,
 * letting the server append to it, and writing the original back in a
 * `finally`. That works exactly until a run crashes or is killed between the
 * two, and then the reports are gone. Pointing the server somewhere else is
 * the version with no window.
 */
const ISSUES_FILE = process.env['ALGO_ISSUES_FILE'] ?? join(HERE, 'issues.jsonl');
const ART_DIR = join(HERE, '..', '..', 'AlgomancyCards');
const PORT = Number(process.env['PORT'] ?? 8080);

// ── who is logged in right now ────────────────────────────────────────
//
// Counted rather than flagged: the same account can have two tabs open (the
// share-link flow encourages exactly that), and the first one to close must
// not make its owner look offline to their friends list.

const onlineCount = new Map<string, number>();
const isOnline = (userId: string): boolean => (onlineCount.get(userId) ?? 0) > 0;
function markOnline(userId: string, delta: 1 | -1): void {
  const n = (onlineCount.get(userId) ?? 0) + delta;
  if (n > 0) onlineCount.set(userId, n); else onlineCount.delete(userId);
}

// ── static file server ────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveFile(res: import('node:http').ServerResponse, path: string): Promise<void> {
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}

/** Read and parse a JSON request body, capped — same reasoning as
 * api-accounts.ts readBody: an unbounded read on an open port is a gift to
 * anyone who finds it, even on a LAN. Rejects on oversize or bad JSON so
 * each route's own catch keeps its current error shape. */
function readJson(req: import('node:http').IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    let over = false;
    req.on('data', (c: Buffer) => {
      if (over) return;
      body += c;
      if (body.length > limit) { over = true; body = ''; }
    });
    req.on('end', () => {
      if (over) return reject(new Error(`body too large (over ${limit} bytes)`));
      try { resolve(JSON.parse(body || '{}') as Record<string, unknown>); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

/** Room codes: 4 letters, skipping easily-confused ones. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
function freshRoomCode(): string {
  for (let tries = 0; tries < 100; tries++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!getRoom(code)) return code;
  }
  return 'R' + Date.now().toString(36).toUpperCase().slice(-4);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  let path = decodeURIComponent(url.pathname);
  if (path === '/' || path === '') path = '/index.html';

  // accounts, stats, achievements and friends live in their own module; it
  // answers true when the request was one of its own
  if (await accountRoutes(req, res, path, url, { online: isOnline })) return;

  // home screen asks here for an unused room code. The room itself is only
  // created when the first player joins it over WS — but the code is RESERVED
  // here, and a reservation is the only thing that lets a join create a room
  // (rooms.ts). That is what makes a mistyped code an error instead of a new
  // empty game.
  if (path === '/api/new') {
    const code = freshRoomCode();
    reserveRoomCode(code);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ code }));
  }

  // playtest feedback: append one JSON line per report to ISSUES_FILE
  // (server/issues.jsonl unless ALGO_ISSUES_FILE says otherwise).
  // actionIndex = the room's action count at report time, so the moment can be
  // replayed later (replay-room.ts + slicing the action log).
  if (path === '/api/report' && req.method === 'POST') {
    try {
      const { room, seat, note } = await readJson(req) as { room?: string; seat?: number; note?: string };
      const code = String(room ?? '').toUpperCase().trim();
      const r = getRoom(code);   // unknown room: still log it (actionIndex null)
      const entry = {
        ts: new Date().toISOString(),
        room: code,
        seat: seat === 0 || seat === 1 ? seat : null,
        note: String(note ?? '').slice(0, 4000),
        actionIndex: r ? r.actions.length : null,
      };
      appendFileSync(ISSUES_FILE, JSON.stringify(entry) + '\n');
      console.log(`[report] ${entry.room || '(no room)'} seat ${entry.seat ?? '?'} @action ${entry.actionIndex ?? '?'}: ${entry.note}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(err instanceof Error ? err.message : err) }));
    }
    return;
  }

  // constructed: the bundled test decks (attributed to their builders)
  if (path === '/api/deck/defaults') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ decks: defaultDecks() }));
  }

  // constructed: turn an algomancer.cc link or a pasted list into engine
  // card names — { url } or { text } in, DeckInfo out (problems included)
  if (path === '/api/deck/import' && req.method === 'POST') {
    try {
      const { url: deckUrl, text } = await readJson(req) as { url?: string; text?: string };
      const deck = deckUrl
        ? await importDeckUrl(String(deckUrl))
        : importDeckText(String(text ?? ''));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, deck }));
    } catch (err) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(err instanceof Error ? err.message : err) }));
    }
    return;
  }

  // right-click card inspector: card info + recorded rulings from the bot
  if (path === '/api/cardinfo') {
    const name = url.searchParams.get('name') ?? '';
    try {
      const upstream = await fetch(`http://127.0.0.1:8000/api/card?name=${encodeURIComponent(name)}`, {
        signal: AbortSignal.timeout(10000),
      });
      const json = await upstream.text();
      res.writeHead(upstream.status, { 'content-type': 'application/json' });
      return res.end(json);
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ rulings: [], error: String(err instanceof Error ? err.message : err) }));
    }
  }

  // the in-game judge popup: proxy to the rules bot (same box, :8000) so the
  // client needs no CORS and no second origin
  if (path === '/api/judge' && req.method === 'POST') {
    try {
      const { question } = await readJson(req) as { question?: string };
      const upstream = await fetch('http://127.0.0.1:8000/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: String(question ?? '').slice(0, 2000), history: [] }),
        signal: AbortSignal.timeout(60000),
      });
      const json = await upstream.text();
      res.writeHead(upstream.status, { 'content-type': 'application/json' });
      res.end(json);
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ answer: `the judge is unreachable: ${err instanceof Error ? err.message : err}` }));
    }
    return;
  }

  // card art: the UI asks for /AlgomancyCards/<Name>.jpg
  if (path.startsWith('/AlgomancyCards/')) {
    const rel = normalize(path.slice('/AlgomancyCards/'.length)).replace(/^(\.\.[/\\])+/, '');
    return serveFile(res, join(ART_DIR, rel));
  }
  // the game's real icon set (element pips, cost circles, markers)
  if (path.startsWith('/Icons/')) {
    const rel = normalize(path.slice('/Icons/'.length)).replace(/^(\.\.[/\\])+/, '');
    return serveFile(res, join(HERE, '..', '..', 'Icons', rel));
  }
  // everything else is the client bundle in engine/ui
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, '');
  return serveFile(res, join(UI_DIR, rel));
});

// ── websocket game loop ───────────────────────────────────────────────

interface Conn { room: Room; seat: Seat; userId: string | null; }
const conns = new WeakMap<WebSocket, Conn>();

const send = (ws: WebSocket, obj: unknown): void => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
};

/** send() to whoever is connected on `seat`; a no-op for an empty chair. */
function sendToSeat(room: Room, seat: Seat, obj: unknown): void {
  const sock = room.sockets[seat];
  if (sock) send(sock, obj);
}

/** Both seats, in seat order. */
const forEachSeat = (fn: (seat: Seat) => void): void => { fn(0); fn(1); };

/** The fields every state push shares: redacted view, this seat's legal
 * actions, presence, clock. Each caller spreads its own extras on top — the
 * per-site drift (log replace vs incremental events, reveal, trio) is
 * deliberate, so it stays at the sites. */
function baseView(room: Room, seat: Seat) {
  return {
    view: viewFor(room.state, seat, room.segSnapshot),
    // R150/CT-32: `legalForSeat`, not `legalActions` — inside a hidden
    // simultaneous segment the OTHER seat's open decision must not empty this
    // seat's list. See rooms.ts for why the engine's global gate is right in
    // battle and wrong here.
    legal: legalForSeat(room.state, seat, room.segKey),
    peers: peersOf(room),
    clock: clockSnapshot(room),
  };
}

/** Drain the forced steps a state owes (an empty board "attacks"/"blocks" by
 * itself), appending their events to `into`. */
function drainForced(room: Room, into: import('../engine/src/types.ts').EngineEvent[]): void {
  for (let guard = 0; guard < 8; guard++) {
    const f = forcedAction(room.state);
    if (!f) break;
    into.push(...applyToRoom(room, f));
  }
}

/** Lobby state, attached to every message while the room is not a game yet.
 * Two kinds: a constructed room waiting for decks (`have`), and a draft room
 * choosing its trio (`trio`). undefined once the game is real.
 *
 * The other seat's SUBMISSION is deliberately absent — a pick you can see is
 * a pick you can counter, and the whole point of choosing blind is that you
 * each bring something you actually want. Only "are they locked in" travels. */
function waitingInfo(room: Room, seat: Seat): {
  have: [boolean, boolean];
  trio?: {
    method: string;
    methods: { id: string; label: string; blurb: string }[];
    locked: [boolean, boolean];
    /** your own submission, echoed back so a reconnect keeps your ranking */
    mine: unknown;
  };
} | undefined {
  if (!roomWaiting(room)) return undefined;
  const lobby = roomLobby(room);
  return {
    have: [!!room.decks[0], !!room.decks[1]],
    ...(lobby ? {
      trio: {
        method: lobby.method,
        // "run it back" only exists coming out of a game — offering it on a
        // fresh room would be a button with nothing behind it
        methods: TRIO_METHODS
          .filter(id => id !== 'again' || lobby.previousTrio?.length === 3)
          .map(id => ({
            id,
            label: id === 'again' && lobby.previousTrio
              ? `Run it back — ${lobby.previousTrio.join(' + ')}` : METHOD_LABELS[id],
            blurb: METHOD_BLURBS[id],
          })),
        locked: [...lobby.locked] as [boolean, boolean],
        mine: lobby.submissions[seat],
      },
    } : {}),
  };
}

/** Past games involving either seat, for the "something we have not played"
 * method. Falls back to matching on NAME for a seat that is not logged in —
 * a signed-out Ben should still not be handed the trio he played yesterday. */
function trioHistoryFor(room: Room): TrioHistoryRow[] {
  const ids = new Set(room.users.filter((u): u is string => !!u));
  const names = new Set(room.names.map(n => n.trim().toLowerCase()));
  return gameHistory()
    .filter(g =>
      g.users.some(u => u && ids.has(u))
      || g.names.some(n => names.has(n.trim().toLowerCase())))
    .map(g => ({ els: g.els, playedAt: g.playedAt }));
}

/** Push an update to one seat: redacted view (+optional events). Inside a
 * hidden segment the opponent's half of the view comes from the freeze. */
function sendUpdate(room: Room, seat: Seat, events: import('../engine/src/types.ts').EngineEvent[]): void {
  // still waiting for decks: no game to show — just the lobby state
  if (roomWaiting(room)) {
    sendToSeat(room, seat, { t: 'update', waiting: waitingInfo(room, seat), peers: peersOf(room), names: room.names });
    return;
  }
  sendToSeat(room, seat, {
    t: 'update',
    ...baseView(room, seat),
    ...(events.length ? { events: events.filter(e => visibleToSeat(e, seat)).map(e => redactEvent(e, seat, room.names)) } : {}),
  });
}

/** The segment-end flush: like sendUpdate, but the opponent's held (hidden)
 * events travel in a separate `reveal` field so the client can show a "here
 * is what your opponent did" interstitial before play continues.
 *
 * `step` says WHICH segment just closed — the client renders a 'plan' close as
 * log lines and board animation only (it fires every single turn and the
 * payload is resource lines), and keeps the modal for 'haste' and 'deploy'. */
function sendReveal(room: Room, seat: Seat, revealEvents: import('../engine/src/types.ts').EngineEvent[], tailEvents: import('../engine/src/types.ts').EngineEvent[], step: SegKey): void {
  sendToSeat(room, seat, {
    t: 'update',
    step,
    ...baseView(room, seat),
    reveal: revealEvents.filter(e => visibleToSeat(e, seat)).map(e => redactEvent(e, seat, room.names)),
    events: [...revealEvents, ...tailEvents].filter(e => visibleToSeat(e, seat)).map(e => redactEvent(e, seat, room.names)),
  });
}

/** Push the current authoritative state to one seat as a redacted resync. */
function pushView(room: Room, seat: Seat): void {
  sendUpdate(room, seat, []);
}

/**
 * The game just ended: fold it into both players' stats and tell them what it
 * unlocked.
 *
 * Called only on the transition to a winner, because the fold is a rebuild
 * over the whole history and is not something to run on every action. An
 * abandoned game (the common case for us) is picked up instead by the boot
 * sync over server/games/ — see history.ts.
 */
function recordFinishedGame(room: Room): void {
  const before = new Map<string, Set<string>>();
  for (const id of room.users) {
    const a = accountById(id);
    if (a) before.set(a.id, new Set(Object.keys(a.achievements)));
  }
  let row;
  try {
    row = recordLiveGame(room);
  } catch (err) {
    // stats must never cost anybody their game — log it, and still show them
    // the post-game screen below
    console.error(`[accounts] could not record ${room.code}:`, err);
  }
  if (row) {
    console.log(`[accounts] recorded ${room.code}: ${row.game.names.join(' vs ')}, ` +
      `${row.game.finished ? `${row.game.names[row.game.winner ?? 0]} won` : 'unfinished'}`);
  }
  for (const seat of [0, 1] as Seat[]) {
    const unlocked: { id: string; name: string; desc: string; icon: string }[] = [];
    const account = accountById(room.users[seat]);
    if (account) {
      const had = before.get(account.id) ?? new Set<string>();
      for (const id of Object.keys(account.achievements)) {
        if (had.has(id)) continue;
        const def = ACHIEVEMENTS.find(a => a.id === id);
        unlocked.push(def ? { id, name: def.name, desc: def.desc, icon: def.icon }
          : { id, name: id, desc: '', icon: '🏅' });
      }
    }
    sendGameOver(room, seat, { row: row?.game ?? null, unlocked, account });
  }
}

/**
 * The post-game screen's payload: who won, both players' numbers, and — if
 * you were logged in — what it did to your profile.
 *
 * Sent to everyone, account or not. The stats come from the same
 * summarizeGame() the record uses, so the screen and the profile can never
 * disagree about what just happened.
 */
function sendGameOver(room: Room, seat: Seat, extra: {
  row: import('./accounts.ts').RecordedGame | null;
  unlocked: { id: string; name: string; desc: string; icon: string }[];
  account: ReturnType<typeof accountById>;
}): void {
  // checked up front, not left to sendToSeat: summarizeRoom() replays the
  // whole game, which is not worth doing for an empty chair
  if (!room.sockets[seat]) return;
  const row = extra.row ?? summarizeRoom(room);
  sendToSeat(room, seat, {
    t: 'gameover',
    seat,
    winner: row.winner ?? decidedWinner(room),
    names: room.names,
    mode: room.mode,
    els: row.els,
    turns: row.turns,
    seats: row.seats,
    rematch: [...room.rematch],
    rematchRoom: room.rematchRoom,
    // "is this game in somebody's profile" — asked of the record, not of
    // whether THIS call did the recording. A rejoin into a game recorded an
    // hour ago must not tell you it went uncounted.
    recorded: gameHistory().some(g => g.code === room.code && g.users.some(u => !!u)),
    ...(extra.unlocked.length ? { unlocked: extra.unlocked } : {}),
    ...(extra.account ? { me: privateView(extra.account, isOnline) } : {}),
  });
}

/** A summary for a room we could not record (nobody logged in, or the record
 * threw) — the post-game screen still deserves real numbers. */
function summarizeRoom(room: Room): import('./accounts.ts').RecordedGame {
  const s = summarizeGame({
    code: room.code, seed: room.seed, mode: room.mode, els: room.els,
    names: room.names, actions: room.actions, winner: room.winner,
    decks: room.mode === 'constructed' ? room.decks : undefined,
  });
  return {
    code: s.code, playedAt: s.playedAt, recordedAt: s.playedAt, mode: s.mode,
    els: s.els, finished: s.finished, winner: s.winner, turns: s.turns,
    diverged: s.skipped > 0, users: [...room.users], names: [...room.names],
    seats: s.seats,
  };
}

/** Push the current rematch state to both seats. */
function broadcastRematch(room: Room): void {
  forEachSeat(seat => sendToSeat(room, seat, { t: 'rematch', rematch: [...room.rematch], room: room.rematchRoom }));
}

/** Push freshly-produced events + new state to both seats (per-seat redacted). */
function broadcastAfterAction(room: Room, rawEvents: import('../engine/src/types.ts').EngineEvent[]): void {
  forEachSeat(seat => sendUpdate(room, seat, rawEvents));
}

/** The log lines `seat` is currently allowed to see (the opponent's moves in
 * the open hidden segment are filtered out — they arrive with the reveal). */
function visibleLog(room: Room, seat: Seat): string[] {
  const held = new Set(room.heldEvents[seat]);
  return redactLog(room.events.filter(e => !held.has(e)), seat, room.names);
}

const peersOf = (room: Room): [boolean, boolean] => [!!room.sockets[0], !!room.sockets[1]];

/** Pick a seat for a joiner. A specifically-requested seat is granted even if
 * occupied (the old connection is kicked): with two known players, a stale tab
 * must never dead-end the real person behind "seat taken". Auto-join (no seat
 * requested) only takes a free seat. */
function pickSeat(room: Room, requested: number | undefined): { seat: Seat; kicked: WebSocket | null } | null {
  if (requested === 0 || requested === 1) {
    return { seat: requested as Seat, kicked: room.sockets[requested] };
  }
  if (!room.sockets[0]) return { seat: 0, kicked: null };
  if (!room.sockets[1]) return { seat: 1, kicked: null };
  return null;
}

const wss = new WebSocketServer({ server });
wss.on('error', err => console.error('[ws] server error:', err));

wss.on('connection', ws => {
  // without this, one malformed frame (say, invalid UTF-8 from a mangling
  // proxy) raises an unhandled 'error' event and takes down the whole
  // process — every game, not just the offending socket. Log and let the
  // library close the connection.
  ws.on('error', err => console.warn('[ws] socket error:', err instanceof Error ? err.message : err));
  ws.on('message', raw => {
    let msg: { t: string; room?: string; seat?: number; name?: string; mode?: string; els?: string[];
      token?: string; deck?: unknown; action?: Action; cols?: unknown; send?: unknown;
      method?: unknown; submission?: unknown; lock?: unknown; want?: unknown };
    try { msg = JSON.parse(String(raw)); } catch { return send(ws, { t: 'error', msg: 'bad JSON' }); }

    if (msg.t === 'join') {
      const code = (msg.room ?? '').toUpperCase().trim();
      if (!code) return send(ws, { t: 'error', msg: 'a room code is required' });
      // A code that names no room, and that we never minted, is a typo — say
      // so instead of quietly creating an empty game around it (playtest: two
      // of those ended up saved in games/, and the player thought they were in
      // their opponent's room the whole time).
      if (!roomExistsOrReserved(code)) {
        console.log(`[ws] join refused: no room ${code}`);
        return send(ws, { t: 'error', msg: `No game with code ${code}. Check the code with your opponent, or start a new game.` });
      }
      // a deck riding on the join (constructed): validate it up front — the
      // client sends its selected deck with every join and the server uses it
      // only where it matters (creating a constructed room / a waiting seat)
      let deckCards: CardName[] | null = null;
      if (msg.deck !== undefined) {
        const c = checkDeck(msg.deck);
        if (c.ok) deckCards = c.cards;
        else if (msg.mode === 'constructed' && !getRoom(code)) {
          return send(ws, { t: 'error', msg: `that deck is not playable: ${c.error}` });
        }
      }
      // mode + chosen trio only apply when this join CREATES the room (the
      // creator's link carries them); an existing room keeps its own.
      const mode = msg.mode === 'draft' ? 'draft' : msg.mode === 'constructed' ? 'constructed' : 'shared';
      if (mode === 'constructed' && !getRoom(code) && !deckCards) {
        return send(ws, { t: 'error', msg: 'a constructed game needs a deck — pick one on the home screen first' });
      }
      const room = joinableRoom(code, mode,
        Array.isArray(msg.els) ? (msg.els as import('../engine/src/types.ts').Element[]) : undefined,
        deckCards ?? undefined);
      // only reachable if the reservation expired between the check above and
      // here; treated exactly like a typo
      if (!room) return send(ws, { t: 'error', msg: `No game with code ${code}. Start a new game to create one.` });
      const picked = pickSeat(room, msg.seat);
      if (picked === null) {
        return send(ws, { t: 'error', msg: 'room is full (2 players) — ask your opponent for their seat link, or use a new room' });
      }
      const seat = picked.seat;
      // a re-join on the SAME connection (waiting room: "here is my deck now")
      // must not kick itself
      if (picked.kicked && picked.kicked !== ws) {
        send(picked.kicked, {
          t: 'kicked', msg: `another connection took over seat ${seat} — this tab is done (close it, or rejoin)`,
        });
        picked.kicked.close();
        console.log(`[ws] ${code}: seat ${seat} taken over by a new connection`);
      }
      // accounts: the join carries the browser's session token. A logged-in
      // player's ACCOUNT NAME wins over the typed name box — the name is what
      // the stats get filed under, so it must be the one thing it cannot
      // disagree with.
      const account = accountForToken(msg.token);
      const typed = typeof msg.name === 'string' ? msg.name.trim().slice(0, 24) : '';
      const name = account ? account.username : typed;
      if (name && name !== room.names[seat]) renameSeat(room, seat, name);
      setSeatUser(room, seat, account?.id ?? null);
      room.sockets[seat] = ws;
      const previous = conns.get(ws);
      if (previous?.userId) markOnline(previous.userId, -1);   // re-join on the same socket
      if (account) markOnline(account.id, 1);
      conns.set(ws, { room, seat, userId: account?.id ?? null });
      // constructed lobby: register this seat's deck; when it completes the
      // pair the real game is dealt and BOTH seats get a fresh 'joined'
      const gameJustStarted = roomWaiting(room) && deckCards
        ? setRoomDeck(room, seat as 0 | 1, deckCards) : false;
      settleClock(room);   // a connected seat with pending work goes on the clock
      const joinedMsg = (s: Seat): unknown => roomWaiting(room)
        ? {
            t: 'joined', room: code, seat: s,
            waiting: waitingInfo(room, s), peers: peersOf(room), names: room.names,
          }
        : {
            t: 'joined', room: code, seat: s,
            ...baseView(room, s),
            log: visibleLog(room, s),
            names: room.names,
            // a reconnect mid-declaration picks the opponent's half-built
            // formation straight back up instead of waiting for their next move
            building: room.building[other(s)],
          };
      send(ws, joinedMsg(seat));
      // the account payload rides along so a reconnecting client does not
      // need a second round trip to know who it is
      if (account) send(ws, { t: 'me', me: privateView(account, isOnline) });
      // rejoining a game that is already over: the post-game screen is the
      // screen for that room now, so send it rather than a dead board
      if (!roomWaiting(room) && decidedWinner(room) !== null) {
        sendGameOver(room, seat, { row: null, unlocked: [], account });
      }
      // let the other seat know a peer arrived (fresh view refreshes presence;
      // on game start they need the full reset, i.e. their own 'joined')
      const otherSeat = other(seat);
      if (room.sockets[otherSeat]) {
        if (gameJustStarted) sendToSeat(room, otherSeat, joinedMsg(otherSeat));
        else pushView(room, otherSeat);
      }
      console.log(`[ws] ${code}: seat ${seat} joined${roomWaiting(room) ? ' (waiting for decks)' : gameJustStarted ? ' (constructed game started)' : ''}`);
      return;
    }

    // ── post-game: another one? ──
    if (msg.t === 'rematch') {
      const conn = conns.get(ws);
      if (!conn) return send(ws, { t: 'error', msg: 'join a room first' });
      const room = conn.room;
      // already moved: a late clicker follows their opponent rather than
      // starting a second, empty rematch
      if (room.rematchRoom) {
        return send(ws, { t: 'rematch', rematch: [...room.rematch], room: room.rematchRoom });
      }
      if (decidedWinner(room) === null) {
        return send(ws, { t: 'error', msg: 'the game is not over yet' });
      }
      room.rematch[conn.seat] = msg.want !== false;
      if (room.rematch[0] && room.rematch[1]) {
        // createRematch registers the room outright, so there is nothing to
        // reserve — a reservation is only for codes a join has yet to claim
        const next = createRematch(room, freshRoomCode());
        console.log(`[ws] ${room.code}: rematch → ${next.code} (${next.mode})`);
      }
      broadcastRematch(room);
      return;
    }

    // ── the draft lobby: choosing the trio, before there is a game ──
    if (msg.t === 'lobby') {
      const conn = conns.get(ws);
      if (!conn) return send(ws, { t: 'error', msg: 'join a room first' });
      const room = conn.room;
      const lobby = roomLobby(room);
      if (!lobby) return send(ws, { t: 'error', msg: 'this room is past choosing its elements' });

      if (msg.method !== undefined) setLobbyMethod(room, msg.method);
      else if (msg.lock === false) unlockLobby(room, conn.seat as 0 | 1);
      else setLobbySubmission(room, conn.seat as 0 | 1, msg.submission, msg.lock !== false);

      // both locked in: decide, deal, and tell them how it went
      const result = resolveLobby(room, trioHistoryFor(room));
      if (result) {
        // the working goes into the game log, where both players can read it
        // after the fact — a trio nobody can audit is a trio somebody
        // suspects, and this one is decided by a seeded draw they cannot see
        room.events.push({
          type: 'info',
          msg: `Trio: ${result.els.join(' + ')} — ${result.how}. ${result.detail.join(' ')}`,
          data: { els: result.els },
        } as unknown as import('../engine/src/types.ts').EngineEvent);
        settleClock(room);
        console.log(`[ws] ${room.code}: trio ${result.els.join('+')} (${lobby.method})`);
        forEachSeat(s => sendToSeat(room, s, {
          t: 'joined', room: room.code, seat: s,
          ...baseView(room, s),
          log: visibleLog(room, s),
          names: room.names, building: null,
          trio: { els: result.els, how: result.how, detail: result.detail },
        }));
        return;
      }
      forEachSeat(s => pushView(room, s));
      return;
    }

    if (msg.t === 'action') {
      const conn = conns.get(ws);
      if (!conn) return send(ws, { t: 'error', msg: 'join a room first' });
      const action = msg.action;
      if (roomWaiting(conn.room)) return send(ws, { t: 'error', msg: 'the game has not started — waiting for both decks' });
      if (!action || typeof action !== 'object') return send(ws, { t: 'error', msg: 'no action' });
      if (action.seat !== conn.seat) {
        return send(ws, { t: 'error', msg: `you are seat ${conn.seat}, not seat ${action.seat}` });
      }
      try {
        const room = conn.room;
        // which hidden segment (if any) this action was taken INSIDE
        const wasKey = room.segKey;
        // R150/CT-32: an opponent's open decision inside a hidden simultaneous
        // segment PARKS this action instead of getting it refused by the
        // engine's global decision gate. Nothing goes back on the wire: the
        // client's own send-latch already paints "Sent — waiting for the
        // server…", which is the truth, and leaving the latch on is also what
        // stops the player double-sending the same deploy while it waits.
        if (arrivalVerdict(room.state, action, wasKey, room.deferred[conn.seat]!.length) === 'defer') {
          deferAction(room, action);
          return;
        }
        const hadWinner = room.state.winner !== null;
        // the committed declaration supersedes every in-progress one
        room.building = [null, null];
        const events = applyToRoom(room, action);
        drainForced(room, events);
        // …and now that this action may have CLOSED a decision, whatever the
        // other seat parked behind it lands, in arrival order. Their events are
        // kept separate: inside a segment they are still hidden from this seat
        // (applyToRoom has already put them in the held queue for the reveal),
        // so they must not ride out on this seat's update.
        const oppEvents: import('../engine/src/types.ts').EngineEvent[] = [];
        for (const parked of takeDeferred(room)) {
          // a parked action can itself open a decision for its own seat, which
          // re-parks whatever was queued behind it for the other one
          if (arrivalVerdict(room.state, parked, segmentKey(room.state),
            room.deferred[parked.seat]!.length) === 'defer') {
            deferAction(room, parked);
            continue;
          }
          const into = parked.seat === conn.seat ? events : oppEvents;
          try {
            into.push(...applyToRoom(room, parked));
            drainForced(room, into);
          } catch (err) {
            // the world moved under it while it waited — the same refusal the
            // player would have got instantly, told to the seat it belongs to
            if (!(err instanceof IllegalAction)) throw err;
            sendToSeat(room, parked.seat, { t: 'error', msg: err.message });
          }
        }
        // ONE rule for all three hidden segments: the key changed → flush the
        // old segment's reveal, snapshot the new one. (Note that 'deploy' →
        // 'plan' is a close and an immediate re-open on the SAME action —
        // doneDeploying runs endTurn and startTurn — which this handles for
        // free where a deploy-shaped special case could not.)
        const nowKey = segmentKey(room.state);
        if (wasKey === nowKey) {
          if (wasKey) {
            // still inside the same hidden segment: each seat sees their own
            // events (the other seat's parked actions are theirs, and stay
            // held); a seat with nothing of its own gets a view refresh only,
            // because their half is frozen but the done-flags are public
            sendUpdate(room, conn.seat, events);
            sendUpdate(room, other(conn.seat), oppEvents);
          } else {
            broadcastAfterAction(room, [...events, ...oppEvents]);
          }
        } else {
          const opp = other(conn.seat);
          // the segment is over, so everything applied this tick is public —
          // both seats' own final events (incl. the step/turn end) are the
          // tail of the reveal; split them out so it holds only what was
          // actually hidden
          const tail = [...events, ...oppEvents];
          const theirsHeld = wasKey ? room.heldEvents[opp]!.filter(e => !tail.includes(e)) : [];
          const mineHeld = wasKey ? room.heldEvents[conn.seat]!.filter(e => !tail.includes(e)) : [];
          // a parked action cannot survive the segment it was taken in: refuse
          // it rather than let it land in a phase its author never saw
          for (const seat of [0, 1] as Seat[]) {
            for (const lost of room.deferred[seat]!) {
              sendToSeat(room, seat, { t: 'error', msg: `${lost.type} was still waiting when the step ended` });
            }
          }
          room.deferred = [[], []];
          openSegment(room);   // close the old freeze, open the new one
          if (wasKey) {
            sendReveal(room, conn.seat, mineHeld, tail, wasKey);
            sendReveal(room, opp, theirsHeld, tail, wasKey);
          } else {
            broadcastAfterAction(room, tail);
          }
        }
        // the transition into a decided game — record it once
        if (!hadWinner && room.state.winner !== null) recordFinishedGame(room);
      } catch (err) {
        if (err instanceof IllegalAction) send(ws, { t: 'error', msg: err.message });
        else { console.error('[ws] apply error:', err); send(ws, { t: 'error', msg: 'internal error' }); }
      }
      return;
    }

    // The formation a seat is building, relayed to the other seat as they
    // build it (rooms.ts Room.building). Not an action: it never touches the
    // engine, never enters the log, and is dropped the moment a real action
    // lands. Sizes are capped so a rogue client cannot use it as a firehose.
    if (msg.t === 'building') {
      const conn = conns.get(ws);
      if (!conn || roomWaiting(conn.room)) return;
      const raw = msg;
      const ids = (v: unknown, max: number): number[] => (Array.isArray(v) ? v : [])
        .filter((n): n is number => Number.isInteger(n)).slice(0, max);
      const cols = (Array.isArray(raw.cols) ? raw.cols : []).slice(0, 12).map(c => ids(c, 2));
      const built = { cols, send: ids(raw.send, 12) };
      const empty = !built.cols.some(c => c.length) && !built.send.length;
      conn.room.building[conn.seat] = empty ? null : built;
      sendToSeat(conn.room, other(conn.seat), { t: 'building', seat: conn.seat, ...(empty ? { cols: [], send: [] } : built) });
      return;
    }

    if (msg.t === 'undo') {
      // single-step undo (docs/07 §15): only during the solo phases, and only
      // when the most recent action in the whole log is yours — anything the
      // opponent has acted on top of stays put.
      const conn = conns.get(ws);
      if (!conn) return send(ws, { t: 'error', msg: 'join a room first' });
      const room = conn.room;
      if (roomWaiting(room)) return send(ws, { t: 'error', msg: 'the game has not started — nothing to undo' });
      // THE WHOLE DECISION lives in rooms.ts (undoForSeat), not here. It is
      // the piece ledger #37 and then #76 were both about, and a decision
      // that only exists inside a WebSocket message handler can only be
      // tested by playing a whole game over a socket — which is why #37's
      // guards pinned the segment machinery and never the take-back itself.
      const outcome = undoForSeat(room, conn.seat);
      if (!outcome.ok) return send(ws, { t: 'error', msg: outcome.why });
      // Playtest VEAV: "I was able to see in the deployment recap that 'Rashi
      // undid an action.' No need to show that to the other person, it's just
      // confusing, since you can't see what they undid." It is not a move —
      // it is the ABSENCE of one, and the log already shows the absence. So
      // the note is `privateTo` the seat that pressed the button: it never
      // enters the opponent's log, held or revealed (view.ts visibleToSeat).
      // It still goes on room.events so the actor's own full-log replace below
      // (and any later resync) keeps it.
      const note = {
        type: 'note', msg: `${room.names[conn.seat]} undid their last action.`,
        data: { privateTo: conn.seat },
      } as unknown as import('../engine/src/types.ts').EngineEvent;
      room.events.push(note);
      forEachSeat(s => sendToSeat(room, s, {
        t: 'update',
        ...baseView(room, s),
        log: visibleLog(room, s),   // full log replace: lines were removed
      }));
      return;
    }

    send(ws, { t: 'error', msg: `unknown message ${msg.t}` });
  });

  ws.on('close', () => {
    const conn = conns.get(ws);
    if (!conn) return;
    if (conn.userId) markOnline(conn.userId, -1);
    if (conn.room.sockets[conn.seat] === ws) {
      conn.room.sockets[conn.seat] = null;
      settleClock(conn.room);   // a disconnected seat is not billed
    }
    const otherSeat = other(conn.seat);
    if (conn.room.sockets[otherSeat]) pushView(conn.room, otherSeat);
    console.log(`[ws] ${conn.room.code}: seat ${conn.seat} left`);
  });
});

loadAccounts();
restoreRooms();
// Every saved game becomes a match-history row and feeds the players' stats,
// finished or not — most of ours end when somebody has to go, and those games
// still happened. Cheap after the first pass: a game whose file has not been
// written since we last read it is skipped (history.ts).
{
  const t0 = Date.now();
  const report = syncGamesDir(GAMES_DIR);
  if (report.added || report.updated) {
    console.log(`[accounts] history sync: ${report.added} new, ${report.updated} updated ` +
      `(${Date.now() - t0}ms)`);
  }
}
server.listen(PORT, () => {
  console.log(`Algomancy server on http://localhost:${PORT}  (open it, or /?ws=1&room=CODE&seat=0)`);
});
