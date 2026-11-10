/* BL-17 — THE JUDGES' REVIEW: every answer the rules bot gave (Discord, its
 * web page, the in-game judge box), newest first, and a flag a judge puts on a
 * wrong one. Flagged answers go to the top, the highest badge's first, and stay
 * until the owner marks them dealt with; then the questions a judge or the owner
 * asked in a game, marked with their badge (the server orders them). The server half, and who may do what,
 * is client/server/api-judge-review.ts; the wire types are ui/judgetypes.ts.
 *
 * The owner's decisions it keeps (backlog.ts BL-17 `decided`): judges review
 * AFTER the fact — nothing written here reaches a live game — and a flag is a
 * lead for the next rules update, never an edit to the rules. The page says so.
 *
 * Same shape as pages/admin.ts: the state lives in this file, `screen()` says
 * whether it owns #app, `judgeReviewView()` gathers, `judgeReviewHtml(view)`
 * draws (pure), `paintJudgeReview(app)` paints, `handleButton()` takes every
 * `jr-` click. THE URL IS THE PAGE: `?judging=1`, and the way in is the Staff
 * row of a judge's or the owner's profile. What decides whether anything shows
 * is the server: its routes 404 to an unbadged account, and the page then says
 * only that.
 */
import * as acct from '../account.ts';
import { esc } from '../util.ts';
import { button, chip, emptyState, field, segmented, statusMessage } from '../components/index.ts';
import type { JudgeFlag, JudgeMark, JudgeQuestion, JudgeReviewDoc } from '../judgetypes.ts';
import { frameChromeView, frameHtml, restoreScrolls, scrollsIn, type FrameChrome } from './frame.ts';

export type JudgeFilter = 'all' | 'flagged' | 'disliked';
export const JUDGE_FILTERS: readonly [JudgeFilter, string][] = [['all', 'All'], ['flagged', 'Flagged'], ['disliked', 'Players disliked']];

let open = false;
let allowed: boolean | null = null;
let fetching = false;
let doc: JudgeReviewDoc | null = null;
let filterNow: JudgeFilter = 'all';
/** the answer whose flag form is open */
let editingId: string | null = null;
let msg = '';
let $app: HTMLElement | null = null;
let rerenderHost: (() => void) | null = null;

export const screen = (): 'judging' | null => (open ? 'judging' : null);

/* ── talking to the server ────────────────────────────────────────────── */

async function load(): Promise<void> {
  fetching = true; paint();
  try {
    const res = await fetch('/api/judge-review', { headers: acct.authHeaders(false) });
    // 404 IS THE REFUSAL (the admin page's rule): anything else is a fault
    if (res.status === 404) { allowed = false; doc = null; }
    else if (!res.ok) msg = `the server answered ${res.status} — try Refresh`;
    else { allowed = true; doc = await res.json() as JudgeReviewDoc; }
  } catch { msg = 'could not reach the server'; }
  fetching = false; paint();
}

async function send(body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch('/api/judge-review/flag', { method: 'POST', headers: acct.authHeaders(), body: JSON.stringify(body) });
    const r = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (res.ok && r.ok) { msg = ''; return true; }
    msg = r.error ? `that did not work: ${r.error}` : `that did not work: the server answered ${res.status}`;
  } catch { msg = 'could not reach the server'; }
  return false;
}

/* ── opening and closing ──────────────────────────────────────────────── */

function syncUrl(): void {
  try {
    const url = new URL(location.href);
    if (open) url.searchParams.set('judging', '1');
    else url.searchParams.delete('judging');
    history.replaceState(null, '', url.toString());
  } catch { /* ignore */ }
}

export function openJudgeReview(): void {
  open = true; msg = ''; editingId = null;
  syncUrl();
  void load();
}

function close(): void {
  open = false;
  syncUrl();
  rerenderHost?.();
}

/** main.ts calls this once at boot; `?judging=1` opens the page */
export function initJudgeReview(opts: { app: HTMLElement; rerender: () => void }): void {
  $app = opts.app;
  rerenderHost = opts.rerender;
  try {
    if (new URLSearchParams(location.search).get('judging') === '1') openJudgeReview();
  } catch { /* a URL we cannot parse is a page we do not open */ }
}

/* ── the view and the drawing ─────────────────────────────────────────── */

export interface JudgeReviewView {
  access: boolean | null;
  isLoading: boolean;
  review: JudgeReviewDoc | null;
  filter: JudgeFilter;
  editing: string | null;
  actionMsg: string;
  chrome: FrameChrome;
}

/* The view's names differ from the module's `let`s on purpose (test 962). */
export function judgeReviewView(): JudgeReviewView {
  return { access: allowed, isLoading: fetching, review: doc, filter: filterNow, editing: editingId, actionMsg: msg, chrome: frameChromeView() };
}

export function shownQuestions(qs: readonly JudgeQuestion[], f: JudgeFilter): JudgeQuestion[] {
  return qs.filter(q => f === 'all' || (f === 'flagged' ? q.flags.length > 0 : q.rating === 'bad' || q.rating === 'weird'));
}

const when = (iso: string | null | undefined): string => (iso ? esc(iso.slice(0, 16).replace('T', ' ')) : '—');

function markHtml(m: JudgeMark): string {
  const chips = [m.owner ? chip({ label: 'Owner', shape: 'pill', tone: 'accent' }) : '',
    m.judge ? chip({ label: `Judge L${m.judge}`, shape: 'pill', tone: 'info' }) : ''].filter(Boolean).join(' ');
  return `<b>${esc(m.name)}</b> ${chips}`;
}

const SURFACE: Record<string, string> = { discord: 'Discord', web: 'the site or a game' };
const RATING: Record<string, string> = { good: 'a player rated it good', weird: 'a player found it odd', bad: 'a player rated it bad' };

function flagHtml(f: JudgeFlag, qid: string): string {
  return `<li class="jrflag${f.authoritative ? ' jrflag--law' : ''}">
    <div class="jrflagby">${markHtml(f.by)}${f.authoritative ? ` ${chip({ label: 'word of law', tone: 'warning' })}` : ''}
      <span class="jrwhen">${when(f.at)}</span>
      ${f.mine ? button({ label: 'Take back my flag', size: 'sm', variant: 'ghost', dataBtn: 'jr-unflag', attrs: { 'data-id': qid } }) : ''}</div>
    <p class="jrnote">${esc(f.note)}</p>
  </li>`;
}

function questionHtml(q: JudgeQuestion, v: JudgeReviewView, you: JudgeReviewDoc['you']): string {
  const meta = [when(q.ts), esc(SURFACE[q.surface] ?? q.surface), q.kind === 'followup' ? 'a follow-up' : '',
    q.rating ? esc(RATING[q.rating] ?? q.rating) : '',
    q.asker ? chip({ label: q.asker.owner ? 'asked by the owner' : `asked by a Judge L${q.asker.judge}`, shape: 'pill', tone: q.asker.owner ? 'accent' : 'info' }) : '',
  ].filter(Boolean).join(' · ');
  const thread = q.history?.length
    ? `<details class="jrthread"><summary>The conversation before it (${q.history.length})</summary>${
      q.history.map(t => `<p class="jrturn"><b>${t.role === 'assistant' ? 'Bot' : 'Player'}:</b> ${esc(t.content)}</p>`).join('')}</details>`
    : '';
  const flags = q.flags.length ? `<ul class="jrflags">${q.flags.map(f => flagHtml(f, q.id)).join('')}</ul>` : '';
  const resolved = q.resolved ? `<p class="jrresolved">Dealt with by ${markHtml(q.resolved.by)} <span class="jrwhen">${when(q.resolved.at)}</span></p>` : '';
  const mineAlready = q.flags.some(f => f.mine);
  const canFlag = !!(you.owner || you.judge);
  const form = v.editing === q.id
    ? `<div class="jrform">${field({ id: 'jr-note', label: 'What is wrong with this answer — and the right answer, if you know it',
      control: 'textarea', rows: 3, value: mineAlready ? q.flags.find(f => f.mine)!.note : '' })}
      <div class="jracts">${button({ label: mineAlready ? 'Save my flag' : 'Flag it', size: 'sm', variant: 'primary', dataBtn: 'jr-send', attrs: { 'data-id': q.id } })}
      ${button({ label: 'Cancel', size: 'sm', variant: 'ghost', dataBtn: 'jr-cancel' })}</div></div>`
    : '';
  const acts = [
    canFlag && v.editing !== q.id ? button({ label: mineAlready ? 'Edit my flag' : 'Flag this answer', size: 'sm', dataBtn: 'jr-edit', attrs: { 'data-id': q.id } }) : '',
    you.canResolve && q.flags.length ? button({ label: 'Mark dealt with', size: 'sm', dataBtn: 'jr-resolve', attrs: { 'data-id': q.id } }) : '',
  ].filter(Boolean).join('');
  return `<article class="jrrow${q.flags.length ? ' jrrow--flagged' : ''}" data-id="${esc(q.id)}">
    <p class="jrmeta">${meta}</p>
    ${thread}
    <p class="jrq">${esc(q.question)}</p>
    <div class="jra">${esc(q.answer)}</div>
    ${flags}${resolved}${form}
    ${acts ? `<div class="jracts">${acts}</div>` : ''}
  </article>`;
}

/** The page, in the app frame: the filter in the toolbar's centre, a note on
 * what a flag does, and the answers in one list that scrolls by itself. */
export function judgeReviewHtml(v: JudgeReviewView): string {
  const back = { dataBtn: 'jr-close', label: 'Home' };
  if (v.access === false) {
    return frameHtml({ page: 'jrpage', title: 'Judge review', back, chrome: v.chrome,
      mainHtml: '<p class="framenote">This page is for judges and the owner. Sign in with an account that has a judge badge to see it.</p>' });
  }
  const d = v.review;
  const shown = d ? shownQuestions(d.questions, v.filter) : [];
  const flagged = d ? d.questions.filter(q => q.flags.length).length : 0;
  const list = v.isLoading && !d ? '<p class="framenote">loading…</p>'
    : !d ? ''
      : shown.length ? `<div class="framelist jrlist" data-scroll="jr-${esc(v.filter)}">${shown.map(q => questionHtml(q, v, d.you)).join('')}</div>`
        : emptyState({ text: v.filter === 'flagged' ? 'Nothing is flagged.' : v.filter === 'disliked' ? 'No player has marked an answer down.' : 'The rules bot has not answered anything yet.' });
  return frameHtml({
    page: 'jrpage', title: 'Judge review',
    titleHtml: `Judge review${d ? `<small>${flagged} flagged</small>` : ''}`,
    back, chrome: v.chrome, fill: true,
    centerHtml: segmented({
      ariaLabel: 'Show', className: 'jrfilter',
      options: JUDGE_FILTERS.map(([id, label]) => ({ label, value: id, on: v.filter === id, dataBtn: 'jr-filter', attrs: { 'data-filter': id } })),
    }),
    toolsHtml: button({ label: 'Refresh', size: 'sm', dataBtn: 'jr-refresh' }),
    mainHtml: `<p class="framenote">The rules bot's answers, on Discord, on its site and in games, newest first. Flag one that is wrong and say why:
    flagged answers go to the top of the owner's list for the next rules update, and the questions judges asked in a game come next. Nothing you write here reaches a game or changes the rules.</p>
    ${v.actionMsg ? statusMessage({ tone: 'error', text: v.actionMsg }) : ''}
    ${d?.error ? statusMessage({ tone: 'warn', text: d.error }) : ''}
    ${list}`,
  });
}

export function paintJudgeReview(app: HTMLElement): void {
  const kept = scrollsIn(app as unknown as Parameters<typeof scrollsIn>[0]);
  app.className = 'judging';
  app.innerHTML = judgeReviewHtml(judgeReviewView());
  restoreScrolls(app as unknown as Parameters<typeof restoreScrolls>[0], kept);
  if (editingId) (app.querySelector('#jr-note') as HTMLTextAreaElement | null)?.focus();
}

function paint(): void {
  const app = $app ?? document.getElementById('app');
  if (!app || !open) return;
  paintJudgeReview(app);
}

export function renderScreen(): void { paint(); }

/* ── clicks ───────────────────────────────────────────────────────────── */

export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('jr-')) return false;
  const id = btn.dataset['id'] ?? '';
  if (b === 'jr-close') { close(); return true; }
  if (b === 'jr-refresh') { void load(); return true; }
  if (b === 'jr-filter') { filterNow = (btn.dataset['filter'] as JudgeFilter) ?? 'all'; paint(); return true; }
  if (b === 'jr-edit') { editingId = id; msg = ''; paint(); return true; }
  if (b === 'jr-cancel') { editingId = null; paint(); return true; }
  if (b === 'jr-send') {
    const note = ((($app ?? document).querySelector('#jr-note') as HTMLTextAreaElement | null)?.value ?? '').trim();
    if (!note) { msg = 'say what is wrong with the answer first'; paint(); return true; }
    void send({ id, action: 'flag', note }).then(ok => { if (ok) editingId = null; void load(); });
    return true;
  }
  if (b === 'jr-unflag') { void send({ id, action: 'unflag' }).then(() => load()); return true; }
  if (b === 'jr-resolve') { void send({ id, action: 'resolve' }).then(() => load()); return true; }
  return true;
}
