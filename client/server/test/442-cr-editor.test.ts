/* THE COMMENT-REVIEW PROCESS'S TWO HALVES: what it reads (scripts/cr/
 * comments.mjs: the open threads and their live context) and how it answers
 * (POST /api/cr/editor, as the Rules editor, behind the bot token).
 * data/comprehensive-rules/README.md, "How to apply a review comment".
 *
 * §1 open threads are the server's own fold: a resolved root drops out, a
 *    reopened one comes back, a deleted root is gone, replies ride along, and
 *    a resolve forged by somebody who could not make it changes nothing
 * §2 the context: the live number through a rename, the anchor marked
 *    outdated when its quote has left the text, and everything sharing the key
 * §3 the door does not exist without the token: the route falls through to
 *    the 404 every unserved path gets
 * §4 through the door: a reply lands under the thread as the Rules editor
 *    (no account, no owner mark), a resolve closes it, a reopen opens it; a
 *    reply to a reply, an unknown id, an empty body and a double resolve are
 *    refused, and the door cannot start a thread
 * §5 the CLI's request, sent over real HTTP with the x-algo-bot header,
 *    resolves the thread; the wrong token reaches nothing
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import type { CrReview } from '../../ui/crtypes.ts';

const dir = mkdtempSync(join(tmpdir(), 'cr-editor-'));
const JOURNAL = join(dir, 'cr-comments.jsonl');
process.env['ALGO_CR_COMMENTS_FILE'] = JOURNAL;
test.after(() => { delete process.env['ALGO_CR_COMMENTS_FILE']; rmSync(dir, { recursive: true, force: true }); });

const { crReviewRoutes } = await import('../api-crreview.ts');
const { fold, readJournal, RULES_EDITOR } = await import('../crreview.ts');
type CrRow = import('../crreview.ts').CrRow;
// @ts-expect-error — a plain .mjs script, typed by use
const C = await import('../../engine/scripts/cr/comments.mjs') as {
  threadsOf: (items: Map<string, unknown>, o?: { all?: boolean }) => { root: { id: string; resolved?: unknown }; replies: { id: string; body: string }[] }[];
  contextFor: (root: unknown, inputs: unknown) => Record<string, any>;
  editorRequest: (op: string, id: string, body?: string) => { path: string; payload: Record<string, unknown> };
  sendToServer: (server: string, req: { path: string; payload: Record<string, unknown> }, token: string) => Promise<{ status: number; answer: Record<string, any> }>;
  loadThreads: (file: string, o?: { all?: boolean }) => { root: { id: string } }[];
};

const OWNER = { id: 'acc-owner', name: 'mycheze', owner: true as const, judge: 1 as const };
const BOB = { id: 'acc-bob', name: 'bob' };
const row = (r: Partial<CrRow> & Pick<CrRow, 'op' | 'id' | 'by'>): CrRow => ({ v: 1, at: `2026-10-11T00:00:${String(n++).padStart(2, '0')}Z`, ...r });
let n = 0;
const write = (rows: CrRow[]): void => writeFileSync(JOURNAL, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const ids = (ts: { root: { id: string } }[]): string[] => ts.map(t => t.root.id);

/* ── §1 ───────────────────────────────────────────────────────────────── */

test('§1 open threads: resolved drops out, reopened comes back, deleted is gone, a forged resolve is ignored', () => {
  const rows: CrRow[] = [
    row({ op: 'add', id: 'c_a_000001', by: OWNER, target: 'rule:attr.general', parent: null, anchor: null, body: 'not just combat' }),
    row({ op: 'add', id: 'c_b_000002', by: OWNER, target: 'finding:F-U01-2', parent: null, anchor: null, body: 'not true' }),
    row({ op: 'add', id: 'c_c_000003', by: BOB, target: 'rule:x', parent: null, anchor: null, body: 'gone' }),
    row({ op: 'add', id: 'c_r_000004', by: BOB, target: 'rule:attr.general', parent: 'c_a_000001', anchor: null, body: 'agreed' }),
    row({ op: 'resolve', id: 'c_b_000002', by: OWNER }),
    row({ op: 'delete', id: 'c_c_000003', by: BOB }),
    row({ op: 'resolve', id: 'c_a_000001', by: BOB }),          // bob is not its author and not flagged asAdmin
  ];
  const open = C.threadsOf(fold(rows));
  assert.deepEqual(ids(open), ['c_a_000001']);
  assert.deepEqual(open[0]!.replies.map(r => r.body), ['agreed']);
  assert.deepEqual(ids(C.threadsOf(fold(rows), { all: true })), ['c_a_000001', 'c_b_000002']);

  rows.push(row({ op: 'reopen', id: 'c_b_000002', by: OWNER }));
  assert.deepEqual(ids(C.threadsOf(fold(rows))), ['c_a_000001', 'c_b_000002']);

  // loadThreads reads a FILE with the server's reader, and leaves the env as it found it
  const other = join(dir, 'snapshot.jsonl');
  writeFileSync(other, rows.map(r => JSON.stringify(r)).join('\n') + '\n{torn line\n');
  assert.deepEqual(ids(C.loadThreads(other)), ['c_a_000001', 'c_b_000002']);
  assert.equal(process.env['ALGO_CR_COMMENTS_FILE'], JOURNAL);
});

/* ── §2 ───────────────────────────────────────────────────────────────── */

test('§2 context: live number through a rename, the anchor outdated once its quote is gone, the key\'s neighbours', () => {
  const rule = { key: 'attr.general', text: 'Attributes are qualities that describe a card or a token.', see: ['204'] };
  const citing = { key: 'attr.flying.column', text: 'Flying is shared (see rule attr.general).', see: [] };
  const sharing = { key: 'combat.regions.zones', text: 'Zones are regional.', see: [], engineDiffers: ['F-U01-2'] };
  const finding = { id: 'F-U01-2', rule: 'concepts.golden.regions', title: 'The client keeps one stack', summary: 's', ct: 'CT-234', dupes: ['F-U01-4'] };
  const disc = { id: 'D-U19-1', rule: 'attr.general', tier: 4, summary: 'a note' };
  const gloss = { term: 'Attribute', text: 'A quality.', see: ['attr.general'] };
  const golden = { key: 'concepts.golden.regions', text: 'Every effect is specific to its region.', see: [], engineDiffers: ['F-U01-2'] };
  const fileOf = new Map<unknown, string>([[rule, 'U19.json'], [citing, 'U19.json'], [sharing, 'U10.json'], [golden, 'U01.json'], [finding, 'findings/U01.json'], [disc, 'discrepancies/U19.json']]);
  const inputs = {
    records: [rule, citing, sharing, golden], glossary: [gloss], findings: [finding], discrepancies: [disc], fileOf,
    ledger: { version: 1, entries: [
      // a renamed rule keeps its ledger entry under the OLD key; the alias names the new one
      { num: '802.1', key: 'attr.old-name' }, { num: '802.2b', key: 'attr.flying.column' },
      { num: '601.2a', key: 'combat.regions.zones' }, { num: '101.6', key: 'concepts.golden.regions' },
    ], aliases: [{ from: 'attr.old-name', to: 'attr.general' }] },
  };

  const ctx = C.contextFor({ target: 'rule:attr.old-name', anchor: { quote: 'engages in combat', edition: 'E1', num: '802.1', prefix: '', suffix: '', start: 0 } }, inputs);
  assert.equal(ctx['key'], 'attr.general');
  assert.equal(ctx['renamedFrom'], 'attr.old-name');
  assert.equal(ctx['num'], '802.1');
  assert.equal(ctx['file'], 'rules/U19.json');
  assert.equal(ctx['anchor'].outdated, true, 'the quote left the text when the rule was redrafted');
  assert.deepEqual(ctx['anchor'].why, ['the quote is no longer in the text']);
  assert.deepEqual(ctx['related'].rules.map((r: { key: string }) => r.key), ['attr.flying.column']);
  assert.deepEqual(ctx['related'].discrepancies.map((d: { id: string }) => d.id), ['D-U19-1']);
  assert.deepEqual(ctx['related'].glossary.map((g: { term: string }) => g.term), ['Attribute']);

  const still = C.contextFor({ target: 'rule:attr.general', anchor: { quote: 'describe a card', edition: 'E1', num: '802.1' } }, inputs);
  assert.equal(still['anchor'].outdated, false);

  // a finding: its row, its rule, and every rule that cites the finding as engine-differs
  const f = C.contextFor({ target: 'finding:F-U01-4', anchor: null }, inputs);
  assert.equal(f['keptAs'], 'F-U01-2', 'a dupe resolves to the kept finding');
  assert.equal(f['rule'].num, '101.6');
  assert.deepEqual(f['related'].rules.map((r: { key: string }) => r.key), ['combat.regions.zones']);
  assert.deepEqual(f['related'].findings.map((x: { id: string }) => x.id), ['F-U01-2']);
});

/* ── a fake request, as 436 does it ───────────────────────────────────── */

const REVIEW = { targets: ['rule:attr.general'], ownerQuestions: [] } as unknown as CrReview;
async function call(body: unknown, editorAllowed?: boolean): Promise<{ handled: boolean; status: number; body: Record<string, any> }> {
  const text = JSON.stringify(body);
  const req = Object.assign(Readable.from([Buffer.from(text)]), { method: 'POST', headers: {}, socket: { remoteAddress: '10.9.9.9' } }) as unknown as IncomingMessage;
  let status = 0; let raw = '';
  const res = {
    writeHead(s: number) { status = s; return res; },
    end(b?: string | Buffer) { raw = b === undefined ? '' : String(b); return res; },
  } as unknown as ServerResponse;
  const url = new URL('http://x/api/cr/editor');
  const handled = await crReviewRoutes(req, res, url.pathname, url, { review: async () => REVIEW, ...(editorAllowed === undefined ? {} : { editorAllowed }) });
  return { handled, status, body: raw ? JSON.parse(raw) as Record<string, any> : {} };
}

/* ── §3 ───────────────────────────────────────────────────────────────── */

test('§3 without the token the door is not there: the route falls through, nothing is written', async () => {
  write([row({ op: 'add', id: 'c_d_000010', by: OWNER, target: 'rule:attr.general', parent: null, anchor: null, body: 'q' })]);
  const before = readFileSync(JOURNAL, 'utf8');
  for (const allowed of [undefined, false]) {
    const r = await call({ op: 'resolve', id: 'c_d_000010' }, allowed);
    assert.equal(r.handled, false, `editorAllowed=${allowed}: falls through to the server's 404`);
  }
  assert.equal(readFileSync(JOURNAL, 'utf8'), before);
});

/* ── §4 ───────────────────────────────────────────────────────────────── */

test('§4 through the door: reply as the Rules editor, resolve, reopen; the refusals', async () => {
  write([
    row({ op: 'add', id: 'c_e_000020', by: OWNER, target: 'rule:attr.general', parent: null, anchor: null, body: 'not just combat' }),
    row({ op: 'add', id: 'c_f_000021', by: BOB, target: 'rule:attr.general', parent: 'c_e_000020', anchor: null, body: 'a reply' }),
  ]);

  const reply = await call({ op: 'reply', id: 'c_e_000020', body: 'Fixed in 802.1.' }, true);
  assert.equal(reply.status, 200);
  assert.equal(reply.body['comment'].by.name, 'Rules editor');
  assert.equal(reply.body['comment'].by.owner, undefined, 'never the owner\'s mark');
  assert.equal(reply.body['comment'].parent, 'c_e_000020');
  const written = readJournal().at(-1)!;
  assert.deepEqual(written.by, RULES_EDITOR);
  assert.equal(written.target, 'rule:attr.general', 'a reply takes its thread\'s target');

  assert.equal((await call({ op: 'resolve', id: 'c_e_000020' }, true)).status, 200);
  assert.deepEqual(ids(C.threadsOf(fold(readJournal()))), [], 'the fold lets the editor\'s resolve stand');
  assert.equal(fold(readJournal()).get('c_e_000020')!.resolved!.by, 'Rules editor');
  assert.equal((await call({ op: 'resolve', id: 'c_e_000020' }, true)).status, 409);
  assert.equal((await call({ op: 'reopen', id: 'c_e_000020' }, true)).status, 200);
  assert.deepEqual(ids(C.threadsOf(fold(readJournal()))), ['c_e_000020']);

  assert.equal((await call({ op: 'reply', id: 'c_f_000021', body: 'x' }, true)).status, 400, 'threads are one deep');
  assert.equal((await call({ op: 'reply', id: 'c_zz_000000', body: 'x' }, true)).status, 404);
  assert.equal((await call({ op: 'reply', id: 'c_e_000020', body: '   ' }, true)).status, 400);
  assert.equal((await call({ op: 'resolve', id: 'c_e_000020', body: 'words' }, true)).status, 400);
  for (const op of ['add', 'edit', 'delete']) {
    assert.equal((await call({ op, id: 'c_e_000020', body: 'x', target: 'rule:attr.general' }, true)).status, 400, `the door does not ${op}`);
  }
});

/* ── §5 ───────────────────────────────────────────────────────────────── */

test('§5 the CLI request over real HTTP: the right token resolves, the wrong one reaches a 404', async () => {
  write([row({ op: 'add', id: 'c_g_000030', by: OWNER, target: 'rule:attr.general', parent: null, anchor: null, body: 'q' })]);
  const TOKEN = 'test-bot-token';
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    // main.ts's botAllowed(), in miniature: the header, compared to the token
    void crReviewRoutes(req, res, url.pathname, url, { review: async () => REVIEW, editorAllowed: req.headers['x-algo-bot'] === TOKEN })
      .then((handled) => { if (!handled) { res.writeHead(404); res.end('not found'); } });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.throws(() => C.editorRequest('delete', 'c_g_000030'), /reply, resolve or reopen/);
    assert.throws(() => C.editorRequest('reply', 'c_g_000030', ''), /body/);
    const wrong = await C.sendToServer(base, C.editorRequest('resolve', 'c_g_000030'), 'nope');
    assert.equal(wrong.status, 404);
    await assert.rejects(C.sendToServer(base, C.editorRequest('resolve', 'c_g_000030'), ''), /ALGO_BOT_TOKEN/);
    const ok = await C.sendToServer(base, C.editorRequest('resolve', 'c_g_000030'), TOKEN);
    assert.equal(ok.status, 200);
    assert.equal(ok.answer['comment'].resolved.by, 'Rules editor');
  } finally {
    server.close();
  }
});
