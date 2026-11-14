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

/** the pick screen's own divider (ui/splitter.ts): not the builder's, whose pool wants less */
export const PACK_SPLIT_KEY = 'algoCubePackSplit';

/* THE PACK FIRST (owner, MTGO): the band opens tall enough to show the whole pack — in two
 * rows (one, for a pack that fits a row), its tiles made smaller where a row would not
 * hold half of it — and the picks take the rest. The numbers are the page's own
 * (57-cube-draft.css, 52-builder.css, the frame): measured at 1440×900 and 1024×768. */
/** the frame's toolbar and foot bar, the divider */
const FRAME_H = 106, DIVIDER_H = 24;
/** the pack's bar, its results' padding (top 2, bottom 12, sides 12) and gap, and a little slack
 * so a rounding never puts a scrollbar on a pack that fits */
const BAR_H = 39, PAD_V = 14, PAD_H = 24, GAP = 6, SLACK = 4;
/** the results' thin scrollbar: the columns are counted as if it were there and the rows
 * measured as if it were not, so neither state (with it, without it) tips into the other */
const SCROLLBAR = 10;
/** a pack card's widest (57-cube-draft.css --pw), the picks' least share */
const TILE_W = 168, TILE_W_NARROW = 132, TABLE_MIN = 180;
const SPLIT_LO = 0.12, SPLIT_HI = 0.75;

export interface PackFit {
  /** the tile's least width (the grid's --pw) */
  pw: number;
  cols: number;
  rows: number;
  /** the band's share of the pack and the picks together (the divider's --pool-f) */
  split: number;
}

/** How the band shows a pack of `size` in a `w`×`h` window: every card at once. Pure. */
export function packFit(size: number, w: number, h: number): PackFit {
  const n = Math.max(1, size);
  const width = w - PAD_H, narrow = width - SCROLLBAR;
  const span = h - FRAME_H - DIVIDER_H;
  const most = w <= 1100 ? TILE_W_NARROW : TILE_W;
  const colsAt = (pw: number): number => Math.max(1, Math.floor((narrow + GAP) / (pw + GAP)));
  const rows = n <= colsAt(most) ? 1 : 2;
  const need = Math.ceil(n / rows);
  let pw = need <= colsAt(most) ? most : Math.floor((narrow - (need - 1) * GAP) / need);
  const band = (p: number): number => {
    const cols = colsAt(p);
    const tileH = ((width - (cols - 1) * GAP) / cols) * 1000 / 720;
    return BAR_H + PAD_V + SLACK + rows * tileH + (rows - 1) * GAP;
  };
  // a short window: smaller tiles before the picks lose their last card's height
  while (pw > 60 && band(pw) > span - TABLE_MIN) pw -= 4;
  const split = Math.round(Math.max(SPLIT_LO, Math.min(SPLIT_HI, band(pw) / span)) * 1000) / 1000;
  return { pw, cols: colsAt(pw), rows, split };
}

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
  /** the pack's share of the screen: the player's, else what shows the whole pack */
  split: number;
  /** the pack's tiles' least width, so the whole pack shows (packFit) */
  pw: number;
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
  const w = typeof innerWidth === 'number' ? innerWidth : 1200;
  const h = typeof innerHeight === 'number' ? innerHeight : 800;
  const fit = packFit(d?.packSize ?? d?.pack?.length ?? 15, w, h);
  const split = readSplit(PACK_SPLIT_KEY) ?? fit.split;
  const paneH = Math.max(120, Math.round((h - 130) * (1 - split)) - 60);
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
    pw: fit.pw,
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

/** the pack band's scroll key: one per pick, so a new pack is never shown scrolled */
export const packScrollKey = (v: Pick<CubeDraftPageView, 'packNo' | 'pickNo'>): string => `cd-pack-${v.packNo ?? 0}-${v.pickNo ?? 0}`;

/** the pack band: its bar (what to do, the count, Confirm) and the cards — or the wait */
function packHtml(v: CubeDraftPageView): string {
  const urgent = v.msLeft !== null && v.msLeft <= URGENT_MS;
  const bar = seatsHtml(v) + (v.pack
    ? `<span class="ttpoolcount">${v.pack.length} card${v.pack.length === 1 ? '' : 's'}</span>`
      + button({ label: 'Confirm pick', variant: 'primary', size: 'sm', dataBtn: 'cd-confirm', className: 'cdconfirm',
        disabled: !v.reserved || !!v.taken })
    : '');
  const body = v.pack
    ? `<div class="ttpoolgrid cdgrid" style="--pw:${v.pw}px">${v.pack.map(n => tileHtml(v, n, urgent)).join('')}</div>`
    : emptyState({ bare: true, className: 'cdwaiting',
      title: v.packNo === null ? 'The draft is over' : 'Waiting for the next pack',
      text: v.packNo === null ? 'Your deck is next.' : 'It shows here the moment it reaches you.' });
  return `<section class="ttpool cdpack" data-cd-zone="pack" aria-label="The pack">`
    + `<div class="ttpoolbar cdpackbar">${bar}</div>`
    // the scroll is kept per pick: a new pack (or the next pick) opens at its top
    + `<div class="ttpoolresults" data-scroll="${packScrollKey(v)}">${body}</div></section>`;
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
  const main = `<div class="ttbuilder cdbuilder" style="--pool-f:${v.split}" data-split-key="${PACK_SPLIT_KEY}">${packHtml(v)}${DIVIDER}`
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
