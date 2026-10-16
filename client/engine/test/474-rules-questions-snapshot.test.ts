/**
 * The rules-questions snapshot (ledgers/rules-questions.snapshot.jsonl): the
 * designer's messages in the FLAT rules-questions channel that a comprehensive
 * rule cites as `RQ <messageId>`, verbatim, with their context.
 *
 * Caleb answers there as often as in the RAQ threads, and until 2026-10-16 no
 * committed record could cite him: the export is gitignored and 67 MB, and
 * index-raq.mjs leaves the channel out on purpose. The snapshot holds ONLY the
 * cited messages; cr:check (409 §8) verifies a quote against it the way it
 * verifies a RAQ claim. This file keeps the snapshot honest — every row the
 * designer's, every row with its context — and proves the writer
 * (scripts/index-rq.mjs) refuses a player's message and an unknown id.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RQ_SNAPSHOT } from '../scripts/paths.mjs';
import { DESIGNER_AUTHOR, MAX_QUOTE, norm, parseRef } from '../scripts/cr/schema.mjs';
import { extract, rqMessages } from '../scripts/cr/extract.mjs';
import { readSnapshot, rowFor, RULES_QUESTIONS_CHANNEL, type ExportMessage } from '../scripts/index-rq.mjs';

const ROWS = readSnapshot(RQ_SNAPSHOT);
const SCRIPT = fileURLToPath(new URL('../scripts/index-rq.mjs', import.meta.url));

test('every row of the snapshot is a designer message, unique, in id order, with its context', () => {
  assert.ok(ROWS.length > 0, 'the snapshot is empty');
  const ids = ROWS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'an id appears twice');
  const sorted = [...ids].sort((a, b) => (a.length - b.length) || (a < b ? -1 : 1));
  assert.deepEqual(ids, sorted, 'rows are not in id order (re-run rq:index, which sorts)');
  for (const r of ROWS) {
    assert.match(r.id, /^\d{15,20}$/, `${r.id} is not a message id`);
    assert.equal(r.author, DESIGNER_AUTHOR, `RQ ${r.id} was written by ${r.author}: only the designer is authority`);
    assert.ok(typeof r.content === 'string' && r.content.trim(), `RQ ${r.id} has no content`);
    assert.ok(Array.isArray(r.before), `RQ ${r.id} carries no context`);
    assert.ok(r.replyTo === null || typeof r.replyTo?.id === 'string', `RQ ${r.id} replyTo is malformed`);
    assert.equal(parseRef(`RQ ${r.id}`)?.type, 'rq');
  }
});

test('the extract carries every snapshot row with a content hash', () => {
  const x = extract();
  assert.deepEqual(x.rq?.map((m) => m.id), ROWS.map((r) => r.id));
  for (const m of x.rq ?? []) assert.match(m.textHash, /^[0-9a-f]{64}$/);
});

/**
 * The seeded citations, verbatim (whitespace-normalised, as cr:check reads
 * them). The drafter cites these; a refresh that changes one of them is a
 * designer edit upstream, and every rule quoting it goes stale.
 */
const SEEDED: [string, string][] = [
  ['1145226276911714384', 'they would end up with +2/+2 buff, the second transmogrifant turns off the irst one'],
  ['1148449043282927626', 'The two transmogrifants would turn off the other one though so you could only have one of them active at once.'],
  ['1148463157115887656', 'Oh true I guess one would get +2/+2 and one would mot'],
  ['1151901699108241438', "There is no floating currently. I'd like to avoid that concept if possible"],
  ['1362265958088966396', 'Yes'],
  ['1442981258178199625', "if it was though, replacement effects don't work like triggers"],
  ['1442981369432113342', "for example doesn't go infinite when you make a token"],
  ['1442981461476245685', 'its a replacement effect so it just takes one thing and replaces it with another (you the player control how they stack)'],
  ['1442981490639110274', '1 token -> 2 tokens'],
  ['1442981580535496807', 'if you have two automatons'],
  ['1442981663603687588', '1 token -> 2tokens -> 3 tokens'],
  ['1442981970148720750', 'so if resonant wasn\'t a trigger it would be like "If resonant would deal damage to a unit, it deals that much damage to that unit\'s controller instead"'],
  ['1442982057482518559', 'then we get "Damage unit -> controller -> unit"'],
  ['1442982147425177650', 'so it basically just would do nothing if it was a replacement effect with oorblak out'],
  ['1442982460034912287', 'the tldr is replacement effects only apply once onto an effect'],
  ['1442982533443621096', 'in this analogy, you can only draw an arrow once per replacement'],
];

test('the seeded citations are verbatim in the snapshot and fit the quote contract', () => {
  const byId = new Map(ROWS.map((r) => [r.id, r]));
  for (const [id, q] of SEEDED) {
    const r = byId.get(id);
    assert.ok(r, `RQ ${id} is not in the snapshot`);
    assert.ok(q.length <= MAX_QUOTE && !/[\r\n]/.test(q), `the quote of RQ ${id} breaks the contract`);
    assert.ok(norm(r.content).includes(norm(q)), `not verbatim in RQ ${id}: ${q}`);
  }
  // the Plague Bellower answer is only "Yes": the question has to be in its context
  const yes = byId.get('1362265958088966396')!;
  assert.ok(yes.before.some((b) => /plague bellower trigger wandering blight shell/i.test(b.content)), 'the question the Yes answers is not in its context');
});

/* ── the writer, over a fixture export ─────────────────────────────────── */

const M = (id: string, name: string, content: string, extra: Partial<ExportMessage> = {}): ExportMessage =>
  ({ id, timestamp: `2025-04-17T05:${id.slice(-2)}:00.000+00:00`, content, author: { name, isBot: name === 'FriendlyBot' }, ...extra });
const FIXTURE: ExportMessage[] = [
  M('100000000000000010', 'jkkim240', 'Does plague bellower trigger wandering blight shell?'),
  M('100000000000000011', 'jkkim240', '$card Plague Bellower'),
  M('100000000000000012', 'FriendlyBot', ''),
  M('100000000000000013', DESIGNER_AUTHOR, 'Yes'),
  M('100000000000000014', 'jkkim240', 'Do counters negate each other?'),
  M('100000000000000015', DESIGNER_AUTHOR, 'Yes', { reference: { messageId: '100000000000000014' } }),
  M('100000000000000016', DESIGNER_AUTHOR, 'no', { reference: { messageId: '100000000000000001' } }),
];
const INDEX = new Map(FIXTURE.map((m, i) => [m.id, i]));

test('the writer keeps the context: the question past a card-bot call, the message replied to, a deleted one marked', () => {
  const a = rowFor(FIXTURE, INDEX, '100000000000000013');
  assert.deepEqual(a.row?.before.map((b) => b.content), ['Does plague bellower trigger wandering blight shell?', '$card Plague Bellower']);
  assert.equal(a.row?.replyTo, null);
  const b = rowFor(FIXTURE, INDEX, '100000000000000015');
  assert.equal(b.row?.replyTo && 'content' in b.row.replyTo ? b.row.replyTo.content : null, 'Do counters negate each other?');
  assert.deepEqual(rowFor(FIXTURE, INDEX, '100000000000000016').row?.replyTo, { id: '100000000000000001', missing: true });
});

test('the writer refuses a player message and an unknown id, and then writes nothing', () => {
  assert.match(rowFor(FIXTURE, INDEX, '100000000000000010').refused ?? '', /written by jkkim240, not calebgannon/);
  assert.match(rowFor(FIXTURE, INDEX, '100000000000000012').refused ?? '', /written by FriendlyBot/);
  assert.match(rowFor(FIXTURE, INDEX, '100000000000000099').refused ?? '', /not in the rules-questions export/);

  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'algo-474-'));
  const exp = join(dir, 'export.json'), out = join(dir, 'snapshot.jsonl');
  writeFileSync(exp, JSON.stringify({ channel: { id: RULES_QUESTIONS_CHANNEL, name: 'rules-questions' }, messages: FIXTURE }));
  const run = (...ids: string[]) => {
    try { return { code: 0, out: execFileSync(process.execPath, [SCRIPT, '--export', exp, '--out', out, ...ids], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
    catch (e) { const x = e as { status: number; stderr: string }; return { code: x.status, out: x.stderr }; }
  };
  const refused = run('100000000000000013', '100000000000000010');
  assert.equal(refused.code, 1, 'a player message was accepted');
  assert.match(refused.out, /jkkim240, not calebgannon[\s\S]*nothing written/);
  assert.equal(existsSync(out), false, 'a refused run wrote the snapshot');
  assert.equal(run('100000000000000099').code, 1, 'an unknown id was accepted');
  assert.equal(existsSync(out), false);
  const ok = run('100000000000000015', '100000000000000013');
  assert.equal(ok.code, 0, ok.out);
  const rows = rqMessages(out);
  assert.deepEqual(rows.map((r) => [r.id, r.author, r.content]), [
    ['100000000000000013', DESIGNER_AUTHOR, 'Yes'], ['100000000000000015', DESIGNER_AUTHOR, 'Yes'],
  ]);
  assert.equal(readFileSync(out, 'utf8').split('\n').filter(Boolean).length, 2);
});
