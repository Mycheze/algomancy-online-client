/* Light & Dark expansion — batch light-a (18 cards).
 *
 * Behaviour only; printed data comes from printed.json (never hand-copied).
 * Spec for the expansion's new mechanics: docs/08-light-and-dark.md,
 * rulings R38-R48 in docs/digital-rules.md.
 *
 * Cards in this batch:
 *   Arbiter of Armistice
 *   Blob of the Dark Order
 *   Colony of the Interworld
 *   Divine Foresight
 *   Flesh Tithe
 *   Glararr
 *   Greed Angel
 *   Hooba-God
 *   Keeper of Tithes
 *   Lifebound Seer
 *   Penance
 *   Prismatic Observer
 *   Retribution Thing
 *   Shard Sprite
 *   Stalwart Sentinel
 *   The Everywhere
 *   Triskaidekaphage
 *   Vroot
 *
 * Mechanics touched: cache (R41), debt (R39), glimpse (R45), prophecy
 * (R42-R44). Graft markers: [Switch] = unbounded graft, [Switch1] = bounded
 * (once per turn, R9). R37: applying a mod is NOT playing a card.
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - LIFE AS A COST (R49). Blob of the Dark Order and Glararr now declare a
 *    real ACTIVATION cost ({ life: n }): it gates the activation and is paid
 *    before the ability reaches the stack. Flesh Tithe's "[Pay X life]" is a
 *    real CAST COST too — `{ kind: 'payLife', n: 'X' }`, paid a point at a time
 *    at cast, and the amount paid IS the spell's X. It obeys the same R49 ruling either way: each point is
 *    re-checked, so a life cost you cannot survive is never payable.
 *  - "MY COLUMN DEALS COMBAT DAMAGE" (Vroot) is read off the combat events: a
 *    'damage' event with no `source` tag against the directly opposing column,
 *    or the aggregated combat 'lifeLost' with my column connecting — and,
 *    since R117, only in a SUB-STEP MY OWN COLUMN STRIKES IN
 *    (E.strikesInCurrentSubStep; R157 §5 made that "a", not "the", because a
 *    {Swift}{Sluggish} column strikes in two). A column that both kills
 *    blockers and pierces through fires once per damage instance.
 *    R157 §4 (owner, 2026-08-25) made this ONE shared predicate,
 *    E.columnDealtCombatDamage, over the four cards printing the clause;
 *    Vroot's own reading — the LIVE COLUMN's total power, not the anchor's —
 *    was already the right one and is now the only one. What is STILL
 *    approximate is R117's own residue: face damage arrives as one aggregated
 *    `lifeLost` per seat per sub-step, so two of my columns connecting in the
 *    SAME sub-step are indistinguishable here.
 *
 *  - (THE EVERYWHERE is NO LONGER approximated, 2026-08-23. This entry used to
 *    describe an until-regroup silence applied once at naming time, and named
 *    the two missing pieces itself: "a STRING on Entity to hold the named card
 *    (budgets are numeric-only) plus a StaticMod matching on a card NAME rather
 *    than an entity id". The string is `Entity.named`; the StaticMod is the one
 *    on the card. Everything else the note asked for already existed — R62's
 *    continuous `StaticMod.suppressAbilities`, read through E.suppressionOf /
 *    E.abilitiesSuppressed, whose `staticsFor` walk is scoped to
 *    `anchor.region === target.region`. That scope IS "(as long as I am in
 *    their region)", evaluated live, so the card now switches on when it
 *    ATTACKS INTO the named unit's region and off again when it leaves —
 *    without ever reaching across regions, which is the rule Caleb said would
 *    never be violated. See the card for the full note.)
 *
 * UNPARKED by the R49/R50 engine wave:
 *  - Stalwart Sentinel reads the play events' new `data.from` zone instead of
 *    scanning this apply() call's log (which was unsound — a cast that
 *    suspends on targets fires 'spellPlayed' in a LATER apply() call).
 *  - Retribution Thing counts life lost PLUS life gained, off the new
 *    `lifeGained:<seat>` battle ledger.
 *  - Keeper of Tithes hears the new 'endOfHaste' event.
 *
 * PARKED (needs primitives that do not exist; each registers crash-free):
 *  - (none left in this batch — The Everywhere was the last one, and R91
 *    unparked it to the approximation described above.)
 */
import type { EngineEvent, Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { allCardNames, card, getCard, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt, eraseFromPlay } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/* A local `payLife(g, seat, n, why)` helper used to sit here, documented as
 * "pay `n` life as a COST at resolution (header note)". It was DEAD — zero
 * call sites — and had been since all three life-cost cards in this batch
 * moved to real R49/R64 `castCost: { kind: 'payLife' }` costs, which the file
 * header records. `tsconfig` has `strict` but not `noUnusedLocals`, which is
 * why it survived. Deleted by R174; `E.canPayLife` / `E.payActivationCost` are
 * the live route and enforce R49's "only while you have MORE than N life". */

/** R25: "each opponent" is the seats PRESENT IN THE EFFECT'S REGION, not every
 * seat at the table. Vroot only ever fires on combat damage, so its region
 * always holds both players in 1v1 — but the two readings are not the same
 * clause, and every other batch in the expansion uses this one. */
const opponentsOf = (g: E, region: number, seat: Seat): Seat[] =>
  g.s.regions[region]!.presentSeats.filter(s => s !== seat);

/**
 * "My column deals combat damage" (header approximation): the shared engine
 * predicate, E.columnDealtCombatDamage, on the two channels this UNQUALIFIED
 * text is entitled to hear — 'units' (a combat 'damage' event against the
 * column directly opposing mine) and 'face' (the aggregated combat 'lifeLost'
 * where my column connects). No 'poison': Vroot is not {Poisonous} and no
 * column it stands in emits -1/-1 counters in place of its damage unless a
 * {Poisonous} ally is in it, in which case that ally's channel is that ally's
 * business, not this text's. Zephyrzoa and Eldritch Dreamtender print "to an
 * opponent" and take 'face' alone; Blightmound adds 'poison'.
 *
 * R117 (owner, 2026-08-23): the clause fires in the sub-step MY OWN COLUMN
 * strikes in — and, R157 §5, in EVERY such sub-step, so a {Swift}{Sluggish}
 * column pays out twice because it really does strike twice.
 *
 * R157 §4 (owner, 2026-08-25): the power gate is the LIVE COLUMN's total, not
 * the anchor's own — "0 power units do no damage. But the other thing in the
 * column can still contribute to the shared column power." Vroot's own reading
 * was already this one; it is now the only one in the pool.
 */
function myColumnDealtCombatDamage(g: E, self: Entity, ev: EngineEvent): boolean {
  return g.columnDealtCombatDamage(self, ev, ['units', 'face']);
}

/**
 * Did the play event `ev` come from somewhere OTHER than the player's hand?
 * R49: both play events now carry `data.from` — the zone the card was played
 * out of, stamped on the StackItem by doPlayCard / doPlayCached. A play event
 * with no `from` at all is not a played card (an effect-created token), so it
 * is not "played from elsewhere" either.
 *
 * (This replaces an apply()-local LOG SCAN, which was unsound: a cast that
 * suspends on its targets fires 'spellPlayed' in a LATER apply() call, by
 * which time the cache-release line is in a previous call's event list.)
 */
function playedFromElsewhere(ev: EngineEvent): boolean {
  const from = ev.data?.['from'] as string | undefined;
  return from !== undefined && from !== 'hand';
}

// ───────────────────────────── the cards ──────────────────────────────

// "Cards played during battle gain [Pay 2 life]." — ll/2 2/2 {Haste}
// {Switch} Holy Unit. R60: the life half of the cost-modifier layer (R59
// brought the mana half in for Tranquility). Scoped exactly as printed:
//  · "cards", not "spells" — a unit played during battle is taxed too;
//  · "played", so applying a mod is exempt (R37 — purpose 'mod');
//  · "during battle", so the haste step and deployment are free;
//  · everyone's cards, not just the opponent's — including my own.
// Region-scoped like every other cost mod (R12): the Arbiter taxes the
// battle it is standing in, not one happening elsewhere.
//
// ✔ TRANSCRIPTION: CLOSED by R157 §25 (owner, 2026-08-25, verbatim): *"That's
// an error on your part. The card does not have a [Switch] thing. It just adds
// an additional cost to all spells cast in battle to pay 2 life."* This note
// used to read "⚠ still open, and NOT a park: the type line carries a bare
// {Switch} — the only card in the whole pool that does". BOTH halves are now
// false: the ruling settled it, and the DATA no longer carries it —
// `printed.json` gives `type: "{Haste} Holy Unit"` and zero cards pool-wide
// have "Switch" in `type`. The correction lives in
// `engine/scripts/extract-printed.mjs`'s `TYPE_OVERRIDES` (which fails loudly
// if the upstream oracle ever changes), because the UPSTREAM
// `AlgomancyCards-OracleText.json` still says "{Haste} {Switch} Holy Unit".
// So the divergence is deliberate and traceable, and no graftEffect was ever
// invented for it. Correctly, so: nothing reads a type-line {Switch} —
// graftability is `CardDef.graftEffect`.
card('Arbiter of Armistice', {
  costMods: [{
    life: (g, _self, ctx) =>
      (g.s.phase === 'battle' && ctx.purpose === 'play') ? 2 : 0,
  }],
});

// "[Augment] Pay 1 life: I gain piercing until regroup." — l/3 3/4 Horror
// Unit. An ACTIVATED ability inside the [Augment] text box: usable on the card
// itself when played normally (via 'augment') and on a host when donated
// (via { mod }) — "I" is then the host. R49: the 1 life is a real ACTIVATION
// cost now — it gates the activation (you may not activate at 1 life) and is
// paid before the ability reaches the stack, so it cannot be responded to.
card('Blob of the Dark Order', {
  augmentText: [{
    type: 'activated', cost: { life: 1 },
    label: 'pay 1 life: I gain {Piercing} until regroup',
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) return;
        const live = g.entity(self.id);
        if (live) g.addTempAttr(live, 'Piercing');
      },
    },
  }],
});

// "When you gain or lose life during battle, [Switch1] Put three +1/+1
// counters on me." — ll/3 2/2 Spirit Unit. Both life channels, either
// direction, but only YOUR life and only during battle (R1: the condition is
// checked at event time). [Switch1] = bounded (R9, one firing per turn however
// often life moves) and a graft cause.
const colonyCounters: EffectDef = {
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    if (self) g.addCounters(self, 3);
  },
};
card('Colony of the Interworld', {
  abilities: [{
    type: 'triggered', events: ['lifeGained', 'lifeLost'], bounded: true, graftCause: true,
    label: 'put three +1/+1 counters on me',
    when: (g, self, ev) => g.s.phase === 'battle' && ev.data?.['seat'] === self.controller,
    effect: colonyCounters,
  }],
  graftEffect: { bounded: true, effect: colonyCounters },
});

// "Look at target opponent's hand and choose a card from it. They cache that
// card. It gains 'Prophecy — Three Turns Pass'." — ll/1 {Battle} Cosmic Spell.
// Target is a PLAYER, and not you — the 'opponent' kind says exactly that, so
// no unit is ever on the menu. The card leaves their hand for THEIR cache
// with a granted prophecy (R42/R43: normalizeProphecy handles the wording, and
// the three-turn clock starts counting forward from now). They are the ones
// who may eventually release it — this is a delay, not a steal.
card('Divine Foresight', {
  spellEffect: {
    // R64: "target opponent" — a player, and not you
    targets: { what: 'opponent', prompt: "Divine Foresight: look at target opponent's hand" },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('player' in (t as object))) return;
      const who = (t as { player: Seat }).player;
      if (who === ctx.controller) {
        g.ev('info', 'Divine Foresight: the target must be an opponent — no effect.');
        return;
      }
      const hand = g.player(who).hand;
      // "LOOK AT target opponent's hand" — YOU look. The hand is not revealed
      // to the table, so the line that names the cards is tagged `privateTo`
      // the looker (server/view.ts::visibleToSeat drops it for everyone else);
      // E.revealHandTo below writes the public "X looks at Y's hand" line and
      // stores the look in `seenHand[viewer]`, and is deliberately careful NOT
      // to name the cards for exactly this reason. Untagged, this line put the
      // whole opposing hand in the shared log.
      g.ev('info', `Divine Foresight reveals ${g.pname(who)}'s hand: ${hand.join(', ') || '(empty)'}.`,
        { privateTo: ctx.controller });
      g.revealHandTo(ctx.controller, who);
      if (!hand.length) return;
      const pick = ctx.choose('foresee', {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: `Divine Foresight: ${g.pname(who)} caches which card? (it gains Prophecy — Three Turns Pass)`,
        options: hand.map((name, i) => ({ label: name, value: i, card: name })),
      }) as number;
      if (hand[pick] === undefined) return;
      g.cacheFromHand(who, pick, { prophecy: 'Three Turns Pass' });
    },
  },
});

// "[Switch1] [Pay X life], create an X/X unit." — l/4 Horror Spell (deploy).
// The leading [Switch1] makes the whole text a bounded graft as well as the
// spell's own effect (Arcane Echo's shape). R64: the bracket is an ADDITIONAL
// COST — the life is paid at cast, a point at a time, and X is however much
// was paid. R49 is re-asked before each point, so the cost can never be lethal
// and no cap has to be computed up front.
const fleshTithe: EffectDef = {
  castCost: { kind: 'payLife', n: 'X' },
  xZeroWarning: 'X = 0 creates no unit',   // R74
  creates: ['Unit Token'],
  run: (g, ctx) => {
    const x = ctx.x ?? 0;
    if (x <= 0) { g.ev('info', 'Flesh Tithe: X = 0 — no life paid, no unit.'); return; }
    // R115: a created unit arrives where its SOURCE is — during deployment
    // that IS home; grafted onto a battle cause it is the battle region
    g.spawnUnit(ctx.controller, 'Unit Token', ctx.region,
      { token: true, tokenStats: [x, x] });
  },
};
card('Flesh Tithe', {
  spellEffect: fleshTithe,
  graftEffect: { bounded: true, effect: fleshTithe },
});

// "Pay 9 life: [Switch1] Erase target unit." — l/5 4/5 Horror Unit. An
// activated ability with a life cost and a bounded graft cause. Erase = out of
// the game entirely: no bin, no died/despawned triggers, mods erased with it.
// R49: the 9 life is a real ACTIVATION cost — it GATES the activation (at 9
// life or less the ability is not offered and apply() refuses it) and is paid
// as the ability is activated, before it reaches the stack.
//
// The [Switch1] is both a graft CAUSE and the card's transferable
// `graftEffect` (the Sprouter pattern), which was missing. As a RIDER the 9
// life rides along as a bracketed cast cost (R35/R49): a grafted rider pays in
// the cast window and may be declined, so the erase can never happen unpaid.
const glararrErase = (castCost?: { kind: 'payLife'; n: number }): EffectDef => ({
  targets: { what: 'unit', prompt: 'Glararr: pay 9 life — erase target unit' },
  ...(castCost ? { castCost } : {}),
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t) || !g.entity(t.id)) return;
    const live = g.entity(t.id);
    if (live) eraseFromPlay(g, live);
  },
});
card('Glararr', {
  abilities: [{
    // on the card itself the 9 life is the ACTIVATION cost, so the effect
    // carries no castCost — it would otherwise be charged twice
    type: 'activated', cost: { life: 9 }, bounded: true, graftCause: true,
    label: 'pay 9 life: erase target unit',
    effect: glararrErase(),
  }],
  graftEffect: { bounded: true, effect: glararrErase({ kind: 'payLife', n: 9 }) },
});

// "(Only flying units can block flying units.) When I spawn, you gain 3 debt
// and draw a card." — ll/2 3/4 {Flying} Horror Unit. R39: debt is paid
// automatically at the very end of your next resource step, 1 mana each, and
// the remainder carries over — gaining it costs nothing right now, which is
// exactly why the card is a 3/4 flier plus a card for [2].
card('Greed Angel', {
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true,
    label: 'you gain 3 debt and draw a card',
    effect: {
      run: (g, ctx) => {
        g.gainDebt(ctx.controller, 3);
        g.draw(ctx.controller, 1);
      },
    },
  }],
});

// "When I attack or block, create a token that's a copy of me in my
// formation." — lll/8 2/2 Hooba God Unit. The copy is a unit token; "in my
// formation" is R75 — the controller chooses the slot at resolution rather
// than the copy silently taking my own column's back slot (and getting nothing
// at all when that slot was full). The copy is created after attackers/blockers
// are declared, so it never re-triggers this on its own.
//
// R118: "a copy of ME" reads the FACE, not `Entity.card` — the ruling names
// this card by name ('"Create a copy of me" (Echo of Despair, Hooba-God,
// Swarmling) reads the FACE, and carries no counters and no mods'). A
// Hooba-God wearing an identity face (Apex Prime, Borrower of Forms) IS that
// card for every rules purpose, so the token it creates is that card too; the
// hardcoded name predated the copy layer. `E.nameOf` is the layer's public
// read and answers 'Hooba-God' whenever nothing has copied it, so the ordinary
// case is byte for byte what it was. `creates` stays the printed declaration —
// it is the UI/conformance list of what this card normally makes.
card('Hooba-God', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    label: "create a token that's a copy of me in my formation",
    effect: {
      creates: ['Hooba-God'],
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) { g.ev('info', 'Hooba-God: it is no longer in play — no copy is created.'); return; }
        // R225: IN PLAY was the wrong predicate. "In my formation" names the
        // grid I am standing in, and a Hooba-God that is in the region beside
        // the line (R172 mid-battle control theft) is in play and in no
        // formation — it named one anyway and the copy joined the SEAT's grid.
        if (!g.columnOf(self.id)) {
          g.ev('info', 'Hooba-God: it is not in a formation — no copy is created.');
          return;
        }
        const me = g.nameOf(self);                 // R118 layer 0: what I AM
        const copy = g.spawnUnit(ctx.controller, me, self.region, { token: true });
        g.placeInFormation(copy, ctx, { key: 'hoobaGodSlot', source: 'Hooba-God', sourceId: self.id });
      },
    },
  }],
});

// "[Augment] At the end of [Haste], if X is not 0, create an X/X unit, where X
// is the number of expended resources you have." — l/5 3/3 Horror Unit.
// R50: the haste step now ends with an 'endOfHaste' event fired inside a
// settle() window, so this is an ordinary triggered ability. Text-box
// [Augment], so "you" is the HOLDER's controller — the host when donated.
// R1/R27: X is counted at RESOLUTION, off the live resource list; a resource
// spent DURING the haste step is expended by then and counts, which is the
// whole point of the card.
card('Keeper of Tithes', {
  augmentText: [{
    type: 'triggered', events: ['endOfHaste'],
    label: 'at the end of [Haste], create an X/X unit for your expended resources',
    effect: {
      creates: ['Unit Token'],
      run: (g, ctx) => {
        const x = g.player(ctx.controller).resources.filter(r => r.state === 'expended').length;
        if (x <= 0) { g.ev('info', 'Keeper of Tithes: no expended resources — X is 0, no unit.'); return; }
        // R115: a created unit arrives where its SOURCE is (ctx.region)
        g.spawnUnit(ctx.controller, 'Unit Token', ctx.region,
          { token: true, tokenStats: [x, x] });
      },
    },
  }],
});

// "When I attack or block, [Switch1] Glimpse 2." — l/2 2/1 Spirit Unit.
// R45: glimpse reveals the top 2, caches ONE of the glimpser's choice and
// recycles the rest to the bottom of the deck; the cached card is playable
// until end of turn, ignoring affinity but still paying its mana and obeying
// its timing. E.glimpse() raises the choose-one decision itself.
// [Switch1] = bounded (R9) and a graft cause.
const seerGlimpse: EffectDef = {
  run: (g, ctx) => { g.glimpse(ctx.controller, 2); },
};
card('Lifebound Seer', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    bounded: true, graftCause: true,
    label: 'Glimpse 2',
    effect: seerGlimpse,
  }],
  graftEffect: { bounded: true, effect: seerGlimpse },
});

// "Any number of target players each lose 1 life. Draw a card." — l/1
// {Battle} Nature Spell. "Any number" in 1v1 is up to both players, so
// count 2 / min 0 — and min 0 genuinely means "up to", so the draw still
// happens when no player is targeted at all. R64: the kind is 'player', which
// offers the present seats and nothing else — 'any' let a unit fill one of the
// two slots, and that slot then lost no life.
card('Penance', {
  spellEffect: {
    targets: { what: 'player', prompt: 'Penance: any number of target players each lose 1 life', count: 2, min: 0 },
    run: (g, ctx) => {
      for (const t of ctx.targets) {
        if (!('player' in t)) continue;                 // narrowing; the kind guarantees it
        g.loseLife(t.player, 1, 'Penance');
      }
      g.draw(ctx.controller, 1);
    },
  },
});

// "Sacrifice me: [Switch1] Recall up to one target cached card. You gain 3
// life." — l/1 3/1 Cosmic Unit. R41: the cache is PUBLIC, so BOTH caches are
// legal targets — the card exists to answer an opponent's nearly-fulfilled
// prophecy (Caleb 2025-12-06). "Recall" puts the card in its owner's HAND, so
// the entry (and any prophecy stamped on it) is gone. "Up to one" is min 0:
// with no target — or none left at resolution — the 3 life still happens.
//
// The [Switch1] does two jobs, as everywhere else in the pool: it makes the
// ability a bounded graft CAUSE *and* makes the marked clause the card's
// transferable `graftEffect` (the Sprouter pattern — "Sacrifice me: [Switch]
// …" declares both). It was missing the second half, which made this one of
// only two [Switch]-printed cards in the whole pool that could not be grafted.
const observerRecall: EffectDef = {
  targets: { what: 'cachedCard', prompt: 'Prismatic Observer: recall up to one target cached card', count: 1, min: 0 },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (t && 'cached' in (t as object)) {
      const { seat, uid } = (t as { cached: { seat: Seat; uid: number } }).cached;
      const i = g.cacheIndexOf(seat, uid);
      const cc = i === -1 ? undefined : g.uncache(seat, i);
      if (cc) {
        g.toHand(seat, cc.card, 'cache');   // R179
        g.ev('info', `${cc.card} is recalled from ${g.pname(seat)}'s cache to their hand.`);
      }
    }
    g.gainLife(ctx.controller, 3, 'Prismatic Observer');
  },
};
card('Prismatic Observer', {
  abilities: [{
    type: 'activated', cost: { sacrificeSelf: true }, bounded: true, graftCause: true,
    label: 'recall up to one target cached card; you gain 3 life',
    effect: observerRecall,
  }],
  graftEffect: { bounded: true, effect: observerRecall },
});

// "I deal X damage to target unit, where X is the life you've [lost or gained]
// in this battle." — l/1 {Battle} Nature Spell.
//
// R157 §21 / R161 — THE BRACKET IS A MODE, and it is the GENERAL rule about
// bracketed text, not this card's answer. Owner, 2026-08-25, verbatim: *"All
// text on cards that's in [square brackets] like that is either an additional
// cost or a modal choice. The additional cost must be paid in order to put it
// on the stack and the modal choice (happening on this card) must be chosen
// when putting it on the stack."*
//
// This used to read X as lost PLUS gained — the sum — on the ⚠ TRANSCRIPTION
// note that "[lost or gained]" is bracketed like a symbol but is not one. The
// bracket is exactly what makes it a choice: you name the ledger in the cast
// window and X reads ONLY that one. It is Siphon Life's shape ("[gains or
// loses]", R57) card for card, and for the same reason — an opponent
// responding to a spell whose X is "one of these two numbers, decided later"
// is responding to an undeclared effect (97-mode-conformance).
//
// The two ledgers are the engine's own per-battle counters: `lifeLost:<seat>`
// from E.loseLife and, since R49, `lifeGained:<seat>` from E.gainLife; both
// reset each battle phase (R14). R1: the mode is fixed at cast, the AMOUNT is
// still read at resolution, so a mode chosen while the ledger said 3 deals
// whatever that ledger says when it resolves.
//
// A ledger that is empty is not an illegal choice — it is X = 0, which the
// pool treats as a legal pointless cast everywhere else (R157 §22). Both
// options are therefore always offered; only a cast with NO battle behind it
// (both ledgers 0) has nothing to distinguish them, and that is a real cast
// too, so the question is still asked rather than silently auto-picked.
card('Retribution Thing', {
  spellEffect: {
    targets: { what: 'unit', prompt: "Retribution Thing: deal damage equal to the life you've lost or gained this battle" },
    modes: {
      key: 'ledger',
      prompt: (g, item) => {
        const r = item.region;
        return 'Retribution Thing: is X the life you have LOST this battle '
          + `(${g.battleCounter(r, `lifeLost:${item.controller}`)}) or GAINED `
          + `(${g.battleCounter(r, `lifeGained:${item.controller}`)})?`;
      },
      // R284 `half`: printed "[lost or gained]"
      options: (g, item) => [
        { label: `Lost (${g.battleCounter(item.region, `lifeLost:${item.controller}`)})`, value: 'lost', half: 0 },
        { label: `Gained (${g.battleCounter(item.region, `lifeGained:${item.controller}`)})`, value: 'gained', half: 1 },
      ],
    },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) return;
      const which = ctx.mode === 'gained' ? 'lifeGained' : 'lifeLost';   // R57: declared at cast
      const x = g.battleCounter(ctx.region, `${which}:${ctx.controller}`);
      if (x <= 0) {
        g.ev('info', `Retribution Thing: you have ${ctx.mode === 'gained' ? 'gained' : 'lost'} `
          + 'no life this battle — X is 0.');
        return;
      }
      g.dealEffectDamage(ctx, t, x);
    },
  },
  // playtest #5 / #85 UI badge: X is now one of TWO numbers and the player
  // picks which as they cast, so the badge has to show both — a single number
  // could only be one of them or a sum nobody can choose.
  xPreviewRows: (g, seat, region) => [
    { label: 'lost', x: g.battleCounter(region, `lifeLost:${seat}`) },
    { label: 'gained', x: g.battleCounter(region, `lifeGained:${seat}`) },
  ],
});

// "When I spawn, [Switch1] You gain 3 life." — l/1 2/1 {Battle} Friend Unit.
// A battle-timed 2/1 that pays for itself; [Switch1] = bounded (R9) and a
// graft cause, so grafts hung on it ride the spawn.
const sprintLife: EffectDef = {
  run: (g, ctx) => { g.gainLife(ctx.controller, 3, 'Shard Sprite'); },
};
card('Shard Sprite', {
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true, bounded: true, graftCause: true,
    label: 'you gain 3 life',
    effect: sprintLife,
  }],
  graftEffect: { bounded: true, effect: sprintLife },
});

// "[Augment][once] When you play a unit or spell from anywhere other than your
// hand, put two +1/+1 counters on me." — l/1 1/1 Nature Unit. Text-box
// [Augment]: live when played normally, donated on augment ("me" = the host,
// "you" = the host's controller). R37: applying a mod is NOT playing a card, so
// grafting or augmenting out of the cache deliberately does not feed this.
// R49: the play events carry the source ZONE (`data.from`), so this is an
// exact read rather than the old log scan. A unit play is heard on 'spawned'
// (its own spawn, never a token), everything else on 'spellPlayed' — so a
// spell unit is counted exactly once.
//
// ERRATA 2026-09-21 (algomancer.cc revision v2, read off the new scan): the
// printed text gained `[once]` and narrowed "a card" to "a unit or spell". The
// second half was already what this scripted — the kind/token checks below are
// exactly "a unit or spell", so only the bound is new.
card('Stalwart Sentinel', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed', 'spawned'], bounded: true,   // [once]
    label: 'put two +1/+1 counters on me',
    when: (g, self, ev) => {
      if (ev.data?.['seat'] !== self.controller) return false;
      const name = ev.data?.['card'] as string | undefined;
      if (!name) return false;
      if (ev.type === 'spawned') {
        if (getCard(name).kind !== 'unit') return false;      // spellUnits are heard on 'spellPlayed'
        const u = g.entity(ev.data?.['unit'] as EntityId);
        if (!u || u.token) return false;                      // created tokens are not played cards
      }
      return playedFromElsewhere(ev);
    },
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (self) g.addCounters(self, 2);
      },
    },
  }],
});

// "[Augment] During [Haste] name a card. My last named card loses all
// abilities. (As long as I am in their region.)" — l/4 3/3 {Haste} Spirit
// Unit.
//
// R91 — UNPARKED, as an approximation (see the batch header). The park note
// said "a 'name a card' PLAYER ACTION. That is the only thing left", and that
// was a stale claim about the engine on the day it was written: `ctx.choose`
// takes an arbitrary option list, and `DecisionOption.card` exists precisely so
// the client renders a real card scan instead of a text label (types.ts: "when
// the option IS a card (hand looks, deck tops, bin picks), its name — the
// client renders the real scan"). Naming is a Decision, and R50's 'endOfHaste'
// fires inside a settle() window that is allowed to raise one — the same seam
// Keeper of Tithes above uses for its end-of-[Haste] trigger.
//
// WHAT IS EXACT: the naming happens once per haste step, it is mandatory, it is
// made by the HOLDER's controller (text-box [Augment], so "I" is the host when
// this is donated), it hits every copy of the named card rather than one unit
// ("my last named CARD"), it is REGION-SCOPED, and "loses all abilities" is
// R62's suppression layer — the same one Suppression Field and Monke use.
//
// The region scoping is not a choice. Caleb, rules-questions, twice and
// emphatically:
//   "if you take away anything from the rules, it is: If you have a question
//    about wheither something can be done with units across regions, the
//    answer is no. …the only exception is attacking into other regions"
//   "the single rule we'll never violate is 'nothing can send information
//    across regions'"
// So the silence reaches only copies standing in MY region.
//
// THE DURATION IS CONTINUOUS, and that clause is what gives the card its teeth.
// This used to be the batch's last approximation: the silence was an
// until-regroup E.suppress applied ONCE, at naming time, which mattered far
// more than the phrase "until regroup" suggests. At the end of the haste step
// every unit is still standing at home, so my region holds only my own side —
// a one-shot stamped then could reach nothing but allies. The printed card
// reaches an ENEMY because it ATTACKS INTO their region later in the same turn,
// and the effect switches on at that moment.
//
// Both halves it was waiting on are below, and neither needed new machinery:
//
//   · `Entity.named` (types.ts) is the STRING the old note asked for, because
//     `Entity.budgets` is numeric-only. It is a memory — "my LAST named card" —
//     so regroup's R11 step-3 sweep deliberately does NOT clear it. A later
//     naming overwrites it, which is exactly what "last" means.
//   · the `statics` entry is R62's CONTINUOUS half (`StaticMod.suppressAbilities`,
//     read through E.suppressionOf / E.abilitiesSuppressed), matching on the
//     remembered card NAME instead of an entity id. Nothing about a
//     name-matching static needed engine work: `affects(g, self, target)`
//     already receives the target Entity.
//
// And the region clause is FREE. `staticsFor` walks anchors with
// `anchor.region === target.region` and reads augment-donated statics from
// their host — so "(As long as I am in their region.)" is that existing scope,
// re-asked live every time anything reads the target's abilities, and the
// [Augment] donation case falls out with no extra code (the Transmogrifant
// shape). Nothing reaches across regions, which is the rule Caleb said would
// never be violated; the card simply carries itself into their region.
//
// The naming is still a trigger, because naming is an ACTION taken at a time
// ("During [Haste]"). What stopped being a trigger is the silence.
card('The Everywhere', {
  augmentText: [{
    type: 'triggered', events: ['endOfHaste'],
    label: 'during [Haste] name a card — my last named card loses all abilities',
    effect: {
      run: (g, ctx) => {
        // "NAME A CARD" IS UNRESTRICTED, and the menu is the whole card pool.
        //
        // It used to be `unitsIn(r).map(u => u.card)` — the names of the UNITS
        // standing on the board right now — with a comment claiming that was
        // "every card name in play". That is a qualifier the printed text does
        // not carry (R125's lesson: the shape of the mechanism that happened to
        // exist got promoted into a rule about the card), and it cost the card
        // its best line of play: the silence below is CONTINUOUS and matches on
        // a NAME, so naming a card that is not on the board yet is exactly how
        // you turn off the thing your opponent is about to play into your
        // region. Under the old menu that card could never be named.
        //
        // The list is DECK_LIST's own filter — real pool cards, no token faces
        // and no resource faces — unioned with every name actually in play, so
        // today's options are a strict subset (a Robot / Unit Token standing
        // there is still nameable) and nothing that used to be legal is gone.
        // Read through `E.nameOf` for the same reason the static below does:
        // R118 layer 0 means a copy answers to its FACE, and the face is the
        // name that has to be nameable for the silence to bite.
        const pool = allCardNames().filter(n => {
          const c = getCard(n);
          if (/\bResource\b/.test(c.type)) return false;
          return !/Token/.test(c.type)
            && (c.kind === 'unit' || c.kind === 'spell' || c.kind === 'spellUnit');
        });
        const names = [...new Set([
          ...pool,
          ...g.s.regions.flatMap((_, r) => g.unitsIn(r)).map(u => g.nameOf(u)),
        ])].sort();
        const NOBODY = '';
        const named = ctx.choose('name', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'The Everywhere: name a card',
          options: [
            ...names.map(n => ({ label: n, value: n, card: n })),
            // kept from the old menu, where it was the ONLY way to point at
            // something the board did not already hold. With the whole pool
            // above it is no longer that — it is just "name nothing", the way
            // to release a previous naming without silencing anyone new.
            { label: 'name no card (release my last naming)', value: NOBODY },
          ],
        }) as string;
        // The naming REMEMBERS; it does not silence. `Entity.named` is the
        // memory ("my LAST named card" — a second naming simply overwrites it,
        // and regroup deliberately does not wipe it), and the static below is
        // the silence, re-asked every time anything reads a unit's abilities.
        // That is what makes the duration continuous.
        //
        // `selfOf` is the ANCHOR in both play modes, which is why one field is
        // enough: E.queueTrigger stamps `sourceId: host.id`, so text donated by
        // an [Augment] names from — and is remembered on — the HOST, exactly the
        // entity `staticsFor` anchors the static on (the Transmogrifant shape).
        const self = selfOf(g, ctx);
        if (!self) return;   // the namer left play mid-resolution: nothing to remember on
        // "a card that is not in play" is REMEMBERED too, and that is the point
        // of writing it before the early return: it is still a naming, so it
        // becomes "my last named card" and whatever was silenced before is
        // released. Empty string is a name no entity can ever carry, so the
        // static below simply stops matching.
        self.named = named;
        if (named === NOBODY) {
          g.ev('info', 'The Everywhere names a card that is not in play — nothing is silenced.');
          return;
        }
        // R12 is not enforced here and must not be: which copies are actually
        // silenced is the STATIC's business, and its answer changes as units
        // move. This line only reports the board as it stands right now.
        const here = g.unitsIn(self.region).filter(u => g.nameOf(u) === named).length;
        g.ev('info', here
          ? `The Everywhere names ${named}: ${here} copy(s) in this region lose all abilities `
            + '— and any copy that later shares a region with me loses them too.'
          : `The Everywhere names ${named} — no copy of it is here yet, but any that `
            + 'shares a region with me loses all abilities for as long as it does.');
      },
    },
  }],
  // R62's CONTINUOUS half, which is what "(As long as I am in their region.)"
  // is: a StaticMod matching on the remembered card NAME instead of an entity
  // id. `staticsFor` supplies the region scope and the anchoring for free —
  // it walks `anchor.region === target.region` and reads augment-donated
  // statics from their host — so the printed duration clause IS the walk's
  // existing scope, evaluated live, and the [Augment] case falls out with no
  // extra code (the Transmogrifant precedent). Suppression is a veto (R62), so
  // nothing votes the silence back on.
  // R268: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    statics: [{
      affects: (g, self, t) =>
        t.kind === 'unit' && self.named !== undefined && g.nameOf(t) === self.named,
      suppressAbilities: true,
    }],
  },
});

// "[Augment] When I attack or block, your life total becomes 13." — lll/3 0/13
// {Virus} Horror Unit. Text-box [Augment], so as a Virus it reads from the
// HOST: "your" is the host's controller, which is the point — a 0/13 wall you
// can also staple onto an enemy attacker to drag them down to 13 (or, less
// happily for you, up to 13). Expressed as a life move, so it is a real gain
// or a real loss and everything that watches life hears it.
card('Triskaidekaphage', {
  augmentText: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    label: 'your life total becomes 13',
    effect: {
      run: (g, ctx) => {
        const life = g.player(ctx.controller).life;
        if (life > 13) g.loseLife(ctx.controller, life - 13, 'Triskaidekaphage');
        else if (life < 13) g.gainLife(ctx.controller, 13 - life, 'Triskaidekaphage');
        else g.ev('info', `${g.pname(ctx.controller)} is already at 13 life.`);
      },
    },
  }],
});

// "[Augment] When my column deals combat damage, each opponent gains that much
// life." — l/1 4/4 {Virus} Cosmic Unit. A 4/4 for [1] with a drawback you are
// meant to hand to somebody else: as a Virus the text reads from the HOST, so
// "my column" is the host's column and "each opponent" is the host
// controller's opponent. The column-connect test and the amount come off the
// combat events; a column that both kills blockers and pierces through pays
// out once per damage instance.
//
// ⚠ R195 — "THAT MUCH" IS MY COLUMN'S, NOT THE TABLE'S. On the 'units'
// channel the 'damage' event's `n` is already exactly what my column dealt to
// that unit. On the 'face' channel it is NOT: `lifeLost` is aggregated per
// seat per sub-step, so `data.n` is what EVERY connecting column of my side
// dealt. Measured before the fix: a 4-power Vroot column and a separate 1/1
// column, both unblocked, handed the opponent 5 life back for a column that
// dealt 4. `E.faceDamageDealtBy` reads my column's own share off the event's
// R195 breakdown.
card('Vroot', {
  augmentText: [{
    type: 'triggered', events: ['damage', 'combatFaceDamage'],   // R238
    label: 'each opponent gains that much life',
    when: (g, self, ev) => myColumnDealtCombatDamage(g, self, ev),
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        const ev = ctx.event;
        const n = ev && ev.type === 'combatFaceDamage' && self
          ? g.faceDamageDealtBy(self, ev)
          : Number(ev?.data?.['n'] ?? 0);
        if (n <= 0) { g.ev('info', 'Vroot: no combat damage was dealt — nobody gains life.'); return; }
        const foes = opponentsOf(g, ctx.region, ctx.controller);
        if (!foes.length) { g.ev('info', 'Vroot: no opponent is present here — nobody gains life.'); return; }
        for (const s of foes) g.gainLife(s, n, 'Vroot');
      },
    },
  }],
});
