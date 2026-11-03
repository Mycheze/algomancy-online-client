/* BL-43 — THE CUSTOM RULES, as the home screen's Draft tab draws them.
 *
 * Moved out of ui/customrulespanel.ts in the design-system round, 2026-11-03,
 * under the page contract (pages/README.md): customRulesView() reads the
 * module through panelSnapshot(), and the functions below draw from that view
 * and touch nothing else. ui/customrulespanel.ts's wirePanel() wires them after
 * the home paint and patches the typing-driven parts (the ban suggestions, the
 * filter's match count, the pool line) in place — the reasons are in that
 * module's header.
 *
 * Taken apart the same evening (owner: "Bring as many things out of the Custom
 * Rules modal as possible. It should only be reserved for changing the default
 * 'value settings'"). They used to be one panel in a sheet; now:
 *   modeHtml        the Mode row: Standard | Beginner
 *   cardsHtml       the Cards row: Simple cards only, and the card filter one tap away
 *   bansHtml        the Banned cards row: the chips and the box to ban one
 *   poolLineHtml    the server's verdict on the pool, under the rows
 *   gameValuesHtml  the Game values sheet: the numbers (DEAL_KNOBS), and only those
 * Every id and data-btn the panel had is kept (cr-ban, cr-query, cr-bansugg,
 * cr-querynote, cr-pool; cr-simple, cr-step, cr-ban, cr-unban).
 */
import { DEAL_BOUNDS, DEAL_DEFAULTS, DEAL_KNOBS, type DealKnob } from '../../engine/src/draftdeal.ts';
import { button, segmented, toggle } from '../components/index.ts';
import { panelSnapshot, type PanelSnapshot } from '../customrulespanel.ts';
import { BEGINNER_RULES, MAX_QUERY_LENGTH, rulesSummary } from '../customrules.ts';
import { esc } from '../util.ts';

const KNOB_LABEL: Record<DealKnob, string> = {
  elements: 'Elements', packSize: 'Pack size', openingHand: 'Opening hand', draftDraw: 'Draws per turn', startingLife: 'Starting life',
};

export type CustomRulesView = PanelSnapshot;

/** `fixedEls`: the home screen's fixed-element pick when it is in use, so the
 * pool line checks exactly those */
export function customRulesView(fixedEls: readonly string[] | null): CustomRulesView {
  return panelSnapshot(fixedEls);
}

/** what Beginner is, in one line — read off BEGINNER_RULES, so it cannot drift from what is sent */
export const BEGINNER_HINT = `The rulebook’s Quick Start: ${rulesSummary(BEGINNER_RULES).join(', ').toLowerCase()}.`;

/** the Mode row: Standard | Beginner (cr-beginner data-on=0|1) */
export function modeHtml(v: CustomRulesView): string {
  return segmented({
    ariaLabel: 'Mode', size: 'sm',
    options: [
      { label: 'Standard', value: 'standard', on: !v.beginner, dataBtn: 'cr-beginner', attrs: { 'data-on': '0' },
        title: v.beginner ? 'back to the standard game' : 'the full game' },
      { label: 'Beginner', value: 'beginner', on: v.beginner, dataBtn: 'cr-beginner', attrs: { 'data-on': '1' },
        title: 'the rulebook’s Quick Start: two elements (Fire + Wood suggested), simple cards only, packs of 5' },
    ],
  });
}

/** the Cards row: "Simple cards only" (its own control, never inside the
 * filter — the owner: "so that it's not hard to miss"), and the Advanced card
 * filter's box one tap away (cr-advanced; always shown while a filter is set) */
export function cardsHtml(v: CustomRulesView): string {
  const { rules } = v;
  const filterBtn = rules.query
    ? ''
    : button({ label: v.advancedOpen ? 'Hide the card filter' : 'Card filter…', variant: 'link', size: 'sm', dataBtn: 'cr-advanced',
      className: 'cradvbtn', attrs: { 'aria-expanded': v.advancedOpen ? 'true' : 'false' } });
  return `<div class="crcards">
      ${toggle({ label: 'Simple cards only', on: rules.simpleOnly, size: 'sm', dataBtn: 'cr-simple', className: 'crsimple',
        title: `silver-symbol cards only · ${v.simpleCount} of ${v.deckCount}` })}
      ${filterBtn}
    </div>${v.advancedOpen ? `<div class="cradvanced">
      <input id="cr-query" maxlength="${MAX_QUERY_LENGTH}" placeholder="card filter, e.g. -set:lightdark" autocomplete="off"
        spellcheck="false" aria-label="Card filter" value="${esc(rules.query)}">
      <div id="cr-querynote" class="dim">${esc(v.queryNote)}</div>
    </div>` : ''}`;
}

/** the Banned cards row: a removable chip per ban, then the box that bans one
 * (its suggestions hang under it, patched in place while typing) */
export function bansHtml(v: CustomRulesView): string {
  return `<div class="crbans">${v.rules.bans.map(n =>
    `<span class="crchip">${esc(n)} <button data-btn="cr-unban" data-name="${esc(n)}" aria-label="unban ${esc(n)}">✕</button></span>`).join('')}
      <span class="crbanbox"><input id="cr-ban" placeholder="Ban a card…" autocomplete="off" aria-label="Ban a card" value="${esc(v.banDraft)}">
      <span id="cr-bansugg" class="crsugg">${v.suggestions}</span></span>
    </div>`;
}

/** the server's verdict on the pool these rules leave (empty for a standard game) */
export function poolLineHtml(v: CustomRulesView): string {
  return `<div id="cr-pool" class="crpool">${v.pool}</div>`;
}

/** The Game values sheet's body: the numbers, and only those. */
export function gameValuesHtml(v: CustomRulesView): string {
  const { rules } = v;
  const stepper = (k: DealKnob): string => {
    const [lo, hi] = DEAL_BOUNDS[k];
    const val = rules[k];
    return `<div class="crknob${val !== DEAL_DEFAULTS[k] ? ' changed' : ''}"><span>${KNOB_LABEL[k]}</span>
      <button data-btn="cr-step" data-knob="${k}" data-d="-1" ${val <= lo ? 'disabled' : ''} aria-label="fewer">−</button>
      <b>${val}</b>
      <button data-btn="cr-step" data-knob="${k}" data-d="1" ${val >= hi ? 'disabled' : ''} aria-label="more">+</button></div>`;
  };
  return `<div class="crvalues">
    <div class="crknobs">${DEAL_KNOBS.map(stepper).join('')}</div>
    <div class="crvaluesfoot">${button({ label: 'Back to the standard values', size: 'sm', dataBtn: 'cr-values', disabled: v.values.length === 0 })}</div>
  </div>`;
}
