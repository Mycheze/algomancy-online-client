/* The M1 card pool: behavior definitions over the printed data extracted from
 * AlgomancyCards-OracleText.json. Printed text is quoted in comments for
 * review; costs/stats/types/attrs all come from printed.json.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 * A card's [Switch]-marked effect goes in graftEffect (what it contributes
 * when grafted under a host); if the marker sits on the card's own triggered/
 * activated ability, that ability is a graft cause (graftCause: true).
 */
import type { EngineEvent, Seat } from '../types.ts';
import {
  allCardNames, card, getCard, registerSynthetic,
  type EffectCtx, type EffectDef,
} from './dsl.ts';
import type { E } from '../engine.ts';

// ── shared effect primitives ─────────────────────────────────────────

const createFireball1: EffectDef = {
  run: (g, ctx) => { g.createSpellToken(ctx.controller, 'Fireball', 1, ctx.region); },
};

const dealToAnyTarget = (n: (g: E, ctx: EffectCtx) => number, prompt: string): EffectDef => ({
  targets: { what: 'any', prompt },
  run: (g, ctx) => { g.dealEffectDamage(ctx, ctx.targets[0]!, n(g, ctx)); },
});

// ─────────────────────────────── FIRE ───────────────────────────────

// "When I spawn or die, [Switch] Create a Fireball 1."
card('Ignis Sprite', {
  abilities: [{
    type: 'triggered', events: ['spawned', 'died'], self: true,
    label: 'Create a Fireball 1', graftCause: true,
    effect: createFireball1,
  }],
  graftEffect: { bounded: false, effect: createFireball1 },
});

// "When you play a nontoken spell, [Switch1] I deal 2 damage to any target."
const runeChannelerDeal2 = dealToAnyTarget(() => 2, 'Rune Channeler deals 2 damage to any target');
card('Rune Channeler', {
  abilities: [{
    type: 'triggered', events: ['spellPlayed'], bounded: true, graftCause: true,
    label: 'deal 2 damage to any target',
    when: (g, self, ev) => ev.data?.seat === self.controller && !ev.data?.token,
    effect: runeChannelerDeal2,
  }],
  graftEffect: { bounded: true, effect: runeChannelerDeal2 },
});

// "When the second ally dies in this battle, [Switch1] Draw a card."
const drawOne: EffectDef = { run: (g, ctx) => g.draw(ctx.controller, 1) };
card('Mischievous Reclaimer', {
  abilities: [{
    type: 'triggered', events: ['died'], bounded: true, graftCause: true,
    label: 'draw a card (second ally death this battle)',
    when: (g, self, ev) =>
      g.s.phase === 'battle' &&
      ev.data?.seat === self.controller &&
      ev.data?.region === self.region &&
      g.battleCounter(self.region, `allyDeaths:${self.controller}`) === 2,
    effect: drawOne,
  }],
  graftEffect: { bounded: true, effect: drawOne },
});

// type "[Augment] {Flying} Cloud Sprite Unit" — augmenting grants Flying
card('Ephemeral Skywalker', {});

// "[Augment] After combat, sacrifice me." (text-box augment: only the text
// transfers — NOT Piercing; the prototype wrongly donated the attribute too)
card('Smouldering Inferno', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'sacrifice me (after combat)',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (self) g.destroy(self, 'is sacrificed');
      },
    },
  }],
});

// "I deal 6 damage to target unit."
card('Luminous Arc', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Luminous Arc deals 6 damage to target unit' },
    run: (g, ctx) => { g.dealEffectDamage(ctx, ctx.targets[0]!, 6); },
  },
});

// "{Reaping} … I deal 1 damage to any target." (Reaping: kill → draw)
card('Flame of History', {
  spellEffect: dealToAnyTarget(() => 1, 'Flame of History deals 1 damage to any target'),
});

// "I deal damage to any target equal to your [r]."
card('All-Consuming Blaze', {
  spellEffect: dealToAnyTarget(
    (g, ctx) => g.affinity(ctx.controller, 'fire'),
    'All-Consuming Blaze: damage equal to your fire affinity'),
});

// "[Switch1] Create three Fireball 1."
const threeFireballs: EffectDef = {
  run: (g, ctx) => { for (let i = 0; i < 3; i++) g.createSpellToken(ctx.controller, 'Fireball', 1, ctx.region); },
};
card('Flame Juggle', {
  spellEffect: threeFireballs,
  graftEffect: { bounded: true, effect: threeFireballs },
});

// "Sacrifice me: [Switch] Create a Fireball 1." (the Manual's graft example)
card('Oracle of the Flame', {
  abilities: [{
    type: 'activated', cost: { sacrificeSelf: true },
    label: 'Sacrifice me: Create a Fireball 1', graftCause: true,
    effect: createFireball1,
  }],
  graftEffect: { bounded: false, effect: createFireball1 },
});

// ────────────────────────────── WATER ───────────────────────────────

// "Draw a card." (spell unit)
card('Lonely Forager', {
  spellEffect: drawOne,
});

// "Target unit gains -2/-2 until regroup." (spell unit)
card('Jelly', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Jelly: target unit gains -2/-2 until regroup' },
    run: (g, ctx) => {
      const t = ctx.targets[0]!;
      if ('id' in (t as object)) g.addTemp(t as never, -2, -2);
      g.checkDeaths();
    },
  },
});

// type "[Augment] {Evasive} Cosmic Sprite Unit"
card('Curio Drifter', {});

// "[Switch1] Delete target unit." (spell unit; delete = bin, counts as death)
const deleteUnit: EffectDef = {
  targets: { what: 'unit', prompt: 'Delete target unit' },
  run: (g, ctx) => {
    const t = ctx.targets[0]!;
    if ('id' in (t as object)) g.destroy(t as never, 'is deleted');
  },
};
card('Leaping Lillik', {
  spellEffect: deleteUnit,
  graftEffect: { bounded: true, effect: deleteUnit },
});

// "Negate target spell effect." (spell unit)
card('Dreadwave Devourer', {
  spellEffect: {
    targets: { what: 'stackSpell', prompt: 'Dreadwave Devourer: negate target spell effect' },
    run: (g, ctx) => {
      const t = ctx.targets[0]!;
      if ('stack' in (t as object)) g.negate((t as { stack: number }).stack);
    },
  },
});

// "{Piercing} … [Battle] Ambush [4bb] (Recall target ally, put me into their
// position)" — the Ambush battle mode is NOT implemented in M1 (parked;
// same cut as the prototype). Plays as a vanilla piercing 7/5 in deployment.
card('Good Whale', {});

// "When I attack or block, [Switch1] I deal damage to each player equal to
// the number of cards in their hand." — R1: the amounts are computed at
// RESOLUTION (hand counts read live), the condition fired at event time.
const tidewraithEffect: EffectDef = {
  run: (g, ctx) => {
    for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
      g.dealEffectDamage(ctx, { player: seat as Seat }, g.player(seat).hand.length);
    }
  },
};
card('Astral Tidewraith', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true, bounded: true,
    label: 'deal damage to each player equal to their hand', graftCause: true,
    effect: tidewraithEffect,
  }],
  graftEffect: { bounded: true, effect: tidewraithEffect },
});

// ────────────────────────────── EARTH ───────────────────────────────

// "When I attack or block, [Switch] I deal 1 damage to each unit."
const boulderEffect: EffectDef = {
  run: (g, ctx) => {
    for (const u of g.unitsIn(ctx.region)) g.dealEffectDamage(ctx, u, 1);
  },
};
card('Bellowing Boulder', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    label: 'deal 1 damage to each unit', graftCause: true,
    effect: boulderEffect,
  }],
  graftEffect: { bounded: false, effect: boulderEffect },
});

// type "[Augment] {Swift} Lizard Beast {Virus} Unit" — Swift virus augment
card('Dune Drifter', {});

// "{Electric} … I deal 6 damage to any target." (R4: excess passes along a
// controller-chosen adjacent path)
card('Arc Lightning', {
  spellEffect: dealToAnyTarget(() => 6, 'Arc Lightning deals 6 damage to any target'),
});

// ────────────────────────────── WOOD ────────────────────────────────

// "[Switch1] Create two 1/1 units."
const twoOneOnes: EffectDef = {
  run: (g, ctx) => {
    for (let i = 0; i < 2; i++) {
      g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [1, 1] });
    }
  },
};
card('Accelerated Germination', {
  spellEffect: twoOneOnes,
  graftEffect: { bounded: true, effect: twoOneOnes },
});

// ──────────────────── mechanics batch 2 (M1 finish) ─────────────────

// "[Augment] {Tough} Rock Guardian {Virus} Unit" — 0/4 Tough (defense doubled,
// stat layer 4); type-line [Augment] grants Tough; Virus: playable in battle
card('Rampart Guardian', {});

// "[Augment] {Balanced} Ancient Druid {Virus} Unit" — 2/0 Balanced (power &
// defense become the max of the two, stat layer 4): spawns as a 2/2
card('Child of Aether', {});

// "[Augment] {Deadly} Fish {Virus} Unit" — 1/2 Deadly (any damage kills, R21)
card('Tidepool Terror', {});

// "{Deadly} Spider Crab Unit — [Battle] Ambush [3bb]" — the Ambush mode is
// engine-level (printed.ambush, R22); Deadly is the type-line attr
card('Orblish Horroth', {});

// "[Augment] {Sneaky} Insect Sprite Unit" — 3/2 Sneaky (unblockable when it
// is the only attacking unit, R20)
card('Whispering Mantid', {});

// "{Haste} Elemental Spell — [Switch1] Create a Fireball 3." (haste step, R18)
const fireball3: EffectDef = {
  run: (g, ctx) => { g.createSpellToken(ctx.controller, 'Fireball', 3, ctx.region); },
};
card('Molten Upheaval', {
  spellEffect: fireball3,
  graftEffect: { bounded: true, effect: fireball3 },
});

// "{Haste} Rock Structure Unit — [Augment][once] When I am dealt damage,
// create an X/X unit, where X is the damage I am dealt." X comes from the
// triggering event (R1: the condition and its snapshot are event-time)
card('Awoken Tomb', {
  augmentText: [{
    type: 'triggered', events: ['damage'], self: true, bounded: true,   // [once]
    label: 'create an X/X unit (X = the damage dealt)',
    effect: {
      run: (g, ctx) => {
        const x = (ctx.event?.data?.n as number | undefined) ?? 0;
        if (x > 0) g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [x, x] });
      },
    },
  }],
});

// "When I attack, block, or die, [Switch1] Create two Wisps."
const twoWisps: EffectDef = {
  run: (g, ctx) => {
    for (let i = 0; i < 2; i++) g.spawnUnit(ctx.controller, 'Wisp', ctx.region, { token: true });
  },
};
card('Aberrant Populace', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked', 'died'], self: true,
    bounded: true, graftCause: true,
    label: 'create two Wisps',
    effect: twoWisps,
  }],
  graftEffect: { bounded: true, effect: twoWisps },
});

// "Occult Spell — [Switch1] Create three Wisps."
const threeWisps: EffectDef = {
  run: (g, ctx) => {
    for (let i = 0; i < 3; i++) g.spawnUnit(ctx.controller, 'Wisp', ctx.region, { token: true });
  },
};
card('Spectrogenesis', {
  spellEffect: threeWisps,
  graftEffect: { bounded: true, effect: threeWisps },
});

// "When I spawn or die, [Switch1] Create a Robot 1."
const robot1: EffectDef = {
  run: (g, ctx) => { g.spawnUnit(ctx.controller, 'Robot', ctx.region, { token: true, counters: 1 }); },
};
card('Recyclable Sentinel', {
  abilities: [{
    type: 'triggered', events: ['spawned', 'died'], self: true,
    bounded: true, graftCause: true,
    label: 'create a Robot 1',
    effect: robot1,
  }],
  graftEffect: { bounded: true, effect: robot1 },
});

// ────────────────────────────── TOKENS ──────────────────────────────

// "{Feeble} Spirit Token Unit — After combat, sacrifice me." (0/1, can't block)
card('Wisp', {
  abilities: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'sacrifice me (after combat)',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (self) g.destroy(self, 'is sacrificed');
      },
    },
  }],
});

// "Robot Token Unit — I spawn with X +1/+1 counters on me." (0/0; the X is
// supplied at creation: spawnUnit(..., { token: true, counters: X }))
card('Robot', {});

// "{Battle} {Burst} Spell Token — Deal X damage to any target."
card('Fireball', {
  spellEffect: {
    targets: { what: 'any', prompt: 'Fireball deals X damage to any target' },
    run: (g, ctx) => { g.dealEffectDamage(ctx, ctx.targets[0]!, ctx.x ?? 0); },
  },
});

// generic unit token (Accelerated Germination's 1/1s)
registerSynthetic({
  name: 'Unit Token', cost: '', mana: 0, power: 1, toughness: 1,
  type: 'Unit Token', kind: 'unit', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [], text: '', image: '',
}, {});

// batch modules register themselves on import (side-effect card() calls);
// each owns its own file so parallel card work never collides here
import './sets/index.ts';

/** the shared deck: 2 copies of each real (non-token) pool card, in
 * registration order (deterministic — deck order feeds the seeded shuffle) */
export const DECK_LIST: string[] = allCardNames().filter(n => {
  const c = getCard(n);
  // Resource card faces ("[r] Fire Resource" etc.) are scripted for preview/
  // completeness but are NOT deck cards — without this they leak in as
  // phantom units (found when the fire-a batch registered Fire Resource).
  if (/\bResource\b/.test(c.type)) return false;
  return !/Token/.test(c.type) && (c.kind === 'unit' || c.kind === 'spell' || c.kind === 'spellUnit');
});

/** The live-draft shared deck for a set of elements: every deck card whose
 * factions lie entirely within the set — the chosen monos plus the hybrid
 * pairs among them, ONE copy each (the physical box has one of each card;
 * Manual: "54 <element> cards" per element + 5 per hybrid pair). Registration
 * order, like DECK_LIST, so the seeded shuffle is deterministic. */
export function draftDeckList(elements: string[]): string[] {
  const chosen = new Set(elements);
  return DECK_LIST.filter(n => {
    const f = getCard(n).factions ?? [];
    return f.length > 0 && f.every(el => chosen.has(el));
  });
}
