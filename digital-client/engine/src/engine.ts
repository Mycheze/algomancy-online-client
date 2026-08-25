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
 * Mid-resolution choices (R4 electric paths, R6 payments) use replay
 * suspension: the effect part runs until it needs an unanswered choice, the
 * engine rolls the draft back to the part boundary, records the decision, and
 * on `decide` re-runs the part with the answer filled in (deterministic:
 * the RNG state rolled back with everything else).
 */
import type {
  Action, Attr, BattleState, BinRef, CachedCard, CachedProphecy, CardName, CopyFacet, CopyRef,
  Decision, DecisionOption,
  EffectPart, EngineEvent, Entity, EntityId, EventType, FormationSpot, GameState, PendingTrigger,
  ResourceKind, Seat, SpawnFace, StackItem, Suspension, TargetRef,
} from './types.ts';
import {
  affinityPips, binNthAt, CARD_PLAY_KINDS, costAmount, costXMin, effectByKey, getCard, graftCauseIndex,
  isAugment, isGraftable, isTriggered, specForSlot, zoneTriggersFor,
  type Ability, type CardDef, type CastCost, type CostMod, type EffectCtx, type EffectDef,
  type ResolvedTarget, type TargetCtx, type TargetRestrict, type TargetSpec, type TokenRequest, type TriggeredAbility,
} from './cards/dsl.ts';
import { rngShuffle } from './rng.ts';

/** R118: a whole-identity copy — "become a copy of target unit" contributes
 * every facet, which is what makes it a face REPLACEMENT rather than a grant. */
const FULL_FACETS: readonly CopyFacet[] =
  ['name', 'stats', 'attrs', 'statics', 'activated', 'triggered', 'behavior'];
/** R118: the ADDITIVE default — "I have all ABILITIES of adjacent allies"
 * (Ancient One). Never `name`, never `stats`. R127 added `behavior`. */
const PROJECTED_FACETS: readonly CopyFacet[] = ['statics', 'activated', 'triggered', 'behavior'];

/**
 * R127: every channel the `behavior` facet carries — the whole of what a card
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
  'costMods', 'effectAttrs', 'amountMods', 'modPermissions', 'playPermissions',
  'mustBeTargeted', 'replaceRotDamage', 'replaceCombatDamageToPlayer',
  'replaceLifeGain', 'replaceCounters', 'replaceTokenCreation',
  'replaceTokenBatch', 'replaceCardStep',
] as const;
/** R127: one member of `BEHAVIOR_CHANNELS` */
type BehaviorChannel = (typeof BEHAVIOR_CHANNELS)[number];

/** R59: where and why a card's cost is being computed (see manaToPlay).
 * `region` defaults to the seat's action region; `purpose` defaults to
 * 'play' — pass 'mod' when the card is being applied as an augment or graft,
 * which is not playing (R37). */
export interface CostOpts { region?: number; purpose?: 'play' | 'mod' }

/**
 * R98: what `E.preventUnitDamage` is being asked about — one recipient, one
 * commit, one source.
 *
 * `attrs` and `pure` are here from the start rather than "when something needs
 * them", because the card that will need them is already written and parked:
 * Oorblak's Piercing-excess half cannot tell a Piercing hit from a plain
 * overkill out of `{ attacker, region }`, which is precisely why its ledger
 * entry says the hook is the wrong shape. `attrs` is the SOURCE's live
 * attribute set (the same set the commit loop is reading), and `pure` is R61's
 * attribute-blind exchange, which switches those attributes off for both
 * sides.
 */
export interface UnitDamageInfo {
  /** the region the damage is dealt in (R12) */
  region: number;
  /** what is dealing it, for the log ("Fireball", a column label) */
  source: string;
  /** combat damage, or an effect's */
  combat: boolean;
  /** the SOURCE's live attributes — {Piercing}, {Deadly}, {Powerful}, … */
  attrs: Set<string>;
  /** R61 {Pure}: this came out of an attribute-blind exchange */
  pure: boolean;
}

export class Suspended { }
export class GameEnded { }
/** The unstarted tail of a multi-item cast chain and the `then` it runs
 * with — threaded commitItem → resolveItem → resolveParts so that a
 * mid-resolution suspension can carry it (see Suspension 'resolve'). */
export interface ChainRest { then: 'push' | 'resolve'; moreItems: StackItem[] }
export class IllegalAction extends Error {
  /** R154: this refusal is not "you may not do that" but "not YET" — the
   * action was applied to the draft, turned out to disturb the OTHER seat's
   * open question, and the whole draft was thrown away. The server reads this
   * flag and parks the action instead of relaying a refusal (rooms.ts
   * `deferrableRefusal`); a hotseat caller may simply retry after the answer. */
  disturbs?: boolean;
}
/** thrown by ctx.choose inside an effect part; converted to a 'resolve' suspension */
class PartChoice {
  key: string;
  dec: {
    kind: 'payOrDecline' | 'electricPath' | 'formationSlot'; seat: Seat; prompt: string;
    options: DecisionOption[];
    /** BL-25/R139: a card effect asking HOW MANY counters — the ceiling its
     * stepper maxes at. Passed straight through onto the Decision. */
    counterMax?: number;
  };
  constructor(key: string, dec: PartChoice['dec']) {
    this.key = key;
    this.dec = dec;
  }
}

export function other(seat: Seat): Seat { return 1 - seat; }

/** Manual p.17: each player may flip up to TWO dormant resources face-up per
 * turn. One constant, three coupled readers: the starting allowance
 * (createGame), the per-turn refresh (startTurn) and the activation gate's
 * error text (doActivateResource). */
export const ACTIVATIONS_PER_TURN = 2;

/**
 * R68: the stack-item kinds whose CARD goes to the bin when the item is
 * negated. A 'unit' belongs here — a {Battle} unit caught mid-cast is a real
 * card and has to land somewhere (it used to be erased into nowhere while the
 * log claimed "→ bin"). 'spellToken' does not: a token is erased (R40).
 * 'triggered'/'activated' do not: their `card` names the SOURCE, which is
 * still in play — the ability is simply gone.
 */
const NEGATE_BINS = new Set<StackItem['kind']>(['spell', 'spellUnit', 'unit', 'virus', 'ambush']);

// ── prophecy conditions (R43) ─────────────────────────────────────────
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
 * matches, and the release-timing marker.
 *
 * R42: a TRAILING "[Haste]" (Divine Intervention's `Your life is 5 or less
 * [Haste]`) is a timing marker on the RELEASE, not part of the condition — it
 * is split off here. Tithe Enforcer's `End [Haste] with used mana` keeps its
 * bracket because it is not trailing: there the word names the STEP.
 */
export function normalizeProphecy(raw: string): { condition: string; norm: string; release?: 'haste' } {
  let s = String(raw ?? '').trim();
  // granted prophecies arrive with their own label ("Prophecy — One Turn
  // Passes", "Prophecy: 1 turn passes"); printed banners arrive bare
  s = s.replace(/^prophecy\s*[—–:\-]?\s*/i, '').trim();
  let release: 'haste' | undefined;
  const trailing = /\[\s*haste\s*\]\s*$/i.exec(s);
  if (trailing) {
    release = 'haste';
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
  return { condition, norm, ...(release ? { release } : {}) };
}

interface ProphecyRule {
  /** what the table row is called in the log / in tests */
  id: string;
  /** matched against the NORMALISED condition */
  re: RegExp;
  met: (g: E, seat: Seat, p: CachedProphecy, m: RegExpMatchArray) => boolean;
}

/** One unit's share of a combat sub-step's damage, tagged with the striking
 * column's damage-replacement attrs (Poisonous → counters, Resonant → rider)
 * and, for R48 {Blessed}, the seat the life gain is owed to. */
interface CombatUnitHit {
  pool: number; poisonous: boolean; resonant: boolean;
  /** R61 {Pure}: this damage came out of an attribute-blind exchange, so
   * the VICTIM's Vulnerable is switched off for it too */
  pure?: boolean;
  blessedTo?: Seat; blessedFrom?: string;
  /** R98: the striking column's live attributes and label, carried so the
   * prevention/replacement choke point can be told a {Piercing} hit from a
   * plain overkill. Last assignment wins, as `poisonous`/`resonant` already
   * do — a unit takes damage from at most one column per sub-step. */
  attrs?: Set<string>; label?: string;
}

/** The scratch shared by `E.combatSubStep`'s halves, alive for exactly one
 * sub-step: the assignment half fills it, the commit half and the aftermath
 * read it. See the method for the order. */
interface CombatLedger {
  /** pool assigned to each unit this sub-step */
  perUnit: Map<EntityId, CombatUnitHit>;
  /** R21: any damage from a Deadly column kills */
  deadlyHit: Set<EntityId>;
  /** draws owed to each seat (R24 Thieving) */
  thievingDraw: number[];
  /** R48: combat damage a column deals to a PLAYER, one entry per column —
   * per-column granularity is required by the Blightsea Polyp replacement
   * ("as 1 rot", whatever the column's power) and by {Lethal}. */
  playerHits: { seat: Seat; amount: number; by: Seat; attrs: Set<string>; label: string; pure: boolean }[];
  /** R48 {Afflicting}: units each afflicting column damaged this sub-step,
   * keyed by column, so its kills can be diffed out afterwards */
  afflicted: Map<string, { dealer: Seat; label: string; ids: Set<EntityId> }>;
  /** who controlled what before the sub-step, for the afflicting diff */
  beforeUnits: Map<EntityId, Seat>;
  /** R106 {Unaware}: every unit that fought in an exchange collapsed to
   * printed stats, so the sub-step can run the death check the collapsed
   * reading implies — `checkDeaths` reads effStats and cannot see it. */
  collapsed: Set<EntityId>;
}

/** R43: every condition counts FORWARD from the moment of prophesying — never
 * backwards (Caleb 2024-09-22: "Same way that 'Four turns pass' can't just be
 * played on turn 5"). The counting rows read a delta against the stamps taken
 * when the card was cached; the state rows are live checks that only start
 * being asked once the prophecy exists, and R44 latches them afterwards. */
const PROPHECY_RULES: ProphecyRule[] = [
  {
    id: 'turnsPass',
    re: /^(\d+) turns? (?:pass|passes)$/,
    met: (g, _seat, p, m) => g.s.turn - p.turn >= Number(m[1]),
  },
  {
    id: 'battlesPass',
    // 1v1: both the initiative battle and the counterattack tick this
    re: /^(\d+) battles? (?:pass|passes)$/,
    met: (g, _seat, p, m) => (g.s.battlesCompleted ?? 0) - p.battles >= Number(m[1]),
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
      const costs = new Set(g.unitsOf(seat).map(u => String(g.card(u.card).mana)));
      return costs.size >= Number(m[1]);
    },
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

  constructor(state: GameState) { this.s = state; }

  // ── infrastructure ──────────────────────────────────────────────────
  ev(type: EventType, msg: string, data?: Record<string, unknown>): EngineEvent {
    const e: EngineEvent = { type, msg, ...(data ? { data } : {}) };
    this.events.push(e);
    // R65: the erased pile is kept here rather than at each of the dozen
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

  /** R65: the cards erased out of `seat`'s zones — public, and never a zone
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
   * R96: may `seat` play SPELLS out of their own bin in `region` right now?
   *
   * "In this battle, you may play spells from your bin" (Abyssal Evocation).
   * It is a BATTLE-SCOPED permission and it is deliberately not an
   * `anchored()` radiator: `E.anchored` walks units in play and augment mods,
   * and Abyssal Evocation is a SPELL — it resolves and goes to the bin, so
   * there is nothing left in play to radiate from. What the card grants is a
   * fact about this battle, which is exactly what battleCounters are.
   *
   * Region-KEYED, which is R14's "'this battle' = this region's battle" for
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
  /** R96: grant the above for the rest of this region's battle. */
  grantBinSpellPlay(seat: Seat, region: number): void {
    this.bumpBattleCounter(region, `binPlaySpells:${seat}`);
  }

  // ── resources & payment ─────────────────────────────────────────────
  affinity(seat: Seat, element: string): number {
    let n = 0;
    for (const r of this.player(seat).resources) {
      if (r.state === 'dormant') continue;   // dormant gives no affinity
      if (r.kind === element) n++;           // expended still counts
      // Prismites give NO affinity — their value is the planning-phase
      // exchange into a real element (R17, Manual p.18)
    }
    return n;
  }
  /**
   * "Create a Shard." (Manual p.18) A Shard is its own ResourceKind, NOT a
   * prismite: it arrives dormant, gives one generic mana once activated, gives
   * NO affinity, and — the difference that matters — can never be exchanged
   * for an element during planning the way a prismite can (R17). Cards that
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
  /** reentrancy guard for play-permission evaluation (R97; mirrors the above) */
  private inPlayPermissions = false;
  /** R104: reentrancy guard for amount-modifier evaluation (mirrors inCostMods) */
  private inAmountMods = false;
  /** R118: reentrancy guard for the CONTINUOUS half of the copy layer
   * (mirrors inStatics). See `facesOf` — it sits UNDER effStats, so a nested
   * query gets the identity face and nothing projected. */
  private inFaces = false;
  /**
   * R104: reentrancy guard for the counter REDIRECT. Unlike the amount
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
   * R104: how deep inside a REPLACEMENT the engine currently is.
   *
   * A replacement is not an effect. It never reaches the stack, it has no
   * `EffectDef`, and so nothing it creates can be attributed to an effect's
   * R69 `creates` declaration. Exposed (see `inReplacement`) so the
   * conformance recorder in test/65 can tell "an effect made a token it never
   * declared" — a real defect — from "the replacement layer substituted or
   * added a token", which is by construction undeclarable.
   */
  private replacementDepth = 0;
  /** R104: is a replacement running right now? See `replacementDepth`. */
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
   * Everything else (region/controller scoping, and CRUCIALLY the R62
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
   * R127: the faces one `anchored()` radiator's BEHAVIOUR channels come off.
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
   * R127: does this radiator carry channel `key` right now — off its own card,
   * off an identity copy, or off a face projected onto it?
   *
   * The `anchored()` presence predicates are the hottest reads in the engine
   * (`amountDelta` runs on every counter and every point of effect damage), and
   * they were written as a single property read for exactly that reason. That
   * read is still FIRST here and is still the whole answer on any board with no
   * copy layer at all; only a board that actually has one pays for the face
   * walk, and only for a holder that IS its anchor.
   */
  private donates(holder: Entity, anchor: Entity, key: BehaviorChannel): boolean {
    if (this.card(holder.card)[key]) return true;
    if (holder.id !== anchor.id) return false;
    return this.behaviorFaces(holder, anchor)
      .some(f => f !== holder.card && !!this.card(f)[key]);
  }

  /**
   * R127: flatten an `anchored()` result into ONE ENTRY PER FACE that actually
   * declares `key`, keeping the holders' order (which the replacement hooks
   * have already sorted by entity id) and, within a holder, layer order —
   * identity face first, then whatever is projected onto it.
   *
   * The seven `replace*` hooks all read "first one to claim it consumes the
   * event", so what they iterate has to be a flat, ordered list of CANDIDATE
   * CLAUSES rather than of entities. `anchor` rides along because an
   * [Augment]-donated or projected clause reads from its HOST/mimic, which is
   * what `anchored()` means by the anchor.
   */
  private donorFaces(
    holders: { holder: Entity; anchor: Entity }[], key: BehaviorChannel,
  ): { face: CardName; anchor: Entity }[] {
    const out: { face: CardName; anchor: Entity }[] = [];
    for (const { holder, anchor } of holders) {
      for (const face of this.behaviorFaces(holder, anchor)) {
        if (this.card(face)[key]) out.push({ face, anchor });
      }
    }
    return out;
  }

  /**
   * R59: every active CostMod that applies to `ctx`. Radiates from units in
   * play and from augment mods anchored on their host, scoped to the region
   * the card is being played into (R12) — the same rules as staticsFor.
   * NOTE the returned `holder` is the ANCHOR (the entity the mod reads from),
   * while the mod list comes off the carrying entity's card.
   */
  private costModsFor(region: number): { holder: Entity; mod: CostMod; via: CardName }[] {
    if (this.inCostMods) return [];
    const out: { holder: Entity; mod: CostMod; via: CardName }[] = [];
    this.inCostMods = true;
    try {
      for (const { holder, anchor } of this.anchored((_h, a) =>
        a.region === region
        && !a.suppressed?.abilities)) {                         // R62, as staticsFor (shallow)
        // `via` is the card the mod is PRINTED on — the FACE (R127), which for
        // a donated augment is the holder rather than the anchor (R121's logs
        // name it) and for a projected/copied face is the borrowed card
        for (const face of this.behaviorFaces(holder, anchor)) {
          for (const mod of this.card(face).costMods ?? []) out.push({ holder: anchor, mod, via: face });
        }
      }
    } finally { this.inCostMods = false; }
    return out;
  }

  /**
   * R94: every attribute a continuous `EffectAttrMod` grants to ONE PART of a
   * resolving stack item. `costModsFor`'s sibling, line for line — the same
   * `anchored()` walk (units in play plus augment mods reading from their
   * host), the same region scope (R12: the mod reads from the ANCHOR's
   * region, which is why an Enlightener augmented onto an enemy unit boosts
   * THAT player's spells), the same shallow R62 guard every radiating-static
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
      for (const { holder, anchor } of this.anchored((h, a) =>
        this.donates(h, a, 'effectAttrs')                     // R127: off the FACES
        && a.region === ctx.region
        && !a.suppressed?.abilities)) {                        // R62, as staticsFor (shallow)
        for (const face of this.behaviorFaces(holder, anchor)) {
          for (const mod of this.card(face).effectAttrs ?? []) {
            if (mod.affects(this, anchor, ctx)) out.push(...mod.attrs);
          }
        }
      }
    } finally { this.inEffectAttrs = false; }
    return out;
  }

  /**
   * R104: every active `AmountMod`'s contribution to one quantity, SUMMED.
   *
   * `costModsFor` + `manaToPlay` folded into one, because unlike a cost there
   * is nothing else to do with the list: the same `anchored()` walk (units in
   * play plus augment mods reading from their HOST), the same R12 region
   * scope, the same shallow R62 guard every radiating query uses, the same
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
      for (const { holder, anchor } of this.anchored((h, a) =>
        this.donates(h, a, 'amountMods')                       // R127: off the FACES
        && (ctx.region === undefined || a.region === ctx.region)   // fireEvent's rule
        && !a.suppressed?.abilities)) {                        // R62, as staticsFor (shallow)
        for (const face of this.behaviorFaces(holder, anchor)) {
          for (const mod of this.card(face).amountMods ?? []) {
            total += mod.delta(this, anchor, ctx);
          }
        }
      }
    } finally { this.inAmountMods = false; }
    return total;
  }

  /**
   * R59: what it actually costs `seat` to play (or apply) `name` right now —
   * printed mana plus every active cost modifier, never below zero. `purpose`
   * separates playing from applying a mod: applying a mod is not playing
   * (R37), so "spells cost [one] more to play" does not tax an augment.
   *
   * R119 adds the one PLAYER-side discount, folded in after the radiating
   * layer and before the clamp so a [1] card still goes free rather than
   * negative. The `purpose` guard is R37/R59 doing its usual work: a mod
   * payment passes `purpose: 'mod'` and pays full price, no charge burnt.
   */
  manaToPlay(seat: Seat, name: CardName, opts: CostOpts = {}): number {
    const c = this.card(name);
    const base = c.mana === 'X' ? (c.xMin ?? 0) : c.mana;
    const region = opts.region ?? this.actionRegion(seat);
    const ctx = { seat, card: c, region, purpose: opts.purpose ?? 'play' as const };
    let total = base;
    for (const { holder, mod } of this.costModsFor(region)) total += mod.delta?.(this, holder, ctx) ?? 0;
    // R119: Deferral Drone's resolved charge. Player-side, so it is NOT
    // region-scoped the way the CostMod layer above is (R12) — see types.ts.
    if (ctx.purpose === 'play') total -= this.s.nextPlayDiscount?.[seat] ?? 0;
    return Math.max(0, total);
  }

  /**
   * R119: arm "the next card you play this turn costs [`n`] less" for `seat`.
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

  /** R119: `seat` has played a card — the charge is consumed. A no-op when
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
   * R60: the LIFE half of the same layer — what playing `name` costs in life
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
   * R121: what the cost-modifier layer adds to an ability ACTIVATION or to a
   * TRIGGER going to the stack — "[Augment] Abilities cost [one] more to
   * activate or trigger during battle" (Crevice Lurker). Designer: the card
   * "taxes the cost to activate or trigger abilities", and can stop e.g.
   * Ruinbringer's "After combat, delete all units" the way a negate can.
   *
   * The SAME radiating CostMod layer as R59 — same anchored() walk, same R12
   * region scope (the Lurker's own region, or its HOST's when donated), same
   * shallow R62 guard, same reentrancy latch — consulted with the two R121
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
   * R122: the SACRIFICE third of the same layer — how many units playing
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
    // X spells: X is chosen and paid at cast (R35); castability needs only the
    // smallest legal X to be affordable (xMin, e.g. "X can't be zero" → 1)
    if (this.openMana(seat) < this.manaToPlay(seat, name, opts)) return false;
    // R60: an unpayable LIFE tax makes the card uncastable exactly as
    // unpayable mana does — R49's rule, so 2 life is unpayable at 2 life.
    if (!this.canPayLife(seat, this.lifeToPlay(seat, name, opts))) return false;
    // R122: an imposed "[Sacrifice a unit]" gates castability the same way —
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
    // R43 (Tithe Enforcer, "End [Haste] with used mana"): tally what is spent
    // DURING the haste step, so the prophecy can tell "you hasted something
    // else" from "you did nothing". Debt (R39) is paid in the resource step,
    // with hasteDone still null, so it deliberately does not count.
    if (mana > 0 && this.s.phase === 'planning' && this.s.hasteDone !== null) {
      const tally = (this.s.hasteManaSpent ??= this.s.players.map(() => 0));
      tally[seat] = (tally[seat] ?? 0) + mana;
    }
  }
  payCard(seat: Seat, name: CardName, opts: CostOpts = {}): void {
    const c = this.card(name);
    // an X spell pays 0 here — X itself is chosen and paid at cast (R35) — but
    // a cost modifier still applies to the non-X part of the bill (R59)
    const mana = c.mana === 'X'
      ? Math.max(0, this.manaToPlay(seat, name, opts) - (c.xMin ?? 0))
      : this.manaToPlay(seat, name, opts);
    this.payMana(seat, mana);
    // R60: the life half of the bill, charged in the same breath as the mana
    // — before the card reaches the stack, so it cannot be responded to and
    // negating the card does not refund it.
    const life = this.lifeToPlay(seat, name, opts);
    if (life > 0) {
      this.ev('info', `${this.pname(seat)} pays ${life} life to play ${name}.`);
      this.loseLife(seat, life, `${name} (added cost)`);
    }
  }

  // ── LAYER 0: the COPY layer (R118) ──────────────────────────────────
  /**
   * R118 — one FACE an entity is wearing: a card name plus which halves of
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
   * stays the PHYSICAL card forever (R118 ruling 1) — the thing that bins, is
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
   * push in `destroy`, `noteTrashed`, the R65 erased pile, DECK_LIST — keep
   * reading `e.card` raw, and must (R118 ruling 1).
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
   * changes inside one combat (R72 column collapse, a neighbour dying,
   * blockers declared) and the answer has to change with it.
   *
   * The walk is `anchored()`'s, with the same shallow R62 guard every
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
      for (const { holder, anchor } of this.anchored((h, a) =>
        !!getCard(h.card).projects
        && a.region === e.region
        && !a.suppressed?.abilities)) {                       // R62, as staticsFor (shallow)
        for (const pr of getCard(holder.card).projects ?? []) {
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
   * R118: stamp a copied FACE onto `target`.
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
   * R118: build the FACE `src` would be copied as, WITHOUT putting it on
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
    // R118 ruling 2 (owner, verbatim): "Inherit the mods text, but it IS
    // Unstable. Anything that's modded is unstable and the copy is still
    // considered modded." No mod ENTITIES are cloned — `target.mods` is
    // untouched — but the copy carries the text and counts as modded.
    const modText: string[] = [];
    for (const id of src.mods) {
      const m = this.entity(id);
      if (!m) continue;
      modText.push(`${m.card} (${m.appliedAs === 'graft' ? 'grafted' : 'augmented'})`);
    }
    const ref: CopyRef = {
      card: name,
      facets: opts.facets ?? [...FULL_FACETS],
      until: opts.until,
      from: opts.from,
      seq: this.s.nextId++,
      ...(opts.printedStats ? { printedStats: opts.printedStats } : {}),
      ...(modText.length ? { modded: true, modText } : {}),
    };
    return ref;
  }

  /** R118: put a prepared face on an entity (see `prepareCopy`). */
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
      + (ref.modded ? ' — modded, so the copy is Unstable' : '')
      + (ref.until === 'regroup' ? ' until regroup.' : '.'),
      { unit: target.id, copy: name, until: ref.until });
    this.checkDeaths();   // a copied 0-defense body is lethal, as setBase is
    return ref;
  }

  /* R147 DELETED `parkCopySource` / `takeCopySource`. They existed for one
   * card — Borrower of Forms, whose face was prepared in its spell resolution
   * and worn in the next one — and the gap they bridged is gone: the face
   * rides the spell's own `StackItem.spawnWearing` and `spawnUnit` puts it on
   * as the body enters. `prepareCopy` above is still what builds it; there is
   * simply nowhere to park it now, which is the point (the slot was keyed by
   * REGION, so two Borrowers in one region shared it). */

  /** R118: is this entity already wearing `name` as its identity face? The
   * idempotence check a repeating copy trigger needs. */
  isCopyOf(e: Entity, name: CardName): boolean {
    return this.identityCopy(e)?.card === name;
  }

  /**
   * R69 + R118 ruling 2: is this entity ERASED instead of binned when it dies?
   *
   * Four ways in, unioned here so `destroy` does not have to know there are
   * four: it carries mods (the derivation — a modded card is Unstable), it
   * carries R96's until-regroup {Unstable} stamp, its FACE prints {Unstable}
   * on the type line (Aberrant Statweaver, Oorblak — report #89: nothing used
   * to carry the printed marker, so both binned like anything else), or it is
   * a COPY of something that was modded (ruling 2 — "the copy is still
   * considered modded"). The printed flag reads the FACE, like ownAttrs'
   * layer 0: a copy wearing a printed-Unstable face is Unstable.
   */
  isUnstable(e: Entity): boolean {
    if (e.mods.length > 0 || e.unstable === true) return true;
    if (this.faceDef(e).unstable === true) return true;
    return (e.copies ?? []).some(c => c.modded);
  }

  /**
   * R145 — the STACK twin of `isUnstable`. Is this stack item's card ERASED
   * instead of binned when it leaves the stack without arriving anywhere?
   *
   * ⚠ THE ACTIVE ZONE. Caleb's glossary (rules-bot dump, 2025-03-12) defines
   * {Unstable} as "if an unstable card would enter a bin FROM AN ACTIVE ZONE,
   * erase it instead" — and never says which zones are active. Bena supplied
   * the list, 2026-08-25: **in play and the stack are the active zones.** So
   * Unstable needs TWO readers, not one: `isUnstable` for the play half
   * (R137's bin → trash → sweep) and this one for the stack half. Hand, deck,
   * bin, cache and the erased pile are INACTIVE — a card leaving one of those
   * for a bin is binned and trashed normally, printed {Unstable} or not (that
   * is the open question in playtest-ledger #89, closed by "from an active
   * zone" in the direction of "no, it bins").
   *
   * THREE ways in, and the third is the one that was missing (report R145):
   *  · `augments` — a virus rode it, so the card is MODDED (R79, derived);
   *  · `unstable` — the R96 bin-play stamp / the R105 {Modular} cast stamp;
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
    if (item.card === undefined || !NEGATE_BINS.has(item.kind)) return false;
    return this.card(item.card).unstable === true;
  }

  // ── stats & attributes (the six-layer projection, all six built: see
  //    docs/03 §4, and R93 / R106 for layers 5 and 6) ──────────────────
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
      // R62: a silenced unit radiates nothing — a static IS an ability.
      // Shallow by construction (the reentrancy guard is already held, so a
      // nested suppression query sees no statics): a unit silenced by a
      // SPELL stops radiating immediately, while two units whose statics
      // silence each other both keep radiating and both go quiet, which is
      // the simultaneous answer the layer model wants anyway.
      for (const { holder, anchor } of this.anchored((_h, a) =>
        a.region === target.region
        && !a.suppressed?.abilities)) {
        // R118 layer 0: the statics come off the FACES the holder is wearing,
        // not off `holder.card`. The identity face is the copied card (Apex
        // Prime, Borrower of Forms); the projected ones are the neighbours'
        // (Ancient One), and those land on the ANCHOR, so they are only
        // gathered when the holder IS its anchor.
        const faces = holder.id === anchor.id
          // a unit reads its own identity face PLUS whatever is projected onto
          // it — projections land on the ANCHOR, and here the holder is it
          ? this.facesWith(holder, 'statics')
          // an augment MOD carries only its own text; a mod is never copied,
          // and a projection onto the host is gathered when the walk reaches
          // the host itself
          : [holder.card];
        for (const face of faces) {
          for (const mod of getCard(face).statics ?? []) {
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
    // layers 0-1: what the card this entity currently IS prints (R118)
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
    // layer 4: Tough / Balanced in application order (R19); duplicates don't stack
    const statAttrs = this.statLayerAttrs(e);
    for (const a of statAttrs) {
      if (a === 'Tough') t *= 2;
      else if (a === 'Balanced') { const m = Math.max(p, t); p = m; t = m; }
    }
    /**
     * LAYER 5 — {Inverted} (R93). "Invert the stat changes of inverted units."
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
     * layer 4 runs on (R19). Two Reality Benders on one host do not cancel.
     *
     * No death check happens inside here, and that is deliberate: `effStats`
     * is atomic and the caller checks deaths after. Caleb, asked whether a
     * unit dies part-way through the arithmetic: "Not if it hits 0 mid
     * calculation" / "Doesn't instantly die", and lofavreel's gloss he agreed
     * with — "imagine it as one big equation… It is not a time thing".
     *
     * ⚠ OPEN (R93): Caleb also said "Tough inverted balanced would be
     * different" from "tough balanced inverted", which would make {Inverted}
     * an interleaved member of the layer-4 order rather than a clean layer 5.
     * He immediately called that case "basically impossible to make happen.
     * Because tough inverted would die before you could add more", and his own
     * worked example is the clean layer. Shipped clean; see R93.
     */
    if (statAttrs.includes('Inverted')) {
      p = 2 * base[0]! - p;
      t = 2 * base[1]! - t;
    }
    /**
     * LAYER 6 — {Unaware} (R106). PRINTED, not base: layer 1 and nothing else.
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
     * Note it drops layer 2 as well, unlike {Inverted} one layer up. R93's
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
     * The OTHER half of R106 — every card in an interaction with an Unaware
     * card also reads at printed — cannot live here, because `effStats(e)`
     * knows only `e`. It lives in `interactionStats`, at the damage and combat
     * sites; see that method.
     */
    if (statAttrs.includes('Unaware')) return this.printedStats(e);
    return [p, t];
  }

  /**
   * LAYER 1 ALONE — "the literal printed text on the card" (R106).
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
    // LAYER 0 (R118) sits UNDER layer 1 and redefines what "printed" means: a
    // Unit Token that became a copy of a Good Whale reads 7/5 here, because
    // the card it now is prints 7/5. This is the R106 {Unaware} decision, and
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

  /** R106: does this entity carry {Unaware} for stat purposes? Column-shared,
   * because it rides `statLayerAttrs` with the other three stat-layer attrs
   * (R19) — so a unit standing beside Bubb in a formation is Unaware too. */
  unaware(e: Entity): boolean {
    return this.statLayerAttrs(e).includes('Unaware');
  }

  /**
   * R106, the PAIRWISE half: the stats a card reads DURING AN INTERACTION.
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
   * ⚠ TARGETING IS OUT OF SCOPE. R10's older wording lists targeting as an
   * interaction; the owner's operational statement does not, and legality
   * checks read stats at ~33 card-side sites. Recorded as R106's one open
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
   * R106: kill whatever the collapsed reading has already killed.
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
  /** R19/R93/R106: the stat-layer attrs, in layer-4 application order — own
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
   * R62 — the SUPPRESSION layer: which halves of a card are switched off right
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
  /** R62: are this entity's triggered / activated / static / cost abilities
   * switched off? The gate on every path that would otherwise fire one. */
  abilitiesSuppressed(e: Entity): boolean {
    if (e.suppressed?.abilities) return true;
    return this.staticsFor(e).some(s => s.mod.suppressAbilities);
  }

  /**
   * R11: is this spell token protected from the regroup erase by a live
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
    // R62: "loses ALL attributes" — the layer is off, so nothing below it runs
    if (e.suppressed?.attrs || statics.some(st => st.mod.suppressAttrs)) return set;
    // LAYER 0 (R118): the attrs of the card this entity currently IS. Only the
    // identity face carries `attrs`, so this is one name, not a union.
    for (const a of this.faceDef(e).attrs) set.add(a);
    for (const a of e.tempAttrs ?? []) set.add(a);
    for (const { mod } of statics) for (const a of mod.attrs ?? []) set.add(a);
    for (const id of e.mods) {
      const m = this.entity(id);
      if (m && m.appliedAs === 'augment') {
        for (const a of this.card(m.card).augmentAttrs) set.add(a);
      }
    }
    return set;
  }
  /**
   * The card NAME this entity answers to — what a "name a card" effect
   * (The Everywhere) matches against, and the one place that comparison is
   * made.
   *
   * R118 landed the copy layer this hook was reserved for, so it is now
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
   * R61 {Pure}: "Pure cards and cards they are interacting with ignore all
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
  draw(seat: Seat, n: number, silent = false): void {
    let got = 0;
    for (let i = 0; i < n; i++) {
      const c = this.deckOf(seat).shift();
      if (c === undefined) break;
      this.player(seat).hand.push(c);
      got++;
    }
    if (!silent && got > 0) {
      const ev = this.ev('draw', `${this.pname(seat)} draws ${got}.`, { seat, n: got });
      // dispatch to trigger listeners only during battle: every current
      // "card enters a hand" consumer is battle-scoped, and turn-start draws
      // firing triggers outside any settle() window would be unsound.
      if (this.s.battle) this.fireEvent('draw', ev);
    }
  }
  recycleToBottom(seat: Seat, name: CardName): void {
    this.deckOf(seat).push(name);
  }

  // ── the bin & trashing (R40) ────────────────────────────────────────
  /**
   * Everything that enters a bin goes through here. R40: **anything entering a
   * bin from anywhere other than the stack is trashed** — tokens included, and
   * NOT because a token is a card (R133: it is not), but because trashing is
   * defined by the destination, not by the object. It is
   * trashed BY THE OWNER OF THE BIN IT ENTERS — so `seat` is both the bin's
   * owner and the trasher, whatever the card's own owner is (Pull Under moves
   * a dead enemy unit into the caster's bin: the caster trashes it).
   *
   * `from` is the zone the card came from. 'stack' never trashes (a spell or
   * ability going to the bin after it resolves, or after being negated, comes
   * from the stack — so countering is not trashing); everything else does,
   * 'cache' (R41) included — a cached card binned without being played is
   * trashed like any other. R69: a TOKEN is trashed like any other too — the
   * old `opts.token` escape hatch is gone, and it had no callers even before
   * the ruling reversed it.
   *
   * R137: and so is an {Unstable} card. It was the last object whose
   * DISPOSITION was allowed to decide whether trashing happened — the erase
   * that follows it out of the bin used to be modelled as "it never went to a
   * bin at all". It goes; it is trashed there; then it is erased. Nothing in
   * this method changed, and that is the point: "the destination, not the
   * object" was always the rule, and Unstable was the last exception to it.
   */
  toBin(seat: Seat, name: CardName, from: 'hand' | 'deck' | 'play' | 'stack' | 'cache'): void {
    this.player(seat).bin.push(name);
    if (from === 'stack') return;
    this.noteTrashed(seat, name, from);
  }

  /**
   * Fire the trash event for a card that has ALREADY been put in `seat`'s bin.
   * Split out of toBin() for the paths that must control event ORDER: destroy()
   * and recall() bin the card first but have to emit (and fire) their own
   * 'died'/'despawned' event before the trash, or the game log reads backwards.
   *
   * R69: a TOKEN does reach here, and R133 (2026-08-24) had to REBUILD the
   * argument for why without changing the answer. This comment used to open
   * "Tokens are cards", quoting both rulebooks' "Tokens are temporary cards" —
   * and the owner has since ruled the opposite: **tokens are NOT cards.**
   *
   * The outcome is unchanged because it never needed that premise. Trashing is
   * defined by WHERE something goes, not by what it is: a dying token really
   * does enter the bin (Caleb: "yes, for the purposes of triggers") and it does
   * not come from the stack, which is the whole of R40's definition. The lone
   * "nontoken" qualifier in the printed wording comes from Void Scavenger, a
   * card CUT from the set. Bena 2026-08-21, reaffirmed 2026-08-24.
   *
   * R137 (owner, same day) applies that sentence to the one object still
   * exempt from it: an {Unstable} card. It reaches here too, from destroy(),
   * for exactly the reason above — it enters a bin and it does not come from
   * the stack — and the erase that takes it back out a statement later is a
   * state-based sweep, not a reason the trash never happened. ⚠ So do NOT read
   * "a card that ends up erased was never trashed" out of anything here: the
   * six "when I am trashed" cards (Afflicting Anima, Blightwalker, Dropslime,
   * Maw of Despair, Nothyr, Thoughtripper) and the eight watchers of someone
   * else's trash (Cerebrox, Cthyrian Culler, Cthyrian Rector, Muck Rummager,
   * Murkdrop Distiller, Murkstalker, Splort, Unrelenting Horror) all fire on
   * an Unstable death now, and two of them (Rector, Distiller) reach back into
   * the bin and correctly find nothing — the same answer they already gave for
   * a dying token.
   *
   * R70: `anchor` is the DETACHED entity the card was, when the trash came from
   * one leaving play. It supplies the region (the one it died in, not the
   * trasher's action region — R12) and stands in for the ghost below.
   */
  noteTrashed(seat: Seat, name: CardName, from: 'hand' | 'deck' | 'play' | 'cache', anchor?: Entity): void {
    const where = from === 'play' ? 'from play' : from === 'hand' ? 'from hand'
      : from === 'cache' ? 'from the cache' : 'from the deck';
    const region = anchor?.region ?? this.actionRegion(seat);
    // per-battle trash ledger (R40: Dropslime counts every card trashed this
    // battle, Muck Rummager only your own) — battleCounters reset each battle
    // phase, so a trash outside battle deliberately counts for nothing
    if (this.s.phase === 'battle') {
      this.bumpBattleCounter(region, 'trashed');
      this.bumpBattleCounter(region, `trashed:${seat}`);
    }
    // R131: WHICH copy of `name` in this bin is the one that was just trashed.
    // A bin holds bare card names, so BinRef (R124/R64) fixes identity there
    // as (name, nth occurrence) — "copies of one card there are genuinely
    // indistinguishable". Every caller pushes the card into the bin BEFORE
    // calling here (toBin, destroy, leavePlay+afterDespawn, Hooba-Mon), so the
    // LAST occurrence is this instance. -1 when the card is not in the bin at
    // all (nothing to exclude, and no caller does that today).
    const binNth = this.player(seat).bin.filter(c => c === name).length - 1;
    const ev = this.ev('trashed', `${this.pname(seat)} trashes ${name} (${where}).`,
      { seat, card: name, from, region, ...(binNth >= 0 ? { binNth } : {}),
        ...(anchor?.token ? { token: true } : {}) });
    this.fireEvent('trashed', ev);
    this.fireOwnTrashTrigger(seat, name, region, ev, anchor);
  }

  /**
   * R40: the trashed card's OWN "when I am trashed" trigger — Dropslime,
   * Nothyr, Sacrifice Dude, Murkstalker and the rest of the trash family.
   *
   * fireEvent() scans entities IN PLAY, and a card being trashed is by
   * definition not in play any more: it is sitting in a bin. So its own
   * trigger cannot be found that way and has to be collected from the card.
   *
   * The ability is anchored on a DETACHED stand-in entity that is never put
   * into s.entities — it cannot be targeted, radiates no statics and turns up
   * in no other scan. It exists only to give `when` and the bounded-budget
   * bookkeeping (R9) something to read, and it is thrown away with this call,
   * which is right: each trashed card is its own instance. Its id is not in
   * s.entities, so `g.entity(ctx.sourceId)` correctly answers "there is no
   * such unit".
   *
   * R70: when the card is being trashed BECAUSE it left play, `anchor` is the
   * entity it was — already detached by destroy()/recall(), with exactly the
   * properties a stand-in needs and the real region, counters and owner as
   * well. The fabricated id -1 ghost is the fallback for a trash with no unit
   * behind it (a discard, a mill, a cached card binned). One mechanism, two
   * sources.
   *
   * Only `self: true` abilities fire here. "When ANOTHER card is trashed"
   * (Muck Rummager) belongs to a unit in play and the normal scan dispatches
   * it — which also gives R40's "excludes the trigger source itself" for free.
   */
  private fireOwnTrashTrigger(seat: Seat, name: CardName, region: number, ev: EngineEvent, anchor?: Entity): void {
    const abilities = this.card(name).abilities ?? [];
    if (!abilities.length) return;
    // `controller` is the TRASHER (R40: the owner of the bin it entered), which
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

  /** Discard a card from `seat`'s hand — it is trashed (R40). Returns the
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
   * trashed (R40). Returns what actually moved (an empty deck mills fewer). */
  mill(seat: Seat, n: number): CardName[] {
    const out: CardName[] = [];
    for (let i = 0; i < n; i++) {
      const name = this.deckOf(seat).shift();
      if (name === undefined) break;
      out.push(name);
      this.ev('info', `${this.pname(seat)} mills ${name}.`);
      this.toBin(seat, name, 'deck');
    }
    return out;
  }

  // ── player counters: rot & debt (R38 / R39) ─────────────────────────
  /** `seat`'s rot counters (R38). Optional field, always read through here. */
  rot(seat: Seat): number { return this.player(seat).rot ?? 0; }
  /** `seat`'s debt counters (R39). Optional field, always read through here. */
  debt(seat: Seat): number { return this.player(seat).debt ?? 0; }

  /** R38: "gain a rot" / "each opponent gains a rot". Gaining rot is not
   * damage and has no consequence of its own beyond the event. */
  gainRot(seat: Seat, n = 1): void {
    if (n <= 0) return;
    // R104: rot is a COUNTER a player accumulates (docs/08), which is what
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

  /** R39: "gain 2 debt". Paid off automatically at the end of the resource
   * step; gaining it costs nothing right now. */
  gainDebt(seat: Seat, n = 1): void {
    if (n <= 0) return;
    // R104: debt is the second player counter (docs/08), read by Proliferating
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
   * R39: pay 1 mana per debt, each mana removing one debt. Mandatory and
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
   * R38: at the start of deployment each player takes damage equal to their
   * own rot, in initiative order (determinism). The source is the damaged
   * player themselves — "Your rot is a source you control" (Caleb 2024-08-20)
   * — so the damage event carries controller = the victim. Rot never decays.
   *
   * There is no priority during deployment, so this cannot be responded to:
   * the settle() below resolves anything it triggers immediately, exactly the
   * way regroup/end-of-turn triggers are handled.
   */
  rotDamage(): void {
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
    this.settle();
  }

  /**
   * The one replacement effect in the engine (R38). Skittering Blight reads
   * "If rot would deal damage to you, instead put that many +1/+1 counters on
   * me", so rot damage cannot be applied inline — it has to be offered to the
   * cards in play first. Deliberately NARROW rather than a general replacement
   * framework (docs/04 has no replacement layer): a card declares
   * `replaceRotDamage` in its behavior, the hook is asked only for cards the
   * damaged player controls, and the first one to return true consumes the
   * whole event. Ties are resolved by entity id — the pool has exactly one
   * such card so no real ordering question arises; if a second ever ships,
   * this is where the "choose which replacement applies" decision goes.
   *
   * Skittering Blight prints the text under [Augment], so — exactly like
   * staticsFor() — the hook radiates from units in play AND from augment mods,
   * and a mod's hook is ANCHORED ON ITS HOST: the donated text reads from the
   * host's perspective, so "counters on me" lands on the host.
   */
  private replaceRotDamage(seat: Seat, n: number): boolean {
    const holders = this.anchored((h, a) =>
      this.donates(h, a, 'replaceRotDamage')                    // R127: off the FACES
      && a.controller === seat
      && !this.abilitiesSuppressed(a));                         // R62 (full projection)
    holders.sort((a, z) => a.holder.id - z.holder.id);
    for (const { face, anchor } of this.donorFaces(holders, 'replaceRotDamage')) {
      if (this.card(face).replaceRotDamage!(this, anchor, seat, n)) {
        // R102 — the replacement's log line is now a DISPATCHED event.
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
        // against it, and the whole R67 machinery (queue → collectTargets →
        // commitItem) does the asking. No new Suspension variant, no new
        // decision seam: the existing trigger path already runs during
        // deployment (processTriggerQueue's `then = 'resolve'`).
        //
        // Fired AFTER the hook returned true, so the replacement is already a
        // fact by the time anything hears about it: the damage is gone whether
        // or not the queued effect later finds a target (R86, and R98's
        // "a REPLACED hit still counts as dealt").
        //
        // `unit: anchor.id` and not `holder.id`: [Augment]-donated text reads
        // from its HOST, which is what `anchored()` means by the anchor, and a
        // `self: true` listener matches on the entity the ability is running
        // for. `region` rides too so the region-scoped dispatch (R12) finds it.
        const ev = this.ev('rotReplaced',
          `${face} replaces the ${n} damage ${this.pname(seat)}'s rot would deal.`,
          { seat, n, card: face, unit: anchor.id, region: anchor.region });
        this.fireEvent('rotReplaced', ev);
        return true;
      }
    }
    return false;
  }

  // ── the cache, prophecy & glimpse (R41-R46) ─────────────────────────
  //
  // The cache is a fourth zone beside hand, bin and deck — Caleb: "basically
  // exile with the intent to be referenced later", "a neutral zone like the
  // hand and bin". It is PUBLIC (R41): both players see every cached card and
  // the prophecy on it, so nothing here is ever redacted server-side.
  //
  // Being in the cache is NOT permission to play the card (Caleb 2024-12-03:
  // "You can only play cached cards that allow you to play them"). Permission
  // is either a fulfilled prophecy (free, ignoring affinity — R42) or a
  // glimpse-style until-end-of-turn stamp (pay the mana, ignore affinity —
  // R45). A card with neither stays cached, inert, forever.

  /** R41: `seat`'s cache. Optional field (additive, like rot/debt) — always
   * read through here so a pre-expansion state reads as an empty zone. */
  cache(seat: Seat): CachedCard[] { return this.player(seat).cache ?? []; }

  /** the writable cache array, materialising it on first use */
  private cacheMut(seat: Seat): CachedCard[] {
    const p = this.player(seat);
    return (p.cache ??= []);
  }

  /** R43: stamp a prophecy with its forward-counting anchors. `raw` is the
   * condition exactly as printed or granted; normalizeProphecy splits off a
   * trailing [Haste] release marker and produces the matchable form. */
  makeProphecy(raw: string): CachedProphecy {
    const { condition, norm, release } = normalizeProphecy(raw);
    return {
      condition, norm, ...(release ? { release } : {}),
      turn: this.s.turn,
      battles: this.s.battlesCompleted ?? 0,
    };
  }

  /** unrecognised conditions warned about already during THIS apply() call —
   * the fulfilment sweep runs on every settle(), and one line per unknown
   * condition per action is loud enough without being a flood */
  private warnedProphecies = new Set<string>();

  /**
   * Is `p` fulfilled for `seat` right now? R44: fulfilment LATCHES, so a
   * prophecy already marked fulfilled answers true forever, whatever the
   * state does afterwards.
   *
   * An unrecognised condition fails SAFELY and LOUDLY: it never throws, never
   * counts as fulfilled (so nothing becomes free by accident), and says so in
   * the game log — which is where a mis-transcribed or newly-printed condition
   * has to become visible.
   */
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
   * R44: latch every prophecy whose condition is now met. Called at the points
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
   * granted by rules text). opts.playable grants R45's glimpse-style
   * permission: playable until the end of THIS turn, then inert.
   */
  cacheCard(seat: Seat, name: CardName, from: 'hand' | 'bin' | 'deck' | 'play' | 'effect',
    opts: { prophecy?: string; playable?: boolean } = {}): CachedCard {
    // a stable handle for targeting the entry (Prismatic Observer): cache
    // INDICES shift as cards leave the zone, so a TargetRef cannot use one
    const cc: CachedCard = { card: name, uid: this.s.nextId++ };
    if (opts.prophecy !== undefined) cc.prophecy = this.makeProphecy(opts.prophecy);
    if (opts.playable) cc.playableUntilTurn = this.s.turn;
    this.cacheMut(seat).push(cc);
    const extra = cc.prophecy ? ` with Prophecy — ${cc.prophecy.condition}`
      : cc.playableUntilTurn !== undefined ? ' — playable until end of turn' : '';
    const ev = this.ev('cached', `${this.pname(seat)} caches ${name}${extra}.`,
      { seat, card: name, from, ...(cc.prophecy ? { condition: cc.prophecy.condition } : {}) });
    this.fireEvent('cached', ev);
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
   * R124: THE bin-removal choke point. Every removal of a card from a
   * player's bin — recall, revive-to-play, erase, cache, prophesy,
   * play-from-bin, exchange, recycle — goes through here, and nowhere else
   * splices a bin. That single-path rule is what makes "When I leave your
   * bin, ..." (Rotling) implementable at all: the 'leftBin' event fires here,
   * once per card, with `{ seat, card, reason }`, and R51's zone dispatch
   * delivers it to the card that just left. `msg` is '' — signal-only, the
   * stackFlash precedent — because every caller already announces the removal
   * in its own words, and the log should not say everything twice.
   *
   * Returns the removed name, or undefined when the index is out of range
   * (callers keep their own "it already left" messages).
   */
  removeFromBin(seat: Seat, binIndex: number, reason: string): CardName | undefined {
    const bin = this.player(seat).bin;
    if (binIndex < 0 || binIndex >= bin.length) return undefined;
    const [name] = bin.splice(binIndex, 1);
    const ev = this.ev('leftBin', '', { seat, card: name!, reason });
    this.fireEvent('leftBin', ev);
    return name;
  }

  /** cache a card out of `seat`'s bin (Delver of the Ephemeral, Murkdrop
   * Distiller). The card LEAVES the bin — it is not copied. */
  cacheFromBin(seat: Seat, binIndex: number, opts: { prophecy?: string; playable?: boolean } = {}): CachedCard | undefined {
    const name = this.removeFromBin(seat, binIndex, 'cached');   // R124
    if (name === undefined) return undefined;
    return this.cacheCard(seat, name, 'bin', opts);
  }

  /** cache the top `n` cards of `seat`'s deck (Blurf; and the engine half of
   * glimpse). Returns what actually moved — a short deck caches fewer. */
  cacheTopOfDeck(seat: Seat, n: number, opts: { prophecy?: string; playable?: boolean } = {}): CardName[] {
    const out: CardName[] = [];
    for (let i = 0; i < n; i++) {
      const name = this.deckOf(seat).shift();
      if (name === undefined) break;
      out.push(name);
      this.cacheCard(seat, name, 'deck', opts);
    }
    return out;
  }

  /**
   * R45: Glimpse N — reveal the top N cards of the deck, cache exactly **ONE**
   * of the glimpser's choice, and recycle the other N−1 to the BOTTOM of the
   * deck, top-first. Until end of turn the cached card may be played as if it
   * were in hand, ignoring affinity but still paying the mana cost (Caleb
   * 2023-08-13) and still obeying timing (Caleb 2025-12-28). The reveal is
   * genuinely public — the cache is public information (R41).
   *
   * ⚠ This USED to cache all N; R45 was corrected on 2026-08-19. Every printed
   * reminder for N>1 reads "Reveal the top X cards of the deck and **cache
   * one** … **Recycle the rest**" (Premonition, Oracle of Foretelling,
   * Celestial Purge, Dematerialize); the N=1 cards read "reveal the top card
   * and cache it" only because the two readings coincide there. Glook's
   * "Glimpse 1, X times" is X separate one-card glimpses. `Big Glimpse Card`
   * is a deliberate PILE variant and does not route through here.
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
    const deck = this.deckOf(seat);
    const revealed = deck.slice(0, Math.min(n, deck.length));
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
    deck.splice(0, revealed.length);
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
   * R70: the fact bundle every leave-play event carries — 'died'/'despawned'
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
   * formation cleanup lands after the death event): pull the unit and its
   * mods out of s.entities, push each nontoken mod into its owner's bin
   * (R69: a token mod has no card of its own — erased), and close the
   * formation gap. Returns the detached mods, or null when the unit was
   * already gone. The despawn event, the R40 mod trashes (afterDespawn) and
   * where the CARD goes stay with the caller — that is where the verbs differ.
   *
   * R157 §10: the face is turned back over HERE, before anything reads
   * `u.card` — so `leftPlayFacts`, the log line, the hand/cache push and the
   * R69 token sweep all name the FRONT face, which is the card that is really
   * moving zones.
   */
  private leavePlay(u: Entity): Entity[] | null {
    if (!this.entity(u.id)) return null;
    this.revertFace(u);
    delete this.s.entities[u.id];
    const mods = u.mods.map(id => this.entity(id)).filter((m): m is Entity => !!m);
    for (const m of mods) {
      delete this.s.entities[m.id];
      if (!m.token) this.player(m.owner).bin.push(m.card);   // R69: a token MOD has no card of its own — erased
    }
    this.removeFromFormation(u.id);
    return mods;
  }

  /**
   * R101/R157 §10 — TURN `u` OVER onto its back face `back`.
   *
   * The same entity, the same id, the same slot, counters, damage, mods and
   * `budgets`: a transform is not a new unit, it is one card with a different
   * side up (R101's argument, unchanged — `Entity.card` IS the identity, so
   * assigning it moves stats, name, text, targeting and the client render
   * together). What R157 §10 adds is that the flip is REVERSIBLE, so the front
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
   * R157 §10 — turn a transformed card BACK over as it leaves play: *"In all
   * zones, other than play, it exists as the front side."*
   *
   * Run at the TOP of every route out of play (`leavePlay` for recall and
   * cache, `disposeToBin` for a death and an exchange, `eraseFromPlay`), so
   * every consumer downstream — the bin/hand/cache push, `leftPlayFacts`, the
   * trash record, the R69 sweep, the erased pile and the log — sees the front
   * face without any of them knowing transforms exist. A no-op for the
   * overwhelming majority of entities, which were never turned over.
   *
   * The 'died'/'despawned' event therefore names the FRONT face too. That is
   * deliberate: the event's job is to tell a listener which CARD moved and
   * where it now is (R70/R140 — a listener reaches into the bin for it), and
   * the card in the bin is the front one. Nothing in the pool triggers off a
   * back face's name.
   */
  private revertFace(u: Entity): void {
    if (!u.frontFace) return;
    const back = u.card;
    u.card = u.frontFace;
    delete u.frontFace;
    // R157 §10: the flip is a real, visible change of what the card IS —
    // "it went to the bin as a 0/2 Scholar" is a fact a player plans around
    // (it is recurrable now), so it is announced rather than done silently.
    this.ev('info',
      `${back} turns back over — it leaves play as ${u.card}, the front face of the card.`,
      { unit: u.id, card: u.card, back });
  }

  /** The tail cacheUnit() and recall() share, once their despawn event is the
   * last event logged: fire it, then (R40, after the despawn so the log reads
   * in order) trash every nontoken mod — they entered a bin from play. */
  private afterDespawn(u: Entity, mods: Entity[]): void {
    const ev = this.events[this.events.length - 1]!;
    this.fireEvent('despawned', ev, u);
    for (const m of mods) if (!m.token) this.noteTrashed(m.owner, m.card, 'play', m);   // R70
    // R65 (2026-08-25): and the TOKEN mods reach the public erased pile, which
    // is the one branch of that rule that never had a sweep OR an announcement.
    // leavePlay() deletes a token mod outright — its own comment already calls
    // that an erase ("a token MOD has no card of its own — erased") — but
    // nothing said so out loud, so a Wraith grafted onto a unit was filed on
    // the pile when its host DIED or was EXCHANGED (disposeToBin emits exactly
    // this line, R153) and vanished in silence when the host was RECALLED or
    // CACHED. Measured before the fix, one Wraith on one host:
    //     destroy  erased-pile +2, 2 'erased' events
    //     recall   erased-pile +0, 0 events
    //     cache    erased-pile +0, 0 events
    // That is R137's defect one object over — the same mod behaving differently
    // depending on how its host left play — and R65 turns on the ERASE, not on
    // the verb that caused it. No zone, entity or timing changes here; this
    // only announces something that was already happening.
    const tokenMods = mods.filter(m => m.token);
    if (tokenMods.length) {
      this.ev('erased',
        `${tokenMods.map(m => m.card).join(', ')} — erased with ${u.card}: a token mod has no card to bin.`,
        { seat: u.owner, cards: tokenMods.map(m => m.card) });
    }
  }

  /**
   * R46: a unit in play is CACHED (Grob, Waxen Witness). The card goes to its
   * OWNER's cache; its mods do NOT travel with it — they go to their own
   * owners' bins, FROM PLAY, so wave A's R40 classification trashes every
   * nontoken one (Caleb 2024-09-15).
   *
   * R69, extended to the CACHE on 2026-08-22: a cached TOKEN visits the cache
   * and is erased out of it by the same state-based sweep, so the 'cached'
   * event fires with the token really sitting there. ⚠ ENGINE'S CALL, not a
   * designer ruling — Caleb's 2025-06-15 answer is about a HAND and there is
   * no statement about the cache at all. It is here because the alternative is
   * one zone behaving differently from the other two for no stated reason.
   *
   * R157 §27 — `opts.to` is WHOSE CACHE, and it exists because the owner
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
    const seat = opts.to ?? u.owner;
    // R70: the facts ride the event. `cache` mirrors recall()'s `hand` — WHERE
    // the card went, which a listener cannot recover from `owner` once the two
    // can differ.
    const evData = { ...this.leftPlayFacts(u), to: 'cache', cache: seat };
    this.ev('despawned',
      `${u.card} leaves play for ${this.pname(seat)}'s cache` +
      (mods.length ? ` (its ${mods.length} mod(s) stay behind → bin)` : '') +
      (u.token ? ', then erased (token).' : '.'),
      evData);
    this.afterDespawn(u, mods);
    const cc = this.cacheCard(seat, u.card, 'play', opts);
    // R69's sweep, on the cache this time — `cc.uid` names the entry we just
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
   *              affinity (Caleb 2024-10-28). R42.
   *   'glimpse'  a live until-end-of-turn permission: pay the mana, ignore
   *              affinity. R45.
   *   null       no permission — being cached is not enough (R41).
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

  /** The timing a cached card is played at. Normally its printed timing ("as
   * if it were in your hand"); a prophecy release marked [Haste] overrides it
   * for the prophecy release only (R42, Divine Intervention). */
  cachedTiming(seat: Seat, index: number, via: 'prophecy' | 'glimpse'): CardDef['timing'] {
    const cc = this.cache(seat)[index]!;
    if (via === 'prophecy' && cc.prophecy?.release) return cc.prophecy.release;
    return this.card(cc.card).timing;
  }

  /** Affordability ignoring AFFINITY but nothing else — what glimpse's
   * "ignoring affinity" (R45) needs. The bill must match what payCard will
   * actually charge: printed mana PLUS active cost modifiers (R59) and any
   * life tax (R60) — checking printed mana alone would offer a play whose
   * payment then throws (mana) or kills the payer (life). */
  canPayManaOnly(seat: Seat, name: CardName): boolean {
    if (this.openMana(seat) < this.manaToPlay(seat, name)) return false;
    if (!this.canPayLife(seat, this.lifeToPlay(seat, name))) return false;
    // R122: the imposed-sacrifice gate is part of the bill too — a glimpse
    // release with no unit to sacrifice must not be offered either.
    const sacs = this.unitsToPlay(seat, name);
    return sacs === 0 || this.unitsOf(seat, this.actionRegion(seat)).length >= sacs;
  }

  /** `viewer` looks at `owner`'s hand (Bripp etc.): snapshot it so the client
   * can keep showing what was seen — nobody should need pen and paper. The
   * snapshot goes stale (cleared) when the owner's hand next mixes unknowably
   * (their draft-step merge). */
  revealHandTo(viewer: Seat, owner: Seat): void {
    this.s.seenHand[viewer] = { turn: this.s.turn, cards: [...this.player(owner).hand] };
    this.ev('info', `${this.pname(viewer)} looks at ${this.pname(owner)}'s hand.`);
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
   * The engine tracks owner and controller separately everywhere else and says
   * so at R65 ("each card reaches ITS OWN owner's erased pile — a virus on an
   * enemy spell is the enemy's card"), so this was a missing parameter rather
   * than a reading. It defaults to `seat`, which is right for the overwhelming
   * majority of callers: a TOKEN is created by whoever creates it, and a card
   * played out of your own hand, bin or cache is yours already.
   *
   * NOT a control change. R8 moves a unit between controllers and leaves the
   * card where it belongs; this is the other half of the same distinction, and
   * a caller that wants both (Uglk: "each player puts a unit from THEIR bin
   * into play under an OPPONENT's control") passes the opponent as `seat` and
   * its owner as `opts.owner`.
   */
  spawnUnit(seat: Seat, name: CardName, region: number, opts: { token?: boolean; tokenStats?: [number, number]; counters?: number; from?: 'hand' | 'cache' | 'bin'; spot?: FormationSpot; owner?: Seat; wearing?: SpawnFace } = {}): Entity {
    /**
     * R104: a UNIT TOKEN is a creation, and a creation is replaceable — before
     * anything exists. `token: true` is what makes this a creation; a plain
     * `spawnUnit` is a real card being put into play (Exhume, Wake the Dead),
     * which creates nothing and is not replaceable.
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
     * ⚠ NOT replaceable, on purpose: `opts.spot` (R29's play-into-formation).
     * That path is a CARD being played into a line, not a token being created,
     * and it never carries `token: true`.
     */
    if (opts.token && !this.substitutingToken) {
      const req = this.replaceTokenCreation({
        form: 'unit', name, x: opts.counters ?? 0, seat, region,
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
    // spawn is no placement and never becomes one. Deliberately NOT routed
    // through replaceCounters: whether a redirect (Counter Thief) can steal a
    // token's own spawn counters is an unsourced rules question.
    //
    // R130: the actor of a spawn's OWN counters is the seat creating it. There
    // is no "putter" in the usual sense — nobody puts a Robot's X on it, it
    // arrives holding them — so the answer had to be chosen rather than found,
    // and `seat` is the only party involved: the source of the counters is the
    // source of the token. It reaches the AMOUNT layer only (an allied Flux
    // Resonator still makes a Robot X enter as X+1, report #88, which is the
    // behaviour this line has to preserve); no `countersChanged` fires here, so
    // no "when YOU put a counter" trigger sees a spawn, exactly as before.
    let spawnCounters = opts.counters ?? 0;
    if (spawnCounters >= 1) {
      spawnCounters += this.amountDelta({
        kind: 'counters', region, amount: spawnCounters, unit: u, combat: false,
        sourceSeat: seat,
      });
    }
    if (spawnCounters) u.counters = spawnCounters;
    // R29: a card PLAYED into an open spot in the formation is put there
    // BEFORE the spawn event exists, so no listener and no player ever sees it
    // standing anywhere else. See takeSpot.
    const placed = opts.spot ? this.takeSpot(u, seat, opts.spot) : null;
    // R49: `from` is set only when this spawn IS a card being PLAYED out of a
    // zone (resolveItem for a unit / spell unit card). A unit created by an
    // effect carries no zone, which is what keeps "when you play a card from
    // anywhere other than your hand" (Proph) off effect-created units.
    // CARD-TODO #17: when the card is not the controller's, the log says so —
    // a borrowed unit reads differently from a naturalised one, and "it dies
    // to THEIR bin" is a fact the table has to be able to see coming. The
    // `owner` key is emitted only when it differs, so every existing reader of
    // a 'spawned' event keeps the payload it already had.
    const ev = this.ev('spawned',
      `${this.pname(seat)} spawns ${name}${spawnCounters ? ` (${spawnCounters} +1/+1)` : ''}`
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
     * R147 — and the same for a body that ENTERS as something else (Borrower
     * of Forms). Exactly R29's placement rule one field over: applied before
     * `fireEvent`, which is the single door every listener goes through, so no
     * watcher and no player ever sees the body standing here as itself.
     * Logged UNDER the spawn line for the same reason the placement is —
     * R118 ruling 1 keeps `Entity.card` as the physical card, so the spawn
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
    // R119: a unit that came from a ZONE was PLAYED, so it burns the Deferral
    // Drone charge; one that came from nowhere was CREATED and does not. Same
    // `opts.from` test R49 uses just above, and the same place the card's own
    // bookkeeping trigger used to read it — the spend is engine-side now so a
    // dead Drone cannot leave a paid-for charge unspendable.
    if (opts.from !== undefined) this.spendNextPlayDiscount(seat);
    this.fireEvent('spawned', ev);
    // R104: record the creation in the open batch, so "each unique token you
    // created" has a creation to be unique across. After the spawn event, so a
    // batch replacement can never observe a half-created board. The REQUEST
    // (opts.counters), not the amount-modified outcome: a batch copy replays
    // the creation, and the layer applies to the copy on its own spawn.
    if (opts.token) {
      this.noteTokenCreated({ form: 'unit', name, x: opts.counters ?? 0, seat, region });
    }
    return u;
  }

  // ── the Wraith token (R71) ───────────────────────────────────────────
  //
  // "Wraith — cost 0 [d], 3/3, Blight Zombie Token Unit. [Augment] At the start
  // of deployment, put a -1/-1 counter on an ally. When I die, Augment a Wraith
  // onto an ally." (Redesigned 2026-08-21; the retired 4/4 printing shrank
  // itself on attack/block and RE-HOMED itself on death — that was R47, now
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
    // R104: the half of Cosmic Conspirator that was completely dead. The old
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
    // R129: this event was LOGGED and never DISPATCHED, so "when you create a
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
   * R104: TWO replacement seams sit above the commit, in printed order.
   * "Put that many counters PLUS ONE instead" (Flux Resonator, Proliferating
   * Slime) changes the number, so it is an `AmountMod` and it is summed — two
   * Resonators put two more. "Those counters are placed on ME instead"
   * (Counter Thief) changes the recipient, so it is a redirect and the first
   * claimant consumes it. The amount runs FIRST, because the thief steals what
   * would have been placed, plus-one included.
   *
   * Both are consulted, not re-entered, which is why the module-level `let
   * proliferating` flag that used to guard this path is gone (report #60).
   *
   * R130: a placement KNOWS WHO MADE IT. `by` is the seat putting the counters
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
    // R130: explicit actor first, then the resolving effect's controller. Both
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

  /** grant an attribute until regroup (cleared with temp stats, R11 step 3) */
  addTempAttr(target: Entity, attr: import('./types.ts').Attr): void {
    (target.tempAttrs ??= []).push(attr);
    this.ev('statChanged', `${target.card} gains {${attr}} until regroup.`, { unit: target.id, attr });
  }

  /**
   * R62: switch a unit's attribute and/or ability layer off UNTIL REGROUP —
   * "Target unit loses all attributes and abilities until regroup"
   * (Suppression Field), "…and loses all attributes until regroup" (Formless).
   * `by` is the card to blame, kept so the text box can say who did it.
   *
   * The continuous form of the same layer is a StaticMod flag and needs no
   * primitive: it is simply true while the projector is there.
   */
  suppress(target: Entity, by: CardName, what: { attrs?: boolean; abilities?: boolean }): void {
    const sup = (target.suppressed ??= {});
    if (what.attrs) sup.attrs = by;
    if (what.abilities) sup.abilities = by;
    const lost = [what.attrs ? 'attributes' : '', what.abilities ? 'abilities' : '']
      .filter(Boolean).join(' and ');
    this.ev('statChanged', `${target.card} loses all ${lost} until regroup (${by}).`,
      { unit: target.id, suppressed: what });
    // an attribute the unit was relying on (Tough, a static's grant) can be
    // what was keeping it alive
    this.checkDeaths();
  }

  /**
   * R63: grant a unit an authored ability until regroup — "Your units gain
   * 'When I die, create a Robot 3.' until regroup" (Reforge the Dead).
   *
   * A REFERENCE, not a copy: `card`/`via`/`index` address the ability in the
   * registry, so the grant is plain serializable data and replays identically.
   * The granting card normally parks the granted ability in its own
   * `abilities` list, where nothing else can fire it — a spell is never a unit
   * in play, so fireEvent's scan never reaches it except through this grant.
   */
  grantText(target: Entity, g: import('./types.ts').GrantedText): void {
    (target.granted ??= []).push(g);
    this.ev('statChanged', `${target.card} gains "${g.text}" until regroup (${g.from}).`,
      { unit: target.id, granted: g.text });
  }

  /** "You gain N life" — the plain primitive (Prismatic Observer) and the
   * engine half of {Blessed}. Life gain is never lethal, so unlike loseLife
   * it has no state check to run. */
  gainLife(seat: Seat, n: number, why: string): void {
    if (n <= 0) return;
    // R104, in printed order. The LOCK is absolute ("can't change" — Suspend),
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
   * R48 {Blessed}: "Damage dealt by a blessed source causes its controller to
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

  loseLife(seat: Seat, n: number, why: string): void {
    // R104: "Target player's life total CAN'T CHANGE during this battle"
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
    const p = this.player(seat);
    p.life -= n;
    // per-battle life-loss ledger (R14 battle counters; read by e.g. Soul Siphon)
    if (this.s.battle) this.bumpBattleCounter(this.s.battle.region, `lifeLost:${seat}`, n);
    const ev = this.ev('lifeLost', `${p.name} loses ${n} life (${why}) → ${p.life}.`,
      { seat, n, why, ...(this.s.battle ? { region: this.s.battle.region } : {}) });
    this.fireEvent('lifeLost', ev);   // "when a player loses life" triggers (region-scoped in battle, R12)
    if (p.life <= 0 && this.s.winner === null) {
      this.s.winner = other(seat);
      this.s.phase = 'gameover';
      this.s.resolving = null;   // R78: nothing is resolving any more — the game is over
      this.ev('gameOver', `*** ${this.pname(other(seat))} wins! ***`, { winner: other(seat) });
      throw new GameEnded();
    }
  }

  /** R65: end the game with `seat` as the loser — the concede path. Shares
   * loseLife's ending exactly (winner, phase, event, GameEnded) so nothing
   * downstream has to tell the two apart. */
  concede(seat: Seat): void {
    if (this.s.winner !== null) return;
    this.s.winner = other(seat);
    this.s.phase = 'gameover';
    this.s.resolving = null;   // R78
    this.ev('gameOver', `*** ${this.pname(other(seat))} wins — ${this.pname(seat)} conceded. ***`,
      { winner: other(seat), conceded: seat });
    throw new GameEnded();
  }

  /**
   * R48 {Lethal}: "Any combat damage from a lethal unit will kill a player."
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
   * The engine's second (and last) replacement hook (R38, Blightsea Polyp):
   * a column is about to deal `amount` combat damage to `seat`. Same shape and
   * same anchoring as replaceRotDamage — units in play and augment mods (whose
   * hook reads from their HOST) — but region-scoped instead of seat-scoped:
   * the printed text says "columns" without an owner, so every holder IN THIS
   * REGION is offered the replacement and the card decides whose columns it
   * cares about. First to return true consumes the hit; ties by entity id.
   */
  private replaceCombatDamage(seat: Seat, amount: number,
    info: { attacker: Seat; region: number; attrs: Set<string>; pure: boolean }): number {
    const holders = this.anchored((h, a) =>
      this.donates(h, a, 'replaceCombatDamageToPlayer')          // R127: off the FACES
      && a.region === info.region
      && !this.abilitiesSuppressed(a));                         // R62 (full projection)
    holders.sort((a, z) => a.holder.id - z.holder.id);
    let left = amount;
    for (const { face, anchor } of this.donorFaces(holders, 'replaceCombatDamageToPlayer')) {
      if (left <= 0) break;
      const r = this.card(face).replaceCombatDamageToPlayer!(this, anchor, seat, left, info);
      // R98: the return widened from all-or-nothing to a NUMBER — the damage
      // LET THROUGH — so a card can absorb part of a hit and pass the rest on.
      // `true`/`false` keep their old meaning (all / none), which is what makes
      // this a widening rather than a break: Blightsea Polyp still returns true.
      const through = r === true ? 0 : r === false ? left : Math.max(0, Math.min(left, r));
      if (through === left) continue;                           // this holder declined
      this.ev('info',
        `${face} replaces ${left - through} of the ${left} combat damage to ` +
        `${this.pname(seat)} (the damage still counts as having been dealt).`,
        { seat, amount: left - through, by: face });
      left = through;
    }
    return left;
  }


  // ── R104: THE REPLACEMENT-EFFECT LAYER ──────────────────────────────
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
  // choosing a target is public and respondable — which is why R102 (Beyond,
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
  //   · the `replaceX` hooks below — FIRST-TRUE-CONSUMES. They substitute or
  //     redirect the thing itself, and a thing can only be replaced once.
  //
  // Deliberately NO general "any event" framework, for the reason
  // replaceRotDamage's own comment already gives: one named hook per
  // replaceable quantity, so every replaceable thing in the engine is
  // greppable and nothing becomes replaceable by accident.

  /**
   * R104: is `seat`'s life total LOCKED right now? ("Target player's life
   * total can't change during this battle." — Suspend.)
   *
   * A battleCounter and not an `anchored()` radiator, for R96's reason: Suspend
   * is a SPELL. It resolves and goes to the bin, so there is nothing left in
   * play to radiate from, and what it grants is a fact about this battle —
   * which is exactly what battleCounters are. Region-KEYED gives R14's "this
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
  /** R104: lock `seat`'s life total for the rest of this region's battle. */
  lockLife(seat: Seat, region: number): void {
    this.bumpBattleCounter(region, `lifeLock:${seat}`);
  }

  /**
   * R104: `seat` is about to gain `n` life — may a card replace it?
   *
   * Nullbringer: "[Augment] If a player would gain life, they lose that much
   * life instead." Shaped on `replaceRotDamage` (first true consumes, ties by
   * entity id, radiating from units in play and from augment mods whose hook
   * reads from their HOST) but NOT seat-scoped: the printed subject is "a
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
      this.donates(h, a, 'replaceLifeGain')                     // R127: off the FACES
      // R12, by E.fireEvent's own rule: `gainLife` writes a region onto its
      // event only inside a battle, and fireEvent dispatches an event with no
      // region to EVERY listener. A life gain outside a battle is therefore
      // not a regional thing, and narrowing it here would quietly shrink a
      // card that used to be a `lifeGained` trigger.
      && (!this.s.battle || a.region === this.s.battle.region)
      && !this.abilitiesSuppressed(a));                       // R62 (full projection)
    holders.sort((a, z) => a.holder.id - z.holder.id);
    for (const { face, anchor } of this.donorFaces(holders, 'replaceLifeGain')) {
      if (this.card(face).replaceLifeGain!(this, anchor, seat, n, why)) {
        this.ev('info',
          `${face} replaces the ${n} life ${this.pname(seat)} would have gained.`,
          { seat, n, by: face, unit: anchor.id });
        return true;
      }
    }
    return false;
  }

  /**
   * R104: `n` counters are about to be put on `target` — may a card redirect
   * them?
   *
   * Counter Thief: "[Augment] If one or more counters would be placed on one
   * or more units during battle, those counters are placed on me instead."
   * Returns the unit they should land on; `target` itself when nobody claims
   * them. A REDIRECT and never a multiplier — the counters land on exactly one
   * unit either way, which is what "instead" means.
   *
   * `inReplaceCounters` is the latch that makes this safe. The redirect really
   * does re-enter (the thief puts the counters on itself, and that is a
   * counter placement), and skipping the anchor would not be enough: two
   * thieves would bounce one placement between them forever.
   */
  private replaceCounters(target: Entity, n: number): Entity {
    if (this.inReplaceCounters) return target;
    const holders = this.anchored((h, a) =>
      this.donates(h, a, 'replaceCounters')                   // R127: off the FACES
      && a.region === target.region
      && !this.abilitiesSuppressed(a));                       // R62 (full projection)
    holders.sort((a, z) => a.holder.id - z.holder.id);
    const donors = this.donorFaces(holders, 'replaceCounters');
    this.inReplaceCounters = true;
    this.replacementDepth++;
    try {
      for (const { face, anchor } of donors) {
        const to = this.card(face).replaceCounters!(this, anchor, target, n);
        if (!to || to.id === target.id || !this.entity(to.id)) continue;
        this.ev('info',
          `${face}: the ${Math.abs(n)} counter(s) for ${target.card} are placed on `
          + `${to.card} instead.`,
          { unit: to.id, from: target.id, n, by: face });
        return to;
      }
    } finally { this.inReplaceCounters = false; this.replacementDepth--; }
    return target;
  }

  // ── R104: token creation, and the BATCH ─────────────────────────────
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
  // THE BATCH IS ONE RESOLVING PART, which is the unit R80 already gave effect
  // damage ("One resolution of one effect, one batch"). `resolveParts` opens
  // one around `def.run` and settles it when the part finishes; a creation
  // with no part open (engine-internal, a test's direct call) is its own batch
  // of one, so nothing is ever left unsettled. A part that SUSPENDS on a
  // decision discards its batch unsettled, because the engine rolls the world
  // back to the part boundary and replays it (R85) — settling would pay the
  // batch out twice.

  /** R104: the open token-creation batch, or null outside a resolving part. */
  private tokenBatch: TokenRequest[] | null = null;
  /** R104: a per-token replacement is already performing its substitute, so
   *  the substitute must not be offered for replacement again. */
  private substitutingToken = false;
  /** R104: a BATCH replacement is creating its extras. They are not part of
   *  the batch that produced them — "none applies to itself" — and without
   *  this latch a batch of one extra would ask the same holder again forever. */
  private inTokenBatchSettle = false;

  /**
   * R104: raise a decision from inside engine code, the way `E.glimpse` does.
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
   * R104: one token is about to be created — may a card substitute it?
   *
   * Cosmic Conspirator: "If you would create a Robot, Poison, Crystal or
   * Fireball, you may instead create a token of any of these types." First
   * non-null consumes. The hook may ask a question (`askInResolution`), and a
   * question raised here suspends the whole resolving part and replays it —
   * which is correct and is why the substitution must happen before ANY state
   * is mutated: the rollback would otherwise undo a token that was already on
   * the board.
   */
  private replaceTokenCreation(req: TokenRequest): TokenRequest {
    const holders = this.anchored((h, a) =>
      this.donates(h, a, 'replaceTokenCreation')              // R127: off the FACES
      && a.region === req.region
      && !this.abilitiesSuppressed(a));                       // R62 (full projection)
    holders.sort((a, z) => a.holder.id - z.holder.id);
    const donors = this.donorFaces(holders, 'replaceTokenCreation');
    this.replacementDepth++;
    try {
      for (const { face, anchor } of donors) {
        const sub = this.card(face).replaceTokenCreation!(this, anchor, req);
        if (!sub) continue;
        if (sub.name === req.name && sub.form === req.form) return req;   // declined in substance
        this.ev('info',
          `${face}: a ${req.name} ${req.x} is created as a ${sub.name} ${sub.x} instead.`,
          { by: face, was: req.name, now: sub.name, x: sub.x, seat: req.seat });
        return sub;
      }
    } finally { this.replacementDepth--; }
    return req;
  }

  /**
   * R104: record a token that was just created into the open batch — or, with
   * no batch open, settle it as a batch of one.
   */
  private noteTokenCreated(req: TokenRequest): void {
    if (this.inTokenBatchSettle) return;         // an extra is not part of its own batch
    if (this.tokenBatch) { this.tokenBatch.push(req); return; }
    this.settleTokenBatch([req]);
  }

  /**
   * R104: one creation batch has finished — may a card add to it?
   *
   * Automaton of Abundance: "[Augment] If you would create one or more unit
   * tokens, instead create those tokens plus an additional copy of each unique
   * token you created." First non-null consumes, like every other replacement:
   * a creation is replaced once.
   *
   * The extras are created INLINE, in the same resolution, with nothing on the
   * stack in between and no priority window — the R103 test for "part of
   * resolution, not a trigger". They are NOT themselves batched
   * (`this.tokenBatch` is parked for the duration), which is what "none
   * applies to itself" means here and is why the module-level `aoaCopying`
   * flag it replaces is gone.
   */
  private settleTokenBatch(batch: TokenRequest[]): void {
    if (!batch.length) return;
    const holders = this.anchored((h, a) =>
      this.donates(h, a, 'replaceTokenBatch')                 // R127: off the FACES
      && a.region === batch[0]!.region
      && !this.abilitiesSuppressed(a));                       // R62 (full projection)
    if (!holders.length || this.inTokenBatchSettle) return;
    holders.sort((a, z) => a.holder.id - z.holder.id);
    const donors = this.donorFaces(holders, 'replaceTokenBatch');
    this.inTokenBatchSettle = true;
    this.replacementDepth++;
    try {
      for (const { face, anchor } of donors) {
        const extra = this.card(face).replaceTokenBatch!(this, anchor, batch);
        if (!extra || !extra.length) continue;
        this.ev('info',
          `${face}: the creation is replaced — ${extra.length} more token(s) `
          + `(${extra.map(r => r.name).join(', ')}) are created with it.`,
          { by: face, unit: anchor.id, n: extra.length });
        for (const r of extra) this.createToken(r);
        return;                                   // first to replace consumes
      }
    } finally { this.inTokenBatchSettle = false; this.replacementDepth--; }
  }

  /**
   * R104: create one token from a `TokenRequest`. The single place the two
   * creation primitives are chosen between, so a replacement that swaps a unit
   * token for a spell token (Robot → Fireball) needs no caller to know.
   */
  createToken(req: TokenRequest): Entity {
    return req.form === 'unit'
      ? this.spawnUnit(req.seat, req.name, req.region, { token: true, ...(req.x ? { counters: req.x } : {}) })
      : this.createSpellToken(req.seat, req.name, req.x, req.region);
  }

  /**
   * R98: THE choke point for damage about to be dealt to a UNIT. Returns the
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
   * R38's replacements do not unmake the damage: "Replacing the damage does
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
   * source's live attributes and R61's {Pure} flag for the same reason: a hook
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
   * R98: pay out "Put a +1/+1 counter on it for each damage prevented this
   * way", once the commit loop that prevented the damage has finished.
   *
   * Deferred rather than paid inside `preventUnitDamage` because `addCounters`
   * runs `checkDeaths`: paying on the spot would resolve a death in the middle
   * of a batch that R80 made simultaneous. Called at the end of BOTH commit
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
      this.addCounters(u, n);
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
   * R80: ALL of one effect's damage, dealt at once.
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
   * Handles Reaping (kill → draw), Electric (R4: excess beyond lethal passes
   * along a controller-chosen, non-overlapping adjacent path, planned fully
   * before any damage commits, and no formation changes during distribution)
   * and {Piercing} (excess beyond lethal goes to the victim's controller —
   * see `poolToKill` below). Both are planned against what the victim will
   * REALLY have taken once the batch commits — damage earlier hits in this
   * same batch already assigned included — rather than against a stale board.
   */
  dealEffectDamageAll(ctx: EffectCtx, hits: { target: ResolvedTarget; n: number }[]): void {
    /**
     * CARD-TODO #16 — AN EMPTY BATCH IS THE ONE SILENCE THAT IS ALWAYS A BUG.
     *
     * Every "I deal N damage to each opponent / each enemy unit" card in the
     * pool builds a hit list and hands it over. With no opponent PRESENT in the
     * region (R25) or no enemy unit on the board that list is empty, and until
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
     *  · a fully PREVENTED batch (R98). Prevention runs AFTER `!order.length`,
     *    in the `received` loop, so a prevented batch always has a non-empty
     *    `order` and cannot arrive here at all. `preventUnitDamage` already
     *    logs the prevention, and R98 says the damage was never dealt.
     *
     * Also deliberately NOT caught: a non-empty `hits` whose every target has
     * left play between cast and resolution. That is R5's "your target is
     * gone", the cards that can reach it announce it themselves (see
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
     * R94: the source's LIVE attributes, not its printed ones.
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
     * its own arithmetic; flagged in R94, untouched.
     */
    const src = ctx.sourceId !== undefined ? this.entity(ctx.sourceId) : undefined;
    const srcAttrs: Set<string> = src
      ? new Set(this.ownAttrs(src))
      : new Set(this.card(ctx.sourceName)?.attrs ?? []);
    // R79: attributes a virus donated to this effect while it sat on the stack
    // ("mostly Deadly, Piercing, and Powerful are impacted by this" — Caleb
    // 2025-03-06). Read here rather than from the printed card alone, which is
    // the seam the SPELLS half of Emberflame Enlightener was parked on.
    for (const a of ctx.grantedAttrs ?? []) srcAttrs.add(a);
    const poisonous = srcAttrs.has('Poisonous');
    const resonant = srcAttrs.has('Resonant');
    const piercing = srcAttrs.has('Piercing');
    /**
     * R106 {Unaware}: is THIS recipient's hit read at printed stats?
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
     * The recipient side is `unaware`, which is column-shared (R19), so a unit
     * standing beside Bubb in a formation is read at printed here too.
     */
    const srcUnaware = srcAttrs.has('Unaware');
    const collapsed = (u: Entity): boolean => srcUnaware || this.unaware(u);
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
     *  - {Vulnerable} (R23): the victim RECEIVES double, so only half the pool
     *    is needed to kill it and the pre-double remainder carries on sooner.
     *    That is what "excess is computed AFTER the receive-side doubling"
     *    means — the pool is counted in what the SOURCE deals, the toughness
     *    in what the victim RECEIVES, and `mult` is the exchange rate.
     *  - damage this batch has already assigned to `u` counts, because R80
     *    coalesces a recipient named twice into one hit: the number that
     *    matters is what it will really have taken when the batch commits.
     *  - {Deadly} (R21) caps the need at ONE point. RAQ "[Solved] Excessive
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
     * COMMIT below (R98). A shield therefore changes how much damage is DEALT
     * and nothing at all about how much pierces.
     *
     * {Poisonous} is not special-cased on purpose: the damage arrives as
     * permanent -1/-1 counters, and `checkDeaths` kills on `t <= 0 || damage
     * >= t`, so `t - damage` is exactly as lethal in counters as it is in
     * marked damage. Combat's `assign` already computes a Poisonous column's
     * lethal share off toughness the same way; the two paths agree.
     */
    const poolToKill = (u: Entity): number => {
      const mult = this.effAttrs(u).has('Vulnerable') ? 2 : 1;
      // R106: a collapsed hit is priced against PRINTED defense, so Piercing
      // and Electric spend the small number and carry the rest on.
      const [, t] = collapsed(u) ? this.printedStats(u) : this.effStats(u);
      const recvCap = Math.max(0, t - u.damage - (dealt.get(`u${u.id}`) ?? 0) * mult);
      if (recvCap <= 0) return 0;
      if (srcAttrs.has('Deadly')) return 1;
      return Math.ceil(recvCap / mult);
    };
    for (const hit of hits) {
      let n = hit.n;
      if (n <= 0) continue;
      // Powerful source: double the damage dealt (to units and players alike),
      // once, before Electric distribution or Vulnerable's receive-side doubling.
      if (srcAttrs.has('Powerful')) n *= 2;
      /**
       * R104: "[Augment] If an allied source would deal noncombat damage, it
       * deals that much damage PLUS 1 instead." (Conduit of Pain.)
       *
       * ORDER, which is the part that is easy to get wrong. R103 fixed the
       * per-hit arithmetic as: {Powerful} doubles what the SOURCE deals, then
       * {Vulnerable} prices what the VICTIM receives, then {Piercing} spends
       * the excess. This modifier goes between the first and the second, i.e.
       * AFTER the doubling, for two reasons:
       *
       *  · {Powerful} is the source scaling its OWN printed damage (R103 step
       *    1); the Conduit is an outside continuous modifier on the result.
       *  · put it before the doubling and the printed "plus 1" silently becomes
       *    plus 2 in front of any Powerful source, which is not what the card
       *    says. A card that meant that would have to print it.
       *
       * Being here rather than at commit is also what makes it compose with
       * {Piercing} and {Electric}: `poolToKill` is read a few lines down and
       * sees the increased number, so the extra point pierces or passes along
       * the chain like any other.
       *
       * PER HIT, exactly where {Powerful} is: a source that deals damage to
       * three units deals damage three times, and the Conduit prices each of
       * them. (R80 coalesces a recipient NAMED twice into one commit, but the
       * two hits are still two dealings, and {Powerful} has always doubled
       * both.)
       */
      n += this.amountDelta({
        kind: 'effectDamage', region: ctx.region, amount: n,
        ...('player' in (hit.target as object)
          ? { player: (hit.target as { player: Seat }).player }
          : { unit: hit.target as Entity }),
        sourceSeat: ctx.controller, sourceName: ctx.sourceName, combat: false,
      });
      if (n <= 0) continue;
      const target = hit.target;
      if ('player' in (target as object)) {
        add({ seat: (target as { player: Seat }).player }, n);
        continue;
      }
      const first = target as Entity;
      if (!this.entity(first.id)) continue;
      if (!srcAttrs.has('Electric')) {
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
        if (piercing) {
          const lethal = poolToKill(first);
          if (n > lethal) {
            if (lethal > 0) add({ u: first }, lethal);
            add({ seat: first.controller }, n - lethal);
            continue;
          }
        }
        add({ u: first }, n);
        continue;
      }
      // R4: only the lethal share sticks to each victim; the rest passes along
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
          // The chain has nowhere left to go. Without {Piercing} the excess is
          // lost (R4); WITH it, the two attributes compose rather than one
          // silently eating the other — Electric says where excess goes NEXT,
          // Piercing says where excess goes when there is no next: to the
          // controller of the unit it could not be spent on.
          if (piercing) add({ seat: victim.controller }, remaining);
          break;
        }
        const pick = nexts.length === 1 ? nexts[0]! : (() => {
          const chosen = ctx.choose(`epath:${hop}`, {
            kind: 'electricPath', seat: ctx.controller,
            prompt: `${ctx.sourceName}: ${remaining} excess Electric damage — choose the next unit`,
            options: nexts.map(u => ({ label: u.card, value: u.id })),
          });
          const u = this.entity(chosen as EntityId);
          if (!u) throw new Error('electric path choice invalid');
          return u;
        })();
        victim = pick;
        hop++;
      }
    }
    if (!order.length) return;

    // What each recipient RECEIVES — a Vulnerable victim doubles it, and R48
    // {Blessed} says what the victim receives is what the source dealt, so the
    // doubling is inside the total the batch reports.
    const received = new Map<string, number>();
    for (const r of order) {
      const n = dealt.get(key(r)) ?? 0;
      let got = r.u && this.effAttrs(r.u).has('Vulnerable') ? n * 2 : n;
      // R98: prevention runs HERE, before `total`, because `total` is "the
      // damage this effect dealt" (Ember of Life's "that many") and prevented
      // damage was never dealt. It is also after Vulnerable's doubling: the
      // shield stops "all damage that WOULD BE DEALT", and what would be dealt
      // to a Vulnerable unit is the doubled number.
      if (r.u && this.entity(r.u.id)) {
        got = this.preventUnitDamage(r.u, got, {
          region: ctx.region, source: ctx.sourceName, combat: false,
          attrs: srcAttrs, pure: false,
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
        // (with the effect's controller, R33) so triggers hear face hits too.
        // Fired before loseLife — a lethal hit ends the game mid-throw and the
        // queued trigger is moot. Combat face damage does NOT come through here
        // (pumpCombatDamage → loseLife directly) and stays trigger-silent.
        const ev = this.ev('damage', `${ctx.sourceName} deals ${n} to ${this.pname(seat)}.`,
          { player: seat, n, total, source: ctx.sourceName, controller: ctx.controller, region: ctx.region });
        this.fireEvent('damage', ev);
        // R48 {Blessed}: the gain lands on the SAME game-state check as the
        // damage, so it is committed here — before loseLife runs the lethal
        // check. A blessed source therefore cannot kill its own controller.
        if (srcAttrs.has('Blessed')) this.blessedGain(ctx.controller, n, ctx.sourceName);
        this.loseLife(seat, n, ctx.sourceName);
        continue;
      }
      const u = r.u!;
      if (!this.entity(u.id)) continue;
      // R98: `n` is already post-prevention (see above), and a fully prevented
      // recipient never reaches here — the `n <= 0` guard at the top of the
      // loop drops it. So no {Blessed} gain, no Poisonous counters, no 'damage'
      // event, no {Deadly} kill, no {Resonant} rider: "if there is not damage
      // being dealt, then no counters are placed" (RAQ, Poisonous vs
      // Phytochemical Protection).
      const through = n;
      // R106: this hit was read at printed stats, so its lethality is settled
      // by `sweepCollapsedDeaths` below rather than by the state-based sweep.
      if (collapsed(u)) collapsedHit.add(u.id);
      if (srcAttrs.has('Blessed')) this.blessedGain(ctx.controller, through, ctx.sourceName);
      if (poisonous) {
        // Poisonous deals the damage as permanent -1/-1 counters instead of
        // marked damage — no damage event, so nothing "is dealt damage".
        this.ev('info', `Poisonous: ${ctx.sourceName} deals ${through} to ${u.card} as -1/-1 counter(s).`);
        this.addCounters(u, -through);   // permanent counters; addCounters runs checkDeaths
        if (!this.entity(u.id)) killed.push(u);
      } else {
        u.damage += through;
        const ev = this.ev('damage', `${ctx.sourceName} deals ${through} to ${u.card}.`,
          { unit: u.id, n: through, total, source: ctx.sourceName, controller: ctx.controller });
        this.fireEvent('damage', ev);   // "when I am dealt damage" (Awoken Tomb)
        // R106: lethality on a collapsed hit is measured on PRINTED defense —
        // "Haboob kills anything that has 1 defense printed at the card level",
        // however many +1/+1 counters are on it. The kill itself is
        // `sweepCollapsedDeaths` below; `checkDeaths` reads effStats and would
        // let the pumped victim walk.
        const [, t] = collapsed(u) ? this.printedStats(u) : this.effStats(u);
        // R21: Deadly — any nonzero damage kills, regardless of toughness
        if (u.damage >= t || srcAttrs.has('Deadly')) killed.push(u);
      }
      if (resonant) this.loseLife(u.controller, through, `${ctx.sourceName} (Resonant)`);
    }
    // R98: "Put a +1/+1 counter on it for each damage prevented this way" —
    // paid out after the whole batch is marked, so a shield cannot resolve a
    // death in the middle of damage R80 made simultaneous.
    this.settleDamagePrevention();
    if (srcAttrs.has('Reaping')) {
      for (const _ of killed) {
        this.ev('info', `Reaping: ${this.pname(ctx.controller)} draws a card.`);
        this.draw(ctx.controller, 1);
      }
    }
    if (srcAttrs.has('Deadly')) {
      for (const u of killed) {
        if (this.entity(u.id)) {
          this.ev('info', `${ctx.sourceName} is Deadly — ${u.card} dies.`);
          this.destroy(u, 'dies');
        }
      }
    }
    // R106: settle the deaths the collapsed reading implies before the ordinary
    // state-based sweep, which reads effStats and cannot see them.
    this.sweepCollapsedDeaths(collapsedHit);
    this.checkDeaths();
  }

  /** R75 orthogonal formation adjacency, read for UNITS: front/back within a
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

  // ── R48 {Afflicting} ────────────────────────────────────────────────
  //
  // "When an afflicting source kills one or more units, those units'
  // controllers gain a rot." It must fire on -1/-1 COUNTER kills, not only
  // damage kills (Caleb 2024-09-10: "we check damage and stats of units that
  // were interacted with during spell resolutions") — which is the whole
  // point, since the only afflicting card in the pool, Umbral Decay, kills
  // purely by putting two -1/-1 counters on a unit.
  //
  // So attribution is not done at the damage site but by DIFFING: snapshot who
  // is alive, let the afflicting source act, then see who is gone. That covers
  // damage, counters, delete effects and anything else a future afflicting
  // card does, and it is exactly Caleb's own formulation.

  /** id -> controller for every unit in play right now (the "before" side of
   * an afflicting diff; the controller has to be captured while the unit still
   * exists). */
  snapshotUnits(): Map<EntityId, Seat> {
    const m = new Map<EntityId, Seat>();
    for (const u of Object.values(this.s.entities)) {
      if (u.kind === 'unit') m.set(u.id, u.controller);
    }
    return m;
  }

  /**
   * Close an afflicting diff: every unit in `before` that is no longer in play
   * was killed by the afflicting source, and its CONTROLLER gains a rot —
   * ⚠ R48 (Bena's reading): ONE rot per affected controller per kill event,
   * however many of their units died. `only` narrows the diff to a set of ids
   * the source is known to have interacted with (combat, where other units may
   * be dying in the same sub-step from unrelated columns).
   */
  afflictingKills(before: Map<EntityId, Seat>, sourceName: string, only?: Set<EntityId>): void {
    const seats = new Set<Seat>();
    const dead: string[] = [];
    for (const [id, seat] of before) {
      if (this.entity(id)) continue;                 // survived
      if (only && !only.has(id)) continue;           // not this source's doing
      seats.add(seat);
      dead.push(String(id));
    }
    if (!seats.size) return;
    // initiative order, so the rot events are deterministic on replay
    for (const seat of [this.initiative, this.nit]) {
      if (!seats.has(seat)) continue;
      this.ev('info', `Afflicting: ${sourceName} killed ${this.pname(seat)}'s unit(s) — they gain a rot.`,
        { seat, source: sourceName, units: dead });
      this.gainRot(seat, 1);
    }
  }

  /** The state-based check. Two actions, run together at every safe point:
   * lethal damage kills, and an empty attacking column stops existing (R72).
   * The second is here as well as in removeFromFormation() because card code
   * splices `b.columns` directly (Hooba-Nan, Shard Sprite, Tiderunner), and a
   * state-based action nobody can forget to run is the whole point. */
  checkDeaths(): Entity[] {
    const dead: Entity[] = [];
    for (const u of Object.values(this.s.entities)) {
      if (u.kind !== 'unit') continue;
      const [, t] = this.effStats(u);
      if (t <= 0 || u.damage >= t) dead.push(u);
    }
    for (const u of dead) this.destroy(u, 'dies');
    this.repairFormation();
    return dead;
  }

  /**
   * R153 — THE DISPOSAL TAIL. One body and its mods leave PLAY for a bin;
   * this is the whole of what happens to them, and it is the only copy.
   *
   * ⚠ WHY THIS EXISTS. The sequence below — push the mods, push the body,
   * announce, trash each one ANCHORED (R70), then sweep by SLOT INDEX
   * highest-first if the body is {Unstable} (R137/R140/R145), else sweep just
   * the body if it is a token (R69), then file the TOKEN mods on the public
   * erased pile (R65), then delete the mod entities last — has eight ordering
   * constraints and not one of them is visible from a call site. Every time it
   * was hand-copied it drifted: the copy in `exchangeInPlace` (Hooba-Mon,
   * batch-dark-b.ts) logged a despawn it never fired, deleted its mods with no
   * bin and no trash, and skipped a token body's bin entirely — three separate
   * repairs (R146, then R152) to make one copy say what the original said.
   * CT-43 is the conclusion: there is now ONE implementation and both leave-
   * play-for-a-bin routes call it. Do not re-inline it. `test/129-disposal-
   * tail.test.ts` fails if you do — behaviourally, not by reading the source.
   *
   * `E.toBin` cannot express this and is not meant to: it takes neither R70's
   * `anchor` (so a mod's own "when I am trashed" text would lose the region it
   * left play in) nor reports the slot it pushed to (so R140's sweep would be
   * back to `bin.lastIndexOf(name)`, which eats an innocent older copy of the
   * same card). `toBin` is for a card entering a bin from a zone that is not
   * play; this is for one leaving play.
   *
   * `announce` is the callers' ONE difference, and it is held to the middle of
   * the sequence on purpose: a death logs 'died' and a leave-play logs
   * 'despawned', both AFTER every push and BEFORE every trash, because that is
   * the board a listener must see (R137). It receives the body's bin slot —
   * `binSeat` + `binIndex`, R131's bin identity, which only this method knows
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
   * a token has none (R69).
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
    // R157 §10: turn a transformed card back over FIRST — before the bin
    // seat, the Unstable question, any push, the announce or the trash. The
    // card that reaches the bin is the FRONT face, and everything below reads
    // `u.card`.
    this.revertFace(u);
    const binSeat = opts.binTo ?? u.owner;
    // R96/R118/#89: FOUR ways in, unioned by E.isUnstable. `mods.length` is the
    // derived one (a modded card is Unstable — R69); `u.unstable` is the
    // until-regroup STAMP a bin play leaves on the body it spawned; and R118
    // ruling 2 adds the COPY of a modded unit ("the copy is still considered
    // modded"). Read off the detached entity, so it is the same answer whether
    // the caller asked before or after the body left the table.
    const unstable = this.isUnstable(u);
    // R137: the nontoken mods enter their own owners' bins too — `binTo`
    // redirects them with the body. Pushed BEFORE the announce, exactly as
    // leavePlay() does for a recall, so a death listener sees the same board a
    // despawn listener would.
    const modBin = (m: Entity): Seat => opts.binTo ?? m.owner;
    const binnedMods = mods.filter(m => !m.token);
    // R140: remember WHERE each push landed. The whole window between here and
    // the state-based sweep below only QUEUES (fireEvent composes triggers, it
    // never resolves one), so nothing can leave a bin in between and these
    // indices are still exact when the sweep uses them.
    const binnedAt = new Map<EntityId, number>();
    for (const m of binnedMods) {
      const b = this.player(modBin(m)).bin;
      b.push(m.card);
      binnedAt.set(m.id, b.length - 1);
    }
    // R40/R137: EVERYTHING leaving play for a bin enters one — token, Unstable
    // carrier and plain card alike — so R40 trashes it. The trash fires AFTER
    // the caller's event below so the log reads "X dies → bin" then "…trashes
    // X", and the erase comes after that again.
    this.player(binSeat).bin.push(u.card);
    const bodyBinIndex = this.player(binSeat).bin.length - 1;
    announce({ binSeat, binIndex: bodyBinIndex, unstable });
    // R40/R70: the trash fires anchored on the departing entity itself, so its
    // own "when I am trashed" trigger keeps the region it left play in — body
    // first, then each mod anchored on the MOD entity, which is the order
    // afterDespawn() uses for a recall.
    this.noteTrashed(binSeat, u.card, 'play', u);
    for (const m of binnedMods) this.noteTrashed(modBin(m), m.card, 'play', m);
    // R69/R137 state-based sweep: the card has been in the bin for the whole
    // event window above (both `when` passes and the ledger saw it there) and
    // now leaves it, before anything queued has resolved. R124: eraseFromZone
    // is the sanctioned route out of a bin, and the reason it records is
    // 'erased' — the same verb the token sweep uses, because it is the same
    // state-based action and not a new kind of departure.
    //
    // R140: each sweep names the SLOT it pushed (`binnedAt` / `bodyBinIndex`),
    // not the card's name. Without the index this reads `bin.lastIndexOf(name)`,
    // which is the copy just pushed only by luck of ordering — and an older
    // copy of the same name resting in that bin is one reordering away from
    // being the one eaten, leaving the token / Unstable card in the bin and
    // taking an innocent card out of the game in its place.
    if (unstable && !opts.keepBinned) {
      this.eraseFromZone(binSeat, u.card, 'bin', `${u.card} is erased from the bin — Unstable.`,
        { index: bodyBinIndex });
      // R140: HIGHEST index first. Two mods of the same card on one carrier land
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
    // R65: an erase must reach the public erased pile like every other erase
    // (ev() keeps the pile off 'erased' events). The body and the nontoken mods
    // put themselves there via eraseFromZone above; this covers the TOKEN mods,
    // which never reach a bin at all (R69: a token has no card of its own) and
    // so have no sweep to announce them.
    const tokenMods = mods.filter(m => m.token);
    if (tokenMods.length) {
      this.ev('erased', `${tokenMods.map(m => m.card).join(', ')} — erased with ${u.card}: a token mod has no card to bin.`,
        { seat: binSeat, cards: tokenMods.map(m => m.card) });
    }
    for (const m of mods) delete this.s.entities[m.id];
  }

  /**
   * `opts.binTo` (R40) redirects the bin the dying card enters — Pull Under
   * ("delete target unit; it and its mods go to YOUR bin"). It has to be an
   * argument rather than a fix-up afterwards: the bin push and the trash
   * attribution are one and the same decision ("a card is trashed by the owner
   * of the bin it enters"), and the 'trashed' event fires synchronously from
   * here, queueing its triggers and bumping the per-battle ledger, long before
   * card code regains control. A compensating second trashed(caster) would
   * double-count the ledger and double-fire "when I am trashed" (Dropslime,
   * Nothyr, Murkstalker). R137 made `binTo` matter for an Unstable unit too:
   * that one now reaches a bin like everything else, so Pull Under's "it and
   * its mods go to YOUR bin" is the bin the trash is attributed to even when
   * the pair is erased out of it a statement later.
   *
   * R69 — the branch ORDER is load-bearing, and it used to be wrong. Unstable
   * (`mods.length`) is tested FIRST: an Unstable ANYTHING, token or not, is
   * erased with its mods. The old order tested token-ness first, so a modded
   * token took the token carve-out and never reached the Unstable branch (game
   * UZRG: a Wraith body carrying a Wraith mod died, came back, AND fired its
   * mod's donated death trigger). ⚠ The order still matters for the LOG and
   * for the mods, but it no longer decides whether a bin is touched: R137
   * merged the two destinations into one path.
   *
   * R69 again — a dying TOKEN really does enter its owner's bin, is trashed
   * there like any other card, and is only then erased by a state-based sweep
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
   * **R137 (owner, 2026-08-24) — an Unstable unit that dies IS TRASHED.** It
   * takes the token's exact route: into the bin, `died`, `trashed` (ledger and
   * "when I am trashed" and every watcher), then the state-based sweep erases
   * it. The destination a player SEES is unchanged — the erased pile — and the
   * bin is empty again before anything queued resolves.
   *
   * ⚠ This DIVERGES from two sources and the divergence is recorded, not
   * smoothed over (see R137 in docs/digital-rules.md). Abyssal Evocation and
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
   * fired nothing.
   *
   * The MODS ride the same rule (R137, and not from the ANBB log — the mod
   * there was a Wraith, which has no card to trash either way). A nontoken mod
   * on a dying carrier enters a bin and is trashed when the carrier is
   * RECALLED or CACHED (leavePlay + afterDespawn, R70, Caleb 2024-09-15); if
   * killing the carrier instead skipped that trash, the same mod card would
   * behave differently depending on how its host left play — the exact shape
   * of the bug R137 removes. So they are binned, trashed and swept with it.
   * A TOKEN mod still has no card of its own (R69) and only reaches the
   * erased pile.
   *
   * `opts.keepBinned` is the one card that OVERRIDES the Unstable sweep: Pull
   * Under prints "put it and all of its mods into your bin", and the engine's
   * long-standing reading is that the card's own destination wins. Before R137
   * that override was card code doing its own `toBin` after destroy() erased
   * everything; now destroy() already bins and trashes, so the override is
   * simply "do not run the sweep". A TOKEN body is still swept — Pull Under
   * moves cards, and a token has none (R69).
   */
  destroy(u: Entity, verb: 'dies' | 'is deleted' | 'is sacrificed',
    opts: { binTo?: Seat; keepBinned?: boolean } = {}): void {
    if (!this.entity(u.id)) return;
    delete this.s.entities[u.id];
    // R152/R153: resolved BEFORE the disposal runs — a mod id whose entity is
    // already gone is not a mod any more, and disposeToBin deletes them last.
    const mods = u.mods.map(id => this.entity(id)).filter((m): m is Entity => !!m);
    // R153: push, announce, trash, sweep, erased-pile, delete — the whole tail
    // is `disposeToBin`, shared verbatim with Hooba-Mon's exchange. Everything
    // left here is what makes this disposal a DEATH rather than some other way
    // of leaving play: the verb, the 'died' event, and the formation collapse.
    this.disposeToBin(u, mods, ({ binSeat, binIndex, unstable }) => {
      // R70: every fact a death listener could want RIDES THE EVENT (see
      // leftPlayFacts) — `verb` (Ghord's "sacrificed", which used to
      // string-match the log message) is the death-only extra.
      //
      // R137: `to` is 'bin' for EVERY death now, Unstable included — the same
      // answer a dying token already gave (R70/R69). It reports where the card
      // is DURING the event window, which is what a listener can act on; where
      // it ends up is announced by the 'erased' event a few statements later.
      //
      // R140: a 'died' listener that reaches into the bin for the card it just
      // saw die (Biomass Devourer erases it OUTRIGHT) needs to name the exact
      // copy, and only the disposal knows which one it is. `seat` on a death
      // event is the CONTROLLER while the card bins to its OWNER, so the bin's
      // seat is stamped too — the pair (binSeat, binNth) is R131's bin
      // identity, the same one `noteTrashed` stamps on 'trashed', read back by
      // `eventBinSlot`.
      const evData: Record<string, unknown> = {
        ...this.leftPlayFacts(u), verb, to: 'bin',
        binSeat, binNth: binNthAt(this, binSeat, binIndex),
      };
      // R72: hold the death event ITSELF, not "whatever the last event was".
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
      // formation cleanup + back-row promotion + R72 column collapse
      // (state-based, no response window)
      this.removeFromFormation(u.id);
      if (this.s.phase === 'battle') {
        this.bumpBattleCounter(u.region, `allyDeaths:${u.controller}`);
      }
      // fire the death BEFORE erasing the mod entities: the dying unit's mods
      // still count as sources of donated "[Augment] when I die" text (the
      // fireEvent mod scan resolves u.mods through the entity table, which is
      // why disposeToBin deletes them only at the very bottom)
      this.fireEvent('died', evDied, u);
    }, opts);
  }

  /**
   * R157 §3 — AN EXCHANGE. `u` leaves play and `name` arrives in its place,
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
   *    unit's OWN donated [Augment] text is scanned — R152 was the round that
   *    repaired exactly this, when the announce logged a despawn it never
   *    fired and every despawn watcher in the game was blind to an exchange.
   *  · IS A TRASHING. Which is `E.disposeToBin`, unchanged and shared verbatim
   *    with `destroy()`: push the nontoken mods, push the body, announce,
   *    trash each one anchored (R70), sweep by slot index highest-first if the
   *    body is {Unstable} (R137/R140), else sweep a token body (R69), file the
   *    token mods on the erased pile (R65), delete the mod entities last.
   *
   * ⚠ WHY IT IS HERE and not in card code. It was a module-private function in
   * batch-dark-b.ts serving Hooba-Mon, while Necromorph — the other exchange
   * in the pool, and the one whose own printed text says "Exchange" — called
   * `destroy(victim, 'is deleted')` and fired every death trigger in the
   * region. R157 §3 makes them one behaviour, and the codebase's own lesson
   * (R146, R152, R153/CT-43: three rounds of repairing a hand-copy of the
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
    // R152: resolved BEFORE `u` leaves the table, exactly as destroy() does —
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
    const fresh = this.spawnUnit(controller, name, u.region);
    if (slot) {
      slot.col[slot.idx] = fresh.id;   // take the exact position in play
      this.ev('info', `${name} takes ${outgoing}'s position in the formation.`);
    }
    delete this.s.entities[u.id];
    this.disposeToBin(u, mods, () => {
      // The unslot rides in the announce window because it belongs there:
      // after the pushes, before the trashes. `removeFromFormation` is the
      // wrong call — its R72 gap-closing would be looking at a column that has
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
      // R152(1): logged AND fired. Anchored on `u`, so its own donated
      // [Augment] text is scanned. `u.card` is read live — R157 §10's
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
   * R69 — THE state-based sweep that erases a token the instant after it
   * enters a zone. Pull ONE copy of `name` back out of `seat`'s bin, hand or
   * cache and record it in the public erased pile (R65). No-op if it is not
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
   *  · `at.index` — a BIN slot (R140). A bin holds bare card NAMES, so a name
   *    search there answers "the last copy of that name in this bin NOW", which
   *    is the copy the caller pushed only by luck of ordering. `destroy` knows
   *    exactly where it pushed and says so. A named slot that no longer holds
   *    `name` means GONE — the erase is a no-op and deliberately does NOT fall
   *    back to a name search, because falling back is how an innocent older
   *    copy of the same card gets erased out of the game (R140).
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
        ? (bin[at.index] === name ? at.index : -1)   // R140: a mismatch is "gone", never a search
        : bin.lastIndexOf(name);
      if (i === -1) return;
      this.removeFromBin(seat, i, 'erased');   // R124: the one bin-removal path
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
    // R72: closing the gap is part of leaving the formation, not a follow-up
    // somebody has to remember. removeFromFormation() is the ONLY way a unit
    // leaves a column (destroy / recall / cacheUnit all funnel through it), so
    // the empty column never survives past the statement that made it empty.
    this.repairFormation();
  }

  /**
   * R112: `to` gains control of unit `u`. The one control-change primitive —
   * four card batches used to carry their own copy, and they disagreed.
   *
   * - Its MODS change controller with it (Bena 2026-08-23: "a stolen unit's
   *   mods are part of the unit, so yes, they go with them to the unit's new
   *   controller — that's the whole point of some of the viruses which force
   *   units to flip flop controllers"). Owner never changes.
   * - It leaves any formation it was in, through removeFromFormation, so the
   *   R72 column collapse happens here too (the local copies skipped it).
   * - Regions are exclusive: if the new controller is not present where the
   *   unit stands (a deployment-time steal out of the owner's home), the unit
   *   and its mods go to the new controller's home now rather than sitting
   *   in a region its controller is not in until regroup walks it there.
   *   Mid-battle both seats are present and it stays on the board.
   * Returns false when nothing changed hands (unit gone, or already theirs).
   *
   * R148 — the two things that changed here, both driven by CT-38/CT-39:
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
   * It emits a real dispatched `controlChanged` (R148/CT-39) instead of the
   * `info` line it used to, so "whenever you gain control of a unit" is a
   * listenable seam. Same message, so the game log is unchanged. Region-scoped
   * per R12 the ordinary way — `data.region` is the unit's region AFTER any
   * relocation above, so both seats present there hear it and nobody else
   * does — and `data.unit` makes the moved unit the event's source, so a
   * `self:` listener on the unit that just changed hands matches.
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
   * R72 — the key for a battle counter that belongs to ONE attacking column
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
   * The engine had no such window: the first R72 build ran the collapse as an
   * unconditional state-based action, including between damage sub-steps.
   */
  private beforeBlocksDeclared(): boolean {
    const b = this.s.battle;
    if (!b) return false;
    return b.step === 'declare' || b.step === 'attackWindow' || b.step === 'blocks';
  }

  /**
   * R72 — the two halves of formation GRAVITY, which have DIFFERENT timing
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
   *     relied on as an invariant rather than checked (R75).
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
    for (let ci = 0; ci < b.columns.length; ci++) if (b.columns[ci]!.length) keep.push(ci);
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
   * R72/R75 — THE re-key, and the only one. Every index-keyed thing hanging off
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
    // R84 {Alluring}: a must-block duty names an attack COLUMN, so the column's
    // identity is the duty's identity and it moves in the same commit as
    // `blocks`. A duty whose column ceases to exist ceases with it — that is
    // the mechanism behind "kill the allurer and the block is freed"; the
    // can't-attack half is the presence of the mark, and stays.
    for (const u of Object.values(this.s.entities)) {
      const a = u.allured;
      if (!a || a.round !== b.round) continue;
      a.columns = a.columns.map(to).filter((ci): ci is number => ci !== null);
    }
    b.blocks = blocks;
  }

  // ── R75: joining a formation ────────────────────────────────────────
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
   * R75 — every legal place a unit could join `seat`'s formation, left to
   * right. Not a target (nothing prints "target"): the caller offers these at
   * RESOLUTION, the way R71's "an ally" is chosen.
   *
   * Three kinds, and the first two are the ruling as printed:
   *  · a NEW column at either END. "Either side of the existing units" is read
   *    as the two ENDS, not as an insertion between two existing columns — see
   *    the rules entry, this is a reading.
   *  · the BACK slot of a column that holds exactly one unit.
   *  · the front slot of a HOLE (R72) — a column emptied of attackers that its
   *    blockers are holding open. This is the one kind the ruling does not
   *    enumerate, and it is kept because the engine already offered it
   *    (Tiderunner Initiate) and because it is the only way a formation ever
   *    heals a hole. It cannot CREATE a hole, so it cannot break R72.
   *
   * A formation you are not standing in cannot be widened: with no living unit
   * in the grid there is no formation to join, and the answer is no slots at
   * all rather than "open a column out of nowhere".
   */
  /**
   * R75 — the formation grid `seat` fights in, `[column][row]`, front row
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
   * board moving under it — R29's play-time placement is chosen at cast and
   * taken at resolution, and by then a column may have collapsed, widened or
   * lost its occupant (R5/R56). A raw index into this list would silently
   * become a different slot; the descriptor is re-matched against a freshly
   * computed list instead, and simply fails to match when the spot is gone.
   */
  formationSlots(seat: Seat): { col: EntityId[] | null; end?: 'left' | 'right'; label: string; spot: FormationSpot }[] {
    const b = this.s.battle;
    if (!b) return [];
    const attacker = seat === b.attacker;
    const grid = this.formationGrid(seat);
    if (!grid.some(col => col.some(id => this.entity(id)))) return [];
    const out: { col: EntityId[] | null; end?: 'left' | 'right'; label: string; spot: FormationSpot }[] = [];
    // Only the ATTACKING grid can widen. A blocking column is keyed to an
    // attacking column (R72), so a new one has no index to exist at.
    if (attacker) {
      out.push({ col: null, end: 'left', label: 'a new column on the left', spot: { kind: 'end', end: 'left' } });
    }
    grid.forEach((col, i) => {
      const alive = col.filter(id => this.entity(id));
      if (alive.length === 1) {
        out.push({
          col, label: `column ${i + 1}, behind ${this.entity(alive[0]!)?.card ?? '?'}`,
          spot: { kind: 'behind', unit: alive[0]! },
        });
      } else if (alive.length === 0) {
        out.push({
          col, label: `column ${i + 1} (an empty slot in the line)`,
          spot: { kind: 'hole', column: i },
        });
      }
    });
    if (attacker) {
      out.push({ col: null, end: 'right', label: 'a new column on the right', spot: { kind: 'end', end: 'right' } });
    }
    return out;
  }

  /** the live slot `spot` names right now, or null if the board moved and it
   * no longer names one (R5/R56 — re-derived, never remembered as an index) */
  private slotForSpot(seat: Seat, spot: FormationSpot): { col: EntityId[] | null; end?: 'left' | 'right'; label: string } | null {
    if (spot.kind === 'out') return null;
    const same = (s: FormationSpot): boolean => {
      if (s.kind !== spot.kind) return false;
      if (s.kind === 'end' && spot.kind === 'end') return s.end === spot.end;
      if (s.kind === 'behind' && spot.kind === 'behind') return s.unit === spot.unit;
      if (s.kind === 'hole' && spot.kind === 'hole') return s.column === spot.column;
      return false;
    };
    return this.formationSlots(seat).find(s => same(s.spot)) ?? null;
  }

  /** put `u` into `slot`. The one place a unit is written into the grid. */
  private putInSlot(u: Entity, slot: { col: EntityId[] | null; end?: 'left' | 'right' }): void {
    const b = this.s.battle!;
    if (slot.col) { slot.col.push(u.id); return; }
    // R72/R75: opening a column on the LEFT shifts every existing column
    // right, so every block key and every column-scoped counter shifts with
    // it. One atomic re-key, same owner as the collapse.
    const at = slot.end === 'left' ? 0 : b.columns.length;
    const cols = b.columns.slice();
    cols.splice(at, 0, [u.id]);
    this.rekeyColumns(oldCi => (oldCi >= at ? oldCi + 1 : oldCi));
    b.columns = cols;
  }

  /**
   * R29 — take the spot this card was PLAYED into, before it is anywhere else.
   *
   * Called from inside spawnUnit, between minting the entity and firing
   * 'spawned', so the unit is already standing in the formation the first time
   * any listener or any player sees it. That is the whole difference between
   * this and R75's `placeInFormation`: R75 is an EFFECT resolving ("create a
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
      // R5/R56: chosen at cast, taken at resolution — and the line moved.
      return `${u.card}: the open spot it was played into is gone — it enters the region, outside the formation.`;
    }
    this.putInSlot(u, slot);
    return `${u.card} is played straight into the formation (${slot.label}).`;
  }

  /**
   * R75 — ADJACENCY, written down once. *"If a unit references its own adjacent
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
   * baked in, both of which fall out of the parenthetical "which only exist if
   * it's in a formation":
   *
   *  1. **Past the edge of the line is not a slot.** A unit in the leftmost
   *     column has no left-adjacent slot; it does not have an implicit one that
   *     a new column could be opened at. (Contrast `formationSlots`, where
   *     opening a column at an end is a listed placement — that is a different
   *     rule, about JOINING a formation, and it is a choice rather than a
   *     position derived from a unit.)
   *  2. **The front row fills first**, always: `removeFromFormation` promotes
   *     the back row, `repairFormation` splices dead ids out, and every
   *     placement appends. A column is therefore `[]`, `[front]` or
   *     `[front, back]` and never `[empty, back]`. A slot is fillable only when
   *     the column's next free row IS that row (`col.length === row`), which
   *     makes the back slot of a column whose front is empty unreachable rather
   *     than a case to handle: a unit put there would slide to the front, and
   *     the front of a neighbouring column is diagonal.
   */
  adjacentSlots(id: EntityId): { col: EntityId[]; row: number; label: string }[] {
    const u = this.entity(id);
    if (!u || !this.s.battle) return [];
    const grid = this.formationGrid(u.controller);
    let ci = -1, ri = -1;
    for (let i = 0; i < grid.length; i++) {
      const r = grid[i]!.indexOf(id);
      if (r !== -1) { ci = i; ri = r; break; }
    }
    if (ci === -1) return [];
    const out: { col: EntityId[]; row: number; label: string }[] = [];
    const take = (c: number, r: number, label: string): void => {
      const col = grid[c];
      if (!col) return;                    // past the edge of the line: not a slot at all
      if (col.length !== r) return;        // taken, or unreachable (the front fills first)
      out.push({ col, row: r, label });
    };
    take(ci - 1, ri, `column ${ci}, ${ri === 0 ? 'front' : 'back'} row`);
    take(ci, 1 - ri, `column ${ci + 1}, behind ${u.card}`);
    take(ci + 1, ri, `column ${ci + 2}, ${ri === 0 ? 'front' : 'back'} row`);
    return out;
  }

  /**
   * R75 — put `u` into `ctx.controller`'s formation, letting them choose where.
   * Auto-picked when exactly one placement is legal; a logged no-op when none
   * is. `optional` adds a "stay out of formation" answer (Tiderunner Initiate,
   * whose printed text is "you MAY play me into an open spot").
   *
   * Every branch logs. An effect that resolves into silence is a bug the
   * conformance suite fails on, and "there was nowhere to put it" is exactly
   * the kind of thing a player needs told.
   *
   * Returns true when the unit actually joined.
   */
  placeInFormation(u: Entity, ctx: Pick<EffectCtx, 'controller' | 'choose'>,
    opts: { key?: string; source?: string; optional?: boolean } = {}): boolean {
    const b = this.s.battle;
    const src = opts.source ?? u.card;
    if (!b || u.region !== b.region) {
      this.ev('info', `${src}: there is no formation here for ${u.card} to join.`);
      return false;
    }
    const slots = this.formationSlots(ctx.controller);
    if (!slots.length) {
      this.ev('info',
        `${src}: no open position in the formation — ${u.card} stays in the region, outside it.`);
      return false;
    }
    const options: DecisionOption[] = slots.map((s, i) => ({ label: s.label, value: i }));
    if (opts.optional) options.push({ label: 'stay out of formation', value: -1 });
    // BL-24: NOT kind 'electricPath' — that kind's numeric option values are
    // raw entity ids by contract (R4), and these are slot INDEXES. The client
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
   * R70's `to`, so Capture triggered no "a card entered a hand" watcher at all.
   *
   * R69, extended to the HAND on 2026-08-22: a recalled TOKEN really does
   * enter the hand — *"Technically it does enter your hand and then gets erased
   * immediately. So it would trigger any 'enters hand' stuff."* (Caleb
   * 2025-06-15; and 2025-04-24, asked whether recalling a spell token triggers
   * Rider of the Tides: *"Oh dang yeah it should also trigger it."*) So the
   * event says `to: 'hand'` for a token too, and the SAME state-based sweep
   * `destroy()` uses takes it back out — after the event window, before
   * anything queued in it resolves.
   *
   * R40: the recalled card is never trashed — a hand is not a bin. Its mods do
   * enter a bin, from play, so a nontoken mod IS trashed by its owner — in
   * afterDespawn(), after the despawn event, for log order.
   */
  recall(u: Entity, opts: { to?: Seat; verb?: string } = {}): void {
    const mods = this.leavePlay(u);
    if (!mods) return;
    const seat = opts.to ?? u.owner;
    const verb = opts.verb ?? 'recalled to';
    // R70: facts ride the event (see leftPlayFacts). `to` is where the card
    // went, which is what "when a unit is recalled to a HAND" wants to read —
    // it used to be recovered by matching the word "hand" in the log message.
    const evData = { ...this.leftPlayFacts(u), to: 'hand', hand: seat };
    this.player(seat).hand.push(u.card);
    this.ev('despawned',
      `${u.card} is ${verb} ${this.pname(seat)}'s hand`
      + (mods.length ? ` (its ${mods.length} mod(s) → bin)` : '')
      + (u.token ? ', then erased (token).' : '.'),
      evData);
    this.afterDespawn(u, mods);
    // R69's sweep, on the hand this time
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
   * three at once (R64).
   *
   * `ally` is the EFFECT's controller — the seat "ally"/"enemy"/"opponent" is
   * measured from, never the chooser's (R58). `sourceId`, when given, is the
   * entity the effect comes from, for restrictions that read it.
   */
  targetCandidates(spec: TargetSpec, region: number, excludeStackId?: number, ally?: Seat, sourceId?: EntityId, x?: number, chosen?: ResolvedTarget[], event?: EngineEvent | null): TargetRef[] {
    const out = this.targetFamilyCandidates(spec, region, excludeStackId, ally);
    const cands = this.compelledTargets(out, region);
    // R64: the printed RESTRICTION, judged against the resolved target. It
    // runs last so it never has to re-derive what `what` already settled.
    const restrict = spec.restrict;
    if (!restrict) return cands;
    const ctx: TargetCtx = {
      ...(ally !== undefined ? { ally } : {}), region,
      ...(sourceId !== undefined ? { sourceId } : {}), ...(x !== undefined ? { x } : {}),
      ...(chosen ? { chosen } : {}),
      ...(event !== undefined ? { event } : {}),   // R67: "that player's bin"
    };
    return this.restrictTargets(out, cands, restrict, ctx);
  }

  /** Stage one of `targetCandidates`: everything `spec.what` reaches, family
   * by family in a fixed order (units, players, stack, cache, bin) — the
   * order is the chooser's option order, so it must not move. */
  private targetFamilyCandidates(spec: TargetSpec, region: number, excludeStackId: number | undefined, ally: Seat | undefined): TargetRef[] {
    const out: TargetRef[] = [];
    this.pushUnitTargets(out, spec, region, ally);
    this.pushPlayerTargets(out, spec, region, ally);
    this.pushStackTargets(out, spec, excludeStackId);
    this.pushCachedCardTargets(out, spec);
    this.pushBinCardTargets(out, spec, ally);
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
    // R64: a spell TOKEN is a token too — Arcane Echo copies one and Download
    // steals one, and both are printed "target token" with no unit clause.
    if (spec.what === 'token') {
      for (const t of this.s.regions[region]!.presentSeats.flatMap(seat => this.tokensOf(seat, region))) {
        out.push({ unit: t.id });
      }
    }
  }

  private pushPlayerTargets(out: TargetRef[], spec: TargetSpec, region: number, ally: Seat | undefined): void {
    // R67: 'player' is "target player" with no ownership clause — you are a
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
        if (it.id === excludeStackId) continue;   // R68: a negated item is not here to skip
        // an ambush is a played card's effect on the stack — negatable (R22)
        const spellish = it.kind === 'spell' || it.kind === 'spellUnit'
          || it.kind === 'spellToken' || it.kind === 'ambush';
        // R128 (owner, 2026-08-24): "ANYTHING on the stack is an effect,
        // including units and spell units. Units aren't spells, so if they say
        // 'spell effect' a unit would be unaffected." So 'stackEffect' is
        // EVERY item on the stack with no kind test at all — the R60 carve-out
        // for a 'unit' on its way into play is REVERSED. 'stackSpell' is
        // unchanged and still excludes a plain unit: a unit is not a spell.
        if (spec.what === 'stackSpell' ? spellish : true) out.push({ stack: it.id });
      }
    }
  }

  private pushCachedCardTargets(out: TargetRef[], spec: TargetSpec): void {
    // R41: the cache is PUBLIC, so BOTH players' caches are legal targets
    // (Prismatic Observer exists precisely to answer an opponent's
    // nearly-fulfilled prophecy). Not region-scoped: the cache is not in a
    // region. Entries cached before uids existed cannot be targeted.
    if (spec.what === 'cachedCard') {
      for (const p of this.s.players) {
        for (const cc of this.cache(p.seat)) {
          if (cc.uid !== undefined) out.push({ cached: { seat: p.seat, uid: cc.uid } });
        }
      }
    }
  }

  private pushBinCardTargets(out: TargetRef[], spec: TargetSpec, ally: Seat | undefined): void {
    // R64: a card in YOUR OWN bin ("recall target unit in your bin",
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

  /** R64: "I must be targeted if able" (Gatekeeper of Souls) — a restriction
   * that narrows OTHER effects' lists. It is applied BEFORE the spec's own
   * restriction, because "if able" means "if it is a legal target for this
   * effect", and the spec's restriction is part of what decides that: a
   * Gatekeeper with base power 8 cannot compel an Unmake to aim at it.
   *
   * Returns `out` itself (same array, not a copy) when nothing compels, so
   * `restrictTargets` can tell the two cases apart by identity. */
  private compelledTargets(out: TargetRef[], region: number): TargetRef[] {
    const gates = this.mustBeTargetedIn(region);
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
   * R64: the card a target ref names, when it names one OFF THE BOARD — a bin
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

  /** R64: one ref per CARD IN the bin — copies of one card are separate
   * targets (a two-target spell may reach both), distinguished by `nth`. */
  binRefs(seat: Seat): TargetRef[] {
    const seen = new Map<CardName, number>();
    return this.player(seat).bin.map(card => {
      const nth = seen.get(card) ?? 0;
      seen.set(card, nth + 1);
      return { bin: { seat, card, ...(nth ? { nth } : {}) } };
    });
  }

  /** R64: where a BinRef points RIGHT NOW — the nth surviving copy of that
   * card, or the last one left if the pile has shrunk past it. -1 if gone. */
  binIndexOf(ref: BinRef): number {
    const bin = this.player(ref.seat).bin;
    const hits: number[] = [];
    bin.forEach((n, i) => { if (n === ref.card) hits.push(i); });
    if (!hits.length) return -1;
    return hits[Math.min(ref.nth ?? 0, hits.length - 1)]!;
  }

  /**
   * R95: may `ctx.seat` apply that card as an AUGMENT during battle?
   *
   * The default is NO — only a {Virus} from hand may augment during battle —
   * and this is the opt-in that overrides it. Shaped on `mustBeTargetedIn`,
   * the one other BOOLEAN permission query, and on `costModsFor` for
   * everything else: the same `anchored()` walk (units in play plus augment
   * mods, each read from its HOST), the same R12 region scope, the same
   * shallow R62 guard, the same reentrancy latch.
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
      for (const { holder, anchor } of this.anchored((h, a) =>
        this.donates(h, a, 'modPermissions')                   // R127: off the FACES
        && a.region === ctx.region
        && !a.suppressed?.abilities)) {                        // R62, as staticsFor (shallow)
        for (const face of this.behaviorFaces(holder, anchor)) {
          for (const p of this.card(face).modPermissions ?? []) {
            if (p.augmentInBattle?.(this, anchor, ctx)) return true;
          }
        }
      }
    } finally { this.inModPermissions = false; }
    return false;
  }

  /**
   * R95, the HASTE-timing sibling: may `ctx.seat` apply that card as a MOD
   * during the R18 haste step — "[Augment] You can apply other mods during
   * [Haste] as if it was deployment" (Slurpr)?
   *
   * The default is NO: modding is a deployment action (or a battle Virus), and
   * the haste step is neither. This is the opt-in that overrides it, and it is
   * `mayAugmentInBattle` byte for byte apart from the member it reads — same
   * `anchored()` walk (units in play plus augment mods, each read from its
   * HOST), same R12 region scope, same shallow R62 guard, same reentrancy
   * latch, same OR-fold.
   *
   * TWO DELIBERATE DIFFERENCES from its twin:
   *
   *  1. NO BASE CASE. `battleAugmentAllowed` starts from the printed rule that
   *     a {Virus} from hand may augment during battle; nothing at all is
   *     printed as haste-timed modding, so the whole permission is the grant.
   *  2. AUGMENTS *AND* GRAFTS. "Mod" is R37's word for both, so `ctx.kind`
   *     tells the grantor which is being attempted and both call sites fill it
   *     in. A card that wants to grant only one half reads it; Slurpr grants
   *     both and reads neither.
   *
   * R97's `hastePlayAllowance` is the PLAY-timing cousin and is deliberately
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
      for (const { holder, anchor } of this.anchored((h, a) =>
        this.donates(h, a, 'modPermissions')                   // R127: off the FACES
        && a.region === ctx.region
        && !a.suppressed?.abilities)) {                        // R62, as staticsFor (shallow)
        for (const face of this.behaviorFaces(holder, anchor)) {
          for (const p of this.card(face).modPermissions ?? []) {
            if (p.applyAtHaste?.(this, anchor, ctx)) return true;
          }
        }
      }
    } finally { this.inModPermissions = false; }
    return false;
  }

  /**
   * R95 (haste sibling), gate 1 of the three — the one that decides whether
   * the haste step HAPPENS: does `seat` have any mod it could legally apply if
   * the step opened?
   *
   * `startHasteStep`'s `canHaste` used to ask only about PLAYS, so a board
   * with a Slurpr and a hand of nothing but mods skipped the step outright and
   * the other two gates were unreachable. That is exactly report #74's failure
   * (R97, `hastePlayAllowance`) with "apply a mod" in place of "play a card".
   *
   * Deliberately the same shape as apply.ts's `pushMods`, zone for zone: the
   * three mod zones (R41), a fulfilled prophecy making a cached mod free
   * (R42), otherwise payable at `purpose: 'mod'` (R37/R59), and a legal HOST —
   * a unit of your own in your region (a spell token too, for an augment: R89)
   * and, for a graft, a host with its own graft cause. It answers "yes" only
   * where `legalHasteActions` would really offer something.
   */
  private hasHasteModAvailable(seat: Seat): boolean {
    const region = this.homeRegion(seat);
    const units = this.unitsOf(seat, region);
    const augmentHost = units.length > 0 || this.tokensOf(seat, region).length > 0;
    const graftHost = units.some(u => graftCauseIndex(u.card) >= 0);
    if (!augmentHost && !graftHost) return false;
    for (const from of ['hand', 'bin', 'cache'] as const) {
      const names = from === 'cache' ? this.cache(seat).map(cc => cc.card) : this.player(seat)[from];
      for (let i = 0; i < names.length; i++) {
        const name = names[i]!;
        const card = this.card(name);
        const ok = (augmentHost && isAugment(name)
            && this.mayApplyModAtHaste({ seat, card, from, region, kind: 'augment' }))
          || (graftHost && isGraftable(name)
            && this.mayApplyModAtHaste({ seat, card, from, region, kind: 'graft' }));
        if (!ok) continue;
        const free = from === 'cache' && this.cachePermission(seat, i) === 'prophecy';
        if (free || this.canPayCard(seat, name, { purpose: 'mod' })) return true;
      }
    }
    return false;
  }

  /**
   * R97: how many grant-funded plays may `ctx.seat` make in the HASTE step
   * this turn, for a card whose printed timing is not [Haste]?
   *
   * Report #74 (WEHH, 2026-08-22): "Dispatch Courier didn't give me the option
   * to play a card with haste". It did not, because nothing anywhere asked.
   *
   * The rules half is settled and cited on `PlayPermission` in dsl.ts. This is
   * the arithmetic half, and it is R95's `mayAugmentInBattle` with one
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
   * ⚠ Every one of the THREE gates that must agree routes through this one
   * function: `startHasteStep`'s `canHaste` (which skips the step outright, so
   * missing it makes the other two unreachable), `legalActions`' haste branch,
   * and `playAtTiming`'s planning branch. The fuzzer's "legalActions lied"
   * check exists for exactly this class of split.
   */
  hastePlayAllowance(ctx: import('./cards/dsl.ts').PlayCtx): number {
    if (ctx.card.timing === 'haste') return 0;   // needs no grant (see 2 above)
    if (ctx.card.timing === 'battle') return 0;  // RAQ: a battle card stays one
    if (this.inPlayPermissions) return 0;
    this.inPlayPermissions = true;
    try {
      let total = 0;
      for (const { holder, anchor } of this.anchored((h, a) =>
        this.donates(h, a, 'playPermissions')                  // R127: off the FACES
        && a.region === ctx.region
        && !a.suppressed?.abilities)) {                        // R62, as staticsFor (shallow)
        for (const face of this.behaviorFaces(holder, anchor)) {
          for (const p of this.card(face).playPermissions ?? []) {
            total += p.playAtHaste?.(this, anchor, ctx) ?? 0;
          }
        }
      }
      return total;
    } finally { this.inPlayPermissions = false; }
  }

  /** R97: the boolean the three gates actually ask — is there allowance left
   * this turn? `usedThisTurn` is filled in here so no caller can forget it. */
  mayPlayAtHaste(ctx: Omit<import('./cards/dsl.ts').PlayCtx, 'usedThisTurn'>): boolean {
    const used = this.s.hastePlaysUsed?.[ctx.seat] ?? 0;
    return this.hastePlayAllowance({ ...ctx, usedThisTurn: used }) > used;
  }

  /**
   * R123: the index in `ctx.seat`'s OWN bin of a card granting this haste-step
   * play at the price of its own erasure ("If I am in your bin, you may play a
   * unit as if it had [Haste] by erasing me as an additional cost to play that
   * unit" — Writhing Host), or -1.
   *
   * NOT folded into `hastePlayAllowance`: an R97 allowance is free and this
   * grant costs its grantor, so the two must stay distinguishable — the offer
   * (`legalHasteActions`) and the charge (`playAtTiming`'s erase) both need to
   * know WHICH kind of permission funds the play. The two GENERAL refusals are
   * R97's, restated above every grantor because they are rulings about what
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
    if (ctx.card.timing === 'haste') return -1;   // needs no grant (R97 refusal 2)
    if (ctx.card.timing === 'battle') return -1;  // RAQ: a battle card stays one
    if (this.inPlayPermissions) return -1;        // R62-style reentrancy latch
    this.inPlayPermissions = true;
    try {
      return this.player(ctx.seat).bin.findIndex(name =>
        (this.card(name).binPlayPermissions ?? []).some(p => p.playAtHaste?.(this, ctx) === true));
    } finally { this.inPlayPermissions = false; }
  }

  /** R97: charge one grant-funded haste-step play to `seat`. The sibling of
   * R43's `hasteManaSpent` — same array shape, same per-seat/per-haste-step
   * lifetime, zeroed by `startHasteStep` (which is once per turn, and so IS
   * the printed "Each turn"). A play is not an ability activation, so nothing
   * writes `Entity.budgets` for it and this is where the budget lives. */
  chargeHastePlay(seat: Seat): void {
    const tally = (this.s.hastePlaysUsed ??= this.s.players.map(() => 0));
    tally[seat] = (tally[seat] ?? 0) + 1;
  }

  /** R64: the units in `region` that must be targeted if able. Radiates like
   * a static — live as a unit in play, donated while an augment mod — and is
   * silenced by R62 exactly as an ability is. */
  mustBeTargetedIn(region: number): Set<EntityId> {
    const out = new Set<EntityId>();
    for (const { anchor } of this.anchored((h, a) =>
      this.donates(h, a, 'mustBeTargeted')                      // R127: off the FACES
      && a.region === region
      && !a.suppressed?.abilities)) {                          // R62, as staticsFor (shallow)
      out.add(anchor.id);
    }
    return out;
  }
  /**
   * R58: could `ref` legally occupy target slot `ti` of `item`'s part `pi`
   * RIGHT NOW? Used by redirection effects (Enigmatic Warder's "change a
   * target of target effect to me"), which must not be able to drop an
   * illegal target into a slot — the playtest bug was the opponent's Warder
   * moving itself into Fight's "target ALLY" slot, where ally means ally of
   * the SPELL'S controller, not of the Warder's.
   */
  canFillSlot(item: StackItem, pi: number, ti: number, ref: TargetRef): boolean {
    const part = item.parts[pi];
    if (!part) return false;
    // card code calls this in a loop over an arbitrary stack item, so an
    // unresolvable key must answer "no", never throw
    let def: EffectDef;
    try { def = effectByKey(part.effectKey); } catch { return false; }
    if (!def.targets) return false;
    // "another target unit" — a slot may not duplicate a sibling slot (R56)
    const key = JSON.stringify(ref);
    if (part.targets.some((t, i) => i !== ti && JSON.stringify(t) === key)) return false;
    const cands = this.targetCandidates(
      specForSlot(def.targets, ti), item.region, item.id, item.controller, item.sourceId,
      part.costPaid?.x ?? item.x,
      part.targets.filter((_, i) => i !== ti)
        .map(t => this.resolveTargetRef(t)).filter((t): t is ResolvedTarget => t !== null),
      item.event);   // R67: a redirect must judge the slot the same way the collector did
    return cands.some(c => JSON.stringify(c) === key);
  }
  /**
   * The name a target is offered and logged under. R64: a UNIT says whose it
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
    if ('bin' in t) return this.binIndexOf(t.bin) !== -1;
    // the entry may have been played, grafted or recalled out of the cache
    // between cast and resolution — then it is simply gone (R5 fizzle)
    if ('cached' in t) return this.cacheIndexOf(t.cached.seat, t.cached.uid) !== -1;
    // R68: a stack target is legal exactly while the item is still ON the
    // stack — negation removes it, so "is it there" is the whole question.
    return this.s.stack.some(i => i.id === t.stack);
  }
  resolveTargetRef(t: TargetRef): ResolvedTarget | null {
    if (!this.targetStillLegal(t)) return null;
    if ('unit' in t) return this.entity(t.unit)!;
    if ('cached' in t) {
      const cc = this.cache(t.cached.seat)[this.cacheIndexOf(t.cached.seat, t.cached.uid)]!;
      return { cached: { seat: t.cached.seat, uid: t.cached.uid, card: cc.card } };
    }
    // R64: the bin INDEX is read now, at resolution — cards leave a bin
    // between cast and resolution and the one that matters is wherever the
    // named card sits at this instant.
    if ('bin' in t) {
      return { binCard: { seat: t.bin.seat, index: this.binIndexOf(t.bin), card: t.bin.card } };
    }
    return t as ResolvedTarget;
  }

  // ── the stack & resolution ──────────────────────────────────────────
  pushItem(item: StackItem): void {
    this.s.stack.push(item);
    this.ev('stackPushed', `${item.label} → stack.`, { id: item.id, controller: item.controller });
    // whoever did NOT act responds first; a fresh window starts from initiative
    this.s.passes = 0;
    if (this.s.priority !== null) this.s.priority = other(item.controller);
  }

  /**
   * R68: pull an item OFF the stack and hand it back — the caller decides
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
   * R68: negating REMOVES the item from the stack, the instant the negation
   * resolves, and its card reaches the bin then — it does not sit there greyed
   * out waiting for a priority round it can no longer use.
   *
   * The kinds that carry a card of their own are binned; a triggered or
   * activated ability has no card (its `card` names the SOURCE, which is still
   * in play) and is simply gone; a spell token is erased, never binned (R40).
   * R40 again: this comes from the STACK, so it is not a trash.
   */
  negate(stackId: number): void {
    const it = this.removeFromStack(stackId);
    if (!it) return;
    const hasCard = it.card !== undefined && NEGATE_BINS.has(it.kind);
    // R79: a carrier is Unstable, so even negation cannot put its card in a
    // bin — the card and its viruses are erased. (The Manual's "if a virus is
    // negated … it is placed into the bin" is about the VIRUS ITEM being
    // negated before it ever attached; that item has no augments of its own
    // and still takes the bin branch.)
    // R105: a {Modular} carrier is stamped Unstable at CAST, so a negated one
    // is erased too. R145: and so is a card that PRINTS {Unstable} — the stack
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

  /** Cast-time X selection (R35): a spell played from hand with mana 'X'
   * asks its caster to pick X NOW — it is paid on the answer, stored on the
   * item, and fixed before anyone can respond. Suspends via 'cast'/'x'. */
  private collectX(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[]): void {
    if (item.x !== undefined || !item.card) return;
    if (item.kind !== 'spell' && item.kind !== 'spellUnit') return;
    const c = this.card(item.card);
    if (c.mana !== 'X') return;
    const min = c.xMin ?? 0;
    const max = this.openMana(item.controller);   // canPayCard guaranteed max >= min
    const options: DecisionOption[] = [];
    for (let x = min; x <= max; x++) options.push({ label: `X = ${x}`, value: x });
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
   * they belong here, in R35's cast-time collection, not in a bolt-on: they
   * are chosen and paid before the item reaches the stack, they then ride on
   * the stack with the spell where everyone can see them, and a copy of the
   * spell would copy them.
   *
   * R105 — WHAT IS OFFERED IS EVERY CARD YOU CAN PAY FOR. Owner ruling,
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
   *     see `stackModAttrs`, the same channel R79 built for a virus;
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
        // (R37), so "spells cost more to PLAY" modifiers do not tax it — the
        // same exemption every other mod path (augment/graft) already gets.
        // R105: the cost is the WHOLE filter. Anything you can pay for is on
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
   * R29 — "You may play me into an open spot in your formation."
   *
   * A PLAY, not an effect: the spot is part of how the card is played, so it
   * is chosen at cast alongside X, mods, targets and costs (R35), rides on the
   * stack item where both players can see it, and is TAKEN at resolution
   * atomically with the spawn (see takeSpot). Contrast R75's
   * `E.placeInFormation`, which is a genuine effect resolving — "create a unit
   * in my formation" — and rightly places at resolution time.
   *
   * The card was folded into R75's table when that rule was written, and the
   * cost was the UFAB report: it spawned into the region with no column (which
   * is exactly what the client draws as the invader's zone), stacked a
   * placement trigger, and handed the opponent a priority window in which to
   * recall it. A card that is played into the line was never in the region to
   * be answered.
   *
   * With no formation of your own there is nothing to join, so nothing is
   * asked and the card is simply played (R29). Joining is optional, because
   * the text says *may* — "stay out of formation" is always on the menu when
   * the question is asked at all.
   */
  private collectFormationSpot(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[]): void {
    if (item.formationSpot !== undefined || !item.card) return;
    if (item.kind !== 'unit') return;
    if (!this.card(item.card).playsIntoFormation) return;
    const slots = this.formationSlots(item.controller);
    if (!slots.length) return;   // R29: no formation of yours — no prompt
    const options: DecisionOption[] = slots.map(s => ({ label: s.label, value: s.spot }));
    options.push({ label: 'stay out of formation', value: { kind: 'out' } as FormationSpot });
    this.suspend(
      { type: 'cast', stage: 'formation', item, partIndex: 0, targetIndex: 0, then, moreItems },
      {
        seat: item.controller, kind: 'formationSlot',   // BL-24: same class as R75's ask
        prompt: `${item.card}: which open spot in your formation is it played into?`,
        options,
      },
    );
  }

  /** Attach one chosen {Modular} mod — or stop asking. A COST: paid on the
   * spot, before the item hits the stack, and not respondable (R35). */
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
    // R105: only a GRAFT brings an EFFECT with it — `graft:${name}` is the key
    // of its [Switch] half, and a card without one has no such effect to look
    // up (effectByKey throws). An augment's payload reaches the spell by the
    // OTHER channel instead (stackModAttrs), and a card with neither simply
    // rides along doing nothing, which the owner's ruling explicitly allows.
    if (isGraftable(name)) item.parts.push({ effectKey: `graft:${name}`, targets: [] });
    // R105/R69 — Manual p.35: "As long as a card is modded, it has the unstable
    // attribute, meaning when it dies or is erased, it and all of its mods are
    // erased with it. This means that even though mods can be applied from the
    // bin, they are generally only able to be applied once." That last sentence
    // is about THIS window — it is the only one that applies a mod from a bin.
    // Owner, 2026-08-23: "A modded Spellbind should also have unstable. It
    // basically works as a 'flashback' for graft cards." The stamp is taken
    // here, at cast, rather than derived at disposal, for the same reason R96's
    // is: `dischargeItem` then has ONE flag to read on every exit — resolution,
    // R5 fizzle and negation alike.
    item.unstable = true;
    for (const part of item.parts) part.mods = item.mods.map(m => m.card);
    item.label = `${item.card} + ${item.mods.map(m => m.card).join(' + ')}`;
    // log-only: 'modApplied' means a mod attached to a UNIT (its listeners all
    // read ev.data.host), and there is no host here — the mod is riding a
    // spell. R37 already says applying a mod is not playing a card.
    this.ev('info', `${name} is applied to ${item.card} from ${modFrom} as it is played ({Modular}).`,
      { item: item.id, card: name, from: modFrom });
  }

  /**
   * R105 — a {Modular} spell's mods leave with the card they were applied to,
   * and they leave ERASED.
   *
   * Manual p.35: a modded card is {Unstable}, and "even though mods can be
   * applied from the bin, they are generally only able to be applied once".
   * `payModularMod` stamps `item.unstable` for exactly that reason, so
   * `dischargeItem`'s Unstable branch has already sent the CARD to the public
   * erased pile (R65) by the time this runs; this is the mods' half of the same
   * pile, kept separate only so the pair is logged as a pair. No-op for every
   * other item, and never a bin — which is why this is not `toBin`.
   *
   * The mods are their controller's own cards (they came out of that player's
   * hand or bin), so unlike R79's viruses there is no second owner to split
   * the pile between.
   */
  disposeItemMods(item: StackItem): void {
    const mods = item.mods ?? [];
    if (!mods.length) return;
    const cards = mods.map(m => m.card);
    this.ev('erased',
      `${cards.join(', ')} — erased with ${item.card ?? item.label}: a modded card is Unstable, `
      + 'so a {Modular} mod is applied once and never comes back.',
      { seat: item.controller, cards });
  }

  // ── R35/R49: non-mana costs ─────────────────────────────────────────

  /**
   * R49 ⚠ (engine ruling): may a LIFE cost be paid if it would kill you?
   * NO — a life cost is payable only while you have MORE life than it costs.
   *
   * Life reaching 0 ends the game inside loseLife(), so paying at cast would
   * hand the opponent the win before the spell even resolved; R35 already says
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
   * R64: a VARIABLE cost ('X') asks whether its FLOOR is payable. `xMin` is 0
   * for every printed one — "[Remove X +1/+1 counters from allies]" with no
   * counters anywhere is a legal cast that does nothing, exactly as X = 0 on a
   * mana-X spell is — so the gate is real only where a card sets a floor.
   */
  canPayCastCost(seat: Seat, cost: CastCost, region: number, handReserve = 0, sourceId?: EntityId): boolean {
    const want = costAmount(cost) ?? costXMin(cost);
    switch (cost.kind) {
      case 'sacrificeUnit': return this.unitsOf(seat, region).length > 0;
      // R73: "[Sacrifice me]" asks about the SOURCE, deliberately NOT about
      // `unitsOf(seat, region).length >= want`. A dead source has to make the
      // cost unpayable — that is what makes R5 skip the part, which is the
      // right answer for a trigger whose source died between firing and
      // settling. Any other live unit standing there must not stand in for it.
      // `includeSelf` ("sacrifice me AND another ally", Deformant) asks for
      // BOTH HALVES UP FRONT, and that is the whole point of asking here: the
      // source is charged choice-free before the menu for the rest is ever
      // raised, so a board that can field the source but not the remainder
      // would otherwise kill the source for a cost it cannot finish paying.
      // All or nothing, exactly as R110 demands of a multiplied graft cost.
      case 'sacrificeUnits':
        if (cost.from === 'self') return this.selfSacrificeable(seat, sourceId);
        if (cost.includeSelf) {
          return this.selfSacrificeable(seat, sourceId)
            && this.unitsOf(seat, region).filter(u => u.id !== sourceId).length >= want - 1;
        }
        return this.unitsOf(seat, region).length >= want;
      // a variable life cost is paid a point at a time (R49 re-asked each
      // time), so its floor is "can you survive paying the first one"
      case 'payLife': return this.canPayLife(seat, cost.n === 'X' ? Math.max(1, want) : want);
      case 'discardCard': return this.player(seat).hand.length - handReserve >= want;
      case 'gainDebt': return true;   // debt is always takeable (R39)
      case 'removeCounters': return this.counterPool(seat, region, cost.from, sourceId) >= want;
      case 'eraseBin': return this.player(seat).bin.length >= want;
    }
  }

  /** R64: how many +1/+1 counters a "[Remove X +1/+1 counters …]" cost can
   * reach — every ally's in the region, or just the source unit's own. */
  counterPool(seat: Seat, region: number, from: 'allies' | 'self', sourceId?: EntityId): number {
    if (from === 'self') {
      const u = sourceId !== undefined ? this.entity(sourceId) : undefined;
      return u && u.controller === seat && !u.absent ? Math.max(0, u.counters) : 0;
    }
    return this.unitsOf(seat, region).reduce((n, u) => n + Math.max(0, u.counters), 0);
  }

  /**
   * BL-25/R139: the most counters ONE pick of a "[Remove X +1/+1 counters …]"
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
   * ⚠ R130 — "all counters count as counters". This deliberately makes no
   * eligibility judgement of its own: it reads `counterPool` and `unitsOf`,
   * exactly the two the payability check and the option list read. The
   * `Math.max(0, …)` is `counterPool`'s own, and it is there because counters
   * are ONE signed net int and this cost prints its sign ("+1/+1"), which is
   * the same reason R130 left Pestilent Mycelion's sign filter standing.
   */
  counterPickMax(seat: Seat, region: number, from: 'allies' | 'self', sourceId?: EntityId, owed: number | null = null): number {
    const pool = this.counterPool(seat, region, from, sourceId);
    if (pool <= 0) return 0;
    const biggest = from === 'self' ? pool
      : this.unitsOf(seat, region).reduce((m, u) => Math.max(m, Math.max(0, u.counters)), 0);
    return Math.max(0, Math.min(biggest, pool, owed ?? Infinity));
  }

  /** R73: the source unit of a "[Sacrifice me]" cost, or undefined when it is
   * not there to be sacrificed (already dead, absent, or no longer this
   * seat's). The single reading `canPayCastCost` and `chargeCastCost` share. */
  private selfSacrifice(seat: Seat, sourceId?: EntityId): Entity | undefined {
    const u = sourceId !== undefined ? this.entity(sourceId) : undefined;
    return u && u.kind === 'unit' && !u.absent && u.controller === seat ? u : undefined;
  }
  private selfSacrificeable(seat: Seat, sourceId?: EntityId): boolean {
    return this.selfSacrifice(seat, sourceId) !== undefined;
  }

  /** R64: a cost paid one unit at a time — the ones whose collector loops.
   * R73: "[Sacrifice me]" is NOT one of them — it carries no choice, so it
   * falls through to be charged outright, with no decision and no suspension.
   * That is the whole reason it is unrespondable. */
  private costIsIterated(cost: CastCost): boolean {
    return cost.kind === 'sacrificeUnit'
      || (cost.kind === 'sacrificeUnits' && cost.from !== 'self')
      || cost.kind === 'discardCard' || cost.kind === 'removeCounters'
      || cost.kind === 'eraseBin' || costAmount(cost) === null;
  }

  /** R64: how much of an iterated cost `part` has already paid. */
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
    }
  }

  /** the receipt key a CastCost kind lands in — its presence means "already
   * paid", which is what makes the collector idempotent across a replay.
   * R64: a variable cost is settled by its own `xDone` flag, because a
   * half-paid one and a finished one hold the same shape of receipt. */
  private costSettled(part: EffectPart, cost: CastCost): boolean {
    const paid = part.costPaid;
    if (!paid) return false;
    const want = costAmount(cost);
    if (want === null) return paid.xDone === true;
    return this.costPaidSoFar(part, cost) >= want;
  }

  /**
   * Cast-time bracketed costs (R35): every part whose effect declares a
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
   * R64 — the point of the whole thing, and the playtest report that forced
   * it: "Shouldn't Discharge have you remove counters as an additional cost?
   * Not on resolution". A cost paid at resolution is not a cost. It is paid
   * after the opponent has already decided whether to respond, it can be
   * negated away without ever being paid, and — the thing that actually
   * happened — the caster's own X was still unfixed while priority passed, so
   * the response was made against a spell whose size nobody knew. Everything
   * bracketed is settled HERE, before the item is a thing anyone can answer.
   */
  private collectCastCosts(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[], which: 'variable' | 'fixed'): void {
    for (let pi = 0; pi < item.parts.length; pi++) {
      const part = item.parts[pi]!;
      if (part.spent) continue;
      const def = effectByKey(part.effectKey);
      const cost = def.castCost;
      if (!cost) continue;
      if ((costAmount(cost) === null) !== (which === 'variable')) continue;
      const seat = item.controller;
      // grafted riders are opt-in; the spell's own cost is part of casting it
      const optional = part.effectKey.startsWith('graft:');
      const total = costAmount(cost);
      // a MULTI-unit cost is paid one at a time, so payability has to be asked
      // about what is still OWED, not about the printed total — else the
      // second discard of a "[Discard 2 cards]" looks unpayable and the whole
      // part is wrongly skipped after the first card is already gone
      // R110: a graft multiplied by Lost Guardian / Witness / Amphivore is N
      // parts of this composite, and its [cost] "must be paid twice (Lost
      // Guardian) or thrice (Amphivore)". All or nothing: if the whole N-fold
      // cost is not payable up front, none of it is paid and the effect does
      // not happen at all — asked ONCE, before the first copy pays.
      if (total !== null && optional && !part.costPaid) {
        const copies = this.costCopySiblings(item, part);
        if (copies.length > 1 && !this.canPayCastCost(seat, this.costTimes(cost, copies.length), item.region, 0, item.sourceId)) {
          for (const p of copies) p.spent = true;
          this.ev('info', `${item.label}: the [${this.castCostLabel(cost)}] cost must be paid ${copies.length} times and cannot be — nothing is paid and that effect is skipped.`);
          continue;
        }
      }
      while (!this.costSettled(part, cost)) {
        const done = this.costPaidSoFar(part, cost);
        const owed = total === null ? 1 : total - done;
        if (!this.canPayCastCost(seat, this.costOwing(cost, owed, done), item.region, 0, item.sourceId)) {
          if (total === null) {
            // a variable cost simply stops when nothing more can be paid —
            // what was paid stands, and X is what it is
            this.finishVariableCost(item, part, cost);
            break;
          }
          part.spent = true;   // unpayable: the part never resolves
          this.ev('info', `${item.label}: the [${this.castCostLabel(cost)}] cost cannot be paid — that effect is skipped.`);
          this.refundPart(item, part);   // CARD-TODO #18: it did nothing
          break;
        }
        // choice-free costs: charged on the spot, no decision to ask for. A
        // grafted rider is still opt-in, so it goes through the decision path.
        if (!optional && !this.costIsIterated(cost)) { this.chargeCastCost(item, part, cost); break; }
        // `includeSelf` ("sacrifice me AND another ally", Deformant): the
        // SOURCE half carries no choice, so it is charged FIRST and outright —
        // in this same cast window, before the menu for the remainder is
        // raised. `canPayCastCost` above already demanded both halves, so the
        // source never dies for a cost the rest of which cannot be paid.
        // ⚠ `!optional`: an opt-in grafted rider must be able to decline
        // BEFORE anything is charged, and no card in the pool is both a graft
        // rider and an includeSelf cost. If one ever is, the decline option
        // has to be raised ahead of this line.
        if (!optional && cost.kind === 'sacrificeUnits' && cost.includeSelf && done === 0) {
          this.chargeCastCost(item, part, cost);
          continue;
        }
        // BL-25/R139: a variable cost wants as much as you will give it, so
        // its pick is capped only by the unit; a fixed one may not be overpaid.
        const pickOwed = total === null ? null : owed;
        const options: DecisionOption[] = this.castCostOptions(item, part, cost, pickOwed);
        // payability and the option list read the same pool, so this is a
        // belt-and-braces branch: nothing left to pay with closes a variable
        // cost at what it has, and skips a fixed one rather than under-paying.
        if (!options.length) {
          if (total === null) this.finishVariableCost(item, part, cost);
          else {
            part.spent = true;
            this.ev('info', `${item.label}: the [${this.castCostLabel(cost)}] cost cannot be paid — that effect is skipped.`);
            this.refundPart(item, part);   // CARD-TODO #18: it did nothing
          }
          break;
        }
        // R64: a variable cost is the caster's to size, so "that's enough" is
        // always on the table once its floor is met. It goes LAST, where the
        // targets collector puts "No more targets" — the stop is never the
        // thing your hand lands on first.
        if (total === null && done >= costXMin(cost)) {
          // R74: stopping at X = 0 is legal, and on some cards it is also a
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
        if (optional && !done) options.push({ label: "Don't pay — skip this effect", value: { declineCost: true } });
        this.suspend(
          { type: 'cast', stage: 'cost', item, partIndex: pi, targetIndex: 0, then, moreItems },
          {
            seat, kind: 'targets',
            // BL-25 (owner): "it's just not clear that it wants you to click
            // the unit. It needs to say that." The menu was a row of ally
            // scans under a prompt that named the COST and never the action,
            // so the affordance was there and invisible. Said here rather than
            // in the client so every client — and the log — gets it.
            prompt: `${item.label}: ${this.castCostLabel(cost)}${
              total !== null && total > 1 ? ` (${done + 1} of ${total})` : total === null ? ` (X = ${done} so far)` : ''
            } — additional cost${optional ? ', optional' : ''}${
              cost.kind === 'removeCounters' ? ' — click a unit to take counters off it' : ''}`,
            options,
            ...(cost.kind === 'removeCounters'
              ? { counterMax: this.counterPickMax(seat, item.region, cost.from, item.sourceId, pickOwed) }
              : {}),
          },
        );
      }
    }
  }

  /** R110: the unspent, unpaid copies of one multiplied graft part — the
   * parts that share its mod (itself included, first). */
  private costCopySiblings(item: StackItem, part: EffectPart): EffectPart[] {
    if (part.fromMod === undefined) return [part];
    return item.parts.filter(p => p.fromMod === part.fromMod && p.effectKey === part.effectKey && !p.spent && !p.costPaid);
  }

  /** R110: a fixed cost, k times over — what "pay it k times" must be asked
   * about before the first payment. "[Sacrifice a unit]" k times is k units. */
  private costTimes(cost: CastCost, k: number): CastCost {
    const n = costAmount(cost);
    if (n === null || k <= 1) return cost;
    switch (cost.kind) {
      case 'sacrificeUnit': return { kind: 'sacrificeUnits', n: k };
      case 'sacrificeUnits': return cost.from === 'self' ? cost : { ...cost, n: n * k };
      case 'gainDebt': return cost;
      default: return { ...cost, n: n * k } as CastCost;
    }
  }

  /** R64: the same cost, restated as the amount still owing — what payability
   * must be asked about mid-payment. */
  private costOwing(cost: CastCost, owed: number, done = 0): CastCost {
    if (cost.kind === 'sacrificeUnit' || cost.kind === 'gainDebt') return cost;
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

  /** R64: close a variable cost — X is what was actually paid, and it is
   * written where the resolution reads it (ctx.x). */
  private finishVariableCost(item: StackItem, part: EffectPart, cost: CastCost): void {
    if (costAmount(cost) !== null) return;
    const paid = (part.costPaid ??= {});
    paid.x = this.costPaidSoFar(part, cost);
    paid.xDone = true;
    this.ev('info', `${item.label}: X = ${paid.x} (${this.castCostLabel(cost)}).`);
    // R74: the other way a variable cost lands on zero is that there was
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
    }
  }

  /** the choices a bracketed cost offers (empty for the choice-free kinds,
   * which then present a single "pay it" option on the optional-rider path) */
  private castCostOptions(item: StackItem, part: EffectPart, cost: CastCost, owed: number | null = null): DecisionOption[] {
    const seat = item.controller;
    // R73: "[Sacrifice me]" names no unit, so it offers no unit menu. It only
    // reaches here as an optional grafted rider (pay-or-decline); the normal
    // path charges it without asking. Falls through to the "Pay: …" default.
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
      const seen = new Set<string>();
      return this.player(seat).bin.filter(n => !seen.has(n) && seen.add(n))
        .map(n => ({ label: n, value: { erase: n }, card: n }));
    }
    // R64: a VARIABLE life cost is paid a point at a time, so that R49's
    // "never your last life" is re-asked before each one.
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
      // BL-25/R139: a pick may take SEVERAL counters off the unit it names,
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
      // R73: "[Sacrifice me]". No choice, so no decision and no suspension —
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

  /** Pay a chosen cast-time cost (R35): a COST, not an effect — paid before
   * the item hits the stack, not respondable. The receipt (with the victim's
   * stats snapshotted now) lands on the part for resolution to read. */
  payCastCost(item: StackItem, partIndex: number, val: unknown): void {
    const part = item.parts[partIndex]!;
    const cost = effectByKey(part.effectKey).castCost!;
    const obj = val !== null && typeof val === 'object' ? val as Record<string, unknown> : {};
    if ('declineCost' in obj) {
      // R110: the rider is paid N times or not at all — declining the first
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
      this.removeFromBin(item.controller, idx, 'erased');   // R124
      (paid.erased ??= []).push(name);
      // 'erased', not 'info': this is a real erase, and R65's public pile is
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
      // BL-25/R139: one pick, several counters. Absent `n` is 1 — the shape
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
      this.addCounters(u!, -n);
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

  /**
   * R49: the ITEM-level activation costs that carry a choice — "Discard a
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
      // shape; the plain sacrifice-another cost takes any unit you control
      const sacs = this.unitsOf(seat, item.region)
        .filter(u => u.id !== item.sourceId && (atom.kind !== 'discardOrSacrifice' || !u.token));
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
        // the whole activation is skipped — R35's unpayable-cost reading.
        // ⚠ LATENT (2026-08-23 audit): "nothing is paid" holds only because
        // no pool ability combines a choice-free half (mana/life/debt/
        // sacrifice-me, charged by payActivationCost one call EARLIER) with a
        // choice half like this one. The first card that does will reach
        // here with its mana already spent — refund it or reorder the two
        // collectors then; a ruling is needed on which.
        // R122: for a 'playSacrifice' atom this branch is unreachable by
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
      this.need(u && u.kind === 'unit' && u.controller === item.controller && !u.absent
        && u.region === item.region && u.id !== item.sourceId
        && (atom!.kind !== 'discardOrSacrifice' || !u.token), 'bad cost choice');
      (receipt.sacrificed ??= []).push(u!.card);
      this.ev('info', `${this.pname(item.controller)} sacrifices ${u!.card} — the cost of ${item.label}.`);
      this.destroy(u!, 'is sacrificed');
    }
    atom!.n--;
    if (atom!.n <= 0) item.pendingCosts!.shift();
    if (!item.pendingCosts!.length) delete item.pendingCosts;
  }

  /** Ask for every cast-time decision, in order: X (R35), {Modular} mods,
   * TARGETS for every part that needs them, then the costs — ALL at cast time
   * (multi-target specs included). Suspends via 'cast'.
   *
   * R57: targets are chosen BEFORE any activation cost is paid. They used to
   * come last, so "Sacrifice me: …" destroyed the unit and only then showed
   * you what you could aim at — irreversible, and a disaster to fumble during
   * battle when you meant to block with it. Choosing first also means a
   * player who cannot aim the ability anywhere still has their unit.
   */
  collectTargets(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[]): void {
    this.collectX(item, then, moreItems);
    // R64: a VARIABLE bracketed cost is where X comes from ("[Remove X +1/+1
    // counters from allies]", "[Sacrifice X units]"), so it is paid up here
    // with the mana X rather than down with the fixed costs — the spell's size
    // has to be settled before it can be aimed, since what it may aim at is
    // sized by X ("Negate up to X target effects"). R57's "targets before
    // costs" is about not destroying a unit before showing what it could have
    // hit; a cost that decides how big the spell is has no such reading.
    this.collectCastCosts(item, then, moreItems, 'variable');
    // {Modular} before the costs and the targets: an applied mod adds a part,
    // and that part has its own [cost] and its own targets to collect
    // (Manual p.33 — the composite resolves as ONE ability)
    this.collectModular(item, then, moreItems);
    this.collectPartTargets(item, then, moreItems);
    // R144: the AIM of an untargeted effect ("put a -1/-1 counter on an
    // ally"). Beside the targets and for the same reason R67 puts targets
    // here: an effect is DECLARED before it is on the stack, so several
    // simultaneous triggers are all aimed while the board still looks the way
    // it did when they fired. Before the modes, so a mode may read the aim,
    // exactly as it may read the targets.
    this.collectSubjects(item, then, moreItems);
    // R57: WHICH HALF of a modal effect. AFTER the targets, so a mode can name
    // what it is aimed at ("double Good Whale's power (5 → 10) or defense
    // (3 → 6)?"); BEFORE the costs, so R57's "nothing irreversible is spent
    // until the effect is fully declared" holds for a modal card too.
    this.collectModes(item, then, moreItems);
    this.collectFormationSpot(item, then, moreItems);   // R29: "play me into a spot"
    this.payActivationCost(item);                   // R57: choice-free half
    this.collectItemCosts(item, then, moreItems);   // R49: the choice-bearing half
    this.collectCastCosts(item, then, moreItems, 'fixed');
  }

  /**
   * R57: charge the choice-free half of an activation cost — mana, life, debt
   * and sacrifice-self — once the ability's targets are settled. Deleting the
   * field is the idempotence guard: collectTargets re-runs from the top after
   * every answered decision, and this must not charge twice.
   */
  private payActivationCost(item: StackItem): void {
    const cost = item.activationCost;
    if (!cost) return;
    delete item.activationCost;
    const seat = item.controller;
    // R121: the ability-cost tax layer (Crevice Lurker) joins the printed
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
      // not a death, so nothing triggers off it and no card reaches a bin.
      const u = item.sourceId !== undefined ? this.entity(item.sourceId) : undefined;
      if (u && u.kind === 'unit') this.eraseFromPlay(u, `— the cost of ${item.label}.`);
    }
  }

  /**
   * Remove a unit from play ENTIRELY: no bin, no death, no despawn, so nothing
   * triggers off it, and (R40) no trash either — Caleb: erasing never touches a
   * bin, so it is never a trash. Its mods go with it, having nothing left to be
   * attached to. R65: the card reaches its controller's public erased pile,
   * which ev() keeps off the 'erased' event.
   *
   * ⚠ Three card-side copies of this predate it and are still in use
   * (helpers.ts's `eraseFromPlay`, batch-hybrids-ld-a's `eraseUnit`,
   * batch-water-a's Celestial Purge) — the batch headers say out loud that
   * "the engine has no shared erase primitive". It has one now; folding those
   * three into it is a separate sweep, since each carries its own log wording
   * that card tests read.
   */
  eraseFromPlay(u: Entity, why = ''): void {
    if (!this.entity(u.id)) return;
    // R157 §10: the erased pile is a zone other than play, so a transformed
    // card is recorded there under its FRONT face — the piece of cardboard
    // that left the game is the printed card, not the side it was showing.
    this.revertFace(u);
    const mods = u.mods.map(id => this.entity(id)).filter((m): m is Entity => !!m);
    delete this.s.entities[u.id];
    for (const m of mods) delete this.s.entities[m.id];
    this.removeFromFormation(u.id);
    // R65: the host AND its mods reach the public erased pile, under the
    // host's OWNER — the same seat and the same one-event shape `destroy`
    // uses for an Unstable death, so the two erase routes read alike.
    this.ev('erased',
      `${u.card}${mods.length ? ` and its ${mods.length} mod(s)` : ''} is ERASED `
      + `(no bin, no death)${why ? ` ${why}` : '.'}`,
      {
        unit: u.id, card: u.card, seat: u.owner, region: u.region,
        cards: [u.card, ...mods.map(m => m.card)],
      });
  }

  private collectPartTargets(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[]): void {
    for (let pi = 0; pi < item.parts.length; pi++) {
      const part = item.parts[pi]!;
      if (part.spent) continue;
      const def = effectByKey(part.effectKey);
      if (!def.targets) continue;
      // R64: "X target allies" / "up to X target effects" — the spec's count is
      // the spell's X, already fixed by collectX or by a variable cast cost.
      // R83: `extraSlots` are fixed slots ON TOP of that count, occupying the
      // low indices (Channel Through's "target opponent" beside its X allies).
      const counted = def.targets.count === 'X'
        ? (part.costPaid?.x ?? item.x ?? 0)
        : (def.targets.count ?? 1);
      const max = counted + (def.targets.extraSlots ?? 0);
      const min = Math.min(def.targets.min ?? 1, max);
      if (max <= 0) { part.targetsDone = true; continue; }
      while (!part.targetsDone && part.targets.length < max) {
        const n = part.targets.length;
        // R58: each slot may carry its own restriction (Fight: ally, then any
        // other unit), so candidates are computed per slot rather than once.
        const slot = specForSlot(def.targets, n);
        const chosen = new Set(part.targets.map(t => JSON.stringify(t)));
        const already = part.targets
          .map(t => this.resolveTargetRef(t)).filter((t): t is ResolvedTarget => t !== null);
        const cands = this.targetCandidates(slot, item.region, item.id, item.controller,
          item.sourceId, part.costPaid?.x ?? item.x, already, item.event)
          .filter(c => !chosen.has(JSON.stringify(c)));
        if (!cands.length) {
          // R64: nothing legal to aim at. The part is skipped at resolution
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
        // `card` gives the UI a scan to render for targets that are not on the
        // board — a card in a bin or a cache has no entity to look at
        const options: DecisionOption[] =
          cands.map(c => ({ label: this.targetLabel(c), value: c as TargetRef, ...this.targetCardOf(c) }));
        if (part.targets.length >= min) {
          options.push({ label: 'No more targets', value: { doneTargets: true } });
        }
        const base = def.targets.slotPrompts?.[n] ?? def.targets.prompt;
        this.suspend(
          { type: 'cast', item, partIndex: pi, targetIndex: n, then, moreItems },
          {
            seat: item.controller, kind: 'targets',
            prompt: max > 1 && !def.targets.slotPrompts?.[n]
              ? `${base} (target ${n + 1} of up to ${max})` : base,
            options: options as { label: string; value: TargetRef }[],
          },
        );
      }
    }
  }

  /**
   * R144 — ask WHAT an untargeted effect is aimed at, once per subject-bearing
   * part, in the stack window.
   *
   * THE BUG THIS EXISTS FOR, and the owner's ruling on it (report #101, room
   * SMVJ): *"All Wraith triggers should go onto the stack simultaneously and
   * be allowed to target the same unit, even exceeding its defense (the final
   * triggers would just fizzle)."* The Wraith's "an ally" is not a target (R71
   * — the word is not printed), so it was picked with a `ctx.choose` INSIDE
   * the resolution. Four Wraiths at the start of deployment therefore aimed
   * one at a time in four different worlds: the first killed the 3/3, and the
   * other three were offered a menu it was no longer on and had to shrink
   * somebody else. The player could not spend a pile of triggers on one unit,
   * and the leftovers ate his own board instead of doing nothing.
   *
   * Moving the choice HERE is the fix, and it is the only thing that could be:
   * a trigger cannot be aimed at a unit an earlier one is about to kill unless
   * it is aimed BEFORE that one resolves. `E.resolveItem` then does the other
   * half — a part whose subject has left play is lost, and an item that has
   * lost every subject and target it declared fizzles (R86's rule, unchanged,
   * with subjects counted alongside targets).
   *
   * A SUBJECT IS NOT A TARGET and `EffectDef.subject` says at length what that
   * withholds — no `'targeted'` event, no redirect, no compulsion. Read that
   * before reaching for a `TargetSpec` instead of this.
   *
   * `part.subject !== undefined` is the idempotence guard — collectTargets
   * re-runs from the top after every answered decision — which is why a part
   * with nothing to aim at records `null` rather than staying undefined and
   * asking again forever. Fewer than two candidates is not a question, exactly
   * as in `collectModes`; the auto-pick is what keeps a lone Wraith from being
   * asked which of its single ally it means.
   */
  private collectSubjects(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[]): void {
    for (let pi = 0; pi < item.parts.length; pi++) {
      const part = item.parts[pi]!;
      if (part.spent) continue;
      if (part.subject !== undefined) continue;   // idempotence guard (see above)
      const def = effectByKey(part.effectKey);
      if (!def.subject) continue;
      const cands = def.subject.candidates(this, item, part);
      if (cands.length < 2) {
        part.subject = cands.length ? cands[0]!.id : null;
        continue;
      }
      this.suspend(
        { type: 'cast', stage: 'subject', item, partIndex: pi, targetIndex: 0, then, moreItems },
        {
          seat: item.controller, kind: 'electricPath',
          prompt: def.subject.prompt(this, item, part),
          options: cands.map(u => ({ label: u.card, value: u.id, card: u.card })),
        },
      );
    }
  }

  /**
   * R57 — ask which HALF of a modal effect ("[… or …]") the caster is casting,
   * once per modal part, in the cast window.
   *
   * THE BUG THIS EXISTS FOR (playtest, Burgeon): every caster-facing mode in
   * the pool used to be a mid-resolution `ctx.choose`, so the item reached the
   * stack with its mode UNKNOWN. The opponent spent a card responding to a
   * Burgeon whose half had not been declared; the response resolved; and only
   * then was the caster asked — with the option labels recomputed off the
   * post-response stats. That is free information the opponent paid for, and
   * it is the same defect R67 fixed for targets: a response window is only
   * meaningful if what you are responding to is fully declared.
   *
   * A mode is not a target and not a cost, so it gets its own stage rather
   * than riding on one of theirs. `part.mode !== undefined` is the idempotence
   * guard — collectTargets re-runs from the top after every answered decision
   * — which is why a part with nothing to choose between records `null`
   * instead of staying undefined and asking again forever.
   *
   * ONLY the caster's own modes belong here. A half somebody ELSE picks stays
   * at resolution, where the rules put it: R6's "unless its controller pays"
   * (Abduct), R67's not-a-target carve-out ("each opponent discards a [unit or
   * spell]" — Void Memory), and a replacement-effect mode (Cosmic
   * Conspirator), which is raised before the token it is about exists.
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

  /** `moreItems` is the rest of the cast chain this item heads (castChain);
   * when `then` is 'resolve' it rides on any mid-resolution suspension the
   * item raises, so the chain is not lost if the player has to be asked. */
  commitItem(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[] = []): void {
    // "When I become targeted" (Mohruung). PLAYTEST BUG: this logged the event
    // but never DISPATCHED it, so a spell aimed at Mohruung created no Crystal.
    // Modding already fired it (doAugment/doGraft) — only the stack path was
    // deaf. Dispatch carries the region so region-scoped listeners resolve;
    // the targeted unit's own region is the authority (the item's region and
    // the target's agree for every legal target, and `self: true` listeners
    // match on `unit` anyway).
    for (const part of item.parts) {
      for (const t of part.targets) {
        if (!('unit' in t)) continue;
        const u = this.s.entities[t.unit];
        const ev = this.ev('targeted', `${item.label} targets ${this.targetLabel(t)}.`,
          { item: item.id, unit: t.unit, ...(u ? { region: u.region } : {}) });
        this.fireEvent('targeted', ev);
      }
    }
    if (item.kind === 'spell' || item.kind === 'spellUnit' || item.kind === 'spellToken') {
      // "spells you've played this battle" ledger (Animated Spark's static)
      if (this.s.phase === 'battle' && item.kind !== 'spellToken') {
        this.bumpBattleCounter(item.region, `spellsPlayed:${item.controller}`);
      }
      const ev = this.ev('spellPlayed',
        `${this.pname(item.controller)} plays ${item.label}${then === 'push' ? ' → stack' : ''}.`,
        {
          seat: item.controller, card: item.card, token: item.kind === 'spellToken',
          region: item.region,
          // R49: the zone it was played out of ('hand' / 'cache' / 'bin').
          // Absent on a spell TOKEN, which was never in a zone at all.
          ...(item.from ? { from: item.from } : {}),
        });
      // R119: playing a spell burns the Deferral Drone charge — but a spell
      // TOKEN is cast from play, not played (R59), so it does not. Same test
      // the card's own bookkeeping trigger used to make; engine-side now, so
      // the charge outlives the Drone in both halves (grant AND spend).
      if (item.kind !== 'spellToken') this.spendNextPlayDiscount(item.controller);
      this.fireEvent('spellPlayed', ev);
    }
    // R129: "when a CARD is played" — the wide event, fired ALONGSIDE
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
    //  · 'spellToken' is OUT: a token is not a card, and R59 already says a
    //    spell token is cast from play rather than played.
    //  · 'virus' is OUT: applying a mod is not playing a card (R37). It never
    //    reaches commitItem today (doAugment pushes it straight onto the
    //    stack), and naming it there is what keeps that true if it ever does.
    //  · 'triggered' / 'activated' are not plays at all.
    // Signal-only (msg ''): the play already announced itself on 'spellPlayed'
    // or, for a unit, on the 'spawned' line at resolution.
    if (CARD_PLAY_KINDS.has(item.kind)) {
      const ev = this.ev('cardPlayed', '', {
        seat: item.controller, card: item.card, token: false, region: item.region,
        ...(item.from ? { from: item.from } : {}),   // R49: the zone it came out of
      });
      this.fireEvent('cardPlayed', ev);
    }
    if (then === 'push') { this.pushItem(item); return; }
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
   * R78: mark `item` as the one currently resolving and hand back whatever was
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

  /** R78: resolution finished (or fizzled, or partially resolved, or the item
   * was never really there) — hand the marker back. Called on EVERY normal
   * exit from resolveItem; a suspension deliberately throws past it, which is
   * the whole point: the item stays marked until it has ACTUALLY resolved. */
  endResolving(outer: StackItem | null): void {
    this.s.resolving = outer;
  }

  resolveTop(): void {
    const item = this.s.stack.pop()!;
    // R78: it is off the stack — nobody may respond to it or negate it now —
    // but it has not resolved yet, and it says so until it has.
    const outer = this.beginResolving(item);
    this.resolveItem(item);
    this.endResolving(outer);
    this.finishResolutionTail();
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
   * R68: there is no `item.negated` branch here any more. A negated item is
   * off the stack and binned before this can ever see it, so the branch was
   * unreachable from both of resolveItem's callers — `resolveTop()` pops from
   * a stack that no longer holds negated items, and `commitItem(…, 'resolve')`
   * hands over an item freshly built with `negated: false` that was never on
   * the stack for anyone to answer.
   */
  resolveItem(item: StackItem, chain?: ChainRest): void {
    if (item.kind === 'unit') {
      // R29: `formationSpot` is where this card was PLAYED — chosen at cast
      // (collectFormationSpot), taken here, atomically with the spawn.
      this.spawnUnit(item.controller, item.card!, item.region, {
        ...(item.from ? { from: item.from } : {}),
        ...(item.formationSpot ? { spot: item.formationSpot } : {}),
      });
      return;
    }
    if (item.kind === 'virus') {
      // R79: a virus aimed at a SPELL ON THE STACK. Its host is legal exactly
      // while it is still ON the stack: negated out from under it (R68) or
      // recalled, and the virus fizzles to the bin — Manual p.34, "If a virus
      // is negated or its target becomes invalid, it is placed into the bin,
      // and cannot be used as a virus again".
      //
      // R145 — ⚠ both fizzle branches used to call `toBin(…, 'stack')` RAW,
      // which made them a third computation of "is this Unstable?" that simply
      // said no. They go through `dischargeItem` now, exactly as `negate()`
      // does, so the three stack exits share one predicate and one erase.
      // dischargeItem is the right choke rather than a smaller helper because
      // it already owns the whole disposition — the R65 per-owner erased pile,
      // the R79 virus split, the eraseSelf branch, and `disposeItemMods` — and
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
        this.dischargeItem(item, true);   // R40: from the stack, no trash either way
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
    // R86, playtest report #71 (game GETD, 2026-08-22): an item fizzles when it
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
      // R144: a declared SUBJECT is exactly a declared target for this vote —
      // it was aimed in the stack window and it can go stale. A part that
      // declared NOTHING (`subject === null`: there was no ally at all) still
      // does not vote and still cannot fizzle the item, which is R71's "with
      // no ally it simply does nothing", unmoved.
      if (def.subject) return part.subject != null && !!this.entity(part.subject);
      if (!def.targets) return false;   // R86: untargeted parts do not vote
      // "UP TO one target …" (min 0): declaring no target is a legal choice, so
      // the part still resolves — anything printed alongside the optional
      // target ("Recall up to one target cached card. You gain 3 life.") must
      // happen. A min-1 spec with nothing declared is the real fizzle: it is
      // the part collectTargets already reported as "there is no legal target
      // for that — it does nothing", and an item made only of those is an
      // effect that wanted a target and never had one.
      if (!part.targets.length) return (def.targets.min ?? 1) === 0;
      return part.targets.some(t => this.targetStillLegal(t));
    };
    // R144: "did this item declare anything it could lose?" — a target, or a
    // subject that actually named something. A subject-bearing part whose
    // `subject` is null declared nothing and keeps the item off this branch.
    const declaredTargets = item.parts.some(p => !p.spent && !!effectByKey(p.effectKey).targets);
    const declaredSubject = item.parts.some(p =>
      !p.spent && !!effectByKey(p.effectKey).subject && p.subject != null);
    const targeted = declaredTargets || declaredSubject;
    if (targeted && !item.parts.some(partAlive)) {
      // R109's precedent, and the owner's "the final triggers would just
      // fizzle": a no-op ANNOUNCES. A trigger that vanished silently because
      // the unit it was aimed at died under it is indistinguishable from a bug
      // at the table, which is the whole reason this line is not a `return`.
      this.ev('fizzled',
        declaredTargets
          ? `${item.label} fizzles — all targets are gone.`
          : `${item.label} fizzles — what it was aimed at has left play.`,
        { id: item.id });
      /**
       * R113 / CARD-TODO #20: a fizzle SPENDS the bounded budget. It does NOT
       * refund it, and the previous R108 answer here was wrong.
       *
       * RULED (designer, 2026-08-23), asked about `[bounded_graft]`: *"can only
       * be activated or triggered once per turn. REGARDLESS OF IF THAT ABILITY
       * RESOLVES OR DOESN'T."* A fizzled item was triggered — it went on the
       * stack and then lost its targets — so the use is gone. The earlier
       * reading ("a fizzle is the ability doing nothing, like a decline") is
       * the one that sentence rules out by name.
       *
       * THE LINE R113 DRAWS, and the reason this branch is on the far side of
       * it: a bounded use survives only where the player was OFFERED the
       * ability and did not take it up (or could not be offered it at all).
       * Once it is on the stack it has been used, and what happens afterwards —
       * fizzling, whiffing, being negated — cannot hand it back. Removing a
       * target in response is therefore a real answer to a bounded trigger,
       * which is the whole point of doing it.
       */
      // a fizzled spell unit never spawns; a fizzled ambusher is binned too
      // ("you could find yourself losing both units" — Manual p.40).
      // R40: still the stack, so still not a trash. R79: a fizzled carrier is
      // still a modded card leaving the stack, so Unstable still replaces the
      // bin with an erase — the virus was applied and is spent either way.
      this.dischargeItem(item,
        item.kind === 'spell' || item.kind === 'spellUnit' || item.kind === 'ambush');
      return;
    }
    // R78, playtest 2026-08-22: this line is a HEADING for the effects printed
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
   * R45 "cache one of these N") would otherwise have to take an EffectCtx, and
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
   * R130: the controller of the part currently resolving, or null outside one
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

  /**
   * Run parts [from..]; the composite is ONE ability resolving top-to-bottom.
   * A suspending part is replayed from its own boundary with `answers` filled
   * in — R85: the world is rolled back to that boundary on RESUME
   * (E.resumeResolve), not at the suspension, so the half-finished resolution
   * is what the table gets to look at while somebody is being asked something.
   *
   * `shownEvents` is R85's other half, and applies to part `from` only: that
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
      const resolved = part.targets
        .map(t => this.resolveTargetRef(t))
        .filter((t): t is ResolvedTarget => t !== null);
      if (def.targets && part.targets.length && !resolved.length) {
        this.ev('info', `${item.label}: a part fizzles (target gone).`);
        continue;                                       // R5: partial resolution
      }
      // never had a target — but "up to one" (min 0) still runs, with an empty
      // ctx.targets, so its unconditional half happens
      if (def.targets && !part.targets.length && (def.targets.min ?? 1) > 0) continue;
      // R144: the part's declared SUBJECT, looked up NOW. A part that aimed at
      // something which has since left play is lost — the sibling of the
      // target line above, and the reason a pile of triggers may all be aimed
      // at one unit: the surplus lands here. `null` (nothing to aim at) is not
      // a loss and runs normally, so the effect can say it did nothing (R71).
      const subject = def.subject && part.subject != null
        ? (this.entity(part.subject) ?? null) : null;
      if (def.subject && part.subject != null && !subject) {
        this.ev('info', `${item.label}: a part fizzles (what it was aimed at is gone).`);
        continue;                                       // R5: partial resolution
      }
      const ctx: EffectCtx = {
        controller: item.controller,
        sourceName: item.card ?? item.label,
        sourceId: item.sourceId,
        // R131: the mod entity whose donated text this is, if any — the only
        // handle "my OTHER Augments" has on the one augment that is itself.
        ...(item.selfModId !== undefined ? { selfModId: item.selfModId } : {}),
        region: item.region,
        targets: resolved,
        // R64: a VARIABLE cast cost defines this part's X (Discharge's "remove
        // X counters … deal X damage"). It wins over the item-wide mana X so a
        // grafted rider that paid its own cost cannot read its carrier's.
        x: part.costPaid?.x ?? item.x,
        costPaid: part.costPaid,
        // R57: the modal half, declared in the cast window by collectModes and
        // visible on the stack for the whole response window. The effect reads
        // it; it never asks.
        ...(part.mode !== undefined ? { mode: part.mode } : {}),
        // R144: what this effect was AIMED at, declared in the stack window by
        // collectSubjects. The live entity, or null when there was nothing to
        // aim at — never a dead one, because the branch above already fizzled
        // that part rather than handing its run a corpse.
        ...(def.subject ? { subject } : {}),
        ...(part.mods ? { mods: part.mods } : {}),
        // R79's virus grants UNIONED with R105's {Modular}-mod grants and
        // R94's continuous ones. All three are "attributes this effect has
        // that its card did not print", all three land in the one field
        // everything downstream already reads, and the union must stay INSIDE
        // the per-part loop: R94's answer is per-part (Envoy of Lightning
        // counts THIS part's declared targets), while R79's and R105's are
        // per-item.
        ...(() => {
          const granted: Attr[] = [
            ...(item.augments?.length ? this.stackAugmentAttrs(item) : []),
            // R105: a mod applied through the {Modular} window donates its
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
              // while `resolved` above has already dropped the dead refs. RAQ
              // "[Solved] Envoy of Lightning vs Twin Flame.": a two-target Twin
              // Flame that lost one target is NOT Electric — "it still has 2
              // targets, but one of them is invalid".
              targets: part.targets.length,
            }),
          ];
          return granted.length ? { grantedAttrs: granted } : {};
        })(),
        // "Erase me." — raise the flag ON THE ITEM (see StackItem.eraseSelf).
        // It has to be state and not a closure variable because a part can
        // suspend mid-resolution and be replayed out of the serialised
        // suspension (R85); `item` is what the suspension carries, so the
        // answer survives the round trip. `dischargeItem` reads it afterwards.
        eraseSelf: () => { item.eraseSelf = true; },
        // R143: "…gains control of me" on a SPELL UNIT — the body has not been
        // spawned yet (afterParts does that once every part has run), so this
        // says who it ENTERS under rather than moving it afterwards. Same
        // on-the-item shape as eraseSelf above, same R85 reason.
        spawnUnder: (seat: Seat) => { item.spawnUnder = seat; },
        // R147: "I become an exact copy of that unit." on a SPELL UNIT — the
        // same seam one question over (spawnUnder says whose the body is,
        // this says what it is), and on the item for the same R85 reason.
        spawnWearing: (face: SpawnFace) => { item.spawnWearing = face; },
        // CARD-TODO #18: "I did nothing — give the [once] back." The same
        // shape as eraseSelf directly above, and for the same R85 reason: the
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
      // R48 {Afflicting}: snapshot the units in play, so the kills this part
      // makes — by damage, by -1/-1 counters, by anything — can be diffed out
      // once it has finished. Discarded on a suspension rollback and retaken
      // when the part replays.
      const afflicting = this.itemAttrs(item).has('Afflicting');
      const beforeUnits = afflicting ? this.snapshotUnits() : null;
      // R85: the rollback state, carried ON the suspension and applied when
      // the answer comes back rather than here.
      const snap = structuredClone(this.s);
      const evLen = this.events.length;
      // events of THIS part the table has already been shown (a replay of a
      // part that has suspended before); the re-emission is dropped below.
      const shown = pi === from ? shownEvents : 0;
      const outerChoose = this.partChoose;
      const outerActor = this.partActor;                  // R130
      this.partActor = item.controller;
      let helperSeq = 0;
      // ctx.choose already namespaces by part index; the seq keeps a helper
      // invoked twice in one part asking two distinct questions
      this.partChoose = (tag, dec) => ctx.choose(`${tag}#${helperSeq++}`, dec);
      // R104: ONE RESOLVING PART IS ONE TOKEN-CREATION BATCH — the same unit
      // R80 gave effect damage ("One resolution of one effect, one batch").
      // Biotoxicity's three Poisons are one creation, so "an additional copy of
      // each UNIQUE token you created" has one creation to be unique across
      // (report #60), and Cosmic Conspirator is asked once per token inside it
      // (report #64).
      //
      // Settled INSIDE the try, right after the part finishes, so that a
      // decision raised by a batch replacement suspends and replays through
      // exactly the machinery every other mid-resolution question uses. A part
      // that suspends before finishing leaves its batch unsettled on purpose:
      // R85 rolls the world back to the part boundary and replays it, and a
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
          // R78: `s.resolving` and the suspension's `item` must be ONE object,
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
              // BL-25/R139: an effect that removes counters says its own
              // ceiling here — the quantity stepper is not a cost-only thing.
              ...(sig.dec.counterMax !== undefined ? { counterMax: sig.dec.counterMax } : {}),
            },
          );
        }
        throw sig;
      } finally {
        this.partChoose = outerChoose;
        this.partActor = outerActor;                      // R130
        this.tokenBatch = outerBatch;
      }
      // the part finished: the same suppression, for the last replay of it
      if (shown) this.events.splice(evLen, Math.min(shown, this.events.length - evLen));
      // CARD-TODO #18: …and only now, once it really has finished, is a
      // refused [once] handed back. A suspension throws past this line, so a
      // part that is still being answered keeps its reservation.
      this.settleBudgetRefund(item, part);
      this.checkDeaths();   // sequential within the composite; triggers wait for settle()
      if (beforeUnits) this.afflictingKills(beforeUnits, item.card ?? item.label);
    }
  }

  /**
   * CARD-TODO #18: pay back the `[once]` a finished part refused to spend.
   *
   * THE RULING, as R113 finally settles it (designer, 2026-08-23): a bounded
   * ability "can only be activated or triggered once per turn, REGARDLESS OF
   * IF THAT ABILITY RESOLVES OR DOESN'T" — and, for Hexbane Shiitake's [once],
   * "you can choose for each spell if you want to let it trigger and to put
   * the ability on the stack." So the use is spent the moment the ability is
   * activated or put on the stack, and the ONLY thing that keeps it is the
   * player declining the ability, or no offer being possible at all.
   *
   * WHAT THIS IS NOT, and the reason to read it twice: it is not "the ability
   * did nothing". That was R108's first reading and R113 reverses it. A run
   * that was used and found nothing to do — an activated ability with no legal
   * subject, a targeted trigger whose target left, a fizzle — spends the use.
   * Six such calls were deleted from the card pool when R113 landed; do not
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
   * A {Modular} graft riding a SPELL (`item.parts.push({ effectKey: 'graft:…' })`,
   * R105) has no `fromMod` and no source entity, so it reserves nothing and
   * this is correctly a no-op: that mod was paid as a cast cost, not budgeted.
   *
   * IDEMPOTENT in both directions. Zeroing an already-zero budget is the same
   * as zeroing it once; and because the flag is raised inside the run while
   * R85 rolls a suspended part back to its boundary, a replay that reaches a
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
   * CAST-TIME routes can reach it too. R113: the fizzle branch of `resolveItem`
   * used to call this as well — it does not any more, and must not again. A cast [cost] that is DECLINED or
   * UNPAYABLE marks its part `spent` before the run exists (R35), so that part
   * can never call `ctx.refundBudget()` — and "the [cost] is declined" is the
   * most reachable decline in the pool, because a bounded [Switch1] rider is
   * usually met as a graft on somebody else's composite.
   */
  private refundPart(item: StackItem, part: EffectPart): void {
    part.refunded = true;
    // R124: a zone-dispatched part's reservation lives in GameState.zoneBudgets
    // (its stand-in source, id -1, is not in s.entities and is long gone) —
    // hand it back there, so R113 holds from a bin exactly as it does in play.
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

  /** The attributes of a stack item's SOURCE: the source entity's live attrs
   * while it is still in play (so granted ones count), otherwise the printed
   * card's. Used by the resolution-time attribute checks ({Afflicting}). */
  itemAttrs(item: StackItem): Set<string> {
    const src = item.sourceId !== undefined ? this.entity(item.sourceId) : undefined;
    const set = src ? this.ownAttrs(src)
      : new Set<string>(item.card ? this.card(item.card).attrs : []);
    for (const a of this.stackAugmentAttrs(item)) set.add(a);   // R79
    for (const a of this.stackModAttrs(item)) set.add(a);       // R105
    return set;
  }

  /**
   * R79: the attributes a VIRUS augmented onto this stack item donates to it.
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
   * R105: the attributes a {Modular} MOD donates to the card it was applied to.
   *
   * The same channel as `stackAugmentAttrs` above, by a different timing — a
   * mod paid as a cast cost rather than a virus applied as a response — and
   * deliberately the same rule, because it is the same act: a mod is on a
   * spell, and "the only useful thing you can do is give them attributes"
   * (Caleb 2025-04-24). A separate method, not a widened `stackAugmentAttrs`,
   * so R79's virus channel keeps meaning exactly what its name says.
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

  /** R79: attach a virus to a stack item. Rules-inert beyond the attachment:
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
   * R68/R79: a stack item's CARD leaves the stack. Normally it goes to its
   * controller's bin — R40: it comes FROM THE STACK, so this is never a trash.
   *
   * If a virus rode it, the item is MODDED, and Unstable is a BIN replacement
   * rather than a death replacement (R69, Caleb 2025-03-13): the card and every
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
   * R79; it was played from a bin, R96) and survives negation, while "Erase
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
    const viruses = item.augments ?? [];
    // THREE ways in, all meaning "this card is modded, was stamped, or prints
    // it": a virus rode it (derived, R79); it was played from a bin under a
    // permission that stamped it (R96, Abyssal Evocation) or a {Modular} mod
    // was applied to it as it was played (R105, stamped in payModularMod); or
    // R145 — its printed type line says {Unstable} and the STACK is an active
    // zone. All three live in `E.itemIsUnstable`, which `negate()` reads too:
    // the printed one went missing here and there simultaneously because the
    // expression was written out twice instead of shared.
    // THIS is the site an ordinary bin-played spell hits — the one choke point
    // for both resolution and negation. The virus loop below is correctly a
    // no-op at zero, so it stays untouched, and `disposeItemMods` at the foot
    // of the method is R105's matching half.
    if (this.itemIsUnstable(item)) {
      // R65: each card reaches ITS OWN owner's erased pile — a virus on an
      // enemy spell is the enemy's card, and the two piles are public.
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
      // never reaches the bin. R65: it goes to its controller's public erased
      // pile, which ev() keeps off exactly this event type. R40 does not enter
      // into it — nothing was binned, so nothing can be trashed out of a bin.
      this.ev('erased',
        `${item.label} erases itself — it does not go to a bin.`,
        { seat: item.controller, card: item.card });
    } else if (hasCard && item.card) {
      this.toBin(item.controller, item.card, 'stack');
    }
    this.disposeItemMods(item);   // R105 {Modular}: its mods are erased with it
  }

  afterParts(item: StackItem): void {
    if (item.kind === 'spellUnit') {
      // R143: the body normally enters under whoever cast it. `spawnUnder` is
      // the one exception the pool has — Hush Mush's "its controller gains
      // control of me" — and it is a DIFFERENT CONTROLLER AT ENTRY, not a
      // handover afterwards, so no ally-spawn watcher of the caster's ever
      // sees the body as theirs (report #96). OWNERSHIP does not move: R107's
      // owner≠controller split, and the card is still the caster's, so it is
      // still the caster's bin it dies to. `owner` is passed unconditionally
      // because it is exactly `seat` in every other case.
      const u = this.spawnUnit(item.spawnUnder ?? item.controller, item.card!, item.region, {
        owner: item.controller,
        ...(item.from ? { from: item.from } : {}),
        // R147: …and WEARING what its own text made it, if its own text made
        // it anything (Borrower of Forms). Same shape, same place, same
        // reason: one spell resolution is one body arriving, not a body
        // arriving and then changing.
        ...(item.spawnWearing ? { wearing: item.spawnWearing } : {}),
      });
      // R79: a spell UNIT's card does not leave — it arrives. Its viruses ride
      // it in, as the augment mods they always were, which is also what makes
      // the body Unstable. Erasing the card here instead would delete a unit
      // on its way into play, which no ruling asks for.
      for (const a of item.augments ?? []) this.attachMod(u, a.card, a.by, 'augment');
      // R96: a spell UNIT played from a bin spawns a body, and the stamp goes
      // with it — the card said "THEY gain unstable until regroup", and the
      // body is what the card became. This is the "edge, noted for review" in
      // Spell Excavation's own comment, closed.
      if (item.unstable) u.unstable = true;
      this.disposeItemMods(item);   // R105 {Modular}: its mods are erased with it here too
      return;
    }
    // R40: a resolved spell goes to the bin FROM THE STACK — explicitly not a
    // trash. R79: unless a virus rode it, in which case it is Unstable and the
    // whole pile is erased instead. spellToken: already out of play;
    // triggered/activated: nothing to move.
    this.dischargeItem(item, item.kind === 'spell');
  }

  // ── suspensions & decisions ─────────────────────────────────────────
  suspend(susp: Suspension, dec: Omit<Decision, 'id'>): never {
    this.s.suspension = susp;
    /**
     * R78's phase gate, applied to EVERY suspension rather than only to the
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
     * R144(b) reopened exactly that hole from a new direction: the Wraith now
     * suspends in `collectSubjects` — a 'cast' suspension raised on the way TO
     * the stack — which never went anywhere near that catch. Two sites cannot
     * both be remembered, so the gate moves to the one door every suspension
     * goes through. Nothing is lost by clearing it here: outside battle the
     * marker was never legal to publish in the first place, and the throw has
     * abandoned the outer resolution either way.
     */
    if (this.s.phase !== 'battle') this.s.resolving = null;
    // R85: `nextId` is rewound by a resolution replay, so on its own it can
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
   * R85 — the answer to a mid-resolution question has arrived: put the world
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
   * The pre-R85 engine rolled back at the suspension and THEN spent one id on
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
    // pre-R85 suspension (an old saved game, mid-resolution): it rolled back
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
    // R78, exactly as at the suspension: ONE object for the resolving item.
    this.s.resolving = this.s.phase === 'battle' ? sus.item : null;
    return sus.shown ?? 0;
  }

  // ── mods ────────────────────────────────────────────────────────────
  /** opts.token (R71): the mod IS a token — a Wraith augmented onto a unit is
   * the token card, applied rather than spawned. A token mod is erased
   * when it leaves play instead of being binned (a mod has no card to bin,
   * R40), which recall()/cacheUnit() honour. */
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

  /** Compose the parts of a firing ability: base effect + graft-mod effects,
   * top-to-bottom (Manual p.33). Bounded pieces consume per-card budgets (R9). */
  composeParts(source: Entity, abilityIndex: number, abilityKeyPrefix: 'ability' | 'augment', viaCard?: CardName): EffectPart[] | null {
    // R118 layer 0: with no `viaCard` the ability is the source's OWN, which
    // means the card it currently IS — the face, not the physical card.
    const cardName = viaCard ?? this.faceName(source);
    const def = this.card(cardName);
    const list = abilityKeyPrefix === 'ability' ? def.abilities : def.augmentText;
    const ability = list?.[abilityIndex];
    if (!ability) return null;
    const budgetKey = `${abilityKeyPrefix}:${cardName}#${abilityIndex}`;
    const budgetHolder = source;   // per card = per entity instance (R9)
    if (ability.bounded) {
      // R124 / CARD-TODO #21: a ZONE-dispatched firing (R51) arrives on a
      // throwaway stand-in (id -1) whose `budgets` dies with the call, so its
      // [once] reservation moves to real, serialized state instead —
      // GameState.zoneBudgets, per (seat, card name). "Per card" (R9) for a
      // card that is not in play can only mean the NAME in that seat's zone:
      // a bin holds bare names, not instances, so three copies leaving one
      // bin share one budget, the same way R51 gives three copies one firing.
      // Cleared by startTurn beside the Entity.budgets wipe; refunded by
      // refundPart's stand-in branch (R113 keeps working from a zone).
      // ZONE-dispatched only: R40's trash-trigger stand-in also has id -1,
      // but there the throwaway per-instance budget is DELIBERATE ("each
      // trashed card is its own instance" — see fireOwnTrashTrigger); only a
      // zone listener is a standing per-name permission (R51), so only it
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
      // R110: "(Trigger two copies of this graft ability as one single
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
   * NOW, at event time (R1); effects run later, at resolution. Never processes
   * the queue — that happens at safe points via settle(). */
  fireEvent(type: EventType, ev: EngineEvent, dyingUnit?: Entity): void {
    const region = (ev.data?.region as number | undefined) ?? (ev.data?.unit !== undefined ? this.entity(ev.data.unit as EntityId)?.region : undefined);
    const sourceId = (ev.data?.unit as EntityId | undefined);
    // region-scoped listeners (R12 / Manual: other regions don't exist)
    const listeners = Object.values(this.s.entities).filter(e =>
      e.kind === 'unit' && !e.absent && (region === undefined || e.region === region));
    if (dyingUnit) listeners.unshift(dyingUnit);   // a unit sees its own death
    // initiative player's units scan first (stable collection order)
    listeners.sort((a, z) => (a.controller === this.initiative ? 0 : 1) - (z.controller === this.initiative ? 0 : 1));
    let queued = false;
    for (const u of listeners) {
      // R62: a silenced unit has no triggered abilities to find — its own, its
      // [Augment] text, its mods' donated text and anything granted to it are
      // all "abilities", and the layer is off.
      if (this.abilitiesSuppressed(u)) continue;
      const src = sourceId ?? dyingUnit?.id;
      // R118 layer 0: the triggered text comes off the FACE. A Unit Token that
      // became a Noxious Deathcap really has "when I die, …" — and "I" is the
      // token, because the face is what the entity IS, not a second card.
      for (const face of this.facesWith(u, 'triggered')) {
        queued = this.collectTriggersFrom(u, face, 'ability', type, ev, src) || queued;
        // a card's own [Augment] text is active when played normally (Manual Q&A)
        queued = this.collectTriggersFrom(u, face, 'augment', type, ev, src) || queued;
      }
      for (const modId of u.mods) {
        const mod = this.entity(modId);
        if (mod && mod.appliedAs === 'augment') {
          // R131: the mod's OWN id rides along, so its donated text can say
          // "my other Augments" and mean every augment on this host except
          // this one entity — a second copy of the same card included.
          queued = this.collectTriggersFrom(u, mod.card, 'augment', type, ev, src, mod.id) || queued;
        }
      }
      // R63: text granted until regroup listens exactly like printed text
      for (const g of u.granted ?? []) {
        queued = this.collectTriggersFrom(u, g.card, g.via, type, ev, src) || queued;
      }
    }
    queued = this.fireZoneTriggers(type, ev) || queued;
    if (queued) this.s.triggerOrderedSeats = [];   // new batch: (re)ask ordering
  }

  /**
   * R51: dispatch to cards sitting in a BIN or a CACHE — "If I am in your bin,
   * after combat …" (Lurking Dread, Inexorable Miasma, Cinder Scuttler). The
   * in-play scan above cannot find them: they are not entities at all, just
   * names in a zone.
   *
   * Each listener is anchored on a DETACHED stand-in entity (id -1), exactly
   * like R40's fireOwnTrashTrigger: not in s.entities, untargetable, radiating
   * nothing, thrown away with the call. `owner`/`controller` are the seat whose
   * zone holds the card, so "if I am in YOUR bin" is that seat throughout, and
   * `region` is that seat's action region so the resolution lands somewhere.
   *
   * ONE firing per zone per event even when the zone holds several copies: the
   * printed texts are standing permissions ("if I am in your bin"), not
   * per-copy triggers. Bounded budgets (R9) cannot persist on a stand-in, so
   * composeParts keeps a zone firing's [Switch1] reservation in
   * GameState.zoneBudgets instead — per turn per (seat, card name), refunded
   * by refundPart's stand-in branch (R124 / CARD-TODO #21).
   *
   * Cost: one Map.get() per event when nothing in the pool listens from a zone.
   */
  /**
   * A DETACHED stand-in entity for a trigger whose card is not in play (R40
   * trash-self triggers, R51 zone triggers). Never put into s.entities — it
   * cannot be targeted, radiates no statics and turns up in no other scan. It
   * exists only to give `when` and the bounded-budget bookkeeping (R9)
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
   * NOW, at event time (R1); compose the parts (null = bounded and already
   * used this turn, R9); push the pending trigger; log it. The caller supplies
   * the log line and payload — those differ per site. `host.region` rides the
   * queued trigger because the host may be GONE by the time it resolves (R70:
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
      // R131: which MOD donated this text, when a mod did. See PendingTrigger.
      ...(selfModId !== undefined ? { selfModId } : {}),
      event: ev,
    });
    this.ev('triggered', logMsg, logData);
    return true;
  }

  private fireZoneTriggers(type: EventType, ev: EngineEvent): boolean {
    const listeners = zoneTriggersFor(type);
    if (!listeners.length) return false;
    let queued = false;
    for (const seat of [this.initiative, this.nit]) {
      for (const { card: name, abilityIndex, zone } of listeners) {
        // R124: 'leftBin' is the one event whose subject has ALREADY left the
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
    list.forEach((ability, idx) => {
      if (!isTriggered(ability)) return;
      if (!ability.events.includes(type)) return;
      if (ability.self && eventSource !== host.id) return;
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

  /** Drain the trigger queue. In battle AND in deployment (R144), triggers
   * become stack items (owner orders their own; NIT's enter last so they
   * resolve first — R2). Everywhere else they resolve immediately in the order
   * the stack would produce.
   * A seat whose queued triggers are ALL identical (sameTrigger) skips the
   * ordering decision — the order cannot matter or even be expressed. */
  processTriggerQueue(): void {
    while (this.s.triggerQueue.length) {
      // 1. per-seat ordering decisions (the chosen order = resolution order)
      for (const seat of [this.initiative, this.nit]) {
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
      //    outcomes, R2)
      // between combat sub-steps triggers resolve IMMEDIATELY — special
      // actions, no priority (R3); otherwise battle triggers use the stack
      const battleMode = this.s.phase === 'battle' && !this.s.battle?.damageStep;
      /**
       * R144(a), OWNER RULING (report #101, room SMVJ, 2026-08-24):
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
       * resolution order, which is what keeps R2, the seeded replay and every
       * existing deployment test saying what they said before.
       *
       * NOT taxed: `gateTaxedTrigger` below stays keyed on `battleMode`. R121
       * is Crevice Lurker's "during battle" clause and deployment is not
       * battle; routing deployment through the stack must not invent a tax the
       * card does not print.
       *
       * Nobody may RESPOND to a deployment stack: deployment is a hidden
       * simultaneous segment with no priority windows at all. `settle()` drains
       * the deployment stack itself, at the first safe point, top down.
       */
      const stackMode = battleMode || this.s.phase === 'deploy';
      const itQ = this.s.triggerQueue.filter(t => t.controller === this.initiative);
      const nitQ = this.s.triggerQueue.filter(t => t.controller === this.nit);
      const next = stackMode
        ? (itQ.length ? itQ[itQ.length - 1]! : nitQ[nitQ.length - 1]!)
        : (nitQ.length ? nitQ[0]! : itQ[0]!);
      this.s.triggerQueue.splice(this.s.triggerQueue.indexOf(next), 1);
      // R121: the pay-to-trigger gate — ONE choke point for every trigger
      // headed to the stack (card triggers, augment-donated triggers and R51
      // zone triggers alike; never per-card). Only battleMode triggers pass
      // through it: R3's combat-sub-step triggers resolve immediately as
      // special actions and never reach the stack, and outside battle the
      // taxing card's own "during battle" clause zeroes the tax anyway.
      // Bookkeeping listeners whose when() returned false never queued and
      // are untaxed by construction. The gate may suspend (asking the
      // controller to pay) or swallow the trigger (no mana — prevented,
      // announced); `continue` covers the swallowed case.
      if (battleMode && this.gateTaxedTrigger(next)) continue;
      this.stackPendingTrigger(next, stackMode ? 'push' : 'resolve');
    }
  }

  /** The build-and-commit tail of processTriggerQueue, split out so the R121
   * pay gate can resume a dequeued trigger from doDecide with the queue loop
   * long unwound. */
  stackPendingTrigger(next: PendingTrigger, then: 'push' | 'resolve'): void {
    const item: StackItem = {
      id: this.s.nextId++, kind: 'triggered', card: next.sourceCard, label: next.label,
      controller: next.controller,
      // R70: the live source's CURRENT region if it is still in play (it may
      // have moved between firing and resolving), else the region it fired
      // in, and only then the controller's action region. That last fallback
      // used to be the only answer for a dead source, which put every "when
      // I die" trigger in the wrong region (R12).
      region: this.entity(next.sourceId)?.region ?? next.region ?? this.actionRegion(next.controller),
      negated: false, parts: next.parts, sourceId: next.sourceId, event: next.event,
      // R131: which mod donated the text, carried to the EffectCtx
      ...(next.selfModId !== undefined ? { selfModId: next.selfModId } : {}),
    };
    this.collectTargets(item, then, []);
    this.commitItem(item, then);
  }

  /**
   * R121: Crevice Lurker's pay-to-trigger gate ("choosing to not pay this
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
      // R108/R113: "no offer could be made at all" — the bounded reservation
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

  /** R121: the answer to a pay-to-trigger question. Pay: charge the tax and
   * stack the trigger exactly where processTriggerQueue left off. Decline:
   * the trigger simply does not happen — and does NOT spend its [once]
   * (R108/R113: declining never spends it; the reservation goes back).
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

  /** R121 + R108/R113: hand back the bounded reservations composeParts wrote
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
      // R44: latch any prophecy the last mutation just fulfilled. settle() is
      // the general safe point, so it covers the state-based conditions (life
      // totals, units in play); the counting ones latch at their own moments
      // (startTurn / endBattleRound / end of the haste step).
      this.refreshProphecies();
      /**
       * R154: A PENDING QUESTION STOPS THE WORLD — for everyone.
       *
       * Two lines below already say this for their own piece of business:
       * the deployment stack drain is guarded `&& !this.s.decision`, and the
       * combat-damage pump opens `if (this.s.decision || …) return`. The
       * trigger queue never needed it, because before R154 nothing could run
       * at all while a decision was open — apply()'s gate refused every
       * action from BOTH seats, so settle() was only ever entered with the
       * slot empty.
       *
       * R154 lets the other seat act inside a hidden simultaneous segment,
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
      if (this.s.decision) return;
      if (!this.s.triggerQueue.length) {
        /**
         * R144(a): DRAIN THE DEPLOYMENT STACK.
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
        // resume a suspended combat-damage pump (R3 sub-step interleaving)
        if (this.s.battle?.damageStep && !this.pumping && !this.s.decision && !this.s.stack.length) {
          this.pumpCombatDamage();
        }
        this.finishDeployStart();   // R102: resume a suspended rot-damage opening
        this.finishHasteEnd();   // R50: resume a suspended end-of-haste window
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
      b.damageStep = 'Swift';
      this.pumpCombatDamage();
    } else if (b.step === 'afterWindow') {
      this.endBattleRound();
    }
  }

  // ── combat ──────────────────────────────────────────────────────────
  private pumping = false;

  /** Simultaneous damage in three sub-steps: Swift → normal → Sluggish.
   * Formation changes recalc between sub-steps but nobody gets priority (R3).
   * Triggers fired by a sub-step resolve immediately (special actions) before
   * the next one — a Swift unit's "when my column deals combat damage" riders
   * land before normal damage. A trigger decision suspends the pump; settle()
   * resumes it (same pattern as finishTurnEnd). */
  pumpCombatDamage(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const b = this.s.battle;
      if (!b) return;
      while (b.damageStep) {
        if (this.s.decision || this.s.stack.length) return;
        if (this.s.triggerQueue.length) { this.settle(); continue; }
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
        this.checkDeaths();   // deaths + promotion between sub-steps, no priority (R3)
        b.damageStep = sub === 'Swift' ? 'normal' : sub === 'normal' ? 'Sluggish' : 'after';
      }
    } finally { this.pumping = false; }
  }

  private scheduled(colIds: EntityId[], sub: 'Swift' | 'normal' | 'Sluggish',
    suppressed = false): boolean {
    // R61 {Pure}: an attribute-blind exchange has no Swift or Sluggish in it,
    // so it strikes in the normal sub-step whatever the column is printed with
    const attrs = suppressed ? new Set<string>() : this.colAttrs(colIds);
    if (sub === 'Swift') return attrs.has('Swift');
    if (sub === 'Sluggish') return attrs.has('Sluggish');
    return !attrs.has('Swift') && !attrs.has('Sluggish');
  }

  /**
   * R117 + R157 §5: EVERY combat-damage sub-step `u`'s column strikes in, in
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
   * R157 §5 (owner, 2026-08-25) is why this is a LIST and not one answer:
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
   * it, because R61 {Pure} collapses a whole exchange (both sides, in both
   * directions) into the normal sub-step whatever the columns are printed
   * with. Reconstructing `pure` here rather than reading the column's own
   * attributes is the entire reason this is an engine method and not three
   * lines of card code.
   *
   * ⚠ Ask it from `when()`, not from `run()` — see `strikesInCurrentSubStep`.
   */
  combatSubStepsOf(u: Entity): ('Swift' | 'normal' | 'Sluggish')[] {
    const b = this.s.battle;
    if (!b) return [];
    const alive = (ids: EntityId[]) => ids.filter(id => this.entity(id));
    let mine: EntityId[] | null = null;
    let pure = false;
    const ci = b.columns.findIndex(col => col.includes(u.id));
    if (ci !== -1) {
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
        mine = blk;
        pure = this.pure(atk, blk);
        break;
      }
    }
    if (!mine) return [];
    return (['Swift', 'normal', 'Sluggish'] as const)
      .filter(sub => this.scheduled(mine!, sub, pure));
  }

  /**
   * R117, singular: the FIRST sub-step `u`'s column strikes in, or null when it
   * is in no column. Kept as the readable one-answer form for the ordinary
   * column, which strikes in exactly one sub-step.
   *
   * ⚠ LOSSY, by R157 §5: a {Swift}{Sluggish} column strikes in TWO sub-steps
   * and this reports only the Swift one. Card text must never gate on it —
   * `strikesInCurrentSubStep` (which reads the full list) is the gate.
   */
  combatSubStepOf(u: Entity): 'Swift' | 'normal' | 'Sluggish' | null {
    return this.combatSubStepsOf(u)[0] ?? null;
  }

  /**
   * R117, as card text asks it: is the sub-step running RIGHT NOW one that
   * `u`'s column strikes in? The one shared gate behind every "when my column
   * deals combat damage" trigger — reached through `columnDealtCombatDamage`
   * by Zephyrzoa, Vroot, Eldritch Dreamtender and Blightmound, and directly by
   * Flowstone Arcanite and Bloodwind Revenant.
   *
   * R157 §5: "is one that", not "is the one" — a {Swift}{Sluggish} column
   * strikes in both the Swift and the Sluggish sub-step, so its triggers fire
   * in both, matching the damage that really lands in both.
   *
   * ⚠ TIMING — this is only true inside `when()`. `when()` is evaluated at
   * event time (R1), which is inside `combatSubStep(sub)`, and `b.damageStep`
   * is advanced only AFTER `combatSubStep` returns — so it reads the CURRENT
   * sub-step here and the NEXT one by the time the queued trigger settles.
   * Putting this gate in a `run()` would read the wrong sub-step every time.
   *
   * ⚠ WHAT THIS DOES NOT CLOSE: face damage still arrives as one aggregated
   * `lifeLost` per seat per sub-step, so two of the SAME controller's columns
   * connecting in the SAME sub-step remain indistinguishable to card text. The
   * sub-step gate narrows that a great deal but does not close it; closing it
   * means carrying live column ids on the combat ledger, which touches
   * Amphivore, Vroot, Zephyrzoa and Blightmound as well.
   */
  strikesInCurrentSubStep(u: Entity): boolean {
    const b = this.s.battle;
    if (!b || !b.damageStep || b.damageStep === 'after') return false;
    return this.combatSubStepsOf(u).includes(b.damageStep);
  }

  /**
   * R157 §4 — THE one shared "my column deals combat damage" predicate.
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
   *  · 'poison' — 'countersChanged' with a negative delta during a damage
   *    sub-step. The {Poisonous} channel, where a source's unit damage arrives
   *    as -1/-1 counters and NO 'damage' event is emitted at all. Blightmound
   *    is {Poisonous}, so without this it would never hear its own unit
   *    damage; nothing else in the four needs it.
   *  · 'face' — the aggregated combat 'lifeLost' against a seat that is not
   *    mine, with my column connecting (attacking and never blocked, or
   *    blocked/blocking with {Piercing}). All four hear this one.
   *
   * ⚠ `when()` only, because `strikesInCurrentSubStep` is `when()` only.
   */
  columnDealtCombatDamage(self: Entity, ev: EngineEvent,
    channels: readonly ('units' | 'poison' | 'face')[]): boolean {
    const b = this.s.battle;
    if (!b) return false;
    const col = this.columnOf(self.id);
    if (!col) return false;
    // R117 / R157 §5: only in a sub-step my own column strikes in.
    if (!this.strikesInCurrentSubStep(self)) return false;
    const alive = col.filter(id => this.entity(id));
    // R157 §4: the LIVE column's power, not mine. A column whose hitters all
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
    if (ev.type === 'countersChanged') {
      if (!channels.includes('poison')) return false;
      if (!b.damageStep || ((ev.data?.['n'] as number | undefined) ?? 0) >= 0) return false;
      return opposing(ev.data?.['unit'] as EntityId | undefined);
    }
    if (ev.type !== 'lifeLost' || !channels.includes('face')) return false;
    if (ev.data?.['why'] !== 'combat') return false;
    const victim = ev.data?.['seat'] as Seat | undefined;
    if (victim === undefined || victim === self.controller) return false;
    if (ci !== -1) {
      return victim === b.defender
        && (b.blocks[ci] === undefined || this.colAttrs(alive).has('Piercing'));
    }
    return victim === b.attacker && this.colAttrs(alive).has('Piercing');
  }

  /** One sub-step of simultaneous damage, in two halves over one ledger:
   * ASSIGNMENT (every scheduled column's pool is split over its victims into
   * the ledger; nothing is dealt yet) and COMMIT + AFTERMATH (the ledger is
   * dealt to units, then Deadly, Afflicting, Blessed, per-column replacement
   * to players, Lethal and Thieving read it in that order). The order of the
   * aftermath is the rules' order — each step's comment says why it sits
   * where it does — and the ledger lives for exactly this sub-step. */
  private combatSubStep(sub: 'Swift' | 'normal' | 'Sluggish'): void {
    const b = this.s.battle!;
    // R120: elective damage splits are asked for FIRST — before the ledger
    // exists, before any event is emitted — so a suspension here leaves
    // nothing half-done and the sub-step re-enters from scratch when the
    // answer lands (settle() resumes the pump).
    this.collectAssignPlans(b, sub);
    const L = this.newCombatLedger();
    this.assignCombatDamage(b, sub, L);
    // R120: the plans were consumed by the assignment above, and they are
    // meaningless outside their own sub-step (`ci` is only an identity for
    // its length — R72), so they do not outlive it.
    b.assignPlans = undefined;
    const shielded = this.commitUnitDamage(b, L);
    this.sweepDeadly(L, shielded);
    // R106 {Unaware}: an exchange collapsed to printed stats settles its own
    // deaths, because the state-based sweep reads effStats and would keep a
    // Robot 7 that just fought as a 0/0 alive. Beside sweepDeadly on purpose:
    // both are "this exchange killed something the ordinary check misses".
    this.sweepCollapsedDeaths(L.collapsed);
    this.afflictingAftermath(L);
    this.commitPlayerDamage(b, L);
    this.thievingDraws(L);
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
   * assignment walk and the R120 election planner read */
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

  /** Powerful column: its whole combat output is doubled at the source, before
   * lethal assignment and Piercing overflow (so a Powerful+Piercing column
   * pierces the doubled amount). */
  private dealtColPower(ids: EntityId[], attrs: Set<string>, collapsed: boolean): number {
    return this.colPower(ids, collapsed) * (attrs.has('Powerful') ? 2 : 1);
  }

  /** One column pairing's shared derivation: who is alive on each side, R61
   * {Pure}, the R106 {Unaware} collapse, and each side's post-Pure attribute
   * set. Extracted (R120) so `assignCombatDamage` and the election planner
   * `collectAssignPlans` read the SAME exchange and cannot drift — the
   * planner prices floors with exactly the pools and attributes the
   * assignment will use.
   *
   * R106 {Unaware}: `collapsed` is the whole exchange's flag, not one
   * column's — if either side carries {Unaware}, BOTH sides deal and receive
   * at their printed numbers ("it looks ONLY at what is the literal printed
   * text on all cards 'involved'"). It is threaded exactly like `pure`, and
   * for the same reason: it is a property of the pairing. Note it survives
   * {Pure}: Pure switches the ATTRIBUTE layer off for the exchange (R61), and
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
    // R61 {Pure}: one Pure card in either column blinds the whole exchange
    // to attributes — both sides', in both directions.
    const pure = this.pure(atk, blk);
    const attrsOf = (ids: EntityId[]) => pure ? new Set<string>() : this.colAttrs(ids);
    const collapsed = [...atk, ...blk].some(id => {
      const u = this.entity(id);
      return !!u && this.unaware(u);
    });
    return { atk, blk, blockedEver, pure, collapsed, atkAttrs: attrsOf(atk), blkAttrs: attrsOf(blk) };
  }

  /** R114: one victim's PASS-ALONG SHARE — the pool it must be assigned
   * before any may walk on to the unit behind it, and NOT a ceiling on what
   * it may be dealt. {Deadly}'s 1 is the same thing: a FLOOR on the share
   * ("1 pool point suffices to kill"), so the rest is free to pass along; it
   * never means a Deadly column only deals 1. A {Vulnerable} victim receives
   * double, so half the pool is its share (rounded up — R23).
   * R106: in an exchange collapsed by {Unaware} the victim is priced at the
   * defense PRINTED on its card, so a Robot 7 needs 0 and a counter-laden
   * 1/1 needs 1. The kill itself is `sweepCollapsedDeaths`, because a
   * 0-defense victim is assigned nothing at all here.
   * Shared by the assignment walk and the R120 election (floors AND option
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

  /** R120: the DEFAULT split, computed without a ledger — shares
   * front-to-back, leftover on the back-most living unit. The same numbers
   * `assignColumnDamage`'s no-plan walk produces (its `prev` is always 0 in
   * combat), used only to label the one-click default option. */
  private defaultSplitAmounts(living: Entity[], amount: number, deadly: boolean, pure: boolean, collapsed: boolean): number[] {
    const out = living.map(() => 0);
    let remaining = amount;
    living.forEach((u, i) => {
      if (remaining <= 0) return;
      const a = Math.min(remaining, this.victimShare(u, 0, deadly, pure, collapsed));
      out[i] = a; remaining -= a;
    });
    if (remaining > 0 && out.length) out[out.length - 1]! += remaining;
    return out;
  }

  /** R120 — the ELECTIVE split (playtest ledger #84, the deferred half): "each
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
   * NO election — today's silent path, on purpose:
   *  - {Piercing}: its overflow is automatic, never elective (the ruling's
   *    own exception; assignColumnDamage's docstring has said so all along).
   *    Every victim gets exactly its share and the rest hits the face —
   *    there is nothing left to elect.
   *  - fewer than two living victims, or no pool.
   *  - pool ≤ the front unit's share: every point is owed to the front, so
   *    every split is forced.
   *  - `def` recorded: the one-click default — undefined on purpose, so the
   *    no-plan walk (the exact pre-R120 code path) produces the numbers.
   *
   * The options offered are exactly the LEGAL amounts [share .. remaining]:
   * a front unit can never be given less than lethal while anything would go
   * behind it — an illegal split is not refused, it is never shown (the same
   * doctrine as R64 targeting). Choosing `remaining` is the reported elective
   * case: ALL of it to the front, none behind, even past lethal. */
  private electionWalk(b: BattleState, key: string, seat: Seat, ids: EntityId[], amount: number,
    srcAttrs: Set<string>, pure: boolean, collapsed: boolean, label: string, ask: boolean): number[] | undefined {
    if (srcAttrs.has('Piercing') || amount <= 0) return undefined;
    const living = ids.map(id => this.entity(id)).filter((u): u is Entity => !!u);
    if (living.length < 2) return undefined;
    const deadly = srcAttrs.has('Deadly');
    const needs = living.map(u => this.victimShare(u, 0, deadly, pure, collapsed));
    if (amount <= needs[0]!) return undefined;
    const plan = b.assignPlans?.[key];
    if (plan?.def) return undefined;
    const amounts = living.map(() => 0);
    let remaining = amount, pi = 0;
    for (let i = 0; i < living.length && remaining > 0; i++) {
      const last = i === living.length - 1;
      if (last || remaining <= needs[i]!) { amounts[i] = remaining; remaining = 0; break; }
      if (pi < (plan?.picks.length ?? 0)) { amounts[i] = plan!.picks[pi++]!; remaining -= amounts[i]!; continue; }
      // a real question is open for victim i
      if (!ask) return undefined;   // unreachable in practice: collection completes before assignment runs
      const u = living[i]!;
      const options: DecisionOption[] = [];
      if (i === 0) {
        const def = this.defaultSplitAmounts(living, amount, deadly, pure, collapsed);
        options.push({
          label: `default — share front-to-back (${def.map((a, j) => `${a} to ${living[j]!.card}`).join(', ')})`,
          value: 'default',
        });
      }
      for (let a = needs[i]!; a <= remaining; a++) {
        const tag = a === needs[i]! && a > 0 ? (deadly ? ' (the {Deadly} floor)' : ' (lethal)')
          : a === remaining ? ' (everything)' : '';
        options.push({ label: `${a} to ${u.card}${tag}`, value: a });
      }
      this.suspend({ type: 'combatAssign', seat, key }, {
        seat, kind: 'assignDamage',
        prompt: `${label}: assign combat damage — how much of ${remaining} to ${u.card}? `
          + '(units in front must be assigned lethal before any goes behind them)',
        options,
      });
    }
    return amounts;
  }

  /** R120 — collection pass: raise every elective-split question for this
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
  private collectAssignPlans(b: BattleState, sub: 'Swift' | 'normal' | 'Sluggish'): void {
    b.columns.forEach((_col, ci) => {
      const x = this.exchangeAt(b, ci);
      if (x.atk.length && x.blk.length && this.scheduled(x.atk, sub, x.pure)) {
        this.electionWalk(b, `${sub}:atk:${ci}`, b.attacker, x.blk,
          this.dealtColPower(x.atk, x.atkAttrs, x.collapsed), x.atkAttrs, x.pure, x.collapsed,
          this.colLabel(x.atk), true);
      }
      if (x.blk.length && x.atk.length && this.scheduled(x.blk, sub, x.pure)) {
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
  private assignCombatDamage(b: BattleState, sub: 'Swift' | 'normal' | 'Sluggish', L: CombatLedger): void {
    b.columns.forEach((_atkCol, ci) => {
      // the shared derivation (alive sides, {Pure}, the {Unaware} collapse,
      // attrs, column power) lives in exchangeAt / dealtColPower so the R120
      // election planner prices EXACTLY what is assigned here
      const { atk, blk, blockedEver, pure, collapsed, atkAttrs, blkAttrs } = this.exchangeAt(b, ci);
      if (collapsed) for (const id of [...atk, ...blk]) L.collapsed.add(id);
      // attacker side
      if (atk.length && this.scheduled(atk, sub, pure)) {
        const pow = this.dealtColPower(atk, atkAttrs, collapsed);
        // R72: `ci` is only an identity for the length of THIS sub-step. The
        // key is a local bucket label for the afflicting diff below and is
        // never stored, because the formation may collapse (and every index
        // move) before the next sub-step runs.
        const src = { dealer: b.attacker, key: `atk:${ci}`, label: this.colLabel(atk) };
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
          L.playerHits.push({ seat: b.defender, amount: toPlayer, by: b.attacker, attrs: atkAttrs, label: src.label, pure });
          if (atkAttrs.has('Thieving')) L.thievingDraw[b.attacker] = (L.thievingDraw[b.attacker] ?? 0) + 1;
        }
      }
      // blocker side
      if (blk.length && this.scheduled(blk, sub, pure)) {
        // R72 (Bena 2026-08-21): a blocking column whose attackers are all
        // dead "has nothing to deal damage to, so it doesn't deal damage" —
        // and that INCLUDES Piercing. Piercing is the excess left over after
        // an assignment (R7); with nothing to assign to there is no exchange
        // to be the excess of, and the whole power would otherwise wash
        // through to the attacking player.
        //
        // The Manual answers the other half of that ruling by itself — the
        // blocker STAYS because after blocks are declared no column moves —
        // so this is all that is left of it. Note the deliberate asymmetry
        // with R13, which is the Manual's own: "the column is considered
        // blocked even if the defending unit is removed during combat", so a
        // Piercing ATTACKER still gets through a dead block. There the attack
        // is still real; here it is the attack that is gone.
        if (!atk.length) {
          const pow = this.dealtColPower(blk, blkAttrs, collapsed);
          if (pow > 0) {
            this.ev('info',
              `Column ${ci + 1} has no attackers left — its blockers have nothing to fight.`,
              { region: b.region });
          }
        } else {
          const src = { dealer: b.defender, key: `blk:${ci}`, label: this.colLabel(blk) };
          const blkPow = this.dealtColPower(blk, blkAttrs, collapsed);
          const left = this.assignColumnDamage(L, atk, blkPow, blkAttrs, src, pure, collapsed,
            this.electionWalk(b, `${sub}:blk:${ci}`, b.defender, atk, blkPow, blkAttrs, pure, collapsed, src.label, false));
          if (blkAttrs.has('Piercing') && left > 0) {
            L.playerHits.push({ seat: b.attacker, amount: left, by: b.defender, attrs: blkAttrs, label: src.label, pure });
            if (blkAttrs.has('Thieving')) L.thievingDraw[b.defender] = (L.thievingDraw[b.defender] ?? 0) + 1;
          }
        }
      }
    });
  }

  /** front-to-back assignment (R7: the controller's split is elective —
   * `plan` is R120's elected split when the controller recorded one, and the
   * walk below is the DEFAULT; piercing overflow is automatic, never
   * elective). In the default walk each victim in turn takes its PASS-ALONG
   * SHARE — the pool that would kill it — and whatever is left over walks on;
   * R114 lands the final leftover on the back-most living unit instead of
   * dropping it. Returns that leftover only for {Piercing} (see the R114 note
   * below). A Vulnerable victim receives double, so half the pool is its share
   * and the pre-double remainder passes along sooner (R23); Deadly's lethal
   * SHARE is 1 (R21) — a floor on what passes along, never a cap on what is
   * dealt. */
  private assignColumnDamage(L: CombatLedger, ids: EntityId[], amount: number, srcAttrs: Set<string>,
    src: { dealer: Seat; key: string; label: string }, pure = false, collapsed = false,
    plan?: number[]): number {
    const deadly = srcAttrs.has('Deadly');
    const poisonous = srcAttrs.has('Poisonous');
    const resonant = srcAttrs.has('Resonant');
    const blessedTo = srcAttrs.has('Blessed') ? src.dealer : undefined;
    /** write one hit into the ledger. Called twice: once for a victim's
     * pass-along share inside the front-to-back walk, and once more for
     * R114's leftover onto the back-most unit. The overflow hit is a REAL
     * hit — it carries every flag a share does (Poisonous, Resonant, the
     * source attrs and label, Pure, Blessed, the Deadly mark and the
     * Afflicting bucket), because it is the same column dealing the same
     * damage in the same sub-step. */
    const give = (id: EntityId, a: number): void => {
      const cur = L.perUnit.get(id) ?? { pool: 0, poisonous, resonant };
      cur.pool += a; cur.poisonous = poisonous; cur.resonant = resonant;
      cur.attrs = srcAttrs; cur.label = src.label;   // R98
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
      // R120: the controller's ELECTED split, collected by collectAssignPlans
      // before this sub-step touched anything. The floors — every unit in
      // front assigned its pass-along share before anything goes behind it —
      // were enforced when the options were offered (electionWalk never shows
      // an illegal amount), so nothing is re-checked here. Everything
      // downstream of "unit U is assigned K" goes through the same give():
      // Deadly marks, Afflicting buckets, Blessed, Poisonous/Resonant, R98
      // prevention and Vulnerable's receive-side doubling are identical
      // between the elected and the default path. A plan always assigns the
      // whole pool — the ruling deals ALL damage to units — and is never
      // built for a {Piercing} strike, so there is no leftover to return.
      const living = ids.filter(id => this.entity(id));
      plan.forEach((a, i) => { if (a > 0 && living[i] !== undefined) give(living[i]!, a); });
      return 0;
    }
    for (const id of ids) {
      const u = this.entity(id);
      if (!u || remaining <= 0) continue;
      const prev = L.perUnit.get(id)?.pool ?? 0;
      // the R114 pass-along share / {Deadly} floor / R106 printed-defense
      // pricing all live in victimShare — shared with the R120 election so
      // the floors it offers are the shares this walk pays
      const poolNeed = this.victimShare(u, prev, deadly, pure, collapsed);
      const a = Math.min(remaining, poolNeed);
      if (a > 0) give(id, a);
      remaining -= a;
    }
    // R114 (Bena 2026-08-23, report #84): "ALL damage is dealt to units, even
    // if it surpasses its defense. The only exception is Piercing, which deals
    // excess to the controller." The follow-up ruling the same day makes the
    // split ELECTIVE — "each player is allowed to split the damage however
    // they want... The only rule is that the front unit must be assigned
    // lethal damage before assigning any to the back unit" — so the leftover
    // may legally land anywhere once every share above it is paid. This is the
    // DEFAULT auto-assignment, and it picks the legal split the rulebook
    // describes ("excess damage beyond the health of the back row unit"): the
    // leftover lands on the back-most living unit rather than evaporating.
    // The player-elective mode is R120 (`collectAssignPlans` / `electionWalk`):
    // an elected split arrives as `plan` and short-circuits this walk; with no
    // real choice, or the one-click default, THIS remains the split.
    //
    // DELIBERATELY UNCHANGED, so the next reader does not "fix" them:
    //  - {Piercing} still returns `remaining` and the caller sends it to the
    //    face. That is the ruling's own stated exception, not an oversight.
    //  - The "blocked, but every blocker died" branch above still drops
    //    non-Piercing power: there is no unit left to deal it to (R72/R13, a
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
   * was fully prevented (R98), which the Deadly sweep must skip. */
  private commitUnitDamage(b: BattleState, L: CombatLedger): Set<EntityId> {
    /** R98: units whose damage this sub-step was fully prevented. {Deadly}
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
      // R98: the choke point, after Vulnerable's doubling (the shield stops
      // "all damage that WOULD BE DEALT") and after every assignment decision.
      const received = this.preventUnitDamage(u, hit.pool * mult, {
        region: b.region, source: hit.label ?? 'combat', combat: true,
        attrs: hit.attrs ?? new Set<string>(), pure: !!hit.pure,
      });
      if (received <= 0) { shielded.add(id); continue; }
      // R48 {Blessed}: the gain is on the same game-state check as the damage
      if (hit.blessedTo !== undefined) this.blessedGain(hit.blessedTo, received, hit.blessedFrom ?? 'combat');
      if (hit.poisonous) {
        this.ev('info', `Poisonous: ${received} combat damage to ${u.card} becomes ${received} -1/-1 counter(s).`);
        this.addCounters(u, -received);   // permanent; addCounters runs checkDeaths
      } else {
        u.damage += received;
        const ev = this.ev('damage', `${u.card} takes ${received} (${u.damage} total).`, { unit: id, n: received });
        this.fireEvent('damage', ev);   // "when I am dealt damage"
      }
      if (hit.resonant) this.loseLife(u.controller, received, 'Resonant');
    }
    // R98: "a +1/+1 counter for each damage prevented", after the whole
    // sub-step is marked (addCounters runs checkDeaths — see the method)
    this.settleDamagePrevention();
    return shielded;
  }

  /** R21 {Deadly}: any damage from a Deadly column kills — unless none was
   * actually dealt (R98 `shielded`). */
  private sweepDeadly(L: CombatLedger, shielded: Set<EntityId>): void {
    for (const id of L.deadlyHit) {
      if (shielded.has(id)) continue;   // R98: no damage dealt, nothing to kill through
      const u = this.entity(id);
      if (u) {
        this.ev('info', `Deadly — ${u.card} dies.`);
        this.destroy(u, 'dies');
      }
    }
  }

  /** R48 {Afflicting}: whatever an afflicting column damaged and killed gives
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
    // R48 {Blessed}: combat damage to a PLAYER gains too, and — the whole
    // point of "same game state check" — it is committed before the lethal
    // check below, so a blessed column can never kill its own controller.
    for (const hit of L.playerHits) {
      if (hit.attrs.has('Blessed')) this.blessedGain(hit.by, hit.amount, hit.label);
    }
    // R38 (Blightsea Polyp): a per-COLUMN replacement of combat damage to
    // players — "as 1 rot", whatever the column's power. Offered per hit, and
    // a replaced hit still counts as DEALT (Caleb 2024-10-24), which is why
    // Thieving above and Lethal below read playerHits, not playerDmg.
    for (const hit of L.playerHits) {
      const left = this.replaceCombatDamage(hit.seat, hit.amount,
        { attacker: hit.by, region: b.region, attrs: hit.attrs, pure: !!hit.pure });
      if (left <= 0) continue;
      playerDmg[hit.seat] = (playerDmg[hit.seat] ?? 0) + left;
    }
    for (const seat of [this.initiative, this.nit]) {
      const n = playerDmg[seat] ?? 0;
      if (n > 0) this.loseLife(seat, n, 'combat');
    }
    // R48 {Lethal}: "Any combat damage from a lethal unit will kill a player."
    // Last, because a normal-damage kill above already ended the game (and a
    // {Blessed} gain has already been applied).
    for (const hit of L.playerHits) {
      if (hit.attrs.has('Lethal')) this.killPlayer(hit.seat, `${hit.label} is Lethal`);
    }
  }

  /** Thieving: a column that dealt combat damage to a player draws one card (R24) */
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
    this.s.planningDone = this.s.players.map(() => false);
    this.s.hasteDone = null;
    this.ev('turn', `— Turn ${this.s.turn} (initiative: ${this.pname(this.initiative)}) —`, { turn: this.s.turn });
    for (const p of this.s.players) {
      for (const r of p.resources) if (r.state === 'expended') r.state = 'open';
      p.activationsLeft = ACTIVATIONS_PER_TURN;
      // draft mode: turn 1's draws were dealt with the opening hand (Manual
      // p.16), and later draws go clockwise from initiative like the packs.
      // constructed: the combined draw phase (draw 4, bottom 2) is below.
      if (this.s.mode === 'shared') this.draw(p.seat, 2);
    }
    if (this.s.mode === 'draft' && this.s.turn > 1) {
      for (const seat of this.dealOrder()) this.draw(seat, 2);
    }
    for (const e of Object.values(this.s.entities)) e.budgets = {};
    // R124: the zone-trigger budgets (CARD-TODO #21) are per-turn like every
    // other [once] — wiped beside the Entity.budgets they stand in for.
    this.s.zoneBudgets = {};
    // R119: "the next card you play THIS TURN" — an unspent charge expires
    // with the turn that bought it, beside the per-turn budgets wipe it used
    // to ride in (and like R43's hasteManaSpent, zeroed rather than deleted).
    this.s.nextPlayDiscount = this.s.players.map(() => 0);
    this.refreshProphecies();   // R43: "N Turns Pass" ticks here
    if (this.s.mode === 'draft') this.startDraftStep();
    if (this.s.mode === 'constructed') this.startConstructedDraw();
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

  dealPacks(): void {
    this.s.packMeta ??= this.s.players.map(() => null);
    for (const seat of this.dealOrder()) {
      this.s.packs[seat] = this.s.sharedDeck.splice(0, 10);
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
   * folds the turn draw into its draw phase (draw 4, put 2 back). A card that
   * REPLACES that step therefore cannot be written as "skip and draw one
   * more" in one place — the card has to say what happens instead, per mode,
   * which is exactly what `CardBehavior.replaceCardStep` is for.
   *
   * Returns true when some card took the step over, in which case the caller
   * must NOT run the normal one. First true consumes (the R104 rule): two
   * Worldbenders replace the step once, not twice.
   *
   * Anchored like the other replacement hooks — units in play plus augment
   * mods reading from their host — but scoped by CONTROLLER instead of by
   * region: "your draft step" is a turn-structure thing that belongs to a
   * seat, and at the top of a turn there is no battle and so no region to
   * scope to (the reasoning `replaceLifeGain` spells out for life gained
   * outside a battle). R62 suppression is the full projection, as it is for
   * every other replacement.
   */
  private replaceCardStep(seat: Seat): boolean {
    const holders = this.anchored((h, a) =>
      this.donates(h, a, 'replaceCardStep')                   // R127: off the FACES
      && a.controller === seat
      && !this.abilitiesSuppressed(a));                       // R62 (full projection)
    holders.sort((a, z) => a.holder.id - z.holder.id);
    for (const { face, anchor } of this.donorFaces(holders, 'replaceCardStep')) {
      if (this.card(face).replaceCardStep!(this, anchor, seat)) return true;
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
      const recycled = this.shuffle(this.s.packs.flat());
      this.s.sharedDeck.push(...recycled);
      this.dealPacks();
      this.ev('draft', 'Packs are recycled; everyone is dealt a fresh pack of 10.');
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
    this.ev('draft', 'Draft step: combine your hand and pack, then leave exactly 10 cards in the pack.');
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

  /** Manual p.18: after the resource step comes the very short haste step —
   * only {Haste} cards playable, each resolving immediately (planning is not
   * interactive); ends when everyone is done. Skipped outright when no seat
   * has a legal haste play (R18). */
  startHasteStep(): void {
    const canHaste = (seat: Seat) => {
      // LATENT DIVERGENCE from apply.ts `castable()`, which is what
      // legalActions' haste branch actually gates on: this judges the
      // spec-wide `targets` (castable judges slot 0 via specForSlot), treats a
      // min-0 "up to N" spec as needing a candidate (castable lets it be cast
      // at nothing), and never asks whether the bracketed [cast cost] /
      // [Gain N debt] is payable. Each of those can make this say "yes" to a
      // hand castable() then refuses — an empty haste step with a doneHaste
      // to click — or (min-0) "no" to a playable card, which skips the step
      // outright. Unifying them means routing this through castable().
      const hasTarget = (name: CardName) => {
        const spec = this.card(name).spellEffect?.targets;
        return !spec || this.targetCandidates(spec, this.homeRegion(seat), undefined, seat).length > 0;
      };
      // R97: a GRANT ("play a unit during the mana step as if it had [Haste]",
      // Dispatch Courier) opens the step too. This gate is the one that must
      // not be missed: it skips the step OUTRIGHT, so a hand of nothing but
      // deploy units plus a Courier on the board would never even reach the
      // other two gates and the grant would stay invisible — which is exactly
      // playtest report #74. `mayPlayAtHaste` reads `hastePlaysUsed`, which
      // this function zeroes below, so the budget is fresh when it is asked.
      const playableHere = (name: CardName): boolean =>
        this.card(name).timing === 'haste'
        || this.mayPlayAtHaste({ seat, card: this.card(name), from: 'hand', region: this.homeRegion(seat) })
        // R123: a grantor sitting IN THE BIN (Writhing Host) opens the step
        // too — report #74's fatal gate a third time over, in bin form: a
        // hand of deploy units plus a Host in the bin has no other legal
        // haste play, so missing this line would skip the step outright and
        // the other two gates would never be reached.
        || this.binHasteGrantorIndex({ seat, card: this.card(name), from: 'hand', region: this.homeRegion(seat) }) >= 0;
      const fromHand = this.player(seat).hand.some(name =>
        playableHere(name) && this.canPayCard(seat, name) && hasTarget(name));
      if (fromHand) return true;
      // R95 (haste sibling): a MOD applied "as if it was deployment" (Slurpr)
      // opens the step too, and this is R97's fatal gate in mod form — a board
      // with a Slurpr and a hand of nothing but mods has no legal PLAY at all,
      // so without this line the step is skipped outright and neither
      // `legalHasteActions`' offer nor `doAugment`/`doGraft`'s haste branch is
      // ever reached. Report #74, one verb over.
      //
      // ⚠ Kept in step with apply.ts's `pushMods` by hand: same three zones,
      // same affordability rule (a fulfilled prophecy makes a cached mod
      // free), same host requirement. It cannot call `hasteModAllowed`
      // directly — that predicate gates on `hasteDone`, which this function
      // is deciding, and apply.ts is downstream of engine.ts besides. The
      // PERMISSION half is shared: both go through `mayApplyModAtHaste`.
      if (this.hasHasteModAvailable(seat)) return true;
      // R42/R45: a permitted CACHED card released at haste timing opens the
      // step too — Tithe Enforcer is a haste unit and Divine Intervention's
      // banner marks its release [Haste]. Without this the step would be
      // skipped and the release would be unreachable.
      return this.cache(seat).some((cc, i) => {
        const via = this.cachePermission(seat, i);
        if (!via) return false;
        if (this.cachedTiming(seat, i, via) !== 'haste') return false;
        if (via === 'glimpse' && !this.canPayManaOnly(seat, cc.card)) return false;
        return hasTarget(cc.card);
      });
    };
    // R43: a fresh window for "End [Haste] with used mana" (zeroed even when
    // the step is skipped outright, so nothing stale can be read later)
    this.s.hasteManaSpent = this.s.players.map(() => 0);
    // R97: and the same fresh window for the printed "Each turn" budget —
    // BEFORE canHaste runs, since canHaste asks whether any allowance is left.
    this.s.hastePlaysUsed = this.s.players.map(() => 0);
    const done = this.s.players.map(p => !canHaste(p.seat));
    if (done.every(Boolean)) { this.startBattlePhase(); return; }
    this.s.hasteDone = done;
    this.ev('phase', 'Haste step: haste cards may be played.');
  }

  /**
   * The haste step is over. Two things happen here, in this order, and the
   * order is load-bearing:
   *
   *  1. R50: the 'endOfHaste' EVENT fires, inside a settle() window, while
   *     `hasteDone` still describes the step that is closing — so "At the end
   *     of [Haste], …" (Keeper of Tithes, Debt Plant) can read the step's own
   *     state, and so R43's `hasteWithUsedMana` (which requires
   *     `hasteDone === null`) cannot latch early off a trigger's spending.
   *     It fires even when the step was SKIPPED outright (R18): the haste step
   *     is part of the turn whether or not anybody had a card for it, and an
   *     optimisation must not be observable.
   *  2. R43: `hasteDone` is nulled, the prophecy sweep latches "End [Haste]
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
    this.s.hastePlaysUsed = this.s.players.map(() => 0);   // R97, beside its R43 sibling
    this.s.phase = 'battle';
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
    // R43: a battle has completed. In 1v1 BOTH the initiative battle and the
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

  /** R11: exact regroup sequence per the Manual (p.7). */
  startRegroup(): void {
    this.s.phase = 'regroup';
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
    //     depends on — most sharply `suppressed`, the R62 stamp that switches
    //     a silenced Harbinger's abilities (a static IS an ability) off. Read
    //     after the sweep, a Harbinger silenced for the whole battle would
    //     come back to life just in time to save the tokens.
    //
    //     A protected token is spared the ERASE and nothing else: step (3)
    //     runs over every entity, so the survivor's own temporary changes are
    //     still cleaned up. Its `x` — the Fireball's number — is not something
    //     regroup touches at all, so it carries over intact.
    const spared: EntityId[] = [];
    for (const e of Object.values(this.s.entities)) {
      if (e.kind !== 'spellToken') continue;
      if (this.spellTokenSurvivesRegroup(e)) { spared.push(e.id); continue; }
      // R89: a token can now be MODDED (an augment applied in deployment), and
      // a modded card is Unstable — "when it dies or is erased, it and all of
      // its mods are erased with it" (Manual p.35). Without this the mod
      // entities would outlive their host as orphans pointing at a dead id.
      // The augment reaches the public erased pile (R65) exactly as it would
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
      e.tempPower = 0; e.tempToughness = 0; delete e.tempAttrs;
      delete e.baseSet;      // layer 2 is an until-regroup rewrite too
      delete e.baseSetSeq;
      delete e.suppressed;   // R62: so is a switched-off attribute/ability layer
      delete e.unstable;     // R96: "they gain unstable UNTIL REGROUP" — this is that
      delete e.damageShield; // R98: "UNTIL REGROUP, prevent all damage …" — and this
      delete e.shieldPending;
      delete e.granted;      // R63: and so is granted text
      delete e.allured;      // R84 {Alluring}: "can't attack" lasted the battle phase
      // R118 layer 0: an until-regroup FACE lapses here (Apex Prime's "until
      // regroup"). A 'permanent' one does NOT — Borrower of Forms prints "I
      // BECOME an exact copy", with no duration, and a live test pins it.
      if (e.copies) {
        const kept = e.copies.filter(c => c.until !== 'regroup');
        if (kept.length) e.copies = kept; else delete e.copies;
      }
    }
    // R118: reverting a face can be LETHAL, and nothing else here would
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
   * R50: two things happen at the start of deployment and the ORDER is a
   * ruling, because nothing in the printed rules sequences them:
   *
   *  1. R38's rot damage — an automatic turn-structure step, not a trigger,
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
   * ⚠ R102: step 1 is a different matter, and this is the deferral for it.
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
    this.s.deployDone = this.s.players.map(() => false);
    this.s.deployPlayer = this.initiative;
    // report #86: nobody has acted in THIS deployment yet (see types.ts)
    this.s.deployActed = this.s.players.map(() => false);
    this.ev('phase', 'Deployment: both players deploy at the same time — moves are revealed when everyone is done.');
    this.s.deployStarting = true;   // R102: step 2 is owed
    this.rotDamage();   // R38: start of deployment, before anyone may deploy
    this.finishDeployStart();
  }

  /** R102: fire 'startOfDeployment' once R38's rot damage — and anything the
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
