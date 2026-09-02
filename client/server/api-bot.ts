/* /api/bot/* — the read-only window the Discord bot looks through.
 *
 * The game server has talked to the bot for a while: main.ts proxies
 * /api/cardinfo and /api/judge out to bot/app.py on :8000, so the in-game card
 * inspector and the "ask the judge" box are the bot answering the client.
 * Nothing ever came back the other way. These routes are that direction: who is
 * waiting, how a player is doing, and a room code to invite someone into.
 *
 * ── THE GATE, AND WHY IT IS A 404 ────────────────────────────────────
 *
 * R216 already settled this for the scenario tester and the argument carries
 * over unchanged, so main.ts's botAllowed() is testerAllowed()'s twin: no
 * ALGO_BOT_TOKEN in the environment and these paths do not exist; token set but
 * wrong on the request and they still do not exist. Not 403 — 404, the same
 * answer any other unserved path gets.
 *
 * The reason it matters MORE here than it does for the tester: /api/queue is
 * unauthenticated and returns numbers only, with a paragraph in main.ts saying
 * why ("never who is waiting"). /api/bot/queue returns NAMES. The token is the
 * entire difference between the two, so an unconfigured deploy must not admit
 * the second one is there at all.
 *
 * ⚠ ONE DELIBERATE DIVERGENCE FROM testerAllowed(): header only, no `?token=`
 * fallback. The tester accepts a query parameter because a human types its URL
 * into a browser bar. A bot never does, and a token in a query string lands in
 * every access log and every proxy on the way. Do not "fix" the inconsistency.
 *
 * ── WHAT IS NOT HERE ─────────────────────────────────────────────────
 *
 * No leaderboard. /api/players already answers it, already applies the
 * PUBLIC_AFTER listing rule, and already reports the honest `rated` count that
 * makes a hidden player's rank truthful. A second copy would be a second place
 * for that rule to live, and the rule is the owner's.
 *
 * Nothing here writes. Every route is a read, so this whole file is safe to
 * reach for while a game is in progress.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from './api-util.ts';
import { accountById, accountByName, publicView } from './accounts.ts';
import { bandFor, queueCounts, queued } from './queue.ts';
import { engineVersion } from './engine-version.ts';

/** What main.ts lends these routes: the decision, and the live registries. */
export interface BotCtx {
  /** already decided by main.ts's botAllowed() — see the header */
  allowed: boolean;
  online: (id: string) => boolean;
  rooms: () => number;
  /** a reserved, joinable room code plus the path to join it at */
  invite: (seat: 0 | 1, mode: string) => { code: string; joinPath: string };
  /** this process's id and age, so the bot can tell a restart from a silence */
  bootId: string;
  startedAt: number;
}

/** Handle a /api/bot/ route. True when the request was ours. */
export function botRoutes(
  req: IncomingMessage, res: ServerResponse, path: string, url: URL, ctx: BotCtx,
): boolean {
  if (!path.startsWith('/api/bot/')) return false;

  // Fail closed, and say nothing. See the header.
  if (!ctx.allowed) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return true;
  }

  /* Is the server up, which engine is it running, and has it restarted?
   *
   * There was no health check on this server at all before this. The bot needs
   * one for a specific reason: without it, "the game server is down" and "the
   * game server is slow" look identical from Python, and the bot's own reply
   * to a user is the difference between a sentence and a timeout. */
  if (path === '/api/bot/health') {
    json(res, {
      ok: true,
      bootId: ctx.bootId,
      engine: engineVersion(),
      uptimeMs: Date.now() - ctx.startedAt,
      rooms: ctx.rooms(),
      queue: queueCounts(),
    });
    return true;
  }

  /* Who is waiting, by name.
   *
   * ⚠ `band` is SENT, not recomputed. queueStateFor() in main.ts makes this
   * same choice for the browser and gives the reason: the client must not be
   * able to claim a promise the server is not keeping. A bot announcing
   * "searching ±100" that it worked out itself is the same bug with a wider
   * audience. */
  if (path === '/api/bot/queue') {
    const now = Date.now();
    json(res, {
      ok: true,
      counts: queueCounts(),
      waiting: queued()
        .sort((a, b) => a.since - b.since)
        .map(e => ({
          userId: e.userId,
          username: e.username,
          mode: e.mode,
          ranked: e.ranked,
          rating: e.rating,
          waitedMs: now - e.since,
          band: bandFor(e, now),
          online: ctx.online(e.userId),
        })),
    });
    return true;
  }

  /* One player's standing.
   *
   * ⚠ THIS EXISTS BECAUSE /api/players CANNOT ANSWER IT. That route filters to
   * `listed` (ratedGames >= PUBLIC_AFTER) and hands a caller its own unlisted
   * row only in `you`, which is populated from a browser session token. The bot
   * has no session, so without this route `/rating` would return nothing for
   * exactly the newest players — the ones most likely to ask.
   *
   * `?discord=` is accepted and always answers `linked: false` for now: the
   * linked-identity field lands with BL-39, and a bot that has to special-case
   * the route's ABSENCE is harder to ship than one handed an honest `false`. */
  if (path === '/api/bot/profile') {
    const discord = url.searchParams.get('discord');
    if (discord !== null) {
      json(res, { ok: true, linked: false, player: null });
      return true;
    }
    const name = url.searchParams.get('name');
    const id = url.searchParams.get('id');
    const account = name !== null ? accountByName(name) : accountById(id);
    if (!account) {
      // 200 + ok:false, not 404 — a 404 here already means "the gate said no",
      // and a bot cannot tell the two apart from a status code alone.
      json(res, { ok: false, error: `no player called "${name ?? id ?? ''}"` });
      return true;
    }
    json(res, {
      ok: true,
      linked: false,
      online: ctx.online(account.id),
      player: publicView(account),
    });
    return true;
  }

  /* A room to invite somebody into.
   *
   * ⚠ THIS RESERVES A CODE AND CREATES NOTHING, exactly as /api/new does. It
   * must never route through createMatch(): that is the only site in the repo
   * that sets room.rated (rooms.ts), and it imposes MATCH_CLOCK_MS over both
   * players' pickers. A game two friends arrange through Discord is deliberately
   * unrated — otherwise they can trade wins up the ladder — and a reservation
   * rather than a room is what keeps a mistyped code an error instead of a new
   * empty game.
   *
   * The join URL is built HERE, from the request's own Host header, which is
   * the same source main.ts already parses the URL from. That is so the bot
   * never has to be told what origin the deploy answers on. */
  if (path === '/api/bot/invite') {
    const seat = url.searchParams.get('seat') === '1' ? 1 : 0;
    const mode = url.searchParams.get('mode') === 'draft' ? 'draft' : 'constructed';
    const { code, joinPath } = ctx.invite(seat, mode);
    const host = typeof req.headers.host === 'string' ? req.headers.host : '';
    json(res, {
      ok: true,
      code,
      joinPath,
      joinUrl: host ? `http://${host}${joinPath}` : joinPath,
    });
    return true;
  }

  json(res, { ok: false, error: `no such bot route: ${path}` }, 404);
  return true;
}
