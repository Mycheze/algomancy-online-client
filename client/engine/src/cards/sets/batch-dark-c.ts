/* Light & Dark expansion — batch dark-c (18 cards).
 *
 * Behaviour only; printed data comes from printed.json (never hand-copied).
 * Spec for the expansion's new mechanics: docs/08-light-and-dark.md,
 * and the Comprehensive Rules.
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
 * `[once]` on a trigger/activation = bounded (CR 109.9).
 *
 * Rulings leaned on: CR 704.6, 704.6b (fizzle vs partial), CR 111.9 (payments are part of
 * resolution, via ctx.choose), CR 803.4 (bounded budgets per card), CR 601.2, 601.4d
 * (regions are exclusive; "each opponent" reads the event region's present
 * seats), CR 601.5 (created units arrive where their SOURCE is — ctx.region),
 * CR 701.2 (applying a mod is not playing a card), CR 112.13 (rot), CR 801.2 (trash),
 * CR 403.1, 801.9 (the cache; glimpse-style until-end-of-turn permission).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - "target card in a/your bin" (Blightwalker, Collect Remains, Necromorph)
 *    IS engine targeting now: TargetSpec has a bin scope (CR 110.3) — 'binCard' for
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
 *    sends it to the erased pile (CR 407.1) instead of a bin. Collect Remains can
 *    no longer be recurred out of the bin, which is the point of the clause on
 *    a bin-recursion spell. Same seam as Temporal Rift and Suspend.
 *    ⚠ It is part of the EFFECT, so a NEGATED Collect Remains is binned
 *    normally (CR 406.4b: the effect does nothing, and the erase is a sentence of
 *    it) — unlike a Virus's {Unstable} (CR 723.4b), which is a stamp on the card and survives
 *    negation. Pinned by 89-self-erase.
 * ✔ Pallid Gorger's "Discard a card or sacrifice a nontoken unit:" is a real
 *    ACTIVATION cost now (CR 111.6, 705.3, `discardOrSacrifice: 1`): it gates the
 *    activation and is paid in the cast window, before the item reaches the
 *    stack.
 * ✔ "[Battle]" on Grox's activated ability is `ActivatedAbility.timing` now
 *    (CR 705.2), enforced at ACTIVATION: Grox is neither offered nor accepted during
 *    deployment.
 * ✔ "EXCHANGE" (Necromorph) IS NOT A DEATH (CR 410.2a). This entry used to
 *    read "modelled as delete-then-spawn: the unit in play is deleted (dies →
 *    its owner's bin → trash, DEATH TRIGGERS FIRE)". Bena, 2026-08-25:
 *    "It's not a death, but it is a despawn and trashing. Weird corner case."
 *    So the card calls `E.exchangeInPlace` — the primitive Hooba-Mon already
 *    used, lifted out of batch-dark-b for this — which spawns the replacement
 *    into the victim's region and formation slot and disposes the victim
 *    through `E.disposeToBin`: bin, CR 801.13a trash, Unstable sweep (engine route; CR 410.4d erases instead, CT-246), CR 410.5
 *    token sweep, CR 407.3a erased pile, and a FIRED 'despawned' with no 'died'.
 * ✔ ENTROPIC ENTITY's "a unit with counters on it despawns" reads
 *    `ev.data.counters`: 'died'/'despawned' fire after the entity is already
 *    out of s.entities, so the event now carries the leaving unit's counter
 *    count. (It used to keep a module-level Map keyed on EntityId — which
 *    leaked across games, since nextId restarts at 1.)
 *
 * UNPARKED by the costs, events and zone-trigger engine wave:
 *  - Lurking Dread (bin AND cache) and Xzydris (bin) are `zone:` triggers —
 *    the engine dispatches them (CR 400.5) to cards sitting in a zone, anchored on a detached
 *    stand-in owned by the zone's seat.
 *  - Xzydris and Scholar of the Void hear the new 'startOfDeployment' event.
 *
 * MOSTLY UN-PARKED — one real limitation survives, at the bottom:
 *  - Rotling is UNPARKED once every bin removal fired its leave event (CR 405.7): E.removeFromBin is the choke point every
 *    bin removal in the tree goes through, and it fires the 'leftBin' event
 *    the card was waiting on. See the card comment — which now also carries
 *    the OTHER half of its printed marker: `[Switch1]` makes the sentence a
 *    bounded GRAFTABLE effect, and the card had no `graftEffect`, so it was
 *    the one card in the pool with a [Switch]-marked effect that could not be
 *    grafted at all.
 *  - Scholar of the Void is UNPARKED as of the transform round (playtest ledger #24). The
 *    owner supplied the "Beyond, Codex Incarnate" card face on 2026-08-22, so
 *    the transform target exists (a registerSynthetic in registry.ts); and no
 *    "transform machinery" was needed after all — `Entity.card` is the card's
 *    identity, so turning it over is one assignment. BEYOND's own rot
 *    replacement was the one clause the transform round left behind — it prints "target
 *    unit" and sits on a hook with no decision window — and it is now built (CR 112.13d):
 *    `replaceRotDamage` does the substitution and fires a 'rotReplaced' event
 *    (src/types.ts, src/engine.ts) that Beyond's own trigger answers, so the
 *    targeting happens on the stack where a decision window exists.
 *    registry.ts's Beyond comment says it outright: "LIVE (CR 112.13d)". The
 *    only entry on this list still describing a real gap is the structural
 *    one at the bottom.
 *  - Its Dark Bubb WORKS since {Inverted} shipped (CR 802.8a; playtest report #73, 2026-08-22). {Inverted}
 *    is stat layer 5 and it now exists: layer 5 negates the NET stat change
 *    from base, i.e. `2*base - current`, applied after layer 4. Caleb worked
 *    the arithmetic out himself — "1/4 tough balanced is 8/8 … If we compare
 *    8/8 to 1/4, it's +7/+4. Which also works to invert to a -6/0". The card
 *    needed NO change here at all: the whole card is the printed attribute,
 *    and the layer does the rest.
 *  - ⚠ TRASH TRIGGERS CANNOT CARRY GRAFT RIDERS (Blightwalker's [Switch1]).
 *    The CONCLUSION still holds; the REASON this entry used to give is what CR 801.2h states, but the engine does not follow it (CT-246), so in the engine the reason fails; it is recorded here so nobody re-derives it.
 *
 *    ✘ The old reason (do NOT reuse): "a MODDED unit that dies is ERASED
 *      (Unstable) and never reaches a bin at all, so a card that IS trashed
 *      provably carries no mods" — i.e. the case was unreachable.
 *    ✔ The engine's Unstable-trash route (CT-246; CR 801.2h does not trash) made the case FULLY REACHABLE. `E.disposeToBin` pushes the body
 *      into the bin, fires 'died', calls `noteTrashed(binSeat, u.card,
 *      'play', u)` and only THEN lets the state-based sweep erase it — for
 *      EVERY death, Unstable included. So a modded Blightwalker that dies
 *      does reach a bin and its trash trigger DOES fire.
 *    ✔ The conclusion survives for a different, structural reason:
 *      `E.fireOwnTrashTrigger` anchors the trigger on a DETACHED ghost built
 *      with an explicit `mods: []` (and `budgets: {}`), so no rider can ever
 *      be found on it. Same statement as batch-dark-a.ts's entry for
 *      Afflicting Anima / Maw of Despair, which always carried the right
 *      reason. `graftCause` is kept for fidelity; the donatable graftEffect
 *      (the interesting half) works normally.
 *    ⚠ OPEN QUESTION (for the owner): before the engine's Unstable-trash route (CT-246), "the ghost carries no
 *      mods" was a statement about an impossible case. It is now a real,
 *      silent drop of every graft rider on a modded unit's death-trash, with
 *      no log line. Nobody has asked whether that is still the right answer.
 *    Once documented as a known limitation in the (since retired) ruling register; see CR 400.5; the park-note audit is 147-comment-conformance.
 */
import type { Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, eventBinSlot, notSelfBinCard, type EffectDef } from '../dsl.ts';
import { transformsInto } from '../registry.ts';
import { selfOf, isEnt, manaOf, isUnitCard, sacrificeMeOnResolve } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** [name, binIndex] pairs of `seat`'s bin passing a filter */
const binMatches = (g: E, seat: Seat, ok: (name: string) => boolean): [string, number][] =>
  g.player(seat).bin.map((n, i) => [n, i] as [string, number]).filter(([n]) => ok(n));

/** CR 601.4d: the opponents an effect resolving in `region` can reach */
const opponentsIn = (g: E, region: number, me: Seat): Seat[] =>
  g.s.regions[region]!.presentSeats.filter(s => s !== me);

/* A local `formationSlot(g, id)` used to sit here ("the formation slot an
 * entity occupies right now"). It was DEAD — zero call sites — left behind
 * when Necromorph moved to `E.exchangeInPlace` (CR 410.2a), which does the slot
 * bookkeeping itself. Deleted (see 147-comment-conformance). `batch-light-c.ts::slotOf` is the
 * surviving copy of the same walk, and it IS called. `tsconfig` has `strict`
 * but not `noUnusedLocals`, which is why this survived; 147-comment-conformance
 * is the guard that now catches the shape. */

// ───────────────────────────── the cards ──────────────────────────────

// "When I am trashed, [Switch1] You may pay [2] to recall another target unit
// from your bin. (Put it into your hand.)" — d/3 2/2 Alien Unit. CR 801.2a: the
// trash trigger fires FROM THE BIN, however the card got there (discarded,
// milled, sacrificed, died in combat), and ctx.sourceId resolves to nothing —
// nothing here reads it. CR 110.1a: the bin card is a DECLARED target ('binCard',
// see the spec below) — the "⚠ the bin is not a targetable zone" line that
// used to sit here was contradicted seven lines down.
//
// CR 405.6a: "another" excludes ONE THING — the Blightwalker that just landed in
// the bin — not every card named Blightwalker there. It used to compare card
// names, so a bin already holding a Blightwalker offered neither of them.
// A bin has no entity ids to compare, but identity there is already fixed
// (CR 405.6): a BinRef is (name, nth occurrence), and `noteTrashed` stamps this
// copy's `binNth` on the 'trashed' event. `notSelfBinCard` reads it.
// [Switch1] on the trigger makes it a bounded graft CAUSE as well as a
// bounded graftable effect — though a card sitting in the bin carries no
// mods, so nothing ever rides along on the trash firing itself.
const blightwalkerRecall: EffectDef = {
  // CR 110.1a: "another target unit from your bin" — a declared target, chosen as
  // the trigger goes on the stack. `may` carries the "you may" (CT-309):
  // declining is simply choosing nothing. The [2] stays a resolution-time
  // pay-or-decline — it is optional mana, not a bracketed cost (CR 111.9).
  targets: {
    what: 'binCard', may: true,
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
    g.removeFromBin(seat, t.binCard.index, 'recalled');   // CR 405.7
    g.toHand(seat, name, 'bin');                          // CR 402.4
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
// and the card comes to the caster's hand. CR 110.1a: it is a real declared target
// now — it used to be a mid-resolution pick, so the spell sat on the stack
// aiming at nothing. "Erase me" is REAL (CR 407.1, header ~50-56): `ctx.eraseSelf()`
// raises `StackItem.eraseSelf` and `E.dischargeItem` sends the card to the
// erased pile instead of a bin. This note used to say it was "still
// approximated by the spell being binned normally afterwards" — it is not.
card('Collect Remains', {
  spellEffect: {
    targets: { what: 'anyBinCard', prompt: 'Collect Remains: put target card in a bin into your hand' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (t && 'binCard' in t && t.binCard.index !== -1) {
        const bin = g.player(t.binCard.seat).bin;
        const name = bin[t.binCard.index];
        if (name !== undefined) {
          g.removeFromBin(t.binCard.seat, t.binCard.index, 'recalled');   // CR 405.7
          g.toHand(ctx.controller, name, 'bin');                          // CR 402.4
          g.ev('info', `Collect Remains: ${name} goes from ${g.pname(t.binCard.seat)}'s bin to ${g.pname(ctx.controller)}'s hand.`);
        }
      }
      // "Erase me." — the second sentence, and it is why the two are printed
      // together: this is bin recursion that takes ITSELF out of the game, so
      // it can never be recurred by the next copy. Unconditional given the
      // spell resolves at all, which is why it sits outside the guard above —
      // a bin card that vanished between cast and resolution does not save the
      // Remains from its own text. CR 407.1: dischargeItem sends the card to the
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
// and a card being trashed is by definition not one.
//
// CR 111.8: "sacrifice me. If you do, …" is a step of the EFFECT, made as the
// trigger resolves — the same printed shape as Eldritch Dreamtender, with no
// [cost] bracket. The Rector stays in play while the trigger waits; if it is
// gone by resolution, "If you do" fails and nothing is recalled. This reverses
// the owner ruling of 2026-08-22 that made it a cast cost; the owner accepted
// Caleb's reading on 2026-10-21 (report #259, CT-264).
card('Cthyrian Rector', {
  augmentText: [{
    type: 'triggered', events: ['trashed'],
    label: 'sacrifice me — recall the trashed card from your bin',
    when: (_g, self, ev) => ev.data?.['seat'] === self.controller,
    effect: {
      run: (g, ctx) => {
        if (!sacrificeMeOnResolve(g, ctx, 'Cthyrian Rector')) return;   // CR 111.8: "If you do"
        // CR 405.6: "THAT card" — the copy the trash event was about, resolved
        // from the event's own `binNth` stamp (the (name, nth) bin
        // identity) by `eventBinSlot`. This used to be a name search of the
        // bin, which answers "the last copy of that name in the bin right
        // now": a different question, and a different card once the trashed
        // copy has been swept out (a token, or — in the engine — an {Unstable} death; CR 801.2h never bins that card, CT-246). What the search found then was an INNOCENT older copy, which
        // this card recalled to hand having already made its sacrifice. A miss
        // is "gone" — never "take the other one".
        const slot = eventBinSlot(g, ctx.event);
        if (!slot) return;
        // `when` pins the trashed seat to the controller, so slot.seat is
        // "your bin" and the recall lands in the same player's hand.
        if (slot.index === -1) { g.ev('info', `Cthyrian Rector: ${slot.card} is no longer in the bin.`); return; }
        g.removeFromBin(slot.seat, slot.index, 'recalled');   // CR 405.7
        g.toHand(ctx.controller, slot.card, 'bin');          // CR 402.4
        g.ev('info', `Cthyrian Rector recalls ${slot.card} to ${g.pname(ctx.controller)}'s hand.`);
      },
    },
  }],
});

// "When a unit with counters on it despawns, [Switch1] Draw a card." — d/3
// 0/3 Alien Anima Unit. Despawn = ANY leave-play, died included (the
// Celestial Fluxmorph / Bloated Manablub reading). Region-scoped like every
// listener (CR 101.6).
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
// The owner's ruling (CR 700.1) CONFIRMS THE SWEEP AS WRITTEN. The audit had flagged this loop as
// possibly too wide, because it negates a {Battle} unit mid-cast and an earlier ruling said a unit on the stack was not an effect at all. The owner reversed that reading on
// 2026-08-24 — "ANYTHING on the stack is an effect, including units and spell
// units" — so a bare `[...g.s.stack]` is exactly "all other effects" and this
// must NOT be narrowed. Same for Return to Nature and Temporal Rift. (Contrast
// Molten Riftbreaker, which prints "all allied SPELLS" and does filter by
// kind: a unit is an effect but is not a spell, which is the other half of the
// same sentence.)
// Erasing empties BOTH bins — erasing never touches a bin again (CR 801.2c), so
// nothing here is a trash. Finality itself is binned afterwards, from the
// stack, exactly as printed (it was never in a bin to be erased).
card('Finality', {
  spellEffect: {
    run: (g, ctx) => {
      const hits = g.stackIn(ctx.region);   // CR 704.4: everything still here is un-negated; CT-234: this region's
      for (const i of hits) g.negate(i.id);
      if (!hits.length) g.ev('info', 'Finality: no other effects to negate.');
      // CR 601.4c: "all cards in bins" is all bins IN THIS REGION
      for (const p of g.seatsHere(ctx.region).map(s => g.player(s))) {
        if (!p.bin.length) continue;
        const n = p.bin.length;
        const gone = [...p.bin];
        // CR 405.7: a bulk wipe still leaves one card at a time — back-to-front,
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
// has no graftEffect to donate. CR 705.2: the printed "[Battle]" marker is
// `timing: 'battle'` now — enforced at ACTIVATION, so Grox is not offered and
// not accepted during deployment.
//
// UN-PARKED (its activation cost is now paid as it is activated). This note used to read "⚠ still at resolution: 'erase TWO
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
// which the engine does not have (Reality Bender's precedent)" — expired when stat layer 5 (CR 802.8a) shipped and was contradicted by this batch's own header ninety lines up. Layer 5
// is live in `E.effStats` (`2·base - cur`, applied after layer 4, deduped by
// `statLayerAttrs`), so this card genuinely works with no behaviour of its
// own. Nothing to add; only the note was wrong.
card('Its Dark Bubb', {});

// "After combat, you may sacrifice two non-token units to put me into play
// from your bin or from cache." — d/8 8/8 Polyform Unit.
//
// UNPARKED by the zone-trigger change (CR 400.5): `zone` dispatches a trigger to a card sitting in a ZONE,
// anchored on a detached stand-in whose controller is the zone's owner. The
// card wants BOTH zones, so it registers the same effect twice — once from the
// bin, once from the cache — and the effect takes whichever copy it finds
// (bin first, the more common case). A card in both zones would fire twice,
// which is the honest reading: those are two different copies.
//
// "You MAY sacrifice two non-token units" is a cost with a choice, so it is
// paid at RESOLUTION via ctx.choose (the trigger is already on the stack by
// then — the cast window governs activations, not triggers; CR 111.9): decline, or
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
    let owner: Seat = seat;                                // CR 102.4 / CT-233
    if (bi !== -1) { owner = g.zoneOwner(seat, 'bin', bi); g.removeFromBin(seat, bi, 'revived'); }   // CR 405.7
    else {
      const ci = g.cache(seat).findIndex(cc => cc.card === 'Lurking Dread');
      if (ci !== -1) owner = g.uncache(seat, ci)?.owner ?? seat;
      else {
        g.ev('info', 'Lurking Dread: it is no longer in a bin or cache — it does not arrive.');
        return;
      }
    }
    g.spawnUnit(seat, 'Lurking Dread', ctx.region, { owner });
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
// play it until end of turn." — d/3 2/3 Alien Unit. [once] = bounded (CR 109.9).
// CR 403.2, 801.9e: cacheFromBin with { playable: true } is exactly the glimpse-style
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
        // CR 405.6: "cache IT" is the copy the trash event was about, resolved by
        // the (name, nth) bin identity. `bin.lastIndexOf(name)` used to
        // stand in for it and answers a different question once that copy has
        // been swept out (token, or — in the engine — an {Unstable} death; CR 801.2h never bins it, CT-246): it finds
        // an INNOCENT older copy of the same name and would cache that one —
        // a card the player never trashed, moved out of their bin and made
        // playable. A wrong-copy miss is "gone", and "gone" refunds (CR 109.9b
        // — no offer could be made, so the [once] is not spent), exactly as
        // the empty-bin miss already did.
        const slot = eventBinSlot(g, ctx.event);
        if (!slot) return;
        const name = slot.card;
        if (slot.index === -1) {
          ctx.refundBudget?.();   // CR 109.9b: no offer could be made, so the use is not spent
          g.ev('info', `Murkdrop Distiller: ${name} is not in your bin — there is nothing to cache.`);
          return;
        }
        const take = ctx.choose('cache', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Murkdrop Distiller: cache ${name} and play it until end of turn?`,
          options: [{ label: `Cache ${name}`, value: 1, card: name }, { label: 'Decline', value: 0 }],
        }) as number;
        if (!take) {
          ctx.refundBudget?.();   // CR 109.9b: declining a "you may" never spends it
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
// CR 110.1b: BOTH are real targets, declared at cast — the card prints "target"
// twice and the bin half used to be a mid-resolution pick. The second slot's
// legality depends on the first (cost ≤ it, and IN ITS CONTROLLER'S bin),
// which is what TargetCtx.chosen is for; and the first slot is narrowed to
// units whose controller actually has a replacement, so the spell can never
// be aimed somewhere it must do nothing.
//
// CR 801.13a — IT IS NOT A DEATH. This card called `g.destroy(victim, 'is
// deleted')`, which fired every death trigger in the region: the victim's own
// "when I die", its controller's "whenever an ally dies", the caster's
// "whenever a unit dies", and in battle the `allyDeaths` counter. Bena,
// 2026-08-25, asked directly: *"It's not a death, but it is a despawn and
// trashing. Weird corner case."*
//
// So the exchange goes through `E.exchangeInPlace` — the primitive Hooba-Mon
// already used, lifted out of batch-dark-b.ts for exactly this reason. It
// spawns the replacement into the victim's region and formation slot, then
// disposes the victim through `E.disposeToBin`: bin, CR 801.13a trash, the engine's
// Unstable sweep (CR 410.4d erases instead, CT-246), CR 410.5 token sweep, CR 407.3a erased pile, and a FIRED 'despawned'
// with no 'died' anywhere. The bin removal stays here because it is this
// card's own targeting (`removeFromBin`, CR 405.7, its 'revived' verb, and the
// CR 704.5 re-check above), not part of the exchange.
// CR 710.1a: the unit in play is priced off its FACE (E.costOf); the bin card off its name
const necroSwapFor = (g: E, victim: Entity, seat: Seat): [string, number][] =>
  binMatches(g, seat, n => isUnitCard(n) && manaOf(n) <= g.costOf(victim));
card('Necromorph', {
  spellEffect: {
    targets: {
      what: 'unit', count: 2, min: 2,
      roles: 'swaps {0} for {1}',
      prompt: "Necromorph: exchange target unit for a cheaper one in its controller's bin",
      slots: ['unit', 'anyBinCard'],
      slotPrompts: [
        'Necromorph: exchange which unit in play?',
        "Necromorph: for which unit in that unit's controller's bin?",
      ],
      slotRestricts: [
        (g, t) => 'controller' in t && necroSwapFor(g, t, t.controller).length > 0,
        (g, t, ctx) => {
          const first = ctx.chosen?.[0];
          if (!first || !('controller' in first) || !('binCard' in t)) return false;
          return t.binCard.seat === first.controller
            && isUnitCard(t.binCard.card) && manaOf(t.binCard.card) <= g.costOf(first);
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
      // CR 704.5: a redirect can have moved the unit target since the cast, so the
      // pairing is re-checked here rather than trusted
      if (b.binCard.seat !== owner || b.binCard.index === -1
        || manaOf(b.binCard.card) > g.costOf(victim)) {
        g.ev('info', `Necromorph: ${b.binCard.card} is no longer a legal exchange for ${victim.card} — no effect.`);
        return;
      }
      const name = b.binCard.card;
      g.removeFromBin(owner, b.binCard.index, 'revived');   // CR 405.7
      // CR 801.13a: a despawn and a trashing, and NOT a death. The replacement
      // takes the victim's region and slot inside the primitive.
      g.exchangeInPlace(victim, name, owner);
    },
  },
});

// "[Augment] Discard a card or sacrifice a nontoken unit: I gain +2/+2 until
// regroup." — d/2 1/1 {Virus} Alien Unit. An activated ability inside the
// [Augment] box: usable on the card itself when played normally (via
// 'augment') and on a host when donated (via { mod }), where "I" is the host
// and the host's controller pays. CR 111.6, 705.3: the either/or line is a real ACTIVATION
// cost (`discardOrSacrifice: 1`) — it gates the activation and is chosen and
// paid in the cast window, before the item reaches the stack.
// No "another" is printed, so the source may pay (CR 111.2 / CT-281, the owner's
// steer: printed text beats an engine default, take the permissive reading).
// The Gorger may sacrifice ITSELF — it then gains nothing, since it is gone —
// and, donated, its host may sacrifice itself the same way. It used to be
// left out of its own pool, so that it could not eat itself and fail to grow.
// Discarding is a trash (CR 801.3), which is the point of pairing this with the
// batch's trash-matters cards.
card('Pallid Gorger', {
  augmentText: [{
    type: 'activated', cost: { discardOrSacrifice: 1 },   // no "another" printed
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
// Spell (deploy timing). CR 304.4: "create a Wraith" spawns the 3/3 token body;
// Wraith and the retired name Wight are one card. CR 601.5: created units arrive
// where their SOURCE is — during deployment that IS home, but grafted onto a
// battle-timing cause the three Wraiths are minted in the BATTLE region. CR 112.13: the 2 rot is a straight gain — it costs
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
// UNPARKED by the bin-exit choke point (CR 405.7): every bin removal in the tree now goes through
// E.removeFromBin, which fires 'leftBin' { seat, card, reason } once per card
// — the choke point this card was parked on. The zone dispatch (CR 400.5) delivers the
// event, with one deliberate inversion: for 'leftBin' the presence test is
// the EVENT (this card, out of this seat's bin), not the bin — the subject
// has already left the zone it listens from — and that is also where
// `self: true` is enforced (another card leaving my bin is not me).
//
// "YOUR bin" is the BIN OWNER's: the seat whose bin I leave is the seat that
// triggers, decides, pays, draws and gains the rot — whichever side once
// played me (leaving the opponent's bin is leaving THEIR "your bin"). The
// [Switch1] is bounded per turn per (seat, card name) in GameState.zoneBudgets
// (CR 109.9m / CARD-TODO #21 — a bin holds bare names, so the name IS the card),
// and CR 109.9b applies from a bin exactly as in play: declining the [1], or
// having no [1] to offer, refunds the use.
//
// THE [Switch1] IS A GRAFT SYMBOL, and it was only half read. The bin-exit ruling's engine
// note (since retired) and 90-coverage-census both say in prose that "Rotling carries no mod
// symbol" — it prints one. `[Switch1]` marks a BOUNDED GRAFTABLE EFFECT
// (CR 722.5/Manual p.33), so the sentence is donatable: applied as a graft to a host
// with its own graft cause, the pay-[1] rider fires off THAT cause, addressed
// to the host's controller. Rotling was the only card in the whole pool with a
// [Switch]-marked EFFECT and no `graftEffect` — i.e. `isGraftable('Rotling')`
// answered false and the card could not be applied at all — so the marker's
// donatable half was dead text (the dead-clause shape: one clause works, the other silently does nothing). The effect body is shared verbatim; nothing in it
// reads a bin, so it resolves the same from a graft cause as from the bin.
//
// The graft CAUSE half is declared for the same reason the trash-trigger
// family declares it (Afflicting Anima, Maw of Despair, Blightwalker):
// fidelity to the printed symbol. It can never actually carry riders here —
// a zone firing is anchored on the zone dispatch's detached stand-in, whose `mods` is `[]`
// by construction — which is the same structural argument the zone-trigger ruling made for
// trash triggers, extended one zone over.
//
// ONE LIVE CONSEQUENCE worth naming: a graftable Rotling can be applied OUT OF
// THE BIN, and apply.ts's `zoneTake` routes that removal through
// `E.removeFromBin(seat, i, 'modded')` (CR 405.7 / CARD-TODO #26). So grafting
// Rotling out of your own bin fires Rotling's own 'leftBin' trigger. That
// bypass was fixed blind — "no reachable card noticed only because Rotling
// carries no mod symbol" — and this is the card that reaches it.
const rotlingPay: EffectDef = {
  run: (g, ctx) => {
    if (g.openMana(ctx.controller) < 1) {
      ctx.refundBudget?.();   // CR 109.9b: no offer could be made, so the use is not spent
      g.ev('info', 'Rotling: cannot pay [1] — no draw, no rot.');
      return;
    }
    const pays = ctx.choose('pay', {
      kind: 'payOrDecline', seat: ctx.controller,
      prompt: 'Rotling: pay [1] to draw a card and gain 1 rot?',
      options: [{ label: 'Pay [1] — draw a card, gain 1 rot', value: true }, { label: 'Decline', value: false }],
    });
    if (pays !== true) {
      ctx.refundBudget?.();   // CR 109.9b: declining a "you may" never spends it
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
// UNPARKED (playtest ledger #24). The two things it waited on both
// arrived: the engine gained the 'startOfDeployment' event and the owner supplied
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
//    the stack) still points at it, and `budgets` — the CR 109.9g per-card
//    once-per-turn ledger — is not laundered by flipping the card over.
//  · KEEPS ITS COUNTERS. They are on the entity, and layer 3 adds them to
//    whatever base is underneath; a +1/+1 counter is a fact about the unit,
//    not about the face. (CR 802.8a makes the same point for {Inverted}: counters
//    ride along by construction.)
//  · KEEPS ITS DAMAGE. Same reason. Note this is a strict UPGRADE here —
//    Scholar is a 0/2 and Beyond an 8/3 — so a damaged Scholar cannot die of
//    the transform; the resolution's own checkDeaths() would catch it if a
//    future back face shrank the body.
//  · KEEPS ITS MODS, and stays {Unstable} if it had any (CR 803.8e): the mods
//    are still physically under the card. It also keeps its FORMATION SLOT,
//    for free — the columns store ids, and the id did not change.
//  · TURNS BACK OVER ON THE WAY OUT, and is NOT A TOKEN. ⚠ This reverses the original transform reading, which shipped `self.token = true` and called the transform
//    permanent. The original transform reading's reasoning was that Beyond's type line says "Book TOKEN
//    Unit", so `Entity.token` should carry that into every zone the body can
//    leave play into — and it flagged the alternative ("transform BACK to
//    Scholar on the way out, so the physical card reaches the bin") as a real
//    reading it would not invent. The owner ruled on it (now CR 201.4), and it
//    is the alternative, in both halves at once. Bena, 2026-08-25:
//
//      "Turns back over. In all zones, other than play, it exists as the
//       front side. And the back is NOT a token."
//
//    So `E.transformFace` records the front face on the entity and leaves
//    `token` alone, and `E.revertFace` — run at the top of every route out of
//    play — flips it back. The consequence the original transform reading was avoiding does not arise:
//    the name that reaches the bin is "Scholar of the Void", never "Beyond,
//    Codex Incarnate", so no exhume, recall or bin-play effect can ever fetch
//    a 0-cost 8/3, and the owner's "can't be played cause it's on the back of
//    a card" still holds. What changes is that the PLAYER KEEPS THE CARD: a
//    transformed Scholar that dies is a Scholar in the bin, recurrable like
//    any other card, instead of being erased out of the game for having used
//    its own printed ability. Beyond's "Token" type line still keeps it out of
//    DECK_LIST and every draft pool (registry.ts) — that filter reads the TYPE
//    LINE and never needed `Entity.token`.
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
        // (CR 721.1d), the HOST when the text arrived on an augment mod. Only a card
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
        //
        // CR 201.4: `E.transformFace` remembers the FRONT face on the entity,
        // and it does NOT set `token`. Both halves are the ruling, verbatim:
        // *"Turns back over. In all zones, other than play, it exists as the
        // front side. And the back is NOT a token."*
        g.transformFace(self, back);
        g.ev('info',
          `Scholar of the Void transforms into ${back} — the same unit, now a `
          + `${beyond.power}/${beyond.toughness} ${beyond.type} (it keeps its counters, damage and `
          + 'mods, and it turns back over into Scholar of the Void the moment it leaves play).');
      },
    },
  }],
});

// "(You can apply mods to a modular card from your hand and/or bin as it is
// played. You still pay their costs.) [Switch1] You gain one rot." — d/1
// {Battle} {Modular} Arcane Spell. {Modular} itself is engine-side (CR 724.3,
// cast-time collection: the mods are an additional COST, they ride on the
// stack with the spell) — the card scripts only its own body, which is a pure
// downside: a 1-mana carrier that charges you a rot for the privilege.
//
// The owner (2026-08-23, CR 724.2): ANY card you can pay for may be applied, not just
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
// card." — d/2 1/1 Alien Unit. CR 801.2a: fires from the bin however it got there;
// ctx.sourceId resolves to nothing, and nothing here reads it. CR 601.4d: "each
// opponent" is the event region's present seats — a trash outside battle
// (a deployment discard) reaches nobody, since a home region lists only its
// owner. The discarding player picks their own card (Void Memory's
// precedent), and the discard is itself a trash (CR 801.3).
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
// chain: the spawn discard IS a trash (CR 801.3), so a freshly played Horror pumps
// itself. "When you trash a card" has no "another", so any trash of the
// controller's counts — and the [Switch1] marker makes that clause both the
// bounded graft cause and the bounded graftable effect (CR 722.5).
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
// UNPARKED: the start-of-deployment event exists, and `zone:
// 'bin'` dispatches to a card sitting in a bin (a detached stand-in anchored
// on the bin's owner, so "YOUR bin" is ctx.controller).
//
// CR 721.6: "Augment a Wraith onto a unit" is E.augmentWraith — a Wraith token
// applied directly as a mod rather than spawned as a body. It is a cost with a
// choice, so it is paid at resolution via ctx.choose ("you may" → a decline
// option). "Recall me" puts the card in its owner's HAND (recall is always to
// hand, Manual). Region-scoped (CR 101.6, 601.4d); during deployment that is the
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
        g.removeFromBin(seat, i, 'recalled');   // CR 405.7
        g.toHand(seat, 'Xzydris', 'bin');       // CR 402.4
        g.ev('info', `Xzydris is recalled from ${g.pname(seat)}'s bin to their hand.`);
      },
    },
  }],
});
