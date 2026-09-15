/* THE ? RULES OVERLAY OFF THE BOARD — home, cards, decks, metagame, account.
 *
 * Owner, 2026-09-15: a new visitor had no way to the rules, the rulebook or
 * the interface guide without first starting a game — the `? rules` button
 * lived only in the board's side rail. This puts the same box one click from
 * every other page: the home screen's "📖 How to play" and the footer's.
 *
 * The box is ui/rules.ts's, unchanged, and IN A GAME it is still the board's
 * own `.overlay` slot in ui/main.ts. Off the board it cannot be a slot in
 * `#app`: every non-board page repaints `#app` itself — the matchmaking
 * ticker repaints the home screen once a second while you search — and a
 * dialog inside it would lose its scroll and its search box on every tick.
 * So it is a LAYER beside `#app`, the ui/report.ts pattern:
 *
 *   · anything carrying `data-help` opens it; the attribute's value is the tab.
 *   · the box's own buttons are `data-btn` (helptab / helpjump / helpclose —
 *     the markup the board shares), so the capture listener claims every click
 *     INSIDE the layer and stops it before main.ts's global handler, which on
 *     the home screen would paint the hotseat board over the page.
 *   · the scrim is `.helpscrim`, never the board's overlay class: 269 counts
 *     every scrim written with that class as a board overlay, and main.ts reads
 *     a click on one as "close the top board dialog".
 *   · a board coming up closes it — in a game, the rail's ? rules is the way in.
 */
import { focusRulesSearch, helpBoxHtml, jumpToSection, setHelpTab } from './rules.ts';

let open = false;
let layer: HTMLElement | null = null;
let installed = false;

const appEl = (): HTMLElement | null => document.getElementById('app');
const onBoard = (): boolean => !!appEl()?.classList?.contains('board');

function paint(): void {
  if (!layer) return;
  layer.innerHTML = open ? `<div class="helpscrim" id="helpscrim">${helpBoxHtml()}</div>` : '';
}

/** open the box on `tab` (rules / book / tutorial), unless a board is up */
export function openHelp(tab?: string): void {
  if (onBoard()) return;
  if (tab) setHelpTab(tab);
  open = true;
  paint();
  focusRulesSearch();
}

export function closeHelp(): void {
  if (!open) return;
  open = false;
  paint();
}

/** Mount the layer beside #app and take over its clicks and keys. Safe in a
 * document with nothing to hang it on (the headless harness): the game never
 * needs it. */
export function installHelpLayer(): void {
  if (installed) return;
  const app = appEl();
  if (!app || !document.body || typeof document.body.appendChild !== 'function') return;
  installed = true;
  layer = document.createElement('div');
  layer.id = 'helplayer';
  document.body.appendChild(layer);

  document.addEventListener('click', e => {
    const target = e.target as HTMLElement | null;
    const opener = target?.closest?.('[data-help]') as HTMLElement | null;
    if (opener) {
      e.preventDefault();
      e.stopPropagation();
      openHelp(opener.dataset['help']);
      return;
    }
    if (!open || !layer || !target || !layer.contains(target)) return;
    e.stopPropagation();
    if (target.id === 'helpscrim') { closeHelp(); return; }
    const btn = target.closest('[data-btn]') as HTMLElement | null;
    switch (btn?.dataset['btn']) {
      case 'helpclose': closeHelp(); return;
      case 'helptab': setHelpTab(btn.dataset['tab']); paint(); focusRulesSearch(); return;
      case 'helpjump': jumpToSection(btn.dataset['sec']); return;
      default: return;   // a link (the rulebook, Discord) keeps its default
    }
  }, { capture: true });

  // While open, no key reaches the page underneath (the card browser's `/`
  // would focus its own search behind the box). Typing still types: that is
  // the key's default, not a listener. The one exception is Escape in a
  // search box with a query — ui/rules.ts clears the query on that first.
  document.addEventListener('keydown', e => {
    if (!open) return;
    const el = e.target as HTMLInputElement | null;
    if (e.key === 'Escape' && el?.id === 'rules-q' && el.value) return;
    e.stopPropagation();
    if (e.key === 'Escape') closeHelp();
  }, { capture: true });

  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => { if (onBoard()) closeHelp(); })
      .observe(app, { attributes: true, attributeFilter: ['class'] });
  }
}
