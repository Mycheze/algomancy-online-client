/* CR D8.1 — LEARN TO PLAY: THE MENU.
 *
 * Opened by anything carrying `data-learn` (the home screen's button), off the
 * board, as a layer beside #app — ui/helplayer.ts's pattern, including its
 * scrim rule: `.learnscrim`, never the board's overlay class. Pick an element
 * and start (or continue, or start over), or re-read any lesson.
 *
 * The markup is pages/learn.ts's (the design-system round, 2026-11-03); this
 * file keeps the layer, its clicks and its keys.
 */
import { ALL_LESSONS } from './lessons.ts';
import { openLesson } from './lessonlayer.ts';
import { isLearnElement, type LearnElement } from './lessondeck.ts';
import { loadProgress, type LearnProgress } from './learn.ts';
import { learnMenuHtml, learnMenuView } from './pages/learn.ts';

let open = false;
let layer: HTMLElement | null = null;
let picked: LearnElement = 'fire';

/** the menu for this progress and element: pages/learn.ts draws it */
export const menuHtml = (progress: LearnProgress | null, el: LearnElement): string =>
  learnMenuHtml(learnMenuView(progress, el));

function paint(): void {
  if (!layer) return;
  layer.innerHTML = open ? menuHtml(loadProgress(), picked) : '';
}

export function openLearnMenu(): void {
  const p = loadProgress();
  if (p && isLearnElement(p.element)) picked = p.element;
  open = true;
  paint();
}

export function installLearnMenu(): void {
  if (layer || !document.body || typeof document.body.appendChild !== 'function') return;
  layer = document.createElement('div');
  layer.id = 'learnmenu';
  document.body.appendChild(layer);
  document.addEventListener('click', e => {
    const target = e.target as HTMLElement | null;
    const opener = target?.closest?.('[data-learn]');
    if (opener) { e.preventDefault(); e.stopPropagation(); openLearnMenu(); return; }
    if (!open || !layer || !target || !layer.contains(target)) return;
    e.stopPropagation();
    // off the panel (the sheet's root, its scrim) or its ✕: the sheet's dismiss (pages/learn.ts)
    if (target.id === 'learnscrim' || target.closest('[data-sheet-dismiss]')) { open = false; paint(); return; }
    const btn = target.closest('[data-lmenu]') as HTMLElement | null;
    const go = (fresh: boolean): void => { location.search = `?learn=play&el=${picked}${fresh ? '&new=1' : ''}`; };
    switch (btn?.dataset['lmenu']) {
      case 'close': open = false; paint(); return;
      case 'el': if (isLearnElement(btn.dataset['el'])) picked = btn.dataset['el']; paint(); return;
      case 'start': case 'continue': go(false); return;
      case 'fresh': go(true); return;
      case 'read': {
        const l = ALL_LESSONS[Number(btn.dataset['i'])];
        if (l) { open = false; paint(); openLesson(l); }
        return;
      }
      default: return;
    }
  }, { capture: true });
  document.addEventListener('keydown', e => {
    if (!open) return;
    e.stopPropagation();
    if (e.key === 'Escape') { open = false; paint(); }
  }, { capture: true });
}
