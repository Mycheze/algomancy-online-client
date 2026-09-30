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
};
