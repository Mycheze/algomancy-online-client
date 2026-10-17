/* Scenario batch M: review boards for report round 2026-10-16 (b) — the new interfaces.
 *
 * Not card-correctness boards — review boards, like batches H, I and J. Two
 * pieces of new on-screen machinery, each opened on the shortest real path
 * into it:
 *
 *   review-ui-trigger-order   one attack sets off FOUR different triggers of
 *                             yours at once: build the order on screen (numbers,
 *                             take one back, Start over), the last one placed
 *                             by itself, then Confirm order
 *   review-ui-burst-undo      three Fireballs at home while they attack you:
 *                             cast them as one group, ordered pick by pick,
 *                             with Undo last pick and Start over
 *
 * The third interface of the round — "Beta: propose a fix" — is NOT here, and
 * cannot be: the server refuses every fix in a scenario room (rooms.ts
 * fixesRefusal: "fixes are for a game between two players"), so a board here
 * would open with the menu entry missing. It is reviewed in an ordinary
 * two-tab game instead.
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

export const BATCH_M: Record<string, Scenario> = {
  'review-ui-trigger-order': {
    id: 'review-ui-trigger-order',
    card: 'Aberrant Populace',
    why: 'Ordering several of your own triggers at once used to be one click per trigger with no '
      + 'way back; it is now built on screen — numbered picks, take one back, Start over, the last '
      + 'one placed by itself — and sent once, with Confirm order.',
    expect:
      'Your attack. Each of your four units triggers when it attacks: Warbloom Herald (your units +1/+0),\n'
      + 'Guardian of the Grotto (+0/+1), Aberrant Populace (two Wisps), Metamorphic Luminary (a Crystal 1).\n'
      + 'TRY: attack with all four. LOOK: one question — order your triggers, first picked resolves first.\n'
      + 'TRY: pick one: it stays in place, dimmed, with a big 1, and its unit on the board wears #1. Pick a second (2).\n'
      + 'TRY: click the 1: it AND the 2 go back. Pick two again, then Start over (or Esc): all clear, auto-stack is back.\n'
      + 'TRY: pick three: the fourth is placed by itself and Confirm order appears. Nothing is sent until you press it (or Enter).\n'
      + 'Pick Populace first and its Wisps arrive before the two buffs resolve: they end 1/2, not 0/1.',
    initiative: YOU,
    you: {
      hand: [],
      play: [
        { card: 'Warbloom Herald' }, { card: 'Guardian of the Grotto' },
        { card: 'Aberrant Populace' }, { card: 'Metamorphic Luminary' },
      ],
      resources: {},
    },
    opponent: {
      hand: [],
      play: [{ card: 'Trashling' }, { card: 'The Foretold' }],
      resources: {},
    },
    prologue: () => [...START],
    phase: 'battle',
    priority: null,
    needsLiveOpponent: false,
  },

  'review-ui-burst-undo': {
    id: 'review-ui-burst-undo',
    card: 'Fireball',
    why: 'Casting a group of spell tokens together asks which resolves first, one pick at a time. '
      + 'A wrong pick used to cost the whole group; now Undo last pick steps back one, and Cancel '
      + 'reads Start over.',
    expect:
      'They attacked YOUR region with Trashling and The Foretold; you have priority. Your three Ignis Sprites\n'
      + 'each made a Fireball 1 when they arrived, so three Fireballs sit at home — they must be cast together.\n'
      + 'TRY: click a Fireball. LOOK: "pick the one that resolves first" — all three light up; click one, then aim it.\n'
      + 'LOOK: the strip numbers the order as you build it, each with its aim ("→ …").\n'
      + 'TRY: Undo last pick — ONE step back each press: the last aim, then the last pick. It shows only once something is picked.\n'
      + 'TRY: Start over drops the whole group back into play, nothing cast. Then cast all three for real and pass:\n'
      + 'they resolve in the order you numbered them.',
    initiative: OPPONENT,
    you: {
      hand: [],
      play: [{ card: 'Ignis Sprite' }, { card: 'Ignis Sprite' }, { card: 'Ignis Sprite' }],
      resources: {},
    },
    opponent: {
      hand: [],
      play: [{ card: 'Trashling' }, { card: 'The Foretold' }, { card: 'Bubb' }],
      resources: {},
    },
    prologue: ids => [
      ...START,
      { type: 'declareAttack', seat: OPPONENT, columns: [[ids.opponent[0]!], [ids.opponent[1]!]] },
      { type: 'passPriority', seat: OPPONENT },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },
};
