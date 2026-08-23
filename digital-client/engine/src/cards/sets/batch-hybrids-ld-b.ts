/* Light & Dark expansion — batch hybrids-ld-b (18 cards).
 *
 * Behaviour only; printed data comes from printed.json (never hand-copied).
 * Spec for the expansion's new mechanics: docs/08-light-and-dark.md,
 * rulings R38-R48 in docs/digital-rules.md.
 *
 * Every card is a HYBRID whose second element is Light or Dark. Printed text
 * is quoted in a comment above each card (batch-hybrids-wm-a convention).
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (trigger conditions at EVENT time, amounts at
 * resolution), R5 (fizzle vs partial), R6 (mid-resolution payments/choices via
 * ctx.choose), R9 (bounded [Switch1]/[once] budgets per card), R12/R25
 * ("each opponent" = the region's present seats), R19 (layer-4 Balanced),
 * R27 (state-derived amounts read live), R35 (bracketed costs paid at cast),
 * R37 (applying a mod is not playing), R40 (trash), R71 (the Wraith token).
 *
 * Cards in this batch:
 *   Air Plant             Arbiter of Vitality   Blight's End
 *   Brough                Cadaverous Cultivator Combustible Bogwalker
 *   Darkblast             Deferral Drone        Equilibriate
 *   Hammer of Justice     Inexorable Miasma     Life Power Dude
 *   Murkstalker           Proliferating Slime   Rime Wraith
 *   Splort                The Omniphage         Vengeance
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 * ✔ NON-MANA COSTS ARE REAL NOW (R35/R49). Darkblast declares
 *    `castCost: { kind: 'discardCard', n: 1 }` and Cadaverous Cultivator
 *    `cost: { discard: 1 }`: both are chosen and paid in the CAST window,
 *    before the item reaches the stack, and an unpayable cost makes the
 *    cast/activation ILLEGAL rather than a silent no-op. (A spell may not
 *    discard ITSELF to pay its own cost — castable() reserves it.)
 *    Combustible Bogwalker's "sacrifice a nontoken unit OR discard a card" is
 *    the printed either/or shape, `cost: { discardOrSacrifice: 1 }` — also a
 *    real activation cost, also paid before the item reaches the stack.
 * ✔ X-MANY TARGETS ARE REAL NOW (R64/R67). This entry used to read "TargetSpec
 *    .count is fixed at definition time and X is only known after the cast
 *    payment", so Blight's End picked its hosts mid-resolution. `count: 'X'`
 *    reads the X that R35 already fixed before targets are asked for, so the
 *    spell goes on the stack aiming at named units and opponents respond to
 *    the picks.
 * ✔ PROLIFERATING SLIME IS A REAL REPLACEMENT NOW (R104). "put that many
 *    counters plus one instead" is an `AmountMod` — consulted by addCounters /
 *    gainRot / gainDebt before they commit, summed across holders, never on the
 *    stack — so the counters arrive once with the right number on them, and the
 *    module-level `let proliferating` that guarded the old trigger's
 *    re-entrancy is deleted (report #60 counted those flags as the symptom).
 *  - ⚠ ARBITER OF VITALITY is still a TRIGGER, and deliberately so: "Double all
 *    life gain and life loss" prints neither "would" nor "instead", so it is
 *    outside the class report #75 defines and R104 implements. It is a
 *    multiplier on a life change rather than a substitution of one, and giving
 *    it a hook would need a MULTIPLICATIVE amount family whose composition with
 *    the additive one nobody has ruled on. Flagged in R104's "still not
 *    replaceable" list rather than guessed at.
 * ✔ "[Battle]" ON AN ACTIVATED ability is `ActivatedAbility.timing` now (R49),
 *    enforced at ACTIVATION: Cadaverous Cultivator is not offered during
 *    deployment and apply() refuses it there.
 *
 * PARKED (needs engine machinery that does not exist yet):
 *  - PARTIAL — Deferral Drone: the whole ability WORKS now (un-parked
 *    2026-08-22, see the card below — the "one-shot that a play consumes"
 *    turned out to be `Entity.budgets`, which is per-turn state cleared by
 *    E.startTurn, plus the existing spellPlayed/spawned events to spend it).
 *    What is left is one UNSOURCED rules question: because the discount is a
 *    CostMod radiating from the Drone, it dies with the Drone. Nothing in the
 *    rulings corpus says whether a resolved "the next card you play this turn
 *    costs [3] less" should outlive its source. Kept in test/card-ledger.ts
 *    for that residue.
 *  - Vengeance: "Cards your opponents play during battle gain '[Sacrifice a
 *    unit]'" IMPOSES an additional cast cost on other players' cards. Again the
 *    layer exists but not this channel: CostMod carries `delta` (extra mana)
 *    and `life` (extra life, R60's Arbiter of Armistice), and there is no
 *    channel for "and a sacrifice" — nor any way to make the imposed cost gate
 *    the opponent's cast. Inert [Augment] text; plays as a 7/9.
 *
 * UNPARKED by the R51 wave: Inexorable Miasma's second sentence ("After
 * combat, if I am in your bin …") is a `zone: 'bin'` trigger — see R51 and the
 * card's own comment.
 */
import type { Attr, Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, getCard, isEntityTarget, type EffectDef } from '../dsl.ts';
import { isEnt, isUnitCard, selfOf } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** every attribute the pool can print (types.ts `Attr`), for The Omniphage's
 * per-attribute statics.
 *
 * ⚠ THIS NOTE WAS STALE (corrected 2026-08-22, card-ledger audit). It named
 * {Pure} as "in the union but PARKED engine-side … the engine simply ignores
 * it". R61 shipped {Pure} — E.pure() switches the attribute layer off for a
 * whole attack/block exchange — and it reads E.ownAttrs, which folds in
 * statics' `attrs`. So a {Pure} granted by one of the rows below is honoured
 * at the combat choke points exactly like a printed one.
 *
 * {Unaware} used to be called out here as the one still-inert name. It is not
 * any more: R106 shipped stat layer 6 on 2026-08-23, so a row granting
 * {Unaware} makes the Omniphage ignore every stat change including its own,
 * and Bubb, Trashling and Haboob came off the card ledger with it.
 *
 * {Inverted} came off the same list one round earlier: R93 shipped stat layer
 * 5 for playtest report #73, so a row granting {Inverted} now really inverts
 * the Omniphage's net stat change, and Reality Bender and Its Dark Bubb came
 * off the card ledger with it.
 *
 * Every name in this union is read by something now. If that stops being
 * true, say WHICH name and cite the ledger entry — an "inert" note with no
 * failing check behind it is the shape that hid Harbinger. */
const ALL_ATTRS: Attr[] = [
  'Flying', 'Deadly', 'Swift', 'Sluggish', 'Tough', 'Balanced',
  'Inverted', 'Unaware', 'Powerful', 'Vulnerable', 'Feeble', 'Evasive',
  'Sneaky', 'Alluring', 'Piercing', 'Electric', 'Poisonous', 'Resonant',
  'Thieving', 'Reaping',
  'Blessed', 'Afflicting', 'Lethal', 'Pure', 'Modular',
];

// ─────────────────────── LIGHT / WOOD (lg) ────────────────────────────

// "{i}(Only flying units can block flying units.){/n}[Augment] Your other
// units gain +2/+2 and Flying." — lg/7 2/2 {Flying} Cosmic Plant Unit, with
// the printed banner "[2] Prophecy — Your units have four unique costs."
//
// The banner is printed data (printed.prophecy) and the condition is already a
// PROPHECY_RULES row (`uniqueUnitCosts`), so prophesying/releasing needs no
// behaviour here — only the [Augment] static does. Statics are live both while
// the card is a unit in play and while it rides as an augment mod, anchored on
// the HOST when donated (staticsFor), which is exactly what "your other units"
// wants. Region-scoped by the engine (R12).
card('Air Plant', {
  augmentable: true,   // text-box [Augment] implemented as a static
  statics: [{
    affects: (_g, self, target) =>
      target.kind === 'unit' && target.controller === self.controller && target.id !== self.id,
    dp: 2, dt: 2, attrs: ['Flying'],
  }],
});

// "[Switch] Set all players' life totals equal to their average. {i}(Rounded
// down.)" — lg/5 0/0 {Battle} Cosmic Spell.
//
// "All players" is the whole table, not the region: life totals are a player
// property and the card names players, not units (contrast R25's region-scoped
// "each opponent"). The average is floored, then each player is moved to it
// with the ordinary gain/lose primitives so {Blessed}-style listeners and the
// lethal check behave normally. Unbounded graft ([Switch], R9).
const equalizeLife: EffectDef = {
  run: (g, ctx) => {
    const seats: Seat[] = [0, 1];
    const total = seats.reduce((n, s) => n + g.player(s).life, 0);
    const avg = Math.floor(total / seats.length);
    g.ev('info', `${ctx.sourceName}: the average life total is ${avg}.`);
    for (const s of seats) {
      const life = g.player(s).life;
      if (life < avg) g.gainLife(s, avg - life, ctx.sourceName);
      else if (life > avg) g.loseLife(s, life - avg, ctx.sourceName);
    }
  },
};
card('Equilibriate', {
  spellEffect: equalizeLife,
  graftEffect: { bounded: false, effect: equalizeLife },
});

// ─────────────────────── LIGHT / FIRE (lr) ────────────────────────────

/** the `why` string the doubling gain/loss is logged under — also the
 * re-entrancy guard: an Arbiter never doubles its own doubling */
const ARBITER_WHY = 'Arbiter of Vitality doubles it';

// "[Augment] Double all life gain and life loss. {i}(Damage causes loss of
// life.)" — lr/8 6/3 Cosmic Horror Unit.
//
// ⚠ REPLACEMENT APPROXIMATION (header): doubling is a replacement effect and
// the engine has no hook for life changes, so this is a pair of triggers that
// deal out the SECOND helping after the first has landed. Consequences:
//  - "all" is unqualified, so BOTH players' gains and losses double.
//  - a loss that was already lethal ends the game before the doubling
//    resolves, which is harmless (it was lethal either way).
//  - two Arbiters give 3x, not 4x — each hears only the original event,
//    because the guard below excludes every doubling from re-triggering.
// The parenthetical "(Damage causes loss of life.)" is why this listens on
// 'lifeLost' rather than 'damage': damage already routes through loseLife.
card('Arbiter of Vitality', {
  augmentText: [
    {
      type: 'triggered', events: ['lifeGained'],
      label: 'double that life gain',
      when: (_g, _self, ev) => ev.data?.why !== ARBITER_WHY,
      effect: {
        run: (g, ctx) => {
          const n = (ctx.event?.data?.n as number | undefined) ?? 0;
          const seat = ctx.event?.data?.seat as Seat | undefined;
          if (seat === undefined || n <= 0) return;
          g.gainLife(seat, n, ARBITER_WHY);
        },
      },
    },
    {
      type: 'triggered', events: ['lifeLost'],
      label: 'double that life loss',
      when: (_g, _self, ev) => ev.data?.why !== ARBITER_WHY,
      effect: {
        run: (g, ctx) => {
          const n = (ctx.event?.data?.n as number | undefined) ?? 0;
          const seat = ctx.event?.data?.seat as Seat | undefined;
          if (seat === undefined || n <= 0) return;
          g.loseLife(seat, n, ARBITER_WHY);
        },
      },
    },
  ],
});

// "[Augment] Cards your opponents play during battle gain '[Sacrifice a
// unit]'." — lr/13 7/9 Occult Unit.
// PARKED (see header): imposing an additional cast cost on ANOTHER player's
// cards is the cost-modification layer docs/08 puts out of scope. The inert
// augmentText entry keeps the card recognised as an augment (Stasis Sentry /
// The Silent precedent); it plays as a vanilla 7/9 meanwhile.
card('Vengeance', {
  augmentText: [{
    type: 'triggered', events: [],   // PARKED — never fires
    label: "opponents' battle cards gain '[Sacrifice a unit]' (not implemented)",
    effect: { run: () => { /* PARKED */ } },
  }],
});

// ─────────────────────── LIGHT / EARTH (le) ───────────────────────────

// "[Augment] Everything is balanced. {i}(The power and defense of balanced
// units are equal to the greater of the two.)" — le/4 0/4 Cosmic Unit.
//
// "Everything" is unowned and unqualified: every unit in the region, both
// players', the carrier included. {Balanced} is a layer-4 attribute (R19) —
// granting it through a static lands in ownAttrs, which layer4Attrs reads, so
// the max-of-the-two rewrite happens in the right layer for free.
card('Brough', {
  augmentable: true,   // text-box [Augment] implemented as a static (see below)
  statics: [{
    affects: (_g, _self, target) => target.kind === 'unit',
    attrs: ['Balanced'],
  }],
});

// "" — le/6 10/3 {Blessed} {Piercing} Structure Unit. No rules text: both
// attributes are printed on the type line and {Blessed} is engine-side (R48,
// simultaneous lifelink). Registered so it enters DECK_LIST.
card('Hammer of Justice', {});

// ─────────────────────── LIGHT / WATER (lb) ───────────────────────────

// "{i}(Swift units deal combat damage first. Sluggish units deal combat damage
// last.)" — lb/2 2/1 {Virus} [Augment] {Swift}{Sluggish} Spirit Anima Unit.
//
// Reminder text only: the type line's [Augment] {Swift}{Sluggish} is printed
// data (augmentAttrs), so applying it as a Virus/augment donates both
// attributes with no behaviour at all. ⚠ The two granted attributes CONTRADICT
// each other by design — see the batch report; the engine resolves the pair in
// its own damage-order layer, not here.
card('Rime Wraith', {});

// ─────────────────────── LIGHT / METAL (lm) ───────────────────────────

// "[Augment] As long as your life total is odd, all units gain -2/-0.
// Otherwise they gain +2/+0." — lm/4 2/3 {Virus} Cosmic Unit.
//
// "Your life total" is the CARRIER's controller (the host's, when this rides as
// a Virus/augment mod — statics are anchored on the host). "All units" is
// unqualified: every unit in the region, both players'. The parity is read
// live at every stat evaluation (R27), so gaining or losing a single life
// flips the whole board. dp must not call effStats (reentrancy guard) — it
// reads the raw life total, which is safe.
card('Life Power Dude', {
  augmentable: true,   // text-box [Augment] implemented as a static
  statics: [{
    affects: (_g, _self, target) => target.kind === 'unit',
    dp: (g, self) => (Math.abs(g.player(self.controller).life % 2) === 1 ? -2 : 2),
    dt: 0,
  }],
});

// "[Augment][once] Gain 4 debt: The next card you play this turn costs [3]
// less." — lm/2 2/2 Horror Unit.
//
// UN-PARKED 2026-08-22. The park note said "a CostMod is continuous and
// stateless … 'the NEXT card you play this turn' needs a one-shot that a play
// consumes, which no channel provides". Both halves of that turned out to
// exist already, in places the note never looked:
//
//  · THE ONE-SHOT is `Entity.budgets` — the Record<string, number> that R9's
//    bounded/[once] abilities use to remember they have fired. It is real game
//    state (so it serializes and replays), it is keyed by an arbitrary string,
//    and E.startTurn wipes every entity's budgets. "This turn" is therefore
//    free: the charge cannot outlive the turn even if nothing spends it.
//    Ancient One (batch-metal-a) already writes budgets from card code.
//
//  · THE CONSUMER is the pair of events a play already fires. E.commitItem
//    fires 'spellPlayed' for a spell / spell unit, and E.spawnUnit fires
//    'spawned' carrying `from` for a unit that came out of a ZONE — an effect
//    that merely creates a unit passes no `from`, which is exactly the
//    "played, not made" distinction the card needs. Both fire AFTER the
//    payment (apply.ts playAtTiming pays before castChain), so the charge is
//    still standing while the bill is computed and is gone by the next play.
//    The trigger uses the sanctioned bookkeeping shape — it mutates in when()
//    and returns false, so nothing ever reaches the stack.
//
// R37/R59: applying a mod is NOT playing, so `purpose: 'mod'` is excluded —
// you cannot spend this charge on an augment, a graft or a battle Virus. A
// spell TOKEN is likewise excluded from the consumer: R59 already settled that
// a token is cast from play rather than played.
//
// The whole thing is region-scoped (R12) because a CostMod radiates from its
// anchor's region, and `self` is the anchor — the Drone in play, or the HOST
// when the text is donated by an augment, so "you" is the host's controller
// and the [Augment] half needs no extra code.
//
// ⚠ OPEN, UNSOURCED: the discount is a CostMod, so it stops the moment the
// Drone (or its host) leaves play — sacrifice the Drone in response and the
// charge evaporates. A resolved effect arguably should not care, but the
// rulings corpus says NOTHING about this card (searched 2026-08-22: no hit for
// "Deferral", "next card you play" or "costs 3 less" anywhere in the export).
// Storing the charge on PlayerState instead of the entity would make it
// survive, and that is a core change and a rules question. Guarded by a todo
// test; declared in test/card-ledger.ts.
const DRONE_CHARGE = 'deferralDrone:discount';

card('Deferral Drone', {
  augmentText: [
    {
      // [once] = `bounded`, R9: one activation per turn per CARD, which is the
      // same budget channel the charge itself rides (different key).
      type: 'activated', bounded: true, cost: { debt: 4 },
      label: 'gain 4 debt: the next card you play this turn costs [3] less',
      effect: {
        run: (g, ctx) => {
          const self = selfOf(g, ctx);
          if (!self) return;   // the carrier died with the ability on the stack
          self.budgets[DRONE_CHARGE] = 1;
          g.ev('info',
            `${ctx.sourceName}: the next card ${g.pname(ctx.controller)} plays this turn costs [3] less.`,
            { seat: ctx.controller });
        },
      },
    },
    {
      // BOOKKEEPING ONLY (the Powerforge Synergist / Ancient One shape): the
      // work happens in when(), which then returns false so no trigger is ever
      // queued and nothing can be responded to. A cost reduction being spent
      // is not an effect — it has already happened by the time we hear about it.
      type: 'triggered', events: ['spellPlayed', 'spawned'],
      label: 'the deferred discount is spent',
      when: (g, self, ev) => {
        if ((self.budgets[DRONE_CHARGE] ?? 0) === 0) return false;
        if (ev.data?.['seat'] !== self.controller) return false;
        // R59: a spell TOKEN is cast from play, not played.
        if (ev.type === 'spellPlayed' && ev.data?.['token']) return false;
        // a unit that came from no zone was CREATED, not played.
        if (ev.type === 'spawned' && ev.data?.['from'] === undefined) return false;
        self.budgets[DRONE_CHARGE] = 0;
        g.ev('info', `Deferral Drone: the [3] discount is spent.`, { seat: self.controller });
        return false;
      },
      effect: { run: () => { /* see when(): this trigger never queues */ } },
    },
  ],
  costMods: [{
    // R59. `self` is the anchor, so "you" is the Drone's controller in play and
    // the HOST's controller when donated. manaToPlay clamps the total at zero,
    // so a [1] card simply becomes free rather than going negative.
    delta: (_g, self, ctx) =>
      ctx.purpose === 'play'
      && ctx.seat === self.controller
      && (self.budgets[DRONE_CHARGE] ?? 0) > 0 ? -3 : 0,
  }],
});

// ─────────────────────── LIGHT / DARK (ld) ────────────────────────────

// "When you trash another card, [Switch1] Each opponent loses 3 life and you
// gain 3 life." — ld/3 2/2 Cosmic Horror Unit.
//
// R40 'trashed' event: "you trash" = the bin's owner is my controller (the
// event carries the trasher's seat). "Another card" is free — a trigger source
// has to be a unit IN PLAY and a trashed card is by definition in a bin, so it
// can never be this entity. Region-scoped by the event (noteTrashed stamps
// actionRegion, R12). "Each opponent" = the region's other present seats
// (R25). Bounded cause + bounded graft ([Switch1], R9).
const murkstalkerDrain: EffectDef = {
  run: (g, ctx) => {
    for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
      if (seat === ctx.controller) continue;
      g.loseLife(seat as Seat, 3, 'Murkstalker');
    }
    g.gainLife(ctx.controller, 3, 'Murkstalker');
  },
};
card('Murkstalker', {
  abilities: [{
    type: 'triggered', events: ['trashed'], bounded: true, graftCause: true,
    label: 'each opponent loses 3 life and you gain 3 life (you trashed a card)',
    when: (_g, self, ev) => ev.data?.seat === self.controller,
    effect: murkstalkerDrain,
  }],
  graftEffect: { bounded: true, effect: murkstalkerDrain },
});

// ─────────────────────── FIRE / DARK (rd) ─────────────────────────────

// "[Augment][once] Sacrifice a nontoken unit or discard a card: Recall target
// unit in your bin." — rd/6 5/7 Spirit Anima Unit.
//
// An ACTIVATED ability in the [Augment] text box (the Slag Spewer precedent):
// live while the card is a unit in play and donated to hosts.
//
// R49: the either/or line is a real ACTIVATION cost
// (`discardOrSacrifice: 1`) — it GATES the activation and is chosen and paid
// in the cast window, before the item reaches the stack. Both modes TRASH the
// paid card (R40), which is the point in a dark-element deck. The engine's
// sacrifice pool excludes tokens and the ability's own source.
//
// ⚠ Consequence of paying at the right time: with nothing in your bin to
// recall, the cost is still paid — the printed line is a cost, not a targeted
// spell, and R35 pays costs before effects. The old resolution-time version
// checked the bin first and paid nothing; that was the more forgiving reading,
// not the more correct one.
// "Recall … in your bin" moves a unit card from the bin to the HAND (recall is
// always to hand, Manual). Bounded by [once] (R9).
card('Combustible Bogwalker', {
  augmentText: [{
    type: 'activated', cost: { discardOrSacrifice: 1 }, bounded: true,
    label: 'sacrifice a nontoken unit or discard a card: recall target unit in your bin',
    effect: {
      // R64: "target unit in your bin" is a declared target. NOTE the
      // ordering it inherits: targets are collected BEFORE the activation
      // cost is paid (R57), so the pick is made against the bin as it stands
      // BEFORE the discard/sacrifice pushes another card into it — you cannot
      // recall the very card you are about to pay with. That is the printed
      // reading (the cost is paid to use the ability, not as part of it) and
      // it is also the kinder one: you see what you would get first.
      targets: {
        what: 'binCard', min: 0,
        prompt: 'Combustible Bogwalker: recall target unit in your bin',
        restrict: (_g, t) => 'binCard' in t && isUnitCard(t.binCard.card),
      },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!t || !('binCard' in t) || t.binCard.index === -1) {
          g.ev('info', 'Combustible Bogwalker: no unit in your bin — the cost is paid for nothing.');
          return;
        }
        const [name] = g.player(ctx.controller).bin.splice(t.binCard.index, 1);
        if (name !== undefined) {
          g.player(ctx.controller).hand.push(name);
          g.ev('info', `Combustible Bogwalker: ${name} is recalled to ${g.pname(ctx.controller)}'s hand.`);
        }
      },
    },
  }],
});

// "[Switch1] [Discard a card] I deal 5 damage to any target." — rd/1 0/0
// {Battle} Arcane Spell.
//
// The bracketed [Discard a card] is a REAL cast-time additional cost — see the
// castCost below and the header's ✔ note. (The paragraph that used to stand
// here said "CastCost only knows `sacrificeUnit`, so it is paid at RESOLUTION";
// that expired when CastCost grew its other six kinds, and it contradicted the
// declaration thirteen lines under it.) Bounded graft ([Switch1], R9); on a
// graft the CARRIER's controller pays and the carrier aims the 5 damage.
const darkblastEffect: EffectDef = {
  targets: { what: 'any', prompt: 'Darkblast: deal 5 damage to any target' },
  // R35/R49: a REAL bracketed cast cost now — chosen and paid at cast, before
  // the spell reaches the stack. With an empty hand the cast is ILLEGAL
  // (castable() refuses it and legalActions never offers it); on a grafted
  // rider it is optional and declining skips just that part. The discard
  // TRASHES the card (R40), which is the point of the card in a dark deck.
  castCost: { kind: 'discardCard', n: 1 },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!t) return;
    g.dealEffectDamage(ctx, t, 5);
  },
};
card('Darkblast', {
  spellEffect: darkblastEffect,
  graftEffect: { bounded: true, effect: darkblastEffect },
});

// "When another card is trashed, [Switch1] I deal 2 damage to any target." —
// rd/2 2/2 Mystic Unit.
//
// R40 'trashed', ANY player's (unqualified — contrast Murkstalker's "when
// YOU trash"), region-scoped by the event. "Another card" is free: the trigger
// source is a unit in play and the trashed card is in a bin. Bounded cause +
// bounded graft ([Switch1], R9); the target is collected when the trigger is
// put on the stack, like any targeted trigger.
const splortBolt: EffectDef = {
  targets: { what: 'any', prompt: 'Splort: deal 2 damage to any target' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (t) g.dealEffectDamage(ctx, t, 2);
  },
};
card('Splort', {
  abilities: [{
    type: 'triggered', events: ['trashed'], bounded: true, graftCause: true,
    label: 'deal 2 damage to any target (another card was trashed)',
    effect: splortBolt,
  }],
  graftEffect: { bounded: true, effect: splortBolt },
});

// ─────────────────────── WOOD / DARK (gd) ─────────────────────────────

// "Augment a Wight onto X target units." — gd/X 0/0 {Battle} Blight Spell.
//
// R71: the retired "Wight" and the current "Wraith" are one token; augmentWraith() creates it directly
// as an augment MOD on the host rather than spawning the body, and the mod is
// a token so it is erased (never binned, never trashed) when it leaves play.
// R67: the X targets are DECLARED targets, collected as the spell goes on the
// stack (`count: 'X'`, which the collector reads off the X already fixed by
// R35's cast-time payment) — they used to be mid-resolution picks, so the
// spell sat on the stack aiming at nobody. "Target units" is unqualified, so an ENEMY unit
// is a legal host: the Wraith's donated "[Augment] When I attack or block, put
// a -1/-1 counter on me" then shrinks THEM. X = 0 does nothing (the card does
// not print "X can't be zero", so xMin stays at the default 0).
card("Blight's End", {
  spellEffect: {
    targets: {
      what: 'unit', count: 'X', min: 0,
      prompt: "Blight's End: augment a Wight onto target unit",
    },
    creates: ['Wraith'],
    run: (g, ctx) => {
      // the targets ARE the hosts; each is re-read at resolution so a unit
      // that died in between is simply skipped (R5 partial resolution)
      let made = 0;
      for (const t of ctx.targets) {
        if (!isEntityTarget(t)) continue;
        const host = g.entity(t.id);
        if (host) { g.augmentWraith(host, ctx.controller); made++; }
      }
      if (!made) {
        g.ev('info', ctx.targets.length
          ? "Blight's End: every targeted unit has left play — no Wraiths."
          : "Blight's End: X = 0 — no target, no Wraiths.");
      }
    },
  },
});

// "[Battle] Discard a card: [Switch]" — gd/6 3/3 Mystic Flower Unit.
//
// The whole card is a repeatable GRAFT CAUSE: the [Switch] carries no text of
// its own, so the ability's only job is to fire the grafts hanging off it
// (composeParts joins graft parts to a graftCause ability). It is therefore
// NOT given a graftEffect — there is nothing to transfer, so the card cannot
// itself be grafted onto something else.
// R49: both halves are now real. `timing: 'battle'` is the printed [Battle]
// marker, enforced at ACTIVATION (deployment activation is refused and never
// offered); `cost: { discard: 1 }` is the printed cost, which gates the
// activation (an empty hand makes it unactivatable) and is chosen and paid in
// the cast window, before the item reaches the stack — so the grafts riding on
// it can no longer resolve off an unpaid cost. The discard TRASHES the card
// (R40). Unbounded ([Switch], not [Switch1]) — repeatable while you keep
// discarding.
card('Cadaverous Cultivator', {
  abilities: [{
    type: 'activated', cost: { discard: 1 }, timing: 'battle', graftCause: true,
    label: '[Battle] discard a card: fire my grafts',
    effect: {
      run: (g, ctx) => {
        g.ev('info', `${ctx.sourceName}: the cost is paid — its grafts (if any) resolve.`);
      },
    },
  }],
});

// "Target unit gains poisonous until regroup.{/n}After combat, if I am in your
// bin you may remove a -1/-1 counter from a unit to recall me." — gd/1 0/0
// {Battle} Blight Spell.
//
// First sentence scripted: {Poisonous} until regroup (addTempAttr clears with
// temp stats, R11 step 3).
//
// Second sentence UNPARKED by R51: `zone: 'bin'` dispatches a trigger to a card
// SITTING IN A BIN, anchored on a detached stand-in whose controller is the
// bin's owner — so "if I am in YOUR bin" is ctx.controller throughout. The
// stand-in has id -1 and is not in play, which is exactly right: this card is
// not a unit, it is a spell card in a bin.
//
// "You MAY remove a -1/-1 counter from a unit to recall me" is a cost with a
// choice, paid at resolution via ctx.choose (the trigger is already on the
// stack by then, so R35's cast window does not apply): decline, or pick a unit
// carrying at least one -1/-1 counter. Only a NET-negative unit qualifies —
// counters cancel pairwise in this engine, so a unit on net +1 has no -1/-1
// counter to remove. Region-scoped (R12/R25).
card('Inexorable Miasma', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Inexorable Miasma: target unit gains {Poisonous} until regroup' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) {
        g.ev('info', 'Inexorable Miasma: the target is gone — nothing gains {Poisonous}.');
        return;
      }
      g.addTempAttr(t, 'Poisonous');
    },
  },
  abilities: [{
    type: 'triggered', events: ['afterCombat'], zone: 'bin',
    label: 'remove a -1/-1 counter from a unit to recall me from your bin',
    effect: {
      run: (g, ctx) => {
        const me = g.player(ctx.controller).bin.lastIndexOf('Inexorable Miasma');
        if (me === -1) {   // left the bin before this resolved
          g.ev('info', 'Inexorable Miasma: it is no longer in the bin — nothing to recall.');
          return;
        }
        const pool = g.unitsIn(ctx.region).filter(u => u.counters < 0);
        if (!pool.length) {
          g.ev('info', 'Inexorable Miasma: no unit carries a -1/-1 counter — it stays in the bin.');
          return;
        }
        const choice = ctx.choose('recall', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Inexorable Miasma: remove a -1/-1 counter from a unit to recall it from your bin?',
          options: [
            ...pool.map(u => ({ label: `Remove a -1/-1 from ${u.card}`, value: u.id as unknown, card: u.card })),
            { label: 'Decline — leave it in the bin', value: -1 as unknown },
          ],
        }) as number;
        if (choice === -1) { g.ev('info', 'Inexorable Miasma: declined — it stays in the bin.'); return; }
        const u = g.entity(choice as EntityId);
        if (!u) { g.ev('info', 'Inexorable Miasma: the chosen unit is gone — it stays in the bin.'); return; }
        g.addCounters(u, 1);                        // net counters: +1 removes a -1/-1
        const idx = g.player(ctx.controller).bin.lastIndexOf('Inexorable Miasma');
        if (idx === -1) { g.ev('info', 'Inexorable Miasma: it left the bin — nothing is recalled.'); return; }
        g.player(ctx.controller).bin.splice(idx, 1);
        g.player(ctx.controller).hand.push('Inexorable Miasma');
        g.ev('info', `Inexorable Miasma is recalled from ${g.pname(ctx.controller)}'s bin to their hand.`);
      },
    },
  }],
});

// "[Augment] If one or more counters would be put on an enemy unit or player,
// put that many counters plus one instead." — gd/2 1/2 {Virus} Blight Slime
// Unit.
//
// UNPARKED as a real replacement (R104). It used to be two triggers on
// 'countersChanged'/'rotGained'/'debtGained' that added the "plus one" AFTER
// the printed counters had already landed, guarded by a module-level `let
// proliferating` — because the top-up was itself a counter placement and the
// trigger re-entered `addCounters`. Report #60 named those five module flags
// as the symptom; an `AmountMod` is CONSULTED rather than re-entered, so the
// flag has no job and is deleted. The counters now arrive once, in one event,
// with the right number on it.
//
// SUMMED (Caleb: "a replacement only happens once … The replacement just takes
// what would be 1 and makes it 2"), so two Slimes add two — and a Slime plus a
// Flux Resonator add one each, which is the composition rule the two families
// were split over.
//
// SAME SIGN as the counters that were put — "that many counters plus one" is
// one more of the same thing — so a -1/-1 counter on an enemy becomes two.
//
// ⚠ INTERPRETATION, unchanged: "or player" is read as ROT and DEBT, the
// expansion's two player counters (docs/08: "A counter accumulated by a
// PLAYER" for both). No other counter can be put on a player, so the clause
// would otherwise be dead text. Now that rot and debt are `AmountMod` sites the
// reading is expressed in the same three lines as the unit half rather than in
// a second trigger.
card('Proliferating Slime', {
  augmentable: true,
  amountMods: [{
    delta: (_g, self, ctx) => {
      const step = ctx.amount > 0 ? 1 : -1;
      if (ctx.kind === 'counters') {
        return ctx.unit && ctx.unit.controller !== self.controller ? step : 0;
      }
      if (ctx.kind === 'rot' || ctx.kind === 'debt') {
        return ctx.player !== undefined && ctx.player !== self.controller ? step : 0;
      }
      return 0;
    },
  }],
});

// ─────────────────────── EARTH / DARK (ed) ────────────────────────────

/** does any UNIT card in `seat`'s bin print `attr`? Reads printed data only —
 * `affects` must never call effStats (reentrancy guard). */
const binGrants = (g: E, seat: Seat, attr: Attr): boolean =>
  g.player(seat).bin.some(n => {
    const c = getCard(n);
    return (c.kind === 'unit' || c.kind === 'spellUnit') && c.attrs.includes(attr);
  });

// "[Augment] I gain all attributes of units in your bin." — ed/8 5/5 Ancient
// Primordial Horror Unit.
//
// One static PER ATTRIBUTE, because StaticMod.attrs is a fixed list while the
// bin is not: each row grants its own attribute exactly when a unit card in
// the controller's bin prints it. Live at every evaluation (R27) — binning a
// {Flying} unit lights the Omniphage up immediately. "Your bin" is the
// carrier's controller's (the HOST's when donated, statics being anchored on
// the host); "I" is the carrier itself, so each row only affects self.
card('The Omniphage', {
  augmentable: true,   // text-box [Augment] implemented as statics
  statics: ALL_ATTRS.map(attr => ({
    affects: (g: E, self: Entity, target: Entity) =>
      target.id === self.id && binGrants(g, self.controller, attr),
    attrs: [attr],
  })),
});
