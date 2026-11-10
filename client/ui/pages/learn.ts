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
import { button, sheet } from '../components/index.ts';

export interface LearnMenuView {
  /** the element picked, the one Start (or Continue) plays */
  el: LearnElement;
  /** the elements on offer, in order */
  elements: readonly LearnElement[];
  /** a game in progress with the picked element: Continue and Start over */
  saved: boolean;
  /** BL-11: that saved game is a "client tips only" one */
  savedTips: boolean;
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
    savedTips: !!(progress?.game && progress.element === el && progress.tips),
    lessons: ALL_LESSONS.map(l => ({ n: l.n, title: l.title, seen: seen.has(l.id) })),
  };
}

/** The menu, as a sheet (components/sheet.ts, 2026-11-04): the system's
 * panel over a dimmed page, closed by tapping off it, its ✕ or Esc. The sheet
 * root keeps the layer's `learnscrim` (its id and class: ui/learnmenu.ts
 * reads a click on it, 307 and 1020 look for it); the scrim and the ✕ carry
 * the sheet's `data-sheet-dismiss`, which the layer closes on. */
export function learnMenuHtml(v: LearnMenuView): string {
  const { el, saved, savedTips } = v;
  const els = v.elements.map(e =>
    `<button class="learnel el-${e} ${e === el ? 'on' : ''}" aria-pressed="${e === el}" data-lmenu="el" data-el="${e}">${elIcon(e)}${e[0]!.toUpperCase()}${e.slice(1)}</button>`).join('');
  const lessons = v.lessons.map((l, i) =>
    `<li><button class="learnread" data-lmenu="read" data-i="${i}">${esc(l.n)}. ${esc(l.title)}</button>${l.seen ? ' <span class="learnseen">✓</span>' : ''}</li>`).join('');
  const go = (label: string, lmenu: string, variant: 'primary' | 'secondary' = 'primary'): string =>
    button({ label, variant, className: 'learngobtn', attrs: { 'data-lmenu': lmenu } });
  return sheet({
    open: true, id: 'learnscrim', title: 'Learn to play', width: 'md', className: 'learnscrim learnsheet',
    bodyHtml: `<p class="learnblurb">A real game, with a lesson at each new moment. About twenty minutes.</p>
    <div class="learnlabel">Play one element</div>
    <div class="learnels">${els}</div>
    <div class="learngo">
      ${saved
        ? `${go(`Continue your ${el} ${savedTips ? 'tips ' : ''}game`, 'continue')}${go('Start over', 'fresh', 'secondary')}`
        : go(`Start the ${el} game`, 'start')}
    </div>
    <p class="learnblurb">Already know Algomancy? Play the same game with no rules lessons, only short tips on this client's controls.</p>
    <div class="learngo">${go('Client tips only', 'tips', 'secondary')}</div>
    <details class="learnlist"><summary>Read a lesson</summary><ol>${lessons}</ol></details>`,
  });
}
