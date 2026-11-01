/* CT-470: the judge box's conversation, sent back as `history` so a follow-up
 * ("so do they enter the bin?") is answered with the thread in view. It was
 * always `history: []` — every question arrived alone.
 *
 * DOM-free on purpose, so a test imports it. The bot (bot/app.py AskRequest)
 * takes at most 8 turns of at most 8000 characters; core.answer_question strips
 * citation markup from assistant turns itself. */

export interface JudgeExchange { q: string; a: string; failed?: boolean }

/** The bot's own ceilings (bot/app.py Turn / AskRequest, core.MAX_HISTORY). */
export const JUDGE_HISTORY_TURNS = 8;
export const JUDGE_TURN_CHARS = 8000;

export interface JudgeTurn { role: 'user' | 'assistant'; content: string }

/** The last exchanges that got a real answer, oldest first, as user/assistant
 * turns — at most JUDGE_HISTORY_TURNS of them, each capped. A failed exchange
 * (unreachable, busy, the daily limit) is left out: it is not part of the
 * conversation, and its "answer" would read to the model as the judge's word. */
export function judgeHistory(log: readonly JudgeExchange[]): JudgeTurn[] {
  const turns: JudgeTurn[] = [];
  for (const e of log) {
    if (e.failed || !e.q.trim() || !e.a.trim()) continue;
    turns.push({ role: 'user', content: e.q.slice(0, JUDGE_TURN_CHARS) },
      { role: 'assistant', content: e.a.slice(0, JUDGE_TURN_CHARS) });
  }
  return turns.slice(-JUDGE_HISTORY_TURNS);
}
