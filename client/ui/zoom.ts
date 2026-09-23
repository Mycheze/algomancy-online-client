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
const MIN_GAIN = 1.3;
const MARGIN = 8;

export interface Rect { left: number; top: number; width: number; height: number }

/**
 * Where the zoomed copy goes: `width` wide, keeping the card's aspect,
 * centred on the card and then pushed inside the viewport — so a hand card at
 * the bottom of the screen grows UP, the way a dock icon does, and a card at
 * the top edge grows down. Null when zooming would not make it meaningfully
 * bigger. Pure, so test/322 can pin it without a browser.
 */
export function zoomBox(card: Rect, view: { w: number; h: number }, target = ZOOM_W): Rect | null {
  if (!(card.width > 0 && card.height > 0)) return null;
  const aspect = card.height / card.width;
  let width = target;
  // never taller than the window
  const maxH = view.h - 2 * MARGIN;
  if (width * aspect > maxH) width = maxH / aspect;
  if (width < card.width * MIN_GAIN) return null;
  const height = width * aspect;
  const cx = card.left + card.width / 2, cy = card.top + card.height / 2;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  return {
    left: clamp(cx - width / 2, MARGIN, view.w - width - MARGIN),
    top: clamp(cy - height / 2, MARGIN, view.h - height - MARGIN),
    width, height,
  };
}

/** the card-shaped things a zoom may pick up: a scan with a picture */
const CARDISH = '.card, .rescard, .stackcard';

/** the card box a hover target belongs to, or null — a card name in the log
 * or a mod badge carries `data-prev` too, but has no picture to magnify */
export function zoomTarget(el: Element | null): HTMLElement | null {
  const c = el?.closest?.(CARDISH) as HTMLElement | null;
  if (!c || !c.querySelector('img')) return null;
  // inside the zoom layer itself, or a hidden face-down back: nothing to read
  if (c.closest('#cardzoom')) return null;
  return c;
}

let layer: HTMLElement | null = null;
let source: HTMLElement | null = null;
let lastX = -1, lastY = -1;

function ensureLayer(): HTMLElement {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement('div');
  layer.id = 'cardzoom';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  return layer;
}

/** a copy with nothing anything else can find it by */
function inertCopy(el: HTMLElement): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement;
  for (const n of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
    n.removeAttribute('id');
    for (const a of [...n.attributes]) if (a.name.startsWith('data-')) n.removeAttribute(a.name);
    n.removeAttribute('title');
  }
  return copy;
}

const reduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** zoom the card at `el` (or drop the zoom when it is not a card) */
export function zoomAt(el: Element | null, animate = true): void {
  const card = zoomTarget(el);
  if (card === source && layer?.firstChild) return;
  if (!card) { zoomOff(); return; }
  const r = card.getBoundingClientRect();
  const box = zoomBox(r, { w: innerWidth, h: innerHeight });
  if (!box) { zoomOff(); return; }
  const host = ensureLayer();
  const copy = inertCopy(card);
  copy.classList.add('zoomcopy');
  Object.assign(copy.style, {
    position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`,
    margin: '0', transformOrigin: '0 0',
  });
  host.replaceChildren(copy);
  source = card;
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

export function zoomOff(): void {
  source = null;
  if (layer) layer.replaceChildren();
}

/** the cursor, for re-zooming after a paint without an event to go on */
export function zoomNotePointer(x: number, y: number): void { lastX = x; lastY = y; }

/**
 * After a repaint: the card that was zoomed has been replaced by a new
 * element (every paint rebuilds the board). Zoom whatever is under the cursor
 * NOW, without the grow animation — the same card in the same place reads as
 * nothing having happened, which is R272's rule for the hover box too.
 */
export function zoomAfterPaint(): void {
  if (!source) return;
  if (source.isConnected) return;
  source = null;
  if (lastX < 0 || typeof document.elementFromPoint !== 'function') { zoomOff(); return; }
  zoomAt(document.elementFromPoint(lastX, lastY), false);
}
