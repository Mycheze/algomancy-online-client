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
 * R37 (applying a mod is not playing), R40 (trash), R47 (the Wraith token).
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
 *  - X-MANY TARGETS (Blight's End) are mid-resolution chooses: TargetSpec.count
 *    is fixed at definition time and X is only known after the cast payment
 *    (the Torrential Reclamation / Channel Through precedent). Opponents
 *    respond to the spell, not to the picks.
 *  - REPLACEMENT EFFECTS that the engine has no hook for (Arbiter of Vitality's
 *    doubled life change, Proliferating Slime's "plus one counter") are
 *    modelled as TRIGGERS that top the amount up afterwards. The engine has
 *    exactly two replacement hooks (replaceRotDamage, replaceCombatDamage-
 *    ToPlayer) and neither covers life or counters. Observable differences:
 *    the top-up lands after the original amount rather than instead of it, and
 *    two copies of the card add 1x each instead of compounding. Each card
 *    documents its own guard against re-triggering itself.
 * ✔ "[Battle]" ON AN ACTIVATED ability is `ActivatedAbility.timing` now (R49),
 *    enforced at ACTIVATION: Cadaverous Cultivator is not offered during
 *    deployment and apply() refuses it there.
 *
 * PARKED (needs engine machinery that does not exist yet):
 *  - Deferral Drone: "the next card you play this turn costs [3] less" needs
 *    the cost-modification layer that docs/08 puts out of scope (canPayCard /
 *    payCard read printed mana only — the Stasis Sentry / The Silent
 *    precedent). Registered with inert [Augment] text so it plays as a 2/2 and
 *    is still recognised as an augment. Deliberately NOT activatable: the only
 *    half that DOES exist is "gain 4 debt", and offering the cost without the
 *    benefit would be strictly worse than the printed card.
 *  - Vengeance: "Cards your opponents play during battle gain '[Sacrifice a
 *    unit]'" IMPOSES an additional cast cost on other players' cards — the
 *    same missing layer, from the other side. Inert [Augment] text; plays as a
 *    7/9.
 *
 * UNPARKED by the R51 wave: Inexorable Miasma's second sentence ("After
 * combat, if I am in your bin …") is a `zone: 'bin'` trigger — see R51 and the
 * card's own comment.
 */
import type { Attr, Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, getCard, type EffectCtx, type EffectDef } from '../dsl.ts';

// ─────────────────────────── shared helpers ───────────────────────────

const isEnt = (t: unknown): t is Entity => !!t && typeof t === 'object' && 'id' in t;

/** [name, binIndex] pairs of `seat`'s bin cards passing a filter (the
 * batch-fire-b helper — bins hold bare names, so index is the handle) */
const binMatches = (g: E, seat: Seat, ok: (name: string) => boolean): [string, number][] =>
  g.player(seat).bin.map((n, i) => [n, i] as [string, number]).filter(([n]) => ok(n));

/** "unit" for bin/zone purposes: a card that enters play as a unit */
const isUnitCard = (name: string): boolean => {
  const k = getCard(name).kind;
  return k === 'unit' || k === 'spellUnit';
};

/** pick one of `pool` (auto when forced); null on an empty pool. Callers plan
 * every pick before mutating — the engine rolls back to the part boundary and
 * replays on suspension. */
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

/** every attribute the pool can print (types.ts `Attr`), for The Omniphage's
 * per-attribute statics. {Pure} is in the union but PARKED engine-side; it is
 * copied like any other name and the engine simply ignores it. */
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
// PARKED (see header): the narrow cost-modification layer does not exist, and
// wiring only the "gain 4 debt" half would hand the player a cost with no
// benefit. Inert augmentText — the card plays as a 2/2 and is recognised as an
// augment, but the ability is never offered.
card('Deferral Drone', {
  augmentText: [{
    type: 'triggered', events: [],   // PARKED — never fires
    label: 'gain 4 debt: the next card you play this turn costs [3] less (not implemented)',
    effect: { run: () => { /* PARKED */ } },
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
// ⚠ The bracketed [Discard a card] is a cast-time additional cost (R35) but
// CastCost only knows `sacrificeUnit`, so it is paid at RESOLUTION (header):
// an empty hand means the cost cannot be paid and the effect is SKIPPED, the
// closest available reading of "the cast is illegal". The discard TRASHES the
// card (R40) — which is the point of the card in a dark deck. Bounded graft
// ([Switch1], R9); on a graft the CARRIER's controller pays and the carrier
// aims the 5 damage.
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
// R47: the retired "Wight" and the current "Wraith" are one token; augmentWraith() creates it directly
// as an augment MOD on the host rather than spawning the body, and the mod is
// a token so it is erased (never binned, never trashed) when it leaves play.
// ⚠ X-many targets are mid-resolution picks (header) — X is paid at cast
// (R35) and read from ctx.x. "Target units" is unqualified, so an ENEMY unit
// is a legal host: the Wraith's donated "[Augment] When I attack or block, put
// a -1/-1 counter on me" then shrinks THEM. X = 0 does nothing (the card does
// not print "X can't be zero", so xMin stays at the default 0).
card("Blight's End", {
  spellEffect: {
    run: (g, ctx) => {
      const x = ctx.x ?? 0;   // chosen and paid at cast (R35)
      if (x <= 0) { g.ev('info', "Blight's End: X = 0 — no effect."); return; }
      // plan every pick first, then commit (attaching a mod fires triggers)
      const picked: EntityId[] = [];
      for (let i = 0; i < x; i++) {
        const pool = g.unitsIn(ctx.region).filter(u => !picked.includes(u.id));
        const id = pickUnit(ctx, `host:${i}`, ctx.controller, pool,
          `Blight's End: augment a Wight onto which unit? (${i + 1} of ${x})`);
        if (id === null) break;
        picked.push(id);
      }
      for (const id of picked) {
        const host = g.entity(id);
        if (host) g.augmentWraith(host, ctx.controller);
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
      if (isEnt(t)) g.addTempAttr(t, 'Poisonous');
    },
  },
  abilities: [{
    type: 'triggered', events: ['afterCombat'], zone: 'bin',
    label: 'remove a -1/-1 counter from a unit to recall me from your bin',
    effect: {
      run: (g, ctx) => {
        const me = g.player(ctx.controller).bin.lastIndexOf('Inexorable Miasma');
        if (me === -1) return;                      // left the bin before this resolved
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
        if (choice === -1) return;
        const u = g.entity(choice as EntityId);
        if (!u) return;
        g.addCounters(u, 1);                        // net counters: +1 removes a -1/-1
        const idx = g.player(ctx.controller).bin.lastIndexOf('Inexorable Miasma');
        if (idx === -1) return;
        g.player(ctx.controller).bin.splice(idx, 1);
        g.player(ctx.controller).hand.push('Inexorable Miasma');
        g.ev('info', `Inexorable Miasma is recalled from ${g.pname(ctx.controller)}'s bin to their hand.`);
      },
    },
  }],
});

/** ⚠ re-entrancy guard for Proliferating Slime's top-up (the engine's own
 * `inStatics` pattern): the extra counter is itself a counter event, so
 * without this a Slime would proliferate its own proliferation forever. It is
 * set and cleared inside ONE synchronous run() with no ctx.choose in between,
 * so it never has to survive a suspension/rollback and is deliberately kept
 * out of the serialized game state. Two Slimes still add one each: the guard
 * only suppresses NEW triggers raised by a top-up, and both Slimes already
 * queued off the original event. */
let proliferating = false;

/** "an enemy unit or player" — enemy of the Slime's controller */
const slimeEnemyUnit = (g: E, self: Entity, ev: { data?: Record<string, unknown> }): boolean => {
  if (proliferating) return false;
  const uid = ev.data?.['unit'] as EntityId | undefined;
  const u = uid !== undefined ? g.entity(uid) : undefined;
  return !!u && u.controller !== self.controller && ((ev.data?.['n'] as number | undefined) ?? 0) !== 0;
};

// "[Augment] If one or more counters would be put on an enemy unit or player,
// put that many counters plus one instead." — gd/2 1/2 {Virus} Blight Slime
// Unit.
//
// ⚠ REPLACEMENT APPROXIMATION (header): the engine has no counter-replacement
// hook, so this is a trigger that adds the "plus one" AFTER the original
// counters land. The extra counter has the SAME SIGN as the ones that were
// put ("that many counters plus one" — one more of the same thing), so a
// -1/-1 counter on an enemy becomes two.
//
// ⚠ INTERPRETATION: "or player" is read as ROT and DEBT, the expansion's two
// player counters (docs/08: "A counter accumulated by a PLAYER" for both).
// No other counter can be put on a player, so the clause would otherwise be
// dead text. Flagged in the batch report.
card('Proliferating Slime', {
  augmentText: [
    {
      type: 'triggered', events: ['countersChanged'],
      label: 'put one more counter on that enemy unit',
      when: (g, self, ev) => slimeEnemyUnit(g, self, ev),
      effect: {
        run: (g, ctx) => {
          const uid = ctx.event?.data?.unit as EntityId | undefined;
          const n = (ctx.event?.data?.n as number | undefined) ?? 0;
          const u = uid !== undefined ? g.entity(uid) : undefined;
          if (!u || n === 0) return;
          proliferating = true;
          try { g.addCounters(u, n > 0 ? 1 : -1); } finally { proliferating = false; }
        },
      },
    },
    {
      type: 'triggered', events: ['rotGained', 'debtGained'],
      label: 'give that enemy player one more rot/debt',
      when: (_g, self, ev) => !proliferating && ev.data?.seat !== self.controller,
      effect: {
        run: (g, ctx) => {
          const seat = ctx.event?.data?.seat as Seat | undefined;
          if (seat === undefined) return;
          const isRot = ctx.event?.type === 'rotGained';
          proliferating = true;
          try {
            if (isRot) g.gainRot(seat, 1); else g.gainDebt(seat, 1);
          } finally { proliferating = false; }
        },
      },
    },
  ],
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
