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
}
