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
 *  - Hooba-Lan: UN-PARKED — E.createShard() (a real 'shard' ResourceKind,
 *    created dormant) exists, and the card calls it. The note that this
 *    "needs a Shard ResourceKind" outlived the primitive; see the card.
 *  - Earth Resource: STILL PARKED, but for two reasons rather than three —
 *    the Shard half is done (E.createShard). What is missing is the
 *    resource-CARD model: resources are anonymous ResourceState entries with
 *    no card behind them, and doActivateResource does not fireEvent, so
 *    "when I activate" has nothing to listen to. Registered printed-data-only;
 *    registry.ts deliberately excludes it from DECK_LIST (a resource face,
 *    not a deck card).
 */
import type { Attr, Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, notSelf, type EffectCtx, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt, inEndOfTurn, chooseUnit } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** present seats of a region, initiative player first (stable order) */
const presentSeats = (g: E, region: number): Seat[] => {
  const present = g.s.regions[region]!.presentSeats;
  return [g.initiative, g.nit].filter(s => present.includes(s));
};

/** Two units fight: they deal damage to each other equal to their power,
 * simultaneously — powers snapshotted first, then both hits are dealt via
 * dealEffectDamage with the FIGHTER's card as the source (⚠ header note:
 * fighter attrs like Deadly apply; Reaping/Resonant riders credit the
 * effect's controller). */
const fight = (g: E, ctx: EffectCtx, a: Entity, b: Entity): void => {
  /* R106 {Unaware}: a fight is an interaction, so if EITHER fighter is Unaware
   * both of them are read off the printed cards ("it looks ONLY at what is the
   * literal printed text on all cards 'involved'"), in both directions.
   *
   * The powers are collapsed here. The RECEIVING half has to be collapsed too,
   * and `dealEffectDamage` decides that from the source's attributes — which,
   * for a fight, are the fighter's only when `ctx.sourceId` is unset (a spell
   * like Battle); an ability that makes two units fight is still its own
   * source. So the flag is handed over explicitly through `grantedAttrs`, the
   * same seam R79 uses to donate a virus's attributes to a resolving effect.
   * Without it, Bubb fighting an Eminence would kill it at printed and take
   * the Eminence's EFFECTIVE power back. */
  const collapsed = g.collapsedBy(a, [b]);
  const [pa] = g.interactionStats(a, [b]);
  const [pb] = g.interactionStats(b, [a]);
  const granted: Attr[] = collapsed
    ? [...(ctx.grantedAttrs ?? []), 'Unaware']
    : (ctx.grantedAttrs ?? []);
  g.ev('info', `${a.card} fights ${b.card}.`);
  if (pb > 0) g.dealEffectDamage({ ...ctx, sourceName: b.card, grantedAttrs: granted }, a, pb);
  if (pa > 0) g.dealEffectDamage({ ...ctx, sourceName: a.card, grantedAttrs: granted }, b, pa);
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
    const live = picks.filter(u => g.entity(u.id));
    if (!live.length) { g.ev('info', 'Rockfall 4: nobody has a unit to choose — nothing is dealt damage.'); return; }
    g.dealEffectDamageAll(ctx, live.map(u => ({ target: u, n: 4 })));   // R80: one batch
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
    const self = selfOf(g, ctx);
    if (!self) { g.ev('info', `${ctx.sourceName}: the carrier is gone — no +2/+2.`); return; }
    g.addCounters(self, 2);
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
// The attribute is LIVE as of R106 (2026-08-23): stat layer 6 shipped. Bubb —
// or any host its [Augment] lands on — reads at the numbers PRINTED on its
// card, through counters, auras, base rewrites, {Tough} and {Inverted} alike;
// and so does everything it is dealing damage to or in combat with, which is
// why it kills a Robot token however many +1/+1 counters that Robot carries.
// (This note used to end at "vanilla otherwise", which was true of the code
// and hid a dead card for two playtest reports.)
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
      // every branch says something: an effect that runs to completion in
      // silence is a conformance failure (test/65-effect-conformance.test.ts),
      // and each of these three is a real thing a player needs told
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) { g.ev('info', 'Deathglow Strider: the carrier is gone — no damage.'); return; }
        const [, def] = g.effStats(self);
        if (def <= 0) {
          g.ev('info', `Deathglow Strider: ${self.card} has no defense left — no damage.`);
          return;
        }
        const foes = presentSeats(g, ctx.region).filter(seat => seat !== ctx.controller);
        if (!foes.length) {
          g.ev('info', 'Deathglow Strider: no opponent is in this region — no damage.');
          return;
        }
        g.dealEffectDamageAll(ctx, foes.map(seat => ({ target: { player: seat }, n: def })));   // R80
      },
    },
  }],
});

// "When I activate, if you have at least [e][e][e], create a Shard. (It
// spawns dormant.)" — [e] Earth Resource, 2/0. PARKED (see header) on the
// resource-CARD model and the missing 'when I activate' event — NOT on the
// Shard any more (E.createShard is real). Registered printed-data-only so
// lookups never crash; registry.ts keeps it out of DECK_LIST (resource face).
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
      // R64: "ANOTHER target unit" — the Eminence cannot fight itself
      targets: {
        what: 'unit', prompt: 'Eminence of the Barrens: I fight another target unit (if you pay [one])',
        restrict: notSelf,
      },
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) { g.ev('info', 'Eminence of the Barrens: the carrier is gone — no fight.'); return; }
        const t = ctx.targets[0];
        if (!isEnt(t) || !g.entity(t.id)) {
          g.ev('info', 'Eminence of the Barrens: the target is gone — no fight.');
          return;
        }
        if (t.id === self.id) { g.ev('info', 'Eminence of the Barrens: cannot fight myself ("another target unit").'); return; }
        if (g.openMana(ctx.controller) < 1) { g.ev('info', 'Eminence of the Barrens: cannot pay [one] — no fight.'); return; }
        if (inEndOfTurn(g)) { g.ev('info', 'Eminence of the Barrens: auto-declines the payment (end-of-turn resolution).'); return; }
        const pays = ctx.choose('pay', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Eminence of the Barrens: pay [one] to fight ${t.card}?`,
          options: [{ label: 'Pay [one] — fight', value: true }, { label: 'Decline', value: false }],
        });
        if (pays !== true) { g.ev('info', 'Eminence of the Barrens: the [one] is declined — no fight.'); return; }
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
      targets: { what: 'stackEffect', prompt: 'Enigmatic Warder: change a target of target effect to me' },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!t || !('stack' in (t as object))) {
          g.ev('info', 'Enigmatic Warder: no effect is targeted — nothing is retargeted.');
          return;
        }
        const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
        if (!item) {
          g.ev('info', 'Enigmatic Warder: the targeted effect has already left the stack.');
          return;
        }
        const me = selfOf(g, ctx);
        if (!me) { g.ev('info', 'Enigmatic Warder: the carrier is gone — nothing to retarget to.'); return; }
        // R58: only slots I could LEGALLY occupy. Changing a target may not
        // create an illegal one — the playtest bug was this Warder dropping
        // itself into Fight's "target ALLY" slot while belonging to the other
        // player, where "ally" means ally of the SPELL's controller. It also
        // may not duplicate a sibling slot ("another target unit", R56).
        const slots: [number, number][] = [];
        item.parts.forEach((p, pi) => {
          if (p.spent) return;
          p.targets.forEach((cur, ti) => {
            if (JSON.stringify(cur) === JSON.stringify({ unit: me.id })) return;   // already me
            if (g.canFillSlot(item, pi, ti, { unit: me.id })) slots.push([pi, ti]);
          });
        });
        if (!slots.length) {
          g.ev('info', `Enigmatic Warder: no target of ${item.label} may legally be changed to ${me.card}.`);
          return;
        }
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
// sentence is the bounded graftable effect ([Switch1], R9).
//
// PLAYTEST FIX (R58): the printed text says "target ally AND ANOTHER TARGET
// unit" — BOTH are targets, chosen at cast. This used to take only the ally at
// cast and pick the second unit mid-resolution, which meant the opponent never
// saw what the spell was aimed at while it was on the stack, and the second
// "target" could not be responded to at all. Now it is a two-slot spec with
// per-slot legality: slot 0 an ally of the CASTER, slot 1 any other unit.
//
// Both are re-checked at resolution rather than trusted from cast (R56/R58):
// Enigmatic Warder can redirect a slot afterwards, and the playtest bug was
// the OPPONENT's Warder moving itself into the "ally" slot — "ally" means ally
// of this spell's controller, never of the redirector's.
const fightEffect: EffectDef = {
  targets: {
    what: 'unit', count: 2, min: 2,
    slots: ['allyUnit', 'unit'],
    prompt: 'Fight: target ally, then another target unit — they fight',
    slotPrompts: [
      'Fight: target ally (it fights another target unit)',
      'Fight: another target unit (it fights your ally)',
    ],
  },
  run: (g, ctx) => {
    const [a, b] = [ctx.targets[0], ctx.targets[1]];
    if (!isEnt(a) || !isEnt(b) || !g.entity(a.id) || !g.entity(b.id)) {
      g.ev('info', 'Fight: a target is gone — no fight.');
      return;
    }
    if (a.id === b.id) { g.ev('info', 'Fight: "another" — one unit cannot fight itself.'); return; }
    if (a.controller !== ctx.controller) {
      g.ev('info', `Fight: ${a.card} is not ${g.pname(ctx.controller)}'s ally any more — no fight.`);
      return;
    }
    fight(g, ctx, a, b);
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
    const mine = g.unitsOf(ctx.controller, ctx.region);
    if (!mine.length) { g.ev('info', `${ctx.sourceName}: you control no unit here — no counters.`); return; }
    for (const u of mine) g.addCounters(u, 1);
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

/**
 * "…target effect TARGETING ME": does the stack item `stackId` aim at `me`?
 *
 * One predicate, asked in two different questions, which is the whole point of
 * report #70 below — the candidate list and the resolution check have to be
 * the same sentence or the client offers what the card then refuses.
 *
 * Two ways an effect can aim at a unit:
 *  - it declared the unit as a TARGET (`{ unit: me }` in a live, unspent
 *    part) — the ordinary case, a Fireball on my host;
 *  - it is a VIRUS being applied to me. A virus carries no parts and no target
 *    refs (apply.ts builds it with `parts: []` and a `hostId`), so the plain
 *    target-ref read misses it — but the designer is explicit that it is a
 *    targeted effect and that Graxxlid reaches it. Caleb, rules-questions:
 *    "You can redirect a virus, it is a targeted effect", and asked directly
 *    "so you could Graxxlid or Boon of Protection it as well?" — "Yep!
 *    They're fully interactible." R79's other virus shape (`hostStack`, a
 *    virus aimed at a SPELL on the stack) is not aimed at me and is excluded.
 */
const aimsAtUnit = (g: E, stackId: number, me: EntityId | undefined): boolean => {
  if (me === undefined) return false;
  const item = g.s.stack.find(i => i.id === stackId);
  if (!item) return false;
  if (item.kind === 'virus') return item.hostId === me;
  return item.parts.some(p => !p.spent && p.targets.some(tr => 'unit' in tr && tr.unit === me));
};

// "[Augment][once] [one]: Negate target effect targeting me. That effect's
// controller draws a card." — ee/2 2/3 Arcane Guardian {Virus} Unit. An
// ACTIVATED ability in the [Augment] text box, [once] = bounded (R9).
// "Me" = the carrier (the host when donated).
//
// Report #70 (GETD, 2026-08-22): "Graxxlid is lighting up like I can activate
// its ability despite there being no legal targets on the stack". It was: the
// spec was a bare `what: 'stackEffect'`, so EVERY item on the stack was a
// candidate and "targeting me" was checked only at resolution, as an info
// line. R64 settles which of the two that clause is — "the printed restriction
// is part of what makes a target LEGAL, not a condition checked once the spell
// resolves" — so it belongs in `restrict`, which the three places that must
// agree all read: the candidate menu, `castable`, and `canFillSlot`. The
// designer-community source under it is the RAQ thread "[Solved] Target
// requirements to put effect on stack": "In order to play a card, you MUST be
// able to select the valid targets for the effect. Eg. You cannot play
// Resurrect if there aren't any 2 mana units in your bin." R64 already gates
// an ABILITY the same way ("one whose mandatory target has nothing legal to
// aim at is not offered and is refused"), which is exactly the ask: with no effect
// on the stack aiming at Graxxlid, `abilityUnusable` drops the activation from
// `legalActions` and the client's green `.activatable` halo — a pure read of
// `legalActions` — goes out on its own. No UI change. (The inverse of report
// #35, where a card that COULD act was not drawn as if it could.)
//
// The resolution check STAYS, and is not dead code. R64 is explicit that a
// restriction is not re-asked at resolution (R5/R56), so between activation
// and resolution the world may legally stop satisfying it: Redirect moves an
// effect's targets ("You can redirect a virus, it is a targeted effect"), a
// part can be spent, the aiming item can leave the stack, and Reconfigure can
// carry the Graxxlid mod to a different host mid-battle (Passer's worked
// example) while `ctx.sourceId` still names the host it was activated from.
// A restriction that was true at cast is a promise about cast time only — the
// same RAQ thread says so of the far end: "if there was a legal target at this
// point in time and it disappears (e.g. OP playing something in response to
// the trigger), the ability will resolve as far as it can."
card('Graxxlid', {
  augmentText: [{
    type: 'activated', cost: { mana: 1 }, bounded: true,   // [once]
    label: "[one]: negate target effect targeting me; its controller draws",
    effect: {
      targets: {
        what: 'stackEffect',
        prompt: 'Graxxlid: negate target effect targeting me',
        // R64: the printed "targeting me" clause, as a targeting restriction
        restrict: (g, t, ctx) => 'stack' in t && aimsAtUnit(g, t.stack, ctx.sourceId),
      },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!t || !('stack' in (t as object))) return;
        const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
        // R113: both of these are a TARGETED bounded trigger that missed —
        // the same shape as a fizzle, which the designer ruled spends the use
        // ("regardless of if that ability resolves or doesn't"). Answering a
        // Graxxlid by moving its target off the stack is meant to cost it the
        // turn's use; refunding here would make that answer free.
        if (!item) {
          g.ev('info', 'Graxxlid: the targeted effect has already left the stack — nothing is negated.');
          return;
        }
        if (!aimsAtUnit(g, item.id, ctx.sourceId)) {
          g.ev('info', `Graxxlid: ${item.label} does not target me — no effect.`);
          return;
        }
        g.negate(item.id);
        g.draw(item.controller, 1);
      },
    },
  }],
});

// "I deal 1 damage to each unit." — ee/4 {Battle} {Unaware} Sand Spell.
// "Each unit" = every unit in the effect's region (R12), both sides;
// the unit list is snapshotted, then each still-alive unit is hit.
// {Unaware} on this spell is LIVE and is the whole point of the card (R106):
// a spell has no stats of its own to collapse, so its {Unaware} collapses what
// it HITS. The owner, 2026-08-23: "Haboob kills anything that has 1 defense
// printed at the card level" — a 1/1 under four +1/+1 counters dies to this 1
// damage, and a printed 2 defense does not.
card('Haboob', {
  spellEffect: {
    run: (g, ctx) => {
      const units = g.unitsIn(ctx.region);
      if (!units.length) { g.ev('info', 'Haboob: there is no unit here to damage.'); return; }
      // R80: "each unit" is one batch — every unit here is dealt its 1 at once
      g.dealEffectDamageAll(ctx, units.map(u => ({ target: u, n: 1 })));
    },
  },
});

// "[Augment] When I attack or block, create a Shard. (It will spawn
// dormant.)" — eee/3 3/4 Hooba Rock Unit. Text-box [Augment]; the trigger
// wiring was already done and only the payload was parked for want of a Shard
// primitive. E.createShard exists now, so this is LIVE: the Shard goes to the
// carrier's controller ("you"), dormant, once per attack or block.
card('Hooba-Lan', {
  augmentText: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    label: 'create a Shard (dormant)',
    effect: { run: (g, ctx) => { g.createShard(ctx.controller, 1, ctx.sourceName); } },
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
