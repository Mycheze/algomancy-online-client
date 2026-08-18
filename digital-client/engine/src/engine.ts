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
  Action, BattleState, CardName, Decision, DecisionOption, EffectPart, EngineEvent,
  Entity, EntityId, EventType, GameState, PendingTrigger, ResourceKind, Seat,
  StackItem, Suspension, TargetRef,
} from './types.ts';
import {
  affinityPips, effectByKey, getCard, graftCauseIndex, isGraftable, isTriggered,
  type Ability, type CardDef, type EffectCtx, type EffectDef, type ResolvedTarget,
  type TargetSpec, type TriggeredAbility,
} from './cards/dsl.ts';
import { rngNext, rngShuffle } from './rng.ts';

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
      e.kind === 'spellToken' && e.controller === seat &&
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
  openMana(seat: Seat): number {
    return this.player(seat).resources.filter(r => r.state === 'open').length;
  }
  canPayCard(seat: Seat, name: CardName): boolean {
    const c = this.card(name);
    const mana = c.mana === 'X' ? 0 : c.mana;
    if (this.openMana(seat) < mana) return false;
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
  }
  payCard(seat: Seat, name: CardName): void {
    const c = this.card(name);
    this.payMana(seat, c.mana === 'X' ? 0 : c.mana);
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
        if (!anchor || anchor.region !== target.region) continue;
        for (const mod of this.card(holder.card).statics ?? []) {
          if (mod.affects(this, anchor, target)) out.push({ holder: anchor, mod });
        }
      }
    } finally { this.inStatics = false; }
    return out;
  }

  effStats(e: Entity): [number, number] {
    const c = this.card(e.card);
    const base = e.tokenStats ?? [c.power, c.toughness];       // layer 1 (+2 base-set later)
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
  draw(seat: Seat, n: number, silent = false): void {
    let got = 0;
    for (let i = 0; i < n; i++) {
      const c = this.s.sharedDeck.shift();
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
  recycleToBottom(name: CardName): void {
    this.s.sharedDeck.push(name);
  }

  // ── units, tokens, damage, death ────────────────────────────────────
  private newEntity(partial: Omit<Entity, 'id' | 'damage' | 'counters' | 'tempPower' | 'tempToughness' | 'mods' | 'budgets'>): Entity {
    const e: Entity = {
      id: this.s.nextId++, damage: 0, counters: 0, tempPower: 0, tempToughness: 0,
      mods: [], budgets: {}, ...partial,
    };
    this.s.entities[e.id] = e;
    return e;
  }

  spawnUnit(seat: Seat, name: CardName, region: number, opts: { token?: boolean; tokenStats?: [number, number]; counters?: number } = {}): Entity {
    const u = this.newEntity({
      card: name, owner: seat, controller: seat, kind: 'unit', region,
      ...(opts.token ? { token: true, tokenStats: opts.tokenStats } : {}),
    });
    // "I spawn with X counters" (Robot): counters are on before the spawn event
    if (opts.counters) u.counters = opts.counters;
    const ev = this.ev('spawned', `${this.pname(seat)} spawns ${name}${opts.counters ? ` (${opts.counters} +1/+1)` : ''}.`, { seat, unit: u.id, region, card: name });
    this.fireEvent('spawned', ev);
    return u;
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

  /** grant an attribute until regroup (cleared with temp stats, R11 step 3) */
  addTempAttr(target: Entity, attr: import('./types.ts').Attr): void {
    (target.tempAttrs ??= []).push(attr);
    this.ev('statChanged', `${target.card} gains {${attr}} until regroup.`, { unit: target.id, attr });
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
      this.loseLife((target as { player: Seat }).player, n, ctx.sourceName);
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
      if (poisonous) {
        this.ev('info', `Poisonous: ${ctx.sourceName} deals ${received} to ${u.card} as -1/-1 counter(s).`);
        this.addCounters(u, -received);   // permanent counters; addCounters runs checkDeaths
        if (!this.entity(u.id)) killed.push(u);
      } else {
        u.damage += received;
        const ev = this.ev('damage', `${ctx.sourceName} deals ${received} to ${u.card}.`, { unit: u.id, n: received, source: ctx.sourceName });
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

  destroy(u: Entity, verb: 'dies' | 'is deleted' | 'is sacrificed'): void {
    if (!this.entity(u.id)) return;
    delete this.s.entities[u.id];
    const mods = u.mods.map(id => this.entity(id)).filter((m): m is Entity => !!m);
    const evData = { unit: u.id, card: u.card, seat: u.controller, region: u.region };
    if (u.token) {
      this.ev('died', `${u.card} ${verb} — token: erased.`, evData);
    } else if (mods.length) {
      // Unstable: a modded card dies → it and its mods are erased, not binned
      this.ev('died', `${u.card} ${verb} — Unstable: it and its ${mods.length} mod(s) are ERASED.`, evData);
    } else {
      this.player(u.owner).bin.push(u.card);
      this.ev('died', `${u.card} ${verb} → bin.`, evData);
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
      this.player(m.owner).bin.push(m.card);
    }
    this.removeFromFormation(u.id);
    if (u.token) {
      this.ev('despawned', `${u.card} is recalled — token: erased.`, { unit: u.id, card: u.card, seat: u.controller, region: u.region });
    } else {
      this.player(u.owner).hand.push(u.card);
      this.ev('despawned',
        `${u.card} is recalled to ${this.pname(u.owner)}'s hand${mods.length ? ` (its ${mods.length} mod(s) → bin)` : ''}.`,
        { unit: u.id, card: u.card, seat: u.controller, region: u.region });
    }
    const ev = this.events[this.events.length - 1]!;
    this.fireEvent('despawned', ev, u);
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
    return out;
  }
  targetLabel(t: TargetRef): string {
    if ('unit' in t) return this.entity(t.unit)?.card ?? '(gone)';
    if ('player' in t) return this.pname(t.player);
    return this.s.stack.find(i => i.id === t.stack)?.label ?? '(gone)';
  }
  targetStillLegal(t: TargetRef): boolean {
    if ('unit' in t) { const u = this.entity(t.unit); return !!u && !u.absent; }
    if ('player' in t) return true;
    return this.s.stack.some(i => i.id === t.stack && !i.negated);
  }
  resolveTargetRef(t: TargetRef): ResolvedTarget | null {
    if (!this.targetStillLegal(t)) return null;
    if ('unit' in t) return this.entity(t.unit)!;
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

  /** Ask for targets for every part that needs them — ALL at cast time
   * (multi-target specs included). Suspends via 'cast'. */
  collectTargets(item: StackItem, then: 'push' | 'resolve', moreItems: StackItem[]): void {
    for (let pi = 0; pi < item.parts.length; pi++) {
      const part = item.parts[pi]!;
      if (part.spent) continue;
      const def = effectByKey(part.effectKey);
      if (!def.targets) continue;
      const max = def.targets.count ?? 1;
      const min = Math.min(def.targets.min ?? 1, max);
      while (!part.targetsDone && part.targets.length < max) {
        const chosen = new Set(part.targets.map(t => JSON.stringify(t)));
        const cands = this.targetCandidates(def.targets, item.region, item.id, item.controller)
          .filter(c => !chosen.has(JSON.stringify(c)));
        if (!cands.length) break;         // composite part with nothing to aim at: skipped at resolution
        const options: { label: string; value: unknown }[] =
          cands.map(c => ({ label: this.targetLabel(c), value: c }));
        if (part.targets.length >= min) {
          options.push({ label: 'No more targets', value: { doneTargets: true } });
        }
        const n = part.targets.length;
        this.suspend(
          { type: 'cast', item, partIndex: pi, targetIndex: n, then, moreItems },
          {
            seat: item.controller, kind: 'targets',
            prompt: max > 1 ? `${def.targets.prompt} (target ${n + 1} of up to ${max})` : def.targets.prompt,
            options: options as { label: string; value: TargetRef }[],
          },
        );
      }
    }
  }

  commitItem(item: StackItem, then: 'push' | 'resolve'): void {
    // "targeted" is an event (Mohruung-style triggers; none in pool yet)
    for (const part of item.parts) {
      for (const t of part.targets) {
        if ('unit' in t) this.ev('targeted', `${item.label} targets ${this.targetLabel(t)}.`, { item: item.id, unit: t.unit });
      }
    }
    if (item.kind === 'spell' || item.kind === 'spellUnit' || item.kind === 'spellToken') {
      // "spells you've played this battle" ledger (Animated Spark's static)
      if (this.s.phase === 'battle' && item.kind !== 'spellToken') {
        this.bumpBattleCounter(item.region, `spellsPlayed:${item.controller}`);
      }
      const ev = this.ev('spellPlayed',
        `${this.pname(item.controller)} plays ${item.label}${then === 'push' ? ' → stack' : ''}.`,
        { seat: item.controller, card: item.card, token: item.kind === 'spellToken', region: item.region });
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
        this.player(item.controller).bin.push(item.card);
      }
      return;
    }
    if (item.kind === 'unit') {
      this.spawnUnit(item.controller, item.card!, item.region);
      return;
    }
    if (item.kind === 'virus') {
      const host = item.hostId !== undefined ? this.entity(item.hostId) : undefined;
      if (!host) {
        this.ev('fizzled', `${item.label} fizzles (host is gone) → bin.`, { id: item.id });
        this.player(item.controller).bin.push(item.card!);
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
      if (!part.targets.length) return false;             // wanted targets, none declared
      return part.targets.some(t => this.targetStillLegal(t));
    };
    if (!item.parts.some(partAlive)) {
      this.ev('fizzled', `${item.label} fizzles — all targets are gone.`, { id: item.id });
      if (item.card && (item.kind === 'spell' || item.kind === 'spellUnit' || item.kind === 'ambush')) {
        // a fizzled spell unit never spawns; a fizzled ambusher is binned too
        // ("you could find yourself losing both units" — Manual p.40)
        this.player(item.controller).bin.push(item.card);
      }
      return;
    }
    this.ev('resolved', `${item.label} resolves.`, { id: item.id });
    this.resolveParts(item, 0, {});
    this.afterParts(item);
  }

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
      if (def.targets && !part.targets.length) continue; // never had a target
      const ctx: EffectCtx = {
        controller: item.controller,
        sourceName: item.card ?? item.label,
        sourceId: item.sourceId,
        region: item.region,
        targets: resolved,
        x: item.x,
        event: item.event ?? null,
        choose: (key, dec) => {
          if (key in answers) return answers[key];
          throw new PartChoice(key, { ...dec, options: dec.options });
        },
      };
      const snap = structuredClone(this.s);
      const evLen = this.events.length;
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
      }
      this.checkDeaths();   // sequential within the composite; triggers wait for settle()
    }
  }

  afterParts(item: StackItem): void {
    if (item.kind === 'spellUnit') this.spawnUnit(item.controller, item.card!, item.region);
    else if (item.kind === 'spell') this.player(item.controller).bin.push(item.card!);
    // spellToken: already out of play; triggered/activated: nothing to move
  }

  // ── suspensions & decisions ─────────────────────────────────────────
  suspend(susp: Suspension, dec: Omit<Decision, 'id'>): never {
    this.s.suspension = susp;
    this.s.decision = { ...dec, id: this.s.nextId++ };
    throw new Suspended();
  }

  // ── mods ────────────────────────────────────────────────────────────
  attachMod(host: Entity, name: CardName, byPlayer: Seat, appliedAs: 'augment' | 'graft', position?: number): Entity {
    const mod = this.newEntity({
      card: name, owner: byPlayer, controller: host.controller, kind: 'mod',
      region: host.region, modOf: host.id, appliedAs,
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
    if (queued) this.s.triggerOrderedSeats = [];   // new batch: (re)ask ordering
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

  /** Drain the trigger queue. In battle, triggers become stack items (owner
   * orders their own; NIT's enter last so they resolve first — R2). Outside
   * battle they resolve immediately in the order the stack would produce. */
  processTriggerQueue(): void {
    while (this.s.triggerQueue.length) {
      // 1. per-seat ordering decisions (the chosen order = resolution order)
      for (const seat of [this.initiative, this.nit]) {
        const mine = this.s.triggerQueue.filter(t => t.controller === seat);
        if (mine.length >= 2 && !this.s.triggerOrderedSeats.includes(seat)) {
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
      if (!this.s.triggerQueue.length) {
        // resume a suspended combat-damage pump (R3 sub-step interleaving)
        if (this.s.battle?.damageStep && !this.pumping && !this.s.decision && !this.s.stack.length) {
          this.pumpCombatDamage();
        }
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
    // damage-replacement attrs (Poisonous → counters, Resonant → rider)
    const perUnit = new Map<EntityId, { pool: number; poisonous: boolean; resonant: boolean }>();
    const deadlyHit = new Set<EntityId>();   // R21: any damage from a Deadly column kills
    const playerDmg: number[] = this.s.players.map(() => 0);
    const thievingDraw: number[] = this.s.players.map(() => 0);   // draws owed to each seat
    const alive = (ids: EntityId[]) => ids.filter(id => this.entity(id));
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
    const assign = (ids: EntityId[], amount: number, srcAttrs: Set<string>): number => {
      const deadly = srcAttrs.has('Deadly');
      const poisonous = srcAttrs.has('Poisonous');
      const resonant = srcAttrs.has('Resonant');
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
          perUnit.set(id, cur);
          if (deadly) deadlyHit.add(id);
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
        let toPlayer = 0;
        if (blk.length) {
          const left = assign(blk, pow, atkAttrs);
          if (atkAttrs.has('Piercing')) toPlayer = left;
        } else if (blockedEver) {
          // blocked stays blocked: only Piercing carries through dead blockers
          if (atkAttrs.has('Piercing')) toPlayer = pow;
          else if (pow > 0) this.ev('info', `Column ${ci + 1} is blocked (blockers gone) — no damage through.`);
        } else {
          toPlayer = pow;
        }
        if (toPlayer > 0) {
          playerDmg[b.defender] = (playerDmg[b.defender] ?? 0) + toPlayer;
          if (atkAttrs.has('Thieving')) thievingDraw[b.attacker] = (thievingDraw[b.attacker] ?? 0) + 1;
        }
      }
      // blocker side
      if (blk.length && this.scheduled(blk, sub)) {
        const blkAttrs = this.colAttrs(blk);
        const left = assign(atk, dealtPower(blk, blkAttrs), blkAttrs);
        if (blkAttrs.has('Piercing') && left > 0) {
          playerDmg[b.attacker] = (playerDmg[b.attacker] ?? 0) + left;
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
    for (const seat of [this.initiative, this.nit]) {
      const n = playerDmg[seat] ?? 0;
      if (n > 0) this.loseLife(seat, n, 'combat');
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
      // p.16), and later draws go clockwise from initiative like the packs
      if (this.s.mode !== 'draft') this.draw(p.seat, 2);
    }
    if (this.s.mode === 'draft' && this.s.turn > 1) {
      for (const seat of this.dealOrder()) this.draw(seat, 2);
    }
    for (const e of Object.values(this.s.entities)) e.budgets = {};
    if (this.s.mode === 'draft') this.startDraftStep();
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
    for (const seat of this.dealOrder()) {
      this.s.packs[seat] = this.s.sharedDeck.splice(0, 10);
    }
  }

  /** Open the draft step. After each cycle of N+1 turns (N = players; 1v1:
   * turns 4, 7, …) all packs are first recycled — bottom of the deck in
   * random order — and fresh packs of 10 dealt. */
  startDraftStep(): void {
    const n = this.s.players.length;
    if (this.s.turn > 1 && (this.s.turn - 1) % (n + 1) === 0) {
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
    this.ev('draft', 'Everyone has drafted — the packs are passed on.');
  }

  /** Manual p.18: after the resource step comes the very short haste step —
   * only {Haste} cards playable, each resolving immediately (planning is not
   * interactive); ends when everyone is done. Skipped outright when no seat
   * has a legal haste play (R18). */
  startHasteStep(): void {
    const canHaste = (seat: Seat) => this.player(seat).hand.some(name => {
      const c = this.card(name);
      if (c.timing !== 'haste' || !this.canPayCard(seat, name)) return false;
      return !c.spellEffect?.targets
        || this.targetCandidates(c.spellEffect.targets, this.homeRegion(seat), undefined, seat).length > 0;
    });
    const done = this.s.players.map(p => !canHaste(p.seat));
    if (done.every(Boolean)) { this.startBattlePhase(); return; }
    this.s.hasteDone = done;
    this.ev('phase', 'Haste step: haste cards may be played.');
  }

  startBattlePhase(): void {
    this.s.hasteDone = null;
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
    for (const e of Object.values(this.s.entities)) { e.tempPower = 0; e.tempToughness = 0; delete e.tempAttrs; }
    // (4) units leave formation — battle state is already gone
    // (+) spell tokens are erased
    for (const e of Object.values(this.s.entities)) {
      if (e.kind === 'spellToken') delete this.s.entities[e.id];
    }
    this.startDeployment();
  }

  startDeployment(): void {
    this.s.phase = 'deploy';
    this.s.deployDone = this.s.players.map(() => false);
    this.s.deployPlayer = this.initiative;
    this.ev('phase', 'Deployment: both players deploy at the same time — moves are revealed when everyone is done.');
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
