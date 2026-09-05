/* Turning a finished game into per-player statistics.
 *
 * The unit of truth is the same thing rooms.ts persists — { seed, mode, els,
 * names, actions, decks } — so a live room and a saved game in server/games/
 * summarize through EXACTLY the same code path. That is what lets us preseed
 * accounts from the games Ben and Rashi already played (seed-accounts.ts)
 * without a second, drifting implementation.
 *
 * The tally reads two sources:
 *   - the ACTION log, with the pre-action state in hand, for anything about
 *     intent (which card left which zone, which element you recycled for).
 *     Reading the card name off the state BEFORE apply() is the only reliable
 *     way: an index means nothing once the action has run.
 *   - the EVENT stream for consequences (damage, deaths, life loss).
 *
 * Nothing here mutates: summarizeGame is pure, and accounts.ts folds the
 * summary into a profile.
 */
import type {
  Action, CardName, Element, EngineEvent, GameMode, GameState, Seat,
} from '../engine/src/types.ts';
import { apply, sanitizeTrio, IllegalAction } from '../engine/src/apply.ts';
// The read-only query wrapper over a plain GameState — the same thing the
// browser client builds per frame (`const q = () => new E(h.state)`). It is
// how a board fact that goes through the layer stack (effective power and
// toughness) is asked of a state we are only replaying.
import { E } from '../engine/src/engine.ts';
// R216 — the third deal site (see scenarios.ts). The post-game screen and
// the accounts fold both replay a game to count it; a scenario room counted
// without its board is a made-up game in somebody's profile.
import { dealScenario } from './scenarios.ts';
import { getCard } from '../engine/src/cards/dsl.ts';

export const ELEMENTS: Element[] = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'];

/** every element counted from zero — a stat block with holes in it is a pain
 * to merge, chart, or compare */
export const zeroElements = (): Record<Element, number> =>
  Object.fromEntries(ELEMENTS.map(e => [e, 0])) as Record<Element, number>;

/** What one player did in one game. */
export interface SeatStats {
  name: string;
  /** null when the game never finished (most of our saved games) */
  won: boolean | null;
  /** cards played from any zone, by name — feeds "most played card" */
  cards: Record<CardName, number>;
  unitsPlayed: number;
  spellsPlayed: number;
  /** spell tokens cast off the board (they were never a card in a zone) */
  tokensCast: number;
  /** cards slid under a unit as an augment or a graft */
  modsApplied: number;
  /** element weight of every card played: a hybrid gives ½ to each of its two.
   * This is what "favorite element" is argmax of. */
  cardElements: Record<Element, number>;
  /** cards recycled face-down for a resource, by the element chosen */
  recycled: Record<Element, number>;
  resourcesActivated: number;
  abilitiesActivated: number;
  attacksDeclared: number;
  /** total units sent across all attack declarations */
  unitsAttackedWith: number;
  /** damage this player's effects dealt to the OPPONENT's face */
  damageDealt: number;
  lifeLost: number;
  /** units under this player's control that died */
  unitsLost: number;
  unitsKilled: number;
  /** cards taken out of packs and kept (draft mode) */
  cardsDrafted: number;
  /** life at the end of the log */
  lifeLeft: number;

  // ── per-game HIGHLIGHTS (BL-31) ───────────────────────────────────────
  //
  // Everything above is a per-game TOTAL, which accounts.ts sums into a
  // career number. These are the other kind: the most you did at once. A sum
  // cannot answer "the biggest unit you ever had", so the peak has to be
  // taken here, while the replay still has the board in front of it, and the
  // fold keeps a running Math.max of it.
  //
  // ⚠ RETROACTIVITY LIMIT: a highlight is only as retroactive as the fold can
  // see it. history.ts skips re-summarizing a saved game whose file has not
  // changed, so every game already in the record carries these as `undefined`
  // until somebody runs `seed-accounts.ts --force`. Read them defensively in
  // accounts.ts (`?? 0`) — an old row is missing them, not zeroed.

  /** combat damage only, split out of damageDealt: "win without dealing
   * combat damage" cannot be asked of the combined number */
  combatDamageDealt: number;
  /** most parts on any one triggered ability — a graft composite joins one
   * part per grafted mod, so this is "the biggest graft effect you fired" */
  bestGraftParts: number;
  /** biggest single non-combat effect, as the damage THE EFFECT dealt across
   * every victim (the engine's own `total` on the damage event) */
  bestSingleHit: number;
  /** most damage dealt in one combat, face and units together */
  bestCombatDamage: number;
  /** biggest unit controlled at any point, measured as min(power, toughness)
   * so "50/50 or larger" is one number */
  biggestUnit: number;
  mostUnitsInPlay: number;
  /** peak resources in play — "make 12 or more resources in a single game" */
  mostResources: number;
  mostCardsInHand: number;
  /** lowest life ever reached (the starting life when never damaged) */
  lowestLife: number;
  /** most times one named spell was played in this game */
  bestSameSpell: number;
  /** resources in play when the log ran out */
  resourcesLeft: number;
  /** cards left in the deck when the log ran out */
  deckLeft: number;
}

/** Games that never really began: a room somebody opened, poked at, and left.
 * A real game runs to 150-300 actions, and the shortest opening (deal, first
 * draft commit, a recycle or two) is already past this. Read off the RAW log
 * rather than the replay, so a diverged replay cannot make a real game look
 * like an abandoned room. */
export const MIN_GAME_ACTIONS = 10;

/** One whole game, from both sides. */
export interface GameSummary {
  code: string;
  mode: GameMode;
  /** the draft trio, or the elements present in a constructed/shared game */
  els: Element[];
  seed: number;
  /** true when we know who won — from the winner stamped on the saved game, or
   * from a replay that reached one */
  finished: boolean;
  winner: Seat | null;
  turns: number;
  /** actions the replay could apply */
  actions: number;
  /**
   * Actions the CURRENT engine refused.
   *
   * These games are old: the rules have moved under them (R34 alone re-ordered
   * simultaneous triggers), and once one action is refused the rest of the log
   * is talking about a board that no longer exists, so the refusals cascade.
   * A diverged replay therefore under-counts everything and, worse, stops
   * before the ending — which is why a game with no stamped winner and
   * `skipped > 0` is reported as UNKNOWN rather than unfinished. It is not that
   * nobody won; it is that the log can no longer tell us who.
   */
  skipped: number;
  /** ISO — when the game was played (file mtime for seeded games, now() live) */
  playedAt: string;
  seats: [SeatStats, SeatStats];
}

/** The persisted shape rooms.ts writes, which is also what we summarize. */
export interface GameRecord {
  code: string;
  seed: number;
  mode?: GameMode;
  els?: Element[];
  names?: [string, string];
  actions: Action[];
  decks?: [CardName[] | null, CardName[] | null];
  playedAt?: string;
  /**
   * The result as it was RECORDED WHEN THE GAME WAS PLAYED — rooms.ts stamps
   * it the moment a game is decided, and `seed-accounts.ts --result` can set
   * it by hand for the games that predate the stamp.
   *
   * Authoritative over the replay, and that is the whole point: a replay onto
   * a newer engine can diverge, and the moment it does the action log stops
   * being able to say who won. A fact recorded at the time cannot rot.
   */
  winner?: Seat | null;
  /** R216: the scenario this game was dealt with, if any. */
  scenario?: string;
}

const emptySeat = (name: string): SeatStats => ({
  name, won: null, cards: {}, unitsPlayed: 0, spellsPlayed: 0, tokensCast: 0,
  modsApplied: 0, cardElements: zeroElements(), recycled: zeroElements(),
  resourcesActivated: 0, abilitiesActivated: 0, attacksDeclared: 0,
  unitsAttackedWith: 0, damageDealt: 0, lifeLost: 0, unitsLost: 0,
  unitsKilled: 0, cardsDrafted: 0, lifeLeft: 0,
  combatDamageDealt: 0, bestGraftParts: 0, bestSingleHit: 0, bestCombatDamage: 0,
  biggestUnit: 0, mostUnitsInPlay: 0, mostResources: 0, mostCardsInHand: 0,
  // Infinity so the first scan wins the min; clamped to a real number at the
  // end of summarizeGame, because this ships through JSON (where it would
  // serialize as null) into somebody's stat sheet.
  lowestLife: Infinity, bestSameSpell: 0, resourcesLeft: 0, deckLeft: 0,
});

/** printed kind of a card, tolerant of names the registry does not know
 * (a synthetic token, or a card removed since the game was played) */
function kindOf(card: CardName): 'unit' | 'spell' | 'spellUnit' | 'spellToken' | null {
  try { return getCard(card).kind; } catch { return null; }
}

/** Spread one played card across its elements: a mono card gives 1 to its
 * element, a hybrid ½ and ½. Cards the registry does not know contribute
 * nothing rather than throwing. */
function creditElements(into: Record<Element, number>, card: CardName): void {
  let factions: string[] = [];
  try { factions = getCard(card).factions ?? []; } catch { return; }
  const real = factions.filter((f): f is Element => (ELEMENTS as string[]).includes(f));
  if (!real.length) return;
  const share = 1 / real.length;
  for (const f of real) into[f] += share;
}

const bump = (rec: Record<string, number>, key: string): void => { rec[key] = (rec[key] ?? 0) + 1; };

/** The card an action is about to play, read out of the PRE-action state.
 * Returns null for actions that play no card, or an index that is out of
 * range (a tolerated-illegal action in an old log). */
function cardOf(state: GameState, a: Action): CardName | null {
  const p = state.players[a.seat];
  if (!p) return null;
  switch (a.type) {
    case 'playCard': return p.hand[a.handIndex] ?? null;
    case 'playCached': return p.cache?.[a.index]?.card ?? null;
    case 'prophesy': return (a.from === 'bin' ? p.bin[a.index] : p.hand[a.index]) ?? null;
    case 'augment':
    case 'graft': return (a.from === 'bin' ? p.bin[a.index]
      : a.from === 'cache' ? p.cache?.[a.index]?.card
      : p.hand[a.index]) ?? null;
    case 'castSpellToken': return state.entities[a.entityId]?.card ?? null;
    case 'recycleForResource': return p.hand[a.handIndex] ?? null;
    default: return null;
  }
}

/**
 * The board peaks, taken from one state.
 *
 * Called after every applied action, so it is the hot loop of the whole
 * accounts rebuild: a few hundred actions per game, across the whole archive,
 * every time `seed-accounts.ts --force` runs. Everything here is O(entities)
 * with no allocation except the one `E` wrapper, and `effStats` — the only
 * expensive call, because it walks the static layers — is reached only for
 * units, not for mods or spell tokens.
 *
 * MEASURED 2026-08-30, because it looks like it should be expensive and is
 * not: over 8 fuzz games / ~6000 actions, summarizeGame with this scan runs
 * within noise of the version without it (2642 ms vs 2719 ms). `apply()`
 * dominates by more than an order of magnitude. A first measurement said 50%
 * slower and was measuring cold-start JIT — warm both paths before believing
 * any number here.
 */
function scanBoard(state: GameState, seats: [SeatStats, SeatStats]): void {
  const q = new E(state);
  const units: [number, number] = [0, 0];
  const biggest: [number, number] = [0, 0];
  for (const e of Object.values(state.entities)) {
    if (!e || e.kind !== 'unit') continue;
    const seat = e.controller === 0 || e.controller === 1 ? e.controller : null;
    if (seat === null) continue;
    units[seat]++;
    let size = 0;
    try {
      const [p, t] = q.effStats(e);
      // "50/50 or larger" is a floor on BOTH stats, so the number that
      // answers it is the smaller of the two
      size = Math.min(p, t);
    } catch { size = 0; }
    if (size > biggest[seat]!) biggest[seat] = size;
  }
  for (const s of [0, 1] as Seat[]) {
    const me = seats[s]!;
    const p = state.players[s];
    if (units[s]! > me.mostUnitsInPlay) me.mostUnitsInPlay = units[s]!;
    if (biggest[s]! > me.biggestUnit) me.biggestUnit = biggest[s]!;
    if (!p) continue;
    if (p.resources.length > me.mostResources) me.mostResources = p.resources.length;
    if (p.hand.length > me.mostCardsInHand) me.mostCardsInHand = p.hand.length;
    if (p.life < me.lowestLife) me.lowestLife = p.life;
  }
}

/** Elements actually present in a game: the draft trio when there is one,
 * otherwise whatever the two players' cards belong to. */
function elementsOf(state: GameState, els: Element[], seats: [SeatStats, SeatStats]): Element[] {
  if (els.length) return els;
  const seen = new Set<Element>();
  for (const s of seats) {
    for (const el of ELEMENTS) if (s.cardElements[el] > 0) seen.add(el);
  }
  if (seen.size) return ELEMENTS.filter(e => seen.has(e));
  return sanitizeTrio(state.elements);
}

/**
 * Replay a game and tally it. Tolerant in exactly the way rooms.ts's rebuild
 * is: an action the current engine rejects is skipped with a note rather than
 * throwing away the whole game. Nine months of saved games outlive any one
 * version of the rules.
 */
export function summarizeGame(rec: GameRecord): GameSummary {
  const names: [string, string] = rec.names ?? ['Player 1', 'Player 2'];
  const mode: GameMode = rec.mode ?? 'shared';
  const els = sanitizeTrio(rec.els);
  const decks = mode === 'constructed'
    ? [rec.decks?.[0] ?? rec.decks?.[1], rec.decks?.[1] ?? rec.decks?.[0]] as [CardName[], CardName[]]
    : undefined;
  const seats: [SeatStats, SeatStats] = [emptySeat(names[0]), emptySeat(names[1])];

  let state: GameState;
  let events: EngineEvent[];
  try {
    const g = dealScenario(rec.seed, names, mode, els, decks, rec.scenario);
    state = g.state;
    events = [...g.events];
  } catch (err) {
    // an unplayable config (a constructed game whose deck no longer parses):
    // report an empty summary rather than exploding the caller's loop
    console.warn(`[stats] ${rec.code}: could not build the game — ${err instanceof Error ? err.message : err}`);
    // a game we never dealt has no board to have peaked at — see the clamp
    // at the bottom of the happy path for why Infinity must not escape
    for (const s of seats) s.lowestLife = 0;
    return {
      code: rec.code, mode, els, seed: rec.seed, finished: false, winner: null,
      turns: 0, actions: 0, skipped: rec.actions.length,
      playedAt: rec.playedAt ?? new Date().toISOString(), seats,
    };
  }

  let applied = 0;
  let skipped = 0;
  // the opening board: starting life and the opening hand are peaks too
  scanBoard(state, seats);

  /**
   * Who controls each entity, carried across actions.
   *
   * Combat damage to a UNIT emits `{ unit, n, lethal }` with no controller on
   * it (engine.ts's pumpCombatDamage) — unlike effect damage, which always
   * names one. So the only way to say whose hit that was is to know whose unit
   * took it, and by the time the event is read the unit may already be dead
   * and gone from the state. Hence a map that remembers, refreshed from the
   * PRE-action state and topped up after.
   */
  const owners = new Map<number, Seat>();
  const noteOwners = (s: GameState): void => {
    for (const e of Object.values(s.entities)) {
      if (e && (e.controller === 0 || e.controller === 1)) owners.set(e.id, e.controller);
    }
  };
  noteOwners(state);
  /** spell names only, per seat — `cards` counts units and mods too */
  const spellNames: [Record<string, number>, Record<string, number>] = [{}, {}];

  for (const a of rec.actions) {
    const seat = a.seat === 0 || a.seat === 1 ? a.seat : null;
    if (seat === null) continue;
    const me = seats[seat]!;
    const before = state;
    noteOwners(before);
    // The card an action is about to play can only be read from the state
    // BEFORE it runs — an index means nothing afterwards.
    const card = cardOf(state, a);

    // Apply FIRST, and tally only what actually happened. An old log replayed
    // onto a newer engine can contain actions the rules now reject; those are
    // skipped (as rooms.ts's rebuild does) and must not leave their intent in
    // anyone's stats.
    let out;
    try {
      out = apply(state, a);
    } catch (err) {
      if (err instanceof IllegalAction) { skipped++; continue; }
      throw err;
    }

    if (a.type === 'recycleForResource') {
      if ((ELEMENTS as string[]).includes(a.element)) me.recycled[a.element as Element]++;
    } else if (a.type === 'exchangePrismite') {
      // a prismite turned into an element is a resource of that element you
      // chose to have — it counts with the recycles (owner, 2026-09-05: "the
      // 'Recycled for resources' count also needs to count prismite usages")
      if ((ELEMENTS as string[]).includes(a.element)) me.recycled[a.element as Element]++;
      me.resourcesActivated++;
    } else if (a.type === 'activateResource') {
      me.resourcesActivated++;
    } else if (a.type === 'activateAbility') {
      me.abilitiesActivated++;
    } else if (a.type === 'declareAttack') {
      const sent = a.columns.reduce((n, c) => n + c.length, 0);
      if (sent) { me.attacksDeclared++; me.unitsAttackedWith += sent; }
    } else if (a.type === 'draftCommit') {
      // packIndices index into the merged pile hand.concat(pack) and name the
      // cards going BACK to the pack. A card you drafted is therefore one at
      // a pile index past the hand that you did not send back.
      const handSize = before.players[seat]?.hand.length ?? 0;
      const back = new Set(a.packIndices);
      const pile = handSize + (before.packs?.[seat]?.length ?? 0);
      for (let i = handSize; i < pile; i++) if (!back.has(i)) me.cardsDrafted++;
    }

    if (card) {
      if (a.type === 'augment' || a.type === 'graft') {
        me.modsApplied++;
        bump(me.cards, card);
        creditElements(me.cardElements, card);
      } else if (a.type === 'castSpellToken') {
        me.tokensCast++;
      } else if (a.type === 'playCard' || a.type === 'playCached') {
        const k = kindOf(card);
        if (k === 'unit') me.unitsPlayed++;
        else if (k) {
          me.spellsPlayed++;
          const mine = spellNames[seat]!;
          mine[card] = (mine[card] ?? 0) + 1;
          if (mine[card]! > me.bestSameSpell) me.bestSameSpell = mine[card]!;
        }
        bump(me.cards, card);
        creditElements(me.cardElements, card);
      }
      // a prophesied or recycled card is neither played nor cast — no tally
    }

    state = out.state;
    applied++;
    noteOwners(state);
    tallyEvents(seats, out.events, owners);
    scanBoard(state, seats);
    events.push(...out.events);
  }

  // a stamped result beats the replay — see GameRecord.winner
  const stamped = rec.winner === 0 || rec.winner === 1 ? rec.winner : null;
  const winner = stamped ?? state.winner;
  const finished = winner !== null;
  const q = new E(state);
  for (const s of [0, 1] as Seat[]) {
    const me = seats[s]!;
    const p = state.players[s];
    me.lifeLeft = p?.life ?? 0;
    me.won = finished ? winner === s : null;
    me.resourcesLeft = p?.resources.length ?? 0;
    // The deck hangs off the GAME, not the player, and outside constructed
    // there is only ONE — `deckOf` is the accessor that knows that, and
    // `state.decks` is undefined entirely in shared and draft. Reading the raw
    // field would score every seat as having an empty deck, which hands out
    // "win with 0 cards in your deck" for every win ever played.
    try { me.deckLeft = q.deckOf(s).length; } catch { me.deckLeft = 0; }
    // never let Infinity out: this is JSON-serialized into the account store,
    // where it would come back as null and poison every Math.min above it
    if (!Number.isFinite(me.lowestLife)) me.lowestLife = me.lifeLeft;
  }

  return {
    code: rec.code,
    mode,
    els: elementsOf(state, els, seats),
    seed: rec.seed,
    finished,
    winner,
    turns: state.turn,
    actions: applied,
    skipped,
    playedAt: rec.playedAt ?? new Date().toISOString(),
    seats,
  };
}

/**
 * Consequences: damage dealt to a face, life lost, units that died.
 *
 * `evs` is ONE action's events, which is what makes "in a single combat"
 * answerable: a combat resolves inside a single applied action, so the combat
 * damage banked here is exactly one combat's worth.
 */
function tallyEvents(
  seats: [SeatStats, SeatStats], evs: EngineEvent[], owners: Map<number, Seat>,
): void {
  /** combat damage each seat dealt during THIS action, face and units together */
  const combat: [number, number] = [0, 0];

  for (const e of evs) {
    const d = (e.data ?? {}) as Record<string, unknown>;
    if (e.type === 'damage' && typeof d['n'] === 'number') {
      const n = d['n'] as number;
      const by = typeof d['controller'] === 'number' ? d['controller'] as Seat : null;
      if (typeof d['player'] === 'number') {
        const victim = d['player'] as Seat;
        // rot damages you on your own turn with nobody's help — that is not
        // "damage dealt" by anyone
        if (by !== null && by !== victim) seats[by]!.damageDealt += n;
      }
      if (by !== null) {
        // An effect names its controller; combat damage to a unit does not.
        // That absence is the discriminator, so this arm is exactly the
        // non-combat effects. `total` is the engine's own "damage this effect
        // dealt" across every victim it hit, already past prevention and
        // {Vulnerable} doubling — which is the whole of "30 damage with a
        // single non-combat effect", so take it rather than summing our own.
        //
        // ⚠ But only when the effect reached something that is not YOURS.
        // R38 rot emits a `damage` event with `controller` set to its own
        // VICTIM (engine.ts's rotStep), so without this guard a player with
        // 30 rot on them earns "deal 30 damage with a single effect" by
        // being slowly killed by their own counters. The same guard keeps a
        // spell aimed at your own board from counting.
        const hitSelf = typeof d['player'] === 'number'
          ? (d['player'] as Seat) === by
          : typeof d['unit'] === 'number' ? owners.get(d['unit'] as number) === by : false;
        if (!hitSelf) {
          const total = typeof d['total'] === 'number' ? d['total'] as number : n;
          if (total > seats[by]!.bestSingleHit) seats[by]!.bestSingleHit = total;
        }
      } else if (typeof d['unit'] === 'number') {
        // no controller + a unit victim = a combat hit; the dealer is whoever
        // does not own the unit that took it
        const owner = owners.get(d['unit'] as number);
        if (owner !== undefined) {
          const dealer = (owner === 0 ? 1 : 0) as Seat;
          combat[dealer] = combat[dealer]! + n;
        }
      }
    } else if (e.type === 'combatFaceDamage' && typeof d['by'] === 'number' && typeof d['n'] === 'number') {
      // R238: damage DEALT to a face in one combat sub-step, which is NOT the
      // life lost — a hit the R38 rot hooks replace costs no life and still
      // counts as dealt (Caleb, 2024-10-24).
      //
      // That distinction is the whole reason `combatDamageDealt` is counted
      // here rather than off the combat `lifeLost` below: "win without
      // dealing combat damage to any opponent" has to be false for somebody
      // whose swing landed and got replaced. `damageDealt` deliberately stays
      // on `lifeLost` — it is what the existing Aggressor/Warmonger badges
      // have always counted, and this must not move their numbers.
      const dealer = d['by'] as Seat;
      if (dealer === 0 || dealer === 1) {
        combat[dealer] = combat[dealer]! + (d['n'] as number);
        seats[dealer]!.combatDamageDealt += d['n'] as number;
      }
    } else if (e.type === 'lifeLost' && typeof d['seat'] === 'number' && typeof d['n'] === 'number') {
      const victim = d['seat'] as Seat;
      const n = d['n'] as number;
      seats[victim]!.lifeLost += n;
      // Combat damage to a FACE never emits a 'damage' event — the engine
      // calls loseLife(seat, n, 'combat') directly (engine.ts, the playerDmg
      // loop). It is the bulk of the damage in a real game, so attribute it
      // here or "damage dealt" reads as ~0 for everyone.
      // combatDamageDealt is NOT counted here — see combatFaceDamage above
      if (d['why'] === 'combat') seats[(victim === 0 ? 1 : 0) as Seat]!.damageDealt += n;
    } else if (e.type === 'died' && typeof d['seat'] === 'number') {
      const owner = d['seat'] as Seat;
      seats[owner]!.unitsLost++;
      seats[(owner === 0 ? 1 : 0) as Seat]!.unitsKilled++;
    } else if (e.type === 'triggered' && typeof d['parts'] === 'number' && typeof d['controller'] === 'number') {
      // one part per grafted mod that joined the cause, plus the base ability
      const who = d['controller'] as Seat;
      const parts = d['parts'] as number;
      if (parts > seats[who]!.bestGraftParts) seats[who]!.bestGraftParts = parts;
    }
  }

  for (const s of [0, 1] as Seat[]) {
    if (combat[s]! > seats[s]!.bestCombatDamage) seats[s]!.bestCombatDamage = combat[s]!;
  }
}

/** the element a set of card-element weights points at, or null for a blank
 * slate (nobody has played anything yet) */
export function favoriteElement(weights: Record<Element, number>): Element | null {
  let best: Element | null = null;
  for (const el of ELEMENTS) if ((weights[el] ?? 0) > 0 && (!best || weights[el]! > weights[best]!)) best = el;
  return best;
}
