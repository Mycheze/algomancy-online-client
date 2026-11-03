/* THE OVERFLOW WALK ui-shots.mjs runs in every shot (shots.mjs's walk, kept and
 * corrected 2026-11-03, design-system round, stream ds-w3b).
 *
 * Every button, link and form control that sits past the window's edges, or is
 * cut off by an ancestor that clips (overflow: hidden | clip), plus the page's
 * own sideways overflow. It runs IN the page: ui-shots evaluates
 * overflowJs(width), the source of overflowWalk() called with the viewport's
 * width. It is its own module so a test can run it on a made-up page
 * (client/ui/test/999-ui-shots-overflow-walk.test.ts).
 *
 * Two corrections, each of which made the list say something untrue:
 *
 *  - A DELIBERATE SCROLLER IS NOT AN OVERFLOW. A wide table inside
 *    `overflow-x: auto` (card stats' .cstablewrap, the challenge boards, the
 *    admin tables) is reached by scrolling the table; its far columns were
 *    flagged "right>W" in every phone shot, so the list was mostly noise. The
 *    nearest ancestor that scrolls (auto | scroll) now narrows what counts to
 *    the part of the element the scroller shows. The scroller itself past the
 *    window still counts: its visible box is then past the window too.
 *  - THE WINDOW IS THE VIEWPORT ui-shots SET, not innerWidth. On a touch
 *    viewport Chrome zooms a page that is too wide out until it fits, and
 *    innerWidth grows with it (the league's open time form made the phone
 *    page 481px wide and innerWidth said 481), so the one overflow the walk
 *    exists to catch, the page itself running past the screen, never showed.
 *
 * Plain JavaScript with no closure over this module: it is shipped to the page
 * as source text.
 */

/** @param {number} W the viewport's width, in CSS pixels, as ui-shots emulates it */
export function overflowWalk(W) {
  const out = [];
  for (const b of document.querySelectorAll('button, a, input, select, textarea')) {
    const r = b.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // the part of b that can be seen without scrolling anything but the page:
    // the nearest scroller narrows it to the scroller's own box
    let left = r.left, right = r.right;
    let clippedBy = '';
    let p = b.parentElement;
    while (p && p !== document.body) {
      const ox = getComputedStyle(p).overflowX;
      if (/hidden|clip/.test(ox)) {
        const pr = p.getBoundingClientRect();
        if (r.right > pr.right + 1 || r.left < pr.left - 1) clippedBy = String(p.className).split(' ')[0];
        break;
      }
      if (/auto|scroll/.test(ox)) {
        const pr = p.getBoundingClientRect();
        left = Math.max(left, pr.left); right = Math.min(right, pr.right);
        break;
      }
      p = p.parentElement;
    }
    const why = [];
    // scrolled out of its scroller's view entirely: reached by scrolling, not lost
    if (right > left) {
      if (left < 0) why.push('left<0');
      if (right > W + 0.5) why.push('right>W');
    }
    if (clippedBy !== '') why.push('clipped by .' + clippedBy);
    if (why.length) out.push({ text: (b.textContent || b.value || b.placeholder || '').trim().slice(0, 30), cls: String(b.className).slice(0, 40), why: why.join(',') });
  }
  const de = document.documentElement;
  return { scrollW: de.scrollWidth, scrollH: de.scrollHeight, W, H: innerHeight, bad: out.slice(0, 20) };
}

/** the walk as an expression for Runtime.evaluate, for a viewport `width` wide */
export const overflowJs = (width) => `(${overflowWalk.toString()})(${Number(width)})`;

/**
 * THE PAGE SCROLLS: the document is taller or wider than the window. The home
 * screen must never (client/docs/24-redesign/, principle 2: "no page
 * scrolling"; a region may scroll inside itself) — ui-shots fails a state
 * marked `noScroll` at desktop and tablet when this is true. Phones are
 * stacked and may scroll. `ov` is what overflowWalk returned.
 * @param {{ scrollW: number, scrollH: number, W: number, H: number }} ov
 */
export function pageScrolls(ov) {
  return ov.scrollH > ov.H || ov.scrollW > ov.W;
}

/** the viewports a `noScroll` state is held to (a phone may scroll) */
export const NO_SCROLL_VIEWPORTS = ['desktop', 'tablet'];
