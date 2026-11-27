/* 1516 — who reaches the card editor's routes (api-cardedit.ts, api-bot.ts).
 *
 * §1 signed out, a player, a logged-out token and an expired one: the plain 404 an
 *    unserved path gets, on every /api/cardedit/ route, before the body is read
 * §2 a designer and an admin get in
 * §3 /api/bot/cardedit/ is behind the bot gate: 404 without it, answered with it
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_IDLE_MS, logout } from '../accounts.ts';
import { account, bot, page, silentReq } from './cardedit-fixture.ts';

const PLAYER = account('Pip');
const DESIGNER = account('Dee', { designer: true });
const ADMIN = account('Ops', { admin: true });
const GONE = account('Gonzo', { designer: true });
const STALE = account('Stella', { designer: true });
logout(GONE);

const ROUTES: [string, string][] = [
  ['GET', '/api/cardedit/row?card=Murkstalker'],
  ['POST', '/api/cardedit/edits'],
  ['GET', '/api/cardedit/edits'],
  ['GET', '/api/cardedit/edits/ce-20261127-murkstalker-7f3a'],
  ['POST', '/api/cardedit/edits/ce-20261127-murkstalker-7f3a/cancel'],
  ['GET', '/api/cardedit/edits/ce-20261127-murkstalker-7f3a/image/after'],
  ['GET', '/api/cardedit/no-such-route'],
];

async function refusedEverywhere(who: string, token: string | null): Promise<void> {
  const missing = await page(silentReq('GET', null).req, '/api/cardedit/row');
  assert.equal(missing.raw, 'not found');
  for (const [method, path] of ROUTES) {
    const { req, listened } = silentReq(method, token);
    const r = await page(req, path);
    assert.equal(r.handled, true, `${who} ${method} ${path}: answered, not left to the file handler`);
    assert.equal(r.status, 404, `${who} ${method} ${path}: refused`);
    assert.equal(r.raw, missing.raw, `${who} ${method} ${path}: refused exactly as a missing path is`);
    assert.equal(r.type, 'text/plain', `${who} ${method} ${path}: not a JSON answer`);
    assert.deepEqual(listened, [], `${who} ${method} ${path}: the body was never read`);
  }
}

test('1516 §1 a stranger, a player, a logged-out and an expired token get the plain 404 before the body', async () => {
  await refusedEverywhere('signed out', null);
  await refusedEverywhere('a player', PLAYER);
  await refusedEverywhere('a made-up token', 'not-a-session');
  await refusedEverywhere('a logged-out token', GONE);
  mock.timers.enable({ apis: ['Date'], now: Date.now() + SESSION_IDLE_MS + 60_000 });
  try {
    await refusedEverywhere('an expired token', STALE);
  } finally {
    mock.timers.reset();
  }
});

test('1516 §2 a designer and an admin get in', async () => {
  for (const [who, token] of [['designer', DESIGNER], ['admin', ADMIN]] as const) {
    const row = await page(silentReq('GET', token).req, '/api/cardedit/row?card=Murkstalker');
    assert.equal(row.status, 200, `${who}: ${row.raw.slice(0, 200)}`);
    assert.equal(row.body['card'], 'Murkstalker');
    const list = await page(silentReq('GET', token).req, '/api/cardedit/edits');
    assert.deepEqual(list.body, { ok: true, edits: [] }, `${who}: the list`);
    const none = await page(silentReq('GET', token).req, '/api/cardedit/edits/ce-20261127-murkstalker-7f3a');
    assert.equal(none.status, 404);
    assert.equal(none.body['error'], 'No such edit.', `${who}: inside, a missing edit is a JSON answer`);
  }
});

test('1516 §3 the bot routes are behind the bot gate', async () => {
  const shut = await bot(silentReq('GET', null).req, '/api/bot/cardedit/pending', false);
  assert.equal(shut.status, 404);
  assert.equal(shut.raw, 'not found');
  const { req, listened } = silentReq('POST', null);
  const shutPost = await bot(req, '/api/bot/cardedit/reply', false);
  assert.equal(shutPost.status, 404);
  assert.deepEqual(listened, [], 'the body was never read');
  const open = await bot(silentReq('GET', null).req, '/api/bot/cardedit/pending', true);
  assert.equal(open.status, 200);
  assert.deepEqual(open.body, { ok: true, edits: [] });
});
