/* SCENARIO BATCH P — review boards for the replacement-order round (2026-10-25,
 * zero-handoff REPLACEMENT-ORDER; Nyar's Token Gesture report).
 *
 * Not card-correctness boards — review boards, like batches H to O.
 *
 *   review-replace-tokens       Automaton of Abundance and Cosmic Conspirator in
 *                               play, Manufacture and Self-Assembly in hand: you are
 *                               asked which applies first, once per creation
 *   review-replace-tokens-mod   the Automaton AUGMENTED onto the Conspirator: its
 *                               choice is the mod's own badge
 *   review-replace-default      Proliferating Slime and a Counter Thief of yours,
 *                               poison counters for their blocker: the order
 *                               question opens with a one-click default
 */
import type { Seat } from '../engine/src/types.ts';
import type { Scenario } from './scenarios.ts';

// a batch may import only TYPES from scenarios.ts (see 14-scenario-tester.md) — restate the seats
const YOU: Seat = 0;
const OPPONENT: Seat = 1;

/** planning → two declined battle rounds → deployment, with initiative pinned
 * to YOU (the attacker seats are hardcoded: see batch B's note) */
const TO_DEPLOY = [
  { type: 'donePlanning' as const, seat: YOU },
  { type: 'donePlanning' as const, seat: OPPONENT },
  { type: 'declareAttack' as const, seat: YOU, columns: [] },
  { type: 'declareAttack' as const, seat: OPPONENT, columns: [] },
];

export const BATCH_P: Record<string, Scenario> = {
  'review-replace-tokens': {
    id: 'review-replace-tokens',
    card: 'Automaton of Abundance',
    why: 'Nyar (Token Gesture, 2026-10-25): the game always applied Cosmic Conspirator before Automaton of '
      + 'Abundance and never asked. The creator now chooses, once per creation.',
    expect:
      'You have Automaton of Abundance and Cosmic Conspirator in play; it is your deployment.\n'
      + 'TRY: play Manufacture (a Robot 3, a Robot 2 and a Robot 1). The bar asks "Creating a Robot 3 — which '
      + 'applies first?" and both cards glow, wearing "Copy first" and "Swap first".\n'
      + 'TRY: click the Automaton. The Conspirator then asks about the Robot 3 AND about "the copy of the Robot 3", '
      + 'and the same for the 2 and the 1 — no second order question. Six tokens, any mix.\n'
      + 'TRY (Self-Assembly): click the Conspirator first and pick a Fireball — no copy (a Fireball is not a unit '
      + 'token). Or keep the Robot — it is copied, and the copy is NOT offered to the Conspirator again.',
    initiative: YOU,
    you: {
      hand: ['Manufacture', 'Self-Assembly'],
      play: [{ card: 'Automaton of Abundance' }, { card: 'Cosmic Conspirator' }],
      resources: { metal: 10 },
    },
    opponent: { hand: [], play: [], resources: {} },
    prologue: () => TO_DEPLOY,
    phase: 'deploy',
    priority: null,
    needsLiveOpponent: false,
  },

  'review-replace-tokens-mod': {
    id: 'review-replace-tokens-mod',
    card: 'Automaton of Abundance',
    why: 'An Automaton augmented onto the Conspirator acts from the Conspirator’s body, so both choices '
      + 'would name one unit. The Automaton choice is its mod badge.',
    expect:
      'Cosmic Conspirator is in play with Automaton of Abundance augmented onto it.\n'
      + 'TRY: play Self-Assembly. The order question opens: the Automaton badge under the Conspirator glows on '
      + 'its own, and clicking it chooses "Copy first".\n'
      + 'TRY (again, another game): click the Conspirator body instead — the bar asks which of the two you meant, '
      + 'with the cards.',
    initiative: YOU,
    you: {
      hand: ['Self-Assembly'],
      play: [{ card: 'Cosmic Conspirator', mods: [{ card: 'Automaton of Abundance', as: 'augment' }] }],
      resources: { metal: 4 },
    },
    opponent: { hand: [], play: [], resources: {} },
    prologue: () => TO_DEPLOY,
    phase: 'deploy',
    priority: null,
    needsLiveOpponent: false,
  },

  'review-replace-default': {
    id: 'review-replace-default',
    card: 'Proliferating Slime',
    why: 'The owner, 2026-10-25: where one order is "just worse", give the option, with a default that says it '
      + 'is the higher number — "Sorta like when blocking, how it asks Choose your split? Or just use default?".',
    expect:
      'You attacked with Pestilent Mycelion ({Poisonous}), Proliferating Slime and Counter Thief; they blocked '
      + 'the Mycelion with The Foretold. Blocks are in; you have priority.\n'
      + 'TRY: pass to combat damage. The Mycelion’s poison counter is headed for The Foretold, and your '
      + 'Slime (one more) and your Counter Thief (onto me instead) both apply. The bar says so and its first '
      + 'button is "Default: 2 counters on Counter Thief (the higher number)" — one click.\n'
      + 'LOOK: the Slime and the thief glow too, wearing "2 counters" and "1 counter": clicking the thief first '
      + 'moves the counter onto your own unit, where the Slime no longer applies.',
    initiative: YOU,
    you: {
      hand: [],
      play: [{ card: 'Pestilent Mycelion' }, { card: 'Proliferating Slime' }, { card: 'Counter Thief', counters: 3 }],
      resources: {},
    },
    opponent: { hand: [], play: [{ card: 'The Foretold' }], resources: {} },
    prologue: ids => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: YOU, columns: ids.you.map(id => [id]) },
      { type: 'passPriority', seat: YOU },
      { type: 'passPriority', seat: OPPONENT },
      { type: 'declareBlocks', seat: OPPONENT, blocks: { 0: [ids.opponent[0]!] } },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },
};
