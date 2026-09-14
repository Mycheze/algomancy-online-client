/* BL-43 — CUSTOM RULES ON A LIVE DRAFT: THE DEAL.
 *
 * What the room creator CHOSE (simple cards only, a search filter, bans) is
 * resolved once, at room creation, by ui/customrules.ts — which may read the
 * catalogue, where the engine may not. What reaches the engine is this: plain
 * numbers and a concrete list of card names left out of the pool. Every
 * re-deal (restore, rebuild, rematch, stats fold, forensic replay) passes the
 * SAME resolved deal, so a later classifier run or search-syntax change can
 * never rewrite an old game.
 *
 * THE ONE INVARIANT: a deal equal to the defaults with nothing excluded is not
 * a custom deal. `sanitizeDraftDeal` returns `undefined` for it, so "Custom
 * rules left untouched" and "no custom rules" are literally the same code path
 * — and the same seeded shuffle — as every game dealt before this file existed.
 *
 * Imports only the registry and types: apply.ts imports this, so this must not
 * import apply.ts.
 */
import type { CardName } from './types.ts';
import { DECK_LIST, draftDeckList } from './cards/registry.ts';

export interface DraftDeal {
  /** how many elements the draft is played with (the standard game: a trio) */
  elements: number;
  /** cards in each pack when it is dealt */
  packSize: number;
  /** cards each seat is dealt before the first draft step */
  openingHand: number;
  /** cards each seat draws at the top of every turn after the first */
  draftDraw: number;
  startingLife: number;
  /** deck cards left out of the pool — canonical: unique, DECK_LIST order */
  excluded: CardName[];
}

export type DealKnob = Exclude<keyof DraftDeal, 'excluded'>;

/** Today's live draft (Manual p.16): a trio, packs of 10, 4 + 2 opening cards, 2 a turn, 30 life. */
export const DEAL_DEFAULTS: Readonly<Record<DealKnob, number>> = {
  elements: 3, packSize: 10, openingHand: 6, draftDraw: 2, startingLife: 30,
};

/** Inclusive bounds. `elements` tops out at ALL_ELEMENTS.length (a test holds the two together). */
export const DEAL_BOUNDS: Readonly<Record<DealKnob, readonly [number, number]>> = {
  elements: [2, 7], packSize: [3, 15], openingHand: [1, 15], draftDraw: [0, 5], startingLife: [1, 99],
};

export const DEAL_KNOBS = Object.keys(DEAL_DEFAULTS) as DealKnob[];

export function isStandardDeal(deal: DraftDeal): boolean {
  return deal.excluded.length === 0 && DEAL_KNOBS.every(k => deal[k] === DEAL_DEFAULTS[k]);
}

/** Clamp every knob into its bounds (a missing or non-numeric knob is its
 * default), keep only real deck cards in DECK_LIST order, and return
 * `undefined` when what is left is the standard game. Never throws. */
export function sanitizeDraftDeal(raw: unknown): DraftDeal | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const knobs = {} as Record<DealKnob, number>;
  for (const k of DEAL_KNOBS) {
    const v = r[k];
    const [lo, hi] = DEAL_BOUNDS[k];
    knobs[k] = typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : DEAL_DEFAULTS[k];
  }
  const asked = new Set(Array.isArray(r['excluded']) ? r['excluded'].filter((n): n is string => typeof n === 'string') : []);
  const deal: DraftDeal = { ...knobs, excluded: DECK_LIST.filter(n => asked.has(n)) };
  return isStandardDeal(deal) ? undefined : deal;
}

/**
 * The smallest pool these rules can be played from without the deck running
 * dry before the first pack refresh: the opening deal (a hand and a pack per
 * seat), the draws of turns 2-4, and a complete set of fresh packs at the
 * turn-4 refresh. The refreshed packs go to the BOTTOM, so they do not count.
 * A smaller pool degrades a game (E.draw stops quietly on an empty deck) but
 * cannot break one — this is a floor for a good game, not for a legal one.
 */
export function minPool(deal?: Pick<DraftDeal, 'openingHand' | 'packSize' | 'draftDraw'>): number {
  const d = deal ?? DEAL_DEFAULTS;
  return 2 * d.openingHand + 4 * d.packSize + 6 * d.draftDraw;
}

/** The live-draft deck for these elements under this deal — draftDeckList with
 * the exclusions removed, order kept (the order feeds the seeded shuffle). */
export function draftPool(elements: string[], deal?: DraftDeal): CardName[] {
  const pool = draftDeckList(elements);
  if (!deal?.excluded.length) return pool;
  const out = new Set(deal.excluded);
  return pool.filter(n => !out.has(n));
}

/** "packs of 5, 2 elements, 131 cards left out" — the non-default parts, for the game log. */
export function dealSummary(deal: DraftDeal): string {
  const parts: string[] = [];
  if (deal.packSize !== DEAL_DEFAULTS.packSize) parts.push(`packs of ${deal.packSize}`);
  if (deal.elements !== DEAL_DEFAULTS.elements) parts.push(`${deal.elements} elements`);
  if (deal.openingHand !== DEAL_DEFAULTS.openingHand) parts.push(`opening hand of ${deal.openingHand}`);
  if (deal.draftDraw !== DEAL_DEFAULTS.draftDraw) parts.push(`draw ${deal.draftDraw} a turn`);
  if (deal.startingLife !== DEAL_DEFAULTS.startingLife) parts.push(`${deal.startingLife} life`);
  if (deal.excluded.length) parts.push(`${deal.excluded.length} card${deal.excluded.length === 1 ? '' : 's'} left out of the pool`);
  return parts.join(', ');
}
