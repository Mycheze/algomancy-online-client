/* R218 — scenario batch B. See scenarios.ts for the type and the worked
 * example (`lithoghul-donated`), and docs/14-scenario-tester.md for why any of
 * this exists. Authored as a batch so parallel authors never share a file.
 *
 * ── WHAT THIS BATCH IS ───────────────────────────────────────────────────
 *
 * Six cards off `engine/test/unreached.ts` — the ledger of printed promises
 * the whole-pool drill has never once watched being delivered. Each entry
 * there names the exact precondition the fixture could not build, and that
 * precondition is what the scenario below constructs:
 *
 *   Automaton of Abundance  BOARD  — a token creation by the HOST's controller
 *                                    while the augment is on
 *   Scholar of the Void     CHOICE — the offer that `progressAction` never
 *                                    takes
 *   Necromantic Rebuke      CHOICE — the ransom REFUSED, so the negate happens
 *   Stellarspore Harvester  BOARD  — a -1/-1 counter surviving to the
 *                                    after-combat step on a legal target
 *   Vengeance               BOARD  — the opponent PLAYING a card while the
 *                                    augment is on
 *   Worldbender             BOARD  — an actual card step, replaced
 *
 * ⚠ THE IMPORT TRAP, hit for real while writing this (and hit by another batch
 * at the same time). `scenarios.ts` declares `YOU`/`OPPONENT` AFTER it imports
 * the batch files, so a batch that writes `initiative: YOU` in its object
 * LITERAL dies at module-evaluation time with "Cannot access 'YOU' before
 * initialization" — and because main.ts imports scenarios.ts, that is the
 * whole server down, not one bad scenario. A batch file must therefore either
 * declare its own seat constants (this file does, below) or only name the
 * imported ones from INSIDE a prologue closure, which runs long after the
 * cycle has settled.
 */
import type { Seat } from '../engine/src/types.ts';
import type { Scenario } from './scenarios.ts';

/** Local copies of `scenarios.ts`'s `YOU`/`OPPONENT`, for the import-cycle
 * reason in the header. The values are pinned by the convention that owns
 * them (owner = seat 0, scripted bot = seat 1) and `186-scenario-library`
 * asserts every scenario's declared board against those same seats, so a
 * drift between these two lines and that convention is a red suite. */
const YOU = 0 as Seat;
const OPPONENT = 1 as Seat;

export const BATCH_B: Record<string, Scenario> = {
  /**
   * WHY THIS CARD (R218).
   *
   * `unreached.ts` — "BOARD — a REPLACEMENT ('if you would create one or more
   * unit tokens, instead …'). It needs a token creation by the HOST's
   * controller while the augment is on, which no beat provides."
   *
   *  1. Printed: "[Augment] If you would create one or more unit tokens,
   *     instead create those tokens plus an additional copy of each unique
   *     token you created." That "instead" is a REPLACEMENT over a whole
   *     creation batch, not a trigger per spawn — and the difference is a
   *     REPORTED BUG, not a theory. Playtest report #60: "Automaton of
   *     Abundance fires per spawn so N identical tokens yield N copies instead
   *     of one per unique."
   *  2. WHAT THE SUITE COVERS AND WHAT IT DOES NOT. Six test files name this
   *     card and every one of them puts it on the board as ITS OWN BODY
   *     (`spawn(h, A, 'Automaton of Abundance')` in 26-metal-a, 27-metal-b,
   *     87-replacement-layer and 136-triggers-and-modes). Not one augments it
   *     onto a host. The card is an [Augment] and `self` is the ANCHOR — the
   *     host, once it is a mod — so the whole donated path, including "YOU
   *     would create" reading off the HOST's controller, has never run. That
   *     is R212 / docs/13 §1③'s hole in the exact family it was named for.
   *  3. THE OBSERVABLE IS A COUNT OF BODIES, and the two wrong answers land on
   *     different numbers than the right one. Four wood resources make Sylvan
   *     Sprouting create FOUR identical 1/1s in one batch:
   *         5 units  — correct: one extra per UNIQUE token
   *         8 units  — report #60's per-spawn bug, back again
   *         4 units  — the augment did not fire at all (the donated anchor is
   *                    wrong, or the region scoping is)
   *     Three readings, three counts, nothing to interpret.
   *  4. The host is one of YOUR units because it has to be: Automaton is not a
   *     {Virus}, so `doAugment` will only ever attach it to a unit in your own
   *     region. There is no legal board on which its "you" is somebody else —
   *     which is worth knowing and is why this scenario tests the COUNT rather
   *     than the seat.
   */
  'automaton-augmented-batch': {
    id: 'automaton-augmented-batch',
    card: 'Automaton of Abundance',
    why: 'the "instead" batch replacement, DONATED — every one of the six tests that names '
      + 'this card spawns it as its own body, so the [Augment] host path has never run. '
      + 'Playtest report #60 is the bug it would regress into (one extra per unique token, '
      + 'not one per spawn).',
    expect:
      'You are in DEPLOYMENT. Automaton of Abundance is an augment; put it on your own unit,\n'
      + 'then make some tokens and count them.\n'
      + '1. Augment Automaton of Abundance onto your The Foretold.\n'
      + '2. Play Sylvan Sprouting ("create a 1/1 unit for each of your wood"). You have FOUR\n'
      + '   wood resources, so it creates four identical 1/1s.\n'
      + 'EXPECTED: you end up with exactly FIVE 1/1 tokens. Four printed, plus ONE extra — the\n'
      + 'four are all the same token, so "an additional copy of each unique token" is one copy.\n'
      + 'EIGHT tokens means it copied every spawn instead of every unique token (the old bug).\n'
      + 'FOUR means the augment did nothing at all.\n'
      + '(The Foretold picks up {Unstable} when you augment it. That is R79, not this card — it\n'
      + 'only matters if the host later leaves play, and nothing here makes it.)',
    initiative: YOU,
    you: {
      // Automaton is mm/5, Sylvan Sprouting is g/3.
      hand: ['Automaton of Abundance', 'Sylvan Sprouting'],
      // the host. Blank text, no attributes — the one genuinely vanilla unit
      // in the pool, so nothing it prints can be confused for the clause under
      // test. (⚠ Towering Colossus is NOT inert as a body — see the note on
      // `lithoghul-donated` in the batch report; its [Augment] line radiates.)
      play: [{ card: 'The Foretold' }],
      // 8 + 4 = 12 open against a bill of 5 + 3. The wood count is NOT
      // over-provisioning: it is the scenario's arithmetic. Sylvan Sprouting
      // creates one token per wood AFFINITY, affinity counts expended
      // resources too (R1), so paying for the augment first cannot change the
      // four. Metal is what is deliberately generous.
      resources: { metal: 8, wood: 4 },
    },
    opponent: { hand: [], play: [], resources: { earth: 2 } },
    prologue: () => [
      // planning → battle → (two declined rounds) → deployment. The attacker
      // seats are HARDCODED rather than read off `s.battle`: the prologue
      // function is called ONCE, with the state as it was BEFORE any of these
      // actions, so `s.battle` is still null there. With initiative pinned to
      // seat 0, round 1 is seat 0's and round 2 is seat 1's.
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: YOU, columns: [] },
      { type: 'declareAttack', seat: OPPONENT, columns: [] },
    ],
    phase: 'deploy',
    // deployment is simultaneous (R50) — nobody "holds priority" in it
    priority: null,
    // the bot's only move here is `doneDeploying`, which it takes on open and
    // which ends nothing while seat 0 is still deploying. Driven end to end
    // with seat 1 empty.
    needsLiveOpponent: false,
  },

  /**
   * WHY THIS CARD (R218).
   *
   * `unreached.ts` — "CHOICE — 'you MAY discard your hand and transform me.'
   * The trigger fires and resolves; the offer is declined."
   *
   *  1. Printed: "[Augment] At the start of deployment, you may discard your
   *     hand and transform me into Beyond, Codex Incarnate." A 1-mana 0/2
   *     becomes an 8/3, and the price is your whole hand.
   *  2. WHAT IS AND IS NOT COVERED. 43-dark-c has hand-built coverage of both
   *     branches and 135-exchange-and-zones covers R157 §10 (it bins as its
   *     FRONT face). What has never happened is the clause in a GAME: the
   *     drill's `progressAction` answers this decision the other way every
   *     time, so no play-through has ever turned the card over. That is
   *     exactly the gap docs/14 §1 exists for — "a sweep asks the question you
   *     thought to ask; a game asks the question you didn't" — and the owner
   *     is the only oracle that can say the 8/3 is the right 8/3.
   *  3. THE OBSERVABLE IS A UNIT CHANGING INTO A DIFFERENT UNIT. Not a
   *     counter, not a life total: the body on the board is renamed and goes
   *     from 0/2 to 8/3, and the hand it cost goes to zero. A wrong answer
   *     (still a Scholar, or a hand that survived, or a hand discarded with no
   *     transform) is visible without reading a log line.
   *  4. It also PLAYS the card through the real path — Scholar is {Haste}
   *     timing, so the R18 haste step opens for it, which is a window nothing
   *     else in this batch exercises.
   */
  'scholar-transforms': {
    id: 'scholar-transforms',
    card: 'Scholar of the Void',
    why: 'the branch no driver has ever taken. 43-dark-c proves the transform from a hand-built '
      + "board; the drill's `progressAction` answers this decision the other way in every "
      + 'play-through, so no GAME has ever turned the card over. Owner-only question: is an '
      + '8/3 for your whole hand the right trade?',
    expect:
      'Scholar of the Void is a {Haste} card, so it is played in the short haste step, before\n'
      + 'the battle. The trigger you are testing fires at the start of the NEXT deployment.\n'
      + '1. Play Scholar of the Void now (it resolves immediately — the haste step is not\n'
      + '   interactive). It arrives as a 0/2.\n'
      + '2. Click done with the haste step, then declare an attack with NOBODY. The opponent\n'
      + '   does the same and deployment begins.\n'
      + '3. Scholar asks: take the option that says "Discard 2 cards and transform into\n'
      + '   Beyond, Codex Incarnate" — NOT "Decline".\n'
      + 'EXPECTED: the 0/2 on your board is replaced, in place, by Beyond, Codex Incarnate at\n'
      + '8/3, and your hand goes to ZERO cards (both of them are trashed to your bin).\n'
      + 'A body still reading 0/2, or a hand that still has cards in it, is the failure.',
    initiative: YOU,
    you: {
      // the two behind Scholar are the COST made visible: "discard your hand"
      // has to have a hand to discard, and two named cards are countable at a
      // glance where seven random ones are not.
      hand: ['Scholar of the Void', 'The Foretold', 'Manufacture'],
      play: [],
      // Scholar is d/1. Four is deliberately absurd for a 1-drop: this
      // scenario must never fail on mana.
      resources: { dark: 4 },
    },
    opponent: { hand: [], play: [], resources: { earth: 2 } },
    prologue: () => [
      // both seats finish planning, which opens the R18 haste step — and it
      // opens ONLY because seat 0 is holding a payable {Haste} card, so this
      // prologue and the scenario's hand are one fact, not two.
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
    ],
    phase: 'planning',
    // the haste step is a simultaneous segment like deployment: per-seat done
    // flags, nobody holding priority
    priority: null,
    // seat 1 is auto-done with the haste step (it holds no haste card), and
    // declines its own battle round. Driven end to end with the seat empty.
    needsLiveOpponent: false,
  },

  /**
   * WHY THIS CARD (R218).
   *
   * `unreached.ts` — "CHOICE — 'negate up to one target effect UNLESS its
   * controller erases X cards from their bin.' The controller is offered the
   * escape and takes it."
   *
   *  1. Printed: "[Erase X cards from your bin] Negate up to one target effect
   *     unless its controller erases X cards from their bin." Two erases, one
   *     paid by you at cast (R64 — X is fixed there) and one offered to the
   *     other side at resolution. The promise that has never been observed is
   *     the NEGATE, because the escape is always taken.
   *  2. WHY THE TARGET IS YOUR OWN SPELL, which is the one thing about this
   *     scenario that will look odd. The ransom belongs to the TARGETED
   *     effect's controller. Aim the Rebuke at the opponent and the decision
   *     is theirs — and the scripted bot answers every decision with option 0,
   *     which here is "erase X", so the bot pays and the effect always
   *     survives. Making the board need a second human for one button is worse
   *     than this (docs/14 §4). Rebuke says "up to one target EFFECT" with no
   *     ownership qualifier, so your own Luminous Arc is a legal target and
   *     the refusal becomes yours to make — one seat, one tab, the branch
   *     reached. ⚠ If the owner thinks a Rebuke should not be able to target
   *     its caster's own effect, that is a real ruling and `slightly-off` is
   *     the button for it.
   *  3. WHAT THE SUITE COVERS. 42-dark-b covers seven Rebuke cases from
   *     hand-built boards, the declined ransom included. What it cannot cover
   *     is the owner's judgement on the shape of the thing — three decisions
   *     deep (how many to erase, what to aim at, whether to pay) inside one
   *     cast, in a real battle window.
   *  4. THE OBSERVABLE IS A BODY THAT LIVES OR DIES. Luminous Arc deals 6 to
   *     your own attacking 3/3. Negated, it is still standing, undamaged.
   *     Not negated, it is a corpse in your bin — and it is YOUR unit, on your
   *     half of the board, which is the loudest place for a wrong answer to
   *     show up.
   */
  'rebuke-refused': {
    id: 'rebuke-refused',
    card: 'Necromantic Rebuke',
    why: 'the NEGATE half, which no play-through has ever reached: the ransom is an option-0 '
      + 'decision and every driver — the drill and this tester\'s own scripted bot — pays it. '
      + 'Targeting your OWN effect is what puts the refusal in the owner\'s hands without a '
      + 'second tab; whether that targeting should be legal at all is itself a ruling.',
    expect:
      'You are in the after-combat window. Two of your units traded with two of theirs, so your\n'
      + 'BIN holds two The Foretolds — Necromantic Rebuke needs a bin, because X is paid out of\n'
      + 'it. One attacker of yours (a 3/3 The Foretold) survived, and it is the only unit in the\n'
      + 'battle.\n'
      + '1. Play Luminous Arc — 6 damage, and your own 3/3 is its only legal target. Let it sit\n'
      + '   on the stack.\n'
      + '2. Play Necromantic Rebuke. It first asks how many cards to erase from your bin: pick\n'
      + '   ONE The Foretold, then "That\'s enough — X = 1". (Stopping at X = 0 is legal and\n'
      + '   negates nothing — the card warns you itself.)\n'
      + '3. It then asks what to negate: choose Luminous Arc — your own.\n'
      + '4. Pass, so the Rebuke resolves. It now offers YOU the ransom, because you control the\n'
      + '   effect it is negating. Choose "let it be negated" — NOT "erase 1".\n'
      + 'EXPECTED: your The Foretold is still on the board, at 3/3 with no damage, and the log\n'
      + 'says "Luminous Arc is negated". Your bin loses exactly ONE card (the cast cost) —\n'
      + 'refusing the ransom must not erase a second.\n'
      + 'If The Foretold dies, the refusal was not honoured.',
    initiative: YOU,
    you: {
      hand: ['Luminous Arc', 'Necromantic Rebuke'],
      // THREE bodies, because the bin has to be stocked and this is the only
      // honest way to stock it. `ScenarioSide` has no `bin` field, and a
      // prologue may NOT play cards out of hand to fill one:
      // `186-scenario-library` §1 asserts the dealt hand still equals
      // `sc.you.hand` after the prologue has run, so a prologue that spends a
      // card turns the whole library red. Units that DIE, on the other hand,
      // put their cards in the bin for free — so two of these three trade with
      // the opponent's two in the prologue's combat and the third walks out of
      // it unblocked.
      //
      // ⚠ THE BIN NEEDS 2X, NOT X. The cast cost erases X, and the ransom is
      // only OFFERED when the payer's bin still holds X (`bin.length >= x`).
      // With a bin of exactly 1 and X = 1 the cast empties it, no ransom is
      // offered, and the negate happens with no decision at all — which would
      // silently turn this into a different scenario.
      play: [{ card: 'The Foretold' }, { card: 'The Foretold' }, { card: 'The Foretold' }],
      // Luminous Arc r/2, Necromantic Rebuke dd/2. Double the bill in both.
      resources: { fire: 4, dark: 4 },
    },
    // two blockers, and 3/3 into 3/3 kills both ways — which is what puts a
    // card in each bin. Blank-text units, so nothing here radiates anything.
    opponent: {
      hand: [],
      play: [{ card: 'The Foretold' }, { card: 'The Foretold' }],
      resources: { earth: 2 },
    },
    prologue: (ids) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      // three columns, two of which will be blocked. A DECLINED attack would
      // end the round immediately and never open a battle window at all.
      { type: 'declareAttack', seat: YOU, columns: [[ids.you[0]!], [ids.you[1]!], [ids.you[2]!]] },
      // the attack window closes only when BOTH seats pass; the block step is
      // behind it
      { type: 'passPriority', seat: YOU },
      { type: 'passPriority', seat: OPPONENT },
      { type: 'declareBlocks', seat: OPPONENT, blocks: { 0: [ids.opponent[0]!], 1: [ids.opponent[1]!] } },
      // and the block window closes the same way, into combat damage: four
      // 3/3s die, two per bin, and the unblocked third takes them to 27
      { type: 'passPriority', seat: YOU },
      { type: 'passPriority', seat: OPPONENT },
    ],
    phase: 'battle',
    priority: YOU,
    // seat 1 never has to do anything but pass. Driven end to end empty.
    needsLiveOpponent: false,
  },

  /**
   * WHY THIS CARD (R218).
   *
   * `unreached.ts` — "BOARD — 'gain control of target unit IF IT HAS a -1/-1
   * counter on it' at the after-combat step. The minus counters the fixture
   * places do not survive to that step on a unit that is still a legal
   * target."
   *
   *  1. Printed: "After combat, gain control of target unit if it has a -1/-1
   *     counter on it." R157 §15 / R161 is the owner's own ruling on it,
   *     verbatim: *"The wording is such that you can target any enemy, it only
   *     checks whether you gain control of it on resolution."* So the menu is
   *     every unit in the battle, and the counter is looked for once, at
   *     resolution.
   *  2. WHAT THE SUITE COVERS. 25-wood-c has one test per half from a
   *     hand-built board. The drill has never reached either: it cannot keep a
   *     -1/-1 counter alive on a legal target all the way to the after-combat
   *     step. This scenario builds exactly that precondition and nothing else.
   *  3. THE OBSERVABLE IS A UNIT CHANGING SIDES, and there are two enemy
   *     bodies so a wrong answer has somewhere else to point. The Hammer of
   *     Justice wears the -1/-1 counter (a 10/3 printed, 9/2 here); The
   *     Foretold is clean. Correct: the Hammer is on YOUR half of the board.
   *     Wrong, and visibly so: it stays theirs (the counter was not seen), or
   *     The Foretold comes over instead (the condition is not being checked at
   *     all), or your own Harvester is the one that moves.
   *  4. Both enemy units are blank-text cards. Nothing on that side of the
   *     board can do anything to muddy which clause moved the unit.
   */
  'stellarspore-steals': {
    id: 'stellarspore-steals',
    card: 'Stellarspore Harvester',
    why: 'the after-combat control theft, whose precondition the drill has never been able to '
      + 'build — a -1/-1 counter still standing on a still-legal target when the after-combat '
      + 'step arrives. R157 §15 ruled the condition is checked at RESOLUTION ONLY, so this is '
      + 'also the owner re-reading his own ruling on a live board.',
    expect:
      'Your Stellarspore Harvester is attacking and they have already declined the block. The\n'
      + 'clause fires after combat damage.\n'
      + '1. Pass. Combat damage happens (they go to 27) and the after-combat step opens.\n'
      + '2. Harvester asks for a target. Choose HAMMER OF JUSTICE — their 9/2, the one carrying\n'
      + '   the -1/-1 counter. (Their other unit, The Foretold, is clean; the menu offers it,\n'
      + '   and your own Harvester, on purpose.)\n'
      + '3. Pass once more so the ability resolves.\n'
      + 'EXPECTED: the Hammer of Justice is now YOURS — it moves onto your side of the board,\n'
      + 'still a 9/2 with its counter. The Foretold stays theirs.\n'
      + 'If nothing changes hands, or the wrong unit does, that is the failure.',
    initiative: YOU,
    you: {
      hand: [],
      // 3/5. It has to ATTACK: the after-combat event is scoped to the battle
      // region (R12), and a Harvester standing at home never hears it. That is
      // the R199 family's whole lesson and it is why this board has a real
      // attack in it rather than a declined one.
      play: [{ card: 'Stellarspore Harvester' }],
      // nothing to pay for — the clause is a trigger, not a cost. Kept anyway
      // so the seat is not visibly resourceless.
      resources: { wood: 4 },
    },
    opponent: {
      hand: [],
      // -1 counters, i.e. a -1/-1 counter. Blank-text cards both, so nothing
      // here radiates anything at the clause under test.
      play: [{ card: 'Hammer of Justice', counters: -1 }, { card: 'The Foretold' }],
      resources: { earth: 2 },
    },
    prologue: (ids) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: YOU, columns: [[ids.you[0]!]] },
      // the attack window closes only when BOTH seats pass, and the block step
      // sits behind it. Declining the block in the prologue rather than
      // leaving it to the bot costs the owner one click less and puts him
      // straight in the window where his single pass IS the combat.
      { type: 'passPriority', seat: YOU },
      { type: 'passPriority', seat: OPPONENT },
      { type: 'declareBlocks', seat: OPPONENT, blocks: {} },
    ],
    phase: 'battle',
    priority: YOU,
    // seat 1 only ever passes from here. Driven end to end empty.
    needsLiveOpponent: false,
  },

  /**
   * WHY THIS CARD (R218).
   *
   * `unreached.ts` — "BOARD — 'cards your opponents play during battle gain
   * [Sacrifice a unit]'. It grants a COST to somebody else's cards; the drill
   * never has the opponent play a card while the augment is on."
   *
   *  1. Printed: "[Augment] Cards your opponents play during battle gain
   *     '[Sacrifice a unit]'." R122's third CostMod channel: an IMPOSED
   *     bracketed additional cost on somebody else's PLAYS, paid in the cast
   *     window before the card reaches the stack.
   *  2. ⚠ THIS ONE HONESTLY NEEDS THE SECOND TAB, and there is no version of
   *     it that does not. The clause only ever fires on a card the OPPONENT
   *     plays, and the scripted bot's entire contract is that it never plays a
   *     card (186-scenario-library §2 asserts it). A scenario that pretended
   *     otherwise would open a board where nothing can happen — docs/14 §4's
   *     expensive mistake exactly. So the prologue hands the table to seat 1
   *     with everything already set up: the second tab is two clicks.
   *  3. AND THE [Augment] HOST PATH CANNOT DIFFER HERE, which is worth
   *     recording rather than testing. Vengeance is not a {Virus}, so
   *     `doAugment` will only attach it to a unit in your OWN region — the
   *     anchor's controller is you whether the text is on its own body or on a
   *     host, so "your opponents" resolves the same way on every legal board.
   *     45-hybrids-ld-b's "donated" test augments it onto the caster's own
   *     Ignis Sprite for the same reason. This scenario therefore puts the
   *     card on the board as itself and spends the owner's time on the clause
   *     that CAN be wrong.
   *  4. THE OBSERVABLE IS A DEMAND, then a body gone. The opponent is asked
   *     "sacrifice a unit" before their spell is allowed onto the stack, they
   *     pick one of their two, and it dies. A wrong answer is a card that just
   *     plays for free — and if the demand ever lands on YOU instead, the
   *     "your opponents" side of the clause is backwards.
   */
  'vengeance-taxes-their-play': {
    id: 'vengeance-taxes-their-play',
    card: 'Vengeance',
    why: 'the imposed [Sacrifice a unit] on somebody ELSE\'s play — never once observed in a '
      + 'play-through, because no driver in the repo has the opponent play a card while the '
      + 'augment is live. The scripted bot cannot do it either, which is why this is the one '
      + 'scenario in batch B that really does want the second tab.',
    expect:
      'NEEDS BOTH SEATS — open the opponent in a second tab (seat 1). Your Vengeance is\n'
      + 'attacking, so its text is standing in the battle it is taxing, and the opponent holds\n'
      + 'priority and one card.\n'
      + '1. In the OPPONENT\'s tab, play Sudden Bloom.\n'
      + 'EXPECTED: before that spell is allowed onto the stack they are asked to SACRIFICE A\n'
      + 'UNIT, and offered their two — The Foretold and Bubb. Pick either; it dies to their bin\n'
      + 'and only then does Sudden Bloom go on the stack.\n'
      + 'If the card just plays for free, the imposed cost is not being granted. If YOU are the\n'
      + 'one asked to sacrifice, "your opponents" is being read from the wrong side.',
    initiative: YOU,
    you: {
      hand: [],
      // 7/9. It has to ATTACK for the same R12 reason the Harvester does: a
      // cost modifier radiates in the region its carrier stands in, and the
      // battle is being fought in the opponent's.
      play: [{ card: 'Vengeance' }],
      resources: { light: 2 },
    },
    opponent: {
      // wood/1, targetless, and its only effect is a buff on units that are
      // not fighting — so the sacrifice is the only thing that happens
      hand: ['Sudden Bloom'],
      // TWO, so the sacrifice is visibly a choice rather than a forced tax on
      // an only child — and so the "they control none, so the play is refused"
      // edge (a different clause) is nowhere near this board
      play: [{ card: 'The Foretold' }, { card: 'Bubb' }],
      resources: { wood: 4 },
    },
    prologue: (ids) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: YOU, columns: [[ids.you[0]!]] },
      // hand the window straight to seat 1, so the second tab's very first
      // click is the play under test
      { type: 'passPriority', seat: YOU },
    ],
    phase: 'battle',
    priority: OPPONENT,
    // HONESTLY true (docs/14 §4): the clause cannot fire on anything the
    // scripted bot is willing to do.
    needsLiveOpponent: true,
  },

  /**
   * WHY THIS CARD (R218).
   *
   * `unreached.ts` — "BOARD — 'skip your draft step' only exists in a drafted
   * game; the drill plays constructed." It is also one of the FIVE entries
   * written as a bare unquoted key, which is how the queue's first scrape lost
   * it (see that file's header). Nothing is wrong with the card; it is just
   * under-looked-at.
   *
   *  1. Printed: "Skip your draft step. When you do, draw a card. You also
   *     lose 3 life if playing a constructed format." The engine implements it
   *     as `replaceCardStep`, and the arithmetic is the OWNER'S OWN, from
   *     playtest report #87 (room XVUR): *"The way it works in constructed and
   *     cube: instead of drawing 4 and recycling 2, you draw 2 for turn + 1
   *     for Worldbender and lose 3 life."* R162 then folded 'shared' — which
   *     is the mode every scenario room is dealt in — into that same branch.
   *  2. WHAT THE SUITE COVERS. 28-metal-c has seven tests, including both
   *     format branches and a byte-for-byte replay. What no fixture does is
   *     put a human in front of the moment: the card step is turn STRUCTURE,
   *     it happens between two of the owner's clicks, and whether it reads as
   *     the printed sentence is a judgement only he can make.
   *  3. THE OBSERVABLE IS ASYMMETRIC, WHICH IS WHY IT IS A GOOD ONE. Your
   *     hand goes from EMPTY to exactly 3 and your life from 30 to 27, while
   *     the opponent — same turn, same table — draws 2 and stays on 30. Every
   *     wrong reading lands somewhere visibly different: the DRAFT branch
   *     would give you 1 card and no life loss; not firing at all gives you 2
   *     cards and 30 life; firing twice would take 6.
   *  4. The card is PLAYED, not placed, so this also proves a 2-mana body can
   *     be deployed and have its replacement live on the very next turn.
   */
  'worldbender-card-step': {
    id: 'worldbender-card-step',
    card: 'Worldbender',
    why: 'the replaced card step, never observed in a play-through: the drill never crosses a '
      + 'turn boundary with it in play. Scenario rooms are dealt in mode shared, which R162 '
      + 'folded into the CONSTRUCTED branch — so this is also the live check on that ruling '
      + '(3 cards and 3 life, not the draft branch\'s 1 card and no life).',
    expect:
      'You are in DEPLOYMENT with an empty hand. Worldbender replaces your card step for as\n'
      + 'long as it is in play, so the thing to watch for happens at the START OF NEXT TURN.\n'
      + '1. Play Worldbender (mm/2 — a 2/2 {Feeble} body).\n'
      + '2. Click done deploying. The opponent is already done, so the turn rolls over.\n'
      + 'EXPECTED, the instant the new turn starts: your hand goes from 0 cards to exactly\n'
      + 'THREE, and your life drops 30 → 27. The opponent draws 2 and stays on 30.\n'
      + 'Two cards and no life lost means it never fired; one card and no life lost is the\n'
      + 'DRAFT branch happening in a non-draft game.',
    initiative: YOU,
    you: {
      hand: ['Worldbender'],
      play: [],
      // mm/2. Six is three times the bill.
      resources: { metal: 6 },
    },
    opponent: { hand: [], play: [], resources: { metal: 2 } },
    prologue: () => [
      // planning → battle → two declined rounds → deployment, then seat 1
      // finishes deploying, so the turn rolls on the OWNER's click and he sees
      // it happen. Attacker seats hardcoded — see the note on
      // `automaton-augmented-batch`.
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: YOU, columns: [] },
      { type: 'declareAttack', seat: OPPONENT, columns: [] },
      { type: 'doneDeploying', seat: OPPONENT },
    ],
    phase: 'deploy',
    priority: null,
    // seat 1 is already finished by the prologue; the bot has nothing left to
    // do and the turn rolls on the owner's own click.
    needsLiveOpponent: false,
  },
};
