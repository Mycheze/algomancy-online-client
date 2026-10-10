/* THE RULES REVIEW PAGE'S SERVER HALF — `/api/cr/*` (api-crreview.ts) and the
 * comment journal's fold (crreview.ts), in process, against a fixture review.
 *
 * §1 the fold: last write wins, a delete blanks the body, resolve and reopen
 *    touch roots only, and a hand-edited row by somebody who could not have
 *    made it is ignored
 * §2 the document: built by the injected builder, sent without the server's
 *    half, gzipped when asked, 304 on a matching ETag, 503 when it cannot build
 * §3 who may write: 401 signed out, 403 a guest, 403 a non-author edit; the
 *    author or an admin resolves; only an admin answers an owner question
 * §4 what a write must be: a target in the document, a reply on a root of the
 *    same target with no anchor, the length caps; 429 past the minute brake
 * §5 the reads: `?rev=` short-circuits, no account id in any answer, and the
 *    three booleans are the server's answer for the caller
 * §6 downloads are attachments: a section is its part, a chapter its parts in
 *    contents order, a standalone page is the shell filled; the raw journal
 *    404s to a non-admin
 * §7 the builder cache: one build until an input file changes
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CrReview, CrReviewDoc, CrComment } from '../../ui/crtypes.ts';

const dir = mkdtempSync(join(tmpdir(), 'cr-comments-'));
const JOURNAL = join(dir, 'cr-comments.jsonl');
process.env['ALGO_CR_COMMENTS_FILE'] = JOURNAL;

const { register, registerGuest, setAdmin, useAccountsFile } = await import('../accounts.ts');
const { crReviewRoutes, cachedBuilder, fillShell, CR_LIMITS } = await import('../api-crreview.ts');
const { fold } = await import('../crreview.ts');
type CrRow = import('../crreview.ts').CrRow;

const restoreAccounts = useAccountsFile(join(dir, 'accounts.json'));
test.after(() => { restoreAccounts(); delete process.env['ALGO_CR_COMMENTS_FILE']; rmSync(dir, { recursive: true, force: true }); });

function named(name: string): { id: string; token: string } {
  const r = register(name, 'correct horse battery');
  assert.ok(r.ok);
  return { id: r.account.id, token: r.token };
}
const ALICE = named('alice');
const BOB = named('bob');
const OWNER = named('owner');
{
  const r = register('ownerx', 'correct horse battery');   // a second account so setAdmin is never the last
  assert.ok(r.ok);
}
const GUEST = (() => { const r = registerGuest(); assert.ok(r.ok); return { id: r.account.id, token: r.token }; })();
{
  const { accountForToken } = await import('../accounts.ts');
  assert.ok(setAdmin(accountForToken(OWNER.token)!, true));
}
const ALL_IDS = [ALICE.id, BOB.id, OWNER.id, GUEST.id];

/* ── the fixture review ───────────────────────────────────────────────── */

const INPUT = join(dir, 'input.json');
writeFileSync(INPUT, '{}');

const S608_MD = '## 608. Combat damage\n\n**608.1** Damage costs $& and $1, written plainly.\n\n';
const S609_MD = '## 609. After combat\n\n**609.1** Then it ends.\n\n';
const REVIEW: CrReview = {
  v: 1, title: 'Fixture Rules', subtitle: 'for test 436',
  edition: { name: 'Edition 1 (draft)', effective: '2026-10-10', engineCommit: 'abc1234' },
  toc: [
    { id: 'front', title: 'Introduction' },
    { id: 'ch6', title: '6. Combat', sections: [{ num: '608', title: 'Combat damage', part: 's608' }, { num: '609', title: 'After combat', part: 's609' }] },
  ],
  parts: [
    { id: 'front', kind: 'front', title: 'Introduction', html: '<section data-crt="front">Intro</section>', md: '# Intro\n\n', txt: 'Intro\n\n' },
    { id: 's608', kind: 'section', num: '608', chapter: '6', title: 'Combat damage',
      html: '<section class="sec" data-crt="sec:608"><article data-crt="rule:combat.damage.one">608.1 Damage costs $&amp; and $1.</article><article data-crt="rule:combat.old">608.9 removed</article></section>',
      md: S608_MD, txt: '608. COMBAT DAMAGE\n\n608.1 Damage costs $& and $1.\n\n' },
    { id: 's609', kind: 'section', num: '609', chapter: '6', title: 'After combat',
      html: '<section class="sec" data-crt="sec:609">609.1 Then it ends.</section>', md: S609_MD, txt: '609. AFTER COMBAT\n\n609.1 Then it ends.\n\n' },
  ],
  disc: [{ id: 'D-U12-1', tier: 1, rule: '608.1', html: '<article class="disc" data-crt="disc:D-U12-1">Which reading?</article>' },
    { id: 'D-U12-2', tier: 2, rule: '608.1', html: '<article class="disc" data-crt="disc:D-U12-2">A tier two item</article>' }],
  ownerQuestions: [{ topic: 'Combat', items: [{ id: 'D-U12-1', n: 1, readings: ['A', 'B'] }] }],
  targets: ['front', 'sec:608', 'rule:combat.damage.one', 'rule:combat.old', 'sec:609', 'disc:D-U12-1', 'disc:D-U12-2'],
  keys: { 'combat.damage.one': '608.1', 'combat.old': '608.9' },
  removed: { 'combat.old': '608.9' },
  aliases: { 'combat.renamed': 'combat.damage.one' },
  shell: '<!doctype html><title>{{TITLE}}</title><main>{{BODY}}</main>',
  files: {
    doc: { name: 'Algomancy-Comprehensive-Rules.md', text: '# Whole document\n' },
    html: { name: 'Algomancy-Comprehensive-Rules.html', text: '<!doctype html><p>whole</p>' },
    txt: { name: 'Algomancy-Comprehensive-Rules.txt', text: 'WHOLE DOCUMENT\n' },
    annexD: { name: 'Annex-D-Digital-Conventions.md', text: '# Annex D\n' },
    disc: { name: 'discrepancies.md', text: '# Discrepancies\n' },
    oq: { name: 'owner-questions.md', text: '# Owner questions\n' },
    changelog: { name: 'changelog.md', text: '# Changelog\n' },
  },
  born: 0,
  inputs: [INPUT],
};

let builds = 0;
let broken: Error | null = null;
const deps = { review: async (): Promise<CrReview> => { builds++; if (broken) throw broken; return REVIEW; } };

/* ── a fake request and response ──────────────────────────────────────── */

interface Answer { status: number; headers: Record<string, string>; raw: Buffer; body: Record<string, unknown> }
let addrN = 0;
async function call(method: string, pathAndQuery: string, opts: { token?: string; body?: unknown; headers?: Record<string, string>; addr?: string } = {}): Promise<Answer> {
  const text = opts.body === undefined ? '' : JSON.stringify(opts.body);
  const req = Object.assign(Readable.from(text ? [Buffer.from(text)] : []), {
    method,
    headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
    socket: { remoteAddress: opts.addr ?? `10.0.0.${(addrN++ % 200) + 1}` },
  }) as unknown as IncomingMessage;
  let status = 0;
  let headers: Record<string, string> = {};
  let raw: Buffer = Buffer.alloc(0);
  const res = {
    writeHead(s: number, h?: Record<string, string>) { status = s; headers = { ...(h ?? {}) }; return res; },
    end(b?: string | Buffer) { raw = b === undefined ? Buffer.alloc(0) : Buffer.isBuffer(b) ? b : Buffer.from(b); return res; },
  } as unknown as ServerResponse;
  const url = new URL(`http://x${pathAndQuery}`);
  const handled = await crReviewRoutes(req, res, url.pathname, url, deps);
  assert.equal(handled, true, `${method} ${pathAndQuery} was not handled`);
  let body: Record<string, unknown> = {};
  const isJson = (headers['content-type'] ?? '').startsWith('application/json') && headers['content-encoding'] !== 'gzip';
  if (isJson && raw.length) body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
  return { status, headers, raw, body };
}
const post = (token: string | undefined, body: unknown, addr?: string): Promise<Answer> =>
  call('POST', '/api/cr/comment', { ...(token ? { token } : {}), body, ...(addr ? { addr } : {}) });
const anchor = { quote: 'Damage costs', prefix: '608.1 ', suffix: ' $& and', start: 6, edition: 'Edition 1 (draft)', num: '608.1' };

/* ── §1 the fold ──────────────────────────────────────────────────────── */

test('§1 the fold: last write wins, delete blanks, resolve is for roots, a forged edit is ignored', () => {
  const a = { id: 'A', name: 'alice' }, b = { id: 'B', name: 'bob' }, adm = { id: 'Z', name: 'owner' };
  const rows: CrRow[] = [
    { v: 1, op: 'add', id: 'c1', at: 't1', by: a, target: 'rule:k', parent: null, anchor: null, body: 'first' },
    { v: 1, op: 'add', id: 'c2', at: 't2', by: b, target: 'rule:k', parent: 'c1', anchor: null, body: 'reply' },
    { v: 1, op: 'edit', id: 'c1', at: 't3', by: a, body: 'second' },
    { v: 1, op: 'edit', id: 'c1', at: 't4', by: b, body: 'forged by bob' },
    { v: 1, op: 'resolve', id: 'c2', at: 't5', by: b },
    { v: 1, op: 'resolve', id: 'c1', at: 't6', by: b },
    { v: 1, op: 'resolve', id: 'c1', at: 't7', by: adm, asAdmin: true },
    { v: 1, op: 'add', id: 'c3', at: 't8', by: b, target: 'rule:k', parent: 'c2', anchor: null, body: 'reply to a reply' },
    { v: 1, op: 'add', id: 'c4', at: 't9', by: b, target: 'rule:other', parent: 'c1', anchor: null, body: 'wrong target' },
    { v: 1, op: 'add', id: 'c5', at: 't10', by: b, target: 'rule:k', parent: null, anchor: null, body: 'to delete' },
    { v: 1, op: 'delete', id: 'c5', at: 't11', by: b },
    { v: 1, op: 'edit', id: 'c5', at: 't12', by: b, body: 'back from the dead' },
    { v: 1, op: 'add', id: 'c1', at: 't13', by: b, target: 'rule:k', parent: null, anchor: null, body: 'id reused' },
  ];
  const m = fold(rows);
  assert.deepEqual([...m.keys()], ['c1', 'c2', 'c5'], 'a reply to a reply, a reply on another target and a reused id are dropped');
  assert.equal(m.get('c1')!.body, 'second', 'the author edit stands and the forged one does not');
  assert.equal(m.get('c1')!.editedAt, 't3');
  assert.deepEqual(m.get('c1')!.resolved, { by: 'owner', at: 't7' }, 'only the admin resolve took');
  assert.equal(m.get('c2')!.resolved, undefined, 'a reply cannot be resolved');
  assert.equal(m.get('c5')!.deleted, true);
  assert.equal(m.get('c5')!.body, '', 'a deleted comment shows no text, and stays deleted');
  const reopened = fold([...rows, { v: 1, op: 'reopen', id: 'c1', at: 't14', by: a }]);
  assert.equal(reopened.get('c1')!.resolved, undefined, 'the root author reopens');
});

/* ── §2 the document ──────────────────────────────────────────────────── */

test('§2 the review is the builder output minus the server half, gzipped when asked, 304 on its ETag', async () => {
  const plain = await call('GET', '/api/cr/review');
  assert.equal(plain.status, 200);
  const doc = plain.body as unknown as CrReviewDoc;
  assert.equal(doc.title, 'Fixture Rules');
  assert.deepEqual(doc.targets, REVIEW.targets);
  assert.deepEqual(doc.parts.map(p => p.id), ['front', 's608', 's609']);
  for (const k of ['shell', 'files', 'inputs', 'born']) assert.ok(!(k in doc), `${k} is the server half and is not sent`);
  for (const p of doc.parts) assert.ok(!('md' in p) && !('txt' in p), 'parts go without md and txt');
  assert.equal(doc.parts[1]!.num, '608');
  assert.equal(plain.headers['cache-control'], 'no-cache');

  const gz = await call('GET', '/api/cr/review', { headers: { 'accept-encoding': 'gzip, br' } });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.deepEqual(JSON.parse(gunzipSync(gz.raw).toString('utf8')), plain.body);

  const etag = plain.headers['etag']!;
  assert.match(etag, /^"[0-9a-f]{40}"$/);
  const again = await call('GET', '/api/cr/review', { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
  assert.equal(again.raw.length, 0);
});

test('§2 a review that does not build answers 503 with the reason', async () => {
  broken = new Error('ledger is stale');
  try {
    const r = await call('GET', '/api/cr/review');
    assert.equal(r.status, 503);
    assert.match(String(r.body['error']), /ledger is stale/);
  } finally { broken = null; }
});

test('§2 a path under /api/cr that is not a route falls through', async () => {
  const req = Object.assign(Readable.from([]), { method: 'GET', headers: {}, socket: { remoteAddress: '10.9.9.9' } }) as unknown as IncomingMessage;
  const url = new URL('http://x/api/cr/nothing');
  assert.equal(await crReviewRoutes(req, {} as ServerResponse, url.pathname, url, deps), false);
  assert.equal(await crReviewRoutes(req, {} as ServerResponse, '/api/cardstats', url, deps), false);
});

/* ── §3 who may write ─────────────────────────────────────────────────── */

let rootId = '';
test('§3 signed out is 401 and a guest is 403; a named account comments', async () => {
  const out = await post(undefined, { op: 'add', target: 'rule:combat.damage.one', body: 'hi' });
  assert.equal(out.status, 401);
  assert.equal(out.body['error'], 'sign in to comment');
  const guest = await post(GUEST.token, { op: 'add', target: 'rule:combat.damage.one', body: 'hi' });
  assert.equal(guest.status, 403);
  assert.equal(guest.body['error'], 'name your account first');
  assert.ok(!existsSync(JOURNAL), 'nothing was written for either');

  const ok = await post(ALICE.token, { op: 'add', target: 'rule:combat.damage.one', anchor, body: 'Does this include Ranged?' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const c = ok.body['comment'] as CrComment;
  rootId = c.id;
  assert.equal(c.body, 'Does this include Ranged?');
  assert.deepEqual(c.anchor, anchor);
  assert.deepEqual(c.by, { name: 'alice' });
  assert.equal(c.mine, true);
  assert.equal(c.canEdit, true);
  assert.equal(c.canResolve, true);
  assert.equal(ok.body['rev'], readFileSync(JOURNAL).length);
});

test('§3 a non-author may not edit or resolve; the author and an admin may', async () => {
  const edit = await post(BOB.token, { op: 'edit', id: rootId, body: 'hijacked' });
  assert.equal(edit.status, 403);
  const res = await post(BOB.token, { op: 'resolve', id: rootId });
  assert.equal(res.status, 403);
  assert.equal(res.body['error'], 'only the author or an admin can resolve this');

  const mine = await post(ALICE.token, { op: 'edit', id: rootId, body: 'Does this include Ranged units?' });
  assert.equal(mine.status, 200);
  assert.equal((mine.body['comment'] as CrComment).body, 'Does this include Ranged units?');
  assert.ok((mine.body['comment'] as CrComment).editedAt);

  const byAdmin = await post(OWNER.token, { op: 'resolve', id: rootId });
  assert.equal(byAdmin.status, 200);
  assert.equal((byAdmin.body['comment'] as CrComment).resolved?.by, 'owner');
  const reopen = await post(ALICE.token, { op: 'reopen', id: rootId });
  assert.equal(reopen.status, 200);
  assert.equal((reopen.body['comment'] as CrComment).resolved, undefined);
  const rows = readFileSync(JOURNAL, 'utf8').trim().split('\n').map(l => JSON.parse(l) as CrRow);
  assert.equal(rows.find(r => r.op === 'resolve')!.asAdmin, true, 'an admin acting on another comment is flagged');
});

test('§3 only an admin answers an owner question, with one of its readings', async () => {
  const notAdmin = await post(ALICE.token, { op: 'add', target: 'disc:D-U12-1', kind: 'answer', reading: 'A' });
  assert.equal(notAdmin.status, 403);
  const badReading = await post(OWNER.token, { op: 'add', target: 'disc:D-U12-1', kind: 'answer', reading: 'Z' });
  assert.equal(badReading.status, 400);
  assert.match(String(badReading.body['error']), /A, B, other/);
  const notAQuestion = await post(OWNER.token, { op: 'add', target: 'disc:D-U12-2', kind: 'answer', reading: 'A' });
  assert.equal(notAQuestion.status, 400);
  const otherNeedsWords = await post(OWNER.token, { op: 'add', target: 'disc:D-U12-1', kind: 'answer', reading: 'other' });
  assert.equal(otherNeedsWords.status, 400);
  const strayReading = await post(OWNER.token, { op: 'add', target: 'disc:D-U12-1', reading: 'A', body: 'x' });
  assert.equal(strayReading.status, 400);

  const a = await post(OWNER.token, { op: 'add', target: 'disc:D-U12-1', kind: 'answer', reading: 'B' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const c = a.body['comment'] as CrComment;
  assert.equal(c.kind, 'answer');
  assert.equal(c.reading, 'B');
  assert.equal(c.body, '', 'a lettered answer needs no words');
});

/* ── §4 what a write must be ──────────────────────────────────────────── */

test('§4 the target must be in the document and a reply hangs off a root of the same target', async () => {
  const gone = await post(BOB.token, { op: 'add', target: 'rule:not.a.rule', body: 'x' });
  assert.equal(gone.status, 400);
  assert.match(String(gone.body['error']), /^target/);

  const reply = await post(BOB.token, { op: 'add', target: 'rule:combat.damage.one', parent: rootId, body: 'Yes, see the thread.' });
  assert.equal(reply.status, 200);
  const replyId = (reply.body['comment'] as CrComment).id;
  assert.equal((reply.body['comment'] as CrComment).canResolve, false, 'a reply has no resolve');

  const deep = await post(BOB.token, { op: 'add', target: 'rule:combat.damage.one', parent: replyId, body: 'x' });
  assert.equal(deep.status, 400, 'threads are one level deep');
  const elsewhere = await post(BOB.token, { op: 'add', target: 'sec:608', parent: rootId, body: 'x' });
  assert.equal(elsewhere.status, 400, 'a reply is on the same target as its root');
  const anchored = await post(BOB.token, { op: 'add', target: 'rule:combat.damage.one', parent: rootId, anchor, body: 'x' });
  assert.equal(anchored.status, 400, 'a reply carries no anchor');
  const resolveReply = await post(BOB.token, { op: 'resolve', id: replyId });
  assert.equal(resolveReply.status, 400);
});

test('§4 the length caps hold', async () => {
  const long = await post(BOB.token, { op: 'add', target: 'sec:608', body: 'x'.repeat(CR_LIMITS.body + 1) });
  assert.equal(long.status, 400);
  const blank = await post(BOB.token, { op: 'add', target: 'sec:608', body: '   \n ' });
  assert.equal(blank.status, 400);
  const quote = await post(BOB.token, { op: 'add', target: 'sec:608', body: 'x', anchor: { ...anchor, quote: 'q'.repeat(CR_LIMITS.quote + 1) } });
  assert.equal(quote.status, 400);
  const ctx = await post(BOB.token, { op: 'add', target: 'sec:608', body: 'x', anchor: { ...anchor, prefix: 'p'.repeat(65) } });
  assert.equal(ctx.status, 400);
  const start = await post(BOB.token, { op: 'add', target: 'sec:608', body: 'x', anchor: { ...anchor, start: -1 } });
  assert.equal(start.status, 400);
  const edition = await post(BOB.token, { op: 'add', target: 'sec:608', body: 'x', anchor: { ...anchor, edition: 'e'.repeat(81) } });
  assert.equal(edition.status, 400);
  const op = await post(BOB.token, { op: 'shout', body: 'x' });
  assert.equal(op.status, 400);
  const huge = await post(BOB.token, { op: 'add', target: 'sec:608', body: 'x'.repeat(20_000) });
  assert.equal(huge.status, 400, 'a body over the request cap is refused, not truncated');
});

test('§4 the 31st write from one address inside a minute is 429', async () => {
  const addr = '10.77.0.1';
  const statuses: number[] = [];
  for (let i = 0; i < CR_LIMITS.perMinute + 1; i++) statuses.push((await post(BOB.token, { op: 'shout' }, addr)).status);
  assert.deepEqual(statuses.slice(0, CR_LIMITS.perMinute), Array(CR_LIMITS.perMinute).fill(400));
  assert.equal(statuses[CR_LIMITS.perMinute], 429);
});

/* ── §5 the reads ─────────────────────────────────────────────────────── */

test('§5 comments name nobody by id, and carry the server answer for each caller', async () => {
  const anon = await call('GET', '/api/cr/comments');
  assert.equal(anon.status, 200);
  for (const id of ALL_IDS) assert.ok(!anon.raw.toString('utf8').includes(id), 'no account id goes out');
  assert.deepEqual(anon.body['you'], { name: null, canComment: false, why: 'signed-out' });
  const anonList = anon.body['comments'] as CrComment[];
  assert.ok(anonList.length >= 3);
  assert.ok(anonList.every(c => !c.mine && !c.canEdit && !c.canResolve), 'a reader who may not write gets no buttons');

  const guest = await call('GET', '/api/cr/comments', { token: GUEST.token });
  assert.equal((guest.body['you'] as Record<string, unknown>)['why'], 'guest');
  assert.equal((guest.body['you'] as Record<string, unknown>)['canComment'], false);

  const bob = await call('GET', '/api/cr/comments', { token: BOB.token });
  for (const id of ALL_IDS) assert.ok(!bob.raw.toString('utf8').includes(id));
  assert.deepEqual(bob.body['you'], { name: 'bob', canComment: true });
  const root = (bob.body['comments'] as CrComment[]).find(c => c.id === rootId)!;
  assert.equal(root.mine, false);
  assert.equal(root.canEdit, false);
  assert.equal(root.canResolve, false);

  const owner = await call('GET', '/api/cr/comments', { token: OWNER.token });
  assert.deepEqual(owner.body['you'], { name: 'owner', canComment: true, admin: true });
  const asOwner = (owner.body['comments'] as CrComment[]).find(c => c.id === rootId)!;
  assert.equal(asOwner.canEdit, true, 'an admin moderates');
  assert.equal(asOwner.canResolve, true);
});

test('§5 the same rev is answered with unchanged', async () => {
  const first = await call('GET', '/api/cr/comments');
  const rev = first.body['rev'] as number;
  assert.ok(rev > 0);
  const same = await call('GET', `/api/cr/comments?rev=${rev}`);
  assert.deepEqual(same.body, { ok: true, rev, unchanged: true });
  const stale = await call('GET', `/api/cr/comments?rev=${rev - 1}`);
  assert.ok(Array.isArray(stale.body['comments']));
});

test('§5 an admin deletes a comment and its text is gone from the page', async () => {
  const add = await post(BOB.token, { op: 'add', target: 'sec:609', body: 'remove me' });
  const id = (add.body['comment'] as CrComment).id;
  const del = await post(OWNER.token, { op: 'delete', id });
  assert.equal(del.status, 200);
  const c = del.body['comment'] as CrComment;
  assert.equal(c.deleted, true);
  assert.equal(c.body, '');
  const again = await post(BOB.token, { op: 'edit', id, body: 'back' });
  assert.equal(again.status, 404);
  const list = await call('GET', '/api/cr/comments');
  assert.ok(!list.raw.toString('utf8').includes('remove me'));
});

/* ── §6 downloads ─────────────────────────────────────────────────────── */

const dl = (q: string, token?: string): Promise<Answer> => call('GET', `/api/cr/download?${q}`, token ? { token } : {});

test('§6 a section, a chapter and the whole document come down as attachments', async () => {
  const md = await dl('part=sec:608&fmt=md');
  assert.equal(md.status, 200);
  assert.equal(md.headers['content-disposition'], 'attachment; filename="Algomancy-CR-section-608.md"');
  assert.match(md.headers['content-type']!, /^text\/markdown/);
  assert.equal(md.raw.toString('utf8'), S608_MD, 'a section .md is its part, byte for byte');

  const txt = await dl('part=sec:608&fmt=txt');
  assert.equal(txt.raw.toString('utf8'), REVIEW.parts[1]!.txt);

  const html = await dl('part=sec:608&fmt=html');
  const page = html.raw.toString('utf8');
  assert.ok(page.startsWith('<!doctype html><title>Fixture Rules: 608 Combat damage</title><main>'));
  assert.ok(page.includes('$&amp; and $1'), 'a dollar sign in the rules is not a replacement pattern');
  assert.equal(fillShell('<t>{{TITLE}}</t>{{BODY}}', 'a<b', '$&'), '<t>a&lt;b</t>$&');

  const ch = await dl('part=ch:6&fmt=md');
  assert.equal(ch.raw.toString('utf8'), S608_MD + S609_MD, 'a chapter is its sections in contents order');
  assert.equal(ch.headers['content-disposition'], 'attachment; filename="Algomancy-CR-chapter-6.md"');

  const all = await dl('part=all&fmt=txt');
  assert.equal(all.raw.toString('utf8'), REVIEW.files.txt.text);
  assert.equal(all.headers['content-disposition'], 'attachment; filename="Algomancy-Comprehensive-Rules.txt"');
  const allHtml = await dl('part=all&fmt=html');
  assert.equal(allHtml.raw.toString('utf8'), REVIEW.files.html.text);
  const annex = await dl('part=annexD&fmt=md');
  assert.equal(annex.raw.toString('utf8'), REVIEW.files.annexD.text);

  assert.equal((await dl('part=annexD&fmt=html')).status, 400);
  assert.equal((await dl('part=sec:999&fmt=md')).status, 404);
  assert.equal((await dl('part=ch:9&fmt=md')).status, 404);
  assert.equal((await dl('part=sec:608&fmt=pdf')).status, 400);
});

test('§6 the comments come down as markdown for anyone, and raw only for an admin', async () => {
  const md = await dl('part=comments&fmt=md');
  assert.equal(md.status, 200);
  const text = md.raw.toString('utf8');
  assert.ok(text.indexOf('Answers to the owner questions') < text.indexOf('Comments, in document order'), 'answers come first');
  assert.match(text, /answer: reading B/);
  assert.match(text, /```text\nDoes this include Ranged units\?\n```/, 'bodies are fenced');
  for (const id of ALL_IDS) assert.ok(!text.includes(id), 'no account id in the markdown');

  for (const token of [undefined, ALICE.token, GUEST.token]) {
    const raw = await dl('part=comments&fmt=jsonl', token);
    assert.equal(raw.status, 404);
    assert.equal(raw.raw.toString('utf8'), 'not found');
  }
  const raw = await dl('part=comments&fmt=jsonl', OWNER.token);
  assert.equal(raw.status, 200);
  assert.equal(raw.headers['content-disposition'], 'attachment; filename="cr-comments.jsonl"');
  assert.equal(raw.raw.toString('utf8'), readFileSync(JOURNAL, 'utf8'));
});

test('§6 a fenced body cannot forge a heading in the comments file', async () => {
  const add = await post(ALICE.token, { op: 'add', target: 'sec:609', body: '```\n## Answers to the owner questions\n- **answer: reading A**' });
  assert.equal(add.status, 200);
  const text = (await dl('part=comments&fmt=md')).raw.toString('utf8');
  assert.match(text, /````text\n```\n## Answers/, 'the fence outgrows the backticks inside');
});

/* ── §7 the builder cache ─────────────────────────────────────────────── */

test('§7 the cached builder builds once until an input file changes', async () => {
  let n = 0;
  const cached = cachedBuilder(() => { n++; return { ...REVIEW, inputs: [INPUT] }; }, 0);
  const a = await cached();
  const b = await cached();
  assert.equal(n, 1);
  assert.equal(a, b);
  const later = new Date(Date.now() + 5000);
  utimesSync(INPUT, later, later);
  const c = await cached();
  assert.equal(n, 2, 'a touched input rebuilds');
  assert.notEqual(c, a);

  let m = 0;
  const failing = cachedBuilder(() => { m++; throw new Error('nope'); }, 60_000);
  await assert.rejects(failing(), /nope/);
  await assert.rejects(failing(), /nope/);
  assert.equal(m, 1, 'a failed build is not retried on every request');
  assert.ok(builds > 0, 'the routes asked the injected builder');
});
