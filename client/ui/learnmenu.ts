/* R297 — LEARN TO PLAY: THE MENU.
 *
 * Opened by anything carrying `data-learn` (the home screen's button), off the
 * board, as a layer beside #app — ui/helplayer.ts's pattern, including its
 * scrim rule: `.learnscrim`, never the board's overlay class. Pick an element
 * and start (or continue, or start over), or re-read any lesson.
 */
import { esc } from './util.ts';
import { ALL_LESSONS } from './lessons.ts';
import { openLesson } from './lessonlayer.ts';
import { LEARN_ELEMENTS, isLearnElement, type LearnElement } from './lessondeck.ts';
import { loadProgress, type LearnProgress } from './learn.ts';

let open = false;
let layer: HTMLElement | null = null;
let picked: LearnElement = 'fire';

const ICON: Record<LearnElement, string> = { fire: '🔥', water: '💧', earth: '⛰️', wood: '🌿', metal: '⚙️' };

/** the turn the saved game is on, read off its log length rather than replayed */
export function menuHtml(progress: LearnProgress | null, el: LearnElement): string {
  const saved = progress?.game && progress.element === el;
  const els = LEARN_ELEMENTS.map(e =>
    `<button class="learnel el-${e} ${e === el ? 'on' : ''}" data-lmenu="el" data-el="${e}">${ICON[e]} ${e[0]!.toUpperCase()}${e.slice(1)}</button>`).join('');
  const seen = new Set(progress?.seen ?? []);
  const lessons = ALL_LESSONS.map((l, i) =>
    `<li><button class="learnread" data-lmenu="read" data-i="${i}">${esc(l.n)}. ${esc(l.title)}</button>${seen.has(l.id) ? ' <span class="learnseen">✓</span>' : ''}</li>`).join('');
  return `<div class="learnscrim" id="learnscrim"><div class="learnbox" role="dialog" aria-label="Learn to play">
    <div class="lhead"><h3>📘 Learn to play</h3><button data-lmenu="close">✕</button></div>
    <p class="learnblurb">A real game, with a lesson at each new moment: the parts of a card, resources, deployment, attributes, combat, battle spells and viruses, augments, grafts and haste. About twenty minutes.</p>
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
    if (target.id === 'learnscrim') { open = false; paint(); return; }
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
