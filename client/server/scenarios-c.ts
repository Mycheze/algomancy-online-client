/* R218 — scenario batch C. See scenarios.ts for the type and the worked
 * example (`lithoghul-donated`), and docs/14-scenario-tester.md for why any of
 * this exists. Authored as a batch so parallel authors never share a file.
 *
 * ── WHAT THE SIX CARDS IN THIS BATCH HAVE IN COMMON ──────────────────────
 *
 * Every one is in `ledgers/unreached.ts` — the ledger of printed promises
 * the whole-pool drill has NEVER ONCE observed being delivered. That module is
 * imported, never scraped: R217's header records two independent regex scrapes
 * of the old literal agreeing on 32 keys where the object holds 37, and all
 * five they dropped were `BOARD` entries, i.e. exactly the slice a human can
 * build and a fixture cannot. Each entry NAMES the precondition the fixture
 * lacked, and building that precondition is what every scenario below is for.
 *
 *   Skittering Blight   BOARD  "Nothing in the library gives the seat rot and
 *                              then lets it tick."
 *   Earnest Defender    BOARD  "The `targeted` fixture is a synthesised
 *                              targeting, not an enemy's spell."
 *   Bloated Manablub    REGION the last of the six R199 could not close.
 *   Pestilent Mycelion  BOARD  "the life loss is region-scoped to the
 *                              opponents present."
 *   Molten Riftbreaker  BOARD  "Nothing of the seat's own is on the stack when
 *                              the host leaves play."
 *   Prediction Prophet  BOARD  "the drill answers the prediction with the FLOOR
 *                              of R197's numeric entry (0)."
 *
 * ── THREE THINGS THIS FILE LEARNED THE HARD WAY (R218) ───────────────────
 *
 * ① A batch module CANNOT value-import `YOU` / `OPPONENT` — see the note below.
 * ② A non-{Virus} [Augment] is a DEPLOYMENT action. `apply` refuses it in
 *    planning or battle with "modding is a deployment action (or a battle
 *    Virus)". So a scenario that wants a donated augment on a NON-Virus card
 *    (Earnest Defender, Pestilent Mycelion, Skittering Blight) has to walk a
 *    whole turn in its prologue to reach a deployment; a {Virus} (Molten
 *    Riftbreaker, Lithoghul) can be augmented straight from the battle window.
 * ③ `augmentText` IS LIVE ON THE CARD'S OWN BODY. Measured, not assumed:
 *    `earnest-defender-enemy-spell` below fires the [Augment] clause off a
 *    plain unit in play, and `new E(state).effStats()` reports the owner's
 *    units at +2/+2 while an enemy Towering Colossus ("[Augment] Enemies gain
 *    +2/+2") merely stands there. ⚠ That contradicts `scenarios.ts`'s comment
 *    on `lithoghul-donated` — "Its own printed text is an [Augment] box, which
 *    does nothing while it is a body in play — so as a host it is inert." It is
 *    not inert. It does not break that scenario (its observable is a life total
 *    read before combat damage), but no scenario in this file uses Towering
 *    Colossus as scenery, and neither should the next one.
 * ④ `Scenario.prologue`'s own comment says `dealScenario` "skips [the haste
 *    step] if it is open anyway (see runPrologue)". IT DOES NOT — `runPrologue`
 *    applies the listed actions and nothing else, so a prologue whose board
 *    leaves the R18 haste step open throws `not your attack step`. No scenario
 *    here needs a `doneHaste`, and the reason is worth knowing rather than
 *    getting lucky over: R18 opens that step only for a seat HOLDING a payable
 *    haste card, and `patchSide` REPLACES the hand — so a scenario can only
 *    open it by dealing a haste card into a hand on purpose. (Earnest Defender
 *    is a {Haste} card and appears below in PLAY, which does not count.)
 *    `hasteDone` is null on all six boards; a future entry that deals a haste
 *    card into a HAND must add its own `doneHaste` for both seats.
 * ⑤ EVERY PROLOGUE HERE STAYS INSIDE TURN 1, deliberately. `/api/scenario/open`
 *    accepts `&seed=`, and the board is contracted to be seed-independent while
 *    the deck is not — but crossing into turn 2 draws fresh cards, and a board
 *    that varies with the seed is worse than no board at all: it works when its
 *    author tests it and is something else when the owner opens it. The batch
 *    guard in test-scenario.ts re-deals all six over five seeds and asserts one
 *    distinct board each.
 */
import type { Seat } from '../engine/src/types.ts';
import type { Scenario } from './scenarios.ts';

/* ⚠ `YOU` and `OPPONENT` are DECLARED HERE and not imported, and that is not a
 * style choice — a value import of them does not work from a batch file.
 *
 * scenarios.ts imports this module, so under ESM this module's body is
 * evaluated FIRST, in full, before a single line of scenarios.ts runs. Its
 * `export const YOU` is therefore still in the temporal dead zone while the
 * object literal below is being built, and the whole server dies at import
 * time with `ReferenceError: Cannot access 'YOU' before initialization`.
 * (Hoisting means the position of the batch imports at scenarios.ts:195, well
 * below `YOU` at :101, makes no difference at all.)
 *
 * Keeping them local also leaves this file with NO runtime import of
 * scenarios.ts, which removes the cycle rather than tiptoeing around it. The
 * seat convention itself is not restated from memory: scenarios.ts pins it
 * ("the owner is always SEAT 0 in a scenario room"), and
 * 186-scenario-library.test.ts is what asserts it stays true. */
const YOU: Seat = 0;
const OPPONENT: Seat = 1;

export const BATCH_C: Record<string, Scenario> = {
  /**
   * WHY THIS CARD (R218) — Skittering Blight, queue #14.
   *
   * PRINTED: "When I spawn, gain a rot. [Augment] If rot would deal damage to
   * you, instead put that many +1/+1 counters on me." The second sentence is
   * THE ONLY REPLACEMENT EFFECT IN THE ENGINE (E.replaceRotDamage's own
   * header: "Deliberately NARROW rather than a general replacement framework —
   * docs/04 has no replacement layer"), and it is the clause under test.
   *
   * WHAT THE SUITE DOES AND DOES NOT COVER (grepped, six files name the card):
   *  · `88-replacement-conformance` only asserts that the card DECLARES a
   *    `replaceRotDamage` hook and is allowed its extra trigger. Declaration,
   *    not behaviour.
   *  · `35-rot-debt-trash` — the file whose whole subject is R38 rot — does not
   *    use the card at all. It stands in a SYNTHETIC, `registerSynthetic(unit(
   *    'Test Rot Ward', …), { replaceRotDamage: … })`, whose body is a copy of
   *    Skittering Blight's two lines. A synthetic that passes proves the HOOK
   *    works; it cannot prove this card is wired to it.
   *  · `142-static-conformance`, `129-disposal-tail`, `135-exchange-and-zones`,
   *    `42/43-dark-b/c` name it for other reasons entirely.
   *  · and the drill has never delivered the promise, for the reason the ledger
   *    gives: nothing in the fixture library gives a seat rot AND THEN lets it
   *    tick.
   *
   * WHY THE OBSERVABLE IS UNAMBIGUOUS. Two numbers move in OPPOSITE directions
   * on the same event, so a wrong answer cannot look like a right one:
   *   right → your life stays 30 AND the Blight is a 3/3
   *   wrong → your life is 28  AND the Blight is still a 1/1
   * and the count is TWO, not one, which is the other half of the clause
   * ("that MANY"): an implementation that replaced the damage but put a single
   * counter on is a `slightly-off`, and it is visible as a 2/2.
   *
   * WHY FESTER. One rot would make "that many" untestable — 1 counter and
   * 1 damage are the same number. Fester (d/1, {Battle}, "Target player gains
   * a rot") pointed at YOURSELF is the cheapest second rot in the pool and
   * costs one extra click.
   *
   * WHY THE 0/4. Rampart Guardian attacks only so that there IS an attack
   * window to cast Fester in ({Battle} timing) — it has 0 power, so no life
   * total on the board moves for any reason except the clause under test.
   */
  'skittering-blight-rot-into-counters': {
    id: 'skittering-blight-rot-into-counters',
    card: 'Skittering Blight',
    why: 'the engine\'s ONE replacement effect (R38), and it has never run in a real game. '
      + '35-rot-debt-trash tests the hook with a synthetic stand-in ("Test Rot Ward"); '
      + '88-replacement-conformance only checks the card DECLARES one; and the drill cannot '
      + 'give a seat rot and then let it tick (unreached.ts, BOARD).',
    expect:
      'Skittering Blight already gave you 1 rot when it spawned. Rot damage lands at the START '
      + 'OF DEPLOYMENT — the Blight is supposed to eat it and grow instead.\n'
      + '1. Play Fester and point it at YOURSELF (the option reads "You"). Pass. You now have 2 rot.\n'
      + '2. Pass through the rest of the battle — the bot blocks nothing and attacks with nobody.\n'
      + '3. Deployment starts. This is the moment.\n'
      + 'EXPECTED: your life is STILL 30, and Skittering Blight is a 3/3 carrying two +1/+1 '
      + 'counters. The log should say "Skittering Blight replaces the 2 damage You\'s rot would deal."\n'
      + 'A WRONG ANSWER LOOKS DIFFERENT: if you are on 28 and the Blight is still a 1/1, the '
      + 'replacement never happened. If you are on 30 but it is only a 2/2, it replaced the damage '
      + 'and forgot "that MANY".\n'
      + 'Nothing else on the board should move — your attacker has 0 power on purpose.',
    initiative: YOU,
    you: {
      hand: ['Fester'],
      // [0] the card under test, at home. It gains its rot on spawn, during
      //     the deal — the board opens with you already on 1 rot.
      // [1] a 0/4 with no text, purely to open an attack window. Rot damage is
      //     NOT region-scoped (E.rotDamage filters on `a.controller === seat`
      //     and nothing else), so the Blight can stay home and still eat it.
      play: [{ card: 'Skittering Blight' }, { card: 'Rampart Guardian' }],
      // Fester is d/1, Rampart Guardian is e/2 and already in play. Over-
      // provisioned on purpose: a scenario that fails on mana is a
      // `bad scenario` verdict about the wrong thing.
      resources: { dark: 4, earth: 4 },
    },
    opponent: {
      hand: [],
      // ee/2 4/5, no printed text at all (`card('Ambling Mountaintop', {})`).
      // Scenery, and genuinely inert — unlike Towering Colossus (see ③ above).
      play: [{ card: 'Ambling Mountaintop' }],
      resources: { earth: 2 },
    },
    prologue: (ids, s) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      // the R18 haste step never engages here (neither side holds a payable
      // haste card), so this lands straight in the round-1 attack window
      { type: 'declareAttack', seat: s.battle?.attacker ?? YOU, columns: [[ids.you[1]!]] },
    ],
    phase: 'battle',
    priority: YOU,
    // driven by hand end to end: the bot only ever passes, declines the block
    // and sends no counterattackers
    needsLiveOpponent: false,
  },

  /**
   * WHY THIS CARD (R218) — Earnest Defender, queue #15.
   *
   * PRINTED: "[Augment] Whenever an ally becomes the target of an enemy spell,
   * create a 1/1 unit." The ledger's reason it is unreached is the fixture, not
   * the card: "The `targeted` fixture is a synthesised targeting, not an
   * enemy's spell, and the bait scenario does not run under the augment host."
   *
   * WHAT THE SUITE COVERS: `23-wood-a` DOES drive the clause (seed 2305,
   * Channeled Boon at an ally, then at a non-ally). So this is not virgin
   * ground — but every existing check is in-process, and the one thing a
   * fixture cannot ask is the question this scenario asks the owner: WHOSE 1/1
   * is it? `68-target-conformance` and `136-triggers-and-modes` name the card
   * for other reasons.
   *
   * ⚠ THE SEATS ARE DELIBERATELY THE OTHER WAY ROUND. Earnest Defender sits on
   * the OPPONENT's board and YOU are the enemy spell. That is not a
   * convenience — it is the only version of this clause a single human can
   * drive. The scripted opponent's `PASSIVE_ORDER` has no `playCard` in it at
   * all (scenarios.ts), so an "enemy spell" cast BY the bot cannot happen, and
   * a scenario that needed one would be `needsLiveOpponent: true` — which
   * docs/14 §4 is right to treat as expensive.
   *
   * WHY THE OBSERVABLE IS UNAMBIGUOUS, and this is the Lithoghul standard
   * exactly: the effect is `makeOneOne(g, ctx.controller, ctx.region)`, and
   * `ctx.controller` is the CARRIER's controller. If it ever resolved to the
   * spell's caster instead, the 1/1 would appear on YOUR side of the board.
   * Same event, same click, and the token points at the other player.
   *
   * WHY THE CLAUSE FIRES ON A PLAIN BODY. Verified by driving it, not assumed:
   * `augmentText` is live on the card's own body (see ③ in the header). The
   * DONATED variant — the Defender worn as a mod by another unit — needs a
   * prologue that walks an entire turn to reach a deployment step, because a
   * non-{Virus} augment is refused outside deployment (② in the header); the
   * clause it gates is character-for-character the same one, so that cost buys
   * the augment PLUMBING, not this card's text, and it belongs in its own
   * scenario rather than making this one fragile.
   */
  'earnest-defender-enemy-spell': {
    id: 'earnest-defender-enemy-spell',
    card: 'Earnest Defender',
    why: 'the [Augment] trigger fires on TARGETING, and the 1/1 belongs to the carrier\'s '
      + 'controller — not the caster. The drill has never reached it (unreached.ts, BOARD: the '
      + '`targeted` fixture is a synthesised targeting, not an enemy spell), and the seats are '
      + 'reversed here because the scripted bot never plays a card.',
    expect:
      'Earnest Defender is on THEIR board this time, and YOU are the enemy spell.\n'
      + '1. Play Flame of History and aim it at "The Foretold (Tester Bot\'s)" — their other unit. '
      + 'It is a 3/3 and takes 1, so it survives; the damage is not the point, the TARGETING is.\n'
      + '2. Watch the moment you confirm the target, before the spell has even resolved.\n'
      + 'EXPECTED: a 1/1 Unit Token appears on THE OPPONENT\'S side of the board. The log reads '
      + '"Trigger: Earnest Defender — create a 1/1 unit" and then "Tester Bot spawns Unit Token".\n'
      + 'A WRONG ANSWER LOOKS DIFFERENT: if the 1/1 shows up on YOUR side, the card gave the token '
      + 'to whoever cast the spell instead of to whoever wears the text. If no token appears at '
      + 'all, the trigger did not see an enemy spell target an ally.\n'
      + 'Their Earnest Defender is an ally of itself, so aiming at IT instead should also make a '
      + 'token — that is a bonus check, not the test.',
    initiative: YOU,
    you: {
      hand: ['Flame of History'],
      // 0/4, no text: it opens the attack window and can change nothing else.
      play: [{ card: 'Rampart Guardian' }],
      resources: { fire: 4, earth: 4 },
    },
    opponent: {
      hand: [],
      // [0] the card under test, as a plain body — its [Augment] text-box is
      //     live there (③). [1] the ALLY to aim at: l/3 3/3, no printed text,
      //     survives the 1 damage so the owner never has to adjudicate a death
      //     and a trigger at once.
      play: [{ card: 'Earnest Defender' }, { card: 'The Foretold' }],
      resources: { wood: 4 },
    },
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
   * WHY THIS CARD (R218) — Bloated Manablub, queue #16. ⭐ THE ONE THAT MATTERS.
   *
   * PRINTED: "When I despawn, [Switch1] Each opponent loses 3 life."
   *
   * THIS IS THE LAST SURVIVING `REGION` ENTRY IN THE LEDGER. R199 closed five
   * of the six — Galerider Eel, Colony of the Interworld, Rider of the Tides,
   * Xenopod Progenitor and Boreal Wanderer all deliver now, each with a named
   * assertion in `170-battle-position-promises`. This one resisted, and R199
   * measured exactly why: the effect loops over
   * `regions[ctx.region].presentSeats`, the card is a 2/2 that the drill's own
   * `counters` and `damage` beats leave dead before the declare step, and the
   * drill's "keep the card on the table" respawn puts it back AT HOME, mid
   * battle and too late to join an attack. `inBattleBeats` is empty for it: it
   * has never once stood in a battle.
   *
   * A HUMAN BUILDS THAT IN ONE CLICK. The prologue sends it into the attack, so
   * it opens the board already standing in the opponent's region — where
   * `presentSeats` is [1, 0], both seats — and then it only has to leave play
   * THERE. `170-battle-position-promises` still asserts the negative for this
   * card by name; if this scenario passes, that test's own comment says what to
   * do ("Delete its UNREACHED entry in 84-card-semantics and this test with
   * it — the reason it was recorded no longer holds").
   *
   * WHAT THE SUITE COVERS: only the EMPTY branch, and deliberately.
   * `158-silent-region-branches` resolves the ability in a region holding no
   * opponent and asserts that nobody loses life and that the card SAYS SO;
   * `179-empty-collection-branches` is the same shape. Ten files name this card
   * and not one has ever watched three life come off anybody.
   *
   * ⚠ THE FAILURE MODE HERE IS SILENCE, WHICH IS WHY THE `expect` SPELLS IT
   * OUT. The ledger's entry says it in as many words: "⚠ It does this
   * SILENTLY; its sibling Boreal Wanderer announces the same no-op." (That is
   * now half-repaired — `eachOpponentLoses3` does carry a "no opponent is
   * present here" line — but if the trigger resolves somewhere that line is not
   * printed and no life moves, NOTHING on screen distinguishes it from a card
   * that simply did not fire.) So the `expect` names the number, names the log
   * line, and names what its absence means.
   *
   * WHY THE MANABLUB DIES TO YOUR OWN BURN. It has to leave play IN THE BATTLE
   * REGION, and the scripted opponent declines every block — so combat cannot
   * kill it and nothing the bot does can. Flame of History (r/1, 1 damage, and
   * the Manablub is a 2/1) is the cheapest way for one human to make a unit
   * leave play exactly where he wants it. Killing it in the ATTACK WINDOW also
   * keeps the arithmetic clean: it never reaches combat damage, so the only
   * life that moves in the whole game is the 3 the clause takes.
   */
  'manablub-dies-in-their-region': {
    id: 'manablub-dies-in-their-region',
    card: 'Bloated Manablub',
    why: 'THE LAST SURVIVING `REGION` CARD (unreached.ts). R199 closed the other five; this one '
      + 'is a 2/2 the drill kills before the declare step, so it has never once stood in a '
      + 'battle. Every test that touches "each opponent loses 3 life" — 158-silent-region-branches, '
      + '179-empty-collection-branches — asserts the EMPTY loop. Nobody has ever seen it take a life.',
    expect:
      'Bloated Manablub is already attacking, so it is standing in THEIR region, where an opponent '
      + 'actually is. All it has to do now is leave play there.\n'
      + '1. Play Flame of History and aim it at your OWN "Bloated Manablub" — yes, on purpose. It '
      + 'is a 2/1, so 1 damage kills it. Pass.\n'
      + '2. The despawn trigger goes on the stack. Pass again to resolve it.\n'
      + 'EXPECTED: THE OPPONENT DROPS FROM 30 TO 27, and the log reads "Tester Bot loses 3 life '
      + '(Bloated Manablub)". Nothing else in this game moves a life total — the Manablub dies '
      + 'before combat, so 27 should be their exact final number.\n'
      + '⚠ SILENCE IS THE BUG HERE. If the trigger resolves and BOTH players are still on 30, this '
      + 'card is looking for opponents in the wrong region and mostly not saying so — that is the '
      + 'exact defect this scenario exists to catch, and it is a `broken`, not a `works`. A line '
      + 'reading "no opponent is present here" is the same bug, politely.\n'
      + 'If YOUR life drops to 27 instead, it found the wrong seat entirely.\n'
      + '(A card is reaped into your hand when the Manablub dies. Ignore it.)',
    initiative: YOU,
    you: {
      hand: ['Flame of History'],
      // the card under test. The prologue sends it into the attack, so it is
      // standing in region 1 — presentSeats [1, 0] — before you touch anything.
      play: [{ card: 'Bloated Manablub' }],
      resources: { fire: 4, water: 2 },
    },
    opponent: {
      hand: [],
      // l/3 3/3, no printed text. Scenery, and it never blocks (the bot
      // declines) — so it cannot kill the Manablub in the wrong place.
      play: [{ card: 'The Foretold' }],
      resources: { light: 2 },
    },
    prologue: (ids, s) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      // THE WHOLE POINT: this is the step R199 could not give the card. The
      // declaration marches it into the defender's region and the board opens
      // with it already there.
      { type: 'declareAttack', seat: s.battle?.attacker ?? YOU, columns: [[ids.you[0]!]] },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * WHY THIS CARD (R218) — Pestilent Mycelion, queue #17.
   *
   * PRINTED: "[Augment] Whenever one or more -1/-1 counters are put on a unit,
   * each opponent loses 1 life." Ledger: "The trigger fires and resolves; the
   * life loss is region-scoped to the opponents present." Same family as
   * Bloated Manablub above and the same repair — the card has to be standing
   * where an opponent is.
   *
   * WHAT THE SUITE COVERS: `158-silent-region-branches` resolves the augment
   * text in a region holding no opponent and asserts NOBODY loses life;
   * `179-empty-collection-branches` again. `24-wood-b` and
   * `105-semantics-playwatch` name the card. As with the Manablub, every
   * existing assertion is about the loop being empty.
   *
   * TWO INDEPENDENT THINGS ARE UNDER TEST AND BOTH ARE VISIBLE:
   *  · WHERE — 1 life comes off the opponent, because the Mycelion is standing
   *    in their region rather than at home.
   *  · HOW MANY — Umbral Decay puts TWO counters on in ONE batch, and the
   *    clause is "one or MORE … each opponent loses 1 life": one firing, one
   *    life. The card's `when` is `(ev.data?.n ?? 0) < 0` on a single
   *    `countersChanged` event, so a wrong reading that fired per counter is a
   *    2, not a 1 — a `slightly-off` the owner can see without counting
   *    anything twice.
   *
   * WHY THE TRAILING POINT OF COMBAT DAMAGE IS NAMED IN `expect`: the Mycelion
   * has to attack to be in the battle region at all, and it is a 1/3, so after
   * the clause resolves its own 1 combat damage takes the opponent from 29 to
   * 28. That is combat, not this card, and an unexplained second life change is
   * exactly what turns a good scenario into a `bad scenario` verdict.
   */
  'mycelion-minus-counters-in-battle': {
    id: 'mycelion-minus-counters-in-battle',
    card: 'Pestilent Mycelion',
    why: 'region-scoped "each opponent loses 1 life", never once observed taking a life — '
      + '158-silent-region-branches and 179-empty-collection-branches both assert the EMPTY loop '
      + '(unreached.ts, BOARD). This puts the Mycelion in the battle region and lands two -1/-1 '
      + 'counters in one batch, so the COUNT is under test as well as the region.',
    expect:
      'Pestilent Mycelion is already attacking, so it is standing in THEIR region.\n'
      + '1. Play Umbral Decay and aim it at "Ambling Mountaintop (Tester Bot\'s)". It puts TWO '
      + '-1/-1 counters on, in one go. Pass.\n'
      + '2. The Mycelion trigger goes on the stack. Pass again to resolve it.\n'
      + 'EXPECTED: the opponent goes 30 → 29. EXACTLY ONE. The clause is "one or MORE counters … '
      + 'each opponent loses 1 life", so two counters arriving together is ONE firing and ONE life, '
      + 'and the log should show a single "Tester Bot loses 1 life (Pestilent Mycelion)".\n'
      + 'A WRONG ANSWER LOOKS DIFFERENT: 30 → 28 means it fired once per counter (slightly off). '
      + 'Still on 30, or a line saying "no opponent is present here", means it looked for opponents '
      + 'in your home region instead of the one it is standing in (broken).\n'
      + '(Keep passing afterwards and they will go 29 → 28 from the Mycelion\'s own 1 combat '
      + 'damage. That is combat, not this clause — read the number the moment the trigger resolves.)',
    initiative: YOU,
    you: {
      hand: ['Umbral Decay'],
      // the card under test; the prologue sends it into the battle region.
      play: [{ card: 'Pestilent Mycelion' }],
      resources: { dark: 4, wood: 4 },
    },
    opponent: {
      hand: [],
      // ee/2 4/5, no printed text: it takes the two counters and lives (2/3),
      // so the owner is never adjudicating a death alongside the clause.
      play: [{ card: 'Ambling Mountaintop' }],
      resources: { earth: 2 },
    },
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
   * WHY THIS CARD (R218) — Molten Riftbreaker, queue #18.
   *
   * PRINTED: "When I spawn, create two Fireball 1. [Augment] When I despawn,
   * negate all allied spells." The second sentence is the clause under test.
   * Ledger: "Nothing of the seat's own is on the stack when the host leaves
   * play, and the trigger announces the empty sweep." That sentence names the
   * precondition precisely — A SPELL OF THE SEAT'S OWN, ON THE STACK, WHEN THE
   * HOST LEAVES PLAY — and this scenario is that sentence, built.
   *
   * WHAT THE SUITE COVERS: `13-fire-b` (seed 1302) does drive a real negate —
   * but off the card's OWN BODY (`spawn(h, D, 'Molten Riftbreaker')`, with the
   * comment "own [Augment] text is live"). It is the only test in the repo that
   * touches the clause. THE AUGMENT PATH — the text worn by a HOST, which is
   * what the [Augment] keyword is for and what docs/13 §1③ names as the single
   * biggest untested hole in the round-28 sample — has never run.
   *
   * WHY THE HOST IS YOUR OWN UNIT. Riftbreaker is a {Virus}, so the augment
   * menu offers both sides; the enemy host is the sharper R131 question ("whose
   * spells does 'allied' mean?"). It is not this scenario, on purpose: with the
   * text on THEIR unit, "allied" is the opponent's — and the opponent never
   * casts anything, because the scripted bot has no `playCard` in its
   * preference order. That scenario could only ever re-observe the empty sweep,
   * which is the state the ledger is already complaining about. Worth its own
   * entry the day a live-opponent session happens; not worth burning this one.
   *
   * WHY THE OBSERVABLE IS UNAMBIGUOUS. The negated spell is Arc Lightning
   * pointed at the opponent's FACE, so the two readings are two different
   * numbers on the same clock:
   *   right → the opponent is on 30 and the log says "Arc Lightning is negated"
   *   wrong → the opponent is on 24
   * "Nothing happened" is not a possible outcome: either six life left them or
   * it did not.
   *
   * ⚠ ONE PIECE OF EXPECTED NOISE, named in `expect` so it is not mistaken for
   * the bug: applying a {Virus} makes the host {Unstable} (R79), so The
   * Foretold is ERASED rather than binned when it dies. That is the Virus
   * keyword, not this clause.
   */
  'riftbreaker-negates-your-own-spell': {
    id: 'riftbreaker-negates-your-own-spell',
    card: 'Molten Riftbreaker',
    why: 'the [Augment] half — "when I despawn, negate all allied spells" — has never negated '
      + 'anything from a HOST. 13-fire-b drives it off the card\'s own body and is the only test '
      + 'that touches it; the drill never has a spell of the seat\'s own on the stack when the host '
      + 'leaves play (unreached.ts, BOARD), so it has only ever announced the empty sweep.',
    expect:
      'You are going to put a Virus on your own unit, aim a big spell at their face, and then kill '
      + 'the host while that spell is still on the stack. The augment should eat your own spell.\n'
      + '1. Augment Molten Riftbreaker onto YOUR OWN "The Foretold". Pass so it attaches.\n'
      + '2. Play Arc Lightning and aim it at "Tester Bot" — their face, 6 damage. DO NOT PASS: it '
      + 'has to still be sitting on the stack.\n'
      + '3. Play Luminous Arc and aim it at your OWN "The Foretold" (6 damage — it is a 3/3, so it '
      + 'dies and the Riftbreaker goes with it). Now pass.\n'
      + '4. Luminous Arc resolves, the host dies, and the donated despawn trigger goes on the '
      + 'stack. Pass again.\n'
      + 'EXPECTED: the log reads "Arc Lightning is negated → bin", AND THE OPPONENT IS STILL ON 30. '
      + 'Your own spell was negated by your own dying augment — that is what "all allied spells" '
      + 'means when you are the one wearing it.\n'
      + 'A WRONG ANSWER LOOKS DIFFERENT: if the opponent is on 24, Arc Lightning resolved and the '
      + 'clause negated nothing. A line reading "you have no spell on the stack" with your Arc '
      + 'Lightning still there is the same failure, worded politely.\n'
      + '(The Foretold is ERASED instead of going to the bin. That is {Unstable} — every unit '
      + 'wearing a Virus becomes Unstable — not this clause.)',
    initiative: YOU,
    you: {
      // the card under test, plus the spell that must survive to be negated and
      // the spell that kills the host. Order matters to the instructions above.
      hand: ['Molten Riftbreaker', 'Arc Lightning', 'Luminous Arc'],
      // l/3 3/3, no printed text: a host that does exactly nothing of its own,
      // and that Luminous Arc's 6 kills outright with no adjudication.
      play: [{ card: 'The Foretold' }],
      // Riftbreaker rr/2 + Arc Lightning rr/4 + Luminous Arc r/2 = 8, and the
      // affinity requirement is 2 fire. Twelve, deliberately.
      resources: { fire: 12 },
    },
    opponent: {
      hand: [],
      play: [{ card: 'Ambling Mountaintop' }],
      resources: { earth: 2 },
    },
    prologue: (ids, s) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      // a {Virus} augment is a BATTLE action (a plain one is deployment-only —
      // see ② in the header), so the window this opens is the one the whole
      // scenario happens in
      { type: 'declareAttack', seat: s.battle?.attacker ?? YOU, columns: [[ids.you[0]!]] },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * WHY THIS CARD (R218) — Prediction Prophet, queue #19.
   *
   * PRINTED: "During [Haste], predict your life total. At the start of
   * deployment, create a 5/5 unit if you matched the prediction." Ledger:
   * "The trigger fires and resolves; the drill answers the prediction with the
   * FLOOR of R197's numeric entry (0) and the life total moves." So the drill
   * has never once matched.
   *
   * WHAT THE SUITE COVERS, and where the gap is. `40-light-c` has three real
   * tests, including one that predicts `life - 4` and matches. But every one of
   * them moves the life total with `whiteBox(h, e => e.loseLife(A, 4, 'test'))`
   * — a direct engine call, no card, no stack, no action log. The prediction
   * has never survived a real play through `apply`, and "the number written
   * during [Haste] is still readable at deployment" is precisely the kind of
   * claim that passes in-process and fails in a room.
   *
   * ⚠ WHY THE PREDICTION IS 24 AND NOT 30 — THIS IS THE WHOLE DESIGN. If the
   * owner predicts the life total he is already standing on and nothing changes
   * it, then the number checked at deployment and the number checked during
   * [Haste] are the SAME NUMBER, and a card that compared against the wrong one
   * would pass anyway. The scenario is therefore built so the two differ by
   * SIX: predict 24 while standing on 30, then shoot yourself for 6 with Arc
   * Lightning during battle. A miss is not silent either — the card prints its
   * own diagnosis, "predicted 24, life is 30 — no unit", which tells the owner
   * which of the two numbers it read.
   *
   * ⚠ THE ENTRY BOX SUGGESTS 30 ("where you stand now"), and taking the
   * suggestion is the one way to waste this scenario. `expect` says so twice.
   * It is also the R197 regression in miniature: the numeric entry has `min: 0,
   * max: null` because the old `payOrDecline` menu could not reach a prediction
   * more than five off where you stood.
   *
   * WHY THERE IS NO PROLOGUE. There cannot be. `endOfHaste` fires inside the
   * second `donePlanning`, so a prologue that finished planning would raise the
   * prediction decision MID-PROLOGUE and the next setup action would be refused
   * — `dealScenario` would throw `ScenarioError` and the owner would get no
   * board at all. The scenario therefore opens in planning, declares
   * `priority: null` (nobody holds priority in a planning phase), and the first
   * thing he clicks is DONE PLANNING.
   */
  'prediction-prophet-predict-the-future': {
    id: 'prediction-prophet-predict-the-future',
    card: 'Prediction Prophet',
    why: 'the drill answers the [Haste] prediction with the numeric entry\'s FLOOR (0) and has '
      + 'never matched (unreached.ts, BOARD). 40-light-c does match — but only by moving the life '
      + 'total with a white-box `e.loseLife` call. This is the first time the prediction has to '
      + 'survive a real spell, a real battle and a real regroup, and the predicted number differs '
      + 'from the [Haste]-time number by 6 so the card cannot pass by reading the wrong one.',
    expect:
      'Prediction Prophet asks you during [Haste] what your life will be at the START OF '
      + 'DEPLOYMENT — not what it is now. You are on 30 now and you are going to spend 6 of it.\n'
      + '1. Click DONE PLANNING. The Prophet asks for a number.\n'
      + '2. TYPE 24. ⚠ NOT the 30 it suggests — the suggestion is "where you stand now" and it is '
      + 'the wrong answer here on purpose.\n'
      + '3. Battle: attack with Rampart Guardian (the 0/4 — it has no power, so it changes '
      + 'nothing) to open a window.\n'
      + '4. Play Arc Lightning and aim it at YOURSELF (the option reads "You"). 6 damage. You go '
      + '30 → 24. Pass until deployment starts.\n'
      + 'EXPECTED: at the start of deployment the log reads "Prediction Prophet: the prediction of '
      + '24 was matched", and A 5/5 UNIT TOKEN APPEARS on your side.\n'
      + 'A WRONG ANSWER SAYS SO OUT LOUD: "predicted 24, life is 30 — no unit" means it checked '
      + 'your life at the wrong moment. "no prediction was made during [Haste]" means the number '
      + 'did not survive the battle. No 5/5 and no line at all means the deployment trigger never '
      + 'fired.\n'
      + '(Nobody else\'s life total moves in this game. The opponent should still be on 30.)',
    initiative: YOU,
    you: {
      hand: ['Arc Lightning'],
      // [0] the card under test, at home — and it STAYS home, so the 5/5 it
      //     creates arrives where you can see it (R115: a created unit arrives
      //     at its source's region).
      // [1] the 0/4 that opens the attack window without touching a life total.
      play: [{ card: 'Prediction Prophet' }, { card: 'Rampart Guardian' }],
      resources: { fire: 8, light: 4, earth: 4 },
    },
    opponent: {
      hand: [],
      play: [{ card: 'The Foretold' }],
      resources: { light: 2 },
    },
    // NO PROLOGUE — see the ⚠ above. The board opens in planning and the first
    // click is his.
    phase: 'planning',
    priority: null,
    needsLiveOpponent: false,
  },
};
