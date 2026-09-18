/* R297 — LEARN TO PLAY: WHEN A LESSON OPENS.
 *
 * A lesson is shown at the moment its rule first matters in the game, not on a
 * timer. Every trigger is a predicate over what the LEARNER can see — their
 * redacted view and their own legal list — never the true state, so a lesson
 * cannot tell the learner anything about the bot's hidden half.
 *
 * Lessons are ordered: one is due only when every lesson before it has been
 * shown (or skipped), and at most one is open at a time. So a trigger says
 * "not before this moment", and the order says "not before the lesson ahead".
 *
 * Pure: no DOM. lessonlayer.ts draws; lessons.ts holds the words.
 */
import type { Action, GameState, Seat } from '../engine/src/types.ts';
import { rowFor, type CardRow } from './cardindex.ts';

export interface LessonCtx {
  /** the learner's view (the bot's half redacted, frozen inside hidden steps) */
  state: GameState;
  /** the learner's legal actions */
  legal: readonly Action[];
  seat: Seat;
}

export interface LessonQuote {
  text: string;
  /** where it is from, as a reader would cite it: "Manual, p. 18" */
  source: string;
}

/** a card in a figure: a name, or a name with how to draw it */
export type FigCard = string | {
  name: string;
  /** greyed out: "you could not play this one" */
  dim?: boolean;
  /** a pink ✕ over it (removed, blocked, negated) */
  cross?: boolean;
  /** a short line under the card */
  label?: string;
  /** a chip on the card (a stat, "X = 3") */
  badge?: string;
  /** a card back instead of the scan */
  back?: boolean;
};

export type Figure =
  /** card scans in a row, each hoverable */
  | { kind: 'cards'; cards: FigCard[]; caption?: string }
  /** card scans joined by arrows: this becomes that */
  | { kind: 'flow'; steps: FigCard[]; caption?: string }
  /** one card with named anchor points; body text marks a part with
   * {{part:id|words}} and hovering the words draws an arrow to it */
  | { kind: 'anatomy'; card: string; parts: Record<string, [x: number, y: number]>; caption?: string }
  /** a battle grid of real scans across a middle line: your opponent's side
   * above, yours below, columns aligned. Each column lists its units front
   * first (the front unit stands at the line); null is an empty slot. */
  | { kind: 'formation'; theirs: (FigCard | null)[][]; yours: (FigCard | null)[][]; attacker: 'theirs' | 'yours'; notes?: string[]; caption?: string }
  /** a unit with mods tucked under it, and what it now reads */
  | { kind: 'modded'; host: string; mods: string[]; reads?: string; caption?: string }
  /** several figures shown in turn: 'loop' plays by itself, 'step' has buttons */
  | { kind: 'frames'; play: 'loop' | 'step'; frames: { figure: Figure; caption: string }[]; caption?: string }
  /** markup lessons.ts owns (trusted, not user text) */
  | { kind: 'html'; html: string; caption?: string };

export interface LessonPage {
  title: string;
  /** markdown (ui/markdown.ts) with [[Card Name]] / [[text|Card Name]] hover
   * links, {{part:id|words}} anatomy pointers, and the card-text icon tokens
   * ({Battle}, [Switch1], [r]…). A function when the page names a card the
   * learner is actually holding. */
  body: string | ((c: LessonCtx) => string);
  /** a line set apart and emphasised — the one thing to remember */
  callout?: string | ((c: LessonCtx) => string);
  quotes?: LessonQuote[];
  figure?: Figure | Figure[] | ((c: LessonCtx) => Figure | Figure[] | null);
  /** selectors of real on-screen things this page is about; they glow while it is open */
  highlight?: string[];
}

export interface Lesson {
  id: string;
  /** the number shown to the learner ("3", "3b") */
  n: string;
  title: string;
  /** not before this moment in the game (absent = off the board only) */
  when?: (c: LessonCtx) => boolean;
  /** true = a moment that may never come (the learner never draws a virus):
   * it does not hold back the lessons after it while its trigger is false */
  optional?: boolean;
  /** true = due whenever its trigger holds, whatever is still unseen ahead of
   * it (the end of the game cannot wait for a lesson the game never reached) */
  anyOrder?: boolean;
  /** only once this lesson has been shown — an idea that needs another first
   * (a virus is a mod, so viruses wait for augmenting) */
  after?: string;
  /** a short nudge rather than a lesson: a small box that leaves the board
   * visible (its highlights are the point) */
  compact?: boolean;
  pages: LessonPage[];
}

export interface FlowProgress {
  /** lesson ids shown or skipped */
  seen: readonly string[];
}

/** The lesson due now, if any: the first unseen lesson in order whose trigger
 * holds — where an unseen lesson that is NOT optional and not yet due holds
 * back everything after it. A lesson with no trigger is never due in a game. */
export function dueLesson(lessons: readonly Lesson[], progress: FlowProgress, c: LessonCtx): Lesson | null {
  const seen = new Set(progress.seen);
  const now = lessons.find(l => l.anyOrder && l.when && !seen.has(l.id) && l.when(c));
  if (now) return now;
  for (const l of lessons) {
    if (!l.when || seen.has(l.id)) continue;
    if (l.when(c) && (!l.after || seen.has(l.after))) return l;
    if (!l.optional) return null;
  }
  return null;
}

/** What a page is rendered against when no game is up (re-reading a lesson
 * from the menu): an empty table, so a page that names "a card in your hand"
 * falls back to its general wording rather than to nothing. */
const EMPTY_CTX: LessonCtx = {
  state: {
    players: [0, 1].map(seat => ({ seat, name: '', life: 30, hand: [], bin: [], resources: [], activationsLeft: 2 })),
    entities: {}, phase: 'planning', turn: 0, winner: null,
  } as unknown as GameState,
  legal: [], seat: 0,
};

export const pageBody = (p: LessonPage, c: LessonCtx | null): string =>
  typeof p.body === 'function' ? p.body(c ?? EMPTY_CTX) : p.body;

export function pageFigures(p: LessonPage, c: LessonCtx | null): Figure[] {
  const f = typeof p.figure === 'function' ? p.figure(c ?? EMPTY_CTX) : p.figure;
  return f ? (Array.isArray(f) ? f : [f]) : [];
}

export const pageCallout = (p: LessonPage, c: LessonCtx | null): string =>
  typeof p.callout === 'function' ? p.callout(c ?? EMPTY_CTX) : (p.callout ?? '');

/** lesson markup as the words a reader sees */
const plain = (s: string): string => s
  .replace(/\[\[(?:([^\]|]+)\|)?([^\]]+)\]\]/g, (_m, t, n) => t ?? n)
  .replace(/\{\{part:[\w-]+\|([^}]+)\}\}/g, '$1');

/** Plain text of a lesson, for the judge: what the learner is reading, so a
 * follow-up question is answered about it. Capped, because it rides a request. */
export function lessonContext(l: Lesson, c: LessonCtx | null, cap = 3000): string {
  const parts = [`Lesson ${l.n}: ${l.title}`];
  for (const p of l.pages) {
    parts.push(`## ${p.title}`, plain(pageBody(p, c)));
    const call = pageCallout(p, c);
    if (call) parts.push(plain(call));
    for (const q of p.quotes ?? []) parts.push(`> ${q.text} (${q.source})`);
  }
  const s = parts.join('\n');
  return s.length > cap ? s.slice(0, cap - 1) + '…' : s;
}

// ── predicates the triggers are written in ────────────────────────────

export const me = (c: LessonCtx) => c.state.players[c.seat]!;
export const hand = (c: LessonCtx): CardRow[] => me(c).hand.map(n => rowFor(n)).filter((r): r is CardRow => !!r);
export const myUnits = (c: LessonCtx) => Object.values(c.state.entities).filter(e => e.controller === c.seat && e.kind === 'unit');
export const theirUnits = (c: LessonCtx) => Object.values(c.state.entities).filter(e => e.controller !== c.seat && e.kind === 'unit');
export const canDo = (c: LessonCtx, type: Action['type']): boolean => c.legal.some(a => a.type === type);

/** a legal play of a hand card matching `pred` */
export function canPlay(c: LessonCtx, pred: (r: CardRow) => boolean): boolean {
  return c.legal.some(a => a.type === 'playCard' && (() => {
    const r = rowFor(me(c).hand[a.handIndex] ?? '');
    return !!r && pred(r);
  })());
}

/** a legal augment (from hand or bin) of a card matching `pred` */
export function canAugment(c: LessonCtx, pred: (r: CardRow) => boolean = () => true): boolean {
  return c.legal.some(a => {
    if (a.type !== 'augment' && a.type !== 'graft') return false;
    const zone = a.from === 'bin' ? me(c).bin : a.from === 'hand' ? me(c).hand : [];
    const r = rowFor(zone[a.index] ?? '');
    return !!r && pred(r);
  });
}
