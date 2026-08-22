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
  Action, Attr, BattleState, BinRef, CachedCard, CachedProphecy, CardName, Decision, DecisionOption,
  EffectPart, EngineEvent, Entity, EntityId, EventType, FormationSpot, GameState, PendingTrigger,
  ResourceKind, Seat, StackItem, Suspension, TargetRef,
} from './types.ts';
import {
  affinityPips, costAmount, costXMin, effectByKey, getCard, graftCauseIndex,
  isGraftable, isTriggered, specForSlot, zoneTriggersFor,
  type Ability, type CardDef, type CastCost, type CostMod, type EffectCtx, type EffectDef,
  type ResolvedTarget, type TargetSpec, type TriggeredAbility,
} from './cards/dsl.ts';
import { rngShuffle } from './rng.ts';

/** R59: where and why a card's cost is being computed (see manaToPlay).
 * `region` defaults to the seat's action region; `purpose` defaults to
 * 'play' — pass 'mod' when the card is being applied as an augment or graft,
 * which is not playing (R37). */
export interface CostOpts { region?: number; purpose?: 'play' | 'mod' }

export class Suspended { }
export class GameEnded { }
export class IllegalAction extends Error { }
/** thrown by ctx.choose inside an effect part; converted to a 'resolve' suspension */
class PartChoice {
  key: string;
  dec: { kind: 'payOrDecline' | 'electricPath'; seat: Seat; prompt: string; options: DecisionOption[] };
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
   * R59: every active CostMod that applies to `ctx`. Radiates from units in
   * play and from augment mods anchored on their host, scoped to the region
   * the card is being played into (R12) — the same rules as staticsFor.
   * NOTE the returned `holder` is the ANCHOR (the entity the mod reads from),
   * while the mod list comes off the carrying entity's card.
   */
  private costModsFor(region: number): { holder: Entity; mod: CostMod }[] {
    if (this.inCostMods) return [];
    const out: { holder: Entity; mod: CostMod }[] = [];
    this.inCostMods = true;
    try {
      for (const { holder, anchor } of this.anchored((_h, a) =>
        a.region === region
        && !a.suppressed?.abilities)) {                         // R62, as staticsFor (shallow)
        for (const mod of this.card(holder.card).costMods ?? []) out.push({ holder: anchor, mod });
      }
    } finally { this.inCostMods = false; }
    return out;
  }

  /**
   * R59: what it actually costs `seat` to play (or apply) `name` right now —
   * printed mana plus every active cost modifier, never below zero. `purpose`
   * separates playing from applying a mod: applying a mod is not playing
   * (R37), so "spells cost [one] more to play" does not tax an augment.
   */
  manaToPlay(seat: Seat, name: CardName, opts: CostOpts = {}): number {
    const c = this.card(name);
    const base = c.mana === 'X' ? (c.xMin ?? 0) : c.mana;
    const region = opts.region ?? this.actionRegion(seat);
    const ctx = { seat, card: c, region, purpose: opts.purpose ?? 'play' as const };
    let total = base;
    for (const { holder, mod } of this.costModsFor(region)) total += mod.delta?.(this, holder, ctx) ?? 0;
    return Math.max(0, total);
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

  canPayCard(seat: Seat, name: CardName, opts: CostOpts = {}): boolean {
    const c = this.card(name);
    // X spells: X is chosen and paid at cast (R35); castability needs only the
    // smallest legal X to be affordable (xMin, e.g. "X can't be zero" → 1)
    if (this.openMana(seat) < this.manaToPlay(seat, name, opts)) return false;
    // R60: an unpayable LIFE tax makes the card uncastable exactly as
    // unpayable mana does — R49's rule, so 2 life is unpayable at 2 life.
    if (!this.canPayLife(seat, this.lifeToPlay(seat, name, opts))) return false;
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

  // ── stats & attributes (six-layer projection; layers 5-6 have no pool cards
  //    yet but the seams are here: see docs/03 §4) ──────────────────────
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
        for (const mod of this.card(holder.card).statics ?? []) {
          // `srcId` is the entity CARRYING the text (the unit, or the augment
          // mod that donated it), not the anchor — it is the tick of the
          // nextId clock at which this static started applying, which is what
          // layer 2 sorts by.
          if (mod.affects(this, anchor, target)) out.push({ holder: anchor, from: holder.card, srcId: holder.id, mod });
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
    const c = this.card(e.card);
    let [p, t] = e.tokenStats ?? [c.power, c.toughness];       // layer 1
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
    for (const a of this.layer4Attrs(e)) {
      if (a === 'Tough') t *= 2;
      else if (a === 'Balanced') { const m = Math.max(p, t); p = m; t = m; }
    }
    // layer 5 (Inverted), 6 (Unaware) go here
    return [p, t];
  }
  /** R19: layer-4 attrs in application order — own printed (type-line order),
   * then augment mods (stack order), then column-shared (column order);
   * first occurrence wins, an attribute is either present or not. */
  private layer4Attrs(e: Entity): ('Tough' | 'Balanced')[] {
    const out: ('Tough' | 'Balanced')[] = [];
    const take = (attrs: Iterable<string>) => {
      for (const a of attrs) {
        if ((a === 'Tough' || a === 'Balanced') && !out.includes(a)) out.push(a);
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
    for (const a of this.card(e.card).attrs) set.add(a);
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
   * Every card that enters a bin goes through here. R40: **a nontoken card
   * entering a bin from anywhere other than the stack is trashed**, and it is
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
   * R69: a TOKEN does reach here. Tokens are cards ("Tokens are temporary
   * cards" opens the Tokens section of both rulebooks), a dying one enters the
   * bin before it is erased, and it does not come from the stack — which is
   * R40's whole definition of trashing. Bena 2026-08-21, reversing R40's old
   * flat "tokens are never trashed" clause.
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
    const ev = this.ev('trashed', `${this.pname(seat)} trashes ${name} (${where}).`,
      { seat, card: name, from, region, ...(anchor?.token ? { token: true } : {}) });
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
      !!this.card(h.card).replaceRotDamage
      && a.controller === seat
      && !this.abilitiesSuppressed(a));                         // R62 (full projection)
    holders.sort((a, z) => a.holder.id - z.holder.id);
    for (const { holder, anchor } of holders) {
      if (this.card(holder.card).replaceRotDamage!(this, anchor, seat, n)) {
        this.ev('info', `${holder.card} replaces the ${n} damage ${this.pname(seat)}'s rot would deal.`);
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

  /** cache a card out of `seat`'s bin (Delver of the Ephemeral, Murkdrop
   * Distiller). The card LEAVES the bin — it is not copied. */
  cacheFromBin(seat: Seat, binIndex: number, opts: { prophecy?: string; playable?: boolean } = {}): CachedCard | undefined {
    const bin = this.player(seat).bin;
    if (binIndex < 0 || binIndex >= bin.length) return undefined;
    const [name] = bin.splice(binIndex, 1);
    return this.cacheCard(seat, name!, 'bin', opts);
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
   */
  private leavePlay(u: Entity): Entity[] | null {
    if (!this.entity(u.id)) return null;
    delete this.s.entities[u.id];
    const mods = u.mods.map(id => this.entity(id)).filter((m): m is Entity => !!m);
    for (const m of mods) {
      delete this.s.entities[m.id];
      if (!m.token) this.player(m.owner).bin.push(m.card);   // R69: a token MOD has no card of its own — erased
    }
    this.removeFromFormation(u.id);
    return mods;
  }

  /** The tail cacheUnit() and recall() share, once their despawn event is the
   * last event logged: fire it, then (R40, after the despawn so the log reads
   * in order) trash every nontoken mod — they entered a bin from play. */
  private afterDespawn(u: Entity, mods: Entity[]): void {
    const ev = this.events[this.events.length - 1]!;
    this.fireEvent('despawned', ev, u);
    for (const m of mods) if (!m.token) this.noteTrashed(m.owner, m.card, 'play', m);   // R70
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
   */
  cacheUnit(u: Entity, opts: { prophecy?: string; playable?: boolean } = {}): void {
    const mods = this.leavePlay(u);
    if (!mods) return;
    const evData = { ...this.leftPlayFacts(u), to: 'cache' };
    this.ev('despawned',
      `${u.card} leaves play for ${this.pname(u.owner)}'s cache` +
      (mods.length ? ` (its ${mods.length} mod(s) stay behind → bin)` : '') +
      (u.token ? ', then erased (token).' : '.'),
      evData);
    this.afterDespawn(u, mods);
    const cc = this.cacheCard(u.owner, u.card, 'play', opts);
    // R69's sweep, on the cache this time — `cc.uid` names the entry we just
    // made, so a second copy of the same card already sitting there is safe
    if (u.token) this.eraseFromZone(u.owner, u.card, 'cache', `${u.card} is erased from the cache — it is a token.`, cc.uid);
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
    return this.canPayLife(seat, this.lifeToPlay(seat, name));
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

  spawnUnit(seat: Seat, name: CardName, region: number, opts: { token?: boolean; tokenStats?: [number, number]; counters?: number; from?: 'hand' | 'cache' | 'bin'; spot?: FormationSpot } = {}): Entity {
    const u = this.newEntity({
      card: name, owner: seat, controller: seat, kind: 'unit', region,
      ...(opts.token ? { token: true, tokenStats: opts.tokenStats } : {}),
    });
    // "I spawn with X counters" (Robot): counters are on before the spawn event
    if (opts.counters) u.counters = opts.counters;
    // R29: a card PLAYED into an open spot in the formation is put there
    // BEFORE the spawn event exists, so no listener and no player ever sees it
    // standing anywhere else. See takeSpot.
    const placed = opts.spot ? this.takeSpot(u, seat, opts.spot) : null;
    // R49: `from` is set only when this spawn IS a card being PLAYED out of a
    // zone (resolveItem for a unit / spell unit card). A unit created by an
    // effect carries no zone, which is what keeps "when you play a card from
    // anywhere other than your hand" (Proph) off effect-created units.
    const ev = this.ev('spawned', `${this.pname(seat)} spawns ${name}${opts.counters ? ` (${opts.counters} +1/+1)` : ''}.`,
      { seat, unit: u.id, region, card: name, ...(opts.from ? { from: opts.from } : {}) });
    // under the spawn line, before anything the spawn triggers: the placement
    // is part of the play, not a consequence of it
    if (placed) this.ev('info', placed, { unit: u.id, region, seat });
    this.fireEvent('spawned', ev);
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
    const t = this.newEntity({ card: name, owner: seat, controller: seat, kind: 'spellToken', region: reg, x });
    this.ev('tokenCreated', `${this.pname(seat)} creates a ${name} ${x}.`, { seat, id: t.id, region: reg });
    return t;
  }

  /** the region where seat's non-battle actions happen right now */
  actionRegion(seat: Seat): number {
    if (this.s.phase === 'battle' && this.s.battle) return this.s.battle.region;
    return this.homeRegion(seat);
  }

  /** +1/+1 (n>0) or -1/-1 (n<0) counters; net counters cancel pairwise (Manual)
   * — a single signed int models that. Fires 'countersChanged' for triggers. */
  addCounters(target: Entity, n: number): void {
    if (!n || !this.entity(target.id)) return;
    target.counters += n;
    const kind = n > 0 ? '+1/+1' : '-1/-1';
    const ev = this.ev('countersChanged',
      `${target.card} gets ${Math.abs(n)} ${kind} counter(s) (net ${target.counters}).`,
      { unit: target.id, n, total: target.counters });
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
  private replaceCombatDamage(seat: Seat, amount: number, info: { attacker: Seat; region: number }): boolean {
    const holders = this.anchored((h, a) =>
      !!this.card(h.card).replaceCombatDamageToPlayer
      && a.region === info.region
      && !this.abilitiesSuppressed(a));                         // R62 (full projection)
    holders.sort((a, z) => a.holder.id - z.holder.id);
    for (const { holder, anchor } of holders) {
      if (this.card(holder.card).replaceCombatDamageToPlayer!(this, anchor, seat, amount, info)) {
        this.ev('info',
          `${holder.card} replaces the ${amount} combat damage to ${this.pname(seat)} ` +
          '(the damage still counts as having been dealt).',
          { seat, amount, by: holder.card });
        return true;
      }
    }
    return false;
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
   * Handles Reaping (kill → draw) and Electric (R4: excess beyond lethal
   * passes along a controller-chosen, non-overlapping adjacent path, planned
   * fully before any damage commits, and no formation changes during
   * distribution). Electric planning accounts for damage EARLIER HITS IN THIS
   * BATCH have already assigned, so overflow is computed against what the
   * victim will really have taken rather than against a stale board.
   */
  dealEffectDamageAll(ctx: EffectCtx, hits: { target: ResolvedTarget; n: number }[]): void {
    const srcAttrs = new Set(this.card(ctx.sourceName)?.attrs ?? []);
    // R79: attributes a virus donated to this effect while it sat on the stack
    // ("mostly Deadly, Piercing, and Powerful are impacted by this" — Caleb
    // 2025-03-06). Read here rather than from the printed card alone, which is
    // the seam the SPELLS half of Emberflame Enlightener was parked on.
    for (const a of ctx.grantedAttrs ?? []) srcAttrs.add(a);
    const poisonous = srcAttrs.has('Poisonous');
    const resonant = srcAttrs.has('Resonant');

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
    for (const hit of hits) {
      let n = hit.n;
      if (n <= 0) continue;
      // Powerful source: double the damage dealt (to units and players alike),
      // once, before Electric distribution or Vulnerable's receive-side doubling.
      if (srcAttrs.has('Powerful')) n *= 2;
      const target = hit.target;
      if ('player' in (target as object)) {
        add({ seat: (target as { player: Seat }).player }, n);
        continue;
      }
      const first = target as Entity;
      if (!this.entity(first.id)) continue;
      if (!srcAttrs.has('Electric')) { add({ u: first }, n); continue; }
      // R4: only the lethal share sticks to each victim; the rest passes along
      // a controller-chosen, non-overlapping adjacent path, all planned before
      // any damage commits (atomic — no formation changes mid-distribution)
      let victim = first;
      let remaining = n;
      const visited = new Set<EntityId>();
      let hop = 0;
      for (; ;) {
        visited.add(victim.id);
        const [, t] = this.effStats(victim);
        const lethal = Math.max(0, t - victim.damage - (dealt.get(`u${victim.id}`) ?? 0));
        if (remaining <= lethal) { add({ u: victim }, remaining); break; }
        if (lethal > 0) add({ u: victim }, lethal);
        remaining -= lethal;
        const nexts = this.adjacentInFormation(victim.id).filter(u => !visited.has(u.id));
        if (!nexts.length) break;                     // excess is lost
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
      received.set(key(r), r.u && this.effAttrs(r.u).has('Vulnerable') ? n * 2 : n);
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
      if (srcAttrs.has('Blessed')) this.blessedGain(ctx.controller, n, ctx.sourceName);
      if (poisonous) {
        // Poisonous deals the damage as permanent -1/-1 counters instead of
        // marked damage — no damage event, so nothing "is dealt damage".
        this.ev('info', `Poisonous: ${ctx.sourceName} deals ${n} to ${u.card} as -1/-1 counter(s).`);
        this.addCounters(u, -n);   // permanent counters; addCounters runs checkDeaths
        if (!this.entity(u.id)) killed.push(u);
      } else {
        u.damage += n;
        const ev = this.ev('damage', `${ctx.sourceName} deals ${n} to ${u.card}.`,
          { unit: u.id, n, total, source: ctx.sourceName, controller: ctx.controller });
        this.fireEvent('damage', ev);   // "when I am dealt damage" (Awoken Tomb)
        const [, t] = this.effStats(u);
        // R21: Deadly — any nonzero damage kills, regardless of toughness
        if (u.damage >= t || srcAttrs.has('Deadly')) killed.push(u);
      }
      if (resonant) this.loseLife(u.controller, n, `${ctx.sourceName} (Resonant)`);
    }
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
   * `opts.binTo` (R40) redirects the bin the dying card enters — Pull Under
   * ("delete target unit; it and its mods go to YOUR bin"). It has to be an
   * argument rather than a fix-up afterwards: the bin push and the trash
   * attribution are one and the same decision ("a card is trashed by the owner
   * of the bin it enters"), and the 'trashed' event fires synchronously from
   * here, queueing its triggers and bumping the per-battle ledger, long before
   * card code regains control. A compensating second trashed(caster) would
   * double-count the ledger and double-fire "when I am trashed" (Dropslime,
   * Nothyr, Murkstalker). `binTo` is silently irrelevant for an Unstable modded
   * unit — that one is erased and never reaches a bin at all.
   *
   * R69 — the branch ORDER is load-bearing, and it used to be wrong. Unstable
   * (`mods.length`) is tested FIRST: an Unstable ANYTHING, token or not, is
   * erased with its mods. The old order tested token-ness first, so a modded
   * token took the token carve-out and never reached the Unstable branch (game
   * UZRG: a Wraith body carrying a Wraith mod died, came back, AND fired its
   * mod's donated death trigger).
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
   */
  destroy(u: Entity, verb: 'dies' | 'is deleted' | 'is sacrificed',
    opts: { binTo?: Seat } = {}): void {
    if (!this.entity(u.id)) return;
    delete this.s.entities[u.id];
    const mods = u.mods.map(id => this.entity(id)).filter((m): m is Entity => !!m);
    // R70: every fact a death listener could want RIDES THE EVENT (see
    // leftPlayFacts) — `verb` (Ghord's "sacrificed", which used to
    // string-match the log message) is the death-only extra.
    const binSeat = opts.binTo ?? u.owner;
    const erasedByUnstable = mods.length > 0;
    const evData: Record<string, unknown> = {
      ...this.leftPlayFacts(u), verb,
      to: erasedByUnstable ? 'erased' : 'bin',
    };
    let trashedTo: Seat | null = null;
    // R72: hold the death event ITSELF, not "whatever the last event was".
    // removeFromFormation() below can now log a formation collapse, and a
    // trailing `this.events[length-1]` would hand every "when I die" trigger
    // that log line instead of the death it is listening for.
    let evDied: EngineEvent;
    if (erasedByUnstable) {
      // Unstable: a modded card dies → it and its mods are erased, not binned.
      // It still DIES: the event fires, death triggers go off, other cards'
      // watchers see it. Only the destination changed (R69).
      evDied = this.ev('died', `${u.card} ${verb} — Unstable: it and its ${mods.length} mod(s) are ERASED.`, evData);
    } else {
      // Everything else — token included — enters a bin FROM PLAY, so R40
      // trashes it. The trash event fires AFTER the death below so the log
      // reads "X dies → bin" then "…trashes X".
      this.player(binSeat).bin.push(u.card);
      evDied = this.ev('died', `${u.card} ${verb} → ${binSeat === u.owner ? 'bin' : `${this.pname(binSeat)}'s bin`}`
        + (u.token ? ', then erased (token).' : '.'), evData);
      trashedTo = binSeat;   // R40: the trasher is the owner of the bin it entered
    }
    // formation cleanup + back-row promotion + R72 column collapse
    // (state-based, no response window)
    this.removeFromFormation(u.id);
    if (this.s.phase === 'battle') {
      this.bumpBattleCounter(u.region, `allyDeaths:${u.controller}`);
    }
    // fire the death BEFORE erasing the mod entities: the dying unit's mods
    // still count as sources of donated "[Augment] when I die" text (the
    // fireEvent mod scan resolves u.mods through the entity table)
    this.fireEvent('died', evDied, u);
    // R40/R70: the trash fires anchored on the dying unit itself, so its own
    // "when I am trashed" trigger keeps the region it died in
    if (trashedTo !== null) this.noteTrashed(trashedTo, u.card, 'play', u);
    // R69 state-based sweep: the token has been in the bin for the whole
    // event window above (both `when` passes and the ledger saw it there) and
    // now leaves it, before anything queued has resolved.
    if (u.token && trashedTo !== null) this.eraseFromZone(trashedTo, u.card, 'bin', `${u.card} is erased from the bin — it is a token.`);
    // R65: an Unstable erase must reach the public erased pile like every
    // other erase (ev() keeps the pile off 'erased' events). Without this,
    // the one erase path players hit constantly — a modded unit dying — left
    // no public record while even a dying token gets one.
    if (erasedByUnstable) {
      this.ev('erased', `${u.card} and its mod(s) go to the erased pile.`,
        { seat: binSeat, cards: [u.card, ...mods.map(m => m.card)] });
    }
    for (const m of mods) delete this.s.entities[m.id];
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
   * `uid` names the exact cache entry (`CachedCard.uid`) — the cache is the
   * one zone whose entries are not bare names, and the caller minting the
   * entry always knows which one it just made.
   */
  eraseFromZone(seat: Seat, name: CardName, zone: 'bin' | 'hand' | 'cache', msg: string, uid?: number): void {
    if (zone === 'cache') {
      const i = uid !== undefined ? this.cacheIndexOf(seat, uid)
        : this.cache(seat).map(cc => cc.card).lastIndexOf(name);
      if (i === -1) return;
      this.uncache(seat, i);
    } else {
      const pile = zone === 'bin' ? this.player(seat).bin : this.player(seat).hand;
      const i = pile.lastIndexOf(name);
      if (i === -1) return;
      pile.splice(i, 1);
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
    const pick = options.length === 1 ? 0 : ctx.choose(opts.key ?? 'placeInFormation', {
      kind: 'electricPath', seat: ctx.controller,
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
    const out: TargetRef[] = [];
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
    // R67: 'player' is "target player" with no ownership clause — you are a
    // legal target for your own (Soul Siphon's X is the life SOME player lost,
    // and aiming it at yourself is a real, if usually bad, choice).
    if (spec.what === 'any' || spec.what === 'opponent' || spec.what === 'player') {
      for (const seat of this.s.regions[region]!.presentSeats) {
        if (spec.what === 'opponent' && seat === ally) continue;
        out.push({ player: seat });
      }
    }
    if (spec.what === 'stackSpell' || spec.what === 'stackEffect') {
      for (const it of this.s.stack) {
        if (it.id === excludeStackId) continue;   // R68: a negated item is not here to skip
        // an ambush is a played card's effect on the stack — negatable (R22)
        const spellish = it.kind === 'spell' || it.kind === 'spellUnit'
          || it.kind === 'spellToken' || it.kind === 'ambush';
        // R60: plain "target effect" also reaches the NONSPELL effects — the
        // triggered and activated abilities, and a virus being applied. Only a
        // 'unit' on its way into play is neither (it is not an effect at all).
        const effectish = spellish || it.kind === 'triggered'
          || it.kind === 'activated' || it.kind === 'virus';
        if (spec.what === 'stackSpell' ? spellish : effectish) out.push({ stack: it.id });
      }
    }
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
    // R64: "I must be targeted if able" (Gatekeeper of Souls) — a restriction
    // that narrows OTHER effects' lists. It is applied BEFORE the spec's own
    // restriction, because "if able" means "if it is a legal target for this
    // effect", and the spec's restriction is part of what decides that: a
    // Gatekeeper with base power 8 cannot compel an Unmake to aim at it.
    const gates = this.mustBeTargetedIn(region);
    let cands = out;
    if (gates.size) {
      const forced = out.filter(r => 'unit' in r && gates.has(r.unit));
      if (forced.length) cands = forced;
    }
    // R64: the printed RESTRICTION, judged against the resolved target. It
    // runs last so it never has to re-derive what `what` already settled.
    const restrict = spec.restrict;
    if (!restrict) return cands;
    const ctx = {
      ...(ally !== undefined ? { ally } : {}), region,
      ...(sourceId !== undefined ? { sourceId } : {}), ...(x !== undefined ? { x } : {}),
      ...(chosen ? { chosen } : {}),
      ...(event !== undefined ? { event } : {}),   // R67: "that player's bin"
    };
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

  /** R64: the units in `region` that must be targeted if able. Radiates like
   * a static — live as a unit in play, donated while an augment mod — and is
   * silenced by R62 exactly as an ability is. */
  mustBeTargetedIn(region: number): Set<EntityId> {
    const out = new Set<EntityId>();
    for (const { anchor } of this.anchored((h, a) =>
      !!this.card(h.card).mustBeTargeted
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
    const unstable = (it.augments?.length ?? 0) > 0;
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
      this.collectTargets(item, then, chain);
      this.commitItem(item, then);
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
   * Scope is deliberately narrow — exactly one card in the pool prints
   * {Modular}. The mods offered are GRAFTABLE cards: a graft's [Switch] effect
   * joins the item as an extra part, exactly the way a graft joins a unit's
   * graft cause (Manual p.33), and it is the only kind of mod that means
   * anything on a spell — a spell has no body for an augment to grant
   * attributes to. Suspends via 'cast'/'mods'; resumable, because
   * collectTargets re-runs from the top after every answered decision.
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
        // same exemption every other mod path (augment/graft) already gets
        if (!isGraftable(name) || !this.canPayCard(seat, name, { purpose: 'mod' })) return;
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
        seat: item.controller, kind: 'electricPath',
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
    this.need(name !== undefined && isGraftable(name), 'not a mod that can be applied');
    this.need(this.canPayCard(seat, name, { purpose: 'mod' }), 'cannot pay for that mod');
    zone.splice(index, 1);
    this.payCard(seat, name, { purpose: 'mod' });
    (item.mods ??= []).push({ card: name, from: modFrom });
    item.parts.push({ effectKey: `graft:${name}`, targets: [] });
    for (const part of item.parts) part.mods = item.mods.map(m => m.card);
    item.label = `${item.card} + ${item.mods.map(m => m.card).join(' + ')}`;
    // log-only: 'modApplied' means a mod attached to a UNIT (its listeners all
    // read ev.data.host), and there is no host here — the mod is riding a
    // spell. R37 already says applying a mod is not playing a card.
    this.ev('info', `${name} is applied to ${item.card} from ${modFrom} as it is played ({Modular}).`,
      { item: item.id, card: name, from: modFrom });
  }

  /** A {Modular} spell's mods follow the card it was applied to: they leave
   * with it, FROM THE STACK, so — like the spell itself — they are binned and
   * never trashed (R40). No-op for every other item. */
  binItemMods(item: StackItem): void {
    for (const m of item.mods ?? []) this.toBin(item.controller, m.card, 'stack');
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
      case 'sacrificeUnits': return cost.from === 'self'
        ? this.selfSacrificeable(seat, sourceId)
        : this.unitsOf(seat, region).length >= want;
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
      while (!this.costSettled(part, cost)) {
        const done = this.costPaidSoFar(part, cost);
        const owed = total === null ? 1 : total - done;
        if (!this.canPayCastCost(seat, this.costOwing(cost, owed), item.region, 0, item.sourceId)) {
          if (total === null) {
            // a variable cost simply stops when nothing more can be paid —
            // what was paid stands, and X is what it is
            this.finishVariableCost(item, part, cost);
            break;
          }
          part.spent = true;   // unpayable: the part never resolves
          this.ev('info', `${item.label}: the [${this.castCostLabel(cost)}] cost cannot be paid — that effect is skipped.`);
          break;
        }
        // choice-free costs: charged on the spot, no decision to ask for. A
        // grafted rider is still opt-in, so it goes through the decision path.
        if (!optional && !this.costIsIterated(cost)) { this.chargeCastCost(item, part, cost); break; }
        const options: DecisionOption[] = this.castCostOptions(item, part, cost);
        // payability and the option list read the same pool, so this is a
        // belt-and-braces branch: nothing left to pay with closes a variable
        // cost at what it has, and skips a fixed one rather than under-paying.
        if (!options.length) {
          if (total === null) this.finishVariableCost(item, part, cost);
          else {
            part.spent = true;
            this.ev('info', `${item.label}: the [${this.castCostLabel(cost)}] cost cannot be paid — that effect is skipped.`);
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
            prompt: `${item.label}: ${this.castCostLabel(cost)}${
              total !== null && total > 1 ? ` (${done + 1} of ${total})` : total === null ? ` (X = ${done} so far)` : ''
            } — additional cost${optional ? ', optional' : ''}`,
            options,
          },
        );
      }
    }
  }

  /** R64: the same cost, restated as the amount still owing — what payability
   * must be asked about mid-payment. */
  private costOwing(cost: CastCost, owed: number): CastCost {
    if (cost.kind === 'sacrificeUnit' || cost.kind === 'gainDebt') return cost;
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
  private castCostOptions(item: StackItem, part: EffectPart, cost: CastCost): DecisionOption[] {
    const seat = item.controller;
    // R73: "[Sacrifice me]" names no unit, so it offers no unit menu. It only
    // reaches here as an optional grafted rider (pay-or-decline); the normal
    // path charges it without asking. Falls through to the "Pay: …" default.
    if (cost.kind === 'sacrificeUnit'
      || (cost.kind === 'sacrificeUnits' && cost.from !== 'self')) {
      // a multi-unit sacrifice may not name the same unit twice — but each one
      // is really gone by the time the next is asked for, so "still in play"
      // already guarantees it and no explicit spent-set is needed.
      return this.unitsOf(seat, item.region)
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
      return pool
        .filter(u => u.counters > 0)
        .map(u => ({
          label: `${this.targetLabel({ unit: u.id })} — has ${u.counters} counter${u.counters === 1 ? '' : 's'}`,
          value: { counterFrom: u.id }, card: u.card,
        }));
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
    } else if (cost.kind === 'sacrificeUnits' && cost.from === 'self') {
      // R73: "[Sacrifice me]". No choice, so no decision and no suspension —
      // it is charged here, in the cast window, before anyone has priority.
      // canPayCastCost already refused an absent source, so this is live.
      const u = this.selfSacrifice(seat, item.sourceId);
      if (!u) return;
      // the receipt keeps the same shape as the chosen-unit path: stats
      // snapshotted AT PAYMENT, so a resolution that wants "the defense of the
      // sacrificed unit" reads a number, not a corpse. (Nothing reads this one
      // yet — uniformity is the point.)
      const [p, t] = this.effStats(u);
      (paid.sacrificedUnits ??= []).push({ card: u.card, power: p, defense: t });
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
      part.spent = true;
      this.ev('info', `${item.label}: the [cost] is declined — that effect is skipped.`);
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
      bin.splice(idx, 1);
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
      (paid.counters ??= []).push({ unit: u!.id, card: u!.card, n: 1 });
      this.ev('info', `${this.pname(item.controller)} removes a +1/+1 counter from ${u!.card} — the cost of ${item.label}.`);
      this.addCounters(u!, -1);
      return;
    }
    const id = (val as { unit: EntityId }).unit;
    const u = this.entity(id);
    this.need(u && u.kind === 'unit' && u.controller === item.controller && !u.absent
      && u.region === item.region, 'bad cost choice');
    const [p, t] = this.effStats(u);
    const receipt = { card: u!.card, power: p, defense: t };
    // 'sacrificeUnit' keeps the singular receipt every existing card reads;
    // the plural kind accumulates its own list.
    if (cost.kind === 'sacrificeUnits') (paid.sacrificedUnits ??= []).push(receipt);
    else paid.sacrificed = receipt;
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
        .map(u => ({ label: atom.kind === 'sacrificeOther' ? u.card : `Sacrifice ${u.card}`, value: { unit: u.id }, card: u.card }));
      const options: DecisionOption[] =
        atom.kind === 'discard' ? discards
          : atom.kind === 'sacrificeOther' ? sacrifices
            : [...discards, ...sacrifices];
      if (!options.length) {
        // the payment vanished between activation and collection (a response
        // took the last unit): the cost is unpayable, so nothing is paid and
        // the whole activation is skipped — R35's unpayable-cost reading.
        this.ev('info', `${item.label}: the activation cost can no longer be paid — the ability does nothing.`);
        for (const p of item.parts) p.spent = true;
        delete item.pendingCosts;
        return;
      }
      this.suspend(
        { type: 'cast', stage: 'itemCost', item, partIndex: 0, targetIndex: 0, then, moreItems },
        {
          seat, kind: 'targets',
          prompt: `${item.label}: ${
            atom.kind === 'discard' ? 'discard a card'
              : atom.kind === 'sacrificeOther' ? 'sacrifice a unit'
                : 'discard a card or sacrifice a nontoken unit'
          } (activation cost${atom.n > 1 ? `, ${atom.n} left` : ''})`,
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
    this.payMana(seat, cost.mana ?? 0);
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

  commitItem(item: StackItem, then: 'push' | 'resolve'): void {
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
      this.fireEvent('spellPlayed', ev);
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
    this.resolveItem(item);
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
  resolveItem(item: StackItem): void {
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
      if (item.hostStack !== undefined) {
        const target = this.s.stack.find(it => it.id === item.hostStack);
        if (!target) {
          this.ev('fizzled', `${item.label} fizzles (its host has left the stack) → bin.`, { id: item.id });
          this.toBin(item.controller, item.card!, 'stack');   // R40: from the stack, no trash
          return;
        }
        this.augmentStackItem(target, item.card!, item.controller);
        return;
      }
      const host = item.hostId !== undefined ? this.entity(item.hostId) : undefined;
      if (!host) {
        this.ev('fizzled', `${item.label} fizzles (host is gone) → bin.`, { id: item.id });
        this.toBin(item.controller, item.card!, 'stack');   // R40: from the stack, no trash
        return;
      }
      this.attachMod(host, item.card!, item.controller, 'augment');
      return;
    }
    // spell / spellUnit / spellToken / triggered / activated: run live parts
    const partAlive = (part: EffectPart): boolean => {
      if (part.spent) return false;
      const def = effectByKey(part.effectKey);
      if (!def.targets) return true;
      // "UP TO one target …" (min 0): declaring no target is a legal choice, so
      // the part still resolves — anything printed alongside the optional
      // target ("Recall up to one target cached card. You gain 3 life.") must
      // happen. A min-1 spec with nothing declared is the real fizzle.
      if (!part.targets.length) return (def.targets.min ?? 1) === 0;
      return part.targets.some(t => this.targetStillLegal(t));
    };
    if (!item.parts.some(partAlive)) {
      this.ev('fizzled', `${item.label} fizzles — all targets are gone.`, { id: item.id });
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
    this.resolveParts(item, 0, {});
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
   * Run parts [from..]; the composite is ONE ability resolving top-to-bottom.
   * A suspending part is replayed from its own boundary with `answers` filled
   * in — R85: the world is rolled back to that boundary on RESUME
   * (E.resumeResolve), not at the suspension, so the half-finished resolution
   * is what the table gets to look at while somebody is being asked something.
   *
   * `shownEvents` is R85's other half, and applies to part `from` only: that
   * many events of this part are already on everyone's screen, so the replay's
   * re-emission of them is dropped instead of doubling the log.
   */
  resolveParts(item: StackItem, from: number, answers: Record<string, unknown>, shownEvents = 0): void {
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
      const ctx: EffectCtx = {
        controller: item.controller,
        sourceName: item.card ?? item.label,
        sourceId: item.sourceId,
        region: item.region,
        targets: resolved,
        // R64: a VARIABLE cast cost defines this part's X (Discharge's "remove
        // X counters … deal X damage"). It wins over the item-wide mana X so a
        // grafted rider that paid its own cost cannot read its carrier's.
        x: part.costPaid?.x ?? item.x,
        costPaid: part.costPaid,
        ...(part.mods ? { mods: part.mods } : {}),
        ...(item.augments?.length ? { grantedAttrs: this.stackAugmentAttrs(item) } : {}),
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
      let helperSeq = 0;
      // ctx.choose already namespaces by part index; the seq keeps a helper
      // invoked twice in one part asking two distinct questions
      this.partChoose = (tag, dec) => ctx.choose(`${tag}#${helperSeq++}`, dec);
      try {
        def.run(this, ctx);
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
            },
            { seat: sig.dec.seat, kind: sig.dec.kind, prompt: sig.dec.prompt, options: sig.dec.options },
          );
        }
        throw sig;
      } finally {
        this.partChoose = outerChoose;
      }
      // the part finished: the same suppression, for the last replay of it
      if (shown) this.events.splice(evLen, Math.min(shown, this.events.length - evLen));
      this.checkDeaths();   // sequential within the composite; triggers wait for settle()
      if (beforeUnits) this.afflictingKills(beforeUnits, item.card ?? item.label);
    }
  }

  /** The attributes of a stack item's SOURCE: the source entity's live attrs
   * while it is still in play (so granted ones count), otherwise the printed
   * card's. Used by the resolution-time attribute checks ({Afflicting}). */
  itemAttrs(item: StackItem): Set<string> {
    const src = item.sourceId !== undefined ? this.entity(item.sourceId) : undefined;
    const set = src ? this.ownAttrs(src)
      : new Set<string>(item.card ? this.card(item.card).attrs : []);
    for (const a of this.stackAugmentAttrs(item)) set.add(a);   // R79
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
   * `hasCard` is whether this kind has a card to place at all — a spell token
   * has none, and a triggered/activated ability's `card` names its source,
   * which is still standing in play. The erase runs either way, because the
   * viruses themselves still have to go somewhere.
   */
  dischargeItem(item: StackItem, hasCard: boolean): void {
    const viruses = item.augments ?? [];
    if (viruses.length) {
      // R65: each card reaches ITS OWN owner's erased pile — a virus on an
      // enemy spell is the enemy's card, and the two piles are public.
      this.ev('erased',
        `${item.label} is Unstable — it and its ${viruses.length} virus mod(s) are ERASED.`,
        { seat: item.controller, cards: hasCard && item.card ? [item.card] : [] });
      for (const seat of [...new Set(viruses.map(v => v.by))].sort()) {
        const mine = viruses.filter(v => v.by === seat).map(v => v.card);
        this.ev('erased', `${mine.join(', ')} — erased with ${item.label}.`, { seat, cards: mine });
      }
    } else if (hasCard && item.card) {
      this.toBin(item.controller, item.card, 'stack');
    }
    this.binItemMods(item);   // {Modular}: its mods leave with it
  }

  afterParts(item: StackItem): void {
    if (item.kind === 'spellUnit') {
      const u = this.spawnUnit(item.controller, item.card!, item.region, { ...(item.from ? { from: item.from } : {}) });
      // R79: a spell UNIT's card does not leave — it arrives. Its viruses ride
      // it in, as the augment mods they always were, which is also what makes
      // the body Unstable. Erasing the card here instead would delete a unit
      // on its way into play, which no ruling asks for.
      for (const a of item.augments ?? []) this.attachMod(u, a.card, a.by, 'augment');
      this.binItemMods(item);   // {Modular}: its mods leave with it, also from the stack
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
    const cardName = viaCard ?? source.card;
    const def = this.card(cardName);
    const list = abilityKeyPrefix === 'ability' ? def.abilities : def.augmentText;
    const ability = list?.[abilityIndex];
    if (!ability) return null;
    const budgetKey = `${abilityKeyPrefix}:${cardName}#${abilityIndex}`;
    const budgetHolder = source;   // per card = per entity instance (R9)
    if (ability.bounded) {
      if ((budgetHolder.budgets[budgetKey] ?? 0) > 0) return null;   // bounded cause bounds the whole composite
      budgetHolder.budgets[budgetKey] = 1;
    }
    const parts: EffectPart[] = [{
      effectKey: `${abilityKeyPrefix}:${cardName}#${abilityIndex}`, targets: [],
    }];
    // grafted effects join only a graft cause, and only from graft-applied mods
    if (ability.graftCause && abilityKeyPrefix === 'ability') {
      for (const modId of source.mods) {
        const mod = this.entity(modId);
        if (!mod || mod.appliedAs !== 'graft') continue;
        const g = this.card(mod.card).graftEffect;
        if (!g) continue;
        if (g.bounded) {
          if ((mod.budgets['graft'] ?? 0) > 0) continue;   // used this turn: skipped, composite still fires
          mod.budgets['graft'] = 1;
        }
        parts.push({ effectKey: `graft:${mod.card}`, targets: [], fromMod: mod.id });
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
      queued = this.collectTriggersFrom(u, u.card, 'ability', type, ev, src) || queued;
      // a card's own [Augment] text is active when played normally (Manual Q&A)
      queued = this.collectTriggersFrom(u, u.card, 'augment', type, ev, src) || queued;
      for (const modId of u.mods) {
        const mod = this.entity(modId);
        if (mod && mod.appliedAs === 'augment') {
          queued = this.collectTriggersFrom(u, mod.card, 'augment', type, ev, src) || queued;
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
   * per-copy triggers. Bounded budgets (R9) cannot persist on a stand-in, so a
   * [Switch1] zone trigger is bounded only within the one firing — flagged in
   * docs/digital-rules.md rather than faked.
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
    logMsg: string, logData: Record<string, unknown>): boolean {
    if (ability.when && !ability.when(this, host, ev)) return false;
    const parts = this.composeParts(host, abilityIndex, prefix, cardName);
    if (!parts) return false;
    this.s.triggerQueue.push({
      sourceId: host.id, sourceCard: cardName, controller: host.controller,
      abilityIndex, label: `${cardName}: ${ability.label}`, parts,
      region: host.region, event: ev,
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
        const present = zone === 'bin'
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

  private collectTriggersFrom(host: Entity, cardName: CardName, prefix: 'ability' | 'augment', type: EventType, ev: EngineEvent, eventSource?: EntityId): boolean {
    const def = this.card(cardName);
    const list = prefix === 'ability' ? def.abilities : def.augmentText;
    if (!list) return false;
    let queued = false;
    list.forEach((ability, idx) => {
      if (!isTriggered(ability)) return;
      if (!ability.events.includes(type)) return;
      if (ability.self && eventSource !== host.id) return;
      queued = this.queueTrigger(host, cardName, idx, ability, prefix, ev,
        `Trigger: ${cardName} — ${ability.label}.`, { unit: host.id }) || queued;
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

  /** Drain the trigger queue. In battle, triggers become stack items (owner
   * orders their own; NIT's enter last so they resolve first — R2). Outside
   * battle they resolve immediately in the order the stack would produce.
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
      // 2. next trigger: battle → stack entry order IT(reversed) then NIT(reversed);
      //    immediate → resolution order NIT first (equivalent outcomes, R2)
      // between combat sub-steps triggers resolve IMMEDIATELY — special
      // actions, no priority (R3); otherwise battle triggers use the stack
      const battleMode = this.s.phase === 'battle' && !this.s.battle?.damageStep;
      const itQ = this.s.triggerQueue.filter(t => t.controller === this.initiative);
      const nitQ = this.s.triggerQueue.filter(t => t.controller === this.nit);
      const next = battleMode
        ? (itQ.length ? itQ[itQ.length - 1]! : nitQ[nitQ.length - 1]!)
        : (nitQ.length ? nitQ[0]! : itQ[0]!);
      this.s.triggerQueue.splice(this.s.triggerQueue.indexOf(next), 1);
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
      };
      const then = battleMode ? 'push' : 'resolve';
      this.collectTargets(item, then, []);
      this.commitItem(item, then);
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
      if (!this.s.triggerQueue.length) {
        // resume a suspended combat-damage pump (R3 sub-step interleaving)
        if (this.s.battle?.damageStep && !this.pumping && !this.s.decision && !this.s.stack.length) {
          this.pumpCombatDamage();
        }
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

  private combatSubStep(sub: 'Swift' | 'normal' | 'Sluggish'): void {
    const b = this.s.battle!;
    // pool assigned to each unit this sub-step, tagged with the striking column's
    // damage-replacement attrs (Poisonous → counters, Resonant → rider) and,
    // for R48 {Blessed}, the seat the life gain is owed to
    const perUnit = new Map<EntityId, {
      pool: number; poisonous: boolean; resonant: boolean;
      /** R61 {Pure}: this damage came out of an attribute-blind exchange, so
       * the VICTIM's Vulnerable is switched off for it too */
      pure?: boolean;
      blessedTo?: Seat; blessedFrom?: string;
    }>();
    const deadlyHit = new Set<EntityId>();   // R21: any damage from a Deadly column kills
    const playerDmg: number[] = this.s.players.map(() => 0);
    const thievingDraw: number[] = this.s.players.map(() => 0);   // draws owed to each seat
    // R48: combat damage a column deals to a PLAYER, one entry per column —
    // per-column granularity is required by the Blightsea Polyp replacement
    // ("as 1 rot", whatever the column's power) and by {Lethal}.
    const playerHits: { seat: Seat; amount: number; by: Seat; attrs: Set<string>; label: string }[] = [];
    // R48 {Afflicting}: units each afflicting column damaged this sub-step,
    // keyed by column, so its kills can be diffed out afterwards
    const afflicted = new Map<string, { dealer: Seat; label: string; ids: Set<EntityId> }>();
    const beforeUnits = this.snapshotUnits();
    const alive = (ids: EntityId[]) => ids.filter(id => this.entity(id));
    const colLabel = (ids: EntityId[]) => ids.map(id => this.entity(id)?.card ?? '?').join(' + ') || 'a column';
    const colPower = (ids: EntityId[]) =>
      ids.reduce((s, id) => { const u = this.entity(id); return u ? s + Math.max(0, this.effStats(u)[0]) : s; }, 0);
    // Powerful column: its whole combat output is doubled at the source, before
    // lethal assignment and Piercing overflow (so a Powerful+Piercing column
    // pierces the doubled amount).
    const dealtPower = (ids: EntityId[], attrs: Set<string>) =>
      colPower(ids) * (attrs.has('Powerful') ? 2 : 1);
    // front-to-back lethal assignment (R7: controller's split is the default
    // auto-assignment for now; piercing overflow is automatic, never elective).
    // Returns the leftover pool (the Piercing candidate). A Vulnerable victim
    // receives double, so half the pool is lethal and the pre-double remainder
    // pierces through sooner (R23); Deadly caps lethal at 1 (R21).
    const assign = (ids: EntityId[], amount: number, srcAttrs: Set<string>,
      src: { dealer: Seat; key: string; label: string }, pure = false): number => {
      const deadly = srcAttrs.has('Deadly');
      const poisonous = srcAttrs.has('Poisonous');
      const resonant = srcAttrs.has('Resonant');
      const blessedTo = srcAttrs.has('Blessed') ? src.dealer : undefined;
      let remaining = amount;
      for (const id of ids) {
        const u = this.entity(id);
        if (!u || remaining <= 0) continue;
        const mult = (!pure && this.effAttrs(u).has('Vulnerable')) ? 2 : 1;
        const prev = perUnit.get(id)?.pool ?? 0;
        const [, t] = this.effStats(u);
        const recvCap = Math.max(0, t - u.damage - prev * mult);   // received still needed to kill
        let poolNeed = Math.ceil(recvCap / mult);
        if (deadly && recvCap > 0) poolNeed = 1;   // 1 pool point suffices to kill
        const a = Math.min(remaining, poolNeed);
        if (a > 0) {
          const cur = perUnit.get(id) ?? { pool: 0, poisonous, resonant };
          cur.pool += a; cur.poisonous = poisonous; cur.resonant = resonant;
          if (pure) cur.pure = true;
          if (blessedTo !== undefined) { cur.blessedTo = blessedTo; cur.blessedFrom = src.label; }
          perUnit.set(id, cur);
          if (deadly) deadlyHit.add(id);
          if (srcAttrs.has('Afflicting')) {
            const bucket = afflicted.get(src.key)
              ?? { dealer: src.dealer, label: src.label, ids: new Set<EntityId>() };
            bucket.ids.add(id);
            afflicted.set(src.key, bucket);
          }
        }
        remaining -= a;
      }
      return remaining;
    };

    b.columns.forEach((atkCol, ci) => {
      const atk = alive(atkCol);
      const blockedEver = b.blocks[ci] !== undefined;
      const blk = blockedEver ? alive(b.blocks[ci]!) : [];
      // R61 {Pure}: one Pure card in either column blinds the whole exchange
      // to attributes — both sides', in both directions.
      const pure = this.pure(atk, blk);
      const attrsOf = (ids: EntityId[]) => pure ? new Set<string>() : this.colAttrs(ids);
      // attacker side
      if (atk.length && this.scheduled(atk, sub, pure)) {
        const atkAttrs = attrsOf(atk);
        const pow = dealtPower(atk, atkAttrs);
        // R72: `ci` is only an identity for the length of THIS sub-step. The
        // key is a local bucket label for the afflicting diff below and is
        // never stored, because the formation may collapse (and every index
        // move) before the next sub-step runs.
        const src = { dealer: b.attacker, key: `atk:${ci}`, label: colLabel(atk) };
        let toPlayer = 0;
        if (blk.length) {
          const left = assign(blk, pow, atkAttrs, src, pure);
          if (atkAttrs.has('Piercing')) toPlayer = left;
        } else if (blockedEver) {
          // blocked stays blocked: only Piercing carries through dead blockers
          if (atkAttrs.has('Piercing')) toPlayer = pow;
          else if (pow > 0) this.ev('info', `Column ${ci + 1} is blocked (blockers gone) — no damage through.`);
        } else {
          toPlayer = pow;
        }
        if (toPlayer > 0) {
          playerHits.push({ seat: b.defender, amount: toPlayer, by: b.attacker, attrs: atkAttrs, label: src.label });
          if (atkAttrs.has('Thieving')) thievingDraw[b.attacker] = (thievingDraw[b.attacker] ?? 0) + 1;
        }
      }
      // blocker side
      if (blk.length && this.scheduled(blk, sub, pure)) {
        const blkAttrs = attrsOf(blk);
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
          const pow = dealtPower(blk, blkAttrs);
          if (pow > 0) {
            this.ev('info',
              `Column ${ci + 1} has no attackers left — its blockers have nothing to fight.`,
              { region: b.region });
          }
        } else {
          const src = { dealer: b.defender, key: `blk:${ci}`, label: colLabel(blk) };
          const left = assign(atk, dealtPower(blk, blkAttrs), blkAttrs, src, pure);
          if (blkAttrs.has('Piercing') && left > 0) {
            playerHits.push({ seat: b.attacker, amount: left, by: b.defender, attrs: blkAttrs, label: src.label });
            if (blkAttrs.has('Thieving')) thievingDraw[b.defender] = (thievingDraw[b.defender] ?? 0) + 1;
          }
        }
      }
    });

    // commit unit damage: Vulnerable doubles received; Poisonous replaces it with
    // -1/-1 counters; Resonant riders the same amount onto the unit's controller
    for (const [id, hit] of perUnit) {
      const u = this.entity(id);
      if (!u) continue;
      const mult = (!hit.pure && this.effAttrs(u).has('Vulnerable')) ? 2 : 1;
      const received = hit.pool * mult;
      if (received <= 0) continue;
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
    for (const id of deadlyHit) {
      const u = this.entity(id);
      if (u) {
        this.ev('info', `Deadly — ${u.card} dies.`);
        this.destroy(u, 'dies');
      }
    }
    // R48 {Afflicting}: whatever an afflicting column damaged and killed gives
    // its controller a rot, before any life is lost this sub-step. Ordinary
    // combat damage does not kill until the state check, which pumpCombatDamage
    // runs only AFTER this sub-step returns — so run it here first, or a
    // straightforward combat kill would fall outside the diff. Idempotent: the
    // pump's own checkDeaths then finds nothing left to do.
    if (afflicted.size) this.checkDeaths();
    for (const bucket of afflicted.values()) {
      this.afflictingKills(beforeUnits, bucket.label, bucket.ids);
    }
    // R48 {Blessed}: combat damage to a PLAYER gains too, and — the whole
    // point of "same game state check" — it is committed before the lethal
    // check below, so a blessed column can never kill its own controller.
    for (const hit of playerHits) {
      if (hit.attrs.has('Blessed')) this.blessedGain(hit.by, hit.amount, hit.label);
    }
    // R38 (Blightsea Polyp): a per-COLUMN replacement of combat damage to
    // players — "as 1 rot", whatever the column's power. Offered per hit, and
    // a replaced hit still counts as DEALT (Caleb 2024-10-24), which is why
    // Thieving above and Lethal below read playerHits, not playerDmg.
    for (const hit of playerHits) {
      if (this.replaceCombatDamage(hit.seat, hit.amount, { attacker: hit.by, region: b.region })) continue;
      playerDmg[hit.seat] = (playerDmg[hit.seat] ?? 0) + hit.amount;
    }
    for (const seat of [this.initiative, this.nit]) {
      const n = playerDmg[seat] ?? 0;
      if (n > 0) this.loseLife(seat, n, 'combat');
    }
    // R48 {Lethal}: "Any combat damage from a lethal unit will kill a player."
    // Last, because a normal-damage kill above already ended the game (and a
    // {Blessed} gain has already been applied).
    for (const hit of playerHits) {
      if (hit.attrs.has('Lethal')) this.killPlayer(hit.seat, `${hit.label} is Lethal`);
    }
    // Thieving: a column that dealt combat damage to a player draws one card (R24)
    for (const seat of [this.initiative, this.nit]) {
      for (let i = 0; i < (thievingDraw[seat] ?? 0); i++) {
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
    this.refreshProphecies();   // R43: "N Turns Pass" ticks here
    if (this.s.mode === 'draft') this.startDraftStep();
    if (this.s.mode === 'constructed') this.startConstructedDraw();
  }

  /** Constructed draw phase (Manual "Constructed"): everyone draws 4, then
   * each player puts 2 cards from hand on the bottom of their own deck in any
   * order (the bottomCards action). A seat with nothing to put back (empty
   * deck ran the hand dry) is auto-done. */
  startConstructedDraw(): void {
    for (const seat of this.dealOrder()) this.draw(seat, 4);
    const done = this.s.players.map(p => p.hand.length === 0);
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

  /** Open the draft step. After each cycle of N+1 turns (N = players; 1v1:
   * turns 4, 7, …) all packs are first recycled — bottom of the deck in
   * random order — and fresh packs of 10 dealt (see packCycle). */
  startDraftStep(): void {
    const n = this.s.players.length;
    if (this.s.turn > 1 && packCycle(this.s.turn, n).index === 0) {
      const recycled = this.shuffle(this.s.packs.flat());
      this.s.sharedDeck.push(...recycled);
      this.dealPacks();
      this.ev('draft', 'Packs are recycled; everyone is dealt a fresh pack of 10.');
    }
    this.s.draftDone = this.s.players.map(() => false);
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
      const hasTarget = (name: CardName) => {
        const spec = this.card(name).spellEffect?.targets;
        return !spec || this.targetCandidates(spec, this.homeRegion(seat), undefined, seat).length > 0;
      };
      const fromHand = this.player(seat).hand.some(name =>
        this.card(name).timing === 'haste' && this.canPayCard(seat, name) && hasTarget(name));
      if (fromHand) return true;
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
      delete e.granted;      // R63: and so is granted text
      delete e.allured;      // R84 {Alluring}: "can't attack" lasted the battle phase
    }
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
   * Unlike the end-of-haste window this needs no deferral: nothing after the
   * event depends on finishing (the phase is already flipped), so a trigger
   * that suspends simply resumes through the normal decision path.
   */
  startDeployment(): void {
    this.s.phase = 'deploy';
    this.s.deployDone = this.s.players.map(() => false);
    this.s.deployPlayer = this.initiative;
    this.ev('phase', 'Deployment: both players deploy at the same time — moves are revealed when everyone is done.');
    this.rotDamage();   // R38: start of deployment, before anyone may deploy
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
