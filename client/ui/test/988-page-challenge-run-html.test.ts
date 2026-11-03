/* 988 — A WEEKLY CHALLENGE RUN'S METER AND END PANELS, DRAWN WITHOUT A PAGE
 * (design-system round, 2026-11-03). Their markup left ui/challengerun.ts for
 * pages/challengerun.ts; this drives runMeterHtml and runEndHtml with
 * made-up views and no DOM.
 *
 * §1 the meter: its words (escaped), Rewind, Retry, Give up — armed or not
 * §2 the goal met: the score (debt turns when there are any), each upload state
 * §3 the run failed: why (escaped), and its three buttons; no run, nothing
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunScore } from '../../engine/src/challenge.ts';
import { runEndHtml, runMeterHtml, scoreHtml } from '../pages/challengerun.ts';

const sc = (turns: number, debtTurns = 0): RunScore =>
  ({ unique: 3, extra: 1, cards: 4, elements: 2, turns, raw: 0, skill: 0, ...(debtTurns ? { debtTurns, debt: 6 } : {}) });
const chal = (html: string): string[] => [...html.matchAll(/data-chal="([^"]+)"/g)].map(m => m[1]!);

test('988 §1 the meter, armed and not', () => {
  const calm = runMeterHtml({ text: 'Turn <3>', armed: false });
  assert.match(calm, /^<div class="chmeter" role="status">/);
  assert.match(calm, /Turn &lt;3&gt;/);
  assert.deepEqual(chal(calm), ['rewind', 'retry', 'giveup']);
  assert.match(calm, /<button data-chal="giveup">Give up<\/button>/);
  assert.match(runMeterHtml({ text: '', armed: true }), /<button class="danger" data-chal="giveup">Press again to give up<\/button>/);
});

test('988 §2 the goal met: the score, and each upload state', () => {
  assert.match(scoreHtml(sc(5)), /Extra copies/);
  assert.doesNotMatch(scoreHtml(sc(5)), /chdebt/);
  assert.match(scoreHtml(sc(5, 2)), /Met on turn 3, plus 2 turns to pay off 6 debt\./);
  const guest = runEndHtml({ kind: 'done', score: sc(4), submit: { s: 'guest' } });
  assert.match(guest, /aria-label="Goal met"/);
  assert.deepEqual(chal(guest), ['signin', 'export', 'retry', 'page']);
  assert.match(runEndHtml({ kind: 'done', score: sc(4), submit: { s: 'sending' } }), /Submitting…/);
  const err = runEndHtml({ kind: 'done', score: sc(4), submit: { s: 'error', error: 'no <x>' } });
  assert.match(err, /<p class="chproblem">no &lt;x&gt;<\/p><button data-chal="resend">/);
  const done = runEndHtml({ kind: 'done', score: sc(4), submit: { s: 'done', reply: { ok: true, newBest: ['fastest'], ranks: { fastest: 1, leanest: 3 } } } });
  assert.match(done, /New best: fastest\. #1 fastest · #3 leanest\./);
});

test('988 §3 the run failed; no run', () => {
  const failed = runEndHtml({ kind: 'failed', why: 'the <dummy> won' });
  assert.match(failed, /aria-label="Run failed"/);
  assert.match(failed, /the &lt;dummy&gt; won/);
  assert.deepEqual(chal(failed), ['rewind', 'retry', 'page']);
  assert.equal(runEndHtml(null), '');
});
