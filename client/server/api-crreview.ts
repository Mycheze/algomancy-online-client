/* `/api/cr/*` — the rules review page's HTTP surface: the comprehensive rules
 * as the page paints them, the comment threads on them, and the downloads.
 * The comments' journal and fold are crreview.ts; the wire types are
 * ui/crtypes.ts.
 *
 *   GET  /api/cr/review                   the document (CrReviewDoc). Public. Gzipped, ETag, 304
 *   GET  /api/cr/comments[?rev=N]         every thread, for this caller. Public to read
 *   POST /api/cr/comment                  add | edit | resolve | reopen | delete. A NAMED account
 *   GET  /api/cr/download?part=P&fmt=F    an attachment: the whole document, a chapter, a
 *                                         section, a separate file, or the comments
 *
 * ── THE DOCUMENT IS BUILT, NOT READ OFF DISK ─────────────────────────────
 *
 * Nothing review-shaped is committed. The routes ask a BUILDER for the
 * review — by default render.mjs's `buildReview()`, the same code paths that
 * write the committed .md/.html/.txt, so the page and the document cannot
 * say two different things — and cache its answer until one of the files it
 * read (`CrReview.inputs`) changes on disk. So a `cr:render` or a record edit
 * shows on the next request with no restart. A build that throws (a stale
 * ledger, a dangling pointer) answers 503 with its message; the page says so.
 * The tests inject a fixture builder instead (`CrRouteDeps`).
 *
 * ── WHO MAY DO WHAT, DECIDED HERE AND NOWHERE ELSE ───────────────────────
 *
 * Anybody may read, signed out included: the link is the invitation. Writing
 * needs a NAMED account — a guest is refused, because anybody can mint one
 * with a single unauthenticated POST. Edit and delete: the comment's author or
 * an admin. Resolve and reopen: the thread's author or an admin. An answer to
 * an owner question (`kind: 'answer'`): an admin. The page draws buttons from
 * `canEdit` / `canResolve` on each comment and from `CrYou`, all computed
 * here; it never decides anything itself. The raw journal (it holds account
 * ids) is admin-only and 404s to everybody else, the admin routes' rule.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import type {
  CrAnchor, CrDownloadFormat, CrOwnerTopic, CrPartFull, CrReview, CrReviewDoc, CrTarget, CrWholeFile, CrYou,
} from '../ui/crtypes.ts';
import { accountForToken, type Account } from './accounts.ts';
import { addrOf, json, rateLimited, readBody, tokenOf } from './api-util.ts';
import {
  appendRow, commentsMarkdown, fold, journalRev, mayChange, mayResolve, newCommentId, readJournal, viewFor,
  type CrCaller, type CrRow,
} from './crreview.ts';
import { reportedBy } from './report-fields.ts';
import { crCommentsFile } from './statepaths.ts';

/* ── limits ───────────────────────────────────────────────────────────── */

export const CR_LIMITS = {
  body: 4000, quote: 500, context: 64, edition: 80,
  /** writes per address per minute */
  perMinute: 30,
  /** writes per account per day */
  perDay: 300,
  /** the journal stops taking writes past this */
  journalBytes: 10 * 1024 * 1024,
  /** a request body */
  requestBytes: 16 * 1024,
} as const;

/* ── the review, from a builder, cached by its inputs' mtimes ─────────── */

export type CrBuilder = () => CrReview | Promise<CrReview>;

/** Wrap a builder: reuse its last answer until a file it read changes. The
 * inputs are re-stat'ed at most once per `recheckMs`, and a build that threw
 * is not retried for the same span, so a broken record costs one build per
 * second at most rather than one per request. */
export function cachedBuilder(build: CrBuilder, recheckMs = 1000): () => Promise<CrReview> {
  let last: { review?: CrReview; error?: unknown; stamp: string; checkedAt: number } | null = null;
  let pending: Promise<CrReview> | null = null;
  const stampOf = (paths: readonly string[]): string =>
    paths.map(p => { try { return statSync(p).mtimeMs; } catch { return -1; } }).join(',');
  return async () => {
    const now = Date.now();
    if (last && now - last.checkedAt < recheckMs) {
      if (last.review) return last.review;
      throw last.error;
    }
    if (last?.review && stampOf(last.review.inputs) === last.stamp) { last.checkedAt = now; return last.review; }
    if (pending) return pending;
    pending = (async () => {
      try {
        const review = await build();
        last = { review, stamp: stampOf(review.inputs), checkedAt: Date.now() };
        return review;
      } catch (error) {
        last = { error, stamp: '', checkedAt: Date.now() };
        throw error;
      } finally {
        pending = null;
      }
    })();
    return pending;
  };
}

// THE DEFAULT BUILDER — render.mjs `buildReview()`. Imported lazily: it scans
// the engine source and the test titles (about a second), which no request but
// this one should pay, and a server must boot even when the rules data does
// not build.
const defaultReview = cachedBuilder(async () => (await import('../engine/scripts/cr/render.mjs')).buildReview());

export interface CrRouteDeps {
  /** the review document; the default builds it from data/comprehensive-rules */
  review: () => Promise<CrReview>;
}

/* ── small helpers ────────────────────────────────────────────────────── */

function notFound(res: ServerResponse): true {
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
  return true;
}

const escHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** who is asking. `caller` is null for a reader who may not write */
function whoIs(req: IncomingMessage): { account?: Account; caller: CrCaller | null; you: CrYou } {
  const account = accountForToken(tokenOf(req));
  if (!account) return { caller: null, you: { name: null, canComment: false, why: 'signed-out' } };
  if (account.provisional) return { account, caller: null, you: { name: account.username, canComment: false, why: 'guest' } };
  const admin = account.admin === true;
  return {
    account, caller: { id: account.id, admin },
    you: { name: account.username, canComment: true, ...(admin ? { admin: true as const } : {}) },
  };
}

/** the page's half of a review: each part without its md and txt, and none
 * of the server's own fields (shell, files, inputs, born) */
export function reviewDoc(r: CrReview): CrReviewDoc {
  return {
    v: r.v, title: r.title, subtitle: r.subtitle, edition: r.edition, toc: r.toc,
    parts: r.parts.map(p => ({
      id: p.id, kind: p.kind, title: p.title, html: p.html,
      ...(p.num !== undefined ? { num: p.num } : {}), ...(p.chapter !== undefined ? { chapter: p.chapter } : {}),
    })),
    disc: r.disc, ownerQuestions: r.ownerQuestions, targets: r.targets,
    keys: r.keys, removed: r.removed, aliases: r.aliases,
  };
}

const packs = new WeakMap<CrReview, { json: string; gz: Buffer; etag: string }>();
function packed(r: CrReview): { json: string; gz: Buffer; etag: string } {
  let p = packs.get(r);
  if (!p) {
    const body = JSON.stringify(reviewDoc(r));
    p = { json: body, gz: gzipSync(body), etag: `"${createHash('sha1').update(body).digest('hex')}"` };
    packs.set(r, p);
  }
  return p;
}

/* ── writes: validation ───────────────────────────────────────────────── */

type Fail = { status: number; error: string };
const fail = (status: number, error: string): Fail => ({ status, error });

function cleanAnchor(raw: unknown): CrAnchor | null | Fail {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') return fail(400, 'anchor: must be an object');
  const a = raw as Record<string, unknown>;
  const { quote, prefix = '', suffix = '', start, edition, num } = a;
  if (typeof quote !== 'string' || quote.length < 1 || quote.length > CR_LIMITS.quote) return fail(400, `anchor.quote: 1 to ${CR_LIMITS.quote} characters`);
  if (typeof prefix !== 'string' || prefix.length > CR_LIMITS.context) return fail(400, `anchor.prefix: at most ${CR_LIMITS.context} characters`);
  if (typeof suffix !== 'string' || suffix.length > CR_LIMITS.context) return fail(400, `anchor.suffix: at most ${CR_LIMITS.context} characters`);
  if (typeof start !== 'number' || !Number.isInteger(start) || start < 0 || start > 10_000_000) return fail(400, 'anchor.start: a non-negative whole number');
  if (typeof edition !== 'string' || edition.length > CR_LIMITS.edition || /[\r\n]/.test(edition)) return fail(400, `anchor.edition: one line, at most ${CR_LIMITS.edition} characters`);
  if (num !== undefined && (typeof num !== 'string' || !/^[A-Za-z0-9.]{1,20}$/.test(num))) return fail(400, 'anchor.num: a rule number');
  return { quote, prefix, suffix, start, edition, ...(typeof num === 'string' ? { num } : {}) };
}

function cleanBody(raw: unknown, mayBeEmpty = false): string | Fail {
  if (typeof raw !== 'string' && !(mayBeEmpty && raw === undefined)) return fail(400, 'body: required');
  const body = (raw ?? '') as string;
  if (body.length > CR_LIMITS.body) return fail(400, `body: at most ${CR_LIMITS.body} characters`);
  if (!mayBeEmpty && !body.trim()) return fail(400, 'body: say something');
  return body;
}

const isFail = (x: unknown): x is Fail => typeof x === 'object' && x !== null && 'status' in x && 'error' in x;

/** the owner question a `disc:<id>` target is, if it is one */
function ownerQuestion(topics: readonly CrOwnerTopic[], target: string): CrOwnerTopic['items'][number] | undefined {
  if (!target.startsWith('disc:')) return undefined;
  const id = target.slice(5);
  for (const t of topics) for (const it of t.items) if (it.id === id) return it;
  return undefined;
}

const daily = new Map<string, { day: string; n: number }>();
/** true when `id` has used today's allowance; otherwise counts this one */
function overDailyCap(id: string): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const d = daily.get(id);
  if (d && d.day === day) {
    if (d.n >= CR_LIMITS.perDay) return true;
    d.n++;
    return false;
  }
  if (daily.size > 5000) daily.clear();
  daily.set(id, { day, n: 1 });
  return false;
}

/** Validate and record one op. Returns the row written, or why not. */
async function applyOp(b: Record<string, unknown>, account: Account, caller: CrCaller, deps: CrRouteDeps): Promise<{ id: string } | Fail> {
  const by = reportedBy(account)!;
  const at = new Date().toISOString();
  const items = fold(readJournal());
  const op = b['op'];

  if (op === 'add') {
    let review: CrReview;
    try { review = await deps.review(); } catch (e) { return fail(503, `the rules document did not build: ${e instanceof Error ? e.message : String(e)}`); }
    const target = b['target'];
    if (typeof target !== 'string' || !review.targets.includes(target as CrTarget)) return fail(400, 'target: not in the document');
    const parentRaw = b['parent'];
    let parent: string | null = null;
    if (parentRaw !== undefined && parentRaw !== null) {
      if (typeof parentRaw !== 'string') return fail(400, 'parent: a comment id');
      const p = items.get(parentRaw);
      if (!p || p.deleted || p.parent !== null || p.target !== target) return fail(400, 'parent: not a thread on this target');
      parent = parentRaw;
    }
    const anchor = cleanAnchor(b['anchor']);
    if (isFail(anchor)) return anchor;
    if (parent !== null && anchor !== null) return fail(400, 'anchor: a reply has none');

    const kind = b['kind'];
    const readingRaw = b['reading'];
    let answer: { kind: 'answer'; reading: string } | null = null;
    if (kind !== undefined && kind !== null) {
      if (kind !== 'answer') return fail(400, 'kind: only "answer"');
      if (!caller.admin) return fail(403, 'only an admin can answer an owner question');
      if (parent !== null) return fail(400, 'kind: an answer starts a thread');
      const q = ownerQuestion(review.ownerQuestions, target);
      if (!q) return fail(400, 'target: not an owner question');
      if (typeof readingRaw !== 'string' || !(readingRaw === 'other' || q.readings.includes(readingRaw))) {
        return fail(400, `reading: one of ${[...q.readings, 'other'].join(', ')}`);
      }
      answer = { kind: 'answer', reading: readingRaw };
    } else if (readingRaw !== undefined && readingRaw !== null) {
      return fail(400, 'reading: only on an answer');
    }
    // a lettered answer needs no words; "other" is the words
    const body = cleanBody(b['body'], answer !== null && answer.reading !== 'other');
    if (isFail(body)) return body;

    const row: CrRow = { v: 1, op: 'add', id: newCommentId(), at, by, target: target as CrTarget, parent, anchor, body, ...(answer ?? {}) };
    appendRow(row);
    return { id: row.id };
  }

  if (op === 'edit' || op === 'delete' || op === 'resolve' || op === 'reopen') {
    const id = b['id'];
    const c = typeof id === 'string' ? items.get(id) : undefined;
    if (!c || c.deleted) return fail(404, 'no such comment');
    const asAdmin = c.by.id !== caller.id ? { asAdmin: true as const } : {};
    if (op === 'edit' || op === 'delete') {
      if (!mayChange(c, caller)) return fail(403, `only the author or an admin can ${op} this`);
      if (op === 'edit') {
        const body = cleanBody(b['body'], c.kind === 'answer' && c.reading !== 'other');
        if (isFail(body)) return body;
        appendRow({ v: 1, op, id: c.id, at, by, body, ...asAdmin });
      } else {
        appendRow({ v: 1, op, id: c.id, at, by, ...asAdmin });
      }
      return { id: c.id };
    }
    if (c.parent !== null) return fail(400, 'only a thread can be resolved, not a reply');
    if (!mayResolve(c, caller)) return fail(403, 'only the author or an admin can resolve this');
    appendRow({ v: 1, op, id: c.id, at, by, ...asAdmin });
    return { id: c.id };
  }
  return fail(400, 'op: add, edit, resolve, reopen or delete');
}

/* ── downloads ────────────────────────────────────────────────────────── */

const MIME: Record<CrDownloadFormat, string> = {
  md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8', jsonl: 'application/x-ndjson; charset=utf-8',
};
const WHOLE: Record<string, CrWholeFile> = { annexD: 'annexD', disc: 'disc', oq: 'oq', changelog: 'changelog' };
const safeName = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, '-');

function attachment(res: ServerResponse, name: string, fmt: CrDownloadFormat, body: string | Buffer): true {
  res.writeHead(200, {
    'content-type': MIME[fmt],
    'content-disposition': `attachment; filename="${safeName(name)}"`,
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  });
  res.end(body);
  return true;
}

/** A section or chapter as a standalone page: the renderer's own shell with
 * its two holes filled. Function replacers, because a `$` in the rules text
 * must not be read as a replacement pattern. */
export function fillShell(shell: string, title: string, body: string): string {
  return shell.replace('{{TITLE}}', () => escHtml(title)).replace('{{BODY}}', () => body);
}

function partsFor(r: CrReview, part: string): { name: string; title: string; parts: CrPartFull[] } | null {
  if (part.startsWith('sec:')) {
    const num = part.slice(4);
    const p = r.parts.find(x => x.kind === 'section' && x.num === num);
    return p ? { name: `section-${num}`, title: `${r.title}: ${num} ${p.title}`, parts: [p] } : null;
  }
  if (part.startsWith('ch:')) {
    const ch = part.slice(3);
    const entry = r.toc.find(t => t.id === `ch${ch}`);
    if (!entry?.sections) return null;
    const byId = new Map(r.parts.map(p => [p.id, p]));
    const ids = [...(entry.lead ? [entry.lead] : []), ...entry.sections.map(s => s.part)];
    const parts = ids.map(id => byId.get(id)).filter((p): p is CrPartFull => !!p);
    return parts.length ? { name: `chapter-${ch}`, title: `${r.title}: ${entry.title}`, parts } : null;
  }
  return null;
}

async function download(req: IncomingMessage, res: ServerResponse, url: URL, deps: CrRouteDeps): Promise<true> {
  const part = url.searchParams.get('part') ?? '';
  const fmtRaw = url.searchParams.get('fmt') ?? 'md';
  if (!(fmtRaw in MIME)) { json(res, { ok: false, error: 'fmt: md, txt or html' }, 400); return true; }
  const fmt = fmtRaw as CrDownloadFormat;

  if (part === 'comments' && fmt === 'jsonl') {
    // account ids are in it: an admin's, or nothing at all
    if (!whoIs(req).you.admin) return notFound(res);
    let raw: Buffer = Buffer.alloc(0);
    try { raw = readFileSync(crCommentsFile()); } catch { /* none yet */ }
    return attachment(res, 'cr-comments.jsonl', fmt, raw);
  }
  if (fmt === 'jsonl') { json(res, { ok: false, error: 'fmt: jsonl is the raw comments file only' }, 400); return true; }

  let r: CrReview;
  try { r = await deps.review(); } catch (e) {
    json(res, { ok: false, error: `the rules document did not build: ${e instanceof Error ? e.message : String(e)}` }, 503);
    return true;
  }
  if (part === 'comments') {
    if (fmt !== 'md') { json(res, { ok: false, error: 'fmt: the comments download is md' }, 400); return true; }
    return attachment(res, 'Algomancy-CR-comments.md', fmt, commentsMarkdown(r, fold(readJournal())));
  }
  if (part === 'all') {
    const f = r.files[fmt === 'md' ? 'doc' : fmt];
    return attachment(res, f.name, fmt, f.text);
  }
  const whole = WHOLE[part];
  if (whole) {
    if (fmt !== 'md') { json(res, { ok: false, error: `fmt: ${part} is md only` }, 400); return true; }
    return attachment(res, r.files[whole].name, fmt, r.files[whole].text);
  }
  const got = partsFor(r, part);
  if (!got) { json(res, { ok: false, error: 'part: all, annexD, disc, oq, changelog, comments, ch:<n> or sec:<num>' }, 404); return true; }
  const name = `Algomancy-CR-${got.name}.${fmt}`;
  if (fmt === 'md') return attachment(res, name, fmt, got.parts.map(p => p.md).join(''));
  if (fmt === 'txt') return attachment(res, name, fmt, got.parts.map(p => p.txt).join(''));
  return attachment(res, name, fmt, fillShell(r.shell, got.title, got.parts.map(p => p.html).join('\n')));
}

/* ── the routes ───────────────────────────────────────────────────────── */

/** Handle a rules review route. True when the request was ours. */
export async function crReviewRoutes(
  req: IncomingMessage, res: ServerResponse, path: string, url: URL,
  deps: CrRouteDeps = { review: defaultReview },
): Promise<boolean> {
  if (!path.startsWith('/api/cr/')) return false;

  if (path === '/api/cr/review' && req.method === 'GET') {
    let r: CrReview;
    try { r = await deps.review(); } catch (e) {
      json(res, { ok: false, error: `the rules document did not build: ${e instanceof Error ? e.message : String(e)}` }, 503);
      return true;
    }
    const p = packed(r);
    const head = { 'content-type': 'application/json', etag: p.etag, 'cache-control': 'no-cache', vary: 'accept-encoding' };
    if (req.headers['if-none-match'] === p.etag) { res.writeHead(304, head); res.end(); return true; }
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      res.writeHead(200, { ...head, 'content-encoding': 'gzip' });
      res.end(p.gz);
    } else {
      res.writeHead(200, head);
      res.end(p.json);
    }
    return true;
  }

  if (path === '/api/cr/comments' && req.method === 'GET') {
    const rev = journalRev();
    if (url.searchParams.get('rev') === String(rev)) { json(res, { ok: true, rev, unchanged: true }); return true; }
    const { caller, you } = whoIs(req);
    json(res, { ok: true, rev, you, comments: viewFor(fold(readJournal()), caller) });
    return true;
  }

  if (path === '/api/cr/comment' && req.method === 'POST') {
    const { account, caller, you } = whoIs(req);
    if (!account || !caller) {
      json(res, { ok: false, error: you.why === 'guest' ? 'name your account first' : 'sign in to comment' }, you.why === 'guest' ? 403 : 401);
      return true;
    }
    if (rateLimited(addrOf(req), 'crcomment', CR_LIMITS.perMinute, 60_000)) { json(res, { ok: false, error: 'too many comments; wait a minute' }, 429); return true; }
    if (journalRev() > CR_LIMITS.journalBytes) { json(res, { ok: false, error: 'the comments file is full' }, 503); return true; }
    let b: Record<string, unknown>;
    try { b = await readBody(req, CR_LIMITS.requestBytes, true); } catch (e) {
      json(res, { ok: false, error: e instanceof Error ? e.message : 'unreadable body' }, 400);
      return true;
    }
    if (overDailyCap(account.id)) { json(res, { ok: false, error: 'that is the limit for today' }, 429); return true; }
    const done = await applyOp(b, account, caller, deps);
    if (isFail(done)) { json(res, { ok: false, error: done.error }, done.status); return true; }
    const comment = viewFor(fold(readJournal()), caller).find(c => c.id === done.id)!;
    json(res, { ok: true, rev: journalRev(), comment });
    return true;
  }

  if (path === '/api/cr/download' && req.method === 'GET') return download(req, res, url, deps);

  return false;
}
