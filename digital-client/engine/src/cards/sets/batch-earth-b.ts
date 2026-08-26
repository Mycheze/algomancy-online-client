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
 *  - nothing in this batch.
 *
 * 2026-08-24, literal-reading sweep (R125's principle applied to every clause
 * in this file). Two sentences were narrower than their words and are fixed
 * below, with tests in 112-literal-wood:
 *  - OORBLAK's replacement hook was a THIRD unit-damage commit that bypassed
 *    `E.preventUnitDamage`, so Phytochemical Protection's "prevent ALL damage
 *    that would be dealt to target unit" did not cover the damage this card
 *    redirects. Replacement and prevention now compose in printed order.
 *  - RETURN TO NATURE's "Erase all mods" walked `unitsIn`, i.e. kind 'unit'
 *    only, and left an augment riding a SPELL TOKEN (R89) in play.
 * UN-PARKED (kept here so the history is readable; nothing below is waiting):
 *  - Oorblak: was PARTIAL — the REDIRECT worked from 2026-08-22, the PIERCING
 *    EXCESS half did not, because `replaceCombatDamageToPlayer`'s `info`
 *    carried only `{attacker, region}` (so the hook could not tell a Piercing
 *    hit from an ordinary one) and its boolean return was all-or-nothing. R98
 *    added `attrs`/`pure` to `info` and widened the return to `boolean |
 *    number` (a number being the damage LET THROUGH); the card was rewritten
 *    against both on 2026-08-23 and came off test/card-ledger.ts.
 *  - Reality Bender: was PARTIAL, waiting on effStats layer 5. R93 shipped it
 *    (playtest report #73, 2026-08-22) and the card needed no change at all —
 *    its printed attrs and augmentAttrs were already right, so the layer alone
 *    unparked it. It came off test/card-ledger.ts with Its Dark Bubb.
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
import type { CardName, Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, getCard, isGraftMultiplier, type EffectDef } from '../dsl.ts';
import { selfOf, chooseUnit } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** present seats of a region, initiative player first (stable order) */
const presentSeats = (g: E, region: number): Seat[] => {
  const present = g.s.regions[region]!.presentSeats;
  return [g.initiative, g.nit].filter(s => present.includes(s));
};

// ────────────────────────────── the cards ──────────────────────────────

// "After combat, [Switch1][Switch1] {i}(Trigger two copies of this graft
// ability as one single trigger.)" — e/4 0/3 Cosmic Guardian Unit. R110: the
// card contributes no effect of its own — it is a graft MULTIPLIER.
// composeParts reads `graftCopies: 2` and materializes every other attached
// graft twice in the one composite (Graft 1 → Graft 2 → Graft 1 → Graft 2),
// bounded grafts included, each copy with its own targets and its own
// [cost] payment (paid twice or not at all). Grafted onto ANOTHER host, the
// same declaration doubles the host's other grafts (never itself — no
// doubling a doubler). Bounded ([Switch1], R9): once per turn as a cause
// and as a graft. Source: "Amphivore / Lost Guardian. Bounded Grafts and
// Ralph explained." (moderator ruling, 2025-03-21).
const doubleGrafts: EffectDef = {
  graftCopies: 2,
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    const others = self ? self.mods.filter(id => {
      const m = g.entity(id);
      // R131: NOT a card-name exclusion — the grafts this multiplier has
      // nothing to do with are the OTHER MULTIPLIERS (composeParts never
      // multiplies a multiplier), whatever they are called. A second copy
      // of this very card grafted here is one of them; a different multiplier
      // grafted alongside is too.
      return m && m.appliedAs === 'graft' && !isGraftMultiplier(m.card);
    }).length : 0;
    if (!others) g.ev('info', `${ctx.sourceName}: no other graft is attached — there is nothing to double.`);
    else g.ev('info', `${ctx.sourceName}: 2 copies of each grafted ability (${others} graft${others === 1 ? '' : 's'}), one single trigger.`);
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
// UN-PARKED 2026-08-22. The old note claimed this wanted "damage replacement
// hooks"; R38 had already shipped them as `replaceCombatDamageToPlayer`, which
// E.pumpCombatDamage consults for every player hit BEFORE loseLife, and
// Blightsea Polyp (batch-hybrids-ld-c) has used the seam since. The residual
// worry — "the hook has no EffectCtx and dealEffectDamage needs one" — was a
// false alarm: this is COMBAT damage, not effect damage, so the thing to copy
// is not dealEffectDamage at all but the combat sub-step's own per-unit commit
// (engine.ts, `u.damage += received` + a 'damage' event). That needs no ctx.
//
// ANCHORING. E.anchored hands the hook `self` = the UNIT the text is radiating
// from: the card itself while it is a unit in play, or the HOST when the text
// arrives donated by a virus/augment mod. R26 says a card's own [Augment] text
// is live when it is played normally, so both cases are real, and both readings
// fall out of the one line below: "me" is always `self`.
//
// WHOSE damage. The hook is offered to every holder in the battle region
// regardless of seat (that is deliberate — Blightsea Polyp's "columns" is
// plural and unowned, so the engine cannot pre-filter), and each card decides
// for itself. Oorblak says "dealt to YOU", which on a donated ability means the
// controller of the object carrying the text — i.e. `self.controller`, the
// host's controller, not the mod's owner. So virusing Oorblak onto an ENEMY
// unit does not steal their damage: it makes THEIR own unit eat THEIR combat
// damage. Hence the `seat !== self.controller` bail; without it a single
// Oorblak would swallow both players' hits.
//
// ⚠ Caleb 2024-10-24 (restated in dsl.ts): replacing damage does NOT unmake it.
// The hit still counts as DEALT, so {Lethal} still kills through this, and
// {Thieving}/{Blessed} still pay out — all of which the engine already handles
// by reading `playerHits` rather than the post-replacement `playerDmg`. Our
// side of that bargain is that the damage must land on Oorblak as real damage
// and be allowed to kill it, which is why we write `self.damage` and fire the
// 'damage' event ("whenever I am dealt damage" must hear this).
//
// We deliberately do NOT call checkDeaths(): ordinary combat damage does not
// kill until the state-based check, and pumpCombatDamage runs one right after
// the sub-step returns. Letting it do the killing keeps Oorblak dying on the
// same game-state check as everything else the exchange killed.
//
// PIERCING EXCESS (was the parked half; implemented 2026-08-23 on R98's wider
// hook). RAQ "[Solved] Oorblak vs Piercing" (_passer, answered by Caleb): "10
// damage is redirected to Oorblak, he takes 4 damage which is enough to kill
// him and leftover 6 damage is still Piercing so it goes to players face", and
// Caleb in rules-questions on 2025-04-09, answering _passer's case where
// Oorblak is virused UNDER A 1/1 (which is why one point kills it — read the
// thread, not the number):
//
//   "So we have 5 piercing damage attempting to hit the defending player, that
//    damage is redirected to oorblak, oorblak takes 5 piercing damage, 1 is
//    enough to kill it and the remaining 4 hit the player."
//   "Also it helps to remember that replacement effects only apply once in an
//    effect."
//
// So the excess carries on BECAUSE the hit is Piercing: a plain unblocked hit
// that overkills Oorblak still spills nothing. Two halves fall out of that:
//
//  1. HOW MUCH IS ABSORBED. Exactly the pool that would kill this body — the
//     same lethal-share arithmetic R103 fixed for effect damage
//     (`poolToKill` in dealEffectDamageAll) and R114 restated for combat
//     (`assignColumnDamage`). Written in the same order and out of the same
//     three clauses so the three cannot drift:
//       · {Powerful} has ALREADY doubled `amount` — the column doubles its
//         whole output at the source, before assignment (R103 step 1), so a
//         Powerful+Piercing column pierces the DOUBLED number and nothing has
//         to be done here.
//       · {Vulnerable} is priced on the RECEIVE side (R103 step 2): the pool
//         is counted in what the source deals, the toughness in what this body
//         takes, and `mult` is the exchange rate — so a Vulnerable Oorblak
//         needs half the pool to kill and the excess is what is left after
//         BOTH doublings. `!pure` guards it exactly as combat's own commit
//         does (R61: the exchange is attribute-blind).
//       · damage already on the body counts, because the hit has to kill what
//         is really there.
//     {Deadly} is deliberately NOT read here — see the note below.
//  2. WHAT IS HANDED BACK. R98 widened the return to `boolean | number`, a
//     number being the damage LET THROUGH, so the leftover is simply returned:
//     the engine adds it to the life loss for this hit. It is NOT re-offered
//     to this same Oorblak ("replacement effects only apply once in an
//     effect") — the engine's own loop moves on to the next holder — which is
//     the same answer as _passer's "cannot recursively go back".
//
// ⚠ {Deadly} is a KNOWN, DELIBERATE divergence from R103 step 4, not an
// oversight. R103 caps the lethal share at ONE point for a Deadly source, and
// on the unit-assignment path the KILL is then delivered by a separate
// mechanism (combat's `L.deadlyHit` sweep, which has already run by the time
// this hook is called — `sweepDeadly` sits before `commitPlayerDamage`). A
// replacement hook has no way to reach that sweep, so honouring the 1-point
// floor here would leave Oorblak alive on 1 damage AND send the rest to the
// face — strictly worse than absorbing the full lethal share. Killing from
// inside the hook (`g.destroy`) would fix the arithmetic but moves a death out
// of the state-based check, which is an ENGINE ordering decision and not the
// card's to make. Until that is ruled on, a Deadly+Piercing column redirected
// into Oorblak absorbs the full toughness and pierces the rest, which errs in
// the defender's favour rather than inventing life loss.
card('Oorblak', {
  // the [Augment] text is a replacement hook, not augmentAttrs/augmentText, so
  // nothing else would mark this card as legal to apply as an augment.
  augmentable: true,
  replaceCombatDamageToPlayer: (g, self, seat, amount, info) => {
    if (seat !== self.controller) return false;
    // R61 {Pure}: an attribute-blind exchange cannot see this body's
    // {Vulnerable} either — same guard combat's own commit loop uses.
    const mult = (!info.pure && g.effAttrs(self).has('Vulnerable')) ? 2 : 1;
    const [, t] = g.effStats(self);
    const needed = Math.max(0, t - self.damage);            // still to RECEIVE to kill
    const pool = Math.ceil(needed / mult);                  // …priced in what the source deals
    // Only {Piercing} leaves the body (R114). Everything else is absorbed
    // whole, however far past this toughness it goes — that is the half that
    // already worked and it must keep working.
    const absorbed = info.attrs.has('Piercing') ? Math.min(amount, pool) : amount;
    if (absorbed <= 0) return amount;                       // nothing left to soak: decline
    const received = absorbed * mult;
    // R98 — the THIRD unit-damage commit (2026-08-24 literal-reading audit).
    // "the one choke point both unit-damage commits now pass through" was true
    // of the engine and false of the board: this hook is a unit-damage commit
    // living in a CARD, and it wrote `self.damage` directly. So Phytochemical
    // Protection's "prevent ALL damage that would be dealt to target unit" —
    // no qualifier, no source, no kind — silently let redirected combat damage
    // through onto the one unit in the game whose whole job is to be dealt
    // damage that was aimed somewhere else. The two layers compose in printed
    // order and each keeps its own ruling: the REDIRECT is a replacement, so
    // it happens and "does NOT unmake" the hit (Caleb 2024-10-24) — hence the
    // absorption arithmetic and the Piercing leftover below are computed
    // exactly as before, off this body's real toughness; the SHIELD then
    // prevents what was redirected, and prevention DOES unmake it ("if there
    // is not damage being dealt, then no counters are placed" — RAQ), so a
    // shielded Oorblak takes no damage, fires no 'damage' event and banks a
    // +1/+1 counter per point instead. `settleDamagePrevention` is called here
    // because commitUnitDamage's own settle has already run by the time
    // commitPlayerDamage offers this hook — the counters are owed to THIS
    // sub-step, not the next one that happens to prevent something.
    const through = g.preventUnitDamage(self, received, {
      region: info.region, source: 'combat', combat: true,
      attrs: info.attrs, pure: info.pure,
    });
    if (through > 0) {
      self.damage += through;
      const ev = g.ev('damage', `${self.card} takes ${through} (${self.damage} total).`,
        { unit: self.id, n: through });
      g.fireEvent('damage', ev);
    }
    g.settleDamagePrevention();
    // (no checkDeaths() — see the note above: Oorblak dies on the same
    // state-based check as everything else this exchange killed.)
    return amount - absorbed;                               // the Piercing leftover, to the face
  },
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
        if (!mod) {
          g.ev('info', 'Perpetual Construct: the mod is gone — no unit is created.');
          return;
        }
        const mana = getCard(mod.card).mana;
        const x = mana === 'X' ? 0 : mana;
        if (x <= 0) {
          g.ev('info', `Perpetual Construct: ${mod.card} costs 0 — X = 0, no unit is created.`);
          return;
        }
        g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [x, x] });
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
// printed.attrs keeps it live when played normally. Nothing else is needed:
// R93 made {Inverted} stat layer 5 (it negates the net stat change from base,
// `2*base - current`, after layer 4), so the whole card is the attribute and
// the layer does the work. Donating it onto a unit that has been pumped is
// what makes this a Virus worth holding — see 17-earth-b's Morphic Mentor
// case, whose old assertion had quietly encoded the missing layer.
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
        if (n <= 0) { g.ev('info', 'Restitution: no damage was dealt to me — nothing is passed on.'); return; }
        const opponents = presentSeats(g, ctx.region).filter(s => s !== ctx.controller);
        if (!opponents.length) { g.ev('info', 'Restitution: no opponent is present here — no damage.'); return; }
        g.dealEffectDamageAll(ctx, opponents.map(s => ({ target: { player: s }, n })));   // R80
      },
    },
  }],
});

// "Negate all effects. Erase all mods." — eee/4 {Battle} Druid Spell. At
// resolution this spell is already off the stack, so "all effects" = every
// remaining stack item (spells, spell units, tokens, ambushes, triggered and
// activated abilities alike). "All mods" is region-scoped (R12): every mod on
// every MODDED THING in this region is ERASED — deleted outright, entering no
// bin.
//
// ⚠ "all mods" is not "all mods on units" (2026-08-24 literal-reading audit).
// This walked `g.unitsIn(region)`, which is `kind === 'unit'` and nothing else,
// so an augment sitting on a SPELL TOKEN in play survived a spell whose whole
// text is two unqualified sweeps. R89 makes that a real board state — Caleb,
// rules-questions 2025-03-06, asked "can i augment my spells during
// deployment?": "You can augment spells during deployment but currently that
// would only be possible with spell tokens. Also you can only do this with
// attributes… Mostly, deadly, piercing and powerful are impacted by this" —
// and `ownAttrs` reads an entity's augment mods whatever its kind, so a
// {Deadly} Fireball token really is carrying its mod into this battle. The
// walk is over the modded entities in the region instead; mods on the stack
// need no clause of their own, since sentence one has already negated (and
// discharged) every item they could be riding.
card('Return to Nature', {
  spellEffect: {
    run: (g, ctx) => {
      let touched = g.s.stack.length;
      // R128: "negate all effects" is the WHOLE stack, a {Battle} unit mid-cast
      // included — the owner reversed R60 on 2026-08-24 ("ANYTHING on the stack
      // is an effect"). Confirmed as-is; do not narrow this by kind.
      for (const it of [...g.s.stack]) g.negate(it.id);   // R68: negate() splices
      const modded = Object.values(g.s.entities).filter(e =>
        (e.kind === 'unit' || e.kind === 'spellToken') && e.region === ctx.region
        && !e.absent && e.mods.length > 0);
      for (const u of modded) {
        // R65/R156: an erase must reach the PUBLIC ERASED PILE, and each card
        // reaches its OWN owner's pile — a mod's owner is the player who
        // applied it, not the unit's controller. This used to be a bare
        // `delete` plus an 'info' line, so a nontoken mod card left the game
        // and neither player could see where it went. `E.ev('erased', …)` is
        // the only thing that files the pile (E.ev reads `seat` + `cards`),
        // which is the same line disposeToBin emits for a token mod.
        const mods = u.mods.map(id => g.entity(id)).filter((m): m is Entity => !!m);
        const byOwner = new Map<Seat, CardName[]>();
        for (const m of mods) {
          const list = byOwner.get(m.owner) ?? [];
          list.push(m.card);
          byOwner.set(m.owner, list);
        }
        for (const [owner, cards] of byOwner) {
          g.ev('erased', `${cards.join(', ')} — erased from ${u.card} by Return to Nature.`,
            { seat: owner, cards });
        }
        const n = u.mods.length;
        // R208 / CT-86: through `E.eraseMod`, the choke point. This site is the
        // one that already got the R65 announcement RIGHT (the 'erased' event
        // above), which is why it is the template the primitive was written
        // against — but it hand-rolled the delete like the other four. Nothing
        // it emits changed. `u.mods = []` stays as the belt for an id whose
        // entity was already gone, which eraseMod declines to touch.
        // R219 — `alreadyFiled`: the grouped `erased` line above IS the pile
        // entry, one per owner. eraseMod files the pile itself now, so without
        // this every card would be listed twice. This site also files TOKEN
        // mods (matching disposeToBin), which eraseMod deliberately does not —
        // another reason it keeps its own line rather than delegating.
        for (const m of mods) g.eraseMod(m, { alreadyFiled: true });
        g.ev('info', `Return to Nature erases ${n} mod(s) from ${u.card}.`);
        u.mods = [];
        touched++;
      }
      if (!touched) g.ev('info', 'Return to Nature: no effect on the stack and no mod in play — nothing happens.');
    },
  },
});
