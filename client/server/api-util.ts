/* The four lines every JSON API route in this server needs: reply with JSON,
 * read a capped JSON body, find the bearer token, clamp a string.
 *
 * Extracted from api-accounts.ts when the deck-collection routes arrived and
 * would otherwise have been the second copy. The body cap is the reason this
 * is shared rather than re-typed: an unbounded read on an open port is a gift
 * to anyone who finds it, and a copy is a copy that can lose the cap.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export const json = (res: ServerResponse, body: unknown, status = 200): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

/** Read a JSON body, capped. Over the cap reads as an empty body rather than
 * an error: every route here validates its fields anyway, and a route that
 * says "that did not work" is easier to reason about than one that hangs. */
export function readBody(req: IncomingMessage, limit = 256 * 1024, strict = false): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    // `strict`: oversize or unparseable REJECTS, for the four routes in main.ts
    // whose own catch turns that into a 400 with the reason. They had a second
    // reader of their own (readJson, 64 KB, rejecting) — the same loop typed
    // twice with different limits, which is what this file exists to prevent.
    const fail = (why: string): void => strict ? reject(new Error(why)) : resolve({});
    let body = '';
    let over = false;
    req.on('data', (c: Buffer) => {
      if (over) return;
      body += c;
      if (body.length > limit) { over = true; body = ''; }
    });
    req.on('end', () => {
      if (over) return fail(`body too large (over ${limit} bytes)`);
      try { resolve(JSON.parse(body || '{}') as Record<string, unknown>); }
      catch (err) { fail(err instanceof Error ? err.message : String(err)); }
    });
    req.on('error', err => fail(err.message));
  });
}

/** The bearer token on a request, if any. */
export function tokenOf(req: IncomingMessage): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return null;
}

export const str = (v: unknown, max = 200): string => String(v ?? '').slice(0, max);

/* ── a per-address brake ─────────────────────────────────────────────────
 *
 * `rateLimited(addr, bucket, limit, windowMs)` answers true once an address
 * has made more than `limit` calls in `bucket` inside the window. It is the
 * one thing every unauthenticated route that WRITES (a report, a verdict, a
 * guest account, a sandbox room) or SPENDS (the judge proxy) needs, and it is
 * here so it is spelled once. Not a security control against a determined
 * attacker with many addresses; a way to make a loop from one address, stuck
 * client or otherwise, stop costing anything after the first minute.
 *
 * Bounded: the map is swept whenever it passes 1000 entries, so rotating
 * addresses cannot grow it without limit. */
const buckets = new Map<string, { n: number; until: number }>();

export function rateLimited(addr: string, bucket: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > 1000) {
    for (const [k, v] of buckets) if (now > v.until) buckets.delete(k);
  }
  const key = `${bucket}:${addr}`;
  const b = buckets.get(key);
  if (!b || now > b.until) {
    buckets.set(key, { n: 1, until: now + windowMs });
    return false;
  }
  b.n++;
  return b.n > limit;
}

/* ── the address a request came from ────────────────────────────────────
 *
 * Behind a reverse proxy every socket is the proxy's, so `remoteAddress`
 * collapses every visitor into 127.0.0.1 and the brakes above throttle
 * EVERYBODY the moment one person trips them — ten mistyped passwords from
 * one tester and nobody can log in for a minute. The proxy appends the real
 * address to X-Forwarded-For, so read it — but ONLY when the peer is
 * loopback, i.e. is the proxy. From any other peer the header is whatever
 * the caller typed, and honouring it is the same bug pointing the other way:
 * a loop that rotates the header rotates its bucket and is never throttled
 * at all. Last entry, not first: the proxy appends what it saw, and anything
 * before it was supplied by the client.
 *
 * Nothing in the test suite sets the header, and every test client connects
 * over loopback, so the answer there is the socket address as it always was.
 * test-proxy-addr.ts is the guard. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export function addrOf(req: IncomingMessage): string {
  const peer = req.socket.remoteAddress ?? '?';
  if (!LOOPBACK.has(peer)) return peer;
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd.join(',') : (fwd ?? '');
  const last = raw.split(',').map(s => s.trim()).filter(Boolean).pop();
  return last ?? peer;
}
