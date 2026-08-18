/* batch-earth-a — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Earth cards scripted over the printed data in printed.json
 * (never hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (fight effects need both units — a gone target fizzles the part),
 * R6 (mid-resolution payments/choices via ctx.choose), R9 (bounded budgets
 * per card), R12/R25 ("each player/opponent" reads the event region's
 * present seats; listeners are region-scoped).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - TWO-TARGET EFFECTS (Battle / Fight): cast-time targeting holds ONE
 *    target per part, so the FIRST unit is a real stack target and the
 *    SECOND is a mid-resolution ctx.choose pick by the caster (the Tidal
 *    Reversion precedent — opponents respond to the spell, not the pick).
 *  - FIGHT: modelled as simultaneous effect damage — powers are snapshotted,
 *    then each unit's damage is dealt via dealEffectDamage with THAT unit's
 *    card as the source (so Deadly/Poisonous/etc. on a fighter applies).
 *  - Aetherflux Golem's permanent "+2/+2" is modelled as two +1/+1 counters
 *    (the engine's only permanent stat layer). Deviation: counter-matters
 *    effects see them; two Golems augmenting one host would double-fire the
 *    identical trigger defs (one pool copy each — unreachable in play).
 *
 * PARKED (needs engine machinery that does not exist yet):
 *  - Crevice Lurker: "[Augment] Abilities cost [one] more to activate or
 *    trigger during battle" is an ABILITY-COST TAXATION / pay-to-trigger
 *    hook — doActivateAbility has no cost-modification layer and triggers
 *    have no payment gate. Inert augmentText entry (Astralith precedent)
 *    keeps it recognised as an augment.
 *  - Hooba-Lan: "create a Shard (spawns dormant)" needs a 'Shard'
 *    ResourceKind / resource-creation primitive (the same gap the Fire/Water
 *    Resource cards parked against). The attack/block trigger is wired and
 *    fires an info event; no Shard is created.
 *  - Earth Resource: the resource-card model is missing (resources are
 *    anonymous ResourceState entries; no activation triggers, no Shard
 *    kind). Registered printed-data-only; registry.ts deliberately excludes
 *    it from DECK_LIST (it is a resource face, not a deck card).
 */
import type { Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, type EffectCtx, type EffectDef } from '../dsl.ts';

// ─────────────────────────── shared helpers ───────────────────────────

const isEnt = (t: unknown): t is Entity =>
  !!t && typeof t === 'object' && 'id' in (t as object);

/** present seats of a region, initiative player first (stable order) */
const presentSeats = (g: E, region: number): Seat[] => {
  const present = g.s.regions[region]!.presentSeats;
  return [g.initiative, g.nit].filter(s => present.includes(s));
};

/** True while endTurn() is resolving end-of-turn triggers — a ctx.choose
 * suspension there strands the game (see batch-fire-a), so choose-based
 * effects reachable then must auto-pick deterministically instead. */
const inEndOfTurn = (g: E): boolean => g.s.phase === 'deploy' && g.s.deployPlayer === null;

/** `chooser` picks one of `candidates` (auto-picked when only one). Returns
 * null when there is nothing to pick. Plan-then-commit: call all chooses
 * before mutating (the engine replays the part on suspension). */
const chooseUnit = (
  g: E, ctx: EffectCtx, key: string, chooser: Seat, candidates: Entity[], prompt: string,
): Entity | null => {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0]!;
  const id = ctx.choose(key, {
    kind: 'electricPath', seat: chooser, prompt,
    options: candidates.map(u => ({ label: u.card, value: u.id })),
  }) as EntityId;
  return g.entity(id) ?? null;
};

/** Two units fight: they deal damage to each other equal to their power,
 * simultaneously — powers snapshotted first, then both hits are dealt via
 * dealEffectDamage with the FIGHTER's card as the source (⚠ header note:
 * fighter attrs like Deadly apply; Reaping/Resonant riders credit the
 * effect's controller). */
const fight = (g: E, ctx: EffectCtx, a: Entity, b: Entity): void => {
  const [pa] = g.effStats(a);
  const [pb] = g.effStats(b);
  g.ev('info', `${a.card} fights ${b.card}.`);
  if (pb > 0) g.dealEffectDamage({ ...ctx, sourceName: b.card }, a, pb);
  if (pa > 0) g.dealEffectDamage({ ...ctx, sourceName: a.card }, b, pa);
};

// ────────────────────────────── the cards ──────────────────────────────

// "When I die, [Switch] Rockfall 4. (Each player chooses one of their units.
// I deal 4 damage to each of the chosen units.)" — e/2 2/1 {Haste} Rock Pile
// Unit. Died trigger (self); unbounded graft ([Switch]). "Each player" =
// the event region's present seats (R12/R25) — dying during deployment, only
// my controller is present. Each player picks their OWN unit (auto when they
// have one; deterministic auto-pick during end-of-turn resolution); all picks
// are gathered before any damage (plan-then-commit), then I deal 4 to each.
const rockfall4: EffectDef = {
  run: (g, ctx) => {
    const picks: Entity[] = [];
    for (const seat of presentSeats(g, ctx.region)) {
      const units = g.unitsOf(seat, ctx.region);
      if (!units.length) continue;
      if (inEndOfTurn(g)) {   // no suspensions in the end-of-turn tail
        g.ev('info', `Rockfall: ${units[0]!.card} is auto-picked (end-of-turn resolution).`);
        picks.push(units[0]!);
        continue;
      }
      const u = chooseUnit(g, ctx, `rf:${seat}`, seat, units,
        'Rockfall 4: choose one of your units (it will be dealt 4 damage)');
      if (u) picks.push(u);
    }
    for (const u of picks) {
      if (g.entity(u.id)) g.dealEffectDamage(ctx, u, 4);
    }
  },
};
card('A Fast Pile of Rocks', {
  abilities: [{
    type: 'triggered', events: ['died'], self: true, graftCause: true,
    label: 'Rockfall 4 (each player picks a unit; 4 damage to each)',
    effect: rockfall4,
  }],
  graftEffect: { bounded: false, effect: rockfall4 },
});

// "[Augment] I gain +2/+2." — ee/1 1/1 Golem Sprite {Virus} Unit. Text-box
// [Augment]: donated, "I" is the host — it gains +2/+2 when the Golem
// attaches (augment or Virus, both attach as 'augment' mods); played
// normally its own [Augment] text is live (Manual Q&A) — a 3/3 in effect.
// ⚠ header approximation: the permanent gain is two +1/+1 counters.
const golemGrow: EffectDef = {
  run: (g, ctx) => {
    const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
    if (self) g.addCounters(self, 2);
  },
};
card('Aetherflux Golem', {
  augmentText: [{
    type: 'triggered', events: ['spawned', 'modApplied'],
    label: 'I gain +2/+2',
    // spawned: my own arrival (played normally). modApplied: an Aetherflux
    // Golem just attached to me (the donated copy fires exactly once, at
    // attach time). Conditions at event time (R1).
    when: (g, self, ev) =>
      ev.type === 'spawned'
        ? ev.data?.unit === self.id
        : ev.data?.host === self.id && ev.data?.appliedAs === 'augment'
          && g.entity(ev.data?.mod as EntityId)?.card === 'Aetherflux Golem',
    effect: golemGrow,
  }],
});

// "Two target units fight. (They deal damage to each other equal to their
// power.)" — ee/4 {Battle} Bedlam Spell. Both units are cast-time targets
// (count: 2, min: 2). R5: the fight needs both — a gone target fizzles.
card('Battle', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Battle: two target units — they fight', count: 2, min: 2 },
    allOrNothing: true,
    run: (g, ctx) => {
      const [a, b] = ctx.targets;
      if (!isEnt(a) || !isEnt(b) || !g.entity(a.id) || !g.entity(b.id)) {
        g.ev('info', 'Battle: a fighter is gone — no fight.');
        return;
      }
      fight(g, ctx, a, b);
    },
  },
});

// "[Augment] {Unaware} Druid Rock Turtle Unit" — e/4 5/6. Type-line
// [Augment] grants {Unaware}; printed.augmentAttrs carries it and
// printed.attrs keeps it live when played normally. Vanilla otherwise.
card('Bubb', {});

// "[Augment] Abilities cost [one] more to activate or trigger during battle.
// (Choosing to not pay this prevents the abilities from triggering.)" —
// ee/2 2/3 Golem Beast Unit. PARKED (see header): ability-cost taxation /
// pay-to-trigger hooks do not exist. Inert augmentText keeps it recognised
// as an augment; it donates nothing yet.
card('Crevice Lurker', {
  augmentText: [{
    type: 'triggered', events: [],   // PARKED — never fires
    label: 'abilities cost [one] more during battle (not implemented)',
    effect: { run: () => { /* PARKED */ } },
  }],
});

// "[Augment] After combat, I deal damage equal to my defense to each
// opponent." — eee/3 2/3 Alien Strider Unit. Text-box [Augment]; live when
// played normally (Manual Q&A). NOT self: the afterCombat event carries no
// source unit (Embermaw precedent) — region scoping keeps it to the battle
// I'm in. Amount = MY defense at RESOLUTION (R1: effStats of the carrier —
// the host when donated); "each opponent" region-scoped (R25).
card('Deathglow Strider', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'I deal my defense to each opponent (after combat)',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!self) return;
        const [, def] = g.effStats(self);
        if (def <= 0) return;
        for (const seat of presentSeats(g, ctx.region)) {
          if (seat !== ctx.controller) g.dealEffectDamage(ctx, { player: seat }, def);
        }
      },
    },
  }],
});

// "When I activate, if you have at least [e][e][e], create a Shard. (It
// spawns dormant.)" — [e] Earth Resource, 2/0. PARKED (see header): the
// resource-card model doesn't exist. Registered printed-data-only so lookups
// never crash; registry.ts keeps it out of DECK_LIST (resource face).
card('Earth Resource', {});

// "[Augment] Whenever I am dealt damage, you may pay [one]. If you do, I
// fight another target unit. (We deal damage to each other equal to our
// power.)" — ee/6 6/8 Alien Avatar Unit. Text-box [Augment]. Damage event,
// self-filtered (combat and effect damage both fire 'damage'). The target is
// declared when the trigger goes on the stack; the [one] payment is a
// mid-resolution pay-or-decline (R6), skipped outright when unaffordable.
// "Another" is enforced at resolution (Minor Kraken precedent).
card('Eminence of the Barrens', {
  augmentText: [{
    type: 'triggered', events: ['damage'], self: true,
    label: 'you may pay [one] — I fight another target unit',
    effect: {
      targets: { what: 'unit', prompt: 'Eminence of the Barrens: I fight another target unit (if you pay [one])' },
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!self) return;
        const t = ctx.targets[0];
        if (!isEnt(t) || !g.entity(t.id)) return;
        if (t.id === self.id) { g.ev('info', 'Eminence of the Barrens: cannot fight myself ("another target unit").'); return; }
        if (g.openMana(ctx.controller) < 1) { g.ev('info', 'Eminence of the Barrens: cannot pay [one] — no fight.'); return; }
        if (inEndOfTurn(g)) { g.ev('info', 'Eminence of the Barrens: auto-declines the payment (end-of-turn resolution).'); return; }
        const pays = ctx.choose('pay', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Eminence of the Barrens: pay [one] to fight ${t.card}?`,
          options: [{ label: 'Pay [one] — fight', value: true }, { label: 'Decline', value: false }],
        });
        if (pays !== true) return;
        g.payMana(ctx.controller, 1);
        fight(g, ctx, self, t);
      },
    },
  }],
});

// "[Augment] [two]: Change a target of target effect to me." — e/1 1/2
// Spirit Guardian Unit. An ACTIVATED ability in the [Augment] text box: live
// when played normally (via: 'augment') and donated to hosts (via: { mod }).
// Targets an effect on the stack; at resolution one of its declared targets
// (caster's pick when several) becomes me — the ability's carrier.
card('Enigmatic Warder', {
  augmentText: [{
    type: 'activated', cost: { mana: 2 },
    label: '[two]: change a target of target effect to me',
    effect: {
      targets: { what: 'stackSpell', prompt: 'Enigmatic Warder: change a target of target effect to me' },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!t || !('stack' in (t as object))) return;
        const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
        if (!item || item.negated) return;
        const me = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!me) return;
        const slots: [number, number][] = [];
        item.parts.forEach((p, pi) => { if (!p.spent) p.targets.forEach((_, ti) => slots.push([pi, ti])); });
        if (!slots.length) { g.ev('info', `Enigmatic Warder: ${item.label} has no targets to change.`); return; }
        const si = slots.length === 1 ? 0 : ctx.choose('slot', {
          kind: 'electricPath', seat: ctx.controller,
          prompt: 'Enigmatic Warder: which target changes to me?',
          options: slots.map(([pi, ti], i) => ({ label: g.targetLabel(item.parts[pi]!.targets[ti]!), value: i })),
        }) as number;
        const slot = slots[si] ?? slots[0]!;
        item.parts[slot[0]]!.targets[slot[1]] = { unit: me.id };
        g.ev('info', `Enigmatic Warder: a target of ${item.label} is now ${me.card}.`);
      },
    },
  }],
});

// "[Switch1] Target ally and another target unit fight. (They deal damage to
// each other equal to their power.)" — e/1 {Battle} Bedlam Spell. The whole
// sentence is the bounded graftable effect ([Switch1], R9). ⚠ header
// approximation: the ally is the cast-time target; "another target unit" is
// a mid-resolution pick among the region's other units (auto when only one).
const fightEffect: EffectDef = {
  targets: { what: 'allyUnit', prompt: 'Fight: target ally (it fights another unit)' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t) || !g.entity(t.id)) return;
    const others = g.unitsIn(ctx.region).filter(u => u.id !== t.id);
    const second = inEndOfTurn(g) ? (others[0] ?? null)
      : chooseUnit(g, ctx, 'second', ctx.controller, others,
        `Fight: the other unit (it fights ${t.card})`);
    if (!second) { g.ev('info', 'Fight: no other unit — no fight.'); return; }
    fight(g, ctx, t, second);
  },
};
card('Fight', {
  spellEffect: fightEffect,
  graftEffect: { bounded: true, effect: fightEffect },
});

// "When my column deals combat damage, [Switch1] Put a +1/+1 counter on each
// of your units." — ee/3 1/3 {Swift} Luminary Primordial Unit. Condition at
// event time (R1) on the two channels combat damage can take:
//  - 'damage' with no source tag (combat, not effect damage) whose victim is
//    in the column DIRECTLY OPPOSING mine (combat damage is pairwise, so
//    that damage came from my column);
//  - 'lifeLost' why 'combat' where my column connects to the victim
//    (attacking unblocked/Piercing, or blocking with Piercing — the
//    Bloodwind Revenant approximation).
// [Switch1] bounded (R9) — one firing per turn no matter how many hits.
// "Your units" is region-scoped (R12); counters land at RESOLUTION (R1).
const flowstoneCounters: EffectDef = {
  run: (g, ctx) => {
    for (const u of g.unitsOf(ctx.controller, ctx.region)) g.addCounters(u, 1);
  },
};
card('Flowstone Arcanite', {
  abilities: [{
    type: 'triggered', events: ['damage', 'lifeLost'], bounded: true, graftCause: true,
    label: 'put a +1/+1 counter on each of your units',
    when: (g, self, ev) => {
      const b = g.s.battle;
      if (!b) return false;
      const col = g.columnOf(self.id);
      if (!col) return false;
      const alive = col.filter(id => g.entity(id));
      const power = alive.reduce((s, id) => s + Math.max(0, g.effStats(g.entity(id)!)[0]), 0);
      if (power <= 0) return false;                       // a 0-power column deals nothing
      const ci = b.columns.indexOf(col);
      if (ev.type === 'damage') {
        if (ev.data?.source !== undefined) return false;  // effect damage, not combat
        const uid = ev.data?.unit as EntityId | undefined;
        if (uid === undefined) return false;
        if (ci !== -1) return !!b.blocks[ci]?.includes(uid);   // attacking: hit my blockers
        const entry = Object.entries(b.blocks).find(([, c]) => c === col);
        return !!entry && !!b.columns[Number(entry[0])]?.includes(uid);  // blocking: hit the attackers
      }
      // lifeLost: combat damage to an opponent, my column connecting
      if (ev.data?.why !== 'combat' || ev.data?.seat === self.controller) return false;
      if (ci !== -1) return ev.data?.seat === b.defender
        && (b.blocks[ci] === undefined || g.colAttrs(alive).has('Piercing'));
      return ev.data?.seat === b.attacker && g.colAttrs(alive).has('Piercing');
    },
    effect: flowstoneCounters,
  }],
  graftEffect: { bounded: true, effect: flowstoneCounters },
});

// "[Augment][once] [one]: Negate target effect targeting me. That effect's
// controller draws a card." — ee/2 2/3 Arcane Guardian {Virus} Unit. An
// ACTIVATED ability in the [Augment] text box, [once] = bounded (R9). The
// "targeting me" restriction is enforced at resolution (Minor Kraken
// precedent): a target that doesn't aim at me is a no-op — no negate, no
// draw. "Me" = the carrier (the host when donated).
card('Graxxlid', {
  augmentText: [{
    type: 'activated', cost: { mana: 1 }, bounded: true,   // [once]
    label: "[one]: negate target effect targeting me; its controller draws",
    effect: {
      targets: { what: 'stackSpell', prompt: 'Graxxlid: negate target effect targeting me' },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!t || !('stack' in (t as object))) return;
        const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
        if (!item || item.negated) return;
        const me = ctx.sourceId;
        const targetsMe = me !== undefined
          && item.parts.some(p => !p.spent && p.targets.some(tr => 'unit' in tr && tr.unit === me));
        if (!targetsMe) { g.ev('info', `Graxxlid: ${item.label} does not target me — no effect.`); return; }
        g.negate(item.id);
        g.draw(item.controller, 1);
      },
    },
  }],
});

// "I deal 1 damage to each unit." — ee/4 {Battle} {Unaware} Sand Spell.
// "Each unit" = every unit in the effect's region (R12), both sides;
// the unit list is snapshotted, then each still-alive unit is hit.
card('Haboob', {
  spellEffect: {
    run: (g, ctx) => {
      const units = g.unitsIn(ctx.region);
      for (const u of units) {
        if (g.entity(u.id)) g.dealEffectDamage(ctx, u, 1);
      }
    },
  },
});

// "[Augment] When I attack or block, create a Shard. (It will spawn
// dormant.)" — eee/3 3/4 Hooba Rock Unit. Text-box [Augment]; the trigger
// wiring is done, the payload is PARKED (see header: no 'Shard'
// ResourceKind / resource-creation primitive). Fires an info event only.
card('Hooba-Lan', {
  augmentText: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    label: 'create a Shard (creation parked)',
    effect: {
      run: (g, ctx) => {
        g.ev('info', `${ctx.sourceName}: PARKED — Shard resources are not modelled yet; no Shard created.`);
      },
    },
  }],
});

// "[Augment] Whenever I am dealt damage, I deal that much damage to you." —
// e/1 4/4 Occult Rock {Virus} Unit. Text-box [Augment] — as a Virus on an
// enemy unit, "you" is the HOST's controller (the trigger's controller is
// the carrier's controller), which is the whole point of the card. "That
// much" = the event's amount (R1: read from the event snapshot).
card('Lithoghul', {
  augmentText: [{
    type: 'triggered', events: ['damage'], self: true,
    label: 'I deal that much damage to you (whenever I am dealt damage)',
    effect: {
      run: (g, ctx) => {
        const n = (ctx.event?.data?.n as number | undefined) ?? 0;
        if (n > 0) g.dealEffectDamage(ctx, { player: ctx.controller }, n);
      },
    },
  }],
});
