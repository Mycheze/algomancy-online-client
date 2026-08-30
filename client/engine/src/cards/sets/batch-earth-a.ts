/* batch-earth-a — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Earth cards scripted over the printed data in printed.json
 * (never hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (fight effects need both units — a gone target fizzles the part),
 * R6 (mid-resolution payments/choices via ctx.choose), R9 (bounded budgets
 * per card), R12/R25 ("each player/opponent" reads the event region's
 * present seats; listeners are region-scoped).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - FIGHT: modelled as simultaneous effect damage — powers are snapshotted,
 *    then each unit's damage is dealt via dealEffectDamage with THAT unit's
 *    card as the source (so Deadly/Poisonous/etc. on a fighter applies).
 *  - Aetherflux Golem: NO LONGER an approximation (R168, CARD-TODO #48). This
 *    note used to read '"+2/+2" is modelled as two +1/+1 counters (the engine's
 *    only permanent stat layer) … counter-matters effects see them'. Playtest
 *    #46 rejected exactly that shape on the card printing the same sentence
 *    (Tenebrous Bulborb): it is a real StaticMod on the anchor now — continuous,
 *    never on the stack, and it leaves with the virus. See the card.
 *
 * UN-PARKED (kept as history; nothing in this batch is parked):
 *  - Crevice Lurker: UN-PARKED (R121) — the ability-cost tax rides R59's
 *    CostMod layer under the two new purposes ('activate'/'trigger'), and
 *    the pay-to-trigger gate is E.gateTaxedTrigger at processTriggerQueue's
 *    stack-bound choke point. See the card.
 *  - Hooba-Lan: UN-PARKED — E.createShard() (a real 'shard' ResourceKind,
 *    created dormant) exists, and the card calls it. The note that this
 *    "needs a Shard ResourceKind" outlived the primitive; see the card.
 *  - Earth Resource: NOT PARKED — corrected 2026-08-23. This note claimed the
 *    clause waited on the resource-CARD model and a dispatched activation
 *    event, and it was the ONLY thing tracking the card (no test existed until
 *    now). Both claims were wrong: "When I activate, if you have at least
 *    [e][e][e], create a Shard" is the MANUAL p.18 general rule reprinted on
 *    the physical card as reminder text, implemented in
 *    `apply.ts::maybeGrantShard` for all seven elements and now verified on
 *    the real activateResource path (test/16-earth-a). Registered
 *    printed-data-only, which is the CORRECT definition — the face owns no
 *    behaviour. ⚠ Do not "implement" it: printed.json has Resource faces for
 *    only fire, water and earth, so moving the rule onto card definitions
 *    would drop the bonus for wood/metal/light/dark. R116, R54; registry.ts
 *    still excludes it from DECK_LIST (a resource face, not a deck card).
 */
import type { Attr, Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, notSelf, type EffectCtx, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt, chooseUnit } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** present seats of a region, initiative player first (stable order) */
/** R243: `E.seatsHere` is the one answer for the whole pool. SIX files had
 * grown their own copy of this and they did NOT agree — most ordered it
 * initiative-first, batch-hybrids-ld-a took `presentSeats` raw. */
const presentSeats = (g: E, region: number): Seat[] => g.seatsHere(region);

/** Two units fight: they deal damage to each other equal to their power,
 * simultaneously — powers snapshotted first, then both hits are dealt via
 * dealEffectDamage with the FIGHTER's card as the source (⚠ header note:
 * fighter attrs like Deadly apply; Reaping/Resonant riders credit the
 * effect's controller). */
const fight = (g: E, ctx: EffectCtx, a: Entity, b: Entity): void => {
  /* R106 {Unaware}: a fight is an interaction, so if EITHER fighter is Unaware
   * both of them are read off the printed cards ("it looks ONLY at what is the
   * literal printed text on all cards 'involved'"), in both directions.
   *
   * The powers are collapsed here. The RECEIVING half has to be collapsed too,
   * and `dealEffectDamage` decides that from the source's attributes — which,
   * for a fight, are the fighter's only when `ctx.sourceId` is unset (a spell
   * like Battle); an ability that makes two units fight is still its own
   * source. So the flag is handed over explicitly through `grantedAttrs`, the
   * same seam R79 uses to donate a virus's attributes to a resolving effect.
   * Without it, Bubb fighting an Eminence would kill it at printed and take
   * the Eminence's EFFECTIVE power back. */
  const collapsed = g.collapsedBy(a, [b]);
  const [pa] = g.interactionStats(a, [b]);
  const [pb] = g.interactionStats(b, [a]);
  const granted: Attr[] = collapsed
    ? [...(ctx.grantedAttrs ?? []), 'Unaware']
    : (ctx.grantedAttrs ?? []);
  g.ev('info', `${a.card} fights ${b.card}.`);
  if (pb > 0) g.dealEffectDamage({ ...ctx, sourceName: b.card, grantedAttrs: granted }, a, pb);
  if (pa > 0) g.dealEffectDamage({ ...ctx, sourceName: a.card, grantedAttrs: granted }, b, pa);
};

// ────────────────────────────── the cards ──────────────────────────────

// "When I die, [Switch] Rockfall 4. (Each player chooses one of their units.
// I deal 4 damage to each of the chosen units.)" — e/2 2/1 {Haste} Rock Pile
// Unit. Died trigger (self); unbounded graft ([Switch]). "Each player" =
// the event region's present seats (R12/R25) — dying during deployment, only
// my controller is present. Each player picks their OWN unit (auto when they
// have only one); all picks are gathered before any damage (plan-then-commit),
// then I deal 4 to each. The pick is a real question even when the trigger
// resolves in the end-of-turn window — a ctx.choose suspension there is
// answered and the turn flip is closed afterwards by E.finishTurnEnd (R85).
const rockfall4: EffectDef = {
  run: (g, ctx) => {
    const picks: Entity[] = [];
    for (const seat of presentSeats(g, ctx.region)) {
      const units = g.unitsOf(seat, ctx.region);
      if (!units.length) continue;
      const u = chooseUnit(g, ctx, `rf:${seat}`, seat, units,
        'Rockfall 4: choose one of your units (it will be dealt 4 damage)');
      if (u) picks.push(u);
    }
    const live = picks.filter(u => g.entity(u.id));
    if (!live.length) { g.ev('info', 'Rockfall 4: nobody has a unit to choose — nothing is dealt damage.'); return; }
    g.dealEffectDamageAll(ctx, live.map(u => ({ target: u, n: 4 })));   // R80: one batch
  },
};
card('A Fast Pile of Rocks', {
  abilities: [{
    type: 'triggered', events: ['died'], self: true, graftCause: true,
    label: 'Rockfall 4 (each player picks a unit; 4 damage to each)',
    effect: rockfall4,
  }],
  graftEffect: { bounded: false, effect: rockfall4 },
});

// "[Augment] I gain +2/+2." — ee/1 1/1 Golem Sprite {Virus} Unit. Text-box
// [Augment]: donated, "I" is the host — it gains +2/+2 while the Golem is
// attached (augment or Virus, both attach as 'augment' mods); played normally
// its own [Augment] text is live (Manual Q&A) — a 3/3 in effect.
//
// R168 (CARD-TODO #48): a plain STATIC now, not a triggered ability adding two
// +1/+1 counters. Three cards print this identical sentence — "[Augment] I gain
// ±N/±N" — and the other two (Malformed Monstrosity, Tenebrous Bulborb) became
// statics after playtest report #46, where the owner ruled on Bulborb: "The 'I
// get -2/-2' isn't a trigger that should go on the stack. It's a static
// effect." One printed sentence, one mechanism; this was the last of the three
// still on the old shape. `affects` matches the ANCHOR itself, which is what
// "[Augment] I …" means — the card when it is a unit in play, and the HOST when
// it is worn as a mod (staticsFor's anchored() walk). Two Golems on one host
// stack, each its own +2/+2.
//
// WHAT ELSE THE CHANGE MOVES, deliberately:
//  · counter-matters cards no longer see it. It placed two REAL +1/+1 counters,
//    so Soul Reaver could spend them, Buffer Overflow doubled them and Reality
//    Siphoner counted them. A layer is not a counter and none of that happens
//    now — which is the correct reading: the card says "I gain +2/+2", not
//    "put two +1/+1 counters on me" (Powerforge Synergist is what that sentence
//    looks like when it is meant).
//  · it is no longer respondable or negatable. The trigger reached the stack,
//    so Containment Protocol ("negate all activated and triggered effects")
//    could eat the +2/+2 while leaving the mod attached. Playtest #60/#75 name
//    exactly that as the bug.
//  · it no longer cancels pairwise with -1/-1 counters, and it LEAVES with the
//    virus. Erasing the mod used to leave the +2 behind (the counters were
//    permanent); now the host drops back to its printed stats, the same way
//    Bulborb's -2/-2 does.
card('Aetherflux Golem', {
  augmentable: true,
  // R268: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    statics: [{ affects: (_g, self, t) => t.id === self.id, dp: 2, dt: 2 }],
  },
});

// "Two target units fight. (They deal damage to each other equal to their
// power.)" — ee/4 {Battle} Bedlam Spell. Both units are cast-time targets
// (count: 2, min: 2). R5: the fight needs both — a gone target fizzles.
card('Battle', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Battle: two target units — they fight', count: 2, min: 2 },
    allOrNothing: true,
    run: (g, ctx) => {
      const [a, b] = ctx.targets;
      if (!isEnt(a) || !isEnt(b) || !g.entity(a.id) || !g.entity(b.id)) {
        g.ev('info', 'Battle: a fighter is gone — no fight.');
        return;
      }
      fight(g, ctx, a, b);
    },
  },
});

// "[Augment] {Unaware} Druid Rock Turtle Unit" — e/4 5/6. Type-line
// [Augment] grants {Unaware}; printed.augmentAttrs carries it and
// printed.attrs keeps it live when played normally. Vanilla otherwise.
// The attribute is LIVE as of R106 (2026-08-23): stat layer 6 shipped. Bubb —
// or any host its [Augment] lands on — reads at the numbers PRINTED on its
// card, through counters, auras, base rewrites, {Tough} and {Inverted} alike;
// and so does everything it is dealing damage to or in combat with, which is
// why it kills a Robot token however many +1/+1 counters that Robot carries.
// (This note used to end at "vanilla otherwise", which was true of the code
// and hid a dead card for two playtest reports.)
card('Bubb', {});

// "[Augment] Abilities cost [one] more to activate or trigger during battle.
// (Choosing to not pay this prevents the abilities from triggering.)" —
// ee/2 2/3 Golem Beast Unit. UN-PARKED (R121): the ability-cost half of the
// R59 CostMod layer, consulted with the two new purposes — 'activate'
// (E.payActivationCost + the shared canPayAbilityCost gate, so an
// unaffordable taxed activation is neither offered nor accepted) and
// 'trigger' (E.gateTaxedTrigger, the one pay-to-trigger choke point in
// processTriggerQueue, where the reminder text's "choosing to not pay this
// prevents the abilities from triggering" is a real payOrDecline for the
// trigger's controller — never a choice the engine makes for them).
//
// Rulings (designer, current):
//  · it "taxes the cost to activate or trigger abilities" — and can stop
//    e.g. Ruinbringer's "After combat, delete all units" like a negate can;
//  · an ability's "if you do" clause is NOT its own trigger — no double tax;
//  · (R37 family) Augment/Ambush are ways to PLAY a card, not activated
//    abilities — applying a mod is not taxed (purpose 'mod' is never
//    'activate'/'trigger').
// Clause by clause:
//  · "Abilities" is unqualified — BOTH players' abilities; ctx.card ignored;
//  · "during battle" — the phase gate below; deployment and haste are free;
//  · region-scoped like every CostMod (R12), radiating from the card in play
//    AND from the augment mod anchored on its host (Tranquility's shape:
//    `augmentable: true`, text-box [Augment] live when played normally);
//  · two Lurkers SUM to +2, as CostMod deltas always do (R59).
card('Crevice Lurker', {
  augmentable: true,
  // R268: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    costMods: [{
      delta: (g, _self, ctx) =>
        g.s.phase === 'battle'
          && (ctx.purpose === 'activate' || ctx.purpose === 'trigger')
          ? 1 : 0,
    }],
  },
});

// "[Augment] After combat, I deal damage equal to my defense to each
// opponent." — eee/3 2/3 Alien Strider Unit. Text-box [Augment]; live when
// played normally (Manual Q&A). NOT self: the afterCombat event carries no
// source unit (Embermaw precedent) — region scoping keeps it to the battle
// I'm in. Amount = MY defense at RESOLUTION (R1: effStats of the carrier —
// the host when donated); "each opponent" region-scoped (R25).
card('Deathglow Strider', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'I deal my defense to each opponent (after combat)',
    effect: {
      // every branch says something: an effect that runs to completion in
      // silence is a conformance failure (test/65-effect-conformance.test.ts),
      // and each of these three is a real thing a player needs told
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) { g.ev('info', 'Deathglow Strider: the carrier is gone — no damage.'); return; }
        const [, def] = g.effStats(self);
        if (def <= 0) {
          g.ev('info', `Deathglow Strider: ${self.card} has no defense left — no damage.`);
          return;
        }
        const foes = presentSeats(g, ctx.region).filter(seat => seat !== ctx.controller);
        if (!foes.length) {
          g.ev('info', 'Deathglow Strider: no opponent is in this region — no damage.');
          return;
        }
        g.dealEffectDamageAll(ctx, foes.map(seat => ({ target: { player: seat }, n: def })));   // R80
      },
    },
  }],
});

// "When I activate, if you have at least [e][e][e], create a Shard. (It
// spawns dormant.)" — [e] Earth Resource, 2/0. NOT PARKED: that sentence is
// the Manual p.18 general rule reprinted as reminder text, live in
// apply.ts::maybeGrantShard for all seven elements. Bare is CORRECT — the face
// owns no behaviour. ⚠ Adding it here would double the bonus for earth and,
// once the rule moved off maybeGrantShard, delete it for the four elements
// with no printed face. R116; guarded by test/12-fire-a's sweep.
// registry.ts keeps it out of DECK_LIST (resource face).
card('Earth Resource', {});

// "[Augment] Whenever I am dealt damage, you may pay [one]. If you do, I
// fight another target unit. (We deal damage to each other equal to our
// power.)" — ee/6 6/8 Alien Avatar Unit. Text-box [Augment]. Damage event,
// self-filtered (combat and effect damage both fire 'damage'). The target is
// declared when the trigger goes on the stack; the [one] payment is a
// mid-resolution pay-or-decline (R6), skipped outright when unaffordable.
// "Another" is enforced at resolution (Minor Kraken precedent).
card('Eminence of the Barrens', {
  augmentText: [{
    type: 'triggered', events: ['damage'], self: true,
    label: 'you may pay [one] — I fight another target unit',
    effect: {
      // R64: "ANOTHER target unit" — the Eminence cannot fight itself
      targets: {
        what: 'unit', prompt: 'Eminence of the Barrens: I fight another target unit (if you pay [one])',
        restrict: notSelf,
      },
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) { g.ev('info', 'Eminence of the Barrens: the carrier is gone — no fight.'); return; }
        const t = ctx.targets[0];
        if (!isEnt(t) || !g.entity(t.id)) {
          g.ev('info', 'Eminence of the Barrens: the target is gone — no fight.');
          return;
        }
        if (t.id === self.id) { g.ev('info', 'Eminence of the Barrens: cannot fight myself ("another target unit").'); return; }
        if (g.openMana(ctx.controller) < 1) { g.ev('info', 'Eminence of the Barrens: cannot pay [one] — no fight.'); return; }
        const pays = ctx.choose('pay', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Eminence of the Barrens: pay [one] to fight ${t.card}?`,
          options: [{ label: 'Pay [one] — fight', value: true }, { label: 'Decline', value: false }],
        });
        if (pays !== true) { g.ev('info', 'Eminence of the Barrens: the [one] is declined — no fight.'); return; }
        g.payMana(ctx.controller, 1);
        fight(g, ctx, self, t);
      },
    },
  }],
});

// "[Augment] [two]: Change a target of target effect to me." — e/1 1/2
// Spirit Guardian Unit. An ACTIVATED ability in the [Augment] text box: live
// when played normally (via: 'augment') and donated to hosts (via: { mod }).
// Targets an effect on the stack; at resolution one of its declared targets
// (caster's pick when several) becomes me — the ability's carrier.
card('Enigmatic Warder', {
  augmentText: [{
    type: 'activated', cost: { mana: 2 },
    label: '[two]: change a target of target effect to me',
    effect: {
      targets: { what: 'stackEffect', prompt: 'Enigmatic Warder: change a target of target effect to me' },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!t || !('stack' in (t as object))) {
          g.ev('info', 'Enigmatic Warder: no effect is targeted — nothing is retargeted.');
          return;
        }
        const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
        if (!item) {
          g.ev('info', 'Enigmatic Warder: the targeted effect has already left the stack.');
          return;
        }
        const me = selfOf(g, ctx);
        if (!me) { g.ev('info', 'Enigmatic Warder: the carrier is gone — nothing to retarget to.'); return; }
        // R58: only slots I could LEGALLY occupy. Changing a target may not
        // create an illegal one — the playtest bug was this Warder dropping
        // itself into Fight's "target ALLY" slot while belonging to the other
        // player, where "ally" means ally of the SPELL's controller. It also
        // may not duplicate a sibling slot ("another target unit", R56).
        const slots: [number, number][] = [];
        item.parts.forEach((p, pi) => {
          if (p.spent) return;
          p.targets.forEach((cur, ti) => {
            if (JSON.stringify(cur) === JSON.stringify({ unit: me.id })) return;   // already me
            if (g.canFillSlot(item, pi, ti, { unit: me.id })) slots.push([pi, ti]);
          });
        });
        if (!slots.length) {
          g.ev('info', `Enigmatic Warder: no target of ${item.label} may legally be changed to ${me.card}.`);
          return;
        }
        const si = slots.length === 1 ? 0 : ctx.choose('slot', {
          kind: 'electricPath', seat: ctx.controller,
          prompt: 'Enigmatic Warder: which target changes to me?',
          options: slots.map(([pi, ti], i) => ({ label: g.targetLabel(item.parts[pi]!.targets[ti]!), value: i })),
        }) as number;
        const slot = slots[si] ?? slots[0]!;
        item.parts[slot[0]]!.targets[slot[1]] = { unit: me.id };
        g.ev('info', `Enigmatic Warder: a target of ${item.label} is now ${me.card}.`);
      },
    },
  }],
});

// "[Switch1] Target ally and another target unit fight. (They deal damage to
// each other equal to their power.)" — e/1 {Battle} Bedlam Spell. The whole
// sentence is the bounded graftable effect ([Switch1], R9).
//
// PLAYTEST FIX (R58): the printed text says "target ally AND ANOTHER TARGET
// unit" — BOTH are targets, chosen at cast. This used to take only the ally at
// cast and pick the second unit mid-resolution, which meant the opponent never
// saw what the spell was aimed at while it was on the stack, and the second
// "target" could not be responded to at all. Now it is a two-slot spec with
// per-slot legality: slot 0 an ally of the CASTER, slot 1 any other unit.
//
// Both are re-checked at resolution rather than trusted from cast (R56/R58):
// Enigmatic Warder can redirect a slot afterwards, and the playtest bug was
// the OPPONENT's Warder moving itself into the "ally" slot — "ally" means ally
// of this spell's controller, never of the redirector's.
const fightEffect: EffectDef = {
  targets: {
    what: 'unit', count: 2, min: 2,
    slots: ['allyUnit', 'unit'],
    prompt: 'Fight: target ally, then another target unit — they fight',
    slotPrompts: [
      'Fight: target ally (it fights another target unit)',
      'Fight: another target unit (it fights your ally)',
    ],
  },
  run: (g, ctx) => {
    const [a, b] = [ctx.targets[0], ctx.targets[1]];
    if (!isEnt(a) || !isEnt(b) || !g.entity(a.id) || !g.entity(b.id)) {
      g.ev('info', 'Fight: a target is gone — no fight.');
      return;
    }
    if (a.id === b.id) { g.ev('info', 'Fight: "another" — one unit cannot fight itself.'); return; }
    if (a.controller !== ctx.controller) {
      g.ev('info', `Fight: ${a.card} is not ${g.pname(ctx.controller)}'s ally any more — no fight.`);
      return;
    }
    fight(g, ctx, a, b);
  },
};
card('Fight', {
  spellEffect: fightEffect,
  graftEffect: { bounded: true, effect: fightEffect },
});

// "When my column deals combat damage, [Switch1] Put a +1/+1 counter on each
// of your units." — ee/3 1/3 {Swift} Luminary Primordial Unit. Condition at
// event time (R1) on the two channels combat damage can take, which is exactly
// what `E.columnDealtCombatDamage`'s CHANNEL parameter names. The clause is
// UNQUALIFIED — no "to an opponent" — so it hears both:
//  - 'units' — 'damage' with no source tag (combat, not effect damage) whose
//    victim is in the column DIRECTLY OPPOSING mine (combat damage is
//    pairwise, so that damage came from my column);
//  - 'face'  — 'lifeLost' why 'combat' of which my column dealt a share.
// R195 routed this card into the shared predicate; the hand-rolled copy that
// used to sit here carried R117's sub-step gate and R157 §4's power gate
// correctly and the face arm as "my column connects", which is geometry rather
// than damage: a {Piercing} column the blockers absorbed whole connects, deals
// the player nothing, and used to claim another column's hit.
// [Switch1] bounded (R9) — one firing per turn no matter how many hits.
// "Your units" is region-scoped (R12); counters land at RESOLUTION (R1).
const flowstoneCounters: EffectDef = {
  run: (g, ctx) => {
    const mine = g.unitsOf(ctx.controller, ctx.region);
    if (!mine.length) { g.ev('info', `${ctx.sourceName}: you control no unit here — no counters.`); return; }
    for (const u of mine) g.addCounters(u, 1);
  },
};
card('Flowstone Arcanite', {
  abilities: [{
    type: 'triggered', events: ['damage', 'combatFaceDamage'], bounded: true, graftCause: true,   // R238
    label: 'put a +1/+1 counter on each of your units',
    when: (g, self, ev) => g.columnDealtCombatDamage(self, ev, ['units', 'face']),
    effect: flowstoneCounters,
  }],
  graftEffect: { bounded: true, effect: flowstoneCounters },
});

/**
 * "…target effect TARGETING ME": does the stack item `stackId` aim at `me`?
 *
 * One predicate, asked in two different questions, which is the whole point of
 * report #70 below — the candidate list and the resolution check have to be
 * the same sentence or the client offers what the card then refuses.
 *
 * Two ways an effect can aim at a unit:
 *  - it declared the unit as a TARGET (`{ unit: me }` in a live, unspent
 *    part) — the ordinary case, a Fireball on my host;
 *  - it is a VIRUS being applied to me. A virus carries no parts and no target
 *    refs (apply.ts builds it with `parts: []` and a `hostId`), so the plain
 *    target-ref read misses it — but the designer is explicit that it is a
 *    targeted effect and that Graxxlid reaches it. Caleb, rules-questions:
 *    "You can redirect a virus, it is a targeted effect", and asked directly
 *    "so you could Graxxlid or Boon of Protection it as well?" — "Yep!
 *    They're fully interactible." R79's other virus shape (`hostStack`, a
 *    virus aimed at a SPELL on the stack) is not aimed at me and is excluded.
 */
const aimsAtUnit = (g: E, stackId: number, me: EntityId | undefined): boolean => {
  if (me === undefined) return false;
  const item = g.s.stack.find(i => i.id === stackId);
  if (!item) return false;
  if (item.kind === 'virus') return item.hostId === me;
  return item.parts.some(p => !p.spent && p.targets.some(tr => 'unit' in tr && tr.unit === me));
};

// "[Augment][once] [one]: Negate target effect targeting me. That effect's
// controller draws a card." — ee/2 2/3 Arcane Guardian {Virus} Unit. An
// ACTIVATED ability in the [Augment] text box, [once] = bounded (R9).
// "Me" = the carrier (the host when donated).
//
// Report #70 (GETD, 2026-08-22): "Graxxlid is lighting up like I can activate
// its ability despite there being no legal targets on the stack". It was: the
// spec was a bare `what: 'stackEffect'`, so EVERY item on the stack was a
// candidate and "targeting me" was checked only at resolution, as an info
// line. R64 settles which of the two that clause is — "the printed restriction
// is part of what makes a target LEGAL, not a condition checked once the spell
// resolves" — so it belongs in `restrict`, which the three places that must
// agree all read: the candidate menu, `castable`, and `canFillSlot`. The
// designer-community source under it is the RAQ thread "[Solved] Target
// requirements to put effect on stack": "In order to play a card, you MUST be
// able to select the valid targets for the effect. Eg. You cannot play
// Resurrect if there aren't any 2 mana units in your bin." R64 already gates
// an ABILITY the same way ("one whose mandatory target has nothing legal to
// aim at is not offered and is refused"), which is exactly the ask: with no effect
// on the stack aiming at Graxxlid, `abilityUnusable` drops the activation from
// `legalActions` and the client's green `.activatable` halo — a pure read of
// `legalActions` — goes out on its own. No UI change. (The inverse of report
// #35, where a card that COULD act was not drawn as if it could.)
//
// The resolution check STAYS, and is not dead code. R64 is explicit that a
// restriction is not re-asked at resolution (R5/R56), so between activation
// and resolution the world may legally stop satisfying it: Redirect moves an
// effect's targets ("You can redirect a virus, it is a targeted effect"), a
// part can be spent, the aiming item can leave the stack, and Reconfigure can
// carry the Graxxlid mod to a different host mid-battle (Passer's worked
// example) while `ctx.sourceId` still names the host it was activated from.
// A restriction that was true at cast is a promise about cast time only — the
// same RAQ thread says so of the far end: "if there was a legal target at this
// point in time and it disappears (e.g. OP playing something in response to
// the trigger), the ability will resolve as far as it can."
card('Graxxlid', {
  augmentText: [{
    type: 'activated', cost: { mana: 1 }, bounded: true,   // [once]
    label: "[one]: negate target effect targeting me; its controller draws",
    effect: {
      targets: {
        what: 'stackEffect',
        prompt: 'Graxxlid: negate target effect targeting me',
        // R64: the printed "targeting me" clause, as a targeting restriction
        restrict: (g, t, ctx) => 'stack' in t && aimsAtUnit(g, t.stack, ctx.sourceId),
      },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!t || !('stack' in (t as object))) return;
        const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
        // R113: both of these are a TARGETED bounded trigger that missed —
        // the same shape as a fizzle, which the designer ruled spends the use
        // ("regardless of if that ability resolves or doesn't"). Answering a
        // Graxxlid by moving its target off the stack is meant to cost it the
        // turn's use; refunding here would make that answer free.
        if (!item) {
          g.ev('info', 'Graxxlid: the targeted effect has already left the stack — nothing is negated.');
          return;
        }
        if (!aimsAtUnit(g, item.id, ctx.sourceId)) {
          g.ev('info', `Graxxlid: ${item.label} does not target me — no effect.`);
          return;
        }
        g.negate(item.id);
        g.draw(item.controller, 1);
      },
    },
  }],
});

// "I deal 1 damage to each unit." — ee/4 {Battle} {Unaware} Sand Spell.
// "Each unit" = every unit in the effect's region (R12), both sides;
// the unit list is snapshotted, then each still-alive unit is hit.
// {Unaware} on this spell is LIVE and is the whole point of the card (R106):
// a spell has no stats of its own to collapse, so its {Unaware} collapses what
// it HITS. The owner, 2026-08-23: "Haboob kills anything that has 1 defense
// printed at the card level" — a 1/1 under four +1/+1 counters dies to this 1
// damage, and a printed 2 defense does not.
card('Haboob', {
  spellEffect: {
    run: (g, ctx) => {
      const units = g.unitsIn(ctx.region);
      if (!units.length) { g.ev('info', 'Haboob: there is no unit here to damage.'); return; }
      // R80: "each unit" is one batch — every unit here is dealt its 1 at once
      g.dealEffectDamageAll(ctx, units.map(u => ({ target: u, n: 1 })));
    },
  },
});

// "[Augment] When I attack or block, create a Shard. (It will spawn
// dormant.)" — eee/3 3/4 Hooba Rock Unit. Text-box [Augment]; the trigger
// wiring was already done and only the payload was parked for want of a Shard
// primitive. E.createShard exists now, so this is LIVE: the Shard goes to the
// carrier's controller ("you"), dormant, once per attack or block.
card('Hooba-Lan', {
  augmentText: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    label: 'create a Shard (dormant)',
    effect: { run: (g, ctx) => { g.createShard(ctx.controller, 1, ctx.sourceName); } },
  }],
});

// "[Augment] Whenever I am dealt damage, I deal that much damage to you." —
// e/1 4/4 Occult Rock {Virus} Unit. Text-box [Augment] — as a Virus on an
// enemy unit, "you" is the HOST's controller (the trigger's controller is
// the carrier's controller), which is the whole point of the card. "That
// much" = the event's amount (R1: read from the event snapshot).
card('Lithoghul', {
  augmentText: [{
    type: 'triggered', events: ['damage'], self: true,
    label: 'I deal that much damage to you (whenever I am dealt damage)',
    effect: {
      run: (g, ctx) => {
        const n = (ctx.event?.data?.n as number | undefined) ?? 0;
        if (n > 0) g.dealEffectDamage(ctx, { player: ctx.controller }, n);
      },
    },
  }],
});
