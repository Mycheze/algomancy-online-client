/* THE RESOURCE WINDOW — the regions board's hover over a player's resources
 * (owner, 2026-09-26).
 *
 * *"Noone really wants to hover over the resource art to see it. What you
 * usually care about is how much you have of each and how much mana. Clicking
 * on one can still open it visually in the sidebar, but I think the hover for
 * the resources should be a special, much clearer window."*
 *
 * So hovering anywhere on an info block's resource row shows ONE window for
 * the whole row — the mana, then a line per kind (ui/resources.ts
 * resourceSummary) — instead of magnifying whichever scan the cursor is on
 * (ui/zoom.ts zoomTarget leaves these resources alone).
 *
 * Built like the zoom: one fixed layer on document.body, pointer-inert, no
 * `data-*` inside, so it can never take a click or be found as an anchor. It
 * sits BESIDE the row — under the opponent's, over yours, toward the middle of
 * the table — and never on it, so it cannot cover a dormant resource you are
 * about to click. A mouse only; a finger taps a resource into the rail.
 */
import type { ResourceSummary, ResourceSummaryRow } from './resources.ts';
import { txtIcon } from './cardtext.ts';

export interface Rect { left: number; top: number; width: number; height: number }

const MARGIN = 8;

/**
 * Where the window goes: `side` of the row (below the opponent's, above
 * yours), lined up with the row's outer edge, pushed inside the viewport
 * sideways. Vertically it is never moved onto the row — when there is not the
 * room on its side it goes to the other side instead. Pure, for test/324.
 */
export function resSumBox(
  row: Rect, box: { width: number; height: number }, view: { w: number; h: number },
  side: 'below' | 'above', align: 'left' | 'right', gap = 6,
): { left: number; top: number } {
  const below = row.top + row.height + gap, above = row.top - gap - box.height;
  const fitsBelow = below + box.height <= view.h - MARGIN, fitsAbove = above >= MARGIN;
  const top = side === 'below'
    ? (fitsBelow || !fitsAbove ? below : above)
    : (fitsAbove || !fitsBelow ? above : below);
  const want = align === 'left' ? row.left : row.left + row.width - box.width;
  const left = Math.max(MARGIN, Math.min(view.w - box.width - MARGIN, want));
  return { left, top };
}

const KIND_NAME: Record<string, string> = { prismite: 'Prismite', shard: 'Shard', hidden: 'Face down' };
const kindLabel = (k: string): string => {
  const name = KIND_NAME[k] ?? k.charAt(0).toUpperCase() + k.slice(1);
  return KIND_NAME[k] ? name : `${txtIcon(k, '')}${name}`;
};
const cell = (n: number | null): string => `<td${n ? '' : ' class="rsnil"'}>${n ? n : '–'}</td>`;
const rowHtml = (r: ResourceSummaryRow): string =>
  `<tr class="rs-${r.kind}"><th>${kindLabel(r.kind)}</th>${cell(r.open)}${cell(r.expended)}${cell(r.dormant)}${cell(r.affinity)}</tr>`;

/** the window's content. Pure: test/324 reads it. */
export function resSumHtml(s: ResourceSummary): string {
  const head = `<div class="rshead"><b class="rsmana">${s.mana}</b> mana open${
    s.activations !== null ? `<span class="rsact"> · ${s.activations} activation${s.activations === 1 ? '' : 's'} left</span>` : ''}</div>`;
  if (!s.rows.length) return `${head}<div class="rsfoot">No resources yet.</div>`;
  return `${head}<table class="rstab"><thead><tr><th></th><th>open</th><th>expended</th><th>dormant</th><th>affinity</th></tr></thead>
    <tbody>${s.rows.map(rowHtml).join('')}</tbody></table>${
    s.anyDormant ? '<div class="rsfoot">Dormant: no mana or affinity until activated in planning.</div>' : ''}`;
}

/** the info block's resource row a hover target is in, or null */
export function resSumRow(el: Element | null): HTMLElement | null {
  return (el?.closest?.('.linfo .lres') as HTMLElement | null) ?? null;
}

/** what main.ts hands over: the summary for the seat whose row it is */
export type ResSumSource = (seat: number) => ResourceSummary | null;

let layer: HTMLElement | null = null;
let shownSeat = -1;
let lastX = -1, lastY = -1;

function ensureLayer(): HTMLElement {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement('div');
  layer.id = 'ressum';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  return layer;
}

/** show the window for the resource row at `el`, or hide it when there is none */
export function resSumAt(el: Element | null, src: ResSumSource): void {
  const row = resSumRow(el);
  const info = row?.closest('.linfo') as HTMLElement | null;
  const seat = Number(info?.dataset['p']);
  const sum = info && Number.isInteger(seat) ? src(seat) : null;
  if (!row || !info || !sum) { resSumOff(); return; }
  const host = ensureLayer();
  host.innerHTML = resSumHtml(sum);
  host.classList.add('on');
  const mine = info.classList.contains('mine');
  // the resources themselves, not the whole grid cell — the row is
  // right-aligned in yours and may be narrower than its cell
  const r = (row.querySelector('.lresrow') ?? row).getBoundingClientRect();
  const at = resSumBox(r, { width: host.offsetWidth, height: host.offsetHeight },
    { w: innerWidth, h: innerHeight }, mine ? 'above' : 'below', mine ? 'right' : 'left');
  host.style.left = `${at.left}px`;
  host.style.top = `${at.top}px`;
  shownSeat = seat;
}

export function resSumOff(): void {
  if (shownSeat < 0) return;
  shownSeat = -1;
  if (layer) { layer.classList.remove('on'); layer.replaceChildren(); }
}

export function resSumNotePointer(x: number, y: number): void { lastX = x; lastY = y; }

/**
 * After a paint the row is a new element, and what it says may have changed
 * (a resource just activated, mana just spent). If the window is up, ask what
 * is under the cursor now and redraw from it — or drop it.
 */
export function resSumAfterPaint(src: ResSumSource): void {
  if (shownSeat < 0 || lastX < 0 || typeof document.elementFromPoint !== 'function') return;
  resSumAt(document.elementFromPoint(lastX, lastY), src);
}
