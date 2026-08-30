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
 * ✔ ARBITER OF VITALITY IS A REAL REPLACEMENT NOW (R162). It used to be a pair
 *    of triggers, parked in R104's "still not replaceable" list because it is a
 *    MULTIPLIER on a life change rather than a substitution of one, and the
 *    multiplicative amount family did not exist. R157 §23 supplies both the
 *    family and its composition rule — *"always n*2*v"* — so it is one
 *    `AmountMultiplier` consulted by gainLife/loseLife before the total moves:
 *    two Arbiters quadruple (they used to triple) and a lethal loss is
 *    multiplied BEFORE the lethal check rather than after it.
 * ✔ "[Battle]" ON AN ACTIVATED ability is `ActivatedAbility.timing` now (R49),
 *    enforced at ACTIVATION: Cadaverous Cultivator is not offered during
 *    deployment and apply() refuses it there.
 *
 * ✔ DEFERRAL DRONE IS COMPLETE (R119, 2026-08-23). The last residue — "does a
 *    paid-for one-shot discount outlive its source?" — was ruled on: it does,
 *    "you paid for it". All three parts (set / read / spend) moved off the
 *    entity onto `GameState.nextPlayDiscount`, because a charge that survives
 *    the Drone needs a spend path that survives it too. See the card below and
 *    R119; its card-ledger entry is deleted.
 *
 * ✔ VENGEANCE IS LIVE (R122). This entry used to sit under PARKED — "there is
 *    no channel for 'and a sacrifice' … Inert [Augment] text; plays as a 7/9"
 *    — and that expired when R122 added the THIRD CostMod channel: an imposed
 *    bracketed SACRIFICE on card plays, which gates the opponent's cast and is
 *    paid in the cast window. See the card's own comment for the clause walk.
 *
 * ✔ BROUGH'S "EVERYTHING" IS LITERAL (R125's principle, applied 2026-08-24).
 *    The static used to be filtered to `kind === 'unit'`, which is exactly the
 *    invented qualifier the Rotspore ruling took off. Removed; see the card for
 *    what it does and does not change (nothing arithmetical, today).
 *
 * PARKED (needs engine machinery that does not exist yet):
 *  - nothing in this batch.
 *
 * UNPARKED by the R51 wave: Inexorable Miasma's second sentence ("After
 * combat, if I am in your bin …") is a `zone: 'bin'` trigger — see R51 and the
 * card's own comment.
 */
import type { Attr, Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, getCard, isEntityTarget, type EffectDef } from '../dsl.ts';
import { isEnt, isUnitCard } from './helpers.ts';

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
 * {Unaware} makes the Omniphage read at its PRINTED stats — and collapses
 * whatever it deals damage to or fights to printed as well. Bubb, Trashling
 * and Haboob came off the card ledger with it.
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
  // R268: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    statics: [{
      affects: (_g, self, target) =>
        target.kind === 'unit' && target.controller === self.controller && target.id !== self.id,
      dp: 2, dt: 2, attrs: ['Flying'],
    }],
  },
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

// "[Augment] Double all life gain and life loss. {i}(Damage causes loss of
// life.)" — lr/8 6/3 Cosmic Horror Unit.
//
// R162 UN-PARKS THE REPLACEMENT APPROXIMATION. This used to be a pair of
// triggers that dealt out a SECOND helping after the first had landed, and
// R104's own "what is still NOT replaceable" list named it: a multiplicative
// amount family did not exist, and how one would compose with the additive one
// was a ruling nobody had made. R157 §23 is that ruling, verbatim:
//
//   "quadruple it!! So always n*2*v (n is num of arbiters, v is original
//    damage/life gain value)"
//
// So it is now ONE `AmountMultiplier` (dsl.ts), consulted by E.gainLife and
// E.loseLife before the total moves. What that buys, against the three
// consequences the old approximation had to admit to:
//  - "all" is still unqualified, so BOTH players' gains and losses are
//    multiplied — the mod claims the quantity whoever is receiving it.
//  - a LETHAL loss now resolves in the right order. The multiplied number is
//    subtracted in one go and the lethal check sees it, where the trigger
//    version ended the game on the first helping and never dealt the second.
//    (Harmless for the win/loss, wrong for every life total anyone reads.)
//  - TWO ARBITERS GIVE 4x. Each declares ×2, the engine SUMS the claiming
//    factors (E.amountFactor), and 2+2 = 4. The trigger pair gave 3× because
//    each Arbiter heard only the original event.
//
// ⚠ n ≥ 3 WAS NOT SEPARATELY CONFIRMED. v × 2 × n is LINEAR in n, so three
// Arbiters sextuple; a purely multiplicative reading would give 2^n = ×8. The
// owner wrote the formula out rather than the word "double", so the formula is
// what is implemented — but he was answering about TWO, and the third has
// never been put to him.
//
// ⚠ AND ITS COMPOSITION WITH AN ADDITIVE `AmountMod` IS STILL UNRULED. R157
// §23's interim decision — multiplier AFTER the additive layer — lives in
// E.lifeAmount, not here.
//
// The parenthetical "(Damage causes loss of life.)" is why the mod claims
// 'lifeLoss' rather than damage: damage to a player already routes through
// loseLife, so claiming it here prices it once and claiming 'effectDamage' too
// would quadruple a burn spell off one Arbiter.
//
// `augmentable: true` is what keeps the card recognised as an augment now that
// the two augmentText triggers are gone — the Conduit of Pain / Proliferating
// Slime precedent for [Augment] text implemented as a continuous mod.
card('Arbiter of Vitality', {
  augmentable: true,
  // R268: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    amountMultipliers: [{
      factor: (_g, _self, ctx) =>
        (ctx.kind === 'lifeGain' || ctx.kind === 'lifeLoss' ? 2 : 1),
    }],
  },
});

// "[Augment] Cards your opponents play during battle gain '[Sacrifice a
// unit]'." — lr/13 7/9 Occult Unit. LIVE (R122): the third CostMod channel —
// an IMPOSED bracketed additional cost on card PLAYS (R59 brought mana,
// R60 life; a sacrifice is neither, and it carries a CHOICE).
//
// Clause by clause:
//  - "Cards", unqualified — units and spells alike are taxed. A spell TOKEN
//    is cast from play, not played (R59), and never reaches the play route
//    the atom rides on.
//  - "your opponents" — seats other than mine. `self` is the ANCHOR
//    (E.costModsFor), so donated as an augment the text reads from the HOST:
//    "you" is the host's controller, no extra code (Deferral Drone, R59).
//  - "play" — applying a mod is not playing (R37): purpose 'mod' is exempt.
//  - "during battle" — the battle phase only, and region-scoped like every
//    radiating mod (R12): it taxes the battle it is standing in.
// The sacrifice is the PAYER's choice (their units in the battle region,
// tokens included), it gates castability when they control none there, and it
// is paid in the cast window before the item reaches the stack. Two
// Vengeances impose two sacrifices — the channel is additive, each bracketed
// cost its own payment. Text-box [Augment], live when played normally
// (Tranquility / Stasis Sentry precedent).
card('Vengeance', {
  augmentable: true,
  // R268: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    costMods: [{
      sacrifice: (g, self, ctx) =>
        g.s.phase === 'battle' && ctx.purpose === 'play' && ctx.seat !== self.controller ? 1 : 0,
    }],
  },
});

// ─────────────────────── LIGHT / EARTH (le) ───────────────────────────

// "[Augment] Everything is balanced. {i}(The power and defense of balanced
// units are equal to the greater of the two.)" — le/4 0/4 Cosmic Unit.
//
// "Everything" is unowned and unqualified: EVERYTHING in the region, both
// players', the carrier included. {Balanced} is a layer-4 attribute (R19) —
// granting it through a static lands in ownAttrs, which statLayerAttrs reads,
// so the max-of-the-two rewrite happens in the right layer for free.
//
// The predicate used to read `target.kind === 'unit'`, which is the same
// invented qualifier R125 took off Rotspore Herald: `StaticMod.affects` is
// typed over an `Entity`, units were the case in mind, and the shape of the
// mechanism got promoted into a rule about the card. It is off, for the same
// reason — the printed text has nothing to hang it on.
//
// ⚠ HONEST NOTE ON WHAT THAT CHANGES: nothing arithmetical, today. The three
// spell tokens in the pool (Fireball / Poison / Crystal) all print 3/3, and
// max(3,3) is 3 — {Balanced} is a no-op on them, and a mod entity's stats are
// read by nothing. So this is the GRANT being literal (a Fireball standing
// under a Brough really does wear {Balanced}: E.ownAttrs and the text box's
// projections both say so), not a stat change nobody was getting. It is worth
// having anyway: an unequal-statted spell token, or any future reader of a
// non-unit's stats, gets the printed answer instead of the mechanism's.
//
// Unlike Rotspore Herald, this sentence needs only ONE channel: R125's second
// mechanism (`effectAttrs`) exists to attribute a resolving SPELL that has no
// entity, and a spell has no power or defense for "balanced" to act on —
// `grantedAttrs` is read only by dealEffectDamageAll's source-attribute set
// ({Deadly}/{Poisonous}/{Resonant}/{Piercing}/{Unaware}). Checked, not assumed.
card('Brough', {
  augmentable: true,   // text-box [Augment] implemented as a static (see below)
  // R268: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    statics: [{
      affects: () => true,
      attrs: ['Balanced'],
    }],
  },
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
  // R268: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    statics: [{
      affects: (_g, _self, target) => target.kind === 'unit',
      dp: (g, self) => (Math.abs(g.player(self.controller).life % 2) === 1 ? -2 : 2),
      dt: 0,
    }],
  },
});

// "[Augment][once] Gain 4 debt: The next card you play this turn costs [3]
// less." — lm/2 2/2 Horror Unit.
//
// FULLY BUILT 2026-08-23 (R119). The card is three lines of card code now
// because all three moving parts live in the engine, and that is the ruling
// rather than a tidy-up:
//
//   R119 (owner, 2026-08-23): the charge SURVIVES the Drone. "You paid for
//   it." The ability has RESOLVED and the 4 debt is gone, so sacrificing the
//   Drone in response must not evaporate a discount the player already bought.
//
// The first build (2026-08-22) put the charge on `Entity.budgets` and the
// discount in a `CostMod`, which meant BOTH halves radiated from the Drone:
// kill it and the charge vanished, which is exactly what R119 rejects. Moving
// only the charge would have been worse — the SPEND half was a bookkeeping
// trigger on the same card, so a dead Drone would have left a charge nothing
// could ever consume. So all three parts moved together:
//
//   · SET   — `E.grantNextPlayDiscount(seat, 3)`, writing `GameState
//             .nextPlayDiscount[seat]`. `ctx.controller` is the ITEM's
//             controller, which is the Drone's controller in play and the
//             HOST's controller when the text is donated by an augment — so
//             R59's "'you' is the host's controller" still falls out for free.
//   · READ  — one line in `E.manaToPlay`, after the CostMod fold and before
//             the clamp at zero, so a [1] card goes free rather than negative.
//             Guarded by `purpose === 'play'`: R37/R59, applying a mod is not
//             playing, so an augment/graft/Virus pays printed price and burns
//             nothing.
//   · SPEND — `E.spendNextPlayDiscount(seat)` at the two emit sites a play
//             already fires from: 'spellPlayed' in commitItem (skipping a
//             spell TOKEN, which R59 says is cast from play rather than
//             played) and 'spawned' in spawnUnit (skipping a unit with no
//             `from`, i.e. CREATED rather than played). Both fire after
//             payment, so the charge is standing while the bill is computed
//             and gone by the next play. Deliberately NOT in payCard: a free
//             prophecy release (R111) never reaches payCard and still spends
//             the charge, which is the behaviour these sites already had.
//   · CLEAR — `E.startTurn`, beside the `Entity.budgets` wipe that used to
//             give "this turn" for free.
//
// NAMED CONSEQUENCE (R119): a CostMod is region-scoped (R12) and a per-seat
// charge is not, so a seat acting in two regions in one turn now gets the
// discount wherever they play. That is the more correct reading — "the next
// card YOU play" is player-scoped, and R12 fences information crossing
// regions, not a player's own resolved bookkeeping.

card('Deferral Drone', {
  augmentText: [{
    // [once] = `bounded`, R9: one activation per turn per CARD.
    type: 'activated', bounded: true, cost: { debt: 4 },
    label: 'gain 4 debt: the next card you play this turn costs [3] less',
    effect: {
      run: (g, ctx) => {
        g.grantNextPlayDiscount(ctx.controller, 3);
        g.ev('info',
          `${ctx.sourceName}: the next card ${g.pname(ctx.controller)} plays this turn costs [3] less.`,
          { seat: ctx.controller });
      },
    },
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
        const name = g.removeFromBin(ctx.controller, t.binCard.index, 'recalled');   // R124
        if (name !== undefined) {
          g.toHand(ctx.controller, name, 'bin');   // R179
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
        g.removeFromBin(ctx.controller, idx, 'recalled');   // R124
        g.toHand(ctx.controller, 'Inexorable Miasma', 'bin');   // R179
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
  // R268: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
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
  },
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
  // R268: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    statics: ALL_ATTRS.map(attr => ({
      affects: (g: E, self: Entity, target: Entity) =>
        target.id === self.id && binGrants(g, self.controller, attr),
      attrs: [attr],
    })),
  },
});
