/* SCENARIO BATCH O — review boards for the board round (2026-10-25).
 *
 * Not card-correctness boards — review boards, like batches H to N.
 *
 *   review-ui-placewarn       they attack your region; you are declaring blocks
 *                             with a Feeble unit and no flyer. Drag the Feeble
 *                             unit into a column, or a ground unit against
 *                             their flyer: the card wears a (!) before Confirm
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

export const BATCH_O: Record<string, Scenario> = {
  'review-ui-placewarn': {
    id: 'review-ui-placewarn',
    card: 'Bripp',
    why: 'Report #284: a Feeble unit could be dragged into a block column and was only refused on '
      + 'Confirm. The drag stays; the card now wears a (!) while it stands where Confirm would refuse it.',
    expect:
      'They attacked YOUR region with two columns: a plain unit and a flyer. You are declaring blocks.\n'
      + 'TRY: drag Bripp into either column — a red (!) sits on its art and the bar says why. Drag it out: '
      + 'the (!) goes.\n'
      + 'TRY: put Good Whale against the flyer — it gets the (!) (only flyers block flyers).\n'
      + 'LOOK: a legal block (Good Whale against the plain unit) shows nothing.',
    initiative: OPPONENT,
    you: {
      hand: [],
      play: [{ card: 'Bripp' }, { card: 'Good Whale' }, { card: 'Rampart Guardian' }],
      resources: {},
    },
    opponent: {
      hand: [],
      play: [{ card: 'The Foretold' }, { card: 'Ephemeral Skywalker' }],
      resources: {},
    },
    prologue: ids => [
      ...START,
      { type: 'declareAttack', seat: OPPONENT, columns: ids.opponent.map(id => [id]) },
      { type: 'passPriority', seat: OPPONENT },
      { type: 'passPriority', seat: YOU },
    ],
    phase: 'battle',
    priority: null,
    needsLiveOpponent: false,
  },
};
