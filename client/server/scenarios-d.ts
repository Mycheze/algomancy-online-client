/* R218 — scenario batch D. See scenarios.ts for the type and the worked
 * example (`lithoghul-donated`), and docs/14-scenario-tester.md for why any of
 * this exists. Authored as a batch so parallel authors never share a file.
 *
 * ── WHAT THESE SIX HAVE IN COMMON ────────────────────────────────────────
 *
 * Every card here is an entry in `ledgers/unreached.ts` — the drill has
 * never once watched its printed promise be delivered through the real action
 * path. That is NOT the same as "untested": five of the six have a hand-built
 * unit test that asserts the clause from a state somebody typed. What has
 * never happened is the clause being reached by PLAYING, and docs/14 §1 is
 * about exactly that gap ("a sweep asks the question you thought to ask; a
 * game asks the question you didn't"). So each `why` below names the unit test
 * AND the precondition the drill could not build, because those are different
 * claims and collapsing them would overstate what these scenarios buy.
 *
 * ⚠ ONE ENGINE BEHAVIOUR SHAPED THREE OF THESE BOARDS, and it is worth having
 * written down where the next author will trip over it. `E.fireEvent` scopes
 * its listeners to the REGION the event happened in (R12). A card standing at
 * home therefore DOES NOT HEAR a spell played in the other seat's region — so
 * `Stalwart Sentinel`, sitting at home while a battle is fought away, never
 * fires however many cards you play from your bin. Measured, not assumed:
 * the same board with Sentinel ATTACKING (and so standing in the battle's
 * region) fires it every time. Nothing in Sentinel's printed text says
 * "region", so this is R12's blanket rule doing it, and it is why Sentinel
 * attacks in scenario 20 and why Proph's from-elsewhere play happens in
 * DEPLOYMENT (which resolves at home) in scenario 25.
 *
 * ── THREE MORE THINGS THAT COST SOMEBODY A ROUND ELSEWHERE ───────────────
 *
 * ⚠ THE HASTE STEP. `Scenario.prologue`'s own comment says `dealScenario`
 * "skips it if it is open anyway" — `runPrologue` does no such thing, and a
 * prologue that walks into a battle with the haste step still open is refused.
 * It engages (R18) whenever EITHER seat holds a payable {Haste} card, so it is
 * a function of the hands THESE scenarios declare and of nothing else. Two of
 * them (23, 24) stop inside it on purpose — that step is the window the clause
 * fires at the end of, so the owner plays the haste card and closes the step
 * himself. The other four hold no haste card in either hand, so it never opens
 * and no `doneHaste` belongs in their prologues. Adding a {Haste} card to any
 * of those four hands breaks its prologue; the declaration guard catches it.
 *
 * ⚠ NOTHING HERE IS ATTACHED AS AN AUGMENT, and that is not laziness about the
 * four [Augment] cards below. `doAugment` refuses outside a deployment action
 * unless the card is a {Virus} ("modding is a deployment action, or a battle
 * Virus") — Lithoghul can be donated mid-battle because it is one, and none of
 * Stalwart Sentinel, Hooba-Lan, Keeper of Tithes or Debt Plant is. They do not
 * need to be attached: a card's own [Augment] text is live while it is a BODY
 * in play (`E.fireEvent` collects `def.augmentText` off the face as well as off
 * each mod — "active when played normally (Manual Q&A)"), and all four were
 * driven that way. The donated reading of each is a different clause and wants
 * its own scenario.
 *
 * ⚠ SEED INDEPENDENCE, MEASURED. `/api/scenario/open` takes `&seed=`, and a
 * board that changes with it would work when it was written and be something
 * else when the owner opened it. None of these prologues crosses a turn
 * boundary (which would draw fresh cards and make the hand a function of the
 * deck). Checked rather than argued: at eight seeds each, all six deal to ONE
 * distinct opened board — phase, priority, both hands, both bins, both caches,
 * both resource rows, every unit's live stats, and the owner's legal moves —
 * and drive to ONE distinct set of observables. The only seed-dependent thing
 * anywhere in the batch is WHICH card Proph draws, and scenario 25's observable
 * is deliberately the COUNT (empty → one), never the name.
 */
import type { Scenario } from './scenarios.ts';
import type { Seat } from '../engine/src/types.ts';

/* ⚠ NOT `import { YOU, OPPONENT } from './scenarios.ts'`, which is the obvious
 * thing to write and CRASHES THE SERVER ON STARTUP. scenarios.ts imports this
 * module to spread `BATCH_D`, so the cycle runs this file's body FIRST — and
 * the object literal below is evaluated at load, while scenarios.ts's own
 * `export const YOU` is still in its temporal dead zone. "Cannot access 'YOU'
 * before initialization", at import time, before any route exists. The TYPE
 * import is erased and is safe; the values are not. Same two constants, same
 * two numbers, pinned to the same convention by 186-scenario-library. */
const YOU: Seat = 0;
const OPPONENT: Seat = 1;

export const BATCH_D: Record<string, Scenario> = {
  /**
   * WHY THIS CARD (R218, queue #20).
   *
   * Printed: "[Augment] When you play a card from anywhere other than your
   * hand, put two +1/+1 counters on me."
   *
   * `unreached.ts` files it as BOARD: "the same play-from-elsewhere
   * precondition as Proph… Every press play is from hand; there is no bin- or
   * cache-play fixture." The drill has never once played a card out of a
   * non-hand zone, so this clause has never fired in a real game.
   *
   * WHAT THE SUITE DOES AND DOES NOT COVER. Three tests exercise it from a
   * hand-built state — `38-light-a` (cache), `105-semantics-playwatch` (bin,
   * plus R37's "a mod applied from the bin is not a play"), `139-spawn-and-play`
   * (Wake the Dead). All three `spawn()` the Sentinel and `h.do()` the play.
   * None of them is a game: no priority, no battle window, no real cost, and —
   * see the header — none of them can notice that a Sentinel at home hears
   * nothing at all while the battle is elsewhere.
   *
   * WHY THE OBSERVABLE IS UNAMBIGUOUS. The scenario plays THE SAME CARD TWICE,
   * once out of the hand and once out of the bin, in one battle window. The
   * only difference between the two plays is the ZONE, which is the only thing
   * the clause is about. A wrong reading does not hide: if the trigger fired on
   * hand plays too, the counters appear on step 1 — one step early and before
   * the bin ever comes into it; if it never fires, the Sentinel is still 1/1
   * after step 2. Abyssal Evocation is used for both plays precisely because it
   * TARGETS NOTHING, so there is no target menu to mis-click and no unit dying
   * to read past — the counter badge is the only thing on screen that moves.
   *
   * ⚠ NOT under test here, deliberately: the DONATED path (Sentinel as a mod
   * on a host, where "me" is the host). docs/13 §1③ names that family as the
   * biggest hole and `lithoghul-donated` is the scenario for it; one card, one
   * clause (docs/14 §5), and the zone clause is the one the ledger names.
   */
  'stalwart-sentinel-from-bin': {
    id: 'stalwart-sentinel-from-bin',
    card: 'Stalwart Sentinel',
    why: 'the played-from-elsewhere clause, through the real action path. '
      + '`unreached.ts` files it BOARD: the drill plays every card from hand, '
      + 'so this trigger has never fired in a game. The three tests that do '
      + 'reach it all hand-build the state — and none of them can see that a '
      + 'Sentinel standing at home hears nothing while the battle is away.',
    expect:
      'Stalwart Sentinel is attacking, so it is standing in the battle. It cares '
      + 'about WHERE a card was played from, not what the card does.\n'
      + '1. Play Abyssal Evocation from your HAND, then pass so it resolves. It '
      + 'goes to your bin and grants you bin plays for this battle.\n'
      + '   The Sentinel must NOT move — that play came from your hand.\n'
      + '2. Play THE SAME Abyssal Evocation again, this time out of your BIN.\n'
      + 'EXPECTED: Stalwart Sentinel picks up two +1/+1 counters and reads 3/3. '
      + 'Same card, same battle, same window — only the zone differs, and only '
      + 'the second play may move it. If it grew on step 1 the trigger is too '
      + 'wide; if it never grows, it is not hearing bin plays at all.',
    initiative: YOU,
    you: {
      // the Sentinel itself is the attacker, and that is load-bearing rather
      // than flavour: see the file header on R12. A 1/1 attacking into a 5/6
      // is safe here because the scripted bot declines every block.
      hand: ['Abyssal Evocation'],
      play: [{ card: 'Stalwart Sentinel' }],
      // Abyssal Evocation is r/4 and is paid for TWICE (hand, then bin) = 8,
      // with fire affinity 2 needed for its "rr" pips. Twelve is deliberate
      // over-provision: a scenario that dies on mana is a `bad scenario`
      // verdict about the wrong thing (docs/14 §9).
      resources: { fire: 12 },
    },
    opponent: {
      hand: [],
      // one inert body so the board does not read as degenerate. Bubb is
      // vanilla (no text at all) — deliberately NOT Towering Colossus, whose
      // own [Augment] line ("Enemies gain +2/+2") is live while it is a body
      // in play and would push the Sentinel to 3/3 before a single counter
      // landed, which is the exact reading this scenario has to keep clean.
      play: [{ card: 'Bubb' }],
      resources: { earth: 2 },
    },
    prologue: (ids, _s) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: YOU, columns: [[ids.you[0]!]] },
    ],
    phase: 'battle',
    priority: YOU,
    // checked by hand: seat 1 only ever passes and declines a block here.
    needsLiveOpponent: false,
  },

  /**
   * WHY THIS CARD (R218, queue #21). ⚠ THIS ONE IS A QUESTION, NOT AN ACCUSATION.
   *
   * Printed: "[Augment] When I attack or block, create a Shard. (It will spawn
   * dormant.)"
   *
   * `unreached.ts` files it VOCAB, which is the one opener that does not
   * accuse the card of anything: "'create a Shard' makes a RESOURCE and emits
   * `resourceActivated`. EVIDENCE.create is tokenCreated/spawned." The card
   * does the thing; the engine announces the thing; the CHECKER simply has no
   * word for that announcement. And the ledger's own ⚠ says the fix must not
   * be to widen EVIDENCE — "create a Shard" evidenced by `resourceActivated`
   * would let a card promising "create a 2/2 unit" pass by making a resource.
   *
   * So this scenario is not asking "is Hooba-Lan broken". It is asking the one
   * person who can answer: IS A DORMANT SHARD IN THE RESOURCE ROW THE WHOLE OF
   * WHAT THIS CARD PROMISES? A "works" verdict here retires the entry as a
   * checker-vocabulary problem and nothing more. A "slightly off" says the
   * Shard is arriving in the wrong state, the wrong row, or the wrong number.
   *
   * WHAT THE SUITE COVERS: `16-earth-a` has one test ("attacking creates a
   * real dormant Shard for its controller") on a hand-built board. The drill
   * cannot corroborate it because no EVIDENCE row names `resourceActivated`,
   * which is the whole entry — so the unit test and the whole-pool sweep
   * disagree about whether this card has ever been seen to work, and only a
   * human can break that tie.
   *
   * WHY THE OBSERVABLE IS UNAMBIGUOUS. The owner's resource row is three cards
   * before he clicks and four after, and the fourth is a face-down (dormant)
   * card carrying the small "S" chip that `ui/main.ts:resHtml` gives a shard.
   * Three, not eleven, exactly so the new one is countable at a glance. The
   * blocking half of the same trigger is not under test (it would need a live
   * opponent to attack him — docs/14 §4), and the attacking half is the half
   * the ledger's evidence line is about.
   */
  'hooba-lan-attack-shard': {
    id: 'hooba-lan-attack-shard',
    card: 'Hooba-Lan',
    why: 'PROBABLY CORRECT — please confirm. `unreached.ts` files this VOCAB, '
      + 'which means the card really creates the Shard and the engine really '
      + 'announces it, but the announcement is `resourceActivated` and the '
      + "checker's vocabulary for \"create\" has no word for it. Nobody has ever "
      + 'watched it happen in a game, so a "works" here retires the entry as a '
      + 'checker problem rather than a card problem.',
    expect:
      'Hooba-Lan is a 3/4 sitting in your formation, and you have exactly three '
      + 'resources. Count them before you click.\n'
      + '1. Declare an attack with Hooba-Lan (it is your only attacker).\n'
      + '2. Pass, so its trigger resolves.\n'
      + 'EXPECTED: your resource row goes from THREE cards to FOUR. The new one '
      + 'is face-down (dormant) with a small S on it; hovering reads "shard '
      + '(dormant)". The log says: You creates a Shard (Hooba-Lan) — dormant.\n'
      + 'THE QUESTION FOR YOU: is that the whole of "create a Shard"? Right '
      + 'state, right owner, exactly one? If yes, this card is fine and it is '
      + 'our checker that cannot see it.',
    initiative: YOU,
    you: {
      hand: [],
      play: [{ card: 'Hooba-Lan' }],
      // THREE, and not a comfortable pile: the observable IS the length of
      // this row, so it has to stay countable. Nothing in this scenario is
      // paid for, so there is nothing to over-provision for.
      resources: { earth: 3 },
    },
    opponent: {
      hand: [],
      play: [{ card: 'Bubb' }],   // vanilla; the bot will decline to block it
      resources: { earth: 2 },
    },
    // stops BEFORE the attack: the attack is the clause's trigger, so it has
    // to be the owner's own click rather than something the deal did for him.
    prologue: (_ids, _s) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
    ],
    phase: 'battle',
    // the declare step holds no priority — attacks are declared, not
    // prioritised, and `legalActions` offers declareAttack to the attacker.
    priority: null,
    needsLiveOpponent: false,
  },

  /**
   * WHY THIS CARD (R218, queue #22).
   *
   * Printed: "Negate target spell effect if its cost is less than or equal to
   * the greatest amount of life lost by a player in this battle."
   *
   * `unreached.ts` files it CHOICE: "No life has been lost in the bait battle,
   * so the threshold is 0 and no cost clears it." The drill therefore watches
   * this card decline to negate, every single time, and records that as the
   * clause not being reached. THE BRANCH IT HAS NEVER TAKEN IS THE ONE WHERE
   * THE NEGATE ACTUALLY HAPPENS, and that is the entire content of this board.
   *
   * WHAT THE SUITE COVERS: `14-water-a` negates a cost-1 spell under 2 life
   * lost; `133-x-cost-semantics` confirms R157 §1 (an X spell's cost is the
   * paid X); `96-x-preview` checks the three preview rows. All hand-built.
   * Nothing has ever set the threshold by ACTUALLY LOSING LIFE in a battle a
   * player was playing.
   *
   * WHY THE OBSERVABLE IS UNAMBIGUOUS, and why the numbers are these numbers.
   * The board is arranged so cost and threshold are EXACTLY EQUAL — a
   * Seismomancy (mana 3) is negated under exactly 3 life lost. That puts the
   * printed "less than or EQUAL to" on the boundary, which is the one place a
   * `<`/`≤` slip is visible at all. And the outcome is two different numbers on
   * the opponent's life total rather than an absence: negate correctly and they
   * sit on 27; miss, and the second Seismomancy resolves and they go to 24. The
   * engine also narrates whichever branch it took, in as many words.
   *
   * ⚠ The threshold is "life lost by A PLAYER" — the max over both seats. Here
   * only the opponent has lost any, so a reading that counted only the CASTER's
   * losses would find 0 and refuse the negate. That is the same wrong-answer-
   * points-elsewhere property `lithoghul-donated` was built around.
   */
  'null-drone-negates': {
    id: 'null-drone-negates',
    card: 'Null Drone',
    why: 'the negate BRANCH, which the drill has never taken. `unreached.ts` '
      + 'files it CHOICE: the bait battle has 0 life lost, so the threshold is '
      + '0 and nothing ever clears it. This board loses exactly 3 life first '
      + 'and then aims the Drone at a cost-3 spell, so "less than or EQUAL to" '
      + 'is on its boundary.',
    expect:
      'You are attacking. Everything here happens in one battle window, in order.\n'
      + '1. Play Seismomancy and aim it at the OPPONENT HIMSELF (the menu row '
      + 'that reads just "Tester Bot", not the one that reads "(Tester Bot\'s)"). '
      + 'Pass so it resolves: they go 30 → 27. Three life have now been lost in '
      + 'this battle.\n'
      + '2. Play your second Seismomancy at the opponent as well — and this time '
      + 'DO NOT pass. Leave it on the stack.\n'
      + '3. Play Null Drone. It offers exactly one target: the Seismomancy on '
      + 'the stack. Take it. Then pass until the stack empties.\n'
      + 'EXPECTED: the Seismomancy is NEGATED and the opponent stays on 27. Its '
      + 'cost is 3 and 3 life have been lost, so "less than or equal to" is met '
      + 'exactly. If they drop to 24, the negate did not happen — and the log '
      + 'will say what number the Drone thought it was comparing against.',
    initiative: YOU,
    you: {
      hand: ['Seismomancy', 'Seismomancy', 'Null Drone'],
      // an attacker, so there is a battle window to hold this in. It is not
      // part of the clause and is expected to do nothing but stand there.
      play: [{ card: 'The Foretold' }],
      // Seismomancy is e/3 twice (needs earth affinity 2), Null Drone is b/2.
      // Ten and six against a bill of six and two.
      resources: { earth: 10, water: 6 },
    },
    opponent: {
      hand: [],
      play: [{ card: 'Bubb' }],
      resources: { earth: 2 },
    },
    prologue: (ids, _s) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: YOU, columns: [[ids.you[0]!]] },
    ],
    phase: 'battle',
    priority: YOU,
    // seat 1 passes through all three plays; verified by driving it.
    needsLiveOpponent: false,
  },

  /**
   * WHY THIS CARD (R218, queue #23).
   *
   * Printed: "[Augment] At the end of [Haste], if X is not 0, create an X/X
   * unit, where X is the number of expended resources you have."
   *
   * `unreached.ts` files it BOARD, and the entry is unusually precise about
   * why: "`fundSeat` refills the seat with OPEN resources at every window, so
   * X is always 0. The trigger fires, resolves and says so." The drill's own
   * funding makes the card a no-op — it is the fixture that cannot build the
   * precondition, not the card.
   *
   * WHAT THE SUITE COVERS: `38-light-a` has both halves (X≠0 and the X=0
   * announcement) from a hand-built state where the resources were marked
   * expended by the test. Nobody has ever expended one by BUYING something.
   *
   * WHY THE OBSERVABLE IS UNAMBIGUOUS, and why the numbers are these numbers.
   * The owner spends exactly 3 on a haste card and is left holding 8 open, out
   * of 11 total. Three plausible misreadings each name a DIFFERENT body on the
   * table: counting expended (right) mints a 3/3, counting open mints an 8/8,
   * counting the whole row mints an 11/11, and counting nothing mints nothing
   * and says so in the log. No two of those look alike from across the room —
   * which is the property this instrument is for, and the reason the pool is
   * lopsided (3 vs 8) rather than tidy.
   */
  'keeper-of-tithes-expended': {
    id: 'keeper-of-tithes-expended',
    card: 'Keeper of Tithes',
    why: 'X is the number of EXPENDED resources, and the drill can never make '
      + 'X anything but 0 — `unreached.ts` files it BOARD because `fundSeat` '
      + 'refills the seat with open resources at every window. Here the owner '
      + 'expends three of eleven by actually paying for something, so the right '
      + 'answer and the three wrong ones are four different bodies.',
    expect:
      'You are in the Haste step. Keeper of Tithes is already on the table, and '
      + 'all eleven of your resources are open.\n'
      + '1. Play Tidal Menace (a Haste card, costs 3). That expends 3 of your 11 '
      + 'resources — they turn sideways — and leaves 8 open.\n'
      + '2. Click done with the Haste step.\n'
      + 'EXPECTED: Keeper of Tithes triggers and creates a 3/3 token, because X '
      + 'is the number of EXPENDED resources and you expended three.\n'
      + 'It must not be an 8/8 (that would be the open ones), an 11/11 (the whole '
      + 'row), or nothing at all (X read as 0).',
    initiative: YOU,
    you: {
      hand: ['Tidal Menace'],
      play: [{ card: 'Keeper of Tithes' }],
      // Tidal Menace is b/3, so the water pays it and the earth cannot be
      // mistaken for change. 3 spent, 8 left — see the comment above on why
      // the split is lopsided rather than tidy.
      resources: { water: 3, earth: 8 },
    },
    opponent: {
      hand: [],
      play: [{ card: 'Bubb' }],
      resources: { earth: 2 },
    },
    // R18: the haste step only engages when somebody holds a payable haste
    // card. Tidal Menace in hand is what opens it — the opponent holds none,
    // so seat 1 is marked done the moment the step opens and the bot has
    // nothing to do here at all.
    prologue: (_ids, _s) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
    ],
    // the haste step lives INSIDE the planning phase (apply.ts: the
    // `e.s.phase === 'planning'` arm of playAtTiming is the haste-step arm),
    // and it is gated on `hasteDone` rather than on priority.
    phase: 'planning',
    priority: null,
    needsLiveOpponent: false,
  },

  /**
   * WHY THIS CARD (R218, queue #24).
   *
   * Printed: "[Augment] At the end of [Haste], your units gain +1/+1 until
   * regroup for every 2 expended resources you have."
   *
   * `unreached.ts` files it BOARD with one line — "the same expended-resource
   * count as Keeper of Tithes, and the same X = 0" — and that shared blocker is
   * exactly why both are in this batch. They are NOT the same clause, though,
   * and the difference is the whole reason this one is worth ninety seconds:
   * Keeper counts, this one DIVIDES. "For every 2" is the only arithmetic in
   * either card, and rounding is where arithmetic goes wrong.
   *
   * WHAT THE SUITE COVERS: `44-hybrids-ld-a` has the bonus and the
   * fewer-than-2 case, both from a hand-built state. Neither is a division
   * with a remainder.
   *
   * WHY THE OBSERVABLE IS UNAMBIGUOUS, and why the number is SEVEN. Seven is
   * odd on purpose: 7/2 is 3.5, so the printed "for every 2" has to floor it to
   * +3/+3. Round the wrong way and it is +4/+4. Count per resource instead of
   * per two and it is +7/+7. Count the five still OPEN instead and it is +2/+2.
   * Every one of those is a different pair of numbers on a stat line the owner
   * is already looking at, and he has three bodies to read it off rather than
   * one — Debt Plant 3/2, The Foretold 3/3 and the Tithe Enforcer he just
   * played, 4/6. All three must move by the same amount.
   */
  'debt-plant-expended': {
    id: 'debt-plant-expended',
    card: 'Debt Plant',
    why: 'the "+1/+1 for every 2 expended resources" division, with an ODD '
      + 'number of resources expended so the rounding is visible. '
      + '`unreached.ts` files it BOARD for the same reason as Keeper of Tithes '
      + "— the drill's funding leaves nothing expended — but the clause is a "
      + 'different one: this card is the only place in the pair where the '
      + 'engine has to divide.',
    expect:
      'You are in the Haste step. Debt Plant (3/2) and The Foretold (3/3) are on '
      + 'the table, and all twelve of your resources are open.\n'
      + '1. Play Tithe Enforcer (a Haste card, costs 7). It arrives as a 4/6, '
      + 'and 7 of your 12 resources turn sideways. Five stay open.\n'
      + '2. Click done with the Haste step.\n'
      + 'EXPECTED: all three of your units gain exactly +3/+3 until regroup — '
      + 'Debt Plant 6/5, The Foretold 6/6, Tithe Enforcer 7/9. Seven expended is '
      + 'three whole pairs and one left over, and the leftover buys nothing.\n'
      + 'If you see +4/+4 it rounded the half up; +7/+7 means it paid per '
      + 'resource instead of per two; +2/+2 means it counted the five still open.',
    initiative: YOU,
    you: {
      hand: ['Tithe Enforcer'],
      // The Foretold is the second witness and is picked for being genuinely
      // vanilla — no printed text and no attributes, so nothing else can be
      // moving its numbers while the owner reads them.
      play: [{ card: 'Debt Plant' }, { card: 'The Foretold' }],
      // Tithe Enforcer is l/7. Twelve light: seven go, five stay, and the
      // remainder is what makes the flooring visible.
      resources: { light: 12 },
    },
    opponent: {
      hand: [],
      play: [{ card: 'Bubb' }],
      resources: { earth: 2 },
    },
    prologue: (_ids, _s) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
    ],
    phase: 'planning',
    priority: null,
    needsLiveOpponent: false,
  },

  /**
   * WHY THIS CARD (R218, queue #25).
   *
   * Printed: "When you play a card from anywhere other than your hand,
   * [Switch1] Draw a card."
   *
   * `unreached.ts` files it BOARD: "Every press play is from hand; there is no
   * bin- or cache-play fixture." ⚠ Proph is also one of the five entries
   * written in that ledger as a BARE UNQUOTED KEY, which is how an earlier
   * scrape lost it and reported 32 unreached cards where the object holds 37.
   * Nothing is wrong with the card; it has simply been invisible to the thing
   * that picks what to test, twice over.
   *
   * WHAT THE SUITE COVERS: several files name Proph, but `38-light-a` and
   * `39-light-b` are the ones that fire this trigger, and both hand-build the
   * play. `182-correctness-sample` reaches the card but not this branch.
   *
   * ⚠ ROUND-27 Q4 IS STILL OPEN AND IS DELIBERATELY NOT WHAT THIS ASKS. A card
   * played mid-resolution carries no zone marker at all, and Proph's own `when`
   * reads a blank as "not from elsewhere" (`if (from === undefined || from ===
   * 'hand') return false`). Whether that is right is an unanswered question to
   * the owner, not something a scenario should quietly decide for him. So this
   * board uses the CACHE, where the marker is stamped and the ruling is settled
   * (R42/R45), and the `expect` line raises Q4 separately at the end — because
   * ninety seconds in front of the person who can answer it is the cheapest it
   * will ever be to ask.
   *
   * WHY THE OBSERVABLE IS UNAMBIGUOUS. The owner's hand is EMPTY at the moment
   * the clause fires, so the draw is the difference between no cards and one
   * card — not a count he has to keep. And step 2 is a real hand play made
   * immediately before it, from the same hand, in the same phase: if the
   * trigger were too wide he would draw there instead and the hand would never
   * be empty at all. Air Plant's own [Augment] line pumps his other units when
   * it lands; that is loud but harmless, because nothing in this scenario is
   * read off a stat line.
   *
   * The board's four units carry four DIFFERENT printed mana costs (1, 2, 3, 4)
   * and that is not decoration: it is what fulfils Air Plant's printed prophecy
   * ("Your units have four unique costs"), which is what makes the cache
   * release free and immediate instead of a two-turn wait.
   */
  'proph-from-cache': {
    id: 'proph-from-cache',
    card: 'Proph',
    why: 'the played-from-elsewhere draw, out of the CACHE, through the real '
      + 'action path. `unreached.ts` files it BOARD — the drill plays every '
      + 'card from hand — and Proph is additionally one of the five bare-key '
      + 'entries an earlier scrape of that ledger dropped, so it has been '
      + 'invisible to the queue as well as to the drill.',
    expect:
      'It is your deployment. Your hand is two cards; your four units have four '
      + 'different mana costs, which matters in step 1.\n'
      + '1. Prophesy Air Plant (the banner costs 2). It goes to your cache, and '
      + 'the log should say the prophecy is ALREADY fulfilled — "your units have '
      + 'four unique costs" is true right now.\n'
      + '2. Play The Foretold from your HAND. Your hand is now EMPTY, and Proph '
      + 'must NOT draw — that card came from your hand.\n'
      + '3. Play Air Plant out of your CACHE (it is free, the prophecy is met).\n'
      + 'EXPECTED: Proph triggers and you draw. Your hand goes from empty to '
      + 'exactly one card. If a card appeared back at step 2, the trigger is too '
      + 'wide; if none appears at step 3, it is not hearing cache plays.\n'
      + 'ALSO WORTH YOUR RULING, if you have a moment: a card played in the '
      + 'MIDDLE of another effect resolving carries no zone marker at all, and '
      + 'Proph currently reads that blank as "from your hand" and stays silent. '
      + 'That question is still unanswered (round 27, Q4) and is NOT what the '
      + 'steps above test.',
    initiative: YOU,
    you: {
      hand: ['The Foretold', 'Air Plant'],
      // costs 2 / 1 / 3 / 4 — four unique, which is exactly Air Plant's
      // printed prophecy condition and the reason the release is free and
      // immediate rather than "two turns pass". All four are vanilla or
      // near-vanilla so nothing else on this board is doing anything.
      play: [
        { card: 'Proph' },            // ll/2
        { card: 'Curio Drifter' },    // b/1
        { card: 'Tidal Menace' },     // b/3
        { card: 'Resonant Form' },    // r/4
      ],
      // Air Plant's banner is [2lg] and The Foretold is l/3, so the seat needs
      // a wood pip as well as light: R301 charges a banner's affinity, and
      // before it this was ten flat light and the prophesy in step 1 would
      // now be refused outright. Ten against a bill of five, as before.
      resources: { light: 9, wood: 1 },
    },
    opponent: {
      hand: [],
      play: [{ card: 'Bubb' }],
      resources: { earth: 2 },
    },
    // walks the whole of turn 1's battle out of the way, both rounds declined,
    // and finishes seat 1's deployment too — so the board opens with the owner
    // holding the only decision on the table. `initiative: YOU` is what makes
    // round 1 his and round 2 theirs, which is why the seats below are fixed
    // rather than read off `s.battle`.
    prologue: (_ids, _s) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: YOU, columns: [] },
      { type: 'declareAttack', seat: OPPONENT, columns: [] },
      { type: 'doneDeploying', seat: OPPONENT },
    ],
    phase: 'deploy',
    // deployment is simultaneous and gated on `deployPlayer`, not priority.
    priority: null,
    needsLiveOpponent: false,
  },
};
