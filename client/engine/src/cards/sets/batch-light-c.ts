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
 * ✔ VOID MANDIBLE HEARS ITS WHOLE PRINTED NOUN NOW (R129). It used to hear
 *    'spellPlayed', which the engine fires for spell / spell unit / spell
 *    token casts only — so the five {Battle}-timing UNIT cards and the five
 *    Ambush modes pushed a stack item with no play event at all and went
 *    straight past a card that prints "when a nontoken CARD is played". The
 *    engine fires 'cardPlayed' now (spell / spell unit / unit / ambush) and
 *    the card listens to that. Mods are still not played at all (R37) and
 *    correctly are not caught; a spell TOKEN is not a card and is out of the
 *    event's membership, which is what the printed "nontoken" says.
 *  - FEED TO HOOBA / REAP THE DUE erase through helpers.ts's `eraseFromPlay`.
 *    (`E.eraseFromPlay` exists now — CARD-TODO #15 needed one engine side for
 *    Skybreaker's "Erase me:" cost — but the card-side copies still carry their
 *    own log wording that card tests read, so folding them in is its own sweep.)
 * ✔ PREDICTION PROPHET TAKES ANY NUMBER NOW (R197). This entry used to read
 *    "a Decision carries a finite option list — so the menu runs 0 … your
 *    current life + 5", and that cap was an engine limit wearing the card's
 *    clothes: gaining more than five life between [Haste] and deployment is
 *    ordinary, and the winning prediction was simply not on the menu.
 *    `DecisionKind` grew a real numeric entry (`kind: 'number'`, where the
 *    answer IS the number and `options` is empty — see `NumericEntry`), the
 *    client renders it as a typed box with a −/+ dial, and the floor is 0
 *    only because a game ending at 0 life means no deployment step can ever
 *    observe a negative total. (Everything else about the card was already
 *    exact: the prediction is taken in R50's 'endOfHaste' settle window and
 *    kept in the entity's own `budgets`, which only E.startTurn wipes, so it
 *    survives battle and regroup into the same turn's deployment.) R90, R197.
 * ✔ SUSPEND IS COMPLETE. The LIFE LOCK shipped with R104 — a region-keyed
 *    battleCounter read by E.gainLife and E.loseLife alike, so "can't change"
 *    really is both directions. "ERASE ME" shipped with CARD-TODO #15: this
 *    entry used to say "card code cannot reach the stack item it is resolving
 *    from", and now it can — `ctx.eraseSelf()` raises `StackItem.eraseSelf` and
 *    `E.dischargeItem` sends the card to the erased pile (R65) instead of the
 *    bin. The card's ledgers/card-ledger.ts entry is deleted with that change.
 *
 * UN-PARKED (all five; kept as history — report, don't invent):
 *  - Gatekeeper of Souls: UN-PARKED by R64. "I must be targeted if able" is a
 *    targeting COMPULSION — the mirror of a restriction, narrowing other
 *    effects' candidate lists — and E.targetCandidates has the seam now.
 *    CardBehavior.mustBeTargeted; see the card.
 *  - Just a Unit: {Pure} is LIVE as of R61 — enforced by the engine at the
 *    combat choke points (E.pure), not by card behaviour. See the card.
 * ✔ SLURPR IS COMPLETE (2026-08-23). Its card half — `ModPermission.applyAtHaste`,
 *    an unbudgeted OR-fold in R95's shape — landed first; the three ENGINE seams
 *    it was waiting on are all in the tree now: `E.mayApplyModAtHaste` (the
 *    gatherer beside `E.mayAugmentInBattle`, which needs the private
 *    `anchored()` walk), the haste branch in `doAugment` and `doGraft` through
 *    apply.ts's one shared `hasteModAllowed` predicate, and BOTH offer gates —
 *    `legalHasteActions`' `pushHasteMods` and, the one that would otherwise have
 *    made the whole thing unreachable, `startHasteStep`'s `canHaste` (report #74
 *    in mod form). Its ledger entry is deleted with that change.
 *  - (Suspend is fully unparked: its lock by R104, its "Erase me" by
 *    CARD-TODO #15 — see the ✔ note above and the card.)
 *  - (Calming Force COMPLETE as of R100, round 17: "I can't be played from your
 *    hand" is the `noPlayFromHand` flag — see the card.)
 */
import type { EntityId, Seat } from '../../types.ts';
import type { E } from '../../engine.ts';
import { CARD_PLAY_KINDS, card, getCard, isGraftMultiplier, type EffectDef } from '../dsl.ts';
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
// ...and as of 2026-09-20 we know HOW it is set up: Calming Force prints
// "[3ll] Prophecy — Two Turns Pass" under its title. The whole banner had
// been lost in transcription (bot/pipeline/read_card_faces.py), so the card
// that "can't be played from your hand" had no printed route into play at
// all. The paragraph above guessed a cache release; the scan says so.
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
  // R268: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    mustBeTargeted: true,
  },
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
  // R268: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    replaceLifeGain: (g, _self, seat, n) => {
      g.loseLife(seat, n, 'Nullbringer (the gain is a loss instead)');
      return true;
    },
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
// R197: "PREDICT YOUR LIFE TOTAL" IS ANY NUMBER, AND NOW IT REALLY IS.
// This used to be a `payOrDecline` menu running `0 … life + 5`, so a
// prediction more than five above where you stood during [Haste] could not be
// entered — and life climbing more than five between the haste step and
// deployment is ordinary (Life Leech, Serene Sanctuary, any drain in battle).
// The cap was an engine limit wearing the card's clothes, and the owner's
// standing steer forbids exactly that: *"Don't assume that cards are limited,
// they're designed to be open ended … It's not on rails."*
// `kind: 'number'` is a real numeric entry — `options` is empty, `choice` is
// the number, and there is NO ceiling at all. The floor is 0, and that is not
// a narrowing: E.loseLife ends the game the moment a total reaches 0 or below,
// so `startOfDeployment` — the step this prediction is read at — can never be
// reached with a negative life total, and a prediction below 0 could not be
// matched by any reachable board. See NumericEntry in types.ts for the
// contract and ui/inspect.ts::numberEntry for the client affordance.
const PREDICTION_KEY = 'predictedLife';
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
        const n = ctx.choose('predict', {
          kind: 'number', seat: ctx.controller,
          prompt: `${ctx.sourceName}: predict your life total at the start of deployment`,
          options: [],                             // R197: the value IS the answer
          numeric: { min: 0, max: null, suggest: life, suggestLabel: 'where you stand now' },
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
        // R115: a created unit arrives where its SOURCE is (ctx.region)
        g.spawnUnit(ctx.controller, 'Unit Token', ctx.region,
          { token: true, tokenStats: [5, 5] });
      },
    },
  }],
});

// "Erase target unit unless its controller gains debt equal to twice your
// [l]." — l/1 {Battle} Cosmic Spell. R6: the "unless" payment is a
// mid-resolution dialogue for the TARGET'S controller (they choose), with no
// priority window around it. R39: debt is a player counter paid off at the end
// of the next resource step. The amount is computed at RESOLUTION (R1) from
// the caster's live LIGHT affinity.
//
// ⚠ THE ORACLE FILE ONCE TRANSCRIBED THE PIP AS [d]. The scan shows the light
// pip, the same one as the cost, and the card is mono-light — so the file was
// corrected at source (2026-09-20) and the engine reads `light`. R300 is the whole
// of it, including why the mistyped symbol left this card doing nothing at all
// from the only deck that can cast it. Casting it costs [l], so the demand is
// always at least 2 debt: the free save has no way to occur.
// `309-element-identity.test.ts` proves no card names an element outside its
// own identity.
card('Reap the Due', {
  spellEffect: {
    targets: { what: 'unit', prompt: 'Reap the Due: erase target unit unless its controller gains debt' },
    run: (g, ctx) => {
      const t = ctx.targets[0];
      if (!isEnt(t) || !g.entity(t.id)) return;
      const amount = 2 * g.affinity(ctx.controller, 'light');
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
        else g.ev('info', `Reap the Due: twice ${g.pname(ctx.controller)}'s [l] is 0 — ${t.card} is saved for free.`);
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
//
// LIVE END TO END as of 2026-08-23: `ModPermission.applyAtHaste`, the
// MOD-timing twin of Rook's R95 `augmentInBattle`, declared exactly the way
// Rook declares its own — and the engine now ASKS it, at four gates.
// `E.mayApplyModAtHaste` gathers the permission; apply.ts's `hasteModAllowed`
// is the one predicate both the action path (`doAugment` / `doGraft`) and the
// offer path (`pushHasteMods`) call; and `E.startHasteStep`'s `canHaste` opens
// the step at all for a hand of nothing but mods, which is the gate whose
// absence would have made every other one unreachable (report #74 in mod
// form). The card's ledger entry is deleted with that change.
//
// WHY THIS FAMILY AND NOT R97's. Dispatch Courier prints "Each turn, you may
// play a unit …", so R97 SUMS its grants into a per-turn budget kept in
// `hastePlaysUsed`. Slurpr prints no "each turn" at all, so it is an
// unbudgeted OR-FOLD in R95's shape: one grantor is enough, two Slurprs are
// not twice as permissive, and NO new GameState field is needed anywhere.
//
// "OTHER MODS" IS AUGMENTS AND GRAFTS BOTH — R37's word for both is "mod" —
// so this checks neither `ctx.kind` nor `ctx.from`. Unlike Rook, whose printed
// "from hand and bin" is what makes Rook (not apply.ts) refuse the cache,
// Slurpr names no zone list: "as if it was deployment" grants whatever
// deployment already grants, and every other deployment refusal still stands
// (paying for the mod under R37/R59's `purpose: 'mod'`, the host being in your
// own region, a graft needing its own graft cause).
//
// "OTHER" is not a self-exclusion the predicate has to enforce: the granting
// Slurpr is already applied, and a SECOND Slurpr card in hand genuinely is an
// "other mod".
//
// `augmentable: true` replaces the inert `augmentText` stand-in, exactly as it
// does on Rook: `isAugment` reads `augmentAttrs || augmentText || augmentable`
// and printed.json gives Slurpr neither of the first two. `self` is the
// ANCHOR, so augmented onto a host the permission belongs to the HOST's
// controller — what "[Augment]" means everywhere else in the engine.
card('Slurpr', {
  augmentable: true,
  // R268: printed INSIDE the [Augment] box, so it radiates from a unit in
  // play AND from an augment mod. Body text does neither when the card is a mod.
  augmentBox: {
    modPermissions: [{
      applyAtHaste: (g, self, ctx) => ctx.seat === self.controller,
    }],
  },
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

// (no rules text) — ll/7 4/6 {Haste} {Flying} Angel Spirit Unit with the
// printed banner "[2ll] Prophecy — End [Haste] with used mana". Everything the
// banner does is engine-side: the prophesy action (R42/R301, deployment only,
// mana AND the banner's own affinity — the second light pip in both the cost
// and the banner was read off the scan on 2026-09-20, having been lost in
// transcription), the PROPHECY_RULES row `hasteWithUsedMana` (R43 — you must haste
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
// The Origon pattern: at play time the card is not on the stack yet
// (commitItem fires the event before pushItem), so the item is found at
// RESOLUTION, with this trigger sitting above it.
//
// R207 / CT-79 — BY ID, and the engine had to be taught to say which id.
// "Negate THAT EFFECT" is the pronoun R164/R166 settled for Origon and Hexbane
// Shiitake, and R178/R191 finished those two by matching on the id the play
// event carries. That fix was IMPOSSIBLE here until now: `spellPlayed` carries
// `item`, `cardPlayed` did not, and this card must hear `cardPlayed` because
// it must see UNITS as well as spells (R129, below). So the id went onto
// `cardPlayed` too (engine.ts, `commitItem`) and this is the fourth and last
// card in that class — Earthbound Replicator (R178), Origon, Hexbane Shiitake
// (both R191), and this. The class was closed one card at a time across three
// tickets (CT-58 → CT-69 → CT-79); the sweep that ends it is exhaustive over
// every `g.s.stack` access in all 30 set files, and every other one either
// matches an id off a target ref or sweeps the whole stack.
//
// THE THREE DEFECTS IT CLOSES, all of them live:
//  (a) the scan ran FORWARD from index 0 while `pushItem` appends, so with two
//      same-card same-seat plays on the stack it negated the OLDER one. (Not
//      even R166's `.reverse()`, which the other two cards at least had.)
//  (b) NO `!i.copy` guard at all, so it could negate a COPY where the original
//      never reached the stack. R164: a copy is NOT played — *"the 1st copy
//      wasn't 'played'"* — so a card keying off a play must not see one. By id
//      that is now true for a STRONGER reason than a flag test: `pushSpellCopy`
//      never routes through `commitItem`, so no play event can ever name a
//      copy. The guard stays as an ASSERTION of what the id must be, exactly
//      as R191 kept it on the other two.
//  (c) the one no ticket named: the OTHER `cardPlayed` emitter, the `asPlay`
//      spawn (R165 — Wake the Dead, The Bonesculptor), has no stack item at
//      all. Wake the Dead is a {Battle} spell, so a unit it raises out of a
//      bin could share a name with an unrelated item standing on the stack and
//      this card negated THAT. Absent `item` now means "this play put no
//      effect on the stack" and nothing is negated.
//
// ⚠ (c) LEAVES A DIVERGENCE, deliberately: the sacrifice is still paid on a
// play that has no item to negate, because "sacrifice me. If you do, negate
// that effect" (R73) makes the cost mandatory and the negate conditional on
// it, not the other way round. Under R198 that play WOULD be on the stack and
// the sacrifice would buy something; the `asPlay` path predates R198 and still
// spawns in place. That is an engine approximation, not a rule, and it is
// named at `spawnUnit`'s `playEv` rather than papered over with a `when` guard
// that would quietly rewrite when this card triggers.
//
// R129: it hears 'cardPlayed', not 'spellPlayed'. The printed noun is CARD,
// and "everything is a card, including units" (owner, 2026-08-24) — so a
// {Battle}-timing UNIT and an AMBUSH are exactly as much "a card played
// during battle" as a spell is, and both used to push a stack item with no
// play event at all. 'cardPlayed' fires for spell / spell unit / unit /
// ambush and NOT for a spell token, so the printed "nontoken" is now true by
// construction; the `token !== true` guard below is kept as belt-and-braces
// so a future payload change cannot quietly widen the card.
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
    type: 'triggered', events: ['cardPlayed'],
    label: 'sacrifice me to negate a nontoken card played during battle',
    when: (g, _self, ev) => g.s.phase === 'battle' && ev.data?.['token'] !== true,
    effect: {
      castCost: { kind: 'sacrificeUnits', from: 'self', n: 1 },
      run: (g, ctx) => {
        const name = ctx.event?.data?.['card'] as string | undefined;
        const seat = ctx.event?.data?.['seat'] as Seat | undefined;
        const itemId = ctx.event?.data?.['item'] as number | undefined;
        if (name === undefined || seat === undefined) {
          g.ev('info', 'Void Mandible: the event names no card — nothing is negated.');
          return;
        }
        // R207 (c): the play never built a stack item — an `asPlay` spawn.
        // There is no effect standing there, so there is nothing to negate;
        // the old (card, controller) scan would have found somebody else's.
        if (itemId === undefined) {
          g.ev('info', `Void Mandible: ${name} was played with no effect on the stack — nothing is negated.`);
          return;
        }
        // R207: BY ID — the item the event NAMES. The rest are assertions
        // about what that id must be, not a search:
        //  · R129's membership, the same one 'cardPlayed' fires for, so a
        //    {Battle} unit and an Ambush are in it and a spell token is not;
        //  · R164's `!i.copy` — a copy was never played, and by id it is
        //    unreachable anyway (`pushSpellCopy` bypasses `commitItem`).
        const it = g.s.stack.find(i =>
          i.id === itemId && i.controller === seat && !i.copy && CARD_PLAY_KINDS.has(i.kind));
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
// reminder text).
//
// ✔ THE READING IS CONFIRMED (owner, 2026-08-23). This card prints no
// reminder text, so the three-copy reading used to be an inference and was
// carried in the card ledger as `unverified`. Asked directly, the owner closed
// it by naming the other card that prints the mechanism: "Amphivavor is the
// same. It creates a special Grafted ability with everything on there three
// times" ("Amphivavor" = Amphivore). Amphivore is `graftCopies: 3` — this
// card's own field — so nothing here changed; the ledger entry went, and the
// {todo:true} became a real test in 40-light-c.test.ts.
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
      // R131: NOT a card-name exclusion — the grafts this multiplier has
      // nothing to do with are the OTHER MULTIPLIERS (composeParts never
      // multiplies a multiplier), whatever they are called. A second copy
      // of this very card grafted here is one of them; a different multiplier
      // grafted alongside is too.
      return m && m.appliedAs === 'graft' && !isGraftMultiplier(m.card);
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
