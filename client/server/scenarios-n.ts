/* SCENARIO BATCH N — review boards for the mods-on-the-table round (owner,
 * 2026-10-18).
 *
 * Not card-correctness boards — review boards, like batches H to M. A modded
 * unit now stands taller on the table, each mod's foot showing under it, and
 * the `+Name` chip is gone. Two boards, each opened on the shortest real path
 * into what changed:
 *
 *   review-ui-mods-on-table   your units carry 0, 1, 2 and SEVEN mods: how
 *                             tall cards sit in In Play, in an attack column,
 *                             in the zoom, and named in the rail
 *   review-ui-mod-lands       your deployment, with two augments and a graft
 *                             in hand: play them and watch each one land and
 *                             its unit grow
 *
 * The opponent's augment arriving at the deployment reveal is not a board
 * here: their deployment is hidden until both are done, so it needs a second
 * seat (a slice of a live game is how it was reviewed).
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

export const BATCH_N: Record<string, Scenario> = {
  'review-ui-mods-on-table': {
    id: 'review-ui-mods-on-table',
    card: 'Chombot',
    why: 'You had to hover a unit to see it was modded. Now every mod — augment or graft — peeks '
      + 'out under its unit on the table, so a modded unit stands taller, without limit.',
    expect:
      'Your attack. Your units carry 0, 1, 2 and SEVEN mods.\n'
      + 'LOOK: each mod shows its foot under the unit, cut at its augment/graft symbol; no "+Name" chip.\n'
      + 'The Chombot with seven is very long. Chips, power/defense and damage stay on the card itself.\n'
      + 'TRY: hover a modded unit: the zoom hangs the same strips, big. Click it: the right column names\n'
      + 'each mod — hover a name to see that card.\n'
      + 'TRY: attack with the Chombot and the Devourer: the column makes room for the long card; the\n'
      + 'fight shrinks its cards a little rather than clipping one. Nothing should scroll or spill.',
    initiative: YOU,
    you: {
      hand: [],
      play: [
        { card: 'Bubb' },
        { card: 'Good Whale', mods: [{ card: 'Pallid Gorger', as: 'augment' }] },
        { card: 'Carapace Devourer', mods: [{ card: 'Graxxlid', as: 'augment' }, { card: 'Fight', as: 'graft' }] },
        {
          card: 'Chombot',
          mods: [
            { card: 'Slag Spewer', as: 'augment' }, { card: 'Hooba-Lin', as: 'augment' },
            { card: 'Soul Swallower', as: 'augment' }, { card: 'A Pile of Rubbish', as: 'augment' },
            { card: 'Throwing Boulder', as: 'augment' }, { card: 'Astralith', as: 'augment' },
            { card: 'Hand Peeper', as: 'augment' },
          ],
        },
      ],
      resources: {},
    },
    opponent: {
      hand: [],
      play: [{ card: 'Palewing', mods: [{ card: 'Soul Swallower', as: 'augment' }] }, { card: 'Trashling' }, { card: 'Bubb' }],
      resources: {},
    },
    prologue: () => [...START],
    phase: 'battle',
    priority: null,
    needsLiveOpponent: false,
  },

  'review-ui-mod-lands': {
    id: 'review-ui-mod-lands',
    card: 'Graxxlid',
    why: 'A mod played onto a unit used to fly into a tiny chip, and the unit itself did not change. '
      + 'Now it lands as a card tucked under the unit, and the unit grows by its foot.',
    expect:
      'Your DEPLOYMENT step. In hand: Graxxlid and Slag Spewer (augments) and Fight (a graft).\n'
      + 'TRY: augment the Bubb with Graxxlid. LOOK: the card flies in, settles UNDER the Bubb, and the\n'
      + 'Bubb is now taller, Graxxlid\'s foot showing. Then Slag Spewer onto the same Bubb: taller again.\n'
      + 'TRY: graft Fight onto the Good Whale (it already wears a Hand Peeper): a second strip under it.\n'
      + 'LOOK: the In Play row makes room; no card spills out of it.',
    initiative: YOU,
    you: {
      hand: ['Graxxlid', 'Slag Spewer', 'Fight'],
      play: [{ card: 'Bubb' }, { card: 'Good Whale', mods: [{ card: 'Hand Peeper', as: 'augment' }] }],
      // Graxxlid ee, Slag Spewer er, Fight e. Over-provisioned.
      resources: { earth: 6, fire: 3 },
    },
    opponent: { hand: [], play: [{ card: 'Palewing' }, { card: 'Bubb' }], resources: { earth: 2 } },
    prologue: () => [
      ...START,
      { type: 'declareAttack', seat: YOU, columns: [] },
      { type: 'declareAttack', seat: OPPONENT, columns: [] },
    ],
    phase: 'deploy',
    priority: null,
    needsLiveOpponent: false,
  },
};
