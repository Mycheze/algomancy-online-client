/* Stateful convenience wrapper over the pure engine, for tests and the
 * hotseat UI. Keeps the current state, the accumulated log, and the action
 * log (seed + actions = the whole game). No I/O here either.
 */
import type { Action, Decision, EngineEvent, GameState, Seat } from './types.ts';
import { apply, createGame, legalActions } from './apply.ts';
import { E } from './engine.ts';

export class Harness {
  state: GameState;
  log: string[] = [];
  events: EngineEvent[] = [];
  actions: Action[] = [];

  seed: number;

  constructor(seed: number, names?: [string, string], mode?: 'shared' | 'draft', draftElements?: import('./types.ts').Element[]) {
    this.seed = seed;
    const r = createGame(seed, names, mode, draftElements);
    this.state = r.state;
    this.absorb(r.events);
  }

  private absorb(events: EngineEvent[]): void {
    this.events.push(...events);
    for (const ev of events) this.log.push(ev.msg);
  }

  /** apply an action; throws IllegalAction on a bad one (state unchanged) */
  do(action: Action): EngineEvent[] {
    const r = apply(this.state, action);
    this.state = r.state;
    this.actions.push(action);
    this.absorb(r.events);
    return r.events;
  }

  legal(seat: Seat): Action[] { return legalActions(this.state, seat); }
  get decision(): Decision | null { return this.state.decision; }
  /** a query-only E over the current state (do not mutate through it) */
  get q(): E { return new E(this.state); }
}
