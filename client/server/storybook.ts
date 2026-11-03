/* The design system's Storybook, on the site, for admins only.
 *
 * The owner iterates on the design in Storybook (client/storybook/) and looks
 * at it on an iPad, through the installed web app, which has no URL bar. So the
 * static build (`npm --prefix client/storybook run build`, gitignored) is
 * served here at /storybook/, and the profile's "Design (Storybook)" button
 * opens it (ui/storybook-link.ts). docs/23 § Decisions chose this.
 *
 * ── WHO MAY SEE IT ───────────────────────────────────────────────────
 *
 * An admin, decided by admin.ts `adminForToken`, the same question every
 * /api/admin/ route asks. Everybody else (signed out, signed in, a stale
 * cookie, a used ticket) gets main.ts's own 404, byte for byte, before
 * anything is read off disk: api-admin.ts's rule, for api-admin.ts's reason.
 *
 * ── HOW A BROWSER NAVIGATION CARRIES THE SESSION ─────────────────────
 *
 * Every other private route here is fetched by the page with a bearer header.
 * Storybook is a whole site opened in a new window: its HTML, its scripts and
 * its preview iframe are plain navigations and subresource loads, which carry
 * cookies and no header. So:
 *
 *   1. The button POSTs /api/storybook/ticket with the bearer token. An admin
 *      gets a single-use ticket that lasts two minutes.
 *   2. The new window opens /storybook/?ticket=…. The ticket is spent, an
 *      HttpOnly cookie scoped to /storybook is set, and the browser is
 *      redirected to the same URL without the ticket.
 *   3. Every later /storybook/ request carries the cookie. The cookie names a
 *      server-side entry that holds the SESSION TOKEN the ticket was minted
 *      with, and adminForToken is asked again on every request. Logging out,
 *      or losing the admin flag, closes Storybook at once.
 *
 * The ticket is in the URL rather than the token because an iPad's installed
 * web app can hand a new window to a browser with its own cookie jar; a ticket
 * works in whichever jar it lands in, and it is spent before anything can log
 * or keep it. Nothing here survives a restart: the owner clicks the button
 * again.
 *
 * ── WHAT IT SERVES ───────────────────────────────────────────────────
 *
 * Files under the build directory and nothing else: the resolved path,
 * symlinks followed, must stay inside it. If the build is not there, an admin
 * is told so in plain text ("Storybook isn't built on this server"). No build
 * is a normal state: the game never needs Storybook, and deploy/README.md's
 * build step is optional.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { STORYBOOK_STATIC_DIR } from '../engine/scripts/paths.mjs';
import { adminForToken } from './admin.ts';
import { json, tokenOf } from './api-util.ts';

/** where the button sends the new window; the trailing slash matters, because
 *  every URL in the build is relative (`./sb-manager/runtime.js`) */
export const STORYBOOK_URL = '/storybook/';
/** the ticket route the button calls first */
export const STORYBOOK_TICKET_ROUTE = '/api/storybook/ticket';
const COOKIE = 'algo_sb';
const TICKET_MS = 2 * 60_000;
const SESSION_MS = 12 * 60 * 60_000;
const CAP = 200;

/** the build to serve. `ALGO_STORYBOOK_DIR` points the tests at a throwaway
 *  directory; read per call, like statepaths.ts, so a test may set it late. */
export const storybookDir = (): string => process.env['ALGO_STORYBOOK_DIR'] ?? STORYBOOK_STATIC_DIR;

interface Grant { token: string; until: number }
const tickets = new Map<string, Grant>();
const sessions = new Map<string, Grant>();

function mint(into: Map<string, Grant>, token: string, ms: number): string {
  const now = Date.now();
  for (const [k, g] of into) if (g.until <= now) into.delete(k);
  // bounded: the oldest goes first (a Map iterates in insertion order)
  while (into.size >= CAP) into.delete(into.keys().next().value!);
  const id = randomBytes(24).toString('base64url');
  into.set(id, { token, until: now + ms });
  return id;
}

function live(from: Map<string, Grant>, id: string): Grant | undefined {
  const g = from.get(id);
  if (g && g.until > Date.now()) return g;
  from.delete(id);
  return undefined;
}

function cookieOf(req: IncomingMessage, name: string): string | null {
  for (const part of String(req.headers['cookie'] ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** main.ts's 404, byte-identical, for every refusal: no response tells
 *  "you may not" from "there is nothing here" */
function notFound(res: ServerResponse): true {
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
  return true;
}

/** `rel` resolved inside `root`, or null when it would leave it (`..`, an
 *  absolute path, a NUL, a symlink pointing out) or does not exist */
export async function insideRoot(root: string, rel: string): Promise<string | null> {
  if (rel.includes('\0')) return null;
  let base: string;
  try { base = await realpath(root); } catch { return null; }
  const want = resolve(base, rel);
  if (!want.startsWith(base + sep)) return null;
  try {
    const real = await realpath(want);
    return real.startsWith(base + sep) ? real : null;
  } catch { return null; }
}

/** Handle /storybook and /api/storybook/ticket. True when the request was
 *  ours, refusals included. `serve` is main.ts's static file sender. */
export async function storybookRoutes(
  req: IncomingMessage, res: ServerResponse, path: string, url: URL,
  serve: (req: IncomingMessage, res: ServerResponse, file: string) => Promise<unknown>,
): Promise<boolean> {
  if (path === STORYBOOK_TICKET_ROUTE) {
    const token = tokenOf(req);
    if (req.method !== 'POST' || !token || !adminForToken(token)) return notFound(res);
    json(res, { ok: true, url: `${STORYBOOK_URL}?ticket=${mint(tickets, token, TICKET_MS)}` });
    return true;
  }
  if (path !== '/storybook' && !path.startsWith(STORYBOOK_URL)) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res);

  // the first request of a new window: spend the ticket, set the cookie, and
  // send the browser on to the same page without the ticket in its URL. A
  // spent or stale ticket is no ticket: the cookie below still decides.
  const ticket = url.searchParams.get('ticket');
  const g0 = ticket === null ? undefined : live(tickets, ticket);
  if (ticket !== null) tickets.delete(ticket);
  if (g0 && adminForToken(g0.token)) {
    const sid = mint(sessions, g0.token, SESSION_MS);
    const rest = new URLSearchParams(url.searchParams);
    rest.delete('ticket');
    const q = rest.toString();
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.writeHead(303, {
      location: (path === '/storybook' ? STORYBOOK_URL : url.pathname) + (q ? `?${q}` : ''),
      'set-cookie': `${COOKIE}=${sid}; Path=/storybook; Max-Age=${SESSION_MS / 1000}; HttpOnly; SameSite=Lax${secure}`,
      'cache-control': 'no-store',
    });
    res.end();
    return true;
  }

  const sid = cookieOf(req, COOKIE);
  const g = sid ? live(sessions, sid) : undefined;
  if (!g || !adminForToken(g.token)) return notFound(res);

  if (path === '/storybook') {
    res.writeHead(301, { location: STORYBOOK_URL + url.search });
    res.end();
    return true;
  }
  const root = storybookDir();
  const built = await stat(join(root, 'index.html')).then(s => s.isFile(), () => false);
  if (!built) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end("Storybook isn't built on this server");
    return true;
  }
  const file = await insideRoot(root, path.slice(STORYBOOK_URL.length) || 'index.html');
  if (!file) return notFound(res);
  await serve(req, res, file);
  return true;
}
