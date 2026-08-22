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
 * seats), R28 (created units arrive in their controller's home region),
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
 *  - "ERASE ME" on a spell (Collect Remains) is approximated by the spell
 *    being binned normally after it resolves: resolveItem() runs afterParts()
 *    — which bins the card from the stack — after the effect has finished, and
 *    an effect has no handle on its own stack item. Same approximation as
 *    Temporal Rift (batch-hybrids-wm-b). Consequence: Collect Remains can be
 *    recurred out of the bin, where the printed card cannot.
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
 *  - Rotling: R51 gave it a trigger SURFACE, but "when I LEAVE your bin" needs
 *    an event nothing fires — bins are spliced directly from a dozen card
 *    effects and from engine code, with no choke point. See the card comment.
 *  - Scholar of the Void (HALF): the trigger fires now, but there is no
 *    transform machinery AND its target "Beyond, Codex Incarnate" is not in the
 *    printed pool at all, so there is nothing to become.
 *  - Its Dark Bubb is PRINTED-ONLY: {Inverted} is stat layer 5, unimplemented
 *    (Reality Bender, batch-earth-b, is the precedent). The attribute is
 *    carried; the stat-change inversion is not.
 *  - ⚠ TRASH TRIGGERS CANNOT CARRY GRAFT RIDERS (Blightwalker's [Switch1]) —
 *    and R51 did NOT change that, because it is structural rather than a
 *    missing hook: a MODDED unit that dies is ERASED (Unstable) and never
 *    reaches a bin at all, so a card that IS trashed provably carries no mods.
 *    Documented as a known limitation in docs/digital-rules.md (R51).
 */
import type { Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, type EffectDef } from '../dsl.ts';
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
// used to sit here was contradicted seven lines down. "Another" excludes the
// Blightwalker that just landed in the bin (one instance of it is filtered
// out).
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
    restrict: (_g, t) => 'binCard' in t && t.binCard.card !== 'Blightwalker' && isUnitCard(t.binCard.card),
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
    g.player(seat).bin.splice(t.binCard.index, 1);
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
      if (!t || !('binCard' in t) || t.binCard.index === -1) return;
      const bin = g.player(t.binCard.seat).bin;
      const name = bin[t.binCard.index];
      if (name === undefined) return;
      bin.splice(t.binCard.index, 1);
      g.player(ctx.controller).hand.push(name);
      g.ev('info', `Collect Remains: ${name} goes from ${g.pname(t.binCard.seat)}'s bin to ${g.pname(ctx.controller)}'s hand.`);
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
        const name = ctx.event?.data?.['card'] as string | undefined;
        if (name === undefined) return;
        const bin = g.player(ctx.controller).bin;             // "if you do"
        const i = bin.lastIndexOf(name);
        if (i === -1) { g.ev('info', `Cthyrian Rector: ${name} is no longer in the bin.`); return; }
        bin.splice(i, 1);
        g.player(ctx.controller).hand.push(name);
        g.ev('info', `Cthyrian Rector recalls ${name} to ${g.pname(ctx.controller)}'s hand.`);
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
        p.bin.length = 0;
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
// whole card is the attribute. PRINTED-ONLY (header): the attribute is
// carried by printed.attrs, but the inversion itself is stat layer 5, which
// the engine does not have (Reality Bender's precedent).
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
    if (bi !== -1) g.player(seat).bin.splice(bi, 1);
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
        const name = ctx.event?.data?.['card'] as string | undefined;
        if (name === undefined) return;
        if (g.player(ctx.controller).bin.lastIndexOf(name) === -1) return;
        const take = ctx.choose('cache', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Murkdrop Distiller: cache ${name} and play it until end of turn?`,
          options: [{ label: `Cache ${name}`, value: 1, card: name }, { label: 'Decline', value: 0 }],
        }) as number;
        if (!take) return;
        const i = g.player(ctx.controller).bin.lastIndexOf(name);
        if (i === -1) return;
        g.cacheFromBin(ctx.controller, i, { playable: true });
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
      if (!victim) return;
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
      g.player(owner).bin.splice(b.binCard.index, 1);
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
// Wraith and the retired name Wight are one card. R28: created units arrive in their
// controller's HOME region, which matters if the [Switch1] effect is grafted
// onto a battle-timing cause. R38: the 2 rot is a straight gain — it costs
// nothing now and 2 damage at the start of every future deployment.
const coalesce: EffectDef = {
  creates: ['Wraith'],
  run: (g, ctx) => {
    const home = g.homeRegion(ctx.controller);
    for (let i = 0; i < 3; i++) g.createWraith(ctx.controller, home);
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
// STILL PARKED, and for a different reason than its bin-resident siblings.
// R51 gave bin-resident cards a trigger surface (`zone: 'bin'`), which is half
// of what this needs — but the OTHER half is an event that does not exist:
// nothing fires when a card LEAVES a bin. There is no single choke point to
// fire it from either: bins are spliced directly by a dozen card effects
// (exhume, recall-from-bin, erase-from-bin, graft/augment-from-bin,
// cacheFromBin, {Modular} mod payment…) plus engine code. Wiring this properly
// means routing every one of those through an E.takeFromBin() helper, which is
// a cross-cutting change over batch files owned by other lanes.
// Plays as a printed 2/1 meanwhile.
card('Rotling', {});

// "[Augment] At the start of deployment, you may discard your hand and
// transform me into Beyond, Codex Incarnate." — dd/1 0/2 {Haste} Blight Unit.
// HALF UNPARKED (R50): the start-of-deployment EVENT now exists and this card
// hears it. What is still missing is the other two thirds — TRANSFORM
// machinery (nothing in the engine replaces one card's identity with
// another's) and the transform TARGET itself: "Beyond, Codex Incarnate" is not
// in the printed pool at all, so there is nothing to become.
//
// The trigger is therefore wired and deliberately declines to do the harmful
// half on its own: discarding your hand with no transform to show for it is
// strictly worse than doing nothing, and "you may" makes it optional anyway.
// It logs the gap once per deployment instead of being invisible.
card('Scholar of the Void', {
  augmentText: [{
    type: 'triggered', events: ['startOfDeployment'],
    label: 'at the start of deployment, discard your hand to transform me',
    effect: {
      run: (g, ctx) => {
        g.ev('info',
          `${ctx.sourceName}: the transform target "Beyond, Codex Incarnate" is not in the `
          + 'card pool and the engine has no transform layer — the option is declined.');
      },
    },
  }],
});

// "(You can apply mods to a modular card from your hand and/or bin as it is
// played. You still pay their costs.) [Switch1] You gain one rot." — d/1
// {Battle} {Modular} Arcane Spell. {Modular} itself is engine-side (R35's
// cast-time collection: the mods are an additional COST, they ride on the
// stack with the spell and their graft effects join as extra parts) — the
// card scripts only its own body, which is a pure downside: a 1-mana carrier
// that charges you a rot for the privilege.
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
        g.player(seat).bin.splice(i, 1);
        g.player(seat).hand.push('Xzydris');
        g.ev('info', `Xzydris is recalled from ${g.pname(seat)}'s bin to their hand.`);
      },
    },
  }],
});
