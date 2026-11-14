/* THE PICK SCREEN — a cube event's draft (docs/25 §4, §10). Owner,
 * 2026-11-14: *"basically the deck building UI, but instead of the full card
 * list above, it's just the pack you're currently looking at … UI should
 * basically be like MTGO"* — and, after a whole draft: *"The deck area should
 * also already have the 'sideboard' and 'maybeboard' areas … you should be
 * able to freely drag cards around in your deck area during the draft"*.
 *
 *   [‹ Event] Pack 2 · Pick 5  Passing right                0:42 | Undo Redo Stats | Rules Alerts Report
 *   ──────────────────────────────────────────────────────────────────────────────────────────────────
 *   THE PACK: the table — Ann ● ← Bot 1 ●● ← You ● ← …          13 cards  [Confirm pick]
 *   ┌────┐┌────┐┌────┐ …  the pack's cards; the chosen one ringed
 *   ═══════════════ ▲ ▬ ▼ the divider (ui/splitter.ts, the builder's) ═══════════════
 *   THE DECK TABLE (pages/table.ts — the builder's own): Main deck · + Pile · Re-sort │ Sideboard n/7, Maybe
 *
 * So the screen IS the builder (pages/builder.ts) with the pack in the pool
 * band's place: ui/cubedraft.ts is a tabletop host (ui/tabletop.ts) whose
 * `band` is this module's `cubePackHtml`, and every move on the table is the
 * builder's own. The root's classes are `ttpage cdpage` (cdpage last:
 * report.ts names the page by it).
 *
 * The pack: a tap on a card chooses it (`cd-card`), a second tap or Confirm
 * (`cd-confirm`) takes it, and a card dragged onto the table is taken
 * (ui/cubedraft.ts's drag provider: the tile is `data-cd-card`). Hold, or
 * press the wheel, on any card to read it (`data-zoom`).
 *
 * THE BAND'S HEIGHT IS THE PLAYER'S (owner: *"Resizing the deck window also
 * felt awkward and like the client was trying to resize or force you"*). The
 * first time, it opens tall enough for the whole pack (`packFit`); once the
 * divider is moved, its share is stored (PACK_SPLIT_KEY) and nothing changes
 * it again — not a repaint, not a new pack, not a smaller pack (the first
 * time is at most FIRST_SPLIT_MAX: the deck table needs room). The tiles fit
 * themselves to the band the player chose (`tileFit`: the largest that show the
 * whole pack in it, in any number of rows), by the pack's size at the deal, so
 * they keep their size for the whole round — and follow the divider and the
 * window (the controller's beat redraws the band when its tile size moves).
 *
 * The clock is drawn here; ui/cubedraft.ts's one interval rewrites its text in
 * place (`.cdclock`). The seats strip, the title and the band are patched in
 * place by the controller too (`cubeSeatsHtml`, `cubeDraftTitleHtml`,
 * `cubePackHtml`): a push from another player's pick rebuilds none of the rest.
 *
 * Pure (pages/README.md): cubeDraftView gathers, the …Html functions draw.
 */
import type { CubeSeatView, CubeView } from '../../server/cube-types.ts';
import { button, emptyState } from '../components/index.ts';
import { scanHtml } from '../piletable.ts';
import { readSplit } from '../splitter.ts';
import { esc } from '../util.ts';
import { builderHtml, type BuilderView } from './builder.ts';

/** the pick screen's own divider (ui/splitter.ts): not the builder's, whose pool wants less */
export const PACK_SPLIT_KEY = 'algoCubePackSplit';

/* THE FIRST-TIME SHARE (owner, MTGO): the band opens tall enough to show the whole pack — in two
 * rows (one, for a pack that fits a row), its tiles made smaller where a row would not
 * hold half of it — and the table takes the rest. The numbers are the page's own
 * (57-cube-draft.css, 52-builder.css, the frame): measured at 1440×900 and 1024×768. */
/** the frame's toolbar and foot bar, the divider */
const FRAME_H = 106, DIVIDER_H = 24;
/** the pack's bar, its results' padding (top 2, bottom 12, sides 12) and gap, and a little slack
 * so a rounding never puts a scrollbar on a pack that fits */
const BAR_H = 39, PAD_V = 14, PAD_H = 24, GAP = 6, SLACK = 4;
/** the results' thin scrollbar: the columns are counted as if it were there and the rows
 * measured as if it were not, so neither state (with it, without it) tips into the other */
const SCROLLBAR = 10;
/** a pack card's widest (57-cube-draft.css --pw), the table's least share */
const TILE_W = 168, TILE_W_NARROW = 132, TABLE_MIN = 180;
const SPLIT_LO = 0.12, SPLIT_HI = 0.75;
/** the first-time share's most: the deck table under the band holds piles, the Sideboard and
 *  Maybe now, and needs its room (the tiles fit themselves to the band, so the pack still shows whole) */
export const FIRST_SPLIT_MAX = 0.55;
/** the tiles the band the player chose may hold: the largest and the smallest */
const TILE_MAX = 240, TILE_MIN = 72;

export interface PackFit {
  /** the tile's least width (the grid's --pw) */
  pw: number;
  cols: number;
  rows: number;
  /** the band's share of the pack and the table together (the divider's --pool-f) */
  split: number;
}

const colsFor = (narrow: number, pw: number): number => Math.max(1, Math.floor((narrow + GAP) / (pw + GAP)));
/** a row's height at `cols` columns: the grid stretches its tiles to the width */
const rowH = (width: number, cols: number): number => ((width - (cols - 1) * GAP) / cols) * 1000 / 720;

/** How the band first shows a pack of `size` in a `w`×`h` window: every card at once. Pure. */
export function packFit(size: number, w: number, h: number): PackFit {
  const n = Math.max(1, size);
  const width = w - PAD_H, narrow = width - SCROLLBAR;
  const span = h - FRAME_H - DIVIDER_H;
  const most = w <= 1100 ? TILE_W_NARROW : TILE_W;
  const colsAt = (pw: number): number => colsFor(narrow, pw);
  const rows = n <= colsAt(most) ? 1 : 2;
  const need = Math.ceil(n / rows);
  let pw = need <= colsAt(most) ? most : Math.floor((narrow - (need - 1) * GAP) / need);
  const band = (p: number): number => BAR_H + PAD_V + SLACK + rows * rowH(width, colsAt(p)) + (rows - 1) * GAP;
  // a short window: smaller tiles before the table loses its last card's height
  while (pw > 60 && band(pw) > span - TABLE_MIN) pw -= 4;
  const split = Math.round(Math.max(SPLIT_LO, Math.min(SPLIT_HI, band(pw) / span)) * 1000) / 1000;
  return { pw, cols: colsAt(pw), rows, split };
}

/**
 * The tiles for a pack of `size` in a band `bandPx` tall in a window `w` wide: the LARGEST at which
 * the whole pack shows there, in as many rows as that takes, never bigger than TILE_MAX (the card
 * zoom's width) nor smaller than TILE_MIN (a band smaller than that scrolls). The tiles are drawn
 * at exactly this width (57-cube-draft.css: the grid's columns are `--pw`, not stretched to the
 * row), so what fits here is what shows. The band is the player's; only the tiles follow it. Pure.
 */
export function tileFit(size: number, w: number, bandPx: number): number {
  const n = Math.max(1, size);
  const narrow = w - PAD_H - SCROLLBAR;
  const room = bandPx - BAR_H - PAD_V - SLACK;
  for (let pw = TILE_MAX; pw > TILE_MIN; pw--) {
    const rows = Math.ceil(n / colsFor(narrow, pw));
    if (rows * (pw * 1000 / 720) + (rows - 1) * GAP <= room) return pw;
  }
  return TILE_MIN;
}

/** the band's height in px for a share of a `h`-tall window */
export const bandPx = (split: number, h: number): number => split * (h - FRAME_H - DIVIDER_H);

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
  /** the card chosen (mine, as I just tapped it or as the server has it) */
  reserved: string | null;
  /** the card just taken, waiting for the server to pass the pack on */
  taken: string | null;
  /** the suggestion, ringed once the clock is urgent */
  suggest: string | null;
  /** ms left on my pack's clock, by the server's time; null = no clock */
  msLeft: number | null;
  /** the pack's share of the screen: the player's, else what shows the whole pack */
  split: number;
  /** the pack's tiles' least width, fitted to the band */
  pw: number;
}

/** what the controller adds to the server's view */
export interface CubeDraftLocal {
  reserved: string | null;
  taken: string | null;
  /** the server's clock now (the client's, corrected for skew) */
  serverNow: number;
}

/** The view: the server's, my tap, the divider, the window. */
export function cubeDraftView(v: CubeView, local: CubeDraftLocal): CubeDraftPageView {
  const d = v.draft;
  const w = typeof innerWidth === 'number' ? innerWidth : 1200;
  const h = typeof innerHeight === 'number' ? innerHeight : 800;
  const size = d?.packSize ?? d?.pack?.length ?? 15;
  const split = readSplit(PACK_SPLIT_KEY) ?? Math.min(FIRST_SPLIT_MAX, packFit(size, w, h).split);
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
    split,
    pw: tileFit(size, w, bandPx(split, h)),
  };
}

const urgentOf = (v: Pick<CubeDraftPageView, 'msLeft'>): boolean => v.msLeft !== null && v.msLeft <= URGENT_MS;

/** the table strip: every seat in table order, the packs waiting at each as
 * dots, me lit, and the way the packs go between them */
export function cubeSeatsHtml(v: Pick<CubeDraftPageView, 'seats' | 'direction'>): string {
  if (!v.seats.length) return '';
  const arrow = `<li class="cdsep" aria-hidden="true">${v.direction === 'left' ? '→' : '←'}</li>`;
  const seat = (s: CubeSeatView): string => {
    const dots = Math.min(s.waiting, 5);
    const wait = `<span class="cdwait" aria-label="${s.waiting} waiting">${'<i class="cddot"></i>'.repeat(dots)}${s.waiting > 5 ? `+${s.waiting - 5}` : ''}</span>`;
    return `<li class="cdseat${s.me ? ' cdme' : ''}${s.bot ? ' cdbot' : ''}"><span class="cdseatname">${esc(s.me ? 'You' : s.name)}</span>${wait}</li>`;
  };
  return `<ol class="cdseats" aria-label="The table">${v.seats.map(seat).join(arrow)}</ol>`;
}

/** the card ringed as the clock's suggestion: urgent, and nothing chosen */
export const packHint = (v: Pick<CubeDraftPageView, 'msLeft' | 'reserved' | 'suggest'>): string | null =>
  urgentOf(v) && !v.reserved ? v.suggest : null;

/** Confirm is off: nothing chosen, or the card already taken */
export const confirmOff = (v: Pick<CubeDraftPageView, 'reserved' | 'taken'>): boolean => !v.reserved || !!v.taken;

/** one card of the pack */
function tileHtml(v: CubeDraftPageView, name: string, hint: string | null): string {
  const cls = `ttpooltile cdtile${name === v.reserved ? ' cdreserved' : ''}${name === v.taken ? ' cdtaken' : ''}${
    name === hint ? ' cdhint' : ''}`;
  return `<div class="${cls}" data-btn="cd-card" data-cd-card="${esc(name)}" data-card="${esc(name)}" data-zoom`
    + ` aria-pressed="${name === v.reserved ? 'true' : 'false'}">${scanHtml(name, 'ttart')}</div>`;
}

/** the pack band's scroll key: one per pick, so a new pack is never shown scrolled */
export const packScrollKey = (v: Pick<CubeDraftPageView, 'packNo' | 'pickNo'>): string => `cd-pack-${v.packNo ?? 0}-${v.pickNo ?? 0}`;

/** THE BAND: its bar (the table strip, the count, Confirm) and the pack's cards — or the wait. Pure. */
export function cubePackHtml(v: CubeDraftPageView): string {
  const hint = packHint(v);
  const bar = cubeSeatsHtml(v) + (v.pack
    ? `<span class="ttpoolcount">${v.pack.length} card${v.pack.length === 1 ? '' : 's'}</span>`
      + button({ label: 'Confirm pick', variant: 'primary', size: 'sm', dataBtn: 'cd-confirm', className: 'cdconfirm',
        disabled: confirmOff(v) })
    : '');
  // the wait says only that (owner: no filler line under it)
  const body = v.pack
    ? `<div class="ttpoolgrid cdgrid" style="--pw:${v.pw}px">${v.pack.map(n => tileHtml(v, n, hint)).join('')}</div>`
    : emptyState({ bare: true, className: 'cdwaiting', text: v.packNo === null ? 'The draft is over' : 'Waiting for the next pack' });
  return `<section class="ttpool cdpack" data-cd-zone="pack" aria-label="The pack">`
    + `<div class="ttpoolbar cdpackbar">${bar}</div>`
    // the scroll is kept per pick: a new pack (or the next pick) opens at its top
    + `<div class="ttpoolresults" data-scroll="${packScrollKey(v)}">${body}</div></section>`;
}

/** the toolbar's title: where in the draft, and which way the packs go. Pure. */
export function cubeDraftTitleHtml(v: Pick<CubeDraftPageView, 'packNo' | 'pickNo' | 'direction' | 'event'>): string {
  return v.packNo !== null && v.pickNo !== null
    ? `<span class="cdwhere">Pack ${v.packNo} · Pick ${v.pickNo}</span><small class="cddir">Passing ${v.direction}</small>`
    : `<span class="cdwhere">${esc(v.event)}</span>`;
}

/** the clock, in the toolbar: always there, empty while there is no pack (the tick fills it). Pure. */
export function cubeDraftClockHtml(v: Pick<CubeDraftPageView, 'msLeft'>): string {
  return `<span class="cdclock${urgentOf(v) ? ' cdurgent' : ''}" role="timer" aria-label="Time left">${v.msLeft !== null ? clockText(v.msLeft) : ''}</span>`;
}

/** what the deck table hands the pick screen: the builder's view, less what the screen draws itself */
export type CubeDraftTable = Omit<BuilderView, 'band' | 'titleHtml' | 'pageClass' | 'pool'>;

/** The pick screen: the builder (pages/builder.ts) with the pack for its band. Pure. */
export function cubeDraftHtml(v: CubeDraftPageView, table: CubeDraftTable): string {
  return builderHtml({
    ...table,
    pool: null,
    band: { html: cubePackHtml(v), split: v.split, splitKey: PACK_SPLIT_KEY, what: 'pack' },
    titleHtml: cubeDraftTitleHtml(v),
    hostToolsHtml: cubeDraftClockHtml(v) + table.hostToolsHtml,
    pageClass: 'cdpage',
  });
}
