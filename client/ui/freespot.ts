/* WHERE THE CARD BEING PLAYED WAITS — the nearest spot on the table that
 * covers nothing.
 *
 * Owner, 2026-09-30, on the card waiting at the table's bottom-left while its
 * choices are made (main.ts castingHtml): "the little 'being cast' window
 * can't overlap anything! It's impossible to see right now". A FIXED corner
 * cannot promise that — on the regions board the bottom-left corner is where
 * your own units stand, and the sacrifice the card was asking for was the
 * unit it sat on top of.
 *
 * So the corner is only a PREFERENCE. The page is measured, and the card goes
 * to the free spot nearest that corner: one that overlaps no card, slot,
 * label, button or floating window. When the table has no free spot at all
 * (a very crowded board on a small screen), it takes the spot that covers the
 * least — it never refuses to show the card.
 *
 * Pure geometry, no DOM, so a test can hand it boxes (ui/test/357).
 */

export interface Rect { l: number; t: number; r: number; b: number }

/** how much of `a` and `b` overlap, in square pixels */
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
  const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * The top-left corner for a `w`×`h` box inside `area` that overlaps none of
 * `obstacles` (each grown by `gap` so the card never touches one), nearest to
 * `prefer` (a top-left corner). Candidates are scanned on a `step`-pixel grid
 * plus the area's own edges, so a box that only fits flush against an edge is
 * still found.
 */
export function freeSpot(
  area: Rect, w: number, h: number, obstacles: readonly Rect[],
  prefer: { x: number; y: number }, step = 8, gap = 6,
): { x: number; y: number; covered: number } {
  const grown = obstacles.map(o => ({ l: o.l - gap, t: o.t - gap, r: o.r + gap, b: o.b + gap }));
  const maxX = Math.max(area.l, area.r - w);
  const maxY = Math.max(area.t, area.b - h);
  // the grid, the far edge, and the preferred spot itself — so a free corner
  // is used exactly, not snapped to the nearest grid line
  const axis = (lo: number, hi: number, want: number): number[] => {
    const out: number[] = [];
    for (let v = lo; v < hi; v += step) out.push(v);
    out.push(hi, Math.min(Math.max(want, lo), hi));
    return out;
  };
  const xs = axis(area.l, maxX, prefer.x);
  const ys = axis(area.t, maxY, prefer.y);
  let best = { x: Math.min(Math.max(prefer.x, area.l), maxX), y: Math.min(Math.max(prefer.y, area.t), maxY), covered: Infinity };
  let bestDist = Infinity;
  for (const y of ys) {
    for (const x of xs) {
      const d = (x - prefer.x) ** 2 + (y - prefer.y) ** 2;
      // a free spot can only be beaten by a nearer free spot
      if (best.covered === 0 && d >= bestDist) continue;
      const box = { l: x, t: y, r: x + w, b: y + h };
      let covered = 0;
      for (const o of grown) {
        covered += overlap(box, o);
        if (covered > best.covered) break;
      }
      if (covered < best.covered || (covered === best.covered && d < bestDist)) {
        best = { x, y, covered };
        bestDist = d;
      }
    }
  }
  return best;
}
