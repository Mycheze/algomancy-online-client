/* THE PICK SCREEN — a cube event's draft (docs/25 §4, §10). Owner,
 * 2026-11-14: *"basically the deck building UI, but instead of the full card
 * list above, it's just the pack you're currently looking at … UI should
 * basically be like MTGO"*.
 *
 *   [‹ Event] Pack 2 · Pick 5  Passing right                                0:42 | Rules Alerts Report
 *   ───────────────────────────────────────────────────────────────────────────────────────────────
 *   THE PACK: the table — Ann ● ← Bot 1 ●● ← You ● ← …          13 cards  [Confirm pick]
 *   ┌────┐┌────┐┌────┐ …  the pack's cards, big; the chosen one ringed
 *   ═══════════════ ▲ ▬ ▼ the divider (ui/splitter.ts, the builder's) ═══════════════
 *   YOUR PICKS 12 · Tap a card, then Confirm, or drag it here.
 *   the picks in piles by cost (pages/table.ts), shown, not editable
 *
 * The table strip rides in the pack's bar, not the toolbar: eight seats do not
 * fit beside the title at 1024 wide, and it matters most while you wait.
 *
 * The builder's own layout and classes (the root carries `ttpage` for its
 * look; its LAST class is `cdpage`, which report.ts names the page by). A tap
 * on a card chooses it (`cd-card`), a second tap or Confirm (`cd-confirm`)
 * takes it, and a card dragged onto the picks is taken (ui/cubedraft.ts's
 * drag provider: the tile is `data-cd-card`, the picks are
 * `data-cd-zone="picks"`) — the drop is the same take as the click. Hold, or
 * press the wheel, on any card to read it (`data-zoom`).
 *
 * The clock is drawn here once; ui/cubedraft.ts's one interval rewrites its
 * text in place (`.cdclock`) and repaints when it turns urgent.
 *
 * Pure (pages/README.md): cubeDraftView gathers, cubeDraftHtml draws.
 */
import type { CubeSeatView, CubeView } from '../../server/cube-types.ts';
import { button, emptyState } from '../components/index.ts';
import { seedPiles } from '../deckarrange.ts';
import { cardHeight, cardWidth, scanHtml, stripOf, type PileView } from '../piletable.ts';
import { readSplit } from '../splitter.ts';
import { esc } from '../util.ts';
import { frameChromeView, frameHtml, type FrameChrome } from './frame.ts';
import { tableHtml, type TableView } from './table.ts';

/** a clock at or under this is urgent: red, and the suggestion is chosen for you */
export const URGENT_MS = 10_000;

/** "1:30", "0:07"; never below 0:00 */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface CubeDraftPageView {
  /** the event's name (the page's aria title) */
  event: string;
  /** null = the draft is over (or not begun) */
  packNo: number | null;
  pickNo: number | null;
  direction: 'left' | 'right';
  seats: CubeSeatView[];
  /** my current pack; null = waiting for one */
  pack: string[] | null;
  /** the card chosen (mine, as the server has it or as I just tapped it) */
  reserved: string | null;
  /** the card just taken, waiting for the server to pass the pack on */
  taken: string | null;
  /** the suggestion, ringed once the clock is urgent */
  suggest: string | null;
  /** ms left on my pack's clock, by the server's time; null = no clock */
  msLeft: number | null;
  picks: string[];
  table: TableView;
  /** the pack's share of the screen (the builder's divider) */
  split: number;
  chrome: FrameChrome;
}

/** what the controller adds to the server's view */
export interface CubeDraftLocal {
  reserved: string | null;
  taken: string | null;
  /** the server's clock now (the client's, corrected for skew) */
  serverNow: number;
}

/** the picks as piles by cost, shown and not editable */
function picksTable(picks: readonly string[], paneH: number, cw: number, ch: number): TableView {
  const piles: PileView[] = seedPiles(picks, 'cost').map(p => ({
    zone: `cdpile|${p.id}`, name: p.name, tap: { card: null },
    cards: p.cards.map((name, k) => ({ name, src: `pick|${p.id}|${k}|${name}` })),
    S: stripOf(p.cards.length, paneH, ch), ch,
  }));
  return {
    cw, ch, piles, newPiles: null, rail: null, scrollKey: 'cd-picks',
    zoneAttrs: { 'data-cd-zone': 'picks' },
  };
}

/** The view: the server's, my tap, the window's card size, the divider, the chrome. */
export function cubeDraftView(v: CubeView, local: CubeDraftLocal): CubeDraftPageView {
  const d = v.draft;
  const touch = typeof document !== 'undefined' && !!document.documentElement?.classList?.contains?.('touch');
  const cw = cardWidth({ touch, width: typeof innerWidth === 'number' ? innerWidth : 1200 });
  const ch = cardHeight(cw);
  const split = readSplit();
  const h = typeof innerHeight === 'number' ? innerHeight : 800;
  const paneH = Math.max(260, Math.round((h - 150) * (1 - split)) - 90);
  const picks = d?.picks ?? v.myPool ?? [];
  return {
    event: v.config.name,
    packNo: d ? d.packNo : null,
    pickNo: d ? d.pickNo : null,
    direction: d?.direction ?? 'left',
    seats: d?.seats ?? [],
    pack: d?.pack ?? null,
    reserved: local.reserved,
    taken: local.taken,
    suggest: d?.suggest ?? null,
    msLeft: d?.pack && d.deadline !== null ? d.deadline - local.serverNow : null,
    picks,
    table: picksTable(picks, paneH, cw, ch),
    split,
    chrome: frameChromeView(),
  };
}

/** the table strip: every seat in table order, the packs waiting at each as
 * dots, me lit, and the way the packs go between them */
function seatsHtml(v: CubeDraftPageView): string {
  if (!v.seats.length) return '';
  const arrow = `<li class="cdsep" aria-hidden="true">${v.direction === 'left' ? '→' : '←'}</li>`;
  const seat = (s: CubeSeatView): string => {
    const dots = Math.min(s.waiting, 5);
    const wait = `<span class="cdwait" aria-label="${s.waiting} waiting">${'<i class="cddot"></i>'.repeat(dots)}${s.waiting > 5 ? `+${s.waiting - 5}` : ''}</span>`;
    return `<li class="cdseat${s.me ? ' cdme' : ''}${s.bot ? ' cdbot' : ''}"><span class="cdseatname">${esc(s.me ? 'You' : s.name)}</span>${wait}</li>`;
  };
  return `<ol class="cdseats" aria-label="The table">${v.seats.map(seat).join(arrow)}</ol>`;
}

/** one card of the pack */
function tileHtml(v: CubeDraftPageView, name: string, urgent: boolean): string {
  const cls = `ttpooltile cdtile${name === v.reserved ? ' cdreserved' : ''}${name === v.taken ? ' cdtaken' : ''}${
    urgent && !v.reserved && name === v.suggest ? ' cdhint' : ''}`;
  return `<div class="${cls}" data-btn="cd-card" data-cd-card="${esc(name)}" data-card="${esc(name)}" data-zoom`
    + ` aria-pressed="${name === v.reserved ? 'true' : 'false'}">${scanHtml(name, 'ttart')}</div>`;
}

/** the pack band: its bar (what to do, the count, Confirm) and the cards — or the wait */
function packHtml(v: CubeDraftPageView): string {
  const urgent = v.msLeft !== null && v.msLeft <= URGENT_MS;
  const bar = seatsHtml(v) + (v.pack
    ? `<span class="ttpoolcount">${v.pack.length} card${v.pack.length === 1 ? '' : 's'}</span>`
      + button({ label: 'Confirm pick', variant: 'primary', size: 'sm', dataBtn: 'cd-confirm', className: 'cdconfirm',
        disabled: !v.reserved || !!v.taken })
    : '');
  const body = v.pack
    ? `<div class="ttpoolgrid cdgrid">${v.pack.map(n => tileHtml(v, n, urgent)).join('')}</div>`
    : emptyState({ bare: true, className: 'cdwaiting',
      title: v.packNo === null ? 'The draft is over' : 'Waiting for the next pack',
      text: v.packNo === null ? 'Your deck is next.' : 'It shows here the moment it reaches you.' });
  return `<section class="ttpool cdpack" data-cd-zone="pack" aria-label="The pack">`
    + `<div class="ttpoolbar cdpackbar">${bar}</div>`
    + `<div class="ttpoolresults" data-scroll="cd-pack">${body}</div></section>`;
}

/** the divider: ▲ (the pack smaller), the grip, ▼ (the pack bigger) */
const DIVIDER = `<div class="ttdivider">${button({ label: '▲', variant: 'ghost', size: 'sm', dataBtn: 'cd-split', attrs: { 'data-by': '-1', 'aria-label': 'Smaller pack' } })}`
  + '<span class="ttgripbar" data-tt-grip aria-hidden="true"></span>'
  + `${button({ label: '▼', variant: 'ghost', size: 'sm', dataBtn: 'cd-split', attrs: { 'data-by': '1', 'aria-label': 'Bigger pack' } })}</div>`;

/** The pick screen. Pure. */
export function cubeDraftHtml(v: CubeDraftPageView): string {
  const urgent = v.msLeft !== null && v.msLeft <= URGENT_MS;
  const where = v.packNo !== null && v.pickNo !== null
    ? `<span class="cdwhere">Pack ${v.packNo} · Pick ${v.pickNo}</span><small class="cddir">Passing ${v.direction}</small>`
    : `<span class="cdwhere">${esc(v.event)}</span>`;
  const clock = v.msLeft !== null
    ? `<span class="cdclock${urgent ? ' cdurgent' : ''}" role="timer" aria-label="Time left">${clockText(v.msLeft)}</span>` : '';
  const head = `<div class="tthead" data-cd-zone="picks"><span class="ttheadlabel">Your picks</span><b class="ttheadcount">${v.picks.length}</b>${
    v.pack ? '<span class="dim cdpickshint">Tap a card, then Confirm, or drag it here.</span>' : ''}</div>`;
  const main = `<div class="ttbuilder cdbuilder" style="--pool-f:${v.split}">${packHtml(v)}${DIVIDER}`
    + `${tableHtml({ ...v.table, headHtml: head })}</div>`;
  return frameHtml({
    page: 'ttpage cdpage',
    title: v.event,
    titleHtml: where,
    back: { dataBtn: 'cube-close', label: 'Event', icon: 'back' },
    toolsHtml: clock,
    chrome: v.chrome,
    mainHtml: main,
    fill: true,
    bleed: true,
  });
}
