/* The judges' review of the rules bot's answers (ui/pages/judgereview.ts, BL-17),
 * drawn from made-up views: no server, no account. */
import { type JudgeReviewView, judgeReviewHtml } from '../../../ui/pages/judgereview.ts';
import type { JudgeReviewDoc } from '../../../ui/judgetypes.ts';
import { CHROME } from './_page.ts';

const DOC: JudgeReviewDoc = {
  ok: true,
  you: { name: 'Nyar', judge: 2, canResolve: false },
  questions: [
    { id: 'a'.repeat(32), ts: '2026-11-07T19:02:00Z', kind: 'ask', surface: 'discord',
      question: 'Can I Fight my own unit to trigger its death ability?',
      answer: 'No — Fight must target a unit you do not control.\n\nThe card says "Target unit you control fights target unit you don\'t control."',
      rating: 'bad',
      flags: [
        { by: { name: 'Caleb', judge: 3 }, note: 'Correct answer is no, but for a different reason: see the Fight ruling thread.', at: '2026-11-07T21:00:00Z', authoritative: true, mine: false },
        { by: { name: 'Nyar', judge: 2 }, note: 'The quote is from an older printing.', at: '2026-11-07T20:00:00Z', authoritative: false, mine: true },
      ] },
    { id: 'b'.repeat(32), ts: '2026-11-07T18:40:00Z', kind: 'followup', surface: 'web',
      question: 'And if it has haste?', answer: 'Then it can attack the turn it spawns.',
      history: [{ role: 'user', content: 'When can a unit attack?' }, { role: 'assistant', content: 'From your next turn on.' }],
      flags: [] },
    { id: 'c'.repeat(32), ts: '2026-11-06T12:00:00Z', kind: 'ask', surface: 'web',
      question: 'Does a token count as a card?', answer: 'No.', flags: [],
      resolved: { by: { name: 'Warden', owner: true }, at: '2026-11-07T08:00:00Z' } },
  ],
};

const base: JudgeReviewView = { access: true, isLoading: false, review: DOC, filter: 'all', editing: null, actionMsg: '', chrome: CHROME };

export default {
  title: 'Pages/Judge review',
  render: (args: JudgeReviewView) => judgeReviewHtml(args),
  args: base,
};

export const All = {};
export const Flagged = { args: { filter: 'flagged' } };
export const Flagging = { name: 'Writing a flag', args: { editing: 'b'.repeat(32) } };
export const AsOwner = { name: 'As the owner', args: { review: { ...DOC, you: { name: 'Warden', owner: true, canResolve: true } } } };
export const BotDown = { name: 'The bot unreachable', args: { review: { ...DOC, questions: DOC.questions.slice(0, 1), error: "the rules bot's log could not be read (connection refused), so only the flagged answers are listed" } } };
export const Refused = { args: { access: false, review: null } };
