/* batch-fire-wood — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Fire/Wood/Earth cards scripted over the printed data in
 * printed.json (never hand-copied). Printed text quoted for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R9 (bounded budgets per card), R12 (regions are exclusive — the engine
 * region-scopes trigger listeners, so "your/ally/enemy" conditions only see
 * same-region entities).
 *
 * Nothing parked in this batch — every printed behavior maps onto existing
 * engine primitives.
 */
import type { CardName, EntityId } from '../../types.ts';
import { card, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt, isUnitCard } from './helpers.ts';

// ─────────────────────────── EARTH (augments) ───────────────────────────

// "[Augment] {Piercing} Insect Crab {Virus} Unit" — type-line [Augment] grants
// {Piercing}; printed.augmentAttrs carries it, no behavior needed. (Vanilla
// 2/3 Piercing when played normally.)
card('Bumblecrab', {});

// "[Augment] {Deadly} Bedlam Beast Unit" — type-line [Augment] grants {Deadly}
// (R21); printed.augmentAttrs carries it. (Vanilla 3/3 Deadly played normally.)
card('Carapace Devourer', {});

// ─────────────────────────────── FIRE ───────────────────────────────────

// "[Switch] Target unit gains +4/+4 until regroup." — {Battle} spell; the
// [Switch] effect is shared as an unbounded graft.
const channeledBoonBuff: EffectDef = {
  targets: { what: 'unit', prompt: 'Channeled Boon: target unit gains +4/+4 until regroup' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (isEnt(t)) g.addTemp(t, 4, 4);
  },
};
card('Channeled Boon', {
  spellEffect: channeledBoonBuff,
  graftEffect: { bounded: false, effect: channeledBoonBuff },
});

// "[Switch1] I deal damage to any target equal to the number of units that
// died in this battle." — R1: the amount is computed at RESOLUTION from the
// battle counters. "units that died in this battle" = both seats' deaths in
// this region-battle (R14: battle counters are per region-battle). Bounded
// graft ([Switch1]).
const burningVengeance: EffectDef = {
  targets: { what: 'any', prompt: 'Burning Vengeance: damage = units that died this battle' },
  run: (g, ctx) => {
    const deaths = g.battleCounter(ctx.region, 'allyDeaths:0')
      + g.battleCounter(ctx.region, 'allyDeaths:1');
    if (deaths <= 0) {
      g.ev('info', 'Burning Vengeance: no unit has died this battle — it deals 0 damage.');
      return;
    }
    g.dealEffectDamage(ctx, ctx.targets[0]!, deaths);
  },
};
card('Burning Vengeance', {
  spellEffect: burningVengeance,
  graftEffect: { bounded: true, effect: burningVengeance },
  // UI preview (#5): the damage it would deal if it resolved right now
  xPreview: (g, _seat, region) =>
    g.battleCounter(region, 'allyDeaths:0') + g.battleCounter(region, 'allyDeaths:1'),
});

// "[Augment] When I attack or block, create a Fireball X+1, where X is the
// number of allies adjacent to me." — text-box [Augment] (text only, no attrs).
// R1: X is measured at RESOLUTION from live formation adjacency.
const flamebreathInitiate: EffectDef = {
  creates: ['Fireball'],
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    if (!self) { g.ev('info', 'Flamebreath Initiate: the carrier is gone — no Fireball.'); return; }
    const allies = g.adjacentInFormation(self.id).filter(u => u.controller === ctx.controller);
    g.createSpellToken(ctx.controller, 'Fireball', allies.length + 1, ctx.region);
  },
};
card('Flamebreath Initiate', {
  augmentText: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    label: 'create a Fireball X+1 (X = allies adjacent to me)',
    effect: flamebreathInitiate,
  }],
});

// "[Augment] After combat, create an X/X unit, where X is the number of
// attacking units in my formation." — text-box [Augment] (text only). NOT
// self:true — the afterCombat event carries no source unit, so a self-guard
// would never fire (cf. Wisp / Smouldering Inferno). X = the attacking units
// on my side (units in the attacker columns I control), read at RESOLUTION
// (R1): survivors of combat. If I wasn't an attacker (I blocked, or there was
// no attack) X = 0 and nothing is created.
const embermawFledgling: EffectDef = {
  creates: ['Unit Token'],
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    if (!self) { g.ev('info', 'Embermaw Fledgling: the carrier is gone — no unit.'); return; }
    const b = g.s.battle;
    if (!b) { g.ev('info', 'Embermaw Fledgling: there is no formation to count — X = 0, no unit.'); return; }
    let x = 0;
    for (const col of b.columns) {
      for (const id of col) {
        const u = g.entity(id);
        if (u && u.controller === self.controller) x++;
      }
    }
    if (x <= 0) { g.ev('info', 'Embermaw Fledgling: no attacking unit in my formation — X = 0, no unit.'); return; }
    g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [x, x] });
  },
};
card('Embermaw Fledgling', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'create an X/X unit (X = attacking units in my formation)',
    effect: embermawFledgling,
  }],
});

// ─────────────────────────────── WOOD ────────────────────────────────────

// "When I attack or block, [Switch] Your units gain +0/+1 until regroup." —
// R12: "your units" is region-scoped, so it buffs my units IN THIS REGION
// (the battle region where I'm attacking/blocking). Unbounded graft.
const grottoBuff: EffectDef = {
  run: (g, ctx) => {
    const units = g.unitsOf(ctx.controller, ctx.region);
    // an empty region is a real outcome (the Guardian itself can have left by
    // the time the trigger resolves) — it must still say so rather than
    // resolving in silence (65-effect-conformance)
    if (!units.length) {
      g.ev('info', 'Guardian of the Grotto: you have no units in this region — nothing is buffed.');
      return;
    }
    for (const u of units) g.addTemp(u, 0, 1);
  },
};
card('Guardian of the Grotto', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true, graftCause: true,
    label: 'your units gain +0/+1 until regroup',
    effect: grottoBuff,
  }],
  graftEffect: { bounded: false, effect: grottoBuff },
});

// "When another nontoken ally spawns, [Switch1] Draw a card." — spawned event.
// when() (R1, event-time): same controller (ally), not me (another), and the
// spawned entity is not a token (nontoken). Region is auto-scoped (R12: only
// same-region spawns reach this listener). Bounded graft ([Switch1], R9).
const caudexDraw: EffectDef = { run: (g, ctx) => g.draw(ctx.controller, 1) };
card('Engorged Caudex', {
  abilities: [{
    type: 'triggered', events: ['spawned'], bounded: true, graftCause: true,
    label: 'draw a card',
    when: (g, self, ev) =>
      ev.data?.seat === self.controller &&
      ev.data?.unit !== self.id &&
      !g.entity(ev.data?.unit as EntityId)?.token,
    effect: caudexDraw,
  }],
  graftEffect: { bounded: true, effect: caudexDraw },
});

// "When an enemy dies, [Switch1] Create a 2/2 unit." — died event. when()
// (R1, event-time): the dying unit's controller differs from mine (enemy).
// Region auto-scoped (R12). Bounded graft ([Switch1], R9).
const foragerSpawn: EffectDef = {
  creates: ['Unit Token'],
  run: (g, ctx) => { g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [2, 2] }); },
};
card('Forager of the Fallen', {
  abilities: [{
    type: 'triggered', events: ['died'], bounded: true, graftCause: true,
    label: 'create a 2/2 unit',
    when: (g, self, ev) => ev.data?.seat !== self.controller,
    effect: foragerSpawn,
  }],
  graftEffect: { bounded: true, effect: foragerSpawn },
});

// "[Augment] Whenever you play a unit, create a 1/1 unit."
//
// It listens on 'cardPlayed', not on 'spawned'. The old note here said "there
// is no 'unitPlayed' event" — that expired with R129, which fires
// 'cardPlayed' for exactly the four kinds that ARE plays (unit / spell /
// spellUnit / ambush; a spell TOKEN is cast from play, not played — R59, and a
// mod is not a play — R37). Void Mandible already reads it.
//
// The bug that fixed: 'spawned' fires for a unit ENTERING PLAY by any route, so
// Exhume, Resurrect, Wake the Dead, Rousing Spirit and Lurking Dread — all of
// which print "put into play", not "play" — each wrongly made a 1/1.
//
// `isUnitCard` is the pool's settled membership for "a unit": unit + spellUnit,
// never spellToken. Not a fresh judgement call — helpers.ts already owns it.
//
// ⚠ 'cardPlayed' fires at COMMIT time, so the 1/1 arrives while the played unit
// is still on the stack and it triggers even if that unit is later negated. That
// is what the printed word "play" means — you played it — and the old 'spawned'
// version silently gave the opposite answer.
//
// The loop guard is structural now rather than a token check: a created token
// never fires 'cardPlayed' at all. The text says "you play a unit" (NOT
// "another"), so unlike Flourishing Flora it is NOT self-excluded — playing
// Bloomcaster itself still makes a 1/1. Region auto-scoped (R12).
const bloomcasterMake: EffectDef = {
  creates: ['Unit Token'],
  run: (g, ctx) => { g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [1, 1] }); },
};
card('Bloomcaster', {
  augmentText: [{
    type: 'triggered', events: ['cardPlayed'],
    label: 'create a 1/1 unit',
    when: (_g, self, ev) =>
      ev.data?.seat === self.controller
      && ev.data?.token !== true
      && isUnitCard(ev.data?.card as CardName),
    effect: bloomcasterMake,
  }],
});

// "[Augment] Whenever another ally spawns, put a +1/+1 counter on me." —
// spawned event. when(): same controller (ally), not me (another — "another"
// excludes my own spawn). Tokens count as allies (no nontoken restriction).
// Region auto-scoped (R12).
const floraGrow: EffectDef = {
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    if (self) g.addCounters(self, 1);
  },
};
card('Flourishing Flora', {
  augmentText: [{
    type: 'triggered', events: ['spawned'],
    label: 'put a +1/+1 counter on me',
    when: (g, self, ev) =>
      ev.data?.seat === self.controller &&
      ev.data?.unit !== self.id,
    effect: floraGrow,
  }],
});
