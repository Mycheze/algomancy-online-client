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
}
