/* Competitive Constructed (doc 22 §3) — the walkers 800–807 share.
 *
 * Two things live here and nothing else:
 *
 *   · `walk` — a seeded random walk over `legalActions`, in any mode, with
 *     optional `GameRules`. It is `fuzz.ts`'s loop without the random-shaped
 *     formations (those are a fuzz concern; the walk here only has to be
 *     DETERMINISTIC in the legal lists, which is what makes it a drift probe:
 *     one added, removed or reordered option re-rolls every later pick).
 *   · `stepHash` / `Trace` — the fingerprint of one step: the whole state,
 *     the step's events and BOTH seats' legal lists, hashed. Byte-identical,
 *     which is stronger than `server/replay-probe.ts`'s semantic `signature`
 *     (that one is tested beside it in 800).
 */
import { createHash } from 'node:crypto';
import { apply, createGame, legalActions, IllegalAction } from '../src/apply.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { rngNext } from '../src/rng.ts';
import type { Action, CardName, EngineEvent, GameMode, GameRules, GameState } from '../src/types.ts';
import { checkInvariants } from './fuzz.ts';

export const h10 = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 10);

/** one step, as everything a client or a replay could see of it */
export function stepHash(state: GameState, events: readonly EngineEvent[]): string {
  return h10(JSON.stringify([state, events, legalActions(state, 0), legalActions(state, 1)]));
}

/** a rolling hash over a run's steps, checkpointed every `every` steps */
export class Trace {
  private h = '';
  private n = 0;
  readonly marks: string[] = [];
  private readonly every: number;
  constructor(every = 10) { this.every = every; }
  add(step: string): void {
    this.h = h10(this.h + step);
    if (++this.n % this.every === 0) this.marks.push(this.h);
  }
  done(): { steps: number; marks: string[]; final: string } {
    return { steps: this.n, marks: [...this.marks], final: this.h };
  }
}

/** a seeded legal 30-card constructed deck (max 2 copies) */
export function randomDeck(seed: number): CardName[] {
  let rng = (seed * 2246822519) >>> 0;
  const out: CardName[] = [];
  const count = new Map<string, number>();
  while (out.length < 30) {
    let r: number;
    [r, rng] = rngNext(rng);
    const n = DECK_LIST[Math.floor(r * DECK_LIST.length)]!;
    if ((count.get(n) ?? 0) >= 2) continue;
    count.set(n, (count.get(n) ?? 0) + 1);
    out.push(n);
  }
  return out;
}

export interface WalkOpts {
  mode?: GameMode;
  decks?: [CardName[], CardName[]];
  rules?: GameRules;
  maxActions?: number;
  /** called before each pick with the state and both seats' lists */
  onStep?: (s: GameState, legal: [Action[], Action[]], i: number) => void;
  trace?: Trace;
  invariants?: boolean;
}

export interface WalkResult { actions: Action[]; state: GameState; finished: boolean }

/** a seeded random walk over the union of both seats' legal lists */
export function walk(seed: number, o: WalkOpts = {}): WalkResult {
  let rng = (seed * 2654435761) >>> 0;
  const rand = (): number => { const [v, n] = rngNext(rng); rng = n; return v; };
  const mode = o.mode ?? 'shared';
  const created = createGame(seed, undefined, mode, undefined, o.decks, undefined, undefined, o.rules);
  let state = created.state;
  o.trace?.add(stepHash(state, created.events));
  const actions: Action[] = [];
  const max = o.maxActions ?? 600;
  let tries = 0;
  for (let i = 0; i < max && state.phase !== 'gameover' && tries < max * 4; tries++) {
    if (o.invariants) checkInvariants(state);
    const legal: [Action[], Action[]] = [legalActions(state, 0), legalActions(state, 1)];
    o.onStep?.(state, legal, i);
    const all = [...legal[0], ...legal[1]];
    if (!all.length) throw new Error(`stuck: no legal action for anyone (seed ${seed}, action ${i}, phase ${state.phase})`);
    const a = all[Math.floor(rand() * all.length)]!;
    let r;
    try {
      r = apply(state, a);
    } catch (err) {
      // CR D2.1d's one documented exception (fuzz.ts isContractException)
      if (err instanceof IllegalAction && err.disturbs) continue;
      throw new Error(`legalActions lied: ${JSON.stringify(a)}: ${(err as Error).message} (seed ${seed}, action ${i})`);
    }
    state = r.state;
    actions.push(a);
    o.trace?.add(stepHash(state, r.events));
    i++;
  }
  if (o.invariants) checkInvariants(state);
  return { actions, state, finished: state.phase === 'gameover' };
}

/** replay `actions` onto `start`, tracing every step (a refusal is a step too) */
export function traceReplay(start: { state: GameState; events: EngineEvent[] }, actions: readonly Action[], trace: Trace): GameState {
  let state = start.state;
  trace.add(stepHash(state, start.events));
  for (const a of actions) {
    try {
      const r = apply(state, a);
      state = r.state;
      trace.add(stepHash(state, r.events));
    } catch (err) {
      if (!(err instanceof IllegalAction)) throw err;
      trace.add(h10(`refused:${err.message}`));
    }
  }
  return state;
}
