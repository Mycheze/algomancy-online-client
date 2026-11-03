/* BL-43 — the Custom rules on the home screen's Draft tab.
 *
 * Smash-style: a normal game needs no settings, and its defaults send nothing
 * at all — `createPayload` is null for them, and the room is made by the same
 * GET /api/new every standard game uses. Change something and the rules ride
 * a POST instead; the server resolves and pool-checks them with the very
 * functions this module previews with (ui/customrules.ts), and the server's
 * answer is the one that counts.
 *
 * WHERE THEY ARE DRAWN (owner, 2026-11-03: "Bring as many things out of the
 * Custom Rules modal as possible. It should only be reserved for changing the
 * default 'value settings'… And 'beginner mode' should be an easier to reach
 * toggle"): on the Draft tab itself — Mode (Standard | Beginner), Cards
 * ("Simple cards only", the Advanced card filter one tap away), Banned cards,
 * and the pool line — and only the numbers (DEAL_KNOBS) in the Game values
 * sheet. One rules object, one store, one payload: where a control sits
 * changes nothing that reaches the server.
 *
 * "Simple cards only" is its own control, apart from the Advanced card filter —
 * the owner: "so that it's not hard to miss".
 *
 * Typing never repaints the home screen: the ban suggestions, the filter's
 * match count and the pool line are patched in place, so the input keeps its
 * focus and a click on the Create button right after typing is not eaten by a
 * repaint that replaced the button under the pointer.
 *
 * The markup is pages/customrules.ts: this module keeps the rules, their
 * storage, the server-verdict preview, the cr- clicks and the in-place typing
 * patches (wirePanel), and hands the page what it shows through panelSnapshot().
 */
import { DECK_LIST } from '../engine/src/cards/registry.ts';
import { DEAL_BOUNDS, DEAL_DEFAULTS, DEAL_KNOBS, type DealKnob } from '../engine/src/draftdeal.ts';
import {
  BEGINNER_RULES, MAX_QUERY_LENGTH, STANDARD_RULES, checkCustomRules, elementSets, fixedElements, isBeginnerRules,
  resolveCustomRules, rulesSummary, sanitizeCustomRules, valuesSummary, type CustomRules, type RulesVerdict,
} from './customrules.ts';
import { esc } from './util.ts';

const STORE_KEY = 'algoCustomRules';

const KNOB_STEP: Record<DealKnob, number> = { elements: 1, packSize: 1, openingHand: 1, draftDraw: 1, startingLife: 5 };

const standard = (): CustomRules => ({ ...STANDARD_RULES, bans: [] });

function load(): CustomRules {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORE_KEY);
    return sanitizeCustomRules(raw ? JSON.parse(raw) : null) ?? standard();
  } catch { return standard(); }
}

let rules: CustomRules = load();
/** the card filter's box is shown (one tap away on the Draft tab); always, while a filter is set */
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

/** the Beginner game is in effect (the Mode row's Beginner) — derived from the
 * rules, so a ban or a life total on top of it keeps it Beginner */
export function beginnerOn(): boolean {
  return isBeginnerRules(activeRules());
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

/** Everything the panel shows (pages/customrules.ts draws it). `fixedEls` is
 * the home screen's fixed-element pick when it is in use, so the pool line
 * checks exactly those — and the in-place pool line (wirePanel) keeps using
 * them until the next paint. */
export interface PanelSnapshot {
  /** the rules a room would be made with, or null for a standard game */
  active: CustomRules | null;
  /** the knobs as set (a standard game's are the defaults) */
  rules: CustomRules;
  /** the active rules in a line each (rulesSummary), or [] */
  summary: string[];
  /** only the value settings that differ, short (valuesSummary) — the Game values row */
  values: string[];
  /** the Beginner game is in effect (isBeginnerRules) */
  beginner: boolean;
  /** the card filter's box is showing (always, while a filter is set) */
  advancedOpen: boolean;
  banDraft: string;
  /** cards in the pool, and how many of them are simple */
  deckCount: number;
  simpleCount: number;
  /** the typing-driven parts, drawn: wirePanel patches the same three in place */
  suggestions: string;
  queryNote: string;
  pool: string;
}

export function panelSnapshot(fixedEls: readonly string[] | null): PanelSnapshot {
  lastFixed = fixedEls;
  const active = activeRules();
  return {
    active, rules, summary: active ? rulesSummary(active) : [], values: valuesSummary(active), beginner: isBeginnerRules(active),
    advancedOpen: advancedOpen || rules.query !== '', banDraft,
    deckCount: DECK_LIST.length, simpleCount: simpleCount(),
    suggestions: suggestionsHtml(), queryNote: queryNote(), pool: poolHtml(),
  };
}

/** The panel's buttons. Returns true when the click was ours; the caller repaints. */
export function handlePanelButton(b: string | undefined, btn: HTMLElement): boolean {
  switch (b) {
    case 'cr-preset':
      rules = btn.dataset['preset'] === 'beginner' ? { ...BEGINNER_RULES, bans: [] } : standard();
      banDraft = '';
      advancedOpen = false;
      break;
    case 'cr-beginner':
      // the Mode row: Beginner is the preset above; Standard, from Beginner,
      // is the standard game again — and from anything else changes nothing,
      // so a click on the Standard already showing never wipes a ban list
      if (btn.dataset['on'] === '1') {
        rules = { ...BEGINNER_RULES, bans: [] };
      } else if (isBeginnerRules(activeRules())) {
        rules = standard();
      } else return true;
      banDraft = '';
      advancedOpen = false;
      break;
    case 'cr-advanced':
      // the card filter's box, one tap away on the Draft tab: no rule changes
      // (a filter that is set keeps its box: it cannot be hidden while in force)
      advancedOpen = rules.query !== '' || !advancedOpen;
      return true;
    case 'cr-values':
      // the Game values sheet's "Back to the standard values": the numbers
      // only — the cards rules (simple, bans, filter) stay as they are
      rules = { ...rules, ...DEAL_DEFAULTS, preset: null };
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
  save();
  return true;
}

/** After the home screen paints: patch the typing-driven parts in place (see
 * the header). The boxes are found by id wherever the page drew them. */
export function wirePanel(): void {
  if (typeof document === 'undefined') return;
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
    // emptied by typing, the box stays: a repaint (the queue poll) must not
    // take it away from under the caret
    advancedOpen = true;
    save();
    const note = document.getElementById('cr-querynote');
    if (note) note.textContent = queryNote();
    const pool = document.getElementById('cr-pool');
    if (pool) pool.innerHTML = poolHtml();
  });
  query?.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
}
