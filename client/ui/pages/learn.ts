/* LEARN TO PLAY: THE MENU, DRAWN (CR D8.1; the page contract, pages/README.md).
 *
 * Moved out of ui/learnmenu.ts in the design-system round, 2026-11-03.
 * learnMenuView() gathers the saved progress and the element picked;
 * learnMenuHtml() draws the menu and touches nothing else. ui/learnmenu.ts
 * keeps the layer beside #app, its clicks and its keys (the menu is a layer,
 * not a page that owns #app: ui/helplayer.ts's pattern, `.learnscrim`).
 *
 * The lesson window (ui/lessonlayer.ts) is drawn over a board and stays there.
 */
import type { LearnProgress } from '../learn.ts';
import { LEARN_ELEMENTS, type LearnElement } from '../lessondeck.ts';
import { ALL_LESSONS } from '../lessons.ts';
import { elIcon, esc } from '../util.ts';

export interface LearnMenuView {
  /** the element picked, the one Start (or Continue) plays */
  el: LearnElement;
  /** the elements on offer, in order */
  elements: readonly LearnElement[];
  /** a game in progress with the picked element: Continue and Start over */
  saved: boolean;
  /** every lesson, in order, and whether it has been shown already */
  lessons: { n: string; title: string; seen: boolean }[];
}

/** Gather the menu: the progress saved in this browser, and the element picked. */
export function learnMenuView(progress: LearnProgress | null, el: LearnElement): LearnMenuView {
  const seen = new Set(progress?.seen ?? []);
  return {
    el,
    elements: LEARN_ELEMENTS,
    saved: !!(progress?.game && progress.element === el),
    lessons: ALL_LESSONS.map(l => ({ n: l.n, title: l.title, seen: seen.has(l.id) })),
  };
}

export function learnMenuHtml(v: LearnMenuView): string {
  const { el, saved } = v;
  const els = v.elements.map(e =>
    `<button class="learnel el-${e} ${e === el ? 'on' : ''}" data-lmenu="el" data-el="${e}">${elIcon(e)}${e[0]!.toUpperCase()}${e.slice(1)}</button>`).join('');
  const lessons = v.lessons.map((l, i) =>
    `<li><button class="learnread" data-lmenu="read" data-i="${i}">${esc(l.n)}. ${esc(l.title)}</button>${l.seen ? ' <span class="learnseen">✓</span>' : ''}</li>`).join('');
  return `<div class="learnscrim" id="learnscrim"><div class="learnbox" role="dialog" aria-label="Learn to play">
    <div class="lhead"><h3>📘 Learn to play</h3><button data-lmenu="close">✕</button></div>
    <p class="learnblurb">A real game, with a lesson at each new moment. About twenty minutes.</p>
    <div class="learnlabel">Play one element</div>
    <div class="learnels">${els}</div>
    <div class="learngo">
      ${saved
        ? `<button class="lprimary" data-lmenu="continue">Continue your ${esc(el)} game</button><button data-lmenu="fresh">Start over</button>`
        : `<button class="lprimary" data-lmenu="start">Start the ${esc(el)} game</button>`}
    </div>
    <details class="learnlist"><summary>Read a lesson</summary><ol>${lessons}</ol></details>
  </div></div>`;
}
