/* 1176 — BL-17, THE JUDGES' REVIEW PAGE, drawn without a page (ui/pages/judgereview.ts).
 *
 * §0 no DOM; the frame's root carries the page's class last
 * §1 refused: one sentence and the way out, nothing else
 * §2 the list in the server's order; a flagged row is marked, an L3's flag says
 *    "word of law"; the filter keeps flagged ones or the ones players disliked
 * §3 the buttons a caller gets: Flag for a judge, Edit and Take back on their
 *    own flag, Mark dealt with for the owner only; the form when editing
 * §4 text off the server is escaped (a question, an answer, a note, a name)
 * §5 the bot down says so; loading and an action's error say so
 * §6 the way in: the profile's Staff row offers it to a judge or the owner
 *    only, and main.ts routes its button, its clicks and its screen
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { judgeReviewHtml, shownQuestions, type JudgeReviewView } from '../pages/judgereview.ts';
import type { JudgeQuestion, JudgeReviewDoc } from '../judgetypes.ts';

const id = (c: string): string => c.repeat(32);
const Q: JudgeQuestion[] = [
  { id: id('a'), ts: '2026-11-07T19:02:00Z', kind: 'ask', surface: 'discord', question: 'Fight <my own>?', answer: 'No <b>never</b>.',
    rating: 'bad', flags: [
      { by: { name: 'Cal <3>', judge: 3 }, note: 'wrong & <why>', at: '2026-11-07T21:00:00Z', authoritative: true, mine: false },
      { by: { name: 'Nyar', judge: 1 }, note: 'mine', at: '2026-11-07T20:00:00Z', authoritative: false, mine: true },
    ] },
  { id: id('b'), ts: '2026-11-07T18:00:00Z', kind: 'followup', surface: 'web', question: 'and then?', answer: 'yes',
    history: [{ role: 'user', content: 'first <q>' }], flags: [] },
  { id: id('c'), ts: '2026-11-06T18:00:00Z', kind: 'ask', surface: 'web', question: 'tokens?', answer: 'no', rating: 'weird', flags: [],
    resolved: { by: { name: 'Boss', owner: true }, at: '2026-11-07T08:00:00Z' } },
];
const DOC = (you: JudgeReviewDoc['you'], extra: Partial<JudgeReviewDoc> = {}): JudgeReviewDoc => ({ ok: true, you, questions: Q, ...extra });
const JUDGE = { name: 'Nyar', judge: 1 as const, canResolve: false };
const OWNER = { name: 'Boss', owner: true as const, canResolve: true };
const ADMIN = { name: 'ops', canResolve: true };

function view(over: Partial<JudgeReviewView> = {}): JudgeReviewView {
  return { access: true, isLoading: false, review: DOC(JUDGE), filter: 'all', editing: null, actionMsg: '', chrome: { signedIn: true, alerts: 0 }, ...over };
}
const btns = (html: string): string[] => [...html.matchAll(/data-btn="([^"]+)"/g)].map(m => m[1]!);
const rowOf = (html: string, qid: string): string => {
  const at = html.indexOf(`<article class="jrrow`, html.indexOf(`data-id="${qid}"`) - 60);
  return html.slice(at, html.indexOf('</article>', at));
};

test('1176 §0 no DOM; the frame root carries the page class', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>)['document'], 'undefined');
  assert.match(judgeReviewHtml(view()), /^<div class="ui-app-shell[^"]*apppage jrpage">/);
});

test('1176 §1 refused: one sentence and the way out', () => {
  const html = judgeReviewHtml(view({ access: false, review: null }));
  assert.match(html, /This page is for judges and the owner/);
  assert.deepEqual(btns(html).filter(b => b.startsWith('jr-')), ['jr-close']);
  assert.doesNotMatch(html, /jrrow/);
});

test('1176 §2 the server\'s order, a flagged row marked, word of law, and the filters', () => {
  const html = judgeReviewHtml(view());
  const order = [...html.matchAll(/<article class="jrrow[^"]*" data-id="([0-9a-f]+)"/g)].map(m => m[1]);
  assert.deepEqual(order, [id('a'), id('b'), id('c')]);
  assert.match(rowOf(html, id('a')), /jrrow--flagged/);
  assert.doesNotMatch(rowOf(html, id('b')), /jrrow--flagged/);
  assert.match(rowOf(html, id('a')), /jrflag jrflag--law[\s\S]*word of law/);
  assert.match(rowOf(html, id('a')), /Discord · a player rated it bad/);
  assert.match(rowOf(html, id('b')), /a follow-up/);
  assert.match(rowOf(html, id('b')), /The conversation before it \(1\)/);
  assert.match(rowOf(html, id('c')), /Dealt with by <b>Boss<\/b>/);
  assert.match(html, /<small>1 flagged<\/small>/);
  assert.deepEqual(shownQuestions(Q, 'flagged').map(q => q.id), [id('a')]);
  assert.deepEqual(shownQuestions(Q, 'disliked').map(q => q.id), [id('a'), id('c')]);
  assert.match(judgeReviewHtml(view({ filter: 'flagged' })), /data-filter="flagged"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-filter="flagged"|ui-segmented__option--on[^>]*data-filter="flagged"|data-filter="flagged"[^>]*ui-segmented__option--on/);
  assert.match(judgeReviewHtml(view({ review: { ...DOC(JUDGE), questions: [Q[1]!] }, filter: 'flagged' })), /Nothing is flagged\./);
});

test('1176 §3 who gets which button', () => {
  const j = judgeReviewHtml(view());
  assert.ok(btns(rowOf(j, id('a'))).includes('jr-unflag'), 'take back my own flag');
  assert.match(rowOf(j, id('a')), /Edit my flag/);
  assert.match(rowOf(j, id('b')), /Flag this answer/);
  assert.ok(!btns(j).includes('jr-resolve'), 'a judge does not resolve');
  for (const b of ['jr-close', 'jr-refresh', 'jr-filter', 'jr-edit', 'jr-unflag']) assert.ok(btns(j).includes(b), b);

  // the server computes `mine` per caller: for the owner, neither flag is theirs
  const notMine = Q.map(q => ({ ...q, flags: q.flags.map(f => ({ ...f, mine: false })) }));
  const o = judgeReviewHtml(view({ review: { ...DOC(OWNER), questions: notMine } }));
  assert.ok(btns(rowOf(o, id('a'))).includes('jr-resolve'), 'the owner marks a flagged answer dealt with');
  assert.ok(!btns(rowOf(o, id('b'))).includes('jr-resolve'), 'not an unflagged one');
  assert.ok(!btns(o).includes('jr-unflag'), 'nobody\'s flag is the owner\'s here');

  const a = judgeReviewHtml(view({ review: DOC(ADMIN) }));
  assert.ok(!btns(a).includes('jr-edit'), 'an admin without a badge reads and resolves, but does not flag');
  assert.ok(btns(a).includes('jr-resolve'));

  const e = judgeReviewHtml(view({ editing: id('a') }));
  const row = rowOf(e, id('a'));
  assert.match(row, /<textarea[^>]*id="jr-note"[^>]*>mine<\/textarea>/, 'editing my flag starts from its note');
  assert.ok(btns(row).includes('jr-send') && btns(row).includes('jr-cancel'));
  assert.match(row, /Save my flag/);
  assert.match(rowOf(judgeReviewHtml(view({ editing: id('b') })), id('b')), /<textarea[^>]*id="jr-note"[^>]*><\/textarea>[\s\S]*Flag it/);
});

test('1176 §4 text off the server is escaped', () => {
  const html = judgeReviewHtml(view());
  for (const raw of ['Fight <my own>?', 'No <b>never</b>.', 'wrong & <why>', 'Cal <3>', 'first <q>']) assert.ok(!html.includes(raw), raw);
  assert.ok(html.includes('Fight &lt;my own&gt;?') && html.includes('wrong &amp; &lt;why&gt;'));
});

test('1176 §5 the bot down, loading and an action\'s error each say so', () => {
  assert.match(judgeReviewHtml(view({ review: DOC(JUDGE, { error: 'the rules bot\'s log could not be read (x)' }) })), /could not be read \(x\)/);
  assert.match(judgeReviewHtml(view({ isLoading: true, review: null })), /loading…/);
  assert.match(judgeReviewHtml(view({ actionMsg: 'that did not work: nope' })), /that did not work: nope/);
});

test('1176 §6 the way in: a judge\'s or the owner\'s profile, and main.ts routes it', () => {
  const profile = readFileSync(new URL('../pages/profile.ts', import.meta.url), 'utf8');
  const line = profile.split('\n').find(l => l.includes("dataBtn: 'nav-judging'"));
  assert.ok(line, 'the Staff row offers Judge review');
  assert.match(line!, /^\s*me\.badge\?\.owner \|\| me\.badge\?\.judge \? button\(/, 'to a badge only');
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  assert.match(main, /'nav-judging'\) \{ acct\.leaveScreen\(\); jr\.openJudgeReview\(\); return; \}/);
  assert.match(main, /if \(jr\.handleButton\(btn\)\) return;/);
  assert.match(main, /if \(jr\.screen\(\)\) \{ jr\.renderScreen\(\); return; \}/);
  assert.match(main, /jr\.initJudgeReview\(\{ app: \$app/);
});
