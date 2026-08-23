/* Light & Dark expansion — batch light-c (18 cards).
 *
 * Behaviour only; printed data comes from printed.json (never hand-copied).
 * Spec for the expansion's new mechanics: docs/08-light-and-dark.md,
 * rulings R38-R48 in docs/digital-rules.md. Printed text is quoted in a
 * comment above every card for review.
 *
 * Graft markers: [Switch] = unbounded graft, [Switch1] = bounded (once/turn).
 *
 * Rulings referenced: R1 (conditions at event time, amounts at resolution),
 * R5 (fizzle vs partial), R6 (mid-resolution payments via ctx.choose),
 * R9 (bounded budgets per card), R12 (regions exclusive — listeners and
 * targets are region-scoped), R26 (a card's own [Augment] text is live when
 * it is played normally), R37 (applying a mod is not PLAYING a card),
 * R40 (trashing), R41-R45 (cache / prophecy / glimpse), R48 ({Blessed} is
 * simultaneous — the engine does it, no card code needed).
 *
 * Cards in this batch:
 *   Blessed Thing, Calming Force, Delver of the Ephemeral, Feed to Hooba,
 *   Gatekeeper of Souls, Godray, Hand Peeper, Just a Unit, Life Leech,
 *   Nullbringer, Prediction Prophet, Reap the Due, Seer of Empty Spaces,
 *   Slurpr, Suspend, Tithe Enforcer, Void Mandible, Witness of the Crossing.
 *
 * ⚠ ENGINE APPROXIMATIONS in this batch:
 * ✔ LIFE COSTS ARE REAL ACTIVATION COSTS NOW (R49). Hand Peeper and Life Leech
 *    declare `cost: { life: N }`: the cost GATES the activation (an ability you
 *    cannot pay for is not offered and apply() refuses it) and is paid as the
 *    ability is activated, before it reaches the stack. R49's ruling: a life
 *    cost is payable only while you have MORE life than it costs — paying your
 *    last life is refused too.
 * ✔ NULLBRINGER IS A REAL REPLACEMENT NOW (R104). It used to be a trigger —
 *    gain N, then lose 2N — which landed on the right FINAL total and was wrong
 *    about everything in between: the life total SPIKED up through N, a
 *    `lifeGained` fired for a gain the card says never happened, and in battle
 *    the correction rode the stack, so it was delayed and negatable. As a
 *    `replaceLifeGain` hook there is no gain at all and no lifeGained event, and
 *    "they lose that much" is exactly N. First-true-consumes, so two
 *    Nullbringers still turn +N into -N without the old WeakSet.
 *  - VOID MANDIBLE hears 'spellPlayed', which the engine fires for spell /
 *    spell unit / spell token casts only. The five {Battle}-timing UNIT cards
 *    and the five Ambush modes push a stack item without a play event, so
 *    they are not caught. Mods are not played at all (R37) and correctly are
 *    not caught. Token spells are excluded by the printed "nontoken".
 *  - FEED TO HOOBA / REAP THE DUE erase through helpers.ts's `eraseFromPlay`.
 *    (`E.eraseFromPlay` exists now — CARD-TODO #15 needed one engine side for
 *    Skybreaker's "Erase me:" cost — but the card-side copies still carry their
 *    own log wording that card tests read, so folding them in is its own sweep.)
 *  - PREDICTION PROPHET's "predict your life total" is a Decision, and a
 *    Decision carries a finite option list — so the menu runs 0 … your current
 *    life + 5. Any number is legal on the printed card; a prediction more than
 *    5 above where you stand during [Haste] cannot be entered here. (Everything
 *    else about the card is exact: the prediction is taken in R50's
 *    'endOfHaste' settle window and kept in the entity's own `budgets`, which
 *    only E.startTurn wipes, so it survives battle and regroup into the same
 *    turn's deployment.) See R90.
 * ✔ SUSPEND IS COMPLETE. The LIFE LOCK shipped with R104 — a region-keyed
 *    battleCounter read by E.gainLife and E.loseLife alike, so "can't change"
 *    really is both directions. "ERASE ME" shipped with CARD-TODO #15: this
 *    entry used to say "card code cannot reach the stack item it is resolving
 *    from", and now it can — `ctx.eraseSelf()` raises `StackItem.eraseSelf` and
 *    `E.dischargeItem` sends the card to the erased pile (R65) instead of the
 *    bin. The card's test/card-ledger.ts entry is deleted with that change.
 *
 * PARKED (needs engine machinery that does not exist — report, don't invent):
 *  - Gatekeeper of Souls: UN-PARKED by R64. "I must be targeted if able" is a
 *    targeting COMPULSION — the mirror of a restriction, narrowing other
 *    effects' candidate lists — and E.targetCandidates has the seam now.
 *    CardBehavior.mustBeTargeted; see the card.
 *  - Just a Unit: {Pure} is LIVE as of R61 — enforced by the engine at the
 *    combat choke points (E.pure), not by card behaviour. See the card.
 *  - Slurpr: "you can apply other mods during [Haste] as if it was deployment"
 *    is a play-timing permission living in apply.ts's doApplyMod phase gate,
 *    which card code cannot reach (the Dispatch Courier precedent). Inert
 *    [Augment] entry; it plays and augments as a vanilla 2/2.
 *  - (Suspend is fully unparked: its lock by R104, its "Erase me" by
 *    CARD-TODO #15 — see the ✔ note above and the card.)
 *  - (Calming Force COMPLETE as of R100, round 17: "I can't be played from your
 *    hand" is the `noPlayFromHand` flag — see the card.)
 */
import type { Entity, EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { card, getCard, type EffectDef } from '../dsl.ts';
import { selfOf, isEnt, eraseFromPlay } from './helpers.ts';

// ─────────────────────────── shared helpers ───────────────────────────

/** the formation slot an entity occupies right now, captured before it moves
 * (the E.ambushSwap pattern — "in its position in play") */
function slotOf(g: E, id: EntityId): { col: EntityId[]; idx: number } | null {
  const b = g.s.battle;
  if (!b) return null;
  for (const col of [...b.columns, ...Object.values(b.blocks)]) {
    const idx = col.indexOf(id);
    if (idx !== -1) return { col, idx };
  }
  return null;
}

// ───────────────────────────── the cards ──────────────────────────────

// "{i}(Damage dealt by a blessed source causes its controller to gain that
// much life.)" — l/2 2/2 {Virus} [Augment] {Blessed} Horror Unit. Reminder
// text only: {Blessed} is an ATTRIBUTE and the engine implements it (R48,
// E.blessedGain), and the type-line [Augment] {Blessed} grant comes off
// printed.augmentAttrs. Nothing to script — but the registration is what puts
// it into DECK_LIST.
card('Blessed Thing', {});

// "I can't be played from your hand.{/n}Negate all other effects." — ll/2
// {Battle} Nature Spell. COMPLETE as of R100: the hand restriction was an
// apply.ts zone gate that card code could not reach, and is now the
// `noPlayFromHand` CardBehavior flag — the mirror of `prophesyFromBin`,
// defaulting permissive, enforced once in `doPlayCard` and refused at all
// three `legalActions` sites that push a hand `playCard` (haste step, battle
// window, deployment). Before it the engine was strictly MORE permissive than
// the printed card, which is the one direction a rules engine must never be.
//
// ⚠ The line names one zone and one verb, so that is all it takes away. The
// card is still perfectly reachable from anywhere else it could ever be — a
// cache release (R42/R45), a bin-play permission (R96), or as a mod — and it
// can still be discarded and recycled from hand like any card. Only PLAYING
// it from hand is gone, which in practice makes it a card you have to set up.
//
// The negate half sweeps the WHOLE stack — "all other effects" is unqualified,
// so triggered and activated abilities go too. By resolution time Calming
// Force has already been popped off the stack, so every remaining item is
// genuinely an "other" effect.
card('Calming Force', {
  noPlayFromHand: true,
  spellEffect: {
    run: (g, ctx) => {
      let n = 0;
      for (const it of [...g.s.stack]) {   // R68: negate() splices
        g.negate(it.id);
        n++;
      }
      g.ev('info', n
        ? `Calming Force negates ${n} other effect(s).`
        : 'Calming Force resolves — there was nothing else on the stack.',
      { seat: ctx.controller, n });
    },
  },
});

// "After combat, cache up to one target card with cost 1 from your bin. You
// may play it until end of turn." — l/2 0/1 Horror Unit. R64: the bin IS a
// targetable zone now, so "up to one target card … from your bin" is a real
// declared target (min 0 carries the "up to"). "Cost 1" is the
// PRINTED mana cost; an X card is never 1. The cached card gets the
// glimpse-style until-end-of-turn permission (E.cacheFromBin playable:true) —
// which is what "you may play it until end of turn" means, so the mana is
// still paid and affinity is ignored (R45).
card('Delver of the Ephemeral', {
  abilities: [{
    type: 'triggered', events: ['afterCombat'],
    label: 'cache up to one cost-1 card from your bin (playable until end of turn)',
    effect: {
      targets: {
        what: 'binCard', min: 0,
        prompt: 'Delver of the Ephemeral: cache up to one target cost-1 card from your bin (playable until end of turn)',
        restrict: (_g, t) => 'binCard' in t && getCard(t.binCard.card).mana === 1,
      },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!t || !('binCard' in t) || t.binCard.index === -1) {
          g.ev('info', 'Delver of the Ephemeral: nothing cached.');
          return;
        }
        g.cacheFromBin(ctx.controller, t.binCard.index, { playable: true });
      },
    },
  }],
});

// "[Switch1] Erase target unit. Its controller creates a 3/3 unit in its
// position in play." — l/2 {Battle} Hooba Spell. The whole sentence is the
// bounded graftable effect ([Switch1], R9). "In its position in play" is the
// exact formation slot when there is one (E.ambushSwap's pattern): the token
// is spawned first and swapped into the slot, THEN the target is erased, so
// the erase's unslot finds nothing to remove.
const feedToHooba: EffectDef = {
  targets: { what: 'unit', prompt: 'Feed to Hooba: erase target unit (its controller gets a 3/3 in its place)' },
  creates: ['Unit Token'],
  run: (g, ctx) => {
    const t = ctx.targets[0];
    if (!isEnt(t) || !g.entity(t.id)) return;
    const who = t.controller, region = t.region;
    const slot = slotOf(g, t.id);
    const token = g.spawnUnit(who, 'Unit Token', region, { token: true, tokenStats: [3, 3] });
    if (slot) {
      slot.col[slot.idx] = token.id;
      g.ev('info', `The 3/3 takes ${t.card}'s position in the formation.`);
    }
    eraseFromPlay(g, t);
  },
};
card('Feed to Hooba', {
  spellEffect: feedToHooba,
  graftEffect: { bounded: true, effect: feedToHooba },
});

// "[Augment] When a player selects targets for an effect during battle, I
// must be targeted if able." — l/4 0/7 Horror Unit. UN-PARKED by R64: the
// targeting seam exists now, and a compulsion is the mirror of a restriction —
// it narrows OTHER effects' candidate lists instead of its own. `if able` is
// the fallback: a list the Gatekeeper is not legally on (Unmake, which reaches
// only base power 2 or less) is left exactly as it was. It radiates like a
// static — live as a unit in play, donated while it is an augment mod — and
// R62 silences it with every other ability. The compulsion is region-scoped
// like everything else (R12), which is also what "during battle" amounts to:
// outside battle the only units in your region are your own.
card('Gatekeeper of Souls', {
  mustBeTargeted: true,
  augmentable: true,
});

// "{i}(Damage dealt by a blessed source causes its controller to gain that
// much life.){/n}I deal 3 damage to any target." — ll/2 {Battle} {Blessed}
// Cosmic Spell. The {Blessed} half is entirely engine-side (R48): the gain is
// committed inside E.dealEffectDamage on the same game-state check as the
// damage, BEFORE the lethal check, so Godray aimed at its own controller
// heals them first and cannot kill them.
card('Godray', {
  spellEffect: {
    targets: { what: 'any', prompt: 'Godray: deal 3 damage to any target' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (t) g.dealEffectDamage(ctx, t, 3);
    },
  },
});

// "[Augment] Pay 3 life: Look at target player's hand." — l/1 0/2 Horror
// Unit. Text-box [Augment]: live when played normally (R26), donated when the
// card is applied as an augment. R49: the 3 life is a real ACTIVATION cost —
// it gates the activation (at 3 life or less the ability is not offered and
// apply() refuses it) and is paid before the ability reaches the stack.
// ⚠ R12: "target player" only reaches the opponent where they are present —
// i.e. during battle; activated in your own deployment the only present seat
// is you.
card('Hand Peeper', {
  augmentText: [{
    type: 'activated', cost: { life: 3 },
    label: "pay 3 life: look at target player's hand",
    effect: {
      // R64: the 'player' kind — the seats present in the region and nothing
      // else. 'any' also offered their units, which have no hand to look at.
      targets: { what: 'player', prompt: "Hand Peeper: look at target player's hand" },
      run: (g, ctx) => {
        const t = ctx.targets[0];
        if (!t || !('player' in t)) return;
        g.revealHandTo(ctx.controller, t.player);
      },
    },
  }],
});

// "{i}(Pure cards and cards they are interacting with ignore all other
// attributes.)" — l/2 2/3 {Virus} {Pure} Spirit Unit.
// R61: {Pure} is LIVE, and it needs no card behaviour — the attribute itself
// is the whole card, enforced by the engine (E.pure). It was parked on the
// assumption that it wanted the general attribute-SUPPRESSION layer still
// parked for Monke / Suppression Field / Transmogrifant, but it does not:
// those suppress a card's attributes globally and permanently, whereas Pure
// is scoped to one INTERACTION and switches both sides off at once. Combat
// already resolves per attack-column/block-column pair, which is exactly that
// unit, so Pure lives at those choke points instead. Playtest DEYK, seat 1:
// "Pure units should be able to block evasive or flying units".
card('Just a Unit', {});

// "[Augment] Pay 5 life: I gain +3/+3 until regroup." — l/2 1/1 {Virus}
// Horror Unit. Text-box [Augment]: "I" is the card itself when it is a unit in
// play, and the HOST when it is donated as a Virus/augment (the standard
// anchoring rule — ctx.sourceId is the host). R49: the 5 life is a real
// ACTIVATION cost, gating the activation and paid before it hits the stack.
card('Life Leech', {
  augmentText: [{
    type: 'activated', cost: { life: 5 },
    label: 'pay 5 life: I gain +3/+3 until regroup',
    effect: {
      run: (g, ctx) => {
        const me = selfOf(g, ctx);
        if (!me) return;
        g.addTemp(me, 3, 3);
      },
    },
  }],
});

// "[Augment] If a player would gain life, they lose that much life instead."
// — l/3 3/3 {Virus} Spirit Unit.
//
// UNPARKED as a real replacement (R104). It used to be a TRIGGER: gain N, then
// lose 2N. That landed on the right FINAL total (baseline − N) and was wrong
// about everything in between, which is precisely what the owner reported —
// the life total SPIKED up through N before coming back, anything watching
// `lifeGained` fired for a gain the card says never happened, and in battle the
// correction rode the stack, so it was delayed and Containment Protocol or
// Nothyr could negate it and leave the player with the gain.
//
// As a replacement there is no gain at all: `E.gainLife` asks the hook before
// it commits, the hook returns true, and NO `lifeGained` event is emitted. The
// observable difference is the absence of that event, and asserting the absence
// is what the guard test does.
//
// LOSE N, not 2N. The doubling only ever existed to undo a gain that had
// already happened; with nothing gained, "they lose that much life instead"
// is exactly N.
//
// REPLACEMENTS DO NOT STACK, and now that is structural rather than a
// bookkeeping WeakSet: `E.replaceLifeGain` is first-true-consumes, so two
// Nullbringers still turn +N into −N. (The old `nullbringerClaimed` WeakSet
// keyed off the event OBJECT, which only worked because a trigger had an event
// to key off — one more thing the replacement seam makes unnecessary.)
//
// "A PLAYER", unowned: every player's gain, its controller's included, and
// {Blessed} gains too (E.blessedGain routes through E.gainLife).
card('Nullbringer', {
  augmentable: true,
  replaceLifeGain: (g, _self, seat, n) => {
    g.loseLife(seat, n, 'Nullbringer (the gain is a loss instead)');
    return true;
  },
});

// "During [Haste], predict your life total. At the start of deployment,
// create a 5/5 unit if you matched the prediction." — lll/3 1/3 Spirit Unit.
//
// R90 — FULLY UNPARKED. The park note above this card used to claim the first
// sentence needed "a player action during the haste step and a field in
// PlayerState/Entity to keep the number, neither of which exists". Both halves
// of that claim were stale, which is the same lesson Oorblak taught: a PARKED
// note is a CLAIM about the engine as it was the day it was written.
//
//  (a) THE ACTION. R50's 'endOfHaste' fires inside a real settle() window
//      (E.startBattlePhase: "A trigger from step 1 may suspend on a decision,
//      which would strand the game … so the flip is deferred to
//      finishHasteEnd()"). A trigger there is therefore allowed to raise a
//      decision, and `ctx.choose` IS the number-picker — the same R6 dialogue
//      Reap the Due uses two cards below. No new player action was ever
//      needed; the prediction is simply asked for at the tail of the step.
//  (b) THE FIELD. `Entity.budgets` is a per-entity number store that E.startTurn
//      wipes ("for (const e of Object.values(this.s.entities)) e.budgets = {}")
//      and NOTHING else touches. The turn runs mana → [Haste] → battle →
//      deployment, so a number written at the end of the haste step is still
//      there at the start of deployment IN THE SAME TURN. (`battleCounters`
//      would NOT do: finishHasteEnd wipes them on the way into battle, which
//      is exactly the window the prediction has to survive.) Ancient One
//      (batch-metal-a) writes `self.budgets[key]` by hand the same way.
//
// The stored value is prediction + 1. `budgets[k] ?? 0` cannot tell "absent"
// from "zero", and 0 is a legal prediction (you predict your life total at the
// start of deployment, and a player who is about to be at 0 has other
// problems) — so the +1 keeps "never predicted" distinguishable and the
// start-of-deployment trigger can say which of the two happened.
//
// ⚠ APPROXIMATION (batch header): "predict your life total" is any number, and
// a Decision carries a finite option list, so the menu is 0 … your current
// life + PREDICTION_HEADROOM. Predicting a total more than that far ABOVE
// where you stand during [Haste] is not offered.
const PREDICTION_KEY = 'predictedLife';
/** how far above your current life the prediction menu reaches (see above) */
const PREDICTION_HEADROOM = 5;
card('Prediction Prophet', {
  abilities: [{
    type: 'triggered', events: ['endOfHaste'],
    label: 'predict your life total',
    effect: {
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        if (!self) return;                       // gone before the trigger resolved
        // R1/R27: the amount is read at RESOLUTION, off the live life total —
        // a haste-step play that moved your life moves the menu with it.
        const life = g.player(ctx.controller).life;
        const options: { label: string; value: unknown }[] = [];
        for (let n = 0; n <= life + PREDICTION_HEADROOM; n++) {
          options.push({ label: n === life ? `${n} (where you stand now)` : `${n}`, value: n });
        }
        const n = ctx.choose('predict', {
          kind: 'payOrDecline', seat: ctx.controller,
          prompt: `${ctx.sourceName}: predict your life total at the start of deployment`,
          options,
        }) as number;
        self.budgets[PREDICTION_KEY] = n + 1;    // +1: 0 is a real prediction
        g.ev('info', `${ctx.sourceName}: ${g.pname(ctx.controller)} predicts ${n}.`);
      },
    },
  }, {
    type: 'triggered', events: ['startOfDeployment'],
    label: 'create a 5/5 unit if you matched your [Haste] prediction',
    effect: {
      creates: ['Unit Token'],
      run: (g, ctx) => {
        const self = selfOf(g, ctx);
        const stored = self?.budgets[PREDICTION_KEY] ?? 0;
        if (!stored) {
          // no prediction this turn: it arrived after the haste step (or the
          // step's trigger never reached it). Not a gap — a miss.
          g.ev('info', `${ctx.sourceName}: no prediction was made during [Haste] — no unit.`);
          return;
        }
        const predicted = stored - 1;
        const life = g.player(ctx.controller).life;
        if (life !== predicted) {
          g.ev('info', `${ctx.sourceName}: predicted ${predicted}, life is ${life} — no unit.`);
          return;
        }
        g.ev('info', `${ctx.sourceName}: the prediction of ${predicted} was matched.`);
        // R52: a created unit arrives in its CONTROLLER's home region
        g.spawnUnit(ctx.controller, 'Unit Token', g.homeRegion(ctx.controller),
          { token: true, tokenStats: [5, 5] });
      },
    },
  }],
});

// "Erase target unit unless its controller gains debt equal to twice your
// [d]." — l/1 {Battle} Cosmic Spell. R6: the "unless" payment is a
// mid-resolution dialogue for the TARGET'S controller (they choose), with no
// priority window around it. R39: debt is a player counter paid off at the end
// of the next resource step. The amount is computed at RESOLUTION (R1) from
// the caster's live dark affinity — at zero dark affinity the "payment" is
// zero debt, so the unit is always saved and the card does nothing (printed
// as written; flagged in the report).
card('Reap the Due', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Reap the Due: erase target unit unless its controller gains debt' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) return;
      const amount = 2 * g.affinity(ctx.controller, 'dark');
      const victim = t.controller;
      const pay = amount === 0 ? true : ctx.choose('debt', {
        kind: 'payOrDecline', seat: victim,
        prompt: `Reap the Due: gain ${amount} debt to save ${t.card}?`,
        options: [
          { label: `Gain ${amount} debt`, value: true },
          { label: `Let ${t.card} be erased`, value: false },
        ],
      }) as boolean;
      if (pay) {
        if (amount > 0) g.gainDebt(victim, amount);
        else g.ev('info', `Reap the Due: twice ${g.pname(ctx.controller)}'s [d] is 0 — ${t.card} is saved for free.`);
        return;
      }
      eraseFromPlay(g, t);
    },
  },
});

// "When I spawn or die, [Switch1] Glimpse 1." — l/1 0/1 {Haste} Alien Unit.
// The glimpse is the bounded graftable effect ([Switch1], R9), so grafting it
// onto another host donates the glimpse to that host's own spawn/death.
// R45: glimpse reveals the top card, caches it, and stamps it playable until
// end of turn — mana still paid, affinity ignored, timing still obeyed.
const glimpseOne: EffectDef = {
  run: (g, ctx) => { g.glimpse(ctx.controller, 1); },
};
card('Seer of Empty Spaces', {
  abilities: [{
    type: 'triggered', events: ['spawned', 'died'], self: true,
    bounded: true, graftCause: true,
    label: 'Glimpse 1',
    effect: glimpseOne,
  }],
  graftEffect: { bounded: true, effect: glimpseOne },
});

// "[Augment] You can apply other mods during [Haste] as if it was
// deployment." — l/2 2/2 Horror Unit.
// PARKED (header): a play-timing permission. doApplyMod's phase gate in
// apply.ts is the only place that decides when a mod may be applied, and card
// code cannot reach it (the Dispatch Courier precedent). The inert [Augment]
// entry keeps the card applicable as a (blank) augment; it is a vanilla 2/2
// meanwhile and the granted permission is dead.
card('Slurpr', {
  augmentText: [{
    type: 'triggered', events: [],
    label: 'PARKED: apply other mods during [Haste] as if it was deployment',
    effect: { run: () => { /* no engine seam for play-timing permissions */ } },
  }],
});

// "Target player's life total can't change during this battle. Erase me." —
// ll/2 {Battle} Nature Spell.
//
// BOTH HALVES ARE LIVE. The lock shipped with R104; "Erase me" shipped with
// CARD-TODO #15 and is `ctx.eraseSelf()` — the seam `E.dischargeItem` reads to
// send a resolved spell's card to the erased pile (R65) instead of its bin.
// The card's ledger entry, which tracked the erase half alone, is deleted with
// this change (card-ledger.ts's house rule). ⚠ The erase is part of the
// EFFECT, so a NEGATED Suspend is binned normally — R68 — unlike R79's
// {Unstable}, which is a stamp on the card. Pinned by 89-self-erase.
//
// A BATTLE-SCOPED LOCK, not a radiating static and not a card hook, and the
// shape is forced rather than chosen: Suspend is a SPELL. It resolves and goes
// to the bin, so there is nothing left in play for `E.anchored()` to radiate
// from — exactly Abyssal Evocation's situation, and exactly R96's answer. What
// the card grants is a fact about this battle, which is what battleCounters
// are: region-keyed (R14's "'this battle' is this region's battle", so round
// 1's lock does not leak into round 2) and wiped by the existing per-battle
// reset, so "during this battle" needs no cleanup of its own and no new
// GameState field.
//
// "CAN'T CHANGE" IS BOTH DIRECTIONS. The lock is asked by E.gainLife and
// E.loseLife alike, ABOVE the replacement hooks — there is nothing left to
// replace once the change cannot happen at all — so a locked player gains no
// life, loses none, takes no rot damage to the face and cannot be killed by
// {Lethal} (killPlayer routes through loseLife). Conceding is not a life
// change and still ends the game (E.concede does not go through loseLife).
//
// ⚠ IT LOCKS THE TARGET, WHOEVER THAT IS. "Target player" is unowned, so
// pointing it at yourself is a legal and sometimes correct play (you cannot be
// burned out this battle either), and pointing it at an opponent denies them
// every lifegain payoff they have. Both readings are the printed card.
//
// ⚠ OUTSIDE BATTLE it does nothing, because there is no battle for "during
// this battle" to name. It is a {Battle} spell, so that is unreachable in
// practice; the guard is `E.lifeLocked` returning false with no battle.
card('Suspend', {
  spellEffect: {
    // R64: "target player" is the 'player' kind. Under 'any' the lock could be
    // aimed at a unit, which has no life total to lock.
    targets: { what: 'player', prompt: "Suspend: target player's life total can't change this battle" },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (t && 'player' in t) {
        g.lockLife(t.player, ctx.region);
        g.ev('info',
          `Suspend: ${g.pname(t.player)}'s life total can't change for the rest of this battle.`,
          { seat: t.player, region: ctx.region });
      }
      // "Erase me." — the second sentence, and it reads as the card's price for
      // the lock: a battle-long life lock that could then be recurred out of
      // the bin is a different card. Unconditional given the spell resolves, so
      // it sits outside the target guard. R65: dischargeItem sends it to the
      // erased pile instead of the bin (StackItem.eraseSelf).
      ctx.eraseSelf();
    },
  },
});

// (no rules text) — l/7 4/6 {Haste} {Flying} Angel Spirit Unit with the
// printed banner "[2] Prophecy — End [Haste] with used mana". Everything the
// banner does is engine-side: the prophesy action (R42, deployment only, plain
// mana), the PROPHECY_RULES row `hasteWithUsedMana` (R43 — you must haste
// something ELSE during the step to fulfil it), R44's latch, and the free,
// affinity-free release from cache at its printed {Haste} timing. The
// registration is the whole job.
card('Tithe Enforcer', {});

// "[Augment] When a nontoken card is played during battle, sacrifice me. If
// you do, negate that effect. {i}(This is not optional.)" — ll/2 2/1 {Haste}
// Alien Anima Unit. Text-box [Augment]: live when played normally (R26),
// donated when applied — and then "me" is the HOST, which is the drawback of
// hanging it on something. Mandatory, and it does NOT care whose card it is:
// its own controller's spells trigger it too.
//
// The Origon pattern: at 'spellPlayed' time the spell is not on the stack yet
// (commitItem fires the event before pushItem), so the item is found at
// RESOLUTION — the bottom-most un-negated spell-kind item matching the event's
// card and controller, with this trigger sitting above it.
// ⚠ header: 'spellPlayed' does not cover {Battle}-timing units or ambushes.
//
// R73 (2026-08-22): "sacrifice me. If you do, …" is a CAST COST — the same
// printed shape, and the same ruling, as Eldritch Dreamtender, and the printed
// "(This is not optional.)" says out loud what the cost reading already gives.
// It used to be a g.destroy() at resolution. Paid on the way to the stack now,
// so the carrier is gone before anyone can answer the negate; a carrier that is
// ALREADY gone makes the cost unpayable and the whole trigger is skipped (R5),
// which is what the old "the carrier is gone" branch said in longhand.
card('Void Mandible', {
  augmentText: [{
    type: 'triggered', events: ['spellPlayed'],
    label: 'sacrifice me to negate a nontoken card played during battle',
    when: (g, _self, ev) => g.s.phase === 'battle' && ev.data?.['token'] !== true,
    effect: {
      castCost: { kind: 'sacrificeUnits', from: 'self', n: 1 },
      run: (g, ctx) => {
        const name = ctx.event?.data?.['card'] as string | undefined;
        const seat = ctx.event?.data?.['seat'] as Seat | undefined;
        if (name === undefined || seat === undefined) {
          g.ev('info', 'Void Mandible: the event names no card — nothing is negated.');
          return;
        }
        const spellKinds = new Set(['spell', 'spellUnit', 'spellToken']);
        const it = g.s.stack.find(i =>
          i.card === name && i.controller === seat && spellKinds.has(i.kind));
        if (it) g.negate(it.id);
        else g.ev('info', `Void Mandible: ${name} already left the stack — not negated.`);
      },
    },
  }],
});

// "When your life total becomes 1 or 13 during battle, [Switch1][Switch1]
// [Switch1]" — ll/4 0/3 Horror Unit. The card contributes NO effect of its
// own: three [Switch1] marks on one cause = trigger THREE copies of each
// attached graft ability as one single trigger (the Lost Guardian precedent,
// which prints the same shape with two marks and spells the reading out in
// reminder text). ⚠ Witness of the Crossing prints no such reminder — the
// three-copy reading is inferred from Lost Guardian; flagged in the report.
//
// R110: a graft MULTIPLIER — `graftCopies: 3` makes composeParts materialize
// every other attached graft three times in the one composite (G1 → G2 → G1
// → G2 → G1 → G2), bounded grafts included, each copy with its own targets
// and its own [cost] (paid thrice or not at all). The effect itself does
// nothing at resolution. Bounded ([Switch1], R9): once per turn as a cause
// and as a graft.
const tripleGrafts: EffectDef = {
  graftCopies: 3,
  run: (g, ctx) => {
    const self = selfOf(g, ctx);
    const others = self ? self.mods.filter(id => {
      const m = g.entity(id);
      return m && m.appliedAs === 'graft' && m.card !== 'Witness of the Crossing';
    }).length : 0;
    if (!others) g.ev('info', `${ctx.sourceName}: no other graft is attached — there is nothing to triple.`);
    else g.ev('info', `${ctx.sourceName}: 3 copies of each grafted ability (${others} graft${others === 1 ? '' : 's'}), one single trigger.`);
  },
};
card('Witness of the Crossing', {
  abilities: [{
    type: 'triggered', events: ['lifeGained', 'lifeLost'], bounded: true, graftCause: true,
    label: 'trigger three copies of each grafted ability (one single trigger)',
    // R1: checked once, at event time — the life total AFTER the change is what
    // "becomes 1 or 13" reads, and both gains and losses can produce it.
    when: (g, self, ev) => {
      if (g.s.phase !== 'battle') return false;
      if (ev.data?.['seat'] !== self.controller) return false;
      const life = g.player(self.controller).life;
      return life === 1 || life === 13;
    },
    effect: tripleGrafts,
  }],
  graftEffect: { bounded: true, effect: tripleGrafts },
});
