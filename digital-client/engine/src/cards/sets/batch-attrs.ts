/* batch-attrs — the combat-attribute batch: five [Augment] vanilla units that
 * carry new attributes (Powerful / Vulnerable / Thieving / Resonant / Poisonous),
 * the two counter-placing spell tokens (Poison / Crystal), and the cards that
 * make or use them. Engine support for the attributes lives in engine.ts
 * (combatSubStep + dealEffectDamage). See docs/digital-rules R23-R24 (proposed).
 *
 * Owned by one card-scripting agent; see sets/index.ts for ordering rules.
 */
import { card, type EffectDef } from '../dsl.ts';
import { isEnt } from './helpers.ts';

// ── vanilla [Augment] attribute units ────────────────────────────────
// Type-line [Augment] grants the attribute when they augment a host; the
// attribute is also live on the card played normally (printed.attrs). No
// behavior beyond the printed data — the engine reads the attrs directly.

// "[Augment] {Powerful} Insect {Virus} Unit" — 1/2, deals double combat damage
card('Chitin Shredder', {});

// "[Augment] {Vulnerable} Ancient Rock {Virus} Unit" — 3/8, receives double damage
card('Crumbling Ancient', {});

// "[Augment] {Thieving} Frog {Virus} Unit" — 2/3, combat damage to a player → draw
card('Slink', {});

// "[Augment] {Resonant} Anima Unit" — 2/4, damage to a unit also hits its controller
card('Resonant Form', {});

// "[Augment] {Poisonous} {Swift} Blight Fungus Unit" — 2/2, damage dealt as -1/-1 counters
card('Noxious Sporefiend', {});

// ── counter-placing spell tokens (modelled on the Fireball token) ────

// "{Battle} {Burst} Spell Token — Put X -1/-1 counters on target unit."
card('Poison', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Poison: put X -1/-1 counters on target unit' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (isEnt(t)) g.addCounters(t, -(ctx.x ?? 0));
    },
  },
});

// "{Battle} {Burst} Spell Token — Put X +1/+1 counters on target unit."
card('Crystal', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Crystal: put X +1/+1 counters on target unit' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (isEnt(t)) g.addCounters(t, ctx.x ?? 0);
    },
  },
});

// ── token makers ─────────────────────────────────────────────────────

// "Arcane Blight Spell — [Switch1] Create three Poison 1."
const threePoisons: EffectDef = {
  creates: ['Poison'],
  run: (g, ctx) => { for (let i = 0; i < 3; i++) g.createSpellToken(ctx.controller, 'Poison', 1, ctx.region); },
};
card('Biotoxicity', {
  spellEffect: threePoisons,
  graftEffect: { bounded: true, effect: threePoisons },
});

// "Crystal Rock Unit — When I spawn or die, [Switch] Create a Crystal 1."
const createCrystal1: EffectDef = {
  creates: ['Crystal'],
  run: (g, ctx) => { g.createSpellToken(ctx.controller, 'Crystal', 1, ctx.region); },
};
card('Geode', {
  abilities: [{
    type: 'triggered', events: ['spawned', 'died'], self: true,
    label: 'Create a Crystal 1', graftCause: true,
    effect: createCrystal1,
  }],
  graftEffect: { bounded: false, effect: createCrystal1 },
});

// ── counter-placing spell ────────────────────────────────────────────

// "{Battle} Mystic Elemental Spell — Put a +1/+1 counter on target unit for
// each of your [e]." Amount = earth affinity read at RESOLUTION (R1, like
// All-Consuming Blaze). {Battle}: only playable during battle.
card('Accumulated Nucleation', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Accumulated Nucleation: +1/+1 counter per your earth affinity' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (isEnt(t)) g.addCounters(t, g.affinity(ctx.controller, 'earth'));
    },
  },
});
