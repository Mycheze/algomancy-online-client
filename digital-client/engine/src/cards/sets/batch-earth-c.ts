/* batch-earth-c — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Earth cards scripted over the printed data in printed.json
 * (never hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (fizzle vs partial), R6 (mid-resolution choices via ctx.choose),
 * R9 (bounded budgets per card), R12 (regions exclusive — listeners and
 * "all units" are region-scoped), R13 (a blocked column stays blocked — the
 * sticky blocks keys ARE the blocked columns), R21 (Deadly), R22 (an ambush
 * on the stack counts as a spell effect), R25 ("each opponent" reads the
 * event region's present seats).
 *
 * PARKED (needs engine machinery that does not exist yet — every card still
 * registers crash-free and has a todo test):
 *  - Sandstone Defender (augment-donated form only): the unit form is a live
 *    static now (+0/+2 to its controller's OTHER units in its region). The
 *    augment-DONATED form needs mod-carried statics — statics run only while
 *    the holder is a UNIT in play — so as a mod it still donates nothing.
 *  - Towering Colossus (augment-donated form only): the unit form's drawback
 *    is a live static now (+2/+2 to enemy units in its region). Same
 *    remaining gap as Sandstone Defender: mod-carried statics.
 *  - Tranquility: "[Augment] Spells cost [one] more to play during battle."
 *    needs a static COST modifier layer — canPayCard/payCard read only the
 *    printed cost, with no hook for in-play modifiers. Inert augmentText.
 *
 * ⚠ APPROXIMATIONS (implemented subsets, noted per card):
 *  - Swirling Shardform: there is no 'Shard' ResourceKind (the same gap the
 *    Fire/Water Resource parks named). Shards are approximated as dormant
 *    PRISMITES — the closest existing kind: 1 mana when activated, no
 *    affinity, spawns dormant. Fidelity leak: an active prismite can be
 *    exchanged for a real element during planning (R17), which a Shard could
 *    not.
 *  - Skybreaker: "Erase me" is approximated by the engine's sacrifice-self
 *    activation cost — an unmodded Skybreaker therefore lands in the BIN
 *    instead of being erased (a modded host is erased anyway, Unstable).
 *  - Tenebrous Bulborb: "I gain -2/-2" (static) is applied as permanent
 *    -1/-1 counters, once, when the card spawns or when it lands on a host
 *    as a mod. Deviation: later +1/+1 counters cancel it pairwise.
 *  - The Bonesculptor: "play one unit ... from your bin each deployment" is
 *    modelled as a free bounded activated ability (deploy plays resolve
 *    immediately, so the shapes match); the full cost of the played unit is
 *    still paid. Activating it outside deployment (or with no eligible card)
 *    wastes the once-per-turn budget.
 *  - Throwing Boulder: the sacrifice and the "only if I have an adjacent
 *    ally" precondition are checked/paid at RESOLUTION (the Immolate
 *    precedent — there is no activation-precondition hook). No adjacent ally
 *    at resolution → nothing happens, the Boulder survives.
 *  - Throw off a Cliff: TargetSpec has no filters, so "4 or more defense" is
 *    enforced at RESOLUTION — an under-4 target simply survives (no-op).
 *  - Squish: the engine's cast-time targeting holds one target per part, so
 *    the SECOND target ("another target unit") is a mid-resolution pick by
 *    the caster (Tidal Reversion precedent). The damage source's attrs are
 *    the ally CARD's printed attrs (dealEffectDamage reads the card name).
 */
import type { Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, getCard, type EffectDef } from '../dsl.ts';

// ─────────────────────────── shared helpers ───────────────────────────

const isEnt = (t: unknown): t is Entity =>
  !!t && typeof t === 'object' && 'id' in (t as object);

/** present seats of a region, region-owner order (stable) */
const presentOpponents = (g: E, region: number, me: Seat): Seat[] =>
  g.s.regions[region]!.presentSeats.filter(s => s !== me);

/** True while endTurn() is resolving end-of-turn triggers — a ctx.choose
 * suspension there is unsafe (batch-fire-a precedent), so choose-based
 * effects reachable via grafts fall back to deterministic auto-picks. */
const inEndOfTurn = (g: E): boolean => g.s.phase === 'deploy' && g.s.deployPlayer === null;

// ────────────────────────────── the cards ──────────────────────────────

// "[Augment] After the blocking step, I deal 1 damage to each opponent for
// each blocked column." — e/2 1/3 Porcupine Beast Unit. Text-box [Augment]:
// live when played normally, donated to hosts. "After the blocking step" =
// the 'blocksDeclared' event (fires exactly once per block declaration).
// Condition at event time (R1): at least one column was blocked. The AMOUNT
// is read at resolution (R1) from the sticky blocks keys — R13: a blocked
// column stays blocked even if its blockers die. "Each opponent" = the battle
// region's present seats other than mine (R25).
card('Roving Quillback', {
  augmentText: [{
    type: 'triggered', events: ['blocksDeclared'],
    label: 'I deal 1 damage to each opponent per blocked column',
    when: (g) => Object.keys(g.s.battle?.blocks ?? {}).length > 0,
    effect: {
      run: (g, ctx) => {
        const b = g.s.battle;
        if (!b) return;
        const n = Object.keys(b.blocks).length;
        for (const seat of presentOpponents(g, ctx.region, ctx.controller)) {
          g.dealEffectDamage(ctx, { player: seat }, n);
        }
      },
    },
  }],
});

// "[Augment] After combat, delete all units." — e/8 8/9 {Piercing} Bedlam
// Primordial Unit. Text-box [Augment]. NOT self:true — the afterCombat event
// carries no source unit (Embermaw precedent). "All units" is region-scoped
// (R12): every unit in the battle region, both sides, INCLUDING the carrier
// itself, is deleted (nontoken unmodded → owner's bin).
card('Ruinbringer', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'delete all units (after combat)',
    effect: {
      run: (g, ctx) => {
        for (const u of g.unitsIn(ctx.region)) g.destroy(u, 'is deleted');
      },
    },
  }],
});

// "[Augment] Your other units gain +0/+2." — e/2 0/3 Anima Guardian Unit.
// Text-box [Augment], live when played normally: a static projecting +0/+2
// onto its controller's OTHER units in its region ("other" — never itself).
// The augment-DONATED form is still PARKED (see header: mod-carried
// statics); the inert augmentText entry (events: []) keeps the card
// recognised as an augment (Conduit of Pain precedent).
card('Sandstone Defender', {
  statics: [{
    affects: (g, self, t) =>
      t.kind === 'unit' && t.id !== self.id && t.controller === self.controller,
    dt: 2,
  }],
  augmentText: [{
    type: 'triggered', events: [],   // PARKED — mod-carried statics
    label: 'your other units gain +0/+2 (augment-donated form not implemented)',
    effect: { run: () => { /* PARKED */ } },
  }],
});

// "I deal 3 damage to any target." — ee/3, {Battle} {Reaping} Primordial
// Spell. dealEffectDamage reads the card's printed attrs, so {Reaping}
// (kill → the controller draws) is handled by the engine.
card('Seismomancy', {
  spellEffect: {
    targets: { what: 'any', prompt: 'Seismomancy: I deal 3 damage to any target' },
    run: (g, ctx) => { g.dealEffectDamage(ctx, ctx.targets[0]!, 3); },
  },
});

// "[Augment] Erase me: Negate all spell effects." — ee/2 2/2 Arcane
// Primordial {Virus} Unit. An ACTIVATED ability in the [Augment] text box
// (live when played normally, donated to hosts, playable as a battle Virus).
// ⚠ "Erase me" is approximated by the sacrifice-self activation cost (see
// header): an unmodded Skybreaker is binned; a modded host is erased anyway
// (Unstable). "All spell effects" = every un-negated spell / spell unit /
// spell token / ambush on the stack (R22 counts ambushes; triggered and
// activated abilities are not spell effects).
card('Skybreaker', {
  augmentText: [{
    type: 'activated', cost: { sacrificeSelf: true },
    label: 'Erase me: negate all spell effects',
    effect: {
      run: (g) => {
        for (const it of g.s.stack) {
          if (it.negated) continue;
          if (it.kind === 'spell' || it.kind === 'spellUnit' || it.kind === 'spellToken' || it.kind === 'ambush') {
            g.negate(it.id);
          }
        }
      },
    },
  }],
});

// "[Switch1] Target ally deals damage equal to its defense to another target
// unit." — e/2, {Battle} Rock Spell. The ally is the cast-time target; the
// SECOND target is a mid-resolution caster pick (⚠ see header), auto-picked
// when only one candidate exists (and in end-of-turn graft resolutions,
// where suspending is unsafe). The amount is the ally's defense at
// RESOLUTION (R1); the damage source is the ALLY (its printed attrs apply).
// Bounded graft ([Switch1], R9).
const squishEffect: EffectDef = {
  targets: { what: 'allyUnit', prompt: 'Squish: target ally deals damage equal to its defense to another unit' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t)) return;
    const ally = g.entity(t.id);
    if (!ally) return;
    const others = g.unitsIn(ctx.region).filter(u => u.id !== ally.id);
    if (!others.length) {
      g.ev('info', 'Squish: no other unit to squish — no effect.');
      return;
    }
    const victim = (others.length === 1 || inEndOfTurn(g)) ? others[0]! : (() => {
      const id = ctx.choose('victim', {
        kind: 'electricPath', seat: ctx.controller,
        prompt: `Squish: ${ally.card} squishes which unit?`,
        options: others.map(u => ({ label: u.card, value: u.id })),
      }) as EntityId;
      return g.entity(id);
    })();
    if (!victim) return;
    const dmg = g.effStats(ally)[1];
    // the ALLY deals the damage: its card's printed attrs drive the riders
    g.dealEffectDamage({ ...ctx, sourceName: ally.card, sourceId: ally.id }, victim, dmg);
  },
};
card('Squish', {
  spellEffect: squishEffect,
  graftEffect: { bounded: true, effect: squishEffect },
});

// "When one of your units survives damage, [Switch1] Create a 2/2 unit." —
// ee/2 1/3 Mystic Rock Unit. The 'damage' event fires right after damage is
// marked (combat and effect damage alike), before deaths are processed —
// when() checks at event time (R1) that the damaged unit is mine ("one of
// your units", itself included) and survives (marked damage < toughness).
// Edge: damage from a Deadly source passes the check but the unit then dies
// (rare; noted). Poisonous damage becomes counters and never fires 'damage'.
// Region auto-scoped (R12). Bounded ([Switch1], R9); the 2/2 is the graft.
const stonebornMake: EffectDef = {
  run: (g, ctx) => {
    g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [2, 2] });
  },
};
card('Stoneborn Progenitor', {
  abilities: [{
    type: 'triggered', events: ['damage'], bounded: true, graftCause: true,
    label: 'create a 2/2 unit (one of your units survived damage)',
    when: (g, self, ev) => {
      const u = g.entity(ev.data?.unit as EntityId);
      return !!u && u.controller === self.controller && u.damage < g.effStats(u)[1];
    },
    effect: stonebornMake,
  }],
  graftEffect: { bounded: true, effect: stonebornMake },
});

// "When I spawn, create two Shards. {i}(Dormant)" — e/2 2/1 Primordial
// Maelstrom Unit. PLAYTEST FIX: this used to push dormant PRISMITES, which is
// a straight upgrade — a prismite can be exchanged for any element during
// planning (R17). Real Shards (E.createShard) give mana only.
card('Swirling Shardform', {
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true,
    label: 'create two Shards (dormant)',
    effect: { run: (g, ctx) => { g.createShard(ctx.controller, 2, 'Swirling Shardform'); } },
  }],
});

// "[Augment] I gain -2/-2." — e/1 5/4 Luminary Horror {Virus} Unit. The
// static is approximated as permanent -1/-1 counters applied ONCE (⚠ see
// header): entry 1 fires on the card's own spawn (own [Augment] text is live
// when played normally → an effective 3/2); entry 2 fires when a Tenebrous
// Bulborb mod lands on a host (deployment augment or battle Virus) — "I" is
// then the host. The budgets marker dedupes the double-scan that would
// happen if the host card itself were a Bulborb carrying a Bulborb mod.
const bulborbShrink: EffectDef = {
  run: (g, ctx) => {
    const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
    if (self) g.addCounters(self, -2);
  },
};
card('Tenebrous Bulborb', {
  augmentText: [
    {
      type: 'triggered', events: ['spawned'], self: true,
      label: 'I gain -2/-2',
      effect: bulborbShrink,
    },
    {
      type: 'triggered', events: ['modApplied'],
      label: 'I gain -2/-2 (augmented host)',
      when: (g, self, ev) => {
        if (ev.data?.host !== self.id) return false;
        const mod = g.entity(ev.data?.mod as EntityId);
        if (mod?.card !== 'Tenebrous Bulborb') return false;
        const key = `tb:${ev.data?.mod}`;
        if (self.budgets[key]) return false;   // dedupe: one trigger per application
        self.budgets[key] = 1;
        return true;
      },
      effect: bulborbShrink,
    },
  ],
});

// "You may play one unit with no abilities from your bin each deployment.
// {i}(Attributes are not abilities.)" — e/2 2/2 Primordial Occult Unit.
// ⚠ Modelled as a free bounded activated ability (see header): once per turn
// (= per deployment), during YOUR deployment, pick a unit card in your bin
// that has no abilities (no triggered/activated/spell/graft text — printed
// attributes and type-line augment grants are fine) and that you can afford;
// its cost is paid normally and it spawns (spawn triggers fire). Declining
// is allowed; activating outside deployment wastes the budget (noted).
card('The Bonesculptor', {
  abilities: [{
    type: 'activated', cost: {}, bounded: true,
    label: 'play a unit with no abilities from your bin (each deployment)',
    effect: {
      run: (g, ctx) => {
        if (g.s.phase !== 'deploy') {
          g.ev('info', 'The Bonesculptor: only during deployment — no effect.');
          return;
        }
        const bin = g.player(ctx.controller).bin;
        const vanilla = (n: string): boolean => {
          const d = getCard(n);
          return d.kind === 'unit'
            && !(d.abilities?.length) && !(d.augmentText?.length)
            && !d.graftEffect && !d.spellEffect && !d.ambush;
        };
        const opts = bin
          .map((n, i) => ({ label: n, value: i, card: n }))
          .filter(o => vanilla(bin[o.value]!) && g.canPayCard(ctx.controller, bin[o.value]!));
        if (!opts.length) {
          g.ev('info', 'The Bonesculptor: no playable ability-free unit in your bin.');
          return;
        }
        const pick = ctx.choose('pick', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'The Bonesculptor: play a unit with no abilities from your bin',
          options: [...opts, { label: 'Decline', value: -1 }],
        }) as number;
        if (pick < 0) return;
        const name = bin[pick];
        if (name === undefined || !vanilla(name) || !g.canPayCard(ctx.controller, name)) return;
        bin.splice(pick, 1);
        g.payCard(ctx.controller, name);
        g.ev('info', `The Bonesculptor: ${g.pname(ctx.controller)} plays ${name} from the bin.`);
        g.spawnUnit(ctx.controller, name, ctx.region);
      },
    },
  }],
});

// "Delete target unit with 4 or more defense." — e/2, {Battle} Rock Spell.
// ⚠ TargetSpec has no filters (see header): any unit is targetable at cast;
// the "4 or more defense" restriction is enforced at RESOLUTION against live
// stats (R1) — an under-4 target survives and the spell does nothing.
card('Throw off a Cliff', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Throw off a Cliff: delete target unit with 4 or more defense' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t)) return;
      const u = g.entity(t.id);
      if (!u) return;
      if (g.effStats(u)[1] >= 4) g.destroy(u, 'is deleted');
      else g.ev('info', `Throw off a Cliff: ${u.card} has less than 4 defense — nothing happens.`);
    },
  },
});

// "[Augment] Sacrifice me: I deal 3 damage to any target. Activate this
// ability only if I have an adjacent ally." — e/1 0/3 Rock Unit. An ACTIVATED
// ability in the [Augment] text box (live normally, donated to hosts — "me"
// is then the host). ⚠ The sacrifice and the adjacency precondition are
// resolved at RESOLUTION (Immolate precedent, see header): with no adjacent
// ally (formation adjacency, allies only) nothing happens and the unit
// survives. The damage source name stays 'Throwing Boulder' (its printed
// attrs — none — drive the damage riders even on a host).
card('Throwing Boulder', {
  augmentText: [{
    type: 'activated', cost: {},
    label: 'Sacrifice me: I deal 3 damage to any target (needs an adjacent ally)',
    effect: {
      targets: { what: 'any', prompt: 'Throwing Boulder: deal 3 damage to any target' },
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!self) return;
        const allies = g.adjacentInFormation(self.id).filter(u => u.controller === ctx.controller);
        if (!allies.length) {
          g.ev('info', 'Throwing Boulder: no adjacent ally — cannot be thrown.');
          return;
        }
        g.destroy(self, 'is sacrificed');
        g.dealEffectDamage(ctx, ctx.targets[0]!, 3);
      },
    },
  }],
});

// "[Augment] Enemies gain +2/+2." — ee/5 10/15 Primordial Rock Beast {Virus}
// Unit. Text-box [Augment], live when played normally: the drawback is a
// static projecting +2/+2 onto ENEMY units in its region (R12: attackers
// entering its region grow; its controller's units never do). The
// augment-DONATED form is still PARKED (see header: mod-carried statics);
// inert augmentText keeps it recognised as an augment / battle Virus.
// mod-carried statics are live (host-anchored), so the same static covers the
// augment-donated form too (un-parked 2026-08-18)
card('Towering Colossus', {
  augmentable: true,
  statics: [{
    affects: (g, self, t) => t.kind === 'unit' && t.controller !== self.controller,
    dp: 2, dt: 2,
  }],
});

// "[Augment] Spells cost [one] more to play during battle." — ee/3 3/4
// Mystic Structure Unit. PARKED (see header): static cost modifiers have no
// engine hook (canPayCard/payCard read printed costs only). Inert augmentText
// keeps it recognised as an augment; it changes no costs yet.
card('Tranquility', {
  augmentText: [{
    type: 'triggered', events: [],   // PARKED — never fires
    label: 'spells cost [1] more during battle (not implemented)',
    effect: { run: () => { /* PARKED */ } },
  }],
});
