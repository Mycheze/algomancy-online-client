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

/** the address a request came from, for the brake above */
export const addrOf = (req: IncomingMessage): string => req.socket.remoteAddress ?? '?';
