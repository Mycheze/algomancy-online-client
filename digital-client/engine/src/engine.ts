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
  Action, BattleState, CachedCard, CachedProphecy, CardName, Decision, DecisionOption,
  EffectPart, EngineEvent, Entity, EntityId, EventType, GameState, PendingTrigger,
  ResourceKind, Seat, StackItem, Suspension, TargetRef,
} from './types.ts';
import {
  affinityPips, effectByKey, getCard, graftCauseIndex, isGraftable, isTriggered,
  specForSlot, zoneTriggersFor,
  type Ability, type CardDef, type CastCost, type CostMod, type EffectCtx, type EffectDef,
  type ResolvedTarget, type TargetSpec, type TriggeredAbility,
} from './cards/dsl.ts';
import { rngNext, rngShuffle } from './rng.ts';

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
    return e;
  }
  illegal(why: string): never { throw new IllegalAction(why); }
  need(cond: unknown, why: string): asserts cond { if (!cond) this.illegal(why); }

  rand(): number {
    const [v, next] = rngNext(this.s.rngState);
    this.s.rngState = next;
    return v;
  }
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
   * R59: every active CostMod that applies to `ctx`. Radiates from units in
   * play and from augment mods anchored on their host, scoped to the region
   * the card is being played into (R12) — the same rules as staticsFor.
   */
  private costModsFor(region: number): { holder: Entity; mod: CostMod }[] {
    if (this.inCostMods) return [];
    const out: { holder: Entity; mod: CostMod }[] = [];
    this.inCostMods = true;
    try {
      for (const holder of Object.values(this.s.entities)) {
        let anchor: Entity | undefined;
        if (holder.kind === 'unit') anchor = holder;
        else if (holder.kind === 'mod' && holder.appliedAs === 'augment' && holder.modOf !== undefined) {
          anchor = this.entity(holder.modOf);
        }
        if (!anchor || anchor.absent || anchor.region !== region) continue;
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
    for (const { holder, mod } of this.costModsFor(region)) total += mod.delta(this, holder, ctx);
    return Math.max(0, total);
  }

  canPayCard(seat: Seat, name: CardName, opts: CostOpts = {}): boolean {
    const c = this.card(name);
    // X spells: X is chosen and paid at cast (R35); castability needs only the
    // smallest legal X to be affordable (xMin, e.g. "X can't be zero" → 1)
    if (this.openMana(seat) < this.manaToPlay(seat, name, opts)) return false;
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
  }

  // ── stats & attributes (six-layer projection; layers 5-6 have no pool cards
  //    yet but the seams are here: see docs/03 §4) ──────────────────────
  /** reentrancy guard for static-modifier evaluation (see StaticMod docs) */
  private inStatics = false;

  /** every StaticMod projected onto `target` by in-play units in its region */
  private staticsFor(target: Entity): { holder: Entity; mod: import('./cards/dsl.ts').StaticMod }[] {
    if (this.inStatics) return [];
    const out: { holder: Entity; mod: import('./cards/dsl.ts').StaticMod }[] = [];
    this.inStatics = true;
    try {
      for (const holder of Object.values(this.s.entities)) {
        // statics radiate from units in play AND from augment mods (text-box
        // [Augment] statics transfer with the card — Animated Spark, Sandstone
        // Defender). A mod's static is anchored on its HOST: the transferred
        // text reads from the host's perspective ("your OTHER units" excludes
        // the host, controller/region are the host's).
        let anchor: Entity | undefined;
        if (holder.kind === 'unit') anchor = holder;
        else if (holder.kind === 'mod' && holder.appliedAs === 'augment' && holder.modOf !== undefined) {
          anchor = this.entity(holder.modOf);
        }
        // a sent counterattacker "doesn't exist until phase 1 finishes"
        // (Manual p.20) — it radiates nothing in the region it left
        if (!anchor || anchor.absent || anchor.region !== target.region) continue;
        for (const mod of this.card(holder.card).statics ?? []) {
          if (mod.affects(this, anchor, target)) out.push({ holder: anchor, mod });
        }
      }
    } finally { this.inStatics = false; }
    return out;
  }

  /** layers 1-2: the printed/token stats, or the base somebody rewrote */
  baseStatsOf(e: Entity): [number, number] {
    if (e.baseSet) return [e.baseSet[0], e.baseSet[1]];        // layer 2
    const c = this.card(e.card);
    return e.tokenStats ?? [c.power, c.toughness];             // layer 1
  }

  effStats(e: Entity): [number, number] {
    const base = this.baseStatsOf(e);                          // layers 1-2
    let p = base[0]! + e.counters + e.tempPower;               // layer 3
    let t = base[1]! + e.counters + e.tempToughness;
    for (const { holder, mod } of this.staticsFor(e)) {        // layer 3: continuous projections
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
  /** attrs on the card itself + type-line attrs granted by augment/virus mods */
  ownAttrs(e: Entity): Set<string> {
    const set = new Set<string>(this.card(e.card).attrs);
    for (const a of e.tempAttrs ?? []) set.add(a);
    for (const { mod } of this.staticsFor(e)) for (const a of mod.attrs ?? []) set.add(a);
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
   * trashed like any other.
   */
  toBin(seat: Seat, name: CardName, from: 'hand' | 'deck' | 'play' | 'stack' | 'cache', opts: { token?: boolean } = {}): void {
    this.player(seat).bin.push(name);
    if (from === 'stack' || opts.token) return;
    this.noteTrashed(seat, name, from);
  }

  /**
   * Fire the trash event for a card that has ALREADY been put in `seat`'s bin.
   * Split out of toBin() for the paths that must control event ORDER: destroy()
   * and recall() bin the card first but have to emit (and fire) their own
   * 'died'/'despawned' event before the trash, or the game log reads backwards.
   * Tokens must never reach here (R40; and R47's Wraith re-attaches itself as a
   * mod when it dies — a token, so no trash).
   */
  noteTrashed(seat: Seat, name: CardName, from: 'hand' | 'deck' | 'play' | 'cache'): void {
    const where = from === 'play' ? 'from play' : from === 'hand' ? 'from hand'
      : from === 'cache' ? 'from the cache' : 'from the deck';
    const region = this.actionRegion(seat);
    // per-battle trash ledger (R40: Dropslime counts every card trashed this
    // battle, Muck Rummager only your own) — battleCounters reset each battle
    // phase, so a trash outside battle deliberately counts for nothing
    if (this.s.phase === 'battle') {
      this.bumpBattleCounter(region, 'trashed');
      this.bumpBattleCounter(region, `trashed:${seat}`);
    }
    const ev = this.ev('trashed', `${this.pname(seat)} trashes ${name} (${where}).`,
      { seat, card: name, from, region });
    this.fireEvent('trashed', ev);
    this.fireOwnTrashTrigger(seat, name, region, ev);
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
   * which is right: each trashed card is its own instance. Its id is -1, so
   * `g.entity(ctx.sourceId)` correctly answers "there is no such unit".
   *
   * Only `self: true` abilities fire here. "When ANOTHER card is trashed"
   * (Muck Rummager) belongs to a unit in play and the normal scan dispatches
   * it — which also gives R40's "excludes the trigger source itself" for free.
   */
  private fireOwnTrashTrigger(seat: Seat, name: CardName, region: number, ev: EngineEvent): void {
    const abilities = this.card(name).abilities ?? [];
    if (!abilities.length) return;
    const ghost: Entity = {
      id: -1, card: name, owner: seat, controller: seat, kind: 'unit', region,
      damage: 0, counters: 0, tempPower: 0, tempToughness: 0, mods: [], budgets: {},
    };
    let queued = false;
    abilities.forEach((ability, idx) => {
      if (!isTriggered(ability) || !ability.self) return;
      if (!ability.events.includes('trashed')) return;
      if (ability.when && !ability.when(this, ghost, ev)) return;
      const parts = this.composeParts(ghost, idx, 'ability');
      if (!parts) return;
      this.s.triggerQueue.push({
        sourceId: ghost.id, sourceCard: name, controller: seat,
        abilityIndex: idx, label: `${name}: ${ability.label}`, parts, event: ev,
      });
      this.ev('triggered', `Trigger: ${name} — ${ability.label} (trashed).`, { card: name });
      queued = true;
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
    const holders: { holder: Entity; anchor: Entity }[] = [];
    for (const holder of Object.values(this.s.entities)) {
      if (!this.card(holder.card).replaceRotDamage) continue;
      let anchor: Entity | undefined;
      if (holder.kind === 'unit') anchor = holder;
      else if (holder.kind === 'mod' && holder.appliedAs === 'augment' && holder.modOf !== undefined) {
        anchor = this.entity(holder.modOf);
      }
      if (!anchor || anchor.absent || anchor.controller !== seat) continue;
      holders.push({ holder, anchor });
    }
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
   * R46: a unit in play is CACHED (Grob, Waxen Witness). The card goes to its
   * OWNER's cache; its mods do NOT travel with it — they go to their own
   * owners' bins, FROM PLAY, so wave A's R40 classification trashes every
   * nontoken one (Caleb 2024-09-15). A token has no card to cache, so it is
   * erased, exactly as recall() erases one.
   */
  cacheUnit(u: Entity, opts: { prophecy?: string; playable?: boolean } = {}): void {
    if (!this.entity(u.id)) return;
    delete this.s.entities[u.id];
    const mods = u.mods.map(id => this.entity(id)).filter((m): m is Entity => !!m);
    for (const m of mods) {
      delete this.s.entities[m.id];
      if (!m.token) this.player(m.owner).bin.push(m.card);   // R40/R47: a token mod is erased
    }
    this.removeFromFormation(u.id);
    // `counters` is on the event because 'died'/'despawned' fire once the
    // entity is already out of s.entities: a listener that wants to know what
    // the leaving unit was carrying (Entropic Entity's "a unit WITH COUNTERS
    // on it despawns") has no other way to read it.
    const evData = { unit: u.id, card: u.card, seat: u.controller, region: u.region, counters: u.counters };
    if (u.token) {
      // R47 is a DEATH carve-out ("when I die, augment me onto target ally")
      // and caching is not dying, so a cached token — Wraith included — is
      // erased here exactly as recall() erases one: there is no card to put
      // into the cache.
      this.ev('despawned', `${u.card} is cached — token: erased.`, evData);
    } else {
      this.ev('despawned',
        `${u.card} leaves play for ${this.pname(u.owner)}'s cache` +
        (mods.length ? ` (its ${mods.length} mod(s) stay behind → bin)` : '') + '.',
        evData);
    }
    const ev = this.events[this.events.length - 1]!;
    this.fireEvent('despawned', ev, u);
    // R40, after the despawn so the log reads in order: the mods entered a bin
    // from play, so every nontoken one is trashed by its owner
    for (const m of mods) if (!m.token) this.noteTrashed(m.owner, m.card, 'play');
    if (!u.token) this.cacheCard(u.owner, u.card, 'play', opts);
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

  /** Affordability ignoring AFFINITY but not mana — what "for free ignores
   * affinity" (R42) and glimpse's "ignoring affinity" (R45) both need. */
  canPayManaOnly(seat: Seat, name: CardName): boolean {
    const c = this.card(name);
    return this.openMana(seat) >= (c.mana === 'X' ? (c.xMin ?? 0) : c.mana);
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

  spawnUnit(seat: Seat, name: CardName, region: number, opts: { token?: boolean; tokenStats?: [number, number]; counters?: number; from?: 'hand' | 'cache' | 'bin' } = {}): Entity {
    const u = this.newEntity({
      card: name, owner: seat, controller: seat, kind: 'unit', region,
      ...(opts.token ? { token: true, tokenStats: opts.tokenStats } : {}),
    });
    // "I spawn with X counters" (Robot): counters are on before the spawn event
    if (opts.counters) u.counters = opts.counters;
    // R49: `from` is set only when this spawn IS a card being PLAYED out of a
    // zone (resolveItem for a unit / spell unit card). A unit created by an
    // effect carries no zone, which is what keeps "when you play a card from
    // anywhere other than your hand" (Proph) off effect-created units.
    const ev = this.ev('spawned', `${this.pname(seat)} spawns ${name}${opts.counters ? ` (${opts.counters} +1/+1)` : ''}.`,
      { seat, unit: u.id, region, card: name, ...(opts.from ? { from: opts.from } : {}) });
    this.fireEvent('spawned', ev);
    return u;
  }

  // ── the Wraith token (R47) ───────────────────────────────────────────
  //
  // "Wight — 0 mana, 4/4, Blight Zombie Token Unit. [Augment] When I attack or
  // block, put a -1/-1 counter on me. When I die, augment me onto target ally."
  // A free 4/4 that shrinks every time it fights and then re-attaches itself
  // as an augment when it finally dies. The token card was renamed from
  // "Wraith"; the printed data is mid-transition (Blight's End already says
  // the retired "Wight", six other cards say the current "Wraith"), so `Wight`
  // is registered as an ALIAS of `Wraith` — both names, one card, one token.
  //
  // Two entry points, deliberately: "CREATE a Wraith" spawns the body,
  // "AUGMENT a Wraith onto a unit" creates the same token directly as a mod.

  /** the canonical token name; "Wraith" resolves here through the alias */
  static readonly WRAITH: CardName = 'Wraith';

  /** "Create a Wraith" — the 4/4 body, as a unit token. */
  createWraith(seat: Seat, region?: number): Entity {
    return this.spawnUnit(seat, E.WRAITH, region ?? this.actionRegion(seat), { token: true });
  }

  /** "Augment a Wraith onto a unit" — the SAME token, applied rather than
   * spawned. The mod is itself a token, so it is erased (never binned, never
   * trashed) when it leaves play. */
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
   */
  setBase(target: Entity, p: number, t: number): void {
    target.baseSet = [p, t];
    this.ev('statChanged', `${target.card}'s base becomes ${p}/${t} until regroup.`,
      { unit: target.id, baseP: p, baseT: t });
  }

  /** grant an attribute until regroup (cleared with temp stats, R11 step 3) */
  addTempAttr(target: Entity, attr: import('./types.ts').Attr): void {
    (target.tempAttrs ??= []).push(attr);
    this.ev('statChanged', `${target.card} gains {${attr}} until regroup.`, { unit: target.id, attr });
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
      this.ev('gameOver', `*** ${this.pname(other(seat))} wins! ***`, { winner: other(seat) });
      throw new GameEnded();
    }
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
    const holders: { holder: Entity; anchor: Entity }[] = [];
    for (const holder of Object.values(this.s.entities)) {
      if (!this.card(holder.card).replaceCombatDamageToPlayer) continue;
      let anchor: Entity | undefined;
      if (holder.kind === 'unit') anchor = holder;
      else if (holder.kind === 'mod' && holder.appliedAs === 'augment' && holder.modOf !== undefined) {
        anchor = this.entity(holder.modOf);
      }
      if (!anchor || anchor.absent || anchor.region !== info.region) continue;
      holders.push({ holder, anchor });
    }
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
   * Effect (non-combat) damage. Handles Reaping (kill → draw) and Electric
   * (R4: excess beyond lethal passes along a controller-chosen, non-overlapping
   * adjacent path, atomically — planned fully before any damage commits, and
   * no formation changes during distribution).
   */
  dealEffectDamage(ctx: EffectCtx, target: ResolvedTarget, n: number): void {
    if (n <= 0) return;
    const srcAttrs = new Set(this.card(ctx.sourceName)?.attrs ?? []);
    const poisonous = srcAttrs.has('Poisonous');
    const resonant = srcAttrs.has('Resonant');
    // Powerful source: double the damage dealt (to units and players alike),
    // once, before Electric distribution or Vulnerable's receive-side doubling.
    if (srcAttrs.has('Powerful')) n *= 2;
    if ('player' in (target as object)) {
      const seat = (target as { player: Seat }).player;
      // spell-effect damage to a PLAYER is still damage: emit a 'damage' event
      // (with the effect's controller, R33) so triggers hear face hits too.
      // Fired before loseLife — a lethal hit ends the game mid-throw and the
      // queued trigger is moot. Combat face damage does NOT come through here
      // (pumpCombatDamage → loseLife directly) and stays trigger-silent.
      const ev = this.ev('damage', `${ctx.sourceName} deals ${n} to ${this.pname(seat)}.`,
        { player: seat, n, source: ctx.sourceName, controller: ctx.controller, region: ctx.region });
      this.fireEvent('damage', ev);
      // R48 {Blessed}: the gain lands on the SAME game-state check as the
      // damage, so it is committed here — before loseLife runs the lethal
      // check. A blessed source therefore cannot kill its own controller.
      if (srcAttrs.has('Blessed')) this.blessedGain(ctx.controller, n, ctx.sourceName);
      this.loseLife(seat, n, ctx.sourceName);
      return;
    }
    const first = target as Entity;
    if (!this.entity(first.id)) return;

    const plan: [Entity, number][] = [];
    if (!srcAttrs.has('Electric')) {
      plan.push([first, n]);
    } else {
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
        const lethal = Math.max(0, t - victim.damage);
        if (remaining <= lethal) { plan.push([victim, remaining]); break; }
        plan.push([victim, lethal]);
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
    // commit — Vulnerable victim doubles what it receives; Poisonous deals the
    // damage as permanent -1/-1 counters instead of marked damage; Resonant
    // also deals the same amount to the damaged unit's controller.
    const killed: Entity[] = [];
    for (const [u, dmg0] of plan) {
      if (dmg0 <= 0 || !this.entity(u.id)) continue;
      const received = this.effAttrs(u).has('Vulnerable') ? dmg0 * 2 : dmg0;
      // R48 {Blessed}: what the victim RECEIVES is what the source dealt (a
      // Vulnerable victim really is dealt double), and it is gained on the
      // same check — before Resonant's life loss below can end the game.
      if (srcAttrs.has('Blessed')) this.blessedGain(ctx.controller, received, ctx.sourceName);
      if (poisonous) {
        this.ev('info', `Poisonous: ${ctx.sourceName} deals ${received} to ${u.card} as -1/-1 counter(s).`);
        this.addCounters(u, -received);   // permanent counters; addCounters runs checkDeaths
        if (!this.entity(u.id)) killed.push(u);
      } else {
        u.damage += received;
        const ev = this.ev('damage', `${ctx.sourceName} deals ${received} to ${u.card}.`,
          { unit: u.id, n: received, source: ctx.sourceName, controller: ctx.controller });
        this.fireEvent('damage', ev);   // "when I am dealt damage" (Awoken Tomb)
        const [, t] = this.effStats(u);
        // R21: Deadly — any nonzero damage kills, regardless of toughness
        if (u.damage >= t || srcAttrs.has('Deadly')) killed.push(u);
      }
      if (resonant) this.loseLife(u.controller, received, `${ctx.sourceName} (Resonant)`);
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

  /** orthogonal formation adjacency: front/back within a column + same row in
   * a horizontally adjacent column (attackers and blockers are separate grids) */
  adjacentInFormation(id: EntityId): Entity[] {
    const b = this.s.battle;
    if (!b) return [];
    const grids: EntityId[][][] = [
      b.columns,
      // blocking columns keyed by attacked column index; consecutive keys are adjacent
      Object.keys(b.blocks).sort((a, z) => Number(a) - Number(z)).map(k => b.blocks[Number(k)]!),
    ];
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

  checkDeaths(): Entity[] {
    const dead: Entity[] = [];
    for (const u of Object.values(this.s.entities)) {
      if (u.kind !== 'unit') continue;
      const [, t] = this.effStats(u);
      if (t <= 0 || u.damage >= t) dead.push(u);
    }
    for (const u of dead) this.destroy(u, 'dies');
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
   * Nothyr, Murkstalker). Only the third branch below bins anything, so
   * `binTo` is silently irrelevant for a token or an Unstable modded unit —
   * both are erased and neither ever reaches a bin.
   */
  destroy(u: Entity, verb: 'dies' | 'is deleted' | 'is sacrificed',
    opts: { binTo?: Seat } = {}): void {
    if (!this.entity(u.id)) return;
    delete this.s.entities[u.id];
    const mods = u.mods.map(id => this.entity(id)).filter((m): m is Entity => !!m);
    // `counters` is on the event because 'died'/'despawned' fire once the
    // entity is already out of s.entities: a listener that wants to know what
    // the leaving unit was carrying (Entropic Entity's "a unit WITH COUNTERS
    // on it despawns") has no other way to read it.
    const evData = { unit: u.id, card: u.card, seat: u.controller, region: u.region, counters: u.counters };
    // R40: only the third branch puts a card in a bin, and it comes from play,
    // so only that one trashes — a token is erased and an Unstable modded card
    // is erased too, and erasing never touches a bin. The trash event is fired
    // AFTER the death below so the log reads "X dies → bin" then "…trashes X".
    let trashedTo: Seat | null = null;
    if (u.token) {
      // R47: a token normally ceases to exist right here. The Wraith is the
      // carve-out — it carries its own "when I die, augment me onto target
      // ally" trigger, which fires below (the dying unit is in the listener
      // list) and puts the same token back as an augment mod on a chosen ally.
      // It only really ceases to exist when that trigger finds no legal ally.
      // Nothing else changes: a token still never reaches a bin, so a dying
      // Wraith is still not a trash (R40).
      const reattaches = (this.card(u.card).abilities ?? []).some(a =>
        isTriggered(a) && a.self && a.events.includes('died'));
      this.ev('died', reattaches
        ? `${u.card} ${verb} — token: its own death trigger decides what becomes of it.`
        : `${u.card} ${verb} — token: erased.`, evData);
    } else if (mods.length) {
      // Unstable: a modded card dies → it and its mods are erased, not binned
      this.ev('died', `${u.card} ${verb} — Unstable: it and its ${mods.length} mod(s) are ERASED.`, evData);
    } else {
      const binSeat = opts.binTo ?? u.owner;
      this.player(binSeat).bin.push(u.card);
      this.ev('died', `${u.card} ${verb} → ${binSeat === u.owner ? 'bin' : `${this.pname(binSeat)}'s bin`}.`, evData);
      trashedTo = binSeat;   // R40: the trasher is the owner of the bin it entered
    }
    // formation cleanup + back-row promotion (state-based, no response window)
    this.removeFromFormation(u.id);
    if (this.s.phase === 'battle') {
      this.bumpBattleCounter(u.region, `allyDeaths:${u.controller}`);
    }
    // fire the death BEFORE erasing the mod entities: the dying unit's mods
    // still count as sources of donated "[Augment] when I die" text (the
    // fireEvent mod scan resolves u.mods through the entity table)
    const evDied = this.events[this.events.length - 1]!;
    this.fireEvent('died', evDied, u);
    if (trashedTo !== null) this.noteTrashed(trashedTo, u.card, 'play');   // R40
    for (const m of mods) delete this.s.entities[m.id];
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
  }

  /** Recall: the unit leaves play WITHOUT dying (Manual: to its owner's hand;
   * mods go to their owners' bins; a token is erased instead). */
  recall(u: Entity): void {
    if (!this.entity(u.id)) return;
    delete this.s.entities[u.id];
    const mods = u.mods.map(id => this.entity(id)).filter((m): m is Entity => !!m);
    for (const m of mods) {
      delete this.s.entities[m.id];
      if (!m.token) this.player(m.owner).bin.push(m.card);   // R40/R47: a token mod is erased
    }
    this.removeFromFormation(u.id);
    // R40: the recalled card goes to HAND (or is erased if a token) — never a
    // trash. Its mods do enter a bin, from play, so a nontoken mod IS trashed
    // by its owner; fired below, after the despawn event, for log order.
    const trashedMods = mods.filter(m => !m.token);
    if (u.token) {
      this.ev('despawned', `${u.card} is recalled — token: erased.`,
        { unit: u.id, card: u.card, seat: u.controller, region: u.region, counters: u.counters });
    } else {
      this.player(u.owner).hand.push(u.card);
      this.ev('despawned',
        `${u.card} is recalled to ${this.pname(u.owner)}'s hand${mods.length ? ` (its ${mods.length} mod(s) → bin)` : ''}.`,
        { unit: u.id, card: u.card, seat: u.controller, region: u.region, counters: u.counters });
    }
    const ev = this.events[this.events.length - 1]!;
    this.fireEvent('despawned', ev, u);
    for (const m of trashedMods) this.noteTrashed(m.owner, m.card, 'play');
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
  targetCandidates(spec: TargetSpec, region: number, excludeStackId?: number, ally?: Seat): TargetRef[] {
    const out: TargetRef[] = [];
    if (spec.what === 'unit' || spec.what === 'any' || spec.what === 'allyUnit') {
      for (const u of this.unitsIn(region)) {
        if (spec.what === 'allyUnit' && u.controller !== ally) continue;
        out.push({ unit: u.id });
      }
    }
    if (spec.what === 'any') {
      for (const seat of this.s.regions[region]!.presentSeats) out.push({ player: seat });
    }
    if (spec.what === 'stackSpell') {
      for (const it of this.s.stack) {
        if (it.id === excludeStackId || it.negated) continue;
        // an ambush is a played card's effect on the stack — negatable (R22)
        if (it.kind === 'spell' || it.kind === 'spellUnit' || it.kind === 'spellToken' || it.kind === 'ambush') out.push({ stack: it.id });
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
      specForSlot(def.targets, ti), item.region, item.id, item.controller);
    return cands.some(c => JSON.stringify(c) === key);
  }
  targetLabel(t: TargetRef): string {
    if ('unit' in t) return this.entity(t.unit)?.card ?? '(gone)';
    if ('player' in t) return this.pname(t.player);
    if ('cached' in t) {
      const i = this.cacheIndexOf(t.cached.seat, t.cached.uid);
      return i === -1 ? '(gone)' : `${this.cache(t.cached.seat)[i]!.card} (${this.pname(t.cached.seat)}'s cache)`;
    }
    return this.s.stack.find(i => i.id === t.stack)?.label ?? '(gone)';
  }
  targetStillLegal(t: TargetRef): boolean {
    if ('unit' in t) { const u = this.entity(t.unit); return !!u && !u.absent; }
    if ('player' in t) return true;
    // the entry may have been played, grafted or recalled out of the cache
    // between cast and resolution — then it is simply gone (R5 fizzle)
    if ('cached' in t) return this.cacheIndexOf(t.cached.seat, t.cached.uid) !== -1;
    return this.s.stack.some(i => i.id === t.stack && !i.negated);
  }
  resolveTargetRef(t: TargetRef): ResolvedTarget | null {
    if (!this.targetStillLegal(t)) return null;
    if ('unit' in t) return this.entity(t.unit)!;
    if ('cached' in t) {
      const cc = this.cache(t.cached.seat)[this.cacheIndexOf(t.cached.seat, t.cached.uid)]!;
      return { cached: { seat: t.cached.seat, uid: t.cached.uid, card: cc.card } };
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

  negate(stackId: number): void {
    const it = this.s.stack.find(i => i.id === stackId);
    if (it && !it.negated) {
      it.negated = true;
      this.ev('negated', `${it.label} is negated.`, { id: it.id });
    }
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
        if (!isGraftable(name) || !this.canPayCard(seat, name)) return;
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
    this.need(this.canPayCard(seat, name), 'cannot pay for that mod');
    zone.splice(index, 1);
    this.payCard(seat, name);
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
   */
  canPayCastCost(seat: Seat, cost: CastCost, region: number, handReserve = 0): boolean {
    switch (cost.kind) {
      case 'sacrificeUnit': return this.unitsOf(seat, region).length > 0;
      case 'payLife': return this.canPayLife(seat, cost.n);
      case 'discardCard': return this.player(seat).hand.length - handReserve >= cost.n;
      case 'gainDebt': return true;   // debt is always takeable (R39)
    }
  }

  /** the receipt key a CastCost kind lands in — its presence means "already
   * paid", which is what makes the collector idempotent across a replay */
  private costSettled(part: EffectPart, cost: CastCost): boolean {
    const paid = part.costPaid;
    if (!paid) return false;
    switch (cost.kind) {
      case 'sacrificeUnit': return paid.sacrificed !== undefined;
      case 'payLife': return paid.life !== undefined;
      case 'gainDebt': return paid.debt !== undefined;
      case 'discardCard': return (paid.discarded?.length ?? 0) >= cost.n;
    }
  }

  /**
   * Cast-time bracketed costs (R35): every part whose effect declares a
   * castCost gets it chosen and PAID here, before the item reaches the stack.
   * Spell parts must pay (castability already required a payable cost); graft
   * parts riding a composite may decline — the rider is then skipped. An
   * unpayable cost skips the part the same way.
   *
   * Costs that carry no choice (pay life, gain debt) are simply charged here;
   * costs that do (sacrifice a unit, discard a card) suspend via 'cast'/'cost'
   * once per card/unit still owed. Every branch is guarded by the receipt, so
   * a resumed cast never pays twice.
   */
  private collectCastCosts(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[]): void {
    for (let pi = 0; pi < item.parts.length; pi++) {
      const part = item.parts[pi]!;
      if (part.spent) continue;
      const def = effectByKey(part.effectKey);
      const cost = def.castCost;
      if (!cost) continue;
      if (this.costSettled(part, cost)) continue;
      const seat = item.controller;
      // grafted riders are opt-in; the spell's own cost is part of casting it
      const optional = part.effectKey.startsWith('graft:');
      // a MULTI-card cost is paid one card at a time, so payability has to be
      // asked about what is still OWED, not about the printed total — else the
      // second discard of a "[Discard 2 cards]" looks unpayable and the whole
      // part is wrongly skipped after the first card is already gone
      const owed: CastCost = cost.kind === 'discardCard'
        ? { kind: 'discardCard', n: cost.n - (part.costPaid?.discarded?.length ?? 0) }
        : cost;
      if (!this.canPayCastCost(seat, owed, item.region)) {
        part.spent = true;   // unpayable: the part never resolves
        this.ev('info', `${item.label}: the [${this.castCostLabel(cost)}] cost cannot be paid — that effect is skipped.`);
        continue;
      }
      // choice-free costs: charged on the spot, no decision to ask for. A
      // grafted rider is still opt-in, so it goes through the decision path.
      if (!optional && (cost.kind === 'payLife' || cost.kind === 'gainDebt')) {
        this.chargeCastCost(item, part, cost);
        continue;
      }
      const options: DecisionOption[] = this.castCostOptions(item, part, cost);
      if (optional) options.push({ label: "Don't pay — skip this effect", value: { declineCost: true } });
      this.suspend(
        { type: 'cast', stage: 'cost', item, partIndex: pi, targetIndex: 0, then, moreItems },
        {
          seat, kind: 'targets',
          prompt: `${item.label}: ${this.castCostLabel(cost)} (additional cost${optional ? ' — optional' : ''})`,
          options,
        },
      );
    }
  }

  /** human-readable form of a bracketed cost, for prompts and the log */
  castCostLabel(cost: CastCost): string {
    switch (cost.kind) {
      case 'sacrificeUnit': return 'sacrifice a unit';
      case 'payLife': return `pay ${cost.n} life`;
      case 'discardCard': return `discard ${cost.n === 1 ? 'a card' : `${cost.n} cards`}`;
      case 'gainDebt': return `gain ${cost.n} debt`;
    }
  }

  /** the choices a bracketed cost offers (empty for the choice-free kinds,
   * which then present a single "pay it" option on the optional-rider path) */
  private castCostOptions(item: StackItem, part: EffectPart, cost: CastCost): DecisionOption[] {
    const seat = item.controller;
    if (cost.kind === 'sacrificeUnit') {
      return this.unitsOf(seat, item.region).map(u => ({ label: u.card, value: { unit: u.id }, card: u.card }));
    }
    if (cost.kind === 'discardCard') {
      const already = part.costPaid?.discarded?.length ?? 0;
      return this.player(seat).hand.map((n, i) => ({
        label: `${n}${cost.n > 1 ? ` (${already + 1} of ${cost.n})` : ''}`, value: { discard: i }, card: n,
      }));
    }
    return [{ label: `Pay: ${this.castCostLabel(cost)}`, value: { payCost: true } }];
  }

  /** charge a choice-free bracketed cost and write its receipt */
  private chargeCastCost(item: StackItem, part: EffectPart, cost: CastCost): void {
    const seat = item.controller;
    const paid = (part.costPaid ??= {});
    if (cost.kind === 'payLife') {
      paid.life = cost.n;
      this.ev('info', `${this.pname(seat)} pays ${cost.n} life — the cost of ${item.label}.`);
      this.loseLife(seat, cost.n, `${item.label} (cost)`);
    } else if (cost.kind === 'gainDebt') {
      paid.debt = cost.n;
      this.ev('info', `${this.pname(seat)} gains ${cost.n} debt — the cost of ${item.label}.`);
      this.gainDebt(seat, cost.n);
    }
  }

  /** Pay a chosen cast-time cost (R35): a COST, not an effect — paid before
   * the item hits the stack, not respondable. The receipt (with the victim's
   * stats snapshotted now) lands on the part for resolution to read. */
  payCastCost(item: StackItem, partIndex: number, val: unknown): void {
    const part = item.parts[partIndex]!;
    if (val !== null && typeof val === 'object' && 'declineCost' in val) {
      part.spent = true;
      this.ev('info', `${item.label}: the [cost] is declined — that effect is skipped.`);
      return;
    }
    const cost = effectByKey(part.effectKey).castCost!;
    if (val !== null && typeof val === 'object' && 'payCost' in val) {
      this.chargeCastCost(item, part, cost);
      return;
    }
    if (cost.kind === 'discardCard') {
      const idx = (val as { discard: number }).discard;
      const name = this.player(item.controller).hand[idx];
      this.need(name !== undefined, 'bad cost choice');
      const paid = (part.costPaid ??= {});
      (paid.discarded ??= []).push(name!);
      this.ev('info', `${this.pname(item.controller)} discards ${name} — the cost of ${item.label}.`);
      this.discardFromHand(item.controller, idx);
      return;
    }
    const id = (val as { unit: EntityId }).unit;
    const u = this.entity(id);
    this.need(u && u.kind === 'unit' && u.controller === item.controller && !u.absent
      && u.region === item.region, 'bad cost choice');
    const [p, t] = this.effStats(u);
    (part.costPaid ??= {}).sacrificed = { card: u.card, power: p, defense: t };
    this.ev('info', `${this.pname(item.controller)} sacrifices ${u.card} — the cost of ${item.label}.`);
    this.destroy(u, 'is sacrificed');
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
    // {Modular} before the costs and the targets: an applied mod adds a part,
    // and that part has its own [cost] and its own targets to collect
    // (Manual p.33 — the composite resolves as ONE ability)
    this.collectModular(item, then, moreItems);
    this.collectPartTargets(item, then, moreItems);
    this.payActivationCost(item);                   // R57: choice-free half
    this.collectItemCosts(item, then, moreItems);   // R49: the choice-bearing half
    this.collectCastCosts(item, then, moreItems);
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
      const max = def.targets.count ?? 1;
      const min = Math.min(def.targets.min ?? 1, max);
      while (!part.targetsDone && part.targets.length < max) {
        const n = part.targets.length;
        // R58: each slot may carry its own restriction (Fight: ally, then any
        // other unit), so candidates are computed per slot rather than once.
        const slot = specForSlot(def.targets, n);
        const chosen = new Set(part.targets.map(t => JSON.stringify(t)));
        const cands = this.targetCandidates(slot, item.region, item.id, item.controller)
          .filter(c => !chosen.has(JSON.stringify(c)));
        if (!cands.length) break;         // composite part with nothing to aim at: skipped at resolution
        const options: { label: string; value: unknown }[] =
          cands.map(c => ({ label: this.targetLabel(c), value: c }));
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
    if (then === 'push') this.pushItem(item);
    else { this.resolveItem(item); this.settle(); }
  }

  resolveTop(): void {
    const item = this.s.stack.pop()!;
    this.resolveItem(item);
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

  resolveItem(item: StackItem): void {
    if (item.negated) {
      const to = item.kind === 'spellToken' || item.kind === 'triggered' || item.kind === 'activated'
        ? '' : ' → bin';
      this.ev('resolved', `${item.label} was negated${to}.`, { id: item.id });
      if (item.card && (item.kind === 'spell' || item.kind === 'spellUnit' || item.kind === 'virus' || item.kind === 'ambush')) {
        // R40: from the stack — negating a spell is NOT trashing it
        this.toBin(item.controller, item.card, 'stack');
        this.binItemMods(item);   // {Modular}: its mods leave with it
      }
      return;
    }
    if (item.kind === 'unit') {
      this.spawnUnit(item.controller, item.card!, item.region, { ...(item.from ? { from: item.from } : {}) });
      return;
    }
    if (item.kind === 'virus') {
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
      if (item.card && (item.kind === 'spell' || item.kind === 'spellUnit' || item.kind === 'ambush')) {
        // a fizzled spell unit never spawns; a fizzled ambusher is binned too
        // ("you could find yourself losing both units" — Manual p.40).
        // R40: still the stack, so still not a trash.
        this.toBin(item.controller, item.card, 'stack');
        this.binItemMods(item);   // {Modular}: its mods leave with it
      }
      return;
    }
    this.ev('resolved', `${item.label} resolves.`, { id: item.id });
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
   * duration of one `def.run`, keyed per part so two parts of one composite can
   * never collide in the shared `answers` map, and per call so a helper invoked
   * twice in one part asks two distinct questions. Both counters are rebuilt
   * from scratch on a suspension replay, so the keys are deterministic.
   *
   * Not part of GameState: it lives only inside a synchronous `def.run`, and a
   * suspension rolls the state back and replays the part from its start.
   */
  private partChoose: ((tag: string, dec: PartChoice['dec']) => unknown) | null = null;

  /** Run parts [from..]; the composite is ONE ability resolving top-to-bottom.
   * Suspending parts roll back to their boundary and replay with answers. */
  resolveParts(item: StackItem, from: number, answers: Record<string, unknown>): void {
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
        x: item.x,
        costPaid: part.costPaid,
        ...(part.mods ? { mods: part.mods } : {}),
        event: item.event ?? null,
        choose: (key, dec) => {
          if (key in answers) return answers[key];
          throw new PartChoice(key, { ...dec, options: dec.options });
        },
      };
      // R48 {Afflicting}: snapshot the units in play, so the kills this part
      // makes — by damage, by -1/-1 counters, by anything — can be diffed out
      // once it has finished. Discarded on a suspension rollback and retaken
      // when the part replays.
      const afflicting = this.itemAttrs(item).has('Afflicting');
      const beforeUnits = afflicting ? this.snapshotUnits() : null;
      const snap = structuredClone(this.s);
      const evLen = this.events.length;
      const outerChoose = this.partChoose;
      let helperSeq = 0;
      this.partChoose = (tag, dec) => ctx.choose(`${tag}#${pi}#${helperSeq++}`, dec);
      try {
        def.run(this, ctx);
      } catch (sig) {
        if (sig instanceof PartChoice) {
          this.s = snap;
          this.events.length = evLen;
          this.suspend(
            { type: 'resolve', item, partIndex: pi, answers, pendingKey: sig.key },
            { seat: sig.dec.seat, kind: sig.dec.kind, prompt: sig.dec.prompt, options: sig.dec.options },
          );
        }
        throw sig;
      } finally {
        this.partChoose = outerChoose;
      }
      this.checkDeaths();   // sequential within the composite; triggers wait for settle()
      if (beforeUnits) this.afflictingKills(beforeUnits, item.card ?? item.label);
    }
  }

  /** The attributes of a stack item's SOURCE: the source entity's live attrs
   * while it is still in play (so granted ones count), otherwise the printed
   * card's. Used by the resolution-time attribute checks ({Afflicting}). */
  itemAttrs(item: StackItem): Set<string> {
    const src = item.sourceId !== undefined ? this.entity(item.sourceId) : undefined;
    if (src) return this.ownAttrs(src);
    return new Set<string>(item.card ? this.card(item.card).attrs : []);
  }

  afterParts(item: StackItem): void {
    if (item.kind === 'spellUnit') this.spawnUnit(item.controller, item.card!, item.region, { ...(item.from ? { from: item.from } : {}) });
    // R40: a resolved spell goes to the bin FROM THE STACK — explicitly not a trash
    else if (item.kind === 'spell') this.toBin(item.controller, item.card!, 'stack');
    // spellToken: already out of play; triggered/activated: nothing to move
    this.binItemMods(item);   // {Modular}: its mods leave with it, also from the stack
  }

  // ── suspensions & decisions ─────────────────────────────────────────
  suspend(susp: Suspension, dec: Omit<Decision, 'id'>): never {
    this.s.suspension = susp;
    this.s.decision = { ...dec, id: this.s.nextId++ };
    throw new Suspended();
  }

  // ── mods ────────────────────────────────────────────────────────────
  /** opts.token (R47): the mod IS a token — the Wraith augmented onto a unit is
   * the same token card, applied rather than spawned. A token mod is erased
   * when it leaves play instead of being binned (a token never reaches a bin,
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
        const region = this.actionRegion(seat);
        const ghost: Entity = {
          id: -1, card: name, owner: seat, controller: seat, kind: 'unit', region,
          damage: 0, counters: 0, tempPower: 0, tempToughness: 0, mods: [], budgets: {},
        };
        if (ability.when && !ability.when(this, ghost, ev)) continue;
        const parts = this.composeParts(ghost, abilityIndex, 'ability');
        if (!parts) continue;
        this.s.triggerQueue.push({
          sourceId: ghost.id, sourceCard: name, controller: seat,
          abilityIndex, label: `${name}: ${ability.label}`, parts, event: ev,
        });
        this.ev('triggered', `Trigger: ${name} — ${ability.label} (from ${this.pname(seat)}'s ${zone}).`, { card: name, zone });
        queued = true;
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
      if (ability.when && !ability.when(this, host, ev)) return;
      const parts = this.composeParts(host, idx, prefix, cardName);
      if (!parts) return;   // bounded and already used this turn
      this.s.triggerQueue.push({
        sourceId: host.id, sourceCard: cardName, controller: host.controller,
        abilityIndex: idx, label: `${cardName}: ${ability.label}`, parts, event: ev,
      });
      this.ev('triggered', `Trigger: ${cardName} — ${ability.label}.`, { unit: host.id });
      queued = true;
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
        controller: next.controller, region: this.entity(next.sourceId)?.region ?? this.actionRegion(next.controller),
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

  private scheduled(colIds: EntityId[], sub: 'Swift' | 'normal' | 'Sluggish'): boolean {
    const attrs = this.colAttrs(colIds);
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
      src: { dealer: Seat; key: string; label: string }): number => {
      const deadly = srcAttrs.has('Deadly');
      const poisonous = srcAttrs.has('Poisonous');
      const resonant = srcAttrs.has('Resonant');
      const blessedTo = srcAttrs.has('Blessed') ? src.dealer : undefined;
      let remaining = amount;
      for (const id of ids) {
        const u = this.entity(id);
        if (!u || remaining <= 0) continue;
        const mult = this.effAttrs(u).has('Vulnerable') ? 2 : 1;
        const prev = perUnit.get(id)?.pool ?? 0;
        const [, t] = this.effStats(u);
        const recvCap = Math.max(0, t - u.damage - prev * mult);   // received still needed to kill
        let poolNeed = Math.ceil(recvCap / mult);
        if (deadly && recvCap > 0) poolNeed = 1;   // 1 pool point suffices to kill
        const a = Math.min(remaining, poolNeed);
        if (a > 0) {
          const cur = perUnit.get(id) ?? { pool: 0, poisonous, resonant };
          cur.pool += a; cur.poisonous = poisonous; cur.resonant = resonant;
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
      // attacker side
      if (atk.length && this.scheduled(atk, sub)) {
        const atkAttrs = this.colAttrs(atk);
        const pow = dealtPower(atk, atkAttrs);
        const src = { dealer: b.attacker, key: `atk:${ci}`, label: colLabel(atk) };
        let toPlayer = 0;
        if (blk.length) {
          const left = assign(blk, pow, atkAttrs, src);
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
      if (blk.length && this.scheduled(blk, sub)) {
        const blkAttrs = this.colAttrs(blk);
        const src = { dealer: b.defender, key: `blk:${ci}`, label: colLabel(blk) };
        const left = assign(atk, dealtPower(blk, blkAttrs), blkAttrs, src);
        if (blkAttrs.has('Piercing') && left > 0) {
          playerHits.push({ seat: b.attacker, amount: left, by: b.defender, attrs: blkAttrs, label: src.label });
          if (blkAttrs.has('Thieving')) thievingDraw[b.defender] = (thievingDraw[b.defender] ?? 0) + 1;
        }
      }
    });

    // commit unit damage: Vulnerable doubles received; Poisonous replaces it with
    // -1/-1 counters; Resonant riders the same amount onto the unit's controller
    for (const [id, hit] of perUnit) {
      const u = this.entity(id);
      if (!u) continue;
      const mult = this.effAttrs(u).has('Vulnerable') ? 2 : 1;
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
      p.activationsLeft = 2;
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
    }
    for (const r of this.s.regions) r.presentSeats = [r.owner];
    // (2) all damage on units is removed
    for (const e of Object.values(this.s.entities)) if (e.kind === 'unit') e.damage = 0;
    // (3) all temporary stat changes are removed (counters are NOT temporary)
    for (const e of Object.values(this.s.entities)) {
      e.tempPower = 0; e.tempToughness = 0; delete e.tempAttrs;
      delete e.baseSet;   // layer 2 is an until-regroup rewrite too
    }
    // (4) units leave formation — battle state is already gone
    // (+) spell tokens are erased
    for (const e of Object.values(this.s.entities)) {
      if (e.kind === 'spellToken') delete this.s.entities[e.id];
    }
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
