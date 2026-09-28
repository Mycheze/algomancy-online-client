/* The league's HTTP surface (docs/20-league.md). Transport only: every
 * decision is league-store.ts's, and every calculation league.ts's.
 *
 * Three audiences, three prefixes, three gates:
 *
 *   /api/league/*         the player — bearer session, like /api/me
 *   /api/league/admin/*   the organizer — an admin account (admin.ts adminFor),
 *                         and 404 to anybody else, before the body is read,
 *                         for api-admin.ts's reason: a refusal must not say the
 *                         route exists
 *   /api/league/bot/*     the Discord bot — the x-algo-bot header (main.ts
 *                         botAllowed), 404 otherwise, like /api/bot/*
 *
 * They live under /api/league/ rather than /api/admin/ and /api/bot/ because
 * both of those routers answer 404 to any path they do not know, and a league
 * that had to register itself inside them would be threaded through two files
 * that are about other things.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, readBody, str, tokenOf } from './api-util.ts';
import { accountByName, accountForToken, allAccounts, setLeagueAvailability, type Account } from './accounts.ts';
import { adminFor } from './admin.ts';
import { MIN_HOURS, sanitizeGrid, validTz, type Outcome } from './league.ts';
import {
  ackOutbox, advance, allSeasons, canSee, createSeason, currentSeason, deleteSeason, joinSeason,
  leaveSeason, overrideResult, pendingOutbox, previewNext, seasonById, seasonView, setSkip, updateSeason,
  type Season,
} from './league-store.ts';

export interface LeagueCtx {
  /** the request carried the bot's token */
  botAllowed: boolean;
  /** this deploy has a Discord bot, so sign-up can require a linked account */
  discordLinking: boolean;
  now?: () => number;
}

function notFound(res: ServerResponse): true {
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
  return true;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1;

export async function leagueRoutes(
  req: IncomingMessage, res: ServerResponse, path: string, url: URL, ctx: LeagueCtx,
): Promise<boolean> {
  if (path !== '/api/league' && !path.startsWith('/api/league/')) return false;
  const now = (ctx.now ?? Date.now)();
  const post = req.method === 'POST';

  if (path.startsWith('/api/league/admin/')) return adminRoute(req, res, path, now);
  if (path.startsWith('/api/league/bot/')) return botRoute(req, res, path, url, ctx, now);

  const me = accountForToken(tokenOf(req));
  const admin = !!me?.admin;
  const requireDiscord = ctx.discordLinking;

  /** the season a request names, if this caller may see it */
  const pick = (id: unknown): Season | null => {
    const s = typeof id === 'string' && id ? seasonById(id) : currentSeason(me, admin);
    return s && canSee(s, me, admin) ? s : null;
  };

  if (path === '/api/league' && req.method === 'GET') {
    const s = pick(url.searchParams.get('season'));
    json(res, {
      ok: true,
      season: s ? seasonView(s, me, { admin, requireDiscord }) : null,
      seasons: allSeasons().filter(x => canSee(x, me, admin))
        .map(x => ({ id: x.id, name: x.name, phase: x.phase, weeks: x.weeks, hidden: x.hidden })),
      signedIn: !!me,
      availability: me?.league?.tz && me.league.grid ? { tz: me.league.tz, grid: me.league.grid } : null,
      discordLinked: !!me?.linked?.discord,
      requireDiscord,
      minHours: MIN_HOURS,
      organizer: admin,
    });
    return true;
  }

  if (!post) return notFound(res);
  if (!me) { json(res, { ok: false, error: 'sign in first' }, 401); return true; }
  const b = await readBody(req);

  if (path === '/api/league/availability') {
    const grid = sanitizeGrid(b['grid']);
    if (!validTz(b['tz'])) { json(res, { ok: false, error: 'unknown time zone' }); return true; }
    if (!grid) { json(res, { ok: false, error: 'that is not a week of hours' }); return true; }
    setLeagueAvailability(me, b['tz'], grid);
    json(res, { ok: true, availability: { tz: b['tz'], grid } });
    return true;
  }

  const s = pick(b['season']);
  if (!s) { json(res, { ok: false, error: 'no such season' }); return true; }

  if (path === '/api/league/join') { json(res, joinSeason(s, me, now, { requireDiscord })); return true; }
  if (path === '/api/league/leave') { json(res, leaveSeason(s, me, now)); return true; }
  if (path === '/api/league/skip') { json(res, setSkip(s, me, num(b['week']), bool(b['skip']), now)); return true; }
  return notFound(res);
}

// ── the organizer ─────────────────────────────────────────────────────

async function adminRoute(req: IncomingMessage, res: ServerResponse, path: string, now: number): Promise<boolean> {
  const me = adminFor(req);
  if (!me || req.method !== 'POST') return notFound(res);
  const b = await readBody(req);

  if (path === '/api/league/admin/create') {
    const r = createSeason({
      id: str(b['id'], 24), name: str(b['name'], 60), signupOpens: str(b['signupOpens'], 40),
      start: str(b['start'], 40), weeks: num(b['weeks']), perWeek: num(b['perWeek']),
      auto: bool(b['auto']), hidden: bool(b['hidden']),
      ...(b['lateUntil'] !== undefined ? { lateUntil: num(b['lateUntil']) } : {}),
    }, now);
    if (r.ok) console.log(`[league] ${me.username} created season ${r.season.id}`);
    json(res, r.ok ? { ok: true, id: r.season.id } : r);
    return true;
  }

  const s = seasonById(str(b['id'], 24));
  if (!s) { json(res, { ok: false, error: 'no such season' }); return true; }

  if (path === '/api/league/admin/update') {
    const patch: Record<string, unknown> = {};
    for (const k of ['name', 'signupOpens', 'start'] as const) if (b[k] !== undefined) patch[k] = str(b[k], 60);
    for (const k of ['weeks', 'perWeek', 'lateUntil'] as const) if (b[k] !== undefined) patch[k] = num(b[k]);
    for (const k of ['auto', 'hidden', 'hold'] as const) if (b[k] !== undefined) patch[k] = bool(b[k]);
    const r = updateSeason(s.id, patch, now);
    json(res, r.ok ? { ok: true } : r);
    return true;
  }
  if (path === '/api/league/admin/delete') { json(res, deleteSeason(s.id)); return true; }
  if (path === '/api/league/admin/advance') {
    const r = advance(s, now);
    if (r.ok) console.log(`[league] ${me.username} advanced ${s.id} to ${r.label}`);
    json(res, r);
    return true;
  }
  if (path === '/api/league/admin/preview') {
    const p = previewNext(s);
    const name = (id: string): string => allAccounts().find(a => a.id === id)?.username ?? 'someone';
    json(res, p ? {
      ok: true, week: p.week, short: p.pairing.short ? name(p.pairing.short) : null, total: p.pairing.total,
      edges: p.pairing.edges.map(e => ({ a: name(e.a), b: name(e.b), score: e.score, cost: e.cost, windows: e.windows })),
    } : { ok: false, error: 'the next phase is not a week' });
    return true;
  }
  if (path === '/api/league/admin/add') {
    const who = accountByName(str(b['name'], 40));
    if (!who) { json(res, { ok: false, error: 'no such player' }); return true; }
    json(res, joinSeason(s, who, now, { requireDiscord: false, byAdmin: true }));
    return true;
  }
  if (path === '/api/league/admin/result') {
    json(res, overrideResult(s, str(b['match'], 60), str(b['outcome'], 20) as Outcome | 'clear', str(b['note'], 200), now));
    return true;
  }
  return notFound(res);
}

// ── the bot ───────────────────────────────────────────────────────────

const byDiscord = (id: string): Account | undefined =>
  id ? allAccounts().find(a => a.linked?.discord?.id === id) : undefined;

async function botRoute(
  req: IncomingMessage, res: ServerResponse, path: string, url: URL, ctx: LeagueCtx, now: number,
): Promise<boolean> {
  if (!ctx.botAllowed) return notFound(res);

  /* The messages waiting to be sent, each with everything the bot needs to
   * render it: who it is for (and their Discord id AT SEND TIME — somebody may
   * have linked since the row was written), everybody it names, and the
   * public origin for links. */
  if (path === '/api/league/bot/outbox' && req.method === 'GET') {
    const limit = Math.max(1, Math.min(100, num(url.searchParams.get('limit') ?? 50) || 50));
    const person = (id: string) => {
      const a = allAccounts().find(x => x.id === id);
      return { id, name: a?.username ?? 'someone', discordId: a?.linked?.discord?.id ?? null };
    };
    const base = (process.env['ALGO_PUBLIC_URL'] ?? '').replace(/\/+$/, '');
    json(res, {
      ok: true,
      base,
      rows: pendingOutbox(limit).map(r => ({
        id: r.id, season: r.season, kind: r.kind, createdAt: r.createdAt,
        to: r.to ? person(r.to) : null,
        data: r.data,
        people: Object.fromEntries((r.data.ids ?? []).map(id => [id, person(id)])),
      })),
    });
    return true;
  }

  if (req.method !== 'POST' && path !== '/api/league/bot/status') return notFound(res);

  if (path === '/api/league/bot/ack') {
    const b = await readBody(req);
    const sent = Array.isArray(b['sent']) ? (b['sent'] as unknown[]).map(num).filter(Number.isInteger) : [];
    const failed = b['failed'] && typeof b['failed'] === 'object' ? b['failed'] as Record<string, string> : {};
    json(res, { ok: true, updated: ackOutbox(sent, failed, now) });
    return true;
  }

  // everything below speaks for one Discord user
  const b = req.method === 'POST' ? await readBody(req) : {};
  const discordId = str(b['discordId'] ?? url.searchParams.get('discord') ?? '', 32);
  const who = byDiscord(discordId);
  const s = currentSeason(who, false);

  if (path === '/api/league/bot/status') {
    json(res, {
      ok: true,
      linked: !!who,
      season: s ? seasonView(s, who, { admin: false, requireDiscord: true }) : null,
      availability: !!(who?.league?.tz && who.league.grid),
    });
    return true;
  }
  if (!who) { json(res, { ok: false, error: 'not-linked' }); return true; }
  if (!s) { json(res, { ok: false, error: 'there is no league season right now' }); return true; }
  if (path === '/api/league/bot/join') { json(res, joinSeason(s, who, now, { requireDiscord: true })); return true; }
  if (path === '/api/league/bot/leave') { json(res, leaveSeason(s, who, now)); return true; }
  if (path === '/api/league/bot/skip') { json(res, setSkip(s, who, num(b['week']), bool(b['skip']), now)); return true; }
  return notFound(res);
}
