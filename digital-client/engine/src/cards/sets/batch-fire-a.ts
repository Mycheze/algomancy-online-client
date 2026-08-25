/* batch-fire-a — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Fire cards scripted over the printed data in printed.json
 * (never hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R6 (mid-resolution payments/choices via ctx.choose), R9 (bounded budgets
 * per card), R12/R25 ("each player/opponent" and "your units" are
 * region-scoped via presentSeats / unitsOf(region)).
 *
 * UN-PARKED (history kept; NO card in this batch is parked. Every entry below
 * records a park that has since shipped, and is kept so nobody re-derives the
 * old conclusion. The inline ⚠ markers are two still-open QUESTIONS and one
 * do-not-implement warning — none of them is a park):
 *  - Abyssal Evocation: UN-PARKED (R96). A `playFromBin` action gated on a
 *    battle-scoped permission (E.mayPlaySpellsFromBin), plus a real
 *    {Unstable} stamp on the item and on any body it spawns. ⚠ Open: a
 *    bin-played card obeys its PRINTED timing (R42/R45's answer to the
 *    analogous cache question), so only {Battle} spells in your bin are
 *    reachable — flagged in R96, shipped restrictive.
 *  - Cinder Scuttler: UN-PARKED (R51) — "if I am in your bin, recall me" is a
 *    `zone: 'bin'` trigger, dispatched to the card while it sits in a bin on a
 *    detached stand-in owned by that bin's seat.
 *  - Conduit of Pain: UN-PARKED (R104). "an allied source would deal noncombat
 *    damage ... plus 1 instead" is the pure AMOUNT half of the replacement
 *    layer — an `AmountMod`, summed like a CostMod, consulted by
 *    dealEffectDamageAll after {Powerful} has doubled and before {Vulnerable}
 *    prices the victim. It never reaches the stack, so it cannot be negated.
 *  - Emberflame Enlightener: UN-PARKED (R94). Both halves are live. The
 *    units half is a static ({Powerful} to your units in its region) in BOTH
 *    forms; the SPELLS half is an `effectAttrs` mod — CostMod's sibling, not
 *    a StaticMod, because StaticMod.affects is typed over an Entity and a
 *    resolving spell is a StackItem. R79 had already built the READ side
 *    (`EffectCtx.grantedAttrs`, unioned into the source's attrs by
 *    dealEffectDamage); what was missing and now exists is the WRITE side for
 *    a continuous source. ⚠ One thing is still open and it is a real deck
 *    question: whether "your spells" includes your spell TOKENS. The engine
 *    says yes; `dsl.isSpellEffect` is the single line that decides it.
 *  - Envoy of Lightning: UN-PARKED (R94), same channel. Its predicate counts
 *    the part's DECLARED targets, never the survivors — RAQ "[Solved] Envoy of
 *    Lightning vs Twin Flame." rules that a two-target spell that lost a
 *    target is still a two-target spell.
 *  - Fire Resource: NOT PARKED — this note was wrong (corrected 2026-08-23).
 *    It claimed the clause needed the resource-CARD model and a dispatched
 *    activation event. The clause is not card behaviour at all: "When I
 *    activate, if you have at least [r][r][r], create a Shard" is the MANUAL
 *    p.18 general rule, reprinted on the physical card as reminder text, and
 *    it has always worked — `apply.ts::maybeGrantShard`, for all seven
 *    elements, on the real activateResource path. `card('Fire Resource', {})`
 *    is the correct definition (the Robot precedent), because the face owns no
 *    behaviour. ⚠ Do NOT "implement" it: printed.json has Resource faces for
 *    only fire, water and earth, so moving the rule onto card definitions
 *    would drop the bonus for wood/metal/light/dark. R116, R54; the
 *    seven-element conformance sweep in test/12-fire-a is the guard rail.
 *    registry.ts keeps every element's Resource face out of DECK_LIST.
 *  - Gravitational Correction (X half): UN-PARKED (R35) — X is now chosen and
 *    paid at cast; item.x is set before the spell hits the stack.
 *  - Harbinger of Immolation: UN-PARKED (R11). This note used to read "the
 *    augment half needs a regroup-replacement hook (startRegroup erases all
 *    spell tokens unconditionally)". It never needed a replacement hook: the
 *    erase is a cleanup STEP, not an event, and "your spell tokens stay
 *    through regroup" is a continuous property of the tokens. It is a
 *    StaticMod (`survivesRegroup`) that startRegroup consults per token, live
 *    in both forms because a mod's statics radiate from its host. Reported
 *    twice from real games (rooms ZQPC and SAAY) before it was fixed.
 *  - Infernal Wispweaver: UN-PARKED (R62) — "do not sacrifice themselves after
 *    combat" was waiting on a way to suppress ANOTHER card's trigger, and
 *    StaticMod.suppressAbilities is it. The Wisp has exactly one ability, so
 *    the same static that gives +2/+1 switches the self-sacrifice off.
 */
import type { EntityId, Seat, TargetRef } from '../../types.ts';
import { card, effectByKey, getCard, isSpellEffect, type EffectDef } from '../dsl.ts';

/** a card that is a SPELL for bin purposes — a spell unit is one too (playing
 * it from the bin casts the spell and then spawns the body). */
const isSpellCard = (name: string): boolean => {
  const k = getCard(name).kind;
  return k === 'spell' || k === 'spellUnit';
};

// ─────────────────────────── shared helpers ───────────────────────────

/** "You may sacrifice a unit. If you do, draw a card." — mid-resolution
 * choice (R6 model): the controller picks one of their units in the event
 * region (R12) or declines. Plan-then-commit: the choose happens before any
 * mutation, so replay suspension stays deterministic. */
const sacrificeToDraw = (source: string): EffectDef => ({
  run: (g, ctx) => {
    const units = g.unitsOf(ctx.controller, ctx.region);
    if (!units.length) { g.ev('info', `${source}: you control no unit here — nothing to sacrifice.`); return; }
    const choice = ctx.choose('sac', {
      kind: 'payOrDecline', seat: ctx.controller,
      prompt: `${source}: sacrifice a unit to draw a card?`,
      options: [...units.map(u => ({ label: u.card, value: u.id })), { label: 'Decline', value: false }],
    });
    if (choice === false) { g.ev('info', `${source}: declined — no sacrifice, no draw.`); return; }
    const u = g.entity(choice as EntityId);
    if (!u) { g.ev('info', `${source}: the chosen unit is gone — no draw.`); return; }
    g.destroy(u, 'is sacrificed');
    g.draw(ctx.controller, 1);
  },
});

// ───────────────────────────────────────────────────────────────────────

// "In this battle, you may play spells from your bin. If you do, they gain
// {p}unstable until regroup. (If they would enter a bin, erase them instead.)"
// — rr/4 {Battle} Arcane Occult Spell. Live as of round 17 (R96).
//
// The permission is BATTLE-SCOPED STATE, not a radiating static, and that is
// forced rather than chosen: E.anchored() walks units in play and augment
// mods, and this is a SPELL — it resolves and goes to the bin, leaving nothing
// in play to radiate from. So it is a battleCounter, which is region-keyed
// (R14: "'this battle' = this region's battle", so round 1's permission does
// not leak into round 2), wiped by the existing per-battle reset, and NOT a
// new GameState field — no serialization or replay risk.
//
// The {p}unstable half is a STAMP taken when a card is played this way
// (StackItem.unstable → Entity.unstable), not a derivation off the
// permission: the card says "gain … UNTIL REGROUP", so it has to outlive the
// battle the permission belonged to. R69 names this card for the mechanism:
// "Reminder text on both cards that GRANT it (Abyssal Evocation, Spell
// Excavation): '(If they would enter a bin, erase them instead.)' — a bin
// replacement, in as many words. … Only the destination changes."
//
// ⚠ Note for the owner: this card is a {Battle} spell, so after it resolves it
// sits in your bin and is itself one of the spells you may now play from it.
card('Abyssal Evocation', {
  spellEffect: {
    run: (g, ctx) => {
      g.grantBinSpellPlay(ctx.controller, ctx.region);
      g.ev('info',
        `${ctx.sourceName}: ${g.pname(ctx.controller)} may play spells from their bin `
        + 'for the rest of this battle — each one gains {Unstable} until regroup.',
        { seat: ctx.controller, region: ctx.region });
    },
  },
});

// "[Augment] Your units gain +1/+0 for each nontoken spell you've played in
// this battle." — r/1 0/1 Anima Unit. Text-box [Augment].
// STATIC, not a trigger (playtest fix): the bonus is a live count of the
// battle's nontoken-spell ledger — it never touches the stack, applies to
// units that arrive mid-battle, and drops when the Spark leaves.
card('Animated Spark', {
  augmentable: true,   // text-box [Augment]: the static transfers when augmented
  statics: [{
    affects: (g, self, target) =>
      g.s.phase === 'battle' && target.kind === 'unit' && target.controller === self.controller,
    dp: (g, self) => g.s.battleCounters[self.region]?.[`spellsPlayed:${self.controller}`] ?? 0,
  }],
  // #85: the buff is a live count of YOUR nontoken spells this battle
  // (`spellsPlayed:<seat>`), a ledger with no board representation. One row —
  // the static only ever reads its own controller's count.
  xPreviewRows: (g, seat, region) => [
    { label: 'nontoken spells you have played (the +X/+0)',
      x: g.battleCounter(region, `spellsPlayed:${seat}`) },
  ],
});

// "When my column deals combat damage to an opponent, [Switch1] You may
// sacrifice a unit. If you do, draw a card." — r/2 1/2 {Flying}. Condition at
// event time (R1) on the 'lifeLost' fired during combat: why === 'combat', the
// victim is an opponent, and my column connects — attacking and unblocked (or
// Piercing), or blocking with Piercing. Approximation: lifeLost is aggregated
// per damage sub-step, so a connecting zero-power column alongside another
// dealing column would also pass; no such column exists in normal play.
const revenantSac = sacrificeToDraw('Bloodwind Revenant');
card('Bloodwind Revenant', {
  abilities: [{
    type: 'triggered', events: ['lifeLost'], bounded: true, graftCause: true,
    label: 'you may sacrifice a unit to draw a card',
    when: (g, self, ev) => {
      if (ev.data?.why !== 'combat') return false;
      const b = g.s.battle;
      if (!b || ev.data?.seat === self.controller) return false;
      const col = g.columnOf(self.id);
      if (!col) return false;
      // R117: fires only in the sub-step MY OWN COLUMN strikes in. Missed when
      // R117 was applied — see the matching note on Flowstone Arcanite.
      if (!g.strikesInCurrentSubStep(self)) return false;
      // A 0-power column deals no combat damage at all — Flowstone Arcanite and
      // Blightmound both gate on that and this card gated on neither, so a
      // 0-power column counted as "dealing". THAT half is a real fix.
      //
      // ⚠ The `alive` filter passed to colAttrs below is NOT. My commit message
      // for 49666eb claimed a dead unit's {Piercing} still carried the column;
      // it does not. `E.destroy` calls `removeFromFormation`, which splices the
      // dead id out of `b.columns` immediately (measured: `[[1,2]]` → `[[2]]`),
      // so `alive` and `col` hold the same ids on every reachable board. It is
      // consistency with the rest of the pool and defence against a future path
      // that removes a unit without unslotting it — not a defect that was
      // paying anyone out. Corrected 2026-08-25, when the red-check for the
      // matching Sarcophage change refused to go red.
      const alive = col.filter(id => g.entity(id));
      const power = alive.reduce((s, id) => s + Math.max(0, g.effStats(g.entity(id)!)[0]), 0);
      if (power <= 0) return false;
      const ci = b.columns.indexOf(col);
      if (ci >= 0) {   // attacking: connects if never blocked, or Piercing
        return ev.data?.seat === b.defender
          && (b.blocks[ci] === undefined || g.colAttrs(alive).has('Piercing'));
      }
      // blocking: only a Piercing blocking column reaches the attacker
      return ev.data?.seat === b.attacker && g.colAttrs(alive).has('Piercing');
    },
    effect: revenantSac,
  }],
  graftEffect: { bounded: true, effect: revenantSac },
});

// "When you deal combat damage to an opponent, if I am in your bin, recall
// me. (Put me into your hand.)" — r/1 2/1 {Haste}. UNPARKED by R51: a
// `zone: 'bin'` trigger is dispatched to the card while it SITS IN A BIN,
// anchored on a detached stand-in entity (id -1) whose controller is the bin's
// owner — so "if I am in YOUR bin" is ctx.controller throughout.
//
// "You deal combat damage to an opponent" is read off the aggregated combat
// 'lifeLost' event, the batch-wide convention (Bloodwind Revenant): why ===
// 'combat' and the seat losing life is NOT the bin's owner. In 1v1 combat
// damage to a player can only come from the other side's columns, so "an
// opponent lost combat life" and "you dealt it" are the same statement — the
// bin has no column to check, and this is as close as a bin-resident card can
// get. ⚠ In a multiplayer game a third player's damage would also fire it.
//
// R51: one firing per zone however many copies sit in the bin — right here,
// since the printed text is a standing "if I am in your bin", not per-copy.
// The recall is unconditional ("recall me", no "may"), so it raises no
// decision; leaving a bin is not trashing (R40), so no trash event fires.
card('Cinder Scuttler', {
  abilities: [{
    type: 'triggered', events: ['lifeLost'], zone: 'bin',
    label: 'recall me from your bin (you dealt combat damage to an opponent)',
    when: (_g, self, ev) =>
      ev.data?.['why'] === 'combat' && ev.data?.['seat'] !== self.controller,
    effect: {
      run: (g, ctx) => {
        const bin = g.player(ctx.controller).bin;
        const i = bin.lastIndexOf('Cinder Scuttler');
        if (i === -1) {   // already recalled by an earlier firing this combat
          g.ev('info', 'Cinder Scuttler: it has already left the bin — nothing to recall.');
          return;
        }
        g.removeFromBin(ctx.controller, i, 'recalled');   // R124
        g.toHand(ctx.controller, 'Cinder Scuttler', 'bin');  // R179
        g.ev('info', `Cinder Scuttler is recalled from ${g.pname(ctx.controller)}'s bin to their hand.`);
      },
    },
  }],
});

// "[Augment] If an allied source would deal noncombat damage, it deals that
// much damage plus 1 instead." — rr/2 2/1.
//
// UNPARKED (R104). This is the pure AmountMod case: nothing is substituted and
// nothing is redirected, the number is simply bigger by the time it lands. It
// never reaches the stack — Containment Protocol and Nothyr have nothing to
// negate — which is the owner's rule for a card that prints "instead" and
// names no target (report #75).
//
// SUMMED, so two Conduits make a 1 into a 3. That is Caleb's composition
// ruling: "a replacement only happens once … The replacement just takes what
// would be 1 and makes it 2" — two DIFFERENT modifiers both apply, and none
// applies to its own contribution.
//
// "AN ALLIED SOURCE" is the effect's controller, `ctx.sourceSeat` — which
// `dealEffectDamageAll` really knows (it is `ctx.controller`), unlike the
// counters path where `addCounters` has no source at all. Allied to the
// ANCHOR: played normally that is this card, donated as an [Augment] it is the
// host, and the whole clause moves to the host's side with it.
//
// NONCOMBAT only, which is the printed word and also the seam: combat damage
// has its own two hooks (R38/R98) and never comes through
// `dealEffectDamageAll`. `augmentable` is what keeps the card recognised as an
// augment now that the inert augmentText entry is gone — the Rook/Emberflame
// precedent for [Augment] text implemented as a continuous mod.
card('Conduit of Pain', {
  augmentable: true,
  amountMods: [{
    delta: (_g, self, ctx) =>
      (ctx.kind === 'effectDamage' && ctx.sourceSeat === self.controller && ctx.amount > 0 ? 1 : 0),
  }],
});

// "Recall target spell in your bin. (Put it into your hand.)" — rr/4 2/2
// Arcane Elemental Spell Unit. No spell in the bin → the recall part does
// nothing and the body still spawns. (The paragraph that used to sit here —
// "the bin isn't a target zone in TargetSpec, so the pick is a mid-resolution
// choice by the controller (R6 model)" — was made false by R64/R67 and is
// contradicted by the card's own comment two lines below.)
card('Delver of Mysteries', {
  spellEffect: {
    // R67: "target spell in your bin" is a DECLARED target, chosen as the
    // spell goes on the stack (R64's 'binCard' kind) — it used to be a
    // mid-resolution pick, so the Delver reached the stack aiming at nothing
    // and the opponent could not see what it was about to take back.
    targets: {
      what: 'binCard',
      prompt: 'Delver of Mysteries: recall target spell in your bin',
      restrict: (_g, t) => 'binCard' in t && isSpellCard(t.binCard.card),
    },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('binCard' in t) || t.binCard.index === -1) return;
      const name = g.removeFromBin(ctx.controller, t.binCard.index, 'recalled');   // R124
      if (name !== undefined) {
        g.toHand(ctx.controller, name, 'bin');   // R179
        g.ev('info', `${name} is recalled to ${g.pname(ctx.controller)}'s hand.`);
      }
    },
  },
});

// "[Augment] Your units and spells gain {g}powerful. (Powerful sources deal
// double damage)." — rrr/4 0/5. Text-box [Augment].
//
// The UNITS half is a static — your units in its region (itself included) gain
// {Powerful}, which combat reads through ownAttrs/colAttrs so their columns'
// output doubles — and it is live in BOTH forms: mod-carried statics radiate
// from the HOST (E.anchored), so augmenting it donates the same aura. The
// augment-donated form used to be parked here on "statics run only while the
// holder is a unit in play"; that stopped being true, and the inert
// augmentText stand-in it needed is gone with it (`augmentable: true` is what
// keeps the card applicable).
//
// The SPELLS half is live as of round 17 (R94). It is NOT a static — statics
// are typed over an Entity and a resolving spell is a StackItem, not one — but
// an `effectAttrs` mod, CostMod's sibling: the same anchored() radiation, the
// same R12 region scope, the same shallow R62 guard, and ownership decided
// here in `affects` rather than in the gatherer, exactly as the units half
// above decides it. The grant lands in `EffectCtx.grantedAttrs`, which
// dealEffectDamage has unioned into the source's attrs since R79 — so a
// Fireball resolving under this aura deals double.
//
// The designer scales a unit-sourced noncombat effect by a {Powerful} the
// source did not print — RAQ "[Solved] Resonant, Combat Damage, Conduit and
// Powerful": "2/4 Resonant Powerful would deal 4 combat damage to enemy unit
// and then put effect on stack to deal 8 damage to enemy face" — which is
// this card's own case, since the only way that Resonant unit gets {Powerful}
// is by being granted it.
//
// ⚠ OPEN (R94): "your spells" and spell TOKENS. `isSpellEffect` is the single
// place that answers it and it currently says YES — a Burst Fireball under
// this aura deals double. See its doc comment; one edit moves both cards.
//
// LITERAL-READING AUDIT (2026-08-24) — the code DOES match that stated
// default, in both cards and on every path that reads the attribute, and the
// R125 shape is NOT present here. Checked and pinned in 111-literal-fire:
//  · `isSpellEffect` is the one predicate both Emberflame and Envoy of
//    Lightning use, and it lists 'spellToken' beside 'spell'/'spellUnit', so
//    the two cards cannot drift apart.
//  · a spell token is CAST FROM PLAY: `doCastSpellToken` deletes the entity
//    and rebuilds a StackItem off the printed card, so a cast token has no
//    `sourceId` and `dealEffectDamageAll` reads printed attrs + R94's
//    `grantedAttrs`. `effectAttrs` is therefore the channel that reaches it —
//    the statics channel could not, whatever it filtered on.
//  · so both halves of the printed sentence have live code: `statics` is
//    "your units" and `effectAttrs` is "your spells", spell tokens included.
// The one asymmetry with Rotspore Herald is COSMETIC and left alone: R125
// widened its `statics` so a Fireball STANDING in the region shows {Deadly}
// in `ownAttrs`, and this card's units-only `statics` means your Fireball
// does not show {Powerful} before you cast it. Nothing reads that (the grant
// is regenerated on the stack item), and the owner's R125 wording — "all
// spells AND SPELL TOKENS" — names the two as separate categories, so
// widening on the strength of it would be inventing the ruling, not applying
// it. Flagged for the owner rather than changed.
card('Emberflame Enlightener', {
  augmentable: true,
  statics: [{
    affects: (g, self, t) => t.kind === 'unit' && t.controller === self.controller,
    attrs: ['Powerful'],
  }],
  effectAttrs: [{
    // "YOUR spells": the item's controller against the ANCHOR's controller.
    // anchored()'s contract is that a mod's text reads from its HOST, so an
    // Enlightener augmented onto an ENEMY unit boosts that enemy's spells —
    // the same answer the units half already gives (12-fire-a's donated-aura
    // test pins it).
    affects: (g, self, ctx) => isSpellEffect(ctx.kind) && ctx.seat === self.controller,
    attrs: ['Powerful'],
  }],
});

// "[Augment] Your spell effects with a single target are {g}Electric." —
// rr/2 3/2. Live as of round 17 (R94), on the same `effectAttrs` channel as
// Emberflame Enlightener above and for the same reason: a resolving spell is
// a StackItem and statics only reach Entities.
//
// The target count is the whole card, and it is the reason the channel is
// PER PART with a DECLARED count rather than per item with a surviving one.
// RAQ "[Solved] Envoy of Lightning vs Twin Flame.", the card by name:
//   Q: "If Twin Flame is played with only 1 target, is it Electric thanks to
//       Envoy?"                                  A: "Yes, it will be Electric"
//   Q: "What if Twin Flame was played targeting two units, but one of them was
//       removed before Twin Flame resolves. Will it be Electric?"
//   A: "No, it still has 2 targets, but one of them is invalid (but could
//       become valid thanks to Gravitational Correction or Warder)."
// resolveParts drops dead refs before it builds ctx.targets, so counting the
// survivors would score perfectly on Emberflame and wrongly — and SILENTLY —
// here. `EffectAttrCtx.targets` is `part.targets.length`, the cast-time list.
//
// `augmentable: true` is load-bearing: `isAugment` reads
// `augmentAttrs || augmentText || augmentable`, and this card prints none of
// the first two, so deleting the old inert augmentText stub without it would
// have quietly made the card un-augmentable — i.e. deleted the [Augment] the
// whole card is.
card('Envoy of Lightning', {
  augmentable: true,
  effectAttrs: [{
    affects: (g, self, ctx) =>
      isSpellEffect(ctx.kind) && ctx.seat === self.controller && ctx.targets === 1,
    attrs: ['Electric'],
  }],
});

// "When I activate, if you have at least [r][r][r], create a Shard. (It
// spawns dormant.)" — [r] Fire Resource, 2/0. NOT PARKED: that sentence is
// the Manual p.18 general rule reprinted as reminder text, implemented in
// apply.ts::maybeGrantShard for all seven elements. Bare is CORRECT — the
// face owns no behaviour. ⚠ Adding it here would double the bonus for fire
// and, once the rule moved off maybeGrantShard, delete it for wood, metal,
// light and dark (no printed faces). R116; guarded by test/12-fire-a.
card('Fire Resource', {});

// "Negate all other effects. For each nontoken spell negated this way,
// create a Fireball 1." — rr/4 {Battle} Arcane Spell. At resolution Flame
// Shield is already off the stack, so "all other effects" = every remaining
// un-negated stack item (spells, spell units, spell tokens, triggered/
// activated abilities, viruses, ambushes — R22 counts them all as negatable
// effects). Only nontoken SPELLS (kind spell / spellUnit) pay out Fireballs.
card('Flame Shield', {
  spellEffect: {
    creates: ['Fireball'],
    run: (g, ctx) => {
      let fireballs = 0;
      // R68: negate() splices, so the sweep runs over a COPY — and the count
      // is taken off the copy's own entries, never off the live stack.
      for (const it of [...g.s.stack]) {
        g.negate(it.id);
        if (it.kind === 'spell' || it.kind === 'spellUnit') fireballs++;
      }
      if (!g.s.stack.length && !fireballs) {
        g.ev('info', 'Flame Shield: there is no other effect on the stack — nothing is negated.');
      }
      for (let i = 0; i < fireballs; i++) g.createSpellToken(ctx.controller, 'Fireball', 1, ctx.region);
    },
  },
});

// "After combat, [Switch1] Each player sacrifices a unit." — r/2 2/2.
// "Each player" = the seats present in the battle region (R12/R25), in
// presentSeats order (region owner first); each picks their own sacrifice
// (mid-resolution choices, R6 model). All choices are gathered before any
// destruction (plan-then-commit), then committed together.
const smofSacrifice: EffectDef = {
  run: (g, ctx) => {
    const picks: EntityId[] = [];
    for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
      const units = g.unitsOf(seat as Seat, ctx.region);
      if (!units.length) continue;
      const c = ctx.choose(`sac:${seat}`, {
        kind: 'payOrDecline', seat: seat as Seat,
        prompt: 'General Smof: sacrifice a unit',
        options: units.map(u => ({ label: u.card, value: u.id })),
      });
      picks.push(c as EntityId);
    }
    if (!picks.length) g.ev('info', 'General Smof: nobody here has a unit to sacrifice.');
    for (const id of picks) {
      const u = g.entity(id);
      if (u) g.destroy(u, 'is sacrificed');
    }
  },
};
card('General Smof', {
  abilities: [{
    type: 'triggered', events: ['afterCombat'], bounded: true, graftCause: true,
    label: 'each player sacrifices a unit',
    effect: smofSacrifice,
  }],
  graftEffect: { bounded: true, effect: smofSacrifice },
});

// "When you sacrifice a unit, [Switch1] Each opponent sacrifices a nontoken
// unit." — rr/3 4/3. Sacrifice detection: 'died' events carry no verb in
// data, but destroy() renders it into the message — the when() reads it from
// the event snapshot (R1: event-time condition). "Each opponent" is
// region-scoped (R25); their picks are mid-resolution choices, gathered
// before committing. Note the recursion guard is the condition itself: the
// opponents' sacrifices have seat !== my controller, so Ghord can't loop.
const ghordSacrifice: EffectDef = {
  run: (g, ctx) => {
    const picks: EntityId[] = [];
    for (const seat of g.s.regions[ctx.region]!.presentSeats.slice()) {
      if (seat === ctx.controller) continue;
      const units = g.unitsOf(seat as Seat, ctx.region).filter(u => !u.token);
      if (!units.length) continue;
      const c = ctx.choose(`sac:${seat}`, {
        kind: 'payOrDecline', seat: seat as Seat,
        prompt: 'Ghord: sacrifice a nontoken unit',
        options: units.map(u => ({ label: u.card, value: u.id })),
      });
      picks.push(c as EntityId);
    }
    if (!picks.length) g.ev('info', 'Ghord: no opponent here has a nontoken unit to sacrifice.');
    for (const id of picks) {
      const u = g.entity(id);
      if (u) g.destroy(u, 'is sacrificed');
    }
  },
};
card('Ghord', {
  abilities: [{
    type: 'triggered', events: ['died'], bounded: true, graftCause: true,
    label: 'each opponent sacrifices a nontoken unit',
    when: (g, self, ev) =>
      // R70: the death event carries the VERB; this used to match the log text
      ev.data?.seat === self.controller && ev.data?.verb === 'is sacrificed',
    effect: ghordSacrifice,
  }],
  graftEffect: { bounded: true, effect: ghordSacrifice },
});

// "Change the targets of target effect unless its controller pays [x]." —
// rr/X 2/1 {Battle} Temporal Cosmic Spell. X is chosen and paid AT CAST
// (R35) and stored on the item. R6 payment: the targeted item's controller
// pays x mid-resolution (offered only if affordable) or the Correction's
// controller re-picks every declared target from the current legal
// candidates. All choices happen before any mutation.
card('Gravitational Correction', {
  spellEffect: {
    targets: { what: 'stackEffect', prompt: 'Gravitational Correction: change the targets of target effect' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('stack' in (t as object))) {
        g.ev('info', 'Gravitational Correction: no effect is targeted — nothing is retargeted.');
        return;
      }
      const item = g.s.stack.find(i => i.id === (t as { stack: number }).stack);
      if (!item) {
        g.ev('info', 'Gravitational Correction: the targeted effect has already left the stack.');
        return;
      }
      const x = ctx.x ?? 0;
      const payOptions = [{ label: 'Decline', value: false }];
      if (g.openMana(item.controller) >= x) payOptions.unshift({ label: `Pay [${x}]`, value: true });
      const pays = ctx.choose('pay', {
        kind: 'payOrDecline', seat: item.controller,
        prompt: `Pay [${x}] to keep ${item.label}'s targets?`, options: payOptions,
      });
      if (pays === true) {
        g.payMana(item.controller, x);
        g.ev('info', `${g.pname(item.controller)} pays [${x}] — ${item.label} keeps its targets.`);
        return;
      }
      // change the targets: the Correction's controller re-picks each one
      const picks: [number, number, TargetRef][] = [];
      item.parts.forEach((part, pi) => {
        if (part.spent) return;
        const def = effectByKey(part.effectKey);
        if (!def.targets || !part.targets.length) return;
        part.targets.forEach((_, ti) => {
          const cands = g.targetCandidates(def.targets!, item.region, item.id, item.controller);
          if (!cands.length) return;
          const chosen = ctx.choose(`retarget:${pi}:${ti}`, {
            kind: 'payOrDecline', seat: ctx.controller,
            prompt: `${ctx.sourceName}: choose a new target for ${item.label}`,
            options: cands.map(c => ({ label: g.targetLabel(c), value: c })),
          });
          picks.push([pi, ti, chosen as TargetRef]);
        });
      });
      if (!picks.length) g.ev('info', `Gravitational Correction: ${item.label} has no target to change.`);
      for (const [pi, ti, ref] of picks) item.parts[pi]!.targets[ti] = ref;
      // The SUCCESS path used to say nothing at all: it rewrote another
      // player's targets and the log showed only the payOrDecline. Found by
      // 65-effect-conformance's "no effect resolves into silence" the moment
      // R95 reordered legalActions enough for the fuzz to reach it — the
      // retarget itself had never been driven to completion before.
      if (picks.length) {
        g.ev('info',
          `Gravitational Correction: ${g.pname(ctx.controller)} changes `
          + `${picks.length} of ${item.label}'s targets.`,
          { item: item.id, n: picks.length });
      }
    },
  },
});

// "At the end of turn, create a Fireball X, where X is one plus the number of
// spell tokens you control. [Augment] Your spell tokens stay through regroup."
// — rr/4 2/4 Infernal Elemental Unit. Text-box [Augment]: live on the card
// played normally AND donated to a host (Hooba-Lin convention, below).
//
// The TRIGGER half: X is read at RESOLUTION from live state (R1). It fires
// after regroup has wiped the battle's tokens, so X counts the ones made
// since — exactly what "stay through regroup" feeds it.
//
// The [Augment] half is a STATIC, not a trigger and not a replacement hook
// (playtest ZQPC/SAAY: "my fireball was erased during regroup even tho I have
// the Harbinger"). The regroup erase is a step of the R11 cleanup sequence,
// not an event — nothing to respond to, nothing to negate — so the only honest
// model is a standing property of the tokens, which is what StaticMod is for.
// `survivesRegroup` is that property; startRegroup asks
// E.spellTokenSurvivesRegroup() per token instead of erasing unconditionally.
// Anchoring comes free: `self` is the unit itself when the card is in play and
// the HOST when it was donated as an augment (E.anchored), so "your" means the
// host's controller in the donated form. The tokens keep their X, and still
// have their temporary changes swept — they are only spared the erase.
card('Harbinger of Immolation', {
  augmentable: true,   // text-box [Augment]: the static transfers when augmented
  statics: [{
    // NB the target is a spellToken, not a unit — the usual
    // `target.kind === 'unit'` guard would make this static match nothing.
    affects: (_g, self, target) =>
      target.kind === 'spellToken' && target.controller === self.controller,
    survivesRegroup: true,
  }],
  abilities: [{
    type: 'triggered', events: ['endOfTurn'],
    label: 'create a Fireball X (X = 1 + your spell tokens)',
    effect: {
      creates: ['Fireball'],
      run: (g, ctx) => {
        const x = 1 + g.tokensOf(ctx.controller).length;
        g.createSpellToken(ctx.controller, 'Fireball', x, ctx.region);
      },
    },
  }],
});

// "[Augment] When I attack, create a 1/1 unit in my formation." — rr/1 1/1
// {Haste}. Text-box [Augment]: live on the card played normally and donated
// to a host. "In my formation": R75 — the controller of the effect chooses the
// slot at resolution (either end of the line, or the back slot of a one-unit
// column). It used to silently take my own column's back slot, or open one on
// the right.
card('Hooba-Lin', {
  augmentText: [{
    type: 'triggered', events: ['attacked'], self: true,
    label: 'create a 1/1 unit in my formation',
    effect: {
      creates: ['Unit Token'],
      run: (g, ctx) => {
        const u = g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [1, 1] });
        g.placeInFormation(u, ctx, { key: 'hoobaLinSlot', source: 'Hooba-Lin' });
      },
    },
  }],
});

// "[Switch1] /[Sacrifice a unit]: Draw a card." — r/1 {Battle} Occult Spell.
// The bracketed sacrifice is a CAST COST (R35): chosen and paid before the
// spell reaches the stack — no unit, no cast. Grafted, the rider's cost is
// paid (or declined) when the composite collects its cast-time decisions,
// exactly where graft targeting happens. Bounded graft ([Switch1], R9).
const immolateEffect: EffectDef = {
  castCost: { kind: 'sacrificeUnit' },
  run: (g, ctx) => {
    if (!ctx.costPaid?.sacrificed) {
      // CARD-TODO #18: declining a [Switch1] rider's cost never spends the use.
      // (The cast-time decline route refunds it too — R35 marks the part spent
      // before it runs — so this is the belt to that braces.)
      ctx.refundBudget?.();
      g.ev('info', 'Immolate: no unit was sacrificed — no card is drawn.');
      return;   // rider declined / unpayable
    }
    g.draw(ctx.controller, 1);
  },
};
card('Immolate', {
  spellEffect: immolateEffect,
  graftEffect: { bounded: true, effect: immolateEffect },
});

// "[Augment] [once] Sacrifice X units: Create X Fireball 1." — rrr/3 4/3.
// An ACTIVATED ability in the [Augment] text box: live when played normally
// (via: 'augment') and donated to hosts (via: { mod }) — apply.ts activates
// augmentText abilities directly. X = however many of your in-region units
// you pick (sequential choices, then 'Done'); the sacrifices happen at
// resolution (approximation of a true activation cost). [once] = bounded (R9).
card('Infernal Cultivator', {
  augmentText: [{
    type: 'activated', cost: {}, bounded: true,   // [once]
    label: 'Sacrifice X units: create X Fireball 1',
    effect: {
      creates: ['Fireball'],
      run: (g, ctx) => {
        const picks: EntityId[] = [];
        for (let i = 0; ; i++) {
          const units = g.unitsOf(ctx.controller, ctx.region).filter(u => !picks.includes(u.id));
          if (!units.length) break;
          const c = ctx.choose(`sac:${i}`, {
            kind: 'payOrDecline', seat: ctx.controller,
            prompt: `Infernal Cultivator: sacrifice units (${picks.length} picked so far)`,
            options: [...units.map(u => ({ label: u.card, value: u.id })), { label: 'Done', value: false }],
          });
          if (c === false) break;
          picks.push(c as EntityId);
        }
        if (!picks.length) g.ev('info', 'Infernal Cultivator: no unit is sacrificed — X = 0, no Fireballs.');
        for (const id of picks) {
          const u = g.entity(id);
          if (u) g.destroy(u, 'is sacrificed');
        }
        for (let i = 0; i < picks.length; i++) g.createSpellToken(ctx.controller, 'Fireball', 1, ctx.region);
      },
    },
  }],
});

// "Your wisps gain +2/+1 and do not sacrifice themselves after combat.
// [Augment] At the end of turn, create a wisp." — rr/2 2/1.
//
// ONE sentence, one static. The +2/+1 and the no-sacrifice clause are the same
// continuous effect on the same units, so they are the same StaticMod: main
// text, so unit-form only (correct — only the [Augment] line transfers to
// hosts), and region-scoped like every static (R12).
//
// R62 UNPARKED (playtest: "I have infernal wispweaver, but my wisps sacrificed
// themselves anyway!!!"). This was parked on "there is no way to suppress
// ANOTHER card's trigger". `StaticMod.suppressAbilities` is exactly that way:
// a continuous, radiating flag that switches the target's whole ability layer
// off, read as a veto (E.abilitiesSuppressed) on every path that would fire
// one. It is an EXACT implementation here rather than an approximation because
// the Wisp has exactly ONE ability — "After combat, sacrifice me" — so
// "switch its abilities off" and "it does not sacrifice itself after combat"
// name the same set of behaviour. Being continuous, it is also right in both
// directions: kill the weaver mid-combat and the Wisps sacrifice themselves
// again in the same instant, which is what a printed static means.
card('Infernal Wispweaver', {
  statics: [{
    affects: (g, self, t) =>
      t.kind === 'unit' && t.card === 'Wisp' && t.controller === self.controller,
    dp: 2, dt: 1,
    suppressAbilities: true,
  }],
  augmentText: [{
    type: 'triggered', events: ['endOfTurn'],
    label: 'create a Wisp (end of turn)',
    effect: {
      creates: ['Wisp'],
      run: (g, ctx) => { g.spawnUnit(ctx.controller, 'Wisp', ctx.region, { token: true }); },
    },
  }],
});
