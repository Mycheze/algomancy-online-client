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
export function readBody(req: IncomingMessage, limit = 256 * 1024): Promise<Record<string, unknown>> {
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

export const str = (v: unknown, max = 200): string => String(v ?? '').slice(0, max);
