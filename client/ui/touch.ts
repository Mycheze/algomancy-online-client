/*
 * THE FINGER'S ROUTES (2026-09-27, owner: "optimize the client for use on
 * mobile devices that have large-ish screens — an iPad or a foldable phone").
 *
 * Three small things a touch screen needs that a mouse never did, all wired
 * here and nowhere else:
 *
 *  1. `html.touch` — set by the first pointerdown whose pointerType is touch or
 *     pen. The stylesheet's TOUCH block keys off it: bigger tap targets, the
 *     keyboard hints ("(enter)", "(esc)") hidden, "tap" instead of "hover".
 *     THE EVENT, NOT THE DEVICE (main.ts pointerCanHover says why): never
 *     `matchMedia('(hover: none)')`, which headless Chrome answers "no hover"
 *     while delivering real mouse events. Sticky for the page's life — a
 *     laptop with a touch screen that gets one tap keeps the bigger buttons
 *     rather than having the layout jump under the cursor on every switch.
 *  2. `swallowNextClick` — a gesture that turned out to be a peek or a drag
 *     still ends in a `click` on whatever was under the pointer, and main.ts's
 *     click listeners (the bare-click "close the menu and repaint", the rail
 *     pin) would act on it. One click, captured at the window before anything
 *     else sees it, within a short window so a missing click (a long press
 *     often sends none) cannot eat the NEXT real tap.
 *  3. the tucked hand dock (BL-32) opened only on `:hover`, which a finger has
 *     not got: a tap on its label opens it until the next paint.
 *  4. THE PEEK. On the regions board the zoom is the main way to read a card
 *     (owner, 2026-09-23), and it is a mouse effect. A tap on a playable card
 *     PLAYED it (until #201, see 5), so a finger had no way to read one
 *     without acting. Press and
 *     hold (PEEK_MS without moving) opens the zoom, clear of the finger
 *     (zoom.ts peekBox), until the finger lifts — and the lift is swallowed,
 *     so a peek never plays anything. Moving on from a peek into a drag is
 *     ui/drag.ts's business; it ends the peek when it starts.
 *  5. A TAP ONLY READS (report #201, owner, 2026-10-08, filed "gamebreaking":
 *     "the game forced me to play my card in battle when I was just trying to
 *     look at it"). On touch a tap on a card in your hand or cache no longer
 *     plays it: main.ts hands it to `tapRead`, which opens the same zoom as the
 *     peek and leaves it up after the finger lifts. The NEXT tap anywhere puts
 *     it away and is swallowed — the lift handler below already does exactly
 *     that for a peek — and Escape puts it away too. Playing from the hand on
 *     touch is a drag (ui/drag.ts), or the rail's buttons.
 */
import { zoomPeek, zoomPeekEnd, zoomPeeking } from './zoom.ts';

/** how long a finger rests on a card before it is a peek and not a tap */
export const PEEK_MS = 380;
/** how far it may wander meanwhile */
const PEEK_SLOP = 10;

/** has this page seen a finger (or a pen)? */
export function touchSeen(): boolean {
  return typeof document !== 'undefined' && !!document.documentElement?.classList?.contains?.('touch');
}

let swallowUntil = 0;

/** eat the click the current gesture is about to produce (see 2 above) */
export function swallowNextClick(ms = 450): void {
  swallowUntil = Date.now() + ms;
}

export interface TouchDeps {
  /** a tap on the 🔒 full-control chip: the Ctrl key a tablet has not got */
  toggleFullControl(): void;
  /** a held finger on an info block's resources: the resource window
   * (ui/ressum.ts), as a mouse gets on hover. False when `el` is not one. */
  peekResources(el: Element): boolean;
  peekResourcesEnd(): void;
}

let peekTimer: ReturnType<typeof setTimeout> | null = null;
let peekFrom: { id: number; x: number; y: number } | null = null;
let resPeek = false;

function peekCancel(): void {
  if (peekTimer !== null) clearTimeout(peekTimer);
  peekTimer = null;
  peekFrom = null;
}

/** is a finger holding a peek open (the card zoom or the resource window)? */
export function peekUp(): boolean { return zoomPeeking() || resPeek; }

let endResPeek: (() => void) | null = null;
/** let a peek go without the lift — ui/drag.ts, when the held finger moves on
 * into a drag */
export function peekEnd(): void {
  peekCancel();
  zoomPeekEnd();
  if (resPeek) { resPeek = false; endResPeek?.(); }
}

/** #201: a tap on a card that would otherwise have played it opens the zoom
 * to read it, held until the next tap (see 5 above). True when a copy went up. */
export function tapRead(el: Element | null, at: { x: number; y: number }): boolean {
  peekCancel();
  return zoomPeek(el, at);
}

export function installTouch(deps: TouchDeps): void {
  // A TABLET SHOULD NOT OPEN IN THE DESKTOP LOOK and change under the first
  // tap (the compact rail is keyed off html.touch — owner, 2026-09-27: the
  // compact view is for the iPad, a computer keeps its own). A PRIMARY pointer
  // that is coarse is a finger-first device: an iPad, a phone. A laptop with a
  // touch screen answers "fine" (its mouse or trackpad is primary) and gets
  // the class only from an actual touch, as before. This is the one place the
  // DEVICE is asked, and only for layout — every behaviour still gates on the
  // event (main.ts pointerCanHover).
  if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) {
    document.documentElement?.classList?.add('touch');
  }
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') document.documentElement.classList.add('touch');
  }, { passive: true, capture: true });

  // ── 4. the peek ──
  endResPeek = deps.peekResourcesEnd;
  document.addEventListener('pointerdown', e => {
    peekCancel();
    if (e.pointerType === 'mouse' || !e.isPrimary) return;
    const target = e.target as Element | null;
    const card = target?.closest?.('.card, .rescard, .stackcard');
    if (!card || card.closest('#cardzoom') || !card.querySelector('img')) return;
    peekFrom = { id: e.pointerId, x: e.clientX, y: e.clientY };
    const at = { x: e.clientX, y: e.clientY };
    peekTimer = setTimeout(() => {
      peekTimer = null;
      if (!card.isConnected) return;
      const up = deps.peekResources(card) ? (resPeek = true) : zoomPeek(card, at);
      if (up) navigator.vibrate?.(8);
    }, PEEK_MS);
  }, { passive: true });
  document.addEventListener('pointermove', e => {
    if (!peekFrom || e.pointerId !== peekFrom.id || peekTimer === null) return;
    if (Math.hypot(e.clientX - peekFrom.x, e.clientY - peekFrom.y) > PEEK_SLOP) peekCancel();
  }, { passive: true });
  const lift = (e: PointerEvent): void => {
    if (peekFrom && e.pointerId !== peekFrom.id) return;
    const was = peekUp();
    peekEnd();
    // the lift of a peek is not a tap: nothing under it may act
    if (was && e.type === 'pointerup') swallowNextClick();
  };
  document.addEventListener('pointerup', lift, { passive: true });
  document.addEventListener('pointercancel', lift, { passive: true });
  // Android Chrome turns a long press into a contextmenu (~500ms): the card
  // menu main.ts would open. While the peek holds the card, the press is the
  // peek's; the card menu is still in the rail (railMenuHtml).
  window.addEventListener('contextmenu', e => {
    if (peekUp() || peekTimer !== null) { e.preventDefault(); e.stopPropagation(); }
  }, { capture: true });

  // the window's capture phase runs before the document's, so this sees the
  // click ahead of every listener main.ts has
  window.addEventListener('click', e => {
    if (Date.now() < swallowUntil) {
      swallowUntil = 0;
      e.stopPropagation();
      e.preventDefault();
    }
  }, { capture: true });

  // the narrow board's rail drawer (style.css "NARROW"): the ☰ tab and the
  // scrim are #app's own pseudo-elements, so a click on either lands on #app
  // itself — and the only other way to hit #app bare is its 8px grid gap
  document.addEventListener('click', e => {
    const app = document.getElementById('app');
    if (!app || e.target !== app || !app.classList.contains('v2')) return;
    const root = document.documentElement;
    const tab = getComputedStyle(app, '::before');
    if (tab.content === 'none' || tab.content === 'normal') return;   // wide: no drawer
    const open = root.classList.contains('railopen');
    // the tab sits 8px in from the top right when shut, beside the drawer when open
    const tabRight = open ? innerWidth - Math.min(300, innerWidth * 0.86) - 8 : innerWidth - 8;
    const onTab = e.clientY >= 8 && e.clientY <= 42 && e.clientX <= tabRight && e.clientX >= tabRight - 42;
    if (onTab || open) {
      root.classList.toggle('railopen', !open);
      e.stopPropagation();
    }
  }, { capture: true });
  window.addEventListener('keydown', e => {
    // #201: a card held open by a tap goes away on Escape, before anything else
    // Escape would close
    if (e.key === 'Escape' && zoomPeeking()) {
      peekEnd();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Escape' && document.documentElement.classList.contains('railopen')) {
      document.documentElement.classList.remove('railopen');
      e.stopPropagation();
    }
  }, { capture: true });

  document.addEventListener('click', e => {
    const t = e.target as HTMLElement | null;
    // the tucked dock's label: open it where it is, no repaint (a repaint is
    // what tucks it again, and is also what the bare-click listener would do)
    const label = t?.closest?.('.handdock.tucked > .zonelabel');
    if (label) {
      label.parentElement!.classList.toggle('open');
      e.stopPropagation();
      return;
    }
    // CT-183 made full control a key you HOLD, and the chip only its readout.
    // A tablet has no Ctrl, so on a touch screen the chip is the switch — the
    // same setFullControl the key drives, released the same ways (the window
    // losing focus, the page hiding).
    if (touchSeen() && t?.closest?.('[data-chip="fullcontrol"]')) {
      deps.toggleFullControl();
      e.stopPropagation();
    }
  }, { capture: true });

  // a card scan must never start the browser's own image drag (a mouse) or
  // its save-image sheet (a long press) — the peek and ui/drag.ts own both
  document.addEventListener('dragstart', e => {
    if ((e.target as Element | null)?.closest?.('.card, .rescard, .stackcard, .handdock')) e.preventDefault();
  });
}
