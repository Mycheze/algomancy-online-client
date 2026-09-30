/* Scenario batch H: THE COUNTERATTACK BUILD (owner, 2026-09-30; report #179).
 *
 * Not a card-correctness board — the rules of a counterattack are settled.
 * What it puts in front of the owner is the round-2 declare the report named:
 *
 *   "Counter attack UI is pretty bad. There should be a special layout for
 *    choosing how to build your formation"
 *
 * and the layout the owner chose for it the same day: the sent units shown
 * full-size as a tray in the fight block nearest your home, every front and
 * back slot drawn up front, the bar saying "Build your counterattack (N
 * sent)", and one-click shapes (one column / pairs) beside "Attack with
 * everything".
 *
 * The board opens on that declare: the opponent attacked you with one unit,
 * you blocked nothing and sent all four of yours, round 1 resolved, and round
 * 2 is waiting for you to build the counterattack in THEIR region.
 */
import type { Seat } from '../engine/src/types.ts';
import type { Scenario } from './scenarios.ts';

// R218: a batch may import only TYPES from scenarios.ts — restate the seats
const YOU: Seat = 0;
const OPPONENT: Seat = 1;

/** blocker-gone: Luminous Arc's option for your Good Whale */
const ARC_WHALE = 0;

export const BATCH_H: Record<string, Scenario> = {
  'counter-build': {
    id: 'counter-build',
    card: 'The Foretold',
    why: 'Report #179: building a counterattack was cramped — the sent units stood in a small strip '
      + 'at the side of the fight and the columns appeared one at a time. The owner chose a layout '
      + 'for it; this board opens on it.',
    expect:
      'It is round 2 of the battle: you sent four units to counterattack and now build their formation.\n'
      + 'WHAT TO JUDGE: the four sent units stand FULL-SIZE in a "sent units" tray along the foot of\n'
      + 'the fight (on a short screen, beside the columns instead, so no back slot is cut off); every\n'
      + 'front and back slot of four columns is drawn; the bar says "Build your counterattack (4 sent)".\n'
      + 'TRY:\n'
      + '  · "Pairs" — builds front-and-back pairs at once; adjust it after. (With two sent, the\n'
      + '    button is "One column"; a column holds two.)\n'
      + '  · Click a unit then a slot, drag one, or pick one up and press a number key.\n'
      + '  · Put a unit in a back slot with nobody in front, then ✕ Clear.\n'
      + '  · Attack! — the opponent will not block.',
    initiative: OPPONENT,
    you: {
      hand: [],
      play: [
        { card: 'The Foretold' },
        { card: 'Bumblecrab' },
        { card: 'Carapace Devourer' },
        { card: 'Crumbling Ancient' },
      ],
      resources: {},
    },
    opponent: {
      hand: [],
      // one to attack you with (so there is a round 1 to send from), one at
      // home for the counterattack to meet
      play: [{ card: 'The Foretold' }, { card: 'Bubb' }],
      resources: {},
    },
    prologue: ids => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: OPPONENT, columns: [[ids.opponent[0]!]] },
      { type: 'passPriority', seat: OPPONENT },
      { type: 'passPriority', seat: YOU },
      // no blocks; every unit of yours is sent to counterattack
      { type: 'declareBlocks', seat: YOU, blocks: {}, send: [...ids.you] },
      { type: 'passPriority', seat: OPPONENT },
      { type: 'passPriority', seat: YOU },
      { type: 'passPriority', seat: OPPONENT },
      { type: 'passPriority', seat: YOU },
    ],
    phase: 'battle',
    priority: null,
    needsLiveOpponent: false,
  },
  /**
   * CT-189 / R307. The owner's own board-pick-stack, with the two retarget
   * cards in hand instead of Fireball: the opponent's Twin Flame is on the
   * stack aimed at your Bubb and your Chitin Shredder.
   */
  'retarget-twin-flame': {
    id: 'retarget-twin-flame',
    card: 'Divine Intervention',
    why: 'CT-189: Divine Intervention could move both of Twin Flame\'s targets onto one unit (4 damage '
      + 'to it), or move one target onto the other. Gravitational Correction had the same hole.',
    expect:
      'The opponent\'s Twin Flame is on the stack, aimed at your Bubb and your Chitin Shredder.\n'
      + 'WHAT TO JUDGE: no unit can end up as BOTH of Twin Flame\'s targets.\n'
      + 'TRY:\n'
      + '  · Divine Intervention → click Twin Flame on the stack. For the FIRST target pick their Good\n'
      + '    Whale. For the SECOND, their Good Whale must no longer glow — and your Bubb (the first\n'
      + '    target, now moved away) may. Pass, and Twin Flame deals 2 to two different units.\n'
      + '  · Open it again and, for the first target, try your Chitin Shredder (the OTHER target):\n'
      + '    it must not glow — one unit cannot be both targets.\n'
      + '  · Open it again with Gravitational Correction: pick X = 2 or more (they have 1 mana open,\n'
      + '    so they cannot pay it off), click Twin Flame, pass — then the same two rules hold.',
    initiative: YOU,
    you: {
      hand: ['Divine Intervention', 'Gravitational Correction'],
      play: [{ card: 'Good Whale' }, { card: 'Bubb' }, { card: 'Chitin Shredder' }],
      resources: { light: 3, fire: 3 },
    },
    opponent: { hand: ['Twin Flame'], play: [{ card: 'Bubb' }, { card: 'Good Whale' }], resources: { fire: 4 } },
    prologue: ids => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: YOU, columns: ids.you.map(id => [id]) },
      { type: 'passPriority', seat: YOU },
      { type: 'playCard', seat: OPPONENT, handIndex: 0 },
      // Twin Flame's two targets by option index, as board-pick-stack: your
      // Bubb, then (the menu rebuilt without it) your Chitin Shredder
      { type: 'decide', seat: OPPONENT, choice: 1 },
      { type: 'decide', seat: OPPONENT, choice: 1 },
    ],
    opponentHandAfterPrologue: [],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * Report #176 (EGBM) / CT-190. The opponent attacks with two columns; your
   * Dreadwave Devourer (a spell unit) blocks the first; their Cosmic Reversal
   * recalls every spell unit — your blocker with it. R185: the column stays
   * blocked. The board used to call it "unblocked".
   */
  'blocker-gone': {
    id: 'blocker-gone',
    card: 'Luminous Arc',
    why: 'Report #176: a column whose blocker was removed was drawn "unblocked", though the engine '
      + '(R185) keeps it blocked and it deals no damage.',
    expect:
      'The opponent attacked with Bubb and Chitin Shredder. Your Good Whale blocked the Bubb, then\n'
      + 'their Luminous Arc killed it.\n'
      + 'WHAT TO JUDGE: the Bubb\'s column must read "blocker gone", NOT "unblocked" (hover it for the\n'
      + 'full sentence); the Chitin Shredder\'s column (never blocked) still reads "unblocked".\n'
      + 'TRY: pass to combat. The Bubb deals you nothing; only the Shredder reaches you — 2 life, as it\n'
      + 'is {Powerful}.\n'
      + 'Toggle the board (▦) to check the classic board says the same.',
    initiative: OPPONENT,
    you: {
      hand: [],
      play: [{ card: 'Good Whale' }],
      resources: {},
    },
    opponent: {
      hand: ['Luminous Arc'],
      play: [{ card: 'Bubb' }, { card: 'Chitin Shredder' }],
      resources: { fire: 6 },
    },
    prologue: ids => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: OPPONENT, columns: [[ids.opponent[0]!], [ids.opponent[1]!]] },
      { type: 'passPriority', seat: OPPONENT },
      { type: 'passPriority', seat: YOU },
      { type: 'declareBlocks', seat: YOU, blocks: { 0: [ids.you[0]!] }, send: [] },
      { type: 'playCard', seat: OPPONENT, handIndex: 0 },
      // Luminous Arc's target by option index: your Good Whale, read off a
      // probe of this board. ⚠ A menu that moved would kill a different unit
      // and still land in the block window — the expect text is what makes
      // that visible (it says whose column should read "blocker gone").
      { type: 'decide', seat: OPPONENT, choice: ARC_WHALE },
      { type: 'passPriority', seat: YOU },
      { type: 'passPriority', seat: OPPONENT },
      // Luminous Arc resolved and priority went back to the attacker. The
      // scripted bot only moves in answer to an action, so it cannot be left
      // holding priority at the deal: it passes here, and the board opens on
      // yours
      { type: 'passPriority', seat: OPPONENT },
    ],
    opponentHandAfterPrologue: [],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * Report #177 / CT-191, attacking side: the fight is in THEIR region, so the
   * seen hand should float over YOUR In Play.
   */
  'seen-hand-attacking': {
    id: 'seen-hand-attacking',
    card: 'Thought Extraction',
    why: 'Report #177: the "Their hand, seen" strip was clipped out of sight during a battle on the '
      + 'regions board.',
    expect:
      'You are attacking the opponent\'s region; the first window is yours.\n'
      + 'DO: play Thought Extraction on the opponent. You see their hand and discard a card from it.\n'
      + 'WHAT TO JUDGE: the "👁 Their hand, seen" strip appears and stays visible for the rest of the\n'
      + 'battle, floating over YOUR In Play (the region not being fought in), not hidden, and not on\n'
      + 'top of the stack or the fight. Its ✕ and dismiss must still work. Try a narrow window too.',
    initiative: YOU,
    you: {
      hand: ['Thought Extraction'],
      play: [{ card: 'Good Whale' }, { card: 'Bubb' }],
      resources: { dark: 2 },
    },
    opponent: {
      hand: ['Fireball', 'Recall', 'Twin Flame', 'Bubb'],
      play: [{ card: 'Chitin Shredder' }],
      resources: {},
    },
    prologue: ids => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: YOU, columns: ids.you.map(id => [id]) },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * Report #177 / CT-191, defending side: the fight is in YOUR region, so the
   * seen hand should float over THEIR In Play.
   */
  'seen-hand-defending': {
    id: 'seen-hand-defending',
    card: 'Thought Extraction',
    why: 'Report #177, the other side: the strip must move to the other region when the fight is in yours.',
    expect:
      'The opponent is attacking YOUR region; you have priority.\n'
      + 'DO: play Thought Extraction on the opponent.\n'
      + 'WHAT TO JUDGE: the "👁 Their hand, seen" strip floats over THEIR In Play (the region not being\n'
      + 'fought in this time), visible and clickable, clear of the stack and the fight.',
    initiative: OPPONENT,
    you: {
      hand: ['Thought Extraction'],
      play: [{ card: 'Good Whale' }],
      resources: { dark: 2 },
    },
    opponent: {
      hand: ['Fireball', 'Recall', 'Twin Flame', 'Bubb'],
      play: [{ card: 'Chitin Shredder' }, { card: 'Bubb' }],
      resources: {},
    },
    prologue: ids => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: OPPONENT, columns: ids.opponent.map(id => [id]) },
      { type: 'passPriority', seat: OPPONENT },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * CT-182: the report form holds auto-pass. Needs a second human: the bot
   * never holds priority long enough for a hold to be visible.
   */
  'report-hold': {
    id: 'report-hold',
    card: 'Fireball',
    why: 'CT-182: with a standing auto-pass, the game used to pass for you while the report form was '
      + 'open, so the moment you were reporting moved on under you.',
    expect:
      'TWO TABS: this one is seat 0 (You, empty hand — passing is your only move); open the seat 1\n'
      + 'link in a second tab for the opponent, who holds priority with three spells.\n'
      + 'DO, in order:\n'
      + '  1. Seat 0: turn "auto-pass" ON in the side panel.\n'
      + '  2. Seat 0: open the Report form (📝 report) and leave it open.\n'
      + '  3. Seat 1: play a Fireball at seat 0 (click it, then seat 0\'s life). Priority goes to seat 0.\n'
      + 'WHAT TO JUDGE: while seat 0\'s report form is open, the game WAITS on seat 0 — seat 1\'s tab\n'
      + 'says it is waiting, and it stays waiting well past two seconds. Close the form on seat 0:\n'
      + 'it passes at once. Control: with the form closed, the same play is passed straight through.\n'
      + 'The rules reference (? rules) must NOT hold it — only the report form.',
    initiative: OPPONENT,
    you: {
      hand: [],
      play: [{ card: 'Good Whale' }],
      resources: {},
    },
    opponent: {
      hand: ['Fireball', 'Fireball', 'Fireball'],
      play: [{ card: 'Bubb' }],
      resources: { fire: 9 },
    },
    prologue: ids => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: OPPONENT, columns: [[ids.opponent[0]!]] },
    ],
    phase: 'battle',
    priority: OPPONENT,
    needsLiveOpponent: true,
  },
};
