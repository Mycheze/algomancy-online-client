/* batch-metal-c — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Cards are scripted here from printed.json data (never
 * hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (fizzle vs partial), R6 (mid-resolution payments via ctx.choose),
 * R9 (bounded budgets per card), R12 (regions exclusive — listeners, statics
 * and "your units" are region-scoped), R28 (created units arrive in their
 * controller's HOME region; spell tokens stay battle-local), R31 (triggers
 * fired during combat damage sub-steps resolve immediately).
 *
 * ⚠ ENGINE APPROXIMATIONS in this batch:
 *  - Scavenging Sentry: "Sacrifice another unit" is printed as a COST; the
 *    DSL has no sacrifice-another cost slot for activations, so it is paid
 *    mid-resolution (R6-style, the batch-fire-b precedent): the controller
 *    picks one of their other units in the region (or declines — then no
 *    counter). The sacrifice is therefore respondable-after-activation.
 *  - Soul Reaver: "[one], Remove X +1/+1 counters from me" — the DSL cost
 *    slot covers only the mana; X is chosen and the counters are removed at
 *    RESOLUTION against the live count (counters lost in response shrink the
 *    available X).
 *  - Technological Superiority: counters are modelled as one NET signed int
 *    (Manual: +1/+1 and -1/-1 cancel pairwise), so "duplicate each counter"
 *    doubles the net — identical whenever all counters share a sign, which
 *    the net model guarantees.
 *  - Unstable Refactor: "becomes base 5/0" is approximated as an until-regroup
 *    temp delta of (5 − base power)/(− base toughness): counters, other temps
 *    and statics still apply on top (correct), but a SECOND application in the
 *    same battle stacks the delta instead of re-basing, and layer-4 Tough
 *    doubles the summed toughness rather than a true base of 0.
 *  - Void Memory: every pool card is a unit or a spell, so "discards a unit
 *    or spell if able" = "discards a card if their hand is nonempty"; the
 *    discarding player picks the card.
 *  - Transmogrifant / Synaptic Energizer: "your (other) units" is read
 *    region-scoped (R12, the Flowstone Arcanite precedent).
 *
 * PARKED (needs engine primitives that do not exist; subsets implemented):
 *  - Suppression Field ("loses all attributes and abilities until regroup"
 *    half): the engine has no suppression layer that can REMOVE a card's own
 *    printed attributes or silence its abilities. The other half is real:
 *    all of the target's mods are erased (which also strips every mod-granted
 *    attribute and donated text) and every stack effect whose source is the
 *    target is negated.
 *  - Transmogrifant ("lose all attributes and abilities" half): same missing
 *    suppression machinery; the +2/+2 static half is live (unit form AND
 *    augment-donated, host-anchored).
 *  - Worldbender: "Skip your draft step. When you do, draw a card." — the
 *    engine has draft state (state.draftDone, mode 'draft') but NO skip
 *    machinery; the constructed-format life clause has no format flag either.
 *    Registered as a vanilla 2/2 {Feeble} unit until skipping exists.
 */
import type { Entity, EntityId } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, type EffectDef } from '../dsl.ts';

// ─────────────────────────── shared helpers ───────────────────────────

const isEnt = (t: unknown): t is Entity => !!t && typeof t === 'object' && 'id' in t;

/** printed/token base stats — layer 1 only (no counters, temps or statics) */
const baseStats = (g: E, e: Entity): [number, number] => {
  const c = g.card(e.card);
  return e.tokenStats ?? [c.power, c.toughness];
};

/** find an id inside a formation grid → its column and row */
function locateInGrid(grid: EntityId[][], id: EntityId): { col: EntityId[]; i: number } | null {
  for (const col of grid) {
    const i = col.indexOf(id);
    if (i !== -1) return { col, i };
  }
  return null;
}

// ───────────────────────────── the cards ──────────────────────────────

// "[Augment] Whenever another unit dies, put a +1/+1 counter on me." — m/1
// 1/1 Occult Scrap Unit. Text-box [Augment]: live when played normally
// (Manual Q&A), donated when augmenting. "Me" is the host when mod-carried
// (the trigger anchors on the host entity). Any controller's unit counts;
// the listener is region-scoped by the engine (R12). Deaths during combat
// damage sub-steps land the counter immediately (R31).
card('Refuse Reclaimer', {
  augmentText: [{
    type: 'triggered', events: ['died'],
    label: 'put a +1/+1 counter on me (another unit died)',
    when: (_g, self, ev) => ev.data?.unit !== self.id,     // "another unit"
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (self) g.addCounters(self, 1);
      },
    },
  }],
});

// "[Augment][once] [one]: Switch my position with another target ally in my
// formation." — m/2 4/2 Cosmic Strider {Virus} Unit. Text-box [Augment]
// activated ability ([once] = bounded, R9), live when played normally, and a
// battle-playable Virus augment. "My formation" = the grid my side declared
// (attacking columns or blocking columns); the swap mutates the formation
// arrays directly (the Tiderunner Initiate precedent). Both units must be in
// the same grid at resolution, else no switch.
card('Riftwalker', {
  augmentText: [{
    type: 'activated', cost: { mana: 1 }, bounded: true,
    label: 'switch my position with another target ally in my formation',
    effect: {
      targets: { what: 'allyUnit', prompt: 'Riftwalker: switch my position with another target ally in my formation' },
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        const t = ctx.targets[0];
        const b = g.s.battle;
        if (!self || !b || !isEnt(t) || !g.entity(t.id) || t.id === self.id) return;
        for (const grid of [b.columns, Object.values(b.blocks)]) {
          const a = locateInGrid(grid, self.id);
          const c = locateInGrid(grid, t.id);
          if (a && c) {
            a.col[a.i] = t.id;
            c.col[c.i] = self.id;
            g.ev('info', `${self.card} switches positions with ${t.card}.`);
            return;
          }
        }
        g.ev('info', `Riftwalker: ${t.card} is not in my formation — no switch.`);
      },
    },
  }],
});

// "[Augment] Sacrifice another unit: Put a +1/+1 counter on me." — mm/2 2/2
// Occult Scrap Unit. Text-box [Augment] activated ability (unbounded), live
// when played normally. ⚠ the sacrifice cost is paid mid-resolution (header
// approximation): pick one of your OTHER units in the region — declining
// (or having none) yields no counter.
card('Scavenging Sentry', {
  augmentText: [{
    type: 'activated', cost: {},
    label: 'sacrifice another unit: put a +1/+1 counter on me',
    effect: {
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        if (!self) return;
        const victims = g.unitsOf(ctx.controller, ctx.region).filter(u => u.id !== self.id);
        if (!victims.length) { g.ev('info', 'Scavenging Sentry: no other unit to sacrifice.'); return; }
        const pick = ctx.choose('sentrySac', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Scavenging Sentry: sacrifice another unit? (I get a +1/+1 counter)',
          options: [
            { label: 'decline', value: -1 },
            ...victims.map(u => ({ label: u.card, value: u.id, card: u.card })),
          ],
        }) as number;
        const victim = pick >= 0 ? g.entity(pick) : undefined;
        if (!victim || victim.id === self.id) return;
        g.destroy(victim, 'is sacrificed');
        const me = g.entity(self.id);              // re-read: the sacrifice may have chained
        if (me) g.addCounters(me, 1);
      },
    },
  }],
});

// "[Switch] Move all counters from target unit onto another target unit." —
// m/2 {Battle} Scrap Spell. Two distinct targets collected at cast (count: 2);
// the whole move needs both alive (allOrNothing — R5 fizzle). The NET counter
// count moves (negative nets move too); death checks run after the transfer
// (the source may die if it was living on its counters).
const scrapForParts: EffectDef = {
  targets: { what: 'unit', prompt: 'Scrap For Parts: move all counters from the FIRST target onto the SECOND', count: 2, min: 2 },
  allOrNothing: true,
  run: (g, ctx) => {
    const [from, to] = ctx.targets;
    if (!isEnt(from) || !isEnt(to) || !g.entity(from.id) || !g.entity(to.id) || from.id === to.id) return;
    const n = from.counters;
    if (!n) { g.ev('info', `Scrap For Parts: ${from.card} has no counters to move.`); return; }
    from.counters = 0;
    g.ev('info', `Scrap For Parts moves ${Math.abs(n)} ${n > 0 ? '+1/+1' : '-1/-1'} counter(s) from ${from.card} to ${to.card}.`);
    g.addCounters(to, n);                          // fires countersChanged + death check
    g.checkDeaths();                               // the stripped source may die too
  },
};
card('Scrap For Parts', {
  spellEffect: scrapForParts,
  graftEffect: { bounded: false, effect: scrapForParts },
});

// "[Switch1] Create a Robot X, where X is your [m]." — m/2 Scrap Technology
// Spell. X = metal affinity at RESOLUTION (R1; expended resources count,
// R17). A created unit is a token and arrives in its controller's HOME
// region (R28); the Robot spawns with X +1/+1 counters (the Robot card is a
// 0/0 that lives on its counters). X = 0 → nothing is created (a 0/0 would
// die instantly).
const selfAssemble: EffectDef = {
  run: (g, ctx) => {
    const x = g.affinity(ctx.controller, 'metal');
    if (x <= 0) { g.ev('info', 'Self-Assembly: no metal affinity — no Robot.'); return; }
    g.spawnUnit(ctx.controller, 'Robot', g.homeRegion(ctx.controller), { token: true, counters: x });
  },
};
card('Self-Assembly', {
  spellEffect: selfAssemble,
  graftEffect: { bounded: true, effect: selfAssemble },
});

// "[Augment] [one], Remove X +1/+1 counters from me: I deal X damage to
// target unit." — mm/3 2/3 Demon Technology {Virus} Unit. Text-box [Augment]
// activated ability (unbounded), live when played normally. ⚠ X is chosen
// and the counters removed at RESOLUTION (header approximation); no +1/+1
// counters at resolution → no damage. Damage goes through the engine's
// effect-damage path (Reaping/Electric handled there).
card('Soul Reaver', {
  augmentText: [{
    type: 'activated', cost: { mana: 1 },
    label: 'remove X +1/+1 counters from me: I deal X damage to target unit',
    effect: {
      targets: { what: 'unit', prompt: 'Soul Reaver: I deal X damage to target unit (X = +1/+1 counters removed)' },
      run: (g, ctx) => {
        const self = ctx.sourceId !== undefined ? g.entity(ctx.sourceId) : undefined;
        const t = ctx.targets[0];
        if (!self || !isEnt(t) || !g.entity(t.id)) return;
        const have = Math.max(0, self.counters);
        if (!have) { g.ev('info', 'Soul Reaver: no +1/+1 counters to remove.'); return; }
        const opts = [];
        for (let x = 1; x <= have; x++) opts.push({ label: `remove ${x}`, value: x });
        const x = ctx.choose('reaveX', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Soul Reaver: remove how many +1/+1 counters? (I deal that much damage)',
          options: opts,
        }) as number;
        if (!x || x < 1 || x > have) return;
        g.addCounters(self, -x);
        const live = g.entity(t.id);
        if (live) g.dealEffectDamage(ctx, live, x);
      },
    },
  }],
});

// "Target unit loses all attributes and abilities until regroup. Erase all
// of its mods and negate all of its effects." — m/1 {Battle} Technology
// Spell. The attribute/ability suppression half is PARKED (header). Live:
// every mod on the target is ERASED (no bin — which also strips all
// mod-granted attrs and donated text), and every stack effect whose source
// is the target is negated.
card('Suppression Field', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Suppression Field: erase target unit\'s mods and negate its effects' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) return;
      if (t.mods.length) {
        for (const modId of t.mods) delete g.s.entities[modId];
        g.ev('info', `Suppression Field ERASES ${t.mods.length} mod(s) on ${t.card}.`);
        t.mods = [];
      }
      for (const item of g.s.stack) {
        if (!item.negated && item.sourceId === t.id) g.negate(item.id);
      }
      g.checkDeaths();                             // mod statics may have kept it alive
    },
  },
});

// "After combat, [Switch1] Put a +1/+1 counter on each of your units." —
// mm/2 0/1 Scrap Construct Unit. Bounded graft cause (R9: once per turn —
// the round-2 afterCombat finds the budget spent). "Your units" is
// region-scoped (R12, Flowstone precedent): the units with you in the battle.
const energize: EffectDef = {
  run: (g, ctx) => {
    for (const u of g.unitsOf(ctx.controller, ctx.region)) g.addCounters(u, 1);
  },
};
card('Synaptic Energizer', {
  abilities: [{
    type: 'triggered', events: ['afterCombat'], bounded: true, graftCause: true,
    label: 'put a +1/+1 counter on each of your units',
    effect: energize,
  }],
  graftEffect: { bounded: true, effect: energize },
});

// "[Switch1] Duplicate each counter on target unit." — m/2 {Battle}
// Technology Spell. ⚠ net-counter model (header): the net doubles, negatives
// included. No counters → nothing happens.
const duplicateCounters: EffectDef = {
  targets: { what: 'unit', prompt: 'Technological Superiority: duplicate each counter on target unit' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (isEnt(t) && g.entity(t.id)) g.addCounters(t, t.counters);
  },
};
card('Technological Superiority', {
  spellEffect: duplicateCounters,
  graftEffect: { bounded: true, effect: duplicateCounters },
});

// "[Augment] Your other units gain +2/+2 and lose all attributes and
// abilities." — mm/4 4/3 Alien {Virus} Unit. The +2/+2 half is a static:
// live as a unit in play AND augment-donated (mod-carried statics anchor on
// the host, so "your OTHER units" reads from the host's perspective). ⚠
// region-scoped (R12, header). The "lose all attributes and abilities" half
// is PARKED (header: no suppression machinery). `augmentable` keeps the
// Virus/augment play modes open despite no augmentAttrs/augmentText.
card('Transmogrifant', {
  augmentable: true,
  statics: [{
    affects: (_g, self, t) => t.kind === 'unit' && t.controller === self.controller && t.id !== self.id,
    dp: 2, dt: 2,
  }],
});

// "[Augment] {Unaware} Scrap Robot {Virus} Unit" — m/2 2/2. Type-line
// [Augment]: augmenting grants {Unaware} via printed.augmentAttrs, and Virus
// lets it augment from hand during battle — all engine-level, no behavior.
card('Trashling', {});

// "Delete target unit with base power 2 or less." — m/2 {Battle} Occult
// Technology Spell. BASE power = printed/token stats only (layer 1 — no
// counters, temps or statics); the gate is enforced at resolution (an
// over-power pick is a no-op). Delete = destroy without combat (engine verb;
// nontoken unmodded → owner's bin).
card('Unmake', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Unmake: delete target unit with base power 2 or less' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) return;
      const [bp] = baseStats(g, t);
      if (bp <= 2) g.destroy(t, 'is deleted');
      else g.ev('info', `Unmake: ${t.card} has base power ${bp} (> 2) — not deleted.`);
    },
  },
});

// "Target unit becomes base 5/0 until regroup." — m/2 {Battle} Cosmic
// Technology Spell. ⚠ approximated as an until-regroup temp delta from the
// current base (header): counters/temps/statics still apply on top, so a
// counterless target is a 5/0 and dies at the death check unless something
// props its toughness up.
card('Unstable Refactor', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Unstable Refactor: target unit becomes base 5/0 until regroup' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) return;
      const [bp, bt] = baseStats(g, t);
      g.addTemp(t, 5 - bp, -bt);
      g.checkDeaths();
    },
  },
});

// "When I die, [Switch1] Delete target unit." — m/3 0/1 Cosmic Anima Unit.
// Bounded graft cause (R9). A combat death fires the trigger immediately
// between damage sub-steps (R31) — the delete lands before the next
// sub-step; outside battle it resolves as a special action.
const singularityDelete: EffectDef = {
  targets: { what: 'unit', prompt: 'Unstable Singularity: delete target unit' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (isEnt(t) && g.entity(t.id)) g.destroy(t, 'is deleted');
  },
};
card('Unstable Singularity', {
  abilities: [{
    type: 'triggered', events: ['died'], self: true, bounded: true, graftCause: true,
    label: 'delete target unit',
    effect: singularityDelete,
  }],
  graftEffect: { bounded: true, effect: singularityDelete },
});

// "[Switch1] Each opponent discards a unit or spell if able. Otherwise, they
// reveal their hand." — m/2 {Battle} Technology Spell. ⚠ every pool card is
// a unit or a spell (header), so "if able" = nonempty hand; the discarding
// player picks the card (→ their bin). An empty hand is revealed instead.
const voidMemory: EffectDef = {
  run: (g, ctx) => {
    for (const p of g.s.players) {
      if (p.seat === ctx.controller) continue;
      if (!p.hand.length) {
        g.ev('info', `Void Memory: ${g.pname(p.seat)}'s hand is empty — revealed.`);
        g.revealHandTo(ctx.controller, p.seat);
        continue;
      }
      const pick = ctx.choose(`vmDiscard:${p.seat}`, {
        kind: 'payOrDecline', seat: p.seat,
        prompt: 'Void Memory: discard a unit or spell',
        options: p.hand.map((name, i) => ({ label: name, value: i, card: name })),
      }) as number;
      const idx = p.hand[pick] !== undefined ? pick : 0;
      const [name] = p.hand.splice(idx, 1);
      p.bin.push(name!);
      g.ev('info', `${g.pname(p.seat)} discards ${name} to Void Memory.`);
    }
  },
};
card('Void Memory', {
  spellEffect: voidMemory,
  graftEffect: { bounded: true, effect: voidMemory },
});

// "Skip your draft step. When you do, draw a card. You also lose 3 life if
// playing a constructed format." — mm/2 2/2 {Feeble} Cosmic Robot Unit.
// PARKED (header: no draft-step-skip machinery; no format flag). Registered
// as a vanilla 2/2 {Feeble} body meanwhile.
card('Worldbender', {});
