/* batch-metal-c — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Cards are scripted here from printed.json data (never
 * hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (fizzle vs partial), R6 (mid-resolution payments via ctx.choose),
 * R9 (bounded budgets per card), R12 (regions exclusive — listeners, statics
 * and "your units" are region-scoped), R115 (created units arrive where their
 * SOURCE is — ctx.region — as spell tokens always did), R31 (triggers
 * fired during combat damage sub-steps resolve immediately).
 *
 * ⚠ ENGINE APPROXIMATIONS in this batch:
 *  - Scavenging Sentry: UN-PARKED (R49). This entry used to read "the DSL has
 *    no sacrifice-another cost slot for activations, so it is paid
 *    mid-resolution … therefore respondable-after-activation".
 *    `AbilityCost.sacrificeOther` is that slot: it gates the activation (no
 *    other unit ⇒ not offered at all) and is paid in the cast window, before
 *    priority. Same unpark as Soul Swallower and Hearthwood Ancient.
 *  - Soul Reaver: UN-PARKED (R64). This said "the DSL cost slot covers only
 *    the mana; X is chosen and the counters are removed at RESOLUTION".
 *    `CastCost { kind: 'removeCounters', from: 'self', n: 'X' }` is the slot —
 *    dsl.ts names this card in its doc comment — and the ability declares it,
 *    so the counters come off as the ability is activated and X is fixed
 *    before anyone can answer it.
 *  - Unstable Refactor: "becomes base 5/0" REWRITES stat layer 2 (E.setBase),
 *    so a second application re-bases instead of stacking and layer-4 Tough
 *    doubles a true base of 0. Counters, temps and statics apply on top.
 *  - Unmake's "base power 2 or less" reads layer 2 (E.baseStatsOf), so a
 *    rewritten base is the base it asks about — Unstable Refactor makes a
 *    target Unmake-proof, Aberrant Statweaver makes a Good Whale Unmakeable.
 *  - Transmogrifant / Synaptic Energizer: "your (other) units" is read
 *    region-scoped (R12, the Flowstone Arcanite precedent).
 *
 * ✔ EXACT, recorded so nobody re-files them as approximations (R174):
 *  - Technological Superiority: counters are modelled as one NET signed int
 *    (Manual: +1/+1 and -1/-1 cancel pairwise). "Duplicate each counter" is a
 *    LINEAR operation, so doubling the net equals doubling each counter for
 *    ANY mix of signs, not merely for a uniform sign. This entry used to be
 *    filed as an approximation hedged with "identical whenever all counters
 *    share a sign"; the hedge was unnecessary — given the net model there is
 *    no case where the two differ.
 *  - Void Memory: "[unit {i1}or spell]" is a MODE (R284), so "if able" is a
 *    real test against the half the CASTER declared. The kind census is what
 *    the two halves are measured against, and it holds: all 492 entries are
 *    `unit` (337), `spell` (138), `spellUnit` (14) or `spellToken` (3), so the
 *    two halves TOGETHER cover the pool and no pool card answers neither. That
 *    licenses "the declared half always has a name for every card in a hand",
 *    and nothing more: a hand of nothing but spells is unable to discard a
 *    unit, and reveals instead. A spellUnit's printed type line reads "… Spell
 *    Unit" and a spellToken's reads "Spell Token", so both answer the 'spell'
 *    half; the spellUnit answers the 'unit' half too. The discarding player
 *    picks WHICH card, among the ones the declared half admits.
 *
 *  - Worldbender is fully LIVE as of playtest report #87, which is where its
 *    numbers come from. It is a STATIC card-step replacement (the new
 *    `CardBehavior.replaceCardStep`, consulted by E.startDraftStep and
 *    E.startConstructedDraw), not a one-shot on-spawn skip: the owner reported
 *    it while he "had it in play", describing what happens every turn.
 *    R162 (R157 §2) closes the last open mode: 'shared' is "not a real thing …
 *    I guess it'd be constructed", so its flat 2-card turn draw IS its card
 *    step (E.startTurn consults the hook) and the card takes the constructed
 *    branch there. No mode declines any more.
 */
import type { EntityId } from '../../types.ts';
import { card, getCard, unitRestrict, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** find an id inside a formation grid → its column and row */
function locateInGrid(grid: EntityId[][], id: EntityId): { col: EntityId[]; i: number } | null {
  for (const col of grid) {
    const i = col.indexOf(id);
    if (i !== -1) return { col, i };
  }
  return null;
}

// ───────────────────────────── the cards ──────────────────────────────

// "[Augment] Whenever another unit dies, put a +1/+1 counter on me." — m/1
// 1/1 Occult Scrap Unit. Text-box [Augment]: live when played normally
// (Manual Q&A), donated when augmenting. "Me" is the host when mod-carried
// (the trigger anchors on the host entity). Any controller's unit counts;
// the listener is region-scoped by the engine (R12). Deaths during combat
// damage sub-steps land the counter immediately (R31).
card('Refuse Reclaimer', {
  augmentText: [{
    type: 'triggered', events: ['died'],
    label: 'put a +1/+1 counter on me (another unit died)',
    when: (_g, self, ev) => ev.data?.unit !== self.id,     // "another unit"
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        // the host can die in the same batch as the "another unit" that fired
        // this — a real outcome, but it must not resolve in silence
        // (65-effect-conformance)
        if (!self) {
          g.ev('info', 'Refuse Reclaimer: its host has left play — no counter is added.');
          return;
        }
        g.addCounters(self, 1);
      },
    },
  }],
});

// "[Augment][once] [one]: Switch my position with another target ally in my
// formation." — m/2 4/2 Cosmic Strider {Virus} Unit. Text-box [Augment]
// activated ability ([once] = bounded, R9), live when played normally, and a
// battle-playable Virus augment. "My formation" = the grid my side declared
// (attacking columns or blocking columns); the swap mutates the formation
// arrays directly (the Tiderunner Initiate precedent). Both units must be in
// the same grid at resolution, else no switch.
card('Riftwalker', {
  augmentText: [{
    type: 'activated', cost: { mana: 1 }, bounded: true,
    label: 'switch my position with another target ally in my formation',
    effect: {
      // R64: "ANOTHER target ally IN MY FORMATION" — both clauses gate the
      // menu now; the resolution code re-checks the formation, which can
      // change under the ability (R56).
      targets: {
        what: 'allyUnit', prompt: 'Riftwalker: switch my position with another target ally in my formation',
        restrict: unitRestrict((g, u, ctx) => {
          const me = ctx.sourceId;
          if (me === undefined || u.id === me) return false;
          const b = g.s.battle;
          if (!b) return false;
          // "in my formation": some grid holds us both (the run's own test)
          return [b.columns, Object.values(b.blocks)]
            .some(grid => !!locateInGrid(grid, me) && !!locateInGrid(grid, u.id));
        }),
      },
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        const t = ctx.targets[0];
        const b = g.s.battle;
        if (!self || !b || !isEnt(t) || !g.entity(t.id) || t.id === self.id) return;
        for (const grid of [b.columns, Object.values(b.blocks)]) {
          const a = locateInGrid(grid, self.id);
          const c = locateInGrid(grid, t.id);
          if (a && c) {
            a.col[a.i] = t.id;
            c.col[c.i] = self.id;
            g.ev('info', `${self.card} switches positions with ${t.card}.`);
            return;
          }
        }
        g.ev('info', `Riftwalker: ${t.card} is not in my formation — no switch.`);
      },
    },
  }],
});

// "[Augment] Sacrifice another unit: Put a +1/+1 counter on me." — mm/2 2/2
// Occult Scrap Unit. Text-box [Augment] activated ability (unbounded), live
// when played normally. (The "⚠ the sacrifice cost is paid mid-resolution …
// declining (or having none) yields no counter" note that used to sit here was
// left behind by the R49 unpark the header records, and by the `cost:
// { sacrificeOther: 1 }` four lines below it: the cost gates the OFFER and is
// paid in the cast window.)
card('Scavenging Sentry', {
  augmentText: [{
    // R49 UN-PARKED: a real activation cost. It gates the activation — with no
    // other unit the ability is not offered at all, rather than activated and
    // then fizzling — and it is paid in the cast window, so nobody responds
    // between the sacrifice and the counter.
    type: 'activated', cost: { sacrificeOther: 1 },
    label: 'sacrifice another unit: put a +1/+1 counter on me',
    effect: {
      run: (g, ctx) => {
        // re-read the carrier: the paid sacrifice can chain (a death trigger
        // may have taken the Sentry with it)
        const me = selfOf(g, ctx);
        if (!me) { g.ev('info', 'Scavenging Sentry: the carrier is gone — no counter.'); return; }
        g.addCounters(me, 1);
      },
    },
  }],
});

// "[Switch] Move all counters from target unit onto another target unit." —
// m/2 {Battle} Scrap Spell. Two distinct targets collected at cast (count: 2);
// the whole move needs both alive (allOrNothing — R5 fizzle). The NET counter
// count moves (negative nets move too); death checks run after the transfer
// (the source may die if it was living on its counters).
const scrapForParts: EffectDef = {
  targets: { what: 'unit', prompt: 'Scrap For Parts: move all counters from the FIRST target onto the SECOND', count: 2, min: 2 },
  allOrNothing: true,
  run: (g, ctx) => {
    const [from, to] = ctx.targets;
    if (!isEnt(from) || !isEnt(to) || !g.entity(from.id) || !g.entity(to.id) || from.id === to.id) {
      g.ev('info', 'Scrap For Parts: it needs two different live units — nothing moves.');
      return;
    }
    const n = from.counters;
    if (!n) { g.ev('info', `Scrap For Parts: ${from.card} has no counters to move.`); return; }
    from.counters = 0;
    g.ev('info', `Scrap For Parts moves ${Math.abs(n)} ${n > 0 ? '+1/+1' : '-1/-1'} counter(s) from ${from.card} to ${to.card}.`);
    g.addCounters(to, n);                          // fires countersChanged + death check
    g.checkDeaths();                               // the stripped source may die too
  },
};
card('Scrap For Parts', {
  spellEffect: scrapForParts,
  graftEffect: { bounded: false, effect: scrapForParts },
});

// "[Switch1] Create a Robot X, where X is your [m]." — m/2 Scrap Technology
// Spell. X = metal affinity at RESOLUTION (R1; expended resources count,
// R17). A created unit is a token and arrives where its SOURCE is —
// ctx.region (R115); the Robot spawns with X +1/+1 counters (the Robot card is a
// 0/0 that lives on its counters). X = 0 → nothing is created (a 0/0 would
// die instantly).
const selfAssemble: EffectDef = {
  creates: ['Robot'],
  run: (g, ctx) => {
    const x = g.affinity(ctx.controller, 'metal');
    if (x <= 0) { g.ev('info', 'Self-Assembly: no metal affinity — no Robot.'); return; }
    g.spawnUnit(ctx.controller, 'Robot', ctx.region, { token: true, counters: x });
  },
};
card('Self-Assembly', {
  spellEffect: selfAssemble,
  graftEffect: { bounded: true, effect: selfAssemble },
  // UI preview (#5): the Robot's size if it resolved right now
  xPreview: (g, seat) => g.affinity(seat, 'metal'),
});

// "[Augment] [one], Remove X +1/+1 counters from me: I deal X damage to
// target unit." — mm/3 2/3 Demon Technology {Virus} Unit. Text-box [Augment]
// activated ability (unbounded), live when played normally. R64: "Remove X
// +1/+1 counters from me" sits before the colon — it is part of the COST, so
// it is paid as the ability is activated and X is fixed there, not chosen at
// resolution after the opponent has already decided how to answer it.
card('Soul Reaver', {
  augmentText: [{
    type: 'activated', cost: { mana: 1 },
    label: 'remove X +1/+1 counters from me: I deal X damage to target unit',
    effect: {
      castCost: { kind: 'removeCounters', from: 'self', n: 'X', xMin: 1 },
      targets: { what: 'unit', prompt: 'Soul Reaver: I deal X damage to target unit (X = +1/+1 counters removed)' },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!isEnt(t)) return;
        const live = g.entity(t.id);
        const x = ctx.x ?? 0;
        if (live && x > 0) g.dealEffectDamage(ctx, live, x);
      },
    },
  }],
});

// "Target unit loses all attributes and abilities until regroup. Erase all
// of its mods and negate all of its effects." — m/1 {Battle} Technology
// Spell. All three clauses are live now that R62 exists: both layers are
// switched off until regroup (which also silences everything its mods were
// donating, and strips what it was sharing into its column), every mod on it
// is ERASED (no bin), and every stack effect whose source is the target is
// negated.
card('Suppression Field', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Suppression Field: target unit loses everything' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) return;
      // R62: both layers off until regroup — this is the whole first sentence
      g.suppress(t, 'Suppression Field', { attrs: true, abilities: true });
      if (!g.entity(t.id)) return;                 // suppression can be lethal
      if (t.mods.length) {
        // R208 / CT-86: through `E.eraseMod`. This site is why the ticket's
        // `mods.splice` grep undercounted — it cleared `t.mods = []` instead
        // of splicing, so it looked like a different operation while doing
        // exactly the same thing to real, NONTOKEN mod cards. ⚠ The 'info'
        // line is unchanged: it says "ERASES" in its own words and files
        // nothing on the R65 public pile, which is round-27's Q3 and is
        // UNANSWERED. The count is taken BEFORE the loop, because eraseMod
        // splices `t.mods` as it goes — the old code read it afterwards and
        // only got away with it because the delete left the id list alone.
        const n = t.mods.length;
        for (const m of t.mods.map(id => g.entity(id))) if (m) g.eraseMod(m);
        g.ev('info', `Suppression Field ERASES ${n} mod(s) on ${t.card}.`);
        t.mods = [];
      }
      for (const item of [...g.s.stack]) {   // R68: negate() splices
        if (item.sourceId === t.id) g.negate(item.id);
      }
      g.checkDeaths();                             // mod statics may have kept it alive
    },
  },
});

// "After combat, [Switch1] Put a +1/+1 counter on each of your units." —
// mm/2 0/1 Scrap Construct Unit. Bounded graft cause (R9: once per turn —
// the round-2 afterCombat finds the budget spent). "Your units" is
// region-scoped (R12, Flowstone precedent): the units with you in the battle.
const energize: EffectDef = {
  run: (g, ctx) => {
    for (const u of g.unitsOf(ctx.controller, ctx.region)) g.addCounters(u, 1);
  },
};
card('Synaptic Energizer', {
  abilities: [{
    type: 'triggered', events: ['afterCombat'], bounded: true, graftCause: true,
    label: 'put a +1/+1 counter on each of your units',
    effect: energize,
  }],
  graftEffect: { bounded: true, effect: energize },
});

// "[Switch1] Duplicate each counter on target unit." — m/2 {Battle}
// Technology Spell. ✔ EXACT (header): counters are one net signed int, and
// duplication is linear, so the net doubles — negatives included — for any mix
// of signs. No counters → nothing happens.
const duplicateCounters: EffectDef = {
  targets: { what: 'unit', prompt: 'Technological Superiority: duplicate each counter on target unit' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t) || !g.entity(t.id)) {
      g.ev('info', 'Technological Superiority: the target is gone — nothing is duplicated.');
      return;
    }
    if (!t.counters) {
      g.ev('info', `Technological Superiority: ${t.card} carries no counters — nothing to duplicate.`);
      return;
    }
    g.addCounters(t, t.counters);
  },
};
card('Technological Superiority', {
  spellEffect: duplicateCounters,
  graftEffect: { bounded: true, effect: duplicateCounters },
});

// "[Augment] Your other units gain +2/+2 and lose all attributes and
// abilities." — mm/4 4/3 Alien {Virus} Unit. The +2/+2 half is a static:
// live as a unit in play AND augment-donated (mod-carried statics anchor on
// the host, so "your OTHER units" reads from the host's perspective). ⚠
// region-scoped (R12, header). The "lose all attributes and abilities" half is
// LIVE — it is the same static's `suppressAttrs` / `suppressAbilities` flags,
// eleven lines below. (This note used to say that half was "PARKED (header: no
// suppression machinery)"; R62 shipped the machinery and the note was left
// behind.) `augmentable` keeps the Virus/augment play modes open despite no
// augmentAttrs/augmentText.
card('Transmogrifant', {
  augmentable: true,
  // R268: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    statics: [{
      affects: (_g, self, t) => t.kind === 'unit' && t.controller === self.controller && t.id !== self.id,
      dp: 2, dt: 2,
      // R62: the other half of the same sentence — "and lose all attributes and
      // abilities". Continuous, so it lives and dies with the projector: erase
      // the Transmogrifant (or the host it augments) and your units get
      // everything back in the same instant.
      suppressAttrs: true, suppressAbilities: true,
    }],
  },
});

// "[Augment] {Unaware} Scrap Robot {Virus} Unit" — m/2 2/2. Type-line
// [Augment]: augmenting grants {Unaware} via printed.augmentAttrs, and Virus
// lets it augment from hand during battle — all engine-level, no card-side
// behavior. That plumbing now HAS an outcome: R106 shipped stat layer 6, so
// donating {Unaware} onto a host drops the host to its PRINTED stats for as
// long as the mod is on it (a pumped 5/5 fights as its printed 3/3), which
// makes this a debuff virus rather than a blank. (The old note ended "no behavior",
// true of the card file and false of the game.)
card('Trashling', {});

// "Delete target unit with base power 2 or less." — m/2 {Battle} Occult
// Technology Spell. BASE power = printed/token stats only (layer 1 — no
// counters, temps or statics); the gate is enforced at resolution (an
// over-power pick is a no-op). Delete = destroy without combat (engine verb;
// nontoken unmodded → owner's bin).
card('Unmake', {
  spellEffect: {
    // R64: "with base power 2 or less" is part of what makes a target LEGAL.
    // It used to offer the whole board and then refuse most of it at
    // resolution. The resolution check stays — base power can change between
    // cast and resolution, and R5/R56 govern that, not the candidate list.
    targets: {
      what: 'unit', prompt: 'Unmake: delete target unit with base power 2 or less',
      // E.baseStatsOf is layers 1-2, so a REWRITTEN base (Formless, Body
      // Swap, Aberrant Statweaver) is the base this asks about; counters and
      // until-regroup deltas (layer 3) are deliberately not counted.
      restrict: unitRestrict((g, u) => g.baseStatsOf(u)[0] <= 2),
    },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) return;
      const [bp] = g.baseStatsOf(t);
      if (bp <= 2) g.destroy(t, 'is deleted');
      else g.ev('info', `Unmake: ${t.card} has base power ${bp} (> 2) — not deleted.`);
    },
  },
});

// "Target unit becomes base 5/0 until regroup." — m/2 {Battle} Cosmic
// Technology Spell. A layer-2 REWRITE (E.setBase), not a delta: whatever the
// target's base was, it is 5/0 now, and a second base-setter replaces this
// rather than compounding with it. Counters/temps/statics still apply on top,
// so a counterless target is a 5/0 and dies at the death check unless
// something props its defense up.
card('Unstable Refactor', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Unstable Refactor: target unit becomes base 5/0 until regroup' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) return;
      g.setBase(t, 5, 0);   // E.setBase runs the death check itself
    },
  },
});

// "When I die, [Switch1] Delete target unit." — m/3 0/1 Cosmic Anima Unit.
// Bounded graft cause (R9). A combat death fires the trigger immediately
// between damage sub-steps (R31) — the delete lands before the next
// sub-step; outside battle it resolves as a special action.
const singularityDelete: EffectDef = {
  targets: { what: 'unit', prompt: 'Unstable Singularity: delete target unit' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (isEnt(t) && g.entity(t.id)) g.destroy(t, 'is deleted');
  },
};
card('Unstable Singularity', {
  abilities: [{
    type: 'triggered', events: ['died'], self: true, bounded: true, graftCause: true,
    label: 'delete target unit',
    effect: singularityDelete,
  }],
  graftEffect: { bounded: true, effect: singularityDelete },
});

// "[Switch1] Each opponent discards a /[unit {i1}or spell] if able.
// Otherwise, they reveal their hand." — m/2 {Battle} Technology Spell.
//
// R284 — THE BRACKET IS A MODE, AND THE CASTER DECLARES IT. This card used to
// read the bracket as no choice at all ("every pool card is a unit or a spell,
// so 'if able' = a nonempty hand") and hand the discarding player a menu of
// their WHOLE hand. Both halves were wrong, and together they made the card
// strictly worse than printed for its caster and strictly better for its
// victims: the one player the printed bracket does NOT belong to was the one
// picking the half, and they picked it knowing their own hand.
//
// R157 §21 is the general rule — *"All text on cards that's in [square
// brackets] like that is either an additional cost or a modal choice"* — and
// R284 adds the half it did not spell out: the OWNER of the effect pays the
// cost or picks the half, at CAST, no exceptions. The caster is guessing which
// type is more likely to hit, and that guess is the card.
//
// So: the caster declares 'unit' or 'spell' in the cast window (R57); each
// opponent then discards a card OF THAT TYPE if able — their own pick among
// the cards that qualify, → their bin, and R40 TRASHES it, attributed to them
// as the bin's owner. "Otherwise" is now a real branch that a nonempty hand
// can reach: no card of the declared type (an empty hand included) reveals it.
//
// ✔ EXACT: a {Spell Unit} qualifies as BOTH halves, and the printed type line
// is why — it reads "…Spell Unit" (Borrower of Forms, Jelly, 15 more), so a
// player told to discard a unit and a player told to discard a spell are each
// looking at a card that says it is one. The permissive reading, per the
// standing steer. `printed.json`'s `kind` is the same four values the header
// note above audits, and a spellToken's type line still reads "Spell Token".
const isUnitCard = (name: string): boolean => {
  const k = getCard(name).kind;
  return k === 'unit' || k === 'spellUnit';
};
const isSpellCard = (name: string): boolean => {
  const k = getCard(name).kind;
  return k === 'spell' || k === 'spellUnit' || k === 'spellToken';
};
const voidMemory: EffectDef = {
  modes: {
    key: 'mode',
    prompt: () => 'Void Memory: does each opponent discard a unit or a spell?',
    // Always BOTH, never auto-picked: the caster cannot see the hands they are
    // aiming at, so neither half is ever the obviously-empty one the way
    // Siphon Life's X = 0 is. Same call Retribution Thing makes.
    options: () => [
      { label: 'A unit', value: 'unit', half: 0 },
      { label: 'A spell', value: 'spell', half: 1 },
    ],
  },
  run: (g, ctx) => {
    const want = ctx.mode === 'spell' ? 'spell' : 'unit';
    const qualifies = want === 'spell' ? isSpellCard : isUnitCard;
    // R25: "each opponent" reads the effect region's PRESENT seats, like every
    // other "each opponent" in the pool (Thoughtripper) — grafted onto a
    // deployment-firing cause it reaches nobody who is not there.
    const present = g.seatsHere(ctx.region);
    // R187/CT-70: the comment above described this case and the code then said
    // nothing when it happened. It happens whenever the region holds only the
    // caster — a home region out of battle.
    if (!present.some(s => s !== ctx.controller)) {
      g.ev('info', 'Void Memory: no opponent is present here — nobody discards or reveals.');
      return;
    }
    for (const p of present.map(s => g.player(s))) {
      if (p.seat === ctx.controller) continue;
      // the indices of the cards that ANSWER the declared half — the menu, and
      // the "if able" test, are the same list (R284).
      const able = p.hand.map((name, i) => ({ name, i })).filter(c => qualifies(c.name));
      if (!able.length) {
        g.ev('info', p.hand.length
          ? `Void Memory: ${g.pname(p.seat)} has no ${want} in hand — revealed.`
          : `Void Memory: ${g.pname(p.seat)}'s hand is empty — revealed.`);
        g.revealHandTo(ctx.controller, p.seat);
        continue;
      }
      // one candidate is not a question — the same call Linked Extinction's
      // "each opponent sacrifices a unit" makes one card over.
      const idx = able.length === 1 ? able[0]!.i : (() => {
        const pick = ctx.choose(`vmDiscard:${p.seat}`, {
          kind: 'payOrDecline', seat: p.seat,
          prompt: `Void Memory: discard a ${want}`,
          options: able.map(c => ({ label: c.name, value: c.i, card: c.name })),
        }) as number;
        return able.some(c => c.i === pick) ? pick : able[0]!.i;
      })();
      // R40: a discard from hand is a TRASH, by the hand's owner (the bin the
      // card enters is theirs) — never by Void Memory's caster.
      g.discardFromHand(p.seat, idx);
    }
  },
};
card('Void Memory', {
  spellEffect: voidMemory,
  graftEffect: { bounded: true, effect: voidMemory },
});

// "Skip your draft step. When you do, draw a card. You also lose 3 life if
// playing a constructed format." — mm/2 2/2 {Feeble} Cosmic Robot Unit.
//
// It REPLACES the turn's card step while it is in play — it does not skip a
// step and then draw on top of everything else. Owner, playtest report #87
// (room XVUR, 2026-08-23), verbatim:
//
//   "The way it works in live draft: instead of looking at the pack, you draw
//    2 for turn + 1 for Worldbender. No life loss.
//    The way it works in constructed and cube: instead of drawing 4 and
//    recycling 2, you draw 2 for turn + 1 for Worldbender and lose 3 life."
//
// So the two branches are not the same arithmetic written twice. Draft already
// pays the flat 2 for the turn in startTurn, so the card owes ONE card there;
// constructed has no separate turn draw at all — its draw phase IS the turn's
// cards — so the card owes all THREE, and the 3 life with them. Both branches
// end the step: no pack is looked at, and nothing is put back on the bottom.
//
// A skipped seat's pack is untouched and passes on as received, and their hand
// never mixes with it, so `seenHand` stays valid — the one thing not drafting
// preserves.
//
// "Cube" has no mode in this engine (GameMode is 'shared' | 'draft' |
// 'constructed'); the owner groups it with constructed, so it falls into this
// branch the day the mode exists.
//
// R162 (R157 §2) closes the mode that report #87 left open. Owner, verbatim:
//
//   "Shared mode isn't a real thing. You invented it for testing. So I guess
//    it'd be constructed?"
//
// So 'shared' takes the CONSTRUCTED branch, and the arithmetic lands on the
// same place: shared has no draft step and no draw phase, so the flat 2-card
// turn draw is the whole of its card step, `E.startTurn` consults the hook
// INSTEAD of making that draw, and the card owes all three cards plus the 3
// life — exactly the constructed line. Before this the hook was never
// consulted in shared at all, which is why changing only the card would have
// changed nothing: a 2-mana 2/2 {Feeble} was a blank in the DEFAULT mode.
card('Worldbender', {
  replaceCardStep: (g, _self, seat) => {
    if (g.s.mode === 'draft') {
      g.ev('draft', `Worldbender: ${g.pname(seat)} does not look at their pack — they draw a card instead.`, { seat });
      g.draw(seat, 1);
      return true;
    }
    // 'constructed' and — R162 — 'shared': the turn's cards come entirely out
    // of here, so there is no fall-through branch left and no mode that
    // silently declines.
    // R191: 'info', not 'draw'. This line ANNOUNCES a draw that is about to
    // happen three lines down; it is not itself one. Typed 'draw' it was a
    // draw event in the stream with no `n`, so anything reading the stream for
    // "how many cards did this player draw" — the log, a replay, any future
    // consumer of the event type — saw a draw that moved nothing. The real
    // draw below emits the real 'draw' event, with its count.
    g.ev('info', `Worldbender: ${g.pname(seat)} skips the draw phase — 2 cards for the turn plus 1 for Worldbender, and 3 life.`, { seat });
    // drawn BEFORE the life is paid: 3 life can be lethal, and loseLife ends
    // the game where it lands, so the cards the player is owed are already in
    // hand when it does
    g.draw(seat, 3);
    g.loseLife(seat, 3, 'Worldbender');
    return true;
  },
});
