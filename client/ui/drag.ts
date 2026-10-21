/*
 * DRAG TO PLAY (2026-09-27, owner: "I'd also like to integrate dragging as an
 * option for playing cards and building formations"). Mouse and finger alike,
 * on Pointer Events — not the HTML5 drag-and-drop API, which draws its own
 * ghost, has no touch story on older iPads, and fires no events at all while
 * the pointer is over a page element that did not opt in.
 *
 * THIS MODULE KNOWS NOTHING ABOUT THE GAME. It turns a press-move-release on a
 * source into three calls on a plan a PROVIDER hands it: what glows, what is
 * under the pointer, and what the drop does. main.ts is one provider and builds
 * every plan out of the functions the CLICKS call — one intent, two routes, the
 * same rule as cardMenuItems serving both the right-click and the rail — so a
 * drag can never do anything a click could not. The tabletop deck builder
 * (ui/tabletop.ts, 2026-10-21) is the other, under the same rule: its drops
 * are `place()`, the function its taps call.
 *
 * The gesture:
 *  - a press on a source that moves less than the slop is a click, and the
 *    click path runs untouched: nothing here fires until the slop is crossed;
 *  - past the slop the plan is asked for (null = not draggable right now, and
 *    the gesture is left to the browser), a ghost of the card follows the
 *    pointer and the targets glow;
 *  - the release drops on the zone under the pointer, or flies the ghost home
 *    when there is none (or the plan declines it). Escape, a cancelled
 *    pointer or the page hiding does the same. The click the release would
 *    produce is swallowed (ui/touch.ts).
 *
 * ⚠ THE PAGE MUST NOT BE REPAINTED UNDER A DRAG. render() rebuilds #app on
 * every server push, which would pull the source and every target out from
 * under the pointer. main.ts's render() asks `dragActive()` and defers the
 * paint to the end of the gesture (`ended`). The state still lands; the drop
 * is re-validated against it by the click route it calls. Off the board the
 * same holds for every painter a drag can meet (the tabletop, its binder) —
 * the queue poll repaints the page under it too.
 */
import { inertCopy, zoomPressEnd } from './zoom.ts';
import { swallowNextClick } from './touch.ts';

export interface DragPlan {
  /** every element that takes a drop, lit while the drag lasts. The tabletop
   * passes none: there, the only thing lit is the zone under the card */
  targets?: Element[];
  /** the drop zone for the element under the pointer (a target, or a wider
   * area that means one), or null for "not here" */
  zoneAt(el: Element | null): Element | null;
  /** drop onto `zone` with the pointer at x,y — false puts the card back */
  drop(zone: Element, x: number, y: number): boolean;
  /** the pointer moved (or the box under it scrolled): `zone` is what zoneAt
   * answered, null when the card is over nothing or the drag is over — the
   * plan's live preview (the tabletop opens a gap where the card will land) */
  over?(zone: Element | null, x: number, y: number): void;
}

export interface DragProvider {
  /** the drag source a press on `el` would pick up, before any legality —
   * cheap, called on every pointerdown. The FIRST provider to answer owns the
   * press, so two providers must never claim the same element. */
  sourceOf(el: Element): HTMLElement | null;
  /** the plan for dragging `src`, asked once the slop is crossed */
  plan(src: HTMLElement): DragPlan | null;
  /** a drag took the pointer: drop the hover effects */
  started(): void;
  /** it let go (dropped or not): paint whatever was deferred */
  ended(): void;
  /** the source again after a repaint replaced it (default: the same
   * data-act and indices under #app — see keyOf) */
  refind?(src: HTMLElement): HTMLElement | null;
  /** a finger (not a mouse) must rest this long without moving before the
   * press can lift: a page that SCROLLS under the finger needs the hold, or
   * every swipe would pick a card up (the tabletop; the board does not) */
  holdMs?: number;
  /** scroll when the card is carried to an edge: the window's, and the edge
   * of every scrolling box under the pointer (the tabletop's table pane, the
   * binder's grid, a sideways deck strip) */
  edgeScroll?: boolean;
  /** a MOUSE press lifts the card at once (`draglift`), before the slop — the
   * card comes up under the pointer the moment it is pressed */
  pressLift?: boolean;
}
/** the game's provider, as main.ts has always written it */
export type DragDeps = DragProvider;

/** how far a press must travel to be a drag and not a click */
const SLOP_MOUSE = 6;
const SLOP_TOUCH = 10;

interface Press {
  src: HTMLElement; key: string; id: number; x: number; y: number; type: string;
  /** who owns this press */
  prov: DragProvider;
  /** when it went down, and whether a finger has held still long enough to lift */
  at: number; held: boolean;
}

/** the source again after a repaint: the same data-act and indices (a push
 * can land between the press and the slop being crossed, and every paint
 * rebuilds the board) */
function keyOf(el: HTMLElement): string {
  return ['act', 'p', 'i', 'id'].map(k => el.dataset[k] === undefined ? '' : `[data-${k}="${CSS.escape(el.dataset[k]!)}"]`).join('');
}
interface Live {
  plan: DragPlan;
  prov: DragProvider;
  src: HTMLElement;
  id: number;
  ghost: HTMLElement;
  home: DOMRect;
  /** where on the card it was picked up, so it does not jump to the pointer */
  dx: number; dy: number;
  zone: Element | null;
}

let press: Press | null = null;
let live: Live | null = null;
let layer: HTMLElement | null = null;
/** every provider, the game's first; asked in order on a pointerdown */
const providers: DragProvider[] = [];
/** the hold's one-shot cue (a class and a buzz) — booked per press, never re-armed */
let holdTimer: ReturnType<typeof setTimeout> | null = null;

/** is a card being dragged right now? (render() defers its paint while so) */
export function dragActive(): boolean { return live !== null; }

function ensureLayer(): HTMLElement {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement('div');
  layer.id = 'draglayer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  return layer;
}

const reduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** a finger covers what it holds: lift the ghost above the touch point */
function lift(type: string, h: number): number { return type === 'mouse' ? 0 : h * 0.55; }

function place(l: Live, x: number, y: number, type: string): void {
  const left = x - l.dx, top = y - l.dy - lift(type, l.home.height);
  l.ghost.style.transform = `translate(${left}px, ${top}px) rotate(-2deg) scale(1.06)`;
}

function setZone(l: Live, zone: Element | null): void {
  if (zone === l.zone) return;
  l.zone?.classList.remove('dropover');
  zone?.classList.add('dropover');
  l.zone = zone;
}

function begin(p: Press, x: number, y: number): boolean {
  // a card held up to read (ui/presszoom.ts) goes the moment its press is a drag
  zoomPressEnd();
  if (!p.src.isConnected) {
    const again = p.prov.refind
      ? p.prov.refind(p.src)
      : p.key ? document.querySelector<HTMLElement>(`#app ${p.key}`) : null;
    if (!again) return false;
    p.src = again;
  }
  const deps = p.prov;
  const plan = deps.plan(p.src);
  if (!plan) return false;
  const home = p.src.getBoundingClientRect();
  const ghost = inertCopy(p.src);
  ghost.classList.add('dragghost');
  Object.assign(ghost.style, {
    position: 'fixed', left: '0', top: '0', margin: '0', width: `${home.width}px`,
    transformOrigin: '50% 50%',
  });
  ensureLayer().replaceChildren(ghost);
  live = { plan, prov: deps, src: p.src, id: p.id, ghost, home, dx: p.x - home.left, dy: p.y - home.top, zone: null };
  p.src.classList.add('dragsrc');
  for (const t of plan.targets ?? []) t.classList.add('droptarget');
  document.documentElement.classList.add('dragging');
  try { document.documentElement.setPointerCapture(p.id); } catch { /* the pointer is already gone */ }
  deps.started();
  place(live, x, y, p.type);
  return true;
}

/** take the drag down; `landed` = the drop was taken, so no flight home */
function finish(landed: boolean): void {
  const l = live;
  if (!l) return;
  live = null;
  l.zone?.classList.remove('dropover');
  l.src.classList.remove('dragsrc');
  for (const t of l.plan.targets ?? []) t.classList.remove('droptarget');
  try { l.plan.over?.(null, 0, 0); } catch { /* a preview never stops the drag ending */ }
  document.documentElement.classList.remove('dragging');
  try { document.documentElement.releasePointerCapture(l.id); } catch { /* released already */ }
  const g = l.ghost;
  if (landed || reduced() || typeof g.animate !== 'function') g.remove();
  else {
    // home: back to where the card was picked up from
    g.animate([{ transform: g.style.transform }, { transform: `translate(${l.home.left}px, ${l.home.top}px)` }],
      { duration: 180, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => g.remove();
  }
}

/** let a press go: its hold cue, if one was booked or shown */
function dropPress(): void {
  if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
  press?.src.classList.remove('draglift');
  press = null;
}

/** how close to an edge the card must be carried before the box scrolls */
const BAND = 48;
/** the step for a point `d` px inside an edge band (0 outside it) */
const stepIn = (d: number): number => (d < BAND ? Math.ceil((BAND - Math.max(d, 0)) / 3) : 0);

/** every box under the point that scrolls on this axis, nearest first */
function scrollers(x: number, y: number): HTMLElement[] {
  const out: HTMLElement[] = [];
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX)) out.push(el);
    }
    el = el.parentElement;
  }
  return out;
}

/** One step of the edge scroll at x,y: the window's own edge, then each
 * scrolling box's. True when anything moved. */
function edgeStep(x: number, y: number): boolean {
  let moved = false;
  const dy = stepIn(y) ? -stepIn(y) : stepIn(innerHeight - y);
  if (dy) { const was = scrollY; window.scrollBy(0, dy); moved ||= scrollY !== was; }
  for (const box of scrollers(x, y)) {
    const r = box.getBoundingClientRect();
    const vy = stepIn(y - r.top) ? -stepIn(y - r.top) : stepIn(r.bottom - y);
    const vx = stepIn(x - r.left) ? -stepIn(x - r.left) : stepIn(r.right - x);
    const top = box.scrollTop, left = box.scrollLeft;
    if (vy && box.scrollHeight > box.clientHeight + 1) box.scrollTop = top + vy;
    if (vx && box.scrollWidth > box.clientWidth + 1) box.scrollLeft = left + vx;
    moved ||= box.scrollTop !== top || box.scrollLeft !== left;
  }
  return moved;
}

/** the last pointer position of the carried card */
let at = { x: 0, y: 0 };
let scrolling = false;
/**
 * Keep scrolling while the card is HELD at an edge, not only while it moves:
 * one animation frame at a time, only while a card is in the air and only
 * while something actually scrolled. A frame, never a timeout — a headless
 * suite stubs the frame and would wait for ever on a timeout that re-arms.
 */
function edgeLoop(): void {
  if (scrolling || typeof requestAnimationFrame !== 'function') return;
  scrolling = true;
  const tick = (): void => {
    const l = live;
    if (!l || !l.prov.edgeScroll || !edgeStep(at.x, at.y)) { scrolling = false; return; }
    // what is under the card changed with the scroll
    hover(l, at.x, at.y);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** the zone under the pointer, and the plan's preview of a drop there */
function hover(l: Live, x: number, y: number): void {
  setZone(l, l.plan.zoneAt(document.elementFromPoint(x, y)));
  l.plan.over?.(l.zone, x, y);
}

/**
 * A second provider beside the game's: the tabletop (ui/tabletop.ts)
 * registers one at import. The document listeners stay ONE set, installed by
 * installDrag — a provider is a row in a list, never another listener — and a
 * press remembers which provider took it.
 */
export function addDragProvider(p: DragProvider): void {
  if (!providers.includes(p)) providers.push(p);
}

let installed = false;

export function installDrag(game: DragProvider): void {
  if (!providers.includes(game)) providers.unshift(game);
  if (installed) return;
  installed = true;
  // ⚠ THE BROWSER'S OWN DRAG MUST NEVER START ON A SOURCE. Firefox ignores
  // `-webkit-user-drag`, so pressing a card scan and moving began a native
  // image drag; by spec that CANCELS the pointer, the press was abandoned, and
  // the click that followed ran the tap route instead — "it was all click and
  // click again to drop" (owner, 2026-10-21, deck table v1). Cancelled here, in
  // capture, for whatever any provider would pick up and for any drag that
  // starts while a press or a carry is on.
  document.addEventListener('dragstart', e => {
    const t = e.target as Element | null;
    if (press || live || (t && providers.some(p => p.sourceOf(t)))) e.preventDefault();
  }, true);
  document.addEventListener('pointerdown', e => {
    dropPress();
    if (live || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    for (const prov of providers) {
      const src = prov.sourceOf(e.target as Element);
      if (!src) continue;
      press = { src, key: keyOf(src), id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType,
        prov, at: Date.now(), held: false };
      if (prov.pressLift && e.pointerType === 'mouse') src.classList.add('draglift');
      if (prov.holdMs && e.pointerType !== 'mouse') {
        const p = press;
        holdTimer = setTimeout(() => {
          holdTimer = null;
          if (press !== p) return;
          p.held = true;
          p.src.classList.add('draglift');
          navigator.vibrate?.(8);
        }, prov.holdMs);
      }
      return;
    }
  }, { passive: true });

  document.addEventListener('pointermove', e => {
    if (live) {
      if (e.pointerId !== live.id) return;
      place(live, e.clientX, e.clientY, e.pointerType);
      at = { x: e.clientX, y: e.clientY };
      hover(live, e.clientX, e.clientY);
      if (live.prov.edgeScroll) edgeLoop();
      return;
    }
    if (!press || e.pointerId !== press.id) return;
    const slop = press.type === 'mouse' ? SLOP_MOUSE : SLOP_TOUCH;
    const far = Math.hypot(e.clientX - press.x, e.clientY - press.y) >= slop;
    // THE HOLD (a finger on a page that scrolls): moving before it is up is a
    // swipe, and the press is let go so the browser keeps its scroll
    if (press.prov.holdMs && press.type !== 'mouse' && !press.held) {
      if (Date.now() - press.at < press.prov.holdMs) { if (far) dropPress(); return; }
      press.held = true;
    }
    if (!far) return;
    const p = press;
    if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
    p.src.classList.remove('draglift');
    press = null;
    if (begin(p, e.clientX, e.clientY)) {
      at = { x: e.clientX, y: e.clientY };
      hover(live!, e.clientX, e.clientY);
    }
  }, { passive: true });

  // ⚠ A FINGER THAT HAS LIFTED A CARD MUST NOT ALSO SCROLL THE PAGE. The
  // tabletop's cards are `touch-action: pan-y` so a swipe still scrolls; once the
  // hold is up, the next touchmove is cancelled here, which is what keeps the
  // browser from claiming the gesture as a pan (and cancelling the pointer).
  // Non-passive on purpose; it returns at once unless a card is held.
  document.addEventListener('touchmove', e => {
    if (live || press?.held) e.preventDefault();
  }, { passive: false });
  // a long press is Android's context menu and iOS's callout: not while held
  window.addEventListener('contextmenu', e => {
    if (live || press?.held) { e.preventDefault(); e.stopPropagation(); }
  }, { capture: true });

  document.addEventListener('pointerup', e => {
    const l = live;
    if (!l || e.pointerId !== l.id) { dropPress(); return; }
    dropPress();
    swallowNextClick();
    const zone = l.plan.zoneAt(document.elementFromPoint(e.clientX, e.clientY));
    // the drag state goes BEFORE the drop runs: the drop repaints, and a
    // repaint asked for while dragActive() would only be deferred again
    live = null;
    let landed = false;
    try { landed = !!zone && l.plan.drop(zone, e.clientX, e.clientY); } finally {
      live = l;
      finish(landed);
      l.prov.ended();
    }
  });

  const abandon = (): void => {
    dropPress();
    const l = live;
    if (!l) return;
    finish(false);
    l.prov.ended();
  };
  document.addEventListener('pointercancel', e => { if (live && e.pointerId === live.id) abandon(); else dropPress(); });
  window.addEventListener('blur', abandon);
  document.addEventListener('visibilitychange', abandon);
  // Escape puts the card back — ahead of main.ts's own Escape ladder, which
  // would otherwise unwind a formation or a cast under the card in the air
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !live) return;
    e.preventDefault();
    e.stopPropagation();
    abandon();
  }, { capture: true });
}
