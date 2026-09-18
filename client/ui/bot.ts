/* R297 — SOLO PLAY: THE BOT SEAT.
 *
 * A bot is a POLICY: given the true state, its seat, and that seat's legal
 * action list, it picks one action. It never builds an action the engine did
 * not offer (bar reading a numeric option's value), so the engine stays the
 * only authority on what is legal, and a bot cannot cheat by construction —
 * only by what it chooses to read in `state`.
 *
 * Pure and DOM-free, like customrules.ts: the Learn to Play client drives it
 * from ui/solo.ts today, and a server-side solo room can import the same file
 * later without a second copy of the decision tree.
 *
 * Every policy is DETERMINISTIC (no Math.random): the tutorial saves a game as
 * its action log and rebuilds it by replaying, which only works if the bot
 * would make the same moves again.
 */
import type { Action, GameState, Seat } from '../engine/src/types.ts';

export interface BotPolicy {
  id: string;
  /** the name the bot's seat plays under */
  name: string;
  /** one action from `legal`, or null to do nothing (the loop then stops) */
  choose(state: GameState, seat: Seat, legal: readonly Action[]): Action | null;
}

export interface TutorialBotOpts {
  /** once the bot has at least this much open mana and two Constructs in
   * hand, it splits its mana into two units instead of one. null = never. */
  twoUnitsAt?: number | null;
}

export const CONSTRUCT = 'Training Construct';

/** The most passive thing on the list: pass, block nothing, attack with
 * nothing, finish the step, answer a question with its first option. */
export function fallbackMove(legal: readonly Action[]): Action | undefined {
  return legal.find(a => a.type === 'passPriority')
    ?? legal.find(a => a.type === 'declareBlocks')
    ?? legal.find(a => a.type === 'declareAttack')
    ?? legal.find(a => a.type === 'donePlanning' || a.type === 'doneHaste' || a.type === 'doneDeploying')
    ?? legal.find(a => a.type === 'decide');
}

const unitsIn = (a: Action): number => a.type === 'declareAttack' ? a.columns.flat().length : 0;
const blockersIn = (a: Action): number => a.type === 'declareBlocks'
  ? Object.values(a.blocks).flat().length + ((a as { send?: unknown[] }).send?.length ?? 0) : Infinity;

/**
 * Tutorial Bot v1 — "X: create an X/X unit." Every turn it spends everything
 * on the largest Construct it can (or two, past `twoUnitsAt`), attacks with
 * every unit it has, and never blocks.
 */
export function tutorialBotV1(opts: TutorialBotOpts = {}): BotPolicy {
  const twoAt = opts.twoUnitsAt ?? null;
  return {
    id: 'tutorial-v1',
    name: 'Tutorial Bot',
    choose(state, seat, legal) {
      const me = state.players[seat]!;
      const dec = state.decision;
      if (dec && dec.seat === seat) {
        if (dec.kind === 'payOrDecline' && dec.options.every(o => typeof o.value === 'number')) {
          const xs = dec.options.map(o => o.value as number);
          const open = Math.max(...xs);
          const constructs = me.hand.filter(n => n === CONSTRUCT).length;
          const want = twoAt !== null && open >= twoAt && constructs >= 1 ? Math.floor(open / 2) : open;
          // the largest offered X that does not exceed what we want
          const best = xs.reduce((b, x, i) => (x <= want && x > xs[b]! ? i : b), xs.indexOf(Math.min(...xs)));
          return { type: 'decide', seat, choice: best };
        }
        if (dec.kind === 'number' && dec.numeric) {
          return { type: 'decide', seat, choice: dec.numeric.max ?? dec.numeric.suggest };
        }
        return legal.find(a => a.type === 'decide') ?? null;
      }
      // planning: wake anything dormant, then move on (it never recycles)
      const wake = legal.find(a => a.type === 'activateResource');
      if (wake) return wake;
      const done = legal.find(a => a.type === 'donePlanning' || a.type === 'doneHaste');
      if (done) return done;
      // battle
      const attacks = legal.filter(a => a.type === 'declareAttack');
      if (attacks.length) return attacks.reduce((b, a) => (unitsIn(a) > unitsIn(b) ? a : b));
      const blocks = legal.filter(a => a.type === 'declareBlocks');
      if (blocks.length) return blocks.reduce((b, a) => (blockersIn(a) < blockersIn(b) ? a : b));
      // deployment: a Construct if one is castable
      const cast = legal.find(a => a.type === 'playCard' && me.hand[a.handIndex] === CONSTRUCT && !a.mode);
      if (cast) return cast;
      return legal.find(a => a.type === 'passPriority' || a.type === 'doneDeploying') ?? fallbackMove(legal) ?? null;
    },
  };
}

/**
 * Let `seat` act until it has nothing to do. `step` applies one action to the
 * real game (and throws IllegalAction on a refusal); `view` reads the true
 * state and this seat's legal list after each step. Stops on a null choice, a
 * refusal, an empty list, or `cap` steps — a policy that loops is a bug, not a
 * hang.
 */
export function runBot(
  step: (a: Action) => void,
  view: () => { state: GameState; legal: readonly Action[] },
  seat: Seat,
  policy: BotPolicy,
  cap = 200,
): { steps: number; stuck?: string } {
  let steps = 0;
  for (; steps < cap; steps++) {
    const { state, legal } = view();
    if (state.winner !== null || state.phase === 'gameover' || !legal.length) return { steps };
    const a = policy.choose(state, seat, legal);
    if (!a) return { steps };
    try {
      step(a);
    } catch (err) {
      return { steps, stuck: `${a.type}: ${(err as Error).message}` };
    }
  }
  return { steps, stuck: `cap of ${cap} steps` };
}
