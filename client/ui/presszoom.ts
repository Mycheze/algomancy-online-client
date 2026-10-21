/* PRESS TO READ A CARD — the gesture behind zoom.ts's press zoom (the tabletop
 * deck builder, owner 2026-10-21: *"Clicking and holding (or using the mouse
 * wheel to click down) should enlarge and zoom in on cards. Like normal
 * hovering does in game."*). Any element with `data-zoom` and a scan inside:
 *
 *  - MOUSE, LEFT BUTTON: press and hold still for HOLD_MS and the card's zoom
 *    comes up; let go and it goes. The release is not a click (a hold was a
 *    read, not a pin). Long enough that a quick click never flashes it.
 *  - MOUSE, MIDDLE BUTTON (the wheel): the zoom is up at once, for as long as
 *    it is held, and it follows the cursor onto the next card — run along a
 *    pile to read it. The browser's own middle press (Firefox's autoscroll,
 *    X11's primary-selection paste) is cancelled on these cards and nowhere
 *    else.
 *  - A FINGER: the tabletop's hold already lifts the card for a drag
 *    (ui/drag.ts `holdMs`, which is touch.ts's PEEK_MS). The zoom comes up on
 *    that same beat, clear of the finger (zoom.ts peekBox), as the game's own
 *    peek does: lift the finger and it goes, and the lift is not a tap (it
 *    does not pick the card up); move on and the card is carried.
 *
 * ⚠ THE ZOOM NEVER STANDS IN A DRAG'S WAY. It is pointer-inert, it moves
 * nothing, and the moment the press travels past the drag's own slop it goes
 * — here, and again in ui/drag.ts `begin()`, which lets it go whatever this
 * module thought. It never opens while `html.dragging`.
 *
 * The gesture is `pressGesture`, a state machine over plain event fields and
 * an injected clock and display, so test/542 walks it without a browser;
 * `installPressZoom` wires it to the document once.
 */
import { pressTarget, zoomPress, zoomPressEnd, zoomPressing } from './zoom.ts';
import { PEEK_MS, swallowNextClick } from './touch.ts';

/** how long a mouse rests on a card before the zoom comes up */
export const HOLD_MS = 320;
/** past this the press is a drag (or a swipe) and not a read — ui/drag.ts's slops */
const SLOP_MOUSE = 6;
const SLOP_TOUCH = 10;

/** what the gesture needs of the page: the display, the clock, the drag */
export interface PressIO {
  /** the zoomable card at an element, or null */
  target(el: Element | null): Element | null;
  /** the element under a point */
  under(x: number, y: number): Element | null;
  /** show the zoom (`at` = a finger's point); true when it went up */
  show(el: Element, at: { x: number; y: number } | undefined, animate: boolean): boolean;
  /** is it up? */
  showing(): boolean;
  end(): void;
  /** eat the click this release would produce */
  swallow(): void;
  /** a card is in the air (html.dragging) */
  dragging(): boolean;
  later(fn: () => void, ms: number): unknown;
  cancel(t: unknown): void;
}

/** the fields of a pointer event the gesture reads */
export interface PressEvent {
  pointerId: number; pointerType: string; button: number; buttons: number; isPrimary: boolean;
  clientX: number; clientY: number; target: EventTarget | null;
  preventDefault(): void;
}

interface Press {
  id: number; type: string; middle: boolean; x: number; y: number;
  el: Element; timer: unknown;
}

/** the press-to-read state machine (see the header) */
export function pressGesture(io: PressIO): {
  down(e: PressEvent): void; move(e: PressEvent): void; up(e: PressEvent): void; cancel(): void;
} {
  let p: Press | null = null;
  const stop = (): void => {
    if (p && p.timer !== null) io.cancel(p.timer);
    p = null;
    io.end();
  };
  return {
    down(e) {
      stop();
      if (!e.isPrimary || io.dragging()) return;
      const t = e.target as Element | null;
      // a tile's + and » are buttons, not the card
      if (t?.closest?.('button, input, select, textarea, a, summary')) return;
      const el = io.target(t);
      if (!el) return;
      const mouse = e.pointerType === 'mouse';
      if (mouse && e.button === 1) {
        e.preventDefault();
        p = { id: e.pointerId, type: e.pointerType, middle: true, x: e.clientX, y: e.clientY, el, timer: null };
        io.show(el, undefined, true);
        return;
      }
      if (mouse && e.button !== 0) return;
      const at = mouse ? undefined : { x: e.clientX, y: e.clientY };
      const mine: Press = { id: e.pointerId, type: e.pointerType, middle: false, x: e.clientX, y: e.clientY, el, timer: null };
      mine.timer = io.later(() => {
        mine.timer = null;
        if (p !== mine || io.dragging() || !el.isConnected) return;
        io.show(el, at, true);
      }, mouse ? HOLD_MS : PEEK_MS);
      p = mine;
    },
    move(e) {
      if (!p || e.pointerId !== p.id) return;
      if (p.middle) {
        // the wheel let go without a pointerup reaching us (it was released
        // over another window): nothing is held any more
        if (!(e.buttons & 4)) { stop(); return; }
        const t = io.target(io.under(e.clientX, e.clientY));
        if (t && t !== p.el) { p.el = t; io.show(t, undefined, false); }
        return;
      }
      const slop = p.type === 'mouse' ? SLOP_MOUSE : SLOP_TOUCH;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) >= slop) stop();
    },
    up(e) {
      if (!p || e.pointerId !== p.id) return;
      const read = !p.middle && io.showing();
      stop();
      if (read) io.swallow();
    },
    cancel: stop,
  };
}

let installed = false;

/** wire the gesture to the document — once; the tabletop asks on open */
export function installPressZoom(): void {
  if (installed || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  installed = true;
  const g = pressGesture({
    target: pressTarget,
    under: (x, y) => document.elementFromPoint(x, y),
    show: (el, at, animate) => {
      const up = zoomPress(el, at, animate);
      document.documentElement.classList.toggle('zoompress', up);
      return up;
    },
    showing: zoomPressing,
    end: () => { zoomPressEnd(); document.documentElement.classList.remove('zoompress'); },
    swallow: () => swallowNextClick(),
    dragging: () => document.documentElement.classList.contains('dragging'),
    later: (fn, ms) => setTimeout(fn, ms),
    cancel: t => clearTimeout(t as ReturnType<typeof setTimeout>),
  });
  // capture, and not passive: a middle press on a card is cancelled here
  document.addEventListener('pointerdown', e => g.down(e), { capture: true });
  document.addEventListener('pointermove', e => g.move(e), { capture: true, passive: true });
  document.addEventListener('pointerup', e => g.up(e), { capture: true, passive: true });
  document.addEventListener('pointercancel', () => g.cancel(), { capture: true, passive: true });
  if (typeof addEventListener === 'function') addEventListener('blur', () => g.cancel());
  document.addEventListener('visibilitychange', () => g.cancel());
  // the middle button's own effects, for a press that began on a card only:
  // Firefox's autoscroll starts on the mousedown; X11's primary-selection
  // paste comes with the release (Chrome fires a `paste` at the page even
  // with the press cancelled), and so does an auxclick — and the release may
  // land off the card, so the press is what counts, until just after it ends
  let onCard = 0;
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button === 1) onCard = pressTarget(e.target as Element | null) ? Infinity : 0;
  }, { capture: true, passive: true });
  document.addEventListener('pointerup', e => {
    if (e.pointerType === 'mouse' && e.button === 1 && onCard) onCard = Date.now() + 400;
  }, { capture: true, passive: true });
  const middle = (e: MouseEvent): void => {
    if (e.button === 1 && (Date.now() < onCard || pressTarget(e.target as Element | null))) e.preventDefault();
  };
  for (const t of ['mousedown', 'mouseup', 'auxclick'] as const) document.addEventListener(t, middle, { capture: true });
  document.addEventListener('paste', e => { if (Date.now() < onCard) e.preventDefault(); }, { capture: true });
}
