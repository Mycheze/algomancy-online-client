/* THE RULES REVIEW PAGE: SEARCH.
 *
 * One box in the page's sticky bar: a rule number ("802.1", "D3") jumps
 * straight to it; words find rules, section and chapter titles, glossary
 * terms, Annex P findings and discrepancies, AND-ed, case-folded. A result is a
 * number and a snippet with the words marked; choosing one moves the page
 * there and flashes it (crreview.ts, through the host). "/" focuses the box
 * anywhere on the page, Escape clears it, ↑ ↓ Enter choose.
 *
 * THE BOX IS NEVER REPAINTED. `#app` is repainted with innerHTML (crreview's
 * own paint, the host's rerender), and a box inside it would lose what was
 * typed and its focus (439 §3 holds the page itself to no inputs). So the
 * box is ONE element made here, once, and crreview's paint leaves an empty
 * slot in the bar that `mountSearch` moves it into: the element survives every
 * repaint with its words, and gets its focus back if it had it.
 *
 * The index is built once per document, from the renderer's own HTML (the same
 * fragments the page paints), by `buildSearchIndex` — pure, like cranchor.ts,
 * so ui/test can drive it under node. ~1800 rules index in a few ms; a query
 * is one pass of `includes` over them.
 */
import { esc } from './util.ts';
import type { CrReviewDoc } from './crtypes.ts';
import { isReportOpen, reportJustSent } from './report.ts';
import { isComposerOpen, isSheetOpen } from './crlayer.ts';

export type CrHitKind = 'rule' | 'section' | 'chapter' | 'gloss' | 'finding' | 'disc';

/** one thing a search can land on */
export interface CrSearchEntry {
  kind: CrHitKind;
  /** where it lives, as a link the page's placer reads: `r802.1`, `ch6`,
   * `gloss:attr.swift`, `F-U01-2`, `D-U12-3` */
  at: string;
  /** what the result row leads with: a number or an id ('' for a chapter) */
  label: string;
  /** a section's or chapter's title, a glossary term, a finding's title */
  title: string;
  /** the words a snippet is cut from */
  text: string;
  /** other ids that land here: a finding's folded-in dupes, a discrepancy's "also filed as" */
  ids: string[];
  /** everything above, lower-cased, for the match */
  hay: string;
}

export interface CrSearchHit { e: CrSearchEntry; snippet: string }

/* ── the index: pure ─────────────────────────────────────────────────────── */

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
/** the text of a fragment of the renderer's html: tags out, entities back, spaces collapsed */
export const plain = (html: string): string =>
  html.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g, m => ENTITIES[m] ?? m).replace(/\s+/g, ' ').trim();

function entry(kind: CrHitKind, at: string, label: string, title: string, text: string, ids: string[] = []): CrSearchEntry {
  return { kind, at, label, title, text, ids, hay: `${label} ${ids.join(' ')} ${title} ${text}`.toLowerCase() };
}

/** every searchable thing in the document, in document order */
export function buildSearchIndex(doc: Pick<CrReviewDoc, 'toc' | 'parts' | 'disc'>): CrSearchEntry[] {
  const out: CrSearchEntry[] = [];
  const partById = new Map(doc.parts.map(p => [p.id, p]));
  const fromPart = (html: string): void => {
    // sections and rules, in the order they appear
    for (const m of html.matchAll(/<h3 id="r([^"]+)">([\s\S]*?)<\/h3>|<article class="rule[^"]*" id="r([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)) {
      if (m[1]) {
        out.push(entry('section', `r${m[1]}`, m[1], plain(m[2]!.replace(/<a class="num"[^>]*>[^<]*<\/a>/, '')), ''));
        continue;
      }
      const body = m[4]!;
      // the rule's words and its examples' words: never the fold (sources, tests)
      const rt = /<p class="rt">([\s\S]*?)<\/p>/.exec(body)?.[1] ?? '';
      const ex = [...body.matchAll(/<p class="ex">([\s\S]*?)<\/p>/g)].map(x => plain(x[1]!));
      const title = /<strong class="rtitle">([\s\S]*?)<\/strong>/.exec(rt)?.[1];
      const words = rt.replace(/<a class="num"[^>]*>[^<]*<\/a>/, '').replace(/<strong class="rtitle">[\s\S]*?<\/strong>/, '');
      out.push(entry('rule', `r${m[3]}`, m[3]!, title ? plain(title).replace(/\.$/, '') : '', [plain(words), ...ex].join(' ')));
    }
    // the glossary: a term and its pointer sentence
    for (const m of html.matchAll(/data-crt="gloss:([^"]+)"><dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd>/g)) {
      out.push(entry('gloss', `gloss:${m[1]}`, '', plain(m[2]!), plain(m[3]!)));
    }
    // Annex P's findings: one entry per divergence, its dupes' ids landing on it
    for (const m of html.matchAll(/<article class="fnd" id="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)) {
      const body = m[2]!;
      const ids = [...body.matchAll(/<span id="([^"]+)"><\/span>/g)].map(x => x[1]!);
      const title = /<p class="dh">[\s\S]*?<strong>([\s\S]*?)<\/strong>/.exec(body)?.[1] ?? '';
      const sum = /<details>[\s\S]*?<\/summary><p>([\s\S]*?)<\/p>/.exec(body)?.[1] ?? '';
      out.push(entry('finding', m[1]!, m[1]!, plain(title), plain(sum), ids));
    }
  };
  for (const e of doc.toc) {
    if (e.sections) {
      out.push(entry('chapter', e.id, '', e.title, ''));
      if (e.lead) fromPart(partById.get(e.lead)?.html ?? '');
      for (const s of e.sections) fromPart(partById.get(s.part)?.html ?? '');
    } else {
      out.push(entry('chapter', e.id, '', e.title, ''));
      fromPart(partById.get(e.id)?.html ?? '');
    }
  }
  for (const d of doc.disc) {
    const sum = /<\/p>\s*<p>([\s\S]*?)<\/p>/.exec(d.html)?.[1] ?? '';
    const ids = [...d.html.matchAll(/<span id="([^"]+)"><\/span>/g)].map(x => x[1]!);
    out.push(entry('disc', d.id, d.id, `rule ${d.rule}`, plain(sum), ids));
  }
  return out;
}

/** a rule or section number as typed: "802.1", "r802.1", "d3.1a", "608." → "802.1", "D3.1a", "608" */
export function asNumber(q: string): string | null {
  const m = /^r?(\d{3}|[dD]\d+)(\.\d+[a-z]{0,2})?\.?$/i.exec(q.trim());
  return m ? m[1]!.toUpperCase() + (m[2]?.toLowerCase() ?? '') : null;
}

/** the html of `text` with every occurrence of each word marked; all else escaped */
export function highlight(text: string, words: readonly string[]): string {
  const low = text.toLowerCase();
  const spans: [number, number][] = [];
  for (const w of words) {
    if (!w) continue;
    for (let i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + w.length)) spans.push([i, i + w.length]);
  }
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let out = '';
  let at = 0;
  for (const [s, e] of spans) {
    if (e <= at) continue;
    const from = Math.max(s, at);
    out += esc(text.slice(at, from)) + `<mark>${esc(text.slice(from, e))}</mark>`;
    at = e;
  }
  return out + esc(text.slice(at));
}

/** a window of `text` around the first word that occurs in it, as html */
export function snippet(text: string, words: readonly string[], width = 150): string {
  if (!text) return '';
  const low = text.toLowerCase();
  const first = words.map(w => low.indexOf(w)).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  let s = Math.max(0, first - Math.floor(width / 3));
  if (s > 0) { const sp = text.indexOf(' ', s); s = sp >= 0 && sp < first ? sp + 1 : s; }
  let e = Math.min(text.length, s + width);
  if (e < text.length) { const sp = text.lastIndexOf(' ', e); e = sp > first ? sp : e; }
  return `${s > 0 ? '…' : ''}${highlight(text.slice(s, e), words)}${e < text.length ? '…' : ''}`;
}

/**
 * The hits for a query, best first, at most `max`. A number finds itself and
 * the rules under it (802.1 finds 802.1a, not 802.10). Words must all occur;
 * an exact id or term, then a title, then the phrase, rank above the rest,
 * each tier in document order.
 */
export function searchIndex(index: readonly CrSearchEntry[], query: string, max = 50): { hits: CrSearchHit[]; total: number } {
  const q = query.trim();
  if (!q) return { hits: [], total: 0 };
  const num = asNumber(q);
  if (num) {
    const under = (l: string): boolean => l === num || (l.startsWith(num) && /^[.a-z]/.test(l.slice(num.length)));
    const found = index.filter(e => (e.kind === 'rule' || e.kind === 'section') && under(e.label))
      .sort((a, b) => Number(b.label === num) - Number(a.label === num));
    if (found.length) return { hits: found.slice(0, max).map(e => ({ e, snippet: snippet(e.title ? `${e.title}. ${e.text}` : e.text, []) })), total: found.length };
  }
  const low = q.toLowerCase();
  const words = low.split(/\s+/).filter(Boolean);
  const tiered: CrSearchEntry[][] = [[], [], [], []];
  for (const e of index) {
    if (!words.every(w => e.hay.includes(w))) continue;
    const t = e.label.toLowerCase() === low || e.ids.some(i => i.toLowerCase() === low) || e.title.toLowerCase() === low ? 0
      : words.every(w => e.title.toLowerCase().includes(w)) ? 1
        : e.text.toLowerCase().includes(low) ? 2 : 3;
    tiered[t]!.push(e);
  }
  const all = tiered.flat();
  return { hits: all.slice(0, max).map(e => ({ e, snippet: snippet(e.text, words) })), total: all.length };
}

/* ── the box: DOM ────────────────────────────────────────────────────────── */

export interface CrSearchHost {
  /** is the review page on screen? "/" is the page's only while it is */
  active(): boolean;
  /** the document, once it has arrived */
  doc(): CrReviewDoc | null;
  /** move the page to a link (`r802.1`, `gloss:…`, `F-U01-2`) and flash it;
   * `open` also unfolds what is there (a finding's details) */
  go(at: string, open: boolean): void;
}

let host: CrSearchHost | null = null;
let wrap: HTMLElement | null = null;
let input: HTMLInputElement | null = null;
let panel: HTMLElement | null = null;
let index: CrSearchEntry[] | null = null;
let indexOf: CrReviewDoc | null = null;
let hits: CrSearchHit[] = [];
let sel = 0;
/** the box had the focus when a repaint took it off the page */
let focused = false;
let debounce = 0;

const KIND: Record<CrHitKind, string> = {
  rule: '', section: 'section', chapter: 'part', gloss: 'glossary', finding: 'finding', disc: 'discrepancy',
};

function ensureIndex(): CrSearchEntry[] | null {
  const d = host?.doc() ?? null;
  if (!d) return null;
  if (indexOf !== d) { index = buildSearchIndex(d); indexOf = d; }
  return index;
}

function paintResults(): void {
  if (!panel || !input) return;
  const q = input.value.trim();
  if (!q) { panel.hidden = true; panel.innerHTML = ''; hits = []; return; }
  const ix = ensureIndex();
  if (!ix) { panel.hidden = false; panel.innerHTML = '<div class="crsnone">Loading the document…</div>'; return; }
  const r = searchIndex(ix, q);
  hits = r.hits;
  sel = Math.min(sel, Math.max(0, hits.length - 1));
  panel.hidden = false;
  panel.innerHTML = !hits.length ? '<div class="crsnone">Nothing matches.</div>'
    : hits.map((h, i) => `<button class="crsres${i === sel ? ' on' : ''}" data-crs="${i}" role="option" aria-selected="${i === sel}">`
      + `<span class="crslab">${esc(h.e.label)}${KIND[h.e.kind] ? `<span class="crskind">${KIND[h.e.kind]}</span>` : ''}</span>`
      + `<span class="crsbody">${h.e.title ? `<b>${highlight(h.e.title, q.toLowerCase().split(/\s+/))}</b> ` : ''}${h.snippet}</span></button>`).join('')
      + (r.total > hits.length ? `<div class="crsnone">${r.total - hits.length} more: add a word to narrow it.</div>` : '');
}

function choose(i: number): void {
  const h = hits[i];
  if (!h || !host) return;
  close(true);
  host.go(h.e.at, h.e.kind === 'finding');
}

/** fold the results away; `blur` also takes the focus off the box */
function close(blur: boolean): void {
  if (panel) { panel.hidden = true; }
  if (blur) { focused = false; input?.blur(); }
}

function make(): void {
  wrap = document.createElement('div');
  wrap.className = 'crsearch';
  wrap.setAttribute('role', 'search');
  input = document.createElement('input');
  input.type = 'search';
  input.className = 'crsinput';
  input.placeholder = 'Search the rules  ( / )';
  input.setAttribute('aria-label', 'Search the rules: a number, or words');
  input.autocomplete = 'off';
  input.spellcheck = false;
  panel = document.createElement('div');
  panel.className = 'crsresults';
  panel.setAttribute('role', 'listbox');
  panel.hidden = true;
  wrap.append(input, panel);

  input.addEventListener('focus', () => { focused = true; if (input?.value.trim()) paintResults(); });
  // a repaint that takes the box off the page blurs it too: that is not the reader leaving it
  input.addEventListener('blur', () => { if (wrap?.isConnected) focused = false; });
  input.addEventListener('input', () => {
    sel = 0;
    clearTimeout(debounce);
    debounce = window.setTimeout(paintResults, 60);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (input!.value) { input!.value = ''; paintResults(); } else close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!hits.length) return;
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
      paintResults();
      panel?.querySelector('.crsres.on')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounce);
      paintResults();
      choose(sel);
    }
  });
  // its own clicks: a result is not a page button, and main.ts never sees it
  panel.addEventListener('click', e => {
    const b = (e.target as HTMLElement | null)?.closest?.('[data-crs]') as HTMLElement | null;
    e.stopPropagation();
    if (b) choose(Number(b.dataset['crs']));
  });
  // the results fold away when the reader clicks anywhere else
  document.addEventListener('pointerdown', e => {
    if (wrap && !wrap.contains(e.target as Node)) close(false);
  }, { capture: true });
  document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || !host?.active() || !input?.isConnected) return;
    // CT-291: a dialog over the page has the keyboard — this page's own
    // comment sheet and composer (they capture only Escape), and the report
    // form (its own capture listener already stops page keys; asked here too
    // so the rule reads in one place)
    if (isReportOpen() || reportJustSent() || isComposerOpen() || isSheetOpen()) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    e.preventDefault();
    input.focus();
    input.select();
  });
}

export function setCrSearchHost(h: CrSearchHost): void { host = h; }

/** put the box into the bar's empty slot after a paint; the first call makes it */
export function mountSearch(slot: HTMLElement | null): void {
  if (!slot || typeof document === 'undefined') return;
  if (!wrap) make();
  slot.appendChild(wrap!);
  if (focused && document.activeElement !== input) input!.focus({ preventScroll: true });
}

/** the page closed: forget the results, keep nothing open */
export function resetSearch(): void {
  close(true);
  hits = [];
}
