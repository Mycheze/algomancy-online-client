/* CR D8.2 — THE SINGLE CARD DUEL CARD PICKER: the chosen card's scan, a
 * type-ahead and a 🎲. Drawn in two places: the home screen's Single Card Duel
 * fold (pages/home.ts) and the waiting room (pages/waiting.ts), each as a slot.
 *
 * Moved out of ui/singlecard.ts in the design-system round, 2026-11-03, under
 * the page contract (pages/README.md): singleCardPickerView() reads the module
 * (pickerSnapshot), singleCardPickerHtml(view) draws it and touches nothing
 * else. ui/singlecard.ts keeps the pick, the sc- clicks and wire(), which
 * patches the suggestions in place while typing. BLIND: nothing here says
 * which card the opponent brought.
 */
import { button } from '../components/index.ts';
import { pickerSnapshot, type PickerSnapshot } from '../singlecard.ts';
import { esc } from '../util.ts';

export type SingleCardPickerView = PickerSnapshot;

export function singleCardPickerView(): SingleCardPickerView {
  return pickerSnapshot();
}

/** The picker. Pure: everything comes in through `v`. */
export function singleCardPickerHtml(v: SingleCardPickerView): string {
  const cur = v.card;
  return `<div class="scpick">
    <div class="scchosen">${cur
      ? `<span class="scart" data-prev="${esc(cur)}">${v.art}</span>
         <span class="scname"><b>${esc(cur)}</b><span class="dim">× ${v.copies}</span>${v.makesUnits ? ''
           : `<span class="scwarn" title="a deck of this card can never put a unit on the table">makes no units — a draw if theirs doesn’t either</span>`}</span>`
      : '<span class="dim">no card picked yet</span>'}</div>
    <div class="joinrow">
      <input id="sc-q" placeholder="find a card…" spellcheck="false" autocomplete="off" value="${esc(v.draft)}">
      ${button({ label: '🎲', variant: 'icon', title: `any card at random — any of the ${v.deckCount}`, dataBtn: 'sc-random' })}
    </div>
    <div id="sc-sugg" class="crsugg">${v.suggestions}</div>
  </div>`;
}
