/* 1509 — POST /api/admin/setdesigner, the dashboard's Designer toggle (api-admin.ts).
 *
 * §1 signed out, a player, and a designer who is not an admin: the plain 404 a
 *    missing path gets, answered before the body is read, and nothing changes
 * §2 an admin grants and revokes it; the accounts list carries the flag on every row
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { accountByName, register, setAdmin, setDesigner, useAccountsFile } from '../accounts.ts';
import { adminRoutes } from '../api-admin.ts';

const dir = mkdtempSync(join(tmpdir(), 'designer-route-'));
const restoreAccounts = useAccountsFile(join(dir, 'accounts.json'));
test.after(() => { restoreAccounts(); rmSync(dir, { recursive: true, force: true }); });

function account(name: string): string {
  const r = register(name, 'correct horse battery');
  assert.ok(r.ok, `could not register ${name}`);
  return r.token;
}
const PLAYER = account('Pip');
const DESIGNER = account('Dee');
const OPS = account('Ops');
account('Target');
setAdmin(accountByName('Ops')!, true);
setDesigner(accountByName('Dee')!, true);

interface Answer { status: number; raw: string; handled: boolean }
const headers = (token: string | null) => (token ? { authorization: `Bearer ${token}` } : {});

/** a request that records any read of its body, then ends it empty so a broken gate fails rather than hangs */
function silentReq(method: string, token: string | null): { req: IncomingMessage; listened: string[] } {
  const listened: string[] = [];
  const listen = (ev: string, cb: () => void) => { listened.push(ev); if (ev === 'end') setImmediate(cb); return req; };
  const req = { method, headers: headers(token), on: listen, once: listen };
  return { req: req as unknown as IncomingMessage, listened };
}
function bodyReq(token: string | null, body: unknown): IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers(token) },
  }) as unknown as IncomingMessage;
}
async function call(req: IncomingMessage, path: string): Promise<Answer> {
  let status = 0;
  let raw = '';
  const res = {
    writeHead(s: number) { status = s; return res; },
    end(b?: string | Buffer) { raw = b === undefined ? '' : String(b); return res; },
    setHeader() { /* unused */ },
  } as unknown as ServerResponse;
  const handled = await adminRoutes(req, res, path);
  return { status: status || 200, raw, handled };
}

test('1509 §1 a non-admin gets the plain 404, before the body is read, and nothing changes', async () => {
  const missing = await call(silentReq('POST', PLAYER).req, '/api/admin/no-such-route');
  for (const [who, token] of [['signed out', null], ['a player', PLAYER], ['a designer', DESIGNER]] as const) {
    const { req, listened } = silentReq('POST', token);
    const r = await call(req, '/api/admin/setdesigner');
    assert.equal(r.handled, true, `${who}: answered, not left to the file handler`);
    assert.equal(r.status, 404, `${who}: refused`);
    assert.equal(r.raw, missing.raw, `${who}: refused exactly as a missing path is`);
    assert.deepEqual(listened, [], `${who}: the body was never read`);
  }
  // a refused request that DID carry a body changes nothing either
  await call(bodyReq(PLAYER, { name: 'Target', designer: true }), '/api/admin/setdesigner');
  assert.equal(accountByName('Target')!.designer, undefined, 'a player cannot grant it');
  await call(bodyReq(DESIGNER, { name: 'Target', designer: true }), '/api/admin/setdesigner');
  assert.equal(accountByName('Target')!.designer, undefined, 'nor can a designer: it is an admin power');
});

test('1509 §2 an admin grants and revokes it, and the accounts list says who holds it', async () => {
  const on = await call(bodyReq(OPS, { name: 'Target', designer: true }), '/api/admin/setdesigner');
  assert.equal(on.status, 200);
  assert.deepEqual(JSON.parse(on.raw), { ok: true, name: 'Target', designer: true });
  assert.equal(accountByName('Target')!.designer, true);
  assert.equal(accountByName('Target')!.admin, undefined, 'and no admin with it');

  const rows = JSON.parse((await call(silentReq('GET', OPS).req, '/api/admin/accounts')).raw) as
    { accounts: { username: string; designer: boolean; admin: boolean }[] };
  const flag = Object.fromEntries(rows.accounts.map(a => [a.username, a.designer]));
  assert.deepEqual(flag, { Pip: false, Dee: true, Ops: false, Target: true }, 'every row carries it, as a boolean');

  const off = await call(bodyReq(OPS, { name: 'Target', designer: false }), '/api/admin/setdesigner');
  assert.deepEqual(JSON.parse(off.raw), { ok: true, name: 'Target', designer: false });
  assert.equal(accountByName('Target')!.designer, undefined);
  const nobody = await call(bodyReq(OPS, { name: 'Nobody', designer: true }), '/api/admin/setdesigner');
  assert.deepEqual(JSON.parse(nobody.raw), { ok: false, error: 'no such player' });
});
