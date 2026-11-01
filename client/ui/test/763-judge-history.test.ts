/* CT-470: the in-game judge box sent `history: []` with every question, so a
 * follow-up ("so do they enter the bin?") reached the bot with no thread. The
 * box now sends its earlier exchanges. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { judgeHistory, JUDGE_HISTORY_TURNS, JUDGE_TURN_CHARS } from '../judgehistory.ts';

test('CT-470: the box turns its exchanges into user and assistant turns, oldest first', () => {
  assert.deepEqual(judgeHistory([{ q: 'can Hooba-Nan block?', a: 'Yes.' }, { q: 'and attack?', a: 'No.' }]), [
    { role: 'user', content: 'can Hooba-Nan block?' }, { role: 'assistant', content: 'Yes.' },
    { role: 'user', content: 'and attack?' }, { role: 'assistant', content: 'No.' },
  ]);
});

test('CT-470: a failed exchange (unreachable, busy, the daily limit) is not part of the conversation', () => {
  const out = judgeHistory([{ q: 'q1', a: 'a1' }, { q: 'q2', a: 'could not reach the judge: x', failed: true }]);
  assert.deepEqual(out.map(t => t.content), ['q1', 'a1']);
});

test('CT-470: at most the bot ceiling, the newest kept, each turn capped', () => {
  const log = Array.from({ length: 6 }, (_, i) => ({ q: `q${i}`, a: `a${i}` }));
  const out = judgeHistory(log);
  assert.equal(out.length, JUDGE_HISTORY_TURNS);
  assert.equal(out[0]!.content, 'q2');
  assert.equal(out.at(-1)!.content, 'a5');
  assert.equal(judgeHistory([{ q: 'q', a: 'x'.repeat(JUDGE_TURN_CHARS + 9) }])[1]!.content.length, JUDGE_TURN_CHARS);
});

test('CT-470: the judge box sends that history, and marks a refusal as failed', () => {
  const MAIN = readFileSync(fileURLToPath(new URL('../main.ts', import.meta.url)), 'utf8');
  assert.match(MAIN, /judgeRequest\(question, undefined, judgeHistory\(judgeLog\)\)/, 'askJudge does not pass the box history');
  assert.match(MAIN, /history\.length \? \{ question, history \}/, 'the judge fetch body does not carry the history');
  assert.match(MAIN, /r\.ok \? \{\} : \{ failed: true \}/, 'a refused answer would be resent as the judge word');
});
