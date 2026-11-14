/* CUBE DRAFT EVENTS — the HTTP routes and the room-less socket channel (docs/25 §9).
 *
 * HTTP (bearer token; every route but the GET of one event needs a signed-in account, 401 'log in first'):
 *   POST /api/cube/new {config}            → {ok, code}
 *   GET  /api/cube/mine                    → {ok, events: CubeMine[]}
 *   GET  /api/cube/<code>                  → {ok, view: CubeView}   (a reload before the socket is up;
 *                                            signed out too: the public view, me null)
 *   POST /api/cube/<code>/join | /leave
 *   POST /api/cube/<code>/deck {main, side}  submit
 *   POST /api/cube/<code>/suggest          → {ok, main, side}       autoBuild of my pool
 *   POST /api/cube/<code>/arrange {piles, names?, side, maybe} → {ok}  my deck table's layout
 *   POST /api/cube/<code>/ready {on}       exhibition
 *   POST /api/cube/<code>/play {pairing?}  → {ok, room, pairing}    open or reuse my match room
 *   host: /start, /config {config}, /kick {user}, /pairings {swap: [u1, u2]}, /post,
 *         /result {pairing, outcome}, /drop {user, on}, /end, /cancel   (403 to anyone else)
 * Every op answers {ok: true, view} on success (the caller's fresh view) or {ok: false, error}.
 *
 * SOCKET. Handled in main.ts ABOVE `join`, like the queue — a socket on the event page is in no
 * room. `{t:'cube', op:'sub', code, token}` subscribes it to ONE event (a second sub moves it);
 * `unsub`; `reserve` / `pick` {card}. The server pushes `{t:'cube', view}` on every change, and
 * `{t:'cube', matched}` when a pairing including that account is posted or exhibition pairs them.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WebSocket } from 'ws';
import { addrOf, json, rateLimited, readBody, str, tokenOf } from './api-util.ts';
import { accountForToken } from './accounts.ts';
import {
  arrangeCards, cancelCube, configCube, createCube, cubesFor, endCube, getCube, hostDrop, joinCube, kickPlayer, leaveCube,
  parseOutcome, pickCard, playMatch, postNow, reserveCard, setReady, setResult, startCube, submitDeck,
  suggestDeck, swapPairing, viewFor, type Actor, type Op,
} from './cube.ts';
import type { CubeEvent, CubeMatchView } from './cube-types.ts';

const CODE = /^[A-Z0-9]{1,12}$/;

export async function cubeRoutes(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (!path.startsWith('/api/cube/') && path !== '/api/cube') return false;
  const acct = accountForToken(tokenOf(req));
  if (!acct) {
    // Signed out, one thing answers: an event's view, as the socket's `sub` already gives it
    // (`me` null, `joined` false — no draft, no pool, no deck). The Join box asks this to tell
    // an event's code from a room's, and the event page then says "Sign in to join".
    const pub = req.method === 'GET' ? /^\/api\/cube\/([A-Za-z0-9]{1,12})$/.exec(path) : null;
    const pc = pub && pub[1] !== 'mine' ? pub[1]!.toUpperCase() : null;
    if (pc !== null) {
      const pe = getCube(pc);
      if (!pe) return json(res, { ok: false, error: `No event with code ${pc}.` }, 404), true;
      return json(res, { ok: true, view: viewFor(pe, null, Date.now()) }), true;
    }
    return json(res, { ok: false, error: 'log in first' }, 401), true;
  }
  const me: Actor = { id: acct.id, username: acct.username };
  const now = Date.now();

  if (path === '/api/cube/mine' && req.method === 'GET') {
    return json(res, { ok: true, events: cubesFor(me.id, now) }), true;
  }
  if (path === '/api/cube/new' && req.method === 'POST') {
    if (rateLimited(addrOf(req), 'cube-new', 10, 3600_000)) {
      return json(res, { ok: false, error: 'too many new events — wait a while' }, 429), true;
    }
    const b = await readBody(req, 512 * 1024);
    const r = createCube(me, b['config'] ?? b, now);
    if (!r.ok) return json(res, { ok: false, error: r.error }, r.status), true;
    return json(res, { ok: true, code: r.code, view: viewFor(getCube(r.code)!, me.id, now) }), true;
  }

  const m = /^\/api\/cube\/([A-Za-z0-9]{1,12})(?:\/([a-z]+))?$/.exec(path);
  if (!m) return json(res, { ok: false, error: `no such endpoint: ${path}` }, 404), true;
  const code = m[1]!.toUpperCase();
  const op = m[2] ?? '';
  const e = CODE.test(code) ? getCube(code) : undefined;
  if (!e) return json(res, { ok: false, error: `No event with code ${code}.` }, 404), true;

  if (!op && req.method === 'GET') return json(res, { ok: true, view: viewFor(e, me.id, now) }), true;
  if (req.method !== 'POST') return json(res, { ok: false, error: 'POST it' }, 405), true;
  const b = await readBody(req, 512 * 1024);
  const answer = (r: Op<object>, extra: Record<string, unknown> = {}): true => {
    if (!r.ok) return json(res, { ok: false, error: r.error }, r.status), true;
    const { ok: _ok, ...rest } = r as { ok: true } & Record<string, unknown>;
    return json(res, { ok: true, ...rest, ...extra, view: viewFor(e, me.id, Date.now()) }), true;
  };
  const user = str(b['user'], 64);
  switch (op) {
    case 'join': return answer(joinCube(e, me, now));
    case 'leave': return answer(leaveCube(e, me, now));
    case 'deck': return answer(submitDeck(e, me.id, b['main'], b['side'], now));
    case 'suggest': return answer(suggestDeck(e, me.id));
    // the deck table's layout: saved, answered without a view (the table that sent it shows it already)
    case 'arrange': {
      const r = arrangeCards(e, me.id, b);
      return r.ok ? json(res, { ok: true }) : json(res, { ok: false, error: r.error }, r.status), true;
    }
    case 'ready': return answer(setReady(e, me.id, b['on'] !== false, now));
    case 'play': return answer(playMatch(e, me.id, typeof b['pairing'] === 'string' ? b['pairing'] : null, now));
    case 'start': return answer(startCube(e, me, now));
    case 'config': return answer(configCube(e, me, b['config'] ?? b, now));
    case 'kick': return answer(kickPlayer(e, me, user, now));
    case 'drop': return answer(hostDrop(e, me, user, b['on'] !== false, now));
    case 'post': return answer(postNow(e, me, now));
    case 'end': return answer(endCube(e, me, now));
    case 'cancel': return answer(cancelCube(e, me, now));
    case 'pairings': {
      const sw = Array.isArray(b['swap']) ? b['swap'] : [b['a'], b['b']];
      return answer(swapPairing(e, me, str(sw[0], 64), str(sw[1], 64), now));
    }
    case 'result': {
      const outcome = parseOutcome(b['outcome']);
      if (!outcome) return json(res, { ok: false, error: 'say who won, a draw, or clear' }, 400), true;
      return answer(setResult(e, me, str(b['pairing'], 32), outcome, now));
    }
  }
  return json(res, { ok: false, error: `no such endpoint: ${path}` }, 404), true;
}

/* ── THE SOCKET ─────────────────────────────────────────────────────────── */

/** who is watching which event: socket → {code, user}; and per event, its sockets */
const subs = new Map<WebSocket, { code: string; user: string | null }>();
const byEvent = new Map<string, Set<WebSocket>>();

const sendTo = (ws: WebSocket, obj: unknown): void => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
};

function unsub(ws: WebSocket): void {
  const s = subs.get(ws);
  if (!s) return;
  subs.delete(ws);
  const set = byEvent.get(s.code);
  set?.delete(ws);
  if (set && !set.size) byEvent.delete(s.code);
}

/** is this socket on the cube channel? (main.ts: such a socket is in no room) */
export const cubeSubscribed = (ws: WebSocket): boolean => subs.has(ws);

/** main.ts, above `join`: one `{t:'cube', …}` message */
export function cubeSocketMessage(ws: WebSocket, msg: Record<string, unknown>): void {
  const op = String(msg['op'] ?? '');
  const now = Date.now();
  if (op === 'sub') {
    const code = String(msg['code'] ?? '').toUpperCase().trim();
    const e = CODE.test(code) ? getCube(code) : undefined;
    if (!e) return sendTo(ws, { t: 'cube', error: `No event with code ${code}.` });
    const who = accountForToken(typeof msg['token'] === 'string' ? msg['token'] : undefined);
    unsub(ws);
    subs.set(ws, { code: e.code, user: who?.id ?? null });
    let set = byEvent.get(e.code);
    if (!set) byEvent.set(e.code, set = new Set());
    set.add(ws);
    return sendTo(ws, { t: 'cube', view: viewFor(e, who?.id ?? null, now) });
  }
  if (op === 'unsub') { unsub(ws); return; }
  if (op === 'reserve' || op === 'pick') {
    const s = subs.get(ws);
    const e = s ? getCube(s.code) : undefined;
    if (!s || !e) return sendTo(ws, { t: 'cube', error: 'open the event first' });
    if (!s.user) return sendTo(ws, { t: 'cube', error: 'log in first' });
    const card = String(msg['card'] ?? '');
    const r = op === 'pick' ? pickCard(e, s.user, card, now) : reserveCard(e, s.user, card);
    if (!r.ok) {
      sendTo(ws, { t: 'cube', error: r.error });
      // and the truth, so a stale screen (a pack already gone) puts itself right
      sendTo(ws, { t: 'cube', view: viewFor(e, s.user, now) });
    }
    return;
  }
  sendTo(ws, { t: 'cube', error: `unknown cube request ${op}` });
}

/** main.ts's close handler */
export function cubeSocketClosed(ws: WebSocket): void { unsub(ws); }

/** cube.ts `changed`: each subscriber of the event its own view (`only`: one account's sockets) */
export function pushCube(e: CubeEvent, only?: string): void {
  const set = byEvent.get(e.code);
  if (!set) return;
  const now = Date.now();
  const views = new Map<string | null, unknown>();
  for (const ws of set) {
    const s = subs.get(ws);
    if (!s || (only && s.user !== only)) continue;
    let v = views.get(s.user);
    if (!v) views.set(s.user, v = { t: 'cube', view: viewFor(e, s.user, now) });
    sendTo(ws, v);
  }
}

/** cube.ts `matched`: to that account's sockets on this event */
export function pushMatched(e: CubeEvent, user: string, match: CubeMatchView): void {
  for (const ws of byEvent.get(e.code) ?? []) {
    if (subs.get(ws)?.user === user) sendTo(ws, { t: 'cube', matched: match });
  }
}
