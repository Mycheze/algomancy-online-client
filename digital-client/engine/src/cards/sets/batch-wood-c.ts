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
 * effect region's present seats / in-region units), R115 (created UNITS spawn
 * where their SOURCE is — ctx.region — as spell tokens always did),
 * R31 (triggers in combat damage sub-steps resolve immediately).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - CONTROL CHANGE (Ralph / Rebalance / Stellarspore Harvester): UN-PARKED
 *    (R112, 2026-08-23) — `E.giveControl(u, to)` is the primitive this note
 *    used to say did not exist, with exactly this batch's reading (drop out
 *    of the formation, walk home unless the new controller is present) plus
 *    the one thing this batch's local copy got wrong: the unit's MODS change
 *    controller with it (Bena's ruling). Owner is untouched
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
 *  - Wandering Blightshell's "when YOU put a counter on an enemy": NO LONGER
 *    an approximation (R130, 2026-08-24). The escalation this entry used to
 *    carry was granted exactly as written — `addCounters(target, n, by?: Seat)`
 *    defaulting to the resolving effect's controller, with `by` on the
 *    countersChanged event — so the trigger is now
 *    `ev.data.by === self.controller && the victim is an enemy`, sign-blind.
 *    The sign test it replaces was wrong in BOTH directions (an enemy
 *    shrinking their own unit fired it; a +1/+1 counter I put on an enemy did
 *    not), and Flux Resonator came off its own half of the same approximation
 *    in the same change.
 *  - (Verdant Necrophage's entry here is NO LONGER an approximation. It read
 *    "the donated '[Augment] when I despawn' fires on the host's DEATH but not
 *    its recall — recall() erases mod entities before firing the event". R167
 *    fixed exactly that: `E.leavePlay` used to delete the mod entities before
 *    the caller built its event, so `fireEvent`'s walk of `u.mods` through the
 *    entity table found nothing to donate; the deletion MOVED to the last
 *    statement of `afterDespawn`, matching the tail `disposeToBin` already
 *    used. Death, recall and cache now all fire the donated trigger. Played
 *    normally both channels work as before ('died' + 'despawned', despawn =
 *    any leave-play per the batch-hybrids-fwe precedent).)
 *
 * PARKED: none — all fifteen cards are live (three under the documented
 * approximations above).
 */
import type { Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, type EffectCtx, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt, isUnitCard } from './helpers.ts';

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

/** create n 1/1 unit tokens for `seat` in `region`. R115: `region` is REQUIRED
 * and is always the SOURCE's region (`ctx.region`) — a defaulted region is how
 * a card ends up creating units somewhere no line of code names. */
const create1s = (g: E, seat: Seat, n: number, region: number): void => {
  for (let i = 0; i < n; i++) {
    g.spawnUnit(seat, 'Unit Token', region, { token: true, tokenStats: [1, 1] });
  }
};

// ────────────────────────────── the cards ──────────────────────────────

// "[one]: [Switch1] Give target opponent control of me. If you do, create
// three 1/1 units." — g/1 2/1 Apple Unit. Activated ([one] = mana 1),
// [Switch1] = bounded (R9) and a graft cause. "Me" is the effect's carrier
// (the host when the [Switch1] effect is grafted elsewhere); "you" is the
// activator, whose 1/1s arrive at the source's region (R115). "If you do": the tokens only
// come if the control change actually happened — a gone unit or a
// non-opponent target is a full no-op. ⚠ header notes: control change is the
// E.giveControl (R112); during deployment the opponent is not present,
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
    g.giveControl(me, to);
    create1s(g, ctx.controller, 3, ctx.region);
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
// (auto only when they have exactly one — the question is put even when this
// resolves in the end-of-turn window, R85), the receiving opponent in 1v1 is
// the other seat. All picks are gathered
// before any control changes (plan-then-commit), then committed via the
// E.giveControl (R112).
card('Rebalance', {
  spellEffect: {
    run: (g, ctx) => {
      const gives: { u: Entity; to: Seat }[] = [];
      for (const seat of presentSeats(g, ctx.region)) {
        const units = g.unitsOf(seat, ctx.region);
        if (!units.length) continue;
        const to = (1 - seat) as Seat;
        const u = chooseUnit(g, ctx, `rb:${seat}`, seat, units,
          `Rebalance: choose one of your units — ${g.pname(to)} gains control of it`);
        if (u) gives.push({ u, to });
      }
      if (!gives.length) {
        // conformance: an effect that runs to completion must say something
        g.ev('info', 'Rebalance: nobody in this region has a unit to give — no effect.');
        return;
      }
      for (const { u, to } of gives) {
        if (g.entity(u.id)) g.giveControl(u, to);
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
// past. The created 1/1 IS a token, so no loop. It arrives at ctx.region (R115).
card('Saprophytic Oracle', {
  augmentText: [{
    type: 'triggered', events: ['died'],
    label: 'a nontoken unit died — create a 1/1 unit',
    when: (_g, _self, ev) => ev.data?.token !== true,
    effect: { creates: ['Unit Token'], run: (g, ctx) => create1s(g, ctx.controller, 1, ctx.region) },
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
        g.createSpellToken(ctx.controller, 'Poison', 1, ctx.region);
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
// R157 §15 / R161 — THE CONDITION IS CHECKED AT RESOLUTION ONLY. Owner,
// 2026-08-25, verbatim: *"The wording is such that you can target any enemy, it
// only checks whether you gain control of it on resolution."*
//
// The 2026-08-24 literal-reading sweep escalated a `when` gate on BOTH halves
// that required some unit in the region to already carry a -1/-1 counter at
// event time, and offered three readings: (a) literal — drop the gate; (b) R64
// — make it a targeting `restrict`; (c) as written. The ruling picks (a), and
// it picks it twice over: "you can target ANY enemy" refuses (b) as well as
// (c). The trigger now always fires and always asks, the menu is every unit,
// and the counter is looked for once — at resolution, on the chosen target.
//
// THE LINE THIS BUYS BACK, which is why the gate was escalated: after combat,
// target a CLEAN enemy unit, then put a -1/-1 counter on it inside the
// after-combat window (Noxious Demise is a {Battle} spell) and steal it. Under
// the old gate that play was unreachable whenever no OTHER unit in the region
// already carried a counter, and under (b) it would be unreachable always.
// The resolution re-check below is not a leftover of the gate — it is the
// whole condition now, and a clean target at resolution is a legal no-op.
// [Augment] half: died trigger (self — the HOST when donated); "you" = the
// carrier's controller. Its `when` goes for the same reason (the printed text
// carries no trigger condition either — "give EACH unit … with a -1/-1
// counter" is a quantity read at resolution, and none is a legal none). All
// handovers go through E.giveControl (R112).
card('Stellarspore Harvester', {
  abilities: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'gain control of target unit (it needs a -1/-1 counter)',
    effect: {
      targets: { what: 'unit', prompt: 'Stellarspore Harvester: gain control of target unit (must have a -1/-1 counter)' },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!isEnt(t) || !g.entity(t.id)) return;
        if (t.counters >= 0) {
          g.ev('info', `Stellarspore Harvester: ${t.card} has no -1/-1 counter — no control change.`);
          return;
        }
        g.giveControl(t, ctx.controller);
      },
    },
  }],
  augmentText: [{
    type: 'triggered', events: ['died'], self: true,
    label: 'give each of your units with a -1/-1 counter to target opponent',
    // R157 §15 / R161: no `when`. The printed text states no trigger condition
    // on this half either, and "each unit you control with a -1/-1 counter on
    // it" is a quantity counted at RESOLUTION — which may be none.
    effect: {
      // R64/R82 (target audit, playtest round 15): the printed target is
      // "target OPPONENT", and 'opponent' is the kind that means it — measured
      // from the effect's controller. This said 'any', which is the DAMAGE
      // kind: it offered every unit on the board and both players, so the
      // usual pick was a target that could only fizzle into the info line
      // below. That line stays as the R58 resolution re-check.
      targets: { what: 'opponent', prompt: 'Stellarspore Harvester: target opponent takes your -1/-1-countered units' },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!t || !('player' in (t as object)) || (t as { player: Seat }).player === ctx.controller) {
          g.ev('info', 'Stellarspore Harvester: the target is not an opponent — nothing happens.');
          return;
        }
        const to = (t as { player: Seat }).player;
        // R187/CT-70: "each of your units with a -1/-1 counter" is a quantity
        // counted at RESOLUTION and none is a legal none — but a legal none
        // still has to be SAID, or the trigger leaves the stack in silence.
        const giving = g.unitsOf(ctx.controller, ctx.region)
          .filter(u => u.counters < 0 && g.entity(u.id));
        if (!giving.length) {
          g.ev('info', `Stellarspore Harvester: you have no unit with a -1/-1 counter here — ${g.pname(to)} takes nothing.`);
          return;
        }
        for (const u of giving) g.giveControl(u, to);
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
// The 1/1s are created units → they arrive at the source's region (R115),
// which for a deploy-timing spell IS home.
card('Sylvan Sprouting', {
  spellEffect: {
    creates: ['Unit Token'],
    run: (g, ctx) => {
      const n = g.affinity(ctx.controller, 'wood');
      if (n <= 0) { g.ev('info', 'Sylvan Sprouting: no wood affinity — no units.'); return; }
      create1s(g, ctx.controller, n, ctx.region);
    },
  },
});

// "When I spawn, create a Poison 6. [Augment] When I despawn, each opponent
// recalls a unit from their bin." — gg/3 2/4 Fungus Slime Unit.
// Spawn half: a Poison 6 at ctx.region (spell-token rule).
// [Augment] half: "despawn" = ANY leave-play (batch-hybrids-fwe precedent:
// 'died' + 'despawned'). R167: the DONATED copy fires on a host recall and
// cache too — `leavePlay` used to delete the mod entities before the event was
// built, so the donated text was unreachable on those two routes. (The header
// note that flagged this as an asymmetry is retired with it.)
// "Each opponent" is region-scoped (R25); each recalls (bin → hand) a card
// of their choice that is a unit (spell-units count), auto-picked only when
// forced — a despawn in the end-of-turn window still asks (R85). Plan-then-
// commit: all picks precede any bin mutation.
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
        // R187/CT-70: the per-opponent branch below announces an empty bin,
        // but the LOOP said nothing when R25 left it with nobody to walk.
        const foes = presentSeats(g, ctx.region).filter(s => s !== ctx.controller);
        if (!foes.length) {
          g.ev('info', 'Verdant Necrophage: no opponent is present here — nobody recalls a unit.');
          return;
        }
        const plans: { seat: Seat; idx: number }[] = [];
        for (const seat of foes) {
          const options = g.player(seat).bin
            .map((n, i) => [n, i] as const)
            .filter(([n]) => isUnitCard(n));
          if (!options.length) {
            g.ev('info', `Verdant Necrophage: ${g.pname(seat)} has no unit in their bin to recall.`);
            continue;
          }
          if (options.length === 1) {
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
          const name = g.removeFromBin(seat, idx, 'recalled');   // R124
          if (name !== undefined) {
            g.toHand(seat, name, 'bin');   // R179
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
//
// R130: BOTH printed words are now real, and neither was before.
//  - "A COUNTER" is unqualified, so the sign test is gone. The owner,
//    2026-08-24: "All counters count as counters." A +1/+1 counter you put on
//    an enemy (Flux Resonator's plus-one onto their unit, a stat swap, Buffer
//    Overflow doubling their +1/+1s) is a counter you put on an enemy.
//  - "YOU PUT" is `ev.data.by`, the seat `E.addCounters` recorded — the actor
//    the old code was standing in for with a sign. An enemy shrinking their
//    OWN unit no longer draws me a card, which is the direction the stand-in
//    was wrong in that nobody would have called narrow.
// "An enemy" is the unit's controller, not mine; region scoping is free
// (fireEvent reads the counted unit's region). A REDIRECT does not break the
// attribution: counters you aimed at one unit and a Counter Thief moved to
// another are still counters you put — on whatever they ended up on.
const blightDraw: EffectDef = { run: (g, ctx) => g.draw(ctx.controller, 1) };
card('Wandering Blightshell', {
  abilities: [{
    type: 'triggered', events: ['countersChanged'], bounded: true, graftCause: true,
    label: 'draw a card (you put a counter on an enemy)',
    when: (g, self, ev) => {
      if (ev.data?.['by'] !== self.controller) return false;      // R130: "YOU put"
      const u = g.entity(ev.data?.unit as EntityId);
      return !!u && u.controller !== self.controller;             // …"on an enemy"
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
    // "Nothing happened" is a legitimate outcome; not SAYING so never is
    // (test/65-effect-conformance.test.ts: "no effect resolves into silence").
    // Latent since the card landed, and reachable without any graft at all —
    // the trigger is queued when the Herald attacks or blocks, and by the time
    // it RESOLVES (R1: the amount is live at resolution) its controller may
    // control nothing in the region. The fuzz found it through the grafted
    // copy: Vaporweave Eidolon activated "[zero]: recall me", the host left
    // play, and this rider then ran over an empty region and emitted nothing.
    // Worded exactly like its sibling `bloomBuff` (Sudden Bloom) above, and
    // via ctx.sourceName because a graft rider speaks in the host's name.
    const mine = g.unitsOf(ctx.controller, ctx.region);
    if (!mine.length) { g.ev('info', `${ctx.sourceName}: you control no unit here — nothing is buffed.`); return; }
    for (const u of mine) g.addTemp(u, 1, 0);
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
//
// R79 — the half that was silently dead (found by the 2026-08-24 literal-
// reading audit). A VIRUS on the stack carries NO parts and NO target refs:
// apply.ts builds it with `parts: []` and a `hostId` (a unit, or a spell token
// in play) or a `hostStack` (a SPELL on the stack, R79's other shape). So the
// plain target-ref read above sees an enemy Virus aimed at your unit as a
// stack item that targets nothing, and the card printed to answer enemy
// effects aimed at your side sailed straight past the enemy effect that is
// hardest to answer any other way. The designer is explicit that a virus IS a
// targeted effect and is interactible — Caleb, rules-questions: "You can
// redirect a virus, it is a targeted effect", and asked "so you could Graxxlid
// or Boon of Protection it as well?" — "Yep! They're fully interactible."
// Graxxlid reads exactly these two shapes (`aimsAtUnit`, batch-earth-a); this
// is the same read widened from "me" to "my side", and `E.negate` already
// knows what to do with a virus item ("if a virus is negated … it is placed
// into the bin").
card('Woodland Warding', {
  spellEffect: {
    run: (g, ctx) => {
      const mine = ctx.controller;
      const alliedItems = new Set(g.s.stack.filter(i => i.controller === mine).map(i => i.id));
      const hits = g.s.stack.filter(it => {
        if (it.controller === mine) return false;
        if (it.kind === 'virus') {
          // "targeting allied … units" (hostId — a unit or spell token of mine)
          // and "targeting allied effects" (hostStack — my spell on the stack)
          return (it.hostId !== undefined && g.entity(it.hostId)?.controller === mine)
            || (it.hostStack !== undefined && alliedItems.has(it.hostStack));
        }
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
