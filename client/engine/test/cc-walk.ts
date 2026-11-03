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
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { apply, createGame, legalActions, IllegalAction } from '../src/apply.ts';
import { DECK_LIST } from '../src/cards/registry.ts';
import { Harness } from '../src/harness.ts';
import { rngNext } from '../src/rng.ts';
import type { Action, CardName, EngineEvent, GameMode, GameRules, GameState, Seat } from '../src/types.ts';
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

/**
 * CR D2.1a's contract on a CC board: the reducer refuses exactly what
 * `legalActions` does not offer. The candidates are the HOUSE-RULE lists of
 * the same board (`sequential` dropped), so every play the CC gate takes away
 * is tried against the reducer too. Returns the disagreements.
 */
export function gateDisagreements(s: GameState): string[] {
  const out: string[] = [];
  const twin = structuredClone(s);
  delete twin.sequential;
  for (const seat of [0, 1] as const) {
    const offered = new Set(legalActions(s, seat).map(a => JSON.stringify(a)));
    const candidates = new Map<string, Action>();
    for (const a of [...legalActions(twin, seat), ...legalActions(s, seat)]) candidates.set(JSON.stringify(a), a);
    for (const [k, a] of candidates) {
      let accepted = true;
      try { apply(s, a); } catch (err) {
        if (!(err instanceof IllegalAction)) throw err;
        if (err.disturbs) continue;   // CR D2.1d: "not yet", decided after the fact
        accepted = false;
      }
      if (accepted !== offered.has(k)) out.push(`seat ${seat} ${accepted ? 'accepted but not offered' : 'offered but refused'}: ${k}`);
    }
  }
  return out;
}

export const ccDecks = (): [CardName[], CardName[]] => [DECK_LIST.slice(0, 30), DECK_LIST.slice(30, 60)];

/** a CC game (Ann seat 0, Bob seat 1) with seat `int` holding the initiative */
export const ccGame = (int: Seat = 0, seed = 42, rules: GameRules = { sequential: true }): Harness =>
  new Harness(seed, ['Ann', 'Bob'], 'constructed', undefined, ccDecks(), undefined, undefined, { ...rules, initiative: int });

/** the distinct action types of a list, in order */
export const types = (as: readonly Action[]): string[] => [...new Set(as.map(a => a.type))];

/** `a` is refused with a message matching `msg` */
export function refused(h: Harness, a: Action, msg: RegExp): void {
  assert.throws(() => h.do(a), (err: unknown) => err instanceof IllegalAction && msg.test(err.message), JSON.stringify(a));
}

/** a CC game through the draw phase (both bottom their first two) */
export function ccBottomed(h: Harness): Harness {
  for (const seat of [0, 1] as Seat[]) if (h.state.bottomDone && !h.state.bottomDone[seat]) h.do({ type: 'bottomCards', seat, handIndices: [0, 1] });
  return h;
}

/** ... and through both resource steps, INT first, into the haste step
 * (from wherever in the resource step the game is) */
export function ccToHaste(h: Harness): Harness {
  ccBottomed(h);
  const int = h.state.initiative;
  for (const seat of [int, 1 - int]) if (h.state.hasteDone === null && !h.state.planningDone[seat]) h.do({ type: 'donePlanning', seat });
  return h;
}

/** ... and through both haste steps and an empty battle phase, into deployment */
export function ccToDeploy(h: Harness): Harness {
  if (h.state.phase === 'planning') ccToHaste(h);
  const int = h.state.initiative;
  for (const seat of [int, 1 - int]) if (h.state.hasteDone && !h.state.hasteDone[seat]) h.do({ type: 'doneHaste', seat });
  while (h.state.phase === 'battle') h.do({ type: 'declareAttack', seat: h.state.battle!.attacker, columns: [] });
  assert.equal(h.state.phase, 'deploy');
  return h;
}
