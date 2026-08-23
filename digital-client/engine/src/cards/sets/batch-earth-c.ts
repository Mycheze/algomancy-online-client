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
 *  (Nothing is parked in this batch any more. The three entries that used to
 *  sit here have all been overtaken:
 *   - Sandstone Defender / Towering Colossus, parked on "mod-carried statics —
 *     statics run only while the holder is a UNIT in play". E.anchored()
 *     radiates a mod's statics from its HOST, so both donate correctly; both
 *     are now plain `augmentable: true` + a static, with no inert stand-in.
 *   - Tranquility, parked on "a static COST modifier layer". R59's CostMod is
 *     that layer, and the card has used it since.)
 *
 * ⚠ APPROXIMATIONS (implemented subsets, noted per card):
 *  - Swirling Shardform: NO LONGER an approximation. This note used to read
 *    "there is no 'Shard' ResourceKind, so Shards are dormant PRISMITES" —
 *    E.createShard() and a real 'shard' kind exist now, and the card calls
 *    them, so the prismite fidelity leak it warned about is gone.
 * ✔ Skybreaker: "Erase me" is REAL as of CARD-TODO #15. It used to be
 *    approximated by the sacrifice-self activation cost, which put an unmodded
 *    Skybreaker in the BIN — a death, with death triggers and R40 recursion off
 *    it. `AbilityCost.eraseSelf` is its own choice-free cost kind now, paid by
 *    E.payActivationCost through E.eraseFromPlay: no bin, no death, no despawn.
 *    (A modded host was erased anyway under Unstable; that is unchanged.)
 *  - Tenebrous Bulborb: NO LONGER an approximation. This note used to read
 *    '"I gain -2/-2" (static) is applied as permanent -1/-1 counters, once …
 *    later +1/+1 counters cancel it pairwise'. Playtest VEAV rejected exactly
 *    that; it is a real StaticMod on the anchor now, so it is continuous,
 *    never on the stack, and leaves with the virus.
 *  - The Bonesculptor: "play one unit ... from your bin each deployment" is
 *    modelled as a free bounded activated ability (deploy plays resolve
 *    immediately, so the shapes match); the full cost of the played unit is
 *    still paid. Activating it outside deployment (or with no eligible card)
 *    wastes the once-per-turn budget.
 *  - Throwing Boulder: the sacrifice and the "only if I have an adjacent
 *    ally" precondition are checked/paid at RESOLUTION (the Immolate
 *    precedent — there is no activation-precondition hook). No adjacent ally
 *    at resolution → nothing happens, the Boulder survives.
 *  - Squish: the damage source's attrs are the ally CARD's printed attrs
 *    (dealEffectDamage reads the card name).
 *    (Two entries used to sit here: Throw off a Cliff enforcing "4 or more
 *    defense" at resolution because TargetSpec had no filters, and Squish
 *    picking its second target mid-resolution because a spec held one target
 *    per part. R64 added the restriction seam and R58 the per-slot one, and
 *    both cards use them — the restriction is now part of what makes a target
 *    legal, and both of Squish's targets are declared at cast.)
 */
import type { EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, getCard, unitRestrict, type EffectDef } from '../dsl.ts';
import { isEnt } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** present seats of a region, region-owner order (stable) */
const presentOpponents = (g: E, region: number, me: Seat): Seat[] =>
  g.s.regions[region]!.presentSeats.filter(s => s !== me);

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
        g.dealEffectDamageAll(ctx,   // R80: "each opponent" is one batch
          presentOpponents(g, ctx.region, ctx.controller).map(seat => ({ target: { player: seat }, n })));
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
// Text-box [Augment]: a static projecting +0/+2 onto its controller's OTHER
// units in its region ("other" — never itself), live in BOTH forms.
//
// UN-PARKED: the note here used to say "the augment-DONATED form is still
// PARKED (mod-carried statics)" and carried an inert `augmentText` stand-in to
// keep the card recognised as an augment. E.anchored() radiates a mod's
// statics from its HOST, so the same static already covered the donated form —
// test 1802 in 18-earth-c has asserted it for a while. The stand-in is gone;
// `augmentable: true` is what makes the card applicable (Towering Colossus's
// shape, which un-parked on the same day and the same primitive).
card('Sandstone Defender', {
  augmentable: true,
  statics: [{
    affects: (g, self, t) =>
      t.kind === 'unit' && t.id !== self.id && t.controller === self.controller,
    dt: 2,
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
// "All spell effects" = every un-negated spell / spell unit / spell token /
// ambush on the stack (R22 counts ambushes; triggered and activated abilities
// are not spell effects).
//
// "ERASE ME" IS A COST, and that is what makes this card the odd one out of
// the four CARD-TODO #15 named. The other three are SPELLS erasing themselves
// on disposal, which needed a new route through `E.dischargeItem`; here the
// subject is a UNIT IN PLAY and the erase is paid on the way to the stack,
// before anybody may respond — so it belongs in `AbilityCost`, next to
// `sacrificeSelf`, and `E.payActivationCost` charges it in the cast window.
// It used to BE `sacrificeSelf`, which is a real divergence and not a wording
// one: a sacrifice is a death, so the card reached D's bin, fired every
// "when a unit dies" trigger, and could be recurred or trashed out of the bin
// afterwards. An erase does none of that — no bin, no death, no despawn, R40
// cannot reach it. (Spore of Regenesis is the same reading of the same clause
// one zone over: there "erase me" is the cost of a death trigger and is paid
// out of the bin.)
card('Skybreaker', {
  augmentText: [{
    type: 'activated', cost: { eraseSelf: true },
    label: 'Erase me: negate all spell effects',
    effect: {
      run: (g) => {
        let negated = 0;
        for (const it of [...g.s.stack]) {   // R68: negate() splices
          if (it.kind === 'spell' || it.kind === 'spellUnit' || it.kind === 'spellToken' || it.kind === 'ambush') {
            g.negate(it.id);
            negated++;
          }
        }
        if (!negated) g.ev('info', 'Skybreaker: there is no spell effect on the stack to negate.');
      },
    },
  }],
});

// "[Switch1] Target ally deals damage equal to its defense to another target
// unit." — e/2, {Battle} Rock Spell. The amount is the ally's defense at
// RESOLUTION (R1); the damage source is the ALLY (its printed attrs apply).
// Bounded graft ([Switch1], R9).
//
// R67/R82 (playtest VEAV): "Squish, on cast, only has you select 1 target
// unit, but it needs 2 targets (a target ally and any target)." It printed
// TWO targets and declared one — the victim was a mid-resolution ctx.choose,
// so the spell sat on the stack aiming at nobody and the second "target"
// could not be responded to, redirected or lost. Same shape as Fight: a
// two-slot spec with per-slot legality, slot 0 an ally of the CASTER and slot
// 1 any other unit (the collector already keeps the two distinct).
//
// Both are re-checked at resolution rather than trusted from cast (R56/R58) —
// Enigmatic Warder can move a slot afterwards, and "ally" means ally of this
// spell's controller, never of the redirector's.
const squishEffect: EffectDef = {
  targets: {
    what: 'unit', count: 2, min: 2,
    slots: ['allyUnit', 'unit'],
    prompt: 'Squish: target ally deals damage equal to its defense to another target unit',
    slotPrompts: [
      'Squish: target ally (it deals damage equal to its defense)',
      'Squish: another target unit (it takes the damage)',
    ],
  },
  run: (g, ctx) => {
    const [a, b] = [ctx.targets[0], ctx.targets[1]];
    if (!isEnt(a) || !isEnt(b) || !g.entity(a.id) || !g.entity(b.id)) {
      g.ev('info', 'Squish: a target is gone — nothing is squished.');
      return;
    }
    if (a.id === b.id) { g.ev('info', 'Squish: "another" — one unit cannot squish itself.'); return; }
    if (a.controller !== ctx.controller) {
      g.ev('info', `Squish: ${a.card} is not ${g.pname(ctx.controller)}'s ally any more — nothing is squished.`);
      return;
    }
    const dmg = g.effStats(a)[1];
    if (dmg <= 0) { g.ev('info', `Squish: ${a.card} has no defense left — no damage.`); return; }
    // the ALLY deals the damage: its card's printed attrs drive the riders
    g.dealEffectDamage({ ...ctx, sourceName: a.card, sourceId: a.id }, b, dmg);
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
  creates: ['Unit Token'],
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

// "[Augment] I gain -2/-2." — e/1 5/4 Luminary Horror {Virus} Unit.
//
// PLAYTEST FIX (VEAV, round 15): "The 'I get -2/-2' isn't a trigger that
// should go on the stack. It's a static effect." It is, and this used to be
// the ⚠ approximation in the header: two triggered abilities that put
// PERMANENT -1/-1 counters on whatever the card was attached to. Three things
// were wrong with that and all of them decided games. It went on the stack,
// so there was a window to respond to a static. The counters were permanent,
// so erasing the virus left the shrink behind. And counters cancel +1/+1
// counters pairwise, so a -2/-2 that should be a flat layer ate two real
// counters instead.
//
// It is a plain static now. `affects` matches the ANCHOR itself, which is
// exactly what "[Augment] I …" means: the anchor is the card when it is a
// unit in play (own [Augment] text is live when played normally — an
// effective 3/2) and the HOST when the card is worn as a mod (staticsFor's
// anchored() walk reads a mod's statics from its host). Two Bulborbs on one
// host stack, which is right — each is its own -2/-2.
card('Tenebrous Bulborb', {
  augmentable: true,
  statics: [{ affects: (_g, self, t) => t.id === self.id, dp: -2, dt: -2 }],
});

// "You may play one unit with no abilities from your bin each deployment.
// {i}(Attributes are not abilities.)" — e/2 2/2 Primordial Occult Unit.
// ⚠ Modelled as a free bounded activated ability (see header): once per turn
// (= per deployment), during YOUR deployment, pick a unit card in your bin
// that has no abilities (no triggered/activated/spell/graft text — printed
// attributes and type-line augment grants are fine) and that you can afford;
// its cost is paid normally and it spawns (spawn triggers fire). Declining
// is allowed.
//
// R77: both preconditions are ACTIVATION gates now — `timing: 'deploy'` for
// the window (R49's own field, which this card was re-implementing at
// resolution) and `usableWhen` for "is there anything in the bin I could
// actually play". It is `bounded`, so being offered when it can do nothing
// did not merely waste a click: activating it burnt the once-per-turn budget.
const bonesculptorPicks = (g: E, seat: Seat): { label: string; value: number; card: string }[] => {
  const bin = g.player(seat).bin;
  const vanilla = (n: string): boolean => {
    const d = getCard(n);
    return d.kind === 'unit'
      && !(d.abilities?.length) && !(d.augmentText?.length)
      && !d.graftEffect && !d.spellEffect && !d.ambush;
  };
  return bin
    .map((n, i) => ({ label: n, value: i, card: n }))
    .filter(o => vanilla(bin[o.value]!) && g.canPayCard(seat, bin[o.value]!));
};
card('The Bonesculptor', {
  abilities: [{
    type: 'activated', cost: {}, bounded: true, timing: 'deploy',
    label: 'play a unit with no abilities from your bin (each deployment)',
    usableWhen: (g, _self, seat) => bonesculptorPicks(g, seat).length > 0,
    effect: {
      run: (g, ctx) => {
        const bin = g.player(ctx.controller).bin;
        const vanilla = (n: string): boolean => {
          const d = getCard(n);
          return d.kind === 'unit'
            && !(d.abilities?.length) && !(d.augmentText?.length)
            && !d.graftEffect && !d.spellEffect && !d.ambush;
        };
        const opts = bonesculptorPicks(g, ctx.controller);
        if (!opts.length) {
          ctx.refundBudget?.();   // R113: no offer could be made, so the use is not spent
          g.ev('info', 'The Bonesculptor: no playable ability-free unit in your bin.');
          return;
        }
        const pick = ctx.choose('pick', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'The Bonesculptor: play a unit with no abilities from your bin',
          options: [...opts, { label: 'Decline', value: -1 }],
        }) as number;
        if (pick < 0) {
          ctx.refundBudget?.();   // R113: declining a "you may" never spends it
          g.ev('info', 'The Bonesculptor: no unit is played from the bin.');
          return;
        }
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
// R64: "with 4 or more defense" is part of what makes a target LEGAL, so only
// units at 4+ are ever offered; the resolution check below is the R5/R56 half,
// for defense that changes between cast and resolution. (The "⚠ TargetSpec has
// no filters … any unit is targetable at cast" line that used to sit here was
// contradicted by the spec five lines below it — and by the header's own
// retraction.)
card('Throw off a Cliff', {
  spellEffect: {
    // R64: "with 4 or more defense" gates which units are legal targets at
    // all; the resolution check stays for defense that changes in between.
    targets: {
      what: 'unit', prompt: 'Throw off a Cliff: delete target unit with 4 or more defense',
      restrict: unitRestrict((g, u) => g.effStats(u)[1] >= 4),
    },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t)) return;
      const u = g.entity(t.id);
      if (!u) {
        g.ev('info', 'Throw off a Cliff: the target is gone — nothing is deleted.');
        return;
      }
      if (g.effStats(u)[1] >= 4) g.destroy(u, 'is deleted');
      else g.ev('info', `Throw off a Cliff: ${u.card} has less than 4 defense — nothing happens.`);
    },
  },
});

// "[Augment] Sacrifice me: I deal 3 damage to any target. Activate this
// ability only if I have an adjacent ally." — e/1 0/3 Rock Unit. An ACTIVATED
// ability in the [Augment] text box (live normally, donated to hosts — "me"
// and "I" are then the host).
//
// R77 (playtest XCYX, 2026-08-22): "Throwing Boulder was allowed to be
// activated without having adjacent allies. It didn't resolve, but it
// shouldn't have been allowed to be activated. And also, in order to activate
// it, sacrificing him should have happened as a cost to even put the ability
// on the stack." Both halves were real and both are fixed here:
//
//  - the sacrifice is `cost: { sacrificeSelf: true }`, paid in the cast window
//    on the way to the stack (R49/R57/R73), not a `g.destroy` at resolution;
//  - "only if I have an adjacent ally" is `usableWhen`, so the ability is not
//    offered and is refused (R64's principle), instead of being activated and
//    then resolving into nothing.
//
// Adjacency is R75's: sides and above/below within the formation, nothing
// diagonal — and adjacent allies only exist while I am IN a formation, so out
// of combat this ability is simply not available.
//
// R1: the condition is checked once, at activation, and is NOT re-checked at
// resolution — for a self-sacrificing ability it could not be, since the cost
// has already removed its own subject by then. The damage lands whatever
// happens to the ally in between.
card('Throwing Boulder', {
  augmentText: [{
    type: 'activated', cost: { sacrificeSelf: true },
    label: 'Sacrifice me: I deal 3 damage to any target (only with an adjacent ally)',
    usableWhen: (g, self, seat) =>
      g.adjacentInFormation(self.id).some(u => u.controller === seat),
    effect: {
      targets: { what: 'any', prompt: 'Throwing Boulder: deal 3 damage to any target' },
      run: (g, ctx) => {
        // the carrier is already in the bin: the sacrifice was the cost. The
        // damage still comes FROM Throwing Boulder (ctx.sourceName), which is
        // what its riders read.
        g.dealEffectDamage(ctx, ctx.targets[0]!, 3);
      },
    },
  }],
});

// "[Augment] Enemies gain +2/+2." — ee/5 10/15 Primordial Rock Beast {Virus}
// Unit. Text-box [Augment], live when played normally: the drawback is a
// static projecting +2/+2 onto ENEMY units in its region (R12: attackers
// entering its region grow; its controller's units never do).
// Mod-carried statics are live (host-anchored via E.anchored), so the same
// static covers the augment-donated form too — un-parked 2026-08-18. (The
// "still PARKED … inert augmentText" sentence that used to sit between those
// two was left behind by that unpark and has been removed.)
card('Towering Colossus', {
  augmentable: true,
  statics: [{
    affects: (g, self, t) => t.kind === 'unit' && t.controller !== self.controller,
    dp: 2, dt: 2,
  }],
});

// "[Augment] Spells cost [one] more to play during battle." — ee/3 3/4
// Mystic Structure Unit. LIVE as of the R59 cost-modifier layer (it was parked
// for want of one, and the playtest report was "Tranquility isn't taxing
// spells" — it wasn't, it couldn't).
//
// Scope, clause by clause:
//  - "Spells" = the spell CARD kinds you play from hand: spell and spellUnit.
//    A spell TOKEN (Fireball, Poison) is cast from play, not played, and a
//    unit is not a spell.
//  - "to play" = playing the card. Applying it as a mod is NOT playing (R37),
//    which the purpose: 'mod' lookup handles for free.
//  - "during battle" = the battle phase only; deployment casts are untaxed.
//  - Unqualified subject, so it taxes BOTH players — and it is region-scoped
//    (R12) like every static, so it bites in whichever region it is standing
//    in, attackers included.
// Text-box [Augment], so the modifier radiates from the card played normally
// AND from the augment mod anchored on its host, exactly like a static.
card('Tranquility', {
  augmentable: true,
  costMods: [{
    delta: (g, _self, ctx) =>
      g.s.phase === 'battle'
        && ctx.purpose === 'play'
        && (ctx.card.kind === 'spell' || ctx.card.kind === 'spellUnit')
        ? 1 : 0,
  }],
});
