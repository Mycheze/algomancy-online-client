/* R220 — scenario batch E: EIGHT CONJUNCTIONS.
 *
 * See `scenarios.ts` for the type and the worked example (`lithoghul-donated`),
 * and `docs/14-scenario-tester.md` for why any of this exists.
 *
 * ── WHY THIS BATCH IS SHAPED DIFFERENTLY FROM A–D ────────────────────────
 *
 * The previous 25 scenarios were ranked on `UNREACHED` — "the drill has never
 * observed this promise deliver". The owner ran three and said:
 *
 *   "These tests seem silly. They all work fine. You're having me do generic
 *    tests of basic game functions basically… You made it sound like there was
 *    a lot of stuff out there that's entirely untested and totally new
 *    (drawing extra cards in the draft step, not erasing spell tokens or wisps
 *    not sacrificing themselves, etc). Not all this basic shit that has been
 *    working in all our games so far."
 *
 * He is right and the cause is diagnosable. `UNREACHED` measures THE FIXTURE'S
 * INABILITY TO STAGE A BOARD, not risk. A card can appear in every game ever
 * played and still be UNREACHED because the drill cannot arrange an attack into
 * the right region. So the queue promoted Virus, negate and pronoun resolution —
 * all with hundreds of real repetitions behind them.
 *
 * The signal that DOES measure risk was measured instead, off the 23 real saved
 * games in `server/games` (4,000+ actions):
 *
 *     passPriority   2215   saturated
 *     playCard        489   saturated
 *     doneHaste        46   thin
 *     castSpellToken   40   thin
 *     graft            36   thin
 *     playCached       10   very thin
 *     prophesy          2   almost never
 *
 * **Rarity of the ACTION is the risk.** A rule that has fired twice in the
 * project's history is where the bugs are, and six of the eight boards below
 * are built on `prophesy` / `playCached` / `graft` / `doneHaste` for exactly
 * that reason.
 *
 * ── AND EVERY ONE OF THEM IS TWO RULES MEETING ───────────────────────────
 *
 * The owner's own three examples are all conjunctions, not single cards:
 * "drawing extra cards in the draft step" is the card step MEETING an effect
 * that draws; "not erasing spell tokens" is regroup MEETING R11; "wisps not
 * sacrificing themselves" is a self-sacrifice clause MEETING whatever is
 * supposed to stop it. A single-clause scenario structurally cannot find any of
 * those, and batches A–D were entirely single-clause. Each entry below names
 * THE TWO RULES IT JOINS in its WHY block, and its `expect` is written about
 * the JOIN rather than about either rule alone.
 *
 * ── THE ONE THAT IS NOT A CONFIRMATION ───────────────────────────────────
 *
 * `wispweaver-wisps-attack-alone` is the find. Infernal Wispweaver prints
 * "Your wisps gain +2/+1 and do not sacrifice themselves after combat" with no
 * region qualifier, and the engine applies R12 (a static reaches only its own
 * region — `E.staticsFor`: `a.region === target.region`). Send the wisps in and
 * keep the 2/1 weaver at home — which is how anybody would play the card — and
 * the wisps drop from 2/2 to 0/1 the instant they cross, and sacrifice
 * themselves after combat exactly as if the weaver were not there. That is the
 * playtest complaint the card was un-parked for ("I have infernal wispweaver,
 * but my wisps sacrificed themselves anyway!!!") still reproducible in the most
 * natural line of play. It is kept, and it is reported, per the standing rule
 * that an engine/printed-text disagreement is the whole point of this instrument.
 *
 * ── WHAT COULD NOT BE BUILT, SAID OUT LOUD ───────────────────────────────
 *
 * ⚠ THE DRAFT STEP ITSELF IS UNREACHABLE FROM HERE. The owner's first example
 * is "drawing extra cards in the draft step", and `/api/scenario/open` deals
 * every scenario room with `createRoom(..., 'shared', ...)` — the mode is a
 * literal in `main.ts`, and `Scenario` has no field for it. So no scenario in
 * any batch can open a draft step, a pack, or a merge. R162 folded 'shared'
 * into the CONSTRUCTED branch of the card step, so `blurf-worldbender-card-step`
 * below reaches the same PLACE the draft step's replacement reaches — but it is
 * not the draft step, and pretending otherwise would be the thing docs/13 §5
 * keeps catching. Giving `Scenario` a `mode` is a one-line change in
 * `scenarios.ts` + `main.ts`, and both are outside this batch's territory.
 *
 * ── FOUR THINGS THAT COST TIME (A–D's list, plus one) ────────────────────
 *
 * 1. A VALUE IMPORT FROM `scenarios.ts` IS A STARTUP CRASH. See the ⚠ below.
 * 2. THE HASTE STEP IS NOT SKIPPED FOR YOU. R18 opens it whenever a seat HOLDS
 *    a payable haste card, so a scenario dealing one into a hand must put its
 *    own `doneHaste` in the prologue. TWO of the eight below deliberately do
 *    NOT, because the haste step is where the owner has to stand
 *    (`dispatch-courier-haste-unit`, `harbinger-tokens-through-regroup`); they
 *    declare `phase: 'planning'`, which is where the haste step lives — it is a
 *    STEP of the planning phase, not a phase of its own.
 * 3. ⚠ R18's TRIGGER IS NOT ONLY "A HASTE CARD IN HAND". `E.startHasteStep`'s
 *    `canHaste` also says yes to a grant-funded play (Dispatch Courier, R97)
 *    and to a cache release whose prophecy is fulfilled (R42). ⚠ THIS NOTE IS
 *    HISTORY: R228 deleted `canHaste` outright and the step now opens
 *    unconditionally, and the scenario that turned on it
 *    (`tithe-enforcer-haste-release`) went with the 2026-09-21 errata. Kept
 *    because the reasoning below still explains why these boards declare
 *    `phase: 'planning'`.
 * 4. A PROLOGUE MUST STAY INSIDE TURN 1. Crossing a turn boundary draws cards,
 *    and a drawn card is seed-dependent — the board the owner opens would stop
 *    being the board that was tested. Three of these scenarios are ABOUT a turn
 *    boundary; the owner crosses it himself, from a deterministic turn-1 board.
 */
import type { Seat } from '../engine/src/types.ts';
import type { Scenario } from './scenarios.ts';

/* ⚠ THE SEATS ARE RESTATED HERE, NOT IMPORTED. `scenarios.ts` imports THIS
 * module (it spreads `BATCH_E` into `SCENARIOS`), so `import { YOU } from
 * './scenarios.ts'` closes a cycle: ES imports are hoisted, this file's body
 * runs FIRST, and `scenarios.ts`'s `export const YOU` is still in its temporal
 * dead zone while the literal below is evaluated. The server then dies at
 * startup with `ReferenceError: Cannot access 'YOU' before initialization` —
 * before any route or test runs, and nowhere near the line that caused it.
 * `tsc` cannot see it. The `import type` above is fine; types are erased. */
const YOU: Seat = 0;
const OPPONENT: Seat = 1;

export const BATCH_E: Record<string, Scenario> = {
  /**
   * ① REGROUP × SPELL TOKENS — and the token's own creator counting them.
   *
   * THE TWO RULES:
   *   · R11 step (+): every spell token is erased at regroup.
   *   · Harbinger of Immolation's `[Augment]` static: "Your spell tokens stay
   *     through regroup" (`StaticMod.survivesRegroup`, asked per token by
   *     `E.startRegroup`).
   * and the join is the ORDER inside the R11 sequence, which nothing outside
   * `engine/test/12-fire-a.test.ts` has ever exercised.
   *
   * WHY IT IS NOT A "DOES THE CARD WORK" TEST. Three separate things have to
   * line up in one step and each is a different rule:
   *
   *  1. THE TOKEN RIDES OUT (R87). The Fireball is sent with the attack, so
   *     when regroup begins it is standing in the ENEMY's region while its
   *     protector is at home. The survival query is a STATIC and every static
   *     is region-scoped (R12), so read one line earlier it would answer NO.
   *     R11 step (1) brings spell tokens home before the query runs — a line
   *     `startRegroup` carries a comment about precisely because it "never used
   *     to matter (every token was erased two steps below)".
   *  2. THE QUERY IS ASKED BEFORE STEP (3), not after. Step (3) tears down the
   *     until-regroup layer the protector's own state depends on.
   *  3. THE SURVIVOR THEN FEEDS THE HARBINGER'S OWN TRIGGER. "At the end of
   *     turn, create a Fireball X, where X is one plus the number of spell
   *     tokens you control" is read live at resolution, AFTER regroup. A token
   *     that survived is counted; one that was erased is not. So the number
   *     printed on the second token IS the answer to the first question,
   *     which is what makes this readable in one glance instead of three.
   *
   * This card is the repo's founding "inert property" incident: it stayed dead
   * through two playtest reports (rooms ZQPC and SAAY — "my fireball was erased
   * during regroup even tho I have the Harbinger") and a conceded game, and
   * `90-coverage-census` names it by name. Every test of it is white-box
   * (`spawn(h, A, 'Harbinger of Immolation')`); no game has ever played it.
   */
  'harbinger-tokens-through-regroup': {
    id: 'harbinger-tokens-through-regroup',
    card: 'Harbinger of Immolation',
    why: 'R11 regroup MEETS the survivesRegroup static, with the token riding out '
      + 'to the enemy region first (R87) so the region-scoped query (R12) has to be '
      + 'asked after everyone comes home. Then the survivor feeds the Harbinger\'s own '
      + '"X = 1 + your spell tokens" trigger, so the number on the second token is the '
      + 'answer to the first question. The card stayed dead through two playtest '
      + 'reports; every test of it spawns it white-box.',
    expect:
      'Harbinger of Immolation is already on your board. The haste step is open.\n'
      + '1. Play Molten Upheaval (r/1, a haste card). It makes a FIREBALL 3 token.\n'
      + '2. Click done with the haste step.\n'
      + '3. Attack with The Foretold, and SEND THE FIREBALL 3 WITH IT (drag it into the\n'
      + '   attack, or click it in the strip). The opponent has no units, so it connects.\n'
      + '4. Click through the rest of the turn: regroup, deployment, done deploying.\n'
      + 'EXPECTED at regroup: the log says "1 spell token(s) stay through regroup", and the\n'
      + 'FIREBALL 3 IS STILL THERE — back in your own region, not stranded in theirs.\n'
      + 'EXPECTED at end of turn: the Harbinger makes a second token, and it is a\n'
      + 'FIREBALL 2 — one, plus the Fireball 3 that survived.\n'
      + 'So the board you end on holds a Fireball 3 AND a Fireball 2, and the opponent is\n'
      + 'on 27. If the Fireball 3 was erased at regroup, the end-of-turn token is a\n'
      + 'FIREBALL 1 instead and you end with one token, not two.',
    initiative: YOU,
    you: {
      // r/1, printed timing [Haste] — so holding it is what OPENS the haste
      // step (R18), and the scenario deliberately lands INSIDE that step.
      hand: ['Molten Upheaval'],
      // the Harbinger (which does nothing while it stands there — its trigger
      // is end-of-turn and its static is a property of the tokens), plus one
      // genuinely vanilla 3/3 to carry the attack. The Foretold is the only
      // blank-text unit in the pool, so nothing it prints can be mistaken for
      // the clause under test.
      play: [{ card: 'Harbinger of Immolation' }, { card: 'The Foretold' }],
      // rr/4 and r/1 are both already paid for (the Harbinger is placed, not
      // played); six fire is three times the Upheaval's bill.
      resources: { fire: 6 },
    },
    // EMPTY on purpose. A defender would have to be adjudicated — did it block,
    // did it die — and the observable here is a token count, not a combat.
    opponent: { hand: [], play: [], resources: { earth: 2 } },
    prologue: () => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      // NO `doneHaste`: the haste step is where the owner has to stand. R18
      // opened it because seat 0 holds a payable haste card, and seat 1 does
      // not, so `hasteDone` is [false, true] — the owner's step, alone.
    ],
    // the haste step is a STEP OF THE PLANNING PHASE, not a phase; `s.phase`
    // reads 'planning' throughout it and priority is nobody's (a haste play
    // resolves immediately — there is no window to pass in).
    phase: 'planning',
    priority: null,
    needsLiveOpponent: false,
  },

  /**
   * ② THE CARD STEP × AN EFFECT THAT ADDS A CARD OUTSIDE IT.
   *
   * THE TWO RULES, meeting at one turn boundary:
   *   · The card step, REPLACED. Worldbender: "Skip your draft step. When you
   *     do, draw a card…", implemented as `CardBehavior.replaceCardStep` and
   *     consulted from `E.startTurn` in mode 'shared' (R162).
   *   · An effect that hands you a card from OUTSIDE the step. Blurf:
   *     "[Augment] At the end of turn, cache the top card of the deck. It gains
   *     'Prophecy: 1 turn passes'. You gain debt equal to its cost."
   * and R43's tick sits exactly between them: `startTurn` runs the card step and
   * then `refreshProphecies()`, in that order, in the same method.
   *
   * ⚠ BATCH B ALREADY HAS `worldbender-card-step`, and it is the single-card
   * version — one Worldbender, one number to read. This is the SEAM, and the
   * question it asks is one no card prints an answer to:
   *
   *   WHEN DOES "1 turn passes" TICK? The card is cached at the end of turn 1.
   *   R43 counts forward from the moment of caching (`p.turn`), so `turn 2 -
   *   turn 1 >= 1` and it is fulfilled AT THE TOP OF THE VERY NEXT TURN — the
   *   same instant Worldbender is replacing the card step. The other reading —
   *   a whole turn has to pass, so turn 3 — is equally natural from the English
   *   and lands one turn later. That is the ruling this board is for.
   *
   * The rest of the instant is arithmetic that has to survive the collision:
   * the replaced card step still pays out 3 cards and 3 life (not 2 and 0), the
   * debt is still exactly the cached card's printed cost, and the opponent —
   * same turn, same table, neither card — still draws his plain 2 and stays on
   * 30. Every wrong reading lands somewhere visibly different.
   *
   * ⚠ WHICH card Blurf caches depends on the deck and therefore on the seed
   * (`&seed=`), so the `expect` line names its PROPERTIES, never its name.
   */
  'blurf-worldbender-card-step': {
    id: 'blurf-worldbender-card-step',
    card: 'Blurf',
    why: 'the replaced card step MEETS an effect that adds a card outside it, at the '
      + 'one instant both happen. The ruling in it: R43 counts a granted "1 turn '
      + 'passes" forward from the moment of caching, so a card cached at the end of '
      + 'turn 1 is free at the TOP of turn 2 — not turn 3. prophesy has fired twice in '
      + 'the project\'s history and this is the granted-prophecy sibling of it.',
    expect:
      'You are in DEPLOYMENT with an empty hand. Blurf and Worldbender are both on your\n'
      + 'board; everything worth watching happens in the ONE instant the turn rolls over.\n'
      + '1. Click done deploying. The opponent is already done, so the turn rolls.\n'
      + 'EXPECTED, at the end of THIS turn (Blurf):\n'
      + '  · one card goes from the top of your deck into YOUR CACHE, marked with the\n'
      + '    prophecy "1 turn passes";\n'
      + '  · your DEBT goes 0 → exactly that card\'s printed mana cost.\n'
      + 'EXPECTED, the instant the new turn starts (Worldbender replacing your card step):\n'
      + '  · your hand goes 0 → THREE cards, and your life 30 → 27;\n'
      + '  · the opponent draws his plain 2 and stays on 30;\n'
      + '  · AND the cached card is ALREADY fulfilled — the log says "may now be played\n'
      + '    from cache for free". You can play it this turn, for nothing.\n'
      + 'The ruling to make is that last one: is a card cached at the end of turn 1 free\n'
      + 'on turn 2, or does a whole turn have to pass first, making it turn 3?\n'
      + '2. Click done planning. EXPECTED: the debt is paid off out of your resources —\n'
      + '   one of your open resources is spent by the resource step, not by you.',
    initiative: YOU,
    you: {
      // empty, so "your hand goes 0 → 3" is one glance and not arithmetic
      hand: [],
      // both PLACED rather than played: this scenario is about the turn
      // boundary, and making him spend two deployments to get there would
      // burn his ninety seconds on setup. Blurf is lll/5, Worldbender mm/2.
      play: [{ card: 'Blurf' }, { card: 'Worldbender' }],
      // not a mana puzzle — but not empty either: the debt has to have
      // something to be paid OUT of, or the last step of the expect line
      // cannot happen.
      resources: { light: 6, metal: 2 },
    },
    opponent: { hand: [], play: [], resources: { earth: 2 } },
    prologue: () => [
      // planning → battle → two declined rounds → deployment, then seat 1
      // finishes deploying so the turn rolls on the OWNER's click and he sees
      // it happen. The attacker seats are hardcoded: the prologue function is
      // called ONCE, before any of these actions, so `s.battle` is still null
      // inside it. With initiative pinned to seat 0, round 1 is seat 0's and
      // round 2 is seat 1's.
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: YOU, columns: [] },
      { type: 'declareAttack', seat: OPPONENT, columns: [] },
      { type: 'doneDeploying', seat: OPPONENT },
    ],
    phase: 'deploy',
    priority: null,
    needsLiveOpponent: false,
  },

  /**
   * ③ A SELF-SACRIFICE CLAUSE × THE STATIC THAT IS SUPPOSED TO STOP IT.
   *
   * ⚠⚠ THIS IS THE ONE WHERE THE ENGINE AND THE PRINTED TEXT DISAGREE. It is
   * kept deliberately. Everything below is what a drive of this exact board
   * produced, not a prediction.
   *
   * THE TWO RULES:
   *   · Wisp: "After combat, sacrifice me." (its only ability)
   *   · Infernal Wispweaver: "Your wisps gain +2/+1 and do not sacrifice
   *     themselves after combat." — one static with `suppressAbilities`, which
   *     is an exact implementation rather than an approximation, because the
   *     Wisp has exactly one ability.
   *
   * THE JOIN IS R12. `E.staticsFor` gathers only radiators standing in the
   * TARGET'S OWN REGION (`a.region === target.region`), with no exception for
   * this card. A battle is fought in the DEFENDER's region, so the moment the
   * wisps attack they are no longer in the weaver's region — and the weaver is
   * a 2/1, which nobody sends into a formation.
   *
   * SO, DRIVEN: three wisps read 2/2 at home; the instant the attack is
   * declared they read 0/1; after combat all three sacrifice themselves and
   * the board is empty but for the weaver. The printed line carries no region
   * qualifier at all, and this card was UN-PARKED for exactly the complaint
   * this board reproduces — playtest: *"I have infernal wispweaver, but my
   * wisps sacrificed themselves anyway!!!"*
   *
   * The whole suite for this card (`12-fire-a.test.ts`) tests it with everyone
   * standing at home, which is the one arrangement in which the region never
   * comes up. Nobody has ever attacked with a wisp.
   *
   * The wrong answer points somewhere visibly different in TWO places at once —
   * the stat line on three bodies, and whether those bodies exist a moment
   * later — so this cannot read as "nothing happened".
   */
  'wispweaver-wisps-attack-alone': {
    id: 'wispweaver-wisps-attack-alone',
    card: 'Infernal Wispweaver',
    why: 'THE SELF-SACRIFICE SEAM, and the engine contradicts the printed line. "Your '
      + 'wisps … do not sacrifice themselves after combat" has no region in it; R12 '
      + 'scopes every static to its own region, and a battle is fought in the '
      + "DEFENDER's. Attack with the wisps and leave the 2/1 weaver at home — the way "
      + 'anyone would play it — and they lose the +2/+1 as they cross and sacrifice '
      + 'themselves anyway, which is the playtest complaint the card was un-parked for. '
      + 'Every existing test keeps everyone at home.',
    expect:
      'You have three Wisps and an Infernal Wispweaver. Read the Wisps first: with the\n'
      + 'weaver standing next to them they are 2/2, not the 0/1 they print.\n'
      + '1. Attack with ALL THREE WISPS. Leave the Infernal Wispweaver at home — it is a\n'
      + '   2/1 and there is no reason to send it. The opponent has no units.\n'
      + '2. Click through the combat to deployment.\n'
      + 'EXPECTED — and this is the thing to judge, not a trick question:\n'
      + '  · the moment you declare the attack the three Wisps drop from 2/2 to 0/1;\n'
      + '  · after combat ALL THREE SACRIFICE THEMSELVES, and you reach deployment with\n'
      + '    the Wispweaver alone on an otherwise empty board.\n'
      + 'The Wispweaver only reaches wisps standing in the same region it is, so sending\n'
      + 'them away turns it off. If you read "your wisps do not sacrifice themselves" as\n'
      + 'meaning YOUR wisps, wherever they are, then this is a bug and the three Wisps\n'
      + 'should still be standing there at 2/2 when you reach deployment.',
    initiative: YOU,
    you: {
      hand: [],
      // Wisps are token units (`token: true`), which is what they are when
      // Spectrogenesis or Aberrant Populace makes them — placed rather than
      // made, so the board opens on the question instead of on a spell.
      play: [
        { card: 'Infernal Wispweaver' },
        { card: 'Wisp', token: true },
        { card: 'Wisp', token: true },
        { card: 'Wisp', token: true },
      ],
      resources: { fire: 4 },
    },
    // empty: a blocker would kill 0/1 wisps in combat and the after-combat
    // clause would never be reached, which would hide the whole question
    opponent: { hand: [], play: [], resources: { earth: 2 } },
    prologue: () => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      // neither seat holds a haste card, so R18 never opens the step
    ],
    phase: 'battle',
    priority: null,
    needsLiveOpponent: false,
  },

  /**
   * ④ PROPHECY — a granted one, fulfilled inside a single turn, and what comes
   *    back out of the cache.
   *
   * `prophesy` has fired TWICE in the whole recorded history of this project
   * and `playCached` ten times. This board is both, plus the counter it puts
   * the answer in.
   *
   * THE TWO RULES:
   *   · Waxen Witness: "[Switch1] Cache target unit. It gains 'Prophecy — One
   *     Battle Passes'." — a GRANTED prophecy, not a printed banner, so it
   *     goes through `normalizeProphecy` and the `battlesPass` rule row.
   *   · R43's battle counter: in 1v1 BOTH the initiative battle and the
   *     counterattack tick it, so "one battle" is genuinely one round and the
   *     prophecy comes true IN THE SAME TURN it was granted.
   *
   * AND THE JOIN, which is the part no printed text answers: THE CACHE HOLDS A
   * CARD, NOT A UNIT. The Hammer of Justice on the board is a 10/3 wearing
   * three +1/+1 counters, so it reads 13/6. Cache it and release it, and what
   * comes back is a fresh spawn of the CARD — a plain 10/3 with no counters.
   * `E.cacheUnit` pushes `u.card` into the cache and nothing else; the counters
   * belonged to the entity, and the entity is gone.
   *
   * A second rule falls out of the same click and is worth watching: the
   * Hammer is cached WHILE IT IS ATTACKING, so it leaves the formation and the
   * combat happens without it. The opponent takes nothing.
   *
   * Waxen Witness is a {Battle} spell UNIT: the spell resolves first, then the
   * 3/3 body spawns — so the owner also ends the turn with a blocker he did not
   * have, which is the card's actual purpose and is worth him seeing once.
   */
  'waxen-witness-battle-prophecy': {
    id: 'waxen-witness-battle-prophecy',
    card: 'Waxen Witness',
    why: 'a GRANTED prophecy (not a printed banner) fulfilled by R43\'s battle tick '
      + 'inside one turn, then released with playCached — two actions with 2 and 10 '
      + 'repetitions in the entire recorded history of the project. The join nothing '
      + 'prints an answer to: the cache holds a CARD, so a 13/6 goes in and a 10/3 '
      + 'comes back out.',
    expect:
      'Your Hammer of Justice is a printed 10/3 wearing three +1/+1 counters, so it reads\n'
      + '13/6. Waxen Witness in your hand is a {Battle} spell unit.\n'
      + '1. Attack with the Hammer of Justice.\n'
      + '2. With the attack declared, play Waxen Witness and aim it at YOUR OWN Hammer.\n'
      + '   Pass so it resolves.\n'
      + '3. Click through the rest of the combat into deployment.\n'
      + 'EXPECTED, on resolution: the Hammer leaves play for YOUR CACHE, carrying\n'
      + '"Prophecy — One Battle Passes". A 3/3 Waxen Witness body spawns behind it.\n'
      + 'EXPECTED, once the battle round ends: the log says the prophecy is fulfilled —\n'
      + 'ONE battle round is enough, in the same turn.\n'
      + 'EXPECTED, in deployment: you may play the Hammer out of the cache FOR FREE, and\n'
      + 'no mana is spent when you do.\n'
      + 'EXPECTED, once it is back: IT IS A 10/3. The three +1/+1 counters are gone — the\n'
      + 'cache held the card, not the unit that was standing there.\n'
      + 'EXPECTED: the opponent is still on 30. The Hammer was pulled out of the attack\n'
      + 'before combat, so it never connected.',
    initiative: YOU,
    you: {
      // lll/4 {Battle} Spirit Horror Spell Unit
      hand: ['Waxen Witness'],
      // le/6 10/3 {Blessed} {Piercing}, and blank text — so the only thing
      // that can move its numbers is this scenario. The counters are the
      // observable: 10/3 + 3 = 13/6 going in, 10/3 coming out.
      play: [{ card: 'Hammer of Justice', counters: 3 }],
      // Waxen Witness needs three light pips; eight is twice the bill, and
      // the release itself is free.
      resources: { light: 8 },
    },
    // empty: the Hammer has to reach the combat step unblocked, so that "the
    // opponent is still on 30" means "it was removed" and not "it was blocked"
    opponent: { hand: [], play: [], resources: { earth: 2 } },
    prologue: () => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      // no haste card in either hand, so R18 never opens the step; the owner
      // lands on his own attack declaration
    ],
    phase: 'battle',
    priority: null,
    needsLiveOpponent: false,
  },

  /**
   * ⑤ `playCached` × A TRIGGER THAT WATCHES PLAYS — against the mod path that
   *    leaves the same zone and is NOT a play.
   *
   * THE TWO RULES:
   *   · Proph: "When you play a unit or spell from anywhere other than your
   *     hand, [Switch1] Draw a card." R49 stamps `data.from` on both events, so
   *     a cache release reads as `from: 'cache'` and is exactly what this
   *     watches.
   *   · R37: APPLYING A MOD IS NOT PLAYING A CARD. An augment out of the cache
   *     fires no play event at all — and R41/R42 make it FREE out of a cache
   *     entry whose prophecy is fulfilled, so it leaves the same zone by the
   *     same permission, for the same price, in the same step.
   *
   * TWO CARDS OUT OF ONE ZONE, ONE STEP APART. One draws, one does not, and
   * the difference is a rule nobody can see on either card's face. `playCached`
   * has fired ten times in the project's history; the augment-from-cache path
   * has almost certainly never fired at all.
   *
   * THE ORDER IN THE SCRIPT IS LOAD-BEARING. Proph's ability is `[Switch1]` —
   * bounded, once per turn (R9). Doing the PLAY first would spend the budget
   * and make the augment's silence unreadable ("did R37 stop it, or was the
   * trigger already used?"). Augment first, and the silence is the rule.
   *
   * The board is built so the prophecy is fulfilled THE INSTANT it is made:
   * Air Plant's printed banner is "[2] Prophecy — Your units have four unique
   * costs", and the four units placed below cost 1, 2, 3 and 4. That is the
   * only printed banner in the pool whose condition can be true in turn 1 —
   * every other one needs a turn or a battle to pass — which is what keeps this
   * whole scenario inside one deterministic turn.
   *
   * The stat line is the receipt: Air Plant's donated text is "your OTHER units
   * gain +2/+2 and Flying", so the HOST is the one unit that does not grow.
   */
  'proph-cache-release-vs-mod': {
    id: 'proph-cache-release-vs-mod',
    card: 'Proph',
    why: 'the same card leaves the same zone twice, one step apart, and only one of '
      + 'them is a PLAY. R49 gives a cache release `from: cache` (Proph draws); R37 '
      + 'says applying a mod is not playing a card (Proph must not). Both are free off '
      + 'a fulfilled prophecy, so price, permission and window are identical and the '
      + 'rule is the only difference. playCached has ten repetitions ever; the '
      + 'augment-from-cache path has none.',
    expect:
      'You are in DEPLOYMENT with two Air Plants in hand and Proph on the board. Air\n'
      + 'Plant is a 7-mana card whose printed banner is "[2] Prophecy — Your units have\n'
      + 'four unique costs" — and your four units cost 1, 2, 3 and 4, so it is already\n'
      + 'true. Watch YOUR HAND SIZE at every step; it starts at 2.\n'
      + '1. Prophesy the first Air Plant (pay [2]). It goes to your cache and the log\n'
      + '   immediately says the prophecy is fulfilled.\n'
      + '2. Prophesy the second one the same way (pay [2]). Your hand is now EMPTY.\n'
      + '3. AUGMENT one of them out of the cache onto your own The Foretold. It costs\n'
      + '   nothing — a fulfilled prophecy makes the mod free too.\n'
      + '   EXPECTED: your hand is STILL EMPTY. Proph does not draw. Applying a mod is\n'
      + '   not playing a card, so there was nothing for Proph to hear.\n'
      + '   EXPECTED: Proph, Bumblecrab and Resonant Form each gain +2/+2 and Flying\n'
      + '   (2/1→4/3, 2/3→4/5, 2/4→4/6). The Foretold does NOT — it is wearing the mod,\n'
      + '   and the text says your OTHER units.\n'
      + '4. Now PLAY the second one out of the cache. It also costs nothing.\n'
      + '   EXPECTED: Proph triggers and YOU DRAW A CARD — hand 0 → 1. This one was a\n'
      + '   play, out of a zone that is not your hand.\n'
      + '   EXPECTED: an Air Plant body joins the board and everything grows again —\n'
      + '   Proph 6/5, Bumblecrab 6/7, The Foretold 5/5, Resonant Form 6/8, and the new Air\n'
      + '   Plant itself 4/4 (the copy riding The Foretold counts it as one of "your other\n'
      + '   units"; each copy excludes only itself).\n'
      + 'If your hand goes to 1 at step 3, Proph is hearing a mod as if it were a play.',
    initiative: YOU,
    you: {
      // two copies is the legal maximum in constructed and is what makes the
      // two paths comparable — same card, same zone, same price, same step
      hand: ['Air Plant', 'Air Plant'],
      // FOUR UNIQUE PRINTED COSTS, which IS the prophecy condition:
      //   Bumblecrab ee/1, Proph ll/2, The Foretold l/3, Resonant Form r/4.
      // Each is inert on this board: Bumblecrab is {Piercing} and Resonant
      // Form is {Resonant} (both damage riders, and there is no combat here),
      // The Foretold has no text at all, and Proph's trigger is the clause
      // under test. Nothing here spawns a decision at the deal.
      play: [
        { card: 'Proph' },
        { card: 'Bumblecrab' },
        { card: 'The Foretold' },
        { card: 'Resonant Form' },
      ],
      // Air Plant's banner is [2lg], twice: four mana with two to spare, and a
      // wood pip to meet. R301 charges a banner's affinity — before it this
      // was six flat light and both prophesies would now be refused. Neither
      // RELEASE costs anything, which is still the point.
      resources: { light: 5, wood: 1 },
    },
    opponent: { hand: [], play: [], resources: { earth: 2 } },
    prologue: () => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: YOU, columns: [] },
      { type: 'declareAttack', seat: OPPONENT, columns: [] },
      { type: 'doneDeploying', seat: OPPONENT },
    ],
    phase: 'deploy',
    priority: null,
    needsLiveOpponent: false,
  },

  /**
   * ⑥ GRAFT × THE HOST LEAVING PLAY.
   *
   * `graft` has 36 repetitions in the whole corpus and every one of them is a
   * graft that then sat there. This is the other half: what happens to the
   * rider when the thing it is riding on goes away.
   *
   * THE TWO RULES, and they say opposite things:
   *   · R79 {Unstable}: a modded card is Unstable — "when it dies or is erased,
   *     IT AND ALL OF ITS MODS ARE ERASED WITH IT" (Manual p.35). The log says
   *     so out loud the moment the graft lands: "it is now Unstable".
   *   · Leaving play WITHOUT dying. `E.leavePlay` — the path a recall and a
   *     cache share — pushes every nontoken mod into its OWNER'S BIN instead.
   *     Neither "dies" nor "is erased" is what happened, so R79's sentence
   *     never fires.
   * A recall is the cheapest way to put those two in the same instant, and
   * Vaporweave Eidolon recalls ITSELF for nothing: "[zero]: [Switch1] Recall
   * me."
   *
   * AND A THIRD RULE RIDES ALONG, which is why this is worth a human's ninety
   * seconds rather than an assertion: `[zero]:` is the Eidolon's GRAFT CAUSE,
   * so activating it fires the base ability AND the grafted rider as ONE
   * composite (Manual p.33). The host removes itself from play in the middle of
   * that resolution. Does the rider still deliver? R167 records this exact
   * family being silently half-dead once already — a printed "[Augment] When I
   * despawn" that worked on a death and did nothing on a recall or a cache,
   * measured at destroy 1 / recall 0 / cache 0.
   *
   * The observable is three ZONES at once, which is what makes the wrong answer
   * visible rather than absent: the Eidolon in HAND, the Flame Juggle in your
   * BIN (not the erased pile), and three Fireball tokens ON THE BOARD.
   */
  'graft-host-recalls-itself': {
    id: 'graft-host-recalls-itself',
    card: 'Vaporweave Eidolon',
    why: 'R79 says a modded card is Unstable and its mods are erased with it; leaving '
      + 'play WITHOUT dying bins them instead. A self-recall puts both in one instant. '
      + 'The third question in the same click: the host removes itself mid-resolution — '
      + 'does the grafted rider still deliver? R167 records this exact family being '
      + 'silently dead on recalls and caches while working on deaths.',
    expect:
      'You are in DEPLOYMENT. Vaporweave Eidolon is a 4/3 that prints "[zero]: Recall\n'
      + 'me", and Flame Juggle in your hand is graftable ("[Switch1] Create three\n'
      + 'Fireball 1").\n'
      + '1. GRAFT Flame Juggle onto the Vaporweave Eidolon (it is a graft, not a play —\n'
      + '   slide it under the Eidolon). The log will say the Eidolon is now Unstable.\n'
      + '2. Activate the Eidolon\'s "[zero]: Recall me". It costs nothing.\n'
      + 'EXPECTED, all in that one resolution:\n'
      + '  · THREE Fireball 1 tokens appear. The grafted rider still delivers even\n'
      + '    though the card it was riding on removed itself in the same breath.\n'
      + '  · Vaporweave Eidolon is back IN YOUR HAND.\n'
      + '  · Flame Juggle is IN YOUR BIN. Not erased. "Unstable" only erases the mods\n'
      + '    when the host DIES or IS ERASED, and being recalled is neither.\n'
      + 'If Flame Juggle is missing from your bin, Unstable is firing on a recall. If\n'
      + 'there are no Fireball tokens, the rider was thrown away with its host.',
    initiative: YOU,
    you: {
      // r/2, and graftable — "[Switch1] Create three Fireball 1". Chosen
      // because its effect leaves THREE objects on the board: "did the rider
      // fire" is then a count, not a log line to go hunting for.
      hand: ['Flame Juggle'],
      // bb/3 4/3, and its printed ability is both the graft cause AND a
      // zero-cost self-recall — the only card in the pool that can put a host
      // out of play with no second card and no combat.
      play: [{ card: 'Vaporweave Eidolon' }],
      // Flame Juggle is r/2 and the activation is [zero]. Deliberately more
      // than enough: a scenario that fails on mana is a `bad scenario` verdict
      // about the wrong thing.
      resources: { fire: 6, water: 4 },
    },
    opponent: { hand: [], play: [], resources: { earth: 2 } },
    prologue: () => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: YOU, columns: [] },
      { type: 'declareAttack', seat: OPPONENT, columns: [] },
      { type: 'doneDeploying', seat: OPPONENT },
    ],
    phase: 'deploy',
    priority: null,
    needsLiveOpponent: false,
  },

  /**
   * ⑦ THE HASTE STEP × A PERMISSION THAT ALTERS TIMING.
   *
   * `doneHaste` has 46 repetitions and almost all of them are somebody clicking
   * past a step they had nothing to do in. This is the step being USED, by a
   * card that is not a haste card.
   *
   * THE TWO RULES:
   *   · R18: only [Haste] cards may be played in the haste step
   *     (`playAtTiming`: "only haste cards during the haste step").
   *   · R97: a `PlayPermission` widens that. Dispatch Courier — "[Augment] Each
   *     turn, you may play a unit during the mana step as if it had [Haste]" —
   *     is playtest report #74 ("Dispatch Courier didn't give me the option to
   *     play a card with haste"; it did not, because nothing anywhere asked).
   *
   * THE JOIN IS THE ALLOWANCE, and it is where a wrong reading is visible. The
   * printed "Each turn" is an allowance of exactly ONE, charged against
   * `s.hastePlaysUsed`. So the board deals TWO playable units: the first is
   * offered, the second is not offered once the first is played. A card that
   * granted a standing permission instead of one play would offer both.
   *
   * A THIRD RULE is on the same board and costs no extra clicks: the grant does
   * not reach a {Battle} card. RAQ, "[Solved] Dispatch Courier vs Battle
   * Timing": *"No, despite gaining :haste: they can still only be played during
   * :battle:."* Waxen Witness is in hand and must never be offered at all.
   *
   * AND THE POINT OF HASTE AT ALL: the unit played this way is on the board
   * before the battle, so it can attack in the same turn. That is the reason
   * the permission is worth anything, and it is the last line of the check.
   *
   * ⚠ THIS SCENARIO ALSO PROVES R18'S OPENING CONDITION IS NOT WHAT IT LOOKS
   * LIKE. The owner's hand holds no [Haste] card whatsoever, and the haste step
   * is open anyway — `E.startHasteStep`'s `canHaste` consults the grant. If the
   * board opens straight into the battle phase instead, the step never asked.
   */
  'dispatch-courier-haste-unit': {
    id: 'dispatch-courier-haste-unit',
    card: 'Dispatch Courier',
    why: 'R18 says only haste cards in the haste step; R97 lets a grantor widen that '
      + 'by exactly one play per turn. The join is the allowance — two playable units '
      + 'in hand, and the second must stop being offered. Report #74 is this card doing '
      + 'nothing because nothing asked, and the same `canHaste` is why the step is open '
      + 'at all with no haste card in hand.',
    expect:
      'You are in the HASTE STEP — look at the board and note that your hand holds no\n'
      + '[Haste] card at all. Dispatch Courier on your board is what opened it.\n'
      + 'Your hand: The Foretold (l/3 unit), Curio Drifter (b/1 unit), Waxen Witness\n'
      + '(lll/4 {Battle} spell unit).\n'
      + '1. Look at what you are offered. EXPECTED: The Foretold and Curio Drifter are\n'
      + '   both playable. Waxen Witness is NOT — a {Battle} card cannot be hasted, ever.\n'
      + '2. Play The Foretold. It spawns immediately, here in the haste step.\n'
      + '3. Look again. EXPECTED: CURIO DRIFTER IS NO LONGER OFFERED. "Each turn" is one\n'
      + '   play, and you have used it. The only thing left to do is finish the step.\n'
      + '4. Finish the haste step. EXPECTED: THE FORETOLD MAY ATTACK THIS TURN, in the\n'
      + '   battle that is about to start — which is the whole point of the permission.\n'
      + 'If Curio Drifter is still offered at step 3, the allowance is not being spent.\n'
      + 'If Waxen Witness is ever offered, the {Battle} refusal is missing.',
    initiative: YOU,
    you: {
      // l/3 blank-text unit, b/1 {Evasive} unit, lll/4 {Battle} spell unit.
      // The two units are the allowance test; the {Battle} card is the refusal
      // test and is never meant to be playable at all.
      hand: ['The Foretold', 'Curio Drifter', 'Waxen Witness'],
      // mm/2 2/1. Its whole text box is the permission, so it does nothing
      // else on this board.
      play: [{ card: 'Dispatch Courier' }],
      // enough for either unit and for the Waxen Witness that must never be
      // offered — so that "not offered" cannot be confused with "not affordable"
      resources: { light: 6, water: 4, metal: 2 },
    },
    opponent: { hand: [], play: [], resources: { earth: 2 } },
    prologue: () => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      // NO `doneHaste` — the haste step is the whole scenario. R18 opened it
      // for seat 0 off the Courier's grant, not off a card in hand, and seat 1
      // has nothing to do in it (`hasteDone` is [false, true]).
    ],
    phase: 'planning',
    priority: null,
    needsLiveOpponent: false,
  },

  /* ⑧ WAS `tithe-enforcer-haste-release`, AND THE CARD LOST THE BANNER IT WAS
   * ABOUT (errata 2026-09-21). It drove prophesy × doneHaste × playCached in
   * one line — the three thinnest actions in the corpus — on the only card
   * whose prophecy condition was about the haste step. There is no card left
   * to repoint it at: no printed banner now pairs with a {Haste} printed
   * timing, and `hasteWithUsedMana` has no printed card at all.
   *
   * WHAT WAS AND WAS NOT LOST. `prophesy` and `playCached` still run end to
   * end through the two Air Plant scenarios above, and R43's condition is
   * driven in full by `36-cache-prophecy` on a synthetic card. The one
   * property that went with it — "turn 3's haste step OPENS for a card that is
   * not in hand" — had already been made unremarkable by R228, which deleted
   * `canHaste` and opens the step unconditionally; `200-haste-step-is-
   * unconditional` is where that lives now.
   *
   * Divine Intervention is the last card whose RELEASE is haste-timed (its
   * banner carries the trailing "[Haste]" marker, which is what
   * `E.cachedTiming` reads). A replacement scenario would start there — but a
   * scenario is a human-facing board out of docs/14's queue, so that is the
   * owner's to commission, not a gap to be quietly filled.
   */
};
