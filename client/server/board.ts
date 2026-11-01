/* THE BOARD PATCH — put a named board on a freshly dealt game.
 *
 * Moved out of scenarios.ts (2026-11-01) so a second caller can share it
 * without importing the scenario library: the judge bot's engine calculator
 * (simulate.ts, /api/bot/simulate) builds its board through exactly these two
 * functions, so "the board the bot simulated" and "the board the scenario
 * tester deals" are one piece of code. The bodies are MOVED, not changed —
 * 185-scenario-determinism and 186-scenario-library are the guards that
 * every scenario still deals byte for byte, and 766-simulate-board re-runs
 * 185's clock/randomness scan over THIS file, because the code it scanned now
 * lives here.
 *
 * Same discipline as scenarios.ts: no wall clock, no unseeded randomness, no
 * reading the filesystem — a patched board is a pure function of its inputs.
 * Do not write those calls out literally in this file's prose either (766's
 * scan is deliberately dumb, like 185's).
 *
 * ⚠ A VALUE IMPORT ONLY FROM THE ENGINE. scenarios.ts imports this module,
 * and the batch files import types from scenarios.ts; this file importing
 * anything back out of scenarios.ts would close the boot-time cycle the
 * batch-file warning there describes.
 */
import type { CardName, EngineEvent, EntityId, GameState, ResourceKind, Seat } from '../engine/src/types.ts';
import { apply } from '../engine/src/apply.ts';
import type { E } from '../engine/src/engine.ts';

/** One unit to stand on the board (scenarios.ts `Placed` is this shape). */
export interface BoardUnit {
  card: CardName;
  /** net +1/+1 (negative: -1/-1) counters */
  counters?: number;
  token?: boolean;
  /** mods already under it, attached in list order */
  mods?: { card: CardName; as: 'graft' | 'augment' }[];
}

/** One side of a board (scenarios.ts `ScenarioSide` is this shape). */
export interface BoardSide {
  hand: CardName[];
  play: BoardUnit[];
  /** all OPEN, pushed in the object's own key order */
  resources: Partial<Record<ResourceKind, number>>;
}

/** Put a side's hand, resources and units on the board. Mutates `state`.
 *
 * The hand and the resource pool are REPLACED, not appended to: a scenario
 * says what the board is, and seven random opening cards beside two named ones
 * is noise the owner has to read past on every single card. The deck is left
 * exactly as the seed dealt it — draws still work and still replay. */
export function patchSide(e: E, seat: Seat, side: BoardSide, out: EntityId[]): void {
  const p = e.player(seat);
  p.hand = [...side.hand];
  p.resources = [];
  // ordered by the ResSpec's own key order so two runs push the same pool in
  // the same order — an object literal's key order is stable in JS, and the
  // resource ARRAY is indexed by actions, so its order is part of the board.
  for (const [kind, n] of Object.entries(side.resources)) {
    for (let i = 0; i < (n ?? 0); i++) p.resources.push({ kind: kind as ResourceKind, state: 'open' });
  }
  for (const placed of side.play) {
    const u = e.spawnUnit(seat, placed.card, e.homeRegion(seat), {
      ...(placed.token ? { token: true } : {}),
      ...(placed.counters ? { counters: placed.counters } : {}),
    });
    for (const m of placed.mods ?? []) e.attachMod(u, m.card, seat, m.as);
    out.push(u.id);
  }
}

/**
 * CR 504.5: the haste step is ALWAYS offered now, so it stands between
 * `donePlanning` and every battle action in every prologue ever written.
 *
 * Before the haste step became unconditional (CR 504.5) the step only appeared when somebody held a payable haste card,
 * which made its presence a property of the SCENARIO — so the scenario-authoring round made each
 * scenario put its own `doneHaste` in, and warned (correctly, at the time)
 * that `runPrologue` skips nothing. That reasoning is now inverted: the step
 * is unconditional, so a `doneHaste` in a prologue carries no information
 * about the board at all, and requiring 32 prologues to each write two of
 * them would be boilerplate whose only job is to be forgotten.
 *
 * So the SETUP closes it — and only the setup. This is not the engine
 * skipping a step; the step happens, exactly as it does in a real game, and
 * `dealScenario` walks through it the way it walks through everything else on
 * the way to the position the scenario declares. A prologue that closes the
 * step itself still works: this only finishes the seats it left open, and
 * only when the next setup action is something other than `doneHaste`.
 */
export function closeHasteStep(s: GameState, events: EngineEvent[]): GameState {
  let out = s;
  while (out.hasteDone) {
    const seat = out.hasteDone.findIndex(d => !d);
    if (seat < 0) break;   // cannot happen: an all-done array is nulled by the engine
    const r = apply(out, { type: 'doneHaste', seat: seat as Seat });
    out = r.state;
    events.push(...r.events);
  }
  return out;
}
