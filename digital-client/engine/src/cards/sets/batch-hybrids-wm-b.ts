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
 * counts are live at resolution), R115 (created UNITS arrive where their
 * SOURCE is — ctx.region — exactly where spell tokens always stayed),
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
 * ✔ GAIN CONTROL (Abduct, Mindwarp Sporefrog) IS E.giveControl, and it is no
 *    longer an approximation. This entry used to read "flipping Entity
 *    .controller … walks to its new controller's home at regroup". R112 made
 *    it whole: the unit's MODS change controller with it, the unit leaves any
 *    formation it fought in (it fights for neither side for the rest of the
 *    battle), and it moves to the new controller's home IMMEDIATELY when that
 *    seat is not present in the region it is standing in — mods and all —
 *    rather than waiting for regroup. Its owner is unchanged, so recall/death
 *    still send the card to the owner's hand/bin (R65).
 * ✔ ROTSPORE HERALD's "Everything is deadly" is LITERAL as of R125. This entry
 *    used to end "whether everything should reach non-unit sources needs a
 *    ruling, not a guess" — the owner ruled 2026-08-24 that it reaches all
 *    spells and spell tokens, "literally everything in its region". The card
 *    carries BOTH attribute channels now: a `statics` mod with no kind filter
 *    (so units AND spell tokens in the region wear {Deadly}, both sides,
 *    itself included) and an R94 `effectAttrs` mod (so a resolving SPELL,
 *    which has no entity and would otherwise read only printed attrs, is
 *    deadly-fied through `EffectCtx.grantedAttrs`). COMBAT reads the first
 *    via column attrs. All four reads pinned in 107-semantics-statics,
 *    including the REGION boundary — a Herald elsewhere deadly-fies nothing.
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
 *  - AETHERCAP SIPHONER: NO LONGER an approximation. This entry used to read
 *    '"spawns with" its three -1/-1 counters via an on-spawn self trigger —
 *    the counters land immediately after the spawn event rather than being on
 *    the unit as it spawns'. R165 made that a DECLARATION on the card
 *    (`spawnsWithCounters: -3`) which E.spawnUnit applies before the event, so
 *    the card is the 1/1 it prints at the moment every watcher reads it.
 *  - GALACTIC GERMINATION's "target formation" is proxied by targeting a
 *    UNIT: the formation is the battle grid side (attacking columns or
 *    blocking columns) containing it, counted live at resolution (R27); a
 *    target in no formation creates nothing. The 1/1s arrive at ctx.region
 *    (R115) — cast in the enemy region, they stay there.
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
import type { EngineEvent, Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, notSelf, unitRestrict, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt, manaOf, pickUnit } from './helpers.ts';

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
// augment despite granting no type-line attrs).
//
// R125 — EVERYTHING MEANS EVERYTHING (owner, 2026-08-24): *"Rotspore also
// applies to all spells and spell tokens. Literally everything in its region.
// I think you're underestimating most cards. All the cards in Algomancy are
// pretty literal."* So the card is read at its word and the scope is the
// REGION, not a category of object inside it: both sides, the holder
// included, units and spell tokens alike, and every EFFECT resolving there.
//
// That needs both attribute channels, because the engine reads a damage
// source two different ways (see `dealEffectDamageAll`): a source with an
// entity in play reads live `ownAttrs` — which is the `statics` mod below,
// now unfiltered by kind — while a resolving SPELL has no entity at all and
// reads its printed attrs plus `EffectCtx.grantedAttrs`, which is R94's
// `effectAttrs` channel. One card, one sentence, two mechanisms: a spell that
// deals 1 damage in this region kills whatever it hits, and so does a
// Fireball token standing here.
//
// Neither predicate tests ownership or kind, deliberately — the printed text
// carries no qualifier to hang one on, and inventing one is exactly the
// underestimation the ruling corrects.
card('Rotspore Herald', {
  augmentable: true,
  statics: [{
    affects: () => true,
    attrs: ['Deadly'],
  }],
  effectAttrs: [{
    affects: () => true,
    attrs: ['Deadly'],
  }],
});

// "[Switch] /[Sacrifice a unit]: Create a Poison X and a Fireball X, where X
// is the defense of the sacrificed unit." — rg/2 4/2 {Battle} Infernal
// Blight Spell. The bracketed sacrifice is a CAST COST (R35): chosen and
// paid before the spell reaches the stack (a grafted rider pays — or
// declines — at composite cast time). X = the sacrificed unit's defense
// SNAPSHOTTED at payment (effStats then); the spell tokens appear at the
// resolution region (R115). Unbounded
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
      // R128: "(Negate all effects, this battle is over.)" really is all of
      // them — a {Battle} unit mid-cast never arrives. Confirmed, not narrowed.
      for (const it of [...g.s.stack]) g.negate(it.id);
      g.ev('info', 'Temporal Rift: all effects are negated — the battle is over.');
      g.endBattleRound();
    },
  },
});

// "[Augment] Whenever another ally spawns during battle, double its /[power
// {i1}or defense] until regroup." — bm/4 5/4 Jellyfish Oracle Unit. Text-box
// [Augment]; "ally" reads from the carrier's side (host perspective when
// donated). The doubled AMOUNT is still the unit's live effective stat at
// resolution (R1) — but R57 moves WHICH HALF into the cast window, where the
// trigger's `item.event` already names the unit that spawned, so the labels
// can show the numbers without the opponent's response having moved them.
const enigmaSpawnedUnit = (g: E, item: { event?: EngineEvent | null }): Entity | undefined => {
  const id = item.event?.data?.unit as EntityId | undefined;
  return id !== undefined ? g.entity(id) : undefined;
};
card('Transmutide Enigma', {
  augmentText: [{
    type: 'triggered', events: ['spawned'],
    label: "double another ally's power or defense until regroup (spawned in battle)",
    when: (g, self, ev) =>
      g.s.phase === 'battle' && ev.data?.seat === self.controller && ev.data?.unit !== self.id,
    effect: {
      modes: {
        key: 'mode',
        prompt: (g, item) => {
          const u = enigmaSpawnedUnit(g, item);
          return `Transmutide Enigma: double ${u?.card ?? 'the ally'}'s power or defense until regroup?`;
        },
        options: (g, item) => {
          const u = enigmaSpawnedUnit(g, item);
          const [p, t] = u ? g.effStats(u) : [0, 0];
          return [
            { label: u ? `Double its power (+${p}/+0)` : 'Double its power', value: 'power' },
            { label: u ? `Double its defense (+0/+${t})` : 'Double its defense', value: 'defense' },
          ];
        },
      },
      run: (g, ctx) => {
        const id = ctx.event?.data?.unit as EntityId | undefined;
        const u = id !== undefined ? g.entity(id) : undefined;
        if (!u) {
          g.ev('info', 'Transmutide Enigma: the ally that spawned is gone — nothing is doubled.');
          return;
        }
        const [p, t] = g.effStats(u);
        const mode = ctx.mode;   // R57: declared at cast
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
//
// R157 §1 (an X card's cost is the X paid for it) does NOT reach the cost bar
// here, and that was checked rather than assumed: the bar is read off a UNIT
// IN PLAY, and all eleven `mana: 'X'` cards in the pool are `kind: 'spell'` —
// none of them can ever be a unit. `manaOf` is the right read.
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
      if (g.openMana(owner) >= x) {
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
// CAST (R35). Modal: the caster picks. Created UNITS arrive at the source's
// region (R115) — home for a deploy cast. "Become base X/X" is a layer-2 REWRITE
// (E.setBase) of every one of your units in the resolution region (R12) —
// counters and other layer-3 changes keep applying on top, and X = 0 defense
// kills anything that is not propped up (E.setBase runs the death check).
card('Floral Singularity', {
  spellEffect: {
    creates: ['Unit Token'],
    // R57: which half, declared in the cast window. X is fixed by then
    // (collectX runs first), so the labels can name it — and an X = 0 cast is
    // a guaranteed no-op either way, so it is not worth a question.
    modes: {
      key: 'mode',
      prompt: (_g, item) => {
        const x = item.x ?? 0;
        return `Floral Singularity: create ${x} 1/1 units, or your units become base ${x}/${x} until regroup?`;
      },
      options: (_g, item) => {
        const x = item.x ?? 0;
        if (x <= 0) return [];
        return [
          { label: `Create ${x} 1/1 unit token(s)`, value: 'create' },
          { label: `Your units become base ${x}/${x} until regroup`, value: 'base' },
        ];
      },
    },
    run: (g, ctx) => {
      const x = ctx.x ?? 0;   // chosen and paid at cast (R35)
      if (x <= 0) { g.ev('info', 'Floral Singularity: X = 0 — no effect.'); return; }
      const mode = ctx.mode;   // R57: declared at cast
      if (mode === 'create') {
        for (let i = 0; i < x; i++) {
          g.spawnUnit(ctx.controller, 'Unit Token', ctx.region,
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
// Text-box [Augment], live when played normally.
//
// "ALL TOKENS" IS UNQUALIFIED BY KIND, and the engine has THREE token shapes,
// not two (the R125 reading: the printed text carries no qualifier, so do not
// invent one out of whichever shapes the sweep happened to know about):
//   · kind 'unit'      — a unit token, deleted through destroy() so formation
//                        cleanup and death bookkeeping run (a deleted token is
//                        erased, not binned);
//   · kind 'spellToken'— erased directly; it does not "die", so no despawn
//                        trigger misfires;
//   · kind 'mod'       — an AUGMENT that is itself a token. Today that is the
//                        Wraith and only the Wraith (E.augmentWraith is the
//                        sole attachMod with token:true — Blight's End mints
//                        them by the X-full), and it used to walk out of
//                        "delete all tokens" untouched because the sweep could
//                        only see bodies. A mod carries `region: host.region`
//                        (attachMod), so R12 scopes it for free; it is deleted
//                        the way Reclaim the Fallen and eraseUnit take a mod
//                        off a host — unlink from `host.mods`, then delete —
//                        because a mod is not a body and has no death of its
//                        own to run.
// Region-scoped throughout (R12 — other regions don't exist for this).
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
        // the third shape: a TOKEN MOD riding on a host (R71's Wraith). The
        // host survives — the token is the augment, not the unit wearing it.
        for (const m of Object.values(g.s.entities)) {
          if (m.kind !== 'mod' || !m.token || m.region !== ctx.region) continue;
          const host = m.modOf !== undefined ? g.entity(m.modOf) : undefined;
          if (host) {
            const k = host.mods.indexOf(m.id);
            if (k !== -1) host.mods.splice(k, 1);
          }
          delete g.s.entities[m.id];
          g.ev('info',
            `${m.card} is deleted off ${host?.card ?? 'its host'} (Ominous Growth).`,
            host ? { unit: host.id } : {});
          deleted++;
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
//
// R129 — WHICH TOKENS THIS ONE MEANS: only UNIT tokens, and the printed word
// "unit" is why. The engine dispatches 'tokenCreated' for SPELL tokens now
// (Mycelial Mentor's half of R129), so a card that means every token listens
// to BOTH events; this one deliberately listens to 'spawned' alone and its
// `when` reads `data.unit`, neither of which a spell token ever produces. A
// Poison is not a body, has no stats and could not take the +1/+1 the second
// sentence puts on it.
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
// R57 — the controller declares the half in the CAST window (`EffectDef.modes`),
// so the item reaches the stack saying which one it is and the opponent
// responds to a fully declared effect. It used to be a mid-resolution
// ctx.choose with a silent auto-pick of 'bloom' during end-of-turn resolution;
// that auto-pick is gone, because E.finishTurnEnd resumes out of settle() and
// the cast window already suspends there for targets. "Each enemy" / "your
// units" are the resolution region's units (R12/R25). Bounded graft
// ([Switch1], R9) — and because `modes` is declared per EFFECT, a Wither and
// Bloom grafted onto a carrier that already has one asks twice.
const witherOrBloom: EffectDef = {
  modes: {
    key: 'mode',
    prompt: () =>
      'Wither and Bloom: a -1/-1 counter on each enemy, or a +1/+1 counter on each of your units?',
    options: () => [
      { label: 'Wither: a -1/-1 counter on each enemy', value: 'wither' },
      { label: 'Bloom: a +1/+1 counter on each of your units', value: 'bloom' },
    ],
  },
  run: (g, ctx) => {
    const mode = ctx.mode;   // R57: declared at cast
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
// — gb/3 4/4 Cosmic Fungus Blight Unit.
//
// R165: the spawn clause is `spawnsWithCounters: -3` — a DECLARATION about the
// body, applied by E.spawnUnit before the 'spawned' event fires. It used to be
// an ordinary on-spawn self trigger, which is a contradiction in terms: a
// trigger cannot run before the event that raised it (R147), so this card
// stood on the board as a 4/4 for the whole of its own spawn and only became
// the 1/1 it prints a resolution later. Iyngstra ("gain life equal to their
// defense") gained 4, and the caster was stopped and asked to ORDER their own
// spawn against the card's own arithmetic, a question with no answer.
//
// ⚠ AND IT WAS ON THE STACK — the worst of the three, and the one the
// divergence inventory did not name. A triggered ability QUEUES, so in battle
// this card's own printed arrival size was a stack item an opponent could
// respond to or NEGATE, while Powerforge Synergist — printing the same kind of
// sentence — could not be answered at all. "I spawn with three -1/-1 counters
// on me" is a statement about what this card IS on arrival, not an effect
// aimed at it: there is nothing there to answer, and above all the two cards
// must not differ about whether there is.
//
// Nothing else about the number moved: it is still SIGNED, still
// silent (no countersChanged — R130: nobody PUTS a spawn's own counters on
// it), and it still reaches R104's amount layer, so an allied Flux Resonator
// still makes it -4 exactly as the addCounters call it replaced did.
//
// The [Augment] clause transfers: "me" = the carrier, "you" = its
// controller; "a counter" is one of the NET counters (the engine's signed
// counter model — pairs cancel, Manual), so a -1/-1 moves while net
// negative and a +1/+1 moves while net positive; nothing moves at net 0.
// R64: "another target unit" is a declared target chosen as the trigger goes
// on the stack (min 0 carries the "may"), and "another" excludes the carrier.
card('Aethercap Siphoner', {
  spawnsWithCounters: -3,
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
        // R166: each of these three is a reachable decline, and test/65 is
        // right that a decline has to SAY so — `min: 0` means "no target" is
        // the ordinary answer, not an error.
        if (!self || self.counters === 0) {
          g.ev('info', 'Aethercap Siphoner: no counter to move (or my body is gone) — nothing moves.');
          return;
        }
        const tref = ctx.targets[0];
        if (!isEnt(tref)) {
          g.ev('info', 'Aethercap Siphoner: no unit was chosen — the counter stays on me.');
          return;
        }
        const t = g.entity((tref as Entity).id);
        if (!t || t.id === self.id) {
          g.ev('info', 'Aethercap Siphoner: that unit is gone — the counter stays on me.');
          return;
        }
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
// caster's region at resolution (R115) — this is a {Battle} spell, so cast in
// the enemy region the 1/1s are minted THERE, in no column.
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
        g.spawnUnit(ctx.controller, 'Unit Token', ctx.region,
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
// R157 §1 does not reach this bar either — same reason as Abduct's above: it
// is read off a UNIT IN PLAY, and no `mana: 'X'` card in the pool is a unit.
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
