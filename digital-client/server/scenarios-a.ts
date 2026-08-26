/* R218 — scenario batch A. See scenarios.ts for the type and the worked
 * example (`lithoghul-donated`), and docs/14-scenario-tester.md for why any of
 * this exists. Authored as a batch so parallel authors never share a file.
 *
 * ── WHAT THESE SIX HAVE IN COMMON ────────────────────────────────────────
 *
 * Every card here is in `engine/test/unreached.ts` — the drill has never once
 * observed its printed promise being delivered — and each entry there names
 * the precondition the fixture could not build. That precondition IS the
 * scenario's job, and it is written out in the WHY block above each entry.
 *
 * All six were driven end to end before they were written down: dealt, walked
 * to the clause through the real `apply` with the scripted opponent answering
 * for seat 1, and the observable in `expect` read off the resulting state.
 * `test-scenario.ts` repeats that drive over the real server, so a rules change
 * that breaks one of these fails `npm --prefix server test` rather than wasting
 * ninety seconds of the owner's time.
 *
 * ── THREE THINGS THAT COST TIME, WRITTEN DOWN SO THE NEXT AUTHOR SKIPS THEM ─
 *
 * 1. A VALUE IMPORT FROM `scenarios.ts` IS A STARTUP CRASH. See the ⚠ below.
 * 2. THE HASTE STEP IS NOT SKIPPED FOR YOU. `Scenario.prologue`'s worked
 *    example says "`dealScenario` skips it if it is open anyway (see
 *    runPrologue)". `runPrologue` does no such thing — it applies the actions
 *    it is given and nothing else. R18 opens the haste step whenever a seat
 *    HOLDS A PAYABLE HASTE CARD, so any scenario whose `hand` contains one
 *    (here: Void Mandible, Cinder Scuttler) must put `doneHaste` in its own
 *    prologue or its `declareAttack` is refused with "not your attack step".
 *    ⚠ Only the seat that holds one is asked: a second `doneHaste` for the
 *    other seat is refused with "not the haste step".
 * 3. CASTING HANDS PRIORITY TO THE OPPONENT. A prologue that wants its own
 *    play to RESOLVE therefore reads `augment`, `passPriority OPPONENT`,
 *    `passPriority YOU` — in that order. Passing as YOU first is refused with
 *    "you do not have priority".
 */
import type { Seat } from '../engine/src/types.ts';
import type { Scenario } from './scenarios.ts';

/* ⚠ THE SEATS ARE RESTATED HERE, NOT IMPORTED, and that is not a style choice.
 * `scenarios.ts` imports THIS module (it spreads `BATCH_A` into `SCENARIOS`),
 * so `import { YOU } from './scenarios.ts'` is a cycle: ES module imports are
 * hoisted, this file's body runs FIRST, and `scenarios.ts`'s own
 * `export const YOU` is still in its temporal dead zone while the literal
 * below is being evaluated. The server then dies at startup with
 * `ReferenceError: Cannot access 'YOU' before initialization` — before any
 * route or test runs, and nowhere near the line that caused it. A VALUE import
 * from `scenarios.ts` is unusable in a batch file; the `import type` above is
 * fine, because types are erased.
 *
 * The convention itself (owner = seat 0) is not restated as a claim — it is
 * pinned for every scenario by `186-scenario-library.test.ts`. */
const YOU: Seat = 0;
const OPPONENT: Seat = 1;

export const BATCH_A: Record<string, Scenario> = {
  /**
   * WHY THIS CARD (#2 in the queue: UNREACHED:BOARD · ruled×8 · [Augment] host
   * path · pronoun · zone).
   *
   * Printed: "[Augment] When you trash another card, sacrifice me. If you do,
   * recall that card from your bin."
   *
   * `unreached.ts` says: "BOARD — the recall half is observed (`leftBin`), the
   * self-sacrifice is a mod leaving play and emits neither `died` nor
   * `trashed`." That is the drill's account of it. The suite's account is
   * `43-dark-c.test.ts`, which has both an in-play test and a Virus-donated
   * one — but the donated one attaches the mod WHITE-BOX
   * (`whiteBox(h, e => e.attachMod(...))`), so no test in the repository has
   * ever put this card on a host through the real `augment` action and then
   * watched the host die for it.
   *
   * That is exactly what a human can settle in ninety seconds, because the
   * pronoun IS the card. "Sacrifice me" on a mod means THE HOST — the Virus
   * reads as "the next card you trash costs you this unit" — so the observable
   * is a 10/15 body disappearing off the board. If "me" resolved to the augment
   * instead, the Colossus would still be standing with no mod on it: visible,
   * and different, and not merely "nothing happened".
   *
   * The trash is a REAL trash through a real action, not a synthesised event:
   * Darkblast prints "[Discard a card]" as a cast cost (`castCost: discardCard`)
   * and a discard trashes (R40). The hand is built so that when that cost is
   * asked there is EXACTLY ONE card left to discard — no wrong click exists.
   */
  'cthyrian-rector-sacrifice': {
    id: 'cthyrian-rector-sacrifice',
    card: 'Cthyrian Rector',
    why: 'the [Augment] host path, through the real augment action. "Sacrifice '
      + 'me" on a donated augment means the HOST, and no test in the repo has '
      + 'ever watched a host actually die for it — 43-dark-c attaches the mod '
      + 'white-box, and the drill cannot see the sacrifice at all (unreached.ts: '
      + 'a mod leaving play is neither a death nor a trash).',
    expect:
      'Cthyrian Rector is a Virus card, so you can augment it onto a unit during battle.\n'
      + '1. Play Cthyrian Rector onto YOUR OWN Towering Colossus, then pass so it resolves and attaches.\n'
      + '2. Play Darkblast. Aim its 5 damage at the OPPONENT. Its extra cost then makes you\n'
      + '   discard a card — Luminous Arc is the only one left, so there is nothing to get wrong.\n'
      + '3. Discarding trashes it, and the Rector triggers.\n'
      + '4. Pass until the stack is empty.\n'
      + 'EXPECTED: your TOWERING COLOSSUS IS GONE. "Sacrifice me" on an augment means the unit\n'
      + 'wearing it, not the augment itself — if the Colossus is still standing, that is the bug.\n'
      + 'EXPECTED: Luminous Arc comes back out of your bin INTO YOUR HAND.\n'
      + 'EXPECTED: the opponent finishes on 25, you stay on 30.\n'
      + '(The Colossus is erased rather than left in your bin because a modded card is Unstable —\n'
      + 'that is R79, not this card.)',
    initiative: YOU,
    you: {
      // in this order on purpose: once the Rector and the Darkblast are played,
      // ONE card is left, so the "discard a card" cost has exactly one option
      // and cannot be misclicked into a different reading of the card.
      hand: ['Cthyrian Rector', 'Darkblast', 'Luminous Arc'],
      // the host, and the attacker. It has to be attacking: a listener is
      // region-scoped (R12) and the battle is fought in the DEFENDER's region,
      // so a host sitting at home would never hear the trash. 10/15 also makes
      // its disappearance the least missable thing on the screen. Its own
      // printed text is an [Augment] box, inert while it is a body in play.
      play: [{ card: 'Towering Colossus' }],
      // Rector is d/1, Darkblast rd/1. Deliberately far more than enough: a
      // scenario that fails on mana is a `bad scenario` verdict about the
      // wrong thing.
      resources: { dark: 6, fire: 6 },
    },
    // nothing at all — the Darkblast damage goes at the player, so there is no
    // second body to wonder about and no blocker to think about.
    opponent: { hand: [], play: [], resources: { earth: 2 } },
    prologue: (ids, s) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      // no `doneHaste` here: neither seat holds a haste card, so R18 never
      // opens the step. Contrast void-mandible-negates below.
      { type: 'declareAttack', seat: s.battle?.attacker ?? YOU, columns: [[ids.you[0]!]] },
    ],
    phase: 'battle',
    priority: YOU,
    // driven with seat 1 passing throughout; it never has to do more than
    // decline a block.
    needsLiveOpponent: false,
  },

  /**
   * WHY THIS CARD (#3: UNREACHED:EVENTLESS · ruled×16 · [Augment] · CT-86).
   *
   * Printed: "[Augment][once] [one], Erase one of my mods: I deal 2 damage to
   * any target."
   *
   * This is the ONE `EVENTLESS` entry in the whole ledger, and the category
   * exists for it: the erase really happens, and nothing in the game can see it
   * happen. `batch-hybrids-fwe.ts` splices the mod out and deletes the entity,
   * then announces it with `g.ev('info', …)` — an `info` line, not an `erased`
   * event. Every other erase site in the codebase emits `erased`, and `E.ev()`
   * is what files a card into `PlayerState.erased`, the public erased pile R65
   * says erasing puts a card into. So this card's erase reaches no pile and no
   * listener. `178-played-item-and-erased-mods.test.ts` pins that behaviour
   * under a heading that says out loud it is OPEN (round-27 Q3); CT-86 is the
   * ticket.
   *
   * SO THIS SCENARIO IS NOT ASKING "DID IT WORK". It is asking the owner to
   * rule on a destination, and the `expect` says so rather than implying the
   * current behaviour is settled. What he can actually SEE is only: the 2
   * damage landed where he aimed it, the mod vanished off the unit, and one log
   * line said ERASED. What he cannot see — measured, not observed — is that the
   * card reached no pile at all. The client draws no erased pile anywhere
   * (there is no such element in `engine/ui/index.html`), which is R65
   * predicting itself: "there's currently no way to view erased cards."
   *
   * The mod it erases is ITSELF, because "my mods" is the CARRIER's mods
   * (`E.modsOnSource`) and Slag Spewer is the only one riding this host. That
   * is the smallest board that reaches the clause, and it puts the question in
   * its sharpest form: the card erases itself to pay for its own damage, and
   * then is nowhere.
   *
   * The wrong answer still points somewhere else: the damage is aimed at the
   * OPPONENT, so a mis-resolved "any target" would take 2 off the owner's own
   * life instead.
   */
  'slag-spewer-erase': {
    id: 'slag-spewer-erase',
    card: 'Slag Spewer',
    why: 'the only EVENTLESS card in the unreached ledger, and CT-86 / round-27 '
      + 'Q3 are open on it. The mod erasure really happens but announces itself '
      + 'with an `info` line instead of an `erased` event, so the card reaches '
      + 'neither the public erased pile (R65) nor any listener. What the erase '
      + 'SHOULD do is a ruling, not a bug report — this scenario is asking for '
      + 'the ruling.',
    expect:
      'Slag Spewer is a Virus card, so you can augment it onto a unit during battle.\n'
      + '1. Play Slag Spewer onto YOUR OWN Ambling Mountaintop, then pass so it attaches.\n'
      + '2. Activate its ability on that unit. Aim the 2 damage at the OPPONENT.\n'
      + "3. It then asks which of the host's mods to erase as the cost — Slag Spewer itself\n"
      + '   is the only one there. Pick it, then pass.\n'
      + 'EXPECTED: the opponent goes 30 -> 28. You stay on 30.\n'
      + 'EXPECTED: Slag Spewer is gone off the unit, and is NOT in your bin (an erase is not a death).\n'
      + '\n'
      + 'THE OPEN QUESTION, and the reason this card is in the queue — where should an erased\n'
      + 'mod END UP? Right now it goes nowhere at all: it is deleted, one log line says ERASED,\n'
      + 'and unlike every other erase in the game it never reaches your erased pile, so nothing\n'
      + 'in a game could ever react to it. That is ticket CT-86 and it is UNANSWERED. If the\n'
      + 'damage and the disappearance look right to you, the card is doing what it prints; the\n'
      + 'destination is a separate ruling, and the note field is the place for it.',
    initiative: YOU,
    you: {
      hand: ['Slag Spewer'],
      // the host, and the attacker (R12 again: the ability's carrier has to be
      // in the battle's region). A 4/5 with no text of its own, so nothing on
      // this board competes for the owner's attention.
      play: [{ card: 'Ambling Mountaintop' }],
      // er/2 for the augment, plus the [one] for the activation. Over-provisioned.
      resources: { earth: 6, fire: 6 },
    },
    opponent: { hand: [], play: [], resources: { earth: 2 } },
    prologue: (ids, s) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: s.battle?.attacker ?? YOU, columns: [[ids.you[0]!]] },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * WHY THIS CARD (#4: UNREACHED:BOARD · ruled×15).
   *
   * Printed: "When I am trashed, negate up to one target nonspell effect." —
   * plus the printed "2 [d] Discard Me. {Battle}" cost line: paying it discards
   * the card, which trashes it (R40), which fires this from the bin.
   *
   * `unreached.ts`: "BOARD — the bait the drill can put on the stack is a spell
   * effect, so there is correctly nothing of that kind to aim at." The suite
   * reaches the clause exactly once, in `114-literal-dark.test.ts`, and only
   * for one member of the nonspell set: a VIRUS on the stack. A TRIGGERED
   * ability — the commonest nonspell effect there is, and the thing a player
   * actually wants a hard answer to — has never been aimed at.
   *
   * The bait is the owner's OWN Lithoghul, which is the sharpest trigger in the
   * pool for this: "Whenever I am dealt damage, I deal that much damage to
   * you", where the trigger's controller is the CARRIER's controller — so as
   * his own body it burns HIM. That makes the observable a life total, and the
   * wrong answer points straight at it: with Nothyr answering he stays on 30,
   * without it he is on 24. Both measured before this was written.
   *
   * Lithoghul carries three +1/+1 counters so it is a 7/7 and SURVIVES the 6. A
   * bait that died would make him adjudicate two things at once — the same
   * reason the Lithoghul scenario in scenarios.ts chose a host that lives.
   */
  'nothyr-negates-a-trigger': {
    id: 'nothyr-negates-a-trigger',
    card: 'Nothyr',
    why: '"negate up to one target NONSPELL effect" aimed at a TRIGGERED '
      + 'ability. The drill can only put a spell on the stack (unreached.ts), and '
      + 'the one test that reaches the clause (114-literal-dark) aims it at a '
      + 'VIRUS. A trigger — the commonest nonspell effect in a real game, and the '
      + 'thing the card exists to answer — has never been targeted.',
    expect:
      'Your Lithoghul reads "whenever I am dealt damage, I deal that much damage to you" —\n'
      + 'so damaging your own Lithoghul puts a trigger on the stack aimed at YOUR life total.\n'
      + '1. Play Luminous Arc at your own Lithoghul (it is the only unit it can target). Pass.\n'
      + '2. The Arc resolves for 6. Lithoghul survives (it has counters) and its trigger goes\n'
      + '   on the stack: 6 damage to YOU.\n'
      + '3. Now play Nothyr using its printed "Discard me" cost. Discarding trashes it, which\n'
      + '   fires "negate up to one target nonspell effect".\n'
      + '4. Its target menu must offer the LITHOGHUL TRIGGER. Pick it, then pass.\n'
      + 'EXPECTED: you finish on 30 life, and Lithoghul is still on the board with 6 damage on it.\n'
      + 'If Nothyr had not answered the trigger you would be on 24 — that is the whole\n'
      + 'difference, and it is on the life counter.',
    initiative: YOU,
    you: {
      hand: ['Luminous Arc', 'Nothyr'],
      // 4/4 plus three +1/+1 counters = 7/7, so the 6 does not kill it. It also
      // has to be the attacker, or it is not in the battle's region and the Arc
      // could not be aimed at it.
      play: [{ card: 'Lithoghul', counters: 3 }],
      // Luminous Arc is r/2; Nothyr's discard-me line is 2 [d]. Over-provisioned.
      resources: { fire: 6, dark: 6 },
    },
    // empty on purpose: with no other unit in the battle region, the Arc's
    // target menu has exactly one entry and the setup cannot be misclicked.
    opponent: { hand: [], play: [], resources: { earth: 2 } },
    prologue: (ids, s) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: s.battle?.attacker ?? YOU, columns: [[ids.you[0]!]] },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * WHY THIS CARD (#5: UNREACHED:BOARD · ruled×10 · [Augment] · zone).
   *
   * Printed: "[Augment] Erase me: Negate all spell effects."
   *
   * `unreached.ts`: "BOARD — activated at a window where the stack holds no
   * spell. The erase half of the same line IS observed." `18-earth-c.test.ts`
   * does test the negate — but it spawns Skybreaker as its own BODY, with a
   * comment saying so ("[Augment] text live when played normally"). NOBODY has
   * ever paid "Erase me" while the card was riding a HOST.
   *
   * That turns out to matter more than the ledger entry suggests, and it is why
   * this one is worth ninety seconds. "Me" is the carrier — the same pronoun
   * Cthyrian Rector uses two entries up — so on a host, "Erase me" ERASES THE
   * HOST, mods and all, out of the game. Driven: the owner's own unit and
   * Skybreaker both land in `PlayerState.erased`; no bin, no death, no death
   * trigger. Nothing in the repository says whether that price is intended, and
   * `dsl.ts`'s note on `eraseSelf` only ever discusses the card as its own
   * body. It is exactly the sort of thing a sweep cannot think to ask.
   *
   * TWO spells, not one, because the printed word is "all". The wrong answer
   * therefore points somewhere specific rather than nowhere: if only the top
   * item were negated, Ambling Mountaintop would die and Bubb would live.
   * Measured both ways — with the ability, both survive with no damage on them;
   * without it, both die.
   *
   * The augment is applied by the PROLOGUE (a real `augment` from hand, so the
   * from-hand play is exercised on every deal) rather than by the owner,
   * because the clause under test is the ACTIVATION and he already has spells
   * to cast before he reaches it.
   */
  'skybreaker-negates-spells': {
    id: 'skybreaker-negates-spells',
    card: 'Skybreaker',
    why: '"Erase me: negate all spell effects" paid while the card is riding a '
      + 'HOST. 18-earth-c tests the negate with Skybreaker as its own body; the '
      + 'augment path has never been played, and on a host "me" is the HOST — so '
      + "paying the cost erases the owner's whole unit out of the game. Nothing "
      + 'in the repo says whether that price is intended.',
    expect:
      'Your Carapace Devourer is already wearing Skybreaker (it was augmented on for you).\n'
      + '1. Play Luminous Arc at their AMBLING MOUNTAINTOP (6 damage — it is a 4/5, it would die).\n'
      + '2. WITHOUT passing, play the second Luminous Arc at their BUBB (a 5/6 — it would die too).\n'
      + '3. Both spells are now on the stack. Activate Skybreaker\'s "Erase me: negate all spell\n'
      + '   effects" on your Carapace Devourer, then pass.\n'
      + 'EXPECTED: BOTH enemy units are still there, with NO damage on them, and both Arcs are\n'
      + 'in your bin having done nothing. If only one of them was answered, that is the bug —\n'
      + 'the card says "all".\n'
      + 'EXPECTED, and worth your ruling: paying "Erase me" takes YOUR CARAPACE DEVOURER with it.\n'
      + 'On an augment, "me" is the unit wearing it, so the whole body is erased out of the game\n'
      + '— no bin, no death, nothing triggers off it. Is that the right price for this card?',
    initiative: YOU,
    you: {
      // index 0 is the augment the prologue plays; the two Arcs are what the
      // owner is left holding.
      hand: ['Skybreaker', 'Luminous Arc', 'Luminous Arc'],
      // a 3/3 with no printed text, so what gets erased is legible and the board
      // carries nothing else to read. It attacks, which is what puts it in the
      // battle's region alongside the two enemy bodies the Arcs need to reach.
      play: [{ card: 'Carapace Devourer' }],
      // Skybreaker is ee/2 and each Arc is r/2. Over-provisioned.
      resources: { earth: 6, fire: 8 },
    },
    opponent: {
      hand: [],
      // both die to 6, and they are named differently enough that "which one
      // survived" is answerable at a glance.
      play: [{ card: 'Ambling Mountaintop' }, { card: 'Bubb' }],
      resources: { earth: 2 },
    },
    // R218 — the prologue SPENDS the Skybreaker: a non-{Virus} [Augment] can
    // only ever attach as a deployment action (`doAugment`: "modding is a
    // deployment action (or a battle Virus)"), so the donated text cannot be
    // reached without playing it before the owner takes over. This declares
    // what he actually finds in hand; 186 §1 asserts it is a SUBSET of what was
    // dealt, so spending is allowed and drawing is not.
    handAfterPrologue: ['Luminous Arc', 'Luminous Arc'],
    prologue: (ids, s) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: s.battle?.attacker ?? YOU, columns: [[ids.you[0]!]] },
      // hand index 0 = Skybreaker. It is a {Virus}, which is the only thing
      // that makes an augment from hand legal DURING battle at all — the engine
      // refuses anything else with "modding is a deployment action (or a battle
      // Virus)".
      { type: 'augment', seat: YOU, from: 'hand', index: 0, hostId: ids.you[0]! },
      // ⚠ this order, not the other one: casting hands priority to the
      // opponent, so YOU cannot pass until seat 1 has.
      { type: 'passPriority', seat: OPPONENT },
      { type: 'passPriority', seat: YOU },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * WHY THIS CARD (#6: UNREACHED:BOARD · ruled×21 · [Augment] · pronoun · just
   * fixed by R207).
   *
   * Printed: "[Augment] When a nontoken card is played during battle, sacrifice
   * me. If you do, negate that effect. (This is not optional.)"
   *
   * R207 FIXED THIS CARD THIS ROUND, and this scenario is the CONFIRMATION that
   * the fix reads right in a real game rather than only in a fixture. The card
   * used to find its victim by scanning the stack for (card name, controller)
   * and taking the FIRST match — which is the OLDER item when two copies of the
   * same card are up. `cardPlayed` now carries the stack item's id and the card
   * negates by id. `178-played-item-and-erased-mods.test.ts` guards it; this
   * puts the same board in front of the rules authority.
   *
   * So the board is deliberately the ambiguous one: TWO Luminous Arcs, same
   * card, same controller, both on the stack, aimed at two different enemy
   * bodies. The right answer and the old wrong answer are exact mirror images —
   * under R207 Bubb survives and Ambling Mountaintop dies; under the old scan it
   * was the other way round. There is no reading of the finished board where
   * the owner cannot tell which happened.
   *
   * ROOK IS ON THE BOARD FOR ONE REASON and it is not decoration. Void Mandible
   * is NOT a {Virus}, and the engine refuses an augment from hand mid-battle
   * for anything else ("modding is a deployment action (or a battle Virus)").
   * Reaching its [Augment] host path otherwise would need the prologue to walk
   * through deployment into a SECOND turn, which deals both players fresh cards
   * and makes the board depend on the seed — the one property the tester's
   * `&seed=` switch promises it does not have. Rook prints "[Augment] You may
   * augment cards from hand and bin during battle as if they were [Virus]", its
   * text box is live while it is a body in play, and the owner ruled it confers
   * {Virus} outright (R157 §26 / R161). `178` uses the same trick for the same
   * reason.
   *
   * "Sacrifice me" is the host again (Towering Colossus), so the price is
   * visible too.
   */
  'void-mandible-negates': {
    id: 'void-mandible-negates',
    card: 'Void Mandible',
    why: 'R207 fixed this card THIS ROUND — it was negating the wrong stack '
      + 'item, because it searched by card name and took the first match; '
      + '`cardPlayed` now carries the item id. This is the confirmation in a real '
      + 'game: two identical Luminous Arcs are on the stack, and the right answer '
      + 'and the old wrong answer are exact mirror images of each other.',
    expect:
      'Rook is on your board only to let you augment during battle — that is its printed text.\n'
      + '1. Play the first Luminous Arc at their AMBLING MOUNTAINTOP. Leave it on the stack.\n'
      + '2. Play Void Mandible onto YOUR OWN Towering Colossus, then pass so it attaches.\n'
      + '   (Applying a mod is not playing a card, so nothing triggers yet.)\n'
      + '3. Now play the second Luminous Arc at their BUBB. Void Mandible fires at once — it is\n'
      + '   not optional — and sacrifices your Towering Colossus to pay for itself.\n'
      + '4. Pass until the stack is empty.\n'
      + 'EXPECTED: BUBB SURVIVES and AMBLING MOUNTAINTOP DIES. "That effect" is the card you\n'
      + 'just played — the second Arc — not the one that was already sitting on the stack.\n'
      + 'If it comes out the other way round (Bubb dead, Ambling Mountaintop alive) then the\n'
      + 'card is negating the wrong item and R207 did not hold.\n'
      + 'EXPECTED: your Towering Colossus is gone — "sacrifice me" on an augment is the host.',
    initiative: YOU,
    you: {
      hand: ['Luminous Arc', 'Void Mandible', 'Luminous Arc'],
      // ids.you[0] = Rook (the battle-augment permission, live as a body),
      // ids.you[1] = the host that pays for the trigger. BOTH attack: the
      // permission and the listener are region-scoped (R12), and the battle is
      // fought in the opponent's region.
      play: [{ card: 'Rook' }, { card: 'Towering Colossus' }],
      // two Arcs at r/2 plus Void Mandible at ll/2. Over-provisioned.
      resources: { fire: 8, light: 6 },
    },
    opponent: {
      hand: [],
      // one for each Arc; both die to 6, so "which one is left" is the answer.
      play: [{ card: 'Ambling Mountaintop' }, { card: 'Bubb' }],
      resources: { earth: 2 },
    },
    prologue: (ids, s) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      // ⚠ REQUIRED: Void Mandible is a {Haste} card and it is in hand, so R18
      // opens the haste step and `declareAttack` is refused until it is closed.
      // Only the seat that HOLDS one is asked — a `doneHaste` for seat 1 here
      // is refused with "not the haste step".
      { type: 'doneHaste', seat: YOU },
      { type: 'declareAttack', seat: s.battle?.attacker ?? YOU, columns: [[ids.you[0]!], [ids.you[1]!]] },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * WHY THIS CARD (#7: UNREACHED:VOCAB · ruled×6 · zone).
   *
   * Printed: "When you deal combat damage to an opponent, if I am in your bin,
   * recall me. (Put me into your hand.)"
   *
   * `unreached.ts`: "VOCAB — `recall` has no event type of its own and its
   * state evidence is a HAND delta, which a bin→play recall never makes." The
   * ledger entry is about the checker's vocabulary, but the thing underneath it
   * is a ZONE question, and the card's own reminder text is the answer: the
   * destination is the HAND, not play. That is the one thing a human eye settles
   * instantly and a fixture argues about.
   *
   * `168-three-card-divergences.test.ts` covers the attribution ("YOU dealt it",
   * "to an OPPONENT") by pushing the card into a bin directly. This drives the
   * whole thing through real actions instead — including getting the card INTO
   * the bin, which is done by discarding it to pay Darkblast's printed
   * "[Discard a card]".
   *
   * THE CONTROL IS BUILT IN, and it is why Darkblast is the discard outlet
   * rather than something quieter: Darkblast's own 5 damage goes at the
   * opponent's face, and it is NOT combat damage. So the owner watches the
   * opponent's life drop by 5 with Cinder Scuttler sitting still in the bin, and
   * only when the attacker connects for 10 does it come back. A card that
   * returned on the first hit would be treating any life loss as combat damage —
   * visible, different, and inside the same ninety seconds.
   */
  'cinder-scuttler-recall': {
    id: 'cinder-scuttler-recall',
    card: 'Cinder Scuttler',
    why: 'the printed destination is a ZONE call — "recall me. (Put me into your '
      + 'hand.)" — and the drill cannot see it (unreached.ts: recall has no event '
      + 'of its own, and its state evidence is a hand delta). This drives the '
      + 'whole clause through real actions and builds in the control the card '
      + 'needs: noncombat damage must NOT bring it back.',
    expect:
      '1. Play Darkblast. Aim its 5 damage at the OPPONENT. Its extra cost then makes you\n'
      + '   discard a card — Cinder Scuttler is the only one left, so it goes to your bin.\n'
      + '2. Pass. Darkblast resolves and the opponent goes 30 -> 25.\n'
      + '   EXPECTED HERE: Cinder Scuttler STAYS IN YOUR BIN. That 5 was not combat damage.\n'
      + '3. Keep passing. Nothing blocks, and your Towering Colossus connects for 10:\n'
      + '   the opponent goes 25 -> 15.\n'
      + 'EXPECTED: Cinder Scuttler now leaves your bin and lands IN YOUR HAND — not in play,\n'
      + 'and not still in the bin. Its reminder text is "Put me into your hand", so a copy that\n'
      + 'came back onto the board would be wrong even though it moved.',
    initiative: YOU,
    you: {
      // two cards only, so the discard cost has exactly one option.
      hand: ['Darkblast', 'Cinder Scuttler'],
      // 10 power, so the combat hit is unmistakable next to Darkblast's 5.
      play: [{ card: 'Towering Colossus' }],
      // Darkblast is rd/1. Over-provisioned.
      resources: { fire: 6, dark: 6 },
    },
    // nothing to block with, so the attacker is guaranteed to connect and the
    // scripted opponent's "decline blocks" is the whole of its job.
    opponent: { hand: [], play: [], resources: { earth: 2 } },
    prologue: (ids, s) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      // ⚠ REQUIRED: Cinder Scuttler is a {Haste} card sitting in hand, so R18
      // opens the haste step. See void-mandible-negates.
      { type: 'doneHaste', seat: YOU },
      { type: 'declareAttack', seat: s.battle?.attacker ?? YOU, columns: [[ids.you[0]!]] },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },
};
