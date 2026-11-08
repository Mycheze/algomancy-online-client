/* BL-17 — THE JUDGES' REVIEW QUEUE: badged judges read the answers the rules
 * bot gave and flag the bad ones, and the owner sees the flags first.
 *
 *   GET  /api/judge-review         the last answers with their flags (JudgeReviewDoc,
 *                                  ui/judgetypes.ts). A badged account or an admin
 *   POST /api/judge-review/flag    {id, action: 'flag', note} | {id, action: 'unflag'}
 *                                  — a judge's own flag; {id, action: 'resolve'} — the
 *                                  owner or an admin marks the flags on it dealt with
 *
 * The owner's decisions this is built on (backlog.ts BL-17 `decided`): judges
 * review AFTER the fact and flag — no human answer ever goes back into a live
 * game; an L3 judge's word settles a question, but nobody edits the rules or the
 * rulings corpus from here — "their feedback needs to be prioritized during
 * updates and engine fixes". So a flag is a durable row the owner works through
 * (var/judge-flags.jsonl, statepaths.ts judgeFlagsFile), and that is all it is.
 *
 * ── WHERE THE QUESTIONS COME FROM ─────────────────────────────────────────
 *
 * The rules bot's own log (bot/store.py recent_answers): every answer it gave,
 * on Discord, on its web page and in the in-game judge box. This server reads it
 * through the bot's GET /api/review/questions with the shared ALGO_BOT_TOKEN
 * (main.ts passes `fetchQuestions`; the tests pass a fixture). The bot down, or
 * no token: the page still lists every FLAGGED answer, from the copy each flag
 * row keeps, and says why the rest are missing.
 *
 * ── WHO MAY DO WHAT, DECIDED HERE ─────────────────────────────────────────
 *
 * Read and flag: an account with a judge or owner badge, or an admin. Anybody
 * else — signed out, a guest, a player — gets the 404 every unserved path gets,
 * the admin routes' rule: the questions are other players' words. Take back a
 * flag: its judge. Resolve: the owner or an admin. Account ids never leave this
 * file; a flag is shown as the judge's name and badge.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { JudgeFlag, JudgeMark, JudgeQuestion, JudgeReviewDoc } from '../ui/judgetypes.ts';
import { accountForToken, type Account } from './accounts.ts';
import { addrOf, json, rateLimited, readBody, tokenOf } from './api-util.ts';
import { reportedBy, type ReportedBy } from './report-fields.ts';
import { judgeFlagsFile } from './statepaths.ts';

export const JUDGE_REVIEW_LIMITS = {
  /** answers fetched from the bot for the page */
  list: 200,
  note: 1000,
  /** writes per address per minute */
  perMinute: 30,
  /** the journal stops taking writes past this */
  journalBytes: 5 * 1024 * 1024,
  requestBytes: 8 * 1024,
} as const;

/** one answer as the bot sends it (bot/store.py recent_answers) */
export type BotAnswer = Omit<JudgeQuestion, 'flags' | 'resolved'>;

export interface JudgeReviewDeps {
  /** the bot's last `limit` answers, newest first; throws when it cannot be read */
  fetchQuestions: (limit: number) => Promise<BotAnswer[]>;
}

/* ── the journal ──────────────────────────────────────────────────────── */

export interface JudgeFlagRow {
  v: 1;
  op: 'flag' | 'unflag' | 'resolve';
  /** the bot's response id */
  id: string;
  at: string;
  by: ReportedBy;
  /** an admin acting as one (resolve) */
  asAdmin?: true;
  note?: string;
  /** on a flag: the question and answer as they were, so the queue outlives the bot's log */
  q?: BotAnswer;
}

export function readFlags(): JudgeFlagRow[] {
  let text: string;
  try { text = readFileSync(judgeFlagsFile(), 'utf8'); } catch { return []; }
  const rows: JudgeFlagRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as JudgeFlagRow;
      if (r && r.v === 1 && typeof r.id === 'string' && r.by && typeof r.by.id === 'string') rows.push(r);
    } catch { /* a torn last line is skipped, never fatal */ }
  }
  return rows;
}

function appendFlag(row: JudgeFlagRow): void {
  const file = judgeFlagsFile();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(row) + '\n');
}

/** owner first, then L3, L2, L1 — the order the owner works through them */
export const markRank = (m: { owner?: boolean | true; judge?: number }): number =>
  m.owner ? 0 : m.judge === 3 ? 1 : m.judge === 2 ? 2 : m.judge === 1 ? 3 : 4;

const markOf = (by: ReportedBy): JudgeMark => ({
  name: by.name, ...(by.owner ? { owner: true as const } : {}), ...(by.judge ? { judge: by.judge } : {}),
});

export interface FoldedAnswer {
  /** judge account id → their standing flag */
  flags: Map<string, { by: ReportedBy; note: string; at: string }>;
  resolved?: { by: ReportedBy; at: string };
  q?: BotAnswer;
}

/** Replay the journal: a flag replaces that judge's earlier one, an unflag
 * takes it back, a resolve clears them all (a later flag reopens). A row its
 * writer could not have made — an unflag of somebody else's, a resolve by a
 * judge — is ignored, so a hand-edited line cannot do what the route refuses. */
export function foldFlags(rows: readonly JudgeFlagRow[]): Map<string, FoldedAnswer> {
  const out = new Map<string, FoldedAnswer>();
  for (const r of rows) {
    let a = out.get(r.id);
    if (!a) { a = { flags: new Map() }; out.set(r.id, a); }
    if (r.op === 'flag') {
      if (!r.by.owner && !r.by.judge) continue;
      a.flags.set(r.by.id, { by: r.by, note: String(r.note ?? ''), at: r.at });
      delete a.resolved;
      if (r.q) a.q = r.q;
    } else if (r.op === 'unflag') {
      a.flags.delete(r.by.id);
    } else if (r.op === 'resolve') {
      if (!r.by.owner && !r.asAdmin) continue;
      a.flags.clear();
      a.resolved = { by: r.by, at: r.at };
    }
  }
  return out;
}

/* ── the document ─────────────────────────────────────────────────────── */

const canReview = (a: Account): boolean => !!(a.badge?.owner || a.badge?.judge || a.admin);
const canResolve = (a: Account): boolean => !!(a.badge?.owner || a.admin);

function flagsFor(f: FoldedAnswer | undefined, me: Account): JudgeFlag[] {
  if (!f) return [];
  return [...f.flags.entries()]
    .map(([id, x]) => ({
      by: markOf(x.by), note: x.note, at: x.at,
      authoritative: !!(x.by.owner || x.by.judge === 3), mine: id === me.id,
    }))
    .sort((a, b) => markRank(a.by) - markRank(b.by) || b.at.localeCompare(a.at));
}

/** The page: every answer the bot sent plus every flagged one it no longer
 * has, flagged first — by the highest badge on it, then its newest flag — then
 * the rest newest first. */
export function reviewDoc(me: Account, answers: readonly BotAnswer[], folded: Map<string, FoldedAnswer>, error?: string): JudgeReviewDoc {
  const byId = new Map<string, BotAnswer>();
  for (const a of answers) if (!byId.has(a.id)) byId.set(a.id, a);
  for (const [id, f] of folded) if (!byId.has(id) && f.flags.size && f.q) byId.set(id, { ...f.q, id });
  const questions: JudgeQuestion[] = [...byId.values()].map(a => {
    const f = folded.get(a.id);
    const q: JudgeQuestion = { ...a, flags: flagsFor(f, me) };
    if (f?.resolved && !f.flags.size) q.resolved = { by: markOf(f.resolved.by), at: f.resolved.at };
    return q;
  });
  const top = (q: JudgeQuestion): number => q.flags.length ? Math.min(...q.flags.map(f => markRank(f.by))) : 9;
  const newest = (q: JudgeQuestion): string => q.flags.reduce((m, f) => f.at > m ? f.at : m, '');
  questions.sort((a, b) => top(a) - top(b) || newest(b).localeCompare(newest(a)) || String(b.ts ?? '').localeCompare(String(a.ts ?? '')));
  const you = { ...markOf(reportedBy(me)!), canResolve: canResolve(me) };
  return { ok: true, you, questions, ...(error ? { error } : {}) };
}

/* ── the routes ───────────────────────────────────────────────────────── */

function journalFull(): boolean {
  try { return statSync(judgeFlagsFile()).size >= JUDGE_REVIEW_LIMITS.journalBytes; } catch { return false; }
}

const notFound = (res: ServerResponse): void => json(res, { ok: false, error: 'not found' }, 404);

/** true when the path was this module's (answered, whatever the answer) */
export async function judgeReviewRoutes(req: IncomingMessage, res: ServerResponse, path: string, _url: URL, deps: JudgeReviewDeps): Promise<boolean> {
  if (path !== '/api/judge-review' && path !== '/api/judge-review/flag') return false;
  const me = accountForToken(tokenOf(req));
  if (!me || !canReview(me)) { notFound(res); return true; }

  if (path === '/api/judge-review' && req.method === 'GET') {
    let answers: BotAnswer[] = [];
    let error: string | undefined;
    try { answers = await deps.fetchQuestions(JUDGE_REVIEW_LIMITS.list); } catch (err) {
      error = `the rules bot's log could not be read (${err instanceof Error ? err.message : String(err)}), so only the flagged answers are listed`;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(reviewDoc(me, answers, foldFlags(readFlags()), error)));
    return true;
  }

  if (path === '/api/judge-review/flag' && req.method === 'POST') {
    if (rateLimited(addrOf(req), 'judge-review', JUDGE_REVIEW_LIMITS.perMinute, 60_000)) {
      json(res, { ok: false, error: 'too many changes at once — try again in a minute' }, 429); return true;
    }
    let body: Record<string, unknown>;
    try { body = await readBody(req, JUDGE_REVIEW_LIMITS.requestBytes, true); } catch {
      json(res, { ok: false, error: 'that request could not be read' }, 400); return true;
    }
    const id = typeof body['id'] === 'string' ? body['id'] : '';
    const action = body['action'];
    if (!/^[0-9a-f]{32}$/.test(id) || (action !== 'flag' && action !== 'unflag' && action !== 'resolve')) {
      json(res, { ok: false, error: 'an answer id and flag, unflag or resolve' }, 400); return true;
    }
    if (journalFull()) { json(res, { ok: false, error: 'the flag log is full — tell the owner' }, 507); return true; }
    const by = reportedBy(me)!;
    const at = new Date().toISOString();
    const folded = foldFlags(readFlags()).get(id);

    if (action === 'flag') {
      if (!me.badge?.owner && !me.badge?.judge) {
        json(res, { ok: false, error: 'only a judge or the owner flags an answer' }, 403); return true;
      }
      const note = typeof body['note'] === 'string' ? body['note'].trim() : '';
      if (!note) { json(res, { ok: false, error: 'say what is wrong with the answer' }, 400); return true; }
      if (note.length > JUDGE_REVIEW_LIMITS.note) {
        json(res, { ok: false, error: `keep it under ${JUDGE_REVIEW_LIMITS.note} characters` }, 400); return true;
      }
      // the copy the queue keeps: the bot's row if it still has it, else an earlier flag's
      let q: BotAnswer | undefined = folded?.q;
      try { q = (await deps.fetchQuestions(500)).find(a => a.id === id) ?? q; } catch { /* the earlier copy, if any */ }
      if (!q) { json(res, { ok: false, error: 'that answer is not in the rules bot\'s log' }, 404); return true; }
      appendFlag({ v: 1, op: 'flag', id, at, by, note, q });
    } else if (action === 'unflag') {
      if (!folded?.flags.has(me.id)) { json(res, { ok: false, error: 'you have no flag on that answer' }, 409); return true; }
      appendFlag({ v: 1, op: 'unflag', id, at, by });
    } else {
      if (!canResolve(me)) { json(res, { ok: false, error: 'only the owner marks a flag dealt with' }, 403); return true; }
      if (!folded?.flags.size) { json(res, { ok: false, error: 'nothing is flagged on that answer' }, 409); return true; }
      appendFlag({ v: 1, op: 'resolve', id, at, by, ...(me.badge?.owner ? {} : { asAdmin: true as const }) });
    }
    json(res, { ok: true });
    return true;
  }

  notFound(res);
  return true;
}
