/* `GET /api/cardstats` — the Card Stats page's numbers (cardstats.ts), over
 * every finished game in the history, each joined to its card ledger
 * (cardledger.ts, read off the game file).
 *
 *   ?mode=draft|constructed|all   (default all)
 *   &from=YYYY-MM-DD&to=YYYY-MM-DD
 *   &rated=1                      matchmaker games only
 *   &signed=both                  both seats signed in
 *   &me=1                         only the caller's own seats (needs a session)
 *
 * PUBLIC, like the metagame list and the card ladder — but a public answer
 * must be an AGGREGATE. A filter narrow enough to match one or two games
 * (a single day, say) would print what was in somebody's hand in one game,
 * which is the thing `/api/replay` refuses a non-participant. So a public
 * filter that matches fewer than PUBLIC_FLOOR games is refused, and says so.
 * "My games" folds only your own seats, so it has no floor: it is only ever
 * your own cards.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { accountForToken, gameHistory, historyRevision } from './accounts.ts';
import { tokenOf } from './api-util.ts';
import { readLedger } from './cardledger.ts';
import { foldCardStats, type CardStatsFilter, type CardStatsResult, type StatsGame } from './cardstats.ts';
import { gamesDir } from './statepaths.ts';

export const PUBLIC_FLOOR = 5;
/** how long a fold is reused while the history is unchanged — a game file
 * can gain a ledger without the history moving (a restart's re-read) */
const FRESH_MS = 5 * 60 * 1000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseFilter(url: URL): CardStatsFilter {
  const mode = url.searchParams.get('mode');
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  return {
    mode: mode === 'draft' || mode === 'constructed' ? mode : 'all',
    ...(DAY.test(from) ? { from } : {}),
    ...(DAY.test(to) ? { to } : {}),
    ...(url.searchParams.get('rated') === '1' ? { rated: true } : {}),
    ...(url.searchParams.get('signed') === 'both' ? { bothSignedIn: true } : {}),
  };
}

/** The history joined to the ledgers — every row, eligibility is the fold's. */
export function statsGames(): StatsGame[] {
  const dir = gamesDir();
  const out: StatsGame[] = [];
  for (const h of gameHistory()) {
    if (!h.finished || h.custom || h.single) continue;   // cheap early outs; the fold re-checks
    const r = readLedger(dir, h.code);
    if (r) out.push({ ...h, ledger: r.ledger });
  }
  return out;
}

const cache = new Map<string, { rev: number; at: number; result: CardStatsResult }>();

export function cardStats(filter: CardStatsFilter): CardStatsResult {
  const key = JSON.stringify(filter);
  const rev = historyRevision();
  const hit = cache.get(key);
  if (hit && hit.rev === rev && Date.now() - hit.at < FRESH_MS) return hit.result;
  const result = foldCardStats(statsGames(), filter);
  if (cache.size > 200) cache.clear();
  cache.set(key, { rev, at: Date.now(), result });
  return result;
}

/** the last public answer per filter, serialized and gzipped once — the
 * body is a few hundred rows of repeated keys, ~200 KB raw and ~10% of that
 * compressed, and it is the same bytes for everybody until a game ends */
const bodies = new WeakMap<CardStatsResult, { json: string; gz: Buffer }>();

export function cardStatsRoutes(req: IncomingMessage, res: ServerResponse, path: string, url: URL): boolean {
  if (path !== '/api/cardstats' || req.method !== 'GET') return false;
  const gzipOk = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  const send = (status: number, body: unknown, packed?: { json: string; gz: Buffer }): void => {
    if (packed && gzipOk) {
      res.writeHead(status, { 'content-type': 'application/json', 'content-encoding': 'gzip', vary: 'accept-encoding' });
      res.end(packed.gz);
      return;
    }
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(packed ? packed.json : JSON.stringify(body));
  };
  const filter = parseFilter(url);
  if (url.searchParams.get('me') === '1') {
    const account = accountForToken(tokenOf(req));
    if (!account) { send(401, { ok: false, error: 'sign in to see your own games' }); return true; }
    filter.me = account.id;
  }
  const result = cardStats(filter);
  if (!filter.me && result.games < PUBLIC_FLOOR) {
    send(200, { ok: false, error: 'not enough games', games: result.games, floor: PUBLIC_FLOOR });
    return true;
  }
  let packed = bodies.get(result);
  if (!packed) {
    // `filter.me` is the caller's own id: echo that it was "me", not the id
    const json = JSON.stringify({ ok: true, ...result, filter: { ...result.filter, ...(filter.me ? { me: 'me' } : {}) }, floor: PUBLIC_FLOOR });
    packed = { json, gz: gzipSync(json) };
    bodies.set(result, packed);
  }
  send(200, null, packed);
  return true;
}
