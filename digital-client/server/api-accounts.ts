/* The /api/auth, /api/me, /api/player(s) and /api/friends endpoints.
 *
 * Kept out of main.ts so the game loop stays readable: main.ts hands every
 * request here first and only falls through to its own routes if this returns
 * false.
 *
 * Auth is a bearer token in the Authorization header (the client keeps it in
 * localStorage and also sends it on the websocket join). Errors come back as
 * 200 + { ok: false, error } rather than HTTP status codes, matching the
 * /api/deck/import convention already in this server — one shape for the
 * client to handle, and a fetch().then(json) that never needs a status check.
 * The exception is /api/me, which answers 401 so a stale token can be detected
 * and dropped without parsing.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  accountByName, acceptFriend, accountForToken, changePassword, leaderboard,
  login, logout, privateView, publicView, register, removeFriend, requestFriend,
  type Account,
} from './accounts.ts';
import { ACHIEVEMENTS } from './achievements.ts';

/** what the game loop knows and this module does not: who is connected */
export interface ApiContext {
  online: (userId: string) => boolean;
}

const json = (res: ServerResponse, body: unknown, status = 200): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

/** Read a JSON body, capped — an unbounded read on an open port is a gift to
 * anyone who finds it, even on a LAN. */
function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  return new Promise(resolve => {
    let body = '';
    let over = false;
    req.on('data', (c: Buffer) => {
      if (over) return;
      body += c;
      if (body.length > limit) { over = true; body = ''; }
    });
    req.on('end', () => {
      try { resolve(over ? {} : JSON.parse(body || '{}') as Record<string, unknown>); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

/** The bearer token on a request, if any. */
export function tokenOf(req: IncomingMessage): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return null;
}

const str = (v: unknown, max = 200): string => String(v ?? '').slice(0, max);

/**
 * A very small brake on password guessing: after 10 failed logins from one
 * address, refuse for a minute. Not a security control so much as a way to
 * keep a stuck client from grinding scrypt in a loop.
 */
const failures = new Map<string, { n: number; until: number }>();
const FAIL_LIMIT = 10;
const FAIL_WINDOW_MS = 60_000;

function throttled(addr: string): boolean {
  const f = failures.get(addr);
  if (!f) return false;
  if (Date.now() > f.until) { failures.delete(addr); return false; }
  return f.n >= FAIL_LIMIT;
}

function noteFailure(addr: string): void {
  const f = failures.get(addr) ?? { n: 0, until: 0 };
  f.n++;
  f.until = Date.now() + FAIL_WINDOW_MS;
  failures.set(addr, f);
}

/**
 * Handle an account route. Returns true when the request was ours (the
 * response has been sent or will be), false to let main.ts carry on.
 */
export async function accountRoutes(
  req: IncomingMessage, res: ServerResponse, path: string, url: URL, ctx: ApiContext,
): Promise<boolean> {
  if (!path.startsWith('/api/auth/') && !['/api/me', '/api/player', '/api/players', '/api/achievements']
    .includes(path) && !path.startsWith('/api/friends/')) {
    return false;
  }
  const addr = req.socket.remoteAddress ?? '?';
  const me = accountForToken(tokenOf(req));

  /** every authed route needs the same two lines */
  const requireAuth = (): Account | null => {
    if (me) return me;
    json(res, { ok: false, error: 'log in first' }, 401);
    return null;
  };

  // ── auth ──
  if (path === '/api/auth/register' && req.method === 'POST') {
    const b = await readBody(req);
    const r = register(str(b['username'], 40), str(b['password']));
    if (!r.ok) return json(res, r), true;
    return json(res, { ok: true, token: r.token, me: privateView(r.account, ctx.online) }), true;
  }

  if (path === '/api/auth/login' && req.method === 'POST') {
    if (throttled(addr)) {
      return json(res, { ok: false, error: 'too many failed attempts — wait a minute' }), true;
    }
    const b = await readBody(req);
    const r = login(str(b['username'], 40), str(b['password']));
    if (!r.ok) { noteFailure(addr); return json(res, r), true; }
    failures.delete(addr);
    return json(res, { ok: true, token: r.token, me: privateView(r.account, ctx.online) }), true;
  }

  if (path === '/api/auth/logout' && req.method === 'POST') {
    const t = tokenOf(req);
    if (t) logout(t);
    return json(res, { ok: true }), true;
  }

  if (path === '/api/auth/password' && req.method === 'POST') {
    const account = requireAuth();
    if (!account) return true;
    const b = await readBody(req);
    return json(res, changePassword(account, str(b['oldPassword']), str(b['newPassword']))), true;
  }

  // ── me ──
  if (path === '/api/me') {
    const account = requireAuth();
    if (!account) return true;
    return json(res, { ok: true, me: privateView(account, ctx.online) }), true;
  }

  // ── other players ──
  if (path === '/api/player') {
    const name = url.searchParams.get('name') ?? '';
    const account = accountByName(name);
    if (!account) return json(res, { ok: false, error: `no player called "${name}"` }), true;
    return json(res, { ok: true, player: publicView(account), online: ctx.online(account.id) }), true;
  }

  if (path === '/api/players') {
    return json(res, { ok: true, players: leaderboard(ctx.online) }), true;
  }

  /** the full catalogue, so a logged-out visitor can see what is on offer */
  if (path === '/api/achievements') {
    return json(res, {
      ok: true,
      achievements: ACHIEVEMENTS.map(a => ({ id: a.id, name: a.name, desc: a.desc, icon: a.icon, need: a.goal })),
    }), true;
  }

  // ── friends ──
  if (path === '/api/friends/request' && req.method === 'POST') {
    const account = requireAuth();
    if (!account) return true;
    const b = await readBody(req);
    const r = requestFriend(account, str(b['username'], 40));
    return json(res, { ...r, me: privateView(account, ctx.online) }), true;
  }

  if (path === '/api/friends/accept' && req.method === 'POST') {
    const account = requireAuth();
    if (!account) return true;
    const b = await readBody(req);
    const r = acceptFriend(account, str(b['id'], 64));
    return json(res, { ...r, me: privateView(account, ctx.online) }), true;
  }

  // one endpoint for three edits — decline, cancel, unfriend are the same
  // removal, and the client should not have to work out which it is doing
  if (path === '/api/friends/remove' && req.method === 'POST') {
    const account = requireAuth();
    if (!account) return true;
    const b = await readBody(req);
    const r = removeFriend(account, str(b['id'], 64));
    return json(res, { ...r, me: privateView(account, ctx.online) }), true;
  }

  json(res, { ok: false, error: `no such endpoint: ${path}` }, 404);
  return true;
}
