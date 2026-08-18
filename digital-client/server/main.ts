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
import { legalActions, IllegalAction } from '../engine/src/apply.ts';
import { viewFor, redactEvent, redactLog } from './view.ts';
import {
  applyToRoom, getOrCreateRoom, getRoom, renameSeat, restoreRooms, undoLastAction,
  type Room, type Socket,
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

  // card art: the UI asks for /AlgomancyCards/<Name>.jpg
  if (path.startsWith('/AlgomancyCards/')) {
    const rel = normalize(path.slice('/AlgomancyCards/'.length)).replace(/^(\.\.[/\\])+/, '');
    return serveFile(res, join(ART_DIR, rel));
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

/** Push the current authoritative state to one seat as a redacted resync. */
function pushView(room: Room, seat: Seat): void {
  const sock = room.sockets[seat] as unknown as WebSocket | null;
  if (!sock) return;
  send(sock, {
    t: 'update',
    view: viewFor(room.state, seat),
    legal: legalActions(room.state, seat),
    peers: peersOf(room),
  });
}

/** Push freshly-produced events + new state to both seats (per-seat redacted). */
function broadcastAfterAction(room: Room, rawEvents: import('../engine/src/types.ts').EngineEvent[]): void {
  for (const seat of [0, 1] as Seat[]) {
    const sock = room.sockets[seat] as unknown as WebSocket | null;
    if (!sock) continue;
    send(sock, {
      t: 'update',
      view: viewFor(room.state, seat),
      events: rawEvents.map(e => redactEvent(e, seat, room.names)),
      legal: legalActions(room.state, seat),
      peers: peersOf(room),
    });
  }
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
    let msg: { t: string; room?: string; seat?: number; name?: string; action?: Action };
    try { msg = JSON.parse(String(raw)); } catch { return send(ws, { t: 'error', msg: 'bad JSON' }); }

    if (msg.t === 'join') {
      const code = (msg.room ?? '').toUpperCase().trim();
      if (!code) return send(ws, { t: 'error', msg: 'a room code is required' });
      const room = getOrCreateRoom(code);
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
        view: viewFor(room.state, seat),
        log: redactLog(room.events, seat, room.names),
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
        const events = applyToRoom(conn.room, action);
        broadcastAfterAction(conn.room, events);
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
      const last = room.actions[room.actions.length - 1];
      if (!last) return send(ws, { t: 'error', msg: 'nothing to undo' });
      if (last.seat !== conn.seat) return send(ws, { t: 'error', msg: 'your opponent acted since — nothing of yours to undo' });
      undoLastAction(room);
      room.events.push({
        type: 'note', msg: `${room.names[conn.seat]} undid their last action.`, data: {},
      } as unknown as import('../engine/src/types.ts').EngineEvent);
      for (const s of [0, 1] as Seat[]) {
        const sock = room.sockets[s] as unknown as WebSocket | null;
        if (!sock) continue;
        send(sock, {
          t: 'update',
          view: viewFor(room.state, s),
          log: redactLog(room.events, s, room.names),   // full log replace: lines were removed
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
