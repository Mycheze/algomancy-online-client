/* batch-water-b — owned by one card-scripting agent; see sets/index.ts for
 * ordering rules. Cards are being scripted here from printed.json data
 * (never hand-copied); printed text quoted in comments for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R9 (bounded budgets per card), R12/R25 ("each player/opponent" reads the
 * event region's present seats), R14 ("this battle" counters are per
 * region-battle).
 *
 * ⚠ NEEDS ESCALATION — "a card enters a hand" is HALF IMPLEMENTED (2026-08-24).
 *   CLOSED BY R179. Rider of the Tides and Xenopod Progenitor here, and
 *   Galerider Eel in batch-water-a, all print "whenever (one or more other)
 *   cards enter a player's hand during battle". They used to listen on
 *   'despawned' (with `to: 'hand'`, R70) and 'draw' — a RECALL and a DRAW —
 *   and a card moved into a hand any OTHER way fired nothing, because nothing
 *   in the engine announced it: `player(seat).hand.push(name)` was a bare
 *   array write. The count in this note used to read "~9 card files"; it was
 *   18 sites across 11, and Rippleback Skulker (this batch!), Eldritch
 *   Reclaimer, Delver of Mysteries, Reclaimer of Secrets, Bioremediation and
 *   Collect Remains were only six of them. Several are {Battle}-timed, so the
 *   silence was in the exact window these three cards ask about.
 *   `E.toHand(seat, cards, from)` is now the ONE hand-entry point — it pushes
 *   AND fires 'handEntered' ONCE per move, however many cards moved — and all
 *   three cards listen on that event ALONE. Dropping 'draw' and 'despawned'
 *   is the load-bearing half of the rewire, not tidying: a draw and a recall
 *   both go through `toHand` now, so keeping either would fire these cards
 *   TWICE for one card entering one hand. 152-hand-entry guards both halves,
 *   and sweeps the pool so a new card cannot reintroduce a raw push.
 *
 * NOTHING IN THIS BATCH IS PARKED.
 *  - Water Resource: this header used to list it as parked on (a) resource
 *    cards modelled as playable resources and (b) a dispatched
 *    'resourceActivated' trigger. Corrected 2026-08-23: neither was ever
 *    needed. "When I activate, if you have at least [b][b][b], create a Shard"
 *    is the MANUAL p.18 general rule, reprinted on the physical card as
 *    reminder text — implemented in `apply.ts::maybeGrantShard` for all seven
 *    elements and verified on the real activateResource path (test/15-water-b,
 *    and the conformance sweep in test/12-fire-a). Registered as printed data
 *    only, which is the CORRECT definition: the face owns no behaviour.
 *    ⚠ Do not "implement" it — printed.json carries Resource faces for only
 *    fire, water and earth, so routing a seven-element rule through them would
 *    silently drop the bonus for wood, metal, light and dark. R116, R54.
 */
import type { Entity, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, isEntityTarget, getCard, type EffectCtx, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt, manaOf, chooseUnit, perSeatRows, lifeLostIn, doubleStats } from './helpers.ts';
// `playInline` lives in batch-water-a (Hooba-Pon and Insidious Invitation need
// it too). index.ts imports that module first, so importing it here cannot
// disturb registration order — see the note on `playInline` itself.
import { playInline } from './batch-water-a.ts';
// R166: "double a stat" is one shared solver — Burgeon and Surly Stalker print
// the same verb and must give the same answer under {Tough}/{Balanced}.

// ─────────────────────────── shared helpers ───────────────────────────

/** present seats of a region, initiative player first (stable order) */
const presentSeats = (g: E, region: number): Seat[] => {
  const present = g.s.regions[region]!.presentSeats;
  return [g.initiative, g.nit].filter(s => present.includes(s));
};

/** "Each player recalls a unit" (R12/R25: the region's present seats; each
 * player picks their own). All picks are gathered before any recall. */
const planEachPlayerRecall = (g: E, ctx: EffectCtx, tag: string): Entity[] => {
  const picks: Entity[] = [];
  for (const seat of presentSeats(g, ctx.region)) {
    const u = chooseUnit(g, ctx, `${tag}:${seat}`, seat,
      g.unitsOf(seat, ctx.region), `${ctx.sourceName}: choose a unit to recall`);
    if (u) picks.push(u);
  }
  return picks;
};

// ────────────────────────────── the cards ──────────────────────────────

// "Delete target unit. If you do, put it and all of its mods into your bin."
// bb/4 — {Battle} Maelstrom Spell. Overrides the normal destinations: a
// nontoken victim goes to the CASTER's bin (not its owner's), and a modded
// victim's card + mods land in the caster's bin instead of being erased
// (Unstable). destroy() is still used so death triggers / battle counters /
// formation cleanup all behave; BOTH cases are redirected AT SOURCE, with
// destroy()'s `binTo` and (R137) `keepBinned`. A token victim — and a token
// MOD — is simply erased (there is no card to move).
//
// R40 (trashing) is satisfied by `destroy(u, verb, { binTo })`, which routes
// the single bin push AND the single trash attribution at the caster in one
// decision — a card is trashed by the owner of the bin it enters:
//
//  - unmodded victim, whoever owns it: destroy({ binTo: caster }) puts the card
//    in the CASTER's bin and fires exactly one trashed(caster). No reroute.
//    (Rerouting after the fact was impossible: destroy() fires 'trashed'
//    synchronously — queueing its triggers and bumping the per-battle ledger —
//    before card code regains control, and a compensating second
//    trashed(caster) would double-count the ledger and double-fire "when I am
//    trashed".)
//  - modded victim: `keepBinned` (R137). destroy() now bins the body AND every
//    nontoken mod in the CASTER's bin and trashes each one there, which is
//    exactly the move this card describes — so all the card's text has left to
//    say is "and they STAY": the Unstable sweep does not run. This branch used
//    to be a second, hand-rolled `toBin` per card, because destroy() erased
//    everything and fired no trash at all; under R137 that would have binned
//    and trashed every one of them TWICE.
//  - token victim (R69, 2026-08-21): a token is a card and DOES enter a bin, so
//    destroy({ binTo: caster }) already bins it in the caster's name, trashes
//    it there, and lets the state-based sweep erase it. Nothing left to do —
//    hence the early return, which is now about not double-binning rather than
//    about tokens being exempt. `keepBinned` deliberately does not spare a
//    token: this card moves CARDS into a bin, and a token has none.
//  - token MOD: still erased. A mod has no card of its own to bin.
card('Pull Under', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Pull Under: delete target unit — it and its mods go to your bin' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t)) return;
      const u = g.entity(t.id);
      if (!u) {
        g.ev('info', 'Pull Under: the target is gone — nothing is deleted.');
        return;
      }
      const wasToken = !!u.token;
      const name = u.card;
      // R69: a token MOD has no card of its own — it is erased with the body,
      // exactly as recall()/cacheUnit() erase one, and never trashed.
      const modCards = u.mods
        .map(id => g.entity(id))
        .filter((m): m is Entity => !!m && !m.token)
        .map(m => m.card);
      g.destroy(u, 'is deleted', { binTo: ctx.controller, keepBinned: true });
      if (wasToken) return;   // R69: destroy() already binned, trashed and erased it
      g.ev('info', `Pull Under: ${name}${modCards.length ? ` and ${modCards.length} mod(s)` : ''} → ${g.pname(ctx.controller)}'s bin.`);
    },
  },
});

// "[Switch1] Each player recalls a unit and loses 2 life." — b/1, {Battle}
// Maelstrom Spell. "Each player" = the region's present seats (R12/R25); each
// player picks their own unit (auto when only one). The life loss is
// unconditional per player — a player with no unit to recall still loses 2.
const recallSpellEffect: EffectDef = {
  run: (g, ctx) => {
    const picks = planEachPlayerRecall(g, ctx, 'rc');
    const seats = presentSeats(g, ctx.region);
    // R209/CT-74/CT-81. HALF-SILENT, which is why no sweep could see it: the
    // life loss below is unconditional and always speaks, so the run is never
    // WHOLLY silent and `65-effect-conformance` — which convicts only a run
    // that emits nothing AT ALL — is structurally blind to it forever. The
    // recall clause promised something and delivered nothing without saying so.
    if (!picks.length) g.ev('info', 'Recall: nobody here has a unit to recall.');
    for (const u of picks) g.recall(u);
    for (const seat of seats) g.loseLife(seat, 2, ctx.sourceName);
  },
};
card('Recall', {
  spellEffect: recallSpellEffect,
  graftEffect: { bounded: true, effect: recallSpellEffect },
});

// "[Augment] Whenever a card enters a player's hand during battle, I gain
// +2/+2 until regroup." — b/1 2/2 Fish Unit. Text-box [Augment].
//
// R179: ONE listener, on 'handEntered' — the event `E.toHand` fires, and
// `E.toHand` is now the only way a card reaches a hand. That covers the recall
// (a token recall included: R69's hand window is a real entry, and Caleb was
// asked about THIS card — "Oh dang yeah it should also trigger it"), the
// battle draw, and the fourteen bin/stack/cache/hand routes that used to be
// silent. "A player's hand" carries no ownership clause, so either seat's
// hand counts and no `seat` check belongs here.
//
// ⚠ It listened on 'despawned' + 'draw' before. Keeping either alongside
// 'handEntered' would DOUBLE-FIRE, because a recall and a draw both go
// through `toHand` now. The event carries no region (like 'draw'), so the
// when() still pins the listener to the battle region itself (R12).
card('Rider of the Tides', {
  augmentText: [{
    type: 'triggered', events: ['handEntered'],
    label: 'I gain +2/+2 until regroup (a card entered a hand)',
    when: (g, self) =>
      g.s.phase === 'battle' && g.s.battle?.region === self.region,
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        // the carrier can be gone by resolution — R69's hand window makes this
        // reachable in one more way, since a token recall now fires the trigger
        if (!self) { g.ev('info', 'Rider of the Tides: the carrier is gone — no +2/+2.'); return; }
        g.addTemp(self, 2, 2);
      },
    },
  }],
});

// "[Augment] Whenever my column deals combat damage to a player, put target
// card from that player's bin into your hand." — b/2 2/1 {Evasive}. Text-box
// [Augment]. The bin pick happens at RESOLUTION from the live bin (R1).
//
// R195 — "my column deals combat damage to a player" is the ONE shared engine
// predicate, `E.columnDealtCombatDamage`, on the 'face' channel (the clause is
// narrowed to a player, so no unit channel). The reconstruction that used to
// live here — in a column with power, and it reaches the player (attacking and
// unblocked, or {Piercing}) — carried this comment's own ⚠ approximation, "a
// Piercing column whose overflow was fully absorbed can misfire", and it did:
// measured, a fully-absorbed column claimed a second column's hit and took a
// card off that player's bin for damage it never dealt. The event now carries
// the per-column breakdown, so the predicate asks instead of re-deriving, and
// this copy also picks up R117's sub-step gate, which it never had.
card('Rippleback Skulker', {
  augmentText: [{
    type: 'triggered', events: ['combatFaceDamage'],   // R238
    label: "put target card from that player's bin into your hand",
    when: (g, self, ev) => g.columnDealtCombatDamage(self, ev, ['face']),
    effect: {
      // R67: "target card from that player's bin" is a DECLARED target,
      // chosen as the trigger goes on the stack. "That player" is the one the
      // column just damaged, which only the EVENT knows — so the restriction
      // reads `tc.event`, the same snapshot run() sees as ctx.event. The kind
      // is 'anyBinCard' (it reaches a bin that is not mine) narrowed by the
      // restriction to exactly the victim's.
      targets: {
        what: 'anyBinCard', min: 0,
        prompt: "Rippleback Skulker: put target card from that player's bin into your hand",
        restrict: (_g, t, tc) => 'binCard' in t && t.binCard.seat === tc.event?.data?.seat,
      },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!t || !('binCard' in t) || t.binCard.index === -1) {
          g.ev('info', 'Rippleback Skulker: no bin card is targeted (or it has left) — nothing is taken.');
          return;
        }
        const taken = g.removeFromBin(t.binCard.seat, t.binCard.index, 'recalled');   // R124
        if (taken !== undefined) {
          g.toHand(ctx.controller, taken, 'bin');   // R179
          g.ev('info', `Rippleback Skulker: ${taken} → ${g.pname(ctx.controller)}'s hand.`);
        }
      },
    },
  }],
});

// "When the second nontoken spell is played in this battle, [Switch1] Each
// player recalls a unit." — b/3 2/3. The engine keeps no global spells-played
// counter, so the listener maintains a per-INSTANCE battle counter (R14: per
// region-battle, reset at battle-phase start), bumped inside when() — which
// fireEvent evaluates exactly once per event per listener, so the count is
// exact even with multiple Shellcasters in play. Condition at event time
// (R1); [Switch1] bounded (R9); the recall effect is the bounded graft.
const eachPlayerRecalls: EffectDef = {
  run: (g, ctx) => {
    const picks = planEachPlayerRecall(g, ctx, 'ssc');
    // R209/CT-74: `planEachPlayerRecall` skips a seat with nothing to recall,
    // so with every present seat empty it returns [] and this ran to
    // completion emitting nothing. ONE object, TWO conformance labels
    // (`ability:Seabed Shellcaster#0` and `graft:Seabed Shellcaster`) — one
    // repair closes both, which is the double-counting trap CT-70 paid for.
    if (!picks.length) {
      g.ev('info', 'Seabed Shellcaster: nobody here has a unit to recall.');
      return;
    }
    for (const u of picks) g.recall(u);
  },
};
card('Seabed Shellcaster', {
  abilities: [{
    type: 'triggered', events: ['spellPlayed'], bounded: true, graftCause: true,
    label: 'each player recalls a unit (second nontoken spell this battle)',
    when: (g, self, ev) =>
      g.s.phase === 'battle' &&
      !ev.data?.token &&
      g.bumpBattleCounter((ev.data?.region as number | undefined) ?? self.region, `sscSpells:${self.id}`) === 2,
    effect: eachPlayerRecalls,
  }],
  graftEffect: { bounded: true, effect: eachPlayerRecalls },
});

// "[Augment] After combat, you may recall target ally. If you do, each
// opponent loses 2 life." — bb/2 3/2 Spirit Unit. Text-box [Augment]. The
// target is declared when the trigger goes on the stack; the "may" is a
// mid-resolution decline (R6 pattern). "Each opponent" region-scoped (R25).
card('Shoreline Specter', {
  augmentText: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'you may recall target ally — each opponent loses 2 life',
    effect: {
      targets: { what: 'allyUnit', prompt: 'Shoreline Specter: recall target ally? (each opponent then loses 2 life)' },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!isEnt(t) || !g.entity(t.id)) {
          g.ev('info', 'Shoreline Specter: the target ally is gone — nothing is recalled.');
          return;
        }
        const u = g.entity(t.id)!;
        const yes = ctx.choose('doIt', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `Shoreline Specter: recall ${u.card}? (each opponent loses 2 life)`,
          options: [{ label: `Recall ${u.card}`, value: true }, { label: 'Decline', value: false }],
        });
        if (!yes) { g.ev('info', 'Shoreline Specter: declined — no recall, no life loss.'); return; }
        const opponents = presentSeats(g, ctx.region).filter(s => s !== ctx.controller);
        g.recall(u);
        // R209/CT-81(b): the recall above always speaks, so no silence sweep
        // could ever convict this — and the prompt the player just answered
        // said "(each opponent loses 2 life)". With no opponent here (R25: a
        // home region out of battle lists only its owner) that half simply did
        // not happen, and the player was told nothing.
        if (!opponents.length) {
          g.ev('info', 'Shoreline Specter: no opponent is present here — nobody loses 2 life.');
        }
        for (const s of opponents) g.loseLife(s, 2, 'Shoreline Specter');
      },
    },
  }],
});

// "[Switch1] Create an X/X unit, where X is the life target player lost in
// this battle." — b/2, {Battle} Occult Horror Spell. X reads the engine's
// per-battle life-loss ledger (E.loseLife bumps battleCounter
// `lifeLost:<seat>`; reset per battle, R14; amount at resolution, R1).
const soulSiphonMake: EffectDef = {
  // R67: "target player" is a DECLARED target, chosen as the item goes on the
  // stack. R64's 'player' kind is the one with no ownership clause — the card
  // says "target player", not "target opponent", so aiming it at YOURSELF is
  // legal (and is what you do when you are the one who has been bled).
  targets: { what: 'player', prompt: 'Soul Siphon: target player (X = the life they lost this battle)' },
  creates: ['Unit Token'],
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!t || !('player' in t)) return;
    const seat = t.player;
    const x = g.battleCounter(ctx.region, `lifeLost:${seat}`);   // engine ledger (loseLife)
    if (x > 0) g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [x, x] });
    else g.ev('info', 'Soul Siphon: X = 0 — no unit created.');
  },
};
card('Soul Siphon', {
  spellEffect: soulSiphonMake,
  graftEffect: { bounded: true, effect: soulSiphonMake },
  // #85, the card that prompted the report: X is the life the DECLARED TARGET
  // player lost, so it has one value per player and a single-number xPreview
  // could not say it. Both rows are public — `lifeLost` is bumped by a visible
  // loseLife event, and only during battle, which has no hidden segment.
  xPreviewRows: (g, seat, region) => perSeatRows(g, seat, s => lifeLostIn(g, region, s)),
});

// "[Switch1] Create an 8/8 unit." — bbb/7 2/2 {Battle} Alien Spell Unit. The
// spell part makes the 8/8; the 2/2 body then spawns (spellUnit). Bounded
// graft shares the effect.
const makeEightEight: EffectDef = {
  creates: ['Unit Token'],
  run: (g, ctx) => {
    g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [8, 8] });
  },
};
card('Spawntender', {
  spellEffect: makeEightEight,
  graftEffect: { bounded: true, effect: makeEightEight },
});

// "You may play target spell from your bin until regroup. It gains unstable
// until regroup. (If it would enter a bin, erase it instead.)" — bb/1,
// {Battle} Arcane Spell.
//
// R197: "UNTIL REGROUP" IS A REAL WINDOW NOW. This card used to play the
// chosen spell IMMEDIATELY, inline, as part of its own resolution — the whole
// printed permission collapsed to "right now". Three printed words were lost
// with it: you could not hold the spell for a better moment, you could not
// decline after seeing what the Excavation drew out, and — the one that
// mattered most — an inline play has no `playAtTiming`, so a DEPLOY-timing
// spell in the bin was castable in the middle of a battle. R157 §12 rules the
// opposite: **a bin-play grant does not waive printed timing.**
//
// What it does instead is grant, and the grant is R96's mechanism with the
// card's own two differences printed on it: ONE named card (`E.grantBinCardPlay`
// / `useBinCardPlay` — "target spell" is singular) and a window that runs to
// REGROUP rather than to the end of this region's battle. Everything after
// that is the ordinary `playFromBin` road: the player picks their own moment
// in their own priority window, `playAtTiming` applies the printed timing,
// `payCard` takes the cost then and not now, the item goes on the STACK where
// it can be responded to and negated, and R96's `viaGrant` stamp is what
// carries "{Unstable} until regroup … erase it instead of binning it".
// The card no longer erases anything by hand: `dischargeItem` does it, on the
// real R65 pile, because the item is really {Unstable}.
/**
 * The restriction Spell Excavation aims under (R64: asked at CAST, as part of
 * what makes a target legal).
 *
 * R197 shrank this to what the printed noun and R157 §12 between them allow:
 * a SPELL (kind spell/spellUnit — R157 §13's "tokens are spells" cannot apply,
 * a token is never in a bin), whose PRINTED TIMING can still be met before the
 * window closes. The window ends at regroup and regroup ends the battle phase,
 * so a card that is not {Battle}-timed could never be played under this grant
 * at all — offering it would be granting a permission that is dead on arrival,
 * which is the same filter `pushBinPlays` already applies to R96's grant.
 *
 * ⚠ WHAT IS DELIBERATELY NOT ASKED ANY MORE: affordability, and "can it find a
 * target". Both were right for an immediate play and are wrong for a window —
 * you pay when you play, which is later, and the target is picked then too. So
 * this no longer probes `targetCandidates` about ANOTHER card's spec, and the
 * `probing` re-entrancy guard that nesting needed is gone with it: with no
 * nested query, a Spell Excavation in the bin cannot recurse into its own
 * restriction. (That guard was real — see 60-cast-time-targets — and it is the
 * hazard, not the guard, that has been removed.)
 */
const excavatable = (n: string): boolean => {
  const d = getCard(n);
  if (d.kind !== 'spell' && d.kind !== 'spellUnit') return false;
  return d.timing === 'battle';                   // R157 §12: timing is not waived
};
card('Spell Excavation', {
  spellEffect: {
    // R67: "target spell from your bin" is a DECLARED target, chosen as the
    // Excavation goes on the stack (R64's 'binCard'), not a mid-resolution
    // pick. min 0 carries the "You may".
    targets: {
      what: 'binCard', min: 0,
      prompt: 'Spell Excavation: you may play target spell from your bin until regroup '
        + '(it will be erased, not binned)',
      restrict: (g, t, tc) => 'binCard' in t && tc.ally !== undefined
        && excavatable(t.binCard.card),
    },
    run: (g, ctx) => {
      const bin = g.player(ctx.controller).bin;
      const t = ctx.targets[0];
      if (!t || !('binCard' in t) || t.binCard.index === -1) {
        g.ev('info', 'Spell Excavation: no bin spell is targeted (or it has left) — nothing is played.');
        return;
      }
      const name = bin[t.binCard.index];
      if (name === undefined || !excavatable(name)) {
        g.ev('info', 'Spell Excavation: that spell can no longer be played from the bin — nothing happens.');
        return;
      }
      // ⚠ R198 -> R197: this card used to call `playInline` here, and R198 taught
      // that call to push a real StackItem so the play could be answered. R197
      // then removed the call site altogether — "you MAY play it until regroup"
      // is a GRANT, not a play — so `doPlayFromBin` now carries the stack, the
      // cost, the printed timing, the {Unstable} stamp and the R65 erase in
      // their ordinary places. R198's inline work still serves the other three
      // mid-resolution plays (Hooba-Pon, Insidious Invitation, Tides).
      // R197: the grant, not the play. It stays live until regroup, across
      // both battle rounds and both regions — see E.grantBinCardPlay — and
      // `doPlayFromBin` is what honours it, with the printed timing, the
      // stack, the cost and the {Unstable} stamp all in their ordinary places.
      g.grantBinCardPlay(ctx.controller, name);
      g.ev('info', `Spell Excavation: ${g.pname(ctx.controller)} may play ${name} from their bin `
        + 'until regroup — it will be Unstable (erased instead of binned).',
        { seat: ctx.controller, card: name });
    },
  },
});

// "When I attack or block alone, [Switch1] Double my power and defense until
// regroup." — bb/4 4/4 {Battle} Manatee Unit. "Alone" = the only living unit
// in my whole formation grid (attackers when attacking, blockers when
// blocking — the R20 Sneaky reading), checked at event time (R1). The DOUBLE
// is read at RESOLUTION (R1).
//
// R166: this was `addTemp(+p, +t)` off `effStats`, which is the layer-4 number
// written back in at layer 3 — so a {Tough} or {Balanced} Stalker had the
// doubling doubled again on the way out. Unlike Burgeon's targets it prints no
// stat-layer attribute of its own, so one has to be handed to it; the cheapest
// door is not a virus at all but R19 COLUMN SHARING — attack in a column with
// Rampart Guardian (a printed {Tough} 0/4) and the Stalker is {Tough} too,
// "in all situations". A {Virus} augment (Rampart Guardian, Child of Aether)
// is the other.
// `doubleStats` (batch-wood-a.ts, shared with Burgeon, which prints the same
// verb) solves for the layer-3 delta that makes the BOARD read twice what it
// read — the promise the card actually makes — and does both stats together
// because {Balanced} couples them.
const doubleSelf: EffectDef = {
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    if (!self) return;
    doubleStats(g, self, 'both');
  },
};
card('Surly Stalker', {
  abilities: [{
    type: 'triggered', events: ['attacked', 'blocked'], self: true,
    bounded: true, graftCause: true,
    label: 'double my power and defense until regroup (attacking/blocking alone)',
    when: (g, self, ev) => {
      const b = g.s.battle;
      if (!b) return false;
      const grid = ev.type === 'attacked' ? b.columns : Object.values(b.blocks);
      const alive = grid.flat().filter(id => g.entity(id));
      return alive.length === 1 && alive[0] === self.id;
    },
    effect: doubleSelf,
  }],
  graftEffect: { bounded: true, effect: doubleSelf },
});

// "[Augment] {Haste} {Alluring} Eel Unit" — b/1 1/3. Type-line [Augment]
// grants {Alluring}; printed.augmentAttrs carries it, and printed.attrs keeps
// it live when played normally ({Haste}: playable in the haste step, R18).
card('Tempest Wrangler', {});

// "{Haste} Lizard Fish Beast Unit" — b/3 7/2 vanilla haste beater (R18).
card('Tidal Menace', {});

// "For each player, recall target unit that player controls." — bb/2,
// {Battle} Mystic Spell. R58/R64/R67: BOTH units are declared targets, chosen
// as the spell goes on the stack — `count: 2, min: 0` with a one-per-
// CONTROLLER restriction, spelled out six lines below. (The "⚠ the engine's
// cast-time targeting holds one target per part, so the CASTER picks both
// units mid-resolution" line that used to sit here contradicted it.)
// Region-scoped (R12).
card('Tidal Reversion', {
  spellEffect: {
    // R67: "recall target unit that player controls" is a DECLARED target —
    // one per player, all chosen as the spell goes on the stack rather than
    // mid-resolution. Expressed as two unrestricted-`what` slots with a
    // one-per-CONTROLLER restriction rather than ['allyUnit','enemyUnit'],
    // because a fixed slot order aborts the whole collection when the first
    // slot has no candidate: a player with an empty board must not stop the
    // spell from reaching the other player's unit. min 0 for the same reason.
    targets: {
      what: 'unit', count: 2, min: 0,
      prompt: 'Tidal Reversion: recall target unit (one per player)',
      restrict: (_g, t, tc) => !isEntityTarget(t)
        || !(tc.chosen ?? []).some(c => isEntityTarget(c) && c.controller === t.controller),
    },
    run: (g, ctx) => {
      if (!ctx.targets.some(isEntityTarget)) {
        g.ev('info', 'Tidal Reversion: no unit is targeted — nothing is recalled.');
        return;
      }
      for (const t of ctx.targets) {
        if (!isEntityTarget(t)) continue;
        const u = g.entity(t.id);
        if (u) g.recall(u);
      }
    },
  },
});

// "When a player is dealt combat damage, [Switch1] Create a 2/2 unit." —
// bb/3 1/4. Fires on 'lifeLost' with why 'combat' (ANY player; the event is
// region-scoped in battle, R12). Bounded (R9); the 2/2 is the bounded graft.
// The 2/2 is created where the SOURCE is (R115: ctx.region). This card WAS
// R28's rationale — "a token minted while Tidelurker attacks must be home to
// block the counterattack" — and R115 withdrew it: the 2/2 minted mid-attack
// stands in the enemy region, in no column, blocks nothing, and walks home at
// regroup. The designer confirmed the power cut.
const makeTwoTwo: EffectDef = {
  creates: ['Unit Token'],
  run: (g, ctx) => {
    g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [2, 2] });
  },
};
card('Tidelurker', {
  abilities: [{
    type: 'triggered', events: ['lifeLost'], bounded: true, graftCause: true,
    label: 'create a 2/2 unit (a player was dealt combat damage)',
    when: (g, self, ev) => ev.data?.why === 'combat',
    effect: makeTwoTwo,
  }],
  graftEffect: { bounded: true, effect: makeTwoTwo },
});

// "You may play me into an open spot in your formation." — b/1 2/2 {Battle}
// Fish Unit.
//
// R29, rewritten 2026-08-22 (playtest UFAB): the whole card is one engine
// flag. `playsIntoFormation` makes the spot part of the CAST — asked in the
// same window as X, mods, targets and costs (R35), and taken at resolution
// atomically with the spawn, so the unit's first appearance anywhere is
// already standing in the line.
//
// It used to be a triggered ability on its own `spawned` event, calling R75's
// `E.placeInFormation` when the trigger resolved. That read the printed words
// as an effect, and the report is what it cost: *"Tiderunner Initiate should
// never have entered the Invader's zone. It gets played directly into the
// formation, not as a trigger that happens when it enters."* Playing it
// spawned a unit into the region with no column — which is precisely what the
// client draws as the invader's zone — stacked a trigger, and handed the
// opponent a priority window; in the reported game Good Whale and Tidal
// Reversion used it to recall the Initiate before it ever reached the line.
//
// R75 keeps `placeInFormation` for what it was written for: an EFFECT that
// creates a unit in a formation (Hooba-Bot/Lin/God/Pon). Those units really
// are made and then placed. This one is played into a spot.
card('Tiderunner Initiate', { playsIntoFormation: true });

// "Reveal the top eight cards of the deck. Choose up to two of them with
// total cost 8 or less. You may play them now, for free. Recycle the rest."
// — bbb/8, {Battle} Cosmic Spell. Picks are sequential ("Done" stops early);
// free plays go through playInline (units spawn, spells resolve immediately —
// ⚠ see playInline; a played spell is then binned as usual). The rest recycle
// to the bottom in revealed order.
//
// R157 §1: an X card among the eight counts as cost 0 against the [8] budget
// — no X has been paid for a card sitting in a deck, so it has no cost, and
// the standing steer takes the reading that lets more things happen (the card
// is choosable, and plays for free at X = 0 like any other free release,
// R111). `manaOf` is the right read here.
card('Tides of the Cosmos', {
  spellEffect: {
    run: (g, ctx) => {
      const top = g.deckOf(ctx.controller).slice(0, 8);
      if (!top.length) {
        g.ev('info', 'Tides of the Cosmos: the deck is empty — nothing is revealed.');
        return;
      }
      g.ev('info', `Tides of the Cosmos reveals: ${top.join(', ')}.`);
      const picks: number[] = [];
      let budget = 8;
      for (let k = 0; k < 2; k++) {
        const opts = top
          .map((n, i) => ({ label: `${n} [${manaOf(n)}]`, value: i, card: n }))
          .filter(o => !picks.includes(o.value) && manaOf(top[o.value]!) <= budget);
        if (!opts.length) break;
        const pick = ctx.choose(`pick${k}`, {
          kind: 'electricPath', seat: ctx.controller,
          prompt: `Tides of the Cosmos: play a revealed card for free (${budget} total cost left), or Done`,
          options: [...opts, { label: 'Done', value: -1 }],
        }) as number;
        if (pick < 0) break;
        picks.push(pick);
        budget -= manaOf(top[pick]!);
      }
      // commit: remove the revealed cards, play the picks, recycle the rest
      g.deckOf(ctx.controller).splice(0, top.length);
      for (const i of picks) {
        const name = top[i]!;
        g.ev('info', `Tides of the Cosmos: ${g.pname(ctx.controller)} plays ${name} for free.`);
        const r = playInline(g, ctx, name, `play${i}`);
        // a played spell card is binned as normal; a fizzled spell unit never
        // spawns and is binned too; units stay in play
        //
        // ⚠ R198: NONE of that is this card's business once the play is on the
        // stack. `'stacked'` means `E.dischargeItem` owns the disposal — and it
        // reaches the SAME two destinations by the same two rules (the R146(b)
        // "Erase me." branch and `toBin(…, 'stack')`, i.e. R146(a)'s pinned
        // not-a-trash), so the answer below is unchanged and only the hand
        // that gives it moved.
        const kind = getCard(name).kind;
        if (r.outcome !== 'stacked'
          && (kind === 'spell' || (kind === 'spellUnit' && r.outcome === 'fizzled'))) {
          if (r.eraseSelf) {
            // R146(b): the spell printed "Erase me." and said so as it
            // resolved. Same shape (and same log sentence) as the eraseSelf
            // branch of E.dischargeItem — no bin, so R40 never comes up, and
            // the 'erased' event is what files it on the public pile (R65).
            g.ev('erased', `${name} erases itself — it does not go to a bin.`,
              { seat: ctx.controller, card: name });
          } else {
            // R146(a): through the choke point, not a raw `bin.push`.
            //
            // ⚠ THE `from` IS THE RULES QUESTION, and it is 'stack' — NOT a
            // trash. The card was PLAYED and it RESOLVED; `playInline` skips
            // the stack for engine reasons (there is no priority window to
            // open on a free mid-resolution play), and R40's stack clause is
            // not really about the zone, it is R40's own sentence *"a spell or
            // ability going to the bin AFTER RESOLVING does not [trash]"*. The
            // zone is how that is normally detected, not what it means.
            //
            // Reading it the other way ('deck', the zone the card physically
            // left) would trash it, and then the SAME spell would trash when
            // Tides played it and not trash when it was cast from hand — two
            // routes to "play a spell", two answers. That is precisely the bug
            // class R133/R137 closed when they made R40 key on the
            // destination rather than on the object.
            //
            // It also matches the pool: the other two `playInline` callers
            // that dispose of a card (Hooba-Pon, Insidious Invitation) already
            // pass 'stack' for a fizzled spell unit. All four sites agree.
            g.toBin(ctx.controller, name, 'stack');
          }
        }
      }
      for (let i = 0; i < top.length; i++) {
        if (!picks.includes(i)) g.recycleToBottom(ctx.controller, top[i]!);
      }
    },
  },
});

// "Each player recalls two units. If four or more units were recalled this
// way, repeat this." — b/4, {Battle} Bedlam Maelstrom Spell. Per iteration
// each present player recalls two of their units (all of them when they have
// two or fewer — no choice needed then); 4+ recalls repeat the whole thing.
// Terminates naturally (recalled units leave play); iteration cap as a belt.
card('Upheaval', {
  spellEffect: {
    run: (g, ctx) => {
      for (let iter = 0; iter < 20; iter++) {
        const picks: Entity[] = [];
        for (const seat of presentSeats(g, ctx.region)) {
          const pool = g.unitsOf(seat, ctx.region);
          if (pool.length <= 2) { picks.push(...pool); continue; }
          const chosen: Entity[] = [];
          for (let k = 0; k < 2; k++) {
            const u = chooseUnit(g, ctx, `up${iter}:${seat}:${k}`, seat,
              pool.filter(x => !chosen.includes(x)),
              `Upheaval: choose a unit to recall (${2 - k} to go)`);
            if (u) chosen.push(u);
          }
          picks.push(...chosen);
        }
        // R209/CT-74: every present seat can be here with no unit to recall —
        // the pools are all empty, `picks` comes back empty and the iteration
        // broke out in silence.
        if (!picks.length) {
          g.ev('info', iter === 0
            ? 'Upheaval: nobody here has a unit to recall.'
            : 'Upheaval: no units are left here to recall — it stops.');
          break;
        }
        for (const u of picks) g.recall(u);
        if (picks.length < 4) break;
        g.ev('info', `Upheaval: ${picks.length} units recalled — repeat.`);
      }
    },
  },
});

// "[zero]: [Switch1] Recall me." — bb/3 4/3 Cloud Spirit Unit. A zero-mana
// activated ability; the [Switch1] recall is the bounded graft (on a host it
// recalls the host). Bounded once per turn (R9).
const recallSelf: EffectDef = {
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    // test/65: on a host, or once the body is already gone, there is nothing to
    // recall — and saying so is the difference between a rule and a bug
    if (!self) {
      g.ev('info', `${ctx.sourceName}: there is nothing left to recall — nothing happens.`);
      return;
    }
    g.recall(self);
  },
};
card('Vaporweave Eidolon', {
  abilities: [{
    type: 'activated', cost: { mana: 0 }, bounded: true, graftCause: true,
    label: '[zero]: recall me',
    effect: recallSelf,
  }],
  graftEffect: { bounded: true, effect: recallSelf },
});

// "When I activate, if you have at least [b][b][b], create a Shard.
// (It spawns dormant.)" — b/0 2/0, [b] Water Resource. NOT PARKED: that
// sentence is the Manual p.18 general rule reprinted as reminder text, live in
// apply.ts::maybeGrantShard for all seven elements. Bare is CORRECT — the face
// owns no behaviour. ⚠ Adding it here would double the bonus for water and,
// once the rule moved off maybeGrantShard, delete it for the four elements
// with no printed face. R116; guarded by test/12-fire-a's sweep.
// (Note: printed.kind is 'unit', so the shared deck legally contains it;
// played, its 0 toughness kills it immediately — harmless.)
card('Water Resource', {});

// "[Augment] Whenever one or more other cards enter a player's hand during
// battle, you may pay [one] to create a 2/2 unit." — b/5 3/3. Text-box
// [Augment]. Same channel as Rider of the Tides, and R179's same rewire onto
// 'handEntered' alone (see that card for why keeping 'draw'/'despawned' would
// double-fire).
//
// "ONE OR MORE" IS WHY THE EVENT IS PER-MOVE AND NOT PER-CARD: Zephyrzoa
// recalling a fourteen-card bin is ONE firing, exactly as a two-card draw
// always was. "OTHER" excludes the carrier's own card — `ev.data.unit` is the
// recalled entity, stamped by `toHand`'s `from: 'play'` route.
// The [one] payment is a mid-resolution pay-or-decline (R6), skipped outright
// when the controller cannot pay.
card('Xenopod Progenitor', {
  augmentText: [{
    type: 'triggered', events: ['handEntered'],
    label: 'you may pay [one] to create a 2/2 unit (a card entered a hand)',
    when: (g, self, ev) =>
      g.s.phase === 'battle' && g.s.battle?.region === self.region
      && ev.data?.unit !== self.id,
    effect: {
      creates: ['Unit Token'],
      run: (g, ctx) => {
        if (g.openMana(ctx.controller) < 1) {
          g.ev('info', 'Xenopod Progenitor: no open mana to pay [1] — no unit.');
          return;
        }
        const pay = ctx.choose('pay', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: 'Xenopod Progenitor: pay [1] to create a 2/2 unit?',
          options: [
            { label: 'Pay [1] — create a 2/2 unit', value: true },
            { label: 'Decline', value: false },
          ],
        });
        if (!pay) { g.ev('info', 'Xenopod Progenitor: the [1] is declined — no unit.'); return; }
        g.payMana(ctx.controller, 1);
        g.spawnUnit(ctx.controller, 'Unit Token', ctx.region, { token: true, tokenStats: [2, 2] });
      },
    },
  }],
});
