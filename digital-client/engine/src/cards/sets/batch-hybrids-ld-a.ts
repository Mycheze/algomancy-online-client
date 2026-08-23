/* Light & Dark expansion — batch hybrids-ld-a (19 cards).
 *
 * Behaviour only; printed data comes from printed.json (never hand-copied).
 * Spec for the expansion's new mechanics: docs/08-light-and-dark.md,
 * rulings R38-R48 in docs/digital-rules.md.
 *
 * Every card in this batch is a HYBRID whose second element is light or dark.
 * Printed text is quoted in a comment above each card, for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (trigger conditions at event time, amounts at
 * resolution), R5 (fizzle vs partial), R6 (mid-resolution choices via
 * ctx.choose, plan-then-commit), R9 (bounded [Switch1]/[once] budgets, per
 * card, reset at start of turn), R12/R25 ("each player" / "your units" read
 * the region's present seats / unitsOf(region)), R27 (amounts are live at
 * resolution), R115 (created units spawn where their SOURCE is — ctx.region;
 * this WITHDREW R28/R52 and absorbed R33),
 * R35 (bracketed cast-time costs), R37 (applying a mod is not playing a
 * card), R38 (rot), R39 (debt), R40 (trash), R41/R45 (cache + glimpse
 * permission), R42/R43/R44 (prophecy — the Big Glimpse Card banner is engine
 * side), R48 ({Blessed} / {Lethal} are engine side).
 *
 * ⚠ ENGINE APPROXIMATIONS in this batch:
 *  - HYPER BEAM's printed "[Gain 4 debt]" bracketed cast cost (printed.gainDebt
 *    = 4) is now consumed by the engine (R49): playAtTiming charges it as the
 *    card is played, before the item reaches the stack, so a negated Hyper Beam
 *    still costs its caster the debt. The card's own effect no longer touches
 *    debt at all.
 *  - ABYSSAL EXTORTIONIST's "life equal to the damage dealt this way" uses the
 *    sacrificed unit's power, i.e. the amount the effect DEALT. A {Vulnerable}
 *    victim receiving double does not gain the extra (dealEffectDamage returns
 *    nothing to read back). Sacrificing the very unit that was targeted is
 *    detected: no damage, no life.
 *  - "GAINS CONTROL" (Bloppert) is the batch-hybrids-wm-b approximation: flip
 *    Entity.controller and drop out of any formation; regroup then walks the
 *    unit home to its new controller.
 *  - ZEPHYRZOA's "when my column deals combat damage to an opponent" is the
 *    Bloodwind Revenant / Rippleback Skulker reconstruction: combat damage to a
 *    player emits only 'lifeLost' ({ why: 'combat' }), with no column
 *    attribution, so when() rebuilds "my column connected" (attacking and never
 *    blocked, or Piercing / a Piercing blocking column). "Erase me" deletes the
 *    entity and its mods without a bin, a death or a despawn — resolution has
 *    no erase hook, so it is done inline (the Reconfigure precedent).
 *  - DREAM LAPSE's "recall target spell effect" is R68's removeFromStack()
 *    with a different destination: the item leaves the stack and its CARD goes
 *    to its controller's hand rather than to a bin. A triggered/activated item
 *    or a spell token has no card to recall, so it simply ceases to exist.
 *  - BIG GLIMPSE CARD: the printed text never says who picks which pile is
 *    cached (see the flagged-text note below); implemented as "the opponent
 *    splits, the caster chooses", the standard split-and-choose shape.
 *  - "EACH PLAYER" (Mindburn, Pale Tormentor, Uglk) is region-scoped (R25),
 *    walked in the region's presentSeats order. Bloppert's "the player with the
 *    highest life total" is a global superlative and reads all seats.
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
 * UNPARKED by R118 (the COPY LAYER):
 *  - APEX PRIME is WHOLE. "All of your units become a copy of target unit
 *    until regroup" is now one `E.becomeCopy` face carrying every facet —
 *    name, stats, attrs, statics, triggered/[Augment] text — with
 *    `until: 'regroup'`, the card's own printed duration. R92's four-grant
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
 * UNPARKED by the R49/R50 engine wave:
 *  - Debt Plant hears the new 'endOfHaste' event (a trigger, not a static —
 *    the amount is latched at that instant).
 *  - Hyper Beam's [Gain 4 debt] is a real cast cost, charged by playAtTiming.
 */
import type { CardName, Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt, manaOf, isUnitCard, pickUnit } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** the seats physically in a region right now (R12/R25) */
const presentSeats = (g: E, region: number): Seat[] =>
  g.s.regions[region]!.presentSeats.slice();

/** the UNIT cards in `seat`'s bin, as [name, binIndex] pairs */
const binUnits = (g: E, seat: Seat): [CardName, number][] =>
  g.player(seat).bin
    .map((n, i) => [n, i] as [CardName, number])
    .filter(([n]) => isUnitCard(n));

/** ⚠ "erase me" (see header): the unit and its mods cease to exist — no bin,
 * no death, no despawn, so nothing triggers off it (Caleb: erasing never
 * touches a bin, so it is never a trash either — R40). */
const eraseUnit = (g: E, u: Entity): void => {
  if (!g.entity(u.id)) return;
  for (const id of u.mods) delete g.s.entities[id];
  delete g.s.entities[u.id];
  const b = g.s.battle;
  if (b) {
    for (const col of [...b.columns, ...Object.values(b.blocks)]) {
      const i = col.indexOf(u.id);
      if (i !== -1) col.splice(i, 1);
    }
    const si = b.sentAttackers.indexOf(u.id);
    if (si !== -1) b.sentAttackers.splice(si, 1);
  }
  g.ev('erased', `${u.card} is erased.`,
    { unit: u.id, card: u.card, seat: u.controller, region: u.region });
};

/** ⚠ "my column deals combat damage to an opponent" (see header): checked at
 * EVENT time on the combat 'lifeLost'. My column has to connect — attacking
 * and never blocked (or Piercing), or blocking with Piercing — in the sub-step
 * MY column strikes in (R117). */
const myColumnConnected = (g: E, self: Entity, ev: { data?: Record<string, unknown> }): boolean => {
  if (ev.data?.why !== 'combat') return false;
  const b = g.s.battle;
  if (!b) return false;
  const victim = ev.data?.seat as Seat | undefined;
  if (victim === undefined || victim === self.controller) return false;
  // R117 (owner, 2026-08-23): the trigger fires in the sub-step MY OWN COLUMN
  // strikes in — same gate, same reason, as Eldritch Dreamtender's copy in
  // batch-metal-a. `when()` only: see E.strikesInCurrentSubStep on the timing.
  if (!g.strikesInCurrentSubStep(self)) return false;
  const col = g.columnOf(self.id);
  if (!col) return false;
  const alive = col.filter(id => g.entity(id));
  // combat face damage is AGGREGATED into one 'lifeLost' per seat per sub-step,
  // so "my column connected" is not enough on its own: a 0-power column (a 0/x
  // body, or one whose hitters already died in the Swift sub-step) would read
  // someone ELSE'S damage as its own. Match batch-light-a's Vroot, which sums
  // the whole live column rather than only the anchor (batch-dark-b's
  // Blightmound checks the anchor alone — flagged as a three-way divergence).
  const power = alive.reduce((n, id) => n + Math.max(0, g.effStats(g.entity(id)!)[0]), 0);
  if (power <= 0) return false;
  const ci = b.columns.indexOf(col);
  if (ci !== -1) {
    return victim === b.defender
      && (b.blocks[ci] === undefined || g.colAttrs(alive).has('Piercing'));
  }
  return victim === b.attacker && g.colAttrs(alive).has('Piercing');
};

// ═══════════════════════ LIGHT / FIRE (lr) ════════════════════════════

// "When I attack or block, [Switch1] Sacrifice a unit. If you do, I deal
// damage equal to its power to any target. You gain life equal to the damage
// dealt this way." — lr/5 5/3 Cosmic Horror Unit. Bounded cause + bounded
// graft ([Switch1], R9). The target is picked at cast; the sacrifice is a
// mid-resolution choice (R6) over MY units in the region — "sacrifice a unit"
// is not optional, so the only choice is which (auto when forced). Power is
// snapshotted at the sacrifice (R27, live at resolution). ⚠ header: the life
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
// Spell. R49: printed.gainDebt is now a real CAST cost — playAtTiming charges
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
// it prints a "[4] Prophecy — Two Turns Pass" banner (engine side, R42).
// R67: "Target opponent" is a DECLARED target, chosen as the spell goes on
// the stack. In 1v1 it is forced, so the collector fills it without asking —
// but it is now visible on the stack and judged by the same rules as any
// other target, instead of being re-derived at resolution.
// ⚠ header: "the deck" is read as the caster's (shared in shared mode); the
// OPPONENT splits (picking cards into pile 1 until done) and the CASTER
// chooses which pile is cached. The cached pile gets glimpse-style permission
// — playable until end of turn, ignoring affinity, mana still paid (R45) —
// which is exactly cacheCard's `playable` flag. Plan-then-commit: every choice
// is requested before the deck is touched (R6).
card('Big Glimpse Card', {
  spellEffect: {
    targets: { what: 'opponent', min: 0, prompt: 'Big Glimpse Card: target opponent splits the 7' },
    run: (g, ctx) => {
      const deck = g.deckOf(ctx.controller);
      const revealed = deck.slice(0, 7);
      if (!revealed.length) { g.ev('info', 'Big Glimpse Card: the deck is empty.'); return; }
      g.ev('info', `Big Glimpse Card reveals: ${revealed.join(', ')}.`);
      const t = ctx.targets[0];
      const opp = (t && 'player' in t) ? t.player
        : (presentSeats(g, ctx.region).find(s => s !== ctx.controller) ?? (1 - ctx.controller));
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
      deck.splice(0, revealed.length);
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
// (R48, engine side — the gain lands on the same game-state check as the
// damage) and the "[4] Ambush" line is printed.ambush, an engine play mode
// (R22). Registered so it enters DECK_LIST.
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
  statics: [{
    affects: (_g, self, t) => t.id === self.id,
    dp: (g, self) => -g.player(self.controller).life,
    dt: (g, self) => -g.player(self.controller).life,
  }],
});

// "[Augment] Your units gain +1/+1 for every 3 life an opponent has more than
// you." — le/5 3/3 {Virus} Cosmic Unit. Statics-only [Augment] (augmentable),
// region-scoped by staticsFor (R12) and anchored on the host when applied.
// "An opponent" is the best-off opponent (in 1v1, simply the other seat); the
// bonus is floor(lead / 3) and never negative. Raw life fields only — no
// effStats call (reentrancy).
const dootBonus = (g: E, self: Entity): number => {
  const mine = g.player(self.controller).life;
  let lead = 0;
  for (const p of g.s.players) {
    if (p.seat === self.controller) continue;
    lead = Math.max(lead, p.life - mine);
  }
  return Math.floor(lead / 3);
};
card('The Mighty Doot', {
  augmentable: true,
  statics: [{
    affects: (_g, self, t) => t.kind === 'unit' && t.controller === self.controller,
    dp: dootBonus,
    dt: dootBonus,
  }],
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
        for (const p of g.s.players) {
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

// "[Augment] At the end of [Haste], your units gain +1/+1 until regroup for
// every 2 expended resources you have." — lg/3 3/2 Cosmic Plant Unit.
// R50: the haste step now closes with an 'endOfHaste' event fired inside a
// settle() window, so this is an ordinary triggered ability — and a TRIGGER is
// the right shape, because the amount is LATCHED at that instant ("until
// regroup") rather than tracking the resource count afterwards.
// Text-box [Augment], so "your" is the HOLDER's controller (the host when
// donated). R12/R25: "your units" is the holder's units in its own region.
card('Debt Plant', {
  augmentText: [{
    type: 'triggered', events: ['endOfHaste'],
    label: 'at the end of [Haste], your units gain +1/+1 per 2 expended resources',
    effect: {
      run: (g, ctx) => {
        const expended = g.player(ctx.controller).resources.filter(r => r.state === 'expended').length;
        const n = Math.floor(expended / 2);
        if (n <= 0) {
          g.ev('info', `${ctx.sourceName}: fewer than 2 expended resources — no bonus.`);
          return;
        }
        for (const u of g.unitsOf(ctx.controller, ctx.region)) g.addTemp(u, n, n);
      },
    },
  }],
});

// "[Augment][once] When you gain or lose life, create that many 1/1 units.
// (Damage causes loss of life)" — lg/7 7/3 Cosmic Fungus Unit. Text-box
// [Augment]; "[once]" is a bounded budget (R9, per card, reset each turn).
// Both directions count, and only MY life changes do ("when YOU gain or lose")
// — checked at event time against the anchor's controller (R1). "That many" is
// the event snapshot's amount. ⚠ R115 settles where the units land, and it is
// THIS CARD's report (#83): a CREATED unit arrives where its SOURCE currently
// is, so a Life Plant fighting in the enemy region mints its 1/1s THERE — in
// no column, unable to block the counterattack — and they walk home at
// regroup. (R115 withdrew R52/R28, which had moved this card to home, and
// absorbed R33's Ember of Life carrier reading as the general rule.)
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
          // R115: a created unit arrives where its SOURCE is (ctx.region)
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
// R118 — the COPY LAYER. This card is WHOLE: the name, the base stats, the
// attributes, the statics, the triggered/[Augment] text and the activated
// abilities all travel, as ONE face rather than four separate grants.
// (The activated facet landed with R118's second half, which pointed
// pushActivatedOptions and activationSource at E.facesWith rather than at
// getCard(u.card).abilities.)
//
// `E.becomeCopy` stamps an `Entity.copies` face carrying every facet, with
// `until: 'regroup'` — this card's printed duration, and the reason it needs
// the layer rather than R101's in-place rewrite of `Entity.card`: a copy has
// to REVERT, and a rewrite would also destroy the physical card (R118 ruling
// 1 — a copy still bins as itself).
//
// R92's four-grant approximation (E.setBase + E.addTempAttr + two E.grantText
// channels) is GONE. It could not carry the name or the statics at all, and
// its base-stat half sat at layer 2, which meant a copied body outranked a
// later "becomes a base 4/4" instead of being overwritten by it.
//
// Still region-scoped ("your units" — R12, the Flowstone Arcanite reading),
// still one payOrDecline asked before anything is mutated, and still
// idempotent across attacking and then blocking in the same battle (the face
// is a replacement, and `E.isCopyOf` skips the re-stamp so the log stays quiet).
const APEX_COPY_KEY = 'apexCopy';
card('Apex Prime', {
  augmentText: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    label: 'all of your units become a copy of target unit until regroup',
    // R1: the condition is checked at EVENT time. Text-box [Augment], so "your"
    // is the HOLDER's controller — the host's, when this is donated.
    when: (g, self) => g.player(self.controller).life % 2 === 1,
    effect: {
      targets: { what: 'unit', prompt: 'Apex Prime: all of your units become a copy of target unit until regroup' },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!isEnt(t) || !g.entity(t.id)) {
          g.ev('info', 'Apex Prime: the target is gone — nothing is copied.');
          return;
        }
        const src = g.entity(t.id)!;
        // R12: "your units" is region-scoped, the Flowstone Arcanite reading
        const mine = g.unitsOf(ctx.controller, ctx.region);
        if (!mine.length) { g.ev('info', 'Apex Prime: you have no units here.'); return; }
        // "you MAY" — one payOrDecline, asked before anything is mutated
        // (plan-then-commit: the part is replayed from the top on suspension)
        // R118: the prompt names the FACE — a Borrower already wearing a Good
        // Whale is copied AS a Good Whale (a copy of a copy chains via the face)
        const face = g.nameOf(src);
        const yes = ctx.choose(APEX_COPY_KEY, {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Apex Prime: have your ${mine.length} unit(s) become a copy of ${face} until regroup?`,
          options: [
            { label: `Copy ${face}`, value: true, card: face },
            { label: 'Decline', value: false },
          ],
        }) as boolean;
        if (!yes) { g.ev('info', 'Apex Prime: the copy is declined.'); return; }
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
// its cost." — ld/3 Cosmic Spell (deployment timing). R67: the bin IS a
// targetable zone now (R64's 'binCard'), so the printed "target" is a
// DECLARED target chosen as the item goes on the stack — it used to be a
// mid-resolution pick, which put the Covenant on the stack aiming at nothing.
// "Its cost" is the printed mana of the card put into play, taken as debt
// (R39); an X unit counts as 0 (there is no X to have chosen). Bounded graft
// ([Switch1], R9).
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
    const [name] = g.player(ctx.controller).bin.splice(t.binCard.index, 1);
    if (name === undefined) return;
    g.spawnUnit(ctx.controller, name, ctx.region);
    g.gainDebt(ctx.controller, manaOf(name));   // R39
  },
};
card('Covenant of the Damned', {
  spellEffect: covenant,
  graftEffect: { bounded: true, effect: covenant },
});

// "[Augment] After combat, each player with an even life total gains two
// rot." — ld/3 1/6 Cosmic Unit. Text-box [Augment], live when played normally
// and donated when applied. "Each player" is region-scoped (R25), walked in
// initiative order so the rot events are deterministic on replay (R38: gaining
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
          g.gainRot(seat, 2);   // R38
          hit++;
        }
        if (!hit) g.ev('info', 'Pale Tormentor: nobody here has an even life total — no rot.');
      },
    },
  }],
});

// ═══════════════════════ WATER / DARK (bd) ════════════════════════════

// "Recall target spell effect, then its controller discards a card." — bd/2
// {Battle} Mystic Spell. ⚠ header: "recall" is not "negate" — R68's removal
// with a different destination. The item leaves the stack and its CARD goes
// back to its controller's HAND (so it is never binned, and never trashed: R40
// only fires on a bin). An item with no card of its own (a triggered/activated
// ability, a spell token) simply ceases to exist.
// The discard is the item's controller's own choice (R6), and it is a TRASH
// (R40) — discardFromHand handles that.
card('Dream Lapse', {
  spellEffect: {
    targets: { what: 'stackSpell', prompt: 'Dream Lapse: recall target spell effect' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!t || !('stack' in (t as object))) return;
      const stackId = (t as { stack: number }).stack;
      // R68: removeFromStack() is the bare primitive — the item leaves the
      // stack and NOTHING is done with its card. negate() would bin it, and
      // then the recall below would put a second copy in hand.
      const it = g.removeFromStack(stackId);
      if (!it) {
        g.ev('info', 'Dream Lapse: the targeted spell effect has already left the stack — nothing is recalled.');
        return;
      }
      g.ev('negated', `${it.label} is recalled off the stack.`, { id: it.id });
      const recallable = it.card !== undefined
        && (it.kind === 'spell' || it.kind === 'spellUnit' || it.kind === 'virus' || it.kind === 'ambush');
      if (recallable) {
        g.player(it.controller).hand.push(it.card!);
        g.ev('info', `Dream Lapse: ${it.card} is recalled to ${g.pname(it.controller)}'s hand.`);
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
      g.discardFromHand(seat, di);   // R40: discarding is trashing
    },
  },
});

// "[Augment] When my column deals combat damage to an opponent, recall your
// bin and erase me." — bd/4 1/1 Spirit Cloud Unit. Text-box [Augment]; "my
// column"/"me" read from the HOST when donated. ⚠ header: the column-connected
// test is reconstructed at event time from the combat 'lifeLost' (R1), and
// "recall" means "put into your hand" (Manual) — the whole bin at once.
// "Erase me" removes the anchor and its mods without a bin, a death or a
// despawn, so nothing triggers off it (R40: erasing is never trashing).
card('Zephyrzoa', {
  augmentText: [{
    type: 'triggered', events: ['lifeLost'],
    label: 'recall your bin and erase me (my column connected)',
    when: (g, self, ev) => myColumnConnected(g, self, ev),
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        const bin = g.player(ctx.controller).bin;
        const n = bin.length;
        if (n) {
          g.player(ctx.controller).hand.push(...bin.splice(0, n));
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
// and is entirely engine side (R48 — combatSubStep calls killPlayer for every
// player hit whose column carries it). Registered so it enters DECK_LIST.
card('Gublin', {});

// "Put all unit mods applied to target unit into play under their controller's
// control." — ed/3 {Battle} Occult Spell. Only mods whose CARD is a unit
// qualify ("unit mods"); a grafted spell stays where it is. Each qualifying
// mod entity is removed and the card enters play under the MOD's controller —
// which, per attachMod, is the host's controller for anything applied to it,
// so a virus you stuck on an enemy comes back on THEIR side. A token mod (a
// Wraith augmented onto a unit, R71) re-enters play as a unit token. Everything
// arrives in the resolving region (the Resurrect precedent).
card('Reclaim the Fallen', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Reclaim the Fallen: put all unit mods on target unit into play' },
    // R69: the mods that leave the host keep their own card names, so what
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
      for (const m of mods) {
        delete g.s.entities[m.id];
        const k = host.mods.indexOf(m.id);
        if (k !== -1) host.mods.splice(k, 1);
      }
      for (const m of mods) {
        // CARD-TODO #17: "under their CONTROLLER's control" — a mod's
        // controller is its host's (attachMod), while its OWNER is whoever
        // applied it. So a virus you stuck on an enemy comes back on their
        // side, as the printed text says, but it is still your card and goes
        // to your bin when it dies (R65). Passing only the controller made it
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
// [Augment]. "Each player" is region-scoped (R25), each picking from their OWN
// bin (R6, auto only when there is exactly one — the question is put even in
// the end-of-turn window, R85); the unit then enters play under their opponent's
// control — in 1v1 that is simply the other seat. Plan-then-commit: every pick
// is gathered before any bin is touched.
card('Uglk', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: "each player puts a unit from their bin into play under an opponent's control",
    effect: {
      run: (g, ctx) => {
        const picks: { seat: Seat; idx: number }[] = [];
        for (const seat of presentSeats(g, ctx.region)) {
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
          picks.push({ seat, idx });
        }
        for (const { seat, idx } of picks) {
          const [name] = g.player(seat).bin.splice(idx, 1);
          if (name === undefined) continue;
          const opp = presentSeats(g, ctx.region).find(s => s !== seat) ?? (1 - seat);
          g.ev('info', `Uglk: ${g.pname(seat)} gives ${name} to ${g.pname(opp)}.`);
          // CARD-TODO #17: "under an opponent's control" is a CONTROL clause,
          // not a transfer of the card. It came out of `seat`'s bin, so it is
          // still `seat`'s card (R65) and dies back to their bin; `opp` only
          // controls it. Before the owner option existed this handed the card
          // over permanently, which the printed text never says.
          g.spawnUnit(opp, name, ctx.region, { owner: seat });
        }
      },
    },
  }],
});

// ═══════════════════════ FIRE / DARK (rd) ═════════════════════════════

// "Each player sacrifices a nontoken unit or discards a card. Repeat this X
// times." — rd/X {Battle} Mystic Spell. X is chosen and paid at cast (R35).
// "Each player" is region-scoped (R25); the choice is that player's own (R6),
// mandatory when anything is available (no decline option), and each round is
// planned then committed before the next round reads fresh pools (the Maw of
// Damnation precedent). Discarding is a TRASH (R40); sacrificing a nontoken
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
// up to two OF THE SIGN THE SOURCE HAS; "you may" and "up to" together are one
// mid-resolution choice (R6). Bounded cause + bounded graft ([Switch1], R9).
const moveCounters: EffectDef = {
  targets: {
    what: 'unit', count: 2, min: 2,
    prompt: 'Chombot: move up to two counters — first the unit to take them from, then the unit to put them on',
  },
  run: (g, ctx) => {
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
    }) as number;
    if (n <= 0) { g.ev('info', 'Chombot: no counters moved.'); return; }
    g.addCounters(from, -sign * n);
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
