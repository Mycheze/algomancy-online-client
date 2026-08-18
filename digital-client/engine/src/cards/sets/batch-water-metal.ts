/* batch-water-metal — the water/metal card batch, scripted over the printed
 * data in printed.json (never hand-copied). Printed text quoted for review.
 *
 * Owned by one card-scripting agent; see sets/index.ts for ordering rules.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R9 (bounded [Switch1]/[once] budgets per card), R12 (regions are exclusive —
 * the engine region-scopes trigger listeners and presentSeats, so "each
 * opponent" is read from the event's region).
 *
 * PARKED (needs engine machinery that does not exist yet):
 *  - Astralith's AUGMENT DONATION. The card is "[Augment] [three]: Put a +1/+1
 *    counter on target unit" — an ACTIVATED ability inside the [Augment] text
 *    box. The engine only surfaces activated abilities from a card's own
 *    `abilities` list (pushActivatedOptions / doActivateAbility in apply.ts read
 *    getCard(u.card).abilities and never scan augmentText or a host's augment
 *    mods). So an activated ability donated by an augment can never be activated
 *    on the host. Astralith's played-normally behavior IS delivered (modelled in
 *    `abilities`; Manual Q&A: a card's own [Augment] text is active when it is in
 *    play normally) and tested; the augmentText copy exists only so the card is
 *    recognised as an augment. See the ⚠ ruling proposal in the batch report.
 */
import type { Entity, Seat } from '../../types.ts';
import { card, getCard, type EffectDef } from '../dsl.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** the mana cost of the spell in the triggering event (R1: read from the event
 * snapshot). 'X'-cost spells report 0 — none in this pool. */
const eventSpellCost = (ctx: { event: { data?: Record<string, unknown> } | null }): number => {
  const name = ctx.event?.data?.card as string | undefined;
  if (!name) return 0;
  const mana = getCard(name).mana;
  return typeof mana === 'number' ? mana : 0;
};

// ─────────────────────────── WATER ───────────────────────────

// "[Augment] {Sluggish} Rock Beast {Virus} Unit" — ee/2 4/5. Type-line
// [Augment] grants {Sluggish}; printed.augmentAttrs transfers it on augment,
// and printed.attrs keeps it live when played normally. Vanilla otherwise.
card('Ambling Mountaintop', {});

// "When I despawn, [Switch1] Each opponent loses 3 life." — b/1 2/1.
// Despawn = ANY leave-play, so listen to BOTH 'died' (destroy) and 'despawned'
// (recall); self-filtered to the leaving unit. "Each opponent" is region-scoped
// (R12): the opponents present in the event's region (in battle, both seats).
const eachOpponentLoses3: EffectDef = {
  run: (g, ctx) => {
    for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
      if (seat !== ctx.controller) g.loseLife(seat as Seat, 3, ctx.sourceName);
    }
  },
};
card('Bloated Manablub', {
  abilities: [{
    type: 'triggered', events: ['died', 'despawned'], self: true,
    bounded: true, graftCause: true,
    label: 'each opponent loses 3 life',
    effect: eachOpponentLoses3,
  }],
  graftEffect: { bounded: true, effect: eachOpponentLoses3 },
});

// "When another ally spawns during battle, [Switch1] I deal 2 damage to each
// opponent." — b/2 2/2. Fires on 'spawned' (NOT self: another ally), gated to
// the battle phase, same controller, a different unit. Region scoping is done
// by fireEvent (listeners see only same-region spawns). "Each opponent" is
// region-scoped like Bloated Manablub.
const dealTwoToEachOpponent: EffectDef = {
  run: (g, ctx) => {
    for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
      if (seat !== ctx.controller) g.dealEffectDamage(ctx, { player: seat as Seat }, 2);
    }
  },
};
card('Boreal Wanderer', {
  abilities: [{
    type: 'triggered', events: ['spawned'], bounded: true, graftCause: true,
    label: 'deal 2 damage to each opponent',
    when: (g, self, ev) =>
      g.s.phase === 'battle' &&
      ev.data?.seat === self.controller &&
      ev.data?.unit !== self.id,
    effect: dealTwoToEachOpponent,
  }],
  graftEffect: { bounded: true, effect: dealTwoToEachOpponent },
});

// "[Augment] [once] When you play a nontoken spell, put X +1/+1 counters on me,
// where X is that spell's cost." — bb/2 1/1. Text-box [Augment] (text only,
// never attrs). [once] = bounded per host per card (R9). X is the played
// spell's mana cost, read from the event (R1); "me" = the unit carrying the
// ability (ctx.sourceId: the host when donated, the card itself when normal).
const amalgamCounters: EffectDef = {
  run: (g, ctx) => {
    const x = eventSpellCost(ctx);
    const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
    if (self && x > 0) g.addCounters(self, x);
  },
};
card('Channeled Amalgam', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'], bounded: true,   // [once]
    label: "put X +1/+1 counters on me (X = the spell's cost)",
    when: (g, self, ev) => ev.data?.seat === self.controller && !ev.data?.token,
    effect: amalgamCounters,
  }],
});

// "[Augment][once] When you play a nontoken spell, create an X/X unit, where X
// is the spell's cost." — bb/3 3/2. Same spellPlayed pattern; X/X token via
// spawnUnit tokenStats (like Awoken Tomb).
const arcaneMakeXX: EffectDef = {
  run: (g, ctx) => {
    const x = eventSpellCost(ctx);
    if (x > 0) g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [x, x] });
  },
};
card('Arcane Concentrator', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'], bounded: true,   // [once]
    label: "create an X/X unit (X = the spell's cost)",
    when: (g, self, ev) => ev.data?.seat === self.controller && !ev.data?.token,
    effect: arcaneMakeXX,
  }],
});

// "[Augment] Whenever a player loses life, put that many +1/+1 counters on me.
// (Damage causes life loss.)" — bm/4 2/2, {Sluggish} (printed attr, not an
// augment grant: the [Augment] here is on the TEXT box). Fires on 'lifeLost'
// for ANY player; X = the amount lost, from the event (R1). Region-scoped in
// battle (lifeLost carries a region only then), global otherwise.
const adversaryGrow: EffectDef = {
  run: (g, ctx) => {
    const n = (ctx.event?.data?.n as number | undefined) ?? 0;
    const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
    if (self && n > 0) g.addCounters(self, n);
  },
};
card('Adversary of the Deep', {
  augmentText: [{
    type: 'triggered', events: ['lifeLost'],
    label: 'put that many +1/+1 counters on me (X = the life lost)',
    effect: adversaryGrow,
  }],
});

// ─────────────────────────── METAL ───────────────────────────

// "[Augment] When I die, draw a card." — m/2 1/1. Text-box [Augment] (text
// only). Fires on the carrier's death: when donated, the host's controller
// draws; when played normally, its own [Augment] text is live (Manual Q&A).
const drawACard: EffectDef = { run: (g, ctx) => g.draw(ctx.controller, 1) };
card('A Pile of Rubbish', {
  augmentText: [{
    type: 'triggered', events: ['died'], self: true,
    label: 'draw a card (when I die)',
    effect: drawACard,
  }],
});

// "[Augment] [three]: Put a +1/+1 counter on target unit." — m/1 2/3.
// An ACTIVATED ability inside the [Augment] text box (cost = 3 mana, targeted).
// Modelled in `abilities` so the played-normally behavior works and is testable
// (the engine only surfaces activated abilities from `abilities`); the
// augmentText copy exists purely so the card registers as an augment. The
// augment-DONATION of this activated ability is PARKED — see the header note.
const putOneCounter: EffectDef = {
  targets: { what: 'unit', prompt: 'Astralith: put a +1/+1 counter on target unit' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (t && 'id' in (t as object)) g.addCounters(t as Entity, 1);
  },
};
card('Astralith', {
  abilities: [{
    type: 'activated', cost: { mana: 3 },
    label: '[three]: put a +1/+1 counter on target unit',
    effect: putOneCounter,
  }],
  // recognised as an augment (its printed type line has [Augment]); the donated
  // activated ability is not yet activatable on a host — PARKED (see header).
  augmentText: [{
    type: 'activated', cost: { mana: 3 },
    label: '[three]: put a +1/+1 counter on target unit',
    effect: putOneCounter,
  }],
});

// "After combat, [Switch] Create a Robot 1." — m/2 2/2. Unbounded ([Switch],
// not [Switch1]); fires on 'afterCombat' (region-scoped) for the unit's
// controller. Robot 1 = a 0/0 unit token with one +1/+1 counter.
const createRobot1: EffectDef = {
  run: (g, ctx) => { g.spawnUnit(ctx.controller, 'Robot', ctx.region, { token: true, counters: 1 }); },
};
card('Construct Overseer', {
  abilities: [{
    type: 'triggered', events: ['afterCombat'], graftCause: true,
    label: 'create a Robot 1',
    effect: createRobot1,
  }],
  graftEffect: { bounded: false, effect: createRobot1 },
});
