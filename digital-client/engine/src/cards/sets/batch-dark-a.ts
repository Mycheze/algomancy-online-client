/* Light & Dark expansion — batch dark-a (18 cards).
 *
 * Behaviour only; printed data comes from printed.json (never hand-copied).
 * Spec for the expansion's new mechanics: docs/08-light-and-dark.md,
 * rulings R38-R48 in docs/digital-rules.md.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (fizzle vs partial), R6 (payments are part of resolution, via
 * ctx.choose), R9 (bounded budgets per card), R12/R25 ("each unit / each
 * player" is region-scoped), R28/R52 (created units arrive in their
 * CONTROLLER's home region, whatever region the effect resolved in),
 * R37 (applying a mod is not playing a card), R40 (trashing), R45 (glimpse),
 * R47 (the Wraith/Wraith token).
 *
 * Cards in this batch:
 *   Afflicting Anima, Burn the Blight, Cosmic Devourer, Cull, Exhume, Glook,
 *   Gzxyclop, Leave None Pure, Maw of Despair, Möbius's Corruption, Nothyr,
 *   Pestilent Titan, Reality Siphoner, Sacrifice Dude, Scuttling Abomination,
 *   Spore of Regenesis, Tilling the Graves, Wake the Dead.
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - BIN PICKS ARE NOT TARGETING (Exhume, Tilling the Graves, Wake the Dead,
 *    Spore of Regenesis). The bin is not a targetable zone (TargetSpec covers
 *    units / players / stack items / cached cards only), so "target unit in
 *    your bin" is a RESOLUTION-time ctx.choose — it cannot be responded to and
 *    a hidden-information reveal never happens. The fire-b precedent
 *    (Resurrect, Reclaimer of Secrets, Rousing Spirit).
 *  - "PUT INTO PLAY" / "PLAY … NOW, FOR FREE" is spawnUnit: the unit arrives
 *    directly in play and fires its spawn triggers, with no stack step. Wake
 *    the Dead reaches into ANY bin, and spawnUnit has no owner parameter, so a
 *    unit stolen out of the opponent's bin becomes the caster's card outright
 *    (it returns to the CASTER's bin when it dies, not its printed owner's).
 *  - "TARGET NONSPELL EFFECT" (Nothyr) has no TargetSpec: `stackSpell` covers
 *    spells/spell units/spell tokens/ambushes only, which is the exact
 *    complement of what Nothyr wants. Modelled as a resolution-time
 *    ctx.choose over the triggered/activated items on the stack (the
 *    Containment Protocol precedent, plus "up to one" = a decline option).
 *    Slightly stronger than printed: the pick cannot be responded to.
 *  - "REMOVE ALL COUNTERS FROM … PLAYERS" (Burn the Blight) reads rot and
 *    debt as the player counters (both are called counters by R38/R39). There
 *    is no loseRot/loseDebt primitive — gainRot(-n) is a no-op by design — so
 *    the fields are zeroed directly with an explanatory log line.
 *  - "NO STAT CHANGES" (Leave None Pure) = the unit's effective stats equal
 *    its printed/token base AND it carries no counters or until-regroup
 *    changes. That deliberately includes stat changes projected onto it by
 *    someone else's static (a lord's +1/+1): those are stat changes too.
 *    Enforced at RESOLUTION (the Minor Kraken precedent) — the spec cannot be
 *    a target filter, so an "illegal" target simply survives.
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
import { card, getCard, unitRestrict, type EffectCtx, type EffectDef } from '../dsl.ts';

// ─────────────────────────── shared helpers ───────────────────────────

const isEnt = (t: unknown): t is Entity => !!t && typeof t === 'object' && 'id' in t;

/** the entity carrying the running ability (the host when donated/grafted) */
const selfOf = (g: E, ctx: EffectCtx): Entity | undefined =>
  ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;

/** seats physically in a region (R12/R25: "each player" is region-scoped) */
const presentSeats = (g: E, region: number): Seat[] =>
  g.s.regions[region]!.presentSeats.slice();

/** printed/token base stats (never calls effStats) */
const baseStats = (u: Entity): [number, number] =>
  u.tokenStats ?? [getCard(u.card).power, getCard(u.card).toughness];

/** a card that enters play as a unit (a spell unit does, on resolution) */
const isUnitCard = (name: CardName): boolean => {
  const k = getCard(name).kind;
  return k === 'unit' || k === 'spellUnit';
};

/** printed mana as a number ("X" counts as 0 — the fire-b/metal-a reading) */
const manaOf = (name: CardName): number => {
  const m = getCard(name).mana;
  return m === 'X' ? 0 : m;
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
 * Each one is a trash (R40) and fires its own trashed trigger. */
function discardHand(g: E, seat: Seat, picked: number[]): void {
  for (const i of [...picked].sort((a, z) => z - a)) g.discardFromHand(seat, i);
}

// ───────────────────────────── the cards ──────────────────────────────

// "When I am trashed, [Switch1] You may pay [1] to create a Wraith." — d/1
// 0/1 Alien Anima Unit. R40: the trigger fires FROM THE BIN, however the card
// got there (discarded, milled, sacrificed, died in combat) — so ctx.sourceId
// resolves to nothing and nothing here may read "me" as an entity. The [1] is
// a mid-resolution pay-or-decline (R6). R47: "create a Wraith" spawns the
// Wraith body. Bounded graft ([Switch1]) — ⚠ header: a trash trigger can never
// actually carry a graft rider, but the card is still graftable.
const animaWraith: EffectDef = {
  run: (g, ctx) => {
    if (g.openMana(ctx.controller) < 1) {
      g.ev('info', 'Afflicting Anima: cannot pay [1] — no Wraith.');
      return;
    }
    const pays = ctx.choose('pay', {
      kind: 'payOrDecline', seat: ctx.controller,
      prompt: 'Afflicting Anima: pay [1] to create a Wraith?',
      options: [{ label: 'Pay [1] — create a Wraith', value: true }, { label: 'Decline', value: false }],
    });
    if (pays !== true) return;
    g.payMana(ctx.controller, 1);
    g.createWraith(ctx.controller, g.homeRegion(ctx.controller));   // R52
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
// Units: their net +1/+1 / -1/-1 counters, region-scoped (R12). Players: rot
// and debt, the two player counters (R38/R39), for the seats present in this
// region (R25). ⚠ header: no loseRot/loseDebt primitive exists, so the fields
// are zeroed directly. Rot "never decreases on its own" (R38) — this is a
// card decreasing it, which is exactly what the printed text says to do.
card('Burn the Blight', {
  spellEffect: {
    run: (g, ctx) => {
      for (const u of g.unitsIn(ctx.region)) {
        if (u.counters) g.addCounters(u, -u.counters);
      }
      for (const seat of presentSeats(g, ctx.region)) {
        const rot = g.rot(seat), debt = g.debt(seat);
        if (!rot && !debt) continue;
        g.player(seat).rot = 0;
        g.player(seat).debt = 0;
        g.ev('info',
          `Burn the Blight removes ${g.pname(seat)}'s counters: ${rot} rot, ${debt} debt.`,
          { seat, rot, debt });
      }
    },
  },
});

// "[Augment] At the end of turn, create a Wraith and gain 1 Rot." — dd/1 0/1
// Alien Unit. Text-box [Augment]: live when played normally (Manual Q&A),
// donated when it augments a host — and then it is the HOST's controller who
// gets both the Wraith and the rot. R47 + R38.
card('Cosmic Devourer', {
  augmentText: [{
    type: 'triggered', events: ['endOfTurn'],
    label: 'create a Wraith and gain 1 rot (end of turn)',
    effect: {
      run: (g, ctx) => {
        g.createWraith(ctx.controller, g.homeRegion(ctx.controller));   // R52
        g.gainRot(ctx.controller, 1);
      },
    },
  }],
});

// "[Switch1] Each player sacrifices a unit." — d/1 {Battle} Blight Spell.
// "Each player" is region-scoped (R25): every seat present here with a unit
// here picks one of their own. Plan-then-commit — all picks first, then all
// sacrifices — because the engine replays the part on suspension. A seat with
// exactly one unit has no choice to make. Bounded graft ([Switch1], R9).
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
// at resolution (R1) — dormant resources give no affinity, expended ones
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
      const [name] = g.player(ctx.controller).bin.splice(idx, 1);
      if (name !== undefined) g.spawnUnit(ctx.controller, name, ctx.region);
    },
  },
});

// "[once] Discard X cards: Glimpse 1, X times." — d/2 1/3 Alien Fungus Unit.
// [once] = bounded (R9). X is the cost, so it is chosen card-by-card at
// RESOLUTION (the Discharge pattern): plan every pick first, then commit the
// discards — each of which is a TRASH (R40) that fires its own trigger — and
// finally glimpse (R45) once per discarded card. "Glimpse 1, X times" is
// deliberately X separate glimpses, which is what makes N a count of CARDS.
card('Glook', {
  abilities: [{
    type: 'activated', cost: {}, bounded: true,
    label: 'discard X cards: glimpse 1, X times',
    effect: {
      run: (g, ctx) => {
        const hand = g.player(ctx.controller).hand;
        const picked: number[] = [];
        for (let k = 0; ; k++) {
          const opts: { label: string; value: number; card?: CardName }[] = [
            { label: `done (X = ${picked.length})`, value: -1 },
          ];
          for (let i = 0; i < hand.length; i++) {
            if (!picked.includes(i)) opts.push({ label: hand[i]!, value: i, card: hand[i]! });
          }
          if (opts.length === 1) break;
          const pick = ctx.choose(`glook:${k}`, {
            kind: 'payOrDecline', seat: ctx.controller,
            prompt: `Glook: discard a card to glimpse 1 (X = ${picked.length} so far)`,
            options: opts,
          }) as number;
          if (pick === -1) break;
          picked.push(pick);
        }
        if (!picked.length) { g.ev('info', 'Glook: X = 0 — nothing discarded, nothing glimpsed.'); return; }
        discardHand(g, ctx.controller, picked);
        for (let i = 0; i < picked.length; i++) g.glimpse(ctx.controller, 1);
      },
    },
  }],
});

// "When I spawn, draw a card.{/n}[Augment] When I despawn, discard two
// cards." — d/1 1/2 {Virus} Blight Zombie Unit. The first sentence stays with
// the card; the [Augment] sentence transfers (the downside rides along to the
// host's controller). Despawn = ANY leave-play, 'died' + 'despawned' (the
// Bloated Manablub reading). The two discards are chosen (⚠ header) and are
// TRASHES (R40).
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
        discardHand(g, ctx.controller, picked);
      },
    },
  }],
});

// "Delete target unit with no stat changes." — d/2 {Battle} Blight Spell.
// ⚠ header: TargetSpec has no filter, so the restriction is a RESOLUTION-time
// recheck (Minor Kraken precedent) — a unit that has picked up counters,
// until-regroup changes or somebody's static buff simply survives.
card('Leave None Pure', {
  spellEffect: {
    // R64: "with no stat changes" is a targeting restriction, so only the
    // unmodified units are ever offered; the resolution check stays for the
    // ones that change between cast and resolution.
    targets: {
      what: 'unit', prompt: 'Leave None Pure: delete target unit with no stat changes',
      restrict: unitRestrict((g, u) => {
        const [bp, bt] = baseStats(u);
        const [p, d] = g.effStats(u);
        return u.counters === 0 && u.tempPower === 0 && u.tempToughness === 0 && p === bp && d === bt;
      }),
    },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) return;
      const [bp, bt] = baseStats(t);
      const [p, d] = g.effStats(t);
      if (t.counters !== 0 || t.tempPower !== 0 || t.tempToughness !== 0 || p !== bp || d !== bt) {
        g.ev('info', `Leave None Pure: ${t.card} has stat changes (${p}/${d} vs base ${bp}/${bt}) — it is not deleted.`);
        return;
      }
      g.destroy(t, 'is deleted');
    },
  },
});

// "When I am trashed, [Switch1] Glimpse 2." — d/1 2/1 Bedlam Alien Unit.
// R40 + R45: the trigger fires from the bin, and glimpse 2 reveals the top two
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
        if (self) g.addCounters(self, -2);
      },
    },
  }],
});

// "When I am trashed, negate up to one target nonspell effect." — d/2 3/1
// Alien Anima Unit, with a printed "2 [d] Discard Me. {Battle}" cost line:
// paying it discards the card, which trashes it (R40) and fires this from the
// bin — a battle-timed hard answer to a trigger. The discard-me mode itself
// is entirely engine-side (printed.discardMe + legalActions).
// ⚠ header: "target nonspell effect" has no TargetSpec, so the pick is a
// resolution-time choose over the triggered/activated items on the stack
// ("up to one" = a decline option). Outside battle the stack is empty and the
// trigger is simply a no-op.
card('Nothyr', {
  abilities: [{
    type: 'triggered', events: ['trashed'], self: true,
    label: 'negate up to one target nonspell effect',
    effect: {
      run: (g, ctx) => {
        const hits = g.s.stack.filter(i =>
          (i.kind === 'triggered' || i.kind === 'activated') && !i.negated);
        if (!hits.length) { g.ev('info', 'Nothyr: no nonspell effect on the stack.'); return; }
        const pick = ctx.choose('negate', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Nothyr: negate up to one nonspell effect',
          options: [
            ...hits.map(i => ({ label: i.label, value: i.id, ...(i.card ? { card: i.card } : {}) })),
            { label: 'Decline', value: -1 },
          ],
        }) as number;
        if (pick === -1) return;
        g.negate(pick);
      },
    },
  }],
});

// "When I attack or block, [Switch1] Put a -1/-1 counter on each unit. Each
// player gains a rot." — d/4 3/4 Blight Zombie Unit. Both halves are
// region-scoped (R12/R25): every unit in this region, every seat present in
// it — the Titan and its own controller included. R38: gaining rot is not
// damage; it bites at the start of the next deployment. Bounded graft
// ([Switch1], R9).
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
        if (!bin.length) return;
        const moved = bin.splice(0, bin.length);
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
// "When I enter your bin" is R40's trashed trigger: a UNIT can only reach a
// bin from play, hand, deck or cache, every one of which trashes, so the two
// readings coincide here. Plan-then-commit (R6): the payment decision and
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
        if (pays !== true) return;
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
// graft ([Switch1], R9).
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
// into play." — d/3 0/1 Blight Unit. Dying binned it (and trashed it, R40)
// one event earlier, so "erase me" is: take that copy back out of the bin and
// destroy it — erasing never touches a bin again (R40), so this is NOT a
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
        if (yes !== true) return;
        // highest index first so the earlier indices stay valid
        const idxs = [mine, ...revivable.map(([, i]) => i)].sort((a, z) => z - a);
        const names: CardName[] = [];
        for (const i of idxs) {
          const [name] = bin.splice(i, 1);
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
// R64: "two TARGET units in your bin" is real targeting — two cast-time
// targets, and BinRef.nth means two copies of one card are two separate
// targets. min 0: the spell is castable with an empty bin, because "then
// discard a card" still happens (R5 fizzling would swallow the whole spell,
// and the printed text makes the discard unconditional).
card('Tilling the Graves', {
  spellEffect: {
    targets: {
      what: 'binCard', count: 2, min: 0,
      prompt: 'Tilling the Graves: recall two target units in your bin',
      restrict: (_g, t) => 'binCard' in t && isUnitCard(t.binCard.card),
    },
    run: (g, ctx) => {
      const seat = ctx.controller;
      const bin = g.player(seat).bin;
      // resolve every ref to a live index FIRST, then splice from the back —
      // an index read before an earlier splice would be stale
      const chosen = ctx.targets
        .filter((t): t is { binCard: { seat: Seat; index: number; card: CardName } } => 'binCard' in t)
        .map(t => t.binCard.index)
        .filter(i => i !== -1);
      const taken: CardName[] = [];
      for (const i of [...new Set(chosen)].sort((a, z) => z - a)) {
        const [name] = bin.splice(i, 1);
        if (name !== undefined) taken.push(name);
      }
      for (const name of taken.reverse()) {
        g.player(seat).hand.push(name);
        g.ev('info', `Tilling the Graves: ${name} returns to ${g.pname(seat)}'s hand.`);
      }
      // "then discard a card" — the recalled units are legal discards
      const picked = planDiscards(g, ctx, 'till', seat, 1, 'Tilling the Graves: discard a card');
      discardHand(g, seat, picked);
    },
  },
});

// "Play up to two units in any bin with total cost [8] or less now, for
// free." — ddd/8 {Battle} Occult Spell. ANY bin: both players'. "Up to two"
// with a running budget — the second pick is offered only from what still
// fits under 8 minus the first. ⚠ header: "play … now, for free" is modelled
// as putting the units straight into play (spawn triggers fire, no stack
// step), and spawnUnit has no owner parameter, so a unit taken out of the
// opponent's bin becomes the caster's card outright.
card('Wake the Dead', {
  spellEffect: {
    run: (g, ctx) => {
      const seat = ctx.controller;
      type Pick = { seat: Seat; idx: number; name: CardName };
      const chosen: Pick[] = [];
      let budget = 8;
      for (let k = 0; k < 2; k++) {
        const opts: { label: string; value: string; card: CardName }[] = [];
        for (const p of g.s.players) {
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
      for (const c of [...chosen].sort((a, z) => z.idx - a.idx)) g.player(c.seat).bin.splice(c.idx, 1);
      for (const c of chosen) g.spawnUnit(seat, c.name, ctx.region);
    },
  },
});
