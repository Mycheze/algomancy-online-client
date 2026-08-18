/* Card registry — the prototype of the "declarative definitions over effect
 * primitives" pattern from docs/04-architecture-spec.md §5.
 *
 * Each entry: printed data (from AlgomancyCards-OracleText.json, hand-copied
 * here so the prototype runs standalone) + a behavior block. In the real
 * project, printed data is pulled from the JSON at build time and only
 * `behavior` is authored.
 *
 * Behavior vocabulary used by engine.js:
 *   kind:     'unit' | 'spell' | 'spellUnit'
 *   timing:   'deploy' (default) | 'battle' (only during battle) | 'both'
 *   attrs:    combat attributes on the card itself (shared within a column)
 *   augment:  what this card grants when slid under a host as a mod
 *             { attrs: [...], abilities: [...] }  (stats never transfer)
 *   virus:    true = may be played as an augment from hand during battle (on the stack)
 *   effect:   spell effect { targets?, run(g, ctx) } — ctx.targets are resolved entities
 *   triggers: [{ event, when?(g,u,ctx), bounded?, effect: {targets?, run} , label }]
 *             `bounded` = [Switch1]-style once per turn.
 */

const EL = { r: 'fire', b: 'water', e: 'earth', g: 'wood', m: 'metal' };

const CARDS = {
  // ───────────────────────────── FIRE ─────────────────────────────
  'Ignis Sprite': {
    cost: 'r', mana: 1, stats: [1, 1], type: 'Infernal Sprite Unit', kind: 'unit',
    text: 'When I spawn or die, [graft] Create a Fireball 1.',
    triggers: [{
      event: 'spawnOrDie', self: true, label: 'Create a Fireball 1',
      effect: { run: (g, ctx) => g.createSpellToken(ctx.controller, 'Fireball', 1) },
    }],
  },

  'Rune Channeler': {
    cost: 'rr', mana: 3, stats: [4, 3], type: 'Arcane Unit', kind: 'unit',
    text: 'When you play a nontoken spell, [graft, once/turn] I deal 2 damage to any target.',
    triggers: [{
      event: 'spellPlayed', bounded: true, label: 'Rune Channeler: deal 2 damage',
      when: (g, u, ctx) => ctx.controller === u.controller && !ctx.token,
      effect: {
        targets: { type: 'any', count: 1, prompt: 'Rune Channeler deals 2 damage to any target' },
        run: (g, ctx) => g.dealEffectDamage(ctx.source, ctx.targets[0], 2),
      },
    }],
  },

  'Mischievous Reclaimer': {
    cost: 'rr', mana: 2, stats: [2, 2], type: 'Occult Demon Unit', kind: 'unit',
    text: 'When the second ally dies in this battle, [graft, once/turn] Draw a card.',
    triggers: [{
      event: 'allyDied', bounded: true, label: 'Mischievous Reclaimer: draw a card',
      when: (g, u, ctx) => ctx.owner === u.controller && g.battleCounter(u.controller, 'allyDeaths') === 2,
      effect: { run: (g, ctx) => g.draw(ctx.controller, 1) },
    }],
  },

  'Ephemeral Skywalker': {
    cost: 'r', mana: 2, stats: [3, 1], type: '[Augment] {Flying} Cloud Sprite Unit', kind: 'unit',
    text: 'Flying. (Only flying units can block flying units.) Can augment: grants Flying.',
    attrs: ['Flying'],
    augment: { attrs: ['Flying'] },
  },

  'Smouldering Inferno': {
    cost: 'r', mana: 2, stats: [7, 1], type: '{Piercing} Infernal Elemental {Virus} Unit', kind: 'unit',
    text: 'Piercing. Virus. [Augment] After combat, sacrifice me.',
    attrs: ['Piercing'],
    virus: true,
    augment: { attrs: ['Piercing'], abilities: ['afterCombatSacrifice'] },
    triggers: [{
      event: 'afterCombat', self: true, label: 'Smouldering Inferno: sacrifice me',
      effect: { run: (g, ctx) => g.sacrifice(ctx.source) },
    }],
  },

  'Luminous Arc': {
    cost: 'r', mana: 2, stats: [1, 3], type: '{Battle} Elemental Spell', kind: 'spell', timing: 'battle',
    text: 'I deal 6 damage to target unit.',
    effect: {
      targets: { type: 'unit', count: 1, prompt: 'Luminous Arc deals 6 damage to target unit' },
      run: (g, ctx) => g.dealEffectDamage(ctx.source, ctx.targets[0], 6),
    },
  },

  'Flame of History': {
    cost: 'r', mana: 1, stats: [2, 3], type: '{Battle} {Reaping} Arcane Spell', kind: 'spell', timing: 'battle',
    text: 'Reaping. I deal 1 damage to any target. (Reaping: when I kill a unit, draw a card.)',
    attrs: ['Reaping'],
    effect: {
      targets: { type: 'any', count: 1, prompt: 'Flame of History deals 1 damage to any target' },
      run: (g, ctx) => g.dealEffectDamage(ctx.source, ctx.targets[0], 1, { reaping: true, controller: ctx.controller }),
    },
  },

  'All-Consuming Blaze': {
    cost: 'r', mana: 2, stats: [3, 3], type: '{Battle} Elemental Spell', kind: 'spell', timing: 'battle',
    text: 'I deal damage to any target equal to your fire affinity.',
    effect: {
      targets: { type: 'any', count: 1, prompt: 'All-Consuming Blaze: damage = your fire affinity' },
      run: (g, ctx) => g.dealEffectDamage(ctx.source, ctx.targets[0], g.affinity(ctx.controller, 'fire')),
    },
  },

  'Flame Juggle': {
    cost: 'r', mana: 2, stats: [3, 3], type: 'Elemental Spell', kind: 'spell', timing: 'deploy',
    text: '[graft, once/turn] Create three Fireball 1.',
    effect: {
      run: (g, ctx) => { for (let i = 0; i < 3; i++) g.createSpellToken(ctx.controller, 'Fireball', 1); },
    },
  },

  // ──────────────────────────── WATER ─────────────────────────────
  'Lonely Forager': {
    cost: 'b', mana: 3, stats: [3, 1], type: 'Mystic Axolotl Spell Unit', kind: 'spellUnit', timing: 'deploy',
    text: 'Draw a card. (Spell Unit: on resolution I spawn as a unit; if negated I never spawn.)',
    effect: { run: (g, ctx) => g.draw(ctx.controller, 1) },
  },

  'Jelly': {
    cost: 'b', mana: 3, stats: [2, 1], type: '{Battle} Jellyfish Spell Unit', kind: 'spellUnit', timing: 'battle',
    text: 'Target unit gains -2/-2 until regroup.',
    effect: {
      targets: { type: 'unit', count: 1, prompt: 'Jelly: target unit gains -2/-2 until regroup' },
      run: (g, ctx) => g.addTempMod(ctx.targets[0], -2, -2),
    },
  },

  'Curio Drifter': {
    cost: 'b', mana: 1, stats: [2, 2], type: '[Augment] {Evasive} Cosmic Sprite Unit', kind: 'unit',
    text: 'Evasive. (Requires two blockers.) Can augment: grants Evasive.',
    attrs: ['Evasive'],
    augment: { attrs: ['Evasive'] },
  },

  'Leaping Lillik': {
    cost: 'bb', mana: 5, stats: [5, 3], type: '{Battle} Beast Horror Spell Unit', kind: 'spellUnit', timing: 'battle',
    text: '[graft, once/turn] Delete target unit. (Delete: put into bin — counts as a death.)',
    effect: {
      targets: { type: 'unit', count: 1, prompt: 'Leaping Lillik: delete target unit' },
      run: (g, ctx) => g.deleteUnit(ctx.targets[0]),
    },
  },

  'Dreadwave Devourer': {
    cost: 'bb', mana: 6, stats: [6, 4], type: '{Battle} Jellyfish Horror Spell Unit', kind: 'spellUnit', timing: 'battle',
    text: 'Negate target spell effect. (And I spawn as a 6/4 on resolution.)',
    effect: {
      targets: { type: 'stackSpell', count: 1, prompt: 'Dreadwave Devourer: negate target spell effect' },
      run: (g, ctx) => g.negate(ctx.targets[0]),
    },
  },

  'Good Whale': {
    cost: 'b', mana: 6, stats: [7, 5], type: '{Piercing} Whale Unit', kind: 'unit',
    text: 'Piercing. (Excess combat damage from piercing sources is dealt to the recipient\'s controller.) [Ambush mode not implemented in prototype.]',
    attrs: ['Piercing'],
  },

  // ─────────────────────────── TOKENS ─────────────────────────────
  'Fireball': {
    cost: '', mana: 0, stats: [0, 0], type: '{Battle} {Burst} Elemental Spell Token', kind: 'spellToken',
    text: 'I deal X damage to any target. (Erased at regroup.)',
    effect: {
      targets: { type: 'any', count: 1, prompt: 'Fireball deals X damage to any target' },
      run: (g, ctx) => g.dealEffectDamage(ctx.source, ctx.targets[0], ctx.x),
    },
  },
};

// deck list: 2 copies of each real card (tokens excluded) = 30-card shared deck
const DECK_LIST = Object.keys(CARDS).filter(n => CARDS[n].kind !== 'spellToken');

function artFile(name) { return name.replace(/ /g, '-') + '.jpg'; }
function affinityPips(cost) {
  const pips = {};
  for (const ch of cost) { const el = EL[ch]; if (el) pips[el] = (pips[el] || 0) + 1; }
  return pips;
}

if (typeof module !== 'undefined') module.exports = { CARDS, DECK_LIST, EL, artFile, affinityPips };
