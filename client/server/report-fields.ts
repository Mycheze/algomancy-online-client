/* T6 — THE REPORT FORM'S TWO CHOICES, named once.
 *
 * The in-game report used to be a bare textarea, and every row in
 * var/issues.jsonl was a free-text note somebody had to read to find out
 * whether it was a crash, a confusing button or a wish. The owner's ask
 * (polish round 2026-09-05): "They select whether it's a bug, UX/UI issue or
 * feature request (or other, I guess) and then rank the severity of the
 * bug/issue (Minor, Medium, Game Breaking) and then the normal text box.
 * This will help us to process tickets much more easily."
 *
 * This module is the ONE list of what those choices may be. The server
 * validates against it (an unknown value is coerced, never a 500 — a stale
 * client tab or a hand-rolled curl must still get its note logged), the
 * ledger's row type is built from it, and the UI test checks the form's
 * buttons against it, so the client cannot offer a choice the server would
 * throw away. The client keeps its own LABELS ("UX / UI issue"): those are
 * presentation, and ui/ does not import server/.
 *
 * Both fields are ADDITIVE and OPTIONAL on the row. Every reader of
 * issues.jsonl (fetch-reports.mjs, 70-playtest-ledger.test.ts) parses rows
 * written before this existed, and always will.
 */

export const REPORT_KINDS = ['bug', 'ux', 'feature', 'other'] as const;
export type ReportKind = typeof REPORT_KINDS[number];

export const REPORT_SEVERITIES = ['minor', 'medium', 'gamebreaking'] as const;
export type ReportSeverity = typeof REPORT_SEVERITIES[number];

/** the kinds a severity is asked for: a feature request has no severity, and
 * "other" is by definition not something we know how to rank */
export const SEVERITY_KINDS: readonly ReportKind[] = ['bug', 'ux'];

/** what the client sent, as a kind. Anything not on the list — a missing
 * field from an older client, a typo, a 5 KB string — is 'other'. */
export function reportKind(v: unknown): ReportKind {
  // `typeof` first: String(['bug']) is 'bug', and the row must carry the
  // string, never the thing that stringified to it
  return typeof v === 'string' && (REPORT_KINDS as readonly string[]).includes(v) ? v as ReportKind : 'other';
}

/** what the client sent, as a severity. Not on the list (or absent) → null. */
export function reportSeverity(v: unknown): ReportSeverity | null {
  return typeof v === 'string' && (REPORT_SEVERITIES as readonly string[]).includes(v) ? v as ReportSeverity : null;
}

/**
 * Who filed a report, as the row remembers it — BL-17's first slice.
 *
 * The owner, 2026-09-05, working the first live game's reports: "check what
 * kind of account left the report. mycheze should be set to 'me' (owner) and
 * 'judge level 1'." Until then a row said which SEAT filed it and nothing
 * about the person, so the owner's own report and a stranger's read the
 * same. The account and its trust mark (accounts.ts `AccountBadge`) are
 * copied onto the row AT FILING TIME — a snapshot, on purpose: a report is
 * weighed by who its author was when they wrote it, and the journal must
 * not change meaning when a badge is later granted or revoked. `null` is a
 * signed-out reporter; absent is a row from before this existed.
 */
export interface ReportedBy {
  id: string;
  name: string;
  /** the site's owner — "me" */
  owner?: true;
  /** BL-17 judge level: 3 = word of law, 2 = trusted, 1 = above genpop */
  judge?: 1 | 2 | 3;
}

/** The structural half of an account this file is allowed to see. It does
 * not import accounts.ts: the ledgers import THIS file for the row type, and
 * ledgers must not pull the account store in behind it. */
export interface ReporterLike {
  id: string;
  username: string;
  badge?: { owner?: true; judge?: 1 | 2 | 3 } | null;
}

/** the `by` stamp for a report — the account and whatever mark it carries */
export function reportedBy(a: ReporterLike | null | undefined): ReportedBy | null {
  if (!a) return null;
  const by: ReportedBy = { id: a.id, name: a.username };
  if (a.badge?.owner) by.owner = true;
  if (a.badge?.judge) by.judge = a.badge.judge;
  return by;
}

/** "mycheze (owner, judge L1)" — for the intake's delta print and the log */
export function reporterLabel(by: ReportedBy | null | undefined): string {
  if (by === undefined) return 'unrecorded';
  if (by === null) return 'signed out';
  const marks = [by.owner ? 'owner' : '', by.judge ? `judge L${by.judge}` : ''].filter(Boolean);
  return marks.length ? `${by.name} (${marks.join(', ')})` : by.name;
}

/** IssueRow.solo — what a row filed from a solo room says about the run it was
 * filed on (the run itself is in report-runs.jsonl; server/report-run.ts) */
export type SoloPointer =
  | { kind: 'challenge'; at: number; challengeId: string }
  | { kind: 'learn'; at: number }
  | { refused: string };

/** One row of var/issues.jsonl, exactly as /api/report writes it. */
export interface IssueRow {
  ts: string;
  room: string;
  seat: number | null;
  note: string;
  /** the room's action count at report time — the replay index (null: unknown room) */
  actionIndex: number | null;
  /** T6: absent on rows written before 2026-09-05 */
  kind?: ReportKind;
  /** T6: absent on rows written before 2026-09-05; null when the kind takes none */
  severity?: ReportSeverity | null;
  /** who filed it (BL-17 first slice, 2026-09-05): null = signed out; absent
   * on rows written before the stamp existed */
  by?: ReportedBy | null;
  /** where it was filed from (2026-09-05, the form on every page): 'game'
   * with a room, else the screen's own name off #app's root class — deck,
   * cb (card browser), acct, home, lobby, queue, meta. Absent on older rows. */
  page?: string;
  /**
   * BL-46 — this row was filed BY AN AGREED FIX, not by the report form. The
   * owner, 2026-10-16: every accepted fix files a bug report automatically,
   * carrying the proposer's required "what went wrong" (the row's `note`).
   * `what` is the fix itself; `kind` whether it edited the board or rewound
   * it; `agreedBy` the seat that said yes. The row's `seat` and `by` are the
   * PROPOSER's, and `actionIndex` is the log length the fix was proposed at
   * — the broken moment, which is what a replay wants to stop on. Absent on
   * every row the form filed.
   *
   * Since 2026-10-21 ONE row per RUN of fixes (no game action between them —
   * server/rooms.ts FixRun), filed when the run ends: the top-level fields are
   * the run's FIRST fix, `run` how many it holds (absent: one), and the note
   * one line per fix. `amendment` is the index of the first in the game
   * file's `amendments` — what `replay-room.ts --report` rebuilds the board
   * from (absent on older rows, which it matches by time instead).
   */
  fix?: { kind: 'edit' | 'rewind'; what: string; agreedBy: number; amendment?: number; run?: number };
  /**
   * BL-48 — this row was filed by the post-game DISPUTE button, not by the
   * report form. The note is the player's required "what went wrong";
   * `actionIndex` is the final board. `winner` is the result as it stood (it
   * is not changed by a dispute); `league` the league match it was flagged on,
   * when there is one. Absent on every other row.
   */
  dispute?: { winner: number | null; league?: string };
  /**
   * Report round 2026-10-23 — this row was filed from a SOLO room (a Weekly
   * Challenge run, Learn to Play), which has no server room to replay, and the
   * form sent the game along. The game itself is NOT here: it is the line of
   * report-runs.jsonl with this row's `ts` (server/report-run.ts says why it
   * may never be inlined). This is the pointer: which kind of room, the action
   * index the reporter was at, the challenge id — or `refused` with why the
   * attachment was not kept. Absent on every other row.
   */
  solo?: SoloPointer;
}
