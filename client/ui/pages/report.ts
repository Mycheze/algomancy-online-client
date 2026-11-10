/* The report pill and the report / dispute dialog — DRAWN. The layer itself
 * (its state, its sending, its keys) is ui/report.ts; this file is only the
 * markup, as pure functions of a view, plus the label tables both halves
 * read.
 *
 * Split out in the design-system round (2026-11-03) under the page contract
 * (pages/README.md), with one difference from a page: the state stays in
 * ui/report.ts, which main.ts imports early, so report.ts gathers the view
 * (its `view()`), these functions draw it, and report.ts puts the result on
 * its layer. The markup is byte for byte what report.ts drew before the split
 * (test 287 reads it: `data-report="send" disabled`, `data-report="kind"
 * data-kind=…`), so its buttons stay hand-written: `.reportchoices button`
 * sizes the choices, and the button component's attribute order would move
 * `disabled` away from `data-report`. The one component it uses is the error
 * line (ui-status, error tone), which `.reporterror` was already a copy of.
 * Its CSS is styles/shared/13-report-and-inbox.css. */
import { esc } from '../util.ts';
import { statusMessage } from '../components/index.ts';

export type ReportKind = 'bug' | 'ux' | 'feature' | 'other';
export type ReportSeverity = 'minor' | 'medium' | 'gamebreaking';
export const REPORT_KIND_LABELS: readonly [ReportKind, string, string][] = [
  ['bug', 'Bug', 'the game did something wrong — a card, a rule, a crash'],
  ['ux', 'UX / UI issue', 'the game did the right thing but the interface made it hard, unclear or ugly'],
  ['feature', 'Feature request', 'something you wish the client did'],
  ['other', 'Other', 'anything else'],
];
export const REPORT_SEVERITY_LABELS: readonly [ReportSeverity, string, string][] = [
  ['minor', 'Minor', 'cosmetic, or easy to work around'],
  ['medium', 'Medium', 'got in the way, but the game went on'],
  ['gamebreaking', 'Game breaking', 'the game could not continue, or the outcome was wrong'],
];
/** a severity is asked for a bug and a UX issue; a feature request and
 * "other" have none (the server stores null for those) */
export const severityApplies = (k: ReportKind | null): boolean => k === 'bug' || k === 'ux';
/** the textarea's prompt, per kind — the one line that makes a good ticket */
const REPORT_PROMPT: Record<ReportKind, string> = {
  bug: 'What happened, and what did you expect instead?',
  ux: 'What was confusing, awkward or hard to see?',
  feature: 'What would you like the client to do, and why?',
  other: 'What is it?',
};

// ── the view ─────────────────────────────────────────────────────────

export interface ReportDialogView {
  /** BL-48: the form is a dispute of the game that just ended */
  dispute: boolean;
  /** a send is in flight */
  busy: boolean;
  /** what has been picked; a dispute has neither */
  kind: ReportKind | null;
  severity: ReportSeverity | null;
  /** can it be sent */
  complete: boolean;
  /** filed from a game or a solo room (the moment is replayable), not a page */
  inGame: boolean;
  /** the account it is credited to, or null */
  user: string | null;
  error: string;
}

export interface ReportLayerView {
  /** the dialog, when it is open */
  dialog: ReportDialogView | null;
  /** a board is up: the rail has the button, so no pill */
  onBoard: boolean;
  /** the confirmation toast, if one is showing */
  toast: string | null;
}

// ── drawing ──────────────────────────────────────────────────────────

/** who the report will be credited to — the account, or nobody */
function filedAs(user: string | null): string {
  return user
    ? `Filed as <b>${esc(user)}</b>.`
    : 'Filed anonymously — sign in for it to carry your name.';
}

/** one row of radio-style buttons: real <button>s (Tab / Space / Enter work
 * for free), `role=radio` + `aria-checked` so a screen reader hears a choice */
function choicesHtml(what: 'kind' | 'severity', options: readonly [string, string, string][], picked: string | null, busy: boolean): string {
  return `<div class="reportchoices" role="radiogroup">${options.map(([v, label, why]) =>
    `<button type="button" role="radio" aria-checked="${picked === v}" class="${picked === v ? 'on' : ''}"
      data-report="${what}" data-${what}="${v}" title="${esc(why)}" ${busy ? 'disabled' : ''}>${esc(label)}</button>`).join('')}</div>`;
}

const errorHtml = (error: string): string =>
  error ? statusMessage({ tone: 'error', text: error, className: 'reporterror' }) : '';

/** BL-48: the dispute form — one box, required */
function disputeDialogHtml(v: ReportDialogView): string {
  return `<div class="reportscrim" id="reportscrim"><div class="overlaybox reportbox" role="dialog" aria-label="Dispute game">
    <h3>Dispute game</h3>
    <div class="hint">Filed with the final board. The result stands until someone reviews it. ${filedAs(v.user)}</div>
    <textarea id="report-note" rows="4" aria-label="What went wrong?" placeholder="What went wrong?" ${v.busy ? 'disabled' : ''}></textarea>
    <div class="judgerow">
      <button data-report="close">Cancel <span class="kh">(esc)</span></button>
      <span class="reporthint">Ctrl+Enter sends</span>
      <button class="primary" data-report="send" ${v.busy || !v.complete ? 'disabled' : ''}>${v.busy ? 'sending…' : 'Send dispute'}</button>
    </div>
    ${errorHtml(v.error)}
  </div></div>`;
}

/** the report form (or, for a dispute, the dispute form) */
export function reportDialogHtml(v: ReportDialogView): string {
  if (v.dispute) return disputeDialogHtml(v);
  const where = v.inGame
    ? 'Filed with this exact moment of the game, so a bug can be replayed.'
    : 'Filed with the page you are on.';
  return `<div class="reportscrim" id="reportscrim"><div class="overlaybox reportbox" role="dialog" aria-label="Report">
    <h3>📝 Report</h3>
    <div class="hint">${where} ${filedAs(v.user)}</div>
    <div class="reportfield">
      <div class="reportlabel">What is it?</div>
      ${choicesHtml('kind', REPORT_KIND_LABELS, v.kind, v.busy)}
    </div>
    ${severityApplies(v.kind) ? `<div class="reportfield">
      <div class="reportlabel">How bad is it?</div>
      ${choicesHtml('severity', REPORT_SEVERITY_LABELS, v.severity, v.busy)}
    </div>` : ''}
    <textarea id="report-note" rows="4" aria-label="What happened" placeholder="${esc(v.kind ? REPORT_PROMPT[v.kind] : 'Pick a type above, then say what happened')}" ${v.busy ? 'disabled' : ''}></textarea>
    <div class="judgerow">
      <button data-report="close">Cancel <span class="kh">(esc)</span></button>
      <span class="reporthint">${v.kind ? 'Ctrl+Enter sends' : ''}</span>
      <button class="primary" data-report="send" ${v.busy || !v.complete ? 'disabled' : ''}>${v.busy ? 'sending…' : 'Send report'}</button>
    </div>
    ${errorHtml(v.error)}
  </div></div>`;
}

/** the fixed pill every non-board page carries */
export const reportPillHtml = (): string =>
  '<button class="reportfab" data-report="open">📝 Report</button>';

/** the whole layer: the dialog, else the pill (off the board), and the toast */
export function reportLayerHtml(v: ReportLayerView): string {
  return (v.dialog ? reportDialogHtml(v.dialog) : v.onBoard ? '' : reportPillHtml())
    + (v.toast ? `<div class="toast">${esc(v.toast)}</div>` : '');
}
