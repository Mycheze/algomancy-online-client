/*
 * DRAG TO PLAY (2026-09-27, owner: "I'd also like to integrate dragging as an
 * option for playing cards and building formations"). Mouse and finger alike,
 * on Pointer Events — not the HTML5 drag-and-drop API, which draws its own
 * ghost, has no touch story on older iPads, and fires no events at all while
 * the pointer is over a page element that did not opt in.
 *
 * THIS MODULE KNOWS NOTHING ABOUT THE GAME. It turns a press-move-release on a
 * source into three calls on a plan main.ts hands it: what glows, what is
 * under the pointer, and what the drop does. main.ts builds every plan out of
 * the functions the CLICKS call — one intent, two routes, the same rule as
 * cardMenuItems serving both the right-click and the rail — so a drag can
 * never do anything a click could not.
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
 * ⚠ THE BOARD MUST NOT BE REPAINTED UNDER A DRAG. render() rebuilds #app on
 * every server push, which would pull the source and every target out from
 * under the pointer. main.ts's render() asks `dragActive()` and defers the
 * paint to the end of the gesture (`ended`). The state still lands; the drop
 * is re-validated against it by the click route it calls.
 */
import { inertCopy } from './zoom.ts';
import { swallowNextClick } from './touch.ts';

export interface DragPlan {
  /** every element that takes a drop, lit while the drag lasts */
  targets: Element[];
  /** the drop zone for the element under the pointer (a target, or a wider
   * area that means one), or null for "not here" */
  zoneAt(el: Element | null): Element | null;
  /** drop onto `zone` with the pointer at x,y — false puts the card back */
  drop(zone: Element, x: number, y: number): boolean;
}

export interface DragDeps {
  /** the drag source a press on `el` would pick up, before any legality —
   * cheap, called on every pointerdown */
  sourceOf(el: Element): HTMLElement | null;
  /** the plan for dragging `src`, asked once the slop is crossed */
  plan(src: HTMLElement): DragPlan | null;
  /** a drag took the pointer: drop the hover effects */
  started(): void;
  /** it let go (dropped or not): paint whatever was deferred */
  ended(): void;
}

/** how far a press must travel to be a drag and not a click */
const SLOP_MOUSE = 6;
const SLOP_TOUCH = 10;

interface Press { src: HTMLElement; key: string; id: number; x: number; y: number; type: string }

/** the source again after a repaint: the same data-act and indices (a push
 * can land between the press and the slop being crossed, and every paint
 * rebuilds the board) */
function keyOf(el: HTMLElement): string {
  return ['act', 'p', 'i', 'id'].map(k => el.dataset[k] === undefined ? '' : `[data-${k}="${CSS.escape(el.dataset[k]!)}"]`).join('');
}
interface Live {
  plan: DragPlan;
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

function begin(p: Press, deps: DragDeps, x: number, y: number): boolean {
  if (!p.src.isConnected) {
    const again = p.key ? document.querySelector<HTMLElement>(`#app ${p.key}`) : null;
    if (!again) return false;
    p.src = again;
  }
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
  live = { plan, src: p.src, id: p.id, ghost, home, dx: p.x - home.left, dy: p.y - home.top, zone: null };
  p.src.classList.add('dragsrc');
  for (const t of plan.targets) t.classList.add('droptarget');
  document.documentElement.classList.add('dragging');
  try { document.documentElement.setPointerCapture(p.id); } catch { /* the pointer is already gone */ }
  deps.started();
  place(live, x, y, p.type);
  return true;
}

/** take the drag down; `landed` = the drop was taken, so no flight home */
function finish(deps: DragDeps, landed: boolean): void {
  const l = live;
  if (!l) return;
  live = null;
  l.zone?.classList.remove('dropover');
  l.src.classList.remove('dragsrc');
  for (const t of l.plan.targets) t.classList.remove('droptarget');
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

export function installDrag(deps: DragDeps): void {
  document.addEventListener('pointerdown', e => {
    press = null;
    if (live || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const src = deps.sourceOf(e.target as Element);
    if (src) press = { src, key: keyOf(src), id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType };
  }, { passive: true });

  document.addEventListener('pointermove', e => {
    if (live) {
      if (e.pointerId !== live.id) return;
      place(live, e.clientX, e.clientY, e.pointerType);
      const under = document.elementFromPoint(e.clientX, e.clientY);
      setZone(live, live.plan.zoneAt(under));
      return;
    }
    if (!press || e.pointerId !== press.id) return;
    const slop = press.type === 'mouse' ? SLOP_MOUSE : SLOP_TOUCH;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < slop) return;
    const p = press;
    press = null;
    if (begin(p, deps, e.clientX, e.clientY)) {
      const under = document.elementFromPoint(e.clientX, e.clientY);
      setZone(live!, live!.plan.zoneAt(under));
    }
  }, { passive: true });

  document.addEventListener('pointerup', e => {
    press = null;
    const l = live;
    if (!l || e.pointerId !== l.id) return;
    swallowNextClick();
    const zone = l.plan.zoneAt(document.elementFromPoint(e.clientX, e.clientY));
    // the drag state goes BEFORE the drop runs: the drop repaints, and a
    // repaint asked for while dragActive() would only be deferred again
    live = null;
    let landed = false;
    try { landed = !!zone && l.plan.drop(zone, e.clientX, e.clientY); } finally {
      live = l;
      finish(deps, landed);
      deps.ended();
    }
  });

  const abandon = (): void => {
    press = null;
    if (!live) return;
    finish(deps, false);
    deps.ended();
  };
  document.addEventListener('pointercancel', e => { if (live && e.pointerId === live.id) abandon(); else press = null; });
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
