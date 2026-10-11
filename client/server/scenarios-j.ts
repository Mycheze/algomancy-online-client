/* Scenario batch J: BATTLE SPACE (owner, 2026-10-11; report #204, docs/18 Round 7).
 *
 * Not card-correctness boards — review boards, like batches H and I. During a
 * battle the fight is sized to what its columns NEED (owner's correction): it
 * takes the height first, and widens past the old half-board block only when
 * its columns need the width — then the region not in use squeezes to a side
 * column that still shows what it holds. Units grow up to 100px; the rail, the
 * info strip, the hand and the bars do not move. These open on the fight shapes that stress it:
 *
 *   battle-space-wide      seven single-unit columns — the widest fight
 *   battle-space-tall      three columns, four ranks — the height-bound fight
 *   battle-space-lone      one unblocked attacker — the 100px cap
 *   battle-space-defend    they attack YOUR region; you are declaring blocks
 *   battle-space-counter   round 2: your five-column counterattack in THEIR region
 *   battle-space-incoming  a six-column round 1 while their four counterattackers wait
 *
 * The units are attribute-only bodies (no triggers, no Flying), so nothing on
 * the board moves but the layout.
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

const LOOK =
  'Always: nothing scrolls, nothing is hidden or cut off; rail, info, hand and bars stay put.\n';

export const BATCH_J: Record<string, Scenario> = {
  'battle-space-wide': {
    id: 'battle-space-wide',
    card: 'The Foretold',
    why: 'The widest fight: seven columns of one attacker each. The fight block must take the width '
      + 'and still fit every column without cutting the end ones off.',
    expect:
      LOOK
      + 'You attacked their region with seven units, one per column; you have priority.\n'
      + 'LOOK: seven columns NEED the width, so the fight widens to fit them all side by side, none cut off,\n'
      + 'the cards as big as the width allows. Your own battle block (empty: everyone is out) is squeezed to\n'
      + 'the side at the left; your Rampart Guardian, left home, still shows in your In Play below it.\n'
      + 'TRY: pass. The opponent blocks nothing; watch the board through the damage and back to normal.',
    initiative: YOU,
    you: {
      hand: [],
      play: [
        { card: 'The Foretold' }, { card: 'Bubb' }, { card: 'Carapace Devourer' },
        { card: 'Bumblecrab' }, { card: 'Chitin Shredder' }, { card: 'Crumbling Ancient' },
        { card: 'Resonant Form' }, { card: 'Rampart Guardian' },
      ],
      resources: {},
    },
    opponent: {
      hand: [],
      play: [{ card: 'Good Whale' }, { card: 'Trashling' }],
      resources: {},
    },
    prologue: ids => [
      ...START,
      { type: 'declareAttack', seat: YOU, columns: ids.you.slice(0, 7).map(id => [id]) },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  'battle-space-tall': {
    id: 'battle-space-tall',
    card: 'Crumbling Ancient',
    why: 'The height-bound fight: three columns, each a front and back attacker against a front and '
      + 'back blocker — four ranks. Before this round the back blocker rank was cut off on a short screen.',
    expect:
      LOOK
      + 'You attacked with three columns of two; they blocked each with two. Blocks are in, you have priority.\n'
      + 'LOOK: all FOUR ranks stand in full — back blocker, front blocker, front attacker, back attacker —\n'
      + 'the columns centred in the fight, as big as the height allows. Make the window shorter: still four.\n'
      + 'TRY: pass, and watch the damage land.',
    initiative: YOU,
    you: {
      hand: [],
      play: [
        { card: 'The Foretold' }, { card: 'Crumbling Ancient' },
        { card: 'Bumblecrab' }, { card: 'Bubb' },
        { card: 'Carapace Devourer' }, { card: 'Resonant Form' },
        { card: 'Trashling' },
      ],
      resources: {},
    },
    opponent: {
      hand: [],
      play: [
        { card: 'Good Whale' }, { card: 'Rampart Guardian' },
        { card: 'Chitin Shredder' }, { card: 'Slink' },
        { card: 'Tidepool Terror' }, { card: 'Child of Aether' },
        { card: 'Ambling Mountaintop' },
      ],
      resources: {},
    },
    prologue: ids => {
      const y = ids.you, o = ids.opponent;
      return [
        ...START,
        { type: 'declareAttack', seat: YOU, columns: [[y[0]!, y[1]!], [y[2]!, y[3]!], [y[4]!, y[5]!]] },
        { type: 'passPriority', seat: YOU },
        { type: 'passPriority', seat: OPPONENT },
        {
          type: 'declareBlocks', seat: OPPONENT, send: [],
          blocks: { 0: [o[0]!, o[1]!], 1: [o[2]!, o[3]!], 2: [o[4]!, o[5]!] },
        },
      ];
    },
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  'battle-space-lone': {
    id: 'battle-space-lone',
    card: 'Bubb',
    why: 'The smallest fight: one attacker, unblocked. It has the whole fight block to itself and must '
      + 'stop growing at the cap (100px), not fill the board.',
    expect:
      LOOK
      + 'You attacked with Bubb alone and they did not block; you have priority.\n'
      + 'LOOK: Bubb stands in the middle of the fight at the cap (100px wide) — big, but not giant;\n'
      + 'the fight keeps the old half-board block: it needs no more width. Their three units still show in their In Play.\n'
      + 'TRY: pass, and watch the hit land.',
    initiative: YOU,
    you: {
      hand: [],
      play: [{ card: 'Bubb' }, { card: 'The Foretold' }],
      resources: {},
    },
    opponent: {
      hand: [],
      play: [{ card: 'Good Whale' }, { card: 'Trashling' }, { card: 'Slink' }],
      resources: {},
    },
    prologue: ids => [
      ...START,
      { type: 'declareAttack', seat: YOU, columns: [[ids.you[0]!]] },
      { type: 'passPriority', seat: YOU },
      { type: 'passPriority', seat: OPPONENT },
      { type: 'declareBlocks', seat: OPPONENT, blocks: {}, send: [] },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  'battle-space-defend': {
    id: 'battle-space-defend',
    card: 'Rampart Guardian',
    why: 'The fight in YOUR region: they attack with four columns and you declare blocks — the block '
      + 'nearest you grows, and your own units must stay easy to pick out and drag.',
    expect:
      LOOK
      + 'They attacked YOUR region with four columns; you are declaring blocks.\n'
      + 'LOOK: the fight is your block, grown, its slots centred; their block is squeezed to the side at\n'
      + 'the right (the send-to-counterattack box); your four units wait in your In Play, all visible.\n'
      + 'TRY: block two columns (one with a front and a back blocker), send one unit to counterattack, declare.',
    initiative: OPPONENT,
    you: {
      hand: [],
      play: [
        { card: 'Rampart Guardian' }, { card: 'Good Whale' },
        { card: 'Crumbling Ancient' }, { card: 'Bumblecrab' },
      ],
      resources: {},
    },
    opponent: {
      hand: [],
      play: [
        { card: 'The Foretold' }, { card: 'Carapace Devourer' },
        { card: 'Chitin Shredder' }, { card: 'Resonant Form' },
        { card: 'Bubb' },
      ],
      resources: {},
    },
    prologue: ids => [
      ...START,
      { type: 'declareAttack', seat: OPPONENT, columns: ids.opponent.slice(0, 4).map(id => [id]) },
      { type: 'passPriority', seat: OPPONENT },
      { type: 'passPriority', seat: YOU },
    ],
    phase: 'battle',
    priority: null,
    needsLiveOpponent: false,
  },

  'battle-space-counter': {
    id: 'battle-space-counter',
    card: 'Carapace Devourer',
    why: 'Round 2: your counterattack fights in the ATTACKER\'s region, so it is THEIR block that grows, '
      + 'and your block — still holding their round-1 attackers — squeezes to the side.',
    expect:
      LOOK
      + 'Round 2: you sent five counterattackers and they now attack THEIR region; you have priority.\n'
      + 'LOOK: THEIR block holds the fight, grown, the five columns centred. YOUR block is squeezed\n'
      + 'to the side at the left and still shows their two round-1 attackers standing in it; both In Plays\n'
      + 'show the units left at home (your Guardian, which blocked, and Whale; their Trashling and Slink).\n'
      + 'TRY: pass; they block nothing. Watch the board go back to normal after the battle.',
    initiative: OPPONENT,
    you: {
      hand: [],
      play: [
        { card: 'Rampart Guardian' }, { card: 'Good Whale' },
        { card: 'Carapace Devourer' }, { card: 'Bumblecrab' }, { card: 'The Foretold' },
        { card: 'Crumbling Ancient' }, { card: 'Resonant Form' },
      ],
      resources: {},
    },
    opponent: {
      hand: [],
      play: [
        { card: 'Chitin Shredder' }, { card: 'Bubb' },
        { card: 'Trashling' }, { card: 'Slink' },
      ],
      resources: {},
    },
    prologue: ids => {
      const y = ids.you, o = ids.opponent;
      const sent = y.slice(2);
      return [
        ...START,
        { type: 'declareAttack', seat: OPPONENT, columns: [[o[0]!], [o[1]!]] },
        { type: 'passPriority', seat: OPPONENT },
        { type: 'passPriority', seat: YOU },
        // the Guardian (0/4) blocks the Shredder (1/2): nobody dies; five sent
        { type: 'declareBlocks', seat: YOU, blocks: { 0: [y[0]!] }, send: sent },
        { type: 'passPriority', seat: OPPONENT },
        { type: 'passPriority', seat: YOU },
        { type: 'passPriority', seat: OPPONENT },
        { type: 'passPriority', seat: YOU },
        { type: 'declareAttack', seat: YOU, columns: sent.map(id => [id]) },
        // round 2's first window opens on the initiative player; the bot
        // passes it, so the board opens on yours
        { type: 'passPriority', seat: OPPONENT },
      ];
    },
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  'battle-space-incoming': {
    id: 'battle-space-incoming',
    card: 'Slink',
    why: 'Round 1 while the opponent\'s counterattackers wait: they used to fan along one row; now they '
      + 'wrap down the narrow idle column, and the fight keeps its size.',
    expect:
      LOOK
      + 'You attacked with six columns; they blocked one and sent FOUR units to counterattack you.\n'
      + 'Blocks are in; you have priority.\n'
      + 'LOOK: the four counterattackers on their way ("arrives next round") wrap down the column squeezed\n'
      + 'to the left (your block, idle this round), all four visible; the fight stays big and centred.\n'
      + 'TRY: pass through round 1, and watch round 2 begin.',
    initiative: YOU,
    you: {
      hand: [],
      play: [
        { card: 'The Foretold' }, { card: 'Bubb' }, { card: 'Crumbling Ancient' },
        { card: 'Carapace Devourer' }, { card: 'Bumblecrab' }, { card: 'Resonant Form' },
        { card: 'Rampart Guardian' },
      ],
      resources: {},
    },
    opponent: {
      hand: [],
      play: [
        { card: 'Good Whale' },
        { card: 'Slink' }, { card: 'Chitin Shredder' }, { card: 'Trashling' }, { card: 'Tidepool Terror' },
      ],
      resources: {},
    },
    prologue: ids => {
      const y = ids.you, o = ids.opponent;
      return [
        ...START,
        { type: 'declareAttack', seat: YOU, columns: y.slice(0, 6).map(id => [id]) },
        { type: 'passPriority', seat: YOU },
        { type: 'passPriority', seat: OPPONENT },
        { type: 'declareBlocks', seat: OPPONENT, blocks: { 1: [o[0]!] }, send: o.slice(1) },
      ];
    },
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },
};
