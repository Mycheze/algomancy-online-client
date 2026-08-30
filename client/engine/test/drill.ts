/**
 * THE CARD DRILL — a deterministic driver that plays ONE named card through
 * the engine's own action path, in a real game, and reports what happened.
 *
 * WHY THIS EXISTS
 *
 * The owner's complaint, verbatim: "we keep running into non functional
 * cards… I'm tired of coming across cards that just don't even do what
 * they're supposed to."
 *
 * Two nets already existed and neither could catch that class:
 *
 *  - `65-effect-conformance` is FUZZ-driven, so it only ever sees the cards a
 *    random walk happens to reach. Measured on 2026-08-23: 143 of the 424
 *    cards with effects were NEVER driven, not once, across 140 fuzz games.
 *    An effect that never runs can never be caught being silent.
 *  - `71-card-ledger` reads a card's SHAPE. That catches `events: []` and an
 *    empty `run`, but a card whose run collects a target, names a player and
 *    then quietly does nothing reads as working code.
 *
 * The gap between them is the card that LOOKS alive, is never driven, and
 * does nothing in a real game. That is the Harbinger class, and it is what
 * this file drives out.
 *
 * WHAT "the exact code that would appear in a game" MEANS HERE
 *
 * The drill never calls an effect's `run` directly and never pokes state to
 * simulate a cast. It puts the card in a hand, walks the real game forward,
 * and plays it with the `playCard` action the UI sends — chosen out of
 * `legalActions`, so the engine's own legality is what decides when the card
 * may be played. Everything after that is the ordinary stack: priority is
 * passed, decisions are answered, the item resolves. If a card cannot be
 * reached this way it is not castable in a real game either, and that is a
 * finding rather than a limitation of the harness.
 */
import { apply, createGame, legalActions, IllegalAction } from '../src/apply.ts';
import { getCard } from '../src/cards/dsl.ts';
import { E } from '../src/engine.ts';
import { checkInvariants } from './fuzz.ts';
import type { Action, Element, Entity, EntityId, GameState, Seat } from '../src/types.ts';

const ELEMENTS: Element[] = ['fire', 'water', 'earth', 'wood', 'metal', 'light', 'dark'];

/**
 * Hosts the drill prefers to hang an augment on — CARD-TODO #49 stage 4.
 *
 * Vanillas, for the same reason `seedBoard` seeds vanillas: nothing the drill
 * observes while the card is attached may be the HOST's own doing. Tidal
 * Menace and The Foretold have no text, no attributes and no triggers, so a
 * `Resolving <card>: …` window on that host can only be the augment's.
 */
const INERT_HOSTS = new Set(['Tidal Menace', 'The Foretold']);

/**
 * IS THIS RESOLUTION THIS CARD'S OWN? — the attribution seam for stages 3 & 4.
 *
 * Stage 2 established the rule that makes a gated claim's evidence worth
 * anything: it must come from a window that could actually satisfy the gate.
 * It did that with a TIME window (open at the activation, close when it
 * resolves). A trigger fixture cannot use a time window and stay honest — the
 * fixtures that matter most are combat ones, and combat emits `damage`,
 * `died`, `lifeLost` and `draw` of its own, so a window running from
 * "I declared an attack" to "the battle ended" would evidence half the claim
 * vocabulary for every card on the board. That is exactly the mistake the
 * ticket warns about, one layer down.
 *
 * So the window is bound by the ENGINE'S OWN LABEL instead. `queueTrigger`
 * builds a triggered item's label as `${cardName}: ${ability.label}` and
 * `doActivateAbility` builds an activation's as `${srcCard}: ${ability.label}`
 * — or `${srcCard} (on ${faceCard}): …` when the text was donated by a mod,
 * which is precisely the `[Augment]` case. `resolveItem` then logs
 * `Resolving ${item.label}:`. So a resolution headed by this card's name is
 * this card's ability firing, wherever it is printed and whatever host it is
 * riding, and everything until the next `resolved` event is its payload.
 *
 * ⚠ THE CAST IS DELIBERATELY EXCLUDED. A spell's own item is labelled with the
 * bare card name, so it logs `Resolving Immolate:` with NOTHING after the
 * colon, while a trigger logs `Resolving Geode: Create a Crystal 1:`. Testing
 * for the trailing separator is what keeps a card's own cast from evidencing
 * its own "when I die" clause — the same confusion that let Oracle of the
 * Flame's body evidence its activated ability before stage 2.
 *
 * ⚠ AND THE SEPARATOR IS WHY THIS IS NOT A BARE `startsWith`. `Resolving Wisp`
 * is a prefix of `Resolving Wispweaver: …`, so a prefix test alone would
 * attribute one card's trigger to another card entirely.
 */
/**
 * Event types that END this card's evidence window even though no other item
 * started resolving. A resolution's payload cannot outlive the STEP it ran in:
 * without these, Spirit of Vengeance's "[Augment] When I die, deal 1 damage"
 * resolved and its window then ran on through the after-combat step, the phase
 * change and the next combat's face damage, collecting a `lifeLost` and an
 * `afterCombat` it had nothing to do with. That is the ticket's own warning —
 * a window that runs to game over evidences everything — arriving one layer
 * further in than it was expected.
 */
const WINDOW_CLOSERS = new Set<string>([
  'phase', 'turn', 'draft', 'combatDamage', 'afterCombat',
  'attackDeclared', 'blocksDeclared', 'attacked', 'blocked', 'triggered',
  'spellPlayed', 'cardPlayed', 'stackPushed',
]);

export function ownResolution(msg: string, card: string): boolean {
  return msg.startsWith(`Resolving ${card}: `) || msg.startsWith(`Resolving ${card} (on `);
}

/** how many windows activate mode keeps walking with nothing left to activate
 *  before it calls the card done. A battle-timing ability is not offered until
 *  the next battle, which is tens of windows away from a deployment-phase
 *  play, so this has to be generous — but it is bounded, because an unbounded
 *  walk costs 600 steps on every card that has no ability at all. */
const ACTIVATE_PATIENCE = 90;

/**
 * PRESS MODE'S THREE PATIENCES — R199.
 *
 * These used to be one expression, `(fired < all || idle < 90) && idle < 720`,
 * and it was tuned against a board that KILLED ITSELF: the seeded position is
 * lethal, so a press run reliably hit `gameover` in the fifties and the 720 cap
 * was never reached by anything at all.
 *
 * ⚠ AND THE EARLY DEATH WAS SILENTLY COSTING COVERAGE. `nextBeat` will not let
 * `die` or `despawn` fire until TWO battles have finished, and traced on Ghord
 * the game ended at step 55 with `battlesSeen=1` — so those two beats never
 * became eligible and only 29 of the 31 fixtures fired. The extra bodies the
 * `inBattle` beats put on the board made that worse, not better. Raising the
 * life top-up (`< 12 → 25` became `< 40 → 61`, still an ODD total, because "if
 * your life total is odd" is a printed condition on Ploosh and Insatiable Want)
 * fixes it and all 31 fire — and it turned the dead cap into the live one,
 * because the run now spends its time walking phases after the last beat has
 * fired instead of dying part-way through.
 *
 * So the cases are separated and each is given the number it actually needs.
 * MEASURED over the whole pool at both the loose setting and this one, same
 * commit: coverage is IDENTICAL — 278/316, and the same 38 claims unobserved,
 * name for name — and the tight one is the faster of the two by a wide margin.
 * 84-card-semantics runs in 1m33s at these numbers, against 1m05s before R199;
 * a game that does not end early is simply a longer game, and that length is
 * what the fourteen extra promises are bought with.
 *
 * ⚠ FIXTURE_PATIENCE MUST STAY ABOVE 60. `nextBeat`'s escape hatch — the one
 * that lets `die` fire on a card whose remaining soft beat needs a phase this
 * game will not reach — is spelled `stalled < 60`, and `stalled` IS this
 * counter. Cutting this below that number silently deletes the hatch.
 */
const FIXTURE_PATIENCE = 65;
/** windows to keep walking when the ONLY beats left are `inBattle` ones. They
 *  need the card to march into a battle, which is a whole phase away — but
 *  unlike every other beat they may be unreachable FOREVER (a spell has no
 *  body to stand anywhere), so they get their own, shorter rope. */
const BATTLE_PATIENCE = 24;
/** windows to keep walking after the LAST fixture has fired, so a death
 *  trigger queued by `die` gets its resolution counted. A trigger reaches the
 *  stack in the same window and resolves in the next few. */
const SETTLE_PATIENCE = 10;

export interface DrillResult {
  card: string;
  /** the card became a legal `playCard` at some window and was played */
  played: boolean;
  /** the play resolved off the stack (or was a permanent that entered play) */
  resolved: boolean;
  /** engine events emitted from the moment of the play onward */
  events: string[];
  /** event TYPES, for asserting something other than a log line happened */
  types: string[];
  /** how the drill ended */
  outcome: 'resolved' | 'never-legal' | 'stuck' | 'crash' | 'illegal';
  /** populated on 'crash' / 'illegal' */
  error?: string;
  /** the action that broke, if any */
  badAction?: Action;
  /** phases at which the card was seen as a legal play */
  windows: string[];
  /** entities on the board that were not there before the play */
  newEntities: string[];
  /** a compact description of what changed in the game state */
  changed: string[];
  /** events emitted strictly from the resolution of THIS card onward — the
   *  card's own effect, with the "plays → stack" bookkeeping stripped */
  effectEvents: string[];
  /** event TYPES emitted from this card's own resolution onward — what the
   *  card DID, in the engine's own vocabulary rather than in prose */
  effectTypes: string[];
  /** the effect announced a guard ("… — nothing happens."). Legitimate, but
   *  it means the drill did NOT observe the card's payload, so a human has to
   *  say whether the condition should have been met. */
  guarded: boolean;
  /** `activate` mode: the abilities of THIS card that were actually paid for
   *  and put on the stack, as `<abilityIndex>:<label>`. Empty means the card
   *  has no activated ability, or none of them was ever legal. */
  activated: string[];
  /** `activate` mode: event types emitted strictly AFTER the first activation.
   *  Taken from the activation onward and not from the play, because a unit's
   *  own arrival is a `spawned` — scoring an ability that prints "Create a
   *  Poison 1" against the whole post-play window would let the unit's own
   *  body be the evidence for its ability. Oracle of the Flame and Sprouter
   *  both read as delivering without this. */
  activateTypes: string[];
  /** `activate` mode: the state delta from the first activation onward */
  activateChanged: string[];
  /** `augment` mode: the card was applied to a host as an `[Augment]` mod */
  attached: boolean;
  /** `augment` mode: the host it landed on */
  host?: string;
  /** `augment` mode: the state delta across the attach itself, which is the
   *  ONLY evidence a continuous `[Augment]` static can offer — it emits no
   *  event at all, it is a layer (see STATE_EVIDENCE in claims.ts). */
  attachChanged: string[];
  /** event types emitted inside a resolution HEADED BY THIS CARD'S NAME — its
   *  triggered abilities, its `[Augment]`-box text riding a host, its activated
   *  abilities. Never its own cast, never ambient combat. See `ownResolution`. */
  ownTypes: string[];
  /** the state delta across the steps that carried such a resolution */
  ownChanged: string[];
  /** the fixtures that actually fired, in order */
  fired: string[];
  /**
   * R199: the augment's CONTINUOUS text was seen BITING — `staticBite` said that
   * taking this mod out of the game changes somebody's effective power/defence,
   * and putting it back changes it again.
   *
   * Reported separately from `attachChanged` because that array is a mixture: it
   * also carries the coarse attach delta and the "the host DIED of it" push
   * (Malformed Monstrosity), so a test that wants to say *this layer works*
   * cannot read it without accepting a host's death as proof of a pump. This
   * flag has exactly one writer, `staticBite`.
   */
  staticBit: boolean;
  /**
   * R199: every beat that fired while the card was STANDING IN THE BATTLE, as
   * `<beat>:home=<n>:at=<n>:battle=<n>`.
   *
   * The three numbers are the whole point and none of them is redundant.
   * `at === battle` is true by construction — that is the pin — so on its own it
   * proves nothing. `at !== home` is the fact that cannot be faked: it says the
   * card LEFT ITS HOME REGION and was standing in the defender's when the world
   * acted on it. A test that reads only the beat names would pass just as
   * happily against a predicate hard-wired to `true`, which is why the position
   * is recorded and not merely the beat.
   */
  inBattleBeats: string[];
  /**
   * R211 / CARD-TODO #87: the run ENDED with an activation still unresolved,
   * so its evidence window was never closed and this run can say NOTHING about
   * what that activation delivered.
   *
   * This is the THIRD STATE, and it exists because the previous code had only
   * two. When the loop ran out (`maxSteps`) or the game ended mid-activation,
   * the tail below credited EVERY event from the activation to wherever the
   * drill stopped — the rest of the game — to `activateTypes`. Anything any
   * card did in that span became this card's evidence. Slag Spewer read as
   * OBSERVED on exactly that accident: the window swallowed an `erased` its
   * HOST's later destruction produced (CT-86). R199 made press runs end
   * cleanly, which closed the window and the card went dark — that is how the
   * whole EVENTLESS category was found.
   *
   * "Rarely reached" is not "cannot fire", so the window is now bounded and an
   * unclosable one is recorded here instead of guessed at. An honest "could
   * not tell" is worth more than a credited event that belongs to another card.
   */
  actInconclusive: boolean;
  /**
   * CT-92 — how many times this run was OFFERED a second activation while the
   * first was still unresolved, and REFUSED it.
   *
   * `pendingAct` is a single SLOT, not a stack. Before R232 the branch that
   * takes an activation did not require an empty stack, so a second activation
   * offered mid-resolution would OVERWRITE the open evidence window and
   * everything the first activation delivered was dropped without a trace.
   *
   * ⚠ NOTE WHICH DIRECTION THAT ERRED IN, because it is the reason nobody
   * caught it. It makes a card read as delivering LESS than it did — the
   * UNFLATTERING direction — so unlike round 26's four blindnesses it would
   * never have surfaced as a suspiciously good number. It produces a plausible
   * "never observed", which is a state the suite already expects to see. This
   * is the mirror of CT-87: that one CREDITED evidence that was not the card's,
   * this one DISCARDED evidence that was. Both make the drill lie.
   *
   * Measured at ZERO across the whole pool both before and after the fix. A
   * dormant defect with a live counter is cheap; a dormant defect with nothing
   * watching it is how this class comes back — so the counter stays even at
   * zero, and `81-card-drill` prints it.
   */
  actRefusedSecond: number;
  /** why the run could not close the window — which of the two loop exits it
   *  took. Recorded separately because they mean different things: `maxSteps`
   *  says the drill is too impatient for this card, `gameover` says the board
   *  killed somebody before the stack drained, and only the first is fixable
   *  by turning a knob. */
  actInconclusiveReason?: 'maxSteps' | 'gameover';
  /** the event types the OLD unbounded tail WOULD have credited to this card,
   *  kept but never scored. This is the measurement CT-87 part 1 asks for and
   *  it is also the positive control's read-out: a test can point at a run
   *  where this is non-empty, `activateTypes` does not contain it, and the
   *  claim is therefore refused rather than credited. Do not let anything
   *  score off this array — it is the borrowed evidence, by construction. */
  actInconclusiveTail: string[];
  /** the same for the state delta the old tail would have credited */
  actInconclusiveTailChanged: string[];
  /** the LOG LINES over the same span. Types alone cannot show WHOSE event a
   *  borrowed event was; the message can ("Player 1 plays <some other card>"),
   *  and the CT-87 positive control quotes these verbatim. */
  actInconclusiveTailEvents: string[];
}

/**
 * THE FIXTURE LIBRARY — CARD-TODO #49 stage 3.
 *
 * 110 printed promises sit behind "When …" / "Whenever …" and 19 behind a
 * board predicate. The drill stops the instant the card's own play resolves,
 * so the events those clauses listen for simply never happen: measured before
 * this, 54 of the 110 and 12 of the 19 had never once been observed.
 *
 * Each fixture makes ONE thing happen in the world and then hands the game
 * back. They are engine-level pokes on purpose — `E.destroy`, `E.loseLife`,
 * `E.addCounters` — exactly as `seedBoard` is: the fixture is the WORLD acting,
 * and the card under test still has to hear it through the engine's own
 * `fireEvent` dispatch, queue its own trigger, put it on the stack and resolve
 * it. Nothing about the card's own path is faked.
 *
 * `subject` is the entity the card's text is about: its own body when a unit
 * was cast, the HOST when the card is riding as an augment.
 */
type Fixture = {
  name: string;
  /** this beat destroys the subject, so it goes LAST — after every other
   *  fixture has had its turn, which (because the battle-phase repeats below
   *  can only fire in a battle) means after the card has had a battle to
   *  attack, block and survive in.
   *
   *  ⚠ THIS GATE IS NOT A DETAIL. The beats fire at every quiescent window,
   *  and a card played in deployment reaches a dozen of those before the phase
   *  ends — so ungated, `die` killed the card's body inside the same
   *  deployment step it arrived in, and every "when I attack", "when I block"
   *  and "after combat" trigger in the pool was then listening from the bin.
   *  Measured across the pool: 46 trigger promises observed without the gate,
   *  82 with it. */
  last?: boolean;
  /** the phase this beat must land in. ⚠ "DURING BATTLE" IS A PRINTED
   *  QUALIFIER on nine cards ("When another ally spawns during battle",
   *  "whenever a card enters your hand during battle", "whenever you apply an
   *  augment during battle", "when you gain or lose life during battle") and
   *  the beats naturally land in deployment, where those clauses are correctly
   *  silent. So the soft fixtures are listed TWICE — once wherever the game
   *  happens to be quiet, once pinned to the battle phase.
   *
   *  ⚠⚠ `inBattle` IS A THIRD, STRICTLY NARROWER PIN, and R199 exists because
   *  `battle` turned out not to be it. Measured on Galerider Eel at the head of
   *  R199: all seven `@battle` repeats fired at steps 29–35 and every one of
   *  them landed in the DECLARE step — `battleReg=1, subjReg=0`. The battle
   *  phase had begun and the card was still standing at home, because attacks
   *  had not been declared yet. Its clause reads
   *  `g.s.battle?.region === self.region`, so the whole family was silent for a
   *  reason that has nothing to do with the card.
   *
   *  `inBattle` fires a beat only while the SUBJECT IS STANDING IN the battle's
   *  region. That position is one the drill already reaches — the same trace
   *  shows `subjReg=1` from step 37 on, because `progressAction` declares the
   *  fullest attack on offer and `doDeclareAttack` moves every attacker into
   *  the defender's region. What was missing was never the attack; it was a
   *  beat that waits for it. */
  phase?: 'deploy' | 'battle' | 'battleJoined' | 'inBattle';
  run: (e: E, seat: Seat, subject: Entity | undefined, card: string) => void;
};

/**
 * WHERE THE SUBJECT IS STANDING — the region an `inBattle` beat must act in.
 *
 * ⚠ NOT `homeRegion`, and that is the entire point of the family. R12 scopes
 * every event to the region it fires in, so a beat that spawns an ally, places
 * a counter or applies a mod in the seat's HOME region is inaudible to a card
 * that has marched into the defender's region to attack. The soft beats all
 * aim at home; these aim at wherever the card actually is.
 */
const at = (subject: Entity | undefined): number | undefined => subject?.region;

const SOFT_BY_NAME: Record<string, Fixture> = {};

const FIXTURES: Fixture[] = [
  // ── the non-destructive ones first: the subject has to survive them ──
  {
    name: 'allySpawn',
    run: (e, seat) => {
      // "When another ally spawns", "When another nontoken ally spawns",
      // "When another ally with greater defense than power spawns" — a
      // vanilla with 3 defense and 2 power satisfies the last of those.
      for (const who of [seat, (1 - seat) as Seat]) {
        // Bubb is 5/6: "another ally with GREATER DEFENSE THAN POWER"
        // (Nectar Ridge Oracle) is a printed qualifier no 3/3 vanilla meets.
        for (const body of ['The Foretold', 'Bubb']) {
          try { e.spawnUnit(who, body, e.homeRegion(who), {}); } catch { /* unregistered */ }
        }
      }
    },
  },
  {
    name: 'enemyHere',
    // R12: every static and every trigger is REGION-scoped, and `seedBoard`
    // puts each side in its own home region — so "Enemies gain +2/+2"
    // (Towering Colossus) had nothing in scope to affect and read as dead.
    // An attacker standing in the defender's region is an ordinary battle
    // position, not a contrivance.
    run: (e, seat) => {
      const foe = (1 - seat) as Seat;
      try { e.spawnUnit(foe, 'Tidal Menace', e.homeRegion(seat), {}); } catch { /* unregistered */ }
    },
  },
  {
    name: 'token',
    // "Whenever a unit token is created" (The World Shepherd) is not the same
    // event as an ordinary spawn, and the vanilla ally above is not a token.
    run: (e, seat) => {
      try { e.spawnUnit(seat, 'Unit Token', e.homeRegion(seat), { token: true }); } catch { /* unregistered */ }
    },
  },
  {
    name: 'counters',
    run: (e, seat, subject) => {
      // "When you put a counter on an ally" and "…on an enemy" are two
      // different cards, so both sides get one — and BOTH SIGNS, because
      // "whenever one or more -1/-1 counters are put on a unit" (Pestilent
      // Mycelion, Decay Distributor) is a different clause from the +1/+1 one
      // and a positive-only fixture answers neither of them.
      // R12 again: "when you put a counter on an ENEMY" (Wandering Blightshell)
      // can only hear a counter placed in ITS OWN region, and the foe's own
      // home region is not that. The `enemyHere` beat above put an enemy in
      // ours; this is the beat that has to use it.
      const foe = (1 - seat) as Seat;
      for (const region of [e.homeRegion(seat), e.homeRegion(foe)]) {
        for (const who of [seat, foe]) {
          const us = e.unitsOf(who, region);
          if (us[0]) e.addCounters(us[0], 1, seat);
          if (us[1]) e.addCounters(us[1], -1, seat);
        }
      }
      if (subject && e.entity(subject.id)) e.addCounters(subject, 1, seat);
    },
  },
  {
    name: 'damage',
    // "Whenever I am dealt damage" / "whenever I survive damage" (Awoken Tomb,
    // Mirage Scuttler, Molten Tormentor, Decay Distributor, Blightmound). One
    // point, so the subject SURVIVES it — both halves of that pair of clauses
    // need the same hit and only one of them needs it to be non-lethal.
    run: (e, seat, subject) => {
      const ctx = {
        // ⚠ `sourceName` must be a REGISTERED CARD: `dealEffectDamageAll`
        // looks it up to read the source's printed attributes ({Deadly},
        // {Poisonous}, {Reaping} …). A made-up name throws, and the throw was
        // swallowed by the fixture's own catch — the beat fired, the damage
        // never landed and four "when I am dealt damage" cards stayed dark.
        // The Foretold is the vanilla: no text, no attributes, nothing to add.
        controller: seat, sourceName: 'The Foretold', region: e.homeRegion(seat),
        targets: [], event: null,
        eraseSelf: () => { /* no stack item here — a direct-run ctx */ },
        choose: () => { throw new Error('no choice expected'); },
      } as unknown as Parameters<E['dealEffectDamage']>[0];
      if (subject && e.entity(subject.id)) e.dealEffectDamage(ctx, subject, 1);
      const foe = e.unitsOf((1 - seat) as Seat)[0];
      if (foe) e.dealEffectDamage(ctx, foe, 1);
    },
  },
  {
    name: 'life',
    run: (e, seat) => {
      // both directions, both seats: "when a player loses life", "whenever you
      // gain life", "when you deal combat damage to an opponent" (which is a
      // lifeLost on the opponent).
      e.gainLife(seat, 3, 'drill fixture');
      e.loseLife((1 - seat) as Seat, 3, 'drill fixture');
      e.loseLife(seat, 3, 'drill fixture');
    },
  },
  {
    name: 'draw',
    run: (e, seat) => { for (const who of [seat, (1 - seat) as Seat]) e.draw(who, 1); },
  },
  {
    name: 'trash',
    run: (e, seat) => {
      // "When I am trashed", "when you trash a card", "when another card is
      // trashed", "when I enter your bin" — a DISCARD is a trash (R40), and
      // both seats do it because half these cards say "you" and half say
      // "a player".
      for (const who of [seat, (1 - seat) as Seat]) {
        const hand = e.player(who).hand;
        if (!hand.includes('Tidal Menace')) hand.push('Tidal Menace');
        e.discardFromHand(who, hand.indexOf('Tidal Menace'));
      }
    },
  },
  {
    name: 'modApplied',
    // ⚠ ON SOMEBODY ELSE, never on the subject. R79 makes a modded card
    // {Unstable}, so modding the card under test turns its next death into an
    // ERASE — Colony of the Interworld blocked, died, was erased out of the
    // bin, and every later beat fired at a card that had left the game. The
    // event ("whenever you apply an augment", Morphic Mentor) is region-wide
    // and does not care which ally wore it.
    run: (e, seat, subject) => {
      const host = e.unitsOf(seat, e.homeRegion(seat)).find(u => u.id !== subject?.id && !u.token);
      if (host) e.attachMod(host, 'Curio Drifter', seat, 'augment');
    },
  },
  {
    name: 'leftBin',
    run: (e, seat, _subject, card) => {
      // R124: 'leftBin' reaches the card that just left AND NOBODY ELSE, so
      // the card under test has to be the one leaving (Rotling's "When I leave
      // your bin"). It goes straight back afterwards, because the bin-ZONE
      // listeners of the later beats — "if I am in your bin, after combat …"
      // (Lurking Dread, Inexorable Miasma, Cinder Scuttler) — need it there.
      const bin = e.player(seat).bin;
      bin.push(card);
      e.removeFromBin(seat, bin.length - 1, 'drill fixture');
      bin.push(card);
    },
  },
  {
    name: 'targeted',
    // "When I become targeted" (Mohruung) and "whenever an ally becomes the
    // target of an enemy spell" (Earnest Defender). Synthesised in the shape
    // `doAugment`/`collectTargets` build it — `{ unit, region }` — because
    // there is no engine helper that targets something without an effect
    // wrapped round it.
    run: (e, seat, subject) => {
      const u = subject && e.entity(subject.id) ? subject : e.unitsOf(seat, e.homeRegion(seat))[0];
      if (!u) return;
      const ev = e.ev('targeted', `The Foretold targets ${u.card}.`, { unit: u.id, region: u.region });
      e.fireEvent('targeted', ev);
    },
  },
  {
    name: 'enemyDies',
    // "Whenever a nontoken enemy dies" (Fungal Gardener). The `die` fixture at
    // the bottom kills the SUBJECT, which is an ally — a different clause.
    run: (e, seat) => {
      const foe = (1 - seat) as Seat;
      for (const u of e.unitsOf(foe).filter(x => !x.token).slice(0, 2)) e.destroy(u, 'dies');
    },
  },
  {
    name: 'allyDies',
    // "When the second ally dies in this battle" (Mischievous Reclaimer)
    // needs TWO, and neither of them may be the subject — the subject's own
    // death is the last beat of all and would come too late to be the second.
    run: (e, seat, subject) => {
      const mine = e.unitsOf(seat).filter(u => u.id !== subject?.id).slice(0, 2);
      for (const u of mine) e.destroy(u, 'dies');
    },
  },
  // ── the same soft beats again, pinned to the BATTLE phase, for the nine
  //    cards whose clause carries a printed "during battle" ──────────────
  ...(['counters', 'life', 'draw', 'trash', 'modApplied', 'damage'] as const)
    .map(name => ({
      name: `${name}@battle`,
      phase: 'battle' as const,
      run: (e: E, seat: Seat, subject: Entity | undefined, card: string) => {
        SOFT_BY_NAME[name]!.run(e, seat, subject, card);
      },
    })),
  {
    // ⚠ `allySpawn@battle` IS PINNED ONE NOTCH LATER THAN ITS SIX SIBLINGS, and
    // R199 paid for the distinction card by card. A BOUNDED ([Switch1]/[once])
    // trigger has ONE use per turn (R9), and the budget is spent the moment the
    // trigger is QUEUED — whether or not its payload finds anything to do. The
    // battle phase opens in the DECLARE step, before attacks exist, and this
    // beat spawns at home: so Boreal Wanderer ("When another ally spawns during
    // battle, I deal 2 damage to each opponent") heard the home spawn while
    // standing at home, queued its one bounded use into a region where
    // `presentSeats` holds nobody but itself, announced "no opponent is present
    // here — no damage", and was out of uses for the turn before it had even
    // marched. Waiting for `battle.happened` costs nothing — a card that never
    // leaves home still hears this beat, because it is still spawning at home —
    // and it hands the bounded use to the `@inBattle` twin, where an opponent
    // IS present.
    //
    // ⚠⚠ AND ONLY THIS ONE. Pinning all seven this way was measured: Boreal
    // Wanderer and Bloated Manablub came in, but Wisp, Synaptic Energizer and
    // Delver of the Ephemeral ("After combat, …") went dark and the total FELL
    // by one, at twice the runtime. The other six beats do not gate a bounded
    // trigger on a region-scoped payload; they had no reason to move.
    name: 'allySpawn@battle',
    phase: 'battleJoined',
    run: (e: E, seat: Seat, subject: Entity | undefined, card: string) => {
      SOFT_BY_NAME['allySpawn']!.run(e, seat, subject, card);
    },
  },

  // ── R199: the same world, acting IN THE BATTLE THE CARD IS STANDING IN ──
  //
  // Every beat below is region-aware where its `@battle` twin is not: it aims
  // at `subject.region`, which during an attack is the DEFENDER's region.
  // Copying the soft beats verbatim (the way the `@battle` repeats do) would
  // have been pointless here — `allySpawn` spawns into `e.homeRegion(who)`, and
  // R12 makes a home-region spawn inaudible to a card that has marched out to
  // attack. The pin says WHEN; the region says WHERE; both are needed.
  {
    name: 'allySpawn@inBattle',
    phase: 'inBattle',
    // Boreal Wanderer: "When another ally spawns during battle, I deal 2 damage
    // to each opponent." `fireEvent` region-scopes the listener, and
    // `dealTwoToEachOpponent` then reads `regions[ctx.region].presentSeats` —
    // which in the DEFENDER's region during an attack contains both seats. Both
    // halves need the same thing and neither gets it from a home-region spawn.
    run: (e, seat, subject) => {
      const r = at(subject);
      if (r === undefined) return;
      for (const body of ['The Foretold', 'Bubb']) {
        try { e.spawnUnit(seat, body, r, {}); } catch { /* unregistered */ }
      }
    },
  },
  {
    name: 'draw@inBattle',
    phase: 'inBattle',
    // Galerider Eel ("whenever one or more OTHER cards enter YOUR hand during
    // battle"), Rider of the Tides and Xenopod Progenitor ("a player's hand").
    // A draw is a `toHand`, so it fires 'handEntered' (R179) — the event does
    // NOT carry a region, which is exactly why all three cards pin the listener
    // to `g.s.battle?.region === self.region` themselves.
    run: (e, seat) => { for (const who of [seat, (1 - seat) as Seat]) e.draw(who, 1); },
  },
  {
    name: 'life@inBattle',
    phase: 'inBattle',
    // Colony of the Interworld: "When you gain or lose life during battle, put
    // three +1/+1 counters on me." `E.loseLife` stamps the event with
    // `battle.region` (R12), so only units standing in the battle hear it.
    run: (e, seat) => {
      e.gainLife(seat, 3, 'drill fixture');
      e.loseLife(seat, 3, 'drill fixture');
      e.loseLife((1 - seat) as Seat, 3, 'drill fixture');
    },
  },
  {
    name: 'counters@inBattle',
    phase: 'inBattle',
    run: (e, seat, subject) => {
      const r = at(subject);
      if (r === undefined) return;
      for (const who of [seat, (1 - seat) as Seat]) {
        const us = e.unitsOf(who, r).filter(u => u.id !== subject?.id);
        if (us[0]) e.addCounters(us[0], 1, seat);
        if (us[1]) e.addCounters(us[1], -1, seat);
      }
      if (subject && e.entity(subject.id)) e.addCounters(subject, 1, seat);
    },
  },
  {
    name: 'damage@inBattle',
    phase: 'inBattle',
    // one point, so the subject SURVIVES it — same reasoning as the soft twin.
    // ⚠ `region` on the ctx is the SUBJECT's region and not home: a
    // region-scoped "whenever I am dealt damage" rider reads it.
    run: (e, seat, subject) => {
      const r = at(subject);
      if (r === undefined) return;
      const ctx = {
        controller: seat, sourceName: 'The Foretold', region: r,
        targets: [], event: null,
        eraseSelf: () => { /* no stack item here — a direct-run ctx */ },
        choose: () => { throw new Error('no choice expected'); },
      } as unknown as Parameters<E['dealEffectDamage']>[0];
      if (subject && e.entity(subject.id)) e.dealEffectDamage(ctx, subject, 1);
      const foe = e.unitsOf((1 - seat) as Seat, r)[0];
      if (foe) e.dealEffectDamage(ctx, foe, 1);
    },
  },
  {
    name: 'trash@inBattle',
    phase: 'inBattle',
    run: (e, seat) => {
      for (const who of [seat, (1 - seat) as Seat]) {
        const hand = e.player(who).hand;
        if (!hand.includes('Tidal Menace')) hand.push('Tidal Menace');
        e.discardFromHand(who, hand.indexOf('Tidal Menace'));
      }
    },
  },
  {
    name: 'modApplied@inBattle',
    phase: 'inBattle',
    // ⚠ ON SOMEBODY ELSE, never on the subject — R79 would make the card
    // {Unstable} and turn its next death into an erase. Same rule as the soft
    // twin; the only difference is which region the ally is found in.
    run: (e, seat, subject) => {
      const r = at(subject);
      if (r === undefined) return;
      const host = e.unitsOf(seat, r).find(u => u.id !== subject?.id && !u.token);
      if (host) e.attachMod(host, 'Curio Drifter', seat, 'augment');
    },
  },
  {
    name: 'token@inBattle',
    phase: 'inBattle',
    run: (e, seat, subject) => {
      const r = at(subject);
      if (r === undefined) return;
      try { e.spawnUnit(seat, 'Unit Token', r, { token: true }); } catch { /* unregistered */ }
    },
  },
  {
    name: 'targeted@inBattle',
    phase: 'inBattle',
    run: (e, seat, subject) => {
      if (!subject || !e.entity(subject.id)) return;
      const ev = e.ev('targeted', `The Foretold targets ${subject.card}.`,
        { unit: subject.id, region: subject.region });
      e.fireEvent('targeted', ev);
    },
  },

  // ── and the destructive ones last, and only once the card has had a
  //    BATTLE to attack, block and survive in first.
  {
    name: 'despawn',
    last: true,
    run: (e, seat, subject) => {
      if (!subject || !e.entity(subject.id)) return;
      const { card, controller, region } = subject;
      e.recall(subject);
      try { e.spawnUnit(controller, card, region, {}); } catch { /* not respawnable */ }
    },
  },
  {
    name: 'die',
    last: true,
    run: (e, seat, subject) => {
      if (!subject || !e.entity(subject.id)) return;
      // 'is sacrificed' rather than 'dies': R70 rides the verb on the event,
      // and Ghord reads it ("When you sacrifice a unit"). A sacrifice is also
      // a death, so every "when I die" listener hears it too — one verb
      // covers both families, where 'dies' covers only one.
      e.destroy(subject, 'is sacrificed');
    },
  },
];

/** every resource kind open, in bulk, so affinity and mana are never the
 *  reason a card cannot be reached. Prismites cover hybrid pip costs. */
function fundSeat(s: GameState, seat: Seat): void {
  const rs = s.players[seat]!.resources;
  rs.length = 0;
  for (const el of ELEMENTS) for (let i = 0; i < 6; i++) rs.push({ kind: el, state: 'open' });
  for (let i = 0; i < 6; i++) rs.push({ kind: 'prismite', state: 'open' });
}

/** a snapshot of the things a card could plausibly change */
function snapshot(s: GameState, seat: Seat) {
  // effective stats and attributes, NOT just base: nearly every pump spell in
  // the pool grants "+N/+N until regroup", which touches no counter and no
  // damage. Reading effStats/ownAttrs is what makes those visible as a change
  // — without it Might of the Grove, Overbloom, Burgeon and a dozen others
  // read as inert here while working perfectly.
  const e = new E(s);
  // per-entity readings, kept beside the joined string the ordinary `diff`
  // compares. `diff` is deliberately coarse — a new token IS a change it
  // should report — but the augment window needs the opposite: the arrival of
  // the mod itself must never be evidence, because EVERY augment makes its
  // host Unstable and lengthens the counters array, so a coarse read would
  // have scored a stat grant and a counter placement for all 117 cards.
  const byId = new Map<string, { nums: string; ctr: string; own: string }>();
  const stats = Object.values(s.entities).map(u => {
    let nums = '?';
    try { nums = e.effStats(u).join('/'); } catch { /* mid-resolution shapes */ }
    byId.set(String(u.id), {
      nums, ctr: JSON.stringify([u.counters, u.damage]), own: `${u.controller}:${u.region}`,
    });
    try { return `${u.id}:${nums}:${[...e.ownAttrs(u)].sort().join(',')}`; }
    catch { return `${u.id}:?`; }
  }).join('|');
  return {
    stats, byId,
    // control changes, rot and debt are all "the card worked" and none of them
    // touch a stat, a counter or a zone count (Download, Rebalance, Fester,
    // Spellbind, Reap the Due all read as inert without these)
    control: Object.values(s.entities).map(u => `${u.id}:${u.controller}:${u.region}`).join('|'),
    rot: s.players.map(p => p.rot ?? 0),
    debt: s.players.map(p => p.debt ?? 0),
    life: s.players.map(p => p.life),
    hand: s.players.map(p => p.hand.length),
    bin: s.players.map(p => p.bin.length),
    cache: s.players.map(p => (p.cache ?? []).length),
    entities: new Set(Object.keys(s.entities)),
    counters: JSON.stringify(Object.values(s.entities).map(x => [x.card, x.counters, x.damage])),
    stack: s.stack.length,
  };
}

/**
 * What the CARD did, with what PLAYING it necessarily does taken out.
 *
 * A spell leaves your hand and lands in your bin whatever its text says, so
 * counting those two as "something happened" would make every card in the
 * pool look alive — which is how Collect Remains and Tilling the Graves first
 * read as inert here: their real effect (a card moving bin→hand) was exactly
 * cancelled by the spell's own migration hand→bin.
 */
function diff(a: ReturnType<typeof snapshot>, b: ReturnType<typeof snapshot>, card?: string, s?: GameState): string[] {
  const out: string[] = [];
  const self = card ? 1 : 0;
  for (const k of ['life', 'hand', 'bin', 'cache', 'rot', 'debt'] as const) {
    const av = a[k].slice(), bv = b[k].slice();
    if (k === 'hand' && card) av[0] = (av[0] ?? 0) - self;      // the card left hand
    if (k === 'bin' && card && s && s.players[0]!.bin.includes(card)) av[0] = (av[0] ?? 0) + self;
    if (JSON.stringify(av) !== JSON.stringify(bv)) out.push(`${k}: ${JSON.stringify(av)}→${JSON.stringify(bv)}`);
  }
  if (a.entities.size !== b.entities.size) out.push(`entities: ${a.entities.size}→${b.entities.size}`);
  if (a.counters !== b.counters) out.push('unit counters/damage changed');
  if (a.stats !== b.stats) out.push('unit stats/attributes changed');
  if (a.control !== b.control) out.push('unit control/region changed');
  return out;
}

/**
 * `diff`, with the ARRIVAL OF AN ENTITY taken out of the two readings that a
 * printed promise can be evidenced by.
 *
 * ⚠ This is the difference between a measurement and a rubber stamp, and it
 * was found by running the coarse version: attaching ANY mod makes the host
 * {Unstable} (so `stats` — which carries attributes — always moves) and adds a
 * row to the counters array (so `counters` always moves). Scored coarsely,
 * every one of the 117 cards with an `[Augment]` promise "delivered" its pump
 * and its counter the instant it was applied, whether its box said so or not.
 *
 * So both readings are recomputed here over the entities present in BOTH
 * snapshots, on the NUMBERS only: effective power/defense for a pump, counters
 * and damage for a counter. `diff` itself is left coarse on purpose — for the
 * post-play window a new token really is something the card did.
 */
function modestDiff(a: ReturnType<typeof snapshot>, b: ReturnType<typeof snapshot>): string[] {
  const out = diff(a, b).filter(x => x !== 'unit stats/attributes changed'
    && x !== 'unit counters/damage changed' && x !== 'unit control/region changed');
  let nums = false, ctr = false, own = false;
  for (const [id, before] of a.byId) {
    const after = b.byId.get(id);
    if (!after) continue;
    if (after.nums !== before.nums) nums = true;
    if (after.ctr !== before.ctr) ctr = true;
    if (after.own !== before.own) own = true;
  }
  if (nums) out.push('unit stats/attributes changed');
  if (ctr) out.push('unit counters/damage changed');
  if (own) out.push('unit control/region changed');
  return out;
}

/**
 * DOES THIS AUGMENT'S CONTINUOUS TEXT ACTUALLY BITE?
 *
 * A `[Augment]` static ("I gain +2/+2", "Enemies gain +2/+2", "Your other
 * units gain +0/+2") emits NO EVENT EVER — it is a layer, not an action — so
 * the only thing that can evidence it is a stat reading. A before/after delta
 * is the wrong instrument for two reasons at once: the layer's effect lands at
 * the instant of the attach, so a board the clause is ABOUT (an enemy standing
 * in this region) that arrives one beat later is invisible; and any delta wide
 * enough to catch that is wide enough to catch the counters fixture too.
 *
 * So this asks the question directly: take the mod out of the game, read every
 * unit's effective power and defence, put it back, read them again. If they
 * differ, this augment is changing somebody's stats right now. Nothing else on
 * the board can make that true, so it cannot be evidence for anything else.
 *
 * ⚠ NUMBERS ONLY, NEVER ATTRIBUTES. Every augment makes its host {Unstable}
 * (R79), so an attribute-aware comparison is true for all 117 cards whatever
 * their box says — the exact blindness `modestDiff` exists to avoid.
 */
function staticBite(s: GameState, modId: EntityId | undefined): boolean {
  if (modId === undefined) return false;
  const mod = s.entities[modId];
  if (!mod) return false;
  // ⚠ PER-ENTITY, AND NEVER THE MOD ITSELF. The first cut of this joined every
  // entity's reading into one string and compared the strings — which differ
  // for a trivial reason the moment the mod is removed, because the mod IS an
  // entity and its own row disappears with it. Every augment in the pool
  // "changed somebody's stats", triggered ones included. Comparing only the
  // ids present in both readings is what makes the answer mean anything.
  const read = (): Map<EntityId, string> => {
    const e = new E(s);
    const m = new Map<EntityId, string>();
    for (const u of Object.values(s.entities)) {
      if (u.id === modId) continue;
      try { m.set(u.id, e.effStats(u).join('/')); } catch { m.set(u.id, '?'); }
    }
    return m;
  };
  const withMod = read();
  delete s.entities[modId];
  const without = read();
  s.entities[modId] = mod;
  for (const [id, v] of withMod) {
    const w = without.get(id);
    if (w !== undefined && w !== v) return true;
  }
  return false;
}

/**
 * A board that gives a targeted card something to point at.
 *
 * Almost every "never legal" result in the first run of this drill was a
 * spell that is correctly uncastable with nothing on the table — `castable()`
 * refuses a cast with no legal target, which is the engine being right. So the
 * drill seeds a real, ordinary mid-game position instead of an empty one:
 * bodies for both seats, cards in both bins, cards in both caches. Vanilla
 * units are used on purpose (Tidal Menace, The Foretold — no text, no attrs,
 * no triggers), so nothing the drill observes can be the SEEDING acting rather
 * than the card under test.
 */
export function seedBoard(s: GameState, seat: Seat): void {
  const e = new E(s);
  const foe = (1 - seat) as Seat;
  for (const who of [seat, foe] as Seat[]) {
    // Bubb is here for its 6 defense ("target unit with 4 or more defense" —
    // Throw off a Cliff had no legal target without it) and Curio Drifter for
    // its type-line [Augment] (Reconfigure needs an augmentABLE target).
    for (const body of ['Tidal Menace', 'The Foretold', 'Unit Token', 'Bubb', 'Curio Drifter']) {
      try { e.spawnUnit(who, body, e.homeRegion(who), body === 'Unit Token' ? { token: true } : {}); } catch { /* not registered */ }
    }
    // a stocked bin (exhume / "target card in a bin" / trash costs) and a
    // stocked cache (R41 targets) — real cards, so the zones are well-formed
    const p = s.players[who]!;
    // a cheap unit (Resurrect: "cost 2 or less") and a real SPELL (Delver of
    // Mysteries: "target spell in your bin") — a bin of only expensive units
    // is not a bin those cards can see
    p.bin.push('Tidal Menace', 'The Foretold', 'Curio Drifter', 'Immolate');
    p.hand.push('Tidal Menace');
    (p.cache ??= []).push({ uid: 9000 + who, card: 'The Foretold' } as never);
  }
  try { e.settle(); } catch { /* a spawn trigger may suspend; the board is still seeded */ }
}

for (const f of FIXTURES) if (!f.phase) SOFT_BY_NAME[f.name] = f;

/**
 * Which fixture may fire at this quiescent window.
 *
 * Soft beats first, and only in the phase they name; the destructive pair only
 * once every soft beat has had its turn — which, because the `@battle` repeats
 * can only fire during a battle, is also "only after the card has been through
 * a battle".
 *
 * The escape hatch exists for a card whose remaining beat needs a phase this
 * game will not reach — but it is gated on TWO BATTLES HAVING HAPPENED and not
 * on idle windows alone. Idle windows alone was measured and it is a trap: a
 * deployment phase offers dozens of quiescent windows in a row, so a plain
 * patience counter ran out long before the first battle and let `die` through
 * early. Trigger promises observed: 82 with the battle gate, 48 without it.
 */
function nextBeat(pending: Fixture[], phase: string, stalled: number,
  battles: number, inBattle: boolean, battleOn: boolean): Fixture | undefined {
  const here = (x: Fixture): boolean => x.phase === 'inBattle' ? inBattle
    : x.phase === 'battleJoined' ? battleOn
      : x.phase === undefined || x.phase === phase;
  const soft = pending.filter(x => !x.last);
  const pick = soft.find(here);
  if (pick) return pick;
  // ⚠ TWO COMPLETED BATTLES, not merely "the soft beats are done". The
  // `@battle` repeats all fire in the first quiescent window OF a battle,
  // which is before attacks are even declared — so "every soft beat has had
  // its turn" was true while the card had still never attacked, and `die`
  // took Megadeath off the table two events before it would have swung.
  // `battlesSeen` counts `afterCombat`, which is a battle that FINISHED.
  if (battles < 2) return undefined;
  // ⚠ AN `inBattle` BEAT MUST NOT HOLD THE DESTRUCTIVE ONES HOSTAGE. Every
  // other soft beat is reachable for every card — the game always gets to a
  // deployment window and always gets to a battle phase — so "some soft beat is
  // still pending" is a fair reason to keep waiting. An `inBattle` beat is not
  // like that: a SPELL has no body to stand anywhere, and a unit that is killed
  // before it ever swings never gets back into a battle, so those beats can be
  // permanently pending through no fault of the scheduler. Counting them here
  // would make every such card sit out 60 idle windows before `die` and
  // `despawn` became eligible, on top of a `press` run that is already the most
  // expensive thing in this suite — and `die` alone is worth more trigger
  // promises than this whole family.
  const blocking = soft.filter(x => x.phase !== 'inBattle');
  if (blocking.length && stalled < 60) return undefined;
  return pending.find(x => x.last && here(x));
}

/**
 * Drive the game until `card` is playable by `seat`, play it, and resolve.
 *
 * `mode` picks which play mode we are drilling — the ordinary cast, the
 * [Ambush] alternative, or the "Discard me" line — because those are three
 * different pieces of card text and a card can be alive in one and dead in
 * another.
 */
export function drillCard(
  card: string,
  seed = 900_000,
  opts: {
    mode?: 'ambush' | 'discardMe';
    maxSteps?: number;
    setup?: (s: GameState, seat: Seat) => void;
    /** put an OPPONENT-controlled effect on the stack before drilling.
     *  Eleven cards in the pool ("Negate target effect", "Change the targets
     *  of target effect", "Recall target spell effect") are uncastable with an
     *  empty stack, and correctly so — without bait they all report
     *  "never legal" and look broken when they are not. */
    bait?: boolean;
    /** CARD-TODO #49 stage 2: after the card is in play, PAY FOR AND ACTIVATE
     *  every activated ability it has, then keep going.
     *
     *  35 of the 439 printed promises sit behind an activated ability's colon
     *  or a bracketed cost. Nothing new is needed to reach them: `legalActions`
     *  already offers `activateAbility`, so the drill can simply take it — the
     *  engine's own legality decides when, exactly as it does for `playCard`.
     *  Without this the drill stops the instant the play resolves, so an
     *  ability could be entirely unimplemented and the card would still look
     *  alive on the strength of its body. */
    activate?: boolean;
    /** CARD-TODO #49 stage 4: do not CAST the card — apply it to a host as an
     *  `[Augment]` mod, which is the only state in which its `[Augment]` text
     *  box is live at all. 152 of the 439 printed promises (48% of everything
     *  gated) live in that box, and none of them is owed when the body is
     *  cast, so before this they were unreachable by construction. */
    augment?: boolean;
    /** CARD-TODO #49 stage 3: after the card is in play (cast or attached),
     *  keep the game running and fire the FIXTURE LIBRARY at it, one fixture
     *  per quiescent window, so the events its "When …" clauses listen for
     *  actually happen. */
    press?: boolean;
    /** R211 / CARD-TODO #87 POSITIVE CONTROL ONLY. Reinstates the pre-R211
     *  unbounded "ran out of steps" tail, which credited every event from an
     *  unresolved activation to the end of the run as this card's evidence.
     *  It exists so `181-inconclusive-activation-window.test.ts` can drive one
     *  run BOTH ways and show, verbatim, that the fix refuses an event the old
     *  code credited — per docs/13-assessment.md §7.4, an observation channel
     *  with no control proving it can see is worth nothing. Nothing else in
     *  the repository may pass this, and `181` asserts that. */
    unboundedActTailForControl?: boolean;
    /** CT-92 POSITIVE CONTROL ONLY. Suppresses the closure of the pending
     *  activation window, so a run that activates twice reaches the refusal
     *  branch and `actRefusedSecond` increments. Without this there is no way
     *  to demonstrate the counter can fire: the defect it counts is measured at
     *  ZERO across the whole pool, and a counter that has only ever printed 0
     *  is indistinguishable from a counter that is blind — docs/13 §7.4. Like
     *  its sibling above, nothing else in the repository may pass this, and
     *  `181` asserts that by counting FILES. */
    neverCloseActWindowForControl?: boolean;
  } = {},
): DrillResult {
  // press mode has to outlast two whole battles before its destructive beats
  // are even eligible, and a card played in the planning phase starts a long
  // way from the first one. 600 steps was measured cutting the run short on
  // cards whose "when I die" clause never got its fixture at all.
  const maxSteps = opts.maxSteps ?? (opts.press ? 1500 : 600);
  const res: DrillResult = {
    card, played: false, resolved: false, events: [], types: [],
    outcome: 'never-legal', windows: [], newEntities: [], changed: [],
    effectEvents: [], effectTypes: [], guarded: false,
    activated: [], activateTypes: [], activateChanged: [],
    attached: false, attachChanged: [], ownTypes: [], ownChanged: [], fired: [],
    staticBit: false, inBattleBeats: [],
    actInconclusive: false, actInconclusiveTail: [], actInconclusiveTailChanged: [],
    actInconclusiveTailEvents: [], actRefusedSecond: 0,
  };
  let { state } = createGame(seed);
  const seat: Seat = 0;
  (opts.setup ?? seedBoard)(state, seat);
  // R51's bin- and cache-anchored listeners ("If I am in your bin, after
  // combat …" — Lurking Dread, Inexorable Miasma, Cinder Scuttler) are not
  // entities at all, just names in a zone, so `fireZoneTriggers` can only find
  // them if the name is THERE. press mode puts it there.
  if (opts.press) state.players[seat]!.bin.push(card);

  let before = snapshot(state, seat);
  let playedAt = -1;
  const BAIT = 'Protective Adaptations';   // b1, one plain unit target
  let baited = false;

  // ── activate mode bookkeeping ───────────────────────────────────────────
  /** entity ids that existed before the play — anything not in here and
   *  carrying the card's own name is the body the play just produced */
  let preIds = new Set<string>();
  /** `${entityId}#${abilityIndex}#${via}` for every activation already taken,
   *  so one ability is not re-activated in a loop */
  const usedAbilities = new Set<string>();
  /** the state and event position at the activation currently on the stack.
   *  The window CLOSES when that activation has resolved, and that matters:
   *  the first cut of this ran the window to game over, so every ability's
   *  evidence included the next three turns of combat damage, draws and
   *  spawns, and any claim of any kind read as delivered. */
  let pendingAct: {
    snap: ReturnType<typeof snapshot>;
    marker: number;
    /** R211: the same cut into `res.events`. `types` and `events` are NOT
     *  parallel — a typed event with no `msg` pushes only the type — so the
     *  message span has to be marked separately. */
    evMarker: number;
  } | null = null;
  /** windows spent since the play with nothing left to activate — the stop
   *  condition for activate mode, so a card with no ability does not walk the
   *  whole 600 steps */
  let idleWindows = 0;

  // ── augment (stage 4) and press (stage 3) bookkeeping ──────────────────
  /** the mod entity this card became when it was applied to a host */
  let modId: EntityId | undefined;
  /** the host entity id, so the fixtures aim at the thing the [Augment] text
   *  is ABOUT — "when I die" in an augment box means the host dying */
  let hostId: EntityId | undefined;
  /** the attach's own evidence window, closed at the first quiescence after
   *  it. It cannot be closed in the same step: a Virus augment applied during
   *  BATTLE goes on the STACK first (R79) and only becomes a mod when it
   *  resolves, so reading the delta at the action would see the card leave the
   *  hand and nothing else — which is exactly what it did, on every static
   *  augment in the pool, until this was split out. */
  let pendingAttach: ReturnType<typeof snapshot> | null = null;
  /** the fixtures already fired, by name */
  const firedFixtures = new Set<string>();
  /** completed battles since the play — the gate on the destructive fixtures */
  let battlesSeen = 0;
  /** the augment's continuous text has been seen biting at least once */
  let biting = false;
  /** quiescent windows spent after the last fixture — press mode's stop
   *  condition, so a card whose text nothing can provoke does not walk the
   *  whole 600 steps for nothing */
  let pressIdle = 0;
  /** ordinary cards press mode plays alongside the card under test, so the
   *  "when you play a …" families have something to hear. `spellPlayed` and
   *  `cardPlayed` are different events (R129) and "whenever you play a UNIT"
   *  (Bloomcaster) hears neither of them from a spell, so both a spell and a
   *  unit are played, through `legalActions` like any other play. */
  const pressPlays = ['Protective Adaptations', 'Tidal Menace'];
  /** a rolling snapshot, kept only in the modes that need per-step deltas */
  const tracking = !!(opts.press || opts.augment);
  let prevSnap = tracking ? snapshot(state, seat) : null;

  /** true while the events arriving belong to a resolution headed by THIS
   *  card's name. It persists across `apply` calls on purpose: a resolution
   *  that suspends for a decision finishes in a LATER apply, and its payload
   *  arrives there. Quiescence (empty stack, no decision) closes it. */
  let inOwn = false;

  /**
   * Fold one batch of engine events into the result, and say whether any of
   * them belonged to a resolution of this card's own — which is what tells the
   * caller to measure a state delta for `ownChanged`.
   */
  const ingest = (evs: readonly { type: string; msg?: string }[], count: boolean): boolean => {
    let sawOwn = false;
    // ⚠ A STATE DELTA IS ONLY READABLE OUT OF A QUIET BATCH. The event stream
    // can be attributed exactly (a resolution is bounded by its own label);
    // a state delta cannot, because the smallest thing that can be measured is
    // one `apply`, and one `apply` can carry a whole combat damage step. So a
    // batch that also moved the board on its own is refused as evidence for
    // the four claim kinds whose only evidence IS a delta (pump, counters,
    // recall, control) — combat damage alone would otherwise have evidenced
    // every counters claim in the pool.
    let noisy = false;
    for (const ev of evs) {
      if (ev.type === 'combatDamage' || ev.type === 'phase' || ev.type === 'turn') noisy = true;
      if (ev.type === 'afterCombat') battlesSeen++;
    }
    for (const ev of evs) {
      if (count) {
        if (ev.msg) res.events.push(ev.msg);
        res.types.push(ev.type);
        if (ev.msg && /nothing happens|no legal|nothing to/i.test(ev.msg)) res.guarded = true;
      }
      // a `resolved` event OPENS or CLOSES the window: it heads the item that
      // is about to run, so it is this card's window iff the label is this
      // card's, and somebody else's item closes ours.
      if (ev.type === 'resolved') inOwn = ownResolution(ev.msg ?? '', card);
      else if (inOwn && WINDOW_CLOSERS.has(ev.type)) inOwn = false;
      if (inOwn) { res.ownTypes.push(ev.type); sawOwn = true; }
    }
    return sawOwn && !noisy;
  };

  /** the entity this card's own text is ABOUT: its body when it was cast, the
   *  HOST when it is riding as an augment. */
  const subject = (): Entity | undefined => {
    if (hostId !== undefined) return state.entities[hostId];
    for (const [id, u] of Object.entries(state.entities)) {
      if (u.kind === 'unit' && u.card === card && !preIds.has(id)) return u;
    }
    return undefined;
  };

  /**
   * R199: IS THE CARD ACTUALLY IN THE BATTLE?
   *
   * Not "is it the battle phase" — that was already true while the card stood
   * at home in the declare step, and it is why the whole REGION family read as
   * unreachable. The engine's own answer to "am I in this battle" is the one
   * six cards' `when` clauses write out by hand
   * (`g.s.battle?.region === self.region`), so it is the one asked here.
   *
   * ⚠ It deliberately does NOT consult `battle.columns`. A unit that was sent
   * out at block time, or one spawned into the battle region by another card's
   * text, is standing in the battle just as much as a declared attacker is —
   * and every clause in the family is written against the REGION, not against
   * membership of a column.
   */
  const standingInBattle = (): boolean => {
    if (state.phase !== 'battle' || !state.battle) return false;
    const s = subject();
    return s !== undefined && s.region === state.battle.region;
  };

  /** R211 / CT-87: WHICH exit the loop took, so an unclosed activation window
   *  can say why it could not be closed. Defaults to `maxSteps` because that
   *  is the exit taken by falling out of the `for`, and the two `break`s below
   *  overwrite it. */
  let loopExit: 'maxSteps' | 'gameover' | 'quiescent' = 'maxSteps';
  for (let step = 0; step < maxSteps; step++) {
    if (state.phase === 'gameover') { loopExit = 'gameover'; break; }
    // ⚠ THE EVIDENCE WINDOW NEVER SPANS TWO WINDOWS OF THE GAME. It survives
    // an action boundary only while a resolution is genuinely SUSPENDED
    // waiting for an answer. Without this line the fixture beats — which
    // `continue` past the post-apply reset — left `inOwn` true from one beat
    // to the next, and Spirit of Vengeance's "when I die, deal 1 damage"
    // collected the draw, the trash, the targeting and the mod application of
    // every beat that followed it.
    if (!state.decision) inOwn = false;
    try { checkInvariants(state); } catch (err) {
      res.outcome = 'crash'; res.error = `invariant: ${(err as Error).message}`; return res;
    }

    // KEEP THE GAME ALIVE in the modes that have to outlast a battle. The
    // seeded board is lethal — five bodies a side, blocks declined, ~19 face
    // damage a turn — so a 30-life game is over in turn three, and every
    // fixture after `trash` fired into a `gameover` that had already broken
    // the loop. Topping up is board-keeping of exactly the kind `fundSeat`
    // already is; it is deliberately a top-up to an ODD total, because
    // "if your life total is odd" is a printed condition (Ploosh, Insatiable
    // Want) and pinning it even would decide those clauses for them.
    //
    // ⚠ R199 RAISED IT FROM `< 12 → 25`. The top-up runs once per window, but a
    // whole combat damage step happens inside ONE `apply`, so a seat sitting on
    // 25 can be taken to zero between two top-ups — and the old numbers had
    // only just enough margin for the old board. Adding the `inBattle` beats
    // spent that margin: traced on Ghord, `gameover` arrived at step 55 with
    // `battlesSeen=1`, one short of the gate `nextBeat` puts in front of `die`
    // and `despawn`, so those two beats never became eligible and only 29 of
    // the 31 fixtures fired. Measured over the pool at that intermediate point:
    // 227/316, against the 264 the round started from — A Pile of Rubbish,
    // Spirit of Vengeance, Ghord, Blightmound and their whole "when I die"
    // family, a far bigger loss than the R12 family this round set out to win.
    // The numbers stay ODD for the reason above; only the headroom changed.
    if (tracking) for (const p of state.players) if (p.life < 40) p.life = 61;

    // keep the card in hand and the seat solvent at every window: a previous
    // window may have shuffled the hand, and resources expend as they are used
    if (!res.played) {
      const hand = state.players[seat]!.hand;
      if (!hand.includes(card)) hand.push(card);
      fundSeat(state, seat);
    }

    // ── the opponent's bait effect, so a counterspell has something to hit ─
    let chosen: Action | null = null;
    let isBait = false;
    if (opts.bait && !baited && !res.played && state.phase === 'battle' && !state.decision) {
      const foe = (1 - seat) as Seat;
      const fh = state.players[foe]!.hand;
      if (!fh.includes(BAIT)) fh.push(BAIT);
      fundSeat(state, foe);
      const bi = fh.indexOf(BAIT);
      const bp = safeLegal(state, foe).find(a => a.type === 'playCard' && a.handIndex === bi && !a.mode);
      if (bp) { chosen = bp; baited = true; isBait = true; }
    }

    // ── stage 4: APPLY the card to a host instead of casting it ──────────
    // `legalActions` already offers the `augment` action out of hand (R41's
    // pushMods), so this needs no new machinery either — the engine's own
    // legality decides when a mod may be applied, exactly as for playCard.
    // ⚠ DEPLOYMENT, not battle. A card that is also a Virus is offered in
    // BATTLE too (R79), and that route puts the augment on the STACK — so the
    // window from the action to the next quiescence swallows the whole combat
    // damage step, and Ploosh and Skybreaker both read as granting stats their
    // boxes never mention. The deployment attach resolves in the action.
    if (!chosen && opts.augment && !res.attached && !state.decision
      && (state.phase === 'deploy' || step > 150)) {
      const idx = state.players[seat]!.hand.indexOf(card);
      const cands = safeLegal(state, seat).filter(a =>
        a.type === 'augment' && a.from === 'hand' && a.index === idx && a.hostId !== undefined);
      const pick = cands.find(a => a.type === 'augment'
        && INERT_HOSTS.has(state.entities[a.hostId!]?.card ?? '')) ?? cands[0];
      if (pick && pick.type === 'augment') {
        res.windows.push(`${state.phase}/augment`);
        before = snapshot(state, seat);
        prevSnap = before;
        preIds = new Set(Object.keys(state.entities));
        hostId = pick.hostId!;
        res.host = state.entities[hostId]?.card;
        chosen = pick;
      }
    }

    if (!chosen && !res.played && !opts.augment) {
      const idx = state.players[seat]!.hand.indexOf(card);
      const legal = safeLegal(state, seat);
      const play = legal.find(a =>
        a.type === 'playCard' && a.handIndex === idx && (a.mode ?? undefined) === opts.mode);
      if (play) {
        res.windows.push(`${state.phase}${state.battle ? `/${state.battle.step}` : ''}`);
        // snapshot AT the play, so the delta is the card's doing and not the
        // drill's board-keeping
        before = snapshot(state, seat);
        preIds = new Set(Object.keys(state.entities));
        chosen = play;
      }
    }

    // ── the card's OWN activated abilities, once its body is on the table ─
    // Only abilities on an entity THIS play produced: seedBoard puts five
    // vanilla bodies on each side and a donated mod can move an ability
    // around, and scoring somebody else's activation as this card's would be
    // the bait bug all over again.
    if (!chosen && (opts.activate || opts.augment) && res.played && !state.decision) {
      const act = safeLegal(state, seat).find(a => {
        if (a.type !== 'activateAbility') return false;
        // stage 4: an `[Augment]`-box activated ability is offered on the
        // HOST, `via: { mod }` naming the mod this card became. 23 of the 117
        // cards with an augment-gated promise carry one, and every one of them
        // is unreachable through the `u.card === card` test below — the host
        // is a Tidal Menace.
        const viaMod = (a.via as { mod?: EntityId } | undefined)?.mod;
        const mine = modId !== undefined && viaMod === modId;
        if (!mine) {
          const u = state.entities[a.entityId];
          if (!u || u.card !== card || preIds.has(String(a.entityId))) return false;
        }
        return !usedAbilities.has(`${a.entityId}#${a.abilityIndex}#${JSON.stringify(a.via ?? null)}`);
      });
      if (act && act.type === 'activateAbility' && pendingAct) {
        // CT-92: a window is already open and taking this one would OVERWRITE
        // it, silently dropping everything the first activation delivered.
        // Refuse and RECORD, the way CT-87 records the other half of this
        // problem — an honest "we did not take it" is worth more than evidence
        // credited to the wrong activation, or evidence dropped with no trace.
        // `act` is deliberately NOT added to usedAbilities: it was never taken,
        // so a later window is still entitled to offer it.
        res.actRefusedSecond++;
        if (res.played) idleWindows++;
      } else if (act && act.type === 'activateAbility') {
        usedAbilities.add(`${act.entityId}#${act.abilityIndex}#${JSON.stringify(act.via ?? null)}`);
        res.activated.push(`${act.abilityIndex}${act.via ? `/${JSON.stringify(act.via)}` : ''}`);
        pendingAct = {
          snap: snapshot(state, seat), marker: res.types.length, evMarker: res.events.length,
        };
        chosen = act;
        idleWindows = 0;
      } else if (res.played) {
        idleWindows++;
      }
    }

    // ⚠ KEEP THE CARD ON THE TABLE. press mode blocks as hard as it can (so
    // "when I block" happens at all) and its own `counters` and `damage` beats
    // land on the subject, so a small body is routinely dead before it ever
    // swings — and every beat and every battle after that fires at an empty
    // board. Putting it back is board-keeping of the same kind as `fundSeat`:
    // it makes the card do nothing, it only stops the drill from measuring its
    // own lethality. Checked at EVERY quiescent window rather than only at a
    // beat, because the beats run out long before the battles do. Never after
    // the `die` beat, which is the one place the death IS the fixture.
    if (opts.press && !opts.augment && res.played && !state.decision && state.stack.length === 0
      && step > playedAt && !firedFixtures.has('die') && getCard(card).kind === 'unit'
      && !Object.values(state.entities).some(u => u.kind === 'unit' && u.card === card)) {
      const e0 = new E(state);
      try { e0.spawnUnit(seat, card, e0.homeRegion(seat), {}); e0.settle(); } catch { /* not spawnable */ }
      ingest(e0.events, true);
    }

    // ── stage 3: fire the next FIXTURE, one per quiescent window ─────────
    // Not an Action: the fixture is the WORLD acting, so it is an engine-level
    // poke exactly as `seedBoard` is. What is NOT faked is anything about the
    // card — it still has to hear the event through `E.fireEvent`, queue its
    // own trigger, reach the stack and resolve, and only that resolution is
    // read as evidence (see `ownResolution`).
    const dueFixture = opts.press && res.played && !state.decision && state.stack.length === 0
      && step > playedAt
      ? nextBeat(FIXTURES.filter(x => !firedFixtures.has(x.name)), state.phase, pressIdle,
        battlesSeen, standingInBattle(),
        state.phase === 'battle' && !!state.battle?.happened)
      : undefined;
    if (!chosen && dueFixture) {
      const f = dueFixture;
      firedFixtures.add(f.name);
      const e = new E(state);
      const snapBefore = prevSnap ?? snapshot(state, seat);
      /** the board AFTER the fixture's own poke and BEFORE anything the card
       *  does about it. ⚠ This is the base the delta is measured from, and the
       *  split matters: the `damage` fixture marks damage on the subject, so a
       *  delta taken from before the poke reads "counters/damage changed" and
       *  would evidence a `counters` promise the card never kept. */
      let mid: ReturnType<typeof snapshot> | null = null;
      // R199: the subject and the battle AS THEY STAND when the beat becomes
      // eligible, read before the beat's own poke can move either.
      const sBefore = subject();
      const bRegBefore = state.battle?.region;
      const homeBefore = e.homeRegion(seat);
      try {
        f.run(e, seat, sBefore, card);
        // ⚠ RE-ATTACH. `despawn` recalls the host, which sends every mod on it
        // to the bin, so by the time `die` fired the augment was not there any
        // more and its "[Augment] When I die, draw a card" could not fire —
        // A Pile of Rubbish, Spirit of Vengeance and sixteen more read as dead
        // for that reason alone and not one of them was broken.
        if (opts.augment && res.attached && (modId === undefined || !state.entities[modId])) {
          // ⚠ EVERY REGION, not just home. The recall that costs the mod its
          // host happens mid-battle, and mid-battle our units are standing in
          // the DEFENDER's region — so a home-only search found nobody, the
          // mod never went back on, and the `die` beat that follows killed a
          // host that was not wearing it.
          const mine = e.unitsOf(seat);
          const host = mine.find(u => INERT_HOSTS.has(u.card)) ?? mine[0];
          if (host) { hostId = host.id; modId = e.attachMod(host, card, seat, 'augment').id; }
        }
        mid = snapshot(state, seat);
        e.settle();
      } catch { /* a trigger may suspend for a decision */ }
      res.fired.push(f.name);
      if (f.phase === 'inBattle') {
        res.inBattleBeats.push(
          `${f.name}:home=${homeBefore}:at=${sBefore?.region}:battle=${bRegBefore}`);
      }
      // asked again after every beat, because a static's SUBJECT can arrive
      // later than the augment does: Towering Colossus's "Enemies gain +2/+2"
      // is region-scoped (R12) and there is no enemy in this region until the
      // `enemyHere` fixture puts one there.
      if (!biting && staticBite(state, modId)) {
        biting = true;
        res.staticBit = true;
        res.attachChanged.push('unit stats/attributes changed');
      }
      if (ingest(e.events, true)) {
        const now = snapshot(state, seat);
        for (const c of modestDiff(mid ?? snapBefore, now)) res.ownChanged.push(c);
        prevSnap = now;
      } else if (tracking) {
        prevSnap = snapshot(state, seat);
      }
      idleWindows = 0;
      pressIdle = 0;
      continue;
    }

    // ── stage 3: a second, ORDINARY spell, so "when you play a spell" fires ─
    // The BAIT is one plain targeted pump; casting it through `legalActions`
    // is what makes `spellPlayed` / `cardPlayed` real rather than synthesised.
    if (!chosen && opts.press && res.played && pressPlays.length && !state.decision) {
      const h = state.players[seat]!.hand;
      const want = pressPlays[0]!;
      if (!h.includes(want)) h.push(want);
      fundSeat(state, seat);
      const bp = safeLegal(state, seat).find(a =>
        a.type === 'playCard' && a.handIndex === h.indexOf(want) && !a.mode);
      if (bp) { chosen = bp; pressPlays.shift(); isBait = true; }
    }

    // ── otherwise take the action that moves the game along ────────────
    if (!chosen) chosen = progressAction(state, res.played ? seat : undefined, !!opts.press);
    if (!chosen) { res.outcome = res.played ? 'resolved' : 'stuck'; break; }

    // the BAIT is a playCard too — counting it as "the card was played" is
    // what made all fifteen bait-drilled cards report a resolution they never
    // had, with the bait's own delta attributed to them
    const wasAttach = chosen.type === 'augment';
    const wasPlay = (chosen.type === 'playCard' && !isBait) || wasAttach;
    const snapBefore = tracking ? (prevSnap ?? snapshot(state, seat)) : null;
    try {
      const r = apply(state, chosen);
      state = r.state;
      const sawOwn = ingest(r.events, res.played || wasPlay);
      if (tracking) {
        const now = snapshot(state, seat);
        if (sawOwn) for (const c of modestDiff(snapBefore!, now)) res.ownChanged.push(c);
        prevSnap = now;
      }
    } catch (err) {
      if (err instanceof IllegalAction) {
        // legalActions offered it and apply refused: that is a real defect
        res.outcome = 'illegal'; res.error = (err as Error).message; res.badAction = chosen; return res;
      }
      res.outcome = 'crash'; res.error = (err as Error).stack ?? String(err); res.badAction = chosen; return res;
    }

    if (wasAttach) { res.attached = true; pendingAttach = before; }
    if (wasPlay) { res.played = true; playedAt = step; }

    // THE ATTACH WINDOW, closed the moment the attach has resolved. A
    // continuous `[Augment]` ("I gain +2/+2", "Enemies gain +2/+2") emits no
    // event ever — it is a layer, not an action — so the effStats delta across
    // the attach is the only evidence such a clause can ever have, and it has
    // to be read before a fixture moves a stat.
    if (pendingAttach && !state.decision && state.stack.length === 0) {
      for (const c of modestDiff(pendingAttach, snapshot(state, seat))) res.attachChanged.push(c);
      // ⚠ AND THE HOST DYING OF IT IS A STAT CHANGE TOO. `modestDiff` can only
      // compare entities present in BOTH snapshots, which is what keeps the
      // arriving mod from evidencing everything — but it also means a static
      // that kills its own host reads as doing nothing at all. Malformed
      // Monstrosity ("[Augment] I gain -7/-7") and Dreadspawn Horror ("I gain
      // -1/-1 for each card in your hand") both work perfectly and both read
      // as dead here, because no host in the pool survives them.
      if (hostId !== undefined && !state.entities[hostId]) {
        res.attachChanged.push('unit stats/attributes changed');
      }
      if (staticBite(state, modId)) {
        res.staticBit = true;
        res.attachChanged.push('unit stats/attributes changed');
      }
      // the mod this card became, so its donated activated abilities can be
      // told apart from the host's own
      for (const [id, u] of Object.entries(state.entities)) {
        if (u.kind === 'mod' && u.card === card && u.modOf === hostId) modId = Number(id);
      }
      pendingAttach = null;
    }

    // an activation has resolved: close its evidence window
    if (pendingAct && !state.decision && state.stack.length === 0
        && !opts.neverCloseActWindowForControl) {
      for (const t of res.types.slice(pendingAct.marker)) res.activateTypes.push(t);
      // no `card` argument: the hand→bin correction is for a SPELL's own
      // migration at the moment it is cast, and this window opens long after
      // that. Passing it would subtract a card that never moved.
      for (const c of diff(pendingAct.snap, snapshot(state, seat))) res.activateChanged.push(c);
      pendingAct = null;
    }

    // …and the window never survives an action boundary unless the resolution
    // is genuinely SUSPENDED mid-way waiting for an answer. That is the only
    // reason a resolution's payload legitimately arrives in a later `apply`.
    if (!state.decision) inOwn = false;

    // once played, stop as soon as the stack is empty and nothing is pending
    if (res.played && !state.decision && state.stack.length === 0 && step > playedAt) {
      // a quiescent window that fired no fixture. `nextBeat` reads this as
      // "stalled" — the escape hatch for a card whose remaining beat needs a
      // phase this game is never going to reach.
      if (opts.press) pressIdle++;
      // …EXCEPT in activate mode, where stopping here is exactly the bug: an
      // activated ability is legal at a LATER window than the one the play
      // resolved in (`timing: 'battle'`, or deployment after the battle that
      // was already in progress), so quitting at stack-empty means most
      // abilities are never offered at all. Keep walking phases until a run of
      // windows has gone by with nothing of this card's left to activate.
      //
      // press/augment mode keeps walking for the same reason one layer out:
      // the fixture library has not finished firing, and the combat-shaped
      // events (attacked, blocked, afterCombat) are a whole battle away from
      // the deployment window most cards are played in.
      const busy = (opts.activate || opts.augment) && idleWindows < ACTIVATE_PATIENCE;
      const stillPending = (f: (x: Fixture) => boolean): boolean =>
        FIXTURES.some(x => !firedFixtures.has(x.name) && f(x));
      const pressing = opts.press && pressIdle < (
        stillPending(x => x.phase !== 'inBattle') ? FIXTURE_PATIENCE
          : stillPending(x => x.phase === 'inBattle') ? BATTLE_PATIENCE : SETTLE_PATIENCE);
      if (!busy && !pressing) {
        res.resolved = true; res.outcome = 'resolved'; loopExit = 'quiescent'; break;
      }
    }
  }

  if (res.played && res.outcome === 'never-legal') res.outcome = 'resolved';
  const marker = res.events.findIndex(m => m.startsWith(`Resolving ${card}`));
  res.effectEvents = marker >= 0 ? res.events.slice(marker + 1) : [];
  // The TYPE stream is what the semantic pass reads. It is deliberately taken
  // from the whole post-play window rather than from after the "Resolving"
  // marker: a card's payload legitimately arrives via a trigger that resolves
  // AFTER its own item leaves the stack (a spawn trigger, an after-combat
  // clause), and cutting at the marker would score those cards as doing
  // nothing when they did exactly what they print.
  res.effectTypes = res.types.slice();
  const after = snapshot(state, seat);
  res.changed = diff(before, after, card, state);
  if (pendingAct) {
    // ── R211 / CARD-TODO #87: THE WINDOW THAT NEVER CLOSED ────────────────
    //
    // The loop ended with an activation still on the stack. The window that
    // opened at `activateAbility` (line ~1241) is closed in-loop only by the
    // "an activation has resolved" branch; getting here means that branch
    // never ran, so the drill genuinely does not know what this activation
    // delivered — or whether it delivered at all.
    //
    // ⚠ WHAT USED TO HAPPEN HERE, and why it is worth reading twice: these two
    // lines used to be the same two lines the in-loop branch runs, against
    // `after` — i.e. it credited `activateTypes` with EVERY event from the
    // activation to wherever the drill stopped, which in `maxSteps` mode is
    // the rest of the game. Any event any card produced in that span became
    // this card's evidence. It had a live victim: Slag Spewer read as OBSERVED
    // because the span swallowed an `erased` emitted when its HOST was
    // destroyed several beats later (CT-86). R199 made press runs end cleanly,
    // which shut the window and the card went dark — that is how the EVENTLESS
    // category in 84-card-semantics was discovered at all.
    //
    // R199 reported it rather than changing it, correctly: a late unverified
    // edit to the drill would have invalidated that round's measurements.
    // CT-87 is the follow-through. The tail is now a REFUSAL: the events are
    // recorded so the refusal can be measured and controlled for, and nothing
    // scores off them. An honest "could not tell" is worth more than a
    // credited event that belongs to another card.
    res.actInconclusive = true;
    res.actInconclusiveReason = loopExit === 'gameover' ? 'gameover' : 'maxSteps';
    for (const t of res.types.slice(pendingAct.marker)) res.actInconclusiveTail.push(t);
    for (const c of diff(pendingAct.snap, after)) res.actInconclusiveTailChanged.push(c);
    for (const m of res.events.slice(pendingAct.evMarker)) res.actInconclusiveTailEvents.push(m);
    // …unless the caller has explicitly asked for the OLD, unbounded behaviour.
    // The only caller that may is the CT-87 positive control in
    // 181-inconclusive-activation-window.test.ts, which needs to show the same
    // run scoring the borrowed event before the fix and refusing it after. If
    // you are reading this from anywhere else, you are re-opening the bug.
    if (opts.unboundedActTailForControl) {
      for (const t of res.actInconclusiveTail) res.activateTypes.push(t);
      for (const c of res.actInconclusiveTailChanged) res.activateChanged.push(c);
    }
  }
  for (const [id, e] of Object.entries(state.entities)) {
    if (!before.entities.has(id)) res.newEntities.push(e.card);
  }
  return res;
}

function safeLegal(s: GameState, seat: Seat): Action[] {
  try { return legalActions(s, seat); } catch { return []; }
}

/**
 * The smallest action that advances the game without making choices for the
 * player we are drilling — except once the card is played, when answering
 * decisions IS the drill (a card that asks a question has to be able to
 * receive its answer).
 */
function progressAction(s: GameState, answerSeat?: Seat, blockFully = false): Action | null {
  if (s.decision) {
    const d = s.decision;
    // R197: a numeric entry carries NO options — `choice` is the value itself.
    // The FLOOR is the answer, because that is what this driver was already
    // sending when the same question was a menu (it took option 0, and the
    // menu opened at its smallest legal value). Deliberately not `suggest`:
    // changing the encoding of a question must not change any card's drill
    // result, and 84-card-semantics asserts those results in both directions.
    if (d.kind === 'number') {
      return { type: 'decide', seat: d.seat, choice: d.numeric?.min ?? 0 } as Action;
    }
    const first = d.options[0];
    if (!first) return null;
    if (d.kind === 'orderTriggers') {
      return { type: 'decide', seat: d.seat, choice: d.options.map((_, i) => i) } as Action;
    }
    // CHOOSE THE BIGGEST X, NOT THE FIRST. The X menu is offered smallest
    // first, so answering with option 0 pays X = 0 — and an X spell cast for
    // zero does nothing BY THE RULES. Eleven cards (Wildfire, Discharge,
    // Soul Siphon, Blight's End, Mindburn, Torrential Reclamation, Channel
    // Through, Floral Singularity …) reported themselves inert here for that
    // reason alone, which is the drill testing the drill.
    let idx = 0;
    const nums = d.options.map(o => typeof o.value === 'number' ? o.value : null);
    if (nums.every(n => n !== null) && nums.length > 1) {
      idx = nums.indexOf(Math.max(...(nums as number[])));
    }
    return { type: 'decide', seat: d.seat, choice: idx } as Action;
  }
  const order: Seat[] = answerSeat !== undefined ? [answerSeat, (1 - answerSeat) as Seat] : [0, 1];
  // prefer the actions that move a phase forward, in a fixed priority, so the
  // drill is deterministic and never wanders into a random board state
  const RANK = ['decide', 'passPriority', 'declareBlocks', 'declareAttack', 'doneHaste', 'donePlanning', 'doneDeploying', 'draftCommit'];
  for (const seat of order) {
    const legal = safeLegal(s, seat);
    for (const want of RANK) {
      // A BATTLE HAS TO ACTUALLY HAPPEN. The first run of this drill declared
      // the empty attack `columns: []` at every declare step, so combat never
      // started, priority was never granted, and every battle-timing card in
      // the pool reported "never legal" — 135 of them, none of which was a
      // real defect. Declaring the FULLEST attack on offer is what opens the
      // battle priority windows those cards are played in.
      if (want === 'declareAttack') {
        const attacks = legal.filter(a => a.type === 'declareAttack');
        if (!attacks.length) continue;
        const size = (a: Action) => a.type === 'declareAttack' ? a.columns.flat().length : 0;
        return attacks.reduce((best, a) => size(a) > size(best) ? a : best);
      }
      // and blocks are declined, so the attack reaches the damage step with
      // its priority windows intact rather than being traded away
      if (want === 'declareBlocks') {
        const blocks = legal.filter(a => a.type === 'declareBlocks');
        if (!blocks.length) continue;
        const size = (a: Action) => a.type === 'declareBlocks' ? Object.keys(a.blocks).length : blockFully ? -1 : 99;
        // press mode BLOCKS, and blocks as hard as it can. "When I attack or
        // block" is thirteen cards' trigger and the declined-blocks default
        // means the second half of that clause never happens at all; blocking
        // is also the only way a unit dies in combat, which is how the drill
        // reaches a `died` on a body it did not have to destroy by hand.
        return blocks.reduce((best, a) => (blockFully ? size(a) > size(best) : size(a) < size(best)) ? a : best);
      }
      const hit = legal.find(a => a.type === want);
      if (hit) return hit;
    }
  }
  for (const seat of order) {
    const legal = safeLegal(s, seat);
    if (legal.length) return legal[0]!;
  }
  return null;
}

/** cards the drill should not try to hand-play: they are not hand cards */
export function drillable(name: string): boolean {
  const c = getCard(name);
  if (c.kind === 'spellToken') return false;          // created, never played
  return true;
}
