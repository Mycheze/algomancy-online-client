/* Light & Dark expansion — batch hybrids-ld-a (19 cards).
 *
 * Behaviour only; printed data comes from printed.json (never hand-copied).
 * Spec for the expansion's new mechanics: docs/08-light-and-dark.md,
 * and the Comprehensive Rules.
 *
 * Every card in this batch is a HYBRID whose second element is light or dark.
 * Printed text is quoted in a comment above each card, for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: CR 109.3a, 109.3b (trigger conditions at event time, amounts at
 * resolution), CR 704.6, 704.6b (fizzle vs partial), CR 704.1a (mid-resolution choices via
 * ctx.choose, plan-then-commit), CR 803.4 (bounded [Switch1]/[once] budgets, per
 * card, reset at start of turn), CR 601.1b, 601.4d ("each player" / "your units" read
 * the region's present seats / unitsOf(region)), CR 107.8 (amounts are live at
 * resolution), CR 601.5 (created units spawn where their SOURCE is — ctx.region;
 * the old home-region default is withdrawn),
 * CR 702.4 (bracketed cast-time costs), CR 701.2 (applying a mod is not playing a
 * card), CR 112.13 (rot), CR 112.14 (debt), CR 801.2 (trash), CR 403.1, 801.9e (cache + glimpse
 * permission), CR 803.7, 803.7g (prophecy — the Big Glimpse Card banner is engine
 * side), CR 802.22, 802.24 ({Blessed} / {Lethal} are engine side).
 *
 * ⚠ ENGINE APPROXIMATIONS in this batch:
 *  - HYPER BEAM's printed "[Gain 4 debt]" bracketed cast cost (printed.gainDebt
 *    = 4) is now consumed by the engine (CR 112.14c): playAtTiming charges it as the
 *    card is played, before the item reaches the stack, so a negated Hyper Beam
 *    still costs its caster the debt. The card's own effect no longer touches
 *    debt at all.
 *  - ABYSSAL EXTORTIONIST's "life equal to the damage dealt this way" uses the
 *    sacrificed unit's power, i.e. the amount the effect DEALT. A {Vulnerable}
 *    victim receiving double does not gain the extra (dealEffectDamage returns
 *    nothing to read back). Sacrificing the very unit that was targeted is
 *    detected: no damage, no life.
 * ✔ "GAINS CONTROL" (Bloppert) is E.giveControl and is no longer an
 *    approximation. This entry used to read "flip Entity.controller and drop
 *    out of any formation; regroup then walks the unit home". CR 711.2, 711.4: the mods
 *    change controller with the unit, and the walk home happens AT ONCE when
 *    the new controller is not present in the region — see batch-hybrids-wm-b's
 *    header, which this used to defer to for the older wording.
 *  - ZEPHYRZOA's "when my column deals combat damage to an opponent" is the
 *    Bloodwind Revenant / Rippleback Skulker reconstruction: combat damage to a
 *    player emits only 'lifeLost' ({ why: 'combat' }), with no column
 *    attribution, so when() rebuilds "my column connected" (attacking and never
 *    blocked, or Piercing / a Piercing blocking column). the owner's 2026-08-25 answer (now CR 608.9a)
 *    moved that reconstruction into ONE engine predicate,
 *    E.columnDealtCombatDamage, shared with Vroot, Eldritch Dreamtender and
 *    Blightmound; "to an opponent" is what makes this card ask for the FACE
 *    channel alone. Zephyrzoa's power gate (the LIVE COLUMN's total, not the
 *    anchor's own) was already the reading the ruling confirmed.
 *    "Erase me" deletes the entity and its mods without a bin, a death or a
 *    despawn — resolution has no erase hook, so it is done inline (the
 *    Reconfigure precedent).
 *  - DREAM LAPSE's "recall target spell effect" is removeFromStack() (CR 801.7d)
 *    with a different destination: the item leaves the stack and its CARD goes
 *    to its controller's hand rather than to a bin. A triggered/activated item
 *    or a spell token has no card to recall, so it simply ceases to exist.
 *  - BIG GLIMPSE CARD: the printed text never says who picks which pile is
 *    cached (see the flagged-text note below); implemented as "the opponent
 *    splits, the caster chooses", the standard split-and-choose shape.
 *  - "EACH PLAYER" (Mindburn, Pale Tormentor, Uglk) is region-scoped (CR 601.4d),
 *    walked in the region's presentSeats order. Bloppert's "the player with the
 *    highest life total" is a global superlative and reads all seats.
 *
 * CR 601.4d (owner, 2026-08-28) — REGION SCOPING IS ABSOLUTE, AND IT IS NOT ONLY
 * ABOUT LOOPS. "No. Only players that are in the region as an effect can even
 * see that it exists. So anything that happens in a region where a player or
 * unit currently isn't is 100% ignored, as if that effect didn't exist."
 * Two cards in THIS file named an OPPONENT rather than looping over one, and
 * both wrote `region.find(…) ?? (1 - seat)` — Uglk's recipient and Big Glimpse
 * Card's splitter. The `??` arm reached a player CR 601.4d says is not there. It is
 * gone from both: with no opponent in the region they announce and do nothing,
 * which is what the rest of the pool already did. `1 - <seat>` must not appear
 * in a card effect again — `208-region-scoping-is-absolute.test.ts` is the
 * whole-file guard on that, and it convicted a third card outside this file
 * (Rebalance, batch-wood-c) which never asked the region at all.
 *
 * ⚠ PRINTED TEXT FLAGGED (transcription is vision-model output and does contain
 *    errors — reported, never silently "fixed"):
 *  - Big Glimpse Card: "Target opponent splits them into two piles. Cache one
 *    pile." — no agent is named for "cache one pile", and "the top 7 cards of
 *    the deck" does not say whose deck (read as the caster's).
 *  - Bloppert: "the player with the highest life total" has no tie-breaker; on
 *    a tie this card does nothing at all (control and the 5 life both hang off
 *    the same subject).
 *  - Burden of Life / The Mighty Doot: "your life total" / "an opponent has
 *    more than you" on a [Augment] {Virus} — the engine's standing anchoring
 *    rule (a donated static reads from its HOST) makes "you" the HOST's
 *    controller when the card is applied as a virus/augment. Flagged because a
 *    virus is normally applied to an ENEMY unit, where the other reading
 *    ("you" = the applier) is at least as natural.
 *
 * UNPARKED by the COPY LAYER (CR 710.1):
 *  - APEX PRIME is WHOLE. "All of your units become a copy of target unit
 *    until regroup" is now one `E.becomeCopy` face carrying every facet —
 *    name, stats, attrs, statics, triggered/[Augment] text — with
 *    `until: 'regroup'`, the card's own printed duration. The old four-grant
 *    approximation (setBase + addTempAttr + two grantText channels) is gone:
 *    it could carry neither the name nor the statics, and its stats sat at
 *    layer 2 where a copy belongs at layer 0.
 *    ⚠ ONE FACET IS STILL OWED, and it is not this card's: apply.ts's
 *    `pushActivatedOptions` and `activationSource` read
 *    `getCard(u.card).abilities` rather than the face, so a COPIED ACTIVATED
 *    ability is stamped on the entity and never offered. Two lines in a file
 *    this batch does not own; the engine side (`E.facesWith(u, 'activated')`)
 *    is built and waiting.
 *
 * UNPARKED by the costs-and-events engine wave:
 *  - Debt Plant hears the new 'endOfHaste' event (a trigger, not a static —
 *    the amount is latched at that instant).
 *  - Hyper Beam's [Gain 4 debt] is a real cast cost, charged by playAtTiming.
 */
import type { CardName, EngineEvent, Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, isSpellEffect, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt, manaOf, isUnitCard, pickUnit } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** the seats physically in a region right now (CR 601.4) */
/** CR 601.4c: `E.seatsHere` is the one answer for the whole pool. SIX files had
 * grown their own copy of this and they did NOT agree — most ordered it
 * initiative-first, batch-hybrids-ld-a took `presentSeats` raw. */
const presentSeats = (g: E, region: number): Seat[] => g.seatsHere(region);

/** the UNIT cards in `seat`'s bin, as [name, binIndex] pairs */
const binUnits = (g: E, seat: Seat): [CardName, number][] =>
  g.player(seat).bin
    .map((n, i) => [n, i] as [CardName, number])
    .filter(([n]) => isUnitCard(n));

/** "erase me" (Zephyrzoa): the unit and its mods cease to exist — no bin, no
 * death, and so (CR 801.2c, Caleb: erasing never touches a bin) no trash either.
 *
 * this is now a shim over `E.eraseFromPlay`, the engine choke point.
 * The hand-rolled body it replaces was written before that primitive existed
 * and had drifted three ways from it: it never turned a transformed card back
 * over (CR 407.4, so the erased pile recorded the BACK face), it fired no
 * despawn (CR 801.6a — an erase is not a death but it IS a despawn), and it
 * spliced the formation columns without `repairFormation` (CR 602.5b). Its comment
 * also still claimed "no despawn, so nothing triggers off it", which is the
 * sentence the erase-is-a-despawn ruling (now CR 801.6a) overturned. */
const eraseUnit = (g: E, u: Entity): void => { g.eraseFromPlay(u); };

/** ⚠ "my column deals combat damage TO AN OPPONENT" (see header): the shared
 * engine predicate, on the FACE channel only. The "to an opponent" narrowing
 * is exactly what excludes the unit-damage channels — this text pays out on
 * damage dealt to a PLAYER, so it hears the aggregated combat 'lifeLost' and
 * nothing else. Everything else (CR 608.9a's sub-step gate, the live-column
 * power gate, the connect test) lives in E.columnDealtCombatDamage, which
 * Vroot, Eldritch Dreamtender and Blightmound now share — the three-way
 * divergence this comment used to flag is gone.
 *
 * CR 608.9a (owner, 2026-08-25): the power gate is the COLUMN's, never the
 * anchor's own — "0 power units do no damage. But the other thing in the
 * column can still contribute to the shared column power." This reading was
 * already right; it is now the only reading. */
const myColumnConnected = (g: E, self: Entity, ev: EngineEvent): boolean =>
  g.columnDealtCombatDamage(self, ev, ['face']);

// ═══════════════════════ LIGHT / FIRE (lr) ════════════════════════════

// "When I attack or block, [Switch1] Sacrifice a unit. If you do, I deal
// damage equal to its power to any target. You gain life equal to the damage
// dealt this way." — lr/5 5/3 Cosmic Horror Unit. Bounded cause + bounded
// graft ([Switch1], CR 722.5). The target is picked at cast; the sacrifice is a
// mid-resolution choice (CR 704.1a) over MY units in the region — "sacrifice a unit"
// is not optional, so the only choice is which (auto when forced). Power is
// snapshotted at the sacrifice (CR 714.1, live at resolution). ⚠ header: the life
// gain equals what was DEALT, and sacrificing the targeted unit deals nothing.
const extortion: EffectDef = {
  targets: { what: 'any', prompt: 'Abyssal Extortionist: sacrifice a unit — I deal its power to any target' },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!t) return;
    const pool = g.unitsOf(ctx.controller, ctx.region);
    if (!pool.length) {
      g.ev('info', 'Abyssal Extortionist: no unit to sacrifice — no damage.');
      return;
    }
    const id = pickUnit(ctx, 'sac', ctx.controller, pool,
      'Abyssal Extortionist: sacrifice which unit?')!;
    const sac = g.entity(id);
    if (!sac) return;
    const power = Math.max(0, g.effStats(sac)[0]);
    g.destroy(sac, 'is sacrificed');
    if (power <= 0) {
      g.ev('info', 'Abyssal Extortionist: the sacrificed unit had no power — no damage.');
      return;
    }
    if (isEnt(t) && !g.entity(t.id)) {
      g.ev('info', 'Abyssal Extortionist: the target is gone — no damage, no life.');
      return;
    }
    g.dealEffectDamage(ctx, t, power);
    g.gainLife(ctx.controller, power, 'Abyssal Extortionist');
  },
};
card('Abyssal Extortionist', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    bounded: true, graftCause: true,
    label: 'sacrifice a unit: I deal its power to any target and you gain that much life',
    effect: extortion,
  }],
  graftEffect: { bounded: true, effect: extortion },
});

// "I deal 8 damage to target unit. Draw a card." + the printed bracketed cast
// cost "[Gain 4 debt]" (printed.gainDebt = 4) — lr/4 {Battle} Cosmic Horror
// Spell. CR 112.14c: printed.gainDebt is now a real CAST cost — playAtTiming charges
// it as the card is played, before the item reaches the stack, so a negated
// Hyper Beam still cost its caster the 4 debt. Nothing to do here any more.
card('Hyper Beam', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Hyper Beam: deal 8 damage to target unit' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (isEnt(t)) g.dealEffectDamage(ctx, t, 8);
      g.draw(ctx.controller, 1);
    },
  },
});

// ═══════════════════════ LIGHT / WATER (lb) ═══════════════════════════

// "Reveal the top 7 cards of the deck. Target opponent splits them into two
// piles. Cache one pile. You may play those cards until end of turn, ignoring
// affinity. Recycle the other pile." — lb/4 {Battle} Cosmic Horror Spell, and
// it prints a "[4] Prophecy — Two Turns Pass" banner (engine side, CR 803.7).
// CR 110.1a: "Target opponent" is a DECLARED target, chosen as the spell goes on
// the stack. In 1v1 it is forced, so the collector fills it without asking —
// but it is now visible on the stack and judged by the same rules as any
// other target, instead of being re-derived at resolution.
// CR 601.4d: an UNDECLARED opponent is looked up in the region and nowhere else —
// the old `?? (1 - ctx.controller)` arm is gone. (The declared arm needs no
// presence test of its own: `E.pushPlayerTargets` builds the 'opponent'
// candidate list out of `regions[region].presentSeats`, so a target the cast
// window offered is a seat that was in the region.)
// ⚠ header: "the deck" is read as the caster's (shared in shared mode); the
// OPPONENT splits (picking cards into pile 1 until done) and the CASTER
// chooses which pile is cached. The cached pile gets glimpse-style permission
// — playable until end of turn, ignoring affinity, mana still paid (CR 801.9e) —
// which is exactly cacheCard's `playable` flag. Plan-then-commit: every choice
// is requested before the deck is touched.
card('Big Glimpse Card', {
  spellEffect: {
    // CR 110.7: the opponent is a required target (no "up to"), so with no
    // opponent in the region the spell is not castable.
    targets: { what: 'opponent', prompt: 'Big Glimpse Card: target opponent splits the 7' },
    run: (g, ctx) => {
      // CR 601.4d (owner, 2026-08-28) — REGION SCOPING IS ABSOLUTE: "Only players
      // that are in the region as an effect can even see that it exists. So
      // anything that happens in a region where a player or unit currently
      // isn't is 100% ignored, as if that effect didn't exist."
      //
      // This used to read `… ?? (1 - ctx.controller)`: with no opponent in the
      // region it reached for THE OTHER SEAT and made an absent player split
      // the piles. There is no "prefer the region, fall back to the other
      // seat" — with nobody here to split, the spell does nothing, which is
      // what every other region-scoped card in the pool already does.
      //
      // Asked BEFORE the deck is touched, so a region holding no opponent does
      // not reveal seven cards either: the effect did not exist.
      const t = ctx.targets[0];
      const opp = (t && 'player' in t) ? t.player
        : presentSeats(g, ctx.region).find(s => s !== ctx.controller);
      if (opp === undefined) {
        g.ev('info', 'Big Glimpse Card: no opponent is in this region — '
          + 'there is nobody to split the piles, so nothing is revealed.');
        return;
      }
      // CR 408.2b (report #268): seven off a short deck reach the mark and
      // reshuffle the recycle pile in — after the CR 601.4d check above, so an
      // effect that does not exist here shuffles nothing either
      const revealed = g.revealTop(ctx.controller, 7);
      if (!revealed.length) { g.ev('info', 'Big Glimpse Card: the deck is empty.'); return; }
      // CT-302 / report #219: a typed public reveal (same log line). The
      // OPPONENT is the chooser — the split below shows them the seven as
      // scans — so it is the CASTER's client that pops them as cards: the pile
      // question it is asked next names them only in its labels.
      g.ev('revealed', `Big Glimpse Card reveals: ${revealed.join(', ')}.`, {
        seat: ctx.controller, n: revealed.length, cards: revealed, source: 'Big Glimpse Card',
        chooser: opp,
      });
      // the opponent splits: pick cards into pile 1 until "Done"
      const pile1: number[] = [];
      for (let k = 0; k < revealed.length; k++) {
        const left = revealed
          .map((n, i) => [n, i] as [CardName, number])
          .filter(([, i]) => !pile1.includes(i));
        if (!left.length) break;
        const v = ctx.choose(`split:${k}`, {
          kind: 'payOrDecline', seat: opp,
          prompt: `Big Glimpse Card: split the 7 — put a card into pile 1 (${pile1.length} so far)`,
          options: [
            ...left.map(([n, i]) => ({ label: n, value: i as unknown, card: n })),
            { label: 'Done splitting', value: false },
          ],
        });
        if (v === false) break;
        pile1.push(v as number);
      }
      const a = revealed.filter((_, i) => pile1.includes(i));
      const b = revealed.filter((_, i) => !pile1.includes(i));
      const which = ctx.choose('pile', {
        kind: 'payOrDecline', seat: ctx.controller,
        prompt: 'Big Glimpse Card: cache which pile? (the other is recycled)',
        options: [
          { label: `Pile 1: ${a.join(', ') || '(empty)'}`, value: 'a' },
          { label: `Pile 2: ${b.join(', ') || '(empty)'}`, value: 'b' },
        ],
      });
      const keep = which === 'a' ? a : b;
      const recycled = which === 'a' ? b : a;
      // commit
      g.takeTop(ctx.controller, revealed.length);
      for (const n of keep) g.cacheCard(ctx.controller, n, 'deck', { playable: true });
      for (const n of recycled) g.recycleToBottom(ctx.controller, n);
      g.ev('info',
        `Big Glimpse Card: cached ${keep.join(', ') || '(nothing)'}; recycled ${recycled.join(', ') || '(nothing)'}.`);
    },
  },
});

// "[4] Ambush [Battle]  (Damage dealt by a blessed source causes its
// controller to gain that much life.)" — lb/6 7/4 {Blessed} Cosmic Jellyfish
// Unit. No rules text of its own: {Blessed} comes from the printed attribute
// (CR 802.22b, engine side — the gain lands on the same game-state check as the
// damage) and the "[4] Ambush" line is printed.ambush, an engine play mode
// (CR 803.6). Registered so it enters DECK_LIST.
card('Shib', {});

// ═══════════════════════ LIGHT / EARTH (le) ═══════════════════════════

// "[Augment] I gain -X/-X, where X is your life total." — le/4 20/20 {Virus}
// Cosmic Unit. A statics-only [Augment] (augmentable): the projection affects
// only the anchor itself, and X is read LIVE off the controller's life. As a
// unit in play that is "a 20/20 minus your life"; applied as a virus/augment
// the same text shrinks the HOST — ⚠ header: the anchoring rule makes "your"
// the host's controller. dp/dt must never call effStats (reentrancy guard);
// a life total is a raw field, so this is safe.
card('Burden of Life', {
  augmentable: true,   // text-box [Augment]: the static transfers when applied
  // CR 721.1: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    statics: [{
      affects: (_g, self, t) => t.id === self.id,
      dp: (g, self) => -g.player(self.controller).life,
      dt: (g, self) => -g.player(self.controller).life,
    }],
  },
});

// "[Augment] Your units gain +1/+1 for every 3 life an opponent has more than
// you." — le/5 3/3 {Virus} Cosmic Unit. Statics-only [Augment] (augmentable),
// region-scoped by staticsFor (CR 601.1d) and anchored on the host when applied.
// "An opponent" is the best-off opponent (in 1v1, simply the other seat); the
// bonus is floor(lead / 3) and never negative. Raw life fields only — no
// effStats call (reentrancy).
/**
 * The bonus, against a GIVEN set of seats.
 *
 * ⚠ ONE ARITHMETIC, TWO CALLERS, and that is deliberate. The real static
 * passes the seats present in my region (CR 101.6: "an opponent" is an opponent
 * IN MY REGION — a seat that is not here does not exist for this card and
 * cannot define the bonus). The preview passes the seats I would meet in a
 * battle. A preview computed separately from the rule is one that can come to
 * disagree with it, which is worse than no preview at all.
 */
const dootBonusFor = (g: E, self: Entity, seats: readonly Seat[]): number => {
  const mine = g.player(self.controller).life;
  let lead = 0;
  for (const seat of seats) {
    if (seat === self.controller) continue;
    lead = Math.max(lead, g.player(seat).life - mine);
  }
  return Math.floor(lead / 3);
};
const dootBonus = (g: E, self: Entity): number => dootBonusFor(g, self, g.seatsHere(self.region));
card('The Mighty Doot', {
  augmentable: true,
  /**
   * Region scoping (CR 101.6) left this card worth nothing in a home region — correctly, because no
   * opponent is standing there — and the owner asked for the number you WILL
   * get anyway: *"They don't get the bonus in deployment, but it'd help with
   * decision making at least."*
   *
   * Said only when it differs from what is applying now, so the note is news
   * rather than a restatement of the stats already printed on the card.
   */
  previewNote: (g, self, seats) => {
    const soon = dootBonusFor(g, self, seats);
    if (soon <= 0 || soon === dootBonus(g, self)) return null;
    return `+${soon}/+${soon} in battle`;
  },
  // CR 721.1: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    statics: [{
      affects: (_g, self, t) => t.kind === 'unit' && t.controller === self.controller,
      dp: dootBonus,
      dt: dootBonus,
    }],
  },
});

// ═══════════════════════ LIGHT / WOOD (lg) ════════════════════════════

// "[Augment] After combat, the player with the highest life total gains
// control of me, then loses 5 life." — lg/2 5/5 {Virus} Horror Unit. Text-box
// [Augment], live when played normally (Manual Q&A) and donated when applied
// — "me" then reads as the HOST (the standing anchoring rule). afterCombat
// carries no source unit, so the ability is not self-guarded; the anchor is
// ctx.sourceId. ⚠ header: gaining control is the wm-b approximation, and the
// superlative is global (all seats), not region-scoped. ⚠ flagged text: a TIE
// has no "the player with the highest life total", so nothing happens at all.
card('Bloppert', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'the player with the highest life total gains control of me, then loses 5 life',
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) { g.ev('info', 'Bloppert: the carrier is gone — no control change.'); return; }
        let best = -Infinity;
        let winners: Seat[] = [];
        // CR 601.1c: the superlative reads THIS REGION. A player who is not here
        // cannot decide who gains control of a unit standing here.
        for (const p of g.seatsHere(self.region).map(s => g.player(s))) {
          if (p.life > best) { best = p.life; winners = [p.seat]; }
          else if (p.life === best) winners.push(p.seat);
        }
        if (winners.length !== 1) {
          g.ev('info', `Bloppert: life totals are tied at ${best} — no single highest player, nothing happens.`);
          return;
        }
        const seat = winners[0]!;
        g.giveControl(self, seat);
        g.loseLife(seat, 5, 'Bloppert');
      },
    },
  }],
});

// "[Augment] At the end of [Haste], your units gain +1/+0 until regroup for
// every 2 expended resources you have." — lg/3 3/2 Cosmic Plant Unit.
// ERRATA 2026-09-21 (algomancer.cc revision v2, read off the new scan): the
// printed bonus was +1/+1 and is now +1/+0 — power only.
// CR 504.6: the haste step now closes with an 'endOfHaste' event fired inside a
// settle() window, so this is an ordinary triggered ability — and a TRIGGER is
// the right shape, because the amount is LATCHED at that instant ("until
// regroup") rather than tracking the resource count afterwards.
// Text-box [Augment], so "your" is the HOLDER's controller (the host when
// donated). CR 601.1b: "your units" is the holder's units in its own region.
card('Debt Plant', {
  augmentText: [{
    type: 'triggered', events: ['endOfHaste'],
    label: 'at the end of [Haste], your units gain +1/+0 per 2 expended resources',
    effect: {
      run: (g, ctx) => {
        const expended = g.player(ctx.controller).resources.filter(r => r.state === 'expended').length;
        const n = Math.floor(expended / 2);
        if (n <= 0) {
          g.ev('info', `${ctx.sourceName}: fewer than 2 expended resources — no bonus.`);
          return;
        }
        for (const u of g.unitsOf(ctx.controller, ctx.region)) g.addTemp(u, n, 0);
      },
    },
  }],
});

// "[Augment][once] When you gain or lose life, create that many 1/1 units.
// (Damage causes loss of life)" — lg/7 7/3 Cosmic Fungus Unit. Text-box
// [Augment]; "[once]" is a bounded budget (CR 803.4, per card, reset each turn).
// Both directions count, and only MY life changes do ("when YOU gain or lose")
// — checked at event time against the anchor's controller (CR 109.3a). "That many" is
// the event snapshot's amount. ⚠ CR 304.8a settles where the units land, and it came from
// THIS CARD's report (#83): a CREATED unit arrives where its SOURCE currently
// is, so a Life Plant fighting in the enemy region mints its 1/1s THERE — in
// no column, unable to block the counterattack — and they walk home at
// regroup. (Earlier readings had moved this card to home; CR 601.5, the Ember of Life
// carrier reading made general, puts it where its source is.)
card('Life Plant', {
  augmentText: [{
    type: 'triggered', events: ['lifeGained', 'lifeLost'], bounded: true,   // [once]
    label: 'create that many 1/1 units (you gained or lost life)',
    when: (_g, self, ev) => ev.data?.seat === self.controller,
    effect: {
      creates: ['Unit Token'],
      run: (g, ctx) => {
        const n = (ctx.event?.data?.n as number | undefined) ?? 0;
        for (let i = 0; i < n; i++) {
          // CR 601.5: a created unit arrives where its SOURCE is (ctx.region)
          g.spawnUnit(ctx.controller, 'Unit Token', ctx.region,
            { token: true, tokenStats: [1, 1] });
        }
      },
    },
  }],
});

// ═══════════════════════ LIGHT / METAL (lm) ═══════════════════════════

// "[Augment] When I attack or block, if your life total is odd, you may have
// all of your units become a copy of target unit until regroup." — lm/4 4/4
// Technology God Unit.
//
// CR 710.1 — the COPY LAYER. This card is WHOLE: the name, the base stats, the
// attributes, the statics, the triggered/[Augment] text and the activated
// abilities all travel, as ONE face rather than four separate grants.
// (The activated facet landed with the copy layer's second half, which pointed
// pushActivatedOptions and activationSource at E.facesWith rather than at
// getCard(u.card).abilities.)
//
// `E.becomeCopy` stamps an `Entity.copies` face carrying every facet, with
// `until: 'regroup'` — this card's printed duration, and the reason it needs
// the layer rather than the transform's in-place rewrite of `Entity.card`: a copy has
// to REVERT, and a rewrite would also destroy the physical card (CR 201.5 —
// a copy still bins as itself).
//
// The old four-grant approximation (E.setBase + E.addTempAttr + two E.grantText
// channels) is GONE. It could not carry the name or the statics at all, and
// its base-stat half sat at layer 2, which meant a copied body outranked a
// later "becomes a base 4/4" instead of being overwritten by it.
//
// Still region-scoped ("your units" — CR 601.1b, the Flowstone Arcanite reading),
// the "you may" answered at the target step (CT-309: no target is the decline,
// a target is the yes — nothing more is asked at resolution), and still
// idempotent across attacking and then blocking in the same battle (the face
// is a replacement, and `E.isCopyOf` skips the re-stamp so the log stays quiet).
card('Apex Prime', {
  augmentText: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    label: 'all of your units become a copy of target unit until regroup',
    // CR 109.3a: the condition is checked at EVENT time. Text-box [Augment], so "your"
    // is the HOLDER's controller — the host's, when this is donated.
    when: (g, self) => g.player(self.controller).life % 2 === 1,
    effect: {
      targets: { what: 'unit', may: true, prompt: 'Apex Prime: you may have all of your units become a copy of target unit until regroup' },
      run: (g, ctx) => {
        if (!ctx.targets.length) { g.ev('info', 'Apex Prime: the copy is declined.'); return; }
        const t = ctx.targets[0];
        if (!isEnt(t) || !g.entity(t.id)) {
          g.ev('info', 'Apex Prime: the target is gone — nothing is copied.');
          return;
        }
        const src = g.entity(t.id)!;
        // CR 601.1b: "your units" is region-scoped, the Flowstone Arcanite reading
        const mine = g.unitsOf(ctx.controller, ctx.region);
        if (!mine.length) { g.ev('info', 'Apex Prime: you have no units here.'); return; }
        // CR 710.4: the copy is of the FACE — a Borrower already wearing a Good
        // Whale is copied AS a Good Whale (a copy of a copy chains via the face)
        const face = g.nameOf(src);
        g.ev('info', `Apex Prime: ${mine.length} unit(s) become a copy of ${face} until regroup.`);
        for (const u of g.unitsOf(ctx.controller, ctx.region)) {
          if (!g.entity(u.id)) continue;             // a copied 0-defense body is lethal
          if (u.id === src.id) continue;             // the original already IS itself
          if (g.isCopyOf(u, face)) continue;         // attack then block: one face, not two
          g.becomeCopy(u, src, { from: 'Apex Prime', until: 'regroup' });
        }
      },
    },
  }],
});

// ═══════════════════════ LIGHT / DARK (ld) ════════════════════════════

// "[Switch1] Put target unit from your bin into play. You gain debt equal to
// its cost." — ld/3 Cosmic Spell (deployment timing). CR 110.1a: the bin IS a
// targetable zone now ('binCard', CR 110.3), so the printed "target" is a
// DECLARED target chosen as the item goes on the stack — it used to be a
// mid-resolution pick, which put the Covenant on the stack aiming at nothing.
// "Its cost" is the printed mana of the card put into play, taken as debt
// (CR 112.14); an X unit counts as 0 (there is no X to have chosen). Bounded graft
// ([Switch1], CR 722.5).
const covenant: EffectDef = {
  targets: {
    what: 'binCard',
    prompt: 'Covenant of the Damned: put target unit from your bin into play (you gain debt equal to its cost)',
    restrict: (_g, t) => 'binCard' in t && isUnitCard(t.binCard.card),
  },
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!t || !('binCard' in t) || t.binCard.index === -1) {
      g.ev('info', 'Covenant of the Damned: no unit in your bin — no effect.');
      return;
    }
    const took = g.takeFromBin(ctx.controller, t.binCard.index, 'revived');   // CR 405.7
    if (took === undefined) return;
    const name = took.card;
    g.spawnUnit(ctx.controller, name, ctx.region, { owner: took.owner });   // CR 102.4
    g.gainDebt(ctx.controller, manaOf(name));   // CR 112.14
  },
};
card('Covenant of the Damned', {
  spellEffect: covenant,
  graftEffect: { bounded: true, effect: covenant },
});

// "[Augment] After combat, each player with an even life total gains two
// rot." — ld/3 1/6 Cosmic Unit. Text-box [Augment], live when played normally
// and donated when applied. "Each player" is region-scoped (CR 601.4d), walked in
// initiative order so the rot events are deterministic on replay (CR 112.13: gaining
// rot is not damage — it only bites at the start of the next deployment).
card('Pale Tormentor', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'each player with an even life total gains two rot',
    effect: {
      run: (g, ctx) => {
        const here = new Set(presentSeats(g, ctx.region));
        let hit = 0;
        for (const seat of [g.initiative, g.nit]) {
          if (!here.has(seat)) continue;
          const life = g.player(seat).life;
          if (life % 2 !== 0) continue;
          g.ev('info', `Pale Tormentor: ${g.pname(seat)}'s life total (${life}) is even.`);
          g.gainRot(seat, 2);   // CR 112.13
          hit++;
        }
        if (!hit) g.ev('info', 'Pale Tormentor: nobody here has an even life total — no rot.');
      },
    },
  }],
});

// ═══════════════════════ WATER / DARK (bd) ════════════════════════════

// "Recall target spell effect, then its controller discards a card." — bd/2
// {Battle} Mystic Spell. ⚠ header: "recall" is not "negate" — negation's removal (CR 704.4)
// with a different destination. The item leaves the stack and its CARD goes
// back to its controller's HAND (so it is never binned, and never trashed: CR 801.2
// only fires on a bin). An item with no card of its own (a triggered/activated
// ability, a spell token) simply ceases to exist.
// The discard is the item's controller's own choice (CR 704.1a), and it is a TRASH
// (CR 801.3) — discardFromHand handles that.
card('Dream Lapse', {
  spellEffect: {
    targets: { what: 'stackSpell', prompt: 'Dream Lapse: recall target spell effect' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('stack' in (t as object))) return;
      const stackId = (t as { stack: number }).stack;
      // removeFromStack() is the bare primitive — the item leaves the
      // stack and NOTHING is done with its card. negate() would bin it, and
      // then the recall below would put a second copy in hand.
      const it = g.removeFromStack(stackId);
      if (!it) {
        g.ev('info', 'Dream Lapse: the targeted spell effect has already left the stack — nothing is recalled.');
        return;
      }
      g.ev('negated', `${it.label} is recalled off the stack.`, { id: it.id });
      // Its target is a spell effect (`isSpellEffect`, the 'stackSpell' kind),
      // so the card behind it is a spell or a spell unit — or a spell token,
      // which has no card to return (below). Derived from the same predicate,
      // never a second kind list: an Ambush is not a spell (report #218).
      const recallable = it.card !== undefined && it.kind !== 'spellToken' && isSpellEffect(it.kind);
      if (recallable) {
        // CR 402.4: off the STACK and into a hand — `from: 'stack'`
        g.toHand(it.controller, it.card!, 'stack');
        g.ev('info', `Dream Lapse: ${it.card} is recalled to ${g.pname(it.controller)}'s hand.`);
      } else if (it.kind === 'spellToken' && !it.copy) {
        // CR 801.7d: a spell token enters the hand and is erased from it
        g.recallSpellTokenItem(it, 'Dream Lapse');
      } else {
        g.ev('info', `Dream Lapse: ${it.label} has no card to recall — it is simply gone.`);
      }
      // "then its controller discards a card"
      const seat = it.controller;
      const hand = g.player(seat).hand;
      if (!hand.length) {
        g.ev('info', `Dream Lapse: ${g.pname(seat)} has no card to discard.`);
        return;
      }
      const di = hand.length === 1 ? 0 : ctx.choose('discard', {
        kind: 'payOrDecline', seat,
        prompt: 'Dream Lapse: discard a card',
        options: hand.map((n, k) => ({ label: n, value: k as unknown, card: n })),
      }) as number;
      g.discardFromHand(seat, di);   // CR 801.3: discarding is trashing
    },
  },
});

// "[Augment] When my column deals combat damage to an opponent, recall your
// bin and erase me." — bd/4 1/1 Spirit Cloud Unit. Text-box [Augment]; "my
// column"/"me" read from the HOST when donated. ⚠ header: the column-connected
// test is reconstructed at event time from the combat 'lifeLost' (CR 109.3a), and
// "recall" means "put into your hand" (Manual) — the whole bin at once.
// "Erase me" removes the anchor and its mods without a bin and without a
// death (CR 801.2c: erasing is never trashing). CR 801.6a: it IS a despawn, and fires
// one — "not a death, but it is a despawn" (the owner, 2026-08-25).
card('Zephyrzoa', {
  augmentText: [{
    // CR 608.8a: `combatFaceDamage`, not `lifeLost` — a combat hit that is REPLACED
    // (Blightsea Polyp, Oorblak) was still DEALT, and costs no life, so it
    // emits no `lifeLost` at all. Listening on the old event made Zephyrzoa
    // silently blind to every hit while a Polyp was out. ⚠ REPLACE, never add:
    // a replaced hit that also costs life would fire this twice.
    type: 'triggered', events: ['combatFaceDamage'],
    label: 'recall your bin and erase me (my column connected)',
    when: (g, self, ev) => myColumnConnected(g, self, ev),
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        const bin = g.player(ctx.controller).bin;
        const n = bin.length;
        if (n) {
          // CR 405.7: per card, back-to-front — each removal fires its own
          // 'leftBin'; the order into the hand is preserved
          const moved: { card: CardName; owner: Seat }[] = [];
          while (bin.length) moved.unshift(g.takeFromBin(ctx.controller, bin.length - 1, 'recalled')!);
          // CR 706.6a: the whole bin arrives at once — ONE 'handEntered'.
          // CR 102.4 / CT-344: each card with the owner it had in the bin
          g.toHand(ctx.controller, moved.map(m => m.card), 'bin', { owner: moved.map(m => m.owner) });
          g.ev('info', `Zephyrzoa: ${g.pname(ctx.controller)} recalls their whole bin (${n} card(s)) to hand.`);
        } else {
          g.ev('info', 'Zephyrzoa: the bin is empty — nothing to recall.');
        }
        if (self) eraseUnit(g, self);
      },
    },
  }],
});

// ═══════════════════════ EARTH / DARK (ed) ════════════════════════════

// "(Any combat damage from a lethal unit will kill a player.)" — ed/9 1/4
// {Lethal} Insect Unit. Reminder text only: {Lethal} is the printed attribute
// and is entirely engine side (CR 802.24a — combatSubStep calls killPlayer for every
// player hit whose column carries it). Registered so it enters DECK_LIST.
card('Gublin', {});

// "Put all unit mods applied to target unit into play under their controller's
// control." — ed/3 {Battle} Occult Spell. Only mods whose CARD is a unit
// qualify ("unit mods"); a grafted spell stays where it is. Each qualifying
// mod entity is removed and the card enters play under the MOD's controller —
// which, per attachMod, is the host's controller for anything applied to it,
// so a virus you stuck on an enemy comes back on THEIR side. A token mod (a
// Wraith augmented onto a unit) re-enters play as a unit token. Everything
// arrives in the resolving region (the Resurrect precedent).
card('Reclaim the Fallen', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Reclaim the Fallen: put all unit mods on target unit into play' },
    // CR 407.2a: the mods that leave the host keep their own card names, so what
    // reaches the board is whatever was attached. Only ONE mod in the pool is
    // a token — the Wraith (E.augmentWraith is the sole attachMod with
    // token:true) — so that is the only token this can put into play.
    creates: ['Wraith'],
    run: (g, ctx) => {
      const host = ctx.targets[0];
      if (!isEnt(host)) return;
      const mods = host.mods
        .map(id => g.entity(id))
        .filter((m): m is Entity => !!m && isUnitCard(m.card));
      if (!mods.length) {
        g.ev('info', `Reclaim the Fallen: ${host.card} carries no unit mod — no effect.`);
        return;
      }
      // CR 720.9 / CT-86: through `E.eraseMod`, which is the same unlink-and-delete
      // this hand-rolled. ⚠ `leavesGame: false` is the one thing this site says
      // that the other four do not: THIS IS NOT AN ERASE. The mod ENTITY is
      // destroyed, but the CARD is about to be put into play as a unit two
      // lines down, so it never leaves the game and must never reach the
      // public erased pile (CR 407.2a) whatever round-27's Q3 answers.
      for (const m of mods) g.eraseMod(m, { leavesGame: false });
      for (const m of mods) {
        // CARD-TODO #17: "under their CONTROLLER's control" — a mod's
        // controller is its host's (attachMod), while its OWNER is whose card
        // it is (CR 102.4 / CT-343: normally whoever applied it, but not a
        // stolen card applied out of the thief's own zone). So a virus you stuck on an enemy comes back on their
        // side, as the printed text says, but it is still your card (CR 102.4), though it goes to its controller's bin when it dies (CR 400.4). Passing only the controller made it
        // theirs outright.
        g.spawnUnit(m.controller, m.card, ctx.region,
          { owner: m.owner, ...(m.token ? { token: true } : {}) });
      }
      g.ev('info', `Reclaim the Fallen: ${mods.length} unit mod(s) leave ${host.card} and enter play.`);
    },
  },
});

// ═══════════════════════ WOOD / DARK (gd) ═════════════════════════════

// "[Augment] After combat, each player puts a unit from their bin into play
// under an opponent's control." — gd/3 3/4 Mystic Fungus Unit. Text-box
// [Augment]. "Each player" is region-scoped (CR 601.4d), each picking from their OWN
// bin (CR 704.1a, auto only when there is exactly one — the question is put even in
// the end-of-turn window, CR D1.2); the unit then enters play under the control of
// an opponent WHO IS IN THE REGION (CR 601.4d — never `1 - seat`; with nobody else
// here the clause has no recipient and the card does nothing). Plan-then-commit:
// every pick is gathered before any bin is touched.
card('Uglk', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: "each player puts a unit from their bin into play under an opponent's control",
    effect: {
      run: (g, ctx) => {
        const picks: { seat: Seat; idx: number; opp: Seat }[] = [];
        // presence cannot change inside one resolution, so the region's seats
        // are read ONCE and every "who is my opponent" answer comes from that
        // one list — the recipient is never recomputed from arithmetic.
        const here = presentSeats(g, ctx.region);
        for (const seat of here) {
          // CR 601.4d (owner, 2026-08-28) — REGION SCOPING IS ABSOLUTE: "anything
          // that happens in a region where a player or unit currently isn't is
          // 100% ignored, as if that effect didn't exist." This used to read
          // `… ?? (1 - seat)` and handed the unit to a seat that was not here.
          // There is no fallback: with no opponent in the region there is
          // nobody to give a unit to, so nothing is asked and nothing moves.
          const opp = here.find(s => s !== seat);
          if (opp === undefined) {
            g.ev('info', `Uglk: no opponent is in this region — `
              + `${g.pname(seat)} has nobody to give a unit to.`);
            continue;
          }
          const units = binUnits(g, seat);
          if (!units.length) {
            g.ev('info', `Uglk: ${g.pname(seat)} has no unit in their bin.`);
            continue;
          }
          const idx = units.length === 1
            ? units[0]![1]
            : ctx.choose(`pick:${seat}`, {
              kind: 'electricPath', seat,
              prompt: "Uglk: put which unit from your bin into play (under your opponent's control)?",
              options: units.map(([n, i]) => ({ label: n, value: i as unknown, card: n })),
            }) as number;
          picks.push({ seat, idx, opp });
        }
        for (const { seat, idx, opp } of picks) {
          const took = g.takeFromBin(seat, idx, 'revived');   // CR 405.7
          if (took === undefined) continue;
          const name = took.card;
          g.ev('info', `Uglk: ${g.pname(seat)} gives ${name} to ${g.pname(opp)}.`);
          // CARD-TODO #17: "under an opponent's control" is a CONTROL clause,
          // not a transfer of the card. It came out of `seat`'s bin, so it is
          // still `seat`'s card (CR 102.5a), but it dies to its controller's bin (CR 400.4); `opp` only
          // controls it. Before the owner option existed this handed the card
          // over permanently, which the printed text never says.
          // CR 102.4 / CT-344: the owner it had in that bin (normally `seat`)
          g.spawnUnit(opp, name, ctx.region, { owner: took.owner });
        }
      },
    },
  }],
});

// ═══════════════════════ FIRE / DARK (rd) ═════════════════════════════

// "Each player sacrifices a nontoken unit or discards a card. Repeat this X
// times." — rd/X {Battle} Mystic Spell. X is chosen and paid at cast (CR 107.2a).
// "Each player" is region-scoped (CR 601.4d); the choice is that player's own (CR 704.1a),
// mandatory when anything is available (no decline option), and each round is
// planned then committed before the next round reads fresh pools (the Maw of
// Damnation precedent). Discarding is a TRASH (CR 801.3); sacrificing a nontoken
// unit is too, since it dies into a bin from play.
card('Mindburn', {
  spellEffect: {
    run: (g, ctx) => {
      const x = ctx.x ?? 0;
      if (x <= 0) { g.ev('info', 'Mindburn: X = 0 — nothing happens.'); return; }
      for (let round = 0; round < Math.min(x, 50); round++) {
        const plan: { seat: Seat; unit?: EntityId; hand?: number }[] = [];
        for (const seat of presentSeats(g, ctx.region)) {
          const units = g.unitsOf(seat, ctx.region).filter(u => !u.token);
          const hand = g.player(seat).hand;
          const options = [
            ...units.map(u => ({ label: `Sacrifice ${u.card}`, value: `u:${u.id}` as unknown })),
            ...hand.map((n, i) => ({ label: `Discard ${n}`, value: `h:${i}` as unknown, card: n })),
          ];
          if (!options.length) continue;
          const v = options.length === 1
            ? options[0]!.value
            : ctx.choose(`pick:${round}:${seat}`, {
              kind: 'electricPath', seat,
              prompt: `Mindburn (${round + 1} of ${x}): sacrifice a nontoken unit or discard a card`,
              options,
            });
          const s = String(v);
          if (s.startsWith('u:')) plan.push({ seat, unit: Number(s.slice(2)) });
          else plan.push({ seat, hand: Number(s.slice(2)) });
        }
        if (!plan.length) {
          g.ev('info', 'Mindburn: nobody has a nontoken unit or a card — it stops.');
          break;
        }
        for (const p of plan) {
          if (p.unit !== undefined) {
            const u = g.entity(p.unit);
            if (u) g.destroy(u, 'is sacrificed');
          } else if (p.hand !== undefined) {
            g.discardFromHand(p.seat, p.hand);
          }
        }
      }
    },
  },
  // UI preview (#5): X is the caster's choice, not state-derived — nothing to
  // show, so no xPreview.
});

// ═══════════════════════ METAL / DARK (md) ════════════════════════════

// "When I attack or block, [Switch1] You may move up to two counters from
// target unit onto another target unit." — md/3 1/5 Structure Unit. Two
// distinct targets picked at cast (count/min 2 — the Reconfigure precedent):
// the first loses counters, the second gains them. Counters are ONE signed net
// int (+1/+1 and -1/-1 cancel pairwise, Manual), so "up to two counters" moves
// up to two OF THE SIGN THE SOURCE HAS. The "you may" is answered at the target
// step (CT-309: "No targets" before the first pick declines the whole ability;
// once one is picked both are required); "up to two" stays the one
// mid-resolution choice, how many. Bounded cause + bounded graft ([Switch1], CR 722.5).
const moveCounters: EffectDef = {
  targets: {
    what: 'unit', count: 2, min: 2, may: true,
    roles: 'up to two counters from {0} onto {1}',
    prompt: 'Chombot: move up to two counters — first the unit to take them from, then the unit to put them on',
  },
  run: (g, ctx) => {
    if (!ctx.targets.length) { g.ev('info', 'Chombot: declined — no counters move.'); return; }
    if (ctx.targets.length < 2) { g.ev('info', 'Chombot: a target is gone — no effect.'); return; }
    const [from, to] = [ctx.targets[0], ctx.targets[1]];
    if (!isEnt(from) || !isEnt(to)) return;
    const sign = Math.sign(from.counters);
    const avail = Math.min(2, Math.abs(from.counters));
    if (avail <= 0) {
      g.ev('info', `Chombot: ${from.card} has no counters to move — no effect.`);
      return;
    }
    const options = [{ label: 'Move none', value: 0 as unknown }];
    for (let k = 1; k <= avail; k++) {
      options.push({ label: `Move ${k} ${sign > 0 ? '+1/+1' : '-1/-1'} counter(s)`, value: k as unknown });
    }
    const n = ctx.choose('howMany', {
      kind: 'payOrDecline', seat: ctx.controller,
      prompt: `Chombot: move how many counters from ${from.card} onto ${to.card}?`,
      options,
      // BL-25/CR D7.2: an EFFECT that takes counters off a unit, not a cost — the
      // client's quantity stepper is driven by this ceiling, so it reaches
      // here too. `avail` is already `min(2, |from.counters|)`, so the stepper
      // and the option list are the same number by construction. Option VALUES
      // are unchanged (a bare amount), which is what keeps `pick(h, 2)` and
      // every saved answer working.
      counterMax: avail,
    }) as number;
    if (n <= 0) { g.ev('info', 'Chombot: no counters moved.'); return; }
    // CR 708.8: a MOVE removes from the first unit and puts on the second — the
    // removal is not a placement (no -1/-1 "put" on the source, no Flux Resonator)
    g.removeCounters(from, n);
    g.addCounters(to, sign * n);
  },
};
card('Chombot', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    bounded: true, graftCause: true,
    label: 'move up to two counters from target unit onto another target unit',
    effect: moveCounters,
  }],
  graftEffect: { bounded: true, effect: moveCounters },
});
