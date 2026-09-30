/* Scenario batch G: EVERY PICK ON THE BOARD (owner, 2026-09-30).
 *
 * Like batch F these are not card-correctness boards — the rules are settled.
 * What they put in front of the owner is the change ui/boardpick.ts made:
 *
 *   "All selections should be done by tapping/clicking the unit or player that
 *    is actually on the board … If a selection needs to be made between cards
 *    that aren't in play at all … little representations/images of the card
 *    can appear in the bar … I want to avoid ever having the player select a
 *    card based on card NAME alone."
 *
 * Each board holds the cards whose questions used to come out wrong, grouped
 * by the SHAPE of the question rather than by card, because the fix is about
 * shapes: a bare-id sacrifice (Torrential Reclamation, Grim Bargain), a cost
 * paid from hand OR board (Pallid Gorger, Mindburn), a recall and an
 * erase-a-mod cost (Auric Ascendant, Slag Spewer), a stack item then a new
 * target (Divine Intervention), and the cards that really are out of play
 * (a bin, a glimpse), which keep their scans.
 *
 * The spell boards open in your first battle window: you have attacked with
 * every unit (so the whole board is in the battle's region) and priority is
 * yours.
 * The ability boards open in your deployment step, because an ability that is
 * not {Battle}-timed is used there. Play things in any order; the verdict is
 * "did every choice happen on the board, and did the bar only hold pictures of
 * cards not in play, and plain buttons?".
 */
import type { Seat } from '../engine/src/types.ts';
import type { Scenario } from './scenarios.ts';

// R218: a batch may import only TYPES from scenarios.ts — restate the seats
const YOU: Seat = 0;
const OPPONENT: Seat = 1;

/** donePlanning both, you attack with EVERY unit (a {Battle} spell reaches
 * only the units in the battle's region, and a unit left home is not in it),
 * and the first window is yours */
const toFirstWindow = (yours: readonly number[]) => [
  { type: 'donePlanning' as const, seat: YOU },
  { type: 'donePlanning' as const, seat: OPPONENT },
  { type: 'declareAttack' as const, seat: YOU, columns: yours.map(id => [id]) },
];

/** board-pick-stack: Twin Flame's options for your Bubb, then (the menu
 * rebuilt without it) your Chitin Shredder */
const TWIN_BUBB = 1;
const TWIN_SHREDDER = 1;

/** donePlanning both, nobody attacks: straight to deployment, where the
 * non-{Battle} abilities are used */
const toDeployment = [
  { type: 'donePlanning' as const, seat: YOU },
  { type: 'donePlanning' as const, seat: OPPONENT },
  { type: 'declareAttack' as const, seat: YOU, columns: [] },
  { type: 'declareAttack' as const, seat: OPPONENT, columns: [] },
];

const COMMON =
  'WHAT TO JUDGE: every "which one?" question should be answered by clicking (or tapping) the\n'
  + 'glowing unit, hand card, life total or stack card itself. The yellow bar should hold only the\n'
  + 'question, plain buttons (No more targets, Decline, X = …, Cancel) and — ONLY for cards that\n'
  + 'are not in play — small card pictures. Never a card\'s NAME as the thing to click.\n';

export const BATCH_G: Record<string, Scenario> = {
  /**
   * The classic target, a sacrifice asked as a bare entity id (no card on the
   * option — it drew NAME buttons and the board was dead), a bin target (a
   * card out of play: scans), and an up-to-two with its "No more targets".
   */
  'board-pick-targets': {
    id: 'board-pick-targets',
    card: 'Torrential Reclamation',
    why: 'Torrential Reclamation\'s "each player sacrifices a unit" drew a row of NAME buttons and '
      + 'clicking the unit on the board did nothing. The fix puts every such pick on the board.',
    expect:
      COMMON
      + 'TRY, in any order:\n'
      + '  · Fireball (X = anything) — click a unit or a life total. The X for a player now shows on\n'
      + '    the life total, not a button.\n'
      + '  · Twin Flame — click up to two units; "No more targets" stays a button.\n'
      + '  · Torrential Reclamation (X = 1) — recall an ally by clicking it, then "sacrifice a unit":\n'
      + '    your units glow, the bar has NO names in it.\n'
      + '  · Collect Remains once something is in a bin — a bin card is not in play, so it is a\n'
      + '    small picture in the bar. That one is correct.',
    initiative: YOU,
    you: {
      hand: ['Fireball', 'Twin Flame', 'Torrential Reclamation', 'Collect Remains'],
      play: [{ card: 'Good Whale' }, { card: 'Bubb' }, { card: 'Chitin Shredder' }],
      resources: { fire: 6, water: 4, dark: 3 },
    },
    opponent: { hand: [], play: [{ card: 'Bubb' }, { card: 'Palewing' }], resources: { earth: 2 } },
    prologue: ids => toFirstWindow(ids.you),
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * Costs. Pallid Gorger's "discard a card OR sacrifice a nontoken unit" is the
   * hand and the board in one question; Soul Swallower's sacrifice carried a
   * card on every option, so the bar drew SCANS of units standing right there;
   * Auric Ascendant's recall was a spelling the board never read.
   */
  'board-pick-costs': {
    id: 'board-pick-costs',
    card: 'Pallid Gorger',
    why: 'Activation costs that pick a unit or a hand card came out three different ways: name '
      + 'buttons, scans of units already on the table, and a board that ignored the click.',
    expect:
      COMMON
      + 'It is your DEPLOYMENT step. Each of these is an ability on a unit of yours — click the unit\n'
      + 'to use it:\n'
      + '  · Good Whale (Pallid Gorger under it): "Discard a card or sacrifice a nontoken unit" —\n'
      + '    your HAND cards and your nontoken units all glow; click either kind.\n'
      + '  · Bubb (Soul Swallower under it): "Sacrifice another unit" — your other units glow; no\n'
      + '    pictures of them in the bar any more.\n'
      + '  · Auric Ascendant: "[one], Recall another ally" — click the ally to recall.\n'
      + '  · Palewing (Hand Peeper under it): "Pay 3 life: Look at target player\'s hand" — click a\n'
      + '    life total.',
    initiative: YOU,
    you: {
      hand: ['Fireball', 'Recall', 'Twin Flame'],
      play: [
        { card: 'Good Whale', mods: [{ card: 'Pallid Gorger', as: 'augment' }] },
        { card: 'Bubb', mods: [{ card: 'Soul Swallower', as: 'augment' }] },
        { card: 'Auric Ascendant' },
        { card: 'Palewing', mods: [{ card: 'Hand Peeper', as: 'augment' }] },
        { card: 'Bubb' },
        { card: 'Wisp', token: true },
      ],
      resources: { water: 3, metal: 3, fire: 2 },
    },
    opponent: { hand: ['Fireball'], play: [{ card: 'Bubb' }], resources: { earth: 2 } },
    prologue: () => toDeployment,
    phase: 'deploy',
    priority: null,
    needsLiveOpponent: false,
  },

  /**
   * "Erase one of my mods" — a mod has no card of its own on the table; its
   * badge on the host is where it lives. Two mods, so the host click has to
   * ask which, and it asks with pictures.
   */
  'board-pick-erase-mod': {
    id: 'board-pick-erase-mod',
    card: 'Slag Spewer',
    why: 'Slag Spewer\'s donated "[one], Erase one of my mods" was answerable only by scans in the '
      + 'bar; a mod on the board could not be clicked at all.',
    expect:
      COMMON
      + 'It is your DEPLOYMENT step. Your Good Whale carries TWO mods: Slag Spewer (whose ability\n'
      + 'it now has) and Hooba-Lin.\n'
      + 'DO: click the Good Whale and use "[one], Erase one of my mods: … 2 damage to any target".\n'
      + 'FIRST it asks where the 2 damage goes: in deployment that reaches only your own region, so\n'
      + 'click your own life total (or a unit of yours).\n'
      + 'THEN "erase one of my mods": the mod badge on the Whale glows — click it. Or click the Whale\n'
      + 'itself: it asks "which one?" with the two MOD CARDS as pictures, not their names.',
    initiative: YOU,
    you: {
      hand: [],
      play: [
        { card: 'Bubb' },
        { card: 'Good Whale', mods: [{ card: 'Slag Spewer', as: 'augment' }, { card: 'Hooba-Lin', as: 'augment' }] },
      ],
      resources: { earth: 3, fire: 3 },
    },
    opponent: { hand: [], play: [{ card: 'Palewing' }, { card: 'Bubb' }], resources: { earth: 2 } },
    prologue: () => toDeployment,
    phase: 'deploy',
    priority: null,
    needsLiveOpponent: false,
  },

  /**
   * "Each player …" spells: the choice is yours about your own board or hand,
   * asked as bare ids or as Mindburn's "u:<id>" / "h:<index>" strings.
   */
  'board-pick-each-player': {
    id: 'board-pick-each-player',
    card: 'Mindburn',
    why: 'Mindburn, Grim Bargain and Rebalance ask each player to pick one of their own — and '
      + 'those picks came out as names or as pictures of units already on the table.',
    expect:
      COMMON
      + 'The Tester Bot answers its own half of each question automatically.\n'
      + 'TRY:\n'
      + '  · Mindburn (X = 2) — "sacrifice a nontoken unit or discard a card", twice: your nontoken\n'
      + '    units AND your hand cards glow. The X choice itself is plain buttons.\n'
      + '  · Grim Bargain (pay [3] or [6] for it) — "sacrifice a unit": click one of yours.\n'
      + '  · Rebalance — "give an opponent control of one of your units": click it.',
    initiative: YOU,
    you: {
      hand: ['Mindburn', 'Grim Bargain', 'Rebalance', 'Twin Flame'],
      play: [{ card: 'Good Whale' }, { card: 'Bubb' }, { card: 'Chitin Shredder' }, { card: 'Wisp', token: true }],
      resources: { fire: 4, dark: 7, wood: 2 },
    },
    opponent: {
      hand: ['Fireball', 'Recall'],
      play: [{ card: 'Bubb' }, { card: 'Palewing' }],
      resources: { earth: 2 },
    },
    prologue: ids => toFirstWindow(ids.you),
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * A stack item as the target, then a NEW target for it — Divine
   * Intervention's second question was a payOrDecline over {unit} refs, which
   * the board never answered.
   */
  'board-pick-stack': {
    id: 'board-pick-stack',
    card: 'Divine Intervention',
    why: 'Divine Intervention\'s "choose a new target" was a row of name buttons with a dead board; '
      + 'its first question (the effect on the stack) should be a click on the stack card.',
    expect:
      COMMON
      + 'The opponent has aimed Twin Flame at your Bubb and your Chitin Shredder; it is on the stack.\n'
      + 'DO: play Divine Intervention. Its target is the Twin Flame card ON THE STACK — click it.\n'
      + 'Then "choose a new target": click one of the glowing units (theirs, for the fun of it).\n'
      + 'Fireball is in hand too, for a player-or-unit pick while something is on the stack.',
    initiative: YOU,
    you: {
      hand: ['Divine Intervention', 'Fireball'],
      play: [{ card: 'Good Whale' }, { card: 'Bubb' }, { card: 'Chitin Shredder' }],
      resources: { light: 3, fire: 3 },
    },
    opponent: { hand: ['Twin Flame'], play: [{ card: 'Bubb' }, { card: 'Good Whale' }], resources: { fire: 4 } },
    prologue: ids => {
      return [
        ...toFirstWindow(ids.you),
        { type: 'passPriority', seat: YOU },
        { type: 'playCard', seat: OPPONENT, handIndex: 0 },
        // Twin Flame's two targets, by option INDEX (a prologue is computed
        // before the deal): TWIN_BUBB / TWIN_SHREDDER were read off a probe
        // of this exact board, and 186 deals every scenario, so a menu that
        // moves refuses the deal by name rather than aiming elsewhere
        { type: 'decide', seat: OPPONENT, choice: TWIN_BUBB },
        { type: 'decide', seat: OPPONENT, choice: TWIN_SHREDDER },
      ];
    },
    opponentHandAfterPrologue: [],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * The other side of the line: cards that are NOT in play keep their small
   * pictures. A glimpse reveals deck tops; a {Modular} spell offers mods from
   * the hand (which glow, being in your hand) and the bin (pictures).
   */
  'board-pick-out-of-play': {
    id: 'board-pick-out-of-play',
    card: 'Premonition',
    why: 'The line the owner drew: pictures in the bar are right for cards that are not in play. '
      + 'A glimpse must keep them, and must not grow name buttons.',
    expect:
      COMMON
      + 'TRY:\n'
      + '  · Premonition (Glimpse X) — the revealed deck cards are small PICTURES in the bar; pick\n'
      + '    one. That is the correct place for them: they are not on the table.\n'
      + '  · Fireball — the usual unit-or-player pick, for comparison.',
    initiative: YOU,
    you: {
      hand: ['Premonition', 'Fireball'],
      play: [{ card: 'Good Whale' }, { card: 'Bubb' }],
      resources: { water: 4, fire: 3 },
    },
    opponent: { hand: ['Recall', 'Fireball'], play: [{ card: 'Bubb' }], resources: { earth: 2 } },
    prologue: ids => toFirstWindow(ids.you),
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },
};
