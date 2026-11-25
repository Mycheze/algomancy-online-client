/* SHARED DECK TABLES — the HTTP routes and the room-less socket channel (docs/26).
 *
 * HTTP (bearer token, signed in):
 *   POST /api/collab/start {deck}         → {ok, code}   the host opens one of their decks
 *                                            (their open session on it, if any)
 *   POST /api/collab/invite {code, to}    → {ok}         a line in a friend's bell
 *   POST /api/collab/decline {code}       → {ok}         that line dismissed
 *
 * SOCKET, handled in main.ts above `join` like the cube's: a socket on a shared
 * table is in no room. `{t:'collab', op:'sub', code, token}` takes a place at
 * the table (a second sub moves it); `move` {seq, carry, to}, `step` {seq, dir},
 * `cursor` {at, held}, and the host's `kick` {user} and `end`. Every change
 * pushes `{t:'collab', view}` to every socket at the table, each with its own
 * `ack`; a refused move answers its own socket `{t:'collab', refused}` and the
 * view. A pointer is relayed to everyone else as `{t:'collab', cursor}`.
 *
 * THE HOST. The session is the host's deck lent out: it ends when the host
 * ends it, or when the host's last tab has been gone for HOST_GRACE_MS (a reload
 * or a dropped network comes back inside it). Everyone else is told
 * `{t:'collab', ended}`. The table is saved into the host's deck a moment after
 * each change, and at the end; while a session is open the deck's own update
 * route leaves its cards alone (api-decks.ts), so a stale tab cannot write over it.
 *
 * Nothing here is persisted beyond the deck: a restart ends every session.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WebSocket } from 'ws';
import { addrOf, json, rateLimited, readBody, str, tokenOf } from './api-util.ts';
import { accountById, accountForToken, type Account } from './accounts.ts';
import { decksOf, updateDeck } from './collection.ts';
import {
  admit, HOST_GRACE_MS, move, newCode, newSession, parseCarry, parseCursor, parsePlace, step, tableOf, viewFor,
  type CollabCursor, type Session,
} from './collab.ts';
import type { Received, ServerMsg } from '../shared/protocol.ts';

const CODE = /^[A-Z0-9]{6,16}$/;
/** a change is written into the host's deck this long after the last one */
const SAVE_MS = 1000;
/** an invite stops showing after this long */
const INVITE_MS = 30 * 60_000;
/** a pointer is relayed at most this often per socket */
const CURSOR_MS = 40;
/** moves and steps one socket may make in a second */
const MOVES_PER_S = 20;

const sessions = new Map<string, Session>();
/** the deck id → the code of the session open on it */
const byDeck = new Map<string, string>();

interface Sub { code: string; user: string; ack: number; cursorAt: number; moves: number[] }
const subs = new Map<WebSocket, Sub>();
const byCode = new Map<string, Set<WebSocket>>();
/** each session's pointers, the last one per person: a newcomer sees them at once */
const cursors = new Map<string, Map<string, CollabCursor>>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** code → invited account → who asked, and when */
const invites = new Map<string, Map<string, { from: string; at: number }>>();

const sendTo = (ws: WebSocket, obj: ServerMsg): void => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
};

const nameOf = (a: Account): string => a.username;

/** is this account at session `code` in some tab right now? */
function here(code: string, user: string): boolean {
  for (const ws of byCode.get(code) ?? []) if (subs.get(ws)?.user === user) return true;
  return false;
}

function deckInfo(s: Session): { name: string; cover: string | null } | null {
  const host = accountById(s.host);
  const d = host ? decksOf(host).find(x => x.id === s.deckId) : undefined;
  return d ? { name: d.name, cover: d.cover } : null;
}

/** every socket at the table its own view (its own `ack`) */
function push(s: Session): void {
  const info = deckInfo(s);
  if (!info) { end(s, 'The host deleted this deck, so the session ended.'); return; }
  const now = Date.now();
  const isHere = (id: string): boolean => here(s.code, id);
  for (const ws of byCode.get(s.code) ?? []) {
    const sub = subs.get(ws);
    if (sub) sendTo(ws, { t: 'collab', view: viewFor(s, sub.user, info, isHere, sub.ack, now) });
  }
}

function saveSoon(s: Session): void {
  if (saveTimers.has(s.code)) return;
  const t = setTimeout(() => { saveTimers.delete(s.code); save(s); }, SAVE_MS);
  t.unref?.();
  saveTimers.set(s.code, t);
}

/** the table into the host's deck, now */
function save(s: Session): void {
  const host = accountById(s.host);
  if (!host) return;
  const t = s.table;
  updateDeck(host, s.deckId, { cards: t.cards, maybe: t.maybe, sideboard: t.side, piles: t.piles });
}

function unsub(ws: WebSocket): void {
  const sub = subs.get(ws);
  if (!sub) return;
  subs.delete(ws);
  const set = byCode.get(sub.code);
  set?.delete(ws);
  if (set && !set.size) byCode.delete(sub.code);
  const s = sessions.get(sub.code);
  if (!s) return;
  if (!here(s.code, sub.user)) {
    cursors.get(s.code)?.delete(sub.user);
    relay(s, { id: sub.user, at: null, held: null }, null);
  }
  if (sub.user === s.host && !here(s.code, s.host)) hostLeft(s);
  push(s);
}

/** the host's last tab went: the session waits HOST_GRACE_MS for them */
function hostLeft(s: Session): void {
  s.hostGoneAt = Date.now();
  clearTimeout(graceTimers.get(s.code));
  const t = setTimeout(() => {
    graceTimers.delete(s.code);
    if (sessions.get(s.code) === s && !here(s.code, s.host)) end(s, 'The host left, so the session ended.');
  }, HOST_GRACE_MS);
  t.unref?.();
  graceTimers.set(s.code, t);
}

/** the session is over: saved, everyone told, everything let go */
function end(s: Session, why: string): void {
  if (sessions.get(s.code) !== s) return;
  clearTimeout(saveTimers.get(s.code)); saveTimers.delete(s.code);
  clearTimeout(graceTimers.get(s.code)); graceTimers.delete(s.code);
  if (deckInfo(s)) save(s);
  sessions.delete(s.code);
  if (byDeck.get(s.deckId) === s.code) byDeck.delete(s.deckId);
  invites.delete(s.code);
  cursors.delete(s.code);
  for (const ws of [...(byCode.get(s.code) ?? [])]) {
    subs.delete(ws);
    sendTo(ws, { t: 'collab', ended: why });
  }
  byCode.delete(s.code);
  console.log(`[collab] ${s.code}: ended — ${why}`);
}

/** a pointer to everyone at the table but `except` */
function relay(s: Session, c: CollabCursor, except: WebSocket | null): void {
  for (const ws of byCode.get(s.code) ?? []) if (ws !== except) sendTo(ws, { t: 'collab', cursor: c });
}

// ── the socket ────────────────────────────────────────────────────────

/** is this socket at a shared table? (main.ts: such a socket is in no room) */
export const collabSubscribed = (ws: WebSocket): boolean => subs.has(ws);

/** main.ts, above `join`: one `{t:'collab', …}` message */
export function collabSocketMessage(ws: WebSocket, msg: Extract<Received, { t: 'collab' }>): void {
  const op = String(msg['op'] ?? '');
  if (op === 'sub') {
    const code = String(msg['code'] ?? '').toUpperCase().trim();
    const s = CODE.test(code) ? sessions.get(code) : undefined;
    if (!s) return sendTo(ws, { t: 'collab', ended: 'This session has ended, or the link is wrong.' });
    const who = accountForToken(typeof msg['token'] === 'string' ? msg['token'] : undefined);
    if (!who) return sendTo(ws, { t: 'collab', error: 'Log in to join this session.' });
    const present = new Set([...(byCode.get(s.code) ?? [])].map(w => subs.get(w)?.user)).size;
    const ok = admit(s, { id: who.id, name: nameOf(who) }, present);
    if (!ok.ok) return sendTo(ws, { t: 'collab', ended: ok.error });
    unsub(ws);
    subs.set(ws, { code: s.code, user: who.id, ack: 0, cursorAt: 0, moves: [] });
    let set = byCode.get(s.code);
    if (!set) byCode.set(s.code, set = new Set());
    set.add(ws);
    invites.get(s.code)?.delete(who.id);
    if (who.id === s.host && s.hostGoneAt !== null) {
      s.hostGoneAt = null;
      clearTimeout(graceTimers.get(s.code)); graceTimers.delete(s.code);
    }
    push(s);
    for (const c of cursors.get(s.code)?.values() ?? []) if (c.id !== who.id) sendTo(ws, { t: 'collab', cursor: c });
    return;
  }
  if (op === 'unsub') { unsub(ws); return; }

  const sub = subs.get(ws);
  const s = sub ? sessions.get(sub.code) : undefined;
  if (!sub || !s) return sendTo(ws, { t: 'collab', ended: 'This session has ended.' });

  if (op === 'move' || op === 'step') {
    const seq = Number.isInteger(msg['seq']) ? msg['seq'] as number : null;
    if (seq === null || seq <= sub.ack) return;
    sub.ack = seq;
    // a person drags a few cards a second; a flood is refused, not pushed to everyone
    const now = Date.now();
    sub.moves = sub.moves.filter(t => now - t < 1000);
    if (sub.moves.length >= MOVES_PER_S) { sendTo(ws, { t: 'collab', refused: { seq, note: 'Slow down a little.' } }); push(s); return; }
    sub.moves.push(now);
    let r: { ok: true } | { ok: false; note: string };
    if (op === 'step') {
      const dir = msg['dir'] === 'redo' ? 'redo' : 'undo';
      r = step(s, sub.user, dir);
    } else {
      const to = parsePlace(msg['to']);
      const carry = parseCarry(msg['carry']);
      r = to && (carry || to.at === 'arrange') ? move(s, sub.user, carry, to) : { ok: false, note: 'That move did not make sense to the server.' };
    }
    if (!r.ok) sendTo(ws, { t: 'collab', refused: { seq, note: r.note } });
    else saveSoon(s);
    push(s);
    return;
  }
  if (op === 'cursor') {
    const now = Date.now();
    if (now - sub.cursorAt < CURSOR_MS) return;
    sub.cursorAt = now;
    const p = parseCursor(msg['at'], msg['held']);
    const c: CollabCursor = { id: sub.user, ...p };
    let m = cursors.get(s.code);
    if (!m) cursors.set(s.code, m = new Map());
    m.set(sub.user, c);
    relay(s, c, ws);
    return;
  }
  if (op === 'kick' || op === 'end') {
    if (sub.user !== s.host) return sendTo(ws, { t: 'collab', error: 'Only the host can do that.' });
    if (op === 'end') { end(s, 'The host ended the session.'); return; }
    const user = String(msg['user'] ?? '');
    if (!user || user === s.host || !s.members.has(user)) return;
    s.kicked.add(user);
    s.members.delete(user);
    cursors.get(s.code)?.delete(user);
    for (const w of [...(byCode.get(s.code) ?? [])]) {
      if (subs.get(w)?.user !== user) continue;
      subs.delete(w);
      byCode.get(s.code)?.delete(w);
      sendTo(w, { t: 'collab', ended: 'The host removed you from this session.' });
    }
    relay(s, { id: user, at: null, held: null }, null);
    push(s);
    return;
  }
  sendTo(ws, { t: 'collab', error: `unknown collab request ${op}` });
}

/** main.ts's close handler */
export function collabSocketClosed(ws: WebSocket): void { unsub(ws); }

// ── the deck's own routes ask ─────────────────────────────────────────

/** is a session open on this deck? (its update route then leaves the cards alone) */
export const collabOpenOn = (deckId: string): boolean => byDeck.has(deckId);

/** the deck's name or cover changed: the table's title follows */
export function collabDeckTouched(deckId: string): void {
  const s = sessions.get(byDeck.get(deckId) ?? '');
  if (s) push(s);
}

/** the deck was deleted: its session ends */
export function collabDeckGone(deckId: string): void {
  const s = sessions.get(byDeck.get(deckId) ?? '');
  if (s) end(s, 'The host deleted this deck, so the session ended.');
}

/** the bell's lines: sessions this account was invited to and is not at */
export function collabInvitesFor(userId: string, now = Date.now()): { code: string; from: string; deck: string; at: number }[] {
  const out: { code: string; from: string; deck: string; at: number }[] = [];
  for (const [code, m] of invites) {
    const inv = m.get(userId);
    const s = sessions.get(code);
    if (!inv || !s || now - inv.at > INVITE_MS || here(code, userId) || s.kicked.has(userId)) continue;
    const info = deckInfo(s);
    if (!info) continue;
    out.push({ code, from: s.members.get(inv.from)?.name ?? 'A friend', deck: info.name, at: inv.at });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** a test's fresh start */
export function resetCollab(): void {
  for (const t of saveTimers.values()) clearTimeout(t);
  for (const t of graceTimers.values()) clearTimeout(t);
  sessions.clear(); byDeck.clear(); subs.clear(); byCode.clear(); cursors.clear();
  saveTimers.clear(); graceTimers.clear(); invites.clear();
}

/** a test's look at a session */
export const collabSession = (code: string): Session | undefined => sessions.get(code);

// ── HTTP ──────────────────────────────────────────────────────────────

export async function collabRoutes(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (!path.startsWith('/api/collab/')) return false;
  const me = accountForToken(tokenOf(req));
  if (!me) return json(res, { ok: false, error: 'log in first' }, 401), true;
  if (req.method !== 'POST') return json(res, { ok: false, error: `${path} wants a POST` }), true;
  const b = await readBody(req);

  if (path === '/api/collab/start') {
    const deckId = str(b['deck'], 64);
    const d = decksOf(me).find(x => x.id === deckId);
    if (!d) return json(res, { ok: false, error: 'no such deck' }), true;
    const open = sessions.get(byDeck.get(deckId) ?? '');
    if (open) return json(res, { ok: true, code: open.code }), true;
    if (rateLimited(addrOf(req), 'collab', 30, 60_000)) {
      return json(res, { ok: false, error: 'too many sessions — wait a minute' }, 429), true;
    }
    const code = newCode(c => sessions.has(c));
    const s = newSession(code, { id: me.id, name: nameOf(me) }, deckId, tableOf(d));
    sessions.set(code, s);
    byDeck.set(deckId, code);
    // nobody is at the table until the host's socket arrives: the grace clock runs from now
    hostLeft(s);
    console.log(`[collab] ${code}: opened on a deck of ${me.username}`);
    return json(res, { ok: true, code }), true;
  }

  const code = str(b['code'], 16).toUpperCase();
  const s = sessions.get(code);

  if (path === '/api/collab/invite') {
    if (rateLimited(addrOf(req), 'invite', 60, 60_000)) {
      return json(res, { ok: false, error: 'too many invites — wait a minute' }, 429), true;
    }
    if (!s || !s.members.has(me.id) || s.kicked.has(me.id)) return json(res, { ok: false, error: 'That session has ended.' }), true;
    const to = str(b['to'], 64);
    if (!me.friends.includes(to) || !accountById(to)) return json(res, { ok: false, error: 'You can invite your friends from here.' }), true;
    if (s.kicked.has(to)) return json(res, { ok: false, error: 'The host removed them from this session.' }), true;
    let m = invites.get(code);
    if (!m) invites.set(code, m = new Map());
    m.set(to, { from: me.id, at: Date.now() });
    return json(res, { ok: true }), true;
  }

  if (path === '/api/collab/decline') {
    invites.get(code)?.delete(me.id);
    return json(res, { ok: true }), true;
  }

  json(res, { ok: false, error: `no such endpoint: ${path}` }, 404);
  return true;
}
