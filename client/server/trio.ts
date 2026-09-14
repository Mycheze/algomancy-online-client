/* Choosing the three elements for a live draft, together.
 *
 * Picking the trio on the home screen before anyone else arrives had two
 * problems. It was one person's decision, and — because the room was dealt the
 * moment its creator joined — that person got to stare at pack 1 pick 1 for as
 * long as it took their opponent to click the link. Both are fixed by not
 * dealing the game until the trio is settled, which is what the lobby does
 * (rooms.ts Lobby); this module is the part that decides.
 *
 * Everything here is PURE: the methods take submissions, a history, and an RNG
 * state, and return a trio plus a plain-English account of how it got there.
 * The randomness runs through the engine's seeded generator off the room seed,
 * so a trio is reproducible, auditable, and — the part that matters at the
 * table — not something either player can nudge.
 *
 * BL-43: a custom deal can play with any number of elements, so every method
 * takes a count. Three is the default and the three-element answers are the
 * ones this module always gave — same draws, same words.
 */
import type { Element } from '../engine/src/types.ts';
import { ALL_ELEMENTS } from '../engine/src/apply.ts';
import { rngNext, rngShuffle } from '../engine/src/rng.ts';

export type TrioMethod = 'pick-one' | 'fresh' | 'rank' | 'again';

export const TRIO_METHODS: TrioMethod[] = ['again', 'pick-one', 'fresh', 'rank'];

/** What one seat submits. The shape depends on the method; `fresh` asks for
 * nothing but still needs both players to say they are ready, because the
 * lobby is also the "are we both here?" gate. */
export interface TrioSubmission {
  /** method 'pick-one': the one element this player wants in */
  element?: Element;
  /** method 'rank': all seven elements, most wanted first */
  ranking?: Element[];
}

/** One past game, as far as trio-choosing is concerned. */
export interface TrioHistoryRow {
  els: Element[];
  playedAt: string;
}

export interface TrioResult {
  els: Element[];
  /** one line naming the method, for the game log */
  how: string;
  /** the working: what each player did and what chance did */
  detail: string[];
}

const isElement = (v: unknown): v is Element => ALL_ELEMENTS.includes(v as Element);

/** Canonical order (ALL_ELEMENTS order), so a trio always reads the same way
 * however it was assembled. */
export const inOrder = (els: Element[]): Element[] =>
  ALL_ELEMENTS.filter(e => els.includes(e));

/** "trio" for three, "pair" for two, "set of 4" otherwise */
export const setWord = (count: number): string =>
  count === 3 ? 'trio' : count === 2 ? 'pair' : `set of ${count}`;
const setsWord = (count: number): string =>
  count === 3 ? 'trios' : count === 2 ? 'pairs' : `sets of ${count}`;
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
const countWord = (count: number): string => COUNT_WORDS[count] ?? String(count);

/** Clean a submission: unknown elements dropped, ranking completed with
 * whatever is missing so a half-filled form still resolves. */
export function sanitizeSubmission(raw: unknown, method: TrioMethod): TrioSubmission {
  const sub = (raw ?? {}) as TrioSubmission;
  if (method === 'pick-one') {
    return isElement(sub.element) ? { element: sub.element } : {};
  }
  if (method === 'rank') {
    const seen = new Set<Element>();
    const ranking: Element[] = [];
    for (const e of Array.isArray(sub.ranking) ? sub.ranking : []) {
      if (isElement(e) && !seen.has(e)) { seen.add(e); ranking.push(e); }
    }
    // a partial ranking is fine: the rest keep ALL_ELEMENTS order behind it
    for (const e of ALL_ELEMENTS) if (!seen.has(e)) ranking.push(e);
    return { ranking };
  }
  return {};
}

/** Is this submission complete enough to lock in? */
export function submissionReady(sub: TrioSubmission, method: TrioMethod): boolean {
  if (method === 'pick-one') return isElement(sub.element);
  if (method === 'rank') return (sub.ranking?.length ?? 0) === ALL_ELEMENTS.length;
  return true;   // 'fresh' and 'again' ask nothing of you but your presence
}

/** draw `n` distinct elements from `pool`, seeded */
function draw(pool: Element[], n: number, rng: number): [Element[], number] {
  const [shuffled, next] = rngShuffle(pool, rng);
  return [shuffled.slice(0, n), next];
}

const list = (els: Element[]): string => els.join(' + ');

// ── method 1: one each, plus one from the bag ─────────────────────────

/**
 * Each player names one element, blind, and the rest is chance.
 *
 * Blind on purpose: seeing your opponent's pick first would turn a
 * declaration into a counter-pick, and the point is that you each get to
 * bring something you want to play.
 */
function pickOne(subs: [TrioSubmission, TrioSubmission], names: [string, string], rng: number, count: number): [TrioResult, number] {
  const a = subs[0].element, b = subs[1].element;
  const chosen = inOrder([...new Set([a, b].filter(isElement))] as Element[]);
  const detail: string[] = [];
  if (a) detail.push(`${names[0]} chose ${a}.`);
  if (b) detail.push(`${names[1]} chose ${b}${a && a === b ? ' — the same one!' : ''}.`);
  const rest = ALL_ELEMENTS.filter(e => !chosen.includes(e));
  const [drawn, next] = draw(rest, Math.max(0, count - chosen.length), rng);
  detail.push(drawn.length === 0
    ? `Nothing was left to draw: your picks are the ${setWord(count)}.`
    : drawn.length === 1
      ? `${drawn[0]} was drawn at random to fill the ${setWord(count)}.`
      : `${list(drawn)} were drawn at random to fill the ${setWord(count)}.`);
  return [{ els: inOrder([...chosen, ...drawn]), how: 'one element each, the rest drawn', detail }, next];
}

// ── method 2: something you have not played ───────────────────────────

/** every set of `count` elements, in canonical order — C(7,3) = 35 trios */
export function allSets(count: number): Element[][] {
  const out: Element[][] = [];
  const walk = (from: number, picked: Element[]): void => {
    if (picked.length === count) { out.push(picked); return; }
    for (let i = from; i < ALL_ELEMENTS.length; i++) walk(i + 1, [...picked, ALL_ELEMENTS[i]!]);
  };
  walk(0, []);
  return out;
}

/** every trio, in canonical order — C(7,3) = 35 of them */
export const allTrios = (): Element[][] => allSets(3);

const trioKey = (els: Element[]): string => inOrder(els).join('+');

/**
 * The trio these two have played least recently — a brand new one if there is
 * one, otherwise the oldest.
 *
 * Ties are broken at random rather than by list order, because with 35 trios
 * and eight games played the "never played" set is enormous and picking the
 * first one alphabetically would mean fire+water+earth every time.
 */
function freshest(history: TrioHistoryRow[], rng: number, count: number): [TrioResult, number] {
  const lastPlayed = new Map<string, string>();
  for (const row of history) {
    const els = row.els.filter(isElement);
    if (els.length !== count) continue;   // a game of another size is not a candidate here
    const key = trioKey(els);
    const prev = lastPlayed.get(key);
    if (!prev || row.playedAt > prev) lastPlayed.set(key, row.playedAt);
  }
  const trios = allSets(count);
  const unplayed = trios.filter(t => !lastPlayed.has(trioKey(t)));
  const detail: string[] = [];
  let pool: Element[][];
  if (unplayed.length) {
    pool = unplayed;
    detail.push(`${unplayed.length} of the ${trios.length} ${setsWord(count)} have never been played between you.`);
  } else {
    // everything has been played: take the staleset, and let ties be a draw
    const oldest = trios.reduce((min, t) => {
      const at = lastPlayed.get(trioKey(t))!;
      return at < min ? at : min;
    }, '9999');
    pool = trios.filter(t => lastPlayed.get(trioKey(t)) === oldest);
    detail.push(`Every ${setWord(count)} has been played; these are the ones you have not touched since ${oldest.slice(0, 10)}.`);
  }
  const [picked, next] = rngShuffle(pool, rng);
  const els = inOrder(picked[0]!);
  detail.push(`Drawn from that set: ${list(els)}.`);
  return [{ els, how: `a ${setWord(count)} you have not played (or have not played in a while)`, detail }, next];
}

// ── method 3: rank all seven, then let the weighting decide ───────────

/** how much a combined rank is worth as a lottery ticket. Best possible
 * (both rank it 1st) is 36; worst (both 7th) is 1. Squaring the gap makes
 * a shared favourite a heavy favourite without making it a certainty. */
const WEIGHT_FLOOR = 1;
function rankWeight(combined: number): number {
  const best = 2, worst = 2 * ALL_ELEMENTS.length;          // 2 .. 14
  const span = worst - best;                                 // 12
  const goodness = (span - (combined - best)) / span;        // 1 .. 0
  return WEIGHT_FLOOR + Math.round(goodness * goodness * 35);
}

/** one weighted draw without replacement, seeded */
function weightedDraw(pool: { el: Element; weight: number }[], rng: number): [Element, number] {
  const total = pool.reduce((n, p) => n + p.weight, 0);
  const [r, next] = rngNext(rng);
  let mark = r * total;
  for (const p of pool) {
    mark -= p.weight;
    if (mark <= 0) return [p.el, next];
  }
  return [pool[pool.length - 1]!.el, next];
}

/**
 * Both players put the seven elements in order, and the trio is drawn from
 * the combined ranking with the odds tilted toward what you both wanted.
 *
 * A Borda count rather than an instant runoff: with two voters and seven
 * candidates an IRV would just be "whoever's first choice survives the coin
 * flip", which throws away six sevenths of what you both said. Summing ranks
 * uses the whole ballot, and something you both put second beats something one
 * of you loved and the other put last — which is the outcome two people
 * actually want out of a shared draft.
 */
function ranked(subs: [TrioSubmission, TrioSubmission], names: [string, string], rng: number, count: number): [TrioResult, number] {
  const rankOf = (ranking: Element[] | undefined) => (el: Element): number => {
    const i = ranking?.indexOf(el) ?? -1;
    return i < 0 ? ALL_ELEMENTS.length : i + 1;
  };
  const rankA = rankOf(subs[0].ranking), rankB = rankOf(subs[1].ranking);
  let pool = ALL_ELEMENTS.map(el => ({
    el,
    combined: rankA(el) + rankB(el),
    weight: rankWeight(rankA(el) + rankB(el)),
  }));

  const picked: Element[] = [];
  let state = rng;
  for (let i = 0; i < count; i++) {
    const [el, next] = weightedDraw(pool, state);
    state = next;
    picked.push(el);
    pool = pool.filter(p => p.el !== el);
  }

  const table = ALL_ELEMENTS
    .map(el => ({ el, combined: rankA(el) + rankB(el) }))
    .sort((x, y) => x.combined - y.combined)
    .map(x => `${x.el} ${x.combined}`)
    .join(' · ');
  return [{
    els: inOrder(picked),
    how: 'drawn from your combined rankings',
    detail: [
      `${names[0]} ranked ${list(subs[0].ranking ?? [])}.`,
      `${names[1]} ranked ${list(subs[1].ranking ?? [])}.`,
      `Combined (lower is more wanted): ${table}.`,
      `Drawn with the odds weighted to that: ${list(inOrder(picked))}.`,
    ],
  }, state];
}

// ── the one entry point ───────────────────────────────────────────────

export interface ResolveInput {
  method: TrioMethod;
  submissions: [TrioSubmission, TrioSubmission];
  names: [string, string];
  /** past games involving either player, for 'fresh' */
  history: TrioHistoryRow[];
  /** the trio the previous game used, for 'again' (rematches only) */
  previousTrio?: Element[];
  /** seeded generator state — the room's seed, so this is reproducible */
  rng: number;
  /** BL-43: how many elements the game is played with (default 3) */
  count?: number;
}

export function resolveTrio(input: ResolveInput): TrioResult {
  const { method, submissions, names, history, previousTrio, rng } = input;
  const count = input.count ?? 3;
  // 'again' is offered only on a rematch; without a previous trio to run back
  // it is meaningless, so fall through to the ordinary blind pick
  if (method === 'again' && previousTrio?.length === count) {
    return {
      els: inOrder(previousTrio),
      how: `the same ${setWord(count)} again`,
      detail: [`You both wanted another game of ${list(inOrder(previousTrio))}.`],
    };
  }
  const [result] = method === 'rank' ? ranked(submissions, names, rng, count)
    : method === 'fresh' ? freshest(history, rng, count)
    : pickOne(submissions, names, rng, count);
  return result;
}

/** A short label for the method, used by the lobby and the game log. */
export const METHOD_LABELS: Record<TrioMethod, string> = {
  again: 'Run it back',
  'pick-one': 'One each, one at random',
  fresh: 'Something new',
  rank: 'Rank all seven',
};

/** The lobby's explanation of each method, for a game of `count` elements. */
export function methodBlurbs(count = 3): Record<TrioMethod, string> {
  const word = setWord(count);
  return {
    again: `Play the same ${countWord(count)} elements you just played.`,
    'pick-one': count === 3
      ? 'You each name one element without seeing the other. The third is drawn at random.'
      : count === 2
        ? 'You each name one element without seeing the other. If you name the same one, the second is drawn at random.'
        : 'You each name one element without seeing the other. The rest are drawn at random.',
    fresh: `The server picks a ${word} the two of you have never played — or have not played in the longest.`,
    rank: `You each put all seven in order. The ${word} is drawn from your combined ranking, weighted toward what you both wanted.`,
  };
}

export const METHOD_BLURBS: Record<TrioMethod, string> = methodBlurbs(3);

export function sanitizeMethod(v: unknown): TrioMethod {
  return TRIO_METHODS.includes(v as TrioMethod) ? v as TrioMethod : 'pick-one';
}
