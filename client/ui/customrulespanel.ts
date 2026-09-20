/* BL-43 — the Custom rules panel on the home screen's Live draft card.
 *
 * Smash-style: a normal game needs no settings, so the panel starts closed and
 * its defaults send nothing at all — `createPayload` is null for them, and the
 * room is made by the same GET /api/new every standard game uses. Change a
 * knob and the rules ride a POST instead; the server resolves and pool-checks
 * them with the very functions this panel previews with (ui/customrules.ts),
 * and the server's answer is the one that counts.
 *
 * "Simple cards only" is its own control, near the top, and entirely separate
 * from the Advanced card filter — the owner: "so that it's not hard to miss".
 *
 * Typing never repaints the home screen: the ban suggestions, the filter's
 * match count and the pool line are patched in place, so the input keeps its
 * focus and a click on the Create button right after typing is not eaten by a
 * repaint that replaced the button under the pointer.
 */
import { DECK_LIST } from '../engine/src/cards/registry.ts';
import { DEAL_BOUNDS, DEAL_DEFAULTS, DEAL_KNOBS, type DealKnob } from '../engine/src/draftdeal.ts';
import {
  BEGINNER_RULES, MAX_QUERY_LENGTH, STANDARD_RULES, checkCustomRules, elementSets, fixedElements,
  resolveCustomRules, rulesSummary, sanitizeCustomRules, type CustomRules, type RulesVerdict,
} from './customrules.ts';
import { esc } from './util.ts';

const STORE_KEY = 'algoCustomRules';

const KNOB_LABEL: Record<DealKnob, string> = {
  elements: 'Elements', packSize: 'Pack size', openingHand: 'Opening hand', draftDraw: 'Draws per turn', startingLife: 'Starting life',
};
const KNOB_STEP: Record<DealKnob, number> = { elements: 1, packSize: 1, openingHand: 1, draftDraw: 1, startingLife: 5 };

const standard = (): CustomRules => ({ ...STANDARD_RULES, bans: [] });

function load(): CustomRules {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORE_KEY);
    return sanitizeCustomRules(raw ? JSON.parse(raw) : null) ?? standard();
  } catch { return standard(); }
}

let rules: CustomRules = load();
let open = false;
let advancedOpen = rules.query !== '';
let banDraft = '';
let focusBan = false;
/** the fixed elements the panel was last drawn for — the in-place pool line uses them */
let lastFixed: readonly string[] | null = null;

function save(): void {
  try {
    if (sanitizeCustomRules(rules)) localStorage.setItem(STORE_KEY, JSON.stringify(rules));
    else localStorage.removeItem(STORE_KEY);
  } catch { /* storage refused (private mode): the panel still works for this page */ }
}

/** the rules to create a room with, or null for a standard game */
export function activeRules(): CustomRules | null {
  return sanitizeCustomRules(rules);
}

/** how many elements the draft will be played with */
export function elementCount(): number {
  return activeRules()?.elements ?? DEAL_DEFAULTS.elements;
}

/** how many element sets of that size there are — the 🎲's reach */
export function setCount(): number {
  return elementSets(elementCount()).length;
}

/** the server's verdict, previewed: `rules: null` is a standard game, `error` a refusal */
export function verdict(fixedEls: readonly string[] | null): RulesVerdict {
  const r = activeRules();
  if (!r) return { rules: null };
  return checkCustomRules(r, fixedEls ? fixedElements(fixedEls, r.elements) : undefined);
}

/** what POST /api/new is sent — or null, and a standard game is a plain GET */
export function createPayload(fixedEls: readonly string[] | null): { rules: CustomRules; els?: string[] } | null {
  const r = activeRules();
  if (!r) return null;
  const fixed = fixedEls ? fixedElements(fixedEls, r.elements) : undefined;
  return { rules: r, ...(fixed ? { els: fixed } : {}) };
}

let SIMPLE_COUNT: number | null = null;
const simpleCount = (): number =>
  SIMPLE_COUNT ??= DECK_LIST.length - (resolveCustomRules({ ...standard(), simpleOnly: true }).deal?.excluded.length ?? 0);

function suggestionsHtml(): string {
  const q = banDraft.trim().toLowerCase();
  if (q.length < 2) return '';
  const hits = DECK_LIST.filter(n => !rules.bans.includes(n) && n.toLowerCase().includes(q)).slice(0, 8);
  return hits.length
    ? hits.map(n => `<button data-btn="cr-ban" data-name="${esc(n)}">${esc(n)}</button>`).join('')
    : '<span class="dim">no card by that name</span>';
}

function queryNote(): string {
  if (!rules.query) return 'Same syntax as the 🔍 Cards page.';
  const r = resolveCustomRules({ ...standard(), query: rules.query });
  if (r.errors.length) return r.errors.join(' ');
  return `${DECK_LIST.length - (r.deal?.excluded.length ?? 0)} of ${DECK_LIST.length} cards match.`;
}

function poolHtml(): string {
  if (!activeRules()) return '';
  const v = verdict(lastFixed);
  if (v.error) return `<span class="crbad">✗ ${esc(v.error)}</span>`;
  return v.check ? `<span class="crok">✓ ${esc(v.check.message)}</span>` : '';
}

/** The panel. `fixedEls` is the home screen's fixed-element pick when it is in
 * use, so the pool line checks exactly those. */
export function panelHtml(fixedEls: readonly string[] | null): string {
  lastFixed = fixedEls;
  const active = activeRules();
  const stepper = (k: DealKnob): string => {
    const [lo, hi] = DEAL_BOUNDS[k];
    const val = rules[k];
    return `<div class="crknob${val !== DEAL_DEFAULTS[k] ? ' changed' : ''}"><span>${KNOB_LABEL[k]}</span>
      <button data-btn="cr-step" data-knob="${k}" data-d="-1" ${val <= lo ? 'disabled' : ''} aria-label="fewer">−</button>
      <b>${val}</b>
      <button data-btn="cr-step" data-knob="${k}" data-d="1" ${val >= hi ? 'disabled' : ''} aria-label="more">+</button></div>`;
  };
  return `<details class="customrules" data-customrules ${open ? 'open' : ''}>
    <summary>Custom rules${active
      ? ` · <b>${esc(rulesSummary(active).join(' · '))}</b>`
      : ' <span class="dim">— none set</span>'}</summary>
    <div class="crpresets">
      <button data-btn="cr-preset" data-preset="beginner"
        title="the rulebook’s Quick Start: two elements, simple cards only, packs of 5">🌱 Beginner</button>
      <button data-btn="cr-preset" data-preset="standard" ${active ? '' : 'disabled'}>Back to standard</button>
    </div>
    <button class="crsimple${rules.simpleOnly ? ' on' : ''}" data-btn="cr-simple" aria-pressed="${rules.simpleOnly}">
      <span class="crcheck">${rules.simpleOnly ? '☑' : '☐'}</span> <b>Simple cards only</b>
      <span class="dim">silver-symbol cards · ${simpleCount()} of ${DECK_LIST.length}</span></button>
    <div class="crknobs">${DEAL_KNOBS.map(stepper).join('')}</div>
    <div class="crbans">
      <div class="zonelabel">Banned cards</div>
      <div class="crchips">${rules.bans.map(n =>
        `<span class="crchip">${esc(n)} <button data-btn="cr-unban" data-name="${esc(n)}" aria-label="unban ${esc(n)}">✕</button></span>`).join('')
        || '<span class="dim">none</span>'}</div>
      <input id="cr-ban" placeholder="type a card name to ban it" autocomplete="off" value="${esc(banDraft)}">
      <div id="cr-bansugg" class="crsugg">${suggestionsHtml()}</div>
    </div>
    <details class="cradvanced" ${advancedOpen ? 'open' : ''}>
      <summary>Advanced — card filter</summary>
      <input id="cr-query" maxlength="${MAX_QUERY_LENGTH}" placeholder="e.g. -set:lightdark" autocomplete="off"
        spellcheck="false" value="${esc(rules.query)}">
      <div id="cr-querynote" class="dim">${esc(queryNote())}</div>
    </details>
    <div id="cr-pool" class="crpool">${poolHtml()}</div>
  </details>`;
}

/** The panel's buttons. Returns true when the click was ours; the caller repaints. */
export function handlePanelButton(b: string | undefined, btn: HTMLElement): boolean {
  switch (b) {
    case 'cr-preset':
      rules = btn.dataset['preset'] === 'beginner' ? { ...BEGINNER_RULES, bans: [] } : standard();
      banDraft = '';
      advancedOpen = false;
      break;
    case 'cr-simple':
      rules = { ...rules, simpleOnly: !rules.simpleOnly, preset: null };
      break;
    case 'cr-step': {
      const k = btn.dataset['knob'] as DealKnob;
      if (!DEAL_KNOBS.includes(k)) return true;
      const [lo, hi] = DEAL_BOUNDS[k];
      const next = rules[k] + Number(btn.dataset['d'] ?? 0) * KNOB_STEP[k];
      rules = { ...rules, [k]: Math.min(hi, Math.max(lo, next)), preset: null };
      break;
    }
    case 'cr-ban': {
      const n = btn.dataset['name'];
      if (n && DECK_LIST.includes(n) && !rules.bans.includes(n)) rules = { ...rules, bans: [...rules.bans, n], preset: null };
      banDraft = '';
      focusBan = true;
      break;
    }
    case 'cr-unban':
      rules = { ...rules, bans: rules.bans.filter(n => n !== btn.dataset['name']), preset: null };
      break;
    default:
      return false;
  }
  open = true;
  save();
  return true;
}

/** After the home screen paints: keep the open/closed state, and patch the
 * typing-driven parts in place (see the header). */
export function wirePanel(): void {
  const root = document.querySelector('[data-customrules]') as HTMLDetailsElement | null;
  if (!root) return;
  root.addEventListener('toggle', () => { open = root.open; });
  const adv = root.querySelector('.cradvanced') as HTMLDetailsElement | null;
  adv?.addEventListener('toggle', () => { advancedOpen = adv.open; });

  const ban = document.getElementById('cr-ban') as HTMLInputElement | null;
  ban?.addEventListener('input', () => {
    banDraft = ban.value;
    const list = document.getElementById('cr-bansugg');
    if (list) list.innerHTML = suggestionsHtml();
  });
  ban?.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    (document.querySelector('#cr-bansugg [data-btn="cr-ban"]') as HTMLElement | null)?.click();
  });
  if (focusBan && ban) { ban.focus(); focusBan = false; }

  const query = document.getElementById('cr-query') as HTMLInputElement | null;
  query?.addEventListener('input', () => {
    rules = { ...rules, query: query.value.trim().slice(0, MAX_QUERY_LENGTH), preset: null };
    save();
    const note = document.getElementById('cr-querynote');
    if (note) note.textContent = queryNote();
    const pool = document.getElementById('cr-pool');
    if (pool) pool.innerHTML = poolHtml();
  });
  query?.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
}
