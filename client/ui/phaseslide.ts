/* The phase bar's slide (owner, 2026-11-10): the current step's box is wider,
 * with the step's name in it, and when the step changes the next box slides
 * over, covering the old name as it reveals its own.
 *
 * The resting bar is markup and CSS alone (main.ts phaseIconsHtml), so with
 * motion off, or in a test, the bar is simply right. This module only animates
 * the way there, and it has to outlive render(): the board is rebuilt with
 * innerHTML, which can happen mid-slide and replaces the very elements being
 * moved. So a slide is a start time, and every frame (and every repaint, in
 * the same task, before anything is drawn) applies "where the slide is by
 * now" to whichever bar is on screen. */

/** approved on the mockup: long enough to follow, short enough not to wait on */
export const SLIDE_MS = 420;
/** a step that lasted less than this fraction of a slide was never really on
 * screen (a Haste nobody can act in passes in the same tick), so the slide
 * already under way simply heads for the step after it */
const RETARGET_BEFORE = .15;

const clamp = (v: number): number => Math.min(1, Math.max(0, v));
const ease = (t: number): number => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

export interface SlideGeometry {
  /** each step's name, measured, with its padding */
  words: readonly number[];
  /** one icon's cell */
  icon: number;
  /** between cells */
  gap: number;
}
export interface SlideFrame {
  /** how far each step's name is open, in px */
  slots: number[];
  /** the highlight, in the cells' own coordinates */
  left: number;
  width: number;
  /** how lit each step is, 0 to 1 */
  lit: number[];
}

/**
 * One moment of the slide from step `from` to step `to`, `t` from 0 to 1.
 *
 * The names cross over together, so the next icon travels left over the old
 * name. The highlight moves like an inchworm: its leading edge goes first, to
 * take in both boxes, and its trailing edge stays put until halfway. At the end
 * of the turn the bar runs backwards, so "leading" is its left edge.
 */
export function slideFrame(from: number, to: number, t: number, g: SlideGeometry): SlideFrame {
  const e = ease(t);
  const lead = ease(clamp(t / .6));
  const lag = ease(clamp((t - .5) / .5));
  const open = (i: number): number => i === to ? e : i === from ? 1 - e : 0;
  let x = 0;
  const slots: number[] = [];
  const rects = g.words.map((w, i) => {
    const slot = w * open(i);
    const rect = { l: x, r: x + g.icon + slot };
    slots.push(slot);
    x = rect.r + g.gap;
    return rect;
  });
  const back = to < from;
  const left = lerp(rects[from]!.l, rects[to]!.l, back ? lead : lag);
  const right = lerp(rects[from]!.r, rects[to]!.r, back ? lag : lead);
  const lit = g.words.map((_, i) => i === to ? lead : i === from ? 1 - lag : 0);
  return { slots, left, width: right - left, lit };
}

/** an unlit icon's opacity while it is being passed: the resting `.phi` value */
const UNLIT = .32;

interface Slide { from: number; to: number; fromTurn: string; toTurn: string; startedAt: number; geometry: SlideGeometry }

/** what the bar showed at the last repaint; null when no bar was on screen */
let shown: { index: number; turn: string } | null = null;
let slide: Slide | null = null;
/** a step reached while a slide is running: the box goes there next, and never jumps */
let pending: { index: number; turn: string } | null = null;
let raf = 0;

function bars(): { bar: HTMLElement; cells: HTMLElement[]; box: HTMLElement; turn: HTMLElement; holder: HTMLElement } | null {
  const bar = document.querySelector<HTMLElement>('.phicons');
  const holder = bar?.querySelector<HTMLElement>('.phcells');
  const box = bar?.querySelector<HTMLElement>('.phbox');
  const turn = bar?.querySelector<HTMLElement>('.phturn');
  if (!bar || !holder || !box || !turn) return null;
  return { bar, holder, box, turn, cells: [...bar.querySelectorAll<HTMLElement>('.phi')] };
}

function measure(b: NonNullable<ReturnType<typeof bars>>): SlideGeometry {
  return {
    words: b.cells.map(c => (c.querySelector<HTMLElement>('.phword > span'))?.offsetWidth ?? 0),
    icon: b.cells[0]?.querySelector<HTMLElement>('.phic')?.offsetWidth ?? 0,
    gap: parseFloat(getComputedStyle(b.holder).columnGap) || 0,
  };
}

function apply(s: Slide, t: number): void {
  const b = bars();
  if (!b) return;
  const f = slideFrame(s.from, s.to, t, s.geometry);
  b.bar.classList.add('sliding');
  b.cells.forEach((c, i) => {
    c.querySelector<HTMLElement>('.phword')!.style.width = `${f.slots[i]}px`;
    c.style.opacity = String(UNLIT + (1 - UNLIT) * f.lit[i]!);
  });
  b.box.style.left = `${f.left}px`;
  b.box.style.width = `${f.width}px`;
  b.turn.textContent = t < .5 ? s.fromTurn : s.toTurn;
}

/** back to the markup and the stylesheet: nothing inline outlives a slide */
function finish(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  const s = slide;
  slide = null;
  const b = bars();
  if (!s || !b) return;
  b.bar.classList.remove('sliding');
  b.cells.forEach(c => {
    c.querySelector<HTMLElement>('.phword')!.style.removeProperty('width');
    c.style.removeProperty('opacity');
  });
  b.box.style.removeProperty('left');
  b.box.style.removeProperty('width');
  b.turn.textContent = s.toTurn;
}

function progress(s: Slide): number { return clamp((performance.now() - s.startedAt) / SLIDE_MS); }

function start(b: NonNullable<ReturnType<typeof bars>>, from: number, fromTurn: string, to: number, toTurn: string): void {
  slide = { from, to, fromTurn, toTurn, startedAt: performance.now(), geometry: measure(b) };
}

/** put the running slide where the clock says, or end it and take the next */
function advance(): void {
  if (!slide) return;
  if (progress(slide) >= 1) {
    const { to, toTurn } = slide;
    const next = pending;
    pending = null;
    finish();
    const b = bars();
    if (!b || !next) return;
    start(b, to, toTurn, next.index, next.turn);
  }
  apply(slide!, progress(slide!));
  if (!raf) raf = requestAnimationFrame(tick);
}

function tick(): void {
  raf = 0;
  advance();
}

/** the step the box is on, or on its way to */
function heading(): number | null {
  return pending ? pending.index : slide ? slide.to : shown ? shown.index : null;
}

/**
 * Call after every repaint, before the browser can draw it. Starts a slide when
 * the lit step has changed, and otherwise puts a slide already running back
 * onto the freshly built bar.
 */
export function syncPhaseSlide(motion: boolean): void {
  if (typeof document === 'undefined' || typeof requestAnimationFrame !== 'function') return;
  const b = bars();
  const index = b ? b.cells.findIndex(c => c.classList.contains('cur')) : -1;
  if (!b || index < 0 || !motion) {
    pending = null;
    finish();
    shown = b && index >= 0 ? { index, turn: b.turn.textContent ?? '' } : null;
    return;
  }
  const turn = b.turn.textContent ?? '';
  const was = heading();
  if (was !== null && was !== index) {
    if (!slide) start(b, was, shown!.turn, index, turn);
    else if (pending || progress(slide) >= RETARGET_BEFORE) pending = index === slide.to ? null : { index, turn };
    else if (index === slide.from) finish();
    else { slide.to = index; slide.toTurn = turn; slide.startedAt = performance.now(); }
  }
  shown = { index, turn };
  advance();
}
