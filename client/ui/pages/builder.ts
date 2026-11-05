/* THE BUILDER — one page for every deck you build, in the app frame (BL-65,
 * 2026-11-04; the approved design: var/records/bl65/design-pass-v1).
 *
 *   [‹ Decks] Ember Rush ✎ (30 cards · legal)      [host tools] Undo Redo Stats | Rules Alerts Report
 *   ──────────────────────────────────────────────────────────────────────────────────────────────────
 *   the note row (a refusal, "Tap where it goes.")
 *   THE POOL (pages/pool.ts): search · chips · More filters · Clear · Add to
 *   ═══════════════ ▲ ▬ ▼ the divider (ui/splitter.ts) ═══════════════
 *   THE TABLE (pages/table.ts): Main deck 30 · + Pile · Re-sort ▾ │ the rail: Sideboard n/7, Maybe
 *   the stats strip (pages/deckstats.ts, one button: the Stats sheet) — or the challenge's deck strip
 *
 * One window, no page scroll (frameHtml `fill` + `bleed`): the pool's grid and
 * the table scroll inside themselves. Every sheet is a side sheet (What's wrong,
 * Stats, More filters, a card's Details; the host's own: Deck info, Import).
 *
 * The controller is ui/tabletop.ts: it keeps the state, takes every `tt-`
 * click and every drop through its one door `place()`, and hands this page a
 * finished BuilderView. The root's LAST class is `ttpage` (ui/report.ts names
 * the page by it, and ui/tabletop.ts's drag provider claims cards inside it).
 */
import { button, chip, icon, iconButton, sheet } from '../components/index.ts';
import type { TablePill } from '../tabletop.ts';
import { noImgDrag } from '../piletable.ts';
import { esc } from '../util.ts';
import { caretIn, restoreCaret } from './caret.ts';
import { frameChromeView, frameHtml, paintFrame, type FrameChrome } from './frame.ts';
import { poolHtml, type PoolView } from './pool.ts';
import { tableHtml, type TableView } from './table.ts';

/** one of the builder's own sheets, its body already drawn */
export interface BuilderSheet {
  /** which (`data-tt-sheet` on the root: problems, stats, filters, syntax, details) */
  kind: string;
  title: string;
  bodyHtml: string;
  footerHtml?: string;
  width?: 'sm' | 'md' | 'lg';
}

/** what the table's head row offers */
export interface BuilderHead {
  /** "Main deck", "Scratch table" */
  label: string;
  count: number;
  /** + Pile and Re-sort ▾ */
  tools: boolean;
}

export interface BuilderView {
  title: string;
  /** the title's own button (Deck info) */
  titleBtn?: string;
  backLabel: string;
  /** the count pill; null = the host's legacy summary (`stripHtml`) */
  pill: TablePill | null;
  stripHtml: string;
  /** trusted: the host's own toolbar buttons */
  hostToolsHtml: string;
  canUndo: boolean;
  canRedo: boolean;
  /** the Stats tool and the stats strip (a constructed deck) */
  stats: boolean;
  /** the note row: why a move was refused, or what a picked card waits for */
  note: string | null;
  pool: PoolView | null;
  /** the pool's share of the builder (ui/splitter.ts) */
  split: number;
  head: BuilderHead | null;
  table: TableView;
  /** trusted: the stats strip (pages/deckstats.ts statsStripHtml), '' = none */
  statsStripHtml: string;
  sheet: BuilderSheet | null;
  /** trusted: the host's own open sheet, '' = none */
  hostSheetHtml: string;
  readOnly: boolean;
  chrome: FrameChrome;
}

/** The view: the controller's snapshot, and the toolbar's account and bell. */
export function builderView(base: Omit<BuilderView, 'chrome'>): BuilderView {
  return { ...base, chrome: frameChromeView() };
}

const TONE = { ok: 'success', warn: 'warning', bad: 'danger' } as const;

/** the name (a button when the host gives it one), then the count pill. The
 *  name is its own span so a long one is cut short with … and never runs
 *  under the pill (CT-520); decks.ts retypes that span as the name is edited */
function titleHtml(v: BuilderView): string {
  const name = v.titleBtn
    ? button({ labelHtml: `<span class="tttitlename">${esc(v.title)}</span>${icon('edit')}`, variant: 'ghost', dataBtn: v.titleBtn, className: 'tttitlebtn', title: 'Deck info' })
    : `<span class="tttitletext">${esc(v.title)}</span>`;
  let pill = '';
  if (v.pill) {
    pill = v.pill.problems.length
      ? button({ label: v.pill.text, size: 'sm', dataBtn: 'tt-problems', className: `ttpill ttpill--${v.pill.tone}`, title: 'What’s wrong' })
      : chip({ label: v.pill.text, tone: TONE[v.pill.tone], shape: 'pill', className: 'ttpill' });
  }
  return `${name}${pill}`;
}

/** the toolbar's own tools: the host's, then Undo, Redo, Stats */
function toolsHtml(v: BuilderView): string {
  if (v.readOnly) return v.hostToolsHtml;
  return v.hostToolsHtml
    + iconButton({ label: 'Undo', icon: 'undo', dataBtn: 'tt-undo', disabled: !v.canUndo, title: 'Undo (Ctrl+Z)' })
    + iconButton({ label: 'Redo', icon: 'redo', dataBtn: 'tt-redo', disabled: !v.canRedo, title: 'Redo (Ctrl+Shift+Z)' })
    + (v.stats ? iconButton({ label: 'Stats', icon: 'stats', dataBtn: 'tt-stats' }) : '');
}

/** the table's head: what is on it, + Pile, Re-sort.
 * It sits inside the table's region, whose bare felt is "a new pile at the
 * end" — so it is its own zone, `off`: a card dropped or tapped onto it lands
 * nowhere (a drag flies home, a picked card stays picked), never in a pile the
 * player did not ask for (CT-521) */
function headHtml(h: BuilderHead): string {
  const by = (v: string, label: string): string => button({ label, variant: 'ghost', size: 'sm', dataBtn: 'tt-resort', attrs: { 'data-tt-by': v } });
  return `<div class="tthead" data-tt-zone="off" data-btn="tt-to"><span class="ttheadlabel">${esc(h.label)}</span><b class="ttheadcount">${h.count}</b>${h.tools
    ? `<span class="ttheadtools">${button({ label: '+ Pile', size: 'sm', dataBtn: 'tt-addpile' })}<details class="ttresort"><summary>Re-sort ▾</summary>
      <div class="ttmenu">${by('cost', 'By cost')}${by('type', 'By type')}${by('element', 'By element')}</div></details></span>` : ''}</div>`;
}

/** the divider: ▲ (the pool smaller), the grip, ▼ (the pool bigger) */
const SPLITTER = `<div class="ttdivider">${button({ label: '▲', variant: 'ghost', size: 'sm', dataBtn: 'tt-split', attrs: { 'data-by': '-1', 'aria-label': 'Smaller pool' } })}`
  + '<span class="ttgripbar" data-tt-grip aria-hidden="true"></span>'
  + `${button({ label: '▼', variant: 'ghost', size: 'sm', dataBtn: 'tt-split', attrs: { 'data-by': '1', 'aria-label': 'Bigger pool' } })}</div>`;

/** The builder. Pure. */
export function builderHtml(v: BuilderView): string {
  const table = tableHtml({
    ...v.table,
    headHtml: v.head ? headHtml(v.head) : v.table.headHtml,
    footHtml: (v.table.footHtml ?? '') + (v.statsStripHtml
      ? `<div class="ttstatsstrip">${v.statsStripHtml}</div>` : ''),
  });
  const sheetHtml = v.sheet ? sheet({
    open: true, placement: 'side', width: v.sheet.width ?? 'md', title: v.sheet.title, bodyHtml: v.sheet.bodyHtml,
    footerHtml: v.sheet.footerHtml, dismissBtn: 'tt-sheet-close', className: 'ttsheet', attrs: { 'data-tt-sheet': v.sheet.kind },
  }) : '';
  const main = `<div class="ttbuilder${v.pool ? '' : ' ttnopool'}" style="--pool-f:${v.split}">`
    + (v.note ? `<div class="ttnote" role="status">${esc(v.note)}</div>` : '')
    + (v.pool ? poolHtml(v.pool) + SPLITTER : '')
    + table
    + `</div>${sheetHtml}${v.hostSheetHtml}`;
  return frameHtml({
    page: 'ttpage',
    title: v.title,
    titleHtml: v.pill ? titleHtml(v) : `${titleHtml(v)}<span class="ttsummary">${v.stripHtml}</span>`,
    back: { dataBtn: 'tt-close', label: v.backLabel, icon: 'back' },
    toolsHtml: toolsHtml(v),
    chrome: v.chrome,
    mainHtml: main,
    fill: true,
    bleed: true,
  });
}

/** While a reload's deck is still loading. Pure. */
export function builderLoadingHtml(chrome: FrameChrome): string {
  return frameHtml({
    page: 'ttpage', title: 'Deck', back: { dataBtn: 'tt-close', label: 'Back', icon: 'back' }, chrome,
    mainHtml: '<p class="hint ttloading">Setting out the table…</p>',
  });
}

/* ── painting ─────────────────────────────────────────────────────────── */

/** the text boxes a repaint carries the caret of: the pool's search, and the
 * host's Deck info name and description */
export const CARET_IDS = ['tt-q', 'dk-name', 'dk-desc'] as const;

/** put the card menu beside the card it is for: right of it, else left; kept
 * inside the window */
export function placeMenu(app: ParentNode): void {
  const menu = app.querySelector?.<HTMLElement>('.ttpop[data-tt-menu]');
  if (!menu || typeof innerWidth !== 'number') return;
  const key = menu.dataset['ttMenu'] ?? '';
  const quoted = key.replace(/["\\]/g, '\\$&');
  const at = key.startsWith('head|')
    ? app.querySelector?.<HTMLElement>(`[data-tt-head="${quoted.slice(5)}"]`)
    : app.querySelector?.<HTMLElement>(`[data-tt-src="${quoted}"]`);
  if (!at) return;
  const r = at.getBoundingClientRect();
  const w = menu.offsetWidth || 200, h = menu.offsetHeight || 260;
  const gap = 6;
  const left = r.right + gap + w <= innerWidth - 8 ? r.right + gap : Math.max(8, r.left - gap - w);
  const top = Math.max(8, Math.min(r.top, innerHeight - h - 8));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

/** Put the builder on screen: every scrolling region where it was, the caret
 * back in its box, the card menu beside its card. */
export function paintBuilder(app: HTMLElement, v: BuilderView): void {
  const caret = typeof document !== 'undefined' && document.activeElement ? caretIn(CARET_IDS) : null;
  // every <img never natively draggable: Firefox's own image drag broke v1 (ui/drag.ts)
  paintFrame(app, noImgDrag(builderHtml(v)));
  restoreCaret(caret);
  placeMenu(app);
}
