/* SCENARIO BATCH Q — review boards for board round 8 ("more table", 2026-10-27).
 *
 * Not card-correctness boards — review boards, like batches H to P. The round
 * flattens the info offshoots into one full-width line each side, moves the
 * phase track down beside the hand, slims the rail to a toolbar, runs your
 * region's ring down around the action bar, gives the zoom a current-text panel
 * and names the main button's destination. Every one of those is shown on the
 * same ten boards, before and after:
 *
 *   board8-planning-wide    13 resources (dormant and open) beside a full hand
 *   board8-haste            the haste step, the opponent done: "To Battle"
 *   board8-first-pass       attack window, empty stack, you pass first: "To Blockers"
 *   board8-stack            their spell on the stack, your priority: "Resolve …"
 *   board8-blocks-counter   you are blocking with units to spare: the counterattack question
 *   board8-round2-mine      round 2, their counterattack in YOUR region
 *   board8-no-counter-end   round 1 after-window, nobody sent: "End Battle"
 *   board8-deploy-last      deployment, the opponent already done: "End Turn"
 *   board8-modified-unit    a Robot 3 wearing Debt Blep, its [once] used this turn
 *   board8-full-bins        big bins and caches on both sides: the info line overflowing
 *   board8-invaders-tokens  checkpoint 4: invader piles on both sides, eight spell tokens in four stacks
 *
 * ⚠ THREE BOARDS SET ZONES THE ENGINE CANNOT REACH FROM A FRESH DEAL, and say so
 * where they do it: board8-full-bins writes both bins and caches in its prologue
 * (twelve units dying and six prophecies paid would be a forty-action prologue
 * about nothing this round reviews), and board8-planning-wide's dormant
 * resources come from real recycles. Both are pure — no seed, no clock — so the
 * board is the same on every deal and the replay sees it too (the prologue runs
 * inside `dealScenario`, the one choke point every deal site calls).
 */
import type { CardName, GameState, Seat } from '../engine/src/types.ts';
import type { Scenario } from './scenarios.ts';

// a batch may import only TYPES from scenarios.ts (see 14-scenario-tester.md) — restate the seats
const YOU: Seat = 0;
const OPPONENT: Seat = 1;

const START = [
  { type: 'donePlanning' as const, seat: YOU },
  { type: 'donePlanning' as const, seat: OPPONENT },
];

/** planning → two declined battle rounds → deployment, initiative YOU */
const TO_DEPLOY = [
  ...START,
  { type: 'declareAttack' as const, seat: YOU, columns: [] },
  { type: 'declareAttack' as const, seat: OPPONENT, columns: [] },
];

const LOOK = 'A review board for board round 8 — nothing here tests a card.\n';

/** a typical mid-game hand: units and spells of several costs */
const HAND: CardName[] = [
  'The Foretold', 'Luminous Arc', 'Good Whale', 'Bubb', 'Twin Flame',
  'Carapace Devourer', 'Seismomancy', 'Rampart Guardian',
];

export const BATCH_Q: Record<string, Scenario> = {
  'board8-planning-wide': {
    id: 'board8-planning-wide',
    card: 'The Foretold',
    why: 'Board round 8: the info line is one full-width row, and the resources take whatever it has '
      + 'left. Thirteen resources in two states beside a full hand is the widest it gets in planning.',
    expect:
      LOOK
      + 'Planning, turn 1. You hold eleven cards and thirteen resources: ten open, three dormant (just '
      + 'recycled). The opponent has finished planning.\n'
      + 'LOOK: your resources spread along your info line instead of fanning into a stack; nothing is cut off.\n'
      + 'TRY: hover your name (tap it on a tablet) — a small window gives hand, deck, recycle pile, bin and cache '
      + 'as numbers.',
    initiative: YOU,
    you: {
      hand: [...HAND, 'Bumblecrab', 'Chitin Shredder', 'Resonant Form', 'Slink', 'Trashling', 'Tidepool Terror'],
      play: [{ card: 'Crumbling Ancient' }],
      resources: { fire: 3, water: 2, earth: 2, light: 1, metal: 1, prismite: 1 },
    },
    opponent: {
      hand: ['Bubb', 'Slink', 'Trashling', 'Good Whale', 'The Foretold'],
      play: [{ card: 'Good Whale' }],
      resources: { water: 4, earth: 2 },
    },
    // three real recycles: the card goes to the bottom of the deck and a dormant
    // resource comes in. The LAST three cards, so the indices do not shift.
    prologue: () => [
      { type: 'recycleForResource', seat: YOU, handIndex: 13, element: 'water' },
      { type: 'recycleForResource', seat: YOU, handIndex: 12, element: 'earth' },
      { type: 'recycleForResource', seat: YOU, handIndex: 11, element: 'wood' },
      { type: 'donePlanning', seat: OPPONENT },
    ],
    handAfterPrologue: [...HAND, 'Bumblecrab', 'Chitin Shredder', 'Resonant Form'],
    phase: 'planning',
    priority: null,
    needsLiveOpponent: false,
  },

  'board8-haste': {
    id: 'board8-haste',
    card: 'Tidal Menace',
    why: 'Board round 8: the phase icons by the hand light the haste step, and the main button says '
      + 'where it goes next ("To Battle").',
    expect:
      LOOK
      + 'The haste step. You hold Molten Upheaval and two haste units; the opponent is done with the step.\n'
      + 'LOOK: the haste icon is lit in the phase strip beside your hand; the button reads "To Battle".\n'
      + 'TRY: play Tidal Menace, or press the button and go to battle.',
    initiative: YOU,
    you: {
      hand: ['Molten Upheaval', 'Tidal Menace', 'Hooba-Lin', 'The Foretold', 'Luminous Arc'],
      play: [{ card: 'Bubb' }, { card: 'Carapace Devourer' }],
      resources: { fire: 4, water: 2 },
    },
    opponent: {
      hand: ['Bubb', 'Slink', 'Trashling'],
      play: [{ card: 'Good Whale' }, { card: 'Rampart Guardian' }],
      resources: { water: 3 },
    },
    // ⚠ the prologue cannot play a haste card for you: `runPrologue` closes the
    // haste step before every action that is not a `doneHaste` (CR 504.5)
    prologue: () => [...START, { type: 'doneHaste', seat: OPPONENT }],
    phase: 'planning',
    priority: null,
    needsLiveOpponent: false,
  },

  'board8-first-pass': {
    id: 'board8-first-pass',
    card: 'The Foretold',
    why: 'Board round 8: in the attack window with an empty stack, passing first does not move the game '
      + 'on by itself — the button says "To Blockers" with a note that the opponent can still reply.',
    expect:
      LOOK
      + 'Battle, round 1: you attacked their region with two columns; the stack is empty and you have priority, '
      + 'nobody has passed yet.\n'
      + 'LOOK: the button reads "To Blockers", with a small note that the opponent can reply.\n'
      + 'TRY: pass. The opponent passes too and blocks nothing; follow the button through the battle.',
    initiative: YOU,
    you: {
      hand: ['Luminous Arc', 'Twin Flame', 'Good Whale', 'Bubb'],
      play: [{ card: 'The Foretold' }, { card: 'Carapace Devourer' }, { card: 'Rampart Guardian' }],
      resources: { fire: 3, water: 3, light: 1 },
    },
    opponent: {
      hand: ['Bubb', 'Slink', 'Trashling', 'Seismomancy'],
      play: [{ card: 'Good Whale' }, { card: 'Chitin Shredder' }],
      resources: { water: 3, earth: 2 },
    },
    prologue: ids => [
      ...START,
      { type: 'declareAttack', seat: YOU, columns: [[ids.you[0]!], [ids.you[1]!]] },
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  'board8-stack': {
    id: 'board8-stack',
    card: 'Seismomancy',
    why: 'Board round 8: with a spell on the stack the main button names what passing does — '
      + '"Resolve Seismomancy".',
    expect:
      LOOK
      + 'Battle, round 1: you attacked with The Foretold; the opponent answered with Seismomancy (3 damage) at it. '
      + 'The spell is on the stack and you have priority.\n'
      + 'LOOK: the button reads "Resolve Seismomancy".\n'
      + 'TRY: answer with Luminous Arc, or pass and let it resolve.',
    initiative: YOU,
    you: {
      hand: ['Luminous Arc', 'Protective Adaptations', 'Good Whale', 'Bubb'],
      play: [{ card: 'The Foretold' }, { card: 'Rampart Guardian' }],
      resources: { fire: 2, water: 3 },
    },
    opponent: {
      hand: ['Seismomancy', 'Slink', 'Trashling'],
      play: [{ card: 'Good Whale' }, { card: 'Chitin Shredder' }],
      resources: { earth: 3, water: 2 },
    },
    prologue: ids => [
      ...START,
      { type: 'declareAttack', seat: YOU, columns: [[ids.you[0]!]] },
      { type: 'passPriority', seat: YOU },
      { type: 'playCard', seat: OPPONENT, handIndex: 0 },
      { type: 'decide', seat: OPPONENT, choice: 0 },   // at The Foretold
    ],
    opponentHandAfterPrologue: ['Slink', 'Trashling'],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  'board8-blocks-counter': {
    id: 'board8-blocks-counter',
    card: 'Rampart Guardian',
    why: 'Board round 8: the counterattack question ("Send counterattackers?") moves into the new action bar. '
      + 'You block with units to spare.',
    expect:
      LOOK
      + 'Battle, round 1: they attacked YOUR region with two columns; you are declaring blocks with five units.\n'
      + 'TRY: block one column with Rampart Guardian and press Confirm. The bar asks "Send counterattackers? '
      + '4 units aren’t blocking." with a chip per unit.\n'
      + 'LOOK: the question sits in the action bar, inside your region’s border, by your hand.',
    initiative: OPPONENT,
    you: {
      hand: ['Luminous Arc', 'Bubb', 'Twin Flame'],
      play: [
        { card: 'Rampart Guardian' }, { card: 'Good Whale' }, { card: 'Crumbling Ancient' },
        { card: 'Bumblecrab' }, { card: 'The Foretold' },
      ],
      resources: { fire: 3, water: 2 },
    },
    opponent: {
      hand: ['Bubb', 'Slink'],
      play: [{ card: 'Chitin Shredder' }, { card: 'Carapace Devourer' }, { card: 'Trashling' }],
      resources: { earth: 3 },
    },
    prologue: ids => [
      ...START,
      { type: 'declareAttack', seat: OPPONENT, columns: [[ids.opponent[0]!], [ids.opponent[1]!]] },
      { type: 'passPriority', seat: OPPONENT },
      { type: 'passPriority', seat: YOU },
    ],
    phase: 'battle',
    priority: null,
    needsLiveOpponent: false,
  },

  'board8-round2-mine': {
    id: 'board8-round2-mine',
    card: 'Bumblecrab',
    why: 'Board round 8: your region’s border runs down around the action bar and hand. In round 2 their '
      + 'counterattack fights in YOUR region, so the ring has to take in the visitors and still run down.',
    expect:
      LOOK
      + 'Battle, round 2: you attacked them in round 1 and they sent three counterattackers; now they attack '
      + 'YOUR region. You have priority.\n'
      + 'LOOK: the fight is in your region; its border takes in their three units AND runs down around the '
      + 'action bar and your hand.\n'
      + 'TRY: pass, then block.',
    initiative: YOU,
    you: {
      hand: ['Luminous Arc', 'Twin Flame', 'Bubb'],
      play: [
        { card: 'The Foretold' }, { card: 'Carapace Devourer' },
        { card: 'Rampart Guardian' }, { card: 'Good Whale' }, { card: 'Crumbling Ancient' },
      ],
      resources: { fire: 4, water: 1 },
    },
    opponent: {
      hand: ['Slink', 'Trashling'],
      play: [
        { card: 'Tidepool Terror' }, { card: 'Bumblecrab' }, { card: 'Chitin Shredder' },
        { card: 'Resonant Form' }, { card: 'Child of Aether' },
      ],
      resources: { water: 3 },
    },
    prologue: ids => {
      const y = ids.you, o = ids.opponent;
      const sent = o.slice(1, 4);
      return [
        ...START,
        { type: 'declareAttack', seat: YOU, columns: [[y[0]!], [y[1]!]] },
        { type: 'passPriority', seat: YOU },
        { type: 'passPriority', seat: OPPONENT },
        // their Tidepool Terror blocks The Foretold; three are sent
        { type: 'declareBlocks', seat: OPPONENT, blocks: { 0: [o[0]!] }, send: sent },
        ...PASS_ROUND(YOU),
        { type: 'declareAttack', seat: OPPONENT, columns: sent.map(id => [id]) },
      ];
    },
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  'board8-no-counter-end': {
    id: 'board8-no-counter-end',
    card: 'Carapace Devourer',
    why: 'Board round 8: after round 1 with nobody sent there is no round 2 — the button must read '
      + '"End Battle" (the old hint said "round 2").',
    expect:
      LOOK
      + 'Battle, round 1 is over: you attacked, they blocked nothing and sent nobody. The after-combat '
      + 'window is open and you have priority.\n'
      + 'LOOK: the button reads "End Battle" — there is no counterattack coming.\n'
      + 'TRY: pass; the battle ends and deployment starts.',
    initiative: YOU,
    you: {
      hand: ['Luminous Arc', 'Good Whale', 'Bubb'],
      play: [{ card: 'Carapace Devourer' }, { card: 'The Foretold' }, { card: 'Rampart Guardian' }],
      resources: { fire: 2, water: 3 },
    },
    opponent: {
      hand: ['Slink', 'Trashling'],
      play: [{ card: 'Good Whale' }, { card: 'Chitin Shredder' }],
      resources: { water: 3 },
    },
    prologue: ids => [
      ...START,
      { type: 'declareAttack', seat: YOU, columns: [[ids.you[0]!], [ids.you[1]!]] },
      { type: 'passPriority', seat: YOU },
      { type: 'passPriority', seat: OPPONENT },
      { type: 'declareBlocks', seat: OPPONENT, blocks: {}, send: [] },
      ...TO_AFTER(YOU),
    ],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  'board8-deploy-last': {
    id: 'board8-deploy-last',
    card: 'Good Whale',
    why: 'Board round 8: deployment is simultaneous; when the opponent is already done, your Done ends the '
      + 'turn — the button reads "End Turn".',
    expect:
      LOOK
      + 'Deployment, turn 1. The opponent has finished deploying; you have cards and mana.\n'
      + 'LOOK: the deploy icon is lit beside your hand and the button reads "End Turn".\n'
      + 'TRY: play The Foretold, then end the turn.',
    initiative: YOU,
    you: {
      hand: ['The Foretold', 'Good Whale', 'Bubb', 'Carapace Devourer', 'Luminous Arc'],
      play: [{ card: 'Rampart Guardian' }],
      resources: { light: 2, water: 3, earth: 1 },
    },
    opponent: {
      hand: ['Slink', 'Trashling', 'Bubb'],
      play: [{ card: 'Good Whale' }],
      resources: { water: 3 },
    },
    prologue: () => [...TO_DEPLOY, { type: 'doneDeploying', seat: OPPONENT }],
    phase: 'deploy',
    priority: null,
    needsLiveOpponent: false,
  },

  'board8-modified-unit': {
    id: 'board8-modified-unit',
    card: 'Debt Blep',
    why: 'Board round 8: the zoom gains a current-text panel, shown only when it adds something. A Robot 3 '
      + 'token (its X is its counters) wearing Debt Blep, whose [once] ability is spent this turn, has '
      + 'all three reasons at once.',
    expect:
      LOOK
      + 'Deployment. Your Robot (three +1/+1 counters, so X = 3) wears Debt Blep as an augment, and you have '
      + 'already used the Blep’s [once] "Gain 2 debt: I gain +3/+3" this turn — it is 6/6 and you owe 2 debt.\n'
      + 'TRY: hover the Robot. LOOK: beside the zoom, a panel with its current text — X = 3, the [once] '
      + 'marked used, the Blep strip — never covering the zoomed card.\n'
      + 'TRY: hover The Foretold: no panel (nothing to add).',
    initiative: YOU,
    you: {
      hand: ['Bubb', 'Luminous Arc', 'Good Whale'],
      play: [
        { card: 'Robot', token: true, counters: 3, mods: [{ card: 'Debt Blep', as: 'augment' }] },
        { card: 'The Foretold' },
      ],
      resources: { light: 2, water: 2, fire: 1 },
    },
    opponent: {
      hand: ['Slink', 'Trashling'],
      play: [{ card: 'Good Whale' }, { card: 'Chitin Shredder' }],
      resources: { water: 3 },
    },
    prologue: (ids, s) => [
      ...TO_DEPLOY,
      { type: 'doneDeploying', seat: OPPONENT },
      // the Blep's donated [once], activated through the mod it is printed on
      {
        type: 'activateAbility', seat: YOU, entityId: ids.you[0]!, abilityIndex: 0,
        via: { mod: s.entities[ids.you[0]!]!.mods[0]! },
      },
    ],
    phase: 'deploy',
    priority: null,
    needsLiveOpponent: false,
  },

  'board8-invaders-tokens': {
    id: 'board8-invaders-tokens',
    card: 'Ignis Sprite',
    why: 'Board round 8, checkpoint 4: invaders draw as a small overlapping pile that fans out on hover, '
      + 'and alike spell tokens stack under one count, biggest first, at the outer end of In Play.',
    expect:
      LOOK
      + 'Battle, round 1: you attacked their region with two columns and have priority. Three of their units '
      + 'stand in your region and four of yours in theirs; you hold eight spell tokens (Fireball 3 ×2, '
      + 'Fireball 2, Fireball 1 ×4, Poison 1).\n'
      + 'LOOK: each side\'s invaders are a small pile with a count; your tokens are four stacks at the right '
      + 'end of your In Play, nothing cut off even in a small window.\n'
      + 'TRY: hover a pile and a stack — each fans out, and the zoom stands clear of it. Hover the token corner: '
      + 'a table of how many of each size. Hover any unit: its current text beside the zoom.',
    initiative: YOU,
    you: {
      hand: [...HAND.slice(0, 5)],
      play: [{ card: 'The Foretold' }, { card: 'Carapace Devourer' }, { card: 'Ignis Sprite' },
        { card: 'Good Whale' }, { card: 'Rampart Guardian' }, { card: 'Bubb' }, { card: 'Slink' }],
      resources: { fire: 3, water: 3 },
    },
    opponent: {
      hand: ['Slink', 'Trashling'],
      play: [{ card: 'Good Whale' }, { card: 'Chitin Shredder' }, { card: 'Trashling' }, { card: 'Bubb' }, { card: 'Slink' }],
      resources: { water: 4 },
    },
    // ⚠ written straight onto the dealt board: seven more spell tokens (copies of the
    // Fireball Ignis Sprite made on the deal, at other Xs; one renamed Poison) and
    // seven units standing in the other region. A real game reaches both, but
    // only after a battle and a dozen token-making plays; nothing reads them
    // before the attack this prologue declares.
    prologue: (ids, s) => {
      const fb = Object.values(s.entities).find(e => e.kind === 'spellToken' && e.controller === YOU)!;
      const sizes: [string, number][] = [['Fireball', 3], ['Fireball', 1], ['Fireball', 2], ['Fireball', 1], ['Fireball', 3], ['Fireball', 1], ['Poison', 1]];
      for (const [card, x] of sizes) {
        const id = s.nextId++;
        s.entities[id] = { ...structuredClone(fb), id, card: card as CardName, x };
      }
      const myRegion = s.regions.findIndex(r => r.owner === YOU);
      const theirRegion = s.regions.findIndex(r => r.owner === OPPONENT);
      // their Trashling, Bubb and Slink stand in my region; my Good Whale, Guardian, Bubb, Slink in theirs
      for (const id of ids.opponent.slice(2)) s.entities[id]!.region = myRegion;
      for (const id of ids.you.slice(3)) s.entities[id]!.region = theirRegion;
      return [...START, { type: 'declareAttack', seat: YOU, columns: [[ids.you[0]!], [ids.you[1]!]] }];
    },
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  'board8-full-bins': {
    id: 'board8-full-bins',
    card: 'Grob',
    why: 'Board round 8: the bin and cache fans size off the one info line. Big bins and caches on both '
      + 'sides are what overflow it.',
    expect:
      LOOK
      + 'Battle, round 1: you attacked with two columns and have priority. Both bins hold a dozen-plus cards '
      + 'and both caches six (a long game’s worth).\n'
      + 'LOOK: every bin and cache fits in its info line, nothing spills or overlaps; the resources take the '
      + 'rest of the width.\n'
      + 'TRY: hover each bin and cache; hover a name for the counts.',
    initiative: YOU,
    you: {
      hand: ['Luminous Arc', 'Good Whale', 'Bubb', 'Twin Flame', 'Seismomancy'],
      play: [{ card: 'The Foretold' }, { card: 'Carapace Devourer' }, { card: 'Rampart Guardian' }],
      resources: { fire: 3, water: 3, earth: 2, light: 2 },
    },
    opponent: {
      hand: ['Slink', 'Trashling', 'Bubb', 'Good Whale'],
      play: [{ card: 'Good Whale' }, { card: 'Chitin Shredder' }],
      resources: { water: 4, earth: 3, metal: 2 },
    },
    prologue: (ids, s) => {
      fillZones(s);
      return [
        ...START,
        { type: 'declareAttack', seat: YOU, columns: [[ids.you[0]!], [ids.you[1]!]] },
      ];
    },
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },
};

/** After round-1 blocks: walk the block window, the damage and the after
 * window with both seats passing, the attacker first each time. */
function PASS_ROUND(attacker: Seat) {
  const d = (1 - attacker) as Seat;
  return [
    { type: 'passPriority' as const, seat: attacker },
    { type: 'passPriority' as const, seat: d },
    { type: 'passPriority' as const, seat: attacker },
    { type: 'passPriority' as const, seat: d },
  ];
}

/** After round-1 blocks: walk to the after window, priority back on `attacker`. */
function TO_AFTER(attacker: Seat) {
  const d = (1 - attacker) as Seat;
  return [
    { type: 'passPriority' as const, seat: attacker },
    { type: 'passPriority' as const, seat: d },
  ];
}

/**
 * board8-full-bins only: a long game's bins and caches, written straight onto
 * the dealt board. See the header's ⚠ — public zones of plain card names, no
 * entity, no trigger, nothing a rule reads at this point of the game.
 */
function fillZones(s: GameState): void {
  const mine: CardName[] = [
    'Bubb', 'Slink', 'Trashling', 'The Foretold', 'Luminous Arc', 'Twin Flame', 'Seismomancy',
    'Bumblecrab', 'Chitin Shredder', 'Resonant Form', 'Good Whale', 'Tidepool Terror', 'Haboob', 'Fight',
  ];
  const theirs: CardName[] = [
    'Arc Lightning', 'Child of Aether', 'Bubb', 'Slink', 'Crumbling Ancient', 'Rampart Guardian',
    'Flame of History', 'Battle', 'Squish', 'Wildfire', 'Good Whale', 'Trashling', 'Ambling Mountaintop',
    'Carapace Devourer', 'Meteor Shower', 'Tidal Menace',
  ];
  const cacheMine: CardName[] = ['Grob', 'Waxen Witness', 'Divine Foresight', 'Blurf', 'Living Vault', 'Debt Blep'];
  const cacheTheirs: CardName[] = ['Prophecy Bug', 'Tithe Enforcer', 'Arbiter of Armistice', 'Seer of Empty Spaces',
    'The Everywhere', 'Stalwart Sentinel'];
  s.players[YOU]!.bin.push(...mine);
  s.players[OPPONENT]!.bin.push(...theirs);
  // each waits on a prophecy (CR 803.7) — a cache entry with none is "spent", and the
  // board folds spent entries away, which would hide exactly what this board is for
  const PROPHECIES = [
    ['Two Turns Pass', '2 turns pass'], ['One Battle Passes', '1 battle passes'], ['Three Turns Pass', '3 turns pass'],
  ] as const;
  const cached = (cards: CardName[]) => cards.map((card, i) => {
    const [condition, norm] = PROPHECIES[i % PROPHECIES.length]!;
    return { card, prophecy: { condition, norm, turn: s.turn, battles: s.battlesCompleted ?? 0 } };
  });
  s.players[YOU]!.cache = cached(cacheMine);
  s.players[OPPONENT]!.cache = cached(cacheTheirs);
}
