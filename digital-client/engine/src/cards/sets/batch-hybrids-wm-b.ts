/* batch-hybrids-wm-b — the second wood/metal-involved hybrid batch (fire/wood,
 * water/metal, wood/metal and water/wood duals), scripted over the printed
 * data in printed.json (never hand-copied). Printed text quoted in comments
 * for review.
 *
 * Owned by one card-scripting agent; see sets/index.ts for ordering rules.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R6 (mid-resolution payments/choices via ctx.choose), R9 (bounded
 * [Switch1]/[once] budgets per card), R12/R25 ("each player/opponent" and
 * region-scoped listeners read the event region), R27 ("in my formation"
 * counts are live at resolution), R28 (created UNITS arrive in their
 * controller's HOME region; spell tokens stay at the resolution region),
 * R31 (combat-damage-sub-step triggers resolve immediately).
 *
 * ⚠ ENGINE APPROXIMATIONS shared by this batch:
 *  - RESOLUTION-TIME COSTS (Auric Ascendant's "Recall another ally", and
 *    Abduct's "unless its controller pays [x]" ransom): rider costs on
 *    ACTIVATED abilities / R6 ransoms are still mid-resolution choices —
 *    with nothing to pay, the effect resolves without effect. Volatile
 *    Toxicity's "/[Sacrifice a unit]" is a true CAST COST now (R35).
 *  - X SPELLS (Abduct, Floral Singularity): X is chosen and paid AT CAST
 *    (R35) and stored on the item. Abduct's "with cost [x] or less" target
 *    restriction is still checked at RESOLUTION (TargetSpec cannot read x
 *    at cast time).
 *  - GAIN CONTROL (Abduct, Mindwarp Sporefrog): flipping Entity.controller.
 *    The flipped unit LEAVES any formation it fought in (it fights for
 *    neither side for the rest of the battle) and walks to its new
 *    controller's home at regroup (regroup reads controller). Its owner is
 *    unchanged — recall/death still send the card to the owner's hand/bin.
 *  - ROTSPORE HERALD's "Everything is deadly" is a mod-carried static
 *    granting {Deadly} to every unit in the region (both sides, itself
 *    included). COMBAT reads it (column attrs); EFFECT-damage sources do not
 *    — dealEffectDamage reads the source CARD's printed attrs only, so a
 *    spell/ability source is not deadly-fied (engine limitation).
 *  - TEMPORAL RIFT's "End this battle": every remaining stack item is
 *    negated and cleared (played cards reach the bin exactly as a negated
 *    resolution would bin them), then the battle round ends via the engine's
 *    endBattleRound. "Erase this spell" is approximated as the Rift going to
 *    its controller's bin like any resolved spell — resolution has no
 *    erase-own-card hook (afterParts bins it after the effect runs).
 *  - DEMATERIALIZE's "target effect" = the engine's 'stackSpell' targets
 *    (spells, spell units, spell tokens, ambushes) — triggered/activated
 *    items are not targetable (Frosted Denial precedent). Glimpse 3 is the
 *    batch-water-a approximation: reveal 3, the glimpsing player caches one
 *    TO HAND, the rest recycle to the bottom.
 *  - AETHERCAP SIPHONER "spawns with" its three -1/-1 counters via an
 *    on-spawn self trigger — the counters land immediately after the spawn
 *    event rather than being on the unit as it spawns.
 *  - GALACTIC GERMINATION's "target formation" is proxied by targeting a
 *    UNIT: the formation is the battle grid side (attacking columns or
 *    blocking columns) containing it, counted live at resolution (R27); a
 *    target in no formation creates nothing. The 1/1s arrive HOME (R28).
 *  - FLORAL SINGULARITY's "become base X/X" mode is approximated with
 *    until-regroup temp stats (X - base each way): no base-setting layer
 *    exists, so counters/statics still apply on top (correct) but earlier
 *    temp changes stack additively instead of being overridden.
 *  - "EACH ENEMY" / "each unit" / "all tokens" are region-scoped (R12/R25):
 *    only the event region's units/players are touched.
 *
 * PARKED (needs engine machinery that does not exist yet):
 *  - Invasive Species: "At the start of deployment, recall all your other
 *    units" — NO start-of-deployment event exists (startDeployment fires no
 *    fireEvent; 'endOfTurn' is after deployment and changes who defends the
 *    next battle, so it is not an honest stand-in). Registered with an inert
 *    augmentText entry (Stasis Sentry precedent) so it still plays as a 4/4
 *    and is recognised as an augment.
 */
import type { Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, getCard, type EffectCtx, type EffectDef } from '../dsl.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** True while endTurn() is resolving end-of-turn triggers (batch-fire-a
 * precedent): a ctx.choose suspension in that window strands the game, so
 * choices there auto-resolve deterministically. */
const inEndOfTurn = (g: E): boolean => g.s.phase === 'deploy' && g.s.deployPlayer === null;

/** printed mana of a card name; X counts as 0 (⚠ batch-hybrids-fwe
 * approximation — token units resolve to their 0-cost token cards). */
const manaOf = (name: unknown): number => {
  if (typeof name !== 'string') return 0;
  const m = getCard(name).mana;
  return typeof m === 'number' ? m : 0;
};

/** pick one of `pool` (auto when forced); returns null on an empty pool.
 * Plan-then-commit: callers gather every pick before mutating. */
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

/** ⚠ gain-control approximation (see header): flip controller, leave any
 * formation; regroup then walks the unit to its new controller's home. */
const takeControl = (g: E, u: Entity, seat: Seat): void => {
  if (!g.entity(u.id) || u.controller === seat) return;
  u.controller = seat;
  const b = g.s.battle;
  if (b) {
    for (const col of [...b.columns, ...Object.values(b.blocks)]) {
      const i = col.indexOf(u.id);
      if (i !== -1) col.splice(i, 1);
    }
    const si = b.sentAttackers.indexOf(u.id);
    if (si !== -1) b.sentAttackers.splice(si, 1);
  }
  g.ev('info', `${g.pname(seat)} gains control of ${u.card}.`);
};

/** the battle grid side (attacking columns / blocking columns) containing a
 * unit — the engine's closest thing to that unit's "formation" (R27). */
const formationOf = (g: E, id: EntityId): EntityId[][] | null => {
  const b = g.s.battle;
  if (!b) return null;
  if (b.columns.some(c => c.includes(id))) return b.columns;
  const blk = Object.values(b.blocks);
  if (blk.some(c => c.includes(id))) return blk;
  return null;
};

/** Glimpse N for a seat — ⚠ the batch-water-a approximation (see header). */
function glimpse(g: E, ctx: EffectCtx, seat: Seat, n: number): void {
  const count = Math.min(n, g.deckOf(seat).length);
  if (count <= 0) return;
  const top = g.deckOf(seat).slice(0, count);
  g.ev('info', `${g.pname(seat)} Glimpses ${count}: ${top.join(', ')}.`);
  const pick = ctx.choose('glimpse', {
    kind: 'payOrDecline', seat,
    prompt: `Glimpse ${count}: choose a card to cache (engine: it goes to your hand)`,
    options: top.map((name, i) => ({ label: name, value: i, card: name })),
  }) as number;
  g.deckOf(seat).splice(0, count);
  const keptIdx = top[pick] !== undefined ? pick : 0;
  const kept = top[keptIdx]!;
  g.player(seat).hand.push(kept);
  top.forEach((name, i) => { if (i !== keptIdx) g.recycleToBottom(seat, name); });
  g.ev('info', `${g.pname(seat)} caches ${kept} and recycles the rest.`);
}

// ─────────────────────── FIRE / WOOD (rg) ─────────────────────────────

// "[Augment] After combat, put a -1/-1 counter on each unit, then I deal 2
// damage to each player." — rg/4 3/5 Infernal Fungus Unit. Text-box
// [Augment], live when played normally (Manual Q&A). "Each unit" / "each
// player" are region-scoped (R12/R25): every unit in the battle region gets
// the counter (both sides, the carrier included), then every present player
// takes 2 from me. Counter deaths land before the player damage.
card('Infernal Grovekeeper', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'put a -1/-1 counter on each unit, then I deal 2 damage to each player',
    effect: {
      run: (g, ctx) => {
        for (const u of g.unitsIn(ctx.region).slice()) g.addCounters(u, -1);
        for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
          g.dealEffectDamage(ctx, { player: seat as Seat }, 2);
        }
      },
    },
  }],
});

// "[Augment] Everything is {g}deadly. (Any damage from a deadly source will
// kill a unit.)" — gr/2 2/2 Blight Spider Unit. A mod-carried STATIC
// ([Augment] statics transfer with the card; `augmentable` marks it an
// augment despite granting no type-line attrs): every unit in the region —
// both sides, the holder included — has {Deadly}. ⚠ COMBAT reads it (column
// attrs); effect-damage sources read printed attrs only (see header).
card('Rotspore Herald', {
  augmentable: true,
  statics: [{
    affects: (g, self, t) => t.kind === 'unit',
    attrs: ['Deadly'],
  }],
});

// "[Switch] /[Sacrifice a unit]: Create a Poison X and a Fireball X, where X
// is the defense of the sacrificed unit." — rg/2 4/2 {Battle} Infernal
// Blight Spell. The bracketed sacrifice is a CAST COST (R35): chosen and
// paid before the spell reaches the stack (a grafted rider pays — or
// declines — at composite cast time). X = the sacrificed unit's defense
// SNAPSHOTTED at payment (effStats then); the spell tokens appear at the
// resolution region (R28: spell tokens are battle materiel). Unbounded
// graft ([Switch]).
const toxicityBrew: EffectDef = {
  castCost: { kind: 'sacrificeUnit' },
  run: (g, ctx) => {
    const x = ctx.costPaid?.sacrificed?.defense ?? 0;
    if (x > 0) {
      g.createSpellToken(ctx.controller, 'Poison', x, ctx.region);
      g.createSpellToken(ctx.controller, 'Fireball', x, ctx.region);
    }
  },
};
card('Volatile Toxicity', {
  spellEffect: toxicityBrew,
  graftEffect: { bounded: false, effect: toxicityBrew },
});

// ─────────────────────── WATER / METAL (bm) ───────────────────────────

// "[once] [one], Recall another ally: I gain {g}flying and +2/+0 until
// regroup." — bm/2 2/1 Mystic Avatar Unit. Activated: the mana is a real
// activation cost; the recall is paid at resolution (⚠ header — with no
// other ally the ability resolves without effect). [once] = bounded (R9).
card('Auric Ascendant', {
  abilities: [{
    type: 'activated', cost: { mana: 1 }, bounded: true,   // [once]
    label: '[one], recall another ally: I gain {Flying} and +2/+0 until regroup',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!self) return;
        const pool = g.unitsOf(ctx.controller, ctx.region).filter(u => u.id !== self.id);
        if (!pool.length) {
          g.ev('info', 'Auric Ascendant: no other ally to recall — no effect.');
          return;
        }
        const id = pickUnit(ctx, 'recall', ctx.controller, pool,
          'Auric Ascendant: recall another ally')!;
        const ally = g.entity(id);
        if (!ally) return;
        g.recall(ally);
        const me = g.entity(self.id);
        if (!me) return;
        g.addTempAttr(me, 'Flying');
        g.addTemp(me, 2, 0);
      },
    },
  }],
});

// "Negate target effect. Its controller Glimpses 3." — bm/2 2/1 {Battle}
// Cosmic Technology Spell. ⚠ "target effect" = stack spells/spell units/
// spell tokens/ambushes (header); the Glimpse is the batch-water-a
// approximation. The Glimpse goes to the negated item's controller, whoever
// that is (it can be the caster's own effect).
card('Dematerialize', {
  spellEffect: {
    targets: { what: 'stackSpell', prompt: 'Dematerialize: negate target effect' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('stack' in (t as object))) return;
      const stackId = (t as { stack: number }).stack;
      const it = g.s.stack.find(i => i.id === stackId);
      if (!it) return;
      g.negate(stackId);
      glimpse(g, ctx, it.controller, 3);
    },
  },
});

// "End this battle. Erase this spell. (Negate all effects, this battle is
// over.)" — bmm/4 1/2 {Battle} Temporal Arcane Spell. ⚠ header: every
// remaining stack item is negated and cleared (cards binned as a negated
// resolution would), then endBattleRound() runs — in round 1 with no sent
// counterattackers that cascades straight through round 2 into regroup.
// "Erase this spell" is approximated as the Rift being binned normally.
card('Temporal Rift', {
  spellEffect: {
    run: (g, ctx) => {
      if (!g.s.battle) { g.ev('info', 'Temporal Rift: no battle to end.'); return; }
      for (const it of g.s.stack) {
        g.negate(it.id);
        if (it.card && (it.kind === 'spell' || it.kind === 'spellUnit' || it.kind === 'virus' || it.kind === 'ambush')) {
          g.player(it.controller).bin.push(it.card);
        }
      }
      g.s.stack.length = 0;
      g.ev('info', 'Temporal Rift: all effects are negated — the battle is over.');
      g.endBattleRound();
    },
  },
});

// "[Augment] Whenever another ally spawns during battle, double its /[power
// {i1}or defense] until regroup." — bm/4 5/4 Jellyfish Oracle Unit. Text-box
// [Augment]; "ally" reads from the carrier's side (host perspective when
// donated). The doubled amount is the unit's LIVE effective stat at
// resolution (R1), granted as an until-regroup temp bonus; the carrier's
// controller picks the half (mid-resolution choice).
card('Transmutide Enigma', {
  augmentText: [{
    type: 'triggered', events: ['spawned'],
    label: "double another ally's power or defense until regroup (spawned in battle)",
    when: (g, self, ev) =>
      g.s.phase === 'battle' && ev.data?.seat === self.controller && ev.data?.unit !== self.id,
    effect: {
      run: (g, ctx) => {
        const id = ctx.event?.data?.unit as EntityId | undefined;
        const u = id !== undefined ? g.entity(id) : undefined;
        if (!u) return;
        const [p, t] = g.effStats(u);
        const mode = ctx.choose('mode', {
          kind: 'electricPath', seat: ctx.controller,
          prompt: `Transmutide Enigma: double ${u.card}'s power or defense until regroup?`,
          options: [
            { label: `Double its power (+${p}/+0)`, value: 'power' },
            { label: `Double its defense (+0/+${t})`, value: 'defense' },
          ],
        });
        if (mode === 'power') g.addTemp(u, p, 0);
        else g.addTemp(u, 0, t);
      },
    },
  }],
});

// ─────────────────────── WOOD / METAL (gm) ────────────────────────────

// "Gain control of target unit with cost [x] or less unless its controller
// pays [x]." — gm/X 2/2 {Battle} Alien Spell. X is chosen and paid AT CAST
// (R35). The cost restriction is checked at RESOLUTION (⚠ header — the
// TargetSpec cannot read x at cast time); the ransom is a mid-resolution
// pay-or-decline (R6) for the target's controller, skipped when they cannot
// pay (x more than their open mana). Control flip per the header's
// gain-control approximation.
card('Abduct', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Abduct: gain control of target unit (cost [x] or less)' },
    run: (g, ctx) => {
      const x = ctx.x ?? 0;   // chosen and paid at cast (R35)
      const t = ctx.targets[0];
      if (!t || !('id' in (t as object))) return;
      const u = t as Entity;
      if (manaOf(u.card) > x) {
        g.ev('info', `Abduct: ${u.card} costs more than ${x} — no effect.`);
        return;
      }
      if (u.controller === ctx.controller) return;   // already yours
      const owner = u.controller;
      if (g.openMana(owner) >= x && !inEndOfTurn(g)) {
        const pay = ctx.choose('pay', {
          kind: 'payOrDecline', seat: owner,
          prompt: `Abduct: pay [${x}] to keep ${u.card}?`,
          options: [
            { label: `Pay [${x}] — keep ${u.card}`, value: true },
            { label: `Decline — ${g.pname(ctx.controller)} gains control of ${u.card}`, value: false },
          ],
        });
        if (pay) { g.payMana(owner, x); return; }
      }
      takeControl(g, u, ctx.controller);
    },
  },
});

// "/[Create X 1/1 units {i1}or your units become base X/X until regroup]."
// — ggm/X 2/2 Cosmic Flower Spell (deploy timing). X is chosen and paid AT
// CAST (R35). Modal: the caster picks. Created UNITS arrive in the
// controller's HOME region (R28). "Become base X/X" is the temp-stat
// approximation (header), applied to your units in the resolution region
// (R12).
card('Floral Singularity', {
  spellEffect: {
    run: (g, ctx) => {
      const x = ctx.x ?? 0;   // chosen and paid at cast (R35)
      if (x <= 0) { g.ev('info', 'Floral Singularity: X = 0 — no effect.'); return; }
      const mode = ctx.choose('mode', {
        kind: 'electricPath', seat: ctx.controller,
        prompt: `Floral Singularity: create ${x} 1/1 units, or your units become base ${x}/${x} until regroup?`,
        options: [
          { label: `Create ${x} 1/1 unit token(s)`, value: 'create' },
          { label: `Your units become base ${x}/${x} until regroup`, value: 'base' },
        ],
      });
      if (mode === 'create') {
        for (let i = 0; i < x; i++) {
          g.spawnUnit(ctx.controller, 'Unit Token', g.homeRegion(ctx.controller),
            { token: true, tokenStats: [1, 1] });
        }
        return;
      }
      for (const u of g.unitsOf(ctx.controller, ctx.region).slice()) {
        const c = getCard(u.card);
        const base = u.tokenStats ?? [c.power, c.toughness];
        g.addTemp(u, x - base[0]!, x - base[1]!);
      }
    },
  },
});

// "[Augment] After combat, delete all tokens." — gm/2 2/2 Alien Fungus Unit.
// Text-box [Augment], live when played normally. "All tokens" = every unit
// token AND spell token in the battle region (R12 — other regions don't
// exist). Unit tokens are deleted through destroy() (formation cleanup,
// death bookkeeping — a deleted token is erased, not binned); spell tokens
// are erased directly (they don't "die", so no despawn triggers misfire).
card('Ominous Growth', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'delete all tokens (after combat)',
    effect: {
      run: (g, ctx) => {
        for (const u of g.unitsIn(ctx.region).slice()) {
          if (u.token) g.destroy(u, 'is deleted');
        }
        for (const t of Object.values(g.s.entities)) {
          if (t.kind === 'spellToken' && t.region === ctx.region) {
            delete g.s.entities[t.id];
            g.ev('info', `${t.card} ${t.x ?? ''} is deleted (Ominous Growth).`);
          }
        }
      },
    },
  }],
});

// "[Augment] Whenever a unit token is created, put a -1/-1 counter on me. If
// you do, put +1/+1 counter on that token." — gm/1 2/3 Robot Fungus {Virus}
// Unit. Text-box [Augment]; "me" = the carrier (host perspective when
// donated). ANY player's unit token in my region triggers it (no "your").
// "If you do" — the -1/-1 landing is the condition for the +1/+1: with the
// carrier already gone at resolution neither counter is placed. The {Virus}
// play mode is engine-level.
card('The World Shepherd', {
  augmentText: [{
    type: 'triggered', events: ['spawned'],
    label: 'a unit token is created: a -1/-1 counter on me, then +1/+1 on that token',
    when: (g, self, ev) => {
      const u = ev.data?.unit !== undefined ? g.entity(ev.data.unit as EntityId) : undefined;
      return !!u && !!u.token && u.id !== self.id;
    },
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!self) return;
        g.addCounters(self, -1);   // may kill me — the counter still landed ("you did")
        const tokId = ctx.event?.data?.unit as EntityId | undefined;
        const tok = tokId !== undefined ? g.entity(tokId) : undefined;
        if (tok) g.addCounters(tok, 1);
      },
    },
  }],
});

// "[Switch1] /[Put a -1/-1 counter on each enemy or{i1} put a +1/+1 counter
// on each of your units.]" — gm/3 1/2 {Battle} Arcane Druid Spell. Modal:
// the controller picks a half (mid-resolution choice; ⚠ auto-picks the
// bloom half during end-of-turn resolution — a mandatory modal cannot
// suspend there, Unstable Form precedent). "Each enemy" / "your units" are
// the resolution region's units (R12/R25). Bounded graft ([Switch1], R9).
const witherOrBloom: EffectDef = {
  run: (g, ctx) => {
    const mode = inEndOfTurn(g) ? 'bloom' : ctx.choose('mode', {
      kind: 'electricPath', seat: ctx.controller,
      prompt: 'Wither and Bloom: a -1/-1 counter on each enemy, or a +1/+1 counter on each of your units?',
      options: [
        { label: 'Wither: a -1/-1 counter on each enemy', value: 'wither' },
        { label: 'Bloom: a +1/+1 counter on each of your units', value: 'bloom' },
      ],
    });
    const pool = mode === 'wither'
      ? g.unitsIn(ctx.region).filter(u => u.controller !== ctx.controller)
      : g.unitsOf(ctx.controller, ctx.region);
    for (const u of pool) g.addCounters(u, mode === 'wither' ? -1 : 1);
  },
};
card('Wither and Bloom', {
  spellEffect: witherOrBloom,
  graftEffect: { bounded: true, effect: witherOrBloom },
});

// ─────────────────────── WATER / WOOD (bg) ────────────────────────────

// "I spawn with three -1/-1 counters on me. [Augment] Whenever you play a
// nontoken spell, you may move a counter from me onto another target unit."
// — gb/3 4/4 Cosmic Fungus Blight Unit. The spawn clause is a normal
// on-spawn self trigger (⚠ header: counters land right after the spawn
// event). The [Augment] clause transfers: "me" = the carrier, "you" = its
// controller; "a counter" is one of the NET counters (the engine's signed
// counter model — pairs cancel, Manual), so a -1/-1 moves while net
// negative and a +1/+1 moves while net positive; nothing moves at net 0.
// "May" = a mid-resolution choice with a Decline option.
card('Aethercap Siphoner', {
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true,
    label: 'I spawn with three -1/-1 counters',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (self) g.addCounters(self, -3);
      },
    },
  }],
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'],
    label: 'you may move a counter from me onto another unit (you played a nontoken spell)',
    when: (g, self, ev) => ev.data?.seat === self.controller && ev.data?.token !== true,
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!self || self.counters === 0 || inEndOfTurn(g)) return;
        const delta = self.counters > 0 ? 1 : -1;
        const pool = g.unitsIn(ctx.region).filter(u => u.id !== self.id);
        if (!pool.length) return;
        const pick = ctx.choose('move', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Aethercap Siphoner: move a ${delta > 0 ? '+1/+1' : '-1/-1'} counter onto another unit?`,
          options: [
            ...pool.map(u => ({ label: u.card, value: u.id })),
            { label: 'Decline', value: false },
          ],
        });
        if (pick === false) return;
        const t = g.entity(pick as EntityId);
        if (!t) return;
        g.addCounters(self, -delta);
        g.addCounters(t, delta);
      },
    },
  }],
});

// "Create a 1/1 unit for each unit in target formation." — bg/3 5/1
// {Battle} Alien Fungus Spell. ⚠ "target formation" proxied by a target
// unit (header): the grid side containing it at RESOLUTION is the
// formation, counted live (R27). The 1/1 unit tokens arrive in the
// caster's HOME region (R28 — created units are not battle materiel).
card('Galactic Germination', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Galactic Germination: a unit in target formation' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('id' in (t as object))) return;
      const grid = formationOf(g, (t as Entity).id);
      const n = grid ? grid.flat().filter(id => !!g.entity(id)).length : 0;
      if (n <= 0) {
        g.ev('info', 'Galactic Germination: the target is in no formation — nothing is created.');
        return;
      }
      for (let i = 0; i < n; i++) {
        g.spawnUnit(ctx.controller, 'Unit Token', g.homeRegion(ctx.controller),
          { token: true, tokenStats: [1, 1] });
      }
    },
  },
});

// "[Augment] At the start of deployment, recall all your other units." —
// bg/1 4/4 Alien Parasite Unit. PARKED (see header): no start-of-deployment
// event exists. The inert augmentText entry keeps the card recognised as an
// augment (Stasis Sentry precedent); it plays as a vanilla 4/4 meanwhile.
card('Invasive Species', {
  augmentText: [{
    type: 'triggered', events: [],   // PARKED — never fires
    label: 'at the start of deployment, recall all your other units (not implemented)',
    effect: { run: () => { /* PARKED */ } },
  }],
});

// "After combat, [Switch1] Recall up to one target unit with cost less than
// or equal to the number of units in my formation." — bg/2 3/2 Mystic
// Fungus Unit. Bounded trigger + bounded graft cause ([Switch1], R9). "Up
// to one" = a min-0 target spec (the chooser may pick nobody). The
// formation size is live at resolution (R27: surviving units in the grid
// side containing me); the cost bar is checked at RESOLUTION (⚠ TargetSpec
// cannot express it — an over-cost target is simply not recalled). Not in
// any formation → the bar is 0 (only cost-0 units are recallable).
const lurkerRecall: EffectDef = {
  targets: {
    what: 'unit', min: 0,
    prompt: 'Lumengrove Lurker: recall up to one target unit (cost ≤ units in my formation)',
  },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!t || !('id' in (t as object))) return;
    const u = t as Entity;
    const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
    const grid = self ? formationOf(g, self.id) : null;
    const n = grid ? grid.flat().filter(id => !!g.entity(id)).length : 0;
    if (manaOf(u.card) > n) {
      g.ev('info', `Lumengrove Lurker: ${u.card}'s cost is above ${n} — not recalled.`);
      return;
    }
    g.recall(u);
  },
};
card('Lumengrove Lurker', {
  abilities: [{
    type: 'triggered', events: ['afterCombat'], bounded: true, graftCause: true,
    label: 'recall up to one target unit (cost ≤ units in my formation)',
    effect: lurkerRecall,
  }],
  graftEffect: { bounded: true, effect: lurkerRecall },
});

// "[Augment] Whenever you are dealt combat damage, target opponent gains
// control of me." — bg/3 5/6 Alien Frog Parasite {Virus} Unit. Text-box
// [Augment]: as a virus on an enemy host, "you" = the HOST's controller and
// "me" = the host — combat damage to them hands the host over. "You are
// dealt combat damage" = the combat life-loss event for my controller (R1;
// Resonant riders and effect damage don't count); it fires during a damage
// sub-step, so the flip resolves immediately (R31). "Target opponent" is
// auto-picked in 1v1 (one opponent); with more seats the controller picks.
// Control flip per the header's gain-control approximation. {Virus} play
// mode is engine-level.
card('Mindwarp Sporefrog', {
  augmentText: [{
    type: 'triggered', events: ['lifeLost'],
    label: 'target opponent gains control of me (you were dealt combat damage)',
    when: (g, self, ev) => ev.data?.why === 'combat' && ev.data?.seat === self.controller,
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!self) return;
        const opps = (g.s.regions[ctx.region]?.presentSeats ?? [])
          .filter(s => s !== self.controller) as Seat[];
        if (!opps.length) {
          const any = g.s.players.map(p => p.seat).find(s => s !== self.controller);
          if (any !== undefined) opps.push(any);
        }
        if (!opps.length) return;
        const opp = opps.length === 1 ? opps[0]! : ctx.choose('opp', {
          kind: 'electricPath', seat: self.controller,
          prompt: `Mindwarp Sporefrog: which opponent gains control of ${self.card}?`,
          options: opps.map(s => ({ label: g.pname(s), value: s })),
        }) as Seat;
        takeControl(g, self, opp);
      },
    },
  }],
});
