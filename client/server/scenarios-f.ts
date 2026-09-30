/* Scenario batch F: THE STACK, AS IT LOOKS (owner, 2026-09-29).
 *
 * Batches A–E are card-correctness boards. These two are not: the rules here
 * are long settled, and what they put in front of the owner is the STACK
 * STRIP — an ability drawn as a slice rather than as the card, a grafted
 * trigger hanging its graft below it, an augment's ability as the host's art
 * with the donor's rules box (the "Franken-card"), and a caption that says
 * which target does what. ui/effectface.ts is the code under test; the verdict
 * buttons still fit ("works" / "slightly off" is exactly the question).
 *
 * Each prologue ends with something ALREADY on the stack and priority on you,
 * so the first thing on screen is the picture, and your hand holds the cards
 * that add the contrast: a real card played on top of an ability, and the
 * spells whose captions name their targets' jobs.
 *
 * Both are ONE round: the graft and the augment are placed with the board
 * (Placed.mods), because doing them by real actions means reaching a second
 * round, and its draw — a prologue may never draw.
 *
 * The prologues answer target prompts by option INDEX (a prologue is computed
 * once, before the deal). The indices were read off a probe of this exact
 * board; 186-scenario-library deals every scenario, so a change that moves an
 * option refuses the deal by name rather than aiming at the wrong unit.
 */
import type { Seat } from '../engine/src/types.ts';
import type { Scenario } from './scenarios.ts';

// R218: a batch may import only TYPES from scenarios.ts — restate the seats
const YOU: Seat = 0;
const OPPONENT: Seat = 1;

export const BATCH_F: Record<string, Scenario> = {
  /**
   * Chombot with Fight grafted, attacking: its attack trigger composes into
   * ONE item with two parts, each with two targets whose jobs differ. Every
   * piece of the new strip at once — the slice, the graft strip below it, and
   * a two-clause role caption.
   */
  'stack-look-grafted-trigger': {
    id: 'stack-look-grafted-trigger',
    card: 'Chombot',
    why: 'The stack strip used to draw a unit\'s triggered ability as the unit\'s whole card, '
      + 'indistinguishable from the unit being cast. A grafted trigger is the hardest case: one '
      + 'item, two cards\' text, four targets with four different jobs.',
    expect:
      'Chombot (with Fight grafted under it) has attacked, and its attack trigger is on the stack.\n'
      + 'LOOK FIRST: the trigger is a SHORTER, rounder slice of Chombot — no printed name bar, a\n'
      + '"Chombot · trigger" line in its place — with Fight\'s strip hanging below it, the way it\n'
      + 'hangs below Chombot on the table. The caption under the stack reads\n'
      + '"up to two counters from Bubb onto Chombot, then Chombot fights Bubb".\n'
      + 'THEN, in response: play Scrap For Parts (or Reconfigure — Graxxlid onto Chombot). It lands\n'
      + 'beside the trigger as a FULL card, taller than the slice, and the caption names its\n'
      + 'targets\' jobs too. Twin Flame, for contrast, keeps the plain "→ A, B" list: both of its\n'
      + 'targets are treated alike. Hover any of them for the zoom.',
    initiative: YOU,
    you: {
      hand: ['Scrap For Parts', 'Reconfigure', 'Twin Flame'],
      // Chombot is the trigger's source; Bubb carries the counters its text
      // moves; Graxxlid is an [Augment] unit, the one legal first target for
      // Reconfigure. All three attack so all three are targetable in battle.
      play: [
        { card: 'Chombot', mods: [{ card: 'Fight', as: 'graft' }] },
        { card: 'Bubb', counters: 2 },
        { card: 'Graxxlid' },
      ],
      resources: { metal: 8, earth: 8, fire: 4 },
    },
    opponent: { hand: [], play: [{ card: 'Bubb' }], resources: { earth: 2 } },
    prologue: ids => {
      const [chombot, bubb, graxxlid] = ids.you as [number, number, number];
      return [
        { type: 'donePlanning', seat: YOU },
        { type: 'donePlanning', seat: OPPONENT },
        { type: 'declareAttack', seat: YOU, columns: [[chombot], [bubb], [graxxlid]] },
        // Chombot's counters: from Bubb (option 1), onto Chombot (option 0)
        { type: 'decide', seat: YOU, choice: 1 },
        { type: 'decide', seat: YOU, choice: 0 },
        // the grafted Fight: Chombot (option 0) fights their Bubb (option 2)
        { type: 'decide', seat: YOU, choice: 0 },
        { type: 'decide', seat: YOU, choice: 2 },
        // the opponent lets it sit; the window is yours
        { type: 'passPriority', seat: OPPONENT },
      ];
    },
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },

  /**
   * Graxxlid augmented under Skybreaker lends it "Negate target effect
   * targeting me". The opponent aims Twin Flame at Skybreaker; answering it
   * with the borrowed ability puts the Franken-card on the stack.
   */
  'stack-look-augment-ability': {
    id: 'stack-look-augment-ability',
    card: 'Graxxlid',
    why: 'An ability an augment lends its host is the host\'s to use but the augment\'s text. The '
      + 'strip drew it as a whole Graxxlid card; it is now the host\'s art with Graxxlid\'s rules '
      + 'box spliced in, named after the host.',
    expect:
      'Graxxlid is augmented under your Skybreaker, and the opponent has just aimed Twin Flame at\n'
      + 'Skybreaker and your Bubb. Twin Flame is on the stack as a full card; its caption keeps the\n'
      + 'plain "→ Skybreaker, Bubb" list.\n'
      + 'DO: activate Skybreaker\'s borrowed ability — "Negate target effect targeting me" — at Twin\n'
      + 'Flame.\n'
      + 'LOOK: it lands as a short slice named "Skybreaker · ability" showing SKYBREAKER\'s art, with\n'
      + 'GRAXXLID\'s rules box spliced in under a gold seam. Hover it: the zoom says "from Graxxlid,\n'
      + 'augmented under Skybreaker". Squish in your hand is there for a role caption of your own\n'
      + '("Skybreaker deals its defense to Bubb").',
    initiative: YOU,
    you: {
      hand: ['Squish'],
      play: [{ card: 'Skybreaker', mods: [{ card: 'Graxxlid', as: 'augment' }] }, { card: 'Bubb' }],
      resources: { earth: 8, metal: 4 },
    },
    opponent: { hand: ['Twin Flame'], play: [{ card: 'Bubb' }], resources: { fire: 6 } },
    prologue: ids => {
      const [sky, bubb] = ids.you as [number, number];
      return [
        { type: 'donePlanning', seat: YOU },
        { type: 'donePlanning', seat: OPPONENT },
        { type: 'declareAttack', seat: YOU, columns: [[sky], [bubb]] },
        // you hold the first window and pass it…
        { type: 'passPriority', seat: YOU },
        // …and the opponent aims Twin Flame at both
        { type: 'playCard', seat: OPPONENT, handIndex: 0 },
        { type: 'decide', seat: OPPONENT, choice: 0 },   // Skybreaker
        { type: 'decide', seat: OPPONENT, choice: 0 },   // your Bubb
      ];
    },
    opponentHandAfterPrologue: [],
    phase: 'battle',
    priority: YOU,
    needsLiveOpponent: false,
  },
};
