/* THE RULES REVIEW PAGE: the Comprehensive Rules, open for comments.
 *
 * Same contract as admin.ts, league.ts and meta.ts, which main.ts already
 * knows how to drive: `screen()` says whether this page owns the app element,
 * `renderScreen()` paints it, `handleButton()` is offered every click
 * (everything here is prefixed `cr-`), and the state lives in this file.
 *
 * THE WAY IN: a "Rules review" button on the profile of an admin or a judge,
 * and the link `/?crreview=1` (with `&at=r608.2b`, `&at=D-U12-3` or
 * `&c=<comment id>`) for anybody the owner sends it to. The button is not a
 * gate: the page reads for anyone who has the link, signed out included. Who
 * may WRITE is the server's decision on every request, and the buttons on a
 * comment are drawn from the server's own `canEdit` / `canResolve` for that
 * comment, never from anything this client believes about its user.
 *
 * WHAT IS PAINTED: the document, a chapter at a time (all of it at once is
 * ~3 MB of DOM), exactly as the renderer wrote it — GET /api/cr/review hands
 * over render's own HTML fragments with `data-crt` on every commentable item,
 * and this page never re-implements a line of the document. On top of that it
 * adds only DECORATIONS: highlights (crdom.ts splits text nodes, so comment
 * text never reaches the markup), a ＋ on every item, 💬 counts, and the
 * margin of threads. Comment bodies, quotes and names are always esc()'d text.
 *
 * WHAT A REPAINT TOUCHES: a poll that brings new comments repaints the margin,
 * the highlights and the counts, never the document column, and never while
 * the composer is open. Every text box is in the layer (crlayer.ts), beside
 * `#app`, so no repaint can eat a draft. The host's own rerender (a profile
 * refresh, the queue ticker) is a no-op while this page's root is still on
 * screen and nothing changed.
 */
import * as acct from './account.ts';
import { esc } from './util.ts';
import { layoutMargin, locate, placer, sectionOf, targetResolver } from './cranchor.ts';
import type { CrPlace, CrTab, CrTargetState } from './cranchor.ts';
import { clearDecorations, detachedText, textMap, wrapHighlight } from './crdom.ts';
import { isComposerOpen, isSheetOpen, openComposer, pickFor, resetCrLayer, setCrLayerHost, showSheet } from './crlayer.ts';
import type { CrCompose } from './crlayer.ts';
import type { CrComment, CrCommentsReply, CrOp, CrOpReply, CrPart, CrReviewDoc, CrTarget, CrYou } from './crtypes.ts';

/** a root comment, its replies, and where it lives today */
interface Thread {
  root: CrComment;
  replies: CrComment[];
  /** the target after following renames — where it is shown */
  target: string;
  state: CrTargetState;
}

type Filter = 'open' | 'done' | 'outdated' | 'orphaned' | 'mine' | 'all';
const FILTERS: [Filter, string][] = [
  ['open', 'Open'], ['done', 'Resolved'], ['outdated', 'Outdated'], ['orphaned', 'Orphaned'], ['mine', 'Mine'], ['all', 'All'],
];
const TABS: [CrTab, string][] = [
  ['doc', 'Document'], ['annexD', 'Annex D'], ['disc', 'Discrepancies'], ['oq', 'Owner questions'], ['comments', 'Comments'],
];
const POLL_MS = 30_000;

/* ── module state ────────────────────────────────────────────────────────── */

let $app: HTMLElement | null = null;
let rerenderHost: () => void = () => {};
let open = false;
let tab: CrTab = 'doc';
/** the Document tab's contents entry: a chapter (`ch6`) or a part (`front`) */
let view = 'front';
/** an element id to scroll to once the column is painted */
let pendingAnchor: string | null = null;
/** a thread to bring into view once the column is painted */
let pendingFocus: string | null = null;
/** what `?at=` says, kept for the URL */
let atForUrl: string | null = null;
/** a deep link waiting for the document (`at`) or the comments (`c`) */
let wantAt: string | null = null;
let wantComment: string | null = null;
let focusId: string | null = null;

let doc: CrReviewDoc | null = null;
let docErr = '';
let docLoading = false;
let resolveTarget: ReturnType<typeof targetResolver> | null = null;
let place: ReturnType<typeof placer> | null = null;
let partById = new Map<string, CrPart>();
let targetIndex = new Map<string, number>();
/** an item's normalised text, by target, for the threads whose item is not
 * painted (the Comments tab's outdated filter). Cleared with the document */
const textCache = new Map<string, string | null>();

let comments: CrComment[] = [];
let rev = -1;
let you: CrYou = { name: null, canComment: false, why: 'signed-out' };
/** the session token the comments were asked with: a sign-in or out asks again */
let dataFor: string | null | undefined;
let commentsLoading = false;
let msg = '';

let dlOpen = false;
let tocOpen = false;
let showResolved = false;
let filter: Filter = 'open';
/** resolved threads opened by hand */
const expanded = new Set<string>();
/** the narrow layout's sheet, while one is up */
let sheetTarget: string | null = null;

/** the painted page; a host rerender is a no-op while it is still on screen */
let root: HTMLElement | null = null;
let dirty = true;
let poll = 0;
let relayout = 0;

export const screen = (): 'crreview' | null => (open ? 'crreview' : null);

/* ── talking to the server ───────────────────────────────────────────────── */

async function loadDoc(): Promise<void> {
  if (docLoading) return;
  docLoading = true;
  docErr = '';
  try {
    const res = await fetch('/api/cr/review');
    const body = await res.json() as CrReviewDoc | { ok: false; error?: string };
    if (!res.ok || !('parts' in body)) {
      docErr = ('error' in body && body.error) ? body.error : `the server answered ${res.status}`;
    } else {
      doc = body;
      resolveTarget = targetResolver(doc);
      place = placer(doc);
      partById = new Map(doc.parts.map(p => [p.id, p]));
      targetIndex = new Map(doc.targets.map((t, i) => [t, i]));
      textCache.clear();
      applyWanted();
    }
  } catch { docErr = 'could not reach the server'; }
  docLoading = false;
  dirty = true;
  paint();
}

async function loadComments(full = false): Promise<void> {
  if (commentsLoading) return;
  commentsLoading = true;
  const tok = acct.token();
  const q = !full && rev >= 0 && tok === dataFor ? `?rev=${rev}` : '';
  let youChanged = false;
  try {
    const res = await fetch(`/api/cr/comments${q}`, { headers: acct.authHeaders(false) });
    const body = await res.json() as CrCommentsReply;
    if (!body.ok) msg = body.error;
    else if (!('unchanged' in body)) {
      youChanged = JSON.stringify(body.you) !== JSON.stringify(you);
      comments = body.comments;
      you = body.you;
      rev = body.rev;
      dataFor = tok;
      msg = '';
    }
  } catch { msg = 'could not reach the server for the comments'; }
  commentsLoading = false;
  applyWanted();
  // who you are decides buttons all over the page (the answer row, the
  // export link), so a change of reader is a full paint; anything else only
  // touches the margin, the highlights and the counts
  if (youChanged || dirty) { dirty = true; paint(); } else refreshDecor();
}

/** send one op; on success the list is fetched again (other people's
 * comments may have arrived too) and the new comment is focused */
async function postOp(op: CrOp): Promise<string | null> {
  try {
    const res = await fetch('/api/cr/comment', { method: 'POST', headers: acct.authHeaders(), body: JSON.stringify(op) });
    const body = await res.json() as CrOpReply;
    if (!body.ok) return body.error || `refused (${res.status})`;
    const c = body.comment;
    const i = comments.findIndex(x => x.id === c.id);
    if (i >= 0) comments[i] = c; else comments.push(c);
    if (op.op === 'add') focusId = c.parent ?? c.id;
    await loadComments(true);
    return null;
  } catch { return 'could not reach the server'; }
}

/** what the composer wrote, as the op the server takes */
function submit(c: CrCompose, body: string): Promise<string | null> {
  const target = c.target as CrTarget;
  const op: CrOp = c.mode === 'edit' ? { op: 'edit', id: c.id ?? '', body }
    : c.mode === 'reply' ? { op: 'add', target, parent: c.parent ?? null, anchor: null, body }
      : c.mode === 'answer' ? { op: 'add', target, anchor: null, body, kind: 'answer', reading: c.reading ?? 'other' }
        : { op: 'add', target, anchor: c.anchor ?? null, body };
  return postOp(op);
}

/* ── opening, closing, the URL ───────────────────────────────────────────── */

export function openReview(): void {
  open = true;
  msg = '';
  dirty = true;
  syncUrl();
  paint();
  if (!doc) void loadDoc();
  void loadComments(true);
  clearInterval(poll);
  poll = window.setInterval(() => {
    if (open && document.visibilityState === 'visible' && !isComposerOpen()) void loadComments();
  }, POLL_MS);
}

function close(): void {
  open = false;
  clearInterval(poll);
  resetCrLayer();
  sheetTarget = null;
  root = null;
  dirty = true;
  syncUrl();
  $app?.classList.remove('crapp');
  // the page is gone, so this module must NOT paint — hand the screen back
  rerenderHost();
}

function syncUrl(): void {
  try {
    const url = new URL(location.href);
    for (const k of ['crreview', 'at', 'c']) url.searchParams.delete(k);
    if (open) {
      url.searchParams.set('crreview', tab === 'doc' ? '1' : tab);
      const at = atForUrl ?? (tab === 'doc' ? view : null);
      if (at) url.searchParams.set('at', at);
    }
    history.replaceState(null, '', url.toString());
  } catch { /* file:// */ }
}

/** a deep link, once what it needs has arrived */
function applyWanted(): void {
  if (!doc || !place) return;
  if (wantAt) {
    const p = place.ofRef(wantAt);
    if (p) setPlace(p);
    wantAt = null;
  }
  if (wantComment && rev >= 0) {
    const c = comments.find(x => x.id === wantComment);
    const rootId = c ? (c.parent ?? c.id) : null;
    const r = rootId ? comments.find(x => x.id === rootId) : null;
    if (r && resolveTarget) {
      const p = place.ofTarget(resolveTarget(r.target).target);
      if (p) setPlace(p); else tab = 'comments';
      focusId = r.id;
      pendingFocus = r.id;
      if (r.resolved) expanded.add(r.id);
      dirty = true;
    }
    wantComment = null;
  }
  syncUrl();
}

/** move to a place without painting */
function setPlace(p: CrPlace): void {
  if (p.tab !== tab) dirty = true;
  tab = p.tab;
  if (p.tab === 'doc' && p.view && p.view !== view) { view = p.view; dirty = true; }
  pendingAnchor = p.anchor;
  atForUrl = p.anchor ?? (p.tab === 'doc' ? view : null);
}

/** move to a place and show it; `focus` is a thread to bring into view */
function go(p: CrPlace, focus?: string): void {
  setPlace(p);
  focusId = focus ?? null;
  pendingFocus = focus ?? null;
  syncUrl();
  if (dirty || !root?.isConnected) {
    paint();
    // a new chapter with nowhere in particular to go starts at its top
    if (!p.anchor && !focus) window.scrollTo(0, 0);
  } else {
    if (!focus) focusThread('');
    scrollToPending();
  }
}

/**
 * main.ts calls this once at boot. `?crreview` opens the page (its value is a
 * tab, or `1` for the document), `&at=` a place in it, `&c=` a thread.
 */
export function initCrReview(opts: { app: HTMLElement; rerender: () => void }): void {
  $app = opts.app;
  rerenderHost = opts.rerender;
  setCrLayerHost({
    active: () => open && !!root?.isConnected,
    canComment: () => (you.canComment ? { ok: true } : { ok: false, ...(you.why ? { why: you.why } : {}) }),
    edition: () => doc?.edition.name ?? '',
    label: labelOf,
    submit,
  });
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('click', onDocClick);
    // a <details> opening moves everything under it: the margin follows
    document.addEventListener('toggle', () => { if (open) scheduleRelayout(); }, { capture: true });
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', () => { if (open) scheduleRelayout(); });
  }
  try {
    const q = new URLSearchParams(location.search);
    const v = q.get('crreview');
    if (v === null) return;
    const t = TABS.find(([k]) => k === v);
    if (t) tab = t[0];
    wantAt = q.get('at');
    wantComment = q.get('c');
    openReview();
  } catch { /* a URL we cannot parse is a page we do not open */ }
}

/* ── labels and little pieces ────────────────────────────────────────────── */

/** what a target is called on screen: a rule's number, a discrepancy id */
function labelOf(target: string): string {
  const i = target.indexOf(':');
  const kind = i < 0 ? target : target.slice(0, i);
  const rest = i < 0 ? '' : target.slice(i + 1);
  if (kind === 'rule') {
    const t = resolveTarget ? resolveTarget(target).target.slice(5) : rest;
    return doc?.keys[t] ?? doc?.keys[rest] ?? rest;
  }
  if (kind === 'sec' || kind === 'disc' || kind === 'finding') return rest;
  if (kind === 'gloss') return `glossary: ${rest}`;
  if (kind === 'front') return 'the introduction';
  if (kind === 'annexP') return 'Annex P';
  if (kind === 'changelog') return 'the changelog';
  return target;
}

function ago(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)} d ago`;
  return iso.slice(0, 10);
}

const snippet = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/* ── threads ─────────────────────────────────────────────────────────────── */

function threads(): Thread[] {
  const byRoot = new Map<string, CrComment[]>();
  for (const c of comments) if (c.parent) byRoot.set(c.parent, [...(byRoot.get(c.parent) ?? []), c]);
  const out: Thread[] = [];
  for (const c of comments) {
    if (c.parent) continue;
    const replies = (byRoot.get(c.id) ?? []).sort((a, b) => a.at.localeCompare(b.at));
    // a deleted comment nobody answered is gone; one with replies stays as
    // a placeholder, so the replies still have something to hang from
    if (c.deleted && !replies.some(r => !r.deleted)) continue;
    const r = resolveTarget ? resolveTarget(c.target) : { target: c.target, state: 'live' as const };
    out.push({ root: c, replies, target: r.target, state: r.state });
  }
  return out;
}

/** the html of the part an item is painted in, for a thread whose item is not
 * on screen right now */
function htmlHolding(target: string): string | null {
  const p = place?.ofTarget(target);
  if (!p || !doc) return null;
  if (p.tab === 'disc') return doc.disc.find(d => d.id === p.anchor)?.html ?? null;
  if (p.anchor && /^r/.test(p.anchor)) {
    const sec = sectionOf(p.anchor.slice(1));
    return sec ? partById.get(`s${sec}`)?.html ?? null : null;
  }
  return p.view ? partById.get(p.view)?.html ?? null : null;
}

function textOfTarget(target: string): string | null {
  const painted = document.getElementById('crdoc')?.querySelector(`[data-crt="${CSS.escape(target)}"]`);
  if (painted) return textMap(painted).text;
  if (textCache.has(target)) return textCache.get(target)!;
  const html = htmlHolding(target);
  const text = html ? detachedText(html, target) : null;
  textCache.set(target, text);
  return text;
}

/** is the quoted passage still there? (a whole-item comment always is) */
function isOutdated(th: Thread): boolean {
  const a = th.root.anchor;
  if (!a || th.state === 'orphan') return false;
  const text = textOfTarget(th.target);
  return text === null || locate(text, a) === null;
}

/** the threads that count as "open": unresolved and not deleted */
const isOpen = (th: Thread): boolean => !th.root.resolved && !th.root.deleted;

function badges(c: CrComment): string {
  return acct.badgeChipsHtml({
    ...(c.by.owner ? { owner: true as const } : {}), ...(c.by.judge ? { judge: c.by.judge } : {}), since: '',
  });
}

function commentHtml(c: CrComment): string {
  const answer = c.kind === 'answer'
    ? ` <span class="crchipx crans">${c.reading === 'other' ? 'answer: other' : `answer: Reading ${esc(c.reading ?? '')}`}</span>` : '';
  const acts = c.canEdit && !c.deleted
    ? `<button data-btn="cr-edit" data-id="${esc(c.id)}">Edit</button><button data-btn="cr-delete" data-id="${esc(c.id)}">Delete</button>` : '';
  return `<div class="crc${c.mine ? ' mine' : ''}">
    <div class="crby"><b>${esc(c.by.name)}</b> ${badges(c)} <span class="crwhen" title="${esc(c.at)}">${esc(ago(c.at))}</span>${c.editedAt ? ' <span class="crwhen">(edited)</span>' : ''}${answer}</div>
    <div class="crtext">${c.deleted ? '<i>This comment was deleted.</i>' : esc(c.body)}</div>
    ${acts ? `<div class="cracts">${acts}</div>` : ''}
  </div>`;
}

function statusChips(th: Thread, outdated: boolean): string {
  const out: string[] = [];
  if (th.state === 'removed') out.push('<span class="crchipx warn">rule removed</span>');
  if (th.state === 'orphan') out.push('<span class="crchipx warn">no longer in the document</span>');
  if (outdated) out.push('<span class="crchipx warn">the quoted text has changed</span>');
  const ed = th.root.anchor?.edition;
  if (ed && doc && ed !== doc.edition.name) out.push(`<span class="crchipx">from ${esc(ed)}</span>`);
  return out.join(' ');
}

/** one thread as a card: the margin, the sheet and the Comments tab share it */
function threadHtml(th: Thread, opts: { goto?: boolean } = {}): string {
  const r = th.root;
  const id = esc(r.id);
  if (r.resolved && !showResolved && !expanded.has(r.id) && !opts.goto) {
    return `<div class="crthread crdone" data-cid="${id}"><button class="crdonebtn" data-btn="cr-expand" data-id="${id}"
      title="resolved by ${esc(r.resolved.by)}">✓ ${esc(r.by.name)}: ${esc(snippet(r.body))}</button></div>`;
  }
  const outdated = isOutdated(th);
  const quote = r.anchor ? `<blockquote class="crquote${outdated ? ' gone' : ''}">${esc(r.anchor.quote)}</blockquote>` : '';
  const acts: string[] = [];
  if (!r.deleted) acts.push(`<button data-btn="cr-reply" data-id="${id}">Reply</button>`);
  if (r.canResolve && !r.deleted) {
    acts.push(r.resolved
      ? `<button data-btn="cr-reopen" data-id="${id}">Reopen</button>`
      : `<button data-btn="cr-resolve" data-id="${id}">Resolve</button>`);
  }
  if (r.resolved) acts.push(`<button data-btn="cr-expand" data-id="${id}">Collapse</button>`);
  if (opts.goto && th.state !== 'orphan') acts.push(`<button data-btn="cr-goto" data-id="${id}">Go to</button>`);
  const chips = statusChips(th, outdated);
  return `<div class="crthread${r.resolved ? ' crresolved' : ''}${focusId === r.id ? ' focus' : ''}" data-cid="${id}">
    ${chips ? `<div class="crstatus">${chips}</div>` : ''}
    ${r.resolved ? `<div class="crstatus"><span class="crchipx ok">✓ resolved by ${esc(r.resolved.by)}</span></div>` : ''}
    ${quote}
    ${commentHtml(r)}
    ${th.replies.map(commentHtml).join('')}
    <div class="cracts">${acts.join('')}</div>
  </div>`;
}

/* ── painting ────────────────────────────────────────────────────────────── */

function tabsHtml(): string {
  const n = threads().filter(isOpen).length;
  return TABS.map(([k, label]) =>
    `<button class="crtab${tab === k ? ' on' : ''}" data-btn="cr-tab" data-tab="${k}">${label}${
      k === 'comments' ? ` <span class="crn">${n} open</span>` : ''}</button>`).join('');
}

function whoHtml(): string {
  if (rev < 0) return '';
  if (you.canComment) return `<span class="crnote">Commenting as <b>${esc(you.name ?? '')}</b></span>`;
  if (you.why === 'guest') return '<button data-btn="acct-open-profile" title="guests cannot comment: name your account on your profile">Name your account to comment</button>';
  return '<button data-btn="cr-signin">Sign in to comment</button>';
}

/** open threads per contents entry and per section, for the rail */
function railCounts(): { byView: Map<string, number>; bySec: Map<string, number> } {
  const byView = new Map<string, number>();
  const bySec = new Map<string, number>();
  for (const th of threads()) {
    if (!isOpen(th) || th.state === 'orphan') continue;
    const p = place?.ofTarget(th.target);
    if (!p) continue;
    const v = p.tab === 'annexD' ? 'chD' : p.view;
    if (v) byView.set(v, (byView.get(v) ?? 0) + 1);
    const sec = p.anchor && /^r/.test(p.anchor) ? sectionOf(p.anchor.slice(1)) : null;
    if (sec) bySec.set(sec, (bySec.get(sec) ?? 0) + 1);
  }
  return { byView, bySec };
}

const countHtml = (n: number | undefined): string => (n ? ` <span class="crn">💬 ${n}</span>` : '');

function tocHtml(): string {
  if (!doc || (tab !== 'doc' && tab !== 'annexD')) return '';
  const { byView, bySec } = railCounts();
  const secs = (e: { sections?: { num: string; title: string }[] }, viewId: string): string =>
    (e.sections ?? []).map(s => `<button class="crtocsec" data-btn="cr-view" data-view="${esc(viewId)}" data-anchor="r${esc(s.num)}">${esc(s.num)}. ${esc(s.title)}${countHtml(bySec.get(s.num))}</button>`).join('');
  if (tab === 'annexD') {
    const d = doc.toc.find(e => e.id === 'chD');
    return d ? `<div class="crtochead">${esc(d.title)}</div>${secs(d, 'chD')}` : '';
  }
  return doc.toc.filter(e => e.id !== 'chD').map(e =>
    `<button class="crtocent${e.id === view ? ' on' : ''}" data-btn="cr-view" data-view="${esc(e.id)}">${esc(e.title)}${countHtml(byView.get(e.id))}</button>${
      e.id === view ? secs(e, e.id) : ''}`).join('');
}

/** a contents entry's html: a chapter's sections in order, or one part */
function viewHtml(id: string): string {
  if (!doc) return '';
  const e = doc.toc.find(t => t.id === id);
  if (!e) return '<p class="crnote">There is nothing at this place in the document.</p>';
  if (!e.sections) {
    const html = partById.get(e.id)?.html ?? '';
    return /^\s*<h2/.test(html) ? html : `<h2>${esc(e.title)}</h2>${html}`;
  }
  return `<h2 id="${esc(e.id)}">${esc(e.title)}</h2>${e.sections.map(s => partById.get(s.part)?.html ?? '').join('\n')}`;
}

function discHtml(): string {
  if (!doc) return '';
  const out: string[] = [];
  for (const t of [1, 2, 3, 4] as const) {
    const ds = doc.disc.filter(d => d.tier === t);
    out.push(`<h3>Tier ${t} <span class="count">${ds.length}</span></h3>`, ...ds.map(d => d.html));
  }
  return `<h2>Discrepancies</h2><p class="crnote">Every place where the sources disagree. Only the first tier needs a decision; the Owner questions tab has those.</p>${out.join('\n')}`;
}

function oqHtml(): string {
  if (!doc) return '';
  const byId = new Map(doc.disc.map(d => [d.id, d]));
  return `<h2>Questions for the owner</h2>${doc.ownerQuestions.map(t => `<h3>${esc(t.topic)}</h3>${t.items.map(it =>
    `<div class="croq"><div class="croqn">Question ${it.n}</div>${byId.get(it.id)?.html ?? `<p class="crnote">${esc(it.id)} is not in the discrepancy list.</p>`}
      <div class="croqans" data-croq="${esc(it.id)}"></div></div>`).join('')}`).join('')}`;
}

function commentsTabHtml(): string {
  const all = threads();
  const outdated = new Map(all.map(th => [th.root.id, isOutdated(th)]));
  const keep = (th: Thread): boolean => {
    switch (filter) {
      case 'open': return isOpen(th);
      case 'done': return !!th.root.resolved;
      case 'outdated': return outdated.get(th.root.id) === true;
      case 'orphaned': return th.state === 'orphan';
      case 'mine': return th.root.mine || th.replies.some(r => r.mine);
      default: return true;
    }
  };
  const order = (th: Thread): number => (th.state === 'orphan' ? Infinity : targetIndex.get(th.target) ?? Infinity);
  const shown = all.filter(keep).sort((a, b) => order(a) - order(b)
    || (a.root.anchor?.start ?? -1) - (b.root.anchor?.start ?? -1) || a.root.at.localeCompare(b.root.at));
  const filters = FILTERS.map(([k, label]) =>
    `<button class="crtab${filter === k ? ' on' : ''}" data-btn="cr-filter" data-filter="${k}">${label}</button>`).join('');
  const rows: string[] = [];
  let orphanHead = false;
  for (const th of shown) {
    if (th.state === 'orphan' && !orphanHead) { rows.push('<h3>No longer in the document</h3>'); orphanHead = true; }
    const where = th.state === 'orphan' ? (th.root.anchor?.num ?? th.root.target) : labelOf(th.target);
    rows.push(`<div class="crlistitem"><div class="crwhere">${esc(where)}</div>${threadHtml(th, { goto: true })}</div>`);
  }
  return `<h2>Comments</h2><div class="crfilters">${filters}</div>
    ${rows.length ? rows.join('') : '<p class="crnote">No comments here.</p>'}`;
}

function columnHtml(): string {
  switch (tab) {
    case 'annexD': return viewHtml('chD');
    case 'disc': return discHtml();
    case 'oq': return oqHtml();
    case 'comments': return commentsTabHtml();
    default: return viewHtml(view);
  }
}

function downloadsHtml(): string {
  if (!dlOpen || !doc) return '';
  const a = (part: string, fmt: string): string =>
    `<a href="/api/cr/download?part=${encodeURIComponent(part)}&amp;fmt=${fmt}" download>.${fmt}</a>`;
  const three = (part: string): string => `${a(part, 'md')} ${a(part, 'txt')} ${a(part, 'html')}`;
  const ch = tab === 'annexD' ? 'D' : /^ch(.+)$/.exec(view)?.[1] ?? null;
  const sec = sectionInView();
  const rows: string[] = [`<div><b>Whole document</b> ${three('all')}</div>`];
  if (ch && (tab === 'doc' || tab === 'annexD')) rows.push(`<div><b>This chapter</b> ${three(`ch:${ch}`)}</div>`);
  if (sec && (tab === 'doc' || tab === 'annexD')) rows.push(`<div><b>This section (${esc(sec)})</b> ${three(`sec:${sec}`)}</div>`);
  rows.push(`<div><b>Annex D</b> ${a('annexD', 'md')} · <b>Discrepancy report</b> ${a('disc', 'md')} · <b>Owner questions</b> ${a('oq', 'md')} · <b>Changelog</b> ${a('changelog', 'md')}</div>`);
  rows.push(`<div><b>Comments</b> ${a('comments', 'md')}${you.admin ? ` ${a('comments', 'jsonl')} <span class="crnote">(raw journal, admins only)</span>` : ''}</div>`);
  return `<div class="crdl">${rows.join('')}<div class="crnote">A section or chapter saved as .html is a page of its own: its links to other sections do not work there.</div></div>`;
}

/** the section nearest the top of the window, for "This section" */
function sectionInView(): string | null {
  const col = document.getElementById('crdoc');
  if (!col) return null;
  for (const el of Array.from(col.querySelectorAll('[data-crt^="sec:"]'))) {
    if (el.getBoundingClientRect().bottom > 90) return (el.getAttribute('data-crt') ?? '').slice(4) || null;
  }
  return null;
}

function paint(): void {
  const app = $app ?? document.getElementById('app');
  if (!app || !open) return;
  app.classList.add('crapp');
  const title = doc ? `<b>${esc(doc.title)}</b> <span class="crnote">${esc(doc.edition.name)}, effective ${esc(doc.edition.effective)}</span>` : '<b>Rules review</b>';
  const body = !doc
    ? `<div class="crcol"><p class="crnote">${docErr ? esc(docErr) : 'Loading the document…'}</p></div>`
    : `<nav class="crtoc${tocOpen ? ' open' : ''}" id="crtoc" aria-label="Contents">${tocHtml()}</nav>
       <div class="crcol"><div class="crdoc" id="crdoc">${columnHtml()}</div></div>
       <aside class="crmargin" id="crmargin" aria-label="Comments"></aside>`;
  app.innerHTML = `<div class="crpage">
    <div class="crbar">
      <button data-btn="cr-close" title="back to the lobby">← Close</button>
      <button class="crtocbtn" data-btn="cr-toc">☰ Contents</button>
      <div class="crtitle">${title}</div>
      <div class="crtabs" id="crtabs">${tabsHtml()}</div>
      <span class="crgrow"></span>
      <span class="crwho" id="crwho">${whoHtml()}</span>
      <button data-btn="cr-showdone" title="resolved threads are folded to one line">${showResolved ? 'Fold resolved' : 'Show resolved'}</button>
      <button data-btn="cr-refresh" title="check for new comments">↻</button>
      <button data-btn="cr-dl" class="${dlOpen ? 'on' : ''}">⬇ Download</button>
    </div>
    <div id="crdlslot">${downloadsHtml()}</div>
    <div class="crmsg" id="crmsg">${msg ? esc(msg) : ''}</div>
    <div class="crbody tab-${tab}">${body}</div>
  </div>`;
  root = app.firstElementChild as HTMLElement | null;
  dirty = false;
  decorate();
  scrollToPending();
}

export function renderScreen(): void {
  if (!open) return;
  // a sign-in or a sign-out since the comments were fetched: ask again
  if (dataFor !== undefined && dataFor !== acct.token()) void loadComments(true);
  if (!dirty && root?.isConnected) return;
  paint();
}

/** the counts, the rail, the margin and the highlights — never the column,
 * except on the Comments tab, which IS the list */
function refreshDecor(): void {
  if (!open || !root?.isConnected) return;
  const set = (id: string, html: string): void => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  set('crtabs', tabsHtml());
  set('crwho', whoHtml());
  set('crtoc', tocHtml());
  set('crmsg', msg ? esc(msg) : '');
  if (tab === 'comments') set('crdoc', commentsTabHtml());
  decorate();
  if (sheetTarget && isSheetOpen()) openSheetFor(sheetTarget); else sheetTarget = null;
}

/* ── decorations: highlights, ＋, 💬, the margin ─────────────────────────── */

/** put a decoration on an item: in its tags row or heading line if it has
 * one, else at the top of a block (the introduction) or the end of a line
 * (a glossary term) */
function putDecor(item: Element, node: Element): void {
  // in this order of preference (a selector list would take document order)
  let slot: Element | null = null;
  for (const sel of [':scope > .tags', ':scope > .dh', ':scope > .rt', ':scope > h3', ':scope > h2']) {
    slot = item.querySelector(sel);
    if (slot) break;
  }
  if (slot) slot.appendChild(node);
  else if (/^(DIV|SECTION|ARTICLE)$/.test(item.tagName)) item.prepend(node);
  else item.appendChild(node);
}

/** the threads painted in the margin, in document order, with what each is
 * level with: its first highlight, or (whole-item, outdated) its item */
let placed: { id: string; at: Element }[] = [];

function decorate(): void {
  const col = document.getElementById('crdoc');
  if (!col || !doc) return;
  clearDecorations(col);
  placed = [];
  if (tab === 'oq') paintAnswers(col);
  if (tab === 'comments') return;
  const items = new Map<string, Element>();
  for (const el of Array.from(col.querySelectorAll('[data-crt]'))) items.set(el.getAttribute('data-crt') ?? '', el);
  const shown: { th: Thread; item: Element; start: number; end: number }[] = [];
  const counts = new Map<string, number>();
  for (const th of threads()) {
    const item = items.get(th.target);
    if (!item) continue;
    if (isOpen(th)) counts.set(th.target, (counts.get(th.target) ?? 0) + 1);
    const visible = !th.root.resolved || showResolved || expanded.has(th.root.id);
    const hit = th.root.anchor && !th.root.deleted ? locate(textMap(item).text, th.root.anchor) : null;
    shown.push({ th, item, start: hit?.start ?? -1, end: hit?.end ?? -1 });
    if (hit && visible) wrapHighlight(item, hit.start, hit.end, th.root.id);
  }
  // the ＋ on every item, and its count of open threads
  for (const [target, item] of items) {
    const plus = document.createElement('button');
    plus.className = 'crplus';
    plus.setAttribute('data-crui', '');
    plus.dataset['btn'] = 'cr-add';
    plus.dataset['target'] = target;
    plus.title = 'comment on this (or on the words you have selected in it)';
    plus.textContent = '＋';
    putDecor(item, plus);
    const n = counts.get(target);
    if (n) {
      const b = document.createElement('button');
      b.className = 'crcount';
      b.setAttribute('data-crui', '');
      b.dataset['btn'] = 'cr-sheet';
      b.dataset['target'] = target;
      b.textContent = `💬 ${n}`;
      putDecor(item, b);
    }
  }
  // a collapsed provenance block says how many highlights it is hiding
  for (const d of Array.from(col.querySelectorAll('details'))) {
    const ids = new Set(Array.from(d.querySelectorAll('mark.crhl')).map(m => m.getAttribute('data-cid')));
    const sum = d.querySelector(':scope > summary');
    if (!ids.size || !sum) continue;
    const s = document.createElement('span');
    s.className = 'crn';
    s.setAttribute('data-crui', '');
    s.textContent = ` 💬 ${ids.size}`;
    sum.appendChild(s);
  }
  for (const m of Array.from(col.querySelectorAll('mark.crhl'))) {
    if (m.getAttribute('data-cid') === focusId) m.classList.add('on');
  }
  // the margin, in document order
  const margin = document.getElementById('crmargin');
  if (!margin) return;
  const order = (x: { th: Thread; start: number }): number => targetIndex.get(x.th.target) ?? Infinity;
  shown.sort((a, b) => order(a) - order(b) || a.start - b.start || a.th.root.at.localeCompare(b.th.root.at));
  margin.innerHTML = shown.map(x => threadHtml(x.th)).join('');
  placed = shown.map(x => ({
    id: x.th.root.id,
    at: col.querySelector(`mark.crhl[data-cid="${CSS.escape(x.th.root.id)}"]`) ?? x.item,
  }));
  layoutNow();
}

/** stack the margin's cards level with their passages */
function layoutNow(): void {
  const margin = document.getElementById('crmargin');
  if (!margin || !placed.length) { if (margin) margin.style.minHeight = ''; return; }
  if (getComputedStyle(margin).display === 'none') return;
  const top0 = margin.getBoundingClientRect().top;
  const cards = new Map<string, HTMLElement>();
  for (const el of Array.from(margin.querySelectorAll<HTMLElement>(':scope > .crthread'))) cards.set(el.dataset['cid'] ?? '', el);
  const items = placed.flatMap(p => {
    const card = cards.get(p.id);
    // a <mark> inside a closed <details> has no box: fall back to the summary
    const box = p.at.getClientRects().length ? p.at : p.at.closest('details')?.querySelector('summary') ?? p.at;
    return card ? [{ id: p.id, y: box.getBoundingClientRect().top - top0, h: card.offsetHeight }] : [];
  });
  const tops = layoutMargin(items);
  let bottom = 0;
  for (const it of items) {
    const card = cards.get(it.id)!;
    const t = tops.get(it.id) ?? it.y;
    card.style.top = `${Math.round(t)}px`;
    bottom = Math.max(bottom, t + it.h);
  }
  margin.style.minHeight = `${Math.ceil(bottom + 40)}px`;
}

function scheduleRelayout(): void {
  clearTimeout(relayout);
  relayout = window.setTimeout(layoutNow, 60);
}

/** the Owner questions tab: who answered what, and (for an admin) the
 * one-click answers. The server checks the admin flag again on the post */
function paintAnswers(col: Element): void {
  if (!doc) return;
  const readings = new Map(doc.ownerQuestions.flatMap(t => t.items.map(it => [it.id, it.readings] as const)));
  const ths = threads();
  for (const slot of Array.from(col.querySelectorAll<HTMLElement>('[data-croq]'))) {
    const id = slot.dataset['croq'] ?? '';
    const target = `disc:${id}`;
    const answers = ths.filter(th => th.target === target && th.root.kind === 'answer' && !th.root.deleted)
      .sort((a, b) => b.root.at.localeCompare(a.root.at));
    const last = answers[0]?.root;
    const said = last
      ? `<span class="crchipx ok">Answered: ${last.reading === 'other' ? 'other' : `Reading ${esc(last.reading ?? '')}`}</span> <span class="crnote">${esc(last.by.name)}, ${esc(ago(last.at))}${last.reading === 'other' ? `: ${esc(snippet(last.body, 120))}` : ''}</span>`
      : '<span class="crnote">Not answered yet.</span>';
    const btns = you.admin
      ? `${(readings.get(id) ?? []).map(r => `<button data-btn="cr-answer" data-target="${esc(target)}" data-reading="${esc(r)}">Reading ${esc(r)}</button>`).join('')}<button data-btn="cr-answer" data-target="${esc(target)}" data-reading="other">Other…</button>`
      : '';
    slot.innerHTML = `${said}${btns ? ` <span class="croqbtns">${btns}</span>` : ''}`;
  }
}

/* ── moving about ────────────────────────────────────────────────────────── */

function scrollToPending(): void {
  const id = pendingAnchor;
  const fid = pendingFocus;
  pendingAnchor = null;
  pendingFocus = null;
  if (fid) {
    const card = document.querySelector(`#crmargin [data-cid="${CSS.escape(fid)}"], #crdoc [data-cid="${CSS.escape(fid)}"]`);
    const mark = document.querySelector(`#crdoc mark.crhl[data-cid="${CSS.escape(fid)}"]`);
    const to = mark ?? (id ? document.getElementById(id) : null) ?? card;
    to?.scrollIntoView({ block: 'center' });
    flash(card);
    return;
  }
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: 'start' });
  // the sticky bar covers the first lines (one row wide, two or three narrow)
  window.scrollBy(0, -((document.querySelector('.crbar')?.getBoundingClientRect().height ?? 60) + 12));
  flash(el.closest('article, section, dt, h2, h3') ?? el);
}

function flash(el: Element | null): void {
  if (!el) return;
  el.classList.add('crflash');
  window.setTimeout(() => el.classList.remove('crflash'), 1400);
}

/** mark one thread as the one being read (or none, with '') */
function focusThread(id: string): void {
  focusId = id || null;
  for (const el of Array.from(document.querySelectorAll('#crmargin .crthread'))) {
    el.classList.toggle('focus', el.getAttribute('data-cid') === id);
  }
  for (const m of Array.from(document.querySelectorAll('#crdoc mark.crhl'))) {
    m.classList.toggle('on', m.getAttribute('data-cid') === id);
  }
  if (!id) return;
  const margin = document.getElementById('crmargin');
  if (margin && getComputedStyle(margin).display === 'none') {
    const th = threads().find(t => t.root.id === id);
    if (th) openSheetFor(th.target);
    return;
  }
  document.querySelector(`#crmargin [data-cid="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
}

function openSheetFor(target: string): void {
  sheetTarget = target;
  const ths = threads().filter(th => th.target === target);
  showSheet(labelOf(target), ths.length ? ths.map(th => threadHtml(th)).join('') : '<p class="crnote">No comments here yet.</p>');
}

/** links inside the document (#r609.1, #D-U12-3, #F-…) move the page rather
 * than the browser, and a highlight focuses its thread */
function onDocClick(e: MouseEvent): void {
  if (!open) return;
  const t = e.target as HTMLElement | null;
  const a = t?.closest?.('a[href^="#"]');
  if (a && a.closest('.crpage')) {
    e.preventDefault();
    const p = place?.ofRef(a.getAttribute('href') ?? '');
    if (p) go(p);
    return;
  }
  const mark = t?.closest?.('mark.crhl');
  if (mark && mark.closest('#crdoc') && window.getSelection?.()?.isCollapsed !== false) {
    focusThread(mark.getAttribute('data-cid') ?? '');
  }
}

/* ── clicks ──────────────────────────────────────────────────────────────── */

const byId = (id: string): CrComment | undefined => comments.find(c => c.id === id);

export function handleButton(btn: HTMLElement): boolean {
  const b = btn.dataset['btn'] ?? '';
  if (!b.startsWith('cr-')) return false;
  const id = btn.dataset['id'] ?? '';
  switch (b) {
    case 'cr-close': close(); return true;
    case 'cr-tab': {
      const t = TABS.find(([k]) => k === btn.dataset['tab']);
      if (t) go({ tab: t[0], view: t[0] === 'doc' ? view : null, anchor: null });
      return true;
    }
    case 'cr-view': {
      const v = btn.dataset['view'] ?? '';
      tocOpen = false;
      go({ tab: v === 'chD' ? 'annexD' : 'doc', view: v, anchor: btn.dataset['anchor'] ?? null });
      return true;
    }
    case 'cr-toc':
      tocOpen = !tocOpen;
      document.getElementById('crtoc')?.classList.toggle('open', tocOpen);
      return true;
    case 'cr-refresh': void loadComments(true); return true;
    case 'cr-dl': {
      dlOpen = !dlOpen;
      const slot = document.getElementById('crdlslot');
      if (slot) slot.innerHTML = downloadsHtml();
      btn.classList.toggle('on', dlOpen);
      return true;
    }
    case 'cr-signin': resetCrLayer(); acct.signInThenReturn(); return true;
    case 'cr-filter': {
      const f = FILTERS.find(([k]) => k === btn.dataset['filter']);
      if (f) { filter = f[0]; dirty = true; paint(); }
      return true;
    }
    case 'cr-showdone':
      showResolved = !showResolved;
      btn.textContent = showResolved ? 'Fold resolved' : 'Show resolved';
      refreshDecor();
      return true;
    case 'cr-expand':
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      refreshDecor();
      return true;
    case 'cr-add': {
      const target = btn.dataset['target'] ?? '';
      const pick = pickFor(target);
      openComposer({ mode: 'add', target, anchor: pick?.anchor ?? null, label: labelOf(target), ...(pick?.note ? { note: pick.note } : {}) });
      return true;
    }
    case 'cr-reply': {
      const r = byId(id);
      if (r) openComposer({ mode: 'reply', target: r.target, parent: r.id, label: labelOf(resolveTarget?.(r.target).target ?? r.target) });
      return true;
    }
    case 'cr-edit': {
      const c = byId(id);
      if (c) openComposer({ mode: 'edit', target: c.target, id: c.id, label: labelOf(c.target), draft: c.body });
      return true;
    }
    case 'cr-delete':
      if (byId(id) && window.confirm('Delete this comment?')) void postOp({ op: 'delete', id }).then(showError);
      return true;
    case 'cr-resolve': void postOp({ op: 'resolve', id }).then(showError); return true;
    case 'cr-reopen': void postOp({ op: 'reopen', id }).then(showError); return true;
    case 'cr-goto': {
      const th = threads().find(t => t.root.id === id);
      const p = th ? place?.ofTarget(th.target) : null;
      if (th && p) {
        if (th.root.resolved) expanded.add(id);
        go(p, id);
      }
      return true;
    }
    case 'cr-sheet': {
      const target = btn.dataset['target'] ?? '';
      const margin = document.getElementById('crmargin');
      const first = threads().find(th => th.target === target && isOpen(th));
      if (margin && getComputedStyle(margin).display !== 'none' && first) focusThread(first.root.id);
      else openSheetFor(target);
      return true;
    }
    case 'cr-answer': {
      // one click posts the reading; "Other…" opens the composer for words
      const target = btn.dataset['target'] ?? '';
      const reading = btn.dataset['reading'] ?? 'other';
      if (reading === 'other') openComposer({ mode: 'answer', target, reading, label: labelOf(target) });
      else void postOp({ op: 'add', target: target as CrTarget, anchor: null, body: `Reading ${reading}.`, kind: 'answer', reading }).then(showError);
      return true;
    }
    default: return true;
  }
}

function showError(err: string | null): void {
  msg = err ?? '';
  const el = document.getElementById('crmsg');
  if (el) el.textContent = msg;
}
