/* THE COMPREHENSIVE RULES, READ IN THE CLIENT (the rules reader's
 * Comprehensive rules tab, 2026-11-04).
 *
 * Owner, 2026-11-04: "the CR are really clunky to read and navigate as a
 * modal". Until then the tab framed the generated HTML page — one 3.8MB
 * document in an iframe inside a modal, every rule's provenance folded under
 * it, a second scrollbar inside the first. This draws the rules natively from
 * their data (server/main.ts serves the generated .json without its
 * provenance at CR_DATA_URL):
 *
 *   ┌ the contents / search ┐┌ one section at a time, at reading width ─────┐
 *   │ [search, or 608.2b]   ││ 6. Battle                                     │
 *   │ 1. Game Concepts      ││ 608. Combat Damage                            │
 *   │   100 General         ││ 608.1. …                                      │
 *   │   101 Golden Rules    ││ 608.1a. …  See rule 110.                      │
 *   │ …                     ││ ‹ 607 Blocking                 609 … ›        │
 *   └───────────────────────┘└───────────────────────────────────────────────┘
 *
 * A rule number in a rule's words, or in its "See rule", is a link; following
 * one keeps a Back step. `?rules=cr&at=608.2b` opens at that rule. The full
 * edition, with every rule's sources, is one link away in the reader's bar.
 *
 * The CR is the game's rules copy as generated (data/comprehensive-rules/):
 * nothing here rewords a rule. Pure: the state lives here, the drawing is a
 * function of it; ui/rules.ts draws the reader around it and wires the box.
 */
import { iconizeText } from './cardtext.ts';
import { esc } from './util.ts';
import { CR_DATA_URL } from './assets.ts';

export interface CrRule {
  num: string;
  title: string | null;
  section: string;
  sectionTitle: string;
  chapterTitle: string;
  parent: string;
  text: string;
  see: string[];
  examples: string[];
  engineDiffers: boolean;
  untested: boolean;
}
export interface CrGloss { term: string; text: string; see: string[] }
export interface CrData {
  edition: { name: string; effective: string };
  rules: CrRule[];
  annexD: CrRule[];
  glossary: CrGloss[];
}

export interface CrSection { num: string; title: string; chapter: string; rules: CrRule[] }
export interface CrModel {
  data: CrData;
  sections: CrSection[];
  bySection: Map<string, CrSection>;
  byNum: Map<string, CrRule>;
}

/** the glossary's place among the sections (its "number") */
export const GLOSSARY = 'glossary';

/** Index the data: sections in document order (the rules, then Annex D, then the glossary). */
export function buildModel(data: CrData): CrModel {
  const sections: CrSection[] = [];
  const bySection = new Map<string, CrSection>();
  const byNum = new Map<string, CrRule>();
  for (const r of [...data.rules, ...data.annexD]) {
    byNum.set(r.num, r);
    let s = bySection.get(r.section);
    if (!s) {
      s = { num: r.section, title: r.sectionTitle, chapter: r.chapterTitle, rules: [] };
      bySection.set(r.section, s);
      sections.push(s);
    }
    s.rules.push(r);
  }
  const g: CrSection = { num: GLOSSARY, title: 'Glossary', chapter: 'Glossary', rules: [] };
  sections.push(g);
  bySection.set(GLOSSARY, g);
  return { data, sections, bySection, byNum };
}

/* ── the state ─────────────────────────────────────────────────────────── */

let model: CrModel | null = null;
let loading = false;
let failed = false;
/** the section on screen (null: the first) */
let view: string | null = null;
/** the rule picked out on screen, or null */
let at: string | null = null;
/** where Back goes: the places left, newest last */
const history: { view: string; at: string | null }[] = [];
/** the search box's text */
let query = '';
/** set by a move: after the next paint the text pane goes to the rule (or the top) */
let pendingScroll = false;
const repaints = new Set<() => void>();

/** the host's repaint, called when the rules arrive (the help layer, the board) */
export function onCrChange(fn: () => void): void { repaints.add(fn); }
const changed = (): void => { for (const fn of repaints) fn(); };
/** ask the hosts to repaint (a move made outside a click: Enter in the search box) */
export const crChanged = (): void => changed();

/** Ask for the rules once. A failure is a line in the reader, with the full edition's link. */
export function loadCr(fetcher: typeof fetch | undefined = globalThis.fetch): void {
  if (model || loading || !fetcher) return;
  loading = true;
  failed = false;
  void fetcher(CR_DATA_URL)
    .then(r => (r.ok ? r.json() as Promise<CrData> : Promise.reject(new Error(String(r.status)))))
    .then(d => { model = buildModel(d); })
    .catch(() => { failed = true; })
    .finally(() => { loading = false; if (at) goTo(at, false); changed(); });
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
  if (to) goTo(to.replace(/^r/i, ''), false);
}

/** Go to a rule, a section or the glossary; `remember` keeps a Back step. */
export function goTo(to: string, remember = true): boolean {
  const target = to.trim();
  if (!model) { at = target; return false; }
  const here = { view: view ?? model.sections[0]!.num, at };
  if (model.bySection.has(target)) {
    if (remember && (here.view !== target || here.at)) history.push(here);
    view = target; at = null;
  } else {
    const r = model.byNum.get(target);
    if (!r) return false;
    if (remember && here.at !== target) history.push(here);
    view = r.section; at = r.num;
  }
  if (history.length > 50) history.shift();
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

/** the section on screen */
function current(m: CrModel): CrSection {
  return m.bySection.get(view ?? '') ?? m.sections[0]!;
}

/* ── the search ────────────────────────────────────────────────────────── */

const RULE_NUM = /^(?:\d{3}(?:\.\d+[a-z]?)?|d\d+(?:\.\d+[a-z]?)?)$/i;

export interface CrHit { to: string; num: string; label: string; snippet: string }

const words = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(w => w.length > 1);

/** A rule number first (exact, then the rules under it), then every rule and
 * glossary term holding all the words, in document order. */
export function crSearch(m: CrModel, q: string, limit = 60): CrHit[] {
  const t = q.trim();
  if (!t) return [];
  const out: CrHit[] = [];
  const seen = new Set<string>();
  const push = (h: CrHit): void => { if (!seen.has(h.to) && out.length < limit) { seen.add(h.to); out.push(h); } };
  if (RULE_NUM.test(t)) {
    const n = t.toUpperCase().startsWith('D') ? `D${t.slice(1)}` : t;
    const sec = m.bySection.get(n);
    if (sec) push({ to: sec.num, num: sec.num, label: sec.title, snippet: '' });
    const r = m.byNum.get(n);
    if (r) push({ to: r.num, num: r.num, label: r.sectionTitle, snippet: snippet(r.text, []) });
    for (const x of [...m.data.rules, ...m.data.annexD]) {
      if (x.num.startsWith(n) && x.num !== n) push({ to: x.num, num: x.num, label: x.sectionTitle, snippet: snippet(x.text, []) });
    }
    if (out.length) return out;
  }
  const ws = words(t);
  if (!ws.length) return out;
  for (const g of m.data.glossary) {
    const hay = `${g.term} ${g.text}`.toLowerCase();
    if (ws.every(w => hay.includes(w))) {
      const first = g.see[0];
      push({ to: first && m.byNum.has(first) ? first : first && m.bySection.has(first) ? first : GLOSSARY, num: 'Glossary', label: g.term, snippet: snippet(g.text, ws) });
    }
  }
  for (const r of [...m.data.rules, ...m.data.annexD]) {
    const hay = `${r.title ?? ''} ${r.text} ${r.examples.join(' ')}`.toLowerCase();
    if (ws.every(w => hay.includes(w))) push({ to: r.num, num: r.num, label: r.title ?? r.sectionTitle, snippet: snippet(r.text, ws) });
  }
  return out;
}

/** a line around the first word found, the words marked */
function snippet(text: string, ws: string[]): string {
  const flat = text.replace(/\s+/g, ' ');
  const lc = flat.toLowerCase();
  const at = ws.length ? Math.max(0, Math.min(...ws.map(w => { const i = lc.indexOf(w); return i < 0 ? Infinity : i; }))) : 0;
  const from = Math.max(0, (Number.isFinite(at) ? at : 0) - 40);
  const cut = flat.slice(from, from + 120);
  let html = esc((from > 0 ? '…' : '') + cut + (from + 120 < flat.length ? '…' : ''));
  for (const w of ws) html = html.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
  return html;
}

/* ── drawing ───────────────────────────────────────────────────────────── */

/** a rule number as a link, when it names a rule or a section there is */
function ruleLink(m: CrModel, n: string, label = n): string {
  return m.byNum.has(n) || m.bySection.has(n)
    ? `<button class="rdref" data-btn="crgo" data-to="${esc(n)}">${esc(label)}</button>`
    : esc(label);
}

/** A rule's words: the game's icons drawn, and every rule number in them a link.
 * A three-digit number counts only after "rule"/"rules"/"section", alone in
 * brackets ("(111)"), or with its dotted part (608.2b) — "100 life" is not a
 * rule. */
export function crTextHtml(m: CrModel, text: string): string {
  // iconizeText escapes the text itself, then draws the game's icons
  const html = iconizeText(text).replace(/\n/g, '<br>');
  return html.replace(/(\()?\b(?:(rules?|sections?) )?(D\d+(?:\.\d+[a-z]?)?|\d{3}\.\d+[a-z]?|\d{3})\b(?=(\))?)/g,
    (whole, open: string | undefined, word: string | undefined, n: string, close: string | undefined) => {
      const dotted = n.includes('.') || n.startsWith('D');
      // a bare section number counts after "rule" or alone in brackets: "(111)"
      if (!dotted && !word && !(open && close)) return whole;
      return `${open ?? ''}${word ? `${word} ` : ''}${ruleLink(m, n)}`;
    });
}

function seeHtml(m: CrModel, see: string[]): string {
  if (!see.length) return '';
  const links = see.map(n => ruleLink(m, n));
  return ` See rule${see.length > 1 ? 's' : ''} ${links.length > 1 ? `${links.slice(0, -1).join(', ')} and ${links[links.length - 1]}` : links[0]}.`;
}

function ruleHtml(m: CrModel, r: CrRule): string {
  const sub = r.parent !== r.section;
  const marks = (r.engineDiffers ? '<span class="rdmark rddiffers">This client differs</span>' : '')
    + (r.untested ? '<span class="rdmark">Untested</span>' : '');
  return `<article class="rdrule${sub ? ' sub' : ''}${r.num === at ? ' at' : ''}" id="cr-r-${esc(r.num)}">
    <p><span class="rdnum">${esc(r.num)}.</span> ${r.title ? `<b>${esc(r.title)}.</b> ` : ''}${crTextHtml(m, r.text)}${seeHtml(m, r.see)}</p>
    ${r.examples.map(e => `<p class="rdex"><span>Example:</span> ${crTextHtml(m, e)}</p>`).join('')}
    ${marks ? `<p class="rdmarks">${marks}</p>` : ''}
  </article>`;
}

function glossaryHtml(m: CrModel): string {
  return `<dl class="rdgloss">${m.data.glossary.map(g => `<dt id="cr-g-${esc(g.term)}">${esc(g.term)}</dt>
    <dd>${crTextHtml(m, g.text)}${seeHtml(m, g.see)}</dd>`).join('')}</dl>`;
}

/** the section on screen: where it sits, its rules, the way to its neighbours */
function textHtml(m: CrModel): string {
  const s = current(m);
  const i = m.sections.indexOf(s);
  const prev = m.sections[i - 1], next = m.sections[i + 1];
  const back = history[history.length - 1];
  const nav = (x: CrSection | undefined, dir: 'prev' | 'next'): string => x
    ? `<button class="rdstep ${dir}" data-btn="crgo" data-to="${esc(x.num)}"><span>${dir === 'prev' ? '‹ Previous' : 'Next ›'}</span>
        <b>${x.num === GLOSSARY ? '' : `${esc(x.num)}. `}${esc(x.title)}</b></button>`
    : '<span></span>';
  const first = i === 0;
  return `<div class="rdtext" id="cr-text" data-scroll="cr-text">
    <div class="rdpage">
      ${back ? `<button class="rdback" data-btn="crback">← Back to ${esc(back.at ?? (back.view === GLOSSARY ? 'the glossary' : back.view))}</button>` : ''}
      ${first ? `<div class="rdfront"><h1>Algomancy Comprehensive Rules</h1>
        <p>Unofficial. They describe this client's implementation of Algomancy, not Caleb Gannon's game: where they and the Manual disagree, the Manual is the game. ${esc(m.data.edition.name)}, effective ${esc(m.data.edition.effective)}.</p></div>` : ''}
      <div class="rdchap">${esc(s.chapter)}</div>
      <h2>${s.num === GLOSSARY ? '' : `<span class="rdnum">${esc(s.num)}.</span> `}${esc(s.title)}</h2>
      ${s.num === GLOSSARY ? glossaryHtml(m) : s.rules.map(r => ruleHtml(m, r)).join('')}
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
  const on = current(m).num;
  const chapters: { title: string; sections: CrSection[] }[] = [];
  for (const s of m.sections) {
    const last = chapters[chapters.length - 1];
    if (last && last.title === s.chapter) last.sections.push(s);
    else chapters.push({ title: s.chapter, sections: [s] });
  }
  return chapters.map(c => `<div class="rdtoc"><div class="rdtocchap">${esc(c.title)}</div>
    ${c.sections.map(s => `<button class="rdtocsec${s.num === on ? ' on' : ''}" data-btn="crgo" data-to="${esc(s.num)}">${
      s.num === GLOSSARY ? '' : `<span class="rdnum">${esc(s.num)}</span>`}${esc(s.title)}</button>`).join('')}</div>`).join('');
}

/** The tab's two panes. Before the rules arrive: a line, and the full edition. */
export function crReaderHtml(fullEditionUrl: string): string {
  if (!model) {
    const line = failed
      ? `The rules did not load. <a href="${esc(fullEditionUrl)}" target="_blank" rel="noopener">Open the full edition ↗</a>`
      : 'Loading the rules…';
    return `<div class="rrsingle"><p class="rdwait">${line}</p></div>`;
  }
  return `<div class="rrsplit rdsplit">
    <aside class="rrnav">
      <input id="rules-q" class="rulesq" type="search" spellcheck="false" autocomplete="off"
        placeholder="search, or a rule number" value="${esc(query)}">
      <div class="rrnavlist" id="cr-nav" data-scroll="cr-nav">${crNavListHtml()}</div>
    </aside>
    ${textHtml(model)}
  </div>`;
}

/** After a paint that followed a move: the text pane goes to the rule, or to
 * its top, and the contents keep the section in view. */
export function crAfterPaint(root: { getElementById?: (id: string) => HTMLElement | null } = globalThis.document): void {
  if (!pendingScroll || !root?.getElementById) return;
  const pane = root.getElementById('cr-text');
  if (!pane) return;
  pendingScroll = false;
  const rule = at ? root.getElementById(`cr-r-${at}`) : null;
  if (rule && typeof rule.scrollIntoView === 'function') rule.scrollIntoView({ block: 'center' });
  else pane.scrollTop = 0;
  const on = (root as Document).querySelector?.('#cr-nav .rdtocsec.on') as HTMLElement | null;
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
  const n = t.toUpperCase().startsWith('D') ? `D${t.slice(1)}` : t;
  if (!goTo(n)) return false;
  query = '';
  return true;
}
