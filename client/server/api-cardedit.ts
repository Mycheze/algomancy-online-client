/* /api/cardedit/* — the card editor page's routes — and /api/bot/cardedit/*,
 * the bot's half, which api-bot.ts hands over after its own gate.
 *
 * The page's gate is api-admin.ts's, with designerFor() as the question: a
 * caller who may not edit cards gets the 404 an unserved path gets, before the
 * body is read. Every decision is in cardedit.ts; this file is transport.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { json, readBody } from './api-util.ts';
import { designerFor } from './designer.ts';
import { editable } from '../ui/cardnotation.ts';
import {
  REPLY_BODY_BYTES, allEdits, cancelEdit, diffSummary, isAnswered, isEditId, mayRead, openEditFor, oracleRow,
  pendingEdits, picturePath, readEdit, recordReply, recordSeen, rowHash, statusNow, submitEdit,
  type CardEdit, type Outcome,
} from './cardedit.ts';

/** the 404 every refusal answers with — byte-identical to main.ts's own */
function notFound(res: ServerResponse): true {
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
  return true;
}

function answer(res: ServerResponse, out: Outcome<CardEdit>, body: (e: CardEdit) => Record<string, unknown>): true {
  if (out.ok) json(res, { ok: true, ...body(out.value) });
  else json(res, { ok: false, error: out.error }, out.status);
  return true;
}

/** One edit as the page is shown it. */
function detail(e: CardEdit): Record<string, unknown> {
  const { status, note } = statusNow(e);
  return {
    id: e.id, card: e.card, by: { name: e.by.name }, createdAt: e.createdAt,
    edit: e.edit, diff: e.diff, summary: diffSummary(e), road: e.road, why: e.why,
    commands: e.commands.map(c => ({ text: c.text, field: c.field, posted: c.posted?.content ?? null, answered: isAnswered(c) })),
    status, note: note ?? null,
    pictures: {
      before: e.events.some(ev => ev.what === 'picture' && ev['which'] === 'before'),
      after: e.events.some(ev => ev.what === 'picture' && ev['which'] === 'after'),
    },
  };
}

const EDIT_PATH = /^\/api\/cardedit\/edits\/([a-z0-9-]+)(?:\/(cancel|image\/before|image\/after))?$/;

/** Handle a /api/cardedit/ route. True when the request was ours, refusals included. */
export async function cardEditRoutes(
  req: IncomingMessage, res: ServerResponse, path: string, url: URL,
): Promise<boolean> {
  if (!path.startsWith('/api/cardedit/')) return false;
  const me = designerFor(req);
  if (!me) return notFound(res);

  if (path === '/api/cardedit/row' && req.method === 'GET') {
    const row = oracleRow(url.searchParams.get('card') ?? '');
    if (!row) { json(res, { ok: false, error: 'No such card.' }, 404); return true; }
    json(res, {
      ok: true, card: row.name, row, rowHash: rowHash(row),
      readOnly: editable(row), open: openEditFor(row.name)?.id ?? null,
    });
    return true;
  }

  if (path === '/api/cardedit/edits' && req.method === 'POST') {
    const body = await readBody(req);
    return answer(res, submitEdit(me, body), e => ({
      id: e.id, commands: e.commands.map(c => ({ text: c.text, field: c.field })), road: e.road, why: e.why,
      status: statusNow(e).status,
    }));
  }

  if (path === '/api/cardedit/edits' && req.method === 'GET') {
    const edits = allEdits().filter(e => mayRead(me, e)).reverse().map(e => {
      const { status, note } = statusNow(e);
      return { id: e.id, card: e.card, by: { name: e.by.name }, createdAt: e.createdAt, summary: diffSummary(e), road: e.road, status, note: note ?? null };
    });
    json(res, { ok: true, edits });
    return true;
  }

  const m = EDIT_PATH.exec(path);
  const edit = m && isEditId(m[1]) ? readEdit(m[1]) : undefined;
  if (!m || !edit || !mayRead(me, edit)) { json(res, { ok: false, error: 'No such edit.' }, 404); return true; }
  const tail = m[2];

  if (!tail && req.method === 'GET') { json(res, { ok: true, ...detail(edit) }); return true; }
  if (tail === 'cancel' && req.method === 'POST') return answer(res, cancelEdit(edit), detail);
  if ((tail === 'image/before' || tail === 'image/after') && req.method === 'GET') {
    let bytes: Buffer;
    try { bytes = readFileSync(picturePath(edit.id, tail === 'image/before' ? 'before' : 'after')); }
    catch { json(res, { ok: false, error: 'No picture yet.' }, 404); return true; }
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
    res.end(bytes);
    return true;
  }
  json(res, { ok: false, error: `no such card editor route: ${path}` }, 404);
  return true;
}

/** Handle a /api/bot/cardedit/ route; api-bot.ts has already applied the bot gate. */
export async function cardEditBotRoutes(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (!path.startsWith('/api/bot/cardedit/')) return false;

  if (path === '/api/bot/cardedit/pending' && req.method === 'GET') {
    json(res, {
      ok: true,
      edits: pendingEdits().map(e => {
        const hint = [...e.commands].reverse().find(c => c.posted)?.posted?.channelId;
        return {
          id: e.id, card: e.card, discord: e.by.discord, since: e.createdAt,
          ...(hint ? { channelHint: hint } : {}),
          commands: e.commands.map((c, i) => ({ i, text: c.text, field: c.field, posted: c.posted !== null, done: isAnswered(c) })),
        };
      }),
    });
    return true;
  }

  const seen = path === '/api/bot/cardedit/seen';
  const reply = path === '/api/bot/cardedit/reply';
  if ((seen || reply) && req.method === 'POST') {
    let body: Record<string, unknown>;
    try {
      body = await readBody(req, reply ? REPLY_BODY_BYTES : undefined, true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      json(res, { ok: false, error: `bad request: ${msg}` }, /too large/.test(msg) ? 413 : 400);
      return true;
    }
    const edit = isEditId(body['id']) ? readEdit(body['id']) : undefined;
    if (!edit) { json(res, { ok: false, error: 'no such edit' }, 404); return true; }
    const out = seen ? recordSeen(edit, body) : recordReply(edit, body);
    return answer(res, out, e => ({ road: e.road, ...statusNow(e) }));
  }

  json(res, { ok: false, error: `no such bot route: ${path}` }, 404);
  return true;
}
