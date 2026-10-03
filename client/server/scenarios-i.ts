/* Scenario batch I: THE STACK, WATCHED (owner, 2026-10-03).
 *
 * Not card-correctness boards — review boards, like batch H. The owner asked
 * for the stack's visual side to be fixed ("the card going onto the stack
 * flashes in weird ways, seems to move to weird areas") and chose, for a play
 * nobody can respond to, ONE clean trip: hand → stack → board. These open on
 * the moments that used to go wrong, so the fix can be judged by eye:
 *
 *   stack-trip-units          plain deployments, and two in quick succession
 *   stack-trip-token-trigger  a unit whose spawn trigger makes a token
 *   stack-trip-spell-tokens   a spell that makes tokens, plus a trigger it sets off
 *   stack-trip-cast-cancel    a targeted spell: out of the hand, back on cancel
 *   stack-trip-haste          the haste step's plays
 *   stack-trip-battle         a spell on the real (respondable) stack
 *
 * Motion is a viewer preference (the ✨ toggle), not part of a board, so each
 * `expect` says to have it on — with it off there is no journey to judge.
 */
import type { Seat } from '../engine/src/types.ts';
import type { Scenario } from './scenarios.ts';

// R218: a batch may import only TYPES from scenarios.ts — restate the seats
const YOU: Seat = 0;
const OPPONENT: Seat = 1;

/** planning done, nobody attacks: straight into deployment */
const toDeployment = [
  { type: 'donePlanning' as const, seat: YOU },
  { type: 'donePlanning' as const, seat: OPPONENT },
  { type: 'declareAttack' as const, seat: YOU, columns: [] },
  { type: 'declareAttack' as const, seat: OPPONENT, columns: [] },
];

const WATCH =
  'Motion must be on (✨ motion: on, in the side panel).\n'
  + 'WHAT TO JUDGE: each card makes ONE trip — out of your hand, into the stack window, a moment\n'
  + 'there, then onto the board (or into the bin). It is never in two places at once. The window\n'
  + 'fades in where it opens, stays put while it has cards, and fades out when the last one leaves.\n';

export const BATCH_I: Record<string, Scenario> = {
  'stack-trip-units': {
    id: 'stack-trip-units',
    card: 'Ephemeral Skywalker',
    why: 'A deployed unit used to stand on the board at once while a copy flew to the stack and a '
      + 'third sat there as "just resolved".',
    expect:
      WATCH
      + 'It is your DEPLOYMENT step.\n'
      + '  1. Play Ephemeral Skywalker. Watch it fly to the stack window, sit, then fly to your region.\n'
      + '  2. Play Sparkwraith and then Soul Swallower quickly, one right after the other. The second\n'
      + '     waits its turn (one thing a second) and then drops into the window; the window must not\n'
      + '     jump or re-centre while both are in it.',
    initiative: YOU,
    you: {
      hand: ['Ephemeral Skywalker', 'Sparkwraith', 'Soul Swallower'],
      play: [],
      resources: { fire: 6 },
    },
    opponent: { hand: [], play: [{ card: 'Bubb' }], resources: { earth: 2 } },
    prologue: () => toDeployment,
    phase: 'deploy',
    priority: null,
    needsLiveOpponent: false,
  },

  'stack-trip-token-trigger': {
    id: 'stack-trip-token-trigger',
    card: 'Ignis Sprite',
    why: 'A unit with a spawn trigger: the unit, its trigger and the token the trigger makes each '
      + 'have their own moment, and the token used to pop in from nowhere.',
    expect:
      WATCH
      + 'It is your DEPLOYMENT step.\n'
      + '  1. Play Ignis Sprite. It flies to the stack, then to your region.\n'
      + '  2. Its trigger ("Create a Fireball 1") joins the window, and when it resolves the Fireball\n'
      + '     flies OUT of that trigger card to your token strip — it does not just appear.\n'
      + '  3. The count under the window never says "Ignis Sprite ×2" for a unit and its own trigger.',
    initiative: YOU,
    you: {
      hand: ['Ignis Sprite', 'Ignis Sprite'],
      play: [],
      resources: { fire: 4 },
    },
    opponent: { hand: [], play: [{ card: 'Bubb' }], resources: { earth: 2 } },
    prologue: () => toDeployment,
    phase: 'deploy',
    priority: null,
    needsLiveOpponent: false,
  },

  'stack-trip-spell-tokens': {
    id: 'stack-trip-spell-tokens',
    card: 'Flame Juggle',
    why: 'A spell that makes tokens and sets off a trigger: three results and a bin trip from one '
      + 'card, plus a trigger whose result is a counter (nothing to fly to).',
    expect:
      WATCH
      + 'It is your DEPLOYMENT step. Sparkwraith is already on your board.\n'
      + '  1. Play Flame Juggle. It flies to the stack window.\n'
      + '  2. Sparkwraith\'s trigger (+1/+1 counter, because you played a spell) leaps off Sparkwraith\n'
      + '     into the window too.\n'
      + '  3. When the Juggle resolves, three Fireballs fly out of it to your token strip and the Juggle\n'
      + '     card goes to your bin. Its copy is not in the bin before then.\n'
      + '  4. The trigger has nothing to fly to: it fades in the window, and Sparkwraith gets its counter.',
    initiative: YOU,
    you: {
      hand: ['Flame Juggle'],
      play: [{ card: 'Sparkwraith' }],
      resources: { fire: 4 },
    },
    opponent: { hand: [], play: [{ card: 'Bubb' }], resources: { earth: 2 } },
    prologue: () => toDeployment,
    phase: 'deploy',
    priority: null,
    needsLiveOpponent: false,
  },

  'stack-trip-cast-cancel': {
    id: 'stack-trip-cast-cancel',
    card: 'Overbloom',
    why: 'Starting a cast that asks for a target used to teleport the card out of the hand, and a '
      + 'cancel popped it back with no trip at all.',
    expect:
      WATCH
      + 'It is your DEPLOYMENT step. Ephemeral Skywalker (3/1) is on your board.\n'
      + '  1. Play Overbloom. It FLIES out of your hand to the spot where it waits while you choose a\n'
      + '     target (dashed border). It does not fade out in your hand while appearing elsewhere.\n'
      + '  2. Cancel. It flies back into your hand.\n'
      + '  3. Play it again and click the Skywalker. It slides into the stack window, then goes to your\n'
      + '     bin, and the Skywalker becomes 10/8.',
    initiative: YOU,
    you: {
      hand: ['Overbloom'],
      // not Bubb: Bubb is Unaware and rightly ignores the +7/+7
      play: [{ card: 'Ephemeral Skywalker' }],
      resources: { wood: 4 },
    },
    opponent: { hand: [], play: [{ card: 'Palewing' }], resources: { earth: 2 } },
    prologue: () => toDeployment,
    phase: 'deploy',
    priority: null,
    needsLiveOpponent: false,
  },

  'stack-trip-haste': {
    id: 'stack-trip-haste',
    card: 'Cinder Scuttler',
    why: 'The haste step resolves plays on the spot, like deployment — a haste card used to show in '
      + 'three places at once while the phase moved on underneath it.',
    expect:
      WATCH
      + 'It is your HASTE step.\n'
      + '  1. Play Cinder Scuttler. One trip: hand → stack window → your region.\n'
      + '  2. Play Molten Upheaval. It flies to the window; when it resolves a Fireball 3 flies out of it\n'
      + '     to your token strip, and the Upheaval goes to your bin.\n'
      + '  3. Click done with the haste step.',
    initiative: YOU,
    you: {
      hand: ['Cinder Scuttler', 'Molten Upheaval'],
      play: [],
      resources: { fire: 4 },
    },
    opponent: { hand: [], play: [{ card: 'Bubb' }], resources: { earth: 2 } },
    // R18: the haste step opens because you hold a payable haste card; the
    // opponent holds none, so they are marked done the moment it opens
    prologue: () => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
    ],
    phase: 'planning',
    priority: null,
    needsLiveOpponent: false,
  },

  'stack-trip-battle': {
    id: 'stack-trip-battle',
    card: 'Twin Flame',
    why: 'A battle spell goes on the REAL stack and waits for a response. The window must stay put '
      + 'while it waits and fade out when it is done, and a token a resolving trigger makes used to '
      + 'pop in from nowhere.',
    expect:
      WATCH
      + 'It is the BATTLE: you attacked with Ephemeral Skywalker and you have priority. (The\n'
      + 'opponent\'s Fireball token is from their Ignis Sprite arriving — that is the card.)\n'
      + '  1. Play Twin Flame. It flies out of your hand and waits while you pick targets: click\n'
      + '     Palewing, then Ignis Sprite.\n'
      + '  2. It goes into the stack window ("resolves next"). Pass — the opponent passes too.\n'
      + '  3. It resolves: the damage lands, the card flies to your bin, Ignis Sprite dies.\n'
      + '  4. The Sprite\'s death trigger goes on the stack. Pass again: a Fireball flies OUT of that\n'
      + '     trigger card to their token strip, and the window fades behind it.',
    initiative: YOU,
    you: {
      hand: ['Twin Flame'],
      play: [{ card: 'Ephemeral Skywalker' }],
      resources: { fire: 4 },
    },
    opponent: { hand: [], play: [{ card: 'Palewing' }, { card: 'Ignis Sprite' }], resources: { earth: 2 } },
    prologue: (ids, s) => [
      { type: 'donePlanning', seat: YOU },
      { type: 'donePlanning', seat: OPPONENT },
      { type: 'declareAttack', seat: s.battle?.attacker ?? YOU, columns: [[ids.you[0]!]] },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },
};
