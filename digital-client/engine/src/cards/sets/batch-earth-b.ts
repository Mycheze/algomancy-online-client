/* batch-earth-b — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Cards are being scripted here from printed.json data
 * (never hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R9 (bounded / [once] budgets per card), R12/R25 ("each player/opponent"
 * reads the event region's present seats), R21 (Deadly), R26 (own [Augment]
 * text live when played normally).
 *
 * PARKED (needs engine machinery that does not exist yet):
 *  - Oorblak: "If combat damage would be dealt to you, that damage is dealt
 *    to me instead". ⚠ THIS NOTE WAS STALE (corrected 2026-08-22, card-ledger
 *    audit). It used to read "needs damage replacement hooks (combatSubStep
 *    calls loseLife directly, with no replacement seam)", and that stopped
 *    being true: R38 added `CardBehavior.replaceCombatDamageToPlayer`, and
 *    E.pumpCombatDamage asks E.replaceCombatDamage for every player hit BEFORE
 *    loseLife. Blightsea Polyp (batch-hybrids-ld-c) has used the seam since,
 *    and its anchoring is exactly what this card wants — units in play AND
 *    augment mods, whose hook reads from their HOST, so "you" is the holder's
 *    controller and "me" is the holder.
 *      What is actually left is much smaller than "damage replacement hooks":
 *    a way to deal the redirected damage TO A UNIT from inside the hook. The
 *    hook is handed (g, self, seat, amount, info) and no EffectCtx, while
 *    dealEffectDamage takes one. Blightsea Polyp never noticed because
 *    g.gainRot needs no ctx.
 *      Still registered with a no-op [Augment] text so it can be applied as a
 *    (blank) virus augment. Declared in test/card-ledger.ts.
 *  - PARTIAL — Reality Bender: registered on printed data ({Inverted} attr +
 *    type-line [Augment] grant); the Inverted stat swap itself is the
 *    unimplemented effStats layer 5 (the seam exists in engine.ts).
 *
 * UN-PARKED (kept here so the history is readable; nothing below is waiting):
 *  - Malformed Monstrosity: the unit form is a true self-affecting static
 *    (-7/-7, live in effStats), and the augment-DONATED form is the SAME
 *    static — mod-carried statics anchor on the host (E.anchored), which
 *    retired the "-7/-7 as permanent -1/-1 counters" deviation the old entry
 *    described (un-parked 2026-08-18).
 *  - Mohruung: "when I become targeted" is heard on EVERY targeting path.
 *    It was partial — apply.ts dispatched 'targeted' for augment/virus/graft
 *    but engine.ts commitItem only LOGGED it for spell and ability targets,
 *    so no spell in the game could trigger it. Playtest 2026-08-19 (R53).
 */
import type { Entity, EntityId, Seat, TargetRef } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, getCard, type EffectDef, type ResolvedTarget } from '../dsl.ts';
import { selfOf, chooseUnit } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** present seats of a region, initiative player first (stable order) */
const presentSeats = (g: E, region: number): Seat[] => {
  const present = g.s.regions[region]!.presentSeats;
  return [g.initiative, g.nit].filter(s => present.includes(s));
};

// ────────────────────────────── the cards ──────────────────────────────

// "After combat, [Switch1][Switch1] {i}(Trigger two copies of this graft
// ability as one single trigger.)" — e/4 0/3 Cosmic Guardian Unit. The card
// contributes no effect of its own: its afterCombat cause runs every attached
// graft effect TWICE within one trigger. The engine's composeParts already
// includes each graft once; this base effect supplies the second copy by
// running each graft-applied mod's effect once more inline (targets picked
// mid-resolution via ctx.choose, playInline-style). ⚠ ordering: the base part
// runs first, so the "second copy" precedes the composite's graft parts —
// harmless inside one single trigger. Grafted onto ANOTHER host, the same
// effect doubles the host's other grafts (never itself — no doubling a
// doubler). Bounded ([Switch1], R9): once per turn as a cause and as a graft.
const doubleGrafts: EffectDef = {
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    if (!self) { g.ev('info', 'Lost Guardian: the carrier is gone — no graft is doubled.'); return; }
    let doubled = 0;
    for (const modId of [...self.mods]) {
      const mod = g.entity(modId);
      if (!mod || mod.appliedAs !== 'graft' || mod.card === 'Lost Guardian') continue;
      const eff = getCard(mod.card).graftEffect?.effect;
      if (!eff) continue;
      // ⚠ R35/R49: a rider with a bracketed [cost] is paid ONCE, in the cast
      // window, when composeParts contributes its single copy. This inline
      // copy runs outside that window and has no way to pay, so it is
      // SKIPPED rather than resolved for free — Darkblast's "[Discard a card]
      // deal 5 damage" would otherwise be 5 free damage. The printed copy
      // still happens; only the extra one is lost. (Same rule as Witness of
      // the Crossing's tripleGrafts.)
      if (eff.castCost) {
        g.ev('info',
          `${ctx.sourceName}: ${mod.card} has a bracketed [cost], which the extra copy `
          + 'cannot pay — only its paid copy resolves.');
        continue;
      }
      let targets: ResolvedTarget[] = [];
      if (eff.targets) {
        const cands = g.targetCandidates(eff.targets, ctx.region, undefined, ctx.controller);
        if (!cands.length) continue;
        const ref = (cands.length === 1 ? cands[0]! : ctx.choose(`lg:${modId}`, {
          kind: 'electricPath', seat: ctx.controller, prompt: eff.targets.prompt,
          options: cands.map(c => ({ label: g.targetLabel(c), value: c })),
        })) as TargetRef;
        const r = g.resolveTargetRef(ref);
        if (!r) continue;
        targets = [r];
      }
      eff.run(g, {
        controller: ctx.controller, sourceName: mod.card, sourceId: self.id,
        region: ctx.region, targets, event: ctx.event,
        choose: (k, d) => ctx.choose(`lg:${modId}:${k}`, d),
      });
      doubled++;
    }
    if (!doubled) g.ev('info', `${ctx.sourceName}: no other graft is attached — there is nothing to double.`);
  },
};
card('Lost Guardian', {
  abilities: [{
    type: 'triggered', events: ['afterCombat'], bounded: true, graftCause: true,
    label: 'trigger two copies of each grafted ability (one single trigger)',
    effect: doubleGrafts,
  }],
  graftEffect: { bounded: true, effect: doubleGrafts },
});

// "[Augment] I gain -7/-7." — ee/3 10/9 Elemental Horror {Virus} Unit. Own
// [Augment] text is live when played normally (R26 / Manual Q&A): the UNIT
// form is a true self-affecting static — the spawned 10/9 is a live 3/2 with
// ZERO counters, so later +1/+1 counters no longer pairwise-cancel the
// printed drawback.
// the -7/-7 is a true static in BOTH forms now: host-anchored when carried by
// the augment mod (un-parked 2026-08-18; the counters approximation is gone)
card('Malformed Monstrosity', {
  augmentable: true,
  statics: [{ affects: (g, self, t) => t.id === self.id, dp: -7, dt: -7 }],
});

// "When I attack or block, [Switch] Create a Crystal 1." — ee/2 2/2 Mystic
// Luminary Unit. Unbounded graft shares the Crystal-making effect.
const createCrystal1: EffectDef = {
  creates: ['Crystal'],
  run: (g, ctx) => { g.createSpellToken(ctx.controller, 'Crystal', 1, ctx.region); },
};
card('Metamorphic Luminary', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true, graftCause: true,
    label: 'create a Crystal 1',
    effect: createCrystal1,
  }],
  graftEffect: { bounded: false, effect: createCrystal1 },
});

// "Rockfall 3 three times. {i}(To rockfall 3: Each player chooses one of
// their units. I deal 3 damage to each of the chosen units.)" — e/4 {Battle}
// Cosmic Rock Spell. "Each player" = the region's present seats (R12/R25);
// each player picks their own unit. Rockfalls are sequential: each one plans
// all picks first, then commits the damage, so deaths from an earlier
// rockfall shrink the later candidate pools (R1: live state at resolution).
card('Meteor Shower', {
  spellEffect: {
    run: (g, ctx) => {
      for (let i = 0; i < 3; i++) {
        const picks: Entity[] = [];
        for (const seat of presentSeats(g, ctx.region)) {
          const u = chooseUnit(g, ctx, `rf${i}:${seat}`, seat,
            g.unitsOf(seat, ctx.region), `Meteor Shower (rockfall ${i + 1}): choose one of your units`);
          if (u) picks.push(u);
        }
        g.dealEffectDamageAll(ctx, picks.map(u => ({ target: u, n: 3 })));   // R80: one rockfall, one batch
      }
    },
  },
});

// "[Augment] Whenever I survive damage, put that many +1/+1 counters on me."
// — e/1 0/2 Sand Crab Unit. Text-box [Augment]. The 'damage' event fires
// after the damage is marked but before deaths are processed, so "survive" is
// checked at event time (R1): marked damage still below toughness. "That
// many" is the event's damage amount (a fact of the event), granted at
// resolution if I'm still around.
card('Mirage Scuttler', {
  augmentText: [{
    type: 'triggered', events: ['damage'], self: true,
    label: 'put that many +1/+1 counters on me (survived damage)',
    when: (g, self) => self.damage < g.effStats(self)[1],   // survived so far
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        const n = (ctx.event?.data?.n as number | undefined) ?? 0;
        if (self && n > 0) g.addCounters(self, n);
        else g.ev('info', 'Mirage Scuttler: it did not survive to take the counters.');
      },
    },
  }],
});

// "When I become targeted, [Switch1] Create a Crystal 2." — e/4 1/5 Cosmic
// Rock Unit. Every targeting path fires it: augment/virus/graft (apply.ts)
// and spells/abilities off the stack (engine.ts commitItem — R53, the
// playtest fix). Bounded ([Switch1], R9); the Crystal 2 is the bounded graft.
const createCrystal2: EffectDef = {
  creates: ['Crystal'],
  run: (g, ctx) => { g.createSpellToken(ctx.controller, 'Crystal', 2, ctx.region); },
};
card('Mohruung', {
  abilities: [{
    type: 'triggered', events: ['targeted'], self: true, bounded: true, graftCause: true,
    label: 'create a Crystal 2 (I became targeted)',
    effect: createCrystal2,
  }],
  graftEffect: { bounded: true, effect: createCrystal2 },
});

// "Whenever you apply an augment during battle, [Switch] I gain +2/+2 until
// regroup." — ee/2 2/3 Mystic Luminary Unit. The modApplied event carries no
// region (fireEvent falls back to all listeners), so when() scopes manually:
// battle phase, an AUGMENT application (not a graft), applied by my
// controller ("you" — the mod's owner is the applier), and in my region
// (R12). Unbounded graft: on a host, the host gains the +2/+2.
const mentorBuff: EffectDef = {
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    // test/65: the carrier dying between the augment and this resolving is a
    // real outcome, and an effect that completes in silence is indistinguishable
    // from a bug
    if (!self) {
      g.ev('info', `${ctx.sourceName}: the unit that would grow is gone — nothing happens.`);
      return;
    }
    g.addTemp(self, 2, 2);
  },
};
card('Morphic Mentor', {
  abilities: [{
    type: 'triggered', events: ['modApplied'], graftCause: true,
    label: 'I gain +2/+2 until regroup (you applied an augment in battle)',
    when: (g, self, ev) =>
      g.s.phase === 'battle' &&
      ev.data?.appliedAs === 'augment' &&
      g.entity(ev.data?.mod as EntityId)?.owner === self.controller &&
      g.entity(ev.data?.host as EntityId)?.region === self.region,
    effect: mentorBuff,
  }],
  graftEffect: { bounded: false, effect: mentorBuff },
});

// "[once] When another ally with greater defense than power spawns, draw a
// card." — e/3 1/3 Bird Insect Oracle Unit. This is R1's own textbook
// condition: defense > power is checked at EVENT time on the spawned unit.
// "Another ally": same controller, not me. [once] = once per turn, tracked
// per card (R9) → bounded. Region auto-scoped (R12).
card('Nectar Ridge Oracle', {
  abilities: [{
    type: 'triggered', events: ['spawned'], bounded: true,
    label: 'draw a card (ally spawned with defense > power)',
    when: (g, self, ev) => {
      if (ev.data?.seat !== self.controller || ev.data?.unit === self.id) return false;
      const u = g.entity(ev.data?.unit as EntityId);
      if (!u) return false;
      const [p, t] = g.effStats(u);
      return t > p;
    },
    effect: { run: (g, ctx) => g.draw(ctx.controller, 1) },
  }],
});

// "[Augment] If combat damage would be dealt to you, that damage is dealt to
// me instead." — eee/4 2/4 {Unstable} Luminary Strider {Virus} Unit.
// STILL PARKED, but ⚠ NOT on "there is no replacement seam" any more — that
// reason expired and the note outlived it (corrected 2026-08-22; see the
// header entry for the full account). R38's `replaceCombatDamageToPlayer` IS
// the seam, it is consulted by E.pumpCombatDamage before loseLife, and it is
// anchored on units in play and on augment mods reading from their host —
// which is precisely this card's shape. Blightsea Polyp already uses it.
//
// The one piece left: the hook must DEAL the redirected damage to me, and it
// is handed (g, self, seat, amount, info) with no EffectCtx, while
// dealEffectDamage requires one. Blightsea Polyp sidesteps that by replacing
// with rot (g.gainRot takes no ctx). So this is a small, well-defined job —
// the highest-value unpark left in the pool — not a missing framework.
//
// Registered with a no-op [Augment] text (events: [] never fires) so the card
// still spawns as a 2/4 and can be applied as a virus augment; the
// redirection does nothing. Declared in test/card-ledger.ts.
card('Oorblak', {
  augmentText: [{
    type: 'triggered', events: [],   // PARKED: no ctx-free way to damage a unit from the hook
    label: 'combat damage to you is dealt to me instead (PARKED)',
    effect: { run: () => { /* see above: the seam exists, the damage call does not */ } },
  }],
});

// "Whenever a mod is applied to me, create {/n}an X/X unit, where X is the
// mod's cost." — e/1 1/3 Structure Unit. Condition at event time: the mod
// landed on me. X = the mod card's total (corner) cost, read at RESOLUTION
// from the live mod entity (R1); the cost is printed data, so it cannot have
// changed — if the mod is somehow gone by resolution, nothing is created.
// (No graft cause on this card, so mods arrive via augment/virus only.)
card('Perpetual Construct', {
  abilities: [{
    type: 'triggered', events: ['modApplied'],
    label: "create an X/X unit (X = the mod's cost)",
    when: (g, self, ev) => ev.data?.host === self.id,
    effect: {
      creates: ['Unit Token'],
      run: (g, ctx) => {
        const mod = g.entity(ctx.event?.data?.mod as EntityId);
        if (!mod) return;
        const mana = getCard(mod.card).mana;
        const x = mana === 'X' ? 0 : mana;
        if (x > 0) g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [x, x] });
      },
    },
  }],
});

// "When I am dealt damage, [Switch1] Put a +1/+1 counter on me." — ee/2 0/4
// {Sluggish} Rock Beast Unit. 'damage' event, self-scoped. Bounded
// ([Switch1], R9); the counter is the bounded graft (on a host it grows the
// host).
const pebbleGrow: EffectDef = {
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    // test/65: damage that kills the Pebble outright still fires this, and it
    // must say why nothing happens rather than resolve into silence
    if (!self) {
      g.ev('info', `${ctx.sourceName}: the unit that would take the counter is gone — nothing happens.`);
      return;
    }
    g.addCounters(self, 1);
  },
};
card('Plodding Pebble', {
  abilities: [{
    type: 'triggered', events: ['damage'], self: true, bounded: true, graftCause: true,
    label: 'put a +1/+1 counter on me (dealt damage)',
    effect: pebbleGrow,
  }],
  graftEffect: { bounded: true, effect: pebbleGrow },
});

// "[Augment] {Inverted} Ancient Anima {Virus} Unit" — e/2 2/3. Type-line
// [Augment] grants {Inverted}; printed.augmentAttrs carries it, and
// printed.attrs keeps it live when played normally. ⚠ PARTIAL (see header):
// the Inverted stat swap is effStats layer 5, unimplemented — the attribute
// is tracked but does not yet flip power/defense.
card('Reality Bender', {});

// "[Augment] Whenever I am I dealt damage, I deal that much damage to each
// opponent." — e/4 4/4 Occult Avatar Unit (printed typo "I am I" preserved
// above). Text-box [Augment]. 'damage' event, self-scoped; the amount is the
// event's damage figure; "each opponent" = the event region's present seats
// other than my controller (R25), read at resolution.
card('Restitution', {
  augmentText: [{
    type: 'triggered', events: ['damage'], self: true,
    label: 'I deal that much damage to each opponent (I was dealt damage)',
    effect: {
      run: (g, ctx) => {
        const n = (ctx.event?.data?.n as number | undefined) ?? 0;
        if (n <= 0) return;
        const opponents = presentSeats(g, ctx.region).filter(s => s !== ctx.controller);
        g.dealEffectDamageAll(ctx, opponents.map(s => ({ target: { player: s }, n })));   // R80
      },
    },
  }],
});

// "Negate all effects. Erase all mods." — eee/4 {Battle} Druid Spell. At
// resolution this spell is already off the stack, so "all effects" = every
// remaining stack item (spells, spell units, tokens, ambushes, triggered and
// activated abilities alike). "All mods" is region-scoped (R12): every mod on
// every unit in this region is ERASED — deleted outright, entering no bin.
card('Return to Nature', {
  spellEffect: {
    run: (g, ctx) => {
      let touched = g.s.stack.length;
      for (const it of [...g.s.stack]) g.negate(it.id);   // R68: negate() splices
      for (const u of g.unitsIn(ctx.region)) {
        if (!u.mods.length) continue;
        for (const id of u.mods) delete g.s.entities[id];
        g.ev('info', `Return to Nature erases ${u.mods.length} mod(s) from ${u.card}.`);
        u.mods = [];
        touched++;
      }
      if (!touched) g.ev('info', 'Return to Nature: no effect on the stack and no mod in play — nothing happens.');
    },
  },
});
