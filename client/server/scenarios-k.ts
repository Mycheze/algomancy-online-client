/* Scenario batch K: COMBAT CHANGES of report round 2026-10-16 (b) (owner, 2026-10-16).
 *
 * Review boards, like batches H and J — not card-correctness boards. Three
 * rulings changed what a battle lets you do:
 *
 *   · an attack whose every attacker is gone before blocks cannot be blocked
 *     at all (no slot head-on or to the side), but the defender may still send
 *     counterattackers — and a counterattack emptied the same way in round 2
 *     leaves the defender nothing to declare;
 *   · units sent to counterattack MUST attack: round 2 has no "Don't attack",
 *     Attack! waits until every sent unit is placed, and a lone sent unit
 *     forms by itself;
 *   · spell tokens sent along are owed the same way: they ride with the
 *     counterattack or the declaration is refused.
 *
 *   review-combat-emptied-attack    you kill their lone attacker: no block, still a send
 *   review-combat-emptied-counter   you kill their lone counterattacker: nothing to declare
 *   review-combat-counter-committed three sent: no "Don't attack", Attack! waits
 *   review-combat-token-owed        two sent + a Fireball: the token is one more to place
 *   review-combat-lone-token        one sent + a Fireball: forms by itself, token riding
 *
 * The bodies are attribute-free (The Foretold, Good Whale) or say plainly what
 * they do (Ignis Sprite makes the Fireball when the board is dealt), so nothing
 * on the board moves but the combat steps under review. Every board runs with
 * the scripted opponent: its passes and declines are exactly what each one needs.
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

export const BATCH_K: Record<string, Scenario> = {
  'review-combat-emptied-attack': {
    id: 'review-combat-emptied-attack',
    card: 'Luminous Arc',
    why: 'An attack whose only attacker is killed before blocks has nothing left to block: no block '
      + 'slot may appear, head-on or to the side — but the defender may still send counterattackers.',
    expect:
      'The opponent attacked you with The Foretold alone. You have priority, with Luminous Arc in hand.\n'
      + 'TRY: play Luminous Arc at their attacking Foretold (6 damage), then pass until the blocks step.\n'
      + 'LOOK: the bar says there are no attackers left to block, but you may still send counterattackers.\n'
      + 'Pick up either of your units: no slot lights up to block in — not in front, not to either side.\n'
      + 'TRY: send ONLY your Good Whale to counterattack, and declare.\n'
      + 'LOOK: in round 2 the Whale forms by itself — one sent unit has no shape to choose — and\n'
      + 'attacks their region. They will not block.\n'
      + '(Or declare with nobody sent: pass through the last windows and the battle ends.)',
    initiative: OPPONENT,
    you: {
      hand: ['Luminous Arc'],
      play: [{ card: 'Good Whale' }, { card: 'The Foretold' }],
      resources: { fire: 3 },
    },
    opponent: {
      hand: [],
      play: [{ card: 'The Foretold' }, { card: 'Good Whale' }],
      resources: {},
    },
    prologue: ids => [
      ...START,
      { type: 'declareAttack', seat: OPPONENT, columns: [[ids.opponent[0]!]] },
      // the attacker's window opens on the attacker; the bot would pass it too
      { type: 'passPriority', seat: OPPONENT },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  'review-combat-emptied-counter': {
    id: 'review-combat-emptied-counter',
    card: 'Luminous Arc',
    why: 'The round-2 half: a counterattack whose only unit is killed before blocks leaves the '
      + 'defender nothing to declare — no block is possible and no one can be sent in round 2.',
    expect:
      'You attacked their region with The Foretold; they blocked nothing and sent their Foretold to\n'
      + 'counterattack. Round 1 is over, and their Foretold now attacks YOUR region alone.\n'
      + 'You have priority, with Luminous Arc in hand.\n'
      + 'TRY: play Luminous Arc at their counterattacking Foretold (6 damage), then pass.\n'
      + 'LOOK: once it dies you are never asked to declare blocks — there is nothing to block, and no one\n'
      + 'can be sent in round 2 — so the block step goes by on its own. Pass the last windows: the battle ends.',
    initiative: YOU,
    you: {
      hand: ['Luminous Arc'],
      play: [{ card: 'The Foretold' }, { card: 'Good Whale' }],
      resources: { fire: 3 },
    },
    opponent: {
      hand: [],
      play: [{ card: 'The Foretold' }, { card: 'Good Whale' }],
      resources: {},
    },
    prologue: ids => {
      const y = ids.you, o = ids.opponent;
      return [
        ...START,
        { type: 'declareAttack', seat: YOU, columns: [[y[0]!]] },
        { type: 'passPriority', seat: YOU },
        { type: 'passPriority', seat: OPPONENT },
        { type: 'declareBlocks', seat: OPPONENT, blocks: {}, send: [o[0]!] },
        { type: 'passPriority', seat: YOU },
        { type: 'passPriority', seat: OPPONENT },
        { type: 'passPriority', seat: YOU },
        { type: 'passPriority', seat: OPPONENT },
        // their lone counterattacker forms by itself (the server would declare it)
        // round 2's first window opens on the initiative player — you
        { type: 'declareAttack', seat: OPPONENT, columns: [[o[0]!]] },
      ];
    },
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  'review-combat-counter-committed': {
    id: 'review-combat-counter-committed',
    card: 'The Foretold',
    why: 'Units sent to counterattack must attack: in round 2 there is no "Don\'t attack", every sent '
      + 'unit has to be placed, and only the formation\'s shape is chosen then.',
    expect:
      'The opponent attacked you with one unit; you blocked nothing and sent three units to\n'
      + 'counterattack (your Rampart Guardian stayed home). Round 1 is over; you build the counterattack.\n'
      + 'LOOK: the bar says "Build your counterattack (3 sent)" and "all must attack — 3 to place".\n'
      + 'There is NO "Don\'t attack" button, and Attack! is greyed out. The Guardian is not offered.\n'
      + 'TRY: place two of the three. Attack! stays greyed, the bar says "1 to place".\n'
      + 'Place the third — any shape is fine (two in one column, one alone) — and Attack! lights up.\n'
      + 'Attack: they will not block.',
    initiative: OPPONENT,
    you: {
      hand: [],
      play: [
        { card: 'The Foretold' }, { card: 'Good Whale' }, { card: 'Bumblecrab' },
        { card: 'Rampart Guardian' },
      ],
      resources: {},
    },
    opponent: {
      hand: [],
      play: [{ card: 'The Foretold' }, { card: 'Good Whale' }],
      resources: {},
    },
    prologue: ids => {
      const y = ids.you, o = ids.opponent;
      return [
        ...START,
        { type: 'declareAttack', seat: OPPONENT, columns: [[o[0]!]] },
        { type: 'passPriority', seat: OPPONENT },
        { type: 'passPriority', seat: YOU },
        { type: 'declareBlocks', seat: YOU, blocks: {}, send: y.slice(0, 3) },
        { type: 'passPriority', seat: OPPONENT },
        { type: 'passPriority', seat: YOU },
        { type: 'passPriority', seat: OPPONENT },
        { type: 'passPriority', seat: YOU },
      ];
    },
    phase: 'battle',
    priority: null,
    needsLiveOpponent: false,
  },

  'review-combat-token-owed': {
    id: 'review-combat-token-owed',
    card: 'Ignis Sprite',
    why: 'A spell token sent to counterattack is owed like a unit: it must ride with the round-2 '
      + 'formation, so it counts as one more to place and Attack! waits for it.',
    expect:
      'Your Ignis Sprite made a Fireball 1 when the board was dealt. The opponent attacked you with\n'
      + 'one unit; you blocked nothing and sent The Foretold, Good Whale AND the Fireball to\n'
      + 'counterattack (the Sprite stayed home). Round 1 is over; you build the counterattack.\n'
      + 'LOOK: the bar says "Build your counterattack (2 sent)" and "all must attack — 3 to place":\n'
      + 'two units and the token. There is no "Don\'t attack", and Attack! is greyed out.\n'
      + 'TRY: place both units. The bar says "1 to place" and Attack! is still greyed out.\n'
      + 'Click the Fireball so it rides: Attack! lights up. (Or "Attack with everything" — it brings the\n'
      + 'token too.) Attack: the Fireball rides with them, and you can play it in this fight.',
    initiative: OPPONENT,
    you: {
      hand: [],
      play: [{ card: 'The Foretold' }, { card: 'Good Whale' }, { card: 'Ignis Sprite' }],
      resources: {},
    },
    opponent: {
      hand: [],
      play: [{ card: 'The Foretold' }, { card: 'Good Whale' }],
      resources: {},
    },
    prologue: (ids, s) => {
      const y = ids.you, o = ids.opponent;
      // the Fireball Ignis Sprite made on the deal: the one spell token on the board
      const fireball = Object.values(s.entities)
        .filter(e => e.kind === 'spellToken' && e.controller === YOU).map(e => e.id);
      return [
        ...START,
        { type: 'declareAttack', seat: OPPONENT, columns: [[o[0]!]] },
        { type: 'passPriority', seat: OPPONENT },
        { type: 'passPriority', seat: YOU },
        { type: 'declareBlocks', seat: YOU, blocks: {}, send: [y[0]!, y[1]!], spellTokens: fireball },
        { type: 'passPriority', seat: OPPONENT },
        { type: 'passPriority', seat: YOU },
        { type: 'passPriority', seat: OPPONENT },
        { type: 'passPriority', seat: YOU },
      ];
    },
    phase: 'battle',
    priority: null,
    needsLiveOpponent: false,
  },

  'review-combat-lone-token': {
    id: 'review-combat-lone-token',
    card: 'Ignis Sprite',
    why: 'A lone sent unit forms by itself, and a spell token sent with it rides along — a token goes '
      + 'with the whole formation, so there is nothing left to ask.',
    expect:
      'Your Ignis Sprite made a Fireball 1 when the board was dealt. The opponent attacked you with\n'
      + 'one unit; you are declaring blocks.\n'
      + 'TRY: block nothing; send ONLY The Foretold to counterattack, and the Fireball with it; declare.\n'
      + 'Then pass through round 1.\n'
      + 'LOOK: round 2 starts with The Foretold already formed and attacking their region, the Fireball\n'
      + 'riding with it — no build step, no question. They do not block; play the Fireball there if you like.',
    initiative: OPPONENT,
    you: {
      hand: [],
      play: [{ card: 'The Foretold' }, { card: 'Ignis Sprite' }],
      resources: {},
    },
    opponent: {
      hand: [],
      play: [{ card: 'The Foretold' }, { card: 'Good Whale' }],
      resources: {},
    },
    prologue: ids => [
      ...START,
      { type: 'declareAttack', seat: OPPONENT, columns: [[ids.opponent[0]!]] },
      { type: 'passPriority', seat: OPPONENT },
      { type: 'passPriority', seat: YOU },
    ],
    phase: 'battle',
    priority: null,
    needsLiveOpponent: false,
  },
};
