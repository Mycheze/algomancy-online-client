/* THE COMPREHENSIVE RULES, READ IN THE CLIENT (the rules reader's
 * Comprehensive rules tab, 2026-11-04).
 *
 * Owner, 2026-11-04: "the CR are really clunky to read and navigate as a
 * modal" — the tab framed the 3.8MB generated page in an iframe inside a
 * modal. And then, of the first fix, which drew the rules alone and linked the
 * full edition for their sources: "why do we need a Comprehensive Rules and
 * then a Full edition, with sources? … Just the main Comprehensive Rules
 * should be everything, right?"
 *
 * So this IS the full edition. What it shows is the document the generated
 * page and the judges' review page are both drawn from — render.mjs
 * buildReview(), served at /api/cr/review — part by part, styled by the review
 * page's own `.crdoc` rules: the Introduction, every section with each rule's
 * "Sources and verification" folded under it, Annex P, the glossary, the
 * changelog, Annex D, and the discrepancy report. Nothing here renders a rule;
 * the renderer did, once, for every edition.
 *
 *   ┌ the contents / search ┐┌ one place at a time, at reading width ───────┐
 *   │ [search, or 608.2b]   ││ 6. Regions, Formations and Battle            │
 *   │ Introduction          ││ 608. Combat Damage Step                       │
 *   │ 1. Game Concepts      ││ 608.1. …   ▸ Sources and verification         │
 *   │   100 General         ││ …                                             │
 *   │ …                     ││ ‹ 607 …                          609 … ›      │
 *   └───────────────────────┘└───────────────────────────────────────────────┘
 *
 * A place is one section, or one part that has no sections (the Introduction,
 * Annex P …). Every in-document link (#r608.2b, #D-U12-3, #F-…) moves the
 * reader instead of the browser and keeps a Back step. The SEARCH reads the
 * rules' words from a lean file (server/main.ts CR_DATA_URL): the numbers, the
 * sections and the text, which the rendered parts would only give up by
 * parsing HTML. `?rules=cr&at=608.2b` opens at the rule.
 *
 * State lives here; the drawing is a function of it; ui/rules.ts draws the
 * reader around it and wires the box.
 */
import { esc } from './util.ts';
import { CR_DATA_URL } from './assets.ts';
import type { CrDiscItem, CrPart, CrTocEntry } from './crtypes.ts';

/* ── the data ──────────────────────────────────────────────────────────── */

/** a rule as the search reads it */
export interface CrRule {
  num: string;
  title: string | null;
  section: string;
  sectionTitle: string;
  text: string;
  examples: string[];
}
export interface CrGloss { term: string; key: string; text: string }
/** CR_DATA_URL: what the search reads */
export interface CrData { rules: CrRule[]; annexD: CrRule[]; glossary: CrGloss[] }
/** /api/cr/review, the parts the reader shows (the rest of it is the review page's) */
export interface CrDoc {
  title: string;
  subtitle: string;
  edition: { name: string; effective: string; engineCommit?: string };
  toc: CrTocEntry[];
  parts: Pick<CrPart, 'id' | 'html'>[];
  disc: Pick<CrDiscItem, 'id' | 'html'>[];
}

/** the review document's URL (server/api-crreview.ts) */
export const CR_DOC_URL = '/api/cr/review';

/** one place the text pane shows: a section, or a part with no sections */
export interface CrPlace { id: string; title: string; chapter: string; num: string | null; html: string }
export interface CrModel {
  data: CrData;
  doc: CrDoc;
  places: CrPlace[];
  byPlace: Map<string, CrPlace>;
  /** an element id or comment target in the document → the place that holds it */
  placeOf: Map<string, string>;
  /** a section's number (608, D3) → its place */
  sectionPlace: Map<string, string>;
}

/** the discrepancy report's place (it is a tab on the review page, not a contents entry) */
export const DISC = 'disc';

/** An in-document link moves the reader, not the browser: `href="#x"` becomes
 * a crgo button's target. Any other link is left as it is. */
export function rewireLinks(html: string): string {
  return html.replace(/<a\b([^>]*?)\shref="#([^"]+)"([^>]*)>/g,
    (_m, before: string, to: string, after: string) => `<a${before} data-btn="crgo" data-to="${to}" role="link" tabindex="0"${after}>`);
}

/** Index the document: its places in contents order (the discrepancy report
 * last), and where every id and comment target in it lives. */
export function buildModel(data: CrData, doc: CrDoc): CrModel {
  const part = new Map(doc.parts.map(p => [p.id, p.html]));
  const places: CrPlace[] = [];
  for (const e of doc.toc) {
    if (!e.sections?.length) {
      const html = part.get(e.id) ?? '';
      places.push({ id: e.id, title: e.title, chapter: '', num: null,
        // a heading only where the part has none of its own (the Introduction's is inside its box)
        html: /^\s*(?:<div[^>]*>\s*)?<h[23]/.test(html) ? html : `<h2 id="${esc(e.id)}">${esc(e.title)}</h2>${html}` });
      continue;
    }
    e.sections.forEach((s, i) => {
      // a chapter's lead (Annex D's precedence paragraph) comes before its first section
      const lead = i === 0 && e.lead ? part.get(e.lead) ?? '' : '';
      places.push({ id: s.part, title: s.title, chapter: e.title, num: s.num, html: lead + (part.get(s.part) ?? '') });
    });
  }
  if (doc.disc.length) {
    places.push({ id: DISC, title: 'Discrepancy report', chapter: '', num: null,
      html: `<h2 id="discrepancies">Discrepancy report</h2>${doc.disc.map(d => d.html).join('\n')}` });
  }
  const byPlace = new Map(places.map(p => [p.id, p]));
  const placeOf = new Map<string, string>();
  const sectionPlace = new Map<string, string>();
  for (const p of places) {
    if (p.num) sectionPlace.set(p.num, p.id);
    for (const m of p.html.matchAll(/\s(?:id|data-crt)="([^"]+)"/g)) if (!placeOf.has(m[1]!)) placeOf.set(m[1]!, p.id);
    p.html = rewireLinks(p.html);
  }
  return { data, doc, places, byPlace, placeOf, sectionPlace };
}

/* ── the state ─────────────────────────────────────────────────────────── */

let model: CrModel | null = null;
let loading = false;
let failed = false;
/** the place on screen (null: the first) */
let view: string | null = null;
/** the element picked out on screen (an id or a comment target), or null */
let at: string | null = null;
/** where Back goes: the places left, newest last */
const history: { view: string; at: string | null }[] = [];
/** the search box's text */
let query = '';
/** set by a move: after the next paint the text pane goes to `at` (or the top) */
let pendingScroll = false;
const repaints = new Set<() => void>();

/** the host's repaint, called when the rules arrive (the help layer, the board) */
export function onCrChange(fn: () => void): void { repaints.add(fn); }
const changed = (): void => { for (const fn of repaints) fn(); };
/** ask the hosts to repaint (a move made outside a click: Enter in the search box) */
export const crChanged = (): void => changed();

/** Ask for the document and the search data once, together. A failure is a
 * line in the reader; the generated page is still at CR_PAGE_URL for a link. */
export function loadCr(fetcher: typeof fetch | undefined = globalThis.fetch): void {
  if (model || loading || !fetcher) return;
  loading = true;
  failed = false;
  const get = <T>(url: string): Promise<T> => fetcher(url).then(r => (r.ok ? r.json() as Promise<T> : Promise.reject(new Error(`${url}: ${r.status}`))));
  void Promise.all([get<CrData>(CR_DATA_URL), get<CrDoc>(CR_DOC_URL)])
    .then(([d, doc]) => { model = buildModel(d, doc); })
    .catch(() => { failed = true; })
    .finally(() => {
      loading = false;
      const want = at;
      if (want) { at = null; goTo(want, false); }
      changed();
    });
}

/** for tests and stories: put a model in place */
export function setCrModel(m: CrModel | null): void { model = m; }

export const crQuery = (): string => query;
export function setCrQuery(q: string): void { query = q; }

/** Open at a rule or a section (`?rules=cr&at=608.2b`, a link). Unknown → the top. */
export function crOpenAt(to: string | null): void {
  history.length = 0;
  view = null;
  at = null;
  if (to) goTo(to.replace(/^r(?=\d|D)/i, ''), false);
}

const RULE_NUM = /^(?:\d{3}(?:\.\d+[a-z]?)?|d\d+(?:\.\d+[a-z]?)?)$/i;
/** "d3.1" → "D3.1"; anything else as it is */
const normNum = (t: string): string => (/^d\d/i.test(t) ? `D${t.slice(1)}` : t);

/** Where a target lives: a place, an element in one, or a rule number. */
function resolve(m: CrModel, target: string): { view: string; at: string | null } | null {
  const t = target.trim();
  if (m.byPlace.has(t)) return { view: t, at: null };
  if (RULE_NUM.test(t)) {
    const n = normNum(t);
    const sec = m.sectionPlace.get(n);
    if (sec) return { view: sec, at: null };
    const p = m.placeOf.get(`r${n}`);
    if (p) return { view: p, at: `r${n}` };
    return null;
  }
  const p = m.placeOf.get(t);
  return p ? { view: p, at: t } : null;
}

/** Go to a rule, a section, a part or an element; `remember` keeps a Back step. */
export function goTo(to: string, remember = true): boolean {
  if (!model) { at = to.trim(); return false; }
  const where = resolve(model, to);
  if (!where) return false;
  const here = { view: view ?? model.places[0]!.id, at };
  if (remember && (here.view !== where.view || here.at !== where.at)) history.push(here);
  if (history.length > 50) history.shift();
  view = where.view; at = where.at;
  pendingScroll = true;
  return true;
}

/** Back one step. False when there is nowhere to go. */
export function goBack(): boolean {
  const p = history.pop();
  if (!p) return false;
  view = p.view; at = p.at;
  pendingScroll = true;
  return true;
}

function current(m: CrModel): CrPlace {
  return m.byPlace.get(view ?? '') ?? m.places[0]!;
}

/** what a place is called in a Back button or a hit: "608", or its title */
const placeLabel = (p: CrPlace): string => p.num ?? p.title;

/* ── the search ────────────────────────────────────────────────────────── */

export interface CrHit { to: string; num: string; label: string; snippet: string }

const words = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(w => w.length > 1);

/** A rule number first (a section, the rule, then the rules under it), then
 * every glossary term and rule holding all the words, in document order. */
export function crSearch(m: CrModel, q: string, limit = 60): CrHit[] {
  const t = q.trim();
  if (!t) return [];
  const out: CrHit[] = [];
  const seen = new Set<string>();
  const push = (h: CrHit): void => { if (!seen.has(h.to) && out.length < limit) { seen.add(h.to); out.push(h); } };
  const all = [...m.data.rules, ...m.data.annexD];
  if (RULE_NUM.test(t)) {
    const n = normNum(t);
    const sec = m.sectionPlace.get(n);
    if (sec) push({ to: n, num: n, label: m.byPlace.get(sec)!.title, snippet: '' });
    for (const x of all) {
      if (x.num === n || x.num.startsWith(n)) push({ to: x.num, num: x.num, label: x.sectionTitle, snippet: snippet(x.text, []) });
    }
    if (out.length) return out;
  }
  const ws = words(t);
  if (!ws.length) return out;
  for (const g of m.data.glossary) {
    if (ws.every(w => `${g.term} ${g.text}`.toLowerCase().includes(w))) {
      push({ to: m.placeOf.has(`gloss:${g.key}`) ? `gloss:${g.key}` : 'glossary', num: 'Glossary', label: g.term, snippet: snippet(g.text, ws) });
    }
  }
  for (const r of all) {
    if (ws.every(w => `${r.title ?? ''} ${r.text} ${r.examples.join(' ')}`.toLowerCase().includes(w))) {
      push({ to: r.num, num: r.num, label: r.title ?? r.sectionTitle, snippet: snippet(r.text, ws) });
    }
  }
  return out;
}

/** a line around the first word found, the words marked */
function snippet(text: string, ws: string[]): string {
  const flat = text.replace(/\s+/g, ' ');
  const lc = flat.toLowerCase();
  const first = ws.length ? Math.min(...ws.map(w => { const i = lc.indexOf(w); return i < 0 ? Infinity : i; })) : 0;
  const from = Math.max(0, (Number.isFinite(first) ? first : 0) - 40);
  const cut = flat.slice(from, from + 120);
  let html = esc((from > 0 ? '…' : '') + cut + (from + 120 < flat.length ? '…' : ''));
  for (const w of ws) html = html.replace(new RegExp(`(${esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
  return html;
}

/* ── drawing ───────────────────────────────────────────────────────────── */

/** the place on screen: where it sits, the edition's own words, the way to its neighbours */
function textHtml(m: CrModel): string {
  const p = current(m);
  const i = m.places.indexOf(p);
  const prev = m.places[i - 1], next = m.places[i + 1];
  const back = history[history.length - 1];
  const backPlace = back ? m.byPlace.get(back.view) : undefined;
  const nav = (x: CrPlace | undefined, dir: 'prev' | 'next'): string => x
    ? `<button class="rdstep ${dir}" data-btn="crgo" data-to="${esc(x.id)}"><span>${dir === 'prev' ? '‹ Previous' : 'Next ›'}</span>
        <b>${x.num ? `${esc(x.num)}. ` : ''}${esc(x.title)}</b></button>`
    : '<span></span>';
  const backLabel = back ? (back.at && /^r[\dD]/.test(back.at) ? back.at.slice(1) : backPlace ? placeLabel(backPlace) : '') : '';
  return `<div class="rdtext" id="cr-text" data-scroll="cr-text">
    <div class="rdpage">
      ${back ? `<button class="rdback" data-btn="crback">← Back to ${esc(backLabel)}</button>` : ''}
      ${i === 0 ? `<header class="rdfront"><h1>${esc(m.doc.title)}</h1>
        <p>${esc(m.doc.subtitle)} ${esc(m.doc.edition.name)}, effective ${esc(m.doc.edition.effective)}.</p></header>` : ''}
      ${p.chapter ? `<div class="rdchap">${esc(p.chapter)}</div>` : ''}
      <div class="crdoc rddoc">${p.html}</div>
      <nav class="rdsteps">${nav(prev, 'prev')}${nav(next, 'next')}</nav>
    </div>
  </div>`;
}

/** the left pane's list: the contents, or what the search found */
export function crNavListHtml(): string {
  const m = model;
  if (!m) return '';
  const q = query.trim();
  if (q) {
    const hits = crSearch(m, q);
    if (!hits.length) return `<p class="rdnone">No rule matches “${esc(q)}”.</p>`;
    return `<ol class="rdhits">${hits.map(h => `<li><button data-btn="crgo" data-to="${esc(h.to)}">
      <span class="rdhitnum">${esc(h.num)}</span> <b>${esc(h.label)}</b>${h.snippet ? `<span class="rdhitsnip">${h.snippet}</span>` : ''}</button></li>`).join('')}</ol>`;
  }
  const on = current(m).id;
  const btn = (p: CrPlace): string => `<button class="rdtocsec${p.id === on ? ' on' : ''}" aria-current="${p.id === on}" data-btn="crgo" data-to="${esc(p.id)}">${
    p.num ? `<span class="rdnum">${esc(p.num)}</span>` : ''}${esc(p.title)}</button>`;
  const out: string[] = [];
  let chapter: string | null = null;
  for (const p of m.places) {
    if (!p.chapter) {
      // a part on its own (the Introduction, Annex P, the glossary …): one entry at chapter level
      if (chapter !== null) out.push('</div>');
      chapter = null;
      out.push(`<div class="rdtoc rdtocone">${btn(p)}</div>`);
      continue;
    }
    if (p.chapter !== chapter) {
      if (chapter !== null) out.push('</div>');
      chapter = p.chapter;
      out.push(`<div class="rdtoc"><div class="rdtocchap">${esc(p.chapter)}</div>`);
    }
    out.push(btn(p));
  }
  if (chapter !== null) out.push('</div>');
  return out.join('');
}

/** The tab's two panes. Before the rules arrive: a line, and the generated page's link. */
export function crReaderHtml(fullEditionUrl: string): string {
  if (!model) {
    const line = failed
      ? `The rules did not load. <a href="${esc(fullEditionUrl)}" target="_blank" rel="noopener">Open them in a new tab ↗</a>`
      : 'Loading the rules…';
    return `<div class="rrsingle"><p class="rdwait">${line}</p></div>`;
  }
  return `<div class="rrsplit rdsplit">
    <aside class="rrnav">
      <input id="rules-q" class="rulesq" type="search" aria-label="Search the rules" spellcheck="false" autocomplete="off"
        placeholder="search, or a rule number" value="${esc(query)}">
      <div class="rrnavlist" id="cr-nav" data-scroll="cr-nav">${crNavListHtml()}</div>
    </aside>
    ${textHtml(model)}
  </div>`;
}

/** After a paint that followed a move: the text pane goes to the element
 * picked out (and lights it), or to its top; the contents keep the place in view. */
export function crAfterPaint(root: Pick<Document, 'getElementById' | 'querySelector'> | undefined = globalThis.document): void {
  if (!pendingScroll || !root?.getElementById) return;
  const pane = root.getElementById('cr-text');
  if (!pane) return;
  pendingScroll = false;
  const el = at ? root.getElementById(at) ?? root.querySelector(`#cr-text [data-crt="${at.replace(/["\\]/g, '\\$&')}"]`) : null;
  if (el) {
    el.classList?.add('rd-at');
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  } else pane.scrollTop = 0;
  const on = root.querySelector('#cr-nav .rdtocsec.on') as HTMLElement | null;
  if (on && typeof on.scrollIntoView === 'function') on.scrollIntoView({ block: 'nearest' });
}

/** the reader's buttons: crgo (data-to) and crback. True when it was ours. */
export function handleCrButton(btn: { dataset: Record<string, string | undefined> }): boolean {
  const b = btn.dataset['btn'];
  if (b === 'crgo') { goTo(btn.dataset['to'] ?? ''); return true; }
  if (b === 'crback') { goBack(); return true; }
  return false;
}

/** the search box's Enter: a rule number goes straight there */
export function crEnter(): boolean {
  const t = query.trim();
  if (!model || !RULE_NUM.test(t)) return false;
  if (!goTo(normNum(t))) return false;
  query = '';
  return true;
}
