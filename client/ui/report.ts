/* THE REPORT FORM — on every page, not only on the board.
 *
 * Owner, 2026-09-05, after the first live game: "we need the Report button to
 * appear somewhere on every page. Even in the lobby and deck building areas.
 * It doesn't make sense to need to report something by entering a game if it
 * has to do with the card search or something."
 *
 * Until then the form was a slot in ui/main.ts's board render, reachable from
 * the side rail and nowhere else — and the deck builder, the card browser, the
 * account page and the queue each paint `#app` themselves, so a slot in the
 * board's template could never reach them. So the form lives HERE, in a layer
 * of its own appended beside `#app` (the way ui/legal.ts hangs its pages), with
 * its own clicks (`data-report`, never `data-btn`), its own Escape, its own
 * scrim and its own toast. Two consequences worth the move on their own:
 *
 *   · A board repaint cannot touch it. The old form was re-created on every
 *     server push, which is why main.ts had to rescue the caret and the draft
 *     around each paint; this layer is painted only when the FORM changes.
 *   · Every page gets the same form: a fixed "📝 Report" pill while no board
 *     is up, the rail button while one is. In a game the report carries the
 *     room, the seat and the action index (the replayable moment); elsewhere
 *     it carries the PAGE it was filed from, read off `#app`'s own root class
 *     (deckpage, cbpage, acctpage…) so no list of screens is kept here.
 *
 * The values (kind, severity) are the server's — server/report-fields.ts is
 * the one list; ui/ does not import server/, so the LABELS live here and
 * 287-report-form.test.ts checks this table against that list both ways.
 */
import { esc } from './util.ts';
import * as acct from './account.ts';

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
const severityApplies = (k: ReportKind | null): boolean => k === 'bug' || k === 'ux';
/** the textarea's prompt, per kind — the one line that makes a good ticket */
const REPORT_PROMPT: Record<ReportKind, string> = {
  bug: 'What happened, and what did you expect instead?',
  ux: 'What was confusing, awkward or hard to see?',
  feature: 'What would you like the client to do, and why?',
  other: 'What is it?',
};

/** where a report is filed from: a game (room + seat), or a page */
export interface ReportCtx { room?: string; seat?: number | null }

/**
 * The page a report is being filed from, read off the markup `#app` holds:
 * every screen module paints one root `<div class="…">` and the LAST class on
 * it is the screen's own name (`joinscreen home acctscreen` → account,
 * `deckpage` → deck). Derived rather than listed, so a new screen names
 * itself. Exported for the test; `null` when there is no root to read.
 */
export function pageOf(appHtml: string): string | null {
  const m = /^\s*<div class="([^"]*)"/.exec(appHtml);
  if (!m) return null;
  const classes = m[1]!.trim().split(/\s+/).filter(Boolean);
  const last = classes[classes.length - 1];
  return last ? last.replace(/(page|screen)$/, '') || last : null;
}

// ── state ──────────────────────────────────────────────────────────────
let open = false;
let busy = false;
/** the note being typed — module state so a repaint of the form (a kind
 * click) cannot lose it */
let draft = '';
let kind: ReportKind | null = null;
let severity: ReportSeverity | null = null;
let error = '';
let ctx: ReportCtx = {};
let toast: string | null = null;
let toastTimer = 0;
let layer: HTMLElement | null = null;

export const isReportOpen = (): boolean => open;

/** can this be sent? A kind, a severity where the kind takes one, a note. */
const complete = (): boolean => !!kind && (!severityApplies(kind) || !!severity) && !!draft.trim();

/** the app root, if this document has one */
const appEl = (): HTMLElement | null => document.getElementById('app');
/** in a game the board owns the window; the rail has the button then */
const onBoard = (): boolean => appEl()?.classList.contains('board') ?? false;

/** who the report will be credited to — the account, or nobody */
function filedAs(): string {
  const me = acct.currentUser();
  return me
    ? `Filed as <b>${esc(me.username)}</b>.`
    : 'Filed anonymously — sign in for it to carry your name.';
}

/** one row of radio-style buttons: real <button>s (Tab / Space / Enter work
 * for free), `role=radio` + `aria-checked` so a screen reader hears a choice */
function choicesHtml(what: 'kind' | 'severity', options: readonly [string, string, string][], picked: string | null): string {
  return `<div class="reportchoices" role="radiogroup">${options.map(([v, label, why]) =>
    `<button type="button" role="radio" aria-checked="${picked === v}" class="${picked === v ? 'on' : ''}"
      data-report="${what}" data-${what}="${v}" title="${esc(why)}" ${busy ? 'disabled' : ''}>${esc(label)}</button>`).join('')}</div>`;
}

function dialogHtml(): string {
  const where = ctx.room
    ? 'The server stores it with the room\'s exact action count, so a bug can be replayed at this precise moment.'
    : 'The server stores it with the page you are on.';
  return `<div class="reportscrim" id="reportscrim"><div class="overlaybox reportbox" role="dialog" aria-label="Report">
    <h3>📝 Report</h3>
    <div class="hint">A bug, a rough edge in the interface, or something you wish it did. ${where}
      ${filedAs()}</div>
    <div class="reportfield">
      <div class="reportlabel">What is it?</div>
      ${choicesHtml('kind', REPORT_KIND_LABELS, kind)}
    </div>
    ${severityApplies(kind) ? `<div class="reportfield">
      <div class="reportlabel">How bad is it?</div>
      ${choicesHtml('severity', REPORT_SEVERITY_LABELS, severity)}
    </div>` : ''}
    <textarea id="report-note" rows="4" placeholder="${esc(kind ? REPORT_PROMPT[kind] : 'Pick a type above, then say what happened')}" ${busy ? 'disabled' : ''}></textarea>
    <div class="judgerow">
      <button data-report="close">Cancel (esc)</button>
      <span class="reporthint">${kind ? 'Ctrl+Enter sends' : ''}</span>
      <button class="primary" data-report="send" ${busy || !complete() ? 'disabled' : ''}>${busy ? 'sending…' : 'Send report'}</button>
    </div>
    ${error ? `<div class="reporterror">${esc(error)}</div>` : ''}
  </div></div>`;
}

/** the fixed pill every non-board page carries */
const pillHtml = (): string =>
  '<button class="reportfab" data-report="open" title="report a bug, an interface problem or a feature request — from any page">📝 Report</button>';

/** repaint the layer from the state, and wire the one typing box */
function paint(): void {
  if (!layer) return;
  layer.innerHTML = (open ? dialogHtml() : onBoard() ? '' : pillHtml())
    + (toast ? `<div class="toast">${esc(toast)}</div>` : '');
  const box = document.getElementById('report-note') as HTMLTextAreaElement | null;
  if (!box) return;
  box.value = draft;
  if (!busy) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  box.addEventListener('input', () => {
    draft = box.value;
    const send = layer?.querySelector('[data-report="send"]') as HTMLButtonElement | null;
    if (send) send.disabled = busy || !complete();
  });
  // Ctrl+Enter sends, from inside the box. On the element rather than in a
  // document keydown handler: main.ts's drops every Ctrl chord before it
  // looks at the key (and must — Ctrl is the full-control modifier).
  box.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && complete()) { ev.preventDefault(); send(); }
  });
}

function showToast(msg: string): void {
  toast = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast = null; paint(); }, 4000);
}

/** open the form. From the rail, with the room and seat; from the pill, with
 * nothing — the page is read at send time. */
export function openReport(where: ReportCtx = {}): void {
  ctx = where;
  open = true;
  error = '';
  paint();
}

/** Cancel keeps the choices the way it keeps the draft — an accidental Escape
 * must not eat a paragraph. A SENT report starts the next one blank. */
export function closeReport(): void {
  open = false;
  paint();
}

function send(): void {
  if (busy || !complete()) return;
  const note = draft.trim();
  const k = kind;
  const sev = severityApplies(k) ? severity : null;
  const body: Record<string, unknown> = ctx.room
    ? { room: ctx.room, seat: ctx.seat ?? null, page: 'game', note, kind: k, severity: sev }
    : { room: '', seat: null, page: pageOf(appEl()?.innerHTML ?? '') ?? 'unknown', note, kind: k, severity: sev };
  busy = true;
  error = '';
  paint();
  // with the session (acct.authHeaders): the server stamps WHO filed it and
  // any trust mark on the account (BL-17's first slice)
  fetch('/api/report', { method: 'POST', headers: acct.authHeaders(), body: JSON.stringify(body) })
    .then(r => r.json()).then((r: { ok?: boolean }) => {
      if (r.ok) {
        open = false;
        draft = '';
        kind = null;
        severity = null;
        showToast(k === 'bug' && ctx.room ? 'logged — thanks, we can replay this exact moment' : 'logged — thanks');
      } else error = 'the report was not accepted';
    }).catch(() => { error = 'could not reach the server to file the report'; })
    .finally(() => { busy = false; paint(); });
}

/** a click on one of this layer's own controls */
function onButton(what: string, el: HTMLElement): void {
  switch (what) {
    case 'open': openReport(); return;
    case 'close': closeReport(); return;
    case 'send': send(); return;
    case 'kind': {
      const k = el.dataset['kind'];
      if (!REPORT_KIND_LABELS.some(([v]) => v === k)) return;
      kind = k as ReportKind;
      // switching to a kind that takes no severity drops the one chosen, so
      // the body never carries a severity for a feature request
      if (!severityApplies(kind)) severity = null;
      paint();
      return;
    }
    case 'severity': {
      const s = el.dataset['severity'];
      if (REPORT_SEVERITY_LABELS.some(([v]) => v === s)) severity = s as ReportSeverity;
      paint();
      return;
    }
    default: return;
  }
}

let installed = false;

/** Mount the layer beside #app and take over its own clicks and Escape. Safe
 * to call in a document with no body to hang it on (the headless harness
 * without a page): nothing here is load-bearing for the game. */
export function installReport(): void {
  if (installed) return;
  const app = appEl();
  if (!app || !document.body || typeof document.body.appendChild !== 'function') return;
  installed = true;
  layer = document.createElement('div');
  layer.id = 'reportlayer';
  document.body.appendChild(layer);

  // Our own listener, in capture, on our own elements only — main.ts's global
  // handler looks for `[data-btn]` and these are `[data-report]`, so the two
  // never see each other's clicks. stopPropagation keeps the scrim click from
  // reaching main.ts's "a click on a scrim closes the top overlay".
  document.addEventListener('click', e => {
    const target = e.target as HTMLElement | null;
    const t = target?.closest?.('[data-report]') as HTMLElement | null;
    if (!t) {
      if (open && target?.id === 'reportscrim') { e.stopPropagation(); closeReport(); }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    onButton(t.dataset['report']!, t);
  }, { capture: true });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && open) { e.stopPropagation(); closeReport(); }
  }, { capture: true });

  // the pill follows the board: `#app`'s class is the only signal, set by a
  // render this module never hears about — hence the observer (as legal.ts)
  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => { if (!open) paint(); }).observe(app, { attributes: true, attributeFilter: ['class'] });
  }
  paint();
}
