/* WEEKLY CHALLENGES — the pure half (client/docs/21-weekly-challenges.md).
 *
 * A solo puzzle: build an ORDERED deck that reaches a goal ("40 units in play
 * at once") against a dummy that does nothing, scored on how little it
 * needed. The browser plays the run, the server replays the uploaded log
 * through `verifyRun` and scores it itself. Both import this one module, so
 * the deal, the dummy and the score cannot drift apart between them.
 *
 * THE GAME. Constructed mode with a lesson deal (CR D8.1, lessondeal.ts):
 *   · seat 0, the player: the deck dealt exactly as arranged (index 0 on top),
 *     30 life, 2 Prismites, the constructed opening hand of 4 and the REAL
 *     constructed card step every turn (draw 4, put 2 on the bottom) — the
 *     lesson deal's per-seat `cardStep` knob
 *   · seat 1, the dummy: no hand ever (opening 0, draws 0), no Shards, no
 *     Prismites, 99 life, and every move it makes is `dummyMove`
 *   · initiative fixed to seat 0, and one fixed seed per challenge
 *
 * Pure: no I/O, no clock, no Math.random. Everything here is a function of
 * its arguments, which is what lets the server's verdict and the browser's
 * meter agree to the action.
 */
import type { Action, CardName, EngineEvent, GameState, Seat } from './types.ts';
import { apply, createGame, forcedAction, legalActions } from './apply.ts';
import { E, IllegalAction } from './engine.ts';
import { Harness } from './harness.ts';
import { canonicalCardName, getCard } from './cards/dsl.ts';
import { DECK_LIST } from './cards/registry.ts';
import type { LessonDeal } from './lessondeal.ts';

// ── the definition ────────────────────────────────────────────────────

export type Goal =
  | { kind: 'unitsInPlay'; n: number }   // seat 0 controls ≥ n units at once
  | { kind: 'spellTokens'; n: number }   // seat 0 has created ≥ n spell tokens (cumulative)
  | { kind: 'unitSize'; p: number; t: number } // seat 0 controls a unit with effStats ≥ p/t
  | { kind: 'counters'; n: number }      // ≥ n +1/+1 counters placed on seat 0's units (cumulative)
  | { kind: 'unitsPlayed'; n: number };  // seat 0 has played ≥ n unit cards (cumulative)

export interface ChallengeDef {
  id: string;
  /** YYYY-MM-DD, a Sunday */
  week: string;
  title: string;
  blurb: string;
  goal: Goal;
  seed: number;
  /** the reference run's `raw` (cards × max(1, elements) × turns), so that run
   * scores Skill 100. A committed number, never recomputed: a row is a promise
   * once its week opens (server/challenges.ts), and test 506 holds it equal to
   * what the reference run scores. */
  par: number;
}

export const PLAYER: Seat = 0;
export const DUMMY: Seat = 1;

/** The dummy's deck. It never draws a card (opening hand 0, draws 0), so what
 * it holds only has to be a legal lesson deck; the lesson-only Training
 * Construct keeps it out of every name a player could put in a challenge
 * deck. Thirty, so a card that makes "each player draw" still finds one. */
export const DUMMY_DECK: CardName[] = Array.from({ length: 30 }, () => 'Training Construct');

/** The constructed opening hand — createGame's constructed branch deals 4
 * and turn 1's draw phase (draw 4, bottom 2) nets the usual 6. Test 498
 * holds this equal to what a real constructed game deals. */
const CONSTRUCTED_OPENING_HAND = 4;

const SEAT_NAMES: [string, string] = ['Challenger', 'Dummy'];

/** The deal a challenge game is created with (CR D8.1). `def` is taken so a
 * later challenge can vary it; today every challenge deals the same game. */
export function challengeDeal(_def: ChallengeDef): LessonDeal {
  return {
    openingHand: [CONSTRUCTED_OPENING_HAND, 0],
    drawPerTurn: [0, 0],   // seat 0's is unread: it is on the constructed card step
    stacked: [true, false],
    shardsPerTurn: [0, 0],
    firstShardTurn: 1,
    shardState: 'open',
    prismites: [2, 0],
    startingLife: [30, 99],
    initiative: PLAYER,
    cardStep: ['constructed', 'lesson'],
  };
}

const DECK_POOL = new Set(DECK_LIST);
/** a name a challenge deck may hold: the real deck pool, nothing lesson-only,
 * no token, no resource face (DECK_LIST already says all of that) */
function isDeckCard(name: CardName): boolean {
  return DECK_POOL.has(name);
}

/** A challenge deck: 1–200 cards from the real deck pool, any number of
 * copies, no 30 floor. Names come back canonical (an alias is the same card),
 * position for position — the order IS the deck. */
export function checkChallengeDeck(cards: unknown): { ok: true; cards: CardName[] } | { ok: false; error: string } {
  if (!Array.isArray(cards) || cards.some(c => typeof c !== 'string')) {
    return { ok: false, error: 'a deck must be a list of card names' };
  }
  if (cards.length < 1 || cards.length > 200) {
    return { ok: false, error: `a challenge deck holds 1–200 cards (got ${cards.length})` };
  }
  const list = (cards as string[]).map(canonicalCardName);
  const bad = [...new Set(list.filter(n => !isDeckCard(n)))];
  if (bad.length) {
    return { ok: false, error: `not a deck card: ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ` (+${bad.length - 5} more)` : ''}` };
  }
  return { ok: true, cards: list };
}

// ── the dummy ─────────────────────────────────────────────────────────

/** How passive an action is: lower is more passive. Anything not named here
 * (a play, an activation, a recycle) is never chosen while a ranked one is
 * on offer. */
function passivity(a: Action): number {
  switch (a.type) {
    case 'passPriority': return 0;
    case 'donePlanning': case 'doneHaste': case 'doneDeploying': return 1;
    case 'bottomCards': return 2;
    case 'declareAttack':
      return 10 + a.columns.reduce((n, c) => n + c.length, 0) + (a.spellTokens?.length ?? 0);
    case 'declareBlocks':
      return 10 + Object.values(a.blocks).reduce((n, ids) => n + ids.length, 0)
        + (a.send?.length ?? 0) + (a.spellTokens?.length ?? 0);
    case 'decide': return 50;
    default: return 1000;
  }
}

/**
 * The dummy's move: the most passive legal action, a pure function of the
 * state (`legal` is `legalActions(state, DUMMY)`). Pass, finish the step,
 * attack with nothing, block with nothing — or with the fewest units when a
 * block is compulsory — and answer a question with its first option. Where
 * the engine's own `forcedAction` names the dummy's move, that is the move,
 * so a client that auto-submits forced actions and this function agree.
 * Throws when the dummy has nothing to do — the caller asks only then.
 */
export function dummyMove(state: GameState, legal: Action[]): Action {
  const forced = forcedAction(state);
  if (forced && forced.seat === DUMMY) return forced;
  const mine = legal.filter(a => a.seat === DUMMY && a.type !== 'concede');
  if (!mine.length) throw new Error('the dummy has no move here');
  let best = mine[0]!;
  for (const a of mine) if (passivity(a) < passivity(best)) best = a;   // first of the most passive
  return best;
}

/** Let the dummy make every move it has, until it has none. A move refused
 * because it would disturb the player's open question (CR D2.1d — the dummy
 * finishing a hidden step under the player's decision) waits: the player
 * answers, and the next settle makes it. Returns how many moves it made. */
export function settleDummy(h: Harness): number {
  let n = 0;
  for (; n < 1000 && h.state.phase !== 'gameover'; n++) {
    const legal = h.legal(DUMMY);
    if (!legal.length) break;
    try {
      h.do(dummyMove(h.state, legal));
    } catch (err) {
      if (err instanceof IllegalAction && err.disturbs) break;
      throw err;
    }
  }
  return n;
}

/** A dealt challenge game with the dummy settled — the player's move next.
 * Throws on a deck `checkChallengeDeck` refuses. */
export function newChallengeGame(def: ChallengeDef, deck: CardName[], names: [string, string] = SEAT_NAMES): Harness {
  const check = checkChallengeDeck(deck);
  if (!check.ok) throw new Error(check.error);
  const h = new Harness(def.seed, names, 'constructed', undefined, [check.cards, [...DUMMY_DECK]], undefined, challengeDeal(def));
  settleDummy(h);
  return h;
}

// ── the run: progress and the cards used ──────────────────────────────

/**
 * Everything a run has accumulated. Plain JSON (records, not maps), so a
 * client can keep it in state and a test can compare it.
 *
 * THE USED COPIES, AND WHY THEY ARE COUNTED BY NAME. The spec wants each
 * physical copy counted once however often it is replayed, keyed by card
 * instance "where the engine has instance identity" — and a hand has none:
 * `PlayerState.hand` is `CardName[]`, and so are the deck, the recycle pile
 * and the bin. So the fold keeps, per name, how many DISTINCT copies have been
 * used (`used`), and where the already-used copies are: in hand
 * (`usedInHand`), in the recycle pile past the mark (`usedInRecycle`), or
 * back in the live deck after the pile was shuffled in (`usedInDeck`); the
 * rest are on the table, in a bin or in a cache. Every card entering a hand
 * comes through `E.toHand`, whose 'handEntered' event names the zone it came
 * from, and the reshuffle announces itself ('recycle', `reshuffled`), which
 * is what keeps this honest:
 *   · out of the hand by one of the player's own actions (played, cast, a
 *     mod, a cost, a recycle): a replay when a used copy of that name is in
 *     hand, a NEW copy otherwise
 *   · out of the cache or the bin by the player's own action (a glimpsed card
 *     played from the cache, a play from the bin): a replay while a used copy
 *     is out there, a NEW copy otherwise — a card played is used, wherever
 *     it was played from
 *   · into the hand from the deck: one of the used copies the reshuffle put
 *     back, while there are any; otherwise an unused one
 *   · into the hand from anywhere else (a recall, the bin, the cache): one of
 *     the used copies outside the hand, while there are any
 *   · out of the hand any other way (the bottom step, an effect's discard on
 *     the dummy's action): the unused copies go first
 * Two copies of one name are interchangeable, so where the order is
 * ambiguous the fold takes the reading that counts less. A used copy moved
 * into the deck some other way ("shuffle it into your deck") is not tracked,
 * so drawing it again counts it again — which `deckCount`, the copies of each
 * name the deck actually holds, caps.
 */
export interface RunAcc {
  goal: Goal;
  /** the goal's current progress value, and whether it has been met */
  value: number;
  met: boolean;
  /** the turn after the last folded action, and the turn the goal was met on */
  turn: number;
  metTurn: number | null;
  /** actions folded so far */
  actions: number;
  /** the cumulative tallies the cumulative goals read */
  tokens: number;
  counters: number;
  played: number;
  used: Record<CardName, number>;
  usedInHand: Record<CardName, number>;
  usedInRecycle: Record<CardName, number>;
  usedInDeck: Record<CardName, number>;
  /** copies of each name in the deck, when the run was started with it */
  deckCount: Record<CardName, number> | null;
}

export function newRun(goal: Goal, deck?: readonly CardName[]): RunAcc {
  let deckCount: Record<CardName, number> | null = null;
  if (deck) {
    deckCount = {};
    for (const n of deck) { const c = canonicalCardName(n); deckCount[c] = (deckCount[c] ?? 0) + 1; }
  }
  return {
    goal, value: 0, met: false, turn: 1, metTurn: null, actions: 0,
    tokens: 0, counters: 0, played: 0,
    used: {}, usedInHand: {}, usedInRecycle: {}, usedInDeck: {}, deckCount,
  };
}

function countNames(names: readonly CardName[]): Map<CardName, number> {
  const m = new Map<CardName, number>();
  for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
  return m;
}

const bump = (r: Record<CardName, number>, n: CardName, by: number): void => {
  const v = (r[n] ?? 0) + by;
  if (v > 0) r[n] = v; else delete r[n];
};

/** used copies of `name` on the table, in a bin or in a cache */
const usedOutside = (acc: RunAcc, name: CardName): number => (acc.used[name] ?? 0)
  - (acc.usedInHand[name] ?? 0) - (acc.usedInRecycle[name] ?? 0) - (acc.usedInDeck[name] ?? 0);

/** The card a player action takes from somewhere OTHER than the hand — the
 * cache or the bin — read off the state before it (server/stats.ts `cardOf`
 * is the model; engine/src may not import it). The hand's own exits are
 * read off the hand itself, below. */
function nonHandSource(before: GameState, a: Action): CardName | null {
  const p = before.players[a.seat];
  if (!p) return null;
  switch (a.type) {
    case 'playCached': return p.cache?.[a.index]?.card ?? null;
    case 'playFromBin': return p.bin[a.binIndex] ?? null;
    case 'prophesy': case 'augment': case 'graft':
      return a.from === 'bin' ? p.bin[a.index] ?? null
        : a.from === 'cache' ? p.cache?.[a.index]?.card ?? null
        : null;
    default: return null;
  }
}

function useCopy(acc: RunAcc, name: CardName, fromHand: boolean): void {
  if (fromHand && (acc.usedInHand[name] ?? 0) > 0) { bump(acc.usedInHand, name, -1); return; }
  if (!fromHand && usedOutside(acc, name) > 0) return;   // a used copy back out of the bin or the cache
  const cap = acc.deckCount ? acc.deckCount[name] ?? 0 : Infinity;
  if ((acc.used[name] ?? 0) < cap) bump(acc.used, name, 1);
}

function foldUsed(acc: RunAcc, before: GameState, action: Action, after: GameState, events: EngineEvent[]): void {
  const hb = countNames(before.players[PLAYER]!.hand);
  const ha = countNames(after.players[PLAYER]!.hand);
  const en = new Map<CardName, number>();
  for (const ev of events) {
    if (ev.type !== 'handEntered') continue;
    const d = ev.data as { seat?: number; cards?: CardName[]; token?: boolean } | undefined;
    if (!d || d.seat !== PLAYER || d.token || !Array.isArray(d.cards)) continue;
    for (const name of d.cards) en.set(name, (en.get(name) ?? 0) + 1);
  }
  const mine = action.seat === PLAYER;
  // the bottom step puts cards back; it does not spend them
  const isUse = mine && action.type !== 'bottomCards';
  // exits first: a card played and the card it draws are two cards
  for (const name of new Set([...hb.keys(), ...en.keys()])) {
    if (!isDeckCard(name)) continue;   // spell tokens and the like are not cards
    const out = (hb.get(name) ?? 0) + (en.get(name) ?? 0) - (ha.get(name) ?? 0);
    if (out <= 0) continue;
    if (isUse) {
      for (let i = 0; i < out; i++) useCopy(acc, name, true);
    } else {
      const stay = Math.max(0, (hb.get(name) ?? 0) - out);
      const lost = Math.max(0, (acc.usedInHand[name] ?? 0) - stay);
      if (lost) {
        bump(acc.usedInHand, name, -lost);
        // CR 408.2: the bottom step's cards go past the mark, like a recycle
        if (mine && action.type === 'bottomCards') bump(acc.usedInRecycle, name, lost);
      }
    }
  }
  // CR 408.2: a recycled card goes past the mark, into the recycle pile
  if (mine && action.type === 'recycleForResource') {
    const name = before.players[PLAYER]!.hand[action.handIndex];
    if (name && isDeckCard(name)) bump(acc.usedInRecycle, name, 1);
  }
  // a card the action takes out of the cache or the bin is used too
  if (mine) {
    const name = nonHandSource(before, action);
    if (name && isDeckCard(name)) useCopy(acc, name, false);
  }
  // then the entries, in order: a reshuffle (CR 408.2b) turns the pile's used
  // copies into the deck's before the draw that caused it lands
  for (const ev of events) {
    const d = (ev.data ?? {}) as { seat?: number; from?: string; cards?: CardName[]; token?: boolean; reshuffled?: boolean };
    if (d.seat !== PLAYER) continue;
    if (ev.type === 'recycle' && d.reshuffled) {
      for (const [name, n] of Object.entries(acc.usedInRecycle)) bump(acc.usedInDeck, name, n);
      acc.usedInRecycle = {};
      continue;
    }
    if (ev.type !== 'handEntered' || d.token || !Array.isArray(d.cards)) continue;
    for (const name of d.cards) {
      if (!isDeckCard(name)) continue;
      if (d.from === 'deck') {
        if ((acc.usedInDeck[name] ?? 0) > 0) { bump(acc.usedInDeck, name, -1); bump(acc.usedInHand, name, 1); }
      } else if (usedOutside(acc, name) > 0) {
        bump(acc.usedInHand, name, 1);
      }
    }
  }
  // never more used copies in hand than copies in hand
  for (const name of Object.keys(acc.usedInHand)) {
    const have = ha.get(name) ?? 0;
    if ((acc.usedInHand[name] ?? 0) > have) bump(acc.usedInHand, name, have - acc.usedInHand[name]!);
  }
}

function unitsOf(state: GameState, seat: Seat) {
  return Object.values(state.entities).filter(e => e && e.kind === 'unit' && e.controller === seat);
}

/** the goal's progress value read off one state, for the goals that are a
 * property of the board (the cumulative ones are tallied from events) */
function boardValue(goal: Goal, state: GameState): number {
  if (goal.kind === 'unitsInPlay') return unitsOf(state, PLAYER).length;
  if (goal.kind === 'unitSize') {
    // one number for a two-number goal: the best unit's progress on its
    // weaker side, scaled to the larger target — for the usual square goal
    // (20/20) that is simply min(power, defense), as server/stats.ts reads size
    const p = Math.max(1, goal.p), t = Math.max(1, goal.t), target = Math.max(p, t);
    const q = new E(state);
    let best = 0;
    for (const u of unitsOf(state, PLAYER)) {
      let s: [number, number];
      try { s = q.effStats(u); } catch { continue; }
      if (s[0] >= goal.p && s[1] >= goal.t) return target;
      best = Math.max(best, Math.min(target - 1, Math.floor(Math.min(s[0] * target / p, s[1] * target / t))));
    }
    return Math.max(0, best);
  }
  return 0;
}

function goalTarget(goal: Goal): number {
  return goal.kind === 'unitSize' ? Math.max(Math.max(1, goal.p), Math.max(1, goal.t)) : goal.n;
}

/**
 * Fold one applied action into the run. `before`/`after` are the states
 * either side of it and `events` what `apply` returned for it. Pure: returns
 * a new RunAcc. Once the goal is met the run is over and further folds
 * change nothing.
 */
export function foldRun(acc: RunAcc, before: GameState, action: Action, after: GameState, events: EngineEvent[]): RunAcc {
  if (acc.met) return acc;
  const next: RunAcc = {
    ...acc, used: { ...acc.used }, usedInHand: { ...acc.usedInHand },
    usedInRecycle: { ...acc.usedInRecycle }, usedInDeck: { ...acc.usedInDeck },
    actions: acc.actions + 1, turn: after.turn,
  };
  foldUsed(next, before, action, after, events);
  for (const ev of events) {
    const d = (ev.data ?? {}) as Record<string, unknown>;
    if (ev.type === 'tokenCreated' && d['seat'] === PLAYER) next.tokens++;
    else if (ev.type === 'countersChanged' && typeof d['n'] === 'number' && d['n'] > 0) {
      const id = d['unit'] as number;
      const holder = after.entities[id] ?? before.entities[id];
      const seat = holder ? holder.controller : d['by'];
      if (seat === PLAYER) next.counters += d['n'];
    } else if (ev.type === 'cardPlayed' && d['seat'] === PLAYER && typeof d['card'] === 'string') {
      let kind: string | undefined;
      try { kind = getCard(d['card']).kind; } catch { kind = undefined; }
      if (kind === 'unit' || kind === 'spellUnit') next.played++;
    }
  }
  const g = next.goal;
  next.value = g.kind === 'spellTokens' ? next.tokens
    : g.kind === 'counters' ? next.counters
    : g.kind === 'unitsPlayed' ? next.played
    : boardValue(g, after);
  if (next.value >= goalTarget(g)) { next.met = true; next.metTurn = after.turn; }
  return next;
}

export function progress(acc: RunAcc): { value: number; target: number; met: boolean } {
  return { value: acc.value, target: goalTarget(acc.goal), met: acc.met };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "Have 40 units in play at once" */
export function goalText(goal: Goal): string {
  switch (goal.kind) {
    case 'unitsInPlay': return `Have ${plural(goal.n, 'unit', 'units')} in play at once`;
    case 'spellTokens': return `Create ${plural(goal.n, 'spell token', 'spell tokens')}`;
    case 'unitSize': return `Have a ${goal.p}/${goal.t} unit in play`;
    case 'counters': return `Put ${plural(goal.n, '+1/+1 counter', '+1/+1 counters')} on your units`;
    case 'unitsPlayed': return `Play ${plural(goal.n, 'unit card', 'unit cards')}`;
  }
}

/** "Units in play" — the meter's label */
export function progressLabel(goal: Goal): string {
  switch (goal.kind) {
    case 'unitsInPlay': return 'Units in play';
    case 'spellTokens': return 'Spell tokens created';
    case 'unitSize': return 'Biggest unit';
    case 'counters': return '+1/+1 counters';
    case 'unitsPlayed': return 'Units played';
  }
}

// ── the score ─────────────────────────────────────────────────────────

/** `raw` = cards × max(1, elements) × turns, the run's exact cost (lower is
 * cheaper); `skill` = the shown number, par ÷ raw × 100 rounded half up —
 * HIGHER is better, and the row's reference run scores exactly 100. Both are
 * stamped by the server when it verifies a run and never recomputed. Boards
 * rank by `raw` (exact, so two runs never tie on a rounding). */
export interface RunScore { unique: number; extra: number; cards: number; elements: number; turns: number; raw: number; skill: number }

/** par ÷ raw × 100, rounded half up, in integers (no float can land a half on
 * the wrong side) */
export function skillOf(par: number, raw: number): number {
  const r = Math.max(1, raw);
  return Math.floor((200 * par + r) / (2 * r));
}

/** the spec's Scoring: what the run used, its raw cost, and its Skill against `par` */
export function scoreRun(acc: RunAcc, par: number): RunScore {
  const names = Object.keys(acc.used).filter(n => (acc.used[n] ?? 0) > 0);
  const unique = names.length;
  const extra = names.reduce((s, n) => s + Math.max(0, acc.used[n]! - 2), 0);
  const cards = unique + extra;
  const els = new Set<string>();
  for (const n of names) for (const f of getCard(n).factions ?? []) els.add(f);
  const elements = els.size;
  const turns = acc.metTurn ?? acc.turn;
  const raw = cards * Math.max(1, elements) * turns;
  return { unique, extra, cards, elements, turns, raw, skill: skillOf(par, raw) };
}

// ── the leaderboards ──────────────────────────────────────────────────

/**
 * Owner, 2026-10-23, after the first week's 31 runs: no one number says which
 * run is best. A 3-turn run, a 3-card run and a 1-element run are each the
 * best at something, and the single Skill hid both turn-3 runs under a
 * 3·2·5 one. So there are three leaderboards, each with its own first place:
 * one metric first, the other two as its tie-breaks. `overall` is a fourth
 * view with no trophy: turns² × cards × √elements — resources grow every
 * turn, so what a run can do by turn T grows about like T², and elements
 * (1 to 7) weigh least. Stamped `raw` and `skill` stay on every run and are
 * no longer what anything ranks by.
 */
export type BoardKind = 'fastest' | 'leanest' | 'purest' | 'overall';
export const BOARD_KINDS: readonly BoardKind[] = ['fastest', 'leanest', 'purest', 'overall'];
/** the boards with a first place that wins the week */
export const TROPHY_KINDS: readonly BoardKind[] = ['fastest', 'leanest', 'purest'];

/** each board's order: the metrics compared, first to last */
const ORDER: Record<Exclude<BoardKind, 'overall'>, readonly ('turns' | 'cards' | 'elements')[]> = {
  fastest: ['turns', 'cards', 'elements'],
  leanest: ['cards', 'turns', 'elements'],
  purest: ['elements', 'turns', 'cards'],
};

/** the overall cost, squared so it is a whole number: (turns² × cards × √elements)²
 * — compared exactly, where the root would round */
const overallSq = (s: RunScore): number => s.turns ** 4 * s.cards ** 2 * Math.max(1, s.elements);

/** <0 when `a` ranks above `b` on board `kind`; 0 is a tie (the earlier run
 * keeps it, which only the caller knows) */
export function compareScores(kind: BoardKind, a: RunScore, b: RunScore): number {
  if (kind === 'overall') {
    return overallSq(a) - overallSq(b) || a.turns - b.turns || a.cards - b.cards || a.elements - b.elements;
  }
  for (const k of ORDER[kind]) if (a[k] !== b[k]) return a[k] - b[k];
  return 0;
}

// ── verification ──────────────────────────────────────────────────────

/** Never in an uploaded run: the agreed fix is minted only by the server's
 * accept path (the engine accepts one on replay, so the gate is here), and
 * the sandbox cheats are refused by the engine anyway. A concede is allowed
 * through and simply ends the game, which fails the run. */
const FORBIDDEN = new Set(['amend', 'sandboxSpawn', 'sandboxResources', 'sandboxLife', 'sandboxAdvance']);

/** a stable serialisation: key order and absent-vs-undefined do not matter */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/**
 * Replay an uploaded run: the whole action log as the harness recorded it,
 * both seats, from the bare deal (newChallengeGame's own dummy settling is
 * in that log, as the Harness recorded it).
 *
 * WHOSE ACTION IS IT: every Action carries its `seat`, and the engine refuses
 * an action whose seat may not act, so the seat field is the answer.
 *   · seat 1 (the dummy): it must be EXACTLY `dummyMove(state, legalActions(
 *     state, 1))` — compared structurally — and the dummy must have a move at
 *     all. That covers the forced empty attack / empty block the client
 *     auto-submits for it (dummyMove returns forcedAction's own action).
 *   · seat 0 (the player): legal means `apply` accepts it. NOT membership in
 *     `legalActions`, which only samples combat formations and number
 *     answers. The player's forced actions are ordinary player actions here.
 *   · anything else, an agreed fix or a sandbox cheat: refused.
 *
 * The run ends at the first action after which the goal is met, and the
 * actions after it are dropped. A game that ends first (the dummy dead, a
 * concede, the player dead) fails — even if the goal was met by the very
 * action that ended it — and so does a log that runs out first.
 *
 * `onStep` sees the board after every action this replay applies, before it
 * is judged — the server fingerprints the run with it (server/challenge-sigs.ts),
 * in the same pass, so a stored fingerprint is of exactly the game verified.
 */
export function verifyRun(def: ChallengeDef, deck: unknown, actions: unknown,
  opts: { maxActions?: number; onStep?: (i: number, after: GameState) => void } = {}):
  { ok: true; score: RunScore; actions: Action[] } | { ok: false; error: string; at?: number } {
  const max = opts.maxActions ?? 20000;
  const check = checkChallengeDeck(deck);
  if (!check.ok) return { ok: false, error: check.error };
  if (!Array.isArray(actions)) return { ok: false, error: 'the run must be a list of actions' };
  if (actions.length > max) return { ok: false, error: `a run holds at most ${max} actions (got ${actions.length})` };
  let state: GameState;
  try {
    state = createGame(def.seed, SEAT_NAMES, 'constructed', undefined, [check.cards, [...DUMMY_DECK]], undefined, challengeDeal(def)).state;
  } catch (err) {
    return { ok: false, error: `the deal failed: ${(err as Error).message}` };
  }
  let acc = newRun(def.goal, check.cards);
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i] as Action;
    if (!a || typeof a !== 'object' || typeof a.type !== 'string' || (a.seat !== PLAYER && a.seat !== DUMMY)) {
      return { ok: false, error: `action ${i} is not an action`, at: i };
    }
    if (FORBIDDEN.has(a.type)) return { ok: false, error: `action ${i}: ${a.type} is not allowed in a challenge`, at: i };
    if (a.seat === DUMMY) {
      const legal = legalActions(state, DUMMY);
      if (!legal.length) return { ok: false, error: `action ${i}: the dummy has no move here`, at: i };
      if (canon(a) !== canon(dummyMove(state, legal))) {
        return { ok: false, error: `action ${i}: not the dummy's move`, at: i };
      }
    }
    let r;
    try {
      r = apply(state, a);
    } catch (err) {
      return { ok: false, error: `action ${i} refused: ${(err as Error).message}`, at: i };
    }
    acc = foldRun(acc, state, a, r.state, r.events);
    state = r.state;
    opts.onStep?.(i, state);
    if (state.phase === 'gameover') {
      return { ok: false, error: `action ${i}: the game ended before the goal was met`, at: i };
    }
    if (acc.met) return { ok: true, score: scoreRun(acc, def.par), actions: (actions as Action[]).slice(0, i + 1) };
  }
  return { ok: false, error: 'the run never meets the goal' };
}
