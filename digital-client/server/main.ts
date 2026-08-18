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
  applyToRoom, getOrCreateRoom, getRoom, restoreRooms, type Room, type Socket,
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  let path = decodeURIComponent(url.pathname);
  if (path === '/' || path === '') path = '/index.html';

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

function pickSeat(room: Room, requested: number | undefined): Seat | null {
  if (requested === 0 || requested === 1) {
    return room.sockets[requested] ? null : (requested as Seat);
  }
  if (!room.sockets[0]) return 0;
  if (!room.sockets[1]) return 1;
  return null;
}

const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg: { t: string; room?: string; seat?: number; action?: Action };
    try { msg = JSON.parse(String(raw)); } catch { return send(ws, { t: 'error', msg: 'bad JSON' }); }

    if (msg.t === 'join') {
      const code = (msg.room ?? '').toUpperCase().trim();
      if (!code) return send(ws, { t: 'error', msg: 'a room code is required' });
      const room = getOrCreateRoom(code);
      const seat = pickSeat(room, msg.seat);
      if (seat === null) {
        return send(ws, { t: 'error', msg: msg.seat != null ? `seat ${msg.seat} is taken` : 'room is full (2 players)' });
      }
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
