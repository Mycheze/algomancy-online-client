/* BL-43 — THE CUSTOM RULES PANEL, on the home screen's Live draft card.
 *
 * Moved out of ui/customrulespanel.ts in the design-system round, 2026-11-03,
 * under the page contract (pages/README.md): customRulesView() reads the
 * module through panelSnapshot(), customRulesHtml(view) draws it and touches
 * nothing else. pages/home.ts draws it into its customRules slot; the module's
 * wirePanel() wires it after the home paint and patches the typing-driven
 * parts (the ban suggestions, the filter's match count, the pool line) in
 * place — the reasons are in that module's header.
 */
import { DEAL_BOUNDS, DEAL_DEFAULTS, DEAL_KNOBS, type DealKnob } from '../../engine/src/draftdeal.ts';
import { button } from '../components/index.ts';
import { panelSnapshot, type PanelSnapshot } from '../customrulespanel.ts';
import { MAX_QUERY_LENGTH } from '../customrules.ts';
import { esc } from '../util.ts';

const KNOB_LABEL: Record<DealKnob, string> = {
  elements: 'Elements', packSize: 'Pack size', openingHand: 'Opening hand', draftDraw: 'Draws per turn', startingLife: 'Starting life',
};

export interface CustomRulesView extends PanelSnapshot {
  /** markup the home screen puts at the top of the open panel — the clock
   * picker (#191). It is NOT a custom rule and the panel knows nothing about
   * it: a clock never makes a game custom, so it never reaches the rules, the
   * create payload or the summary line. */
  extra: string;
}

/** `fixedEls`: the home screen's fixed-element pick when it is in use, so the
 * pool line checks exactly those */
export function customRulesView(fixedEls: readonly string[] | null, extra = ''): CustomRulesView {
  return { ...panelSnapshot(fixedEls), extra };
}

/** The panel. Pure: everything comes in through `v` (customRulesView). */
export function customRulesHtml(v: CustomRulesView): string {
  const { active, rules } = v;
  const stepper = (k: DealKnob): string => {
    const [lo, hi] = DEAL_BOUNDS[k];
    const val = rules[k];
    return `<div class="crknob${val !== DEAL_DEFAULTS[k] ? ' changed' : ''}"><span>${KNOB_LABEL[k]}</span>
      <button data-btn="cr-step" data-knob="${k}" data-d="-1" ${val <= lo ? 'disabled' : ''} aria-label="fewer">−</button>
      <b>${val}</b>
      <button data-btn="cr-step" data-knob="${k}" data-d="1" ${val >= hi ? 'disabled' : ''} aria-label="more">+</button></div>`;
  };
  return `<details class="customrules" data-customrules ${v.open ? 'open' : ''}>
    <summary>Custom rules${active
      ? ` · <b>${esc(v.summary.join(' · '))}</b>`
      : ' <span class="dim">— none set</span>'}</summary>
    ${v.extra}
    <div class="crpresets">
      ${button({ labelHtml: '🌱 Beginner', dataBtn: 'cr-preset', attrs: { 'data-preset': 'beginner' },
        title: 'the rulebook’s Quick Start: two elements, simple cards only, packs of 5' })}
      ${button({ label: 'Back to standard', dataBtn: 'cr-preset', attrs: { 'data-preset': 'standard' }, disabled: !active })}
    </div>
    <button class="crsimple${rules.simpleOnly ? ' on' : ''}" data-btn="cr-simple" aria-pressed="${rules.simpleOnly}">
      <span class="crcheck">${rules.simpleOnly ? '☑' : '☐'}</span> <b>Simple cards only</b>
      <span class="dim">silver-symbol cards · ${v.simpleCount} of ${v.deckCount}</span></button>
    <div class="crknobs">${DEAL_KNOBS.map(stepper).join('')}</div>
    <div class="crbans">
      <div class="zonelabel">Banned cards</div>
      <div class="crchips">${rules.bans.map(n =>
        `<span class="crchip">${esc(n)} <button data-btn="cr-unban" data-name="${esc(n)}" aria-label="unban ${esc(n)}">✕</button></span>`).join('')
        || '<span class="dim">none</span>'}</div>
      <input id="cr-ban" placeholder="type a card name to ban it" autocomplete="off" value="${esc(v.banDraft)}">
      <div id="cr-bansugg" class="crsugg">${v.suggestions}</div>
    </div>
    <details class="cradvanced" ${v.advancedOpen ? 'open' : ''}>
      <summary>Advanced — card filter</summary>
      <input id="cr-query" maxlength="${MAX_QUERY_LENGTH}" placeholder="e.g. -set:lightdark" autocomplete="off"
        spellcheck="false" value="${esc(rules.query)}">
      <div id="cr-querynote" class="dim">${esc(v.queryNote)}</div>
    </details>
    <div id="cr-pool" class="crpool">${v.pool}</div>
  </details>`;
}
