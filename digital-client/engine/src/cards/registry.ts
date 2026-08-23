/* The M1 card pool: behavior definitions over the printed data extracted from
 * AlgomancyCards-OracleText.json. Printed text is quoted in comments for
 * review; costs/stats/types/attrs all come from printed.json.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 * A card's [Switch]-marked effect goes in graftEffect (what it contributes
 * when grafted under a host); if the marker sits on the card's own triggered/
 * activated ability, that ability is a graft cause (graftCause: true).
 */
import type { EngineEvent, Entity, Seat } from '../types.ts';
import {
  allCardNames, card, getCard, registerAlias, registerSynthetic, unitRestrict,
  type EffectCtx, type EffectDef,
} from './dsl.ts';
import { isEnt, selfOf } from './sets/helpers.ts';
import type { E } from '../engine.ts';

// ── shared effect primitives ─────────────────────────────────────────

const createFireball1: EffectDef = {
  creates: ['Fireball'],
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
        const self = selfOf(g, ctx);
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
  creates: ['Fireball'],
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
      if (isEnt(t)) g.addTemp(t, -2, -2);
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
    if (isEnt(t)) g.destroy(t, 'is deleted');
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
// position)" — the Ambush battle mode is live (apply.ts doAmbush reads the
// printed `ambush` cost/mana); no behavior beyond the mode + piercing body.
card('Good Whale', {});

// "When I attack or block, [Switch1] I deal damage to each player equal to
// the number of cards in their hand." — R1: the amounts are computed at
// RESOLUTION (hand counts read live), the condition fired at event time.
const tidewraithEffect: EffectDef = {
  run: (g, ctx) => {
    const hits = g.s.regions[ctx.region]!.presentSeats
      .map(seat => ({ target: { player: seat as Seat }, n: g.player(seat).hand.length }))
      .filter(h => h.n > 0);
    if (!hits.length) { g.ev('info', 'Astral Tidewraith: every player here is empty-handed — no damage.'); return; }
    g.dealEffectDamageAll(ctx, hits);   // R80: "each player" is one batch
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
    const units = g.unitsIn(ctx.region);
    if (!units.length) { g.ev('info', `${ctx.sourceName}: there is no unit here to damage.`); return; }
    g.dealEffectDamageAll(ctx, units.map(u => ({ target: u, n: 1 })));   // R80: one batch
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
  creates: ['Unit Token'],
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
  creates: ['Fireball'],
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
      creates: ['Unit Token'],
      run: (g, ctx) => {
        const x = (ctx.event?.data?.n as number | undefined) ?? 0;
        if (x > 0) g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [x, x] });
      },
    },
  }],
});

// "When I attack, block, or die, [Switch1] Create two Wisps."
const twoWisps: EffectDef = {
  creates: ['Wisp'],
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
  creates: ['Wisp'],
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
  creates: ['Robot'],
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
//
// R62: this self-sacrifice is the ONE ability the Wisp has, which is what lets
// Infernal Wispweaver's "your wisps … do not sacrifice themselves after
// combat" be an exact implementation rather than an approximation — its static
// carries `suppressAbilities`, and switching off the Wisp's ability layer and
// switching off this line are the same statement. If the Wisp ever gains a
// second ability, that equivalence breaks and the Wispweaver needs a narrower
// seam (see batch-fire-a.ts).
card('Wisp', {
  abilities: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'sacrifice me (after combat)',
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) { g.ev('info', 'Wisp: it is already gone — nothing to sacrifice.'); return; }
        g.destroy(self, 'is sacrificed');
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
  virus: false, burst: false, augmentAttrs: [], text: '',
  image: 'Generic-Unit.jpg',   // the box's generic-unit token card
}, {});

// R101 — "Beyond, Codex Incarnate", the TRANSFORM BACK FACE of Scholar of the
// Void. Playtest ledger #24 (ZQPC, 2026-08-20) sat blocked for two days on the
// plain fact that this card existed in NO data we hold: not the 534-card
// oracle file (which names it only inside Scholar's own text), not the corpus,
// not the rulings export. The owner supplied the face on 2026-08-22 and it is
// transcribed here from the card image:
//
//   "Beyond, Codex Incarnate — cost 0, 8/3, Book Token Unit
//    If you would take damage from rot, put that many -1/-1 counters on target
//    unit instead.
//    Your units are {g}inverted. {i}(Reverse their stat changes.)"
//
// WHY registerSynthetic AND NOT printed.json. printed.json is REGENERATED from
// scripts/pool.mjs over the oracle file; a hand-added row there is silently
// dropped on the next regeneration, which is exactly the kind of quiet lie the
// card ledger exists to stop. This card is not in the oracle pool — the owner:
// "can't be played cause it's on the back of a card" — so it is a synthetic,
// beside the Unit Token above.
//
// The FIELDS, each a decision rather than a copy:
//  · `kind: 'unit'`     — what stands in play after the transform is a unit
//    body. (Not 'spellToken': it has stats, it blocks, it dies.)
//  · `cost: ''`, `mana: 0` — the face prints a bare 0 with no affinity pip.
//  · NO `factions`. Scholar is dd/dark and it is tempting to inherit that, but
//    factions are read OFF THE COST PIPS and this face prints none. Nothing
//    mechanical consumes the field for this card either — it is never in a
//    deck (DECK_LIST), never drafted (draftDeckList filters DECK_LIST), never
//    paid for, and no UI code reads `factions` at all. Inventing a pip to make
//    the client tint it purple would be inventing printed data. Left absent,
//    like the Unit Token's.
//  · `timing: 'deploy'` — INERT. `timing` says when a card may be PLAYED and
//    this one is never played; 'deploy' is the neutral value the other
//    synthetic uses. It is deliberately NOT Scholar's 'haste': the thing that
//    transforms is already in play, so haste has nothing to time.
//  · `type: 'Book Token Unit'` — transcribed verbatim, and MECHANICALLY
//    LOAD-BEARING in two places that both come free from the word "Token":
//    DECK_LIST's `!/Token/.test(c.type)` filter keeps it out of every deck,
//    every draft pool and the card browser; and ui/inspect's `tokenOnlyName`
//    identifies it as a token in the erased pile by the same type line.
//    (The ENTITY-level consequence — a token that dies is erased rather than
//    binned — rides on `Entity.token`, which the transform sets; see
//    batch-dark-c.ts's Scholar for why.)
registerSynthetic({
  name: 'Beyond, Codex Incarnate', cost: '', mana: 0, power: 8, toughness: 3,
  type: 'Book Token Unit', kind: 'unit', timing: 'deploy', attrs: [],
  virus: false, burst: false, augmentAttrs: [],
  text: 'If you would take damage from rot, put that many -1/-1 counters on target unit '
    + 'instead. Your units are {g}inverted. {i}(Reverse their stat changes.)',
  image: 'Beyond-Codex-Incarnate.jpg',
}, {
  // ── "Your units are {g}inverted." ───────────────────────────────────
  //
  // Implementable as of R93, which shipped {Inverted} as stat layer 5
  // ("p = 2·baseP − p" — negate the accumulated delta from base). Before that
  // this clause had nowhere to land; now it is a plain attribute grant and
  // needs no new machinery at all.
  //
  // Region scoping (R12) is FREE and is not written here on purpose:
  // `E.staticsFor` already filters the anchored() walk to
  // `anchor.region === target.region`, so "your units" can never reach a unit
  // in another region. Ownership is the half that lives on the card, which is
  // the division StaticMod's docstring describes.
  //
  // The `target.kind === 'unit'` guard is not decoration: `staticsFor` is also
  // asked about SPELL TOKENS (E.spellTokenSurvivesRegroup), and "your units"
  // does not mean your Fireballs. StaticMod's own docstring flags exactly this
  // trap.
  //
  // Beyond is one of "your units", so it grants {Inverted} to ITSELF. That is
  // correct and harmless as printed: an 8/3 with no modifiers inverts to an
  // 8/3, because layer 5 negates the DELTA from base and the delta is zero.
  statics: [{
    affects: (_g, self, target) => target.kind === 'unit' && target.controller === self.controller,
    attrs: ['Inverted'],
  }],
  // ── "If you would take damage from rot, put that many -1/-1 counters on
  //    TARGET unit instead." ───────────────────────────────────────────
  //
  // LIVE as of R102. It was PARKED in R101 behind a park note that concluded a
  // brand-new `Suspension` variant was needed, because `replaceRotDamage` is
  // `(g, self, seat, amount) => boolean` — no `EffectCtx`, no `ctx.choose` —
  // and `E.rotDamage()` is called straight out of `startDeployment()` with
  // nothing on the stack. Every word of that is still true. What the note got
  // wrong was the conclusion.
  //
  // THE OWNER RULED, 2026-08-22, verbatim:
  //   "In Deployment, you're in your own region, alone. So you can only target
  //    your own units. It would trigger, ask you what you want to target, then
  //    put the -1/-1 counters on during deployment (which still has and uses a
  //    stack). But since Beyond gives all your units inverted, no one would die
  //    of course."
  //
  // "It would TRIGGER" is the whole design. The replacement does not have to
  // finish inside the hook: it puts a TRIGGERED EFFECT on the stack, and the
  // R67 machinery that already exists does the asking — fireEvent →
  // queueTrigger → processTriggerQueue → collectTargets → commitItem. The one
  // piece that was missing is the event to hang the trigger on, so R102 adds
  // it: `E.replaceRotDamage` fires 'rotReplaced' the moment a hook returns
  // true, inside rotDamage()'s own settle() window. No new Suspension variant,
  // no new decision seam, no engine special-casing of this card.
  //
  // The three rejected shortcuts in R101's note (hardcode "me", auto-pick the
  // forced candidate, pick a deterministic enemy) stay rejected — the printed
  // word is "target", which is the game's word for "you choose", and now it
  // really does.
  //
  // THE PIECES, each a decision:
  //
  //  · THE HOOK returns TRUE and does nothing else. The damage IS replaced
  //    — that is what "instead" means — and it is replaced BEFORE anything is
  //    queued, let alone resolved. So a queued effect that later fizzles for
  //    want of a target does not resurrect the damage: nobody takes it either
  //    way. That is the same direction R98 settled for combat ("a REPLACED hit
  //    still counts as dealt") and R86 for a fizzle, and it is the only
  //    ordering the hook's boolean signature can express.
  //
  //  · THE CHOOSER is Beyond's controller, for free: `queueTrigger` sets the
  //    pending trigger's `controller` from the host entity, and the host is
  //    Beyond. In deployment that is also the player who would have taken the
  //    rot — `E.replaceRotDamage` only asks hooks whose anchor
  //    `a.controller === seat` — so the two readings coincide, exactly as the
  //    owner said.
  //
  //  · THE TARGET is `what: 'unit'` with an R64 `restrict` narrowing it to the
  //    controller's own units, and NOT `what: 'allyUnit'`. Both express the
  //    ruling; the restrict is the one that can be printed. The card says
  //    "target unit", and test/68-target-conformance's "every target kind a
  //    card declares is named by its printed text" reads the phrase the way a
  //    player does: 'allyUnit' is the kind for text that prints "target ally",
  //    and this text does not. So the KIND stays the kind the card names and
  //    the owner's ruling lands where R64 put restrictions — in the predicate
  //    that decides which candidates are legal. It is a real rule and not an
  //    accident of the board: the region-scoped candidate list (R12) would
  //    happen to hold only your units during deployment, and relying on that
  //    would be relying on a coincidence.
  //
  //  · NO LEGAL TARGET cannot actually happen, and is handled anyway. R67
  //    says a mandatory target with no candidate makes a CAST illegal, but
  //    this is not a cast — the trigger is already firing, so `collectTargets`
  //    takes the other branch it has always had: it logs "there is no legal
  //    target for that — it does nothing" and the part is skipped (R86). It is
  //    unreachable because the hook radiates from a UNIT IN PLAY that the
  //    damaged seat controls, so Beyond itself is always a legal candidate for
  //    its own replacement.
  //
  //  · BOTH SIDES: rot is per-seat and `E.rotDamage()` walks initiative then
  //    NIT, so two Beyonds (one each) each fire their own 'rotReplaced' with
  //    their own anchor and queue their own trigger under their own
  //    controller. Ordering is `processTriggerQueue`'s existing determinism,
  //    and within one seat `E.replaceRotDamage` already sorts holders by
  //    entity id (R62 precedent).
  //
  // And the owner's closing observation is a real consequence, not a joke:
  // Beyond grants {Inverted} to your units (the clause above), and R93's layer
  // 5 negates the accumulated delta from base — so a -1/-1 counter on one of
  // YOUR units reads as +1/+1. Your own rot makes your board BIGGER.
  abilities: [{
    type: 'triggered', events: ['rotReplaced'], self: true,
    label: 'put that many -1/-1 counters on target unit',
    effect: {
      // R64: the printed kind, with the owner's ruling as the restriction.
      // `ctx.ally` is the effect's controller — Beyond's controller.
      targets: {
        what: 'unit',
        prompt: 'Beyond, Codex Incarnate: put that many -1/-1 counters on target unit',
        restrict: unitRestrict((_g, u, ctx) => u.controller === ctx.ally),
      },
      run: (g, ctx) => {
        // R1: the AMOUNT is the rot that was actually replaced, read off the
        // event snapshot rather than recomputed — `E.rot(seat)` at resolution
        // would be the same number today and a lie the first time anything
        // changes rot in between.
        const n = (ctx.event?.data?.['n'] as number | undefined) ?? 0;
        const t = ctx.targets[0];
        if (!t || !isEnt(t) || !g.entity(t.id)) {
          g.ev('info', 'Beyond, Codex Incarnate: the target is gone — no counters. '
            + 'The rot damage was replaced all the same, so nobody takes it.');
          return;
        }
        if (n <= 0) {
          g.ev('info', 'Beyond, Codex Incarnate: there was no rot damage to replace — no counters.');
          return;
        }
        g.addCounters(t, -n);
      },
    },
  }],
  // The hook itself: consume the damage and say nothing. `E.replaceRotDamage`
  // writes the log line and fires 'rotReplaced', which is what the ability
  // above listens for — duplicating either here would double-log a single
  // replacement.
  replaceRotDamage: () => true,
});

/**
 * R101 — the transform table: printed card → the face on its back.
 *
 * DECLARATIVE, and in the registry rather than in either consumer, for the
 * same reason `EffectDef.creates` is declarative (R69): the inspector used to
 * scrape printed text for a card NAME and that was wrong three ways at once.
 * Scholar's text does name "Beyond, Codex Incarnate" in a scannable sentence,
 * so the scrape would even work today — and it would break the first time a
 * transform is GRANTED, or worded "transform me into my back face", or names
 * a card whose name is a substring of another. One declaration, two readers:
 * `batch-dark-c.ts` (the transform itself) and `ui/inspect.ts` (the row the
 * owner asked for).
 *
 * ONE-DIRECTIONAL on purpose. Beyond is not listed as transforming back into
 * Scholar: nothing on either face prints that, and a transformed unit that
 * silently flipped back would be an invented rule (see batch-dark-c.ts).
 *
 * Keyed and valued by registered card name; `71-card-ledger.test.ts`-style
 * resolution is not needed because `transformsInto` is only ever asked about a
 * name that came off a live entity or the registry.
 */
const TRANSFORM_BACK_FACES: ReadonlyMap<string, string> = new Map([
  ['Scholar of the Void', 'Beyond, Codex Incarnate'],
]);

/** The card `name` transforms into, or undefined if it has no back face. */
export function transformsInto(name: string): string | undefined {
  return TRANSFORM_BACK_FACES.get(name);
}

/** Every printed card that has a transform back face (for conformance sweeps). */
export function transformingCardNames(): string[] {
  return [...TRANSFORM_BACK_FACES.keys()];
}

// R71 — the Wraith token (retired name: "Wight"), REDESIGNED 2026-08-21. The
// printed card is in the oracle pool like every other token card (Wisp,
// Fireball, Poison), so stats/type/text/art are extracted, never hand-copied,
// and only behaviour lives here:
//
//   "Wraith — cost 0 [d], 3/3, Blight Zombie Token Unit"
//    [Augment] At the start of deployment, put a -1/-1 counter on an ally.
//              When I die, Augment a Wraith onto an ally.
//
// Both lines sit under ONE text-box [Augment], so both TRANSFER to the host
// when a Wraith is applied as an augment mod, and both are live on a Wraith
// BODY standing in play (R55: a card's own [Augment] text is live when it is
// played normally). A Wraith body carrying a Wraith mod therefore has the text
// twice and does it twice — two copies, two firings.
//
// Neither line prints the word "target", so neither picks a target (R71): the
// ally is chosen ON RESOLUTION with a plain ctx.choose. It cannot be redirected,
// "when I become targeted" never fires for it, and it cannot fizzle for want of
// a legal ally — it just does nothing. This is a deliberate exception to R67
// ("targets are chosen at cast") and is an exception PRECISELY because the word
// "target" is absent; do not "fix" it by adding a TargetSpec.
//
// Both engine entry points (E.createWraith / E.augmentWraith) produce this one
// card: "create a Wraith" spawns the body, "Augment a Wraith onto a unit"
// applies one directly as a mod. They stay a pair under the redesign — the
// death trigger mints a BRAND-NEW Wraith through augmentWraith(), which is
// correct behaviour now rather than the bug it was once suspected of being.
//
// SETTLED (Bena, 2026-08-21): **"an ally" MAY be the Wraith or its host
// ITSELF — a unit is its own ally.** The engine already did this and keeps
// doing it. The reasoning stands on the record: nothing on the card prints the
// word "another", which is the qualifier the pool uses everywhere else when it
// means "not me" (and is how `TargetSpec`'s `allyUnit` already behaves); it is
// the only reading under which a LONE Wraith's deployment line has a candidate
// at all, instead of being dead text on the commonest board state the card
// produces; and it is continuous with the retired printing, which shrank
// itself. `docs/08-light-and-dark.md`'s "it does not shrink itself" was read
// as the contrary evidence — it describes the printed text's move from "on me"
// to "on an ally", not a prohibition on picking yourself.

/** the allies "an ally" may be chosen from: units the carrier's controller
 * controls, in the carrier's own region (R12 — other regions do not exist).
 * The carrier itself is INCLUDED — a unit is its own ally (see the note
 * above; Bena's ruling, 2026-08-21). */
const wraithAllies = (g: E, ctx: EffectCtx): Entity[] => {
  const self = selfOf(g, ctx);
  return g.unitsOf(ctx.controller, self?.region ?? ctx.region);
};

/** `seat` picks one of `candidates` (auto-picked when there is only one).
 * NOT a target (no "target" printed): chosen here, at resolution. */
const pickAlly = (
  g: E, ctx: EffectCtx, key: string, candidates: Entity[], prompt: string,
): Entity | null => {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0]!;
  const id = ctx.choose(key, {
    kind: 'electricPath', seat: ctx.controller, prompt,
    options: candidates.map(u => ({ label: u.card, value: u.id, card: u.card })),
  }) as number;
  return g.entity(id) ?? null;
};

card('Wraith', {
  augmentText: [
    // "At the start of deployment, put a -1/-1 counter on an ally."
    {
      type: 'triggered', events: ['startOfDeployment'],
      label: 'put a -1/-1 counter on an ally',
      effect: {
        run: (g, ctx) => {
          const ally = pickAlly(g, ctx, 'wraithShrink', wraithAllies(g, ctx),
            'Wraith: put a -1/-1 counter on an ally');
          if (!ally) { g.ev('info', 'Wraith: there is no ally to put a -1/-1 counter on.'); return; }
          g.addCounters(ally, -1);
        },
      },
    },
    // "When I die, Augment a Wraith onto an ally." — the dying Wraith is NOT
    // re-homed (it is erased like any other token, R69); this mints a FRESH
    // Wraith mod. `self: true`, so a Wraith body fires for its own death and a
    // donated copy fires for its host's death, never for a bystander's.
    {
      type: 'triggered', events: ['died'], self: true,
      label: 'Augment a Wraith onto an ally',
      effect: {
        creates: ['Wraith'],
        run: (g, ctx) => {
          const ally = pickAlly(g, ctx, 'wraithAugment', wraithAllies(g, ctx),
            'Wraith: Augment a Wraith onto an ally');
          if (!ally) { g.ev('info', 'Wraith: there is no ally to Augment a Wraith onto.'); return; }
          g.augmentWraith(ally, ctx.controller);
        },
      },
    },
  ],
});

// R47/R71: the token was renamed Wight -> Wraith. Six cards already say
// "Wraith"; `Blight's End` still carries the retired name. One card, two
// printed names.
registerAlias('Wight', 'Wraith');

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

/** Every EffectDef a card owns, wherever it lives — its spell effect, the
 * [Switch] half that transfers on a graft, each activated/triggered ability,
 * and each text-box [Augment] ability it donates to a host. */
export function effectsOf(name: string): EffectDef[] {
  const c = getCard(name);
  const out: EffectDef[] = [];
  if (c.spellEffect) out.push(c.spellEffect);
  if (c.graftEffect) out.push(c.graftEffect.effect);
  for (const a of c.abilities ?? []) out.push(a.effect);
  for (const a of c.augmentText ?? []) out.push(a.effect);
  return out;
}

/** R69: the tokens a card can put onto the board, unioned over every effect it
 * owns and DECLARED (EffectDef.creates) rather than scraped out of the printed
 * text. `npm test`'s conformance pass records what the effects actually spawn
 * and fails if a card creates a token it never declared, so this stays true
 * without anyone maintaining a list. */
export function createsOf(name: string): string[] {
  const out: string[] = [];
  for (const e of effectsOf(name)) {
    for (const t of e.creates ?? []) if (!out.includes(t)) out.push(t);
  }
  return out;
}
