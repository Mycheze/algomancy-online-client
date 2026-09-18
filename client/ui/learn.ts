/* R297 — LEARN TO PLAY: dealing, saving and resuming the tutorial game.
 *
 * `?learn=play&el=<element>` starts (or resumes) the game; main.ts hands the
 * SoloServer's socket to a NetBackend and renders the NET path from there. The
 * game is saved after every change as its deal plus its action log — the room
 * is deterministic, so that is the whole game — in this browser only.
 */
import type { LessonDeal } from '../engine/src/lessondeal.ts';
import { tutorialBotV1 } from './bot.ts';
import { CONSTRUCT } from './bot.ts';
import { buildLearnerDeck, isLearnElement, type LearnElement } from './lessondeck.ts';
import { SoloServer, type SoloDeal, type SoloSave } from './solo.ts';

const KEY = 'algoLearn';

/** The tutorial's deal. The bot: no Prismites, one open Shard a turn, one
 * Construct drawn a turn, from turn 1 — the owner's bot exactly, chosen over a
 * softer start knowing Metal and Earth lose most simulated games (see 305). The learner: the real game's Prismites and life, a
 * stacked deck, and nothing dealt but the 2 drawn each turn — so turn 1 opens
 * with two cards to read, not six (owner, first playtest). */
export const TUTORIAL_DEAL: LessonDeal = {
  openingHand: [0, 1], drawPerTurn: [2, 1], stacked: [true, false],
  shardsPerTurn: [0, 1], firstShardTurn: 1, shardState: 'open',
  prismites: [2, 0], startingLife: [30, 30], initiative: 0,
};

export interface LearnProgress {
  v: 1;
  element: LearnElement;
  /** lesson page ids already shown (lessonflow.ts) */
  seen: string[];
  /** the game in progress, if any */
  game?: SoloSave;
}

export function loadProgress(): LearnProgress | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as LearnProgress;
    return p && p.v === 1 && isLearnElement(p.element) ? p : null;
  } catch { return null; }
}

export function saveProgress(p: LearnProgress): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private window: progress is per session */ }
}

function learnerName(): string {
  try { return (localStorage.getItem('algoName') ?? '').trim() || 'You'; } catch { return 'You'; }
}

export function newDeal(el: LearnElement, seed = Math.floor(Math.random() * 1e6)): SoloDeal {
  return {
    seed,
    names: [learnerName(), 'Tutorial Bot'],
    decks: [buildLearnerDeck(el, seed), Array.from({ length: 40 }, () => CONSTRUCT)],
    lesson: TUTORIAL_DEAL,
  };
}

/** the Learn to Play game this page is running, if any */
let current: { server: SoloServer; progress: LearnProgress } | null = null;
export const currentSolo = (): { server: SoloServer; progress: LearnProgress } | null => current;

/**
 * The room for `?learn=play`: the saved game when there is one for this
 * element, a fresh deal otherwise. Every change is saved.
 */

export function startSolo(elParam: string | null, opts: { fresh?: boolean; onBotStuck?: (why: string) => void } = {}): { server: SoloServer; progress: LearnProgress } {
  const prior = loadProgress();
  const el: LearnElement = isLearnElement(elParam) ? elParam : prior?.element ?? 'fire';
  const resume = !opts.fresh && prior?.element === el && prior.game?.v === 1 ? prior.game : undefined;
  const progress: LearnProgress = { v: 1, element: el, seen: resume ? prior!.seen : [] };
  const deal = resume?.deal ?? newDeal(el);
  const server = new SoloServer(deal, tutorialBotV1(), resume, {
    onChange: s => { progress.game = s.save; saveProgress(progress); },
    onBotStuck: opts.onBotStuck,
  });
  progress.game = server.save;
  saveProgress(progress);
  current = { server, progress };
  return current;
}
