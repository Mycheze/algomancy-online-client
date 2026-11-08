/* BL-17 — the judges' review queue's wire types: what GET /api/judge-review
 * sends (client/server/api-judge-review.ts) and the review page draws
 * (ui/pages/judgereview.ts). Types only; no account id ever appears in them. */

/** who flagged, as the page shows them: a name and the badge it carried */
export interface JudgeMark { name: string; owner?: true; judge?: 1 | 2 | 3 }

export interface JudgeFlag {
  by: JudgeMark;
  /** what is wrong with the answer, and the right one if the judge knows it */
  note: string;
  at: string;
  /** an L3 judge's or the owner's word: theirs settles the question (BL-17 decided) */
  authoritative: boolean;
  /** the caller's own flag — theirs to take back */
  mine: boolean;
}

/** one answer the rules bot gave, and what the judges said about it */
export interface JudgeQuestion {
  /** the bot's response id */
  id: string;
  ts: string | null;
  kind: string | null;
  /** web = the site and the in-game judge box; discord = the Discord bot */
  surface: string;
  question: string;
  answer: string;
  /** a follow-up's earlier turns, oldest first */
  history?: { role: string; content: string }[];
  /** the last 👍/👎 a player gave it (good | weird | bad) */
  rating?: string;
  /** the flags standing on it now, highest badge first */
  flags: JudgeFlag[];
  /** the owner (or an admin) marked it dealt with; a new flag reopens it */
  resolved?: { by: JudgeMark; at: string };
}

export interface JudgeReviewDoc {
  ok: true;
  you: JudgeMark & { canResolve: boolean };
  /** flagged first (highest flagger's badge, then the newest flag), then newest first */
  questions: JudgeQuestion[];
  /** set when the rules bot's log could not be read: only the flagged ones are listed */
  error?: string;
}
