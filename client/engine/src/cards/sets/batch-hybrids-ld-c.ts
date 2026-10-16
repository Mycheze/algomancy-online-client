/* Light & Dark expansion — batch hybrids-ld-c (18 cards).
 *
 * Behaviour only; printed data comes from printed.json (never hand-copied).
 * Spec for the expansion's new mechanics: docs/08-light-and-dark.md,
 * and the Comprehensive Rules.
 *
 * Cards in this batch:
 *   Angel of Anguish
 *   Aurozoa
 *   Blightsea Polyp
 *   Buffer Overflow
 *   Capture
 *   Counter Thief
 *   Deathcoil Construct
 *   Dragnol
 *   Gridxlan
 *   Haunting Memories
 *   Iyngstra
 *   Lilbot
 *   No Hand Killer
 *   Prophecy Bug
 *   Rotwall
 *   Swarmling
 *   Trench Stalker
 *   Visionary Construct
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn);
 * [once] on an activated ability = bounded (CR 109.9).
 *
 * Rulings referenced: CR 109.3a, 109.3b (conditions at event time, amounts at resolution),
 * CR 704.6, 704.6b (fizzle vs partial), CR 704.1a (mid-resolution payments/choices via ctx.choose),
 * CR 803.4 (bounded [Switch1]/[once] budgets per card), CR 601.4d ("each opponent"
 * reads the event region's present seats), CR 701.2 (applying a mod is not playing
 * a card), CR 112.13 (rot; the two replacement hooks), CR 801.2 (trashing), CR 403.1, 403.7
 * (cache / prophecy / glimpse), CR 802.24c ({Lethal} still kills through a replaced
 * hit).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 * ✔ LIFE PAYMENTS ("Pay 1 life:", "Pay 3 life:") are real activation costs now
 *    (CR 111.6, 111.7): `cost: { life: n }` GATES the activation and is paid before the
 *    ability reaches the stack. This batch's adjudication — "a cost you cannot
 *    pay and survive is not payable" — is exactly what CR 111.6b says, so Aurozoa
 *    and Visionary Construct behave as written; only the failure MODE changed,
 *    from a silent no-op to an illegal activation.
 *    Lilbot's "discard a card OR sacrifice another nontoken unit" is the
 *    printed either/or shape, `cost: { discardOrSacrifice: 1 }` — also real,
 *    also paid before the item reaches the stack, and it gates the activation
 *    (so the [once] budget is no longer burned on an unpayable one).
 * ✔ No Hand Killer's "Discard X cards" is a REAL CAST COST (CR 705.3b):
 *    `castCost: { kind: 'discardCard', n: 'X' }`, and collectCastCosts runs
 *    for ACTIVATED items too, so the discards are collected in the CAST
 *    WINDOW and `ctx.x` is what was paid — an opponent answers an X they can
 *    already see. This entry used to read "⚠ STILL AT RESOLUTION … AbilityCost
 *    models a conjunction of FIXED atoms, so this shape does not fit"; that
 *    stopped being true when castCost grew the variable form.
 *    `xMin` was then REMOVED (CR 109.9c): X = 0 is a legal activation, offered
 *    even with an empty hand, and it really does spend the [once] for nothing
 *    — owner verbatim, *"You can legally activate it and discard no cards."*
 *    Not a refund case (CR 109.9b is for a decline or an impossible offer). See the
 *    card's own note.
 *  - "PLAY ONE UNIT FROM YOUR BIN" (Gridxlan) is modelled as a free bounded
 *    activated ability, exactly the way The Bonesculptor models the same text:
 *    there is no bin-play action in apply.ts. CR 705.3a: all three preconditions are
 *    ACTIVATION gates now — `timing: 'deploy'` for the window, and `usableWhen`
 *    for the printed "if your hand is empty" and for "is there anything in the
 *    bin I could actually play". This entry used to read "the 'if your hand is
 *    empty' and 'during deployment' conditions are checked at RESOLUTION, so
 *    activating it with cards in hand wastes the once-per-turn budget"; the
 *    analogy to The Bonesculptor is still apt, and so is the fix — one fix gated both cards in the same round.
 *  - "WHENEVER YOU PLAY A SPELL" (Dragnol) listens to the engine's own
 *    'spellPlayed' event, which fires for spell, spellUnit AND spellToken —
 *    the batch-hybrids-fwe convention that unqualified "spell" includes
 *    tokens, extended to spell units because the event is the engine's own
 *    definition of "a spell was played". CR 701.2a already keeps mods out.
 *  - "PUT TARGET UNIT INTO YOUR HAND" (Capture) is a recall to the CASTER's
 *    hand rather than the owner's, which is now all it is: `E.recall` takes a
 *    `to` seat and a log verb, so putIntoHand() below is a one-line delegate
 *    instead of the hand-rolled copy of recall() it used to be.
 *  - "CREATE A COPY OF ME" (Swarmling) creates a TOKEN copy (the Echo of
 *    Despair precedent): same card, erased when it leaves play, never trashed.
 *  - "DOUBLE ALL COUNTERS ON UNITS AND PLAYERS" (Buffer Overflow): units carry
 *    ONE signed counter total (+1/+1 and -1/-1 cancel pairwise, engine
 *    model), so doubling doubles the NET — a unit on net -2 goes to -4.
 *    Players' counters are rot and debt (CR 112.15), the only two that exist.
 *    Region-scoped at resolution (CR 601.1b, 601.4d).
 *
 * UN-PARKED (kept as history; nothing in this batch is parked):
 *  - Counter Thief: UN-PARKED (CR 708.1). "those counters are placed on me instead"
 *    is a REDIRECT — the second family of the replacement layer — expressed as
 *    `replaceCounters`, a chained redirect hook (CR 708.4) E.addCounters consults
 *    before it commits. Nothing reaches the stack, so nothing can negate it.
 *  - Trench Stalker: LIVE, and it landed WHOLE the way its ledger
 *    entry demanded — the CR 111.2 "[Discard two cards]" cast cost went on in the
 *    same change as the two modes it pays for: `playsIntoFormation` (CR 602.7) and
 *    `playsFromBin` (CR 405.9; the play-from-bin ACTION `legalActions` never
 *    used to offer). No {Unstable} on the bin route: the stamp is the
 *    granting card's text (CR 405.9a), and this card's own line grants none.
 */
import type { Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt, manaOf, isUnitCard, pickUnit } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** present seats of a region, initiative player first (stable order) */
/** CR 601.4c: `E.seatsHere` is the one answer for the whole pool. SIX files had
 * grown their own copy of this and they did NOT agree — most ordered it
 * initiative-first, batch-hybrids-ld-a took `presentSeats` raw. */
const presentSeats = (g: E, region: number): Seat[] => g.seatsHere(region);

const opponentsIn = (g: E, region: number, me: Seat): Seat[] =>
  presentSeats(g, region).filter(s => s !== me);

/**
 * "Put target unit into YOUR hand" (Capture): a recall whose destination is
 * the CASTER's hand, not the owner's. That is the ONLY thing it changes, so it
 * is E.recall() with a redirected seat rather than a second copy of it. This
 * used to be a line-for-line duplicate of recall(), and it had already drifted
 * out of sync twice over: it stamped no leave-play `to` (CR 714.9) on its despawn event, so
 * Capture triggered no "a card entered a hand" watcher at all (Rider of the
 * Tides, Xenopod Progenitor, Galerider Eel), and it erased a token instantly
 * instead of letting it visit the hand first (CR 410.5b; the token rule was extended to the hand
 * 2026-08-22).
 */
const putIntoHand = (g: E, u: Entity, seat: Seat): void =>
  g.recall(u, { to: seat, verb: 'put into' });


// ─────────────────────── LIGHT / DARK (ld) ────────────────────────────

// "I can be prophesied from your bin." — ld/4 5/5 Cosmic Unit, banner
// "[1] Prophecy — Two Turns Pass". The whole card is the CardBehavior flag
// (CR 803.7c): no card may be prophesied from the bin unless it says so, and
// doProphesy() refuses `from: 'bin'` without this. Everything else — the
// banner cost, the two-turn count from the moment of prophesying (CR 803.7e), the
// free affinity-ignoring release (CR 803.7h) — is engine.
card('Angel of Anguish', { prophesyFromBin: true });

// "Target player's life total becomes equal to twice the number of cards in
// all bins." — ld/8 {Battle} Cosmic Spell. "All bins" = BOTH players' bins,
// unowned and not region-scoped. Setting the total is expressed as the
// difference, so it runs through gainLife/loseLife and a total of 0 or less
// really kills (loseLife's lethal check).
card('Haunting Memories', {
  spellEffect: {
    // CR 110.3: only a player has a life total, and 'player' is the kind that says
    // so — 'any' offered the region's units, which this could do nothing to.
    targets: { what: 'player', prompt: "Haunting Memories: target player's life becomes 2× the cards in all bins" },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('player' in t)) return;
      const who = t.player;
      // CR 601.1c: "all bins" is all bins IN THIS REGION
      const bins = g.seatsHere(ctx.region).reduce((n, s) => n + g.player(s).bin.length, 0);
      const want = 2 * bins;
      const cur = g.player(who).life;
      g.ev('info',
        `Haunting Memories: ${bins} card(s) in all bins — ${g.pname(who)}'s life becomes ${want}.`);
      if (want > cur) g.gainLife(who, want - cur, 'Haunting Memories');
      else if (want < cur) g.loseLife(who, cur - want, 'Haunting Memories');
    },
  },
});

// ─────────────────────── LIGHT / WATER (lb) ───────────────────────────

// "[Augment] Pay 1 life: Recall me." — lb/3 4/1 {Virus} Cosmic Jellyfish
// Unit. An ACTIVATED ability in the [Augment] text box: live when the card is
// played normally (via: 'augment') and donated to a host when it augments
// (via: { mod }), where "me" anchors on the HOST (the ctx.sourceId is always
// the unit the text is attached to). CR 111.6b: the 1 life is a real ACTIVATION cost
// — it gates the activation (at 1 life the ability is neither offered nor
// accepted) and is paid before the ability reaches the stack.
card('Aurozoa', {
  augmentText: [{
    type: 'activated', cost: { life: 1 },
    label: 'pay 1 life: recall me',
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) { g.ev('info', 'Aurozoa: the carrier is already gone — nothing to recall.'); return; }
        g.recall(self);
      },
    },
  }],
});

// "[Switch1] Cache a card in your hand. It gains 'Prophecy — X Turns Pass',
// where X is half of its cost, rounded up." — lb/1 1/1 Cosmic Jellyfish
// Spell Unit. The spell half caches; the 1/1 body then spawns (spellUnit).
// CR 803.7a, 803.7e: the granted condition is minted as a string and normalised by the
// engine (normalizeProphecy), and it counts FORWARD from this moment. X reads
// the cached card's cost.
//
// An X-cost card in HAND counts as 0, giving "0 Turns Pass", which the
// engine's turnsPass row fulfils immediately. That is CR 107.3a rather than an
// approximation: an X card's cost is the X that was paid for it (the owner: "paying X
// replaces the letter X on the printed card temporarily"), a card sitting in
// a hand has had no X paid, so it has no cost — and the standing steer says
// take the reading that lets more things happen, which is offering the card
// at 0 rather than refusing to see it. Bounded graft ([Switch1], CR 722.5) shares
// the effect.
const prophecyBugCache: EffectDef = {
  run: (g, ctx) => {
    const hand = g.player(ctx.controller).hand;
    if (!hand.length) {
      g.ev('info', 'Prophecy Bug: your hand is empty — nothing to cache.');
      return;
    }
    const idx = hand.length === 1 ? 0 : ctx.choose('cache', {
      kind: 'payOrDecline', seat: ctx.controller,
      prompt: 'Prophecy Bug: cache a card from your hand (it gains a prophecy)',
      options: hand.map((name, i) => ({ label: `${name} [${manaOf(name)}]`, value: i, card: name })),
    }) as number;
    const name = hand[idx];
    if (name === undefined) return;
    const x = Math.ceil(manaOf(name) / 2);
    g.cacheFromHand(ctx.controller, idx, { prophecy: `Prophecy — ${x} Turns Pass` });
  },
};
card('Prophecy Bug', {
  spellEffect: prophecyBugCache,
  graftEffect: { bounded: true, effect: prophecyBugCache },
});

// ─────────────────────── LIGHT / FIRE (lr) ────────────────────────────

// "[Augment] Whenever you play a spell during battle, you may pay [2]. If you
// do, each opponent loses 2 life and you gain 2 life." — lr/2 2/2 Cosmic
// Horror Unit. Text-box [Augment]: live when played normally, donated when it
// augments. ⚠ "a spell" = the engine's own 'spellPlayed' event (header);
// "you" = the event's seat is my controller; "during battle" is the phase.
// The [2] is a mid-resolution pay-or-decline (CR 111.9), skipped when unaffordable.
// "Each opponent" is region-scoped (CR 601.4d).
card('Dragnol', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'],
    label: 'you may pay [2]: each opponent loses 2 life, you gain 2 life',
    when: (g, self, ev) => g.s.phase === 'battle' && ev.data?.seat === self.controller,
    effect: {
      run: (g, ctx) => {
        if (g.openMana(ctx.controller) < 2) {
          g.ev('info', 'Dragnol: you cannot pay [2] — nothing is drained.');
          return;
        }
        const pay = ctx.choose('pay', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Dragnol: pay [2]? (each opponent loses 2 life, you gain 2 life)',
          options: [
            { label: 'Pay [2]', value: true },
            { label: 'Decline', value: false },
          ],
        });
        if (!pay) {
          g.ev('info', 'Dragnol: [2] is not paid — nothing is drained.');
          return;
        }
        g.payMana(ctx.controller, 2);
        // the gain first: a life total that ends at 0 must not be reached by
        // an opponent's loss before mine lands (loseLife ends the game inline)
        g.gainLife(ctx.controller, 2, 'Dragnol');
        // CR D7.3/CT-81(b): the [2] was paid and the 2 life gained, so this run
        // is never WHOLLY silent and 65's silence check cannot see it. The
        // drain half is what the player paid for, and CR 601.4d empties it whenever
        // the region holds nobody else — say so rather than pocketing the mana
        // in silence. (Rotwall, further down this file, is the same repair on
        // an effect whose OTHER half does not speak, which is why that one was
        // already caught by CT-70 and this one was not.)
        const foes = opponentsIn(g, ctx.region, ctx.controller);
        if (!foes.length) {
          g.ev('info', 'Dragnol: no opponent is present here — nobody is drained.');
          return;
        }
        for (const seat of foes) {
          g.loseLife(seat, 2, 'Dragnol');
        }
      },
    },
  }],
});

// ─────────────────────── LIGHT / EARTH (le) ───────────────────────────

// "[Augment] Whenever another ally spawns, you gain life equal to their
// defense." — le/3 3/6 Holy Structure Unit. Text-box [Augment]. "Another
// ally" = a different unit with my controller (tokens included — the text
// does not exclude them); "their defense" is LIVE at resolution (CR 107.8), read
// off effStats, so counters and statics count. A spawned unit that has
// already left play by resolution gains nothing.
card('Iyngstra', {
  augmentText: [{
    type: 'triggered', events: ['spawned'],
    label: 'gain life equal to the spawned ally’s defense',
    when: (g, self, ev) => {
      const uid = ev.data?.unit as EntityId | undefined;
      const u = uid !== undefined ? g.entity(uid) : undefined;
      return !!u && u.id !== self.id && u.controller === self.controller;
    },
    effect: {
      run: (g, ctx) => {
        const uid = ctx.event?.data?.unit as EntityId | undefined;
        const u = uid !== undefined ? g.entity(uid) : undefined;
        if (!u) { g.ev('info', 'Iyngstra: the spawned ally is gone — no life gained.'); return; }
        const def = g.effStats(u)[1];
        if (def > 0) g.gainLife(ctx.controller, def, `Iyngstra (${u.card}'s defense)`);
        else g.ev('info', `Iyngstra: ${u.card} has no defense — no life gained.`);
      },
    },
  }],
});

// ─────────────────────── LIGHT / METAL (lm) ───────────────────────────

// "When you gain or lose life, [Switch1] Put a +1/+1 counter on each of your
// units." — lm/3 3/3 Cosmic Unit. A bounded graft CAUSE plus the matching
// bounded graft effect ([Switch1], CR 722.5 — the Scrapyard Custodian shape).
// Either direction of life change fires it ('lifeGained' / 'lifeLost'), for
// MY controller only. "Each of your units" is region-scoped at resolution
// (CR 601.1b); putting counters changes no life total, so nothing loops.
const deathcoilPump: EffectDef = {
  run: (g, ctx) => {
    for (const u of g.unitsOf(ctx.controller, ctx.region)) g.addCounters(u, 1);
  },
};
card('Deathcoil Construct', {
  abilities: [{
    type: 'triggered', events: ['lifeGained', 'lifeLost'], bounded: true, graftCause: true,
    label: 'put a +1/+1 counter on each of your units (you gained or lost life)',
    when: (g, self, ev) => ev.data?.seat === self.controller,
    effect: deathcoilPump,
  }],
  graftEffect: { bounded: true, effect: deathcoilPump },
});

// "[Augment] Pay 3 life: Glimpse 1. (Reveal the top card of the deck and
// cache it. Until end of turn, you may play it as if it was in your hand,
// ignoring affinity.)" — lm/4 2/1 Horror Unit. An ACTIVATED ability in the
// [Augment] text box (live on the card, donated to a host). CR 801.9: the whole
// glimpse — reveal, cache, until-end-of-turn permission, ignore affinity but
// still pay the mana — is E.glimpse(). CR 111.6, 111.7: the 3 life are a real ACTIVATION
// cost, gating the activation and paid before it reaches the stack.
card('Visionary Construct', {
  augmentText: [{
    type: 'activated', cost: { life: 3 },
    label: 'pay 3 life: Glimpse 1',
    effect: {
      run: (g, ctx) => {
        g.glimpse(ctx.controller, 1);
      },
    },
  }],
});

// ─────────────────────── WATER / DARK (bd) ────────────────────────────

// "[Augment] Columns deal combat damage to players as 1 rot. (For example, a
// column of a 4/4 unit and 2/2 unit would give the opponent 1 rot, without
// changing their life total.)" — bd/2 1/2 {Virus} Spirit Blight Unit.
// CR 608.8a: the card IS the replaceCombatDamageToPlayer hook. The engine offers it
// once PER COLUMN (whatever the column's power) to every holder in the battle
// region — units in play and augment mods alike, a mod's hook anchored on its
// HOST — so "columns", plural and UNOWNED, means every column's hit to a
// player, mine included. ⚠ CR 802.24c/Caleb 2024-10-24: replacing the damage does
// not unmake it, so {Lethal} still kills through this; that is engine-side.
// `augmentable` because the [Augment] text is implemented as a hook rather
// than as augmentAttrs or augmentText.
card('Blightsea Polyp', {
  augmentable: true,
  // CR 721.1: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    replaceCombatDamageToPlayer: (g, _self, seat) => { g.gainRot(seat, 1); return true; },
  },
});

// "Put target unit into your hand, then discard a card." — bd/4 {Battle}
// Mystic Spell. ⚠ The unit goes to the CASTER's hand, not its owner's
// (putIntoHand above), so this steals. A TOKEN visits that hand and is erased
// out of it by the state-based sweep (CR 410.5b), which means capturing a token is not
// nothing: it fires "a card entered a hand" and it is a legal discard for the
// instant before the sweep — except that the sweep runs first, so the discard
// below can never actually find it. The discard is mandatory and follows the
// capture, so a captured NONTOKEN card is itself a legal discard (CR 801.3:
// discarding trashes it).
card('Capture', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Capture: put target unit into your hand' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (isEnt(t)) {
        const u = g.entity(t.id);
        if (u) putIntoHand(g, u, ctx.controller);
      }
      const hand = g.player(ctx.controller).hand;
      if (!hand.length) {
        g.ev('info', 'Capture: no card to discard.');
        return;
      }
      const idx = hand.length === 1 ? 0 : ctx.choose('discard', {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: 'Capture: discard a card',
        options: hand.map((name, i) => ({ label: name, value: i, card: name })),
      }) as number;
      g.discardFromHand(ctx.controller, idx);
    },
  },
});

// "[Discard two cards]{/n}I can be played directly into formation, and played
// from your bin." — bd/2 6/2 {Battle} Alien Unit. UN-PARKED, WHOLE —
// the cost lands in the same change as the two modes it pays for, per its own
// ledger entry's warning (either half alone would be a strictly wrong card):
//  · "[Discard two cards]" is a bracketed CAST COST (CR 702.4, 702.4e), chosen and paid
//    in the cast window on EVERY route into play, hand and bin alike. It
//    hangs on a `spellEffect` that exists solely to carry it: the run is
//    empty BY CONSTRUCTION and unreachable, because a 'unit' StackItem
//    resolves by spawning (`resolveItem` returns before parts ever run).
//    Declared in NOT_A_GAP (71-card-ledger.test.ts) for exactly that reason.
//  · "played directly into formation" is `playsIntoFormation` (CR 602.7),
//    verbatim Tiderunner Initiate: the spot is chosen at cast, taken
//    atomically with the spawn.
//  · "played from your bin" is `playsFromBin` (CR 405.9) — the card's own printed
//    permission through the same `playFromBin` action the bin-play permission uses. Printed
//    {Battle} timing still applies, and NO {Unstable} stamp rides on it: the
//    stamp is the GRANTORS' own text (CR 405.9a), and this card prints no such line.
// ⚠ TRANSCRIPTION: the "[Discard two cards]" line is left inside `text` by
// the extractor (it is neither `ambush` nor `discardMe`), so the cost is
// authored by hand here — and the printed text never says the discard pays
// for only ONE of the modes, so it is read as the card's cost on every play.
card('Trench Stalker', {
  playsIntoFormation: true,   // CR 602.7
  playsFromBin: true,         // CR 405.9
  spellEffect: {
    castCost: { kind: 'discardCard', n: 2 },   // CR 702.4e, on every route into play
    // unreachable by construction — see the note above and NOT_A_GAP
    run: () => {},
  },
});

// ─────────────────────── METAL / DARK (md) ────────────────────────────

// "Double all counters on units and players." — md/4 {Battle} Technology
// Spell. ⚠ Header: a unit's counters are ONE signed net total, so doubling
// doubles the net (a -2 unit becomes -4); a player's counters are rot and
// debt (CR 112.15), the only two that exist. Region-scoped at resolution
// (CR 601.1b, 601.4d): the units in the battle region and the seats present there.
// The doubling is planned off a snapshot, so a unit dying to its own doubled
// -1/-1 counters cannot change what the rest receive.
card('Buffer Overflow', {
  spellEffect: {
    run: (g, ctx) => {
      const plan = g.unitsIn(ctx.region)
        .filter(u => u.counters !== 0)
        .map(u => [u.id, u.counters] as const);
      const seats = presentSeats(g, ctx.region)
        .map(s => [s, g.rot(s), g.debt(s)] as const);
      for (const [id, n] of plan) {
        const u = g.entity(id);
        if (u) g.addCounters(u, n);
      }
      for (const [seat, rot, debt] of seats) {
        if (rot > 0) g.gainRot(seat, rot);
        if (debt > 0) g.gainDebt(seat, debt);
      }
      if (!plan.length && seats.every(([, r, d]) => r === 0 && d === 0)) {
        g.ev('info', 'Buffer Overflow: there are no counters to double.');
      }
    },
  },
});

// "[Augment] If one or more counters would be placed on one or more units
// during battle, those counters are placed on me instead." — md/4 0/5
// {Virus} Infection Unit.
// UNPARKED (CR 708.1). A REDIRECT, which is the second family in the replacement
// layer: the number is untouched and the RECIPIENT changes, so it is a
// redirect hook rather than a summed AmountMod. The counters land on exactly
// one unit either way — that is what "instead" means, and it is why two
// thieves do not each get a copy.
//
// TWO THIEVES CHAIN (CR 708.4, Caleb 2025-11-25: "replacement effects only
// apply once onto an effect"): counters the first thief redirects onto itself
// are still counters "placed on one or more units during battle", so the
// second thief, which has not applied yet, takes them from the first, and the
// first never takes them back. They end on the LATER thief in the engine's
// order (entity id; Caleb says the player orders them — an open item).
//
// "DURING BATTLE" is the printed restriction and it is real: outside battle
// the thief takes nothing. The engine's own battle state answers it, and it
// costs a query rather than a listener.
//
// "ON ONE OR MORE UNITS" — every unit, not just enemies and not just allies.
// The text names no owner, so the hook is offered for any unit in the anchor's
// region (CR 601.1b), which is also the region the thief could actually reach.
//
// "ON ME" is the ANCHOR: this card's body when it was played normally, the
// HOST when the text arrived on an augment mod — the same rebinding Skittering
// Blight's "counters on me" gets, and it comes free from E.anchored().
//
// No ping-pong: each thief applies to one placement once, and the engine's
// chain (E.chainReplacements), not a flag in this file, is what enforces it —
// a module-level `let` here was the thing report #60 asked to be rid of.
//
// ⚠ TRANSCRIPTION — a DELIBERATE, RECORDED divergence from the printed card.
// The physical card prints the name "Counter Theif". Our data spells it
// "Counter Thief", corrected on 2026-08-24 at the owner's instruction ("fix
// clear typo issues and references"), and this card is registered under the
// CORRECTED spelling — not the printed one, which is what this note used to
// claim. `data/cards/light-and-dark-transcription-notes.json` carries the
// full record (including how to revert), and registry.ts keeps
// `registerAlias('Counter Theif', 'Counter Thief')` so every older ruling,
// Discord answer and note that uses the printed spelling still resolves.
// ⚠ docs/16-divergence-inventory.md §3 says "Nothing is misspelled" — that is
// wrong about this card; the misspelling is on the physical card itself.
card('Counter Thief', {
  augmentable: true,
  // CR 721.1: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    replaceCounters: (g, self, target) => {
      if (!g.s.battle) return null;                 // "during battle"
      if (target.id === self.id) return null;       // already mine
      if (target.region !== self.region) return null;
      return self;
    },
  },
});

// "[Augment] [once] Discard a card or sacrifice another nontoken unit:
// Glimpse 2." — md/2 2/2 Occult Technology Unit. An ACTIVATED ability in the
// [Augment] text box, bounded by [once] (CR 109.9).
//
// CR 705.4: the either/or line is a real ACTIVATION cost (`discardOrSacrifice: 1`)
// — it GATES the activation (with an empty hand and no other nontoken unit the
// ability is neither offered nor accepted, and the [once] budget is not spent)
// and is chosen and paid in the cast window, before the item reaches the
// stack. "Another" is the engine's own rule: the ability's source is excluded
// from the sacrifice pool, and so are tokens.
// Glimpse 2 = CR 801.9 (reveal two, cache ONE of your choice — playable this turn —
// and recycle the other to the bottom of the deck); E.glimpse() raises the
// choose-one decision itself.
card('Lilbot', {
  augmentText: [{
    type: 'activated', cost: { discardOrSacrifice: 1 }, bounded: true,   // [once]
    label: 'discard a card or sacrifice another nontoken unit: Glimpse 2',
    effect: {
      run: (g, ctx) => { g.glimpse(ctx.controller, 2); },
    },
  }],
});

// "Whenever you discard me or another card, you may pay [1] to create a copy
// of me." — md/3 2/1 Infection Unit. NOT [Augment] text, so this is the
// card's own ability — and it has to exist in two shapes, because the engine routes
// the two cases differently:
//   #0 self: true — "you discard ME". A trashed card's own trigger fires from
//      the BIN (E.fireOwnTrashTrigger), which only ever dispatches self:true
//      'trashed' abilities and gives them a detached ghost source.
//   #1 no self — "or another card". This one belongs to a Swarmling IN PLAY
//      and the ordinary listener scan dispatches it, which is also what
//      excludes the trigger source itself.
// Both narrow to `from === 'hand'` (a DISCARD, not a mill or a death) and to
// my own bin ("you discard"). ⚠ The copy is a TOKEN copy (header). The [1] is
// a mid-resolution pay-or-decline (CR 111.9).
const swarmlingCopy: EffectDef = {
  creates: ['Swarmling'],
  run: (g, ctx) => {
    if (g.openMana(ctx.controller) < 1) {
      g.ev('info', 'Swarmling: you cannot pay [1] — no copy.');
      return;
    }
    const pay = ctx.choose('pay', {
      kind: 'payOrDecline', seat: ctx.controller,
      prompt: 'Swarmling: pay [1] to create a copy of me?',
      options: [
        { label: 'Pay [1] — create a copy', value: true },
        { label: 'Decline', value: false },
      ],
    });
    if (!pay) {
      g.ev('info', 'Swarmling: [1] is not paid — no copy.');
      return;
    }
    g.payMana(ctx.controller, 1);
    // CR 601.5: a created unit arrives where its SOURCE is (ctx.region)
    g.spawnUnit(ctx.controller, 'Swarmling', ctx.region, { token: true });
  },
};
const discardedByMe = (g: E, self: Entity, ev: { data?: Record<string, unknown> }): boolean =>
  ev.data?.['from'] === 'hand' && ev.data?.['seat'] === self.controller;
card('Swarmling', {
  abilities: [
    {
      type: 'triggered', events: ['trashed'], self: true,
      label: 'you may pay [1] to create a copy of me (I was discarded)',
      when: discardedByMe,
      effect: swarmlingCopy,
    },
    {
      type: 'triggered', events: ['trashed'],
      label: 'you may pay [1] to create a copy of me (you discarded a card)',
      when: discardedByMe,
      effect: swarmlingCopy,
    },
  ],
});

// ─────────────────────── EARTH / DARK (ed) ────────────────────────────

// "[Augment] If your hand is empty, you may play one unit from your bin
// during deployment." — ed/4 3/4 Structure Unit. ⚠ Modelled as a free bounded
// activated ability in the [Augment] text box (The Bonesculptor precedent —
// there is no bin-play action): once per turn, during YOUR deployment, with
// an EMPTY hand, pick an affordable unit card in your bin; its cost is paid
// normally and it spawns (spawn triggers fire).
//
// CR 705.3a: all three preconditions are ACTIVATION gates now — `timing: 'deploy'`
// (the engine's activation-timing field, CR 705.2, which this was re-implementing at resolution) plus
// `usableWhen` for the printed "if your hand is empty" and for "is there
// anything in the bin I could actually play". It is `bounded`, so activating
// it when it could do nothing burnt the once-per-turn budget; the header used
// to admit exactly that.
const gridxlanPicks = (g: E, seat: Seat): { label: string; value: number; card: string }[] => {
  const bin = g.player(seat).bin;
  return bin
    .map((name, i) => ({ label: name, value: i, card: name }))
    // a SPELL UNIT counts as a unit for bin purposes (it spawns its body) —
    // the convention every other bin search in the set uses
    .filter(o => isUnitCard(bin[o.value]!) && g.canPayCard(seat, bin[o.value]!));
};
card('Gridxlan', {
  augmentText: [{
    type: 'activated', cost: {}, bounded: true, timing: 'deploy',
    label: 'with an empty hand, play a unit from your bin (during deployment)',
    usableWhen: (g, _self, seat) =>
      g.player(seat).hand.length === 0 && gridxlanPicks(g, seat).length > 0,
    effect: {
      run: (g, ctx) => {
        if (g.player(ctx.controller).hand.length > 0) {
          g.ev('info', 'Gridxlan: your hand is not empty — no effect.');
          return;
        }
        const bin = g.player(ctx.controller).bin;
        const opts = gridxlanPicks(g, ctx.controller);
        if (!opts.length) {
          g.ev('info', 'Gridxlan: no playable unit in your bin.');
          return;
        }
        const pick = ctx.choose('pick', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Gridxlan: play a unit from your bin',
          options: [...opts, { label: 'Decline', value: -1 }],
        }) as number;
        if (pick < 0) { g.ev('info', 'Gridxlan: declined — nothing is played from the bin.'); return; }
        const name = bin[pick];
        if (name === undefined || !isUnitCard(name)
          || !g.canPayCard(ctx.controller, name)) {
          g.ev('info', 'Gridxlan: that card can no longer be played — nothing happens.');
          return;
        }
        g.removeFromBin(ctx.controller, pick, 'played');   // CR 405.7
        g.payCard(ctx.controller, name);
        g.ev('info', `Gridxlan: ${g.pname(ctx.controller)} plays ${name} from the bin.`);
        g.spawnUnit(ctx.controller, name, ctx.region);
      },
    },
  }],
});

// "[Augment] Whenever I am dealt damage, each opponent gains a rot." — ed/3
// 0/5 Alien Unit. Text-box [Augment], self-scoped 'damage' (combat damage
// included — every damage path emits the event with `unit`). CR 112.13: gaining rot
// is not damage and has no consequence beyond the event; "each opponent" is
// region-scoped (CR 601.4d). A 0/5 body means it survives to fire repeatedly.
card('Rotwall', {
  augmentText: [{
    type: 'triggered', events: ['damage'], self: true,
    label: 'each opponent gains a rot (I was dealt damage)',
    effect: {
      run: (g, ctx) => {
        // CR D7.3b/CT-70: `opponentsIn` yields nobody in a home region out of
        // battle. No Hand Killer below already announces the same emptiness.
        const foes = opponentsIn(g, ctx.region, ctx.controller);
        if (!foes.length) {
          g.ev('info', 'Rotwall: no opponent is present here — nobody gains a rot.');
          return;
        }
        for (const seat of foes) g.gainRot(seat, 1);
      },
    },
  }],
});

// ─────────────────────── FIRE / DARK (rd) ─────────────────────────────

// "[Augment] [once] Discard X cards: Each opponent sacrifices X units." —
// rd/6 6/8 Bedlam Alien Unit. An ACTIVATED ability in the [Augment] text box,
// bounded by [once] (CR 109.9).
//
// UN-PARKED (the variable activation cost is now paid as it is activated). "Discard X cards" sits BEFORE the colon — it is the
// activation cost, and the note here used to admit "⚠ the cost is paid at
// resolution" because the DSL had no shape for it. `EffectDef.castCost` with
// `{ kind: 'discardCard', n: 'X' }` is that shape, and collectCastCosts runs
// for ACTIVATED items too (collectTargets calls it on the way to the stack),
// so the discards happen in the cast window: the opponent decides how to
// answer a No Hand Killer whose X they can already see, instead of one whose
// size was still unfixed while priority passed. `ctx.x` is what was paid.
//
// NO `xMin`. CR 109.9c, owner 2026-08-25, verbatim: *"You can legally
// activate it and discard no cards."* This carried `xMin: 1` on the reasoning
// that X = 0 does nothing at all AND burns the [once] budget, so an empty hand
// should make the whole activation unpayable and legalActions should stop
// offering it. The ruling refuses that reading and, with it, the premise: the
// ability IS offerable with an empty hand, X = 0 is a legal activation, and it
// really does spend the [once] for nothing. That is not a bug to be routed
// around with `ctx.refundBudget` either — CR 109.9b hands a budget back for a
// DECLINE or an impossible offer, and this is neither: the player was asked,
// answered 0, and the ability did the whole of what 0 asks for. Every other
// variable cost in the pool is paid down to 0 the same way (CR D7.1a:
// `xZeroWarning` is the pool's standing shape for exactly this).
//
// Every discard is a TRASH (CR 801.3) and fires whatever trash triggers it should.
// Then each opponent (region-scoped, CR 601.4d) sacrifices X of their own units,
// choosing which; all of an opponent's picks are gathered before any of them
// is destroyed, so a pick cannot be invalidated by an earlier one.
card('No Hand Killer', {
  augmentText: [{
    type: 'activated', cost: {}, bounded: true,   // [once]
    label: 'discard X cards: each opponent sacrifices X units',
    effect: {
      castCost: { kind: 'discardCard', n: 'X' },   // CR 109.9c: X = 0 is legal
      xZeroWarning: 'X = 0 discards nothing and sacrifices nothing',   // CR D7.1a
      run: (g, ctx) => {
        const x = ctx.x ?? 0;   // however many cards were discarded at cast
        if (x === 0) { g.ev('info', 'No Hand Killer: X = 0 — nothing is sacrificed.'); return; }
        const foes = opponentsIn(g, ctx.region, ctx.controller);
        if (!foes.length) { g.ev('info', 'No Hand Killer: no opponent is present here — nobody sacrifices.'); return; }
        for (const seat of foes) {
          const picks: EntityId[] = [];
          for (let k = 0; k < x; k++) {
            const pool = g.unitsOf(seat, ctx.region).filter(u => !picks.includes(u.id));
            const id = pickUnit(ctx, `sac:${seat}:${k}`, seat, pool,
              `No Hand Killer: sacrifice a unit (${k + 1} of ${x})`);
            if (id === null) break;
            picks.push(id);
          }
          if (!picks.length) {
            g.ev('info', `No Hand Killer: ${g.pname(seat)} has no unit here to sacrifice.`);
            continue;
          }
          for (const id of picks) {
            const u = g.entity(id);
            if (u) g.destroy(u, 'is sacrificed');
          }
        }
      },
    },
  }],
});
