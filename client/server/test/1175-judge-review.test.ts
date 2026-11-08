/* BL-17 — THE JUDGES' REVIEW QUEUE, server half (api-judge-review.ts), in
 * process, against a fixture of the rules bot's answers.
 *
 * §1 who may look: signed out, a guest and a plain player get a 404; a judge,
 *    the owner and an admin get the page — and no account id is in it
 * §2 a flag: a judge's note lands in the journal with a copy of the question,
 *    and the flagged answer is listed first, the highest badge's first; an L3's
 *    or the owner's flag is the authoritative one
 * §3 what a flag must be: a note, under the cap, on an answer the bot has; an
 *    admin without a badge reads but does not flag
 * §4 unflag is the judge's own; resolve is the owner's or an admin's, and a new
 *    flag reopens a resolved answer
 * §5 the queue outlives the bot: with the bot unreachable, every flagged
 *    answer is still listed, from its copy, and the page says why the rest are missing
 * §6 the fold ignores a row its writer could not have made
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JudgeReviewDoc } from '../../ui/judgetypes.ts';

const dir = mkdtempSync(join(tmpdir(), 'judge-review-'));
const JOURNAL = join(dir, 'judge-flags.jsonl');
process.env['ALGO_JUDGE_FLAGS_FILE'] = JOURNAL;

const { register, registerGuest, setAdmin, setBadge, useAccountsFile, accountForToken } = await import('../accounts.ts');
const { judgeReviewRoutes, foldFlags, readFlags, JUDGE_REVIEW_LIMITS } = await import('../api-judge-review.ts');
type BotAnswer = import('../api-judge-review.ts').BotAnswer;
type JudgeFlagRow = import('../api-judge-review.ts').JudgeFlagRow;

const restoreAccounts = useAccountsFile(join(dir, 'accounts.json'));
test.after(() => { restoreAccounts(); delete process.env['ALGO_JUDGE_FLAGS_FILE']; rmSync(dir, { recursive: true, force: true }); });

function named(name: string): { id: string; token: string } {
  const r = register(name, 'correct horse battery');
  assert.ok(r.ok);
  return { id: r.account.id, token: r.token };
}
const PLAYER = named('player');
const L1 = named('lowjudge');
const L3 = named('highjudge');
const OWNER = named('theowner');
const ADMIN = named('operator');
const GUEST = (() => { const r = registerGuest(); assert.ok(r.ok); return { id: r.account.id, token: r.token }; })();
assert.ok(setBadge(accountForToken(L1.token)!, { judge: 1 }));
assert.ok(setBadge(accountForToken(L3.token)!, { judge: 3 }));
assert.ok(setBadge(accountForToken(OWNER.token)!, { owner: true }));
assert.ok(setAdmin(accountForToken(ADMIN.token)!, true));
const ALL_IDS = [PLAYER.id, L1.id, L3.id, OWNER.id, ADMIN.id, GUEST.id];

/* ── the bot's log, as a fixture ──────────────────────────────────────── */

const rid = (n: number): string => n.toString(16).padStart(32, '0');
let BOT: BotAnswer[] = [3, 2, 1].map(n => ({
  id: rid(n), ts: `2026-11-0${n}T10:00:00Z`, kind: 'ask', surface: n === 2 ? 'discord' : 'web',
  question: `question ${n}`, answer: `answer ${n}`,
}));
let botDown = false;
const deps = {
  fetchQuestions: async (limit: number): Promise<BotAnswer[]> => {
    if (botDown) throw new Error('connection refused');
    return BOT.slice(0, limit);
  },
};

interface Answer { status: number; body: Record<string, unknown> }
let addrN = 0;
async function call(method: string, path: string, token?: string, body?: unknown, addr?: string): Promise<Answer> {
  const text = body === undefined ? '' : JSON.stringify(body);
  const req = Object.assign(Readable.from(text ? [Buffer.from(text)] : []), {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    socket: { remoteAddress: addr ?? `10.1.0.${(addrN++ % 200) + 1}` },
  }) as unknown as IncomingMessage;
  let status = 0;
  let raw = '';
  const res = {
    writeHead(s: number) { status = s; return res; },
    end(b?: string) { raw = b ?? ''; return res; },
  } as unknown as ServerResponse;
  const url = new URL(`http://x${path}`);
  assert.equal(await judgeReviewRoutes(req, res, url.pathname, url, deps), true, `${method} ${path} not handled`);
  return { status, body: raw ? JSON.parse(raw) as Record<string, unknown> : {} };
}
const page = async (token: string): Promise<JudgeReviewDoc> => {
  const r = await call('GET', '/api/judge-review', token);
  assert.equal(r.status, 200);
  return r.body as unknown as JudgeReviewDoc;
};
const flag = (token: string, body: Record<string, unknown>): Promise<Answer> => call('POST', '/api/judge-review/flag', token, body);

test('§0 another path is not this module\'s', async () => {
  const req = Object.assign(Readable.from([]), { method: 'GET', headers: {}, socket: {} }) as unknown as IncomingMessage;
  assert.equal(await judgeReviewRoutes(req, {} as ServerResponse, '/api/judge', new URL('http://x/api/judge'), deps), false);
});

test('§1 who may look: a 404 to anybody unbadged, the page to a judge, the owner and an admin', async () => {
  for (const t of [undefined, GUEST.token, PLAYER.token, 'not-a-token']) {
    assert.equal((await call('GET', '/api/judge-review', t)).status, 404, `token ${t}`);
    assert.equal((await call('POST', '/api/judge-review/flag', t, { id: rid(1), action: 'flag', note: 'x' })).status, 404);
  }
  for (const who of [L1, L3, OWNER, ADMIN]) {
    const d = await page(who.token);
    assert.deepEqual(d.questions.map(q => q.id), [rid(3), rid(2), rid(1)], 'newest first when nothing is flagged');
    assert.equal(d.error, undefined);
  }
  assert.deepEqual((await page(L1.token)).you, { name: 'lowjudge', judge: 1, canResolve: false });
  assert.deepEqual((await page(OWNER.token)).you, { name: 'theowner', owner: true, canResolve: true });
  assert.equal((await page(ADMIN.token)).you.canResolve, true);
});

test('§2 a flag goes in the journal with its copy, and the flagged answer leads, the highest badge first', async () => {
  assert.equal((await flag(L1.token, { id: rid(1), action: 'flag', note: 'Fight cannot target your own unit.' })).status, 200);
  let d = await page(L3.token);
  assert.deepEqual(d.questions.map(q => q.id), [rid(1), rid(3), rid(2)], 'the flagged answer first');
  assert.deepEqual(d.questions[0]!.flags.map(f => ({ ...f, at: '' })),
    [{ by: { name: 'lowjudge', judge: 1 }, note: 'Fight cannot target your own unit.', at: '', authoritative: false, mine: false }]);
  assert.equal((await page(L1.token)).questions[0]!.flags[0]!.mine, true, 'the judge sees it as theirs');

  // an L3 flag outranks it, whatever the dates
  assert.equal((await flag(L3.token, { id: rid(2), action: 'flag', note: 'Haste is wrong here — the rule is 302.1.' })).status, 200);
  d = await page(OWNER.token);
  assert.deepEqual(d.questions.map(q => q.id), [rid(2), rid(1), rid(3)]);
  assert.equal(d.questions[0]!.flags[0]!.authoritative, true, 'an L3 flag is word of law');
  // two judges on one answer: both stand, the higher first
  assert.equal((await flag(L1.token, { id: rid(2), action: 'flag', note: 'agreed' })).status, 200);
  d = await page(OWNER.token);
  assert.deepEqual(d.questions[0]!.flags.map(f => f.by.name), ['highjudge', 'lowjudge']);
  // a judge flagging again replaces their own note
  assert.equal((await flag(L1.token, { id: rid(2), action: 'flag', note: 'agreed, and see the RAQ' })).status, 200);
  d = await page(OWNER.token);
  assert.deepEqual(d.questions[0]!.flags.map(f => f.note), ['Haste is wrong here — the rule is 302.1.', 'agreed, and see the RAQ']);

  const rows = readFileSync(JOURNAL, 'utf8').trim().split('\n').map(l => JSON.parse(l) as JudgeFlagRow);
  assert.equal(rows[0]!.q?.question, 'question 1', 'the flag keeps a copy of the question');
  assert.equal(rows[0]!.by.id, L1.id, 'the journal knows who');
  const sent = JSON.stringify(await page(OWNER.token));
  for (const id of ALL_IDS) assert.ok(!sent.includes(id), 'no account id on the page');
});

test('§3 a flag needs a note, under the cap, on an answer the bot has, from a badge', async () => {
  assert.equal((await flag(L1.token, { id: rid(3), action: 'flag', note: '   ' })).status, 400);
  assert.equal((await flag(L1.token, { id: rid(3), action: 'flag', note: 'x'.repeat(JUDGE_REVIEW_LIMITS.note + 1) })).status, 400);
  assert.equal((await flag(L1.token, { id: rid(99), action: 'flag', note: 'gone' })).status, 404);
  assert.equal((await flag(L1.token, { id: 'not-hex', action: 'flag', note: 'x' })).status, 400);
  assert.equal((await flag(L1.token, { id: rid(3), action: 'delete' })).status, 400);
  assert.equal((await flag(ADMIN.token, { id: rid(3), action: 'flag', note: 'an operator, not a judge' })).status, 403);
  assert.equal((await page(OWNER.token)).questions.find(q => q.id === rid(3))!.flags.length, 0);
});

test('§4 unflag is the judge\'s own; resolve is the owner\'s or an admin\'s; a new flag reopens', async () => {
  assert.equal((await flag(L3.token, { id: rid(1), action: 'unflag' })).status, 409, 'not their flag');
  assert.equal((await flag(L1.token, { id: rid(1), action: 'unflag' })).status, 200);
  assert.equal((await page(OWNER.token)).questions.find(q => q.id === rid(1))!.flags.length, 0);

  assert.equal((await flag(L3.token, { id: rid(2), action: 'resolve' })).status, 403, 'a judge does not resolve');
  assert.equal((await flag(OWNER.token, { id: rid(3), action: 'resolve' })).status, 409, 'nothing to resolve');
  assert.equal((await flag(OWNER.token, { id: rid(2), action: 'resolve' })).status, 200);
  let d = await page(OWNER.token);
  const two = d.questions.find(q => q.id === rid(2))!;
  assert.equal(two.flags.length, 0);
  assert.equal(two.resolved?.by.name, 'theowner');
  assert.deepEqual(d.questions.map(q => q.id), [rid(3), rid(2), rid(1)], 'dealt with: back in date order');

  assert.equal((await flag(L1.token, { id: rid(2), action: 'flag', note: 'still wrong after the fix' })).status, 200);
  d = await page(OWNER.token);
  assert.equal(d.questions[0]!.id, rid(2));
  assert.equal(d.questions[0]!.resolved, undefined, 'a new flag reopens it');
  assert.equal((await flag(ADMIN.token, { id: rid(2), action: 'resolve' })).status, 200, 'an admin resolves too');
  assert.equal((await page(OWNER.token)).questions.find(q => q.id === rid(2))!.flags.length, 0);
});

test('§5 the bot unreachable or past its window: every flagged answer is still listed, from its copy', async () => {
  assert.equal((await flag(L3.token, { id: rid(3), action: 'flag', note: 'wrong' })).status, 200);
  BOT = BOT.filter(a => a.id !== rid(3));          // scrolled out of the bot's window
  let d = await page(L1.token);
  assert.equal(d.questions[0]!.id, rid(3));
  assert.equal(d.questions[0]!.question, 'question 3', 'from the copy the flag kept');
  botDown = true;
  try {
    d = await page(L1.token);
    assert.deepEqual(d.questions.map(q => q.id), [rid(3)], 'only the flagged one, unflagged ones need the bot');
    assert.match(d.error ?? '', /could not be read \(connection refused\)/);
    // a judge can still flag what the queue already holds a copy of, and update it
    assert.equal((await flag(L1.token, { id: rid(3), action: 'flag', note: 'me too' })).status, 200);
    assert.equal((await flag(L1.token, { id: rid(7), action: 'flag', note: 'no copy of this one' })).status, 404);
  } finally { botDown = false; }
});

test('§6 the fold ignores a row its writer could not have made', () => {
  const judge = { id: 'J', name: 'j', judge: 2 as const };
  const player = { id: 'P', name: 'p' };
  const rows: JudgeFlagRow[] = [
    { v: 1, op: 'flag', id: 'a', at: '1', by: judge, note: 'n' },
    { v: 1, op: 'flag', id: 'b', at: '2', by: player, note: 'a player cannot flag' },
    { v: 1, op: 'resolve', id: 'a', at: '3', by: judge },            // a judge cannot resolve
    { v: 1, op: 'unflag', id: 'a', at: '4', by: player },            // nor anybody unflag another's
  ];
  const f = foldFlags(rows);
  assert.equal(f.get('a')!.flags.size, 1);
  assert.equal(f.get('a')!.resolved, undefined);
  assert.equal(f.get('b')!.flags.size, 0);
  const before = readFlags().length;
  writeFileSync(JOURNAL, '{"v":1,"op":"flag"\n' + readFileSync(JOURNAL, 'utf8') + '{"v":1,"op":"fl');   // torn lines
  assert.equal(readFlags().length, before, 'a torn line is skipped, never fatal');
});
