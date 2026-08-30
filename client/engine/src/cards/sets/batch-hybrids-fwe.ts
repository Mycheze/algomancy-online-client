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
import { selfOf, pickUnit, eventCardCost } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** the cost of a card known only by NAME — a unit standing in play, a card in
 * a zone. R157 §1: an X card that was never cast has had no X paid for it, so
 * it has no cost and counts as 0 (see sets/helpers.ts `manaOf`, the same rule;
 * this local flavour only adds the unknown-input guard). For a spell that was
 * actually cast, use `eventCardCost` — the paid X is on the event. */
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
//
// R166 — "THEIR FIRST SPELL" IS THE SEAT'S, NOT THE CARRIER'S.
//
// This used to count with a PER-INSTANCE battle counter bumped inside when()
// (`origon:<self.id>:<seat>`), so it counted only the spells played while THIS
// carrier was in play in-region: an Origon that arrived mid-battle — spawned
// by an effect, taken with E.giveControl, or applied as an [Augment] under
// R95's battle-time permission — negated the first spell IT saw rather than
// the seat's actual first, and two Origons that arrived at different moments
// each negated a different spell. The printed subject is the PLAYER ("a player
// plays THEIR first spell in this battle"); nothing on the card is about when
// I turned up.
//
// The seat's own ledger is `spellsPlayedAny:<seat>` (engine.ts, commitItem),
// bumped BEFORE 'spellPlayed' fires, so the event whose counter reads 1 IS
// that seat's first spell of this region's battle (R14). It is the
// TOKEN-INCLUSIVE ledger deliberately: this card prints a plain, unqualified
// "spell", and R157 §13 is *"Tokens are spells"* — the same audit that put
// spell tokens back into Hexbane Shiitake's "a spell" (⚠ header). Its narrow
// sibling `spellsPlayed:<seat>` belongs to the cards that PRINT the narrow
// noun (Animated Spark's "nontoken spell"), and reusing it here would have
// quietly decided that casting a token is not playing a spell.
//
// At event time the spell is not yet on the stack (commitItem fires
// 'spellPlayed' before pushItem), so the effect finds it at resolution — BY
// ITS ID (R191). The event carries `item`, the played item's id (R178), so
// "negate IT" is answered by IDENTITY and not by a scan at all. This used to
// be `[...g.s.stack].reverse().find(i => i.card === name && i.controller ===
// seat && …)` under a paragraph explaining why the TOP match is the right one
// — true under today's push order (the trigger sits above the spell and
// resolves first) and a heuristic under any other, which is what a paragraph
// of justification was really admitting. Earthbound Replicator converted first
// (R178); Hexbane Shiitake, the pool's other card that located a spell by
// (card, controller), converts in this same ruling.
//
// …AND NOT A COPY (R164) — a SEPARATE question from WHICH item is found, and
// one the id must not quietly answer differently. A copy of a spell is a real
// stack item carrying the ORIGINAL's card name and controller, which is what
// made it reachable by the scan; it is not reachable by an id, because
// `pushSpellCopy` deliberately does not go through `commitItem`, so no
// 'spellPlayed' event ever names a copy. The guard therefore stays, as an
// ASSERTION of what that id must be (the Earthbound Replicator precedent) —
// and it is the assertion the printed pronoun demands: "whenever a
// player plays their first spell in this battle, negate IT" — "it" is the
// spell that was played, and RAQ (_passer, quoted at `StackItem.copy`) is
// explicit that a copy is not: *"the 1st copy wasn't 'played'"*. A copy is
// negatable by anything that targets an effect on the stack; it is simply not
// the thing this sentence points at. (Hexbane Shiitake answers the same way,
// for the same reason and off its own pronoun — "that spell" — but the two
// were read separately: their texts happen to agree, not their code.)
card('Origon', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'],
    label: "negate a player's first spell in this battle",
    when: (g, self, ev) => {
      if (g.s.phase !== 'battle') return false;
      const region = (ev.data?.region as number | undefined) ?? self.region;
      const seat = ev.data?.seat as Seat | undefined;
      if (seat === undefined) return false;
      return g.battleCounter(region, `spellsPlayedAny:${seat}`) === 1;
    },
    effect: {
      run: (g, ctx) => {
        const name = ctx.event?.data?.card as string | undefined;
        const seat = ctx.event?.data?.seat as Seat | undefined;
        const itemId = ctx.event?.data?.['item'] as number | undefined;
        if (name === undefined || seat === undefined) return;
        const spellKinds = new Set(['spell', 'spellUnit', 'spellToken']);
        const it = g.s.stack.find(i =>
          i.id === itemId && i.controller === seat && spellKinds.has(i.kind) && !i.copy);
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
//  - "base cost [three] or less" reads the base cost, and R157 §1 settles what
//    that is for an X card: *"Pips aren't a relevant part of looking at the
//    cost of a card in Algomancy. And paying X replaces the letter X on the
//    printed card temporarily."* The base cost of an X spell is THE X THE
//    CASTER CHOSE — so there is no exclusion and no special case: one read of
//    the base cost covers every card.
//  - "have a base cost of [three]" is a RAISE to three, not a discount: the
//    delta is `3 - base`, which is 0 at exactly three and never negative.
//    R157 §20 says exactly this of an X spell — *"They're sort of exempt, but
//    only if X => 3. If the player wants to cast it for 0, 1, or 2, they'd
//    have to pay the tax to bring its cost to at least 3."* Wildfire for X=0
//    costs [3]; for X=2 costs [3]; for X=3 costs [3]; for X=5 costs [5]. It is
//    neither the flat exemption this used to ship nor a flat +3.
//  - The chosen X reaches here as `ctx.x` (R157 §1, CostCtx.x). It is
//    `undefined` while the X is still open — the castability gate, a price
//    quote — and the printed floor stands in there, which is what makes the
//    gate price the CHEAPEST cast: with this Sentry out you need [3] open to
//    begin casting an X spell at all, because every X below three costs three.
//  - Unqualified subject, so it hits BOTH players, and region-scoped (R12)
//    like every continuous effect.
card('Stasis Sentry', {
  augmentable: true,
  // R268: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    costMods: [{
      delta: (g, _self, ctx) => {
        if (g.s.phase !== 'battle' || ctx.purpose !== 'play') return 0;
        if (ctx.card.kind !== 'spell' && ctx.card.kind !== 'spellUnit') return 0;
        const base = ctx.card.mana === 'X' ? (ctx.x ?? ctx.card.xMin ?? 0) : ctx.card.mana;
        return base <= 3 ? 3 - base : 0;
      },
    }],
  },
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
// spell tokens (⚠ header); the spell's cost is read from the event snapshot
// (R1) — and R157 §1 makes that the X ACTUALLY PAID on an X spell ("paying X
// replaces the letter X on the printed card temporarily"), which the event now
// carries. A Wildfire for X=4 makes both players sacrifice a unit costing 4 or
// less; it used to make them sacrifice a 0-cost unit at most, i.e. a token.
// "Each player" = the region's present seats (R25); each picks their own
// eligible unit (unit cost = printed mana — no X card in the pool is a unit,
// and one that never was cast has no X to read; tokens cost 0),
// plan-then-commit.
card('Death Greeter', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'],
    label: "each player sacrifices a unit with cost ≤ the spell's cost",
    when: (g, self, ev) => g.s.phase === 'battle' && ev.data?.seat === self.controller,
    effect: {
      run: (g, ctx) => {
        const cost = eventCardCost(ctx.event);   // R157 §1: the X paid, on an X spell
        const picks: EntityId[] = [];
        for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
          const pool = g.unitsOf(seat as Seat, ctx.region)
            .filter(u => manaOf(u.card) <= cost);
          const id = pickUnit(ctx, `sac:${seat}`, seat as Seat, pool,
            `Death Greeter: sacrifice a unit with cost ${cost} or less`);
          if (id !== null) picks.push(id);   // (If able.) — empty pool skips the seat
        }
        // R209/CT-74: "if able" can be true of NOBODY — every present seat can
        // be out of units cheap enough, or out of units entirely.
        if (!picks.length) {
          g.ev('info', `Death Greeter: nobody here has a unit costing ${cost} or less to sacrifice.`);
          return;
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
// skipped when the controller cannot pay — and only then. It is offered
// wherever this resolves, the end-of-turn window included: a ctx.choose
// suspension there is answered and E.finishTurnEnd closes the owed turn flip
// afterwards (R85).
card('Tempest Oracle', {
  abilities: [{
    type: 'triggered', events: ['died', 'despawned'], self: true,
    label: 'you may pay [one] to draw a card and lose 1 life',
    effect: {
      run: (g, ctx) => {
        if (g.openMana(ctx.controller) < 1) {
          g.ev('info', 'Tempest Oracle: you cannot pay [one] — no draw.');
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
//
// ⚠ R221 (2026-08-28) — THE OWNER RULED ON THIS CARD AND THE ANSWER WAS
// "TODAY'S SCALING IS RIGHT". It was the only clause the R212 correctness
// sample called wrong (125/127), and BOTH of its failures were on this one
// sentence. He was asked directly whether "for each ally recalled this way"
// scales the sacrifice as well as the life loss. It does. So the `for (r)`
// loop below is DELIBERATE and the sample's amount row was OUR misreading,
// not the card's defect — it has been deleted from KNOWN_WRONG for that
// reason and not because anything was fixed. Do not "correct" it back.
//
// The SAME ruling kept the second half of the ticket alive, and this is the
// subtle part. He was offered "both scale, and X=0 therefore does nothing"
// (which would have closed the ticket outright) and did NOT take it — he took
// "both scale, but still fire the second sentence at X=0". So the sacrifice
// clause is UNCONDITIONAL with scaling on top, not gated on the first
// sentence: it happens at least once, and once more per ally beyond the
// first. `you lose 1 life for each ally recalled` is purely scaled, so at
// X = 0 nobody loses life and everybody still sacrifices. That is
// max(1, recalled.length) rounds, and it is why the early return is gone.
//
// ⚠⚠ AND THIS CARD WAS ALREADY RULED ON, WHICH NOBODY NOTICED FOR THREE DAYS.
// **R157 §17 (2026-08-25) settled the scaling question** — "the card checks how
// many units you recalled and forces each player to sacrifice that many units
// and you lose that much life", marked *Already correct*. CT-91 then filed it
// as a major open bug, `182-correctness-sample` recorded the engine as WRONG on
// it, and `docs/questions-round28.md` Q1 RE-ASKED IT WHILE RECOMMENDING THE
// OPPOSITE ANSWER. Had the owner picked that recommendation he would have
// silently reversed his own ruling of four days earlier, and nothing in the
// repository would have said a word. R221 agrees with R157 §17; the agreement
// is luck, not a check.
//
// ⚠ THE ONE PLACE R157 §17 AND R221 GENUINELY PULL APART, recorded rather than
// smoothed over. Read literally, "sacrifice THAT MANY units" gives ZERO at
// X = 0, which is the early return this change just deleted. But §17 was
// answering "does the for-each distribute?", and was never asked about X = 0;
// R221 was asked exactly that, was shown the "X = 0 therefore does nothing"
// option, and declined it. The later and more specific answer governs, so the
// floor stands — but if the owner ever revisits this, THIS is the seam.
card('Torrential Reclamation', {
  spellEffect: {
    targets: {
      what: 'allyUnit', count: 'X', min: 0,
      prompt: 'Torrential Reclamation: recall X target nontoken allies',
      restrict: unitRestrict((_g, u) => !u.token),
    },
    run: (g, ctx) => {
      const x = ctx.x ?? 0;   // chosen and paid at cast (R35)
      const recalled = ctx.targets.filter(isEntityTarget).map(t => g.entity(t.id)).filter((u): u is Entity => !!u);
      // R221: neither of these is a reason to skip the sacrifice clause any
      // more — it is not gated on the recall. Both still ANNOUNCE, because a
      // player who paid for X = 0, or whose targets all left play, is owed the
      // reason his recall did nothing.
      if (x <= 0) g.ev('info', 'Torrential Reclamation: X = 0 — nothing is recalled.');
      else if (!recalled.length) {
        g.ev('info', 'Torrential Reclamation: every targeted ally has left play — nothing is recalled.');
      }
      // plan the sacrifices: one round per recalled ally, each player picks —
      // and R221 floors it at one round, so the printed "each player
      // sacrifices a unit" happens even when nothing was recalled.
      const rounds = Math.max(1, recalled.length);
      const sacs: EntityId[] = [];
      for (let r = 0; r < rounds; r++) {
        for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
          const pool = g.unitsOf(seat as Seat, ctx.region).filter(u =>
            !sacs.includes(u.id) && !recalled.some(p => p.id === u.id));
          const id = pickUnit(ctx, `sac:${r}:${seat}`, seat as Seat, pool,
            'Torrential Reclamation: sacrifice a unit');
          if (id !== null) sacs.push(id);
        }
      }
      // commit
      // R209/CT-74: the recall and the life loss below announce themselves, so
      // 65-effect-conformance can never see this branch (it convicts only a
      // WHOLLY silent run — CT-81). The sacrifice clause still promised
      // something and still has to say when it delivers nothing.
      if (!sacs.length) {
        g.ev('info', 'Torrential Reclamation: nobody here has a unit to sacrifice.');
      }
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
// item.x here.
//
// R83 — BENA, 2026-08-22, settling what R67 had to leave open: "On cast, you
// target X of YOUR units AND an opponent. Then, when it resolves, you just
// 'distribute' the damage without targeting or going onto the stack or
// anything." So there are TWO kinds of choice here and the card makes both:
//
//  - CAST TIME, declared targets: X allies and one opponent. The opponent
//    used to go undeclared because a `count: 'X'` slot could not be followed
//    by a fixed one; `extraSlots` is that seam, and it puts the opponent at
//    slot 0 (see TargetSpec.extraSlots for why first rather than last).
//    Caleb 2025-11-25 agrees the player is targeted: "Channel Through targets
//    the player, so yes, you're good."
//  - RESOLUTION, not targets: the per-point distribution among that
//    opponent's units. Not declared, not respondable, nothing on the stack —
//    a mid-resolution ctx.choose, which is exactly what it already was.
//
// The 2 distributed damage is planned in 1-point increments but COMMITTED as
// one batch (R80), so two points on one unit are one hit of 2.
card('Channel Through', {
  spellEffect: {
    targets: {
      what: 'allyUnit', count: 'X', extraSlots: 1, min: 1,
      slots: ['opponent'],
      prompt: 'Channel Through: X target allies, and target opponent',
      slotPrompts: ['Channel Through: target opponent (their units take the distributed damage)'],
    },
    run: (g, ctx) => {
      const x = ctx.x ?? 0;   // chosen and paid at cast (R35)
      if (x <= 0) { g.ev('info', 'Channel Through: X = 0 — no effect.'); return; }
      // slot 0 is the opponent; every entity target after it is an ally
      const foe = ctx.targets.find(t => 'player' in (t as object)) as { player: Seat } | undefined;
      const picked = ctx.targets.filter(isEntityTarget).map(t => g.entity(t.id)).filter((u): u is Entity => !!u);
      if (!picked.length) {
        g.ev('info', 'Channel Through: every targeted ally has left play — nothing is damaged.');
        return;
      }
      // plan: per damaged ally, distribute 2 damage among the TARGETED
      // opponent's units (in 1v1 that is the only opponent; it matters at 3+)
      const enemies = () => g.unitsIn(ctx.region)
        .filter(u => (foe ? u.controller === foe.player : u.controller !== ctx.controller));
      const alloc: EntityId[][] = picked.map((_, i) => {
        const out: EntityId[] = [];
        for (let k = 0; k < 2; k++) {
          const id = pickUnit(ctx, `dist:${i}:${k}`, ctx.controller, enemies(),
            `Channel Through: distribute damage (ally ${i + 1}, point ${k + 1} of 2)`);
          if (id !== null) out.push(id);
        }
        return out;
      });
      // commit: 2 to each ally, plus its 2 distributed points — R80, ONE
      // batch, so a unit named by two points is dealt 2 (one trigger, not
      // two) and "how much did this spell deal" is the whole 12
      const hits: { target: Entity; n: number }[] = [];
      picked.forEach((ally, i) => {
        if (!g.entity(ally.id)) return;   // gone before its turn: not "damaged this way"
        hits.push({ target: ally, n: 2 });
        for (const id of alloc[i]!) {
          const u = g.entity(id);
          if (u) hits.push({ target: u, n: 1 });
        }
      });
      g.dealEffectDamageAll(ctx, hits);
    },
  },
});

// "[Augment] Whenever I survive damage, each opponent sacrifices that many
// units." — err/7 7/6 Infernal Rock Elemental Unit. Text-box [Augment].
// "Survive" is checked at event time (R1). R166: it reads the `lethal` fact
// the engine now puts on every 'damage' event aimed at a unit, and NOT
// `u.damage < defense`, which was the whole bug — marked damage is not the
// whole of what kills. A {Deadly} hit BELOW my defense left my marked damage
// under the bar, so the old test said "survived", the payout resolved, and the
// R21 sweep killed me one line later: the card was paid for surviving the one
// kind of hit nothing survives. `lethal` is computed at the damage site, from
// the same expression that decides the kill, so the two cannot disagree; the
// `undefined` arm is the old reading, kept for any future 'damage' event that
// reaches a unit without the fact. "That many" = the event's damage amount
// (snapshot); "each opponent" is region-scoped (R25), each picks their own
// units, plan-then-commit; fewer units than N sacrifices them all (if able).
card('Molten Tormentor', {
  augmentText: [{
    type: 'triggered', events: ['damage'], self: true,
    label: 'each opponent sacrifices that many units (I survived damage)',
    when: (g, self, ev) => {
      const u = g.entity(self.id);
      if (!u) return false;
      const lethal = ev.data?.lethal as boolean | undefined;
      return lethal === undefined ? u.damage < g.effStats(u)[1] : !lethal;
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
// to hosts (via: { mod }) — the Infernal Cultivator precedent. [once] =
// bounded per card (R9). {Virus} play mode is engine-level.
//
// R196 — THE MOD ERASURE IS A REAL COST NOW. The [one] always was; the erasure
// happened at RESOLUTION, so the item reached the stack without saying which
// mod was going and the opponent answered blind. R157 §21: everything before
// the colon is a COST, fixed when the item goes on the stack.
// `castCost: { kind: 'eraseMod' }` is that — "my mods" is `item.sourceId`'s
// mods, which reads correctly for the donated case too (the host is the
// carrier). Still an erase and not a death: no bin, no despawn, no triggers.
// Only the MOMENT moved.
//
// ⚠ IT CHANGES WHEN THE [once] IS SPENT, and deliberately — the same call
// Auric Ascendant records. The "no mod to erase — no effect" branch R113 put
// in the SPENDS family is gone: a cost cannot whiff, so a Slag Spewer with no
// mod is not OFFERED, the [one] is never paid and the use is never spent
// (R49). R57 is unchanged and visible in the collector order: the damage
// target is chosen BEFORE the mod is erased, because a FIXED castCost is
// collected after `collectPartTargets`.
card('Slag Spewer', {
  augmentText: [{
    type: 'activated', cost: { mana: 1 }, bounded: true,   // [once]
    label: '[one], erase one of my mods: I deal 2 damage to any target',
    effect: {
      castCost: { kind: 'eraseMod' },
      targets: { what: 'any', prompt: 'Slag Spewer: deal 2 damage to any target' },
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        // R113: an ACTIVATED [once] with no "you may" in it. The cost is paid;
        // a carrier removed in response does not hand the use back.
        if (!self) { g.ev('info', 'Slag Spewer: the carrier is gone — no damage.'); return; }
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
    // R113 splits what used to be one branch. Declining (or being unable to
    // pay) the rider's cast [cost] is declining the ability, so the use is
    // kept; actually sacrificing a 0-defense unit is USING it and getting
    // nothing, so the use is gone. `costPaid.sacrificed` is the difference:
    // it exists only when a unit really was paid.
    const sacrificed = ctx.costPaid?.sacrificed;
    const bar = sacrificed?.defense ?? 0;
    if (!sacrificed) {
      ctx.refundBudget?.();   // R113: declining a [cost] never spends the use
      g.ev('info', 'Structural Collapse: no unit was sacrificed — nobody sacrifices.');
      return;
    }
    if (bar <= 0) {
      // R113: the cost WAS paid — the use is spent even though the bar is 0.
      g.ev('info', 'Structural Collapse: the sacrificed unit had 0 defense — nobody sacrifices.');
      return;
    }
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
// carrier stays); auto-picked only when there is exactly one, nothing with no
// other unit. "After combat" often lands in the end-of-turn window; the pick
// is still a real question there (R85).
card('Unstable Form', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'sacrifice another unit (after combat)',
    effect: {
      run: (g, ctx) => {
        const pool = g.unitsOf(ctx.controller, ctx.region).filter(u => u.id !== ctx.sourceId);
        if (!pool.length) { g.ev('info', 'Unstable Form: you control no OTHER unit here — nothing is sacrificed.'); return; }
        const id = pickUnit(ctx, 'sac', ctx.controller, pool, 'Unstable Form: sacrifice another unit')!;
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
