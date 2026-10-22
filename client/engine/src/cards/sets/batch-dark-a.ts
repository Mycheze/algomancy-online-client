/* Light & Dark expansion — batch dark-a (18 cards).
 *
 * Behaviour only; printed data comes from printed.json (never hand-copied).
 * Spec for the expansion's new mechanics: docs/08-light-and-dark.md,
 * and the Comprehensive Rules.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: CR 109.3a, 109.3b (conditions at event time, amounts at resolution),
 * CR 704.6, 704.6b (fizzle vs partial), CR 111.9 (payments are part of resolution, via
 * ctx.choose), CR 803.4 (bounded budgets per card), CR 101.6, 601.4d ("each unit / each
 * player" is region-scoped), CR 601.5 (a created unit arrives where its SOURCE
 * is — ctx.region — so a Wraith minted mid-attack stays in the battle region),
 * CR 701.2 (applying a mod is not playing a card), CR 801.2 (trashing), CR 801.9 (glimpse),
 * CR 110.2c (the Wraith token; retired name Wight).
 *
 * Cards in this batch:
 *   Afflicting Anima, Burn the Blight, Cosmic Devourer, Cull, Exhume, Glook,
 *   Gzxyclop, Leave None Pure, Maw of Despair, Möbius's Corruption, Nothyr,
 *   Pestilent Titan, Reality Siphoner, Sacrifice Dude, Scuttling Abomination,
 *   Spore of Regenesis, Tilling the Graves, Wake the Dead.
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - BIN PICKS (Exhume, Wake the Dead, Spore of Regenesis) stay
 *    RESOLUTION-time ctx.choose picks — and correctly so: none of the three
 *    prints "target". They say "put A unit", "up to two units in any bin" and
 *    "ALL units with cost [1]", which are selections made while the effect
 *    resolves, not declared targets.
 *  - "PUT INTO PLAY" (Exhume) is spawnUnit: the unit arrives directly in play
 *    and fires its spawn triggers, with no stack step and no play event —
 *    which is exactly right, because putting a card into play is not playing
 *    it. The play/put-into-play ruling (CR 301.9) split "PLAY … NOW, FOR FREE" (Wake the Dead) back off it: that
 *    card prints the other verb, so its units spawn `asPlay` and fire
 *    'cardPlayed' (CR 108.1a) from 'bin' (CR 410.6). What they still do NOT get is a stack item
 *    of their own — no response window, nothing to negate — which is the
 *    standing `playInline` approximation for a card played mid-resolution.
 *    Wake the Dead reaches into ANY bin, and it is NO LONGER an approximation
 *    that a unit raised out of the opponent's bin becomes the caster's card:
 *    CARD-TODO #17 gave spawnUnit an `owner` option (defaulting to the seat it
 *    enters play under), and Wake the Dead passes the bin's own seat. The
 *    caster CONTROLS it and the opponent still OWNS it (CR 102.5a); zones follow control, so it dies to the caster's bin (CR 400.4), where the caster can recur it.
 *  - "TARGET NONSPELL EFFECT" (Nothyr) IS a TargetSpec now:
 *    `what: 'stackEffect'` is the superset and a `restrict` narrows it to the
 *    nonspell half. The ruling now at CR 700.1b made that superset EVERY item on the stack (a unit
 *    on its way into play included), so the nonspell half is triggered,
 *    activated, virus AND unit — everything that is not spell / spell unit /
 *    spell token / ambush.
 *    It is collected (CR 110.1a) as the trigger goes on the stack.
 *    This entry used to say the card "has no TargetSpec … modelled as a
 *    resolution-time ctx.choose"; that expired, and with it the "slightly
 *    stronger than printed: the pick cannot be responded to" caveat.
 *  - "REMOVE ALL COUNTERS FROM … PLAYERS" (Burn the Blight) reads rot and
 *    debt as the player counters (both are called counters by CR 112.15).
 *    The removal ruling (CR 112.15) gave this a real primitive: E.loseRot / E.loseDebt, which fire
 *    'rotLost' / 'debtLost'. It used to zero p.rot and p.debt DIRECTLY — the
 *    only writes to either field outside gainRot/gainDebt — so nothing
 *    watching a player's counters could see them go. NOT an approximation any
 *    more, and no longer in this list's spirit; kept here as the pointer.
 *  - "NO STAT CHANGES" (Leave None Pure) = the unit's effective stats equal
 *    its printed/token base AND it carries no counters or until-regroup
 *    changes. That deliberately includes stat changes projected onto it by
 *    someone else's static (a lord's +1/+1): those are stat changes too.
 *    It is a TARGETING RESTRICTION (CR 110.3a; TargetSpec.restrict): only unmodified
 *    units are ever offered. The resolution recheck stays for a unit that
 *    changes between cast and resolution (CR 704.5) — but the sentence this note
 *    used to carry, "the spec cannot be a target filter, so an 'illegal'
 *    target simply survives", is no longer true of either half.
 *  - TRASH TRIGGERS CANNOT CARRY GRAFT RIDERS. Afflicting Anima and Maw of
 *    Despair print their trash trigger as a [Switch1] graft CAUSE, but a card
 *    trashed out of a bin fires from a detached ghost entity with no mods
 *    (E.fireOwnTrashTrigger), so nothing can ever ride along. graftCause is
 *    kept for fidelity; the donatable graftEffect (the interesting half) works
 *    normally.
 *  - Gzxyclop / Scuttling Abomination / Tilling the Graves DISCARD a chosen
 *    card: the chooser is the effect's controller (the host's controller when
 *    the text arrives by augment).
 */
import type { CardName, Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, isSpellEffect, unitRestrict, type EffectCtx, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt, manaOf, isUnitCard } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** seats physically in a region (CR 601.4d: "each player" is region-scoped) */
// CR 601.4c: one helper for the whole pool, on E. This file and batch-wood-b had
// grown their own copies of it, with different orders.
const presentSeats = (g: E, region: number): Seat[] => g.seatsHere(region);

/** PRINTED/token stats — layer 1 only, deliberately NOT E.baseStatsOf: this
 * is the number the card was made with, so that "no stat changes" counts a
 * rewritten base (Formless, Body Swap, Aberrant Statweaver) as a change.
 * CR 710.2: read through `E.printedStats`, which puts the COPY face (layer 0)
 * under layer 1 — a Borrower of Forms that copied an untouched Good Whale is
 * an untouched 7/5, not a changed Borrower. */
const printedStats = (g: E, u: Entity): [number, number] => g.printedStats(u);

/** has anything at all moved this unit off its printed numbers? Layer 2 is
 * checked explicitly because a rewrite to the SAME numbers (Formless on a
 * printed 4/4) leaves effStats looking untouched. */
const statsUntouched = (g: E, u: Entity): boolean => {
  const [bp, bt] = printedStats(g, u);
  const [p, d] = g.effStats(u);
  return u.counters === 0 && u.tempPower === 0 && u.tempToughness === 0
    && u.baseSet === undefined && p === bp && d === bt;
};

/** [name, binIndex] pairs of `seat`'s bin passing a filter */
const binMatches = (g: E, seat: Seat, ok: (name: CardName) => boolean): [CardName, number][] =>
  g.player(seat).bin.map((n, i) => [n, i] as [CardName, number]).filter(([n]) => ok(n));

/**
 * Plan (do not commit) `n` discards from `seat`'s hand: returns the chosen
 * hand indices. Choices only — the caller commits with discardHand() once
 * every choice is in, because the engine replays the whole part after a
 * suspension.
 */
function planDiscards(g: E, ctx: EffectCtx, key: string, seat: Seat, n: number, prompt: string): number[] {
  const hand = g.player(seat).hand;
  const picked: number[] = [];
  for (let k = 0; k < n; k++) {
    const opts = hand
      .map((c, i) => ({ label: c, value: i, card: c }))
      .filter(o => !picked.includes(o.value));
    if (!opts.length) break;
    const idx = opts.length === 1 ? opts[0]!.value : ctx.choose(`${key}:${k}`, {
      kind: 'payOrDecline', seat, prompt, options: opts,
    }) as number;
    picked.push(idx);
  }
  return picked;
}

/** commit planned discards — highest index first, so the rest stay valid.
 * Each one is a trash (CR 801.3) and fires its own trashed trigger. */
function discardHand(g: E, seat: Seat, picked: number[]): void {
  for (const i of [...picked].sort((a, z) => z - a)) g.discardFromHand(seat, i);
}

// ───────────────────────────── the cards ──────────────────────────────

// "When I am trashed, [Switch1] You may pay [1] to create a Wraith." — d/1
// 0/1 Alien Anima Unit. CR 801.2a: the trigger fires FROM THE BIN, however the card
// got there (discarded, milled, sacrificed, died in combat) — so ctx.sourceId
// resolves to nothing and nothing here may read "me" as an entity. The [1] is
// a mid-resolution pay-or-decline (CR 111.9). CR 304.4: "create a Wraith" spawns the
// Wraith body. Bounded graft ([Switch1]) — ⚠ header: a trash trigger can never
// actually carry a graft rider, but the card is still graftable.
const animaWraith: EffectDef = {
  creates: ['Wraith'],
  run: (g, ctx) => {
    if (g.openMana(ctx.controller) < 1) {
      ctx.refundBudget?.();   // CR 109.9b: no offer could be made, so the use is not spent
      g.ev('info', 'Afflicting Anima: cannot pay [1] — no Wraith.');
      return;
    }
    const pays = ctx.choose('pay', {
      kind: 'payOrDecline', seat: ctx.controller,
      prompt: 'Afflicting Anima: pay [1] to create a Wraith?',
      options: [{ label: 'Pay [1] — create a Wraith', value: true }, { label: 'Decline', value: false }],
    });
    if (pays !== true) {
      ctx.refundBudget?.();   // CR 109.9b: declining a "you may" never spends it
      g.ev('info', 'Afflicting Anima: [1] is not paid — no Wraith.');
      return;
    }
    g.payMana(ctx.controller, 1);
    g.createWraith(ctx.controller, ctx.region);   // CR 601.5
  },
};
card('Afflicting Anima', {
  abilities: [{
    type: 'triggered', events: ['trashed'], self: true, bounded: true, graftCause: true,
    label: 'you may pay [1] to create a Wraith',
    effect: animaWraith,
  }],
  graftEffect: { bounded: true, effect: animaWraith },
});

// "Remove all counters from units and players." — dd/3 {Battle} Blight Spell.
// Units: their net +1/+1 / -1/-1 counters, region-scoped (CR 101.6). Players: rot
// and debt, the two player counters (CR 112.15), for the seats present in this
// region (CR 601.4d). Rot "never decreases on its own" (CR 112.13a) — this is a card
// decreasing it, which is exactly what the printed text says to do.
//
// CR 112.15: through E.loseRot / E.loseDebt, which ANNOUNCE the removal
// ('rotLost' / 'debtLost'). This used to write p.rot = 0 / p.debt = 0 raw,
// the only two such writes in the tree, so a card watching player counters
// saw them arrive and never saw them leave.
//
// ⚠ THE REMOVAL IS NOT SCALED BY THE AMOUNT LAYER (CR 112.15), by owner ruling
// (2026-08-25): *"Resonater says 'put on' so this question is irrelevant.
// Removing counters isn't 'putting on'."* Flux Resonator and Proliferating
// Slime price what is PUT ON; a removal is not in their scope, and the scope
// of a layer is read off the printed text of the card that DEFINES it. So a
// Proliferating Slime on the board does not deepen this sweep by one.
card('Burn the Blight', {
  spellEffect: {
    run: (g, ctx) => {
      let stripped = 0;
      for (const u of g.unitsIn(ctx.region)) {
        // CR 708.8: a REMOVAL (E.removeCounters), not a -1/-1 placement — report #210
        if (g.removeCounters(u, Math.abs(u.counters))) stripped++;
      }
      for (const seat of presentSeats(g, ctx.region)) {
        const rot = g.rot(seat), debt = g.debt(seat);
        if (!rot && !debt) continue;
        g.loseRot(seat, rot);     // CR 112.15
        g.loseDebt(seat, debt);   // CR 112.15
        g.ev('info',
          `Burn the Blight removes ${g.pname(seat)}'s counters: ${rot} rot, ${debt} debt.`,
          { seat, rot, debt });
        stripped++;
      }
      if (!stripped) g.ev('info', 'Burn the Blight: there are no counters anywhere to remove.');
    },
  },
});

// "[Augment] At the end of turn, create a Wraith and gain 1 Rot." — dd/1 0/1
// Alien Unit. Text-box [Augment]: live when played normally (Manual Q&A),
// donated when it augments a host — and then it is the HOST's controller who
// gets both the Wraith and the rot. CR 305.4, 112.13e.
card('Cosmic Devourer', {
  augmentText: [{
    type: 'triggered', events: ['endOfTurn'],
    label: 'create a Wraith and gain 1 rot (end of turn)',
    effect: {
      creates: ['Wraith'],
      run: (g, ctx) => {
        g.createWraith(ctx.controller, ctx.region);   // CR 601.5
        g.gainRot(ctx.controller, 1);
      },
    },
  }],
});

// "[Switch1] Each player sacrifices a unit." — d/1 {Battle} Blight Spell.
// "Each player" is region-scoped (CR 601.4d): every seat present here with a unit
// here picks one of their own. Plan-then-commit — all picks first, then all
// sacrifices — because the engine replays the part on suspension. A seat with
// exactly one unit has no choice to make. Bounded graft ([Switch1], CR 722.5).
const cullSacrifices: EffectDef = {
  run: (g, ctx) => {
    const picks: EntityId[] = [];
    for (const seat of presentSeats(g, ctx.region)) {
      const mine = g.unitsOf(seat, ctx.region);
      if (!mine.length) continue;
      const id = mine.length === 1 ? mine[0]!.id : ctx.choose(`cull:${seat}`, {
        kind: 'payOrDecline', seat,
        prompt: 'Cull: sacrifice which unit?',
        options: mine.map(u => ({ label: u.card, value: u.id, card: u.card })),
      }) as EntityId;
      picks.push(id);
    }
    // CR D7.3/CT-74: every present seat may be here with NOTHING to sacrifice —
    // an attack whose columns all traded off leaves exactly that board. The
    // loop is then correct and the silence is not (Ghord's precedent).
    if (!picks.length) {
      g.ev('info', 'Cull: nobody here has a unit to sacrifice.');
      return;
    }
    for (const id of picks) {
      const u = g.entity(id);
      if (u) g.destroy(u, 'is sacrificed');
    }
  },
};
card('Cull', {
  spellEffect: cullSacrifices,
  graftEffect: { bounded: true, effect: cullSacrifices },
});

// "Put a unit with cost X or less from your bin into play, where X is your
// [d]." — d/2 Occult Spell (deployment). X is your DARK AFFINITY, read live
// at resolution (CR 107.8) — dormant resources give no affinity, expended ones
// still do. ⚠ header: the bin pick is a resolution-time choose, and the unit
// is put straight into play (its spawn triggers fire).
card('Exhume', {
  spellEffect: {
    run: (g, ctx) => {
      const x = g.affinity(ctx.controller, 'dark');
      const units = binMatches(g, ctx.controller, n => isUnitCard(n) && manaOf(n) <= x);
      if (!units.length) {
        g.ev('info', `Exhume: no unit costing ${x} or less in ${g.pname(ctx.controller)}'s bin.`);
        return;
      }
      const idx = units.length === 1 ? units[0]![1] : ctx.choose('which', {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: `Exhume: put which unit (cost ${x} or less) into play?`,
        options: units.map(([n, i]) => ({ label: n, value: i, card: n })),
      }) as number;
      const name = g.removeFromBin(ctx.controller, idx, 'revived');   // CR 405.7
      if (name !== undefined) g.spawnUnit(ctx.controller, name, ctx.region);
    },
  },
});

// "[once] Discard X cards: Glimpse 1, X times." — d/2 1/3 Alien Fungus Unit.
// [once] = bounded (CR 109.9). "Glimpse 1, X times" is deliberately X separate
// glimpses (CR 801.9c), which is what makes X a count of CARDS.
//
// CR 705.3b — X IS PAID AT ACTIVATION. The discards used to be chosen card-by-card
// at RESOLUTION, so the ability reached the stack with X unknown and the
// opponent had to decide whether to answer without knowing how many glimpses
// were coming. That is the exact complaint once raised about Discharge
// ("Shouldn't Discharge have you remove counters as an ADDITIONAL COST? Not on
// resolution"), and the answer is the same: `castCost: { kind: 'discardCard',
// n: 'X' }`. Nothing new was needed — the variable machinery a spell's
// bracketed cost already used simply reaches an activated ability through
// `EffectDef.castCost`, and `ctx.x` is what was paid.
//
// Each discard is still a TRASH (CR 801.3) firing its own trigger; the only change
// is that they are committed one at a time as they are chosen, in the cast
// window, instead of being planned and then committed at resolution.
card('Glook', {
  abilities: [{
    type: 'activated', cost: {}, bounded: true,
    label: 'discard X cards: glimpse 1, X times',
    effect: {
      castCost: { kind: 'discardCard', n: 'X' },
      run: (g, ctx) => {
        const x = ctx.x ?? 0;
        if (!x) { g.ev('info', 'Glook: X = 0 — nothing discarded, nothing glimpsed.'); return; }
        for (let i = 0; i < x; i++) g.glimpse(ctx.controller, 1);
      },
    },
  }],
});

// "When I spawn, draw a card.{/n}[Augment] When I despawn, discard two
// cards." — d/1 1/2 {Virus} Blight Zombie Unit. The first sentence stays with
// the card; the [Augment] sentence transfers (the downside rides along to the
// host's controller). Despawn = ANY leave-play, 'died' + 'despawned' (the
// Bloated Manablub reading). The two discards are chosen (⚠ header) and are
// TRASHES (CR 801.3).
card('Gzxyclop', {
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true,
    label: 'draw a card',
    effect: { run: (g, ctx) => g.draw(ctx.controller, 1) },
  }],
  augmentText: [{
    type: 'triggered', events: ['died', 'despawned'], self: true,
    label: 'discard two cards',
    effect: {
      run: (g, ctx) => {
        const picked = planDiscards(g, ctx, 'gz', ctx.controller, 2, 'Gzxyclop: discard two cards');
        if (!picked.length) { g.ev('info', 'Gzxyclop: your hand is already empty — nothing is discarded.'); return; }
        discardHand(g, ctx.controller, picked);
      },
    },
  }],
});

// "Delete target unit with no stat changes." — d/2 {Battle} Blight Spell.
// CR 110.3a: "with no stat changes" is part of what makes a target LEGAL, so only
// unmodified units are offered. The CR 704.5 half is the engine's, judged once
// as the spell begins to resolve (markIllegalTargets) — a unit that picks up
// counters, until-regroup changes or somebody's static buff between cast and
// resolution survives. The run does not test it again (CR 704.5a, CT-232). (The line that used to sit
// here, "⚠ header: TargetSpec has no filter", contradicted the spec six lines
// below it.)
card('Leave None Pure', {
  spellEffect: {
    // CR 110.3a: "with no stat changes" is a targeting restriction, so only the
    // unmodified units are ever offered; CR 704.5 judges it again, once, as
    // the spell begins to resolve.
    targets: {
      what: 'unit', prompt: 'Leave None Pure: delete target unit with no stat changes',
      restrict: unitRestrict((g, u) => statsUntouched(g, u)),
    },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) return;
      // CR 704.5a (CT-232): "with no stat changes" was judged once, as the
      // spell began to resolve; it is not tested again in the run
      g.destroy(t, 'is deleted');
    },
  },
});

// "When I am trashed, [Switch1] Glimpse 2." — d/1 2/1 Bedlam Alien Unit.
// CR 801.9: the trigger fires from the bin, and glimpse 2 reveals the top two
// cards, caches ONE of the glimpser's choice — playable until end of turn,
// paying the mana, ignoring affinity — and recycles the other to the bottom of
// the deck. Bounded graft ([Switch1]); ⚠ header on the graft-rider limitation.
const mawGlimpse: EffectDef = { run: (g, ctx) => { g.glimpse(ctx.controller, 2); } };
card('Maw of Despair', {
  abilities: [{
    type: 'triggered', events: ['trashed'], self: true, bounded: true, graftCause: true,
    label: 'glimpse 2',
    effect: mawGlimpse,
  }],
  graftEffect: { bounded: true, effect: mawGlimpse },
});

// "[Augment] After combat, put two -1/-1 counters on me." — d/1 5/3 {Virus}
// Polyform Unit. Text-box [Augment]: live on the 5/3 played normally, donated
// when it Viruses a host ("me" = the host). NOT self: the afterCombat event
// carries no source unit (Deathglow Strider precedent) — region scoping keeps
// it to the battle the carrier is in. Counters are net, so two -1/-1 cancel
// two +1/+1 (Manual).
card("Möbius's Corruption", {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'put two -1/-1 counters on me (after combat)',
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) { g.ev('info', "Möbius's Corruption: the carrier is gone — no counters."); return; }
        g.addCounters(self, -2);
      },
    },
  }],
});

// "When I am trashed, negate up to one target nonspell effect." — d/2 3/1
// Alien Anima Unit, with a printed "2 [d] Discard Me. {Battle}" cost line:
// paying it discards the card, which trashes it (CR 801.3) and fires this from the
// bin — a battle-timed hard answer to a trigger. The discard-me mode itself
// is entirely engine-side (printed.discardMe + legalActions).
// CR 700.1b, 110.1a: "target nonspell effect" is a DECLARED target — 'stackEffect'
// narrowed by a restriction to the nonspell half — collected as the trigger
// goes on the stack ("up to one" = min 0). Outside battle the stack is empty
// and the trigger is simply a no-op. (The "⚠ has no TargetSpec, so the pick is
// a resolution-time choose" line that used to sit here was contradicted by the
// spec twelve lines below it.)
card('Nothyr', {
  abilities: [{
    type: 'triggered', events: ['trashed'], self: true,
    label: 'negate up to one target nonspell effect',
    effect: {
      // CR 110.1a: "up to one target nonspell effect" is a DECLARED target, chosen
      // as the trigger goes on the stack, not a mid-resolution pick — the
      // whole point of a negate is that the table can see what it is aimed at
      // while there is still a window to respond. 'stackEffect' is the
      // superset kind (CR 700.1); the restriction narrows it to the NONSPELL half,
      // which is exactly the qualifier Nothyr prints. min 0 = "up to one".
      //
      // The NONSPELL half is the COMPLEMENT of the spell one, and nothing
      // else: 'stackSpell' is `isSpellEffect` (spell / spell unit / spell
      // token), so "nonspell effect" is every OTHER item on the stack: triggered
      // and activated abilities, viruses, units, and an Ambush (CR 700.1b).
      //
      // The owner (2026-08-24) reversed that reading (now CR 700.1): "ANYTHING on the stack is an
      // effect, including units and spell units. Units aren't spells, so if
      // they say 'spell effect' a unit would be unaffected." A {Battle} unit
      // mid-cast is therefore an effect (CR 700.1b) AND not a spell (same
      // sentence), which is precisely what "nonspell effect" names — so
      // Nothyr answers it, and the restriction is written as the complement
      // rather than as a whitelist that would have to be edited again the next
      // time a kind is added. An AMBUSH is a nonspell effect too (report #218: an
      // Ambush is a unit card, not a spell — _passer, Caleb deferring: "From
      // 'not spell' you can have Triggered/Activated ability, Ambush or units"),
      // so Nothyr reaches it.
      targets: {
        what: 'stackEffect', min: 0,
        prompt: 'Nothyr: negate up to one target nonspell effect',
        restrict: (g, t) => {
          if (!('stack' in t)) return false;
          const it = g.s.stack.find(i => i.id === t.stack);
          return !!it && !isSpellEffect(it.kind);   // CR 700.1b: the complement
        },
      },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!t || !('stack' in t)) { g.ev('info', 'Nothyr: no nonspell effect on the stack.'); return; }
        g.negate(t.stack);
      },
    },
  }],
});

// "When I attack or block, [Switch1] Put a -1/-1 counter on each unit. Each
// player gains a rot." — d/4 3/4 Blight Zombie Unit. Both halves are
// region-scoped (CR 101.6, 601.4d): every unit in this region, every seat present in
// it — the Titan and its own controller included. CR 112.13: gaining rot is not
// damage; it bites at the start of the next deployment. Bounded graft
// ([Switch1], CR 722.5).
const titanPlague: EffectDef = {
  run: (g, ctx) => {
    for (const u of g.unitsIn(ctx.region)) g.addCounters(u, -1);
    for (const seat of presentSeats(g, ctx.region)) g.gainRot(seat, 1);
  },
};
card('Pestilent Titan', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true, bounded: true, graftCause: true,
    label: 'a -1/-1 counter on each unit; each player gains a rot',
    effect: titanPlague,
  }],
  graftEffect: { bounded: true, effect: titanPlague },
});

// "[Augment] At the end of turn, recycle your bin. Put a +1/+1 counter on me
// for each card recycled this way." — d/1 2/2 {Virus} Polyform Unit. Text-box
// [Augment]: live played normally, donated on augment ("your"/"me" both read
// the carrier's side). "Recycle" = to the bottom of the deck the controller
// draws from (the shared deck outside constructed). The count is read from
// what actually moved, so an empty bin gives no counters.
card('Reality Siphoner', {
  augmentText: [{
    type: 'triggered', events: ['endOfTurn'],
    label: 'recycle your bin; a +1/+1 counter for each card recycled',
    effect: {
      run: (g, ctx) => {
        const bin = g.player(ctx.controller).bin;
        if (!bin.length) {
          g.ev('info', 'Reality Siphoner: your bin is empty — nothing is recycled, no counters.');
          return;
        }
        // CR 405.7: per card, back-to-front — each removal fires its own 'leftBin'
        const moved: string[] = [];
        while (bin.length) moved.unshift(g.removeFromBin(ctx.controller, bin.length - 1, 'recycled')!);
        for (const name of moved) g.recycleToBottom(ctx.controller, name);
        g.ev('info',
          `Reality Siphoner recycles ${moved.length} card(s) from ${g.pname(ctx.controller)}'s bin.`,
          { seat: ctx.controller, n: moved.length });
        const self = selfOf(g, ctx);
        if (self) g.addCounters(self, moved.length);
      },
    },
  }],
});

// "When I enter your bin, you may pay [2]. If you do, each opponent
// sacrifices a nontoken unit." — d/1 2/1 Blight Unit, with a printed
// "2 [d] Discard me" cost line (deployment timing — the line carries no
// marker, so the card's own timing applies).
// "When I enter your bin" is the trashed trigger (CR 801.2): a UNIT can only reach a
// bin from play, hand, deck or cache, every one of which trashes, so the two
// readings coincide here. Plan-then-commit: the payment decision and
// every opponent's pick are made before anything is paid or sacrificed.
card('Sacrifice Dude', {
  abilities: [{
    type: 'triggered', events: ['trashed'], self: true,
    label: 'you may pay [2] — each opponent sacrifices a nontoken unit',
    effect: {
      run: (g, ctx) => {
        if (g.openMana(ctx.controller) < 2) {
          g.ev('info', 'Sacrifice Dude: cannot pay [2].');
          return;
        }
        const pays = ctx.choose('pay', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Sacrifice Dude: pay [2] to make each opponent sacrifice a nontoken unit?',
          options: [{ label: 'Pay [2]', value: true }, { label: 'Decline', value: false }],
        });
        if (pays !== true) { g.ev('info', 'Sacrifice Dude: the [2] is declined — nobody sacrifices.'); return; }
        const picks: EntityId[] = [];
        for (const seat of presentSeats(g, ctx.region)) {
          if (seat === ctx.controller) continue;
          const mine = g.unitsOf(seat, ctx.region).filter(u => !u.token);
          if (!mine.length) continue;
          const id = mine.length === 1 ? mine[0]!.id : ctx.choose(`sac:${seat}`, {
            kind: 'payOrDecline', seat,
            prompt: 'Sacrifice Dude: sacrifice which nontoken unit?',
            options: mine.map(u => ({ label: u.card, value: u.id, card: u.card })),
          }) as EntityId;
          picks.push(id);
        }
        g.payMana(ctx.controller, 2);
        g.ev('info', `Sacrifice Dude: ${g.pname(ctx.controller)} pays [2]${
          picks.length ? '' : ' — but no opponent here has a nontoken unit to sacrifice'}.`);
        for (const id of picks) {
          const u = g.entity(id);
          if (u) g.destroy(u, 'is sacrificed');
        }
      },
    },
  }],
});

// "When I attack or block, [Switch1] Draw a card, then discard a card." —
// dd/2 2/2 Polyform Unit. "Then" is strict: the draw happens first, so the
// card just drawn is a legal discard. The draw is a mutation BEFORE a choice,
// which is safe here — resolveParts snapshots the state and replays the whole
// part with the stored answer, so the draw happens exactly once. Bounded
// graft ([Switch1], CR 722.5).
const loot: EffectDef = {
  run: (g, ctx) => {
    g.draw(ctx.controller, 1);
    const picked = planDiscards(g, ctx, 'loot', ctx.controller, 1,
      'Scuttling Abomination: discard a card');
    discardHand(g, ctx.controller, picked);
  },
};
card('Scuttling Abomination', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true, bounded: true, graftCause: true,
    label: 'draw a card, then discard a card',
    effect: loot,
  }],
  graftEffect: { bounded: true, effect: loot },
});

// "When I die, you may erase me to put all units with cost [1] from your bin
// into play." — d/3 0/1 Blight Unit. Dying binned it (and trashed it, CR 801.2a)
// one event earlier, so "erase me" is: take that copy back out of the bin and
// destroy it — erasing never touches a bin again (CR 801.2c), so this is NOT a
// second trash. A Spore that died MODDED was Unstable-erased instead and has
// no bin copy to pay with: the cost cannot be paid and nothing happens.
// "Cost [1]" is exactly 1. ⚠ header: the bin sweep is not targeting.
card('Spore of Regenesis', {
  abilities: [{
    type: 'triggered', events: ['died'], self: true,
    label: 'erase me to put all your cost-[1] units from the bin into play',
    effect: {
      run: (g, ctx) => {
        const bin = g.player(ctx.controller).bin;
        const mine = bin.lastIndexOf('Spore of Regenesis');
        if (mine === -1) {
          g.ev('info', 'Spore of Regenesis: it is not in the bin — the erase cost cannot be paid.');
          return;
        }
        const revivable = binMatches(g, ctx.controller, n => isUnitCard(n) && manaOf(n) === 1);
        if (!revivable.length) {
          g.ev('info', 'Spore of Regenesis: no cost-[1] unit in the bin.');
          return;
        }
        const yes = ctx.choose('erase', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Spore of Regenesis: erase me to put ${revivable.length} cost-[1] unit(s) into play?`,
          options: [{ label: 'Erase me — revive them', value: true }, { label: 'Decline', value: false }],
        });
        if (yes !== true) {
          g.ev('info', 'Spore of Regenesis: the erase is declined — nothing returns from the bin.');
          return;
        }
        // highest index first so the earlier indices stay valid
        const idxs = [mine, ...revivable.map(([, i]) => i)].sort((a, z) => z - a);
        const names: CardName[] = [];
        for (const i of idxs) {
          const name = g.removeFromBin(ctx.controller, i, i === mine ? 'erased' : 'revived');   // CR 405.7
          if (name !== undefined && i !== mine) names.push(name);
        }
        g.ev('erased', 'Spore of Regenesis is ERASED from the bin (its own cost).',
          { card: 'Spore of Regenesis', seat: ctx.controller });
        for (const name of names.reverse()) g.spawnUnit(ctx.controller, name, ctx.region);
      },
    },
  }],
});

// "Recall two target units in your bin, then discard a card." — dd/4 {Battle}
// Alien Spell. "Recall … in your bin" = back to your HAND (recall is the
// leave-play/return-to-hand verb; from a bin there is nothing to leave).
// CR 110.1a: "two TARGET units in your bin" is real targeting — two cast-time
// targets, and BinRef.nth means two copies of one card are two separate
// targets. BOTH are required (CR 110.7): with fewer than two units in your bin
// the spell is not castable, even though "then discard a card" has no target;
// the owner, 2026-10-16 (CT-299): it needs both
// targets, "otherwise it'd say 'up to two'". The RAQ agrees in general
// (_passer, 2025-08-27): "In order to play a card, you must be able to select
// the valid targets". Once cast, one target leaving the bin is CR 704.6b partial
// resolution — the other returns and the discard still happens.
card('Tilling the Graves', {
  spellEffect: {
    targets: {
      what: 'binCard', count: 2, min: 2,
      symmetric: true,
      prompt: 'Tilling the Graves: recall two target units in your bin',
      restrict: (_g, t) => 'binCard' in t && isUnitCard(t.binCard.card),
    },
    run: (g, ctx) => {
      const seat = ctx.controller;
      g.player(seat).bin;
      // resolve every ref to a live index FIRST, then splice from the back —
      // an index read before an earlier splice would be stale
      const chosen = ctx.targets
        .filter((t): t is { binCard: { seat: Seat; index: number; card: CardName } } => 'binCard' in t)
        .map(t => t.binCard.index)
        .filter(i => i !== -1);
      const taken: CardName[] = [];
      for (const i of [...new Set(chosen)].sort((a, z) => z - a)) {
        const name = g.removeFromBin(seat, i, 'recalled');   // CR 405.7
        if (name !== undefined) taken.push(name);
      }
      // CR 706.6a: the whole recall is ONE move into a hand, so it announces ONE
      // 'handEntered' — the printed shape is "one or more cards enter".
      const order = taken.reverse();
      g.toHand(seat, order, 'bin');
      for (const name of order) {
        g.ev('info', `Tilling the Graves: ${name} returns to ${g.pname(seat)}'s hand.`);
      }
      if (!taken.length) g.ev('info', 'Tilling the Graves: no unit is targeted in your bin — nothing returns.');
      // "then discard a card" — the recalled units are legal discards
      const picked = planDiscards(g, ctx, 'till', seat, 1, 'Tilling the Graves: discard a card');
      if (!picked.length) g.ev('info', 'Tilling the Graves: your hand is empty — nothing is discarded.');
      discardHand(g, seat, picked);
    },
  },
});

// "Play up to two units in any bin with total cost [8] or less now, for
// free." — ddd/8 {Battle} Occult Spell. ANY bin: both players'. "Up to two"
// with a running budget — the second pick is offered only from what still
// fits under 8 minus the first. ⚠ header: "play … now" resolves inside this
// spell's own resolution — the units arrive with no stack item of their own,
// so nobody may respond to them and nothing can negate one. CR 301.9 makes them a
// real PLAY in every other respect (see below); the missing response window is
// the standing `playInline` approximation, not this card's.
//
// CARD-TODO #17, fixed 2026-08-23: a unit taken out of the OPPONENT's bin is
// BORROWED, not naturalised. `spawnUnit` now takes an owner (defaulting to the
// seat it enters play under), so the caster is its CONTROLLER while `c.seat`
// stays its OWNER (CR 102.5a); it dies to its controller's bin (CR 400.4), counts toward that player's "cards in
// your bin", and they can recur it. Before the parameter existed the caster
// became its owner outright and the original owner lost the card for good.
card('Wake the Dead', {
  spellEffect: {
    run: (g, ctx) => {
      const seat = ctx.controller;
      type Pick = { seat: Seat; idx: number; name: CardName };
      const chosen: Pick[] = [];
      let budget = 8;
      for (let k = 0; k < 2; k++) {
        const opts: { label: string; value: string; card: CardName }[] = [];
        // CR 601.4c: "any bin" is any bin IN THIS REGION — a player who is not
        // here has no bin for this spell to reach into.
        for (const p of g.seatsHere(ctx.region).map(s => ({ seat: s }))) {
          g.player(p.seat).bin.forEach((name, i) => {
            if (!isUnitCard(name) || manaOf(name) > budget) return;
            if (chosen.some(c => c.seat === p.seat && c.idx === i)) return;
            opts.push({ label: `${name} [${manaOf(name)}] (${g.pname(p.seat)}'s bin)`, value: `${p.seat}:${i}`, card: name });
          });
        }
        if (!opts.length) break;
        const pick = ctx.choose(`wake:${k}`, {
          kind: 'payOrDecline', seat,
          prompt: `Wake the Dead: play a unit from any bin (${budget} cost left)`,
          options: [...opts, { label: 'Done', value: 'done' }],
          // the client's two-bin picker (display only: answers stay indices,
          // and a value names the same card on both questions because nothing
          // leaves a bin until both are answered)
          pickSet: { budget, picked: k, max: 2, group: 'bins' },
        }) as string;
        if (pick === 'done') break;
        const [sStr, iStr] = pick.split(':');
        const ps = Number(sStr) as Seat, pi = Number(iStr);
        const name = g.player(ps).bin[pi];
        if (name === undefined) break;
        chosen.push({ seat: ps, idx: pi, name });
        budget -= manaOf(name);
      }
      if (!chosen.length) { g.ev('info', 'Wake the Dead: nothing playable in any bin.'); return; }
      // remove highest index first within each bin, then spawn in pick order
      for (const c of [...chosen].sort((a, z) => z.idx - a.idx)) g.removeFromBin(c.seat, c.idx, 'revived');   // CR 405.7
      // CARD-TODO #17: "any bin" means the card may be the OPPONENT'S, and the
      // two seats are different facts. The CONTROLLER is the caster; the OWNER
      // is whichever bin it came out of. When it dies it goes to its CONTROLLER's bin, like
      // every card that leaves play (CR 400.4: zones follow control).
      //
      // CR 701.3: the printed verb is "PLAY", not "put into play", and the two are
      // a real distinction in this pool — Exhume, Resurrect, Rousing Spirit and
      // Lurking Dread all print "put into play" and are rightly plain spawns.
      // `asPlay` fires 'cardPlayed' (CR 108.1a) for each unit immediately before it
      // arrives, and `from: 'bin'` is the other half of the same fact (CR 410.6), so
      // "whenever you play a unit" (Bloomcaster) and "when you play a card from
      // anywhere other than your hand" (Stalwart Sentinel, Proph) both hear it
      // — each exactly once, because the spawn-watchers read 'spawned' and
      // Bloomcaster reads 'cardPlayed'.
      //
      // "FOR FREE" is untouched: nothing is paid here and nothing is added.
      // Being a play is about what the game HEARS, not about what it costs.
      // `seat` on the play event is the CASTER (the one doing the playing),
      // never the bin's owner — a borrowed card is still played by you.
      for (const c of chosen) {
        g.spawnUnit(ctx.controller, c.name, ctx.region,
          { owner: c.seat, from: 'bin', asPlay: true });
      }
    },
  },
});
