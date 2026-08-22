/* batch-hybrids-fwe — the fire/water/earth dual-element (hybrid) batch,
 * scripted over the printed data in printed.json (never hand-copied).
 * Printed text quoted in comments for review.
 *
 * Owned by one card-scripting agent; see sets/index.ts for ordering rules.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R6 (mid-resolution payments/choices via ctx.choose), R9 (bounded
 * [Switch1]/[once] budgets per card), R12/R25 ("each player/opponent" and
 * "your/ally" read the event region's present seats / unitsOf(region)),
 * R14 ("this battle" counters are per region-battle), R22 (Ambush is an
 * engine-level play mode driven by printed.ambush).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - "DESPAWN" = ANY leave-play, so despawn triggers listen to BOTH 'died'
 *    (destroy/sacrifice) and 'despawned' (recall) — the Bloated Manablub
 *    precedent. Note: an augment-DONATED "when I despawn" only fires on the
 *    host's death, not its recall (recall() erases the mod entities before
 *    firing the event, destroy() after — engine asymmetry, flagged).
 *  - MULTI-TARGET spells (Channel Through, Torrential Reclamation): NO LONGER
 *    an approximation. This said "the engine's cast-time targeting holds ONE
 *    target per part, so the caster picks the units mid-resolution"; R64's
 *    `count: 'X'` (with min: 0) collects them all as the spell goes on the
 *    stack, which both cards use. What stays mid-resolution is Channel
 *    Through's DISTRIBUTION of its 2 damage among the opponent's units — a
 *    division of damage, not a set of declared targets.
 *  - PLAIN "spell" includes spell tokens (Origon, Death Greeter): the pool's
 *    exclusion wording is "nontoken spell", so its absence counts tokens.
 *
 * Nothing is parked in this batch any more; both entries that used to sit here
 * have been overtaken:
 *  - Stasis Sentry, parked on "there is no cost-modification layer". R59's
 *    CostMod is that layer, and the card is a live `costMods` entry now.
 *  - Channel Through / Torrential Reclamation (X half), parked on "no
 *    cast-time 'choose and pay X' primitive exists". R35's collectX fixes X
 *    before the spell reaches the stack, and both cards read `ctx.x`.
 */
import type { Entity, EntityId, Seat } from '../../types.ts';
import { card, getCard, isEntityTarget, unitRestrict, type EffectDef } from '../dsl.ts';
import { selfOf, inEndOfTurn, pickUnit } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** printed mana of a card name; X counts as 0 (⚠ approximation — the event
 * snapshot carries no x, and X-cost items played from hand have x = 0). */
const manaOf = (name: unknown): number => {
  if (typeof name !== 'string') return 0;
  const m = getCard(name).mana;
  return typeof m === 'number' ? m : 0;
};

// ─────────────────────── WATER / EARTH (be) ───────────────────────────

// "[Augment] When I despawn, create a Crystal X, where X is my defense." —
// be/3 1/3 Mystic Primordial Pile Unit. Text-box [Augment] (text only), live
// when played normally (Manual Q&A). Despawn = died + despawned (⚠ header).
// X is MY defense as I leave play — the entity no longer exists at trigger
// resolution, so the defense is snapshotted into the event at event time
// (the when() bookkeeping pattern, batch-water-a precedent): the last
// in-play value IS the amount, there is no later state to re-read (R1).
card('A Pile of Runes', {
  augmentText: [{
    type: 'triggered', events: ['died', 'despawned'], self: true,
    label: 'create a Crystal X (X = my defense)',
    when: (g, self, ev) => {
      if (ev.data) ev.data['aporDefense'] = g.effStats(self)[1];   // snapshot: I'm gone at resolution
      return true;
    },
    effect: {
      creates: ['Crystal'],
      run: (g, ctx) => {
        const x = (ctx.event?.data?.['aporDefense'] as number | undefined) ?? 0;
        if (x <= 0) { g.ev('info', 'A Pile of Runes: its defense was 0 — no Crystal.'); return; }
        g.createSpellToken(ctx.controller, 'Crystal', x, ctx.region);
      },
    },
  }],
});

// "[Battle] Ambush [2be] (Play me with the effect "Recall target ally, put me
// into their position in play.") [once] When I am dealt damage, I deal that
// much damage to target unit." — be/2 1/1 Arcane Crab Unit. The Ambush mode
// is engine-level (printed.ambush, R22). The [once] trigger fires on the
// 'damage' event (self); "that much" is read from the event snapshot (R1 —
// the event IS the amount's definition); bounded per card (R9).
card('Mirrorback Ambusher', {
  abilities: [{
    type: 'triggered', events: ['damage'], self: true, bounded: true,   // [once]
    label: 'I deal that much damage to target unit',
    effect: {
      targets: { what: 'unit', prompt: 'Mirrorback Ambusher: deal that much damage to target unit' },
      run: (g, ctx) => {
        const n = (ctx.event?.data?.n as number | undefined) ?? 0;
        const t = ctx.targets[0];
        if (t && n > 0) g.dealEffectDamage(ctx, t, n);
      },
    },
  }],
});

// "[Augment] Whenever a player plays their first spell in this battle, negate
// it." — be/5 6/7 Polyform Primordial Beast Unit. Text-box [Augment].
// "First spell this battle" is a per-instance battle counter (R14) bumped
// inside when() — fireEvent evaluates when() exactly once per event per
// listener (the Seabed Shellcaster pattern), so the count is exact per
// carrier. ⚠ only spells played while the carrier is in play in-region are
// counted (a listener can't see earlier ones). Plain "spell" includes spell
// tokens (⚠ header). At event time the spell is not yet on the stack
// (commitItem fires spellPlayed before pushItem), so the effect finds it at
// resolution: the BOTTOM-most un-negated spell-kind item matching the
// event's card + controller (the trigger sits above it and resolves first).
card('Origon', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'],
    label: "negate a player's first spell in this battle",
    when: (g, self, ev) => {
      if (g.s.phase !== 'battle') return false;
      const region = (ev.data?.region as number | undefined) ?? self.region;
      return g.bumpBattleCounter(region, `origon:${self.id}:${ev.data?.seat}`) === 1;
    },
    effect: {
      run: (g, ctx) => {
        const name = ctx.event?.data?.card as string | undefined;
        const seat = ctx.event?.data?.seat as Seat | undefined;
        if (name === undefined || seat === undefined) return;
        const spellKinds = new Set(['spell', 'spellUnit', 'spellToken']);
        const it = g.s.stack.find(i =>
          i.card === name && i.controller === seat && spellKinds.has(i.kind));
        if (it) g.negate(it.id);
        else g.ev('info', `Origon: ${name} already left the stack — not negated.`);
      },
    },
  }],
});

// "[Augment] Spells with base cost [three] or less have a base cost of
// [three] to play during battle." — be/3 2/4 Arcane Beast Unit.
//
// UN-PARKED (R59). This was parked on "a continuous cost-modification layer
// does not exist", with an inert augmentText stand-in; `CardBehavior.costMods`
// is that layer (Tranquility and The Silent are the precedents), and it
// radiates from the card in play AND from the augment mod anchored on its host
// (E.costModsFor -> E.anchored), which is exactly what a text-box [Augment]
// wants.
//
// Clause by clause:
//  - "Spells" = the spell CARD kinds you PLAY (spell / spellUnit). A spell
//    token is cast from play, not played; a unit is not a spell.
//  - "to play" = playing it. Applying it as a mod is not playing (R37), which
//    `purpose: 'mod'` excludes for free.
//  - "base cost [three] or less" reads the PRINTED mana. ⚠ An X-COST SPELL IS
//    EXCLUDED (flagged for a ruling): its base cost is not a number on the
//    card, it is whatever the caster chooses to pay, so "with base cost three
//    or less" does not name it. Reading X as its floor of 0 would instead put
//    a +3 tax on every X spell in the game — including ones you meant to cast
//    for more than three — which is plainly not what the card says.
//  - "have a base cost of [three]" is a RAISE to three, not a discount: the
//    delta is `3 - printed`, which is 0 at exactly three and never negative.
//  - Unqualified subject, so it hits BOTH players, and region-scoped (R12)
//    like every continuous effect.
card('Stasis Sentry', {
  augmentable: true,
  costMods: [{
    delta: (g, _self, ctx) => {
      if (g.s.phase !== 'battle' || ctx.purpose !== 'play') return 0;
      if (ctx.card.kind !== 'spell' && ctx.card.kind !== 'spellUnit') return 0;
      if (ctx.card.mana === 'X') return 0;   // ⚠ see the note above
      return ctx.card.mana <= 3 ? 3 - ctx.card.mana : 0;
    },
  }],
});

// "[Augment] After combat, recall me." — be/2 0/5 {Haste} Primordial Polyform
// Unit. Text-box [Augment], live when played normally. NOT self:true — the
// afterCombat event carries no source unit (Smouldering Inferno precedent).
// Region-scoped (R12): fires only when combat happened in my region.
card('Unfinished Creation', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'recall me (after combat)',
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (self) g.recall(self);
      },
    },
  }],
});

// ─────────────────────── FIRE / WATER (rb) ────────────────────────────

// "When a player loses life during battle, [Switch1] Draw a card." — rb/5
// 3/3 Cosmic Elemental Unit. 'lifeLost' is region-scoped in battle (R12);
// the "during battle" gate is the phase check (R1, event time). Bounded
// graft cause + bounded graft ([Switch1], R9).
const painseekerDraw: EffectDef = { run: (g, ctx) => g.draw(ctx.controller, 1) };
card('Astral Painseeker', {
  abilities: [{
    type: 'triggered', events: ['lifeLost'], bounded: true, graftCause: true,
    label: 'draw a card (a player lost life during battle)',
    when: g => g.s.phase === 'battle',
    effect: painseekerDraw,
  }],
  graftEffect: { bounded: true, effect: painseekerDraw },
});

// "[Augment] Whenever you play a spell during battle, each player sacrifices
// a unit with cost less than or equal to the spell's cost. (If able.)" —
// rb/3 4/2 Elemental Spirit Unit. Text-box [Augment]. Plain "spell" includes
// spell tokens (⚠ header); the spell's cost is its printed mana read from
// the event snapshot (⚠ an X spell counts as 0 — the event carries no x).
// "Each player" = the region's present seats (R25); each picks their own
// eligible unit (unit cost = printed mana; tokens cost 0), plan-then-commit.
card('Death Greeter', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'],
    label: "each player sacrifices a unit with cost ≤ the spell's cost",
    when: (g, self, ev) => g.s.phase === 'battle' && ev.data?.seat === self.controller,
    effect: {
      run: (g, ctx) => {
        const cost = manaOf(ctx.event?.data?.card);
        const picks: EntityId[] = [];
        for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
          const pool = g.unitsOf(seat as Seat, ctx.region)
            .filter(u => manaOf(u.card) <= cost);
          const id = pickUnit(ctx, `sac:${seat}`, seat as Seat, pool,
            `Death Greeter: sacrifice a unit with cost ${cost} or less`);
          if (id !== null) picks.push(id);   // (If able.) — empty pool skips the seat
        }
        for (const id of picks) {
          const u = g.entity(id);
          if (u) g.destroy(u, 'is sacrificed');
        }
      },
    },
  }],
});

// "When I despawn, you may pay [one] to draw a card and lose 1 life." —
// br/1 2/1 Infernal Sprite Oracle Unit. Despawn = died + despawned (⚠
// header). The [one] payment is a mid-resolution pay-or-decline (R6),
// skipped when the controller cannot pay; auto-declined during end-of-turn
// resolution ("may" — no suspensions there, batch-fire-a precedent).
card('Tempest Oracle', {
  abilities: [{
    type: 'triggered', events: ['died', 'despawned'], self: true,
    label: 'you may pay [one] to draw a card and lose 1 life',
    effect: {
      run: (g, ctx) => {
        if (g.openMana(ctx.controller) < 1 || inEndOfTurn(g)) {
          g.ev('info', 'Tempest Oracle: the [one] cannot be offered right now — no draw.');
          return;
        }
        const pay = ctx.choose('pay', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Tempest Oracle: pay [one] to draw a card and lose 1 life?',
          options: [
            { label: 'Pay [one] — draw a card, lose 1 life', value: true },
            { label: 'Decline', value: false },
          ],
        });
        if (!pay) { g.ev('info', 'Tempest Oracle: the [one] is declined — no draw.'); return; }
        g.payMana(ctx.controller, 1);
        g.draw(ctx.controller, 1);
        g.loseLife(ctx.controller, 1, 'Tempest Oracle');
      },
    },
  }],
});

// "Recall X target nontoken allies. Then each player sacrifices a unit and
// you lose 1 life for each ally recalled this way." — br/X 1/3 {Battle}
// Elemental Spell. X is chosen and paid AT CAST (R35) and read from item.x
// here. R64: "X target nontoken allies" are CAST-TIME targets — they used to
// be picked mid-resolution, so the spell went on the stack aiming at nobody.
// The "for each" distributes over both clauses: per recalled ally, each
// present player (R25) sacrifices a unit and the caster loses 1 life. The
// SACRIFICES stay at resolution: each player picks their own, which is a
// choice about the spell resolving, not a target it declares.
card('Torrential Reclamation', {
  spellEffect: {
    targets: {
      what: 'allyUnit', count: 'X', min: 0,
      prompt: 'Torrential Reclamation: recall X target nontoken allies',
      restrict: unitRestrict((_g, u) => !u.token),
    },
    run: (g, ctx) => {
      const x = ctx.x ?? 0;   // chosen and paid at cast (R35)
      if (x <= 0) { g.ev('info', 'Torrential Reclamation: X = 0 — no effect.'); return; }
      const recalled = ctx.targets.filter(isEntityTarget).map(t => g.entity(t.id)).filter((u): u is Entity => !!u);
      if (!recalled.length) {
        g.ev('info', 'Torrential Reclamation: every targeted ally has left play — nothing is recalled.');
        return;
      }
      // plan the sacrifices: one round per recalled ally, each player picks
      const sacs: EntityId[] = [];
      for (let r = 0; r < recalled.length; r++) {
        for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
          const pool = g.unitsOf(seat as Seat, ctx.region).filter(u =>
            !sacs.includes(u.id) && !recalled.some(p => p.id === u.id));
          const id = pickUnit(ctx, `sac:${r}:${seat}`, seat as Seat, pool,
            'Torrential Reclamation: sacrifice a unit');
          if (id !== null) sacs.push(id);
        }
      }
      // commit
      for (const u of recalled) g.recall(u);
      for (const id of sacs) {
        const u = g.entity(id);
        if (u) g.destroy(u, 'is sacrificed');
      }
      for (let r = 0; r < recalled.length; r++) g.loseLife(ctx.controller, 1, 'Torrential Reclamation');
    },
  },
});

// ─────────────────────── EARTH / FIRE (er) ────────────────────────────

// "I deal 2 damage to each of X target allies. For each ally damaged this
// way, distribute 2 damage among target opponent's units." — eer/X 0/6
// {Battle} Elemental Spell. X is chosen and paid AT CAST (R35) and read from
// item.x here. R64: the "X target allies" are CAST-TIME targets (they were
// picked mid-resolution, so the spell hit the stack aiming at nobody). The
// per-point DISTRIBUTION stays a mid-resolution choose: it is a division of
// damage among the opponent's units, not a set of declared targets — the
// printed target there is the opponent, who in 1v1 is the only one.
// The 2 distributed damage is committed in 1-point increments (a point aimed
// at a unit that died mid-commit is lost).
card('Channel Through', {
  spellEffect: {
    targets: {
      what: 'allyUnit', count: 'X', min: 0,
      prompt: 'Channel Through: deal 2 damage to each of X target allies',
    },
    run: (g, ctx) => {
      const x = ctx.x ?? 0;   // chosen and paid at cast (R35)
      if (x <= 0) { g.ev('info', 'Channel Through: X = 0 — no effect.'); return; }
      const picked = ctx.targets.filter(isEntityTarget).map(t => g.entity(t.id)).filter((u): u is Entity => !!u);
      if (!picked.length) {
        g.ev('info', 'Channel Through: every targeted ally has left play — nothing is damaged.');
        return;
      }
      // plan: per damaged ally, distribute 2 damage among opponent units
      const enemies = () => g.unitsIn(ctx.region).filter(u => u.controller !== ctx.controller);
      const alloc: EntityId[][] = picked.map((_, i) => {
        const out: EntityId[] = [];
        for (let k = 0; k < 2; k++) {
          const id = pickUnit(ctx, `dist:${i}:${k}`, ctx.controller, enemies(),
            `Channel Through: distribute damage (ally ${i + 1}, point ${k + 1} of 2)`);
          if (id !== null) out.push(id);
        }
        return out;
      });
      // commit: 2 to each ally, then its 2 distributed points
      picked.forEach((ally, i) => {
        if (!g.entity(ally.id)) return;   // gone before its turn: not "damaged this way"
        g.dealEffectDamage(ctx, ally, 2);
        for (const id of alloc[i]!) {
          const u = g.entity(id);
          if (u) g.dealEffectDamage(ctx, u, 1);
        }
      });
    },
  },
});

// "[Augment] Whenever I survive damage, each opponent sacrifices that many
// units." — err/7 7/6 Infernal Rock Elemental Unit. Text-box [Augment].
// "Survive" is checked at event time (R1): the damage event fires after the
// damage is marked, so I survived iff my marked damage is still below my
// defense (⚠ a Deadly hit below toughness misfires — the kill lands after
// the event). "That many" = the event's damage amount (snapshot); "each
// opponent" is region-scoped (R25), each picks their own units,
// plan-then-commit; fewer units than N sacrifices them all (if able).
card('Molten Tormentor', {
  augmentText: [{
    type: 'triggered', events: ['damage'], self: true,
    label: 'each opponent sacrifices that many units (I survived damage)',
    when: (g, self) => {
      const u = g.entity(self.id);
      return !!u && u.damage < g.effStats(u)[1];
    },
    effect: {
      run: (g, ctx) => {
        const n = (ctx.event?.data?.n as number | undefined) ?? 0;
        if (n <= 0) { g.ev('info', 'Molten Tormentor: 0 damage survived — nobody sacrifices.'); return; }
        const picks: EntityId[] = [];
        for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
          if (seat === ctx.controller) continue;
          for (let k = 0; k < n; k++) {
            const pool = g.unitsOf(seat as Seat, ctx.region).filter(u => !picks.includes(u.id));
            const id = pickUnit(ctx, `sac:${seat}:${k}`, seat as Seat, pool,
              `Molten Tormentor: sacrifice ${n} unit(s) — pick ${k + 1}`);
            if (id === null) break;
            picks.push(id);
          }
        }
        if (!picks.length) g.ev('info', 'Molten Tormentor: no opponent here has a unit to sacrifice.');
        for (const id of picks) {
          const u = g.entity(id);
          if (u) g.destroy(u, 'is sacrificed');
        }
      },
    },
  }],
});

// "[Augment][once] [one], Erase one of my mods: I deal 2 damage to any
// target." — er/2 2/2 Slag Beast {Virus} Unit. An ACTIVATED ability in the
// [Augment] text box: live when played normally (via: 'augment') and donated
// to hosts (via: { mod }) — the Infernal Cultivator precedent. The mana is a
// real activation cost; the mod erasure happens at resolution (⚠
// approximation of a true cost, same precedent): pick one of my mods, remove
// it from the game entirely (no bin, no triggers), then deal the 2. With no
// mods to erase the cost is unpayable — the ability resolves without effect.
// [once] = bounded per card (R9). {Virus} play mode is engine-level.
card('Slag Spewer', {
  augmentText: [{
    type: 'activated', cost: { mana: 1 }, bounded: true,   // [once]
    label: '[one], erase one of my mods: I deal 2 damage to any target',
    effect: {
      targets: { what: 'any', prompt: 'Slag Spewer: deal 2 damage to any target' },
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) return;
        const mods = self.mods
          .map(id => g.entity(id))
          .filter((m): m is Entity => !!m);
        if (!mods.length) {
          g.ev('info', 'Slag Spewer: no mod to erase — no effect.');
          return;
        }
        const id = pickUnit(ctx, 'mod', ctx.controller, mods,
          'Slag Spewer: erase which of my mods?')!;
        const mod = g.entity(id);
        if (!mod) return;
        self.mods.splice(self.mods.indexOf(id), 1);
        delete g.s.entities[id];
        g.ev('info', `${mod.card} is ERASED (Slag Spewer).`);
        const t = ctx.targets[0];
        if (t) g.dealEffectDamage(ctx, t, 2);
      },
    },
  }],
});

// "[Switch1] /[Sacrifice a unit]: Each opponent sacrifices units until their
// total defense is at least equal to the defense of your sacrificed unit."
// — eer/3 1/6 {Battle} Elemental Structure Spell. The bracketed sacrifice is
// a CAST COST (R35): chosen and paid before the spell reaches the stack (a
// grafted rider pays — or declines — at composite cast time). The bar is the
// sacrificed unit's defense SNAPSHOTTED at payment (it is gone by
// resolution). Opponents' defenses are live effStats at resolution (R1).
// "Each opponent" region-scoped (R25); each keeps picking until their picked
// total defense reaches the bar or they run out. Plan-then-commit; bounded
// graft ([Switch1], R9).
const collapseSacrifice: EffectDef = {
  castCost: { kind: 'sacrificeUnit' },
  run: (g, ctx) => {
    const bar = ctx.costPaid?.sacrificed?.defense ?? 0;
    if (bar <= 0) return;   // rider declined / unpayable, or a 0-defense cost
    const picks: EntityId[] = [];
    for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
      if (seat === ctx.controller) continue;
      let total = 0;
      const chosen: EntityId[] = [];
      while (total < bar) {
        const pool = g.unitsOf(seat as Seat, ctx.region).filter(u => !chosen.includes(u.id));
        const id = pickUnit(ctx, `sac:${seat}:${chosen.length}`, seat as Seat, pool,
          `Structural Collapse: sacrifice units (total defense ${total} of ${bar} needed)`);
        if (id === null) break;
        const u = g.entity(id);
        if (!u) break;
        chosen.push(id);
        total += g.effStats(u)[1];
      }
      picks.push(...chosen);
    }
    if (!picks.length) g.ev('info', 'Structural Collapse: nobody here has a unit to sacrifice.');
    for (const id of picks) {
      const u = g.entity(id);
      if (u) g.destroy(u, 'is sacrificed');
    }
  },
};
card('Structural Collapse', {
  spellEffect: collapseSacrifice,
  graftEffect: { bounded: true, effect: collapseSacrifice },
});

// "[Augment] After combat, sacrifice another unit." — er/1 4/4 Occult Anima
// {Virus} Unit. Text-box [Augment], live when played normally. Mandatory:
// the controller sacrifices one of their OTHER units in the region (the
// carrier stays); auto-picked when forced, nothing with no other unit.
card('Unstable Form', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'sacrifice another unit (after combat)',
    effect: {
      run: (g, ctx) => {
        const pool = g.unitsOf(ctx.controller, ctx.region).filter(u => u.id !== ctx.sourceId);
        if (!pool.length) { g.ev('info', 'Unstable Form: you control no OTHER unit here — nothing is sacrificed.'); return; }
        const id = inEndOfTurn(g)
          ? pool[0]!.id   // mandatory: deterministic auto-pick, no suspension
          : pickUnit(ctx, 'sac', ctx.controller, pool, 'Unstable Form: sacrifice another unit')!;
        const u = g.entity(id);
        if (u) g.destroy(u, 'is sacrificed');
      },
    },
  }],
});

// ─────────────────────── WATER / FIRE (br) ────────────────────────────

// "[Augment] Whenever one of your units despawns, I deal 1 damage to any
// target." — br/4 3/3 Demon Spirit Unit. Text-box [Augment]. Despawn =
// died + despawned (⚠ header); "one of your units" = same controller, no
// "another" clause so the carrier's own departure counts too. Targeted
// trigger (spec 'any'); the amount is fixed at 1.
card('Demon of the Depths', {
  augmentText: [{
    type: 'triggered', events: ['died', 'despawned'],
    label: 'I deal 1 damage to any target (one of your units despawned)',
    when: (g, self, ev) => ev.data?.seat === self.controller,
    effect: {
      targets: { what: 'any', prompt: 'Demon of the Depths: deal 1 damage to any target' },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (t) g.dealEffectDamage(ctx, t, 1);
      },
    },
  }],
});
