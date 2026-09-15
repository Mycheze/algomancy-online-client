/* Algomancy game server (M2 slice): HTTP static host + WebSocket game loop.
 *
 * Server-authoritative: clients send an intended Action; the server checks the
 * action's seat matches the connection's seat, applies it through the pure
 * engine, then pushes to BOTH clients a per-seat REDACTED view + the new
 * (redacted) events + that seat's legalActions (computed server-side so the
 * client never needs hidden info to highlight plays).
 *
 * Scope is personal: a handful of players, join-by-room-code, no TLS. Accounts
 * (username + password, stats, achievements, friends) live in accounts.ts and
 * api-accounts.ts; the game loop only cares about them at two points — binding
 * a seat to an account on join, and recording the game when it ends.
 *
 *   npm install && node main.ts            # serves + listens on :8080
 *   PORT=9000 node main.ts                 # custom port
 *   PORT=0    node main.ts                 # let the OS pick — the ready line
 *                                          # below prints the port it got
 */
import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { appendFile, readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Action, CardName, Seat } from '../engine/src/types.ts';
// R181: `legalActions` was imported here and never called — the seat-legality
// question goes through rooms.ts's `legalForSeat`. Removed; `noUnusedLocals`
// on server/tsconfig.json now catches the next one.
import { checkDeck, forcedAction, IllegalAction } from '../engine/src/apply.ts';
import { other, spectatorView, viewFor, redactEvent, redactLog, visibleToSeat } from './view.ts';
import { defaultDecks, importDeckText, importDeckUrl } from './decks.ts';
import { metaList, minRankedGames, publicDeckCounts, sharedDeck } from './publicdecks.ts';
import {
  applyToRoom, arrivalVerdict, clockSnapshot, createMatch, createRematch, createRoom, decidedWinner, deferAction,
  deferrableRefusal, dropRoom, getRoom,
  allRooms, expireOnTime,
  joinRefusal, joinableRoom, legalInRoom, openSegment, renameSeat, sanitizeClock,
  reserveRoomCode, resolveLobby, roomElementCount, roomLobby, type RoomCustom,
  restoreRooms, roomWaiting, segmentKey, setFullControl, setLobbyMethod, setLobbySubmission,
  setRoomDeck,
  setSeatUser, settleClock, takeDeferred, undoForSeat, unheldFor, unlockLobby,
  type Room, type SegKey,
  seatVerdict,
} from './rooms.ts';
// R216 — the scenario tester (docs/14). Everything about it is gated on
// ALGO_TESTER_TOKEN below; with no token set none of these routes exists.
import {
  OPPONENT, SANDBOX_ID, SCENARIOS, VERDICTS, isScenarioId, passiveMove, scenarioBrief, scenarioIds,
  ScenarioError, type Verdict,
} from './scenarios.ts';
import { engineVersion } from './engine-version.ts';
import { METHOD_LABELS, methodBlurbs, TRIO_METHODS, type TrioHistoryRow } from './trio.ts';
// BL-43: a creator's custom rules are checked with the resolver the home screen previews them with
import { checkCustomRules, fixedElements, rulesSummary, sanitizeCustomRules, type CustomRules } from '../ui/customrules.ts';
import { accountRoutes } from './api-accounts.ts';
import { addrOf, rateLimited, tokenOf, readBody } from './api-util.ts';
import { deckRoutes } from './api-decks.ts';
import { cardSearchRoutes } from './api-cardsearch.ts';
import { botRoutes } from './api-bot.ts';
import { linkRoutes } from './api-link.ts';
import { emit, since as eventsSince, BOOT_ID } from './hooks.ts';
import { CODE_ALPHABET } from './link.ts';
import { deckForPlay } from './collection.ts';
import { ACHIEVEMENTS } from './achievements.ts';
import { accountById, accountByName, accountForToken, gameHistory, loadAccounts, privateView, setBadge } from './accounts.ts';
import { ratedMode, type RatedMode } from './rating.ts';
import {
  acceptOffer, closeOffer, dequeue, enqueue, entryFor, expiredOffers, makeOffer, offerFor,
  OFFER_MS, pairable, pairUp, queueCounts, queued, bandFor,
  type Offer, type QueueEntry,
} from './queue.ts';
import { matchLengths, recordLiveGame, syncGamesDir } from './history.ts';
import { concessionWeight } from './concession.ts';
import { summarizeGame } from './stats.ts';
import { gamesDir, issuesFile, verdictsFile } from './statepaths.ts';
import { reportKind, reportSeverity, reportedBy, reporterLabel, type IssueRow } from './report-fields.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(HERE, '..', 'ui');
const GAMES_DIR = gamesDir();
/**
 * Where the 🐛 button's reports land. Overridable for the same reason
 * ALGO_GAMES_DIR and ALGO_ACCOUNTS_FILE are: this file is LIVE DATA on the
 * deploy box — it is the only copy of every playtest report ever filed — and
 * `npm test` has to be safe to run there. test-clock.ts posts two reports, and
 * before this existed it protected the real file by reading it into memory,
 * letting the server append to it, and writing the original back in a
 * `finally`. That works exactly until a run crashes or is killed between the
 * two, and then the reports are gone. Pointing the server somewhere else is
 * the version with no window.
 */
const ISSUES_FILE = issuesFile();
const ART_DIR = join(HERE, '..', '..', 'data', 'cards');
const PORT = Number(process.env['PORT'] ?? 8080);

// ── R216: the scenario tester's gate ──────────────────────────────────
//
// THIS CLIENT IS HEADING FOR A PUBLIC DEPLOY (docs/05, backlog BL-28). A route
// that mints a room with a hand-picked board, hand-picked resources and a
// scripted opponent is a cheating vector, not a debug convenience: anyone who
// found it could deal themselves whatever they liked and then invite a real
// opponent into it.
//
// So the gate is load-bearing and it fails CLOSED in two stages:
//
//  1. No ALGO_TESTER_TOKEN in the environment → the routes do not exist at
//     all. Not 403, not "forbidden" — 404, indistinguishable from any other
//     path this server does not serve. A deploy that never sets the variable
//     cannot leak the feature's existence, let alone the feature.
//  2. Token set, token wrong or missing on the request → 404 as well, and a
//     constant-time comparison so the response cannot be used to guess it.
//
// The scenario ROOM itself is an ordinary room once it exists (join by code
// like any other), which is deliberate: the design's whole point is that a
// scenario room is a normal room with a different deal, and giving it a
// second, privileged join path would be a second thing to get wrong.
const TESTER_TOKEN = process.env['ALGO_TESTER_TOKEN'] ?? '';
/**
 * Where the scenario tester's verdicts land, one JSON line each.
 *
 * Env-overridable for exactly the reason ISSUES_FILE above is: on the deploy
 * box this is the only copy of the owner's judgements, and `npm test` has to
 * be safe to run there. server/test-scenario.ts points it at a scratch file.
 */
const VERDICTS_FILE = verdictsFile();

/** Constant-time string compare, so a wrong token cannot be narrowed down by
 * timing. Length is allowed to leak — it always is, via the request. */
function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Is this request allowed to touch the tester at all? See TESTER_TOKEN. */
function testerAllowed(req: import('node:http').IncomingMessage, url: URL): boolean {
  if (!TESTER_TOKEN) return false;
  const header = req.headers['x-algo-tester'];
  const given = (typeof header === 'string' ? header : url.searchParams.get('token')) ?? '';
  return sameToken(given, TESTER_TOKEN);
}

// ── the Discord bot's gate ────────────────────────────────────────────
//
// R216's argument, applied again. /api/queue is unauthenticated and answers
// with numbers only, on purpose — see the paragraph above it. /api/bot/queue
// answers with NAMES, and /api/bot/profile reads a player's whole standing. So
// the same two-stage fail-closed applies: no ALGO_BOT_TOKEN and the routes do
// not exist; token set but wrong and they still do not exist. 404, never 403.
//
// ⚠ HEADER ONLY — no `?token=` fallback, unlike testerAllowed() above. The
// tester takes a query parameter because a human types its URL into a browser.
// A bot never does, and a token in a query string is a token in every access
// log between here and it. The inconsistency is deliberate; leave it.
const BOT_TOKEN = process.env['ALGO_BOT_TOKEN'] ?? '';

/** Is this request allowed to touch the bot routes at all? See BOT_TOKEN. */
function botAllowed(req: import('node:http').IncomingMessage): boolean {
  if (!BOT_TOKEN) return false;
  const header = req.headers['x-algo-bot'];
  return sameToken(typeof header === 'string' ? header : '', BOT_TOKEN);
}

/** When this process started. Its IDENTITY is hooks.BOOT_ID — one boot id,
 * shared, because the events endpoint and the health endpoint must agree about
 * which run they are describing. */
const STARTED_AT = Date.now();

// ── who is logged in right now ────────────────────────────────────────
//
// Counted rather than flagged: the same account can have two tabs open (the
// share-link flow encourages exactly that), and the first one to close must
// not make its owner look offline to their friends list.

const onlineCount = new Map<string, number>();
const isOnline = (userId: string): boolean => (onlineCount.get(userId) ?? 0) > 0;
function markOnline(userId: string, delta: 1 | -1): void {
  const n = (onlineCount.get(userId) ?? 0) + delta;
  if (n > 0) onlineCount.set(userId, n); else onlineCount.delete(userId);
}

// ── static file server ────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf', '.ico': 'image/x-icon',
};

/* ── STATIC FILES, THE WAY A BROWSER EXPECTS THEM ──────────────────────
 *
 * This used to send a content-type and nothing else: no Cache-Control, no
 * Last-Modified, no ETag, no compression. So 58 MB of card scans had no
 * validator to revalidate against and were re-pulled on every fresh load,
 * and the 2.3 MB bundle went out uncompressed each time.
 *
 * Two policies, chosen by the caller:
 *   'immutable'  — the scans and icons under data/, which never change in
 *                  place: cache for a year, never ask again.
 *   'revalidate' — everything under ui/: ask every time, but the answer to
 *                  "still the file I have?" is a 304 with no body.
 * Text is gzipped when the client accepts it; the compressed bundle is kept
 * in memory keyed on mtime, so it is compressed once per build, not per
 * request. An extension MIME does not know is a 404, not a download — the
 * catch-all under ui/ used to hand out main.ts as application/octet-stream. */
const gzipped = new Map<string, { mtimeMs: number; body: Buffer }>();

async function serveFile(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse,
                         path: string, cache: 'immutable' | 'revalidate'): Promise<unknown> {
  const type = MIME[extname(path).toLowerCase()];
  if (!type) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  }
  let info: import('node:fs').Stats;
  try { info = await stat(path); } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  }
  if (!info.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  }
  const headers: Record<string, string> = {
    'content-type': type,
    'x-content-type-options': 'nosniff',
    'cache-control': cache === 'immutable' ? 'public, max-age=31536000, immutable' : 'no-cache',
    'last-modified': info.mtime.toUTCString(),
  };
  const since = req.headers['if-modified-since'];
  if (typeof since === 'string' && Math.floor(info.mtimeMs / 1000) <= Math.floor(Date.parse(since) / 1000)) {
    res.writeHead(304, headers);
    return res.end();
  }
  try {
    let body: Buffer = await readFile(path);
    const wantsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    if (wantsGzip && /^(text\/|application\/json)/.test(type) && body.length > 1024) {
      const hit = gzipped.get(path);
      if (hit && hit.mtimeMs === info.mtimeMs) body = hit.body;
      else { body = gzipSync(body); gzipped.set(path, { mtimeMs: info.mtimeMs, body }); }
      headers['content-encoding'] = 'gzip';
      headers['vary'] = 'accept-encoding';
    }
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}


/** Room codes: 4 letters, skipping easily-confused ones. From the CSPRNG:
 * Math.random is V8's xorshift128+, whose state is recoverable from a few
 * dozen outputs, and /api/new hands anyone as many outputs as they like —
 * and the same stream minted Discord link codes (link.ts). Four letters is
 * 280k codes, which is small; what makes it enough is that guessing one is
 * rate-limited per socket (see `watch`). */
// the alphabet lives in link.ts, which room codes and link codes share
function freshRoomCode(): string {
  for (let tries = 0; tries < 100; tries++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!getRoom(code)) return code;
  }
  return 'R' + Date.now().toString(36).toUpperCase().slice(-4);
}

/* ⚠ EVERY REQUEST GOES THROUGH ONE CATCH. This used to be the createServer
 * callback itself, async, with nothing around it — so `new URL()` on a
 * malformed Host header, or `decodeURIComponent('/%')`, threw inside an async
 * function, became an unhandled rejection, and Node's default for that is to
 * EXIT. One bad URL from anyone ended every live game on the box. The handler
 * is now a named function and the callback below owns the failure: 400 to the
 * caller, a line in the log, and the process stays up. */
const sandboxCodes: string[] = [];
const SANDBOX_CAP = 50;
let judgeInFlight = 0;
const JUDGE_MAX_IN_FLIGHT = 4;
/* …and a per-ACCOUNT day cap, because the per-address brake below is per
 * address: behind the proxy that is real, but a guest account costs one POST
 * and a signed-in loop could still spend all day. Forty questions is more
 * than a person asks in a session; the number is a tester.env setting. */
const JUDGE_PER_ACCOUNT_PER_DAY = Math.max(1, Number(process.env['JUDGE_PER_ACCOUNT_PER_DAY'] ?? 40));
const judgeDaily = new Map<string, { day: string; n: number }>();
/** true when `userId` has used today's allowance; otherwise counts this one */
function judgeOverDailyCap(userId: string): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const d = judgeDaily.get(userId);
  if (d && d.day === day) {
    if (d.n >= JUDGE_PER_ACCOUNT_PER_DAY) return true;
    d.n++;
    return false;
  }
  if (judgeDaily.size > 5000) judgeDaily.clear();   // bounded; a new day empties it anyway
  judgeDaily.set(userId, { day, n: 1 });
  return false;
}
/** /api/cardinfo answers, by normalised name. Successes only — see the route. */
const cardinfoCache = new Map<string, string>();
const CARDINFO_CACHE_CAP = 2000;

async function handleRequest(req: import('node:http').IncomingMessage,
                             res: import('node:http').ServerResponse): Promise<unknown> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  let path = decodeURIComponent(url.pathname);
  if (path === '/' || path === '') path = '/index.html';

  // accounts, stats, achievements and friends live in their own module; it
  // answers true when the request was one of its own
  if (await accountRoutes(req, res, path, url, {
    online: isOnline, discordLinking: Boolean(BOT_TOKEN),
  })) return;
  // …and the saved deck collection everything under /api/decks
  if (await deckRoutes(req, res, path)) return;

  // the card query language (ui/cardsearch.ts) over HTTP, for readers that are
  // not the browser — the Discord bot above all, which is Python and so cannot
  // import the parser. Public: these rows already ship inside ui/bundle.js.
  if (cardSearchRoutes(req, res, path, url)) return;

  // …and the read-only window the Discord bot looks through. Gated on
  // ALGO_BOT_TOKEN; 404s in every direction without it (api-bot.ts).
  if (await botRoutes(req, res, path, url, {
    allowed: botAllowed(req),
    online: isOnline,
    rooms: () => [...allRooms()].length,
    invite: (seat, mode) => {
      const code = freshRoomCode();
      reserveRoomCode(code);
      return { code, joinPath: `/?ws=1&room=${code}&seat=${seat}&mode=${mode}` };
    },
    bootId: BOOT_ID,
    startedAt: STARTED_AT,
    events: eventsSince,
  })) return;

  // …and the player's own half of Discord linking, behind their session token.
  // Absent entirely when no bot token is configured: with nothing on the other
  // end to claim a code, offering to mint one would be a dead end.
  if (linkRoutes(req, res, path, { online: isOnline, enabled: Boolean(BOT_TOKEN) })) return;

  // home screen asks here for an unused room code. The room itself is only
  // created when the first player joins it over WS — but the code is RESERVED
  // here, and a reservation is the only thing that lets a join create a room
  // (rooms.ts). That is what makes a mistyped code an error instead of a new
  // empty game.
  if (path === '/api/new') {
    // BL-43: a POST carries custom rules for a live draft, and the elements if
    // the creator fixed them now. They are cleaned, resolved into a deal and
    // pool-checked HERE, once, and the reservation keeps the result; a refusal
    // is a 400 carrying the sentence the settings panel shows. A GET — every
    // standard game — is exactly what it always was.
    let custom: RoomCustom | undefined;
    let fixed: import('../engine/src/types.ts').Element[] | undefined;
    if (req.method === 'POST') {
      let body: Record<string, unknown>;
      try { body = await readBody(req); } catch { body = {}; }
      fixed = fixedElements(body['els'], sanitizeCustomRules(body['rules'])?.elements ?? 3);
      const verdict = checkCustomRules(body['rules'], fixed);
      if (verdict.error) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: verdict.error }));
      }
      if (verdict.rules && verdict.deal) custom = { rules: verdict.rules, deal: verdict.deal };
    }
    const code = freshRoomCode();
    reserveRoomCode(code, custom, custom ? fixed : undefined);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ code }));
  }

  /* BL-01/BL-42 — what is actually open, for the home screen.
   *
   * Unauthenticated on purpose: "is anybody around?" is the question a visitor
   * asks BEFORE deciding whether signing in is worth it, and a queue that only
   * shows itself to people already in it is a queue nobody joins first.
   *
   * ⚠ THIS USED TO BE COUNTS ONLY, and said so in capitals: "never who is
   * waiting". The owner reversed it on 2026-09-02 — "I wanted the queue to
   * show not just a count, but actually which games are open… you can see 'Oh,
   * that person is waiting for ranked live draft. I'd do that, sure' then just
   * click on it and go." A number cannot be clicked, and cannot tell you
   * whether it is a format you want.
   *
   * So it now names people, to logged-out visitors included. What it carries
   * is exactly what a public profile already shows plus the account id the
   * Join link needs (`id` below — /api/player answers it too); no Discord
   * handle, nothing about the deck. */
  if (path === '/api/queue') {
    const now = Date.now();
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      counts: queueCounts(),
      open: queued()
        // somebody mid-offer is not open to be joined; showing them would
        // hand out a Join button that cannot work
        .filter(e => !offerFor(e.userId))
        .sort((a, b) => a.since - b.since)
        .map(e => ({
          id: e.userId,
          username: e.username,
          mode: e.mode,
          ranked: e.ranked,
          rating: e.rating,
          waitedMs: now - e.since,
        })),
    }));
  }

  // playtest feedback: append one JSON line per report to ISSUES_FILE
  // (var/issues.jsonl unless ALGO_ISSUES_FILE says otherwise).
  // actionIndex = the room's action count at report time, so the moment can be
  // replayed later (replay-room.ts + slicing the action log).
  if (path === '/api/report' && req.method === 'POST') {
    if (rateLimited(addrOf(req), 'report', 10, 60_000)) {
      res.writeHead(429, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'too many reports from here — wait a minute' }));
    }
    try {
      const { room, seat, note, kind, severity, page } = await readBody(req, 64 * 1024, true) as {
        room?: string; seat?: number; note?: string; kind?: unknown; severity?: unknown; page?: unknown;
      };
      const code = String(room ?? '').toUpperCase().trim();
      const r = getRoom(code);   // unknown room: still log it (actionIndex null)
      const entry: IssueRow = {
        ts: new Date().toISOString(),
        room: code,
        seat: seat === 0 || seat === 1 ? seat : null,
        note: String(note ?? '').slice(0, 4000),
        actionIndex: r ? r.actions.length : null,
        // T6: the form's two choices, coerced against report-fields.ts — an
        // unknown or missing value is 'other' / null, never a refusal. The
        // note is the part that cannot be reconstructed; the ticket fields can.
        kind: reportKind(kind),
        severity: reportSeverity(severity),
        // BL-17 first slice: WHO, read off the bearer token the client sends
        // with the report — never off the body, which anyone can type
        by: reportedBy(accountForToken(tokenOf(req))),
        // the form is on every page now; a report from the deck builder says so
        ...(typeof page === 'string' && page.trim() ? { page: page.trim().slice(0, 32) } : {}),
      };
      await appendFile(ISSUES_FILE, JSON.stringify(entry) + '\n');
      // one line: a note with newlines in it could otherwise forge log lines
      console.log(`[report] ${entry.room || `(${entry.page ?? 'no room'})`} seat ${entry.seat ?? '?'} @action ${entry.actionIndex ?? '?'} `
        + `by ${reporterLabel(entry.by)} `
        + `[${entry.kind}${entry.severity ? '/' + entry.severity : ''}]: ${entry.note.replace(/\s*\n\s*/g, ' ⏎ ')}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(err instanceof Error ? err.message : err) }));
    }
    return;
  }

  /* ── BL-06: TEST MODE ────────────────────────────────────────────
   *
   * Deal a sandbox room and go. NOT behind ALGO_TESTER_TOKEN, and that is the
   * owner's decision rather than an oversight — asked directly on 2026-08-25
   * whether test mode should be gated, he said "Yes, for anyone." It is a
   * sandbox for exploring how cards interact as much as a debug harness, so
   * it is open on a public deploy with no flag and no badge.
   *
   * The room is created OUTRIGHT rather than reserved, for the same reason the
   * scenario route does it: a reservation is spent by the first joiner and
   * carries only mode/els/deck, so there would be nowhere to put the deal id.
   *
   * `mode` is 'shared' and not configurable. A sandbox mints its own cards and
   * its own mana, so a deck is beside the point — and shared is the only mode
   * whose `state.elements` is all seven, which is what makes "set your mana to
   * anything" mean anything.
   */
  if (path === '/api/sandbox/open') {
    if (rateLimited(addrOf(req), 'sandbox', 10, 60_000)) {
      res.writeHead(429, { 'content-type': 'text/plain' });
      return res.end('too many sandbox rooms from here — wait a minute');
    }
    // The seed only decides the LIBRARY here (the sandbox board is empty by
    // construction), but a fixed default still makes "open it again and try
    // that differently" reproducible, which is the whole point of the mode.
    const seedParam = Number(url.searchParams.get('seed'));
    const seed = Number.isFinite(seedParam) && seedParam > 0 ? (seedParam >>> 0) : 60600606;
    const code = freshRoomCode();
    let room;
    try {
      room = createRoom(code, seed, ['Seat 1', 'Seat 2'], 'shared', undefined, undefined, SANDBOX_ID);
    } catch (err) {
      const why = `could not deal a sandbox room: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[sandbox] ${why}`);
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: why }));
    }
    // ⚠ CAPPED. Each of these is a fully dealt room, and this route needs no
    // account: a loop over it used to leave N rooms resident for ever (nothing
    // ever freed a room) and N files replayed at the next boot. The oldest
    // sandbox goes when the fifty-first opens, file and all — a sandbox IS
    // persisted (BL-06, test-sandbox.ts), it just does not outlive the cap.
    sandboxCodes.push(room.code);
    while (sandboxCodes.length > SANDBOX_CAP) dropRoom(sandboxCodes.shift()!, false);
    const join = `/?ws=1&room=${room.code}&seat=0`;
    console.log(`[sandbox] → room ${room.code}`);
    if (url.searchParams.get('json') === '1') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, code: room.code, join }));
    }
    res.writeHead(302, { location: join });
    return res.end();
  }

  // ── BL-17 (first slice): grant or clear a trust mark ─────────────
  //
  // Behind the SAME gate as the scenario tester, for the same reason: this
  // is the owner's instrument, an unconfigured deploy must not admit the path
  // exists, and "only an admin can grant or revoke a badge" (BL-17) is
  // exactly what a secret only the box's operator holds gives. On the box:
  // deploy/badge.sh <name> [--owner] [--judge N] [--clear].
  if (path === '/api/admin/badge' && req.method === 'POST') {
    if (!testerAllowed(req, url)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    const b = await readBody(req);
    const name = String(b['name'] ?? '').slice(0, 40);
    const account = accountByName(name);
    if (!account) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: `no player called "${name}"` }));
    }
    const badge = setBadge(account, { owner: b['owner'], judge: b['judge'] });
    console.log(`[badge] ${account.username}: ${badge ? JSON.stringify(badge) : 'cleared'}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, name: account.username, badge }));
  }

  // ── R216: the scenario tester (docs/14) ──────────────────────────
  //
  // Both routes 404 unless ALGO_TESTER_TOKEN is set AND matched — see
  // testerAllowed(). The 404 is the point: an unconfigured deploy does not
  // admit that these paths mean anything.
  if (path.startsWith('/api/scenario/')) {
    if (!testerAllowed(req, url)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    // what is in the queue
    if (path === '/api/scenario/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        engine: engineVersion(),
        scenarios: scenarioIds().map(id => {
          const sc = SCENARIOS[id]!;
          return { id, card: sc.card, why: sc.why, expect: sc.expect,
            needsLiveOpponent: sc.needsLiveOpponent === true };
        }),
      }));
    }
    // deal one and go. The room is created OUTRIGHT (like a rematch) rather
    // than reserved: a reservation is spent by the first joiner and carries
    // only mode/els/deck, so there would be nowhere to put the scenario id.
    if (path === '/api/scenario/open') {
      const id = url.searchParams.get('id') ?? '';
      if (!isScenarioId(id)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: `no scenario '${id}'`, scenarios: scenarioIds() }));
      }
      // The seed is a normal room seed and the scenario board does not depend
      // on it — but the DECK does, and a scenario that draws a card should
      // draw the same one twice. So it is fixed unless asked otherwise, which
      // makes "open it again and try that differently" actually reproducible.
      const seedParam = Number(url.searchParams.get('seed'));
      const seed = Number.isFinite(seedParam) && seedParam > 0 ? (seedParam >>> 0) : 216216216;
      const code = freshRoomCode();
      let room;
      try {
        room = createRoom(code, seed, ['You', 'Tester Bot'], 'shared', undefined, undefined, id);
      } catch (err) {
        // a scenario whose setup this engine no longer accepts (ScenarioError)
        // is a BROKEN SCENARIO and says so — never a half-dealt board
        const why = err instanceof ScenarioError ? err.message
          : `could not deal ${id}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[scenario] ${why}`);
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: why }));
      }
      const brief = scenarioBrief(id)!;
      const join = `/?room=${room.code}&seat=0`;
      console.log(`[scenario] ${id} → room ${room.code} (${brief.card})`);
      if (url.searchParams.get('json') === '1') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, code: room.code, join, scenario: brief }));
      }
      // the owner types ONE url and lands on the board
      res.writeHead(302, { location: join });
      return res.end();
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  }

  /**
   * R216 — the verdict, one JSON line per judgement (docs/14 §5).
   *
   * Same shape and the same reasons as /api/report above: append-only JSONL,
   * an env-overridable path, and every fact the SERVER can know is stamped by
   * the server rather than trusted from the client. The client sends its
   * judgement; the room code, the scenario id, the action index and the engine
   * SHA are read off the room here. A verdict whose engine SHA came from the
   * browser would be worth nothing the moment anyone wanted to re-run it.
   *
   * Deliberately NOT behind the tester token. The token guards CREATING a
   * board; whoever is sitting in a scenario room has already been let in, and
   * making them carry a secret in order to say "this is broken" is the fastest
   * way to lose a verdict.
   */
  if (path === '/api/verdict' && req.method === 'POST') {
    if (rateLimited(addrOf(req), 'verdict', 10, 60_000)) {
      res.writeHead(429, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'too many verdicts from here — wait a minute' }));
    }
    try {
      const body = await readBody(req, 64 * 1024, true) as {
        room?: string; seat?: number; verdict?: string;
        note?: string; ruling?: string; clause?: string;
      };
      const code = String(body.room ?? '').toUpperCase().trim();
      const r = getRoom(code);
      const verdict = String(body.verdict ?? '');
      if (!VERDICTS.includes(verdict as Verdict)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: `verdict must be one of ${VERDICTS.join(', ')}` }));
      }
      if (!r || !r.scenario) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: `room ${code || '(none)'} is not a scenario room` }));
      }
      const entry = {
        ts: new Date().toISOString(),
        scenario: r.scenario,
        card: SCENARIOS[r.scenario]?.card ?? null,
        verdict,
        // R200: WHICH ENGINE this judgement was made against. Without it a
        // verdict is a claim about a game nobody can find again — the whole
        // reason the saved-game corpus is only ~39% usable.
        engine: engineVersion(),
        room: code,
        seat: body.seat === 0 || body.seat === 1 ? body.seat : null,
        // where in the log the owner was standing when he judged, so the
        // moment can be replayed (replay-room.ts + slicing the action log)
        actionIndex: r.actions.length,
        clause: typeof body.clause === 'string' && body.clause ? body.clause.slice(0, 400) : null,
        note: String(body.note ?? '').slice(0, 4000) || null,
        ruling: String(body.ruling ?? '').slice(0, 4000) || null,
      };
      await appendFile(VERDICTS_FILE, JSON.stringify(entry) + '\n');
      console.log(`[verdict] ${entry.scenario} ${entry.verdict} (${entry.room} @action ${entry.actionIndex})`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(err instanceof Error ? err.message : err) }));
    }
    return;
  }

  // constructed: the bundled test decks (attributed to their builders)
  if (path === '/api/deck/defaults') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ decks: defaultDecks() }));
  }

  /* The published half of the deck collection — the ONLY unauthed way to see
   * somebody else's list, and the reason it sits here beside /api/deck/defaults
   * rather than in api-decks.ts: everything under /api/decks* is behind a 401
   * by design, because a collection belongs to an account. These three answer
   * for anybody, logged in or not, and every one of them goes through
   * publicdecks.ts, which is where "is this deck allowed to be seen" is
   * decided exactly once. */

  // one shared deck, by id. A private deck and a nonexistent one give the SAME
  // answer on purpose — see sharedDeck.
  if (path === '/api/deck/shared') {
    const deck = sharedDeck(url.searchParams.get('id') ?? '');
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(deck ? { ok: true, deck } : { ok: false, error: 'no such deck' }));
  }

  // the metagame list: every PUBLIC deck, ranked. Unlisted decks are not here.
  if (path === '/api/deck/meta') {
    const sortParam = url.searchParams.get('sort') ?? '';
    const sort = (['winrate', 'games', 'new', 'name'] as const)
      .find(x => x === sortParam);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      decks: metaList({ ...(sort ? { sort } : {}) }),
      minGames: minRankedGames(),
    }));
  }

  // how many public decks play each card — the browser's "played in N decks"
  if (path === '/api/deck/played') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, counts: Object.fromEntries(publicDeckCounts()) }));
  }

  // constructed: turn an algomancer.cc link or a pasted list into engine
  // card names — { url } or { text } in, DeckInfo out (problems included)
  if (path === '/api/deck/import' && req.method === 'POST') {
    try {
      const { url: deckUrl, text } = await readBody(req, 64 * 1024, true) as { url?: string; text?: string };
      const deck = deckUrl
        ? await importDeckUrl(String(deckUrl))
        : importDeckText(String(text ?? ''));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, deck }));
    } catch (err) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(err instanceof Error ? err.message : err) }));
    }
    return;
  }

  // where the rules bot is. Loopback on the deploy box; .env.example's
  // ALGO_GAME_SERVER is the same setting in the other direction.
  const BOT_URL = process.env['ALGO_BOT_URL'] ?? 'http://127.0.0.1:8000';

  // right-click card inspector: card info + recorded rulings from the bot.
  // ⚠ ANONYMOUS, AND PROXIED INTO ANOTHER PROCESS. The bot's answer for a
  // name is static — the oracle JSON and the rulings file, 528 cards — so it
  // is served from memory after the first time and an anonymous loop cannot
  // turn one request here into one request there. Only successes are cached
  // (a junk name would otherwise fill the map, which is also why it is
  // capped), and a miss still pays the per-address brake.
  if (path === '/api/cardinfo') {
    const name = (url.searchParams.get('name') ?? '').slice(0, 80);
    const key = name.trim().toLowerCase();
    const cached = cardinfoCache.get(key);
    if (cached !== undefined) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(cached);
    }
    if (rateLimited(addrOf(req), 'cardinfo', 120, 60_000)) {
      res.writeHead(429, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ rulings: [], error: 'too many lookups from here — wait a minute' }));
    }
    try {
      const upstream = await fetch(`${BOT_URL}/api/card?name=${encodeURIComponent(name)}`, {
        signal: AbortSignal.timeout(10000),
      });
      const json = await upstream.text();
      if (upstream.ok) {
        if (cardinfoCache.size >= CARDINFO_CACHE_CAP) cardinfoCache.clear();
        cardinfoCache.set(key, json);
      }
      res.writeHead(upstream.status, { 'content-type': 'application/json' });
      return res.end(json);
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ rulings: [], error: String(err instanceof Error ? err.message : err) }));
    }
  }

  // the in-game judge popup: proxy to the rules bot (same box, :8000) so the
  // client needs no CORS and no second origin
  if (path === '/api/judge' && req.method === 'POST') {
    // ⚠ SOMEBODY ELSE'S INFERENCE BILL. Every judge question is a paid model
    // call held open for up to 60 s. So: a session (any account, a guest will
    // do — the point is that a loop has to have signed up first), a per-address
    // brake, a per-account day cap, a ceiling on how many can be in flight
    // at once, and a switch (ALGO_JUDGE_OFF) that turns the feature off
    // without a deploy when the bill says so.
    //
    // Deliberately NOT the R216 fail-closed shape (404 unless configured):
    // the scenario tester is a cheating vector no player should have, whereas
    // the judge is a feature every tester wants. Copying the 404 here would
    // read as consistency and be the wrong trade — a judge that is off says
    // so, so the player knows it is the server and not their question.
    if (process.env['ALGO_JUDGE_OFF']) {
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ answer: 'the judge is switched off on this server for now' }));
    }
    const asker = accountForToken(tokenOf(req));
    if (!asker) {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ answer: 'sign in (or play as a guest) to ask the judge' }));
    }
    if (rateLimited(addrOf(req), 'judge', 20, 60_000) || judgeInFlight >= JUDGE_MAX_IN_FLIGHT) {
      res.writeHead(429, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ answer: 'the judge is busy — try again in a moment' }));
    }
    if (judgeOverDailyCap(asker.id)) {
      res.writeHead(429, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        answer: `the judge has answered you ${JUDGE_PER_ACCOUNT_PER_DAY} times today — that is the daily limit`,
      }));
    }
    judgeInFlight++;
    try {
      const { question } = await readBody(req, 64 * 1024, true) as { question?: string };
      const upstream = await fetch(`${BOT_URL}/api/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: String(question ?? '').slice(0, 2000), history: [] }),
        signal: AbortSignal.timeout(60000),
      });
      const json = await upstream.text();
      res.writeHead(upstream.status, { 'content-type': 'application/json' });
      res.end(json);
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ answer: `the judge is unreachable: ${err instanceof Error ? err.message : err}` }));
    } finally {
      judgeInFlight--;
    }
    return;
  }

  // the rulebook the ? rules overlay frames (ui/assets.ts RULEBOOK_URL) — that
  // ONE file: data/rules/ is the bot's corpus, not a download area. Revalidated,
  // not immutable, because a new edition of the Manual keeps the same name.
  if (path === '/data/rules/Algomancy-Manual.pdf') {
    return serveFile(req, res, join(HERE, '..', '..', 'data', 'rules', 'Algomancy-Manual.pdf'), 'revalidate');
  }
  // card art: the UI asks for /data/cards/<Name>.jpg
  if (path.startsWith('/data/cards/')) {
    const rel = normalize(path.slice('/data/cards/'.length)).replace(/^(\.\.[/\\])+/, '');
    return serveFile(req, res, join(ART_DIR, rel), 'immutable');
  }
  // the game's real icon set (element pips, cost circles, markers)
  if (path.startsWith('/data/icons/')) {
    const rel = normalize(path.slice('/data/icons/'.length)).replace(/^(\.\.[/\\])+/, '');
    return serveFile(req, res, join(HERE, '..', '..', 'data', 'icons', rel), 'immutable');
  }
  // everything else is the client bundle in client/ui
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, '');
  return serveFile(req, res, join(UI_DIR, rel), 'revalidate');
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err: unknown) => {
    console.warn(`[http] ${req.method} ${req.url}: ${err instanceof Error ? err.message : String(err)}`);
    if (!res.headersSent) res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('bad request');
  });
});

// ── websocket game loop ───────────────────────────────────────────────

interface Conn { room: Room; seat: Seat; userId: string | null; }
/** BL-29: which room a WATCHING socket is watching. Deliberately a second map
 * rather than a nullable seat on `Conn`: `conns` means "this socket is a
 * player", every action path reads it, and a spectator that appeared there
 * with a seat of `null` would be one `??` away from being treated as one. */
const watching = new Map<WebSocket, Room>();
/** how many unknown room codes each socket has asked to watch — see `watch` */
const watchMisses = new WeakMap<WebSocket, number>();
const WATCH_MISS_LIMIT = 20;
const conns = new WeakMap<WebSocket, Conn>();

const send = (ws: WebSocket, obj: unknown): void => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
};

/* ── BL-01: THE QUEUE'S SOCKETS ───────────────────────────────────────────
 *
 * ⚠ A QUEUEING SOCKET IS IN NO ROOM, and until now nothing on this server
 * could describe one. `conns` gets an entry on JOIN and every entry carries a
 * `room`; `watching` carries a room too. A player sitting on the home screen
 * looking for a game has neither, so they need their own registry — and it is
 * a THIRD map for exactly the reason `watching` is a second one: the action
 * path reads `conns`, and a queueing socket that appeared there would be one
 * `??` away from being treated as a player at a table that does not exist.
 *
 * Keyed both ways. `queueSock` is what a sweep needs (userId → who to tell);
 * `queueUser` is what a close needs (socket → who just vanished).
 */
const queueSock = new Map<string, WebSocket>();
const queueUser = new Map<WebSocket, string>();

/** Stop tracking a socket's queue membership, and take its owner out of the
 * queue. Returns the offer they were being held by, if any. */
function leaveQueue(ws: WebSocket): Offer | undefined {
  const userId = queueUser.get(ws);
  if (!userId) return undefined;
  const entry = entryFor(userId);
  queueUser.delete(ws);
  if (queueSock.get(userId) === ws) queueSock.delete(userId);
  const offer = dequeue(userId);
  /* ⚠ HOOKED HERE, NOT AT THE TWO CALL SITES. Both the `q:'leave'` branch and
   * the socket-close handler funnel through this function, which mirrors how
   * touchWatchers is hooked to sendToSeat and nowhere else — enumerating push
   * sites is a mistake this file has already made twice.
   *
   * ⚠ THE `decline` PATH IS NOT HERE AND THAT IS CORRECT. It calls dequeue()
   * directly (see the ⚠ on that branch), so a declined offer surfaces as
   * `queue.lapse`'s `dropped[]`. It looks like a miss and is not. */
  if (entry) {
    const account = accountById(userId);
    emit({
      t: 'queue.leave', userId, username: entry.username,
      discordId: account?.linked?.discord?.id ?? null,
      mode: entry.mode, reason: 'left', counts: queueCounts(),
    });
  }
  return offer;
}

/** What one player is told about the queue: the counts everybody sees, plus
 * their own search if they have one, plus a live offer if they are in one. */
function queueStateFor(userId: string | null): Record<string, unknown> {
  const counts = queueCounts();
  const mine = userId ? entryFor(userId) : undefined;
  const offer = userId ? offerFor(userId) : undefined;
  const now = Date.now();
  return {
    t: 'queue',
    counts,
    searching: mine
      ? {
          mode: mine.mode, ranked: mine.ranked, since: mine.since,
          // BL-42: whose game they clicked, so the searching line can say
          // "challenging Ben" rather than a ± that does not apply to them
          vs: mine.vs ?? null,
          vsName: mine.vs ? (entryFor(mine.vs)?.username ?? null) : null,
          // ⚠ SENT, not recomputed in the browser. The widening schedule is
          // one table (queue.ts BAND_STEPS) and the client showing a ± the
          // server is not actually using is precisely the way a "ranked"
          // promise becomes a lie nobody notices.
          band: bandFor(mine, now),
        }
      : null,
    offer: offer
      ? {
          opponent: offer.entries[offer.entries[0]!.userId === userId ? 1 : 0]!.username,
          opponentRating: offer.entries[offer.entries[0]!.userId === userId ? 1 : 0]!.rating,
          mode: offer.entries[0]!.mode,
          accepted: offer.accepted[offer.entries[0]!.userId === userId ? 0 : 1],
          expiresIn: Math.max(0, OFFER_MS - (now - offer.made)),
        }
      : null,
  };
}

/** Push the queue state to one waiting player. */
function pushQueue(userId: string): void {
  const ws = queueSock.get(userId);
  if (ws) send(ws, queueStateFor(userId));
}

/** Push to everybody waiting — the counts moved, so every open queue screen
 * is now wrong. Cheap: this map holds people looking at a search spinner. */
function pushQueueAll(): void {
  for (const [userId, ws] of queueSock) send(ws, queueStateFor(userId));
}

/** send() to whoever is connected on `seat`; a no-op for an empty chair. */
function sendToSeat(room: Room, seat: Seat, obj: unknown): void {
  const sock = room.sockets[seat];
  if (sock) send(sock, obj);
  touchWatchers(room);
}

/* ── BL-29: KEEPING THE AUDIENCE IN STEP ──────────────────────────────────
 *
 * Hooked to `sendToSeat` and nowhere else, for the same reason R288's confirm
 * hooks `act()`: it is the ONE function every push to a player goes through —
 * updates, reveals, resyncs, game-over, the lobby — so a watcher cannot fall
 * behind through a path somebody adds later. Enumerating the push sites is the
 * failure this repo has already had twice (CT-135's three overlay lists).
 *
 * COALESCED to one push per turn of the event loop: a single action pushes to
 * both seats and would otherwise send the watchers two identical boards.
 */
const watchDirty = new Set<Room>();
function touchWatchers(room: Room): void {
  if (!room.watchers.size || watchDirty.has(room)) return;
  watchDirty.add(room);
  queueMicrotask(() => {
    watchDirty.delete(room);
    pushWatchers(room);
  });
}

/** The whole board, unredacted, to everybody watching. See view.ts's
 * `spectatorView` for why this one door bypasses `viewFor`. */
function pushWatchers(room: Room): void {
  if (!room.watchers.size) return;
  const payload = roomWaiting(room)
    ? { t: 'watching', room: room.code, boot: BOOT_ID, waiting: true, names: room.names, peers: peersOf(room) }
    : {
        t: 'watching', room: room.code, boot: BOOT_ID,
        view: spectatorView(room.state),
        // the FULL log: a watcher sees everything, which is what omniscient
        // means, and a redacted one would be the seat-by-seat view the owner
        // did not ask for
        log: room.events.filter(e => e.msg).map(e => e.msg),
        names: room.names, peers: peersOf(room),
        watchers: room.watchers.size,
        ...(room.frozen ? { frozen: room.frozen } : {}),
        ...(clockSnapshot(room) ? { clock: clockSnapshot(room) } : {}),
      };
  for (const ws of room.watchers) send(ws, payload);
}

/** Both seats, in seat order. */
const forEachSeat = (fn: (seat: Seat) => void): void => { fn(0); fn(1); };

/**
 * R216 — what the runner screen is told about the room it is in.
 *
 * The static half comes from scenarios.ts (`expect`, the derived clause list);
 * the moving half is the action index and the engine SHA, so the verdict bar
 * can show the owner exactly what a verdict would be stamped with before he
 * presses anything.
 */
function scenarioInfo(room: Room): unknown {
  const brief = room.scenario ? scenarioBrief(room.scenario) : null;
  if (!brief) return undefined;
  return {
    ...brief,
    verdicts: [...VERDICTS],
    actionIndex: room.actions.length,
    engine: engineVersion(),
    // docs/14 §4's ⚠ made visible rather than left implicit: the runner tells
    // the owner to open the other seat, and it can only do that if it knows
    // whether anybody is sitting there.
    opponentSeated: !!room.sockets[OPPONENT],
  };
}

/**
 * R216 — THE SCRIPTED OPPONENT (docs/14 §4).
 *
 * Most scenarios must not need a second tab. This drives seat 1 with the most
 * PASSIVE legal action available, so the owner drives one seat and the game
 * still moves: it passes priority, declines attacks, declines blocks, and
 * finishes every simultaneous step.
 *
 * ── the rules it plays by ────────────────────────────────────────────
 *
 * · It only ever runs in a scenario room, only when the scenario has not set
 *   `needsLiveOpponent`, and only while nobody is actually sitting in seat 1.
 *   A human who opens the other seat takes over mid-scenario and the bot goes
 *   quiet — which is what makes `needsLiveOpponent` a hint rather than a lock.
 * · Its actions are REAL actions through `applyToRoom`, so they are logged,
 *   replayed and undone like anything else. The bot does not need to be
 *   deterministic for a replay to be — the log already holds what it did —
 *   but it IS deterministic (first match in a fixed preference order), because
 *   a scenario that behaves differently on the second run is not a test.
 * · The CHOICE ITSELF is `passiveMove()` in scenarios.ts, not a rule written
 *   here. `186-scenario-library.test.ts` asserts that every scenario in the
 *   library can be answered by it, and a second copy of the preference order
 *   would turn that guard into a check on the copy — the `stripCode` /
 *   `65-effect-conformance` shape docs/13 §5 lists twice.
 */

/** Is the bot in charge of seat 1 right now? */
function botDrives(room: Room): boolean {
  if (room.frozen) return false;   // CT-160: nothing plays into a stopped game
  if (!room.scenario) return false;
  if (SCENARIOS[room.scenario]?.needsLiveOpponent) return false;
  if (room.sockets[OPPONENT]) return false;   // a human took the seat
  return decidedWinner(room) === null && !roomWaiting(room);
}

/**
 * Run the scripted opponent until it has nothing passive left to do, appending
 * its events to `into`.
 *
 * Called from inside the action tick, BEFORE the segment bookkeeping runs, so
 * the bot's moves are part of the same push as the move that provoked them and
 * the hidden-segment reveal logic sees the state it actually ends on.
 *
 * The step cap is not decoration. A scenario is a board somebody built, and a
 * bot that could be handed a state where its own passive move re-offers itself
 * would spin the event loop forever inside a request. Sixty is far more than
 * any scenario needs and small enough to notice.
 */
function scriptedOpponent(room: Room, into: import('../engine/src/types.ts').EngineEvent[]): void {
  if (!botDrives(room)) return;
  for (let step = 0; step < 60; step++) {
    const legal = legalInRoom(room, OPPONENT);
    if (!legal.length) return;
    // nothing passive on offer means the board is asking seat 1 for a real
    // decision this bot has no business inventing — stop, and let the runner
    // screen's "open the other seat" notice do its job
    const pick = passiveMove(legal);
    if (!pick) return;
    try {
      into.push(...applyToRoom(room, pick));
      drainForced(room, into);
    } catch (err) {
      // legalForSeat offered it and apply refused it: a real disagreement,
      // and one worth seeing rather than retrying around
      console.warn(`[scenario] ${room.code}: bot's ${pick.type} was refused —`,
        err instanceof Error ? err.message : err);
      return;
    }
    if (decidedWinner(room) !== null) return;
  }
  console.warn(`[scenario] ${room.code}: scripted opponent hit its 60-step cap`);
}

/** The fields every state push shares: redacted view, this seat's legal
 * actions, presence, clock. Each caller spreads its own extras on top — the
 * per-site drift (log replace vs incremental events, reveal, trio) is
 * deliberate, so it stays at the sites. */
function baseView(room: Room, seat: Seat) {
  // BL-26: null for a room with the clock off, and then the field is OMITTED
  // rather than sent as null — a client must draw no clocks at all, and the
  // honest wire shape for "there is no clock" is silence, not a pair of
  // numbers that never move. (Safe to omit on every push: the setting is fixed
  // at creation, so a room that has never sent a clock never will.)
  const clock = clockSnapshot(room);
  return {
    view: viewFor(room.state, seat, room.segSnapshot),
    // R216: the runner screen's payload, on every push. `undefined` for every
    // ordinary room — which is what keeps the tester out of normal play: a
    // client only ever draws the verdict bar when the SERVER says this room is
    // a scenario, and no client-side flag can make it appear.
    ...(room.scenario ? { scenario: scenarioInfo(room) } : {}),
    // BL-43: the custom rules, on every push of a custom room — the in-game
    // chip reads them. Absent on every standard room.
    ...(room.custom ? { custom: customInfo(room.custom) } : {}),
    // R150/CT-32: `legalForSeat`, not `legalActions` — inside a hidden
    // simultaneous segment the OTHER seat's open decision must not empty this
    // seat's list. See rooms.ts for why the engine's global gate is right in
    // battle and wrong here.
    // CT-160: asked of the ROOM (`legalInRoom`), because a FROZEN room offers
    // nothing however legal its state still is — the board is fine, the log
    // that produced it is not.
    legal: legalInRoom(room, seat),
    // CT-160: and WHY it is offering nothing, so a client can say so rather
    // than painting a board that ignores every click. Additive and `undefined`
    // for every ordinary room; both seats get the same sentence, and it is the
    // same one `applyToRoom` refuses by.
    ...(room.frozen ? { frozen: room.frozen } : {}),
    peers: peersOf(room),
    // BL-29: how many people are watching. Additive and absent when nobody is,
    // so a normal game's payload is byte-for-byte what it was. ⚠ The seats are
    // TOLD, deliberately: the owner chose an OMNISCIENT live spectator view
    // ("Just omniscient and live is fine for now"), and somebody who can see
    // both hands and talk to a player is a cheating vector — the one thing
    // that makes that manageable at a friendly table is that both players can
    // see there is an audience.
    ...(room.watchers.size ? { watchers: room.watchers.size } : {}),
    ...(clock ? { clock } : {}),
  };
}

/** Drain the forced steps a state owes (an empty board "attacks"/"blocks" by
 * itself), appending their events to `into`. */
function drainForced(room: Room, into: import('../engine/src/types.ts').EngineEvent[]): void {
  // CT-160: a frozen game must not advance ITSELF. `applyToRoom` would refuse
  // these anyway, but it refuses by throwing, and this drain runs on paths
  // whose catch is written for a player's illegal move — so the freeze is
  // stated here as a stop rather than discovered as an exception.
  if (room.frozen) return;
  for (let guard = 0; guard < 8; guard++) {
    const f = forcedAction(room.state);
    if (!f) break;
    // BL-18 — FULL CONTROL, on the fourth of the four things that act for you
    // and the one that lives on the server.
    //
    // ⚠ PER SEAT, NOT PER ROOM, and that is the whole of requirement 4: the
    // other player has not opted in and must not be made to wait on a window
    // that exists only because you did. `forcedAction` names the seat it is
    // answering for, so the drain stops only at a step belonging to somebody
    // who asked it to. Their opponent's own forced steps still drain.
    //
    // ⚠ AND IT IS A `break`, NOT A `continue`. Skipping does not change the
    // state, so `forcedAction` would keep offering the same step and the loop
    // would spin to its guard eight times for nothing.
    //
    // ⚠ THE SWITCH IS HERE AND NOT IN `forcedAction()`. BL-18's own note
    // records why as history: `forcedAction` is a pure question about a state
    // that 242 scripted tests rely on the answer to, and engine-side auto-skip
    // was tried once and reverted. What full control changes is whether
    // anybody ANSWERS the question for you.
    if (room.fullControl[f.seat as Seat]) break;
    into.push(...applyToRoom(room, f));
  }
}

/** Lobby state, attached to every message while the room is not a game yet.
 * Two kinds: a constructed room waiting for decks (`have`), and a draft room
 * choosing its trio (`trio`). undefined once the game is real.
 *
 * The other seat's SUBMISSION is deliberately absent — a pick you can see is
 * a pick you can counter, and the whole point of choosing blind is that you
 * each bring something you actually want. Only "are they locked in" travels. */
function waitingInfo(room: Room, seat: Seat): {
  have: [boolean, boolean];
  /** BL-26: this room's clock setting, in ms — `null` is "no clock". Present
   *  on the WAITING payload as well as the game one because the entry asks
   *  that BOTH SEATS SEE THE SETTING BEFORE THE FIRST ACTION, and a
   *  constructed or draft room spends its whole pre-game life here, where
   *  `baseView` (and therefore the clock snapshot) never runs. Sent as a bare
   *  setting rather than a snapshot: there is nothing ticking yet. */
  clockStart: number | null;
  /** BL-43: the room's custom rules, for the panel both seats see before the deal */
  custom?: CustomInfo;
  trio?: {
    method: string;
    /** BL-43: how many elements this lobby is choosing — 3 unless custom */
    count: number;
    methods: { id: string; label: string; blurb: string }[];
    locked: [boolean, boolean];
    /** your own submission, echoed back so a reconnect keeps your ranking */
    mine: unknown;
  };
} | undefined {
  if (!roomWaiting(room)) return undefined;
  const lobby = roomLobby(room);
  const count = roomElementCount(room);
  const blurbs = methodBlurbs(count);
  return {
    have: [!!room.decks[0], !!room.decks[1]],
    clockStart: room.clockStart,
    ...(room.custom ? { custom: customInfo(room.custom) } : {}),
    ...(lobby ? {
      trio: {
        method: lobby.method,
        count,
        // "run it back" only exists coming out of a game — offering it on a
        // fresh room would be a button with nothing behind it
        methods: TRIO_METHODS
          .filter(id => id !== 'again' || lobby.previousTrio?.length === count)
          .map(id => ({
            id,
            label: id === 'again' && lobby.previousTrio
              ? `Run it back — ${lobby.previousTrio.join(' + ')}` : METHOD_LABELS[id],
            blurb: blurbs[id],
          })),
        locked: [...lobby.locked] as [boolean, boolean],
        mine: lobby.submissions[seat],
      },
    } : {}),
  };
}

/** BL-43: what both seats are told about a room's custom rules — the rules as
 * chosen, their summary lines, and how many cards the deal leaves out. The
 * excluded NAMES stay on the server: a hundred names on every push buys nothing. */
interface CustomInfo { rules: CustomRules; summary: string[]; excluded: number }
function customInfo(custom: RoomCustom): CustomInfo {
  return { rules: custom.rules, summary: rulesSummary(custom.rules), excluded: custom.deal.excluded.length };
}

/** Past games involving either seat, for the "something we have not played"
 * method. Falls back to matching on NAME for a seat that is not logged in —
 * a signed-out Ben should still not be handed the trio he played yesterday. */
function trioHistoryFor(room: Room): TrioHistoryRow[] {
  const ids = new Set(room.users.filter((u): u is string => !!u));
  const names = new Set(room.names.map(n => n.trim().toLowerCase()));
  return gameHistory()
    // BL-43: a custom-rules game says nothing about which trios a pair has played
    .filter(g => !g.custom)
    .filter(g =>
      g.users.some(u => u && ids.has(u))
      || g.names.some(n => names.has(n.trim().toLowerCase())))
    .map(g => ({ els: g.els, playedAt: g.playedAt }));
}

/** Push an update to one seat: redacted view (+optional events). Inside a
 * hidden segment the opponent's half of the view comes from the freeze. */
function sendUpdate(room: Room, seat: Seat, events: import('../engine/src/types.ts').EngineEvent[]): void {
  // still waiting for decks: no game to show — just the lobby state
  if (roomWaiting(room)) {
    sendToSeat(room, seat, { t: 'update', waiting: waitingInfo(room, seat), peers: peersOf(room), names: room.names });
    return;
  }
  sendToSeat(room, seat, {
    t: 'update',
    ...baseView(room, seat),
    ...(events.length ? { events: events.filter(e => visibleToSeat(e, seat)).map(e => redactEvent(e, seat, room.names)) } : {}),
  });
}

/** The segment-end flush: like sendUpdate, but the opponent's held (hidden)
 * events travel in a separate `reveal` field so the client can show a "here
 * is what your opponent did" interstitial before play continues.
 *
 * `step` says WHICH segment just closed — the client renders a 'plan' close as
 * log lines and board animation only (it fires every single turn and the
 * payload is resource lines), and keeps the modal for 'haste' and 'deploy'. */
function sendReveal(room: Room, seat: Seat, revealEvents: import('../engine/src/types.ts').EngineEvent[], tailEvents: import('../engine/src/types.ts').EngineEvent[], step: SegKey): void {
  sendToSeat(room, seat, {
    t: 'update',
    step,
    ...baseView(room, seat),
    reveal: revealEvents.filter(e => visibleToSeat(e, seat)).map(e => redactEvent(e, seat, room.names)),
    events: [...revealEvents, ...tailEvents].filter(e => visibleToSeat(e, seat)).map(e => redactEvent(e, seat, room.names)),
  });
}

/** Push the current authoritative state to one seat as a redacted resync. */
function pushView(room: Room, seat: Seat): void {
  sendUpdate(room, seat, []);
}

/**
 * The game just ended: fold it into both players' stats and tell them what it
 * unlocked.
 *
 * Called only on the transition to a winner, because the fold is a rebuild
 * over the whole history and is not something to run on every action. An
 * abandoned game (the common case for us) is picked up instead by the boot
 * sync over var/games/ — see history.ts.
 */
function recordFinishedGame(room: Room): void {
  // R216: a scenario room is a test fixture, not a game — see history.ts's
  // matching guard in syncGamesDir(). Folding one into somebody's win/loss
  // record would let the instrument quietly rewrite the numbers it exists to
  // check. The post-game screen still works; only the RECORD is skipped.
  if (room.scenario) return;
  const before = new Map<string, Set<string>>();
  for (const id of room.users) {
    const a = accountById(id);
    if (a) before.set(a.id, new Set(Object.keys(a.achievements)));
  }
  let row;
  try {
    row = recordLiveGame(room);
  } catch (err) {
    // stats must never cost anybody their game — log it, and still show them
    // the post-game screen below
    console.error(`[accounts] could not record ${room.code}:`, err);
  }
  if (row) {
    console.log(`[accounts] recorded ${room.code}: ${row.game.names.join(' vs ')}, ` +
      `${row.game.finished ? `${row.game.names[row.game.winner ?? 0]} won` : 'unfinished'}`);
  }
  for (const seat of [0, 1] as Seat[]) {
    const unlocked: { id: string; name: string; desc: string; icon: string }[] = [];
    const account = accountById(room.users[seat]);
    if (account) {
      const had = before.get(account.id) ?? new Set<string>();
      for (const id of Object.keys(account.achievements)) {
        if (had.has(id)) continue;
        const def = ACHIEVEMENTS.find(a => a.id === id);
        unlocked.push(def ? { id, name: def.name, desc: def.desc, icon: def.icon }
          : { id, name: id, desc: '', icon: '🏅' });
      }
    }
    sendGameOver(room, seat, { row: row?.game ?? null, unlocked, account });
  }
}

/**
 * The post-game screen's payload: who won, both players' numbers, and — if
 * you were logged in — what it did to your profile.
 *
 * Sent to everyone, account or not. The stats come from the same
 * summarizeGame() the record uses, so the screen and the profile can never
 * disagree about what just happened.
 */
function sendGameOver(room: Room, seat: Seat, extra: {
  row: import('./accounts.ts').RecordedGame | null;
  unlocked: { id: string; name: string; desc: string; icon: string }[];
  account: ReturnType<typeof accountById>;
}): void {
  // checked up front, not left to sendToSeat: summarizeRoom() replays the
  // whole game, which is not worth doing for an empty chair
  if (!room.sockets[seat]) return;
  const row = extra.row ?? summarizeRoom(room);
  sendToSeat(room, seat, {
    t: 'gameover',
    seat,
    winner: row.winner ?? decidedWinner(room),
    names: room.names,
    mode: room.mode,
    els: row.els,
    turns: row.turns,
    seats: row.seats,
    // BL-37: how long this actually took. Sent only when there is a real
    // number — a game restored from a file written before the timer existed
    // has none, and the screen omits the line rather than claiming 0:00.
    ...(room.matchMs > 0 ? { matchMs: room.matchMs } : {}),
    rematch: [...room.rematch],
    rematchRoom: room.rematchRoom,
    // "is this game in somebody's profile" — asked of the record, not of
    // whether THIS call did the recording. A rejoin into a game recorded an
    // hour ago must not tell you it went uncounted.
    recorded: gameHistory().some(g => g.code === room.code && g.users.some(u => !!u)),
    // R290: a conceded game says how much it weighed. The weight is decided
    // HERE (the thresholds live in concession.ts), so the screen only has to
    // read a word and a turn — the room's stamp beats the row's because a
    // room nobody was signed in on has no row.
    ...((): object => {
      const c = room.concession ?? row.concession;
      return c ? { concession: { seat: c.seat, turn: c.turn, weight: concessionWeight({ concession: c }) } } : {};
    })(),
    ...(extra.unlocked.length ? { unlocked: extra.unlocked } : {}),
    ...(extra.account ? { me: privateView(extra.account, isOnline) } : {}),
  });
}

/** A summary for a room we could not record (nobody logged in, or the record
 * threw) — the post-game screen still deserves real numbers. */
function summarizeRoom(room: Room): import('./accounts.ts').RecordedGame {
  const s = summarizeGame({
    code: room.code, seed: room.seed, mode: room.mode, els: room.els,
    names: room.names, actions: room.actions, winner: room.winner,
    decks: room.mode === 'constructed' ? room.decks : undefined,
    // R216: without this the post-game screen would replay a scenario room on
    // the plain opening board and print numbers from a game nobody played
    scenario: room.scenario,
    // BL-43: and without this, a custom room on the standard deal
    ...(room.custom ? { custom: room.custom } : {}),
  });
  return {
    code: s.code, playedAt: s.playedAt, recordedAt: s.playedAt, mode: s.mode,
    els: s.els, finished: s.finished, winner: s.winner, turns: s.turns,
    diverged: s.skipped > 0, users: [...room.users], names: [...room.names],
    seats: s.seats,
    // R290: the stamp rides along even when nobody was signed in
    ...(room.concession ? { concession: room.concession } : {}),
    // BL-43: and the custom tag, so the post-game screen can say "not counted"
    ...(room.custom ? { custom: room.custom.rules } : {}),
  };
}

/** Push the current rematch state to both seats. */
function broadcastRematch(room: Room): void {
  forEachSeat(seat => sendToSeat(room, seat, { t: 'rematch', rematch: [...room.rematch], room: room.rematchRoom }));
}

/** Push freshly-produced events + new state to both seats (per-seat redacted). */
function broadcastAfterAction(room: Room, rawEvents: import('../engine/src/types.ts').EngineEvent[]): void {
  forEachSeat(seat => sendUpdate(room, seat, rawEvents));
}

/** The log lines `seat` is currently allowed to see (the opponent's moves in
 * the open hidden segment are filtered out — they arrive with the reveal). */
function visibleLog(room: Room, seat: Seat): string[] {
  const held = new Set(room.heldEvents[seat]);
  return redactLog(room.events.filter(e => !held.has(e)), seat, room.names);
}

const peersOf = (room: Room): [boolean, boolean] => [!!room.sockets[0], !!room.sockets[1]];

// The seat decision is `seatVerdict` in rooms.ts — a value a test can read
// without a socket, beside `joinRefusal` for the same reason. It used to be a
// `pickSeat` here that granted any REQUESTED seat, occupied or not, and the
// account was resolved eighteen lines after it: on a LAN with two known
// players that was the feature ("a stale tab must never dead-end the real
// person"); on an open URL it was anyone with a four-letter code sitting down
// in a live game and reading that hand. Now the account is resolved first and
// a seat CLAIMED by another account refuses.

/** Whose pages may open a socket here. No Origin at all is allowed — the test
 * suite's raw clients and any non-browser caller send none, and the auth is a
 * token in the message body that a foreign page cannot read anyway. What this
 * refuses is a page on some OTHER site driving watch/join/queue from a
 * visitor's browser. The deploy's own origin is whatever Host the request
 * came in on, or ALGO_PUBLIC_URL when a proxy in front rewrites Host. */
function originAllowed(req: import('node:http').IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const hostOf = (u: string): string | null => { try { return new URL(u).hostname; } catch { return null; } };
  const from = hostOf(origin);
  if (from === null) return false;
  const own = hostOf(`http://${req.headers.host ?? ''}`);
  const pub = process.env['ALGO_PUBLIC_URL'] ? hostOf(process.env['ALGO_PUBLIC_URL']) : null;
  return from === own || (pub !== null && from === pub);
}

/* ⚠ maxPayload: ws defaults to 100 MiB per frame, and the first thing done
 * with a frame is JSON.parse(String(raw)). Nothing this server accepts is
 * over a few KB — a full deck list is under 4 KB — so 256 KB is generous. */
const wss = new WebSocketServer({
  server, maxPayload: 256 * 1024,
  verifyClient: (info: { req: import('node:http').IncomingMessage }) => originAllowed(info.req),
});
wss.on('error', err => console.error('[ws] server error:', err));

/* ── KEEPALIVE ───────────────────────────────────────────────────────────
 *
 * ws sends no pings of its own. Without them a laptop lid, a NAT timeout or a
 * phone changing networks leaves a half-open TCP connection that never
 * closes: `room.sockets[seat]` stays populated, so the clock keeps billing a
 * seat nobody is at (this file's own rule is that a disconnected seat is NOT
 * billed) and sweepExpiry can eventually award the game to the other player
 * on time. Every 30 s: anyone who did not answer the last ping is terminated,
 * which fires 'close' and runs the ordinary leave path. */
const KEEPALIVE_MS = 30_000;
const alive = new WeakMap<WebSocket, boolean>();
const keepalive = setInterval(() => {
  for (const ws of wss.clients) {
    if (alive.get(ws) === false) { ws.terminate(); continue; }
    alive.set(ws, false);
    ws.ping();
  }
}, KEEPALIVE_MS);
keepalive.unref();

wss.on('connection', ws => {
  alive.set(ws, true);
  ws.on('pong', () => alive.set(ws, true));
  // without this, one malformed frame (say, invalid UTF-8 from a mangling
  // proxy) raises an unhandled 'error' event and takes down the whole
  // process — every game, not just the offending socket. Log and let the
  // library close the connection.
  ws.on('error', err => console.warn('[ws] socket error:', err instanceof Error ? err.message : err));
  ws.on('message', raw => {
    let msg: { t: string; room?: string; seat?: number; name?: string; mode?: string; els?: string[];
      token?: string; deck?: unknown; deckId?: unknown; action?: Action; cols?: unknown; send?: unknown;
      method?: unknown; submission?: unknown; lock?: unknown; want?: unknown;
      /** BL-26: the creator's chosen bank, in ms (0/'off' = no clock). Read
       *  only when this join CREATES the room; sanitizeClock takes it from
       *  there. Absent from every older client, which gets the default. */
      clock?: unknown;
      /** BL-18: this seat's "nothing may act for me" switch, off the browser
       *  that owns it. Never persisted; re-asserted on every join. */
      on?: unknown;
      /** BL-01: which of join / leave / accept / decline this queue message is */
      q?: unknown;
      /** BL-01: ranked (pair me near my rating) or open (anyone) */
      ranked?: unknown; vs?: unknown };
    try { msg = JSON.parse(String(raw)); } catch { return send(ws, { t: 'error', msg: 'bad JSON' }); }
    // ⚠ `JSON.parse("null")` SUCCEEDS. So do `[]`, `1` and `"x"`. The very next
    // line reads `msg.t`, and on null that throws inside a 'message' listener,
    // which is an uncaughtException — the whole process, every game, for a
    // four-byte frame from anyone. The type annotation above cannot see it:
    // JSON.parse returns `any`.
    if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') {
      return send(ws, { t: 'error', msg: 'bad message' });
    }

    /* ── BL-29: WATCH A LIVE ROOM ──────────────────────────────────────
     *
     * The owner, 2026-09-01: *"Just omniscient and live is fine for now."*
     *
     * ⚠ A WATCHER IS NEVER A SEAT, and that is the whole safety argument
     * rather than a nicety. `pickSeat` is not called, `conns` gets no entry,
     * and the action path below reads `conns` — so a watching socket has no
     * seat to act as and every game message it sends is dropped by
     * CONSTRUCTION, not by a check somebody has to remember. It is also why
     * the omniscient view (which really does bypass `viewFor`) cannot leak to
     * a player: a socket is one or the other and can never be both.
     *
     * ⚠ AND "NEVER BOTH" HAS TO BE GUARDED IN BOTH DIRECTIONS. Below, a seated
     * socket is refused a watch. The join branch does the mirror: a watching
     * socket that sits down is taken out of `room.watchers` first. Without
     * that second half the sentence above was false for a day — `{watch}`
     * then `{join}` on one connection kept every omniscient push coming to a
     * player, and test-spectate.ts §3 only ever tried the first order.
     *
     * It also never touches the clock: `clockRunning` asks about
     * `room.sockets`, which a watcher is not in, so an audience cannot start
     * or stop anybody's bank.
     */
    if (msg.t === 'watch') {
      const code = (msg.room ?? '').toUpperCase().trim();
      const room = code ? getRoom(code) : undefined;
      if (!room) {
        // ⚠ this is the guess path for the whole 4-letter code space, and it
        // answers with both players' hands on a hit. Twenty misses and the
        // socket is closed; a person mistyping a code will not get near it.
        const misses = (watchMisses.get(ws) ?? 0) + 1;
        watchMisses.set(ws, misses);
        if (misses > WATCH_MISS_LIMIT) return ws.close(1008, 'too many unknown room codes');
        return send(ws, { t: 'error', msg: `No game with code ${code}. Nothing to watch yet.` });
      }
      // a socket that is already a SEAT may not also watch: it would be handed
      // the opponent's hand, which is the one thing this must never do
      if (conns.has(ws)) return send(ws, { t: 'error', msg: 'this connection is already sitting at that table' });
      room.watchers.add(ws);
      watching.set(ws, room);
      pushWatchers(room);
      // and the players are told there is an audience — see Room.watchers
      forEachSeat(seat => pushView(room, seat));
      console.log(`[ws] ${code}: a spectator joined (${room.watchers.size} watching)`);
      return;
    }
    /* ── BL-01: THE MATCHMAKING QUEUE ─────────────────────────────────
     *
     * Handled HERE, above `join`, because it is the one message a socket may
     * send while it is in no room at all. Everything below this point either
     * names a room or reads `conns`, and neither exists for somebody sitting
     * on the home screen looking for a game.
     *
     * ⚠ SIGNED OUT IS REFUSED WITH A SENTENCE, not ignored. BL-01 asks for
     * that by name, and the reason is that "nothing happened when I clicked"
     * is the failure mode a queue cannot afford: the player cannot tell it
     * from an empty queue.
     */
    if (msg.t === 'queue') {
      const account = accountForToken(typeof msg.token === 'string' ? msg.token : undefined);
      if (!account) {
        return send(ws, { t: 'error', msg: 'the queue needs an account — sign in first, so a rated game has somebody to belong to' });
      }
      const q = String(msg.q ?? '');

      if (q === 'leave') {
        const dropped = leaveQueue(ws);
        if (dropped) resolveOffer(dropped, false);
        send(ws, queueStateFor(account.id));
        return pushQueueAll();
      }

      if (q === 'accept' || q === 'decline') {
        const offer = offerFor(account.id);
        // an offer that has already lapsed is not an error worth a red box —
        // the sweep has told them, and the state push says what is true now
        if (!offer) return send(ws, queueStateFor(account.id));
        if (q === 'decline') {
          // ⚠ dequeue, NOT leaveQueue: leaveQueue also drops the socket from
          // `queueSock`, and resolveOffer would then have nobody to send the
          // "you are out" state to — the decliner's own screen would keep
          // showing the offer it had just refused. resolveOffer untracks them.
          dequeue(account.id);
          resolveOffer(offer, false);
          return;
        }
        const both = acceptOffer(offer, account.id);
        if (!both) {
          // tell BOTH: the other side's screen should say "they accepted"
          for (const e of offer.entries) pushQueue(e.userId);
          return;
        }
        return resolveOffer(offer, true);
      }

      if (q !== 'join') return send(ws, { t: 'error', msg: `unknown queue command ${q}` });

      // ⚠ Already holding an offer? Answer it rather than starting a second
      // search. `pairable()` hides a held player, so a fresh entry here would
      // be invisible until the offer resolved and would then be deleted by
      // closeOffer — a search that silently never runs.
      if (offerFor(account.id)) return send(ws, queueStateFor(account.id));

      const mode: RatedMode | null = ratedMode(
        msg.mode === 'draft' ? 'draft' : msg.mode === 'constructed' ? 'constructed' : 'shared');
      if (!mode) {
        return send(ws, { t: 'error', msg: 'the queue runs constructed and live draft — pick one of those' });
      }

      // Constructed needs a deck AT QUEUE TIME, not at join time. The room is
      // built by the server the instant both sides accept, and createMatch
      // deals immediately — there is no deck-picker lobby to fall back on, so
      // a player without a deck has to be turned away here.
      let deck: CardName[] | undefined;
      let deckId: string | undefined;
      if (mode === 'constructed') {
        const id = typeof msg.deckId === 'string' ? msg.deckId : '';
        const chosen = id ? deckForPlay(account.id, id) : null;
        if (!chosen) {
          return send(ws, { t: 'error', msg: 'pick one of your saved decks before queueing for constructed' });
        }
        deck = chosen.cards;
        deckId = chosen.id;
      }

      // One entry per ACCOUNT. A second tab replaces the first and the first
      // is told why — the same move pickSeat makes for a seat, and for the
      // same reason: the newest connection is the one the player is looking at.
      const old = queueSock.get(account.id);
      if (old && old !== ws) {
        send(old, { t: 'error', msg: 'another tab took over your place in the queue' });
        queueUser.delete(old);
      }
      const ranked = msg.ranked !== false;
      const previous = entryFor(account.id);
      // ⚠ Changing format or ranked/open RESTARTS the wait; re-sending the
      // SAME search does not. It is a new search: carrying the old `since`
      // across a change would let somebody sit three minutes in an empty
      // draft queue and then arrive in constructed with an already-unlimited
      // band, matching a stranger 400 points away who was told ±100. And
      // restarting it on an identical re-send would let a client reset its
      // own wait by reconnecting, which is the same hole from the other side.
      const since = previous && previous.mode === mode && previous.ranked === ranked
        ? previous.since : Date.now();
      /* BL-42 — a DIRECT CHALLENGE: they clicked somebody's open game rather
       * than queueing into the pool. See QueueEntry.vs.
       *
       * ⚠ IF THAT PERSON HAS ALREADY GONE, DO NOT SILENTLY BECOME A NORMAL
       * SEARCH AGAINST THEIR NAME. The player clicked one specific game; a
       * targeted entry whose target has vanished would sit for ever, and one
       * that quietly fell back into the pool would hand them a stranger while
       * their screen still said whose game they had joined. So the target is
       * checked here, the `vs` is dropped, and they are TOLD it became an
       * ordinary search. `pairable()` hides anyone mid-offer, which is why a
       * target who is being offered a game right now counts as gone. */
      let vs: string | undefined;
      const wanted = typeof msg.vs === 'string' ? msg.vs : '';
      if (wanted) {
        const target = entryFor(wanted);
        if (target && target.mode === mode && !offerFor(wanted)) {
          vs = wanted;
        } else {
          send(ws, { t: 'error', msg: target
            ? `${target.username} is already being matched — you are in the queue instead`
            : 'that game is gone — you are in the queue instead' });
        }
      }

      const entry: QueueEntry = {
        userId: account.id, username: account.username, mode, ranked,
        rating: account.profile.rating[mode],
        ...(deck ? { deck } : {}), ...(deckId ? { deckId } : {}),
        ...(vs ? { vs } : {}),
        since,
      };
      queueSock.set(account.id, ws);
      queueUser.set(ws, account.id);
      enqueue(entry);
      console.log(`[queue] ${account.username} joined ${mode} `
        + `(${entry.ranked ? 'ranked' : 'open'}${vs ? `, challenging ${vs}` : ''})`);
      emit({
        t: 'queue.join', userId: account.id, username: account.username,
        discordId: account.linked?.discord?.id ?? null,
        mode, ranked: entry.ranked, rating: entry.rating, counts: queueCounts(),
      });
      sweepQueue();
      // sweepQueue may have matched them already, in which case this push
      // carries the offer rather than a search
      send(ws, queueStateFor(account.id));
      return pushQueueAll();
    }

    if (msg.t === 'join') {
      const code = (msg.room ?? '').toUpperCase().trim();
      // R274/CT-148: the sentence itself is rooms.ts's joinRefusal(), so it is
      // a value a test can read rather than something only a real socket can
      // provoke. Nothing about the decision changed when it moved.
      const refusal = joinRefusal(code);
      if (refusal !== null) {
        if (code) console.log(`[ws] join refused: no room ${code}`);
        return send(ws, { t: 'error', msg: refusal });
      }
      // a deck riding on the join (constructed): validate it up front — the
      // client sends its selected deck with every join and the server uses it
      // only where it matters (creating a constructed room / a waiting seat)
      let deckCards: CardName[] | null = null;
      if (msg.deck !== undefined) {
        const c = checkDeck(msg.deck);
        if (c.ok) deckCards = c.cards;
        else if (msg.mode === 'constructed' && !getRoom(code)) {
          return send(ws, { t: 'error', msg: `that deck is not playable: ${c.error}` });
        }
      }
      // mode + chosen trio only apply when this join CREATES the room (the
      // creator's link carries them); an existing room keeps its own.
      const mode = msg.mode === 'draft' ? 'draft' : msg.mode === 'constructed' ? 'constructed' : 'shared';
      if (mode === 'constructed' && !getRoom(code) && !deckCards) {
        return send(ws, { t: 'error', msg: 'a constructed game needs a deck — pick one on the home screen first' });
      }
      // BL-26: and the clock setting, which rides the join exactly as `mode`
      // and `els` do — and, exactly as they do, ONLY when this join creates the
      // room. joinableRoom ignores it for an existing room, which is what stops
      // the second player re-specifying their opponent's bank.
      const room = joinableRoom(code, mode,
        Array.isArray(msg.els) ? (msg.els as import('../engine/src/types.ts').Element[]) : undefined,
        deckCards ?? undefined,
        sanitizeClock(msg.clock));
      // only reachable if the reservation expired between the check above and
      // here; treated exactly like a typo
      if (!room) return send(ws, { t: 'error', msg: `No game with code ${code}. Start a new game to create one.` });
      // ⚠ the other half of the watcher/seat fence — see the ⚠ on `watch`.
      // A socket that was watching (this room or any other) stops the moment
      // it takes a seat, BEFORE the seat exists, so no push in between can
      // hand a player the unredacted board.
      const wasWatching = watching.get(ws);
      if (wasWatching) {
        wasWatching.watchers.delete(ws);
        watching.delete(ws);
        forEachSeat(s => pushView(wasWatching, s));
        console.log(`[ws] ${wasWatching.code}: a spectator sat down (${wasWatching.watchers.size} watching)`);
      }
      // accounts: the join carries the browser's session token. Resolved
      // BEFORE the seat is picked, because the seat decision needs to know
      // who is asking — see seatVerdict.
      const account = accountForToken(msg.token);
      const picked = seatVerdict(room, msg.seat, account?.id ?? null);
      if ('refuse' in picked) return send(ws, { t: 'error', msg: picked.refuse });
      const seat = picked.seat;
      // BL-18: …and this seat's own "nothing may act for me", which — unlike
      // `mode`, `els` and `clock` above — applies on EVERY join and not only
      // the creating one. It is not a property of the room being made, it is
      // this player's setting arriving with them, and re-asserting it here is
      // what makes it survive a reconnect, a seat takeover and a restart
      // without anything being persisted.
      setFullControl(room, seat, msg.on === true);
      // a re-join on the SAME connection (waiting room: "here is my deck now")
      // must not kick itself
      if (picked.kicked && picked.kicked !== ws) {
        send(picked.kicked, {
          t: 'kicked', msg: `another connection took over seat ${seat} — this tab is done (close it, or rejoin)`,
        });
        picked.kicked.close();
        console.log(`[ws] ${code}: seat ${seat} taken over by a new connection`);
      }
      // A logged-in player's ACCOUNT NAME wins over the typed name box — the
      // name is what the stats get filed under, so it must be the one thing
      // it cannot disagree with.
      const typed = typeof msg.name === 'string' ? msg.name.trim().slice(0, 24) : '';
      const name = account ? account.username : typed;
      if (name && name !== room.names[seat]) renameSeat(room, seat, name);
      // Only ever BIND here, never clear: seatVerdict has already refused a
      // signed-out joiner a claimed seat, so a null account at this point
      // means an unclaimed seat, and writing null over a claim is exactly
      // the "hijack erases the victim's stats" bug this replaced.
      if (account) setSeatUser(room, seat, account.id);
      room.sockets[seat] = ws;
      // BL-01: you are at a table now, so you are not looking for one. The
      // ordinary matched client navigates (which closes its queue socket);
      // this covers the odd case of a client that queues and then joins a
      // room over the SAME socket without closing it.
      const staleQueue = leaveQueue(ws);
      if (staleQueue) resolveOffer(staleQueue, false);
      const previous = conns.get(ws);
      if (previous?.userId) markOnline(previous.userId, -1);   // re-join on the same socket
      if (account) markOnline(account.id, 1);
      conns.set(ws, { room, seat, userId: account?.id ?? null });
      // constructed lobby: register this seat's deck; when it completes the
      // pair the real game is dealt and BOTH seats get a fresh 'joined'
      // Which SAVED deck this is, when the player brought one out of their
      // collection. Re-read server-side from the account rather than trusted
      // off the wire: the id is what a deck's win/loss record is folded on,
      // and a client that could name any id could credit any deck.
      const claimed = typeof msg.deckId === 'string' ? msg.deckId : null;
      const owned = deckForPlay(account?.id ?? null, claimed);
      const gameJustStarted = roomWaiting(room) && deckCards
        ? setRoomDeck(room, seat, deckCards, owned ? owned.id : null) : false;
      settleClock(room);   // a connected seat with pending work goes on the clock
      const joinedMsg = (s: Seat): unknown => roomWaiting(room)
        ? {
            t: 'joined', room: code, seat: s, boot: BOOT_ID,
            waiting: waitingInfo(room, s), peers: peersOf(room), names: room.names,
          }
        : {
            t: 'joined', room: code, seat: s, boot: BOOT_ID,
            ...baseView(room, s),
            log: visibleLog(room, s),
            names: room.names,
            // a reconnect mid-declaration picks the opponent's half-built
            // formation straight back up instead of waiting for their next move
            building: room.building[other(s)],
          };
      send(ws, joinedMsg(seat));
      // the account payload rides along so a reconnecting client does not
      // need a second round trip to know who it is
      if (account) send(ws, { t: 'me', me: privateView(account, isOnline) });
      // rejoining a game that is already over: the post-game screen is the
      // screen for that room now, so send it rather than a dead board
      if (!roomWaiting(room) && decidedWinner(room) !== null) {
        sendGameOver(room, seat, { row: null, unlocked: [], account });
      }
      // let the other seat know a peer arrived (fresh view refreshes presence;
      // on game start they need the full reset, i.e. their own 'joined')
      const otherSeat = other(seat);
      if (room.sockets[otherSeat]) {
        if (gameJustStarted) sendToSeat(room, otherSeat, joinedMsg(otherSeat));
        else pushView(room, otherSeat);
      }
      console.log(`[ws] ${code}: seat ${seat} joined${roomWaiting(room) ? ' (waiting for decks)' : gameJustStarted ? ' (constructed game started)' : ''}`);
      // R216: a scenario room may open with the table already waiting on seat
      // 1 (a scenario whose prologue ends on the opponent's window). Without
      // this the owner would join a board that never moves — which docs/14 §4
      // says reads as a hung game, and a hung game reads as a bug.
      if (room.scenario && !roomWaiting(room)) {
        const wasKey = room.segKey;
        const botEvents: import('../engine/src/types.ts').EngineEvent[] = [];
        scriptedOpponent(room, botEvents);
        if (botEvents.length) {
          if (segmentKey(room.state) !== wasKey) openSegment(room);
          forEachSeat(s => sendUpdate(room, s, botEvents));
        }
      }
      return;
    }

    // ── post-game: another one? ──
    if (msg.t === 'rematch') {
      const conn = conns.get(ws);
      if (!conn) return send(ws, { t: 'error', msg: 'join a room first' });
      const room = conn.room;
      // already moved: a late clicker follows their opponent rather than
      // starting a second, empty rematch
      if (room.rematchRoom) {
        return send(ws, { t: 'rematch', rematch: [...room.rematch], room: room.rematchRoom });
      }
      if (decidedWinner(room) === null) {
        return send(ws, { t: 'error', msg: 'the game is not over yet' });
      }
      room.rematch[conn.seat] = msg.want !== false;
      if (room.rematch[0] && room.rematch[1]) {
        // createRematch registers the room outright, so there is nothing to
        // reserve — a reservation is only for codes a join has yet to claim
        const next = createRematch(room, freshRoomCode());
        console.log(`[ws] ${room.code}: rematch → ${next.code} (${next.mode})`);
      }
      broadcastRematch(room);
      return;
    }

    // ── the draft lobby: choosing the trio, before there is a game ──
    if (msg.t === 'lobby') {
      const conn = conns.get(ws);
      if (!conn) return send(ws, { t: 'error', msg: 'join a room first' });
      const room = conn.room;
      const lobby = roomLobby(room);
      if (!lobby) return send(ws, { t: 'error', msg: 'this room is past choosing its elements' });

      if (msg.method !== undefined) setLobbyMethod(room, msg.method);
      else if (msg.lock === false) unlockLobby(room, conn.seat as 0 | 1);
      else setLobbySubmission(room, conn.seat as 0 | 1, msg.submission, msg.lock !== false);

      // both locked in: decide, deal, and tell them how it went
      const result = resolveLobby(room, trioHistoryFor(room));
      if (result) {
        // the working goes into the game log, where both players can read it
        // after the fact — a trio nobody can audit is a trio somebody
        // suspects, and this one is decided by a seeded draw they cannot see
        room.events.push({
          type: 'info',
          msg: `Trio: ${result.els.join(' + ')} — ${result.how}. ${result.detail.join(' ')}`,
          data: { els: result.els },
        } as unknown as import('../engine/src/types.ts').EngineEvent);
        settleClock(room);
        console.log(`[ws] ${room.code}: trio ${result.els.join('+')} (${lobby.method})`);
        forEachSeat(s => sendToSeat(room, s, {
          t: 'joined', room: room.code, seat: s, boot: BOOT_ID,
          ...baseView(room, s),
          log: visibleLog(room, s),
          names: room.names, building: null,
          trio: { els: result.els, how: result.how, detail: result.detail },
        }));
        return;
      }
      forEachSeat(s => pushView(room, s));
      return;
    }

    if (msg.t === 'action') {
      const conn = conns.get(ws);
      if (!conn) return send(ws, { t: 'error', msg: 'join a room first' });
      const action = msg.action;
      if (roomWaiting(conn.room)) return send(ws, { t: 'error', msg: 'the game has not started — waiting for both decks' });
      // CT-160: a stopped game, refused up front and by name. `applyToRoom`
      // enforces it regardless — this is here so the refusal arrives BEFORE
      // `arrivalVerdict` can park the action in the deferral queue, where it
      // would sit silently waiting for a decision that is never going to close.
      if (conn.room.frozen) return send(ws, { t: 'error', msg: conn.room.frozen });
      if (!action || typeof action !== 'object') return send(ws, { t: 'error', msg: 'no action' });
      if (action.seat !== conn.seat) {
        return send(ws, { t: 'error', msg: `you are seat ${conn.seat}, not seat ${action.seat}` });
      }
      try {
        const room = conn.room;
        // which hidden segment (if any) this action was taken INSIDE
        const wasKey = room.segKey;
        // R150/CT-32: an opponent's open decision inside a hidden simultaneous
        // segment PARKS this action instead of getting it refused by the
        // engine's global decision gate. Nothing goes back on the wire: the
        // client's own send-latch already paints "Sent — waiting for the
        // server…", which is the truth, and leaving the latch on is also what
        // stops the player double-sending the same deploy while it waits.
        if (arrivalVerdict(room.state, action, wasKey, room.deferred[conn.seat]!.length) === 'defer') {
          deferAction(room, action);
          return;
        }
        const hadWinner = room.state.winner !== null;
        // the committed declaration supersedes every in-progress one
        room.building = [null, null];
        // R154: the engine now takes most of what arrives during an opponent's
        // question, and refuses (atomically, draft discarded) only what would
        // have disturbed it — which cannot be known until it has run. That
        // refusal is a "not yet", so it goes in the same queue rather than
        // back on the wire.
        let events: import('../engine/src/types.ts').EngineEvent[];
        try {
          events = applyToRoom(room, action);
        } catch (err) {
          if (!deferrableRefusal(room, action, err)) throw err;
          deferAction(room, action);
          return;
        }
        drainForced(room, events);
        // …and now that this action may have CLOSED a decision, whatever the
        // other seat parked behind it lands, in arrival order. Their events are
        // kept separate: inside a segment they are still hidden from this seat
        // (applyToRoom has already put them in the held queue for the reveal),
        // so they must not ride out on this seat's update.
        const oppEvents: import('../engine/src/types.ts').EngineEvent[] = [];
        for (const parked of takeDeferred(room)) {
          // a parked action can itself open a decision for its own seat, which
          // re-parks whatever was queued behind it for the other one
          if (arrivalVerdict(room.state, parked, segmentKey(room.state),
            room.deferred[parked.seat]!.length) === 'defer') {
            deferAction(room, parked);
            continue;
          }
          const into = parked.seat === conn.seat ? events : oppEvents;
          try {
            into.push(...applyToRoom(room, parked));
            drainForced(room, into);
          } catch (err) {
            // R154: a released action can hit a question the action ahead of
            // it in this same drain has just opened — re-park it rather than
            // refuse it, exactly as on arrival
            if (deferrableRefusal(room, parked, err)) { deferAction(room, parked); continue; }
            // the world moved under it while it waited — the same refusal the
            // player would have got instantly, told to the seat it belongs to
            if (!(err instanceof IllegalAction)) throw err;
            sendToSeat(room, parked.seat, { t: 'error', msg: err.message });
          }
        }
        // R216 — the scripted opponent takes its turn INSIDE this tick, before
        // the segment bookkeeping below. Its events belong to the other seat,
        // so they ride in `oppEvents` exactly as a released deferred action of
        // theirs would; nothing here needs to know that a bot rather than a
        // person produced them. Placing it here (rather than after the
        // broadcast) is what keeps `nowKey` describing the state the players
        // are actually shown.
        scriptedOpponent(room, oppEvents);
        // ONE rule for all three hidden segments: the key changed → flush the
        // old segment's reveal, snapshot the new one. (Note that 'deploy' →
        // 'plan' is a close and an immediate re-open on the SAME action —
        // doneDeploying runs endTurn and startTurn — which this handles for
        // free where a deploy-shaped special case could not.)
        const nowKey = segmentKey(room.state);
        if (wasKey === nowKey) {
          if (wasKey) {
            // still inside the same hidden segment: each seat sees their own
            // events (the other seat's parked actions are theirs, and stay
            // held); a seat with nothing of its own gets a view refresh only,
            // because their half is frozen but the done-flags are public
            //
            // R235 — …PLUS whatever of this tick was NOT parked for them. The
            // hold is per-event now (rooms.ts `escapesHold`: a reveal is public
            // the moment it happens), so "the opponent's events" and "the
            // events held from the opponent" are no longer the same list, and
            // this branch is the only place the difference reaches the wire
            // live. Asked as a question about the QUEUE, so the rule about
            // which events those are lives in exactly one place; before R235
            // the answer was always [] and this was a no-op.
            sendUpdate(room, conn.seat, events);
            sendUpdate(room, other(conn.seat), [...oppEvents, ...unheldFor(room, other(conn.seat), events)]);
          } else {
            broadcastAfterAction(room, [...events, ...oppEvents]);
          }
        } else {
          const opp = other(conn.seat);
          // the segment is over, so everything applied this tick is public —
          // both seats' own final events (incl. the step/turn end) are the
          // tail of the reveal; split them out so it holds only what was
          // actually hidden
          const tail = [...events, ...oppEvents];
          const theirsHeld = wasKey ? room.heldEvents[opp]!.filter(e => !tail.includes(e)) : [];
          const mineHeld = wasKey ? room.heldEvents[conn.seat]!.filter(e => !tail.includes(e)) : [];
          // a parked action cannot survive the segment it was taken in: refuse
          // it rather than let it land in a phase its author never saw
          for (const seat of [0, 1] as Seat[]) {
            for (const lost of room.deferred[seat]!) {
              sendToSeat(room, seat, { t: 'error', msg: `${lost.type} was still waiting when the step ended` });
            }
          }
          room.deferred = [[], []];
          openSegment(room);   // close the old freeze, open the new one
          if (wasKey) {
            sendReveal(room, conn.seat, mineHeld, tail, wasKey);
            sendReveal(room, opp, theirsHeld, tail, wasKey);
          } else {
            broadcastAfterAction(room, tail);
          }
        }
        // the transition into a decided game — record it once
        if (!hadWinner && room.state.winner !== null) recordFinishedGame(room);
      } catch (err) {
        if (err instanceof IllegalAction) send(ws, { t: 'error', msg: err.message });
        else { console.error('[ws] apply error:', err); send(ws, { t: 'error', msg: 'internal error' }); }
      }
      return;
    }

    // The formation a seat is building, relayed to the other seat as they
    // build it (rooms.ts Room.building). Not an action: it never touches the
    // engine, never enters the log, and is dropped the moment a real action
    // lands. Sizes are capped so a rogue client cannot use it as a firehose.
    if (msg.t === 'building') {
      const conn = conns.get(ws);
      if (!conn || roomWaiting(conn.room)) return;
      const raw = msg;
      const ids = (v: unknown, max: number): number[] => (Array.isArray(v) ? v : [])
        .filter((n): n is number => Number.isInteger(n)).slice(0, max);
      const cols = (Array.isArray(raw.cols) ? raw.cols : []).slice(0, 12).map(c => ids(c, 2));
      const built = { cols, send: ids(raw.send, 12) };
      const empty = !built.cols.some(c => c.length) && !built.send.length;
      conn.room.building[conn.seat] = empty ? null : built;
      sendToSeat(conn.room, other(conn.seat), { t: 'building', seat: conn.seat, ...(empty ? { cols: [], send: [] } : built) });
      return;
    }

    /*
     * BL-18 — "nothing may act for me", from the browser that owns the
     * preference. Modelled on `building` directly above: per-seat, soft, never
     * an action, never logged, never persisted. The client re-asserts it on
     * every join (ui/main.ts sendJoin), so a reconnect, a seat takeover or a
     * server restart re-establishes it without anything being saved.
     *
     * It does NOT ride the join the way `clock` does. BL-26's bank is a
     * property of the room, chosen once and binding on both seats, which is
     * why a later join may not re-specify it; this is one seat's own setting,
     * changeable mid-game, binding on nobody else. Same wire, opposite shape.
     *
     * A change is ACKNOWLEDGED with a fresh view rather than silently: turning
     * it on mid-game can leave a forced step un-drained that the previous
     * push already advanced past, and the seat has to be shown the window it
     * has just taken responsibility for.
     */
    if (msg.t === 'fullcontrol') {
      const conn = conns.get(ws);
      if (!conn) return;
      if (!setFullControl(conn.room, conn.seat, msg.on === true)) return;
      if (roomWaiting(conn.room)) return;
      if (msg.on === true) {
        // this seat only: the other player's board has not changed, and
        // telling them would leak a preference that is nobody's business but
        // this one's. The push is not decoration — turning it ON can leave a
        // forced step un-drained, and the seat has to be shown the window it
        // has just taken responsibility for.
        pushView(conn.room, conn.seat);
        return;
      }
      // ⚠ AND TURNING IT OFF HAS TO RESUME THE DRAIN. Otherwise a player who
      // switches back mid-game is left sitting at a window they have just said
      // they do not want to answer, and the board never moves again on its own
      // — a stuck game produced by switching a preference OFF, which is the
      // worst shape this feature could take. Both seats see it, because a
      // forced step that lands is ordinary public game news.
      const resumed: import('../engine/src/types.ts').EngineEvent[] = [];
      drainForced(conn.room, resumed);
      broadcastAfterAction(conn.room, resumed);
      return;
    }

    if (msg.t === 'undo') {
      // single-step undo (docs/07 §15): only during the solo phases, and only
      // when the most recent action in the whole log is yours — anything the
      // opponent has acted on top of stays put.
      const conn = conns.get(ws);
      if (!conn) return send(ws, { t: 'error', msg: 'join a room first' });
      const room = conn.room;
      if (roomWaiting(room)) return send(ws, { t: 'error', msg: 'the game has not started — nothing to undo' });
      // THE WHOLE DECISION lives in rooms.ts (undoForSeat), not here. It is
      // the piece ledger #37 and then #76 were both about, and a decision
      // that only exists inside a WebSocket message handler can only be
      // tested by playing a whole game over a socket — which is why #37's
      // guards pinned the segment machinery and never the take-back itself.
      const outcome = undoForSeat(room, conn.seat);
      if (!outcome.ok) return send(ws, { t: 'error', msg: outcome.why });
      // Playtest VEAV: "I was able to see in the deployment recap that 'Rashi
      // undid an action.' No need to show that to the other person, it's just
      // confusing, since you can't see what they undid." It is not a move —
      // it is the ABSENCE of one, and the log already shows the absence. So
      // the note is `privateTo` the seat that pressed the button: it never
      // enters the opponent's log, held or revealed (view.ts visibleToSeat).
      // It still goes on room.events so the actor's own full-log replace below
      // (and any later resync) keeps it.
      const note = {
        type: 'note', msg: `${room.names[conn.seat]} undid their last action.`,
        data: { privateTo: conn.seat },
      } as unknown as import('../engine/src/types.ts').EngineEvent;
      room.events.push(note);
      forEachSeat(s => sendToSeat(room, s, {
        t: 'update',
        ...baseView(room, s),
        log: visibleLog(room, s),   // full log replace: lines were removed
      }));
      return;
    }

    send(ws, { t: 'error', msg: `unknown message ${msg.t}` });
  });

  ws.on('close', () => {
    // BL-29: a watcher leaving is not a seat leaving — no clock settles, no
    // presence changes, and the seats are told only so the audience count on
    // their screen stops being wrong.
    const watched = watching.get(ws);
    if (watched) {
      watching.delete(ws);
      watched.watchers.delete(ws);
      forEachSeat(seat => pushView(watched, seat));
      console.log(`[ws] ${watched.code}: a spectator left (${watched.watchers.size} watching)`);
    }
    /* BL-01 — "leaving the page or disconnecting removes you from the queue —
     * no ghost entries pairing with nobody". ⚠ It falls out of the TRANSPORT
     * rather than out of a rule somebody has to remember to apply at each of
     * the ways a player can go away: there is exactly one way a socket ends,
     * and this is it. A player held by an offer counts as declining, so the
     * other side is released rather than left watching a countdown for
     * somebody who has closed the tab. */
    const wasQueued = queueUser.has(ws);
    const droppedOffer = leaveQueue(ws);
    if (droppedOffer) resolveOffer(droppedOffer, false);
    else if (wasQueued) pushQueueAll();

    const conn = conns.get(ws);
    if (!conn) return;
    if (conn.userId) markOnline(conn.userId, -1);
    if (conn.room.sockets[conn.seat] === ws) {
      conn.room.sockets[conn.seat] = null;
      settleClock(conn.room);   // a disconnected seat is not billed
    }
    const otherSeat = other(conn.seat);
    if (conn.room.sockets[otherSeat]) pushView(conn.room, otherSeat);
    console.log(`[ws] ${conn.room.code}: seat ${conn.seat} left`);
  });
});

/* ── BL-27: THE SWEEP, and the trap it exists for ─────────────────────────
 *
 * NOTHING POLLS. `settleClock()` runs when something HAPPENS — an action, an
 * undo, a join, a leave — which means the exact situation this feature exists
 * for, both players stopped acting, is the one where it never runs and never
 * notices the zero. A clock that only ticks when somebody moves cannot catch
 * somebody who has stopped moving. So expiry needs something of its own.
 *
 * WHY A SWEEP RATHER THAN A PER-ROOM TIMER. A timer armed for the exact
 * moment a bank hits zero is more precise and much worse: it has to be
 * re-armed by every one of the seven sites that can change who is on the
 * clock, and a site that forgets is a game that never ends — the same silent
 * failure this entry is about, reintroduced one layer along. A sweep asks the
 * question from outside and cannot be forgotten.
 *
 * WHY IT COSTS NOTHING. `expiredSeat()`'s cheap gate is two subtractions
 * against the CACHED running set, so a room where nobody's clock is running —
 * every finished game, every empty room, every clockless room, every room with
 * a player disconnected — is skipped without touching the engine. Only a room
 * whose bank has actually reached zero pays for a settle.
 *
 * ⚠ `unref()`. This must never be the reason the process stays alive: a server
 * with nothing else to do should still be able to exit, and an interval is
 * exactly the thing that quietly stops that. The test suite spawns and kills
 * this server thirty times a run and would hang on every one.
 *
 * The three "must not fire" cases are all inside `expiredSeat` rather than
 * here — a clockless room (BL-26), a FROZEN one (CT-160: it refuses every
 * move, so losing for not moving would be absurd) and an already-decided one.
 * Stating them here as well would be a second copy of the rule.
 */
const EXPIRY_TICK_MS = 1000;
function sweepExpiry(): void {
  for (const room of allRooms()) {
    const out = expireOnTime(room);
    if (out === null) continue;
    // Both seats see it: the ⏱ LOG LINE, the stopped clocks, and an empty
    // legal list (legalInRoom refuses a game decided outside the state).
    // ⚠ `out.events`, not `pushView` — a view refresh with an empty event list
    // leaves both players staring at a stopped board and an unchanged log,
    // which is precisely the silent ending this entry exists to abolish. The
    // first draft did that; test-clock caught it.
    forEachSeat(s => sendUpdate(room, s, out.events));
    // …and then the ordinary end-of-game path, exactly as a concede takes.
    // The room's `winner` is already stamped, so the fold, the post-game
    // screen and the history row all see a decided game with no idea that the
    // clock rather than the board decided it.
    recordFinishedGame(room);
  }
}
/* ── BL-01: THE QUEUE TICK ────────────────────────────────────────────────
 *
 * Hung on the SAME interval as the expiry sweep, and for the arguments the
 * comment above already makes. A queue needs a heartbeat for two things that
 * happen when nobody clicks anything — the search band widening past the next
 * step, and an unanswered offer running out — and both want roughly the second
 * this interval already ticks at. A second timer would be a second thing to
 * remember to `unref()`.
 *
 * It is cheap in the empty case, which is the case it will be in nearly all
 * the time: `pairable()` over an empty Map, and a `filter` over no offers.
 */
function sweepQueue(): void {
  const now = Date.now();
  // (a) offers nobody answered. Whoever DID accept goes back in the queue with
  //     their original wait — see queue.ts `survivors`.
  for (const offer of expiredOffers(now)) resolveOffer(offer, false);
  // (b) new pairs
  for (const pair of pairUp(pairable(), now)) {
    makeOffer(pair, now);
    for (const e of pair) pushQueue(e.userId);
    console.log(`[queue] offered ${pair[0].username} vs ${pair[1].username} (${pair[0].mode})`);
    emit({
      t: 'queue.offer', mode: pair[0].mode,
      players: pair.map(e => ({ userId: e.userId, username: e.username, rating: e.rating })),
    });
  }
}

/**
 * An offer is over: either both sides accepted (build the room and push them
 * into it) or it fell through (return whoever accepted to the queue).
 *
 * ⚠ THE ROOM IS BUILT BEFORE EITHER CLIENT IS TOLD ANYTHING, exactly as the
 * rematch does. A client that was sent "go to CODE" and then found no room —
 * because the build threw between the two — would be stranded on a join
 * refusal with no way back to the queue.
 */
function resolveOffer(offer: Offer, settled: boolean): void {
  if (!settled) {
    const back = closeOffer(offer, false);
    const returning = new Set(back.map(e => e.userId));
    for (const e of offer.entries) {
      if (returning.has(e.userId)) {
        pushQueue(e.userId);
      } else {
        // dropped: their socket may still be open (they declined) or gone
        // (they closed the tab). Tell the one that is there — and tell it
        // BEFORE untracking, or the push has nowhere to go and the decliner
        // is left looking at the offer they just refused.
        const ws = queueSock.get(e.userId);
        if (ws) { send(ws, queueStateFor(e.userId)); queueUser.delete(ws); queueSock.delete(e.userId); }
      }
    }
    console.log(`[queue] offer lapsed; ${back.length} back in line`);
    emit({
      t: 'queue.lapse', mode: offer.entries[0].mode,
      backInLine: back.map(e => e.userId),
      dropped: offer.entries.filter(e => !back.some(b => b.userId === e.userId))
        .map(e => e.userId),
    });
    return pushQueueAll();
  }
  const [a, b] = offer.entries;
  // Which of them takes seat 0 is a coin flip. Anything derivable — longer
  // wait, higher rating, alphabetical — would hand somebody a systematic
  // side, and initiative is not symmetric in this game.
  const [first, second] = Math.random() < 0.5 ? [a, b] : [b, a];
  let room: Room;
  try {
    const code = freshRoomCode();
    reserveRoomCode(code);
    room = createMatch(first, second, first.mode, code);
  } catch (err) {
    console.error('[queue] could not build the match room:', err);
    // Put them back rather than dropping them: the failure was ours.
    closeOffer(offer, false);
    for (const e of offer.entries) {
      enqueue(e);
      const ws = queueSock.get(e.userId);
      if (ws) send(ws, { t: 'error', msg: 'could not start that game — still searching' });
      pushQueue(e.userId);
    }
    return pushQueueAll();
  }
  closeOffer(offer, true);
  for (const [i, e] of [first, second].entries()) {
    const ws = queueSock.get(e.userId);
    queueSock.delete(e.userId);
    if (ws) {
      queueUser.delete(ws);
      send(ws, { t: 'queue', matched: { room: room.code, seat: i, mode: room.mode } });
    }
  }
  console.log(`[queue] ${room.code}: ${first.username} vs ${second.username} (${room.mode}, rated)`);
  emit({
    t: 'queue.match', room: room.code, mode: room.mode,
    seats: [first, second].map((e, i) => ({
      userId: e.userId, username: e.username, seat: i, rating: e.rating,
    })),
  });
  pushQueueAll();
}

/* ── FINISHED ROOMS ARE FORGOTTEN ────────────────────────────────────────
 *
 * Nothing ever removed a room from the map: every game since boot stayed
 * resident and was walked by the sweep above once a second. A decided room
 * with nobody connected — no seat, no audience — is dropped an hour after
 * the sweep first sees it that way. The file is the record and stays; the
 * post-game screen and a rematch both happen well inside the hour, and a
 * reconnect after it finds the room by its file exactly as a restart would. */
const FORGET_AFTER_MS = 3600_000;
const finishedSeen = new Map<string, number>();
function sweepFinished(): void {
  const now = Date.now();
  for (const room of allRooms()) {
    const idle = decidedWinner(room) !== null && !room.sockets[0] && !room.sockets[1] && !room.watchers.size;
    if (!idle) { finishedSeen.delete(room.code); continue; }
    const first = finishedSeen.get(room.code);
    if (first === undefined) { finishedSeen.set(room.code, now); continue; }
    if (now - first < FORGET_AFTER_MS) continue;
    finishedSeen.delete(room.code);
    dropRoom(room.code);
    console.log(`[rooms] ${room.code}: finished and idle for an hour — forgotten (file kept)`);
  }
}

const expiryTimer = setInterval(() => { sweepExpiry(); sweepQueue(); sweepFinished(); }, EXPIRY_TICK_MS);
expiryTimer.unref();

loadAccounts();
restoreRooms();
// Every saved game becomes a match-history row and feeds the players' stats,
// finished or not — most of ours end when somebody has to go, and those games
// still happened. Cheap after the first pass: a game whose file has not been
// written since we last read it is skipped (history.ts).
{
  const t0 = Date.now();
  const report = syncGamesDir(GAMES_DIR);
  if (report.added || report.updated) {
    console.log(`[accounts] history sync: ${report.added} new, ${report.updated} updated ` +
      `(${Date.now() - t0}ms)`);
  }
  // BL-37: what a game actually costs, over the games that measured it. Logged
  // at startup because that is where the operator already looks and because
  // the number's whole purpose is choosing a bank — see `matchLengths` for why
  // `n` and the median are printed rather than the mean alone.
  const len = matchLengths(gameHistory());
  if (len.n) {
    const m = (x: number): string => `${Math.round(x / 60_000)}m`;
    console.log(`[accounts] match length over ${len.n} timed game${len.n === 1 ? '' : 's'}: `
      + `median ${m(len.median)}, mean ${m(len.mean)}, longest ${m(len.longest)}`);
  }
}
/* R204 / CT-85: print the port we ACTUALLY bound, not the one we asked for.
 *
 * The two are the same for `PORT=9000` and for the default, and different for
 * exactly one caller that matters: `PORT=0`, where the OS picks. That is how
 * the test suite now starts a server — bind :0, read the number back out of
 * this line — because the old way (a helper bound :0, read the number, CLOSED
 * the socket, and handed the bare number to a child that re-bound it) left a
 * window in which anything else on the box could take the port. With fifteen
 * agents running suites at once that window is not theoretical.
 *
 * So: if you change this line, keep a decimal port immediately after
 * `localhost:`. test-util.ts's spawnServer() parses it, and every server test
 * boots through that. */
/* ⚠ THE PROCESS STAYS UP. Every room is already durable on disk (rooms.ts
 * persists on each action), so the right answer to an unexpected throw is a
 * log line, not an exit that drops every socket and replays every game on
 * the way back. These are the backstop behind handleRequest's catch and the
 * message-shape check — not a licence to leave throws in the handlers. */
process.on('unhandledRejection', (err: unknown) => {
  console.error('[fatal?] unhandled rejection, staying up:', err instanceof Error ? err.stack ?? err.message : err);
});
process.on('uncaughtException', (err: Error) => {
  console.error('[fatal?] uncaught exception, staying up:', err.stack ?? err.message);
});

// HOST: behind the reverse proxy on the deploy box this is 127.0.0.1, so the
// plaintext port is not reachable from outside at all (the firewall is the
// second layer). Unset binds everything, which is what dev and the tests want.
server.listen(PORT, process.env['HOST'] || undefined, () => {
  const addr = server.address();
  const bound = typeof addr === 'object' && addr ? addr.port : PORT;
  console.log(`Algomancy server on http://localhost:${bound}  (open it, or /?ws=1&room=CODE&seat=0)`);
});
