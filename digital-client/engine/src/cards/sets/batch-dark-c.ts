/* Light & Dark expansion — batch dark-c (18 cards).
 *
 * Behaviour only; printed data comes from printed.json (never hand-copied).
 * Spec for the expansion's new mechanics: docs/08-light-and-dark.md,
 * rulings R38-R48 in docs/digital-rules.md.
 *
 * Cards in this batch:
 *   Blightwalker
 *   Collect Remains
 *   Cthyrian Rector
 *   Entropic Entity
 *   Finality
 *   Grox
 *   Its Dark Bubb
 *   Lurking Dread
 *   Murkdrop Distiller
 *   Necromorph
 *   Pallid Gorger
 *   Primordial Coalescence
 *   Rotling
 *   Scholar of the Void
 *   Spellbind
 *   Thoughtripper
 *   Unrelenting Horror
 *   Xzydris
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 * `[once]` on a trigger/activation = bounded (R9).
 *
 * Rulings leaned on: R5 (fizzle vs partial), R6 (payments are part of
 * resolution, via ctx.choose), R9 (bounded budgets per card), R12/R25
 * (regions are exclusive; "each opponent" reads the event region's present
 * seats), R115 (created units arrive where their SOURCE is — ctx.region),
 * R37 (applying a mod is not playing a card), R38 (rot), R40 (trash),
 * R41/R45 (the cache; glimpse-style until-end-of-turn permission), R71 (the
 * Wraith token).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - "target card in a/your bin" (Blightwalker, Collect Remains, Necromorph)
 *    IS engine targeting now: R64 gave TargetSpec a bin scope — 'binCard' for
 *    your own, 'anyBinCard' for either player's, resolved through BinRef at
 *    resolution so an index can never go stale. All three cards declare it, so
 *    the pick is made on the way to the stack and can be responded to. (This
 *    entry used to say the bin had no scope and the pick was a resolution-time
 *    ctx.choose.)
 *  - (Grox's "erase two cards in your bin" used to be listed here as a
 *    resolution-time approximation. It is a real bracketed CastCost now —
 *    kind 'eraseBin' — collected in the cast window like any other, which also
 *    stops grafted riders resolving off an unpayable cost.)
 * ✔ "ERASE ME" ON A SPELL IS REAL NOW (CARD-TODO #15). This entry used to say
 *    it was approximated by the spell being binned normally, because "an
 *    effect has no handle on its own stack item". It has one: `ctx.eraseSelf()`
 *    raises `StackItem.eraseSelf`, and `E.dischargeItem` — the single choke
 *    point through which a resolving or negated item's card leaves the stack —
 *    sends it to the erased pile (R65) instead of a bin. Collect Remains can
 *    no longer be recurred out of the bin, which is the point of the clause on
 *    a bin-recursion spell. Same seam as Temporal Rift and Suspend.
 *    ⚠ It is part of the EFFECT, so a NEGATED Collect Remains is binned
 *    normally (R68: the effect does nothing, and the erase is a sentence of
 *    it) — unlike R79's {Unstable}, which is a stamp on the card and survives
 *    negation. Pinned by 89-self-erase.
 * ✔ Pallid Gorger's "Discard a card or sacrifice a nontoken unit:" is a real
 *    ACTIVATION cost now (R49, `discardOrSacrifice: 1`): it gates the
 *    activation and is paid in the cast window, before the item reaches the
 *    stack.
 *  - ⚠ STILL AT RESOLUTION: Grox's "Erase two cards in your bin:" — a BIN-ZONE
 *    cost, which AbilityCost does not model (its atoms are life / debt /
 *    discard N / sacrifice-another N / discard-or-sacrifice N). Consequence for
 *    a graft CAUSE: the grafted riders still resolve even when the bin turns
 *    out too small to pay (Deformant has the same hole).
 * ✔ "[Battle]" on Grox's activated ability is `ActivatedAbility.timing` now
 *    (R49), enforced at ACTIVATION: Grox is neither offered nor accepted during
 *    deployment.
 *  - "EXCHANGE" (Necromorph) is modelled as delete-then-spawn: the unit in
 *    play is deleted (dies → its owner's bin → R40 trash, death triggers fire)
 *    and the bin unit is spawned in its place, in the same region and, in
 *    battle, in the same formation slot (the ambushSwap pattern).
 * ✔ ENTROPIC ENTITY's "a unit with counters on it despawns" reads
 *    `ev.data.counters`: 'died'/'despawned' fire after the entity is already
 *    out of s.entities, so the event now carries the leaving unit's counter
 *    count. (It used to keep a module-level Map keyed on EntityId — which
 *    leaked across games, since nextId restarts at 1.)
 *
 * UNPARKED by the R49/R50/R51 engine wave:
 *  - Lurking Dread (bin AND cache) and Xzydris (bin) are `zone:` triggers —
 *    R51 dispatches to cards sitting in a zone, anchored on a detached
 *    stand-in owned by the zone's seat.
 *  - Xzydris and Scholar of the Void hear the new 'startOfDeployment' event.
 *
 * PARKED (needs engine primitives that do not exist — see the report):
 *  - Rotling is UNPARKED as of R124: E.removeFromBin is the choke point every
 *    bin removal in the tree goes through, and it fires the 'leftBin' event
 *    the card was waiting on. See the card comment — which now also carries
 *    the OTHER half of its printed marker: `[Switch1]` makes the sentence a
 *    bounded GRAFTABLE effect, and the card had no `graftEffect`, so it was
 *    the one card in the pool with a [Switch]-marked effect that could not be
 *    grafted at all.
 *  - Scholar of the Void is UNPARKED as of R101 (playtest ledger #24). The
 *    owner supplied the "Beyond, Codex Incarnate" card face on 2026-08-22, so
 *    the transform target exists (a registerSynthetic in registry.ts); and no
 *    "transform machinery" was needed after all — `Entity.card` is the card's
 *    identity, so turning it over is one assignment. The only clause still
 *    parked is BEYOND's own rot replacement, which prints "target unit" and
 *    sits on a hook with no decision window; see the card comment and R101.
 *  - Its Dark Bubb WORKS as of R93 (playtest report #73, 2026-08-22). {Inverted}
 *    is stat layer 5 and it now exists: layer 5 negates the NET stat change
 *    from base, i.e. `2*base - current`, applied after layer 4. Caleb worked
 *    the arithmetic out himself — "1/4 tough balanced is 8/8 … If we compare
 *    8/8 to 1/4, it's +7/+4. Which also works to invert to a -6/0". The card
 *    needed NO change here at all: the whole card is the printed attribute,
 *    and the layer does the rest.
 *  - ⚠ TRASH TRIGGERS CANNOT CARRY GRAFT RIDERS (Blightwalker's [Switch1]) —
 *    and R51 did NOT change that, because it is structural rather than a
 *    missing hook: a MODDED unit that dies is ERASED (Unstable) and never
 *    reaches a bin at all, so a card that IS trashed provably carries no mods.
 *    Documented as a known limitation in docs/digital-rules.md (R51).
 */
import type { Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, eventBinSlot, notSelfBinCard, type EffectDef } from '../dsl.ts';
import { transformsInto } from '../registry.ts';
import { selfOf, isEnt, manaOf, isUnitCard } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** [name, binIndex] pairs of `seat`'s bin passing a filter */
const binMatches = (g: E, seat: Seat, ok: (name: string) => boolean): [string, number][] =>
  g.player(seat).bin.map((n, i) => [n, i] as [string, number]).filter(([n]) => ok(n));

/** R25: the opponents an effect resolving in `region` can reach */
const opponentsIn = (g: E, region: number, me: Seat): Seat[] =>
  g.s.regions[region]!.presentSeats.filter(s => s !== me);

/** the formation slot an entity occupies right now, if any (ambushSwap's
 * bookkeeping: found BEFORE anything moves, so a replacement can take it) */
function formationSlot(g: E, id: EntityId): { col: EntityId[]; idx: number } | null {
  const b = g.s.battle;
  if (!b) return null;
  for (const col of [...b.columns, ...Object.values(b.blocks)]) {
    const idx = col.indexOf(id);
    if (idx !== -1) return { col, idx };
  }
  return null;
}

// ───────────────────────────── the cards ──────────────────────────────

// "When I am trashed, [Switch1] You may pay [2] to recall another target unit
// from your bin. (Put it into your hand.)" — d/3 2/2 Alien Unit. R40: the
// trash trigger fires FROM THE BIN, however the card got there (discarded,
// milled, sacrificed, died in combat), and ctx.sourceId resolves to nothing —
// nothing here reads it. R64: the bin card is a DECLARED target ('binCard',
// see the spec below) — the "⚠ the bin is not a targetable zone" line that
// used to sit here was contradicted seven lines down.
//
// R131: "another" excludes ONE THING — the Blightwalker that just landed in
// the bin — not every card named Blightwalker there. It used to compare card
// names, so a bin already holding a Blightwalker offered neither of them.
// A bin has no entity ids to compare, but R64/R124 already fixed identity
// there: a BinRef is (name, nth occurrence), and `noteTrashed` stamps this
// copy's `binNth` on the 'trashed' event. `notSelfBinCard` reads it.
// [Switch1] on the trigger makes it a bounded graft CAUSE as well as a
// bounded graftable effect — though a card sitting in the bin carries no
// mods, so nothing ever rides along on the trash firing itself.
const blightwalkerRecall: EffectDef = {
  // R64: "another target unit from your bin" — a declared target, chosen as
  // the trigger goes on the stack. min 0 carries the "you may": declining is
  // simply choosing nothing. The [2] stays a resolution-time pay-or-decline —
  // it is optional mana, not a bracketed cost.
  targets: {
    what: 'binCard', min: 0,
    prompt: 'Blightwalker: pay [2] to recall another target unit from your bin',
    restrict: (g, t, ctx) => 'binCard' in t && isUnitCard(t.binCard.card) && notSelfBinCard(g, t, ctx),
  },
  run: (g, ctx) => {
    const seat = ctx.controller;
    const t = ctx.targets[0];
    if (!t || !('binCard' in t) || t.binCard.index === -1) {
      g.ev('info', 'Blightwalker: no card is targeted (or it left the bin) — nothing is recalled.');
      return;
    }
    if (g.openMana(seat) < 2) { g.ev('info', 'Blightwalker: cannot pay [2].'); return; }
    const pays = ctx.choose('pay', {
      kind: 'payOrDecline', seat,
      prompt: `Blightwalker: pay [2] to recall ${t.binCard.card} from your bin?`,
      options: [{ label: 'Pay [2]', value: 1 }, { label: 'Decline', value: 0 }],
    }) as number;
    if (!pays) { g.ev('info', 'Blightwalker: the [2] is declined — nothing is recalled.'); return; }
    const name = g.player(seat).bin[t.binCard.index];
    if (name === undefined) { g.ev('info', 'Blightwalker: the card left the bin — nothing is recalled.'); return; }
    g.payMana(seat, 2);
    g.removeFromBin(seat, t.binCard.index, 'recalled');   // R124
    g.player(seat).hand.push(name);
    g.ev('info', `Blightwalker recalls ${name} from ${g.pname(seat)}'s bin to their hand.`);
  },
};
card('Blightwalker', {
  abilities: [{
    type: 'triggered', events: ['trashed'], self: true, bounded: true, graftCause: true,
    label: 'you may pay [2] to recall another unit from your bin',
    effect: blightwalkerRecall,
  }],
  graftEffect: { bounded: true, effect: blightwalkerRecall },
});

// "Put target card in a bin into your hand. Erase me." — dd/2 {Battle} Blight
// Spell. "A bin" is unowned, so EITHER player's bin is fair game ('anyBinCard')
// and the card comes to the caster's hand. R64: it is a real declared target
// now — it used to be a mid-resolution pick, so the spell sat on the stack
// aiming at nothing. "Erase me" is still approximated by the spell being
// binned normally afterwards.
card('Collect Remains', {
  spellEffect: {
    targets: { what: 'anyBinCard', prompt: 'Collect Remains: put target card in a bin into your hand' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (t && 'binCard' in t && t.binCard.index !== -1) {
        const bin = g.player(t.binCard.seat).bin;
        const name = bin[t.binCard.index];
        if (name !== undefined) {
          g.removeFromBin(t.binCard.seat, t.binCard.index, 'recalled');   // R124
          g.player(ctx.controller).hand.push(name);
          g.ev('info', `Collect Remains: ${name} goes from ${g.pname(t.binCard.seat)}'s bin to ${g.pname(ctx.controller)}'s hand.`);
        }
      }
      // "Erase me." — the second sentence, and it is why the two are printed
      // together: this is bin recursion that takes ITSELF out of the game, so
      // it can never be recurred by the next copy. Unconditional given the
      // spell resolves at all, which is why it sits outside the guard above —
      // a bin card that vanished between cast and resolution does not save the
      // Remains from its own text. R65: dischargeItem sends the card to the
      // erased pile instead of the bin (StackItem.eraseSelf).
      ctx.eraseSelf();
    },
  },
});

// "[Augment] When you trash another card, sacrifice me. If you do, recall
// that card from your bin." — d/1 0/1 {Virus} Blight Zombie Unit. Text-box
// [Augment]: live while it is a unit in play, donated when it Virus-augments
// a host — and then "me" is the HOST and "you" is the host's controller, so
// the Virus reads as "the next card you trash costs you this unit".
// "Another card" is free: the trash-side dispatch only reaches units IN PLAY,
// and a card being trashed is by definition not one (R40).
//
// R73 (2026-08-22): "sacrifice me. If you do, …" is a CAST COST — the same
// printed shape, and the same ruling, as Eldritch Dreamtender. The sacrifice
// used to be a g.destroy() at resolution; it is now paid on the way to the
// stack, which is also what makes the "nothing to sacrifice" guard unnecessary
// (an unpayable cost skips the part outright, R5).
card('Cthyrian Rector', {
  augmentText: [{
    type: 'triggered', events: ['trashed'],
    label: 'sacrifice me — recall the trashed card from your bin',
    when: (_g, self, ev) => ev.data?.['seat'] === self.controller,
    effect: {
      castCost: { kind: 'sacrificeUnits', from: 'self', n: 1 },
      run: (g, ctx) => {
        // R140: "THAT card" — the copy the trash event was about, resolved
        // from the event's own `binNth` stamp (R131's (name, nth) bin
        // identity) by `eventBinSlot`. This used to be a name search of the
        // bin, which answers "the last copy of that name in the bin right
        // now": a different question, and a different card once the trashed
        // copy has been swept out (a token, or an {Unstable} death under
        // R137). What the search found then was an INNOCENT older copy, which
        // this card recalled to hand having already paid its sacrifice. A miss
        // is "gone" — never "take the other one".
        const slot = eventBinSlot(g, ctx.event);              // "if you do"
        if (!slot) return;
        // `when` pins the trashed seat to the controller, so slot.seat is
        // "your bin" and the recall lands in the same player's hand.
        if (slot.index === -1) { g.ev('info', `Cthyrian Rector: ${slot.card} is no longer in the bin.`); return; }
        g.removeFromBin(slot.seat, slot.index, 'recalled');   // R124
        g.player(ctx.controller).hand.push(slot.card);
        g.ev('info', `Cthyrian Rector recalls ${slot.card} to ${g.pname(ctx.controller)}'s hand.`);
      },
    },
  }],
});

// "When a unit with counters on it despawns, [Switch1] Draw a card." — d/3
// 0/3 Alien Anima Unit. Despawn = ANY leave-play, died included (the
// Celestial Fluxmorph / Bloated Manablub reading). Region-scoped like every
// listener (R12).
//
// ⚠ header: the counter count cannot be read at trigger time — destroy() and
// recall() both delete the entity BEFORE firing, and the event data carries
// only { unit, card, seat, region }. So the counters are cached by a
// The counter count comes off the EVENT (`data.counters`), not off the entity:
// 'died'/'despawned' fire once the unit is already out of s.entities, so there
// is nothing left to read. The event carries it for exactly this reason.
//
// ⚠ This replaced a module-level `Map<EntityId, number>` ledger written from a
// bookkeeping static. That ledger lived OUTSIDE GameState and was never
// cleared, and GameState.nextId restarts at 1 for every new game — so entity
// ids were reused and game 2's unit #42 inherited game 1's counter reading.
// Anything a card remembers between events has to live in the state or on the
// event, never in a module singleton keyed on game-state identity.
const entropicDraw: EffectDef = { run: (g, ctx) => g.draw(ctx.controller, 1) };
card('Entropic Entity', {
  abilities: [{
    type: 'triggered', events: ['died', 'despawned'], bounded: true, graftCause: true,
    label: 'draw a card (a unit with counters despawned)',
    when: (_g, _self, ev) => ((ev.data?.['counters'] as number | undefined) ?? 0) !== 0,
    effect: entropicDraw,
  }],
  graftEffect: { bounded: true, effect: entropicDraw },
});

// "Negate all other effects. Erase all cards in bins." — dd/5 {Battle} Blight
// Spell. "All OTHER effects" is every item still on the stack: Finality has
// already been popped by the time it resolves, so it can never negate itself.
//
// R128 CONFIRMS THE SWEEP AS WRITTEN. The audit had flagged this loop as
// possibly too wide, because it negates a {Battle} unit mid-cast and R60 said
// a unit on the stack was not an effect at all. The owner reversed R60 on
// 2026-08-24 — "ANYTHING on the stack is an effect, including units and spell
// units" — so a bare `[...g.s.stack]` is exactly "all other effects" and this
// must NOT be narrowed. Same for Return to Nature and Temporal Rift. (Contrast
// Molten Riftbreaker, which prints "all allied SPELLS" and does filter by
// kind: a unit is an effect but is not a spell, which is the other half of the
// same sentence.)
// Erasing empties BOTH bins — erasing never touches a bin again (R40), so
// nothing here is a trash. Finality itself is binned afterwards, from the
// stack, exactly as printed (it was never in a bin to be erased).
card('Finality', {
  spellEffect: {
    run: (g, _ctx) => {
      const hits = [...g.s.stack];   // R68: everything still here is un-negated
      for (const i of hits) g.negate(i.id);
      if (!hits.length) g.ev('info', 'Finality: no other effects to negate.');
      for (const p of g.s.players) {
        if (!p.bin.length) continue;
        const n = p.bin.length;
        const gone = [...p.bin];
        // R124: a bulk wipe still leaves one card at a time — back-to-front,
        // each firing its own 'leftBin'. No storm: the leftBin dispatch is
        // per-name (only the card that left hears its own leaving).
        while (p.bin.length) g.removeFromBin(p.seat, p.bin.length - 1, 'erased');
        g.ev('erased', `Finality ERASES all ${n} card(s) in ${p.name}'s bin.`, { seat: p.seat, n, cards: gone });
      }
    },
  },
});

// "[Battle] Erase two cards in your bin: [Switch]" — d/2 2/2 Alien Unit. The
// [Switch] carries NO text of its own: this ability is purely a graft CAUSE
// (the Manual's socket), so grafted riders are the whole point and the card
// has no graftEffect to donate. R49: the printed "[Battle]" marker is
// `timing: 'battle'` now — enforced at ACTIVATION, so Grox is not offered and
// not accepted during deployment.
//
// UN-PARKED (R64). This note used to read "⚠ still at resolution: 'erase TWO
// CARDS IN YOUR BIN' is a bin-zone cost, which AbilityCost does not model …
// Consequence: grafted riders resolve even when the bin turns out too small to
// pay." Two things had changed under it: `CastCost` grew an `eraseBin` kind,
// and `collectCastCosts` runs for ACTIVATED items too (collectTargets calls it
// on the way to the stack, not just for spells). So the erase is now a real
// bracketed cost — chosen and paid before the socket is respondable — and the
// consequence is fixed with it: with fewer than two cards in the bin the cost
// is unpayable, so `abilityEffectUsable` refuses the activation outright and
// no rider gets a free ride.
//
// The [Switch] socket itself still carries no text; `run` exists only to say
// so, because an effect that resolves in silence is indistinguishable from a
// bug (see test/65-effect-conformance).
card('Grox', {
  abilities: [{
    type: 'activated', cost: {}, timing: 'battle', graftCause: true,
    label: '[Battle] Erase two cards in your bin: (graft cause)',
    effect: {
      castCost: { kind: 'eraseBin', n: 2 },
      run: (g, ctx) => {
        g.ev('info', `${ctx.sourceName}: the erase is paid — the socket itself carries no text.`);
      },
    },
  }],
});

// "(Invert the stat changes of inverted units. For example, -1/+2 would
// become +1/-2.)" — d/4 4/6 {Inverted} Slime Unit. Reminder text only: the
// whole card is the attribute, carried by printed.attrs.
//
// ⚠ THE LINE THAT USED TO SIT HERE — "the inversion itself is stat layer 5,
// which the engine does not have (Reality Bender's precedent)" — expired with
// R93 and was contradicted by this batch's own header ninety lines up. Layer 5
// is live in `E.effStats` (`2·base - cur`, applied after layer 4, deduped by
// `statLayerAttrs`), so this card genuinely works with no behaviour of its
// own. Nothing to add; only the note was wrong.
card('Its Dark Bubb', {});

// "After combat, you may sacrifice two non-token units to put me into play
// from your bin or from cache." — d/8 8/8 Polyform Unit.
//
// UNPARKED by R51: `zone` dispatches a trigger to a card sitting in a ZONE,
// anchored on a detached stand-in whose controller is the zone's owner. The
// card wants BOTH zones, so it registers the same effect twice — once from the
// bin, once from the cache — and the effect takes whichever copy it finds
// (bin first, the more common case). A card in both zones would fire twice,
// which is the honest reading: those are two different copies.
//
// "You MAY sacrifice two non-token units" is a cost with a choice, so it is
// paid at RESOLUTION via ctx.choose (the trigger is already on the stack by
// then — R35's cast window governs activations, not triggers): decline, or
// pick two nontoken units in the region. Plan-then-commit — both picks are
// gathered before anything is destroyed. "Put into play" is spawnUnit: it
// arrives directly, firing its spawn triggers, with no stack step.
const lurkingDread: EffectDef = {
  run: (g, ctx) => {
    const seat = ctx.controller;
    const inBin = g.player(seat).bin.lastIndexOf('Lurking Dread');
    const inCache = g.cache(seat).findIndex(cc => cc.card === 'Lurking Dread');
    if (inBin === -1 && inCache === -1) {   // already left the zone
      g.ev('info', 'Lurking Dread: it is no longer in a bin or cache — nothing happens.');
      return;
    }
    const pool = g.unitsOf(seat, ctx.region).filter(u => !u.token);
    if (pool.length < 2) {
      g.ev('info', 'Lurking Dread: fewer than two nontoken units to sacrifice — it stays where it is.');
      return;
    }
    const picks: EntityId[] = [];
    for (let k = 0; k < 2; k++) {
      const left = pool.filter(u => !picks.includes(u.id));
      const v = ctx.choose(`sac:${k}`, {
        kind: 'payOrDecline', seat,
        prompt: `Lurking Dread: sacrifice a nontoken unit to put me into play (${k + 1} of 2)`,
        options: [
          ...left.map(u => ({ label: u.card, value: u.id as unknown, card: u.card })),
          { label: 'Decline', value: -1 as unknown },
        ],
      }) as number;
      if (v < 0) {   // "you may" — declined
        g.ev('info', `Lurking Dread: ${g.pname(seat)} declines to sacrifice.`);
        return;
      }
      picks.push(v as EntityId);
    }
    for (const id of picks) {
      const u = g.entity(id);
      if (u) g.destroy(u, 'is sacrificed');
    }
    // take it out of whichever zone still holds it, then put it into play
    const bi = g.player(seat).bin.lastIndexOf('Lurking Dread');
    if (bi !== -1) g.removeFromBin(seat, bi, 'revived');   // R124
    else {
      const ci = g.cache(seat).findIndex(cc => cc.card === 'Lurking Dread');
      if (ci !== -1) g.uncache(seat, ci);
      else {
        g.ev('info', 'Lurking Dread: it is no longer in a bin or cache — it does not arrive.');
        return;
      }
    }
    g.spawnUnit(seat, 'Lurking Dread', ctx.region);
  },
};
card('Lurking Dread', {
  abilities: [
    {
      type: 'triggered', events: ['afterCombat'], zone: 'bin',
      label: 'sacrifice two nontoken units to put me into play from your bin',
      effect: lurkingDread,
    },
    {
      type: 'triggered', events: ['afterCombat'], zone: 'cache',
      label: 'sacrifice two nontoken units to put me into play from your cache',
      // only when the BIN copy is not already asking — otherwise one card in
      // both zones would queue two identical offers for the same body
      when: (g, self) => g.player(self.controller).bin.lastIndexOf('Lurking Dread') === -1,
      effect: lurkingDread,
    },
  ],
});

// "[once] When you trash another card, you may cache it. If you do, you may
// play it until end of turn." — d/3 2/3 Alien Unit. [once] = bounded (R9).
// R41/R45: cacheFromBin with { playable: true } is exactly the glimpse-style
// permission — the card leaves the bin for the cache, is public there, and
// may be played (paying its mana, ignoring affinity) until end of turn, after
// which it stays cached and inert. "Another card" is free: the dispatch only
// reaches units in play.
card('Murkdrop Distiller', {
  abilities: [{
    type: 'triggered', events: ['trashed'], bounded: true,
    label: 'you may cache the trashed card and play it this turn',
    when: (_g, self, ev) => ev.data?.['seat'] === self.controller,
    effect: {
      run: (g, ctx) => {
        // R140: "cache IT" is the copy the trash event was about, resolved by
        // R131's (name, nth) bin identity. `bin.lastIndexOf(name)` used to
        // stand in for it and answers a different question once that copy has
        // been swept out (token, or an {Unstable} death under R137): it finds
        // an INNOCENT older copy of the same name and would cache that one —
        // a card the player never trashed, moved out of their bin and made
        // playable. A wrong-copy miss is "gone", and "gone" refunds (R108/R113
        // — no offer could be made, so the [once] is not spent), exactly as
        // the empty-bin miss already did.
        const slot = eventBinSlot(g, ctx.event);
        if (!slot) return;
        const name = slot.card;
        if (slot.index === -1) {
          ctx.refundBudget?.();   // R113: no offer could be made, so the use is not spent
          g.ev('info', `Murkdrop Distiller: ${name} is not in your bin — there is nothing to cache.`);
          return;
        }
        const take = ctx.choose('cache', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Murkdrop Distiller: cache ${name} and play it until end of turn?`,
          options: [{ label: `Cache ${name}`, value: 1, card: name }, { label: 'Decline', value: 0 }],
        }) as number;
        if (!take) {
          ctx.refundBudget?.();   // R113: declining a "you may" never spends it
          g.ev('info', `Murkdrop Distiller: ${name} is left in the bin — nothing is cached.`);
          return;
        }
        // `ctx.choose` is not a coroutine — it throws and this run re-enters
        // from the top — so `slot.index` was resolved against the live bin on
        // the pass that got the answer, and needs no second lookup.
        g.cacheFromBin(slot.seat, slot.index, { playable: true });
      },
    },
  }],
});

// "Exchange target unit in play for target unit with cost less than or equal
// to it in its controller's bin." — dd/3 {Battle} Occult Spell. The unit in
// play is a real target (it can be an enemy's); its OWN controller's bin
// supplies the replacement and keeps controlling it.
// R64: BOTH are real targets, declared at cast — the card prints "target"
// twice and the bin half used to be a mid-resolution pick. The second slot's
// legality depends on the first (cost ≤ it, and IN ITS CONTROLLER'S bin),
// which is what TargetCtx.chosen is for; and the first slot is narrowed to
// units whose controller actually has a replacement, so the spell can never
// be aimed somewhere it must do nothing.
// The exchange is still delete-then-spawn (⚠ header): the outgoing unit dies
// (→ bin → R40 trash, death triggers fire) and the incoming one takes its
// region and, in battle, its formation slot.
const necroSwapFor = (g: E, victimCard: string, seat: Seat): [string, number][] =>
  binMatches(g, seat, n => isUnitCard(n) && manaOf(n) <= manaOf(victimCard));
card('Necromorph', {
  spellEffect: {
    targets: {
      what: 'unit', count: 2, min: 2,
      prompt: "Necromorph: exchange target unit for a cheaper one in its controller's bin",
      slots: ['unit', 'anyBinCard'],
      slotPrompts: [
        'Necromorph: exchange which unit in play?',
        "Necromorph: for which unit in that unit's controller's bin?",
      ],
      slotRestricts: [
        (g, t) => 'controller' in t && necroSwapFor(g, t.card, t.controller).length > 0,
        (g, t, ctx) => {
          const first = ctx.chosen?.[0];
          if (!first || !('controller' in first) || !('binCard' in t)) return false;
          return t.binCard.seat === first.controller
            && isUnitCard(t.binCard.card) && manaOf(t.binCard.card) <= manaOf(first.card);
        },
      ],
    },
    run: (g, ctx) => {
      const [t, b] = [ctx.targets[0], ctx.targets[1]];
      if (!isEnt(t) || !b || !('binCard' in b)) return;
      const victim = g.entity((t as Entity).id);
      if (!victim) {
        g.ev('info', 'Necromorph: the unit in play is gone — no exchange.');
        return;
      }
      const owner = victim.controller;
      // R56: a redirect can have moved the unit target since the cast, so the
      // pairing is re-checked here rather than trusted
      if (b.binCard.seat !== owner || b.binCard.index === -1
        || manaOf(b.binCard.card) > manaOf(victim.card)) {
        g.ev('info', `Necromorph: ${b.binCard.card} is no longer a legal exchange for ${victim.card} — no effect.`);
        return;
      }
      const name = b.binCard.card;
      const slot = formationSlot(g, victim.id);
      g.removeFromBin(owner, b.binCard.index, 'revived');   // R124
      const fresh = g.spawnUnit(owner, name, victim.region);
      if (slot) {
        slot.col[slot.idx] = fresh.id;                        // take the exact slot…
        g.ev('info', `${name} takes ${victim.card}'s position in the formation.`);
      }
      g.destroy(victim, 'is deleted');                        // …then the old one leaves
    },
  },
});

// "[Augment] Discard a card or sacrifice a nontoken unit: I gain +2/+2 until
// regroup." — d/2 1/1 {Virus} Alien Unit. An activated ability inside the
// [Augment] box: usable on the card itself when played normally (via
// 'augment') and on a host when donated (via { mod }), where "I" is the host
// and the host's controller pays. R49: the either/or line is a real ACTIVATION
// cost (`discardOrSacrifice: 1`) — it gates the activation and is chosen and
// paid in the cast window, before the item reaches the stack. "Another" is
// implicit: the engine excludes the ability's own source from the sacrifice
// pool, so the Gorger can no longer eat itself and then fail to grow.
// Discarding is a trash (R40), which is the point of pairing this with the
// batch's trash-matters cards.
card('Pallid Gorger', {
  augmentText: [{
    type: 'activated', cost: { discardOrSacrifice: 1 },
    label: 'discard a card or sacrifice a nontoken unit: I gain +2/+2 until regroup',
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (self) g.addTemp(self, 2, 2);
      },
    },
  }],
});

// "[Switch1] Create three Wraiths and gain 2 Rot." — d/3 Primordial Occult
// Spell (deploy timing). R71: "create a Wraith" spawns the 3/3 token body;
// Wraith and the retired name Wight are one card. R115: created units arrive
// where their SOURCE is — during deployment that IS home, but grafted onto a
// battle-timing cause the three Wraiths are minted in the BATTLE region. R38: the 2 rot is a straight gain — it costs
// nothing now and 2 damage at the start of every future deployment.
const coalesce: EffectDef = {
  creates: ['Wraith'],
  run: (g, ctx) => {
    for (let i = 0; i < 3; i++) g.createWraith(ctx.controller, ctx.region);
    g.gainRot(ctx.controller, 2);
  },
};
card('Primordial Coalescence', {
  spellEffect: coalesce,
  graftEffect: { bounded: true, effect: coalesce },
});

// "When I leave your bin, [Switch1] You may pay [1] to draw a card and gain 1
// rot." — d/1 2/1 Blight Zombie Unit.
//
// UNPARKED by R124: every bin removal in the tree now goes through
// E.removeFromBin, which fires 'leftBin' { seat, card, reason } once per card
// — the choke point this card was parked on. R51's zone dispatch delivers the
// event, with one deliberate inversion: for 'leftBin' the presence test is
// the EVENT (this card, out of this seat's bin), not the bin — the subject
// has already left the zone it listens from — and that is also where
// `self: true` is enforced (another card leaving my bin is not me).
//
// "YOUR bin" is the BIN OWNER's: the seat whose bin I leave is the seat that
// triggers, decides, pays, draws and gains the rot — whichever side once
// played me (leaving the opponent's bin is leaving THEIR "your bin"). The
// [Switch1] is bounded per turn per (seat, card name) in GameState.zoneBudgets
// (R124 / CARD-TODO #21 — a bin holds bare names, so the name IS the card),
// and R113 applies from a bin exactly as in play: declining the [1], or
// having no [1] to offer, refunds the use.
//
// THE [Switch1] IS A GRAFT SYMBOL, and it was only half read. R124's engine
// note and 90-coverage-census both say in prose that "Rotling carries no mod
// symbol" — it prints one. `[Switch1]` marks a BOUNDED GRAFTABLE EFFECT
// (R9/Manual p.33), so the sentence is donatable: applied as a graft to a host
// with its own graft cause, the pay-[1] rider fires off THAT cause, addressed
// to the host's controller. Rotling was the only card in the whole pool with a
// [Switch]-marked EFFECT and no `graftEffect` — i.e. `isGraftable('Rotling')`
// answered false and the card could not be applied at all — so the marker's
// donatable half was dead text (the R125 shape: one clause works, the other
// silently does nothing). The effect body is shared verbatim; nothing in it
// reads a bin, so it resolves the same from a graft cause as from the bin.
//
// The graft CAUSE half is declared for the same reason the trash-trigger
// family declares it (Afflicting Anima, Maw of Despair, Blightwalker):
// fidelity to the printed symbol. It can never actually carry riders here —
// a zone firing is anchored on R51's detached stand-in, whose `mods` is `[]`
// by construction — which is the same structural argument R51 records for
// trash triggers, extended one zone over.
//
// ONE LIVE CONSEQUENCE worth naming: a graftable Rotling can be applied OUT OF
// THE BIN, and apply.ts's `zoneTake` routes that removal through
// `E.removeFromBin(seat, i, 'modded')` (R124 / CARD-TODO #26). So grafting
// Rotling out of your own bin fires Rotling's own 'leftBin' trigger. That
// bypass was fixed blind — "no reachable card noticed only because Rotling
// carries no mod symbol" — and this is the card that reaches it.
const rotlingPay: EffectDef = {
  run: (g, ctx) => {
    if (g.openMana(ctx.controller) < 1) {
      ctx.refundBudget?.();   // R113: no offer could be made, so the use is not spent
      g.ev('info', 'Rotling: cannot pay [1] — no draw, no rot.');
      return;
    }
    const pays = ctx.choose('pay', {
      kind: 'payOrDecline', seat: ctx.controller,
      prompt: 'Rotling: pay [1] to draw a card and gain 1 rot?',
      options: [{ label: 'Pay [1] — draw a card, gain 1 rot', value: true }, { label: 'Decline', value: false }],
    });
    if (pays !== true) {
      ctx.refundBudget?.();   // R113: declining a "you may" never spends it
      g.ev('info', 'Rotling: the [1] is not paid — no draw, no rot.');
      return;
    }
    g.payMana(ctx.controller, 1);
    g.draw(ctx.controller, 1);
    g.gainRot(ctx.controller, 1);
  },
};
card('Rotling', {
  abilities: [{
    type: 'triggered', events: ['leftBin'], zone: 'bin', self: true, bounded: true,
    graftCause: true,
    label: 'you may pay [1] to draw a card and gain 1 rot',
    effect: rotlingPay,
  }],
  graftEffect: { bounded: true, effect: rotlingPay },
});

// "[Augment] At the start of deployment, you may discard your hand and
// transform me into Beyond, Codex Incarnate." — dd/1 0/2 {Haste} Blight Unit.
//
// UNPARKED (R101, playtest ledger #24). The two things it waited on both
// arrived: R50 gave it the 'startOfDeployment' event, and the owner supplied
// the back face on 2026-08-22, so "Beyond, Codex Incarnate" is now a
// registered synthetic (registry.ts). What was NEVER missing, it turns out,
// is a "transform layer" — the engine does not need one, and this is the
// argument for that:
//
//   `Entity.card` IS the card's identity. `E.baseStatsOf` reads
//   `this.card(e.card)` for layer 1; the bin push on death reads `u.card`;
//   "name a card" and counters-by-name key off it; the inspector and the
//   client render from it. So assigning `self.card = 'Beyond, Codex Incarnate'`
//   changes every one of those AT ONCE and consistently, which is exactly what
//   "transform me into X" means. Card code in this repo already mutates its
//   own entity directly (`self.budgets[key] = 1` in batch-metal-a.ts), so this
//   is where the operation belongs, not behind a new engine primitive.
//
// THE DESIGN DECISIONS, all of which follow from "a transform is not a new
// unit — it is the SAME card with a different face up":
//
//  · SAME OBJECT, same `id`. Nothing is deleted and nothing is spawned. That
//    is not a convenience, it is the ruling: a transformed unit was never
//    absent from the board, so no 'died'/'despawned'/'spawned' event fires,
//    every "when I entered play" fact stays true, anything holding its id
//    (a block assignment, a pending trigger's sourceId, a targeting spell on
//    the stack) still points at it, and `budgets` — the R9 per-card
//    once-per-turn ledger — is not laundered by flipping the card over.
//  · KEEPS ITS COUNTERS. They are on the entity, and layer 3 adds them to
//    whatever base is underneath; a +1/+1 counter is a fact about the unit,
//    not about the face. (R93 makes the same point for {Inverted}: counters
//    ride along by construction.)
//  · KEEPS ITS DAMAGE. Same reason. Note this is a strict UPGRADE here —
//    Scholar is a 0/2 and Beyond an 8/3 — so a damaged Scholar cannot die of
//    the transform; the resolution's own checkDeaths() would catch it if a
//    future back face shrank the body.
//  · KEEPS ITS MODS, and stays {Unstable} if it had any (R69/R96): the mods
//    are still physically under the card. It also keeps its FORMATION SLOT,
//    for free — the columns store ids, and the id did not change.
//  · BECOMES A TOKEN (`self.token = true`). This is the consequential one.
//    Beyond's type line says "Book TOKEN Unit", and the type line is this
//    engine's own definition of a token (DECK_LIST's filter, ui/inspect's
//    `tokenOnlyName`). `Entity.token` is the flag that carries that fact into
//    every zone the body can leave play into, and setting it makes ALL of them
//    correct with no new code: dying pushes to the bin and R69's state-based
//    sweep immediately erases it with a public record (engine.ts's "then
//    erased (token)"), and recall-to-hand / cache paths erase it the same way.
//    Leaving the flag off would put the literal name "Beyond, Codex Incarnate"
//    in a bin as though it were a card — a 0-cost 8/3 that every exhume,
//    recall and bin-play effect in the pool could then fetch, which is both
//    broken and a thing the owner explicitly said cannot happen ("can't be
//    played cause it's on the back of a card").
//    ⚠ REJECTED ALTERNATIVE: transform BACK to Scholar of the Void on the way
//    out, so the physical card reaches the bin — the Magic rule for
//    double-faced cards. It is a real reading and it loses the player less,
//    but nothing on either face prints it, there is no Algomancy source for
//    it anywhere in the corpus, and it needs a SECOND identity switch wired
//    into the death path. Flagged for the owner in the report instead of
//    invented here.
//
// THE [Augment] HALF, refused on purpose. This whole text sits under
// [Augment], so it transfers to a HOST when Scholar is applied as an augment
// mod, and "me" then rebinds to the host exactly as Skittering Blight's
// "counters on me" does (fireEvent anchors donated text on the host; see
// E.anchored). Transforming an arbitrary host is INCOHERENT, and the owner's
// own words are why: Beyond is "on the back of a card" — of THIS card. A Good
// Whale wearing a Scholar has its own reverse side, and it is not Beyond.
// So the transform is offered only when the anchor is a card that actually
// HAS this back face, which the registry's transform table answers. The nice
// consequence is that a Scholar augmented onto ANOTHER Scholar works — that
// host does have a Beyond on its back — and it falls out of the same check
// rather than needing a special case.
//
// "YOU MAY DISCARD YOUR HAND" is a real cost of the option, so it is a real
// payOrDecline: declining is always offered, and the hand is discarded only
// after the answer comes back (plan-then-commit — the engine replays the part
// from its boundary on suspension, so nothing may be mutated before the
// choose). Discarding an EMPTY hand is LEGAL and the option is still offered:
// the cost is "discard your hand", not "discard a card", and a hand of zero
// cards is discarded by doing nothing. That makes an empty-handed Scholar the
// card's best case, which is a genuine strategic line and not a bug.
card('Scholar of the Void', {
  augmentText: [{
    type: 'triggered', events: ['startOfDeployment'],
    label: 'at the start of deployment, discard your hand to transform me',
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) {
          g.ev('info', `${ctx.sourceName}: it is no longer in play — nothing to transform.`);
          return;
        }
        // "me" is the ANCHOR: this card's body when it was played normally
        // (R55), the HOST when the text arrived on an augment mod. Only a card
        // that prints this back face can be turned over into it.
        const back = transformsInto(self.card);
        if (!back) {
          g.ev('info',
            `${ctx.sourceName}: "transform me" is donated text here, and ${self.card} has its own `
            + 'reverse side — Beyond, Codex Incarnate is on the back of Scholar of the Void, not '
            + 'of whatever it is augmented onto. The option is not offered.');
          return;
        }
        const hand = g.player(ctx.controller).hand;
        const n = hand.length;
        const beyond = g.card(back);
        // the ONLY choose, and it happens before anything is mutated
        const take = ctx.choose('transform', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `${self.card}: discard your hand (${n} card${n === 1 ? '' : 's'}) and transform `
            + `into ${back} (${beyond.power}/${beyond.toughness})?`,
          options: [
            { label: `Discard ${n} card${n === 1 ? '' : 's'} and transform into ${back}`, value: true, card: back },
            { label: 'Decline — stay as I am', value: false },
          ],
        }) as boolean;
        if (!take) {
          g.ev('info', `${ctx.sourceName}: ${g.pname(ctx.controller)} declines the transform.`);
          return;
        }
        // pay: discard the WHOLE hand, back to front so the indices hold
        for (let i = hand.length - 1; i >= 0; i--) g.discardFromHand(ctx.controller, i);
        // …and turn the card over. Same entity, same id, same slot, same
        // counters/damage/mods — only the face, and with it every stat, name
        // and text lookup, changes.
        self.card = back;
        self.token = true;
        g.ev('info',
          `Scholar of the Void transforms into ${back} — the same unit, now a `
          + `${beyond.power}/${beyond.toughness} ${beyond.type} (it keeps its counters, damage and `
          + 'mods, and as a token it is erased rather than binned when it leaves play).');
      },
    },
  }],
});

// "(You can apply mods to a modular card from your hand and/or bin as it is
// played. You still pay their costs.) [Switch1] You gain one rot." — d/1
// {Battle} {Modular} Arcane Spell. {Modular} itself is engine-side (R35's
// cast-time collection: the mods are an additional COST, they ride on the
// stack with the spell) — the card scripts only its own body, which is a pure
// downside: a 1-mana carrier that charges you a rot for the privilege.
//
// R105 (owner, 2026-08-23): ANY card you can pay for may be applied, not just
// a graftable one. A graft contributes its [Switch] effect as an extra part; a
// type-line [Augment] attribute is donated to the resolving effect; text-box
// [Augment] text does nothing, because a spell has no body for it. And the rot
// is the price of what the card is FOR — "it basically works as a 'flashback'
// for graft cards", so the carrier is {Unstable} and the mods are erased with
// it, applied once and gone (Manual p.35).
const spellbindRot: EffectDef = { run: (g, ctx) => g.gainRot(ctx.controller, 1) };
card('Spellbind', {
  spellEffect: spellbindRot,
  graftEffect: { bounded: true, effect: spellbindRot },
});

// "When I am trashed, you may pay [2]. If you do, each opponent discards a
// card." — d/2 1/1 Alien Unit. R40: fires from the bin however it got there;
// ctx.sourceId resolves to nothing, and nothing here reads it. R25: "each
// opponent" is the event region's present seats — a trash outside battle
// (a deployment discard) reaches nobody, since a home region lists only its
// owner. The discarding player picks their own card (Void Memory's
// precedent), and the discard is itself a trash (R40).
card('Thoughtripper', {
  abilities: [{
    type: 'triggered', events: ['trashed'], self: true,
    label: 'you may pay [2]: each opponent discards a card',
    effect: {
      run: (g, ctx) => {
        const seat = ctx.controller;
        const foes = opponentsIn(g, ctx.region, seat).filter(s => g.player(s).hand.length > 0);
        if (!foes.length) { g.ev('info', 'Thoughtripper: no opponent here with a card to discard.'); return; }
        if (g.openMana(seat) < 2) { g.ev('info', 'Thoughtripper: cannot pay [2].'); return; }
        const pays = ctx.choose('pay', {
          kind: 'payOrDecline', seat,
          prompt: 'Thoughtripper: pay [2] so each opponent discards a card?',
          options: [{ label: 'Pay [2]', value: 1 }, { label: 'Decline', value: 0 }],
        }) as number;
        if (!pays) { g.ev('info', 'Thoughtripper: the [2] is declined — nobody discards.'); return; }
        // every choice first, then commit (the engine rolls back to the part
        // boundary on each suspension)
        const picks: [Seat, number][] = [];
        for (const foe of foes) {
          const hand = g.player(foe).hand;
          const i = hand.length === 1 ? 0 : ctx.choose(`drop:${foe}`, {
            kind: 'payOrDecline', seat: foe,
            prompt: 'Thoughtripper: discard a card',
            options: hand.map((n, idx) => ({ label: n, value: idx, card: n })),
          }) as number;
          picks.push([foe, i]);
        }
        g.payMana(seat, 2);
        for (const [foe, i] of picks) g.discardFromHand(foe, i);
      },
    },
  }],
});

// "When I spawn, discard a card. / When you trash a card, [Switch1] I gain
// +2/+2 and piercing until regroup." — d/2 3/3 Alien Unit. The two clauses
// chain: the spawn discard IS a trash (R40), so a freshly played Horror pumps
// itself. "When you trash a card" has no "another", so any trash of the
// controller's counts — and the [Switch1] marker makes that clause both the
// bounded graft cause and the bounded graftable effect (R9).
const horrorPump: EffectDef = {
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    if (!self) return;
    g.addTemp(self, 2, 2);
    g.addTempAttr(self, 'Piercing');
  },
};
card('Unrelenting Horror', {
  abilities: [
    {
      type: 'triggered', events: ['spawned'], self: true,
      label: 'discard a card',
      effect: {
        run: (g, ctx) => {
          const hand = g.player(ctx.controller).hand;
          if (!hand.length) { g.ev('info', 'Unrelenting Horror: your hand is empty — nothing to discard.'); return; }
          const i = hand.length === 1 ? 0 : ctx.choose('drop', {
            kind: 'payOrDecline', seat: ctx.controller,
            prompt: 'Unrelenting Horror: discard a card',
            options: hand.map((n, idx) => ({ label: n, value: idx, card: n })),
          }) as number;
          g.discardFromHand(ctx.controller, i);
        },
      },
    },
    {
      type: 'triggered', events: ['trashed'], bounded: true, graftCause: true,
      label: 'I gain +2/+2 and piercing until regroup',
      when: (_g, self, ev) => ev.data?.['seat'] === self.controller,
      effect: horrorPump,
    },
  ],
  graftEffect: { bounded: true, effect: horrorPump },
});

// "At the start of deployment you may Augment a Wraith onto a unit to recall
// me from your bin." — d/1 2/1 Blight Zombie Unit.
//
// UNPARKED by R50 + R51: the start-of-deployment event exists, and `zone:
// 'bin'` dispatches to a card sitting in a bin (a detached stand-in anchored
// on the bin's owner, so "YOUR bin" is ctx.controller).
//
// R71: "Augment a Wraith onto a unit" is E.augmentWraith — a Wraith token
// applied directly as a mod rather than spawned as a body. It is a cost with a
// choice, so it is paid at resolution via ctx.choose ("you may" → a decline
// option). "Recall me" puts the card in its owner's HAND (recall is always to
// hand, Manual). Region-scoped (R12/R25); during deployment that is the
// controller's home region, which is where their units are.
card('Xzydris', {
  abilities: [{
    type: 'triggered', events: ['startOfDeployment'], zone: 'bin',
    label: 'augment a Wraith onto a unit to recall me from your bin',
    effect: {
      creates: ['Wraith'],
      run: (g, ctx) => {
        const seat = ctx.controller;
        if (g.player(seat).bin.lastIndexOf('Xzydris') === -1) {
          g.ev('info', 'Xzydris: it is no longer in the bin — nothing to recall.');
          return;
        }
        const pool = g.unitsIn(ctx.region);
        if (!pool.length) {
          g.ev('info', 'Xzydris: no unit to augment a Wraith onto — it stays in the bin.');
          return;
        }
        const v = ctx.choose('host', {
          kind: 'payOrDecline', seat,
          prompt: 'Xzydris: augment a Wraith onto a unit to recall me from your bin?',
          options: [
            ...pool.map(u => ({ label: u.card, value: u.id as unknown, card: u.card })),
            { label: 'Decline — leave it in the bin', value: -1 as unknown },
          ],
        }) as number;
        if (v < 0) { g.ev('info', 'Xzydris: declined — it stays in the bin.'); return; }
        const host = g.entity(v as EntityId);
        if (!host) { g.ev('info', 'Xzydris: the chosen host is gone — it stays in the bin.'); return; }
        g.augmentWraith(host, seat);
        const i = g.player(seat).bin.lastIndexOf('Xzydris');
        if (i === -1) { g.ev('info', 'Xzydris: it left the bin — nothing is recalled.'); return; }
        g.removeFromBin(seat, i, 'recalled');   // R124
        g.player(seat).hand.push('Xzydris');
        g.ev('info', `Xzydris is recalled from ${g.pname(seat)}'s bin to their hand.`);
      },
    },
  }],
});
