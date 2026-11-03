/* 990 — STORYBOOK AT /storybook/, FOR ADMINS ONLY (design-system round,
 * 2026-11-03; docs/23 § Decisions: "a static build on the site behind the
 * owner badge, so it opens on the iPad").
 *
 * server/storybook.ts over real HTTP on an ephemeral port, with the real
 * account store (a throwaway file) and a throwaway build directory:
 *
 *   §1 ⭐ an admin: the ticket route answers a URL; that URL sets a cookie and
 *      redirects without the ticket; the cookie then opens the index and its
 *      files; the ticket cannot be spent twice
 *   §2 ⭐ a signed-in player and a signed-out request get main.ts's plain 404
 *      from every door: the ticket route, the page, a made-up ticket, a
 *      made-up cookie
 *   §3 ⭐ a path that leaves the build (`..`, absolute, a symlink out) is a 404
 *      even with the admin's cookie
 *   §4 no build on the box: an admin is told so in plain text; anybody else
 *      still sees nothing but "not found"
 *   §5 the admin flag is asked on every request: revoke it and the cookie
 *      stops working
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountForToken, register, setAdmin, useAccountsFile } from '../accounts.ts';
import { storybookRoutes } from '../storybook.ts';

const root = mkdtempSync(join(tmpdir(), 'storybook-route-'));
const restoreAccounts = useAccountsFile(join(root, 'accounts.json'));
const BUILD = join(root, 'storybook-static');
mkdirSync(join(BUILD, 'assets'), { recursive: true });
writeFileSync(join(BUILD, 'index.html'), '<!doctype html><title>Storybook index</title>');
writeFileSync(join(BUILD, 'iframe.html'), '<!doctype html><title>Storybook preview</title>');
writeFileSync(join(BUILD, 'assets', 'story.js'), 'export const story = 1;');
// the things a traversal would reach: beside the build, not in it
writeFileSync(join(root, 'secret.txt'), 'THE SECRET');
symlinkSync(join(root, 'secret.txt'), join(BUILD, 'link.txt'));
const prevDir = process.env['ALGO_STORYBOOK_DIR'];
process.env['ALGO_STORYBOOK_DIR'] = BUILD;

// the same decode main.ts does before any route sees the path
const server: Server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const path = decodeURIComponent(url.pathname);
  storybookRoutes(req, res, path, url, async (_q, s, file) => {
    s.writeHead(200, { 'content-type': 'text/plain' });
    s.end(readFileSync(file));
  }).then(handled => {
    if (!handled) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); }
  }, err => { res.writeHead(500); res.end(String(err)); });
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

test.after(async () => {
  await new Promise<void>(r => server.close(() => r()));
  restoreAccounts();
  if (prevDir === undefined) delete process.env['ALGO_STORYBOOK_DIR'];
  else process.env['ALGO_STORYBOOK_DIR'] = prevDir;
  rmSync(root, { recursive: true, force: true });
});

const tokenFor = (name: string): string => {
  const r = register(name, 'correct horse battery');
  assert.ok(r.ok, `register ${name}`);
  return r.ok ? r.token : '';
};
const OWNER = tokenFor('ownerx');
const SPARE = tokenFor('spareadmin');     // so revoking OWNER is never the last admin
const PLAYER = tokenFor('playerx');
assert.ok(setAdmin(accountForToken(OWNER)!, true));
assert.ok(setAdmin(accountForToken(SPARE)!, true));

interface Got { status: number; body: string; headers: Headers }
async function get(path: string, init: { cookie?: string; token?: string; method?: string } = {}): Promise<Got> {
  const res = await fetch(BASE + path, {
    method: init.method ?? 'GET',
    redirect: 'manual',
    headers: {
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
  });
  return { status: res.status, body: await res.text(), headers: res.headers };
}
const NOT_FOUND = (r: Got, what: string): void => {
  assert.equal(r.status, 404, `${what}: ${r.status} ${r.body}`);
  assert.equal(r.body, 'not found', `${what}: the refusal must read exactly like a missing page`);
};
/** an admin's way in: ticket, then the cookie the ticket URL sets */
async function adminCookie(token = OWNER): Promise<string> {
  const t = await get('/api/storybook/ticket', { method: 'POST', token });
  assert.equal(t.status, 200, t.body);
  const url = (JSON.parse(t.body) as { url: string }).url;
  const r = await get(url);
  assert.equal(r.status, 303);
  return (r.headers.get('set-cookie') ?? '').split(';')[0]!;
}

test('§1 an admin gets a ticket, the ticket sets a cookie, and the cookie opens Storybook', async () => {
  const t = await get('/api/storybook/ticket', { method: 'POST', token: OWNER });
  assert.equal(t.status, 200, t.body);
  const url = (JSON.parse(t.body) as { url: string }).url;
  assert.match(url, /^\/storybook\/\?ticket=[\w-]{20,}$/);

  const first = await get(url);
  assert.equal(first.status, 303, 'the ticket URL redirects');
  assert.equal(first.headers.get('location'), '/storybook/', 'and the ticket is gone from the URL it lands on');
  const setCookie = first.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /^algo_sb=[\w-]+; Path=\/storybook; Max-Age=\d+; HttpOnly; SameSite=Lax$/);
  const cookie = setCookie.split(';')[0]!;

  const index = await get('/storybook/', { cookie });
  assert.equal(index.status, 200);
  assert.match(index.body, /Storybook index/);
  assert.match((await get('/storybook/iframe.html', { cookie })).body, /Storybook preview/);
  assert.match((await get('/storybook/assets/story.js', { cookie })).body, /story = 1/);
  const bare = await get('/storybook', { cookie });
  assert.equal(bare.status, 301, 'no trailing slash: every URL in the build is relative to /storybook/');
  assert.equal(bare.headers.get('location'), '/storybook/');

  // spent: the same ticket with no cookie is nobody
  NOT_FOUND(await get(url), 'a spent ticket');
  // a deep link keeps its query, minus the ticket
  const t2 = JSON.parse((await get('/api/storybook/ticket', { method: 'POST', token: OWNER })).body) as { url: string };
  const deep = await get(t2.url.replace('/storybook/?', '/storybook/?path=/story/chip--neutral&'));
  assert.equal(deep.headers.get('location'), '/storybook/?path=%2Fstory%2Fchip--neutral');
});

test('§2 a player and a signed-out request get the plain 404 from every door', async () => {
  NOT_FOUND(await get('/api/storybook/ticket', { method: 'POST', token: PLAYER }), 'a player asking for a ticket');
  NOT_FOUND(await get('/api/storybook/ticket', { method: 'POST' }), 'signed out, asking for a ticket');
  NOT_FOUND(await get('/api/storybook/ticket', { token: OWNER }), 'even an admin, by GET');
  for (const token of [PLAYER, undefined]) {
    const who = token ? 'a player' : 'signed out';
    NOT_FOUND(await get('/storybook/', { token }), `${who}: the index`);
    NOT_FOUND(await get('/storybook/assets/story.js', { token }), `${who}: a file`);
    NOT_FOUND(await get('/storybook', { token }), `${who}: no slash`);
    NOT_FOUND(await get('/storybook/?ticket=made-up', { token }), `${who}: a made-up ticket`);
    NOT_FOUND(await get('/storybook/', { token, cookie: 'algo_sb=made-up' }), `${who}: a made-up cookie`);
  }
});

test('§3 a path out of the build is a 404 even for an admin', async () => {
  const cookie = await adminCookie();
  NOT_FOUND(await get('/storybook/..%2fsecret.txt', { cookie }), 'an encoded ..');
  NOT_FOUND(await get('/storybook/assets/..%2f..%2fsecret.txt', { cookie }), 'two encoded ..');
  NOT_FOUND(await get(`/storybook/${encodeURIComponent(join(root, 'secret.txt'))}`, { cookie }), 'an absolute path');
  NOT_FOUND(await get(`/storybook//${join(root, 'secret.txt').slice(1)}`, { cookie }), 'a doubled slash');
  NOT_FOUND(await get('/storybook/link.txt', { cookie }), 'a symlink pointing out');
  NOT_FOUND(await get('/storybook/nothing-here.js', { cookie }), 'a file that is not there');
});

test('§4 no build: an admin is told so, anybody else sees nothing', async () => {
  const cookie = await adminCookie();
  process.env['ALGO_STORYBOOK_DIR'] = join(root, 'never-built');
  try {
    const r = await get('/storybook/', { cookie });
    assert.equal(r.status, 404);
    assert.equal(r.body, "Storybook isn't built on this server");
    NOT_FOUND(await get('/storybook/', { token: PLAYER }), 'a player, no build');
    NOT_FOUND(await get('/storybook/'), 'signed out, no build');
  } finally {
    process.env['ALGO_STORYBOOK_DIR'] = BUILD;
  }
});

test('§5 the admin flag is asked every time: revoke it and the cookie stops working', async () => {
  const cookie = await adminCookie();
  assert.equal((await get('/storybook/', { cookie })).status, 200);
  setAdmin(accountForToken(OWNER)!, false);
  try {
    NOT_FOUND(await get('/storybook/', { cookie }), 'a cookie whose account is no longer an admin');
  } finally {
    setAdmin(accountForToken(OWNER)!, true);
  }
});
