/* Light & Dark expansion — batch hybrids-ld-c (18 cards).
 *
 * Behaviour only; printed data comes from printed.json (never hand-copied).
 * Spec for the expansion's new mechanics: docs/08-light-and-dark.md,
 * rulings R38-R48 in docs/digital-rules.md.
 *
 * Cards in this batch:
 *   Angel of Anguish
 *   Aurozoa
 *   Blightsea Polyp
 *   Buffer Overflow
 *   Capture
 *   Counter Theif
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
 * [once] on an activated ability = bounded (R9).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (fizzle vs partial), R6 (mid-resolution payments/choices via ctx.choose),
 * R9 (bounded [Switch1]/[once] budgets per card), R12/R25 ("each opponent"
 * reads the event region's present seats), R37 (applying a mod is not playing
 * a card), R38 (rot; the two replacement hooks), R40 (trashing), R41-R46
 * (cache / prophecy / glimpse), R48 ({Lethal} still kills through a replaced
 * hit).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 * ✔ LIFE PAYMENTS ("Pay 1 life:", "Pay 3 life:") are real activation costs now
 *    (R49): `cost: { life: n }` GATES the activation and is paid before the
 *    ability reaches the stack. This batch's adjudication — "a cost you cannot
 *    pay and survive is not payable" — is exactly what R49 ruled, so Aurozoa
 *    and Visionary Construct behave as written; only the failure MODE changed,
 *    from a silent no-op to an illegal activation.
 *    Lilbot's "discard a card OR sacrifice another nontoken unit" is the
 *    printed either/or shape, `cost: { discardOrSacrifice: 1 }` — also real,
 *    also paid before the item reaches the stack, and it gates the activation
 *    (so the [once] budget is no longer burned on an unpayable one).
 *  - ⚠ STILL AT RESOLUTION: No Hand Killer's "Discard X cards", where X is a
 *    VARIABLE amount the activator chooses one card at a time. AbilityCost
 *    models a conjunction of FIXED atoms, so this shape does not fit. It is
 *    mandatory once activated; no eligible payment means the ability resolves
 *    with no effect and the [once] budget is still spent. Flagged, not faked.
 *  - "PLAY ONE UNIT FROM YOUR BIN" (Gridxlan) is modelled as a free bounded
 *    activated ability, exactly the way The Bonesculptor models the same text:
 *    there is no bin-play action in apply.ts. The "if your hand is empty" and
 *    "during deployment" conditions are checked at RESOLUTION, so activating
 *    it with cards in hand wastes the once-per-turn budget.
 *  - "WHENEVER YOU PLAY A SPELL" (Dragnol) listens to the engine's own
 *    'spellPlayed' event, which fires for spell, spellUnit AND spellToken —
 *    the batch-hybrids-fwe convention that unqualified "spell" includes
 *    tokens, extended to spell units because the event is the engine's own
 *    definition of "a spell was played". R37 already keeps mods out.
 *  - "PUT TARGET UNIT INTO YOUR HAND" (Capture) is a recall to the CASTER's
 *    hand rather than the owner's, so it cannot use E.recall(); putIntoHand()
 *    below mirrors recall() exactly (mods shed to their owners' bins and are
 *    trashed per R40, formation cleanup, a 'despawned' event, tokens erased)
 *    and differs only in whose hand receives the card.
 *  - "CREATE A COPY OF ME" (Swarmling) creates a TOKEN copy (the Echo of
 *    Despair precedent): same card, erased when it leaves play, never trashed.
 *  - "DOUBLE ALL COUNTERS ON UNITS AND PLAYERS" (Buffer Overflow): units carry
 *    ONE signed counter total (+1/+1 and -1/-1 cancel pairwise, engine
 *    model), so doubling doubles the NET — a unit on net -2 goes to -4.
 *    Players' counters are rot and debt (R38/R39), the only two that exist.
 *    Region-scoped at resolution (R12/R25).
 *
 * PARKED (needs engine machinery that does not exist yet — both cards still
 * register crash-free and have a todo test):
 *  - Counter Theif: "If one or more counters would be placed on one or more
 *    units during battle, those counters are placed on me instead" is a
 *    REPLACEMENT EFFECT ON COUNTER PLACEMENT. The engine has exactly two
 *    replacement hooks (replaceRotDamage, replaceCombatDamageToPlayer) and
 *    deliberately no framework; addCounters() has no hook at all. Registered
 *    with an inert augmentText entry (the Stasis Sentry precedent) so it still
 *    plays as a 0/5 and is recognised as an augment.
 *  - Trench Stalker: of its three missing pieces R49 supplied one — a
 *    "[Discard two cards]" bracketed cast cost is expressible now (the
 *    extractor still leaves the printed line in `text`, so it would be authored
 *    by hand). The other two are not: a "played directly into formation" play
 *    MODE and a play-from-bin ACTION, both in apply.ts's play paths. The cost
 *    is deliberately NOT added alone — it would make the card strictly worse
 *    than the vanilla body. Registered bare: an ordinary [2] {Battle} 6/2.
 */
import type { CardName, Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, getCard, type EffectCtx, type EffectDef } from '../dsl.ts';

// ─────────────────────────── shared helpers ───────────────────────────

const isEnt = (t: unknown): t is Entity =>
  !!t && typeof t === 'object' && 'id' in (t as object);

/** present seats of a region, initiative player first (stable order) */
const presentSeats = (g: E, region: number): Seat[] => {
  const present = g.s.regions[region]!.presentSeats;
  return [g.initiative, g.nit].filter(s => present.includes(s));
};

const opponentsIn = (g: E, region: number, me: Seat): Seat[] =>
  presentSeats(g, region).filter(s => s !== me);

/** True while endTurn() is resolving end-of-turn triggers (batch-fire-a
 * precedent): a ctx.choose suspension in that window strands the game, so
 * "may" effects auto-decline there. */
const inEndOfTurn = (g: E): boolean => g.s.phase === 'deploy' && g.s.deployPlayer === null;

/** pick one of `pool` (auto when forced); null on an empty pool */
const pickUnit = (
  ctx: EffectCtx, key: string, chooser: Seat, pool: Entity[], prompt: string,
): EntityId | null => {
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0]!.id;
  return ctx.choose(key, {
    kind: 'electricPath', seat: chooser, prompt,
    options: pool.map(u => ({ label: u.card, value: u.id })),
  }) as EntityId;
};

/** a card that enters play as a UNIT — a spell unit spawns its body too, so
 * it counts for every bin search (the convention shared by the other batches). */
const isUnitCard = (name: CardName): boolean => {
  const k = getCard(name).kind;
  return k === 'unit' || k === 'spellUnit';
};

/** printed mana of a card; an X cost counts as 0 (⚠ there is no X to read on
 * a card sitting in hand — flagged for Prophecy Bug) */
const manaOf = (name: CardName): number => {
  const m = getCard(name).mana;
  return typeof m === 'number' ? m : 0;
};

/**
 * ⚠ "Put target unit into YOUR hand" (Capture): a recall whose destination is
 * the CASTER's hand, not the owner's. Mirrors E.recall() step for step —
 * the entity leaves play, its mods are shed to their owners' bins (nontoken
 * ones are trashed from play, R40; token mods are erased, R47), the formation
 * is cleaned up, a 'despawned' event fires so leave-play triggers hear it, and
 * a token has no card to put anywhere so it is simply erased.
 */
function putIntoHand(g: E, u: Entity, seat: Seat): void {
  if (!g.entity(u.id)) return;
  delete g.s.entities[u.id];
  const mods = u.mods.map(id => g.entity(id)).filter((m): m is Entity => !!m);
  for (const m of mods) {
    delete g.s.entities[m.id];
    if (!m.token) g.player(m.owner).bin.push(m.card);
  }
  // formation cleanup (mirror of the engine's private removeFromFormation)
  const b = g.s.battle;
  if (b) {
    for (const col of [...b.columns, ...Object.values(b.blocks)]) {
      const i = col.indexOf(u.id);
      if (i !== -1) col.splice(i, 1);
    }
    const si = b.sentAttackers.indexOf(u.id);
    if (si !== -1) b.sentAttackers.splice(si, 1);
  }
  const evData = { unit: u.id, card: u.card, seat: u.controller, region: u.region };
  if (u.token) {
    g.ev('despawned', `${u.card} is put into a hand — token: erased.`, evData);
  } else {
    g.player(seat).hand.push(u.card);
    g.ev('despawned',
      `${u.card} is put into ${g.pname(seat)}'s hand` +
      (mods.length ? ` (its ${mods.length} mod(s) → bin)` : '') + '.', evData);
  }
  const ev = g.events[g.events.length - 1]!;
  g.fireEvent('despawned', ev, u);
  for (const m of mods) if (!m.token) g.noteTrashed(m.owner, m.card, 'play');
}

// ─────────────────────── LIGHT / DARK (ld) ────────────────────────────

// "I can be prophesied from your bin." — ld/4 5/5 Cosmic Unit, banner
// "[1] Prophecy — Two Turns Pass". The whole card is the CardBehavior flag
// (R42): no card may be prophesied from the bin unless it says so, and
// doProphesy() refuses `from: 'bin'` without this. Everything else — the
// banner cost, the two-turn count from the moment of prophesying (R43), the
// free affinity-ignoring release (R42) — is engine.
card('Angel of Anguish', { prophesyFromBin: true });

// "Target player's life total becomes equal to twice the number of cards in
// all bins." — ld/8 {Battle} Cosmic Spell. Spec 'any' (there is no
// player-only TargetSpec; a unit target is a no-op — the Bripp precedent).
// "All bins" = BOTH players' bins, unowned and not region-scoped. Setting the
// total is expressed as the difference, so it runs through gainLife/loseLife
// and a total of 0 or less really kills (loseLife's lethal check).
card('Haunting Memories', {
  spellEffect: {
    targets: { what: 'any', prompt: "Haunting Memories: target player's life becomes 2× the cards in all bins" },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('player' in (t as object))) {
        g.ev('info', 'Haunting Memories: the target is not a player — no effect.');
        return;
      }
      const who = (t as { player: Seat }).player;
      const bins = g.s.players.reduce((n, p) => n + p.bin.length, 0);
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
// the unit the text is attached to). R49: the 1 life is a real ACTIVATION cost
// — it gates the activation (at 1 life the ability is neither offered nor
// accepted) and is paid before the ability reaches the stack.
card('Aurozoa', {
  augmentText: [{
    type: 'activated', cost: { life: 1 },
    label: 'pay 1 life: recall me',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!self) return;
        g.recall(self);
      },
    },
  }],
});

// "[Switch1] Cache a card in your hand. It gains 'Prophecy — X Turns Pass',
// where X is half of its cost, rounded up." — lb/1 1/1 Cosmic Jellyfish
// Spell Unit. The spell half caches; the 1/1 body then spawns (spellUnit).
// R42/R43: the granted condition is minted as a string and normalised by the
// engine (normalizeProphecy), and it counts FORWARD from this moment. X reads
// the card's PRINTED mana — ⚠ an X-cost card counts as 0, giving "0 Turns
// Pass", which the engine's turnsPass row fulfils immediately. Bounded graft
// ([Switch1], R9) shares the effect.
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
// The [2] is a mid-resolution pay-or-decline (R6), skipped when unaffordable.
// "Each opponent" is region-scoped (R25).
card('Dragnol', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'],
    label: 'you may pay [2]: each opponent loses 2 life, you gain 2 life',
    when: (g, self, ev) => g.s.phase === 'battle' && ev.data?.seat === self.controller,
    effect: {
      run: (g, ctx) => {
        if (g.openMana(ctx.controller) < 2 || inEndOfTurn(g)) return;
        const pay = ctx.choose('pay', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Dragnol: pay [2]? (each opponent loses 2 life, you gain 2 life)',
          options: [
            { label: 'Pay [2]', value: true },
            { label: 'Decline', value: false },
          ],
        });
        if (!pay) return;
        g.payMana(ctx.controller, 2);
        // the gain first: a life total that ends at 0 must not be reached by
        // an opponent's loss before mine lands (loseLife ends the game inline)
        g.gainLife(ctx.controller, 2, 'Dragnol');
        for (const seat of opponentsIn(g, ctx.region, ctx.controller)) {
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
// does not exclude them); "their defense" is LIVE at resolution (R1), read
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
// bounded graft effect ([Switch1], R9 — the Scrapyard Custodian shape).
// Either direction of life change fires it ('lifeGained' / 'lifeLost'), for
// MY controller only. "Each of your units" is region-scoped at resolution
// (R12); putting counters changes no life total, so nothing loops.
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
// [Augment] text box (live on the card, donated to a host). R45: the whole
// glimpse — reveal, cache, until-end-of-turn permission, ignore affinity but
// still pay the mana — is E.glimpse(). R49: the 3 life are a real ACTIVATION
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
// R38: the card IS the replaceCombatDamageToPlayer hook. The engine offers it
// once PER COLUMN (whatever the column's power) to every holder in the battle
// region — units in play and augment mods alike, a mod's hook anchored on its
// HOST — so "columns", plural and UNOWNED, means every column's hit to a
// player, mine included. ⚠ R48/Caleb 2024-10-24: replacing the damage does
// not unmake it, so {Lethal} still kills through this; that is engine-side.
// `augmentable` because the [Augment] text is implemented as a hook rather
// than as augmentAttrs or augmentText.
card('Blightsea Polyp', {
  augmentable: true,
  replaceCombatDamageToPlayer: (g, _self, seat) => { g.gainRot(seat, 1); return true; },
});

// "Put target unit into your hand, then discard a card." — bd/4 {Battle}
// Mystic Spell. ⚠ The unit goes to the CASTER's hand, not its owner's
// (putIntoHand above), so this steals; a token has no card and is simply
// erased. The discard is mandatory and follows the capture, so the captured
// card is itself a legal discard (R40: discarding trashes it).
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
// from your bin." — bd/2 6/2 {Battle} Alien Unit.
// PARKED (see header): three missing primitives — a "[Discard two cards]"
// bracketed cast cost, a play-directly-into-formation mode, and a
// play-from-bin action. Registered bare so the card still enters DECK_LIST
// and plays as an ordinary [2] {Battle} 6/2 out of hand.
// ⚠ TRANSCRIPTION: the "[Discard two cards]" line is left inside `text` by the
// extractor (it is neither `ambush` nor `discardMe`), and the printed text
// never says which of the two alternative modes the discard pays for.
card('Trench Stalker', {});

// ─────────────────────── METAL / DARK (md) ────────────────────────────

// "Double all counters on units and players." — md/4 {Battle} Technology
// Spell. ⚠ Header: a unit's counters are ONE signed net total, so doubling
// doubles the net (a -2 unit becomes -4); a player's counters are rot and
// debt (R38/R39), the only two that exist. Region-scoped at resolution
// (R12/R25): the units in the battle region and the seats present there.
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
// PARKED (see header): a replacement effect on COUNTER PLACEMENT. The engine
// has two narrow replacement hooks (rot damage, combat damage to a player)
// and no framework; E.addCounters has no hook. The inert augmentText entry
// keeps the card recognised as an augment (Stasis Sentry precedent); it plays
// as a 0/5 meanwhile.
// ⚠ TRANSCRIPTION: the printed NAME is misspelled ("Counter Theif") in the
// card data; registered under the printed spelling deliberately.
card('Counter Theif', {
  augmentText: [{
    type: 'triggered', events: [],   // PARKED — never fires
    label: 'counters placed on units during battle are placed on me instead (not implemented)',
    effect: { run: () => { /* PARKED */ } },
  }],
});

// "[Augment] [once] Discard a card or sacrifice another nontoken unit:
// Glimpse 2." — md/2 2/2 Occult Technology Unit. An ACTIVATED ability in the
// [Augment] text box, bounded by [once] (R9).
//
// R49: the either/or line is a real ACTIVATION cost (`discardOrSacrifice: 1`)
// — it GATES the activation (with an empty hand and no other nontoken unit the
// ability is neither offered nor accepted, and the [once] budget is not spent)
// and is chosen and paid in the cast window, before the item reaches the
// stack. "Another" is the engine's own rule: the ability's source is excluded
// from the sacrifice pool, and so are tokens.
// Glimpse 2 = R45 (reveal two, cache ONE of your choice — playable this turn —
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
// card's own ability — and it has to exist in two shapes, because R40 routes
// the two cases differently:
//   #0 self: true — "you discard ME". A trashed card's own trigger fires from
//      the BIN (E.fireOwnTrashTrigger), which only ever dispatches self:true
//      'trashed' abilities and gives them a detached ghost source.
//   #1 no self — "or another card". This one belongs to a Swarmling IN PLAY
//      and the ordinary listener scan dispatches it, which is also what
//      excludes the trigger source itself (R40).
// Both narrow to `from === 'hand'` (a DISCARD, not a mill or a death) and to
// my own bin ("you discard"). ⚠ The copy is a TOKEN copy (header). The [1] is
// a mid-resolution pay-or-decline (R6).
const swarmlingCopy: EffectDef = {
  run: (g, ctx) => {
    if (g.openMana(ctx.controller) < 1 || inEndOfTurn(g)) return;
    const pay = ctx.choose('pay', {
      kind: 'payOrDecline', seat: ctx.controller,
      prompt: 'Swarmling: pay [1] to create a copy of me?',
      options: [
        { label: 'Pay [1] — create a copy', value: true },
        { label: 'Decline', value: false },
      ],
    });
    if (!pay) return;
    g.payMana(ctx.controller, 1);
    // R52: a created unit arrives in its CONTROLLER's home region
    g.spawnUnit(ctx.controller, 'Swarmling', g.homeRegion(ctx.controller), { token: true });
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
// normally and it spawns (spawn triggers fire). Both conditions are checked
// at resolution, so activating it early wastes the budget.
card('Gridxlan', {
  augmentText: [{
    type: 'activated', cost: {}, bounded: true,
    label: 'with an empty hand, play a unit from your bin (during deployment)',
    effect: {
      run: (g, ctx) => {
        if (g.s.phase !== 'deploy') {
          g.ev('info', 'Gridxlan: only during deployment — no effect.');
          return;
        }
        if (g.player(ctx.controller).hand.length > 0) {
          g.ev('info', 'Gridxlan: your hand is not empty — no effect.');
          return;
        }
        const bin = g.player(ctx.controller).bin;
        const opts = bin
          .map((name, i) => ({ label: name, value: i, card: name }))
          // a SPELL UNIT counts as a unit for bin purposes (it spawns its
          // body) — the convention every other bin search in the set uses
          .filter(o => isUnitCard(bin[o.value]!)
            && g.canPayCard(ctx.controller, bin[o.value]!));
        if (!opts.length) {
          g.ev('info', 'Gridxlan: no playable unit in your bin.');
          return;
        }
        const pick = ctx.choose('pick', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Gridxlan: play a unit from your bin',
          options: [...opts, { label: 'Decline', value: -1 }],
        }) as number;
        if (pick < 0) return;
        const name = bin[pick];
        if (name === undefined || !isUnitCard(name)
          || !g.canPayCard(ctx.controller, name)) return;
        bin.splice(pick, 1);
        g.payCard(ctx.controller, name);
        g.ev('info', `Gridxlan: ${g.pname(ctx.controller)} plays ${name} from the bin.`);
        g.spawnUnit(ctx.controller, name, ctx.region);
      },
    },
  }],
});

// "[Augment] Whenever I am dealt damage, each opponent gains a rot." — ed/3
// 0/5 Alien Unit. Text-box [Augment], self-scoped 'damage' (combat damage
// included — every damage path emits the event with `unit`). R38: gaining rot
// is not damage and has no consequence beyond the event; "each opponent" is
// region-scoped (R25). A 0/5 body means it survives to fire repeatedly.
card('Rotwall', {
  augmentText: [{
    type: 'triggered', events: ['damage'], self: true,
    label: 'each opponent gains a rot (I was dealt damage)',
    effect: {
      run: (g, ctx) => {
        for (const seat of opponentsIn(g, ctx.region, ctx.controller)) g.gainRot(seat, 1);
      },
    },
  }],
});

// ─────────────────────── FIRE / DARK (rd) ─────────────────────────────

// "[Augment] [once] Discard X cards: Each opponent sacrifices X units." —
// rd/6 6/8 Bedlam Alien Unit. An ACTIVATED ability in the [Augment] text box,
// bounded by [once] (R9). X is the activator's choice, made by discarding one
// card at a time until they stop (⚠ header: the cost is paid at resolution).
// Every discard is a TRASH (R40) and fires whatever trash triggers it should.
// Then each opponent (region-scoped, R25) sacrifices X of their own units,
// choosing which; all of an opponent's picks are gathered before any of them
// is destroyed, so a pick cannot be invalidated by an earlier one.
card('No Hand Killer', {
  augmentText: [{
    type: 'activated', cost: {}, bounded: true,   // [once]
    label: 'discard X cards: each opponent sacrifices X units',
    effect: {
      run: (g, ctx) => {
        let x = 0;
        for (let k = 0; k < 40; k++) {
          const hand = g.player(ctx.controller).hand;
          if (!hand.length) break;
          const v = ctx.choose(`discard:${k}`, {
            kind: 'payOrDecline', seat: ctx.controller,
            prompt: `No Hand Killer: discard a card (X = ${x} so far)`,
            options: [
              ...hand.map((name, i) => ({ label: name, value: i as unknown, card: name })),
              { label: 'Done', value: -1 },
            ],
          }) as number;
          if (v < 0) break;
          if (g.discardFromHand(ctx.controller, v) === undefined) break;
          x++;
        }
        if (x === 0) { g.ev('info', 'No Hand Killer: X = 0 — nothing is sacrificed.'); return; }
        for (const seat of opponentsIn(g, ctx.region, ctx.controller)) {
          const picks: EntityId[] = [];
          for (let k = 0; k < x; k++) {
            const pool = g.unitsOf(seat, ctx.region).filter(u => !picks.includes(u.id));
            const id = pickUnit(ctx, `sac:${seat}:${k}`, seat, pool,
              `No Hand Killer: sacrifice a unit (${k + 1} of ${x})`);
            if (id === null) break;
            picks.push(id);
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
