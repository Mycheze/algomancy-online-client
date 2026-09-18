/* R297 — LEARN TO PLAY: THE LESSON DEAL.
 *
 * The tutorial is one continuous game between a learner and the Tutorial Bot,
 * and none of the three real modes can deal it: 'shared' has one communal deck,
 * every mode hardcodes its opening hand, and constructed adds a draw-4/bottom-2
 * step the tutorial deliberately does not teach. So a lesson deal rides on
 * CONSTRUCTED — which already owns a deck and a recycle pile per seat — and
 * replaces the parts of the deal the tutorial needs to control:
 *
 *   · the opening hand and the cards drawn each turn, per seat (no bottom step)
 *   · a STACKED deck per seat: dealt in the order given, index 0 on top, which
 *     is how a lesson's card arrives on the turn its lesson is written for
 *   · a per-turn Shard income per seat — the bot's whole economy, owned by the
 *     engine rather than faked by the client
 *   · starting Prismites and life per seat
 *
 * Like DraftDeal, what reaches the engine is plain numbers, resolved once; a
 * replay passes the same deal. Imports only the registry and types: apply.ts
 * imports this, so this must not import apply.ts.
 */
import type { CardName, Seat } from './types.ts';
import { allCardNames, getCard } from './cards/dsl.ts';

export interface LessonDeal {
  /** cards each seat is dealt before turn 1 (turn 1's draw comes on top) */
  openingHand: [number, number];
  /** cards each seat draws at the top of EVERY turn, turn 1 included */
  drawPerTurn: [number, number];
  /** true = that seat's deck is dealt in the order given (index 0 on top) */
  stacked: [boolean, boolean];
  /** Shards each seat gains at the top of each turn from `firstShardTurn` on */
  shardsPerTurn: [number, number];
  /** the first turn the Shard income pays (1 = from the start) */
  firstShardTurn: number;
  /** whether the income arrives open (spendable now) or dormant (activate it) */
  shardState: 'open' | 'dormant';
  /** face-down Prismites each seat starts with (the real game: 2) */
  prismites: [number, number];
  startingLife: [number, number];
  /** who holds initiative on turn 1; absent = the seeded roll, as in every game */
  initiative?: Seat;
}

/** The part of the deal play reads after the deal itself, carried on GameState. */
export type LessonRules = Pick<LessonDeal, 'drawPerTurn' | 'shardsPerTurn' | 'firstShardTurn' | 'shardState'>;

const BOUNDS = {
  openingHand: [0, 15], drawPerTurn: [0, 5], shardsPerTurn: [0, 5],
  prismites: [0, 6], startingLife: [1, 99], firstShardTurn: [1, 50],
} as const;

export const LESSON_DEFAULTS: LessonDeal = {
  openingHand: [4, 4], drawPerTurn: [2, 2], stacked: [false, false],
  shardsPerTurn: [0, 0], firstShardTurn: 1, shardState: 'open',
  prismites: [2, 2], startingLife: [30, 30],
};

function clamp(v: unknown, [lo, hi]: readonly [number, number], dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt;
}
function pair(v: unknown, b: readonly [number, number], dflt: [number, number]): [number, number] {
  const a = Array.isArray(v) ? v : [];
  return [clamp(a[0], b, dflt[0]), clamp(a[1], b, dflt[1])];
}

/** Clamp every knob into bounds (a missing knob is its default). Unlike
 * sanitizeDraftDeal this never returns undefined for a default-looking deal:
 * asking for a lesson deal IS the difference, whatever its numbers. */
export function sanitizeLessonDeal(raw: unknown): LessonDeal | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const d = LESSON_DEFAULTS;
  const st = Array.isArray(r['stacked']) ? r['stacked'] : [];
  return {
    openingHand: pair(r['openingHand'], BOUNDS.openingHand, d.openingHand),
    drawPerTurn: pair(r['drawPerTurn'], BOUNDS.drawPerTurn, d.drawPerTurn),
    stacked: [st[0] === true, st[1] === true],
    shardsPerTurn: pair(r['shardsPerTurn'], BOUNDS.shardsPerTurn, d.shardsPerTurn),
    firstShardTurn: clamp(r['firstShardTurn'], BOUNDS.firstShardTurn, d.firstShardTurn),
    shardState: r['shardState'] === 'dormant' ? 'dormant' : 'open',
    prismites: pair(r['prismites'], BOUNDS.prismites, d.prismites),
    startingLife: pair(r['startingLife'], BOUNDS.startingLife, d.startingLife),
    ...(r['initiative'] === 0 || r['initiative'] === 1 ? { initiative: r['initiative'] as Seat } : {}),
  };
}

/** A lesson deck: 1–200 registered cards a player can put in a deck — units and
 * spells, including `lessonOnly` ones — with no 30-card floor and no copy cap.
 * Tokens, markers and resource faces are refused. */
export function checkLessonDeck(cards: unknown): { ok: true; cards: CardName[] } | { ok: false; error: string } {
  if (!Array.isArray(cards) || cards.some(c => typeof c !== 'string')) {
    return { ok: false, error: 'a deck must be a list of card names' };
  }
  const list = cards as CardName[];
  if (list.length < 1 || list.length > 200) return { ok: false, error: `a lesson deck holds 1–200 cards (got ${list.length})` };
  const known = new Set(allCardNames());
  const bad = [...new Set(list.filter(n => {
    if (!known.has(n)) return true;
    const c = getCard(n);
    if (/\bResource\b/.test(c.type)) return true;
    if (/Token/.test(c.type) && !c.lessonOnly) return true;
    return !(c.kind === 'unit' || c.kind === 'spell' || c.kind === 'spellUnit');
  }))];
  if (bad.length) return { ok: false, error: `not a deck card: ${bad.slice(0, 5).join(', ')}` };
  return { ok: true, cards: [...list] };
}
