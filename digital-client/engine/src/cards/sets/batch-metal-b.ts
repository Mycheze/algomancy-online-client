/* batch-metal-b — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Cards are scripted here from printed.json data (never
 * hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (fizzle vs partial), R9 (bounded budgets per card), R12 (regions are
 * exclusive — listeners and "each …" clauses are region-scoped), R25 ("each
 * opponent" region-scoped), R115 (created UNITS arrive where their SOURCE is
 * — ctx.region; "in my formation" additionally names a slot),
 * R31 (triggers between combat damage sub-steps resolve immediately).
 *
 * GLIMPSE (Foretell) is REAL as of Light & Dark: E.glimpse (R45) reveals the
 * top card, CACHES it, and makes it playable until end of turn ignoring
 * affinity (mana and timing still apply). It replaced an approximation that
 * put the card straight into the glimpser's hand, permanently.
 *
 * ⚠ ENGINE APPROXIMATIONS in this batch:
 *  - Flux Resonator: a REAL replacement as of R104 — an `AmountMod` consulted
 *    by E.addCounters before it commits, so one placement produces one
 *    countersChanged carrying the right number. It never reaches the stack.
 *    NO approximation survives (R130): "by an allied source" is the printed
 *    clause now that `addCounters` carries `by` (→ `AmountCtx.sourceSeat`),
 *    the recipient may be any unit, and the sign filter is gone ("all counters
 *    count as counters"). Spawn-with-X counters (Robot X) still get the bonus
 *    through the amount layer (report #88) and still fire no countersChanged.
 *  - Formless: "becomes a base 4/4" REWRITES layer 2 (E.setBase), and the
 *    "loses all attributes until regroup" half is R62's until-regroup
 *    suppression — both cleared at regroup.
 *  - Instrument of Reassignment: the "[x], Sacrifice another nontoken unit"
 *    COSTS are paid at RESOLUTION (the DSL's activated-cost shape has no X
 *    and no sacrifice-another; Frosted Denial precedent for X-at-resolution).
 *    The sacrifice may be any of your nontoken units, not region-limited.
 *  - Invasive Reassignment: the swap freezes the target's EFFECTIVE stats at
 *    resolution as a temp delta (later stat changes shift both sides).
 *    Its printed {Reaping} is NO LONGER hand-rolled here. R184 moved the
 *    attribute out of `dealEffectDamageAll` (where a stat swap, dealing no
 *    damage, could never reach it) onto the engine's kill diff at the
 *    resolving-part boundary — the same diff {Afflicting} has ridden since
 *    R48. The card just swaps stats; the draw is the printed attribute.
 *  - Powerforge Synergist: NO LONGER an approximation. This entry used to read
 *    '"I spawn with two +1/+1 counters" has no DSL hook … the counters are
 *    added synchronously in a bookkeeping when() at spawn-event time'. R165
 *    built the hook — `CardBehavior.spawnsWithCounters`, applied by
 *    E.spawnUnit before the 'spawned' event and THROUGH R104's amount layer,
 *    which the raw `self.counters += 2` bypassed (an allied Flux Resonator gave
 *    this card 2 where it gave "Create a Robot 2" 3). Still silent — no
 *    countersChanged event, matching Robot's spawn-with-counters (R130).
 *    "Move my counters" needs NO snapshot of its
 *    own: R70 stamps `counters` onto every leave-play event (E.leftPlayFacts),
 *    which is the same fact the note two paragraphs down credits for
 *    un-parking Flux Constructor — the effect reads ctx.event.data.counters.
 *    "My counters" is the SIGNED net (Flux Constructor's and Scrap For Parts'
 *    reading): a host on a net -3 has counters to move, and moving them keeps
 *    their sign. The old "positive counters only" gate was not printed.
 *  - Perish / Linked Extinction: sacrifice choices are made seat by seat
 *    (caster first) and committed immediately — deterministic under the
 *    engine's rollback-and-replay choice model. Perish and the opponents'
 *    half of Linked Extinction are region-scoped (R12/R25); the caster's
 *    own Linked Extinction cost may come from any of their units.
 *
 * (Nothing in this batch is parked any more. Flux Constructor used to be, on
 * a "died-event counter snapshot" — but destroy() stamps `counters` onto the
 * event for exactly this reason, and has since Entropic Entity needed it, so
 * the note outlived the problem. It is implemented; see the card.)
 */
import type { Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** create a Robot X — a 0/0 Robot token with X +1/+1 counters — in `region`.
 * R115: `region` is REQUIRED and is always the SOURCE's region (`ctx.region`);
 * the old `?? homeRegion` default silently answered for cards that never asked. */
const makeRobot = (g: E, seat: Seat, x: number, region: number): Entity =>
  g.spawnUnit(seat, 'Robot', region, { token: true, counters: x });

// ───────────────────────────── the cards ──────────────────────────────

// "[Augment] Whenever one of your units with one or more counters on it dies,
// you may put those counters onto another target unit." — m/3 3/3 Alien Robot
// Unit. Text-box [Augment]: live when played normally, donated on augment (so
// "your" is then the HOST's controller).
//
// This was parked on a "died-event counter snapshot" that already exists:
// destroy() stamps `counters` onto the event precisely BECAUSE the entity is
// out of s.entities by the time 'died' fires (it was added for Entropic
// Entity). "One or more counters on it" is a nonzero net, the Entropic Entity
// reading — the engine keeps ONE signed total, so a unit that died holding
// two -1/-1 counters is a unit with counters on it, and moving them keeps
// their sign: you move what was actually there, drawback and all.
//
// R67: "another target unit" is a DECLARED target, chosen as the trigger goes
// on the stack; `min: 0` carries the printed "you may". "Another" needs no
// restriction — the unit that died is already gone, so it cannot be offered.
card('Flux Constructor', {
  augmentText: [{
    type: 'triggered', events: ['died'],
    label: "put a dead ally's counters onto another target unit",
    when: (_g, self, ev) => ev.data?.['seat'] === self.controller
      && ((ev.data?.['counters'] as number | undefined) ?? 0) !== 0,
    effect: {
      targets: {
        what: 'unit', min: 0,
        prompt: 'Flux Constructor: put those counters onto another target unit',
      },
      run: (g, ctx) => {
        const n = (ctx.event?.data?.['counters'] as number | undefined) ?? 0;
        const t = ctx.targets[0];
        // R166: `min: 0` — declining is the ordinary answer, and test/65 is
        // right that it has to be said out loud rather than returned in silence.
        if (!n || !isEnt(t)) {
          g.ev('info', 'Flux Constructor: no unit was chosen — the counters go nowhere.');
          return;
        }
        const u = g.entity(t.id);
        if (!u) {
          g.ev('info', 'Flux Constructor: the chosen unit is gone — the counters go nowhere.');
          return;
        }
        g.addCounters(u, n);
      },
    },
  }],
});

// "[Augment] If one or more counters would be put on a unit by an allied
// source, put that many counters plus one instead." — mm/2 2/2 Technology
// Construct Unit.
//
// UNPARKED as a real replacement (R104). It used to be a post-hoc trigger on
// 'countersChanged' that reached into `u.counters` directly to dodge its own
// re-entrancy — so the printed counters landed first, a `countersChanged` fired
// for the wrong number, and the extra one arrived silently afterwards. An
// `AmountMod` is CONSULTED instead, before the commit: one placement, one
// event, the right number on it.
//
// SUMMED, so two Resonators put two more (Caleb: "a replacement only happens
// once … The replacement just takes what would be 1 and makes it 2" — two
// different modifiers both apply), and neither applies to its own contribution
// because a query cannot re-enter the thing it is answering about.
//
// R130 TOOK BOTH APPROXIMATIONS OFF. They were one line each and both said
// something the card does not print:
//
//  - "BY AN ALLIED SOURCE" used to be read as "onto an allied unit", because
//    `addCounters` had no source. It has one now (`by`, defaulted to the
//    resolving effect's controller), and the amount layer already had the
//    field to carry it — `AmountCtx.sourceSeat`, which Conduit of Pain's
//    identical clause has read on the damage path since R104. So the clause is
//    the printed one: I care WHO is placing, not WHOM onto. The recipient is
//    "a unit" — ANY unit — so counters you put on an ENEMY are plus one too,
//    which is the half the old reading refused outright.
//  - "POSITIVE COUNTERS ONLY" was a sign filter on a card that prints no sign.
//    The owner, 2026-08-24: "All counters count as counters." "That many
//    counters plus one" is one more of the same thing, so a -1/-1 becomes two
//    — the `step` idiom Proliferating Slime (the same clause from the other
//    side) has always used. It cuts both ways, and that is the point: your own
//    -1/-1s deepen too. Nothing prints that it only helps.
//
// An UNKNOWN actor (`sourceSeat === undefined`: an engine sweep, a white-box
// call) is not an allied one. The clause asks a question, and no answer is not
// a yes.
card('Flux Resonator', {
  augmentable: true,
  amountMods: [{
    delta: (_g, self, ctx) =>
      (ctx.kind === 'counters' && ctx.sourceSeat === self.controller
        ? (ctx.amount > 0 ? 1 : -1)
        : 0),
  }],
});

// "[Switch1] Glimpse 1 (Reveal the top card of the deck and cache it. Until
// end of turn, you may play it as if it was in your hand, ignoring
// affinity.)" — m/1 {Battle} Cosmic Spell. The reminder text IS R45 verbatim,
// and E.glimpse does exactly that. Bounded graft ([Switch1]).
const foretellGlimpse: EffectDef = {
  run: (g, ctx) => { g.glimpse(ctx.controller, 1); },
};
card('Foretell', {
  spellEffect: foretellGlimpse,
  graftEffect: { bounded: true, effect: foretellGlimpse },
});

// "When I attack or block, [Switch] Target unit becomes a base 4/4 and loses
// all attributes until regroup. (This removes attributes from its column.)"
// — mm/3 2/2 {Flying} Cloud Avatar Unit. The base-4/4 half REWRITES layer 2
// (E.setBase): "becomes a base 4/4" replaces the base, so it does not compound
// with a base already rewritten by Body Swap — doing it with addTemp is how a
// swapped Bloated Manablub came out a 6/9 instead of a 4/4 (playtest
// 2026-08-20). The attribute-loss half is live too (R62), and the printed
// reminder is the reason it has to be a real layer rather than a subtraction:
// switching the target's attribute layer off removes what it was SHARING into
// its column, which E.colAttrs gets for free by unioning ownAttrs.
// Unbounded graft cause ([Switch]).
const formlessReshape: EffectDef = {
  targets: { what: 'unit', prompt: 'Formless: target unit becomes a base 4/4 until regroup' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t) || !g.entity(t.id)) return;
    g.setBase(t, 4, 4);
    g.suppress(t, 'Formless', { attrs: true });   // R62 — abilities are untouched
    g.checkDeaths();
  },
};
card('Formless', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true, graftCause: true,
    label: 'target unit becomes a base 4/4 until regroup',
    effect: formlessReshape,
  }],
  graftEffect: { bounded: false, effect: formlessReshape },
});

// "[Augment] When I attack or block, create a Robot 2 in my formation." —
// mm/3 1/2 Hooba Robot Unit. Text-box [Augment]; live when played normally
// (Manual Q&A). "In my formation" names a SLOT on top of R115's region: the Robot
// spawns in the battle region and its CONTROLLER chooses the slot at
// resolution (R75, E.placeInFormation). This used to auto-pick — "my column if
// open, else the first open column" — which was one of five different
// house rules for the same printed words.
card('Hooba-Bot', {
  augmentText: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    label: 'create a Robot 2 in my formation',
    effect: {
      creates: ['Robot'],
      run: (g, ctx) => {
        const robot = makeRobot(g, ctx.controller, 2, ctx.region);
        g.placeInFormation(robot, ctx, { key: 'hoobaBotSlot', source: 'Hooba-Bot' });
      },
    },
  }],
});

// "[Augment] [x], Sacrifice another nontoken unit: Create a Robot X. X can't
// be 0." — mm/2 3/1 Spirit Construct Unit. An ACTIVATED ability in the
// [Augment] text box: live when played normally (via: 'augment') and donated
// to hosts (via: { mod }). ⚠ header approximation: both costs are paid at
// RESOLUTION — X is chosen (1..open mana) and paid there, and the sacrifice
// is any of your nontoken units other than the carrier. No mana or no victim
// → no effect. The Robot arrives at the carrier's region (R115).
card('Instrument of Reassignment', {
  augmentText: [{
    type: 'activated', cost: {},   // [x] + the sacrifice, paid at resolution
    label: '[x], sacrifice another nontoken unit: create a Robot X',
    effect: {
      creates: ['Robot'],
      run: (g, ctx) => {
        const open = g.openMana(ctx.controller);
        if (open < 1) { g.ev('info', "Instrument of Reassignment: X can't be 0 and no mana is open — no effect."); return; }
        const victims = g.unitsOf(ctx.controller).filter(u => !u.token && u.id !== ctx.sourceId);
        if (!victims.length) { g.ev('info', 'Instrument of Reassignment: no other nontoken unit to sacrifice — no effect.'); return; }
        const xOpts: { label: string; value: unknown }[] = [];
        for (let x = 1; x <= open; x++) xOpts.push({ label: `X = ${x}`, value: x });
        const x = ctx.choose('iorX', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Instrument of Reassignment: choose X (paid now — engine approximation)',
          options: xOpts,
        }) as number;
        const sacId = ctx.choose('iorSac', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Instrument of Reassignment: sacrifice another nontoken unit',
          options: victims.map(u => ({ label: u.card, value: u.id, card: u.card })),
        }) as EntityId;
        const victim = g.entity(sacId);
        if (!victim) return;
        g.payMana(ctx.controller, x);
        g.destroy(victim, 'is sacrificed');
        makeRobot(g, ctx.controller, x, ctx.region);
      },
    },
  }],
});

// "Target opponent negates an effect they control." — mm/2 {Battle} AI Cosmic
// Spell. Target is a player, and not you — the 'opponent' kind, so no unit is
// ever offered. THE OPPONENT chooses which of their stack items to
// negate (any un-negated effect they control); exactly one → automatic;
// none → nothing happens.
card('Interdiction Rift', {
  spellEffect: {
    // R64: "target OPPONENT" is a player-only, opponent-only kind — 'any'
    // offered every unit on the board and the caster themself.
    targets: { what: 'opponent', prompt: 'Interdiction Rift: target opponent negates an effect they control' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('player' in (t as object))) return;
      const who = (t as { player: Seat }).player;
      if (who === ctx.controller) { g.ev('info', 'Interdiction Rift: you are not an opponent — no effect.'); return; }
      const theirs = g.s.stack.filter(i => i.controller === who);
      if (!theirs.length) { g.ev('info', `Interdiction Rift: ${g.pname(who)} controls no effect — nothing to negate.`); return; }
      const id = theirs.length === 1 ? theirs[0]!.id : ctx.choose('rift', {
        kind: 'payOrDecline', seat: who,
        prompt: 'Interdiction Rift: negate an effect you control',
        options: theirs.map(i => ({ label: i.label, value: i.id })),
      }) as number;
      g.negate(id);
    },
  },
});

// "Switch the power and defense of target unit until regroup." — mm/2
// {Battle} {Reaping} Occult Technology Spell. ⚠ header approximation: the
// EFFECTIVE stats at resolution are swapped via a temp delta (cleared at
// regroup). If the swap kills (a 0-power unit becomes X/0), the printed
// {Reaping} draws the caster a card — R184: through the ENGINE's kill diff,
// off the printed attribute. The rider used to be hand-rolled HERE, because
// {Reaping} lived in `dealEffectDamageAll` and a stat swap deals no damage.
card('Invasive Reassignment', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Invasive Reassignment: switch the power and defense of target unit until regroup' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) return;
      const [p, d] = g.effStats(t);
      g.addTemp(t, d - p, p - d);
      g.checkDeaths();
    },
  },
});

// "[Switch1] /[Sacrifice a unit]: Each opponent sacrifices a unit." — m/1
// {Battle} Technology Spell. The slash cost is a CAST COST (R35): the
// caster's sacrifice is chosen and paid before the spell reaches the stack —
// no unit of yours IN THE REGION, no cast (R35 scopes cast costs to the
// item's region, superseding this batch's old any-region note). "Each
// opponent" is region-scoped (R25): opponents present in the effect's region
// sacrifice one of their units THERE (none there → nothing for them).
// Bounded graft ([Switch1], R9) — the rider pays (or declines) at composite
// cast time.
const linkedExtinction: EffectDef = {
  castCost: { kind: 'sacrificeUnit' },
  run: (g, ctx) => {
    if (!ctx.costPaid?.sacrificed) {
      ctx.refundBudget?.();   // R113: declining a [cost] never spends the use
      g.ev('info', 'Linked Extinction: no unit was sacrificed — nobody sacrifices.');
      return;   // rider declined / unpayable
    }
    // R187/CT-70: the declined-cost branch above announces itself; this loop
    // did not, and R25 empties it whenever the region holds nobody else.
    const foes = g.s.regions[ctx.region]!.presentSeats.filter(s => s !== ctx.controller);
    if (!foes.length) {
      g.ev('info', 'Linked Extinction: no opponent is present here — nobody sacrifices a unit.');
      return;
    }
    for (const seat of foes) {
      const units = g.unitsOf(seat, ctx.region);
      if (!units.length) { g.ev('info', `Linked Extinction: ${g.pname(seat)} has no unit here.`); continue; }
      const id = units.length === 1 ? units[0]!.id : ctx.choose(`leOpp:${seat}`, {
        kind: 'payOrDecline', seat,
        prompt: 'Linked Extinction: sacrifice a unit',
        options: units.map(u => ({ label: u.card, value: u.id, card: u.card })),
      }) as EntityId;
      const u = g.entity(id);
      if (u) g.destroy(u, 'is sacrificed');
    }
  },
};
card('Linked Extinction', {
  spellEffect: linkedExtinction,
  graftEffect: { bounded: true, effect: linkedExtinction },
});

// "[Augment] [three]: Create a Robot 2." — mm/4 2/4 Robot Unit. An ACTIVATED
// ability in the [Augment] text box: live when played normally
// (via: 'augment') and donated to hosts (via: { mod }). The Robot arrives
// where the carrier is (R115: ctx.region).
card('Living Forge', {
  augmentText: [{
    type: 'activated', cost: { mana: 3 },
    label: '[three]: create a Robot 2',
    effect: { creates: ['Robot'], run: (g, ctx) => { makeRobot(g, ctx.controller, 2, ctx.region); } },
  }],
});

// "[Switch1] Create a Robot 3, a Robot 2 and a Robot 1." — mmm/6 Robot
// Spell (deploy timing). All three arrive at the source's region (R115),
// which for a deploy-timing spell IS home. Bounded graft ([Switch1], R9).
const manufactureRobots: EffectDef = {
  creates: ['Robot'],
  run: (g, ctx) => { for (const x of [3, 2, 1]) makeRobot(g, ctx.controller, x, ctx.region); },
};
card('Manufacture', {
  spellEffect: manufactureRobots,
  graftEffect: { bounded: true, effect: manufactureRobots },
});

// "If I spawned this turn, other units lose all attributes and abilities
// during battle." — m/1 1/1 {Battle} Bedlam Alien Monkey Unit. R62's
// continuous suppression, with both of the printed conditions read live
// (a static is re-evaluated every time anybody asks, so "if I spawned this
// turn" stops being true the moment the turn rolls over, and the whole thing
// switches off outside battle):
//   - "other units": every unit in the region but Monke itself, BOTH sides'
//     — the text says units, not your units, and this one is symmetrical on
//     purpose (it is a 1/1 that turns the battle vanilla for everyone).
//   - region scope is the engine's (R12), as for every other static.
// Two Monkes do not silence each other: staticsFor's suppression check is the
// entity flag only, so simultaneous static-vs-static suppression resolves in
// one pass and both keep radiating (R62).
card('Monke', {
  statics: [{
    affects: (g, self, t) => t.kind === 'unit' && t.id !== self.id
      && g.s.phase === 'battle' && g.spawnedTurn(self) === g.s.turn,
    suppressAttrs: true, suppressAbilities: true,
  }],
});

// "[Augment] {Flying} Alien Cloud {Virus} Unit" — m/1 1/1. Type-line
// [Augment] grants {Flying} (printed.augmentAttrs); {Virus} lets it augment
// from hand during battle. No text — nothing to script.
card('Nebula Drifter', {});

// "[three]: [Switch] Put a +1/+1 counter on me." — mmm/3 2/1 Cosmic Robot
// Unit. An activated graft CAUSE (3 mana): grafted effects ride each
// activation; its own [Switch]-marked effect is unbounded when grafted
// elsewhere. "Me" = the ability's carrier (the host when grafted).
const evokerCounter: EffectDef = {
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    if (!self) { g.ev('info', `${ctx.sourceName}: the carrier is gone — no counter.`); return; }
    g.addCounters(self, 1);
  },
};
card('Omniwield Evoker', {
  abilities: [{
    type: 'activated', cost: { mana: 3 }, graftCause: true,
    label: '[three]: put a +1/+1 counter on me',
    effect: evokerCounter,
  }],
  graftEffect: { bounded: false, effect: evokerCounter },
});

// "Each player sacrifices half of their units, rounded up." — mm/4 {Battle}
// Occult Spell. Region-scoped (R12/R25 — header): each player present in the
// effect's region sacrifices ceil(their units there / 2), choosing which,
// caster first. The count is read per player as their picks begin (R1).
card('Perish', {
  spellEffect: {
    run: (g, ctx) => {
      const present = g.s.regions[ctx.region]!.presentSeats.slice();
      const seats = [
        ...present.filter(s => s === ctx.controller),
        ...present.filter(s => s !== ctx.controller),
      ];
      // R1: "amounts are computed at RESOLUTION" — and Perish resolves ONCE, so
      // every player's half is the half they had at that single moment. The
      // count used to be recomputed as each seat's picks began, caster first,
      // so a death trigger off the CASTER's own sacrifices could shrink the
      // opponent's board before their number was taken — and the opponent then
      // sacrificed half of an already-reduced army. Snapshot all of them first.
      const quota = new Map<Seat, number>(
        seats.map(s => [s, Math.ceil(g.unitsOf(s, ctx.region).length / 2)]));
      for (const seat of seats) {
        const units = () => g.unitsOf(seat, ctx.region);
        const n = quota.get(seat)!;
        for (let i = 0; i < n; i++) {
          const pool = units();
          if (!pool.length) break;
          const id = pool.length === 1 ? pool[0]!.id : ctx.choose(`perish:${seat}:${i}`, {
            kind: 'payOrDecline', seat,
            prompt: `Perish: sacrifice a unit (${n - i} to go)`,
            options: pool.map(u => ({ label: u.card, value: u.id, card: u.card })),
          }) as EntityId;
          const u = g.entity(id);
          if (u) g.destroy(u, 'is sacrificed');
        }
      }
    },
  },
});

// "I spawn with two +1/+1 counters. [Augment] When I despawn, you may move
// my counters onto target unit." — m/2 0/0 Robot Unit.
//
// R165: the first sentence is `spawnsWithCounters: 2` — a DECLARATION about
// the body, applied by E.spawnUnit before the 'spawned' event fires. It used
// to be a bookkeeping `triggered` whose `when()` wrote `self.counters += 2`
// and returned false, with a comment explaining that a queued trigger would
// be too late (settle()'s death check would erase the 0/0 first). The
// diagnosis was right and the workaround still had a hole in it: writing the
// field RAW walks straight past R104's AMOUNT layer, so an allied Flux
// Resonator made this card enter with 2 counters while "Create a Robot 2" —
// the same printed sentence with a number in it — entered with 3. One field
// on the card definition, one application site, one answer for both.
//
// The hole ran the other way on the card that prints the SAME sentence:
// Aethercap Siphoner ("I spawn with three -1/-1 counters on me") used a real
// triggered ability, so ITS arrival size queued a stack item an opponent could
// respond to or negate, while this card's could not be answered at all. Two
// mechanisms for one printed idea, disagreeing about both the amount layer and
// the stack. `spawnsWithCounters` is neither: it is a declaration, so it is
// never on the stack on either card, and it is scaled on both.
//
// ⚠ Header note retired with it: the spawn-counter approximation is gone.
// The DESPAWN amount is still read off the event (R70's leftPlayFacts), which
// is not an approximation at all. Despawn = ANY leave-play ('died' +
// 'despawned', Bloated Manablub precedent). "You may": min 0 lets the chooser
// decline. The first sentence sits above the [Augment] marker, so it does NOT
// transfer — and a declaration about MY body could not transfer in any case;
// the move-my-counters text below does.
card('Powerforge Synergist', {
  spawnsWithCounters: 2,
  augmentText: [{
    type: 'triggered', events: ['died', 'despawned'], self: true,
    label: 'move my counters onto target unit',
    // R70: the leave-play event already CARRIES the counter total
    // (E.leftPlayFacts stamps `counters` on 'died' and 'despawned' alike,
    // precisely because the entity is out of s.entities by the time the
    // trigger resolves). This used to stash its own `pfCounters` snapshot
    // here — a private copy of a fact the event already told everyone.
    // "MY COUNTERS", read literally (2026-08-24 literal-reading audit). This
    // used to be `self.counters > 0` — "positive counters only", a qualifier
    // the printed line does not carry. The engine keeps ONE signed net, and
    // this batch already settles what that means for exactly this question:
    // Flux Constructor, eight cards up, moves a dead ally's counters "with
    // their sign — you move what was actually there, drawback and all", and
    // Scrap For Parts says the same ("negative nets move too"). The donated
    // [Augment] form is where the old gate was reachable and wrong: "I" is
    // then the HOST, and a host sitting on a net -3 has counters to move.
    when: (_g, self) => self.counters !== 0,
    effect: {
      targets: { what: 'unit', min: 0, prompt: 'Powerforge Synergist: move my counters onto target unit (or decline)' },
      run: (g, ctx) => {
        const n = (ctx.event?.data?.['counters'] as number | undefined) ?? 0;
        const t = ctx.targets[0];
        if (n !== 0 && isEnt(t) && g.entity(t.id)) g.addCounters(t, n);
        else g.ev('info', 'Powerforge Synergist: no unit is targeted (or it is gone) — the counters are lost.');
      },
    },
  }],
});

// "Your units gain \"When I die, create a Robot 3.\" until regroup." — mm/3
// {Battle} Occult Technology Spell. R63: the granted clause is authored HERE,
// as this card's own abilities[0], and handed to each unit as a reference.
// Nothing else can ever fire it — a spell is never a unit in play, so
// fireEvent's scan reaches abilities[0] only through the grants below.
//
// "Your units" is region-scoped (R12, the Flowstone Arcanite precedent): the
// units with you where the spell is cast. The grant is a snapshot of that
// moment, exactly as the printed text reads — a unit that arrives afterwards
// was not one of "your units" when the spell resolved and gets nothing.
const REFORGED = 'When I die, create a Robot 3.';
card('Reforge the Dead', {
  abilities: [{
    type: 'triggered', events: ['died'], self: true,
    label: 'create a Robot 3 (granted by Reforge the Dead)',
    effect: {
      creates: ['Robot'],
      run: (g, ctx) => { makeRobot(g, ctx.controller, 3, ctx.region); },
    },
  }],
  spellEffect: {
    run: (g, ctx) => {
      const units = g.unitsOf(ctx.controller, ctx.region);
      for (const u of units) {
        g.grantText(u, {
          card: 'Reforge the Dead', via: 'ability', index: 0,
          text: REFORGED, from: 'Reforge the Dead',
        });
      }
      if (!units.length) g.ev('info', 'Reforge the Dead: no units to grant it to.');
    },
  },
});
