/* The engine internals: E wraps a draft GameState being mutated by one apply()
 * call, accumulating events. apply() (in apply.ts) clones the incoming state,
 * builds an E, dispatches the action, and returns the draft — so the public
 * API stays a pure reducer while the rules code stays imperative.
 *
 * Control flow signals (all caught in apply.ts):
 *   Suspended    — a decision was recorded in state; unwind and return.
 *   GameEnded    — a player hit 0 life; state is final.
 *   IllegalAction— the action was rejected; caller keeps the old state.
 *
 * Mid-resolution choices (CR 802.17 electric paths, CR 704.1a payments) use replay
 * suspension: the effect part runs until it needs an unanswered choice, the
 * engine rolls the draft back to the part boundary, records the decision, and
 * on `decide` re-runs the part with the answer filled in (deterministic:
 * the RNG state rolled back with everything else).
 */
import type {
  Attr, BattleState, BinRef, CachedCard, CachedProphecy, CardName, CopyFacet, CopyRef, DamageSubStep,
  Decision, DecisionOption,
  EffectPart, EngineEvent, Entity, EntityId, EventType, FormationSpot, GameState, LastKnown, NumericEntry,
  PendingTrigger, Phase, Seat, SpawnFace, StackItem, StateFrame, Suspension, TargetRef, Stamp,
} from './types.ts';
import {
  affinityPips, binNthAt, CARD_PLAY_KINDS, costAmount, costXMin, effectByKey, getCard,
  isEntityTarget, isGraftable, isPlayedSpellKind, isSpellEffect, isTriggered, mixedAllegiance, requiresTargets, slotRestrict, slotWhat, specForSlot,
  targetMinimum, zoneTriggersFor,
  type AsYouPlayOption,
  type Ability, type CardBehavior,
  type CardDef, type CastCost, type CostMod, type EffectCtx, type EffectDef,
  type ResolvedTarget, type TargetCtx, type TargetRestrict, type TargetSpec, type TokenRequest, type TriggeredAbility,
} from './cards/dsl.ts';
import { doneTargetsLabel } from './cards/dsl.ts';   // report #206: the stop option's label
import { rngShuffle } from './rng.ts';

/** CR 710.1: a whole-identity copy — "become a copy of target unit" contributes
 * every facet, which is what makes it a face REPLACEMENT rather than a grant. */
const FULL_FACETS: readonly CopyFacet[] =
  ['name', 'stats', 'attrs', 'statics', 'activated', 'triggered', 'behavior'];
/** CR 710.7: the ADDITIVE default — "I have all ABILITIES of adjacent allies"
 * (Ancient One). Never `name`, never `stats`. `behavior` was added later. */
const PROJECTED_FACETS: readonly CopyFacet[] = ['statics', 'activated', 'triggered', 'behavior'];
/** `copiedAugments`' answer for the (almost universal) uncopied unit */
const NO_CARDS: readonly CardName[] = Object.freeze([]);

/**
 * CR 710.7: every channel the `behavior` facet carries — the whole of what a card
 * radiates from play that is not a static, an activated ability, a triggered
 * ability or an ATTRIBUTE.
 *
 * The owner on Ancient One: *"it basically just copies the whole text box of
 * adjacent allies … the only thing it doesn't are attributes"*. So the list is
 * closed by exclusion, not by enumeration of what happened to be convenient:
 * anything a `CardDef` grows that radiates from a unit in play belongs here.
 *
 * The four one-line permissions `prophesyFromBin` / `playsFromBin` /
 * `noPlayFromHand` / `playsIntoFormation`, and `binPlayPermissions`, are
 * DELIBERATELY absent: every one of them is read of a card in a HAND, a BIN or
 * on the STACK, and a projected face only exists for an entity standing in a
 * formation. There is nothing for an Ancient One to donate them to.
 */
const BEHAVIOR_CHANNELS = [
  'costMods', 'effectAttrs', 'amountMods', 'amountMultipliers',
  'modPermissions', 'playPermissions',
  // CR 710.7: the as-you-play option is text-box text radiating from a unit in
  // play, so an Ancient One next to a Maelstrom Charger offers it too — RAQ,
  // verbatim: *"This works with Ancient One adjacent to Maelstrom Charger."*
  'asYouPlay',
  'mustBeTargeted', 'replaceRotDamage', 'replaceCombatDamageToPlayer',
  'replaceLifeGain', 'replaceCounters', 'replaceTokenCreation',
  'replaceTokenBatch', 'replaceCardStep',
] as const;
/** CR 710.7: one member of `BEHAVIOR_CHANNELS` */
type BehaviorChannel = (typeof BEHAVIOR_CHANNELS)[number];

/** CR 111.10: where and why a card's cost is being computed (see manaToPlay).
 * `region` defaults to the seat's action region; `purpose` defaults to
 * 'play' — pass 'mod' when the card is being applied as an augment or graft,
 * which is not playing (CR 701.2b). */
export interface CostOpts {
  region?: number;
  purpose?: 'play' | 'mod';
  /** CR 202.5: the X the caster has chosen for an X-cost card. Omitted while
   * the X is still open (the castability gate, a price quote), where the
   * printed floor `xMin` stands in for it. See CostCtx.x in dsl.ts. */
  x?: number;
}

/**
 * what `E.preventUnitDamage` is being asked about — one recipient, one
 * commit, one source.
 *
 * `attrs` and `pure` are here from the start rather than "when something needs
 * them", because the card that will need them is already written and parked:
 * Oorblak's Piercing-excess half cannot tell a Piercing hit from a plain
 * overkill out of `{ attacker, region }`, which is precisely why its ledger
 * entry says the hook is the wrong shape. `attrs` is the SOURCE's live
 * attribute set (the same set the commit loop is reading), and `pure` is CR 802.25b's
 * attribute-blind exchange, which switches those attributes off for both
 * sides.
 */
export interface UnitDamageInfo {
  /** the region the damage is dealt in (CR 101.6) */
  region: number;
  /** what is dealing it, for the log ("Fireball", a column label) */
  source: string;
  /** combat damage, or an effect's */
  combat: boolean;
  /** the SOURCE's live attributes — {Piercing}, {Deadly}, {Powerful}, … */
  attrs: Set<string>;
  /** CR 802.25b {Pure}: this came out of an attribute-blind exchange */
  pure: boolean;
}

export class Suspended { }
export class GameEnded { }
/** The unstarted tail of a multi-item cast chain and the `then` it runs
 * with — threaded commitItem → resolveItem → resolveParts so that a
 * mid-resolution suspension can carry it (see Suspension 'resolve'). */
export interface ChainRest { then: 'push' | 'resolve'; moreItems: StackItem[] }
/** CR 702.4e: how a mid-resolution play asks for one cost payment — the resolving
 * effect's `ctx.choose`, keyed by part and by the step within the payment */
export type InlineCostAsk = (partIndex: number, step: number, dec: Omit<Decision, 'id'>) => unknown;
export class IllegalAction extends Error {
  /** CR D2.1d: this refusal is not "you may not do that" but "not YET" — the
   * action was applied to the draft, turned out to disturb the OTHER seat's
   * open question, and the whole draft was thrown away. The server reads this
   * flag and parks the action instead of relaying a refusal (rooms.ts
   * `deferrableRefusal`); a hotseat caller may simply retry after the answer. */
  disturbs?: boolean;
  /** "no answer of this shape can EVER be accepted for the question now
   * pending", as opposed to "wrong right now" (see 143-replay-divergence). Only a caller that cannot ask
   * again cares — see the orderTriggers arm of `doDecide` (apply.ts), which is
   * the only thing that sets it, and `server/replay-room.ts`, which reads it. */
  unanswerable?: boolean;
}
/** thrown by ctx.choose inside an effect part; converted to a 'resolve' suspension */
class PartChoice {
  key: string;
  dec: {
    /** `'targets'`: a mid-resolution play's [cost] question (CR 702.4e) */
    kind: 'payOrDecline' | 'electricPath' | 'formationSlot' | 'number' | 'targets'
      | 'assignDamage';   // CR 802.16j: noncombat {Piercing}'s elective split
    seat: Seat; prompt: string;
    options: DecisionOption[];
    /** BL-25/CR D7.2: a card effect asking HOW MANY counters — the ceiling its
     * stepper maxes at. Passed straight through onto the Decision. */
    counterMax?: number;
    /** CR D7.2a: a card effect asking for a NUMBER rather than a pick. Passed
     * straight through onto the Decision, and `options` is empty. */
    numeric?: NumericEntry;
    /** one pick of a set ("choose up to two…"): display only, passed through */
    pickSet?: Decision['pickSet'];
  };
  constructor(key: string, dec: PartChoice['dec']) {
    this.key = key;
    this.dec = dec;
  }
}

/**
 * CR 708.4a: thrown by `E.askReplacement` inside a replacement-order SEAM (a
 * combat-damage sub-step, the start-of-deployment rot step) when the question
 * it would ask has no recorded answer yet. The seam catches it, rewinds the
 * world to its own start and suspends there (see `E.orderSeamRun`).
 */
class OrderNeeded {
  key: string;
  dec: Omit<Decision, 'id'>;
  constructor(key: string, dec: Omit<Decision, 'id'>) {
    this.key = key;
    this.dec = dec;
  }
}

/** one choice in a replacement-order question: the unit it is about (a board
 * click, ui/boardpick.ts reads `unit`), and the index the asker maps back */
interface ReplacementPick { label: string; card: CardName; unit: EntityId; pick: number }

export function other(seat: Seat): Seat { return 1 - seat; }

/** Manual p.17: each player may flip up to TWO dormant resources face-up per
 * turn. One constant, three coupled readers: the starting allowance
 * (createGame), the per-turn refresh (startTurn) and the activation gate's
 * error text (doActivateResource). */
export const ACTIVATIONS_PER_TURN = 2;

/** CR 802.19a: the {Resonant} rider's effect — ability #1 of the rules-owned
 * synthetic card apply.ts registers for Alluring (#0). Hung on the EXISTING
 * card rather than a new one, so the pool, its hashes and the deal list do not
 * move (150); the stack item carries the source's own card name either way. */
const RESONANT_KEY = 'ability:Alluring Attribute#1';

/**
 * CR 704.4a: the stack-item kinds whose CARD goes to the bin when the item is
 * negated. A 'unit' belongs here — a {Battle} unit caught mid-cast is a real
 * card and has to land somewhere (it used to be erased into nowhere while the
 * log claimed "→ bin"). 'spellToken' does not: a token is erased (CR 704.2b).
 * 'triggered'/'activated' do not: their `card` names the SOURCE, which is
 * still in play — the ability is simply gone.
 */
const NEGATE_BINS = new Set<StackItem['kind']>(['spell', 'spellUnit', 'unit', 'virus', 'ambush']);

// ── prophecy conditions (CR 803.7) ─────────────────────────────────────────
//
// The condition set is DATA, not a switch: six Light & Dark cards mint a
// prophecy from rules text rather than a printed banner ("It gains 'Prophecy
// — One Battle Passes'", "'Prophecy — X Turns Pass', where X is half of its
// cost, rounded up"), and the transcriptions disagree with each other —
// `Blurf` reads 'Prophecy: 1 turn passes' where everything else reads
// 'Prophecy — One Turn Passes'. So every condition string, printed or granted,
// goes through normalizeProphecy() and is then matched against this table.
// Adding a condition = adding a row.

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/**
 * Split a raw condition string into what the log shows, what the table
 * matches, and the timing marker.
 *
 * CR 803.7b, 203.5b: a TRAILING "[Haste]" (Divine Intervention's `Your life is 5 or
 * less [Haste]`) is a marker on the PROPHESY window — the printed exception to
 * the old ruling's "prophesying is legal only during the deployment phase" (now
 * CR 803.7b). It is not
 * part of the condition, so it is split off here. It says nothing about the
 * RELEASE: a fulfilled card is played "as if it were in your hand", so the
 * printed timing governs that (CR 803.7i). Tithe Enforcer's `End [Haste] with used
 * mana` keeps its bracket because it is not trailing: there the word names the
 * STEP the condition is about.
 */
export function normalizeProphecy(raw: string): { condition: string; norm: string; prophesyAt?: 'haste' } {
  let s = String(raw ?? '').trim();
  // granted prophecies arrive with their own label ("Prophecy — One Turn
  // Passes", "Prophecy: 1 turn passes"); printed banners arrive bare
  s = s.replace(/^prophecy\s*[—–:\-]?\s*/i, '').trim();
  let prophesyAt: 'haste' | undefined;
  const trailing = /\[\s*haste\s*\]\s*$/i.exec(s);
  if (trailing) {
    prophesyAt = 'haste';
    s = s.slice(0, trailing.index).trim();
  }
  const condition = s;
  const norm = s.toLowerCase()
    .replace(/[[\]().,;:!?'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => (NUMBER_WORDS[w] !== undefined ? String(NUMBER_WORDS[w]) : w))
    .join(' ');
  return { condition, norm, ...(prophesyAt ? { prophesyAt } : {}) };
}

interface ProphecyRule {
  /** what the table row is called in the log / in tests */
  id: string;
  /** matched against the NORMALISED condition */
  re: RegExp;
  met: (g: E, seat: Seat, p: CachedProphecy, m: RegExpMatchArray) => boolean;
  /** the COUNTING rows only: how far along the condition is, for a player
   * looking at a cached card. Owner, live report 2026-09-05 (VNNW): "you can't
   * tell how many turns are left or how close you are to being able to play
   * it. My Hooba-God just says '4 turns pass' but I have no way to check how
   * many already passed." Read off the same delta `met` reads, so the two
   * cannot disagree; a state row (life at most, a unit died…) has no meter
   * and leaves this out. */
  progress?: (g: E, seat: Seat, p: CachedProphecy, m: RegExpMatchArray) => ProphecyProgress;
}

/** How far a counting prophecy has come: `done` of `need` `unit`s. */
/** `unit` is the NOUN the meter counts in, and it is a closed set so the UI
 * can pluralise it without a table: "4/13 units", "1/2 turns". The 'unit' noun was added for Vengeance's "13 Units Die". */
export interface ProphecyProgress { done: number; need: number; unit: 'turn' | 'battle' | 'unit' }

/** One unit's share of a combat sub-step's damage, tagged with the striking
 * column's damage-replacement attrs (Poisonous → counters, Resonant → rider)
 * and, for CR 802.22a {Blessed}, the seat the life gain is owed to. */
interface CombatUnitHit {
  pool: number; poisonous: boolean; resonant: boolean;
  /** CR 802.11e {Pure}: this damage came out of an attribute-blind exchange, so
   * the VICTIM's Vulnerable is switched off for it too */
  pure?: boolean;
  blessedTo?: Seat; blessedFrom?: string;
  /** the striking column's live attributes and label, carried so the
   * prevention/replacement choke point can be told a {Piercing} hit from a
   * plain overkill. Last assignment wins, as `poisonous`/`resonant` already
   * do — a unit takes damage from at most one column per sub-step. */
  attrs?: Set<string>; label?: string;
  /** CR 802.19a {Resonant}: the unit that is the rider's SOURCE (the column's
   * carrier of the attribute) and the seat dealing, so the rider can be
   * queued as that unit's trigger. */
  resonantSrc?: EntityId; resonantBy?: Seat;
  /** CR 708.8b, 802.18a: the seat whose column dealt this hit. A {Poisonous}
   * hit's -1/-1 counters are PUT BY that seat (report #210/#216: Wandering
   * Blightshell beside a Poisonous blocker never drew) — combat damage is not
   * a stack part, so `addCounters` has no `partActor` to fall back on here. */
  by?: Seat;
}

/**
 * CR 608.9a — ONE column's share of a combat `lifeLost`, carried on the event as
 * `data.hits`. This is what makes "a unit deals combat damage to a player"
 * answerable: the loss stays aggregated per seat (it is one simultaneous
 * strike), and the breakdown says who made it up.
 *
 * `amount` is post-replacement and pre-`lifeAmount` (CR 112.3), so the
 * shares sum to the raw loss the sub-step dealt — the event's own `n` is that
 * total after the multiplicative amount layer has had it.
 */
export interface FaceDamageHit {
  /** the seat whose column dealt it */
  by: Seat;
  /**
   * CR 608.8a — how much combat damage this column DEALT to the player, before the
   * replacement hooks had it. This is the number "my column deals combat
   * damage" is about and the number `faceDamageDealtBy` returns.
   *
   * Owner, 2026-08-28, on a hit Blightsea Polyp turned into rot: *"blightsea
   * pollup says it deals damage as, so its still damage. Just not as life."*
   * Caleb had already ruled it on 2024-10-24, asked "Is combat damage still
   * applied after this replacement effect?" of Rot Jelly (this card's 2024
   * name) beside {Lethal} Gublin: *"Yes."*
   */
  dealt: number;
  /** how much of the seat's total LIFE LOSS this column made up — `dealt`
   * minus whatever a replacement took, so a fully replaced hit is 0 here and
   * still positive above. Only the `lifeLost` shares have to sum to the loss
   * the event reports; this is that share. */
  amount: number;
  /** the whole live column — the subject of "MY COLUMN deals combat damage" */
  col: EntityId[];
  /** its positive-power members — the subject of "A UNIT deals combat damage
   * to a player" (CR 608.5a: a 0-power passenger deals nothing) */
  units: EntityId[];
}

/** The scratch shared by `E.combatSubStep`'s halves, alive for exactly one
 * sub-step: the assignment half fills it, the commit half and the aftermath
 * read it. See the method for the order. */
interface CombatLedger {
  /** pool assigned to each unit this sub-step */
  perUnit: Map<EntityId, CombatUnitHit>;
  /** CR 802.3a: any damage from a Deadly column kills */
  deadlyHit: Set<EntityId>;
  /** draws owed to each seat (CR 802.20 Thieving) */
  thievingDraw: number[];
  /** CR 802.24c: combat damage a column deals to a PLAYER, one entry per column —
   * per-column granularity is required by the Blightsea Polyp replacement
   * ("as 1 rot", whatever the column's power) and by {Lethal}. */
  playerHits: {
    seat: Seat; amount: number; by: Seat; attrs: Set<string>; label: string; pure: boolean;
    /** CR 608.9a: the LIVE column that dealt this hit — the subject of every
     * "my column deals combat damage to a player" clause. */
    col: EntityId[];
    /** CR 608.9a: the members of `col` that actually DEAL its damage (CR 608.5a;
     * the owner: "0 power units do no damage") — the subject of Sarcophage's
     * UNIT-scoped "whenever a unit deals combat damage to a player". */
    dealers: EntityId[];
  }[];
  /** CR 802.23d {Afflicting}: units each afflicting column damaged this sub-step,
   * keyed by column, so its kills can be diffed out afterwards */
  afflicted: Map<string, { dealer: Seat; label: string; ids: Set<EntityId> }>;
  /** who controlled what before the sub-step, for the afflicting diff */
  beforeUnits: Map<EntityId, Seat>;
  /** CR 802.9e {Unaware}: every unit that fought in an exchange collapsed to
   * printed stats, so the sub-step can run the death check the collapsed
   * reading implies — `checkDeaths` reads effStats and cannot see it. */
  collapsed: Set<EntityId>;
}

/** CR 803.7e: every condition counts FORWARD from the moment of prophesying — never
 * backwards (Caleb 2024-09-22: "Same way that 'Four turns pass' can't just be
 * played on turn 5"). The counting rows read a delta against the stamps taken
 * when the card was cached; the state rows are live checks that only start
 * being asked once the prophecy exists, and CR 803.7g latches them afterwards. */
const PROPHECY_RULES: ProphecyRule[] = [
  {
    id: 'turnsPass',
    re: /^(\d+) turns? (?:pass|passes)$/,
    met: (g, _seat, p, m) => g.s.turn - p.turn >= Number(m[1]),
    progress: (g, _seat, p, m) => ({ done: Math.min(g.s.turn - p.turn, Number(m[1])), need: Number(m[1]), unit: 'turn' }),
  },
  {
    id: 'battlesPass',
    // 1v1: both the initiative battle and the counterattack tick this
    re: /^(\d+) battles? (?:pass|passes)$/,
    met: (g, _seat, p, m) => (g.s.battlesCompleted ?? 0) - p.battles >= Number(m[1]),
    progress: (g, _seat, p, m) => ({
      done: Math.min((g.s.battlesCompleted ?? 0) - p.battles, Number(m[1])), need: Number(m[1]), unit: 'battle',
    }),
  },
  {
    id: 'lifeAtMost',
    re: /^your life is (\d+) or less$/,
    met: (g, seat, _p, m) => g.player(seat).life <= Number(m[1]),
  },
  {
    id: 'uniqueUnitCosts',
    re: /^your units have (\d+) unique costs?$/,
    met: (g, seat, _p, m) => {
      // distinct PRINTED mana costs among your units in play ('X' counts once)
      const costs = new Set(g.unitsOf(seat).map(u => String(g.faceDef(u).mana)));   // CR 710.1a: the face
      return costs.size >= Number(m[1]);
    },
  },
  {
    id: 'unitsDie',
    // CR 803.7m, Vengeance: "13 Units Die". It counts the deaths this seat
    // WITNESSED — the card says "Units" rather than "your units", so it is
    // not limited to your own dead, but it is limited to what you were there
    // to see. Owner, 2026-09-20: "YOU (the player) need to be in a region for
    // it to 'see' the death. So if your opponent sacrifices a unit during
    // their deployment or something, it will NOT be seen by Vengeance. But
    // during combat, it will see all deaths."
    //
    // `Region.presentSeats` is that rule already: a region holds its owner
    // plus whoever attacked into it, until regroup sends them home. Hence the
    // asymmetry — the two seats' counts differ, and are meant to.
    //
    // Counts forward from the moment of prophesying like every other counting
    // condition (CR 803.7e), from THIS seat's witnessed total.
    //
    // It carries a `progress` function, which is not decoration: a 13-death
    // condition is the longest in the pool by a distance, and a WITNESSED
    // count is one a player cannot reconstruct by looking at the board at
    // all — the deaths it counts have already left it. The cache meter is the
    // only way anyone can see how close it is (CR D6.6a — the cache is public, so
    // the meter is too).
    re: /^(\d+) units? (?:die|dies)$/,
    met: (g, seat, p, m) => (g.s.deathsSeen?.[seat] ?? 0) - (p.deaths ?? 0) >= Number(m[1]),
    progress: (g, seat, p, m) => ({
      done: Math.min((g.s.deathsSeen?.[seat] ?? 0) - (p.deaths ?? 0), Number(m[1])),
      need: Number(m[1]),
      unit: 'unit',
    }),
  },
  {
    id: 'hasteWithUsedMana',
    // Tithe Enforcer: "you must haste something ELSE to fulfil it" — the tally
    // is nonzero only between the haste step opening and the end-of-haste
    // sweep, so this can never latch off some other phase's spending.
    re: /^end haste with used mana$/,
    met: (g, seat) => g.s.hasteDone === null && (g.s.hasteManaSpent?.[seat] ?? 0) >= 1,
  },
];

export class E {
  s: GameState;
  events: EngineEvent[] = [];

  /**
   * 2026-10-03 — THE BOARD, ONE RESOLUTION AT A TIME, for a client to play back.
   *
   * The owner: the end-of-turn effects should "happen more slowly/clearly so
   * that it's easy to track and follow". They cannot be paced from the client
   * alone: the end of turn and the next turn's start run inside ONE action (the
   * last "done deploying" — endTurn → settle → startTurn), so the client is
   * handed the finished board and nothing in between. Null unless `apply` was
   * asked for frames; when set, `markFrame` keeps a copy of the board after
   * each item that RESOLVED, at settle()'s safe point, deaths included.
   *
   * ⚠ OBSERVATION ONLY. Nothing reads a frame back; a frame is a clone, never
   * the live state. A game with frames is byte-for-byte the game without.
   */
  frames: StateFrame[] | null = null;
  /** where the events since the last frame begin */
  private frameFrom = 0;

  /** Take a frame if something resolved since the last one. Called at the top
   * of every settle() pass, after deaths: the board a resolution LEFT. */
  markFrame(): void {
    if (!this.frames) return;
    let resolved = false;
    for (let i = this.frameFrom; i < this.events.length; i++) {
      if (this.events[i]!.type === 'resolved') { resolved = true; break; }
    }
    if (!resolved) return;
    this.frames.push({ at: this.events.length, state: structuredClone(this.s) });
    this.frameFrom = this.events.length;
  }

  /**
   * CR 703.7 — WHOSE CRANK TURN THIS IS, and deliberately NOT on `GameState`.
   *
   * Deployment is a hidden SIMULTANEOUS segment: the owner's ruling is that
   * "the two players are, essentially, playing different games", each with its
   * own stack. An engine that has to honour that needs to know which of the
   * two games it is currently settling, and the only thing that knows is the
   * action that came in. `apply()` builds one `E` per action and throws it
   * away, so this rides the CALL, not the state — it is never serialized,
   * never replayed and never read by a view.
   *
   * Null is the safe default: every call site that is not an action (game
   * creation, a test poking `settle()` directly) gets exactly the older
   * behaviour, which is to hold for any open decision at all.
   */
  acting: Seat | null = null;

  constructor(state: GameState) { this.s = state; }

  // ── infrastructure ──────────────────────────────────────────────────
  ev(type: EventType, msg: string, data?: Record<string, unknown>): EngineEvent {
    const e: EngineEvent = { type, msg, ...(data ? { data } : {}) };
    this.events.push(e);
    // CR 407.1: the erased pile is kept here rather than at each of the dozen
    // erase sites — every one of them already announces itself the same way,
    // with the owning seat and the card name(s), so this is the one place
    // that has to know. `cards` is the bulk form (Finality, Grox).
    if (type === 'erased' && typeof data?.['seat'] === 'number') {
      const seat = data['seat'] as Seat;
      const names = Array.isArray(data['cards'])
        ? data['cards'] as CardName[]
        : typeof data['card'] === 'string' ? [data['card'] as CardName] : [];
      if (names.length) (this.player(seat).erased ??= []).push(...names);
    }
    return e;
  }

  /** CR 407.1a, 407.1b: the cards erased out of `seat`'s zones — public, and never a zone
   * anything is played from. */
  erased(seat: Seat): CardName[] { return this.player(seat).erased ?? []; }
  illegal(why: string): never { throw new IllegalAction(why); }
  need(cond: unknown, why: string): asserts cond { if (!cond) this.illegal(why); }

  shuffle<T>(items: T[]): T[] {
    const [out, next] = rngShuffle(items, this.s.rngState);
    this.s.rngState = next;
    return out;
  }

  player(seat: Seat) { return this.s.players[seat]!; }
  pname(seat: Seat) { return this.player(seat).name; }
  entity(id: EntityId): Entity | undefined { return this.s.entities[id]; }
  card(name: CardName): CardDef { return getCard(name); }
  get initiative(): Seat { return this.s.initiative; }
  get nit(): Seat { return other(this.s.initiative); }
  homeRegion(seat: Seat): number { return this.s.regions.findIndex(r => r.owner === seat); }

  unitsOf(seat: Seat, region?: number): Entity[] {
    return Object.values(this.s.entities).filter(e =>
      e.kind === 'unit' && e.controller === seat && !e.absent &&
      (region === undefined || e.region === region));
  }
  unitsIn(region: number): Entity[] {
    return Object.values(this.s.entities).filter(e => e.kind === 'unit' && e.region === region && !e.absent);
  }
  tokensOf(seat: Seat, region?: number): Entity[] {
    return Object.values(this.s.entities).filter(e =>
      e.kind === 'spellToken' && e.controller === seat && !e.absent &&
      (region === undefined || e.region === region));
  }

  battleCounter(region: number, key: string): number {
    return this.s.battleCounters[region]?.[key] ?? 0;
  }
  bumpBattleCounter(region: number, key: string, by = 1): number {
    const c = this.s.battleCounters[region] ?? (this.s.battleCounters[region] = {});
    c[key] = (c[key] ?? 0) + by;
    return c[key]!;
  }

  /**
   * CR 405.9: may `seat` play SPELLS out of their own bin in `region` right now?
   *
   * "In this battle, you may play spells from your bin" (Abyssal Evocation).
   * It is a BATTLE-SCOPED permission and it is deliberately not an
   * `anchored()` radiator: `E.anchored` walks units in play and augment mods,
   * and Abyssal Evocation is a SPELL — it resolves and goes to the bin, so
   * there is nothing left in play to radiate from. What the card grants is a
   * fact about this battle, which is exactly what battleCounters are.
   *
   * Region-KEYED, which is CR 505.6's "'this battle' = this region's battle" for
   * free, and stops round 1's permission leaking into round 2. Reset by
   * `startBattlePhase`'s existing wipe, so "in this battle" needs no cleanup
   * of its own, and it is not a new GameState field — zero serialization or
   * replay risk.
   *
   * SPELLS specifically: the key names what was granted, so a future "you may
   * play UNITS from your bin" gets its own key rather than silently widening
   * this one. `apply` and `legalActions` both read THIS function — the
   * fuzzer's "legalActions lied" check has caught that split before.
   */
  mayPlaySpellsFromBin(seat: Seat, region: number): boolean {
    return this.battleCounter(region, `binPlaySpells:${seat}`) > 0;
  }
  /** CR 405.9: grant the above for the rest of this region's battle. */
  grantBinSpellPlay(seat: Seat, region: number): void {
    this.bumpBattleCounter(region, `binPlaySpells:${seat}`);
  }

  /**
   * CR 405.9: may `seat` play ONE named card out of their own bin right now?
   *
   * "You may play target spell from your bin **until regroup**." (Spell
   * Excavation.) The sibling above is the BLANKET version — every spell,
   * this region's battle. This one is the single-card version with the longer
   * window, and the two differences are both printed on the card:
   *
   *  · ONE CARD. The key names it, and `useBinCardPlay` spends the grant when
   *    the play commits, because "target spell" is singular — a second copy of
   *    the same name in the bin is not what was targeted.
   *  · UNTIL REGROUP, not "in this battle". CR 505.6 scopes "this battle" to one
   *    region, which is why `mayPlaySpellsFromBin` is region-keyed and round
   *    1's permission cannot leak into round 2. "Until regroup" is the WHOLE
   *    battle phase, both rounds and both regions — so the grant is bumped in
   *    every region and read in the current one.
   *
   * `battleCounters` is exactly the right lifetime and needs no cleanup of its
   * own: `finishHasteEnd` wipes it as the battle phase opens, and regroup ends
   * that phase, so a grant made during battle expires at regroup and cannot
   * survive into another turn. Nothing outside a battle can consume it either
   * — `doPlayFromBin` reads `s.battle.region` and there is none.
   *
   * ⚠ CR 702.2a: this is a permission to PLAY, and it waives nothing else. The
   * card still goes through `playAtTiming`, so its PRINTED timing applies —
   * the same restrictive answer as for the cache (CR 403.3d) and for
   * the blanket grant (CR 702.2a). A bin-play grant does not make a deploy spell castable
   * in battle.
   */
  mayPlayCardFromBin(seat: Seat, region: number, card: CardName): boolean {
    return this.battleCounter(region, `binPlayCard:${seat}:${card}`) > 0;
  }
  /** CR 405.9, 506.2d: grant the above until regroup (see the note — every region). */
  grantBinCardPlay(seat: Seat, card: CardName): void {
    for (let r = 0; r < this.s.regions.length; r++) {
      this.bumpBattleCounter(r, `binPlayCard:${seat}:${card}`, 1);
    }
  }
  /** spend one such grant — "target spell", singular, is now played. */
  useBinCardPlay(seat: Seat, card: CardName): void {
    for (let r = 0; r < this.s.regions.length; r++) {
      this.bumpBattleCounter(r, `binPlayCard:${seat}:${card}`, -1);
    }
  }

  // ── resources & payment ─────────────────────────────────────────────
  affinity(seat: Seat, element: string): number {
    let n = 0;
    for (const r of this.player(seat).resources) {
      if (r.state === 'dormant') continue;   // dormant gives no affinity
      if (r.kind === element) n++;           // expended still counts
      // Prismites give NO affinity — their value is the planning-phase
      // exchange into a real element (CR 105.5, Manual p.18)
    }
    return n;
  }
  /**
   * "Create a Shard." (Manual p.18) A Shard is its own ResourceKind, NOT a
   * prismite: it arrives dormant, gives one generic mana once activated, gives
   * NO affinity, and — the difference that matters — can never be exchanged
   * for an element during planning the way a prismite can (CR 106.8a, 106.9). Cards that
   * make Shards used to push prismites, which quietly handed the player the
   * strongest resource in the game.
   */
  createShard(seat: Seat, n = 1, source?: string): void {
    for (let i = 0; i < n; i++) this.player(seat).resources.push({ kind: 'shard', state: 'dormant' });
    this.ev('resourceActivated',
      `${this.pname(seat)} creates ${n === 1 ? 'a Shard' : `${n} Shards`}${source ? ` (${source})` : ''} — dormant.`,
      { seat, kind: 'shard' });
  }
  openMana(seat: Seat): number {
    return this.player(seat).resources.filter(r => r.state === 'open').length;
  }
  /** reentrancy guard for cost-modifier evaluation (mirrors inStatics) */
  private inCostMods = false;
  /** reentrancy guard for effect-attribute evaluation (mirrors inCostMods) */
  private inEffectAttrs = false;
  /** reentrancy guard for mod-permission evaluation (mirrors inCostMods) */
  private inModPermissions = false;
  /** reentrancy guard for play-permission evaluation (mirrors the above) */
  private inPlayPermissions = false;
  /** reentrancy guard for amount-modifier evaluation (mirrors inCostMods) */
  private inAmountMods = false;
  /** reentrancy guard for amount-MULTIPLIER evaluation. Its own latch and
   * not `inAmountMods`: the two families are consulted one after the other for
   * the same quantity, so sharing a latch would silently blank the second. */
  private inAmountMultipliers = false;
  /** CR 710.7: reentrancy guard for the CONTINUOUS half of the copy layer
   * (mirrors inStatics). See `facesOf` — it sits UNDER effStats, so a nested
   * query gets the identity face and nothing projected. */
  private inFaces = false;
  /**
   * CR 708.4a: reentrancy guard for the counter REDIRECT. Unlike the amount
   * modifiers above, a redirect really does re-enter — Counter Thief's
   * replacement puts the counters on ITSELF, and putting counters on a unit is
   * the very thing that asks the hook. Skipping the anchor is not enough:
   * two Counter Thiefs would bounce a single placement between them forever.
   * So the depth latch is the engine's, in the engine's own `inCostMods`
   * shape, rather than a `let` in a card file — which is exactly the move
   * report #60 asked for.
   */
  private inReplaceCounters = false;
  /**
   * how deep inside a REPLACEMENT the engine currently is.
   *
   * A replacement is not an effect. It never reaches the stack, it has no
   * `EffectDef`, and so nothing it creates can be attributed to an effect's
   * `creates` declaration. Exposed (see `inReplacement`) so the
   * conformance recorder in test/65 can tell "an effect made a token it never
   * declared" — a real defect — from "the replacement layer substituted or
   * added a token", which is by construction undeclarable.
   */
  private replacementDepth = 0;
  /**
   * CR 708.4a: the replacement-order seam running right now, and how many
   * questions it has asked so far this run (the n in `${key}#${n}`). Null
   * outside one. See `orderSeamRun`.
   */
  private orderSeam: { key: string; asked: number } | null = null;
  /** is a replacement running right now? See `replacementDepth`. */
  get inReplacement(): boolean { return this.replacementDepth > 0; }

  /**
   * The "unit-or-augment-mod → anchor" radiator walk, shared by everything
   * that reads continuous text off cards in play (statics, cost mods, the two
   * replacement hooks, mustBeTargeted): text radiates from units in play AND
   * from augment mods — [Augment] text transfers with the card — and a mod's
   * text is ANCHORED ON ITS HOST, reading from the host's perspective
   * (controller/region are the host's, "your OTHER units" excludes the host).
   * `holder` is the entity CARRYING the text (the unit, or the augment mod
   * that donated it); `anchor` is the entity it reads from.
   *
   * A sent counterattacker "doesn't exist until phase 1 finishes" (Manual
   * p.20) — an absent anchor radiates nothing — and that filter lives here.
   * Everything else (region/controller scoping, and CRUCIALLY the CR 712.1a
   * suppression check) stays with the caller: the sites disagree on whether
   * suppression is the shallow `anchor.suppressed?.abilities` flag or the
   * full abilitiesSuppressed() projection, and each keeps its own answer.
   * Iteration is s.entities in Object.values order (numeric key order), which
   * callers rely on for determinism.
   */
  private anchored(keep: (holder: Entity, anchor: Entity) => boolean): { holder: Entity; anchor: Entity }[] {
    const out: { holder: Entity; anchor: Entity }[] = [];
    for (const holder of Object.values(this.s.entities)) {
      let anchor: Entity | undefined;
      if (holder.kind === 'unit') anchor = holder;
      else if (holder.kind === 'mod' && holder.appliedAs === 'augment' && holder.modOf !== undefined) {
        anchor = this.entity(holder.modOf);
      }
      if (!anchor || anchor.absent) continue;
      if (!keep(holder, anchor)) continue;
      out.push({ holder, anchor });
    }
    return out;
  }

  /**
   * CR 710.7: the faces one `anchored()` radiator's BEHAVIOUR channels come off.
   *
   * `staticsFor`'s rule, lifted out so the other thirteen channels cannot drift
   * from it: a unit reads its own identity face (which is the COPIED card when
   * it is wearing one) plus every face projected onto it right now (Ancient
   * One); an augment MOD carries only its own text, because a mod is never
   * copied and a projection lands on its HOST, which the walk reaches
   * separately.
   */
  private behaviorFaces(holder: Entity, anchor: Entity): CardName[] {
    return holder.id === anchor.id ? this.facesWith(holder, 'behavior') : [holder.card];
  }

  /**
   * CR 721.1: the behaviour BLOCKS a radiator's continuous channels come off — a
   * face, paired with the half of that face's text box which is live in this
   * mode. Every `anchored()` walk reads this instead of `getCard(face)`.
   *
   * The FACES are `behaviorFaces`' above, unchanged. What is new is the `def`
   * beside each one, and it is where the two modes stop agreeing:
   *
   *   - a UNIT IN PLAY reads BOTH halves — its body text, and its own
   *     `[Augment]` line. A card played normally gets its whole text box
   *     (Manual Q&A; the same rule `fireEvent` follows for `augmentText`).
   *   - an augment MOD reads ONLY the `[Augment]` box. Applying a card as an
   *     augment brings the box and nothing else — its statics, its cost mods,
   *     its replacement hooks, everything printed outside the box, do nothing
   *     (owner, 2026-08-30; report #139, Infernal Wispweaver's body "+2/+1 and
   *     do not sacrifice themselves" radiating off a mod).
   *
   * So this is NOT the mirror of `abilities` vs `augmentText`: the box is live
   * in both modes, the body in only one.
   */
  private behaviorBlocks(
    holder: Entity, anchor: Entity, facet: CopyFacet = 'behavior',
  ): { face: CardName; def: CardBehavior }[] {
    if (holder.id !== anchor.id) {                             // an augment mod
      const box = this.card(holder.card).augmentBox;
      return box ? [{ face: holder.card, def: box }] : [];
    }
    const out: { face: CardName; def: CardBehavior }[] = [];
    for (const face of this.facesWith(holder, facet)) {
      const def = this.card(face);
      out.push({ face, def });
      if (def.augmentBox) out.push({ face, def: def.augmentBox });
    }
    // CR 710.2a: a copy's copied augment mods — each one's [Augment] box, read off
    // the copy itself (no mod entity was cloned, so no second holder exists)
    for (const card of this.copiedAugments(holder, facet)) {
      const box = this.card(card).augmentBox;
      if (box) out.push({ face: card, def: box });
    }
    return out;
  }

  /**
   * CR 721.1: `behaviorBlocks` WITHOUT the face walk — the halves of the holder's
   * own card that radiate right now.
   *
   * For `projects` (Ancient One) and nothing else: a projection is
   * deliberately not itself projected, so that walk reads `holder.card`
   * directly and must not gain a face layer here. The body/box split is the
   * same one every other channel gets.
   */
  private ownBlocks(holder: Entity, anchor: Entity): CardBehavior[] {
    const def = this.card(holder.card);
    if (holder.id !== anchor.id) return def.augmentBox ? [def.augmentBox] : [];
    return def.augmentBox ? [def, def.augmentBox] : [def];
  }

  /**
   * CR 710.7: does this radiator carry channel `key` right now — off its own card,
   * off its own `[Augment]` box, off an identity copy, or off a face projected
   * onto it? The augment-box ruling (now CR 721.1c) added the box arm and the mod-mode narrowing.
   *
   * The `anchored()` presence predicates are the hottest reads in the engine
   * (`amountDelta` runs on every counter and every point of effect damage), and
   * they were written as a single property read for exactly that reason. That
   * read is still first here (two now, the body and the box) and is still the
   * whole answer on any board with no copy layer at all; only a board that
   * actually has one pays for the face walk, and only for a holder that IS its
   * anchor.
   */
  private donates(holder: Entity, anchor: Entity, key: BehaviorChannel): boolean {
    const own = this.card(holder.card);
    // CR 721.1: a mod radiates its [Augment] box and nothing else
    if (holder.id !== anchor.id) return !!own.augmentBox?.[key];
    if (own[key] || own.augmentBox?.[key]) return true;
    return this.behaviorFaces(holder, anchor)
      .some(f => f !== holder.card
        && (!!this.card(f)[key] || !!this.card(f).augmentBox?.[key]))
      // CR 710.2a: the [Augment] boxes of the mods a copy copied
      || this.copiedAugments(holder, 'behavior').some(c => !!this.card(c).augmentBox?.[key]);
  }

  /**
   * CR 710.7: flatten an `anchored()` result into ONE ENTRY PER FACE that actually
   * declares `key`, keeping the holders' order (which the replacement hooks
   * have already sorted by entity id) and, within a holder, layer order —
   * identity face first, then whatever is projected onto it.
   *
   * The seven `replace*` hooks offer one event to their donors IN ORDER (CR
   * 708.4: each applies once, in turn, to the event as the ones before it left
   * it), so what they iterate has to be a flat, ordered list of CANDIDATE
   * CLAUSES rather than of entities. `anchor` rides along because an
   * [Augment]-donated or projected clause reads from its HOST/mimic, which is
   * what `anchored()` means by the anchor.
   */
  private donorFaces(
    holders: { holder: Entity; anchor: Entity }[], key: BehaviorChannel,
  ): { face: CardName; def: CardBehavior; anchor: Entity }[] {
    const out: { face: CardName; def: CardBehavior; anchor: Entity }[] = [];
    for (const { holder, anchor } of holders) {
      // CR 721.1: `def` is the half of the box this holder radiates, so the hook
      // below is invoked off the BLOCK, never off `getCard(face)` again
      for (const { face, def } of this.behaviorBlocks(holder, anchor)) {
        if (def[key]) out.push({ face, def, anchor });
      }
    }
    return out;
  }

  /**
   * CR 111.10: every active CostMod that applies to `ctx`. Radiates from units in
   * play and from augment mods anchored on their host, scoped to the region
   * the card is being played into (CR 111.10) — the same rules as staticsFor.
   * NOTE the returned `holder` is the ANCHOR (the entity the mod reads from),
   * while the mod list comes off the carrying entity's card.
   */
  private costModsFor(region: number): { holder: Entity; mod: CostMod; via: CardName }[] {
    if (this.inCostMods) return [];
    const out: { holder: Entity; mod: CostMod; via: CardName }[] = [];
    this.inCostMods = true;
    try {
      const live = this.radiates();
      for (const { holder, anchor } of this.anchored((h, a) =>
        a.region === region
        && this.donates(h, a, 'costMods')                      // CR 710.7: off the FACES
        && live(h, a))) {                                      // CR 712.1a, as staticsFor
        // `via` is the card the mod is PRINTED on — the FACE (CR 710.7), which for
        // a donated augment is the holder rather than the anchor (the logs
        // name it) and for a projected/copied face is the borrowed card
        for (const { face, def } of this.behaviorBlocks(holder, anchor)) {
          for (const mod of def.costMods ?? []) out.push({ holder: anchor, mod, via: face });
        }
      }
    } finally { this.inCostMods = false; }
    return out;
  }

  /**
   * every attribute a continuous `EffectAttrMod` grants to ONE PART of a
   * resolving stack item. `costModsFor`'s sibling, line for line — the same
   * `anchored()` walk (units in play plus augment mods reading from their
   * host), the same region scope (CR 101.6: the mod reads from the ANCHOR's
   * region, which is why an Enlightener augmented onto an enemy unit boosts
   * THAT player's spells), the same shallow CR 712.1a guard every radiating-static
   * query uses (`anchor.suppressed?.abilities`, not the full
   * abilitiesSuppressed() projection), and the same reentrancy latch.
   *
   * Ownership is NOT decided here. `ctx.seat` is the resolving item's
   * controller and `self` is the anchor; a card that means "YOUR spells"
   * compares the two in its own `affects`, exactly as `StaticMod.affects`
   * does for "your units". `anchored`'s contract is that a mod's text reads
   * from the HOST's perspective, so both halves of an [Augment] fall out for
   * free.
   *
   * This runs on every part of every resolving item, so the `effectAttrs`
   * presence test is the FIRST clause of the `anchored()` predicate: on a
   * board with neither of the two cards that declare one — i.e. almost every
   * board — the walk is one property read per entity and allocates nothing
   * past the empty array.
   */
  private effectAttrsFor(ctx: import('./cards/dsl.ts').EffectAttrCtx): Attr[] {
    if (this.inEffectAttrs) return [];
    const out: Attr[] = [];
    this.inEffectAttrs = true;
    try {
      const live = this.radiates();
      for (const { holder, anchor } of this.anchored((h, a) =>
        this.donates(h, a, 'effectAttrs')                     // CR 710.7: off the FACES
        && a.region === ctx.region
        && live(h, a))) {                                     // CR 712.1a, as staticsFor
        for (const { def } of this.behaviorBlocks(holder, anchor)) {
          for (const mod of def.effectAttrs ?? []) {
            if (mod.affects(this, anchor, ctx)) out.push(...mod.attrs);
          }
        }
      }
    } finally { this.inEffectAttrs = false; }
    return out;
  }

  /**
   * CR 708.5: every active `AmountMod`'s contribution to one quantity, SUMMED.
   *
   * `costModsFor` + `manaToPlay` folded into one, because unlike a cost there
   * is nothing else to do with the list: the same `anchored()` walk (units in
   * play plus augment mods reading from their HOST), the same CR 101.6 region
   * scope, the same shallow CR 712.1a guard every radiating query uses, the same
   * reentrancy latch.
   *
   * SUMMED and not first-true-consumes — Caleb: "a replacement only happens
   * once … The replacement just takes what would be 1 and makes it 2" — so two
   * different modifiers both apply. None applies to its own contribution, and
   * that needs no guard at all: this is a pure QUERY, asked once, where the
   * trigger implementations it replaces re-entered `addCounters` and needed a
   * module-level `let` each to stop themselves looping.
   *
   * The `amountMods` presence test is the FIRST clause of the predicate, for
   * `effectAttrsFor`'s reason: this runs on every counter, every rot, every
   * effect-damage hit, and on a board with none of the three cards that
   * declare one it is a single property read per entity.
   */
  private amountDelta(ctx: import('./cards/dsl.ts').AmountCtx): number {
    if (this.inAmountMods) return 0;
    let total = 0;
    this.inAmountMods = true;
    try {
      const live = this.radiates();
      for (const { holder, anchor } of this.anchored((h, a) =>
        this.donates(h, a, 'amountMods')                       // CR 710.7: off the FACES
        && (ctx.region === undefined || a.region === ctx.region)   // fireEvent's rule
        && live(h, a))) {                                      // CR 712.1a, as staticsFor
        for (const { def } of this.behaviorBlocks(holder, anchor)) {
          for (const mod of def.amountMods ?? []) {
            total += mod.delta(this, anchor, ctx);
          }
        }
      }
    } finally { this.inAmountMods = false; }
    return total;
  }

  /**
   * CR 708.6: every active `AmountMultiplier`'s claim on one quantity, folded into
   * ONE multiplier. `amountDelta`'s walk line for line — the same `anchored()`
   * radiators, the same CR 101.6 region scope, the same shallow CR 712.1a guard, its own
   * latch — and only the fold differs.
   *
   * CR 708.6, 112.3 (round-32 Q4), the owner in one sentence: *"Make it exponential."*
   *
   * So the claiming factors MULTIPLY: n mods each declaring ×2 give 2^n. The
   * question was re-asked precisely because the first answer's wording — *"quadruple
   * it!! So always n*2*v (n is num of arbiters, v is original damage/life gain
   * value)"* — is LINEAR read literally, and the owner had only ever been asked
   * about TWO. At n = 2 the two readings are indistinguishable (2 + 2 = 2 × 2 =
   * 4), which is exactly why it could sit unresolved for so long: the case that
   * separates them had never been on a board.
   *
   * ⚠ THE OLD ANSWER IS STILL RIGHT WHERE IT WAS GIVEN. Two Arbiters quadruple,
   * before and after — the two-Arbiter worked example is untouched and the bug it
   * fixed (the trigger pair giving 3×) stays fixed. Only n ≥ 3 moves: three
   * Arbiters give ×8 where they used to give ×6.
   *
   * ⚠ THE ADDITIVE COMPOSITION IS ITS OWN RULE. The multiplier rule (CR 708.6)
   * answers how multipliers compose with EACH OTHER; how one composes with an
   * additive `AmountMod` is CR 708.6a — the additions first, then the doubling —
   * which is the `(v + Σdelta) × factor` that `lifeAmount` below computes.
   *
   * A factor of exactly 1 is "no opinion" and is skipped rather than folded.
   * Under the old SUM that mattered arithmetically — a declining mod would have
   * pushed the total up by one. Under a PRODUCT ×1 is the identity and skipping
   * it changes nothing, so the `continue` now exists for `claims` alone, which
   * still has to tell "every mod declined" from "no mod looked". Both are 1.
   */
  private amountFactor(ctx: import('./cards/dsl.ts').AmountCtx, by?: CardName[]): number {
    if (this.inAmountMultipliers) return 1;
    let claims = 0;
    let product = 1;
    this.inAmountMultipliers = true;
    try {
      const live = this.radiates();
      for (const { holder, anchor } of this.anchored((h, a) =>
        this.donates(h, a, 'amountMultipliers')                // CR 710.7: off the FACES
        && (ctx.region === undefined || a.region === ctx.region)   // fireEvent's rule
        && live(h, a))) {                                      // CR 712.1a, as amountDelta
        for (const { face, def } of this.behaviorBlocks(holder, anchor)) {
          for (const mod of def.amountMultipliers ?? []) {
            const f = mod.factor(this, anchor, ctx);
            if (f === 1) continue;                             // declined
            claims++;
            product *= f;
            by?.push(face);
          }
        }
      }
    } finally { this.inAmountMultipliers = false; }
    return claims === 0 ? 1 : product;
  }

  /**
   * CR 708.6a, 112.1a: `n` life is about to move — what number actually lands?
   *
   * The ONE place both amount families meet, and therefore the one place the
   * composition order is written down. `gainLife` and `loseLife` are the only
   * two ways a life total ever moves (combat face damage, effect damage to a
   * player, rot damage, {Lethal}, printed costs and {Blessed} all route through
   * them), so pricing life here prices all of it exactly once.
   *
   * ⚠ THE ORDER IS A RULE NOW. The multiplier rule (CR 708.6) answers how
   * multipliers compose with EACH OTHER, and CR 708.6a how one composes with an
   * additive `AmountMod`: the multiplier is applied AFTER the additive layer —
   * `(v + Σdelta) × factor` — which is also the reading that leaves a printed
   * "plus 1" worth one card rather than two, the same argument
   * `dealEffectDamageAll` makes for sitting the Conduit of Pain after {Powerful}.
   *
   * Region scope is `replaceLifeGain`'s, for its reason: `gainLife`/`loseLife`
   * write a region onto their events only inside a battle, and `fireEvent`
   * dispatches a region-less event to EVERY listener, so a life change outside
   * a battle is not a regional thing.
   *
   * Rounded to an integer (life totals are integers) and never below zero. No
   * card prints a fractional factor today; if one ever does, half of 3 is 2.
   */
  private lifeAmount(kind: 'lifeGain' | 'lifeLoss', seat: Seat, n: number, why: string): number {
    // Nothing to price, and NOT an early exit the callers may take: `loseLife`
    // is also the state check (`killPlayer` calls it with the player's whole
    // life total, which can be 0), so a zero must come back a zero and still
    // reach the lethal test.
    if (n <= 0) return n;
    const base = {
      kind, region: this.s.battle ? this.s.battle.region : undefined,
      player: seat, combat: false,
    } as const;
    const added = n + this.amountDelta({ ...base, amount: n });
    if (added <= 0) return 0;
    const by: CardName[] = [];
    const factor = this.amountFactor({ ...base, amount: added }, by);
    const out = factor === 1 ? added : Math.max(0, Math.round(added * factor));
    if (out !== n) {
      const verb = kind === 'lifeGain' ? 'gain' : 'lose';
      this.ev('info',
        `${[...new Set(by)].join(', ') || 'Amount modifiers'}: the ${n} life `
        + `${this.pname(seat)} would ${verb} (${why}) becomes ${out} (×${factor}).`,
        { seat, was: n, now: out, factor, why });
    }
    return out;
  }

  /**
   * CR 111.10, 111.10b: what it actually costs `seat` to play (or apply) `name` right now —
   * printed mana plus every active cost modifier, never below zero. `purpose`
   * separates playing from applying a mod: applying a mod is not playing
   * (CR 701.2b), so "spells cost [one] more to play" does not tax an augment.
   *
   * Deferral Drone's charge (CR 111.10k) adds the one PLAYER-side discount, folded in after the radiating
   * layer and before the clamp so a [1] card still goes free rather than
   * negative. The `purpose` guard is CR 701.2b doing its usual work: a mod
   * payment passes `purpose: 'mod'` and pays full price, no charge burnt.
   *
   * CR 702.7a: a spell TOKEN is priced here too — casting one is playing a spell,
   * so `doCastSpellToken` asks this for every token of the cast. Its printed
   * mana is 0 and it is not an X card: the X on "Crystal 4" is the token's
   * SIZE, not a cost, and is never passed as `opts.x`. Whatever a token costs
   * is therefore exactly what the modifier layer adds.
   */
  /**
   * CR 111.10i: the smallest X `name` may be played with in `region` — its printed
   * floor (`xMin`, e.g. "X can't be zero"), raised by any cost modifier that
   * says so (Stasis Sentry in battle). Only a PLAY has an X to choose.
   */
  xFloor(seat: Seat, name: CardName, opts: CostOpts = {}): number {
    const c = this.card(name);
    let floor = c.xMin ?? 0;
    if (c.mana !== 'X' || (opts.purpose ?? 'play') !== 'play') return floor;
    const region = opts.region ?? this.actionRegion(seat);
    const ctx = { seat, card: c, region, purpose: 'play' as const };
    for (const { holder, mod } of this.costModsFor(region)) floor = Math.max(floor, mod.xMin?.(this, holder, ctx) ?? 0);
    return floor;
  }

  manaToPlay(seat: Seat, name: CardName, opts: CostOpts = {}): number {
    const c = this.card(name);
    // CR 202.5: an X card's base cost IS the chosen X — "paying X replaces the
    // letter X on the printed card temporarily". Until it is chosen the
    // printed floor stands in, so the castability gate prices the cheapest
    // legal cast. The chosen X rides into the CostMod layer too (ctx.x), which
    // is how Stasis Sentry can raise a small X to three without taxing a big
    // one (CR 107.5, 111.10i).
    // CR 111.10i: …and the floor is the RAISED one (Stasis Sentry), not just the printed
    const base = c.mana === 'X' ? (opts.x ?? this.xFloor(seat, name, opts)) : c.mana;
    const region = opts.region ?? this.actionRegion(seat);
    const ctx = {
      seat, card: c, region, purpose: opts.purpose ?? 'play' as const,
      ...(opts.x !== undefined ? { x: opts.x } : {}),
    };
    let total = base;
    for (const { holder, mod } of this.costModsFor(region)) total += mod.delta?.(this, holder, ctx) ?? 0;
    // CR 111.10k: Deferral Drone's resolved charge. Player-side, so it is NOT
    // region-scoped the way the CostMod layer above is (CR 111.10) — see types.ts.
    // CR 702.7a, 701.1c: a spell token is PRICED here now (casting one is playing a
    // spell), but the Drone prints "the next CARD you play" and a token is
    // not a card (CR 304.2) — so a token neither takes the discount nor, in
    // commitItem, spends it.
    if (ctx.purpose === 'play' && CARD_PLAY_KINDS.has(c.kind)) {
      total -= this.s.nextPlayDiscount?.[seat] ?? 0;
    }
    return Math.max(0, total);
  }

  /**
   * CR 111.10k: arm "the next card you play this turn costs [`n`] less" for `seat`.
   *
   * The charge lives on `GameState`, not on the entity that granted it: the
   * ability has resolved and its cost is paid, so the granting card leaving
   * play cannot claw it back (owner's ruling — *"you paid for it"*). Multiple
   * charges ADD, which is the only composition that keeps "costs [3] less"
   * meaning the same thing twice; nothing in the pool can arm two yet.
   */
  grantNextPlayDiscount(seat: Seat, n: number): void {
    const tally = (this.s.nextPlayDiscount ??= this.s.players.map(() => 0));
    tally[seat] = (tally[seat] ?? 0) + n;
  }

  /** CR 111.10k: `seat` has played a card — the charge is consumed. A no-op when
   * there is nothing armed, so the two event sites that call it can do so
   * unconditionally. Bookkeeping, not an effect: it has already happened by
   * the time anyone hears about it, so nothing is queued and nothing can be
   * responded to (the Powerforge Synergist shape this replaces). */
  spendNextPlayDiscount(seat: Seat): void {
    const n = this.s.nextPlayDiscount?.[seat] ?? 0;
    if (n === 0) return;
    this.s.nextPlayDiscount![seat] = 0;
    this.ev('info', `Deferral Drone: the [${n}] discount is spent.`, { seat });
  }

  /**
   * CR 111.10k / ERRATA 2026-09-21 — an unspent charge expires at the END OF THE
   * PHASE THAT BOUGHT IT, not the end of the turn.
   *
   * Deferral Drone printed *"the next card you play this TURN"* until Caleb
   * narrowed it to *"this PHASE"*. `Phase` is already exactly the owner's four
   * — planning, battle, regroup, deploy — with the resource and haste steps
   * both INSIDE planning, so every boundary the card can mean is a transition
   * between two of those and this is called from all four.
   *
   * ⚠ THE CLEAR MOVED HERE OUT OF `startTurn`, IT WAS NOT COPIED. A turn
   * begins by entering planning, so the turn boundary is a phase boundary and
   * the old wipe is this one arriving; leaving both would be two reasons for
   * one effect, and the next person to change the window would have to find
   * them both. The `hasteManaSpent` tally beside it stays in `startTurn`,
   * because CR 803.7's window really is the turn.
   *
   * Zeroed rather than deleted, like every other per-window tally on
   * GameState: a state serialized before this existed reads as 0, and no saved
   * game replays differently for it.
   */
  expireNextPlayDiscount(into: Phase): void {
    const tally = this.s.nextPlayDiscount;
    if (!tally) return;
    for (let seat = 0; seat < tally.length; seat++) {
      const n = tally[seat] ?? 0;
      if (n === 0) continue;
      tally[seat] = 0;
      // ⚠ "unused" IS THE LOAD-BEARING WORD, not a stylistic choice. The
      // ABSENCE and COSTLY classifiers (CR D7.4, D7.4b) both know it, so this sentence classifies as
      // a tier-1 costly absence and earns a toast — which is right: the player
      // paid 4 debt for this charge and nothing on the board shows it going. An
      // earlier draft said "expires unspent", which is the same fact in words
      // the classifiers do not know, and would have slipped into the log alone.
      this.ev('info',
        `Deferral Drone: the [${n}] discount goes unused — it lasted the phase, and ${into} has begun.`,
        { seat: seat as Seat });
    }
  }

  /**
   * CR 111.10d: the LIFE half of the same layer — what playing `name` costs in life
   * on top of its mana ("Cards played during battle gain [Pay 2 life]").
   * Zero unless some CostMod in the region asks for it.
   */
  lifeToPlay(seat: Seat, name: CardName, opts: CostOpts = {}): number {
    const region = opts.region ?? this.actionRegion(seat);
    const ctx = { seat, card: this.card(name), region, purpose: opts.purpose ?? 'play' as const };
    let total = 0;
    for (const { holder, mod } of this.costModsFor(region)) total += mod.life?.(this, holder, ctx) ?? 0;
    return Math.max(0, total);
  }

  /**
   * CR 111.10f: what the cost-modifier layer adds to an ability ACTIVATION or to a
   * TRIGGER going to the stack — "[Augment] Abilities cost [one] more to
   * activate or trigger during battle" (Crevice Lurker). Designer: the card
   * "taxes the cost to activate or trigger abilities", and can stop e.g.
   * Ruinbringer's "After combat, delete all units" the way a negate can.
   *
   * The SAME radiating CostMod layer as CR 111.10 — same anchored() walk, same CR 101.6
   * region scope (the Lurker's own region, or its HOST's when donated), same
   * shallow CR 712.1a guard, same reentrancy latch — consulted with the two CR 111.10f
   * purposes. Deltas SUM exactly as card-play CostMods do (two Lurkers =
   * +2), clamped at zero. `byCard` names the cards whose deltas actually bit
   * (deduped) for the gate's prompts and log lines — the card the mod is
   * PRINTED on (`via`), not its anchor, so a donated Lurker is named
   * "Crevice Lurker" and never after its host.
   *
   * `sourceCard` is the card whose ability is being activated or triggered,
   * for any future modifier that filters by subject; Crevice Lurker's
   * "Abilities" is unqualified and ignores it. NOT taxed, documented:
   * resource activations and spell-token casts are not ability activations,
   * and an ability's "if you do" clause is not its own trigger (designer) —
   * it resolves inside its trigger's own parts and never re-enters here.
   */
  abilityTax(seat: Seat, sourceCard: CardName, region: number, purpose: 'activate' | 'trigger'): { total: number; byCard: CardName[] } {
    const ctx = { seat, card: this.card(sourceCard), region, purpose };
    let total = 0;
    const byCard: CardName[] = [];
    for (const { holder, mod, via } of this.costModsFor(region)) {
      const d = mod.delta?.(this, holder, ctx) ?? 0;
      if (d > 0 && !byCard.includes(via)) byCard.push(via);
      total += d;
    }
    return { total: Math.max(0, total), byCard };
  }

  /**
   * CR 111.10: the SACRIFICE third of the same layer — how many units playing
   * `name` additionally costs ("Cards your opponents play during battle gain
   * '[Sacrifice a unit]'", Vengeance). Zero unless some CostMod in the region
   * imposes it; contributions ADD (two Vengeances, two units — each bracketed
   * cost is its own payment).
   *
   * Unlike mana and life this cost carries a CHOICE, so it is NOT charged in
   * payCard: `playAtTiming` reads this count and attaches a 'playSacrifice'
   * pendingCosts atom to the item, which `collectItemCosts` collects in the
   * cast window — before the item reaches the stack, by the PAYER's own
   * picks. This query is only the bill; `canPayCard` gates on it.
   */
  unitsToPlay(seat: Seat, name: CardName, opts: CostOpts = {}): number {
    const region = opts.region ?? this.actionRegion(seat);
    const ctx = { seat, card: this.card(name), region, purpose: opts.purpose ?? 'play' as const };
    let total = 0;
    for (const { holder, mod } of this.costModsFor(region)) total += mod.sacrifice?.(this, holder, ctx) ?? 0;
    return Math.max(0, total);
  }

  canPayCard(seat: Seat, name: CardName, opts: CostOpts = {}): boolean {
    const c = this.card(name);
    // X spells: X is chosen and paid at cast (CR 107.2a); castability needs only the
    // smallest legal X to be affordable (xMin, e.g. "X can't be zero" → 1)
    if (this.openMana(seat) < this.manaToPlay(seat, name, opts)) return false;
    // CR 111.10d: an unpayable LIFE tax makes the card uncastable exactly as
    // unpayable mana does — CR 111.6b's rule, so 2 life is unpayable at 2 life.
    if (!this.canPayLife(seat, this.lifeToPlay(seat, name, opts))) return false;
    // CR 111.10: an imposed "[Sacrifice a unit]" gates castability the same way —
    // no unit to sacrifice, no play. The cost itself is chosen and paid in
    // the cast window (playAtTiming → collectItemCosts); this is only the gate,
    // which is what keeps the refusal atomic: nothing is ever half-paid.
    const sacs = this.unitsToPlay(seat, name, opts);
    if (sacs > 0 && this.unitsOf(seat, opts.region ?? this.actionRegion(seat)).length < sacs) return false;
    for (const [el, n] of Object.entries(affinityPips(c.cost))) {
      if (this.affinity(seat, el) < n) return false;
    }
    return true;
  }
  payMana(seat: Seat, mana: number): void {
    let need = mana;
    const rs = this.player(seat).resources;
    for (const r of rs) {  // expend non-prismite first (prismites stay flexible)
      if (need > 0 && r.state === 'open' && r.kind !== 'prismite') { r.state = 'expended'; need--; }
    }
    for (const r of rs) {
      if (need > 0 && r.state === 'open') { r.state = 'expended'; need--; }
    }
    if (need > 0) throw new Error('paid mana that was not there — canPay check missing');
    // CR 803.7 (Tithe Enforcer, "End [Haste] with used mana"): tally what is spent
    // DURING the haste step, so the prophecy can tell "you hasted something
    // else" from "you did nothing". Debt (CR 502.4) is paid in the resource step,
    // with hasteDone still null, so it deliberately does not count.
    if (mana > 0 && this.s.phase === 'planning' && this.s.hasteDone !== null) {
      const tally = (this.s.hasteManaSpent ??= this.s.players.map(() => 0));
      tally[seat] = (tally[seat] ?? 0) + mana;
    }
  }
  payCard(seat: Seat, name: CardName, opts: CostOpts = {}): void {
    const c = this.card(name);
    // CR 107.2a: an X spell's WHOLE mana bill — printed base and every cost
    // modifier alike — is settled at `collectX`, the moment X is known, and
    // nothing is owed before that. (It used to pay `manaToPlay - xMin` here,
    // charging the modifier layer against a base of `xMin` and then charging X
    // on top; that made Stasis Sentry a flat +3 on an X spell, which CR 107.5
    // rejects, and it capped `collectX`'s menu by mana it had already taken.)
    //
    // APPLYING an X card as a mod is not playing it (CR 701.2, 701.2b) and never
    // chooses an X, so that path still pays its modifier bill here, against
    // the printed floor, exactly as before.
    const isPlay = (opts.purpose ?? 'play') === 'play';
    const mana = c.mana === 'X'
      ? (isPlay ? 0 : Math.max(0, this.manaToPlay(seat, name, opts) - (c.xMin ?? 0)))
      : this.manaToPlay(seat, name, opts);
    this.payMana(seat, mana);
    // CR 111.10d: the life half of the bill, charged in the same breath as the mana
    // — before the card reaches the stack, so it cannot be responded to and
    // negating the card does not refund it.
    const life = this.lifeToPlay(seat, name, opts);
    if (life > 0) {
      this.ev('info', `${this.pname(seat)} pays ${life} life to play ${name}.`);
      this.loseLife(seat, life, `${name} (added cost)`);
    }
  }

  // ── LAYER 0: the COPY layer (CR 709.4a) ──────────────────────────────────
  /**
   * CR 709.4a — one FACE an entity is wearing: a card name plus which halves of
   * that card it contributes. `ref` is the stored copy it came from (absent on
   * the base face and on a continuous projection).
   */

  /**
   * THE IDENTITY FACE — what this entity IS for rules purposes.
   *
   * Layer 0 sits BELOW everything, because it redefines what "printed" MEANS:
   * the face supplies the game name, the type line, the printed numbers and
   * the printed text, and every other layer (baseSet, StaticMod baseP/baseT,
   * counters, {Tough}/{Balanced}, {Inverted}, {Unaware}) then applies on top
   * of THAT. A `setBase` therefore wins over a copy in BOTH orders — it is a
   * layer-2 rewrite of whatever layer 1 currently says.
   *
   * Last-wins by `seq` among the stored copies that carry the `name` facet,
   * the same rule and the same `nextId` clock `baseSet`/`baseSetSeq` uses.
   *
   * Cheap and recursion-free ON PURPOSE: it reads `e.copies` and nothing else,
   * so it can be called from inside the `facesOf` walk, from inside statics,
   * and from the trigger scan without any latch at all.
   *
   * ⚠ It does NOT read `Entity.card` for anything but the fallback. `card`
   * stays the PHYSICAL card forever (CR 201.5) — the thing that bins, is
   * erased, and belongs to a deck.
   */
  private identityCopy(e: Entity): CopyRef | undefined {
    let best: CopyRef | undefined;
    for (const c of e.copies ?? []) {
      if (!c.facets.includes('name')) continue;
      if (!best || c.seq >= best.seq) best = c;
    }
    return best;
  }

  /**
   * The card NAME this entity answers to (see `nameOf`, which is this) — and
   * the card its text, type line and printed numbers are read from.
   */
  faceName(e: Entity): CardName {
    return this.identityCopy(e)?.card ?? e.card;
  }
  /** the definition the entity's RULES come from — `getCard(faceName(e))` */
  faceDef(e: Entity): CardDef {
    return getCard(this.faceName(e));
  }
  /**
   * CR 710.2a — the AUGMENT mods a copy copied, by card name, in the source's
   * order (duplicates kept: two copied Graxxlids are two boxes, as two real
   * ones would be). Borrower of Forms: "I copy all stat changes, counters,
   * card text and mods"; RAQ: "it inherits all of the combined text".
   *
   * The copy carries each one's `[Augment]` box and nothing else (CR 721.1: an
   * augment radiates only its box), as text of the COPY — no mod entity is
   * cloned (CR 710.2a), so the box reads from the copy, keys its `[once]`
   * budgets on the copy (`augment:<card>#<n>`, the same key a real mod on
   * this host uses), and is stamped PRINTED (CR 712.7, 113.2): it is part of the card
   * text the copy became, so any stripper strips it.
   *
   * THE one enumerator. Every channel that walks a real augment mod's box —
   * `ownAttrs` (type-line attrs), `behaviorBlocks`/`donates` (the continuous
   * `augmentBox`), `fireEvent` (triggered `augmentText`) and apply.ts's
   * activated offer/accept — reads its copied twin here, gated on the same
   * facet the copy carries. A unit with no `copies` returns on the first read.
   */
  copiedAugments(e: Entity, facet: CopyFacet): readonly CardName[] {
    if (!e.copies) return NO_CARDS;
    const id = this.identityCopy(e);
    if (!id?.mods || !id.facets.includes(facet)) return NO_CARDS;
    const out: CardName[] = [];
    for (const m of id.mods) if (m.appliedAs === 'augment') out.push(m.card);
    return out;
  }
  /**
   * CR 710.1a / CT-219 — the COST of a unit in play: its FACE's printed mana (an X
   * card counts 0, as `manaOf` rules for a card not being cast). The RAQ
   * ("Borrower of Forms"): a Borrower that copied Robot 3 is not a token, "but
   * his cost would be 0. (For things like Deformant, Lumengrove Lurker, Death
   * Greeter or Abduct)". Every "cost N or less" read of a unit IN PLAY comes
   * here; a card NAME in a zone (bin, hand, deck) is still `manaOf`.
   */
  costOf(e: Entity): number {
    const m = this.faceDef(e).mana;
    return m === 'X' ? 0 : m;
  }

  /**
   * EVERY face this entity is wearing, in layer order — `[0]` is the identity
   * face (the base card, or the copy that replaced it), and the rest are what
   * is being projected onto it right now (Ancient One).
   *
   * The whole-picture read, for the text box and for anything that wants to
   * enumerate rather than ask about one facet. Hot paths call `facesWith`,
   * which does one projection walk instead of three.
   */
  facesOf(e: Entity): { card: CardName; facets: readonly CopyFacet[]; ref?: CopyRef }[] {
    const id = this.identityCopy(e);
    // [0] is ALWAYS the identity face — the whole reason a projection may not
    // carry `name` or `stats`
    const out: { card: CardName; facets: readonly CopyFacet[]; ref?: CopyRef }[] = [
      id ? { card: id.card, facets: id.facets, ref: id } : { card: e.card, facets: FULL_FACETS },
    ];
    for (const facet of PROJECTED_FACETS) {
      for (const name of this.projectedFaces(e, facet)) {
        const seen = out.find(f => f.card === name && !f.ref);
        if (seen) { if (!seen.facets.includes(facet)) seen.facets = [...seen.facets, facet]; continue; }
        if (out[0]!.card === name) continue;
        out.push({ card: name, facets: [facet] });
      }
    }
    return out;
  }

  /**
   * EVERY face contributing `facet`, in layer order: the identity face first,
   * then whatever is being projected onto this entity right now (Ancient
   * One). Names, deduped.
   *
   * This is the one call every "what does this thing DO" read routes through.
   * The handful of reads that mean "which PHYSICAL card is this" — the bin
   * push in `destroy`, `noteTrashed`, the CR 407.1 erased pile, DECK_LIST — keep
   * reading `e.card` raw, and must (CR 201.5).
   */
  facesWith(e: Entity, facet: CopyFacet): CardName[] {
    const out: CardName[] = [];
    const id = this.identityCopy(e);
    if (!id || id.facets.includes(facet)) out.push(id?.card ?? e.card);
    for (const name of this.projectedFaces(e, facet)) {
      if (!out.includes(name)) out.push(name);
    }
    return out;
  }

  /**
   * The CONTINUOUS half of layer 0 — faces radiating onto `e` from cards in
   * play right now (`CardDef.projects`; Ancient One is the only one today).
   *
   * Re-evaluated on every read, never stamped, because that is the whole
   * reason Ancient One could not be built on `Entity.copies`: adjacency
   * changes inside one combat (CR 602.5 column collapse, a neighbour dying,
   * blockers declared) and the answer has to change with it.
   *
   * The walk is `anchored()`'s, with the same shallow CR 712.1a guard every
   * radiating query uses — a SILENCED projector radiates nothing, so all of
   * its faces go off at once. A projected face may never carry `name` or
   * `stats`: `facesOf()[0]` is always the identity face, so the Ancient One
   * keeps its own name and its own 1/1.
   *
   * ⚠ REENTRANCY, and it is stricter than `staticsFor`'s: this sits UNDER
   * effStats, so `FaceProjection.faces` must not read a number. Under the
   * latch a nested query answers "identity face only", which is the same
   * shallow answer dp/dt already gets.
   */
  private projectedFaces(e: Entity, facet: CopyFacet): CardName[] {
    if (facet === 'name' || facet === 'stats') return [];   // never projected
    if (this.inFaces) return [];
    const out: CardName[] = [];
    this.inFaces = true;
    try {
      const mine = this.faceName(e);
      const live = this.radiates();
      for (const { holder, anchor } of this.anchored((h, a) =>
        this.ownBlocks(h, a).some(d => !!d.projects)          // CR 721.1: body or box
        && a.region === e.region
        && live(h, a))) {                                     // CR 712.1a, as staticsFor
        for (const pr of this.ownBlocks(holder, anchor).flatMap(d => d.projects ?? [])) {
          if (!(pr.onto ? pr.onto(this, anchor, e) : anchor.id === e.id)) continue;
          const facets = pr.facets ?? PROJECTED_FACETS;
          if (!facets.includes(facet)) continue;
          for (const name of pr.faces(this, anchor)) {
            if (name === mine) continue;                     // no recursive mimicry
            if (!out.includes(name)) out.push(name);
          }
        }
      }
    } finally { this.inFaces = false; }
    return out;
  }

  /**
   * CR 710.1: stamp a copied FACE onto `target`.
   *
   * `Entity.card` is deliberately untouched — see `Entity.copies`. A face that
   * carries `name` REPLACES any earlier one (last-wins by seq), so attacking
   * and then blocking in the same battle leaves one face, not two.
   */
  becomeCopy(target: Entity, src: Entity, opts: {
    from: CardName;
    until: 'regroup' | 'permanent';
    facets?: CopyFacet[];
    /** override layer 1 — Borrower of Forms only, see CopyRef.printedStats */
    printedStats?: [number, number];
  }): CopyRef {
    return this.wearCopy(target, this.prepareCopy(src, opts));
  }

  /**
   * CR 710.4: build the FACE `src` would be copied as, WITHOUT putting it on
   * anything. Plain serializable data, which is what lets a card park one for
   * a resolution that has not happened yet — Borrower of Forms erases its
   * target in one resolution and only spawns the body that wears the face in
   * the next, so the source entity is gone by the time it is needed.
   */
  prepareCopy(src: Entity, opts: {
    from: CardName;
    until: 'regroup' | 'permanent';
    facets?: CopyFacet[];
    printedStats?: [number, number];
  }): CopyRef {
    const name = this.faceName(src);                        // copy of a copy chains via the FACE
    // CR 710.2a: the copy carries its source's mods — their names and how each
    // was applied (CopyRef.mods) — and no mod ENTITIES are cloned. It is NOT
    // itself modded, so not Unstable (CT-225 reverses the earlier reading that such a copy is Unstable).
    // A copy of a copy chains: the source's own copied mods come first.
    const mods: { card: CardName; appliedAs: 'augment' | 'graft' }[] = [...(this.identityCopy(src)?.mods ?? [])];
    for (const id of src.mods) {
      const m = this.entity(id);
      if (!m) continue;
      mods.push({ card: m.card, appliedAs: m.appliedAs === 'graft' ? 'graft' : 'augment' });
    }
    const modText = mods.map(m => `${m.card} (${m.appliedAs === 'graft' ? 'grafted' : 'augmented'})`);
    const ref: CopyRef = {
      card: name,
      facets: opts.facets ?? [...FULL_FACETS],
      until: opts.until,
      from: opts.from,
      seq: this.s.nextId++,
      ...(opts.printedStats ? { printedStats: opts.printedStats } : {}),
      ...(mods.length ? { mods, modText } : {}),
    };
    return ref;
  }

  /** CR 710.1: put a prepared face on an entity (see `prepareCopy`). */
  wearCopy(target: Entity, ref: CopyRef): CopyRef {
    const name = ref.card;
    const list = (target.copies ??= []);
    if (ref.facets.includes('name')) {
      // one identity face at a time: an older whole-face copy is replaced
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i]!.facets.includes('name')) list.splice(i, 1);
      }
    }
    list.push(ref);
    this.ev('statChanged',
      `${target.card} becomes a copy of ${name}`
      + (ref.mods?.length ? `, with its ${ref.mods.length} mod(s)' text` : '')
      + (ref.until === 'regroup' ? ' until regroup.' : '.'),
      { unit: target.id, copy: name, until: ref.until });
    this.checkDeaths();   // a copied 0-defense body is lethal, as setBase is
    return ref;
  }

  /* The enters-as-a-copy ruling (CR 303.11) DELETED `parkCopySource` / `takeCopySource`. They existed for one
   * card — Borrower of Forms, whose face was prepared in its spell resolution
   * and worn in the next one — and the gap they bridged is gone: the face
   * rides the spell's own `StackItem.spawnWearing` and `spawnUnit` puts it on
   * as the body enters. `prepareCopy` above is still what builds it; there is
   * simply nowhere to park it now, which is the point (the slot was keyed by
   * REGION, so two Borrowers in one region shared it). */

  /** CR 710.1: is this entity already wearing `name` as its identity face? The
   * idempotence check a repeating copy trigger needs. */
  isCopyOf(e: Entity, name: CardName): boolean {
    return this.identityCopy(e)?.card === name;
  }

  /**
   * CR 803.8e: is this entity ERASED instead of binned when it dies?
   *
   * Three ways in, unioned here so `destroy` does not have to know there are
   * three: it carries mods (the derivation — a modded card is Unstable), it
   * carries CR 803.8d's until-regroup {Unstable} stamp, or its FACE prints
   * {Unstable} on the type line (Aberrant Statweaver, Oorblak — report #89:
   * nothing used to carry the printed marker, so both binned like anything
   * else). The printed flag reads the FACE, like ownAttrs' layer 0: a copy
   * wearing a printed-Unstable face is Unstable.
   *
   * There used to be a fourth: a COPY of something modded (an earlier reading, since reversed).
   * CT-225 removed it (CR 710.2a) — the RAQ ("Borrower of Forms"): a freshly
   * resolved copy of a modded unit is not Unstable.
   */
  isUnstable(e: Entity): boolean {
    if (e.mods.length > 0 || e.unstable === true) return true;
    return this.faceDef(e).unstable === true;
  }

  /**
   * CR 803.8k — the STACK twin of `isUnstable`. Is this stack item's card ERASED
   * instead of binned when it leaves the stack without arriving anywhere?
   *
   * ⚠ THE ACTIVE ZONE. Caleb's glossary (rules-bot dump, 2025-03-12) defines
   * {Unstable} as "if an unstable card would enter a bin FROM AN ACTIVE ZONE,
   * erase it instead" — and never says which zones are active. Bena supplied
   * the list, 2026-08-25: **in play and the stack are the active zones.** So
   * Unstable needs TWO readers, not one: `isUnstable` for the play half
   * (the engine's bin → trash → sweep; CR 405.5 erases instead, CT-246) and this one for the stack half. Hand, deck,
   * bin, cache and the erased pile are INACTIVE — a card leaving one of those
   * for a bin is binned and trashed normally, printed {Unstable} or not (that
   * is the open question in playtest-ledger #89, closed by "from an active
   * zone" in the direction of "no, it bins").
   *
   * THREE ways in, and the third is the one that was missing (CR 803.8k):
   *  · `augments` — a virus rode it, so the card is MODDED (CR 803.8f, derived);
   *  · `unstable` — the CR 803.8c bin-play stamp / the CR 724.5 {Modular} cast stamp;
   *  · the PRINTED FACE — Aberrant Statweaver and Oorblak print {Unstable} on
   *    the type line, and nothing on the stack path ever looked. Caleb rules
   *    this case directly (rules-questions 2025-09-13, on Spell Excavation):
   *    "So they would be erased if you used something like this and it got
   *    negated". Its negative control is the same thread six months earlier
   *    (2025-03-31) — "Negating an augment puts it in the bin or erase?" →
   *    "Into the bin" — which is why the printed check is a check and not a
   *    blanket erase for everything negated.
   *
   * ⚠ The printed face is consulted ONLY for the kinds whose `card` IS the
   * object on the stack (NEGATE_BINS). A triggered or activated item's `card`
   * names its SOURCE, which is still standing in play: reading the printed
   * flag off that would erase-log an ability because the unit that owns it
   * happens to be an Aberrant Statweaver. Same reason NEGATE_BINS excludes
   * them from the bin push.
   *
   * `negate()`, `dischargeItem()` and the two virus-fizzle sites all read
   * THIS. They used to compute `(augments?.length ?? 0) > 0 || unstable` twice
   * in two methods, which is exactly how the printed face went missing from
   * both at once.
   */
  itemIsUnstable(item: StackItem): boolean {
    if ((item.augments?.length ?? 0) > 0 || item.unstable === true) return true;
    // CR 704.2d: a COPY of a spell has no card, so the printed {Unstable} face
    // below cannot apply to it — there is nothing to erase instead of binning,
    // and reading the copied card's type line here would log an erase about a
    // card that is still on the stack underneath as the ORIGINAL.
    if (item.card === undefined || item.copy === true || !NEGATE_BINS.has(item.kind)) return false;
    return this.card(item.card).unstable === true;
  }

  // ── stats & attributes (the six-layer projection, all six built: see
  //    docs/03 §4, and CR 802.8a, 802.9a for layers 5 and 6) ──────────────────
  /** reentrancy guard for static-modifier evaluation (see StaticMod docs) */
  private inStatics = false;

  /** every StaticMod projected onto `target` by in-play units in its region.
   * `from` is the card that AUTHORED the static, which is not `holder.card`
   * when the text arrived on an augment mod (the mod anchors on its host) —
   * the text box has to name Transmogrifant, not the unit wearing it. */
  private staticsFor(target: Entity): { holder: Entity; from: CardName; srcId: EntityId; mod: import('./cards/dsl.ts').StaticMod }[] {
    if (this.inStatics) return [];
    const out: { holder: Entity; from: CardName; srcId: EntityId; mod: import('./cards/dsl.ts').StaticMod }[] = [];
    this.inStatics = true;
    try {
      // the anchored() walk: statics radiate from units in play AND from
      // augment mods (text-box [Augment] statics transfer with the card —
      // Animated Spark, Sandstone Defender), each read from its anchor.
      // CR 712.1a: a silenced unit radiates nothing — a static IS an ability.
      // Both halves of the strip, resolved in the two phases documented at
      // `activeStrippersAmong` (report #214, CT-256): the one-shot stamp a
      // spell left, and every continuous stripper that APPLIES in this region.
      // The walk is the region's, once; phase A reads the same blocks.
      const radiators = this.anchored((h, a) =>
        a.region === target.region
        && !this.textStrippedShallow(h, a));
      // CR 710.1 layer 0: the statics come off the FACES the holder is wearing,
      // not off `holder.card`. The identity face is the copied card (Apex
      // Prime, Borrower of Forms); the projected ones are the neighbours'
      // (Ancient One), and those land on the ANCHOR, so they are only
      // gathered when the holder IS its anchor. CR 721.1: and off the right HALF
      // of each face — a unit reads its body text and its own [Augment] box,
      // an augment MOD reads only the box (report #139).
      const blocks = radiators.map(({ holder, anchor }) => this.behaviorBlocks(holder, anchor, 'statics'));
      const active = this.activeStrippersAmong(radiators, blocks);
      for (let i = 0; i < radiators.length; i++) {
        const { holder, anchor } = radiators[i]!;
        if (this.silencedBy(holder, anchor, active)) continue;    // CR 712.1a, phase B
        for (const { face, def } of blocks[i]!) {
          for (const mod of def.statics ?? []) {
            // `srcId` is the entity CARRYING the text (the unit, or the augment
            // mod that donated it), not the anchor — it is the tick of the
            // nextId clock at which this static started applying, which is what
            // layer 2 sorts by. `from` is the FACE, because the text box has to
            // name the card the clause is printed on.
            if (mod.affects(this, anchor, target)) out.push({ holder: anchor, from: face, srcId: holder.id, mod });
          }
        }
      }
    } finally { this.inStatics = false; }
    return out;
  }

  /**
   * LAYERS 1-2: what the numbers on this card SAY right now.
   *
   * Layer 1 is what was printed (or, for a token, what it was created as).
   * Layer 2 is every effect that REWRITES that number rather than adjusting
   * it, and it comes from two places that have to be resolved together:
   *   - `Entity.baseSet`, an until-regroup stamp left by a one-shot ("becomes
   *     a base 4/4" — Formless, Unstable Refactor, Celestial Shifter, Floral
   *     Singularity; "exchange the base stats" — Body Swap);
   *   - `StaticMod.baseP`/`baseT`, radiating continuously for as long as its
   *     source is in play ("Your units are base 3/3" — Aberrant Statweaver).
   *
   * They resolve LAST-WINS, never by summing: each one replaces the number,
   * so two of them on one unit leave it on the later one's value and two
   * copies of the SAME one leave it exactly where one copy would. Timestamps
   * come from the shared nextId clock — the stamp's `baseSetSeq`, and for a
   * static the id of the entity carrying the text (so a Statweaver played
   * after a Formless overrides it, and before it does not).
   *
   * Layer 3 (counters, temp deltas, +X/+X statics) then applies ON TOP.
   *
   * Reentrancy: called from inside a static callback the guard hides the
   * continuous half, so only the stamp applies — the same shallow answer
   * dp/dt already gets, and the reason baseP/baseT must not call back in.
   */
  baseStatsOf(e: Entity): [number, number] {
    return this.baseWith(e, this.staticsFor(e));
  }
  /** baseStatsOf against an ALREADY-COLLECTED static list, so effStats scans
   * the board once for layers 2 and 3 instead of twice. */
  private baseWith(e: Entity, statics: ReturnType<E['staticsFor']>): [number, number] {
    // layers 0-1: what the card this entity currently IS prints (CR 709.4a)
    let [p, t] = this.printedStats(e);
    // layer 2: collect the rewrites, then apply them in timestamp order
    let rewrites: { seq: number; p?: number; t?: number }[] | undefined;
    for (const { holder, srcId, mod } of statics) {
      if (mod.baseP === undefined && mod.baseT === undefined) continue;
      (rewrites ??= []).push({
        seq: srcId,
        p: typeof mod.baseP === 'function' ? mod.baseP(this, holder, e) : mod.baseP,
        t: typeof mod.baseT === 'function' ? mod.baseT(this, holder, e) : mod.baseT,
      });
    }
    if (e.baseSet) (rewrites ??= []).push({ seq: e.baseSetSeq ?? 0, p: e.baseSet[0], t: e.baseSet[1] });
    if (rewrites) {
      if (rewrites.length > 1) rewrites.sort((a, b) => a.seq - b.seq);
      for (const r of rewrites) {
        if (r.p !== undefined) p = r.p;
        if (r.t !== undefined) t = r.t;
      }
    }
    return [p, t];
  }

  effStats(e: Entity): [number, number] {
    const statics = this.staticsFor(e);                        // one scan, two layers
    const base = this.baseWith(e, statics);                    // layers 1-2
    let p = base[0]! + e.counters + e.tempPower;               // layer 3
    let t = base[1]! + e.counters + e.tempToughness;
    for (const { holder, mod } of statics) {                   // layer 3: continuous projections
      p += typeof mod.dp === 'function' ? mod.dp(this, holder, e) : (mod.dp ?? 0);
      t += typeof mod.dt === 'function' ? mod.dt(this, holder, e) : (mod.dt ?? 0);
    }
    // layer 4: Tough / Balanced in application order (CR 709.4b); duplicates don't stack
    const statAttrs = this.statLayerAttrs(e);
    for (const a of statAttrs) {
      if (a === 'Tough') t *= 2;
      else if (a === 'Balanced') { const m = Math.max(p, t); p = m; t = m; }
    }
    /**
     * LAYER 5 — {Inverted} (CR 802.8a). "Invert the stat changes of inverted units."
     *
     * The operation is on the NET CHANGE FROM BASE, not on the final number
     * and not on each contribution one at a time. Caleb worked it through
     * himself in rules-questions and got both readings to agree:
     *
     *   "1/4 tough balanced is 8/8 — Tough is +0/+4, Balanced is +7/0.
     *    If we include inverted it gains +0/-4, -7/+0 → To become a -6/0"
     *   "If we compare 8/8 to 1/4, it's +7/+4"
     *   "Which also works to invert to a -6/0"
     *
     * so negating each contribution and negating the accumulated delta are the
     * same answer, and the delta form is one line. Hence `base - (cur - base)`,
     * i.e. `2·base - cur`. Earlier in the same channel, on whether it is a
     * word-game or arithmetic: "it is a mathematical operation, not a
     * linguistic operation" — Tough inverted is not "halve", it is "lose the
     * +0/+4 you gained" ("inverted would turn their +0/+3 into -0/-3 and kill
     * them"). Counters ride along by construction: "Does inverted reverse the
     * affect of +1/+1 Counters?" — "yes".
     *
     * `base` here is layers 1-2, which is exactly right: a base REWRITE
     * (`baseSet`, `StaticMod.baseP/baseT`) redefines what base IS rather than
     * changing it, so it is the thing inverted FROM and is never inverted.
     * spikeydog_40883, uncontradicted: "Its base stats aren't being inverted.
     * Just the modifications to those stats by counters, stat-altering
     * augments, or attributes."
     *
     * Applied ONCE, however many sources granted it — `statLayerAttrs` dedupes
     * on the way in, the same "an attribute is either present or not" rule
     * layer 4 runs on (CR 709.4c). Two Reality Benders on one host do not cancel.
     *
     * No death check happens inside here, and that is deliberate: `effStats`
     * is atomic and the caller checks deaths after. Caleb, asked whether a
     * unit dies part-way through the arithmetic: "Not if it hits 0 mid
     * calculation" / "Doesn't instantly die", and lofavreel's gloss he agreed
     * with — "imagine it as one big equation… It is not a time thing".
     *
     * ⚠ ONCE OPEN (now CR 709.4d): Caleb also said "Tough inverted balanced would be
     * different" from "tough balanced inverted", which would make {Inverted}
     * an interleaved member of the layer-4 order rather than a clean layer 5.
     * He immediately called that case "basically impossible to make happen.
     * Because tough inverted would die before you could add more", and his own
     * worked example is the clean layer. Shipped clean; see CR 709.4d.
     */
    if (statAttrs.includes('Inverted')) {
      p = 2 * base[0]! - p;
      t = 2 * base[1]! - t;
    }
    /**
     * LAYER 6 — {Unaware} (CR 802.9a, 802.9b). PRINTED, not base: layer 1 and nothing else.
     *
     * The owner, 2026-08-23, stating it operationally:
     *
     *   "Unaware means that it looks ONLY at what is the literal printed text
     *    on all cards 'involved' (self or others when dealing damage or in
     *    combat when dealing/receiving). So Bubb blocking a Robot token would
     *    kill it (do Bubb, it has 0 power and 0 defense), no matter how many
     *    +1/+1 counters it has. Bubb would also survive 100 -1/-1 counters
     *    just fine. Haboob kills anything that has 1 defense printed at the
     *    card level."
     *
     * This half is the SELF half: an Unaware card's own numbers never move off
     * the numbers on its face, for any purpose — combat, effects, and the
     * state-based death check alike, which is what makes "survive 100 -1/-1
     * counters just fine" true without a special case anywhere.
     *
     * Note it drops layer 2 as well, unlike {Inverted} one layer up. The Inverted
     * ruling's (CR 802.8c)
     * argument for keeping base rewrites there is about what {Inverted}
     * inverts FROM; this rule is about what a card READS, and "your units are
     * base 3/3" (Aberrant Statweaver) is not literal printed text on Bubb's
     * card. So `baseSet` and `StaticMod.baseP`/`baseT` are ignored too, along
     * with counters, temp deltas, dp/dt statics, layer 4 ({Tough}/{Balanced})
     * and layer 5 ({Inverted}). Everything above layer 1 goes.
     *
     * Read off `statLayerAttrs`, so {Unaware} is column-shared exactly like
     * {Tough}/{Balanced}/{Inverted} — Caleb, quoted on that helper: units in a
     * column "just share attributes in all situations". A column-mate of Bubb
     * is Unaware for as long as the formation holds, and therefore fights at
     * ITS printed stats too.
     *
     * The OTHER half of the Unaware rule (CR 802.9c) — every card in an interaction with an Unaware
     * card also reads at printed — cannot live here, because `effStats(e)`
     * knows only `e`. It lives in `interactionStats`, at the damage and combat
     * sites; see that method.
     */
    if (statAttrs.includes('Unaware')) return this.printedStats(e);
    return [p, t];
  }

  /**
   * LAYER 1 ALONE — "the literal printed text on the card" (CR 802.9a).
   *
   * For a token this is what it was CREATED as, which is the same thing its
   * card face says: a `Robot` prints 0/0 and carries its size in +1/+1
   * counters, so a Robot 7 reads 0/0 here, and that is the owner's own worked
   * example. `tokenStats` covers the synthetic stat tokens the engine makes
   * for cards that say "create an X/X".
   *
   * Deliberately NOT `baseStatsOf`, which is layers 1-2. See the layer-6 note.
   */
  printedStats(e: Entity): [number, number] {
    // LAYER 0 (CR 709.4a) sits UNDER layer 1 and redefines what "printed" means: a
    // Unit Token that became a copy of a Good Whale reads 7/5 here, because
    // the card it now is prints 7/5. This is the CR 802.9a {Unaware} decision, and
    // it is also why Borrower of Forms no longer writes `tokenStats` on a
    // non-token body — that write claimed the BORROWED numbers were what the
    // Borrower "was created as", and {Unaware} believed it.
    const id = this.identityCopy(e);
    if (id) {
      if (id.printedStats) return [id.printedStats[0], id.printedStats[1]];
      const f = getCard(id.card);
      return [f.power, f.toughness];
    }
    if (e.tokenStats) return [e.tokenStats[0], e.tokenStats[1]];
    const c = this.card(e.card);
    return [c.power, c.toughness];
  }

  /** CR 802.9: does this entity carry {Unaware} for stat purposes? Column-shared,
   * because it rides `statLayerAttrs` with the other three stat-layer attrs
   * (CR 802.1c) — so a unit standing beside Bubb in a formation is Unaware too. */
  unaware(e: Entity): boolean {
    return this.statLayerAttrs(e).includes('Unaware');
  }

  /**
   * CR 802.9c, the PAIRWISE half: the stats a card reads DURING AN INTERACTION.
   *
   * "it looks ONLY at what is the literal printed text on all cards
   * 'involved'" — so if ANY participant is {Unaware}, EVERY participant reads
   * at its printed stats, not just the Unaware one. Bubb blocking a Robot 7
   * sees a 0/0 and kills it; the Robot's seven +1/+1 counters are not there to
   * be seen.
   *
   * SCOPE, and it is deliberately narrow — the owner's parenthetical is the
   * whole of it: "self or others when dealing damage or in combat when
   * dealing/receiving". Three call sites, no more:
   *   · `assignCombatDamage` — power dealt and toughness assigned against,
   *     with both columns of the exchange as the participants;
   *   · `dealEffectDamageAll` — lethal arithmetic and the commit's death read,
   *     with the source and the recipient as the participants;
   *   · the `fight` helper in batch-earth-a.ts, which snapshots both powers.
   *
   * ⚠ TARGETING IS OUT OF SCOPE. The superseded Unaware ruling's older wording lists targeting as an
   * interaction; the owner's operational statement does not, and legality
   * checks read stats at ~33 card-side sites. Left as the Unaware ruling's one open
   * edge rather than guessed at.
   */
  interactionStats(u: Entity, involved: readonly (Entity | undefined)[]): [number, number] {
    return this.collapsedBy(u, involved) ? this.printedStats(u) : this.effStats(u);
  }
  /** the test `interactionStats` runs, exposed so a site that reads several
   * numbers off one exchange can ask once instead of per number. */
  collapsedBy(u: Entity, involved: readonly (Entity | undefined)[]): boolean {
    if (this.unaware(u)) return true;
    for (const e of involved) if (e && this.unaware(e)) return true;
    return false;
  }
  /**
   * CR 802.9e: kill whatever the collapsed reading has already killed.
   *
   * `checkDeaths` is the state-based sweep and it reads `effStats`, so it
   * cannot see that a Robot 7 read 0 defense in the exchange it just lost, or
   * that Haboob's 1 damage was lethal on a printed 1 defense under five +1/+1
   * counters. Both of the owner's kill examples live here. Run at the end of
   * an exchange, over its participants, never globally: outside an interaction
   * a Robot 7 is a 7/7 and stays one.
   */
  private sweepCollapsedDeaths(ids: Iterable<EntityId>): void {
    for (const id of ids) {
      const u = this.entity(id);
      if (!u) continue;
      const [p, t] = this.printedStats(u);
      if (t > 0 && u.damage < t) continue;
      this.ev('info',
        `Unaware: ${u.card} is read at its printed ${p}/${t} — it dies.`, { unit: id });
      this.destroy(u, 'dies');
    }
  }
  /** CR 709.4b, 709.4c, 802.1j: the stat-layer attrs, in layer-4 application order — own
   * printed (type-line order), then augment mods (stack order), then
   * column-shared (column order); first occurrence wins, an attribute is
   * either present or not. {Inverted} rides the same walk because it is
   * granted by exactly the same channels ({Inverted} is printed on Its Dark
   * Bubb, donated by Reality Bender's type-line [Augment], and grantable by a
   * static — see batch-hybrids-ld-b's attr row) and its POSITION in this list
   * is unused: layer 5 applies once, after the whole of layer 4. {Unaware}
   * (layer 6) rides it for the same reason and on the same channels: printed
   * on Bubb / Trashling / Haboob, donated by Bubb's and Trashling's type-line
   * [Augment], and grantable by an Omniphage attr row.
   *
   * The walk is `ownAttrs`, never `effStats`, and that is what keeps layer 6
   * out of a loop: `ownAttrs` reads printed data, `tempAttrs`, augment mods
   * and statics' `attrs` — it never asks anyone for a number.
   *
   * Column-sharing {Inverted} is not an extrapolation from Tough; it is asked
   * and answered verbatim in rules-questions —
   *   spikeydog_40883: "So, all attributes are shared between the units in the
   *                     same column? Including stuff like Inverted or Tough?"
   *   calebgannon:     "Yes"
   * and again, generally: "Units in a column just share attributes in all
   * situations… if one unit in the column has tough, the other will also have
   * it and it's defense will be doubled (regardless of it's when you're
   * calculating combat damage, fighting or whatever)". A player working the
   * consequence out in the same channel: augmenting Reality Bender onto a
   * robot's column-mate kills the robot "because it would share inverted
   * attribute with" it. */
  private statLayerAttrs(e: Entity): ('Tough' | 'Balanced' | 'Inverted' | 'Unaware')[] {
    const out: ('Tough' | 'Balanced' | 'Inverted' | 'Unaware')[] = [];
    const take = (attrs: Iterable<string>) => {
      for (const a of attrs) {
        if ((a === 'Tough' || a === 'Balanced' || a === 'Inverted' || a === 'Unaware')
          && !out.includes(a)) out.push(a);
      }
    };
    take(this.ownAttrs(e));
    const col = this.columnOf(e.id);
    if (col) {
      for (const id of col) {
        if (id === e.id) continue;
        const u = this.entity(id);
        if (u) take(this.ownAttrs(u));
      }
    }
    return out;
  }
  /**
   * CR 712.1 — the SUPPRESSION layer: which halves of a card are switched off right
   * now, and by what. Two sources, unioned here so nothing else has to know
   * there are two: the until-regroup flag a spell stamped on the entity
   * (`Entity.suppressed`) and every continuous `suppressAttrs`/
   * `suppressAbilities` static radiating onto it (Monke, Transmogrifant).
   *
   * Suppression is subtractive, so it is a VETO rather than a sum: one
   * suppressor switches the layer off and nothing switches it back on. It sits
   * UNDER every other layer — an attribute the unit would otherwise gain from
   * a mod, a column-mate, or a temp grant is gone too, because the printed
   * text says "loses ALL attributes", not "loses its printed attributes".
   *
   * `by` is for the text box: the cards to blame, deduped, entity flag first.
   */
  // ── CR 712.2, 113.3: STRIPPING IS A LAYER APPLIED IN TIMESTAMP ORDER ────────────
  //
  // The RAQ ("[Solved] Monke & Transmogrifant vs Suppression Field &
  // Formless", "[Solved] Timestamps vs Static Abilities"; Caleb: "anything
  // after that will still apply") and the owner, 2026-10-09: "that goes for
  // all ability stripping … it becomes a layer". A stripper takes what the
  // unit has when it applies; an attribute, ability or mod that arrives AFTER
  // it still applies. Printed text is the oldest thing on any unit, so every
  // stripper takes it — a unit entering play under Monke still loses its own.
  // This replaces the old suppression ruling's veto.

  /** the timestamp of what a card PRINTS: older than anything that can strip it */
  static readonly PRINTED: Stamp = [-Infinity, 0];
  /** a stamp with no time on it (a state saved before strips carried a time): later than everything */
  static readonly LATEST: Stamp = [Infinity, Infinity];
  /** is `a` strictly older than `b`? */
  static older(a: Stamp, b: Stamp): boolean {
    return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  }
  /** an entity's arrival: the clock read its id (see `Stamp`) */
  static entityStamp(id: EntityId): Stamp { return [id, Infinity]; }
  /** a one-shot timestamp for NOW, taking no entity id */
  stampNow(): Stamp {
    this.s.layerTick = (this.s.layerTick ?? 0) + 1;
    return [this.s.nextId, this.s.layerTick];
  }
  /** every stripper of one half of `e`, as the timestamp it applied at: the
   * one-shot stamp on the entity and every continuous stripper radiating onto
   * it (a static applies from when the entity CARRYING it arrived, as in
   * layer 2) */
  strippersOf(e: Entity, half: 'attrs' | 'abilities', statics?: ReturnType<E['staticsFor']>): Stamp[] {
    const out: Stamp[] = [];
    const sup = e.suppressed;
    if (half === 'attrs' && sup?.attrs) out.push(sup.attrsAt ?? E.LATEST);
    if (half === 'abilities' && sup?.abilities) out.push(sup.abilitiesAt ?? E.LATEST);
    for (const st of statics ?? this.staticsFor(e)) {
      if (half === 'attrs' ? st.mod.suppressAttrs : st.mod.suppressAbilities) out.push(E.entityStamp(st.srcId));
    }
    return out;
  }
  /** did something that arrived at `at` arrive before one of these strippers? */
  static strippedBy(at: Stamp, strips: readonly Stamp[]): boolean {
    return strips.some(s => E.older(at, s));
  }
  /** when the text `holder` carries arrived on `anchor`: its printed text
   * (holder IS the anchor), or the augment mod that donated it */
  static textStamp(holder: Entity, anchor: Entity): Stamp {
    return holder.id === anchor.id ? E.PRINTED : E.entityStamp(holder.id);
  }
  /** CR 712.2, the FULL question for a radiator: is the text `holder` carries on
   * `anchor` stripped right now? */
  textStripped(holder: Entity, anchor: Entity): boolean {
    const strips = this.strippersOf(anchor, 'abilities');
    return strips.length > 0 && E.strippedBy(E.textStamp(holder, anchor), strips);
  }
  /** The ONE-SHOT half of the radiator question: the entity stamp a spell left
   * (Suppression Field). Reads no statics, so it is safe under any latch. The
   * radiator walks ask `radiates()` below, which adds the continuous half. */
  textStrippedShallow(holder: Entity, anchor: Entity): boolean {
    const sup = anchor.suppressed;
    if (!sup?.abilities) return false;
    return E.older(E.textStamp(holder, anchor), sup.abilitiesAt ?? E.LATEST);
  }

  // ── CR 712.1a, 712.5: WHICH CONTINUOUS STRIPS APPLY, AND WHAT THEY SILENCE ──────
  //
  // Report #214 / CT-256. Owner: "static effects count as abilities.
  // Everything (besides an attribute) is an ability." So a unit that
  // Transmogrifant, Monke or The Everywhere strips stops radiating — every
  // static, cost change, amount mod, permission, projection and must-target
  // line it carries — exactly as one Suppression Field stamped does.
  //
  // It used to be the one-shot stamp only (`textStrippedShallow`), because the
  // radiator walks run under the `inStatics` latch and a nested `staticsFor`
  // answers []: a continuous strip is itself a static, so the full question
  // ("what statics land on this anchor?") could not be asked from inside the
  // walk that collects statics. The answer is to ask a SMALLER question first,
  // in two phases, without recursing:
  //
  //  PHASE A (`activeStrippers`): the continuous ability-strippers in one
  //   region — statics with `suppressAbilities`, off radiators the one-shot
  //   stamp leaves alone — and which of them APPLY. A stripper X strips a
  //   stripper Y when X affects Y's anchor and Y's text is older than X
  //   (CR 113.2: printed text is older than any effect; a mod's text is as old
  //   as the mod). Where only one strips the other, timestamp order decides:
  //   the one that is not stripped applies and the other does not. Where each
  //   strips the other, the NEWER applies and the older does not — Caleb,
  //   rules-questions 2023-08-27: "the second transmogrifant turns off the irst
  //   one", and 2023-09-05: "The two transmogrifants would turn off the other
  //   one though so you could only have one of them active at once" / "one
  //   would get +2/+2 and one would mot". (This replaces the one-pass "both
  //   apply" answer the engine used to give two Monkes.)
  //  PHASE B (`radiates`): a radiator's text is silent when it is older than an
  //   APPLYING stripper that affects its anchor. A stripper never silences the
  //   text that carries it (The Everywhere naming itself still radiates).
  //
  // Phase A runs under `inStatics`, so every callback it makes (a stripper's
  // `affects`, a face walk) gets the old shallow answer from any nested static
  // query — the same bounded depth as before, one level further out. Asked
  // from INSIDE a latched walk, `radiates` falls back to that shallow answer.

  /** PHASE A over radiators already walked for one region: the continuous
   * ability-strippers among them that apply. Caller holds `inStatics`. */
  private activeStrippersAmong(
    radiators: readonly { holder: Entity; anchor: Entity }[],
    blocks: readonly { face: CardName; def: CardBehavior }[][],
  ): { holderId: EntityId; anchor: Entity; mod: import('./cards/dsl.ts').StaticMod; at: Stamp }[] {
    type S = { holderId: EntityId; anchor: Entity; mod: import('./cards/dsl.ts').StaticMod; at: Stamp; text: Stamp };
    let cand: S[] | undefined;
    radiators.forEach(({ holder, anchor }, i) => {
      for (const { def } of blocks[i]!) {
        for (const mod of def.statics ?? []) {
          if (!mod.suppressAbilities) continue;
          (cand ??= []).push({ holderId: holder.id, anchor, mod, at: E.entityStamp(holder.id), text: E.textStamp(holder, anchor) });
        }
      }
    });
    if (!cand) return [];                                      // almost every board
    const c = cand;
    const n = c.length;
    // strips[x][y]: X would silence Y's text (another carrier, Y's anchor under X, Y's text older)
    const strips = c.map(x => c.map(y => x.holderId !== y.holderId
      && E.older(y.text, x.at) && x.mod.affects(this, x.anchor, y.anchor)));
    // newest first: the order Caleb's tie-break reads
    const order = c.map((_, i) => i).sort((i, j) => (E.older(c[i]!.at, c[j]!.at) ? 1 : E.older(c[j]!.at, c[i]!.at) ? -1 : i - j));
    const st: (0 | 1 | 2)[] = c.map(() => 0);                 // 0 undecided · 1 applies · 2 silenced
    for (;;) {
      for (let y = 0; y < n; y++) {
        if (st[y] === 0 && c.some((_, x) => st[x] === 1 && strips[x]![y])) st[y] = 2;
      }
      const open = order.filter(i => st[i] === 0);
      if (!open.length) break;
      // the newest stripper nothing undecided can silence ONE-WAY; a mutual pair
      // is no obstacle (the newer of the two wins it)
      const pick = open.find(y => !open.some(x => x !== y && strips[x]![y] && !strips[y]![x])) ?? open[0]!;
      st[pick] = 1;
    }
    return c.filter((_, i) => st[i] === 1).map(({ holderId, anchor, mod, at }) => ({ holderId, anchor, mod, at }));
  }

  /** PHASE B for one radiator against a region's applying strippers. */
  private silencedBy(
    holder: Entity, anchor: Entity,
    active: readonly { holderId: EntityId; anchor: Entity; mod: import('./cards/dsl.ts').StaticMod; at: Stamp }[],
  ): boolean {
    if (!active.length) return false;
    const t = E.textStamp(holder, anchor);
    return active.some(x => x.holderId !== holder.id && E.older(t, x.at) && x.mod.affects(this, x.anchor, anchor));
  }

  /** CR 712.1a, THE radiator filter every `anchored()` channel asks: does the text
   * `holder` carries on `anchor` apply right now? A fresh closure per walk, so
   * phase A is worked out at most once per region per walk, and only for a
   * region where some donor actually asked. */
  private radiates(): (holder: Entity, anchor: Entity) => boolean {
    let byRegion: Map<number, Map<EntityId, boolean>> | undefined;
    let actives: Map<number, ReturnType<E['activeStrippersAmong']>> | undefined;
    return (holder, anchor) => {
      if (this.textStrippedShallow(holder, anchor)) return false;
      if (this.inStatics) return true;                        // nested: the shallow answer
      let active = actives?.get(anchor.region);
      if (!active) {
        this.inStatics = true;
        try {
          const radiators = this.anchored((h, a) => a.region === anchor.region && !this.textStrippedShallow(h, a));
          active = this.activeStrippersAmong(radiators, radiators.map(r => this.behaviorBlocks(r.holder, r.anchor, 'statics')));
        } finally { this.inStatics = false; }
        (actives ??= new Map()).set(anchor.region, active);
      }
      if (!active.length) return true;
      const memo = ((byRegion ??= new Map()).get(anchor.region) ?? new Map<EntityId, boolean>());
      byRegion.set(anchor.region, memo);
      let silent = memo.get(holder.id);
      if (silent === undefined) {
        this.inStatics = true;
        try { silent = this.silencedBy(holder, anchor, active); } finally { this.inStatics = false; }
        memo.set(holder.id, silent);
      }
      return !silent;
    };
  }

  suppressionOf(e: Entity): { attrs: boolean; abilities: boolean; by: CardName[] } {
    const by: CardName[] = [];
    const blame = (n: CardName) => { if (!by.includes(n)) by.push(n); };
    let attrs = false, abilities = false;
    if (e.suppressed?.attrs) { attrs = true; blame(e.suppressed.attrs); }
    if (e.suppressed?.abilities) { abilities = true; blame(e.suppressed.abilities); }
    for (const { from, mod } of this.staticsFor(e)) {
      if (mod.suppressAttrs) { attrs = true; blame(from); }
      if (mod.suppressAbilities) { abilities = true; blame(from); }
    }
    return { attrs, abilities, by };
  }
  /** CR 712.1a: are this entity's triggered / activated / static / cost abilities
   * switched off? The gate on every path that would otherwise fire one.
   *
   * The WHOLE-LAYER question, and it stays that: it answers "loses all
   * abilities" (Monke, Transmogrifant, The Everywhere) and is what the
   * radiator predicates read, because a unit with no ability layer radiates
   * nothing. A suppressor that names ONE clause is CR 712.4's
   * `abilityIsSuppressed` below and is invisible here — a Wisp that may not
   * sacrifice itself still HAS an ability layer, and everything else in it
   * still works. */
  abilitiesSuppressed(e: Entity): boolean {
    if (e.suppressed?.abilities) return true;
    return this.staticsFor(e).some(s => s.mod.suppressAbilities);
  }

  /**
   * CR 712.4: is THIS ability of `e` switched off right now?
   *
   * The per-clause question, asked wherever an ability would actually fire or
   * be offered. Two sources, unioned so no caller has to know there are two:
   * the whole-layer veto above, and every `StaticMod.suppressAbility` matcher
   * radiating onto `e` ("your wisps … do not sacrifice themselves after
   * combat" — Infernal Wispweaver). Veto-shaped like the layer flag: one
   * matcher is enough and nothing votes it back on.
   *
   * `self` is the ANCHOR, as everywhere else: a matcher donated by an augment
   * mod reads from the host wearing it.
   */
  abilityIsSuppressed(e: Entity, ability: Ability, at: Stamp = E.PRINTED): boolean {
    const statics = this.staticsFor(e);
    // CR 113.2: the whole-layer half is a timestamp question — `at` is when this
    // ability's text arrived on `e` (its own text is PRINTED, the oldest; an
    // augment mod's is the mod's arrival), and a stripper takes only older text
    if (E.strippedBy(at, this.strippersOf(e, 'abilities', statics))) return true;
    return statics.some(s => s.mod.suppressAbility?.(this, s.holder, e, ability) ?? false);
  }

  /**
   * CR 506.2: is this spell token protected from the regroup erase by a live
   * static ("Your spell tokens stay through regroup" — Harbinger of
   * Immolation)? Same veto shape as abilitiesSuppressed(): one protector is
   * enough, and nothing votes the other way.
   *
   * Asked once per token by startRegroup, and asked EARLY on purpose — see
   * the ordering note there: the answer has to be read while the protector is
   * still the unit it was during the battle.
   */
  spellTokenSurvivesRegroup(e: Entity): boolean {
    return this.staticsFor(e).some(s => s.mod.survivesRegroup);
  }

  /**
   * The card-text engine's window onto layer 3: every continuous projection
   * landing on `e` right now, numbers already evaluated, each attributed to
   * the card that AUTHORED it rather than the entity carrying it.
   *
   * Pure, and deliberately reading the very same statics effStats/ownAttrs
   * read — a text box built from this cannot disagree with the board it is
   * describing. (Same contract as StaticMod: dp/dt must not re-enter stat
   * evaluation, so calling them here is safe.)
   */
  projections(e: Entity): {
    from: CardName; holder: EntityId;
    dp: number; dt: number; attrs: string[];
    suppressAttrs: boolean; suppressAbilities: boolean;
    /** LAYER 2: this static REWRITES the base rather than adjusting it, and
     * these are the numbers it writes (absent = it leaves that half alone).
     * A base-setter's dp/dt really are 0, so the text box has to credit it
     * from here or it would print nothing at all. */
    baseP?: number; baseT?: number;
  }[] {
    return this.staticsFor(e).map(({ holder, from, mod }) => ({
      from, holder: holder.id,
      dp: typeof mod.dp === 'function' ? mod.dp(this, holder, e) : (mod.dp ?? 0),
      dt: typeof mod.dt === 'function' ? mod.dt(this, holder, e) : (mod.dt ?? 0),
      attrs: [...(mod.attrs ?? [])],
      suppressAttrs: !!mod.suppressAttrs,
      suppressAbilities: !!mod.suppressAbilities,
      ...(mod.baseP !== undefined
        ? { baseP: typeof mod.baseP === 'function' ? mod.baseP(this, holder, e) : mod.baseP } : {}),
      ...(mod.baseT !== undefined
        ? { baseT: typeof mod.baseT === 'function' ? mod.baseT(this, holder, e) : mod.baseT } : {}),
    }));
  }

  /** attrs on the card itself + type-line attrs granted by augment/virus mods */
  ownAttrs(e: Entity): Set<string> {
    const set = new Set<string>();
    const statics = this.staticsFor(e);
    // CR 712.2: a stripper takes what arrived BEFORE it and nothing after. Each
    // source below carries its arrival time; with no stripper on the unit
    // (almost always) every check is skipped.
    const strips = this.strippersOf(e, 'attrs', statics);
    const keep = (at: Stamp): boolean => !strips.length || !E.strippedBy(at, strips);
    // LAYER 0 (CR 710.1): the attrs of the card this entity currently IS. Only the
    // identity face carries `attrs`, so this is one name, not a union.
    if (keep(E.PRINTED)) for (const a of this.faceDef(e).attrs) set.add(a);
    (e.tempAttrs ?? []).forEach((a, i) => { if (keep(e.tempAttrsAt?.[i] ?? E.PRINTED)) set.add(a); });
    for (const { srcId, mod } of statics) {
      if (mod.attrs?.length && keep(E.entityStamp(srcId))) for (const a of mod.attrs) set.add(a);
    }
    for (const id of e.mods) {
      const m = this.entity(id);
      if (m && m.appliedAs === 'augment' && keep(E.entityStamp(m.id))) {
        for (const a of this.card(m.card).augmentAttrs) set.add(a);
      }
    }
    // CR 712.7: the type-line attrs of the augment mods a copy copied — part of
    // the copied card text, so as old as the printed attrs (CR 113.2)
    if (keep(E.PRINTED)) {
      for (const card of this.copiedAugments(e, 'attrs')) for (const a of this.card(card).augmentAttrs) set.add(a);
    }
    return set;
  }
  /**
   * The card NAME this entity answers to — what a "name a card" effect
   * (The Everywhere) matches against, and the one place that comparison is
   * made.
   *
   * The copy layer this hook was reserved for has landed (CR 710.1), so it is now
   * `faceName(e)` — the GAME name, which is the copied card when the entity is
   * wearing a face. `Entity.card` keeps the other job it was doing: the
   * PHYSICAL card, the one that bins, is erased and belongs to a deck (ruling
   * 1). Card code must never compare `t.card === named` directly.
   */
  nameOf(e: Entity): CardName {
    return this.faceName(e);
  }
  /** the formation column an entity currently fights in, if any */
  columnOf(id: EntityId): EntityId[] | null {
    const b = this.s.battle;
    if (!b) return null;
    for (const col of b.columns) if (col.includes(id)) return col;
    for (const col of Object.values(b.blocks)) if (col.includes(id)) return col;
    return null;
  }
  colAttrs(ids: EntityId[]): Set<string> {
    const set = new Set<string>();
    for (const id of ids) {
      const u = this.entity(id);
      if (u) for (const a of this.ownAttrs(u)) set.add(a);
    }
    return set;
  }
  /**
   * CR 802.25 {Pure}: "Pure cards and cards they are interacting with ignore all
   * other attributes." Pure is not a one-sided evasion-breaker — it switches
   * the attribute layer off for BOTH sides of the interaction it is in, its
   * own other attributes included (Light & Dark provisional glossary).
   *
   * Combat is where attributes live, so the interaction unit is the
   * attack-column/block-column pair: one Pure card anywhere in either makes
   * that whole exchange attribute-blind. A Pure blocker therefore blocks a
   * Flying or Evasive column, and takes and deals damage with the
   * Piercing / Deadly / Powerful / Swift layer switched off.
   */
  pure(...cols: readonly EntityId[][]): boolean {
    for (const ids of cols) {
      for (const id of ids) {
        const u = this.entity(id);
        if (u && this.ownAttrs(u).has('Pure')) return true;
      }
    }
    return false;
  }
  /** combat attributes are shared vertically within a column */
  effAttrs(e: Entity): Set<string> {
    const col = this.columnOf(e.id);
    return col ? this.colAttrs(col) : this.ownAttrs(e);
  }

  // ── zones ───────────────────────────────────────────────────────────
  /** the deck `seat` draws from / recycles to: their own in constructed,
   * the communal one otherwise */
  deckOf(seat: Seat): CardName[] {
    if (this.s.mode === 'constructed') return this.s.decks![seat]!;
    return this.s.sharedDeck;
  }
  /**
   * CR 408.2e: the RECYCLE PILE `seat` recycles into — their own in constructed,
   * the communal one otherwise. `deckOf`'s twin, and the only way to reach
   * the zone.
   *
   * Both backing fields are optional (an older saved state has neither), so this
   * creates the array on first use rather than reading `!`. That is the whole
   * of the migration: an old game restores with no pile, recycles its first
   * card into a fresh one, and behaves like a new game from there.
   */
  recycleOf(seat: Seat): CardName[] {
    if (this.s.mode === 'constructed') {
      const piles = (this.s.recycled ??= this.s.players.map(() => []));
      return (piles[seat] ??= []);
    }
    return (this.s.sharedRecycled ??= []);
  }
  /**
   * CR 408.2b — THE MARK: when the deck runs out, the recycled cards are shuffled
   * and become the new deck.
   *
   * Called at the top of every read of the deck, and it is the ONLY thing
   * that moves a card out of the pile. Nothing else needs to know the pile
   * exists: `draw`, `mill`, `cacheTopOfDeck`, `glimpse` and the card-facing
   * `revealTop` / `takeTop` each ask for cards and get them. (Owner,
   * 2026-10-21: ANYTHING that uses the deck can reach the mark — card code
   * never reads `deckOf` itself; 526-card-code-never-reads-the-deck guards that.)
   *
   * Deliberately per-card rather than per-request: a "draw 2" off a one-card
   * deck takes that card, refills, and takes the second from the shuffled
   * pile — which is what a player does at the table. The pile-empty guard is
   * what makes a truly empty zone terminate instead of shuffling nothing
   * forever; a player with an empty deck AND an empty pile simply draws
   * fewer, which was the behaviour before the mark and is still the rule (CR 401.4: there is no
   * deck-out loss).
   *
   * `need` is how many cards the caller is about to read, and it exists for
   * GLIMPSE, which reveals N at once and must not mutate anything before its
   * "cache one" decision (that decision suspends, and the part re-enters from
   * scratch — the same no-mutation-before-suspend discipline collectAssignPlans
   * keeps). Refilling up front is SAFE and gives the identical cards, because
   * the pile is appended UNDER whatever is left of the deck: reading one real
   * card and then reshuffling, or reshuffling beneath it and then reading
   * three, reveal the same three cards in the same order. It is also
   * idempotent on re-entry — once the pile is in, the deck is no longer short
   * — so the shuffle happens exactly once and the replay is deterministic.
   *
   * The shuffle goes through `E.shuffle`, so it advances `s.rngState` and
   * replays identically. ⚠ It also means a game that decks out consumes RNG
   * that the same seed did not consume before the recycle mark existed — every saved game that
   * reached the bottom of its deck replays as engine drift from here, which
   * `replay-room.ts` reports as exactly that.
   */
  private refillFromRecycled(seat: Seat, need = 1): void {
    const deck = this.deckOf(seat);
    if (deck.length >= need) return;
    const pile = this.recycleOf(seat);
    if (pile.length === 0) return;
    const n = pile.length;
    deck.push(...this.shuffle(pile.splice(0, n)));
    this.ev('recycle',
      `${this.pname(seat)}'s deck is out — the ${n} recycled card(s) are shuffled into a new deck.`,
      { seat, n, reshuffled: true });
  }
  /** CR 408.2b: take the top card of `seat`'s deck, reshuffling the recycle pile
   *  into it first if the deck has run out. `undefined` = both are empty. */
  private takeFromDeck(seat: Seat): CardName | undefined {
    this.refillFromRecycled(seat);
    return this.deckOf(seat).shift();
  }
  /**
   * CR 408.2b — THE ONE WAY CARD CODE LOOKS AT A DECK: the top `n` cards of
   * `seat`'s deck, as a copy, in deck order. Fewer only when the deck AND the
   * recycle pile together hold fewer.
   *
   * The owner, 2026-10-21: *"The recycled cards are meant to be a part of your
   * deck still … So ANYTHING that uses the deck should be able to trigger the
   * reshuffle."* So a reveal wider than what is left above the mark reshuffles
   * the pile in first, exactly as `glimpse` does (report #268: Tides of the
   * Cosmos read `deckOf(…).slice(0, 8)` directly and revealed ONE card off a
   * one-card deck with eighteen recycled behind it).
   *
   * Safe before a suspend: the only mutation is that reshuffle, and it is
   * idempotent on re-entry (see `refillFromRecycled`'s `need`), so a part that
   * reveals, asks, and re-enters from scratch reads the same cards again.
   */
  revealTop(seat: Seat, n: number): CardName[] {
    if (n <= 0) return [];
    this.refillFromRecycled(seat, n);
    return this.deckOf(seat).slice(0, n);
  }
  /**
   * `revealTop`'s commit: REMOVE the top `n` cards of `seat`'s deck and return
   * them (the caller then puts each where its card says — the cache, play, the
   * recycle pile). Reaches past the mark the same way, so it takes what
   * `revealTop(seat, n)` showed.
   */
  takeTop(seat: Seat, n: number): CardName[] {
    if (n <= 0) return [];
    this.refillFromRecycled(seat, n);
    return this.deckOf(seat).splice(0, n);
  }
  /**
   * BL-46 — an agreed fix's "draw N": the top `n` cards of `seat`'s deck into
   * their hand (the recycle pile shuffled in if the deck runs out, as for any
   * draw), and NOTHING hears it — no 'draw' dispatch, no hand-entry dispatch
   * (owner, 2026-10-16: fixes are quiet). Returns the cards drawn.
   */
  quietDraw(seat: Seat, n: number): CardName[] {
    const drawn: CardName[] = [];
    for (let i = 0; i < n; i++) {
      const c = this.takeFromDeck(seat);
      if (c === undefined) break;
      drawn.push(c);
    }
    if (drawn.length) this.toHand(seat, drawn, 'deck', { quiet: true });
    return drawn;
  }
  draw(seat: Seat, n: number, silent = false): void {
    const drawn: CardName[] = [];
    for (let i = 0; i < n; i++) {
      const c = this.takeFromDeck(seat);
      if (c === undefined) break;
      drawn.push(c);
    }
    const got = drawn.length;
    // CR 402.4, 706.6a: a draw is a card entering a hand, and it is announced as one — a
    // multi-card draw is ONE 'handEntered' exactly as it is ONE 'draw'. The
    // 'draw' event is NOT replaced: it keeps its own narrow meaning ("when you
    // DRAW", which a bin recursion is not), and Ancient One's AO_EVENTS scan
    // still reads it.
    if (got) this.toHand(seat, drawn, 'deck');
    if (!silent && got > 0) {
      const ev = this.ev('draw', `${this.pname(seat)} draws ${got}.`, { seat, n: got });
      // dispatch to trigger listeners only during battle: every current
      // "card enters a hand" consumer is battle-scoped, and turn-start draws
      // firing triggers outside any settle() window would be unsound.
      if (this.s.battle) this.fireEvent('draw', ev);
    }
  }

  /**
   * CR 402.4: **the one place a card enters a hand.** Pushes `cards` onto `seat`'s
   * hand and announces it as `'handEntered'`.
   *
   * Three cards print *"whenever (one or more other) cards enter a player's
   * hand during battle"* — Rider of the Tides, Xenopod Progenitor, Galerider
   * Eel — and before this there was nothing to listen to. They listened on
   * `'despawned'` (a recall) and `'draw'`, the only two channels that
   * announced anything at all, while **18 bare `player(seat).hand.push(name)`
   * writes across 11 card files** moved a card into a hand in total silence:
   * a bin recursion (Blightwalker, Collect Remains, Cthyrian Rector,
   * Xzydris, Cinder Scuttler, Delver of Mysteries, Reclaimer of Secrets,
   * Combustible Bogwalker, Inexorable Miasma, Eldritch Reclaimer,
   * Rippleback Skulker, Verdant Necrophage, Tilling the Graves, Zephyrzoa),
   * a pull off the STACK (Dream Lapse, Cosmic Reversal), a recall out of the
   * CACHE (Prismatic Observer) and a card taken out of an opponent's HAND
   * (Bioremediation). Several are {Battle}-timed, so the silence was in the
   * exact window those three cards ask about.
   *
   * ⚠ **ONE EVENT FOR A MULTI-CARD MOVE**, which is the shape `'draw'` already
   * has (`{ seat, n }` for an n-card draw) and the shape the printed text asks
   * for: *"whenever ONE OR MORE other cards enter a player's hand"*. Zephyrzoa
   * recalls a whole bin and that is one entry, not fourteen.
   *
   * `from` is the zone the cards came FROM, the same vocabulary `toBin` uses
   * plus `'hand'` (Bioremediation takes a card out of an opponent's hand, so
   * one hand's loss is another's entry). A listener may well care: "a card
   * enters your hand from your BIN" is a different fact from a draw.
   * `opts.unit` is the entity that was in play when the move is a recall — it
   * is what lets Xenopod Progenitor read "one or more OTHER cards" and exclude
   * its own carrier, and it is safe to put in `data` because by the time
   * `recall` calls this the entity is already out of `s.entities`, so
   * `fireEvent`'s region derivation finds nothing and the event stays
   * region-less like `'draw'`.
   *
   * DISPATCH IS BATTLE-ONLY, for `draw`'s reason and in `draw`'s words: every
   * consumer is battle-scoped and firing triggers outside a `settle()` window
   * would be unsound. The EVENT is always recorded, so the stream is complete
   * either way; `msg` is `''` because every call site already announces itself
   * in its own words (the `'leftBin'` / `'cardPlayed'` precedent — the harness
   * keeps an empty message out of the log).
   *
   * BL-06 added `'sandbox'` to `from`: a test-mode summon comes from OUTSIDE
   * the game and none of the other zones is a true answer for it. Nothing reads
   * `from` as a rule — it is log and redaction data — so the widening is
   * additive, and naming it honestly matters because `'deck'` would have been a
   * lie in a saved log forever.
   *
   * ⚠ Keep this doc block ABOVE the signature and out of the parameter list:
   * `152-hand-entry`'s class guard proves the one surviving `hand.push` is
   * really inside this method by reading the EIGHT LINES above it for
   * `toHand(seat: Seat`. A comment between the two pushes it out of that
   * window, and the guard goes red on a file that is perfectly correct.
   */
  /**
   * CR 410.5b / CT-218 — a spell token RECALLED off the stack enters its
   * controller's hand and is erased from it at once. The RAQ ("Recall Spell
   * Token / Token unit"): "Token Spell technically enter your hand if you
   * Recall them and are instantly erased (this matter for the purpose of
   * triggers like Xenopod Progenitator or Rider of the Tides)." The same two
   * steps a recalled unit TOKEN already takes (CR 410.5b, `recall` above): through
   * `toHand` — the one door every hand-entry watcher listens at — then the
   * hand sweep. Not a trash and not a death (CR 801.2d: tokens are not trashed).
   * The caller has already taken the item off the stack (CR 801.7d).
   */
  /**
   * CR 304.11d — a spell token ON THE STACK changes hands (Download: "Gain control
   * of target token"). A `StackItem` is not an Entity, so this is not
   * `giveControl` (which unslots formations and fires `controlChanged` for a
   * unit in play): the item simply records a new caster, and every read of
   * "ally"/"you" at resolution follows it. Returns the old controller.
   */
  giveItemControl(item: StackItem, seat: Seat): Seat {
    const was = item.controller;
    item.controller = seat;
    return was;
  }

  recallSpellTokenItem(item: StackItem, who: string): void {
    if (!item.card) return;
    this.toHand(item.controller, item.card, 'stack', { token: true });
    this.eraseFromZone(item.controller, item.card, 'hand',
      `${who} recalls ${item.label} to ${this.pname(item.controller)}'s hand — a token, so it is erased.`);
  }

  toHand(seat: Seat, cards: CardName | readonly CardName[],
         from: 'deck' | 'bin' | 'play' | 'stack' | 'cache' | 'hand' | 'sandbox',
         opts: { unit?: EntityId; token?: boolean; quiet?: boolean } = {}): void {
    const names: CardName[] = typeof cards === 'string' ? [cards] : [...cards];
    if (!names.length) return;
    this.player(seat).hand.push(...names);
    const ev = this.ev('handEntered', '', {
      seat, from, cards: names, card: names[0], n: names.length,
      ...(opts.unit !== undefined ? { unit: opts.unit } : {}),
      ...(opts.token ? { token: true } : {}),
    });
    // BL-46: an agreed fix is QUIET (owner, 2026-10-16) — the event is still
    // recorded, so the stream stays complete, but nothing hears it
    if (this.s.battle && !opts.quiet) this.fireEvent('handEntered', ev);
  }

  /**
   * CR 408.2: recycle one card. It goes PAST THE MARK — into the recycle pile,
   * not onto the bottom of the live deck — and comes back only when the deck
   * runs out and `refillFromRecycled` shuffles the pile in.
   *
   * This is the one writer, and that is what made the rule a one-line change:
   * every way a card reaches the bottom of a deck already came through here.
   * The owner settled the scope on 2026-09-16 — everything that hits the
   * bottom goes past the mark — which is all four callers: recycling from
   * hand for a resource, the constructed draw phase's put-2-back, the cards
   * a Glimpse did not cache, and (through `startDraftStep`) a recycled pack.
   */
  recycleToBottom(seat: Seat, name: CardName): void {
    this.recycleOf(seat).push(name);
  }

  // ── the bin & trashing (CR 801.2) ────────────────────────────────────────
  /**
   * Everything that enters a bin goes through here. CR 801.2: **any CARD entering a
   * bin from anywhere other than the stack is trashed.** CR 801.2d: a TOKEN is not
   * — it is not a card (the token ruling's first half), and the owner withdrew the token ruling's
   * second half ("Tokens are trashed, yes") on 2026-09-28: *"It is just
   * false … A token dying should never count."* The token case is decided in
   * `noteTrashed`, the one choke point every trash reaches. It is
   * trashed BY THE OWNER OF THE BIN IT ENTERS — so `seat` is both the bin's
   * owner and the trasher, whatever the card's own owner is (Pull Under moves
   * a dead enemy unit into the caster's bin: the caster trashes it).
   *
   * `from` is the zone the card came from. 'stack' never trashes (a spell or
   * ability going to the bin after it resolves, or after being negated, comes
   * from the stack — so countering is not trashing); everything else does,
   * 'cache' (CR 801.2) included — a cached card binned without being played is
   * trashed like any other. A TOKEN never arrives here by name: every token
   * that reaches a bin does so by leaving play, through `disposeToBin`, which
   * hands `noteTrashed` the entity (CR 801.2d).
   *
   * In the engine, so is an {Unstable} card (CR 801.2h: it is not trashed; CT-246). It was the last object whose
   * DISPOSITION was allowed to decide whether trashing happened — the erase
   * that follows it out of the bin used to be modelled as "it never went to a
   * bin at all". It goes; it is trashed there; then it is erased. Nothing in
   * this method changed, and that is the point: "the destination, not the
   * object" was always the rule, and Unstable was the last exception to it.
   *
   * BL-06 added `'sandbox'`, and it is the SECOND non-trashing entry. A
   * test-mode summon PLACES a card in a bin; nothing trashed it, and it came
   * from outside the game rather than from any zone above. Firing "when I am
   * trashed" for a card that was never anywhere would be the sandbox inventing
   * an event — and the real one is one click away: summon it to a hand and
   * discard it under the ordinary rules. That distinction is the whole of
   * BL-06's ⚠ line ("the cheat is in setting the board up, not in how it then
   * behaves") pointed at this method.
   */
  // BL-46: 'amend' is the third non-trashing entry — an agreed fix PLACES a
  // card where it should have been, and is quiet (owner, 2026-10-16)
  toBin(seat: Seat, name: CardName, from: 'hand' | 'deck' | 'play' | 'stack' | 'cache' | 'sandbox' | 'amend'): void {
    this.player(seat).bin.push(name);
    if (from === 'stack' || from === 'sandbox' || from === 'amend') return;
    this.noteTrashed(seat, name, from);
  }

  /**
   * Fire the trash event for a card that has ALREADY been put in `seat`'s bin.
   * Split out of toBin() for the paths that must control event ORDER: destroy()
   * and recall() bin the card first but have to emit (and fire) their own
   * 'died'/'despawned' event before the trash, or the game log reads backwards.
   *
   * **CR 801.2d (owner, 2026-09-28) — A TOKEN IS NOT TRASHED.** A dying token
   * does still reach here (it really enters the bin before CR 410.5a's sweep erases
   * it, which is a ZONE fact and stands), and this method returns before doing
   * anything for it: no `trashed` event, no `trashed` / `trashed:<seat>`
   * battle-counter bump, and no "when I am trashed" — its OWN included (a
   * token copy of Dropslime). Its `died` event is untouched: a token is still
   * a unit, and "whenever a unit dies" still sees it.
   *
   * This reverses the token ruling's second half. The token ruling (2026-08-24) recorded *"Tokens are
   * trashed, yes"* and rebuilt the argument on the destination alone ("trashing
   * is defined by WHERE something goes, not by what it is"). The owner:
   * *"that ruling was my fault. It is just false."* — *"Tokens are
   * specifically not considered cards in terms of specific semantics of the
   * game. A card is an actual physical card that has an algomancy card back
   * only … A token dying should never count."* So the definition is now
   * CR 801.2's destination rule applied to CARDS: something that is a card, entering
   * a bin, not from the stack.
   *
   * The check is `anchor?.token` and it is the only one needed. Every route
   * here was walked when tokens stopped being trashed: `toBin` (discard, mill, a sandbox or stack
   * push — names only, and no token is ever in a hand, deck or cache long
   * enough to be discarded or milled: CR 713.5's sweep takes it straight back out),
   * the body in `disposeToBin` (death and Hooba-Mon's exchange — anchored on
   * the dying entity, so `token` is read off it), and the two MOD loops
   * (`afterDespawn`, `disposeToBin`), which already skip a token mod before
   * calling: a token mod has no card to bin (CR 410.4c).
   *
   * The engine's Unstable-death trash (owner, 2026-08-24; CR 801.2h says otherwise, CT-246) is UNCHANGED for a CARD: an {Unstable} card that
   * dies reaches here from destroy(), because it enters a bin and does not
   * come from the stack, and the erase that takes it back out a statement
   * later is a state-based sweep, not a reason the trash never happened. ⚠ So
   * do NOT read "a card that ends up erased was never trashed" out of anything
   * here: the six "when I am trashed" cards (Afflicting Anima, Blightwalker,
   * Dropslime, Maw of Despair, Nothyr, Thoughtripper) and the eight watchers of
   * someone else's trash (Cerebrox, Cthyrian Culler, Cthyrian Rector, Muck
   * Rummager, Murkdrop Distiller, Murkstalker, Splort, Unrelenting Horror) all
   * fire on an Unstable CARD's death, and two of them (Rector, Distiller)
   * reach back into the bin and correctly find nothing. What they no longer
   * see is a token's.
   *
   * CR 714.9: `anchor` is the DETACHED entity the card was, when the trash came from
   * one leaving play. It supplies the region (the one it died in, not the
   * trasher's action region — CR 714.9) and stands in for the ghost below.
   *
   * `opts.binSeat` SPLITS the two questions this method used to answer
   * with one number. `seat` is WHO TRASHED — the seat every "when YOU trash"
   * reads (`ev.data.seat`) and the seat `trashed:${seat}` counts. `binSeat` is
   * WHOSE BIN the card actually landed in. The mod-trash ruling once made them differ for one
   * object: a mod Rashi cast onto Ben's unit was trashed by BEN and went to
   * RASHI's bin.
   *
   * ⚠ **THE ZONES-FOLLOW-CONTROL RULING (now CR 410.4a, 801.2e) CLOSED THAT GAP AGAIN, DELIBERATELY.** *"Zones always follow
   * control. One rule, no split."* A mod's controller is its host's, so the
   * destination is now the same seat as the attribution, and **no caller in
   * the engine can make these two arguments differ**: the four call sites are
   * `toBin` and the body of `disposeToBin` (which pass no `binSeat` at all)
   * and the two mod loops (`afterDespawn`, `disposeToBin`), where both
   * arguments read the same controller and `binTo` overrides them together.
   * That is asserted over the whole moddable pool, on both routes, by
   * `229-cosmic-and-control.test.ts`.
   *
   * **The parameter is kept on purpose, as a guarded impossibility**, and this
   * is a decision rather than an oversight. Deleting it would delete the mod-trash ruling's
   * argument along with it, and that argument is about bin identity (CR 405.6) rather than about
   * mods: when a trash is attributed to a seat whose bin does NOT hold the
   * card, counting the nth over that seat's bin is strictly worse than
   * useless, because an unrelated older copy of the same name resting there
   * would answer — which is exactly how Cthyrian Rector ("recall that card
   * from your bin") recalls an innocent card in place of the one the event
   * named. The `-1` below is the honest answer that case needs, and it is one
   * argument away rather than one rediscovery away.
   *
   * ⚠ Note the `-1` is NOT only reachable through this parameter: a discard
   * that never reached a bin gets it from the filter below, because the card
   * is simply not there. Only the coincidental-older-copy case needs the flag.
   */
  noteTrashed(seat: Seat, name: CardName, from: 'hand' | 'deck' | 'play' | 'cache', anchor?: Entity,
    opts: { binSeat?: Seat } = {}): void {
    // CR 801.2d: a token is not a card, so it is never trashed — see above.
    if (anchor?.token) return;
    const where = from === 'play' ? 'from play' : from === 'hand' ? 'from hand'
      : from === 'cache' ? 'from the cache' : 'from the deck';
    const region = anchor?.region ?? this.actionRegion(seat);
    // per-battle trash ledger (CR 505.6: Dropslime counts every card trashed this
    // battle, Muck Rummager only your own) — battleCounters reset each battle
    // phase, so a trash outside battle deliberately counts for nothing
    if (this.s.phase === 'battle') {
      this.bumpBattleCounter(region, 'trashed');
      this.bumpBattleCounter(region, `trashed:${seat}`);
    }
    // CR 405.6: WHICH copy of `name` in this bin is the one that was just trashed.
    // A bin holds bare card names, so BinRef fixes identity there
    // as (name, nth occurrence) — "copies of one card there are genuinely
    // indistinguishable". Every caller pushes the card into the bin BEFORE
    // calling here (toBin, destroy, leavePlay+afterDespawn, Hooba-Mon), so the
    // LAST occurrence is this instance. -1 when the card is not in the bin at
    // all — a discard that never reached one. The second -1 case (a mod
    // trashed into a bin that was not the trasher's) is GONE under CR 410.4a,
    // because zones follow control and the two seats no longer differ; the
    // branch is kept as a guard. See the ⚠ on `binSeat`.
    const binNth = (opts.binSeat ?? seat) !== seat
      ? -1
      : this.player(seat).bin.filter(c => c === name).length - 1;
    const ev = this.ev('trashed', `${this.pname(seat)} trashes ${name} (${where}).`,
      { seat, card: name, from, region, ...(binNth >= 0 ? { binNth } : {}) });
    this.fireEvent('trashed', ev);
    this.fireOwnTrashTrigger(seat, name, region, ev, anchor);
  }

  /**
   * CR 801.2: the trashed card's OWN "when I am trashed" trigger — Dropslime,
   * Nothyr, Sacrifice Dude, Murkstalker and the rest of the trash family.
   *
   * fireEvent() scans entities IN PLAY, and a card being trashed is by
   * definition not in play any more: it is sitting in a bin. So its own
   * trigger cannot be found that way and has to be collected from the card.
   *
   * The ability is anchored on a DETACHED stand-in entity that is never put
   * into s.entities — it cannot be targeted, radiates no statics and turns up
   * in no other scan. It exists only to give `when` and the bounded-budget
   * bookkeeping (CR 109.9n) something to read, and it is thrown away with this call,
   * which is right: each trashed card is its own instance. Its id is not in
   * s.entities, so `g.entity(ctx.sourceId)` correctly answers "there is no
   * such unit".
   *
   * CR 714.9: when the card is being trashed BECAUSE it left play, `anchor` is the
   * entity it was — already detached by destroy()/recall(), with exactly the
   * properties a stand-in needs and the real region, counters and owner as
   * well. The fabricated id -1 ghost is the fallback for a trash with no unit
   * behind it (a discard, a mill, a cached card binned). One mechanism, two
   * sources.
   *
   * Only `self: true` abilities fire here. "When ANOTHER card is trashed"
   * (Muck Rummager) belongs to a unit in play and the normal scan dispatches
   * it — which also gives the "excludes the trigger source itself" for free.
   */
  private fireOwnTrashTrigger(seat: Seat, name: CardName, region: number, ev: EngineEvent, anchor?: Entity): void {
    const abilities = this.card(name).abilities ?? [];
    if (!abilities.length) return;
    // `controller` is the TRASHER (CR 801.2e: the owner of the bin it entered), which
    // is what the queued trigger resolves under, so the stand-in reports the
    // same seat whether it was fabricated or lifted off the dead unit. The
    // copy also keeps composeParts' bounded-budget write off the real entity.
    const ghost: Entity = anchor
      ? { ...anchor, kind: 'unit', controller: seat, region, mods: [], budgets: {} }
      : this.standIn(name, seat, region);
    let queued = false;
    abilities.forEach((ability, idx) => {
      if (!isTriggered(ability) || !ability.self) return;
      if (!ability.events.includes('trashed')) return;
      queued = this.queueTrigger(ghost, name, idx, ability, 'ability', ev,
        `Trigger: ${name} — ${ability.label} (trashed).`, { card: name }) || queued;
    });
    if (queued) this.s.triggerOrderedSeats = [];
  }

  /**
   * CR 108.4, 701.5 — a nonunit spell's OWN "When you play me, …" (Meteor
   * Shower: "When you play me, copy me twice.").
   *
   * The sibling of fireOwnTrashTrigger, for the same reason: fireEvent()
   * scans entities in play, and a spell being played is not one — it is a
   * stack item. So its own play trigger has to be collected from the card, and
   * is anchored on a DETACHED stand-in (id -1) whose controller is the player
   * who played it and whose region is the spell's.
   *
   * RAQ "[Solved] Meteor Shower. How it works." (_passer): *"When you play
   * Meteor Shower first thing on the stack is Triggered Ability 'When you play
   * me, copy me twice'. This part is not an Spell Effect … but as Triggered
   * Ability it's affected by Crevice Lurker or Containment Protocol."* So it
   * QUEUES like any trigger: processTriggerQueue stacks it ABOVE the spell
   * (this runs before pushItem, and the queue drains after), its CR 111.10g tax
   * gate applies, and it can be negated as an ability.
   *
   * Only a PLAY reaches here — this is called from commitItem — so a copy,
   * which is pushed by pushSpellCopy and never played (CR 701.5), cannot set
   * its own trigger off again. That is what keeps "copy me twice" at two.
   * Only `self: true` 'spellPlayed' abilities of a NONUNIT spell card fire —
   * a text that names its OWN play ("me"). CR 701.1e is the other shape and is
   * untouched: an ability that triggers when its controller plays "a unit" /
   * "a card" still never hears the play of the card it is printed on.
   */
  private fireOwnPlayTrigger(item: StackItem, ev: EngineEvent): void {
    if (item.copy || item.card === undefined || item.kind !== 'spell') return;
    const name = item.card;
    const abilities = this.card(name).abilities ?? [];
    if (!abilities.length) return;
    const ghost = this.standIn(name, item.controller, item.region);
    let queued = false;
    abilities.forEach((ability, idx) => {
      if (!isTriggered(ability) || !ability.self || ability.zone) return;
      if (!ability.events.includes('spellPlayed')) return;
      queued = this.queueTrigger(ghost, name, idx, ability, 'ability', ev,
        `Trigger: ${name} — ${ability.label} (played).`, { card: name }) || queued;
    });
    if (queued) this.s.triggerOrderedSeats = [];
  }

  /** Discard a card from `seat`'s hand — it is trashed (CR 801.3). Returns the
   * card, or undefined when the index is out of range. */
  discardFromHand(seat: Seat, handIndex: number): CardName | undefined {
    const hand = this.player(seat).hand;
    if (handIndex < 0 || handIndex >= hand.length) return undefined;
    const [name] = hand.splice(handIndex, 1);
    this.ev('info', `${this.pname(seat)} discards ${name}.`);
    this.toBin(seat, name!, 'hand');
    return name;
  }

  /** Mill `n` cards off the top of `seat`'s deck into their bin — each one is
   * trashed (CR 801.2a). Returns what actually moved (an empty deck mills fewer). */
  mill(seat: Seat, n: number): CardName[] {
    const out: CardName[] = [];
    for (let i = 0; i < n; i++) {
      const name = this.takeFromDeck(seat);   // CR 408.2b: reshuffles at the mark
      if (name === undefined) break;
      out.push(name);
      this.ev('info', `${this.pname(seat)} mills ${name}.`);
      this.toBin(seat, name, 'deck');
    }
    return out;
  }

  // ── player counters: rot & debt (CR 112.15) ─────────────────────────
  /** `seat`'s rot counters (CR 112.13). Optional field, always read through here. */
  rot(seat: Seat): number { return this.player(seat).rot ?? 0; }
  /** `seat`'s debt counters (CR 112.14). Optional field, always read through here. */
  debt(seat: Seat): number { return this.player(seat).debt ?? 0; }

  /** CR 112.13e: "gain a rot" / "each opponent gains a rot". Gaining rot is not
   * damage and has no consequence of its own beyond the event. */
  gainRot(seat: Seat, n = 1): void {
    if (n <= 0) return;
    // CR 112.13, 112.15: rot is a COUNTER a player accumulates (docs/08), which is what
    // makes Proliferating Slime's "an enemy unit OR PLAYER" mean anything at
    // all — no other counter can be put on a player, so the clause would
    // otherwise be dead text. An AmountMod, summed, exactly as for a unit's.
    n += this.amountDelta({
      kind: 'rot', ...(this.s.battle ? { region: this.s.battle.region } : {}),
      amount: n, player: seat, combat: false,
    });
    if (n <= 0) return;
    const p = this.player(seat);
    p.rot = this.rot(seat) + n;
    const ev = this.ev('rotGained', `${p.name} gains ${n} rot (${p.rot} total).`,
      { seat, n, total: p.rot });
    this.fireEvent('rotGained', ev);
  }

  /** CR 112.14: "gain 2 debt". Paid off automatically at the end of the resource
   * step; gaining it costs nothing right now. */
  gainDebt(seat: Seat, n = 1): void {
    if (n <= 0) return;
    // CR 112.14, 112.15: debt is the second player counter (docs/08), read by Proliferating
    // Slime's "enemy unit or player" the same way rot is.
    n += this.amountDelta({
      kind: 'debt', ...(this.s.battle ? { region: this.s.battle.region } : {}),
      amount: n, player: seat, combat: false,
    });
    if (n <= 0) return;
    const p = this.player(seat);
    p.debt = this.debt(seat) + n;
    const ev = this.ev('debtGained', `${p.name} gains ${n} debt (${p.debt} total).`,
      { seat, n, total: p.debt });
    this.fireEvent('debtGained', ev);
  }

  /**
   * CR 112.15: **removing** rot / debt from a player. `gainRot(-n)` is a no-op by
   * design (CR 112.13a: rot "never decreases on its own"), so Burn the Blight —
   * *"Remove all counters from units and players"* — used to zero `p.rot` and
   * `p.debt` by hand. Those were the only writes to either field outside
   * `gainRot`/`gainDebt`, and being raw writes they announced nothing: a card
   * watching a player's counters could see them arrive and never see them go.
   *
   * ⚠ **A REMOVAL IS NOT SCALED BY THE AMOUNT LAYER (CR 112.15), and that is an owner
   * ruling and not a policy call** (2026-08-25, asked directly whether an
   * `AmountMod` should scale a removal): *"Resonater says 'put on' so this
   * question is irrelevant. Removing counters isn't 'putting on'."* So there is
   * deliberately no `amountDelta` call here, where `gainRot`/`gainDebt` both
   * have one.
   *
   * The generalisable form, which is the half worth keeping: **the scope of a
   * layer is read off the PRINTED TEXT OF THE CARD THAT DEFINES IT.** Flux
   * Resonator and Proliferating Slime both print "put on"/"put … counters", so
   * "remove all counters" is simply not the kind of quantity they have an
   * opinion about. Nothing had to be decided about removals in general.
   *
   * Clamped at zero — you cannot remove counters that are not there — and
   * returns how many actually went, so a caller can say "if you do".
   */
  loseRot(seat: Seat, n: number): number {
    const have = this.rot(seat);
    const lost = Math.min(Math.max(0, Math.trunc(n)), have);
    if (lost <= 0) return 0;
    const p = this.player(seat);
    p.rot = have - lost;
    const ev = this.ev('rotLost', `${p.name} loses ${lost} rot (${p.rot} left).`,
      { seat, n: lost, total: p.rot });
    this.fireEvent('rotLost', ev);
    return lost;
  }

  /** CR 112.15: debt's half of `loseRot` — same ruling, same shape. */
  loseDebt(seat: Seat, n: number): number {
    const have = this.debt(seat);
    const lost = Math.min(Math.max(0, Math.trunc(n)), have);
    if (lost <= 0) return 0;
    const p = this.player(seat);
    p.debt = have - lost;
    const ev = this.ev('debtLost', `${p.name} loses ${lost} debt (${p.debt} left).`,
      { seat, n: lost, total: p.debt });
    this.fireEvent('debtLost', ev);
    return lost;
  }

  /**
   * CR 502.4, 112.14b: pay 1 mana per debt, each mana removing one debt. Mandatory and
   * automatic — not a player action and not declinable. Partial payment is
   * fine; the remainder carries to the next turn and there is NO other
   * penalty for being unable to pay. Called as the LAST thing in the resource
   * step (doDonePlanning), by which point planningDone[seat] already gates
   * every resource action, so no more mana can be activated afterwards: the
   * mana spent here is expended and unavailable for casting this turn, which
   * IS the cost ("you lose X mana on your following turn", Caleb 2024-09-10).
   */
  payDebt(seat: Seat): void {
    const owed = this.debt(seat);
    if (owed <= 0) return;
    const paid = Math.min(owed, this.openMana(seat));
    if (paid > 0) this.payMana(seat, paid);
    this.player(seat).debt = owed - paid;
    const left = owed - paid;
    this.ev('debtPaid',
      `${this.pname(seat)} pays ${paid} of ${owed} debt` +
      (left > 0 ? ` — ${left} carries over to next turn.` : '.'),
      { seat, paid, owed, remaining: left });
  }

  /**
   * CR 112.13: at the start of deployment each player takes damage equal to their
   * own rot, in initiative order (determinism). The source is the damaged
   * player themselves — "Your rot is a source you control" (Caleb 2024-08-20)
   * — so the damage event carries controller = the victim. Rot never decays.
   *
   * There is no priority during deployment, so this cannot be responded to:
   * the settle() below resolves anything it triggers immediately, exactly the
   * way regroup/end-of-turn triggers are handled.
   */
  rotDamage(): void {
    const run = (): void => {
      for (const seat of [this.initiative, this.nit]) {
        const n = this.rot(seat);
        if (n <= 0) continue;
        if (this.replaceRotDamage(seat, n)) continue;
        // mirrors dealEffectDamage's player branch (a 'damage' event so triggers
        // hear face hits, then the life loss) without needing an EffectCtx
        const ev = this.ev('damage', `${this.pname(seat)}'s ${n} rot deals ${n} damage to them.`,
          { player: seat, n, source: 'rot', controller: seat, region: this.homeRegion(seat) });
        this.fireEvent('damage', ev);
        this.loseLife(seat, n, 'rot');
      }
    };
    // CR 708.4a: two rot replacements of one seat's may each be the one that
    // applies, so the step is a seam the player can be asked from. Only where
    // that can happen — every other rot step runs exactly as it always did.
    const mayAsk = [this.initiative, this.nit].some(seat =>
      this.rot(seat) > 0 && this.rotDonors(seat).length >= 2);
    if (mayAsk) this.orderSeamRun('rot', 'rot', run);
    else run();
    this.settle();
  }

  /** CR 112.13d: the rot replacements `seat` holds, one entry per face, in
   * timestamp (entity id) order */
  private rotDonors(seat: Seat): { face: CardName; def: CardBehavior; anchor: Entity }[] {
    const holders = this.anchored((h, a) =>
      this.donates(h, a, 'replaceRotDamage')                    // CR 710.7: off the FACES
      && a.controller === seat
      && !this.textStripped(h, a));                         // CR 712.1a (full projection)
    holders.sort((a, z) => a.holder.id - z.holder.id);
    return this.donorFaces(holders, 'replaceRotDamage');
  }

  /**
   * The one replacement effect in the engine (CR 112.13d). Skittering Blight reads
   * "If rot would deal damage to you, instead put that many +1/+1 counters on
   * me", so rot damage cannot be applied inline — it has to be offered to the
   * cards in play first. Deliberately NARROW rather than a general replacement
   * framework (docs/04 has no replacement layer): a card declares
   * `replaceRotDamage` in its behavior, the hook is asked only for cards the
   * damaged player controls, and the first one to return true consumes the
   * whole event. That is the CR 708.4 chain, not an exception to it: what a
   * holder puts in the damage's place (counters on Skittering Blight, Beyond's
   * -1/-1 counters) is no longer rot damage, so no other holder's "if rot
   * would deal damage to you" matches it any more. ORDER is entity id, and it
   * DOES change the outcome — two Skittering Blights (which one grows), or a
   * Blight beside Beyond, Codex Incarnate (counters on the Blight, or -1/-1 on
   * a target). Caleb: "you the player control how they stack"; every holder is
   * the damaged player's own, so THAT PLAYER CHOOSES which one applies (CR
   * 708.4a) — asked from the rot step's seam (`orderSeamRun`) whenever two
   * holders differ in face or in the unit they act from. Two copies of one
   * card's text on ONE unit are interchangeable, and nothing is asked.
   *
   * Skittering Blight prints the text under [Augment], so — exactly like
   * staticsFor() — the hook radiates from units in play AND from augment mods,
   * and a mod's hook is ANCHORED ON ITS HOST: the donated text reads from the
   * host's perspective, so "counters on me" lands on the host.
   */
  private replaceRotDamage(seat: Seat, n: number): boolean {
    const donors = this.rotDonors(seat);
    // CR 708.4a: the player orders them. Each one consumes the whole event, so
    // the only question is which goes first.
    let distinct = donors.filter((d, i) =>
      donors.findIndex(o => o.face === d.face && o.anchor.id === d.anchor.id) === i);
    // only the ones that WOULD replace it are choices — asked of a copy of the
    // world, because a hook does what it does (counters, a queued trigger)
    if (distinct.length >= 2) {
      distinct = distinct.filter(d => {
        const g = new E(structuredClone(this.s));
        return d.def.replaceRotDamage!(g, g.entity(d.anchor.id) ?? d.anchor, seat, n);
      });
    }
    let order = donors;
    if (distinct.length >= 2) {
      const got = this.askReplacement(seat,
        `Your ${n} rot would deal ${n} damage to you — which card replaces it?`,
        distinct.map(d => ({ label: this.replacerLabel(d.face, d.anchor), card: d.face,
          unit: d.anchor.id, pick: donors.indexOf(d) })));
      if (got !== null) order = [donors[got]!, ...donors.filter((_, i) => i !== got)];
    }
    for (const { face, def, anchor } of order) {
      if (def.replaceRotDamage!(this, anchor, seat, n)) {
        // CR 112.13d — the replacement's log line is now a DISPATCHED event.
        //
        // It used to be a plain `ev('info', …)`. Same words, same log line —
        // only the type changed, and with it the fact that cards can hear it.
        //
        // Skittering Blight needs none: "instead put that many +1/+1 counters
        // on me" is arithmetic the hook can finish on the spot. Beyond, Codex
        // Incarnate reads "put that many -1/-1 counters on TARGET unit
        // instead", and the owner ruled (2026-08-22) that it "would trigger,
        // ask you what you want to target, then put the -1/-1 counters on
        // during deployment (which still has and uses a stack)". A hook whose
        // signature is `(g, self, seat, amount) => boolean` cannot ask
        // anything — no EffectCtx, no ctx.choose — so the replacement fires
        // THIS, a card declares an ordinary `self: true` triggered ability
        // against it, and the whole CR 110.1a machinery (queue → collectTargets →
        // commitItem) does the asking. No new Suspension variant, no new
        // decision seam: the existing trigger path already runs during
        // deployment (processTriggerQueue's `then = 'resolve'`).
        //
        // Fired AFTER the hook returned true, so the replacement is already a
        // fact by the time anything hears about it: the damage is gone whether
        // or not the queued effect later finds a target (CR 704.6, and the prevention ruling's
        // "a REPLACED hit still counts as dealt", CR 112.12).
        //
        // `unit: anchor.id` and not `holder.id`: [Augment]-donated text reads
        // from its HOST, which is what `anchored()` means by the anchor, and a
        // `self: true` listener matches on the entity the ability is running
        // for. `region` rides too so the region-scoped dispatch (CR 101.6) finds it.
        const ev = this.ev('rotReplaced',
          `${face} replaces the ${n} damage ${this.pname(seat)}'s rot would deal.`,
          { seat, n, card: face, unit: anchor.id, region: anchor.region });
        this.fireEvent('rotReplaced', ev);
        return true;
      }
    }
    return false;
  }

  // ── the cache, prophecy & glimpse (CR 403, 801.9, 803.7) ─────────────────────────
  //
  // The cache is a fourth zone beside hand, bin and deck — Caleb: "basically
  // exile with the intent to be referenced later", "a neutral zone like the
  // hand and bin". It is PUBLIC (CR D6.6): both players see every cached card and
  // the prophecy on it, so nothing here is ever redacted server-side.
  //
  // Being in the cache is NOT permission to play the card (Caleb 2024-12-03:
  // "You can only play cached cards that allow you to play them"). Permission
  // is either a fulfilled prophecy (free, ignoring affinity — CR 803.7h) or a
  // glimpse-style until-end-of-turn stamp (pay the mana, ignore affinity —
  // CR 403.3c). A card with neither stays cached, inert, forever.

  /** CR 403.1: `seat`'s cache. Optional field (additive, like rot/debt) — always
   * read through here so a pre-expansion state reads as an empty zone. */
  cache(seat: Seat): CachedCard[] { return this.player(seat).cache ?? []; }

  /** the writable cache array, materialising it on first use */
  private cacheMut(seat: Seat): CachedCard[] {
    const p = this.player(seat);
    return (p.cache ??= []);
  }

  /** CR 803.7e: stamp a prophecy with its forward-counting anchors. `raw` is the
   * condition exactly as printed or granted; normalizeProphecy splits off a
   * trailing [Haste] marker and produces the matchable form.
   *
   * CR 203.5b: the marker is NOT carried onto the cached entry. It is a permission
   * to prophesy in the haste step (E.mayProphesy), and by the time there is a
   * CachedProphecy to put it on that question has already been answered — a
   * copy here could only ever be read by something asking the wrong question,
   * which is exactly what `cachedTiming` used to do with it. */
  makeProphecy(raw: string, seat: Seat): CachedProphecy {
    const { condition, norm } = normalizeProphecy(raw);
    return {
      condition, norm,
      turn: this.s.turn,
      battles: this.s.battlesCompleted ?? 0,
      // CR 803.7m: THIS seat's witnessed count, because the tally is per-seat —
      // stamping a global one here would start the meter at somebody else's
      // number and the card would count deaths its controller never saw.
      deaths: this.s.deathsSeen?.[seat] ?? 0,
    };
  }

  /**
   * CR 803.7b: may `seat` PROPHESY `c` right now?
   *
   * The ruling: "prophesying is legal ONLY during the deployment phase" (Caleb
   * 2025-05-09). A banner whose condition prints a trailing [Haste] marker is
   * the printed exception — Divine Intervention "can be prophesied during the
   * haste step, that's why it has that symbol" (Bena 2026-08-30) — so the
   * marker WIDENS this window and does nothing else. Derived from the printed
   * condition through the same `normalizeProphecy` that strips it, so there is
   * no card list to keep in step.
   *
   * The one predicate both `doProphesy` and `legalActions` route through.
   */
  mayProphesy(seat: Seat, c: CardDef): boolean {
    if (!c.prophecy) return false;
    if (this.deploying(seat)) return true;
    if (normalizeProphecy(c.prophecy.condition).prophesyAt !== 'haste') return false;
    return this.s.phase === 'planning' && this.s.hasteDone !== null && !this.s.hasteDone[seat];
  }

  /** unrecognised conditions warned about already during THIS apply() call —
   * the fulfilment sweep runs on every settle(), and one line per unknown
   * condition per action is loud enough without being a flood */
  private warnedProphecies = new Set<string>();

  /**
   * Is `p` fulfilled for `seat` right now? CR 803.7g: fulfilment LATCHES, so a
   * prophecy already marked fulfilled answers true forever, whatever the
   * state does afterwards.
   *
   * An unrecognised condition fails SAFELY and LOUDLY: it never throws, never
   * counts as fulfilled (so nothing becomes free by accident), and says so in
   * the game log — which is where a mis-transcribed or newly-printed condition
   * has to become visible.
   */
  /** How far along a COUNTING prophecy is — "2 of 4 turns" — or null for a
   * condition that is a state rather than a count (nothing to meter), an
   * unrecognised one, or one already fulfilled (CR 803.7g latches; the meter would
   * lie if the count could run backwards, which it cannot, but a fulfilled
   * card wears its ✓ and needs no meter). UI-only: nothing in the rules
   * reads this. */
  prophecyProgress(seat: Seat, p: CachedProphecy): ProphecyProgress | null {
    if (p.fulfilled) return null;
    for (const rule of PROPHECY_RULES) {
      const m = rule.re.exec(p.norm);
      if (m) return rule.progress ? rule.progress(this, seat, p, m) : null;
    }
    return null;
  }

  prophecyMet(seat: Seat, p: CachedProphecy): boolean {
    if (p.fulfilled) return true;
    for (const rule of PROPHECY_RULES) {
      const m = rule.re.exec(p.norm);
      if (m) return rule.met(this, seat, p, m);
    }
    if (!this.warnedProphecies.has(p.norm)) {
      this.warnedProphecies.add(p.norm);
      this.ev('info',
        `⚠ Unrecognised prophecy condition "${p.condition}" — it can never be fulfilled. ` +
        'Add a row to PROPHECY_RULES (engine.ts).',
        { condition: p.condition, norm: p.norm });
    }
    return false;
  }

  /**
   * CR 803.7g: latch every prophecy whose condition is now met. Called at the points
   * where fulfilment can change — settle() (life totals, units in play), the
   * turn flip, the end of each battle round, and the end of the haste step.
   *
   * Deliberately does NOT fire triggers: some of those call sites (startTurn,
   * endBattleRound) are outside any settle() window, and a queued trigger with
   * nothing to drain it would be unsound. No card in the pool triggers on a
   * prophecy being fulfilled; if one ever does, this is where the dispatch
   * goes — and the sweep call sites have to move inside settle() first.
   */
  refreshProphecies(): void {
    for (const p of this.s.players) {
      for (const cc of this.cache(p.seat)) {
        const pr = cc.prophecy;
        if (!pr || pr.fulfilled) continue;
        if (!this.prophecyMet(p.seat, pr)) continue;
        pr.fulfilled = true;
        this.ev('prophecyFulfilled',
          `${p.name}'s prophecy on ${cc.card} is fulfilled (${pr.condition}) — it may now be played from cache for free.`,
          { seat: p.seat, card: cc.card, condition: pr.condition });
      }
    }
  }

  /**
   * Put a card into `seat`'s cache. `from` is the zone it came from — used for
   * the log only; the caller is responsible for having removed it from there.
   *
   * opts.prophecy attaches a prophecy (a printed banner's condition, or one
   * granted by rules text). opts.playable grants the glimpse-style
   * permission (CR 801.9e, 801.9i): playable until the end of THIS turn, then inert.
   */
  cacheCard(seat: Seat, name: CardName, from: 'hand' | 'bin' | 'deck' | 'play' | 'effect',
    opts: { prophecy?: string; playable?: boolean; quiet?: boolean } = {}): CachedCard {
    // a stable handle for targeting the entry (Prismatic Observer): cache
    // INDICES shift as cards leave the zone, so a TargetRef cannot use one
    const cc: CachedCard = { card: name, uid: this.s.nextId++ };
    if (opts.prophecy !== undefined) cc.prophecy = this.makeProphecy(opts.prophecy, seat);
    if (opts.playable) cc.playableUntilTurn = this.s.turn;
    this.cacheMut(seat).push(cc);
    const extra = cc.prophecy ? ` with Prophecy — ${cc.prophecy.condition}`
      : cc.playableUntilTurn !== undefined ? ' — playable until end of turn' : '';
    const ev = this.ev('cached', `${this.pname(seat)} caches ${name}${extra}.`,
      { seat, card: name, from, ...(cc.prophecy ? { condition: cc.prophecy.condition } : {}) });
    if (!opts.quiet) this.fireEvent('cached', ev);   // BL-46: an agreed fix is quiet
    return cc;
  }

  /** cache a card out of `seat`'s hand (Living Vault, Prophecy Bug, Divine
   * Foresight's "they cache that card"). Returns the entry, or undefined when
   * the index is out of range. */
  cacheFromHand(seat: Seat, handIndex: number, opts: { prophecy?: string; playable?: boolean } = {}): CachedCard | undefined {
    const hand = this.player(seat).hand;
    if (handIndex < 0 || handIndex >= hand.length) return undefined;
    const [name] = hand.splice(handIndex, 1);
    return this.cacheCard(seat, name!, 'hand', opts);
  }

  /**
   * CR 405.7: THE bin-removal choke point. Every removal of a card from a
   * player's bin — recall, revive-to-play, erase, cache, prophesy,
   * play-from-bin, exchange, recycle — goes through here, and nowhere else
   * splices a bin. That single-path rule is what makes "When I leave your
   * bin, ..." (Rotling) implementable at all: the 'leftBin' event fires here,
   * once per card, with `{ seat, card, reason }`, and the zone dispatch
   * delivers it to the card that just left. `msg` is '' — signal-only, the
   * stackFlash precedent — because every caller already announces the removal
   * in its own words, and the log should not say everything twice.
   *
   * Returns the removed name, or undefined when the index is out of range
   * (callers keep their own "it already left" messages).
   */
  removeFromBin(seat: Seat, binIndex: number, reason: string, opts: { quiet?: boolean } = {}): CardName | undefined {
    const bin = this.player(seat).bin;
    if (binIndex < 0 || binIndex >= bin.length) return undefined;
    const [name] = bin.splice(binIndex, 1);
    const ev = this.ev('leftBin', '', { seat, card: name!, reason });
    if (!opts.quiet) this.fireEvent('leftBin', ev);   // BL-46: an agreed fix is quiet
    return name;
  }

  /** cache a card out of `seat`'s bin (Delver of the Ephemeral, Murkdrop
   * Distiller). The card LEAVES the bin — it is not copied. */
  cacheFromBin(seat: Seat, binIndex: number, opts: { prophecy?: string; playable?: boolean } = {}): CachedCard | undefined {
    const name = this.removeFromBin(seat, binIndex, 'cached');   // CR 405.7
    if (name === undefined) return undefined;
    return this.cacheCard(seat, name, 'bin', opts);
  }

  /** cache the top `n` cards of `seat`'s deck (Blurf; and the engine half of
   * glimpse). Returns what actually moved — a short deck caches fewer. */
  cacheTopOfDeck(seat: Seat, n: number, opts: { prophecy?: string; playable?: boolean } = {}): CardName[] {
    const out: CardName[] = [];
    for (let i = 0; i < n; i++) {
      const name = this.takeFromDeck(seat);   // CR 408.2b: reshuffles at the mark
      if (name === undefined) break;
      out.push(name);
      this.cacheCard(seat, name, 'deck', opts);
    }
    return out;
  }

  /**
   * CR 801.9: Glimpse N — reveal the top N cards of the deck, cache exactly **ONE**
   * of the glimpser's choice, and recycle the other N−1 to the BOTTOM of the
   * deck, top-first. Until end of turn the cached card may be played as if it
   * were in hand, ignoring affinity but still paying the mana cost (Caleb
   * 2023-08-13) and still obeying timing (Caleb 2025-12-28). The reveal is
   * genuinely public — the cache is public information (CR 403.2).
   *
   * ⚠ This USED to cache all N; the glimpse ruling was corrected on 2026-08-19. Every printed
   * reminder for N>1 reads "Reveal the top X cards of the deck and **cache
   * one** … **Recycle the rest**" (Premonition, Oracle of Foretelling,
   * Celestial Purge, Dematerialize); the N=1 cards read "reveal the top card
   * and cache it" only because the two readings coincide there. Glook's
   * "Glimpse 1, X times" is X separate one-card glimpses. `Big Glimpse Card`
   * is a deliberate PILE variant and does not route through here.
   *
   * ✔ RE-VERIFIED 2026-08-26 (report #106) against
   * AlgomancyCards-OracleText.json and the generated printed.json: those four
   * reminders really do end "Recycle the rest.", so the quote above is exact
   * and the printed data is RIGHT. Report #106 ("the reminder text for
   * Glimpsing … does not mention that the other cards not chosen are
   * recycled") was triaged as an upstream data error and is not one — the
   * reminder the player actually reads is `ui/glossary.ts`'s Glimpse entry,
   * which the 2026-08-19 correction never reached. Fixed there.
   *
   * The choice is raised through the resolving part's own `ctx.choose`
   * (`partChoose`), so every caller stays `g.glimpse(seat, n)` and no card code
   * changes. N=1 raises no decision — there is nothing to choose.
   *
   * Returns the card actually cached (a one-element array), or [] on an empty
   * deck.
   */
  glimpse(seat: Seat, n: number): CardName[] {
    if (n <= 0) return [];
    // CR 408.2b: a glimpse that reaches the mark reshuffles and keeps reading.
    // `revealTop` does that BEFORE the reveal, because everything below must
    // stay mutation-free until the "cache one" decision has been answered —
    // see refillFromRecycled's `need`.
    const revealed = this.revealTop(seat, n);
    if (!revealed.length) {
      this.ev('glimpsed', `${this.pname(seat)} glimpses ${n} — the deck is empty.`, { seat, n: 0 });
      return [];
    }
    this.ev('glimpsed',
      `${this.pname(seat)} glimpses ${revealed.length}: ${revealed.join(', ')} — one is cached (playable until end of turn, ignoring affinity), the rest are recycled.`,
      { seat, n: revealed.length, cards: revealed });
    let keep = 0;
    if (revealed.length > 1) {
      const choose = this.partChoose;
      if (choose) {
        const picked = choose('glimpse', {
          kind: 'payOrDecline', seat,
          prompt: `Glimpse ${revealed.length}: cache one — the rest go to the bottom of your deck`,
          options: revealed.map((name, i) => ({ label: name, value: i, card: name })),
        });
        if (typeof picked === 'number' && picked >= 0 && picked < revealed.length) keep = picked;
      } else {
        // no resolving part to hang a decision on (an engine-internal or test
        // call): keep the top card, deterministically, and say so
        this.ev('info',
          `Glimpse ${revealed.length}: no decision window — the top card is cached by default.`);
      }
    }
    this.takeTop(seat, revealed.length);
    // recycle the rest FIRST, so the deck is already settled when the 'cached'
    // event fires and its listeners look at the zones
    revealed.forEach((name, i) => { if (i !== keep) this.recycleToBottom(seat, name); });
    const kept = revealed[keep]!;
    if (revealed.length > 1) {
      this.ev('info',
        `${this.pname(seat)} caches ${kept} and recycles ${revealed.length - 1} card(s) to the bottom of the deck.`,
        { seat, cached: kept, recycled: revealed.filter((_, i) => i !== keep) });
    }
    this.cacheCard(seat, kept, 'deck', { playable: true });
    return [kept];
  }

  /**
   * CR 714.9: the fact bundle every leave-play event carries — 'died'/'despawned'
   * fire once the entity is already out of s.entities, so anything a listener
   * wants (Entropic Entity's "a unit WITH COUNTERS on it despawns", every
   * "whenever a NONTOKEN unit dies") has no other way to read it. The caller
   * spreads its own `to` (and destroy() its `verb`) on top.
   */
  private leftPlayFacts(u: Entity): {
    unit: EntityId; card: CardName; seat: Seat; owner: Seat;
    region: number; counters: number; token: boolean;
  } {
    return {
      unit: u.id, card: u.card, seat: u.controller, owner: u.owner,
      region: u.region, counters: u.counters, token: !!u.token,
    };
  }

  /**
   * Shared leave-play-WITHOUT-DYING bookkeeping (cacheUnit / recall — NOT
   * destroy, whose mods are erased by Unstable rather than binned and whose
   * formation cleanup lands after the death event): pull the unit out of
   * s.entities, resolve its mods, push each nontoken mod into its owner's bin
   * (CR 410.4c: a token mod has no card of its own — erased), and close the
   * formation gap. Returns the detached mods, or null when the unit was
   * already gone. The despawn event, the CR 801.2f mod trashes (afterDespawn) and
   * where the CARD goes stay with the caller — that is where the verbs differ.
   *
   * ⚠ **The mod ENTITIES are deliberately left in `s.entities` here, and are
   * deleted at the bottom of `afterDespawn` (CR 721.1f).** This half of the pair is
   * not optional: `leavePlay` must always be followed by `afterDespawn`, or
   * the mod entities leak into a state whose host is gone. Both callers
   * (`recall`, `cacheUnit`) do exactly that; a third one must too.
   *
   * CR 721.1f — why. `fireEvent` finds a mod's donated `[Augment]` text by walking
   * `u.mods` through the entity table, so a mod that has already been deleted
   * donates nothing. This method used to delete them BEFORE the caller fired
   * `'despawned'`, which meant a printed `[Augment] When I despawn, …` worked
   * on a DEATH (`disposeToBin` deletes its mods at the very bottom, and says
   * so) and was silently dead on a RECALL or a CACHE — half a printed word,
   * and the same object behaving differently depending on how its host left
   * play, which is exactly the inconsistency to remove. Measured before the fix,
   * a Growing Plague grafted onto one host: destroy 1 trigger, recall 0,
   * cache 0. The bin pushes stay HERE, before the announce, exactly as
   * `disposeToBin` does them — a despawn listener and a death listener see
   * the same board.
   *
   * CR 410.3: the face is turned back over HERE, before anything reads
   * `u.card` — so `leftPlayFacts`, the log line, the hand/cache push and the
   * CR 410.5 token sweep all name the FRONT face, which is the card that is really
   * moving zones.
   */
  /**
   * BL-46 — an agreed fix takes `u` off the board QUIETLY: out of play and out
   * of any formation, its mods to their bins (the leavePlay line), and no
   * 'died' / 'despawned' / trash event for anything to hear. The caller puts
   * the card where it goes. Returns false when `u` is not in play.
   */
  quietLeavePlay(u: Entity): boolean {
    const mods = this.leavePlay(u);
    if (!mods) return false;
    for (const m of mods) delete this.s.entities[m.id];
    return true;
  }
  private leavePlay(u: Entity): Entity[] | null {
    if (!this.entity(u.id)) return null;
    this.stampLastKnown(u);                     // CR 714.1: before the face turns back
    this.revertFace(u);
    delete this.s.entities[u.id];
    const mods = u.mods.map(id => this.entity(id)).filter((m): m is Entity => !!m);
    for (const m of mods) {
      // CR 400.4, 410.4a: a card goes to the bin of whoever CONTROLLED it as it left
      // play, and a mod's controller is its host's (attachMod mints it that
      // way, moveMod re-points it, CR 711.1's control change walks `u.mods`). This
      // was `m.owner`; see `disposeToBin`'s `modBin` for the whole argument.
      if (!m.token) this.player(m.controller).bin.push(m.card);   // CR 410.4c: a token MOD has no card of its own — erased
    }
    this.removeFromFormation(u.id);
    return mods;
  }

  /**
   * CR 710.9 — TURN `u` OVER onto its back face `back`.
   *
   * The same entity, the same id, the same slot, counters, damage, mods and
   * `budgets`: a transform is not a new unit, it is one card with a different
   * side up (the transform ruling's argument, CR 108.3, unchanged — `Entity.card` IS the identity, so
   * assigning it moves stats, name, text, targeting and the client render
   * together). What CR 410.3 adds is that the flip is REVERSIBLE, so the front
   * face has to be remembered rather than discarded, and `Entity.frontFace` is
   * where. That pairing is the whole reason this is a primitive and not two
   * assignments in card code: `frontFace` set without `card` moved, or the
   * other way round, is a card that is half turned over.
   *
   * ⚠ It does NOT set `token`, and that is the ruling: *"the back is NOT a
   * token"*. Beyond, Codex Incarnate's type line says "Book Token Unit", which
   * is what keeps it out of every deck list and draft pool (registry.ts), but
   * the ENTITY is the physical Scholar of the Void the whole time — so it bins
   * as Scholar and can be recurred, instead of being erased out of existence.
   *
   * Turning an already-turned card over again is a no-op with a log line, not
   * a second layer: nothing in the pool grants a second back face, and
   * silently overwriting `frontFace` would lose the physical card.
   */
  transformFace(u: Entity, back: CardName): void {
    if (u.frontFace) {
      this.ev('info', `${u.card} is already turned over — it has no second back face.`);
      return;
    }
    const front = u.card;
    u.frontFace = front;
    u.card = back;
    this.ev('info', `${front} transforms into ${back} — the same card, turned over.`);
  }

  /**
   * CR 410.3 — turn a transformed card BACK over as it leaves play: *"In all
   * zones, other than play, it exists as the front side."*
   *
   * Run at the TOP of every route out of play (`leavePlay` for recall and
   * cache, `disposeToBin` for a death and an exchange, `eraseFromPlay`), so
   * every consumer downstream — the bin/hand/cache push, `leftPlayFacts`, the
   * trash record, the CR 410.5 sweep, the erased pile and the log — sees the front
   * face without any of them knowing transforms exist. A no-op for the
   * overwhelming majority of entities, which were never turned over.
   *
   * The 'died'/'despawned' event therefore names the FRONT face too. That is
   * deliberate: the event's job is to tell a listener which CARD moved and
   * where it now is (CR 714.9, 405.6 — a listener reaches into the bin for it), and
   * the card in the bin is the front one. Nothing in the pool triggers off a
   * back face's name.
   */
  private revertFace(u: Entity): void {
    if (!u.frontFace) return;
    const back = u.card;
    u.card = u.frontFace;
    delete u.frontFace;
    // CR 201.4: the flip is a real, visible change of what the card IS —
    // "it went to the bin as a 0/2 Scholar" is a fact a player plans around
    // (it is recurrable now), so it is announced rather than done silently.
    this.ev('info',
      `${back} turns back over — it leaves play as ${u.card}, the front face of the card.`,
      { unit: u.id, card: u.card, back });
  }

  /** The tail cacheUnit() and recall() share, once their despawn event is the
   * last event logged: fire it, then (CR 801.2f, after the despawn so the log reads
   * in order) trash every nontoken mod — they entered a bin from play — and
   * only THEN delete the mod entities.
   *
   * CR 721.1f: the delete is the second half of `leavePlay`, moved here so that the
   * despawn window can still walk `u.mods` for donated `[Augment] When I
   * despawn` text — the same reason `disposeToBin` deletes its mods at the
   * very bottom, and the same place in the sequence. Nothing between the two
   * halves can RESOLVE (fireEvent and noteTrashed only queue triggers), so a
   * listener cannot move, re-bin or re-erase a mod inside this window; it can
   * only read one, which is exactly the point. Every caller of `leavePlay`
   * must reach here — see the ⚠ on `leavePlay`.
   *
   * The despawn event is a PARAMETER. It used to be recovered as
   * `this.events[this.events.length - 1]` — a positional read of a global
   * array that was correct by ORDERING ALONE, and only for as long as the
   * caller's `ev('despawned', …)` stayed the very last thing appended before
   * the call. Nothing enforced that and nothing would have failed loudly if it
   * stopped being true: `fireEvent` would have dispatched the wrong event to
   * every `[Augment] When I despawn` listener, which reads its `data` for the
   * seat, the region and CR 714.9's leave-play facts. Both callers already hold the
   * event `ev()` handed back, so they hand it over. */
  private afterDespawn(u: Entity, mods: Entity[], ev: EngineEvent): void {
    this.fireEvent('despawned', ev, u);
    // CR 720.8, 410.4a, 801.2e: the TRASH is the HOST's controller's — "when a mod
    // goes onto a unit it becomes PART of that unit" (owner, 2026-08-29,
    // report #129) — and **so is the BIN**. `u.controller` is the same value
    // the mod entity itself carries: `attachMod` mints a mod with the host's
    // controller, `moveMod` re-points it to the new host's (CR 720.10a), and a
    // control change (CR 711.1) walks `u.mods` and moves them with it — three places,
    // one invariant, so this is derived rather than a fourth opinion.
    //
    // ⚠ This line used to read `{ binSeat: m.owner }`, under an earlier mod ruling's "the
    // DESTINATION does not move". A later ruling (now CR 400.4) supersedes that half (its
    // attribution half stands): *"Zones always follow control."* The two
    // numbers are therefore equal at every live call, which is why `binSeat`
    // is still passed rather than dropped — see `noteTrashed`.
    for (const m of mods) {
      if (m.token) continue;
      this.noteTrashed(u.controller, m.card, 'play', m, { binSeat: m.controller });
    }
    // CR 407.3a (2026-08-25): and the TOKEN mods reach the public erased pile, which
    // is the one branch of that rule that never had a sweep OR an announcement.
    // leavePlay()/this method erase a token mod outright — leavePlay's own
    // comment already calls that an erase ("a token MOD has no card of its own
    // — erased") — but nothing said so out loud, so a Wraith grafted onto a
    // unit was filed on
    // the pile when its host DIED or was EXCHANGED (disposeToBin emits exactly
    // this line, CR 410.7) and vanished in silence when the host was RECALLED or
    // CACHED. Measured before the fix, one Wraith on one host:
    //     destroy  erased-pile +2, 2 'erased' events
    //     recall   erased-pile +0, 0 events
    //     cache    erased-pile +0, 0 events
    // That is the defect one object over — the same mod behaving differently
    // depending on how its host left play — and CR 407.3a turns on the ERASE, not on
    // the verb that caused it. No zone, entity or timing changes here; this
    // only announces something that was already happening.
    const tokenMods = mods.filter(m => m.token);
    if (tokenMods.length) {
      this.ev('erased',
        `${tokenMods.map(m => m.card).join(', ')} — erased with ${u.card}: a token mod has no card to bin.`,
        // CR 400.4: the same seat `disposeToBin`'s equivalent line uses (it
        // passes `binSeat`, which is the controller now). These two announced
        // one event about one object at two different seats before, which is
        // exactly what CR 407.3a rules out — a mod behaving differently depending on how
        // its host left play — one field over.
        { seat: u.controller, cards: tokenMods.map(m => m.card) });
    }
    // CR 721.1f: last, exactly as disposeToBin does it — see the comment above.
    for (const m of mods) delete this.s.entities[m.id];
  }

  /**
   * CR 403.7: a unit in play is CACHED (Grob, Waxen Witness). The card goes to its
   * OWNER's cache; its mods do NOT travel with it — they go to their own
   * owners' bins, FROM PLAY, and stay there, so wave A's trashing classification (CR 801.2)
   * trashes every nontoken one (Caleb 2024-09-15) — CR 801.2f: in the name of the
   * host's controller, the mod being part of the unit it sat on.
   *
   * CR 410.5c (settled for the cache 2026-08-22): a cached TOKEN visits the cache
   * and is erased out of it by the same state-based sweep, so the 'cached'
   * event fires with the token really sitting there. ⚠ ENGINE'S CALL, not a
   * designer ruling — Caleb's 2025-06-15 answer is about a HAND and there is
   * no statement about the cache at all. It is here because the alternative is
   * one zone behaving differently from the other two for no stated reason.
   *
   * CR 801.8 — `opts.to` is WHOSE CACHE, and it exists because the owner
   * default is only a default: *"Controller's cache — the printed text wins.
   * Printed text always wins."* Grob prints "target unit's CONTROLLER caches
   * it", and after a control change (Abduct, Download, Mindwarp Sporefrog,
   * Bloppert) the controller is not the owner. So this grows the same seat
   * parameter `recall(u, { to })` already has, for the same reason and with
   * the same default — a card that says nothing about a seat (Waxen Witness,
   * "Cache target unit") still goes to its owner's cache.
   *
   * ⚠ Only the DESTINATION moves. The card is still the target's, and
   * `leftPlayFacts` still reports `owner`; caching to a controller is a zone
   * change, not a change of ownership, so a Grob'd stolen card sits in the
   * thief's cache and is theirs to release — which is exactly what the
   * printed text buys.
   */
  cacheUnit(u: Entity, opts: { prophecy?: string; playable?: boolean; to?: Seat } = {}): void {
    const mods = this.leavePlay(u);
    if (!mods) return;
    // CR 801.8: `u.controller`, was `u.owner` — see recall() for the ruling. The
    // doc comment above already described the CONTROLLER's cache as the right
    // destination ("a Grob'd stolen card sits in the thief's cache"); it was
    // only true when a caller passed `to` explicitly, and is now the default.
    const seat = opts.to ?? u.controller;
    // CR 714.9: the facts ride the event. `cache` mirrors recall()'s `hand` — WHERE
    // the card went, which a listener cannot recover from `owner` once the two
    // can differ.
    const evData = { ...this.leftPlayFacts(u), to: 'cache', cache: seat };
    const ev = this.ev('despawned',
      `${u.card} leaves play for ${this.pname(seat)}'s cache` +
      (mods.length ? ` (its ${mods.length} mod(s) stay behind → bin)` : '') +
      (u.token ? ', then erased (token).' : '.'),
      evData);
    this.afterDespawn(u, mods, ev);
    const cc = this.cacheCard(seat, u.card, 'play', opts);
    // CR 410.5c's sweep, on the cache this time — `cc.uid` names the entry we just
    // made, so a second copy of the same card already sitting there is safe
    if (u.token) this.eraseFromZone(seat, u.card, 'cache', `${u.card} is erased from the cache — it is a token.`, { uid: cc.uid });
  }

  /** Where cache entry `uid` sits in `seat`'s cache right now, or -1 when it
   * is gone. The bridge between a stable TargetRef and the index-based zone
   * API: an effect resolves its 'cachedCard' target through this, and a -1
   * IS the "the target vanished" case. */
  cacheIndexOf(seat: Seat, uid: number): number {
    return this.cache(seat).findIndex(cc => cc.uid === uid);
  }

  /** Take a card OUT of the cache (playing it, grafting it, Prismatic
   * Observer's recall, Lurking Dread's put-into-play). Returns the removed
   * entry, or undefined when the index is out of range. */
  uncache(seat: Seat, index: number): CachedCard | undefined {
    const cache = this.cacheMut(seat);
    if (index < 0 || index >= cache.length) return undefined;
    return cache.splice(index, 1)[0];
  }

  /**
   * How — if at all — `seat` may play cache entry `index` right now.
   *   'prophecy' the prophecy is fulfilled: FREE, and "for free" also ignores
   *              affinity (Caleb 2024-10-28). CR 803.7h.
   *   'glimpse'  a live until-end-of-turn permission: pay the mana, ignore
   *              affinity. CR 403.3c.
   *   null       no permission — being cached is not enough (CR 403.3).
   * Timing is NOT considered here; the card is played "as if it were in your
   * hand", so the normal phase gate applies on top (see apply.ts).
   */
  cachePermission(seat: Seat, index: number): 'prophecy' | 'glimpse' | null {
    const cc = this.cache(seat)[index];
    if (!cc) return null;
    if (cc.prophecy && this.prophecyMet(seat, cc.prophecy)) return 'prophecy';
    if (cc.playableUntilTurn !== undefined && this.s.turn <= cc.playableUntilTurn) return 'glimpse';
    return null;
  }

  /**
   * The timing a cached card is played at: its PRINTED timing, always.
   *
   * The prophecy ruling (now CR 803.7h, 803.7i) is explicit — a fulfilled prophecy makes the card free, and it is then
   * played "as if it were in your hand", so "normal TIMING still applies".
   * CR 801.9f says the same for a glimpse release (Caleb 2025-12-28). There is no
   * route by which the cache changes when a card may be played.
   *
   * Until it was fixed (CR 803.7i states the rule), this read a trailing [Haste] on
   * the banner as an override
   * "for the prophecy release only (R42, Divine Intervention)" — a comment
   * citing, as its authority, the ruling that says the opposite. Divine
   * Intervention is a {Battle} spell, so the override made its fulfilled free
   * release unofferable at every battle window in the game, and the owner lost
   * a game to it (report #152). The marker widens the PROPHESY window instead
   * (E.mayProphesy). Guarded by 257-prophecy-release-timing.test.ts.
   */
  cachedTiming(seat: Seat, index: number): CardDef['timing'] {
    return this.card(this.cache(seat)[index]!.card).timing;
  }

  /** Affordability ignoring AFFINITY but nothing else — what glimpse's
   * "ignoring affinity" (CR 403.3c) needs. The bill must match what payCard will
   * actually charge: printed mana PLUS active cost modifiers (CR 111.10) and any
   * life tax (CR 111.10d) — checking printed mana alone would offer a play whose
   * payment then throws (mana) or kills the payer (life).
   *
   * CR 801.9g: `opts` exists because the glimpse waiver reaches the MOD path too,
   * and a mod is priced at `purpose: 'mod'` (CR 701.2b — applying a mod is not
   * playing, so a "spells cost more to play" modifier must not tax it). The
   * opts thread all the way down for the same reason the bill above matches
   * payCard: the check and the charge have to be the same sum. */
  canPayManaOnly(seat: Seat, name: CardName, opts: CostOpts = {}): boolean {
    if (this.openMana(seat) < this.manaToPlay(seat, name, opts)) return false;
    if (!this.canPayLife(seat, this.lifeToPlay(seat, name, opts))) return false;
    // CR 111.10: the imposed-sacrifice gate is part of the bill too — a glimpse
    // release with no unit to sacrifice must not be offered either.
    const sacs = this.unitsToPlay(seat, name, opts);
    const region = opts.region ?? this.actionRegion(seat);
    return sacs === 0 || this.unitsOf(seat, region).length >= sacs;
  }

  /** `viewer` looks at `owner`'s hand (Bripp etc.): snapshot it so the client
   * can keep showing what was seen — nobody should need pen and paper. The
   * snapshot goes stale (cleared) when the owner's hand next mixes unknowably
   * (their draft-step merge).
   *
   * CT-174(b): the snapshot is PROVISIONAL until the revealing moment ends —
   * see `settleSeenHands`, which is where it is finished. Five of the pool's
   * seven look-at-a-hand sites move a card out of that hand after this line
   * runs, so taking the list here and keeping it verbatim is what owner report
   * #156 is about. Marking rather than moving the call is deliberate: the fix
   * has to hold for the eighth site nobody has written yet. */
  revealHandTo(viewer: Seat, owner: Seat): void {
    this.s.seenHand[viewer] = { turn: this.s.turn, cards: [...this.player(owner).hand], pending: owner };
    this.ev('info', `${this.pname(viewer)} looks at ${this.pname(owner)}'s hand.`);
  }

  /**
   * CT-174(b) / owner report #156 — FINISH A HAND SNAPSHOT WHEN ITS MOMENT
   * ENDS, exactly once.
   *
   * > *"It'd also be nice if it showed the cards at the END of the 'revealing'
   * > moment so that if they are forcing the opponent to discard a card, that
   * > card isn't included in the list. But be careful with things like Bripp to
   * > make sure that it doesn't include the drawn card."*
   *
   * ⚠ THE OWNER'S SECOND SENTENCE IS THE WHOLE SPECIFICATION, and it rules out
   * the obvious reading. The rule is NOT "the hand as it stands when the moment
   * ends" — Bripp recycles a card and the owner then DRAWS, so that hand holds
   * a card the looker never saw. Nor is it "the hand at the start minus a
   * discard", which is a special case dressed up as a rule. It is:
   *
   *     WHAT YOU SAW, MINUS WHAT HAS SINCE LEFT. Never plus anything.
   *
   * An intersection, not a re-read: `cards` only ever shrinks, so a card that
   * arrived inside the moment cannot appear (Bripp's draw) and a card that left
   * cannot survive (every discard, cache, recycle and take). Both halves the
   * owner named fall out of the one sentence, which is why this is in the
   * engine and not repeated across five card files.
   *
   * MULTISET, not set: a hand may hold two copies of a card, and being made to
   * discard one must leave the other standing. DQVZ's own list is why — the
   * Aberrant Statweaver Rashi was forced to trash is in it twice.
   *
   * ONCE. `pending` is deleted here, and nothing may reconcile a finished
   * snapshot again: a list that kept following the hand would tell the looker
   * about every later discard and play, which is a live readout of a hidden
   * zone rather than a memory aid.
   */
  private settleSeenHands(): void {
    for (const snap of this.s.seenHand) {
      if (!snap || snap.pending === undefined) continue;
      const live = [...this.player(snap.pending).hand];
      snap.cards = snap.cards.filter(name => {
        const i = live.indexOf(name);
        if (i === -1) return false;
        live.splice(i, 1);
        return true;
      });
      delete snap.pending;
    }
  }

  // ── units, tokens, damage, death ────────────────────────────────────
  private newEntity(partial: Omit<Entity, 'id' | 'damage' | 'counters' | 'tempPower' | 'tempToughness' | 'mods' | 'budgets'>): Entity {
    const e: Entity = {
      id: this.s.nextId++, damage: 0, counters: 0, tempPower: 0, tempToughness: 0,
      mods: [], budgets: {}, spawnedTurn: this.s.turn, ...partial,
    };
    this.s.entities[e.id] = e;
    return e;
  }

  /** the turn an entity arrived in play, or undefined for one that predates
   * the field (a state serialized before Entity.spawnedTurn existed) */
  spawnedTurn(u: Entity): number | undefined { return u.spawnedTurn; }
  /** "…that spawned this turn" (Banishment; "if I spawned this turn") */
  spawnedThisTurn(u: Entity): boolean { return u.spawnedTurn === this.s.turn; }

  /**
   * Put a unit into play. `seat` is who it enters play UNDER — its controller.
   *
   * CARD-TODO #17 — `opts.owner`: WHOSE CARD IT IS, which is not always the
   * same seat. This method used to write `owner: seat, controller: seat`
   * together and took no owner at all, so an effect that reaches into a zone
   * it does not own and puts a card into play NATURALISED that card: Wake the
   * Dead ("Play up to two units in ANY bin…") raised an opponent's unit and
   * made the caster its owner for the rest of the game — when it died it went
   * to the CASTER's bin, it counted toward the caster's "cards in your bin"
   * effects, and the original owner could never recur it.
   *
   * The engine tracks owner and controller separately everywhere else (CR 102.4, 102.5), and the erased-pile
   * ruling said so ("each card reaches ITS OWN owner's erased pile — a virus on an
   * enemy spell is the enemy's card"), so this was a missing parameter rather
   * than a reading. It defaults to `seat`, which is right for the overwhelming
   * majority of callers: a TOKEN is created by whoever creates it, and a card
   * played out of your own hand, bin or cache is yours already.
   *
   * NOT a control change. CR 711.1 moves a unit between controllers and leaves the
   * card where it belongs; this is the other half of the same distinction, and
   * a caller that wants both (Uglk: "each player puts a unit from THEIR bin
   * into play under an OPPONENT's control") passes the opponent as `seat` and
   * its owner as `opts.owner`.
   */
  spawnUnit(seat: Seat, name: CardName, region: number, opts: { token?: boolean; tokenStats?: [number, number]; counters?: number; from?: 'hand' | 'cache' | 'bin' | 'deck' | 'play'; spot?: FormationSpot; owner?: Seat; wearing?: SpawnFace; asPlay?: boolean } = {}): Entity {
    /**
     * CR 708.3: a UNIT TOKEN is a creation, and a creation is replaceable — before
     * anything exists. `token: true` is what makes this a creation; a plain
     * `spawnUnit` is a real card being put into play (Exhume, Resurrect,
     * Rousing Spirit, Lurking Dread — all four print "put into play"), which
     * creates nothing and is not replaceable.
     *
     * The substitution may cross the unit/spell divide, because Cosmic
     * Conspirator's four named types do ("a Robot, Poison, Crystal or
     * Fireball"). When it does, this delegates to `createSpellToken` and
     * returns THAT entity — so a caller that keeps the return value gets the
     * thing that was really created rather than a body that does not exist.
     * Every Robot creation site in the pool ignores the return; the four
     * `tokenStats`/`spot` options are meaningless for a spell token and are
     * dropped with it, which is correct: they describe a body.
     *
     * ⚠ NOT replaceable, on purpose: `opts.spot` (CR 602.7's play-into-formation).
     * That path is a CARD being played into a line, not a token being created,
     * and it never carries `token: true`.
     */
    if (opts.token && !this.substitutingToken) {
      const req = this.replaceTokenCreation({
        form: 'unit', name, x: opts.counters ?? 0, seat, region,
        ...(opts.tokenStats ? { stats: opts.tokenStats } : {}),
      });
      if (req.name !== name || req.form !== 'unit' || req.x !== (opts.counters ?? 0)) {
        this.substitutingToken = true;          // the substitute is not itself replaceable
        try {
          return req.form === 'spell'
            ? this.createSpellToken(req.seat, req.name, req.x, req.region)
            // the SUBSTITUTE is a fresh creation by `req.seat`, so it is
            // theirs — an inherited `opts.owner` would be a fact about the
            // card that was replaced, and that card no longer exists.
            : this.spawnUnit(req.seat, req.name, req.region, { ...opts, counters: req.x, owner: req.seat });
        } finally { this.substitutingToken = false; }
      }
    }
    const owner = opts.owner ?? seat;
    const u = this.newEntity({
      card: name, owner, controller: seat, kind: 'unit', region,
      ...(opts.token ? { token: true, tokenStats: opts.tokenStats } : {}),
    });
    // "I spawn with X counters" (Robot): counters are on before the spawn
    // event, and the AMOUNT LAYER is consulted first, exactly as addCounters
    // does — report #88 (XVUR): an allied Flux Resonator makes a Robot X
    // enter with X+1 counters (Caleb 2025-03-21: "Yep."; 2025-05-30: "it's
    // just X+1 … a 2/2 robot would spawn as a 3/3, not a 4/4"). Positive
    // spawns only: "if ONE OR MORE counters would be put" — a counterless
    // spawn is no placement and never becomes one.
    //
    // CR 301.8a, 707.5a: a spawn's counters ARE PUT ON it, as it enters, by the
    // seat creating it. Caleb, asked whether a Robot spawning "is never placed"
    // (2023-09-20): "It would trigger them"; Scrapyard Custodian on Robot
    // creation (2025-03-21): "Yes" — "it also does work this way in mtg" (whose
    // rules count an object given counters as it enters as "put on"). Report
    // #220 (room XPDJ): a Living Forge Robot drew nothing off a Custodian. So
    // it is a placement in all three respects a placement has:
    //   · the AMOUNT layer (just above), as it always was;
    //   · the REDIRECT (`replaceCounters`): during battle a Counter Thief takes
    //     them, and the unit arrives without — a Robot so robbed is X = 0, a
    //     0/0, and dies at the next state check (CR 713.2) like any other;
    //   · the SIGNAL: a `countersChanged` after 'spawned' (below), so "when
    //     you put counters on…" hears it. Signalled, not routed through
    //     `addCounters`: that would run the amount layer a second time and a
    //     death check against a body still being dressed (`wearing`).
    //
    // CR 301.8: …and the same field carries what the CARD ITSELF prints —
    // `CardBehavior.spawnsWithCounters` ("I spawn with two +1/+1 counters",
    // Powerforge Synergist; "three -1/-1 counters on me", Aethercap Siphoner).
    // ONE field, ONE layer, ONE moment, for the printed sentence and for a
    // Robot's X alike: two cards printing the same kind of thing must not
    // disagree about whether a replacement effect scales them, and a spawn
    // watcher must read the body the card prints. Both cards used to do this
    // themselves after the fact — Aethercap through a queued `spawned` trigger,
    // which cannot run before the event that raised it (CR 707.5) and which made
    // Iyngstra gain 4 for a 1/1; Powerforge through a `when()` that wrote
    // `self.counters` RAW and so walked straight past this layer.
    let spawnCounters = (opts.counters ?? 0) + (getCard(name).spawnsWithCounters ?? 0);
    // CR 301.8a: the gate is `!== 0`, not `>= 1`. "If ONE OR MORE counters would be
    // put" is about a placement EXISTING, not about its sign — the engine keeps
    // one SIGNED total (CR 708.8a; the owner: "all counters count as counters"), and Flux
    // Resonator's own delta answers both directions already
    // (`ctx.amount > 0 ? 1 : -1`), which is what `addCounters` has always fed
    // it. No caller passes a negative `opts.counters`, so nothing that was
    // here before changes; it only stops the declarative half above from
    // getting a different answer than the `addCounters` call it replaced.
    // `holder` is where they land: the body itself, or a redirect's unit.
    let holder: Entity = u;
    if (spawnCounters !== 0) {
      spawnCounters += this.amountDelta({
        kind: 'counters', region, amount: spawnCounters, unit: u, combat: false,
        sourceSeat: seat,
      });
      if (spawnCounters) holder = this.replaceCounters(u, spawnCounters);
    }
    if (spawnCounters) holder.counters += spawnCounters;
    const ownCounters = holder === u ? spawnCounters : 0;
    // CR 602.7: a card PLAYED into an open spot in the formation is put there
    // BEFORE the spawn event exists, so no listener and no player ever sees it
    // standing anywhere else. See takeSpot.
    const placed = opts.spot ? this.takeSpot(u, seat, opts.spot) : null;
    /**
     * CR 701.3 — PLAY vs PUT INTO PLAY. Four cards in the pool print "put into
     * play" (Exhume, Resurrect, Rousing Spirit, Lurking Dread) and two print
     * "**play**": Wake the Dead ("Play up to two units in any bin … now, for
     * free") and The Bonesculptor ("You may play one unit with no abilities
     * from your bin each deployment"). All six called this method and were
     * therefore indistinguishable — no play event of any kind, so the
     * `'cardPlayed'` event (CR 108.1a) never fired and every "whenever you play a card / a unit"
     * watcher in the pool was deaf to the two that really were plays.
     *
     * `asPlay` is that one printed word, and it is deliberately a flag on the
     * SPAWN rather than a stack item: an effect that plays a card
     * mid-resolution has no cast window to build one in, which is the standing
     * approximation `playInline` (batch-water-a) already carries — the played
     * card arrives inside the playing effect's resolution and nobody may
     * respond to it or negate it. It rides WITH `opts.from`, never instead of
     * it: a play always comes out of a zone, and the `from` on the 'spawned'
     * event below (CR 410.6) is the other half of the same fact — the half Stalwart
     * Sentinel and Proph read for "a card played from anywhere other than your
     * hand". Each watcher therefore hears the play exactly once, on whichever
     * of the two events it listens to.
     *
     * The event is BUILT here, above the spawn line, and DISPATCHED below it,
     * immediately before the spawn dispatch: the play precedes the arrival —
     * the order `commitItem` puts them in for every ordinary play — but no
     * listener may run against a body that is still being dressed (CR 303.11's
     * `wearing`, CR 602.7's placement). Signal-only (`msg: ''`), the
     * convention; the spawn line already announces it.
     *
     * ⚠ NEVER on a token: `token: false` is a fact here, not a default. A
     * created token is not a card (CR 304.2, 304.15) and no caller passes both.
     *
     * ⚠ CR 706.13 / CT-79 — NO `item` FIELD, AND THAT IS THE FACT IT REPORTS.
     * `commitItem` puts the played item's id on its `cardPlayed`; here there
     * is no `StackItem` to name, because this play IS the spawn (CR 301.9's
     * printed "play", not a cast). A listener that wants "the effect that was
     * just played" must therefore read `data.item === undefined` as "this play
     * put no effect on the stack" and do nothing to the stack — NOT fall back
     * to a (card, controller) scan, which is exactly the bug CT-79 closed:
     * Wake the Dead is a {Battle} spell, so a unit raised here can share a
     * name with an unrelated item standing on the stack, and Void Mandible
     * used to negate that one.
     *
     * ⚠ THE DIVERGENCE THIS LEAVES STANDING (F-U14-3, reported not fixed): under
     * CR 701.4 a card played mid-resolution goes on the stack and is
     * respondable and negatable. This path predates that and still spawns in
     * place, so a unit played out of a bin during battle cannot be answered at
     * all. Making it an item is a much larger change than CT-79 (a spawn is
     * not a cast; there is no cast window to declare it in) and it is filed
     * rather than guessed at.
     */
    const playEv = opts.asPlay
      ? this.ev('cardPlayed', '', {
        seat, card: name, token: false, region,
        ...(opts.from ? { from: opts.from } : {}),
      })
      : null;
    // CR 410.6, 301.9: `from` is set only when this spawn IS a card being PLAYED out of a
    // zone (resolveItem for a unit / spell unit card). A unit created by an
    // effect carries no zone, which is what keeps "when you play a card from
    // anywhere other than your hand" (Proph) off effect-created units.
    // CARD-TODO #17: when the card is not the controller's, the log says so —
    // a borrowed unit reads differently from a naturalised one, and "it dies
    // to THEIR bin" is a fact the table has to be able to see coming. The
    // `owner` key is emitted only when it differs, so every existing reader of
    // a 'spawned' event keeps the payload it already had.
    const ev = this.ev('spawned',
      // CR 301.8: the counter note is SIGN-AWARE now that a card can print a
      // negative spawn ("three -1/-1 counters on me"). It used to read
      // "(-3 +1/+1)" the moment one did.
      `${this.pname(seat)} spawns ${name}`
      + (ownCounters ? ` (${Math.abs(ownCounters)} ${ownCounters > 0 ? '+1/+1' : '-1/-1'})` : '')
      + (owner !== seat ? ` — ${this.pname(owner)}'s card.` : '.'),
      {
        seat, unit: u.id, region, card: name,
        ...(owner !== seat ? { owner } : {}),
        ...(opts.from ? { from: opts.from } : {}),
      });
    // under the spawn line, before anything the spawn triggers: the placement
    // is part of the play, not a consequence of it
    if (placed) this.ev('info', placed, { unit: u.id, region, seat });
    /**
     * CR 303.11 — and the same for a body that ENTERS as something else (Borrower
     * of Forms). Exactly CR 602.7's placement rule one field over: applied before
     * `fireEvent`, which is the single door every listener goes through, so no
     * watcher and no player ever sees the body standing here as itself.
     * Logged UNDER the spawn line for the same reason the placement is —
     * CR 201.5 keeps `Entity.card` as the physical card, so the spawn
     * line still names Borrower of Forms and the line beneath says what it is.
     *
     * COUNTERS AND TEMP CHANGES FIRST, face last. The final numbers are the
     * same either way, but `wearCopy` ends in `checkDeaths()` and a face is
     * the one thing here that can be lethal on arrival (a borrowed base 0
     * defense); putting the copied counters on first means that check sees the
     * finished body rather than a half-dressed one.
     */
    if (opts.wearing) {
      const w = opts.wearing;
      if (w.counters) this.addCounters(u, w.counters);
      if (w.tempPower || w.tempToughness) this.addTemp(u, w.tempPower ?? 0, w.tempToughness ?? 0);
      this.wearCopy(u, w.copy);
    }
    // CR 111.10k: a unit that came from a ZONE was PLAYED, so it burns the Deferral
    // Drone charge; one that came from nowhere was CREATED and does not. Same
    // `opts.from` test as just above (CR 410.6), and the same place the card's own
    // bookkeeping trigger used to read it — the spend is engine-side now so a
    // dead Drone cannot leave a paid-for charge unspendable.
    if (opts.from !== undefined) this.spendNextPlayDiscount(seat);
    // CR 301.9: the play, then the arrival — see the `playEv` block above.
    // CR 701.1e: the body is already standing here, but this is ITS OWN play, and a
    // card being played never hears its own play — so it is not a listener.
    if (playEv) this.fireEvent('cardPlayed', playEv, undefined, u.id);
    this.fireEvent('spawned', ev);
    // CR 707.5a: …and the placement, after the arrival it is part of. On the body
    // itself it is signal-only (`msg: ''`) — the spawn line already says it;
    // on a redirect's unit it is that unit's own line, as addCounters writes it.
    if (spawnCounters && this.entity(holder.id)) {
      const cev = this.ev('countersChanged', holder === u ? ''
        : `${holder.card} gets ${Math.abs(spawnCounters)} ${spawnCounters > 0 ? '+1/+1' : '-1/-1'} `
          + `counter(s) (net ${holder.counters}).`,
        { unit: holder.id, n: spawnCounters, total: holder.counters, by: seat, spawn: u.id });
      this.fireEvent('countersChanged', cev);
    }
    // CR 708.9: record the creation in the open batch, so "each unique token you
    // created" has a creation to be unique across. After the spawn event, so a
    // batch replacement can never observe a half-created board. The REQUEST
    // (opts.counters), not the amount-modified outcome: a batch copy replays
    // the creation, and the layer applies to the copy on its own spawn.
    //
    // CR 304.14: …and the STATS the creation set (`tokenStats`: "a 3/3 Unit
    // Token", Soul Siphon's X/X). Reports #212/#213 (room TJGW): without them
    // Automaton's copy of a Mirage Walker 3/3 was the bare 1/1 definition.
    if (opts.token) {
      this.noteTokenCreated({
        form: 'unit', name, x: opts.counters ?? 0, seat, region,
        ...(opts.tokenStats ? { stats: [opts.tokenStats[0], opts.tokenStats[1]] as [number, number] } : {}),
      });
    }
    return u;
  }

  // ── the Wraith token ───────────────────────────────────────────
  //
  // "Wraith — cost 0 [d], 3/3, Blight Zombie Token Unit. [Augment] At the start
  // of deployment, put a -1/-1 counter on an ally. When I die, Augment a Wraith
  // onto an ally." (Redesigned 2026-08-21; the retired 4/4 printing shrank
  // itself on attack/block and RE-HOMED itself on death — that was the old Wraith ruling, now
  // withdrawn.) The token was renamed FROM "Wight"; the printed data is
  // mid-transition (Blight's End still says the retired name, six other cards
  // say the current one), so `Wight` is registered as an ALIAS of `Wraith`.
  //
  // Two entry points, deliberately: "CREATE a Wraith" spawns the body,
  // "AUGMENT a Wraith onto a unit" creates a Wraith directly as a mod. They
  // stay a PAIR under the redesign — the death trigger mints a brand-new token
  // through augmentWraith(), which is now correct behaviour rather than the
  // bug it was once suspected of being.

  /** the canonical token name; "Wight" resolves here through the alias */
  static readonly WRAITH: CardName = 'Wraith';

  /** "Create a Wraith" — the 3/3 body, as a unit token. */
  createWraith(seat: Seat, region?: number): Entity {
    return this.spawnUnit(seat, E.WRAITH, region ?? this.actionRegion(seat), { token: true });
  }

  /** "Augment a Wraith onto a unit" — a Wraith applied rather than spawned.
   * The mod is itself a token, so it is erased with its host (never binned)
   * when it leaves play. */
  augmentWraith(host: Entity, byPlayer: Seat): Entity {
    return this.attachMod(host, E.WRAITH, byPlayer, 'augment', undefined, { token: true });
  }

  createSpellToken(seat: Seat, name: CardName, x: number, region?: number): Entity {
    const reg = region ?? this.actionRegion(seat);
    // CR 708.3: the half of Cosmic Conspirator that was completely dead. The old
    // implementation was a `spawned` trigger, and `createSpellToken` fires no
    // dispatchable event at all — so "if you would create a POISON, CRYSTAL or
    // FIREBALL" could never be heard, and Biotoxicity's three Poisons (report
    // #64) went past it in silence. A replacement is consulted, not dispatched,
    // so it needs no event: the seam is the call itself.
    if (!this.substitutingToken) {
      const req = this.replaceTokenCreation({ form: 'spell', name, x, seat, region: reg });
      if (req.name !== name || req.form !== 'spell' || req.x !== x) {
        this.substitutingToken = true;
        try {
          return req.form === 'unit'
            ? this.spawnUnit(req.seat, req.name, req.region, { token: true, ...(req.x ? { counters: req.x } : {}) })
            : this.createSpellToken(req.seat, req.name, req.x, req.region);
        } finally { this.substitutingToken = false; }
      }
    }
    const t = this.newEntity({ card: name, owner: seat, controller: seat, kind: 'spellToken', region: reg, x });
    // CR 300.5c: this event was LOGGED and never DISPATCHED, so "when you create a
    // token" (Mycelial Mentor) was half-dead — unit tokens fired it through
    // 'spawned', a Poison/Crystal/Fireball fired nothing. Spell tokens are
    // still tokens (owner, 2026-08-24), and the set says so itself: Cosmic
    // Conspirator prints "a Robot, Poison, Crystal or Fireball".
    //
    // The payload deliberately carries `id`, NOT `unit`: a spell token is not
    // a unit, and every "unit token" listener in the pool reads `data.unit`
    // (The World Shepherd). Dispatched BEFORE noteTokenCreated, exactly like
    // spawnUnit's 'spawned', so a batch replacement can never observe a
    // half-created board.
    const ev = this.ev('tokenCreated', `${this.pname(seat)} creates a ${name} ${x}.`, { seat, id: t.id, region: reg });
    this.fireEvent('tokenCreated', ev);
    this.noteTokenCreated({ form: 'spell', name, x, seat, region: reg });
    return t;
  }

  /** the region where seat's non-battle actions happen right now */
  actionRegion(seat: Seat): number {
    if (this.s.phase === 'battle' && this.s.battle) return this.s.battle.region;
    return this.homeRegion(seat);
  }

  /** +1/+1 (n>0) or -1/-1 (n<0) counters; net counters cancel pairwise (Manual)
   * — a single signed int models that. Fires 'countersChanged' for triggers.
   *
   * CR 708.7: TWO replacement seams sit above the commit, in printed order.
   * "Put that many counters PLUS ONE instead" (Flux Resonator, Proliferating
   * Slime) changes the number, so it is an `AmountMod` and it is summed — two
   * Resonators put two more. "Those counters are placed on ME instead"
   * (Counter Thief) changes the recipient, so it is a redirect, and redirects
   * chain (CR 708.4, `replaceCounters`). The amount runs FIRST, because the
   * thief steals what would have been placed, plus-one included.
   *
   * Both are consulted, not re-entered, which is why the module-level `let
   * proliferating` flag that used to guard this path is gone (report #60).
   *
   * CR 708.8b: a placement KNOWS WHO MADE IT. `by` is the seat putting the counters
   * on — optional, because counters also arrive from engine sweeps and from
   * white-box test calls where there is no actor to name. When it is omitted
   * the actor defaults to `partActor`: the controller of the effect currently
   * resolving, which is what "YOU put a counter" means for every counter a
   * card has ever placed. It reaches two places and no others:
   *   · `AmountCtx.sourceSeat`, so Flux Resonator's printed "by an ALLIED
   *     SOURCE" is the clause it prints instead of "onto an allied unit";
   *   · `countersChanged`'s `by`, so Wandering Blightshell's "when YOU put a
   *     counter on an enemy" and Scrapyard Custodian's "when you put one or
   *     more counters on an ally" can read the attribution instead of
   *     guessing it from the sign.
   * A REDIRECT does not change it: if the counters you aimed at one unit are
   * placed on another (Counter Thief), you are still the one who put them. */
  addCounters(target: Entity, n: number, by?: Seat): void {
    if (!n || !this.entity(target.id)) return;
    // CR 708.8b: explicit actor first, then the resolving effect's controller. Both
    // may be absent (an engine sweep, a white-box call) and `undefined` is a
    // legitimate answer — "nobody in particular put this" is not the same
    // statement as "you did", and a card that asks WHO must get no for an
    // answer rather than a guess.
    const actor = by ?? this.partActor ?? undefined;
    n += this.amountDelta({
      kind: 'counters', region: target.region, amount: n, unit: target, combat: false,
      sourceSeat: actor,
    });
    if (!n) return;                     // a modifier cancelled it out entirely
    target = this.replaceCounters(target, n);
    if (!this.entity(target.id)) return;
    target.counters += n;
    const kind = n > 0 ? '+1/+1' : '-1/-1';
    const ev = this.ev('countersChanged',
      `${target.card} gets ${Math.abs(n)} ${kind} counter(s) (net ${target.counters}).`,
      { unit: target.id, n, total: target.counters, ...(actor !== undefined ? { by: actor } : {}) });
    this.fireEvent('countersChanged', ev);
    this.checkDeaths();
  }

  /**
   * CR 708.8, 112.15: **REMOVING** counters from a unit — the unit half of
   * `loseRot`/`loseDebt`, and a different operation from putting the opposite
   * kind on. Counters are one signed net int (CR 206.6a), so `n` is a COUNT of
   * the kind the unit carries: removing 2 from a net +3 leaves +1, removing 2
   * from a net -3 leaves -1. Clamped — you cannot remove counters that are not
   * there — and it returns how many went, so a caller can say "if you do".
   *
   * It used to be `addCounters(u, -k)`, and the engine could not tell
   * "remove two +1/+1 counters" from "put two -1/-1 counters" (report #210's
   * second bug): Burn the Blight stripping an enemy's +1/+1s drew you a card
   * off Wandering Blightshell, stripping your own ally's drew one off Scrapyard
   * Custodian and fed Pestilent Mycelion, and Flux Resonator / Proliferating
   * Slime made the removal one BIGGER, so a +2 unit ended on -1 — against
   * CR 708.8's own example ("Proliferating Slime does not change how many
   * counters Burn the Blight removes").
   *
   * So, exactly as the player-counter half does: no `amountDelta` (Flux
   * Resonator and Proliferating Slime price what is PUT ON — owner, 2026-08-25:
   * "Removing counters isn't 'putting on'"), no `replaceCounters` (Counter
   * Thief takes counters that would be PLACED), and its own event,
   * `countersRemoved`, so no "counters are put on" listener hears it. The event
   * carries the same `{ unit, n, total }` as `countersChanged` — `n` the signed
   * change, `total` the net after — plus `removed` (the count) and `by` when
   * an actor is known. Runs `checkDeaths`: a unit living on its +1/+1s can die.
   */
  removeCounters(target: Entity, n: number, by?: Seat): number {
    const u = this.entity(target.id);
    if (!u || !u.counters) return 0;
    const removed = Math.min(Math.max(0, Math.trunc(n)), Math.abs(u.counters));
    if (removed <= 0) return 0;
    const delta = u.counters > 0 ? -removed : removed;
    const kind = u.counters > 0 ? '+1/+1' : '-1/-1';
    u.counters += delta;
    const actor = by ?? this.partActor ?? undefined;
    const ev = this.ev('countersRemoved',
      `${u.card} loses ${removed} ${kind} counter(s) (net ${u.counters}).`,
      { unit: u.id, n: delta, removed, total: u.counters, ...(actor !== undefined ? { by: actor } : {}) });
    this.fireEvent('countersRemoved', ev);
    this.checkDeaths();
    return removed;
  }

  addTemp(target: Entity, dp: number, dt: number): void {
    target.tempPower += dp;
    target.tempToughness += dt;
    const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    this.ev('statChanged', `${target.card} gets ${sign(dp)}/${sign(dt)} until regroup.`, { unit: target.id, dp, dt });
  }

  /**
   * LAYER 2: rewrite a unit's BASE stats until regroup.
   *
   * Not a temp delta. "Becomes a base 4/4" and "exchange the base stats" both
   * replace layer 2, so a second base-setting effect overwrites the first
   * instead of stacking with it, and layer-3 changes (counters, temp deltas, a
   * lord's static) keep applying on top. Doing this with addTemp is how
   * Formless turned a Body-Swapped 2/1 into a 6/9 (playtest 2026-08-20).
   *
   * The stamp is timestamped off the nextId clock so baseStatsOf can resolve
   * it last-wins against the CONTINUOUS base-setters (Aberrant Statweaver's
   * "your units are base 3/3"), which live on StaticMod instead.
   */
  setBase(target: Entity, p: number, t: number): void {
    target.baseSet = [p, t];
    target.baseSetSeq = this.s.nextId++;
    this.ev('statChanged', `${target.card}'s base becomes ${p}/${t} until regroup.`,
      { unit: target.id, baseP: p, baseT: t });
    this.checkDeaths();   // a base 0 defense is lethal, exactly as counters are
  }

  /** grant an attribute until regroup (cleared with temp stats, CR 506.2 step 3) */
  addTempAttr(target: Entity, attr: import('./types.ts').Attr): void {
    (target.tempAttrs ??= []).push(attr);
    (target.tempAttrsAt ??= []).push(this.stampNow());   // CR 712.2: index for index
    this.ev('statChanged', `${target.card} gains {${attr}} until regroup.`, { unit: target.id, attr });
  }

  /**
   * CR 712.1: switch a unit's attribute and/or ability layer off UNTIL REGROUP —
   * "Target unit loses all attributes and abilities until regroup"
   * (Suppression Field), "…and loses all attributes until regroup" (Formless).
   * `by` is the card to blame, kept so the text box can say who did it.
   *
   * The continuous form of the same layer is a StaticMod flag and needs no
   * primitive: it is simply true while the projector is there.
   */
  suppress(target: Entity, by: CardName, what: { attrs?: boolean; abilities?: boolean }): void {
    const sup = (target.suppressed ??= {});
    // CR 113.3: a strip is a timestamp. It takes what is there NOW; a later strip
    // only moves the time forward, and takes everything an earlier one did.
    const at = this.stampNow();
    if (what.attrs) { sup.attrs = by; sup.attrsAt = at; }
    if (what.abilities) { sup.abilities = by; sup.abilitiesAt = at; }
    const lost = [what.attrs ? 'attributes' : '', what.abilities ? 'abilities' : '']
      .filter(Boolean).join(' and ');
    this.ev('statChanged', `${target.card} loses all ${lost} until regroup (${by}).`,
      { unit: target.id, suppressed: what });
    // an attribute the unit was relying on (Tough, a static's grant) can be
    // what was keeping it alive
    this.checkDeaths();
  }

  /**
   * CR 109.8: grant a unit an authored ability until regroup — "Your units gain
   * 'When I die, create a Robot 3.' until regroup" (Reforge the Dead).
   *
   * A REFERENCE, not a copy: `card`/`via`/`index` address the ability in the
   * registry, so the grant is plain serializable data and replays identically.
   * The granting card normally parks the granted ability in its own
   * `abilities` list, where nothing else can fire it — a spell is never a unit
   * in play, so fireEvent's scan never reaches it except through this grant.
   */
  grantText(target: Entity, g: import('./types.ts').GrantedText): void {
    (target.granted ??= []).push({ ...g, at: this.stampNow() });   // CR 712.2
    this.ev('statChanged', `${target.card} gains "${g.text}" until regroup (${g.from}).`,
      { unit: target.id, granted: g.text });
  }

  /** "You gain N life" — the plain primitive (Prismatic Observer) and the
   * engine half of {Blessed}. Life gain is never lethal, so unlike loseLife
   * it has no state check to run. */
  gainLife(seat: Seat, n: number, why: string): void {
    if (n <= 0) return;
    // CR 708.10, in printed order. The LOCK is absolute ("can't change" — Suspend),
    // so it is asked before any card is offered the replacement: there is
    // nothing left to replace once the gain cannot happen at all.
    if (this.lifeLocked(seat)) {
      this.ev('info',
        `${this.pname(seat)}'s life total can't change during this battle — the ${n} life `
        + `(${why}) is not gained.`,
        { seat, n, why, locked: true });
      return;
    }
    if (this.replaceLifeGain(seat, n, why)) return;
    // CR 112.3: the two AMOUNT families, after the substitution
    // above and before anything is committed. Deliberately AFTER
    // `replaceLifeGain`: Nullbringer turns a gain into a LOSS, and that loss is
    // a fresh life change that `loseLife` prices on its own — pricing here too
    // would double-count it. Every life change that actually lands is scaled
    // exactly once, which is what retires the old doubling triggers' `why`
    // guard.
    n = this.lifeAmount('lifeGain', seat, n, why);
    const p = this.player(seat);
    p.life += n;
    // per-battle life-GAIN ledger, the exact mirror of loseLife's `lifeLost`
    // (Life Channel's "X is the life you've gained in this battle", Riftspawn
    // Remnant's "lost OR gained"). Like lifeLost it counts only inside a
    // battle: battleCounters are wiped at the start of every battle phase.
    if (this.s.battle) this.bumpBattleCounter(this.s.battle.region, `lifeGained:${seat}`, n);
    const ev = this.ev('lifeGained', `${p.name} gains ${n} life (${why}) → ${p.life}.`,
      { seat, n, why, ...(this.s.battle ? { region: this.s.battle.region } : {}) });
    this.fireEvent('lifeGained', ev);
  }

  /**
   * CR 802.22a {Blessed}: "Damage dealt by a blessed source causes its controller to
   * gain that much life." It is lifelink, and it is SIMULTANEOUS — Caleb
   * 2025-03-18: "blessed gain and damage happen on the same game state check",
   * "(similar to lifelink in mtg)", and yes to "if it would deal lethal damage
   * to you, do you heal before you die".
   *
   * So this is NOT a trigger and never goes on the stack: every caller commits
   * the gain in the same breath as the damage and, crucially, BEFORE the
   * lethal check — loseLife() ends the game the moment life hits 0, so a
   * blessed source that damages its own controller must heal them first or it
   * kills them with its own text. Applies to ALL damage, combat or effect.
   */
  blessedGain(controller: Seat, n: number, sourceName: string): void {
    this.gainLife(controller, n, `${sourceName} is Blessed`);
  }

  /** `extra` (CR 608.9a) is stamped onto the emitted 'lifeLost' — combat damage
   * uses it to carry `hits`, the per-column breakdown of an aggregated loss.
   * It is never read here; it is data for whoever hears the event. */
  loseLife(seat: Seat, n: number, why: string, extra?: Record<string, unknown>): void {
    // CR 708.10: "Target player's life total CAN'T CHANGE during this battle"
    // (Suspend) is not "can't be gained" — it locks both directions, so a
    // locked player cannot be burned out, cannot take rot damage to the face
    // and cannot be killed by {Lethal} (killPlayer routes through here).
    // Conceding is not a life change and still ends the game (E.concede).
    if (n > 0 && this.lifeLocked(seat)) {
      this.ev('info',
        `${this.pname(seat)}'s life total can't change during this battle — the ${n} life `
        + `(${why}) is not lost.`,
        { seat, n, why, locked: true });
      return;
    }
    // CR 708.6b: the two AMOUNT families, before the total moves and therefore
    // before the lethal check below. THAT ORDERING IS THE FIX: the doubling
    // used to be a trigger that dealt a second helping AFTER the first landed,
    // so a loss that was already lethal ended the game before the doubling
    // resolved — the multiplied number never appeared anywhere.
    n = this.lifeAmount('lifeLoss', seat, n, why);
    const p = this.player(seat);
    p.life -= n;
    // per-battle life-loss ledger (CR 505.6 battle counters; read by e.g. Soul Siphon)
    if (this.s.battle) this.bumpBattleCounter(this.s.battle.region, `lifeLost:${seat}`, n);
    const ev = this.ev('lifeLost', `${p.name} loses ${n} life (${why}) → ${p.life}.`,
      { seat, n, why, ...(this.s.battle ? { region: this.s.battle.region } : {}), ...(extra ?? {}) });
    this.fireEvent('lifeLost', ev);   // "when a player loses life" triggers (region-scoped in battle, CR 101.6)
    if (p.life <= 0 && this.s.winner === null) {
      this.s.winner = other(seat);
      this.s.phase = 'gameover';
      this.s.resolving = null;   // nothing is resolving any more — the game is over
      this.ev('gameOver', `*** ${this.pname(other(seat))} wins! ***`, { winner: other(seat) });
      throw new GameEnded();
    }
  }

  /** CR 104.4: end the game with `seat` as the loser — the concede path. Shares
   * loseLife's ending exactly (winner, phase, event, GameEnded) so nothing
   * downstream has to tell the two apart. */
  concede(seat: Seat): void {
    if (this.s.winner !== null) return;
    this.s.winner = other(seat);
    this.s.phase = 'gameover';
    this.s.resolving = null;   // nothing is resolving any more
    this.ev('gameOver', `*** ${this.pname(other(seat))} wins — ${this.pname(seat)} conceded. ***`,
      { winner: other(seat), conceded: seat });
    throw new GameEnded();
  }

  /**
   * CR 802.24a {Lethal}: "Any combat damage from a lethal unit will kill a player."
   * A kill, not damage — no amount is involved, so it is expressed as losing
   * exactly the life that is left (loseLife then runs the normal lethal check
   * and ends the game). Idempotent once the game is over.
   */
  killPlayer(seat: Seat, why: string): void {
    const p = this.player(seat);
    if (p.life <= 0 || this.s.winner !== null) return;
    this.ev('info', `${why} — ${p.name} is killed outright.`, { seat, why });
    this.loseLife(seat, p.life, why);
  }

  /**
   * The engine's second (and last) replacement hook (CR 608.8a, Blightsea Polyp):
   * a column is about to deal `amount` combat damage to `seat`. Same shape and
   * same anchoring as replaceRotDamage — units in play and augment mods (whose
   * hook reads from their HOST) — but region-scoped instead of seat-scoped:
   * the printed text says "columns" without an owner, so every holder IN THIS
   * REGION is offered the replacement and the card decides whose columns it
   * cares about.
   *
   * CR 708.4, the chain: every holder is offered the hit AS THE ONES BEFORE IT
   * LEFT IT, and applies at most once. A holder that soaks the whole hit leaves
   * nothing for the next one to match (two Oorblaks, no Piercing: one takes all
   * of it, the other takes 0 — the owner, 2026-10-16). A {Piercing} excess an
   * Oorblak lets through is still combat damage that would be dealt to the
   * player, so the NEXT Oorblak, which has not applied, takes it — the owner,
   * 2026-10-16: "it's all combat damage, and that damage is still considered
   * combat damage, so it'd go to the second one". Order is entity id; it
   * decides WHICH Oorblak soaks (and dies), so THE DAMAGED PLAYER CHOOSES
   * (CR 708.4a; Caleb: "you the player control how they stack"): whenever two
   * or more holders on different units would each take some of the hit, the
   * player is asked which takes it first — from the combat sub-step's seam
   * (`orderSeamRun`), and again for the next one if a {Piercing} excess is
   * left for it. One holder, or two that would take nothing, ask nothing.
   *
   * CR 608.8c, TWO PASSES. A hit is first offered as damage that WOULD be
   * dealt to the player (`stage: 'redirect'`: Oorblak), and only what every
   * redirect let through is then offered as damage being DEALT to the player
   * (`stage: 'dealt'`: Blightsea Polyp's "as 1 rot"). The owner, 2026-10-16:
   * "The column doesn't even get to deal damage to the player. It gets
   * redirected to the Oorblak instead. There's no way for it to add rot
   * (unless piercing is added into the mix)". Not a choice: a redirect always
   * comes first. The second pass keeps timestamp order — its holders (Polyps)
   * all do the same thing to the same player, so their order changes nothing.
   */
  private replaceCombatDamage(seat: Seat, amount: number,
    info: { attacker: Seat; region: number; attrs: Set<string>; pure: boolean }): number {
    const holders = this.anchored((h, a) =>
      this.donates(h, a, 'replaceCombatDamageToPlayer')          // CR 710.7: off the FACES
      && a.region === info.region
      && !this.textStripped(h, a));                         // CR 712.1a (full projection)
    holders.sort((a, z) => a.holder.id - z.holder.id);
    const donors = this.donorFaces(holders, 'replaceCombatDamageToPlayer');
    const applied = new Set<number>();
    let left = amount;
    // what donor i lets through of `left`, offered on engine `g` — this one for
    // real, or a throwaway copy of the world for a dry run (`wouldTake`)
    const offer = (g: E, i: number, stage: 'redirect' | 'dealt'): number => {
      const { def, anchor } = donors[i]!;
      const r = def.replaceCombatDamageToPlayer!(g, g.entity(anchor.id) ?? anchor, seat, left,
        { ...info, stage });
      // the return widened from all-or-nothing to a NUMBER — the damage
      // LET THROUGH — so a card can absorb part of a hit and pass the rest on.
      // `true`/`false` keep their old meaning (all / none), which is what makes
      // this a widening rather than a break: Blightsea Polyp still returns true.
      return r === true ? 0 : r === false ? left : Math.max(0, Math.min(left, r));
    };
    // CR 708.4a: would donor i take any of what is left? Asked of a COPY of the
    // world, because a hook does whatever it does (Oorblak takes the damage)
    // and the question has to be answered before anything is done
    const wouldTake = (i: number): boolean => offer(new E(structuredClone(this.s)), i, 'redirect') < left;
    const commit = (i: number, stage: 'redirect' | 'dealt'): boolean => {
      const through = offer(this, i, stage);
      if (through === left) return false;                       // this holder declined
      applied.add(i);
      const face = donors[i]!.face;
      this.ev('info',
        `${face} replaces ${left - through} of the ${left} combat damage to ` +
        `${this.pname(seat)} (the damage still counts as having been dealt).`,
        { seat, amount: left - through, by: face });
      left = through;
      return true;
    };
    // pass 1, the redirects — re-asked after each one, because a {Piercing}
    // excess is a new "would be dealt to you" for the ones that have not applied
    const declined = new Set<number>();
    const firstPerUnit = (ids: number[]): number[] => ids.filter((i, k) =>
      ids.findIndex(j => donors[j]!.anchor.id === donors[i]!.anchor.id) === k);
    while (left > 0) {
      const open = donors.map((_, i) => i).filter(i => !applied.has(i) && !declined.has(i));
      // one choice per unit: two copies of the text on one body are one choice.
      // Only where two units could each take some is anything dry-run at all —
      // otherwise this is the plain CR 708.4 chain, in timestamp order.
      const byUnit = firstPerUnit(open).length >= 2 ? firstPerUnit(open.filter(wouldTake)) : open.slice(0, 1);
      if (!byUnit.length) break;
      let pick = byUnit[0]!;
      if (byUnit.length >= 2) {
        const faces = [...new Set(byUnit.map(i => donors[i]!.face))];
        const got = this.askReplacement(seat,
          (faces.length === 1
            ? `Which ${faces[0]} takes the ${left} combat damage first?`
            : `Which takes the ${left} combat damage first — ${faces.join(' or ')}?`)
          + (info.attrs.has('Piercing')
            ? ' (it is Piercing: what it does not take goes on to the next one)' : ''),
          byUnit.map(i => ({ label: this.replacerLabel(donors[i]!.face, donors[i]!.anchor),
            card: donors[i]!.face, unit: donors[i]!.anchor.id, pick: i })));
        if (got !== null) pick = got;
      }
      if (commit(pick, 'redirect')) declined.clear();
      else declined.add(pick);    // not now — but perhaps once another has applied
    }
    // pass 2, damage being dealt to the player — the CR 708.4 chain, in timestamp order
    for (let changed = true; changed && left > 0;) {
      changed = false;
      for (let i = 0; i < donors.length && left > 0; i++) {
        if (applied.has(i)) continue;
        if (commit(i, 'dealt')) { changed = true; break; }
      }
    }
    return left;
  }

  /** a replacement holder as a choice names it: the card, and the unit it acts
   * from when that is another unit (an [Augment] mod reads from its host) */
  private replacerLabel(face: CardName, anchor: Entity): string {
    const on = this.faceName(anchor);
    return on === face ? face : `${face} (on ${on})`;
  }

  /**
   * CR 708.4a — ask `seat` which replacement effect applies NEXT, when two or
   * more apply to one event and the order changes the outcome. Caleb Gannon,
   * rules-questions 2025-11-25: "its a replacement effect so it just takes one
   * thing and replaces it with another (you the player control how they
   * stack)"; the owner, 2026-10-16, chose to ask the player.
   *
   * Every choice names a unit, so the question is answered by clicking it on
   * the board (ui/boardpick.ts reads `value.unit`) or from the prompt bar.
   * Returns the chosen `pick`, or null where there is nowhere to ask — then the
   * caller keeps timestamp (entity id) order.
   *
   * Two places to ask from:
   *  · inside a resolving part (a spell or ability putting counters on a unit
   *    during battle) it is an ordinary `ctx.choose`: the part suspends, and
   *    replays with the answer — which is why no replacement may mutate before
   *    it has been ordered.
   *  · inside a SEAM — a combat-damage sub-step or the rot step, which run
   *    outside any part (`orderSeamRun`). The answer is read off
   *    `GameState.replaceOrders`; a missing one throws `OrderNeeded`, and the
   *    seam rewinds and suspends. The n-th question of a seam run is keyed
   *    `${seam}#${n}`: the seam re-runs from its start, so n is the same each
   *    time, and a saved game's `decide` replays into the same question.
   */
  private askReplacement(seat: Seat, prompt: string, picks: ReplacementPick[]): number | null {
    const dec: Omit<Decision, 'id'> & PartChoice['dec'] = {
      seat, kind: 'electricPath', prompt,
      options: picks.map(p => ({ label: p.label, card: p.card, value: { unit: p.unit, pick: p.pick } })),
    };
    if (this.partChoose) {
      const v = this.partChoose('replaceOrder', dec) as { pick?: unknown } | null;
      return typeof v?.pick === 'number' && picks.some(p => p.pick === v.pick) ? v.pick : null;
    }
    const seam = this.orderSeam;
    if (seam) {
      const key = `${seam.key}#${seam.asked++}`;
      const got = this.s.replaceOrders?.[key];
      if (typeof got === 'number' && picks.some(p => p.pick === got)) return got;
      throw new OrderNeeded(key, dec);
    }
    // nowhere to ask: in play every route that can raise this question runs
    // inside a part or a seam, so this is a direct engine call (a test, a
    // probe on a copy of the world) and timestamp order is the answer
    return null;
  }

  /**
   * CR 708.4a — run `body` (a combat-damage sub-step, the rot step) as a SEAM a
   * replacement-order question can be asked from.
   *
   * Neither runs inside a resolving part, so there is no `ctx.choose` to
   * suspend and replay. Instead the seam keeps a copy of the world as it
   * starts, and when `askReplacement` finds a question unanswered the seam
   * REWINDS to that copy — every event since dropped, every point of damage
   * undone — and suspends there. The question is asked over the board as it
   * stood before the damage, which is the board the question is about.
   * doDecide's 'replaceOrder' branch records the answer and runs the seam
   * again from the top; it finds the answer this time and goes on, perhaps to
   * the next question. The same from-scratch re-entry as the 'combatAssign'
   * question one step earlier, so nothing half-done is ever on the table and
   * the suspension carries no snapshot.
   *
   * The copy is only taken where a question is possible (the callers check
   * that two or more order-sensitive holders are about), so every other
   * combat and rot step runs exactly as it did.
   */
  private orderSeamRun(scope: 'combat' | 'rot', key: string, body: () => void): void {
    const snap = structuredClone(this.s);
    const evLen = this.events.length;
    const outer = this.orderSeam;
    this.orderSeam = { key, asked: 0 };
    try {
      body();
    } catch (sig) {
      if (!(sig instanceof OrderNeeded)) throw sig;
      this.orderSeam = outer;
      // carried FORWARD across the rewind, exactly as E.resumeResolve does:
      // the action latch, the decision-id high-water mark and the seat names
      // belong to the session, not to the damage
      const live = this.s;
      this.s = snap;
      this.s.actionCount = live.actionCount;
      this.s.decisionHigh = live.decisionHigh;
      live.players.forEach((p, i) => { const q = this.s.players[i]; if (q) q.name = p.name; });
      this.events.length = evLen;
      this.suspend({ type: 'replaceOrder', scope, seat: sig.dec.seat, key: sig.key }, sig.dec);
    } finally {
      this.orderSeam = outer;
    }
    // the seam is done: its answers are spent
    const orders = this.s.replaceOrders;
    if (orders) {
      for (const k of Object.keys(orders)) if (k.startsWith(`${key}#`)) delete orders[k];
      if (!Object.keys(orders).length) delete this.s.replaceOrders;
    }
  }


  // ── CR 708: THE REPLACEMENT-EFFECT LAYER ──────────────────────────────
  //
  // Owner, playtest report #75, verbatim:
  //
  //   "The only cards that should ever produce effects that go onto the stack
  //    are cards that say 'When' or 'Whenever' or have a ':' activated
  //    ability. All cards that say 'instead' or 'as' or 'if' shouldn't go onto
  //    the stack."
  //
  // Refined by him on 2026-08-23, and the refinement is the load-bearing half:
  // "cards that say instead, as or if AND DON'T MENTION TARGETS" never go on
  // the stack. A replacement that names a TARGET still uses the stack, because
  // choosing a target is public and respondable — which is why CR 109.5a (Beyond,
  // Codex Incarnate) is the correct shape and not an exception.
  //
  // Everything below is the "no target" side of that switch. None of it
  // queues a trigger, none of it opens a priority window, and none of it can
  // be negated by Containment Protocol or Nothyr — those negate stack items,
  // and there is no stack item to negate.
  //
  // TWO FAMILIES, and telling them apart is most of the work:
  //
  //   · `AmountMod` (see amountDelta above) — CONTINUOUS and SUMMED. It
  //     changes a number and nothing else.
  //   · the `replaceX` hooks below — they substitute or redirect the thing
  //     itself, and they CHAIN (CR 708.4): each applies to one event at most
  //     once, in turn, to the event as the ones before it left it.
  //
  // THE CHAIN. Caleb Gannon, rules-questions 2025-11-25, on Resonant against
  // Oorblak: "replacement effects don't work like triggers" … "its a
  // replacement effect so it just takes one thing and replaces it with another
  // (you the player control how they stack)" … "if you have two automatons" …
  // "1 token -> 2tokens -> 3 tokens" … "Damage unit -> controller -> unit" …
  // "the tldr is replacement effects only apply once onto an effect". The
  // owner, 2026-10-16: "Go with Caleb. ... But the chain should work in the way
  // he says". So no single holder "wins": every holder whose condition still
  // matches the event AS THE EARLIER ONES LEFT IT applies, once, and one that
  // has applied never applies again — which is what stops a loop, not a
  // first-one-consumes rule. Where the substitute is a different KIND of event
  // (rot damage → counters, a gain → a loss, a card step → a draw) no other
  // holder's condition matches it any more, so "only the first applies" falls
  // out of the chain rather than being a rule of its own. `chainReplacements`
  // is the loop for the hooks whose substitute is still the same kind of event.
  //
  // ORDER is the player's (CR 708.4a; Caleb: "you the player control how they
  // stack"; the owner, 2026-10-16: "Ask the player now"). Where the order
  // changes the outcome — two Counter Thieves (which keeps the counters), two
  // Oorblaks (which takes the hit), two Skittering Blights or a Blight beside
  // Beyond, Codex Incarnate (which replaces the rot) — the player the event
  // happens to is asked (`askReplacement`); everywhere else, and where there
  // is nowhere to ask, it is timestamp (entity id). Oorblak beside Blightsea
  // Polyp is NOT a choice: a redirect always comes before "as 1 rot" (CR
  // 608.8c, `replaceCombatDamage`). Not order-sensitive, so never asked:
  // Nullbringers, Worldbenders, Automatons (summed), Polyps among themselves,
  // and Cosmic Conspirators (each asks its own controller, who can reach any
  // kind from any order).
  //
  // Deliberately NO general "any event" framework, for the reason
  // replaceRotDamage's own comment already gives: one named hook per
  // replaceable quantity, so every replaceable thing in the engine is
  // greppable and nothing becomes replaceable by accident.

  /**
   * CR 708.4: run one event through a list of replacement donors as a CHAIN.
   *
   * `apply(donor, event)` returns the event as that donor replaces it, or
   * null when the donor's condition does not match the event AS IT NOW STANDS
   * (it has then not applied, and stays eligible). Repeatedly, the earliest
   * donor in `donors` order that has not applied yet and does apply is
   * applied — MTG 616.1f's "repeat, taking into account only the effects that
   * would now be applicable" — until none does. `donors` arrive in the order
   * the player chose where that was asked (`askReplacement`), else timestamp. Each donor applies at most once, so
   * the chain always ends, and with n donors it asks at most n² questions.
   */
  private chainReplacements<D, V>(donors: readonly D[], event: V, apply: (d: D, ev: V) => V | null): V {
    const applied = new Set<number>();
    let ev = event;
    for (;;) {
      let next: V | null = null;
      for (let i = 0; i < donors.length && next === null; i++) {
        if (applied.has(i)) continue;
        next = apply(donors[i]!, ev);
        if (next !== null) applied.add(i);
      }
      if (next === null) return ev;
      ev = next;
    }
  }

  /**
   * CR 708.10: is `seat`'s life total LOCKED right now? ("Target player's life
   * total can't change during this battle." — Suspend.)
   *
   * A battleCounter and not an `anchored()` radiator, for the bin-spell grant's reason: Suspend
   * is a SPELL. It resolves and goes to the bin, so there is nothing left in
   * play to radiate from, and what it grants is a fact about this battle —
   * which is exactly what battleCounters are. Region-KEYED gives CR 505.6's "this
   * battle = this region's battle" for free and stops round 1's lock leaking
   * into round 2; `startBattlePhase`'s existing wipe is the whole cleanup.
   *
   * It locks the total in BOTH directions, because "can't change" is not "can't
   * be lost": no gain, no loss, no rot damage to the face, no {Lethal} kill
   * (killPlayer routes through loseLife). Conceding is not a life change and is
   * unaffected — `E.concede` ends the game directly.
   */
  lifeLocked(seat: Seat): boolean {
    const b = this.s.battle;
    if (!b) return false;
    return this.battleCounter(b.region, `lifeLock:${seat}`) > 0;
  }
  /** CR 708.10: lock `seat`'s life total for the rest of this region's battle. */
  lockLife(seat: Seat, region: number): void {
    this.bumpBattleCounter(region, `lifeLock:${seat}`);
  }

  /**
   * CR 708.4a: `seat` is about to gain `n` life — may a card replace it?
   *
   * Nullbringer: "[Augment] If a player would gain life, they lose that much
   * life instead." Shaped on `replaceRotDamage` (first true consumes, ties by
   * entity id — the CR 708.4 chain, because the loss a Nullbringer puts in the
   * gain's place is not a gain, and no other Nullbringer's "would gain life"
   * matches it; the order changes nothing a player can see — radiating from
   * units in play and from augment mods whose hook reads from their HOST) but NOT seat-scoped: the printed subject is "a
   * PLAYER", unowned, so every holder in the region is asked and the card
   * decides whose gains it cares about — the same reasoning
   * `replaceCombatDamageToPlayer` uses for "columns".
   *
   * What changes versus the trigger this replaces is OBSERVABLE and is the
   * bug being reported: the gain never happens, so no `lifeGained` event is
   * fired, the life total never spikes through a threshold and back, and
   * nothing on the stack is created for anybody to respond to or negate.
   */
  private replaceLifeGain(seat: Seat, n: number, why: string): boolean {
    const holders = this.anchored((h, a) =>
      this.donates(h, a, 'replaceLifeGain')                     // CR 710.7: off the FACES
      // CR 101.6, by E.fireEvent's own rule: `gainLife` writes a region onto its
      // event only inside a battle, and fireEvent dispatches an event with no
      // region to EVERY listener. A life gain outside a battle is therefore
      // not a regional thing, and narrowing it here would quietly shrink a
      // card that used to be a `lifeGained` trigger.
      && (!this.s.battle || a.region === this.s.battle.region)
      && !this.textStripped(h, a));                       // CR 712.1a (full projection)
    holders.sort((a, z) => a.holder.id - z.holder.id);
    for (const { face, def, anchor } of this.donorFaces(holders, 'replaceLifeGain')) {
      if (def.replaceLifeGain!(this, anchor, seat, n, why)) {
        this.ev('info',
          `${face} replaces the ${n} life ${this.pname(seat)} would have gained.`,
          { seat, n, by: face, unit: anchor.id });
        return true;
      }
    }
    return false;
  }

  /**
   * CR 708.4a: `n` counters are about to be put on `target` — may a card redirect
   * them?
   *
   * Counter Thief: "[Augment] If one or more counters would be placed on one
   * or more units during battle, those counters are placed on me instead."
   * Returns the unit they should land on; `target` itself when nobody claims
   * them. A REDIRECT and never a multiplier — the counters land on exactly one
   * unit either way, which is what "instead" means.
   *
   * CR 708.4: the redirects CHAIN (`chainReplacements`). Counters a thief
   * redirects onto itself are still counters that "would be placed on one or
   * more units during battle", so a SECOND thief that has not applied yet
   * takes them from the first — and the first, having applied, never takes
   * them back. Two thieves: the counters end on the later one in the order,
   * not on the earlier one (which is what first-one-wins gave). No ping-pong:
   * each thief applies once. A hook that names the unit already receiving the
   * counters (or nobody) has not applied.
   *
   * `inReplaceCounters` is a re-entry latch for a hook that puts counters
   * itself while it is being asked. No hook does today — Counter Thief only
   * names a unit — and the chain, not the latch, is what stops two thieves.
   */
  private replaceCounters(target: Entity, n: number): Entity {
    if (this.inReplaceCounters) return target;
    let donors = this.counterDonors(target.region);
    this.inReplaceCounters = true;
    this.replacementDepth++;
    try {
      donors = this.orderCounterDonors(donors, target, n);
      return this.chainReplacements(donors, target, ({ face, def, anchor }, now) => {
        const to = def.replaceCounters!(this, anchor, now, n);
        if (!to || to.id === now.id || !this.entity(to.id)) return null;
        this.ev('info',
          `${face}: the ${Math.abs(n)} counter(s) for ${now.card} are placed on `
          + `${to.card} instead.`,
          { unit: to.id, from: now.id, n, by: face });
        return to;
      });
    } finally { this.inReplaceCounters = false; this.replacementDepth--; }
  }

  /** CR 708.4a: the counter redirects radiating in `region`, one per face, in
   * timestamp (entity id) order */
  private counterDonors(region: number): { face: CardName; def: CardBehavior; anchor: Entity }[] {
    const holders = this.anchored((h, a) =>
      this.donates(h, a, 'replaceCounters')                   // CR 710.7: off the FACES
      && a.region === region
      && !this.textStripped(h, a));                       // CR 712.1a (full projection)
    holders.sort((a, z) => a.holder.id - z.holder.id);
    return this.donorFaces(holders, 'replaceCounters');
  }

  /**
   * CR 708.4a — two or more counter redirects: the player chooses where the
   * counters end up, when the order decides it.
   *
   * With redirects chaining (each applies once, to the placement as the ones
   * before it left it), the counters end on whichever applies LAST — so the
   * question is put the way a player thinks of it: "which unit keeps them?".
   * A `replaceCounters` hook only NAMES a unit (it mutates nothing), so every
   * order can be tried here without touching the board, and the player is
   * asked only when two orders end on different units. The chosen unit's first
   * order (in the order tried, which starts from timestamp order) is the one
   * the chain then runs, for real, with its log lines.
   *
   * WHO: the controller of the unit the counters were going to be placed on —
   * the affected object, as in MTG 616.1. The redirects need not be theirs
   * (Counter Thief says "one or more units", anyone's), and that is the reading
   * this takes; it is reported as such.
   *
   * More than five holders: 120 orders is the cap; past it the order stays
   * timestamp and nothing is asked (the pool has one card with this hook).
   */
  private orderCounterDonors<D extends { face: CardName; def: CardBehavior; anchor: Entity }>(
    donors: D[], target: Entity, n: number): D[] {
    if (donors.length < 2 || donors.length > 5) return donors;
    const endOf = (order: D[]): Entity => this.chainReplacements(order, target, ({ def, anchor }, now) => {
      const to = def.replaceCounters!(this, anchor, now, n);
      return !to || to.id === now.id || !this.entity(to.id) ? null : to;
    });
    const ends = new Map<EntityId, D[]>();
    const walk = (done: D[], rest: D[]): void => {
      if (!rest.length) {
        const end = endOf(done);
        if (!ends.has(end.id)) ends.set(end.id, done);
        return;
      }
      rest.forEach((d, i) => walk([...done, d], rest.filter((_, j) => j !== i)));
    };
    walk([], donors);
    if (ends.size < 2) return donors;
    const keepers = [...ends.keys()];
    const faces = [...new Set(donors.map(d => d.face))];
    const who = faces.length === 1 ? `${faces[0]}: which` : 'Which';
    const got = this.askReplacement(target.controller,
      `${who} unit keeps the ${Math.abs(n)} counter(s) meant for ${this.faceName(target)}?`,
      keepers.map((id, k) => {
        const u = this.entity(id)!;
        return { label: u.id === target.id ? `${this.faceName(u)} (where they were going)` : this.faceName(u),
          card: this.faceName(u), unit: id, pick: k };
      }));
    return got === null ? donors : ends.get(keepers[got]!)!;
  }

  // ── CR 708.9: token creation, and the BATCH ─────────────────────────────
  //
  // Report #64 (GETD, 2026-08-22): "Biotoxicity didn't give me the choice of
  // what kinds of tokens I wanted even though I had Cosmic Conspirator." Two
  // separate defects, and both need a seam a trigger cannot provide:
  //
  //  1. The choice has to be raised BEFORE anything is created. The old
  //     trigger really created the Robot, fired a `spawned` for it, asked, and
  //     then erased it — so a token that "was never created" was on the board
  //     and in the event stream.
  //  2. Biotoxicity creates THREE tokens in one resolution, so the question
  //     has to be asked once per token. A `spawned` trigger fires per spawn,
  //     which sounds like the same thing and is not: spell tokens fire no
  //     dispatchable event at all, so two of Biotoxicity's three creations
  //     were invisible to it.
  //
  // And report #60 needs the other end of the same seam: "Automaton of
  // Abundance fires per spawn so N identical tokens yield N copies instead of
  // one per unique." "Each unique token you created" is a property of the
  // whole creation, so there has to be a whole creation to look at.
  //
  // THE BATCH IS ONE RESOLVING PART, which is the unit effect damage already
  // has (CR 112.8: "One resolution of one effect, one batch"). `resolveParts` opens
  // one around `def.run` and settles it when the part finishes; a creation
  // with no part open (engine-internal, a test's direct call) is its own batch
  // of one, so nothing is ever left unsettled. A part that SUSPENDS on a
  // decision discards its batch unsettled, because the engine rolls the world
  // back to the part boundary and replays it — settling would pay the
  // batch out twice.

  /** CR 708.9: the open token-creation batch, or null outside a resolving part. */
  private tokenBatch: TokenRequest[] | null = null;
  /**
   * CR 802.21b: the OPEN kill diff — the units alive when the part currently
   * resolving began, or null when no kill-scoped source is resolving.
   *
   * Same lifetime and same rollback story as `tokenBatch` directly above: it
   * is opened at the part boundary and discarded on a suspension, because a suspension
   * rolls the world back to that boundary and replays the part, which retakes
   * the snapshot.
   *
   * `reaps` is the flag that tells `dealEffectDamageAll` the diff will pay
   * {Reaping} for it, so a damage kill is never paid twice. It is narrower
   * than "a diff is open" on purpose: a diff opened for {Afflicting} alone
   * will NOT pay a {Reaping} draw, so the damage site must still do it.
   */
  private killWatch: { before: Map<EntityId, Seat>; reaps: boolean } | null = null;
  /** CR 708.4: a per-token replacement is already performing its substitute, so
   *  the substitute must not be offered for replacement again. */
  private substitutingToken = false;
  /** CR 708.4: a BATCH replacement is creating its extras. They are not part of
   *  the batch that produced them — "none applies to itself" — and without
   *  this latch a batch of one extra would ask the same holder again forever. */
  private inTokenBatchSettle = false;

  /**
   * raise a decision from inside engine code, the way `E.glimpse` does.
   *
   * `partChoose` is non-null only inside a resolving part, which is where
   * token creation almost always happens. Outside one there is nothing to hang
   * a decision on and no way to ask — so this returns null and the caller
   * takes the printed, deterministic branch and SAYS SO, exactly as glimpse's
   * "no decision window — the top card is cached by default" does. A silent
   * default is the thing that produces playtest reports.
   */
  askInResolution(tag: string, dec: PartChoice['dec']): unknown | null {
    const choose = this.partChoose;
    return choose ? choose(tag, dec) : null;
  }

  /**
   * CR 708.3: one token is about to be created — may a card substitute it?
   *
   * Cosmic Conspirator: "If you would create a Robot, Poison, Crystal or
   * Fireball, you may instead create a token of any of these types."
   *
   * CR 708.4: the substitutions CHAIN (`chainReplacements`). A Fireball one
   * Conspirator made of a Robot is still a token "you would create", so a
   * second Conspirator that has not applied yet is offered THAT, and may swap
   * it again; neither is ever offered the same creation twice. A hook that
   * returns null has not applied (not its controller's creation, not one of
   * its kinds, nowhere to ask); one that returns a request — the same one,
   * when the player kept it — has applied.
   *
   * The hook may ask a question (`askInResolution`), and a
   * question raised here suspends the whole resolving part and replays it —
   * which is correct and is why the substitution must happen before ANY state
   * is mutated: the rollback would otherwise undo a token that was already on
   * the board.
   */
  private replaceTokenCreation(req: TokenRequest): TokenRequest {
    const holders = this.anchored((h, a) =>
      this.donates(h, a, 'replaceTokenCreation')              // CR 710.7: off the FACES
      && a.region === req.region
      && !this.textStripped(h, a));                       // CR 712.1a (full projection)
    holders.sort((a, z) => a.holder.id - z.holder.id);
    const donors = this.donorFaces(holders, 'replaceTokenCreation');
    this.replacementDepth++;
    try {
      return this.chainReplacements(donors, req, ({ face, def, anchor }, now) => {
        const sub = def.replaceTokenCreation!(this, anchor, now);
        if (!sub) return null;
        if (sub.name === now.name && sub.form === now.form) return now;   // applied, and kept it
        this.ev('info',
          `${face}: a ${now.name} ${now.x} is created as a ${sub.name} ${sub.x} instead.`,
          { by: face, was: now.name, now: sub.name, x: sub.x, seat: now.seat });
        return sub;
      });
    } finally { this.replacementDepth--; }
  }

  /**
   * CR 708.9: record a token that was just created into the open batch — or, with
   * no batch open, settle it as a batch of one.
   */
  private noteTokenCreated(req: TokenRequest): void {
    if (this.inTokenBatchSettle) return;         // an extra is not part of its own batch
    if (this.tokenBatch) { this.tokenBatch.push(req); return; }
    this.settleTokenBatch([req]);
  }

  /**
   * CR 708.9: one creation batch has finished — may a card add to it?
   *
   * Automaton of Abundance: "[Augment] If you would create one or more unit
   * tokens, instead create those tokens plus an additional copy of each unique
   * token you created."
   *
   * EVERY donor applies, each ONCE, in entity-id order, and each is handed the
   * batch as the donors before it left it — CR 708.4, Caleb (rules-questions
   * 2025-11-25) on two Automatons: "1 token -> 2tokens -> 3 tokens", "the tldr
   * is replacement effects only apply once onto an effect". So a replacement
   * never re-applies to what it produced, but a DIFFERENT one that has not
   * applied yet still sees the replaced event. This used to be first-non-null
   * consumes, and two Automatons gave one extra token instead of two.
   *
   * The extras are created only after every donor has answered, so no donor
   * ever observes a half-paid batch, and they are created in the order the
   * donors produced them.
   *
   * The extras are created INLINE, in the same resolution, with nothing on the
   * stack in between and no priority window — the CR 802.16i test for "part of
   * resolution, not a trigger". They are NOT themselves batched
   * (`this.tokenBatch` is parked for the duration), which is what "none
   * applies to itself" means here and is why the module-level `aoaCopying`
   * flag it replaces is gone.
   */
  private settleTokenBatch(batch: TokenRequest[]): void {
    if (!batch.length) return;
    const holders = this.anchored((h, a) =>
      this.donates(h, a, 'replaceTokenBatch')                 // CR 710.7: off the FACES
      && a.region === batch[0]!.region
      && !this.textStripped(h, a));                       // CR 712.1a (full projection)
    if (!holders.length || this.inTokenBatchSettle) return;
    holders.sort((a, z) => a.holder.id - z.holder.id);
    const donors = this.donorFaces(holders, 'replaceTokenBatch');
    this.inTokenBatchSettle = true;
    this.replacementDepth++;
    try {
      let replaced: readonly TokenRequest[] = batch;   // the event as replaced so far
      const toCreate: TokenRequest[] = [];
      for (const { face, def, anchor } of donors) {
        const extra = def.replaceTokenBatch!(this, anchor, replaced);
        if (!extra || !extra.length) continue;
        this.ev('info',
          `${face}: the creation is replaced — ${extra.length} more token(s) `
          + `(${extra.map(r => r.name).join(', ')}) are created with it.`,
          { by: face, unit: anchor.id, n: extra.length });
        replaced = [...replaced, ...extra];       // CR 708.4: the next donor sees this
        toCreate.push(...extra);                  // …and this donor never applies again
      }
      for (const r of toCreate) this.createToken(r);
    } finally { this.inTokenBatchSettle = false; this.replacementDepth--; }
  }

  /**
   * create one token from a `TokenRequest`. The single place the two
   * creation primitives are chosen between, so a replacement that swaps a unit
   * token for a spell token (Robot → Fireball) needs no caller to know.
   */
  createToken(req: TokenRequest): Entity {
    return req.form === 'unit'
      ? this.spawnUnit(req.seat, req.name, req.region, {
        token: true,
        ...(req.x ? { counters: req.x } : {}),
        // CR 304.14: the stats the original creation set travel with the copy
        ...(req.stats ? { tokenStats: [req.stats[0], req.stats[1]] as [number, number] } : {}),
      })
      : this.createSpellToken(req.seat, req.name, req.x, req.region);
  }

  /**
   * CR 112.11: THE choke point for damage about to be dealt to a UNIT. Returns the
   * damage LET THROUGH — 0 means nothing was dealt at all.
   *
   * Report #72 (GETD, 2026-08-22): "Phytochemical Protection is entirely non
   * functional." It was, and it could not be written: the two places unit
   * damage is committed (`dealEffectDamageAll`'s per-recipient loop and
   * `combatSubStep`'s per-unit commit) consulted nothing, and the two hooks
   * that did exist — `replaceRotDamage` and `replaceCombatDamageToPlayer` —
   * are both damage to a PLAYER. This is the missing third.
   *
   * ── PREVENTION IS NOT REPLACEMENT, and the difference is the card ──
   *
   * The replacement hooks (CR 112.12) do not unmake the damage — the old rot
   * ruling's words: "Replacing the damage does
   * NOT unmake it: Caleb ruled (2024-10-24) the damage still counts as having
   * been DEALT, so {Lethal} still kills through it". Prevention is the other
   * thing. RAQ "[Solved] Poisonous vs 'Whenever I am dealt damage' vs
   * Phytochemical Protection", verbatim:
   *
   *   Q: "Does Poisonous bypass Phytochemical Protection?"
   *   A: "No it doesn't. As said above, damage is dealt in the form of -1/-1
   *       counters, which means if there is not damage being dealt, then no
   *       counters are placed."
   *   …"Then Sporebloom Siren deals 2 damage to Jollyglop, but damage is
   *      prevented. Jollyglop doesn't trigger, won't get -2/-2 from Poisonous
   *      but will receive +2/+2 counters from Phytochemical Protection."
   *
   * So a fully prevented hit produces NO damage event (nothing "is dealt
   * damage"), no Poisonous counters, no {Deadly} kill, no {Resonant} rider and
   * no {Blessed} gain — every one of those is keyed on damage being dealt.
   * That is why this returns a number the callers must branch on rather than a
   * flag they may ignore.
   *
   * ── WHAT IT DOES NOT TOUCH: assignment ──
   *
   * RAQ "[Solved] Excessive Combat Damage & interaction with Piercing, Deadly
   * and Phytochemical Protection", on a 0/5 shielded Awoken Tomb in front of a
   * 5/6 Bubb: "You must assign atleast 5 damage to Awoken before you can start
   * assigning damage to Bubb in the back. Awoken will get atleast +5/+5
   * counters, but won't make 5/5 unit." With Deadly instead: "Atleast 1 dmg to
   * Awoken (gets +1/+1, won't create 1/1 unit), rest of the damage can go to
   * Bubb". With Piercing: "Atleast 5 damage to Awoken (gets atleast +5/+5,
   * won't create 5/5), atleast 6 damage to Bubb, rest can go to Opponent HP."
   *
   * The shield therefore changes NOTHING about lethal assignment, Piercing
   * excess or Deadly's 1-point floor — those are planned against the unit's
   * real toughness as if it were unprotected. This runs at COMMIT, after all
   * of that planning, which is exactly where it has to be.
   *
   * ── THE SHAPE, and why it is this shape ──
   *
   * Numeric (damage let through) rather than boolean, so a partial preventer
   * fits without a second seam — and so it matches the shape
   * `replaceCombatDamageToPlayer` was widened to in the same ruling, which is
   * what Oorblak's parked Piercing-excess half needs. `info` carries the
   * source's live attributes and CR 802.25b's {Pure} flag for the same reason: a hook
   * that has to tell a Piercing hit from a plain overkill cannot do it from
   * `{ attacker, region }` alone.
   */
  preventUnitDamage(u: Entity, amount: number, info: UnitDamageInfo): number {
    if (amount <= 0) return amount;
    if (!u.damageShield) return amount;
    u.shieldPending = (u.shieldPending ?? 0) + amount;
    this.ev('info',
      `${u.damageShield} prevents all ${amount} damage to ${u.card}`
      + ` (from ${info.source}) — no damage is dealt.`,
      { unit: u.id, prevented: amount, by: u.damageShield });
    return 0;
  }

  /**
   * pay out "Put a +1/+1 counter on it for each damage prevented this
   * way", once the commit loop that prevented the damage has finished.
   *
   * Deferred rather than paid inside `preventUnitDamage` because `addCounters`
   * runs `checkDeaths`: paying on the spot would resolve a death in the middle
   * of a batch that is simultaneous (CR 112.8). Called at the end of BOTH commit
   * loops; calling it with nothing pending is free.
   */
  settleDamagePrevention(): void {
    for (const u of Object.values(this.s.entities)) {
      const n = u.shieldPending ?? 0;
      if (n <= 0) { delete u.shieldPending; continue; }
      delete u.shieldPending;
      if (!this.entity(u.id)) continue;
      this.ev('info',
        `${u.damageShield ?? 'The shield'}: ${u.card} gets ${n} +1/+1 counter(s)`
        + ' — one for each damage prevented.',
        { unit: u.id, n });
      // CR 708.8b: the shield's caster puts these, not whoever dealt the damage
      // (on the effect-damage path `partActor` is the DEALER's effect) and not
      // nobody (combat damage has no resolving part at all).
      this.addCounters(u, n, u.damageShieldBy);
    }
  }

  /**
   * Effect (non-combat) damage, ONE recipient. Sugar for the batch below —
   * an effect that damages one thing deals a batch of one, so `total` on the
   * event equals `n` and every reader can be written against the batch.
   */
  dealEffectDamage(ctx: EffectCtx, target: ResolvedTarget, n: number): void {
    this.dealEffectDamageAll(ctx, [{ target, n }]);
  }

  /**
   * CR 112.8: ALL of one effect's damage, dealt at once.
   *
   * Playtest round 15 (VEAV): "Channel Through caused Restitution to make 2
   * triggers, but it should have done just one trigger", and "I only made 2
   * units from my Channel Through, but it dealt 6 damage to my allies and 6 to
   * my opponent's units, so I should have made 12 units". Both are the same
   * defect: the engine had no notion of "the damage an effect dealt", only a
   * pile of independent dealEffectDamage calls. Channel Through committed its
   * distributed damage in 1-point increments, so a unit that took two of those
   * points was dealt damage TWICE — two damage events, two "when I am dealt
   * damage" triggers — and Ember of Life's "that many" only ever saw one of
   * the fragments.
   *
   * So the unit of effect damage is the BATCH:
   *   - hits are COALESCED per recipient: a recipient named twice is dealt
   *     one total, and hears about it once;
   *   - every damage event in the batch carries `total`, the whole batch's
   *     damage, for the texts that ask what the EFFECT dealt rather than what
   *     one victim took (Ember of Life);
   *   - deaths are checked once, after all of it is marked, which is what
   *     "simultaneous" means for two units that kill each other.
   *
   * The line is the SOURCE, not the spell: Caleb 2025-03-20, on Meteor Shower
   * making several Rockfalls — "each copy of Rockfall is a separate source, so
   * Ember of Life triggers separately for each copy rather than combining them
   * into one bigger trigger." One resolution of one effect, one batch.
   *
   * Handles Reaping (kill → draw), Electric (CR 802.17: excess beyond lethal passes
   * along a controller-chosen, non-overlapping adjacent path, planned fully
   * before any damage commits, and no formation changes during distribution)
   * and {Piercing} (excess beyond lethal goes to the victim's controller —
   * see `poolToKill` below — as far as the dealing player elects
   * (`pierceKeep`, CR 802.16j). Both are planned against what the victim will
   * REALLY have taken once the batch commits — damage earlier hits in this
   * same batch already assigned included — rather than against a stale board.
   */
  dealEffectDamageAll(ctx: EffectCtx, hits: { target: ResolvedTarget; n: number }[]): void {
    /**
     * CARD-TODO #16 — AN EMPTY BATCH IS THE ONE SILENCE THAT IS ALWAYS A BUG.
     *
     * Every "I deal N damage to each opponent / each enemy unit" card in the
     * pool builds a hit list and hands it over. With no opponent PRESENT in the
     * region (CR 601.4d) or no enemy unit on the board that list is empty, and until
     * this line existed the batch returned at `if (!order.length) return`
     * having emitted nothing at all: the card resolved, the mana was spent and
     * the log was blank. Three carriers (Flzzz, Restitution, Vroot) were
     * patched card-side by the CARD-TODO #3 sweep; saying it HERE covers every
     * carrier at once and means no card has to know.
     *
     * ── WHY `hits.length`, AND NOT `order.length` ──
     *
     * `hits` is the card's own list of "who I am damaging". Empty means the
     * card found nobody to name — the situation above, and the only one that
     * is unconditionally worth a line. Two shapes reach the `!order.length`
     * return further down and must NOT be caught here:
     *
     *  · a batch whose hits were all `n <= 0` — a card that deliberately
     *    computed zero damage. `hits` is non-empty, so it never reaches this
     *    guard: the planning loop's `if (n <= 0) continue` drops it silently,
     *    which is right, because the card decided the amount and can say so
     *    itself if it is worth saying.
     *  · a fully PREVENTED batch (CR 112.11). Prevention runs AFTER `!order.length`,
     *    in the `received` loop, so a prevented batch always has a non-empty
     *    `order` and cannot arrive here at all. `preventUnitDamage` already
     *    logs the prevention, and CR 112.11 says the damage was never dealt.
     *
     * Also deliberately NOT caught: a non-empty `hits` whose every target has
     * left play between cast and resolution. That is the "your target is
     * gone" case (CR 704.6); the cards that can reach it announce it themselves (see
     * `test/85-silent-branches.test.ts` §5), and folding it in here would put
     * two different sentences behind one guard.
     */
    if (!hits.length) {
      this.ev('info',
        `${ctx.sourceName}: there is nothing to damage — no damage is dealt.`,
        { source: ctx.sourceName, controller: ctx.controller, region: ctx.region, empty: true });
      return;
    }
    /**
     * CR 802.1: the source's LIVE attributes, not its printed ones.
     *
     * This line used to read `this.card(ctx.sourceName)?.attrs`, i.e. the
     * printed card and nothing else, and that was a real bug with a long tail:
     * COMBAT damage has always read the live entity (colAttrs → ownAttrs →
     * staticsFor), so a unit that GAINED {Powerful} hit twice as hard with its
     * body and exactly as hard as before with its own damage ability. Soul
     * Reaver, Deformant, Bloated Manablub, Verdant Necrophage, Cthyrian Culler,
     * Nectar Ridge Oracle, Restitution, Seismomancy and Mirrorback Ambusher all
     * deal noncombat damage from a unit source and all took the printed read.
     *
     * The designer scales a unit-sourced NONCOMBAT effect by that unit's
     * {Powerful}, RAQ "[Solved] Resonant, Combat Damage, Conduit and Powerful":
     *   Q: "What if Resonant is Powerful?"
     *   A: "2/4 Resonant Powerful would deal 4 combat damage to enemy unit and
     *       then put effect on stack to deal 8 damage to enemy face."
     * — and {Powerful} is exactly the kind of thing that arrives by grant
     * (Emberflame Enlightener's units half), never by printing.
     *
     * Shaped on `E.itemAttrs`, which has read it correctly for the
     * {Afflicting} check all along: live entity while it is still in play,
     * printed card once it is gone (a "when I die" ping outlives its body).
     * ownAttrs, not effAttrs — the column-sharing layer is a COMBAT layer; an
     * effect's source is the card, not the column it happens to be standing in.
     *
     * ⚠ Side finding, deliberately NOT fixed here: the same RAQ doubles the
     * RESONANT RIDER a second time ("(4+1)x2 = 10 damage to enemy face"), while
     * the engine riders the undoubled amount. That is a separate ruling with
     * its own arithmetic; flagged, untouched.
     */
    /**
     * CR 712.8a — `effAttrs`, NOT `ownAttrs`: A UNIT IN A COLUMN *HAS* THE COLUMN'S
     * ATTRIBUTES, for everything it does and not only for combat damage.
     *
     * The owner, 2026-09-16, on playtest report #166 (room BTUX): *"The whole
     * card gets the attributes while it's in the column. And so when it
     * activates abilities or whatever, it has that attribute. Combat damage
     * also gets those applied, of course."*
     *
     * This line read `ownAttrs` — the card alone — so an ability activated by
     * a unit standing in a column was blind to everything its column-mates
     * were sharing into it. In BTUX, Soul Reaver's *"remove X +1/+1 counters
     * from me: I deal X damage to target unit"* fired off Refuse Reclaimer,
     * whose column-mate Flzzz prints {Blessed}; the damage landed and its
     * controller gained nothing.
     *
     * A column exists ONLY in combat (`columnOf` reads `s.battle` and answers
     * null without one), so this is not a widening of column sharing (CR 802.1c) to the whole game —
     * outside battle `effAttrs` IS `ownAttrs` and nothing changes. It is the
     * narrower correction: while the column exists, the unit has the
     * attributes, and every question asked of it gets the same answer.
     */
    const srcAttrs = this.effectSourceAttrs(ctx.sourceId, ctx.sourceName);
    // CR 721.4b: attributes a virus donated to this effect while it sat on the stack
    // ("mostly Deadly, Piercing, and Powerful are impacted by this" — Caleb
    // 2025-03-06). Read here rather than from the printed card alone, which is
    // the seam the SPELLS half of Emberflame Enlightener was parked on.
    for (const a of ctx.grantedAttrs ?? []) srcAttrs.add(a);
    /**
     * CR 802.25g {Pure} OUTSIDE COMBAT. "Pure cards and cards they are interacting
     * with ignore all other attributes." The combat half was built first, at combat's choke points, leaving interactions outside combat uncovered. The owner, 2026-09-05: "Make it work outside
     * combat, of course." Outside combat the interaction is THIS EFFECT and
     * EACH RECIPIENT, one pairing at a time, and this method is where every
     * non-combat attribute is read — so it is where the layer switches off.
     *
     * The rule is per PAIRING, both sides at once, exactly as in combat: a
     * Pure source deals plain damage to everyone (its own Powerful, Deadly,
     * Piercing, Electric, Poisonous, Resonant, Blessed and Unaware included);
     * a Pure recipient takes plain damage from anyone (the source's attributes
     * are off against it, and so are its own Vulnerable and Unaware). A
     * non-Pure recipient beside a Pure one in the same batch is hit with the
     * attribute layer ON — Pure is a fact about the pairing, not the batch.
     *
     * CR 802.25k: `effAttrs` on the recipient too. This paragraph used to end
     * "`ownAttrs`, not `effAttrs`, on the recipient: column-sharing is a
     * combat layer, and an effect hits the card, not its column" — which
     * was never true of the code it was describing. The recipient's own
     * {Vulnerable} is read with `effAttrs` twice below, and {Unaware} through
     * `this.unaware`, which is column-shared by CR 802.1c; the Pure read on this line
     * was the ONLY recipient-side question answered off the card alone, and it
     * was the odd one out rather than the rule. A Pure column-mate makes the
     * whole exchange attribute-blind, in combat and out of it, exactly as CR 802.25b
     * already has it for the attack/block column pair.
     */
    const NO_ATTRS = new Set<string>();
    const srcPure = srcAttrs.has('Pure');
    const pureWith = (u: Entity | undefined): boolean => srcPure || (!!u && this.effAttrs(u).has('Pure'));
    /** the source's attributes AS SEEN BY `u` (or by a player, when undefined) */
    const attrsVs = (u: Entity | undefined): Set<string> => (pureWith(u) ? NO_ATTRS : srcAttrs);
    /**
     * CR 802.9c, 802.9g {Unaware}: is THIS recipient's hit read at printed stats?
     *
     * The owner's scope for the pairwise collapse is "self or others when
     * dealing damage" — so the participants of an effect hit are the SOURCE
     * and the RECIPIENT, and either one being Unaware collapses both.
     *
     * The source side is read off `srcAttrs`, not off `src`, and that matters:
     * Haboob is a SPELL and has no entity in play, so `src` is undefined and
     * only the printed-card fallback a few lines up knows it is Unaware. That
     * is the whole of "Haboob kills anything that has 1 defense printed at the
     * card level" — a spell has no stats of its own to collapse, and its
     * {Unaware} exists to collapse what it hits.
     *
     * The recipient side is `unaware`, which is column-shared (CR 802.1c), so a unit
     * standing beside Bubb in a formation is read at printed here too.
     */
    const srcUnaware = srcAttrs.has('Unaware');
    // CR 802.1n: a Pure pairing reads nobody at printed — Unaware is an attribute
    const collapsed = (u: Entity): boolean => !pureWith(u) && (srcUnaware || this.unaware(u));
    /** the units this batch read at printed, for the death sweep at the end */
    const collapsedHit = new Set<EntityId>();

    // ── plan ──────────────────────────────────────────────────────────
    // Recipients in FIRST-MENTIONED order (the order the card names them is
    // the order the log should read in), each with the total this batch deals
    // it. Players and units are one list so the interleaving survives.
    type Recip = { seat: Seat; u?: undefined } | { u: Entity; seat?: undefined };
    const order: Recip[] = [];
    const dealt = new Map<string, number>();
    const key = (r: Recip): string => (r.u ? `u${r.u.id}` : `p${r.seat}`);
    const add = (r: Recip, n: number): void => {
      const k = key(r);
      if (!dealt.has(k)) order.push(r);
      dealt.set(k, (dealt.get(k) ?? 0) + n);
    };
    /**
     * How much of the pool `u` still needs before it is dead — the ONE piece
     * of lethal arithmetic in this method, read by both {Electric} and
     * {Piercing}, and deliberately the same three clauses `combatSubStep`'s
     * `assign` uses so the combat and non-combat paths cannot drift:
     *
     *  - {Vulnerable} (CR 802.16a): the victim RECEIVES double, so only half the pool
     *    is needed to kill it and the pre-double remainder carries on sooner.
     *    That is what "excess is computed AFTER the receive-side doubling"
     *    means — the pool is counted in what the SOURCE deals, the toughness
     *    in what the victim RECEIVES, and `mult` is the exchange rate.
     *  - damage this batch has already assigned to `u` counts, because CR 112.8
     *    coalesces a recipient named twice into one hit: the number that
     *    matters is what it will really have taken when the batch commits.
     *  - {Deadly} (CR 802.16a) caps the need at ONE point. RAQ "[Solved] Excessive
     *    Combat Damage & interaction with Piercing, Deadly and Phytochemical
     *    Protection": "Atleast 1 dmg to Awoken (gets +1/+1, won't create 1/1
     *    unit), rest of the damage can go to Bubb." So a source that is both
     *    Deadly and Piercing spends 1 and pierces the whole rest.
     *
     * Read against the unit's REAL toughness, never against its damage shield.
     * The same RAQ, with Piercing on a shielded 0/5 Awoken Tomb in front of a
     * 5/6 Bubb: "Atleast 5 damage to Awoken (gets atleast +5/+5, won't create
     * 5/5), atleast 6 damage to Bubb, rest can go to Opponent HP" — assignment
     * is planned as if the shield were not there, and prevention runs at
     * COMMIT below (CR 608.6g). A shield therefore changes how much damage is DEALT
     * and nothing at all about how much pierces.
     *
     * {Poisonous} is not special-cased on purpose: the damage arrives as
     * permanent -1/-1 counters, and `checkDeaths` kills on `t <= 0 || damage
     * >= t`, so `t - damage` is exactly as lethal in counters as it is in
     * marked damage. Combat's `assign` already computes a Poisonous column's
     * lethal share off toughness the same way; the two paths agree.
     */
    const poolToKill = (u: Entity): number => {
      const mult = (!pureWith(u) && this.effAttrs(u).has('Vulnerable')) ? 2 : 1;
      // CR 802.9e: a collapsed hit is priced against PRINTED defense, so Piercing
      // and Electric spend the small number and carry the rest on.
      const [, t] = collapsed(u) ? this.printedStats(u) : this.effStats(u);
      const recvCap = Math.max(0, t - u.damage - (dealt.get(`u${u.id}`) ?? 0) * mult);
      if (recvCap <= 0) return 0;
      if (attrsVs(u).has('Deadly')) return 1;
      return Math.ceil(recvCap / mult);
    };
    /**
     * CR 802.16j — {PIERCING} IS ELECTIVE OUTSIDE COMBAT TOO. RAQ "[Solved]
     * Squish/Fight/Battle vs Source of damage & Interactions": Bubb beside Good
     * Whale, Squish on Bubb — "Since Bubb will be the source of damage and he
     * has Piercing, then any excess damage CAN be dealt to enemy player." The
     * owner, 2026-10-10, asked whether "can be" is automatic or a choice:
     * "Elective, like combat." An earlier fix had already made the combat strike
     * elective (CR 802.16c) and left this path automatic (the 2026-08-23 ruling).
     *
     * So: `floor` (the lethal share) must stay on `u`, and the dealing player
     * says how much of the rest of `pool` stays on it too; whatever it is not
     * given goes to its controller. Returns the amount kept on `u`.
     *
     * Asked ONLY when there is a real choice (`pool > floor`) — a hit that is
     * exactly lethal or less never raises it, so a batch without Piercing
     * excess replays byte-identically to before noncombat Piercing became elective.
     *
     * The decision is the combat strike's own `assignDamage` (CR 608.6a, 802.16c), with the same option
     * values (a plain number = the amount the unit is given; 'default' = the
     * one-click lethal-to-the-unit, rest-to-the-player), so the client's
     * split dial draws it unchanged. It belongs to the DEALING player — the
     * controller of the source unit when it is still in play (CR 802.16k: the unit
     * is the source of a Squish / Fight / Battle hit, not the spell), as in
     * combat, where each side elects over its own strike; otherwise the
     * effect's controller.
     *
     * Keyed by the source and the hit's index in this batch, so a Fight's two
     * hits (two dealEffectDamage calls in ONE part, each a batch of one) ask
     * two questions rather than the second reading the first's answer.
     */
    const dealerSeat = (ctx.sourceId !== undefined ? this.entity(ctx.sourceId)?.controller : undefined)
      ?? ctx.controller;
    const pierceKeep = (u: Entity, floor: number, pool: number, tag: string): number => {
      if (pool <= floor) return pool;
      const face = this.pname(u.controller);
      const deadly = attrsVs(u).has('Deadly');
      const options: { label: string; value: unknown }[] = [{
        label: `default — ${floor > 0 ? `${floor} to ${u.card}, ` : ''}${pool - floor} to ${face}`,
        value: 'default',
      }];
      for (let a = floor; a <= pool; a++) {
        const t = a === floor && a > 0 ? (deadly ? ' (the {Deadly} floor)' : ' (lethal)')
          : a === pool ? ' (everything)' : '';
        options.push({ label: `${a} to ${u.card}${t}${pool - a > 0 ? `, ${pool - a} to ${face}` : ''}`, value: a });
      }
      const v = ctx.choose(`pierce:${ctx.sourceId ?? ctx.sourceName}:${tag}`, {
        kind: 'assignDamage', seat: dealerSeat,
        prompt: `${ctx.sourceName}: assign ${pool} damage — how much to ${u.card}? `
          + `(it must be assigned lethal first; {Piercing}: whatever it is not given goes to ${face})`,
        options,
      });
      return typeof v === 'number' && v >= floor && v <= pool ? v : floor;
    };
    for (const [hi, hit] of hits.entries()) {
      let n = hit.n;
      if (n <= 0) continue;
      const hitUnit = 'player' in (hit.target as object) ? undefined : (hit.target as Entity);
      /**
       * CR 708.5, 112.9: "[Augment] If an allied source would deal noncombat
       * damage, it deals that much damage PLUS 1 instead." (Conduit of Pain.)
       *
       * ORDER: the additive modifiers come FIRST, then {Powerful} doubles the
       * result. RAQ "[Solved] Resonant, Combat Damage, Conduit and Powerful":
       * a Powerful Bellowing Boulder with Conduit deals "(1+1)x2 damage to
       * each unit = 4", and a Powerful Resonant rider "(4+1)x2 = 10". The first implementation had it the other way round (1x2+1 = 3) as an interim decision with no
       * ruling behind it; the thread's arithmetic replaced it (CR 112.9).
       *
       * Being here rather than at commit is also what makes it compose with
       * {Piercing} and {Electric}: `poolToKill` is read a few lines down and
       * sees the final number, so the extra points pierce or pass along the
       * chain like any other.
       *
       * PER HIT: a source that deals damage to three units deals damage three
       * times, and the Conduit prices each of them. (CR 112.8 coalesces a
       * recipient NAMED twice into one commit, but the two hits are still two
       * dealings, and {Powerful} has always doubled both.)
       */
      n += this.amountDelta({
        kind: 'effectDamage', region: ctx.region, amount: n,
        ...('player' in (hit.target as object)
          ? { player: (hit.target as { player: Seat }).player }
          : { unit: hit.target as Entity }),
        sourceSeat: ctx.controller, sourceName: ctx.sourceName, combat: false,
      });
      // Powerful source: double the damage dealt (to units and players alike),
      // once, AFTER the additive modifiers (CR 802.10b) and before Electric
      // distribution or Vulnerable's receive-side doubling.
      // CR 802.25g, 802.25i: read against THIS recipient — off when either side is Pure.
      if (n > 0 && attrsVs(hitUnit).has('Powerful')) n *= 2;
      if (n <= 0) continue;
      const target = hit.target;
      if ('player' in (target as object)) {
        add({ seat: (target as { player: Seat }).player }, n);
        continue;
      }
      const first = target as Entity;
      if (!this.entity(first.id)) continue;
      if (!attrsVs(first).has('Electric')) {
        /**
         * {Piercing} on NON-COMBAT damage. The owner, 2026-08-23, settling
         * CARD-TODO #4 in as many words: "It redirects excess damage to that
         * unit's controller (not as a trigger, just as part of resolution of
         * the damage)."
         *
         * That generalises the rulebook's combat wording off the column
         * (Rulebook 2023-07: "Excess damage beyond the health of the back row
         * unit does not carry over to the player, unless the damage comes from
         * a unit with the Piercing attribute") — the column is the thing
         * combat happens to have, not a condition of the attribute, and the
         * owner's own report of the gap was "piercing is done even when its on
         * a non-combat effect".
         *
         * "Not as a trigger, just as part of resolution": the excess is added
         * to THIS batch as an ordinary recipient, so it is one resolution with
         * one `total`, it is committed in the same loop, and nothing goes on
         * the stack in between. It is still DAMAGE to a player once it lands —
         * a 'damage' event fires for it in the commit loop below, exactly as
         * for any other effect damage to a face, and {Blessed} pays out on it
         * the same way `combatSubStep` pays out on its `playerHits`.
         *
         * ORDER: this runs after {Powerful} doubled `n` a few lines up and
         * reads `poolToKill`, which prices the victim in post-{Vulnerable}
         * terms — so the excess is what is left after BOTH doublings, which is
         * the ordering the ruling specifies.
         */
        // CR 802.16: the excess is the dealing player's to place — keep it on the
        // unit or let it through (`pierceKeep` asks only when there is any)
        if (attrsVs(first).has('Piercing')) {
          const lethal = poolToKill(first);
          if (n > lethal) {
            const kept = pierceKeep(first, lethal, n, `${hi}`);
            if (kept > 0) add({ u: first }, kept);
            if (n - kept > 0) add({ seat: first.controller }, n - kept);
            continue;
          }
        }
        add({ u: first }, n);
        continue;
      }
      // CR 802.17: only the lethal share sticks to each victim; the rest passes along
      // a controller-chosen, non-overlapping adjacent path, all planned before
      // any damage commits (atomic — no formation changes mid-distribution)
      let victim = first;
      let remaining = n;
      const visited = new Set<EntityId>();
      let hop = 0;
      for (; ;) {
        visited.add(victim.id);
        const lethal = poolToKill(victim);
        if (remaining <= lethal) { add({ u: victim }, remaining); break; }
        if (lethal > 0) add({ u: victim }, lethal);
        remaining -= lethal;
        const nexts = this.adjacentInFormation(victim.id).filter(u => !visited.has(u.id));
        if (!nexts.length) {
          // The chain has nowhere left to go. WITH {Piercing} the two
          // attributes compose rather than one silently eating the other —
          // Electric says where excess goes NEXT, Piercing says where excess
          // goes when there is no next: to the controller of the unit it could
          // not be spent on. WITHOUT it the excess stays on this unit (CR 802.17):
          // it used to be dropped (the original Electric ruling), but damage is dealt, not lost — CR 608.6d,
          // and RAQ "[Solved] Vulnerable + Piercing / Electric": "All 12 damage
          // sink into Crumbling - this has its use if you had Ember of Life".
          // CR 802.16q: and the Piercing half is elective, as on a plain hit — the
          // victim's lethal share is already placed above, so the question is
          // asked over lethal + the remainder and the extra kept is added on.
          if (attrsVs(victim).has('Piercing')) {
            const kept = pierceKeep(victim, lethal, lethal + remaining, `${hi}:e${hop}`) - lethal;
            if (kept > 0) add({ u: victim }, kept);
            if (remaining - kept > 0) add({ seat: victim.controller }, remaining - kept);
          } else add({ u: victim }, remaining);
          break;
        }
        /**
         * CR 802.17: the jump is OPTIONAL. Electric's reminder says excess "can be"
         * dealt to an adjacent unit, and the RAQ reads that literally: "you can
         * ignore it and just assign all 6 damage to Crumbling Ancient". So the
         * controller is always asked, even with one neighbour (it used to be
         * walked without a question), and keeping the excess where it is is
         * an answer: the rest lands on this unit and the chain ends.
         */
        const keep = `keep:${victim.id}`;
        // Keyed per HIT as well as per hop: a part's answers are keyed by tag,
        // so two chains in one call (a Fight between two Electric units) used
        // to share `epath:0` and the second reused the first's pick. The first
        // hit keeps the old key, so a game saved mid-question resumes as it was.
        const chosen = ctx.choose(hi === 0 ? `epath:${hop}` : `epath:${hi}:${hop}`, {
          kind: 'electricPath', seat: ctx.controller,
          prompt: `${ctx.sourceName}: ${remaining} excess Electric damage — choose the next unit, or keep it on ${victim.card}`,
          options: [
            ...nexts.map(u => ({ label: u.card, value: u.id })),
            { label: `keep it on ${victim.card}`, value: keep },
          ],
        });
        if (chosen === keep) { add({ u: victim }, remaining); break; }
        const pick = this.entity(chosen as EntityId);
        if (!pick) throw new Error('electric path choice invalid');
        victim = pick;
        hop++;
      }
    }
    if (!order.length) return;

    // What each recipient RECEIVES — a Vulnerable victim doubles it, and CR 802.22a
    // {Blessed} says what the victim receives is what the source dealt, so the
    // doubling is inside the total the batch reports.
    const received = new Map<string, number>();
    for (const r of order) {
      const n = dealt.get(key(r)) ?? 0;
      let got = r.u && !pureWith(r.u) && this.effAttrs(r.u).has('Vulnerable') ? n * 2 : n;
      // CR 112.11: prevention runs HERE, before `total`, because `total` is "the
      // damage this effect dealt" (Ember of Life's "that many") and prevented
      // damage was never dealt. It is also after Vulnerable's doubling: the
      // shield stops "all damage that WOULD BE DEALT", and what would be dealt
      // to a Vulnerable unit is the doubled number.
      if (r.u && this.entity(r.u.id)) {
        got = this.preventUnitDamage(r.u, got, {
          region: ctx.region, source: ctx.sourceName, combat: false,
          attrs: attrsVs(r.u), pure: pureWith(r.u),
        });
      }
      received.set(key(r), got);
    }
    const total = [...received.values()].reduce((a, b) => a + b, 0);

    // ── commit ────────────────────────────────────────────────────────
    const killed: Entity[] = [];
    for (const r of order) {
      const n = received.get(key(r)) ?? 0;
      if (n <= 0) continue;
      if (r.seat !== undefined) {
        const seat = r.seat;
        // spell-effect damage to a PLAYER is still damage: emit a 'damage' event
        // (with the effect's controller, CR 112.5, 102.6) so triggers hear face hits too.
        // Fired before loseLife — a lethal hit ends the game mid-throw and the
        // queued trigger is moot. Combat face damage does NOT come through here
        // (pumpCombatDamage → loseLife directly) and stays trigger-silent.
        const ev = this.ev('damage', `${ctx.sourceName} deals ${n} to ${this.pname(seat)}.`,
          { player: seat, n, total, source: ctx.sourceName, controller: ctx.controller, region: ctx.region });
        this.fireEvent('damage', ev);
        // CR 802.22b {Blessed}: the gain lands on the SAME game-state check as the
        // damage, so it is committed here — before loseLife runs the lethal
        // check. A blessed source therefore cannot kill its own controller.
        if (attrsVs(undefined).has('Blessed')) this.blessedGain(ctx.controller, n, ctx.sourceName);
        this.loseLife(seat, n, ctx.sourceName);
        continue;
      }
      const u = r.u!;
      if (!this.entity(u.id)) continue;
      // CR 112.11: `n` is already post-prevention (see above), and a fully prevented
      // recipient never reaches here — the `n <= 0` guard at the top of the
      // loop drops it. So no {Blessed} gain, no Poisonous counters, no 'damage'
      // event, no {Deadly} kill, no {Resonant} rider: "if there is not damage
      // being dealt, then no counters are placed" (RAQ, Poisonous vs
      // Phytochemical Protection).
      const through = n;
      // CR 802.9e: this hit was read at printed stats, so its lethality is settled
      // by `sweepCollapsedDeaths` below rather than by the state-based sweep.
      if (collapsed(u)) collapsedHit.add(u.id);
      // CR 802.25g: every rider below is read against THIS recipient
      const vs = attrsVs(u);
      const poisonous = vs.has('Poisonous');
      const resonant = vs.has('Resonant');
      if (vs.has('Blessed')) this.blessedGain(ctx.controller, through, ctx.sourceName);
      /**
       * CR 802.18a, 802.18b — {POISONOUS} IS A FORM, NOT A REPLACEMENT, and this branch is
       * therefore one dealing of damage with two ways of marking it.
       *
       * This used to be an if/else in which the {Poisonous} half fired no
       * 'damage' event, took no {Deadly} kill and carried no `lethal`
       * fact, on the reading that "Poisonous replaces the damage". Caleb
       * settled that in the other direction twice, and the engine's own prevention
       * comment quotes the summary of it without noticing:
       *
       *   Caleb, 2025-02-03 (#rules-questions): *"Poisonous damage does count
       *   as damage. If it was replacing the damage it would say 'if a
       *   poisonous unit would deal damage, instead put that many -1/-1
       *   counters on the opposing unit instead'."*
       *
       *   Caleb, 2026-01-10: *"poison is not damage … but poisonous units
       *   still deal damage … if this unit deals damage, it is still damage
       *   (just dealt as counters)."*
       *
       * The printed reminder says the same thing: *"Poisonous sources damage
       * units in the form of -1/-1 counters"* (Blightmound). IN THE FORM OF.
       * A replacement would have to say so, and none of them does.
       *
       * So {Poisonous} is a `mark` — the last line of a shared dealing —
       * exactly as {Vulnerable} is a multiplier and {Resonant} is a rider.
       * Everything above it is shared, and that is what closes both halves of
       * the divergence this branch carried:
       *
       *  · **the 'damage' event.** RAQ "[Solved] Poisonous vs 'Whenever I am
       *    dealt damage' vs Phytochemical Protection" (2025-03-25), verbatim:
       *    *"Q: Does Poisonous sources trigger 'when I am dealt damage'  A:
       *    Poisonous damage does count as damage being dealt."*, worked as
       *    *"Awoken Tomb receives 2 damage in form of -2/-2 counters and is
       *    triggered to make 2/2 token unit."* Measured before this change:
       *    it was not. Only PREVENTION silences the trigger, and prevention
       *    is handled far above here (CR 112.11) — a fully prevented recipient
       *    never reaches this loop at all.
       *  · **the {Deadly} kill.** Caleb, 2023-08-23, asked directly about a
       *    unit with both: *"yeah it'll get instakilled by deadly but also
       *    trigger to put counters on it."* BOTH. The counters go on and the
       *    unit dies anyway. Combat has always done this (`L.deadlyHit` is
       *    marked in `assignColumnDamage` regardless of {Poisonous}, and
       *    `sweepDeadly` kills through it) — this path was the one that
       *    disagreed with it, which is the whole subject of CR 802.3e and 802.3g: the owner,
       *    2026-08-28, *"deadly works on spell effects and everything. Just
       *    like powerful."*
       *
       * ⚠ ORDER: the event is fired BEFORE the counters go on, because
       * `addCounters` runs `checkDeaths` and a lethal poison hit would
       * otherwise destroy the victim before it could hear the hit that killed
       * it — while a lethal MARKED hit keeps its trigger (deaths wait for the
       * sweep at the foot of this method). Firing first is what makes the two
       * forms equally audible; the `lethal` fact is what makes the
       * pre-counter reading safe, since a listener asking "did I survive
       * this?" reads the fact and not the stats.
       */
      // CR 802.9: lethality on a collapsed hit is measured on PRINTED defense —
      // "Haboob kills anything that has 1 defense printed at the card level",
      // however many +1/+1 counters are on it. The kill itself is
      // `sweepCollapsedDeaths` below; `checkDeaths` reads effStats and would
      // let the pumped victim walk.
      const [, t] = collapsed(u) ? this.printedStats(u) : this.effStats(u);
      /**
       * CR 802.3a — `lethal` IS A FACT ABOUT THE HIT, and it rides the event.
       *
       * "Whenever I survive damage" (Molten Tormentor) is a condition at
       * event time (CR 109.3a), and the only thing a listener could read at event
       * time was `u.damage < defense` — which a {Deadly} hit BELOW defense
       * passes, so the card paid out for surviving a hit that killed it one
       * line later. Marked damage is not the whole of what kills: CR 802.3a's
       * {Deadly} is the second half, and it is known HERE and nowhere else.
       *
       * Computed before the dispatch (the read is pure — `fireEvent` only
       * evaluates `when` and queues, so nothing between the two lines can
       * move the number) and reused for `killed`, so the fact on the event
       * and the kill that follows can never disagree.
       *
       * {Deadly} is the only attribute that makes a sub-defense hit lethal to
       * a UNIT: {Piercing} carries excess to the PLAYER, {Lethal} kills a
       * player outright, {Resonant} drains life, and {Vulnerable}'s doubling
       * is already inside `through`. {Poisonous} used to be listed here as
       * "replaces the damage and never reaches this branch at all"; the Poisonous-is-damage ruling
       * struck that — its damage reaches every line of this one, and only the
       * MARK below differs.
       */
      /**
       * ONE expression for both forms, and it has to be this one.
       *
       * `checkDeaths` kills on `t' <= 0 || damage >= t'`. For a MARKED hit the
       * toughness is unchanged and the damage grows: `u.damage + through >= t`.
       * For a POISON hit the damage is unchanged and the toughness shrinks:
       * `t - through <= 0 || u.damage >= t - through`. Rearrange the first and
       * both collapse to the same sentence — **how much toughness is left,
       * against how much damage is already marked** — with the second's
       * `t' <= 0` arm folded in for free, because `u.damage` is never negative.
       *
       * Writing the poison side as `t - through <= 0` (which is what this line
       * said for its first draft) drops exactly that arm: a unit already
       * carrying 3 damage on 5 toughness, hit for 2 poison, really dies on the
       * state check, and the event would have called the hit survivable.
       */
      const lethal = vs.has('Deadly') || t - through <= u.damage;
      const ev = poisonous
        ? this.ev('damage',
          `Poisonous: ${ctx.sourceName} deals ${through} to ${u.card} as -1/-1 counter(s).`,
          { unit: u.id, n: through, total, source: ctx.sourceName, controller: ctx.controller,
            lethal, poisonous: true })
        : this.ev('damage', `${ctx.sourceName} deals ${through} to ${u.card}.`,
          { unit: u.id, n: through, total, source: ctx.sourceName, controller: ctx.controller, lethal });
      if (!poisonous) u.damage += through;
      this.fireEvent('damage', ev);   // "when I am dealt damage" (Awoken Tomb)
      // the MARK: the one line the two forms do not share.
      if (poisonous) this.addCounters(u, -through);   // permanent; runs checkDeaths
      // CR 802.3a: Deadly — any nonzero damage kills, regardless of toughness. A
      // poison hit the counters already killed is in here too, exactly as a
      // marked hit that reached its defense is: `killed` is a list of units
      // this batch killed, and the destroy loops below skip whatever is
      // already gone.
      if (lethal || (poisonous && !this.entity(u.id))) killed.push(u);
      // CR 802.19a: the rider is the source's own trigger, not inline life loss
      if (resonant) {
        this.queueResonant(ctx.sourceId ?? -1, ctx.controller, u.controller, through, ctx.region, ctx.sourceName);
      }
    }
    // "Put a +1/+1 counter on it for each damage prevented this way" —
    // paid out after the whole batch is marked, so a shield cannot resolve a
    // death in the middle of damage CR 112.8 makes simultaneous.
    this.settleDamagePrevention();
    // CR 802.21b: {Reaping} is a KILL rider, not a damage rider — "when it kills a
    // unit, its controller draws a card" — so its real home is the kill diff
    // at the resolving-part boundary (`killRiders`), which sees a kill however
    // it happened. This line survives for the ONE case that boundary cannot
    // cover: an effect-damage batch dealt OUTSIDE a resolving part (card code
    // and tests that call `dealEffectDamageAll` directly), and the one where
    // the open diff is somebody ELSE's — an {Afflicting}-only source, which
    // pays no draw. `killWatch.reaps` says the diff has this covered, so
    // exactly one of the two ever pays.
    // CR 802.21: ONE draw for the whole batch, not one per body. The printed
    // reminder is "(When a reaping source kills one or more units, draw a
    // card. It loses reaping until regroup.)" — "one or more units" takes "a
    // card", singular. It is absent from the oracle transcription because
    // {Reaping} is a TYPE-LINE ATTRIBUTE and that field carries ability text
    // (owner, 2026-08-30), which is why the attribute was first built without it.
    if (srcAttrs.has('Reaping') && !this.killWatch?.reaps && killed.length) {
      this.reapingDraw(ctx.controller);
    }
    if (srcAttrs.has('Deadly')) {
      for (const u of killed) {
        if (this.entity(u.id)) {
          this.ev('info', `${ctx.sourceName} is Deadly — ${u.card} dies.`);
          this.destroy(u, 'dies');
        }
      }
    }
    // CR 802.9e: settle the deaths the collapsed reading implies before the ordinary
    // state-based sweep, which reads effStats and cannot see them.
    this.sweepCollapsedDeaths(collapsedHit);
    this.checkDeaths();
  }

  /** CR 603.2a orthogonal formation adjacency, read for UNITS: front/back within a
   * column + same row in a horizontally adjacent column, nothing diagonal
   * (attackers and blockers are separate grids). `adjacentSlots` is the same
   * definition read for the EMPTY positions, and both take their grid from
   * `formationGrid` so the two can never drift apart. */
  adjacentInFormation(id: EntityId): Entity[] {
    const b = this.s.battle;
    if (!b) return [];
    // blocking columns are keyed by attacked column index; consecutive keys are
    // treated as adjacent (⚠ approximation: two blocks on columns 1 and 5 read
    // as neighbours)
    const grids: EntityId[][][] = [this.formationGrid(b.attacker), this.formationGrid(b.defender)];
    for (const grid of grids) {
      for (let ci = 0; ci < grid.length; ci++) {
        const ri = grid[ci]!.indexOf(id);
        if (ri === -1) continue;
        const out: Entity[] = [];
        const push = (eid?: EntityId) => { const u = eid !== undefined ? this.entity(eid) : undefined; if (u) out.push(u); };
        push(grid[ci]![1 - ri]);          // vertical neighbor
        push(grid[ci - 1]?.[ri]);         // horizontal neighbors, same row
        push(grid[ci + 1]?.[ri]);
        return out;
      }
    }
    return [];
  }

  // ── CR 802.23a, 802.21b, 802.23c: THE KILL-SCOPED ATTRIBUTES ──────────────────────────
  //
  // Two attributes in the pool are triggered by a KILL rather than by damage,
  // and the set is read off the pool's own reminder wording, exactly as
  // `109-attr-channel-conformance` reads the source/unit split:
  //
  //   {Afflicting}  "When an afflicting source KILLS one or more units, those
  //                  units' controllers gain a rot."   (printed reminder)
  //   {Reaping}     "When a reaping source kills one or more units, draw a
  //                  card. It loses reaping until regroup."   (printed reminder)
  //                 (⚠ THIS COMMENT USED TO SAY IT WAS **NOT** PRINTED — "none
  //                  of the four {Reaping} cards carries a reminder at all.
  //                  `ui/glossary.ts` is the repo's own statement of it, and it
  //                  is what R184 read." That was false, and the Reaping ruling built the
  //                  attribute from the repository's paraphrase of itself
  //                  because of it. Every printer carries the sentence above;
  //                  it is missing from the oracle transcription because
  //                  {Reaping} is a TYPE-LINE ATTRIBUTE and that file's `text`
  //                  field holds ability text (owner, 2026-08-30); see CR 802.21.
  //                  "one or more units" takes "a card" — one draw, not one
  //                  per body, which is what this site paid until the reminder was read.)
  //
  // Contrast the DAMAGE-scoped riders one word away — {Blessed} "DAMAGE dealt
  // by a blessed source…", {Resonant} "when it DAMAGES a unit…", {Deadly}
  // "any DAMAGE from a deadly source WILL KILL a unit" (a damage modifier, not
  // a kill trigger). Those belong at the damage site and must stay there.
  //
  // The {Afflicting} kill diff (CR 802.23c) already had the right machinery, and it is Caleb's own
  // formulation (2024-09-10: "we check damage and stats of units that were
  // interacted with during spell resolutions"): attribution is not done at the
  // damage site but by DIFFING — snapshot who is alive, let the source act,
  // then see who is gone. That covers damage, counters, stat swaps, delete
  // effects and anything else a future card does.
  //
  // The Reaping change (CR 802.21b) is that {Reaping} now rides the SAME diff. It used to
  // live in `dealEffectDamageAll`, so a kill by a -1/-1 counter (Noxious
  // Demise) or by a power/defense swap (Invasive Reassignment) never saw it,
  // and both cards hand-rolled the rider in card code to compensate. Neither
  // does any more.

  /** CR 802.21b, 802.23c: the attributes whose rider fires on a KILL, so one diff serves them
   * all. Adding an attribute here is the whole cost of giving it kill scope. */
  static readonly KILL_RIDERS: readonly Attr[] = ['Afflicting', 'Reaping'];

  /** CR 802.21b: does this source want a kill diff opened around it? */
  wantsKillDiff(attrs: Set<string>): boolean {
    return E.KILL_RIDERS.some(a => attrs.has(a));
  }

  /** id -> controller for every unit in play right now (the "before" side of
   * a kill diff; the controller has to be captured while the unit still
   * exists). */
  snapshotUnits(): Map<EntityId, Seat> {
    const m = new Map<EntityId, Seat>();
    for (const u of Object.values(this.s.entities)) {
      if (u.kind === 'unit') m.set(u.id, u.controller);
    }
    return m;
  }

  /** CR 802.21b: the "after" side — every unit in `before` that is no longer in
   * play, with the controller it had while it lived. `only` narrows the diff
   * to ids the source is known to have interacted with (combat, where other
   * units may be dying in the same sub-step from unrelated columns). */
  private killDiff(before: Map<EntityId, Seat>, only?: Set<EntityId>): { id: EntityId; seat: Seat }[] {
    const out: { id: EntityId; seat: Seat }[] = [];
    for (const [id, seat] of before) {
      if (this.entity(id)) continue;                 // survived
      if (only && !only.has(id)) continue;           // not this source's doing
      out.push({ id, seat });
    }
    return out;
  }

  /**
   * CR 802.21b: close a kill diff and pay out every kill-scoped rider the source
   * carries. ONE call site per seam, so a new kill-scoped attribute never has
   * to find the seams for itself.
   *
   * `attrs` is the SOURCE's live attribute set (`itemAttrs` at the resolution
   * seam), which is why a virus-donated or mod-donated {Reaping} counts.
   */
  killRiders(before: Map<EntityId, Seat>, attrs: Set<string>, sourceName: string,
    controller: Seat, only?: Set<EntityId>): void {
    const dead = this.killDiff(before, only);
    if (!dead.length) return;
    if (attrs.has('Afflicting')) this.afflictingRot(dead, sourceName);
    // CR 802.21: "When a reaping source kills one or more units, draw A CARD" —
    // one draw for the whole kill, however many bodies it took. This read
    // `for (const _ of dead)` until the printed reminder was finally read off
    // the card scans; the damage-site rider above pays the same way now.
    if (attrs.has('Reaping')) this.reapingDraw(controller);
  }

  /** {Reaping}'s payout, in one place so the log line cannot drift between the
   * kill diff and the direct-call damage site. */
  reapingDraw(controller: Seat): void {
    this.ev('info', `Reaping: ${this.pname(controller)} draws a card.`);
    this.draw(controller, 1);
  }

  /**
   * Close an afflicting diff: every unit in `before` that is no longer in play
   * was killed by the afflicting source, and its CONTROLLER gains a rot —
   * ⚠ CR 802.23b (Bena's reading): ONE rot per affected controller per kill event,
   * however many of their units died. `only` narrows the diff as `killDiff`
   * describes. Kept as its own entry point because the COMBAT seam
   * (`afflictingAftermath`) still calls it per damage-source bucket.
   */
  afflictingKills(before: Map<EntityId, Seat>, sourceName: string, only?: Set<EntityId>): void {
    this.afflictingRot(this.killDiff(before, only), sourceName);
  }

  private afflictingRot(dead: { id: EntityId; seat: Seat }[], sourceName: string): void {
    const seats = new Set<Seat>(dead.map(d => d.seat));
    if (!seats.size) return;
    const ids = dead.map(d => String(d.id));
    // initiative order, so the rot events are deterministic on replay
    for (const seat of [this.initiative, this.nit]) {
      if (!seats.has(seat)) continue;
      this.ev('info', `Afflicting: ${sourceName} killed ${this.pname(seat)}'s unit(s) — they gain a rot.`,
        { seat, source: sourceName, units: ids });
      this.gainRot(seat, 1);
    }
  }

  /** CR 706.8c: the units of the death batch `checkDeaths` is disposing right now.
   * Transient, per synchronous call — never serialised, never on GameState.
   * Read by `fireEvent`, which otherwise loses each body the instant
   * `destroy` deletes it from `s.entities`. */
  private deathBatch: Entity[] = [];
  /** CR 713.6a: which member of `deathBatch` is being disposed at this instant, so
   * it is not handed its own 'died'/'trashed' event twice. */
  private disposingSelf: EntityId | null = null;

  /** `u` is a unit the state-based check would kill right now. */
  isLethal(u: Entity): boolean {
    if (u.kind !== 'unit') return false;
    // CR 610.2e: a SENT COUNTERATTACKER "doesn't exist until phase 1 finishes"
    // (Manual p.20), and `E.anchored` already enforces exactly that on the
    // emitting side — an absent anchor radiates nothing, its own text
    // included. Sweeping it here anyway asked a body that does not exist to
    // pass a check with its own abilities switched off: Prickly Protector
    // ("[Augment] I gain +1/+1 for each other ally") carrying a -1/-1
    // counter died the instant it was declared as a counterattacker, alone
    // among the untargetable, unsacrificeable, uncountable. It is not on the
    // board; it cannot die on it. The sweep at the foot of endBattleRound
    // catches it the moment it lands.
    if (u.absent) return false;
    // CR 503.5b: constructed's draw phase — draw 4, put 2 back — is ONE step for
    // the seat taking it, though it is two actions. Owner, 2026-10-06: a
    // card-count unit (Dreadspawn Horror) is judged on the NET hand, so its
    // controller's units are not checked until they have put their 2 back.
    if (this.bottomPending(u.controller)) return false;
    const [, t] = this.effStats(u);
    return t <= 0 || u.damage >= t;
  }

  /** The state-based check. Two actions, run together at every safe point:
   * lethal damage kills, and an empty attacking column stops existing (CR 602.5c).
   * The second is here as well as in removeFromFormation() because card code
   * splices `b.columns` directly (Hooba-Nan, Shard Sprite, Tiderunner), and a
   * state-based action nobody can forget to run is the whole point. */
  checkDeaths(): Entity[] {
    const dead = Object.values(this.s.entities).filter(u => this.isLethal(u));
    // CR 706.8c — THE BATCH IS SIMULTANEOUS TO ITS LISTENERS TOO. The loop below
    // disposes one body at a time and `destroy`'s second line deletes each one
    // from `s.entities`, which `fireEvent` scans; without `deathBatch` the
    // first corpse out of a batch cannot hear the rest of it, and Muck
    // Rummager missed three cards its controller trashed in one combat-damage
    // step (report #155, room ZSPG action 218). `disposingSelf` keeps the
    // "excludes the trigger source itself" reading (CR 713.6a): a body never hears its OWN
    // departure through this seam, only its batch-mates'.
    const prevBatch = this.deathBatch, prevSelf = this.disposingSelf;
    this.deathBatch = dead;
    try {
      for (const u of dead) {
        this.disposingSelf = u.id;
        this.destroy(u, 'dies');
      }
    } finally {
      this.deathBatch = prevBatch;
      this.disposingSelf = prevSelf;
    }
    this.repairFormation();
    return dead;
  }

  /**
   * CR 410.7 — THE DISPOSAL TAIL. One body and its mods leave PLAY for a bin;
   * this is the whole of what happens to them, and it is the only copy.
   *
   * ⚠ WHY THIS EXISTS. The sequence below — push the mods, push the body,
   * announce, trash each one ANCHORED (CR 714.9), then sweep by SLOT INDEX
   * highest-first if the body is {Unstable} (the engine's route; CR 405.5 erases instead, CT-246), else sweep just
   * the body if it is a token (CR 410.5), then file the TOKEN mods on the public
   * erased pile (CR 407.3a), then delete the mod entities last — has eight ordering
   * constraints and not one of them is visible from a call site. Every time it
   * was hand-copied it drifted: the copy in `exchangeInPlace` (Hooba-Mon,
   * batch-dark-b.ts) logged a despawn it never fired, deleted its mods with no
   * bin and no trash, and skipped a token body's bin entirely — three separate
   * repairs, in two rounds, to make one copy say what the original said.
   * CT-43 is the conclusion: there is now ONE implementation and both leave-
   * play-for-a-bin routes call it. Do not re-inline it. `test/129-disposal-
   * tail.test.ts` fails if you do — behaviourally, not by reading the source.
   *
   * `E.toBin` cannot express this and is not meant to: it takes neither the leave-play `anchor` of CR 714.9 (so a mod's own "when I am trashed" text would lose the region it
   * left play in) nor reports the slot it pushed to (so CR 405.6's sweep would be
   * back to `bin.lastIndexOf(name)`, which eats an innocent older copy of the
   * same card). `toBin` is for a card entering a bin from a zone that is not
   * play; this is for one leaving play.
   *
   * `announce` is the callers' ONE difference, and it is held to the middle of
   * the sequence on purpose: a death logs 'died' and a leave-play logs
   * 'despawned', both AFTER every push and BEFORE every trash, because that is
   * the board a listener must see (CR 410.7). It receives the body's bin slot —
   * `binSeat` + `binIndex`, CR 405.6's bin identity, which only this method knows
   * — and `unstable`, which decides the wording of the caller's own log line.
   * Anything the caller must do inside that window (a formation collapse, an
   * unslot) goes in the callback too; nothing else belongs there, because
   * `fireEvent` only QUEUES triggers and the slot indices stay exact.
   *
   * The caller detaches the body from `s.entities` and resolves `mods` BEFORE
   * calling — a mod id whose entity is already gone is not a mod any more —
   * and this method deletes the mod entities at the very bottom, so the
   * `announce` window can still walk `u.mods` for donated [Augment] text.
   *
   * `opts.binTo` redirects BOTH the body's bin and its mods' (Pull Under: "it
   * and all of its mods into YOUR bin"); `opts.keepBinned` is that same card's
   * override of the Unstable sweep — the card's own stated destination wins.
   * A TOKEN body is still swept under `keepBinned`: Pull Under moves cards and
   * a token has none (CR 410.5).
   *
   * NOT folded in: `leavePlay` / `afterDespawn` (recall and cache). They run
   * the mods HALF of this and nothing else — their body goes to a hand or a
   * cache, so there is no body push, no body slot, no Unstable sweep (a
   * recalled carrier's mods stay in the bin whatever the carrier was) and no
   * token-mod erased line. Threading a "no body" mode through here would add a
   * branch to every one of the eight ordering constraints above to save four
   * lines; the two shapes are kept apart deliberately. See CT-43's report.
   */
  disposeToBin(
    u: Entity, mods: Entity[],
    announce: (at: { binSeat: Seat; binIndex: number; unstable: boolean }) => void,
    opts: { binTo?: Seat; keepBinned?: boolean } = {},
  ): void {
    // CR 410.3: turn a transformed card back over FIRST — before the bin
    // seat, the Unstable question, any push, the announce or the trash. The
    // card that reaches the bin is the FRONT face, and everything below reads
    // `u.card`.
    this.revertFace(u);
    /**
     * CR 405.3, 801.2e (owner, 2026-08-29, round-31 sheet Q5) — **A STOLEN UNIT THAT
     * DIES IS TRASHED BY ITS CONTROLLER, INTO THE CONTROLLER'S BIN.**
     *
     * > "The controller trashes it and it goes to their graveyard. In
     * > Algomancy, there's no issue with taking opponent's cards and putting
     * > them into your zones in the way that's not possible in other card
     * > games. The primary format (live draft) is a fully shared card pool."
     *
     * This was `u.owner`. For the 99% of deaths where nobody has stolen
     * anything the two are the same seat and nothing moves; the whole ruling
     * lives in the gap `giveControl` opens (CR 711.1).
     *
     * ⚠ THIS PARTLY REVERSES the mods ruling's "⚠ The DESTINATION does not move" — but
     * only for THE BODY, and that paragraph was written knowing this question
     * was open ("it could get away with that only because no caller had ever
     * made them differ"). That ruling's own split — `noteTrashed`'s `seat` vs
     * `binSeat` — is what makes the reversal a one-word change here instead of
     * a rewrite. **The MODS follow control too**: `modBin` below sends a mod to its host controller's bin (CR 410.4a), a separate ruling: Q5 was
     * asked about a unit.
     *
     * The CR 405.6 bin ref is UNAFFECTED by this in mechanism and made MORE exact
     * in value. The body's trash passes no `binSeat` option, so trasher and
     * bin-owner are one number here whichever seat it is, and the stamp is
     * always computed rather than dropped — the `-1` "absent" case is still
     * reachable only through the mod path. What changed is which bin the nth
     * is counted in, and it is now the bin the card is actually sitting in,
     * which is exactly what CR 405.6 (Cthyrian Rector recalling an innocent older
     * copy) requires of it.
     */
    const binSeat = opts.binTo ?? u.controller;
    // CR 803.8/#89: FOUR ways in, unioned by E.isUnstable. `mods.length` is the
    // derived one (a modded card is Unstable — CR 803.8e); `u.unstable` is the
    // until-regroup STAMP a bin play leaves on the body it spawned; and an earlier
    // reading added the COPY of a modded unit, since reversed: a fresh copy is
    // not Unstable (CR 803.8g). Read off the detached entity, so it is the same answer whether
    // the caller asked before or after the body left the table.
    const unstable = this.isUnstable(u);
    // CR 720.8a: does the sweep below take the body and its mods back OUT of the
    // bin? Hoisted here because it is now two decisions, not one — the erase
    // AND whether a mod's momentary bin visit is a trashing at all. The
    // announce's log line asks the same question (see `willSweep` in
    // destroy()); this is the same predicate, one scope up.
    const willSweep = unstable && !opts.keepBinned;
    // The nontoken mods enter the host controller's bin too (CR 410.4a) — `binTo`
    // redirects them with the body. Pushed BEFORE the announce, exactly as
    // leavePlay() does for a recall, so a death listener sees the same board a
    // despawn listener would.
    // CR 410.4a — **ZONES ALWAYS FOLLOW CONTROL, and that includes a mod's.**
    // This was `m.owner`, under the earlier owner's-bin reading's *"⚠ The DESTINATION does not move. A
    // card still goes to its own OWNER's bin — Rashi's Virus lands in Rashi's
    // bin — because ownership is not control."* The owner has now ruled the
    // opposite: *"there's no issue with taking opponent's cards and putting
    // them into your zones … The primary format (live draft) is a fully shared
    // card pool."* The earlier reading's ATTRIBUTION half stands untouched (a mod is trashed
    // by the host's controller); only its destination half is superseded, and
    // the earlier reading was written knowing the question was open — it recorded
    // that the engine "could get away with" conflating attribution and
    // destination "only because no caller had ever made them differ". This is
    // that seam being decided rather than discovered.
    //
    // A mod's controller IS its host's (see `afterDespawn`), so this and the
    // trash attribution below are now the same seat by construction.
    const modBin = (m: Entity): Seat => opts.binTo ?? m.controller;
    const binnedMods = mods.filter(m => !m.token);
    // CR 405.6: remember WHERE each push landed. The whole window between here and
    // the state-based sweep below only QUEUES (fireEvent composes triggers, it
    // never resolves one), so nothing can leave a bin in between and these
    // indices are still exact when the sweep uses them.
    const binnedAt = new Map<EntityId, number>();
    for (const m of binnedMods) {
      const b = this.player(modBin(m)).bin;
      b.push(m.card);
      binnedAt.set(m.id, b.length - 1);
    }
    // In the engine EVERYTHING leaving play for a bin enters one — token, Unstable
    // carrier and plain card alike — and every CARD among them is trashed (CR 801.2);
    // CR 405.5 and 801.2h instead erase an Unstable carrier unbinned (CT-246).
    // CR 801.2d: not a token; `noteTrashed` drops that case itself. The trash fires AFTER
    // the caller's event below so the log reads "X dies → bin" then "…trashes
    // X", and the erase comes after that again.
    this.player(binSeat).bin.push(u.card);
    const bodyBinIndex = this.player(binSeat).bin.length - 1;
    announce({ binSeat, binIndex: bodyBinIndex, unstable });
    // CR 714.9: the trash fires anchored on the departing entity itself, so its
    // own "when I am trashed" trigger keeps the region it left play in — body
    // first, then each mod anchored on the MOD entity, which is the order
    // afterDespawn() uses for a recall.
    this.noteTrashed(binSeat, u.card, 'play', u);
    // CR 720.8a (owner, 2026-08-29, report #129), the half that OVERRULES an earlier reading,
    // "The mods ride with it": **a mod erased with its host is not trashed at
    // all.** *"When a mod goes onto a unit, it becomes PART of that unit … The
    // Monstrosity was a mod, not its own card, on Ben's unit."* It never had a
    // presence of its own to trash; it goes where the host goes, and the
    // host's single trash above is the whole unit's.
    //
    // ⚠ THE ENGINE'S UNSTABLE-BODY TRASH IS NOT WEAKENED (CR 801.2h differs, CT-246). The line above still fires for an
    // {Unstable} carrier that dies and is erased a statement later — that is
    // the exact defect the owner's 2026-08-24 call exists to fix (report #93: Dropslime trashing from
    // hand and not from play), and it is asserted by name in
    // test/224-mod-trash.test.ts. Only the MODS changed.
    //
    // `willSweep` is the whole condition and not a proxy for it: a nontoken
    // mod makes its host Unstable by derivation (CR 803.8e — `isUnstable` reads
    // `mods.length > 0`), so `binnedMods.length > 0` implies `unstable`, and
    // the only way this loop runs today is Pull Under's `keepBinned` — where
    // the pair really does STAY in the bin and really is trashed. Written as
    // the sweep condition rather than as `if (opts.keepBinned)` so that a card
    // which one day binds mods to a non-Unstable host inherits the right
    // answer instead of the card that happened to exist in 2026.
    //
    // The bin PUSH above stays. It is the route to `eraseFromZone` (CR 405.7: the
    // sanctioned way out of a bin, and the only thing that files the mod on
    // CR 407.2's public erased pile), and CR 720.8a settles the trashing question
    // directly rather than by whether a card touched a bin on its way out.
    if (!willSweep) {
      for (const m of binnedMods) {
        // CR 720.8 attribution, CR 410.4a destination — and under the latter those are the
        // same seat: `modBin` is the mod's controller, a mod's controller is
        // its host's, and `binTo` overrides both together. `binSeat` is still
        // passed so this site keeps SAYING which question it is answering; see
        // `noteTrashed`'s `binSeat` for why the parameter survives its last
        // live divergence.
        this.noteTrashed(opts.binTo ?? u.controller, m.card, 'play', m, { binSeat: modBin(m) });
      }
    }
    // The engine's state-based sweep (CR 410.5; CR 405.5 would erase an {Unstable} card without binning it, CT-246): the card has been in the bin for the whole
    // event window above (both `when` passes and the ledger saw it there) and
    // now leaves it, before anything queued has resolved. CR 405.7: eraseFromZone
    // is the sanctioned route out of a bin, and the reason it records is
    // 'erased' — the same verb the token sweep uses, because it is the same
    // state-based action and not a new kind of departure.
    //
    // CR 405.6: each sweep names the SLOT it pushed (`binnedAt` / `bodyBinIndex`),
    // not the card's name. Without the index this reads `bin.lastIndexOf(name)`,
    // which is the copy just pushed only by luck of ordering — and an older
    // copy of the same name resting in that bin is one reordering away from
    // being the one eaten, leaving the token / Unstable card in the bin and
    // taking an innocent card out of the game in its place.
    if (unstable && !opts.keepBinned) {
      this.eraseFromZone(binSeat, u.card, 'bin', `${u.card} is erased from the bin — Unstable.`,
        { index: bodyBinIndex });
      // CR 405.6: HIGHEST index first. Two mods of the same card on one carrier land
      // in one bin at consecutive slots, and erasing the lower one first slides
      // the higher one down under the index we recorded for it — after which a
      // named slot that no longer holds that card is "gone" (eraseFromZone
      // deliberately does not fall back to a name search) and the second mod
      // would survive the sweep. Descending order never disturbs an index still
      // to be used. The body is above every mod in its own bin and was already
      // taken, for the same reason.
      for (const m of [...binnedMods].reverse()) {
        this.eraseFromZone(modBin(m), m.card, 'bin',
          `${m.card} is erased from the bin — it modded an Unstable card.`,
          { index: binnedAt.get(m.id) });
      }
    } else if (u.token) {
      this.eraseFromZone(binSeat, u.card, 'bin', `${u.card} is erased from the bin — it is a token.`,
        { index: bodyBinIndex });
    }
    // CR 407.1: an erase must reach the public erased pile like every other erase
    // (ev() keeps the pile off 'erased' events). The body and the nontoken mods
    // put themselves there via eraseFromZone above; this covers the TOKEN mods,
    // which never reach a bin at all (CR 410.4c: a token has no card of its own) and
    // so have no sweep to announce them.
    const tokenMods = mods.filter(m => m.token);
    if (tokenMods.length) {
      this.ev('erased', `${tokenMods.map(m => m.card).join(', ')} — erased with ${u.card}: a token mod has no card to bin.`,
        { seat: binSeat, cards: tokenMods.map(m => m.card) });
    }
    for (const m of mods) delete this.s.entities[m.id];
  }

  /**
   * `opts.binTo` (CR 405.3, 801.2e) redirects the bin the dying card enters — Pull Under
   * ("delete target unit; it and its mods go to YOUR bin"). It has to be an
   * argument rather than a fix-up afterwards: the bin push and the trash
   * attribution are one and the same decision ("a card is trashed by the owner
   * of the bin it enters"), and the 'trashed' event fires synchronously from
   * here, queueing its triggers and bumping the per-battle ledger, long before
   * card code regains control. A compensating second trashed(caster) would
   * double-count the ledger and double-fire "when I am trashed" (Dropslime,
   * Nothyr, Murkstalker). The engine's Unstable route (CR 405.5 differs, CT-246) made `binTo` matter for an Unstable unit too:
   * that one now reaches a bin like everything else, so Pull Under's "it and
   * its mods go to YOUR bin" is the bin the trash is attributed to even when
   * the pair is erased out of it a statement later.
   *
   * CR 803.8e — the branch ORDER is load-bearing, and it used to be wrong. Unstable
   * (`mods.length`) is tested FIRST: an Unstable ANYTHING, token or not, is
   * erased with its mods. The old order tested token-ness first, so a modded
   * token took the token carve-out and never reached the Unstable branch (game
   * UZRG: a Wraith body carrying a Wraith mod died, came back, AND fired its
   * mod's donated death trigger). ⚠ The order still matters for the LOG and
   * for the mods, but it no longer decides whether a bin is touched: the
   * engine merged the two destinations into one path (CR 405.5 keeps them apart, CT-246).
   *
   * CR 410.5a — a dying TOKEN really does enter its owner's bin, and is then
   * erased by a state-based sweep. CR 801.2d: it is NOT trashed there — a token is
   * not a card, and `noteTrashed` returns before any trash for it. Its entry is
   * still real for anything that reads the bin inside the event window
   * (Caleb 2025-03-12 / 2025-06-15: "yes, for the purposes of triggers";
   * "technically it does enter … and then gets erased immediately"). The erase
   * lands before any trigger RESOLVES — fireEvent only queues — which is the
   * timing Caleb gave (2023-09-12: "state based effects happen to erase it and
   * then the trigger goes on the stack").
   *
   * Unstable is a BIN replacement, not a death replacement (Caleb 2025-03-13,
   * 2025-04-08: "unstable units still die, they just get erased instead of
   * ending up in the bin"), so every branch below fires 'died'.
   *
   * **Engine (the owner's call, 2026-08-24; CR 801.2h differs, CT-246) — an Unstable unit that dies IS TRASHED.** It
   * takes the token's route (into the bin, `died`, then the sweep) PLUS the
   * trash a card gets and a token no longer does (CR 801.2d): `trashed` (ledger and
   * "when I am trashed" and every watcher), then the state-based sweep erases
   * it. The destination a player SEES is unchanged — the erased pile — and the
   * bin is empty again before anything queued resolves.
   *
   * ⚠ This DIVERGES from two sources and the divergence is recorded, not
   * smoothed over (see CR 801.2h, which follows the print, and CT-246). Abyssal Evocation and
   * Spell Excavation print *"(If they would enter a bin, erase them
   * instead.)"*, and Caleb 2025-04-08 says *"Unstable units still die, they
   * just get erased instead of ending up in the bin"* — both describe the
   * DESTINATION, and both read naturally as "no bin, therefore no trash",
   * which is what this method used to do. The owner overruled them because the
   * engine already says the same words about a TOKEN (*"Technically it does
   * enter your hand and then gets erased immediately… So it would trigger any
   * 'enters hand' stuff"*) and still runs it through the bin. Two disposals
   * that end in the same erased pile behaved differently, and playtest #93
   * (room ANBB) is what that looks like at the table: Dropslime trashed from
   * hand zapped for 2, and the SAME Dropslime dying under a grafted Wraith
   * fired nothing. Tokens no longer being trashed (CR 801.2d) removed the token half of that symmetry —
   * a token enters the bin but is not trashed — and the owner's 2026-08-24 CONCLUSION stands
   * without it: the Dropslime in #93 was a card, and a card entering a bin
   * from play is trashed whatever happens to it next — in the engine; CR 801.2h disagrees for an Unstable card (CT-246).
   *
   * ⚠ The MODS used to ride the same rule and NO LONGER DO — **the mods ruling (owner,
   * 2026-08-29, report #129) overruled the Unstable-trash ruling's "The mods ride with it"
   * section**, which was reasoning rather than a log (the ANBB mod was a
   * Wraith, which has no card to trash either way). *"When a mod goes onto a
   * unit, it becomes PART of that unit."* So a nontoken mod erased with its
   * {Unstable} host is NOT trashed — it never had a presence of its own — and
   * the earlier counter-argument (that the same mod would behave differently
   * depending on how its host left play) is answered by the difference being
   * real: recalled or cached, the mod is left behind in a bin and STAYS there,
   * so it is trashed (CR 801.2f, Caleb 2024-09-15); erased with its host, it goes
   * where the host goes. What the mods ruling did NOT touch is the BODY, three paragraphs
   * up: in the engine an {Unstable} carrier that dies is still binned and still trashed (CR 801.2h: erased instead, not trashed; CT-246).
   * A TOKEN mod still has no card of its own (CR 407.3a) and only reaches the
   * erased pile.
   *
   * `opts.keepBinned` is the one card that OVERRIDES the Unstable sweep: Pull
   * Under prints "put it and all of its mods into your bin", and the engine's
   * long-standing reading is that the card's own destination wins. Before the trash-through-the-bin change
   * that override was card code doing its own `toBin` after destroy() erased
   * everything; now destroy() already bins and trashes, so the override is
   * simply "do not run the sweep". A TOKEN body is still swept — Pull Under
   * moves cards, and a token has none (CR 410.5).
   */
  destroy(u: Entity, verb: 'dies' | 'is deleted' | 'is sacrificed',
    opts: { binTo?: Seat; keepBinned?: boolean } = {}): void {
    if (!this.entity(u.id)) return;
    this.stampLastKnown(u);                     // CR 714.1
    delete this.s.entities[u.id];
    // resolved BEFORE the disposal runs — a mod id whose entity is
    // already gone is not a mod any more, and disposeToBin deletes them last.
    const mods = u.mods.map(id => this.entity(id)).filter((m): m is Entity => !!m);
    // CR 410.7: push, announce, trash, sweep, erased-pile, delete — the whole tail
    // is `disposeToBin`, shared verbatim with Hooba-Mon's exchange. Everything
    // left here is what makes this disposal a DEATH rather than some other way
    // of leaving play: the verb, the 'died' event, and the formation collapse.
    this.disposeToBin(u, mods, ({ binSeat, binIndex, unstable }) => {
      // CR 714.9: every fact a death listener could want RIDES THE EVENT (see
      // leftPlayFacts) — `verb` (Ghord's "sacrificed", which used to
      // string-match the log message) is the death-only extra.
      //
      // Engine: `to` is 'bin' for EVERY death now, Unstable included (CR 801.2h erases an Unstable card instead; CT-246) — the same
      // answer a dying token already gave (CR 410.5a). It reports where the card
      // is DURING the event window, which is what a listener can act on; where
      // it ends up is announced by the 'erased' event a few statements later.
      //
      // CR 405.6: a 'died' listener that reaches into the bin for the card it just
      // saw die (Biomass Devourer erases it OUTRIGHT) needs to name the exact
      // copy, and only the disposal knows which one it is. `seat` on a death
      // event is the CONTROLLER while the card bins to its OWNER, so the bin's
      // seat is stamped too — the pair (binSeat, binNth) is CR 405.6's bin
      // identity, the same one `noteTrashed` stamps on 'trashed', read back by
      // `eventBinSlot`.
      const evData: Record<string, unknown> = {
        ...this.leftPlayFacts(u), verb, to: 'bin',
        binSeat, binNth: binNthAt(this, binSeat, binIndex),
      };
      // CR 602.5c: hold the death event ITSELF, not "whatever the last event was".
      // removeFromFormation() below can now log a formation collapse, and a
      // trailing `this.events[length-1]` would hand every "when I die" trigger
      // that log line instead of the death it is listening for.
      // ⚠ The message must read the SWEEP CONDITION, not `unstable` alone.
      // These are not the same question: the sweep below runs on
      // `unstable && !opts.keepBinned`, and Pull Under ("put it and all of its
      // mods into your bin") passes keepBinned precisely to suppress it. Before
      // 2026-08-25 this line asked only `unstable`, so Pull Under on a modded
      // victim logged `…, then ERASED — Unstable (it and its 1 mod(s)).` while
      // BOTH cards sat in the caster's bin and the erased pile was empty — the
      // log flatly contradicting the state. That is not cosmetic: whether a
      // card is recoverable from a bin is a real play decision, and the log is
      // where a player reads it.
      const willSweep = unstable && !opts.keepBinned;
      const evDied = this.ev('died',
        `${u.card} ${verb} → ${binSeat === u.owner ? 'bin' : `${this.pname(binSeat)}'s bin`}`
        + (willSweep
          ? (mods.length
            ? `, then ERASED — Unstable (it and its ${mods.length} mod(s)).`
            : ', then ERASED — Unstable.')
          : unstable
            ? (mods.length
              ? `, and STAYS with its ${mods.length} mod(s) — the card's own destination overrides the Unstable sweep.`
              : ", and STAYS — the card's own destination overrides the Unstable sweep.")
            : u.token ? ', then erased (token).' : '.'),
        evData);
      // formation cleanup + back-row promotion + CR 602.5c column collapse
      // (state-based, no response window)
      this.removeFromFormation(u.id);
      if (this.s.phase === 'battle') {
        this.bumpBattleCounter(u.region, `allyDeaths:${u.controller}`);
      }
      // fire the death BEFORE erasing the mod entities: the dying unit's mods
      // still count as sources of donated "[Augment] when I die" text (the
      // fireEvent mod scan resolves u.mods through the entity table, which is
      // why disposeToBin deletes them only at the very bottom)
      // CR 803.7m: the tally Vengeance's banner counts, and it is WITNESSED, not
      // global — a death counts for you only if you were standing in the
      // region it happened in (owner, 2026-09-20: "YOU need to be in a region
      // for it to see the death... during combat, it will see all deaths").
      // `presentSeats` is that exact idea and already exists: a region holds
      // its owner, plus whoever attacked into it, until regroup sends them
      // home. So a sacrifice in the opponent's own deployment is invisible to
      // you, and everything that dies in a battle is seen by both sides.
      //
      // Incremented HERE, at the single point that announces a death, so it
      // can never disagree with what a "when I die" trigger saw — and before
      // fireEvent, so a listener reading the count sees its own batch-mate.
      const seen = (this.s.deathsSeen ??= this.s.players.map(() => 0));
      for (const watcher of this.s.regions[u.region]?.presentSeats ?? []) {
        seen[watcher] = (seen[watcher] ?? 0) + 1;
      }
      this.fireEvent('died', evDied, u);
    }, opts);
  }

  /**
   * CR 410.2a — AN EXCHANGE. `u` leaves play and `name` arrives in its place,
   * taking its region and, in battle, its exact formation slot.
   *
   * > *"It's not a death, but it is a despawn and trashing. Weird corner
   * > case."* (Bena, 2026-08-25.)
   *
   * That sentence is the whole method, and it is why an exchange cannot be
   * `destroy()`:
   *
   *  · NOT A DEATH. No 'died' event, so no death trigger fires — not the
   *    exchanged unit's own "when I die", not an ally's "whenever an ally
   *    dies", not the enemy's "whenever a unit dies", and no battle
   *    `allyDeaths` bump. The card was not killed; it was swapped out.
   *  · IS A DESPAWN. A 'despawned' event, fired (not merely logged) anchored
   *    on the departing entity, so "whenever a unit despawns" hears it and the
   *    unit's OWN donated [Augment] text is scanned — an earlier round repaired exactly this when the announce logged a despawn it never
   *    fired and every despawn watcher in the game was blind to an exchange.
   *  · IS A TRASHING. Which is `E.disposeToBin`, unchanged and shared verbatim
   *    with `destroy()`: push the nontoken mods, push the body, announce,
   *    trash the body anchored (CR 714.9) — and the mods too unless the sweep is
   *    about to erase them (CR 720.8a) — sweep by slot index highest-first if the
   *    body is {Unstable} (the engine's route; CR 405.5 erases instead, CT-246), else sweep a token body (CR 410.5), file the
   *    token mods on the erased pile (CR 407.3a), delete the mod entities last.
   *
   * ⚠ WHY IT IS HERE and not in card code. It was a module-private function in
   * batch-dark-b.ts serving Hooba-Mon, while Necromorph — the other exchange
   * in the pool, and the one whose own printed text says "Exchange" — called
   * `destroy(victim, 'is deleted')` and fired every death trigger in the
   * region. CR 410.2a makes them one behaviour, and the codebase's own lesson
   * (three rounds of repairing a hand-copy of the
   * disposal tail) says the fix for two routes that must agree is ONE method,
   * not a second copy. `test/135-exchange-and-zones.test.ts` spies on this to
   * prove both cards call it.
   *
   * `controller` is who the REPLACEMENT enters play under: its own controller
   * for Necromorph ("in its controller's bin" — the victim's side keeps it),
   * the triggering unit's controller for Hooba-Mon. Returns the fresh unit, or
   * null when `u` was already gone.
   */
  exchangeInPlace(u: Entity, name: CardName, controller: Seat): Entity | null {
    if (!this.entity(u.id)) return null;
    // resolved BEFORE `u` leaves the table, exactly as destroy() does —
    // a mod id whose entity is already gone is not a mod any more
    const mods = u.mods.map(id => this.entity(id)).filter((m): m is Entity => !!m);
    const b = this.s.battle;
    let slot: { col: EntityId[]; idx: number } | null = null;
    if (b) {
      for (const col of [...b.columns, ...Object.values(b.blocks)]) {
        const idx = col.indexOf(u.id);
        if (idx !== -1) { slot = { col, idx }; break; }
      }
    }
    const outgoing = u.card;
    this.stampLastKnown(u);                     // CR 714.1
    const fresh = this.spawnUnit(controller, name, u.region);
    if (slot) {
      slot.col[slot.idx] = fresh.id;   // take the exact position in play
      this.ev('info', `${name} takes ${outgoing}'s position in the formation.`);
    }
    delete this.s.entities[u.id];
    this.disposeToBin(u, mods, () => {
      // The unslot rides in the announce window because it belongs there:
      // after the pushes, before the trashes. `removeFromFormation` is the
      // wrong call — its CR 602.5 gap-closing would be looking at a column that has
      // no gap, because `fresh` is standing in it — so this is the plain
      // detach, for the other columns and the sent-attacker list.
      if (b) {
        for (const col of [...b.columns, ...Object.values(b.blocks)]) {
          const i = col.indexOf(u.id);
          if (i !== -1) col.splice(i, 1);
        }
        const si = b.sentAttackers.indexOf(u.id);
        if (si !== -1) b.sentAttackers.splice(si, 1);
      }
      // CR 410.2: logged AND fired. Anchored on `u`, so its own donated
      // [Augment] text is scanned. `u.card` is read live — CR 410.3's
      // revertFace ran at the top of disposeToBin, so a transformed body
      // announces its despawn under the front face it is really leaving as.
      const ev = this.ev('despawned', `${u.card} is exchanged for ${name}`
        + (mods.length ? ` (its ${mods.length} mod(s) leave with it).` : '.'),
        { ...this.leftPlayFacts(u), to: 'bin' });
      this.fireEvent('despawned', ev, u);
    });
    return fresh;
  }

  /**
   * CR 713.5 — THE state-based sweep that erases a token the instant after it
   * enters a zone. Pull ONE copy of `name` back out of `seat`'s bin, hand or
   * cache and record it in the public erased pile (CR 407.2). No-op if it is not
   * there (a trigger's `when` cannot move it, but a resolved sweep run twice
   * must not eat a second copy).
   *
   * Generalised from the bin-only `eraseFromBin` on 2026-08-22: the zone is a
   * parameter because the RULING is about zones in general — *"technically it
   * does enter your hand and then gets erased immediately"* (Caleb
   * 2025-06-15). `destroy()`, `recall()` and `cacheUnit()` all call this one
   * method; there is deliberately no second erase path.
   *
   * `at` names the EXACT entry when the caller knows it, which is the only way
   * to be sure a sweep takes the copy it just put there:
   *
   *  · `at.uid` — a cache entry (`CachedCard.uid`). The cache is the one zone
   *    whose entries are not bare names, and the caller minting the entry
   *    always knows which one it just made.
   *  · `at.index` — a BIN slot (CR 405.6). A bin holds bare card NAMES, so a name
   *    search there answers "the last copy of that name in this bin NOW", which
   *    is the copy the caller pushed only by luck of ordering. `destroy` knows
   *    exactly where it pushed and says so. A named slot that no longer holds
   *    `name` means GONE — the erase is a no-op and deliberately does NOT fall
   *    back to a name search, because falling back is how an innocent older
   *    copy of the same card gets erased out of the game (CR 405.6).
   *
   * Without `at`, both zones still search by name, for the callers that
   * genuinely have no handle (a white-box erase, a card naming a card).
   */
  eraseFromZone(seat: Seat, name: CardName, zone: 'bin' | 'hand' | 'cache', msg: string,
    at?: { uid?: number; index?: number }): void {
    if (zone === 'cache') {
      const i = at?.uid !== undefined ? this.cacheIndexOf(seat, at.uid)
        : this.cache(seat).map(cc => cc.card).lastIndexOf(name);
      if (i === -1) return;
      this.uncache(seat, i);
    } else if (zone === 'bin') {
      const bin = this.player(seat).bin;
      const i = at?.index !== undefined
        ? (bin[at.index] === name ? at.index : -1)   // CR 405.6: a mismatch is "gone", never a search
        : bin.lastIndexOf(name);
      if (i === -1) return;
      this.removeFromBin(seat, i, 'erased');   // CR 405.7: the one bin-removal path
    } else {
      const hand = this.player(seat).hand;
      const i = hand.lastIndexOf(name);
      if (i === -1) return;
      hand.splice(i, 1);
    }
    this.ev('erased', msg, { seat, card: name, from: zone });
  }

  private removeFromFormation(id: EntityId): void {
    const b = this.s.battle;
    if (!b) return;
    for (const col of [...b.columns, ...Object.values(b.blocks)]) {
      const i = col.indexOf(id);
      if (i !== -1) col.splice(i, 1);
    }
    const si = b.sentAttackers.indexOf(id);
    if (si !== -1) b.sentAttackers.splice(si, 1);
    // CR 602.5c: closing the gap is part of leaving the formation, not a follow-up
    // somebody has to remember. removeFromFormation() is the ONLY way a unit
    // leaves a column (destroy / recall / cacheUnit all funnel through it), so
    // the empty column never survives past the statement that made it empty.
    this.repairFormation();
  }

  /**
   * CR 711.1: `to` gains control of unit `u`. The one control-change primitive —
   * four card batches used to carry their own copy, and they disagreed.
   *
   * - Its MODS change controller with it (Bena 2026-08-23: "a stolen unit's
   *   mods are part of the unit, so yes, they go with them to the unit's new
   *   controller — that's the whole point of some of the viruses which force
   *   units to flip flop controllers"). Owner never changes.
   * - It leaves any formation it was in, through removeFromFormation, so the
   *   CR 602.5b column collapse happens here too (the local copies skipped it).
   * - Regions are exclusive: if the new controller is not present where the
   *   unit stands (a deployment-time steal out of the owner's home), the unit
   *   and its mods go to the new controller's home now rather than sitting
   *   in a region its controller is not in until regroup walks it there.
   *   Mid-battle both seats are present and it stays on the board.
   * Returns false when nothing changed hands (unit gone, or already theirs).
   *
   * The two things that changed here, both driven by CT-38/CT-39:
   *
   * `opts.keepFormation` is the ONE deviation any printed card has needed, and
   * it exists for exactly one shape: a symmetric EXCHANGE. The unslot is here
   * because a unit that changes sides would otherwise stand in a formation its
   * new controller does not own — "Exchange control of two target units and
   * swap their positions" (Organic Exchange) preserves that invariant by
   * construction, because each unit takes the OTHER's slot, which is a slot on
   * its new controller's side. Such a caller re-slots both units itself and
   * passes `keepFormation` so the choke point does not undo the swap. Any
   * caller that is not re-slotting must leave it alone.
   *
   * It emits a real dispatched `controlChanged` (CT-39) instead of the
   * `info` line it used to, so "whenever you gain control of a unit" is a
   * listenable seam. Same message, so the game log is unchanged. Region-scoped
   * per CR 101.6 the ordinary way — `data.region` is the unit's region AFTER any
   * relocation above, so both seats present there hear it and nobody else
   * does — and `data.unit` makes the moved unit the event's source, so a
   * `self:` listener on the unit that just changed hands matches.
   *
   * ⚠ **CR 711.3 — A UNIT STOLEN MID-BATTLE SITS OUT UNTIL REGROUP. THIS IS A
   * RULING, NOT A LIMITATION.** Owner, 2026-08-25, asked about Download
   * ("Gain control of target token", a `{Battle}` spell, so the theft can land
   * with the formations already declared): *it sits out until regroup* — the
   * unit changes controller IMMEDIATELY, is OUT of the formation for the rest
   * of this battle, and joins its new controller's side at regroup.
   *
   * That is what the two statements below already do, and they must be left
   * alone. The `removeFromFormation` above unslots it and never re-slots it;
   * regroup then sends every unit to `homeRegion(e.controller)` and tears the
   * battle down, so the very next battle builds the thief's formation with the
   * stolen unit on it. **Do not "fix" this into a mid-battle re-slot.** There
   * is no re-slot primitive because none is wanted: a unit that appeared in a
   * declared line after blocks were answered would break the printed "after blocks,
   * columns will not move" (CR 602.5a) as surely as a collapsing column would. Pinned by
   * `145-erase-routes.test.ts`, the two Download cases.
   *
   * The batch-metal-a header used to file this under "ENGINE APPROXIMATIONS …
   * cannot slot it into the thief's (no mid-battle formation-join primitive)".
   * The behaviour was right; only the label was wrong.
   */
  giveControl(u: Entity, to: Seat, opts?: { keepFormation?: boolean }): boolean {
    if (!this.entity(u.id)) { this.ev('info', `${u.card} is gone — nothing changes hands.`); return false; }
    if (u.controller === to) { this.ev('info', `${this.pname(to)} already controls ${u.card} — nothing changes hands.`); return false; }
    const from = u.controller;
    u.controller = to;
    for (const id of u.mods) { const m = this.entity(id); if (m) m.controller = to; }
    if (!opts?.keepFormation) this.removeFromFormation(u.id);
    if (!this.s.regions[u.region]!.presentSeats.includes(to)) {
      u.region = this.homeRegion(to);
      for (const id of u.mods) { const m = this.entity(id); if (m) m.region = u.region; }
    }
    const ev = this.ev('controlChanged', `${this.pname(to)} gains control of ${u.card} (from ${this.pname(from)}).`,
      { unit: u.id, card: u.card, from, to, region: u.region });
    this.fireEvent('controlChanged', ev);
    return true;
  }

  /**
   * CR 603.5a — the key for a battle counter that belongs to ONE attacking column
   * ("this column has already connected twice this battle"). Column indices
   * MOVE when the formation collapses, so a counter keyed by a bare index
   * silently changes which column it describes. Build the key through here and
   * repairFormation() carries it across the collapse; build it by hand and it
   * does not.
   */
  colCounterKey(ci: number, name: string): string { return `col:${ci}:${name}`; }

  /**
   * Manual, "HOLD THE LINE": *"If the last unit in a column is removed from a
   * formation, the columns on its sides will close in to fill the gap. **This
   * only happens before blocks are declared. After blocks, columns will not
   * move to fill gaps.**"*
   *
   * The engine had no such window: the first build ran the collapse as an
   * unconditional state-based action, including between damage sub-steps.
   */
  private beforeBlocksDeclared(): boolean {
    const b = this.s.battle;
    if (!b) return false;
    return b.step === 'declare' || b.step === 'attackWindow' || b.step === 'blocks';
  }

  /**
   * CR 602.4, 602.5 — the two halves of formation GRAVITY, which have DIFFERENT timing
   * rules. That asymmetry is printed, and it is the whole of this rule.
   *
   * *"When a column becomes empty during combat, the columns to the right
   * should immediately collapse and fill the gap."* (game BRDM, 2026-08-20) —
   * the report that found it, answered by the Manual's "HOLD THE LINE":
   *
   *  1. **Vertical, always.** *"If a unit is removed from a formation, any
   *     units behind it move to the front row and take its place."* No
   *     qualifier, so this holds at every moment, mid-combat included. Splicing
   *     the dead id out of the dense column array IS the promotion, and it is
   *     also why *"the front row of a column must be filled first"* can be
   *     relied on as an invariant rather than checked (CR 602.3).
   *  2. **Horizontal, only before blocks are declared.** *"If the last unit in
   *     a column is removed … the columns on its sides will close in to fill
   *     the gap. This only happens before blocks are declared. After blocks,
   *     columns will not move to fill gaps."* Once the defender has answered,
   *     the line is locked: an emptied column stays as a HOLE for the rest of
   *     the battle.
   *
   * The Manual makes an earlier ⚠ dissolve. A blocker whose attackers all died
   * needed a special case — Bena, 2026-08-21: *"It stays, but has nothing to
   * deal damage to, so it doesn't deal damage. But it stays in the formation
   * for the blocker, which means there's a 'hole' in the attackers
   * formation."* Under (2) that is not a special case at all: blocks have been
   * declared, so nothing moves. All that survives of the ruling is the damage
   * half, in `combatSubStep`.
   *
   * The horizontal half is a **re-key**, and that is the hard part:
   * `BattleState.blocks` is keyed by attack-column INDEX, so the index is the
   * column's identity. `rekeyColumns` is the single owner of that move — every
   * block entry and every column-scoped counter shift together, in one commit,
   * with no engine event and no trigger in between. Column ARRAY OBJECTS are
   * kept, never rebuilt: card code holds column references (`columnOf`) and
   * compares them by identity.
   *
   * Called from removeFromFormation() — so no observer, not even a `when`
   * predicate evaluated inside fireEvent, ever sees a half-repaired line — and
   * again at the end of checkDeaths(), the state-based sweep, which is the
   * backstop for the several cards that edit `b.columns` directly.
   */
  repairFormation(): void {
    const b = this.s.battle;
    if (!b) return;
    // (1) vertical gravity: a column holds units that are in play, and nothing
    // else. Untimed — this runs whatever the step.
    for (const col of [...b.columns, ...Object.values(b.blocks)]) {
      for (let i = col.length - 1; i >= 0; i--) if (!this.entity(col[i]!)) col.splice(i, 1);
    }
    // (2) horizontal gravity: the line closes ranks ONLY before blocks are
    // declared. After that a gap is permanent, and so is every column index.
    if (!this.beforeBlocksDeclared()) return;
    const keep: number[] = [];
    // CR 606.4: a column with a block entry is part of the line even when it is
    // empty — a side-block's column is opened empty, inside the declaration
    for (let ci = 0; ci < b.columns.length; ci++) {
      if (b.columns[ci]!.length || b.blocks[ci] !== undefined) keep.push(ci);
    }
    if (keep.length === b.columns.length) return;          // no gap to close
    const remap = new Map<number, number>();
    keep.forEach((oldCi, ni) => remap.set(oldCi, ni));
    // did anything actually MOVE? dropping a trailing column shifts nobody, and
    // an announcement for it would just be noise on top of the death that
    // caused it.
    const shifted = keep.some((oldCi, ni) => oldCi !== ni);
    const dropped = b.columns.length - keep.length;
    const cols = keep.map(ci => b.columns[ci]!);            // the same array objects
    // ONE commit: the re-key lands whole. Nothing between these two statements
    // yields, so no observer can see half of it.
    this.rekeyColumns(oldCi => remap.get(oldCi) ?? null);
    b.columns = cols;
    if (shifted) {
      this.ev('info',
        `The formation closes up: ${dropped} empty column(s) removed, ${cols.length} left.`,
        { region: b.region, columns: cols.length });
    }
  }

  /**
   * CR 603.5a — THE re-key, and the only one. Every index-keyed thing hanging off
   * an attacking column moves through here in a single commit: `blocks`, whose
   * key IS the column's identity, and the column-scoped battle counters
   * (colCounterKey). `to(oldCi)` answers the column's new index, or null when
   * it is ceasing to exist.
   *
   * The caller assigns `b.columns` itself, immediately after — the two halves
   * are separate statements only because the column list is built differently
   * for a collapse (filter) than for an insertion (splice).
   */
  private rekeyColumns(to: (oldCi: number) => number | null): void {
    const b = this.s.battle!;
    const blocks: Record<number, EntityId[]> = {};
    for (const [k, v] of Object.entries(b.blocks)) {
      const ni = to(Number(k));
      if (ni !== null) blocks[ni] = v;                     // the same array object
    }
    const ledger = this.s.battleCounters[b.region];
    if (ledger) {
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(ledger)) {
        const m = /^col:(\d+):([\s\S]*)$/.exec(k);
        if (!m) { next[k] = v; continue; }                 // not column-scoped
        const ni = to(Number(m[1]));
        if (ni === null) continue;                         // the column is gone; so is its ledger
        next[this.colCounterKey(ni, m[2]!)] = v;
      }
      this.s.battleCounters[b.region] = next;
    }
    // CR 802.15f {Alluring}: a must-block duty names an attack COLUMN, so the column's
    // identity is the duty's identity and it moves in the same commit as
    // `blocks`. A duty whose column ceases to exist ceases with it — that is
    // the mechanism behind "kill the allurer and the block is freed"; the
    // can't-attack half is the presence of the mark, and stays.
    for (const u of Object.values(this.s.entities)) {
      const a = u.allured;
      if (!a || a.round !== b.round) continue;
      a.columns = a.columns.map(to).filter((ci): ci is number => ci !== null);
    }
    if (b.sideCols) b.sideCols = b.sideCols.map(to).filter((ci): ci is number => ci !== null);
    // CR 608.2e: a column's struck-marks are the column's, so they move with it
    if (b.struck) {
      const struck: NonNullable<BattleState['struck']> = {};
      for (const [k, v] of Object.entries(b.struck)) {
        const m = /^(atk|blk):(\d+)$/.exec(k);
        const ni = m ? to(Number(m[2])) : null;
        if (m && ni !== null) struck[`${m[1]}:${ni}`] = v;
      }
      b.struck = struck;
    }
    b.blocks = blocks;
  }

  // ── CR 602.6: joining a formation ────────────────────────────────────────
  //
  // "When something spawns something 'in my formation' or 'in formation', it's
  // up to the controller of the effect to choose where the unit goes. They can
  // put it to either side of the existing units OR in the second slot of a
  // column for a column which only has 1 unit. That choice should be made on
  // effect resolution." (Bena, 2026-08-21.)
  //
  // Before this, every card did its own thing: Hooba-Bot joined "my column if
  // open, else the first open column", Hooba-Lin joined its own column or
  // opened one on the right, Hooba-God only ever used its own column, and only
  // Tiderunner Initiate actually asked. One rule, one primitive.

  /**
   * CR 602.6a — every legal place a unit could join `seat`'s formation, left to
   * right. Not a target (nothing prints "target"): the caller offers these at
   * RESOLUTION, the way an untargeted "an ally" is chosen.
   *
   * Three kinds, and the first two are the ruling as printed:
   *  · a NEW column at either END. "Either side of the existing units" is read
   *    as the two ENDS, not as an insertion between two existing columns — see
   *    the rules entry, this is a reading.
   *  · the BACK slot of a column that holds exactly one unit.
   *  · the front slot of a HOLE (CR 602.5a) — a column emptied of attackers that its
   *    blockers are holding open. This is the one kind the ruling does not
   *    enumerate, and it is kept because the engine already offered it
   *    (Tiderunner Initiate) and because it is the only way a formation ever
   *    heals a hole. It cannot CREATE a hole, so it cannot break CR 602.5a.
   *
   * A formation you are not standing in cannot be widened: with no living unit
   * in the grid there is no formation to join, and the answer is no slots at
   * all rather than "open a column out of nowhere".
   */
  /**
   * the formation grid `seat` fights in, `[column][row]`, front row
   * first: the attacking columns as the attacker, the blocking columns as the
   * defender (ordered by the attacking column each answers). One derivation,
   * so `formationSlots`, `adjacentSlots` and `adjacentInFormation` cannot
   * disagree about what the grid is.
   */
  private formationGrid(seat: Seat): EntityId[][] {
    const b = this.s.battle;
    if (!b) return [];
    if (seat === b.attacker) return b.columns;
    if (seat === b.defender) {
      return Object.keys(b.blocks).sort((a, z) => Number(a) - Number(z)).map(k => b.blocks[Number(k)]!);
    }
    return [];
  }

  /**
   * `spot` is the same placement expressed as something that SURVIVES the
   * board moving under it — the play-time placement of CR 602.7 is chosen at cast and
   * taken at resolution, and by then a column may have collapsed, widened or
   * lost its occupant (CR 602.7a). A raw index into this list would silently
   * become a different slot; the descriptor is re-matched against a freshly
   * computed list instead, and simply fails to match when the spot is gone.
   */
  formationSlots(seat: Seat): { col: EntityId[] | null; end?: 'left' | 'right'; block?: number; label: string; spot: FormationSpot }[] {
    const b = this.s.battle;
    if (!b) return [];
    const attacker = seat === b.attacker;
    const grid = this.formationGrid(seat);
    const flash = this.flashBlockSlots(seat);
    if (!grid.some(col => col.some(id => this.entity(id)))) return flash;
    const out: { col: EntityId[] | null; end?: 'left' | 'right'; block?: number; label: string; spot: FormationSpot }[] = [];
    // Only the ATTACKING grid can widen. A blocking column is keyed to an
    // attacking column (CR 602.6c), so a new one has no index to exist at.
    if (attacker) {
      out.push({ col: null, end: 'left', label: 'a new column on the left', spot: { kind: 'end', end: 'left' } });
    }
    // The LABEL numbers columns the way the board does: by the attacking
    // column each one stands opposite. The defender's grid is only its
    // blocking columns, so its index i is not that number once a block skips
    // a column or a side-block opens one (CR 606.4) — the bar said "column 3" for
    // what the board drew as column 5. `spot` keeps the grid index.
    const keys = attacker ? null : Object.keys(b.blocks).map(Number).sort((a, z) => a - z);
    grid.forEach((col, i) => {
      const alive = col.filter(id => this.entity(id));
      const n = (keys ? keys[i]! : i) + 1;
      if (alive.length === 1) {
        out.push({
          col, label: `column ${n}, behind ${this.entity(alive[0]!)?.card ?? '?'}`,
          spot: { kind: 'behind', unit: alive[0]! },
        });
      } else if (alive.length === 0) {
        out.push({
          col, label: `column ${n} (an empty slot in the line)`,
          spot: { kind: 'hole', column: i },
        });
      }
    });
    if (attacker) {
      out.push({ col: null, end: 'right', label: 'a new column on the right', spot: { kind: 'end', end: 'right' } });
    }
    return [...out, ...flash];
  }

  /**
   * CR 607.2 — a unit put into the DEFENDING formation after blocks may stand in
   * front of an UNBLOCKED attacking column, and it blocks it. The RAQ ("What
   * is blocked?"), _passer: *"If there is unblocked column and during 'after
   * block' window as defender I put Tiderunner Initiate as blocker, the column
   * is blocked?"* — Caleb: *"I think it would be considered blocked even
   * against an empty column"*, and (4) it stays blocked once that unit is
   * removed, like any block. Offered from the moment blocks are declared until
   * combat damage is over; before that the block step itself is the place.
   * Offered even with no blockers yet: the defending formation may be started
   * here.
   */
  private flashBlockSlots(seat: Seat): { col: null; block: number; label: string; spot: FormationSpot }[] {
    const b = this.s.battle;
    if (!b || seat !== b.defender) return [];
    if (b.step !== 'blockWindow' && b.step !== 'damageWindow') return [];
    const out: { col: null; block: number; label: string; spot: FormationSpot }[] = [];
    b.columns.forEach((col, ci) => {
      if (b.blocks[ci] !== undefined || !col.some(id => this.entity(id))) return;
      out.push({ col: null, block: ci, label: `column ${ci + 1}, blocking it (it is unblocked)`, spot: { kind: 'block', column: ci } });
    });
    return out;
  }

  /**
   * CR 602.6e — WHICH FORMATION a unit is standing in: the seat whose grid holds
   * it, or null when it is standing in none at all (it died, or it is in the
   * region beside the line and was never slotted). Derived from
   * `formationGrid`, so it cannot disagree with `formationSlots` or
   * `adjacentSlots` about what a grid is.
   *
   * This exists because "in MY formation" on a printed card is a REFERENT
   * computed at resolution off the SOURCE (CR 602.6e), never off the source's SEAT.
   * The two differ whenever the source is not in the line — and the counting
   * half of the family already read it that way (`columnOf` on Hooba-Nan and
   * Rousing Spirit, CR 714.8's X = 0) while the PLACING half read the seat's grid.
   * That asymmetry was the bug in report FTUW/45.
   */
  formationSeatOf(id: EntityId): Seat | null {
    const b = this.s.battle;
    if (!b) return null;
    // CR 714.4 (the earlier dead-source reading is reversed): a source that left play
    // "remembers it was in formation" — its last-known formation, while the
    // battle it stood in is still on
    const lk = this.lastKnownOf(id);
    if (lk) return lk.formationSeat !== null && lk.region === b.region ? lk.formationSeat : null;
    for (const seat of [b.attacker, b.defender]) {
      if (this.formationGrid(seat).some(col => col.includes(id))) return seat;
    }
    return null;
  }

  /**
   * CR 602.6e — the open slots of the formation `id` is standing in, and none at
   * all when it is standing in no formation: a source that is not in the line
   * names no formation, so "in my formation" has nowhere to point.
   */
  myFormationGrid(id: EntityId): EntityId[][] {
    const seat = this.formationSeatOf(id);
    return seat === null ? [] : this.formationGrid(seat);
  }

  myFormationSlots(id: EntityId):
  { col: EntityId[] | null; end?: 'left' | 'right'; block?: number; label: string; spot: FormationSpot }[] {
    const seat = this.formationSeatOf(id);
    return seat === null ? [] : this.formationSlots(seat);
  }

  /** the live slot `spot` names right now, or null if the board moved and it
   * no longer names one (CR 602.7a — re-derived, never remembered as an index) */
  private slotForSpot(seat: Seat, spot: FormationSpot): { col: EntityId[] | null; end?: 'left' | 'right'; block?: number; label: string } | null {
    if (spot.kind === 'out') return null;
    const same = (s: FormationSpot): boolean => {
      if (s.kind !== spot.kind) return false;
      if (s.kind === 'end' && spot.kind === 'end') return s.end === spot.end;
      if (s.kind === 'behind' && spot.kind === 'behind') return s.unit === spot.unit;
      if (s.kind === 'hole' && spot.kind === 'hole') return s.column === spot.column;
      if (s.kind === 'block' && spot.kind === 'block') return s.column === spot.column;
      return false;
    };
    return this.formationSlots(seat).find(s => same(s.spot)) ?? null;
  }

  /**
   * CR 606.4a — open `left` empty attacking columns on the left and `right` on the
   * right, for side-blocks to stand opposite. The Manual: *"Units may even be
   * placed blocking in slots where attackers aren't"*; Caleb, on the RAQ: eight
   * units may side-block "as a separate column" each. A blocking column is
   * keyed to an attacking one (CR 602.5a), so a side-block gets an EMPTY attacking
   * column — the same permanent hole CR 602.5a leaves when an attack column dies —
   * and the two grids stay one index space. Through the one re-key, so blocks,
   * counters, Alluring duties and struck-marks all move together.
   */
  openSideColumns(left: number, right: number): void {
    const b = this.s.battle!;
    if (!left && !right) return;
    const n = b.columns.length;
    const cols = [...Array.from({ length: left }, () => [] as EntityId[]), ...b.columns,
      ...Array.from({ length: right }, () => [] as EntityId[])];
    this.rekeyColumns(oldCi => oldCi + left);
    b.columns = cols;
    const opened = [...Array.from({ length: left }, (_, i) => i),
      ...Array.from({ length: right }, (_, i) => left + n + i)];
    b.sideCols = [...(b.sideCols ?? []), ...opened];
  }

  /** put `u` into `slot`. The one place a unit is written into the grid.
   * Public for Hooba-Nan (CR 603.3), which fills `adjacentSlots`' answers — an
   * existing column is held by its array (a left-insert keeps the object), and
   * an end is re-read when it is filled, so several fills can go in any order. */
  putInSlot(u: Entity, slot: { col: EntityId[] | null; end?: 'left' | 'right'; block?: number }): void {
    const b = this.s.battle!;
    if (slot.col) { slot.col.push(u.id); return; }
    // CR 607.2: a new blocking column in front of an unblocked attacker — its key
    // is the column it blocks, and from now on that column is blocked
    if (slot.block !== undefined) { b.blocks[slot.block] = [u.id]; return; }
    // CR 603.5a: opening a column on the LEFT shifts every existing column
    // right, so every block key and every column-scoped counter shifts with
    // it. One atomic re-key, same owner as the collapse.
    const at = slot.end === 'left' ? 0 : b.columns.length;
    const cols = b.columns.slice();
    cols.splice(at, 0, [u.id]);
    this.rekeyColumns(oldCi => (oldCi >= at ? oldCi + 1 : oldCi));
    b.columns = cols;
  }

  /**
   * CR 602.7 — take the spot this card was PLAYED into, before it is anywhere else.
   *
   * Called from inside spawnUnit, between minting the entity and firing
   * 'spawned', so the unit is already standing in the formation the first time
   * any listener or any player sees it. That is the whole difference between
   * this and `placeInFormation` (CR 602.6): that is an EFFECT resolving ("create a
   * unit in my formation"), and its unit really does exist for a moment before
   * it is placed. A card whose printed text is "you may PLAY me into an open
   * spot" is never played anywhere else, so it must never be seen anywhere
   * else — playtest UFAB, where Tiderunner Initiate spawned into the region,
   * stacked a placement trigger, handed the opponent priority, and got recalled
   * out of the invader's zone before it ever reached the line.
   *
   * Returns the log line for what happened, which spawnUnit emits under the
   * spawn. Every branch has one: silence here is a conformance failure.
   */
  private takeSpot(u: Entity, seat: Seat, spot: FormationSpot): string {
    const b = this.s.battle;
    if (!b || u.region !== b.region) {
      return `${u.card} is played, but there is no formation here to join — it enters the region.`;
    }
    if (spot.kind === 'out') return `${u.card} is played outside the formation, by choice.`;
    const slot = this.slotForSpot(seat, spot);
    if (!slot) {
      // CR 602.7a: chosen at cast, taken at resolution — and the line moved.
      return `${u.card}: the open spot it was played into is gone — it enters the region, outside the formation.`;
    }
    this.putInSlot(u, slot);
    return `${u.card} is played straight into the formation (${slot.label}).`;
  }

  /**
   * CR 603.2a — ADJACENCY, written down once. *"If a unit references its own adjacent
   * slots (which only exist if it's in a formation) it's referring to its sides
   * and above/below. Nothing diagonal."* (Bena, 2026-08-21.)
   *
   * So, relative to a unit at grid position (column ci, row ri):
   *  · (ci - 1, ri) — the neighbouring column, SAME ROW
   *  · (ci + 1, ri) — likewise on the other side
   *  · (ci, 1 - ri) — the other slot in its OWN column (above / below)
   * and nothing else. The other row of a neighbouring column is diagonal and
   * is NOT adjacent. `E.adjacentInFormation` is the same definition read for
   * units rather than for slots.
   *
   * This returns the EMPTY ones — the fillable positions — and two readings are
   * baked in:
   *
   *  1. **CR 603.3: past the edge of the line IS a slot — on the attacking side.**
   *     *"The columns to the left and right, even when empty, DO technically
   *     exist, which is why you can create things into them."* (Bena,
   *     2026-09-25, report YUZY.) So a front-row unit at either end of the
   *     ATTACKING line has an empty adjacent slot beyond it: the front row of a
   *     new column, the same two ends `formationSlots` offers. It is only the
   *     front row — the back row of a column that does not exist yet is
   *     unreachable (point 2), so a back-row unit gets nothing past the edge.
   *     A BLOCKING line cannot widen at all (a blocking column is keyed to an
   *     attacking one, CR 603.3b), so its edges stay closed. The earlier reading closed the edges from 2026-08-21 to 2026-09-25.
   *  2. **The front row fills first**, always: `removeFromFormation` promotes
   *     the back row, `repairFormation` splices dead ids out, and every
   *     placement appends. A column is therefore `[]`, `[front]` or
   *     `[front, back]` and never `[empty, back]`. A slot is fillable only when
   *     the column's next free row IS that row (`col.length === row`), which
   *     makes the back slot of a column whose front is empty unreachable rather
   *     than a case to handle: a unit put there would slide to the front, and
   *     the front of a neighbouring column is diagonal.
   *
   * An edge slot comes back with `col: null` and its `end`, the same shape
   * `formationSlots` uses, so `putInSlot` opens the column through the one
   * re-key.
   */
  adjacentSlots(id: EntityId): { col: EntityId[] | null; end?: 'left' | 'right'; row: number; label: string }[] {
    const u = this.entity(id);
    const b = this.s.battle;
    if (!u || !b) return [];
    const grid = this.formationGrid(u.controller);
    let ci = -1, ri = -1;
    for (let i = 0; i < grid.length; i++) {
      const r = grid[i]!.indexOf(id);
      if (r !== -1) { ci = i; ri = r; break; }
    }
    if (ci === -1) return [];
    // CR 603.3: only the attacking line can open a column past its end
    const widens = u.controller === b.attacker && ri === 0;
    const out: { col: EntityId[] | null; end?: 'left' | 'right'; row: number; label: string }[] = [];
    const take = (c: number, r: number, label: string): void => {
      const col = grid[c];
      if (!col) {                          // past the edge of the line (CR 603.3)
        if (!widens) return;
        const end = c < 0 ? 'left' : 'right';
        out.push({ col: null, end, row: 0, label: `a new column on the ${end}` });
        return;
      }
      if (col.length !== r) return;        // taken, or unreachable (the front fills first)
      out.push({ col, row: r, label });
    };
    take(ci - 1, ri, `column ${ci}, ${ri === 0 ? 'front' : 'back'} row`);
    take(ci, 1 - ri, `column ${ci + 1}, behind ${u.card}`);
    take(ci + 1, ri, `column ${ci + 2}, ${ri === 0 ? 'front' : 'back'} row`);
    return out;
  }

  /**
   * CR 602.6, 602.6d — put `u` into `ctx.controller`'s formation, letting them choose where.
   * Auto-picked when exactly one placement is legal; a logged no-op when none
   * is. `optional` adds a "stay out of formation" answer (Tiderunner Initiate,
   * whose printed text is "you MAY play me into an open spot").
   *
   * Every branch logs. An effect that resolves into silence is a bug the
   * conformance suite fails on, and "there was nowhere to put it" is exactly
   * the kind of thing a player needs told.
   *
   * Returns true when the unit actually joined.
   *
   * ⚠ CR 602.6e — `opts.sourceId` IS THE FORMATION, and every card call site must
   * pass it (`108-formation-class` scans them and reddens on one that does
   * not). "In my formation" is a referent read off the SOURCE ENTITY at
   * resolution, so the slots come from the grid THAT UNIT is standing in, and
   * a source standing in no grid names no formation. `opts.source` is a
   * DISPLAY STRING and can never answer that question — handing it the name
   * and reading the seat's grid instead is what let a Hooba-Lin standing in no
   * formation place a token (report FTUW/45). The seat fallback survives only
   * for an effect with genuinely no unit behind it.
   *
   * Since 2026-10-09 (CR 714.4) FTUW's DEAD-source half is reversed: a source that left
   * play "remembers it was in formation" (RAQ, Dead Unit Effect on Stack), so
   * `formationSeatOf` answers from its last-known state. A source alive and
   * out of the line (CR 711.3) still names none.
   */
  placeInFormation(u: Entity, ctx: Pick<EffectCtx, 'controller' | 'choose'>,
    opts: { key?: string; source?: string; sourceId?: EntityId; optional?: boolean } = {}): boolean {
    const b = this.s.battle;
    const src = opts.source ?? u.card;
    if (!b || u.region !== b.region) {
      this.ev('info', `${src}: there is no formation here for ${u.card} to join.`);
      return false;
    }
    // CR 602.6e: whose grid — the SOURCE's, when there is a source entity.
    const seat = opts.sourceId !== undefined ? this.formationSeatOf(opts.sourceId) : ctx.controller;
    if (seat === null) {
      this.ev('info',
        `${src}: it is not in a formation, so there is no formation of mine for ${u.card} to join.`);
      return false;
    }
    const slots = this.formationSlots(seat);
    if (!slots.length) {
      this.ev('info',
        `${src}: no open position in the formation — ${u.card} stays in the region, outside it.`);
      return false;
    }
    // #107: `value` stays the INTEGER INDEX — the answer namespace every saved
    // game is keyed on — and `spot` rides along as the display-only spelling
    // of the same option, so a client can draw the drop target on the line.
    const options: DecisionOption[] = slots.map((s, i) => ({ label: s.label, value: i, spot: s.spot }));
    if (opts.optional) options.push({ label: 'stay out of formation', value: -1, spot: { kind: 'out' } });
    // BL-24: NOT kind 'electricPath' — that kind's numeric option values are
    // raw entity ids by contract (CR 802.17), and these are slot INDEXES. The client
    // pings/previews a numeric electricPath value as a unit on the board, so
    // the slot buttons lit up whichever units happened to own ids 0..N.
    const pick = options.length === 1 ? 0 : ctx.choose(opts.key ?? 'placeInFormation', {
      kind: 'formationSlot', seat: ctx.controller,
      prompt: `${src}: where does ${u.card} join the formation?`,
      options,
    }) as number;
    const slot = pick >= 0 ? slots[pick] : undefined;
    if (!slot) {
      this.ev('info', `${src}: ${u.card} stays out of the formation.`);
      return false;
    }
    this.putInSlot(u, slot);
    this.ev('info', `${src}: ${u.card} joins the formation (${slot.label}).`,
      { unit: u.id, region: b.region, seat: ctx.controller });
    return true;
  }

  /**
   * Recall: the unit leaves play WITHOUT dying (Manual: to its owner's hand;
   * mods go to their owners' bins).
   *
   * `opts.to` redirects the destination HAND — "put target unit into YOUR
   * hand" (Capture) is a recall to the caster's hand rather than the owner's,
   * and that is the only thing that card changes. `opts.verb` is the log's
   * wording for the same ("put into"). Both exist so there is exactly one
   * leave-play-to-a-hand routine; the card sets used to carry a line-for-line
   * copy of this method (`putIntoHand`), and it drifted — it never stamped
   * the leave-play `to` (CR 714.9), so Capture triggered no "a card entered a hand" watcher at all.
   *
   * CR 410.5b (settled for the hand 2026-08-22): a recalled TOKEN really does
   * enter the hand — *"Technically it does enter your hand and then gets erased
   * immediately. So it would trigger any 'enters hand' stuff."* (Caleb
   * 2025-06-15; and 2025-04-24, asked whether recalling a spell token triggers
   * Rider of the Tides: *"Oh dang yeah it should also trigger it."*) So the
   * event says `to: 'hand'` for a token too, and the SAME state-based sweep
   * `destroy()` uses takes it back out — after the event window, before
   * anything queued in it resolves.
   *
   * CR 801.2: the recalled card is never trashed — a hand is not a bin. Its mods do
   * enter a bin, from play, and STAY there, so a nontoken mod IS trashed — in
   * afterDespawn(), after the despawn event, for log order — by the HOST's
   * controller, into that controller's bin (CR 801.2f, 410.4a).
   */
  recall(u: Entity, opts: { to?: Seat; verb?: string } = {}): void {
    const mods = this.leavePlay(u);
    if (!mods) return;
    // CR 801.7a (round-32 Q2): `u.controller`, was `u.owner`. The owner extended
    // his earlier *"there's no issue with taking opponent's cards and putting them
    // into your zones"* to all four per-seat destinations — *"(a) All four
    // follow control — one rule, no seam."* A stolen unit recalled therefore
    // bounces into the THIEF's hand.
    //
    // ⚠ THIS IS A REAL POWER CHANGE AND IT WAS ARGUED BOTH WAYS. The Manual
    // says a recall goes to its owner's hand, and "I use your unit until end
    // of turn" becoming "I keep your card" is strictly stronger. It was put to
    // the owner with that argument spelled out and he took the sweep anyway,
    // because the primary format is a shared pool.
    //
    // ⚠ OWNERSHIP DOES NOT MOVE, only the destination. `u.owner` still says
    // whose card it is and `leftPlayFacts` still reports it — CR 400.4a, 400.4c, and in
    // CONSTRUCTED the owner is always the player who brought the card, which
    // is the one place the distinction can still matter.
    const seat = opts.to ?? u.controller;
    const verb = opts.verb ?? 'recalled to';
    // CR 714.9: facts ride the event (see leftPlayFacts). `to` is where the card
    // went, which is what "when a unit is recalled to a HAND" wants to read —
    // it used to be recovered by matching the word "hand" in the log message.
    const evData = { ...this.leftPlayFacts(u), to: 'hand', hand: seat };
    // CR 402.4: the card really enters the hand, so it goes through the ONE hand
    // entry point and announces itself as 'handEntered' — BEFORE the
    // 'despawned' line. (afterDespawn() is now HANDED that event, rather than
    // recovering it as `events[length-1]`; this call appends events of its own
    // and the ordering that made the index right was never enforced.)
    // Both events fire for one recall and they are different facts; the three
    // "a card enters a player's hand" cards read only the second one now, so
    // nothing double-counts.
    this.toHand(seat, u.card, 'play', { unit: u.id, token: !!u.token });
    const ev = this.ev('despawned',
      `${u.card} is ${verb} ${this.pname(seat)}'s hand`
      + (mods.length ? ` (its ${mods.length} mod(s) → bin)` : '')
      + (u.token ? ', then erased (token).' : '.'),
      evData);
    this.afterDespawn(u, mods, ev);
    // CR 410.5b's sweep, on the hand this time
    if (u.token) this.eraseFromZone(seat, u.card, 'hand', `${u.card} is erased from the hand — it is a token.`);
  }

  /** Ambush resolution (Manual p.40): recall the target ally, spawn the
   * ambusher directly into its position in play (formation slot included). */
  ambushSwap(target: Entity, name: CardName, controller: Seat): void {
    const region = target.region;
    // find the formation slot before anything moves
    const b = this.s.battle;
    let slot: { col: EntityId[]; idx: number } | null = null;
    if (b) {
      for (const col of [...b.columns, ...Object.values(b.blocks)]) {
        const idx = col.indexOf(target.id);
        if (idx !== -1) { slot = { col, idx }; break; }
      }
    }
    const u = this.spawnUnit(controller, name, region);
    if (slot) slot.col[slot.idx] = u.id;      // take the exact slot…
    this.recall(target);                      // …then the target leaves play
    if (slot) this.ev('info', `${name} takes ${target.card}'s position in the formation.`);
  }

  // ── targets ─────────────────────────────────────────────────────────
  /**
   * Every legal target for `spec`, right now, in `region`. The single source
   * of truth for what may be aimed at: the chooser's option list, `castable`'s
   * "can this even be played" gate, and `canFillSlot`'s redirect check all
   * come through here, so a restriction added to a card is enforced in all
   * three at once (CR 110.3a, 110.9).
   *
   * `ally` is the EFFECT's controller — the seat "ally"/"enemy"/"opponent" is
   * measured from, never the chooser's (CR 110.4c). `sourceId`, when given, is the
   * entity the effect comes from, for restrictions that read it.
   */
  targetCandidates(spec: TargetSpec, region: number, excludeStackId?: number, ally?: Seat, sourceId?: EntityId, x?: number, chosen?: ResolvedTarget[], event?: EngineEvent | null): TargetRef[] {
    const out = this.targetFamilyCandidates(spec, region, excludeStackId, ally);
    const cands = this.compelledTargets(out, region, chosen);
    // CR 110.3a: the printed RESTRICTION, judged against the resolved target. It
    // runs last so it never has to re-derive what `what` already settled.
    const restrict = spec.restrict;
    if (!restrict) return cands;
    const ctx: TargetCtx = {
      ...(ally !== undefined ? { ally } : {}), region,
      ...(sourceId !== undefined ? { sourceId } : {}), ...(x !== undefined ? { x } : {}),
      ...(chosen ? { chosen } : {}),
      ...(event !== undefined ? { event } : {}),   // CR 110.1a: "that player's bin"
    };
    return this.restrictTargets(out, cands, restrict, ctx);
  }

  /**
   * CR 110.7 (CT-207) — CAN EVERY REQUIRED SLOT BE FILLED, WITH DISTINCT TARGETS?
   *
   * The RAQ ("[Solved] Target requirements to put effect on stack."): _passer,
   * "You cannot play Fight if there isn't 2 units in the region (one of which
   * must be an allied unit)"; Caleb on Tidal Reversion, "You can't play it if
   * one player doesn't have a valid target". The gate used to ask slot 0 only.
   *
   * A required slot is one below `min`. Each is judged the way the collector
   * will judge it — its own spec, the earlier picks as `chosen` (Fight's
   * "another", Tidal Reversion's one-per-player), never a target already
   * taken — and the search backtracks, because the first legal pick for slot 0
   * can be the one that leaves slot 1 empty. A count of X is not known before
   * the cast, so only the fixed slots and one counted slot are required then.
   *
   * CR 702.3a, 702.3c (report #211): X is chosen BEFORE targets, so a restriction
   * that reads X ("target unit with cost [x] or less", Abduct) is judged at a
   * given X. `xs` is every X the play could be declared with (`castXChoices`);
   * the slots are fillable if they are at SOME of them. Omitted, the restriction
   * sees no X — right for a play that has none. The counted-slot rule above is
   * deliberately x-independent, so for a restriction that does not read X every
   * X answers alike and the first one settles it.
   */
  requiredSlotsFillable(spec: TargetSpec, region: number, ally: Seat, sourceId?: EntityId,
    xs?: readonly number[]): boolean {
    // CR 110.7, CT-303: `min: 'X'` requires every counted slot, so how many is a
    // question about the X being judged — X = 3 against one legal unit is not
    // fillable, X = 0 is fillable at nothing. Any other X spec keeps the
    // x-independent rule above (one counted slot).
    const needAt = (x: number | undefined): number => targetMinimum(spec,
      spec.count !== 'X' ? (spec.count ?? 1) : spec.min === 'X' && x !== undefined ? x : 1);
    // The counted slots of a `count: 'X'` spec are interchangeable, so a run of
    // them is searched as a SET — picks in one canonical order, and a run with
    // fewer candidates left than slots fails at once. Searched as sequences, an
    // X above the candidate count tried every ordering before failing (10 units
    // at X = 11 is 10! paths), and this runs inside legalActions.
    const sameSlot = (a: number, b: number): boolean =>
      slotWhat(spec, a) === slotWhat(spec, b) && slotRestrict(spec, a) === slotRestrict(spec, b);
    const fill = (x: number | undefined, i: number, picked: TargetRef[]): boolean => {
      const need = needAt(x);
      if (i >= need) return true;
      const taken = new Set(picked.map(r => JSON.stringify(r)));
      const chosen = picked.map(r => this.resolveTargetRef(r)).filter((t): t is ResolvedTarget => t !== null);
      const cands = this.targetCandidates(specForSlot(spec, i), region, undefined, ally, sourceId, x, chosen)
        .filter(c => !taken.has(JSON.stringify(c)));
      if (spec.count !== 'X') return cands.some(c => fill(x, i + 1, [...picked, c]));
      const last = picked.length > 0 && i > 0 && sameSlot(i, i - 1) ? JSON.stringify(picked[picked.length - 1]) : undefined;
      const ahead = last === undefined ? cands : cands.filter(c => JSON.stringify(c) > last);
      let run = 1;
      while (i + run < need && sameSlot(i, i + run)) run++;
      if (i + run === need && ahead.length < run) return false;
      return ahead.some(c => fill(x, i + 1, [...picked, c]));
    };
    return xs === undefined ? fill(undefined, 0, []) : xs.some(x => fill(x, 0, []));
  }

  /**
   * CR 107.2a, 702.3a — every X `name` could be played with right now: from its
   * floor (CR 111.10i, raised by a Stasis Sentry) up to the open mana, keeping
   * only the values whose WHOLE bill (CR 202.5, cost modifiers included) is
   * payable. The one list both the castability gate and `collectX`'s menu read,
   * so the gate can never accept a play on an X the menu will not offer.
   */
  manaXChoices(seat: Seat, name: CardName, region: number): number[] {
    const min = this.xFloor(seat, name, { region });
    const open = this.openMana(seat);
    const out: number[] = [];
    for (let x = min; x <= open; x++) {
      if (this.manaToPlay(seat, name, { region, x }) <= open) out.push(x);
    }
    return out;
  }

  /**
   * CR 702.3a — every X a VARIABLE bracketed cost ("[Sacrifice X units]", "[x]")
   * could be paid at right now: its floor up to the most the payer can afford,
   * asked of `canPayCastCost` one size at a time (payability is monotone in the
   * size for every cost kind). Capped, because a life cost has no natural
   * ceiling below a very large number.
   */
  variableCostXChoices(seat: Seat, cost: CastCost, region: number, handReserve = 0,
    sourceId?: EntityId, manaReserve = 0): number[] {
    if (costAmount(cost) !== null || !('n' in cost)) return [];
    const out: number[] = [];
    for (let k = costXMin(cost); k <= 99; k++) {
      if (!this.canPayCastCost(seat, { ...cost, n: k } as CastCost, region, handReserve, sourceId, manaReserve)) break;
      out.push(k);
    }
    return out;
  }

  /** Stage one of `targetCandidates`: everything `spec.what` reaches, family
   * by family in a fixed order (units, players, stack, cache, bin) — the
   * order is the chooser's option order, so it must not move. */
  private targetFamilyCandidates(spec: TargetSpec, region: number, excludeStackId: number | undefined, ally: Seat | undefined): TargetRef[] {
    const out: TargetRef[] = [];
    this.pushUnitTargets(out, spec, region, ally);
    this.pushPlayerTargets(out, spec, region, ally);
    this.pushStackTargets(out, spec, excludeStackId);
    this.pushCachedCardTargets(out, spec, region);
    this.pushBinCardTargets(out, spec, ally);
    this.pushFormationTargets(out, spec, region);
    return out;
  }

  /**
   * CR 110.3d: "target formation" — one candidate per SIDE of the battle running in
   * this region, in attacker-then-defender order (deterministic on replay).
   *
   * Owner, 2026-08-25: a formation is THE WHOLE SIDE, "a player's entire
   * formation in that region, every unit arrayed there". So there are exactly
   * two of them during a battle and none outside one — a {Battle} spell is the
   * only thing that can print "target formation" in the first place.
   *
   * An EMPTY side is still a formation and still a legal target: the ruling
   * describes a place units are arrayed, not a nonempty set, and a card that
   * counts them is entitled to count zero. Appended LAST so the existing
   * families keep the option order `targetFamilyCandidates` promises.
   */
  private pushFormationTargets(out: TargetRef[], spec: TargetSpec, region: number): void {
    if (spec.what !== 'formation') return;
    const b = this.s.battle;
    if (!b || b.region !== region) return;
    out.push({ formation: b.attacker }, { formation: b.defender });
  }

  /** CR 602.1c: every unit currently arrayed in `seat`'s formation — the attacking
   * columns if they are the battle's attacker, the blocking columns if they
   * are its defender. Read LIVE (CR 602.6h, 602.5: the grid moves), and the one place
   * "which units are in that formation" is answered. */
  formationUnits(seat: Seat): Entity[] {
    const out: Entity[] = [];
    for (const col of this.formationGrid(seat)) {
      for (const id of col) {
        const u = this.entity(id);
        if (u) out.push(u);
      }
    }
    return out;
  }

  private pushUnitTargets(out: TargetRef[], spec: TargetSpec, region: number, ally: Seat | undefined): void {
    if (spec.what === 'unit' || spec.what === 'any' || spec.what === 'allyUnit'
      || spec.what === 'enemyUnit' || spec.what === 'token') {
      for (const u of this.unitsIn(region)) {
        if (spec.what === 'allyUnit' && u.controller !== ally) continue;
        if (spec.what === 'enemyUnit' && u.controller === ally) continue;
        if (spec.what === 'token' && !u.token) continue;
        out.push({ unit: u.id });
      }
    }
    // CR 300.5c: a spell TOKEN is a token too — Arcane Echo copies one and Download
    // steals one, and both are printed "target token" with no unit clause.
    if (spec.what === 'token') {
      for (const t of this.s.regions[region]!.presentSeats.flatMap(seat => this.tokensOf(seat, region))) {
        out.push({ unit: t.id });
      }
      // CR 304.11d / CT-215: …and a spell token already CAST is still a token. The
      // RAQ ("Download. What is a token"): "Fireball effect 'on the stack' ✅".
      // Its spell COPIES are not (Earthbound Replicator, Maelstrom Charger:
      // ❌) — a copy keeps the original's kind and is marked `copy`, so the
      // kind test below leaves it out by construction.
      for (const it of this.s.stack) {
        if (it.kind === 'spellToken' && !it.copy && it.region === region) out.push({ stack: it.id });
      }
    }
  }

  /**
   * CR 601.4c — THE SEATS A CARD MAY SEE: the ones present in `region`, in a stable
   * order (initiative first).
   *
   * **Owner ruling, 2026-08-29: regions do NOT scope information, but they DO
   * scope "global" things — every card that says "all" is actually "all in
   * this region".**
   *
   * So a card must ask the REGION, not the game. `g.s.players` is the whole
   * table and a card reading it is asserting that a player who is not here
   * counts — which is now wrong for "all bins", for "the player with the
   * highest life", for "an opponent", and for every other superlative or
   * sweep. `219-region-scoped-all.test.ts` asserts that no file under
   * `src/cards/` reaches for `g.s.players` at all, so the rule cannot be
   * quietly opted out of one card at a time.
   *
   * ⚠ THIS IS NOT THE INFORMATION RULE. CR 601.4d scopes what an effect may REACH
   * and this scopes what it may COUNT; neither hides anything. The log stays
   * fully public to both seats — `server/view.ts::visibleToSeat` gates on
   * `data.privateTo` and on nothing else, deliberately, and CR 601.8's companion
   * guard pins that it stays that way.
   *
   * The order is initiative-first because two cards had already grown their
   * own local copy of this helper (batch-dark-a, batch-wood-b) and one of them
   * ordered it that way; a sweep that asks players in a stable order is
   * replay-safe, and an order that depends on `presentSeats`' internal
   * mutation history is not.
   */
  seatsHere(region: number): Seat[] {
    const present = this.s.regions[region]?.presentSeats ?? [];
    return [this.initiative, this.nit].filter(s => present.includes(s));
  }

  /**
   * WHO WOULD BE HERE IF THIS UNIT WERE IN A BATTLE — the seat list a
   * `CardBehavior.previewNote` is handed.
   *
   * ⚠ PRESENTATION ONLY. Nothing in the rules may call this. It is the one
   * place allowed to look past the unit's current region, and it exists so
   * that a CARD never has to: CR 101.6 forbids a card reading `g.s.players`, and a
   * preview that reached around that to peek at the table would be exactly the
   * hole the guard exists to keep shut. Asking here, once, keeps the rule
   * absolute and the answer consistent.
   *
   * A battle is fought between the two seats of a game, so this is every seat
   * — which is honest for the 1v1 the owner asked about and is the only shape
   * `createGame` builds. If seats ever outnumber two, "who you will meet"
   * stops being knowable in advance and this must start returning null rather
   * than guessing; `221-preview-note.test.ts` §3 fails the day that changes,
   * so it cannot rot quietly.
   */
  seatsInBattleWith(_u: Entity): Seat[] | null {
    const seats = this.s.players.map((_p, i) => i as Seat);
    return seats.length === 2 ? seats : null;
  }

  private pushPlayerTargets(out: TargetRef[], spec: TargetSpec, region: number, ally: Seat | undefined): void {
    // CR 110.3c: 'player' is "target player" with no ownership clause — you are a
    // legal target for your own (Soul Siphon's X is the life SOME player lost,
    // and aiming it at yourself is a real, if usually bad, choice).
    if (spec.what === 'any' || spec.what === 'opponent' || spec.what === 'player') {
      for (const seat of this.s.regions[region]!.presentSeats) {
        if (spec.what === 'opponent' && seat === ally) continue;
        out.push({ player: seat });
      }
    }
  }

  private pushStackTargets(out: TargetRef[], spec: TargetSpec, excludeStackId: number | undefined): void {
    if (spec.what === 'stackSpell' || spec.what === 'stackEffect') {
      for (const it of this.s.stack) {
        if (it.id === excludeStackId) continue;   // CR 704.4: a negated item is not here to skip
        // CR 700.1a: "spell effect" is `isSpellEffect` — never a hand-copied kind
        // list. An Ambush is NOT one (report #218): a plain "target effect"
        // reaches it, "target spell effect" does not.
        const spellish = isSpellEffect(it.kind);
        // CR 700.1, 700.1a (owner, 2026-08-24): "ANYTHING on the stack is an effect,
        // including units and spell units. Units aren't spells, so if they say
        // 'spell effect' a unit would be unaffected." So 'stackEffect' is
        // EVERY item on the stack with no kind test at all — the earlier carve-out for a 'unit' on its way into play is REVERSED. 'stackSpell' is
        // unchanged and still excludes a plain unit: a unit is not a spell.
        if (spec.what === 'stackSpell' ? spellish : true) out.push({ stack: it.id });
      }
    }
  }

  private pushCachedCardTargets(out: TargetRef[], spec: TargetSpec, region: number): void {
    // CR 403.2: the cache is PUBLIC, so an opponent's cache IS a legal target
    // (Prismatic Observer exists precisely to answer an opponent's
    // nearly-fulfilled prophecy) — but only where the opponent IS. CR 403.6: a
    // player's cache is reachable exactly when that player is PRESENT in the
    // region the effect resolves in, the same `presentSeats` test
    // pushPlayerTargets makes for "target player". During deployment each
    // seat is alone in its own region (CR 101.6: other regions do not exist), so
    // only the caster's own cache is offered; in battle both seats are
    // present and both caches are. Owner, live report 2026-09-05 (VNNW): the
    // Observer "allowed me to target an opponent's card while I was in
    // deployment. During deployment, they don't exist, neither does their
    // region or cached cards (during battle, this interaction would be
    // fine)." This used to say "not region-scoped: the cache is not in a
    // region", which was true of the ZONE and wrong about its OWNER.
    // Entries cached before uids existed cannot be targeted.
    if (spec.what === 'cachedCard') {
      for (const seat of this.s.regions[region]!.presentSeats) {
        for (const cc of this.cache(seat)) {
          if (cc.uid !== undefined) out.push({ cached: { seat, uid: cc.uid } });
        }
      }
    }
  }

  private pushBinCardTargets(out: TargetRef[], spec: TargetSpec, ally: Seat | undefined): void {
    // CR 110.3a: a card in YOUR OWN bin ("recall target unit in your bin",
    // "put target unit with cost 2 or less from your bin into play"). Every
    // printed one reaches only the caster's bin, so this does too; a card the
    // restriction wants to reach in an opponent's bin would need `restrict`
    // to say so and this to widen. Duplicates collapse: the bin holds names,
    // and naming a card there IS the reference (BinRef).
    if (spec.what === 'binCard' && ally !== undefined) out.push(...this.binRefs(ally));
    // "target card in A bin" (Collect Remains) — the zone is unowned, so both
    if (spec.what === 'anyBinCard') {
      for (const p of this.s.players) out.push(...this.binRefs(p.seat));
    }
  }

  /** CR 110.12: "I must be targeted if able" (Gatekeeper of Souls) — a restriction
   * that narrows OTHER effects' lists. It is applied BEFORE the spec's own
   * restriction, because "if able" means "if it is a legal target for this
   * effect", and the spec's restriction is part of what decides that: a
   * Gatekeeper with base power 8 cannot compel an Unmake to aim at it.
   *
   * CR 110.12 (report #199): the compulsion is on the EFFECT's targets, not on
   * each slot. A Gatekeeper already among `chosen` (the effect's other
   * slots) has been targeted, so it compels nothing more and the next slot
   * of a Twin Flame is free. Before this, every slot was narrowed to the
   * Gatekeeper again, the duplicate filter then emptied it, and a
   * two-target spell could never aim at anything else.
   *
   * Returns `out` itself (same array, not a copy) when nothing compels, so
   * `restrictTargets` can tell the two cases apart by identity. */
  private compelledTargets(out: TargetRef[], region: number, chosen?: readonly ResolvedTarget[]): TargetRef[] {
    const gates = this.mustBeTargetedIn(region);
    for (const t of chosen ?? []) if (isEntityTarget(t)) gates.delete(t.id);
    let cands = out;
    if (gates.size) {
      const forced = out.filter(r => 'unit' in r && gates.has(r.unit));
      if (forced.length) cands = forced;
    }
    return cands;
  }

  /** Stage two of `targetCandidates`: the printed restriction, in two passes.
   *
   * Pass 1 filters `cands` — the compelled (must-be-targeted) list if there
   * is one, else the whole family list. Pass 2 is the "if able" fallback:
   * when `cands` WAS the compelled list and the restriction emptied it, the
   * Gatekeeper was not a legal target for this effect after all, so the
   * restriction is re-run over the WHOLE list (`out`) instead. The identity
   * check `cands === out` is what tells "nothing was compelled" from "the
   * compelled list survived", so the fallback never runs twice over the same
   * array. */
  private restrictTargets(out: TargetRef[], cands: TargetRef[], restrict: TargetRestrict, ctx: TargetCtx): TargetRef[] {
    const kept = cands.filter(ref => {
      const t = this.resolveTargetRef(ref);
      return t !== null && restrict(this, t, ctx);
    });
    // "if able": a compelled list that the restriction empties falls back to
    // the whole legal list — the Gatekeeper was not a legal target after all
    if (kept.length || cands === out) return kept;
    return out.filter(ref => {
      const t = this.resolveTargetRef(ref);
      return t !== null && restrict(this, t, ctx);
    });
  }

  /**
   * the card a target ref names, when it names one OFF THE BOARD — a bin
   * or cache entry — so the decision option can carry a scan to render.
   *
   * Deliberately empty for a unit/player/stack ref: those are clicked ON THE
   * BOARD (the client highlights them), and giving them a `card` too would
   * paint a second copy of every legal target into the prompt bar.
   */
  private targetCardOf(t: TargetRef): { card?: CardName } {
    if ('bin' in t) return { card: t.bin.card };
    if ('cached' in t) {
      const i = this.cacheIndexOf(t.cached.seat, t.cached.uid);
      return i === -1 ? {} : { card: this.cache(t.cached.seat)[i]!.card };
    }
    return {};
  }

  /** CR 405.6: one ref per CARD IN the bin — copies of one card are separate
   * targets (a two-target spell may reach both), distinguished by `nth`. */
  binRefs(seat: Seat): TargetRef[] {
    const seen = new Map<CardName, number>();
    return this.player(seat).bin.map(card => {
      const nth = seen.get(card) ?? 0;
      seen.set(card, nth + 1);
      return { bin: { seat, card, ...(nth ? { nth } : {}) } };
    });
  }

  /** CR 405.6: where a BinRef points RIGHT NOW — the nth surviving copy of that
   * card, or the last one left if the pile has shrunk past it. -1 if gone. */
  binIndexOf(ref: BinRef): number {
    const bin = this.player(ref.seat).bin;
    const hits: number[] = [];
    bin.forEach((n, i) => { if (n === ref.card) hits.push(i); });
    if (!hits.length) return -1;
    return hits[Math.min(ref.nth ?? 0, hits.length - 1)]!;
  }

  /**
   * CR 723.5: may `ctx.seat` apply that card as an AUGMENT during battle?
   *
   * The default is NO — only a {Virus} from hand may augment during battle —
   * and this is the opt-in that overrides it. Shaped on `mustBeTargetedIn`,
   * the one other BOOLEAN permission query, and on `costModsFor` for
   * everything else: the same `anchored()` walk (units in play plus augment
   * mods, each read from its HOST), the same CR 101.6 region scope, the same
   * shallow CR 712.1a guard, the same reentrancy latch.
   *
   * An OR-FOLD, not a sum, which is why it is not a CostMod: one grantor is
   * enough and a second changes nothing. Ownership and zone are decided by
   * the granting CARD (`ModPermission.augmentInBattle`), not here — Rook
   * prints "from hand and bin", so it is Rook that refuses the cache.
   *
   * ⚠ Both `legalActions` and `apply` MUST route through this one function.
   * The fuzzer's "legalActions lied" check has caught that class of split
   * before, and a permission is exactly the kind of thing that grows a second
   * implementation.
   */
  mayAugmentInBattle(ctx: import('./cards/dsl.ts').ModCtx): boolean {
    if (this.inModPermissions) return false;
    this.inModPermissions = true;
    try {
      const live = this.radiates();
      for (const { holder, anchor } of this.anchored((h, a) =>
        this.donates(h, a, 'modPermissions')                   // CR 710.7: off the FACES
        && a.region === ctx.region
        && live(h, a))) {                                      // CR 712.1a, as staticsFor
        for (const { def } of this.behaviorBlocks(holder, anchor)) {
          for (const p of def.modPermissions ?? []) {
            if (p.augmentInBattle?.(this, anchor, ctx)) return true;
          }
        }
      }
    } finally { this.inModPermissions = false; }
    return false;
  }

  /**
   * CR 504.8a, the HASTE-timing sibling: may `ctx.seat` apply that card as a MOD
   * during the haste step (CR 504) — "[Augment] You can apply other mods during
   * [Haste] as if it was deployment" (Slurpr)?
   *
   * The default is NO: modding is a deployment action (or a battle Virus), and
   * the haste step is neither. This is the opt-in that overrides it, and it is
   * `mayAugmentInBattle` byte for byte apart from the member it reads — same
   * `anchored()` walk (units in play plus augment mods, each read from its
   * HOST), same CR 101.6 region scope, same shallow CR 712.1a guard, same reentrancy
   * latch, same OR-fold.
   *
   * TWO DELIBERATE DIFFERENCES from its twin:
   *
   *  1. NO BASE CASE. `battleAugmentAllowed` starts from the printed rule that
   *     a {Virus} from hand may augment during battle; nothing at all is
   *     printed as haste-timed modding, so the whole permission is the grant.
   *  2. AUGMENTS *AND* GRAFTS. "Mod" is CR 701.2's word for both, so `ctx.kind`
   *     tells the grantor which is being attempted and both call sites fill it
   *     in. A card that wants to grant only one half reads it; Slurpr grants
   *     both and reads neither.
   *
   * CR 504.7a's `hastePlayAllowance` is the PLAY-timing cousin and is deliberately
   * NOT the shape used here: Dispatch Courier prints "Each turn", so plays are
   * summed into a per-turn budget; Slurpr prints no quantity at all, so one
   * grantor is enough, two Slurprs are not twice as permissive, and there is
   * no budget and no GameState field to keep.
   *
   * ⚠ Both `legalActions` and `apply` MUST route through this one function —
   * via apply.ts's `hasteModAllowed`, which is the single predicate the action
   * path and both offer gates share. The fuzzer's "legalActions lied" check
   * has caught that class of split before.
   */
  mayApplyModAtHaste(ctx: import('./cards/dsl.ts').ModCtx): boolean {
    if (this.inModPermissions) return false;
    this.inModPermissions = true;
    try {
      const live = this.radiates();
      for (const { holder, anchor } of this.anchored((h, a) =>
        this.donates(h, a, 'modPermissions')                   // CR 710.7: off the FACES
        && a.region === ctx.region
        && live(h, a))) {                                      // CR 712.1a, as staticsFor
        for (const { def } of this.behaviorBlocks(holder, anchor)) {
          for (const p of def.modPermissions ?? []) {
            if (p.applyAtHaste?.(this, anchor, ctx)) return true;
          }
        }
      }
    } finally { this.inModPermissions = false; }
    return false;
  }

  /**
   * CR 504.7a: how many grant-funded plays may `ctx.seat` make in the HASTE step
   * this turn, for a card whose printed timing is not [Haste]?
   *
   * Report #74 (WEHH, 2026-08-22): "Dispatch Courier didn't give me the option
   * to play a card with haste". It did not, because nothing anywhere asked.
   *
   * The rules half is settled and cited on `PlayPermission` in dsl.ts. This is
   * the arithmetic half, and it is `mayAugmentInBattle` with one
   * difference: it SUMS instead of OR-folding, because the printed text carries
   * a per-turn quantity and two Couriers are two plays. `Infinity` recovers the
   * OR-fold for a grant with no budget.
   *
   * THE TWO GENERAL REFUSALS LIVE HERE, above every grantor, because they are
   * about what gaining [Haste] can do and not about any one card:
   *
   *  1. A {Battle} card stays a battle card. RAQ "[Solved] Dispatch Courier vs
   *     Battle Timing": "No, despite gaining :haste: they can still only be
   *     played during :battle:", and calebgannon in rules-questions on the same
   *     case, "it's gotta be no" / "battle cards are designed to be played in
   *     battle only". A grantor cannot buy its way past this.
   *  2. A printed [Haste] card needs no grant and must not spend one — the
   *     budget is for plays the rules would otherwise refuse. Callers check
   *     `timing === 'haste'` first, and this returns 0 for such a card anyway
   *     so a double-read cannot silently drain the allowance.
   *
   * ⚠ THE UNCONDITIONAL HASTE STEP (CR 504.5) RETIRED THE THIRD GATE. There used to be three that had to agree,
   * and the fatal one was `startHasteStep`'s `canHaste`, which skipped the
   * step outright and so made the other two unreachable — report #74 itself.
   * The step is now unconditional, so TWO gates remain and both are about the
   * OFFER: `legalActions`' haste branch, and `playAtTiming`'s planning branch.
   * The fuzzer's "legalActions lied" check exists for exactly that split, and
   * it never could see the window-vs-offer one the third gate carried.
   */
  hastePlayAllowance(ctx: import('./cards/dsl.ts').PlayCtx): number {
    if (ctx.card.timing === 'haste') return 0;   // needs no grant (see 2 above)
    if (ctx.card.timing === 'battle') return 0;  // RAQ: a battle card stays one
    if (this.inPlayPermissions) return 0;
    this.inPlayPermissions = true;
    try {
      let total = 0;
      const live = this.radiates();
      for (const { holder, anchor } of this.anchored((h, a) =>
        this.donates(h, a, 'playPermissions')                  // CR 710.7: off the FACES
        && a.region === ctx.region
        && live(h, a))) {                                      // CR 712.1a, as staticsFor
        for (const { def } of this.behaviorBlocks(holder, anchor)) {
          for (const p of def.playPermissions ?? []) {
            total += p.playAtHaste?.(this, anchor, ctx) ?? 0;
          }
        }
      }
      return total;
    } finally { this.inPlayPermissions = false; }
  }

  /** CR 504.7a: the boolean the three gates actually ask — is there allowance left
   * this turn? `usedThisTurn` is filled in here so no caller can forget it. */
  mayPlayAtHaste(ctx: Omit<import('./cards/dsl.ts').PlayCtx, 'usedThisTurn'>): boolean {
    const used = this.s.hastePlaysUsed?.[ctx.seat] ?? 0;
    return this.hastePlayAllowance({ ...ctx, usedThisTurn: used }) > used;
  }

  /**
   * CR 504.7: the index in `ctx.seat`'s OWN bin of a card granting this haste-step
   * play at the price of its own erasure ("If I am in your bin, you may play a
   * unit as if it had [Haste] by erasing me as an additional cost to play that
   * unit" — Writhing Host), or -1.
   *
   * NOT folded into `hastePlayAllowance`: a CR 504.7a allowance is free and this
   * grant costs its grantor, so the two must stay distinguishable — the offer
   * (`legalHasteActions`) and the charge (`playAtTiming`'s erase) both need to
   * know WHICH kind of permission funds the play. The two GENERAL refusals
   * (CR 207.4a, 803.2b) are restated above every grantor because they are rulings about what
   * gaining [Haste] can do: a {Battle} card stays a battle card (RAQ
   * "[Solved] Dispatch Courier vs Battle Timing"), and a printed [Haste] card
   * needs no grant — so it must never cost anyone their grantor.
   *
   * FIRST match wins, and that is not deciding for the player: every grantor
   * in the pool is Writhing Host, so two in one bin are fungible — same name,
   * same effect, same erased pile — and an arbitrary pick between identical
   * copies is invisible at the table. A second DISTINCT grantor card would
   * make the choice visible and need an index on the action; none exists.
   */
  binHasteGrantorIndex(ctx: Omit<import('./cards/dsl.ts').PlayCtx, 'usedThisTurn'>): number {
    if (ctx.card.timing === 'haste') return -1;   // needs no grant (refusal 2 above)
    if (ctx.card.timing === 'battle') return -1;  // RAQ: a battle card stays one
    if (this.inPlayPermissions) return -1;        // reentrancy latch
    this.inPlayPermissions = true;
    try {
      return this.player(ctx.seat).bin.findIndex(name =>
        (this.card(name).binPlayPermissions ?? []).some(p => p.playAtHaste?.(this, ctx) === true));
    } finally { this.inPlayPermissions = false; }
  }

  /** CR 504.7a: charge one grant-funded haste-step play to `seat`. The sibling of
   * CR 803.7's `hasteManaSpent` — same array shape, same per-seat/per-haste-step
   * lifetime, zeroed by `startHasteStep` (which is once per turn, and so IS
   * the printed "Each turn"). A play is not an ability activation, so nothing
   * writes `Entity.budgets` for it and this is where the budget lives. */
  chargeHastePlay(seat: Seat): void {
    const tally = (this.s.hastePlaysUsed ??= this.s.players.map(() => 0));
    tally[seat] = (tally[seat] ?? 0) + 1;
  }

  /** CR 110.12: the units in `region` that must be targeted if able. Radiates like
   * a static — live as a unit in play, donated while an augment mod — and is
   * silenced by CR 712.1a exactly as an ability is. */
  mustBeTargetedIn(region: number): Set<EntityId> {
    const out = new Set<EntityId>();
    const live = this.radiates();
    for (const { anchor } of this.anchored((h, a) =>
      this.donates(h, a, 'mustBeTargeted')                      // CR 710.7: off the FACES
      && a.region === region
      && live(h, a))) {                                       // CR 712.1a, as staticsFor
      out.add(anchor.id);
    }
    return out;
  }
  /**
   * CR 110.9: could `ref` legally occupy target slot `ti` of `item`'s part `pi`
   * RIGHT NOW? Used by redirection effects (Enigmatic Warder's "change a
   * target of target effect to me"), which must not be able to drop an
   * illegal target into a slot — the playtest bug was the opponent's Warder
   * moving itself into Fight's "target ALLY" slot, where ally means ally of
   * the SPELL'S controller, not of the Warder's.
   */
  canFillSlot(item: StackItem, pi: number, ti: number, ref: TargetRef): boolean {
    const key = JSON.stringify(ref);
    return this.slotCandidates(item, pi, ti).some(c => JSON.stringify(c) === key);
  }
  /**
   * CR 110.9: every ref that could legally occupy target slot `ti` of
   * `item`'s part `pi` RIGHT NOW — the one question a redirect (Enigmatic
   * Warder, through `canFillSlot`) and a re-choice of targets (Divine
   * Intervention, Gravitational Correction, Hexbane Shiitake, through
   * `rechooseTargets`) must both ask.
   *
   * Judged exactly as the collector judged the slot when it was declared: the
   * slot's OWN spec (`specForSlot` — Fight's ally slot, Channel Through's
   * opponent slot, Necromorph's bin slot), the item's source, X and trigger
   * event, and the part's OTHER targets as `chosen` (Tidal Reversion's "one
   * per player", Necromorph's "cheaper than it"). And no ref already in a
   * SIBLING slot of the same part is ever a candidate: one object cannot be
   * two of one effect's targets (CR 110.6, 110.9, 704.5 — CT-189, the
   * owner's Twin Flame aimed at one Good Whale twice).
   *
   * `targets` is the part's targets as they stand for this question — a
   * re-choice passes its working copy, so a slot already changed earlier in
   * the SAME pass counts as the sibling it now is. `controller` is the seat
   * "ally" is measured from; Hexbane Shiitake re-chooses for the item's
   * controller-to-be. The slot's own current occupant is NOT excluded: it is
   * not a sibling of itself.
   */
  slotCandidates(
    item: StackItem, pi: number, ti: number,
    targets?: readonly TargetRef[], controller: Seat = item.controller,
  ): TargetRef[] {
    const part = item.parts[pi];
    if (!part) return [];
    // card code calls this in a loop over an arbitrary stack item, so an
    // unresolvable key must answer "none", never throw
    let def: EffectDef;
    try { def = effectByKey(part.effectKey); } catch { return []; }
    if (!def.targets) return [];
    const others = (targets ?? part.targets).filter((_, i) => i !== ti);
    const taken = new Set(others.map(t => JSON.stringify(t)));
    return this.targetCandidates(
      specForSlot(def.targets, ti), item.region, item.id, controller, item.sourceId,
      part.costPaid?.x ?? item.x,
      others.map(t => this.resolveTargetRef(t)).filter((t): t is ResolvedTarget => t !== null),
      item.event,   // CR 110.9: a redirect must judge the slot the same way the collector did
    ).filter(c => !taken.has(JSON.stringify(c)));
  }

  /**
   * The name a target is offered and logged under. A UNIT says whose it
   * is. Rashi aimed Discharge at her own Unit Token because the list read
   * "Unit Token, Unit Token" with nothing to tell the two sides apart — the
   * board has generic tokens on both sides of it and identical art, so the
   * option text was the only thing that could have carried the difference.
   */
  targetLabel(t: TargetRef): string {
    if ('unit' in t) {
      const u = this.entity(t.unit);
      return u ? `${u.card} (${this.pname(u.controller)}'s)` : '(gone)';
    }
    if ('player' in t) return this.pname(t.player);
    // CR 110.3d: a formation says WHOSE and which side of the battle it is, because
    // "Rashi's formation" and "Bena's formation" are the whole choice.
    if ('formation' in t) {
      const b = this.s.battle;
      const side = !b ? '' : t.formation === b.attacker ? ' (attacking)'
        : t.formation === b.defender ? ' (blocking)' : '';
      return `${this.pname(t.formation)}'s formation${side}`;
    }
    if ('cached' in t) {
      const i = this.cacheIndexOf(t.cached.seat, t.cached.uid);
      return i === -1 ? '(gone)' : `${this.cache(t.cached.seat)[i]!.card} (${this.pname(t.cached.seat)}'s cache)`;
    }
    if ('bin' in t) {
      // copies are interchangeable but the menu must still show both, so a
      // second copy says so rather than repeating the same line
      const n = t.bin.nth ?? 0;
      return `${t.bin.card}${n ? ` #${n + 1}` : ''} (${this.pname(t.bin.seat)}'s bin)`;
    }
    return this.s.stack.find(i => i.id === t.stack)?.label ?? '(gone)';
  }
  targetStillLegal(t: TargetRef): boolean {
    if ('unit' in t) { const u = this.entity(t.unit); return !!u && !u.absent; }
    if ('player' in t) return true;
    // CR 110.3e: a formation exists exactly while the battle it is a side OF does.
    // Emptying it does NOT remove it (a formation with nobody in it is still
    // the place that player's units stand); the battle ending does — and then
    // the target is lost in the ordinary way (CR 704.6).
    if ('formation' in t) {
      const b = this.s.battle;
      return !!b && (t.formation === b.attacker || t.formation === b.defender);
    }
    if ('bin' in t) return this.binIndexOf(t.bin) !== -1;
    // the entry may have been played, grafted or recalled out of the cache
    // between cast and resolution — then it is simply gone (CR 704.6)
    if ('cached' in t) return this.cacheIndexOf(t.cached.seat, t.cached.uid) !== -1;
    // CR 704.4: a stack target is legal exactly while the item is still ON the
    // stack — negation removes it, so "is it there" is the whole question.
    return this.s.stack.some(i => i.id === t.stack);
  }
  /**
   * CR 704.5 (CT-208) — A TARGET IS RE-CHECKED AGAINST ITS SLOT WHEN THE ITEM RESOLVES.
   *
   * The RAQ, "[Solved] Valid targets becomes invalid.": _passer, "Ambush won't
   * resolve as it's effect 'Recall target ALLY' and that unit is no longer ally
   * of your opponent." An earlier ruling already said re-validate at resolution, but
   * `targetStillLegal` only ever asked whether the target still EXISTS, so the
   * restriction was re-checked only by the cards that did it by hand (Minor
   * Kraken, Throw off a Cliff). Now every slot is: its own kind, its own
   * restriction, the region, and distinct from the slots before it — exactly
   * what the collector asked when it was chosen (Gatekeeper's compulsion
   * excepted: that narrows the CHOICE, it does not make a choice illegal).
   *
   * Judged once, as resolution begins, and recorded on the part (`invalid`),
   * so an earlier part of the same item cannot make a later part's target
   * illegal mid-resolution. A target that left play is an ordinary lost target (CR 704.6, 704.6b) and
   * is not marked here. Units are matched against the slot's family (control,
   * kind, region); bin, cache and stack references are positional and are
   * judged by the restriction alone.
   */
  markIllegalTargets(item: StackItem): void {
    // CR 704.7a: a restriction that reads the source ("cost ≤ units in MY
    // formation") must see its last-known state, which rides this item
    const outerItem = this.partItem;
    this.partItem = item;
    try { this.markIllegalParts(item); } finally { this.partItem = outerItem; }
  }

  private markIllegalParts(item: StackItem): void {
    item.parts.forEach((part, pi) => {
      if (part.spent || !part.targets.length) return;
      if (!effectByKey(part.effectKey).targets) return;
      const bad = part.targets
        .map((ref, ti) => (this.targetStillLegal(ref) && !this.slotLegalNow(item, pi, ti) ? ti : -1))
        .filter(ti => ti >= 0);
      if (bad.length) {
        part.invalid = bad;
        for (const ti of bad) {
          // the unit it is about pulses on the board (the target, else the
          // source), so the line is not log-only (244's CR D7.4 inventory)
          const ref = part.targets[ti]!;
          this.ev('info', `${item.label}: ${this.targetLabel(ref)} is not a legal target any more.`,
            { item: item.id, unit: 'unit' in ref ? ref.unit : item.sourceId });
        }
      }
    });
  }

  /** CR 704.5: may slot `ti` of part `pi` still name what it names? */
  private slotLegalNow(item: StackItem, pi: number, ti: number): boolean {
    const part = item.parts[pi]!;
    const spec = specForSlot(effectByKey(part.effectKey).targets!, ti);
    const ref = part.targets[ti]!;
    const key = JSON.stringify(ref);
    const earlier = part.targets.slice(0, ti);
    if (earlier.some(r => JSON.stringify(r) === key)) return false;          // CR 704.5: "another"
    if ('unit' in ref
      && !this.targetFamilyCandidates(spec, item.region, item.id, item.controller).some(c => JSON.stringify(c) === key)) {
      return false;
    }
    if (!spec.restrict) return true;
    const t = this.resolveTargetRef(ref);
    if (!t) return false;
    const x = part.costPaid?.x ?? item.x;
    const ctx: TargetCtx = {
      ally: item.controller, region: item.region,
      ...(item.sourceId !== undefined ? { sourceId: item.sourceId } : {}),
      ...(x !== undefined ? { x } : {}),
      chosen: earlier.map(r => this.resolveTargetRef(r)).filter((r): r is ResolvedTarget => r !== null),
      ...(item.event !== undefined ? { event: item.event } : {}),
    };
    return spec.restrict(this, t, ctx);
  }

  resolveTargetRef(t: TargetRef): ResolvedTarget | null {
    if (!this.targetStillLegal(t)) return null;
    if ('unit' in t) return this.entity(t.unit)!;
    if ('cached' in t) {
      const cc = this.cache(t.cached.seat)[this.cacheIndexOf(t.cached.seat, t.cached.uid)]!;
      return { cached: { seat: t.cached.seat, uid: t.cached.uid, card: cc.card } };
    }
    // CR 405.6: the bin INDEX is read now, at resolution — cards leave a bin
    // between cast and resolution and the one that matters is wherever the
    // named card sits at this instant.
    if ('bin' in t) {
      return { binCard: { seat: t.bin.seat, index: this.binIndexOf(t.bin), card: t.bin.card } };
    }
    // CR 602.1c: a formation resolves to the SEAT that owns it, never to a grid
    // snapshot — the units in it are read live (E.formationUnits) at the
    // instant the effect asks, which is what CR 602.6h requires, as it did of the
    // proxy this replaced.
    return t as ResolvedTarget;
  }

  // ── the stack & resolution ──────────────────────────────────────────
  pushItem(item: StackItem): void {
    this.s.stack.push(item);
    /**
     * CR 507.5 — A PUSH ONTO A STACK NOBODY MAY RESPOND TO IS A FLASH, NOT A LINE.
     *
     * Round 8, the owner: *"all effects that can't be responded to (like haste
     * or end of turn) happen and resolve instantly so it's very hard to
     * track."* `stackFlash` is the answer to that — a silent signal carrying a
     * snapshot of the item so the client can give it a beat on the strip —
     * and until now it was emitted only by `commitItem`'s no-stack branch.
     *
     * Putting deployment triggers on the real stack took their beat away; the reasoning recorded at the time was that a
     * flash would "draw it twice", once as a flash and once as the live stack
     * row. ⚠ THAT ROW ALMOST NEVER EXISTS. `settle()` drains the deployment
     * stack inside the same action, so a client's next frame sees an empty
     * stack — the row appears only in the one case where the drain stopped on
     * a decision. `ui/flash.ts::stackRows` now drops a flash whose id is
     * already a live row, which makes "draw it twice" impossible and lets the
     * beat come back for everything.
     *
     * And the LINE goes the other way, for the same reason: "X → stack."
     * announces a WINDOW — the item is up, respond or pass. Outside battle
     * there is no window (the deployment ruling: "Nobody may RESPOND to a deployment
     * stack"; now CR 703.7), the item resolves at the next safe point, and the flash would have made it a double announcement anyway, since `spellPlayed` already reads
     * "Ben plays Overbloom → stack." one line above. The event still fires
     * with everything on it; only the message goes, exactly as `stackFlash`
     * has always been silent and for exactly the reason round 8 gave — "the
     * reader already has 'X resolves.'" The client had already classified this
     * type as plumbing (LOG_PLUMBING in ui/main.ts); this is that judgement
     * made where it holds unconditionally.
     *
     * ⚠ THE FLASH GOES FIRST. `flashBatches` reads `triggered` → (flash |
     * stackPushed) as "this trigger left the queue", and a flash arriving
     * after the push would find the marker already spent and start its own
     * beat — which is the simultaneity bug CR D6.7 forbids, rebuilt.
     *
     * Same discriminator as `beginResolving`, and for the same reason.
     */
    const inBattle = this.s.phase === 'battle';
    // snapshotted before resolution can spend a part, exactly as the no-stack
    // branch in `commitItem` does it, and for the same reason
    if (!inBattle) this.ev('stackFlash', '', { item: structuredClone(item) });
    this.ev('stackPushed', inBattle ? `${item.label} → stack.` : '',
      { id: item.id, controller: item.controller });
    // whoever did NOT act responds first; a fresh window starts from initiative
    this.s.passes = 0;
    if (this.s.priority !== null) this.s.priority = other(item.controller);
  }

  /**
   * pull an item OFF the stack and hand it back — the caller decides
   * where its card goes (bin, hand, nowhere).
   *
   * The stack used to have exactly one exit, `resolveTop()`, so `negate()`
   * could not remove anything: it could only leave a note ('negated') for that
   * one exit to read whenever it eventually popped the item. Three cards
   * (Temporal Rift, Dream Lapse, Cosmic Reversal) hand-rolled this splice
   * because it did not exist. It exists now, and it is the second exit.
   *
   * The item is returned DETACHED: nothing else in state refers to it, so a
   * caller may read `card`/`controller`/`mods` off it freely.
   */
  removeFromStack(stackId: number): StackItem | undefined {
    const i = this.s.stack.findIndex(it => it.id === stackId);
    return i === -1 ? undefined : this.s.stack.splice(i, 1)[0]!;
  }

  /**
   * CR 704.4, 704.4a: negating REMOVES the item from the stack, the instant the negation
   * resolves, and its card reaches the bin then — it does not sit there greyed
   * out waiting for a priority round it can no longer use.
   *
   * The kinds that carry a card of their own are binned; a triggered or
   * activated ability has no card (its `card` names the SOURCE, which is still
   * in play) and is simply gone; a spell token is erased, never binned (CR 704.2b).
   * CR 801.2b: this comes from the STACK, so it is not a trash.
   */
  negate(stackId: number): void {
    const it = this.removeFromStack(stackId);
    if (!it) return;
    // CR 704.2d: a COPY of a spell is not a card — `it.card` names what it is a
    // copy OF, and that card is still the original's, on the stack underneath
    // or already binned. Negating a copy removes an effect and moves nothing.
    const hasCard = it.card !== undefined && it.copy !== true && NEGATE_BINS.has(it.kind);
    // CR 723.4b: a carrier is Unstable, so even negation cannot put its card in a
    // bin — the card and its viruses are erased. (The Manual's "if a virus is
    // negated … it is placed into the bin" is about the VIRUS ITEM being
    // negated before it ever attached; that item has no augments of its own
    // and still takes the bin branch.)
    // CR 724.5: a {Modular} carrier is stamped Unstable at CAST, so a negated one
    // is erased too. CR 803.8k: and so is a card that PRINTS {Unstable} — the stack
    // is an active zone. Read the same predicate `dischargeItem` reads, or the
    // log line says "→ bin" about a card that is about to be erased.
    const unstable = this.itemIsUnstable(it);
    this.ev('negated',
      `${it.label} is negated${unstable ? ' → erased (Unstable)' : hasCard ? ' → bin' : ''}.`,
      { id: it.id });
    this.dischargeItem(it, hasCard);
  }

  /** Build the cast chain for one action and run it (suspends on targets). */
  castChain(items: StackItem[], then: 'push' | 'resolve'): void {
    let chain = items;
    while (chain.length) {
      const item = chain[0]!;
      chain = chain.slice(1);
      // `chain` rides on every suspension the item can raise — the cast-time
      // ones via collectTargets, a mid-resolution one via commitItem — so the
      // items behind it survive the throw and doDecide resumes them.
      this.collectTargets(item, then, chain);
      this.commitItem(item, then, chain);
    }
  }

  /** Cast-time X selection (CR 107.2a): a spell played from hand with mana 'X'
   * asks its caster to pick X NOW — it is paid on the answer, stored on the
   * item, and fixed before anyone can respond. Suspends via 'cast'/'x'.
   *
   * CR 202.5: what is paid on the answer is `manaToPlay(…, { x })` — the whole
   * bill, cost modifiers included, because the chosen X IS the base cost and
   * nothing was owed before it was chosen (see `payCard`). So each candidate X
   * is priced HERE, against the mana actually open, and one that cannot be
   * paid for is not offered: a bare X is not the same as what it costs once a
   * Stasis Sentry or a Tranquility has spoken.
   *
   * `min` is always PAYABLE: `canPayCard` gated the play on
   * `manaToPlay(…)` with no x, which is by construction bill(min) — same base
   * (`xMin`) and, for any modifier that falls back to `xMin` when `ctx.x` is
   * undefined as CostCtx.x asks, the same delta. It is not always offered: an X
   * whose targets would be empty is dropped (CR 702.3c, 110.7; report #211). */
  private collectX(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[]): void {
    if (item.x !== undefined || !item.card) return;
    if (item.kind !== 'spell' && item.kind !== 'spellUnit') return;
    const c = this.card(item.card);
    if (c.mana !== 'X') return;
    const min = this.xFloor(item.controller, item.card, { region: item.region });   // CR 111.10i
    const payable = this.manaXChoices(item.controller, item.card, item.region);
    // CR 702.3c, 110.7 (report #211): X comes first and the targets after it, so an X
    // that leaves a REQUIRED slot with nothing legal is not a legal declaration —
    // Abduct at X = 0 against a cost-1 attacker would reach the stack aimed at
    // nothing. Only an X the targets are judged by is filtered: a variable cast
    // cost sizes the targets itself (collectPartTargets reads costPaid.x first).
    const eff = c.spellEffect;
    const sized = eff?.targets && requiresTargets(eff.targets)
      && !(eff.castCost && costAmount(eff.castCost) === null) ? eff.targets : undefined;
    const aimable = sized
      ? payable.filter(x => this.requiredSlotsFillable(sized, item.region, item.controller, item.sourceId, [x]))
      : payable;
    // castable() accepted the play on one of these, so `aimable` is never empty on
    // a live play; the fallbacks keep an old log's answer resolvable regardless
    const xs = aimable.length ? aimable : payable.length ? payable : [min];
    const options: DecisionOption[] = xs.map(x => {
      const bill = this.manaToPlay(item.controller, item.card!, { region: item.region, x });
      return { label: bill === x ? `X = ${x}` : `X = ${x} — pay [${bill}]`, value: x };
    });
    this.suspend(
      { type: 'cast', stage: 'x', item, partIndex: 0, targetIndex: 0, then, moreItems },
      {
        seat: item.controller, kind: 'payOrDecline',
        prompt: `${item.card}: choose X (paid now)`, options,
      },
    );
  }

  /**
   * {Modular} at cast time: "You can apply mods to a modular card from your
   * hand and/or bin as it is played. You still pay their costs."
   *
   * The mods are an additional COST of casting (Caleb 2025-02-07: "spellbind
   * is an additional cost so it shows up on the stack with all it's mods"), so
   * they belong here, in CR 724.3's cast-time collection, not in a bolt-on: they
   * are chosen and paid before the item reaches the stack, they then ride on
   * the stack with the spell where everyone can see them, and a copy of the
   * spell would copy them.
   *
   * CR 724.2 — WHAT IS OFFERED IS EVERY CARD YOU CAN PAY FOR. Owner ruling,
   * 2026-08-23: "I think it's legal to apply ANYTHING to a Modular card. But
   * many cards wont do anything at all since it requires being in play (which
   * a spell never is). Same with viruses, they should also be allowed to be
   * applied to the modular card, even if they might not do anything."
   *
   * So the ONLY filter is the printed one — "You still pay their costs". No
   * graft gate, no augment-capability gate, viruses included. A mod that does
   * nothing is a legal, deliberate, wasteful play, and it is not the engine's
   * business to prevent it.
   *
   * What a mod on a spell can actually do, in full:
   *   · a GRAFT ([Switch] effect) joins the item as an extra part, exactly the
   *     way it joins a unit's graft cause (Manual p.33);
   *   · a type-line [Augment] attribute is DONATED to the resolving effect —
   *     see `stackModAttrs`, the same channel a virus uses (CR 721.4b);
   *   · text-box [Augment] abilities and statics donate NOTHING, because a
   *     spell has no body for them to live on (Caleb 2025-04-24: "spells
   *     cannot gain static abilities like that, so the only useful thing you
   *     can do is give them attributes"). That is the owner's "many cards wont
   *     do anything at all", and it needs no code — only the test that keeps a
   *     deliberate no-op from being mistaken for an unimplemented one.
   *
   * Nothing in the pool is structurally excluded: every card in a hand or a
   * bin is a `unit` / `spell` / `spellUnit`, and resource faces are not deck
   * cards at all (see registry.DECK_LIST).
   *
   * Suspends via 'cast'/'mods'; resumable, because collectTargets re-runs from
   * the top after every answered decision.
   */
  private collectModular(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[]): void {
    if (item.modsDone || !item.card) return;
    if (item.kind !== 'spell' && item.kind !== 'spellUnit') return;
    if (!this.card(item.card).attrs.includes('Modular')) return;
    const seat = item.controller;
    const options: DecisionOption[] = [];
    for (const from of ['hand', 'bin'] as const) {
      this.player(seat)[from].forEach((name, index) => {
        // purpose 'mod': attaching a {Modular} mod is applying, not playing
        // (CR 701.2b), so "spells cost more to PLAY" modifiers do not tax it — the
        // same exemption every other mod path (augment/graft) already gets.
        // CR 724.2: the cost is the WHOLE filter. Anything you can pay for is on
        // the menu, whether or not it will do a thing when it gets there.
        if (!this.canPayCard(seat, name, { purpose: 'mod' })) return;
        options.push({ label: `${name} (${from})`, value: { modFrom: from, index }, card: name });
      });
    }
    if (!options.length) { item.modsDone = true; return; }   // nothing to offer
    options.push({ label: 'No more mods', value: { doneMods: true } });
    this.suspend(
      { type: 'cast', stage: 'mods', item, partIndex: 0, targetIndex: 0, then, moreItems },
      {
        seat, kind: 'targets',
        prompt: `${item.label} is {Modular}: apply a mod from your hand or bin (you still pay its cost)`,
        options,
      },
    );
  }

  /**
   * CR 602.7 — "You may play me into an open spot in your formation."
   *
   * A PLAY, not an effect: the spot is part of how the card is played, so it
   * is chosen at cast alongside X, mods, targets and costs (CR 702.3), rides on the
   * stack item where both players can see it, and is TAKEN at resolution
   * atomically with the spawn (see takeSpot). Contrast CR 602.6's
   * `E.placeInFormation`, which is a genuine effect resolving — "create a unit
   * in my formation" — and rightly places at resolution time.
   *
   * The card was folded into the effect-placement table when that rule was written, and the
   * cost was the UFAB report: it spawned into the region with no column (which
   * is exactly what the client draws as the invader's zone), stacked a
   * placement trigger, and handed the opponent a priority window in which to
   * recall it. A card that is played into the line was never in the region to
   * be answered.
   *
   * With no formation of your own there is nothing to join, so nothing is
   * asked and the card is simply played (CR 602.7c). Joining is optional, because
   * the text says *may* — "stay out of formation" is always on the menu when
   * the question is asked at all.
   */
  private collectFormationSpot(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[]): void {
    if (item.formationSpot !== undefined || !item.card) return;
    if (item.kind !== 'unit') return;
    if (!this.card(item.card).playsIntoFormation) return;
    const slots = this.formationSlots(item.controller);
    if (!slots.length) return;   // CR 602.7c: no formation of yours — no prompt
    // #107: `spot` is set even though it duplicates `value` here — every
    // `kind: 'formationSlot'` ask carries the same display payload, so the
    // client reads one field and never has to know which rule raised it.
    const options: DecisionOption[] = slots.map(s => ({ label: s.label, value: s.spot, spot: s.spot }));
    options.push({
      label: 'stay out of formation',
      value: { kind: 'out' } as FormationSpot, spot: { kind: 'out' },
    });
    this.suspend(
      { type: 'cast', stage: 'formation', item, partIndex: 0, targetIndex: 0, then, moreItems },
      {
        seat: item.controller, kind: 'formationSlot',   // BL-24: same class as CR 602.6's ask
        prompt: `${item.card}: which open spot in your formation is it played into?`,
        options,
      },
    );
  }

  /** Attach one chosen {Modular} mod — or stop asking. A COST: paid on the
   * spot, before the item hits the stack, and not respondable (CR 702.4). */
  payModularMod(item: StackItem, val: unknown): void {
    if (val !== null && typeof val === 'object' && 'doneMods' in val) {
      item.modsDone = true;
      return;
    }
    const { modFrom, index } = val as { modFrom: 'hand' | 'bin'; index: number };
    const seat = item.controller;
    const zone = this.player(seat)[modFrom];
    const name = zone[index];
    this.need(name !== undefined, 'no card there to apply');
    this.need(this.canPayCard(seat, name, { purpose: 'mod' }), 'cannot pay for that mod');
    zone.splice(index, 1);
    this.payCard(seat, name, { purpose: 'mod' });
    (item.mods ??= []).push({ card: name, from: modFrom });
    // CR 724.4: only a GRAFT brings an EFFECT with it — `graft:${name}` is the key
    // of its [Switch] half, and a card without one has no such effect to look
    // up (effectByKey throws). An augment's payload reaches the spell by the
    // OTHER channel instead (stackModAttrs), and a card with neither simply
    // rides along doing nothing, which the owner's ruling explicitly allows.
    if (isGraftable(name)) item.parts.push({ effectKey: `graft:${name}`, targets: [] });
    // CR 724.5, 803.8e — Manual p.35: "As long as a card is modded, it has the unstable
    // attribute, meaning when it dies or is erased, it and all of its mods are
    // erased with it. This means that even though mods can be applied from the
    // bin, they are generally only able to be applied once." That last sentence
    // is about THIS window — it is the only one that applies a mod from a bin.
    // Owner, 2026-08-23: "A modded Spellbind should also have unstable. It
    // basically works as a 'flashback' for graft cards." The stamp is taken
    // here, at cast, rather than derived at disposal, for the same reason a bin play's
    // stamp is (CR 704.2c): `dischargeItem` then has ONE flag to read on every exit — resolution,
    // fizzle (CR 704.6) and negation alike.
    item.unstable = true;
    for (const part of item.parts) part.mods = item.mods.map(m => m.card);
    item.label = `${item.card} + ${item.mods.map(m => m.card).join(' + ')}`;
    // log-only: 'modApplied' means a mod attached to a UNIT (its listeners all
    // read ev.data.host), and there is no host here — the mod is riding a
    // spell. CR 701.2 already says applying a mod is not playing a card.
    this.ev('info', `${name} is applied to ${item.card} from ${modFrom} as it is played ({Modular}).`,
      { item: item.id, card: name, from: modFrom });
  }

  /**
   * CR 724.5 — a {Modular} spell's mods leave with the card they were applied to,
   * and they leave ERASED.
   *
   * Manual p.35: a modded card is {Unstable}, and "even though mods can be
   * applied from the bin, they are generally only able to be applied once".
   * `payModularMod` stamps `item.unstable` for exactly that reason, so
   * `dischargeItem`'s Unstable branch has already sent the CARD to the public
   * erased pile (CR 407.1) by the time this runs; this is the mods' half of the same
   * pile, kept separate only so the pair is logged as a pair. No-op for every
   * other item, and never a bin — which is why this is not `toBin`.
   *
   * The mods are their controller's own cards (they came out of that player's
   * hand or bin), so unlike CR 723.4's viruses there is no second owner to split
   * the pile between.
   */
  disposeItemMods(item: StackItem): void {
    // CR 710.8d: a COPY carries the original's {Modular} mods so they still donate
    // their [Augment] attributes to the copied effect (Caleb 2025-02-07: they
    // "ride on the stack with the spell and a copy would copy them"), but the
    // mod CARDS are the original's and are erased with the original exactly
    // once. Without this the copy announces the same erase a second time.
    if (item.copy === true) return;
    const mods = item.mods ?? [];
    if (!mods.length) return;
    const cards = mods.map(m => m.card);
    this.ev('erased',
      `${cards.join(', ')} — erased with ${item.card ?? item.label}: a modded card is Unstable, `
      + 'so a {Modular} mod is applied once and never comes back.',
      { seat: item.controller, cards });
  }

  // ── CR 111.2: non-mana costs ─────────────────────────────────────────

  /**
   * CR 111.6b ⚠ (engine ruling): may a LIFE cost be paid if it would kill you?
   * NO — a life cost is payable only while you have MORE life than it costs.
   *
   * Life reaching 0 ends the game inside loseLife(), so paying at cast would
   * hand the opponent the win before the spell even resolved; CR 702.4a already says
   * an unpayable cost makes the cast illegal, and nothing in the pool reads
   * like a suicide button. Paying your LAST life is therefore refused too
   * (`life > n`, not `>=`).
   */
  canPayLife(seat: Seat, n: number): boolean {
    return n <= 0 || this.player(seat).life > n;
  }

  /**
   * Is `cost` payable by `seat` RIGHT NOW, in `region`? The gate shared by
   * castability (apply.castable), legalActions and the collectors.
   *
   * `handReserve` is 1 while the card being cast is STILL SITTING IN THE HAND
   * the check reads — castability is asked before doPlayCard splices the card
   * out, and a spell cannot discard itself to pay for itself. (0 for a cache
   * release, and for any check made after the card has already left.)
   *
   * CR 111.6: a VARIABLE cost ('X') asks whether its FLOOR is payable. `xMin` is 0
   * for every printed one — "[Remove X +1/+1 counters from allies]" with no
   * counters anywhere is a legal cast that does nothing, exactly as X = 0 on a
   * mana-X spell is — so the gate is real only where a card sets a floor.
   */
  canPayCastCost(seat: Seat, cost: CastCost, region: number, handReserve = 0, sourceId?: EntityId, manaReserve = 0): boolean {
    const want = costAmount(cost) ?? costXMin(cost);
    switch (cost.kind) {
      case 'sacrificeUnit': return this.unitsOf(seat, region).length > 0;
      // CR 111.7a: "[Sacrifice me]" asks about the SOURCE, deliberately NOT about
      // `unitsOf(seat, region).length >= want`. A dead source has to make the
      // cost unpayable — that is what makes CR 101.5b skip the part, which is the
      // right answer for a trigger whose source died between firing and
      // settling. Any other live unit standing there must not stand in for it.
      // `includeSelf` ("sacrifice me AND another ally", Deformant) asks for
      // BOTH HALVES UP FRONT, and that is the whole point of asking here: the
      // source is charged choice-free before the menu for the rest is ever
      // raised, so a board that can field the source but not the remainder
      // would otherwise kill the source for a cost it cannot finish paying.
      // All or nothing, exactly as CR 111.14 demands of a multiplied graft cost.
      case 'sacrificeUnits':
        if (cost.from === 'self') return this.selfSacrificeable(seat, sourceId);
        if (cost.includeSelf) {
          return this.selfSacrificeable(seat, sourceId)
            && this.unitsOf(seat, region).filter(u => u.id !== sourceId).length >= want - 1;
        }
        return this.unitsOf(seat, region).length >= want;
      // a variable life cost is paid a point at a time (CR 111.6b re-asked each
      // time), so its floor is "can you survive paying the first one"
      case 'payLife': return this.canPayLife(seat, cost.n === 'X' ? Math.max(1, want) : want);
      case 'discardCard': return this.player(seat).hand.length - handReserve >= want;
      case 'gainDebt': return true;   // debt is always takeable
      case 'removeCounters': return this.counterPool(seat, region, cost.from, sourceId) >= want;
      case 'eraseBin': return this.player(seat).bin.length >= want;
      // CR 705.3b: a printed "[x]". `manaReserve` is what the SAME activation still
      // owes its fixed `AbilityCost.mana` plus CR 111.10f's tax — this collector runs
      // first, so the money for those must not be on the table.
      case 'payMana': return this.openMana(seat) - manaReserve >= want;
      // CR 102.7a: "[Recall another ally]" — ANOTHER, so the source never counts.
      case 'recallUnit':
        return this.unitsOf(seat, region).filter(u => u.id !== sourceId).length >= want;
      // CR 111.2: "[Erase one of my mods]" — MINE, so the pool is the source's own
      case 'eraseMod': return this.modsOnSource(seat, sourceId).length >= want;
    }
  }

  /** CR 111.2: the mod entities on a "[Erase one of my mods]" cost's source — the
   * carrier the ability is anchored on, which is the HOST for donated text. */
  private modsOnSource(seat: Seat, sourceId?: EntityId): Entity[] {
    const u = sourceId !== undefined ? this.entity(sourceId) : undefined;
    if (!u || u.controller !== seat || u.absent) return [];
    return u.mods.map(id => this.entity(id)).filter((m): m is Entity => !!m);
  }

  /**
   * CR 111.6a — the mana this item's ACTIVATION cost has not been charged yet:
   * the printed fixed `AbilityCost.mana` plus CR 111.10f's activation tax.
   *
   * `E.collectCastCosts('variable')` runs BEFORE `E.payActivationCost`, so a
   * "[x]" paid there would otherwise be free to spend money the fixed half is
   * about to need — a Celestial Shifter under a Crevice Lurker could put every
   * point into X and then under-pay the tax. Reading `item.activationCost`
   * makes this self-clearing: `payActivationCost` deletes the field the moment
   * it charges, so the reserve is 0 for every collector that runs after it.
   */
  private activationManaReserve(item: StackItem): number {
    const cost = item.activationCost;
    if (!cost) return 0;
    const tax = item.card !== undefined
      ? this.abilityTax(item.controller, item.card, item.region, 'activate').total : 0;
    return (cost.mana ?? 0) + tax;
  }

  /** CR 111.3a: how many +1/+1 counters a "[Remove X +1/+1 counters …]" cost can
   * reach — every ally's in the region, or just the source unit's own. */
  counterPool(seat: Seat, region: number, from: 'allies' | 'self', sourceId?: EntityId): number {
    if (from === 'self') {
      const u = sourceId !== undefined ? this.entity(sourceId) : undefined;
      return u && u.controller === seat && !u.absent ? Math.max(0, u.counters) : 0;
    }
    return this.unitsOf(seat, region).reduce((n, u) => n + Math.max(0, u.counters), 0);
  }

  /**
   * BL-25/CR D7.2: the most counters ONE pick of a "[Remove X +1/+1 counters …]"
   * cost may take — what a client's quantity stepper maxes at, and what its
   * "All" button jumps to.
   *
   * It is NOT always `counterPool`, and the difference is the whole reason
   * this is a separate method rather than a client-side `Math.max`. A pick
   * NAMES ONE UNIT, so `from: 'allies'` can never take the whole pool in one
   * go — four counters spread over two allies is two picks of two, not one of
   * four. `from: 'self'` is a single unit, so there the pool IS the answer and
   * `counterPool` is returned unchanged.
   *
   * `owed` is what the cost still wants (null for a variable X cost, which
   * wants as much as you will give it): a "[Remove 2]" cost may not offer to
   * strip five counters off a unit that has five.
   *
   * ⚠ CR 206.6b — "all counters count as counters". This deliberately makes no
   * eligibility judgement of its own: it reads `counterPool` and `unitsOf`,
   * exactly the two the payability check and the option list read. The
   * `Math.max(0, …)` is `counterPool`'s own, and it is there because counters
   * are ONE signed net int and this cost prints its sign ("+1/+1"), which is
   * the same reason Pestilent Mycelion's sign filter stands (CR 206.6b).
   */
  counterPickMax(seat: Seat, region: number, from: 'allies' | 'self', sourceId?: EntityId, owed: number | null = null): number {
    const pool = this.counterPool(seat, region, from, sourceId);
    if (pool <= 0) return 0;
    const biggest = from === 'self' ? pool
      : this.unitsOf(seat, region).reduce((m, u) => Math.max(m, Math.max(0, u.counters)), 0);
    return Math.max(0, Math.min(biggest, pool, owed ?? Infinity));
  }

  /** CR 111.7a: the source unit of a "[Sacrifice me]" cost, or undefined when it is
   * not there to be sacrificed (already dead, absent, or no longer this
   * seat's). The single reading `canPayCastCost` and `chargeCastCost` share. */
  private selfSacrifice(seat: Seat, sourceId?: EntityId): Entity | undefined {
    const u = sourceId !== undefined ? this.entity(sourceId) : undefined;
    return u && u.kind === 'unit' && !u.absent && u.controller === seat ? u : undefined;
  }
  private selfSacrificeable(seat: Seat, sourceId?: EntityId): boolean {
    return this.selfSacrifice(seat, sourceId) !== undefined;
  }

  /** CR 702.6b: a cost paid one unit at a time — the ones whose collector loops.
   * CR 111.7a: "[Sacrifice me]" is NOT one of them — it carries no choice, so it
   * falls through to be charged outright, with no decision and no suspension.
   * That is the whole reason it is unrespondable. */
  private costIsIterated(cost: CastCost): boolean {
    return cost.kind === 'sacrificeUnit'
      || (cost.kind === 'sacrificeUnits' && cost.from !== 'self')
      || cost.kind === 'discardCard' || cost.kind === 'removeCounters'
      // CR 705.3b: 'payMana' iterates like 'payLife' (a point at a time, so the
      // reserve is re-read before each one); 'recallUnit' and 'eraseMod' name
      // a thing, so they carry a choice and cannot be charged outright.
      || cost.kind === 'eraseBin' || cost.kind === 'payMana'
      || cost.kind === 'recallUnit' || cost.kind === 'eraseMod'
      || costAmount(cost) === null;
  }

  /** how much of an iterated cost `part` has already paid. */
  private costPaidSoFar(part: EffectPart, cost: CastCost): number {
    const paid = part.costPaid;
    if (!paid) return 0;
    switch (cost.kind) {
      case 'sacrificeUnit': return paid.sacrificed !== undefined ? 1 : 0;
      case 'sacrificeUnits': return paid.sacrificedUnits?.length ?? 0;
      case 'discardCard': return paid.discarded?.length ?? 0;
      case 'removeCounters': return (paid.counters ?? []).reduce((n, c) => n + c.n, 0);
      case 'eraseBin': return paid.erased?.length ?? 0;
      case 'payLife': return paid.life ?? 0;
      case 'gainDebt': return paid.debt ?? 0;
      case 'payMana': return paid.mana ?? 0;                  // CR 111.2
      case 'recallUnit': return paid.recalled?.length ?? 0;   // CR 111.2
      case 'eraseMod': return paid.erasedMods?.length ?? 0;   // CR 111.2
    }
  }

  /** the receipt key a CastCost kind lands in — its presence means "already
   * paid", which is what makes the collector idempotent across a replay.
   * a variable cost is settled by its own `xDone` flag, because a
   * half-paid one and a finished one hold the same shape of receipt. */
  private costSettled(part: EffectPart, cost: CastCost): boolean {
    const paid = part.costPaid;
    if (!paid) return false;
    const want = costAmount(cost);
    if (want === null) return paid.xDone === true;
    return this.costPaidSoFar(part, cost) >= want;
  }

  /**
   * Cast-time bracketed costs (CR 702.4): every part whose effect declares a
   * castCost gets it chosen and PAID here, before the item reaches the stack.
   * Spell parts must pay (castability already required a payable cost); graft
   * parts riding a composite may decline — the rider is then skipped. An
   * unpayable cost skips the part the same way.
   *
   * Costs that carry no choice (pay a fixed life, gain debt) are simply
   * charged here; every other kind suspends via 'cast'/'cost' once per unit
   * still owed. Every branch is guarded by the receipt, so a resumed cast
   * never pays twice.
   *
   * the point of the whole thing, and the playtest report that forced
   * it: "Shouldn't Discharge have you remove counters as an additional cost?
   * Not on resolution". A cost paid at resolution is not a cost. It is paid
   * after the opponent has already decided whether to respond, it can be
   * negated away without ever being paid, and — the thing that actually
   * happened — the caster's own X was still unfixed while priority passed, so
   * the response was made against a spell whose size nobody knew. Everything
   * bracketed is settled HERE, before the item is a thing anyone can answer.
   */
  private collectCastCosts(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[], which: 'variable' | 'fixed',
    ask?: InlineCostAsk): void {
    let step = 0;
    for (let pi = 0; pi < item.parts.length; pi++) {
      const part = item.parts[pi]!;
      if (part.spent) continue;
      const def = effectByKey(part.effectKey);
      const cost = def.castCost;
      if (!cost) continue;
      if ((costAmount(cost) === null) !== (which === 'variable')) continue;
      const seat = item.controller;
      // CR 111.15 / CT-216 — Graft 101 point 11: a grafted "[cost]: effect" adds a
      // cost that "is non-optional (you MUST pay it, you can't opt out) and if
      // you can't pay it … then the whole Graft Effect won't go on the stack."
      // Grafted riders were opt-in here, on no ruling. They are not: no part
      // may decline its [cost] any more.
      const graftPart = part.effectKey.startsWith('graft:');
      // the WHOLE composite is the graft cause's own ability (triggered or
      // activated); a played spell carrying a {Modular} graft part keeps the
      // per-part skip, or a card already paid for would be stranded
      const wholeComposite = graftPart && (item.kind === 'triggered' || item.kind === 'activated');
      const total = costAmount(cost);
      // a MULTI-unit cost is paid one at a time, so payability has to be asked
      // about what is still OWED, not about the printed total — else the
      // second discard of a "[Discard 2 cards]" looks unpayable and the whole
      // part is wrongly skipped after the first card is already gone
      // CR 111.14: a graft multiplied by Lost Guardian / Witness / Amphivore is N
      // parts of this composite, and its [cost] "must be paid twice (Lost
      // Guardian) or thrice (Amphivore)". All or nothing: if the whole N-fold
      // cost is not payable up front, none of it is paid and the effect does
      // not happen at all — asked ONCE, before the first copy pays.
      if (total !== null && graftPart && !part.costPaid) {
        const copies = this.costCopySiblings(item, part);
        if (copies.length > 1 && !this.canPayCastCost(seat, this.costTimes(cost, copies.length), item.region, 0, item.sourceId, this.activationManaReserve(item))) {
          if (wholeComposite) {
            this.withholdComposite(item, `the [${this.castCostLabel(cost)}] cost must be paid ${copies.length} times and cannot be`);
            return;
          }
          for (const p of copies) p.spent = true;
          this.ev('info', `${item.label}: the [${this.castCostLabel(cost)}] cost must be paid ${copies.length} times and cannot be — nothing is paid and that effect is skipped.`);
          continue;
        }
      }
      while (!this.costSettled(part, cost)) {
        const done = this.costPaidSoFar(part, cost);
        const owed = total === null ? 1 : total - done;
        if (!this.canPayCastCost(seat, this.costOwing(cost, owed, done), item.region, 0, item.sourceId, this.activationManaReserve(item))) {
          if (total === null) {
            // a variable cost simply stops when nothing more can be paid —
            // what was paid stands, and X is what it is
            this.finishVariableCost(item, part, cost);
            break;
          }
          if (wholeComposite) {
            this.withholdComposite(item, `the grafted [${this.castCostLabel(cost)}] cost cannot be paid`);
            return;
          }
          part.spent = true;   // unpayable: the part never resolves
          this.ev('info', `${item.label}: the [${this.castCostLabel(cost)}] cost cannot be paid — that effect is skipped.`);
          this.refundPart(item, part);   // CARD-TODO #18: it did nothing
          break;
        }
        // choice-free costs: charged on the spot, no decision to ask for
        if (!this.costIsIterated(cost)) { this.chargeCastCost(item, part, cost); break; }
        // `includeSelf` ("sacrifice me AND another ally", Deformant): the
        // SOURCE half carries no choice, so it is charged FIRST and outright —
        // in this same cast window, before the menu for the remainder is
        // raised. `canPayCastCost` above already demanded both halves, so the
        // source never dies for a cost the rest of which cannot be paid.
        if (cost.kind === 'sacrificeUnits' && cost.includeSelf && done === 0) {
          this.chargeCastCost(item, part, cost);
          continue;
        }
        // BL-25/CR D7.2: a variable cost wants as much as you will give it, so
        // its pick is capped only by the unit; a fixed one may not be overpaid.
        const pickOwed = total === null ? null : owed;
        const options: DecisionOption[] = this.castCostOptions(item, part, cost, pickOwed);
        // payability and the option list read the same pool, so this is a
        // belt-and-braces branch: nothing left to pay with closes a variable
        // cost at what it has, and skips a fixed one rather than under-paying.
        if (!options.length) {
          if (total === null) this.finishVariableCost(item, part, cost);
          else if (wholeComposite) {
            this.withholdComposite(item, `the grafted [${this.castCostLabel(cost)}] cost cannot be paid`);
            return;
          } else {
            part.spent = true;
            this.ev('info', `${item.label}: the [${this.castCostLabel(cost)}] cost cannot be paid — that effect is skipped.`);
            this.refundPart(item, part);   // CARD-TODO #18: it did nothing
          }
          break;
        }
        // CR 702.6b: a variable cost is the caster's to size, so "that's enough" is
        // always on the table once its floor is met. It goes LAST, where the
        // targets collector puts "No more targets" — the stop is never the
        // thing your hand lands on first.
        if (total === null && done >= costXMin(cost)) {
          // CR 107.2b: stopping at X = 0 is legal, and on some cards it is also a
          // guaranteed no-op. Say so HERE, on the option itself, which is the
          // only moment the payer can still change their mind — every one of
          // these cards already says it at resolution, by which point the
          // spell has been cast, answered and fizzled.
          const warn = done === 0 ? def.xZeroWarning : undefined;
          options.push({
            label: `That's enough — X = ${done}` + (warn ? ` ⚠ ${warn}` : ''),
            value: { doneCost: true },
            ...(warn ? { warning: warn } : {}),
          });
        }
        const dec: Omit<Decision, 'id'> = {
            seat, kind: 'targets',
            // BL-25 (owner): "it's just not clear that it wants you to click
            // the unit. It needs to say that." The menu was a row of ally
            // scans under a prompt that named the COST and never the action,
            // so the affordance was there and invisible. Said here rather than
            // in the client so every client — and the log — gets it.
            prompt: `${item.label}: ${this.castCostLabel(cost)}${
              total !== null && total > 1 ? ` (${done + 1} of ${total})` : total === null ? ` (X = ${done} so far)` : ''
            } — additional cost${
              cost.kind === 'removeCounters' ? ' — click a unit to take counters off it' : ''}`,
            options,
            ...(cost.kind === 'removeCounters'
              ? { counterMax: this.counterPickMax(seat, item.region, cost.from, item.sourceId, pickOwed) }
              : {}),
          };
        // CR 702.4e: a mid-resolution play has no cast window of its own, so its
        // cost is asked through the RESOLVING effect's chooser and paid on
        // the spot by the same `payCastCost` doDecide calls. Without `ask`
        // this is the cast window's suspension, exactly as before.
        if (!ask) this.suspend({ type: 'cast', stage: 'cost', item, partIndex: pi, targetIndex: 0, then, moreItems }, dec);
        this.payCastCost(item, pi, ask(pi, step++, dec));
      }
    }
  }

  /**
   * CR 702.4e — RAQ "[Solved] Tides of Cosmos - all you need to know.", point 5:
   * *"Any additional [cost] of the card must be paid."* A card played in the
   * middle of another effect's resolution (Tides of the Cosmos, Hooba-Pon,
   * Insidious Invitation) pays its bracketed costs here, variable and fixed,
   * through the resolving effect's own `ask` (its `ctx.choose`), so every
   * question rides the outer suspension and nothing nests a 'cast'
   * window. The collector, the options and the payment are the cast window's
   * own; only the asking differs.
   */
  collectInlineCastCosts(item: StackItem, which: 'variable' | 'fixed', ask: InlineCostAsk): void {
    this.collectCastCosts(item, 'push', [], which, ask);
  }

  /**
   * CR 722.6a / CT-216 — "the whole Graft Effect won't go on the stack" (Graft 101
   * point 11). Every part is spent and its reservation handed back (it did
   * nothing — CR 109.9b), and the item is marked so `commitItem` never pushes or
   * resolves it. Said once, here, where it is decided.
   */
  private gateGraftCosts(item: StackItem): void {
    if (item.withheld || (item.kind !== 'triggered' && item.kind !== 'activated')) return;
    for (const part of item.parts) {
      if (part.spent || part.costPaid || !part.effectKey.startsWith('graft:')) continue;
      const cost = effectByKey(part.effectKey).castCost;
      if (!cost || costAmount(cost) === null) continue;
      const copies = this.costCopySiblings(item, part);
      if (!this.canPayCastCost(item.controller, this.costTimes(cost, copies.length), item.region, 0, item.sourceId, this.activationManaReserve(item))) {
        // the multiplied-graft wording kept (CR 111.14): it is the N-fold that fails
        this.withholdComposite(item, copies.length > 1
          ? `the grafted [${this.castCostLabel(cost)}] cost must be paid ${copies.length} times and cannot be`
          : `the grafted [${this.castCostLabel(cost)}] cost cannot be paid`);
        return;
      }
    }
  }

  private withholdComposite(item: StackItem, why: string): void {
    for (const p of item.parts) {
      if (p.spent) continue;
      p.spent = true;
      this.refundPart(item, p);
    }
    item.withheld = true;
    this.ev('info', `${item.label}: ${why} — the whole graft effect does not go on the stack.`,
      { item: item.id, unit: item.sourceId });   // the host the composite would have come from
  }

  /** CR 722.7d: the unspent, unpaid copies of one multiplied graft part — the
   * parts that share its mod (itself included, first). */
  private costCopySiblings(item: StackItem, part: EffectPart): EffectPart[] {
    if (part.fromMod === undefined) return [part];
    return item.parts.filter(p => p.fromMod === part.fromMod && p.effectKey === part.effectKey && !p.spent && !p.costPaid);
  }

  /** CR 111.14: a fixed cost, k times over — what "pay it k times" must be asked
   * about before the first payment. "[Sacrifice a unit]" k times is k units. */
  private costTimes(cost: CastCost, k: number): CastCost {
    const n = costAmount(cost);
    if (n === null || k <= 1) return cost;
    switch (cost.kind) {
      case 'sacrificeUnit': return { kind: 'sacrificeUnits', n: k };
      case 'sacrificeUnits': return cost.from === 'self' ? cost : { ...cost, n: n * k };
      case 'gainDebt': return cost;
      // CR 111.2: these two carry no `n` at all — one ally, one mod — so there is
      // nothing to multiply and a spread would invent a field the union lacks.
      case 'recallUnit': case 'eraseMod': return cost;
      default: return { ...cost, n: n * k } as CastCost;
    }
  }

  /** the same cost, restated as the amount still owing — what payability
   * must be asked about mid-payment. */
  private costOwing(cost: CastCost, owed: number, done = 0): CastCost {
    // CR 111.2: 'recallUnit'/'eraseMod' join the no-`n` list for the same reason
    if (cost.kind === 'sacrificeUnit' || cost.kind === 'gainDebt'
      || cost.kind === 'recallUnit' || cost.kind === 'eraseMod') return cost;
    // `includeSelf`: the source half is paid first and choice-free, so once it
    // IS paid what is still owing is a plain n-unit sacrifice. Asking about
    // `includeSelf` again would look for a source that is now dead and declare
    // the rest unpayable, skipping the part after half of it had been charged.
    if (cost.kind === 'sacrificeUnits' && cost.includeSelf && done > 0) {
      const { includeSelf: _paid, ...rest } = cost;
      return { ...rest, n: owed, xMin: 0 };
    }
    return { ...cost, n: owed, xMin: 0 } as CastCost;
  }

  /** CR 702.6b: close a variable cost — X is what was actually paid, and it is
   * written where the resolution reads it (ctx.x). */
  private finishVariableCost(item: StackItem, part: EffectPart, cost: CastCost): void {
    if (costAmount(cost) !== null) return;
    const paid = (part.costPaid ??= {});
    paid.x = this.costPaidSoFar(part, cost);
    paid.xDone = true;
    this.ev('info', `${item.label}: X = ${paid.x} (${this.castCostLabel(cost)}).`);
    // CR D7.1a: the other way a variable cost lands on zero is that there was
    // nothing left to pay with — no decision is raised at all, so the warning
    // has nowhere to hang but the log. It is still worth saying.
    const warn = paid.x === 0 ? effectByKey(part.effectKey).xZeroWarning : undefined;
    if (warn) this.ev('info', `⚠ ${item.label}: ${warn}`);
  }

  /** human-readable form of a bracketed cost, for prompts and the log */
  castCostLabel(cost: CastCost): string {
    const n = costAmount(cost);
    const many = (one: string, plural: (k: number | 'X') => string) =>
      n === 1 ? one : plural(n === null ? 'X' : n);
    switch (cost.kind) {
      case 'sacrificeUnit': return 'sacrifice a unit';
      case 'sacrificeUnits': return cost.from === 'self' ? 'sacrifice me'
        : many('sacrifice a unit', k => `sacrifice ${k} units`);
      case 'payLife': return `pay ${n === null ? 'X' : n} life`;
      case 'discardCard': return many('discard a card', k => `discard ${k} cards`);
      case 'gainDebt': return `gain ${cost.n} debt`;
      case 'removeCounters': return `remove ${n === null ? 'X' : n} +1/+1 counter${n === 1 ? '' : 's'} from ${cost.from === 'self' ? 'me' : 'allies'}`;
      case 'eraseBin': return `erase ${n === null ? 'X' : n} card${n === 1 ? '' : 's'} from your bin`;
      case 'payMana': return `pay [${n === null ? 'X' : n}]`;      // CR 111.2
      case 'recallUnit': return 'recall another ally';             // CR 111.2
      case 'eraseMod': return 'erase one of my mods';              // CR 111.2
    }
  }

  /** the choices a bracketed cost offers (the choice-free kinds never get
   * here: collectCastCosts charges them on the spot — since grafted costs
   * became mandatory (CR 111.15) there is no opt-in grafted-rider path to ask about them) */
  private castCostOptions(item: StackItem, part: EffectPart, cost: CastCost, owed: number | null = null): DecisionOption[] {
    const seat = item.controller;
    // CR 111.7a: "[Sacrifice me]" names no unit, so it offers no unit menu; the
    // cost collector charges it without asking. Falls through to the "Pay: …"
    // default if it is ever asked about.
    if (cost.kind === 'sacrificeUnit'
      || (cost.kind === 'sacrificeUnits' && cost.from !== 'self')) {
      // a multi-unit sacrifice may not name the same unit twice — but each one
      // is really gone by the time the next is asked for, so "still in play"
      // already guarantees it and no explicit spent-set is needed.
      // `includeSelf` ("me AND another ALLY"): the source is not on the menu.
      // It has already been charged, choice-free, so it is not there to pick
      // anyway — but saying it here is what makes "another" mean another, and
      // keeps the menu honest if the two halves are ever reordered.
      const self = cost.kind === 'sacrificeUnits' && cost.includeSelf ? item.sourceId : undefined;
      return this.unitsOf(seat, item.region)
        .filter(u => u.id !== self)
        .map(u => ({ label: this.targetLabel({ unit: u.id }), value: { unit: u.id }, card: u.card }));
    }
    if (cost.kind === 'discardCard') {
      return this.player(seat).hand.map((n, i) => ({ label: n, value: { discard: i }, card: n }));
    }
    if (cost.kind === 'eraseBin') {
      // CR 405.6: `{erase: name}` names the CARD, not a slot — copies in a bin
      // are genuinely indistinguishable, so two rows reading "The Foretold"
      // would be one option offered twice. The collapse is right; what was
      // missing is that the menu never said it had collapsed anything.
      // Report DWYV/2026-08-27: a two-card bin drew one scan, the owner picked
      // it twice to make it register, and paid X = 2 on the one scenario built
      // to reach the X = 1 refusal branch. `count` carries the multiplicity to
      // the client without touching `label` — see DecisionOption.count for why
      // the label must not move.
      const tally = new Map<CardName, number>();
      for (const n of this.player(seat).bin) tally.set(n, (tally.get(n) ?? 0) + 1);
      // insertion order = first-occurrence order in the bin, which is the order
      // the old `filter(seen)` produced. Menu order is part of the replay key,
      // so it stays exactly where it was.
      return [...tally].map(([n, k]) => ({ label: n, value: { erase: n }, card: n, count: k }));
    }
    // CR 705.3b: a printed "[x]" is paid a point at a time for the same reason a
    // variable life cost is — the reserve `payActivationCost` still needs is
    // re-read before each point, so X can never eat the fixed half or the tax.
    if (cost.kind === 'payMana') {
      const so = part.costPaid?.mana ?? 0;
      const spare = this.openMana(seat) - this.activationManaReserve(item);
      return spare >= 1
        ? [{ label: `Pay [1] more — X = ${so + 1}`, value: { payMana1: true } }]
        : [];
    }
    // CR 102.7a: "[Recall another ally]" — the source is never on the menu
    if (cost.kind === 'recallUnit') {
      return this.unitsOf(seat, item.region)
        .filter(u => u.id !== item.sourceId)
        .map(u => ({ label: this.targetLabel({ unit: u.id }), value: { recall: u.id }, card: u.card }));
    }
    // CR 111.2: "[Erase one of my mods]" — the SOURCE's mods, nobody else's
    if (cost.kind === 'eraseMod') {
      return this.modsOnSource(seat, item.sourceId)
        .map(m => ({ label: `Erase ${m.card}`, value: { eraseMod: m.id }, card: m.card }));
    }
    // CR 702.6b: a VARIABLE life cost is paid a point at a time, so that
    // "never your last life" (CR 111.6b) is re-asked before each one.
    if (cost.kind === 'payLife') {
      return this.canPayLife(seat, 1)
        ? [{ label: `Pay 1 more life (you have ${this.player(seat).life})`, value: { payLife1: true } }]
        : [];
    }
    if (cost.kind === 'removeCounters') {
      // each counter is really taken off as it is paid, so `u.counters` is
      // already net of everything paid so far — no separate tally
      const pool = cost.from === 'self'
        ? (item.sourceId !== undefined ? [this.entity(item.sourceId)] : []).filter((u): u is Entity => !!u && !u.absent)
        : this.unitsOf(seat, item.region);
      // BL-25/CR D7.2: a pick may take SEVERAL counters off the unit it names,
      // so each unit contributes one option per amount it can still give.
      //
      // The one-per-counter menu it replaces was not merely tedious — it was
      // untenable ACROSS A NETWORK. A quantity had to be an amount inside one
      // choice, because a client cannot answer the same decision n times: a
      // `decide` carries an option INDEX, and every index is re-evaluated
      // against the NEXT decision, which this loop has already rebuilt.
      //
      // The n = 1 option keeps its exact old value (`{counterFrom: id}`, no
      // `n`) and is the only one carrying `card`. That is what lets the four
      // existing tests still find it by value, and what keeps the prompt bar's
      // card row one scan per unit rather than one per counter.
      const out: DecisionOption[] = [];
      for (const u of pool) {
        if (u.counters <= 0) continue;
        const cap = Math.min(u.counters, owed ?? Infinity);
        out.push({
          label: `${this.targetLabel({ unit: u.id })} — has ${u.counters} counter${u.counters === 1 ? '' : 's'}`,
          value: { counterFrom: u.id }, card: u.card,
        });
        for (let k = 2; k <= cap; k++) {
          out.push({
            label: `Take ${k} counters off ${this.targetLabel({ unit: u.id })}`,
            value: { counterFrom: u.id, n: k },
          });
        }
      }
      return out;
    }
    return [{ label: `Pay: ${this.castCostLabel(cost)}`, value: { payCost: true } }];
  }

  /** charge a choice-free bracketed cost and write its receipt */
  private chargeCastCost(item: StackItem, part: EffectPart, cost: CastCost): void {
    const seat = item.controller;
    const paid = (part.costPaid ??= {});
    if (cost.kind === 'payLife') {
      const n = costAmount(cost) ?? 0;
      paid.life = n;
      this.ev('info', `${this.pname(seat)} pays ${n} life — the cost of ${item.label}.`);
      this.loseLife(seat, n, `${item.label} (cost)`);
    } else if (cost.kind === 'gainDebt') {
      paid.debt = cost.n;
      this.ev('info', `${this.pname(seat)} gains ${cost.n} debt — the cost of ${item.label}.`);
      this.gainDebt(seat, cost.n);
    } else if (cost.kind === 'sacrificeUnits' && (cost.from === 'self' || cost.includeSelf)) {
      // CR 111.7a: "[Sacrifice me]". No choice, so no decision and no suspension —
      // it is charged here, in the cast window, before anyone has priority.
      // canPayCastCost already refused an absent source, so this is live.
      // `includeSelf` ("me AND another ally", Deformant) shares this branch for
      // its FIRST half, which is the same choice-free payment; its remainder
      // then iterates through the ordinary chosen-unit path.
      const u = this.selfSacrifice(seat, item.sourceId);
      if (!u) return;
      // the receipt keeps the same shape as the chosen-unit path: stats and
      // COUNTERS snapshotted AT PAYMENT, so a resolution that wants "the
      // defense of the sacrificed unit" or "the total number of counters on
      // us" reads numbers, not a corpse.
      const [p, t] = this.effStats(u);
      (paid.sacrificedUnits ??= []).push({
        unit: u.id, card: u.card, power: p, defense: t, counters: u.counters,
      });
      this.ev('info', `${this.pname(seat)} sacrifices ${u.card} — the cost of ${item.label}.`);
      this.destroy(u, 'is sacrificed');
    }
  }

  /** Pay a chosen cast-time cost (CR 702.4): a COST, not an effect — paid before
   * the item hits the stack, not respondable. The receipt (with the victim's
   * stats snapshotted now) lands on the part for resolution to read. */
  payCastCost(item: StackItem, partIndex: number, val: unknown): void {
    const part = item.parts[partIndex]!;
    const cost = effectByKey(part.effectKey).castCost!;
    const obj = val !== null && typeof val === 'object' ? val as Record<string, unknown> : {};
    if ('declineCost' in obj) {
      // CR 111.14: the rider is paid N times or not at all — declining the first
      // copy declines every copy
      const copies = this.costCopySiblings(item, part);
      for (const p of copies) p.spent = true;
      this.ev('info', `${item.label}: the [cost] is declined — that effect is skipped${copies.length > 1 ? ` (all ${copies.length} copies)` : ''}.`);
      // CARD-TODO #18, and the MOST reachable shape of it in the pool: a
      // bounded [Switch1] rider met as a graft, whose cost is declined at
      // composite cast time. The part is spent before it ever runs, so it can
      // never reach `ctx.refundBudget()` — but the ruling is about the
      // OUTCOME, not the route: the player said no and the ability did
      // nothing, so the use is not spent. Paid here rather than deferred to
      // resolution because a spent part is skipped at resolution and a fizzled
      // item never resolves at all.
      this.refundPart(item, part);
      return;
    }
    if ('doneCost' in obj) { this.finishVariableCost(item, part, cost); return; }
    if ('payCost' in obj) { this.chargeCastCost(item, part, cost); return; }
    const paid = (part.costPaid ??= {});
    if ('payLife1' in obj) {
      this.need(this.canPayLife(item.controller, 1), 'bad cost choice');
      paid.life = (paid.life ?? 0) + 1;
      this.ev('info', `${this.pname(item.controller)} pays 1 life — the cost of ${item.label}.`);
      this.loseLife(item.controller, 1, `${item.label} (cost)`);
      return;
    }
    // CR 705.3b: one point of a printed "[x]". The reserve is re-checked here and
    // not only in the option list, because `need` is what a hand-written or
    // replayed action has to get past.
    if ('payMana1' in obj) {
      this.need(this.openMana(item.controller) - this.activationManaReserve(item) >= 1, 'bad cost choice');
      paid.mana = (paid.mana ?? 0) + 1;
      this.payMana(item.controller, 1);
      this.ev('info', `${this.pname(item.controller)} pays [1] — the cost of ${item.label} (X = ${paid.mana}).`);
      return;
    }
    // CR 111.7: "[Recall another ally]". A real CR 402.4 recall through the one entry
    // point, so 'handEntered' and 'despawned' both fire — the cost is paid in
    // the cast window, so those triggers queue and settle after the item is on
    // the stack, exactly as a "[Sacrifice a unit]" cost's death trigger does.
    if ('recall' in obj) {
      const u = this.entity(obj['recall'] as EntityId);
      this.need(u && u.kind === 'unit' && u.controller === item.controller && !u.absent
        && u.region === item.region && u.id !== item.sourceId, 'bad cost choice');
      (paid.recalled ??= []).push({ unit: u!.id, card: u!.card });
      this.ev('info', `${this.pname(item.controller)} recalls ${u!.card} — the cost of ${item.label}.`);
      this.recall(u!);
      return;
    }
    // CR 111.2: "[Erase one of my mods]". Not `destroy` and not `disposeToBin`:
    // an erase removes the mod from the game outright, which is the reading
    // Slag Spewer has always had — only the MOMENT has moved into the window.
    if ('eraseMod' in obj) {
      const modId = obj['eraseMod'] as EntityId;
      const host = item.sourceId !== undefined ? this.entity(item.sourceId) : undefined;
      const mod = this.entity(modId);
      this.need(mod && host && host.mods.includes(modId), 'bad cost choice');
      (paid.erasedMods ??= []).push({ mod: modId, card: mod!.card });
      // CR 720.9 / CT-86, ANSWERED 2026-08-26 (CR 801.6). An erased card goes to the
      // erased pile. The card says "erase"; that names the destination, and
      // there was never a question here — the owner, asked it: "Obviously the
      // card says where it should end up. It's erased… It should just end up
      // in the erased zone."
      //
      // ⚠ WHAT THE WRONG QUESTION COST: this shipped as `ev('info', …)` with a
      // comment calling the destination "UNANSWERED", it was written up as
      // round-27 Q3 AND Q9, it kept CT-86 open across two rounds, and it put a
      // scenario in front of the owner asking him to rule on something his
      // cards already say. The erased pile exists because of his complaint that "there's
      // currently no way to view erased cards" — a cost-erase that files
      // nowhere is that same bug, not an open design question.
      //
      // `leavesGame` is now READ (it was `void`ed while this was "open"), so a
      // site that erases something which is NOT leaving the game — Reclaim the
      // Fallen puts the card into play — passes `false` and stays off the pile.
      this.eraseMod(mod!, {
        leavesGame: true,
        msg: `${mod!.card} is ERASED off ${host!.card} — the cost of ${item.label}.`,
      });
      return;
    }
    if ('discard' in obj) {
      const idx = obj['discard'] as number;
      const name = this.player(item.controller).hand[idx];
      this.need(name !== undefined, 'bad cost choice');
      (paid.discarded ??= []).push(name!);
      this.ev('info', `${this.pname(item.controller)} discards ${name} — the cost of ${item.label}.`);
      this.discardFromHand(item.controller, idx);
      return;
    }
    if ('erase' in obj) {
      const name = obj['erase'] as CardName;
      const bin = this.player(item.controller).bin;
      const idx = bin.indexOf(name);
      this.need(idx !== -1, 'bad cost choice');
      this.removeFromBin(item.controller, idx, 'erased');   // CR 405.7
      (paid.erased ??= []).push(name);
      // 'erased', not 'info': this is a real erase, and CR 407.2's public pile is
      // kept by ev() off exactly this event
      this.ev('erased', `${this.pname(item.controller)} erases ${name} from their bin — the cost of ${item.label}.`,
        { card: name, seat: item.controller });
      return;
    }
    if ('counterFrom' in obj) {
      const u = this.entity(obj['counterFrom'] as EntityId);
      this.need(u && u.kind === 'unit' && u.controller === item.controller && !u.absent
        && u.counters > 0 && (cost.kind !== 'removeCounters' || cost.from !== 'self' || u.id === item.sourceId),
        'bad cost choice');
      // BL-25/CR D7.2: one pick, several counters. Absent `n` is 1 — the shape
      // every saved game and every existing test sends.
      //
      // CLAMPED, not refused, and deliberately: the client's stepper carries a
      // count across units, so "take 3" landing on a unit that has 2 must take
      // 2 rather than throw the whole cast away. The two ceilings are the
      // unit's own counters and — for a FIXED cost — what is still owed, so
      // "[Remove 2]" can never be overpaid into by a hand-rolled action.
      const asked = typeof obj['n'] === 'number' ? Math.floor(obj['n'] as number) : 1;
      const total = costAmount(cost);
      const owed = total === null ? Infinity : total - this.costPaidSoFar(part, cost);
      const n = Math.min(Math.max(1, asked), u!.counters, owed);
      this.need(Number.isFinite(n) && n >= 1, 'bad cost choice');
      (paid.counters ??= []).push({ unit: u!.id, card: u!.card, n });
      this.ev('info', `${this.pname(item.controller)} removes ${
        n === 1 ? 'a +1/+1 counter' : `${n} +1/+1 counters`} from ${u!.card} — the cost of ${item.label}.`);
      this.removeCounters(u!, n);   // CR 111.2, 708.8: a removal, not a placement
      return;
    }
    const id = (val as { unit: EntityId }).unit;
    const u = this.entity(id);
    this.need(u && u.kind === 'unit' && u.controller === item.controller && !u.absent
      && u.region === item.region, 'bad cost choice');
    const [p, t] = this.effStats(u);
    // 'sacrificeUnit' keeps the singular receipt every existing card reads
    // (batch-fire-a, batch-fire-b, batch-metal-b, batch-hybrids-wm-b all read
    // `paid.sacrificed`); the plural kind accumulates its own list, and the
    // two are built SEPARATELY rather than sharing one object — the plural one
    // carries `unit` and `counters` besides, and a shared literal would mean
    // every future field on one silently appearing on the other.
    if (cost.kind === 'sacrificeUnits') {
      // ⚠ `u.counters` RAW, deliberately not reconstructed from effStats:
      // counters NET (Caleb, on +1/+1 and -1/-1 on the same card, "0, they
      // cancel out") and a temporary buff is not a counter at all ("oh, no
      // those are not counters"), so the entity's own field is the only
      // number that answers "how many counters are on it".
      (paid.sacrificedUnits ??= []).push({
        unit: u!.id, card: u!.card, power: p, defense: t, counters: u!.counters,
      });
    } else {
      paid.sacrificed = { card: u!.card, power: p, defense: t };
    }
    this.ev('info', `${this.pname(item.controller)} sacrifices ${u!.card} — the cost of ${item.label}.`);
    this.destroy(u!, 'is sacrificed');
  }

  /** CR 111.2: the units one choice-bearing activation-cost atom may name.
   * The source is never one of them ("another"), and a `discardOrSacrifice`
   * or a `nontoken`-flagged atom may not name a token. The ONE reading the
   * option list, the payability gate and `payItemCost`'s validation share. */
  private itemCostSacrifices(item: StackItem, atom: NonNullable<StackItem['pendingCosts']>[number]): Entity[] {
    const nontokenOnly = atom.kind === 'discardOrSacrifice' || atom.nontoken === true;
    return this.unitsOf(item.controller, item.region)
      .filter(u => u.id !== item.sourceId && (!nontokenOnly || !u.token));
  }

  /** CR 111.6: can this ONE choice-bearing atom still be paid, right now? */
  private itemCostAtomPayable(item: StackItem, atom: NonNullable<StackItem['pendingCosts']>[number]): boolean {
    const hand = this.player(item.controller).hand.length;
    const sacs = this.itemCostSacrifices(item, atom).length;
    switch (atom.kind) {
      case 'discard': return hand >= atom.n;
      case 'sacrificeOther': case 'playSacrifice': return sacs >= atom.n;
      case 'discardOrSacrifice': return hand + sacs >= atom.n;
    }
  }

  /**
   * CR 111.6a — THE COMPOUND-COST GATE, and the fix for the half-pay hazard the
   * 2026-08-23 audit left documented inside `collectItemCosts`.
   *
   * An activation cost is collected by up to three collectors in one window,
   * in this order: a VARIABLE `castCost` (CR 705.3b), then the choice-free half
   * (`payActivationCost` — mana, life, debt, sacrifice-me), then the
   * choice-bearing atoms (`collectItemCosts`), then a FIXED `castCost`. Each
   * charges as it goes. So a COMPOUND cost — one that uses more than one of
   * them — could charge its first half and only then discover the second half
   * unpayable, at which point "nothing is paid and the ability does nothing"
   * is a lie about the mana.
   *
   * CR 111.14 already answers this shape for a multiplied graft cost: *all or
   * nothing, asked ONCE, before the first copy pays*. This is that, for a
   * compound activation cost — asked at the TOP of the window, where nothing
   * has been charged yet, so abandoning really does pay nothing. `collectTargets`
   * re-runs from the top after every answered decision and `activationCost` is
   * deleted the moment the choice-free half is charged, so this asks exactly
   * once per activation, before the first payment.
   *
   * ⚠ IT IS A GATE, NOT A REPAIR, and the reachability matters. Nothing can
   * act inside the cast window — every suspension raised there is a question
   * for the PAYER, triggers only queue, and the opponent never holds priority
   * — so the audit's "a response took the last unit" cannot actually happen.
   * What CAN happen is a payer's own earlier atom eating a later one's pool
   * (pay X by sacrificing units, then owe a sacrifice). The per-collector
   * "cost can no longer be paid" branches stay as belt-and-braces beneath it.
   */
  private gateCompoundCost(item: StackItem): void {
    const cost = item.activationCost;
    if (!cost) return;                                   // already charged, or not an activation
    const charges = this.activationManaReserve(item) > 0
      || !!(cost.life || cost.debt || cost.sacrificeSelf || cost.eraseSelf);
    if (!charges) return;                                // not compound: only one collector will charge
    const atomsBad = (item.pendingCosts ?? []).some(a => !this.itemCostAtomPayable(item, a));
    const partsBad = item.parts.some(p => {
      if (p.spent || p.costPaid) return false;
      const cc = effectByKey(p.effectKey).castCost;
      // a VARIABLE cost is never "unpayable" — it simply closes at what was
      // paid, and X = 0 is legal (CR 107.2b). Only a FIXED one can fail.
      if (!cc || costAmount(cc) === null) return false;
      return !this.canPayCastCost(item.controller, cc, item.region, 0, item.sourceId,
        this.activationManaReserve(item));
    });
    if (!atomsBad && !partsBad) return;
    this.ev('info', `${item.label}: part of the activation cost can no longer be paid — `
      + 'nothing is paid and the ability does nothing.');
    // CARD-TODO #18: nothing was paid and nothing will resolve, so no use is spent.
    for (const p of item.parts) { p.spent = true; this.refundPart(item, p); }
    delete item.pendingCosts;
    delete item.activationCost;
  }

  /**
   * CR 705.3: the ITEM-level activation costs that carry a choice — "Discard a
   * card:", "Sacrifice a unit:". Collected in the same window as the cast
   * costs above, so an activation's cost is paid before its item reaches the
   * stack and nobody may respond in between. Mandatory: the activation was
   * already gated on being able to pay, and legalActions never offers one that
   * cannot be. Atoms are popped as they are paid, so a resumed cast picks up
   * exactly where it left off.
   */
  private collectItemCosts(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[]): void {
    while (item.pendingCosts?.length) {
      const atom = item.pendingCosts[0]!;
      const seat = item.controller;
      // "sacrifice a NONTOKEN unit" is the printed wording of the either/or
      // shape; the plain sacrifice-another cost takes any unit you control —
      // unless the atom's `nontoken` flag is set (Instrument of Reassignment's
      // "Sacrifice another nontoken unit"), which narrows it the same way.
      const sacs = this.itemCostSacrifices(item, atom);
      const discards: DecisionOption[] = this.player(seat).hand
        .map((n, i) => ({ label: atom.kind === 'discard' ? n : `Discard ${n}`, value: { discard: i }, card: n }));
      const sacrifices: DecisionOption[] = sacs
        .map(u => ({ label: atom.kind === 'discardOrSacrifice' ? `Sacrifice ${u.card}` : u.card, value: { unit: u.id }, card: u.card }));
      const options: DecisionOption[] =
        atom.kind === 'discard' ? discards
          : atom.kind === 'sacrificeOther' || atom.kind === 'playSacrifice' ? sacrifices
            : [...discards, ...sacrifices];
      if (!options.length) {
        // the payment vanished between activation and collection (a response
        // took the last unit): the cost is unpayable, so nothing is paid and
        // the whole activation is skipped — CR 111.6's unpayable-cost reading.
        // ⚠ THE 2026-08-23 AUDIT'S LATENT HALF-PAY IS FIXED (CR 111.6a), and this
        // branch is now the belt to that braces. It used to read: "nothing is
        // paid" holds only because no pool ability combines a choice-free half
        // (charged by payActivationCost one call EARLIER) with a choice half
        // like this one — the first card that does will reach here with its
        // mana already spent. FOUR cards now do (Instrument of Reassignment,
        // Auric Ascendant, Slag Spewer, and any future compound), and the
        // answer chosen was neither "refund" nor "reorder" but CR 111.14's: the
        // ALL-OR-NOTHING gate `E.gateCompoundCost`, asked at the top of the
        // cast window BEFORE anything is charged. See its comment for why the
        // audit's own scenario ("a response took the last unit") is not in
        // fact reachable, and what is.
        // CR 111.10d: for a 'playSacrifice' atom this branch is unreachable by
        // construction today — canPayCard gated the play on the count, and
        // nothing may act between the gate and this collection — but it is
        // kept as the belt-and-braces answer should a payCard-side trigger
        // ever eat the last unit inside the window.
        this.ev('info', atom.kind === 'playSacrifice'
          ? `${item.label}: the imposed [sacrifice a unit] cost can no longer be paid — the effect is skipped.`
          : `${item.label}: the activation cost can no longer be paid — the ability does nothing.`);
        // CARD-TODO #18: "the ability does nothing" is the ruling's own test —
        // nothing was paid and nothing will resolve, so no use is spent.
        for (const p of item.parts) { p.spent = true; this.refundPart(item, p); }
        delete item.pendingCosts;
        return;
      }
      this.suspend(
        { type: 'cast', stage: 'itemCost', item, partIndex: 0, targetIndex: 0, then, moreItems },
        {
          seat, kind: 'targets',
          prompt: `${item.label}: ${
            atom.kind === 'discard' ? 'discard a card'
              : atom.kind === 'sacrificeOther' || atom.kind === 'playSacrifice' ? 'sacrifice a unit'
                : 'discard a card or sacrifice a nontoken unit'
          } (${atom.kind === 'playSacrifice' ? 'additional cost' : 'activation cost'}${atom.n > 1 ? `, ${atom.n} left` : ''})`,
          options,
        },
      );
    }
    delete item.pendingCosts;
  }

  /** Pay one atom of an item-level activation cost (see collectItemCosts). */
  payItemCost(item: StackItem, val: unknown): void {
    const atom = item.pendingCosts?.[0];
    this.need(atom, 'no activation cost is pending');
    const receipt = (item.paidCosts ??= {});
    const paysByDiscard = val !== null && typeof val === 'object' && 'discard' in (val as object);
    if (atom!.kind === 'discard' || (atom!.kind === 'discardOrSacrifice' && paysByDiscard)) {
      const idx = (val as { discard: number }).discard;
      const name = this.player(item.controller).hand[idx];
      this.need(name !== undefined, 'bad cost choice');
      (receipt.discarded ??= []).push(name!);
      this.ev('info', `${this.pname(item.controller)} discards ${name} — the cost of ${item.label}.`);
      this.discardFromHand(item.controller, idx);
    } else {
      const id = (val as { unit: EntityId }).unit;
      const u = this.entity(id);
      // CR 111.2: the ONE reading of "which units may this atom name" — the same
      // helper the option list and the payability gate use.
      this.need(u && this.itemCostSacrifices(item, atom!).some(o => o.id === u.id), 'bad cost choice');
      (receipt.sacrificed ??= []).push(u!.card);
      this.ev('info', `${this.pname(item.controller)} sacrifices ${u!.card} — the cost of ${item.label}.`);
      this.destroy(u!, 'is sacrificed');
    }
    atom!.n--;
    if (atom!.n <= 0) item.pendingCosts!.shift();
    if (!item.pendingCosts!.length) delete item.pendingCosts;
  }

  /** Ask for every cast-time decision, in order: X (CR 702.3), {Modular} mods,
   * TARGETS for every part that needs them, then the costs — ALL at cast time
   * (multi-target specs included). Suspends via 'cast'.
   *
   * CR 111.7: targets are chosen BEFORE any activation cost is paid. They used to
   * come last, so "Sacrifice me: …" destroyed the unit and only then showed
   * you what you could aim at — irreversible, and a disaster to fumble during
   * battle when you meant to block with it. Choosing first also means a
   * player who cannot aim the ability anywhere still has their unit.
   */
  collectTargets(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[]): void {
    // CR 111.6a: FIRST, before any collector charges anything — a COMPOUND
    // activation cost is all or nothing (CR 111.14's rule, one scope up).
    this.gateCompoundCost(item);
    // CR 722.6a: a graft composite whose grafted [cost] cannot be paid is withheld
    // HERE, before anyone is asked to aim a part that will never resolve
    this.gateGraftCosts(item);
    if (item.withheld) return;
    this.collectX(item, then, moreItems);
    // CR 702.3a: a VARIABLE bracketed cost is where X comes from ("[Remove X +1/+1
    // counters from allies]", "[Sacrifice X units]"), so it is paid up here
    // with the mana X rather than down with the fixed costs — the spell's size
    // has to be settled before it can be aimed, since what it may aim at is
    // sized by X ("Negate up to X target effects"). The "targets before
    // costs" rule (CR 702.3f) is about not destroying a unit before showing what it could have
    // hit; a cost that decides how big the spell is has no such reading.
    this.collectCastCosts(item, then, moreItems, 'variable');
    // {Modular} before the costs and the targets: an applied mod adds a part,
    // and that part has its own [cost] and its own targets to collect
    // (Manual p.33 — the composite resolves as ONE ability)
    this.collectModular(item, then, moreItems);
    this.collectPartTargets(item, then, moreItems);
    // CR 702.3d: WHICH HALF of a modal effect. AFTER the targets, so a mode can name
    // what it is aimed at ("double Good Whale's power (5 → 10) or defense
    // (3 → 6)?"); BEFORE the costs, so the rule that "nothing irreversible is spent
    // until the effect is fully declared" (CR 702.3) holds for a modal card too.
    this.collectModes(item, then, moreItems);
    this.collectFormationSpot(item, then, moreItems);   // CR 602.7: "play me into a spot"
    this.payActivationCost(item);                   // CR 705.3d: choice-free half
    this.collectItemCosts(item, then, moreItems);   // CR 705.3: the choice-bearing half
    this.collectCastCosts(item, then, moreItems, 'fixed');
    // CR 702.3: LAST — "As you play a nonunit spell, you may sacrifice me…"
    // (Maelstrom Charger). Everything about the play is declared by now, which
    // is what makes the option answerable, and nothing about the option itself
    // ever reaches the stack.
    this.collectAsYouPlay(item, then, moreItems);
  }

  /**
   * CR 702.3g — every AS-YOU-PLAY option this play offers right now, in a
   * deterministic order.
   *
   * The `anchored()` walk every `CardBehavior` channel uses: units in play and
   * augment mods read from their HOST, CR 101.6-scoped to the region the card is
   * being played into, with the shallow CR 712.1a guard (a silenced unit offers
   * nothing — the printed line is text-box text, and "loses all abilities"
   * takes text-box text with it). `behaviorFaces` is what makes the RAQ's last
   * line true: an Ancient One standing next to a Maelstrom Charger wears the
   * Charger's face, so it offers the option and sacrifices ITSELF for it.
   *
   * `self` is the ANCHOR — the body that would pay — because that is what
   * "[Augment]"-style anchoring means everywhere else, and `key` is
   * (anchor, face) rather than a card name for exactly the Ancient One reason:
   * two bodies offering the same face are two separate offers.
   */
  private asYouPlayOffers(item: StackItem): { self: Entity; via: CardName; key: string; opt: AsYouPlayOption }[] {
    const out: { self: Entity; via: CardName; key: string; opt: AsYouPlayOption }[] = [];
    const live = this.radiates();
    const holders = this.anchored((h, a) =>
      a.region === item.region && this.donates(h, a, 'asYouPlay') && live(h, a));
    for (const { holder, anchor } of holders) {
      for (const { face: via, def } of this.behaviorBlocks(holder, anchor)) {
        for (const opt of def.asYouPlay ?? []) {
          if (!opt.when(this, anchor, item)) continue;
          out.push({ self: anchor, via, key: `${anchor.id}:${via}`, opt });
        }
      }
    }
    return out;
  }

  /**
   * CR 702.3g — the AS-YOU-PLAY stage of the cast window.
   *
   * Three questions, in this order, all of them through the ordinary 'cast'
   * suspension so a saved game replays them like any other cast-time answer:
   *
   *  1. per offer, "pay it?" — a *may*, so Decline is always there;
   *  2. per copy bought, "choose new targets for the copy?";
   *  3. per copy re-aiming, its targets slot by slot.
   *
   * `suspend` throws, so each loop simply stops at the first unanswered
   * question and `collectTargets` re-enters here from the top on resume; every
   * "have I asked this already" test therefore reads state on the ITEM
   * (`asked`, `aim`, `targets`, `done`) rather than a local.
   *
   * NOTHING HERE IS ON THE STACK. There is no item to negate, no trigger to
   * order, nothing for CR 111.10g's `gateTaxedTrigger` to tax (it only ever sees a
   * `PendingTrigger`) and no window in which an opponent may act — the RAQ:
   * *"Meal copying is not an effect on the stack so enemy cannot interact with
   * it. Opponent can only interact with copy of a spell effect."* The copies
   * themselves are materialised in `commitItem`, once the original is on the
   * stack, so they land above it.
   */
  private collectAsYouPlay(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[]): void {
    // plays only: a triggered/activated item on the stack is not a card being
    // played, and a virus is a mod being applied (CR 701.2a), which is not a play.
    if (!CARD_PLAY_KINDS.has(item.kind) && item.kind !== 'spellToken') return;
    const offers = this.asYouPlayOffers(item);
    if (!offers.length && !item.asYouPlay) return;
    const st = (item.asYouPlay ??= { asked: [], copies: [] });
    for (const o of offers) {
      if (st.asked.includes(o.key)) continue;
      // the label names the BODY that would pay, not the card the text is
      // printed on — an Ancient One wearing this face sacrifices itself
      const take = o.opt.label(this, o.self, item);
      this.suspend(
        { type: 'cast', stage: 'asYouPlay', item, partIndex: 0, targetIndex: 0, then, moreItems },
        {
          seat: o.self.controller, kind: 'payOrDecline',
          prompt: `${o.via}, as you play ${item.label}: ${take}?`,
          options: [
            { label: take, value: { ayp: 'take', key: o.key } },
            { label: 'Decline', value: { ayp: 'skip', key: o.key } },
          ],
        },
      );
    }
    // "…and you may choose new targets for the copy" (CR 710.8a: declared here, so
    // the first response window sees a finished copy)
    for (let i = 0; i < st.copies.length; i++) {
      const c = st.copies[i]!;
      if (c.done) continue;
      const spec = item.card !== undefined ? this.card(item.card).spellEffect?.targets : undefined;
      // ⚠ read off the FACE, not off the accepted option: `via` is all the
      // ledger keeps, so a face declaring TWO options that disagree about
      // `reaim` would collapse them. No card declares two; the day one does,
      // the ledger has to carry the option index too.
      const reaim = !!this.card(c.via).asYouPlay?.some(o => o.copySpell?.reaim);
      if (!spec || !reaim) { c.done = true; continue; }
      const counted = spec.count === 'X' ? (item.x ?? 0) : (spec.count ?? 1);
      const max = counted + (spec.extraSlots ?? 0);
      const min = targetMinimum(spec, counted);
      const picked = c.targets ?? [];
      const taken = new Set(picked.map(r => JSON.stringify(r)));
      const chosen = picked
        .map(r => this.resolveTargetRef(r))
        .filter((r): r is ResolvedTarget => !!r);
      const cands = max <= picked.length ? [] : this.targetCandidates(
        specForSlot(spec, picked.length), item.region, item.id, item.controller,
        undefined, item.x, chosen, null,
      ).filter(cd => !taken.has(JSON.stringify(cd)));
      if (c.aim === undefined) {
        // a genuinely empty menu is not a choice — the originals ride, said out
        // loud rather than silently (test/65: a guard that aborts must log)
        if (!cands.length) {
          this.ev('info', `${c.via}: no legal new target for the copy of ${item.card} — the original targets stand.`);
          c.aim = 'keep'; c.done = true; continue;
        }
        this.suspend(
          // `partIndex` carries WHICH COPY is being aimed, so the answer itself
          // can be the plain value the base target stage already uses — a bare
          // boolean here, a bare TargetRef below.
          { type: 'cast', stage: 'asYouPlay', item, partIndex: i, targetIndex: 0, then, moreItems },
          {
            seat: item.controller, kind: 'payOrDecline',
            prompt: `${c.via}: choose new targets for the copy of ${item.card}?`,
            options: [
              { label: 'Choose new targets', value: true },
              { label: 'Keep the original targets', value: false },
            ],
          },
        );
      }
      if (c.aim === 'keep') { c.done = true; continue; }
      if (!cands.length) { c.done = true; continue; }   // a later slot with nothing legal ends it
      const options: DecisionOption[] = cands.map(cd =>
        ({ label: this.targetLabel(cd), value: cd }));
      if (picked.length >= min) options.push({ label: doneTargetsLabel(picked.length), value: { doneTargets: true } });
      this.suspend(
        { type: 'cast', stage: 'asYouPlay', item, partIndex: i, targetIndex: 0, then, moreItems },
        {
          seat: item.controller, kind: 'electricPath',
          prompt: `${c.via}: new target for the copy of ${item.card}`
            + (max > 1 ? ` (target ${picked.length + 1} of up to ${max})` : ''),
          options,
        },
      );
    }
  }

  /**
   * CR 702.3g — record one answer to the as-you-play stage (called from doDecide).
   *
   * `take` is where the option's cost is PAID, and it is paid the instant the
   * controller accepts: cost-shaped means spent as you play, with no window
   * between the yes and the payment for anything to happen in.
   */
  applyAsYouPlay(item: StackItem, val: unknown, copyIndex: number): void {
    const v = (val ?? {}) as { ayp?: string; key?: string; doneTargets?: boolean };
    const st = (item.asYouPlay ??= { asked: [], copies: [] });
    if (v.ayp === 'take' || v.ayp === 'skip') {
      const o = this.asYouPlayOffers(item).find(x => x.key === v.key);
      if (v.key !== undefined && !st.asked.includes(v.key)) st.asked.push(v.key);
      if (v.ayp === 'skip' || !o) {
        // test/85's rule, and the old trigger version's own line: a declined
        // *may* must SAY it was declined, or the log shows a question with no
        // answer. Named after the FACE, so an Ancient One wearing the option
        // is reported as the Ancient One declining a Charger's line.
        if (o) this.ev('info', `${o.via}: ${this.pname(o.self.controller)} declines — ${item.card} is not copied.`);
        return;
      }
      o.opt.pay(this, o.self, item);
      if (o.opt.copySpell) st.copies.push({ by: o.self.id, via: o.via });
      return;
    }
    // Everything below is about ONE copy — which one is `sus.partIndex`, not a
    // field of the answer, so the answers themselves keep the shapes the base
    // cast stage already uses: a bare boolean for the keep/re-aim question, a
    // bare TargetRef (or `{ doneTargets }`) for a slot.
    const c = st.copies[copyIndex];
    if (!c) return;
    if (typeof val === 'boolean') { c.aim = val ? 'new' : 'keep'; return; }
    if (v.doneTargets) { c.done = true; return; }
    (c.targets ??= []).push(val as TargetRef);
  }

  /**
   * CR 710.8 — materialise the copies an as-you-play option bought.
   *
   * Called from `commitItem` AFTER the original has been pushed, so each copy
   * lands above it and resolves first — RAQ: *"put copy of spell effect on
   * stack (above original spell effect)"*. Two of them make two copies, in the
   * order the options were accepted.
   *
   * The copy is `E.pushSpellCopy`'s ordinary CR 710.8 copy: a real, respondable,
   * negatable stack item, which is the ONLY thing the opponent may interact
   * with here (*"Opponent can only interact with copy of a spell effect."*).
   * It inherits the original's paid cost receipt and X — *"you DON'T pay
   * additional cost again and the X value is the one from original spell"* —
   * because a clone of the item simply carries them.
   */
  private makeAsYouPlayCopies(item: StackItem): StackItem[] {
    const made: StackItem[] = [];
    for (const c of item.asYouPlay?.copies ?? []) {
      const targets = c.aim === 'new' && c.targets?.length ? c.targets : undefined;
      this.ev('info', `${c.via}: ${this.pname(item.controller)} copies ${item.card}`
        + ' — the copy goes on the stack above it.');
      const copy = this.pushSpellCopy(item, { controller: item.controller, ...(targets ? { targets } : {}) });
      if (copy) made.push(copy);
    }
    return made;
  }

  /**
   * CR 705.3d: charge the choice-free half of an activation cost — mana, life, debt
   * and sacrifice-self — once the ability's targets are settled. Deleting the
   * field is the idempotence guard: collectTargets re-runs from the top after
   * every answered decision, and this must not charge twice.
   */
  private payActivationCost(item: StackItem): void {
    const cost = item.activationCost;
    if (!cost) return;
    delete item.activationCost;
    const seat = item.controller;
    // CR 111.10f, 111.6: the ability-cost tax layer (Crevice Lurker) joins the printed
    // mana — same cast-window moment, and legality-gated by the same
    // canPayAbilityCost both the offer and the accept already share, so an
    // unaffordable taxed activation was never offered in the first place.
    // `item.card` is the card the ability is printed on (viaCard ?? face),
    // the identity canPayAbilityCost taxed.
    const tax = item.card !== undefined
      ? this.abilityTax(seat, item.card, item.region, 'activate')
      : { total: 0, byCard: [] as CardName[] };
    this.payMana(seat, (cost.mana ?? 0) + tax.total);
    if (tax.total > 0) {
      this.ev('info', `${item.label} is taxed [${tax.total}] more (${tax.byCard.join(', ')}).`,
        { seat, region: item.region, tax: tax.total });
    }
    if (cost.life) {
      this.ev('info', `${this.pname(seat)} pays ${cost.life} life — the cost of ${item.label}.`);
      this.loseLife(seat, cost.life, `${item.label} (cost)`);
    }
    if (cost.debt) {
      this.ev('info', `${this.pname(seat)} gains ${cost.debt} debt — the cost of ${item.label}.`);
      this.gainDebt(seat, cost.debt);
    }
    if (cost.sacrificeSelf) {
      const u = item.sourceId !== undefined ? this.entity(item.sourceId) : undefined;
      if (u && u.kind === 'unit') this.destroy(u, 'is sacrificed');   // cost, not respondable
    }
    if (cost.eraseSelf) {
      // Skybreaker's printed "Erase me:". Being a COST it is paid here, on the
      // way to the stack — the unit is gone before anybody may respond to the
      // ability, exactly as the sacrifice above is. Not `destroy`: an erase is
      // not a death and no card reaches a bin, so no 'died' and (CR 801.2c) no
      // trash. CR 801.6a: it IS a despawn, and fires one.
      const u = item.sourceId !== undefined ? this.entity(item.sourceId) : undefined;
      if (u && u.kind === 'unit') this.eraseFromPlay(u, `— the cost of ${item.label}.`);
    }
  }

  /**
   * Remove a unit from play ENTIRELY: no bin, **no death**, and (CR 801.2c) no trash
   * either — Caleb: erasing never touches a bin, so it is never a trash. Its
   * mods go with it, having nothing left to be attached to. CR 410.4b: the card and
   * its mods reach the public erased pile, which ev() keeps off the 'erased'
   * event.
   *
   * ⚠ **CR 801.6a: an erase IS A DESPAWN.** This used to say "no despawn, so
   * nothing triggers off it", and it fired only `'erased'` — a type no
   * `fireEvent` site anywhere dispatches, so an erase was invisible to the
   * game in exactly the way a Hooba-Mon exchange once was. The repo
   * had already ruled the general case twice: **the exchange ruling (CR 410.2a)** — *"It's not a
   * death, but it IS a despawn and a trashing"* — and **the earlier repair of the same omission on `exchangeInPlace`**. An erase is the third non-death
   * departure and was the last one still silent, so every "whenever a unit
   * despawns" watcher (Demon of the Depths) was blind to Banishment and every
   * donated `[Augment] When I despawn` was dead on this route — the same bug, one verb over. The one thing an erase still does NOT do is TRASH: CR 801.2c is
   * about a card entering a bin, and nothing here enters one.
   *
   * ORDER, and why it differs from the `'erased'` lines in `destroy` /
   * `afterDespawn`: those two announce a card being swept back OUT of a bin, a
   * SECOND departure, so they land after the announce. Here the erased pile is
   * the card's DESTINATION, the analogue of `disposeToBin`'s bin push — so it
   * is filled BEFORE `'despawned'` fires, and a despawn listener sees the card
   * already sitting where it went, exactly as a death listener sees it already
   * in the bin.
   *
   * NOTHING DOUBLE-COUNTS. `'erased'` is a log-and-pile event with no
   * `fireEvent` site anywhere in the engine or the card pool, and `'despawned'`
   * never touches the pile (only `ev()`'s `type === 'erased'` branch writes
   * it). The two events reach two disjoint consumers: the pile and the log
   * hear the erase, triggered abilities hear the despawn.
   *
   * The same anchoring, repeated here because this route needed it too:
   * `fireEvent` finds a mod's donated `[Augment]` text by walking `u.mods`
   * THROUGH the entity table, so the mod entities are deleted in the LAST
   * statement rather than before the announce — otherwise the new event fires
   * with nothing left to donate. The window is inert for the same reasons it
   * is inert in `leavePlay`/`disposeToBin`: `fireEvent` only queues, nothing
   * resolves until `settle()`; an orphaned mod radiates nothing (`E.anchored`
   * resolves it through `entity(modOf)`, and the host is already gone); and
   * kind `'mod'` keeps it out of the listener scan.
   *
   * The card-side copies of this were folded into it too — helpers.ts's
   * `eraseFromPlay` and batch-hybrids-ld-a's `eraseUnit` are now one-line
   * shims, so all eight card call sites arrive here. (This ⚠ used to name a
   * third copy, "batch-water-a's Celestial Purge". That was wrong: Celestial
   * Purge has always CALLED the helpers one.)
   */
  eraseFromPlay(u: Entity, why = ''): void {
    if (!this.entity(u.id)) return;
    this.stampLastKnown(u);                     // CR 714.1
    // CR 407.4: the erased pile is a zone other than play, so a transformed
    // card is recorded there under its FRONT face — the piece of cardboard
    // that left the game is the printed card, not the side it was showing.
    this.revertFace(u);
    const mods = u.mods.map(id => this.entity(id)).filter((m): m is Entity => !!m);
    delete this.s.entities[u.id];
    this.removeFromFormation(u.id);
    // CR 410.4b: the host AND its mods reach the public erased pile, under the
    // host's OWNER — the same seat and the same one-event shape `destroy`
    // uses for an Unstable death, so the two erase routes read alike.
    this.ev('erased',
      `${u.card}${mods.length ? ` and its ${mods.length} mod(s)` : ''} is ERASED `
      + `(no bin, no death)${why ? ` ${why}` : '.'}`,
      {
        unit: u.id, card: u.card, seat: u.owner, region: u.region,
        cards: [u.card, ...mods.map(m => m.card)],
      });
    // CR 801.6a: …and it despawns. CR 714.9's fact bundle rides the event, because the
    // entity is already out of s.entities and a listener has no other way to
    // read what left. `to: 'erased'` fills the destination slot `recall` puts
    // 'hand' in and `cacheUnit` puts 'cache' in; the two readers of that slot
    // both test `=== 'hand'`, so nothing in the pool matches — which is right,
    // because no card enters a zone here.
    const ev = this.ev('despawned',
      `${u.card} despawns as it is erased — not a death, and not a trash.`,
      { ...this.leftPlayFacts(u), to: 'erased' });
    this.fireEvent('despawned', ev, u);
    // CR 721.1f: last, exactly as `disposeToBin` and `afterDespawn` do it — see the
    // anchoring paragraph above.
    for (const m of mods) delete this.s.entities[m.id];
  }

  /** CR 110.7: how many targets this part was REQUIRED to declare — its spec's
   * minimum at the X it was cast for. At resolution a part with none declared
   * runs only when this is 0: an "up to" spec, or `min: 'X'` cast at X = 0
   * (Torrential Reclamation's sacrifice still happens, CR 107.2b). */
  requiredTargetsOf(item: StackItem, part: EffectPart, spec: TargetSpec): number {
    return targetMinimum(spec, spec.count === 'X' ? (part.costPaid?.x ?? item.x ?? 0) : (spec.count ?? 1));
  }

  /**
   * CR 702.3c, 110.7 (CT-308, report #238) — the cast window's target collector,
   * asked through a RESOLVING effect's chooser instead of the cast window's
   * suspension. A card played in the middle of another effect's resolution
   * (Tides of the Cosmos, Hooba-Pon, Insidious Invitation) declares its targets
   * HERE, slot by slot, by the very loop a play from hand runs: every slot of a
   * multi-target spec ("For each player, recall target unit that player
   * controls"), each slot's own kind and restriction (Fight's ally, Necromorph's
   * bin card), the "up to" / "any number" stop, and an X-sized count at the X
   * the play was declared with. It used to ask ONE pick off slot 0 and stop, so
   * Tidal Reversion under Tides took one target of two. Same shape as
   * `collectInlineCastCosts`: only the asking differs.
   */
  collectInlineTargets(item: StackItem, ask: InlineCostAsk): void {
    this.collectPartTargets(item, 'push', [], ask);
  }

  /** CR 702.3c: record one answer to a target slot — a target, or the "no more
   * targets" stop (#206). The cast window's doDecide and the inline asker both
   * land here, so the two can never read an answer differently. */
  applyTargetAnswer(part: EffectPart, val: unknown): void {
    if (typeof val === 'object' && val !== null && 'doneTargets' in val) part.targetsDone = true;
    else part.targets.push(val as TargetRef);
  }

  private collectPartTargets(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[],
    ask?: InlineCostAsk): void {
    for (let pi = 0; pi < item.parts.length; pi++) {
      const part = item.parts[pi]!;
      if (part.spent) continue;
      const def = effectByKey(part.effectKey);
      if (!def.targets) continue;
      // CR 702.3a: "X target allies" / "up to X target effects" — the spec's count is
      // the spell's X, already fixed by collectX or by a variable cast cost.
      // CR 110.2b: `extraSlots` are fixed slots ON TOP of that count, occupying the
      // low indices (Channel Through's "target opponent" beside its X allies).
      const counted = def.targets.count === 'X'
        ? (part.costPaid?.x ?? item.x ?? 0)
        : (def.targets.count ?? 1);
      const max = counted + (def.targets.extraSlots ?? 0);
      const min = targetMinimum(def.targets, counted);   // CR 110.7 (min 'X' = all X)
      if (max <= 0) { part.targetsDone = true; continue; }
      while (!part.targetsDone && part.targets.length < max) {
        const n = part.targets.length;
        // CR 110.3: each slot may carry its own restriction (Fight: ally, then any
        // other unit), so candidates are computed per slot rather than once.
        const slot = specForSlot(def.targets, n);
        const chosen = new Set(part.targets.map(t => JSON.stringify(t)));
        const already = part.targets
          .map(t => this.resolveTargetRef(t)).filter((t): t is ResolvedTarget => t !== null);
        const cands = this.targetCandidates(slot, item.region, item.id, item.controller,
          item.sourceId, part.costPaid?.x ?? item.x, already, item.event)
          .filter(c => !chosen.has(JSON.stringify(c)));
        if (!cands.length) {
          // CR 704.6g: nothing legal to aim at. The part is skipped at resolution
          // either way, but silence here is the "why did nothing happen?"
          // that sends people to the bug button — so it says so, once.
          // (`targetsDone` is also the idempotence guard: collectTargets
          // re-runs from the top after every answered decision.)
          part.targetsDone = true;
          if (n === 0 && min > 0) {
            this.ev('info', `${item.label}: there is no legal target for that — it does nothing.`);
          }
          break;
        }
        /**
         * CR D2.8 / BL-30 — "DID YOU MEAN TO TARGET YOUR OWN UNITS?"
         *
         * The owner, 2026-08-26: *"there are many cards in the game that you
         * can TECHNICALLY point at several of your own units (Fight, Organic
         * Exchange). We shouldn't stop that from happening, they're legal
         * targets, but it might be nice to add a small warning."*
         *
         * Three conditions, and each is doing work:
         *
         *  1. the SPEC prints one ally and one other target (`mixedAllegiance`
         *     — the owner's own derivation, see dsl.ts). A spell meant to hit
         *     two allies has no unrestricted slot and never reaches this line;
         *     one meant to hit two enemies has no ally slot.
         *  2. something is ALREADY declared and all of it is the caster's. The
         *     first slot of such a spec is the forced ally, so there is
         *     nothing to be wrong about until a later slot is being filled.
         *  3. …and this candidate is the caster's too, so taking it would make
         *     EVERY declared target an ally — the owner's "if they select two
         *     of their own units", exactly.
         *
         * ⚠ NEVER A NARROWING. `cands` is untouched: the standing steer (CR 101.1, 101.4) is
         * that printed text wins and the permissive reading is the right one,
         * and BL-30 says it twice ("we shouldn't stop that from happening",
         * "they're legal targets"). This adds a question to an option, not a
         * filter to a list — and `confirm` is display-only, so a client that
         * ignores it plays exactly as it did before.
         */
        const mine = item.controller;
        const isAlly = (t: ResolvedTarget | null): boolean =>
          !!t && isEntityTarget(t) && t.controller === mine;
        // `already` is resolved (the loop above resolves it for the restriction
        // ctx); a candidate is still a ref and has to be looked up the same way
        const refIsAlly = (r: TargetRef): boolean => isAlly(this.resolveTargetRef(r));
        const askAlly = mixedAllegiance(def.targets, max)
          && already.length > 0 && already.every(isAlly);
        // `card` gives the UI a scan to render for targets that are not on the
        // board — a card in a bin or a cache has no entity to look at
        const options: DecisionOption[] = cands.map(c => ({
          label: this.targetLabel(c), value: c as TargetRef, ...this.targetCardOf(c),
          ...(askAlly && refIsAlly(c)
            ? { confirm: `${item.label} can target an enemy, and every target you have picked `
                + 'is one of your own units. Did you mean to?' }
            : {}),
        }));
        if (part.targets.length >= min) {
          options.push({ label: doneTargetsLabel(part.targets.length), value: { doneTargets: true } });   // #206
        }
        const base = def.targets.slotPrompts?.[n] ?? def.targets.prompt;
        const dec: Omit<Decision, 'id'> = {
          seat: item.controller, kind: 'targets',
          prompt: max > 1 && !def.targets.slotPrompts?.[n]
            ? `${base} (target ${n + 1} of up to ${max})` : base,
          options: options as { label: string; value: TargetRef }[],
        };
        // CR 702.3c: without `ask` this is the cast window's suspension, exactly
        // as before; with it (a mid-resolution play, `collectInlineTargets`) the
        // resolving effect's chooser answers and the loop goes on to the next slot.
        if (!ask) this.suspend({ type: 'cast', item, partIndex: pi, targetIndex: n, then, moreItems }, dec);
        this.applyTargetAnswer(part, ask(pi, n, dec));
      }
    }
  }

  /**
   * CR 702.5 — ask which HALF of a modal effect ("[… or …]") the caster is casting,
   * once per modal part, in the cast window.
   *
   * THE BUG THIS EXISTS FOR (playtest, Burgeon): every caster-facing mode in
   * the pool used to be a mid-resolution `ctx.choose`, so the item reached the
   * stack with its mode UNKNOWN. The opponent spent a card responding to a
   * Burgeon whose half had not been declared; the response resolved; and only
   * then was the caster asked — with the option labels recomputed off the
   * post-response stats. That is free information the opponent paid for, and
   * it is the defect that declaring targets at cast (CR 702.3c) fixed for targets: a response window is only
   * meaningful if what you are responding to is fully declared.
   *
   * A mode is not a target and not a cost, so it gets its own stage rather
   * than riding on one of theirs. `part.mode !== undefined` is the idempotence
   * guard — collectTargets re-runs from the top after every answered decision
   * — which is why a part with nothing to choose between records `null`
   * instead of staying undefined and asking again forever.
   *
   * EVERY PRINTED BRACKET IS THE CASTER'S (CR 205.3a). What stays at resolution is
   * the two things that are not printed brackets: CR 702.5a's unbracketed "unless its
   * controller pays" (Abduct), which really is the opponent's decision, and a
   * replacement-effect mode (Cosmic Conspirator), which is raised before the
   * token it is about exists. Void Memory used to be listed here as a third —
   * "each opponent discards a [unit or spell]", filed under CR 704.1a's
   * not-a-target carve-out — and it was the defect CR 205.3a rules out: the half was
   * being picked by the players it is aimed AT, each of them looking at their
   * own hand, which is the opposite of the guess the card is.
   */
  private collectModes(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[]): void {
    for (let pi = 0; pi < item.parts.length; pi++) {
      const part = item.parts[pi]!;
      if (part.spent) continue;
      if (part.mode !== undefined) continue;   // idempotence guard (see above)
      const def = effectByKey(part.effectKey);
      if (!def.modes) continue;
      const options = def.modes.options(this, item, part);
      if (options.length < 2) {
        // not a question: one half (or none) is all there is. Recorded so the
        // guard above holds, and so `ctx.mode` is the same shape either way.
        part.mode = options.length ? options[0]!.value : null;
        continue;
      }
      this.suspend(
        { type: 'cast', stage: 'mode', item, partIndex: pi, targetIndex: 0, then, moreItems },
        {
          seat: item.controller, kind: 'mode',
          prompt: def.modes.prompt(this, item, part),
          options,
        },
      );
    }
  }

  /**
   * "When I become targeted" (Mohruung). PLAYTEST BUG: this logged the event
   * but never DISPATCHED it, so a spell aimed at Mohruung created no Crystal.
   * Modding already fired it (doAugment/doGraft) — only the stack path was
   * deaf. Dispatch carries the region so region-scoped listeners resolve;
   * the targeted unit's own region is the authority (the item's region and
   * the target's agree for every legal target, and `self: true` listeners
   * match on `unit` anyway).
   *
   * CR 710.8b: split out of `commitItem` so `pushSpellCopy` can dispatch it too. A
   * COPY is not played and fires no play event, but it does have targets of
   * its own, and a copy pointing at your unit is targeting it.
   */
  private dispatchTargeted(item: StackItem): void {
    for (const part of item.parts) {
      for (const t of part.targets) {
        // CR 110.3d: a FORMATION target is a real target and says so — the log line
        // and the event both name it, so an "it was targeted" listener can see
        // it at all. It carries `formation` (whose side) rather than `unit`,
        // and DELIBERATELY does not fire "when I become targeted" for each
        // unit standing in it: what was targeted is the formation, not the
        // units, and a `self: true` listener matching on `unit` is exactly the
        // thing that must not match. Same choice the player/stack/bin arms
        // already make by falling through — this one is loud instead of
        // silent, because the formation IS a target and they are not units.
        if ('formation' in t) {
          const ev = this.ev('targeted', `${item.label} targets ${this.targetLabel(t)}.`,
            { item: item.id, formation: t.formation, seat: item.controller, kind: item.kind,
              region: item.region });
          this.fireEvent('targeted', ev);
          continue;
        }
        if (!('unit' in t)) continue;
        const u = this.s.entities[t.unit];
        // CR 109.3d: `seat` and `kind` ride the event so a listener can
        // recognise "an ENEMY SPELL targeted my ally" from the event ALONE.
        // Without them the only way to answer that was to scrape the event log
        // for the run of 'targeted' lines commitItem had just written — which
        // collapsed a two-target spell into ONE trigger, because a log scrape
        // answers a yes/no about the whole batch rather than firing per target.
        // The dispatch below was already once-per-target; only the payload was
        // too thin to use it. (`kind` is the STACK item's kind — 'spell',
        // 'spellUnit', 'unit', 'triggered', … — not the card's.)
        const ev = this.ev('targeted', `${item.label} targets ${this.targetLabel(t)}.`,
          { item: item.id, unit: t.unit, seat: item.controller, kind: item.kind,
            ...(u ? { region: u.region } : {}) });
        this.fireEvent('targeted', ev);
      }
    }
  }

  /**
   * CR 710.8 — put a COPY of a spell already on the stack onto the stack.
   *
   * The primitive Earthbound Replicator and Maelstrom Charger were waiting
   * for. Both used to re-run the copied card's `spellEffect` IN PLACE, which
   * answered "no" to every interaction question a copy raises: nobody could
   * respond to it, no stack sweep (Dematerialize, Calming Force, Malevolent
   * Machinations) could see it, and it never appeared on the stack at all.
   *
   * RAQ "[Solved] Earthbound Replicator. No, it's not infinity" and
   * "[Solved] Maelstrom Charger - all you need to know." (_passer) settle
   * every question this raises:
   *
   *  · *"Copy is new spell effect on stack"*, *"above original spell effect"*
   *    — so it is a real item, pushed while the original sits below it, and it
   *    therefore resolves FIRST.
   *  · *"Copy spell is not a token."* — the copy keeps the ORIGINAL's kind and
   *    is marked `copy` instead of being minted as a `spellToken`, which would
   *    have made every "token" reading of it true and stamped `token: true` on
   *    an event.
   *  · *"the 1st copy wasn't 'played'"* — a copy is not a play, so this pushes
   *    directly and deliberately does NOT go through `commitItem`: no
   *    `spellPlayed`, no `cardPlayed`, no `spellsPlayed:` ledger bump, no
   *    play-discount spend. That is also what makes the loop finite — the
   *    Replicator triggers on a PLAY, so it cannot see its own copy.
   *  · *"you DON'T pay additional cost again and the X value is the one from
   *    original"* — CR 111.5's receipt (`part.costPaid`) and `item.x` are cloned,
   *    never re-collected. CR 710.8a's declared mode (`part.mode`) likewise: the
   *    original said which half it was in its own cast window, in public.
   *
   * `targets`, when given, replaces the FIRST live part's targets — that is
   * the part the copied card's own `spellEffect.targets` spec describes, and
   * the only one a "you may choose new targets" re-collection can be judged
   * against. Every other part (a graft rider) keeps the original's aim.
   *
   * Returns the pushed item, or null if `orig` carries nothing to copy.
   */
  pushSpellCopy(orig: StackItem, opts: { controller?: Seat; targets?: TargetRef[] } = {}): StackItem | null {
    if (!orig.parts.length) return null;
    const copy = structuredClone(orig) as StackItem;
    copy.id = this.s.nextId++;
    copy.copy = true;
    copy.negated = false;
    copy.controller = opts.controller ?? orig.controller;
    copy.label = `${orig.label} (copy)`;
    // A copy comes out of no zone and was not played (CR 108.4), it is nobody's card so it takes
    // no Unstable stamp of its own, it has not been asked to erase
    // itself, and any cost still OWED on the original is the original's to pay
    // — cloning `pendingCosts`/`activationCost` would charge it twice.
    delete copy.from;
    delete copy.unstable;
    delete copy.eraseSelf;
    delete copy.pendingCosts;
    delete copy.activationCost;
    delete copy.paidCosts;
    delete copy.formationSpot;
    // CR 701.5: the as-you-play answers are facts about a PLAY, and a copy is not
    // played. Cloning them would also re-materialise the same copies a second
    // time the moment `makeAsYouPlayCopies` saw them.
    delete copy.asYouPlay;
    // CR 723.4 viruses were applied to the ORIGINAL ITEM as a response — they are
    // mod cards sitting on that item, not part of the spell's declaration, and
    // copying the list would erase them a second time when the copy discharges.
    // (`mods`, the {Modular} CAST cost, IS copied: Caleb 2025-02-07 — they
    // "ride on the stack with the spell and a copy would copy them".)
    delete copy.augments;
    if (opts.targets) {
      const first = copy.parts.findIndex(p => !p.spent);
      if (first !== -1) {
        copy.parts[first]!.targets = opts.targets;
        delete copy.parts[first]!.targetsDone;
      }
    }
    this.dispatchTargeted(copy);
    this.pushItem(copy);
    // ⚠ CT-176 — THE ORIGINAL MAY NOT BE ON THE STACK AT ALL, and this still
    // just pushes. Deployment moving onto the stack (CR 507.5) removed the case this was written for: a DEPLOY-timing
    // play is committed with `'push'` now, so the original really is on a
    // stack and the copy really does sit above it. What is left is the haste
    // step, a spell token cast from play and an activation outside battle —
    // all still `commitItem(…, 'resolve')`, all still resolving where they
    // stand — and for those the copy `E.playedItem` earns has nothing to sit
    // "above". Nothing outside battle and deployment drains a stack, which is
    // what the census below is the tripwire for.
    //
    // A no-stack tail here — pop it back off and resolve it inline, the shape
    // used in `commitItem`'s own no-stack branch — was WRITTEN AND THEN
    // DELETED: removing it reddened nothing, because the only phase that
    // reaches this line without a stack is deployment and deployment drains.
    // The haste step would not drain, and that is why the census in test/138
    // is the tripwire rather than a branch here: the family that can reach
    // this is derived from printed.json (a nonunit spell, playable outside
    // battle, whose target spec can name a unit) and is exactly ['Overbloom'],
    // deploy timing — which has since moved onto a real stack (CR 507.5), so the
    // family that can strand is now EMPTY. Both haste-timing nonunit spells
    // target nothing, and the two haste-step play GRANTS (Dispatch Courier
    // CR 803.2b, Writhing Host CR 504.7) both print "play a UNIT", which is not a
    // nonunit spell. Add a card that breaks any of those and the census fails
    // before anything strands.
    return copy;
  }

  /**
   * CR 706.13 / CT-176 — THE STACK ITEM A PLAY EVENT NAMES.
   *
   * `'spellPlayed'` carries `item`, the id of the play (CR 706.13), so a listener
   * resolving later finds the RIGHT item when two same-card same-seat spells
   * are up at once. That id is the whole answer while there is a stack to look
   * it up on — and `commitItem(…, 'resolve')` never puts one there: a play
   * that resolves where it stands. The id then names nothing, a `.find()`
   * returns undefined, and every card reading it announced that the spell had
   * "already left the stack" for a spell that was never on it.
   *
   * ⚠ DEPLOYMENT MOVING ONTO THE STACK (CR 507.5) EMPTIED THE CASE THIS WAS BUILT FOR. CT-176 found the bug on a
   * DEPLOY-timing play (report #158, Overbloom at an Earthbound Replicator),
   * and deployment now commits with `'push'` — the id names a real item on a
   * real stack, and `offStack` is not taken at all. The fallback stays for
   * what still resolves where it stands: the haste step, a spell token cast
   * in deployment, an activation outside battle. test/138's census is what
   * says whether anything in that set can ever reach a copy effect; today
   * nothing can.
   *
   * So the event carries `offStack`, a snapshot of the item taken at the play,
   * and this is the one place that knows to fall back to it.
   *
   * ⚠ THE FALLBACK IS NOT ON THE STACK, and the two callers differ on what
   * that means:
   *  · **copying** it is fine and is the point — `pushSpellCopy` clones the
   *    declaration, and a declaration is complete the moment it is played.
   *  · **negating** it is not: an effect that has already resolved cannot be
   *    negated, and there is nothing standing there to remove. `'cardPlayed'`
   *    therefore does NOT carry `offStack` at all — Void Mandible's "negate
   *    that effect" is correct to find nothing (CR 706.13) — and any caller that
   *    means to negate must keep using the stack lookup directly.
   *
   * Never mutate what this returns when it came off the event: it is the
   * event's own object, and the event is the log.
   */
  playedItem(ev: EngineEvent | null | undefined): StackItem | undefined {
    const d = ev?.data;
    if (!d) return undefined;
    const id = d['item'];
    if (typeof id === 'number') {
      const live = this.s.stack.find(i => i.id === id);
      if (live) return live;
    }
    const off = d['offStack'];
    return off !== null && typeof off === 'object' ? off as StackItem : undefined;
  }

  /** `moreItems` is the rest of the cast chain this item heads (castChain);
   * when `then` is 'resolve' it rides on any mid-resolution suspension the
   * item raises, so the chain is not lost if the player has to be asked. */
  commitItem(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[] = []): void {
    // CR 722.6a: a graft composite withheld at cost time never reaches the stack
    if (item.withheld) return;
    this.dispatchTargeted(item);
    if (isPlayedSpellKind(item.kind)) {
      // "NONTOKEN spells you've played this battle" — the narrow ledger. Its
      // one reader prints the narrow noun: Animated Spark, "for each nontoken
      // spell you've played in this battle".
      if (this.s.phase === 'battle' && item.kind !== 'spellToken') {
        this.bumpBattleCounter(item.region, `spellsPlayed:${item.controller}`);
      }
      // CR 701.1c: the same ledger for a card that prints plain, unqualified
      // "spell". CR 302.3 — *"Tokens are spells"* — and CR 702.7a — casting a
      // spell token IS playing a spell — so a token cast counts here. Readers:
      // Origon ("their first spell") and The Silent ("each spell their team
      // has previously played", which an earlier reading used to keep off a token and a later ruling
      // put back, now CR 702.7a). Two printed nouns, two counters. Bumped BEFORE fireEvent
      // exactly like its sibling, so a 'spellPlayed' listener asking "is this
      // that seat's Nth spell this battle?" reads the answer straight off the
      // counter (Origon).
      if (this.s.phase === 'battle') {
        this.bumpBattleCounter(item.region, `spellsPlayedAny:${item.controller}`);
      }
      const ev = this.ev('spellPlayed',
        `${this.pname(item.controller)} plays ${item.label}${then === 'push' ? ' → stack' : ''}.`,
        {
          seat: item.controller, card: item.card, token: item.kind === 'spellToken',
          region: item.region,
          // CR 111.11: THE X THAT WAS PAID — "paying X replaces the letter X on
          // the printed card temporarily", so this is the played spell's cost
          // and every "where X is that spell's cost" reads it (Channeled
          // Amalgam, Arcane Concentrator, Death Greeter). It is already final:
          // collectX runs inside collectTargets, which castChain/doDecide run
          // to completion before this line. Absent on a non-X card, where the
          // printed number is the cost.
          //
          // Deliberately on the EVENT and not left to a stack lookup: this
          // event fires before pushItem, and `commitItem(…, 'resolve')` never
          // pushes at all — a deploy-timing X spell (Floral Singularity) is
          // never on the stack for a listener to find.
          ...(item.x !== undefined ? { x: item.x } : {}),
          // CR 410.6: the zone it was played out of ('hand' / 'cache' / 'bin').
          // CR 410.6a: a spell TOKEN is cast from 'play' — not the hand.
          ...(item.from ? { from: item.from } : {}),
          // CR 706.13, 706.9: WHICH ITEM this play is, and WHAT IT WAS AIMED AT as it was
          // played. Same reason as `x` above, and the same two consequences:
          // this event fires BEFORE pushItem, so a `when` cannot look the item
          // up on the stack at all, and `commitItem(…, 'resolve')` never
          // pushes one.
          //
          // "Whenever a player plays a nonunit spell TARGETING ME" is a
          // condition, and CR 109.3a puts a condition at EVENT time. Reading the
          // item's live targets at resolution instead answered a different
          // question — RAQ "[Solved] Earthbound Replicator. No, it's not
          // infinity": *"He must be targeted while playing the spell. If the
          // spell is played and target is changed later to him (through
          // Gravitational Correction or Enigmatic Warder mod), you don't get a
          // copy"*. Both halves were wrong: a retarget ONTO the listener
          // conjured a copy that was never owed, and a retarget AWAY cancelled
          // one that was.
          //
          // `targets` is the flat TargetRef list (every part, every slot) so a
          // listener asks the same question of it that it used to ask of the
          // item; `item` is the id, which is how a resolution-time lookup finds
          // the RIGHT item when two same-card same-seat spells are on the stack
          // at once (identity, not a top-down scan).
          item: item.id,
          targets: item.parts.flatMap(p => p.targets),
          // CT-176: …and when there is going to be no stack, THE ITEM ITSELF.
          // `then === 'resolve'` is the no-stack play — deployment plays now go on a stack, so what is left is the haste step, a spell token
          // cast from play and an activation outside battle — and the id above
          // then names something that never existed anywhere a listener could
          // look. 19 of the pool's 138
          // nonunit spells print deploy or haste timing, and for Earthbound
          // Replicator ("whenever a player plays a nonunit spell targeting me,
          // they copy it") every one of them fired the trigger correctly and
          // then reported "already left the stack — no copy" about a stack it
          // had never been on. Owner report #158, room HTEW [146]: Overbloom,
          // deploy timing, at a Replicator, no copy.
          //
          // Snapshotted HERE, before resolution marks any part spent — the
          // same clone at the same moment `stackFlash` already takes a few
          // lines down, and for the same reason: this is the only instant the
          // item is complete. `E.playedItem` is the one reader; nothing may
          // mutate this copy.
          ...(then === 'resolve' ? { offStack: structuredClone(item) } : {}),
        });
      // CR 111.10k: playing a spell burns the Deferral Drone charge — but the Drone
      // prints "the next CARD you play", and a spell token is not a card
      // (CR 304.2), so a token cast neither takes the discount (manaToPlay) nor
      // spends it here. Casting it is a PLAY (CR 702.7a); that does not make the token
      // a card. Engine-side, so the charge outlives the Drone in both halves
      // (grant AND spend).
      if (item.kind !== 'spellToken') this.spendNextPlayDiscount(item.controller);
      this.fireEvent('spellPlayed', ev);
      // the played spell's OWN "When you play me" (Meteor Shower) — see fireOwnPlayTrigger
      this.fireOwnPlayTrigger(item, ev);
    }
    // CR 108.1a: "when a CARD is played" — the wide event, fired ALONGSIDE
    // 'spellPlayed' rather than replacing it, so every existing listener keeps
    // the exact meaning it has today and nothing above this line changed.
    //
    // Membership is the owner's ruling of 2026-08-24, verbatim: "Everything is
    // a card, including units. Tokens are NOT cards, however." — see
    // CARD_PLAY_KINDS in dsl.ts, which is where the card files can reach it.
    //  · 'unit' / 'spellUnit' / 'spell' / 'ambush' — a card being PLAYED. A
    //    {Battle} unit and an Ambush pushed a stack item with no play event at
    //    all before this, which is the half of Void Mandible's printed noun
    //    that could never fire.
    //  · 'spellToken' is OUT: a token is not a card (CR 304.2). Casting one IS
    //    playing a spell (CR 701.1c) and fires 'spellPlayed' above — but this is
    //    the event for the noun "card".
    //  · 'virus' is OUT: applying a mod is not playing a card (CR 701.2a). It never
    //    reaches commitItem today (doAugment pushes it straight onto the
    //    stack), and naming it there is what keeps that true if it ever does.
    //  · 'triggered' / 'activated' are not plays at all.
    // Signal-only (msg ''): the play already announced itself on 'spellPlayed'
    // or, for a unit, on the 'spawned' line at resolution.
    if (CARD_PLAY_KINDS.has(item.kind)) {
      const ev = this.ev('cardPlayed', '', {
        seat: item.controller, card: item.card, token: false, region: item.region,
        ...(item.x !== undefined ? { x: item.x } : {}),   // CR 111.11: the X that was paid
        ...(item.from ? { from: item.from } : {}),   // CR 410.6: the zone it came out of
        // CR 706.13 / CT-79: WHICH ITEM this play is — the same field
        // `spellPlayed` carries a few lines up, for the same reason and with the same
        // caveats. `cardPlayed` is the WIDE event (CR 108.1a), so it is the only
        // one a card watching for a played UNIT can read; Void Mandible's
        // "negate THAT EFFECT" had no way to name the item and fell back to a
        // (card, controller) scan, which negates the wrong one whenever two
        // same-card same-seat plays are on the stack at once.
        //
        // ⚠ TWO THINGS THE ID DOES NOT PROMISE, both inherited from where this
        // event fires:
        //  · The item is NOT on the stack yet — this fires before `pushItem`
        //    below — so a `when` cannot look it up. Match at RESOLUTION.
        //  · `commitItem(…, 'resolve')` never pushes at all (a deploy-timing
        //    play), so the id can name an item that is never on the stack.
        //    A resolution-time lookup finds nothing, which is correct: there
        //    is no effect standing there to answer.
        // The OTHER `cardPlayed` emitter (the `asPlay` spawn in `spawnUnit`)
        // omits this field entirely — see the comment there.
        item: item.id,
      });
      this.fireEvent('cardPlayed', ev);
    }
    if (then === 'push') {
      this.pushItem(item);
      // CR 710.8: the as-you-play copies go on AFTER the original, so they sit
      // above it and resolve first (RAQ: "above original spell effect").
      this.makeAsYouPlayCopies(item);
      return;
    }
    // CR 710.8, the no-stack branch: this play never reaches the stack at all, so
    // "above the original" can only mean "resolves before it". Each copy is
    // still made through pushSpellCopy — it IS a stack item for as long as it
    // exists, which is what keeps `resolveTop`'s bookkeeping honest — and then
    // taken straight off again, newest first, before the original runs.
    for (let n = this.makeAsYouPlayCopies(item).length; n > 0; n--) {
      const copy = this.s.stack.pop();
      if (!copy) break;
      const co = this.beginResolving(copy);
      this.resolveItem(copy, { then, moreItems: [] });
      this.endResolving(co);
    }
    // Nobody may respond to this one — the haste step, deployment, an
    // activation outside battle, a trigger between combat sub-steps. It goes
    // straight from wherever it was to done, which on screen is no journey at
    // all ("very hard to track"). The client is handed the item as it stood a
    // moment before resolution so it can show it on the stack anyway; see
    // ui/flash.ts. Snapshotted because resolveParts is about to mark parts
    // spent under it. No log line, no listeners: rules-inert.
    this.ev('stackFlash', '', { item: structuredClone(item) });
    const outer = this.beginResolving(item);
    this.resolveItem(item, { then, moreItems });
    this.endResolving(outer);
    this.settle();
  }

  /**
   * CR D6.3: mark `item` as the one currently resolving and hand back whatever was
   * marked before (resolution can nest: an effect that resolves another item
   * inline). Publishing is gated on the BATTLE phase — outside it, resolution
   * runs inside a hidden simultaneous segment (resource step, haste step,
   * deployment) and server/view.ts does not redact this field, so publishing
   * there would tell your opponent you are mid-something while the freeze is
   * meant to hide exactly that.
   */
  private beginResolving(item: StackItem): StackItem | null {
    const outer = this.s.resolving ?? null;
    if (this.s.phase === 'battle') this.s.resolving = item;
    return outer;
  }

  /** CR D6.3: resolution finished (or fizzled, or partially resolved, or the item
   * was never really there) — hand the marker back. Called on EVERY normal
   * exit from resolveItem; a suspension deliberately throws past it, which is
   * the whole point: the item stays marked until it has ACTUALLY resolved. */
  endResolving(outer: StackItem | null): void {
    this.s.resolving = outer;
  }

  resolveTop(): void {
    this.resolveStackAt(this.s.stack.length - 1);
  }

  /**
   * CR 703.7 — resolve the item at `i`, which is the top of SOMEBODY's stack.
   *
   * Everywhere but an isolated deployment that is the top of `s.stack` and
   * this is exactly the old `resolveTop`. In deployment the one array holds
   * two stacks interleaved (one per player, per the owner's ruling) and the
   * seat's own top is not the array's top, so the index is the parameter.
   */
  resolveStackAt(i: number): void {
    this.askSubjects(this.s.stack[i]!);   // CR 706.12: may suspend, rewinding nothing
    const item = this.s.stack.splice(i, 1)[0]!;
    // CR D6.3: it is off the stack — nobody may respond to it or negate it now —
    // but it has not resolved yet, and it says so until it has.
    const outer = this.beginResolving(item);
    this.resolveItem(item);
    this.endResolving(outer);
    this.finishResolutionTail();
  }

  /**
   * CR 110.2, 706.12 — choose what each subject-bearing part of `item` acts on, as
   * the item BEGINS TO RESOLVE: it is the top of its stack, it is about to
   * come off, and nothing of its resolution has happened yet.
   *
   * THE RULING (Discord report, report round 2026-10-16), the owner verbatim:
   * "They don't target which means they can't be fizzled." and "Waiths can
   * fizzle once you're fully out of units, but since they don't target, it's
   * just a raw choice where it gets augmented." Until then (his 2026-08-24
   * ruling, report #101) this choice was made as the item went ONTO the stack
   * and a part whose subject had left by resolution fizzled: three Wraiths and
   * a 1/1 asked three questions up front, the first killed the 1/1 and the
   * other two fizzled. Now each one is asked here, in turn, from the board the
   * previous one left — "fully resolve their effect one at a time".
   *
   * WHY HERE AND NOT A `ctx.choose` INSIDE `run`: see `SubjectSpec`. A question
   * raised here carries no GameState snapshot, so it does not freeze the
   * other seat in deployment (CR 507.5a, CR D2.1c — playtest #98). doDecide's
   * 'subject' branch records the answer on the stack item and calls
   * `resolveStackAt` again, which comes back through here, finds the part
   * answered and goes on.
   *
   * `part.subject !== undefined` is the idempotence guard. Fewer than two
   * candidates is not a question (CR D1.2e): one is recorded, none records
   * `null` and the run announces that it fizzles.
   */
  private askSubjects(item: StackItem): void {
    for (let pi = 0; pi < item.parts.length; pi++) {
      const part = item.parts[pi]!;
      if (part.spent || part.subject !== undefined) continue;
      const def = effectByKey(part.effectKey);
      if (!def.subject) continue;
      const cands = def.subject.candidates(this, item, part);
      if (cands.length < 2) { part.subject = cands.length ? cands[0]!.id : null; continue; }
      this.suspend(
        { type: 'subject', item, partIndex: pi },
        {
          seat: item.controller, kind: 'electricPath',
          prompt: def.subject.prompt(this, item, part),
          options: cands.map(u => ({ label: u.card, value: u.id, card: u.card })),
        },
      );
    }
  }

  /**
   * CR 507.5a — WHICH SEAT'S DEPLOYMENT THIS settle() IS FOR, and only when that
   * distinction is load-bearing: a decision is open, we are in deployment, we
   * know whose action we are running (`E.acting`), and it is not the seat
   * being asked. Null in every other case, which is what keeps the older
   * behaviour byte-identical in battle, in the haste step, at game creation
   * and in every test that pokes `settle()` with no action behind it.
   */
  private deployIsolate(): Seat | null {
    if (this.s.phase !== 'deploy') return null;
    const dec = this.s.decision;
    if (!dec) return null;
    const actor = this.acting;
    if (actor === null || dec.seat === actor) return null;
    return actor;
  }

  /**
   * CR 507.5a — ONE SEAT'S HALF OF A DEPLOYMENT, drained while the other seat's
   * question stands open.
   *
   * The same two steps the shared path runs, scoped to one player:
   *
   *  1. their trigger batch goes onto their stack and is AIMED first (CR 706.3c
   *     — a pile of triggers that never coexists is not a pile), and
   *  2. then their topmost item resolves, one at a time.
   *
   * ONE item, then return, exactly like the shared drain above: `resolveStackAt`
   * ends in `finishResolutionTail`, which settles again and comes straight back
   * here with one fewer item, so a trigger that the resolution itself queues
   * lands on top and resolves before what is left.
   *
   * ⚠ WHAT IS DELIBERATELY NOT DONE HERE. `settleSeenHands()` is skipped: it
   * ends a "revealing moment", and with somebody else's question open we
   * cannot tell whether the moment being ended is theirs. It is idempotent and
   * runs at the next unblocked settle, so nothing is lost but the timing of a
   * UI aid. The other seat's triggers are skipped for the reason they always were (CR D2.1d),
   * which this does not touch — it narrows the SCOPE of the hold from
   * "everyone" to "the seat being asked", and nothing else.
   *
   * ⚠ AND IF THIS SEAT'S OWN WORK RAISES A QUESTION, the suspension overwrites
   * a decision slot that holds exactly one — so `apply()`'s after-gate
   * (`pendingFingerprint`) throws the whole draft away and refuses the action
   * with `disturbs`, and the server's deferral queue lands it once the other
   * seat has answered. That is CR D2.1d's existing contract, not a new failure
   * mode: the same thing already happened when a deployment PLAY needed a
   * target while the other seat was being asked something.
   */
  private settleDeploySeat(seat: Seat): void {
    if (this.s.triggerQueue.some(t => t.controller === seat)) {
      this.processTriggerQueue(seat);
    }
    // their top = the LAST item in the array they control; the other seat's
    // items may be interleaved above and below it and are not theirs to touch
    for (let i = this.s.stack.length - 1; i >= 0; i--) {
      if (this.s.stack[i]!.controller === seat) { this.resolveStackAt(i); return; }
    }
  }

  /** post-resolution: settle, then restart the window from the initiative
   * player — unless settle() pushed new triggered items (pushItem already
   * handed priority to the responder) */
  finishResolutionTail(): void {
    const lenBase = this.s.stack.length;
    this.settle();
    if (this.s.phase === 'battle' && this.s.priority !== null && this.s.stack.length === lenBase) {
      this.s.priority = this.s.initiative;
      this.s.passes = 0;
    }
  }

  /**
   * CR 704.4: there is no `item.negated` branch here any more. A negated item is
   * off the stack and binned before this can ever see it, so the branch was
   * unreachable from both of resolveItem's callers — `resolveTop()` pops from
   * a stack that no longer holds negated items, and `commitItem(…, 'resolve')`
   * hands over an item freshly built with `negated: false` that was never on
   * the stack for anyone to answer.
   */
  resolveItem(item: StackItem, chain?: ChainRest): void {
    if (item.kind === 'unit') {
      // CR 602.7: `formationSpot` is where this card was PLAYED — chosen at cast
      // (collectFormationSpot), taken here, atomically with the spawn.
      this.spawnUnit(item.controller, item.card!, item.region, {
        ...(item.from ? { from: item.from } : {}),
        ...(item.formationSpot ? { spot: item.formationSpot } : {}),
      });
      return;
    }
    if (item.kind === 'virus') {
      // CR 723.4: a virus aimed at a SPELL ON THE STACK. Its host is legal exactly
      // while it is still ON the stack: negated out from under it (CR 704.4) or
      // recalled, and the virus fizzles to the bin — Manual p.34, "If a virus
      // is negated or its target becomes invalid, it is placed into the bin,
      // and cannot be used as a virus again".
      //
      // CR 803.8k — ⚠ both fizzle branches used to call `toBin(…, 'stack')` RAW,
      // which made them a third computation of "is this Unstable?" that simply
      // said no. They go through `dischargeItem` now, exactly as `negate()`
      // does, so the three stack exits share one predicate and one erase.
      // dischargeItem is the right choke rather than a smaller helper because
      // it already owns the whole disposition — the CR 407.1 per-owner erased pile,
      // the CR 723.4b virus split, the eraseSelf branch, and `disposeItemMods` — and
      // a fizzling item is entitled to every one of them (a {Modular} virus
      // that fizzled used to strand its mods nowhere). Everything below the
      // predicate is unchanged for the ordinary case: a plain virus item
      // carries no augments, no stamp and no mods, so dischargeItem does
      // precisely the `toBin(…, 'stack')` that was written here. The log line
      // stays HERE, ahead of the call, for the same reason negate()'s does:
      // the fizzle has to name its own destination or it says "→ bin" about a
      // card that is about to be erased.
      // ⚠ Manual p.34 is NOT overridden: an ordinary virus still fizzles to
      // the bin. Only a virus that is ITSELF {Unstable} — the two printed ones
      // (Aberrant Statweaver, Oorblak, both {Virus} {Unstable}) — is erased,
      // because the stack is an active zone (Bena 2026-08-25).
      const fizzle = (why: string): void => {
        const erased = this.itemIsUnstable(item);
        this.ev('fizzled', `${item.label} fizzles (${why}) → ${erased ? 'erased (Unstable)' : 'bin'}.`,
          { id: item.id });
        this.dischargeItem(item, true);   // CR 801.2b: from the stack, no trash either way
      };
      if (item.hostStack !== undefined) {
        const target = this.s.stack.find(it => it.id === item.hostStack);
        if (!target) {
          fizzle('its host has left the stack');
          return;
        }
        this.augmentStackItem(target, item.card!, item.controller);
        return;
      }
      const host = item.hostId !== undefined ? this.entity(item.hostId) : undefined;
      if (!host) {
        fizzle('host is gone');
        return;
      }
      this.attachMod(host, item.card!, item.controller, 'augment');
      return;
    }
    // spell / spellUnit / spellToken / triggered / activated: run live parts
    //
    // CR 704.5, 704.5a (CT-208): judge every declared target against its slot ONCE, now,
    // as the item begins to resolve.
    this.markIllegalTargets(item);
    //
    // CR 704.6, 704.6a, playtest report #71 (game GETD, 2026-08-22): an item fizzles when it
    // DECLARED targets and has lost every one of them — and when it does, the
    // UNTARGETED parts of the same item die with it. The ruling is Caleb's, in
    // the RAQ thread "[Solved] When does effect fizzles?":
    //
    //   Q: "For effects like Channel Through or big Grafts with multiple
    //      targets (and additional buff or card draws), when do they fizzle?"
    //   A: "If effect loses ALL of its targets and wants to resolve."
    //
    // and the worked example is the whole point — a Bellowing Boulder graft
    // composite that has lost both of its declared targets fizzles "(yielding
    // no card draw from 2nd and 3rd graft)". The card draws were never
    // targeted; they die anyway, because the ITEM is one effect and one effect
    // fizzles as a unit. Restated later in the same thread: "currently at least
    // 1 target must remain for whole effect to be carried out" and "in order
    // for effect to fail you need to invalidate ALL targets".
    //
    // The old shape asked each part "are you still alive?" and let an
    // UNTARGETED part answer `true`, which meant a composite holding any
    // untargeted part could never fizzle however dead its targets were. That
    // is exactly what GETD showed: a Spewing Mushroom trigger carrying four
    // grafts declared one target (itself), lost it to a Poison 8, and still
    // paid out four Poison tokens and a board-wide buff before its one
    // targeted graft reported "a part fizzles (target gone)".
    //
    // The change is one word wide and it is the `return true` below: an
    // UNTARGETED part no longer votes to keep the item alive. It still
    // RESOLVES — it is only barred from being the reason the item survives.
    // Whether the item is targeted AT ALL is then asked separately, of the
    // whole item, so that a composite with no targeting anywhere (a plain
    // trigger, "create a Poison X") can never fizzle: it has nothing to lose.
    const partAlive = (part: EffectPart): boolean => {
      if (part.spent) return false;
      const def = effectByKey(part.effectKey);
      if (!def.targets) return false;   // CR 704.6d: untargeted parts do not vote
      // "UP TO one target …" (min 0): declaring no target is a legal choice, so
      // the part still resolves — anything printed alongside the optional
      // target ("Recall up to one target cached card. You gain 3 life.") must
      // happen. A min-1 spec with nothing declared is the real fizzle: it is
      // the part collectTargets already reported as "there is no legal target
      // for that — it does nothing", and an item made only of those is an
      // effect that wanted a target and never had one.
      if (!part.targets.length) return this.requiredTargetsOf(item, part, def.targets) === 0;
      return part.targets.some((t, ti) => !part.invalid?.includes(ti) && this.targetStillLegal(t));
    };
    const targeted = item.parts.some(p => !p.spent && !!effectByKey(p.effectKey).targets);
    if (targeted && !item.parts.some(partAlive)) {
      // CR D7.3d's precedent: a no-op ANNOUNCES. An effect that vanished
      // silently because its target died under it is indistinguishable from a
      // bug at the table, which is the whole reason this line is not a `return`.
      const anyIllegal = item.parts.some(p => p.invalid?.length);
      this.ev('fizzled',
        (anyIllegal
          ? `${item.label} fizzles — its targets are gone or not legal any more.`
          : `${item.label} fizzles — all targets are gone.`),
        { id: item.id });
      /**
       * CR 109.9a / CARD-TODO #20: a fizzle SPENDS the bounded budget. It does NOT
       * refund it, and the previous bounded-use answer here was wrong.
       *
       * RULED (designer, 2026-08-23), asked about `[bounded_graft]`: *"can only
       * be activated or triggered once per turn. REGARDLESS OF IF THAT ABILITY
       * RESOLVES OR DOESN'T."* A fizzled item was triggered — it went on the
       * stack and then lost its targets — so the use is gone. The earlier
       * reading ("a fizzle is the ability doing nothing, like a decline") is
       * the one that sentence rules out by name.
       *
       * THE LINE CR 109.9b DRAWS, and the reason this branch is on the far side of
       * it: a bounded use survives only where the player was OFFERED the
       * ability and did not take it up (or could not be offered it at all).
       * Once it is on the stack it has been used, and what happens afterwards —
       * fizzling, whiffing, being negated — cannot hand it back. Removing a
       * target in response is therefore a real answer to a bounded trigger,
       * which is the whole point of doing it.
       */
      // a fizzled spell unit never spawns; a fizzled ambusher is binned too
      // ("you could find yourself losing both units" — Manual p.40).
      // CR 801.2b: still the stack, so still not a trash. CR 723.4b: a fizzled carrier is
      // still a modded card leaving the stack, so Unstable still replaces the
      // bin with an erase — the virus was applied and is spent either way.
      this.dischargeItem(item,
        item.kind === 'spell' || item.kind === 'spellUnit' || item.kind === 'ambush');
      return;
    }
    // Playtest 2026-08-22: this line is a HEADING for the effects printed
    // under it, not a statement that resolution finished — and it is emitted
    // BEFORE resolveParts, which can suspend for as long as the controller
    // takes to answer. "X resolves." asserted completion while the table
    // showed "Bob is resolving — X", so the log contradicted the board. The
    // present progressive is true at 0ms and at a minute; the effects beneath
    // it remain the evidence that it actually finished.
    this.ev('resolved', `Resolving ${item.label}:`, { id: item.id });
    this.resolveParts(item, 0, {}, 0, chain);
    this.afterParts(item);
  }

  /**
   * The `ctx.choose` of the part currently resolving, or null outside one.
   *
   * ENGINE-side helpers that must raise a mid-resolution decision (E.glimpse's
   * CR 801.9a "cache one of these N") would otherwise have to take an EffectCtx, and
   * every one of the eleven glimpse callers would have to be edited to pass it.
   * This is the seam instead: resolveParts publishes the live choose for the
   * duration of one `def.run`, keyed per call so a helper invoked twice in one
   * part asks two distinct questions. (Per-part namespacing lives in
   * ctx.choose itself, so card-code keys and helper keys alike can never
   * collide across parts.) Both counters are rebuilt from scratch on a
   * suspension replay, so the keys are deterministic.
   *
   * Not part of GameState: it lives only inside a synchronous `def.run`, and a
   * suspension rolls the state back and replays the part from its start.
   */
  private partChoose: ((tag: string, dec: PartChoice['dec']) => unknown) | null = null;

  /**
   * CR 708.8b: the controller of the part currently resolving, or null outside one
   * — `partChoose`'s sibling, published and restored on the same two lines.
   *
   * "When YOU put a counter on an enemy" needs the seat that put it, and every
   * counter a CARD places is placed by a resolving effect whose controller is
   * already on the item. Publishing it here is what let `addCounters` take an
   * optional `by` without editing the 52 card call sites to pass a seat each
   * of them already sits inside — and, like partChoose, it lives only for the
   * duration of one `def.run`, never in GameState, so a suspension replay
   * rebuilds it.
   *
   * Nested resolution (a part that resolves another item inline) saves and
   * restores, so the inner item's controller is the actor while it runs.
   */
  private partActor: Seat | null = null;

  /** CR 704.7a: the item whose part is resolving right now — `partActor`'s sibling,
   * published on the same lines, so a source's last-known state can be read
   * off the item that carries it while its effect runs. */
  private partItem: StackItem | null = null;

  /**
   * CR 714.1 (CT-209) — TAKE A UNIT'S LAST-KNOWN STATE AS IT LEAVES PLAY.
   *
   * Called at every place a unit leaves `s.entities`, BEFORE it leaves the
   * grid and before its face is turned back, so the snapshot has the column it
   * shared attributes with and the face it was showing. Written onto every
   * stack item and waiting trigger it is the source of (and the one resolving,
   * if it dies under its own effect); nothing else carries it, so a game in
   * which no source dies under its own trigger is unchanged.
   *
   * A trigger queued AFTER its source left (a "when I die" trigger) gets no
   * snapshot: no card in the pool reads its source's state from one, and the
   * day one does it needs the stamp carried to `queueTrigger`.
   */
  private stampLastKnown(u: Entity): void {
    if (u.kind !== 'unit') return;
    const [power, defense] = this.effStats(u);
    const lk: LastKnown = {
      id: u.id, card: u.card, face: this.nameOf(u), controller: u.controller, region: u.region,
      attrs: [...this.effAttrs(u)], power, defense, formationSeat: this.formationSeatOf(u.id),
    };
    for (const it of this.s.stack) if (it.sourceId === u.id && !it.lastKnown) it.lastKnown = lk;
    for (const t of this.s.triggerQueue) if (t.sourceId === u.id && !t.lastKnown) t.lastKnown = lk;
    if (this.partItem?.sourceId === u.id && !this.partItem.lastKnown) this.partItem.lastKnown = lk;
  }

  /**
   * CR 704.7a: what an effect knows of its source `id` once that source has left
   * play — the snapshot on the item resolving now, else on any item or
   * waiting trigger that carries one. Undefined while the unit is in play (read
   * the live entity) and for an id nothing remembers.
   */
  lastKnownOf(id: EntityId | undefined): LastKnown | undefined {
    if (id === undefined || this.entity(id)) return undefined;
    if (this.partItem?.sourceId === id && this.partItem.lastKnown) return this.partItem.lastKnown;
    return this.s.stack.find(i => i.sourceId === id && i.lastKnown)?.lastKnown
      ?? this.s.triggerQueue.find(t => t.sourceId === id && t.lastKnown)?.lastKnown;
  }

  /**
   * Run parts [from..]; the composite is ONE ability resolving top-to-bottom.
   * A suspending part is replayed from its own boundary with `answers` filled
   * in — CR D6.3b: the world is rolled back to that boundary on RESUME
   * (E.resumeResolve), not at the suspension, so the half-finished resolution
   * is what the table gets to look at while somebody is being asked something.
   *
   * `shownEvents` is the resume rollback's other half, and applies to part `from` only: that
   * many events of this part are already on everyone's screen, so the replay's
   * re-emission of them is dropped instead of doubling the log.
   *
   * `chain` is the rest of the cast chain this item heads, if any: it is put
   * on the 'resolve' suspension so doDecide can run it once the item finishes.
   */
  resolveParts(item: StackItem, from: number, answers: Record<string, unknown>, shownEvents = 0,
    chain?: ChainRest): void {
    for (let pi = from; pi < item.parts.length; pi++) {
      const part = item.parts[pi]!;
      if (part.spent) continue;
      const def = effectByKey(part.effectKey);
      // CR 704.5: a slot judged illegal when resolution began is lost like a
      // target that left play
      const resolved = part.targets
        .filter((_, ti) => !part.invalid?.includes(ti))
        .map(t => this.resolveTargetRef(t))
        .filter((t): t is ResolvedTarget => t !== null);
      if (def.targets && part.targets.length && !resolved.length) {
        this.ev('info', part.invalid?.length
          ? `${item.label}: a part fizzles (its target is not legal any more).`
          : `${item.label}: a part fizzles (target gone).`);
        continue;                                       // CR 704.6b: partial resolution
      }
      // never had a target — but "up to one" (min 0) still runs, with an empty
      // ctx.targets, so its unconditional half happens
      if (def.targets && !part.targets.length && this.requiredTargetsOf(item, part, def.targets) > 0) continue;
      const ctx: EffectCtx = {
        controller: item.controller,
        sourceName: item.card ?? item.label,
        sourceId: item.sourceId,
        // CR 720.6d: the mod entity whose donated text this is, if any — the only
        // handle "my OTHER Augments" has on the one augment that is itself.
        ...(item.selfModId !== undefined ? { selfModId: item.selfModId } : {}),
        region: item.region,
        targets: resolved,
        // CR 702.6b: a VARIABLE cast cost defines this part's X (Discharge's "remove
        // X counters … deal X damage"). It wins over the item-wide mana X so a
        // grafted rider that paid its own cost cannot read its carrier's.
        x: part.costPaid?.x ?? item.x,
        costPaid: part.costPaid,
        // CR 702.5: the modal half, declared in the cast window by collectModes and
        // visible on the stack for the whole response window. The effect reads
        // it; it never asks.
        ...(part.mode !== undefined ? { mode: part.mode } : {}),
        // CR 706.12: what this untargeted effect acts on, chosen by askSubjects as
        // the item began to resolve. Looked up live; a choice whose entity has
        // since left play is handed over as `undefined` (choose again, now),
        // never as a corpse and never as a fizzle.
        ...(def.subject && part.subject !== undefined
          ? (part.subject === null ? { subject: null }
            : this.entity(part.subject) ? { subject: this.entity(part.subject)! } : {})
          : {}),
        ...(part.mods ? { mods: part.mods } : {}),
        // CR 721.4b's virus grants UNIONED with CR 724.4a's {Modular}-mod grants and
        // the continuous ones. All three are "attributes this effect has
        // that its card did not print", all three land in the one field
        // everything downstream already reads, and the union must stay INSIDE
        // the per-part loop: CR 707.8's answer is per-part (Envoy of Lightning
        // counts THIS part's declared targets), while CR 721.4b's and CR 724.4a's are
        // per-item.
        // #188: assembled by `stackItemGrants`, which the board's stack chips
        // also read (`stackItemAttrs`), so what a spell shows and what it
        // resolves with are one computation.
        ...(() => {
          const granted = this.stackItemGrants(item, part);
          return granted.length ? { grantedAttrs: granted } : {};
        })(),
        // "Erase me." — raise the flag ON THE ITEM (see StackItem.eraseSelf).
        // It has to be state and not a closure variable because a part can
        // suspend mid-resolution and be replayed out of the serialised
        // suspension; `item` is what the suspension carries, so the
        // answer survives the round trip. `dischargeItem` reads it afterwards.
        eraseSelf: () => { item.eraseSelf = true; },
        // CR 303.10: "…gains control of me" on a SPELL UNIT — the body has not been
        // spawned yet (afterParts does that once every part has run), so this
        // says who it ENTERS under rather than moving it afterwards. Same
        // on-the-item shape as eraseSelf above, same reason.
        spawnUnder: (seat: Seat) => { item.spawnUnder = seat; },
        // CR 303.11: "I become an exact copy of that unit." on a SPELL UNIT — the
        // same seam one question over (spawnUnder says whose the body is,
        // this says what it is), and on the item for the same reason.
        spawnWearing: (face: SpawnFace) => { item.spawnWearing = face; },
        // CARD-TODO #18: "I did nothing — give the [once] back." The same
        // shape as eraseSelf directly above, and for the same reason: the
        // flag lives on the PART (which the suspension carries), not in this
        // closure, and it is paid out by settleBudgetRefund once the part has
        // actually finished — never mid-run, because the reservation made at
        // composition time is also the re-entrancy guard.
        refundBudget: () => { part.refunded = true; },
        event: item.event ?? null,
        choose: (key, dec) => {
          // namespaced per part: card code uses fixed keys (`sac:${seat}`),
          // and a composite can hold the SAME effect twice (a General Smof
          // grafted onto a General Smof). Without the prefix, part 2 finds
          // part 1's answer already in the shared map and silently reuses a
          // pick that may be dead instead of asking again.
          const k = `${pi}:${key}`;
          if (k in answers) return answers[k];
          throw new PartChoice(k, { ...dec, options: dec.options });
        },
      };
      // CR 802.23c, 802.21b: snapshot the units in play, so the kills this part makes —
      // by damage, by -1/-1 counters, by a stat swap, by anything — can be
      // diffed out once it has finished and every KILL-scoped rider the source
      // carries can be paid off that one diff. Discarded on a suspension
      // rollback and retaken when the part replays.
      const killAttrs = this.itemAttrs(item);
      const beforeUnits = this.wantsKillDiff(killAttrs) ? this.snapshotUnits() : null;
      // published on the engine for the duration of the part, so the
      // damage site knows the diff will pay and stands down (see
      // `dealEffectDamageAll`). Saved and restored because resolution nests.
      const outerKillWatch = this.killWatch;
      this.killWatch = beforeUnits
        ? { before: beforeUnits, reaps: killAttrs.has('Reaping') }
        : null;
      // CR D6.3b: the rollback state, carried ON the suspension and applied when
      // the answer comes back rather than here.
      const snap = structuredClone(this.s);
      const evLen = this.events.length;
      // events of THIS part the table has already been shown (a replay of a
      // part that has suspended before); the re-emission is dropped below.
      const shown = pi === from ? shownEvents : 0;
      const outerChoose = this.partChoose;
      const outerActor = this.partActor;                  // CR 708.8b
      this.partActor = item.controller;
      const outerItem = this.partItem;                    // CR 704.7a
      this.partItem = item;
      let helperSeq = 0;
      // ctx.choose already namespaces by part index; the seq keeps a helper
      // invoked twice in one part asking two distinct questions
      this.partChoose = (tag, dec) => ctx.choose(`${tag}#${helperSeq++}`, dec);
      // CR 708.9: ONE RESOLVING PART IS ONE TOKEN-CREATION BATCH — the same unit
      // effect damage is dealt in, CR 112.8 ("One resolution of one effect, one batch").
      // Biotoxicity's three Poisons are one creation, so "an additional copy of
      // each UNIQUE token you created" has one creation to be unique across
      // (report #60), and Cosmic Conspirator is asked once per token inside it
      // (report #64).
      //
      // Settled INSIDE the try, right after the part finishes, so that a
      // decision raised by a batch replacement suspends and replays through
      // exactly the machinery every other mid-resolution question uses. A part
      // that suspends before finishing leaves its batch unsettled on purpose:
      // the resume rolls the world back to the part boundary and replays it, and a
      // batch settled at the suspension would be paid out twice.
      const outerBatch = this.tokenBatch;
      this.tokenBatch = [];
      try {
        def.run(this, ctx);
        const batch = this.tokenBatch;
        this.tokenBatch = null;
        if (batch?.length) this.settleTokenBatch(batch);
      } catch (sig) {
        if (sig instanceof PartChoice) {
          // Everything this part has emitted so far, INCLUDING the prefix it
          // just re-emitted: that total is what the table will have seen once
          // this suspension is published, so it is what the next replay must
          // suppress.
          const emitted = this.events.length - evLen;
          this.events.splice(evLen, Math.min(shown, emitted));
          // `s.resolving` and the suspension's `item` must be ONE object,
          // so that structuredClone at the apply() boundary memoises them
          // together and a replay can never drift the marker and the
          // suspension apart.
          //
          // Assigned, never merely re-pointed, because THIS item is the one
          // that is suspending. Resolution can nest (a part that ends the
          // battle lets settle() resolve a start-of-deployment trigger inline),
          // and the throw abandons the outer resolution entirely — leaving the
          // outer item marked would strand it. The phase gate is re-applied for
          // the same reason: the fuzzer found a Wraith's startOfDeployment
          // trigger suspending under a battle resolution, which published a
          // marker in the deploy phase (seed 693).
          this.s.resolving = this.s.phase === 'battle' ? item : null;
          this.suspend(
            {
              type: 'resolve', item, partIndex: pi, answers, pendingKey: sig.key,
              snapshot: snap, shown: emitted,
              ...(chain ? { then: chain.then, moreItems: chain.moreItems } : {}),
            },
            {
              seat: sig.dec.seat, kind: sig.dec.kind, prompt: sig.dec.prompt, options: sig.dec.options,
              // BL-25/CR D7.2: an effect that removes counters says its own
              // ceiling here — the quantity stepper is not a cost-only thing.
              ...(sig.dec.counterMax !== undefined ? { counterMax: sig.dec.counterMax } : {}),
              // CR D7.2a: a `kind: 'number'` question carries its whole range here
              // — `options` is empty and `choice` is the value itself.
              ...(sig.dec.numeric !== undefined ? { numeric: sig.dec.numeric } : {}),
              // the picker hint (Wake the Dead, Tides): display only
              ...(sig.dec.pickSet !== undefined ? { pickSet: sig.dec.pickSet } : {}),
            },
          );
        }
        throw sig;
      } finally {
        this.partChoose = outerChoose;
        this.partActor = outerActor;                      // CR 708.8b
        this.partItem = outerItem;                        // CR 704.7a
        this.tokenBatch = outerBatch;
        this.killWatch = outerKillWatch;                  // CR 802.21b
      }
      // the part finished: the same suppression, for the last replay of it
      if (shown) this.events.splice(evLen, Math.min(shown, this.events.length - evLen));
      // CARD-TODO #18: …and only now, once it really has finished, is a
      // refused [once] handed back. A suspension throws past this line, so a
      // part that is still being answered keeps its reservation.
      this.settleBudgetRefund(item, part);
      this.checkDeaths();   // sequential within the composite; triggers wait for settle()
      // CR 802.21b: one diff, every kill-scoped rider the source carries.
      if (beforeUnits) {
        this.killRiders(beforeUnits, killAttrs, item.card ?? item.label, item.controller);
      }
    }
  }

  /**
   * CARD-TODO #18: pay back the `[once]` a finished part refused to spend.
   *
   * THE RULING (designer, 2026-08-23; now CR 109.9a): a bounded
   * ability "can only be activated or triggered once per turn, REGARDLESS OF
   * IF THAT ABILITY RESOLVES OR DOESN'T" — and, for Hexbane Shiitake's [once],
   * "you can choose for each spell if you want to let it trigger and to put
   * the ability on the stack." So the use is spent the moment the ability is
   * activated or put on the stack, and the ONLY thing that keeps it is the
   * player declining the ability, or no offer being possible at all.
   *
   * WHAT THIS IS NOT, and the reason to read it twice: it is not "the ability
   * did nothing". That was the decline ruling's first reading, and the designer's 2026-08-23 ruling (CR 109.9a) reverses it. A run
   * that was used and found nothing to do — an activated ability with no legal
   * subject, a targeted trigger whose target left, a fizzle — spends the use.
   * Six such calls were deleted from the card pool when the spent-on-use ruling landed; do not
   * add them back. The test of a branch is "was there a yes/no about the
   * ability itself, and was the answer no?", not "did anything happen?".
   *
   * THE SEAM IS EXPLICIT, ON PURPOSE. The obvious implementation — refund a
   * run that emitted no events — cannot work any more: CARD-TODO #3's sweep
   * gave every bail-out branch in the pool an announcement, which was the
   * entire point of it, so all 88 of them look busy. A run therefore has to
   * SAY it did nothing (`ctx.refundBudget()`), and the branches that say it are
   * the ones `test/85-silent-branches.test.ts` already found and annotated.
   *
   * WHERE THE BUDGET LIVES, which is the only real bookkeeping here:
   *
   *  · a GRAFTED rider's `[Switch1]` — `part.fromMod` names the mod entity and
   *    the key is the bare string 'graft' (see composeParts).
   *  · everything else — the budget is on the SOURCE entity under a key that
   *    is character-for-character the part's own `effectKey`
   *    (`${prefix}:${card}#${index}`, written by composeParts). The two are
   *    the same string by construction, which is what lets a part identify its
   *    own reservation without carrying a second copy of the key.
   *
   * A {Modular} graft riding a SPELL (`item.parts.push({ effectKey: 'graft:…' })`)
   * has no `fromMod` and no source entity, so it reserves nothing and
   * this is correctly a no-op: that mod was paid as a cast cost, not budgeted.
   *
   * IDEMPOTENT in both directions. Zeroing an already-zero budget is the same
   * as zeroing it once; and because the flag is raised inside the run while
   * the resume rolls a suspended part back to its boundary, a replay that reaches a
   * DIFFERENT branch the second time arrives here with no flag at all and the
   * reservation stands.
   */
  private settleBudgetRefund(item: StackItem, part: EffectPart): void {
    if (part.refunded !== true) return;
    this.refundPart(item, part);
  }

  /**
   * CARD-TODO #18: hand `part`'s bounded reservation back, unconditionally.
   *
   * The half of `settleBudgetRefund` that does the work, split out so the
   * CAST-TIME routes can reach it too. CR 109.9a: the fizzle branch of `resolveItem`
   * used to call this as well — it does not any more, and must not again. A cast [cost] that is DECLINED or
   * UNPAYABLE marks its part `spent` before the run exists (the engine offers the decline; CR 111.15
   * says a grafted cost cannot be declined, and CR 724.4c skips an unpayable Modular graft part), so that part
   * can never call `ctx.refundBudget()` — and "the [cost] is declined" is the
   * most reachable decline in the pool, because a bounded [Switch1] rider is
   * usually met as a graft on somebody else's composite.
   */
  private refundPart(item: StackItem, part: EffectPart): void {
    part.refunded = true;
    // CR 109.9m: a zone-dispatched part's reservation lives in GameState.zoneBudgets
    // (its stand-in source, id -1, is not in s.entities and is long gone) —
    // hand it back there, so CR 109.9b holds from a bin exactly as it does in play.
    if (part.fromMod === undefined && item.sourceId === -1) {
      const zb = this.s.zoneBudgets;
      const zoneKey = `${item.controller}:${part.effectKey}`;
      if (!zb || (zb[zoneKey] ?? 0) <= 0) return;
      delete zb[zoneKey];
      this.ev('info',
        `${item.label}: it did nothing, so its use is not spent — it can fire again this turn.`,
        { budget: part.effectKey, refunded: true });
      return;
    }
    const holder = part.fromMod !== undefined
      ? this.entity(part.fromMod)
      : (item.sourceId !== undefined ? this.entity(item.sourceId) : undefined);
    if (!holder) return;                       // the carrier is gone: nothing to refund onto
    const key = part.fromMod !== undefined ? 'graft' : part.effectKey;
    if ((holder.budgets[key] ?? 0) <= 0) return;   // not bounded, or already back
    delete holder.budgets[key];
    this.ev('info',
      `${item.label}: it did nothing, so its use is not spent — it can fire again this turn.`,
      { unit: holder.id, budget: key, refunded: true });
  }

  /**
   * CR 802.1, 712.8a: the attributes an effect's SOURCE lends the effect — the source
   * unit's live attributes (column-shared, CR 712.8a) while it is in play, else the
   * printed card's. `dealEffectDamageAll` reads it; so does `stackItemAttrs`.
   */
  private effectSourceAttrs(sourceId: EntityId | undefined, sourceName: CardName): Set<string> {
    const src = sourceId !== undefined ? this.entity(sourceId) : undefined;
    if (src) return new Set(this.effAttrs(src));
    // CR 714.2: a source that left play lends what it had as it left — Bellowing
    // Boulder's ping stays Deadly from the column it was standing in
    const lk = this.lastKnownOf(sourceId);
    return new Set(lk ? lk.attrs : this.card(sourceName)?.attrs ?? []);
  }

  /**
   * CR 721.4b, 724.4a, 707.8: the attributes ONE PART of a stack item is granted on
   * top of its source's — a virus's (CR 721.4b) and a {Modular} mod's (CR 724.4a)
   * type-line attributes, per item, and the continuous `effectAttrs` grants
   * (Emberflame Enlightener's {Powerful}, Envoy of Lightning's {Electric}),
   * per part. resolveParts hands exactly this to the part as
   * `ctx.grantedAttrs`; nothing else assembles it.
   */
  stackItemGrants(item: StackItem, part: EffectPart): Attr[] {
    return [
      ...(item.augments?.length ? this.stackAugmentAttrs(item) : []),
      // CR 724.4a: a mod applied through the {Modular} window donates its
      // type-line [Augment] attributes exactly as a virus does. Without
      // this line the widened offer would donate nothing and the fix
      // would look done while changing nothing.
      ...(item.mods?.length ? this.stackModAttrs(item) : []),
      ...this.effectAttrsFor({
        seat: item.controller,
        region: item.region,
        kind: item.kind,
        ...(item.card ? { card: this.card(item.card) } : {}),
        // DECLARED, not surviving: `part.targets` is the cast-time list,
        // while resolveParts has already dropped the dead refs. RAQ
        // "[Solved] Envoy of Lightning vs Twin Flame.": a two-target Twin
        // Flame that lost one target is NOT Electric — "it still has 2
        // targets, but one of them is invalid".
        targets: part.targets.length,
      }),
    ];
  }

  /**
   * #188 (owner, room UVYZ): "The Fireballs on the stack don't actually say
   * 'Powerful' like the units do." What a stack item would resolve with if it
   * resolved NOW: its source's attributes by the rule effect damage reads
   * them (`effectSourceAttrs`) plus what each part is granted
   * (`stackItemGrants`) — the same two calls resolution makes, so the chips
   * on the strip cannot disagree with the damage.
   *
   * Pass `part` for one part's answer. Without it, the UNION over the parts
   * still to run: a grant is per part (Envoy of Lightning counts one part's
   * declared targets), and a chip on the card says "some of this is Electric".
   * A pure query; a label-only item whose source has gone and whose name is
   * no card answers its grants alone, where resolution would read nothing
   * more either.
   */
  stackItemAttrs(item: StackItem, part?: EffectPart): Set<string> {
    let out: Set<string>;
    try { out = this.effectSourceAttrs(item.sourceId, item.card ?? item.label); } catch { out = new Set(); }
    const live = item.parts.filter(p => !p.spent);
    for (const p of part ? [part] : live.length ? live : item.parts) {
      for (const a of this.stackItemGrants(item, p)) out.add(a);
    }
    return out;
  }

  /** The attributes of a stack item's SOURCE: the source entity's live attrs
   * while it is still in play (so granted ones count), otherwise the printed
   * card's. Used by the resolution-time attribute checks ({Afflicting}). */
  itemAttrs(item: StackItem): Set<string> {
    const src = item.sourceId !== undefined ? this.entity(item.sourceId) : undefined;
    const set = src ? this.ownAttrs(src)
      : new Set<string>(item.lastKnown?.attrs ?? (item.card ? this.card(item.card).attrs : []));   // CR 714.2
    for (const a of this.stackAugmentAttrs(item)) set.add(a);   // CR 723.4
    for (const a of this.stackModAttrs(item)) set.add(a);       // CR 724.4a
    return set;
  }

  /**
   * CR 723.4: the attributes a VIRUS augmented onto this stack item donates to it.
   *
   * Type-line `[Augment]` attributes only, exactly as `ownAttrs` reads them off
   * a unit's augment mods — Caleb 2025-04-06: augmenting a virus onto a spell
   * "notably only works with attributes", and 2025-04-24: "spells cannot gain
   * static abilities like that, so the only useful thing you can do is give
   * them attributes". A virus whose whole payload is text (Graxxlid, Skybreaker)
   * may still legally be applied; it simply donates nothing.
   */
  stackAugmentAttrs(item: StackItem): Attr[] {
    const out: Attr[] = [];
    for (const a of item.augments ?? []) out.push(...this.card(a.card).augmentAttrs);
    return out;
  }

  /**
   * CR 724.4a: the attributes a {Modular} MOD donates to the card it was applied to.
   *
   * The same channel as `stackAugmentAttrs` above, by a different timing — a
   * mod paid as a cast cost rather than a virus applied as a response — and
   * deliberately the same rule, because it is the same act: a mod is on a
   * spell, and "the only useful thing you can do is give them attributes"
   * (Caleb 2025-04-24). A separate method, not a widened `stackAugmentAttrs`,
   * so CR 723.4's virus channel keeps meaning exactly what its name says.
   *
   * This is the half that makes the owner's ruling mean something. Graftable
   * cards and type-line-attribute cards are DISJOINT in the pool (137 and 22,
   * overlap zero, measured 2026-08-23), so before this existed attribute
   * donation through {Modular} was not rare — it was impossible.
   */
  stackModAttrs(item: StackItem): Attr[] {
    const out: Attr[] = [];
    for (const m of item.mods ?? []) out.push(...this.card(m.card).augmentAttrs);
    return out;
  }

  /** CR 723.4: attach a virus to a stack item. Rules-inert beyond the attachment:
   * 'modApplied' means a mod reached a UNIT (every listener reads
   * `ev.data.host`) and there is no host entity here, so this logs like the
   * {Modular} path does. */
  augmentStackItem(item: StackItem, name: CardName, byPlayer: Seat): void {
    (item.augments ??= []).push({ card: name, by: byPlayer });
    const granted = this.card(name).augmentAttrs;
    this.ev('info',
      `${name} augments ${item.label} on the stack`
      + (granted.length ? ` — it gains {${granted.join('} {')}}` : ' — it grants no attributes, so nothing changes')
      + ' — and it is now Unstable.',
      { item: item.id, card: name, seat: byPlayer });
  }

  /**
   * CR 406.4, 723.4b: a stack item's CARD leaves the stack. Normally it goes to its
   * controller's bin — CR 801.2b: it comes FROM THE STACK, so this is never a trash.
   *
   * If a virus rode it, the item is MODDED, and Unstable is a BIN replacement
   * rather than a death replacement (CR 803.8i, Caleb 2025-03-13): the card and every
   * virus on it are ERASED instead, and nothing reaches a bin. That is the
   * mechanism behind Caleb 2025-03-06's "you can hit enemy spells and the spell
   * gets erased on resolution".
   *
   * The OTHER way out of the bin is the printed "Erase me." / "Erase this
   * spell." clause (Collect Remains, Suspend, Temporal Rift), raised by the
   * resolving effect through `EffectCtx.eraseSelf()`. It is a SEPARATE route
   * with its own log line rather than a second way to set `unstable`, because
   * the two mean different things and a player reading the log has to be able
   * to tell them apart: Unstable is a fact about the object (a virus rode it,
   * CR 803.8f; it was played from a bin, CR 704.2c) and survives negation, while "Erase
   * me" is a sentence in the effect and only happens if the effect happened.
   * When both are true, Unstable is announced and the card is erased ONCE —
   * the branches are exclusive, so nothing is double-logged or pushed to the
   * public pile twice.
   *
   * `hasCard` is whether this kind has a card to place at all — a spell token
   * has none, and a triggered/activated ability's `card` names its source,
   * which is still standing in play. The Unstable erase runs either way,
   * because the viruses themselves still have to go somewhere; the self-erase
   * needs a card of its own and does nothing without one.
   */
  dischargeItem(item: StackItem, hasCard: boolean): void {
    // CR 704.2d: a COPY of a spell has no card of its own, whichever of the four
    // exits it took (resolution, CR 704.6 fizzle, negation, virus fizzle). Applied
    // HERE rather than at each caller for the same reason `itemIsUnstable`
    // lives in one place: four sites computing "does this have a card?" is
    // exactly how one of them ends up conjuring a card into a bin.
    if (item.copy === true) hasCard = false;
    const viruses = item.augments ?? [];
    // THREE ways in, all meaning "this card is modded, was stamped, or prints
    // it": a virus rode it (derived, CR 803.8f); it was played from a bin under a
    // permission that stamped it (CR 704.2c, Abyssal Evocation) or a {Modular} mod
    // was applied to it as it was played (CR 724.5, stamped in payModularMod); or
    // CR 803.8k — its printed type line says {Unstable} and the STACK is an active
    // zone. All three live in `E.itemIsUnstable`, which `negate()` reads too:
    // the printed one went missing here and there simultaneously because the
    // expression was written out twice instead of shared.
    // THIS is the site an ordinary bin-played spell hits — the one choke point
    // for both resolution and negation. The virus loop below is correctly a
    // no-op at zero, so it stays untouched, and `disposeItemMods` at the foot
    // of the method is CR 724.5's matching half.
    if (this.itemIsUnstable(item)) {
      // CR 723.4b: the spell and its viruses are erased. Each card goes to the
      // pile of the seat that played it (the spell's controller, each virus's
      // applier), and the two piles are public.
      this.ev('erased',
        `${item.label} is Unstable — `
        + (viruses.length ? `it and its ${viruses.length} virus mod(s) are ERASED.` : 'it is ERASED instead of binned.'),
        { seat: item.controller, cards: hasCard && item.card ? [item.card] : [] });
      for (const seat of [...new Set(viruses.map(v => v.by))].sort()) {
        const mine = viruses.filter(v => v.by === seat).map(v => v.card);
        this.ev('erased', `${mine.join(', ')} — erased with ${item.label}.`, { seat, cards: mine });
      }
    } else if (item.eraseSelf === true && hasCard && item.card) {
      // "Erase me." — the effect asked for this as it resolved, so the card
      // never reaches the bin. CR 407.1: it goes to its controller's public erased
      // pile, which ev() keeps off exactly this event type. CR 801.2 does not enter
      // into it — nothing was binned, so nothing can be trashed out of a bin.
      this.ev('erased',
        `${item.label} erases itself — it does not go to a bin.`,
        { seat: item.controller, card: item.card });
    } else if (hasCard && item.card) {
      this.toBin(item.controller, item.card, 'stack');
    }
    this.disposeItemMods(item);   // CR 724.5 {Modular}: its mods are erased with it
  }

  afterParts(item: StackItem): void {
    if (item.kind === 'spellUnit') {
      // CR 303.10: the body normally enters under whoever cast it. `spawnUnder` is
      // the one exception the pool has — Hush Mush's "its controller gains
      // control of me" — and it is a DIFFERENT CONTROLLER AT ENTRY, not a
      // handover afterwards, so no ally-spawn watcher of the caster's ever
      // sees the body as theirs (report #96). OWNERSHIP does not move: CR 400.4a's
      // owner≠controller split, and the card is still the caster's, so it is
      // still the caster's bin it dies to. `owner` is passed unconditionally
      // because it is exactly `seat` in every other case.
      const u = this.spawnUnit(item.spawnUnder ?? item.controller, item.card!, item.region, {
        owner: item.controller,
        ...(item.from ? { from: item.from } : {}),
        // CR 303.11: …and WEARING what its own text made it, if its own text made
        // it anything (Borrower of Forms). Same shape, same place, same
        // reason: one spell resolution is one body arriving, not a body
        // arriving and then changing.
        ...(item.spawnWearing ? { wearing: item.spawnWearing } : {}),
        // CR 702.3e: …and INTO THE SPOT it was played into, if it was played into
        // one. `resolveItem`'s `kind === 'unit'` arm already passes this; the
        // spell-unit arm did not, so a spell unit played into a formation
        // (Hooba-Pon's menu offers them — the RAQ that card is quoted under)
        // would have declared a spot at cast and then arrived beside the line.
        // Dormant until now: `playsIntoFormation` is on one card and it is a
        // plain unit, so no item reached here carrying a spot.
        ...(item.formationSpot ? { spot: item.formationSpot } : {}),
      });
      // CR 723.4c: a spell UNIT's card does not leave — it arrives. Its viruses ride
      // it in, as the augment mods they always were, which is also what makes
      // the body Unstable. Erasing the card here instead would delete a unit
      // on its way into play, which no ruling asks for.
      for (const a of item.augments ?? []) this.attachMod(u, a.card, a.by, 'augment');
      // CR 803.8d: a spell UNIT played from a bin spawns a body, and the stamp goes
      // with it — the card said "THEY gain unstable until regroup", and the
      // body is what the card became. This is the "edge, noted for review" in
      // Spell Excavation's own comment, closed.
      if (item.unstable) u.unstable = true;
      this.disposeItemMods(item);   // CR 724.5 {Modular}: its mods are erased with it here too
      return;
    }
    // CR 801.2b: a resolved spell goes to the bin FROM THE STACK — explicitly not a
    // trash. CR 723.4b: unless a virus rode it, in which case it is Unstable and the
    // whole pile is erased instead. spellToken: already out of play;
    // triggered/activated: nothing to move.
    this.dischargeItem(item, item.kind === 'spell');
  }

  // ── suspensions & decisions ─────────────────────────────────────────
  suspend(susp: Suspension, dec: Omit<Decision, 'id'>): never {
    this.s.suspension = susp;
    /**
     * CR D6.3a's phase gate, applied to EVERY suspension rather than only to the
     * mid-resolution one.
     *
     * `s.resolving` is a BATTLE-PHASE publication and always was:
     * `beginResolving` refuses to set it outside battle (a hidden simultaneous
     * segment must not tell your opponent you are mid-something), and
     * `resolveParts`' PartChoice catch re-applies the same gate — the fuzzer's
     * seed 693, where a battle resolution ended the battle and settle() then
     * resolved a Wraith's start-of-deployment trigger INLINE, which suspended
     * and stranded the outer battle item's marker in the deploy phase.
     *
     * A 'cast' suspension raised on the way TO the stack never goes anywhere
     * near that catch, and reopened the hole from a new direction while the
     * Wraith chose its ally there (2026-08-24 to 2026-10-16; it chooses on
     * resolution again now, but any deployment trigger with a target or a
     * mode still suspends on the way to the stack). Two sites cannot
     * both be remembered, so the gate moves to the one door every suspension
     * goes through. Nothing is lost by clearing it here: outside battle the
     * marker was never legal to publish in the first place, and the throw has
     * abandoned the outer resolution either way.
     */
    if (this.s.phase !== 'battle') this.s.resolving = null;
    // `nextId` is rewound by a resolution replay, so on its own it can
    // hand out a decision id that has already been on a client's screen — and
    // ui/sfx.ts reads "a new id" as "a new question was asked". The high-water
    // mark keeps decision ids strictly increasing; outside a replay it never
    // binds, so every id in a normal game is the one it always was.
    const id = Math.max(this.s.nextId++, (this.s.decisionHigh ?? 0) + 1);
    this.s.decisionHigh = id;
    this.s.decision = { ...dec, id };
    throw new Suspended();
  }

  /**
   * CR D6.3b — the answer to a mid-resolution question has arrived: put the world
   * back at the boundary of the part that is about to be replayed, and say how
   * many of that part's events the table has already seen.
   *
   * This is the rollback that used to happen the instant the part suspended.
   * Moving it here is the whole fix: between the question and the answer the
   * state on the table is the REAL, partly-resolved one — the card that was
   * drawn, the unit that was put into play, the mana that was spent are all
   * visible to everyone, which is the entire point of an effect that says
   * "starting with you, players may…" (playtest UFAB, Insidious Invitation).
   *
   * Safe because that published state never has to be action-LEGAL, only
   * renderable: apply()'s dispatch refuses every action except `decide` and
   * `concede` while a decision is pending, so nothing can be built on top of a
   * half-resolved board.
   *
   * A handful of fields are carried FORWARD across the rewind rather than
   * being undone — they belong to the session, not to the resolution:
   *  · `actionCount`, the client's "my action landed" latch (ui/main.ts). It
   *    must never go backwards or the UI waits forever.
   *  · `decisionHigh`, for the same reason decision ids exist at all.
   *  · the seat NAMES, which rooms.ts writes straight into the state outside
   *    the action log (renameSeat), so a rewind would restore a stale one.
   * Everything else — entities, the RNG stream, zones — goes back.
   *
   * ⚠ `nextId` goes back to the boundary PLUS ONE, which looks arbitrary and
   * is not. A SAVED GAME's action log names entities by id (`declareAttack`'s
   * columns, `declareBlocks`' blocks and sends, `activateAbility`, `augment`),
   * so the id stream is part of the replay contract: get it wrong by one and
   * every later action in an old log addresses the wrong unit and is refused.
   * The older engine rolled back at the suspension and THEN spent one id on
   * the decision, so each replay of a part started one higher than the last;
   * `snapshot.nextId + 1` reproduces that recurrence exactly, attempt for
   * attempt. (Verified against saved room UFAB, which suspends mid-resolution
   * at action 30 and rejected 106 of its 154 actions without this.)
   *
   * The visible cost is small and worth naming: an entity created in the
   * partly-resolved state the players are looking at is re-created by the
   * replay with an id one higher, so a client that tracks entities by id sees
   * it as a new object once the answer lands. Nothing in the rules reads an
   * id, and the alternative — a stable id stream — is unreplayable history.
   */
  resumeResolve(sus: Extract<Suspension, { type: 'resolve' }>): number {
    const snap = sus.snapshot;
    // pre-resume-rollback suspension (an old saved game, mid-resolution): it rolled back
    // when it suspended, so the state IS the boundary already.
    if (!snap) return 0;
    const live = this.s;
    const boundaryId = snap.nextId;
    this.s = snap;
    this.s.nextId = boundaryId + 1;
    this.s.actionCount = live.actionCount;
    this.s.decisionHigh = live.decisionHigh;
    live.players.forEach((p, i) => { const q = this.s.players[i]; if (q) q.name = p.name; });
    this.s.suspension = null;
    this.s.decision = null;
    // Exactly as at the suspension: ONE object for the resolving item.
    this.s.resolving = this.s.phase === 'battle' ? sus.item : null;
    return sus.shown ?? 0;
  }

  // ── mods ────────────────────────────────────────────────────────────
  /** opts.token (CR 721.6): the mod IS a token — a Wraith augmented onto a unit is
   * the token card, applied rather than spawned. A token mod is erased
   * when it leaves play instead of being binned (a mod has no card to bin,
   * CR 410.4c), which recall()/cacheUnit() honour. */
  attachMod(host: Entity, name: CardName, byPlayer: Seat, appliedAs: 'augment' | 'graft',
    position?: number, opts: { token?: boolean } = {}): Entity {
    const mod = this.newEntity({
      card: name, owner: byPlayer, controller: host.controller, kind: 'mod',
      region: host.region, modOf: host.id, appliedAs,
      ...(opts.token ? { token: true } : {}),
    });
    if (appliedAs === 'graft' && position !== undefined) host.mods.splice(position, 0, mod.id);
    else host.mods.push(mod.id);
    const how = appliedAs === 'graft' ? 'grafts onto' : 'augments';
    const ev = this.ev('modApplied',
      `${name} ${how} ${host.card} (${this.pname(host.controller)}'s) — it is now Unstable.`,
      { host: host.id, mod: mod.id, appliedAs });
    this.fireEvent('modApplied', ev);
    return mod;
  }

  /**
   * CR 720.10 — MOVE an existing mod entity onto another host. `attachMod`'s
   * sibling: that one MINTS a mod, this one RE-PARENTS the one already there.
   *
   * Two cards print it — Reconfigure ("Augment target unit and all of its mods
   * onto another target unit") and Rotbeast ("[Augment] After combat, move all
   * my other Augments onto one or more enemies") — and both used to do it by
   * hand, five fields and two arrays each, in two places. There was no
   * primitive because there was no ruling on what a move takes with it.
   *
   * THE OWNER RULED IT (2026-08-25), verbatim: *"Unstable is just an attribute
   * granted to all entities that are modded. Of course it moves with the
   * mods."* So EVERYTHING follows the mod, and the mechanism the ruling does
   * not name turns out to be "nothing" — every consequence is DERIVED, not
   * stored, and this method only has to keep the derivation's inputs honest:
   *
   *  · {Unstable}. `isUnstable` reads `e.mods.length > 0` LIVE, so the old host
   *    stops being Unstable the moment its last mod leaves and the new host
   *    starts being Unstable the moment one arrives. No stamp is moved, and
   *    `Entity.unstable` (CR 803.8d's until-regroup stamp, a different thing) is
   *    deliberately untouched: that one is about how a CARD was played.
   *  · Statics, cost modifiers, permissions, attribute donations, triggered
   *    text. Every one of these radiates through `anchored()`, which resolves
   *    an augment mod's anchor by `this.entity(holder.modOf)` at READ time —
   *    so re-pointing `modOf` re-anchors all fourteen channels at once, and a
   *    "+1/+1 to my host" mod stops helping the old host in the same tick.
   *  · CONTROLLER. It follows the new host, exactly as `attachMod` sets it, so
   *    a mod moved onto an enemy now radiates for the enemy — which is the
   *    whole point of Rotbeast's printed line.
   *  · BOUNDED BUDGETS (CR 109.9e) RIDE ALONG. A graft's budget lives on the mod
   *    entity itself, which is the same one. But an AUGMENT ability's [once]
   *    (Graxxlid's negate, activated or triggered off the mod's augment text)
   *    is written on the HOST, under `augment:<card>#<n>` — so those marks
   *    are copied onto the new host here. CR 720.10b / CT-213, the RAQ
   *    ("Reconfigure vs Once per Turn Abilities"): "Since Graxxlid was
   *    already Activated this turn, you CANNOT use his Ability again." Copied,
   *    not moved (CR 109.9e): the engine keys the budget per card name on a host, so a second same-name mod left behind stays spent too — CR 109.9k gives each mod its own use (engine differs, no ticket yet). `from` names the old host
   *    when the caller has already taken it out of play (Reconfigure).
   *
   * NOT an `attachMod`: no 'modApplied' event fires, because moving is not
   * applying (CR 720.10c's spirit) — nothing that watches for a mod being applied
   * re-triggers off a mod merely changing hosts. The caller announces the move
   * in its own printed words, and the caller owns `checkDeaths()` afterwards
   * (a host that loses a +X/+X mod can die of it).
   *
   * Returns false and does nothing if this is not a move at all — not a mod,
   * already on that host, or onto itself.
   */
  moveMod(mod: Entity, newHost: Entity, from?: Entity): boolean {
    if (mod.kind !== 'mod') return false;
    if (mod.id === newHost.id || mod.modOf === newHost.id) return false;
    const old = mod.modOf !== undefined ? this.entity(mod.modOf) : undefined;
    if (old) {
      const i = old.mods.indexOf(mod.id);
      if (i !== -1) old.mods.splice(i, 1);
    }
    const spentOn = old ?? from;
    if (spentOn) {
      const prefix = `augment:${mod.card}#`;
      for (const [k, v] of Object.entries(spentOn.budgets)) {
        if (k.startsWith(prefix) && (v ?? 0) > 0) newHost.budgets[k] = v;
      }
    }
    mod.modOf = newHost.id;
    mod.region = newHost.region;
    mod.controller = newHost.controller;
    newHost.mods.push(mod.id);
    return true;
  }

  /**
   * CR 720.9 / CT-86 — take a mod OFF a host that stays in play, and remove the
   * entity from the game. `attachMod`'s inverse and `moveMod`'s (CR 720.10)
   * sibling: that one re-parents, this one unlinks and deletes.
   *
   * WHY IT EXISTS. There was no choke point for this at all, and five sites
   * hand-rolled the same two lines — `host.mods.splice(…)` plus
   * `delete s.entities[id]` — each with its own announcement and its own
   * answer to the CR 407.2 public-erased-pile question:
   *
   *  · Slag Spewer's `[Erase one of my mods]` cast cost (`payCastCost`) — 'info'
   *  · Suppression Field (batch-metal-c)                                 — 'info'
   *  · Ominous Growth (batch-hybrids-wm-b), token mods only              — 'info'
   *  · Return to Nature (batch-earth-b)                          — 'erased' + 'info'
   *  · Reclaim the Fallen (batch-hybrids-ld-a) — not an erase at all, see below
   *
   * ⚠ THIS REFACTOR DELIBERATELY CHANGES NOTHING A PLAYER CAN SEE, AND THAT IS
   * THE ENTIRE POINT. Whether a mod erased as a cost reaches the public erased pile (CR 407.2 now says it does) is an OPEN OWNER RULING (round-27 Q3/Q9, unanswered): the exchange ruling arguably wants it there and the agent who moved the erase into the cost left it rather than guess. So
   * every caller keeps the exact announcement it had, including Slag Spewer's
   * 'info', and this method emits NOTHING. What the choke point buys is that
   * when Q3 is answered the pile line goes in ONE place — right here, guarded
   * by `opts.leavesGame` — instead of being reasoned about at five call sites.
   * A refactor that quietly emitted 'erased' would have pre-empted the ruling.
   *
   * `opts.leavesGame` (default true) is the one distinction the sites really
   * differ on, and it is a fact about the CARD, not about the announcement:
   * Reclaim the Fallen removes the mod entity and then puts the card INTO PLAY
   * as a unit, so the card never leaves the game and must never reach the
   * erased pile whatever Q3 answers. Everything else is a real erase.
   *
   * NOT a despawn and NOT a death: a mod is not a body and has no death of its
   * own to run (the Ominous Growth comment says the same in longhand). No
   * event fires. The CALLER owns `checkDeaths()` afterwards — a host that
   * loses a +X/+X mod can die of it — exactly as `moveMod` leaves it.
   *
   * ⚠ CALLERS THAT ARE NOT THIS. Every `delete this.s.entities[m.id]` left in
   * the engine is a HOST-LEAVES-PLAY disposal (`leavePlay`, `disposeToBin`,
   * `eraseFromPlay`, `eraseUnit`, the regroup token sweep, `exchangeInPlace`,
   * apply.ts's deployment-augment ride). There the host is already gone, so
   * there is no `host.mods` to unlink from and the mods' destination is the bin-entry code's
   * question, not this one. They stay where they are.
   *
   * Returns false and does nothing if this is not a mod, or its entity is
   * already gone.
   */
  eraseMod(mod: Entity,
    opts: { leavesGame?: boolean; msg?: string; alreadyFiled?: boolean } = {}): boolean {
    if (mod.kind !== 'mod') return false;
    if (!this.entity(mod.id)) return false;
    const host = mod.modOf !== undefined ? this.entity(mod.modOf) : undefined;
    if (host) {
      const i = host.mods.indexOf(mod.id);
      if (i !== -1) host.mods.splice(i, 1);
    }
    delete this.s.entities[mod.id];
    // CR 801.6 — AN ERASED CARD GOES TO THE ERASED PILE. This was written as "the
    // Q3 seam, deliberately empty" and left `void`ed across two rounds while a
    // question was carried to the owner. There was no question: the card says
    // "erase", which names the destination. His answer, when finally asked:
    // "Obviously the card says where it should end up. It's erased… It should
    // just end up in the erased zone."
    //
    // The erased pile exists because of his complaint that "there's currently no way to
    // view erased cards". A site that erases a card and files it NOWHERE is
    // that bug, and every such site is now this one.
    //
    // Two things it deliberately does NOT do:
    //  · `leavesGame: false` skips the pile. Reclaim the Fallen "erases" a mod
    //    that is going INTO PLAY, not out of the game, and a pile listing a
    //    card you can see on the table is worse than no pile.
    //  · A TOKEN mod is not filed. CR 304.2: a token is not a card, it has no card
    //    to show, and CR 720.9a's pile is a list of cards. (`disposeToBin` files
    //    token mods today; that disagreement predates this and is left alone
    //    rather than widened here.)
    //  · `alreadyFiled` is for the ONE caller that files the pile itself and
    //    files it BETTER: Return to Nature groups every mod it erases into a
    //    single `erased` line per owner, which reads as one event because it
    //    is one. Per-mod lines underneath would be the same cards twice.
    if (opts.leavesGame !== false && !opts.alreadyFiled && !mod.token) {
      // CR 720.9: `mod.controller`, was `mod.owner`. The erased pile is a
      // per-seat zone like the others, so the Return to Nature family follows
      // control too — one rule, no seam. Zones following control already moved the mod bin this
      // way; this is the pile that was left behind.
      this.ev('erased', opts.msg ?? `${mod.card} is erased.`,
        { seat: mod.controller, cards: [mod.card] });
    }
    return true;
  }

  /** Compose the parts of a firing ability: base effect + graft-mod effects,
   * top-to-bottom (Manual p.33). Bounded pieces consume per-card budgets (CR 803.4). */
  composeParts(source: Entity, abilityIndex: number, abilityKeyPrefix: 'ability' | 'augment', viaCard?: CardName): EffectPart[] | null {
    // CR 710.1: with no `viaCard` the ability is the source's OWN, which
    // means the card it currently IS — the face, not the physical card.
    const cardName = viaCard ?? this.faceName(source);
    const def = this.card(cardName);
    const list = abilityKeyPrefix === 'ability' ? def.abilities : def.augmentText;
    const ability = list?.[abilityIndex];
    if (!ability) return null;
    const budgetKey = `${abilityKeyPrefix}:${cardName}#${abilityIndex}`;
    const budgetHolder = source;   // per card = per entity instance (CR 803.4)
    if (ability.bounded) {
      // CR 109.9m / CARD-TODO #21: a ZONE-dispatched firing (CR 400.5) arrives on a
      // throwaway stand-in (id -1) whose `budgets` dies with the call, so its
      // [once] reservation moves to real, serialized state instead —
      // GameState.zoneBudgets, per (seat, card name). "Per card" (CR 109.9m) for a
      // card that is not in play can only mean the NAME in that seat's zone:
      // a bin holds bare names, not instances, so three copies leaving one
      // bin share one budget, the same way the zone dispatch gives three copies one firing.
      // Cleared by startTurn beside the Entity.budgets wipe; refunded by
      // refundPart's stand-in branch (CR 109.9b keeps working from a zone).
      // ZONE-dispatched only: CR 109.9n's trash-trigger stand-in also has id -1,
      // but there the throwaway per-instance budget is DELIBERATE ("each
      // trashed card is its own instance" — see fireOwnTrashTrigger); only a
      // zone listener is a standing per-name permission (CR 109.9m), so only it
      // keeps its reservation here.
      if (source.id === -1 && (ability as { zone?: 'bin' | 'cache' }).zone !== undefined) {
        const zb = (this.s.zoneBudgets ??= {});
        const zoneKey = `${source.controller}:${budgetKey}`;
        if ((zb[zoneKey] ?? 0) > 0) return null;
        zb[zoneKey] = 1;
      } else {
        if ((budgetHolder.budgets[budgetKey] ?? 0) > 0) return null;   // bounded cause bounds the whole composite
        budgetHolder.budgets[budgetKey] = 1;
      }
    }
    const base: EffectPart = {
      effectKey: `${abilityKeyPrefix}:${cardName}#${abilityIndex}`, targets: [],
    };
    const parts: EffectPart[] = [base];
    // grafted effects join only a graft cause, and only from graft-applied mods
    if (ability.graftCause && abilityKeyPrefix === 'ability') {
      const grafts: EffectPart[] = [];
      // CR 722.8, 710.2b / CT-219: a COPY of a graft cause carries the grafts it copied
      // (CopyRef.mods), and they come FIRST — RAQ "Borrower of Forms": "it
      // inherits all of the combined text", and a graft added to the copy
      // later goes "only 'underneath' original copied grafts". A copied graft
      // has no entity, so a bounded one keeps its budget on the copy itself,
      // under its part key (which is what refundPart hands back).
      for (const cm of this.identityCopy(source)?.mods ?? []) {
        if (cm.appliedAs !== 'graft') continue;
        const g = this.card(cm.card).graftEffect;
        if (!g) continue;
        const key = `graft:${cm.card}`;
        if (g.bounded) {
          if ((source.budgets[key] ?? 0) > 0) continue;
          source.budgets[key] = 1;
        }
        grafts.push({ effectKey: key, targets: [] });
      }
      for (const modId of source.mods) {
        const mod = this.entity(modId);
        if (!mod || mod.appliedAs !== 'graft') continue;
        const g = this.card(mod.card).graftEffect;
        if (!g) continue;
        if (g.bounded) {
          if ((mod.budgets['graft'] ?? 0) > 0) continue;   // used this turn: skipped, composite still fires
          mod.budgets['graft'] = 1;
        }
        grafts.push({ effectKey: `graft:${mod.card}`, targets: [], fromMod: mod.id });
      }
      // CR 722.7: "(Trigger two copies of this graft ability as one single
      // trigger)" — a multiplier in the composite (the cause itself, Lost
      // Guardian's own ability; or a multiplier grafted under this host)
      // repeats every OTHER graft N times, top-to-bottom and then top-to-
      // bottom again, bounded grafts included. Each copy is its own part, so
      // it collects its own targets and pays its own [cost]. The multiplier
      // parts themselves appear once and do nothing at resolution.
      const copies = [base, ...grafts]
        .map(p => effectByKey(p.effectKey).graftCopies ?? 1)
        .reduce((a, b) => a * b, 1);
      parts.push(...grafts);
      for (let round = 1; round < copies; round++) {
        for (const p of grafts) {
          if (effectByKey(p.effectKey).graftCopies) continue;   // never multiply a multiplier
          parts.push({ ...p, targets: [] });
        }
      }
    }
    return parts;
  }

  // ── triggers ────────────────────────────────────────────────────────
  /** Scan for triggered abilities matching an event. Conditions are evaluated
   * NOW, at event time (CR 109.3a); effects run later, at resolution. Never processes
   * the queue — that happens at safe points via settle(). */
  /**
   * `beingPlayed` — CR 701.1e: the entity whose own PLAY this event announces, when
   * that entity is already standing in play as the event fires. It is not a
   * listener: "an ability that triggers when its controller plays a unit works
   * only while its card is in play", and a card being played is on the stack,
   * so it never hears its own play, under any wording and out of any zone.
   * Every ordinary play fires its play events at commit, while the card is on
   * the stack, so they never needed this; the `asPlay` spawn (Wake the Dead,
   * The Bonesculptor) is the one play whose body exists before its
   * 'cardPlayed' goes out, and without this Bloomcaster made a 1/1 for itself
   * and Void Mandible sacrificed itself to its own arrival (444).
   */
  fireEvent(type: EventType, ev: EngineEvent, dyingUnit?: Entity, beingPlayed?: EntityId): void {
    const region = (ev.data?.region as number | undefined) ?? (ev.data?.unit !== undefined ? this.entity(ev.data.unit as EntityId)?.region : undefined);
    const sourceId = (ev.data?.unit as EntityId | undefined);
    // region-scoped listeners (CR 101.6 / Manual: other regions don't exist)
    const listeners = Object.values(this.s.entities).filter(e =>
      e.kind === 'unit' && !e.absent && e.id !== beingPlayed && (region === undefined || e.region === region));
    if (dyingUnit) listeners.unshift(dyingUnit);   // a unit sees its own death
    // CR 706.8c: and every OTHER body of the same simultaneous death batch is still
    // a listener, even though `destroy` has already deleted it from
    // `s.entities`. A batch that is simultaneous in the rules (CR 112.8, D6.7) must
    // be simultaneous to the triggers watching it: "when you trash a card",
    // "whenever a unit dies", "whenever another ally dies" do not stop hearing
    // the step they died in. Members not yet disposed are still in
    // `s.entities` and were collected above; the one being disposed right now
    // is excluded, which is the trash rule's "excludes the trigger source itself" (CR 713.6a).
    for (const d of this.deathBatch) {
      if (d.id === this.disposingSelf) continue;
      if (this.s.entities[d.id]) continue;            // has not left play yet
      if (d.absent) continue;
      if (region !== undefined && d.region !== region) continue;
      listeners.push(d);
    }
    // initiative player's units scan first (stable collection order)
    listeners.sort((a, z) => (a.controller === this.initiative ? 0 : 1) - (z.controller === this.initiative ? 0 : 1));
    let queued = false;
    for (const u of listeners) {
      // CR 712.1a, 712.2: a stripped unit's triggered text is its own, its [Augment] text,
      // its mods' donated text and anything granted to it — and a stripper
      // takes only what arrived BEFORE it. Its own text is the oldest thing on
      // it, so any stripper silences that; a mod attached or text granted
      // after the strip still listens.
      const strips = this.strippersOf(u, 'abilities');
      const kept = (at: Stamp): boolean => !strips.length || !E.strippedBy(at, strips);
      const src = sourceId ?? dyingUnit?.id;
      // CR 710.1: the triggered text comes off the FACE. A Unit Token that
      // became a Noxious Deathcap really has "when I die, …" — and "I" is the
      // token, because the face is what the entity IS, not a second card.
      if (kept(E.PRINTED)) for (const face of this.facesWith(u, 'triggered')) {
        queued = this.collectTriggersFrom(u, face, 'ability', type, ev, src) || queued;
        // a card's own [Augment] text is active when played normally (Manual Q&A)
        queued = this.collectTriggersFrom(u, face, 'augment', type, ev, src) || queued;
      }
      // CR 710.2a: the [Augment] text of the mods a copy copied — the copy's own
      // text (no mod entity, so no `selfModId`), stamped as printed
      if (kept(E.PRINTED)) for (const card of this.copiedAugments(u, 'triggered')) {
        queued = this.collectTriggersFrom(u, card, 'augment', type, ev, src) || queued;
      }
      for (const modId of u.mods) {
        const mod = this.entity(modId);
        if (mod && mod.appliedAs === 'augment' && kept(E.entityStamp(mod.id))) {
          // CR 720.6d: the mod's OWN id rides along, so its donated text can say
          // "my other Augments" and mean every augment on this host except
          // this one entity — a second copy of the same card included.
          queued = this.collectTriggersFrom(u, mod.card, 'augment', type, ev, src, mod.id) || queued;
        }
      }
      // CR 109.8: text granted until regroup listens exactly like printed text
      for (const g of u.granted ?? []) {
        if (!kept(g.at ?? E.PRINTED)) continue;
        queued = this.collectTriggersFrom(u, g.card, g.via, type, ev, src) || queued;
      }
    }
    queued = this.fireZoneTriggers(type, ev) || queued;
    if (queued) this.s.triggerOrderedSeats = [];   // new batch: (re)ask ordering
  }

  /**
   * CR 400.5: dispatch to cards sitting in a BIN or a CACHE — "If I am in your bin,
   * after combat …" (Lurking Dread, Inexorable Miasma, Cinder Scuttler). The
   * in-play scan above cannot find them: they are not entities at all, just
   * names in a zone.
   *
   * Each listener is anchored on a DETACHED stand-in entity (id -1), exactly
   * like fireOwnTrashTrigger: not in s.entities, untargetable, radiating
   * nothing, thrown away with the call. `owner`/`controller` are the seat whose
   * zone holds the card, so "if I am in YOUR bin" is that seat throughout, and
   * `region` is that seat's action region so the resolution lands somewhere.
   *
   * ONE firing per zone per event even when the zone holds several copies: the
   * printed texts are standing permissions ("if I am in your bin"), not
   * per-copy triggers. Bounded budgets (CR 109.9m) cannot persist on a stand-in, so
   * composeParts keeps a zone firing's [Switch1] reservation in
   * GameState.zoneBudgets instead — per turn per (seat, card name), refunded
   * by refundPart's stand-in branch (CR 109.9m / CARD-TODO #21).
   *
   * Cost: one Map.get() per event when nothing in the pool listens from a zone.
   */
  /**
   * A DETACHED stand-in entity for a trigger whose card is not in play (for
   * trash-self triggers, CR 400.5 zone triggers). Never put into s.entities — it
   * cannot be targeted, radiates no statics and turns up in no other scan. It
   * exists only to give `when` and the bounded-budget bookkeeping
   * something to read, and is thrown away with the call. Its id -1 is not in
   * s.entities, so `g.entity(ctx.sourceId)` correctly answers "there is no
   * such unit".
   */
  private standIn(name: CardName, seat: Seat, region: number): Entity {
    return {
      id: -1, card: name, owner: seat, controller: seat, kind: 'unit', region,
      damage: 0, counters: 0, tempPower: 0, tempToughness: 0, mods: [], budgets: {},
    };
  }

  /**
   * The collect-and-queue step every trigger dispatch shares: evaluate `when`
   * NOW, at event time (CR 109.3a); compose the parts (null = bounded and already
   * used this turn, CR 109.9); push the pending trigger; log it. The caller supplies
   * the log line and payload — those differ per site. `host.region` rides the
   * queued trigger because the host may be GONE by the time it resolves (CR 714.9a:
   * every "when I die" trigger is exactly that, and a stand-in was never in
   * s.entities to read later).
   */
  private queueTrigger(host: Entity, cardName: CardName, abilityIndex: number,
    ability: TriggeredAbility, prefix: 'ability' | 'augment', ev: EngineEvent,
    logMsg: string, logData: Record<string, unknown>, selfModId?: EntityId): boolean {
    if (ability.when && !ability.when(this, host, ev)) return false;
    const parts = this.composeParts(host, abilityIndex, prefix, cardName);
    if (!parts) return false;
    this.s.triggerQueue.push({
      sourceId: host.id, sourceCard: cardName, controller: host.controller,
      abilityIndex, label: `${cardName}: ${ability.label}`, parts,
      region: host.region,
      // CR 720.6d: which MOD donated this text, when a mod did. See PendingTrigger.
      ...(selfModId !== undefined ? { selfModId } : {}),
      event: ev,
    });
    // `parts` and `controller` ride every trigger because this is the one
    // choke point all trigger dispatch shares, and the stats fold needs to
    // count composite grafts ("trigger a graft effect with 5 or more parts")
    // without re-deriving the composition. Signal-only, additive: nothing
    // reads them inside the engine and no replay changes shape.
    this.ev('triggered', logMsg, { ...logData, parts: parts.length, controller: host.controller });
    return true;
  }

  private fireZoneTriggers(type: EventType, ev: EngineEvent): boolean {
    const listeners = zoneTriggersFor(type);
    if (!listeners.length) return false;
    let queued = false;
    for (const seat of [this.initiative, this.nit]) {
      for (const { card: name, abilityIndex, zone } of listeners) {
        // CR 405.7: 'leftBin' is the one event whose subject has ALREADY left the
        // zone it listens from, so presence-in-the-bin is exactly the wrong
        // test — the event itself is the presence. It reaches the card that
        // just left (this name, out of this seat's bin) and nobody else,
        // which is also where a leftBin listener's `self: true` is enforced:
        // "I" left, and another card leaving my bin is not me. The pronoun
        // reading is the same fact from the other side — "YOUR bin" is the
        // BIN OWNER's: the seat whose bin the card left is the seat that
        // fires, decides and collects, whichever side once played the card.
        const present = type === 'leftBin'
          ? zone === 'bin' && ev.data?.['card'] === name && ev.data?.['seat'] === seat
          : zone === 'bin'
            ? this.player(seat).bin.includes(name)
            : this.cache(seat).some(cc => cc.card === name);
        if (!present) continue;
        const ability = this.card(name).abilities?.[abilityIndex];
        if (!ability || !isTriggered(ability)) continue;
        const ghost = this.standIn(name, seat, this.actionRegion(seat));
        queued = this.queueTrigger(ghost, name, abilityIndex, ability, 'ability', ev,
          `Trigger: ${name} — ${ability.label} (from ${this.pname(seat)}'s ${zone}).`,
          { card: name, zone }) || queued;
      }
    }
    return queued;
  }

  private collectTriggersFrom(host: Entity, cardName: CardName, prefix: 'ability' | 'augment', type: EventType, ev: EngineEvent, eventSource?: EntityId, selfModId?: EntityId): boolean {
    const def = this.card(cardName);
    const list = prefix === 'ability' ? def.abilities : def.augmentText;
    if (!list) return false;
    let queued = false;
    let narrow: { holder: Entity; mod: import('./cards/dsl.ts').StaticMod }[] | undefined;   // CR 712.4
    list.forEach((ability, idx) => {
      if (!isTriggered(ability)) return;
      if (!ability.events.includes(type)) return;
      if (ability.self && eventSource !== host.id) return;
      /**
       * CR 400.5 — BIN AND CACHE TEXT IS NOT LIVE FROM PLAY.
       *
       * `zone` says this clause only exists while the card SITS in that zone
       * ("if I am in your bin, recall me"). `fireZoneTriggers` is the only
       * dispatcher that may reach it, and it gates on the card actually being
       * there. This scan is the other one: it walks the entities IN PLAY, and
       * for an in-play body "if I am in your bin" is false by construction —
       * the card is on the battlefield, not in a bin.
       *
       * Without this line every zone clause fired from play as well. Measured
       * 2026-09-20: Lurking Dread attacking with an EMPTY bin and an empty
       * cache pushed both of its zone abilities onto the stack, and they
       * survived only because the effects re-check the zone when they resolve
       * and fizzled with "it is no longer in a bin or cache".
       *
       * Cinder Scuttler is the one where that re-check saves nothing, and it
       * is the Discord report this comes from. The Scuttler attacks, its own
       * body hears `combatFaceDamage` and queues "recall me from your bin"
       * while standing in play; CR 608.9b holds the batch to the after-combat
       * stack; in between the Scuttler dies to the blocker and arrives in the
       * bin for real — so the effect's `bin.lastIndexOf` finds it and recalls
       * the card out of the combat that killed it.
       *
       * ⚠ THE COMBAT DAMAGE STEP WAS NEVER THE BUG, and the fix does not go
       * near it. Owner, 2026-09-20: *"Damage happens in the combat damage
       * step, then state based actions are checked and units die. There is no
       * window of reaction for players between those… If there is no Swift or
       * Sluggish in combat, then it's impossible for Cinder Scuttler to die to
       * combat damage and be returned at the same moment since, technically,
       * it's not in the bin when the damage is dealt."* The engine already
       * does exactly that — `checkDeaths()` runs after the sub-step returns
       * (CR 608.7b, no priority), the trigger queue is held across sub-steps and
       * drains after combat (CR 608.9b), and CR 608.3b gives a split damage step its
       * reaction windows. The event trace confirms the order: the Scuttler's
       * `died` lands AFTER `combatFaceDamage`. Only the listener scan was
       * wrong, so the Swift case the owner describes still works — a Scuttler
       * put in the bin by a Swift unit IS in the bin when the normal
       * sub-step's damage is dealt, and `fireZoneTriggers` finds it there.
       */
      if (ability.zone) return;
      // CR 712.4: a suppressor that names ONE clause switches off that clause and
      // nothing else. fireEvent's whole-layer gate above has already answered
      // "loses all abilities"; this is the narrow question.
      //
      // ⚠ HOISTED, and lazily. `abilityIsSuppressed` costs one `staticsFor`,
      // and this is the hottest loop in the engine — asking it per ability of
      // every listener of every event would multiply the layer query fireEvent
      // already pays. Computed at most ONCE per call, and only when an ability
      // has actually matched the event.
      narrow ??= this.staticsFor(host).filter(st => st.mod.suppressAbility);
      if (narrow.some(st => st.mod.suppressAbility!(this, st.holder, host, ability))) return;
      queued = this.queueTrigger(host, cardName, idx, ability, prefix, ev,
        `Trigger: ${cardName} — ${ability.label}.`, { unit: host.id }, selfModId) || queued;
    });
    return queued;
  }

  /** Two queued triggers are interchangeable for ordering purposes: same card,
   * same ability, same label AND same composed parts (a graftCause composite
   * whose bounded graft was already spent differs in parts and still asks).
   * Deliberately NOT keyed on the source entity — two token copies queuing the
   * same trigger read identically in the ordering UI (options are labels), so
   * asking would be a blind, meaningless choice. Event snapshots may differ
   * (each firing resolves its own event); the multiset of outcomes is the same. */
  private sameTrigger(a: import('./types.ts').PendingTrigger, b: import('./types.ts').PendingTrigger): boolean {
    return a.sourceCard === b.sourceCard && a.abilityIndex === b.abilityIndex
      && a.label === b.label && JSON.stringify(a.parts) === JSON.stringify(b.parts);
  }

  /** Drain the trigger queue. In battle AND in deployment (CR 706.3c), triggers
   * become stack items (owner orders their own; NIT's enter last so they
   * resolve first — CR 706.5). Everywhere else they resolve immediately in the order
   * the stack would produce.
   * A seat whose queued triggers are ALL identical (sameTrigger) skips the
   * ordering decision — the order cannot matter or even be expressed. */
  processTriggerQueue(only?: Seat): void {
    // CR 507.5a: `only` scopes the whole drain to ONE seat's batch — the isolated
    // deployment path, where the other seat has a question open and their
    // triggers must not be built, aimed or resolved on this seat's tick (the
    // CR D2.1d reason, unchanged; it is the SCOPE that is new, not the rule).
    // Undefined everywhere else, and every expression below then reads
    // exactly as it did before the per-seat deployment drain.
    const mineOnly = (t: import('./types.ts').PendingTrigger) =>
      only === undefined || t.controller === only;
    while (this.s.triggerQueue.some(mineOnly)) {
      // 1. per-seat ordering decisions (the chosen order = resolution order)
      for (const seat of (only === undefined ? [this.initiative, this.nit] : [only])) {
        const mine = this.s.triggerQueue.filter(t => t.controller === seat);
        if (mine.length >= 2 && !this.s.triggerOrderedSeats.includes(seat)
          && !mine.every(t => this.sameTrigger(t, mine[0]!))) {
          this.suspend(
            { type: 'orderTriggers', seat },
            {
              seat, kind: 'orderTriggers', pickOrder: true,
              prompt: 'Order your triggers (first picked resolves first)',
              options: mine.map(t => ({ label: t.label, value: t.label })),
            },
          );
        }
        if (mine.length && !this.s.triggerOrderedSeats.includes(seat)) {
          this.s.triggerOrderedSeats.push(seat);
        }
      }
      // 2. next trigger: stack mode → stack entry order IT(reversed) then
      //    NIT(reversed); immediate → resolution order NIT first (equivalent
      //    outcomes, CR 706.5)
      /**
       * CR 608.9b (owner, round-32 Q1): THE DAMAGE STEP NO LONGER HAS A MODE OF
       * ITS OWN. This used to read `&& !this.s.battle?.damageStep`, which is
       * how the old no-window-between-damage-sub-steps ruling was implemented — a trigger fired by a damage sub-step found
       * `battleMode` false, took the `'resolve'` branch and was built, aimed
       * and resolved to completion with nobody able to answer it. The owner
       * moved every damage-caused trigger to after combat instead, so nothing
       * reaches this line with `battle.damageStep` set at all: settle()'s CR 608.9b
       * hold returns before `processTriggerQueue` is ever called. In battle,
       * battle IS stack mode — damage and death triggers included.
       */
      const battleMode = this.s.phase === 'battle';
      /**
       * CR 507.5, OWNER RULING (report #101, room SMVJ, 2026-08-24):
       * *"Deployment should use the stack."*
       *
       * Before this, `battleMode` was the ONLY way onto the stack and every
       * deployment trigger took the `'resolve'` branch instead: it was built,
       * aimed and resolved to completion, one at a time, before the next one
       * was even looked at. That is what the owner was complaining about —
       * with four Wraiths at the start of deployment the first counter could
       * kill the ally and the remaining three were then re-aimed at whatever
       * was still standing, because each was aimed only at the moment it ran.
       * A pile of triggers that never coexists cannot be a pile.
       *
       * The ORDER is unchanged, deliberately. Immediate mode resolves NIT's
       * queue first then IT's, front to back; stack mode pushes each seat's
       * queue in REVERSE (so its front ends up on top) with NIT's pushed last
       * (so NIT's is above IT's) — and pops FILO. Both spell exactly the same
       * resolution order, which is what keeps CR 706.5, the seeded replay and every
       * existing deployment test saying what they said before.
       *
       * NOT taxed: `gateTaxedTrigger` below stays keyed on `battleMode`. CR 505.1b
       * is Crevice Lurker's "during battle" clause and deployment is not
       * battle; routing deployment through the stack must not invent a tax the
       * card does not print.
       *
       * Nobody may RESPOND to a deployment stack: deployment is a hidden
       * simultaneous segment with no priority windows at all. `settle()` drains
       * the deployment stack itself, at the first safe point, top down.
       */
      const stackMode = battleMode || this.s.phase === 'deploy';
      const itQ = this.s.triggerQueue.filter(t => t.controller === this.initiative && mineOnly(t));
      const nitQ = this.s.triggerQueue.filter(t => t.controller === this.nit && mineOnly(t));
      const next = stackMode
        ? (itQ.length ? itQ[itQ.length - 1]! : nitQ[nitQ.length - 1]!)
        : (nitQ.length ? nitQ[0]! : itQ[0]!);
      this.s.triggerQueue.splice(this.s.triggerQueue.indexOf(next), 1);
      // CR 111.10g: the pay-to-trigger gate — ONE choke point for every trigger
      // headed to the stack (card triggers, augment-donated triggers and CR 400.5
      // zone triggers alike; never per-card). Only battleMode triggers pass
      // through it: outside battle the taxing card's own "during battle"
      // clause zeroes the tax anyway, and deployment is not battle.
      // ⚠ HOLDING DAMAGE TRIGGERS TO AFTER COMBAT WIDENED WHAT THIS TAXES (CR 608.9d),
      // and that is intended. Combat-damage
      // and combat-death triggers used to slip past with `battleMode` false;
      // they now arrive here with `damageStep` already null and ARE taxed.
      // Crevice Lurker prints "Abilities cost [one] more to activate or
      // trigger during battle" and combat damage is during battle, so the
      // printed text was always the wider one — the exemption was an artefact
      // of where the queue drained, not a reading of any card.
      // Bookkeeping listeners whose when() returned false never queued and
      // are untaxed by construction. The gate may suspend (asking the
      // controller to pay) or swallow the trigger (no mana — prevented,
      // announced); `continue` covers the swallowed case.
      if (battleMode && this.gateTaxedTrigger(next)) continue;
      this.stackPendingTrigger(next, stackMode ? 'push' : 'resolve');
    }
  }

  /** The build-and-commit tail of processTriggerQueue, split out so the CR 111.10g
   * pay gate can resume a dequeued trigger from doDecide with the queue loop
   * long unwound. */
  stackPendingTrigger(next: PendingTrigger, then: 'push' | 'resolve'): void {
    const item: StackItem = {
      id: this.s.nextId++, kind: 'triggered', card: next.sourceCard, label: next.label,
      controller: next.controller,
      // CR 714.9a: the live source's CURRENT region if it is still in play (it may
      // have moved between firing and resolving), else the region it fired
      // in, and only then the controller's action region. That last fallback
      // used to be the only answer for a dead source, which put every "when
      // I die" trigger in the wrong region (CR 101.6).
      region: this.entity(next.sourceId)?.region ?? next.region ?? this.actionRegion(next.controller),
      negated: false, parts: next.parts, sourceId: next.sourceId, event: next.event,
      // CR 720.6d: which mod donated the text, carried to the EffectCtx
      ...(next.selfModId !== undefined ? { selfModId: next.selfModId } : {}),
      ...(next.lastKnown ? { lastKnown: next.lastKnown } : {}),     // CR 704.7a
    };
    this.collectTargets(item, then, []);
    this.commitItem(item, then);
  }

  /**
   * CR 111.10g: Crevice Lurker's pay-to-trigger gate ("choosing to not pay this
   * prevents the abilities from triggering"). Returns true when the trigger
   * must NOT be stacked here: either it was just prevented outright (its
   * controller has no legal way to pay — announced, never silent), or its
   * controller is being ASKED (suspend throws; doDecide resumes through
   * resumeTriggerGate). THE DECISION IS THE PLAYER'S — with any legal way to
   * pay, the engine never chooses for them; only the zero-mana case skips
   * the prompt, because a question with one legal answer is not a question.
   */
  private gateTaxedTrigger(t: PendingTrigger): boolean {
    const region = this.entity(t.sourceId)?.region ?? t.region ?? this.actionRegion(t.controller);
    const { total: tax, byCard } = this.abilityTax(t.controller, t.sourceCard, region, 'trigger');
    if (tax <= 0) return false;
    const taxers = byCard.join(', ');
    if (this.openMana(t.controller) < tax) {
      // CR 109.9b: "no offer could be made at all" — the bounded reservation
      // composeParts wrote at queue time goes back.
      this.refundTriggerBudgets(t);
      this.ev('info',
        `${t.label} — the trigger is prevented: ${taxers} taxes it [${tax}] and the mana is not there.`,
        { seat: t.controller, region, prevented: true, tax });
      return true;
    }
    this.suspend({ type: 'payTrigger', trigger: t, tax }, {
      seat: t.controller, kind: 'payOrDecline',
      prompt: `${taxers} taxes the trigger [${tax}] — pay to let "${t.label}" happen?`,
      options: [
        { label: `Pay [${tax}]`, value: true },
        { label: 'Decline (the trigger does not happen)', value: false },
      ],
    });
  }

  /** CR 111.10g: the answer to a pay-to-trigger question. Pay: charge the tax and
   * stack the trigger exactly where processTriggerQueue left off. Decline:
   * the trigger simply does not happen — and does NOT spend its [once]
   * (CR 109.9b: declining never spends it; the reservation goes back).
   * settle() then drains whatever else the queue still holds. */
  resumeTriggerGate(t: PendingTrigger, tax: number, pay: boolean): void {
    if (pay) {
      this.payMana(t.controller, tax);
      this.ev('info',
        `${this.pname(t.controller)} pays the [${tax}] tax — ${t.label} goes on the stack.`,
        { seat: t.controller, tax });
      this.stackPendingTrigger(t, 'push');
    } else {
      this.refundTriggerBudgets(t);
      this.ev('info',
        `${this.pname(t.controller)} declines to pay [${tax}] — ${t.label} is prevented.`,
        { seat: t.controller, prevented: true });
    }
    this.settle();
  }

  /** CR 111.10h, 109.9b: hand back the bounded reservations composeParts wrote
   * for a trigger that is now NOT happening (declined or unpayable at the
   * pay gate). refundPart's bookkeeping keyed off the PendingTrigger instead
   * of a StackItem — a mod-donated part's budget lives on the mod under
   * 'graft', everything else on the source under the part's own effectKey. A
   * zone trigger's stand-in source was never in s.entities, so there is
   * nothing to refund onto and this is correctly a no-op for it. */
  private refundTriggerBudgets(t: PendingTrigger): void {
    for (const part of t.parts) {
      const holder = part.fromMod !== undefined ? this.entity(part.fromMod) : this.entity(t.sourceId);
      if (!holder) continue;
      const key = part.fromMod !== undefined ? 'graft' : part.effectKey;
      if ((holder.budgets[key] ?? 0) <= 0) continue;
      delete holder.budgets[key];
    }
  }

  /** safe point: state-based actions + trigger queue, until stable */
  settle(): void {
    for (let i = 0; i < 100; i++) {
      this.checkDeaths();
      // CR 803.7g: latch any prophecy the last mutation just fulfilled. settle() is
      // the general safe point, so it covers the state-based conditions (life
      // totals, units in play); the counting ones latch at their own moments
      // (startTurn / endBattleRound / end of the haste step).
      this.refreshProphecies();
      this.markFrame();   // a no-op unless a client asked to watch (see `frames`)
      /**
       * CR D2.1a: A PENDING QUESTION STOPS THE WORLD — for everyone.
       *
       * Two lines below already say this for their own piece of business:
       * the deployment stack drain is guarded `&& !this.s.decision`, and the
       * combat-damage pump opens `if (this.s.decision || …) return`. The
       * trigger queue never needed it, because before the gate became seat-aware nothing could run
       * at all while a decision was open — apply()'s gate refused every
       * action from BOTH seats, so settle() was only ever entered with the
       * slot empty.
       *
       * CR D2.1b lets the other seat act inside a hidden simultaneous segment,
       * and their action reaches settle() with somebody else's question open.
       * Without this line `processTriggerQueue` would drain the ASKING seat's
       * trigger batch on the acting seat's tick — building, aiming and
       * resolving triggers whose owner is in the middle of being asked
       * something about them, and (worse) re-entering `suspend`, which would
       * overwrite the open decision.
       *
       * `checkDeaths` and `refreshProphecies` stay ABOVE the line on purpose:
       * they are state-based bookkeeping with no choices in them, and a unit
       * the acting seat just killed must die now. What they queue simply
       * waits, exactly like anything else the batch is holding.
       */
      if (this.s.decision) {
        // CR 703.7, 507.5a: …EXCEPT IN DEPLOYMENT, WHERE THERE ARE TWO WORLDS.
        // The owner, 2026-09-01: deployment uses the stack, but "it's an
        // isolated stack just for the person in that region … the two players
        // are, essentially, playing different games during deployment". So a
        // question open for the OTHER seat is none of this seat's business,
        // and the line above — correct in battle, where both seats are in the
        // same game — is the one that made a deployment play wait on it.
        const solo = this.deployIsolate();
        if (solo !== null) this.settleDeploySeat(solo);
        return;
      }
      // CT-174(b): the revealing moment has ended — no question is open, so
      // the effect that looked at the hand has stopped moving cards out of it.
      // Deliberately BELOW the open-decision guard (a snapshot must not be finished
      // while the very effect that took it is still asking its owner which
      // card to discard) and ABOVE the CR 608.9b hold (an Eldritch Dreamtender look
      // is a combat-damage trigger, and its moment ends inside that hold).
      // Idempotent: it clears `pending`, so the settle loop's other passes and
      // every later settle are no-ops.
      this.settleSeenHands();
      /**
       * CR 608.9b: HOLD THE TRIGGER QUEUE THROUGH THE COMBAT DAMAGE SUB-STEPS.
       *
       * The owner (2026-08-30, round-32 Q1): *"all triggers that are caused by
       * damage get moved to 'After combat', along with anything that triggers
       * then."* So while `battle.damageStep` is set, this safe point does the
       * state-based half above (deaths, promotion, prophecies) and then does
       * NOT touch the queue — it hands control back to the pump, which walks
       * to the 'after' sub-step and drains the whole held batch there, with
       * `damageStep` null, `battleMode` true and the afterCombat triggers in
       * the same batch.
       *
       * This is the ONE choke point, deliberately: the pump is not the only
       * thing that reaches settle() mid-damage. A CR 608.6a elective-assign answer
       * or a CR 111.10g pay answer resumes through `doDecide` → settle() with a
       * sub-step half-run, and before this guard existed each of those would
       * have drained the held batch on the way past. Guarding the pump alone
       * would have left three back doors open.
       *
       * `pumping` keeps the re-entry honest: when settle() was called FROM the
       * pump, the pump owns the loop and simply continues when this returns.
       */
      if (this.s.battle?.damageStep) {
        if (!this.pumping && !this.s.stack.length) this.pumpCombatDamage();
        return;
      }
      if (!this.s.triggerQueue.length) {
        /**
         * CR 507.5: DRAIN THE DEPLOYMENT STACK.
         *
         * In battle the stack is drained by priority — two passes resolve the
         * top item — because a battle stack exists so that people may respond
         * to it. Deployment has no priority windows and no responses (it is a
         * hidden simultaneous segment: see server/view.ts), so its stack is
         * drained here, at the same safe point everything else outside battle
         * uses, top down. The trigger queue is empty by the time this runs, so
         * every trigger of the batch is already ON the stack and aimed — which
         * is the whole point of the owner's ruling.
         *
         * ONE item, then return: `resolveTop` ends in `finishResolutionTail`,
         * which settles again, so the rest of the stack drains through the
         * same door — and a trigger that the resolution itself queues (a
         * Wraith dying to its own counter) is picked up by that inner settle
         * and lands ON TOP of what is left, resolving before it, as a stack
         * must. A mid-resolution decision throws clean out of here and
         * `doDecide` resumes into `finishResolutionTail` → `settle`, i.e. back
         * to this line with one fewer item.
         */
        if (this.s.phase === 'deploy' && this.s.stack.length && !this.s.decision) {
          this.resolveTop();
          return;
        }
        // resuming a suspended combat-damage pump used to live HERE,
        // reachable only with the queue already empty. It now lives in the
        // CR 608.9b hold above, which is reached whether the queue is empty or
        // not — a sub-step suspended by a CR 608.6a election or a CR 111.10g pay
        // question may well have a held batch waiting behind it.
        this.finishDeployStart();   // CR 507.4: resume a suspended rot-damage opening
        this.finishHasteEnd();   // CR 504.6: resume a suspended end-of-haste window
        this.finishTurnEnd();
        return;
      }
      this.processTriggerQueue();
    }
    throw new Error('settle() did not stabilize — trigger loop?');
  }

  // ── priority & battle steps ─────────────────────────────────────────
  openPriority(step: BattleState['step']): void {
    this.s.battle!.step = step;
    this.s.priority = this.initiative;   // initiative acts first in every window
    this.s.passes = 0;
  }

  passPriority(seat: Seat): void {
    this.need(this.s.decision === null, 'answer the pending decision first');
    this.need(this.s.phase === 'battle' && seat === this.s.priority, 'you do not have priority');
    this.s.passes++;
    if (this.s.passes < 2) {
      this.s.priority = other(seat);
      return;
    }
    if (this.s.stack.length) {
      this.resolveTop();
    } else {
      this.advanceBattleStep();
    }
  }

  advanceBattleStep(): void {
    const b = this.s.battle!;
    this.s.priority = null;
    if (b.step === 'attackWindow') {
      b.step = 'blocks';
      this.ev('phase', `${this.pname(b.defender)} declares blocks.`, { step: 'blocks' });
    } else if (b.step === 'blockWindow') {
      this.ev('combatDamage', 'Combat damage (simultaneous):', { region: b.region });
      // CR 608.3d: fixed ONCE, here, before a single point of damage is dealt —
      // see the `damageSubs` field doc for why it must not be recomputed.
      b.damageSubs = this.subStepsWithStrikes(b);
      b.damageStep = 'Swift';
      this.pumpCombatDamage();
    } else if (b.step === 'damageWindow') {
      // CR 608.3b: the window between two damage sub-steps has closed. Everything
      // the last sub-step queued is resolved and off the stack; the next
      // sub-step deals its damage into the board that left behind.
      const next = b.pendingSub ?? 'after';
      b.pendingSub = null;
      b.damageStep = next;
      this.pumpCombatDamage();
    } else if (b.step === 'afterWindow') {
      this.endBattleRound();
    }
  }

  /** CR 608.3: which of the three damage sub-steps have a column actually
   * striking in them. Two or more and the damage step is SPLIT — each is a
   * real step with priority between them. The walk is `assignCombatDamage`'s
   * own, asked of all three sub-steps instead of one, so a sub-step counts
   * here exactly when that method would deal damage in it. */
  private subStepsWithStrikes(b: BattleState): DamageSubStep[] {
    const ALL = ['Swift', 'normal', 'Sluggish'] as const;
    // CR 606.4f: a blocking column strikes only with an attacker in front of it, so
    // a side-block (and a CR 608.4e hole) opens no damage window of its own
    return ALL.filter(sub => b.columns.some((_col, ci) => {
      const x = this.exchangeAt(b, ci);
      return (x.atk.length > 0 && this.strikes(b, 'atk', ci, x.atk, sub, x.pure))
        || (x.blk.length > 0 && x.atk.length > 0 && this.strikes(b, 'blk', ci, x.blk, sub, x.pure));
    }));
  }

  // ── combat ──────────────────────────────────────────────────────────
  private pumping = false;

  /**
   * Simultaneous damage in three sub-steps: Swift → normal → Sluggish, then
   * 'after'. Formation changes recalc between sub-steps but nobody gets
   * priority (CR 608.3e, which stands).
   *
   * CR 608.9b (owner, 2026-08-30, round-32 Q1) — **NOTHING TRIGGERED BY COMBAT
   * DAMAGE RESOLVES DURING THE DAMAGE STEP.**
   *
   * > *"If there are no units in combat with sluggish or [swift], there will
   * > be no triggers during the damage step. Instead, all triggers that are
   * > caused by damage get moved to 'After combat', along with anything that
   * > triggers then."*
   *
   * ⚠ THE LINE THAT USED TO BE HERE WAS `if (this.s.triggerQueue.length) {
   * this.settle(); continue; }` — it drained the queue BETWEEN sub-steps,
   * with `battle.damageStep` still set, which left `processTriggerQueue`'s
   * `battleMode` false and sent every damage trigger down the `'resolve'`
   * branch: built, aimed and resolved to completion, never on the stack,
   * never respondable, never taxed. That line is gone. The queue is now HELD
   * across every sub-step (`settle()` refuses to drain it while `damageStep`
   * is set — see the CR 608.9b guard there) and drains in the `'after'` branch
   * below, where `damageStep` is already null, `battleMode` is true and the
   * afterCombat triggers are in the SAME batch. That is the RAQ's stack.
   *
   * ⚠ WHAT DID NOT MOVE. `checkDeaths()` still runs between sub-steps: deaths,
   * promotion and formation recalculation are state-based bookkeeping with no
   * choices in them and CR 608.3e still demands them immediately. Only the TRIGGER
   * QUEUE waits — the "when I die" triggers those deaths queue are held with
   * everything else, which is exactly what the RAQ names.
   *
   * A trigger decision suspends the pump; settle() resumes it (same pattern as
   * finishTurnEnd).
   */
  pumpCombatDamage(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const b = this.s.battle;
      if (!b) return;
      while (b.damageStep) {
        if (this.s.decision || this.s.stack.length) return;
        if (b.damageStep === 'after') {
          b.damageStep = null;
          const ev = this.ev('afterCombat', 'After-combat step.', { region: b.region });
          this.fireEvent('afterCombat', ev);
          this.openPriority('afterWindow');
          this.settle();
          return;
        }
        const sub = b.damageStep;
        this.combatSubStep(sub);
        this.checkDeaths();   // deaths + promotion between sub-steps, no priority (CR 608.3e)
        const next = sub === 'Swift' ? 'normal' : sub === 'normal' ? 'Sluggish' : 'after';
        /**
         * CR 608.3b — A SPLIT DAMAGE STEP IS SEVERAL STEPS, and this is the
         * boundary between two of them.
         *
         * The owner's quote carried the condition and the implementation dropped it: *"**If there are no units in combat with sluggish or
         * [swift]**, there will be no triggers during the damage step."* With
         * a Swift or Sluggish column on the board there ARE triggers during
         * the damage step — each sub-step is a step, and what it fired
         * resolves before the next one deals damage.
         *
         * Playtest report #165 (room KAWJ, 2026-09-15) is the cost of the
         * missing condition. Bripp and Bloated Manablub dealt 6 to the face
         * in the normal sub-step; {Sluggish} Adversary of the Deep, whose
         * whole reason for being Sluggish is *"[Augment] Whenever a player
         * loses life, put that many +1/+1 counters on me"*, then struck as a
         * printed 2/2 because its own trigger was still held. The owner,
         * 2026-09-16: *"The reason that the Adversary of the Deep has
         * sluggish is so that it gets its counters BEFORE dealing damage. So
         * there should have been 6 damage from the normal units, then the
         * trigger and resolution (allowing for responses and priority and
         * everything), then the adversary does 8 damage to Karanda."*
         *
         * The handover is deliberately shaped like the 'after' branch above,
         * because it wants the identical machinery: `damageStep` is nulled
         * FIRST, which is the whole of what settle()'s CR 608.9b guard reads, so
         * the held batch drains with `battleMode` true — on the stack, aimed,
         * respondable, past the CR 111.10g pay gate. `pendingSub` is where the pump
         * comes back to when `advanceBattleStep` closes the window.
         *
         * Two conditions, not one. `struckNow` — an empty sub-step queued
         * nothing and has nothing to offer a window for. `moreLater` — the
         * last striking sub-step hands to 'after', which already opens a
         * window of its own; offering one here too would be two priority
         * rounds with no damage between them. Together they mean an ordinary
         * battle (every column in the normal sub-step) sees NO new window and
         * behaves exactly as an unsplit step does (CR 608.3a).
         */
        const subs = b.damageSubs ?? [];
        const ORDER = ['Swift', 'normal', 'Sluggish'] as const;
        const struckNow = subs.includes(sub);
        const moreLater = subs.some(s => ORDER.indexOf(s) > ORDER.indexOf(sub));
        if (struckNow && moreLater) {
          b.damageStep = null;
          b.pendingSub = next;
          this.ev('phase',
            `${sub === 'Swift' ? 'Swift' : 'Normal'} damage is dealt — responses before `
            + `${next === 'Sluggish' ? 'Sluggish' : 'normal'} damage.`,
            { step: 'damageWindow', region: b.region });
          this.openPriority('damageWindow');
          this.settle();
          return;
        }
        b.damageStep = next;
      }
    } finally { this.pumping = false; }
  }

  /**
   * CR 608.2e — does this SIDE of column `ci` strike in `sub`? `scheduled()`'s
   * attribute answer, less what the column has already done. The RAQ
   * ("Swift/Normal/Sluggish"), _passer: *"If a column dealt swift damage, it
   * won't deal normal damage. If a column dealt normal damage it won't deal
   * sluggish damage."* The mark is the COLUMN's: a Swift column whose Swift
   * unit is removed is still marked, and so is a Tiderunner played into it
   * once it is emptied. A Swift column may still gain Sluggish and strike
   * again ("for effective doublestrike") — a Swift mark bars only `normal`.
   */
  private strikes(b: BattleState, side: 'atk' | 'blk', ci: number, colIds: EntityId[],
    sub: DamageSubStep, pure: boolean): boolean {
    if (!this.scheduled(colIds, sub, pure)) return false;
    const done = b.struck?.[`${side}:${ci}`] ?? [];
    if (sub === 'normal' && done.includes('Swift')) return false;
    if (sub === 'Sluggish' && done.includes('normal')) return false;
    return true;
  }

  /** CR 608.2e: column `ci`'s `side` struck in `sub` — remember it for the battle */
  private markStruck(b: BattleState, side: 'atk' | 'blk', ci: number, sub: DamageSubStep): void {
    const struck = (b.struck ??= {});
    const key = `${side}:${ci}`;
    const done = struck[key] ?? [];
    if (!done.includes(sub)) struck[key] = [...done, sub];
  }

  private scheduled(colIds: EntityId[], sub: DamageSubStep,
    suppressed = false): boolean {
    // CR 608.2d {Pure}: an attribute-blind exchange has no Swift or Sluggish in it,
    // so it strikes in the normal sub-step whatever the column is printed with
    const attrs = suppressed ? new Set<string>() : this.colAttrs(colIds);
    if (sub === 'Swift') return attrs.has('Swift');
    if (sub === 'Sluggish') return attrs.has('Sluggish');
    return !attrs.has('Swift') && !attrs.has('Sluggish');
  }

  /**
   * CR 608.9a, 608.2c: EVERY combat-damage sub-step `u`'s column strikes in, in
   * running order, or `[]` when `u` is not in a column at all.
   *
   * The owner's ruling (2026-08-23): a "when my column deals combat damage"
   * trigger fires in the sub-step its OWN COLUMN strikes in. A {Swift} column
   * fires in the Swift sub-step; every other column fires in the normal one.
   * Card code could not ask that before, and it needed to: `commitPlayerDamage`
   * aggregates EVERY connecting column's face damage into one `loseLife` per
   * seat per sub-step, so a Dreamtender in a normal column heard the Swift
   * sub-step's `lifeLost` and sacrificed itself a sub-step early whenever any
   * Swift column also connected.
   *
   * CR 608.2c (owner, 2026-08-25) is why this is a LIST and not one answer:
   * *"Both apply. It's Algomancy's answer to double strike. A Swift+Sluggish
   * unit that's in combat with a normal unit will (potentially, assuming they
   * all survive all damage) end up having damage done in all three sub damage
   * steps."* `scheduled()` has always said true for BOTH sub-steps of a
   * {Swift}{Sluggish} column — the damage lands twice and that is correct —
   * but the singular `combatSubStepOf` below stopped at the first match, so
   * a Rime Wraith column's triggers fired once while its damage landed twice.
   *
   * The answer is `scheduled()`'s, asked over the three sub-steps in order,
   * with the pairing's `pure` threaded in the way `assignCombatDamage` threads
   * it, because CR 608.2d {Pure} collapses a whole exchange (both sides, in both
   * directions) into the normal sub-step whatever the columns are printed
   * with. Reconstructing `pure` here rather than reading the column's own
   * attributes is the entire reason this is an engine method and not three
   * lines of card code.
   *
   * ⚠ Ask it from `when()`, not from `run()` — see `strikesInCurrentSubStep`.
   */
  combatSubStepsOf(u: Entity): DamageSubStep[] {
    const b = this.s.battle;
    if (!b) return [];
    const alive = (ids: EntityId[]) => ids.filter(id => this.entity(id));
    let mine: EntityId[] | null = null;
    let pure = false;
    let side: 'atk' | 'blk' = 'atk', at = -1;
    const ci = b.columns.findIndex(col => col.includes(u.id));
    if (ci !== -1) {
      at = ci;
      // attacker side, read the way assignCombatDamage reads it: `blockedEver`
      // is "b.blocks[ci] exists", and an unblocked column pairs against nothing
      const atk = alive(b.columns[ci]!);
      const blk = b.blocks[ci] !== undefined ? alive(b.blocks[ci]!) : [];
      mine = atk;
      pure = this.pure(atk, blk);
    } else {
      for (const [key, col] of Object.entries(b.blocks)) {
        if (!col.includes(u.id)) continue;
        const blk = alive(col);
        const atk = alive(b.columns[Number(key)] ?? []);
        // CR 606.4f: a side-block has nothing in front of it, so it never strikes
        if (!atk.length) return [];
        mine = blk;
        pure = this.pure(atk, blk);
        side = 'blk'; at = Number(key);
        break;
      }
    }
    if (!mine) return [];
    // CR 608.2e: less the sub-steps the column's own marks bar
    return (['Swift', 'normal', 'Sluggish'] as const)
      .filter(sub => this.strikes(b, side, at, mine!, sub, pure));
  }

  /**
   * CR 608.9a, singular: the FIRST sub-step `u`'s column strikes in, or null when it
   * is in no column. Kept as the readable one-answer form for the ordinary
   * column, which strikes in exactly one sub-step.
   *
   * ⚠ LOSSY, by CR 608.2c: a {Swift}{Sluggish} column strikes in TWO sub-steps
   * and this reports only the Swift one. Card text must never gate on it —
   * `strikesInCurrentSubStep` (which reads the full list) is the gate.
   */
  combatSubStepOf(u: Entity): DamageSubStep | null {
    return this.combatSubStepsOf(u)[0] ?? null;
  }

  /**
   * CR 608.9a, as card text asks it: is the sub-step running RIGHT NOW one that
   * `u`'s column strikes in? The one shared gate behind every "when my column
   * deals combat damage" trigger — reached through `columnDealtCombatDamage`
   * by Zephyrzoa, Vroot, Eldritch Dreamtender, Blightmound, Amphivore,
   * Rippleback Skulker, Flowstone Arcanite and Bloodwind Revenant (the per-column attribution fix put
   * the last four through it too).
   *
   * CR 608.9a: "is one that", not "is the one" — a {Swift}{Sluggish} column
   * strikes in both the Swift and the Sluggish sub-step, so its triggers fire
   * in both, matching the damage that really lands in both.
   *
   * ⚠ TIMING — this is only true inside `when()`. `when()` is evaluated at
   * event time (CR 109.3a), which is inside `combatSubStep(sub)`, and `b.damageStep`
   * is advanced only AFTER `combatSubStep` returns — so it reads the CURRENT
   * sub-step here. Putting this gate in a `run()` would read the wrong
   * sub-step every time. Under CR 608.9b it would not even read a sub-step: the
   * queue is held to the after-combat step and `damageStep` is null by the
   * time any of these triggers RUNS, so this returns false for all of them.
   * It was already wrong there (it used to read the NEXT sub-step); holding the queue to after combat (CR 608.9b) only
   * changed which wrong answer you get.
   *
   * ⚠ WHAT THIS DOES NOT CLOSE — closed by the per-column attribution fix (CR 608.9a), and this note is kept
   * because it says what the sub-step gate is and is not. Face damage still
   * arrives as one aggregated `lifeLost` per seat per sub-step (it is one
   * simultaneous strike and splitting the event would make "when a player
   * loses life" fire once per column), so this gate alone left two of the SAME
   * controller's columns indistinguishable to card text. The per-column attribution fix carried the live
   * column ids onto the ledger and out on the event as `hits` — see
   * `FaceDamageHit`, `faceDamageDealtBy` and `unitsDealingFaceDamage` — so the
   * face channel is now ATTRIBUTION and this is only the timing gate.
   */
  strikesInCurrentSubStep(u: Entity): boolean {
    const b = this.s.battle;
    if (!b || !b.damageStep || b.damageStep === 'after') return false;
    return this.combatSubStepsOf(u).includes(b.damageStep);
  }

  /**
   * CR 608.9a — THE one shared "my column deals combat damage" predicate.
   *
   * Verbatim (Bena, 2026-08-25): *"Only if the other unit in the column has a
   * positive power. 0 power units do no damage. But the other thing in the
   * column can still contribute to the shared column power."*
   *
   * So the gate is the LIVE COLUMN's total power, never the anchor's own: a
   * 0-power anchor standing beside a 2-power ally is in a column that deals
   * combat damage, and its trigger fires. Four cards print this clause and
   * carried four different readings of it — Zephyrzoa and Vroot summed the
   * column (right), Blightmound read `effStats(self)[0]` (the anchor alone),
   * Eldritch Dreamtender had no power gate at all. All four now call this.
   *
   * WHY A CHANNEL PARAMETER RATHER THAN ONE FLAT FUNCTION. Combat damage
   * reaches card code on three different events, and which of them a card is
   * entitled to hear is decided by its PRINTED TEXT, not by this method:
   *
   *  · 'units' — the plain 'damage' event, untagged by `source` (combat, never
   *    effect damage), against a unit in the column directly opposing mine.
   *    Only for text that is not narrowed to a player: Vroot ("my column deals
   *    combat damage") and Blightmound ("when I deal combat damage") hear it;
   *    Zephyrzoa and Eldritch Dreamtender print "to an opponent" and must not.
   *  · 'poison' — RETIRED once Poisonous damage counted as damage dealt, and kept only as a no-op arm so a stale
   *    caller fails loudly in review rather than silently. It existed because
   *    a {Poisonous} column's unit damage arrived as -1/-1 counters with "NO
   *    'damage' event emitted at all", so Blightmound could not hear its own
   *    hits and had to listen on 'countersChanged' instead. That premise is
   *    gone: {Poisonous} is a FORM of dealing damage, not a replacement of it
   *    (Caleb 2025-02-03 / 2026-01-10; see `dealEffectDamageAll`), so both
   *    commits now fire a real 'damage' event carrying `poisonous: true` and
   *    the 'units' arm above hears a poison hit like any other. Leaving the
   *    old arm live would DOUBLE-fire Blightmound, since one hit now produces
   *    both events.
   *  · 'face' — the aggregated combat 'lifeLost' against a seat that is not
   *    mine, of which MY COLUMN dealt a share. All four hear this one.
   *    ⚠ Per-column attribution (CR 608.9a) changed what this arm asks. It used to RECONSTRUCT "my column
   *    connected" from the formation — attacking and never blocked, or
   *    blocked/blocking with {Piercing} — which is a statement about
   *    geometry, not about damage: a {Piercing} pool the blockers absorbed
   *    whole connects and deals nothing, and it would then read another
   *    column's hit as its own. The event now carries the breakdown
   *    (`FaceDamageHit`), so the arm asks `faceDamageDealtBy`.
   *
   * ⚠ `when()` only, because `strikesInCurrentSubStep` is `when()` only.
   */
  columnDealtCombatDamage(self: Entity, ev: EngineEvent,
    channels: readonly ('units' | 'poison' | 'face')[]): boolean {
    const b = this.s.battle;
    if (!b) return false;
    const col = this.columnOf(self.id);
    if (!col) return false;
    // CR 608.9a: only in a sub-step my own column strikes in.
    if (!this.strikesInCurrentSubStep(self)) return false;
    const alive = col.filter(id => this.entity(id));
    // CR 608.9a: the LIVE column's power, not mine. A column whose hitters all
    // died in an earlier sub-step deals nothing either.
    const power = alive.reduce((n, id) => n + Math.max(0, this.effStats(this.entity(id)!)[0]), 0);
    if (power <= 0) return false;
    const ci = b.columns.indexOf(col);
    /** is `uid` in the column mine is paired against? combat damage between
     * units is pairwise, so that is the whole test on both unit channels */
    const opposing = (uid: EntityId | undefined): boolean => {
      if (uid === undefined) return false;
      if (ci !== -1) return !!b.blocks[ci]?.includes(uid);          // attacking: my blockers
      const entry = Object.entries(b.blocks).find(([, c]) => c === col);
      return !!entry && !!b.columns[Number(entry[0])]?.includes(uid);   // blocking: the attackers
    };
    if (ev.type === 'damage') {
      if (!channels.includes('units')) return false;
      if (ev.data?.['source'] !== undefined) return false;          // effect damage, not combat
      return opposing(ev.data?.['unit'] as EntityId | undefined);
    }
    // CR 802.18b: the 'poison' arm is retired (see the channel note above). A
    // 'countersChanged' is no longer evidence that anybody dealt combat
    // damage — the hit that caused it announced itself on 'damage'.
    if (ev.type === 'countersChanged') return false;
    // CR 608.8a: 'combatFaceDamage' is the carrier a face-channel card should
    // listen on — it fires for a hit a replacement consumed as well as
    // for one that cost life. The combat 'lifeLost' is still accepted, because
    // one card printing this clause (Zephyrzoa, batch-hybrids-ld-a) is owned
    // by another agent this wave and still declares `events: ['lifeLost']`;
    // dropping the arm would silence it outright, which is worse than the gap
    // it keeps. A card listing BOTH would fire twice — list one.
    if (ev.type !== 'lifeLost' && ev.type !== 'combatFaceDamage') return false;
    if (!channels.includes('face')) return false;
    if (ev.data?.['why'] !== 'combat') return false;
    const victim = ev.data?.['seat'] as Seat | undefined;
    if (victim === undefined || victim === self.controller) return false;
    // CR 608.9a: ASKED, not reconstructed. The event names the columns that made
    // this loss up, so "did my column connect?" is membership rather than a
    // re-derivation of the formation — and a column that connects but deals
    // NOTHING (a {Piercing} pool the blockers absorbed whole, a strike a
    // shield prevented entirely) is no longer able to claim another column's
    // hit, because it contributed no share to claim.
    return this.faceDamageDealtBy(self, ev) > 0;
  }

  /** CR 608.9a, 608.8a — the per-column breakdown a face-damage event carries, or `[]`
   * for anything else. Both carriers are accepted: 'combatFaceDamage' (CR 608.8a,
   * every hit including the ones a replacement consumed) and the combat
   * 'lifeLost' (CR 608.9a, the hits that cost life). A combat loss with no
   * breakdown means no column is claiming it, which is the same answer as an
   * empty one. */
  combatFaceHits(ev: EngineEvent): FaceDamageHit[] {
    const isFace = ev.type === 'combatFaceDamage'
      || (ev.type === 'lifeLost' && ev.data?.['why'] === 'combat');
    if (!isFace) return [];
    const hits = ev.data?.['hits'];
    return Array.isArray(hits) ? hits as FaceDamageHit[] : [];
  }

  /**
   * CR 608.9a — how much of this combat 'lifeLost' `self`'s OWN COLUMN dealt; 0
   * when it dealt none of it. This is the amount "each opponent gains that
   * much life" (Vroot) is about: the aggregate on the event is every column's
   * total, and a card printed about MY column is owed only my column's share.
   *
   * ⚠ pre-`lifeAmount` (CR 112.3): the shares sum to the raw loss, and the event's
   * `n` is that total after the multiplicative layer. A doubler on the LIFE
   * LOSS is not a doubler on the combat damage a column dealt.
   *
   * ⚠ CR 608.8a: this reads `dealt`, not `amount` — the damage the column DEALT,
   * before a replacement had it. A hit Blightsea Polyp turned into rot is
   * *"still damage. Just not as life"* (owner, 2026-08-28), so Vroot's "that
   * much" is the 4 the column dealt and not the 0 the player lost. On a
   * `lifeLost` the two are equal for every hit that survived to be on it, so
   * this only ever differs on the `combatFaceDamage` event.
   */
  faceDamageDealtBy(self: Entity, ev: EngineEvent): number {
    return this.combatFaceHits(ev)
      .filter(h => h.col.includes(self.id))
      .reduce((n, h) => n + h.dealt, 0);
  }

  /**
   * CR 608.5a — every UNIT that dealt combat damage to a player on this event, in
   * assignment order and deduplicated. Sarcophage's "whenever a unit deals
   * combat damage to a player" asks exactly this, and the printed clause has
   * no "your" in it (owner, 2026-08-24: *"All the cards in Algomancy are
   * pretty literal"*) — so BOTH sides' units are here, whoever was hit.
   *
   * A 0-power passenger is NOT in this list: CR 608.5a, and the owner's *"0 power units do no
   * damage"*. Nor is a member of a column whose damage never reached the
   * player at all.
   */
  unitsDealingFaceDamage(ev: EngineEvent): Entity[] {
    const out: Entity[] = [];
    const seen = new Set<EntityId>();
    for (const h of this.combatFaceHits(ev)) {
      for (const id of h.units) {
        if (seen.has(id)) continue;
        seen.add(id);
        const u = this.entity(id);
        if (u) out.push(u);
      }
    }
    return out;
  }

  /** One sub-step of simultaneous damage, in two halves over one ledger:
   * ASSIGNMENT (every scheduled column's pool is split over its victims into
   * the ledger; nothing is dealt yet) and COMMIT + AFTERMATH (the ledger is
   * dealt to units, then Deadly, Afflicting, Blessed, per-column replacement
   * to players, Lethal and Thieving read it in that order). The order of the
   * aftermath is the rules' order — each step's comment says why it sits
   * where it does — and the ledger lives for exactly this sub-step. */
  private combatSubStep(sub: DamageSubStep): void {
    const b = this.s.battle!;
    // CR 608.6h: elective damage splits are asked for FIRST — before the ledger
    // exists, before any event is emitted — so a suspension here leaves
    // nothing half-done and the sub-step re-enters from scratch when the
    // answer lands (settle() resumes the pump).
    this.collectAssignPlans(b, sub);
    const run = (): void => {
      const b = this.s.battle!;   // re-read: a seam rewind replaces the state
      const L = this.newCombatLedger();
      this.assignCombatDamage(b, sub, L);
      // CR 608.6h: the plans were consumed by the assignment above, and they are
      // meaningless outside their own sub-step (`ci` is only an identity for
      // its length), so they do not outlive it.
      b.assignPlans = undefined;
      const shielded = this.commitUnitDamage(b, L);
      this.sweepDeadly(L, shielded);
      // CR 802.9e {Unaware}: an exchange collapsed to printed stats settles its own
      // deaths, because the state-based sweep reads effStats and would keep a
      // Robot 7 that just fought as a 0/0 alive. Beside sweepDeadly on purpose:
      // both are "this exchange killed something the ordinary check misses".
      this.sweepCollapsedDeaths(L.collapsed);
      this.afflictingAftermath(L);
      this.commitPlayerDamage(b, L);
      this.thievingDraws(L);
    };
    // CR 708.4a: where two Oorblaks, or two Counter Thieves, could each take what
    // this sub-step deals, the sub-step is a seam the player is asked from
    // (`orderSeamRun`). Anywhere else it runs exactly as it always did.
    const mayAsk = this.combatDonorCount(b.region, 'replaceCombatDamageToPlayer') >= 2
      || this.counterDonors(b.region).length >= 2;
    if (mayAsk) this.orderSeamRun('combat', `combat:${sub}`, run);
    else run();
  }

  /** CR 708.4a: how many faces radiate `key` in `region` (see `orderSeamRun`) */
  private combatDonorCount(region: number, key: 'replaceCombatDamageToPlayer'): number {
    return this.donorFaces(this.anchored((h, a) =>
      this.donates(h, a, key) && a.region === region && !this.textStripped(h, a)), key).length;
  }

  /** a fresh ledger (see `CombatLedger` for what each field is for) */
  private newCombatLedger(): CombatLedger {
    return {
      perUnit: new Map(),
      deadlyHit: new Set(),
      thievingDraw: this.s.players.map(() => 0),
      playerHits: [],
      afflicted: new Map(),
      beforeUnits: this.snapshotUnits(),
      collapsed: new Set(),
    };
  }

  /** living members of a column, front-to-back — the one filter both the
   * assignment walk and the CR 608.6a election planner read */
  private aliveInCol(ids: EntityId[]): EntityId[] { return ids.filter(id => this.entity(id)); }

  private colLabel(ids: EntityId[]): string {
    return ids.map(id => this.entity(id)?.card ?? '?').join(' + ') || 'a column';
  }

  private colPower(ids: EntityId[], collapsed: boolean): number {
    return ids.reduce((s, id) => {
      const u = this.entity(id);
      if (!u) return s;
      const [p] = collapsed ? this.printedStats(u) : this.effStats(u);
      return s + Math.max(0, p);
    }, 0);
  }

  /** CR 608.5a, 608.5c: which members of a column actually DEAL its combat damage — the
   * ones `colPower` above counts a positive contribution from, read with the
   * same {Unaware} collapse. CR 608.5a (owner, 2026-08-25) is the whole rule:
   * *"0 power units do no damage. But the other thing in the column can still
   * contribute to the shared column power."* So the COLUMN is the dealer of a
   * column-scoped clause and this list is the dealer of a UNIT-scoped one. */
  private dealersIn(ids: EntityId[], collapsed: boolean): EntityId[] {
    return ids.filter(id => {
      const u = this.entity(id);
      if (!u) return false;
      return (collapsed ? this.printedStats(u) : this.effStats(u))[0] > 0;
    });
  }

  /** the unit in a column that carries `attr` on its OWN (not by column
   * sharing), else the column's first living unit — the source a column-wide
   * attribute's trigger hangs on, so that removing THAT unit is what stops
   * it (the shape of CR 802.15d's Alluring trigger). */
  private attrCarrier(ids: EntityId[], attr: Attr): EntityId | undefined {
    const live = ids.filter(id => this.entity(id));
    return live.find(id => this.ownAttrs(this.entity(id)!).has(attr)) ?? live[0];
  }

  /**
   * CR 802.19a — {RESONANT} IS ITS SOURCE'S TRIGGER, NOT LIFE LOSS.
   *
   * The printed reminder: "Whenever a resonant source deals damage to a unit,
   * it deals that much damage to that unit's controller." The RAQ "[Solved]
   * Resonant, Combat Damage, Conduit and Powerful" reads it as a dealing of
   * DAMAGE by the source, through the stack: "2/4 Resonant Powerful would deal
   * 4 combat damage to enemy unit and then put effect on stack to deal 8
   * damage to enemy face", and with Conduit of Pain "(4+1)x2 = 10". So the
   * rider is queued here as a trigger of the source (held to after combat by
   * CR 608.9b when the hit was combat damage), and resolves as effect damage from
   * that source: Conduit of Pain adds to it, {Powerful} doubles it (CR 802.19e's
   * order), it is a 'damage' event to a player, and Crevice Lurker taxes it
   * like any trigger in battle — Caleb, "[Solved] Trigger-like Attributes vs
   * Crevice Lurker & Containment Protocol": "my intent is for it to stop
   * those from triggering". It was `loseLife` inline until the Resonant fix, which none
   * of those could see.
   *
   * `n` is what the unit RECEIVED ("that much damage") — after {Vulnerable}
   * and after prevention (a fully prevented hit never reaches here: CR 112.11).
   * The effect itself is ability #1 of the synthetic `Alluring Attribute`
   * (apply.ts), for the reason Alluring's is a card: `effectByKey` resolves
   * every stack part through `getCard`.
   */
  queueResonant(srcId: EntityId, controller: Seat, victimSeat: Seat, n: number, region: number, srcName?: CardName): void {
    if (n <= 0) return;
    const sourceCard = this.entity(srcId)?.card ?? srcName;
    if (!sourceCard) return;
    const ev = this.ev('triggered',
      `Trigger: ${sourceCard} — {Resonant}: ${n} damage to ${this.pname(victimSeat)}.`,
      { unit: srcId, region, resonant: { player: victimSeat, n } });
    this.s.triggerQueue.push({
      sourceId: srcId, sourceCard, controller, abilityIndex: 0,
      label: `${sourceCard}: {Resonant}`,
      parts: [{ effectKey: RESONANT_KEY, targets: [] }],
      region, event: ev,
    });
    // a fresh batch: (re)ask the ordering, exactly as fireEvent does
    this.s.triggerOrderedSeats = [];
  }

  /** Powerful column: its whole combat output is doubled at the source, before
   * lethal assignment and Piercing overflow (so a Powerful+Piercing column
   * pierces the doubled amount). */
  private dealtColPower(ids: EntityId[], attrs: Set<string>, collapsed: boolean): number {
    return this.colPower(ids, collapsed) * (attrs.has('Powerful') ? 2 : 1);
  }

  /** One column pairing's shared derivation: who is alive on each side, CR 802.25b
   * {Pure}, the CR 802.9d {Unaware} collapse, and each side's post-Pure attribute
   * set. Extracted so `assignCombatDamage` and the election planner
   * `collectAssignPlans` read the SAME exchange and cannot drift — the
   * planner prices floors with exactly the pools and attributes the
   * assignment will use.
   *
   * CR 802.9d {Unaware}: `collapsed` is the whole exchange's flag, not one
   * column's — if either side carries {Unaware}, BOTH sides deal and receive
   * at their printed numbers ("it looks ONLY at what is the literal printed
   * text on all cards 'involved'"). It is threaded exactly like `pure`, and
   * for the same reason: it is a property of the pairing. Note it survives
   * {Pure} in the engine: the engine switches only the ATTRIBUTE layer off for the exchange and treats this as a stat layer — CR 802.25f says Unaware does not apply in an exchange involving a Pure card (engine differs, CT-260), and
   * this is a stat layer — an Unaware unit's numbers are its printed numbers
   * whether or not anyone is reading its attributes. `unaware` is
   * column-shared, so a vanilla unit standing beside Bubb carries it into the
   * exchange too. */
  private exchangeAt(b: BattleState, ci: number): {
    atk: EntityId[]; blk: EntityId[]; blockedEver: boolean;
    pure: boolean; collapsed: boolean; atkAttrs: Set<string>; blkAttrs: Set<string>;
  } {
    const atk = this.aliveInCol(b.columns[ci] ?? []);
    const blockedEver = b.blocks[ci] !== undefined;
    const blk = blockedEver ? this.aliveInCol(b.blocks[ci]!) : [];
    // CR 802.25b {Pure}: one Pure card in either column blinds the whole exchange
    // to attributes — both sides', in both directions.
    const pure = this.pure(atk, blk);
    const attrsOf = (ids: EntityId[]) => pure ? new Set<string>() : this.colAttrs(ids);
    const collapsed = [...atk, ...blk].some(id => {
      const u = this.entity(id);
      return !!u && this.unaware(u);
    });
    return { atk, blk, blockedEver, pure, collapsed, atkAttrs: attrsOf(atk), blkAttrs: attrsOf(blk) };
  }

  /** CR 608.6b, 608.6c: one victim's PASS-ALONG SHARE — the pool it must be assigned
   * before any may walk on to the unit behind it, and NOT a ceiling on what
   * it may be dealt. {Deadly}'s 1 is the same thing: a FLOOR on the share
   * ("1 pool point suffices to kill"), so the rest is free to pass along; it
   * never means a Deadly column only deals 1. A {Vulnerable} victim receives
   * double, so half the pool is its share (rounded up — CR 608.6e).
   * CR 608.6e: in an exchange collapsed by {Unaware} the victim is priced at the
   * defense PRINTED on its card, so a Robot 7 needs 0 and a counter-laden
   * 1/1 needs 1. The kill itself is `sweepCollapsedDeaths`, because a
   * 0-defense victim is assigned nothing at all here.
   * Shared by the assignment walk and the CR 608.6a election (floors AND option
   * ranges) — one price, one place. `prevPool` is what this sub-step's ledger
   * already assigned the victim (always 0 in practice: a unit stands in one
   * column, so exactly one strike prices it per sub-step; the election walk
   * relies on that and passes 0). */
  private victimShare(u: Entity, prevPool: number, deadly: boolean, pure: boolean, collapsed: boolean): number {
    const mult = (!pure && this.effAttrs(u).has('Vulnerable')) ? 2 : 1;
    const [, t] = collapsed ? this.printedStats(u) : this.effStats(u);
    const recvCap = Math.max(0, t - u.damage - prevPool * mult);   // received still needed to kill
    let poolNeed = Math.ceil(recvCap / mult);
    if (deadly && recvCap > 0) poolNeed = 1;
    return poolNeed;
  }

  /** CR D1.2g: the DEFAULT split, computed without a ledger — shares
   * front-to-back, leftover on the back-most living unit. The same numbers
   * `assignColumnDamage`'s no-plan walk produces (its `prev` is always 0 in
   * combat), used only to label the one-click default option. */
  private defaultSplitAmounts(living: Entity[], amount: number, deadly: boolean, pure: boolean, collapsed: boolean,
    piercing = false): number[] {
    const out = living.map(() => 0);
    let remaining = amount;
    living.forEach((u, i) => {
      if (remaining <= 0) return;
      const a = Math.min(remaining, this.victimShare(u, 0, deadly, pure, collapsed));
      out[i] = a; remaining -= a;
    });
    // a Piercing strike's leftover goes to the player, not the back unit
    if (!piercing && remaining > 0 && out.length) out[out.length - 1]! += remaining;
    return out;
  }

  /** CR 608.6a, 608.6b — the ELECTIVE split (playtest ledger #84, the deferred half): "each
   * player is allowed to split the damage however they want … The only rule is
   * that the front unit must be assigned lethal damage before assigning any to
   * the back unit."
   *
   * One walk, two modes. Both replay the strike's recorded plan
   * (BattleState.assignPlans[key]) over the living victims front-to-back,
   * auto-filling every FORCED step — the last living victim, or a remainder
   * too small to unlock the unit behind it — and stopping at the first real
   * question. With `ask` (the collection pass), an unanswered question
   * suspends ('combatAssign' / 'assignDamage'). Without `ask` it returns the
   * final per-victim pool amounts for `assignColumnDamage`, or undefined when
   * the strike holds no election (the silent default path).
   *
   * CR 802.16c — {PIERCING} IS ELECTIVE TOO (the old split ruling said "automatic, never
   * elective"). RAQ "[Solved] Excessive Combat Damage & interaction with
   * Piercing, Deadly and Phytochemical Protection": the attacker may "overkill
   * the front or back unit, keeping that excess off the player", and "[Solved]
   * Vulnerable + Piercing / Electric": a 10-power Piercing column may put all
   * 10 into a Vulnerable 3/8. So a Piercing strike walks the same floors, but
   * the LAST victim is a question as well (a lone blocker included), and
   * whatever no victim was given goes to the victims' controller. The
   * one-click default is unchanged: lethal to each, the rest to the player.
   *
   * NO election — the silent path, on purpose:
   *  - no living victim, or no pool; fewer than two living victims for a
   *    non-Piercing strike (all of it is the lone unit's).
   *  - pool ≤ the front unit's share: every point is owed to the front, so
   *    every split is forced.
   *  - `def` recorded: the one-click default — undefined on purpose, so the
   *    no-plan walk (the exact pre-election code path) produces the numbers.
   *
   * The options offered are exactly the LEGAL amounts [share .. remaining]:
   * a front unit can never be given less than lethal while anything would go
   * behind it — an illegal split is not refused, it is never shown (the same
   * doctrine as targeting, CR D1.2a). Choosing `remaining` is the reported elective
   * case: ALL of it to the front, none behind, even past lethal. */
  private electionWalk(b: BattleState, key: string, seat: Seat, ids: EntityId[], amount: number,
    srcAttrs: Set<string>, pure: boolean, collapsed: boolean, label: string, ask: boolean): number[] | undefined {
    if (amount <= 0) return undefined;
    const piercing = srcAttrs.has('Piercing');
    const living = ids.map(id => this.entity(id)).filter((u): u is Entity => !!u);
    if (!living.length || (!piercing && living.length < 2)) return undefined;
    const deadly = srcAttrs.has('Deadly');
    const needs = living.map(u => this.victimShare(u, 0, deadly, pure, collapsed));
    if (amount <= needs[0]!) return undefined;
    const plan = b.assignPlans?.[key];
    if (plan?.def) return undefined;
    // CR 802.16b: where a Piercing strike's excess lands — the victims' controller
    const face = this.pname(living[0]!.controller);
    const amounts = living.map(() => 0);
    let remaining = amount, pi = 0;
    for (let i = 0; i < living.length && remaining > 0; i++) {
      const last = i === living.length - 1;
      // without Piercing the last victim takes whatever is left; with it, the
      // rest may stay on the last victim OR go to the player, so it is asked
      if ((last && !piercing) || remaining <= needs[i]!) { amounts[i] = remaining; remaining = 0; break; }
      if (pi < (plan?.picks.length ?? 0)) { amounts[i] = plan!.picks[pi++]!; remaining -= amounts[i]!; continue; }
      // a real question is open for victim i
      if (!ask) return undefined;   // unreachable in practice: collection completes before assignment runs
      const u = living[i]!;
      const options: DecisionOption[] = [];
      if (i === 0) {
        const def = this.defaultSplitAmounts(living, amount, deadly, pure, collapsed, piercing);
        const toFace = amount - def.reduce((a, n) => a + n, 0);
        options.push({
          label: `default — share front-to-back (${def.map((a, j) => `${a} to ${living[j]!.card}`).join(', ')}`
            + `${toFace > 0 ? `, ${toFace} to ${face}` : ''})`,
          value: 'default',
        });
      }
      for (let a = needs[i]!; a <= remaining; a++) {
        const tag = a === needs[i]! && a > 0 ? (deadly ? ' (the {Deadly} floor)' : ' (lethal)')
          : a === remaining ? ' (everything)' : '';
        // CR 802.16c: on a Piercing strike's last victim, what is not kept goes to the player
        const rest = piercing && last && remaining - a > 0 ? `, ${remaining - a} to ${face}` : '';
        options.push({ label: `${a} to ${u.card}${tag}${rest}`, value: a });
      }
      this.suspend({ type: 'combatAssign', seat, key }, {
        seat, kind: 'assignDamage',
        prompt: `${label}: assign combat damage — how much of ${remaining} to ${u.card}? `
          + (piercing
            ? `(units in front must be assigned lethal before any goes behind them; {Piercing}: whatever no unit is given goes to ${face})`
            : '(units in front must be assigned lethal before any goes behind them)'),
        options,
      });
    }
    return amounts;
  }

  /** CR 608.6h — collection pass: raise every elective-split question for this
   * sub-step, one victim at a time, BEFORE the ledger exists and before any
   * event is emitted. `suspend` throws, and the sub-step re-enters from
   * scratch once the answer lands (doDecide records it and settle() resumes
   * the pump) — the same no-mutation-before-suspend discipline as
   * processTriggerQueue's ordering decision, which is what makes the replay
   * deterministic and a JSON round-trip mid-election drivable. The decision
   * belongs to the side DEALING the column's damage: the attacker elects over
   * the blocking column, the defender over the attacking column — BOTH
   * directions multi-assign (a two-unit attacking column is a two-victim
   * strike for its blockers), and both are walked here in the same order the
   * assignment will read them. */
  private collectAssignPlans(b: BattleState, sub: DamageSubStep): void {
    b.columns.forEach((_col, ci) => {
      const x = this.exchangeAt(b, ci);
      if (x.atk.length && x.blk.length && this.strikes(b, 'atk', ci, x.atk, sub, x.pure)) {
        this.electionWalk(b, `${sub}:atk:${ci}`, b.attacker, x.blk,
          this.dealtColPower(x.atk, x.atkAttrs, x.collapsed), x.atkAttrs, x.pure, x.collapsed,
          this.colLabel(x.atk), true);
      }
      if (x.blk.length && x.atk.length && this.strikes(b, 'blk', ci, x.blk, sub, x.pure)) {
        this.electionWalk(b, `${sub}:blk:${ci}`, b.defender, x.atk,
          this.dealtColPower(x.blk, x.blkAttrs, x.collapsed), x.blkAttrs, x.pure, x.collapsed,
          this.colLabel(x.blk), true);
      }
    });
  }

  /** ASSIGNMENT half: walk every column; each side that strikes in this
   * sub-step splits its (Powerful-doubled) power over the opposing column
   * front-to-back into the ledger, and whatever reaches a PLAYER — unblocked,
   * or Piercing overflow — is recorded as a per-column player hit. */
  private assignCombatDamage(b: BattleState, sub: DamageSubStep, L: CombatLedger): void {
    b.columns.forEach((_atkCol, ci) => {
      // the shared derivation (alive sides, {Pure}, the {Unaware} collapse,
      // attrs, column power) lives in exchangeAt / dealtColPower so the CR 608.6a
      // election planner prices EXACTLY what is assigned here
      const { atk, blk, blockedEver, pure, collapsed, atkAttrs, blkAttrs } = this.exchangeAt(b, ci);
      if (collapsed) for (const id of [...atk, ...blk]) L.collapsed.add(id);
      // attacker side
      if (atk.length && this.strikes(b, 'atk', ci, atk, sub, pure)) {
        this.markStruck(b, 'atk', ci, sub);   // CR 608.2e
        const pow = this.dealtColPower(atk, atkAttrs, collapsed);
        // `ci` is only an identity for the length of THIS sub-step. The
        // key is a local bucket label for the afflicting diff below and is
        // never stored, because the formation may collapse (and every index
        // move) before the next sub-step runs.
        const src = { dealer: b.attacker, key: `atk:${ci}`, label: this.colLabel(atk), resonantSrc: this.attrCarrier(atk, 'Resonant') };
        let toPlayer = 0;
        if (blk.length) {
          const left = this.assignColumnDamage(L, blk, pow, atkAttrs, src, pure, collapsed,
            this.electionWalk(b, `${sub}:atk:${ci}`, b.attacker, blk, pow, atkAttrs, pure, collapsed, src.label, false));
          if (atkAttrs.has('Piercing')) toPlayer = left;
        } else if (blockedEver) {
          // blocked stays blocked: only Piercing carries through dead blockers
          if (atkAttrs.has('Piercing')) toPlayer = pow;
          else if (pow > 0) this.ev('info', `Column ${ci + 1} is blocked (blockers gone) — no damage through.`);
        } else {
          toPlayer = pow;
        }
        if (toPlayer > 0) {
          L.playerHits.push({
            seat: b.defender, amount: toPlayer, by: b.attacker, attrs: atkAttrs, label: src.label, pure,
            col: [...atk], dealers: this.dealersIn(atk, collapsed),   // CR 608.9a
          });
          if (atkAttrs.has('Thieving')) L.thievingDraw[b.attacker] = (L.thievingDraw[b.attacker] ?? 0) + 1;
        }
      }
      // blocker side
      if (blk.length && this.strikes(b, 'blk', ci, blk, sub, pure)) {
        // CR 608.4e (Bena 2026-08-21): a blocking column whose attackers are all
        // dead "has nothing to deal damage to, so it doesn't deal damage" —
        // and that INCLUDES Piercing. Piercing is the excess left over after
        // an assignment (CR 802.16b); with nothing to assign to there is no exchange
        // to be the excess of, and the whole power would otherwise wash
        // through to the attacking player.
        //
        // The Manual answers the other half of that ruling by itself — the
        // blocker STAYS because after blocks are declared no column moves —
        // so this is all that is left of it. Note the deliberate asymmetry
        // with CR 802.16e, which is the Manual's own: "the column is considered
        // blocked even if the defending unit is removed during combat", so a
        // Piercing ATTACKER still gets through a dead block. There the attack
        // is still real; here it is the attack that is gone.
        if (!atk.length) {
          const pow = this.dealtColPower(blk, blkAttrs, collapsed);
          // CR 606.4f: a side-block never faced anyone, so it has nothing to report
          if (pow > 0 && !b.sideCols?.includes(ci)) {
            this.ev('info',
              `Column ${ci + 1} has no attackers left — its blockers have nothing to fight.`,
              { region: b.region });
          }
        } else {
          this.markStruck(b, 'blk', ci, sub);   // CR 608.2e
          const src = { dealer: b.defender, key: `blk:${ci}`, label: this.colLabel(blk), resonantSrc: this.attrCarrier(blk, 'Resonant') };
          const blkPow = this.dealtColPower(blk, blkAttrs, collapsed);
          const left = this.assignColumnDamage(L, atk, blkPow, blkAttrs, src, pure, collapsed,
            this.electionWalk(b, `${sub}:blk:${ci}`, b.defender, atk, blkPow, blkAttrs, pure, collapsed, src.label, false));
          if (blkAttrs.has('Piercing') && left > 0) {
            L.playerHits.push({
              seat: b.attacker, amount: left, by: b.defender, attrs: blkAttrs, label: src.label, pure,
              col: [...blk], dealers: this.dealersIn(blk, collapsed),   // CR 608.9a
            });
            if (blkAttrs.has('Thieving')) L.thievingDraw[b.defender] = (L.thievingDraw[b.defender] ?? 0) + 1;
          }
        }
      }
    });
  }

  /** front-to-back assignment (CR 608.6a: the controller's split is elective —
   * `plan` is the elected split when the controller recorded one, and the
   * walk below is the DEFAULT; under CR 802.16c a {Piercing} strike elects too,
   * and its plan's unassigned remainder is the overflow). In the default walk each victim in turn takes its PASS-ALONG
   * SHARE — the pool that would kill it — and whatever is left over walks on;
   * CR 608.6d lands the final leftover on the back-most living unit instead of
   * dropping it. Returns that leftover only for {Piercing} (see the CR 608.6d note
   * below). A Vulnerable victim receives double, so half the pool is its share
   * and the pre-double remainder passes along sooner (CR 802.11c); Deadly's lethal
   * SHARE is 1 (CR 802.3c) — a floor on what passes along, never a cap on what is
   * dealt. */
  private assignColumnDamage(L: CombatLedger, ids: EntityId[], amount: number, srcAttrs: Set<string>,
    src: { dealer: Seat; key: string; label: string; resonantSrc?: EntityId }, pure = false, collapsed = false,
    plan?: number[]): number {
    const deadly = srcAttrs.has('Deadly');
    const poisonous = srcAttrs.has('Poisonous');
    const resonant = srcAttrs.has('Resonant');
    const blessedTo = srcAttrs.has('Blessed') ? src.dealer : undefined;
    /** write one hit into the ledger. Called twice: once for a victim's
     * pass-along share inside the front-to-back walk, and once more for
     * CR 608.6d's leftover onto the back-most unit. The overflow hit is a REAL
     * hit — it carries every flag a share does (Poisonous, Resonant, the
     * source attrs and label, Pure, Blessed, the Deadly mark and the
     * Afflicting bucket), because it is the same column dealing the same
     * damage in the same sub-step. */
    const give = (id: EntityId, a: number): void => {
      const cur = L.perUnit.get(id) ?? { pool: 0, poisonous, resonant };
      cur.pool += a; cur.poisonous = poisonous; cur.resonant = resonant;
      cur.attrs = srcAttrs; cur.label = src.label;   // CR 608.7a
      cur.by = src.dealer;                            // CR 708.8b: who puts a Poisonous hit's counters
      if (resonant && src.resonantSrc !== undefined) { cur.resonantSrc = src.resonantSrc; cur.resonantBy = src.dealer; }   // CR 802.19a
      if (pure) cur.pure = true;
      if (blessedTo !== undefined) { cur.blessedTo = blessedTo; cur.blessedFrom = src.label; }
      L.perUnit.set(id, cur);
      if (deadly) L.deadlyHit.add(id);
      if (srcAttrs.has('Afflicting')) {
        const bucket = L.afflicted.get(src.key)
          ?? { dealer: src.dealer, label: src.label, ids: new Set<EntityId>() };
        bucket.ids.add(id);
        L.afflicted.set(src.key, bucket);
      }
    };
    let remaining = amount;
    if (plan) {
      // CR 608.6a: the controller's ELECTED split, collected by collectAssignPlans
      // before this sub-step touched anything. The floors — every unit in
      // front assigned its pass-along share before anything goes behind it —
      // were enforced when the options were offered (electionWalk never shows
      // an illegal amount), so nothing is re-checked here. Everything
      // downstream of "unit U is assigned K" goes through the same give():
      // Deadly marks, Afflicting buckets, Blessed, Poisonous/Resonant, CR 608.7a
      // prevention and Vulnerable's receive-side doubling are identical
      // between the elected and the default path. A plan assigns the whole
      // pool to units (the ruling deals ALL damage to units) unless the strike
      // is {Piercing} (CR 802.16c): then what the plan did not give a unit is the
      // excess, returned for the caller to send to the player.
      const living = ids.filter(id => this.entity(id));
      let given = 0;
      plan.forEach((a, i) => { if (a > 0 && living[i] !== undefined) { give(living[i]!, a); given += a; } });
      return srcAttrs.has('Piercing') ? Math.max(0, amount - given) : 0;
    }
    for (const id of ids) {
      const u = this.entity(id);
      if (!u || remaining <= 0) continue;
      const prev = L.perUnit.get(id)?.pool ?? 0;
      // the CR 608.6b pass-along share / {Deadly} floor / CR 608.6e printed-defense
      // pricing all live in victimShare — shared with the CR 608.6a election so
      // the floors it offers are the shares this walk pays
      const poolNeed = this.victimShare(u, prev, deadly, pure, collapsed);
      const a = Math.min(remaining, poolNeed);
      if (a > 0) give(id, a);
      remaining -= a;
    }
    // CR 608.6d (Bena 2026-08-23, report #84): "ALL damage is dealt to units, even
    // if it surpasses its defense. The only exception is Piercing, which deals
    // excess to the controller." The follow-up ruling the same day makes the
    // split ELECTIVE — "each player is allowed to split the damage however
    // they want... The only rule is that the front unit must be assigned
    // lethal damage before assigning any to the back unit" — so the leftover
    // may legally land anywhere once every share above it is paid. This is the
    // DEFAULT auto-assignment, and it picks the legal split the rulebook
    // describes ("excess damage beyond the health of the back row unit"): the
    // leftover lands on the back-most living unit rather than evaporating.
    // The player-elective mode is CR 608.6a (`collectAssignPlans` / `electionWalk`):
    // an elected split arrives as `plan` and short-circuits this walk; with no
    // real choice, or the one-click default, THIS remains the split.
    //
    // DELIBERATELY UNCHANGED, so the next reader does not "fix" them:
    //  - {Piercing} still returns `remaining` and the caller sends it to the
    //    face. That is the ruling's own stated exception, not an oversight —
    //    and it is the DEFAULT: CR 802.16c lets the player keep it on a unit
    //    instead, through the election above (`plan`).
    //  - The "blocked, but every blocker died" branch above still drops
    //    non-Piercing power: there is no unit left to deal it to (CR 606.3b, 608.4c, a
    //    separate rule).
    //  - Vulnerable's `mult` is untouched: `remaining` is SOURCE-side pool, so
    //    a Vulnerable back-row unit receives 2 x `remaining`.
    if (remaining > 0 && !srcAttrs.has('Piercing')) {
      const back = [...ids].reverse().find(id => this.entity(id));
      if (back !== undefined) { give(back, remaining); remaining = 0; }
    }
    return remaining;
  }

  /** COMMIT half, units: deal each unit its assigned pool. Vulnerable doubles
   * received; Poisonous replaces it with -1/-1 counters; Resonant riders the
   * same amount onto the unit's controller. Returns the units whose damage
   * was fully prevented (CR 802.3h), which the Deadly sweep must skip. */
  private commitUnitDamage(b: BattleState, L: CombatLedger): Set<EntityId> {
    /** CR 802.3h: units whose damage this sub-step was fully prevented. {Deadly}
     * kills "any combat damage from a deadly unit" — with none dealt there is
     * nothing for it to kill through, exactly as the shield stops Poisonous's
     * counters ("if there is not damage being dealt, then no counters are
     * placed"). Assignment is untouched: RAQ's Deadly + Phytochemical line is
     * "Atleast 1 dmg to Awoken (gets +1/+1, won't create 1/1 unit)", so the
     * 1-point floor is still assigned — it is just never dealt. */
    const shielded = new Set<EntityId>();
    for (const [id, hit] of L.perUnit) {
      const u = this.entity(id);
      if (!u) continue;
      const mult = (!hit.pure && this.effAttrs(u).has('Vulnerable')) ? 2 : 1;
      // CR 708.11b: the choke point, after Vulnerable's doubling (the shield stops
      // "all damage that WOULD BE DEALT") and after every assignment decision.
      const received = this.preventUnitDamage(u, hit.pool * mult, {
        region: b.region, source: hit.label ?? 'combat', combat: true,
        attrs: hit.attrs ?? new Set<string>(), pure: !!hit.pure,
      });
      if (received <= 0) { shielded.add(id); continue; }
      // CR 802.22b {Blessed}: the gain is on the same game-state check as the damage
      if (hit.blessedTo !== undefined) this.blessedGain(hit.blessedTo, received, hit.blessedFrom ?? 'combat');
      // CR 608.7b: the same `lethal` fact the effect-damage path puts on its
      // 'damage' event, computed against the three doors out of this
      // sub-step in the order `combatSubStep` runs them — `sweepDeadly`
      // (CR 802.3d), `sweepCollapsedDeaths` (CR 802.9e, printed defense) and the
      // ordinary state check on effective defense. A listener asking "did I
      // survive this?" (Molten Tormentor) may not read marked damage alone.
      const [, ct] = L.collapsed.has(id) ? this.printedStats(u) : this.effStats(u);
      // CR 802.18a, 802.18b: {Poisonous} is a FORM, not a replacement — see the long note in
      // `dealEffectDamageAll`, which this half must not drift from. The hit is
      // DEALT either way and says so on a 'damage' event; only the mark below
      // differs, and the permanent counters make lethality a question about
      // toughness rather than about marked damage.
      // ONE expression for both forms — see the twin in `dealEffectDamageAll`:
      // how much toughness is left against how much damage is already marked.
      // A marked hit grows `u.damage`; a poison hit shrinks `ct`; `ct <= 0` is
      // folded in because `u.damage` is never negative.
      const lethal = L.deadlyHit.has(id) || ct - received <= u.damage;
      const ev = hit.poisonous
        ? this.ev('damage',
          `Poisonous: ${received} combat damage to ${u.card} becomes ${received} -1/-1 counter(s).`,
          { unit: id, n: received, lethal, poisonous: true })
        : this.ev('damage', `${u.card} takes ${received} (${u.damage + received} total).`,
          { unit: id, n: received, lethal });
      if (!hit.poisonous) u.damage += received;
      this.fireEvent('damage', ev);   // "when I am dealt damage"
      // the MARK: the one line the two forms do not share. After the dispatch,
      // because `addCounters` runs `checkDeaths` and a lethal poison hit would
      // otherwise destroy the victim before it could hear the hit.
      // CR 708.8b: put BY the dealing column's seat (reports #210/#216)
      if (hit.poisonous) this.addCounters(u, -received, hit.by);   // permanent
      // CR 802.19i: the rider is the source's trigger, held to after combat (CR 608.9b)
      if (hit.resonant && hit.resonantSrc !== undefined) {
        this.queueResonant(hit.resonantSrc, hit.resonantBy ?? b.attacker, u.controller, received, b.region);
      }
    }
    // "a +1/+1 counter for each damage prevented", after the whole
    // sub-step is marked (addCounters runs checkDeaths — see the method)
    this.settleDamagePrevention();
    return shielded;
  }

  /** CR 802.3a {Deadly}: any damage from a Deadly column kills — unless none was
   * actually dealt (CR 802.3h `shielded`). */
  private sweepDeadly(L: CombatLedger, shielded: Set<EntityId>): void {
    for (const id of L.deadlyHit) {
      if (shielded.has(id)) continue;   // CR 802.3h: no damage dealt, nothing to kill through
      const u = this.entity(id);
      if (u) {
        this.ev('info', `Deadly — ${u.card} dies.`);
        this.destroy(u, 'dies');
      }
    }
  }

  /** CR 802.23d {Afflicting}: whatever an afflicting column damaged and killed gives
   * its controller a rot, before any life is lost this sub-step. Ordinary
   * combat damage does not kill until the state check, which pumpCombatDamage
   * runs only AFTER this sub-step returns — so run it here first, or a
   * straightforward combat kill would fall outside the diff. Idempotent: the
   * pump's own checkDeaths then finds nothing left to do. */
  private afflictingAftermath(L: CombatLedger): void {
    if (L.afflicted.size) this.checkDeaths();
    for (const bucket of L.afflicted.values()) {
      this.afflictingKills(L.beforeUnits, bucket.label, bucket.ids);
    }
  }

  /** COMMIT half, players: the per-column player hits become life loss —
   * Blessed gains first, then the per-column replacement, then the loss
   * itself, then Lethal. Each step's comment says why it sits where it does. */
  private commitPlayerDamage(b: BattleState, L: CombatLedger): void {
    const playerDmg: number[] = this.s.players.map(() => 0);
    // CR 802.22b, 802.22c {Blessed}: combat damage to a PLAYER gains too, and — the whole
    // point of "same game state check" — it is committed before the lethal
    // check below, so a blessed column can never kill its own controller.
    for (const hit of L.playerHits) {
      if (hit.attrs.has('Blessed')) this.blessedGain(hit.by, hit.amount, hit.label);
    }
    // CR 608.8a (Blightsea Polyp): a per-COLUMN replacement of combat damage to
    // players — "as 1 rot", whatever the column's power. Offered per hit, and
    // a replaced hit still counts as DEALT (Caleb 2024-10-24), which is why
    // Thieving above and Lethal below read playerHits, not playerDmg.
    // CR 608.9a: the ATTRIBUTION carried alongside the aggregate. One `lifeLost`
    // per seat per sub-step is still emitted — splitting it would make "when a
    // player loses life" fire once per column for one simultaneous strike —
    // but the event now says WHICH columns made it up, so card text can stop
    // reconstructing "did my column connect?" from the formation.
    /**
     * CR 608.8a — A REPLACED HIT WAS STILL DEALT, and the breakdown now says so.
     *
     * This loop used to `continue` on a fully replaced hit, so the column that
     * dealt it appeared nowhere: not in `breakdown`, and — since a seat whose
     * whole face damage was replaced loses no life — on no event at all,
     * because `lifeLost` is the only thing that used to carry the attribution
     * and it does not fire for a loss of zero. Both known holders of
     * `replaceCombatDamageToPlayer` (Blightsea Polyp, Oorblak — the complete
     * set, derived from the hook and not typed) consume a hit WHOLE, so that
     * was not an edge: with a Polyp on the board it was every hit, and the
     * "when my column deals combat damage" family went silent for the rest of
     * the battle.
     *
     * The comment that stood here — *"a hit Blightsea Polyp turned into rot
     * dealt the player no combat damage and is not part of what the columns
     * dealt"* — is the divergence itself, written down. It is wrong twice
     * over: the owner, 2026-08-28, *"blightsea pollup says it deals damage as,
     * so its still damage. Just not as life"*, and Caleb before him on
     * 2024-10-24, answering "Is combat damage still applied after this
     * replacement effect?" with *"Yes"* — which is the ruling {Thieving} and
     * {Lethal} already read `playerHits` for, three lines up and three lines
     * down from here. An audit on 2026-08-26 measured this exact gap and filed it
     * *"Reported, not fixed"*; this is the fix.
     *
     * ⚠ PREVENTION IS STILL THE OTHER THING (CR 708.11). A hit a shield stopped was
     * never dealt and is not in `L.playerHits` to begin with — replacement
     * substitutes, prevention subtracts, and nothing here may merge them.
     */
    const breakdown: FaceDamageHit[][] = this.s.players.map(() => []);
    for (const hit of L.playerHits) {
      const left = this.replaceCombatDamage(hit.seat, hit.amount,
        { attacker: hit.by, region: b.region, attrs: hit.attrs, pure: !!hit.pure });
      if (hit.amount > 0) {
        breakdown[hit.seat]!.push({ by: hit.by, dealt: hit.amount, amount: Math.max(0, left),
          col: [...hit.col], units: [...hit.dealers] });
      }
      if (left <= 0) continue;
      playerDmg[hit.seat] = (playerDmg[hit.seat] ?? 0) + left;
    }
    /**
     * CR 608.8a — the face-damage event, fired BEFORE the life is lost because the
     * damage is what causes the loss, and fired whether or not any loss
     * follows. One per victim seat per sub-step, exactly as `lifeLost` is one
     * per seat per sub-step: face damage is one simultaneous strike and
     * splitting it would make every column its own event.
     *
     * `n` is what was DEALT, which is not what was lost — that is the whole
     * content of "still damage, just not as life". `by` is the attacker; with
     * two columns of one seat hitting the same player it is the same seat for
     * both, and `hits` is where the per-column answer lives.
     */
    for (const seat of [this.initiative, this.nit]) {
      const hits = breakdown[seat] ?? [];
      if (!hits.length) continue;
      // `region` rides it for the same reason the combat `lifeLost` carries it
      // (CR 101.6: other regions do not exist) — `fireEvent` scopes its listener
      // scan off exactly this field, and an event without it would be heard
      // across the board.
      const ev = this.ev('combatFaceDamage', '',
        { seat, by: hits[0]!.by, why: 'combat', region: b.region,
          n: hits.reduce((n, h) => n + h.dealt, 0), hits });
      this.fireEvent('combatFaceDamage', ev);
    }
    for (const seat of [this.initiative, this.nit]) {
      const n = playerDmg[seat] ?? 0;
      // the `hits` on a `lifeLost` keep their post-replacement shares summing
      // to the loss it reports (CR 608.9a); `combatFaceDamage` above is where the
      // dealt-but-not-lost half is answerable.
      if (n > 0) this.loseLife(seat, n, 'combat', { hits: breakdown[seat] ?? [] });
    }
    // CR 802.24a {Lethal}: "Any combat damage from a lethal unit will kill a player."
    // Last, because a normal-damage kill above already ended the game (and a
    // {Blessed} gain has already been applied).
    for (const hit of L.playerHits) {
      if (hit.attrs.has('Lethal')) this.killPlayer(hit.seat, `${hit.label} is Lethal`);
    }
  }

  /** Thieving: a column that dealt combat damage to a player draws one card (CR 802.20) */
  private thievingDraws(L: CombatLedger): void {
    for (const seat of [this.initiative, this.nit]) {
      for (let i = 0; i < (L.thievingDraw[seat] ?? 0); i++) {
        this.ev('info', `Thieving: ${this.pname(seat)} draws a card.`);
        this.draw(seat, 1);
      }
    }
  }

  // ── turn structure ──────────────────────────────────────────────────
  startTurn(): void {
    this.s.turn++;
    this.s.phase = 'planning';
    this.expireNextPlayDiscount('planning');   // CR 111.10k errata: the discount lasts ONE phase
    this.s.planningDone = this.s.players.map(() => false);
    this.s.hasteDone = null;
    this.ev('turn', `— Turn ${this.s.turn} (initiative: ${this.pname(this.initiative)}) —`, { turn: this.s.turn });
    for (const p of this.s.players) {
      for (const r of p.resources) if (r.state === 'expended') r.state = 'open';
      p.activationsLeft = ACTIVATIONS_PER_TURN;
      // draft mode: turn 1's draws were dealt with the opening hand (Manual
      // p.16), and later draws go clockwise from initiative like the packs.
      // constructed: the combined draw phase (draw 4, bottom 2) is below.
      // CR 901.7b: 'shared' has no draft step and no draw phase, so this
      // flat 2 IS its card step — the whole of what the turn gives a seat — and
      // it is therefore what `replaceCardStep` replaces here. Owner: *"Shared
      // mode isn't a real thing. You invented it for testing. So I guess it'd
      // be constructed?"* — so a replacement in shared has to reach the same
      // place constructed's does, and it cannot if the hook is never consulted.
      // Consulting it AT the draw (rather than beside startDraftStep /
      // startConstructedDraw at the foot of this method) is what keeps the
      // replaced seat from drawing its 2 and then being handed a third.
      // CR D8.2a: a single card duel takes this same flat 2 in place of the
      // constructed draw phase — bottoming a deck of one card changes nothing.
      if ((this.s.mode === 'shared' || this.s.singleCard) && !this.replaceCardStep(p.seat)) this.draw(p.seat, 2);
      // CR D8.1: a lesson game's card step is its per-seat draw (no bottoming),
      // and its Shard income — the Tutorial Bot's whole economy — pays here.
      const lesson = this.s.lesson;
      if (lesson) {
        if (!this.replaceCardStep(p.seat)) this.draw(p.seat, lesson.drawPerTurn[p.seat]!);
        const n = this.s.turn >= lesson.firstShardTurn ? lesson.shardsPerTurn[p.seat]! : 0;
        for (let i = 0; i < n; i++) p.resources.push({ kind: 'shard', state: lesson.shardState });
        if (n > 0) {
          this.ev('resourceActivated', `${this.pname(p.seat)} gains ${n === 1 ? 'a Shard' : `${n} Shards`} for the turn.`,
            { seat: p.seat, kind: 'shard' });
        }
      }
    }
    if (this.s.mode === 'draft' && this.s.turn > 1) {
      const n = this.s.draftDeal?.draftDraw ?? 2;   // BL-43: a custom deal's draws per turn
      if (n > 0) for (const seat of this.dealOrder()) this.draw(seat, n);
    }
    for (const e of Object.values(this.s.entities)) e.budgets = {};
    // CR 109.9m: the zone-trigger budgets (CARD-TODO #21) are per-turn like every
    // other [once] — wiped beside the Entity.budgets they stand in for.
    this.s.zoneBudgets = {};
    // CR 111.10k + ERRATA 2026-09-21: the discount used to be wiped HERE, because
    // the card read "this TURN". It reads "this PHASE" now, and entering
    // planning is a phase boundary like the other three — so the wipe lives in
    // `expireNextPlayDiscount`, called from all four transitions, and startTurn
    // gets it by way of the `s.phase = 'planning'` above. Not duplicated here:
    // one effect, one reason.
    this.refreshProphecies();   // CR 803.7: "N Turns Pass" ticks here
    if (this.s.mode === 'draft') this.startDraftStep();
    if (this.s.mode === 'constructed' && !this.s.lesson && !this.s.singleCard) this.startConstructedDraw();
  }

  /** Constructed draw phase (Manual "Constructed"): everyone draws 4, then
   * each player puts 2 cards from hand on the bottom of their own deck in any
   * order (the bottomCards action). A seat with nothing to put back (empty
   * deck ran the hand dry) is auto-done.
   *
   * A seat whose card step is replaced (Worldbender) neither draws the 4 nor
   * puts anything back — report #87: "instead of drawing 4 and recycling 2,
   * you draw 2 for turn + 1 for Worldbender and lose 3 life". Constructed has
   * no separate turn draw, so BOTH of those cards come out of the card's own
   * hook; the engine's job here is only to not run the normal step. */
  startConstructedDraw(): void {
    const replaced = this.s.players.map(() => false);
    for (const seat of this.dealOrder()) {
      if (this.replaceCardStep(seat)) { replaced[seat] = true; continue; }
      this.draw(seat, 4);
    }
    const done = this.s.players.map((p, seat) => replaced[seat] || p.hand.length === 0);
    if (done.every(Boolean)) { this.s.bottomDone = null; return; }
    this.s.bottomDone = done;
    this.ev('phase', 'Draw phase: select 2 cards to put on the bottom of your deck.');
  }

  /** `seat` still has to put back their 2 cards this turn */
  bottomPending(seat: Seat): boolean {
    return this.s.mode === 'constructed' && this.s.phase === 'planning'
      && this.s.bottomDone != null && !this.s.bottomDone[seat];
  }

  // ── live draft (Manual p.16-17) ─────────────────────────────────────
  /** clockwise from the initiative player — draw/pack deal order */
  dealOrder(): Seat[] {
    const n = this.s.players.length;
    return this.s.players.map((_, i) => ((this.s.initiative + i) % n) as Seat);
  }

  /** `seat` still has to commit their hand↔pack merge this turn */
  draftPending(seat: Seat): boolean {
    return this.s.mode === 'draft' && this.s.phase === 'planning'
      && this.s.draftDone !== null && !this.s.draftDone[seat];
  }

  /** cards in a pack when it is dealt: 10, or a custom deal's size (BL-43) */
  packSize(): number {
    return this.s.draftDeal?.packSize ?? 10;
  }

  dealPacks(): void {
    this.s.packMeta ??= this.s.players.map(() => null);
    for (const seat of this.dealOrder()) {
      // CR 408.2b: dealing a pack reads the deck like any draw, so it reaches the
      // mark like any draw — the packs recycled at the top of this cycle come
      // back here, shuffled, if the deck has nothing else left to deal.
      this.refillFromRecycled(seat, this.packSize());
      this.s.packs[seat] = this.s.sharedDeck.splice(0, this.packSize());
      this.s.packSerial = (this.s.packSerial ?? 0) + 1;
      this.s.packMeta[seat] = {
        serial: this.s.packSerial,
        originalSize: this.s.packs[seat]!.length,
        commits: 0,
      };
    }
  }

  /**
   * THE CARD STEP REPLACEMENT (playtest report #87, Worldbender).
   *
   * Every format gives a seat cards once per turn, and the shape differs:
   * mode 'draft' opens a draft step (look at your pack, merge, leave 10) on
   * top of the flat 2-card turn draw; mode 'constructed' has no pack and
   * folds the turn draw into its draw phase (draw 4, put 2 back); mode
   * 'shared' — CR 901.7b, and the owner's *"not a real thing … I guess it'd be constructed"* —
   * has neither, so its card step is the bare 2-card turn draw and it is
   * consulted from `startTurn` itself. A card that
   * REPLACES that step therefore cannot be written as "skip and draw one
   * more" in one place — the card has to say what happens instead, per mode,
   * which is exactly what `CardBehavior.replaceCardStep` is for.
   *
   * Returns true when some card took the step over, in which case the caller
   * must NOT run the normal one. First true consumes: two Worldbenders replace
   * the step once, not twice. That is the CR 708.4 chain — once one has
   * skipped the step there is no step left for the other to skip — and since
   * Worldbender is the only holder, the order changes nothing.
   *
   * Anchored like the other replacement hooks — units in play plus augment
   * mods reading from their host — but scoped by CONTROLLER instead of by
   * region: "your draft step" is a turn-structure thing that belongs to a
   * seat, and at the top of a turn there is no battle and so no region to
   * scope to (the reasoning `replaceLifeGain` spells out for life gained
   * outside a battle). CR 712.1a suppression is the full projection, as it is for
   * every other replacement.
   */
  private replaceCardStep(seat: Seat): boolean {
    const holders = this.anchored((h, a) =>
      this.donates(h, a, 'replaceCardStep')                   // CR 710.7: off the FACES
      && a.controller === seat
      && !this.textStripped(h, a));                       // CR 712.1a (full projection)
    holders.sort((a, z) => a.holder.id - z.holder.id);
    for (const { def, anchor } of this.donorFaces(holders, 'replaceCardStep')) {
      if (def.replaceCardStep!(this, anchor, seat)) return true;
    }
    return false;
  }

  /** Open the draft step. After each cycle of N+1 turns (N = players; 1v1:
   * turns 4, 7, …) all packs are first recycled — bottom of the deck in
   * random order — and fresh packs of 10 dealt (see packCycle).
   *
   * A seat whose card step is replaced (Worldbender) never opens: it is
   * marked done before anybody can act — it never looks at its pack — and its
   * pack passes on exactly as it was received. Report #87: "instead of looking
   * at the pack, you draw 2 for turn + 1 for Worldbender". The 2 for the turn
   * are startTurn's; the +1 is the card's, fired from its own hook. */
  startDraftStep(): void {
    const n = this.s.players.length;
    if (this.s.turn > 1 && packCycle(this.s.turn, n).index === 0) {
      // CR 408.2a: a recycled pack goes PAST THE MARK like every other recycled
      // card (owner, 2026-09-16: everything that hits the bottom does), so it
      // is dealt again only once the deck has run out.
      //
      // ⚠ The `shuffle` STAYS even though refillFromRecycled shuffles the
      // whole pile on its way in, so this one is now redundant. Removing it
      // would change how much RNG a draft game consumes at every pack cycle
      // and diverge every saved draft replay for no rules reason at all.
      // Shuffling twice is free; re-seeding four hundred game logs is not.
      const recycled = this.shuffle(this.s.packs.flat());
      for (const name of recycled) this.recycleToBottom(this.dealOrder()[0]!, name);
      this.dealPacks();
      this.ev('draft', `Packs are recycled; everyone is dealt a fresh pack of ${this.packSize()}.`);
    }
    const done = this.s.players.map(() => false);
    this.s.draftDone = done;
    // deal order, so any replacement draw comes off the deck in the same
    // clockwise order everything else at the top of a turn uses
    for (const seat of this.dealOrder()) {
      if (this.replaceCardStep(seat)) done[seat] = true;
    }
    // everyone's step was replaced: it is over before it began, and the packs
    // still pass (skipping the merge is not skipping the pass)
    if (done.every(Boolean)) { this.passPacks(); return; }
    this.ev('draft', `Draft step: combine your hand and pack, then leave exactly ${this.packSize()} cards in the pack.`);
  }

  /** Everyone committed: packs pass clockwise (1v1: they swap). */
  passPacks(): void {
    this.s.draftDone = null;
    const old = this.s.packs;
    const n = old.length;
    this.s.packs = old.map((_, seat) => old[(seat - 1 + n) % n]!);
    if (this.s.packMeta) {
      const oldMeta = this.s.packMeta;
      this.s.packMeta = oldMeta.map((_, seat) => oldMeta[(seat - 1 + n) % n] ?? null);
    }
    this.ev('draft', 'Everyone has drafted — the packs are passed on.');
  }

  /**
   * Manual p.18: after the resource step comes the very short haste step —
   * only {Haste} cards playable, each resolving immediately (planning is not
   * interactive); ends when everyone is done.
   *
   * ⚠ CR 504.5 (owner, 2026-08-28): **THE STEP IS ALWAYS OFFERED.** It used to be
   * skipped outright when no seat had a legal haste play — the earlier optimisation, since reversed,
   * decided here by a local `canHaste` predicate. That skip was two faults at
   * once, and the second is why the first could not simply be patched:
   *
   *  1. IT WAS A SIDE CHANNEL, AT FULL STRENGTH. `hasteDone` is served live
   *     and public BY DESIGN (server/view.ts: "done-flags stay live and public
   *     … 'they are finished' is exactly what you can see across a table"), so
   *     a step that opened only when somebody COULD act published "your
   *     opponent is holding something haste-playable" to a seat whose view of
   *     that hand reads `__HIDDEN__` — and, by being skipped, published the
   *     negative just as loudly. A physical table has no `hasteDone` array;
   *     you watch your opponent think. The repo already held the argument
   *     against itself: `startBattlePhase` fires 'endOfHaste' even on the
   *     skipped path because *an optimisation must not be observable*. This
   *     one was observable. Opening always does not CREATE a channel — it
   *     removes one the client invented as an optimisation — and it is the
   *     whole of the owner's separate "Bluff Haste" request (playtest report
   *     #109), granted as the fix rather than as a new feature: you may now
   *     sit in the step holding nothing, and nobody can tell.
   *
   *  2. THE PREDICATE WAS A HAND-MAINTAINED DUPLICATE of apply.ts's
   *     `castable()` — the shape report #74 already cost us once, after which
   *     the haste-mod permission (`mayApplyModAtHaste`) and the haste-play allowance
   *     (`hastePlayAllowance`) each became THE ONE PREDICATE. `canHaste` was the last haste gate still keeping
   *     its own copy, and the copy disagreed three ways: it judged the
   *     spec-wide `targets` where `castable` judges slot 0 via `specForSlot`,
   *     it treated a min-0 "up to N" spec as NEEDING a candidate where
   *     `castable` lets such a spell be cast at nothing, and it never asked
   *     whether a bracketed [cast cost] / [Gain N debt] was payable.
   *
   *     MEASURED over the whole 494-card pool, one direction was empty and
   *     one was live. Over-permissive ("the step opens with nothing to do"):
   *     population ZERO — every card carrying a `castCost`, a `gainDebt`, a
   *     `noPlayFromHand` or a slotted target spec is {Battle} and so can
   *     never be reached at haste timing (Flesh Tithe is the one non-{Battle}
   *     castCost card, and it is a spell, which no haste-play grant reaches), and
   *     none of the 21 printed {Haste} cards has `targets` or a `castCost` at
   *     all. Under-permissive ("the step is SKIPPED while a playable card
   *     sits in hand"): LIVE, on exactly one card — Eldritch Reclaimer, the
   *     pool's only grant-eligible min-0 spec ("recall target unit in your
   *     bin"). With an empty bin, under Dispatch Courier, this predicate said
   *     no and the step vanished, while `legalActions` would have offered the
   *     play and `apply` would have accepted it. A unit in the bin — and only
   *     a unit; the spec is unit-restricted — opened the same board.
   *
   * DELETING the predicate rather than routing it through `castable()` is
   * what makes the invariant true BY CONSTRUCTION instead of by agreement:
   * there is no second copy left to drift, and the step's presence no longer
   * depends on hand contents at all, so there is nothing left for a copy to
   * be wrong about. The OFFER is still the one predicate — `legalActions`'
   * haste branch, which routes through `castable()`, `mayPlayAtHaste`,
   * `binHasteGrantorIndex` and `hasteModAllowed` — and a seat with nothing to
   * do is served `doneHaste` and nothing else, which is indistinguishable
   * from a seat that is bluffing. That indistinguishability is the point.
   *
   * Nothing replaces `canHaste` anywhere: `hasHasteModAvailable` (its CR 504.8a
   * arm, kept in step with apply.ts's `pushMods` BY HAND, and documented as
   * such) went with it.
   */
  startHasteStep(): void {
    // CR 803.7: a fresh window for "End [Haste] with used mana"
    this.s.hasteManaSpent = this.s.players.map(() => 0);
    // CR 504.7a: and the same fresh window for the printed "Each turn" play budget
    this.s.hastePlaysUsed = this.s.players.map(() => 0);
    // CR 504.5: unconditional. No seat is pre-marked done, because "done" is a
    // thing a PLAYER says, and a step that says it for them is a broadcast.
    this.s.hasteDone = this.s.players.map(() => false);
    this.ev('phase', 'Haste step: haste cards may be played.');
  }

  /**
   * The haste step is over. Two things happen here, in this order, and the
   * order is load-bearing:
   *
   *  1. CR 504.6: the 'endOfHaste' EVENT fires, inside a settle() window, while
   *     `hasteDone` still describes the step that is closing — so "At the end
   *     of [Haste], …" (Keeper of Tithes, Debt Plant) can read the step's own
   *     state, and so CR 803.7's `hasteWithUsedMana` (which requires
   *     `hasteDone === null`) cannot latch early off a trigger's spending.
   *     It fires even in a turn when nobody had a card for the step: the haste step
   *     is part of the turn whether or not anybody had a card for it, and an
   *     optimisation must not be observable.
   *  2. CR 803.7: `hasteDone` is nulled, the prophecy sweep latches "End [Haste]
   *     with used mana" while the tally still describes that window, and the
   *     tally is then zeroed so no later sweep this turn can read it.
   *
   * A trigger from step 1 may suspend on a decision, which would strand the
   * game between the haste step and the battle phase — so the flip is deferred
   * to finishHasteEnd(), which settle() calls at every safe point. Same shape
   * as endTurn()/finishTurnEnd().
   */
  startBattlePhase(): void {
    this.s.hasteEnding = true;
    const ev = this.ev('endOfHaste', 'The haste step ends.', { turn: this.s.turn });
    this.fireEvent('endOfHaste', ev);
    this.settle();            // may suspend; finishHasteEnd() resumes from settle()
    this.finishHasteEnd();
  }

  /** Complete a pending end-of-haste once every trigger/decision has drained
   * (see startBattlePhase). Called from settle() and directly. */
  finishHasteEnd(): void {
    if (!this.s.hasteEnding) return;
    if (this.s.decision || this.s.stack.length || this.s.triggerQueue.length) return;
    this.s.hasteEnding = false;
    this.s.hasteDone = null;
    this.refreshProphecies();
    this.s.hasteManaSpent = this.s.players.map(() => 0);
    this.s.hastePlaysUsed = this.s.players.map(() => 0);   // CR 504.7a, beside its CR 803.7 sibling
    this.s.phase = 'battle';
    this.expireNextPlayDiscount('battle');   // CR 111.10k errata: the discount lasts ONE phase
    this.s.battleCounters = this.s.regions.map(() => ({}));
    this.s.battleRound = 1;
    this.startBattleRound(this.initiative);
  }

  startBattleRound(attacker: Seat): void {
    const defender = other(attacker);
    this.s.battle = {
      round: this.s.battleRound as 1 | 2, attacker, defender,
      region: this.homeRegion(defender), step: 'declare',
      columns: [], blocks: {}, sentAttackers: [], attackerPool: null, happened: false,
    };
    this.s.priority = null;
    this.ev('phase', `Battle: ${this.pname(attacker)} may attack.`, { round: this.s.battleRound });
  }

  endBattleRound(): void {
    const b = this.s.battle!;
    this.s.battle = null;
    this.s.priority = null;
    // CR 803.7: a battle has completed. In 1v1 BOTH the initiative battle and the
    // counterattack battle tick "One Battle Passes" (Caleb 2024-09-24), so
    // every battle ROUND counts — a declined one included: the round happened,
    // it just had no attackers.
    this.s.battlesCompleted = (this.s.battlesCompleted ?? 0) + 1;
    this.refreshProphecies();
    if (this.s.battleRound === 1) {
      // units/tokens NIT sent out during blocks now arrive in IT's region
      for (const id of b.sentAttackers) {
        const u = this.entity(id);
        if (u) { u.absent = false; u.region = this.homeRegion(this.initiative); }
      }
      // CR 610.2e: they exist again, in a NEW region, so this is the first moment
      // their stats can be read — and `checkDeaths` skipped them for as long
      // as they were absent. A counterattacker that arrives already dead (it
      // landed alone and its "+1/+1 per other ally" has nobody to count, or a
      // static in the region it left had zeroed it) dies here, on arrival.
      this.checkDeaths();
      this.s.battleRound = 2;
      this.startBattleRound(this.nit);
      if (b.happened) {
        // NIT committed (or declined) their counterattack at block time
        this.s.battle!.attackerPool = b.sentAttackers;
        if (!b.sentAttackers.length) {
          this.ev('info', `${this.pname(this.nit)} sent no counterattackers — no battle here.`);
          this.endBattleRound();
        }
      }
    } else {
      this.s.battleRound = 0;
      this.startRegroup();
    }
  }

  /** CR 506.2: exact regroup sequence per the Manual (p.7). */
  startRegroup(): void {
    this.s.phase = 'regroup';
    this.expireNextPlayDiscount('regroup');   // CR 111.10k errata: the discount lasts ONE phase
    this.ev('regroup', 'Regroup: everyone returns home; damage, temporary changes and spell tokens are cleaned up.');
    // (1) all units and players return to their regions
    for (const e of Object.values(this.s.entities)) {
      if (e.kind === 'unit') { e.region = this.homeRegion(e.controller); e.absent = false; }
      if (e.kind === 'mod') { const h = e.modOf !== undefined ? this.entity(e.modOf) : undefined; if (h) e.region = h.region; }
      // a spell token comes home too. It never used to matter (every token was
      // erased two steps below), but one that SURVIVES regroup — Harbinger of
      // Immolation — must not be left stranded in the region the battle was
      // fought in: "everyone returns home" is about the board, not just units,
      // and the survival query below is region-scoped like every other static.
      if (e.kind === 'spellToken') e.region = this.homeRegion(e.controller);
    }
    for (const r of this.s.regions) r.presentSeats = [r.owner];
    // (2) all damage on units is removed
    for (const e of Object.values(this.s.entities)) if (e.kind === 'unit') e.damage = 0;
    // (+) spell tokens are erased — unless a live static says YOURS stay
    //     (Harbinger of Immolation, StaticMod.survivesRegroup).
    //
    //     Deliberately BEFORE step (3) rather than after it, which is where
    //     the unconditional erase used to sit. The query reads statics, and
    //     step (3) tears down the until-regroup layers a protector's own state
    //     depends on — most sharply `suppressed`, the CR 712.1a stamp that switches
    //     a silenced Harbinger's abilities (a static IS an ability) off. Read
    //     after the sweep, a Harbinger silenced for the whole battle would
    //     come back to life just in time to save the tokens.
    //
    //     A protected token is spared the ERASE and nothing else: step (3)
    //     runs over every entity, so the survivor's own temporary changes are
    //     still cleaned up. Its `x` — the Fireball's number — is not something
    //     regroup touches at all, so it carries over intact.
    //     CR D2.6a / CT-55: …AND ANNOUNCED, PER SEAT, BEFORE IT HAPPENS.
    //
    //     Report #66 asked for the unused-token warning to fire only on the
    //     pass that reaches Regroup, and ui/battle.ts `passEndsBattlePhase`
    //     built exactly that. ONE case has no pass to hang it on: a round-2
    //     attacker who DECLINES goes `doDeclareAttack` → `endBattleRound` →
    //     `startRegroup` without opening a single priority window, so the
    //     defender's castable tokens were deleted with no line in the log at
    //     all. No client can close that — the engine took a path with no
    //     window on it — and it is reachable in two shapes, not one: a
    //     declined round 1 gives the whole battle phase ZERO windows.
    //
    //     Opening the window the decline skips was the other candidate and it
    //     is NOT timing-neutral: it would hand the defender a casting
    //     opportunity the rules do not have (a declined attack fights no
    //     combat, so there is no after-combat step for a window to belong to),
    //     and it would invalidate every saved game — 47,247 of the declines in
    //     server/games are followed immediately by something that is not a
    //     `passPriority`, and each one would replay into "you do not have
    //     priority". So the loss is ANNOUNCED rather than made preventable: a
    //     warning is not worth a rules change.
    //
    //     Emitted BEFORE the erase loop, so the tokens are still there to be
    //     named, and ordered seat-then-id so two runs of one game read alike.
    //     `ev` only logs: startRegroup is outside any settle() window, so this
    //     dispatches to nothing, exactly like the 'spared' line below.
    const doomed = Object.values(this.s.entities)
      .filter(e => e.kind === 'spellToken' && !this.spellTokenSurvivesRegroup(e))
      .sort((a, b) => a.controller - b.controller || a.id - b.id);
    for (const seat of [0, 1] as Seat[]) {
      const mine = doomed.filter(e => e.controller === seat);
      if (!mine.length) continue;
      this.ev('erased',
        `${this.pname(seat)} loses ${mine.length} unused spell token(s) to regroup: `
        + `${mine.map(e => `${e.card} ${e.x ?? ''}`.trimEnd()).join(', ')}.`,
        // ⚠ NO `cards` KEY, AND THAT IS LOAD-BEARING RATHER THAN AN OMISSION.
        // `ev()` keeps the CR 407.1 erased pile centrally: any 'erased' event with
        // a numeric `seat` has its `cards` pushed onto that seat's PUBLIC
        // erased list. Passing them here put every unused spell token into the
        // pile — reversing the rule stated ten lines below, in the spell-token regroup block:
        // a spell token is not a card and has never been recorded there. The
        // message already names them as text and `ids` carries them for the
        // client, so the key bought nothing and cost a zone query its meaning.
        // Caught by the round-27 class audit hours after the token-loss announcement landed; the
        // announcement was right and its payload was not.
        { seat, ids: mine.map(e => e.id) });
    }
    const spared: EntityId[] = [];
    for (const e of Object.values(this.s.entities)) {
      if (e.kind !== 'spellToken') continue;
      if (this.spellTokenSurvivesRegroup(e)) { spared.push(e.id); continue; }
      // CR 506.2h: a token can now be MODDED (an augment applied in deployment), and
      // a modded card is Unstable — "when it dies or is erased, it and all of
      // its mods are erased with it" (Manual p.35). Without this the mod
      // entities would outlive their host as orphans pointing at a dead id.
      // The augment reaches the public erased pile (CR 506.2h) exactly as it would
      // if the token had been cast and discharged; the TOKEN itself does not,
      // because a spell token is not a card and has never been recorded there.
      const mods = e.mods.map(id => this.entity(id)).filter((m): m is Entity => !!m);
      if (mods.length) {
        this.ev('erased',
          `${e.card} ${e.x ?? ''}`.trimEnd()
          + ` is erased at regroup — Unstable, so its ${mods.length} mod(s) go with it.`,
          { seat: e.controller, cards: mods.map(m => m.card) });
        for (const m of mods) delete this.s.entities[m.id];
      }
      delete this.s.entities[e.id];
    }
    if (spared.length) {
      this.ev('info', `${spared.length} spell token(s) stay through regroup.`, { ids: spared });
    }
    // (3) all temporary stat changes are removed (counters are NOT temporary)
    for (const e of Object.values(this.s.entities)) {
      e.tempPower = 0; e.tempToughness = 0; delete e.tempAttrs; delete e.tempAttrsAt;
      delete e.baseSet;      // layer 2 is an until-regroup rewrite too
      delete e.baseSetSeq;
      delete e.suppressed;   // CR 506.2d: so is a switched-off attribute/ability layer
      delete e.unstable;     // CR 803.8d: "they gain unstable UNTIL REGROUP" — this is that
      delete e.damageShield; // CR 506.2d: "UNTIL REGROUP, prevent all damage …" — and this
      delete e.damageShieldBy;
      delete e.shieldPending;
      delete e.granted;      // CR 109.8: and so is granted text
      delete e.allured;      // CR 802.15e {Alluring}: "can't attack" lasted the battle phase
      // CR 710.6: an until-regroup FACE lapses here (Apex Prime's "until
      // regroup"). A 'permanent' one does NOT — Borrower of Forms prints "I
      // BECOME an exact copy", with no duration, and a live test pins it.
      if (e.copies) {
        const kept = e.copies.filter(c => c.until !== 'regroup');
        if (kept.length) e.copies = kept; else delete e.copies;
      }
    }
    // CR 710.6: reverting a face can be LETHAL, and nothing else here would
    // notice. Damage is already gone (step 2) but COUNTERS are not — they are
    // facts about the unit, not about the face — so a 1/1 that took two -1/-1
    // counters while wearing a 7/5 face dies the moment the face lapses. The
    // same is true of `baseSet`, which step (3) has just dropped as well, and
    // which has been silently missing this check since layer 2 shipped.
    this.checkDeaths();
    // (4) units leave formation — battle state is already gone
    this.startDeployment();
  }

  /**
   * CR 507.4: two things happen at the start of deployment and the ORDER is a
   * ruling, because nothing in the printed rules sequences them:
   *
   *  1. CR 112.13c's rot damage — an automatic turn-structure step, not a trigger,
   *     that the manual puts "before anyone may deploy". It runs FIRST and
   *     settles (rotDamage() has its own settle()).
   *  2. The 'startOfDeployment' EVENT, which is what card text hooks
   *     ("At the start of deployment, …" — Scholar of the Void, Xzydris,
   *     Prediction Prophet, Invasive Species).
   *
   * Rot first, because rot damage is part of the step OPENING rather than
   * something that happens during it: a start-of-deployment trigger must not
   * be able to pre-empt damage the rules already charged. The visible
   * consequence is that rot which kills you kills you before your own
   * start-of-deployment trigger resolves.
   *
   * A trigger from step 2 needs no deferral: nothing after the event depends
   * on finishing (the phase is already flipped), so it simply resumes through
   * the normal decision path.
   *
   * ⚠ CR 507.4: step 1 is a different matter, and this is the deferral for it.
   * Rot damage can now RAISE A DECISION — Beyond, Codex Incarnate's "put that
   * many -1/-1 counters on target unit instead" queues a triggered effect from
   * inside rotDamage(), whose settle() collects its target and therefore
   * suspends. That suspension throws clean out of this method, and doDecide
   * resumes into collectTargets/commitItem/settle, which has never heard of
   * step 2 — so the 'startOfDeployment' event was simply never fired and every
   * "At the start of deployment, …" card on the board missed its turn. Same
   * shape as startBattlePhase()/finishHasteEnd() and endTurn()/finishTurnEnd():
   * flag the window open, and let settle() close it at the first safe point.
   */
  startDeployment(): void {
    this.s.phase = 'deploy';
    this.expireNextPlayDiscount('deploy');   // CR 111.10k errata: the discount lasts ONE phase
    this.s.deployDone = this.s.players.map(() => false);
    this.s.deployPlayer = this.initiative;
    // report #86: nobody has acted in THIS deployment yet (see types.ts)
    this.s.deployActed = this.s.players.map(() => false);
    this.ev('phase', 'Deployment: both players deploy at the same time — moves are revealed when everyone is done.');
    this.s.deployStarting = true;   // CR 507.4: step 2 is owed
    this.rotDamage();   // CR 507.4: start of deployment, before anyone may deploy
    this.finishDeployStart();
  }

  /** CR 507.4: fire 'startOfDeployment' once the rot damage — and anything the
   * rot replacement queued — has fully drained (see startDeployment). Called
   * from settle() and directly. */
  finishDeployStart(): void {
    if (!this.s.deployStarting) return;
    if (this.s.decision || this.s.stack.length || this.s.triggerQueue.length) return;
    this.s.deployStarting = false;
    const ev = this.ev('startOfDeployment', 'Start of deployment.', { turn: this.s.turn });
    this.fireEvent('startOfDeployment', ev);
    this.settle();
  }

  /** `seat` may take deployment actions right now (simultaneous model) */
  deploying(seat: Seat): boolean {
    return this.s.phase === 'deploy' && this.s.deployDone !== null && !this.s.deployDone[seat];
  }

  endTurn(): void {
    const ev = this.ev('endOfTurn', 'End of turn.');
    this.s.turnEnding = true;   // settle() completes the flip via finishTurnEnd()
    this.fireEvent('endOfTurn', ev);
    this.settle();   // EOT triggers resolve as special actions — no responses
  }

  /** Complete a pending end-of-turn once every trigger/decision has drained.
   * Runs from settle() so a mid-EOT suspension (fuzzer find: a ctx.choose in
   * an EOT trigger stranded the game) resumes into the turn flip naturally. */
  finishTurnEnd(): void {
    if (!this.s.turnEnding) return;
    if (this.s.decision || this.s.stack.length || this.s.triggerQueue.length) return;
    this.s.turnEnding = false;
    this.s.initiative = this.nit;
    this.startTurn();
  }
}

/**
 * Manual p.16-17: a dealt pack is drafted from N+1 times (N = players) and is
 * then RECYCLED — shuffled to the bottom of the deck — with fresh packs dealt.
 * In 1v1 that is three looks: you, your opponent, you again.
 *
 * Both the engine (when to recycle) and the server's per-seat view (what to
 * tell a player about the pack in their hands) need this schedule. A second,
 * independent copy of it is exactly how the draft banner came to promise that
 * the opponent would see the leftovers of a pack that was about to be recycled
 * — on the cycle's LAST look nobody sees them, which is the difference between
 * hate-drafting being worth a pick and being worth nothing (playtest,
 * 2026-08-20). One function, both callers.
 */
export function packCycle(turn: number, players: number): {
  /** looks this pack gets before it is recycled (N+1) */
  total: number;
  /** 0-based position of THIS turn's look within the cycle */
  index: number;
  /** what becomes of the pack a seat is holding, once they commit:
   *  'returns'  — it comes back to them later in this cycle
   *  'others'   — someone else drafts from it; they never see it again
   *  'recycled' — the final look: what they leave is shuffled into the deck
   *               and NOBODY drafts from this pack again */
  after: 'returns' | 'others' | 'recycled';
} {
  const total = Math.max(2, players + 1);
  const index = (((turn - 1) % total) + total) % total;
  // A pack travels exactly once around the table (N looks) plus one, so the
  // only holder who ever sees it again is the one holding it at the start of
  // the cycle — true for any N, not just 1v1.
  const after = index === total - 1 ? 'recycled' : index === 0 ? 'returns' : 'others';
  return { total, index, after };
}
