/* batch-earth-c — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Earth cards scripted over the printed data in printed.json
 * (never hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: CR 109.3a, 109.3b (conditions at event time, amounts at resolution),
 * CR 704.6, 704.6b (fizzle vs partial), CR 704.1a (mid-resolution choices via ctx.choose),
 * CR 803.4 (bounded budgets per card), CR 601.2, 101.6 (regions exclusive — listeners and
 * "all units" are region-scoped), CR 608.4c (a blocked column stays blocked — the
 * sticky blocks keys ARE the blocked columns), CR 802.3 (Deadly), CR 700.1a (`isSpellEffect`
 * is "spell effect"; an ambush on the stack is NOT one — report #218), CR 601.4d ("each opponent" reads the
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
 *   - Tranquility, parked on "a static COST modifier layer". The CostMod (CR 111.10) is
 *     that layer, and the card has used it since.)
 *
 * ⚠ APPROXIMATIONS (implemented subsets, noted per card):
 *  - Swirling Shardform: NO LONGER an approximation. This note used to read
 *    "there is no 'Shard' ResourceKind, so Shards are dormant PRISMITES" —
 *    E.createShard() and a real 'shard' kind exist now, and the card calls
 *    them, so the prismite fidelity leak it warned about is gone.
 * ✔ Skybreaker: "Erase me" is REAL as of CARD-TODO #15. It used to be
 *    approximated by the sacrifice-self activation cost, which put an unmodded
 *    Skybreaker in the BIN — a death, with death triggers and trash triggers off
 *    it. `AbilityCost.eraseSelf` is its own choice-free cost kind now, paid by
 *    E.payActivationCost through E.eraseFromPlay: no bin, no death, no despawn.
 *    (A modded host was erased anyway under Unstable; that is unchanged.)
 *  - Tenebrous Bulborb: NO LONGER an approximation. This note used to read
 *    '"I gain -2/-2" (static) is applied as permanent -1/-1 counters, once …
 *    later +1/+1 counters cancel it pairwise'. Playtest VEAV rejected exactly
 *    that; it is a real StaticMod on the anchor now, so it is continuous,
 *    never on the stack, and leaves with the virus.
 *  - (The Bonesculptor's entry is GONE. It read "modelled as a free bounded
 *    activated ability (deploy plays resolve immediately, so the shapes
 *    match)". CT-255 made it what CR 707.10 says it is, a standing permission:
 *    a `playPermissions` grant offering `playFromBin` in deployment. See the card.)
 *  - (Throwing Boulder's entry is GONE. It read "the sacrifice and the 'only
 *    if I have an adjacent ally' precondition are checked/paid at RESOLUTION
 *    (the Immolate precedent — there is no activation-precondition hook)".
 *    The gate-and-cost fix built both hooks: `cost: { sacrificeSelf: true }` and
 *    `usableWhen: g.adjacentInFormation(self.id).some(...)`. See the card.)
 *  - (Squish's entry is GONE too. It read "the damage source's attrs are the
 *    ally CARD's printed attrs (dealEffectDamage reads the card name)".
 *    An engine fix changed that: `dealEffectDamageAll` resolves `ctx.sourceId` to the
 *    LIVE entity and reads `ownAttrs`, and Squish passes `sourceId: a.id` —
 *    so a GRANTED {Powerful}/{Deadly} on the ally counts, exactly as combat
 *    damage has always counted it. The printed-card read survives only as the
 *    fallback for a source with no entity, which is why Seismomancy's note
 *    ~135 is still correct and must NOT be "fixed" to match this one.)
 *  - (Two further entries used to sit here: Throw off a Cliff enforcing "4 or
 *    more defense" at resolution because TargetSpec had no filters, and Squish
 *    picking its second target mid-resolution because a spec held one target
 *    per part. The restriction seam (CR 110.3a) and the per-slot one (CR 110.3) were added, and
 *    both cards use them — the restriction is now part of what makes a target
 *    legal, and both of Squish's targets are declared at cast.)
 */
import type { EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, firstTarget, getCard, isPlayedSpellKind, isSpellEffect, unitRestrict, type EffectDef } from '../dsl.ts';
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
// Condition at event time (CR 109.3a): at least one column was blocked. The AMOUNT
// is read at resolution (CR 109.3b) from the sticky blocks keys — CR 608.4c: a blocked
// column stays blocked even if its blockers die. "Each opponent" = the battle
// region's present seats other than mine (CR 601.4d).
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
        g.dealEffectDamageAll(ctx,   // CR 112.8: "each opponent" is one batch
          presentOpponents(g, ctx.region, ctx.controller).map(seat => ({ target: { player: seat }, n })));
      },
    },
  }],
});

// "[Augment] After combat, delete all units." — e/8 8/9 {Piercing} Bedlam
// Primordial Unit. Text-box [Augment]. NOT self:true — the afterCombat event
// carries no source unit (Embermaw precedent). "All units" is region-scoped
// (CR 101.6): every unit in the battle region, both sides, INCLUDING the carrier
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
  // CR 721.1: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    statics: [{
      affects: (g, self, t) =>
        t.kind === 'unit' && t.id !== self.id && t.controller === self.controller,
      dt: 2,
    }],
  },
});

// "I deal 3 damage to any target." — ee/3, {Battle} {Reaping} Primordial
// Spell. dealEffectDamage reads the card's printed attrs, so {Reaping}
// (kill → the controller draws) is handled by the engine.
card('Seismomancy', {
  spellEffect: {
    targets: { what: 'any', prompt: 'Seismomancy: I deal 3 damage to any target' },
    run: (g, ctx) => {
      const t = firstTarget(g, ctx);   // CR D7.3a
      if (!t) return;
      g.dealEffectDamage(ctx, t, 3);
    },
  },
});

// "[Augment] Erase me: Negate all spell effects." — ee/2 2/2 Arcane
// Primordial {Virus} Unit. An ACTIVATED ability in the [Augment] text box
// (live when played normally, donated to hosts, playable as a battle Virus).
// "All spell effects" = every un-negated stack item `isSpellEffect` accepts —
// spell / spell unit / spell token (CR 700.1a). An Ambush is not one (report
// #218), and neither is a triggered or activated ability.
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
// afterwards. An erase does none of that — no bin, no death, no despawn, CR 801.2c
// cannot reach it. (Spore of Regenesis is the same reading of the same clause
// one zone over: there "erase me" is the cost of a death trigger and is paid
// out of the bin.)
card('Skybreaker', {
  augmentText: [{
    type: 'activated', cost: { eraseSelf: true },
    label: 'Erase me: negate all spell effects',
    effect: {
      run: (g, ctx) => {
        let negated = 0;
        for (const it of g.stackIn(ctx.region)) {   // CR 704.4: a copy; CT-234: this region's stack
          if (isSpellEffect(it.kind)) {
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
// RESOLUTION (CR 107.8); the damage source is the LIVE ALLY entity, so its CURRENT
// attrs apply — a GRANTED {Powerful}/{Deadly} counts, not just a printed one
// (CR 802.1; this line used to say "its printed attrs apply").
// Bounded graft ([Switch1], CR 722.5).
//
// CR 110.1b (playtest VEAV): "Squish, on cast, only has you select 1 target
// unit, but it needs 2 targets (a target ally and any target)." It printed
// TWO targets and declared one — the victim was a mid-resolution ctx.choose,
// so the spell sat on the stack aiming at nobody and the second "target"
// could not be responded to, redirected or lost. Same shape as Fight: a
// two-slot spec with per-slot legality, slot 0 an ally of the CASTER and slot
// 1 any other unit (the collector already keeps the two distinct).
//
// Both are re-checked at resolution rather than trusted from cast (CR 704.5, 110.4c) —
// Enigmatic Warder can move a slot afterwards, and "ally" means ally of this
// spell's controller, never of the redirector's.
const squishEffect: EffectDef = {
  targets: {
    what: 'unit', count: 2, min: 2,
    roles: '{0} deals its defense to {1}',
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
    // CR 704.5a (CT-232): "target ally" was judged once, as the item began to
    // resolve (a redirect onto a non-ally is caught there); not tested again
    // CR 802.9c, 112.6: Squish is an interaction between the two units, so if
    // EITHER is Unaware the ally's defense is read off its printed card. RAQ
    // "[Solved] Squish/Fight/Battle vs Source of damage": "Squish to make
    // Robot 10 deal its defense as damage to Bubb will cause no harm to Bubb".
    const collapsed = g.collapsedBy(a, [b]);
    const dmg = g.interactionStats(a, [b])[1];
    if (dmg <= 0) { g.ev('info', `Squish: ${a.card} has no defense left — no damage.`); return; }
    // the ALLY deals the damage, and `sourceId` makes it the LIVE entity:
    // dealEffectDamageAll reads its attributes. CR 112.6: and ONLY its
    // attributes — the same thread, "You look at units Attributes. It doesn't
    // matter if Squish is Powerful", so a virus on the Squish stack item
    // (`grantedAttrs`, CR 723.4) is dropped here. `Unaware` is the one flag still
    // handed over, so the receiving half collapses too (see `fight`).
    g.dealEffectDamage({ ...ctx, sourceName: a.card, sourceId: a.id, grantedAttrs: collapsed ? ['Unaware'] : [] }, b, dmg);
  },
};
card('Squish', {
  spellEffect: squishEffect,
  graftEffect: { bounded: true, effect: squishEffect },
});

// "When one of your units survives damage, [Switch1] Create a 2/2 unit." —
// ee/2 1/3 Mystic Rock Unit. The 'damage' event fires right after damage is
// marked (combat and effect damage alike), before deaths are processed —
// when() checks at event time (CR 109.3a) that the damaged unit is mine ("one of
// your units", itself included) and survives (marked damage < toughness).
// Edge: damage from a Deadly source passes the check but the unit then dies
// (rare; noted). Poisonous damage becomes counters and never fires 'damage'.
// Region auto-scoped (CR 101.6). Bounded ([Switch1], CR 722.5); the 2/2 is the graft.
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
// planning (CR 106.8a). Real Shards (E.createShard) give mana only.
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
  // CR 721.1: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    statics: [{ affects: (_g, self, t) => t.id === self.id, dp: -2, dt: -2 }],
  },
});

// "You may play one unit with no abilities from your bin each deployment.
// {i}(Attributes are not abilities.)" — e/2 2/2 Primordial Occult Unit.
// ⚠ Modelled as a free bounded activated ability (see header): once per turn
// (= per deployment), during YOUR deployment, pick a unit card in your bin
// that has NO ABILITIES — no text at all, through any channel; see
// `abilityFree` below for what that means and what it deliberately does not
// count — and that you can afford; its cost is paid normally and it spawns
// (spawn triggers fire). Declining is allowed.
//
// CR 705.3a: both preconditions are ACTIVATION gates now — `timing: 'deploy'` for
// the window (the activation-timing field, CR 705.2, which this card was re-implementing at
// resolution) and `usableWhen` for "is there anything in the bin I could
// actually play". It is `bounded`, so being offered when it can do nothing
// did not merely waste a click: activating it burnt the once-per-turn budget.
/**
 * "A unit with NO ABILITIES", read literally (2026-08-24 literal-reading audit).
 *
 * This used to test four channels — `abilities`, `augmentText`, `graftEffect`,
 * `spellEffect` (plus `ambush`) — which is the shape of the mechanism the
 * author had in mind, not the printed word. Forty-four cards in the pool carry
 * real printed rules text through some OTHER channel and were therefore
 * offered as "ability-free": Sandstone Defender ("[Augment] Your other units
 * gain +0/+2"), Towering Colossus, Transmogrifant, Aberrant Statweaver and
 * Monke are `statics`; Tranquility is a `costMod`; Dispatch Courier a
 * `playPermission`; Automaton of Abundance, Cosmic Conspirator and Worldbender
 * are replacements; Gatekeeper of Souls is `mustBeTargeted`. Every one of them
 * has a text box.
 *
 * A static IS an ability — the engine says so itself where it silences one
 * (`E.staticsFor`: "CR 712.1a: a silenced unit radiates nothing — a static IS an
 * ability"). So the test is now "the card def carries NO behaviour at all",
 * with exactly two things deliberately not counted:
 *   · attributes and type-line [Augment] attribute grants — the card's own
 *     reminder text says "(Attributes are not abilities.)", and `augmentable`
 *     is the plumbing flag that lets such a card be applied at all;
 *   · `xMin` / the `xPreview*` UI hooks, which are cost and display detail.
 */
/**
 * The keys a CardDef may carry that are printed IDENTITY or presentation
 * rather than rules text. Everything NOT in here counts as an ability.
 *
 * The list is INVERTED on purpose. An explicit list of behaviour fields —
 * which is what this started as — is wrong by default: it goes stale the day
 * someone adds a new channel to CardDef, and it goes stale SILENTLY, because
 * the card with the new behaviour simply starts being offered again. Written
 * this way, a new field is an ability until somebody deliberately says it is
 * not, and the failure mode is a card being refused (visible) rather than a
 * card being smuggled out of the bin (invisible). That is the same trade the
 * repo makes for its exemption lists everywhere else.
 *
 * `prophecy` is inert and it is the only judgement call here: a Prophecy is a
 * release condition on a CACHED card, not text-box rules, and both cards that
 * carry one (The Foretold, Tithe Enforcer) print a genuinely empty text box.
 * `attrs`/`augmentAttrs`/`augmentable` are inert by the card's own reminder
 * text, "(Attributes are not abilities.)".
 */
const INERT_KEYS = new Set([
  'name', 'kind', 'cost', 'mana', 'power', 'toughness', 'type', 'text',
  'factions', 'image', 'timing', 'burst', 'virus', 'unstable',
  'attrs', 'augmentAttrs', 'augmentable',   // "(Attributes are not abilities.)"
  'prophecy',                                // a cache-release condition, not text
  'xMin', 'xPreview', 'xPreviewRows',        // cost arithmetic and UI detail
]);

/**
 * "A unit with NO ABILITIES", read literally (2026-08-24 literal-reading audit).
 *
 * This used to test four channels — `abilities`, `augmentText`, `graftEffect`,
 * `spellEffect` (plus `ambush`) — which is the shape of the mechanism the
 * author had in mind, not the printed word. Forty-four cards in the pool carry
 * real printed rules text through some OTHER channel and were therefore
 * offered as "ability-free": Sandstone Defender ("[Augment] Your other units
 * gain +0/+2"), Towering Colossus, Transmogrifant, Aberrant Statweaver and
 * Monke are `statics`; Tranquility is a `costMod`; Dispatch Courier a
 * `playPermission`; Automaton of Abundance, Cosmic Conspirator and Worldbender
 * are replacements; Gatekeeper of Souls is `mustBeTargeted`. Every one of them
 * has a text box.
 *
 * A static IS an ability — the engine says so itself where it silences one
 * (`E.staticsFor`: "CR 712.1a: a silenced unit radiates nothing — a static IS an
 * ability"). So the test is "the card def carries no behaviour at all", by way
 * of INERT_KEYS above.
 */
const abilityFree = (n: string): boolean => {
  const d = getCard(n) as unknown as Record<string, unknown>;
  if (d.kind !== 'unit') return false;
  return !Object.keys(d).some((k) => {
    if (INERT_KEYS.has(k)) return false;
    const v = d[k];
    return Array.isArray(v) ? v.length > 0 : !!v;
  });
};
// CR 707.10 (CT-255) — A STANDING PERMISSION, NOT AN ABILITY. "You may play one
// unit with no abilities from your bin each deployment" is a fact about what its
// controller may do, and using it puts nothing on the stack: it cannot be
// responded to, and Containment Protocol ("negate all activated and triggered
// effects") has nothing to negate. It used to be built as a free bounded
// ACTIVATED ability whose resolution asked which unit, so the permission
// itself was an item. Now it is a `playPermissions` grant: each ability-free
// unit in the controller's bin is offered as an ordinary `playFromBin` action
// in deployment (`legalDeployActions`), paid in full ("you still pay" — the
// card says play, not put into play), played onto the deployment stack like
// any card (CR 507.5), and bounded once per deployment per Bonesculptor
// (`deployBinPlaysUsed`). It is a real PLAY (CR 301.9): `commitItem` fires
// 'cardPlayed' (CR 108.1a) with its item, and 'spawned' carries `from: 'bin'`.
card('The Bonesculptor', {
  playPermissions: [{
    playFromBinAtDeploy: (_g, self, ctx) =>
      ctx.seat === self.controller && ctx.from === 'bin' && abilityFree(ctx.card.name) ? 1 : 0,
  }],
});

// "Delete target unit with 4 or more defense." — e/2, {Battle} Rock Spell.
// CR 110.3a: "with 4 or more defense" is part of what makes a target LEGAL, so only
// units at 4+ are ever offered; the CR 704.5 half, for defense that changes
// between cast and resolution, is judged once as the spell begins to resolve
// (markIllegalTargets), and the run does not test it again (CR 704.5a, CT-232). (The "⚠ TargetSpec has
// no filters … any unit is targetable at cast" line that used to sit here was
// contradicted by the spec five lines below it — and by the header's own
// retraction.)
card('Throw off a Cliff', {
  spellEffect: {
    // CR 110.3a: "with 4 or more defense" gates which units are legal targets at
    // all; CR 704.5 judges it again, once, as the spell begins to resolve.
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
      // CR 704.5a (CT-232): "4 or more defense" was judged once, as the spell
      // began to resolve; it is not tested again in the run
      g.destroy(u, 'is deleted');
    },
  },
});

// "[Augment] Sacrifice me: I deal 3 damage to any target. Activate this
// ability only if I have an adjacent ally." — e/1 0/3 Rock Unit. An ACTIVATED
// ability in the [Augment] text box (live normally, donated to hosts — "me"
// and "I" are then the host).
//
// CR 111.7b, 111.7 (playtest XCYX, 2026-08-22): "Throwing Boulder was allowed to be
// activated without having adjacent allies. It didn't resolve, but it
// shouldn't have been allowed to be activated. And also, in order to activate
// it, sacrificing him should have happened as a cost to even put the ability
// on the stack." Both halves were real and both are fixed here:
//
//  - the sacrifice is `cost: { sacrificeSelf: true }`, paid in the cast window
//    on the way to the stack (CR 705.3, 111.7), not a `g.destroy` at resolution;
//  - "only if I have an adjacent ally" is `usableWhen`, so the ability is not
//    offered and is refused (the CR 705.3a principle), instead of being activated and
//    then resolving into nothing.
//
// Adjacency is as CR 603.2a and 603.2b define it: sides and above/below within the formation, nothing
// diagonal — and adjacent allies only exist while I am IN a formation, so out
// of combat this ability is simply not available.
//
// CR 111.7b: the condition is checked once, at activation, and is NOT re-checked at
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
        const t = firstTarget(g, ctx);   // CR D7.3a
        if (!t) return;
        g.dealEffectDamage(ctx, t, 3);
      },
    },
  }],
});

// "[Augment] Enemies gain +2/+2." — ee/5 10/15 Primordial Rock Beast {Virus}
// Unit. Text-box [Augment], live when played normally: the drawback is a
// static projecting +2/+2 onto ENEMY units in its region (CR 101.6: attackers
// entering its region grow; its controller's units never do).
// Mod-carried statics are live (host-anchored via E.anchored), so the same
// static covers the augment-donated form too — un-parked 2026-08-18. (The
// "still PARKED … inert augmentText" sentence that used to sit between those
// two was left behind by that unpark and has been removed.)
card('Towering Colossus', {
  augmentable: true,
  // CR 721.1: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    statics: [{
      affects: (g, self, t) => t.kind === 'unit' && t.controller !== self.controller,
      dp: 2, dt: 2,
    }],
  },
});

// "[Augment] Spells cost [one] more to play during battle." — ee/3 3/4
// Mystic Structure Unit. LIVE since the cost-modifier layer, CR 111.10 (it was parked
// for want of one, and the playtest report was "Tranquility isn't taxing
// spells" — it wasn't, it couldn't).
//
// Scope, clause by clause:
//  - "Spells" = `isPlayedSpellKind`: spell, spell unit and spell TOKEN. The owner
//    (2026-09-28, CR 702.7a): casting a spell token IS playing a spell — *"Yes,
//    taxed + counted"* — so a Fireball, Poison or Crystal cast in battle here
//    costs [1]. (This read "a spell token is cast from play, not played" under
//    the old cost-modifier ruling, which has since been overturned.) A unit is not a spell.
//  - "to play" = playing the card. Applying it as a mod is NOT playing (CR 701.2b),
//    which the purpose: 'mod' lookup handles for free.
//  - "during battle" = the battle phase only; deployment casts are untaxed.
//  - Unqualified subject, so it taxes BOTH players — and it is region-scoped
//    (CR 111.10) like every static, so it bites in whichever region it is standing
//    in, attackers included.
// Text-box [Augment], so the modifier radiates from the card played normally
// AND from the augment mod anchored on its host, exactly like a static.
card('Tranquility', {
  augmentable: true,
  // CR 721.1: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    costMods: [{
      delta: (g, _self, ctx) =>
        g.s.phase === 'battle'
          && ctx.purpose === 'play'
          && isPlayedSpellKind(ctx.card.kind)                     // CR 111.10c
          ? 1 : 0,
    }],
  },
});
