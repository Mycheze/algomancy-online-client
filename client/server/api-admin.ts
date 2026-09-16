/* BL-16 — the /api/admin/* routes: the operator dashboard's HTTP surface.
 *
 * Every decision lives in admin.ts; this file is transport. What it DOES own
 * is the gate, and the gate has one rule:
 *
 * ⚠ 404, NEVER 403, AND BEFORE READING THE BODY. R216's argument, applied a
 * third time (the scenario tester, then the bot routes, now this). A non-admin
 * — logged in, logged out, or holding a token that expired an hour ago — gets
 * exactly what they would get for a path this server does not serve. There is
 * no response that distinguishes "you may not" from "there is nothing here",
 * so the dashboard's existence is not discoverable by poking at it, and a
 * scraper learns nothing from the shape of the refusal.
 *
 * BL-16's doneWhen says the same thing from the other end: *"Everything on the
 * page is refused to non-admins, server-side, not just hidden in the UI."* The
 * page hides itself too, but that is a courtesy to the honest and nothing else.
 *
 * ── THE BOOTSTRAP IS SOMEWHERE ELSE, ON PURPOSE ──────────────────────
 *
 * Granting the FIRST admin cannot go through here: there is nobody to
 * authorise it. That route is `POST /api/admin/grant` in main.ts, behind the
 * tester token (`deploy/admin.sh` on the box) — the same gate `badge.sh` has
 * used since BL-17's first slice, for the same reason. Once an admin exists
 * they grant the rest from the dashboard, and the token stays on the box.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, readBody, str } from './api-util.ts';
import { accountByName, setAdmin, setBadge } from './accounts.ts';
import {
  accountRows, adminCount, adminFor, gameRows, marks, reportRows, roomRows, setMark,
} from './admin.ts';

/** the 404 every refusal answers with — byte-identical to main.ts's own */
function notFound(res: ServerResponse): true {
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
  return true;
}

/** Handle an admin route. True when the request was ours — INCLUDING when it
 *  was refused, because a refusal that fell through would be answered by the
 *  static file handler and could 404 differently. */
export async function adminRoutes(
  req: IncomingMessage, res: ServerResponse, path: string,
): Promise<boolean> {
  if (!path.startsWith('/api/admin/')) return false;
  // the bootstrap route is main.ts's and is gated by the tester token, not by
  // an account — let it fall through untouched
  if (path === '/api/admin/badge' || path === '/api/admin/grant') return false;

  const me = adminFor(req);
  if (!me) return notFound(res);

  if (path === '/api/admin/overview' && req.method === 'GET') {
    const rows = reportRows();
    const m = marks();
    json(res, {
      ok: true,
      me: me.username,
      admins: adminCount(),
      accounts: accountRows().length,
      games: gameRows().length,
      rooms: roomRows().length,
      reports: {
        total: rows.length,
        unmarked: rows.filter(r => !m.has(r.id)).length,
        real: [...m.values()].filter(x => x.mark === 'real').length,
        not: [...m.values()].filter(x => x.mark === 'not').length,
        live: rows.filter(r => r.status === 'live' || r.status === 'partial').length,
      },
    });
    return true;
  }

  if (path === '/api/admin/accounts' && req.method === 'GET') {
    json(res, { ok: true, admins: adminCount(), accounts: accountRows() });
    return true;
  }

  if (path === '/api/admin/reports' && req.method === 'GET') {
    json(res, { ok: true, reports: reportRows() });
    return true;
  }

  if (path === '/api/admin/games' && req.method === 'GET') {
    json(res, { ok: true, games: gameRows() });
    return true;
  }

  if (path === '/api/admin/rooms' && req.method === 'GET') {
    json(res, { ok: true, rooms: roomRows() });
    return true;
  }

  /* ── writes ───────────────────────────────────────────────────────── */

  // the triage mark: 'real' | 'not' | null to clear
  if (path === '/api/admin/mark' && req.method === 'POST') {
    const b = await readBody(req);
    const id = b['id'];
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) {
      json(res, { ok: false, error: 'a report id is a non-negative integer' });
      return true;
    }
    const raw = b['mark'];
    const mark = raw === 'real' || raw === 'not' ? raw : null;
    // `null` is a legitimate value (clear the mark), so an unknown string is
    // coerced to it rather than refused — the same forgiveness report-fields.ts
    // extends to an unknown kind. Nothing is lost: the journal records what was
    // written, and what was written is a clear.
    json(res, { ok: true, row: setMark(id, mark, me.username) });
    return true;
  }

  // a trust mark on somebody else — the in-browser half of deploy/badge.sh
  if (path === '/api/admin/setbadge' && req.method === 'POST') {
    const b = await readBody(req);
    const account = accountByName(str(b['name'], 40));
    if (!account) { json(res, { ok: false, error: 'no such player' }); return true; }
    const badge = setBadge(account, { owner: b['owner'], judge: b['judge'] });
    console.log(`[admin] ${me.username} set ${account.username}'s badge: ${JSON.stringify(badge)}`);
    json(res, { ok: true, name: account.username, badge });
    return true;
  }

  // the admin flag itself
  if (path === '/api/admin/setadmin' && req.method === 'POST') {
    const b = await readBody(req);
    const account = accountByName(str(b['name'], 40));
    if (!account) { json(res, { ok: false, error: 'no such player' }); return true; }
    const want = b['admin'] === true;
    try {
      const now = setAdmin(account, want);
      console.log(`[admin] ${me.username} ${now ? 'granted' : 'revoked'} admin on ${account.username}`);
      json(res, { ok: true, name: account.username, admin: now, admins: adminCount() });
    } catch (err) {
      // the last-admin guard (accounts.ts) — a refusal with a reason, because
      // this one the operator can act on: grant somebody else first
      json(res, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  return notFound(res);
}
