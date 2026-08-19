/* batch-hybrids-wm-a — wood/metal-involved dual-element (hybrid) batch,
 * scripted over the printed data in printed.json (never hand-copied).
 * Printed text quoted in comments for review.
 *
 * Owned by one card-scripting agent; see sets/index.ts for ordering rules.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (fizzle vs partial), R6 (mid-resolution payments/choices via ctx.choose),
 * R9 (bounded [Switch1]/[once] budgets per card), R12/R25 ("each player/
 * opponent" and "your units" read the region's present seats / unitsOf(region)),
 * R28 (created UNITS spawn in their controller's HOME region; spell tokens
 * appear where the effect resolves), R31 (damage-sub-step triggers resolve
 * immediately).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - SPELL COPY (Earthbound Replicator, Maelstrom Charger): no copy machinery
 *    exists, so a "copy" re-runs the copied card's spellEffect in place —
 *    it never touches the stack (no responses to the copy), "may choose new
 *    targets" is NOT supported (the copy reuses the original cast's
 *    still-legal targets / the carrier), and a copy only happens while the
 *    original item is still ON the stack (found by id / by the Origon
 *    bottom-most-match pattern) — a deploy-phase spell that already resolved
 *    is not copyable (info line instead).
 *  - Earthbound Replicator: written when spell-cast 'targeted' events were
 *    logged but never dispatched, so the trigger listens to 'spellPlayed'
 *    instead. Playtest 2026-08-19 FIXED that dispatch (R53) — this card could
 *    now listen to 'targeted' directly, which would be exact rather than
 *    approximate. Left as-is for now: the current path is correct, just
 *    roundabout. The event carries no targets, so it queues
 *    on EVERY nonunit spell in the region and checks "targeting me" at
 *    resolution against the item's collected targets on the stack (no-op
 *    info line when it doesn't target me). "Nonunit" = kind spell/spellToken
 *    (spellUnits and ambushes excluded).
 *  - Ember of Life: FIXED (playtest 2026-08-18) — 'damage' events now carry
 *    the effect's controller and spell-effect damage to PLAYERS emits a
 *    damage event too (engine dealEffectDamage), so "one of YOUR spell
 *    effects deals damage" is exact: my spells only, face hits included.
 *    Combat damage never counts (its event has no source). The 1/1s spawn
 *    in the CARRIER's region (R33, refining R28).
 *  - Scrapyard Custodian: 'countersChanged' carries no actor, so "when YOU
 *    put counters on an ally" is read as "counters (either sign) were put on
 *    a unit you control, by anyone". Robots spawning with counters do NOT
 *    fire it (spawn counters are on before the spawn event — engine note).
 *  - Soulforger: the died event has no token flag and the entity is erased
 *    before it fires, so "nontoken" is read off the rendered death message
 *    (destroy() writes "token: erased." exactly for tokens).
 *  - Malevolent Machinations: the "/[Sacrifice X units]" cost and the "up to
 *    X target effects" are mid-resolution chooses (the Immolate/Tidal
 *    Reversion approximations): opponents respond to the spell, not to the
 *    picks; "effects" = un-negated items on the stack at resolution (any
 *    kind, triggered abilities included).
 *  - Hearthwood Ancient: "Sacrifice another unit:" is an activation cost
 *    paid at resolution (the Slag Spewer precedent); with no other unit the
 *    ability resolves without effect.
 *  - Reconfigure: the moved unit leaves play SILENTLY (no died/despawned
 *    event — it is moved, not removed); its mod entities move along with
 *    budgets intact; "the first target must have [Augment]" is checked at
 *    resolution (no [Augment] → info, no effect).
 *  - "your units" amounts (Colossal Construction's greatest defense) and
 *    "each player/opponent" are region-scoped at resolution (R12/R25/R27).
 *
 * PARKED (needs engine machinery that does not exist yet):
 *  - Rook: "You may augment cards from hand and bin during battle as if they
 *    were [Virus]" is a continuous PLAY-PERMISSION modifier over doAugment's
 *    legality rules — no such layer exists (sibling of the missing cost-
 *    modification layer). Inert augmentText (Stasis Sentry precedent); it
 *    plays as a 4/4 and is recognised as an augment.
 *  - The Silent: "Spells cost each player [two] more … per spell their team
 *    played this battle" is a continuous COST modifier; canPayCard/payCard
 *    read printed mana only (the Stasis Sentry precedent). Inert augmentText.
 */
import type { CardName, Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import {
  card, getCard, isAugment,
  type EffectCtx, type EffectDef, type ResolvedTarget,
} from '../dsl.ts';

// ─────────────────────────── shared helpers ───────────────────────────

const isEnt = (t: unknown): t is Entity => !!t && typeof t === 'object' && 'id' in t;

/** True while endTurn() is resolving end-of-turn triggers (batch-fire-a
 * precedent): a ctx.choose suspension in that window strands the game, so
 * "may" effects auto-decline / choices auto-pick there. */
const inEndOfTurn = (g: E): boolean => g.s.phase === 'deploy' && g.s.deployPlayer === null;

/** pick one of `pool` (auto when forced); returns null on an empty pool.
 * Plan-then-commit: callers gather every pick before mutating (the engine
 * rolls back to the part boundary and replays on suspension). */
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

/** the stack-item kinds that count as a "nonunit spell" (plain "spell"
 * includes spell tokens — the batch-hybrids-fwe wording precedent; spellUnit
 * and ambush are unit plays and excluded) */
const NONUNIT_SPELL_KINDS = new Set(['spell', 'spellToken']);

/** ⚠ SPELL COPY approximation (see the batch header): run the copied card's
 * spellEffect in place — off the stack, with the given targets, under the
 * copying player. Nested chooses are namespaced so they can't collide with
 * the caller's own keys. */
function runSpellCopy(
  g: E, ctx: EffectCtx, cardName: CardName, controller: Seat,
  x: number | undefined, targets: ResolvedTarget[],
  costPaid?: EffectCtx['costPaid'],
): void {
  const def = getCard(cardName).spellEffect;
  if (!def) { g.ev('info', `${ctx.sourceName}: ${cardName} has no spell effect to copy.`); return; }
  if (def.targets && !targets.length) {
    g.ev('info', `${ctx.sourceName}: the copy of ${cardName} has no target — no effect.`);
    return;
  }
  g.ev('info', `${ctx.sourceName}: ${g.pname(controller)} copies ${cardName}.`);
  def.run(g, {
    controller, sourceName: cardName, sourceId: undefined, region: ctx.region,
    // a COPY is not cast: its cast cost is not paid again — it inherits the
    // original's payment receipt (R35), like it inherits the original's X
    targets, x, costPaid, event: null,
    choose: (key, dec) => ctx.choose(`copy:${key}`, dec),
  });
}

// ─────────────────────── EARTH / METAL (em/me) ────────────────────────

// "[Switch1] Create a Robot X, where X is the greatest defense among your
// units." — em/3 2/4 Primordial Technology Spell. X is live at resolution
// (R27): the greatest effStats defense among the controller's units in the
// resolving region (R12). Robot X = the 0/0 Robot token with X +1/+1
// counters (the water-metal batch precedent); a created UNIT spawns in its
// controller's HOME region (R28). No unit → X = 0 → no Robot.
const buildRobot: EffectDef = {
  run: (g, ctx) => {
    const x = g.unitsOf(ctx.controller, ctx.region)
      .reduce((m, u) => Math.max(m, g.effStats(u)[1]), 0);
    if (x <= 0) { g.ev('info', 'Colossal Construction: no unit to measure — no Robot.'); return; }
    g.spawnUnit(ctx.controller, 'Robot', g.homeRegion(ctx.controller), { token: true, counters: x });
  },
};
card('Colossal Construction', {
  spellEffect: buildRobot,
  graftEffect: { bounded: true, effect: buildRobot },
  // UI preview (#5): the Robot's size if it resolved right now
  xPreview: (g, seat, region) =>
    g.unitsOf(seat, region).reduce((m, u) => Math.max(m, g.effStats(u)[1]), 0),
});

// "Augment target unit and all of its mods onto another target unit. (The
// first target must have [Augment] to be able to be augmented.)" — em/4 1/2
// {Battle} Primordial Technology Spell. Two targets collected at cast (the
// multi-target TargetSpec, which picks them distinct): the FIRST pick moves
// onto the SECOND. "Another" is re-checked at RESOLUTION (Minor Kraken
// precedent) — distinctness at cast is NOT an invariant, because Enigmatic
// Warder ("change a target of target effect to me") can redirect a target
// afterwards and can do it twice, collapsing both onto one unit. Resolving
// that augmented the unit onto ITSELF: the entity was deleted and then made a
// mod pointing at its own dead id, an orphan the fuzz caught at seed 1132.
// At resolution the first target must be an [Augment] card
// (else info, no effect); it leaves play silently (⚠ header — moved, not
// despawned), becomes an augment mod on the host via attachMod (modApplied
// fires), and its existing mod entities move along, budgets intact.
card('Reconfigure', {
  spellEffect: {
    targets: {
      what: 'unit', count: 2, min: 2,
      prompt: 'Reconfigure: first pick the unit to move, then the unit to augment it onto',
    },
    run: (g, ctx) => {
      if (ctx.targets.length < 2) { g.ev('info', 'Reconfigure: a target is gone — no effect.'); return; }
      const [a, b] = [ctx.targets[0], ctx.targets[1]];
      if (!isEnt(a) || !isEnt(b)) return;
      // "onto ANOTHER target unit" — a redirect can have collapsed the two
      // onto one unit since the cast, and augmenting a unit onto itself would
      // delete the entity and leave its own mod orphaned.
      if (a.id === b.id) {
        g.ev('info', `Reconfigure: both targets are ${a.card} — it cannot augment onto itself, no effect.`);
        return;
      }
      if (!isAugment(a.card)) {
        g.ev('info', `Reconfigure: ${a.card} has no [Augment] — no effect.`);
        return;
      }
      const movedMods = a.mods.map(id => g.entity(id)).filter((m): m is Entity => !!m);
      // the moved unit leaves play WITHOUT dying/despawning (⚠ header)
      delete g.s.entities[a.id];
      // formation cleanup (mirror of the engine's private removeFromFormation)
      const bt = g.s.battle;
      if (bt) {
        for (const col of [...bt.columns, ...Object.values(bt.blocks)]) {
          const i = col.indexOf(a.id);
          if (i !== -1) col.splice(i, 1);
        }
        const si = bt.sentAttackers.indexOf(a.id);
        if (si !== -1) bt.sentAttackers.splice(si, 1);
      }
      g.attachMod(b, a.card, a.owner, 'augment');
      for (const m of movedMods) {
        m.modOf = b.id;
        m.region = b.region;
        m.controller = b.controller;
        b.mods.push(m.id);
      }
      if (movedMods.length) g.ev('info', `Reconfigure: ${movedMods.length} mod(s) move along with ${a.card}.`);
    },
  },
});

// "[Augment] You may augment cards from hand and bin during battle as if
// they were [Virus]." — me/4 4/4 Polyform Crab Unit.
// PARKED (see header): a continuous play-permission layer does not exist.
// The inert augmentText entry keeps the card recognised as an augment
// (Stasis Sentry precedent); it plays as a vanilla 4/4 meanwhile.
card('Rook', {
  augmentText: [{
    type: 'triggered', events: [],   // PARKED — never fires
    label: 'augment from hand and bin during battle as if [Virus] (not implemented)',
    effect: { run: () => { /* PARKED */ } },
  }],
});

// "When you put one or more counters on an ally, [Switch1] Draw a card." —
// me/3 3/3 Robot Druid Unit. 'countersChanged' trigger; the event carries no
// actor (⚠ header: counters put on your ally by anyone count as "you put"),
// either sign counts ("counters"), the amount doesn't matter ("one or
// more"). Bounded graft cause + bounded graft ([Switch1], R9). Region-scoped
// automatically (fireEvent reads the counted unit's region).
const custodianDraw: EffectDef = { run: (g, ctx) => g.draw(ctx.controller, 1) };
card('Scrapyard Custodian', {
  abilities: [{
    type: 'triggered', events: ['countersChanged'], bounded: true, graftCause: true,
    label: 'draw a card (counters were put on an ally)',
    when: (g, self, ev) => {
      const uid = ev.data?.unit as EntityId | undefined;
      const u = uid !== undefined ? g.entity(uid) : undefined;
      return !!u && u.controller === self.controller;
    },
    effect: custodianDraw,
  }],
  graftEffect: { bounded: true, effect: custodianDraw },
});

// "[Augment] Spells cost each player [two] more to play for each spell their
// team has previously played in this battle." — em/3 3/4 Cosmic Arcane Unit.
// PARKED (see header): a continuous cost-modification layer does not exist
// (the Stasis Sentry precedent). Inert augmentText; plays as a vanilla 3/4.
card('The Silent', {
  augmentText: [{
    type: 'triggered', events: [],   // PARKED — never fires
    label: 'spells cost [two] more per spell previously played this battle (not implemented)',
    effect: { run: () => { /* PARKED */ } },
  }],
});

// ─────────────────────── EARTH / WOOD (eg/ge) ─────────────────────────

// "[Augment] Whenever another nontoken ally spawns, create a Crystal 1." —
// eg/2 2/3 Plant Primordial Unit. Text-box [Augment], live when played
// normally. 'spawned' fires with the entity already in play, so token-ness
// and controller are read live at event time (R1). "Another" excludes the
// carrier itself (when donated: the host). Spell tokens appear where the
// effect resolves (R28).
card('Aether Channeler', {
  augmentText: [{
    type: 'triggered', events: ['spawned'],
    label: 'create a Crystal 1 (another nontoken ally spawned)',
    when: (g, self, ev) => {
      const uid = ev.data?.unit as EntityId | undefined;
      const u = uid !== undefined ? g.entity(uid) : undefined;
      return !!u && u.id !== self.id && u.controller === self.controller && !u.token;
    },
    effect: { run: (g, ctx) => { g.createSpellToken(ctx.controller, 'Crystal', 1, ctx.region); } },
  }],
});

// "[Switch1] Create a Crystal 1 and a Poison 1." — eg/1 0/7 Arcane Blight
// Crystal Spell. Both spell tokens appear where the effect resolves (R28).
// Bounded graft ([Switch1], R9).
const alchemyTokens: EffectDef = {
  run: (g, ctx) => {
    g.createSpellToken(ctx.controller, 'Crystal', 1, ctx.region);
    g.createSpellToken(ctx.controller, 'Poison', 1, ctx.region);
  },
};
card('Corroded Alchemy', {
  spellEffect: alchemyTokens,
  graftEffect: { bounded: true, effect: alchemyTokens },
});

// "[Augment] Whenever I am dealt damage, put that many -1/-1 counters on
// target unit." — eg/4 0/7 {Haste} Primordial Blight Unit. Text-box
// [Augment]. Fires on the 'damage' event (self; combat damage included);
// "that many" is the event snapshot's amount (R1 — the event IS the amount's
// definition, the Mirrorback Ambusher precedent). Targeted trigger.
card('Decay Distributor', {
  augmentText: [{
    type: 'triggered', events: ['damage'], self: true,
    label: 'put that many -1/-1 counters on target unit',
    effect: {
      targets: { what: 'unit', prompt: 'Decay Distributor: put that many -1/-1 counters on target unit' },
      run: (g, ctx) => {
        const n = (ctx.event?.data?.n as number | undefined) ?? 0;
        const t = ctx.targets[0];
        if (isEnt(t) && n > 0) g.addCounters(t, -n);
      },
    },
  }],
});

// "[Augment] Whenever a player plays a nonunit spell targeting me, they copy
// it and may choose new targets for the copy." — ge/2 1/3 Primordial
// Elemental Unit. Text-box [Augment]. ⚠ SPELL COPY approximation (header):
// a 'spellPlayed' trigger (the cast-time targeted events never reach
// listeners); "targeting me" is checked at RESOLUTION against the un-negated
// item's collected targets on the stack (the Origon bottom-most-match
// pattern — my trigger sits above the spell, so the copy resolves first).
// The copy re-runs the spellEffect against the carrier itself ("new
// targets" unsupported), controlled by the spell's player ("THEY copy it").
card('Earthbound Replicator', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'],
    label: 'the player copies their nonunit spell targeting me',
    when: (g, self, ev) => {
      const name = ev.data?.card;
      if (typeof name !== 'string') return false;
      try { return NONUNIT_SPELL_KINDS.has(getCard(name).kind); } catch { return false; }
    },
    effect: {
      run: (g, ctx) => {
        const name = ctx.event?.data?.card as CardName | undefined;
        const seat = ctx.event?.data?.seat as Seat | undefined;
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (name === undefined || seat === undefined || !self) return;
        const it = g.s.stack.find(i =>
          i.card === name && i.controller === seat && !i.negated && NONUNIT_SPELL_KINDS.has(i.kind));
        const targetsMe = !!it &&
          it.parts.some(p => p.targets.some(t => 'unit' in t && t.unit === self.id));
        if (!it || !targetsMe) {
          g.ev('info', `Earthbound Replicator: ${name} does not target me (or already left the stack) — no copy.`);
          return;
        }
        runSpellCopy(g, ctx, name, seat, it.x, [self], it.parts[0]?.costPaid);
      },
    },
  }],
});

// "After combat, [Switch1] Create a [Poison or Crystal] 2." — eg/3 2/3 Plant
// Crystal Unit. afterCombat trigger (no source unit — the Unfinished
// Creation precedent; region-scoped by the event). The either-or is a
// mid-resolution choice (R6; auto Crystal during end-of-turn resolution —
// no suspensions there). Spell token appears where the effect resolves.
// Bounded cause + bounded graft ([Switch1], R9).
const conjureTwo: EffectDef = {
  run: (g, ctx) => {
    const kind = inEndOfTurn(g) ? 'Crystal' : ctx.choose('tok', {
      kind: 'electricPath', seat: ctx.controller,
      prompt: 'Spirit of Nature: create a Poison 2 or a Crystal 2?',
      options: [
        { label: 'Poison 2', value: 'Poison' },
        { label: 'Crystal 2', value: 'Crystal' },
      ],
    }) as string;
    g.createSpellToken(ctx.controller, kind === 'Poison' ? 'Poison' : 'Crystal', 2, ctx.region);
  },
};
card('Spirit of Nature', {
  abilities: [{
    type: 'triggered', events: ['afterCombat'], bounded: true, graftCause: true,
    label: 'create a Poison 2 or a Crystal 2 (after combat)',
    effect: conjureTwo,
  }],
  graftEffect: { bounded: true, effect: conjureTwo },
});

// ─────────────────────── FIRE / METAL (rm/mmr/rrm) ────────────────────

// "As you play a nonunit spell, you may sacrifice me. If you do, copy that
// spell and you may choose new targets for the copy." — rm/3 4/2 Elemental
// Maelstrom Unit. ⚠ SPELL COPY approximation (header): a 'spellPlayed'
// trigger (your spell, kind spell/spellToken); at resolution the original is
// found on the stack (the Origon bottom-most-match pattern) — my trigger
// sits above it, so the copy resolves first. The sacrifice is a
// mid-resolution pay-or-decline (R6, auto-declined during end-of-turn); the
// copy reuses the original cast's still-legal targets ("new targets"
// unsupported).
card('Maelstrom Charger', {
  abilities: [{
    type: 'triggered', events: ['spellPlayed'],
    label: 'you may sacrifice me to copy your nonunit spell',
    when: (g, self, ev) => {
      if (ev.data?.seat !== self.controller) return false;
      const name = ev.data?.card;
      if (typeof name !== 'string') return false;
      try { return NONUNIT_SPELL_KINDS.has(getCard(name).kind); } catch { return false; }
    },
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!self || inEndOfTurn(g)) return;
        const name = ctx.event?.data?.card as CardName | undefined;
        const seat = ctx.event?.data?.seat as Seat | undefined;
        if (name === undefined || seat === undefined) return;
        const it = g.s.stack.find(i =>
          i.card === name && i.controller === seat && !i.negated && NONUNIT_SPELL_KINDS.has(i.kind));
        if (!it) { g.ev('info', `Maelstrom Charger: ${name} already left the stack — no copy.`); return; }
        const pay = ctx.choose('sac', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Maelstrom Charger: sacrifice me to copy ${name}?`,
          options: [
            { label: `Sacrifice — copy ${name}`, value: true },
            { label: 'Decline', value: false },
          ],
        });
        if (!pay) return;
        // the original cast's still-legal targets (⚠ header: no new targets)
        const targets: ResolvedTarget[] = [];
        for (const part of it.parts) {
          for (const t of part.targets) {
            const r = g.resolveTargetRef(t);
            if (r) targets.push(r);
          }
        }
        g.destroy(self, 'is sacrificed');
        runSpellCopy(g, ctx, name, seat, it.x, targets, it.parts[0]?.costPaid);
      },
    },
  }],
});

// "/[Sacrifice X units]: Negate up to X target effects." — rrm/2 5/3
// {Battle} Occult Technology Spell. ⚠ header: the bracketed cost and the
// negation picks are mid-resolution chooses, plan-then-commit — the caster
// sacrifices any number of their units (X), then picks up to X un-negated
// stack items to negate; everything commits after all picks.
card('Malevolent Machinations', {
  spellEffect: {
    run: (g, ctx) => {
      // plan the cost: sacrifice any number of my units (X)
      const sacs: EntityId[] = [];
      for (;;) {
        const pool = g.unitsOf(ctx.controller, ctx.region).filter(u => !sacs.includes(u.id));
        if (!pool.length) break;
        const v = ctx.choose(`sac:${sacs.length}`, {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Malevolent Machinations: sacrifice units (X = ${sacs.length} so far)`,
          options: [
            ...pool.map(u => ({ label: u.card, value: u.id as unknown })),
            { label: 'Done', value: false },
          ],
        });
        if (v === false) break;
        sacs.push(v as EntityId);
      }
      const x = sacs.length;
      // plan the negations: up to X un-negated stack effects
      const negs: number[] = [];
      for (let k = 0; k < x; k++) {
        const pool = g.s.stack.filter(i => !i.negated && !negs.includes(i.id));
        if (!pool.length) break;
        const v = ctx.choose(`neg:${k}`, {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Malevolent Machinations: negate an effect (${k + 1} of up to ${x})`,
          options: [
            ...pool.map(i => ({ label: i.label, value: i.id as unknown })),
            { label: 'Done', value: false },
          ],
        });
        if (v === false) break;
        negs.push(v as number);
      }
      // commit
      for (const id of sacs) {
        const u = g.entity(id);
        if (u) g.destroy(u, 'is sacrificed');
      }
      for (const id of negs) g.negate(id);
      if (!x) g.ev('info', 'Malevolent Machinations: X = 0 — nothing negated.');
    },
  },
});

// "[Augment] Whenever one of your units dies, each opponent sacrifices a
// unit." — mmr/5 5/6 Robot Insect Horror Unit. Text-box [Augment]. "One of
// your units" = same controller (tokens count, the carrier itself counts —
// a dying unit sees its own death). "Each opponent" is region-scoped (R25);
// each picks their own unit, plan-then-commit.
card('Malicious Hardware', {
  augmentText: [{
    type: 'triggered', events: ['died'],
    label: 'each opponent sacrifices a unit (one of your units died)',
    when: (g, self, ev) => ev.data?.seat === self.controller,
    effect: {
      run: (g, ctx) => {
        const picks: EntityId[] = [];
        for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
          if (seat === ctx.controller) continue;
          const pool = g.unitsOf(seat as Seat, ctx.region).filter(u => !picks.includes(u.id));
          const id = pickUnit(ctx, `sac:${seat}`, seat as Seat, pool,
            'Malicious Hardware: sacrifice a unit');
          if (id !== null) picks.push(id);
        }
        for (const id of picks) {
          const u = g.entity(id);
          if (u) g.destroy(u, 'is sacrificed');
        }
      },
    },
  }],
});

// "Each player sacrifices two units. If four or more units were sacrificed
// this way, repeat this." — rm/4 5/3 {Battle} Bedlam Maelstrom Spell.
// "Each player" = the region's present seats (R25); each picks two of their
// units (as many as able). Per round: all picks are planned, then committed;
// 4+ actual sacrifices repeat the round (fresh pools — replay after a
// suspension is deterministic given the stored answers, so the round-wise
// interleaving of chooses and commits is sound).
card('Maw of Damnation', {
  spellEffect: {
    run: (g, ctx) => {
      for (let round = 0; round < 20; round++) {
        const picks: EntityId[] = [];
        for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
          for (let k = 0; k < 2; k++) {
            const pool = g.unitsOf(seat as Seat, ctx.region).filter(u => !picks.includes(u.id));
            const id = pickUnit(ctx, `sac:${round}:${seat}:${k}`, seat as Seat, pool,
              `Maw of Damnation: sacrifice two units (pick ${k + 1} of 2)`);
            if (id === null) break;
            picks.push(id);
          }
        }
        for (const id of picks) {
          const u = g.entity(id);
          if (u) g.destroy(u, 'is sacrificed');
        }
        if (picks.length < 4) break;
        g.ev('info', 'Maw of Damnation: four or more units were sacrificed — it repeats.');
      }
    },
  },
});

// "[Augment] Whenever one of your nontoken units dies, create a Fireball 1."
// — rrm/2 2/2 Demon Robot Unit. Text-box [Augment]. Nontoken-ness is read
// off the death message (⚠ header — the entity is erased before the event
// fires and the event has no token flag). Spell token at the resolving
// region (R28).
card('Soulforger', {
  augmentText: [{
    type: 'triggered', events: ['died'],
    label: 'create a Fireball 1 (one of your nontoken units died)',
    when: (g, self, ev) =>
      ev.data?.seat === self.controller && !ev.msg.includes('token: erased'),
    effect: { run: (g, ctx) => { g.createSpellToken(ctx.controller, 'Fireball', 1, ctx.region); } },
  }],
});

// ─────────────────────── FIRE / WOOD (rg) ─────────────────────────────

// "[Augment][once] When one of your spell effects deals damage, create that
// many 1/1 units." — rg/4 2/2 Plant Elemental Unit. Text-box [Augment].
// Damage events now carry the effect's CONTROLLER (dealEffectDamage), so
// "one of YOUR spell effects" = the event's controller is my controller —
// an opponent's spell never fires me. Spell-effect damage to a PLAYER also
// emits a damage event (face hits count; "deals damage" is unqualified);
// combat damage never counts (no source on the event). "That many" = the
// event's amount (one event per damaged victim; [once] takes the first).
// Created UNITS spawn in the CARRIER's region (R33, refining R28).
card('Ember of Life', {
  augmentText: [{
    type: 'triggered', events: ['damage'], bounded: true,   // [once]
    label: 'create that many 1/1 units (one of your spell effects dealt damage)',
    when: (g, self, ev) => {
      if (ev.data?.controller !== self.controller) return false;   // "one of YOUR spell effects"
      const src = ev.data?.source;
      if (typeof src !== 'string') return false;   // combat damage has no source
      try {
        const k = getCard(src).kind;
        return k === 'spell' || k === 'spellUnit' || k === 'spellToken';
      } catch { return false; }
    },
    effect: {
      run: (g, ctx) => {
        const n = (ctx.event?.data?.n as number | undefined) ?? 0;
        for (let i = 0; i < n; i++) {
          g.spawnUnit(ctx.controller, 'Unit Token', ctx.region,
            { token: true, tokenStats: [1, 1] });
        }
      },
    },
  }],
});

// "[Augment] Sacrifice another unit: Your units gain +1/+1 until regroup."
// — rg/4 0/4 Ancient Tree Structure Unit. An ACTIVATED ability in the
// [Augment] text box (the Slag Spewer precedent): live when played normally
// (via: 'augment') and donated to hosts (via: { mod }). The sacrifice is
// paid at resolution (⚠ header); "another" excludes the activating unit
// (the carrier / the host when donated). The buff lands after the sacrifice
// (the sacrificed unit never benefits), on the controller's units in the
// region, until regroup (addTemp).
card('Hearthwood Ancient', {
  augmentText: [{
    type: 'activated', cost: {},
    label: 'sacrifice another unit: your units gain +1/+1 until regroup',
    effect: {
      run: (g, ctx) => {
        const pool = g.unitsOf(ctx.controller, ctx.region).filter(u => u.id !== ctx.sourceId);
        if (!pool.length) {
          g.ev('info', 'Hearthwood Ancient: no other unit to sacrifice — no effect.');
          return;
        }
        const id = pickUnit(ctx, 'sac', ctx.controller, pool,
          'Hearthwood Ancient: sacrifice another unit')!;
        const sac = g.entity(id);
        if (!sac) return;
        g.destroy(sac, 'is sacrificed');
        for (const u of g.unitsOf(ctx.controller, ctx.region)) g.addTemp(u, 1, 1);
      },
    },
  }],
});
