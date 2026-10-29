/* THE INFO TIP — a small window over a player's info line (board round 8,
 * owner 2026-10-27).
 *
 * The regions board's info line used to carry a deck line, always on:
 * "deck 23 · recycled 4". The owner took it off the table — *"Hovering a
 * player's name, or tapping it on touch, shows the full breakdown as numbers:
 * hand, deck, recycle pile, bin, cache"* — and the phase icons beside your
 * resources say their step the same way: hover for the caption, tap on touch.
 *
 * Built like the resource window (ui/ressum.ts), whose placement it borrows:
 * one fixed layer on document.body, pointer-inert, no `data-*` inside, beside
 * the line and never on it. Two differences:
 *
 *   - A finger has no hover, so the targets also carry `data-btn="infotip"`,
 *     and a tap PINS the window (tap again, or tap anything else, to drop it).
 *     The house rule: no hover-only information (test/273).
 *   - The content is asked for by KIND (`data-tip`), not built from the row:
 *     main.ts owns the game, this module owns the window.
 *
 * The toolbar (board round 8, main.ts toolbarHtml) uses it too — the room and
 * presence, the game's chips, the clocks — and there the window goes to the
 * strip's left (besideBox), level with the button.
 */
import { resSumBox } from './ressum.ts';

/** what main.ts hands over: the window's inner HTML for a target, or null */
export type TipSource = (el: HTMLElement) => string | null;

/** the counts a name's window lists. `recycled` is null where the format has
 * no recycle pile to speak of; `pack` only in a live draft */
export interface PlayerCounts { name: string; hand: number; deck: number; recycled: number; bin: number; cache: number; pack?: number; shared?: boolean;
  /** a line under the numbers (already escaped): what the recycle mark means */
  note?: string }

/** the name's window: every pile as a number. Pure — test/273 reads it. */
export function countsTipHtml(c: PlayerCounts): string {
  const row = (k: string, n: number, cls = ''): string =>
    `<tr${cls ? ` class="${cls}"` : ''}><th>${k}</th><td>${n}</td></tr>`;
  return `<div class="tiphead">${c.name}</div><table class="tiptab"><tbody>${
    row('hand', c.hand)}${row(c.shared ? 'deck (shared)' : 'deck', c.deck)}${row('recycle pile', c.recycled)}${
    row('bin', c.bin)}${row('cache', c.cache)}${c.pack !== undefined ? row('pack', c.pack) : ''}</tbody></table>${
    c.note ? `<div class="tipfoot">${c.note}</div>` : ''}`;
}

/** the element a hover or a tap names, or null */
export function tipTarget(el: Element | null): HTMLElement | null {
  return (el?.closest?.('[data-tip]') as HTMLElement | null) ?? null;
}

const keyOf = (el: HTMLElement): string => `${el.dataset['tip'] ?? ''}:${el.dataset['p'] ?? ''}`;

let layer: HTMLElement | null = null;
let shown: string | null = null;
let pinned = false;
let lastX = -1, lastY = -1;

function ensureLayer(): HTMLElement | null {
  if (layer && layer.isConnected) return layer;
  if (typeof document === 'undefined' || typeof document.createElement !== 'function' || !document.body) return null;
  layer = document.createElement('div');
  layer.id = 'infotip';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  return layer;
}

/** a window for something on the toolbar (board round 8): to the strip's
 * LEFT, never on it, level with the target and kept inside the window.
 * Pure — test/712 hands it boxes. */
export function besideBox(target: { top: number; height: number }, stripLeft: number,
  box: { width: number; height: number }, view: { w: number; h: number }, gap = 6): { left: number; top: number } {
  const M = 4;
  const left = Math.max(M, stripLeft - gap - box.width);
  const want = target.top + target.height / 2 - box.height / 2;
  const top = Math.max(M, Math.min(view.h - box.height - M, want));
  return { left, top };
}

/** the token corner's window (checkpoint 4): BESIDE the corner, on the side
 * nearer the window's middle, its edge level with the corner's edge nearer the
 * window's middle — a stacked token's zoom clears the corner's row on that
 * side (zoom.ts clearRow), so the two do not meet. Kept inside the window.
 * Pure — test/233 hands it boxes. */
export const CORNER_GAP = 8;
export function cornerBox(corner: { left: number; top: number; width: number; height: number },
  box: { width: number; height: number }, view: { w: number; h: number }, gap = CORNER_GAP): { left: number; top: number } {
  const M = 4;
  const inward = corner.left + corner.width / 2 > view.w / 2 ? 'left' : 'right';
  const want = inward === 'left' ? corner.left - gap - box.width : corner.left + corner.width + gap;
  const left = Math.max(M, Math.min(view.w - box.width - M, want));
  const lower = corner.top + corner.height / 2 > view.h / 2;
  const want_ = lower ? corner.top + corner.height - box.height : corner.top;
  const top = Math.max(M, Math.min(view.h - box.height - M, want_));
  return { left, top };
}

function place(el: HTMLElement, html: string): void {
  const host = ensureLayer();
  if (!host || typeof el.getBoundingClientRect !== 'function') return;
  host.innerHTML = html;
  host.classList.add('on');
  const strip = el.closest?.('.toolbar');
  if (strip) {
    const at = besideBox(el.getBoundingClientRect(), strip.getBoundingClientRect().left,
      { width: host.offsetWidth, height: host.offsetHeight }, { w: innerWidth, h: innerHeight });
    host.style.left = `${at.left}px`;
    host.style.top = `${at.top}px`;
    return;
  }
  if (el.classList?.contains('ltok')) {
    const at = cornerBox(el.getBoundingClientRect(), { width: host.offsetWidth, height: host.offsetHeight },
      { w: innerWidth, h: innerHeight });
    host.style.left = `${at.left}px`;
    host.style.top = `${at.top}px`;
    return;
  }
  // across, the target; up and down, the whole info line it is in — the
  // window goes beside the line, never on it
  const t = el.getBoundingClientRect();
  const line = (el.closest?.('.linfo') ?? el).getBoundingClientRect();
  const r = { left: t.left, width: t.width, top: line.top, height: line.height };
  // under a line in the top half of the window, over one in the bottom half;
  // lined up with the target's edge nearer the window's middle
  const below = r.top + r.height / 2 < innerHeight / 2;
  const right = r.left + r.width / 2 > innerWidth / 2;
  const at = resSumBox(r, { width: host.offsetWidth, height: host.offsetHeight },
    { w: innerWidth, h: innerHeight }, below ? 'below' : 'above', right ? 'right' : 'left');
  host.style.left = `${at.left}px`;
  host.style.top = `${at.top}px`;
}

/** a hovering mouse: show the window for the target under it, or drop an
 * unpinned one. A pinned window (a tap) outlives the hover. */
export function tipAt(el: Element | null, src: TipSource): boolean {
  const t = tipTarget(el);
  const html = t ? src(t) : null;
  if (!t || !html) { if (!pinned) tipOff(); return false; }
  if (pinned && shown !== keyOf(t)) pinned = false;
  place(t, html);
  shown = keyOf(t);
  return true;
}

/** a tap or a click on a target: pin its window, or drop it if it was up */
export function tipToggle(el: HTMLElement, src: TipSource): void {
  const t = tipTarget(el) ?? el;
  if (pinned && shown === keyOf(t)) { tipOff(); return; }
  const html = src(t);
  if (!html) { tipOff(); return; }
  place(t, html);
  shown = keyOf(t);
  pinned = true;
}

export function tipOff(): void {
  pinned = false;
  if (shown === null) return;
  shown = null;
  if (layer) { layer.classList.remove('on'); layer.innerHTML = ''; }
}

/** a click anywhere but a target drops a pinned window */
export function tipClick(target: Element | null): void {
  if (pinned && !tipTarget(target)) tipOff();
}

export function tipNotePointer(x: number, y: number): void { lastX = x; lastY = y; }

/** after a paint the target is a new element and its numbers may have
 * changed: a pinned window follows its target by kind and seat, a hovered one
 * asks what is under the cursor now */
export function tipAfterPaint(src: TipSource): void {
  if (shown === null || typeof document.querySelector !== 'function') return;
  if (pinned) {
    const [kind, p] = shown.split(':');
    const el = document.querySelector<HTMLElement>(`[data-tip="${kind}"]${p ? `[data-p="${p}"]` : ''}`);
    const html = el ? src(el) : null;
    if (!el || !html) { tipOff(); return; }
    place(el, html);
    return;
  }
  if (lastX < 0 || typeof document.elementFromPoint !== 'function') return;
  tipAt(document.elementFromPoint(lastX, lastY), src);
}
