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
 *    (R35) and stored on the item. Abduct's "with cost [x] or less" is a real
 *    TARGETING restriction — R64 put the item's X on TargetCtx (dsl.ts names
 *    Abduct in that field's doc), so only units it can legally reach are
 *    offered. This entry used to say it was "still checked at RESOLUTION
 *    (TargetSpec cannot read x at cast time)".
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
 *    negated, which under R68 is itself the removal — the item leaves the
 *    stack and its card is binned by negate() — then the battle round ends
 *    via the engine's endBattleRound.
 * ✔ TEMPORAL RIFT's "Erase this spell" is REAL as of CARD-TODO #15. This entry
 *    used to say "resolution has no erase-own-card hook"; it has one now —
 *    `ctx.eraseSelf()` raises `StackItem.eraseSelf` and `E.dischargeItem`
 *    sends the card to the erased pile (R65) instead of the bin. The Rift's own
 *    item is already off the stack when its effect runs (resolveTop pops it),
 *    so neither the negate sweep nor endBattleRound can dispose of it first —
 *    see the ordering note on the card. ⚠ A NEGATED Rift is still binned: the
 *    erase is a sentence of the effect, and R68 says a negated effect does
 *    nothing.
 *  - DEMATERIALIZE's "target effect" is R60's 'stackEffect' — the SUPERSET:
 *    spells, spell units, spell tokens and ambushes PLUS triggered and
 *    activated abilities and viruses, because the pool's other cards spell out
 *    "target SPELL effect" when they mean the narrow one. (This entry used to
 *    read "= the engine's 'stackSpell' targets … triggered/activated items are
 *    not targetable".) Glimpse 3 is real
 *    (R45, E.glimpse): three are revealed, ONE of the glimpser's choice is
 *    cached (playable until end of turn, ignoring affinity) and the other two
 *    are recycled — it used to keep one card, permanently, in hand.
 *  - AETHERCAP SIPHONER "spawns with" its three -1/-1 counters via an
 *    on-spawn self trigger — the counters land immediately after the spawn
 *    event rather than being on the unit as it spawns.
 *  - GALACTIC GERMINATION's "target formation" is proxied by targeting a
 *    UNIT: the formation is the battle grid side (attacking columns or
 *    blocking columns) containing it, counted live at resolution (R27); a
 *    target in no formation creates nothing. The 1/1s arrive HOME (R28).
 *  - FLORAL SINGULARITY's "become base X/X" is a REAL layer-2 replacement
 *    (R66's E.setBase): the number on the card changes, so a later base-setter
 *    overwrites an earlier one instead of stacking, and counters / statics /
 *    until-regroup deltas still apply on top. This entry used to describe the
 *    old approximation ("until-regroup temp stats … no base-setting layer
 *    exists"), which the card stopped using.
 *  - "EACH ENEMY" / "each unit" / "all tokens" are region-scoped (R12/R25):
 *    only the event region's units/players are touched.
 *
 * UNPARKED by the R49/R50/R51 engine wave:
 *  - Invasive Species: "At the start of deployment, recall all your other
 *    units" is a plain triggered ability on R50's 'startOfDeployment' event,
 *    which fires inside a settle() window after R38's rot damage.
 *
 * PARKED (needs engine machinery that does not exist yet):
 *  - no whole card is parked in this batch any more; the remaining gaps are
 *    the per-card approximations listed above.
 */
import type { Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, notSelf, unitRestrict, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt, inEndOfTurn, manaOf, pickUnit } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

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

/** Glimpse N for a seat (R45) — reveal the top N, cache exactly ONE of the
 * glimpser's choice (playable until end of turn ignoring affinity; mana and
 * timing still apply) and recycle the rest to the bottom of the deck. N > 1
 * raises the choose-one decision inside E.glimpse, so this CAN suspend. */
function glimpse(g: E, seat: Seat, n: number): void {
  g.glimpse(seat, n);
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
        g.dealEffectDamageAll(ctx,   // R80: "each player" is one batch
          g.s.regions[ctx.region]!.presentSeats.map(s => ({ target: { player: s as Seat }, n: 2 })));
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
  creates: ['Poison', 'Fireball'],
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
        const self = selfOf(g, ctx);
        // R113: this is an ACTIVATED [once] — the player chose to activate it
        // and paid [one]. There is no "you may" inside it to decline, so both
        // of these branches SPEND the use ("regardless of if that ability
        // resolves or doesn't"). No refund, deliberately.
        if (!self) { g.ev('info', 'Auric Ascendant: the carrier is gone — no recall, no {Flying}.'); return; }
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
// Cosmic Technology Spell. R60: "target effect" is the SUPERSET ('stackEffect'
// — abilities and viruses too), which is what the spec six lines below says;
// the "⚠ = stack spells/spell units/spell tokens/ambushes" line that used to
// sit here contradicted it. The Glimpse is the real R45 one. It goes to
// the negated item's controller, whoever that is (it can be the caster's own
// effect). R40: negating is not trashing — the negated card comes off the
// STACK — so no 'trashed' fires for the card Dematerialize answers.
card('Dematerialize', {
  spellEffect: {
    targets: { what: 'stackEffect', prompt: 'Dematerialize: negate target effect' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('stack' in (t as object))) return;
      const stackId = (t as { stack: number }).stack;
      const it = g.s.stack.find(i => i.id === stackId);
      if (!it) {
        g.ev('info', 'Dematerialize: the targeted effect has already left the stack — nothing is negated.');
        return;
      }
      g.negate(stackId);
      glimpse(g, it.controller, 3);
    },
  },
});

// "End this battle. Erase this spell. (Negate all effects, this battle is
// over.)" — bmm/4 1/2 {Battle} Temporal Arcane Spell. ⚠ header: every
// remaining stack item is negated — which under R68 is itself the removal,
// card and all — then endBattleRound() runs — in round 1 with no sent
// counterattackers that cascades straight through round 2 into regroup.
//
// "ERASE THIS SPELL" IS REAL (CARD-TODO #15); it used to be approximated as
// the Rift being binned normally. The ORDERING is the thing to get right, and
// it works out because the Rift's own disposal is not on the stack and not
// inside endBattleRound():
//
//   resolveTop() POPS the item first, so `g.s.stack` below never contains the
//   Rift — the sweep cannot negate the Rift with everything else, and the
//   battle ending cannot take its card anywhere. The item is held in a local
//   for the whole of resolveItem(), and afterParts() → dischargeItem() runs
//   AFTER this run() returns, cascade and all. So raising the flag here and
//   letting the disposal read it is safe wherever endBattleRound() ends up:
//   by the time anything disposes of the Rift, the flag is already on it.
//
// It is raised BEFORE the sweep rather than after, so that it is set even if
// something downstream throws — and unconditionally, ahead of the no-battle
// guard, because "Erase this spell" is its own printed sentence and does not
// depend on there having been a battle to end. (A {Battle} spell outside a
// battle is unreachable in practice; the guard is belt and braces.)
card('Temporal Rift', {
  spellEffect: {
    run: (g, ctx) => {
      ctx.eraseSelf();
      if (!g.s.battle) { g.ev('info', 'Temporal Rift: no battle to end.'); return; }
      // R68: negate() is the removal — it splices the item off the stack and
      // bins its card itself, so the sweep runs over a copy and hand-rolls
      // nothing. This used to push the card a SECOND time and then clear the
      // stack by hand.
      for (const it of [...g.s.stack]) g.negate(it.id);
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
        if (!u) {
          g.ev('info', 'Transmutide Enigma: the ally that spawned is gone — nothing is doubled.');
          return;
        }
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
// (R35), which is why the cost bar can be a real TARGETING RESTRICTION
// (R64: TargetCtx carries the item's X) — only units it can actually take are
// offered, and the resolution check stays for R5/R56; the ransom is a mid-resolution
// pay-or-decline (R6) for the target's controller, skipped when they cannot
// pay (x more than their open mana). Control flip per the header's
// E.giveControl (R112): the unit and its mods change controller.
card('Abduct', {
  spellEffect: {
    targets: {
      what: 'unit', prompt: 'Abduct: gain control of target unit (cost [x] or less)',
      restrict: unitRestrict((_g, u, ctx) => manaOf(u.card) <= (ctx.x ?? 0)),
    },
    run: (g, ctx) => {
      const x = ctx.x ?? 0;   // chosen and paid at cast (R35)
      const t = ctx.targets[0];
      if (!isEnt(t)) return;
      const u = t as Entity;
      if (manaOf(u.card) > x) {
        g.ev('info', `Abduct: ${u.card} costs more than ${x} — no effect.`);
        return;
      }
      if (u.controller === ctx.controller) {
        g.ev('info', `Abduct: ${u.card} is already yours — nothing happens.`);
        return;   // already yours
      }
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
        if (pay) {
          g.payMana(owner, x);
          g.ev('info', `${g.pname(owner)} pays [${x}] — ${u.card} stays with them.`);
          return;
        }
      }
      g.giveControl(u, ctx.controller);
    },
  },
});

// "/[Create X 1/1 units {i1}or your units become base X/X until regroup]."
// — ggm/X 2/2 Cosmic Flower Spell (deploy timing). X is chosen and paid AT
// CAST (R35). Modal: the caster picks. Created UNITS arrive in the
// controller's HOME region (R28). "Become base X/X" is a layer-2 REWRITE
// (E.setBase) of every one of your units in the resolution region (R12) —
// counters and other layer-3 changes keep applying on top, and X = 0 defense
// kills anything that is not propped up (E.setBase runs the death check).
card('Floral Singularity', {
  spellEffect: {
    creates: ['Unit Token'],
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
      // layer 2, not a delta: every one of your units IS base X/X now,
      // whatever it was printed as and whatever else rewrote it earlier
      for (const u of g.unitsOf(ctx.controller, ctx.region).slice()) g.setBase(u, x, x);
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
        let deleted = 0;
        for (const u of g.unitsIn(ctx.region).slice()) {
          if (u.token) { g.destroy(u, 'is deleted'); deleted++; }
        }
        for (const t of Object.values(g.s.entities)) {
          if (t.kind === 'spellToken' && t.region === ctx.region) {
            delete g.s.entities[t.id];
            g.ev('info', `${t.card} ${t.x ?? ''} is deleted (Ominous Growth).`);
            deleted++;
          }
        }
        if (!deleted) g.ev('info', 'Ominous Growth: there is no token here to delete.');
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
        const self = selfOf(g, ctx);
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
    if (!pool.length) {
      g.ev('info', `Wither and Bloom: there is no ${mode === 'wither' ? 'enemy' : 'ally'} here — no counters.`);
      return;
    }
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
// R64: "another target unit" is a declared target chosen as the trigger goes
// on the stack (min 0 carries the "may"), and "another" excludes the carrier.
card('Aethercap Siphoner', {
  abilities: [{
    type: 'triggered', events: ['spawned'], self: true,
    label: 'I spawn with three -1/-1 counters',
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (self) g.addCounters(self, -3);
      },
    },
  }],
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'],
    label: 'you may move a counter from me onto another unit (you played a nontoken spell)',
    when: (g, self, ev) => ev.data?.seat === self.controller && ev.data?.token !== true,
    effect: {
      targets: {
        what: 'unit', min: 0,
        prompt: 'Aethercap Siphoner: move a counter from me onto another target unit',
        restrict: notSelf,
      },
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self || self.counters === 0) return;
        const tref = ctx.targets[0];
        if (!isEnt(tref)) return;
        const t = g.entity((tref as Entity).id);
        if (!t || t.id === self.id) return;
        const delta = self.counters > 0 ? 1 : -1;
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
    creates: ['Unit Token'],
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t)) return;
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
// bg/1 4/4 Alien Parasite Unit. UNPARKED by R50's 'startOfDeployment' event,
// which fires inside a settle() window right after R38's rot damage.
//
// Text-box [Augment]: live while the card is a unit in play, donated to the
// host when it augments — so "your other units" is always the HOLDER's
// controller (ctx.controller), and "other" excludes the holder itself, host
// included. There is no "may": it recalls unconditionally, which is the whole
// drawback of a 1-mana 4/4.
//
// Region-scoped (R12/R25) via ctx.region, which at the start of deployment is
// the controller's home region — where all of their units are.
//
// Recall order is the entity-table order, taken as a snapshot BEFORE the first
// recall so the list cannot shift underneath the loop; each recall puts a
// nontoken unit in its owner's hand and erases a token (E.recall), and a
// recalled unit's mods go to their owners' bins and are trashed there (R40).
card('Invasive Species', {
  augmentText: [{
    type: 'triggered', events: ['startOfDeployment'],
    label: 'at the start of deployment, recall all your other units',
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        const others = g.unitsOf(ctx.controller, ctx.region)
          .filter(u => u.id !== self?.id);
        if (!others.length) {
          g.ev('info', 'Invasive Species: no other units to recall.');
          return;
        }
        g.ev('info', `Invasive Species recalls ${others.length} of ${g.pname(ctx.controller)}'s other units.`);
        for (const u of others) g.recall(u);
      },
    },
  }],
});

// "After combat, [Switch1] Recall up to one target unit with cost less than
// or equal to the number of units in my formation." — bg/2 3/2 Mystic
// Fungus Unit. Bounded trigger + bounded graft cause ([Switch1], R9). "Up
// to one" = a min-0 target spec (the chooser may pick nobody). The
// formation size is live at resolution (R27: surviving units in the grid
// side containing me). R64: the cost bar is a TARGETING RESTRICTION — the
// TargetSpec can express it now, so only recallable units are offered; the
// resolution check stays, because the formation can shrink under the spell.
// Not in any formation → the bar is 0 (only cost-0 units are recallable).
const formationSize = (g: E, sourceId?: number): number => {
  const self = sourceId !== undefined ? g.entity(sourceId) : undefined;
  const grid = self ? formationOf(g, self.id) : null;
  return grid ? grid.flat().filter(id => !!g.entity(id)).length : 0;
};
const lurkerRecall: EffectDef = {
  targets: {
    what: 'unit', min: 0,
    prompt: 'Lumengrove Lurker: recall up to one target unit (cost ≤ units in my formation)',
    restrict: unitRestrict((g, u, ctx) => manaOf(u.card) <= formationSize(g, ctx.sourceId)),
  },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t)) {
      g.ev('info', 'Lumengrove Lurker: no unit is targeted (up to one) — nothing is recalled.');
      return;
    }
    const u = t as Entity;
    const n = formationSize(g, ctx.sourceId);
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
// Control flip through E.giveControl (R112). {Virus} play
// mode is engine-level.
card('Mindwarp Sporefrog', {
  augmentText: [{
    type: 'triggered', events: ['lifeLost'],
    label: 'target opponent gains control of me (you were dealt combat damage)',
    when: (g, self, ev) => ev.data?.why === 'combat' && ev.data?.seat === self.controller,
    effect: {
      // R67: "target opponent" is a DECLARED target, chosen as the trigger
      // goes on the stack. 'opponent' is measured from the EFFECT's
      // controller (R58), which is the Sporefrog's controller — the seat
      // about to give it away — so the kind already excludes them.
      targets: { what: 'opponent', prompt: 'Mindwarp Sporefrog: target opponent gains control of me' },
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) return;
        const t = ctx.targets[0];
        if (!t || !('player' in t)) return;
        g.giveControl(self, t.player);
      },
    },
  }],
});
