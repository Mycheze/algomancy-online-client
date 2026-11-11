/* BL-03 — PRACTICE OPPONENTS: simple scripted players for a solo game.
 *
 * The owner (2026-08-25): "Against 'real' opponents, but running a very
 * simplified game plan. For example, one opponent could, in each haste, make
 * an x/x unit where x is the turn number x2. They don't block ever and always
 * attack all. Another could be similar, but it makes a unit during deployment
 * which has a random attribute. … Probably easy to beat, but good for newer
 * players or if you want to try out a constructed deck against something more
 * than just a goldfish."
 *
 * An opponent is a row of OPPONENTS: a name, a line saying what it does, and
 * the one card its whole deck is made of (engine/src/cards/registry.ts — the
 * card IS the plan, played by the engine like any other spell). Its seat is
 * driven by `planBot`, which only picks among the actions the engine offers
 * (ui/bot.ts: a bot cannot cheat by construction). Adding a third opponent is
 * a row here, and a card in the registry if none of the existing ones fits.
 *
 * Pure and DOM-free. The game is a lesson deal (CR D8.1 machinery) played in
 * the page by ui/solo.ts, so nothing reaches the server and nothing is
 * recorded — no stats, no achievements, no rating (the owner: "Excluded as
 * well").
 */
import type { CardName } from '../engine/src/types.ts';
import type { LessonDeal } from '../engine/src/lessondeal.ts';
import { CONSTRUCTED_OPENING_HAND } from '../engine/src/challenge.ts';
import { fallbackMove, type BotPolicy } from './bot.ts';
import type { SoloDeal } from './solo.ts';

export interface Opponent {
  id: string;
  /** the name its seat plays under */
  name: string;
  /** what it does, in a sentence a player reads before choosing it */
  blurb: string;
  /** the one card its deck is made of */
  card: CardName;
}

export const OPPONENTS: readonly Opponent[] = [
  {
    id: 'sparring',
    name: 'The Sparring Partner',
    blurb: 'Every haste step it makes an X/X unit, where X is twice the turn number. It never blocks and always attacks with everything.',
    card: 'Sparring Construct',
  },
  {
    id: 'wild',
    name: 'The Wild Card',
    blurb: 'Every deployment it makes an X/X unit with a random attribute, where X is twice the turn number. It never blocks and always attacks with everything.',
    card: 'Wild Construct',
  },
];

export const opponentById = (id: string | null | undefined): Opponent | undefined => OPPONENTS.find(o => o.id === id);

/** the opponent's deck: thirty of its card (it draws one a turn, and running
 * out ends nothing in a lesson deal — CR D8.1d) */
export const OPPONENT_DECK_SIZE = 30;

/** The deal. The player: a real constructed game — the opening hand of 4, the
 * draw-4/bottom-2 card step, two Prismites, 30 life. The opponent: no
 * resources at all (its card is free), one card drawn a turn, 30 life. Who
 * has the initiative is rolled, as in every game. */
export const PRACTICE_DEAL: LessonDeal = {
  openingHand: [CONSTRUCTED_OPENING_HAND, 0],
  drawPerTurn: [0, 1],   // seat 0's is unread: it is on the constructed card step
  stacked: [false, false],
  shardsPerTurn: [0, 0],
  firstShardTurn: 1,
  shardState: 'open',
  prismites: [2, 0],
  startingLife: [30, 30],
  cardStep: ['constructed', 'lesson'],
};

export function practiceDeal(opp: Opponent, deck: readonly CardName[], playerName: string, seed: number): SoloDeal {
  return {
    seed,
    names: [playerName, opp.name],
    decks: [[...deck], Array.from({ length: OPPONENT_DECK_SIZE }, () => opp.card)],
    lesson: PRACTICE_DEAL,
  };
}

const unitsIn = (a: { type: string; columns?: unknown[][] }): number => (a.type === 'declareAttack' ? (a.columns ?? []).flat().length : 0);

/**
 * The plan every practice opponent follows: play its card whenever the engine
 * lets it, attack with every unit it has, never block, pass otherwise. When
 * its card may be played is the card's own timing, so one policy serves both.
 */
export function planBot(opp: Opponent): BotPolicy {
  return {
    id: `practice-${opp.id}`,
    name: opp.name,
    choose(state, seat, legal) {
      const me = state.players[seat]!;
      const dec = state.decision;
      // a question (a target, a region): its first answer
      if (dec && dec.seat === seat) return legal.find(a => a.type === 'decide') ?? null;
      const cast = legal.find(a => a.type === 'playCard' && me.hand[a.handIndex] === opp.card && !a.mode);
      if (cast) return cast;
      const attacks = legal.filter(a => a.type === 'declareAttack');
      if (attacks.length) return attacks.reduce((b, a) => (unitsIn(a) > unitsIn(b) ? a : b));
      // never blocks: the declaration with nobody in it
      const blocks = legal.filter(a => a.type === 'declareBlocks');
      if (blocks.length) {
        const none = blocks.find(a => a.type === 'declareBlocks' && !Object.values(a.blocks).flat().length
          && !((a as { send?: unknown[] }).send?.length));
        return none ?? blocks[0]!;
      }
      return legal.find(a => a.type === 'donePlanning' || a.type === 'doneHaste' || a.type === 'doneDeploying' || a.type === 'passPriority')
        ?? fallbackMove(legal) ?? null;
    },
  };
}
