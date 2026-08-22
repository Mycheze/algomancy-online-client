/* batch-wood-c — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Wood cards scripted over the printed data in printed.json
 * (never hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (partial resolution against remaining legal targets), R6 (mid-resolution
 * choices via ctx.choose, plan-then-commit), R9 (bounded budgets per card),
 * R11 (regroup returns units to their CONTROLLER's region — control changes
 * stick), R12/R25 ("each player/opponent"/"your units"/"all units" read the
 * effect region's present seats / in-region units), R28 (created UNITS spawn
 * in their controller's HOME region; spell tokens appear at ctx.region),
 * R31 (triggers in combat damage sub-steps resolve immediately).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - CONTROL CHANGE (Ralph / Rebalance / Stellarspore Harvester): the engine
 *    has no control-change primitive, so the shared giveControl helper edits
 *    the entity directly: controller is reassigned, the unit drops out of any
 *    battle formation (it fights for nobody mid-swap), and it walks to its
 *    new controller's home region unless that controller is present where it
 *    stands (regroup would do the same move, R11 step 1). Owner is untouched
 *    — the card still dies/recalls to its owner's bin/hand.
 *  - "TARGET OPPONENT" uses the 'any' TargetSpec (Dreamfloat Drifter
 *    precedent): a non-opponent pick resolves as a no-op. Region scoping
 *    (R25) means an absent opponent (e.g. during your deployment) simply is
 *    not a candidate — Ralph's defection is a battle play in practice.
 *  - Saprophytic Oracle's "nontoken unit dies": NO LONGER an approximation.
 *    This said "the died event carries no token flag, so the discriminator is
 *    the death message"; R70 puts `token` on the event itself and the card
 *    reads it. (The string match is exactly what the redesigned Wraith slipped
 *    past, because its death logged different text.)
 *  - Wandering Blightshell's "when YOU put a counter on an enemy": nothing
 *    records WHO placed a counter, so the trigger reads countersChanged
 *    events as: -1/-1 counter(s) landing on an enemy of mine were put there
 *    by me. Deviation: an opponent putting -1/-1 counters on their own unit
 *    would also fire it (rare); +1/+1 counters I put on an enemy never do.
 *  - Verdant Necrophage's donated "[Augment] when I despawn" fires on the
 *    host's DEATH but not its recall — recall() erases mod entities before
 *    firing the event (the batch-hybrids-fwe Bloated Manablub asymmetry).
 *    Played normally, both channels work ('died' + 'despawned', despawn =
 *    any leave-play per that batch's precedent).
 *
 * PARKED: none — all fifteen cards are live (three under the documented
 * approximations above).
 */
import type { Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, type EffectCtx, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt, inEndOfTurn, isUnitCard } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** present seats of a region, initiative player first (stable order) */
const presentSeats = (g: E, region: number): Seat[] => {
  const present = g.s.regions[region]!.presentSeats;
  return [g.initiative, g.nit].filter(s => present.includes(s));
};

/** `chooser` picks one of `candidates` (auto-picked when only one). Returns
 * null when there is nothing to pick. Plan-then-commit: call all chooses
 * before mutating (the engine replays the part on suspension). */
const chooseUnit = (
  g: E, ctx: EffectCtx, key: string, chooser: Seat, candidates: Entity[], prompt: string,
): Entity | null => {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0]!;
  const id = ctx.choose(key, {
    kind: 'electricPath', seat: chooser, prompt,
    options: candidates.map(u => ({ label: u.card, value: u.id, card: u.card })),
  }) as EntityId;
  return g.entity(id) ?? null;
};

/** ⚠ header approximation — control change without an engine primitive:
 * reassign controller, drop out of any battle formation, and move the unit
 * (mods riding along) to its new controller's home region unless the new
 * controller is present where it stands. Owner never changes. */
const giveControl = (g: E, u: Entity, to: Seat): void => {
  if (!g.entity(u.id) || u.controller === to) return;
  u.controller = to;
  const b = g.s.battle;
  if (b) {
    for (const col of [...b.columns, ...Object.values(b.blocks)]) {
      const i = col.indexOf(u.id);
      if (i !== -1) col.splice(i, 1);
    }
    const si = b.sentAttackers.indexOf(u.id);
    if (si !== -1) b.sentAttackers.splice(si, 1);
  }
  if (!g.s.regions[u.region]!.presentSeats.includes(to)) {
    u.region = g.homeRegion(to);
    for (const mid of u.mods) { const m = g.entity(mid); if (m) m.region = u.region; }
  }
  g.ev('info', `${g.pname(to)} gains control of ${u.card}.`);
};

/** create n 1/1 unit tokens for `seat` — in their HOME region (R28) */
const create1s = (g: E, seat: Seat, n: number): void => {
  for (let i = 0; i < n; i++) {
    g.spawnUnit(seat, 'Unit Token', g.homeRegion(seat), { token: true, tokenStats: [1, 1] });
  }
};

// ────────────────────────────── the cards ──────────────────────────────

// "[one]: [Switch1] Give target opponent control of me. If you do, create
// three 1/1 units." — g/1 2/1 Apple Unit. Activated ([one] = mana 1),
// [Switch1] = bounded (R9) and a graft cause. "Me" is the effect's carrier
// (the host when the [Switch1] effect is grafted elsewhere); "you" is the
// activator, whose 1/1s arrive at home (R28). "If you do": the tokens only
// come if the control change actually happened — a gone unit or a
// non-opponent target is a full no-op. ⚠ header notes: control change is the
// giveControl approximation; during deployment the opponent is not present,
// so they are no target (R25) and the ability no-ops.
const ralphDefect: EffectDef = {
  // R64: "target opponent" is a player, and not you — 'any' offered every
  // unit in the region and Ralph's own controller, all of them dead options.
  targets: { what: 'opponent', prompt: 'Ralph: target opponent gains control of me (then create three 1/1 units)' },
  creates: ['Unit Token'],
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!t || !('player' in (t as object)) || (t as { player: Seat }).player === ctx.controller) {
      g.ev('info', 'Ralph: the target is not an opponent — nothing happens.');
      return;
    }
    const me = selfOf(g, ctx);
    if (!me) { g.ev('info', 'Ralph: the unit is gone — no control change, no tokens.'); return; }
    const to = (t as { player: Seat }).player;
    if (me.controller === to) { g.ev('info', 'Ralph: they already control me — no tokens.'); return; }
    giveControl(g, me, to);
    create1s(g, ctx.controller, 3);
  },
};
card('Ralph', {
  abilities: [{
    type: 'activated', cost: { mana: 1 }, bounded: true, graftCause: true,
    label: '[one]: give target opponent control of me; if you do, create three 1/1 units',
    effect: ralphDefect,
  }],
  graftEffect: { bounded: true, effect: ralphDefect },
});

// "Each player gives an opponent control of one of their units." — g/2
// {Battle} Arcane Fungus Spell. "Each player" = the region's present seats
// (R12/R25), initiative first; each picks one of their OWN in-region units
// (auto when they have one; deterministic auto-pick in the end-of-turn tail),
// the receiving opponent in 1v1 is the other seat. All picks are gathered
// before any control changes (plan-then-commit), then committed via the
// giveControl approximation (⚠ header).
card('Rebalance', {
  spellEffect: {
    run: (g, ctx) => {
      const gives: { u: Entity; to: Seat }[] = [];
      for (const seat of presentSeats(g, ctx.region)) {
        const units = g.unitsOf(seat, ctx.region);
        if (!units.length) continue;
        const to = (1 - seat) as Seat;
        const u = inEndOfTurn(g)
          ? units[0]!
          : chooseUnit(g, ctx, `rb:${seat}`, seat, units,
            `Rebalance: choose one of your units — ${g.pname(to)} gains control of it`);
        if (u) gives.push({ u, to });
      }
      if (!gives.length) {
        // conformance: an effect that runs to completion must say something
        g.ev('info', 'Rebalance: nobody in this region has a unit to give — no effect.');
        return;
      }
      for (const { u, to } of gives) {
        if (g.entity(u.id)) giveControl(g, u, to);
      }
    },
  },
});

// "[Augment] Whenever a nontoken unit dies, create a 1/1 unit." — gg/3 2/3
// Fungus Oracle Unit. Text-box [Augment]: live when played normally (Manual
// Q&A) and donated to hosts. Death listeners are region-scoped (R12).
// R70: "nontoken" is read off the death EVENT's token flag. It used to be a
// string match on the log message ("— token: erased."), which a card whose
// death logged different text — the redesigned Wraith — slipped straight
// past. The created 1/1 IS a token, so no loop. It arrives at home (R28).
card('Saprophytic Oracle', {
  augmentText: [{
    type: 'triggered', events: ['died'],
    label: 'a nontoken unit died — create a 1/1 unit',
    when: (_g, _self, ev) => ev.data?.token !== true,
    effect: { creates: ['Unit Token'], run: (g, ctx) => create1s(g, ctx.controller, 1) },
  }],
});

// "[Augment] At the end of turn, you lose 1 life and create a Poison 1." —
// gg/1 0/2 Blight Fungus Unit. Text-box [Augment]; "you" = the carrier's
// controller (the host's, when donated). End-of-turn resolution: no choices,
// so it is safe in the EOT tail. The Poison spawns at the action region
// (home — spell tokens are battle materiel, created where the effect
// resolves) and lives until the NEXT regroup, i.e. through next battle.
card('Spawning Ground', {
  augmentText: [{
    type: 'triggered', events: ['endOfTurn'],
    label: 'you lose 1 life and create a Poison 1',
    effect: {
      creates: ['Poison'],
      run: (g, ctx) => {
        g.loseLife(ctx.controller, 1, 'Spawning Ground');
        g.createSpellToken(ctx.controller, 'Poison', 1);
      },
    },
  }],
});

// "When I attack or block, [Switch] Create a Poison X, where X is my power."
// — g/2 1/3 Fungus Slime Unit. Unbounded graft ([Switch]). X = the carrier's
// power at RESOLUTION (R1: effStats live — the host's power when the effect
// is grafted elsewhere); a gone carrier or 0 power makes no token. The
// Poison appears at ctx.region (spell tokens are battle materiel).
const spewPoison: EffectDef = {
  creates: ['Poison'],
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    if (!self) { g.ev('info', 'Spewing Mushroom: the unit is gone — no Poison.'); return; }
    const [p] = g.effStats(self);
    if (p <= 0) { g.ev('info', `${self.card} has no power — no Poison.`); return; }
    g.createSpellToken(ctx.controller, 'Poison', p, ctx.region);
  },
};
card('Spewing Mushroom', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true, graftCause: true,
    label: 'create a Poison X (X = my power)',
    effect: spewPoison,
  }],
  graftEffect: { bounded: false, effect: spewPoison },
});

// "When I die, [Switch] Delete all units with -1/-1 counters on them." — g/4
// 2/2 {Poisonous} Blight Fungus Unit. Died trigger (self); unbounded graft.
// "All units" = every unit in the effect's region (R12), both sides. Its own
// Poisonous hits convert to -1/-1 counters, so trading with the Siren often
// marks the killer for deletion — counters land during the damage sub-step,
// before the death trigger resolves (R31). Deleted, not killed: destroy verb
// 'is deleted' (nontoken unmodded → owner's bin).
const deleteCountered: EffectDef = {
  run: (g, ctx) => {
    const doomed = g.unitsIn(ctx.region).filter(u => u.counters < 0);
    if (!doomed.length) { g.ev('info', `${ctx.sourceName}: no unit carries a -1/-1 counter — nothing is deleted.`); return; }
    for (const u of doomed) {
      if (g.entity(u.id)) g.destroy(u, 'is deleted');
    }
  },
};
card('Sporebloom Siren', {
  abilities: [{
    type: 'triggered', events: ['died'], self: true, graftCause: true,
    label: 'delete all units with -1/-1 counters on them',
    effect: deleteCountered,
  }],
  graftEffect: { bounded: false, effect: deleteCountered },
});

// "Sacrifice me: [Switch] Create a Poison 1." — g/1 1/1 Fungus Unit. An
// activated ability whose cost is the sacrifice (paid at activation, not
// respondable); the [Switch] effect is an unbounded graft and the ability is
// its cause. The Poison appears at ctx.region.
const sprouterPoison: EffectDef = {
  creates: ['Poison'],
  run: (g, ctx) => { g.createSpellToken(ctx.controller, 'Poison', 1, ctx.region); },
};
card('Sprouter', {
  abilities: [{
    type: 'activated', cost: { sacrificeSelf: true }, graftCause: true,
    label: 'Sacrifice me: create a Poison 1',
    effect: sprouterPoison,
  }],
  graftEffect: { bounded: false, effect: sprouterPoison },
});

// "After combat, gain control of target unit if it has a -1/-1 counter on it.
// [Augment] When I die, give each unit you control with a -1/-1 counter on it
// to target opponent." — ggg/5 3/5 Cosmic Fungus Unit.
// After-combat half: the trigger only fires when a -1/-1-countered unit is in
// the region at event time (R1 condition — no pointless targeting every
// combat); the "if it has" rider is enforced again on the chosen target at
// resolution (Minor Kraken precedent) — a clean target is a no-op.
// [Augment] half: died trigger (self — the HOST when donated); "you" = the
// carrier's controller. All handovers use the giveControl approximation (⚠).
card('Stellarspore Harvester', {
  abilities: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'gain control of target unit (it needs a -1/-1 counter)',
    when: (g, self) => g.unitsIn(self.region).some(u => u.counters < 0),
    effect: {
      targets: { what: 'unit', prompt: 'Stellarspore Harvester: gain control of target unit (must have a -1/-1 counter)' },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!isEnt(t) || !g.entity(t.id)) return;
        if (t.counters >= 0) {
          g.ev('info', `Stellarspore Harvester: ${t.card} has no -1/-1 counter — no control change.`);
          return;
        }
        giveControl(g, t, ctx.controller);
      },
    },
  }],
  augmentText: [{
    type: 'triggered', events: ['died'], self: true,
    label: 'give each of your units with a -1/-1 counter to target opponent',
    // R1 condition: only fires when I leave behind a -1/-1-countered unit
    when: (g, self) => g.unitsOf(self.controller, self.region)
      .some(u => u.counters < 0 && u.id !== self.id),
    effect: {
      targets: { what: 'any', prompt: 'Stellarspore Harvester: target opponent takes your -1/-1-countered units' },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!t || !('player' in (t as object)) || (t as { player: Seat }).player === ctx.controller) {
          g.ev('info', 'Stellarspore Harvester: the target is not an opponent — nothing happens.');
          return;
        }
        const to = (t as { player: Seat }).player;
        for (const u of g.unitsOf(ctx.controller, ctx.region)) {
          if (u.counters < 0 && g.entity(u.id)) giveControl(g, u, to);
        }
      },
    },
  }],
});

// "[Switch] Your units gain +1/+1 until regroup." — g/1 0/1 {Battle} Flower
// Spell. The whole line is the unbounded graftable effect. "Your units" is
// region-scoped (R12); the buff is the engine's temp layer (cleared at
// regroup, R11 step 3).
const bloomBuff: EffectDef = {
  run: (g, ctx) => {
    const mine = g.unitsOf(ctx.controller, ctx.region);
    if (!mine.length) { g.ev('info', `${ctx.sourceName}: you control no unit here — nothing is buffed.`); return; }
    for (const u of mine) g.addTemp(u, 1, 1);
  },
};
card('Sudden Bloom', {
  spellEffect: bloomBuff,
  graftEffect: { bounded: false, effect: bloomBuff },
});

// "Create a 1/1 unit for each of your [g]." — g/3 Plant Spell (deploy).
// [g] = wood AFFINITY at resolution (R1): non-dormant wood resources,
// expended included — paying the spell's own mana never shrinks the count.
// The 1/1s are created units → they arrive at home (R28).
card('Sylvan Sprouting', {
  spellEffect: {
    creates: ['Unit Token'],
    run: (g, ctx) => {
      const n = g.affinity(ctx.controller, 'wood');
      if (n <= 0) { g.ev('info', 'Sylvan Sprouting: no wood affinity — no units.'); return; }
      create1s(g, ctx.controller, n);
    },
  },
});

// "When I spawn, create a Poison 6. [Augment] When I despawn, each opponent
// recalls a unit from their bin." — gg/3 2/4 Fungus Slime Unit.
// Spawn half: a Poison 6 at ctx.region (spell-token rule).
// [Augment] half: "despawn" = ANY leave-play (batch-hybrids-fwe precedent:
// 'died' + 'despawned'; ⚠ header: the DONATED copy misses host recalls).
// "Each opponent" is region-scoped (R25); each recalls (bin → hand) a card
// of their choice that is a unit (spell-units count), auto-picked when
// forced or in the end-of-turn tail. Plan-then-commit: all picks precede
// any bin mutation.
card('Verdant Necrophage', {
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true,
    label: 'create a Poison 6',
    effect: { creates: ['Poison'], run: (g, ctx) => { g.createSpellToken(ctx.controller, 'Poison', 6, ctx.region); } },
  }],
  augmentText: [{
    type: 'triggered', events: ['died', 'despawned'], self: true,
    label: 'each opponent recalls a unit from their bin',
    effect: {
      run: (g, ctx) => {
        const plans: { seat: Seat; idx: number }[] = [];
        for (const seat of presentSeats(g, ctx.region)) {
          if (seat === ctx.controller) continue;
          const options = g.player(seat).bin
            .map((n, i) => [n, i] as const)
            .filter(([n]) => isUnitCard(n));
          if (!options.length) {
            g.ev('info', `Verdant Necrophage: ${g.pname(seat)} has no unit in their bin to recall.`);
            continue;
          }
          if (options.length === 1 || inEndOfTurn(g)) {
            plans.push({ seat, idx: options[0]![1] });
            continue;
          }
          const idx = ctx.choose(`vn:${seat}`, {
            kind: 'electricPath', seat,
            prompt: 'Verdant Necrophage: recall a unit from your bin',
            options: options.map(([n, i]) => ({ label: n, value: i, card: n })),
          }) as number;
          plans.push({ seat, idx });
        }
        for (const { seat, idx } of plans) {
          const [name] = g.player(seat).bin.splice(idx, 1);
          if (name !== undefined) {
            g.player(seat).hand.push(name);
            g.ev('info', `${g.pname(seat)} recalls ${name} from their bin.`);
          }
        }
      },
    },
  }],
});

// "[Switch1] I deal damage to target unit equal to the number of units you
// control." — gg/2 {Battle} Bedlam Plant Spell. Bounded graft (R9). The
// amount is live at RESOLUTION (R1): your in-region units (R12) when the
// spell/graft part actually resolves — deaths in response shrink it.
const vengeance: EffectDef = {
  targets: { what: 'unit', prompt: 'Verdant Vengeance: I deal damage equal to your unit count to target unit' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t) || !g.entity(t.id)) {
      g.ev('info', `${ctx.sourceName}: the target is gone — no damage.`);
      return;
    }
    const n = g.unitsOf(ctx.controller, ctx.region).length;
    if (n <= 0) { g.ev('info', `${ctx.sourceName}: you control no unit here — 0 damage.`); return; }
    g.dealEffectDamage(ctx, t, n);
  },
};
card('Verdant Vengeance', {
  spellEffect: vengeance,
  graftEffect: { bounded: true, effect: vengeance },
  // UI preview (#5): the damage it would deal if it resolved right now
  xPreview: (g, seat, region) => g.unitsOf(seat, region).length,
});

// "When you put a counter on an enemy, [Switch1] Draw a card." — g/2 1/2
// Blight Turtle Unit. Bounded ([Switch1], R9) trigger on countersChanged.
// ⚠ header approximation: the engine does not record who placed a counter,
// so "you put a counter on an enemy" reads as "-1/-1 counter(s) landed on a
// unit an opponent controls (in my region — listeners are region-scoped)".
const blightDraw: EffectDef = { run: (g, ctx) => g.draw(ctx.controller, 1) };
card('Wandering Blightshell', {
  abilities: [{
    type: 'triggered', events: ['countersChanged'], bounded: true, graftCause: true,
    label: 'draw a card (you put a counter on an enemy)',
    when: (g, self, ev) => {
      if (((ev.data?.n as number) ?? 0) >= 0) return false;
      const u = g.entity(ev.data?.unit as EntityId);
      return !!u && u.controller !== self.controller;
    },
    effect: blightDraw,
  }],
  graftEffect: { bounded: true, effect: blightDraw },
});

// "When I attack or block, [Switch] Your units gain +1/+0 until regroup." —
// g/1 1/1 Flower Unit. Unbounded graft; self-filtered attack/block trigger.
// "Your units" region-scoped (R12); temp layer, cleared at regroup.
const warbloomBuff: EffectDef = {
  run: (g, ctx) => {
    for (const u of g.unitsOf(ctx.controller, ctx.region)) g.addTemp(u, 1, 0);
  },
};
card('Warbloom Herald', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true, graftCause: true,
    label: 'your units gain +1/+0 until regroup',
    effect: warbloomBuff,
  }],
  graftEffect: { bounded: false, effect: warbloomBuff },
});

// "Negate all enemy effects targeting allied effects, players or units." —
// ggg/3 {Battle} Druid Spell. At resolution (this item is already off the
// stack) every remaining stack item an opponent controls is negated if any
// of its unspent parts targets: a unit you control, you as a player, or a
// stack item you control ("allied" = your side; 1v1 = yours). Triggered and
// activated items count — they are effects too.
card('Woodland Warding', {
  spellEffect: {
    run: (g, ctx) => {
      const mine = ctx.controller;
      const alliedItems = new Set(g.s.stack.filter(i => i.controller === mine).map(i => i.id));
      const hits = g.s.stack.filter(it => {
        if (it.controller === mine) return false;
        return it.parts.some(p => !p.spent && p.targets.some(t =>
          ('unit' in t && g.entity(t.unit)?.controller === mine)
          || ('player' in t && t.player === mine)
          || ('stack' in t && alliedItems.has(t.stack))));
      });
      if (!hits.length) {
        g.ev('info', 'Woodland Warding: no enemy effects target your side.');
        return;
      }
      for (const it of hits) g.negate(it.id);
    },
  },
});
