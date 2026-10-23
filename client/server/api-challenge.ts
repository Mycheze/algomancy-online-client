/* Weekly challenges over HTTP (docs/21-weekly-challenges.md). Transport and
 * gates only: the calendar is challenges.ts, the keeping challenge-store.ts,
 * the replay challenge-worker.ts (the engine's verifyRun, off the main loop).
 *
 *   GET  /api/challenge                     anyone: this week, the closed weeks,
 *                                           and the caller's own best
 *   GET  /api/challenge/<id>/board          anyone: the leaderboard; decks and run ids
 *                                           only once the week has closed
 *   GET  /api/challenge/run/<runId>         a closed week's run: anyone; an open
 *                                           week's: its owner only (404 otherwise —
 *                                           a refusal must not say the run exists);
 *                                           with Watch's verdict on it (challenge-resim.ts)
 *   POST /api/challenge/run                 a NAMED account: submit a run
 *
 * ── WHO MAY SUBMIT ───────────────────────────────────────────────────────
 *
 * A signed-in account that is not a guest (`provisional`). Anybody can mint a
 * guest with one POST, so a board open to guests is a board anybody can fill
 * with throwaway names — the rules review page refuses guests for the same
 * reason (api-crreview.ts). A guest is told to name the account; it is the
 * same account afterwards, so the browser can submit the run it kept.
 *
 * No account id leaves this file: rows carry the account's NAME, as every
 * public view shows it.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { BOARD_KINDS, compareScores, type ChallengeDef } from '../engine/src/challenge.ts';
import { accountById, accountForToken } from './accounts.ts';
import { json, rateLimited, readBody, tokenOf } from './api-util.ts';
import {
  CHALLENGES, challengeById, challengeNow, currentChallenge, hasOpened, isClosed, pastChallenges,
  weekWindow,
} from './challenges.ts';
import {
  appendRun, appendSigs, bestOf, board, duplicateRun, entrants, mine, runById, runHash, runMeta,
} from './challenge-store.ts';
import { verifyInWorker } from './challenge-worker.ts';
import { olderRules, runVerdict } from './challenge-resim.ts';
import { engineVersion } from './engine-version.ts';

/** the caps docs/21 names — checked here, before a worker is asked */
export const MAX_DECK = 200;
export const MAX_ACTIONS = 20_000;
/** a 20 000-action log is ~2 MB of JSON; twice that and it is not a run */
export const MAX_BODY = 4 * 1024 * 1024;
/** runs one account may send an hour: far past a person iterating on a deck,
 * and a ceiling on how fast one account can grow runs.jsonl */
export const RUNS_PER_HOUR = 60;

export interface ChallengeCtx {
  /** the challenge clock; defaults to challengeNow() (ALGO_CHALLENGE_NOW or the real one) */
  now?: () => number;
  /** the calendar; defaults to CHALLENGES (tests pass their own) */
  rows?: readonly ChallengeDef[];
}

/** a row as the page sees it; its `par` is the row's own committed number */
export type ChallengeView = ChallengeDef & {
  opens: number; closes: number; closed: boolean; entrants: number;
};

function view(def: ChallengeDef, now: number): ChallengeView {
  const { opens, closes } = weekWindow(def);
  return { ...def, opens, closes, closed: isClosed(def, now), entrants: entrants(def.id) };
}

// ── the routes ────────────────────────────────────────────────────────

/** one verification in flight per account */
const inFlight = new Set<string>();

const RUN_ID = /^[A-Za-z0-9_-]{6,40}$/;

/** JSON, gzipped when the client takes it and it is worth it — a closed
 * board carries every deck, and a run its whole log (up to ~2 MB, ~10× smaller
 * packed), as api-cardstats.ts does for its own big body */
function sendBig(req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const text = JSON.stringify(body);
  if (text.length < 16 * 1024 || !/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(text);
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', vary: 'accept-encoding' });
  res.end(gzipSync(text));
}

function notFound(res: ServerResponse, what = 'not found'): true {
  json(res, { ok: false, error: what }, 404);
  return true;
}

export async function challengeRoutes(
  req: IncomingMessage, res: ServerResponse, path: string, _url: URL, ctx: ChallengeCtx = {},
): Promise<boolean> {
  if (path !== '/api/challenge' && !path.startsWith('/api/challenge/')) return false;
  const now = (ctx.now ?? challengeNow)();
  const rows = ctx.rows ?? CHALLENGES;
  /** a row a caller may ask about: it exists and its week has begun */
  const opened = (id: string): ChallengeDef | null => {
    const def = challengeById(id, rows);
    return def && hasOpened(def, now) ? def : null;
  };

  if (req.method === 'GET' && path === '/api/challenge') {
    const me = accountForToken(tokenOf(req));
    const cur = currentChallenge(now, rows);
    const out: Record<string, unknown> = {
      now,
      current: cur ? view(cur, now) : null,
      past: pastChallenges(now, rows).map(d => view(d, now)),
    };
    if (me) {
      // only rows that have opened: nothing about a future week, even empty
      const m = mine(me.id);
      out['mine'] = Object.fromEntries(Object.entries(m).filter(([id]) => opened(id)));
    }
    json(res, out);
    return true;
  }

  const boardMatch = /^\/api\/challenge\/([^/]+)\/board$/.exec(path);
  if (req.method === 'GET' && boardMatch) {
    const def = opened(boardMatch[1]!);
    if (!def) return notFound(res, 'no such challenge');
    sendBig(req, res, board(def, now, runId => olderRules(runId, rows)));
    return true;
  }

  const runMatch = /^\/api\/challenge\/run\/([^/]+)$/.exec(path);
  if (req.method === 'GET' && runMatch) {
    const runId = runMatch[1]!;
    if (!RUN_ID.test(runId)) return notFound(res);
    const meta = runMeta(runId);
    const def = meta ? challengeById(meta.challengeId, rows) : null;
    if (!meta || !def) return notFound(res);
    if (!isClosed(def, now)) {
      const me = accountForToken(tokenOf(req));
      if (!me || me.id !== meta.user) return notFound(res);
    }
    const r = runById(runId);
    if (!r) return notFound(res);
    // Watch's verdict (challenge-resim.ts): what this engine makes of the
    // run, against the fingerprints the verifier recorded
    const v = await runVerdict(runId, rows);
    sendBig(req, res, {
      runId: r.runId, challengeId: r.challengeId, name: nameOf(r),
      deck: r.deck, actions: r.actions, score: r.score, at: r.at,
      verdict: v.verdict, partedAt: v.partedAt, refusedAt: v.refusedAt, ...(v.older ? { older: true } : {}),
    });
    return true;
  }

  if (req.method === 'POST' && path === '/api/challenge/run') return submit(req, res, now, rows);

  return notFound(res);
}

/** the run's owner's name as public views show it now, else the stamped one */
const nameOf = (r: { user: string; name: string }): string => accountById(r.user)?.username ?? r.name;

async function submit(req: IncomingMessage, res: ServerResponse, now: number, rows: readonly ChallengeDef[]): Promise<true> {
  const me = accountForToken(tokenOf(req));
  if (!me) { json(res, { ok: false, error: 'sign in to submit a run' }, 401); return true; }
  if (me.provisional) { json(res, { ok: false, error: 'name your account first, then submit the run' }, 403); return true; }
  if (rateLimited(me.id, 'challenge-run', RUNS_PER_HOUR, 3_600_000)) {
    json(res, { ok: false, error: 'that is a lot of runs for one hour; try again later' }, 429);
    return true;
  }

  let b: Record<string, unknown>;
  try { b = await readBody(req, MAX_BODY, true); }
  catch (err) {
    const big = err instanceof Error && /too large/.test(err.message);
    json(res, { ok: false, error: big ? 'that run is too large' : 'that is not a run' }, big ? 413 : 400);
    return true;
  }

  const def = challengeById(b['challengeId'], rows);
  if (!def || !hasOpened(def, now)) { json(res, { ok: false, error: 'no such challenge' }, 404); return true; }
  const deck = b['deck'], actions = b['actions'];
  if (!Array.isArray(deck) || !deck.length) { json(res, { ok: false, error: 'a run needs its deck' }, 400); return true; }
  if (deck.length > MAX_DECK) { json(res, { ok: false, error: `a deck may hold at most ${MAX_DECK} cards` }, 400); return true; }
  if (!Array.isArray(actions) || !actions.length) { json(res, { ok: false, error: 'a run needs its actions' }, 400); return true; }
  if (actions.length > MAX_ACTIONS) { json(res, { ok: false, error: `a run may take at most ${MAX_ACTIONS} actions` }, 400); return true; }

  if (inFlight.has(me.id)) { json(res, { ok: false, error: 'your last run is still being checked' }, 429); return true; }
  inFlight.add(me.id);
  try {
    const r = await verifyInWorker({ def, deck, actions, maxActions: MAX_ACTIONS });
    if (!r.ok) {
      json(res, { ok: false, error: r.error, ...(r.at !== undefined ? { at: r.at } : {}) }, 422);
      return true;
    }
    const before = bestOf(def.id, me.id);
    const hash = runHash(r.deck, r.actions);
    // the same run sent twice (a retried submit, a double click) is one run
    const dup = duplicateRun(def.id, me.id, hash);
    let runId: string;
    if (dup) {
      runId = dup.runId;
    } else {
      try {
        const meta = appendRun({
          challengeId: def.id, user: me.id, name: me.username, at: now, deck: r.deck, score: r.score,
          engine: engineVersion(), actions: r.actions, hash,
        });
        runId = meta.runId;
        // its fingerprints, for Watch (challenge-sigs.ts). A run that lost
        // them is still a run — Watch shows it as unverified — so a failed
        // write is logged, not refused.
        try {
          appendSigs({ runId, engine: engineVersion(), sigs: r.sigs });
        } catch (err) {
          console.error(`[challenges] could not record the fingerprints of run ${runId}:`, err);
        }
      } catch (err) {
        console.error('[challenges] could not record a run:', err);
        json(res, { ok: false, error: 'the run checked out but could not be saved; try again' }, 500);
        return true;
      }
    }
    // the boards this run is a new best on (a later run that only ties is not)
    const newBest = dup ? [] : BOARD_KINDS.filter(k => !before || compareScores(k, r.score, before[k].score) < 0);
    const after = bestOf(def.id, me.id);
    const ranks = Object.fromEntries(BOARD_KINDS.map(k => [k, after?.[k].rank ?? 0]));
    json(res, { ok: true, runId, score: r.score, improved: newBest.length > 0, newBest, ranks });
    return true;
  } finally {
    inFlight.delete(me.id);
  }
}
