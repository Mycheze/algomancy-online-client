/* BL-43 — CUSTOM RULES ON A LIVE DRAFT: WHAT THE CREATOR CHOSE.
 *
 * Two objects, deliberately apart:
 *   CustomRules — what the room creator picked on the home screen: the
 *     numbers, "Simple cards only", the banned cards, the advanced card filter.
 *     Kept with the room for the lobby panel, the history tag and a rematch.
 *   DraftDeal (engine/src/draftdeal.ts) — what the engine deals: the numbers
 *     and a concrete list of excluded card names.
 *
 * `resolveCustomRules` turns the first into the second, and it runs ONCE, when
 * the room is created. Nothing downstream re-resolves: restore, rebuild,
 * rematch, the stats fold and the forensic replay all read the resolved deal,
 * so a later classifier run or a change to the search grammar can never
 * rewrite a game already played.
 *
 * PURE and free of any browser API, like the search files it imports: the
 * server imports this module (engine/test/282-dom-free-trio guards both).
 * The home screen runs the same functions for instant feedback; the server's
 * answer is the one that counts.
 */
import type { Element } from '../engine/src/types.ts';
import { ALL_ELEMENTS, sanitizeTrio } from '../engine/src/apply.ts';
import { DECK_LIST } from '../engine/src/cards/registry.ts';
import {
  DEAL_BOUNDS, DEAL_DEFAULTS, DEAL_KNOBS, draftPool, minPool, sanitizeDraftDeal,
  type DealKnob, type DraftDeal,
} from '../engine/src/draftdeal.ts';
import { rowFor, type CardRow } from './cardindex.ts';
import { search } from './cardsearch.ts';

export type RulesPreset = 'beginner';

export interface CustomRules {
  v: 1;
  /** the preset the creator started from, if any — display only */
  preset: RulesPreset | null;
  elements: number;
  packSize: number;
  openingHand: number;
  draftDraw: number;
  startingLife: number;
  /** "Simple cards only": the silver-symbol cards (catalogue complexity Simple) */
  simpleOnly: boolean;
  /** card names, in the order they were banned */
  bans: string[];
  /** an advanced card-search filter: only cards matching it are in the pool */
  query: string;
}

/** longest card-filter query kept; anything past it is dropped */
export const MAX_QUERY_LENGTH = 300;

export const STANDARD_RULES: Readonly<CustomRules> = {
  v: 1, preset: null, ...DEAL_DEFAULTS, simpleOnly: false, bans: [], query: '',
} as CustomRules;

/** The rulebook Quick Start, softened for a first online game: two elements
 * (the home screen suggests fire + wood, the rulebook's pair), simple cards
 * only, and packs of 5 so a newcomer reads eleven cards at a draft, not sixteen. */
export const BEGINNER_RULES: Readonly<CustomRules> = {
  ...STANDARD_RULES, preset: 'beginner', elements: 2, packSize: 5, simpleOnly: true,
};

export function isStandardRules(r: CustomRules): boolean {
  return !r.simpleOnly && r.bans.length === 0 && r.query === ''
    && DEAL_KNOBS.every(k => r[k] === DEAL_DEFAULTS[k]);
}

const DECK_SET = new Set(DECK_LIST);

/** Clamp and clean. `null` when what is left is the standard game (a preset
 * name alone does not make a game custom). Never throws. */
export function sanitizeCustomRules(raw: unknown): CustomRules | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const knobs = {} as Record<DealKnob, number>;
  for (const k of DEAL_KNOBS) {
    const v = r[k];
    const [lo, hi] = DEAL_BOUNDS[k];
    knobs[k] = typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : DEAL_DEFAULTS[k];
  }
  const bans = [...new Set(Array.isArray(r['bans']) ? r['bans'].filter((n): n is string => typeof n === 'string' && DECK_SET.has(n)) : [])];
  const query = typeof r['query'] === 'string' ? r['query'].trim().slice(0, MAX_QUERY_LENGTH) : '';
  const rules: CustomRules = {
    v: 1,
    preset: r['preset'] === 'beginner' ? 'beginner' : null,
    ...knobs,
    simpleOnly: r['simpleOnly'] === true,
    bans,
    query,
  };
  return isStandardRules(rules) ? null : rules;
}

let DECK_ROWS: CardRow[] | null = null;
/** the catalogue row of every deck card — the pool a card filter runs over */
function deckRows(): CardRow[] {
  return DECK_ROWS ??= DECK_LIST.map(n => rowFor(n)).filter((r): r is CardRow => !!r);
}

export interface Resolved {
  /** undefined when the rules deal the standard game after all */
  deal?: DraftDeal;
  /** a reason the rules cannot be used as written; non-empty means refuse */
  errors: string[];
}

/** The rules as a concrete deal: every deck card NOT in the pool is listed by
 * name. Computed over the whole deck, not over any one set of elements, so it
 * can be resolved before the lobby has picked them. */
export function resolveCustomRules(rules: CustomRules | null): Resolved {
  if (!rules) return { errors: [] };
  const errors: string[] = [];
  const excluded = new Set<string>();
  if (rules.simpleOnly) {
    // a card with no catalogue row cannot be shown to be simple, so it is out
    for (const n of DECK_LIST) if (rowFor(n)?.complexityLc !== 'simple') excluded.add(n);
  }
  for (const n of rules.bans) excluded.add(n);
  if (rules.query) {
    const result = search(rules.query, { pool: deckRows(), implicit: false });
    // the parser is tolerant — it guesses at what it could not read. A guess is
    // not what the creator asked for, so a query it had to guess at is refused.
    for (const e of result.query.errors) errors.push(`Card filter: ${e.message}`);
    const keep = new Set(result.rows.map(r => r.name));
    for (const n of DECK_LIST) if (!keep.has(n)) excluded.add(n);
  }
  const deal = sanitizeDraftDeal({
    ...Object.fromEntries(DEAL_KNOBS.map(k => [k, rules[k]])),
    excluded: [...excluded],
  });
  return { ...(deal ? { deal } : {}), errors };
}

/** every set of `count` elements, in canonical order */
export function elementSets(count: number): Element[][] {
  const out: Element[][] = [];
  const walk = (from: number, picked: Element[]): void => {
    if (picked.length === count) { out.push(picked); return; }
    for (let i = from; i < ALL_ELEMENTS.length; i++) walk(i + 1, [...picked, ALL_ELEMENTS[i]!]);
  };
  walk(0, []);
  return out;
}

/** The elements a creator fixed at creation, if they fixed exactly `count` real
 * ones — otherwise undefined, and the lobby will choose. */
export function fixedElements(els: unknown, count: number): Element[] | undefined {
  if (!Array.isArray(els)) return undefined;
  const picked = ALL_ELEMENTS.filter(e => els.includes(e));
  return picked.length === count ? picked : undefined;
}

export interface PoolSize { els: Element[]; size: number }

export interface PoolCheck {
  ok: boolean;
  /** the smallest pool these rules play well from (draftdeal.ts minPool) */
  floor: number;
  /** the set that leaves the fewest cards, and the one that leaves the most */
  worst: PoolSize;
  best: PoolSize;
  /** one sentence for the settings panel — what the pool is, or how to fix it */
  message: string;
}

const list = (els: Element[]): string => els.join(' + ');

/**
 * Is the pool big enough? With `fixedEls` the creator has already chosen the
 * elements and only that set is checked. Without, the lobby will choose them
 * later, so EVERY set of that size is checked and the worst must pass — the
 * lobby can then never land below the floor, and neither can a rematch.
 */
export function poolCheck(deal: DraftDeal | undefined, fixedEls?: readonly Element[]): PoolCheck {
  const count = deal?.elements ?? DEAL_DEFAULTS.elements;
  const sets = fixedEls ? [sanitizeTrio([...fixedEls], count)] : elementSets(count);
  const sizes = sets.map(els => ({ els, size: draftPool(els, deal).length }));
  const worst = sizes.reduce((a, b) => (b.size < a.size ? b : a));
  const best = sizes.reduce((a, b) => (b.size > a.size ? b : a));
  const floor = minPool(deal);
  const ok = worst.size >= floor;
  let message: string;
  if (fixedEls) {
    message = ok
      ? `${list(worst.els)}: a pool of ${worst.size} cards (these rules need ${floor}).`
      : `${list(worst.els)} leaves only ${worst.size} cards and these rules need ${floor}. Try smaller packs, fewer cards dealt, or fewer restrictions.`;
  } else if (ok) {
    message = `Every choice of ${count} elements leaves at least ${worst.size} cards (these rules need ${floor}).`;
  } else if (best.size >= floor) {
    message = `${list(worst.els)} would leave only ${worst.size} cards and these rules need ${floor}. Choose the elements now (${list(best.els)} has ${best.size}) or use smaller packs.`;
  } else {
    message = `No choice of ${count} elements leaves enough cards: the most is ${best.size} (${list(best.els)}) and these rules need ${floor}. Try smaller packs, fewer cards dealt, or fewer restrictions.`;
  }
  return { ok, floor, worst, best, message };
}

export interface RulesVerdict {
  /** null: play the standard game */
  rules: CustomRules | null;
  deal?: DraftDeal;
  /** set when the rules must be refused, saying why */
  error?: string;
  check?: PoolCheck;
}

/** Everything the server does with a creator's rules, in one call: clean,
 * resolve, check the pool. Rules that turn out to deal the standard game come
 * back as `rules: null`. */
export function checkCustomRules(raw: unknown, fixedEls?: readonly Element[]): RulesVerdict {
  const rules = sanitizeCustomRules(raw);
  const { deal, errors } = resolveCustomRules(rules);
  if (errors.length) return { rules, error: errors.join(' ') };
  if (!rules || !deal) return { rules: null };
  const check = poolCheck(deal, fixedEls);
  return check.ok ? { rules, deal, check } : { rules, deal, check, error: check.message };
}

/** The non-default rules as short lines, for the lobby panel and the history tag. */
export function rulesSummary(rules: CustomRules): string[] {
  const out: string[] = [];
  if (rules.elements !== DEAL_DEFAULTS.elements) out.push(`${rules.elements} elements`);
  if (rules.packSize !== DEAL_DEFAULTS.packSize) out.push(`Packs of ${rules.packSize}`);
  if (rules.simpleOnly) out.push('Simple cards only');
  if (rules.openingHand !== DEAL_DEFAULTS.openingHand) out.push(`Opening hand of ${rules.openingHand}`);
  if (rules.draftDraw !== DEAL_DEFAULTS.draftDraw) out.push(`Draw ${rules.draftDraw} a turn`);
  if (rules.startingLife !== DEAL_DEFAULTS.startingLife) out.push(`${rules.startingLife} starting life`);
  if (rules.bans.length) out.push(`Banned: ${rules.bans.join(', ')}`);
  if (rules.query) out.push(`Card filter: ${rules.query}`);
  return out;
}
