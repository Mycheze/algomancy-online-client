/* Scenario batch L: CARD FIXES of report round 2026-10-16 (b).
 *
 * Review boards for the round's card changes, one board per thing a player
 * would notice:
 *
 *   review-card-ambush-nothyr        an Ambush is a NONSPELL effect: Nothyr negates it,
 *                                    Dreadwave Devourer ("target spell effect") cannot
 *   review-card-ambush-reversal      Cosmic Reversal recalls your spell and leaves the
 *                                    Ambush on the stack, which then resolves
 *   review-card-tilling-one-unit     Tilling the Graves is not castable with one unit in
 *                                    your bin — and is once a second unit dies
 *   review-card-tilling-two-units    two units (and a spell) in your bin: both units are
 *                                    required, no stop at one, the spell is not offered
 *   review-card-blights-end-x        X is capped by the units in the fight, not the mana,
 *                                    and every one of the X targets is required
 *   review-card-tides-reveal         the opponent's Tides of the Cosmos shows YOU the
 *                                    eight cards as pictures, not only a log line
 *   review-card-big-glimpse-reveal   your own Big Glimpse Card shows you the seven while
 *                                    the opponent splits them
 *
 * Bins: `ScenarioSide` has no bin field, so the Tilling boards stock it the way
 * batch B does — units that die in the prologue's combat — and a spell that
 * resolves in the prologue. Every prologue `decide` is an option INDEX read off
 * a probe of this exact board; 186-scenario-library deals each one, so a menu
 * that moves refuses the deal by name.
 *
 * The reveal notice is drawn from the events of a live update, so the two
 * reveal boards stop with the revealing spell on the STACK: the owner's pass
 * resolves it, in front of him.
 */
import type { Seat } from '../engine/src/types.ts';
import type { Scenario } from './scenarios.ts';

// a batch may import only TYPES from scenarios.ts (see 14-scenario-tester.md) — restate the seats
const YOU: Seat = 0;
const OPPONENT: Seat = 1;

const START = [
  { type: 'donePlanning' as const, seat: YOU },
  { type: 'donePlanning' as const, seat: OPPONENT },
];

export const BATCH_L: Record<string, Scenario> = {
  /**
   * The Ambush alone on the stack. Nothyr's discard line ("negate up to one
   * target nonspell effect") reaches it; Dreadwave Devourer ("negate target
   * spell effect") has nothing to aim at, so it is not playable at all.
   */
  'review-card-ambush-nothyr': {
    id: 'review-card-ambush-nothyr',
    card: 'Nothyr',
    why: 'An Ambush on the stack used to count as a spell, so Nothyr ("nonspell effect") could not '
      + 'touch it and the spell-only cards could. It is a unit played during battle, not a spell.',
    expect:
      'You attacked with The Foretold. The opponent answered with Lurking Slimebeast as an AMBUSH:\n'
      + 'it is on the stack, about to recall their Bubb and take its place. You have priority.\n'
      + 'LOOK: Dreadwave Devourer ("Negate target spell effect") cannot be played — the only thing on\n'
      + 'the stack is the Ambush, and an Ambush is not a spell.\n'
      + 'TRY: click Nothyr and choose "Discard Nothyr" (pay 2 and trash it). Its trigger negates up to\n'
      + 'one target NONSPELL effect: the Ambush is offered — pick it, then pass.\n'
      + 'EXPECTED: the Ambush is negated. Lurking Slimebeast goes to their bin, and Bubb stays in play.',
    initiative: YOU,
    you: {
      hand: ['Nothyr', 'Dreadwave Devourer'],
      play: [{ card: 'The Foretold' }],
      // Nothyr's discard is d/2, Dreadwave Devourer bb/6 — the Devourer stays
      // payable after Nothyr, so the only reason it is greyed is its target
      resources: { dark: 3, water: 7 },
    },
    opponent: {
      hand: ['Lurking Slimebeast'],
      play: [{ card: 'Bubb' }],
      // the Ambush is b/3
      resources: { water: 3 },
    },
    prologue: ids => [
      ...START,
      { type: 'declareAttack', seat: YOU, columns: [[ids.you[0]!]] },
      { type: 'passPriority', seat: YOU },
      { type: 'playCard', seat: OPPONENT, handIndex: 0, mode: 'ambush' },
      { type: 'decide', seat: OPPONENT, choice: 0 },   // recall Bubb (their only ally)
    ],
    opponentHandAfterPrologue: [],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * Your spell under their Ambush. Cosmic Reversal ("recall all other spell
   * effects") takes the spell back and leaves the Ambush, which resolves.
   */
  'review-card-ambush-reversal': {
    id: 'review-card-ambush-reversal',
    card: 'Cosmic Reversal',
    why: 'The reported game: Cosmic Reversal recalled a Lurking Slimebeast Ambush off the stack. '
      + 'An Ambush is not a spell, so the Reversal must leave it alone.',
    expect:
      'You attacked and played Flame of History at the opponent (1 damage). They answered with\n'
      + 'Lurking Slimebeast as an AMBUSH, on top of it: it will recall their Bubb and take its place.\n'
      + 'You have priority.\n'
      + 'TRY: play Cosmic Reversal ("Recall all other spell effects and spell units"), then pass.\n'
      + 'EXPECTED: Flame of History comes back to your HAND — it is a spell. The Ambush is NOT\n'
      + 'recalled: it is still on the stack. Pass again: Lurking Slimebeast takes Bubb\'s place and\n'
      + 'Bubb goes back to their hand. Their life stays at 30, since the Flame never resolved.',
    initiative: YOU,
    you: {
      hand: ['Flame of History', 'Cosmic Reversal'],
      play: [{ card: 'The Foretold' }],
      // Flame of History r/1, Cosmic Reversal bb/2
      resources: { fire: 2, water: 4 },
    },
    opponent: {
      hand: ['Lurking Slimebeast'],
      play: [{ card: 'Bubb' }],
      resources: { water: 3 },
    },
    prologue: ids => [
      ...START,
      { type: 'declareAttack', seat: YOU, columns: [[ids.you[0]!]] },
      { type: 'playCard', seat: YOU, handIndex: 0 },     // Flame of History…
      { type: 'decide', seat: YOU, choice: 2 },          // …at the opponent (option 2)
      { type: 'playCard', seat: OPPONENT, handIndex: 0, mode: 'ambush' },
      { type: 'decide', seat: OPPONENT, choice: 0 },     // recall Bubb
    ],
    handAfterPrologue: ['Cosmic Reversal'],
    opponentHandAfterPrologue: [],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * After combat, ONE unit in your bin: Tilling the Graves ("Recall two target
   * units in your bin") is not castable. Luminous Arc on your own survivor
   * puts a second unit there, and then it is.
   */
  'review-card-tilling-one-unit': {
    id: 'review-card-tilling-one-unit',
    card: 'Tilling the Graves',
    why: 'Tilling the Graves could be cast with fewer than two units in the bin, recalling one or '
      + 'none. It says "two target units", not "up to two", so it needs both to be cast.',
    expect:
      'After combat. One of your The Foretolds traded with their blocker, so your bin holds ONE unit.\n'
      + 'Your other The Foretold got through unblocked and is still in the battle. You have priority.\n'
      + 'LOOK: Tilling the Graves ("Recall two target units in your bin") cannot be played — one unit\n'
      + 'is not two. You have the mana for it.\n'
      + 'TRY: play Luminous Arc at your own The Foretold and pass, so it dies and your bin holds two.\n'
      + 'EXPECTED: now Tilling the Graves CAN be played. Play it: you must pick BOTH The Foretolds —\n'
      + 'there is no "No more targets" after the first. Pass: both come back to your hand, then you\n'
      + 'discard a card.',
    initiative: YOU,
    you: {
      hand: ['Tilling the Graves', 'Luminous Arc'],
      play: [{ card: 'The Foretold' }, { card: 'The Foretold' }],
      // Tilling the Graves dd/4, Luminous Arc r/2
      resources: { dark: 4, fire: 2 },
    },
    opponent: {
      hand: [],
      play: [{ card: 'The Foretold' }],
      resources: {},
    },
    prologue: ids => [
      ...START,
      { type: 'declareAttack', seat: YOU, columns: [[ids.you[0]!], [ids.you[1]!]] },
      { type: 'passPriority', seat: YOU },
      { type: 'passPriority', seat: OPPONENT },
      // 3/3 into 3/3: both die, one card in each bin
      { type: 'declareBlocks', seat: OPPONENT, blocks: { 0: [ids.opponent[0]!] } },
      { type: 'passPriority', seat: YOU },
      { type: 'passPriority', seat: OPPONENT },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * Two units and a spell in your bin: castable, both units required, and
   * the spell is never a target.
   */
  'review-card-tilling-two-units': {
    id: 'review-card-tilling-two-units',
    card: 'Tilling the Graves',
    why: 'With "two target units" both targets are required: the menu used to offer "No more targets" '
      + 'after one. A spell in the bin is there to show only units are offered.',
    expect:
      'After combat. Two of your The Foretolds traded with their blockers, and Luminous Arc killed\n'
      + 'their Bubb earlier, so your bin holds two units AND a spell. You have priority.\n'
      + 'TRY: play Tilling the Graves ("Recall two target units in your bin, then discard a card").\n'
      + 'LOOK: only the two The Foretolds are offered — never Luminous Arc — and after you pick the\n'
      + 'first there is NO "No more targets" button: the second is required.\n'
      + 'Then pass: both The Foretolds come back to your hand, and you discard a card.',
    initiative: YOU,
    you: {
      hand: ['Luminous Arc', 'Tilling the Graves'],
      play: [{ card: 'The Foretold' }, { card: 'The Foretold' }, { card: 'The Foretold' }],
      resources: { fire: 2, dark: 4 },
    },
    opponent: {
      hand: [],
      play: [{ card: 'The Foretold' }, { card: 'The Foretold' }, { card: 'Bubb' }],
      resources: {},
    },
    prologue: ids => [
      ...START,
      { type: 'declareAttack', seat: YOU, columns: [[ids.you[0]!], [ids.you[1]!], [ids.you[2]!]] },
      { type: 'playCard', seat: YOU, handIndex: 0 },     // Luminous Arc…
      { type: 'decide', seat: YOU, choice: 5 },          // …at their Bubb (option 5)
      { type: 'passPriority', seat: OPPONENT },
      { type: 'passPriority', seat: YOU },               // the Arc resolves: Bubb dies
      { type: 'passPriority', seat: YOU },               // the empty window closes…
      { type: 'passPriority', seat: OPPONENT },          // …into the block step
      { type: 'declareBlocks', seat: OPPONENT, blocks: { 0: [ids.opponent[0]!], 1: [ids.opponent[1]!] } },
      { type: 'passPriority', seat: YOU },
      { type: 'passPriority', seat: OPPONENT },
    ],
    handAfterPrologue: ['Tilling the Graves'],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * Three units in the fight and mana for more: X stops at 3, and at X = 3
   * all three are required.
   */
  'review-card-blights-end-x': {
    id: 'review-card-blights-end-x',
    card: "Blight's End",
    why: 'X spells with "X target units" offered any X the mana could pay, then let you stop '
      + 'short of X targets. X is now capped by what the board can fill, and all X are required.',
    expect:
      'You attacked with two The Foretolds; their Bubb is in the battle too. Your Crumbling Ancient\n'
      + 'stayed home, out of the fight. That is THREE units in the battle. You have priority and 8 mana.\n'
      + 'TRY: play Blight\'s End ("Augment a Wight onto X target units").\n'
      + 'LOOK: the X choice goes 0, 1, 2, 3 and stops — not as high as your mana would pay. Crumbling\n'
      + 'Ancient does not count: it is not in this battle.\n'
      + 'TRY: pick X = 3. You must pick all three units: no "No more targets" before the third.\n'
      + 'Pass: each of the three gets a Wraith augmented under it (the card\'s "Wight").',
    initiative: YOU,
    you: {
      hand: ["Blight's End"],
      play: [{ card: 'The Foretold' }, { card: 'The Foretold' }, { card: 'Crumbling Ancient' }],
      resources: { wood: 4, dark: 4 },
    },
    opponent: {
      hand: [],
      play: [{ card: 'Bubb' }],
      resources: {},
    },
    prologue: ids => [
      ...START,
      { type: 'declareAttack', seat: YOU, columns: [[ids.you[0]!], [ids.you[1]!]] },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * The opponent's Tides of the Cosmos on the stack. The owner's pass
   * resolves it live, so the reveal arrives in an update and the notice
   * draws it.
   */
  'review-card-tides-reveal': {
    id: 'review-card-tides-reveal',
    card: 'Tides of the Cosmos',
    why: 'When the opponent\'s Tides of the Cosmos revealed eight cards, you got one line of names in '
      + 'the log and no cards. The reveal is public, so you are now shown the cards themselves.',
    expect:
      'You attacked; the opponent played Tides of the Cosmos ("Reveal the top eight cards of the\n'
      + 'deck…"). It is on the stack and you have priority.\n'
      + 'TRY: pass, so it resolves.\n'
      + 'LOOK: a notice pops up over the board with EIGHT card pictures, headed "Tester Bot revealed 8\n'
      + '— Tides of the Cosmos" (their name), the same eight as the log line. It goes away on its own\n'
      + 'after a few seconds, or click it. The bot then takes the first one or two it is offered and\n'
      + 'plays them for free (they land on the stack) and recycles the rest — that part is not under test.',
    initiative: YOU,
    you: {
      hand: [],
      play: [{ card: 'The Foretold' }],
      resources: {},
    },
    opponent: {
      hand: ['Tides of the Cosmos'],
      play: [],
      // Tides of the Cosmos is bbb/8
      resources: { water: 8 },
    },
    prologue: ids => [
      ...START,
      { type: 'declareAttack', seat: YOU, columns: [[ids.you[0]!]] },
      { type: 'passPriority', seat: YOU },
      { type: 'playCard', seat: OPPONENT, handIndex: 0 },
    ],
    opponentHandAfterPrologue: [],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * Your own Big Glimpse Card: the opponent splits with the seven as scans,
   * and you — who then pick a pile — are now shown them as cards too.
   */
  'review-card-big-glimpse-reveal': {
    id: 'review-card-big-glimpse-reveal',
    card: 'Big Glimpse Card',
    why: 'Big Glimpse Card\'s caster had only a log line of the seven cards while the opponent '
      + 'split them with the pictures in front of them. The caster now sees the cards too.',
    expect:
      'You attacked; you have priority.\n'
      + 'TRY: play Big Glimpse Card ("Reveal the top 7 cards of the deck. Target opponent splits them\n'
      + 'into two piles…"), aim it at the opponent, and pass.\n'
      + 'LOOK: a notice pops up with SEVEN card pictures, headed "You revealed 7 — Big Glimpse Card".\n'
      + 'The opponent splits them (the bot does it at once and puts all seven in Pile 1), then you\n'
      + 'choose which pile to cache — the same seven cards. The opponent\'s own view (the split, with\n'
      + 'the cards) is unchanged and gets no notice.',
    initiative: YOU,
    you: {
      hand: ['Big Glimpse Card'],
      play: [{ card: 'The Foretold' }],
      // Big Glimpse Card is lb/4
      resources: { light: 2, water: 2 },
    },
    opponent: {
      hand: [],
      play: [],
      resources: {},
    },
    prologue: ids => [
      ...START,
      { type: 'declareAttack', seat: YOU, columns: [[ids.you[0]!]] },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },
};
