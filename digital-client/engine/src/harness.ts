/* Stateful convenience wrapper over the pure engine, for tests and the
 * hotseat UI. Keeps the current state, the accumulated log, and the action
 * log (seed + actions = the whole game). No I/O here either.
 */
import type { Action, CardName, Decision, EngineEvent, GameMode, GameState, Seat } from './types.ts';
import { apply, createGame, legalActions } from './apply.ts';
import { E } from './engine.ts';

export class Harness {
  state: GameState;
  log: string[] = [];
  /** EventType per LOG LINE, index-aligned with `log`. Not the same list as
   * `events`: an event with an empty message ('stackFlash' — a signal for the
   * client, not a line for the reader) is absorbed but never logged, so the
   * two arrays drifted apart the moment such an event existed. */
  logTypes: (EngineEvent['type'] | undefined)[] = [];
  events: EngineEvent[] = [];
  actions: Action[] = [];

  seed: number;

  constructor(seed: number, names?: [string, string], mode?: GameMode, draftElements?: import('./types.ts').Element[], decks?: [CardName[], CardName[]]) {
    this.seed = seed;
    const r = createGame(seed, names, mode, draftElements, decks);
    this.state = r.state;
    this.absorb(r.events);
  }

  private absorb(events: EngineEvent[]): void {
    this.events.push(...events);
    for (const ev of events) {
      if (!ev.msg) continue;   // a signal-only event is not a log line
      this.log.push(ev.msg);
      this.logTypes.push(ev.type);
    }
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
