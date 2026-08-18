/* Algomancy game server (M2 slice): HTTP static host + WebSocket game loop.
 *
 * Server-authoritative: clients send an intended Action; the server checks the
 * action's seat matches the connection's seat, applies it through the pure
 * engine, then pushes to BOTH clients a per-seat REDACTED view + the new
 * (redacted) events + that seat's legalActions (computed server-side so the
 * client never needs hidden info to highlight plays).
 *
 * Scope is personal: two players, join-by-room-code, no accounts, no TLS.
 *
 *   npm install && node main.ts            # serves + listens on :8080
 *   PORT=9000 node main.ts                 # custom port
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Action, Seat } from '../engine/src/types.ts';
import { forcedAction, legalActions, IllegalAction } from '../engine/src/apply.ts';
import { viewFor, redactEvent, redactLog } from './view.ts';
import {
  applyToRoom, clearDeployHold, getOrCreateRoom, getRoom, renameSeat, restoreRooms,
  undoActionAt, undoLastAction, type Room, type Socket,
} from './rooms.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(HERE, '..', 'engine', 'ui');
const ART_DIR = join(HERE, '..', '..', 'AlgomancyCards');
const PORT = Number(process.env['PORT'] ?? 8080);

// ── static file server ────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
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

  // home screen asks here for an unused room code (the room itself is only
  // created when the first player joins it over WS).
  if (path === '/api/new') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ code: freshRoomCode() }));
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
    let body = '';
    req.on('data', (c: Buffer) => { body += c; });
    req.on('end', async () => {
      try {
        const { question } = JSON.parse(body || '{}') as { question?: string };
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
    });
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

interface Conn { room: Room; seat: Seat; }
const conns = new WeakMap<WebSocket, Conn>();

const send = (ws: WebSocket, obj: unknown): void => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
};

/** Push an update to one seat: redacted view (+optional events). During
 * deployment the opponent's half of the view comes from the freeze. */
function sendUpdate(room: Room, seat: Seat, events: import('../engine/src/types.ts').EngineEvent[]): void {
  const sock = room.sockets[seat] as unknown as WebSocket | null;
  if (!sock) return;
  send(sock, {
    t: 'update',
    view: viewFor(room.state, seat, room.deploySnapshot),
    ...(events.length ? { events: events.map(e => redactEvent(e, seat, room.names)) } : {}),
    legal: legalActions(room.state, seat),
    peers: peersOf(room),
  });
}

/** The deploy-end flush: like sendUpdate, but the opponent's held (hidden)
 * deploy events travel in a separate `reveal` field so the client can show
 * a "here is what your opponent did" interstitial before play continues. */
function sendReveal(room: Room, seat: Seat, revealEvents: import('../engine/src/types.ts').EngineEvent[], tailEvents: import('../engine/src/types.ts').EngineEvent[]): void {
  const sock = room.sockets[seat] as unknown as WebSocket | null;
  if (!sock) return;
  send(sock, {
    t: 'update',
    view: viewFor(room.state, seat, room.deploySnapshot),
    reveal: revealEvents.map(e => redactEvent(e, seat, room.names)),
    events: [...revealEvents, ...tailEvents].map(e => redactEvent(e, seat, room.names)),
    legal: legalActions(room.state, seat),
    peers: peersOf(room),
  });
}

/** Push the current authoritative state to one seat as a redacted resync. */
function pushView(room: Room, seat: Seat): void {
  sendUpdate(room, seat, []);
}

/** Push freshly-produced events + new state to both seats (per-seat redacted). */
function broadcastAfterAction(room: Room, rawEvents: import('../engine/src/types.ts').EngineEvent[]): void {
  for (const seat of [0, 1] as Seat[]) sendUpdate(room, seat, rawEvents);
}

/** The log lines `seat` is currently allowed to see (opponent deploy moves
 * still hidden this phase are filtered out — they arrive with the reveal). */
function visibleLog(room: Room, seat: Seat): string[] {
  const held = new Set(room.heldDeploy[seat]);
  return redactLog(room.events.filter(e => !held.has(e)), seat, room.names);
}

const peersOf = (room: Room): [boolean, boolean] => [!!room.sockets[0], !!room.sockets[1]];

/** Pick a seat for a joiner. A specifically-requested seat is granted even if
 * occupied (the old connection is kicked): with two known players, a stale tab
 * must never dead-end the real person behind "seat taken". Auto-join (no seat
 * requested) only takes a free seat. */
function pickSeat(room: Room, requested: number | undefined): { seat: Seat; kicked: Socket | null } | null {
  if (requested === 0 || requested === 1) {
    return { seat: requested as Seat, kicked: room.sockets[requested] };
  }
  if (!room.sockets[0]) return { seat: 0, kicked: null };
  if (!room.sockets[1]) return { seat: 1, kicked: null };
  return null;
}

const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg: { t: string; room?: string; seat?: number; name?: string; mode?: string; els?: string[]; action?: Action };
    try { msg = JSON.parse(String(raw)); } catch { return send(ws, { t: 'error', msg: 'bad JSON' }); }

    if (msg.t === 'join') {
      const code = (msg.room ?? '').toUpperCase().trim();
      if (!code) return send(ws, { t: 'error', msg: 'a room code is required' });
      // mode + chosen trio only apply when this join CREATES the room (the
      // creator's link carries them); an existing room keeps its own.
      const room = getOrCreateRoom(code, msg.mode === 'draft' ? 'draft' : 'shared',
        Array.isArray(msg.els) ? (msg.els as import('../engine/src/types.ts').Element[]) : undefined);
      const picked = pickSeat(room, msg.seat);
      if (picked === null) {
        return send(ws, { t: 'error', msg: 'room is full (2 players) — ask your opponent for their seat link, or use a new room' });
      }
      const seat = picked.seat;
      if (picked.kicked) {
        send(picked.kicked as unknown as WebSocket, {
          t: 'kicked', msg: `another connection took over seat ${seat} — this tab is done (close it, or rejoin)`,
        });
        (picked.kicked as unknown as WebSocket).close();
        console.log(`[ws] ${code}: seat ${seat} taken over by a new connection`);
      }
      const name = typeof msg.name === 'string' ? msg.name.trim().slice(0, 24) : '';
      if (name) renameSeat(room, seat, name);
      room.sockets[seat] = ws as unknown as Socket;
      conns.set(ws, { room, seat });
      send(ws, {
        t: 'joined',
        room: code, seat,
        view: viewFor(room.state, seat, room.deploySnapshot),
        log: visibleLog(room, seat),
        legal: legalActions(room.state, seat),
        peers: peersOf(room),
        names: room.names,
      });
      // let the other seat know a peer arrived (fresh view refreshes presence)
      const otherSeat = (seat === 0 ? 1 : 0) as Seat;
      if (room.sockets[otherSeat]) pushView(room, otherSeat);
      console.log(`[ws] ${code}: seat ${seat} joined`);
      return;
    }

    if (msg.t === 'action') {
      const conn = conns.get(ws);
      if (!conn) return send(ws, { t: 'error', msg: 'join a room first' });
      const action = msg.action;
      if (!action || typeof action !== 'object') return send(ws, { t: 'error', msg: 'no action' });
      if (action.seat !== conn.seat) {
        return send(ws, { t: 'error', msg: `you are seat ${conn.seat}, not seat ${action.seat}` });
      }
      try {
        const room = conn.room;
        const wasDeploy = room.state.phase === 'deploy';
        const events = applyToRoom(room, action);
        // drain forced steps (an empty board "attacks"/"blocks" by itself)
        for (let guard = 0; guard < 8; guard++) {
          const f = forcedAction(room.state);
          if (!f) break;
          events.push(...applyToRoom(room, f));
        }
        const isDeploy = room.state.phase === 'deploy';
        if (wasDeploy && isDeploy) {
          // hidden simultaneous deployment: the actor sees their own events;
          // the opponent gets a view refresh only (their half is frozen, but
          // the done-flags are public)
          sendUpdate(room, conn.seat, events);
          sendUpdate(room, (conn.seat === 0 ? 1 : 0) as Seat, []);
        } else if (wasDeploy && !isDeploy) {
          // deployment just ended: flush each seat's held opponent events as
          // a REVEAL (the client shows them as "what your opponent did" and
          // waits for acknowledgement) followed by the turn-end events
          const opp = (conn.seat === 0 ? 1 : 0) as Seat;
          // the actor's own final events (incl. turn end) are the tail of the
          // opponent's held queue; split them out so the reveal holds only
          // the ACTOR's hidden deploy moves
          const theirsHeld = room.heldDeploy[opp].filter(e => !events.includes(e));
          const mineHeld = [...room.heldDeploy[conn.seat]];
          clearDeployHold(room);
          sendReveal(room, conn.seat, mineHeld, events);
          sendReveal(room, opp, theirsHeld, events);
        } else {
          broadcastAfterAction(room, events);
        }
      } catch (err) {
        if (err instanceof IllegalAction) send(ws, { t: 'error', msg: err.message });
        else { console.error('[ws] apply error:', err); send(ws, { t: 'error', msg: 'internal error' }); }
      }
      return;
    }

    if (msg.t === 'undo') {
      // single-step undo (docs/07 §15): only during the solo phases, and only
      // when the most recent action in the whole log is yours — anything the
      // opponent has acted on top of stays put.
      const conn = conns.get(ws);
      if (!conn) return send(ws, { t: 'error', msg: 'join a room first' });
      const room = conn.room;
      const phase = room.state.phase;
      if (phase !== 'planning' && phase !== 'deploy') {
        return send(ws, { t: 'error', msg: 'undo only works during planning and deploy' });
      }
      if (phase === 'deploy') {
        // simultaneous deployment: your last action may not be the last one
        // overall (the opponent acts in parallel, hidden). Deploy actions are
        // seat-independent, so your own most recent action WITHIN the deploy
        // segment can be spliced out safely.
        let i = room.actions.length - 1;
        while (i >= room.deployStartIndex && i >= 0 && room.actions[i]!.seat !== conn.seat) i--;
        if (i < room.deployStartIndex || i < 0 || room.deployStartIndex < 0) {
          return send(ws, { t: 'error', msg: 'nothing of yours to undo this phase' });
        }
        undoActionAt(room, i);
      } else {
        const last = room.actions[room.actions.length - 1];
        if (!last) return send(ws, { t: 'error', msg: 'nothing to undo' });
        if (last.seat !== conn.seat) return send(ws, { t: 'error', msg: 'your opponent acted since — nothing of yours to undo' });
        undoLastAction(room);
      }
      room.events.push({
        type: 'note', msg: `${room.names[conn.seat]} undid their last action.`, data: {},
      } as unknown as import('../engine/src/types.ts').EngineEvent);
      for (const s of [0, 1] as Seat[]) {
        const sock = room.sockets[s] as unknown as WebSocket | null;
        if (!sock) continue;
        send(sock, {
          t: 'update',
          view: viewFor(room.state, s, room.deploySnapshot),
          log: visibleLog(room, s),   // full log replace: lines were removed
          legal: legalActions(room.state, s),
          peers: peersOf(room),
        });
      }
      return;
    }

    send(ws, { t: 'error', msg: `unknown message ${msg.t}` });
  });

  ws.on('close', () => {
    const conn = conns.get(ws);
    if (!conn) return;
    if (conn.room.sockets[conn.seat] === (ws as unknown as Socket)) {
      conn.room.sockets[conn.seat] = null;
    }
    const otherSeat = (conn.seat === 0 ? 1 : 0) as Seat;
    if (conn.room.sockets[otherSeat]) pushView(conn.room, otherSeat);
    console.log(`[ws] ${conn.room.code}: seat ${conn.seat} left`);
  });
});

restoreRooms();
server.listen(PORT, () => {
  console.log(`Algomancy server on http://localhost:${PORT}  (open it, or /?ws=1&room=CODE&seat=0)`);
});
