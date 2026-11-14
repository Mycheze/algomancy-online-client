/* THE PICK SCREEN'S CONTROLLER — a cube event's draft (docs/25 §4). The
 * drawing is pages/cubedraft.ts; the event's socket and state are ui/cube.ts,
 * which calls paintCubeDraft with every view it is pushed.
 *
 * Three ways to take a card, one door (`take`):
 *   a tap on a card            chooses it (acts.reserve), ringed
 *   a second tap, or Confirm   takes the chosen card (acts.pick)
 *   a card dragged to the picks takes it (the drop calls `take`, as the click does)
 *
 * THE CLOCK is ONE setInterval, started when the screen is painted and
 * cleared on the first tick that finds the screen gone (or stopCubeDraft) —
 * never a setTimeout that re-arms itself: the headless suites stub
 * setInterval and keep setTimeout real, and a re-arming timeout hangs them.
 * The view carries the server's `now`; the tick counts the deadline down by
 * the server's time (`skew`), rewrites the clock's text in place, and repaints
 * once when it turns urgent. At ≤10 s with nothing chosen it chooses the
 * server's suggestion for you, once per pick (`autoReserve`, pure) — the card
 * the server takes at 0 anyway.
 *
 * ⚠ Never repainted under a drag (ui/drag.ts): a view pushed mid-drag is
 * painted when the card lands.
 */
import type { CubeDraftView, CubeView } from '../server/cube-types.ts';
import { addDragProvider, dragActive, type DragProvider } from './drag.ts';
import { noImgDrag } from './piletable.ts';
import { installPressZoom } from './presszoom.ts';
import { installSplitter, shownSplit, stepSplit, writeSplit } from './splitter.ts';
import { PEEK_MS } from './touch.ts';
import { clockText, cubeDraftHtml, cubeDraftView, PACK_SPLIT_KEY, URGENT_MS, type CubeDraftPageView } from './pages/cubedraft.ts';
import { paintFrame } from './pages/frame.ts';

export interface CubeActs { reserve(card: string): void; pick(card: string): void }

// ── the pure part (test 1344) ─────────────────────────────────────────

/** one pick of the draft: a new pack, or the same pack one card smaller */
export function pickKey(d: CubeDraftView): string {
  return `${d.packNo}.${d.pickNo}.${d.pack?.length ?? 0}`;
}

/**
 * The card to choose for the player now, or null: at ≤10 s on the clock
 * (the server's time) with nothing chosen, the server's suggestion — once per
 * pick (`firedFor` is the pickKey it last fired for).
 */
export function autoReserve(d: CubeDraftView | null, serverNow: number, reserved: string | null, firedFor: string | null): string | null {
  if (!d?.pack || d.deadline === null || !d.suggest || reserved) return null;
  if (firedFor === pickKey(d) || !d.pack.includes(d.suggest)) return null;
  return d.deadline - serverNow <= URGENT_MS ? d.suggest : null;
}

// ── state ─────────────────────────────────────────────────────────────

interface Screen {
  app: HTMLElement;
  view: CubeView;
  acts: CubeActs;
  rerender: () => void;
  /** the server's clock minus this one's, when the view came */
  skew: number;
}

let cur: Screen | null = null;
/** the card I tapped, for the pick it was tapped in (shown before the server echoes it) */
let mine: { key: string; card: string } | null = null;
/** the card I took, for the pick it was taken in (no second take until the pack moves on) */
let took: { key: string; card: string } | null = null;
/** the pick the auto-choice last fired for */
let autoFor: string | null = null;
/** a paint asked for while a card was in the air */
let pending = false;
let timer: ReturnType<typeof setInterval> | null = null;
/** the clock was urgent at the last paint */
let wasUrgent = false;

const serverNow = (): number => Date.now() + (cur?.skew ?? 0);

/** the card chosen now: my tap in this pick, else the server's */
function chosen(d: CubeDraftView | null): string | null {
  if (!d?.pack) return null;
  const key = pickKey(d);
  if (mine && mine.key === key && d.pack.includes(mine.card)) return mine.card;
  return d.reserved && d.pack.includes(d.reserved) ? d.reserved : null;
}

const takenNow = (d: CubeDraftView | null): string | null => (d?.pack && took && took.key === pickKey(d) ? took.card : null);

/** the split the screen was last drawn at (▲ ▼ step from what is drawn) */
let drawnSplit: number | null = null;

/** draw the screen as it is */
function draw(): void {
  if (!cur) return;
  if (dragActive()) { pending = true; return; }
  pending = false;
  const d = cur.view.draft;
  const v: CubeDraftPageView = cubeDraftView(cur.view, { reserved: chosen(d), taken: takenNow(d), serverNow: serverNow() });
  drawnSplit = v.split;
  wasUrgent = v.msLeft !== null && v.msLeft <= URGENT_MS;
  paintFrame(cur.app, noImgDrag(cubeDraftHtml(v)));
}

// ── taking and choosing: every route comes here ───────────────────────

/** choose `card` (a tap) */
function choose(card: string): void {
  const d = cur?.view.draft;
  if (!cur || !d?.pack || !d.pack.includes(card) || takenNow(d)) return;
  mine = { key: pickKey(d), card };
  cur.acts.reserve(card);
  draw();
}

/** THE ONE DOOR: take `card` — a second tap, Confirm, or a drop. False when it cannot be taken now */
function take(card: string): boolean {
  const d = cur?.view.draft;
  if (!cur || !d?.pack || !d.pack.includes(card) || takenNow(d)) return false;
  took = { key: pickKey(d), card };
  cur.acts.pick(card);
  draw();
  return true;
}

/** a `cd-` button (the click listener's, and the tests'). True when it was ours */
export function cubeDraftButton(btn: string, el?: { dataset: Record<string, string | undefined> }): boolean {
  if (!btn.startsWith('cd-')) return false;
  const d = cur?.view.draft ?? null;
  switch (btn) {
    case 'cd-card': {
      const card = el?.dataset['cdCard'];
      if (!card) return true;
      if (chosen(d) === card) take(card); else choose(card);
      return true;
    }
    case 'cd-confirm': {
      const card = chosen(d);
      if (card) take(card);
      return true;
    }
    case 'cd-split': {
      // from what is drawn (the pack's own fit, until the player has moved it), into the pick screen's own key
      const root = cur && typeof cur.app.querySelector === 'function' ? cur.app.querySelector('.cdbuilder') : null;
      writeSplit(stepSplit(shownSplit(root) ?? drawnSplit ?? 0.5, Number(el?.dataset['by'] ?? 0)), PACK_SPLIT_KEY);
      draw();
      return true;
    }
    default: return true;
  }
}

// ── the clock ─────────────────────────────────────────────────────────

/** one beat: the clock's text, the urgent repaint, the auto-choice — or, the screen gone, the end of the clock */
export function tickCubeDraft(): void {
  if (!cur) return;
  if (typeof cur.app.querySelector === 'function' && !cur.app.querySelector('.cdpage')) { stopCubeDraft(); return; }
  if (dragActive()) return;
  const d = cur.view.draft;
  const auto = autoReserve(d, serverNow(), chosen(d), autoFor);
  if (auto && d) { autoFor = pickKey(d); choose(auto); return; }
  const left = d?.pack && d.deadline !== null ? d.deadline - serverNow() : null;
  const urgent = left !== null && left <= URGENT_MS;
  if (urgent !== wasUrgent) { draw(); return; }
  const clock = typeof cur.app.querySelector === 'function' ? cur.app.querySelector<HTMLElement>('.cdclock') : null;
  if (clock && left !== null) {
    const text = clockText(left);
    if (clock.textContent !== text) clock.textContent = text;
  }
}

function startClock(): void {
  if (timer !== null || typeof setInterval !== 'function') return;
  timer = setInterval(tickCubeDraft, 250);
  // a test's process is never held open by it (node); a browser's id is a number
  (timer as unknown as { unref?: () => void })?.unref?.();
}

/** the screen is going: the clock stops (the event page calls it; the tick also finds out itself) */
export function stopCubeDraft(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  cur = null;
  pending = false;
}

// ── the listeners ─────────────────────────────────────────────────────

const wired = new WeakSet<HTMLElement>();

/** the screen's own clicks: `cd-` buttons are taken here and go no further
 * (main.ts's delegator would repaint the page for a name it does not know) */
function wire(app: HTMLElement): void {
  if (wired.has(app) || typeof app.addEventListener !== 'function') return;
  wired.add(app);
  app.addEventListener('click', e => {
    const btn = (e.target as HTMLElement | null)?.closest?.('[data-btn^="cd-"]') as HTMLElement | null;
    if (!btn || !btn.closest('.cdpage') || !cur) return;
    e.stopPropagation();
    if ((btn as HTMLButtonElement).disabled) return;
    cubeDraftButton(btn.dataset['btn'] ?? '', btn);
  });
  installPressZoom();
  // the divider's drag (ui/splitter.ts stores it under the screen's own key): the picks refit on the release
  installSplitter(redrawAfterSplit);
}

function redrawAfterSplit(): void {
  if (cur && typeof cur.app.querySelector === 'function' && cur.app.querySelector('.cdpage')) draw();
}

// ── the drag: a pack card onto the picks is a take ────────────────────

const provider: DragProvider = {
  holdMs: PEEK_MS,
  pressLift: true,
  edgeScroll: true,
  sourceOf(el) {
    if (!cur || !el?.closest || !el.closest('.cdpage')) return null;
    return el.closest('[data-cd-card]') as HTMLElement | null;
  },
  plan(src) {
    const card = src.dataset['cdCard'];
    const d = cur?.view.draft;
    if (!card || !d?.pack?.includes(card) || takenNow(d)) return null;
    return {
      targets: [],
      zoneAt: el => el?.closest?.('[data-cd-zone="picks"]') ?? null,
      drop: zone => !!zone && take(card),
    };
  },
  started() { /* nothing hovers here but the zoom, which drag.ts takes down */ },
  ended() { if (pending) draw(); },
  refind(src) {
    const card = src.dataset['cdCard'];
    return card && typeof document !== 'undefined'
      ? document.querySelector<HTMLElement>(`.cdpage [data-cd-card="${CSS.escape(card)}"]`) : null;
  },
};
addDragProvider(provider);
/** the pick screen's drag provider, for the tests that drop through it */
export const cubeDraftDrag: DragProvider = provider;

// ── the screen ────────────────────────────────────────────────────────

/** Paint the pick screen for `view` (every push), and keep its clock running. */
export function paintCubeDraft(app: HTMLElement, view: CubeView, acts: CubeActs, rerender: () => void): void {
  const skew = cur && cur.view === view ? cur.skew : view.now - Date.now();
  cur = { app, view, acts, rerender, skew };
  const d = view.draft;
  // the pack moved on: my tap and my take were for the last one
  if (d && mine && mine.key !== pickKey(d)) mine = null;
  if (d && took && took.key !== pickKey(d)) took = null;
  wire(app);
  draw();
  startClock();
  // a view that comes in already under 10 s chooses at once
  tickCubeDraft();
}
