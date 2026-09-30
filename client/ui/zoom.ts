/* THE CARD ZOOM — the dock-style magnifier (owner, 2026-09-23).
 *
 * *"What if we tweaked the main way of looking at cards? Instead of relying on
 * the right hand panel … all cards are fairly small, but when you hover over
 * one, it blows up like the Mac apps bar … This could apply to ANYWHERE a card
 * is."* So a card under a mouse cursor grows, in place, to a readable size,
 * and the side rail stops following the hover and holds the last card you
 * CLICKED instead (main.ts, the `zoomOn()` branches).
 *
 * ── WHY A FLOATING COPY AND NOT `transform: scale` ON THE CARD ─────────────
 *
 * Every zone on the regions board clips (`overflow: hidden` is what keeps it
 * from ever scrolling), and so do the hand dock's row and the bin fan. A card
 * scaled where it stands would be cut off by the box it is in. The zoom is a
 * copy of the card on one fixed layer above everything, drawn at its zoomed
 * WIDTH — so the scan and its badges are laid out, not magnified, and stay
 * sharp — and animated out of the card's own box (a FLIP: start at the
 * card's rect, end at the zoomed one).
 *
 * The layer is `pointer-events: none` and the copy carries no `data-*`
 * attributes: the click still lands on the real card underneath the cursor,
 * and nothing that looks cards up by `data-anim`, `data-act` or `data-id`
 * (ui/anim.ts flights, the click delegator, the arrows) can find the copy.
 *
 * A finger never gets a zoom (the caller asks `pointerCanHover`, as for the
 * long-hover box): on touch the tap is the preview, in the rail.
 */
import { layoutV2 } from './layout.ts';

/** is the zoom the way cards are read in this browser? For now it rides with
 * the regions board preference: that is the layout being playtested, and the
 * classic board keeps its hover-follows rail until the owner says otherwise. */
export function zoomOn(): boolean { return layoutV2(); }

/** the width a zoomed card is drawn at, and the least magnification worth a
 * zoom — a card already this big (a dialog's, the draft pack's) is left alone */
export const ZOOM_W = 240;
/** the touch peek's width, when the screen has it (see peekBox) */
export const PEEK_W = 340;
const MIN_GAIN = 1.3;
const MARGIN = 8;

export interface Rect { left: number; top: number; width: number; height: number }

/**
 * Where the zoomed copy goes: `width` wide, keeping the card's aspect,
 * centred on the card and then pushed inside the viewport — so a hand card at
 * the bottom of the screen grows UP, the way a dock icon does, and a card at
 * the top edge grows down. Null when zooming would not make it meaningfully
 * bigger. Pure, so test/322 can pin it without a browser.
 *
 * `extraH` is what hangs below the card, as a fraction of the card's own
 * height — the mod strips (round 4, owner 2026-09-26: "that mod should peek out
 * under the card"). The CARD is still what is centred on the source; the strips
 * only count when the whole copy is pushed inside the window, so a modded unit
 * in the bottom row rises far enough to show them. The returned height is the
 * whole copy's.
 */
export function zoomBox(card: Rect, view: { w: number; h: number }, target = ZOOM_W, extraH = 0): Rect | null {
  if (!(card.width > 0 && card.height > 0)) return null;
  const aspect = card.height / card.width;
  const tall = aspect * (1 + Math.max(0, extraH));
  let width = target;
  // never taller than the window, strips included
  const maxH = view.h - 2 * MARGIN;
  if (width * tall > maxH) width = maxH / tall;
  if (width < card.width * MIN_GAIN) return null;
  const cardH = width * aspect, height = width * tall;
  const cx = card.left + card.width / 2, cy = card.top + card.height / 2;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  return {
    left: clamp(cx - width / 2, MARGIN, view.w - width - MARGIN),
    top: clamp(cy - cardH / 2, MARGIN, view.h - height - MARGIN),
    width, height,
  };
}

/**
 * Where a card's menu goes while its card is held zoomed (round 4, owner
 * 2026-09-26: "the zoom gets in the way of the menu … it'd be much better UX
 * for the menu to be on top and the card to be frozen big"). The menu opens
 * at the click, which is on the card, which is under the zoom — so: at the
 * click if that is clear of the zoom, else beside the zoom (right, then left),
 * level with the click. With no room on either side it stays where it is; the
 * menu outranks the zoom layer, so it is still on top. Pure, for test/322.
 */
/**
 * THE PEEK'S BOX (touch, 2026-09-27). A finger cannot hover, so on a touch
 * screen the zoom opens on a press-and-hold instead (ui/touch.ts) — and the
 * finger is ON the card, so a copy centred on the card (zoomBox) would sit
 * under the hand reading it. The peek goes clear of the touch point: above it
 * when there is room (the hand dock is at the bottom, where most peeks start),
 * else below, else beside it — and it is bigger than the mouse's zoom, since
 * it is the only way a finger reads a card and it is up only while held.
 * `null` when the card is already that big (nothing to gain) or not a card.
 */
export function peekBox(card: Rect, view: { w: number; h: number }, at: { x: number; y: number },
  extraH = 0): Rect | null {
  if (!(card.width > 0 && card.height > 0)) return null;
  const aspect = card.height / card.width;
  const tall = aspect * (1 + Math.max(0, extraH));
  const GAP = 24;
  let width = Math.min(PEEK_W, view.w * 0.46);
  // the tallest that fits in the bigger of the two bands, above or below the finger
  const band = Math.max(at.y - GAP - MARGIN, view.h - at.y - GAP - MARGIN, (view.h - 2 * MARGIN) * 0.6);
  if (width * tall > band) width = band / tall;
  if (width < card.width * MIN_GAIN) return null;
  const height = width * tall;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const left0 = clamp(at.x - width / 2, MARGIN, view.w - width - MARGIN);
  if (at.y - GAP - height >= MARGIN) return { left: left0, top: at.y - GAP - height, width, height };
  if (at.y + GAP + height <= view.h - MARGIN) return { left: left0, top: at.y + GAP, width, height };
  // neither band holds it: stand beside the finger, on the roomier side
  const top = clamp(at.y - height / 2, MARGIN, view.h - height - MARGIN);
  const right = at.x + GAP, left = at.x - GAP - width;
  return { left: view.w - right >= at.x ? clamp(right, MARGIN, view.w - width - MARGIN) : clamp(left, MARGIN, view.w - width - MARGIN),
    top, width, height };
}

export function menuBeside(
  zoom: Rect, menu: { width: number; height: number }, view: { w: number; h: number },
  at: { x: number; y: number }, gap = 10,
): { left: number; top: number } {
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const top = clamp(at.y, MARGIN, view.h - menu.height - MARGIN);
  const fits = (left: number): boolean => left >= MARGIN && left + menu.width <= view.w - MARGIN;
  const clear = at.x >= zoom.left + zoom.width || at.x + menu.width <= zoom.left
    || top >= zoom.top + zoom.height || top + menu.height <= zoom.top;
  if (clear && fits(at.x)) return { left: at.x, top };
  const right = zoom.left + zoom.width + gap;
  if (fits(right)) return { left: right, top };
  const left = zoom.left - gap - menu.width;
  if (fits(left)) return { left, top };
  return { left: clamp(at.x, MARGIN, view.w - menu.width - MARGIN), top };
}

/** the card-shaped things a zoom may pick up: a scan with a picture */
const CARDISH = '.card, .rescard, .stackcard';

/** the card box a hover target belongs to, or null — a card name in the log
 * or a mod badge carries `data-prev` too, but has no picture to magnify.
 * Duck-typed on `closest`/`querySelector` so test/322 can hand it a stub. */
export function zoomTarget(el: Element | null): HTMLElement | null {
  const c = el?.closest?.(CARDISH) as HTMLElement | null;
  if (!c || !c.querySelector('img')) return null;
  // inside the zoom layer itself, or a hidden face-down back: nothing to read
  if (c.closest('#cardzoom')) return null;
  // an info block's resources get the resource window instead (ui/ressum.ts):
  // how many and how much mana, not the art (owner, 2026-09-26)
  if (c.closest('.linfo .lres')) return null;
  return c;
}

let layer: HTMLElement | null = null;
let source: HTMLElement | null = null;
let shown: Rect | null = null;
let lastX = -1, lastY = -1;
/** held: a menu is open on the zoomed card, and the copy stays exactly as it
 * is until the menu closes — see zoomHold */
let held = false;
let wantHold = false;

/**
 * What main.ts adds to a copy: the mod strips under a unit, the full list of
 * its markers as dice on the art. zoom.ts knows no game state, so main.ts
 * registers this. It is handed the SOURCE, because the copy has already had
 * every `data-*` stripped and those are how a card is looked up. It returns
 * the height it hung below the card, as a fraction of the card's height.
 */
export type ZoomDecorator = (source: HTMLElement, copy: HTMLElement) => { extraH?: number } | void;
let decorate: ZoomDecorator | null = null;
export function setZoomDecorator(fn: ZoomDecorator | null): void { decorate = fn; }

function ensureLayer(): HTMLElement {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement('div');
  layer.id = 'cardzoom';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  return layer;
}

/** a copy with nothing anything else can find it by */
export function inertCopy(el: HTMLElement): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement;
  for (const n of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
    n.removeAttribute('id');
    for (const a of [...n.attributes]) if (a.name.startsWith('data-')) n.removeAttribute(a.name);
    n.removeAttribute('title');
  }
  // a card caught mid-flight (ui/motion.ts FLIP) carries its inversion inline;
  // the copy must not inherit it, or it is drawn where the card WAS
  for (const k of ['transform', 'transition', 'opacity', 'visibility', 'animation']) copy.style.removeProperty(k);
  return copy;
}

const reduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** zoom the card at `el` (or drop the zoom when it is not a card) */
export function zoomAt(el: Element | null, animate = true): void {
  if (held) return;
  show(zoomTarget(el), animate);
}

function show(card: HTMLElement | null, animate: boolean, at?: { x: number; y: number }): void {
  if (!card) { drop(); return; }
  if (card === source && layer?.firstChild) return;
  const r = card.getBoundingClientRect();
  const copy = inertCopy(card);
  copy.classList.add('zoomcopy');
  const extraH = decorate?.(card, copy)?.extraH ?? 0;
  const view = { w: innerWidth, h: innerHeight };
  const box = at ? peekBox(r, view, at, extraH) : zoomBox(r, view, ZOOM_W, extraH);
  if (!box) { drop(); return; }
  const host = ensureLayer();
  Object.assign(copy.style, {
    position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`,
    margin: '0', transformOrigin: '0 0',
  });
  host.replaceChildren(copy);
  // what a decorator hangs BELOW the copy (a stack card's caption: the zoom is
  // drawn over the strip's own) is only measurable once laid out — lift the
  // copy by whatever of it would fall off the bottom of the window
  const hang = copy.querySelector<HTMLElement>('.zoomhang');
  if (hang) {
    const low = box.top + hang.offsetTop + hang.offsetHeight - (view.h - MARGIN);
    if (low > 0) {
      box.top = Math.max(MARGIN, box.top - low);
      copy.style.top = `${box.top}px`;
    }
  }
  source = card;
  shown = box;
  if (!animate || reduced()) return;
  // FLIP: start as the card itself, then let go
  const s = r.width / box.width;
  copy.style.transform = `translate(${r.left - box.left}px, ${r.top - box.top}px) scale(${s})`;
  copy.style.opacity = '0.6';
  void copy.offsetWidth;
  copy.style.transition = 'transform 140ms cubic-bezier(.2,.8,.3,1), opacity 100ms linear';
  copy.style.transform = 'none';
  copy.style.opacity = '1';
}

function drop(): void {
  source = null;
  shown = null;
  if (layer) layer.replaceChildren();
}

/** drop the zoom — unless it is held for an open menu (the cursor leaving the
 * window or a scroll inside the menu must not take the card away) */
export function zoomOff(): void { if (!held) drop(); }

/** the zoomed copy's box, or null when nothing is zoomed */
export function zoomRect(): Rect | null { return layer?.firstChild ? shown : null; }

/** is the copy held for a menu right now? */
export function zoomHeld(): boolean { return held && !!layer?.firstChild; }

/**
 * Round 4, owner 2026-09-26: *"You hover a thing to recycle it, click it, then
 * the menu appears. You can then move your mouse wherever and it stays zoomed
 * and with the menu open until you select something (or click off somewhere
 * else to reset the view)."*
 *
 * main.ts says after every paint whether a menu is open. Only the EDGE counts:
 * a menu opening while a card is zoomed holds that card; a menu opened with
 * nothing zoomed (the ☰ table menu) holds nothing, and a card hovered while
 * it is open is not frozen by the next paint. The menu closing lets go, and
 * the zoom goes straight to whatever is under the cursor now.
 */
export function zoomHold(on: boolean): void {
  if (on === wantHold) return;
  wantHold = on;
  held = on && !!layer?.firstChild;
  if (!on) zoomCheck();
}

/** the cursor, for re-zooming after a paint without an event to go on */
export function zoomNotePointer(x: number, y: number): void { lastX = x; lastY = y; }

/**
 * THE ZOOM FOLLOWS THE POINTER, NOT THE EVENT HISTORY (round 4, owner
 * 2026-09-26: "the zoomed in card can stay and getting rid of it is weird").
 *
 * `mouseover` fires only when the cursor crosses into a new element. A card
 * that moves out from under a still cursor fires nothing — measured on the
 * draft: a click in the tucked hand dock repaints, the dock tucks back down,
 * and the copy stayed over a card that had slid away, through a 2px nudge of
 * the mouse and until the cursor happened to cross some other element's edge.
 *
 * So whenever something may have moved — a pointer move, a paint, a relayout,
 * a beat after a paint — ask the page what is under the cursor, and if it is
 * not the zoomed card, zoom that instead (or nothing). Only while a copy is
 * up: a card sliding under a cursor that was zooming nothing stays unzoomed,
 * as it always did.
 */
export function zoomCheck(): void {
  if (held || !layer?.firstChild || lastX < 0) return;
  if (typeof document.elementFromPoint !== 'function') return;
  const hit = zoomTarget(document.elementFromPoint(lastX, lastY));
  if (hit && hit === source && source.isConnected) return;
  source = null;
  show(hit, false);
}

let settle: ReturnType<typeof setTimeout> | null = null;

/**
 * After a repaint: the card that was zoomed has been replaced by a new
 * element (every paint rebuilds the board). Zoom whatever is under the cursor
 * NOW, without the grow animation — the same card in the same place reads as
 * nothing having happened, which is R272's rule for the hover box too — and
 * look again once the paint's flights and transitions have settled.
 */
export function zoomAfterPaint(): void {
  if (held || !layer?.firstChild) return;
  zoomCheck();
  if (settle !== null) clearTimeout(settle);
  settle = setTimeout(() => { settle = null; zoomCheck(); }, 320);
}

/** the card the finger is holding for a peek, or null */
let peeking: HTMLElement | null = null;

/**
 * Open the peek on the card under a held finger (ui/touch.ts): the same copy,
 * decorator and rings as the mouse's zoom, placed clear of the finger
 * (peekBox) and HELD — a synthesised mouseover, a repaint or a scroll must not
 * take it away while the finger is still down. Any card with a face, the
 * info block's resources included (a mouse gets the resource window there; a
 * finger asked about one card). True when a copy went up.
 */
export function zoomPeek(el: Element | null, at: { x: number; y: number }): boolean {
  const c = el?.closest?.(CARDISH) as HTMLElement | null;
  if (!c || !c.querySelector('img') || c.closest('#cardzoom')) return false;
  held = false;
  drop();
  show(c, true, at);
  if (!layer?.firstChild) return false;
  peeking = c;
  held = true;
  return true;
}

/** is a peek up right now? */
export function zoomPeeking(): boolean { return peeking !== null; }

/** the finger lifted (or the gesture became a drag): let the peek go */
export function zoomPeekEnd(): void {
  if (!peeking) return;
  peeking = null;
  held = false;
  drop();
}
