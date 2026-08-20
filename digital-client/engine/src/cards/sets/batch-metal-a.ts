/* batch-metal-a — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Cards are scripted here from printed.json data (never
 * hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (fizzle vs partial), R6 (mid-resolution payments via ctx.choose),
 * R8 (control change swaps sides straight up), R9 (bounded budgets per card),
 * R12 (regions exclusive — listeners and effects are region-scoped),
 * R28 (created units arrive in their controller's home region),
 * R31 (triggers between combat damage sub-steps resolve immediately).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch (metal = copies, transforms
 * and token games; the engine has NO copy/transform machinery):
 *  - TOKEN TARGETING (Arcane Echo / Download): tokens are not stack-targetable
 *    (TargetSpec has no token scope, spell tokens are not units), so "target
 *    token" is a RESOLUTION-TIME ctx.choose over the tokens in the effect's
 *    region. Slightly stronger than printed (the pick cannot be responded to).
 *  - TOKEN COPIES (Arcane Echo / Automaton of Abundance): a token is fully
 *    described by card + tokenStats/counters/x, so copies are re-created via
 *    spawnUnit/createSpellToken. Mods on the original are not copied.
 *  - X COSTS AT RESOLUTION (Celestial Shifter / Deformant / Discharge): the
 *    engine has no X-at-activation collection and no compound activation
 *    costs, so X is chosen and paid (and Deformant's sacrifices happen) at
 *    RESOLUTION, Frosted Denial-style.
 *  - BASE-STAT CHANGES (Aberrant Statweaver / Body Swap / Celestial Shifter /
 *    Borrower of Forms): the stat layers have no base-set primitive. "Base
 *    X/Y" is approximated as a delta from the printed/token base — layered
 *    counters and temp changes still apply on top, which matches the layer
 *    order. Two Aberrant Statweavers would double-apply the delta (wrong, but
 *    a duplicate "your units are base 3/3" is also printed-meaningless).
 *  - Automaton of Abundance duplicates PER TOKEN SPAWN (each spawn is its own
 *    'spawned' event): a batch of N identical tokens yields N extra copies,
 *    not "one per unique token" (needs replacement-effect machinery). The
 *    copy mirrors the original's region (it is part of the same creation).
 *  - Borrower of Forms copies base stats, counters and temporary stat changes
 *    of the erased unit (relayed through battle counters into a self-spawn
 *    trigger). Card text, attributes and mods are NOT copied (no transform
 *    machinery) — it stays "Borrower of Forms" with the stolen body.
 *  - Ancient One copies TRIGGERED abilities of adjacent allies only, and only
 *    while a formation exists (adjacency is a battle concept). Copied "when
 *    I ..." abilities read the Ancient One as "I"; bounded copies burn a
 *    per-copy budget on the Ancient One (R9). Activated abilities, statics
 *    and graft composition of neighbours are not copied (see PARKED).
 *  - Biomass Devourer reads "nontoken" off the death event message (the dead
 *    entity is gone by trigger time); an Unstable-erased card has no bin copy
 *    to erase but the paid counters still land.
 *  - Celestial Fluxmorph's donated "[Augment] when I despawn" does not fire
 *    when the HOST is recalled — E.recall erases mods before firing the
 *    despawn event (engine limitation; death and self-play despawn do fire).
 *  - Download's steal removes the token from its old formation but cannot
 *    slot it into the thief's (no mid-battle formation-join primitive; R8's
 *    "joins the new controller's formations" is otherwise honored: the token
 *    swaps sides, its region and owner unchanged).
 *  - Deformant's "delete all units" is region-scoped (R12) and unit cost is
 *    the printed mana (X-cost cards count as 0).
 *
 * PARKED (needs engine primitives that do not exist; subsets implemented):
 *  - Dispatch Courier: "you may play a unit during the mana step as if it had
 *    [Haste]" needs play-timing gating (apply.ts's haste-step legality) that
 *    card code cannot reach. Registered with inert augmentText so it plays,
 *    augments and attaches crash-free; the granted permission is dead.
 *  - Cosmic Conspirator (spell-token half): createSpellToken fires no
 *    dispatchable event (E.createSpellToken never calls fireEvent), so a
 *    Poison/Crystal/Fireball creation cannot be intercepted. The Robot half
 *    IS implemented via the 'spawned' event: when you create a Robot you may
 *    have a Poison/Crystal/Fireball of the same X instead.
 *  - Ancient One (activated/static half): apply.ts only surfaces activated
 *    abilities from a unit's own lists and statics from a card's own def —
 *    neighbours' activated abilities and statics cannot be projected onto the
 *    Ancient One from card code. Triggered abilities are delivered (above).
 */
import type { Entity, EntityId, EventType, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, getCard, type EffectDef } from '../dsl.ts';

// ─────────────────────────── shared helpers ───────────────────────────

const isEnt = (t: unknown): t is Entity => !!t && typeof t === 'object' && 'id' in t;

/** printed/token base stats (safe inside statics: never calls effStats) */
const baseStats = (u: Entity): [number, number] =>
  u.tokenStats ?? [getCard(u.card).power, getCard(u.card).toughness];

/** Erase an entity from play entirely: no bin, no death/despawn triggers;
 * its mods are erased with it (Celestial Purge's pattern). */
function eraseFromPlay(g: E, u: Entity): void {
  for (const modId of u.mods) delete g.s.entities[modId];
  delete g.s.entities[u.id];
  unslot(g, u.id);
  g.ev('erased', `${u.card} is ERASED (no bin, no death).`, { unit: u.id, card: u.card, seat: u.controller });
}

/** remove an id from every formation column / the sent-attacker list */
function unslot(g: E, id: EntityId): void {
  const b = g.s.battle;
  if (!b) return;
  for (const col of [...b.columns, ...Object.values(b.blocks)]) {
    const i = col.indexOf(id);
    if (i !== -1) col.splice(i, 1);
  }
  const si = b.sentAttackers.indexOf(id);
  if (si !== -1) b.sentAttackers.splice(si, 1);
}

/** all tokens (unit tokens + spell tokens) in a region, absent ones excluded */
function tokensInRegion(g: E, region: number): Entity[] {
  return Object.values(g.s.entities).filter(e =>
    e.region === region && !e.absent &&
    ((e.kind === 'unit' && !!e.token) || e.kind === 'spellToken'));
}

/** "my column deals combat damage to an opponent", read off the aggregated
 * combat lifeLost event (Amphivore's approximation): my column connects if it
 * is attacking unblocked, or blocked/blocking with Piercing. */
function myColumnConnected(g: E, self: Entity, ev: { data?: Record<string, unknown> }): boolean {
  if (g.s.phase !== 'battle' || ev.data?.['why'] !== 'combat' || ev.data?.['seat'] === self.controller) return false;
  const b = g.s.battle;
  if (!b) return false;
  const atkCi = b.columns.findIndex(col => col.includes(self.id));
  if (atkCi !== -1) {
    const alive = b.columns[atkCi]!.filter(id => g.entity(id));
    return b.blocks[atkCi] === undefined || g.colAttrs(alive).has('Piercing');
  }
  const blkCol = Object.values(b.blocks).find(col => col.includes(self.id));
  return !!blkCol && g.colAttrs(blkCol.filter(id => g.entity(id))).has('Piercing');
}

// ───────────────────────────── the cards ──────────────────────────────

// "[Augment] Your units are base 3/3." — mm/3 3/3 {Virus} {Unstable} Luminary
// Unit. A statics-only augment (augmentable) — live when played normally
// (Manual Q&A), donated when applied as an augment/Virus (staticsFor anchors
// mod-carried statics on the host, so "your" reads the host's controller).
// ⚠ "base 3/3" is a delta from the printed/token base (header note): counters
// and temp changes still apply on top, matching the stat layer order.
card('Aberrant Statweaver', {
  augmentable: true,
  statics: [{
    affects: (_g, self, t) => t.kind === 'unit' && t.controller === self.controller,
    dp: (_g, _self, t) => 3 - baseStats(t)[0],
    dt: (_g, _self, t) => 3 - baseStats(t)[1],
  }],
});

// "[Augment] I have all abilities of adjacent allies. (This includes modded
// abilities.)" — mm/2 1/1 Ancient Mimic Unit. ⚠ approximation (header): a
// bookkeeping when() (always false — Mirage Walker's pattern) scans adjacent
// allies on every dispatched event and queues copies of their matching
// TRIGGERED abilities (own card + augment-donated text) as the Ancient One's
// own triggers. "I" in a copied ability is the Ancient One; ab.when runs with
// the Ancient One as self. Bounded copies burn a per-source budget on the
// Ancient One (R9). Activated abilities / statics: PARKED (header).
const AO_EVENTS: EventType[] = [
  'spawned', 'died', 'despawned', 'draw', 'lifeLost', 'damage',
  'countersChanged', 'modApplied', 'spellPlayed', 'targeted',
  'attackDeclared', 'attacked', 'blocksDeclared', 'blocked',
  'afterCombat', 'endOfTurn',
];
let aoScanning = false;   // reentrancy guard: two adjacent Ancient Ones must not mimic each other
card('Ancient One', {
  augmentText: [{
    type: 'triggered', events: AO_EVENTS,
    label: 'I have all abilities of adjacent allies (triggered abilities)',
    when: (g, self, ev) => {
      if (aoScanning) return false;
      aoScanning = true;
      try {
        const src = ev.data?.['unit'] as EntityId | undefined;
        for (const n of g.adjacentInFormation(self.id)) {
          if (n.controller !== self.controller) continue;
          const sources: { cardName: string; prefix: 'ability' | 'augment' }[] = [
            { cardName: n.card, prefix: 'ability' },
            { cardName: n.card, prefix: 'augment' },
          ];
          for (const modId of n.mods) {
            const m = g.entity(modId);
            if (m && m.appliedAs === 'augment') sources.push({ cardName: m.card, prefix: 'augment' });
          }
          for (const { cardName, prefix } of sources) {
            if (cardName === 'Ancient One') continue;   // no recursive mimicry
            const def = getCard(cardName);
            const list = prefix === 'ability' ? def.abilities : def.augmentText;
            (list ?? []).forEach((ab, idx) => {
              if (ab.type !== 'triggered' || !ab.events.includes(ev.type)) return;
              if (ab.self && src !== self.id) return;       // "when I ...": I = the Ancient One
              if (ab.when && !ab.when(g, self, ev)) return; // conditions read me as "I" (R1: now)
              const key = `ao:${prefix}:${cardName}#${idx}`;
              if (ab.bounded) {
                if ((self.budgets[key] ?? 0) > 0) return;
                self.budgets[key] = 1;
              }
              g.s.triggerQueue.push({
                sourceId: self.id, sourceCard: cardName, controller: self.controller,
                abilityIndex: idx,
                label: `${self.card} (as ${cardName}): ${ab.label}`,
                parts: [{ effectKey: `${prefix}:${cardName}#${idx}`, targets: [] }],
                event: { type: ev.type, msg: ev.msg, ...(ev.data ? { data: ev.data } : {}) },
              });
              g.s.triggerOrderedSeats = [];
            });
          }
        }
      } finally { aoScanning = false; }
      return false;   // the mimic itself never queues — the copies above do
    },
    effect: { run: () => { /* copies are queued in when() — this never runs */ } },
  }],
});

// "[Switch1] Create a copy of target token." — m/2 2/1 {Battle} Arcane Mimic
// Spell. ⚠ header: "target token" is a resolution-time ctx.choose over the
// tokens in this region (unit tokens AND spell tokens). A unit-token copy is
// created in the caster's HOME region (R28); a spell-token copy appears here
// (battle materiel). tokenStats/counters/x are copied; mods are not.
const echoCopy: EffectDef = {
  run: (g, ctx) => {
    const cands = tokensInRegion(g, ctx.region);
    if (!cands.length) { g.ev('info', 'Arcane Echo: no token here to copy.'); return; }
    const pick = ctx.choose('echo', {
      kind: 'payOrDecline', seat: ctx.controller,
      prompt: 'Arcane Echo: create a copy of which token?',
      options: cands.map(t => ({
        label: `${t.card}${t.x !== undefined ? ` ${t.x}` : ''}${t.counters ? ` (${t.counters})` : ''}`,
        value: t.id, card: t.card,
      })),
    }) as EntityId;
    const orig = g.entity(pick);
    if (!orig) return;
    if (orig.kind === 'spellToken') {
      g.createSpellToken(ctx.controller, orig.card, orig.x ?? 0, ctx.region);
    } else {
      g.spawnUnit(ctx.controller, orig.card, g.homeRegion(ctx.controller), {
        token: true,
        ...(orig.tokenStats ? { tokenStats: [...orig.tokenStats] as [number, number] } : {}),
        ...(orig.counters ? { counters: orig.counters } : {}),
      });
    }
  },
};
card('Arcane Echo', {
  spellEffect: echoCopy,
  graftEffect: { bounded: true, effect: echoCopy },
});

// "[Augment] If you would create one or more unit tokens, instead create
// those tokens plus an additional copy of each unique token you created." —
// mm/5 2/6 Automaton Construct Unit. ⚠ header: no replacement machinery —
// approximated as a trigger on every unit-token spawn of yours, duplicating
// it (region mirrored: the copy is part of the same creation). The module
// guard stops copies from re-triggering any Automaton (no loops).
let aoaCopying = false;
card('Automaton of Abundance', {
  augmentText: [{
    type: 'triggered', events: ['spawned'],
    label: 'unit tokens you create are duplicated',
    when: (g, self, ev) => {
      if (aoaCopying || ev.data?.['seat'] !== self.controller) return false;
      const u = ev.data?.['unit'] !== undefined ? g.entity(ev.data['unit'] as EntityId) : undefined;
      return !!u && u.kind === 'unit' && !!u.token && u.id !== self.id;
    },
    effect: {
      run: (g, ctx) => {
        const orig = ctx.event?.data?.['unit'] !== undefined
          ? g.entity(ctx.event.data['unit'] as EntityId) : undefined;
        if (!orig) { g.ev('info', 'Automaton of Abundance: the created token is already gone — no copy.'); return; }
        aoaCopying = true;
        try {
          g.spawnUnit(ctx.controller, orig.card, orig.region, {
            token: true,
            ...(orig.tokenStats ? { tokenStats: [...orig.tokenStats] as [number, number] } : {}),
            ...(orig.counters ? { counters: orig.counters } : {}),
          });
        } finally { aoaCopying = false; }
      },
    },
  }],
});

// "[Augment] Whenever a nontoken unit dies, you may pay [two] to erase it and
// put two +1/+1 counters on me." — m/2 3/2 Alien Robot Unit. Text-box
// [Augment]: live when played normally, donated on augment ("me" = the host).
// 'died' listeners are region-scoped (R12). ⚠ header: "nontoken" is read off
// the death event message; the erase removes the card from its owner's bin.
card('Biomass Devourer', {
  augmentText: [{
    type: 'triggered', events: ['died'],
    label: 'you may pay [two] to erase the dead unit — I get two +1/+1 counters',
    when: (_g, _self, ev) => !ev.msg.includes('token: erased'),
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!self) return;
        if (g.openMana(ctx.controller) < 2) return;
        const name = ctx.event?.data?.['card'] as string | undefined;
        if (!name) return;
        const pay = ctx.choose('devour', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Biomass Devourer: pay [two] to erase ${name} and get two +1/+1 counters?`,
          options: [{ label: 'pay 2', value: 1 }, { label: 'decline', value: 0 }],
        }) as number;
        if (!pay) return;
        g.payMana(ctx.controller, 2);
        const seats: Seat[] = [];
        const evSeat = ctx.event?.data?.['seat'] as Seat | undefined;
        if (evSeat !== undefined) seats.push(evSeat);
        for (const p of g.s.players) if (!seats.includes(p.seat)) seats.push(p.seat);
        for (const s of seats) {
          const bin = g.player(s).bin;
          const i = bin.lastIndexOf(name);
          if (i !== -1) {
            bin.splice(i, 1);
            g.ev('erased', `${name} is ERASED from ${g.pname(s)}'s bin.`, { card: name, seat: s });
            break;
          }
        }
        g.addCounters(self, 2);
      },
    },
  }],
});

// "[Switch1] Exchange the base stats of two target units until regroup.
// (With each other.)" — m/2 2/1 {Battle} Arcane Spell. Two targets collected
// at cast (count/min 2). The exchange REWRITES each unit's base (layer 2, see
// E.setBase) rather than adding a delta: it is "exchange the base stats", so
// counters and temp changes keep applying on top, a later base-setter
// overwrites it rather than compounding with it, and the log says what
// happened ("base becomes 4/4") instead of a misleading -X/+X. Regroup clears
// it (R11 step 3). Needs both targets alive at resolution.
const bodySwap: EffectDef = {
  targets: { what: 'unit', prompt: 'Body Swap: exchange the base stats of two target units until regroup', count: 2, min: 2 },
  run: (g, ctx) => {
    const a = ctx.targets[0];
    const b = ctx.targets[1];
    if (!isEnt(a) || !isEnt(b) || !g.entity(a.id) || !g.entity(b.id)) {
      g.ev('info', 'Body Swap: needs both targets — no effect.');
      return;
    }
    const [ap, at] = g.baseStatsOf(a);
    const [bp, bt] = g.baseStatsOf(b);
    g.setBase(a, bp, bt);
    g.setBase(b, ap, at);
  },
};
card('Body Swap', {
  spellEffect: bodySwap,
  graftEffect: { bounded: true, effect: bodySwap },
});

// "Erase target unit. I become an exact copy of that unit. (I copy all stat
// changes, counters, card text and mods)." — mmm/7 2/2 {Battle} Squid Mimic
// Spell Unit. ⚠ header: stats/counters/temp copy only, no text/mods (no
// transform machinery). The spell erases the target and relays its body
// through battle counters; the spell unit's own spawn trigger claims it.
// Target gone at resolution → the spell fizzles and Borrower is binned (R5).
card('Borrower of Forms', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Borrower of Forms: erase target unit — I become a copy of it' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) return;
      const [p, dt] = baseStats(t);
      const r = ctx.region;
      g.bumpBattleCounter(r, 'bof:pending', 1);
      g.bumpBattleCounter(r, 'bof:p', p);
      g.bumpBattleCounter(r, 'bof:t', dt);
      g.bumpBattleCounter(r, 'bof:c', t.counters);
      g.bumpBattleCounter(r, 'bof:tp', t.tempPower);
      g.bumpBattleCounter(r, 'bof:tt', t.tempToughness);
      eraseFromPlay(g, t);
    },
  },
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true,
    label: 'I become a copy of the erased unit (stats, counters, temp changes)',
    when: (g, self) => g.battleCounter(self.region, 'bof:pending') > 0,
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!self) return;
        const r = ctx.region;
        const take = (k: string): number => {
          const v = g.battleCounter(r, k);
          if (v) g.bumpBattleCounter(r, k, -v);
          return v;
        };
        const pending = take('bof:pending');
        const p = take('bof:p'); const t = take('bof:t');
        const c = take('bof:c');
        const tp = take('bof:tp'); const tt = take('bof:tt');
        if (!pending) return;
        self.tokenStats = [p, t];
        g.ev('info', `${self.card} takes the erased unit's form: base ${p}/${t}.`);
        if (c) g.addCounters(self, c);
        if (tp || tt) g.addTemp(self, tp, tt);
      },
    },
  }],
});

// "When I spawn or become modded, put a +1/+1 counter on each of your units.
// [Augment] When I despawn, remove all counters from your units." — m/2 1/1
// Cosmic Spirit {Virus} Unit. The first sentence stays with the card (plain
// ability); the [Augment] sentence transfers ("I" = the host). "Your units"
// is region-scoped (R12/R25). Despawn = ANY leave-play (died + despawned —
// Bloated Manablub's precedent); ⚠ header: the donated form misses host
// RECALLS (mods are erased before the despawn event fires).
card('Celestial Fluxmorph', {
  abilities: [{
    type: 'triggered', events: ['spawned', 'modApplied'],
    label: 'put a +1/+1 counter on each of your units',
    when: (_g, self, ev) =>
      (ev.type === 'spawned' && ev.data?.['unit'] === self.id) ||
      (ev.type === 'modApplied' && ev.data?.['host'] === self.id),
    effect: {
      run: (g, ctx) => {
        for (const u of g.unitsOf(ctx.controller, ctx.region)) g.addCounters(u, 1);
      },
    },
  }],
  augmentText: [{
    type: 'triggered', events: ['died', 'despawned'], self: true,
    label: 'when I despawn, remove all counters from your units',
    effect: {
      run: (g, ctx) => {
        for (const u of g.unitsOf(ctx.controller, ctx.region)) {
          if (u.counters) g.addCounters(u, -u.counters);
        }
      },
    },
  }],
});

// "[Augment] [x]: I become base X/X until regroup." — m/2 2/2 {Haste} Cosmic
// Alien Unit. An activated ability inside the [Augment] box: usable on the
// card itself when played normally (via 'augment') and on a host when
// donated (via { mod }). ⚠ header: X is chosen and paid at RESOLUTION
// (Frosted Denial's pattern); "base X/X" is a temp delta from the base, so
// counters stay on top and regroup restores the printed body.
card('Celestial Shifter', {
  augmentText: [{
    type: 'activated', cost: {},
    label: '[x]: I become base X/X until regroup',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!self) return;
        const open = g.openMana(ctx.controller);
        const opts = [];
        for (let x = 0; x <= open; x++) opts.push({ label: `X = ${x}`, value: x });
        const x = ctx.choose('shiftX', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Celestial Shifter: choose X (paid now — engine approximation); I become base X/X until regroup',
          options: opts,
        }) as number;
        g.payMana(ctx.controller, x);
        const [bp, bt] = baseStats(self);
        g.addTemp(self, x - bp, x - bt);
      },
    },
  }],
});

// "Negate all activated and triggered effects." — mm/3 4/1 {Battle}
// Technology Spell. Every triggered/activated item on the stack (any
// controller) is negated; spells, viruses and ambushes are untouched.
card('Containment Protocol', {
  spellEffect: {
    run: (g, _ctx) => {
      const hits = g.s.stack.filter(i => (i.kind === 'triggered' || i.kind === 'activated') && !i.negated);
      if (!hits.length) { g.ev('info', 'Containment Protocol: no activated or triggered effects to negate.'); return; }
      for (const i of hits) g.negate(i.id);
    },
  },
});

// "If you would create a Robot, Poison, Crystal or Fireball, you may instead
// create a token of any of these types. (With the same X value.)" — m/3 3/3
// Luminary Unit. ⚠ PARKED half (header): spell-token creations fire no
// dispatchable event, so only the ROBOT direction works — when you create a
// Robot (a 'spawned' unit token), you may erase it and have a Poison, Crystal
// or Fireball of the same X instead. Region-scoped listener (R12).
card('Cosmic Conspirator', {
  abilities: [{
    type: 'triggered', events: ['spawned'],
    label: 'you may create a Poison, Crystal or Fireball instead of a Robot',
    when: (g, self, ev) => {
      if (ev.data?.['seat'] !== self.controller || ev.data?.['card'] !== 'Robot') return false;
      const u = ev.data?.['unit'] !== undefined ? g.entity(ev.data['unit'] as EntityId) : undefined;
      return !!u && !!u.token;
    },
    effect: {
      run: (g, ctx) => {
        const robot = ctx.event?.data?.['unit'] !== undefined
          ? g.entity(ctx.event.data['unit'] as EntityId) : undefined;
        if (!robot) { g.ev('info', 'Cosmic Conspirator: the Robot is already gone.'); return; }
        const x = robot.counters;
        const pick = ctx.choose('conspire', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Cosmic Conspirator: create a token of another type instead of the Robot ${x}?`,
          options: [
            { label: `keep the Robot ${x}`, value: 'keep' },
            { label: `Poison ${x}`, value: 'Poison', card: 'Poison' },
            { label: `Crystal ${x}`, value: 'Crystal', card: 'Crystal' },
            { label: `Fireball ${x}`, value: 'Fireball', card: 'Fireball' },
          ],
        }) as string;
        if (pick === 'keep') return;
        const region = robot.region;
        eraseFromPlay(g, robot);   // it was never created — no death, no bin
        g.createSpellToken(ctx.controller, pick, x, region);
      },
    },
  }],
});

// "Sacrifice me and another ally: Delete all units with cost equal to the
// total number of counters on us." — m/2 2/2 Robot Spirit Unit. ⚠ header:
// the compound cost is paid at RESOLUTION (the engine's activation costs
// cannot express "me and another ally"): pick the ally, count the net
// counters on both, sacrifice both, then delete every unit in this region
// whose printed mana equals the total.
card('Deformant', {
  abilities: [{
    type: 'activated', cost: {},
    label: 'sacrifice me and another ally: delete all units with cost equal to our counters',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!self) return;
        const allies = g.unitsOf(ctx.controller, ctx.region).filter(u => u.id !== self.id);
        if (!allies.length) { g.ev('info', 'Deformant: no other ally to sacrifice — no effect.'); return; }
        const pick = ctx.choose('deform', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Deformant: sacrifice which other ally?',
          options: allies.map(u => ({ label: u.card, value: u.id, card: u.card })),
        }) as EntityId;
        const ally = g.entity(pick);
        if (!ally) return;
        const total = self.counters + ally.counters;
        g.destroy(self, 'is sacrificed');
        g.destroy(ally, 'is sacrificed');
        g.ev('info', `Deformant: deleting all units with cost ${total}.`);
        for (const u of g.unitsIn(ctx.region)) {
          const m = getCard(u.card).mana;
          if ((m === 'X' ? 0 : m) === total) g.destroy(u, 'is deleted');
        }
      },
    },
  }],
});

// "[Switch1] /[Remove X +1/+1 counters from allies]: I deal X damage to
// target unit." — m/1 {Battle} Elemental Technology Spell. The removal is
// the effect's own cost, chosen counter by counter at resolution
// (plan-then-commit: the picks are tallied first, then committed together
// with the damage). "Allies" = your units in this region (R12).
const dischargeZap: EffectDef = {
  targets: { what: 'unit', prompt: 'Discharge: remove X +1/+1 counters from allies — deal X damage to target unit' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t) || !g.entity(t.id)) return;
    const planned = new Map<EntityId, number>();
    let x = 0;
    for (let i = 0; ; i++) {
      const opts: { label: string; value: number; card?: string }[] = [{ label: `done (X = ${x})`, value: -1 }];
      for (const u of g.unitsOf(ctx.controller, ctx.region)) {
        const left = u.counters - (planned.get(u.id) ?? 0);
        if (left > 0) opts.push({ label: `${u.card} (+${left})`, value: u.id, card: u.card });
      }
      if (opts.length === 1) break;
      const pick = ctx.choose(`dis:${i}`, {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: `Discharge: remove a +1/+1 counter from an ally (X = ${x} so far)`,
        options: opts,
      }) as number;
      if (pick === -1) break;
      planned.set(pick, (planned.get(pick) ?? 0) + 1);
      x++;
    }
    for (const [id, n] of planned) {
      const u = g.entity(id);
      if (u) g.addCounters(u, -n);
    }
    const victim = g.entity(t.id);
    if (x > 0 && victim) g.dealEffectDamage(ctx, victim, x);
  },
};
card('Discharge', {
  spellEffect: dischargeZap,
  graftEffect: { bounded: true, effect: dischargeZap },
});

// "[Augment] Each turn, you may play a unit during the mana step as if it had
// [Haste]." — mm/2 2/1 Robot Horse Unit. PARKED (header): play-timing gating
// lives in apply.ts, out of card code's reach. The inert augmentText keeps
// isAugment() true so the card still plays and attaches crash-free.
card('Dispatch Courier', {
  augmentText: [{
    type: 'triggered', events: [],
    label: '(parked) each turn, you may play a unit during the mana step as if it had [Haste]',
    effect: { run: () => { /* PARKED: needs mana-step play gating in apply.ts */ } },
  }],
});

// "Gain control of target token. You may choose new targets for spells
// controlled this way." — mm/1 4/3 {Battle} Technology Spell. ⚠ header: the
// token is picked at resolution (not stack-targetable). The steal is R8's
// straight swap: controller flips (owner and region stay), the token leaves
// its old formation. A stolen spell token is cast fresh by its new
// controller, so "choose new targets" is automatic.
card('Download', {
  spellEffect: {
    run: (g, ctx) => {
      const cands = tokensInRegion(g, ctx.region).filter(t => t.controller !== ctx.controller);
      if (!cands.length) { g.ev('info', 'Download: no enemy token here.'); return; }
      const pick = ctx.choose('dl', {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: 'Download: gain control of which token?',
        options: cands.map(t => ({
          label: `${t.card}${t.x !== undefined ? ` ${t.x}` : ''}${t.counters ? ` (${t.counters})` : ''}`,
          value: t.id, card: t.card,
        })),
      }) as EntityId;
      const tok = g.entity(pick);
      if (!tok) return;
      tok.controller = ctx.controller;
      unslot(g, tok.id);   // R8: it swaps sides — out of its old formation
      g.ev('info', `${g.pname(ctx.controller)} gains control of ${tok.card}.`);
    },
  },
});

// "[Augment] When my column deals combat damage to an opponent, sacrifice me.
// If you do, look at that player's hand and discard a card from it." — mm/1
// 1/1 {Haste} {Evasive} Cosmic Alien Unit. Text-box [Augment]: live when
// played normally, donated on augment ("me" = the host). Fires between combat
// damage sub-steps and resolves immediately (R31). ⚠ column-connect read off
// the aggregated combat lifeLost event (Amphivore's approximation).
card('Eldritch Dreamtender', {
  augmentText: [{
    type: 'triggered', events: ['lifeLost'],
    label: "sacrifice me — look at that player's hand and discard a card",
    when: (g, self, ev) => myColumnConnected(g, self, ev),
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!self) return;
        const who = ctx.event?.data?.['seat'] as Seat | undefined;
        g.destroy(self, 'is sacrificed');
        if (who === undefined) return;
        const hand = g.player(who).hand;
        g.ev('info', `Eldritch Dreamtender reveals ${g.pname(who)}'s hand: ${hand.join(', ') || '(empty)'}.`);
        if (who !== ctx.controller) g.revealHandTo(ctx.controller, who);
        if (!hand.length) return;
        const pick = ctx.choose('dream', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Eldritch Dreamtender: discard a card from ${g.pname(who)}'s hand`,
          options: hand.map((name, i) => ({ label: name, value: i, card: name })),
        }) as number;
        if (hand[pick] === undefined) return;
        // R40: discarding from hand is TRASHING, and the trasher is the owner
        // of the bin the card enters — `who`, not the Dreamtender's controller.
        g.discardFromHand(who, pick);
      },
    },
  }],
});

// "[Augment] Whenever I am modded or applied as a mod, put two +1/+1 counters
// on me." — m/2 0/1 Technology Strider {Virus} Unit. One trigger covers both
// halves: as a unit in play, 'modApplied' with me as the host; donated as a
// mod, the SAME event fires the transferred text with "me" = the host — and
// the application that attached it is itself such an event (attachMod fires
// after the mod joins the host, so its own arrival counts).
card('Evolutionary Experiment', {
  augmentText: [{
    type: 'triggered', events: ['modApplied'],
    label: 'put two +1/+1 counters on me',
    when: (_g, self, ev) => ev.data?.['host'] === self.id,
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (self) g.addCounters(self, 2);
      },
    },
  }],
});
