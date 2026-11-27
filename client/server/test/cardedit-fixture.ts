/* The card editor tests' common ground: a throwaway card-edits dir and account
 * store, the accounts each test signs in as, and requests the routes can read.
 * Import it first: it moves ALGO_CARD_EDITS_DIR before anything writes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { accountByName, register, setAdmin, setDesigner, useAccountsFile, type Account } from '../accounts.ts';
import { cardEditRoutes } from '../api-cardedit.ts';
import { botRoutes } from '../api-bot.ts';
import { useLiveEditIds } from '../cardedit.ts';

export const DIR = mkdtempSync(join(tmpdir(), 'cardedit-'));
process.env['ALGO_CARD_EDITS_DIR'] = join(DIR, 'card-edits');
const restoreAccounts = useAccountsFile(join(DIR, 'accounts.json'));
useLiveEditIds([]);
test.after(() => { restoreAccounts(); useLiveEditIds(null); rmSync(DIR, { recursive: true, force: true }); });

export function account(name: string, opts: { designer?: boolean; admin?: boolean; discord?: string } = {}): string {
  const r = register(name, 'correct horse battery');
  assert.ok(r.ok, `could not register ${name}`);
  const a = accountByName(name)!;
  if (opts.designer) setDesigner(a, true);
  if (opts.admin) setAdmin(a, true);
  if (opts.discord) a.linked = { discord: { id: opts.discord, username: name.toLowerCase(), linkedAt: new Date().toISOString() } };
  return r.token;
}
export const acct = (name: string): Account => accountByName(name)!;

const headers = (token: string | null): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {});

/** a request that records any read of its body, then ends it empty so a broken gate fails rather than hangs */
export function silentReq(method: string, token: string | null): { req: IncomingMessage; listened: string[] } {
  const listened: string[] = [];
  const listen = (ev: string, cb: () => void): unknown => { listened.push(ev); if (ev === 'end') setImmediate(cb); return req; };
  const req = { method, headers: headers(token), socket: { remoteAddress: '127.0.0.1' }, on: listen, once: listen };
  return { req: req as unknown as IncomingMessage, listened };
}
export function bodyReq(token: string | null, body: unknown, method = 'POST'): IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method, headers: { 'content-type': 'application/json', ...headers(token) }, socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage;
}

export interface Answer { status: number; raw: string; bytes: Buffer; type: string; handled: boolean; body: Record<string, unknown> }

function recorder(): { res: ServerResponse; done: () => Omit<Answer, 'handled'> } {
  let status = 0; let bytes = Buffer.alloc(0); let type = '';
  const res = {
    writeHead(s: number, h?: Record<string, string>) { status = s; type = h?.['content-type'] ?? ''; return res; },
    end(b?: string | Buffer) { bytes = b === undefined ? Buffer.alloc(0) : Buffer.from(b); return res; },
    setHeader() { /* unused */ },
  } as unknown as ServerResponse;
  return {
    res,
    done: () => {
      const raw = bytes.toString('utf8');
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(raw) as Record<string, unknown>; } catch { /* not JSON */ }
      return { status: status || 200, raw, bytes, type, body };
    },
  };
}

/** a page route, as main.ts calls it */
export async function page(req: IncomingMessage, pathAndQuery: string): Promise<Answer> {
  const url = new URL(pathAndQuery, 'http://localhost');
  const r = recorder();
  const handled = await cardEditRoutes(req, r.res, url.pathname, url);
  return { ...r.done(), handled };
}

/** a bot route through api-bot.ts, with the gate already decided */
export async function bot(req: IncomingMessage, path: string, allowed = true): Promise<Answer> {
  const url = new URL(path, 'http://localhost');
  const r = recorder();
  const handled = await botRoutes(req, r.res, url.pathname, url, {
    allowed, online: () => false, rooms: () => 0, invite: () => ({ code: 'X', joinPath: '/' }),
    bootId: 'test', startedAt: Date.now(), events: () => ({ events: [], nextSeq: 0, truncated: false }),
  });
  return { ...r.done(), handled };
}
export const botGet = (path: string): Promise<Answer> => bot(silentReq('GET', null).req, path);
export const botPost = (path: string, body: unknown): Promise<Answer> => bot(bodyReq(null, body), path);

/** a stand-in JPEG: the magic bytes, then a tag so two pictures differ */
export const jpegB64 = (tag: string): string => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tag)]).toString('base64');
export const fbFile = (key: string): string => `CUsersCalebPycharmProjectscardgamebot_library${key}.jpg`;
