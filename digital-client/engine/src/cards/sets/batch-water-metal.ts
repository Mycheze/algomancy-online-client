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
 * Nothing is parked in this batch.
 *
 * (This header used to park "Astralith's AUGMENT DONATION" on the claim that
 * "the engine only surfaces activated abilities from a card's own `abilities`
 * list … so an activated ability donated by an augment can never be activated
 * on the host". That has not been true for some time: apply.ts's
 * pushActivatedOptions offers a card's own `augmentText` (via: 'augment') AND
 * every augment mod's `augmentText` (via: { mod }), and test 511 in
 * 10-water-metal exercises the donated path end to end.
 *
 * The stale note had a live consequence, not just a wrong sentence: Astralith
 * carried the SAME activated ability in both `abilities` and `augmentText` —
 * one copy for the played-normally case, one "purely so the card registers as
 * an augment" — and since apply.ts offers both lists, a normally-played
 * Astralith surfaced its [three] ability TWICE in legalActions. It is now
 * declared once, in `augmentText`, which is where the printed [Augment] marker
 * puts it and which covers both forms.)
 */
import type { Seat } from '../../types.ts';
import { card, getCard, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt } from './helpers.ts';

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
    const foes = g.s.regions[ctx.region]!.presentSeats.filter(s => s !== ctx.controller);
    if (!foes.length) { g.ev('info', `${ctx.sourceName}: no opponent is present here — no damage.`); return; }
    g.dealEffectDamageAll(ctx, foes.map(s => ({ target: { player: s as Seat }, n: 2 })));   // R80
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
    const self = selfOf(g, ctx);
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
  creates: ['Unit Token'],
  run: (g, ctx) => {
    const x = eventSpellCost(ctx);
    if (x <= 0) { g.ev('info', 'Arcane Concentrator: that spell costs 0 — X is 0, no unit.'); return; }
    g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [x, x] });
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
    const self = selfOf(g, ctx);
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
// An ACTIVATED ability inside the [Augment] text box (cost = 3 mana, targeted),
// declared ONCE, in `augmentText`, which is where the printed [Augment] marker
// puts it. apply.ts offers augmentText from the card itself (via: 'augment' —
// Manual Q&A: a card's own [Augment] text is live when it is played normally)
// and from every augment mod on a host (via: { mod }), so one declaration
// covers both forms. It used to be declared in BOTH lists, on a header note
// claiming donated activated abilities could never fire; that note had expired,
// and the duplicate made a normally-played Astralith offer the ability twice.
const putOneCounter: EffectDef = {
  targets: { what: 'unit', prompt: 'Astralith: put a +1/+1 counter on target unit' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (isEnt(t)) g.addCounters(t, 1);
  },
};
card('Astralith', {
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
  creates: ['Robot'],
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
